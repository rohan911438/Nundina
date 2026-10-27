// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {SignerCreditVerifier} from "../src/SignerCreditVerifier.sol";
import {ReceiptLib} from "../src/lib/ReceiptLib.sol";

/// @dev Prompt 15 replay check: a credit signature is bound to chainId + verifying contract.
contract CreditDomainTest is Test {
    SignerCreditVerifier internal a;
    SignerCreditVerifier internal b;
    address internal signer;
    uint256 internal key;
    address internal sub = makeAddr("sub");
    address internal token = makeAddr("token");

    function setUp() public {
        (signer, key) = makeAddrAndKey("credit");
        a = new SignerCreditVerifier(address(this), signer);
        b = new SignerCreditVerifier(address(this), signer);
    }

    function _sig(SignerCreditVerifier v) internal view returns (bytes memory) {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01", v.domainSeparator(), ReceiptLib.creditHash(1, sub, token, 1e6, bytes32("r"), bytes32("t"))
            )
        );
        (uint8 v_, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v_);
    }

    function test_credit_boundToVerifyingContract() public view {
        bytes memory sig = _sig(a);
        assertTrue(a.verifyCredit(1, sub, token, 1e6, bytes32("r"), bytes32("t"), sig));
        assertFalse(b.verifyCredit(1, sub, token, 1e6, bytes32("r"), bytes32("t"), sig));
    }

    function test_credit_boundToChainId() public {
        bytes memory sig = _sig(a);
        vm.chainId(177);
        assertFalse(a.verifyCredit(1, sub, token, 1e6, bytes32("r"), bytes32("t"), sig));
    }

    function test_credit_fieldsBound() public view {
        bytes memory sig = _sig(a);
        assertFalse(a.verifyCredit(2, sub, token, 1e6, bytes32("r"), bytes32("t"), sig));
        assertFalse(a.verifyCredit(1, sub, token, 2e6, bytes32("r"), bytes32("t"), sig));
        assertFalse(a.verifyCredit(1, address(this), token, 1e6, bytes32("r"), bytes32("t"), sig));
    }
}
