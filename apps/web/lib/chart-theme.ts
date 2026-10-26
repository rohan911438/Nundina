/** Reads the design tokens so canvas charts match the current theme. */
export function chartColors(el: Element = document.documentElement) {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    bg: v("--surface"),
    text: v("--muted"),
    border: v("--border"),
    grid: v("--grid"),
    accent: v("--accent"),
    win: v("--win"),
    loss: v("--loss"),
    locked: v("--locked"),
    void: v("--void"),
    fg: v("--text"),
    mono: `${v("--font-geist-mono") || "ui-monospace"}, monospace`,
  };
}

/** Calls `fn` when the theme attribute or the OS colour scheme changes. */
export function onThemeChange(fn: () => void) {
  const mo = new MutationObserver(fn);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const mq = matchMedia("(prefers-color-scheme: light)");
  mq.addEventListener("change", fn);
  return () => {
    mo.disconnect();
    mq.removeEventListener("change", fn);
  };
}

/** "#3ddc97" + 0.3 → "rgba(61, 220, 151, 0.3)" (the chart library only parses plain colour formats). */
export function alpha(hex: string, a: number) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? [...h].map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
