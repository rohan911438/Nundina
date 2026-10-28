import type { NextConfig } from "next";

const config: NextConfig = {
  // @nundina/shared ships TypeScript source
  transpilePackages: ["@nundina/shared"],
  poweredByHeader: false,
  reactStrictMode: true,
  // links the bot posted before the routes settled
  async redirects() {
    return [
      { source: "/signal/:id", destination: "/s/:id", permanent: true },
      { source: "/dashboard/agent", destination: "/dashboard/agents", permanent: true },
    ];
  },
};

export default config;
