import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canDeleteOrganization,
  canManageMembers,
  createOrganizationSchema,
  OrgRole,
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
