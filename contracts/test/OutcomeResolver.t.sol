// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Fixtures} from "./utils/Fixtures.sol";
import {OutcomeResolver} from "../src/OutcomeResolver.sol";
import {IOutcomeResolver} from "../src/interfaces/IOutcomeResolver.sol";
import {ISignalBook} from "../src/interfaces/ISignalBook.sol";
import {SignalLib} from "../src/lib/SignalLib.sol";
import {MockPriceAdapter} from "../src/oracles/MockPriceAdapter.sol";
import {AproPushAdapter} from "../src/oracles/AproPushAdapter.sol";
import {SupraPullAdapter} from "../src/oracles/SupraPullAdapter.sol";
import {IPriceAdapter, ITouchVerifier, ISupraOraclePull} from "../src/oracles/IPriceAdapter.sol";
import {SupraPushAdapter, ISupraSValueFeed} from "../src/oracles/SupraPushAdapter.sol";
import {FallbackPriceAdapter} from "../src/oracles/FallbackPriceAdapter.sol";

contract OutcomeResolverTest is Fixtures {
    MockPriceAdapter internal oracle;
    OutcomeResolver internal resolver;
    uint64 internal t0;

    function setUp() public {
        vm.warp(1_800_000_000);
        t0 = uint64(block.timestamp);
        _deployResolver(true);
    }

    function _deployResolver(bool touchEnabled) internal {
        oracle = new MockPriceAdapter(address(this));
        oracle.push(BTC, BTC_PRICE, t0);
        oracle.setAcceptAll(true);
        resolver =
            new OutcomeResolver(admin, IPriceAdapter(address(oracle)), ITouchVerifier(address(oracle)), touchEnabled);
        _deployCore(resolver);
        vm.prank(admin);
        resolver.setBook(book);
        _registerProvider(provider, false);
    }

    function _proof(uint256 price, uint64 ts) internal pure returns (bytes memory p) {
        p = abi.encode(BTC, price, ts);
    }

    function _outcome(uint256 id) internal view returns (IOutcomeResolver.Outcome o, int256 r, bool f) {
        (o, r, f) = resolver.outcomeOf(id);
    }

    // ───────── touches ─────────

    function test_tpTouch_winAfterWindow() public {
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        uint256 id = _commit(s, providerKey);
        assertTrue(resolver.isOpen(id));
        resolver.proveTouch(id, s, 0, _proof(84_100e8, t0 + 3600));
        assertTrue(book.isRevealed(id)); // resolution doubles as reveal
        assertFalse(resolver.isOpen(id));
        (,, bool f) = _outcome(id);
        assertFalse(f);
        vm.expectRevert(OutcomeResolver.ChallengeWindowOpen.selector);
        resolver.finalize(id);
        vm.warp(block.timestamp + 10 minutes);
        resolver.finalize(id);
        (IOutcomeResolver.Outcome o, int256 r, bool f2) = _outcome(id);
        assertEq(uint8(o), uint8(IOutcomeResolver.Outcome.WIN));
        assertTrue(f2);
        assertEq(r, 192); // 2500/1300 = 1.92R
        assertEq(resolver.decidedAt(id), t0 + 3600);
        vm.expectRevert(OutcomeResolver.AlreadyFinal.selector);
        resolver.finalize(id);
    }

    function test_slTouch_loss() public {
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        uint256 id = _commit(s, providerKey);
        resolver.proveTouch(id, s, 1, _proof(80_000e8, t0 + 60));
        vm.warp(block.timestamp + 11 minutes);
        resolver.finalize(id);
        (IOutcomeResolver.Outcome o, int256 r, bool f) = _outcome(id);
        assertEq(uint8(o), uint8(IOutcomeResolver.Outcome.LOSS));
        assertEq(r, -100);
        assertTrue(f);
    }

    function test_short_touches() public {
        SignalLib.Signal memory s = _shortSignal(provider, 1e6);
        uint256 id = _commit(s, providerKey);
        vm.expectRevert(OutcomeResolver.NotCrossed.selector);
        resolver.proveTouch(id, s, 0, _proof(79_500e8, t0 + 60));
        resolver.proveTouch(id, s, 0, _proof(78_900e8, t0 + 60));
        SignalLib.Signal memory s3 = _shortSignal(provider, 1e6);
        uint256 id3 = _commit(s3, providerKey);
        vm.expectRevert(OutcomeResolver.NotCrossed.selector);
        resolver.proveTouch(id3, s3, 1, _proof(82_000e8, t0 + 60));
        resolver.proveTouch(id3, s3, 1, _proof(83_000e8, t0 + 60));
    }

    function test_challenge_earlierSlOverridesTp() public {
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        uint256 id = _commit(s, providerKey);
        resolver.proveTouch(id, s, 0, _proof(84_100e8, t0 + 7200));
        vm.warp(block.timestamp + 5 minutes);
        resolver.challenge(id, s, 1, _proof(80_100e8, t0 + 3600));
        // a later touch is ignored
        resolver.proveTouch(id, s, 0, _proof(84_500e8, t0 + 9000));
        vm.warp(block.timestamp + 10 minutes);
        resolver.finalize(id);
        (IOutcomeResolver.Outcome o,,) = _outcome(id);
        assertEq(uint8(o), uint8(IOutcomeResolver.Outcome.LOSS));
        assertEq(resolver.stateOf(id).pendingTs, t0 + 3600);
    }

    function test_touch_outsideWindow_reverts() public {
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        uint256 id = _commit(s, providerKey);
        vm.expectRevert(OutcomeResolver.OutsideWindow.selector);
        resolver.proveTouch(id, s, 0, _proof(84_100e8, t0 - 1));
        vm.expectRevert(OutcomeResolver.OutsideWindow.selector);
        resolver.proveTouch(id, s, 0, _proof(84_100e8, s.validUntil + 1));
    }

    function test_touch_wrongPair_reverts() public {
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        uint256 id = _commit(s, providerKey);
        vm.expectRevert(MockPriceAdapter.UnknownProof.selector);
        resolver.proveTouch(id, s, 0, abi.encode(HSK, 84_100e8, t0 + 60));
    }

    function test_touch_notCrossed_badLevel_reverts() public {
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        uint256 id = _commit(s, providerKey);
        vm.expectRevert(OutcomeResolver.NotCrossed.selector);
        resolver.proveTouch(id, s, 0, _proof(83_900e8, t0 + 60));
        vm.expectRevert(OutcomeResolver.NotCrossed.selector);
        resolver.proveTouch(id, s, 1, _proof(80_300e8, t0 + 60));
        vm.expectRevert(OutcomeResolver.BadLevel.selector);
        resolver.proveTouch(id, s, 4, _proof(80_300e8, t0 + 60));
        vm.expectRevert(OutcomeResolver.NotLimit.selector);
        resolver.proveTouch(id, s, 2, _proof(80_300e8, t0 + 60));
    }

    function test_touch_wrongPlaintext_reverts() public {
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        uint256 id = _commit(s, providerKey);
        book.reveal(id, s);
        SignalLib.Signal memory fake = _longSignal(provider, 1e6);
        fake.salt = s.salt;
        fake.takeProfit = 81_600e8;
        vm.expectRevert(OutcomeResolver.HashMismatch.selector);
        resolver.proveTouch(id, fake, 0, _proof(81_700e8, t0 + 60));
        // revealed already: correct plaintext works
        resolver.proveTouch(id, s, 0, _proof(84_100e8, t0 + 60));
    }

    function test_touchDisabled_reverts() public {
        vm.prank(admin);
        resolver.setAdapters(IPriceAdapter(address(oracle)), ITouchVerifier(address(oracle)), false);
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        uint256 id = _commit(s, providerKey);
        vm.expectRevert(OutcomeResolver.TouchProofsDisabled.selector);
        resolver.proveTouch(id, s, 0, _proof(84_100e8, t0 + 60));
    }

    // ───────── expiry ─────────

    function _expiry(int256 rTimes10, bool touchEnabled)
        internal
        returns (uint256 id, IOutcomeResolver.Outcome o, int256 r, bool f)
    {
        if (!touchEnabled) {
            vm.prank(admin);
            resolver.setAdapters(IPriceAdapter(address(oracle)), ITouchVerifier(address(oracle)), false);
        }
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        id = _commit(s, providerKey);
        int256 px = int256(s.entry) + int256(SignalLib.risk(s)) * rTimes10 / 10;
        oracle.push(BTC, uint256(px), s.validUntil - 100);
        vm.warp(s.validUntil + 1);
        resolver.resolveAtExpiry(id, s, 1);
        (o, r, f) = _outcome(id);
    }

    function test_expiry_06R_win() public {
        (, IOutcomeResolver.Outcome o, int256 r, bool f) = _expiry(6, false);
        assertEq(uint8(o), uint8(IOutcomeResolver.Outcome.WIN));
        assertEq(r, 60);
        assertTrue(f);
    }

    function test_expiry_04R_loss() public {
        (, IOutcomeResolver.Outcome o, int256 r,) = _expiry(4, false);
        assertEq(uint8(o), uint8(IOutcomeResolver.Outcome.LOSS));
        assertEq(r, 40);
    }

    function test_expiry_neg03R_loss() public {
        (, IOutcomeResolver.Outcome o, int256 r,) = _expiry(-3, false);
        assertEq(uint8(o), uint8(IOutcomeResolver.Outcome.LOSS));
        assertEq(r, -30);
    }

    function test_expiry_withTouchEnabled_pendingThenOverriddenByEarlierTouch() public {
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        uint256 id = _commit(s, providerKey);
        oracle.push(BTC, 82_500e8, s.validUntil - 100); // +0.77R -> provisional WIN
        vm.warp(s.validUntil + 1);
        resolver.resolveAtExpiry(id, s, 1);
        (IOutcomeResolver.Outcome o,, bool f) = _outcome(id);
        assertEq(uint8(o), uint8(IOutcomeResolver.Outcome.WIN));
        assertFalse(f);
        vm.expectRevert(OutcomeResolver.TouchPending.selector);
        resolver.resolveAtExpiry(id, s, 1);
        // SL was touched earlier: overrides the mark-to-market
        resolver.proveTouch(id, s, 1, _proof(80_100e8, t0 + 500));
        vm.warp(block.timestamp + 10 minutes);
        resolver.finalize(id);
        (o,, f) = _outcome(id);
        assertEq(uint8(o), uint8(IOutcomeResolver.Outcome.LOSS));
        assertTrue(f);
    }

    function test_expiry_beforeExpiry_and_badHint_revert() public {
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        uint256 id = _commit(s, providerKey);
        vm.expectRevert(OutcomeResolver.NotExpired.selector);
        resolver.resolveAtExpiry(id, s, 0);
        oracle.push(BTC, 82_500e8, s.validUntil - 100);
        oracle.push(BTC, 82_600e8, s.validUntil - 50);
        vm.warp(s.validUntil + 1);
        vm.expectRevert(MockPriceAdapter.BadRoundHint.selector);
        resolver.resolveAtExpiry(id, s, 0); // a later round exists before ts
        vm.expectRevert(MockPriceAdapter.BadRoundHint.selector);
        resolver.resolveAtExpiry(id, s, 9);
        resolver.resolveAtExpiry(id, s, 2);
    }

    function test_expiryWithProof() public {
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        uint256 id = _commit(s, providerKey);
        vm.warp(s.validUntil + 30);
        vm.expectRevert(OutcomeResolver.OutsideWindow.selector);
        resolver.resolveAtExpiryWithProof(id, s, _proof(82_800e8, s.validUntil - 1));
        vm.expectRevert(OutcomeResolver.OutsideWindow.selector);
        resolver.resolveAtExpiryWithProof(id, s, _proof(82_800e8, s.validUntil + 301));
        resolver.resolveAtExpiryWithProof(id, s, _proof(82_800e8, s.validUntil + 20)); // +1R
        vm.warp(block.timestamp + 10 minutes);
        resolver.finalize(id);
        (IOutcomeResolver.Outcome o, int256 r, bool f) = _outcome(id);
        assertEq(uint8(o), uint8(IOutcomeResolver.Outcome.WIN));
        assertEq(r, 100);
        assertTrue(f);
    }

    function test_mockRequiresPostedProof() public {
        oracle.setAcceptAll(false);
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        uint256 id = _commit(s, providerKey);
        bytes memory p = _proof(84_100e8, t0 + 60);
        vm.expectRevert(MockPriceAdapter.UnknownProof.selector);
        resolver.proveTouch(id, s, 0, p);
        oracle.postTouch(BTC, 84_100e8, t0 + 60);
        resolver.proveTouch(id, s, 0, p);
        assertEq(oracle.roundCount(BTC), 1);
        oracle.setMaxStaleness(1 days);
    }

    // ───────── limit signals ─────────

    function _limitSignal() internal returns (SignalLib.Signal memory s) {
        s = _longSignal(provider, 1e6);
        s.entry = 80_000e8; // 1.8% below market -> limit
        s.stopLoss = 79_000e8;
        s.takeProfit = 82_000e8;
    }

    function test_limit_tpBeforeEntry_reverts_thenWorks() public {
        SignalLib.Signal memory s = _limitSignal();
        uint256 id = _commit(s, providerKey);
        vm.expectRevert(OutcomeResolver.EntryNotTouched.selector);
        resolver.proveTouch(id, s, 0, _proof(82_100e8, t0 + 60));
        vm.expectRevert(OutcomeResolver.NotCrossed.selector);
        resolver.proveTouch(id, s, 2, _proof(80_500e8, t0 + 100));
        resolver.proveTouch(id, s, 2, _proof(79_990e8, t0 + 100));
        vm.expectRevert(OutcomeResolver.EntryAlreadyTouched.selector);
        resolver.proveTouch(id, s, 2, _proof(79_980e8, t0 + 110));
        vm.expectRevert(OutcomeResolver.EntryNotTouched.selector);
        resolver.proveTouch(id, s, 0, _proof(82_100e8, t0 + 100)); // same ts as entry
        resolver.proveTouch(id, s, 0, _proof(82_100e8, t0 + 200));
        vm.warp(block.timestamp + 10 minutes);
        resolver.finalize(id);
        (IOutcomeResolver.Outcome o,,) = _outcome(id);
        assertEq(uint8(o), uint8(IOutcomeResolver.Outcome.WIN));
    }

    function test_limit_neverTouched_void() public {
        vm.prank(admin);
        resolver.setAdapters(IPriceAdapter(address(oracle)), ITouchVerifier(address(oracle)), false);
        SignalLib.Signal memory s = _limitSignal();
        uint256 id = _commit(s, providerKey);
        vm.warp(s.validUntil + 1);
        resolver.resolveAtExpiry(id, s, 0);
        (IOutcomeResolver.Outcome o, int256 r, bool f) = _outcome(id);
        assertEq(uint8(o), uint8(IOutcomeResolver.Outcome.VOID));
        assertEq(r, 0);
        assertTrue(f);
    }

    function test_limit_voidPending_clearedByEntryProof() public {
        SignalLib.Signal memory s = _limitSignal();
        uint256 id = _commit(s, providerKey);
        vm.warp(s.validUntil + 1);
        resolver.resolveAtExpiry(id, s, 0); // provisional VOID
        resolver.proveTouch(id, s, 2, _proof(79_990e8, t0 + 100));
        assertEq(resolver.stateOf(id).pendingTs, 0);
        oracle.push(BTC, 80_100e8, s.validUntil - 10);
        resolver.resolveAtExpiry(id, s, 1);
        (IOutcomeResolver.Outcome o,,) = _outcome(id);
        assertEq(uint8(o), uint8(IOutcomeResolver.Outcome.LOSS)); // +0.1R
    }

    function test_tpAlreadyBeyondMarket_isLimit() public {
        // LONG whose TP is below the market price: must not be instantly winnable
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        s.entry = 80_800e8;
        s.stopLoss = 80_100e8;
        s.takeProfit = 81_500e8; // == market
        uint256 id = _commit(s, providerKey);
        vm.expectRevert(OutcomeResolver.EntryNotTouched.selector);
        resolver.proveTouch(id, s, 0, _proof(81_600e8, t0 + 1));
    }

    // ───────── unrevealed / misc ─────────

    function test_unrevealed_isLoss() public {
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        uint256 id = _commit(s, providerKey);
        vm.warp(s.validUntil + 6 hours + 1);
        vm.expectRevert(); // reveal window closed
        resolver.resolveAtExpiry(id, s, 0);
        book.markUnrevealed(id);
        (IOutcomeResolver.Outcome o, int256 r, bool f) = _outcome(id);
        assertEq(uint8(o), uint8(IOutcomeResolver.Outcome.LOSS));
        assertEq(r, -100);
        assertTrue(f);
        assertEq(resolver.decidedAt(id), s.validUntil);
        assertFalse(resolver.isOpen(id));
        vm.expectRevert(OutcomeResolver.Unrevealed.selector);
        resolver.proveTouch(id, s, 0, _proof(84_100e8, t0 + 60));
    }

    function test_finalize_nothingPending() public {
        vm.expectRevert(OutcomeResolver.NothingPending.selector);
        resolver.finalize(1);
    }

    function test_admin() public {
        vm.startPrank(admin);
        vm.expectRevert(OutcomeResolver.BookAlreadySet.selector);
        resolver.setBook(book);
        vm.stopPrank();
        vm.expectRevert();
        resolver.setAdapters(IPriceAdapter(address(0)), ITouchVerifier(address(0)), false);
        assertEq(resolver.spotPrice(BTC), BTC_PRICE);
    }

    function test_stalePush_reverts() public {
        vm.warp(block.timestamp + 2 hours + 1);
        vm.expectRevert(MockPriceAdapter.StalePrice.selector);
        resolver.spotPrice(BTC);
    }

    // ───────── fuzz R math ─────────

    function testFuzz_rMultiple(uint256 entry, uint256 riskAmt, uint256 exit, bool short) public {
        entry = bound(entry, 1e6, 1e15);
        riskAmt = bound(riskAmt, 1, entry - 1);
        exit = bound(exit, 1, 2e15);
        SignalLib.Signal memory s;
        s.side = short ? SignalLib.SHORT : SignalLib.LONG;
        s.entry = entry;
        s.stopLoss = short ? entry + riskAmt : entry - riskAmt;
        int256 mv = SignalLib.move(s, exit);
        int256 r = mv * 100 / int256(SignalLib.risk(s));
        bool favourable = short ? exit < entry : exit > entry;
        if (favourable) assertGt(mv, 0);
        if (exit == entry) assertEq(mv, 0);
        if (!favourable && exit != entry) assertLt(r, 1);
        assertEq(SignalLib.risk(s), riskAmt);
    }
}

