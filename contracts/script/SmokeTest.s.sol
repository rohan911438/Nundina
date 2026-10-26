// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IdentityRegistry} from "../src/erc8004/IdentityRegistry.sol";
import {ProviderRegistry} from "../src/ProviderRegistry.sol";
import {SignalBook} from "../src/SignalBook.sol";
import {OutcomeResolver} from "../src/OutcomeResolver.sol";
import {ISignalBook} from "../src/interfaces/ISignalBook.sol";
import {SignalLib} from "../src/lib/SignalLib.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice On-chain smoke: register -> bond -> commit (via relayer) -> reveal, with tiny amounts.
/// @dev forge script script/SmokeTest.s.sol --rpc-url <rpc> --broadcast
contract SmokeTest is Script {
    function run() external {
        string memory json =
            vm.readFile(string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json"));
        IdentityRegistry identity = IdentityRegistry(vm.parseJsonAddress(json, ".IdentityRegistry"));
        ProviderRegistry registry = ProviderRegistry(vm.parseJsonAddress(json, ".ProviderRegistry"));
        SignalBook book = SignalBook(vm.parseJsonAddress(json, ".SignalBook"));
        OutcomeResolver resolver = OutcomeResolver(vm.parseJsonAddress(json, ".OutcomeResolver"));
        address usdt = vm.parseJsonAddress(json, ".USDT");

        uint256 providerKey = vm.envOr("SMOKE_PROVIDER_KEY", vm.envUint("DEPLOYER_PRIVATE_KEY"));
        uint256 relayerKey = vm.envOr("RELAYER_PRIVATE_KEY", vm.envUint("DEPLOYER_PRIVATE_KEY"));
        address provider = vm.addr(providerKey);
        bytes32 market = keccak256("BTC/USD");
        uint256 spot = resolver.spotPrice(market);
        console.log("spot BTC/USD (8d)", spot);

        vm.startBroadcast(providerKey);
        if (!registry.isRegistered(provider)) {
            uint256 agentId = identity.register("https://nundina.xyz/agents/smoke.json");
            registry.register(agentId, provider, keccak256("@nundina_smoke"), false);
        }
        uint256 bond = 1e6;
        if (block.chainid != 177) MockERC20(usdt).mint(provider, bond);
        if (IERC20(usdt).balanceOf(provider) >= bond) {
            IERC20(usdt).approve(address(registry), bond);
            registry.depositBond(bond);
        }
        vm.stopBroadcast();

        SignalLib.Signal memory s;
        s.provider = provider;
        s.market = market;
        s.side = SignalLib.LONG;
        s.entry = spot;
        s.stopLoss = spot * 99 / 100;
        s.takeProfit = spot * 102 / 100;
        s.validUntil = uint64(block.timestamp + 1 hours);
        s.pricePerSub = 0;
        s.salt = keccak256(abi.encode("smoke", block.timestamp));
        bytes32 commitHash = book.hashSignal(s);
        ISignalBook.CommitAuthorization memory a = ISignalBook.CommitAuthorization({
            provider: provider,
            commitHash: commitHash,
            market: market,
            validUntil: s.validUntil,
            pricePerSub: 0,
            nonce: book.nonces(provider),
            deadline: uint64(block.timestamp + 30 minutes)
        });
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                book.domainSeparator(),
                keccak256(
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
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(providerKey, digest);

        vm.startBroadcast(relayerKey);
        uint256 id = book.commit(a, abi.encodePacked(r, ss, v), new uint256[](0), new uint16[](0), "smoke://");
        book.reveal(id, s);
        vm.stopBroadcast();

        require(book.isRevealed(id), "smoke: not revealed");
        console.log("smoke OK, signal id", id);
    }
}
