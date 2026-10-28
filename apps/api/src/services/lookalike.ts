/**
 * Impersonation check for channel names. Fake channels copy a known provider's name with small
 * changes: digits for letters (crypt0king), extra words ("official", "vip"), a swapped letter.
 * Names are folded to a skeleton and compared by edit distance; a hit is a warning shown to buyers,
 * not a block, because two honest channels can have similar names.
 */

// characters people swap in to look like a letter (a skeleton keeps the letter)
const CONFUSABLE: Record<string, string> = {
  "0": "o",
  "1": "l",
  i: "l",
  "|": "l",
  "!": "l",
  "3": "e",
  "4": "a",
  "@": "a",
  "5": "s",
  $: "s",
  "7": "t",
  "8": "b",
  "9": "g",
};
// decoration that doesn't make a different channel
const NOISE = ["official", "original", "real", "the", "channel", "group", "team", "vip", "premium", "signals", "signal", "tg", "telegram"];
const fold = (s: string) => [...s].map((c) => CONFUSABLE[c] ?? c).join("").replace(/rn/g, "m").replace(/vv/g, "w");
// compared after folding, so "OFFICIAL" and "0fficial" both go
const NOISE_FOLDED = NOISE.map(fold).sort((a, b) => b.length - a.length);

/** "Crypt0_King OFFICIAL" → "cryptoklng" (so "CryptoKing" matches). */
export function skeleton(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // accents
    .toLowerCase()
    .replace(/^@/, "")
    // numbers ("_2024", "prov_17931") are suffixes, not letters in disguise; a lone 0 in crypt0 is
    .replace(/\d{2,}/g, "");
  // whole words only ("the" stays in "weather"), plus a run-together tail or head ("cryptokingofficial")
  let out = fold(s)
    .split(/[^a-z]+/)
    .filter((w) => w && !NOISE_FOLDED.includes(w))
    .join("");
  for (let changed = true; changed; ) {
    changed = false;
    for (const w of NOISE_FOLDED) {
      if (out.length - w.length < 4) continue;
      if (out.endsWith(w)) out = out.slice(0, -w.length);
      else if (out.startsWith(w)) out = out.slice(w.length);
      else continue;
      changed = true;
    }
  }
  return out;
}

function distance(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]!;
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j]!;
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length]!;
}

/** True when two names would read as the same channel at a glance. */
export function looksAlike(a: string, b: string): boolean {
  const x = skeleton(a);
  const y = skeleton(b);
  if (x.length < 4 || y.length < 4) return x === y && x.length > 0;
  if (x === y) return true;
  const shorter = Math.min(x.length, y.length);
  if (shorter >= 6 && (x.includes(y) || y.includes(x))) return true;
  return distance(x, y) <= (shorter >= 9 ? 2 : 1);
}

export interface NamedProvider {
  handle: string;
  names: (string | null | undefined)[];
}

/** The first established provider any of `names` resembles, or null. */
export function lookalikeOf(names: (string | null | undefined)[], established: NamedProvider[]): string | null {
  const mine = names.filter((n): n is string => Boolean(n));
  for (const p of established) {
    for (const theirs of p.names) {
      if (theirs && mine.some((m) => looksAlike(m, theirs))) return p.handle;
    }
  }
  return null;
}
