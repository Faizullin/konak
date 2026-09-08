import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isOrgModuleEnabled,
  ORG_MODULE_IDS,
  orgModule,
  orgModuleForSegment,
  visibleOrgModules,
} from "./registry";
import { OrgRole } from "./organization";

/**
 * A module declares itself once; the nav, the route guard and the procedure all
 * read that declaration. These pin what "declared" means.
 */

test("core modules have no off switch", () => {
  // An organization without its own settings screen is not a product decision,
  // it is a broken install. A stray row must not be able to cause one.
  const off = [{ moduleId: "SETTINGS", enabled: false }];
  assert.equal(isOrgModuleEnabled("SETTINGS", off), true);
  assert.equal(isOrgModuleEnabled("OVERVIEW", off), true);
  assert.equal(isOrgModuleEnabled("MEMBERS", []), true);
});

test("a non-core module follows its default until a row says otherwise", () => {
  assert.equal(isOrgModuleEnabled("DIRECTORY", []), false);
  assert.equal(isOrgModuleEnabled("DIRECTORY", [{ moduleId: "DIRECTORY", enabled: true }]), true);
  assert.equal(isOrgModuleEnabled("DIRECTORY", [{ moduleId: "DIRECTORY", enabled: false }]), false);
});

test("a row for another module changes nothing", () => {
  // Rows exist to disagree with a default, so an unrelated one is not an
  // instruction about this module.
  assert.equal(isOrgModuleEnabled("DIRECTORY", [{ moduleId: "MEMBERS", enabled: false }]), false);
});

test("enabled and visible are separate questions", () => {
  // Settings is core, so always enabled — and still hidden from a member.
  assert.ok(visibleOrgModules(OrgRole.OWNER, []).includes("SETTINGS"));
  assert.ok(!visibleOrgModules(OrgRole.MEMBER, []).includes("SETTINGS"));
  assert.ok(visibleOrgModules(OrgRole.MEMBER, []).includes("OVERVIEW"));
});

test("an unknown role sees only what needs no role", () => {
  // The sidebar renders before the role arrives; it must not flash a module
  // the person may not have.
  const visible = visibleOrgModules("", []);
  assert.ok(!visible.includes("SETTINGS"));
  assert.ok(visible.includes("OVERVIEW"));
});

test("a disabled module is invisible whatever the role", () => {
  assert.ok(!visibleOrgModules(OrgRole.OWNER, []).includes("DIRECTORY"));
  assert.ok(
    visibleOrgModules(OrgRole.OWNER, [{ moduleId: "DIRECTORY", enabled: true }]).includes(
      "DIRECTORY"
    )
  );
});

test("segments resolve back to a module, and rubbish does not throw", () => {
  // Segments arrive from a URL.
  assert.equal(orgModuleForSegment("members"), "MEMBERS");
  assert.equal(orgModuleForSegment(""), "OVERVIEW");
  assert.equal(orgModuleForSegment("../etc/passwd"), null);
  assert.equal(orgModuleForSegment("directory"), "DIRECTORY");
});

test("every module declares a label, an icon and a unique segment", () => {
  const segments = ORG_MODULE_IDS.map((id) => orgModule(id).segment);
  assert.equal(new Set(segments).size, segments.length, "two modules share a segment");
  for (const id of ORG_MODULE_IDS) {
    const definition = orgModule(id);
    assert.ok(definition.label, `${id} has no label`);
    assert.ok(definition.icon, `${id} has no icon`);
  }
});
