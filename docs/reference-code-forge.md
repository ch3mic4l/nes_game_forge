# Reference: The Code Forge

Current-state reference, moved verbatim out of `CLAUDE.md` on 2026-09-20 so that file stays small
enough to load into every session. Maintain it the way CLAUDE.md was maintained: update it in the
same change that alters what it describes. Cross-references such as "The kernel budget, above" or
"The event system, below" name sibling sections, which are now sibling `docs/reference-*.md`
files; `CLAUDE.md` indexes them all.

### The Code Forge

The user's own 6502, in `project.code`: `overrides` are edited copies of engine files, `files` are
new sources. It lives in the project — not beside it — so undo, the dirty dot and saving are the
ones every other Forge already uses, and a per-project override cannot leak into another project.
On disk it is raw `.asm` under `code/engine/` and `code/user/`, two folders rather than one so
which kind a file is never depends on the engine's current file list.

Three rules hold it together:

- **The engine folder is the single writer of what a stock file is.** `engineFileNames()` in
  `generate.js` is that list; `checkCapacity` uses it to refuse a user file that would collide with
  an engine name, and to *warn* rather than fail on an override naming a file this version does not
  ship — a project saved by a later version still has to build. An override of `constants.asm` that
  moves a symbol out of zero page (or in) must keep every stock consumer that reads it with a `<`
  prefix in agreement — override those consumers too, or nesasm reports `Incorrect zero page
  address!` at assemble time for any surviving `<name` whose `name` no longer resolves below
  `$100`. The zero-page diet's own guard test (`test/unit/zeropage.test.js`,
  `docs/design-kernel-diet.md` §3) never catches this ahead of time — it audits the
  stock repository source, not a project's build-time copy — so a
  mismatched override is caught by the assembler, not this guard.
- **Overrides are copied in at their own name and their own line numbers.** The generator writes
  the stock engine in first and the overrides over the top, so nesasm's `file:line` refers to
  exactly what the editor shows, and the Build panel's error line can open it. `build/` is
  `rm -rf`'d every build, so editing files *there* is not a feature — it is data loss.
- **`assets/usercode.inc` is always emitted**, empty or not, and `engine/main.asm` includes it
  unconditionally in the kernel-lo bank. A project with no code of its own therefore assembles
  byte-for-byte identically to one built before the Forge existed, which `codebuild.test.js`
  asserts directly. $C000 is permanently mapped on every supported mapper, so a user label is
  callable from anywhere with no banking to think about.

Hand-written code is **deliberately outside `checkCapacity`'s byte math**: how much a source file
assembles to cannot be known from its text, and a guess would either refuse a project that fits
or promise room the assembler then denies. The assembler is the capacity check, which is why
`parseNesasmErrors` in `nesasm.js` matters — nesasm v3.1 reports errors across three lines
(`#[2] file`, then `line bank:addr source`, then the message) and **exits 0 anyway**. An
unrecognised message shape reads as a successful build until the never-written ROM fails to
rename, so it also falls back on nesasm's own `# N error(s)` count. `build:run` is the
one IPC channel that does not flatten its error through `fail()`, because the `{file, line}` array
is what the deep-link needs.

**nesasm v3.1 also crashes outright on a long label**, an undocumented limit found while building
the SFX feature: a label of 31 or more characters aborts the assembler with a glibc
`_FORTIFY_SOURCE` buffer-overflow error (exit 134) rather than a normal error line; 30 characters
assembles cleanly (`docs/sfx-implementation-report.md` §2). No regression test guards this limit.

The editor (`renderer/forges/code/`) is hand-rolled — the no-runtime-dependency/no-bundler
constraints rule out Monaco/CodeMirror.
`highlight.js` is a pure per-line tokenizer (nesasm has no multi-line construct), and its one
invariant — joining the tokens reproduces the line — is asserted over every line of the engine. Two
metric rules in `editor.js`: the gutter, the highlight layer and the textarea must agree on every
font and spacing value or the caret drifts off its character, and for an editable file `gotoLine`
sets the selection *before* the scroll, since focusing a textarea scrolls it on the browser's terms
and discards anything set first — a read-only generated file's `gotoLine` only scrolls. Typing
commits to the store on a pause rather than per keystroke (an unusable undo stack) or on blur (a
commit that may never come), so `saveProject` in `app.js` calls the mount contract's optional
`flushPendingEdits()` first.

**Two panes (ROADMAP item 9).** `code.js` shows up to two open tabs, `activeKey` left and
`splitKey` right, under four rules. A fresh open lands in the pane whose textarea last held
focus, left by default (`pickTargetPane`). **Every pane reassignment ends in
`placeInPane`/`focusPane`**, the one place that corrects a `focusedPane` naming an empty split
pane. Each tab owns its commit timer, so typing in one pane cannot cancel the other's pending
commit. Ctrl+Z drains the focused textarea's own native stack before the project stack. An
override's original is a fourth, read-only `stock` tab (◫ on an overridden tree row: copy left,
original right, **both placed after the last `await`**), pruned by `onProjectChange` the moment
the override is gone; `REFERENCE_LABELS` names the read-only kinds and **`ensureTab` is the
single load-or-reuse path**. The divider sets the left pane's flex-basis in percent —
module-level, never saved.

- Stock label stability: an internal movement-code dedup removed
  `move_left_done`/`move_right_done`/`move_up_done`/`move_down_done` as standalone labels, but they
  survive as zero-byte aliases on `move_horizontal_done`/`move_vertical_done` — a Code Forge user
  file that references any of the four by name still assembles.
