/**
 * The four Liquid layouts, which must agree with each other and with the code.
 *
 * TRMNL's Liquid has no partials — `{% render %}` and `{% include %}` both
 * fail with "Template not found", and they fail *silently at render time*
 * rather than breaking the build. So the display rules cannot be extracted
 * at render time: every layout must reproduce them in markup, and the copies
 * drift.
 *
 * What the platform forces is the *duplication*, not the hand-maintenance of
 * it. The shared CSS is assembled before the files are pushed, by
 * `scripts/buildLayouts.mjs` — see the last suite in this file. The rules
 * written in markup are still four copies, and the tests below are what
 * holds those together.
 *
 * Two failure modes, both of which have already shipped here:
 *
 * - **A rule changes in one layout.** Three of the four once printed the raw
 *   feed route id in card headings, so a `6X` headed its card "6X" and a
 *   shuttle headed its card "GS". Only `full.liquid` had the logic.
 * - **A class that does not exist.** `trmnlp lint` validates `label--*` sizes
 *   and nothing else, so an invented class renders as unstyled markup that
 *   usually looks close enough to right. `flex--1` shipped 13 times; this
 *   suite was written after finding `items--center`, `b--black` and `bw--1`
 *   live across all four layouts.
 *
 * Neither is a type error and neither fails lint. The board renders, and only a
 * reader comparing files notices — which is what these tests do instead.
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  subwayRouteGlyph,
} from "../../EInk-NYC-Home-Dashboard/src/utils/subway/routeLabel.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LAYOUTS = [
  "full",
  "half_horizontal",
  "half_vertical",
  "quadrant",
] as const;

const source = (name: string): string =>
  readFileSync(resolve(root, `plugin/src/${name}.liquid`), "utf8");

const layouts = new Map(LAYOUTS.map((name) => [name, source(name)]));

/** Markup with our own `<style>` block removed, so only framework classes remain. */
const markupOf = (liquid: string): string =>
  liquid.replace(/<style>[\s\S]*?<\/style>/g, "");

/**
 * Every class name a layout applies.
 *
 * Liquid is stripped **before** attributes are found, not after. A class
 * attribute can hold a tag containing quotes — `{% if bullet_class == "" %}`
 * — and those quotes close the `class="…"` match early, leaving a fragment
 * whose tail reads as a class called `if`. Removing the tags first makes the
 * attribute well-formed before it is parsed.
 */
function classesUsed(liquid: string): Set<string> {
  const withoutLiquid = markupOf(liquid)
    .replace(/\{%[\s\S]*?%\}/g, " ")
    .replace(/\{\{[\s\S]*?\}\}/g, " ");

  const found = new Set<string>();
  for (const [, attr] of withoutLiquid.matchAll(/class="([^"]*)"/g)) {
    for (const name of attr.split(/\s+/)) {
      // A class interpolated from Liquid — `grid--cols-{{ used_columns }}` —
      // leaves a stem like "grid--cols-" once the tag is gone. It is a real
      // class at render time but not a literal one here, so a name ending
      // in a hyphen is skipped rather than reported as invented.
      //
      // Everything else must be checked. The framework's own names carry
      // double hyphens and colons (`label--filled`, `md:title--base`), so
      // the pattern has to admit them — an earlier version did not, and
      // silently skipped every class worth checking.
      if (name && !name.endsWith("-")) found.add(name);
    }
  }
  return found;
}