/// @dev Fork test against the live APRO BTC/USD feed on HashKey mainnet.
contract AproForkTest is Fixtures {
    address constant APRO_BTC = 0x204ED500ab56A2E19B051561258E3A45c850360F;
    address constant SUPRA_STORAGE = 0x58e158c74DF7Ad6396C0dcbadc4878faC9e93d57;

    function test_fork_aproSpotAndHistory() public {
        string memory rpc = vm.envOr("HSK_RPC_URL", string("https://mainnet.hsk.xyz"));
        try vm.createSelectFork(rpc) {}
        catch {
            vm.skip(true);
        }
        AproPushAdapter apro = new AproPushAdapter(address(this));
        apro.setFeed(BTC, APRO_BTC, 26 hours);
        SupraPushAdapter sup = new SupraPushAdapter(ISupraSValueFeed(SUPRA_STORAGE), address(this), 26 hours);
        sup.setPair(BTC, 0);
        FallbackPriceAdapter fb = new FallbackPriceAdapter(apro, sup);

        // APRO is access-controlled on HashKey: a non-allowlisted contract cannot read it.
        vm.expectRevert(bytes("No access"));
        apro.spotPrice(BTC);

        // Supra push storage is open; the fallback adapter uses it.
        (uint256 sp, uint64 st) = sup.spotPrice(BTC);
        assertGt(sp, 10_000e8);
        assertLt(sp, 1_000_000e8);
        (uint256 fp, uint64 ft) = fb.spotPrice(BTC);
        assertEq(fp, sp);
        assertEq(ft, st);
        assertEq(fb.priceAt(BTC, uint64(block.timestamp), 0), sp);
        vm.expectRevert(SupraPushAdapter.NoHistory.selector);
        fb.priceAt(BTC, st - 1, 0);
        vm.expectRevert(SupraPushAdapter.UnknownMarket.selector);
        sup.spotPrice(HSK);

        // Once allowlisted, APRO is read directly (simulate allowlisting by reading as an EOA-like origin).
        vm.prank(address(apro), address(apro));
        (bool ok,) = APRO_BTC.staticcall(abi.encodeWithSignature("latestRoundData()"));
        assertTrue(ok);

        // the resolver reads spot through the fallback adapter
        OutcomeResolver res = new OutcomeResolver(address(this), fb, ITouchVerifier(address(0)), false);
        assertEq(res.spotPrice(BTC), sp);
    }

    function test_fork_supraAdapterWiring() public {
        string memory rpc = vm.envOr("HSK_RPC_URL", string("https://mainnet.hsk.xyz"));
        try vm.createSelectFork(rpc) {}
        catch {
            vm.skip(true);
        }
        SupraPullAdapter sup =
            new SupraPullAdapter(ISupraOraclePull(0x16f70cAD28dd621b0072B5A8a8c392970E87C3dD), address(this));
        sup.setPair(BTC, 0);
        assertEq(sup.pairOf(BTC), 0);
        vm.expectRevert(SupraPullAdapter.UnknownMarket.selector);
        sup.pairOf(HSK);
        vm.expectRevert(); // garbage proof is rejected by Supra
        sup.verifyTouch(BTC, hex"deadbeef");
    }
}

interface IAgg {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}
