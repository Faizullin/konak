import { directoryRouter } from "@/features/directory/server";
import { userRouter } from "@/features/identity/server";
import { organizationRouter } from "@/features/organizations/server";
import { platformRouter } from "@/features/platform/server";
import { rateRouter } from "@/features/rates/server";
import { reservationRouter } from "@/features/reservations/server";
import { createTRPCRouter } from "./trpc";

// The single typed root: composition and nothing else. Every feature router
// lives in `features/<name>/server/router.ts`; only the root imports them.
export const appRouter = createTRPCRouter({
  user: userRouter,
  directory: directoryRouter,
  organization: organizationRouter,
  platform: platformRouter,
  rate: rateRouter,
  reservation: reservationRouter,
});

export type AppRouter = typeof appRouter;
