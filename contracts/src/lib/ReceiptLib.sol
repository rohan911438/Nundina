// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ReceiptLib
/// @notice EIP-712 types for messages our API's credit signer issues after HSP verification.
library ReceiptLib {
    bytes32 internal constant CREDIT_TYPEHASH = keccak256(
        "Credit(uint256 signalId,address subscriber,address token,uint256 amount,bytes32 receiptHash,bytes32 txHash)"
    );
    bytes32 internal constant RECOVER_TYPEHASH =
        keccak256("Recover(address token,address payer,uint256 amount,bytes32 txHash)");

    /// @notice Struct hash of a Credit message.
    function creditHash(
        uint256 signalId,
        address subscriber,
        address token,
        uint256 amount,
        bytes32 receiptHash,
        bytes32 txHash
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(CREDIT_TYPEHASH, signalId, subscriber, token, amount, receiptHash, txHash));
    }

    /// @notice Struct hash of a Recover message.
    function recoverHash(address token, address payer, uint256 amount, bytes32 txHash) internal pure returns (bytes32) {
        return keccak256(abi.encode(RECOVER_TYPEHASH, token, payer, amount, txHash));
    }
}
