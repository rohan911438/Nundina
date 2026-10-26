// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EscrowFixture} from "./utils/EscrowFixture.sol";
import {PerformanceEscrow} from "../src/PerformanceEscrow.sol";
import {IPerformanceEscrow, ICreditVerifier} from "../src/interfaces/IPerformanceEscrow.sol";
import {IOutcomeResolver} from "../src/interfaces/IOutcomeResolver.sol";
import {SignalLib} from "../src/lib/SignalLib.sol";
import {ProviderRegistry} from "../src/ProviderRegistry.sol";
import {MockERC3009} from "./mocks/MockERC3009.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract PerformanceEscrowTest is EscrowFixture {
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    uint256 internal constant PRICE = 1e6;

    SignalLib.Signal internal sig;
    uint256 internal id;

    function setUp() public {
        _deployFull();
        _registerProvider(provider, false);
        _bond(provider, 100e6);
        sig = _longSignal(provider, PRICE);
        id = _commit(sig, providerKey);
    }

    function _three() internal {
        _buy(id, alice, PRICE);
        _buy(id, bob, PRICE);
        _buy(id, carol, PRICE);
    }

    // ───────── lifecycle ─────────

    function test_win_paysProviderAndTreasury() public {
        _three();
        assertEq(registry.freeBond(provider), 97e6);
        _touch(id, sig, 0, 84_100e8, t0 + 100);
        escrow.settle(id);
        assertEq(escrow.claimable(treasury, address(usdt)), 0.3e6);
        assertEq(escrow.claimable(payout, address(usdt)), 2.7e6);
        assertEq(registry.freeBond(provider), 100e6);
        escrow.withdrawFor(payout, address(usdt));
        vm.prank(treasury);
        escrow.withdraw(address(usdt));
        assertEq(usdt.balanceOf(payout), 2.7e6);
        assertEq(usdt.balanceOf(treasury), 0.3e6);
        assertEq(usdt.balanceOf(address(escrow)), 0);
        assertEq(escrow.liabilities(address(usdt)), 0);
        (uint64 count, uint8 avg) = reputation.getSummary(registry.agentIdOf(provider), new address[](0), 0, 0);
        assertEq(count, 1);
        assertEq(avg, 100);
        vm.expectRevert(PerformanceEscrow.NotOpen.selector);
        escrow.settle(id);
    }

    function test_loss_refundsPlusSlash() public {
        _three();
        _touch(id, sig, 1, 80_100e8, t0 + 100);
        escrow.settle(id);
        for (uint256 i; i < 3; ++i) {
            address s = [alice, bob, carol][i];
            assertEq(escrow.claimable(s, address(usdt)), 2e6); // price + slash (same token)
            vm.prank(s);
            escrow.withdraw(address(usdt));
            assertEq(usdt.balanceOf(s), 2e6);
        }
        assertEq(registry.getProvider(provider).bondTotal, 97e6);
        assertEq(registry.getProvider(provider).bondLocked, 0);
        assertEq(usdt.balanceOf(address(escrow)), 0);
        (, uint8 avg) = reputation.getSummary(registry.agentIdOf(provider), new address[](0), 0, 0);
        assertEq(avg, 0);
    }

    function test_loss_lateBuyerNotSlashCompensated() public {
        _buy(id, alice, PRICE);
        vm.warp(t0 + 2 hours);
        _buy(id, bob, PRICE); // bought after the (not yet proven) SL touch at t0+1h
        _touch(id, sig, 1, 80_100e8, t0 + 1 hours);
        escrow.settle(id);
        assertEq(escrow.claimable(alice, address(usdt)), 2e6);
        assertEq(escrow.claimable(bob, address(usdt)), 1e6);
        assertEq(registry.getProvider(provider).bondTotal, 99e6);
        assertEq(registry.getProvider(provider).bondLocked, 0);
    }

    function test_loss_bondInOtherToken() public {
        (address p2, uint256 k2) = makeAddrAndKey("p2");
        _registerProvider(p2, false);
        vm.prank(p2);
        registry.setBondToken(address(usdc));
        usdc.mint(p2, 10e6);
        vm.startPrank(p2);
        usdc.approve(address(registry), 10e6);
        registry.depositBond(10e6);
        vm.stopPrank();
        SignalLib.Signal memory s2 = _longSignal(p2, PRICE);
        uint256 id2 = _commit(s2, k2);
        _buy(id2, alice, PRICE);
        _touch(id2, s2, 1, 80_100e8, t0 + 100);
        escrow.settle(id2);
        assertEq(escrow.claimable(alice, address(usdt)), 1e6);
        assertEq(escrow.claimable(alice, address(usdc)), 1e6);
        assertEq(escrow.slashedIn(address(usdc)), 1e6);
    }

    function test_void_refundsNoSlash() public {
        SignalLib.Signal memory s = _longSignal(provider, PRICE);
        s.entry = 80_000e8;
        s.stopLoss = 79_000e8;
        s.takeProfit = 82_000e8;
        uint256 lid = _commit(s, providerKey);
        _buy(lid, alice, PRICE);
        vm.prank(admin);
        resolver.setAdapters(oracle, oracle, false);
        vm.warp(s.validUntil + 1);
        resolver.resolveAtExpiry(lid, s, 0);
        escrow.settle(lid);
        assertEq(escrow.claimable(alice, address(usdt)), 1e6);
        assertEq(registry.getProvider(provider).bondTotal, 100e6);
        assertEq(registry.freeBond(provider), 100e6);
    }

    function test_unrevealed_isLossWithSlash() public {
        _buy(id, alice, PRICE);
        vm.warp(sig.validUntil + 6 hours + 1);
        book.markUnrevealed(id);
        escrow.settle(id);
        assertEq(escrow.claimable(alice, address(usdt)), 2e6);
    }

    function test_settle_notFinal_reverts() public {
        _buy(id, alice, PRICE);
        vm.expectRevert(PerformanceEscrow.NotFinal.selector);
        escrow.settle(id);
        resolver.proveTouch(id, sig, 0, abi.encode(BTC, 84_100e8, t0 + 10));
        vm.expectRevert(PerformanceEscrow.NotFinal.selector);
        escrow.settle(id);
    }

    function test_settle_noSubscribers() public {
        _touch(id, sig, 0, 84_100e8, t0 + 100);
        escrow.settle(id);
        assertEq(uint8(escrow.potOf(id).state), uint8(IPerformanceEscrow.PotState.SETTLED));
    }

    // ───────── credit checks ─────────

    function test_replayReceipt_reverts() public {
        bytes32 rh = _buy(id, alice, PRICE);
        usdt.mint(bob, PRICE);
        vm.prank(bob);
        usdt.transfer(address(escrow), PRICE);
        bytes memory s = _creditSig(creditKey, id, bob, address(usdt), PRICE, rh, bytes32("tx2"));
        vm.expectRevert(PerformanceEscrow.ReceiptUsed.selector);
        escrow.creditPayment(id, bob, address(usdt), PRICE, rh, bytes32("tx2"), s);
    }

    function test_replayTx_reverts() public {
        _buy(id, alice, PRICE);
        bytes32 txh = keccak256(abi.encode("tx", receiptCounter));
        bytes memory s = _creditSig(creditKey, id, bob, address(usdt), PRICE, bytes32("r2"), txh);
        vm.expectRevert(PerformanceEscrow.TxUsed.selector);
        escrow.creditPayment(id, bob, address(usdt), PRICE, bytes32("r2"), txh, s);
    }

    function test_wrongSigner_reverts() public {
        (, uint256 fake) = makeAddrAndKey("fake");
        usdt.mint(address(escrow), PRICE);
        bytes memory s = _creditSig(fake, id, alice, address(usdt), PRICE, bytes32("r"), bytes32("t"));
        vm.expectRevert(PerformanceEscrow.BadCredit.selector);
        escrow.creditPayment(id, alice, address(usdt), PRICE, bytes32("r"), bytes32("t"), s);
    }

    function _tryCredit(uint256 sid, address sub, address token, uint256 amount, bytes4 err) internal {
        MockERC20(token).mint(address(escrow), amount);
        bytes32 rh = keccak256(abi.encode("try", ++receiptCounter));
        bytes memory s = _creditSig(creditKey, sid, sub, token, amount, rh, bytes32(0));
        vm.expectRevert(err);
        escrow.creditPayment(sid, sub, token, amount, rh, bytes32(0), s);
    }

    function test_wrongAmount_reverts() public {
        _tryCredit(id, alice, address(usdt), PRICE + 1, PerformanceEscrow.WrongAmount.selector);
    }

    function test_afterExpiry_reverts() public {
        vm.warp(sig.validUntil);
        _tryCredit(id, alice, address(usdt), PRICE, PerformanceEscrow.SignalExpired.selector);
    }

    function test_unknownSignal_and_free_revert() public {
        _tryCredit(999, alice, address(usdt), PRICE, PerformanceEscrow.SignalNotOpen.selector);
        uint256 freeId = _commit(_longSignal(provider, 0), providerKey);
        _tryCredit(freeId, alice, address(usdt), 0, PerformanceEscrow.FreeSignal.selector);
    }

    function test_afterTouch_reverts() public {
        resolver.proveTouch(id, sig, 1, abi.encode(BTC, 80_100e8, t0 + 10));
        _tryCredit(id, alice, address(usdt), PRICE, PerformanceEscrow.SignalNotOpen.selector);
    }

    function test_capacityFull_reverts() public {
        (address p2, uint256 k2) = makeAddrAndKey("smallBond");
        _registerProvider(p2, false);
        _bond(p2, 2e6);
        SignalLib.Signal memory s2 = _longSignal(p2, PRICE);
        uint256 id2 = _commit(s2, k2);
        _buy(id2, alice, PRICE);
        _buy(id2, bob, PRICE);
        _tryCredit(id2, carol, address(usdt), PRICE, ProviderRegistry.InsufficientFreeBond.selector);
    }

    function test_alreadyPaid_wrongToken_disallowed_revert() public {
        _buy(id, alice, PRICE);
        _tryCredit(id, alice, address(usdt), PRICE, PerformanceEscrow.AlreadyPaid.selector);
        _tryCredit(id, bob, address(usdc), PRICE, PerformanceEscrow.WrongToken.selector);
        MockERC20 junk = new MockERC20("J", "J", 6);
        _tryCredit(id, bob, address(junk), PRICE, PerformanceEscrow.TokenNotAllowed.selector);
    }

    function test_creditWithoutTokens_reverts() public {
        bytes memory s = _creditSig(creditKey, id, alice, address(usdt), PRICE, bytes32("r"), bytes32(0));
        vm.expectRevert(PerformanceEscrow.InsufficientFunds.selector);
        escrow.creditPayment(id, alice, address(usdt), PRICE, bytes32("r"), bytes32(0), s);
    }

    function test_donation_creditableOnlyOnce() public {
        usdt.mint(address(this), PRICE);
        usdt.transfer(address(escrow), PRICE); // donation
        bytes memory s1 = _creditSig(creditKey, id, alice, address(usdt), PRICE, bytes32("r1"), bytes32(0));
        escrow.creditPayment(id, alice, address(usdt), PRICE, bytes32("r1"), bytes32(0), s1);
        bytes memory s2 = _creditSig(creditKey, id, bob, address(usdt), PRICE, bytes32("r2"), bytes32(0));
        vm.expectRevert(PerformanceEscrow.InsufficientFunds.selector);
        escrow.creditPayment(id, bob, address(usdt), PRICE, bytes32("r2"), bytes32(0), s2);
        assertLe(escrow.credited(address(usdt)), escrow.received(address(usdt)));
    }

    function test_paused_blocksCreditsOnly() public {
        _buy(id, alice, PRICE);
        vm.prank(admin);
        escrow.pause();
        _tryCredit(id, bob, address(usdt), PRICE, bytes4(keccak256("EnforcedPause()")));
        _touch(id, sig, 0, 84_100e8, t0 + 100);
        escrow.settle(id); // settle works while paused
        escrow.withdrawFor(payout, address(usdt));
        vm.prank(admin);
        escrow.unpause();
    }

    function test_maxSubscribers() public {
        _bond(provider, 1_000e6);
        for (uint256 i; i < 200; ++i) {
            _buy(id, address(uint160(0x1000 + i)), PRICE);
        }
        _tryCredit(id, alice, address(usdt), PRICE, PerformanceEscrow.TooManySubscribers.selector);
        _touch(id, sig, 1, 80_100e8, t0 + 100);
        uint256 g = gasleft();
        escrow.settle(id);
        assertLt(g - gasleft(), 15_000_000); // bounded
    }

    // ───────── claimRefund ─────────

    function test_claimRefund_afterDelay_evenWhenPaused() public {
        _three();
        vm.expectRevert(PerformanceEscrow.TooEarly.selector);
        escrow.claimRefund(id);
        vm.prank(admin);
        escrow.pause();
        vm.warp(sig.validUntil + 24 hours + 1);
        escrow.claimRefund(id);
        assertEq(escrow.claimable(alice, address(usdt)), PRICE);
        assertEq(registry.freeBond(provider), 100e6);
        vm.expectRevert(PerformanceEscrow.NotOpen.selector);
        escrow.settle(id);
        vm.expectRevert(PerformanceEscrow.NotOpen.selector);
        escrow.claimRefund(id);
        vm.expectRevert(PerformanceEscrow.NotOpen.selector);
        escrow.claimRefund(424242);
    }

    // ───────── recoverUncredited ─────────

    function test_recoverUncredited() public {
        _buy(id, alice, PRICE);
        usdt.mint(bob, 5e6);
        vm.prank(bob);
        usdt.transfer(address(escrow), 5e6); // HSP rejected this one
        bytes32 txh = bytes32("bobTx");
        // cannot take more than the surplus (would eat alice's payment)
        bytes memory big = _recoverSig(address(usdt), bob, 6e6, txh);
        vm.expectRevert(PerformanceEscrow.InsufficientFunds.selector);
        escrow.recoverUncredited(address(usdt), bob, 6e6, txh, big);
        bytes memory bad = _recoverSig(address(usdt), carol, 5e6, txh);
        vm.expectRevert(PerformanceEscrow.BadCredit.selector);
        escrow.recoverUncredited(address(usdt), bob, 5e6, txh, bad);
        bytes memory ok = _recoverSig(address(usdt), bob, 5e6, txh);
        escrow.recoverUncredited(address(usdt), bob, 5e6, txh, ok);
        assertEq(usdt.balanceOf(bob), 5e6);
        vm.expectRevert(PerformanceEscrow.TxUsed.selector);
        escrow.recoverUncredited(address(usdt), bob, 5e6, txh, ok);
        bytes memory z = _recoverSig(address(usdt), bob, 1, bytes32(0));
        vm.expectRevert(PerformanceEscrow.TxUsed.selector);
        escrow.recoverUncredited(address(usdt), bob, 1, bytes32(0), z);
    }

    // ───────── EIP-3009 fast path ─────────

    function test_fundWithAuthorization() public {
        (address payer, uint256 pk) = makeAddrAndKey("payer3009");
        usdc.mint(payer, PRICE);
        bytes32 nonce = keccak256(abi.encode(id, payer));
        uint256 before = block.timestamp + 1 hours;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                MockERC3009(address(usdc)).DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        MockERC3009(address(usdc)).RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                        payer,
                        address(escrow),
                        PRICE,
                        0,
                        before,
                        nonce
                    )
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        vm.expectRevert(PerformanceEscrow.BadNonce.selector);
        escrow.fundWithAuthorization(id, payer, PRICE, 0, before, bytes32("x"), v, r, s);
        escrow.fundWithAuthorization(id, payer, PRICE, 0, before, nonce, v, r, s);
        assertEq(escrow.paid(id, payer), PRICE);
        assertEq(escrow.potOf(id).token, address(usdc));
        assertEq(usdc.balanceOf(address(escrow)), PRICE);
    }

    // ───────── reputation failure never blocks ─────────

    function test_feedbackFailure_doesNotBlockSettle() public {
        _buy(id, alice, PRICE);
        vm.startPrank(admin);
        reputation.revokeRole(reputation.WRITER_ROLE(), address(escrow));
        vm.stopPrank();
        _touch(id, sig, 0, 84_100e8, t0 + 100);
        vm.expectEmit(true, true, false, false, address(escrow));
        emit IPerformanceEscrow.FeedbackFailed(id, registry.agentIdOf(provider));
        escrow.settle(id);
    }

    // ───────── admin ─────────

    function test_admin() public {
        vm.startPrank(admin);
        vm.expectRevert(PerformanceEscrow.FeeTooHigh.selector);
        escrow.setFeeBps(2001);
        escrow.setFeeBps(500);
        vm.expectRevert(PerformanceEscrow.ZeroAddress.selector);
        escrow.setTreasury(address(0));
        escrow.setTreasury(alice);
        vm.expectRevert(PerformanceEscrow.ZeroAddress.selector);
        escrow.setCreditVerifier(ICreditVerifier(address(0)));
        escrow.setCreditVerifier(verifier);
        escrow.setAllowedToken(address(usdc), false);
        verifier.setSigner(creditSigner);
        vm.stopPrank();
        vm.expectRevert();
        escrow.setFeeBps(0);
        vm.expectRevert(PerformanceEscrow.NothingToWithdraw.selector);
        escrow.withdraw(address(usdt));
        assertEq(escrow.subscribersOf(id).length, 0);
    }
}
