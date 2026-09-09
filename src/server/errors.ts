import type { Refusal } from "../lib/refusal";

/**
 * Errors thrown from more than one place, and the classes the domain throws.
 *
 * A message with a single caller stays inline at the throw; the two helpers at
 * the bottom earned a name by having more.
 *
 * Reached by `auth.ts`, which `auth:generate` loads through jiti — so no `@/`
 * aliases here.
 */

/**
 * Codes for the refusals this file owns.
 *
 * Features declare their own in `model/`; these two cannot, because `auth.ts`
 * reaches this file and `auth:generate` loads it through jiti, which does not
 * read tsconfig `paths`. The values match the feature catalogues that mean the
 * same thing — it is one fact about one row, whoever refused it.
 */
export const SharedError = {
  USER_NOT_FOUND: "user.not_found",
  MEMBER_NOT_FOUND: "member.not_found",
  /** Signed in, and not a member of the organization asked about. */
  ORG_NO_ACCESS: "organization.no_access",
  ORG_MANAGER_REQUIRED: "organization.manager_required",
  ORG_OWNER_REQUIRED: "organization.owner_required",
  /** No session at all. The client redirects rather than showing this. */
  NOT_SIGNED_IN: "auth.not_signed_in",
  ADMIN_REQUIRED: "auth.admin_required",
} as const;

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
  /**
   * What a translation of `code` needs to say the same thing.
   *
   * Six refusals interpolate a runtime value — how many rooms are free, which
   * night, which module. A code alone cannot reproduce those, so the values
   * travel with it and the client formats them. Set through `.with()`.
   */
  values?: Record<string, string | number>;

  constructor(
    readonly status: DomainStatus,
    readonly code: string,
    message: string,
    /** Set when the failure belongs to one input. */
    readonly field?: string
  ) {
    super(message);
    this.name = "DomainError";
  }

  /**
   * Attach the values the message interpolated, so a translation can too.
   *
   * A method rather than another constructor argument: `field` is already
   * positional in three of the subclasses and optional in the rest, and a
   * fifth slot would be unreadable at the six call sites that need it.
   */
  with(values: Record<string, string | number>): this {
    this.values = values;
    return this;
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

/** No session. The client redirects on this rather than showing the message. */
export class UnauthorizedError extends DomainError {
  constructor(code: string, message: string) {
    super("UNAUTHORIZED", code, message);
    this.name = "UnauthorizedError";
  }
}

/** Something that must exist first does not — a number series, a configuration. */
export class PreconditionError extends DomainError {
  constructor(code: string, message: string, field?: string) {
    super("PRECONDITION_FAILED", code, message, field);
    this.name = "PreconditionError";
  }
}

/**
 * A `DomainError` from a rule's refusal.
 *
 * The rules in `model/` answer with a code, values and a plain fallback; this
 * is the one place that turns one into something a router can throw, so the
 * five call sites do not each remember to carry the values across.
 */
export function refused(
  refusal: Refusal,
  kind: "invalid" | "conflict" = "invalid",
  field?: string
): DomainError {
  const error =
    kind === "conflict"
      ? new ConflictError(refusal.code, refusal.message, field)
      : new InvalidError(refusal.code, refusal.message, field);

  return refusal.values ? error.with(refusal.values) : error;
}

/** The signed-in caller has no `User` row: deleted mid-session, usually. */
export function userNotFound() {
  return new NotFoundError(SharedError.USER_NOT_FOUND, "User not found");
}

/** No `OrganizationMember` row joins that user to that organization. */
export function memberNotFound() {
  return new NotFoundError(SharedError.MEMBER_NOT_FOUND, "Member not found");
}
