/**
 * Assemble the four layout files from shared parts.
 *
 * TRMNL's Liquid has no partials. `{% render %}` and `{% include %}` do not
 * merely fail — they fail *silently at render time*, so a layout that uses
 * one ships looking fine and renders a blank card on the device. The four
 * layouts therefore have to be four complete files, and the duplication
 * between them is forced by the platform.
 *
 * What the platform does not force is maintaining that duplication by hand.
 * The three mashup layouts need 529 lines of CSS each that differ in exactly
 * two values — the view name and the cell's width and height — and the
 * device profile block is identical in all four. Typed out, a fix to any of
 * it has to be made four times, and a copy that misses one is invisible
 * until the panel renders it.
 *
 * So the duplication stays, because TRMNL requires it, and is *generated*
 * rather than typed. One edit to a shared part lands in every layout that
 * uses it.
 *
 * **The generated files are the shipped artifact.** `trmnlp push` uploads
 * `plugin/src/*.liquid`, so those are committed, not ignored. This script
 * rewrites them in place; `--check` verifies they match without writing,
 * which is what the test suite runs so a hand-edit to a generated file
 * cannot pass CI unnoticed.
 *
 * Usage:
 *   node scripts/buildLayouts.mjs          # regenerate plugin/src/*.liquid
 *   node scripts/buildLayouts.mjs --check  # fail if any file is stale
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PLUGIN = resolve(here, "../plugin");

const part = (name) =>
  readFileSync(resolve(PLUGIN, "parts", name), "utf8");

/**
 * The cell each mashup view occupies, as the framework's own `:root`
 * fallback writes it.
 *
 * Copied verbatim from the framework stylesheet rather than reduced: the
 * expressions are what `tests/layouts.test.ts` compares against, so a
 * framework upgrade that retunes a device is caught instead of silently
 * disagreeing. `full` is absent because it needs no override — the
 * framework already gives `--full-h` a pixel value.
 */
const FULL_W = "calc((var(--screen-w) - var(--gap) * 2))";
const FULL_H = "calc((var(--screen-h) - var(--gap) * 2))";
const HALF_W = "calc((var(--screen-w) - var(--gap) * 2) / 2 - var(--gap) / 2)";
const HALF_H = "calc((var(--screen-h) - var(--gap) * 2) / 2 - var(--gap) / 2)";

/** The views built from the mashup template, and the cell each one gets. */
const MASHUPS = [
  { view: "half_horizontal", width: FULL_W, height: HALF_H },
  { view: "half_vertical", width: HALF_W, height: FULL_H },
  { view: "quadrant", width: HALF_W, height: HALF_H },
];

/** Fill a part's `{{NAME}}` placeholders. */
function fill(template, values) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (whole, key) => {
    if (!(key in values)) {
      throw new Error(`No value for ${whole} in a layout part`);
    }
    return values[key];
  });
}

/**
 * Build one layout's text.
 *
 * A layout file is its own `body` part with the shared parts spliced in at
 * named markers. The markers are Liquid comments, so a body remains a valid
 * layout on its own and can still be rendered while being edited.
 */
function buildLayout(name, values) {
  const body = part(`${name}.body.liquid`);
  return body.replace(
    /^[ \t]*\{%-? ?part: ([a-z-]+) ?-?%\}[ \t]*\r?\n/gm,
    (_, partName) => {
      // A part is `<name>.css.liquid` when it carries styles and
      // `<name>.liquid` when it is markup or Liquid logic.
      const styles = `${partName}.css.liquid`;
      const file = existsSync(resolve(PLUGIN, "parts", styles))
        ? styles
        : `${partName}.liquid`;
      return fill(part(file), values);
    }
  );
}

const layouts = [
  { name: "full", values: {} },
  ...MASHUPS.map(({ view, width, height }) => ({
    name: view,
    values: { VIEW: view, CELL_W: width, CELL_H: height },
  })),
];

const check = process.argv.includes("--check");
const stale = [];

for (const { name, values } of layouts) {
  const built = buildLayout(name, values);
  const target = resolve(PLUGIN, "src", `${name}.liquid`);
  const current = readFileSync(target, "utf8");

  if (built === current) continue;
  if (check) {
    stale.push(name);
    continue;
  }
  writeFileSync(target, built);
  console.log(`wrote plugin/src/${name}.liquid`);
}

if (check && stale.length > 0) {
  console.error(
    `\nThese layouts do not match their parts: ${stale.join(", ")}\n` +
      `Run \`npm run gen:layouts\`. If you meant to change a layout, change\n` +
      `the part under plugin/parts or plugin/layouts, not the generated file.`
  );
  process.exit(1);
}

console.log(check ? "layouts are up to date" : "layouts rebuilt");