describe("the display rule is identical in every layout", () => {
  // Not a string comparison of the markup: full.liquid carries responsive
  // variants (`md:label--base`) the smaller layouts do not, and the heading
  // path writes markup inline where the row path assigns a class. What has to
  // match is the *rule*, so these assert its moving parts.

  test("every layout strips the express X the same way", () => {
    for (const [name, liquid] of layouts) {
      // The whole id must be one character plus X — the same bound
      // EXPRESS_ROUTE applies in TypeScript. A looser `endsWith("X")` would
      // eventually eat a route whose name merely ends in X.
      assert.ok(
        liquid.includes('remove_last: "X"'),
        `${name} does not strip the express suffix`
      );
      assert.ok(
        liquid.includes("{% if stripped.size == 1 %}"),
        `${name} does not bound the express rule to a single character`
      );
    }
  });

  test("every layout draws a bullet at one or two characters", () => {
    // Two is SI, the Staten Island Railway. Three or more is a bus route or a
    // railroad branch and must stay a pill — "Babylon" in a circle is
    // unreadable, and a "Q101" clipped to "Q10" is a different route.
    for (const [name, liquid] of layouts) {
      assert.ok(
        liquid.includes("glyph.size <= 2"),
        `${name} does not use the two-character bullet bound`
      );
      assert.ok(
        !liquid.includes("{% if glyph.size == 1 %}"),
        `${name} still has a one-character-only bullet test`
      );
    }
  });

  test("every layout gives a two-character bullet its own type treatment", () => {
    // At the single-character size the two letters touch the curve.
    for (const [name, liquid] of layouts) {
      assert.ok(
        liquid.includes("bullet--pair"),
        `${name} does not size SI to fit the circle`
      );
      assert.ok(
        liquid.includes(".bullet--pair > span"),
        `${name} uses bullet--pair without defining it`
      );
    }
  });

  test("every layout defines the shapes it applies", () => {
    // These three are ours, not the framework's, so each layout carries its
    // own copy of the CSS. A layout applying a shape it never defined renders
    // a plain pill and looks merely a bit wrong.
    for (const [name, liquid] of layouts) {
      for (const shape of [".bullet", ".bullet--express"]) {
        assert.ok(
          liquid.includes(`${shape} {`),
          `${name} does not define ${shape}`
        );
      }
    }
  });

  test("only subway cards draw bullets", () => {
    // The shape *means* "a subway line", so it has to be scoped by card
    // type rather than by glyph length. Ferry routes are two characters —
    // AS, ER, SG — and were drawn as subway bullets on the demo board;
    // bus routes escaped only by being four characters long.
    for (const [name, liquid] of layouts) {
      const shapeTests = [
        ...liquid.matchAll(/\{%\s*if\s+([^%]*?)glyph\.size\s*<=\s*2\s*%\}/g),
      ];
      assert.ok(shapeTests.length > 0, `${name} has no bullet shape test`);

      for (const [, prefix] of shapeTests) {
        assert.match(
          prefix,
          /card\.y\s*==\s*"subway"\s+and\s*$/,
          `${name} draws a bullet without checking the card is subway`
        );
      }
    }
  });

  test("every row is one line, in every layout", () => {
    // It was two in `full` for split subway columns, on the measurement
    // that ~123px could not carry badge, destination and time together —
    // true at a 1.7em bullet, not at 1.35em. Now uniform: a row is a row
    // whatever card it is in, which is what lets a reader scan across
    // columns.
    for (const [name, markup] of layouts) {
      assert.ok(
        markup.includes("row-line"),
        `${name}.liquid does not use the one-line row`
      );
      assert.ok(
        !markup.includes("one_line"),
        `${name}.liquid still branches on a two-line layout`
      );
    }
  });

  test("every clock on the board is the same size", () => {
    // A split subway column is half the width of a full card's row, and
    // the clock was shrunk there twice to buy the destination back — 0.75em,
    // then 0.92em. Both read as a mistake beside the full-size clocks next
    // to them, and a panel seen from across a room has exactly one element
    // that must never shrink.
    //
    // The destination gives way instead: a clipped station name survives
    // being clipped, where a smaller clock is just harder to read.
    // The clock has one size of its own (15px, a hair under the row, to
    // give the destination back some width). What must not exist is a
    // *second* size applied to some rows and not others.
    for (const [name, markup] of layouts) {
      assert.ok(
        !markup.includes("row-line--split"),
        `${name}.liquid still has a narrower row variant`
      );
      const sizes = [
        ...markup.matchAll(/\.row-time[^{]*\{[^}]*?font-size:\s*([^;]+)/gs),
      ].map((m) => m[1].trim());
      assert.ok(
        new Set(sizes).size <= 1,
        `${name}.liquid gives the clock more than one size: ${sizes.join(", ")}`
      );
    }
  });

  test("the footer names the board and dates itself", () => {
    for (const [name, markup] of layouts) {
      // Two words, not four bullets: the bullets read as a fifth row of
      // badges, and the networks spelled out collided with the stamp.
      assert.ok(
        markup.includes(">NYC Transit<"),
        `${name}.liquid does not name the board`
      );
      assert.ok(
        !markup.includes("footer-marks"),
        `${name}.liquid still carries the network marks`
      );
      assert.ok(
        markup.includes("Last updated: {{ a }}"),
        `${name}.liquid does not date the board`
      );
      assert.ok(
        markup.includes("footer-stamp"),
        `${name}.liquid does not right-align the timestamp`
      );
    }
  });

  test("becoming urgent changes a row's colour and nothing else", () => {
    // The highlight once carried a negative margin so it could reach the
    // card edge without narrowing the row. Two bugs came of it: a negative
    // margin pulls the row outside its parent, which clips, so the left
    // edge of every highlight was shaved off — and only urgent rows moved,
    // so a highlight visibly shifted its own row against its neighbours.
    //
    // Every row carries the inset now, so the urgent rule may set colour
    // and nothing that affects layout.
    for (const [name, markup] of layouts) {
      const rule = /\.row-line--urgent\s*\{([^}]*)\}/s.exec(markup);
      assert.ok(rule, `${name}.liquid has no urgent row rule`);
      assert.doesNotMatch(
        rule![1],
        /margin|padding|width|font-size/,
        `${name}.liquid lets the highlight change the row's geometry`
      );
    }
  });

  test("nothing on the board ellipsizes", () => {
    // An "..." costs about three characters of the very width it is
    // reporting is short. On a fixed panel a name cut mid-word still
    // reads — "Coney Island-Stil" tells a rider more than "Coney Is…" —
    // so every clipped element shows as much as it can instead.
    //
    // `data-clamp` is the framework's own JS truncation and appends the
    // ellipsis at render time, so it counts too. The one exception is the
    // card error box, where the message is prose and genuinely wraps.
    for (const [name, markup] of layouts) {
      // Comments name both mechanisms to explain why they are not used.
      const code = markup
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\{%\s*comment\s*%\}[\s\S]*?\{%\s*endcomment\s*%\}/g, "");
      assert.doesNotMatch(
        code,
        /text-overflow:\s*ellipsis/,
        `${name}.liquid ellipsizes`
      );
      assert.doesNotMatch(
        code,
        /data-clamp="1"/,
        `${name}.liquid clamps a single-line element`
      );
    }
  });

  test("a bus or ferry row matches a train row", () => {
    // They are the same information from different networks, so they must
    // read as the same kind of row. A badge at 0.86em made bus and ferry
    // text visibly smaller than the trains beside them.
    for (const [name, markup] of layouts) {
      const rule = /\.row-badge\s*\{([^}]*)\}/s.exec(markup);
      assert.ok(rule, `${name}.liquid has no row badge rule`);
      // The comments explain what is deliberately absent, so they would
      // match the very patterns being looked for.
      const css = rule![1].replace(/\/\*[\s\S]*?\*\//g, "");
      assert.doesNotMatch(
        css,
        /font-size/,
        `${name}.liquid sizes a bus or ferry badge differently from a train's`
      );
      // Each badge as wide as its own name: a floor would pad "M42" and
      // "SIM8" to one indistinguishable box.
      assert.match(css, /width:\s*max-content/, `${name}.liquid fixes badge width`);
      // `min-width: 0` is the opposite of a floor — it removes the
      // automatic `min-width: auto` a flex item gets, so the badge can
      // give way rather than shove the clock off the row. Only a
      // *positive* floor is the bug this guards against.
      const floor = /min-width:\s*([^;]+);/.exec(css);
      assert.ok(
        !floor || floor[1].trim() === "0",
        `${name}.liquid floors badge width at ${floor && floor[1].trim()}`
      );
    }
  });

  test("every element on a row draws in the same face", () => {
    // `screen--fonts-trmnl` maps the framework's classes onto bitmap
    // faces, and they are not interchangeable: `.description` is TRMNL12
    // where `.label` and `.title--small` are TRMNL16. Both compute to
    // 16px, so a mismatch is invisible in the CSS and obvious on the
    // panel — a bus destination drawn visibly larger than the badge
    // beside it.
    for (const [name, markup] of layouts) {
      assert.doesNotMatch(
        markup,
        /class="row-dest[^"]*description/,
        `${name}.liquid draws the destination in a different face`
      );
      assert.match(
        markup,
        /class="row-dest[^"]*title--small/,
        `${name}.liquid does not give the destination the row's face`
      );
    }
  });

  test("no type size is a pixel literal", () => {
    // The framework multiplies every size by the user's chosen
    // `--modifier-scale`, so a literal does not scale with the board. The
    // clock was `font-size: 15px`: on a panel set above Regular it stayed
    // 15px while everything around it grew, leaving the time the smallest
    // thing on the row and the destination the largest — the reverse of
    // what matters.
    //
    // Our own rules must size in `em`. Fixed pixel *boxes* are fine; this
    // is about type.
    for (const [name, markup] of layouts) {
      // Every style block, not the first: the device profile sits in one
      // of its own at the top, and all the type is in the next.
      const blocks = [...markup.matchAll(/<style>([\s\S]*?)<\/style>/g)];
      assert.ok(blocks.length > 0, `${name}.liquid has no style block`);
      const css = blocks
        .map((b) => b[1])
        .join("\n")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      const literals = [...css.matchAll(/font-size:\s*([0-9.]+px)/g)].map(
        (m) => m[1]
      );
      assert.deepEqual(
        literals,
        [],
        `${name}.liquid sets type in pixels: ${literals.join(", ")}`
      );
    }
  });

  test("the destination clips instead of wrapping", () => {
    // A wrapped name makes its row taller than its neighbours, which is
    // exactly what uniform row height exists to prevent.
    for (const [name, markup] of layouts) {
      assert.ok(
        markup.includes("row-dest"),
        `${name}.liquid does not bound its destination`
      );
    }
  });

  test("every layout puts the heading marks after the title", () => {
    // Subway bullets and the LIRR/Metro North/Ferry tags share one slot, to
    // the right of the station name. Three layouts rendered them *before*
    // the title, so a tag sat where a reader expects the name — visible
    // only once the non-subway types had marks of their own.
    for (const [name, liquid] of layouts) {
      const title = liquid.indexOf("{{ card.n }}");
      const marks = liquid.indexOf("{% if card.b %}");
      assert.ok(title >= 0 && marks >= 0, `${name} has no card heading`);
      assert.ok(
        title < marks,
        `${name} renders the heading marks before the station name`
      );
    }
  });

  test("the heading marks are bounded by width, not by a count", () => {
    // A twelve-route complex wraps its bullets onto a second line and, in
    // the smaller layouts, straight through the neighbouring card's
    // heading — so the strip has to be bounded somehow.
    //
    // It was a fixed `limit:` for a while, and that is the wrong shape: the
    // right count depends on the bullet size, so the cap went stale the
    // moment the bullets shrank, and Times Square headed itself "1 2 3 7"
    // while the rows beneath showed A, E and R. Clipping cannot go stale.
    for (const [name, liquid] of layouts) {
      assert.ok(
        liquid.includes('<div class="bullet-strip'),
        `${name} does not bound its heading marks`
      );
      assert.doesNotMatch(
        liquid,
        /\{%\s*for route in card\.b limit:/,
        `${name} still caps its bullets at a fixed count`
      );
    }
  });

  test("a heading tag is not squeezed like a bullet", () => {
    // The tag shares the heading's mark slot with the subway's bullets, and
    // that slot is sized for circles. When the strip gained a shrink and a
    // 50% cap, "LIRR", "Bus" and "Ferry" were crushed to an unreadable
    // black square on the device — a word is useless once clipped, where a
    // bullet list can give way.
    for (const [name, liquid] of layouts) {
      assert.match(
        liquid,
        /\.type-tag \{[^}]*min-width:/s,
        `${name} lets its network tag shrink to nothing`
      );
      assert.ok(
        liquid.includes("bullet-strip--tag"),
        `${name} applies the bullet cap to a card carrying a tag`
      );
    }
  });

  test("the layouts do not depend on :has()", () => {
    // It reads better than a template-set modifier, but this markup renders
    // on an e-ink device whose browser version is not ours to choose, and
    // an unsupported selector drops the whole rule silently — here that
    // would mean shipping the very bug the rule fixes.
    for (const [name, liquid] of layouts) {
      // Comments mention it by name — explaining why it is not used is the
      // point — so strip CSS and Liquid comments before looking.
      const code = liquid
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\{%\s*comment\s*%\}[\s\S]*?\{%\s*endcomment\s*%\}/g, "");
      assert.doesNotMatch(code, /:has\(/, `${name} uses :has()`);
    }
  });

  test("a heading tag cannot overflow its card", () => {
    // The tag shares its slot with the subway's route bullets, but unlike a
    // bullet it is words. Unbounded, a long one wraps onto a second line,
    // pushes past the card's edge into the heading beside it, and crushes
    // the station name it was meant to sit next to — verified by rendering
    // a 32-character tag, which clipped "Harlem-125 St" to "Harlem-1…".
    //
    // The station name is what a rider reads first, so the tag gives way.
    for (const [name, liquid] of layouts) {
      assert.ok(
        liquid.includes(".type-tag {"),
        `${name} does not define the tag's bounds`
      );
      assert.ok(
        /<span class="label[^"]*label--filled type-tag">/.test(liquid),
        `${name} renders a heading tag without bounding it`
      );
      for (const rule of ["text-overflow: clip", "white-space: nowrap", "max-width"]) {
        assert.ok(
          liquid.includes(rule),
          `${name}'s tag is missing ${rule}`
        );
      }
    }
  });

  test("the grid is sized to the columns in use", () => {
    // Hardcoded at three, a board using two left a third of the panel
    // blank — and width is the thing destinations are short of, which is
    // why three is the maximum in the first place. Two columns go from
    // ~253px each to ~390px.
    //
    // Slots keep their columns: only the empty ones are dropped, so a card
    // never moves because a different card was added elsewhere.
    for (const name of ["full", "half_horizontal"]) {
      const liquid = layouts.get(name)!;
      assert.ok(
        liquid.includes("grid--cols-{{ used_columns }}"),
        `${name} hardcodes its column count`
      );
      assert.ok(
        /\{%\s*if used_columns == 0\s*%\}/.test(liquid),
        `${name} does not guard against an empty board`
      );
    }
  });

  test("a long row badge cannot make its row taller", () => {
    // Uniform row height is what makes a column scannable. "City Terminal
    // Zone" — LIRR's name for Penn/Atlantic/Grand Central service — wrapped
    // to a second line and pushed its row past its neighbours.
    for (const [name, liquid] of layouts) {
      assert.ok(
        liquid.includes(".row-badge {"),
        `${name} does not bound its row badges`
      );
      assert.ok(
        liquid.includes("row-badge{% endif %}"),
        `${name} never applies the bound`
      );
    }
  });

  test("every layout shows when the data was fetched", () => {
    // A panel refreshes on an interval and e-ink holds its last image
    // through a failure, so without this there is no way to tell a quiet
    // board from a frozen one.
    //
    // The Worker pre-formats it in New York time: Liquid cannot convert a
    // timezone, and the panel runs wherever the user is.
    for (const [name, liquid] of layouts) {
      assert.ok(
        liquid.includes("{% if a %}"),
        `${name} does not guard the timestamp`
      );
      assert.ok(
        liquid.includes("{{ a }}"),
        `${name} never renders the timestamp`
      );
    }
  });

  test("every layout draws the direction arrow", () => {
    // "in" toward the city, "out" away. The word picks a class; the shape
    // is a clipped box, because the bitmap faces exist at 12, 16 and 21px
    // only and a larger glyph would land between strikes.
    for (const [name, liquid] of layouts) {
      assert.ok(liquid.includes("r[4]"), `${name} ignores the direction field`);

      // The assignments themselves, not just the words — a comment
      // mentioning a direction would satisfy a bare `includes`.
      assert.ok(
        /assign arrow = "in"/.test(liquid),
        `${name} never assigns the inbound arrow`
      );
      assert.ok(
        /assign arrow = "out"/.test(liquid),
        `${name} never assigns the outbound arrow`
      );
      assert.ok(
        liquid.includes(`row-arrow--{{ arrow }}`),
        `${name} assigns an arrow but never renders it`
      );

      // The arrow is one box with a background, clipped to shape. Both
      // halves need asserting: a box with no clip-path is a filled
      // rectangle, and a clip-path on a box with no background is nothing.
      assert.match(
        liquid,
        /\.row-arrow\s*\{[^}]*background:\s*currentColor/,
        `${name}: .row-arrow has no fill to clip`
      );
      for (const side of ["row-arrow--in", "row-arrow--out"]) {
        const rule = new RegExp(String.raw`\.${side}\s*\{[^}]*clip-path:\s*polygon`);
        assert.ok(rule.test(liquid), `${name}: .${side} is not clipped to an arrow`);
      }

      // Every pixel must sit inside the box. `.row-dest` sets
      // `overflow: hidden`, so ink placed outside the element is clipped by
      // the parent — a shape built from borders or a pseudo-element on a
      // zero-size box draws outside itself and loses parts of the arrow on
      // the panel, while a browser preview still shows them.
      const arrowCss = /\.row-arrow\s*\{[^}]*\}/.exec(liquid)?.[0] ?? "";
      assert.doesNotMatch(
        arrowCss,
        /width:\s*0|height:\s*0/,
        `${name}: .row-arrow draws outside itself, which .row-dest clips`
      );
      assert.ok(
        !/\.row-arrow[^{]*::before/.test(liquid),
        `${name}: .row-arrow uses a pseudo-element, which .row-dest clips`
      );

      // Head and shaft have to tile the box exactly. The head runs from the
      // point to where the shaft starts, the shaft from there to the far
      // edge; if the two lengths do not sum to the width, the arrow has
      // either a gap in it or a shaft that overruns the head.
      const box = /\.row-arrow\s*\{[^}]*width:\s*(\d+)px[^}]*height:\s*(\d+)px/.exec(liquid);
      assert.ok(box, `${name}: .row-arrow has no pixel width and height`);
      const boxW = Number(box[1]);
      const boxH = Number(box[2]);

      for (const side of ["row-arrow--in", "row-arrow--out"]) {
        const poly = new RegExp(String.raw`\.${side}\s*\{[^}]*clip-path:\s*polygon\(([^)]*)\)`).exec(liquid);
        assert.ok(poly, `${name}: .${side} has no polygon`);
        const vertices = poly[1].split(",").map(v => v.trim().split(/\s+/));

        // Every vertex is in px except the point, which is 50% so it tracks
        // the height. A bare `0` has no unit, so it has to be taken too —
        // it is the far edge of the outbound shaft.
        const xs = vertices
          .map(v => v[0])
          .filter(v => v.endsWith("px") || v === "0")
          .map(v => Number(v.replace("px", "")));

        // The head and the shaft meet at the one x that is neither edge.
        const joint = xs.find(x => x !== 0 && x !== boxW);
        assert.ok(joint !== undefined, `${name}: .${side} has no head/shaft joint`);

        const headW = side.endsWith("--in") ? joint : boxW - joint;

        // The shaft's far edge is its own vertex, not a value derived from
        // the box — deriving it would make the sum below true by
        // construction and the assertion would test nothing.
        const farEdge = side.endsWith("--in") ? Math.max(...xs) : Math.min(...xs);
        const shaftW = side.endsWith("--in") ? farEdge - joint : joint - farEdge;

        assert.equal(
          headW + shaftW,
          boxW,
          `${name}: .${side} head ${headW}px + shaft ${shaftW}px != box ${boxW}px`
        );

        // A shaft as tall as the head is a rectangle with a point on it,
        // not an arrow.
        const ys = vertices
          .map(v => v[1])
          .filter(v => v && v.endsWith("px"))
          .map(v => Number(v.replace("px", "")));
        const shaftH = Math.max(...ys) - Math.min(...ys);
        assert.ok(
          shaftH > 0 && shaftH <= boxH / 3,
          `${name}: .${side} shaft is ${shaftH}px of ${boxH}px — too thick to read as an arrow`
        );
      }
    }
  });

  test("the arrow survives a dropped destination", () => {
    // A train to its branch's namesake has its destination blanked as
    // redundant — "Ronkonkoma | Ronkonkoma" — but still has a direction.
    // The old markup replaced the whole span with an empty spacer when the
    // destination was blank, which lost the arrow on exactly the rows that
    // most need it.
    for (const [name, liquid] of layouts) {
      assert.ok(
        !liquid.includes('<span class="grow"></span>'),
        `${name} still replaces a dropped destination with an empty spacer`
      );
    }
  });

  test("the card heading uses the same rule as the departure rows", () => {
    // The bug this guards: three layouts printed `{{ route }}` raw in their
    // headings while their rows went through the rule, so one card could
    // disagree with itself — heading "GS", rows "S".
    for (const [name, liquid] of layouts) {
      const headings = [
        ...markupOf(liquid).matchAll(
          /<span class="label[^"]*label--filled[^"]*">\{\{\s*(\w+)\s*\}\}<\/span>/g
        ),
      ].map((m) => m[1]);

      for (const variable of headings) {
        assert.equal(
          variable,
          "glyph",
          `${name} renders {{ ${variable} }} directly — it must render the glyph the rule produced`
        );
      }
    }
  });
});

