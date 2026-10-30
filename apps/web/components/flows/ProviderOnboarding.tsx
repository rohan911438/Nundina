"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BadgeCheck, Check, Copy, Fuel, Loader2, Plus, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { getAddress, parseEventLogs, type Address, type Hex } from "viem";
import { useBalance, useConfig, useReadContract } from "wagmi";
import { waitForTransactionReceipt, writeContract, sendTransaction } from "wagmi/actions";
import { identityRegistryAbi, providerRegistryAbi } from "@nundina/shared/abis";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { config } from "@/lib/config";
import { addr } from "@/lib/contracts";
import { me, providerApi, type MyProvider } from "@/lib/session";
import { useWallet, walletErrorMessage } from "@/lib/wallet/useWallet";
import { BondManager } from "./BondManager";
import { TelegramConnect } from "./TelegramConnect";
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

/** Admin rights the bot asks for when added to a channel (Telegram pre-fills them). */
const CHANNEL_RIGHTS = "post_messages+edit_messages+delete_messages";
/** Groups have no "post messages" right; admin is enough for the bot to read and reply. */
const GROUP_RIGHTS = "delete_messages+pin_messages";

/**
 * Checklist with live status: wallet → ERC-8004 identity → ProviderRegistry → Telegram account →
 * channel ownership (checked against Telegram's admin list by the bot) → bond → KYC.
 */
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
  const session = useQuery({ queryKey: ["session"], queryFn: me.session, retry: false });
  const tgLinked = Boolean(session.data?.telegram);
  const [watchChannel, setWatchChannel] = useState(false);
  const profile = useQuery({
    queryKey: ["me-provider"],
    queryFn: me.provider,
    retry: false,
    // while the person is adding the bot in Telegram, pick up the verification as soon as it lands
    refetchInterval: (q) => (watchChannel && !q.state.data?.provider.linked ? 3000 : false),
  });
  const hasProfile = Boolean(profile.data);
  const gas = useBalance({ address, query: { refetchInterval: 15_000 } });
  const noGas = gas.data != null && gas.data.value === 0n;
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
        // already on-chain (registered before this profile existed): no second identity
        if (s1?.data && !onChain) {
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
      if (onChain) {
        await reg.refetch();
        return;
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

  const channel = profile.data?.provider.channel ?? null;
  const items = [
    { key: "wallet", label: "Wallet connected", done: true },
    { key: "identity", label: "ERC-8004 identity and provider registration", done: hasProfile && onChain },
    { key: "telegram", label: "Telegram account connected", done: tgLinked },
    { key: "channel", label: channel ? `Channel verified: ${channel.title ?? "your channel"}` : "Telegram channel verified", done: linked },
    { key: "bond", label: "Bond deposited", done: bonded, optional: true },
    { key: "kyc", label: "KYC attestation (optional)", done: false, soon: true },
  ];

  const required = items.filter((it) => !it.soon && !it.optional);
  const doneCount = required.filter((it) => it.done).length;
  const nextKey = required.find((it) => !it.done)?.key;
  const handleOk = /^[a-z0-9_]{3,32}$/i.test(handle);

  return (
    <div className="space-y-6" data-testid="onboarding">
      <div aria-hidden className="h-1 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out" style={{ width: `${(doneCount / required.length) * 100}%` }} />
      </div>
      <ol className="space-y-2">
        {items.map((it, i) => (
          <li
            key={it.key}
            style={{ animationDelay: `${i * 60}ms` }}
            className={cn(
              "rise flex items-center gap-3 rounded-xl border bg-surface px-4 py-3 text-sm transition-colors duration-300",
              it.key === nextKey ? "border-accent/50 bg-accent/[0.05]" : "border-border",
            )}
          >
            <span
              className={cn(
                "grid size-6 place-items-center rounded-full border text-xs transition-colors duration-300",
                it.done ? "border-win bg-win text-bg" : it.key === nextKey ? "pulse-ring border-accent text-accent" : "border-border text-muted",
              )}
            >
              {it.done ? <Check aria-hidden className="stage-in size-3.5" /> : i + 1}
            </span>
            <span className={cn(it.done && "text-muted")}>{it.label}</span>
            {it.key === nextKey ? <span className="ml-auto text-xs text-accent">next</span> : null}
            {it.optional && !it.done ? <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">optional</span> : null}
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
                <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="cryptoalpha" className="input mt-1" aria-invalid={handle !== "" && !handleOk} />
                {handle !== "" && !handleOk ? <span className="mt-1 block text-xs text-loss">3–32 letters, numbers or _</span> : null}
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
          {noGas ? (
            <p className="flex items-start gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm">
              <Fuel aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
              <span>
                This wallet has no HSK for gas, so the registration transactions would fail.{" "}
                {config.chainId === 133 ? (
                  <a href="https://faucet.hsk.xyz" target="_blank" rel="noreferrer noopener" className="text-accent underline-offset-4 hover:underline">
                    Get testnet HSK from the faucet
                  </a>
                ) : (
                  "Add a little HSK first."
                )}
              </span>
            </p>
          ) : null}
          <Button variant="accent" onClick={() => void register()} disabled={Boolean(busy) || (!hasProfile && !handleOk)} data-testid="register">
            {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
            {busy === "identity" ? "Minting ERC-8004 identity…" : busy === "registry" ? "Registering…" : "Register"}
          </Button>
          <p className="text-xs text-muted">Two wallet transactions: an ERC-8004 identity (portable reputation), then the Nundina provider registry.</p>
        </section>
      ) : null}

      {hasProfile && !tgLinked ? (
        <section className="space-y-3 rounded-2xl border border-border p-5" data-testid="step-telegram">
          <h2 className="font-medium">Connect your Telegram account</h2>
          <TelegramConnect hint="One tap in Telegram links it to this wallet. That's how we know which channels are really yours, and where to send your signal drafts." />
        </section>
      ) : null}

      {hasProfile && tgLinked && !linked ? (
        <section className="space-y-4 rounded-2xl border border-border p-5" data-testid="step-channel">
          <div>
            <h2 className="font-medium">Verify your channel or group</h2>
            <p className="mt-1 text-sm text-muted">
              Add the bot as an admin where you post signals. Telegram tells the bot who owns and runs it; it&apos;s linked only if your account is one of them.
            </p>
          </div>
          {config.botUsername ? (
            <Button asChild variant="accent">
              <a
                href={`https://t.me/${config.botUsername}?startchannel&admin=${CHANNEL_RIGHTS}`}
                target="_blank"
                rel="noreferrer noopener"
                onClick={() => setWatchChannel(true)}
                data-testid="add-to-channel"
              >
                <Plus aria-hidden /> Add @{config.botUsername} to your channel
              </a>
            </Button>
          ) : null}
          {config.botUsername ? (
            <Button asChild variant="outline">
              <a
                href={`https://t.me/${config.botUsername}?startgroup&admin=${GROUP_RIGHTS}`}
                target="_blank"
                rel="noreferrer noopener"
                onClick={() => setWatchChannel(true)}
                data-testid="add-to-group"
              >
                <Plus aria-hidden /> It&apos;s a group
              </a>
            </Button>
          ) : (
            <p className="text-sm text-muted">The Telegram bot isn&apos;t connected on this deployment yet.</p>
          )}
          {watchChannel ? (
            <p className="flex items-center gap-2 text-xs text-muted" aria-live="polite">
              <Loader2 aria-hidden className="size-3 animate-spin" /> Pick your channel and keep the suggested rights. This page updates when it&apos;s verified.
            </p>
          ) : null}
          {config.botUsername ? (
            <p className="text-sm text-muted">
              Added the bot before connecting Telegram?{" "}
              <a href={`https://t.me/${config.botUsername}?start=link_channel`} target="_blank" rel="noreferrer noopener" className="text-accent underline-offset-4 hover:underline">
                Open the bot
              </a>{" "}
              and it finishes the check, no need to add it again.
            </p>
          ) : null}
          <ul className="grid gap-2 text-xs text-muted sm:grid-cols-3">
            <li className="flex gap-2 rounded-xl bg-surface-2 p-3">
              <ShieldCheck aria-hidden className="size-4 shrink-0 text-accent" /> Only the owner or an admin can verify a channel.
            </li>
            <li className="flex gap-2 rounded-xl bg-surface-2 p-3">
              <BadgeCheck aria-hidden className="size-4 shrink-0 text-accent" /> One channel, one provider. Copies can&apos;t claim yours.
            </li>
            <li className="flex gap-2 rounded-xl bg-surface-2 p-3">
              <AlertTriangle aria-hidden className="size-4 shrink-0 text-accent" /> Lookalikes of existing providers get a public warning.
            </li>
          </ul>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted hover:text-text">Is the bot already an admin there?</summary>
            <div className="mt-3 space-y-2">
              <p className="text-muted">Post this code in the channel. The bot checks the admin list the same way and deletes the message.</p>
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
                <Button
                  variant="outline"
                  onClick={() => {
                    setWatchChannel(true);
                    void linkTelegram();
                  }}
                  disabled={Boolean(busy)}
                >
                  Get link code
                </Button>
              )}
            </div>
          </details>
        </section>
      ) : null}

      {channel ? <VerifiedChannel channel={channel} lookalikeOf={profile.data?.provider.lookalikeOf ?? null} /> : null}

      {hasProfile && onChain ? (
        <section className="space-y-3">
          <h2 className="font-medium">Bond <span className="text-sm font-normal text-muted">(optional)</span></h2>
          <p className="text-sm text-muted">
            Optional on testnet: we couldn&apos;t find a public test USDT faucet on HashKey testnet, and the bond is paid in USDT (HSK only pays gas). Without a bond you can still post and lock free signals; paid signals need bond so buyers can be refunded if you&apos;re wrong.
          </p>
          <BondManager provider={address} defaultPriceUsd={profile.data?.provider.defaultPriceUsd ?? price} onChange={() => void reg.refetch()} />
        </section>
      ) : null}

      {doneCount === required.length ? (
        <section className="rise rounded-2xl border border-win/30 bg-win/[0.06] p-5" data-testid="onboarding-done">
          <p className="flex items-center gap-2 font-medium text-win">
            <Check aria-hidden className="stage-in size-4" /> You&apos;re live
          </p>
          <p className="mt-1 text-sm text-muted">Post a signal in your channel as usual; the bot DMs you a draft to lock on-chain.</p>
          <Button asChild variant="outline" className="mt-3">
            <Link href="/dashboard/provider">Open provider dashboard</Link>
          </Button>
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

function VerifiedChannel({ channel, lookalikeOf }: { channel: NonNullable<MyProvider["provider"]["channel"]>; lookalikeOf: string | null }) {
  return (
    <section className="rise space-y-2 rounded-2xl border border-win/30 bg-win/[0.05] p-5" data-testid="channel-verified">
      <p className="flex flex-wrap items-center gap-2 font-medium">
        <BadgeCheck aria-hidden className="size-4 text-win" /> {channel.title ?? "Your channel"}
        {channel.url ? (
          <a href={channel.url} target="_blank" rel="noreferrer noopener" className="text-sm font-normal text-accent hover:underline">
            @{channel.username}
          </a>
        ) : null}
      </p>
      <p className="text-sm text-muted">
        Telegram confirms you&apos;re its {channel.role === "creator" ? "owner" : "admin"}
        {channel.members != null ? ` · ${channel.members.toLocaleString()} subscribers` : ""}. Re-checked every few hours; if you lose admin, it&apos;s unlinked.
      </p>
      {lookalikeOf ? (
        <p className="flex items-start gap-2 text-sm text-loss">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" /> The name looks like @{lookalikeOf}, who was here first, so buyers see a lookalike warning on your profile.
        </p>
      ) : null}
    </section>
  );
}
