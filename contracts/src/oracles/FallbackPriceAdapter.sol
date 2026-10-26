// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPriceAdapter} from "./IPriceAdapter.sol";

/// @title FallbackPriceAdapter
/// @notice Reads the primary push feed (APRO) and falls back to the secondary (Supra push storage)
///         when the primary reverts, e.g. because the reader is not on APRO's access allowlist yet
///         or the round is stale.
contract FallbackPriceAdapter is IPriceAdapter {
    IPriceAdapter public immutable primary;
    IPriceAdapter public immutable secondary;

    constructor(IPriceAdapter primary_, IPriceAdapter secondary_) {
        primary = primary_;
        secondary = secondary_;
    }

    /// @inheritdoc IPriceAdapter
    function spotPrice(bytes32 market) external view returns (uint256, uint64) {
        try primary.spotPrice(market) returns (uint256 p, uint64 t) {
            return (p, t);
        } catch {
            return secondary.spotPrice(market);
        }
    }

    /// @inheritdoc IPriceAdapter
    function priceAt(bytes32 market, uint64 ts, uint80 roundIdHint) external view returns (uint256) {
        try primary.priceAt(market, ts, roundIdHint) returns (uint256 p) {
            return p;
        } catch {
            return secondary.priceAt(market, ts, roundIdHint);
        }
    }
}