describe("every class exists in the framework", () => {
  // trmnlp lint does not check this. An invented class is inert: the element
  // renders unstyled, which usually looks close enough that it ships.
  //
  // The stylesheet is fetched rather than vendored (19MB), so this test is
  // skipped offline rather than failing the suite for a network reason.
  const FRAMEWORK_CSS = "https://trmnl.com/css/3.4.4/plugins.css";
  const cachePath = resolve(root, "node_modules/.cache/trmnl-framework.css");

  /** Classes we define ourselves, in each layout's own <style> block. */
  const OURS = new Set([
    "bullet",
    "bullet--express",
    "bullet--pair",
    "type-tag",
    "row-badge",
    "row-line",
    "row-dest",
    "row-empty",
    "board-root",
    "row-time",
    "bullet-strip",
    "card-name",
    "card-heading",
    "footer-stamp",
    "footer-label",
    "row-line--urgent",
    "bullet-strip--tag",
    "row-arrow",
    "row-arrow--in",
    "row-arrow--out",
  ]);

  let frameworkClasses: Set<string> | undefined;

  before(async () => {
    let css: string | undefined;

    if (existsSync(cachePath)) {
      css = readFileSync(cachePath, "utf8");
    } else {
      try {
        const response = await fetch(FRAMEWORK_CSS);
        if (response.ok) {
          css = await response.text();
          mkdirSync(dirname(cachePath), { recursive: true });
          writeFileSync(cachePath, css);
        }
      } catch {
        // Offline. Left undefined, and the tests below skip.
      }
    }

    if (css === undefined) return;

    // Two escaping traps, each of which produced a false positive here:
    //
    // - Responsive variants are written escaped (`.md\:label--base`), so a
    //   colon counts as part of the name only when a backslash precedes it,
    //   and the backslash is dropped before comparing.
    // - A pseudo-selector can follow the class directly
    //   (`.label--underline::after`), so an *unescaped* colon must end the
    //   name. Allowing bare colons swallowed the pseudo-element and reported
    //   a real framework class as invented.
    const names = new Set<string>();
    for (const [, name] of css.matchAll(/\.(-?[_a-zA-Z](?:[\w-]|\\:)*)/g)) {
      names.add(name.replace(/\\/g, ""));
    }
    frameworkClasses = names;
  });

  for (const name of LAYOUTS) {
    test(`${name} applies no invented class`, (t) => {
      if (!frameworkClasses) {
        t.skip("framework stylesheet unavailable (offline)");
        return;
      }

      const invented = [...classesUsed(layouts.get(name)!)]
        .filter((cls) => !OURS.has(cls) && !frameworkClasses!.has(cls))
        .sort();

      assert.deepEqual(
        invented,
        [],
        `${name} uses ${invented.join(", ")} — not in the framework, so inert`
      );
    });
  }

  test("the framework still defines what the layouts lean on", () => {
    // A pinned framework version should not move under us, but it is served
    // from a URL rather than a lockfile. These are the classes whose absence
    // would quietly change the board's geometry.
    if (!frameworkClasses) return;

    for (const cls of [
      "grow",
      "basis--0",
      "flex--center-y",
      "flex--between",
      "w--full",
      "border--h-40",
      "label--filled",
      "label--outline",
    ]) {
      assert.ok(frameworkClasses.has(cls), `the framework no longer has .${cls}`);
    }
  });
});

