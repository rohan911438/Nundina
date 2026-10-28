"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { config } from "@/lib/config";
import { me, telegramApi } from "@/lib/session";

/**
 * Links the signed-in wallet to the person's Telegram account: a one-time `t.me` deep link the bot
 * redeems with the sender's Telegram id, so nobody can type in someone else's account. Polls the
 * session until the bot has done it.
 */
export function TelegramConnect({ onLinked, hint }: { onLinked?: () => void; hint?: string }) {
  const qc = useQueryClient();
  const [link, setLink] = useState<{ url: string; until: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const waiting = Boolean(link && link.until > Date.now());
  const session = useQuery({ queryKey: ["session"], queryFn: me.session, retry: false, refetchInterval: waiting ? 2000 : false });
  const tg = session.data?.telegram;

  useEffect(() => {
    if (tg && link) {
      setLink(null);
      onLinked?.();
      void qc.invalidateQueries({ queryKey: ["me-provider"] });
    }
  }, [tg, link, onLinked, qc]);

  if (tg) {
    return (
      <p className="flex items-center gap-2 text-sm" data-testid="telegram-linked">
        <span className="grid size-5 place-items-center rounded-full bg-win text-bg">
          <Check aria-hidden className="size-3" />
        </span>
        Telegram connected{tg.username ? <span className="text-muted">@{tg.username}</span> : null}
      </p>
    );
  }
  if (!config.botUsername) return <p className="text-sm text-muted">The Telegram bot isn&apos;t connected on this deployment yet.</p>;

  async function start() {
    setBusy(true);
    setError(null);
    // open the tab inside the click, so popup blockers allow it; point it at the bot once we have a token
    const tab = typeof window !== "undefined" ? window.open("", "_blank") : null;
    try {
      const r = await telegramApi.startLink();
      const url = `https://t.me/${config.botUsername}?start=acct_${r.token}`;
      setLink({ url, until: Date.now() + r.expiresInS * 1000 });
      if (tab) tab.location.href = url;
    } catch (e) {
      tab?.close();
      setError(e instanceof ApiError ? e.message : "Couldn't start the link. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2" data-testid="telegram-connect">
      {hint ? <p className="text-sm text-muted">{hint}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="accent" onClick={() => void start()} disabled={busy}>
          {busy ? <Loader2 aria-hidden className="animate-spin" /> : <Send aria-hidden />}
          {link ? "Get a new link" : "Connect Telegram"}
        </Button>
        {waiting ? (
          <a href={link!.url} target="_blank" rel="noreferrer noopener" className="text-sm text-accent underline-offset-4 hover:underline">
            Open Telegram again
          </a>
        ) : null}
      </div>
      {waiting ? (
        <p className="flex items-center gap-2 text-xs text-muted" aria-live="polite">
          <Loader2 aria-hidden className="size-3 animate-spin" /> In Telegram, tap <b>Start</b>. This page updates by itself.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-loss">
          {error}
        </p>
      ) : null}
    </div>
  );
}
