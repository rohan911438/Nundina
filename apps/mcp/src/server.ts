import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fromUnits } from "@nundina/shared";
import { env } from "./env.js";
import { Nundina } from "./nundina.js";
import type { Ctx } from "./tools/common.js";
import { listProviders, listProvidersInput, listProvidersMeta, listProvidersOutput } from "./tools/listProviders.js";
import { getSignals, getSignalsInput, getSignalsMeta, getSignalsOutput } from "./tools/getSignals.js";
import { getSignal, getSignalInput, getSignalMeta, getSignalOutput } from "./tools/getSignal.js";
import { verifyTrackRecord, verifyTrackRecordInput, verifyTrackRecordMeta, verifyTrackRecordOutput } from "./tools/verifyTrackRecord.js";
import { buySignal, buySignalInput, buySignalMeta, buySignalOutput } from "./tools/buySignal.js";
import { getPurchase, getPurchaseInput, getPurchaseMeta, getPurchaseOutput } from "./tools/getPurchase.js";

export const SERVER_INFO = { name: "nundina", version: "0.1.0" };

export const INSTRUCTIONS = `Nundina is a pay-if-right market for trading signals on HashKey Chain: providers commit sealed signals on-chain, buyers pay into an escrow, and buyers are refunded if the signal loses.
Typical flow: list_providers → verify_track_record (paid) → get_signals status=live → buy_signal (spends money, two steps) → decrypt. Nothing here is investment advice.`;

/** Tool table; also feeds the A2A agent card. */
export function toolCatalog() {
  const price = fromUnits(env().VERIFY_PRICE_UNITS);
  return [
    { name: "list_providers", ...listProvidersMeta, paid: false },
    { name: "get_signals", ...getSignalsMeta, paid: false },
    { name: "get_signal", ...getSignalMeta, paid: false },
    { name: "verify_track_record", ...verifyTrackRecordMeta(price), paid: true, priceUsd: price },
    { name: "buy_signal", ...buySignalMeta(env().MCP_CUSTODIAL), paid: true, priceUsd: "signal price" },
    { name: "get_purchase", ...getPurchaseMeta, paid: false },
  ];
}

/** One MCP server per request (stateless): the caller's API key scopes every call. */
export function createServer(opts: { apiKey?: string; header?: (n: string) => string | undefined }) {
  const ctx: Ctx = { api: new Nundina(opts.apiKey), anon: new Nundina(), header: opts.header ?? (() => undefined) };
  const web = env().WEB_ORIGIN.split(",")[0]!.trim();
  const s = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  const ro = { readOnlyHint: true, openWorldHint: true };
  s.registerTool("list_providers", { ...listProvidersMeta, inputSchema: listProvidersInput, outputSchema: listProvidersOutput, annotations: ro }, listProviders(ctx, web));
  s.registerTool("get_signals", { ...getSignalsMeta, inputSchema: getSignalsInput, outputSchema: getSignalsOutput, annotations: ro }, getSignals(ctx));
  s.registerTool("get_signal", { ...getSignalMeta, inputSchema: getSignalInput, outputSchema: getSignalOutput, annotations: ro }, getSignal(ctx));
  s.registerTool(
    "verify_track_record",
    { ...verifyTrackRecordMeta(fromUnits(env().VERIFY_PRICE_UNITS)), inputSchema: verifyTrackRecordInput, outputSchema: verifyTrackRecordOutput, annotations: { readOnlyHint: false, openWorldHint: true } },
    verifyTrackRecord(ctx),
  );
  s.registerTool(
    "buy_signal",
    { ...buySignalMeta(env().MCP_CUSTODIAL), inputSchema: buySignalInput, outputSchema: buySignalOutput, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
    buySignal(ctx),
  );
  s.registerTool("get_purchase", { ...getPurchaseMeta, inputSchema: getPurchaseInput, outputSchema: getPurchaseOutput, annotations: ro }, getPurchase(ctx));
  return s;
}
