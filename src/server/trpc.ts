import { headers } from "next/headers";
import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { userCan } from "@/features/identity";
import { auth } from "@/server/auth";
import prisma from "./db";
import { DomainError, ForbiddenError, SharedError, UnauthorizedError } from "./errors";

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
        // schema failures; a `DomainError` fills the second for the rules Zod
        // cannot express. Both are read by `lib/errors.ts`.
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
        field: error.cause instanceof DomainError ? (error.cause.field ?? null) : null,
        // The stable half of a refusal. A message can be reworded or
        // translated; this is what a test and a translation file key on.
        domainCode: error.cause instanceof DomainError ? error.cause.code : null,
        // What a translation of that code needs, for the refusals whose English
        // interpolated a runtime value.
        domainValues: error.cause instanceof DomainError ? (error.cause.values ?? null) : null,
      },
    };
  },
});

export const createCallerFactory = t.createCallerFactory;

export const createTRPCRouter = t.router;

/**
 * The one place a `DomainError` becomes a `TRPCError`.
 *
 * The domain throws a class with a code; tRPC would otherwise report it as an
 * INTERNAL_SERVER_ERROR, whose message the client deliberately drops. Here it
 * becomes the status the error declared, keeping itself as `cause` so
 * `errorFormatter` can read the code and the field off it.
 *
 * A middleware rather than `errorFormatter`, because by the time the formatter
 * runs the status is already decided — and the status is the half `lib/errors.ts`
 * routes on.
 */
const mapDomainErrors = t.middleware(async ({ next }) => {
  const result = await next();

  if (!result.ok && result.error.cause instanceof DomainError) {
    const domain = result.error.cause;
    throw new TRPCError({ code: domain.status, message: domain.message, cause: domain });
  }

  return result;
});

/** Every procedure below is built from this, so no route can skip the mapping. */
const baseProcedure = t.procedure.use(mapDomainErrors);

export const publicProcedure = baseProcedure;

/** A Better Auth session is present. `ctx.session.user` is non-null from here on. */
export const protectedProcedure = baseProcedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new UnauthorizedError(SharedError.NOT_SIGNED_IN, "You must be signed in");
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
    throw new ForbiddenError(SharedError.ADMIN_REQUIRED, "This action requires an administrator");
  }
  return next({ ctx });
});
