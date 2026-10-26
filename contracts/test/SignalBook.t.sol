// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Fixtures} from "./utils/Fixtures.sol";
import {SignalBook} from "../src/SignalBook.sol";
import {ISignalBook} from "../src/interfaces/ISignalBook.sol";
import {IProviderRegistry} from "../src/interfaces/IProviderRegistry.sol";
import {SignalLib} from "../src/lib/SignalLib.sol";

contract SignalBookTest is Fixtures {
    function setUp() public {
        vm.warp(1_800_000_000);
        _deployWithMockResolver();
        _registerProvider(provider, false);
    }

    // ───────── golden vector (TS ↔ Solidity) ─────────

    function test_hashMatchesGoldenVector() public {
        string memory json = vm.readFile("../packages/shared/test/vectors/signal.json");
        uint256 chainId = vm.parseJsonUint(json, ".chainId");
        address verifying = vm.parseJsonAddress(json, ".verifyingContract");
        SignalLib.Signal memory s;
        s.provider = vm.parseJsonAddress(json, ".signal.provider");
        s.market = vm.parseJsonBytes32(json, ".signal.market");
        s.side = uint8(vm.parseJsonUint(json, ".signal.side"));
        s.entry = vm.parseUint(vm.parseJsonString(json, ".signal.entry"));
        s.takeProfit = vm.parseUint(vm.parseJsonString(json, ".signal.takeProfit"));
        s.stopLoss = vm.parseUint(vm.parseJsonString(json, ".signal.stopLoss"));
        s.validUntil = uint64(vm.parseUint(vm.parseJsonString(json, ".signal.validUntil")));
        s.pricePerSub = vm.parseUint(vm.parseJsonString(json, ".signal.pricePerSub"));
        string[] memory ups = vm.parseJsonStringArray(json, ".signal.upstream");
        s.upstream = new uint256[](ups.length);
        for (uint256 i; i < ups.length; ++i) {
            s.upstream[i] = vm.parseUint(ups[i]);
        }
        uint256[] memory bps = vm.parseJsonUintArray(json, ".signal.upstreamBps");
        s.upstreamBps = new uint16[](bps.length);
        for (uint256 i; i < bps.length; ++i) {
            s.upstreamBps[i] = uint16(bps[i]);
        }
        s.salt = vm.parseJsonBytes32(json, ".signal.salt");

        vm.chainId(chainId);
        deployCodeTo("SignalBook.sol:SignalBook", abi.encode(address(registry), admin, uint256(0)), verifying);
        assertEq(SignalBook(verifying).hashSignal(s), vm.parseJsonBytes32(json, ".commitHash"));
    }

    // ───────── commit ─────────

    function test_commit_storesRecord() public {
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        uint256 id = _commit(s, providerKey);
        assertEq(id, 1);
        ISignalBook.Record memory r = book.getSignal(id);
        assertEq(r.provider, provider);
        assertEq(r.commitHash, book.hashSignal(s));
        assertEq(r.oraclePriceAtCommit, BTC_PRICE);
        assertEq(uint8(r.status), uint8(ISignalBook.Status.COMMITTED));
        assertEq(book.nonces(provider), 1);
        assertEq(book.providerOf(id), provider);
    }

    function test_commit_wrongSigner_reverts() public {
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        (, uint256 otherKey) = makeAddrAndKey("other");
        ISignalBook.CommitAuthorization memory a = _auth(s);
        bytes memory sig = _signAuth(otherKey, a);
        vm.prank(relayer);
        vm.expectRevert(SignalBook.BadSignature.selector);
        book.commit(a, sig, s.upstream, s.upstreamBps, "x");
    }

    function test_commit_replayedNonce_reverts() public {
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        ISignalBook.CommitAuthorization memory a = _auth(s);
        bytes memory sig = _signAuth(providerKey, a);
        vm.startPrank(relayer);
        book.commit(a, sig, s.upstream, s.upstreamBps, "x");
        vm.expectRevert(SignalBook.BadNonce.selector);
        book.commit(a, sig, s.upstream, s.upstreamBps, "x");
        vm.stopPrank();
    }

    function test_commit_expiredDeadline_reverts() public {
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        ISignalBook.CommitAuthorization memory a = _auth(s);
        bytes memory sig = _signAuth(providerKey, a);
        vm.warp(block.timestamp + 11 minutes);
        vm.prank(relayer);
        vm.expectRevert(SignalBook.AuthExpired.selector);
        book.commit(a, sig, s.upstream, s.upstreamBps, "x");
    }

    function test_commit_nonRelayer_reverts() public {
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        ISignalBook.CommitAuthorization memory a = _auth(s);
        bytes memory sig = _signAuth(providerKey, a);
        vm.expectRevert();
        book.commit(a, sig, s.upstream, s.upstreamBps, "x");
    }

    function test_commit_unregistered_reverts() public {
        (address stranger, uint256 key) = makeAddrAndKey("stranger");
        SignalLib.Signal memory s = _longSignal(stranger, 1e6);
        ISignalBook.CommitAuthorization memory a = _auth(s);
        bytes memory sig = _signAuth(key, a);
        vm.prank(relayer);
        vm.expectRevert(SignalBook.NotRegistered.selector);
        book.commit(a, sig, s.upstream, s.upstreamBps, "x");
    }

    function test_commit_practiceMustBeFree() public {
        (address p2, uint256 k2) = makeAddrAndKey("practice");
        _registerProvider(p2, true);
        SignalLib.Signal memory s = _longSignal(p2, 1e6);
        ISignalBook.CommitAuthorization memory a = _auth(s);
        bytes memory sig = _signAuth(k2, a);
        vm.prank(relayer);
        vm.expectRevert(SignalBook.PracticeMustBeFree.selector);
        book.commit(a, sig, s.upstream, s.upstreamBps, "x");
        _commit(_longSignal(p2, 0), k2);
    }

    function test_commit_priceCap_and_validity() public {
        SignalLib.Signal memory s = _longSignal(provider, 6e6);
        ISignalBook.CommitAuthorization memory a = _auth(s);
        bytes memory sig = _signAuth(providerKey, a);
        vm.prank(relayer);
        vm.expectRevert(SignalBook.PriceAboveCap.selector);
        book.commit(a, sig, s.upstream, s.upstreamBps, "x");

        s = _longSignal(provider, 1e6);
        s.validUntil = uint64(block.timestamp + 10 minutes);
        a = _auth(s);
        sig = _signAuth(providerKey, a);
        vm.prank(relayer);
        vm.expectRevert(SignalBook.BadValidity.selector);
        book.commit(a, sig, s.upstream, s.upstreamBps, "x");

        s.validUntil = uint64(block.timestamp + 8 days);
        a = _auth(s);
        sig = _signAuth(providerKey, a);
        vm.prank(relayer);
        vm.expectRevert(SignalBook.BadValidity.selector);
        book.commit(a, sig, s.upstream, s.upstreamBps, "x");
    }

    function test_commit_whenPaused_reverts() public {
        vm.prank(admin);
        book.pause();
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        ISignalBook.CommitAuthorization memory a = _auth(s);
        bytes memory sig = _signAuth(providerKey, a);
        vm.prank(relayer);
        vm.expectRevert();
        book.commit(a, sig, s.upstream, s.upstreamBps, "x");
        vm.prank(admin);
        book.unpause();
        vm.prank(relayer);
        book.commit(a, sig, s.upstream, s.upstreamBps, "x");
    }

    // ───────── upstream ─────────

    function test_upstream_rules() public {
        uint256 a1 = _commit(_longSignal(provider, 1e6), providerKey);
        uint256 a2 = _commit(_longSignal(provider, 1e6), providerKey);

        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        s.upstream = new uint256[](2);
        s.upstream[0] = a1;
        s.upstream[1] = a2;
        s.upstreamBps = new uint16[](2);
        s.upstreamBps[0] = 5000;
        s.upstreamBps[1] = 3000;
        uint256 meta = _commit(s, providerKey);
        (uint256[] memory up, uint16[] memory bps) = book.upstreamOf(meta);
        assertEq(up.length, 2);
        assertEq(bps[0], 5000);

        // depth: meta(1) -> d2 -> d3 -> d4 too deep
        uint256 prev = meta;
        for (uint256 d = 2; d <= 4; ++d) {
            SignalLib.Signal memory n = _longSignal(provider, 1e6);
            n.upstream = new uint256[](1);
            n.upstream[0] = prev;
            n.upstreamBps = new uint16[](1);
            n.upstreamBps[0] = 1000;
            if (d == 4) {
                ISignalBook.CommitAuthorization memory au = _auth(n);
                bytes memory sg = _signAuth(providerKey, au);
                vm.prank(relayer);
                vm.expectRevert(SignalBook.TooDeep.selector);
                book.commit(au, sg, n.upstream, n.upstreamBps, "x");
            } else {
                prev = _commit(n, providerKey);
            }
        }
    }

    function test_upstream_badCases_revert() public {
        uint256 a1 = _commit(_longSignal(provider, 1e6), providerKey);
        SignalLib.Signal memory hsk = _longSignal(provider, 1e6);
        hsk.market = HSK;
        hsk.entry = 0.0873e8;
        hsk.takeProfit = 0.095e8;
        hsk.stopLoss = 0.08e8;
        uint256 h = _commit(hsk, providerKey);

        uint256[5] memory bad = [uint256(0), 99, h, a1, a1];
        for (uint256 i; i < 4; ++i) {
            SignalLib.Signal memory s = _longSignal(provider, 1e6);
            if (i < 3) {
                s.upstream = new uint256[](1);
                s.upstream[0] = bad[i];
                s.upstreamBps = new uint16[](1);
                s.upstreamBps[0] = 100;
            } else {
                // duplicate + bps overflow
                s.upstream = new uint256[](2);
                s.upstream[0] = a1;
                s.upstream[1] = a1;
                s.upstreamBps = new uint16[](2);
                s.upstreamBps[0] = 100;
                s.upstreamBps[1] = 100;
            }
            ISignalBook.CommitAuthorization memory au = _auth(s);
            bytes memory sg = _signAuth(providerKey, au);
            vm.prank(relayer);
            vm.expectRevert(SignalBook.BadUpstream.selector);
            book.commit(au, sg, s.upstream, s.upstreamBps, "x");
        }
        SignalLib.Signal memory o = _longSignal(provider, 1e6);
        o.upstream = new uint256[](1);
        o.upstream[0] = a1;
        o.upstreamBps = new uint16[](1);
        o.upstreamBps[0] = 10_001;
        ISignalBook.CommitAuthorization memory ao = _auth(o);
        bytes memory so = _signAuth(providerKey, ao);
        vm.prank(relayer);
        vm.expectRevert(SignalBook.BadUpstream.selector);
        book.commit(ao, so, o.upstream, o.upstreamBps, "x");
    }

    // ───────── reveal ─────────

    function test_reveal_correct() public {
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        uint256 id = _commit(s, providerKey);
        book.reveal(id, s);
        assertTrue(book.isRevealed(id));
        SignalLib.Signal memory stored = book.revealedSignal(id);
        assertEq(stored.takeProfit, s.takeProfit);
        assertEq(stored.salt, s.salt);
        assertFalse(book.isLimit(id));
        vm.expectRevert(SignalBook.AlreadyRevealed.selector);
        book.reveal(id, s);
    }

    function test_reveal_wrongSalt_reverts() public {
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        uint256 id = _commit(s, providerKey);
        s.salt = bytes32(uint256(1));
        vm.expectRevert(SignalBook.HashMismatch.selector);
        book.reveal(id, s);
    }

    function test_reveal_unknown_reverts() public {
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        vm.expectRevert(SignalBook.UnknownSignal.selector);
        book.reveal(42, s);
    }

    function test_reveal_badRR_reverts() public {
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        s.takeProfit = 82_000e8; // reward 500 < risk 1300
        uint256 id = _commit(s, providerKey);
        vm.expectRevert(SignalLib.BadRiskReward.selector);
        book.reveal(id, s);
    }

    function test_reveal_badGeometry_reverts() public {
        SignalLib.Signal memory s = _shortSignal(provider, 1e6);
        s.side = SignalLib.LONG; // short levels with long side
        uint256 id = _commit(s, providerKey);
        vm.expectRevert(SignalLib.BadGeometry.selector);
        book.reveal(id, s);

        SignalLib.Signal memory s2 = _longSignal(provider, 1e6);
        s2.side = 7;
        uint256 id2 = _commit(s2, providerKey);
        vm.expectRevert(SignalLib.BadGeometry.selector);
        book.reveal(id2, s2);

        SignalLib.Signal memory s3 = _shortSignal(provider, 1e6);
        s3.takeProfit = 81_000e8;
        uint256 id3 = _commit(s3, providerKey);
        vm.expectRevert(SignalLib.BadRiskReward.selector);
        book.reveal(id3, s3);
    }

    function test_reveal_short_works() public {
        SignalLib.Signal memory s = _shortSignal(provider, 1e6);
        uint256 id = _commit(s, providerKey);
        book.reveal(id, s);
        assertTrue(book.isRevealed(id));
    }

    function test_reveal_entryFarAway_setsLimit() public {
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        s.entry = 80_000e8; // 1.84% below oracle
        s.stopLoss = 79_000e8;
        s.takeProfit = 82_000e8;
        uint256 id = _commit(s, providerKey);
        book.reveal(id, s);
        assertTrue(book.isLimit(id));
    }

    function test_revealFor_onlyResolver() public {
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        uint256 id = _commit(s, providerKey);
        vm.expectRevert(SignalBook.NotResolver.selector);
        book.revealFor(id, s);
        vm.prank(address(mockResolver));
        book.revealFor(id, s);
        assertTrue(book.isRevealed(id));
    }

    function test_reveal_afterWindow_reverts() public {
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        uint256 id = _commit(s, providerKey);
        vm.warp(s.validUntil + 6 hours + 1);
        vm.expectRevert(SignalBook.RevealWindowClosed.selector);
        book.reveal(id, s);
    }

    // ───────── markUnrevealed ─────────

    function test_markUnrevealed_window() public {
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        uint256 id = _commit(s, providerKey);
        vm.expectRevert(SignalBook.RevealWindowOpen.selector);
        book.markUnrevealed(id);
        vm.warp(s.validUntil + 6 hours + 1);
        book.markUnrevealed(id);
        assertEq(uint8(book.statusOf(id)), uint8(ISignalBook.Status.UNREVEALED_LOSS));
        vm.expectRevert(SignalBook.NotCommitted.selector);
        book.markUnrevealed(id);
    }

    function test_markUnrevealed_revealed_reverts() public {
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        uint256 id = _commit(s, providerKey);
        book.reveal(id, s);
        vm.warp(s.validUntil + 7 hours);
        vm.expectRevert(SignalBook.NotCommitted.selector);
        book.markUnrevealed(id);
    }

    // ───────── admin ─────────

    function test_admin_setters() public {
        vm.startPrank(admin);
        vm.expectRevert(SignalBook.ResolverAlreadySet.selector);
        book.setResolver(mockResolver);
        book.setLimitThresholdBps(50);
        book.setMaxPricePerSub(0);
        vm.expectRevert(bytes("bps"));
        book.setLimitThresholdBps(501);
        vm.stopPrank();
        assertEq(book.limitThresholdBps(), 50);
        _commit(_longSignal(provider, 100e6), providerKey); // cap removed
    }

    // ───────── fuzz ─────────

    function testFuzz_commitRevealRoundTrip(
        uint256 entry,
        uint256 riskAmt,
        uint256 rewardMul,
        bool short,
        uint32 validFor,
        uint256 price,
        bytes32 salt
    ) public {
        entry = bound(entry, 1e8, 1_000_000e8);
        riskAmt = bound(riskAmt, 1, entry / 2);
        rewardMul = bound(rewardMul, 100, 500); // 1R..5R
        uint256 reward = riskAmt * rewardMul / 100;
        if (short) vm.assume(reward < entry);
        validFor = uint32(bound(validFor, 15 minutes, 7 days));
        price = bound(price, 0, 5e6);

        SignalLib.Signal memory s;
        s.provider = provider;
        s.market = BTC;
        s.side = short ? SignalLib.SHORT : SignalLib.LONG;
        s.entry = entry;
        s.takeProfit = short ? entry - reward : entry + reward;
        s.stopLoss = short ? entry + riskAmt : entry - riskAmt;
        s.validUntil = uint64(block.timestamp + validFor);
        s.pricePerSub = price;
        s.salt = salt;

        uint256 id = _commit(s, providerKey);
        book.reveal(id, s);
        assertTrue(book.isRevealed(id));
        assertEq(book.revealedSignal(id).entry, entry);
    }
}
