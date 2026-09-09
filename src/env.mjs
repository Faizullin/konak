import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * Every variable the app reads, validated once at startup — a missing one
 * fails the build instead of surfacing as `undefined` at runtime.
 */
export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(1),
    BETTER_AUTH_URL: z.string().min(1),
    // 32 bytes, base64. Required rather than optional: a column named
    // `numberEncrypted` that falls back to plaintext when a variable is absent
    // is the exact failure the name promises it is not.
    FIELD_ENCRYPTION_KEY: z
      .string()
      .min(1)
      .refine((value) => Buffer.from(value, "base64").length === 32, {
        message: "must be 32 bytes of base64 — generate one with: openssl rand -base64 32",
      }),
    // A provider is registered only when both halves of its pair are set.
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  },
  // Empty by design: the Better Auth client is same-origin and infers its own
  // base URL, so nothing in the browser needs a validated variable.
  client: {},
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    FIELD_ENCRYPTION_KEY: process.env.FIELD_ENCRYPTION_KEY,
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
