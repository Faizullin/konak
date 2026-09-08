import { PrismaPg } from "@prisma/adapter-pg";
// Relative, not "@/env.mjs" / "@/generated/prisma/client". `src/server/auth.ts`
// imports this file, and `npm run auth:generate` loads that config through
// jiti, which does not read tsconfig `paths`. The alias stays the convention
// everywhere else — these two files are on the CLI's load path.
import { env } from "../env.mjs";
import { PrismaClient } from "../generated/prisma/client";

const globalForPrisma = global as unknown as {
  prisma: PrismaClient;
  prismaAdapter: PrismaPg;
};

// Cache the adapter alongside the client so hot-reloads in dev do not open a
// new connection pool on every module evaluation.
const adapter =
  globalForPrisma.prismaAdapter ?? new PrismaPg({ connectionString: env.DATABASE_URL });

const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prismaAdapter = adapter;
  globalForPrisma.prisma = prisma;
}

export default prisma;
