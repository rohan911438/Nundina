// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IPriceAdapter
/// @notice Push-feed price source normalised to 8 decimals.
interface IPriceAdapter {
    /// @notice Latest price (8 decimals) and its update time. Reverts if stale or unknown market.
    function spotPrice(bytes32 market) external view returns (uint256 price8, uint64 updatedAt);
    /// @notice Price in effect at `ts`, located with a caller-supplied round id hint.
    function priceAt(bytes32 market, uint64 ts, uint80 roundIdHint) external view returns (uint256 price8);
}

/// @title ITouchVerifier
/// @notice Verifies a signed price proof (Supra pull) for a pair.
interface ITouchVerifier {
    /// @notice Verifies `proof` and returns the price (8 decimals) and timestamp (seconds) for `market`.
    function verifyTouch(bytes32 market, bytes calldata proof) external returns (uint256 price8, uint64 ts);
}

/// @dev Chainlink-style aggregator (APRO push feeds use this interface).
interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
    function getRoundData(uint80 roundId)
        external
        view
        returns (uint80 roundId_, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @dev Chainlink-style proxy exposing its current underlying aggregator.
interface IAggregatorProxy {
    function aggregator() external view returns (address);
}

/// @dev Supra pull oracle V2 (confirmed from the verified implementation on HashKey mainnet,
///      SupraOraclePull at 0x76f98f247a3CF0D1293605A868F78662B030c683 behind proxy 0x16f7…C3dD).
interface ISupraOraclePull {
    struct PriceInfo {
        uint256[] pairs;
        uint256[] prices;
        uint256[] timestamp; // milliseconds
        uint256[] decimal;
        uint256[] round;
    }

    function verifyOracleProofV2(bytes calldata _bytesProof) external returns (PriceInfo memory);
}
