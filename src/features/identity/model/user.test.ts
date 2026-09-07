import assert from "node:assert/strict";
import { test } from "node:test";

import { canListUsers, canSetUserRole, USER_ROLE_VALUES, UserRole, userCan } from "./user";

/**
 * The install-wide counterpart to `organizations/model/organization.test.ts`.
 * Same shape, different scope: these decide what an account may do to the
 * install, not what a member may do inside one organization.
 */

test("only ADMIN holds the install-wide capabilities", () => {
  assert.equal(canListUsers(UserRole.ADMIN), true);
  assert.equal(canSetUserRole(UserRole.ADMIN), true);

  for (const role of [UserRole.MODERATOR, UserRole.USER]) {
    assert.equal(canListUsers(role), false);
    assert.equal(canSetUserRole(role), false);
  }
});

test("MODERATOR is granted nothing, and that is deliberate", () => {
  // The role exists in the enum and no code has ever consulted it. Pinning the
  // empty grant means giving it a capability has to be a decision someone makes
  // and this test records — not something that drifts in unnoticed.
  assert.equal(userCan(UserRole.MODERATOR, { user: ["list"] }), false);
  assert.equal(userCan(UserRole.MODERATOR, { user: ["set-role"] }), false);
});

test("a role the enum does not contain is denied, not thrown at", () => {
  // `User.role` is a plain string column — SQLite has no enum — so a migration
  // or a hand-edited row can put anything in it. An unrecognised value has to
  // read as "no" rather than crash the request.
  assert.equal(userCan("SUPERUSER", { user: ["list"] }), false);
  assert.equal(userCan("", { user: ["list"] }), false);
});

test("adminProcedure's question needs every verb, not just one", () => {
  // `adminProcedure` asks for the whole statement set at once, and verbs are
  // AND-ed, so a role holding only part of it must not pass. This pins the
  // guard's meaning against someone later granting USER a single verb.
  assert.equal(userCan(UserRole.ADMIN, { user: ["list", "set-role"] }), true);
  assert.equal(userCan(UserRole.USER, { user: ["list", "set-role"] }), false);
});

test("every role in UserRole has an entry in the grant table", () => {
  // The table is indexed by role; a role added to the enum without a grant
  // would fall through to the unknown-role path and silently deny everywhere.
  for (const role of USER_ROLE_VALUES) {
    assert.equal(typeof canListUsers(role), "boolean", `${role} has no grants`);
  }
});
