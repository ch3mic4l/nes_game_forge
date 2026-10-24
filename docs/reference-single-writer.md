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

### Editing `shared/` or `main/build/`

`generatorHash` (`test/lua/sw_provenance.mjs:47`) hashes the path and raw bytes of **every** file under `shared/` and `main/build/`, reachable or not. Any edit
there, a comment or a new unused export included, moves the generator fingerprint and fails `crossevidence.test.js`, `harnesstransfer.test.js` and `streamtilebound.test.js`
(the streamed-world bound evidence) until a renewal sweep like R1's (`docs/design-streamed-worlds-phase3b.md` section 23). So a change that does not need to be in
the build pipeline's inputs goes outside them: the Monster Forge's seed helpers are in `renderer/forges/monster/seed.js` for this reason
(`docs/design-monster-derive-seed.md`). A change that must edit them budgets the renewal first.

Separately, an edit to `shared/project.js` or `shared/eventrules.js` also moves the raw-byte pins in `test/unit/worldmarkers.test.js` (the M6 change detector). A bound-evidence sweep does not
repair those. The test's own failure message names the fix: "<file> changed. Audit referenceInventory (renderer/forges/map/worldmarkers.js) against remapScreenReferences
-- and against projectEvents and allCommands, which it reads through -- then update PINNED_DIGESTS in test/unit/worldmarkers.test.js." That is an inventory audit and a re-pin.

### Equipment (ROADMAP item 5)

- **The slot list** is `EQUIP_SLOTS = ['weapon', 'armor', 'accessory']` (`shared/project.js`); its length is `RPG_LIMITS.equipSlots` (3), the one
  number the RAM layout (`pc_equip`'s `EQUIP_BYTES` = `equipSlots * party`, in `config.inc`) and the save field's size both derive from.
  Never write `3` or `12` anywhere else.
- **The stat list** is atk / def / mag / mdef: the editor's `EQUIP_STATS` (`renderer/forges/items/equipui.js`) and the engine's
  `EQUIP_STAT_LABELS` (`main/build/battletables.js`) are the two ends of it, and the `combatant_*` bonus arrays (`pc_eq_*`) a third; a fifth stat
  is edited in all of them in one change.
- **Diagnostics** carry `rule`, `subject` and `counts` as structured fields, and a test asserts on those, never on parsed message text. The
  equipment rules are `equip-ignored-action-game`, `equip-piece-has-effect`, `equip-unbound`, `start-equip-not-a-piece`,
  `start-equip-wrong-slot` and `start-equip-not-allowed`.
- **`EQUIP_SAVE_SHIFT`** is generated into `assets/cartridge.inc`, not `config.inc` (`equipSaveShift`, `main/build/generate.js`): it is a
  cartridge/save-record fact that moves the streamed `sw_*` block, and the harness's own scene builders must scan `cartridge.inc` for it
  (there is no fallback; a build without the file fails).

### Encounter groups (ROADMAP item 5)

- **Which mode a map is in** is `map.encounters.mode`, and only that (`'groups'`, absent otherwise). Every consumer reads `mode` through `mapUsesEncounterGroups` /
  `projectUsesEncounterGroups`, never `table.length` or `actorIds`; the generator, validation, the UI, `duplicateMapCore` and the capacity model all agree on it. A map's mode changes
  only by an explicit action in one `store.commit`: `applyEncounterConversion` or `useLegacyEncounterList`.
- **A group map's compiled entries** are `mapEncounterEntries`; **the weight-to-byte rule** is `encounterThresholds` (the Map Forge's chance column reads it too, never a
  second division); **the row and entry accounting** is `encounterRowPlan` / `encounterEntryTotal`, shared by validation, `encounterGroupTables` in the generator and
  `kernelTableBytes`. A legacy map's formation is still `mapEncounterFormation`, and its bytes ship in `map_enc_actors` for every map regardless of mode.
- **The limits** are `RPG_LIMITS.encounterGroups`, `encounterTableEntries`, `encounterWeightMax` and `encounterEntriesTotal`; the Monster and Map Forges, the conversion preflight and
  validation all read them.
- **Authoring moves** for both Forges live in `shared/encountergroups.js` (DOM-free); the Forges hold no rule of their own, and a refusal is decided before `store.commit`.
- **`ENC_GROUPS`** is generated into `config.inc` (always defined, 0 or 1) from `projectUsesEncounterGroups`; the engine's labels that only make sense with the picker exist only under it.

### Growth profiles (ROADMAP item 5)

- **A party member's growth is read through `effectiveGrowth` / `memberStatAt`** (`shared/project.js`), never the member's raw `baseHp` / `hpPerLevel`-style fields: the
  per-level tables (`levelTable`, `main/build/battletables.js`), both magic gates (`projectUsesMagicPower`, `projectUsesMagicDefence`, through
  `partyGrowsStat`) and the Character Forge's selected-member preview go through them (the selected-profile preview has no member and calls `profileStatAt` on the profile's record;
  the curve has that one implementation). A gate that reads the raw fields builds a profile-only mage with the stat silently off. The raw fields stay the
  member's retained custom numbers while a profile is assigned; the resolver itself (`growthRecord`), `createPartyMember`, the normalizer, the Forge's custom
  inputs and explicitly unprofiled fixtures and oracles legitimately read them. The rule is that an effective-growth consumer never bypasses the resolver. A gate follows what a member actually grows, never whether a profile exists.
- **The curve** is `profileStatAt` over the fixed level-15 horizon `GROWTH_HORIZON_LEVEL`, never `project.rpg.maxLevel`: lowering the level cap must not
  retune an existing level. `GROWTH_SHAPES` is persisted as strings.
- **The bounds** of every growth number are `GROWTH_LIMITS`, read by `normalizePartyMember`, the profile normalizer and the Character Forge inputs (the
  inputs may not carry a numeric literal; `test/unit/growthlimits.test.js` parses the source), and a typed profile number is rounded and bounded by
  `clampGrowthValue` in both the Forge and the normalizer. The profile cap is `RPG_LIMITS.growthProfiles`.
- **Deleting a profile** goes through `growthProfileUsers` (the Forge refuses and names the members while it is non-empty) and then
  `renumberGrowthProfileDeletion`, which throws on a referenced index; the caller splices and restamps `id = index`.
- **No engine code, allowance or save byte** belongs to a profile: a `GROWTH_*_ALLOWANCE` would be a bug. Depth: `docs/design-growth-profiles.md`.
