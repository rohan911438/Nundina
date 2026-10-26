// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IdentityRegistry} from "../../src/erc8004/IdentityRegistry.sol";
import {ReputationRegistry} from "../../src/erc8004/ReputationRegistry.sol";
import {ProviderRegistry} from "../../src/ProviderRegistry.sol";
import {SignalBook} from "../../src/SignalBook.sol";
import {ISignalBook} from "../../src/interfaces/ISignalBook.sol";
import {IIdentityRegistry} from "../../src/interfaces/IERC8004.sol";
import {IOutcomeResolver} from "../../src/interfaces/IOutcomeResolver.sol";
import {SignalLib} from "../../src/lib/SignalLib.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockResolver} from "../mocks/MockResolver.sol";

/// @dev Shared deployment + helpers for Nundina contract tests.
abstract contract Fixtures is Test {
    bytes32 internal constant BTC = keccak256("BTC/USD");
    bytes32 internal constant HSK = keccak256("HSK/USD");
    uint256 internal constant BTC_PRICE = 81_500e8;

    address internal admin = makeAddr("admin");
    address internal relayer = makeAddr("relayer");
    address internal kycIssuer;
    uint256 internal kycIssuerKey;
    address internal provider;
    uint256 internal providerKey;
    address internal payout = makeAddr("payout");

    MockERC20 internal usdt;
    MockERC20 internal usdc;
    IdentityRegistry internal identity;
    ReputationRegistry internal reputation;
    ProviderRegistry internal registry;
    SignalBook internal book;
    MockResolver internal mockResolver;

    uint256 internal saltCounter;

    function _deployCore(IOutcomeResolver resolver_) internal {
        (kycIssuer, kycIssuerKey) = makeAddrAndKey("kycIssuer");
        (provider, providerKey) = makeAddrAndKey("provider");
        usdt = new MockERC20("Tether", "USDT", 6);
        usdc = new MockERC20("Bridged USDC", "USDC.e", 6);
        identity = new IdentityRegistry();
        reputation = new ReputationRegistry(IIdentityRegistry(address(identity)), admin);
        address[] memory tokens = new address[](2);
        tokens[0] = address(usdt);
        tokens[1] = address(usdc);
        registry = new ProviderRegistry(IIdentityRegistry(address(identity)), admin, tokens, kycIssuer);
        book = new SignalBook(registry, admin, 5e6);
        vm.startPrank(admin);
        book.grantRole(book.RELAYER_ROLE(), relayer);
        book.setResolver(resolver_);
        vm.stopPrank();
    }

    function _deployWithMockResolver() internal {
        mockResolver = new MockResolver();
        mockResolver.setPrice(BTC, BTC_PRICE);
        mockResolver.setPrice(HSK, 0.0873e8);
        _deployCore(IOutcomeResolver(address(mockResolver)));
    }

    function _registerProvider(address who, bool practice) internal returns (uint256 agentId) {
        vm.startPrank(who);
        agentId = identity.register("ipfs://agent");
        registry.register(agentId, who == provider ? payout : who, keccak256("@handle"), practice);
        vm.stopPrank();
    }

    function _bond(address who, uint256 amount) internal {
        usdt.mint(who, amount);
        vm.startPrank(who);
        usdt.approve(address(registry), amount);
        registry.depositBond(amount);
        vm.stopPrank();
    }

    function _longSignal(address who, uint256 price) internal returns (SignalLib.Signal memory s) {
        s.provider = who;
        s.market = BTC;
        s.side = SignalLib.LONG;
        s.entry = 81_500e8;
        s.takeProfit = 84_000e8;
        s.stopLoss = 80_200e8;
        s.validUntil = uint64(block.timestamp + 1 days);
        s.pricePerSub = price;
        s.salt = keccak256(abi.encode("salt", ++saltCounter));
    }

    function _shortSignal(address who, uint256 price) internal returns (SignalLib.Signal memory s) {
        s = _longSignal(who, price);
        s.side = SignalLib.SHORT;
        s.takeProfit = 79_000e8;
        s.stopLoss = 82_800e8;
    }

    function _signAuth(uint256 key, ISignalBook.CommitAuthorization memory a) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                book.COMMIT_AUTH_TYPEHASH(),
                a.provider,
                a.commitHash,
                a.market,
                a.validUntil,
                a.pricePerSub,
                a.nonce,
                a.deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", book.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _auth(SignalLib.Signal memory s) internal view returns (ISignalBook.CommitAuthorization memory a) {
        a = ISignalBook.CommitAuthorization({
            provider: s.provider,
            commitHash: book.hashSignal(s),
            market: s.market,
            validUntil: s.validUntil,
            pricePerSub: s.pricePerSub,
            nonce: book.nonces(s.provider),
            deadline: uint64(block.timestamp + 10 minutes)
        });
    }

    function _commit(SignalLib.Signal memory s, uint256 key) internal returns (uint256 id) {
        ISignalBook.CommitAuthorization memory a = _auth(s);
        bytes memory sig = _signAuth(key, a);
        vm.prank(relayer);
        id = book.commit(a, sig, s.upstream, s.upstreamBps, "pg://cipher");
    }
}
