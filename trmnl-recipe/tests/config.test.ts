/**
 * The recipe's two configuration sources, which must agree.
 *
 * `plugin/src/settings.yml` is what `trmnlp push` uploads. `recipe/form.yaml`
 * and `recipe/polling-body.json` are the paste-by-hand copies for configuring
 * the plugin through TRMNL's web UI. They describe the same recipe, so they
 * drift silently — and a field is only wired up when it appears in *both* the
 * form and the polling body.
 *
 * Both halves of that pairing can break, in opposite files:
 *
 * - a polling template reads `cardN_routes` while `form.yaml` never defines
 *   it, so the line filter cannot be reached through the pasted form.
 * - `settings.yml` defines `cardN_routes` while its own polling body never
 *   writes it, so a user of the *published* recipe fills the field in and
 *   watches nothing happen.
 *
 * Neither is a type error, neither fails a lint, and the board renders
 * perfectly in both cases. Only a reader comparing two files notices, which is
 * what these tests do instead.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) =>
  readFileSync(resolve(root, relative), "utf8");

const settingsYml = read("plugin/src/settings.yml");
const formYaml = read("recipe/form.yaml");

/** Field keynames declared in a YAML form, in file order. */
const declaredFields = (yaml: string): string[] =>
  [...yaml.matchAll(/^\s*-?\s*keyname:\s*(\S+)/gm)].map((m) => m[1]);

/**
 * The polling URL out of a settings.yml, without parsing YAML.
 *
 * It is a folded block scalar, so the value is the indented lines following
 * `polling_url:` — rejoined the way YAML folds them, which for a URL with no
 * blank lines means simple concatenation after trimming.
 */
function pollingUrlFromSettings(yaml: string): string {
  const start = yaml.indexOf("polling_url:");
  assert.ok(start >= 0, "settings.yml has no polling_url");
  const lines = yaml.slice(start).split(/\r?\n/).slice(1);

  const parts: string[] = [];
  for (const line of lines) {
    if (!/^\s+\S/.test(line)) break; // dedent ends the block
    parts.push(line.trim());
  }
  return parts.join("");
}

/**
 * The polling body out of a settings.yml.
 *
 * A literal block scalar (`|-`), so the value is the indented lines after
 * `polling_body:` with the indent removed and newlines kept.
 */
function pollingBodyFromSettings(yaml: string): string {
  const start = yaml.indexOf("polling_body:");
  assert.ok(start >= 0, "settings.yml has no polling_body");
  const lines = yaml.slice(start).split(/\r?\n/).slice(1);

  const kept: string[] = [];
  for (const line of lines) {
    if (line.trim() !== "" && !/^\s/.test(line)) break; // dedent ends the block
    kept.push(line.replace(/^ {2}/, ""));
  }
  return kept.join("\n");
}

/**
 * The JSON polling body, from the file that holds it.
 *
 * It lives in `recipe/` as well as in settings.yml because `trmnlp push`
 * drops `polling_body` — verified by pushing and pulling back, in both
 * block-scalar and one-line form. So the body has to be pasted into the web
 * UI by hand, and this file is what gets pasted.
 */
const shippedBody = read("recipe/polling-body.json");

