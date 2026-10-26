// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EscrowFixture} from "./utils/EscrowFixture.sol";
import {RevenueRouter} from "../src/RevenueRouter.sol";
import {SignalLib} from "../src/lib/SignalLib.sol";

contract RevenueRouterTest is EscrowFixture {
    struct P {
        address addr;
        uint256 key;
    }

    P internal a;
    P internal b;
    P internal c;
    P internal agg;
    address internal sub = makeAddr("sub");

    function setUp() public {
        _deployFull();
        a = _newProvider("A");
        b = _newProvider("B");
        c = _newProvider("C");
        agg = _newProvider("AGG");
    }

    function _newProvider(string memory name) internal returns (P memory p) {
        (p.addr, p.key) = makeAddrAndKey(name);
        _registerProvider(p.addr, false);
        _bond(p.addr, 100e6);
    }

    function _signal(P memory p, uint256[] memory up, uint16[] memory bps, uint256 price)
        internal
        returns (uint256 id, SignalLib.Signal memory s)
    {
        s = _longSignal(p.addr, price);
        s.upstream = up;
        s.upstreamBps = bps;
        id = _commit(s, p.key);
    }

    function _none() internal pure returns (uint256[] memory, uint16[] memory) {
        return (new uint256[](0), new uint16[](0));
    }

    function test_threeUpstreams_oneLoser() public {
        (uint256[] memory e, uint16[] memory eb) = _none();
        (uint256 u1, SignalLib.Signal memory s1) = _signal(a, e, eb, 1e6);
        (uint256 u2, SignalLib.Signal memory s2) = _signal(b, e, eb, 1e6);
        (uint256 u3, SignalLib.Signal memory s3) = _signal(c, e, eb, 1e6);
        uint256[] memory up = new uint256[](3);
        (up[0], up[1], up[2]) = (u1, u2, u3);
        uint16[] memory bps = new uint16[](3);
        (bps[0], bps[1], bps[2]) = (5000, 3000, 2000);
        (uint256 meta, SignalLib.Signal memory sm) = _signal(agg, up, bps, 2e6);
        _buy(meta, sub, 2e6);

        resolver.proveTouch(u1, s1, 0, abi.encode(BTC, 84_100e8, t0 + 10));
        resolver.proveTouch(u2, s2, 1, abi.encode(BTC, 80_100e8, t0 + 10));
        resolver.proveTouch(u3, s3, 0, abi.encode(BTC, 84_100e8, t0 + 10));
        resolver.proveTouch(meta, sm, 0, abi.encode(BTC, 84_100e8, t0 + 20));
        vm.warp(vm.getBlockTimestamp() + 11 minutes);
        resolver.finalize(u1);
        resolver.finalize(u2);
        resolver.finalize(u3);
        resolver.finalize(meta);
        escrow.settle(meta);

        // payout after 10% fee = 1.8e6
        assertEq(escrow.claimable(a.addr, address(usdt)), 0.9e6);
        assertEq(escrow.claimable(b.addr, address(usdt)), 0);
        assertEq(escrow.claimable(c.addr, address(usdt)), 0.36e6);
        assertEq(escrow.claimable(agg.addr, address(usdt)), 0.54e6);
        assertEq(escrow.claimable(treasury, address(usdt)), 0.2e6);
    }

    function test_depthChain() public {
        (uint256[] memory e, uint16[] memory eb) = _none();
        (uint256 s1id, SignalLib.Signal memory s1) = _signal(a, e, eb, 1e6);
        uint256[] memory up = new uint256[](1);
        uint16[] memory bps = new uint16[](1);
        up[0] = s1id;
        bps[0] = 5000;
        (uint256 s2id, SignalLib.Signal memory s2) = _signal(b, up, bps, 1e6);
        up = new uint256[](1);
        up[0] = s2id;
        (uint256 s3id, SignalLib.Signal memory s3) = _signal(c, up, bps, 4e6);
        _buy(s3id, sub, 4e6);
        resolver.proveTouch(s1id, s1, 0, abi.encode(BTC, 84_100e8, t0 + 10));
        resolver.proveTouch(s2id, s2, 0, abi.encode(BTC, 84_100e8, t0 + 10));
        resolver.proveTouch(s3id, s3, 0, abi.encode(BTC, 84_100e8, t0 + 10));
        vm.warp(vm.getBlockTimestamp() + 11 minutes);
        resolver.finalize(s1id);
        resolver.finalize(s2id);
        resolver.finalize(s3id);
        escrow.settle(s3id);
        // payout 3.6e6: C keeps 1.8, B's branch 1.8 -> A 0.9, B 0.9
        assertEq(escrow.claimable(c.addr, address(usdt)), 1.8e6);
        assertEq(escrow.claimable(b.addr, address(usdt)), 0.9e6);
        assertEq(escrow.claimable(a.addr, address(usdt)), 0.9e6);
    }

    /// @dev u1, u2 win; u3 never finalises, so its share stays with the aggregator.
    function _metaWithTwoWinners(uint16 b1, uint16 b2, uint16 b3)
        internal
        returns (uint256 meta, uint256 u1, uint256 u2)
    {
        (uint256[] memory e, uint16[] memory eb) = _none();
        SignalLib.Signal memory s1;
        SignalLib.Signal memory s2;
        (u1, s1) = _signal(a, e, eb, 1e6);
        (u2, s2) = _signal(b, e, eb, 1e6);
        (uint256 u3,) = _signal(c, e, eb, 1e6);
        uint256[] memory up = new uint256[](3);
        (up[0], up[1], up[2]) = (u1, u2, u3);
        uint16[] memory bps = new uint16[](3);
        (bps[0], bps[1], bps[2]) = (b1, b2, b3);
        (meta,) = _signal(agg, up, bps, 1e6);
        resolver.proveTouch(u1, s1, 0, abi.encode(BTC, 84_100e8, t0 + 10));
        resolver.proveTouch(u2, s2, 0, abi.encode(BTC, 84_100e8, t0 + 10));
        vm.warp(vm.getBlockTimestamp() + 11 minutes);
        resolver.finalize(u1);
        resolver.finalize(u2);
    }

    function testFuzz_conservationAndDust(uint256 amount, uint16 b1, uint16 b2, uint16 b3) public {
        amount = bound(amount, 0, 1e30);
        b1 = uint16(bound(b1, 0, 10_000));
        b2 = uint16(bound(b2, 0, 10_000 - b1));
        b3 = uint16(bound(b3, 0, 10_000 - b1 - b2));
        (uint256 meta, uint256 u1, uint256 u2) = _metaWithTwoWinners(b1, b2, b3);

        (address[] memory to, uint256[] memory amts, uint256[] memory src) = router.preview(meta, amount);
        uint256 sum;
        for (uint256 i; i < to.length; ++i) {
            sum += amts[i];
            assertTrue(src[i] == u1 || src[i] == u2 || src[i] == meta);
        }
        assertEq(sum, amount);
        if (amount != 0 && uint256(b1) + b2 < 10_000) assertEq(to[to.length - 1], agg.addr); // remainder + dust
    }

    function test_onlyEscrow_and_setOnce() public {
        vm.expectRevert(RevenueRouter.NotEscrow.selector);
        router.route(1, address(usdt), 1);
        vm.prank(admin);
        vm.expectRevert(RevenueRouter.EscrowAlreadySet.selector);
        router.setEscrow(address(1));
    }
}
