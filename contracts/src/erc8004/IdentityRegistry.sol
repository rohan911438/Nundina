// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721URIStorage, ERC721} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {IIdentityRegistry} from "../interfaces/IERC8004.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @title IdentityRegistry (ERC-8004 "Trustless Agents")
/// @notice Each agent is an ERC-721 token whose URI points to its agent registration file.
/// @dev Follows the ERC-8004 v1 draft (Oct 2025) Identity Registry interface: `register(tokenURI)`,
///      `register(tokenURI, metadata[])`, `register()`, on-chain key/value metadata and the
///      `Registered` / `MetadataSet` events. The reference repo was not vendored; this is a minimal port.
contract IdentityRegistry is ERC721URIStorage, IIdentityRegistry {
    struct MetadataEntry {
        string key;
        bytes value;
    }

    uint256 private _nextId = 1;
    mapping(uint256 agentId => mapping(string key => bytes value)) private _metadata;

    error NotAgentOwner();

    constructor() ERC721("ERC-8004 Agent Identity", "AGENT") {}

    /// @notice Registers a new agent with a registration-file URI and mints its id to the caller.
    function register(string calldata tokenURI_) external returns (uint256 agentId) {
        agentId = _mintAgent(tokenURI_);
    }

    /// @notice Registers a new agent with a URI and initial metadata.
    function register(string calldata tokenURI_, MetadataEntry[] calldata metadata) external returns (uint256 agentId) {
        agentId = _mintAgent(tokenURI_);
        for (uint256 i; i < metadata.length; ++i) {
            _metadata[agentId][metadata[i].key] = metadata[i].value;
            emit MetadataSet(agentId, metadata[i].key, metadata[i].key, metadata[i].value);
        }
    }

    /// @notice Registers a new agent without a URI (set it later with `setAgentURI`).
    function register() external returns (uint256 agentId) {
        agentId = _mintAgent("");
    }

    /// @notice Updates the registration-file URI. Owner only.
    function setAgentURI(uint256 agentId, string calldata tokenURI_) external {
        if (ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        _setTokenURI(agentId, tokenURI_);
    }

    /// @notice Sets an on-chain metadata entry. Owner only.
    function setMetadata(uint256 agentId, string calldata key, bytes calldata value) external {
        if (ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        _metadata[agentId][key] = value;
        emit MetadataSet(agentId, key, key, value);
    }

    /// @notice Reads an on-chain metadata entry.
    function getMetadata(uint256 agentId, string calldata key) external view returns (bytes memory) {
        return _metadata[agentId][key];
    }

    /// @notice Number of agents registered so far.
    function totalAgents() external view returns (uint256) {
        return _nextId - 1;
    }

    /// @inheritdoc IIdentityRegistry
    function ownerOf(uint256 agentId) public view override(ERC721, IERC721, IIdentityRegistry) returns (address) {
        return super.ownerOf(agentId);
    }

    function _mintAgent(string memory tokenURI_) internal returns (uint256 agentId) {
        agentId = _nextId++;
        _mint(msg.sender, agentId);
        if (bytes(tokenURI_).length != 0) _setTokenURI(agentId, tokenURI_);
        emit Registered(agentId, tokenURI_, msg.sender);
    }
}

