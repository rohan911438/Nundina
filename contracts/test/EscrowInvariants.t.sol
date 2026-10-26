// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {EscrowFixture} from "./utils/EscrowFixture.sol";
import {PerformanceEscrow} from "../src/PerformanceEscrow.sol";
import {OutcomeResolver} from "../src/OutcomeResolver.sol";
import {SignalBook} from "../src/SignalBook.sol";
import {IPerformanceEscrow} from "../src/interfaces/IPerformanceEscrow.sol";
import {ISignalBook} from "../src/interfaces/ISignalBook.sol";
import {SignalLib} from "../src/lib/SignalLib.sol";
import {ReceiptLib} from "../src/lib/ReceiptLib.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Drives random buys / resolutions / refunds / withdrawals / donations.
contract EscrowHandler is Test {
    EscrowInvariantsTest internal t;
    PerformanceEscrow internal escrow;
    OutcomeResolver internal resolver;
    MockERC20 internal usdt;
    address[] public actors;
    uint256[] public ids;
    mapping(uint256 => SignalLib.Signal) internal sigs;
    uint256 internal nonce;

    constructor(EscrowInvariantsTest t_, PerformanceEscrow e, OutcomeResolver r, MockERC20 u, address[] memory a) {
        t = t_;
        escrow = e;
        resolver = r;
        usdt = u;
        actors = a;
    }

    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    function newSignal() external {
        (uint256 id, SignalLib.Signal memory s) = t.commitFor();
        ids.push(id);
        sigs[id] = s;
    }

    function buy(uint256 sidx, uint256 aidx) external {
        if (ids.length == 0) return;
        uint256 id = ids[sidx % ids.length];
        address sub = actors[aidx % actors.length];
        if (block.timestamp >= sigs[id].validUntil || !resolver.isOpen(id) || escrow.paid(id, sub) != 0) return;
        if (escrow.potOf(id).state != IPerformanceEscrow.PotState.OPEN) return;
        usdt.mint(sub, 1e6);
        vm.prank(sub);
        usdt.transfer(address(escrow), 1e6);
        bytes32 rh = keccak256(abi.encode("r", ++nonce));
        bytes memory sig = t.creditSigFor(id, sub, 1e6, rh);
        escrow.creditPayment(id, sub, address(usdt), 1e6, rh, bytes32(0), sig);
    }

    function resolve(uint256 sidx, bool win) external {
        if (ids.length == 0) return;
        uint256 id = ids[sidx % ids.length];
        SignalLib.Signal memory s = sigs[id];
        if (block.timestamp > s.validUntil || !resolver.isOpen(id)) return;
        if (escrow.potOf(id).state != IPerformanceEscrow.PotState.OPEN) return;
        uint256 px = win ? s.takeProfit + 1 : s.stopLoss - 1;
        resolver.proveTouch(id, s, win ? 0 : 1, abi.encode(s.market, px, uint64(block.timestamp)));
        vm.warp(block.timestamp + 11 minutes);
        resolver.finalize(id);
        escrow.settle(id);
    }

    function refundLate(uint256 sidx) external {
        if (ids.length == 0) return;
        uint256 id = ids[sidx % ids.length];
        if (escrow.potOf(id).state != IPerformanceEscrow.PotState.OPEN) return;
        vm.warp(sigs[id].validUntil + 24 hours + 1);
        escrow.claimRefund(id);
    }

    function donate(uint96 amount) external {
        amount = uint96(bound(amount, 0, 5e6));
        usdt.mint(address(escrow), amount);
    }

    function withdraw(uint256 aidx) external {
        address a = aidx % 3 == 0 ? t.treasuryAddr() : (aidx % 3 == 1 ? t.payoutAddr() : actors[aidx % actors.length]);
        if (escrow.claimable(a, address(usdt)) == 0) return;
        escrow.withdrawFor(a, address(usdt));
    }
}

