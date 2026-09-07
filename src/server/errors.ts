import { TRPCError } from "@trpc/server";

/**
 * The errors thrown from more than one place.
 *
 * Most throws in this codebase spell out their message inline, and should: a
 * message with a single caller reads better next to the condition that raises
 * it than it does behind a name. These two earned a name by having two callers
 * each, in files that do not import one another — so nothing made the two
 * copies change together.
 *
 * Each returns the error rather than throwing it, so `throw` stays visible at
 * the call site and the control flow reads the same as the inline throws it
 * replaces.
 *
 * This file is reached by `auth.ts`, which `npm run auth:generate` loads
 * through jiti — so it must never import through a tsconfig `paths` alias.
 */

/** The signed-in caller has no `User` row: deleted mid-session, usually. */
export function userNotFound() {
  return new TRPCError({ code: "NOT_FOUND", message: "User not found" });
}

/** No `OrganizationMember` row joins that user to that organization. */
export function memberNotFound() {
  return new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
}
