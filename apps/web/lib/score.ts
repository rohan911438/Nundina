import type { ApiProviderDetail, ApiScore } from "@nundina/shared";

/** A profile is a track record: show the all-time, all-markets score (the API's headline is 30 d). */
export function allTimeScore(p: ApiProviderDetail): ApiScore {
  return p.scores.find((s) => s.period === "all" && s.market === "all") ?? p.score;
}
