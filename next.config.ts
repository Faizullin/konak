import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Raw `process.env`: this file runs before the app, outside the module graph
  // `env.mjs` lives in. Everywhere else reads the validated `env`.
  output: process.env.BUILD_STANDALONE === "true" ? "standalone" : undefined,
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
