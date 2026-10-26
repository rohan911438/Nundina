// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IPriceAdapter, ITouchVerifier} from "./IPriceAdapter.sol";

/// @title MockPriceAdapter
/// @notice TESTS AND TESTNET ONLY. Prices are pushed by an updater; touch "proofs" are
///         abi.encode(market, price8, ts) and must match a price the updater posted.
contract MockPriceAdapter is IPriceAdapter, ITouchVerifier, AccessControl {
    bytes32 public constant UPDATER_ROLE = keccak256("UPDATER_ROLE");

    struct Round {
        uint256 price8;
        uint64 ts;
    }

    mapping(bytes32 market => Round[]) internal _rounds;
    mapping(bytes32 => bool) public postedTouch;
    uint64 public maxStaleness = 2 hours;
    /// @notice Tests only: accept any well-formed proof.
    bool public acceptAll;

    error UnknownMarket();
    error StalePrice();
    error BadRoundHint();
    error UnknownProof();

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(UPDATER_ROLE, admin);
    }

    /// @notice Pushes a new round for a market.
    function push(bytes32 market, uint256 price8, uint64 ts) external onlyRole(UPDATER_ROLE) {
        _rounds[market].push(Round(price8, ts));
    }

    /// @notice Posts a touch that can later be "proven" with abi.encode(market, price8, ts).
    function postTouch(bytes32 market, uint256 price8, uint64 ts) external onlyRole(UPDATER_ROLE) {
        postedTouch[keccak256(abi.encode(market, price8, ts))] = true;
    }

    /// @notice Sets the staleness limit for spot reads.
    function setMaxStaleness(uint64 s) external onlyRole(DEFAULT_ADMIN_ROLE) {
        maxStaleness = s;
    }

    /// @notice Tests only: accept any proof.
    function setAcceptAll(bool v) external onlyRole(DEFAULT_ADMIN_ROLE) {
        acceptAll = v;
    }

    /// @notice Number of rounds for a market.
    function roundCount(bytes32 market) external view returns (uint256) {
        return _rounds[market].length;
    }

    /// @inheritdoc IPriceAdapter
    function spotPrice(bytes32 market) external view returns (uint256, uint64) {
        Round[] storage r = _rounds[market];
        if (r.length == 0) revert UnknownMarket();
        Round memory last = r[r.length - 1];
        if (block.timestamp > last.ts + maxStaleness) revert StalePrice();
        return (last.price8, last.ts);
    }

    /// @inheritdoc IPriceAdapter
    function priceAt(bytes32 market, uint64 ts, uint80 roundIdHint) external view returns (uint256) {
        Round[] storage r = _rounds[market];
        if (roundIdHint >= r.length) revert BadRoundHint();
        Round memory a = r[roundIdHint];
        if (a.ts > ts) revert BadRoundHint();
        if (roundIdHint + 1 < r.length && r[roundIdHint + 1].ts <= ts) revert BadRoundHint();
        return a.price8;
    }

    /// @inheritdoc ITouchVerifier
    function verifyTouch(bytes32 market, bytes calldata proof) external view returns (uint256, uint64) {
        (bytes32 m, uint256 p, uint64 ts) = abi.decode(proof, (bytes32, uint256, uint64));
        if (m != market || (!acceptAll && !postedTouch[keccak256(proof)])) revert UnknownProof();
        return (p, ts);
    }
}
