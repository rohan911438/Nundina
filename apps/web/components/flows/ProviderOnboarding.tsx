"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, Send } from "lucide-react";
import { useState } from "react";
import { getAddress, parseEventLogs, type Address, type Hex } from "viem";
import { useConfig, useReadContract } from "wagmi";
import { waitForTransactionReceipt, writeContract, sendTransaction } from "wagmi/actions";
import { identityRegistryAbi, providerRegistryAbi } from "@nundina/shared/abis";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { config } from "@/lib/config";
import { addr } from "@/lib/contracts";
import { me, providerApi } from "@/lib/session";
import { useWallet, walletErrorMessage } from "@/lib/wallet/useWallet";
import { BondManager } from "./BondManager";
import { WalletGate } from "./WalletGate";

const AGENT_ID_KEY = (a: string) => `nundina:agentId:${a.toLowerCase()}`;
const remember = (a: string, id: string) => {
  try {
    localStorage.setItem(AGENT_ID_KEY(a), id);
  } catch {
    /* ignore */
  }
};
const recall = (a: string) => {
  try {
    return localStorage.getItem(AGENT_ID_KEY(a));
  } catch {
    return null;
  }
};

/** Checklist with live status: wallet → ERC-8004 identity → ProviderRegistry → Telegram → bond → KYC. */
export function ProviderOnboarding() {
  return (
    <WalletGate title="Connect the wallet you'll sign signals with" needKey={false}>
      <Checklist />
    </WalletGate>
  );
}

