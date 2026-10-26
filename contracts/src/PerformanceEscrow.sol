// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPerformanceEscrow, ICreditVerifier, IRevenueRouter} from "./interfaces/IPerformanceEscrow.sol";
import {ISignalBook} from "./interfaces/ISignalBook.sol";
import {IOutcomeResolver} from "./interfaces/IOutcomeResolver.sol";
import {IProviderRegistry} from "./interfaces/IProviderRegistry.sol";
import {IReputationRegistry} from "./interfaces/IERC8004.sol";

/// @dev EIP-3009 receive (USDC.e on HashKey).
interface IERC3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// @title PerformanceEscrow
/// @notice Holds subscriber payments per signal. WIN pays the provider (minus fee); LOSS refunds every
///         subscriber plus a slice of the provider's bond; VOID refunds without slashing. Payouts are
///         pull-based (`withdraw`), so settlement gas is bounded and no transfer can block it.
/// @dev Accounting: `liabilities[token]` is everything the escrow owes (open payments + claimable).
///      A credit needs `balanceOf >= liabilities + amount`, so credits can never exceed real tokens.
///      Admin (timelock) powers: fee bps (<= 20%), treasury, credit verifier, token allowlist, pausing
///      new credits. Pausing never blocks settle, claimRefund, withdraw or recoverUncredited.
contract PerformanceEscrow is IPerformanceEscrow, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_FEE_BPS = 2000;
    uint64 public constant MAX_SETTLE_DELAY = 24 hours;
    uint256 public constant MAX_SUBSCRIBERS = 200;
    bytes32 internal constant TAG1 = "nundina";

    struct Pot {
        address token;
        PotState state;
        uint32 subs;
        uint256 totalPaid;
        uint256 slashPerSub;
        bytes32 receiptsAcc;
    }

    ISignalBook public immutable book;
    IOutcomeResolver public immutable resolver;
    IProviderRegistry public immutable registry;
    IRevenueRouter public immutable router;
    IReputationRegistry public immutable reputation;
    address public immutable usdcE;

    address public treasury;
    ICreditVerifier public creditVerifier;
    uint256 public feeBps = 1000;
    mapping(address token => bool) public allowedToken;

    mapping(uint256 id => Pot) internal _pots;
    mapping(uint256 id => address[]) internal _subscribers;
    mapping(uint256 id => mapping(address sub => uint256)) public paid;
    mapping(uint256 id => mapping(address sub => uint64)) public paidAt;
    mapping(bytes32 receiptHash => bool) public usedReceipt;
    mapping(bytes32 txHash => bool) public usedTx;

    mapping(address token => uint256) public liabilities;
    mapping(address token => uint256) public credited;
    mapping(address token => uint256) public slashedIn;
    mapping(address token => uint256) public totalOut;
    mapping(address user => mapping(address token => uint256)) public claimable;

    error TokenNotAllowed();
    error BadCredit();
    error ReceiptUsed();
    error TxUsed();
    error SignalNotOpen();
    error SignalExpired();
    error FreeSignal();
    error WrongAmount();
    error WrongToken();
    error AlreadyPaid();
    error TooManySubscribers();
    error InsufficientFunds();
    error NotFinal();
    error NotOpen();
    error TooEarly();
    error BadNonce();
    error FeeTooHigh();
    error ZeroAddress();
    error NothingToWithdraw();

    constructor(
        ISignalBook book_,
        IOutcomeResolver resolver_,
        IProviderRegistry registry_,
        IRevenueRouter router_,
        IReputationRegistry reputation_,
        ICreditVerifier verifier_,
        address treasury_,
        address admin,
        address[] memory tokens,
        address usdcE_
    ) {
        book = book_;
        resolver = resolver_;
        registry = registry_;
        router = router_;
        reputation = reputation_;
        creditVerifier = verifier_;
        treasury = treasury_;
        usdcE = usdcE_;
        for (uint256 i; i < tokens.length; ++i) {
            allowedToken[tokens[i]] = true;
        }
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ───────────────────────── funding ─────────────────────────

    /// @notice Credits an HSP-verified payment that already reached this contract.
    /// @param id Signal id.
    /// @param sub Subscriber (payer) address.
    /// @param token USDT or USDC.e.
    /// @param amount Must equal the signal's price.
    /// @param receiptHash Hash of the HSP receipt (single use).
    /// @param txHash On-chain transfer hash (single use; 0 if not applicable).
    /// @param creditorSig Authorisation from the credit verifier (API credit signer).
    function creditPayment(
        uint256 id,
        address sub,
        address token,
        uint256 amount,
        bytes32 receiptHash,
        bytes32 txHash,
        bytes calldata creditorSig
    ) external nonReentrant whenNotPaused {
        if (!creditVerifier.verifyCredit(id, sub, token, amount, receiptHash, txHash, creditorSig)) {
            revert BadCredit();
        }
        if (txHash != bytes32(0)) {
            if (usedTx[txHash]) revert TxUsed();
            usedTx[txHash] = true;
        }
        _credit(id, sub, token, amount, receiptHash, txHash);
    }

    /// @notice EIP-3009 fast path (USDC.e): pulls the authorised transfer and credits it atomically.
    /// @dev The authorisation nonce must be keccak256(abi.encode(id, from)), binding it to this purchase.
    function fundWithAuthorization(
        uint256 id,
        address from,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused {
        if (nonce != keccak256(abi.encode(id, from))) revert BadNonce();
        IERC3009(usdcE).receiveWithAuthorization(from, address(this), value, validAfter, validBefore, nonce, v, r, s);
        _credit(id, from, usdcE, value, keccak256(abi.encode("eip3009", nonce)), bytes32(0));
    }

    /// @notice Returns a transfer that reached the escrow but was never credited (e.g. HSP REJECT)
    ///         to its original payer. Authorised by the credit verifier; cannot touch owed funds.
    function recoverUncredited(address token, address payer, uint256 amount, bytes32 txHash, bytes calldata sig)
        external
        nonReentrant
    {
        if (!creditVerifier.verifyRecovery(token, payer, amount, txHash, sig)) revert BadCredit();
        if (txHash == bytes32(0) || usedTx[txHash]) revert TxUsed();
        if (IERC20(token).balanceOf(address(this)) < liabilities[token] + amount) revert InsufficientFunds();
        usedTx[txHash] = true;
        totalOut[token] += amount;
        IERC20(token).safeTransfer(payer, amount);
        emit Recovered(payer, token, amount, txHash);
    }

    // ───────────────────────── settlement ─────────────────────────

    /// @notice Settles a signal once its outcome is final. Anyone may call.
    function settle(uint256 id) external nonReentrant {
        Pot storage pot = _pots[id];
        if (pot.state != PotState.OPEN) revert NotOpen();
        (IOutcomeResolver.Outcome o,, bool fin) = resolver.outcomeOf(id);
        if (!fin || o == IOutcomeResolver.Outcome.NONE) revert NotFinal();
        pot.state = PotState.SETTLED;

        address provider = book.providerOf(id);
        address token = pot.token;
        uint256 total = pot.totalPaid;
        uint256 payout;
        uint256 refunds;
        uint256 slashed;

        if (o == IOutcomeResolver.Outcome.WIN) {
            if (total != 0) {
                uint256 fee = total * feeBps / 10_000;
                _addClaim(treasury, token, fee, id);
                payout = total - fee;
                (uint256[] memory up,) = book.upstreamOf(id);
                if (up.length != 0) {
                    (address[] memory to, uint256[] memory amts) = router.route(id, token, payout);
                    for (uint256 i; i < to.length; ++i) {
                        _addClaim(to[i], token, amts[i], id);
                    }
                } else {
                    _addClaim(registry.payoutOf(provider), token, payout, id);
                }
            }
            _unlock(provider, pot.slashPerSub * pot.subs);
        } else if (o == IOutcomeResolver.Outcome.LOSS) {
            (refunds, slashed) = _refundAll(id, pot, provider, resolver.decidedAt(id));
        } else {
            (refunds,) = _refundAll(id, pot, provider, 0);
        }

        if (o != IOutcomeResolver.Outcome.VOID) _feedback(id, provider, o == IOutcomeResolver.Outcome.WIN, pot);
        emit Settled(id, uint8(o), payout, refunds, slashed);
    }

    /// @notice Refunds every subscriber (no slash) if a signal was not settled within 24h of expiry.
    ///         Never pausable: funds can never get stuck.
    function claimRefund(uint256 id) external nonReentrant {
        Pot storage pot = _pots[id];
        if (pot.state != PotState.OPEN) revert NotOpen();
        ISignalBook.Record memory r = book.getSignal(id);
        if (r.status == ISignalBook.Status.NONE) revert NotOpen();
        if (block.timestamp <= uint256(r.validUntil) + MAX_SETTLE_DELAY) revert TooEarly();
        pot.state = PotState.REFUNDED;
        (uint256 refunds,) = _refundAll(id, pot, r.provider, 0);
        emit Settled(id, 0, 0, refunds, 0);
    }

    /// @notice Withdraws the caller's claimable balance of `token`.
    function withdraw(address token) external nonReentrant {
        _withdraw(msg.sender, token);
    }

    /// @notice Pushes `user`'s claimable balance to `user` (anyone may trigger; funds only go to the user).
    function withdrawFor(address user, address token) external nonReentrant {
        _withdraw(user, token);
    }

    // ───────────────────────── admin (timelock) ─────────────────────────

    /// @notice Sets the protocol fee on winning payments (max 20%).
    function setFeeBps(uint256 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bps > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = bps;
    }

    /// @notice Sets where future protocol fees accrue.
    function setTreasury(address t) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (t == address(0)) revert ZeroAddress();
        treasury = t;
    }

    /// @notice Replaces the credit verifier (e.g. with an on-chain HSP receipt verifier).
    function setCreditVerifier(ICreditVerifier v) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(v) == address(0)) revert ZeroAddress();
        creditVerifier = v;
    }

    /// @notice Allows or disallows a payment token for new credits.
    function setAllowedToken(address token, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        allowedToken[token] = allowed;
    }

    /// @notice Pauses new credits only.
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /// @notice Resumes credits.
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ───────────────────────── views ─────────────────────────

    /// @notice Pot summary for a signal.
    function potOf(uint256 id) external view returns (Pot memory) {
        return _pots[id];
    }

    /// @notice Subscribers of a signal.
    function subscribersOf(uint256 id) external view returns (address[] memory) {
        return _subscribers[id];
    }

    /// @notice Cumulative tokens received for payments (excludes slashed bond inflows).
    function received(address token) public view returns (uint256) {
        return IERC20(token).balanceOf(address(this)) + totalOut[token] - slashedIn[token];
    }

    // ───────────────────────── internals ─────────────────────────

    function _credit(uint256 id, address sub, address token, uint256 amount, bytes32 receiptHash, bytes32 txHash)
        internal
    {
        if (!allowedToken[token]) revert TokenNotAllowed();
        if (usedReceipt[receiptHash]) revert ReceiptUsed();
        usedReceipt[receiptHash] = true;

        ISignalBook.Record memory r = book.getSignal(id);
        if (r.status != ISignalBook.Status.COMMITTED && r.status != ISignalBook.Status.REVEALED) {
            revert SignalNotOpen();
        }
        if (block.timestamp >= r.validUntil) revert SignalExpired();
        if (r.pricePerSub == 0) revert FreeSignal();
        if (amount != r.pricePerSub) revert WrongAmount();
        if (!resolver.isOpen(id)) revert SignalNotOpen();

        Pot storage pot = _pots[id];
        if (pot.state != PotState.OPEN) revert SignalNotOpen();
        if (pot.token == address(0)) {
            pot.token = token;
            pot.slashPerSub = r.pricePerSub; // rule: slash >= price
        } else if (pot.token != token) {
            revert WrongToken();
        }
        if (paid[id][sub] != 0) revert AlreadyPaid();
        if (pot.subs >= MAX_SUBSCRIBERS) revert TooManySubscribers();
        if (IERC20(token).balanceOf(address(this)) < liabilities[token] + amount) revert InsufficientFunds();

        registry.lockBond(r.provider, pot.slashPerSub); // reverts when capacity is full

        liabilities[token] += amount;
        credited[token] += amount;
        pot.totalPaid += amount;
        pot.subs += 1;
        pot.receiptsAcc = keccak256(abi.encode(pot.receiptsAcc, receiptHash));
        paid[id][sub] = amount;
        paidAt[id][sub] = uint64(block.timestamp);
        _subscribers[id].push(sub);
        emit PaymentCredited(id, sub, amount, receiptHash, token, txHash);
    }

    /// @dev Refunds everyone. If `decidedAt != 0`, subscribers who paid before it also get a bond slice.
    function _refundAll(uint256 id, Pot storage pot, address provider, uint64 decidedAt)
        internal
        returns (uint256 refunds, uint256 slashed)
    {
        address[] storage subs = _subscribers[id];
        uint256 n = subs.length;
        uint256 eligible;
        if (decidedAt != 0) {
            for (uint256 i; i < n; ++i) {
                if (paidAt[id][subs[i]] < decidedAt) ++eligible;
            }
        }
        address bondToken;
        if (eligible != 0) {
            slashed = pot.slashPerSub * eligible;
            bondToken = registry.bondTokenOf(provider);
            registry.slash(provider, address(this), slashed);
            slashedIn[bondToken] += slashed;
            liabilities[bondToken] += slashed;
        }
        uint256 unlocked = pot.slashPerSub * (pot.subs - eligible);
        _unlock(provider, unlocked);

        for (uint256 i; i < n; ++i) {
            address sub = subs[i];
            uint256 amt = paid[id][sub];
            refunds += amt;
            // move from "open payment" to "claimable": liabilities unchanged
            claimable[sub][pot.token] += amt;
            emit Claimable(sub, pot.token, amt, id);
            emit Refunded(id, sub, amt);
            if (decidedAt != 0 && paidAt[id][sub] < decidedAt) {
                claimable[sub][bondToken] += pot.slashPerSub;
                emit Claimable(sub, bondToken, pot.slashPerSub, id);
                emit Slashed(id, sub, bondToken, pot.slashPerSub);
            }
        }
    }

    function _addClaim(address user, address token, uint256 amount, uint256 id) internal {
        if (amount == 0) return;
        claimable[user][token] += amount;
        emit Claimable(user, token, amount, id);
    }

    function _unlock(address provider, uint256 amount) internal {
        if (amount != 0) registry.unlockBond(provider, amount);
    }

    function _withdraw(address user, address token) internal {
        uint256 amt = claimable[user][token];
        if (amt == 0) revert NothingToWithdraw();
        claimable[user][token] = 0;
        liabilities[token] -= amt;
        totalOut[token] += amt;
        IERC20(token).safeTransfer(user, amt);
        emit Withdrawn(user, token, amt);
    }

    function _feedback(uint256 id, address provider, bool win, Pot storage pot) internal {
        uint256 agentId = registry.agentIdOf(provider);
        if (agentId == 0) return;
        uint8 score = win ? 100 : 0;
        try reputation.giveFeedback(agentId, score, TAG1, win ? bytes32("WIN") : bytes32("LOSS"), "", pot.receiptsAcc) {
            emit FeedbackWritten(id, agentId, score);
        } catch {
            emit FeedbackFailed(id, agentId);
        }
    }
}
