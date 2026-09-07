import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Raw `process.env`: this file runs before the app, outside the module graph
  // `env.mjs` lives in. Everywhere else reads the validated `env`.
  output: process.env.BUILD_STANDALONE === "true" ? "standalone" : undefined,
  eslint: {
    ignoreDuringBuilds: true,
  },
  // better-sqlite3 is a native module: it must stay external to the server
  // bundle, otherwise the .node binding is not resolvable at runtime.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
