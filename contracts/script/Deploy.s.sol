// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/console.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Config} from "./Config.s.sol";
import {IdentityRegistry} from "../src/erc8004/IdentityRegistry.sol";
import {ReputationRegistry} from "../src/erc8004/ReputationRegistry.sol";
import {ProviderRegistry} from "../src/ProviderRegistry.sol";
import {SignalBook} from "../src/SignalBook.sol";
import {OutcomeResolver} from "../src/OutcomeResolver.sol";
import {RevenueRouter} from "../src/RevenueRouter.sol";
import {PerformanceEscrow} from "../src/PerformanceEscrow.sol";
import {SignerCreditVerifier} from "../src/SignerCreditVerifier.sol";
import {AproPushAdapter} from "../src/oracles/AproPushAdapter.sol";
import {SupraPushAdapter, ISupraSValueFeed} from "../src/oracles/SupraPushAdapter.sol";
import {SupraPullAdapter} from "../src/oracles/SupraPullAdapter.sol";
import {FallbackPriceAdapter} from "../src/oracles/FallbackPriceAdapter.sol";
import {MockPriceAdapter} from "../src/oracles/MockPriceAdapter.sol";
import {IPriceAdapter, ITouchVerifier, ISupraOraclePull} from "../src/oracles/IPriceAdapter.sol";
import {IIdentityRegistry, IReputationRegistry} from "../src/interfaces/IERC8004.sol";
import {ICreditVerifier, IRevenueRouter} from "../src/interfaces/IPerformanceEscrow.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";
import {MockERC3009} from "../test/mocks/MockERC3009.sol";

