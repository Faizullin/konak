import assert from "node:assert/strict";
import { test } from "node:test";

import { organizationNavItems } from "./nav-items";
import { ORG_MODULE_IDS, orgModule, OrgRole } from "@/features/organizations";

/**
 * The registry declares a module; this file draws it. The two agree by
 * convention only — an icon name with no entry in `ORG_ICONS` renders nothing
 * and breaks no build.
 */

test("every module's icon name maps to a component", () => {
  const items = organizationNavItems(
    "acme",
    OrgRole.OWNER,
    ORG_MODULE_IDS.map((moduleId) => ({ moduleId, enabled: true }))
  );
  const nav = items.find((group) => group.id === "organization")!;

  assert.equal(nav.items.length, ORG_MODULE_IDS.length);
  for (const item of nav.items) {
    assert.ok(item.icon, `${item.title} has no icon component`);
  }
});

test("a module's url is its segment under the organization", () => {
  const nav = organizationNavItems("acme", OrgRole.OWNER, [
    { moduleId: "FRONT_DESK", enabled: true },
  ]).find((group) => group.id === "organization")!;

  const frontDesk = nav.items.find((item) => item.title === orgModule("FRONT_DESK").label);
  assert.equal(frontDesk?.url, "/dashboard/orgs/acme/front-desk");
  // The overview's segment is empty, and an empty segment is the root rather
  // than a trailing slash.
  assert.ok(nav.items.some((item) => item.url === "/dashboard/orgs/acme"));
});

test("the front desk is off until an organization asks for it", () => {
  const nav = organizationNavItems("acme", OrgRole.OWNER, []).find(
    (group) => group.id === "organization"
  )!;
  assert.ok(!nav.items.some((item) => item.title === "Front desk"));
});