describe("the layouts agree with the TypeScript rule", () => {
  // The templates cannot import subwayRouteGlyph, so these assert that what
  // the markup is built to do matches what the function actually does. If the
  // function's bounds change, the layouts' hardcoded bounds must change too.

  test("the express cases the rule produces all fit a bullet", () => {
    for (const routeId of ["6X", "7X", "FX"]) {
      const { glyph, isExpress } = subwayRouteGlyph(routeId);
      assert.equal(isExpress, true, `${routeId} should be express`);
      assert.ok(
        glyph.length <= 2,
        `${routeId} yields "${glyph}", which the layouts would draw as a pill`
      );
    }
  });

  test("every special label fits the bullet bound the layouts hardcode", () => {
    // The layouts test `glyph.size <= 2`. Any label the rule can produce that
    // is longer renders as a pill, which for a subway route is wrong.
    for (const routeId of ["GS", "FS", "H", "SI", "SS", "SIR", "1", "7", "A"]) {
      const { glyph } = subwayRouteGlyph(routeId);
      assert.ok(
        glyph.length <= 2,
        `${routeId} yields "${glyph}" (${glyph.length} chars) — too long for a bullet`
      );
    }
  });

  test("a named route stays long enough to be drawn as a pill", () => {
    // The other side of the same bound: these must *not* become bullets.
    for (const name of ["Q101", "B41", "Babylon", "Port Washington"]) {
      const { glyph } = subwayRouteGlyph(name);
      assert.ok(
        glyph.length > 2,
        `"${name}" yields "${glyph}", which the layouts would draw in a circle`
      );
    }
  });
});

