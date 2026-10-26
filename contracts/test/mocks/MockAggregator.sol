// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Chainlink-style aggregator for tests. `historyEnabled = false` mimics the HashKey APRO proxy.
contract MockAggregator {
    struct R {
        int256 answer;
        uint256 updatedAt;
    }

    uint8 public decimals;
    R[] internal _rounds;
    bool public historyEnabled = true;

    constructor(uint8 d) {
        decimals = d;
    }

    function push(int256 answer, uint256 updatedAt) external {
        _rounds.push(R(answer, updatedAt));
    }

    function setHistory(bool v) external {
        historyEnabled = v;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        uint80 id = uint80(_rounds.length - 1);
        R memory r = _rounds[id];
        return (id, r.answer, r.updatedAt, r.updatedAt, id);
    }

    function getRoundData(uint80 id) external view returns (uint80, int256, uint256, uint256, uint80) {
        require(historyEnabled || id == _rounds.length - 1, "no history");
        require(id < _rounds.length, "no round");
        R memory r = _rounds[id];
        return (id, r.answer, r.updatedAt, r.updatedAt, id);
    }
}
