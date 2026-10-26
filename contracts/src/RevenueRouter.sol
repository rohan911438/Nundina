// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IRevenueRouter} from "./interfaces/IPerformanceEscrow.sol";
import {ISignalBook} from "./interfaces/ISignalBook.sol";
import {IOutcomeResolver} from "./interfaces/IOutcomeResolver.sol";
import {IProviderRegistry} from "./interfaces/IProviderRegistry.sol";

/// @title RevenueRouter
/// @notice Splits an aggregator's winning payout across its upstream providers, recursively
///         (depth <= 3). Shares of upstream signals that did not WIN stay with the aggregator
///         (policy LOSER_SHARE_TO_AGGREGATOR). Rounding dust goes to the aggregator.
///         The router never holds tokens: it returns the legs and the escrow credits them.
contract RevenueRouter is IRevenueRouter, AccessControl {
    uint8 public constant MAX_DEPTH = 3;
    uint256 internal constant MAX_LEGS = 160;
    /// @notice Policy marker: losing upstream shares go to the aggregator.
    bool public constant LOSER_SHARE_TO_AGGREGATOR = true;

    ISignalBook public immutable book;
    IOutcomeResolver public immutable resolver;
    IProviderRegistry public immutable registry;
    address public escrow;

    error NotEscrow();
    error EscrowAlreadySet();

    constructor(ISignalBook book_, IOutcomeResolver resolver_, IProviderRegistry registry_, address admin) {
        book = book_;
        resolver = resolver_;
        registry = registry_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Wires the escrow once.
    function setEscrow(address escrow_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (escrow != address(0)) revert EscrowAlreadySet();
        escrow = escrow_;
    }

    /// @inheritdoc IRevenueRouter
    function route(uint256 id, address, uint256 amount)
        external
        returns (address[] memory to, uint256[] memory amounts)
    {
        if (msg.sender != escrow) revert NotEscrow();
        uint256[] memory sources;
        (to, amounts, sources) = preview(id, amount);
        for (uint256 i; i < to.length; ++i) {
            emit Routed(id, sources[i], to[i], amounts[i]);
        }
    }

    /// @notice Computes the legs of a payout without moving anything.
    /// @return to Recipients. @return amounts Amounts (sum == amount). @return sources Signal id each leg pays for.
    function preview(uint256 id, uint256 amount)
        public
        view
        returns (address[] memory to, uint256[] memory amounts, uint256[] memory sources)
    {
        to = new address[](MAX_LEGS);
        amounts = new uint256[](MAX_LEGS);
        sources = new uint256[](MAX_LEGS);
        uint256 n = _route(id, amount, 0, to, amounts, sources, 0);
        assembly ("memory-safe") {
            mstore(to, n)
            mstore(amounts, n)
            mstore(sources, n)
        }
    }

    function _route(
        uint256 id,
        uint256 amount,
        uint8 depth,
        address[] memory t,
        uint256[] memory a,
        uint256[] memory src,
        uint256 n
    ) internal view returns (uint256) {
        (uint256[] memory up, uint16[] memory bps) = book.upstreamOf(id);
        uint256 remaining = amount;
        for (uint256 i; i < up.length; ++i) {
            uint256 share = amount * bps[i] / 10_000;
            (IOutcomeResolver.Outcome o,, bool fin) = resolver.outcomeOf(up[i]);
            if (!fin || o != IOutcomeResolver.Outcome.WIN || share == 0) continue;
            remaining -= share;
            (uint256[] memory upUp,) = book.upstreamOf(up[i]);
            if (upUp.length != 0 && depth + 1 < MAX_DEPTH) {
                n = _route(up[i], share, depth + 1, t, a, src, n);
            } else {
                t[n] = registry.payoutOf(book.providerOf(up[i]));
                a[n] = share;
                src[n] = up[i];
                ++n;
            }
        }
        if (remaining != 0) {
            t[n] = registry.payoutOf(book.providerOf(id));
            a[n] = remaining;
            src[n] = id;
            ++n;
        }
        return n;
    }
}
