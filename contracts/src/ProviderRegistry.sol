// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IProviderRegistry} from "./interfaces/IProviderRegistry.sol";
import {IIdentityRegistry} from "./interfaces/IERC8004.sol";

/// @title ProviderRegistry
/// @notice Links providers (humans or agents) to an ERC-8004 identity and holds their bonds.
/// @dev The admin (a TimelockController) can change the KYC issuer and token allowlist only.
///      Bonds can leave the contract in exactly two ways: `withdrawBond` to the provider itself,
///      or `slash` by the escrow, which only ever sends to the escrow for subscriber refunds.
contract ProviderRegistry is IProviderRegistry, AccessControl, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant KYC_TYPEHASH = keccak256("KycAttestation(address subject,uint64 expiresAt)");
    uint64 public constant WITHDRAW_DELAY = 7 days;

    IIdentityRegistry public immutable identity;
    /// @notice The PerformanceEscrow; set once, never changeable.
    address public escrow;
    address public kycIssuer;
    address public defaultBondToken;
    mapping(address token => bool) public allowedToken;
    mapping(address provider => Provider) internal _providers;
    mapping(uint256 agentId => address provider) public providerOfAgent;

    error NotAgentOwner();
    error AlreadyRegistered();
    error AgentTaken();
    error NotRegistered();
    error TokenNotAllowed();
    error BondNotEmpty();
    error ZeroAmount();
    error InsufficientFreeBond();
    error NoWithdrawRequest();
    error WithdrawDelayActive();
    error BadAttestation();
    error ZeroAddress();
    error NotEscrow();
    error EscrowAlreadySet();
    error SlashOnlyToEscrow();

    modifier onlyEscrow() {
        if (msg.sender != escrow) revert NotEscrow();
        _;
    }

    constructor(IIdentityRegistry identity_, address admin, address[] memory tokens, address kycIssuer_)
        EIP712("NundinaRegistry", "1")
    {
        identity = identity_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        for (uint256 i; i < tokens.length; ++i) {
            allowedToken[tokens[i]] = true;
        }
        if (tokens.length != 0) defaultBondToken = tokens[0];
        kycIssuer = kycIssuer_;
    }

    // ───────────────────────── provider actions ─────────────────────────

    /// @notice Registers the caller as a provider bound to an ERC-8004 agent id it owns.
    /// @param agentId ERC-8004 identity token id owned by the caller.
    /// @param payout Address that receives winning payouts.
    /// @param tgHandleHash keccak256 of the lower-cased Telegram handle (0 if none).
    /// @param practice Practice profiles can only post free signals and never rank.
    function register(uint256 agentId, address payout, bytes32 tgHandleHash, bool practice) external {
        if (identity.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        if (_providers[msg.sender].registered) revert AlreadyRegistered();
        if (providerOfAgent[agentId] != address(0)) revert AgentTaken();
        if (payout == address(0)) revert ZeroAddress();
        Provider storage p = _providers[msg.sender];
        p.agentId = agentId;
        p.payout = payout;
        p.tgHandleHash = tgHandleHash;
        p.bondToken = defaultBondToken;
        p.isPractice = practice;
        p.registered = true;
        providerOfAgent[agentId] = msg.sender;
        emit ProviderRegistered(msg.sender, agentId);
    }

    /// @notice Updates the payout address and Telegram handle hash.
    function updateProfile(address payout, bytes32 tgHandleHash) external {
        Provider storage p = _registered(msg.sender);
        if (payout == address(0)) revert ZeroAddress();
        p.payout = payout;
        p.tgHandleHash = tgHandleHash;
        emit ProviderUpdated(msg.sender, payout, tgHandleHash);
    }

    /// @notice Leaves practice mode (one way: a ranked profile can't go back to practice).
    function leavePractice() external {
        _registered(msg.sender).isPractice = false;
    }

    /// @notice Chooses the bond token (USDT or USDC.e). Only while the bond is empty.
    function setBondToken(address token) external {
        Provider storage p = _registered(msg.sender);
        if (!allowedToken[token]) revert TokenNotAllowed();
        if (p.bondTotal != 0) revert BondNotEmpty();
        p.bondToken = token;
        emit BondTokenSet(msg.sender, token);
    }

    /// @notice Deposits `amount` of the provider's bond token.
    function depositBond(uint256 amount) external nonReentrant {
        Provider storage p = _registered(msg.sender);
        if (amount == 0) revert ZeroAmount();
        if (!allowedToken[p.bondToken]) revert TokenNotAllowed();
        p.bondTotal += amount;
        IERC20(p.bondToken).safeTransferFrom(msg.sender, address(this), amount);
        emit BondDeposited(msg.sender, p.bondToken, amount);
    }

    /// @notice Starts the 7-day withdrawal delay for `amount` of free bond.
    function requestBondWithdraw(uint256 amount) external {
        Provider storage p = _registered(msg.sender);
        if (amount == 0) revert ZeroAmount();
        if (amount > p.bondTotal - p.bondLocked) revert InsufficientFreeBond();
        p.withdrawAmount = amount;
        p.withdrawRequestedAt = uint64(block.timestamp);
        emit BondWithdrawRequested(msg.sender, amount, uint64(block.timestamp) + WITHDRAW_DELAY);
    }

    /// @notice Withdraws the requested amount after the delay, if it is still unlocked.
    function withdrawBond() external nonReentrant {
        Provider storage p = _registered(msg.sender);
        uint256 amount = p.withdrawAmount;
        if (amount == 0) revert NoWithdrawRequest();
        if (block.timestamp < p.withdrawRequestedAt + WITHDRAW_DELAY) revert WithdrawDelayActive();
        if (amount > p.bondTotal - p.bondLocked) revert InsufficientFreeBond();
        p.withdrawAmount = 0;
        p.withdrawRequestedAt = 0;
        p.bondTotal -= amount;
        IERC20(p.bondToken).safeTransfer(msg.sender, amount);
        emit BondWithdrawn(msg.sender, amount);
    }

    /// @notice Stores a KYC badge from an HSP attestation signed by the allowlisted issuer.
    /// @param att abi.encode(address subject, uint64 expiresAt)
    /// @param issuerSig EIP-712 signature over KycAttestation(subject, expiresAt)
    function setKycAttestation(bytes calldata att, bytes calldata issuerSig) external {
        Provider storage p = _registered(msg.sender);
        (address subject, uint64 expiresAt) = abi.decode(att, (address, uint64));
        if (subject != msg.sender || expiresAt <= block.timestamp) revert BadAttestation();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(KYC_TYPEHASH, subject, expiresAt)));
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, issuerSig);
        if (err != ECDSA.RecoverError.NoError || signer != kycIssuer || signer == address(0)) revert BadAttestation();
        p.kycUntil = expiresAt;
        emit KycSet(msg.sender, expiresAt);
    }

    // ───────────────────────── escrow hooks ─────────────────────────

    /// @notice Reserves bond as collateral for one subscriber of an open signal.
    function lockBond(address provider, uint256 amount) external onlyEscrow {
        Provider storage p = _registered(provider);
        if (amount > p.bondTotal - p.bondLocked) revert InsufficientFreeBond();
        p.bondLocked += amount;
        emit BondLocked(provider, amount);
    }

    /// @notice Releases previously locked bond.
    function unlockBond(address provider, uint256 amount) external onlyEscrow {
        Provider storage p = _registered(provider);
        p.bondLocked -= amount;
        emit BondUnlocked(provider, amount);
    }

    /// @notice Slashes locked bond to the escrow (`to` must be the caller), which forwards it to subscribers.
    function slash(address provider, address to, uint256 amount) external onlyEscrow nonReentrant {
        if (to != msg.sender) revert SlashOnlyToEscrow();
        Provider storage p = _registered(provider);
        p.bondLocked -= amount;
        p.bondTotal -= amount;
        IERC20(p.bondToken).safeTransfer(to, amount);
        emit BondSlashed(provider, to, amount);
    }

    // ───────────────────────── admin (timelock) ─────────────────────────

    /// @notice Wires the escrow once. There is no way to change it afterwards.
    function setEscrow(address escrow_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (escrow != address(0)) revert EscrowAlreadySet();
        if (escrow_ == address(0)) revert ZeroAddress();
        escrow = escrow_;
    }

    /// @notice Sets the HSP KYC attestation issuer key.
    function setKycIssuer(address issuer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        kycIssuer = issuer;
    }

    /// @notice Allows or disallows a bond token for new deposits.
    function setAllowedToken(address token, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        allowedToken[token] = allowed;
    }

    /// @notice Sets the token new providers start with.
    function setDefaultBondToken(address token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!allowedToken[token]) revert TokenNotAllowed();
        defaultBondToken = token;
    }

    // ───────────────────────── views ─────────────────────────

    /// @notice Full provider record.
    function getProvider(address provider) external view returns (Provider memory) {
        return _providers[provider];
    }

    /// @inheritdoc IProviderRegistry
    function isRegistered(address provider) external view returns (bool) {
        return _providers[provider].registered;
    }

    /// @inheritdoc IProviderRegistry
    function isPractice(address provider) external view returns (bool) {
        return _providers[provider].isPractice;
    }

    /// @inheritdoc IProviderRegistry
    function payoutOf(address provider) external view returns (address) {
        return _providers[provider].payout;
    }

    /// @inheritdoc IProviderRegistry
    function agentIdOf(address provider) external view returns (uint256) {
        return _providers[provider].agentId;
    }

    /// @inheritdoc IProviderRegistry
    function bondTokenOf(address provider) external view returns (address) {
        return _providers[provider].bondToken;
    }

    /// @notice True while the provider holds a non-expired KYC attestation.
    function isKycVerified(address provider) external view returns (bool) {
        return _providers[provider].kycUntil > block.timestamp;
    }

    /// @inheritdoc IProviderRegistry
    function freeBond(address provider) public view returns (uint256) {
        Provider storage p = _providers[provider];
        return p.bondTotal - p.bondLocked;
    }

    /// @inheritdoc IProviderRegistry
    function capacity(address provider, uint256 slashPerSub) external view returns (uint256) {
        if (slashPerSub == 0) return type(uint256).max;
        return freeBond(provider) / slashPerSub;
    }

    function _registered(address provider) internal view returns (Provider storage p) {
        p = _providers[provider];
        if (!p.registered) revert NotRegistered();
    }
}
