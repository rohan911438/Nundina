// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IIdentityRegistry, IReputationRegistry} from "../interfaces/IERC8004.sol";

/// @title ReputationRegistry (ERC-8004 "Trustless Agents")
/// @notice Stores feedback (score 0-100 plus tags and an evidence file pointer) about agents.
/// @dev Follows the ERC-8004 v1 draft (Oct 2025) Reputation Registry: `giveFeedback`, `revokeFeedback`,
///      `readFeedback`, `getSummary`, `getClients` and the `NewFeedback` event. Deviation: instead of
///      per-client `feedbackAuth` signatures from the agent, writers are allowlisted with `WRITER_ROLE`
///      (Nundina's PerformanceEscrow), which makes every entry backed by an on-chain settlement.
contract ReputationRegistry is AccessControl, IReputationRegistry {
    bytes32 public constant WRITER_ROLE = keccak256("WRITER_ROLE");

    struct Feedback {
        uint8 score;
        bytes32 tag1;
        bytes32 tag2;
        bool isRevoked;
    }

    IIdentityRegistry public immutable identityRegistry;

    mapping(uint256 agentId => mapping(address client => Feedback[])) private _feedback;
    mapping(uint256 agentId => address[]) private _clients;
    mapping(uint256 agentId => mapping(address client => bool)) private _isClient;

    error ScoreOutOfRange();
    error UnknownAgent();
    error BadIndex();

    constructor(IIdentityRegistry identity, address admin) {
        identityRegistry = identity;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Records feedback about `agentId` from the calling writer.
    function giveFeedback(
        uint256 agentId,
        uint8 score,
        bytes32 tag1,
        bytes32 tag2,
        string calldata fileuri,
        bytes32 filehash
    ) external onlyRole(WRITER_ROLE) {
        if (score > 100) revert ScoreOutOfRange();
        if (identityRegistry.ownerOf(agentId) == address(0)) revert UnknownAgent();
        if (!_isClient[agentId][msg.sender]) {
            _isClient[agentId][msg.sender] = true;
            _clients[agentId].push(msg.sender);
        }
        _feedback[agentId][msg.sender].push(Feedback(score, tag1, tag2, false));
        emit NewFeedback(agentId, msg.sender, score, tag1, tag2, fileuri, filehash);
    }

    /// @notice Revokes one of the caller's own feedback entries.
    function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external {
        Feedback[] storage list = _feedback[agentId][msg.sender];
        if (feedbackIndex >= list.length) revert BadIndex();
        list[feedbackIndex].isRevoked = true;
        emit FeedbackRevoked(agentId, msg.sender, feedbackIndex);
    }

    /// @notice Reads one feedback entry.
    function readFeedback(uint256 agentId, address client, uint64 index)
        external
        view
        returns (uint8 score, bytes32 tag1, bytes32 tag2, bool isRevoked)
    {
        Feedback storage f = _feedback[agentId][client][index];
        return (f.score, f.tag1, f.tag2, f.isRevoked);
    }

    /// @notice Number of entries a client left for an agent.
    function feedbackCount(uint256 agentId, address client) external view returns (uint256) {
        return _feedback[agentId][client].length;
    }

    /// @notice All addresses that ever left feedback for an agent.
    function getClients(uint256 agentId) external view returns (address[] memory) {
        return _clients[agentId];
    }

    /// @notice Count and average score of non-revoked feedback, optionally filtered by tags (zero = any).
    function getSummary(uint256 agentId, address[] calldata clients, bytes32 tag1, bytes32 tag2)
        external
        view
        returns (uint64 count, uint8 averageScore)
    {
        address[] memory list = clients;
        if (list.length == 0) list = _clients[agentId];
        uint256 sum;
        for (uint256 c; c < list.length; ++c) {
            Feedback[] storage fs = _feedback[agentId][list[c]];
            for (uint256 i; i < fs.length; ++i) {
                Feedback storage f = fs[i];
                if (f.isRevoked) continue;
                if (tag1 != bytes32(0) && f.tag1 != tag1) continue;
                if (tag2 != bytes32(0) && f.tag2 != tag2) continue;
                sum += f.score;
                ++count;
            }
        }
        averageScore = count == 0 ? 0 : uint8(sum / count);
    }
}