contract EscrowInvariantsTest is EscrowFixture {
    EscrowHandler internal handler;
    address[] internal actors;

    function setUp() public {
        _deployFull();
        _registerProvider(provider, false);
        _bond(provider, 1_000_000e6);
        for (uint256 i; i < 5; ++i) {
            actors.push(address(uint160(0xA000 + i)));
        }
        handler = new EscrowHandler(this, escrow, resolver, usdt, actors);
        targetContract(address(handler));
    }

    // helpers callable by the handler
    function commitFor() external returns (uint256 id, SignalLib.Signal memory s) {
        oracle.push(BTC, BTC_PRICE, uint64(vm.getBlockTimestamp()));
        s = _longSignal(provider, 1e6);
        id = _commit(s, providerKey);
    }

    function creditSigFor(uint256 id, address sub, uint256 amount, bytes32 rh) external view returns (bytes memory) {
        return _creditSig(creditKey, id, sub, address(usdt), amount, rh, bytes32(0));
    }

    function treasuryAddr() external view returns (address) {
        return treasury;
    }

    function payoutAddr() external view returns (address) {
        return payout;
    }

    function invariant_creditedLeReceived() public view {
        assertLe(escrow.credited(address(usdt)), escrow.received(address(usdt)));
    }

    function invariant_solvent() public view {
        assertGe(usdt.balanceOf(address(escrow)), escrow.liabilities(address(usdt)));
    }

    /// liabilities == every claimable balance + every open pot
    function invariant_liabilitiesAccounted() public view {
        uint256 sum = escrow.claimable(treasury, address(usdt)) + escrow.claimable(payout, address(usdt));
        for (uint256 i; i < actors.length; ++i) {
            sum += escrow.claimable(actors[i], address(usdt));
        }
        uint256 n = handler.idsLength();
        for (uint256 i; i < n; ++i) {
            PerformanceEscrow.Pot memory p = escrow.potOf(handler.ids(i));
            if (p.state == IPerformanceEscrow.PotState.OPEN) sum += p.totalPaid;
        }
        assertEq(sum, escrow.liabilities(address(usdt)));
    }

    /// bond lock always equals open subscribers x slash
    function invariant_bondLockMatchesOpenPots() public view {
        uint256 locked;
        uint256 n = handler.idsLength();
        for (uint256 i; i < n; ++i) {
            PerformanceEscrow.Pot memory p = escrow.potOf(handler.ids(i));
            if (p.state == IPerformanceEscrow.PotState.OPEN) locked += p.slashPerSub * p.subs;
        }
        assertEq(registry.getProvider(provider).bondLocked, locked);
    }
}

/// @dev Token that tries to re-enter the escrow during a transfer.
contract ReentrantToken is ERC20 {
    PerformanceEscrow public target;
    bool public reentered;
    bool public attempted;

    constructor() ERC20("Evil", "EVIL") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 a) external {
        _mint(to, a);
    }

    function arm(PerformanceEscrow e) external {
        target = e;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (address(target) != address(0) && from == address(target) && !attempted) {
            attempted = true;
            try target.withdrawFor(to, address(this)) {
                reentered = true;
            } catch {}
        }
    }
}

contract EscrowReentrancyTest is EscrowFixture {
    function test_reentrancyBlocked() public {
        _deployFull();
        _registerProvider(provider, false);
        _bond(provider, 100e6);
        ReentrantToken evil = new ReentrantToken();
        vm.prank(admin);
        escrow.setAllowedToken(address(evil), true);
        SignalLib.Signal memory s = _longSignal(provider, 1e6);
        uint256 id = _commit(s, providerKey);
        address alice = makeAddr("alice");
        evil.mint(address(escrow), 1e6);
        bytes memory sig = _creditSig(creditKey, id, alice, address(evil), 1e6, bytes32("r"), bytes32(0));
        escrow.creditPayment(id, alice, address(evil), 1e6, bytes32("r"), bytes32(0), sig);
        _touch(id, s, 1, 80_100e8, t0 + 100);
        escrow.settle(id);
        evil.arm(escrow);
        escrow.withdrawFor(alice, address(evil));
        assertTrue(evil.attempted());
        assertFalse(evil.reentered());
        assertEq(evil.balanceOf(alice), 1e6);
        assertEq(escrow.claimable(alice, address(evil)), 0);
    }
}