describe("the preview is pinned to the device's own profile", () => {
  // TRMNL stamps a per-device class on the `.screen` wrapper when it renders
  // for hardware; `trmnlp` emits a bare `screen screen--fonts-trmnl`, so a
  // local build silently falls back to the `:root` defaults. Each layout
  // therefore sets the same variables that class would, which is how the
  // preview and the panel agree.
  //
  // Copied values go stale. This checks ours still match the framework's.
  const FRAMEWORK_CSS = "https://trmnl.com/css/3.4.4/plugins.css";
  const cachePath = resolve(root, "node_modules/.cache/trmnl-framework.css");

  /** The device this recipe is previewed against. */
  const DEVICE = "ogv2";

  // Variables the device block sets that `.trmnl .screen` already computes
  // identically — the gap scale chain and the full-screen sizes. The preview
  // gets those from `.screen` whether or not a device class is present, so
  // copying them would be noise. The test below proves they really are
  // identical rather than taking it on trust.
  //
  // --quadrant-w/h are the exception in the other direction: `.screen`
  // computes them differently, and the device's 100% resolves against
  // trmnlp's unsized wrapper and collapses the quadrant view to an empty
  // title bar. Verified by rendering it both ways.
  const ALREADY_ON_SCREEN = new Set([
    "gap-xsmall",
    "gap-small",
    "gap",
    "gap-medium",
    "gap-large",
    "gap-xlarge",
    "gap-xxlarge",
    "list-gap-small",
    "full-w",
    "full-h",
  ]);
  const CANNOT_COPY = new Set(["quadrant-w", "quadrant-h"]);

  let deviceProfile: Map<string, string> | undefined;
  let screenProfile: Map<string, string> | undefined;

  before(async () => {
    let css: string | undefined;

    if (existsSync(cachePath)) {
      css = readFileSync(cachePath, "utf8");
    } else {
      try {
        const response = await fetch(FRAMEWORK_CSS);
        if (response.ok) {
          css = await response.text();
          mkdirSync(dirname(cachePath), { recursive: true });
          writeFileSync(cachePath, css);
        }
      } catch {
        // Offline. Left undefined, and the tests below skip.
      }
    }

    if (css === undefined) return;

    const read = (body: string) => {
      const profile = new Map<string, string>();
      for (const [, name, value] of body.matchAll(/--([a-z0-9-]+):\s*([^;]+)/g)) {
        profile.set(name, value.trim());
      }
      return profile;
    };

    const device = new RegExp(`\.trmnl \.screen--${DEVICE}\{([^}]*)\}`).exec(css);
    const screen = /\.trmnl \.screen\{([^}]*)\}/.exec(css);
    if (!device || !screen) return;

    deviceProfile = read(device[1]);
    screenProfile = read(screen[1]);
  });

  test("the variables we skip are already identical on .screen", () => {
    // Why ALREADY_ON_SCREEN is safe to leave out. If a framework release
    // ever makes a device's gap chain differ from the generic one, this
    // fails and the skipped set has to be revisited.
    if (!deviceProfile || !screenProfile) return;

    for (const key of ALREADY_ON_SCREEN) {
      assert.equal(
        screenProfile.get(key),
        deviceProfile.get(key),
        `--${key} differs between .screen and ${DEVICE}, so it can no longer be skipped`
      );
    }
  });

  for (const name of LAYOUTS) {
    test(`${name} matches the ${DEVICE} profile`, (t) => {
      if (!deviceProfile) {
        t.skip("framework stylesheet unavailable (offline)");
        return;
      }

      const markup = readFileSync(resolve(root, `plugin/src/${name}.liquid`), "utf8");
      const ours = new Map<string, string>();
      const screenBlock = /\.trmnl \.screen \{([^}]*)\}/.exec(markup);
      assert.ok(screenBlock, `${name} sets no .trmnl .screen block`);

      for (const [, key, value] of screenBlock[1].matchAll(
        /--([a-z0-9-]+):\s*([^;]+)/g
      )) {
        ours.set(key, value.trim());
      }

      for (const [key, value] of ours) {
        assert.equal(
          deviceProfile.get(key),
          value,
          `--${key} is "${value}" locally but "${deviceProfile.get(key)}" on ${DEVICE}`
        );
      }

      // The other direction: a variable the device sets and we do not have
      // silently reverts to the :root fallback.
      for (const key of deviceProfile.keys()) {
        if (ALREADY_ON_SCREEN.has(key) || CANNOT_COPY.has(key)) continue;
        assert.ok(
          ours.has(key),
          `${DEVICE} sets --${key}, which ${name} does not pin`
        );
      }
    });
  }
});

