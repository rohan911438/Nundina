// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IOutcomeResolver} from "./interfaces/IOutcomeResolver.sol";
import {ISignalBook} from "./interfaces/ISignalBook.sol";
import {SignalLib} from "./lib/SignalLib.sol";
import {IPriceAdapter, ITouchVerifier} from "./oracles/IPriceAdapter.sol";

/// @title OutcomeResolver
/// @notice Decides each signal's outcome from oracle data without trusting the caller.
///         TP/SL touches are proven with signed pull-oracle proofs; the earliest valid touch wins
///         after a challenge window. Untouched signals are marked to market at expiry (0.5R rule).
///         Every resolution call carries the plaintext signal, so resolution doubles as reveal.
contract OutcomeResolver is IOutcomeResolver, AccessControl, ReentrancyGuard {
    uint8 public constant TP = 0;
    uint8 public constant SL = 1;
    uint8 public constant ENTRY = 2;
    uint8 public constant EXPIRY = 3;
    uint64 public constant CHALLENGE_WINDOW = 10 minutes;
    uint64 public constant EXPIRY_PROOF_TOLERANCE = 5 minutes;

    struct State {
        Outcome outcome; // provisional until final_
        bool final_;
        uint8 pendingLevel;
        uint64 pendingTs; // oracle timestamp of the pending event (0 = none)
        uint64 pendingAt; // block time the pending event was recorded
        uint64 entryTouchedAt;
        uint64 decidedAt;
        int256 rX100;
        uint256 pendingPrice;
    }

    ISignalBook public book;
    IPriceAdapter public pushAdapter;
    ITouchVerifier public touchVerifier;
    /// @notice When false, every signal resolves at expiry via the push feed (agreed cut rule).
    bool public touchProofsEnabled;

    mapping(uint256 id => State) internal _state;

    error BookAlreadySet();
    error TouchProofsDisabled();
    error AlreadyFinal();
    error Unrevealed();
    error HashMismatch();
    error OutsideWindow();
    error NotLimit();
    error EntryAlreadyTouched();
    error EntryNotTouched();
    error NotCrossed();
    error BadLevel();
    error NothingPending();
    error ChallengeWindowOpen();
    error NotExpired();
    error TouchPending();

    event PendingExpiry(uint256 indexed id, Outcome outcome, int256 rX100);
    event AdaptersSet(address pushAdapter, address touchVerifier, bool touchProofsEnabled);

    constructor(address admin, IPriceAdapter push, ITouchVerifier touch, bool touchEnabled) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        pushAdapter = push;
        touchVerifier = touch;
        touchProofsEnabled = touchEnabled;
        emit AdaptersSet(address(push), address(touch), touchEnabled);
    }

    // ───────────────────────── admin (timelock) ─────────────────────────

    /// @notice Wires the SignalBook once.
    function setBook(ISignalBook book_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(book) != address(0)) revert BookAlreadySet();
        book = book_;
    }

    /// @notice Replaces oracle adapters and toggles touch proofs (timelocked).
    function setAdapters(IPriceAdapter push, ITouchVerifier touch, bool touchEnabled)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        pushAdapter = push;
        touchVerifier = touch;
        touchProofsEnabled = touchEnabled;
        emit AdaptersSet(address(push), address(touch), touchEnabled);
    }

    // ───────────────────────── resolution ─────────────────────────

    /// @notice Proves that a level (TP, SL or a limit ENTRY) was touched, using a pull-oracle proof.
    /// @param id Signal id.
    /// @param s Plaintext signal (revealed here if not yet revealed).
    /// @param level 0 = TP, 1 = SL, 2 = ENTRY (limit signals).
    /// @param proof Oracle proof bytes passed to the touch verifier.
    function proveTouch(uint256 id, SignalLib.Signal calldata s, uint8 level, bytes calldata proof)
        external
        nonReentrant
    {
        if (!touchProofsEnabled) revert TouchProofsDisabled();
        State storage st = _state[id];
        if (st.final_) revert AlreadyFinal();
        ISignalBook.Record memory r = _ensureRevealed(id, s);

        (uint256 price, uint64 ts) = touchVerifier.verifyTouch(r.market, proof);
        if (ts < r.committedAt || ts > r.validUntil) revert OutsideWindow();
        bool limit = book.isLimit(id);

        if (level == ENTRY) {
            if (!limit) revert NotLimit();
            if (st.entryTouchedAt != 0) revert EntryAlreadyTouched();
            bool crossed = s.entry < r.oraclePriceAtCommit ? price <= s.entry : price >= s.entry;
            if (!crossed) revert NotCrossed();
            st.entryTouchedAt = ts;
            if (st.pendingLevel == EXPIRY && st.pendingTs != 0) _clearPending(st); // VOID no longer valid
            emit TouchProven(id, level, price, ts);
            return;
        }
        if (level > SL) revert BadLevel();
        if (limit && (st.entryTouchedAt == 0 || ts <= st.entryTouchedAt)) revert EntryNotTouched();
        if (!_crossed(s, level, price)) revert NotCrossed();

        // Earliest touch wins. A pending expiry mark is always overridden by a real touch.
        if (st.pendingTs == 0 || st.pendingLevel == EXPIRY || ts < st.pendingTs) {
            st.pendingLevel = level;
            st.pendingTs = ts;
            st.pendingAt = uint64(block.timestamp);
            st.pendingPrice = price;
            st.outcome = level == TP ? Outcome.WIN : Outcome.LOSS;
            st.rX100 = level == TP ? _rX100(s, s.takeProfit) : -100;
            emit TouchProven(id, level, price, ts);
        }
    }

    /// @notice Alias kept for the interface in Architecture/04: submit an earlier counter-proof.
    function challenge(uint256 id, SignalLib.Signal calldata s, uint8 level, bytes calldata earlierProof) external {
        this.proveTouch(id, s, level, earlierProof);
    }

    /// @notice Finalizes a pending touch or expiry mark once the challenge window has passed.
    function finalize(uint256 id) external {
        State storage st = _state[id];
        if (st.final_) revert AlreadyFinal();
        if (st.pendingTs == 0) revert NothingPending();
        if (block.timestamp < uint256(st.pendingAt) + CHALLENGE_WINDOW) revert ChallengeWindowOpen();
        st.final_ = true;
        st.decidedAt = st.pendingTs;
        emit Resolved(id, st.outcome, st.rX100);
    }

    /// @notice Marks an untouched signal to market at its expiry using the push feed.
    /// @param id Signal id.
    /// @param s Plaintext signal (revealed here if needed).
    /// @param roundIdHint Push-feed round in effect at `validUntil` (only needed if a newer round exists).
    function resolveAtExpiry(uint256 id, SignalLib.Signal calldata s, uint80 roundIdHint) external nonReentrant {
        (State storage st, ISignalBook.Record memory r) = _expiryPre(id, s);
        if (_isVoid(id, st)) return _setExpiry(id, st, r, Outcome.VOID, 0);
        uint256 price = pushAdapter.priceAt(r.market, r.validUntil, roundIdHint);
        _markToMarket(id, st, r, s, price);
    }

    /// @notice Same as `resolveAtExpiry` but prices the expiry with a pull-oracle proof whose timestamp
    ///         lies in [validUntil, validUntil + EXPIRY_PROOF_TOLERANCE]. Used when the push feed has
    ///         already published a newer round and history is not readable on-chain.
    function resolveAtExpiryWithProof(uint256 id, SignalLib.Signal calldata s, bytes calldata proof)
        external
        nonReentrant
    {
        (State storage st, ISignalBook.Record memory r) = _expiryPre(id, s);
        if (_isVoid(id, st)) return _setExpiry(id, st, r, Outcome.VOID, 0);
        (uint256 price, uint64 ts) = touchVerifier.verifyTouch(r.market, proof);
        if (ts < r.validUntil || ts > r.validUntil + EXPIRY_PROOF_TOLERANCE) revert OutsideWindow();
        _markToMarket(id, st, r, s, price);
    }

    // ───────────────────────── views ─────────────────────────

    /// @inheritdoc IOutcomeResolver
    function outcomeOf(uint256 id) external view returns (Outcome, int256, bool) {
        if (book.statusOf(id) == ISignalBook.Status.UNREVEALED_LOSS) return (Outcome.LOSS, -100, true);
        State storage st = _state[id];
        return (st.outcome, st.rX100, st.final_);
    }

    /// @inheritdoc IOutcomeResolver
    function decidedAt(uint256 id) external view returns (uint64) {
        if (book.statusOf(id) == ISignalBook.Status.UNREVEALED_LOSS) return book.getSignal(id).validUntil;
        return _state[id].decidedAt;
    }

    /// @inheritdoc IOutcomeResolver
    function isOpen(uint256 id) external view returns (bool) {
        State storage st = _state[id];
        return st.pendingTs == 0 && st.outcome == Outcome.NONE && !st.final_
            && book.statusOf(id) != ISignalBook.Status.UNREVEALED_LOSS;
    }

    /// @notice Full resolution state of a signal.
    function stateOf(uint256 id) external view returns (State memory) {
        return _state[id];
    }

    /// @inheritdoc IOutcomeResolver
    function spotPrice(bytes32 market) external view returns (uint256 price) {
        (price,) = pushAdapter.spotPrice(market);
    }

    // ───────────────────────── internals ─────────────────────────

    function _ensureRevealed(uint256 id, SignalLib.Signal calldata s) internal returns (ISignalBook.Record memory r) {
        r = book.getSignal(id);
        if (r.status == ISignalBook.Status.UNREVEALED_LOSS || r.status == ISignalBook.Status.NONE) revert Unrevealed();
        if (r.status == ISignalBook.Status.COMMITTED) {
            book.revealFor(id, s);
        } else if (book.hashSignal(s) != r.commitHash) {
            revert HashMismatch();
        }
    }

    function _expiryPre(uint256 id, SignalLib.Signal calldata s)
        internal
        returns (State storage st, ISignalBook.Record memory r)
    {
        st = _state[id];
        if (st.final_) revert AlreadyFinal();
        if (st.pendingTs != 0) revert TouchPending();
        r = _ensureRevealed(id, s);
        if (block.timestamp <= r.validUntil) revert NotExpired();
    }

    function _isVoid(uint256 id, State storage st) internal view returns (bool) {
        return book.isLimit(id) && st.entryTouchedAt == 0;
    }

    function _markToMarket(
        uint256 id,
        State storage st,
        ISignalBook.Record memory r,
        SignalLib.Signal calldata s,
        uint256 price
    ) internal {
        SignalLib.Signal memory m = _mem(s);
        int256 mv = SignalLib.move(m, price);
        uint256 risk = SignalLib.risk(m);
        _setExpiry(id, st, r, mv * 2 >= int256(risk) ? Outcome.WIN : Outcome.LOSS, mv * 100 / int256(risk));
    }

    function _setExpiry(uint256 id, State storage st, ISignalBook.Record memory r, Outcome o, int256 rx) internal {
        st.outcome = o;
        st.rX100 = rx;
        if (touchProofsEnabled) {
            // Leave room for an earlier touch proof to override the mark-to-market.
            st.pendingLevel = EXPIRY;
            st.pendingTs = r.validUntil;
            st.pendingAt = uint64(block.timestamp);
            emit PendingExpiry(id, o, rx);
        } else {
            st.final_ = true;
            st.decidedAt = r.validUntil;
            emit Resolved(id, o, rx);
        }
    }

    function _crossed(SignalLib.Signal calldata s, uint8 level, uint256 price) internal pure returns (bool) {
        bool long = s.side == SignalLib.LONG;
        if (level == TP) return long ? price >= s.takeProfit : price <= s.takeProfit;
        return long ? price <= s.stopLoss : price >= s.stopLoss;
    }

    function _rX100(SignalLib.Signal calldata s, uint256 exit) internal pure returns (int256) {
        SignalLib.Signal memory m = _mem(s);
        return SignalLib.move(m, exit) * 100 / int256(SignalLib.risk(m));
    }

    function _mem(SignalLib.Signal calldata s) internal pure returns (SignalLib.Signal memory) {
        return s;
    }

    function _clearPending(State storage st) internal {
        st.pendingLevel = 0;
        st.pendingTs = 0;
        st.pendingAt = 0;
        st.pendingPrice = 0;
        st.outcome = Outcome.NONE;
        st.rX100 = 0;
    }
}
