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

/**
 * A domain failure, thrown by the domain and turned into a `TRPCError` once, at
 * the boundary — the middleware in `trpc.ts`.
 *
 * The point is `code`. Today every refusal is an English sentence, so a test
 * asserts on prose and a translation has nothing to key on. A code is stable
 * where a sentence is not: the message can be reworded, or later translated,
 * without a router test noticing.
 *
 * `status` is the tRPC code the boundary maps to, so a caller still gets the
 * right HTTP semantics — `lib/errors.ts` routes on that, unchanged.
 *
 * Codes themselves are **not declared here.** `errors.ts` is reached by
 * `auth.ts`, which `auth:generate` loads through jiti, so it may not import
 * from `features/`. Each feature declares its own in `model/`, which is also
 * what lets the client compare against the same constant.
 */
export type DomainStatus =
  "BAD_REQUEST" | "CONFLICT" | "NOT_FOUND" | "FORBIDDEN" | "UNAUTHORIZED" | "PRECONDITION_FAILED";

export class DomainError extends Error {
  constructor(
    readonly status: DomainStatus,
    readonly code: string,
    message: string,
    /** Set when the failure belongs to one input, like `fieldError`. */
    readonly field?: string
  ) {
    super(message);
    this.name = "DomainError";
  }
}

/** The row named does not exist, or does not belong to the caller's scope. */
export class NotFoundError extends DomainError {
  constructor(code: string, message: string) {
    super("NOT_FOUND", code, message);
    this.name = "NotFoundError";
  }
}

/** Signed in, and this is not theirs. Never NOT_FOUND — see architecture.md. */
export class ForbiddenError extends DomainError {
  constructor(code: string, message: string) {
    super("FORBIDDEN", code, message);
    this.name = "ForbiddenError";
  }
}

/** The request is coherent but the world disagrees: taken, sold out, occupied. */
export class ConflictError extends DomainError {
  constructor(code: string, message: string, field?: string) {
    super("CONFLICT", code, message, field);
    this.name = "ConflictError";
  }
}

/** A rule the schema could not express refused the input. */
export class InvalidError extends DomainError {
  constructor(code: string, message: string, field?: string) {
    super("BAD_REQUEST", code, message, field);
    this.name = "InvalidError";
  }
}

/** Something that must exist first does not — a number series, a configuration. */
export class PreconditionError extends DomainError {
  constructor(code: string, message: string, field?: string) {
    super("PRECONDITION_FAILED", code, message, field);
    this.name = "PreconditionError";
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
