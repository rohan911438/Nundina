/** Events the indexer stores, per contract (names as in the ABIs). */
export const INDEXED_EVENTS = {
  ProviderRegistry: ["ProviderRegistered", "BondDeposited", "BondLocked", "BondUnlocked", "BondSlashed", "BondWithdrawn", "KycSet"],
  SignalBook: ["SignalCommitted", "SignalUpstream", "SignalRevealed", "SignalUnrevealed"],
  OutcomeResolver: ["TouchProven", "PendingExpiry", "Resolved"],
  PerformanceEscrow: ["PaymentCredited", "Settled", "Refunded", "Slashed", "Recovered"],
  RevenueRouter: ["Routed"],
  IdentityRegistry: ["Registered"],
  ReputationRegistry: ["NewFeedback"],
} as const;

export type IndexedContract = keyof typeof INDEXED_EVENTS;
