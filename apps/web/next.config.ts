import type { NextConfig } from "next";

const config: NextConfig = {
  // @nundina/shared ships TypeScript source
  transpilePackages: ["@nundina/shared"],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
