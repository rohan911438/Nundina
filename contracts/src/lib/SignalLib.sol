// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title SignalLib
/// @notice The Nundina Signal struct, its EIP-712 struct hash and geometry checks.
/// @dev Must stay byte-for-byte compatible with `packages/shared/src/eip712.ts`.
library SignalLib {
    uint8 internal constant LONG = 0;
    uint8 internal constant SHORT = 1;

    struct Signal {
        address provider;
        bytes32 market;
        uint8 side;
        uint256 entry; // 8 decimals
        uint256 takeProfit; // 8 decimals
        uint256 stopLoss; // 8 decimals
        uint64 validUntil;
        uint256 pricePerSub; // 6 decimals
        uint256[] upstream;
        uint16[] upstreamBps;
        bytes32 salt;
    }

    bytes32 internal constant SIGNAL_TYPEHASH = keccak256(
        "Signal(address provider,bytes32 market,uint8 side,uint256 entry,uint256 takeProfit,uint256 stopLoss,uint64 validUntil,uint256 pricePerSub,uint256[] upstream,uint16[] upstreamBps,bytes32 salt)"
    );

    error BadGeometry();
    error BadRiskReward();

    /// @notice EIP-712 struct hash of a signal (arrays hashed as concatenated 32-byte words).
    function structHash(Signal memory s) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SIGNAL_TYPEHASH,
                s.provider,
                s.market,
                s.side,
                s.entry,
                s.takeProfit,
                s.stopLoss,
                s.validUntil,
                s.pricePerSub,
                keccak256(abi.encodePacked(s.upstream)),
                keccak256(abi.encodePacked(s.upstreamBps)),
                s.salt
            )
        );
    }

    /// @notice Hash of the upstream arrays, used to compare a revealed signal with its commit.
    function upstreamHash(uint256[] memory upstream, uint16[] memory bps) internal pure returns (bytes32) {
        return keccak256(abi.encode(upstream, bps));
    }

    /// @notice Reverts unless TP/SL sit on the right sides of entry and reward >= risk.
    function checkGeometry(Signal memory s) internal pure {
        if (s.side == LONG) {
            if (!(s.stopLoss < s.entry && s.entry < s.takeProfit)) revert BadGeometry();
            if (s.takeProfit - s.entry < s.entry - s.stopLoss) revert BadRiskReward();
        } else if (s.side == SHORT) {
            if (!(s.takeProfit < s.entry && s.entry < s.stopLoss)) revert BadGeometry();
            if (s.entry - s.takeProfit < s.stopLoss - s.entry) revert BadRiskReward();
        } else {
            revert BadGeometry();
        }
    }

    /// @notice Distance between entry and stop loss (one R), always positive for valid signals.
    function risk(Signal memory s) internal pure returns (uint256) {
        return s.side == LONG ? s.entry - s.stopLoss : s.stopLoss - s.entry;
    }

    /// @notice Signed move of `price` from entry in the signal's direction.
    function move(Signal memory s, uint256 price) internal pure returns (int256) {
        return s.side == LONG ? int256(price) - int256(s.entry) : int256(s.entry) - int256(price);
    }
}
