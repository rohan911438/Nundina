// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ITouchVerifier, ISupraOraclePull} from "./IPriceAdapter.sol";

/// @title SupraPullAdapter
/// @notice Verifies Supra pull proofs (signed, timestamped prices) for TP/SL touch proofs.
/// @dev See contracts/ORACLES.md for what is confirmed about the Supra interface on HashKey.
contract SupraPullAdapter is ITouchVerifier, AccessControl {
    ISupraOraclePull public immutable supra;
    /// @dev pair id + 1 (0 = not configured), so BTC/USD (pair 0) is storable.
    mapping(bytes32 market => uint256) internal _pairPlusOne;

    error UnknownMarket();
    error PairNotInProof();
    error BadPrice();

    event PairSet(bytes32 indexed market, uint256 pairId);

    constructor(ISupraOraclePull supra_, address admin) {
        supra = supra_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Maps a market to its Supra pair index (timelock).
    function setPair(bytes32 market, uint256 pairId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pairPlusOne[market] = pairId + 1;
        emit PairSet(market, pairId);
    }

    /// @notice Supra pair index for a market; reverts if unset.
    function pairOf(bytes32 market) public view returns (uint256) {
        uint256 p = _pairPlusOne[market];
        if (p == 0) revert UnknownMarket();
        return p - 1;
    }

    /// @inheritdoc ITouchVerifier
    function verifyTouch(bytes32 market, bytes calldata proof) external returns (uint256 price8, uint64 ts) {
        uint256 pair = pairOf(market);
        ISupraOraclePull.PriceInfo memory info = supra.verifyOracleProofV2(proof);
        for (uint256 i; i < info.pairs.length; ++i) {
            if (info.pairs[i] != pair) continue;
            uint256 d = info.decimal[i];
            uint256 p = info.prices[i];
            price8 = d >= 8 ? p / 10 ** (d - 8) : p * 10 ** (8 - d);
            if (price8 == 0) revert BadPrice();
            uint256 t = info.timestamp[i];
            ts = uint64(t > 1e12 ? t / 1000 : t); // Supra timestamps are milliseconds
            return (price8, ts);
        }
        revert PairNotInProof();
    }
}