/**
 * The generated layouts match their parts.
 *
 * The CSS these four files carry is near enough identical — the three
 * mashups differed in exactly two values, the view name and the cell's
 * width and height — so it is assembled by `scripts/buildLayouts.mjs`
 * rather than typed four times. The files under `plugin/src` stay committed
 * because `trmnlp push` uploads them, which means they can also be edited
 * by hand, which is the one thing that must not happen quietly: an edit
 * there is erased by the next generate.
 *
 * So the generator runs in `--check` mode here. It writes nothing and fails
 * when a generated file has drifted from the parts it was built from.
 */
describe("the layouts are generated, not hand-maintained", () => {
  test("every layout matches the parts it is built from", () => {
    const result = spawnSync(
      process.execPath,
      [resolve(root, "scripts/buildLayouts.mjs"), "--check"],
      { encoding: "utf8" }
    );

    assert.equal(
      result.status,
      0,
      `A layout under plugin/src has drifted from plugin/parts.\n` +
        `Change the part, not the generated file, then run ` +
        `\`npm run gen:layouts\`.\n\n${result.stderr}${result.stdout}`
    );
  });
});

/**
 * A mashup picks cards by how many it has room for, not by slot number.
 *
 * A slot is a position in the full-screen grid, not a ranking. Someone who
 * turns off card 1 and keeps the rest has an ordinary board, and the
 * backend drops a hidden card from the payload while leaving the others on
 * their own slots — so a layout that asks for "slot 1" gets nothing from a
 * board that is perfectly well configured. On a quadrant, which has room
 * for one card, that renders a blank panel.
 */
