/**
 * LLM fallback: structured extraction with Claude Haiku when the rules can't read a post that
 * looks like a signal. Output is only ever a draft; the provider confirms before anything is committed.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { fmt } from "./cornix.js";
import { DEFAULT_VALID_HOURS, type ParseResult } from "./types.js";

export const LLM_MODEL = "claude-haiku-5-5";
export const LLM_TIMEOUT_MS = 8_000;
export const MIN_CONFIDENCE = 0.7;

export const Extraction = z.object({
  market: z.enum(["BTC/USD", "HSK/USD", "UNSUPPORTED", "NONE"]),
  side: z.enum(["LONG", "SHORT", "NONE"]),
  entry: z.number().nullable(),
  takeProfit: z.number().nullable().describe("first target if several"),
  stopLoss: z.number().nullable(),
  validHours: z.number().nullable(),
  confidence: z.number().describe("0-1: how sure you are this post is a complete trade signal and the fields are right"),
});
export type Extraction = z.infer<typeof Extraction>;

/** Returns the raw extraction for a post; injectable so tests never call the API. */
export type Extractor = (text: string) => Promise<Extraction | null>;

const SYSTEM = `You read trading-signal posts from Telegram channels (often informal, sometimes Hinglish) and extract one trade.
Rules:
- market: BTC/USD for BTC/XBT/bitcoin pairs, HSK/USD for HSK/HashKey pairs, UNSUPPORTED for any other asset, NONE if no trade.
- Prices are in USD. Expand "k" (81.5k = 81500). If an entry range is given, use its midpoint. If several targets are given, use the first.
- Use null for anything the post does not state. Never invent prices.
- confidence below 0.7 when the post is commentary, a question, a result update, or is missing entry, target or stop.`;

export function anthropicExtractor(apiKey: string): Extractor {
  const client = new Anthropic({ apiKey, timeout: LLM_TIMEOUT_MS, maxRetries: 0 });
  return async (text) => {
    const res = await client.messages.parse({
      model: LLM_MODEL,
      max_tokens: 1024,
      output_config: { effort: "low", format: zodOutputFormat(Extraction) },
      system: SYSTEM,
      messages: [{ role: "user", content: text.slice(0, 4000) }],
    });
    if (res.stop_reason === "refusal") return null;
    return res.parsed_output ?? null;
  };
}

/** Turns an extraction into a parse result (rejects low confidence and partial output). */
export function fromExtraction(e: Extraction | null): ParseResult {
  if (!e || e.confidence < MIN_CONFIDENCE || e.market === "NONE" || e.side === "NONE")
    return { ok: false, reason: "not_signal", detail: "llm: not a confident signal" };
  if (e.market === "UNSUPPORTED") return { ok: false, reason: "unsupported_market", detail: "llm" };
  if (e.entry == null || e.takeProfit == null || e.stopLoss == null)
    return { ok: false, reason: "incomplete", detail: "llm: missing price" };
  const notes = ["read by the AI parser: check every number before locking"];
  if (e.validHours == null) notes.push(`no expiry given: ${DEFAULT_VALID_HOURS}h`);
  return {
    ok: true,
    parser: "llm",
    signal: {
      market: e.market,
      side: e.side,
      entry: fmt(e.entry),
      takeProfit: fmt(e.takeProfit),
      stopLoss: fmt(e.stopLoss),
      validHours: e.validHours ?? DEFAULT_VALID_HOURS,
      notes,
    },
  };
}
