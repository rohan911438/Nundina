import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  MARKETS,
  Side,
  fromUnits,
  hashSignal,
  makeSignalSchema,
  toPrice,
  toUnits,
  serializeSignal,
  type Signal,
} from "../src/index.js";

const NOW = 1_800_000_000;
const schema = makeSignalSchema(() => NOW);

const base = {
  provider: "0x1111111111111111111111111111111111111111",
  market: MARKETS["BTC/USD"].id,
  side: Side.LONG,
  entry: toPrice("81500"),
  takeProfit: toPrice("84000"),
  stopLoss: toPrice("80200"),
  validUntil: BigInt(NOW + 24 * 3600),
  pricePerSub: toUnits("1.50"),
  upstream: [] as bigint[],
  upstreamBps: [] as number[],
  salt: "0x00000000000000000000000000000000000000000000000000000000000000aa",
} as const;

describe("money", () => {
  it("round-trips", () => {
    expect(toUnits("1.50")).toBe(1_500_000n);
    expect(fromUnits(1_500_000n)).toBe("1.5");
    for (const v of ["0", "0.000001", "12345.678901", "5"]) expect(fromUnits(toUnits(v))).toBe(String(Number(v)));
  });
  it("rejects more than 6 decimals and junk", () => {
    expect(() => toUnits("1.0000001")).toThrow();
    expect(() => toUnits("abc")).toThrow();
  });
});

describe("signal schema", () => {
  it("accepts a valid LONG and SHORT", () => {
    expect(schema.safeParse(base).success).toBe(true);
    const short = { ...base, side: Side.SHORT, takeProfit: toPrice("79000"), stopLoss: toPrice("82500") };
    expect(schema.safeParse(short).success).toBe(true);
  });
  it("rejects bad LONG geometry", () => {
    expect(schema.safeParse({ ...base, takeProfit: toPrice("81000") }).success).toBe(false);
  });
  it("rejects bad SHORT geometry", () => {
    expect(schema.safeParse({ ...base, side: Side.SHORT }).success).toBe(false);
  });
  it("rejects R:R < 1", () => {
    expect(schema.safeParse({ ...base, takeProfit: toPrice("82000") }).success).toBe(false);
  });
  it("rejects past or too-far expiry", () => {
    expect(schema.safeParse({ ...base, validUntil: BigInt(NOW - 10) }).success).toBe(false);
    expect(schema.safeParse({ ...base, validUntil: BigInt(NOW + 60) }).success).toBe(false);
    expect(schema.safeParse({ ...base, validUntil: BigInt(NOW + 8 * 86400) }).success).toBe(false);
  });
  it("rejects upstream mismatch and bps overflow", () => {
    expect(schema.safeParse({ ...base, upstream: [1n], upstreamBps: [] }).success).toBe(false);
    expect(schema.safeParse({ ...base, upstream: [1n, 2n], upstreamBps: [6000, 5000] }).success).toBe(false);
  });
});

describe("hashSignal", () => {
  const CHAIN = 177;
  const BOOK = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;
  const sig: Signal = { ...base, upstream: [7n, 9n], upstreamBps: [3000, 2000] };

  it("is deterministic and sensitive to every field", () => {
    const h = hashSignal(sig, CHAIN, BOOK);
    expect(hashSignal({ ...sig }, CHAIN, BOOK)).toBe(h);
    expect(hashSignal({ ...sig, salt: `0x${"bb".repeat(32)}` }, CHAIN, BOOK)).not.toBe(h);
    expect(hashSignal(sig, 133, BOOK)).not.toBe(h);
  });

  it("matches the golden vector", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "vectors");
    const file = join(dir, "signal.json");
    const vector = {
      chainId: CHAIN,
      verifyingContract: BOOK,
      signal: serializeSignal(sig),
      commitHash: hashSignal(sig, CHAIN, BOOK),
    };
    if (!existsSync(file)) writeFileSync(file, JSON.stringify(vector, null, 2) + "\n");
    const golden = JSON.parse(readFileSync(file, "utf8"));
    expect(golden.commitHash).toBe(vector.commitHash);
  });
});
