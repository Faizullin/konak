import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canDeleteOrganization,
  canEditOrganization,
  canDeleteAttachments,
  canManageMembers,
  canUploadAttachments,
  createOrganizationSchema,
  ORG_ROLE_VALUES,
  OrgRole,
  orgCan,
  organizationSlugSchema,
  slugify,
} from "./organization";

/**
 * `model/` is the half both sides agree on, so it is the half worth testing:
 * these functions decide what the router permits *and* what the UI offers, and
 * a disagreement between them is a button that 403s.
 *
 * Pure input and pure output — no database, no auth, no React. `npm test`
 * runs them with `node:test` through tsx.
 */

test("only an owner can delete an organization", () => {
  assert.equal(canDeleteOrganization(OrgRole.OWNER), true);
  assert.equal(canDeleteOrganization(OrgRole.ADMIN), false);
  assert.equal(canDeleteOrganization(OrgRole.MEMBER), false);
});

test("owners and admins manage members; members do not", () => {
  assert.equal(canManageMembers(OrgRole.OWNER), true);
  assert.equal(canManageMembers(OrgRole.ADMIN), true);
  assert.equal(canManageMembers(OrgRole.MEMBER), false);
});

test("a member attaches a file but cannot delete one", () => {
  // The split that matters: a receptionist scans a passport at check-in, and
  // deleting it takes the bytes with it and cannot be undone.
  assert.equal(canUploadAttachments(OrgRole.MEMBER), true);
  assert.equal(canDeleteAttachments(OrgRole.MEMBER), false);

  for (const role of [OrgRole.OWNER, OrgRole.ADMIN]) {
    assert.equal(canUploadAttachments(role), true, role);
    assert.equal(canDeleteAttachments(role), true, role);
  }
});

test("owners and admins edit the organization; members do not", () => {
  assert.equal(canEditOrganization(OrgRole.OWNER), true);
  assert.equal(canEditOrganization(OrgRole.ADMIN), true);
  assert.equal(canEditOrganization(OrgRole.MEMBER), false);
});

/**
 * The predicates above are the vocabulary; `orgStatements` and the grants are
 * the rule set. These test the rule set directly, because that is the half a
 * new domain extends, and the properties it leans on are not visible from
 * reading the grants alone.
 */

test("a resource a role was never granted is denied, not passed through", () => {
  // MEMBER has no `organization` entry at all. An unlisted resource has to fail
  // closed — otherwise adding one to `orgStatements` would silently permit
  // every role until someone remembered to write the grants down.
  assert.equal(orgCan(OrgRole.MEMBER, { organization: ["update"] }), false);
  assert.equal(orgCan(OrgRole.MEMBER, { member: ["list"] }), true);
});

test("verbs are AND-ed, so holding one of two is not enough", () => {
  // ADMIN may update the organization but not delete it. Asking for both at
  // once must fail, or a caller could smuggle the second verb past the check.
  assert.equal(orgCan(OrgRole.ADMIN, { organization: ["update"] }), true);
  assert.equal(orgCan(OrgRole.ADMIN, { organization: ["update", "delete"] }), false);
  assert.equal(orgCan(OrgRole.OWNER, { organization: ["update", "delete"] }), true);
});

test("every role has an entry in the grant table", () => {
  // The table is indexed by role, so a role added to `OrgRole` without a grant
  // would throw at the call site rather than deny. Catch it here instead.
  for (const role of ORG_ROLE_VALUES) {
    assert.equal(typeof orgCan(role, { member: ["list"] }), "boolean", `${role} has no grants`);
  }
});

test("slugify produces something the slug schema accepts", () => {
  for (const name of ["Acme Corp", "  Hello   World  ", "Ünïcôde & Symbols!!", "a".repeat(80)]) {
    const slug = slugify(name);
    assert.equal(
      organizationSlugSchema.safeParse(slug).success,
      true,
      `slugify(${JSON.stringify(name)}) produced ${JSON.stringify(slug)}, which the schema rejects`
    );
  }
});

test("slugify does not leave leading or trailing hyphens", () => {
  assert.equal(slugify("!!! Leading and trailing !!!"), "leading-and-trailing");
});

test("the create schema rejects a slug the UI would never produce", () => {
  const parsed = createOrganizationSchema.safeParse({
    name: "Acme",
    slug: "Not A Slug",
  });
  assert.equal(parsed.success, false);
});

test("a name is required", () => {
  assert.equal(createOrganizationSchema.safeParse({ name: "", slug: "acme" }).success, false);
});

test("a name with nothing slug-able produces an empty slug, which the schema rejects", () => {
  // Not a bug: the create form prefills from `slugify` and the field stays
  // editable, so the schema refusing "" is what makes the user type one. The
  // test pins the behaviour so a future `slugify` cannot start inventing a
  // slug the user never chose.
  assert.equal(slugify("!!!"), "");
  assert.equal(organizationSlugSchema.safeParse("").success, false);
});
