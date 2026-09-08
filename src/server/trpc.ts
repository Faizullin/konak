import { headers } from "next/headers";
import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { userCan } from "@/features/identity";
import { auth } from "@/server/auth";
import prisma from "./db";
import { FieldErrorCause } from "./errors";

export const createTRPCContext = async () => {
  const session = await auth.api.getSession({ headers: await headers() });

  return {
    db: prisma,
    session,
  };
};

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        // Which field failed, when the server knows. Zod fills the first for
        // schema failures; `fieldError()` fills the second for the domain
        // rules Zod cannot express. Both are read by `lib/errors.ts`.
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
        field: error.cause instanceof FieldErrorCause ? error.cause.field : null,
      },
    };
  },
});

export const createCallerFactory = t.createCallerFactory;

export const createTRPCRouter = t.router;

export const publicProcedure = t.procedure;

/** A Better Auth session is present. `ctx.session.user` is non-null from here on. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "You must be signed in" });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
});

/**
 * As above, plus every install-wide capability. The role rides on the session,
 * so this costs no query.
 *
 * Verbs are AND-ed, so this asks for the whole of `userStatements` and passes
 * only for a role granted all of it — ADMIN, today. A procedure that wants one
 * capability rather than all of them should ask `userCan` directly instead of
 * widening this guard.
 */
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!userCan(ctx.session.user.role, { user: ["list", "set-role"] })) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This action requires an administrator" });
  }
  return next({ ctx });
});
