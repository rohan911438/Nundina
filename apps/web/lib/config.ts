/**
 * Public config. The server calls the API directly (`API_URL`); the browser goes through this
 * origin's `/backend` proxy (next.config.ts) so the session cookie is first-party.
 */
export const config = {
  apiUrl:
    typeof window === "undefined" ? (process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787") : "/backend",
  /** The API as the outside world reaches it (snippets, docs). */
  publicApiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 133),
  /** Our bot (@BotFather). Empty hides every Telegram link rather than pointing at someone else's bot. */
  botUsername: (process.env.NEXT_PUBLIC_BOT_USERNAME ?? "").replace(/^@/, ""),
  githubUrl: process.env.NEXT_PUBLIC_GITHUB_URL ?? "https://github.com/nundina",
  /** HSP payment explorer; TODO(confirm) with HSP organizers. Without it payment ids show as text. */
  hspExplorerUrl: process.env.NEXT_PUBLIC_HSP_EXPLORER_URL ?? "",
};
