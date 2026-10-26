// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AproPushAdapter} from "../src/oracles/AproPushAdapter.sol";
import {SupraPushAdapter, ISupraSValueFeed} from "../src/oracles/SupraPushAdapter.sol";
import {SupraPullAdapter} from "../src/oracles/SupraPullAdapter.sol";
import {FallbackPriceAdapter} from "../src/oracles/FallbackPriceAdapter.sol";
import {ISupraOraclePull} from "../src/oracles/IPriceAdapter.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";

contract MockSValue {
    ISupraSValueFeed.PriceFeed public f;

    function set(uint256 dec, uint256 timeMs, uint256 price) external {
        f = ISupraSValueFeed.PriceFeed(1, dec, timeMs, price);
    }

    function getSvalue(uint256) external view returns (ISupraSValueFeed.PriceFeed memory) {
        return f;
    }
}

contract MockSupraPull {
    ISupraOraclePull.PriceInfo internal info;

    function set(uint256 pair, uint256 price, uint256 tsMs, uint256 dec) external {
        delete info;
        info.pairs.push(5);
        info.prices.push(1);
        info.timestamp.push(1);
        info.decimal.push(8);
        info.round.push(1);
        info.pairs.push(pair);
        info.prices.push(price);
        info.timestamp.push(tsMs);
        info.decimal.push(dec);
        info.round.push(1);
    }

    function verifyOracleProofV2(bytes calldata) external view returns (ISupraOraclePull.PriceInfo memory) {
        return info;
    }
}