/// @notice Deploys the full Nundina system in the order of Architecture/04 §4.5.
/// @dev forge script script/Deploy.s.sol --rpc-url <rpc> --broadcast [--verify ...]
///      Mainnet requires CONFIRM_MAINNET=yes and a deployer balance >= 1.5x the gas estimate.
contract Deploy is Config {
    bytes32 constant BTC = keccak256("BTC/USD");
    bytes32 constant HSK = keccak256("HSK/USD");

    struct Out {
        address timelock;
        address identity;
        address reputation;
        address pushAdapter;
        address aproAdapter;
        address supraPushAdapter;
        address touchVerifier;
        address resolver;
        address registry;
        address book;
        address router;
        address verifier;
        address escrow;
        address usdt;
        address usdcE;
        uint256 startBlock;
    }

    function run() external returns (Out memory o) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        NetConfig memory c = netConfig(block.chainid);
        Actors memory a = actors(deployer);
        _guard(c, deployer);
        console.log("Deploying Nundina to", c.name, "chainId", block.chainid);
        console.log("deployer", deployer);
        o.startBlock = block.number;

        vm.startBroadcast(pk);
        o = _deploy(c, a, o);
        _wire(c, a, o);
        _handOver(o, deployer);
        vm.stopBroadcast();

        if (!vm.envOr("DRY_RUN", false)) _write(o);
    }

    function _guard(NetConfig memory c, address deployer) internal view {
        if (block.chainid != 177) return;
        require(
            keccak256(bytes(vm.envOr("CONFIRM_MAINNET", string("")))) == keccak256("yes"), "set CONFIRM_MAINNET=yes"
        );
        uint256 gasEstimate = vm.envOr("ESTIMATED_DEPLOY_GAS", uint256(40_000_000));
        uint256 cost = gasEstimate * tx.gasprice;
        console.log("estimated deploy cost (wei)", cost);
        console.log("deployer balance (wei)", deployer.balance);
        if (!vm.envOr("DRY_RUN", false)) require(deployer.balance * 2 >= cost * 3, "deployer balance < 1.5x estimate");
        require(!c.mocks, "mocks on mainnet");
    }

    function _deploy(NetConfig memory c, Actors memory a, Out memory o) internal returns (Out memory) {
        // 1. timelock: proposer/executor = deployer EOA for the hackathon (documented in DEPLOYMENTS.md)
        address[] memory pe = new address[](1);
        pe[0] = a.deployer;
        o.timelock = address(new TimelockController(c.timelockDelay, pe, pe, address(0)));

        // tokens
        if (c.mocks) {
            o.usdt = address(new MockERC20("Tether USD (test)", "USDT", 6));
            o.usdcE = address(new MockERC3009("Bridged USDC (test)", "USDC.e"));
        } else {
            o.usdt = c.usdt;
            o.usdcE = c.usdcE;
        }

        // 2. ERC-8004 (canonical CREATE2 address not reproducible: deployed normally)
        o.identity = address(new IdentityRegistry());
        o.reputation = address(new ReputationRegistry(IIdentityRegistry(o.identity), a.deployer));

        // 3. oracle adapters
        if (c.mocks) {
            MockPriceAdapter m = new MockPriceAdapter(a.deployer);
            m.grantRole(m.UPDATER_ROLE(), a.keeper);
            m.push(BTC, 81_500e8, uint64(block.timestamp));
            m.push(HSK, 0.0873e8, uint64(block.timestamp));
            m.setMaxStaleness(c.pushStaleness);
            o.pushAdapter = address(m);
            o.touchVerifier = address(m);
        } else {
            AproPushAdapter apro = new AproPushAdapter(a.deployer);
            apro.setFeed(BTC, c.aproBtc, c.pushStaleness);
            apro.setFeed(HSK, c.aproHsk, c.pushStaleness);
            SupraPushAdapter sp = new SupraPushAdapter(ISupraSValueFeed(c.supraStorage), a.deployer, c.pushStaleness);
            sp.setPair(BTC, 0);
            o.aproAdapter = address(apro);
            o.supraPushAdapter = address(sp);
            o.pushAdapter = address(new FallbackPriceAdapter(apro, sp));
            SupraPullAdapter pull = new SupraPullAdapter(ISupraOraclePull(c.supraPull), a.deployer);
            pull.setPair(BTC, 0);
            o.touchVerifier = address(pull);
        }

        // 4. resolver
        o.resolver = address(
            new OutcomeResolver(
                a.deployer, IPriceAdapter(o.pushAdapter), ITouchVerifier(o.touchVerifier), c.touchProofs
            )
        );

        // 5. registry
        address[] memory tokens = new address[](2);
        tokens[0] = o.usdt;
        tokens[1] = o.usdcE;
        o.registry = address(new ProviderRegistry(IIdentityRegistry(o.identity), a.deployer, tokens, a.kycIssuer));

        // 6. book
        o.book = address(new SignalBook(ProviderRegistry(o.registry), a.deployer, c.maxPricePerSub));

        // 7. router
        o.router = address(
            new RevenueRouter(SignalBook(o.book), OutcomeResolver(o.resolver), ProviderRegistry(o.registry), a.deployer)
        );

        // 8. escrow
        o.verifier = address(new SignerCreditVerifier(a.deployer, a.creditSigner));
        o.escrow = address(
            new PerformanceEscrow(
                SignalBook(o.book),
                OutcomeResolver(o.resolver),
                ProviderRegistry(o.registry),
                IRevenueRouter(o.router),
                IReputationRegistry(o.reputation),
                ICreditVerifier(o.verifier),
                a.treasury,
                a.deployer,
                tokens,
                o.usdcE
            )
        );
        return o;
    }

    function _wire(NetConfig memory c, Actors memory a, Out memory o) internal {
        SignalBook book = SignalBook(o.book);
        book.grantRole(book.RELAYER_ROLE(), a.relayer);
        book.setResolver(OutcomeResolver(o.resolver));
        OutcomeResolver(o.resolver).setBook(book);
        ProviderRegistry(o.registry).setEscrow(o.escrow);
        RevenueRouter(o.router).setEscrow(o.escrow);
        ReputationRegistry rep = ReputationRegistry(o.reputation);
        rep.grantRole(rep.WRITER_ROLE(), o.escrow);
        PerformanceEscrow(o.escrow).setMaxSubscribers(c.maxSubscribers);
    }

    /// @dev 10. Every admin role goes to the timelock; the deployer renounces.
    function _handOver(Out memory o, address deployer) internal {
        address[] memory acs = new address[](9);
        acs[0] = o.reputation;
        acs[1] = o.resolver;
        acs[2] = o.registry;
        acs[3] = o.book;
        acs[4] = o.router;
        acs[5] = o.verifier;
        acs[6] = o.escrow;
        acs[7] = o.aproAdapter != address(0) ? o.aproAdapter : o.pushAdapter;
        acs[8] = o.touchVerifier != o.pushAdapter ? o.touchVerifier : address(0);
        for (uint256 i; i < acs.length; ++i) {
            if (acs[i] == address(0)) continue;
            AccessControl ac = AccessControl(acs[i]);
            ac.grantRole(0x00, o.timelock);
            ac.renounceRole(0x00, deployer);
        }
        if (o.supraPushAdapter != address(0)) {
            AccessControl(o.supraPushAdapter).grantRole(0x00, o.timelock);
            AccessControl(o.supraPushAdapter).renounceRole(0x00, deployer);
        }
    }

    function _write(Out memory o) internal {
        string memory k = "d";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "startBlock", o.startBlock);
        vm.serializeAddress(k, "Timelock", o.timelock);
        vm.serializeAddress(k, "IdentityRegistry", o.identity);
        vm.serializeAddress(k, "ReputationRegistry", o.reputation);
        vm.serializeAddress(k, "PushPriceAdapter", o.pushAdapter);
        vm.serializeAddress(k, "AproPushAdapter", o.aproAdapter);
        vm.serializeAddress(k, "SupraPushAdapter", o.supraPushAdapter);
        vm.serializeAddress(k, "TouchVerifier", o.touchVerifier);
        vm.serializeAddress(k, "OutcomeResolver", o.resolver);
        vm.serializeAddress(k, "ProviderRegistry", o.registry);
        vm.serializeAddress(k, "SignalBook", o.book);
        vm.serializeAddress(k, "RevenueRouter", o.router);
        vm.serializeAddress(k, "SignerCreditVerifier", o.verifier);
        vm.serializeAddress(k, "PerformanceEscrow", o.escrow);
        vm.serializeAddress(k, "USDT", o.usdt);
        string memory json = vm.serializeAddress(k, "USDC_E", o.usdcE);
        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
        console.log("wrote", path);
    }
}
