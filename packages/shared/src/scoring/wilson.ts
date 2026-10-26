/**
 * Lower bound of the Wilson score interval for a win rate (z = 1.96 → 95%).
 * Penalises small samples: 3/3 ≈ 0.44 ranks below 60/100 ≈ 0.50.
 */
export function wilsonLowerBound(wins: number, n: number, z = 1.96): number {
  if (n <= 0) return 0;
  const p = wins / n;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.max(0, (centre - margin) / (1 + z2 / n));
}