contract PriceAdaptersTest is Test {
    bytes32 constant BTC = keccak256("BTC/USD");
    MockAggregator agg;
    AproPushAdapter apro;

    function setUp() public {
        vm.warp(1_800_000_000);
        agg = new MockAggregator(8);
        agg.push(80_000e8, block.timestamp - 3 hours);
        agg.push(81_000e8, block.timestamp - 1 hours);
        apro = new AproPushAdapter(address(this));
        apro.setFeed(BTC, address(agg), 2 hours);
    }

    function test_apro_spot_and_stale() public {
        (uint256 p, uint64 t) = apro.spotPrice(BTC);
        assertEq(p, 81_000e8);
        assertEq(t, block.timestamp - 1 hours);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(AproPushAdapter.StalePrice.selector);
        apro.spotPrice(BTC);
        vm.expectRevert(AproPushAdapter.UnknownMarket.selector);
        apro.spotPrice(bytes32(0));
    }

    function test_apro_decimals_normalised() public {
        MockAggregator a18 = new MockAggregator(18);
        a18.push(81_000e18, block.timestamp);
        MockAggregator a6 = new MockAggregator(6);
        a6.push(81_000e6, block.timestamp);
        apro.setFeed(bytes32("A"), address(a18), 1 hours);
        apro.setFeed(bytes32("B"), address(a6), 1 hours);
        (uint256 p18,) = apro.spotPrice(bytes32("A"));
        (uint256 p6,) = apro.spotPrice(bytes32("B"));
        assertEq(p18, 81_000e8);
        assertEq(p6, 81_000e8);
        MockAggregator neg = new MockAggregator(8);
        neg.push(-1, block.timestamp);
        apro.setFeed(bytes32("N"), address(neg), 1 hours);
        vm.expectRevert(AproPushAdapter.BadPrice.selector);
        apro.spotPrice(bytes32("N"));
    }

    function test_apro_priceAt() public {
        uint64 now_ = uint64(block.timestamp);
        assertEq(apro.priceAt(BTC, now_, 0), 81_000e8); // latest in effect
        assertEq(apro.priceAt(BTC, now_ - 2 hours, 0), 80_000e8); // history via hint
        vm.expectRevert(AproPushAdapter.BadRoundHint.selector);
        apro.priceAt(BTC, now_ - 2 hours, 1); // round newer than ts
        assertEq(apro.priceAt(BTC, now_ - 30 minutes, 0), 81_000e8); // latest still in effect
        agg.push(82_000e8, now_ - 10 minutes);
        vm.expectRevert(AproPushAdapter.BadRoundHint.selector);
        apro.priceAt(BTC, now_ - 30 minutes, 0); // round 1 (<= ts) exists after hint 0
    }

    function test_apro_priceAt_noHistory() public {
        agg.setHistory(false);
        vm.expectRevert(AproPushAdapter.NoHistory.selector);
        apro.priceAt(BTC, uint64(block.timestamp - 2 hours), 0);
        vm.expectRevert(AproPushAdapter.StalePrice.selector);
        apro.priceAt(BTC, uint64(block.timestamp + 5 hours), 0);
    }

    function test_supraPush_and_fallback() public {
        MockSValue sv = new MockSValue();
        sv.set(18, (block.timestamp - 60) * 1000, 81_234e18);
        SupraPushAdapter sup = new SupraPushAdapter(ISupraSValueFeed(address(sv)), address(this), 2 hours);
        sup.setPair(BTC, 0);
        (uint256 p, uint64 t) = sup.spotPrice(BTC);
        assertEq(p, 81_234e8);
        assertEq(t, block.timestamp - 60);
        assertEq(sup.priceAt(BTC, uint64(block.timestamp), 0), 81_234e8);
        vm.expectRevert(SupraPushAdapter.NoHistory.selector);
        sup.priceAt(BTC, uint64(block.timestamp - 120), 0);

        FallbackPriceAdapter fb = new FallbackPriceAdapter(apro, sup);
        (uint256 fp,) = fb.spotPrice(BTC);
        assertEq(fp, 81_000e8); // primary ok
        assertEq(fb.priceAt(BTC, uint64(block.timestamp), 0), 81_000e8);
        vm.warp(1_800_000_000 + 90 minutes); // primary stale (absolute: via-IR caches block.timestamp)
        (fp,) = fb.spotPrice(BTC);
        assertEq(fp, 81_234e8);
        agg.setHistory(false);
        assertEq(fb.priceAt(BTC, uint64(1_800_000_000 + 90 minutes), 0), 81_234e8);

        sup.setMaxStaleness(1);
        vm.expectRevert(SupraPushAdapter.StalePrice.selector);
        sup.spotPrice(BTC);
        vm.expectRevert(SupraPushAdapter.StalePrice.selector);
        sup.priceAt(BTC, uint64(block.timestamp), 0);
        sv.set(6, block.timestamp, 0);
        vm.expectRevert(SupraPushAdapter.BadPrice.selector);
        sup.spotPrice(BTC);
        sv.set(6, block.timestamp, 81_000e6);
        sup.setMaxStaleness(1 hours);
        (p,) = sup.spotPrice(BTC);
        assertEq(p, 81_000e8);
        vm.expectRevert(SupraPushAdapter.UnknownMarket.selector);
        sup.spotPrice(bytes32("X"));
    }

    function test_supraPull_verifyTouch() public {
        MockSupraPull mp = new MockSupraPull();
        SupraPullAdapter pull = new SupraPullAdapter(ISupraOraclePull(address(mp)), address(this));
        pull.setPair(BTC, 0);
        mp.set(0, 84_000e18, 1_800_000_123_456, 18);
        (uint256 p, uint64 ts) = pull.verifyTouch(BTC, "");
        assertEq(p, 84_000e8);
        assertEq(ts, 1_800_000_123);
        mp.set(0, 84_000e6, 1_800_000_000, 6); // seconds + low decimals
        (p, ts) = pull.verifyTouch(BTC, "");
        assertEq(p, 84_000e8);
        assertEq(ts, 1_800_000_000);
        mp.set(3, 1, 1, 8);
        vm.expectRevert(SupraPullAdapter.PairNotInProof.selector);
        pull.verifyTouch(BTC, "");
        mp.set(0, 0, 1, 8);
        vm.expectRevert(SupraPullAdapter.BadPrice.selector);
        pull.verifyTouch(BTC, "");
    }
}
