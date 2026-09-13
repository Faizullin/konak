import { billingRouter } from "@/features/billing/server";
import { channelRouter } from "@/features/channels/server/router";
import { directoryRouter } from "@/features/directory/server";
import { housekeepingRouter } from "@/features/housekeeping/server";
import { userRouter } from "@/features/identity/server";
import { organizationRouter } from "@/features/organizations/server";
import { platformRouter } from "@/features/platform/server";
import { propertyRouter } from "@/features/properties/server";
import { rateRouter } from "@/features/rates/server";
import { reservationRouter } from "@/features/reservations/server";
import { createTRPCRouter } from "./trpc";

// The single typed root: composition and nothing else. Every feature router
// lives in `features/<name>/server/router.ts`; only the root imports them.
export const appRouter = createTRPCRouter({
  user: userRouter,
  billing: billingRouter,
  channel: channelRouter,
  directory: directoryRouter,
  housekeeping: housekeepingRouter,
  organization: organizationRouter,
  platform: platformRouter,
  property: propertyRouter,
  rate: rateRouter,
  reservation: reservationRouter,
});

export type AppRouter = typeof appRouter;
