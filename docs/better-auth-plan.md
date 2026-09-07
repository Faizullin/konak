# Technical Migration Plan: Clerk to Better Auth

## 1. Executive Summary & Objective

This document defines the complete technical architecture and implementation roadmap for migrating the **Konak** codebase from **Clerk** to **Better Auth**.

### Core Goals
- **Dual Authentication Support**: Out-of-the-box support for **Email + Password** (secure scrypt hashing, registration, verification, session issuance) and **Social OAuth** (GitHub, Google) with automatic account linking.
- **Direct Database Ownership**: Eliminate external webhook ingestion (`/api/webhooks/clerk`) and local development tunnel dependencies (`localtunnel`), moving to transactional database writes via Prisma (SQLite).
- **Prisma Split-Schema Integration**: Seamlessly integrate Better Auth's Prisma Adapter with the project's multi-file Prisma schema (`prisma/schema/*.prisma`) and Better Auth CLI.
- **Strict Architectural Compliance**: Preserve the project's established 3-entry-point domain slicing (`<feature>/server`, `<feature>/client`, `<feature>/model`), compile-time `server-only` boundaries, and resource-level authorization.
- **Preservation of Existing Documentation**: Leave all existing guides in `docs/guides/` intact.

---

## 2. Deep Dive: Better Auth + Prisma Adapter Architecture

### 2.1 How the Better Auth Prisma Adapter Works
Better Auth communicates with the database via the official adapter imported from `better-auth/adapters/prisma`:

```ts
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import prisma from "@/server/db";

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "sqlite",
  }),
  // ...
});
```

The adapter executes database queries directly through the generated Prisma Client instance (`prisma.user`, `prisma.session`, `prisma.account`, `prisma.verification`).

### 2.2 Split-Schema Support & Better Auth CLI Mechanics
Our project utilizes Prisma 7's multi-file schema capability (`prisma/schema/*.prisma`), orchestrated by `prisma.config.ts`.

Better Auth includes a dedicated CLI (`@better-auth/cli`) capable of parsing the auth configuration and generating the required Prisma model definitions:

```bash
npx @better-auth/cli generate --config ./src/server/auth.ts --output ./prisma/schema/identity.prisma
```

#### Why `--output` and `--config` are Critical:
- By default, the Better Auth CLI expects a single monolithic `prisma/schema.prisma`.
- Passing `--output ./prisma/schema/identity.prisma` ensures that generated models are placed cleanly into the `identity` domain schema file without overwriting `_base.prisma` or `organizations.prisma`.
- Passing `--config ./src/server/auth.ts` explicitly points the CLI to our server configuration file.

### 2.3 Multi-Tenancy Strategy (Custom Domain vs. Plugin)
Better Auth offers an optional `@better-auth/organization` plugin. However, our codebase already has an established, highly refined multi-tenant domain slice in `src/features/organizations/` with custom permission predicates (`canManageMembers`, `canEditOrganization`), specific role invariants (e.g., owner cannot leave), and direct tRPC procedure guards (`requireOrgMember`, `requireOrgManager`, `requireOrgOwner`).

**Architectural Decision**:
- Retain our native `src/features/organizations/` domain slice.
- Bridge identity by updating `Organization.ownerId` and `OrganizationMember.userId` to foreign-key references to `User.id` (`String` UUID).
- Better Auth manages authentication and user credentials; our domain code manages organization memberships and granular application access rules.

---

## 3. Target File Architecture

```
src/
├── app/
│   ├── api/
│   │   ├── auth/[...all]/route.ts    # Better Auth catch-all Next.js route handler
│   │   └── trpc/[trpc]/route.ts      # tRPC transport handler (unchanged)
│   ├── sign-in/page.tsx              # Native Base UI sign-in form (Email/Password + OAuth)
│   ├── sign-up/page.tsx              # Native Base UI sign-up form (Email/Password + OAuth)
│   ├── dashboard/layout.tsx          # Server component guard checking session via Better Auth
│   ├── page.tsx                      # Landing page checking session state
│   └── layout.tsx                    # Root layout (removes ClerkProvider)
│
├── features/
│   ├── identity/
│   │   ├── model/                    # User schemas, UserRole enum (USER, ADMIN)
│   │   ├── server/                   # User query/mutation procedures querying db directly
│   │   └── client/                   # Current user card, profile dialogs
│   │
│   └── organizations/                # Multi-tenant domain (string user ID references)
│
├── lib/
│   └── auth-client.ts                # Isomorphic Better Auth React client (createAuthClient)
│
├── server/
│   ├── auth.ts                       # Better Auth server instance + requireUser/requireOrgMember guards
│   ├── db.ts                         # Prisma client instance (unchanged)
│   ├── trpc.ts                       # tRPC context retrieving Better Auth session from headers
│   └── root.ts                       # App router combining domain routers (unchanged)
│
└── middleware.ts                     # Header/session forwarding middleware
```

---

## 4. Database Schema Design (Prisma)

### 4.1 `prisma/schema/identity.prisma`

```prisma
// identity & authentication
//
// Core authentication tables managed by Better Auth with relations to
// application-level multi-tenant models (Organization, OrganizationMember).

model User {
  id            String    @id @default(uuid())
  name          String
  email         String    @unique
  emailVerified Boolean   @default(false)
  image         String?
  role          String    @default("USER") // USER | ADMIN (UserRole in model/)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  sessions      Session[]
  accounts      Account[]

  ownedOrganizations Organization[]       @relation("OrganizationOwner")
  memberships        OrganizationMember[]

  @@map("users")
}

model Session {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  token     String   @unique
  expiresAt DateTime
  ipAddress String?
  userAgent String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
  @@map("sessions")
}

model Account {
  id                    String    @id @default(uuid())
  userId                String
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  accountId             String
  providerId            String
  accessToken           String?
  refreshToken          String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  idToken               String?
  password              String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  @@index([userId])
  @@map("accounts")
}

model Verification {
  id         String   @id @default(uuid())
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([identifier])
  @@map("verifications")
}
```

