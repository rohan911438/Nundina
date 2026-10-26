// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IOutcomeResolver} from "../../src/interfaces/IOutcomeResolver.sol";

/// @dev Test-only resolver: settable spot price and outcomes.
contract MockResolver is IOutcomeResolver {
    mapping(bytes32 => uint256) public price;
    mapping(uint256 => Outcome) public outcome;
    mapping(uint256 => int256) public r;
    mapping(uint256 => bool) public fin;
    mapping(uint256 => uint64) public decided;

    function setPrice(bytes32 m, uint256 p) external {
        price[m] = p;
    }

    function setOutcome(uint256 id, Outcome o, int256 rX100, bool f, uint64 at) external {
        outcome[id] = o;
        r[id] = rX100;
        fin[id] = f;
        decided[id] = at;
    }

    function spotPrice(bytes32 m) external view returns (uint256) {
        require(price[m] != 0, "no market");
        return price[m];
    }

    function outcomeOf(uint256 id) external view returns (Outcome, int256, bool) {
        return (outcome[id], r[id], fin[id]);
    }

    function decidedAt(uint256 id) external view returns (uint64) {
        return decided[id];
    }

    function isOpen(uint256 id) external view returns (bool) {
        return outcome[id] == Outcome.NONE;
    }
}
