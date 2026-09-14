import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "@/env.mjs";
import { ChannelError, credentialsRefSchema } from "../model";

/**
 * Reads vendor secrets from `CHANNEL_SECRETS_DIR` (one file per connection,
 * mounted read-only into app/worker outside the image).
 */

export type ChannelSecret = Readonly<Record<string, string>>;

function unreadable(ref: string | null, why: string): Error {
  return new Error(
    `${ChannelError.CREDENTIALS_MISSING}: ${why}${ref ? ` (credentialsRef "${ref}")` : ""}`
  );
}

export async function resolveChannelSecret(ref: string | null): Promise<ChannelSecret> {
  if (!ref) {
    throw unreadable(null, "the connection carries no credentialsRef");
  }
  // Re-validated so un-migrated rows cannot traverse directories.
  if (!credentialsRefSchema.safeParse(ref).success) {
    throw unreadable(ref, "that is not a secret name");
  }

  const dir = env.CHANNEL_SECRETS_DIR;
  if (!dir) {
    throw unreadable(ref, "CHANNEL_SECRETS_DIR is not set");
  }

  let raw: string;
  try {
    raw = await readFile(join(dir, `${ref}.json`), "utf8");
  } catch {
    throw unreadable(ref, `no readable secret file in ${dir}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw unreadable(ref, "the secret file is not JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw unreadable(ref, "the secret file is not a JSON object");
  }

  const secret: Record<string, string> = {};
  for (const [field, value] of Object.entries(parsed)) {
    if (typeof value !== "string") {
      throw unreadable(ref, `"${field}" in the secret file is not a string`);
    }
    secret[field] = value;
  }

  return Object.freeze(secret);
}

/** Whether the secret file behind a ref can be read (used by UI badges/guards). */
export async function channelSecretReadable(ref: string | null): Promise<boolean> {
  try {
    await resolveChannelSecret(ref);
    return true;
  } catch {
    return false;
  }
}
