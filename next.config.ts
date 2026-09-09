import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // Raw `process.env`: this file runs before the app, outside the module graph
  // `env.mjs` lives in. Everywhere else reads the validated `env`.
  output: process.env.BUILD_STANDALONE === "true" ? "standalone" : undefined,
};

// The request config lives in `lib/` rather than next-intl's default `i18n/`,
// because the architecture already has a home for a replaceable adapter.
export default createNextIntlPlugin("./src/lib/i18n.ts")(nextConfig);
