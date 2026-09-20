# Reference: The single-writer rule

Current-state reference, moved verbatim out of `CLAUDE.md` on 2026-09-20 so that file stays small
enough to load into every session. Maintain it the way CLAUDE.md was maintained: update it in the
same change that alters what it describes. Cross-references such as "The kernel budget, above" or
"The event system, below" name sibling sections, which are now sibling `docs/reference-*.md`
files; `CLAUDE.md` indexes them all.

### The single-writer rule

Anything the 6502 engine and the JavaScript tooling both depend on has **one** definition:

- Engine/generator constants → generated into `build/assets/config.inc`. Never hardcode a value
  in both `engine/*.asm` and `main/build/*`.
- Cartridge/mapper facts → `shared/cartridge.js`. It is the only place that knows a mapper's PRG
  size, legal CHR sizes, tileset ceiling and whether the engine supports it yet. The iNES header
  is *generated* into `build/assets/cartridge.inc`; never write `.ines*` directives in
  `engine/main.asm`, or the UI, the capacity math and the header end up with three answers.
- The music format → `shared/audio.js`. It is implemented three times (the 6502 driver in
  `engine/music.asm`, the compiler in `main/build/songcompile.js`, the preview replayer in
  `renderer/forges/sound/replayer.js`). `test/unit/music.test.js` runs the built ROM in the
  emulator, records every write to `$4000-$400F`, and asserts it is byte-identical to the
  replayer's — change one implementation, change all three or that test fails. Every song's own
  instruments reach the ROM: `songTables` concatenates them in song order, `song_inst_base` names
  each song's offset, and the driver adds it into `mus_inst_base` (256 entries combined,
  `MAX_TOTAL_INSTRUMENTS`). `songByte`, `NO_SONG`, `songTimeline` and `songFrameLength` (a song's
  own length in frames, one full pass through its authored order) live here too, not in
  `main/build/textcompile.js`, because `shared/project.js`'s `validateProject` needs the identical
  resolution and cannot import upward from `main/build/` — `textcompile.js` re-exports
  `NO_SONG`/`songByte` verbatim for its existing importers (`main/build/generate.js`,
  `test/unit/script.test.js`). The `Sting` scripted command (item 6) is not a fourth implementation of the format:
  it plays an existing song through the same unmodified driver, pausing and resuming whichever
  song was already playing — see `docs/design-sting.md` for the full design and
  `engine/music.asm`'s own `sting_snapshot`/`sting_restore`/`sting_tick` comments for the
  mechanisms. The `Sfx` scripted command (item 6's last verb) is a genuinely separate, smaller
  format beside the music one, with its own single-writer contract in `shared/audio.js` (`NO_SFX`,
  `SFX_MAX_STEPS`, `sfxByte`, `normalizeSfx`, `sfxFrameLength`), implemented three times the same
  way — `engine/music.asm`'s `sfx_*` routines, `compileSfx`/`sfxTables` in
  `main/build/songcompile.js`, and `SfxReplayer` in `renderer/forges/sound/replayer.js` — held
  byte-identical by `test/unit/sfx.test.js`'s own golden trace. See `docs/design-sfx.md` for the
  full design.
- The NES palette → `shared/nespalette.js`, shared by the editors *and* the emulator, so the
  in-app preview matches the editors by construction.
- The message font → `shared/font.js`: the glyph art, the character-to-tile mapping, the window
  furniture aliases (`BORDER_H`, `ARROW_TILE`, …), `wrapText`, `NAME_LENGTH`, and the
  `projectUsesText` / `projectUsesCombat` predicates that decide whether a project pays for any of
  it. **The reservation is conditional**: a project that never shows text keeps all 256 background
  tiles, and one that does loses `$A0-$FF` in *every* tileset — except on MMC3, where
  `fontBankSplit` (also here) moves the font into its own CHR page and the scanline IRQ pays
  instead; see the split section under The engine. The generator stamps the glyphs into the
  **build-time** CHR copies only — never into project data, or the font would turn up in the Tile
  Forge as something the user drew. The same predicate drives the Tile Forge's shading, the
  `validateProject` error, and the stamp, so the three cannot disagree. The glyph *indices* reach
  the engine through `config.inc`, so no `.asm` file spells one out. **The in-game naming grid is
  text too**: `projectUsesText` answers true for a naming-only project via `projectUsesNaming`, a
  deliberate duplicate of `projectUsesNameEntry` (font.js cannot import project.js, so the two stay
  independent predicates held in agreement by `font.test.js`) — before this, a hero-naming-only
  action project shipped a grid with no glyphs stamped into its tilesets. `RPG_LIMITS.nameLength`
  reads `NAME_LENGTH` the same import-direction way; `wrapText` measures the `{name}` Say token
  (below) as `NAME_LENGTH` columns and never splits one across a line.
- Actions and game states → `ACTIONS` and `INPUT_STATES` in `shared/project.js`. Their *order* is
  the wire format: `generate.js` emits `input_actions` as one row per state of one byte per
  button, and the engine indexes it with `game_state * NUM_BUTTONS`. `ACT_*` and `ST_*` in
  `engine/constants.asm` are those orders written down, so adding an action or a state means
  editing both ends in the same change. `INPUT_STATES` has a seventh entry, `nameentry`
  (in-game party-member naming) — its row is conditional, the one case `input_actions` is not
  simply "one row per state": `generate.js` emits `INPUT_STATES.length` rows only when naming is
  live on the project, `INPUT_STATES.length - 1` otherwise, so a project that never names anyone
  pays no table byte for a state it can never enter.
- Describing and resolving a test scenario → `shared/playscenario.js` — not the stored scenario
  itself (`renderer/app.js`'s own `playScenario`/`rememberPlayScenario`), and not which toggles
  exist (`shared/testoverrides.js`'s `TOGGLE_NAMES`). The rule, stated in full in the file's own
  header comment: resolve by current name at call time, never cache a raw index — a screen or
  actor's numeric position is not its identity (`createScreen()`'s own comment says so for screens;
  `sprites.actors` renumbers every later actor on a delete for the same reason, item 7's own
  reorder/duplicate/delete family included). `describePlayScenario` turns Map Forge's raw numeric
  choice into a name/position description on pick; `resolveStartAt`/`resolveFormation` (via
  `mapsNamed`/`screensNamed`) resolve it back later against whatever project is then in hand,
  refusing rather than following a renamed map, *named* screen, or tracked
  actor — an unnamed screen instead falls back to its position
  within its own map, a value item 7's map reorder never touches.
- Rewriting every stored flat-screen reference after a map/screen structural edit →
  `remapScreenReferences(project, translate)` in `shared/project.js` (item 7, "Map organization and
  reuse"). It is the single place that knows *which fields* hold a flat screen reference — the
  fuller passage below, near `renderer/store.js`, has the rest.
- Engine RAM addresses → `engine/constants.asm`. Tooling that has to know where a byte lives
  *parses* them (`parseEquates` in `shared/enginesyms.js`) out of the `constants.asm` in `build/`,
  which is the copy that assembled the ROM in hand — a Code Forge override of it included. The
  Map Forge's ▶ Test tool is the caller: `renderer/emulator/testplay.js` pokes the engine's own
  `warp_*` bytes after boot, synchronizing on `main_loop_warp` — a label that exists in
  `engine/boot.asm` purely to be that point, and emits no bytes, so the ROM is identical with and
  without it. The same goes for the *labels* generally: `game.fns` is how the tooling names an
  address, so a label is cheaper than an assumption about which instruction follows which. Tests hardcode addresses with a `; from engine/constants.asm` comment
  because a test that reads the file it is checking proves nothing; shipping code must not.
  `testplay.js`'s start override also pokes `box_state`/`box_after` to `BOX_CLOSED` (all three
  added to `REQUIRED_RAM`): on a titleless naming-on ROM the in-game naming grid is mid-raise
  before `main_loop` ever runs, and MMC3's `split_select` reads `box_state` every frame regardless
  of which state owns it.

`shared/` modules must stay free of DOM and Node APIs: they are imported by the main process, the
renderer, and `node:test` alike.
