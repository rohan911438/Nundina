// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {SignalLib} from "./lib/SignalLib.sol";
import {ISignalBook} from "./interfaces/ISignalBook.sol";
import {IProviderRegistry} from "./interfaces/IProviderRegistry.sol";
import {IOutcomeResolver} from "./interfaces/IOutcomeResolver.sol";

/// @title SignalBook
/// @notice Commit-reveal register of trading signals. A commit is final: no edit, no delete.
///         A signal that is not revealed within the reveal window becomes an automatic loss.
contract SignalBook is ISignalBook, AccessControl, Pausable, EIP712 {
    using SignalLib for SignalLib.Signal;

    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant COMMIT_AUTH_TYPEHASH = keccak256(
        "CommitAuthorization(address provider,bytes32 commitHash,bytes32 market,uint64 validUntil,uint256 pricePerSub,uint256 nonce,uint64 deadline)"
    );

    uint64 public constant MIN_VALIDITY = 15 minutes;
    uint64 public constant MAX_VALIDITY = 7 days;
    uint64 public constant REVEAL_WINDOW = 6 hours;
    uint256 public constant MAX_UPSTREAM = 5;
    uint8 public constant MAX_DEPTH = 3;

    IProviderRegistry public immutable registry;
    /// @notice The OutcomeResolver; set once.
    IOutcomeResolver public resolver;
    /// @notice Entry further than this from the oracle price at commit makes a limit signal (bps).
    uint256 public limitThresholdBps = 100;
    /// @notice Per-signal price cap (6 decimals); 0 = no cap.
    uint256 public maxPricePerSub;

    uint256 public nextId = 1;
    mapping(uint256 id => Record) internal _records;
    mapping(uint256 id => SignalLib.Signal) internal _revealed;
    mapping(address provider => uint256) public nonces;

    error NotRelayer();
    error BadSignature();
    error BadNonce();
    error AuthExpired();
    error NotRegistered();
    error PracticeMustBeFree();
    error PriceAboveCap();
    error BadValidity();
    error BadUpstream();
    error TooDeep();
    error UnknownSignal();
    error AlreadyRevealed();
    error HashMismatch();
    error FieldMismatch();
    error RevealWindowClosed();
    error RevealWindowOpen();
    error NotCommitted();
    error ResolverAlreadySet();
    error NotResolver();

    constructor(IProviderRegistry registry_, address admin, uint256 maxPricePerSub_) EIP712("Nundina", "1") {
        registry = registry_;
        maxPricePerSub = maxPricePerSub_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ───────────────────────── commit ─────────────────────────

    /// @notice Commits a signal on behalf of a provider. The relayer pays gas; the provider signs.
    /// @param auth The provider-signed commit authorization (hash, market, expiry, price, nonce, deadline).
    /// @param providerSig EIP-712 signature (or ERC-1271) by `auth.provider` over `auth`.
    /// @param upstream Signal ids this (aggregator) signal builds on; same market, committed earlier.
    /// @param upstreamBps Payout share per upstream in basis points (sum <= 10000).
    /// @param cipherURI Where the encrypted signal body lives.
    /// @return id The new signal id.
    function commit(
        CommitAuthorization calldata auth,
        bytes calldata providerSig,
        uint256[] calldata upstream,
        uint16[] calldata upstreamBps,
        string calldata cipherURI
    ) external onlyRole(RELAYER_ROLE) whenNotPaused returns (uint256 id) {
        _checkAuth(auth, providerSig);
        if (!registry.isRegistered(auth.provider)) revert NotRegistered();
        if (registry.isPractice(auth.provider) && auth.pricePerSub != 0) revert PracticeMustBeFree();
        if (maxPricePerSub != 0 && auth.pricePerSub > maxPricePerSub) revert PriceAboveCap();
        if (auth.validUntil < block.timestamp + MIN_VALIDITY || auth.validUntil > block.timestamp + MAX_VALIDITY) {
            revert BadValidity();
        }

        id = nextId++;
        uint8 depth = _checkUpstream(id, auth.market, upstream, upstreamBps);
        uint256 oraclePrice = resolver.spotPrice(auth.market);

        Record storage r = _records[id];
        r.provider = auth.provider;
        r.committedAt = uint64(block.timestamp);
        r.validUntil = auth.validUntil;
        r.status = Status.COMMITTED;
        r.depth = depth;
        r.commitHash = auth.commitHash;
        r.market = auth.market;
        r.pricePerSub = auth.pricePerSub;
        r.oraclePriceAtCommit = oraclePrice;
        r.cipherURI = cipherURI;
        r.upstream = upstream;
        r.upstreamBps = upstreamBps;

        emit SignalCommitted(
            id, auth.provider, auth.market, auth.validUntil, auth.pricePerSub, auth.commitHash, oraclePrice, cipherURI
        );
        if (upstream.length != 0) emit SignalUpstream(id, upstream, upstreamBps);
    }

    // ───────────────────────── reveal ─────────────────────────

    /// @notice Publishes the plaintext of a committed signal. Anyone may call with the right plaintext.
    function reveal(uint256 id, SignalLib.Signal calldata s) external {
        _reveal(id, s);
    }

    /// @notice Reveal used by the OutcomeResolver while resolving (resolution doubles as reveal).
    function revealFor(uint256 id, SignalLib.Signal calldata s) external {
        if (msg.sender != address(resolver)) revert NotResolver();
        _reveal(id, s);
    }

    /// @notice Marks a signal that was never revealed as an automatic loss. Anyone, after the window.
    function markUnrevealed(uint256 id) external {
        Record storage r = _records[id];
        if (r.status != Status.COMMITTED) revert NotCommitted();
        if (block.timestamp <= uint256(r.validUntil) + REVEAL_WINDOW) revert RevealWindowOpen();
        r.status = Status.UNREVEALED_LOSS;
        emit SignalUnrevealed(id);
    }

    // ───────────────────────── admin ─────────────────────────

    /// @notice Wires the resolver once.
    function setResolver(IOutcomeResolver resolver_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(resolver) != address(0)) revert ResolverAlreadySet();
        resolver = resolver_;
    }

    /// @notice Sets the limit-signal threshold in bps (max 5%).
    function setLimitThresholdBps(uint256 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(bps <= 500, "bps");
        limitThresholdBps = bps;
    }

    /// @notice Sets the per-signal price cap (0 = none).
    function setMaxPricePerSub(uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        maxPricePerSub = cap;
    }

    /// @notice Pauses new commits only. Reveal and markUnrevealed always work.
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /// @notice Resumes commits.
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ───────────────────────── views ─────────────────────────

    /// @inheritdoc ISignalBook
    function getSignal(uint256 id) external view returns (Record memory) {
        return _records[id];
    }

    /// @inheritdoc ISignalBook
    function revealedSignal(uint256 id) external view returns (SignalLib.Signal memory) {
        return _revealed[id];
    }

    /// @inheritdoc ISignalBook
    function isRevealed(uint256 id) external view returns (bool) {
        return _records[id].status == Status.REVEALED;
    }

    /// @inheritdoc ISignalBook
    function statusOf(uint256 id) external view returns (Status) {
        return _records[id].status;
    }

    /// @inheritdoc ISignalBook
    function providerOf(uint256 id) external view returns (address) {
        return _records[id].provider;
    }

    /// @inheritdoc ISignalBook
    function upstreamOf(uint256 id) external view returns (uint256[] memory, uint16[] memory) {
        return (_records[id].upstream, _records[id].upstreamBps);
    }

    /// @notice True if the revealed entry was far from the oracle price at commit.
    function isLimit(uint256 id) external view returns (bool) {
        return _records[id].isLimit;
    }

    /// @inheritdoc ISignalBook
    function hashSignal(SignalLib.Signal calldata s) public view returns (bytes32) {
        return _hashTypedDataV4(SignalLib.structHash(s));
    }

    /// @notice EIP-712 domain separator (for off-chain checks).
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ───────────────────────── internals ─────────────────────────

    function _checkAuth(CommitAuthorization calldata a, bytes calldata sig) internal {
        if (a.deadline < block.timestamp) revert AuthExpired();
        if (a.nonce != nonces[a.provider]) revert BadNonce();
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    COMMIT_AUTH_TYPEHASH,
                    a.provider,
                    a.commitHash,
                    a.market,
                    a.validUntil,
                    a.pricePerSub,
                    a.nonce,
                    a.deadline
                )
            )
        );
        if (!SignatureChecker.isValidSignatureNow(a.provider, digest, sig)) revert BadSignature();
        nonces[a.provider]++;
    }

    function _checkUpstream(uint256 id, bytes32 market, uint256[] calldata upstream, uint16[] calldata bps)
        internal
        view
        returns (uint8 depth)
    {
        if (upstream.length != bps.length || upstream.length > MAX_UPSTREAM) revert BadUpstream();
        uint256 sum;
        for (uint256 i; i < upstream.length; ++i) {
            uint256 u = upstream[i];
            if (u == 0 || u >= id) revert BadUpstream();
            Record storage ur = _records[u];
            if (ur.market != market) revert BadUpstream();
            for (uint256 j; j < i; ++j) {
                if (upstream[j] == u) revert BadUpstream();
            }
            sum += bps[i];
            if (ur.depth + 1 > depth) depth = ur.depth + 1;
        }
        if (sum > 10_000) revert BadUpstream();
        if (depth > MAX_DEPTH) revert TooDeep();
    }

    function _reveal(uint256 id, SignalLib.Signal calldata s) internal {
        Record storage r = _records[id];
        if (r.status == Status.NONE) revert UnknownSignal();
        if (r.status != Status.COMMITTED) revert AlreadyRevealed();
        if (block.timestamp > uint256(r.validUntil) + REVEAL_WINDOW) revert RevealWindowClosed();
        if (hashSignal(s) != r.commitHash) revert HashMismatch();
        if (
            s.provider != r.provider || s.market != r.market || s.validUntil != r.validUntil
                || s.pricePerSub != r.pricePerSub
                || SignalLib.upstreamHash(s.upstream, s.upstreamBps)
                    != SignalLib.upstreamHash(r.upstream, r.upstreamBps)
        ) revert FieldMismatch();
        SignalLib.checkGeometry(s);

        uint256 ref = r.oraclePriceAtCommit;
        uint256 diff = s.entry > ref ? s.entry - ref : ref - s.entry;
        bool limit = diff * 10_000 > ref * limitThresholdBps;

        r.isLimit = limit;
        r.status = Status.REVEALED;
        _revealed[id] = s;
        emit SignalRevealed(id, s, limit);
    }
}