### 4.2 `prisma/schema/organizations.prisma` (Foreign Key Adjustments)

```prisma
model Organization {
  id        Int      @id @default(autoincrement())
  name      String
  slug      String   @unique
  ownerId   String   // references User.id
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  owner     User     @relation("OrganizationOwner", fields: [ownerId], references: [id], onDelete: Restrict)
  members   OrganizationMember[]

  @@map("organizations")
}

model OrganizationMember {
  id             Int          @id @default(autoincrement())
  organizationId Int
  userId         String       // references User.id
  role           String       @default("MEMBER")
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([organizationId, userId])
  @@map("organization_members")
}
```

---

## 5. Framework & Integration Layer

### 5.1 Server Initialization (`src/server/auth.ts`)
```ts
import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import prisma from "@/server/db";

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "sqlite",
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID || "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
      enabled: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      enabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "USER",
        input: false,
      },
    },
  },
});
```

### 5.2 Next.js API Catch-All Route (`src/app/api/auth/[...all]/route.ts`)
```ts
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth";

export const { GET, POST } = toNextJsHandler(auth.handler);
```

### 5.3 Isomorphic Client (`src/lib/auth-client.ts`)
```ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
});

export const { useSession, signIn, signUp, signOut } = authClient;
```

### 5.4 tRPC Context Ingestion (`src/server/trpc.ts`)
```ts
import { headers } from "next/headers";
import { auth } from "@/server/auth";
import prisma from "./db";

export const createTRPCContext = async () => {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({
    headers: reqHeaders,
  });

  return {
    db: prisma,
    session,
  };
};
```

### 5.5 Access Control Guards (`src/server/auth.ts`)
```ts
import { TRPCError } from "@trpc/server";
import { OrgRole, canManageMembers } from "@/features/organizations";
import type prisma from "@/server/db";

export type AuthedContext = {
  db: typeof prisma;
  session: {
    user: {
      id: string;
      email: string;
      name: string;
      role: string;
    };
    session: {
      id: string;
      expiresAt: Date;
    };
  };
};

export async function requireUser(ctx: AuthedContext) {
  const user = await ctx.db.user.findUnique({
    where: { id: ctx.session.user.id },
  });
  if (!user) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
  }
  return user;
}

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
```

---

## 6. Sequential Implementation Roadmap

### Phase 1: Dependencies & Script Configuration
1. Install Better Auth: `npm install better-auth`.
2. Uninstall Clerk: `npm uninstall @clerk/nextjs`.
3. Add helper script in `package.json`:
   ```json
   "auth:generate": "npx @better-auth/cli generate --config src/server/auth.ts --output prisma/schema/identity.prisma"
   ```
4. Update `src/env.mjs` and `.env.example` with `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

### Phase 2: Schema & Migrations
1. Update `prisma/schema/identity.prisma` and `prisma/schema/organizations.prisma`.
2. Run `npm run db:migrate` and `npm run db:generate`.

### Phase 3: Server & API Implementation
1. Create `src/server/auth.ts` with Better Auth server configuration and access guards.
2. Create `src/app/api/auth/[...all]/route.ts`.
3. Create `src/lib/auth-client.ts`.
4. Delete legacy Clerk webhook handler at `src/app/api/webhooks/clerk/route.ts`.

### Phase 4: Feature Slices Update
1. **Identity Feature**:
   - Update `src/features/identity/model/user.ts` for string IDs and Better Auth fields.
   - Update `src/features/identity/server/router.ts` (`getCurrent`, `updateProfile`, `adminList`, `updateRole`).
   - Remove `syncClerkUser` from `service.ts`.
2. **Organizations Feature**:
   - Update user reference types across routers and services to support string UUIDs.

### Phase 5: UI & Layout Components
1. Remove `<ClerkProvider>` from `src/app/layout.tsx`.
2. Implement custom Accessible Sign-In and Sign-Up screens under `src/app/sign-in/page.tsx` and `src/app/sign-up/page.tsx` with Email/Password forms and Social OAuth buttons.
3. Update `src/app/dashboard/layout.tsx` and `src/app/page.tsx` to read session via `auth.api.getSession({ headers: await headers() })`.
4. Update `src/components/layout/dashboard/sidebar/nav-user.tsx` to use `authClient.useSession()` and `authClient.signOut()`.

---

## 7. Verification & QA Matrix

| Test ID | Area | Scenario | Expected Result |
| :--- | :--- | :--- | :--- |
| **TC-01** | Static | `npx tsc --noEmit` | 0 TypeScript compilation errors |
| **TC-02** | Static | `npm run lint` | 0 ESLint warnings or errors |
| **TC-03** | Auth | Sign up with Email + Password | User & Session created in SQLite, lands on `/dashboard` |
| **TC-04** | Auth | Sign in with Email + Password | Authenticates credentials and issues valid session cookie |
| **TC-05** | Auth | OAuth Login (GitHub / Google) | Redirects to provider, creates/links account, establishes session |
| **TC-06** | Access | Unauthenticated `/dashboard` request | Server redirects visitor to `/sign-in` |
| **TC-07** | Access | `protectedProcedure` without session | tRPC throws `UNAUTHORIZED` (HTTP 401) |
| **TC-08** | Multi-tenancy | Organization creation & access checks | `requireOrgMember` / `requireOrgOwner` guards function correctly with string user IDs |
| **TC-09** | Auth | User Sign Out via sidebar | Session deleted from SQLite, cookies cleared, redirected to `/` |
