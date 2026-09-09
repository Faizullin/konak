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

    // Where attachments are stored. `filesystem` needs no account and no
    // service, so a clone runs without any of the variables below. Which of
    // them are required depends on this value — see `createFinalSchema`.
    STORAGE_PROVIDER: z
      .enum(["filesystem", "s3", "cloudinary", "vercel-blob"])
      .default("filesystem"),
    // Must sit outside `public/`, or Next serves every passport scan to anyone.
    STORAGE_FS_ROOT: z.string().default(".storage"),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    // Set for MinIO and R2, absent for AWS itself.
    S3_ENDPOINT: z.string().optional(),
    CLOUDINARY_CLOUD_NAME: z.string().optional(),
    CLOUDINARY_API_KEY: z.string().optional(),
    CLOUDINARY_API_SECRET: z.string().optional(),
    BLOB_READ_WRITE_TOKEN: z.string().optional(),
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
    STORAGE_PROVIDER: process.env.STORAGE_PROVIDER,
    STORAGE_FS_ROOT: process.env.STORAGE_FS_ROOT,
    S3_BUCKET: process.env.S3_BUCKET,
    S3_REGION: process.env.S3_REGION,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
  },
  /**
   * A provider is only asked for the variables it actually needs. Selecting S3
   * without a bucket fails at startup with the name of the missing variable,
   * the way `FIELD_ENCRYPTION_KEY` does — rather than at the first upload.
   */
  createFinalSchema: (shape) =>
    z.object(shape).superRefine((value, ctx) => {
      const required = {
        filesystem: [],
        s3: ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"],
        cloudinary: ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"],
        "vercel-blob": ["BLOB_READ_WRITE_TOKEN"],
      }[value.STORAGE_PROVIDER];

      for (const name of required ?? []) {
        if (!value[name]) {
          ctx.addIssue({
            code: "custom",
            path: [name],
            message: `required when STORAGE_PROVIDER is "${value.STORAGE_PROVIDER}"`,
          });
        }
      }
    }),
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