function Checklist() {
  const w = useWallet();
  const wagmi = useConfig();
  const qc = useQueryClient();
  const address = w.address!;
  const registry = addr("ProviderRegistry");
  const identity = addr("IdentityRegistry");
  const profile = useQuery({ queryKey: ["me-provider"], queryFn: me.provider, retry: false });
  const hasProfile = Boolean(profile.data);
  const reg = useReadContract({
    address: registry ?? undefined,
    abi: providerRegistryAbi,
    functionName: "getProvider",
    args: [address],
    query: { enabled: Boolean(registry), refetchInterval: 10_000 },
  });
  const onChain = Boolean(reg.data?.registered);
  const bonded = Boolean(reg.data && reg.data.bondTotal > 0n);
  const linked = Boolean(profile.data?.provider.linked);

  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [price, setPrice] = useState("1");
  const [practice, setPractice] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : walletErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  /** Profile in the API, then identity mint, then ProviderRegistry.register. Resumable at each step. */
  const register = () =>
    run("register", async () => {
      if (!registry || !identity) throw new Error("Contracts are not deployed on this network yet");
      let payout: Address = address;
      let tgHash: Hex | null = null;
      let agentUri: string | null = null;
      if (!hasProfile) {
        const r = await providerApi.register({ handle: handle.toLowerCase(), displayName: displayName || handle, defaultPrice: price, practice });
        const s2 = r.tx.steps[1];
        payout = getAddress(s2?.args?.payout ?? address);
        tgHash = (s2?.args?.tgHandleHash as Hex) ?? null;
        const s1 = r.tx.steps[0];
        if (s1?.data) {
          setBusy("identity");
          const h = await sendTransaction(wagmi, { to: getAddress(s1.to), data: s1.data as Hex });
          const rc = await waitForTransactionReceipt(wagmi, { hash: h });
          const [ev] = parseEventLogs({ abi: identityRegistryAbi, eventName: "Registered", logs: rc.logs });
          if (!ev) throw new Error("Identity mint did not emit Registered");
          remember(address, (ev.args as { agentId: bigint }).agentId.toString());
        }
        agentUri = r.tx.agentUri ?? null;
        await qc.invalidateQueries({ queryKey: ["me-provider"] });
      }
      let agentId = recall(address);
      if (!agentId) {
        setBusy("identity");
        const uri = agentUri ?? `${config.siteUrl}/api/agent-card/${profile.data?.provider.handle ?? handle}`;
        const h = await writeContract(wagmi, { address: identity, abi: identityRegistryAbi, functionName: "register", args: [uri] });
        const rc = await waitForTransactionReceipt(wagmi, { hash: h });
        const [ev] = parseEventLogs({ abi: identityRegistryAbi, eventName: "Registered", logs: rc.logs });
        agentId = (ev!.args as { agentId: bigint }).agentId.toString();
        remember(address, agentId);
      }
      if (!onChain) {
        setBusy("registry");
        const h = await writeContract(wagmi, {
          address: registry,
          abi: providerRegistryAbi,
          functionName: "register",
          args: [BigInt(agentId), payout, tgHash ?? (`0x${"0".repeat(64)}` as Hex), practice],
        });
        await waitForTransactionReceipt(wagmi, { hash: h });
        await reg.refetch();
      }
    });

  const linkTelegram = () =>
    run("link", async () => {
      const r = await providerApi.linkCode();
      setCode(r.code);
    });

  const items = [
    { key: "wallet", label: "Wallet connected", done: true },
    { key: "identity", label: "ERC-8004 identity and provider registration", done: hasProfile && onChain },
    { key: "telegram", label: "Telegram channel linked", done: linked },
    { key: "bond", label: "Bond deposited", done: bonded },
    { key: "kyc", label: "KYC attestation (optional)", done: false, soon: true },
  ];

  return (
    <div className="space-y-6" data-testid="onboarding">
      <ol className="space-y-2">
        {items.map((it, i) => (
          <li key={it.key} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm">
            <span className={cn("grid size-6 place-items-center rounded-full border text-xs", it.done ? "border-win bg-win text-bg" : "border-border text-muted")}>
              {it.done ? <Check aria-hidden className="size-3.5" /> : i + 1}
            </span>
            <span className={cn(it.done && "text-muted")}>{it.label}</span>
            {it.soon ? <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">coming soon</span> : null}
          </li>
        ))}
      </ol>

      {!(hasProfile && onChain) ? (
        <section className="space-y-3 rounded-2xl border border-border p-5">
          <h2 className="font-medium">Create your provider profile</h2>
          {!hasProfile ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs text-muted">Handle</span>
                <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="cryptoalpha" className="input mt-1" />
              </label>
              <label className="block">
                <span className="text-xs text-muted">Display name</span>
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="input mt-1" />
              </label>
              <label className="block">
                <span className="text-xs text-muted">Default price per signal (USD)</span>
                <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="input num mt-1" />
              </label>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input type="checkbox" checked={practice} onChange={(e) => setPractice(e.target.checked)} />
                Start as a free practice profile
              </label>
            </div>
          ) : (
            <p className="text-sm text-muted">Profile @{profile.data?.provider.handle} exists; finish the on-chain registration.</p>
          )}
          <Button variant="accent" onClick={() => void register()} disabled={Boolean(busy) || (!hasProfile && !/^[a-z0-9_]{3,32}$/i.test(handle))} data-testid="register">
            {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
            {busy === "identity" ? "Minting ERC-8004 identity…" : busy === "registry" ? "Registering…" : "Register"}
          </Button>
          <p className="text-xs text-muted">Two wallet transactions: an ERC-8004 identity (portable reputation), then the Nundina provider registry.</p>
        </section>
      ) : null}

      {hasProfile && onChain && !linked ? (
        <section className="space-y-3 rounded-2xl border border-border p-5">
          <h2 className="font-medium">Link your Telegram channel</h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>
              Add <span className="text-text">@{config.botUsername}</span> to your channel as an admin with &quot;Post messages&quot;.
            </li>
            <li>Post the code below in the channel. The bot checks it, links the channel and deletes the message.</li>
          </ol>
          {code ? (
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(`/link ${code}`)}
              className="num flex w-full items-center justify-between rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-lg"
              data-testid="link-code"
            >
              /link {code} <Copy aria-hidden className="size-4" />
            </button>
          ) : (
            <Button variant="outline" onClick={() => void linkTelegram()} disabled={Boolean(busy)}>
              Get link code
            </Button>
          )}
          {config.botUsername ? (
            <Button asChild variant="ghost">
              <a href={`https://t.me/${config.botUsername}?start=link_channel`} target="_blank" rel="noreferrer noopener">
                <Send aria-hidden /> Open the bot
              </a>
            </Button>
          ) : (
            <p className="text-xs text-muted">The Telegram bot isn't connected on this deployment yet.</p>
          )}
        </section>
      ) : null}

      {hasProfile && onChain ? (
        <section className="space-y-3">
          <h2 className="font-medium">Bond</h2>
          <BondManager provider={address} defaultPriceUsd={profile.data?.provider.defaultPriceUsd ?? price} onChange={() => void reg.refetch()} />
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-loss">
          {error}
        </p>
      ) : null}
    </div>
  );
}
