// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ICreditVerifier} from "./interfaces/IPerformanceEscrow.sol";
import {ReceiptLib} from "./lib/ReceiptLib.sol";

/// @title SignerCreditVerifier
/// @notice Accepts credits signed (EIP-712) by the API's credit signer, which signs only after
///         `HSPVerifier.verify()` returned ACCEPT for the payment. Signer is rotatable by the timelock.
contract SignerCreditVerifier is ICreditVerifier, AccessControl, EIP712 {
    address public signer;

    event SignerSet(address signer);

    constructor(address admin, address signer_) EIP712("NundinaEscrow", "1") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        signer = signer_;
        emit SignerSet(signer_);
    }

    /// @notice Rotates the credit signer (timelock).
    function setSigner(address signer_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        signer = signer_;
        emit SignerSet(signer_);
    }

    /// @inheritdoc ICreditVerifier
    function verifyCredit(
        uint256 signalId,
        address subscriber,
        address token,
        uint256 amount,
        bytes32 receiptHash,
        bytes32 txHash,
        bytes calldata sig
    ) external view returns (bool) {
        bytes32 digest = _hashTypedDataV4(
            ReceiptLib.creditHash(signalId, subscriber, token, amount, receiptHash, txHash)
        );
        return _isSigner(digest, sig);
    }

    /// @inheritdoc ICreditVerifier
    function verifyRecovery(address token, address payer, uint256 amount, bytes32 txHash, bytes calldata sig)
        external
        view
        returns (bool)
    {
        return _isSigner(_hashTypedDataV4(ReceiptLib.recoverHash(token, payer, amount, txHash)), sig);
    }

    /// @notice EIP-712 domain separator (for the API signer).
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _isSigner(bytes32 digest, bytes calldata sig) internal view returns (bool) {
        (address rec, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sig);
        return err == ECDSA.RecoverError.NoError && rec != address(0) && rec == signer;
    }
}
