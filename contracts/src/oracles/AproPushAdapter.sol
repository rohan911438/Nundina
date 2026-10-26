// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IPriceAdapter, IAggregatorV3} from "./IPriceAdapter.sol";

/// @title AproPushAdapter
/// @notice Reads APRO push feeds (Chainlink-style) and normalises to 8 decimals.
/// @dev See contracts/ORACLES.md for the APRO behaviour observed on HashKey mainnet.
contract AproPushAdapter is IPriceAdapter, AccessControl {
    struct Feed {
        address feed;
        uint64 maxStaleness;
    }

    mapping(bytes32 market => Feed) public feeds;

    error UnknownMarket();
    error StalePrice();
    error BadPrice();
    error BadRoundHint();
    error NoHistory();

    event FeedSet(bytes32 indexed market, address feed, uint64 maxStaleness);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Sets the feed and staleness limit for a market (timelock).
    function setFeed(bytes32 market, address feed, uint64 maxStaleness) external onlyRole(DEFAULT_ADMIN_ROLE) {
        feeds[market] = Feed(feed, maxStaleness);
        emit FeedSet(market, feed, maxStaleness);
    }

    /// @inheritdoc IPriceAdapter
    function spotPrice(bytes32 market) external view returns (uint256 price8, uint64 updatedAt) {
        Feed memory f = _feed(market);
        (, int256 answer,, uint256 upd,) = IAggregatorV3(f.feed).latestRoundData();
        if (answer <= 0) revert BadPrice();
        if (block.timestamp > upd + f.maxStaleness) revert StalePrice();
        return (_norm(f.feed, answer), uint64(upd));
    }

    /// @inheritdoc IPriceAdapter
    /// @dev If the latest round was published at or before `ts` it is the round in effect at `ts`.
    ///      Otherwise history is needed: `roundIdHint` must be a feed round with updatedAt <= ts whose
    ///      next round is newer than ts. NOTE: on HashKey the APRO proxy serves only the latest round
    ///      and the underlying aggregator is access-controlled, so history is usually unavailable and
    ///      the keeper must resolve promptly (or use a Supra proof, see OutcomeResolver).
    function priceAt(bytes32 market, uint64 ts, uint80 roundIdHint) external view returns (uint256 price8) {
        Feed memory f = _feed(market);
        (, int256 answer,, uint256 upd,) = IAggregatorV3(f.feed).latestRoundData();
        if (upd > ts) {
            try IAggregatorV3(f.feed).getRoundData(roundIdHint) returns (uint80, int256 a, uint256, uint256 u, uint80) {
                (answer, upd) = (a, u);
            } catch {
                revert NoHistory();
            }
            if (upd == 0 || upd > ts) revert BadRoundHint();
            try IAggregatorV3(f.feed).getRoundData(roundIdHint + 1) returns (
                uint80, int256, uint256, uint256 nextUpd, uint80
            ) {
                if (nextUpd != 0 && nextUpd <= ts) revert BadRoundHint();
            } catch {}
        }
        if (answer <= 0) revert BadPrice();
        if (ts > upd + f.maxStaleness) revert StalePrice();
        return _norm(f.feed, answer);
    }

    function _feed(bytes32 market) internal view returns (Feed memory f) {
        f = feeds[market];
        if (f.feed == address(0)) revert UnknownMarket();
    }

    function _norm(address feed, int256 answer) internal view returns (uint256) {
        uint8 d = IAggregatorV3(feed).decimals();
        uint256 a = uint256(answer);
        if (d == 8) return a;
        return d > 8 ? a / 10 ** (d - 8) : a * 10 ** (8 - d);
    }
}
