"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { getAddress, type Address } from "viem";
import { createSiweMessage } from "viem/siwe";
import { useAccount, useConnect, useDisconnect, useSignMessage, useSwitchChain } from "wagmi";
import { encKeyMessage, keyFromSignature, loadKey, storeKey, clearKey } from "@/lib/crypto/encKey";
import { config } from "@/lib/config";
import { me } from "@/lib/session";
import { appChain } from "@/lib/wagmi";
import { openAppKit } from "./appkit";

export type WalletStep = "disconnected" | "wrong_network" | "signed_out" | "no_key" | "ready";

/**
 * Wallet + Nundina session in one place: connect (AppKit or injected), switch to HashKey, SIWE,
 * and the buyer encryption key (derived from a signature; kept in memory/sessionStorage only).
 */
export function useWallet() {
  const qc = useQueryClient();
  const { address, chainId, isConnected, status } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyVersion, setKeyVersion] = useState(0);

  const session = useQuery({ queryKey: ["session"], queryFn: me.session, staleTime: 60_000, retry: false });
  const signedIn = Boolean(address && session.data?.wallet && session.data.wallet === address.toLowerCase());
  // re-read when a key is derived in this tab
  const encKey = address && keyVersion >= 0 ? loadKey(address) : null;

  const step: WalletStep = !isConnected
    ? "disconnected"
    : chainId !== appChain.id
      ? "wrong_network"
      : !signedIn
        ? "signed_out"
        : !encKey
          ? "no_key"
          : "ready";

  const run = useCallback(async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(walletErrorMessage(e));
      return undefined;
    } finally {
      setBusy(null);
    }
  }, []);

  const connect = () =>
    run("connect", async () => {
      if (await openAppKit()) return;
      const c = connectors.find((x) => x.type === "mock") ?? connectors.find((x) => x.type === "injected") ?? connectors[0];
      if (!c) throw new Error("No wallet found. Install a wallet or open this page in your wallet's browser.");
      await connectAsync({ connector: c, chainId: appChain.id });
    });

  const switchNetwork = () => run("switch", () => switchChainAsync({ chainId: appChain.id }));

  const signIn = () =>
    run("sign_in", async () => {
      if (!address) throw new Error("Connect a wallet first");
      const { nonce } = await me.nonce();
      const message = createSiweMessage({
        address: getAddress(address),
        chainId: appChain.id,
        domain: new URL(config.siteUrl).host,
        uri: config.siteUrl,
        nonce,
        version: "1",
        statement: "Sign in to Nundina",
        expirationTime: new Date(Date.now() + 10 * 60_000),
      });
      const signature = await signMessageAsync({ message });
      await me.verify(message, signature);
      await qc.invalidateQueries({ queryKey: ["session"] });
    });

  const deriveKey = () =>
    run("key", async () => {
      if (!address) throw new Error("Connect a wallet first");
      const signature = await signMessageAsync({ message: encKeyMessage(address) });
      const k = keyFromSignature(signature);
      await me.setEncryptionKey(k.publicKey);
      storeKey(address, k);
      setKeyVersion((v) => v + 1);
      return k;
    });

  /** Walks the user through whatever step is missing. */
  const advance = async () => {
    if (step === "disconnected") return connect();
    if (step === "wrong_network") return switchNetwork();
    if (step === "signed_out") return signIn();
    if (step === "no_key") return deriveKey();
  };

  const signOut = () =>
    run("sign_out", async () => {
      if (address) clearKey(address as Address);
      await me.logout().catch(() => undefined);
      await disconnectAsync().catch(() => undefined);
      await qc.invalidateQueries({ queryKey: ["session"] });
    });

  return {
    address: address as Address | undefined,
    chainId,
    accountStatus: status,
    session: session.data,
    step,
    encKey,
    busy,
    error,
    connect,
    switchNetwork,
    signIn,
    deriveKey,
    advance,
    signOut,
  };
}

export const STEP_LABEL: Record<Exclude<WalletStep, "ready">, string> = {
  disconnected: "Connect wallet",
  wrong_network: `Switch to ${appChain.name}`,
  signed_out: "Sign in with wallet",
  no_key: "Create decryption key",
};

/** Human message for wallet/RPC/API failures. */
export function walletErrorMessage(e: unknown): string {
  const err = e as { name?: string; shortMessage?: string; message?: string; code?: number | string; cause?: { code?: number } };
  const code = err?.code ?? err?.cause?.code;
  if (code === 4001 || err?.name === "UserRejectedRequestError" || /rejected|denied/i.test(err?.message ?? "")) return "You cancelled the request in your wallet.";
  if (/insufficient funds/i.test(err?.message ?? "")) return "Not enough HSK for gas.";
  return err?.shortMessage ?? err?.message ?? "Something went wrong";
}
