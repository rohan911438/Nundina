import { detectMarket, detectSide, parseRules } from "./cornix.js";
import { fromExtraction, type Extractor } from "./llm.js";
import { validate, type ParseResult } from "./types.js";

export * from "./types.js";
export { parseRules } from "./cornix.js";
export { anthropicExtractor, type Extractor } from "./llm.js";

/** Worth an LLM call: names a supported market and a direction. */
export function looksLikeSignal(text: string): boolean {
  return Boolean(detectMarket(text).market && detectSide(text));
}

/**
 * Rules first; the LLM only when the rules could not read a post that looks like a signal.
 * Every successful parse is checked with the same validation the API applies at commit.
 */
export async function parseSignal(text: string, opts: { llm?: Extractor | null; now?: number } = {}): Promise<ParseResult> {
  let r = parseRules(text);
  if (!r.ok && (r.reason === "not_signal" || r.reason === "incomplete") && opts.llm && looksLikeSignal(text)) {
    try {
      const viaLlm = fromExtraction(await opts.llm(text));
      // keep the rules' more specific "incomplete" if the LLM was not confident either
      if (viaLlm.ok || viaLlm.reason !== "not_signal") r = viaLlm;
    } catch {
      // timeout or API error: fall back to the rules' answer
    }
  }
  if (!r.ok) return r;
  const problems = validate(r.signal, opts.now);
  return problems.length ? { ok: false, reason: "invalid", detail: problems.join("; ") } : r;
}
