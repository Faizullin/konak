import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ATTRIBUTE_THEMED, COLOUR_SCHEMES, DEFAULT_THEME, SURFACES, toTheme } from "./surfaces";

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

  test("every surface's first theme is the default, which is what a cookie falls back to", () => {
    for (const surface of Object.values(SURFACES)) {
      assert.equal(surface.themes[0]?.id, DEFAULT_THEME, `${surface.id} does not start at default`);
    }
  });

  test("a base whose themes cannot be switched by an attribute is not offered as a choice", () => {
    // The control draws the theme row only for these. A base added here without
    // a mechanism behind it is a button that lies.
    for (const surface of Object.values(SURFACES)) {
      if (surface.themes.length > 1) {
        assert.ok(
          ATTRIBUTE_THEMED.includes(surface.base),
          `${surface.id} offers ${surface.themes.length} themes on a base that cannot switch them`
        );
      }
    }
  });
});

describe("a theme read back from a cookie", () => {
  test("an id the surface has survives; anything else is the default", () => {
    assert.equal(toTheme("desk", "contrast"), "contrast");

    // A cookie is whatever the last version of this app wrote there.
    assert.equal(toTheme("desk", "slate"), DEFAULT_THEME);
    assert.equal(toTheme("desk", undefined), DEFAULT_THEME);
    assert.equal(toTheme("desk", ""), DEFAULT_THEME);

    // One surface's theme is not another's.
    assert.equal(toTheme("basic", "contrast"), DEFAULT_THEME);
  });
});
