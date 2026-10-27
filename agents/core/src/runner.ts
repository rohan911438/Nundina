import { env } from "./env.js";
import { validGeometry, type Proposal } from "./geometry.js";
import { SUPPLY, clampPrice, clampValidity, commitProposal } from "./commit.js";
import { activityLog } from "./log.js";
import { Nundina } from "./nundina.js";
import { onboardProvider, topUpBond, type Profile } from "./onboard.js";
import { utcDay } from "./policy.js";
import { agentWallet, keyFromEnv } from "./wallet.js";
import { toUnits } from "@nundina/shared";

/** Runs `tick` every `intervalS` until SIGINT/SIGTERM; exits at once if AGENTS_DISABLED. */
export async function every(name: string, intervalS: number, tick: () => Promise<void>) {
  if (env().AGENTS_DISABLED) {
    console.log(`${name}: AGENTS_DISABLED=true, not starting`);
    return;
  }
  let stop = false;
  let wake: (() => void) | undefined;
  const halt = () => {
    stop = true;
    wake?.();
  };
  process.once("SIGINT", halt);
  process.once("SIGTERM", halt);
  while (!stop) {
    try {
      await tick();
    } catch (e) {
      console.error(`${name}: tick failed: ${(e as Error).message}`);
    }
    if (process.env.RUN_ONCE === "true") break;
    await new Promise<void>((r) => {
      wake = r;
      setTimeout(r, intervalS * 1000);
    });
  }
}

/** Supply rules every strategy proposal must meet before it is posted (prompt 13). */
export function supplyCheck(p: Proposal): string | null {
  if (!validGeometry({ ...p, validHours: clampValidity(p.validHours) }, SUPPLY.minRR)) return `geometry fails R:R ≥ ${SUPPLY.minRR} or level order`;
  return null;
}

export interface StrategySpec {
  profile: Profile;
  /** Seconds between looks at the market. */
  intervalS: number;
  priceUsd: number;
  /** Returns a proposal, or a reason for not posting. */
  propose: () => Promise<Proposal | { skip: string }>;
}

/**
 * A strategy provider: onboard once, then each tick propose → check the supply rules (≤ 6 a day,
 * one live signal at a time, R:R ≥ 1.5, 2–24 h validity, $0.10–0.50) → commit. Every outcome is
 * logged with its reason.
 */
export async function runStrategy(spec: StrategySpec) {
  const w = agentWallet(keyFromEnv(spec.profile.name));
  const root = new Nundina();
  const { agent } = await onboardProvider(root, w, spec.profile);
  const api = root.as(agent.id);
  const log = activityLog(api, spec.profile.name);
  console.log(`${spec.profile.name}: agent #${agent.id} @${spec.profile.handle} wallet ${w.address}`);

  await every(spec.profile.name, spec.intervalS, async () => {
    const me = await api.agent();
    if (me.paused) return log("skip", "paused by owner");
    const mine = await api.signalsBy(spec.profile.handle);
    const today = utcDay(new Date());
    const postedToday = mine.filter((s) => s.committedAt.slice(0, 10) === today).length;
    if (postedToday >= SUPPLY.maxPerDay) return log("skip", `daily limit: ${postedToday}/${SUPPLY.maxPerDay} signals today`);
    const open = mine.find((s) => s.status === "COMMITTED" && new Date(s.validUntil) > new Date());
    if (open) return log("skip", `signal #${open.id} still live until ${open.validUntil}`, { signalId: open.id });

    const p = await spec.propose();
    if ("skip" in p) return log("skip", p.skip);
    const bad = supplyCheck(p);
    if (bad) return log("skip", `proposal rejected: ${bad}`);
    await topUpBond(w, toUnits(env().AGENT_BOND_USD));
    const { signalId } = await commitProposal(api, w, p, { priceUsd: clampPrice(spec.priceUsd) });
    await log("post", `${p.side} ${p.market} @ ${p.entry} TP ${p.takeProfit} SL ${p.stopLoss}, ${clampValidity(p.validHours)}h, $${clampPrice(spec.priceUsd)}: ${p.rationale}`, { signalId });
  });
}
