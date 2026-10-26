// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ICreditVerifier
/// @notice Decides whether a payment credit (or an uncredited-transfer recovery) is authorised.
///         Today: our API's credit signer after HSP `verify()` ACCEPT. Later: on-chain HSP receipts.
interface ICreditVerifier {
    function verifyCredit(
        uint256 signalId,
        address subscriber,
        address token,
        uint256 amount,
        bytes32 receiptHash,
        bytes32 txHash,
        bytes calldata sig
    ) external view returns (bool);

    function verifyRecovery(address token, address payer, uint256 amount, bytes32 txHash, bytes calldata sig)
        external
        view
        returns (bool);
}

/// @title IRevenueRouter
interface IRevenueRouter {
    event Routed(uint256 indexed id, uint256 indexed upstreamId, address to, uint256 amount);

    /// @notice Splits a winning payout across upstream providers. Only the escrow.
    function route(uint256 id, address token, uint256 amount)
        external
        returns (address[] memory to, uint256[] memory amounts);
}

/// @title IPerformanceEscrow
interface IPerformanceEscrow {
    enum PotState {
        OPEN,
        SETTLED,
        REFUNDED
    }

    event PaymentCredited(
        uint256 indexed id, address indexed sub, uint256 amount, bytes32 receiptHash, address token, bytes32 txHash
    );
    event Settled(uint256 indexed id, uint8 outcome, uint256 payout, uint256 refunds, uint256 slashed);
    event Refunded(uint256 indexed id, address indexed sub, uint256 amount);
    event Slashed(uint256 indexed id, address indexed sub, address token, uint256 amount);
    event Claimable(address indexed user, address indexed token, uint256 amount, uint256 indexed id);
    event Withdrawn(address indexed user, address indexed token, uint256 amount);
    event Recovered(address indexed payer, address indexed token, uint256 amount, bytes32 txHash);
    event FeedbackWritten(uint256 indexed id, uint256 indexed agentId, uint8 score);
    event FeedbackFailed(uint256 indexed id, uint256 indexed agentId);
}
