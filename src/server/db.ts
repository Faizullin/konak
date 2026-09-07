import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
// Relative, not "@/env.mjs" / "@/generated/prisma/client". `src/server/auth.ts`
// imports this file, and `npm run auth:generate` loads that config through
// jiti, which does not read tsconfig `paths`. The alias stays the convention
// everywhere else — these two files are on the CLI's load path.
import { env } from "../env.mjs";
import { PrismaClient } from "../generated/prisma/client";

const globalForPrisma = global as unknown as {
  prisma: PrismaClient;
  prismaAdapter: PrismaBetterSqlite3;
};

// Cache the adapter alongside the client so hot-reloads in dev don't open a
// second handle to the same SQLite file on every module evaluation.
const adapter = globalForPrisma.prismaAdapter ?? new PrismaBetterSqlite3({ url: env.DATABASE_URL });

const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prismaAdapter = adapter;
  globalForPrisma.prisma = prisma;
}

export default prisma;