describe("every card field is actually wired up", () => {
  // A field the polling URL never writes is a control that does nothing, and
  // the form gives no hint: it renders, accepts input, and is discarded.
  const perCardFields = ["station", "routes", "walk", "title"];

  for (const slot of [1, 2, 3, 4, 5, 6]) {
    for (const field of perCardFields) {
      const key = `card${slot}_${field}`;

      test(`${key} is declared and sent`, () => {
        assert.ok(
          declaredFields(settingsYml).includes(key),
          `${key} is missing from settings.yml`
        );
        assert.ok(
          shippedBody.includes(key),
          `${key} is declared but never written to the polling URL`
        );
      });
    }
  }

  test("each card can be hidden without losing its settings", () => {
    // Clearing a station also hides a card, but destructively. The toggle
    // is for parking a card you want back — a summer ferry, a station you
    // only use on weekdays.
    for (const slot of [1, 2, 3, 4, 5, 6]) {
      const key = `card${slot}_visible`;
      assert.ok(
        declaredFields(settingsYml).includes(key),
        `${key} is missing`
      );
      assert.ok(
        shippedBody.includes(`"visible": {{ ${key} | json }}`),
        `${key} is not passed to the Worker as v${slot}`
      );
    }
  });

  test("each card field is its own key in the body", () => {
    // Not packed into one value. The query string packed station, walk and
    // title together and the parser had to infer which was which from
    // where a separator fell — a station name can contain every separator
    // the grammar used, which is where most of this project's bugs came
    // from. A JSON key cannot be mistaken for another key.
    for (const slot of [1, 2, 3, 4, 5, 6]) {
      for (const field of ["routes", "walk", "title", "visible"]) {
        assert.ok(
          shippedBody.includes(`"${field}": {{ card${slot}_${field} | json }}`),
          `card${slot}_${field} is not its own json-escaped key`
        );
      }
      assert.ok(
        shippedBody.includes(`card${slot}_station | split: "::"`),
        `card${slot}_station is not split into an object`
      );
    }
  });

  test("the station is sent as an object, not a string", () => {
    // The template splits `type:ids` and sends both named, so the Worker
    // reads two fields instead of inferring them from a string. That is
    // what ended the parsing bugs: a card called "Bus:6:", ":5:" in a
    // heading, and a whole board lost because TRMNL stores `id::label`.
    assert.ok(
      shippedBody.includes('"type": {{ p1[0] | json }}'),
      "the station's type is not its own key"
    );
    assert.ok(
      shippedBody.includes('"ids": ['),
      "the station's ids are not an array"
    );
  });

  test("every interpolated value is json-escaped", () => {
    // `| json` quotes and escapes; an earlier pass thought it did not
    // exist and stripped quotes with `replace` instead, which was lossy
    // and unnecessary. Anything unescaped here can inject into the
    // document and take every card with it.
    const interpolations = [...shippedBody.matchAll(/\{\{([^}]*)\}\}/g)].map(
      (m) => m[1].trim()
    );
    assert.ok(interpolations.length > 0, "the body interpolates nothing");

    for (const expression of interpolations) {
      assert.match(
        expression,
        /\|\s*json$/,
        `a value reaches the body unescaped: {{ ${expression} }}`
      );
    }
  });

  test("a form default matches the Worker's own", () => {
    // Two defaults for one setting is a bug waiting to happen: a field the
    // user never touched sends the form's, a field they cleared sends
    // nothing and gets the Worker's. They must agree.
    const defaults: [string, string][] = [
      ["urgent_threshold", "5"],
      ["card1_walk", "5"],
    ];
    for (const [key, expected] of defaults) {
      const block = settingsYml.slice(settingsYml.indexOf(`keyname: ${key}`));
      const match = /default:[ \t]*"?([^"\r\n]+)"?/.exec(block);
      assert.ok(match, `${key} declares no default`);
      assert.equal(
        match![1].trim(),
        expected,
        `${key}'s form default disagrees with settings.ts`
      );
    }
  });

  test("visibility is never decided in Liquid", () => {
    // It was once, and the toggle did nothing: Liquid treats only `nil`
    // and `false` as falsy, so a checkbox stored as the string "false" is
    // truthy and `{% if cardN_visible %}` never hides anything. The value
    // goes to the Worker as data, where every spelling is understood.
    //
    // Pinned because the obvious-looking fix is to put the test back.
    assert.doesNotMatch(
      shippedBody,
      /\{%\s*if[^%]*_visible/,
      "a card's visibility is decided in the template"
    );
  });

  test("the card groups name their grid position", () => {
    // "Card 4" says nothing about where it lands. The grid is fixed —
    // slots 1&2 are the left column, 3&4 the middle, 5&6 the right — so
    // the group can say so directly.
    for (const [slot, label] of [
      [1, "Column 1 · Row 1"],
      [2, "Column 1 · Row 2"],
      [3, "Column 2 · Row 1"],
      [4, "Column 2 · Row 2"],
      [5, "Column 3 · Row 1"],
      [6, "Column 3 · Row 2"],
    ] as [number, string][]) {
      assert.ok(
        settingsYml.includes(`group: ${label}`),
        `slot ${slot} is not grouped as "${label}"`
      );
    }
    assert.ok(
      !/group: Card \d/.test(settingsYml),
      "a card is still grouped by number"
    );
  });

  test("there is no transit type field", () => {
    // Removed once the picker searched every network. The station search
    // covers them all and the stored value carries its own type prefix
    // (`lirr:102`), so the field decided nothing and was one more thing to
    // set wrongly — a card typed Subway with an LIRR station picked would
    // still have rendered the LIRR card.
    for (const slot of [1, 2, 3, 4, 5, 6]) {
      assert.ok(
        !declaredFields(settingsYml).includes(`card${slot}_type`),
        `card${slot}_type is back`
      );
    }
  });

  test("display settings are sent", () => {
    for (const key of ["use_24_hour", "urgent_threshold", "destination_scale"]) {
      assert.ok(declaredFields(settingsYml).includes(key), `${key} missing`);
      assert.ok(shippedBody.includes(key), `${key} is never sent`);
    }
  });
});

