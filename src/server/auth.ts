import { TRPCError } from "@trpc/server";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
// Relative imports, and never through a feature barrel: `npm run auth:generate`
// loads this file with jiti, which does not read tsconfig `paths`. The rule
// applies to everything this file transitively reaches.
import { env } from "../env.mjs";
import { UserRole } from "../features/identity/model/user";
import { OrgRole, canManageMembers } from "../features/organizations/model/organization";
import prisma from "./db";

/**
 * A provider is registered only when both halves of its pair are present.
 * Absent beats present-and-blank: an unconfigured provider must not reach the
 * runtime provider list at all.
 */
const socialProviders = {
  ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
    ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } }
    : {}),
  ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
    : {}),
};

/**
 * The provider ids that actually got registered above. The credential screens
 * render one button per entry, so an unconfigured provider never reaches the
 * UI — derived from the same object rather than re-reading env, so the two
 * cannot disagree.
 */
export const configuredSocialProviders = Object.keys(socialProviders) as ("github" | "google")[];

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,

  database: prismaAdapter(prisma, { provider: "sqlite" }),

  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },

  socialProviders,

  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["github", "google"],
    },
  },

  user: {
    additionalFields: {
      // `input: false` is what stops a caller POSTing themselves to ADMIN at
      // sign-up. Only `adminProcedure` writes this, through Prisma.
      role: { type: "string", defaultValue: UserRole.USER, input: false },
    },
  },

  // Must be last: lets Server Actions set the session cookie.
  plugins: [nextCookies()],
});

/**
 * Shared access-control helpers — the framework layer every feature router
 * composes, so a procedure states *what it needs* (a user, a member, an owner)
 * instead of re-querying the same two rows with different error strings.
 */
export type AuthedContext = {
  db: typeof prisma;
  session: {
    user: { id: string; email: string; name: string; role: string };
    session: { id: string; expiresAt: Date };
  };
};

/**
 * The live `User` row for the caller, or 404.
 *
 * The session already carries id, email, name and role — callers needing only
 * those should read `ctx.session.user` and skip this. It exists for the cases
 * that need the current row: a role changed in another tab, a user deleted
 * mid-session.
 */
export async function requireUser(ctx: AuthedContext) {
  const user = await ctx.db.user.findUnique({
    where: { id: ctx.session.user.id },
  });
  if (!user) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
  }
  return user;
}

/**
 * The current user plus their membership in `organizationId`, or 403.
 *
 * A non-member gets FORBIDDEN rather than NOT_FOUND on purpose: the two are
 * indistinguishable to someone probing ids, and FORBIDDEN is the honest answer
 * for the case that matters — you are signed in, and this is not yours.
 */
export async function requireOrgMember(ctx: AuthedContext, organizationId: number) {
  const user = await requireUser(ctx);
  const member = await ctx.db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId: user.id } },
  });
  if (!member) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No access to this organization" });
  }
  return { user, member, role: member.role as OrgRole };
}

/** Like `requireOrgMember`, additionally requiring OWNER or ADMIN. */
export async function requireOrgManager(ctx: AuthedContext, organizationId: number) {
  const result = await requireOrgMember(ctx, organizationId);
  if (!canManageMembers(result.role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only owners and admins can perform this action",
    });
  }
  return result;
}

/** Like `requireOrgMember`, additionally requiring OWNER. */
export async function requireOrgOwner(ctx: AuthedContext, organizationId: number) {
  const result = await requireOrgMember(ctx, organizationId);
  if (result.role !== OrgRole.OWNER) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the organization owner can perform this action",
    });
  }
  return result;
}