describe("a mashup shows the cards it has, whatever their slots", () => {
  const CAPACITY: Record<string, number> = {
    half_horizontal: 3,
    half_vertical: 2,
    quadrant: 1,
  };

  for (const [name, capacity] of Object.entries(CAPACITY)) {
    test(`${name} takes the first ${capacity} card(s) present`, () => {
      const liquid = source(name);

      // No slot-number test decides whether a card is drawn.
      assert.doesNotMatch(
        liquid,
        /\{%\s*if\s+card\.s\s*==/,
        `${name} still selects cards by slot number, so a board whose ` +
          `slot 1 is off loses a cell it has a card for`
      );
    });
  }

  test("every layout bounds itself by its own capacity", () => {
    // A counter compared against the capacity is what replaces the slot
    // test, so the number itself has to appear in a bound.
    for (const [name, capacity] of Object.entries(CAPACITY)) {
      const liquid = source(name);
      const bound = new RegExp(String.raw`\w+\s*<\s*` + capacity + String.raw`\b`);
      assert.match(
        liquid,
        bound,
        `${name} should stop after ${capacity} card(s), bounded by a counter`
      );
    }
  });
});

/**
 * The device pin must lose to a real device's own class.
 *
 * The framework declares `@layer tn--normalize, tn--elements,
 * tn--components, tn--base, tn--device-overrides, tn--themes,
 * tn--utilities` and puts every device block in `tn--base`. Unlayered CSS
 * beats every layer, so an unlayered copy of one device's numbers wins on
 * all hardware: a TRMNL X asks for 1040x780, is given the OG's 800x480,
 * and draws the board in the corner of its panel. Declaring ours in the
 * first and weakest layer is what keeps the preview pinned without
 * overriding the device.
 */
describe("the device pin yields to real hardware", () => {
  for (const name of LAYOUTS) {
    test(`${name} declares its screen block inside a layer`, () => {
      const liquid = source(name);
      const block = /@layer\s+([a-zA-Z0-9_-]+)\s*\{[^}]*\.trmnl\s+\.screen\s*\{/.exec(
        liquid
      );

      assert.ok(
        block,
        `${name} sets .trmnl .screen outside @layer, which beats every ` +
          `device class and pins all hardware to one device's size`
      );
      assert.equal(
        block[1],
        "tn--normalize",
        `${name} should use the framework's first (weakest) layer so any ` +
          `device block in tn--base outranks it`
      );
    });
  }
});

/**
 * The row budget is measured in CSS pixels, not device pixels.
 *
 * `trmnl.device.height` reports device pixels — 480 on an OG, 1404 on a
 * TRMNL X — while the Content Limiter measures the CSS pixels the
 * framework lays out in, 480 and 780. The two are equal on an OG, so
 * using one for the other is invisible there and overruns on an X: a
 * budget of 450 bought 16 rows of a ~27px row where 15 were intended, and
 * the top card of a column clipped the card beneath it.
 */
describe("the row budget converts device pixels to CSS pixels", () => {
  for (const name of LAYOUTS) {
    test(`${name} budgets against panel_height`, () => {
      const liquid = source(name);

      assert.doesNotMatch(
        liquid,
        /_rows\s*=\s*device_height/,
        `${name} sizes its budget from device pixels, which overruns a ` +
          `column on any device whose pixel ratio is not 1`
      );
      assert.match(
        liquid,
        /_(?:rows|fit)\s*=\s*panel_height/,
        `${name} should budget from panel_height, the CSS-pixel height`
      );
    });
  }

  test("the conversion knows both shipped devices", () => {
    // One lookup, spliced into every layout, so a device added in one
    // place reaches all four.
    for (const name of LAYOUTS) {
      const liquid = source(name);
      assert.match(
        liquid,
        /when 1404\s*%\}\s*\{%\s*assign panel_height = 780/,
        `${name} should map the TRMNL X's 1404 device px to 780 CSS px`
      );
      assert.match(
        liquid,
        /assign panel_height = device_height/,
        `${name} should fall back to the reported height for an ` +
          `unrecognised device`
      );
    }
  });
});

/**
 * The TRMNL X steps its text to the next bitmap strike, never scales it.
 *
 * `screen--fonts-trmnl` maps the type classes onto bitmap faces, and a
 * bitmap face has its pixels drawn for one size: TRMNL12, TRMNL16 and
 * TRMNL21. Every class sits on exactly one of them.
 *
 * So a device must not carry a `--device-ui-scale` other than 1 under
 * this theme. It multiplies every class at once and lands each between
 * strikes — at 1.25 the 16px faces rendered at 20px, which none is drawn
 * for — and the renderer resamples a bitmap instead of drawing one. That
 * shipped once: two destinations in a single card, identical classes,
 * came out at visibly different weights and cap heights, because what a
 * resampled bitmap looks like depends on its glyphs and the width it is
 * given.
 *
 * The size step belongs in the layouts as a class change per element,
 * which is what the rules below assert.
 */
describe("the X's type lands on a bitmap strike", () => {
  for (const name of LAYOUTS) {
    test(`${name} does not scale the X's type off its strikes`, () => {
      const liquid = source(name);

      // Every declaration, not the first: the preview pin in
      // `device-profile` legitimately sets 1 on `.trmnl .screen`, and a
      // first-match test is satisfied by it while a 1.25 sits further
      // down the file. That is exactly how this test passed against a
      // deliberately reintroduced scale when it was written.
      const declared = [
        ...liquid.matchAll(/--device-ui-scale:\s*([\d.]+)/g),
      ].map((m) => Number(m[1]));

      const offStrike = declared.filter((value) => value !== 1);
      assert.deepEqual(
        offStrike,
        [],
        `${name} declares --device-ui-scale ${offStrike.join(", ")}. The ` +
          `bitmap faces are drawn at 12, 16 and 21px, so any scale but 1 ` +
          `lands them between strikes and the renderer resamples rather ` +
          `than draws — step a class instead`
      );
    });

    test(`${name} steps the X's rows and heading to TRMNL21`, () => {
      const liquid = source(name);

      // The promotion is written against the framework's own variable,
      // so it follows a retune of the face rather than pinning 21px.
      for (const sel of ["card-name", "row-dest"]) {
        assert.match(
          liquid,
          new RegExp(
            `\.screen--v2 \.${sel}[^}]*font-size:[^;]*--title-font-size`
          ),
          `${name} should draw the X's .${sel} at --title-font-size ` +
            `(TRMNL21), the next strike above title--small's TRMNL16`
        );
      }
    });

    test(`${name} keeps the X's rows a step under its heading`, () => {
      const liquid = source(name);

      // Both move up together. The heading takes the whole strike and
      // the rows keep the 0.86 they carry on every device, so the
      // hierarchy a reader sees is the one an OG has. Scaling the name
      // on its own is what inverted it once.
      assert.match(
        liquid,
        /\.screen--v2 \.row-dest[\s\S]{0,200}?font-size:[^;]*--title-font-size\)\s*\*\s*0\.86/,
        `${name} should keep the X's destination at 0.86 of the strike ` +
          `its station name takes, as it is on an OG`
      );
    });
  }
});

/**
 * Row pitch is per device, because the row styles are written in `em`.
 *
 * A row's height follows its own font size, so it is a different number
 * of CSS pixels on each device. A single constant is wrong on one device
 * by construction: at 30 on an X the budget once bought four fewer rows
 * than it paid for, and a card stopped two thirds of the way down its
 * half-column.
 *
 * Both devices draw at `--device-ui-scale: 1`; what differs is the strike
 * the row's text sits on — TRMNL16 at 16px on an OG, TRMNL21 at 21px on
 * an X. The pitch follows that ratio: 30 * 21/16 = 39.
 *
 * The strike and the pitch are one tuning held in two files, so the pair
 * is asserted together below.
 */
describe("row pitch follows the device", () => {
  for (const name of LAYOUTS) {
    test(`${name} takes row_pitch from the shared part`, () => {
      const liquid = source(name);

      // Exactly one assignment, inside the per-device case.
      const assignments = liquid.match(/\{%\s*assign row_pitch\s*=/g) ?? [];
      assert.equal(
        assignments.length,
        2,
        `${name} should assign row_pitch once per device branch, so a ` +
          `layout cannot shadow the shared value with its own constant`
      );

      assert.match(
        liquid,
        /when 1404\s*%\}\s*\{%\s*assign panel_height = 780\s*%\}\s*\{%\s*assign row_pitch = 39/,
        `${name} should pair the TRMNL X's 780 CSS px with the 39px row ` +
          `its TRMNL21 strike draws`
      );
    });

    test(`${name} keeps the X's row pitch in step with its strike`, () => {
      const liquid = source(name);

      // The pitch is the OG's 30px row times the ratio of the two
      // strikes. Derive it here rather than pinning the product twice
      // and letting one of the pair drift away from the other.
      const OG_PITCH = 30;
      const OG_STRIKE = 16; // title--small, TRMNL16
      const X_STRIKE = 21; // title--base, TRMNL21

      const pitch = liquid.match(
        /when 1404\s*%\}\s*\{%\s*assign panel_height = 780\s*%\}\s*\{%\s*assign row_pitch = (\d+)/
      );
      assert.ok(pitch, `${name} should set the X's row pitch`);

      assert.equal(
        Number(pitch[1]),
        Math.round((OG_PITCH * X_STRIKE) / OG_STRIKE),
        `${name} draws the X's rows at TRMNL21 but budgets a ` +
          `${pitch[1]}px row, so the Content Limiter divides the panel ` +
          `by a height its rows do not have`
      );
    });


    test(`${name} budgets the rows a column can actually hold`, () => {
      const liquid = source(name);

      // Derived from the column, not pinned, so a change to the chrome or
      // the pitch is caught instead of silently invalidating the pair.
      //
      // The device hands the layout `screen-h`, less a `gap` either side
      // and the title bar. A card then spends one line of the device's
      // title face on its heading plus a `gap--small` beneath it, and the
      // rest divides by the pitch. Two stacked cards split what is left
      // after the gap between them.
      const box = (screen, titleBar = 40, gap = 10) => screen - gap * 2 - titleBar;
      const maxRows = (available, heading, pitch, gapSmall = 7) =>
        Math.floor((available - heading - gapSmall) / pitch);

      const DEVICES = {
        OG: { screen: 480, pitch: 30, heading: Math.ceil(16 * 1.2) },
        X: { screen: 780, pitch: 39, heading: Math.ceil(21 * 1.2) },
      };

      const declared = (pct, screen, pitch) =>
        Math.floor(Math.floor((screen * pct) / 100) / pitch);

      // Read each percentage out of its OWN branch of the `case`. A
      // lazy `/else[\s\S]*?/` walks past the `else` into whichever
      // assignment comes first in the file, which is the X's — so the
      // OG was being checked against the X's numbers and this test
      // failed on correct code.
      const branch = (head) => {
        const found = liquid.match(head);
        assert.ok(found, `${name} has no matching case branch`);
        // Skip past the opening tag before looking for the next one, or a
        // branch that OPENS with `else` ends at its own first character.
        const rest = liquid.slice(found.index + found[0].length);
        const end = rest.search(/\{%\s*(when|else|endcase)\s*/);
        return end >= 0 ? rest.slice(0, end) : rest;
      };

      const pctsIn = (text) => ({
        full: Number(text.match(/assign full_pct = (\d+)/)?.[1]),
        split: Number(text.match(/assign split_pct = (\d+)/)?.[1]),
      });

      const pcts = {
        X: pctsIn(branch(/\{%\s*when 1404\s*%\}/)),
        OG: pctsIn(branch(/\{%\s*else\s*%\}\s*\{%\s*assign panel_height = device_height/)),
      };

      for (const [device, { screen, pitch, heading }] of Object.entries(DEVICES)) {
        const available = box(screen);
        const fullCap = maxRows(available, heading, pitch);
        const splitCap = maxRows((available - 7) / 2, heading, pitch);

        for (const [shape, cap] of [
          ["full", fullCap],
          ["split", splitCap],
        ]) {
          const pct = pcts[device][shape];
          assert.ok(
            Number.isFinite(pct),
            `${name} should declare ${shape}_pct for the ${device}`
          );

          const rows = declared(pct, screen, pitch);
          assert.ok(
            rows <= cap,
            `${name} budgets ${rows} ${shape} rows on the ${device}, but its ` +
              `column holds ${cap}: ${rows * pitch}px of rows plus ${heading}px ` +
              `of heading overruns the ${available}px the device gives it`
          );
          assert.ok(
            rows >= 1,
            `${name} budgets no ${shape} rows at all on the ${device}`
          );
        }
      }
    });

    test(`${name} keeps the footer a sibling of .layout when empty`, () => {
      // The framework makes room for the footer with
      //
      //   .view--full .layout:has(+.title_bar) { height: calc(… - bar) }
      //
      // an ADJACENT-SIBLING selector. Close one div too few in the
      // empty-board branch and `.title_bar` becomes a CHILD of `.layout`
      // rather than its next sibling: the rule stops matching, `.layout`
      // keeps its full height, and the footer is pushed off the bottom.
      // That shipped once — the footer rendered inline beside the message
      // in the middle of the panel.
      //
      // Both branches must therefore leave the DOM at the same depth.
      const liquid = source(name);
      const at = liquid.indexOf("{% if card_total == 0 %}");
      assert.ok(at > -1, `${name} has an empty-board branch`);
      const elseAt = liquid.indexOf("\n{% else %}", at);
      const endAt = liquid.indexOf("\n{% endif %}", elseAt);
      assert.ok(elseAt > -1 && endAt > -1, `${name}'s branch is well formed`);

      const depth = (s) =>
        (s.match(/<div\b/g) ?? []).length - (s.match(/<\/div>/g) ?? []).length;

      const empty = depth(liquid.slice(at, elseAt));
      const filled = depth(liquid.slice(elseAt, endAt));
      assert.equal(
        empty,
        filled,
        `${name}: empty branch leaves ${empty} div(s) open, populated one ${filled}`
      );
    });

    test(`${name} assigns row_pitch before using it`, () => {
      const liquid = source(name);
      const assigned = liquid.search(/\{%\s*assign row_pitch\s*=/);
      const used = liquid.search(/divided_by:\s*row_pitch/);

      assert.ok(assigned >= 0 && used >= 0, `${name} should do both`);
      assert.ok(
        assigned < used,
        `${name} uses row_pitch before the part assigns it, which Liquid ` +
          `resolves to nil and makes every budget zero`
      );
    });
  }
});
