/** Public config. `API_URL` is read on the server; the browser uses `NEXT_PUBLIC_API_URL`. */
export const config = {
  apiUrl:
    (typeof window === "undefined" ? process.env.API_URL : undefined) ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:8787",
  /** The API as the outside world reaches it (snippets, docs). */
  publicApiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 133),
  botUsername: process.env.NEXT_PUBLIC_BOT_USERNAME ?? "NundinaBot",
  githubUrl: process.env.NEXT_PUBLIC_GITHUB_URL ?? "https://github.com/nundina",
  /** HSP payment explorer; TODO(confirm) with HSP organizers. Without it payment ids show as text. */
  hspExplorerUrl: process.env.NEXT_PUBLIC_HSP_EXPLORER_URL ?? "",
};
