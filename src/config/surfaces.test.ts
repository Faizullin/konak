import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SURFACES, COLOUR_SCHEMES } from "./surfaces";

/**
 * The registry is data, and these are the two things the rendering code assumes
 * about it: that ids match their keys, and that a surface has at least one
 * palette. A surface with none would draw a theme control with nothing in it.
 */
describe("the surface registry", () => {
  test("every surface's id is its key, so `data-surface` and the registry agree", () => {
    for (const [key, surface] of Object.entries(SURFACES)) {
      assert.equal(surface.id, key);
    }
  });

  test("every surface declares at least one theme", () => {
    for (const surface of Object.values(SURFACES)) {
      assert.ok(surface.themes.length >= 1, `${surface.id} has no themes`);
    }
  });

  test("a surface's theme ids are unique", () => {
    for (const surface of Object.values(SURFACES)) {
      const ids = surface.themes.map((theme) => theme.id);
      assert.equal(new Set(ids).size, ids.length, `${surface.id} repeats a theme id`);
    }
  });

  test("system is first, because it is the default a person keeps", () => {
    assert.equal(COLOUR_SCHEMES[0], "system");
  });
});
