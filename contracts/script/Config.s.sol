// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";

/// @notice Per-chain deployment configuration.
contract Config is Script {
    struct NetConfig {
        string name;
        bool mocks; // deploy MockPriceAdapter (local + testnet)
        address usdt; // address(0) = deploy a mock token (local)
        address usdcE; // address(0) = deploy a mock token (local)
        address aproBtc;
        address aproHsk;
        address supraPull;
        address supraStorage;
        uint64 timelockDelay;
        bool touchProofs;
        uint256 maxPricePerSub; // 6 decimals
        uint64 pushStaleness;
        uint256 maxSubscribers; // per signal
    }

    struct Actors {
        address deployer;
        address relayer;
        address creditSigner;
        address treasury;
        address kycIssuer;
        address keeper;
    }

    function netConfig(uint256 chainId) public pure returns (NetConfig memory c) {
        if (chainId == 177) {
            c = NetConfig({
                name: "hashkey-mainnet",
                mocks: false,
                usdt: 0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029,
                usdcE: 0x054ed45810DbBAb8B27668922D110669c9D88D0a,
                aproBtc: 0x204ED500ab56A2E19B051561258E3A45c850360F,
                aproHsk: 0x86CE42c1b714149Dc3A7b17169EF67b5F78A224b,
                supraPull: 0x16f70cAD28dd621b0072B5A8a8c392970E87C3dD,
                supraStorage: 0x58e158c74DF7Ad6396C0dcbadc4878faC9e93d57,
                timelockDelay: 24 hours,
                touchProofs: false, // see ORACLES.md: enable once Supra proof API is confirmed
                maxPricePerSub: 5e6, // $5 cap for the mainnet MVP
                pushStaleness: 26 hours,
                maxSubscribers: 50 // mainnet MVP cap
            });
        } else if (chainId == 133) {
            c = NetConfig({
                name: "hashkey-testnet",
                mocks: true,
                // HSP merchant gateway testnet tokens (hashkey-merchant.github.io onboarding table)
                usdt: 0x372325443233fEbaC1F6998aC750276468c83CC6, // Permit2
                usdcE: 0x8FE3cB719Ee4410E236Cd6b72ab1fCDC06eF53c6, // EIP-3009
                aproBtc: address(0),
                aproHsk: address(0),
                supraPull: address(0),
                supraStorage: address(0),
                timelockDelay: 1 hours,
                touchProofs: true,
                maxPricePerSub: 50e6,
                pushStaleness: 2 hours,
                maxSubscribers: 200
            });
        } else {
            c = NetConfig({
                name: "local",
                mocks: true,
                usdt: address(0),
                usdcE: address(0),
                aproBtc: address(0),
                aproHsk: address(0),
                supraPull: address(0),
                supraStorage: address(0),
                timelockDelay: 1 hours,
                touchProofs: true,
                maxPricePerSub: 50e6,
                pushStaleness: 2 hours,
                maxSubscribers: 200
            });
        }
    }

    /// @dev Reads actor addresses from env; each defaults to the deployer.
    function actors(address deployer) public view returns (Actors memory a) {
        a.deployer = deployer;
        a.relayer = vm.envOr("RELAYER_ADDRESS", deployer);
        a.creditSigner = vm.envOr("CREDIT_SIGNER_ADDRESS", deployer);
        a.treasury = vm.envOr("TREASURY_ADDRESS", deployer);
        a.kycIssuer = vm.envOr("KYC_ISSUER_ADDRESS", deployer);
        a.keeper = vm.envOr("KEEPER_ADDRESS", deployer);
    }
}
