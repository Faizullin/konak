# Quality Assurance & Verification Plan: Better Auth Migration

## 1. Scope & Objective

This document defines the verification strategy, test scenarios, automated test suites, and acceptance criteria for verifying the migration from Clerk to Better Auth in **Konak**.

---

## 2. Automated Test Suite & Verification Commands

| Command | Purpose | Expected Result |
| :--- | :--- | :--- |
| `npx tsc --noEmit` | Type safety check across server, client, and isomorphic models | 0 type errors |
| `npm run lint` | ESLint rules enforcement | 0 warnings / errors |
| `npm run format:check` | Prettier code style validation | All files formatted |
| `npm run test` | Node test runner executing feature unit tests (`src/**/*.test.ts`) | All unit tests pass |
| `npm run build` | Next.js production build verification (`next build`) | Build completes successfully |

---

## 3. Test Cases Matrix

### 3.1 Authentication & Registration Flows

#### TC-AUTH-01: Email & Password Registration
- **Preconditions**: SQLite database running with Better Auth schema.
- **Steps**:
  1. Navigate to `/sign-up`.
  2. Enter Name (`Test User`), Email (`test@example.com`), and Password (`SecurePass123!`).
  3. Submit the registration form.
- **Expected Outcome**:
  - A new record is created in the `users` table with `role = "USER"`.
  - A new hashed password credential record is created in the `accounts` table.
  - A session is created in the `sessions` table.
  - Browser receives session cookie (`better-auth.session_token`).
  - User is redirected to `/dashboard`.

#### TC-AUTH-02: Email & Password Login
- **Preconditions**: Registered user from TC-AUTH-01 exists.
- **Steps**:
  1. Navigate to `/sign-in`.
  2. Enter valid email and password.
  3. Submit the form.
- **Expected Outcome**:
  - Authentication succeeds.
  - User is redirected to `/dashboard`.

#### TC-AUTH-03: Invalid Password Rejection
- **Preconditions**: Registered user exists.
- **Steps**:
  1. Navigate to `/sign-in`.
  2. Enter registered email and invalid password.
  3. Submit the form.
- **Expected Outcome**:
  - Authentication fails with an error message.
  - No session cookie is issued.
  - User remains on `/sign-in`.

#### TC-AUTH-04: Social OAuth Login (GitHub / Google)
- **Preconditions**: OAuth client ID and client secret configured in `.env`.
- **Steps**:
  1. Navigate to `/sign-in`.
  2. Click "Continue with GitHub" or "Continue with Google".
  3. Authorize via provider.
- **Expected Outcome**:
  - User is redirected back to the app via `/api/auth/callback/[provider]`.
  - User record is created or linked in `users` and `accounts`.
  - Session is established and user lands on `/dashboard`.

---

### 3.2 Session Lifecycle & Access Control

#### TC-SESS-01: Protected Layout Guard (`/dashboard`)
- **Preconditions**: Browser in unauthenticated / incognito state.
- **Steps**:
  1. Direct navigation to `http://localhost:3000/dashboard`.
- **Expected Outcome**:
  - Server layout checks `auth.api.getSession({ headers })`.
  - Server redirects visitor to `/sign-in`.

#### TC-SESS-02: tRPC `protectedProcedure` Protection
- **Preconditions**: No session cookie in request.
- **Steps**:
  1. Send a request to `trpc.user.getCurrent` or `trpc.organization.listMine`.
- **Expected Outcome**:
  - tRPC throws `TRPCError` with code `UNAUTHORIZED` (HTTP 401).

#### TC-SESS-03: Admin Procedure Guard (`adminProcedure`)
- **Preconditions**: Authenticated user with `role = "USER"`.
- **Steps**:
  1. Attempt to invoke `trpc.user.adminList` or `trpc.user.updateRole`.
- **Expected Outcome**:
  - tRPC middleware throws `TRPCError` with code `FORBIDDEN` (HTTP 403).

#### TC-SESS-04: User Sign Out
- **Preconditions**: Authenticated user on `/dashboard`.
- **Steps**:
  1. Open sidebar user menu via `NavUser`.
  2. Click "Sign out".
- **Expected Outcome**:
  - `authClient.signOut()` triggers session deletion.
  - Session cookie is cleared.
  - User is redirected to `/`.
  - Subsequent access to `/dashboard` redirects to `/sign-in`.

---

### 3.3 Multi-Tenant Organization Integration

#### TC-ORG-01: Organization Creation by Authenticated User
- **Preconditions**: Authenticated user (`user.id` string).
- **Steps**:
  1. Call `trpc.organization.create` with `{ name: "Acme Corp", slug: "acme-corp" }`.
- **Expected Outcome**:
  - Organization record created with `ownerId = user.id`.
  - Membership created with `userId = user.id` and `role = "OWNER"`.

#### TC-ORG-02: Organization Role Hierarchy Enforcement
- **Preconditions**: Two users (`User A = OWNER`, `User B = MEMBER`) in Organization `1`.
- **Steps**:
  1. `User B` calls `trpc.organization.delete({ id: 1 })` (requires `requireOrgOwner`).
- **Expected Outcome**:
  - Request rejected with `TRPCError` code `FORBIDDEN`.

---

## 4. Acceptance Criteria Checklist

- [ ] Zero runtime or compile-time dependencies on `@clerk/nextjs`.
- [ ] Better Auth models (`users`, `sessions`, `accounts`, `verifications`) managed via Prisma.
- [ ] Native email/password authentication functional with validation and feedback.
- [ ] OAuth integration configured for GitHub and Google.
- [ ] Server layout, page routes, and tRPC context cleanly resolve sessions from headers.
- [ ] All unit tests in `src/**/*.test.ts` pass without errors.
- [ ] Project builds cleanly via `next build`.
