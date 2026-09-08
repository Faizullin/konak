import { TRPCError } from "@trpc/server";

/**
 * Errors thrown from more than one place. A message with a single caller stays
 * inline at the throw; these earned a name by having two.
 *
 * Reached by `auth.ts`, which `auth:generate` loads through jiti — so no `@/`
 * aliases here.
 */

/** The signed-in caller has no `User` row: deleted mid-session, usually. */
export function userNotFound() {
  return new TRPCError({ code: "NOT_FOUND", message: "User not found" });
}

/** No `OrganizationMember` row joins that user to that organization. */
export function memberNotFound() {
  return new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
}

/**
 * Carries a field name on the error's `cause`; `errorFormatter` copies it onto
 * `data.field`. Gives the rules Zod cannot express — a taken slug, an address
 * with no account — the same channel Zod's own field errors use.
 */
export class FieldErrorCause extends Error {
  constructor(readonly field: string) {
    super(`field:${field}`);
    this.name = "FieldErrorCause";
  }
}

/** A `TRPCError` the client can render under `field`. */
export function fieldError(
  field: string,
  message: string,
  code: "BAD_REQUEST" | "CONFLICT" | "NOT_FOUND" = "BAD_REQUEST"
) {
  return new TRPCError({ code, message, cause: new FieldErrorCause(field) });
}
