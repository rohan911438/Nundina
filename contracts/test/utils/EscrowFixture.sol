// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Fixtures} from "./Fixtures.sol";
import {OutcomeResolver} from "../../src/OutcomeResolver.sol";
import {PerformanceEscrow} from "../../src/PerformanceEscrow.sol";
import {RevenueRouter} from "../../src/RevenueRouter.sol";
import {SignerCreditVerifier} from "../../src/SignerCreditVerifier.sol";
import {IOutcomeResolver} from "../../src/interfaces/IOutcomeResolver.sol";
import {ICreditVerifier, IRevenueRouter} from "../../src/interfaces/IPerformanceEscrow.sol";
import {IReputationRegistry} from "../../src/interfaces/IERC8004.sol";
import {SignalLib} from "../../src/lib/SignalLib.sol";
import {ReceiptLib} from "../../src/lib/ReceiptLib.sol";
import {MockPriceAdapter} from "../../src/oracles/MockPriceAdapter.sol";
import {IPriceAdapter, ITouchVerifier} from "../../src/oracles/IPriceAdapter.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @dev Full system: registries, book, resolver (mock oracle), router, verifier, escrow.
abstract contract EscrowFixture is Fixtures {
    MockPriceAdapter internal oracle;
    OutcomeResolver internal resolver;
    RevenueRouter internal router;
    SignerCreditVerifier internal verifier;
    PerformanceEscrow internal escrow;
    address internal treasury = makeAddr("treasury");
    address internal creditSigner;
    uint256 internal creditKey;
    uint64 internal t0;
    uint256 internal receiptCounter;

    function _deployFull() internal {
        vm.warp(1_800_000_000);
        t0 = uint64(block.timestamp);
        (creditSigner, creditKey) = makeAddrAndKey("creditSigner");
        oracle = new MockPriceAdapter(address(this));
        oracle.push(BTC, BTC_PRICE, t0);
        oracle.setAcceptAll(true);
        resolver = new OutcomeResolver(admin, IPriceAdapter(address(oracle)), ITouchVerifier(address(oracle)), true);
        _deployCore(resolver);
        router = new RevenueRouter(book, resolver, registry, admin);
        verifier = new SignerCreditVerifier(admin, creditSigner);
        address[] memory tokens = new address[](2);
        tokens[0] = address(usdt);
        tokens[1] = address(usdc);
        escrow = new PerformanceEscrow(
            book,
            resolver,
            registry,
            IRevenueRouter(address(router)),
            IReputationRegistry(address(reputation)),
            ICreditVerifier(address(verifier)),
            treasury,
            admin,
            tokens,
            address(usdc)
        );
        vm.startPrank(admin);
        resolver.setBook(book);
        registry.setEscrow(address(escrow));
        router.setEscrow(address(escrow));
        reputation.grantRole(reputation.WRITER_ROLE(), address(escrow));
        vm.stopPrank();
    }

    function _creditSig(
        uint256 key,
        uint256 id,
        address sub,
        address token,
        uint256 amount,
        bytes32 receiptHash,
        bytes32 txHash
    ) internal view returns (bytes memory) {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                verifier.domainSeparator(),
                ReceiptLib.creditHash(id, sub, token, amount, receiptHash, txHash)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _recoverSig(address token, address payer, uint256 amount, bytes32 txHash)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01", verifier.domainSeparator(), ReceiptLib.recoverHash(token, payer, amount, txHash)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(creditKey, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev Subscriber transfers `amount` USDT to escrow, then the API credits it.
    function _buy(uint256 id, address sub, uint256 amount) internal returns (bytes32 receiptHash) {
        return _buyWith(id, sub, amount, usdt);
    }

    function _buyWith(uint256 id, address sub, uint256 amount, MockERC20 token) internal returns (bytes32 receiptHash) {
        token.mint(sub, amount);
        vm.prank(sub);
        token.transfer(address(escrow), amount);
        receiptHash = keccak256(abi.encode("receipt", ++receiptCounter));
        bytes32 txHash = keccak256(abi.encode("tx", receiptCounter));
        bytes memory sig = _creditSig(creditKey, id, sub, address(token), amount, receiptHash, txHash);
        escrow.creditPayment(id, sub, address(token), amount, receiptHash, txHash, sig);
    }

    function _touch(uint256 id, SignalLib.Signal memory s, uint8 level, uint256 price, uint64 ts) internal {
        resolver.proveTouch(id, s, level, abi.encode(s.market, price, ts));
        vm.warp(vm.getBlockTimestamp() + 11 minutes);
        resolver.finalize(id);
    }
}
