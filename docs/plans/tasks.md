# Implementation Tasks: Clerk to Better Auth Migration

## Implementation Phases Overview

- [ ] **Phase 1: Dependencies & Environment Configuration**
- [ ] **Phase 2: Database Schema & Migration**
- [ ] **Phase 3: Core Authentication Engine & API Route Handler**
- [ ] **Phase 4: Framework & tRPC Integration**
- [ ] **Phase 5: Feature Slices & Domain Refactoring (`identity` & `organizations`)**
- [ ] **Phase 6: UI Layer & Auth Pages Migration**
- [ ] **Phase 7: End-to-End Verification & Cleanup**

---

## Phase 1: Dependencies & Environment Configuration

- [ ] **Task 1.1: Install Better Auth dependencies and remove Clerk packages**
  - **Target files**: `package.json`
  - **Action**: Run `npm install better-auth` and `npm uninstall @clerk/nextjs`.
  - **Verification**: Check `package.json` and `package-lock.json` are consistent.

- [ ] **Task 1.2: Update environment variable schemas and examples**
  - **Target files**: `src/env.mjs`, `.env.example`, `.env`
  - **Action**:
    - Remove Clerk environment variables (`CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`, `NEXT_PUBLIC_CLERK_*`).
    - Add Better Auth variables: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (or `NEXT_PUBLIC_APP_URL`), `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
  - **Verification**: `src/env.mjs` compiles without errors against `.env`.

---

## Phase 2: Database Schema & Migration

- [ ] **Task 2.1: Update Prisma schema for Better Auth models**
  - **Target files**: `prisma/schema/identity.prisma`, `prisma/schema/organizations.prisma`
  - **Action**:
    - Define models `User`, `Session`, `Account`, `Verification` in `prisma/schema/identity.prisma`.
    - Update `Organization.ownerId` and `OrganizationMember.userId` in `prisma/schema/organizations.prisma` to reference `User.id` (`String`).
  - **Verification**: Run `npm run db:generate`.

- [ ] **Task 2.2: Apply database migration**
  - **Target files**: `prisma/migrations/`, `dev.db`
  - **Action**: Run `npm run db:migrate` (or `prisma migrate dev --name init_better_auth`).
  - **Verification**: Schema successfully migrated and SQLite database created with new tables (`users`, `sessions`, `accounts`, `verifications`).

---

## Phase 3: Core Authentication Engine & API Route Handler

- [ ] **Task 3.1: Create Better Auth server instance**
  - **Target files**: `src/server/auth.ts`
  - **Action**:
    - Configure `betterAuth` with `prismaAdapter`, `emailAndPassword`, `socialProviders` (GitHub, Google), and custom user role field.
    - Export `auth` instance.
  - **Verification**: Server instance loads properly in Node runtime.

- [ ] **Task 3.2: Create Better Auth API catch-all route handler**
  - **Target files**: `src/app/api/auth/[...all]/route.ts`
  - **Action**:
    - Implement `toNextJsHandler(auth.handler)` for `GET` and `POST`.
  - **Verification**: Endpoint `/api/auth/ok` or `/api/auth/get-session` returns valid JSON response.

- [ ] **Task 3.3: Create isomorphic Better Auth client**
  - **Target files**: `src/lib/auth-client.ts`
  - **Action**:
    - Instantiate `createAuthClient` from `better-auth/react`.
    - Export `authClient`, `useSession`, `signIn`, `signUp`, `signOut`.
  - **Verification**: Client builds cleanly in React client components.

- [ ] **Task 3.4: Remove Clerk webhook route**
  - **Target files**: `src/app/api/webhooks/clerk/route.ts`
  - **Action**: Delete `src/app/api/webhooks/clerk/route.ts`.
  - **Verification**: File removed, no broken imports.

---

## Phase 4: Framework & tRPC Integration

- [ ] **Task 4.1: Update tRPC context for Better Auth session**
  - **Target files**: `src/server/trpc.ts`
  - **Action**:
    - Read headers via `next/headers` and retrieve session using `auth.api.getSession({ headers })`.
    - Update `protectedProcedure` and `adminProcedure` to check `ctx.session.user`.
  - **Verification**: tRPC procedures infer user context accurately.

- [ ] **Task 4.2: Update access control helpers**
  - **Target files**: `src/server/auth.ts`
  - **Action**:
    - Update `AuthedContext`, `requireUser`, `requireOrgMember`, `requireOrgManager`, `requireOrgOwner` to operate on `User` entity and `String` user IDs.
  - **Verification**: Unit tests and type checks pass.

- [ ] **Task 4.3: Update Next.js middleware**
  - **Target files**: `src/middleware.ts`
  - **Action**:
    - Remove `clerkMiddleware`.
    - Implement clean cookie pass-through or Better Auth session validation if required, preserving resource-based access principles.
  - **Verification**: Static assets and public routes load without interception.

---

## Phase 5: Feature Slices & Domain Refactoring

- [ ] **Task 5.1: Refactor `identity` feature models and schemas**
  - **Target files**: `src/features/identity/model/user.ts`, `src/features/identity/model/index.ts`
  - **Action**:
    - Update user schemas to reflect `id: string`, `name: string`, `email: string`, `role: UserRole`, `image?: string`.
  - **Verification**: Zod schemas validate correctly.

- [ ] **Task 5.2: Refactor `identity` feature server router and service**
  - **Target files**: `src/features/identity/server/router.ts`, `src/features/identity/server/service.ts`
  - **Action**:
    - Update `userRouter.getCurrent`, `userRouter.updateProfile`, `userRouter.adminList`, `userRouter.updateRole` for `User` model.
    - Remove legacy `syncClerkUser` service calls.
  - **Verification**: `userRouter` queries compile and return typed data.

- [ ] **Task 5.3: Refactor `organizations` feature for string user IDs**
  - **Target files**: `src/features/organizations/server/service.ts`, `src/features/organizations/server/router.ts`, `src/features/organizations/model/organization.ts`
  - **Action**:
    - Ensure `userId` and `ownerId` types accommodate string IDs across organization procedures.
  - **Verification**: `npm run test` passes organization tests.

---

## Phase 6: UI Layer & Auth Pages Migration

- [ ] **Task 6.1: Update Root Layout**
  - **Target files**: `src/app/layout.tsx`
  - **Action**: Remove `<ClerkProvider>` wrapper.
  - **Verification**: Next.js tree renders cleanly without context provider errors.

- [ ] **Task 6.2: Implement native Sign-In and Sign-Up pages**
  - **Target files**: `src/app/sign-in/page.tsx`, `src/app/sign-up/page.tsx`
  - **Action**:
    - Build accessible email/password and social login forms using Base UI / Tailwind CSS components.
    - Connect forms to `authClient.signIn.email`, `authClient.signUp.email`, and `authClient.signIn.social({ provider: "github" | "google" })`.
  - **Verification**: Sign-in and sign-up pages render with interactive form state and toast feedback.

- [ ] **Task 6.3: Update Dashboard layout and Home page**
  - **Target files**: `src/app/dashboard/layout.tsx`, `src/app/page.tsx`
  - **Action**:
    - Replace `auth()` from Clerk with `auth.api.getSession({ headers: await headers() })`.
    - Redirect unauthenticated requests to `/sign-in`.
  - **Verification**: Protected routes properly redirect unauthenticated visitors.

- [ ] **Task 6.4: Update Sidebar user navigation component**
  - **Target files**: `src/components/layout/dashboard/sidebar/nav-user.tsx`
  - **Action**:
    - Use `authClient.useSession()` and `authClient.signOut()`.
  - **Verification**: User avatar, display name, email, and sign-out button work seamlessly.

---

## Phase 7: End-to-End Verification & Cleanup

- [ ] **Task 7.1: Run project-wide type checking**
  - **Action**: Run `npx tsc --noEmit`.
  - **Verification**: 0 TypeScript errors.

- [ ] **Task 7.2: Run linter and formatting**
  - **Action**: Run `npm run lint` and `npm run format:check`.
  - **Verification**: Clean lint output.

- [ ] **Task 7.3: Run unit and integration tests**
  - **Action**: Run `npm run test`.
  - **Verification**: All test suites pass.

- [ ] **Task 7.4: Update documentation and guide files**
  - **Target files**: `README.md`, `docs/guides/architecture.md`, `docs/guides/local-development.md`
  - **Action**: Update guides to reflect Better Auth workflows, removing localtunnel and Clerk mentions.
  - **Verification**: Documentation reflects current setup accurately.
