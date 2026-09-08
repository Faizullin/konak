import { directoryRouter } from "@/features/directory/server";
import { userRouter } from "@/features/identity/server";
import { organizationRouter } from "@/features/organizations/server";
import { createTRPCRouter } from "./trpc";

// The single typed root: composition and nothing else. Every feature router
// lives in `features/<name>/server/router.ts`; only the root imports them.
export const appRouter = createTRPCRouter({
  user: userRouter,
  directory: directoryRouter,
  organization: organizationRouter,
});

export type AppRouter = typeof appRouter;
