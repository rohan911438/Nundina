import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** WCAG contrast of every text-ish token on background and surface, in both themes (≥ 4.5:1). */
const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

function block(selector: string) {
  const i = css.indexOf(selector);
  const body = css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!]));
}

function lum(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

describe.each([
  ["dark", block(":root {")],
  ["light", block(':root[data-theme="light"]')],
])("%s theme", (_name, t) => {
  for (const fg of ["text", "muted", "accent", "win", "loss", "locked", "void"]) {
    for (const bg of ["bg", "surface", "surface-2"]) {
      it(`${fg} on ${bg} ≥ 4.5`, () => expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5));
    }
  }
  it("accent-ink on accent ≥ 4.5", () => expect(contrast(t["accent-ink"]!, t.accent!)).toBeGreaterThanOrEqual(4.5));
});
