// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SignalLib} from "../lib/SignalLib.sol";

/// @title ISignalBook
/// @notice Commit-reveal store for trading signals.
interface ISignalBook {
    enum Status {
        NONE,
        COMMITTED,
        REVEALED,
        UNREVEALED_LOSS
    }

    struct CommitAuthorization {
        address provider;
        bytes32 commitHash;
        bytes32 market;
        uint64 validUntil;
        uint256 pricePerSub;
        uint256 nonce;
        uint64 deadline;
    }

    struct Record {
        address provider;
        uint64 committedAt;
        uint64 validUntil;
        Status status;
        bool isLimit;
        uint8 depth;
        bytes32 commitHash;
        bytes32 market;
        uint256 pricePerSub;
        uint256 oraclePriceAtCommit;
        string cipherURI;
        uint256[] upstream;
        uint16[] upstreamBps;
    }

    event SignalCommitted(
        uint256 indexed id,
        address indexed provider,
        bytes32 market,
        uint64 validUntil,
        uint256 price,
        bytes32 commitHash,
        uint256 oraclePrice,
        string cipherURI
    );
    event SignalUpstream(uint256 indexed id, uint256[] upstream, uint16[] upstreamBps);
    event SignalRevealed(uint256 indexed id, SignalLib.Signal s, bool isLimit);
    event SignalUnrevealed(uint256 indexed id);

    function getSignal(uint256 id) external view returns (Record memory);
    function revealedSignal(uint256 id) external view returns (SignalLib.Signal memory);
    function isRevealed(uint256 id) external view returns (bool);
    function statusOf(uint256 id) external view returns (Status);
    function providerOf(uint256 id) external view returns (address);
    function upstreamOf(uint256 id) external view returns (uint256[] memory, uint16[] memory);
    function hashSignal(SignalLib.Signal calldata s) external view returns (bytes32);
    function revealFor(uint256 id, SignalLib.Signal calldata s) external;
    function nextId() external view returns (uint256);
}
