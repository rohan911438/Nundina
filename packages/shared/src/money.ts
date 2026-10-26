/** 6-decimal stablecoin helpers (USDT / USDC.e). */
export const TOKEN_DECIMALS = 6;
/** Oracle price decimals (APRO). Signal prices use this too. */
export const PRICE_DECIMALS = 8;

function parseFixed(value: string, decimals: number): bigint {
  const v = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(v)) throw new Error(`Invalid amount: "${value}"`);
  const neg = v.startsWith("-");
  const [int, frac = ""] = (neg ? v.slice(1) : v).split(".");
  if (frac.length > decimals) throw new Error(`Too many decimals (max ${decimals}): "${value}"`);
  const units = BigInt(int!) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
  return neg ? -units : units;
}

function formatFixed(units: bigint, decimals: number): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const base = 10n ** BigInt(decimals);
  const int = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}

/** toUnits("1.50") → 1_500_000n */
export const toUnits = (v: string) => parseFixed(v, TOKEN_DECIMALS);
/** fromUnits(1_500_000n) → "1.5" */
export const fromUnits = (u: bigint) => formatFixed(u, TOKEN_DECIMALS);

/** toPrice("81500") → 8_150_000_000_000n (8 decimals) */
export const toPrice = (v: string | number) => parseFixed(String(v), PRICE_DECIMALS);
export const fromPrice = (p: bigint) => formatFixed(p, PRICE_DECIMALS);

export function formatUsd(units: bigint, opts: { decimals?: number } = {}) {
  const n = Number(fromUnits(units));
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts.decimals ?? 2,
    maximumFractionDigits: opts.decimals ?? 2,
  });
}
