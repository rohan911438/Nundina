// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IOutcomeResolver
/// @notice Oracle-backed outcome of each signal.
interface IOutcomeResolver {
    enum Outcome {
        NONE,
        WIN,
        LOSS,
        VOID
    }

    event TouchProven(uint256 indexed id, uint8 level, uint256 price, uint64 ts);
    event Resolved(uint256 indexed id, Outcome outcome, int256 rX100);

    /// @notice Current oracle price for a market, 8 decimals.
    function spotPrice(bytes32 market) external view returns (uint256);
    /// @notice Outcome, R-multiple x100 and finality of a signal.
    function outcomeOf(uint256 id) external view returns (Outcome, int256 rX100, bool final_);
    /// @notice Timestamp of the event that decided the outcome (touch time or expiry).
    function decidedAt(uint256 id) external view returns (uint64);
    /// @notice True while no touch is pending and no outcome is set (safe to sell).
    function isOpen(uint256 id) external view returns (bool);
}
