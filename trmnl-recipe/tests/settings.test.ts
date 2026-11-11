/**
 * The board settings shared by every caller, and the demo board.
 *
 * `jsonSettings.test.ts` covers parsing a polling body. What is left here is
 * the part that does not depend on how a board arrives: the transit type
 * aliases the form's stored values use, the destination scale's bounds, and
 * `DEMO_CARDS` — the board shown to anyone who has configured nothing.
 *
 * The demo board is public. The recipe's directory listing renders a preview
 * from it, so it is the first thing a prospective installer sees, and these
 * tests pin what it must demonstrate.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_CARDS,
  clampDestinationScale,
  parseTransitType,
} from "../src/settings.ts";
import { boardFromJson } from "../src/jsonSettings.ts";

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

describe("the demo board", () => {
  /** The board a request carrying no cards produces. */
  const demo = () => boardFromJson({});

  test("stands in when nothing is configured", () => {
    const board = demo();
    assert.equal(board.isDemo, true);
    assert.equal(
      board.cards.length,
      6,
      "a full board, so the preview is not half empty"
    );
  });

  test("covers every feed family the plugin can reach", () => {
    // Every upstream, each decoded differently: the subway and railroad
    // protobuf dialects, NYC Ferry's own GTFS-RT, and the bus SIRI API,
    // which is JSON and the only one needing a key. A broken one should
    // show up in the directory listing rather than after a user configures
    // it — which is the whole reason the demo is a full board.
    const types = new Set(DEMO_CARDS.map((card) => card.transitType));
    assert.deepEqual(
      [...types].sort(),
      ["bus", "ferry", "railroad-lirr", "railroad-mtn", "subway"]
    );
  });

  test("fills the grid", () => {
    // Every slot occupied, so the preview shows the layout at full density
    // rather than three cards and three gaps.
    const slots = DEMO_CARDS.map((card) => card.slot).sort((a, b) => a - b);
    assert.deepEqual(slots, [1, 2, 3, 4, 5, 6]);
  });

  test("shows a bus corner as both directions", () => {
    // A bus stop ID is one side of the street, so a corner needs two. It is
    // the most-missed thing about bus cards, and the demo shows it.
    const bus = DEMO_CARDS.find((card) => card.transitType === "bus");
    assert.ok(bus, "no bus card on the demo board");
    assert.equal(bus.stopIds.length, 2, "a corner needs both direction IDs");
  });

  test("the two railroads are shown at comparable stations", () => {
    // Both cards render identically — a branch badge, a destination, a time
    // — so the pair only teaches something if the stations are comparable.
    //
    // At a terminal most trains run to their branch's namesake, so badge and
    // destination repeat ("Ronkonkoma | Ronkonkoma") and the card reads as
    // one word printed twice. Jamaica is the hub nearly every LIRR train
    // passes through — 10 branches, 13 destinations, trains in both
    // directions — which is the shape Grand Central has.
    const rail = DEMO_CARDS.filter((card) =>
      card.transitType.startsWith("railroad-")
    );
    assert.equal(rail.length, 2, "one card per railroad");
    assert.deepEqual(
      rail.map((card) => card.transitType).sort(),
      ["railroad-lirr", "railroad-mtn"]
    );

    const lirr = rail.find((card) => card.transitType === "railroad-lirr");
    assert.equal(lirr?.stopIds[0], "102", "the LIRR card should be Jamaica");
  });

  test("demonstrates the line filter", () => {
    // Times Square carries twelve routes on one card, and narrowing it is
    // the non-obvious thing a new installer most needs to discover. The
    // demo shows the full complex and a filtered view of it side by side.
    const filtered = DEMO_CARDS.filter((card) => card.routes?.length);
    assert.ok(filtered.length > 0, "no card demonstrates the filter");
    assert.deepEqual(filtered[0].routes, ["N", "Q", "R", "W"]);
  });

  test("uses stations nobody lives at", () => {
    // The public recipe page renders a preview from the author's own
    // instance, so the demo must not be the author's commute.
    const names = DEMO_CARDS.map((card) => card.title);
    assert.deepEqual(names, [
      "Times Sq-42 St",
      "Custom name",
      "Jamaica",
      "W 42 St/5 Av",
      "Grand Central",
      "Wall St/Pier 11",
    ]);
  });

  test("one configured card is enough to suppress it", () => {
    const board = boardFromJson({
      cards: [{ station: { type: "subway", ids: ["721"] }, walk: 10 }],
    });
    assert.equal(board.isDemo, false);
    assert.equal(board.cards.length, 1);
  });
});
