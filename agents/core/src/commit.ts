import { toPrice, toUnits } from "@nundina/shared";
import type { Proposal } from "./geometry.js";
import type { Nundina } from "./nundina.js";
import type { AgentWallet } from "./wallet.js";

/** Agent supply rules (prompt 13). */
export const SUPPLY = { maxPerDay: 6, minPriceUsd: 0.1, maxPriceUsd: 0.5, minRR: 1.5, minValidHours: 2, maxValidHours: 24 };

export const clampPrice = (usd: number) => Math.min(SUPPLY.maxPriceUsd, Math.max(SUPPLY.minPriceUsd, Math.round(usd * 100) / 100));
export const clampValidity = (h: number) => Math.min(SUPPLY.maxValidHours, Math.max(SUPPLY.minValidHours, h));

/**
 * Posts a signal through the same draft → prepare → sign → confirm path humans use; the agent
 * signs the CommitAuthorization with its own wallet.
 */
export async function commitProposal(
  api: Nundina,
  w: AgentWallet,
  p: Proposal,
  opts: { priceUsd: number; upstream?: string[]; upstreamBps?: number[]; validHours?: number },
) {
  const validHours = opts.validHours ?? clampValidity(p.validHours);
  const raw = `${p.market} ${p.side} ${p.entry}\nTP ${p.takeProfit}\nSL ${p.stopLoss}\n${p.rationale}`;
  const d = await api.draft(raw, { market: p.market, side: p.side, entry: String(p.entry), takeProfit: String(p.takeProfit), stopLoss: String(p.stopLoss), validHours, notes: [p.rationale] });
  const block = await w.pub.getBlock();
  const nowS = Math.max(Number(block.timestamp), Math.floor(Date.now() / 1000));
  const signal = {
    market: p.market,
    side: p.side,
    entry: toPrice(p.entry.toFixed(2)).toString(),
    takeProfit: toPrice(p.takeProfit.toFixed(2)).toString(),
    stopLoss: toPrice(p.stopLoss.toFixed(2)).toString(),
    validUntil: String(nowS + Math.round(validHours * 3600)),
    pricePerSub: toUnits(opts.priceUsd.toFixed(2)).toString(),
    upstream: opts.upstream ?? [],
    upstreamBps: opts.upstreamBps ?? [],
  };
  const prep = await api.prepare(d.id, signal);
  const td = prep.typedData;
  const providerSig = await w.account.signTypedData({
    domain: td.domain,
    types: td.types,
    primaryType: td.primaryType as "CommitAuthorization",
    message: {
      ...td.message,
      validUntil: BigInt(td.message.validUntil!),
      pricePerSub: BigInt(td.message.pricePerSub!),
      nonce: BigInt(td.message.nonce!),
      deadline: BigInt(td.message.deadline!),
    },
  });
  const ok = await api.confirm(d.id, { signal, commitAuth: td.message, providerSig });
  return { signalId: ok.signalId, draftId: d.id, signal };
}
