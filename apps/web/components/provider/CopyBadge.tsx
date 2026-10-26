"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Embed snippet for a provider's live badge image. */
export function CopyBadge({ handle, siteUrl }: { handle: string; siteUrl: string }) {
  const [copied, setCopied] = useState(false);
  const base = siteUrl.replace(/\/$/, "");
  const snippet = `<a href="${base}/p/${handle}"><img src="${base}/api/og/badge/${handle}" alt="${handle} on Nundina" width="600" height="315"></a>`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Button variant="outline" size="sm" onClick={copy} aria-live="polite">
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? "Copied embed code" : "Copy badge"}
    </Button>
  );
}
