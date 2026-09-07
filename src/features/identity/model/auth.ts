import { z } from "zod";

/**
 * The client-side contract for the credential forms.
 *
 * These live in `model/` rather than inline in the form files so the form
 * cannot drift from what Better Auth will accept. Better Auth re-validates
 * everything server-side — this exists to fail fast in the browser, not to be
 * trusted.
 */

/**
 * Sign-in deliberately does not restate the password rules. A minimum here
 * would reject an existing account whose password predates the rule, and it
 * leaks the rule to someone guessing.
 */
export const signInSchema = z.object({
  email: z.email(),
  password: z.string().min(1, "Password is required"),
});

export type SignInInput = z.infer<typeof signInSchema>;

/**
 * 8 characters, matching Better Auth's server-side default. If this said 6,
 * the form would accept what the server then rejects.
 */
export const signUpSchema = z.object({
  name: z.string().min(1, "Name is required").max(64),
  email: z.email(),
  password: z.string().min(8, "Use at least 8 characters"),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
