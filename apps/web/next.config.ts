import type { NextConfig } from "next";

// The browser reaches the API through this origin (/backend/*), so the session cookie stays
// first-party when web and API live on different domains: cross-site fetches never carry a Lax
// cookie, and Telegram's webview and Safari drop third-party cookies.
const apiOrigin = (process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787").replace(/\/$/, "");

const config: NextConfig = {
  // @nundina/shared ships TypeScript source
  transpilePackages: ["@nundina/shared"],
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return [{ source: "/backend/:path*", destination: `${apiOrigin}/:path*` }];
  },
  // links the bot posted before the routes settled
  async redirects() {
    return [
      { source: "/signal/:id", destination: "/s/:id", permanent: true },
      { source: "/dashboard/agent", destination: "/dashboard/agents", permanent: true },
    ];
  },
};

export default config;
