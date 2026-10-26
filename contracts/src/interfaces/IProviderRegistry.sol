// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IProviderRegistry
/// @notice Provider profiles, bonds and KYC badges.
interface IProviderRegistry {
    struct Provider {
        uint256 agentId;
        address payout;
        bytes32 tgHandleHash;
        address bondToken;
        uint256 bondTotal;
        uint256 bondLocked;
        uint64 withdrawRequestedAt;
        uint256 withdrawAmount;
        uint64 kycUntil;
        bool isPractice;
        bool registered;
    }

    event ProviderRegistered(address indexed provider, uint256 agentId);
    event ProviderUpdated(address indexed provider, address payout, bytes32 tgHandleHash);
    event BondTokenSet(address indexed provider, address token);
    event BondDeposited(address indexed provider, address token, uint256 amount);
    event BondWithdrawRequested(address indexed provider, uint256 amount, uint64 availableAt);
    event BondWithdrawn(address indexed provider, uint256 amount);
    event BondLocked(address indexed provider, uint256 amount);
    event BondUnlocked(address indexed provider, uint256 amount);
    event BondSlashed(address indexed provider, address indexed to, uint256 amount);
    event KycSet(address indexed provider, uint64 until);

    function isRegistered(address provider) external view returns (bool);
    function isPractice(address provider) external view returns (bool);
    function payoutOf(address provider) external view returns (address);
    function agentIdOf(address provider) external view returns (uint256);
    function bondTokenOf(address provider) external view returns (address);
    function freeBond(address provider) external view returns (uint256);
    function capacity(address provider, uint256 slashPerSub) external view returns (uint256);
    function lockBond(address provider, uint256 amount) external;
    function unlockBond(address provider, uint256 amount) external;
    function slash(address provider, address to, uint256 amount) external;
}
