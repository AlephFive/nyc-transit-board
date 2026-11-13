/**
 * The board settings shared by every caller.
 *
 * `jsonSettings.test.ts` covers parsing a polling body. What is left here is
 * the part that does not depend on how a board arrives: the transit type
 * aliases the form's stored values use, and the destination scale's bounds.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  clampDestinationScale,
  parseTransitType,
} from "../src/settings.ts";

describe("transit type aliases", () => {
  // The form shows friendly names; stored settings must not depend on the
  // internal spelling of the union.
  const cases: [string, string][] = [
    ["subway", "subway"],
    ["lirr", "railroad-lirr"],
    ["railroad-lirr", "railroad-lirr"],
    ["mtn", "railroad-mtn"],
    ["metro-north", "railroad-mtn"],
    ["Metro-North", "railroad-mtn"],
    ["BUS", "bus"],
  ];

  for (const [input, expected] of cases) {
    test(`"${input}" maps to ${expected}`, () => {
      assert.equal(parseTransitType(input), expected);
    });
  }

  test("a type nothing recognises is not a card", () => {
    assert.equal(parseTransitType("tram"), undefined);
    assert.equal(parseTransitType(""), undefined);
  });
});

describe("destination text size", () => {
  test("the offered sizes pass through", () => {
    for (const size of [0.8, 0.9, 1, 1.1, 1.2]) {
      assert.equal(clampDestinationScale(size), size);
    }
  });

  test("anything outside the range is clamped, not refused", () => {
    // A board must render whatever arrives. Below 0.7 the 1-bit panel
    // cannot resolve the glyphs; above 1.3 a destination crowds out the
    // clock it sits beside. Neither is a reason to blank the panel.
    assert.equal(clampDestinationScale(5), 1.3);
    assert.equal(clampDestinationScale(0.1), 0.7);
    assert.equal(clampDestinationScale(-2), 0.7);
  });
});
