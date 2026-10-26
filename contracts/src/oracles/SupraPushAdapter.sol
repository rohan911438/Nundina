// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IPriceAdapter} from "./IPriceAdapter.sol";

/// @dev Supra push storage (SupraSValueFeed) on HashKey: 0x58e1…9d57. Readable by any contract.
interface ISupraSValueFeed {
    struct PriceFeed {
        uint256 round;
        uint256 decimals;
        uint256 time; // milliseconds
        uint256 price;
    }

    function getSvalue(uint256 pairIndex) external view returns (PriceFeed memory);
}

/// @title SupraPushAdapter
/// @notice Reads Supra push-storage prices, normalised to 8 decimals. Only the latest value is
///         available, so `priceAt(ts)` works only while the latest update is at or before `ts`.
contract SupraPushAdapter is IPriceAdapter, AccessControl {
    ISupraSValueFeed public immutable feed;
    uint64 public maxStaleness;
    mapping(bytes32 market => uint256) internal _pairPlusOne;

    error UnknownMarket();
    error StalePrice();
    error BadPrice();
    error NoHistory();

    event PairSet(bytes32 indexed market, uint256 pairId);

    constructor(ISupraSValueFeed feed_, address admin, uint64 maxStaleness_) {
        feed = feed_;
        maxStaleness = maxStaleness_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Maps a market to its Supra pair index (timelock).
    function setPair(bytes32 market, uint256 pairId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pairPlusOne[market] = pairId + 1;
        emit PairSet(market, pairId);
    }

    /// @notice Sets the staleness limit (timelock).
    function setMaxStaleness(uint64 s) external onlyRole(DEFAULT_ADMIN_ROLE) {
        maxStaleness = s;
    }

    /// @inheritdoc IPriceAdapter
    function spotPrice(bytes32 market) external view returns (uint256 price8, uint64 updatedAt) {
        (price8, updatedAt) = _read(market);
        if (block.timestamp > updatedAt + maxStaleness) revert StalePrice();
    }

    /// @inheritdoc IPriceAdapter
    function priceAt(bytes32 market, uint64 ts, uint80) external view returns (uint256 price8) {
        uint64 updatedAt;
        (price8, updatedAt) = _read(market);
        if (updatedAt > ts) revert NoHistory();
        if (ts > updatedAt + maxStaleness) revert StalePrice();
    }

    function _read(bytes32 market) internal view returns (uint256 price8, uint64 updatedAt) {
        uint256 p = _pairPlusOne[market];
        if (p == 0) revert UnknownMarket();
        ISupraSValueFeed.PriceFeed memory f = feed.getSvalue(p - 1);
        if (f.price == 0) revert BadPrice();
        price8 = f.decimals >= 8 ? f.price / 10 ** (f.decimals - 8) : f.price * 10 ** (8 - f.decimals);
        updatedAt = uint64(f.time > 1e12 ? f.time / 1000 : f.time);
    }
}
