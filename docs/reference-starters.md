# Reference: The starter library and starter projects

Current-state reference for `docs/design-starter-library.md` and `docs/design-starter-projects.md`, moved verbatim out of `CLAUDE.md` on 2026-10-09 so that file stays small enough to load into every session. Maintain it the way CLAUDE.md was maintained: update it in the same change that alters what it describes.

### Starter projects (moved from CLAUDE.md, Starter projects)

Moved verbatim out of `CLAUDE.md` on 2026-10-09 (the size trim); the text below is unchanged.

Every content starter is `planLibraryImport` in a fixed order, then the shared player figure and
Doorway from `shared/starters/figures.js`, then hand-authored content; tile indices are probed at
build time, never assumed, because a starter pointing at the player's reserved tiles trips a
`validateProject` warning. `writePlayerFigure` returns 24 explicit `null`s, never `BLANK_TILE`
strings, or the placeholder is never substituted.

The `hideSwitch`-at-spawn trap, as a one-sentence rule: a one-shot interact page needs a switch
guard and a fallback page, `hideSwitch` alone repeats until the screen reloads.

`acorn` is an exact-pinned, test-only devDependency, imported by `test/lib/sourcescan.js` and
`test/unit/project.test.js`, never by anything under `main/`, `renderer/` or `shared/`.

### The starter library (moved from CLAUDE.md, The starter library)

Moved verbatim out of `CLAUDE.md` on 2026-10-09 (the size trim); the text below is unchanged.

A reserved
palette slot is always selectable; only writing fresh colours is refused.

`renderer/widgets/librarypicker.js` is the
one picker shared by all three Forges.
