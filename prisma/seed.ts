import "dotenv/config";
import { UserRole } from "../src/features/identity/model";
import { OrgRole } from "../src/features/organizations/model";
import { env } from "../src/env.mjs";
import { auth } from "../src/server/auth";
import prisma from "../src/server/db";

/**
 * Demo data for a fresh clone: a clone with an empty database and a
 * hand-rolled sign-up flow is a poor first run.
 *
 * Every account uses the same password so the README can print one line
 * instead of a table. That is also why this refuses to run in production.
 *
 * `import "dotenv/config"` is the one concession to running outside Next.js —
 * `env.mjs` reads `process.env`, and nothing has populated it in a bare `tsx`
 * process. `prisma.config.ts` does the same thing for the same reason.
 *
 * Import discipline: this reaches only into `src/server`, and the `model`
 * directory of a feature. Neither carries `import "server-only"`, so it runs
 * under plain `tsx` with no flags. Importing a feature's `server` directory
 * would change that — see `docs/guides/local-development.md`.
 */

const PASSWORD = "password123";

const USERS = [
  { email: "admin@konak.dev", name: "Ada Admin", role: UserRole.ADMIN },
  { email: "mod@konak.dev", name: "Mo Moderator", role: UserRole.MODERATOR },
  { email: "user@konak.dev", name: "Uma User", role: UserRole.USER },
];

async function main() {
  if (env.NODE_ENV === "production") {
    throw new Error("The seed writes accounts with a known password. Not in production.");
  }

  let created = 0;

  for (const { email, name, role } of USERS) {
    // Re-running is a no-op rather than an error, so this is safe to call
    // after adding a user to the list above.
    if (await prisma.user.findUnique({ where: { email } })) continue;

    // signUpEmail, not prisma.user.create — it is what writes the hashed
    // credential into `accounts`. A user row inserted directly through Prisma
    // has no password and can never sign in.
    const { user } = await auth.api.signUpEmail({
      body: { email, name, password: PASSWORD },
    });

    // `role` is an `input: false` field, so it cannot arrive through
    // signUpEmail — it is set here, straight through Prisma, on purpose.
    if (role !== UserRole.USER) {
      await prisma.user.update({ where: { id: user.id }, data: { role } });
    }

    created += 1;
  }

  const owner = await prisma.user.findUniqueOrThrow({ where: { email: "admin@konak.dev" } });
  const member = await prisma.user.findUniqueOrThrow({ where: { email: "user@konak.dev" } });

  await prisma.organization.upsert({
    where: { slug: "acme" },
    update: {},
    create: {
      name: "Acme Inc",
      slug: "acme",
      description: "Demo organization created by the seed script.",
      ownerId: owner.id,
      members: {
        create: [
          { userId: owner.id, role: OrgRole.OWNER },
          { userId: member.id, role: OrgRole.MEMBER },
        ],
      },
    },
  });

  console.log(
    created === 0
      ? `Nothing to do — all ${USERS.length} demo users already exist.`
      : `Created ${created} of ${USERS.length} demo users. Password: ${PASSWORD}`
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
