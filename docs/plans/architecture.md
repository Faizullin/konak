# Architecture: Migration from Clerk to Better Auth

## 1. Executive Summary & Objective

This architectural document outlines the strategy for migrating authentication in **Konak** from **Clerk** to **Better Auth**.

The objective is to replace third-party hosted authentication with a self-hosted, fully typed authentication framework embedded natively into our Next.js App Router, Prisma (SQLite), and tRPC stack. The system will provide:
1. **Email & Password Authentication**: Native registration, secure password hashing (scrypt), and login flows.
2. **OAuth Providers**: GitHub and Google social login with automatic account linking.
3. **Local Identity Ownership**: Elimination of asynchronous webhook ingestion (`/api/webhooks/clerk`) in favor of direct, transactional database writes.
4. **Preservation of Core Architectural Invariants**: Strict compliance with the 3-entry-point domain slicing (`server/`, `client/`, `model/`), resource-level authorization guards, and Next.js 15 / React 19 App Router standards.

---

## 2. Architectural Comparison: As-Is vs. To-Be

```
Current (Clerk):
[ Browser / Client ]
      │
      ├─ Authenticates against ──► [ Clerk Cloud Infrastructure ]
      │                                       │ (Async Webhook)
      ▼                                       ▼
[ Next.js Middleware ] ──(Hydrates)──► [ /api/webhooks/clerk ]
      │                                       │
      ▼                                       ▼
[ tRPC / Server Comps ] ──(Reads auth)─► [ SQLite DB (user_accounts mirror) ]


Target (Better Auth):
[ Browser / Client ]
      │
      ├─ Native Auth Client (`@/lib/auth-client`)
      │
      ▼
[ Next.js Route Handler: /api/auth/[...all] ] ◄──► [ Better Auth Server Core (`@/server/auth`) ]
      │                                                            │
      ▼                                                            ▼
[ App Router Server Comps / Layouts ] ◄──(Direct Session)──► [ SQLite DB (Prisma Adapter) ]
      ▲                                                            │ (Users, Sessions, Accounts)
      │                                                            │
[ tRPC Context (`@/server/trpc`) ] ◄───────────────────────────────┘
```

---

## 3. Core Architectural Rules & Layer Separation

### 3.1 The Three Entry Points
As mandated in `docs/guides/architecture.md`, vertical slices maintain strict boundary enforcement:

| Layer / File | Responsibility | Permitted Imports | Prohibited Imports |
| :--- | :--- | :--- | :--- |
| `src/server/auth.ts` | Better Auth server configuration, Prisma adapter, OAuth & password providers, session utilities, tRPC access guards (`requireUser`, `requireOrgMember`). | `import "server-only"`, Prisma, `better-auth`, Node crypto | React, client hooks, browser APIs |
| `src/lib/auth-client.ts` | Isomorphic Better Auth React client (`createAuthClient`). | `better-auth/react` | Node modules, Prisma, server secrets |
| `src/app/api/auth/[...all]/route.ts` | Next.js API transport routing Better Auth HTTP endpoints. | `toNextJsHandler`, `@/server/auth` | Client components, UI logic |
| `src/features/identity/` | User management domain (profile update, role assignments, admin user listings). | Feature models, `@/server/auth`, `@/server/trpc` | Direct vendor coupling |

### 3.2 Elimination of Webhook Synchronization
With Clerk, user accounts are created asynchronously via webhook events (`user.created`, `session.created`). This introduces race conditions and requires a local tunnel (`localtunnel`) during development.

Better Auth executes transactional writes directly against the SQLite database via Prisma upon user signup or OAuth callback. Consequently:
- `src/app/api/webhooks/clerk/route.ts` is eliminated.
- `syncClerkUser` and `deleteClerkUser` in `src/features/identity/server/service.ts` are deprecated/removed.
- The user record is immediately available when the first request hits `/dashboard`.

---

## 4. Data Model & Prisma Schema

Better Auth requires four core models: `User`, `Session`, `Account`, and `Verification`. In our split schema setup (`prisma/schema/`), these will be defined in `prisma/schema/identity.prisma` (or `prisma/schema/auth.prisma`).

### 4.1 Schema Definition (`prisma/schema/identity.prisma`)

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

### 4.2 Updating Relations in `prisma/schema/organizations.prisma`
Update foreign keys from `Int` / `UserAccount` to `String` / `User`:
- `Organization.ownerId`: `String` referencing `User.id`
- `OrganizationMember.userId`: `String` referencing `User.id`

---

## 5. Server & Framework Integration

### 5.1 Better Auth Server Initialization (`src/server/auth.ts`)
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

### 5.2 tRPC Context & Session Ingestion (`src/server/trpc.ts`)
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

### 5.3 Access Control Helpers (`src/server/auth.ts`)
`AuthedContext` adapts to Better Auth session type:
```ts
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
```

---

## 6. Client Architecture & UI Components

### 6.1 Client Instance (`src/lib/auth-client.ts`)
```ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
});

export const { useSession, signIn, signUp, signOut } = authClient;
```

### 6.2 UI Components Replacement
1. **Sign-In & Sign-Up Pages (`src/app/sign-in/page.tsx`, `src/app/sign-up/page.tsx`)**:
   - Replaced Clerk `<SignIn />` and `<SignUp />` with clean, accessible Base UI forms.
   - Separate tabs or inputs for Email/Password and one-click Social OAuth buttons (GitHub, Google).
2. **NavUser Component (`src/components/layout/dashboard/sidebar/nav-user.tsx`)**:
   - Uses `authClient.useSession()` for avatar/name/email.
   - Triggers `authClient.signOut()` on logout with automatic client redirect.
3. **Root Layout (`src/app/layout.tsx`)**:
   - Remove `<ClerkProvider>`. No extra root provider is strictly required for Better Auth client hooks.

---

## 7. Security & Operational Considerations

1. **Password Hashing**: Better Auth employs `scrypt` hashing out of the box with zero external native C dependencies.
2. **Session Cookies**: HTTP-only, `SameSite=Lax` (or `Strict`), Secure in production.
3. **CORS & Dev Origins**: Reuses `ALLOWED_DEV_ORIGINS` for local testing.
4. **Environment Secrets**: Replaces `CLERK_SECRET_KEY` and `CLERK_WEBHOOK_SIGNING_SECRET` with `BETTER_AUTH_SECRET` (generated 32+ byte string) and `BETTER_AUTH_URL`.