describe("the two configuration sources agree", () => {
  /**
   * A polling URL with its host replaced by a fixed token.
   *
   * `npm run configure <host>` rewrites `settings.yml` **in place** — it is
   * what trmnlp uploads — while leaving `recipe/` as templates carrying
   * REPLACE_ME. So after configuring, the two differ by exactly the
   * hostname and by nothing else, and that is the invariant worth holding:
   * comparing them literally fails the moment the recipe is configured,
   * which is a normal state rather than a defect.
   */
  const withoutHost = (url: string) =>
    url.replace(/https:\/\/[^/]+\//, "https://HOST/");

  test("both forms declare the same card fields", () => {
    const cardFields = (yaml: string) =>
      declaredFields(yaml)
        .filter((key) => /^card\d_/.test(key))
        .sort();

    assert.deepEqual(cardFields(formYaml), cardFields(settingsYml));
  });

  test("both forms declare the same display fields", () => {
    // The card fields are compared above, which left the Display group
    // unguarded: `destination_scale` existed only in settings.yml, so
    // anyone configuring the plugin by pasting form.yaml got no text-size
    // control at all. A missing field is invisible — the board renders at
    // the default and nothing reports that the knob was never offered.
    //
    // `author_bio` is excluded: it is the store listing's own field, which
    // a hand-configured install has no use for.
    const displayFields = (yaml: string) =>
      declaredFields(yaml)
        .filter((key) => !/^card\d_/.test(key) && key !== "author_bio")
        .sort();

    assert.deepEqual(displayFields(formYaml), displayFields(settingsYml));
  });

  test("a field's default is the same in both forms", () => {
    // `urgent_threshold` was 10 in form.yaml and 5 in settings.yml. Both
    // render, so neither is a failure a user could report — the pasted
    // board simply highlights twice as generously as the published one.
    const defaults = (yaml: string) => {
      const found = new Map<string, string>();
      for (const block of yaml.split(/^\s*-?\s*(?=keyname:)/m)) {
        const key = block.match(/^keyname:\s*(\S+)/)?.[1];
        const value = block.match(/^\s*default:\s*(.+)$/m)?.[1]?.trim();
        if (key && value !== undefined) found.set(key, value);
      }
      return found;
    };

    const fromForm = defaults(formYaml);
    const fromSettings = defaults(settingsYml);

    for (const [key, value] of fromForm) {
      if (!fromSettings.has(key)) continue;
      assert.equal(
        value,
        fromSettings.get(key),
        `${key} defaults to ${value} in form.yaml and ${fromSettings.get(key)} in settings.yml`
      );
    }
  });

  test("every field the body interpolates is declared in both forms", () => {
    // The pairing the file header describes, checked in both directions at
    // once. `display settings are sent` asserted settings.yml declared a
    // key and the body sent it — but `shippedBody` is the *pasted* body,
    // so a key could be sent by recipe/polling-body.json while only
    // settings.yml declared it. That is exactly how `destination_scale`
    // came to be missing from form.yaml: the body asked for it, the
    // published form had it, and the paste-by-hand form did not.
    //
    // Liquid resolves an undeclared variable to nil rather than failing,
    // so the body still renders and the key arrives as null. The board
    // then falls back to its default and nothing anywhere reports that
    // the user was never offered the control.
    const interpolated = new Set(
      [...shippedBody.matchAll(/\{\{\s*([a-z0-9_]+)\s*\|/g)].map((m) => m[1]!)
    );

    // Names the body binds for itself, rather than form fields: the
    // intermediates it assigns while splitting a station value, and the
    // `for` variable it loops the stop IDs with.
    const assigned = new Set([
      ...[...shippedBody.matchAll(/assign\s+([a-z0-9_]+)\s*=/g)].map((m) => m[1]!),
      ...[...shippedBody.matchAll(/for\s+([a-z0-9_]+)\s+in\s/g)].map((m) => m[1]!),
    ]);

    for (const name of interpolated) {
      if (assigned.has(name)) continue;
      for (const [file, yaml] of [
        ["form.yaml", formYaml],
        ["settings.yml", settingsYml],
      ] as [string, string][]) {
        assert.ok(
          declaredFields(yaml).includes(name),
          `the polling body interpolates ${name}, which ${file} never declares`
        );
      }
    }
  });

  test("no station field declares depends_on", () => {
    // xhrSelectSearch does not support it. The form-builder's own field
    // definitions list depends_on under xhrSelect only, and declaring it
    // here stopped the widget initialising at all — the dropdown was empty
    // and the Worker never saw a single request.
    for (const [name, yaml] of [
      ["settings.yml", settingsYml],
      ["form.yaml", formYaml],
    ] as [string, string][]) {
      assert.ok(
        !yaml.includes("depends_on"),
        `${name} declares depends_on on an xhrSelectSearch field`
      );
    }
  });

  test("each station endpoint names its own slot", () => {
    // Without depends_on the transit type cannot ride in the path, so the
    // endpoint carries the slot instead and the Worker reads that slot's
    // own type out of the posted body. TRMNL posts every slot's settings
    // together, so without the slot a card 2 picker set to LIRR would
    // answer from card 1's type.
    for (const [name, yaml] of [
      ["settings.yml", settingsYml],
      ["form.yaml", formYaml],
    ] as [string, string][]) {
      for (const slot of [1, 2, 3, 4, 5, 6]) {
        assert.ok(
          yaml.includes(`/api/stations?slot=${slot}`),
          `${name} has no endpoint for slot ${slot}`
        );
      }
      assert.ok(
        !/\/api\/stations\/\{\{/.test(yaml),
        `${name} still interpolates the type into the endpoint path`
      );
    }
  });

  test("the station picker is a GET", () => {
    // A POST with a JSON body is preflighted, and the preflight is where
    // the picker died for most of a session. A GET carrying only `query`
    // is a simple request: no preflight, no custom headers, nothing for a
    // browser to block.
    //
    // It also carries no sibling settings, which is why the Worker falls
    // back to searching every transit type rather than guessing one.
    for (const [name, yaml] of [
      ["settings.yml", settingsYml],
      ["form.yaml", formYaml],
    ] as [string, string][]) {
      assert.ok(
        !/http_verb:\s*POST/i.test(yaml),
        `${name} still POSTs from a station picker`
      );
      assert.equal(
        (yaml.match(/http_verb:\s*GET/gi) ?? []).length,
        6,
        `${name} should declare GET on all six pickers`
      );
    }
  });

  test("the recipe templates keep their placeholder", () => {
    // `recipe/` is the source the configure script reads; it writes
    // `recipe/out/` and leaves these untouched, so the hostname can change
    // without re-editing them. `settings.yml` is deliberately excluded —
    // it is rewritten in place, because it is the file trmnlp uploads.
    for (const [name, content] of [
      ["form.yaml", formYaml],
    ] as [string, string][]) {
      assert.ok(
        content.includes("REPLACE_ME"),
        `${name} was configured in place — it should stay a template`
      );
    }
  });

  test("the shipped settings point at exactly one host", () => {
    // Either every endpoint still says REPLACE_ME, or every one names the
    // same deployed Worker. A mixture means `configure` missed a spot, and
    // a missed picker endpoint fails as an empty dropdown rather than an
    // error — which is hard to notice and hard to diagnose.
    const hosts = new Set(
      [...settingsYml.matchAll(/https:\/\/([^/\s"']+)\/api\//g)].map((m) => m[1])
    );
    assert.equal(
      hosts.size,
      1,
      `settings.yml points at several hosts: ${[...hosts].join(", ")}`
    );
  });
});

describe("the polling URL is well formed", () => {
  test("a slot needs no guard, because an empty station is data", () => {
    // The query string needed `{% if cardN_station != blank %}` so a
    // cleared card wrote an empty parameter rather than a stray separator.
    // A JSON body has no such hazard: an empty string is a value, and the
    // Worker skips a card whose station is empty.
    //
    // Pinned because reintroducing the guard would write the literal
    // string "false" or an empty object into the document.
    assert.doesNotMatch(
      shippedBody,
      /\{%\s*if/,
      "the polling body branches in Liquid"
    );
  });

  test("a blank routes filter is harmless", () => {
    // The query string needed a guard: an empty "!" parsed as a filter
    // matching nothing and emptied the card. In the body `routes` is its
    // own key, and an empty string is simply no filter — so the guard is
    // gone and must stay gone, since `{% if %}` in a JSON document is how
    // a trailing comma gets written.
    assert.ok(
      shippedBody.includes('"routes": {{ card1_routes | json }}'),
      "routes is not a key of its own"
    );
    assert.doesNotMatch(
      shippedBody,
      /card\d_routes != blank/,
      "the body still guards an optional field"
    );
  });

  test("it carries all six slots", () => {
    for (const slot of [1, 2, 3, 4, 5, 6]) {
      assert.ok(
        shippedBody.includes(`card${slot}_station`),
        `slot ${slot} is missing from the body`
      );
    }
  });

  test("the transit type is not written into the value", () => {
    // `{{ cardN_type }}` alongside the station would doubled-prefix it —
    // the picker already stores the type on the front of its own value.
    assert.doesNotMatch(
      shippedBody,
      /card\d_type/,
      "a card writes its type into the body"
    );
  });

});
