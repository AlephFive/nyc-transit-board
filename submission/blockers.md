# Clear these before sending

Ordered by what a reviewer would actually hit.

## 1. The layouts have not been seen on a TRMNL X, or in portrait

All four layouts have been checked on the OG panel, including the three
mashup shapes. What has not been checked is the other device: none of them
carry a `portrait:` class, and the geometry they do carry is derived from
landscape formulas.

TRMNL's own reviewers look for exactly this. Their published checklist says
they preview every view "across both TRMNL OG and TRMNL X in landscape mode,
as well as TRMNL X in portrait mode, to verify the screen is mostly content,
not whitespace", and their review agent flags "a layout sized for the OG that
leaves the TRMNL X mostly empty" and "portrait layouts that are squashed or
half empty".

Run `trmy`, their pre-submission review agent, which renders every view on
both devices in 1-bit and 2-bit, landscape and portrait, with each option of
every select field:
https://help.trmnl.com/en/articles/17698472-get-a-trmy-review-before-you-submit-a-recipe

Local render is **not** sufficient evidence here — the local preview has
already disagreed with the device once in this project.

## 2. `refresh_interval` is 900 locally and 1440 on the server

`plugin/src/settings.yml:166` says 900. The push round trip rewrites it to
1440, so the deployed plugin has been wrong for some time.

Fix it **in the web UI**, not by pushing: the push is what breaks it.
https://trmnl.com/plugin_settings/524413/edit

## 3. Rotate the TRMNL API key

It was pasted into a chat transcript repeatedly during development. Anyone
holding it can modify the plugin. Rotate before the listing is public.

## 4. Restore settings.yml after every push

A push rewrites `plugin/src/settings.yml` in place and the rewrite is
lossy: comments gone, `refresh_interval` reset to 1440, and
`polling_body` and `polling_headers` written out empty. That is the CLI
serialising the file, not the server losing the fields — the plugin keeps
polling correctly, and no re-paste is needed.

So the risk is only to the repo: commit before pushing, then
`git checkout -- plugin/src/settings.yml`. Push the stripped copy by
accident and the next upload really would carry empty fields.

`refresh_interval` on the server is a separate matter — see blocker 2.

## 5. `author_bio` is 24 words; search listing wants 100+

`settings.yml:177` carries the About field, correctly formatted with HTML
links to the guide and the repo. It is short.

TRMNL's form-builder docs: "A Recipe needs at least 100 words there to
appear in Google and other search engines." The field is also the public
description on the recipe page and the text in link previews, so it is the
main thing a prospective installer reads.

Not a blocker for approval — Chef only checks the field exists — but it is
the difference between being findable and not. It is also where TRMNL
expects setup guidance to live, rather than on the panel itself.

## Cleared

Audited against TRMNL's publishing checklist
(https://trmnl.com/blog/plugin-recipe-publishing-tips) and fixed in
`32520e3`:

- **`transit` was not a valid category.** Their list is 29 slugs and does
  not include it; the recipe now declares `travel`. This is the kind of
  thing their automated pre-submission check catches, so it would have
  cost a rejection round-trip.
- **The `Direction` and `Destination text size` selects showed bare
  values** (`1`/`2`, `0.8`/`0.9`/`1`). Both now use the documented
  `- Label: value` form, so the stored values are unchanged.
- **`recipe/form.yaml` had drifted from `settings.yml`**: it was missing
  `destination_scale` entirely, and defaulted `urgent_threshold` to 10
  against 5. The sync test only compared `card*` keynames, which is why
  neither showed up; it now compares the Display fields and the defaults.

Clean on every item in their Red Flags section: no async calls in markup,
no `optional: false`, no inline `opacity`, no `label--gray`, no custom
fonts, no JS at all, no charts, and the `title_bar` carries its own label
rather than the default TRMNL logo. `trmnlp lint` passes.

## Known-open, and fine to ship

These are documented in `docs/NEXT-SESSION.md` and are judgement calls
rather than defects. Listed so nobody treats them as surprises.

- **A squashed last row on some cards.** Three attempts, none of which
  changed the render. Cosmetic.
- **SI bullet centring.** Only on a Staten Island Railway card.
- **Direction 1 empty at a terminal.** Correct behaviour: nothing departs
  Grand Central *towards* the city. The guide tells users to leave
  Direction blank there.
