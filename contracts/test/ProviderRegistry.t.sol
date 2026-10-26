// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Fixtures} from "./utils/Fixtures.sol";
import {ProviderRegistry} from "../src/ProviderRegistry.sol";
import {IProviderRegistry} from "../src/interfaces/IProviderRegistry.sol";
import {ReputationRegistry} from "../src/erc8004/ReputationRegistry.sol";
import {IdentityRegistry} from "../src/erc8004/IdentityRegistry.sol";

contract ProviderRegistryTest is Fixtures {
    address internal escrow = makeAddr("escrow");

    function setUp() public {
        vm.warp(1_800_000_000);
        _deployWithMockResolver();
        vm.prank(admin);
        registry.setEscrow(escrow);
    }

    function test_register() public {
        uint256 agentId = _registerProvider(provider, false);
        assertTrue(registry.isRegistered(provider));
        assertEq(registry.agentIdOf(provider), agentId);
        assertEq(registry.payoutOf(provider), payout);
        assertEq(registry.bondTokenOf(provider), address(usdt));
        assertFalse(registry.isPractice(provider));
        assertEq(registry.providerOfAgent(agentId), provider);
    }

    function test_register_notOwner_reverts() public {
        vm.prank(provider);
        uint256 agentId = identity.register("x");
        vm.prank(makeAddr("thief"));
        vm.expectRevert(ProviderRegistry.NotAgentOwner.selector);
        registry.register(agentId, payout, 0, false);
    }

    function test_register_twice_and_agentTaken() public {
        uint256 agentId = _registerProvider(provider, false);
        vm.prank(provider);
        vm.expectRevert(ProviderRegistry.AlreadyRegistered.selector);
        registry.register(agentId, payout, 0, false);

        address other = makeAddr("other");
        vm.prank(provider);
        identity.transferFrom(provider, other, agentId);
        vm.prank(other);
        vm.expectRevert(ProviderRegistry.AgentTaken.selector);
        registry.register(agentId, other, 0, false);

        vm.startPrank(other);
        uint256 y = identity.register("y");
        vm.expectRevert(ProviderRegistry.ZeroAddress.selector);
        registry.register(y, address(0), 0, false);
        vm.stopPrank();
    }

    function test_profile_practice_bondToken() public {
        _registerProvider(provider, true);
        vm.startPrank(provider);
        registry.updateProfile(makeAddr("newPayout"), keccak256("@new"));
        registry.leavePractice();
        registry.setBondToken(address(usdc));
        vm.expectRevert(ProviderRegistry.TokenNotAllowed.selector);
        registry.setBondToken(makeAddr("junk"));
        vm.expectRevert(ProviderRegistry.ZeroAddress.selector);
        registry.updateProfile(address(0), 0);
        vm.stopPrank();
        assertFalse(registry.isPractice(provider));
        assertEq(registry.bondTokenOf(provider), address(usdc));
        assertEq(registry.payoutOf(provider), makeAddr("newPayout"));

        usdc.mint(provider, 10e6);
        vm.startPrank(provider);
        usdc.approve(address(registry), 10e6);
        registry.depositBond(10e6);
        vm.expectRevert(ProviderRegistry.BondNotEmpty.selector);
        registry.setBondToken(address(usdt));
        vm.stopPrank();
    }

    function test_unregistered_reverts() public {
        vm.expectRevert(ProviderRegistry.NotRegistered.selector);
        registry.depositBond(1);
    }

    function test_bond_lifecycle() public {
        _registerProvider(provider, false);
        _bond(provider, 100e6);
        assertEq(registry.freeBond(provider), 100e6);
        assertEq(registry.capacity(provider, 5e6), 20);
        assertEq(registry.capacity(provider, 0), type(uint256).max);

        vm.prank(escrow);
        registry.lockBond(provider, 60e6);
        assertEq(registry.freeBond(provider), 40e6);

        vm.startPrank(provider);
        vm.expectRevert(ProviderRegistry.ZeroAmount.selector);
        registry.depositBond(0);
        vm.expectRevert(ProviderRegistry.ZeroAmount.selector);
        registry.requestBondWithdraw(0);
        vm.expectRevert(ProviderRegistry.NoWithdrawRequest.selector);
        registry.withdrawBond();
        vm.expectRevert(ProviderRegistry.InsufficientFreeBond.selector);
        registry.requestBondWithdraw(50e6); // locked
        registry.requestBondWithdraw(40e6);
        vm.expectRevert(ProviderRegistry.WithdrawDelayActive.selector);
        registry.withdrawBond();
        vm.stopPrank();

        vm.warp(block.timestamp + 7 days);
        // more got locked during the delay -> can't withdraw locked funds
        vm.prank(escrow);
        registry.lockBond(provider, 10e6);
        vm.prank(provider);
        vm.expectRevert(ProviderRegistry.InsufficientFreeBond.selector);
        registry.withdrawBond();

        vm.prank(escrow);
        registry.unlockBond(provider, 10e6);
        vm.prank(provider);
        registry.withdrawBond();
        assertEq(usdt.balanceOf(provider), 40e6);
        assertEq(registry.getProvider(provider).bondTotal, 60e6);
    }

    function test_lock_overCapacity_reverts() public {
        _registerProvider(provider, false);
        _bond(provider, 10e6);
        vm.prank(escrow);
        vm.expectRevert(ProviderRegistry.InsufficientFreeBond.selector);
        registry.lockBond(provider, 11e6);
    }

    function test_slash_movesTokensToEscrowOnly() public {
        _registerProvider(provider, false);
        _bond(provider, 30e6);
        vm.startPrank(escrow);
        registry.lockBond(provider, 15e6);
        vm.expectRevert(ProviderRegistry.SlashOnlyToEscrow.selector);
        registry.slash(provider, makeAddr("attacker"), 5e6);
        registry.slash(provider, escrow, 5e6);
        vm.stopPrank();
        assertEq(usdt.balanceOf(escrow), 5e6);
        IProviderRegistry.Provider memory p = registry.getProvider(provider);
        assertEq(p.bondTotal, 25e6);
        assertEq(p.bondLocked, 10e6);
    }

    function test_escrowOnlyHooks() public {
        _registerProvider(provider, false);
        vm.expectRevert(ProviderRegistry.NotEscrow.selector);
        registry.lockBond(provider, 1);
        vm.expectRevert(ProviderRegistry.NotEscrow.selector);
        registry.unlockBond(provider, 1);
        vm.expectRevert(ProviderRegistry.NotEscrow.selector);
        registry.slash(provider, address(this), 1);
    }

    function test_escrowSetOnce_adminCannotRedirect() public {
        vm.startPrank(admin);
        vm.expectRevert(ProviderRegistry.EscrowAlreadySet.selector);
        registry.setEscrow(admin);
        vm.stopPrank();
    }

    function test_kyc() public {
        _registerProvider(provider, false);
        uint64 exp = uint64(block.timestamp + 365 days);
        bytes memory att = abi.encode(provider, exp);
        bytes memory sig = _kycSig(kycIssuerKey, provider, exp);
        vm.prank(provider);
        registry.setKycAttestation(att, sig);
        assertTrue(registry.isKycVerified(provider));
        assertEq(registry.getProvider(provider).kycUntil, exp);
    }

    function test_kyc_wrongIssuer_reverts() public {
        _registerProvider(provider, false);
        uint64 exp = uint64(block.timestamp + 365 days);
        (, uint256 fakeKey) = makeAddrAndKey("fakeIssuer");
        bytes memory sig = _kycSig(fakeKey, provider, exp);
        vm.prank(provider);
        vm.expectRevert(ProviderRegistry.BadAttestation.selector);
        registry.setKycAttestation(abi.encode(provider, exp), sig);
    }

    function test_kyc_wrongSubject_or_expired_reverts() public {
        _registerProvider(provider, false);
        uint64 exp = uint64(block.timestamp + 1 days);
        address other = makeAddr("other");
        bytes memory sig = _kycSig(kycIssuerKey, other, exp);
        vm.prank(provider);
        vm.expectRevert(ProviderRegistry.BadAttestation.selector);
        registry.setKycAttestation(abi.encode(other, exp), sig);

        uint64 past = uint64(block.timestamp - 1);
        sig = _kycSig(kycIssuerKey, provider, past);
        vm.prank(provider);
        vm.expectRevert(ProviderRegistry.BadAttestation.selector);
        registry.setKycAttestation(abi.encode(provider, past), sig);

        vm.prank(provider);
        vm.expectRevert(ProviderRegistry.BadAttestation.selector);
        registry.setKycAttestation(abi.encode(provider, exp), hex"1234");
    }

    function test_admin() public {
        vm.startPrank(admin);
        registry.setKycIssuer(address(1));
        registry.setAllowedToken(address(usdc), false);
        vm.expectRevert(ProviderRegistry.TokenNotAllowed.selector);
        registry.setDefaultBondToken(address(usdc));
        registry.setDefaultBondToken(address(usdt));
        vm.stopPrank();
        assertEq(registry.kycIssuer(), address(1));
        vm.expectRevert();
        registry.setKycIssuer(address(2));
    }

    // ───────── ERC-8004 sanity ─────────

    function test_identity_and_reputation() public {
        vm.startPrank(provider);
        uint256 id = identity.register("ipfs://a");
        identity.setAgentURI(id, "ipfs://b");
        identity.setMetadata(id, "agentWallet", abi.encode(provider));
        IdentityRegistry.MetadataEntry[] memory md = new IdentityRegistry.MetadataEntry[](1);
        md[0] = IdentityRegistry.MetadataEntry("k", "v");
        uint256 id2 = identity.register("ipfs://c", md);
        uint256 id3 = identity.register();
        vm.stopPrank();
        assertEq(identity.tokenURI(id), "ipfs://b");
        assertEq(identity.getMetadata(id2, "k"), bytes("v"));
        assertEq(identity.totalAgents(), 3);
        assertEq(identity.ownerOf(id3), provider);
        vm.expectRevert(IdentityRegistry.NotAgentOwner.selector);
        identity.setAgentURI(id, "x");
        vm.expectRevert(IdentityRegistry.NotAgentOwner.selector);
        identity.setMetadata(id, "k", "v");

        address writer = makeAddr("writer");
        vm.startPrank(admin);
        reputation.grantRole(reputation.WRITER_ROLE(), writer);
        vm.stopPrank();
        vm.startPrank(writer);
        reputation.giveFeedback(id, 100, "nundina", "WIN", "", bytes32(0));
        reputation.giveFeedback(id, 0, "nundina", "LOSS", "", bytes32(0));
        vm.expectRevert(ReputationRegistry.ScoreOutOfRange.selector);
        reputation.giveFeedback(id, 101, "", "", "", bytes32(0));
        reputation.revokeFeedback(id, 1);
        vm.expectRevert(ReputationRegistry.BadIndex.selector);
        reputation.revokeFeedback(id, 9);
        vm.stopPrank();
        (uint64 count, uint8 avg) = reputation.getSummary(id, new address[](0), bytes32(0), bytes32(0));
        assertEq(count, 1);
        assertEq(avg, 100);
        address[] memory cl = new address[](1);
        cl[0] = writer;
        (count,) = reputation.getSummary(id, cl, "nundina", "LOSS");
        assertEq(count, 0);
        assertEq(reputation.getClients(id).length, 1);
        assertEq(reputation.feedbackCount(id, writer), 2);
        (uint8 sc,,, bool rev) = reputation.readFeedback(id, writer, 1);
        assertEq(sc, 0);
        assertTrue(rev);
        vm.expectRevert();
        reputation.giveFeedback(id, 1, "", "", "", bytes32(0));
    }

    function _kycSig(uint256 key, address subject, uint64 exp) internal view returns (bytes memory) {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("NundinaRegistry"),
                keccak256("1"),
                block.chainid,
                address(registry)
            )
        );
        bytes32 sh = keccak256(abi.encode(registry.KYC_TYPEHASH(), subject, exp));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, keccak256(abi.encodePacked("\x19\x01", domain, sh)));
        return abi.encodePacked(r, s, v);
    }
}
