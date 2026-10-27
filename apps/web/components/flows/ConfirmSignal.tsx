"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Lock } from "lucide-react";
import { useMemo, useState } from "react";
import { useConfig } from "wagmi";
import { signTypedData } from "wagmi/actions";
import { MARKETS, makeSignalSchema } from "@nundina/shared/signal";
import { Side } from "@nundina/shared/enums";
import { fromUnits, toPrice, toUnits } from "@nundina/shared/money";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { explorer, short } from "@/lib/format";
import { draftsApi, type DraftView } from "@/lib/session";
import { walletErrorMessage } from "@/lib/wallet/useWallet";
import { WalletGate } from "./WalletGate";

interface Fields {
  market: string;
  side: "LONG" | "SHORT";
  entry: string;
  takeProfit: string;
  stopLoss: string;
  validHours: string;
  priceUsd: string;
}

const ZERO32 = `0x${"0".repeat(64)}`;
const num = (v: string) => /^\d+(\.\d+)?$/.test(v.trim());

/** Fields → the API's signal input (8-dec prices, 6-dec price, unix validUntil). Throws on bad numbers. */
export function toSignalInput(f: Fields, nowS = Math.floor(Date.now() / 1000)) {
  return {
    market: f.market,
    side: f.side,
    entry: toPrice(f.entry.trim()).toString(),
    takeProfit: toPrice(f.takeProfit.trim()).toString(),
    stopLoss: toPrice(f.stopLoss.trim()).toString(),
    validUntil: String(nowS + Math.round(Number(f.validHours) * 3600)),
    pricePerSub: toUnits(f.priceUsd.trim()).toString(),
    upstream: [] as string[],
    upstreamBps: [] as number[],
  };
}

/** Live validation with the same rules the contract and API enforce. Returns field → message. */
export function validateFields(f: Fields, provider: string): Partial<Record<keyof Fields, string>> {
  const errs: Partial<Record<keyof Fields, string>> = {};
  for (const k of ["entry", "takeProfit", "stopLoss", "priceUsd", "validHours"] as const) if (!num(f[k])) errs[k] = "Enter a number";
  if (!MARKETS[f.market as keyof typeof MARKETS]) errs.market = "Unsupported market";
  if (Object.keys(errs).length) return errs;
  const input = toSignalInput(f);
  const r = makeSignalSchema().safeParse({
    ...input,
    market: MARKETS[f.market as keyof typeof MARKETS].id,
    side: f.side === "LONG" ? Side.LONG : Side.SHORT,
    provider,
    salt: ZERO32,
  });
  if (!r.success) {
    for (const i of r.error.issues) {
      const path = String(i.path[0]);
      const key = (path === "validUntil" ? "validHours" : path === "pricePerSub" ? "priceUsd" : path) as keyof Fields;
      errs[key] ??= i.message;
    }
  }
  return errs;
}

export function ConfirmSignal({ draftId, onCommitted }: { draftId: string; onCommitted?: (r: { signalId: string; txHash?: string }) => void }) {
  return (
    <WalletGate title="Connect your provider wallet" needKey={false}>
      <ConfirmInner draftId={draftId} onCommitted={onCommitted} />
    </WalletGate>
  );
}

function ConfirmInner({ draftId, onCommitted }: { draftId: string; onCommitted?: (r: { signalId: string; txHash?: string }) => void }) {
  const draft = useQuery({ queryKey: ["draft", draftId], queryFn: () => draftsApi.get(draftId), retry: false });
  if (draft.isPending) return <div className="h-96 animate-pulse rounded-2xl bg-surface" />;
  if (draft.error)
    return (
      <p role="alert" className="text-sm text-loss">
        {draft.error instanceof ApiError && draft.error.status === 403 ? "This draft belongs to another provider wallet." : draft.error.message}
      </p>
    );
  return <ConfirmForm draft={draft.data} onCommitted={onCommitted} />;
}

