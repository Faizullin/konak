import { UserRole } from "../src/features/identity/model";

/**
 * The accounts the seed writes, in one place.
 *
 * Three files quote them: the seed that creates them, the browser fixture that
 * signs in as each, and the MVP report that prints them for whoever is about to
 * run the demonstration. They were written out twice before, and a report
 * quoting a password the seed no longer writes is worse than a report with no
 * accounts in it at all.
 *
 * Its own module rather than an export from `seed.ts`, because importing that
 * file runs it — it is a script with top-level awaits, not a library.
 *
 * Constants and no side effects, so `tsx`, Playwright's ESM loader and Next's
 * bundler can all read it.
 */

// Not a common password: `haveIBeenPwned()` in `auth.ts` rejects anything that
// appears in a breach corpus, which "password123" very much does.
export const DEMO_PASSWORD = "konak-demo-pw";

export const DEMO_USERS = [
  { email: "admin@konak.dev", name: "Ada Admin", role: UserRole.ADMIN },
  { email: "mod@konak.dev", name: "Mo Moderator", role: UserRole.MODERATOR },
  { email: "user@konak.dev", name: "Uma User", role: UserRole.USER },
] as const;

export type DemoUser = (typeof DEMO_USERS)[number];

/** The one a demonstration signs in as: it owns the organization. */
export const DEMO_OWNER_EMAIL = "admin@konak.dev";