function ConfirmForm({ draft, onCommitted }: { draft: DraftView; onCommitted?: (r: { signalId: string; txHash?: string }) => void }) {
  const wagmi = useConfig();
  const p = draft.parsed ?? {};
  const [f, setF] = useState<Fields>({
    market: p.market ?? "BTC/USD",
    side: p.side ?? "LONG",
    entry: p.entry ?? "",
    takeProfit: p.takeProfit ?? "",
    stopLoss: p.stopLoss ?? "",
    validHours: String(p.validHours ?? 24),
    priceUsd: draft.provider.practice ? "0" : fromUnits(BigInt(draft.provider.defaultPrice || "0")),
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ signalId: string; txHash?: string } | null>(draft.signalId ? { signalId: draft.signalId } : null);
  const errs = useMemo(() => validateFields(f, draft.provider.address), [f, draft.provider.address]);
  const valid = Object.keys(errs).length === 0;
  const set = (k: keyof Fields) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function lock() {
    setError(null);
    try {
      setBusy("prepare");
      const input = toSignalInput(f);
      const prep = await draftsApi.prepare(String(draft.id), input);
      setBusy("sign");
      const td = prep.typedData;
      const providerSig = await signTypedData(wagmi, {
        domain: td.domain as never,
        types: td.types,
        primaryType: "CommitAuthorization",
        message: {
          ...td.message,
          validUntil: BigInt(td.message.validUntil!),
          pricePerSub: BigInt(td.message.pricePerSub!),
          nonce: BigInt(td.message.nonce!),
          deadline: BigInt(td.message.deadline!),
        },
      });
      setBusy("commit");
      const r = await draftsApi.confirm(String(draft.id), { signal: input, commitAuth: td.message, providerSig });
      setDone(r);
      onCommitted?.(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : walletErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (done)
    return (
      <div className="rounded-2xl border border-win/30 bg-win/[0.06] p-5" data-testid="committed">
        <p className="flex items-center gap-2 font-medium text-win">
          <Check aria-hidden className="size-5" /> Locked on-chain
        </p>
        <p className="mt-2 text-sm text-muted">
          Signal #{done.signalId} is committed. Nobody, including you, can change or delete it now. Buyers see it as locked until the reveal.
        </p>
        {done.txHash ? (
          <p className="mt-3 text-sm">
            Commit tx{" "}
            <ExternalLink href={explorer.tx(done.txHash)} label="explorer">
              {short(done.txHash)}
            </ExternalLink>
          </p>
        ) : null}
      </div>
    );

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !busy) void lock();
      }}
      data-testid="confirm-form"
    >
      <blockquote className="whitespace-pre-wrap rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">{draft.rawText}</blockquote>
      {p.notes?.length ? (
        <ul className="list-disc pl-5 text-xs text-muted">
          {p.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Market" error={errs.market}>
          <select value={f.market} onChange={set("market")} className="input">
            {Object.keys(MARKETS).map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="Side">
          <div className="grid grid-cols-2 gap-1 rounded-xl border border-border p-1">
            {(["LONG", "SHORT"] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={f.side === s}
                onClick={() => setF((x) => ({ ...x, side: s }))}
                className={cn("rounded-lg py-2 text-sm font-semibold", f.side === s ? (s === "LONG" ? "bg-win text-bg" : "bg-loss text-bg") : "text-muted")}
              >
                {s}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Entry" error={errs.entry}>
          <input inputMode="decimal" value={f.entry} onChange={set("entry")} className="input num text-xl" />
        </Field>
        <Field label="Valid for (hours)" error={errs.validHours}>
          <input inputMode="decimal" value={f.validHours} onChange={set("validHours")} className="input num text-xl" />
        </Field>
        <Field label="Take profit" error={errs.takeProfit}>
          <input inputMode="decimal" value={f.takeProfit} onChange={set("takeProfit")} className="input num text-xl text-win" />
        </Field>
        <Field label="Stop loss" error={errs.stopLoss}>
          <input inputMode="decimal" value={f.stopLoss} onChange={set("stopLoss")} className="input num text-xl text-loss" />
        </Field>
        <Field label="Price per buyer (USD)" error={errs.priceUsd}>
          <input inputMode="decimal" value={f.priceUsd} onChange={set("priceUsd")} disabled={draft.provider.practice} className="input num text-xl" />
        </Field>
      </div>
      {draft.provider.practice ? <p className="text-xs text-muted">Practice profile: signals are free until you leave practice mode.</p> : null}

      {error ? (
        <p role="alert" className="text-sm text-loss">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" variant="accent" className="w-full" disabled={!valid || Boolean(busy)} data-testid="lock-it">
        {busy ? <Loader2 aria-hidden className="animate-spin" /> : <Lock aria-hidden />}
        {busy === "sign" ? "Sign in your wallet…" : busy === "commit" ? "Committing…" : busy ? "Preparing…" : "Lock it"}
      </Button>
      <p className="text-center text-xs text-muted">You sign the exact levels. They stay encrypted until reveal.</p>
    </form>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-muted">{label}</span>
      <div className="mt-1">{children}</div>
      {error ? <span className="mt-1 block text-xs text-loss">{error}</span> : null}
    </label>
  );
}
