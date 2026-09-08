# Design: starter projects (ROADMAP item 8, fifth sub-bullet) — v6 (as shipped)

**v6 records every deviation the four implementation phases (`10f656c`, `aeed4d9`, `b3be691`,
`52c01a3`) accepted from v5, re-derived from the shipped code rather than copied from any commit
message, and corrects the body text in place wherever a deviation contradicts it** — most
consequentially, three probed-tile-index corrections (the Overworld's Villager, the RPG's Hero
battle portrait, and a new RPG "Villager" NPC frame the design never authored at all), a real bug in
the RPG recruit's own `hideSwitch` idiom found and fixed during phase 4's review, and two `§11` test
write-ups (test 10's catches-list, test 17's own negative control) that no longer matched what the
shipped tests actually check. Nothing here reopens a mechanism decision — every fix is either a
probed number the design guessed at before the code existed, or a design gap the implementer closed
the same way an established idiom elsewhere in this document already had. See the changelog for the
full, numbered list; v5's own closing summary (two `NaN`-safety fixes in test 17, plus the
no-wall-needed note for open screens) is preserved there too, under its own heading.

## §0. What I read for this design

`CLAUDE.md` in full. `docs/design-starter-library.md` in full (2024 lines, the model for shape and
rigor this document follows). `renderer/app.js:378-431` (`chooseGameType`/`newProject`).
`main/ipc.js:68-95` (`dialog:newProject`, `project:create`). `main/project-io.js:234-241`
(`createProjectAt`). `main/preload.cjs:12-20` (the `project` surface). `shared/project.js`:
`GAME_TYPES` (:444-447), `ELEMENTS` (:450-459), `createProject` (:3778-3831), `createMap`
(:1279-1301), `createPartyMember`/`createSpell` (:3747-3770), `defaultRpg` (:3737-3745),
`BEHAVIORS`/`canTalk` (:345-361), `EVENT_TRIGGERS` (:510-…), `EVENT_CONDITIONS` (:491-499),
`EVENT_COMMANDS` in full (:754-…, `heal`/`damage`/`save`/`battle`/`move`/`turn` entries read
individually), `canBackItem` (:641), `resolveEntityByte`'s caller contract via `canBackItem`,
`normalizeItem`/`ITEM_EFFECT_KINDS` (:389-393, :4946-…), `normalizeScreen`'s `boundTiles` block
(:4520-4541), `LIMITS`/`RPG_LIMITS` (:234-…, :1100-1115), `planPlayerSprite`/
`generatePlayerSpriteCore` (:2769-2791), `planLibraryImport`/`applyPlannedProject` (:7451-7470),
`planTerrainImport`/`planActorImport`'s own `options` handling (:6892-6970, :7061-7302).
`main/build/generate.js`: `checkCapacity` in full (:1851-…), `resolveEntityByte` (:2091-2096), the
per-tileset player stamp (:2160-2210). `main/build/pipeline.js`: `buildProject`/`inspectRom`
signatures (:16, :92). `shared/cartridge.js`: `DEFAULT_MAPPER`/`RPG_DEFAULT_MAPPER` (:242, :257),
`defaultMapperFor` (:391-…), `saveCapable` (:299-301). `shared/library/index.js` and every kind's own
`index.js` (five files) — confirmed the exact shipped inventory: 5 terrain, 3 monster, 4 pickup, 8
sfx, 2 song. `shared/library/monster/{slime,bat,skeleton}.js` and `shared/library/pickup/
{key,coin,potion,scroll}.js` in full — stats: Slime hp 5/dmg 1, Bat hp 3/dmg 1, Skeleton hp 8/dmg 2
(the strongest of the three); `potion.js`'s own `battle.heal: 20` and its own comment naming exactly
what `normalizeItem`'s migration derives from it; `key.js`/`coin.js`'s own `battle.heal: 0`.
`shared/library/terrain/*.js` in full — confirmed no `collision: 'solid'` metatile exists anywhere in
the library. `tools/sample-common.js` in full. `tools/make-sample.js` and `tools/make-mmc1-sample.js`
in full, `tools/make-rpg-sample.js` in full (not the partial read v1 relied on — see §0.1) and
`tools/make-rpg-save-sample.js:155-235`. `test/unit/samplegen.test.js` in full (not partially, this
round — see §0.1). `LICENSE-ASSETS`'s own opening paragraph. `engine/player.asm:195-264` (movement,
`probe_type`/`probe_solid`, `move_vertical_probe`'s own two-point probe — see §0.1) and
`engine/screens.asm:51,71,173` (the three `bound_tile_lookup` call sites). `engine/entities.asm:36-69`
(`spawn_entities`' own field loads, `ent_to_scr`/`ent_event`/`ent_trigger` each their own byte),
`:360-384` (`entity_pickup` in full). `main/build/textcompile.js:520-559` (independent per-entity
event compilation). `shared/project.js:700-721` (`availableTriggers` in full). `main/main.js:1-45,
205-239` (`FORGE_SMOKE`, `registerIpc`, `runSmoke`). `main/smoke.js`'s own imports (:1-17, confirming
the existing `unsavedChanges` import from `./ipc.js` as precedent) and a grep for `pickNew`/`New
project`, confirming zero existing coverage of either. `ROADMAP.md:1067-1072`. `engine/battleui.asm:
805-855` (`battle_sprite_pc`/`battle_sprite_mon` in full — see §0.1).

**Probes run against this working tree this round, not estimates and not copied from anyone's
figures** (§0.1 says what changed from v1's own probe): a palette-slot probe re-measuring every
starter's own import order from scratch, and a metatile-id probe for the dungeon's Stone Floor import
— both below, both cross-checked against §9's own final numbers.

### §0.1 What changed for v2, and why each additional read mattered

- **`tools/make-rpg-sample.js` in full**, not the `:225-350` slice v1 cited. The missed lines (`:12-
  14, :140-199`) are exactly where `PLAYER_TILES` is imported, HERO tiles are authored into tileset
  0 and copied into `project.sprites.playerTiles`, and the "Battle" tileset's own sprite table is
  built as `field.sprites.tiles.slice()` — a full copy of the field tileset's sprites, HERO included.
  v1's own §5 claim ("none of the six generators ever touches `playerTiles`") was checked against
  every generator *except this one*, which is the one that matters most, since it is the only RPG
  generator and this design's own RPG starter shares its exact problem (battle art has to live where
  battle rendering looks for it).
- **`test/unit/samplegen.test.js` in full**, not the `:50-65` slice. The header comment (`:1-37`)
  says outright that on-disk bytes are *not* expected to match between a regenerated project and its
  checked-in fixture, and the assertion (`:86-93`) is `assert.deepEqual(regenerated, checkedIn)` on
  two *loaded* project objects. v1's §3.3 called this "the existing six-generator byte-diff," which
  is not what the test does.
- **`engine/entities.asm`'s `spawn_entities` field loads (:36-69) and `entity_pickup` in full
  (:360-384)**, and **`main/build/textcompile.js:520-559`**. v1's §9.2 asserted a `pickup`-behaved
  placement has "no event slot left over" — false: `ent_event`/`ent_trigger` are loaded as their own
  bytes (:56-60), independent of `ent_to_scr` (:47-48, the byte `pickup` repurposes as an item id),
  and `textcompile.js`'s own per-entity loop (:541) compiles `entity.props?.event` for every
  placement regardless of the actor's behavior. The real reason a pickup can't run a `give`+
  `setSwitch` event on touch is that `entity_pickup` (:369-383) is a fixed, unconditional routine —
  deactivate, grant, done — that never reads `ent_event`/`ent_trigger` at all, and `availableTriggers`
  (`shared/project.js:717-721`) refuses `touch` for a `pickup`-behaved actor's own stored trigger in
  the first place ("The pickup is gone before its event could run").
- **`engine/player.asm:195-229`**, the movement code around the collision probe v1 already cited.
  `move_vertical_probe` (:206-222) probes exactly two points — the player's left and right body edges
  at the candidate row — through `probe_type`/`probe_solid`. A single isolated solid cell blocks only
  those two exact points; anything not directly in the player's path is simply never probed, which is
  what makes one solid cell in an open room a decoration, not a wall.
- **`engine/entities.asm`'s `entity_door` (the routine itself, already read in v1 as "around 388" —
  re-read in full this round)**: `jsr entity_touching_player / bne entity_door_done` then an
  unconditional four-store warp. No switch, no condition, ever.
- **`engine/battleui.asm:805-855` in full**, not only "around 845." `battle_sprite_pc` (:818-843)
  skips a party slot whose `pc_metasprite,x` is `$FF` (:823-825) before ever calling
  `draw_metasprite`; `battle_sprite_mon` (:845-855) draws a monster's own sprite fallback only when
  `mon_tile,y` (the block-art sentinel) is `$FF`, out of whatever CHR bank is currently switched in.
- **`main/main.js` and `main/ipc.js` in full**, not "around 68-76"/"34-36." Confirmed `dialog:
  newProject` (`main/ipc.js:68-76`) is `dialog.showSaveDialog`, not an open-folder dialog (a v1
  wording slip, corrected here though nobody flagged it); confirmed `main/smoke.js` runs inside the
  **main process** (`main/main.js:227`, `runSmoke(mainWindow)`), which is what makes a main-side seam
  possible at all — and confirmed `main/smoke.js:10` already imports `unsavedChanges` from
  `./ipc.js`, an existing precedent for exactly this kind of small, exported, smoke-only main-process
  seam.
- **`shared/project.js:4918-5010`** (`deriveItemEffect`, `normalizeItem`'s own `effect` resolution)
  and **`main/project-io.js:38-53`** (`saveProject` calls `normalizeProject(data)` as its very first
  line). Together these settle §9.2/§9.3's own open question from v1: `saveProject` normalizes *every*
  project handed to it, starter output included, so an item with no `effect` field at all would have
  its effect *derived* from its backing actor's raw `battle.heal` the moment `New Project` saves it —
  not left ambiguous.

### §0.2 What changed for v3, and why each additional read mattered

- **`shared/project.js:4495-4517`** (`normalizeEntity` in full) and **`main/build/generate.js:2940-
  2964`** (the headless byte emission for a placed entity). Confirmed `toX`/`toY` default to `112`
  through the normalized path (`clamp(props.toX, 0, 240, 112)`) and to `0` through the path
  `checkCapacity`/`generateAssets` take directly on an object that skipped normalization
  (`entity.props?.toX ?? 0`) — two different silent defaults, and v2 named neither because v2 never
  gave any door an explicit landing point at all.
- **`engine/player.asm:145-202`** in full (not only the vertical probe v2 already cited). `move_down_
  inside` (:198-202) computes its candidate `new_pos` from the player's *current* position plus speed
  and probes only that candidate — there is no code path anywhere in this routine that re-checks
  whether the player's own current, already-occupied cell is itself solid. A spawn point placed
  inside solid geometry is therefore never corrected or blocked; the player can walk out of it in
  whichever direction the probe happens to pass.
- **`engine/entities.asm:36-69`** (`spawn_entities`, re-read specifically for the `hideSwitch` load at
  `:62-67`) and **`engine/script.asm:295-320`** (`script_op_give`/`script_op_take`/`script_op_set` in
  full). `hideSwitch` is read once, in `spawn_entities`, at the moment a screen's entities are placed
  from its own record table — it is not consulted again until the next time that happens.
  `script_op_set` (`setSwitch`'s own opcode) calls `switch_set` and nothing else that touches any
  entity's `ent_active`/`ent_present` state. **`test/unit/script.test.js:433-454`** is the test that
  already pins this: `'an actor hidden by a switch is gone the next time the screen loads'` — its own
  title states the timing v2 got wrong.
- **`engine/entities.asm:452-478`** (`entity_touching_player` in full) and **`engine/constants.asm:
  782-792`** (`TOUCH_RANGE = 12`, and the `COL_*` constants with their own comment: "Anything from
  COL_DAMAGE up is walked through rather than blocked"). `entity_touching_player` is an independent
  dx/dy-under-`TOUCH_RANGE` proximity box on raw pixel coordinates, not a tile-overlap test and not
  gated by collision at all — an entity can be "touched" through a wall if it sits within 12 pixels on
  both axes of the player's own position, regardless of what stands between them.
- **`engine/player.asm:230-264`** (`probe_type`/`probe_solid` in full, re-derived byte by byte rather
  than trusted from v2's own paraphrase) alongside **`shared/project.js`'s `COLLISION_TYPES`** (`open`,
  `solid`, `water`, `damage`, `warp`, indices 0-4) and **`main/build/generate.js:2785`**
  (`collisionIndex(m.collision)` — confirming the compiled `mt_collision` byte *is* that plain index,
  not some other encoding). `probe_solid`'s own `cmp #COL_DAMAGE / bcc` branch keeps the raw index
  for `open`/`solid`/`water` and forces it to `0` for `damage`/`warp`; the final `cmp #0` a caller
  branches on is therefore zero (passable) for `open` (index 0), `damage` and `warp`, and **nonzero
  (blocked) for both `solid` and `water`** — v2's own "solid blocks, everything else passes" omitted
  water.
- **`shared/project.js:6795-6831`** (`resolvePaletteForKind`/`finishPaletteResolution` in full) and
  **`:7304-7324`** (`planActorImport`'s own `report` construction, confirming its `palettes` field
  carries `written` per entry-local palette) alongside a fresh probe (below) reading the real `report.
  palette(s).written` flag for every import in every starter's own order. `written` means "the chosen
  slot was in `unusedPaletteSlots` at the moment this import ran," not "the colours differ from
  what is already there" — v2's own "adopts"/"writes fresh" language conflated the two, even though
  its slot *numbers* were correct.
- **`CLAUDE.md:672-675`** (the delegation-is-structural passage: "proven by reading `generate.js`'s
  source, not its output — `playerparts.test.js`'s precedent") and **`test/unit/playerparts.test.js:
  380-394`** (the actual idiom: read a source file's text, assert it imports a given name and contains
  no shadowing local declaration of it). **`CLAUDE.md:1151-1154`** (the routes slice's own "confirmed
  with a cross-tree SHA-256 gate," stated as a one-time fact about a change that already shipped, not
  a permanent test) and the identical framing at `CLAUDE.md:672-673` for the draw-validation slice
  ("No ROM byte changed (six-fixture SHA-256 gate)") — both precedents are one-off verifications
  performed once, by whoever ships the change, never a checked-in test that re-runs against a moving
  tree.
- **`engine/oam.asm:1-34`** (`build_oam` in full) and **`shared/project.js:167,203`** (`PLAYER_FRAMES`'s
  own "4 directions x 2 walk frames" comment, `DIRECTION_ORDER = ['down','up','left','right']`).
  `build_oam` indexes `player_tiles` at `(player_dir * 2 + anim_frame) * 4` — each of the four
  directions owns its own two frames, entirely separate ranges. Authoring only `down`'s two frames
  (§5, slots `$00-$07`) leaves `up`/`left`/`right` (slots `$08-$1F`) at `null`, falling back to the
  build-time placeholder — so a player walking any direction but down sees a different figure than the
  one just authored.

**A fresh probe, re-run this round rather than trusted from the reviewer's own figures**, reading
`planLibraryImport`'s own returned `report.palette`/`report.palettes[0]` (`{slot, written}`) for every
starter's documented import order: Overworld writes background slot 1 (Grass Plains), background slot
2 (Wood Planks), sprite slot 1 (Bat) and sprite slot 2 (Coin) fresh, and adopts only Dirt Path
(background slot 1, `written: false`); Dungeon writes Stone Floor (bg 1), Skeleton (sprite 1) and Key
(sprite 2) fresh, and adopts Bat (sprite 1) and Potion (sprite 2); RPG writes Grass Plains (bg 2),
Stone Floor (bg 3), Slime (sprite 1) and Potion (sprite 2) fresh, and adopts Dirt Path (bg 2) and Bat
(sprite 1). Every slot number matches v2's own figures exactly; every "adopts"/"writes fresh" label
below is corrected to match this, not v2's own colour-matching-based guess.

### §0.3 What changed for v4, and why each additional read mattered

- **`shared/project.js:408-427`** (`ACTIONS` in full, confirming `{ id: 'attack', label: 'Attack' }`
  at index 1) and **`engine/input.asm:198-213`** (`do_attack` in full) alongside **`shared/project.js:
  3715-3734`** (`defaultInput()` in full, confirming `gameplay.A = 'attack'` is every project's own
  default, blank or content starter alike, with no authoring required). Together these are what let
  §9.2 state, rather than leave implicit, that the dungeon's own boss fight is winnable with the
  engine's existing default controls.
- **`shared/project.js:1055-1063`** (`VISIBLE_STATES` in full) and **`:4130-4139`**
  (`normalizeEffect`'s own `'state'` branch) alongside **`main/build/textcompile.js:295-307`** (the
  `'visible'` compile case in full). Confirmed `state` is the string id `'hidden'`/`'shown'`, and that
  a non-string value only ever "worked" by both functions falling back to index 0 on an unrecognised
  one — not because the value itself was read as falsy.
- **`main/ipc.js:1-95`** in full (not only `:68-95`), re-read specifically to check what
  `project:create`'s own handler returns: `ok({ dir, project })` (`:91`), never a catalog entry's own
  `gameType` field. v3's own test 1 rationale claimed otherwise.
- **A fresh sprite-tile probe**, reading each starter's own tileset-0 sprite table after its full
  documented import sequence, to find the first free four-tile run past every import: Overworld
  `$28-$2B` (40-43), Dungeon `$30-$33` (48-51), RPG `$2C-$2F` (44-47) — and confirming, from the same
  probe's own palette read, that sprite palette slot 2 is claimed by exactly one pickup import in
  every starter (Coin/Potion/Potion) and slot 3 is free in every starter except Overworld, where the
  Villager metasprite (§9.1) already claims it.

## §1. The problem

`ROADMAP.md`'s own item 8 fifth sub-bullet: **"Starter projects — action, dungeon crawl, RPG —
beyond today's demo fixtures."** Today, `New project` (`renderer/app.js:417-431`) asks exactly one
question — action or RPG, via `chooseGameType` (:386-415) — and hands the answer straight to
`createProject`, which returns the smallest possible legal project: one map named "World" holding one
blank screen, no actors, no items, no maps beyond it (:3778-3831). Every one of the eight Forges is
therefore something a brand-new author opens onto a blank canvas with nothing to look at, walk into,
or copy from. `sample/` and `sample-rpg/` are real, playable demonstrations of the engine's own
range, but CLAUDE.md's own "six fixtures, deliberately" passage is explicit that they exist to be
depended on by every engine test unchanged — they are not something `New Project` may ever generate a
copy of, mutate, or drift from.

Chris settled the shape of the fix on 2026-09-07 (four decisions, §2) before this design started:
generated in memory by pure functions, not checked-in template folders; three named starters beyond
the two blank entries; the existing game-type dialog is replaced, not supplemented; and content comes
from the starter library (`shared/library/`, ROADMAP item 8's fourth sub-bullet, fully shipped) plus
only what that library cannot provide. This document designs within those four decisions — it does
not reopen any of them — and settles every remaining mechanism, data shape, UI, test and phasing
question with a recommendation.

## §2. The four decisions (restated, not reopened)

1. **Shape**: generator *functions* — pure, importable modules (`tools/make-sample.js`'s own shape,
   made pure: no `fs`, no `path`, nothing but building a project object and returning it) — not
   checked-in template folders, and not copies of `sample/`/`sample-rpg/`. `New Project` calls a
   function and writes its return value; nothing is ever read off disk for a starter. Starters are
   **not** fixtures: CLAUDE.md's six-fixture rule is unchanged, nothing new is checked in under a
   `sample*/` directory, and every test that builds a starter builds it into a `mkdtemp` directory
   the same way `main/smoke.js`'s own scratch-directory tests already do (`main/smoke.js:9187`).
2. **Three starters**: action (overworld adventure), dungeon crawl, RPG. Dungeon crawl means the
   **action** engine — interior single-screen rooms linked by door actors, at least one door locked
   behind a switch a key sets, and a boss room — not a fourth game type.
3. **Flow**: `chooseGameType()` is **replaced**, not kept alongside a second entry point, by a
   starter picker offering Blank action, Blank RPG, and one entry per named starter. Game type is
   implied by the choice. The two blank entries must produce a project **byte-for-byte deep-equal**
   to what `createProject` produces today for that game type — the existing cartridge reconciliation
   (`defaultMapperFor`, `shared/cartridge.js:391`) runs exactly as it does today, unmodified.
4. **Content**: each starter is built by importing `shared/library/` entries through the existing
   plan cores (`planLibraryImport`/`applyPlannedProject`, `shared/project.js:7451-7470`), plus only
   what the library lacks: **a small authored player sprite** (§5 — v1 incorrectly read this as
   "none needed," which silently reopened this decision; corrected this round), maps and screens,
   placed entities, dialogue and events, and — for the RPG starter — the party and its spells.
   Licensing for library content is already covered by `LICENSE-ASSETS`; §13 says how a starter's own
   added content (the player sprite, and the dungeon's own wall art) is recorded there.

## §3. Where the generator code lives

### §3.1 The starter modules: `shared/starters/`, not `tools/` or `main/`

A starter's `build(name)` function needs three things: `createProject` (for the two blank entries and
as every content starter's own starting point), `planLibraryImport`/`applyPlannedProject` (for
library content), and nothing from Node or the DOM — it only ever assembles a plain JS object, the
same as every `tools/make-*.js` generator already does today, minus the `fs`/`path` calls at the very
end of each of those files. That makes `shared/` the only correct home: `main/project-io.js`'s
`createProjectAt` (a Node module) can import from `shared/` freely, exactly as it already imports
`createProject`; the renderer can import from `shared/` freely too, with zero IPC surface, exactly as
`design-starter-library.md §4` already established for `LIBRARY_ENTRIES` (`main/main.js`'s own
`forge://` protocol handler serves the whole repository root read-only, so a new `shared/starters/*.js`
tree is reachable by an ordinary `import` the instant it exists on disk — no `preload.cjs` change, no
new IPC channel). Putting the starter modules in `tools/` (Node-flavored, and every existing file
there does end each script with `fs`/`saveProject`) or in `main/` (unreachable from the renderer)
would each force a second copy of the same content just to render a preview or a label in the picker.

Layout, mirroring `shared/library/`'s own one-file-per-entry convention:

```
shared/starters/
  index.js            -- STARTERS = [...]  (the single catalog, §3.2)
  authoring.js         -- screenFromArt, promoted from tools/sample-common.js (§3.3)
  blank-action.js       -- { id: 'blank-action', ..., build }
  blank-rpg.js
  overworld.js          -- the "action (overworld adventure)" starter
  dungeon.js            -- the dungeon-crawl starter
  rpg.js                -- the RPG starter
```

### §3.2 The single writer for the catalog: `shared/starters/index.js`

```js
export const STARTERS = [
  { id: 'blank-action', label: 'Blank action', hint: 'An empty action-adventure project.', gameType: 'action', build: buildBlankAction },
  { id: 'blank-rpg', label: 'Blank RPG', hint: 'An empty turn-based RPG project.', gameType: 'rpg', build: buildBlankRpg },
  { id: 'overworld', label: 'Overworld adventure', hint: '...', gameType: 'action', build: buildOverworld },
  { id: 'dungeon', label: 'Dungeon crawl', hint: '...', gameType: 'action', build: buildDungeon },
  { id: 'rpg', label: 'Turn-based RPG', hint: '...', gameType: 'rpg', build: buildRpg }
];
```

Exactly two consumers, the same "single writer, N readers" shape `LIBRARY_ENTRIES` already has:

- **The renderer's picker** (§8) imports `STARTERS` directly (no IPC) to render one button per
  entry, reading only `id`/`label`/`hint` — it never calls `build` itself (§6.1).
- **`main/ipc.js`'s `project:create` handler**, via `createProjectAt` (§6.1), imports `STARTERS` to
  resolve the chosen id to a `build` function and a `gameType`.

`build(name)` is a plain function `(name: string) => project` — the identical shape `createProject`
itself already has, so `buildBlankAction`/`buildBlankRpg` are literally `(name) => createProject(name,
'action')` / `(name) => createProject(name, 'rpg')` and nothing more (§4 proves these byte-equal).

### §3.3 `tools/sample-common.js`'s helpers: one more promoted, none reimplemented

`design-starter-library.md §3`'s own phase 1 already moved `tile`, `split16` and `metasprite` out of
`tools/sample-common.js` into `shared/library/authoring.js`, leaving `tools/sample-common.js` a
re-export (confirmed by reading the file: it is nine lines, `export { tile, split16, metasprite }
from '../shared/library/authoring.js';` plus `screenFromArt`, defined locally). `screenFromArt`
(`tools/sample-common.js:17-31`) turns a legend and an array of character rows into `{ metatiles,
entities: [] }` — read in full, it touches no Node or DOM API at all (no `fs`, no `path`, nothing but
array and string operations); its only reason for living in `tools/` today is organizational — its
own comment says "a fixture-authoring concern... the library itself has no use for it." Starters *do*
have a use for it: every content starter below authors its own interior rooms and overworld screens
as ASCII-art legends, the identical idiom every `tools/make-*-sample.js` generator already uses.

**Recommendation: promote `screenFromArt` into a new `shared/starters/authoring.js`, and re-export it
from `tools/sample-common.js` alongside the other three** (`export { screenFromArt } from
'../shared/starters/authoring.js';`), rather than folding it into `shared/library/authoring.js`.
Keeping it out of the *library's* own authoring module matters for naming honesty: `shared/library/`
is specifically the CC0 content library (design-starter-library.md §1), and `screenFromArt` is a
screen/legend helper with no content of its own — it is exactly as much a starter concern as a
library one, so it gets the starters' own file rather than being misfiled under a directory named for
a different, narrower thing. This is a zero-behavior-change move (identical function body, identical
export shape from every existing importer's point of view).

**What actually proves it inert, corrected this round (round-1 finding 8)**: `test/unit/samplegen.test.js`
does not diff on-disk bytes — its own header (`:24-37`) says outright the bytes are *not* expected to
match, and its assertion (`:86-93`) is `assert.deepEqual` on two **loaded, normalized** project
objects. That is still a real, load-bearing proof that the promotion changes nothing observable
(every generator's own call to `screenFromArt` still produces the identical `{metatiles, entities}`
shape it always did, and the loaded-project comparison would catch a broken re-export exporting the
wrong function or a changed return shape) — it is simply not "byte-identical on disk," which is a
different, narrower guarantee this test was never written to give. **For genuine ROM-level byte
neutrality, §12 names this a one-off verification the implementer performs when phase 1 ships, not a
checked-in test** (round-2 finding 10 — a permanent test cannot see "the tree before the move" once the move
has landed, and pinning six literal ROM hashes would break on the next unrelated engine change,
forever, for a reason that has nothing to do with this design). This is the identical shape the routes
and draw-validation slices already used for the same kind of claim — "no ROM byte changed" stated once,
as a fact about a specific change, not re-asserted forever (`CLAUDE.md:672-673`'s "No ROM byte changed
(six-fixture SHA-256 gate)" for draw-validation; `CLAUDE.md:1151-1154`'s "confirmed with a cross-tree
SHA-256 gate" for routes): build all six generators into six fresh `mkdtemp` directories on the commit
immediately before the `screenFromArt` move and hash the resulting six ROMs, then do the same on the
phase-1 tree, and confirm the twelve hashes pair up unchanged. `samplegen.test.js`'s own normalized-
project comparison (above) is what actually ships as a permanent, checked-in test for this promotion.

## §4. The blank entries: byte-identical to `createProject`, and the test that pins it

`buildBlankAction(name) = createProject(name, 'action')`, `buildBlankRpg(name) = createProject(name,
'rpg')` — no wrapper logic, no post-processing. `main/project-io.js`'s `createProjectAt` (§6.1) calls
`starter.build(name)` and passes the result straight to `saveProject`, the identical code path
`createProjectAt` runs today (`return saveProject(dir, createProject(name, gameType));`,
`main/project-io.js:240`) with `createProject(name, gameType)` replaced by `starter.build(name)`. For
the two blank entries these are definitionally the same call, so nothing about today's cartridge
reconciliation, tileset count, default palettes or starting party changes.

**The test**: `test/unit/starters.test.js`, one case per blank entry, each pinning its **literal**
expected game type rather than reading it back off the entry under test (round-1 finding 6 — a test that
computed its own expectation from `starter.gameType` would still pass if `blank-rpg`'s own catalog
entry mistakenly declared `gameType: 'action'`, since the test and the bug would agree with each
other):

```js
assert.deepStrictEqual(STARTERS.find((s) => s.id === 'blank-action').build('X'), createProject('X', 'action'));
assert.deepStrictEqual(STARTERS.find((s) => s.id === 'blank-rpg').build('X'), createProject('X', 'rpg'));
```

*Catches*: a blank entry that accidentally sets a field `createProject` does not (a stray `titleMap`,
a palette tweak "to make the blank project look nicer"), **and**, with the literal expectation, a
blank entry wired to the wrong game type in the catalog itself — since the two blank entries are the
only starters this design requires to be indistinguishable from today's behavior, either kind of
drift here is a real regression in the one guarantee decision 3 makes explicit.

## §5. The player sprite: every content starter authors one small, shared figure

**v1 got this wrong and it was a real, silent reopening of decision 4, not a settled question** — v1
claimed no starter needed a player sprite because no existing generator author one, checked against
five of the six generators. The sixth, `tools/make-rpg-sample.js`, is the one that matters: it
imports `PLAYER_TILES` (`:12`), authors a 16×16 `HERO` figure via `tile`/`split16` and writes it into
tileset 0's sprite table at slots `$00-$03` ("the player") and `$04-$07` ("...and its walk frame")
(`:143-146`), then sets the canonical source directly: `project.sprites.playerTiles =
sprites.slice(0, PLAYER_TILES)` (`:161`). Decision 4's own original wording lists "the player sprite"
as something a starter supplies, with no RPG-only qualifier (only "party and spells" are named
RPG-specific) — so all three content starters author one, not only the RPG one.

**What every content starter does, identically**: author one small humanoid figure — the same simple
design reused across all three starters, to keep authoring cost minimal and because nothing about a
starter's own identity depends on a unique player look — as two of `PLAYER_FRAMES`'s eight frames
(idle-down and one walk frame, the identical `HERO` idiom `tools/make-rpg-sample.js` already uses),
written both into tileset 0's own sprite table at `$00-$07` (so the Tile Forge shows real art the
moment the project opens, before any build ever runs) and into `project.sprites.playerTiles` (the
canonical source `generateAssets` actually stamps from at build time). The remaining six frames stay
`null`, falling back to the build-time placeholder exactly as they would for a hand-authored project
that only ever drew two of its eight frames — a legal, unremarkable partial-coverage case, not a gap.
**As shipped, the `null` has to be explicit, not merely absent (phase 2, a product bug found in
review):** a fresh tileset's sprite table starts as 256 `BLANK_TILE` *strings*, not `null`s, so
`playerTiles.slice(0, PLAYER_TILES)` off that table would hand back 24 blank strings for the
unauthored frames rather than 24 `null`s — `generateAssets` substitutes its own build-time
placeholder only when `canonical === null` (`const replacement = canonical !== null ? canonical :
placeholderFor(i);`, `main/build/generate.js`), using any non-`null` entry verbatim otherwise, so a
blank string reads as "authored blank" and is used as-is, compiling to zero CHR bytes and leaving
the player invisible facing anything but down. `writePlayerFigure`
(`shared/starters/figures.js`) therefore builds the 32-entry array explicitly — the eight authored
tiles followed by `Array(PLAYER_TILES - 8).fill(null)` — rather than slicing it off the tileset.

**Why this needs no new reservation**: `PLAYER_TILES`'s own 32 slots are already reserved on every
tileset regardless of content (`spriteReservedRanges`, `{start: 0, end: PLAYER_TILES, label: 'the
player'}` — the range exists whether or not anything is drawn there), and `generateAssets`'s own
per-tileset player stamp (`main/build/generate.js:2180-2202`, `for (const [tilesetIndex, tileset] of
tilesets.entries())`) already re-stamps `playerTiles`'s own canonical content — real or placeholder —
into **every** tileset's own `$00-$1F` on every build, RPG battle tileset included. Authoring real
content there changes what gets stamped; it claims no new space.

**Blank entries are untouched**: `buildBlankAction`/`buildBlankRpg` still leave `playerTiles` as
`createProject`'s own default (`Array(PLAYER_TILES).fill(null)`) — §4's byte-equality guarantee would
break the instant either blank entry authored anything at all.

**What this actually looks like on screen, stated plainly rather than left implicit (round-1 finding
4's own residue): the player changes appearance depending on which way they walk.** `build_oam`
(`engine/oam.asm:6-34`) indexes `player_tiles` at `(player_dir * 2 + anim_frame) * 4` — `player_dir`
follows `DIRECTION_ORDER` (`shared/project.js:203`, `['down', 'up', 'left', 'right']`), and each
direction owns its own two frames (`PLAYER_FRAMES`'s own comment, `:167`, "4 directions x 2 walk
frames"), never shared with another direction. Authoring only the two `down` frames (slots `$00-$07`
of the 32) leaves `up`/`left`/`right` (slots `$08-$1F`) at `null`, so walking any direction but down
draws the generic build-time placeholder instead of the small authored figure — a player facing down
sees one character, and the instant they press up, left or right they see a different one. This is a
real, visible seam, not a hidden implementation detail, and it is exactly the open question below.

## §6. The IPC shape and unknown-id handling

### §6.1 `project:create`: `{ dir, name, starterId }`, replacing `{ dir, name, gameType }`

`main/ipc.js:87-95`'s handler and `main/project-io.js:234-241`'s `createProjectAt(dir, name,
gameType)` both take `gameType` today, defaulted to `'action'`. **`gameType` is replaced by
`starterId`, defaulted to `'blank-action'`** (the identical default behavior: `createProjectAt`'s own
current default `gameType = 'action'` already matches `createProject`'s own default second argument).

```js
// main/project-io.js -- as shipped (phase 1): starterId is resolved BEFORE fs.mkdir runs, a
// deliberate tightening of this snippet's own original order (below), which mkdir'd first --
// an unknown id must leave the destination directory untouched entirely, not even created.
export async function createProjectAt(dir, name, starterId = 'blank-action') {
  const starter = STARTERS.find((entry) => entry.id === starterId);
  if (!starter) throw new Error(`Unknown starter "${starterId}".`);
  await assertEmptyProjectDestination(dir); // fs.mkdir + the existing non-empty-folder refusal
  return saveProject(dir, starter.build(name));
}
```

`main/ipc.js`'s handler changes only its destructured argument name (`{ dir, name, starterId }`) —
the surrounding `try`/`catch`/`fail(error)` shape is unchanged, so an unknown id surfaces to the
renderer exactly the way "that folder already contains other files" already does: a named, readable
`toast(result.error, 'error')`, never a silent fallback to a blank project.

**Backward compatibility, checked, not assumed**: a repo-wide grep of every `.project.create(`
call site found exactly two besides `renderer/app.js`'s own — `main/smoke.js:55` and
`main/smoke.js:5071` — and neither passes `gameType` today (both rely on the current default,
`'action'`). Renaming the parameter to `starterId` with a `'blank-action'` default keeps both call
sites working completely unmodified.

**This change must ship in the same phase as the renderer's own picker rewrite, not before it —
this is round-1 finding 1, and it is real.** `renderer/app.js:427`'s current call site sends `{ dir:
picked.value, gameType }`, where `gameType` is `chooseGameType()`'s own answer (`'action'` or
`'rpg'`). If `main/ipc.js`/`createProjectAt` shipped this section's rename on its own, with the
renderer's `newProject()` left unmodified for even one released phase, the handler would destructure
`{ dir, name, starterId }` from that same call — find no `starterId` property at all (the renderer
never sent one) — and silently default to `'blank-action'`. An author who explicitly chose "Turn-based
RPG" in the still-unchanged `chooseGameType()` dialog would get a plain action project instead, with
no error and no toast, because nothing about this failure mode raises one: the call still succeeds,
it just builds the wrong thing. Neither existing `main/smoke.js` call site would catch this either,
since neither passes `gameType` and both already expect (and would still get) a plain action project.
**§12 merges what would otherwise be two phases into one** specifically to close this window: the IPC
rename and the renderer's own `newProject()` rewrite (§8.1) ship in the same commit, so there is never
a release where one side speaks `gameType` and the other expects `starterId`.

### §6.2 No unbound-pickup warning: the Key item binds to the imported actor directly

v2 bound the dungeon's Key item to an explicit `metaspriteId` with `actorId: null`, leaving the
imported `Key` pickup actor unbound and triggering `validateProject`'s own `"<actor> has behaviour
Pickup but no item names it"` warning. That trade bought nothing: `canBackItem` (`shared/project.js:
641`) is `actor.behavior === 'pickup'` alone, with no placement requirement, so an actor that is never
placed on any screen backs an item exactly as well as a placed one — the Coin item (§9.1) and the
Potion items (§9.2/§9.3) already rely on this. **Fixed (round-2 finding 8): the Key item now sets `actorId`
to the imported Key pickup's own actor id, with `metaspriteId: null`**, deriving its icon from the
backing actor the same ordinary way every other item in this design does. No warning remains, and a
starter that ships with a warning in its own build log — even a correctly-explained one — is a worse
first impression than losing the explicit-`metaspriteId` demonstration bought. §9.2 states the
resulting item literal directly.

## §7. Validation, and what a future library/schema change can break

### §7.1 Every starter must build clean

Every starter's `build(name)` output must pass `validateProject` with **zero errors**. A warning
would not fail this bar on its own, but none of the three content starters carries one today — §6.2
explains why the dungeon starter's own unbound-pickup case, which would have, no longer applies — so
test 7 (§11) holds every *content* starter to zero warnings as well, as an observed fact about this
design's own content rather than a looser rule this design needed to lean on. **As shipped (phase 2),
this zero-warnings bar excludes `blank-rpg`**: it is pinned byte-for-byte deep-equal to `createProject`
(§4), which carries a real, correctly-raised "No actor deals damage, so no battle can ever start."
warning for every fresh RPG project regardless of starter — test 7 therefore covers content starters
only, and test 1's own byte-equality check is what already holds the two blank entries to their own,
different bar. Every starter must also assemble
headlessly through `buildProject`/`inspectRom`
(`main/build/pipeline.js:16,92`) without an `nesasm` failure. This is the same bar
`design-starter-library.md §7.5`'s attribution rule holds a *library import* to, applied here to a
starter's *whole* output rather than to one import's delta, because a starter has no "before" project
to diff against — it is the whole project.

### §7.2 What breaks a starter, and the test that catches it

A starter's `build` function is not insulated from the rest of the codebase: it calls
`planLibraryImport` against `shared/library/`'s *current* entries, and it hand-authors content against
the *current* schema (`LIMITS`, `EVENT_COMMANDS`, `COLLISION_TYPES`, …). Three concrete ways a future
change could silently break a starter, and what catches each:

- **A library entry is renamed, removed, or its `name` field changes.** Every starter's own
  `build()` looks up entries by `name` (`LIBRARY_ENTRIES.find((e) => e.name === 'Skeleton')`, the
  identical lookup this design's own probes used) rather than by array position — positional lookup
  would silently import the *wrong* entry the moment `shared/library/*/index.js`'s own array order
  changes, which is exactly the kind of drift `design-starter-library.md`'s reference-rewriting
  discipline exists to prevent elsewhere. A rename or removal instead makes the lookup return
  `undefined`, and every starter's `build()` throws immediately (`if (!entry) throw new Error(...)`)
  rather than importing a wrong or partial entry. **Test 3** (§11) builds every starter in a plain
  `node:test` process and asserts no throw — a future library rename that a starter's own `build()`
  was not updated for fails this test with a clear "no such entry" message naming the missing entry,
  not a mysterious downstream capacity or validation error.
- **A schema or capacity change shrinks what a starter's fixed content fits into** — a future
  `LIMITS`/`RPG_LIMITS` tightening, a new mandatory reservation, or (least likely, but the same
  concern §5.7 of the library design already recorded once) a new `validateProject` check that
  legitimately fires against this design's own content. **Test 8** (§11) runs `checkCapacity` on
  every starter's `build()` output and asserts zero errors, the same "probed on the current tree, not
  assumed to stay true forever" discipline this whole document follows — a real regression here
  fails loudly, by name, the moment it happens, rather than surfacing as a confusing runtime failure
  the first time an author actually picks that starter.
- **A generator/engine change alters what a starter's declared feature actually does** (for example,
  a future change to how `boundTiles` interacts with collision). **The per-starter structural tests**
  (§11, tests 9-12 and 14) are the proof each starter's own claimed feature is really present and, for
  the dungeon's locked door specifically, really *effective* (test 10's reachability check, §7.2's
  own next paragraph) — they do not re-verify the *engine* honors that structure on real hardware
  timing (that is `test/lua/*` and the existing engine test suite's job), only that the starter's own
  object shape still says, and structurally implies, what this design claims it does.

No new `validateProject` rule and no engine change is proposed by this design at all (§14) — every
one of the three risks above is about *drift after this design ships*, not about anything this design
itself needs to build new checks for.

## §8. The UI

### §8.1 The picker replaces `chooseGameType()`

`renderer/app.js:386-415`'s `chooseGameType()` is deleted. `newProject()` (:417-431) is rewritten, in
the **same commit** as §6.1's IPC rename (§6.1's own closing paragraph explains why splitting these
two is unsafe):

```js
async function chooseStarter() {
  return showModal({
    title: 'New project',
    width: 460,
    body: (close) =>
      el('div', null,
        el('p.hint', { style: { marginBottom: '14px' } }, 'What kind of project?'),
        ...STARTERS.map((starter) =>
          el('button.btn', { style: {...}, onclick: () => close(starter.id) },
            el('div', { style: {...} }, starter.label),
            el('div.hint', { style: { margin: '0' } }, starter.hint)
          )
        )
      ),
    actions: [{ label: 'Cancel', value: null }]
  });
}

async function newProject() {
  const starterId = await chooseStarter();
  if (!starterId) return;
  const picked = await window.forge.project.pickNew();
  if (!picked.ok) return toast(picked.error, 'error');
  if (!picked.value) return;
  const result = await window.forge.project.create({ dir: picked.value, starterId });
  if (!result.ok) return toast(result.error, 'error');
  store.open(result.value.dir, result.value.project);
  toast('Project created', 'success');
}
```

`showModal`'s existing `null`-on-dismiss contract (Escape, backdrop click, `Cancel`) is unchanged —
declining the picker behaves exactly as declining `chooseGameType()` does today. `mapperById(
RPG_DEFAULT_MAPPER)`'s own explanatory line (`renderer/app.js:409-411`, "a turn-based RPG starts on
MMC1...") moves onto each RPG-flavored starter's own `hint` text instead of being a single fixed
footer, since there are now three RPG-or-action choices rather than one of each.

### §8.2 `main/smoke.js`: real coverage of a dialog that has none today, through a main-process seam

§0 confirmed `main/smoke.js` never drives `chooseGameType()`/the native dialog at all — every
existing "create a project" step calls `window.forge.project.create(...)` directly inside the
renderer's own JS context, bypassing both the in-page modal and the native dialog.

**v1's own proposed fix here does not work, and this is round-1 finding 3.** v1 proposed assigning
`window.forge.project.pickNew = async () => ({ ok: true, value: scratchDir })` from inside the
renderer's own JS context. `window.forge` is exposed via `contextBridge.exposeInMainWorld('forge',
{...})` (`main/preload.cjs:7`) — Electron's own documented contract for that call freezes the exposed
object graph, so an assignment onto one of its nested properties from the renderer's world either
fails silently (non-strict script) or throws (an ES module, which every renderer script here is). The
native `dialog.showSaveDialog` (`main/ipc.js:69`, confirmed this round — it is a save dialog offering
a default filename, not an open-folder picker as v1's prose loosely called it) would still open for
real, and a real OS dialog is exactly what Electron automation cannot click through.

**The fix moves the seam into main, where `main/smoke.js` already runs.** `main/main.js:227` awaits
`runSmoke(mainWindow)` from inside `app.whenReady()`, in the main process — `main/smoke.js` is not
renderer code that happens to be driven remotely, it *is* main-process code, with the same access to
`main/ipc.js`'s own module scope any other main-process file has. `main/smoke.js:10` already imports
`unsavedChanges` from `./ipc.js` today, for the same reason: a small, purpose-built export is how this
codebase already lets `main/smoke.js` observe or steer main-process state it has no IPC channel for.
**Recommendation**: add one more such export.

```js
// main/ipc.js
let smokeNewProjectPath = null;

/** FORGE_SMOKE-only: the next dialog:newProject call returns this path instead
 *  of opening the real save dialog. One-shot, so an unrelated later "New
 *  project" click (if a scenario ever makes one) still hits the real dialog
 *  guard rather than silently reusing a stale scratch path. */
export function setSmokeNewProjectPath(path) {
  if (!process.env.FORGE_SMOKE) throw new Error('setSmokeNewProjectPath is only for FORGE_SMOKE runs');
  smokeNewProjectPath = path;
}

ipcMain.handle('dialog:newProject', async () => {
  if (process.env.FORGE_SMOKE && smokeNewProjectPath) {
    const path = smokeNewProjectPath;
    smokeNewProjectPath = null;
    return ok(path);
  }
  const result = await dialog.showSaveDialog(window(), { /* unchanged */ });
  return result.canceled ? ok(null) : ok(result.filePath);
});
```

`main/smoke.js` calls `setSmokeNewProjectPath(scratchDir)` directly (an ordinary function call in the
same process, no `executeJavaScript` needed for this part), then drives the renderer for real through
`window.webContents.executeJavaScript(...)` (the mechanism every existing `main/smoke.js` step already
uses, e.g. `:9206, :9434, :9484`) to click the real "New project" button
(`el('button.btn.btn-accent', { onclick: newProject }, 'New project')`, `renderer/app.js:357`), see
the real picker render, and click a specific starter's own button. `pickNew()`'s own IPC round trip
then runs for real and returns the stubbed path with no dialog ever opening. This needs no product
code beyond the one new export above — everything else in the click-through is already real.

**§11's tests 16a-16d are what this seam is for, one per phase (round-1 finding 3's own "split test 14"
instruction) rather than one monolithic step written against a catalog that does not exist yet.**

### §8.3 No palette or tileset picker step for a starter

Unlike `design-starter-library.md §10`'s own per-import palette-candidate picker, a starter's own
`build()` runs `planLibraryImport` with no `options.paletteSlot`/`options.paletteSlots` at all,
relying on `suggestedPaletteSlot`'s own deterministic exact-match/unused/nearest-slot chain
(`design-starter-library.md §7.2`) — there is no picker step here at all, because there is no author
choice to make: a starter is one deterministic function call, and `New Project` never shows an
intermediate dialog for it. §9 states each starter's own resulting palette slots explicitly, and
**test 15** (§11) pins the whole table, measured fresh against this working tree (§0's probe, not
copied from any prior figure — finding 16).

## §9. Each starter's concrete content

Every screen below is `LIMITS.screenCols × LIMITS.screenRows` (16×15 metatiles, 256×240px) built with
`screenFromArt` (§3.3) the way every `tools/make-*-sample.js` generator already builds its own
screens. Every import below is `planLibraryImport(project, entry, options)`, applied via
`applyPlannedProject`, in the fixed order listed — order matters for palette-adoption (§7.2/§7.4 of
`design-starter-library.md`), which is deterministic and already tested, so listing an explicit order
here is what makes each starter's own palette outcome reproducible and testable (test 15, §11).

**None of the open-terrain, no-border screens below (Greenwood, the Village, the Field — each its own
1×1 map) needs a wall to keep the player from walking off its own edge (round-4 finding 3, checked
this round): `flattenScreens`'s own neighbour computation (`main/build/generate.js:1557-1565`) resolves
every direction from a `gridW: 1, gridH: 1` screen's single (col 0, row 0) cell to `0xff` (`NO_SCREEN`,
`at(c, r)` returning it whenever `c < 0 || r < 0 || c >= map.gridW || r >= map.gridH`) in all four
directions at once, and `cross_left`/`cross_right`/`cross_up`/`cross_down`
(`engine/player.asm:268-309`) each compare their own screen's neighbour byte against `NO_SCREEN` and,
on a match, `cross_none: rts` — leaving `player_x`/`player_y` exactly as they were, since the calling
`move_*` routine (`engine/player.asm:130-137` for `move_right`, the identical shape for the other
three) jumps to its own `cross_*` *before* ever writing a new position, only once the candidate move
would cross the edge at all. The player is simply stopped there, the same as at a solid metatile,
with no wall art, no metatile, and no engine change required — this design's starters do not need to
do anything about it.**

### §9.1 Overworld adventure (`overworld`, action, NROM)

**Mapper**: NROM (`defaultMapperFor('action')`, `shared/cartridge.js:391`) — the same reasoning
`sample/` itself already relies on: no battery, no PRG/CHR switching, and nothing in this starter's
own feature list needs either.

**Library imports, in order, with their measured palette outcomes** (re-probed this round against a
fresh `createProject('...', 'action')`, and re-verified through `planLibraryImport`'s own returned
`report`, not inferred from colour-matching — round-2 finding 6): `Grass Plains` (terrain, background slot 1,
**written fresh**), `Dirt Path` (terrain, background slot 1, **adopted** — the slot Grass Plains just
wrote is no longer `unused`, so `finishPaletteResolution` adopts it as-is rather than writing again,
regardless of whether Dirt Path's own declared colours happen to match), `Wood Planks` (terrain,
background slot 2, **written fresh**), `Bat` (monster, sprite slot 1, **written fresh**), `Coin`
(pickup, sprite slot 2, **written fresh**).

**No behavior override needed for the Bat.** `planActorImport` already assigns `behavior: isPickup ?
'pickup' : 'patroller'` to every imported actor (`shared/project.js:7293`) — a monster entry imports
as a real, already-wandering `patroller` with no further authoring needed (v1 incorrectly described
this as something the starter's own `build()` had to set by hand; round-1 finding 9).

**The player**: the shared authored figure (§5), tiles `$00-$07` of tileset 0's sprite table and
`project.sprites.playerTiles[0..7]`.

**A hand-authored Villager metasprite, reusing the player's own tiles on a distinct palette — not the
Bat's animation (round-2 finding 9).** v2 gave both the trader and the Cottage NPC the Bat's own imported
animation, which means the talking townsfolk and the biting hazard are visually identical — a new
player has no way to tell them apart on sight. Fix: one metasprite, `metasprite(newId, 'Villager', 0,
3)` (`shared/library/authoring.js`'s own four-tile helper — `firstTile: 0`, reusing the same player
tiles `$00-$03` §5 already authors, at zero extra tile cost) on **sprite palette 3** — the one sprite
slot this starter's own imports leave unclaimed (palette 0 is the player's own permanently-reserved
hardware slot; Bat's import wrote slot 1; Coin's import wrote slot 2) — written with the Villager's
own simple, distinct colours. One animation (`{ loop: true, frames: [{ metaspriteId: newId, duration:
30 }] }`) wraps it for `anims.idle`. Both NPCs below use this same actor art — recognizably human,
recognizably not the Bat, and distinct from the player's own on-screen tint.

**As shipped (phase 2), `firstTile: 0` is not legal, and the Villager gets its own tile copy instead —
this is round-1 finding 4's own residue, not a mechanism this design got to keep.** Pointing a
metasprite at any tile inside the player's own reserved `$00-$1F` — including the exact `$00-$03`
this section recommends — trips `validateProject`'s reserved-tile-reference warning (ROADMAP item 8's
own "validate-as-you-draw" check, CLAUDE.md), which then fails test 7's zero-warnings bar. The shipped
fix is a second, identical copy of the idle art (`HERO_IDLE_TILES`, `shared/starters/figures.js`)
written into its own free four-tile run instead — a real, if small, tile cost this section did not
budget for. Probed against the shipped build: that run is **`$28-$2B` (40-43)**, immediately after
Bat (`$20-$23`) and Coin (`$24-$27`) — which is the index this section's own next paragraph names for
the Doorway; see that paragraph's own "as shipped" correction for where the Doorway actually lands.

**A hand-authored Doorway metasprite, shared by every door in all three starters — not the Villager's
own animation either (round-3 finding 5).** v3 gave the Overworld's own door the Villager's animation
(a door that looks like a person to talk to) and the dungeon's doors the Key's animation (a door that
looks like the very key the player is hunting for) — neither reads as "a way through." `tools/
make-sample.js`'s own `Portal` gets away with reusing its Gem's shine because a sparkle plausibly
reads as a portal; neither a person nor a key plausibly reads as a doorway. **Fix: one small,
hand-authored Doorway metasprite — a plain dark archway, four tiles, no new pixel content beyond
that** — authored once, under `shared/starters/`, and used by every `Door` actor in every starter.
Each starter writes the identical four tiles into its own tileset 0 at the first free sprite index
after that starter's own library imports (re-probed this round, not assumed): ~~**Overworld:
`$28-$2B` (40-43)**, after Bat (`$20-$23`) and Coin (`$24-$27`)~~ — **as shipped, `$2C-$2F` (44-47)**:
the Villager's own now-real tile cost (above) occupies `$28-$2B` first, pushing the Doorway one run
later than this section originally planned; **Dungeon: `$30-$33` (48-51)**, after Skeleton,
Bat, Key and Potion (`$20-$2F`, four four-tile imports); **RPG: `$2C-$2F` (44-47)**, after Slime, Bat
and Potion (`$20-$2B`) — none collides with another import (each starter's own imports already end
exactly where the Doorway begins) or with the player's own reserved `$00-$1F` (`spriteReservedRanges`
excludes every import from that range already, §5). **Palette: sprite slot 2 in every starter, reused
rather than claimed** — the slot each starter's own last pickup import (Coin/Potion/Potion) already
wrote, not a new slot: Overworld already spends its one free slot (3) on the Villager, so a *fifth*
distinct sprite palette does not exist to give the Doorway there, and reusing an already-written slot
elsewhere needs no new colours and no change to test 15 (§11) at all, since that test pins only
`planLibraryImport`'s own outcomes and this, like the Villager, is hand-authored — never becomes a
"written"/"adopted" report entry for it to track. One metasprite and one wrapping animation per
starter (`metasprite(newId, 'Doorway', <that starter's own first-free-index>, 2)`), and every `Door`
actor's `anims.idle` below points at it.

**Maps and screens (3 maps, 3 screens), every placement's own coordinates given explicitly (round-3
finding 6 — the arrival-safety test, test 17 §11, needs every placement's real position to check
against, not only doors)**:

| actor | screen | at (x, y) |
|---|---|---|
| player start | Greenwood | `48, 192` |
| Bat | Greenwood | `96, 80` |
| trader NPC (Villager) | Greenwood | `160, 96` |
| Door (Doorway) → Cottage | Greenwood | `224, 48`, `toX: 32, toY: 176` |
| Cottage NPC (Villager) | Cottage | `128, 96` |
| Door (Doorway) → Greenwood | Cottage | `32, 48`, `toX: 64, toY: 176` |

- **"Greenwood"** (1 screen) — the start map and screen. Grass Plains/Dirt Path terrain forms a
  clearing with a path leading to a door. Entities: the imported Bat (already `patroller`, contact
  damage 1, its own `damage` field per the library entry). A trader NPC (`behavior: 'npc'`, the
  Villager metasprite) with `trigger: 'interact'` and an event: ~~a `choice` ("Which way did the old
  bridge go?" / two answers, each ending in a `say`)~~ — **as shipped, `choice` has no prompt field of
  its own** (`EVENT_COMMANDS`, `shared/project.js`), so the question is a plain `say` ("Which way did
  the old bridge go?") immediately followed by the `choice` itself, its two answers each ending in
  their own `say` — this starter's own "a choice." A `Door` actor
  (`behavior: 'door'`, the Doorway metasprite above) targeting the Cottage, `props.trigger: 'touch'`
  (round-2 finding 1 — every door placement in this design names an explicit landing point, since
  `normalizeEntity`'s own default, `112,112`, is not guaranteed safe in every room and this design no
  longer leaves it to chance anywhere).
- **"Cottage"** (1 screen) — an interior room. `Wood Planks` terrain for the floor. Entities: an NPC
  (`behavior: 'npc'`, the Villager metasprite) whose event is guarded the same way `tools/make-
  sample.js`'s own Chest is (`cond: { type: 'switchOff', arg: 0 }` → `say` + `give` (the Coin item,
  below) + `setSwitch` — this starter's own "a switch-guarded page," page 1, with an unguarded `say`
  on page 2 for "already given") — and a `Door` (Doorway metasprite) back to Greenwood.
- **"Title"** (1 screen) — a plain title screen, `project.project.titleMap`/`titleScreen` set to it,
  the same `tools/make-mmc1-sample.js:218-228` idiom.

**Items**: `project.items = [{ id: 0, name: 'Coin', actorId: <imported Coin's actor id>, metaspriteId:
null }]` — a real, `canBackItem`-backed item, so the Coin's own icon comes from its backing actor.
**The imported Coin actor itself is never placed on any screen** — the Cottage NPC's `give` command
hands the item out directly, exactly as `tools/make-sample.js`'s Chest hands out its Gem without the
Gem's own pickup actor standing anywhere near the chest. No explicit `effect` override is needed: the
Coin's own `battle.heal` is `0`, so `deriveItemEffect` (`shared/project.js:4940-4944`) resolves it to
`{ kind: 'none', amount: 0 }` on its own the moment `saveProject` normalizes the built project
(`main/project-io.js:39`) — the correct answer for a plain collectible either way.

**What the player can do in the first minute**: spawn in Greenwood, see a patrolling Bat and a
standing NPC, either dodge the Bat or take its one point of contact damage, ask the trader a question
and see two different follow-up lines depending on the answer chosen, walk through the door into the
Cottage, talk to the second NPC once to receive the Coin (and again to hear that the room is now
empty).

**Engine features demonstrated**: a Say (both NPCs), a choice (the trader), a door (Greenwood ↔
Cottage), a pickup-backed item granted through Give rather than a placed pickup actor, a
switch-guarded page (the Cottage NPC), contact damage from a placed monster actor (the Bat), imported
terrain, an authored player sprite, and a title screen.

### §9.2 Dungeon crawl (`dungeon`, action, NROM)

**Mapper**: NROM — the same reasoning as §9.1.

**Library imports, in order, with their measured palette outcomes** (re-probed fresh this round,
through `planLibraryImport`'s own `report.palette(s).written` — round-2 finding 6): `Stone Floor` (terrain,
background slot 1, **written fresh**), `Skeleton` (monster, sprite slot 1, **written fresh**), `Bat`
(monster, sprite slot 1, **adopted** — the slot Skeleton just wrote), `Key` (pickup, sprite slot 2,
**written fresh** — imported **only for its art**, per this starter's own key mechanism below),
`Potion` (pickup, sprite slot 2, **adopted** — the slot Key just wrote).

**Skeleton is deliberately overridden to `behavior: 'chaser'`** — `planActorImport` imports it as
`patroller` by default (`shared/project.js:7293`, the same default every monster entry gets), and
this starter's own `build()` changes it to `chaser` after the import for its one deliberate reason: a
boss that hunts the player reads as a real threat in the room it is finally reached in, which a
wandering `patroller` would not (round-1 finding 9 — an override is fine and worth keeping exactly where a
starter genuinely wants different behavior from the import's own default; the mistake v1 made was
claiming an override was *necessary* everywhere, including places, like the Bat above, where it is
not).

**The player**: the shared authored figure (§5) — the identical tile content the Overworld starter
authors, written the same way into this starter's own tileset 0 and `playerTiles`.

**A hand-authored Wall metatile, not from the library, on the same background palette Stone Floor
already claimed**: `shared/library/terrain/*` has no `collision: 'solid'` metatile at all (confirmed
by reading all five entries) — every library terrain entry is `open` or `water`, because a
locked-door puzzle is not "terrain," it is this starter's own mechanism. Stone Floor's own import
claims metatile id 1 ("Stone Floor Plain," `palette: 1`, `tiles: [1,1,1,1]`) and id 2 ("Stone Floor
Edge," `palette: 1`) — both re-probed this round, not assumed. A new `Wall` metatile is written
directly into the next free slot (id 3): `{ name: 'Wall', tiles: [6,6,6,6], palette: 1, collision:
'solid' }` — a small, simple brick-pattern tile authored at background index 6 (the first index past
Stone Floor's own five imported tiles), on **the identical palette slot (1) Stone Floor's own import
already claimed**. This is not cosmetic: `validateProject` (`shared/project.js:5760-5776`) refuses a
switch-bound substitute whose palette differs from what is currently painted at that cell (`"the
switch-bound substitute uses a different palette group than what is painted there. Repaint the cell
or choose a same-palette substitute."`) — the Wall and its own open substitute (Stone Floor Plain
itself, reused directly rather than authoring a third, redundant "floor" metatile) must share a
palette for the swap to be legal at all, not merely for it to look right.

**The Entrance room's own geometry — a real barrier, not a single blocked cell (round-1 finding 5).** v1's own
design placed one solid metatile with a door "just past it," which `move_vertical_probe`
(`engine/player.asm:206-222`) — probing only the two exact points at the player's leading body edge —
cannot enforce as a barrier at all: any adjacent open cell lets the player walk around it entirely,
and `entity_door` (`engine/entities.asm:388-399`) warps on contact with **no switch check of any
kind** regardless. The fix is a full wall spanning the room, with the bound cell as its only gap:

```
row 0:      WWWWWWWWWWWWWWWW
rows 1-6:   W..............W   (six identical rows -- the front area; player starts here)
row 7:      WWWWWWWW.WWWWWWW   (the locked wall -- one gap, at col 8)
rows 8-13:  W..............W   (six identical rows -- the back area; unreachable while row 7 is solid)
row 14:     WWWWWWWWWWWWWWWW
```

`W` is the `Wall` metatile (id 3); `.` is `Stone Floor Plain` (id 1). Row 7's own col-8 cell carries a
`boundTiles` entry: `{ switchId: 0, row: 7, col: 8, metatileId: 1 }` — while switch 0 is off, that
cell is `Wall` (`screen.metatiles[7 * 16 + 8] = 3`), the *only* stored base value at that cell; once
switch 0 is set, `bound_tile_lookup` (`engine/screens.asm:51,71,173`, read on the collision path via
`probe_type`, not only the draw path — `engine/player.asm:236-254`) resolves it to `Stone Floor Plain`
instead, live.

**Coordinates, all of them, given explicitly this round — round-2 finding 1 is why.** v2 named no `toX`/`toY`
for any door in any starter. `normalizeEntity` (`shared/project.js:4510-4511`) defaults both to `112`
when they are absent — row 7, column 7 on this exact screen, **inside the locked wall itself** — and
the headless path `checkCapacity`/`generateAssets` take on an object that skipped normalization
defaults them to `0, 0` instead (`main/build/generate.js:2955-2956`, `entity.props?.toX ?? 0`), which
is inside the *top border* wall. Either default is a spawn point embedded in solid geometry, and
`move_down_inside`'s own candidate-only probe (`engine/player.asm:198-202`, §0.2) never re-checks the
player's *current* cell for solidity — only the cell a move is heading toward — so a player spawned
inside the wall can simply walk out of it in whichever direction happens to be open, including
straight into the area the wall exists to block. Every door placement in this design now states real
numbers:

| actor | screen | placed at (x, y) | `toScreen` | `toX, toY` |
|---|---|---|---|---|
| Door (Key Hall) | Dungeon Entrance | `208, 48` (row 3, col 13 — front area) | Key Hall | `32, 112` |
| Door (Entrance) | Key Hall | `32, 96` (row 6, col 2) | Dungeon Entrance | `208, 80` (row 5, col 13 — front area, clear of the Key Hall door's own resting spot) |
| Door (Boss Chamber) | Dungeon Entrance | `128, 160` (row 10, col 8 — **two full metatiles inside the back area**, not row 8; see the touch-range paragraph below) | Boss Chamber | `128, 112` |
| Skeleton | Boss Chamber | `128, 192` | — | — |
| Potion | Boss Chamber | `128, 64` | — | — |
| Door (Dungeon Entrance) | Boss Chamber | `192, 64` | Dungeon Entrance | `192, 176` (row 11, col 12 — back area, clear of the Boss Chamber door's own resting spot) |
| key mechanism | Key Hall | `128, 112` | — | — |
| Bat | Key Hall | `16, 48` (as shipped — this design's own import list names the Bat but its placement table never placed it; see the note below the table) | — | — |

**As shipped (phase 3), the Bat gets a placement this section never gave it.** §9.2's own import list
(below) names the Bat, but no version of this table before v6 placed it anywhere — a gap, not a
deliberate omission. The shipped fix places one Bat patrolling Key Hall's leftmost interior column,
`(16, 48)`: a `patroller` always spawns facing down and only ever steps along its current axis,
reversing at a wall, so it patrols straight up and down column x=16 for as long as the screen is
loaded — 16 pixels clear, on the x axis alone, of the key mechanism's own touch line (`x = 32..128,
y = 112`, the walk smoke step 16c drives), which is already `>= TOUCH_RANGE` (12) regardless of the
Bat's own y at any given frame.

The Entrance's own player start is `(32, 48)` (row 3, col 2, the front area). Every `Door` placement
in every screen above uses **the shared Doorway metasprite (§9.1)** — a plain dark archway, not the
Key's own imported animation v3 gave it, which made the front door, the boss door and the one real key
in Key Hall all look like the same key-shaped object (round-3 finding 5). `tools/make-sample.js`'s own
`Portal` gets away with reusing its Gem's shine because a sparkle plausibly reads as a portal; a key
does not, and (§9.1) neither does a person, which is what v3's Overworld door showed instead.

**The boss door sits well inside the back area, not in the wall's own gap — round-2 finding 7 corrects a real
self-contradiction in v2, which placed it both "in the back area, past the gap" and "exactly in the
wall's gap" in the same paragraph.** A door fires on `entity_touching_player`
(`engine/entities.asm:452-478`), an independent proximity box on raw pixel coordinates — `|ent_x -
player_x| < TOUCH_RANGE` and `|ent_y - player_y| < TOUCH_RANGE` (`engine/constants.asm:782`,
`TOUCH_RANGE = 12`), both true — with **no regard for collision or line of sight**; a door standing in
or immediately behind a wall could in principle be touched from the open side if the two points ever
came within 12 pixels on both axes; row 7's own 16-pixel thickness already puts the smallest possible
gap between the front area's deepest reachable point (row 6, `y` up to `111`) and anything in row 8
(`y` from `128`) at 17 pixels — over `TOUCH_RANGE` on the `y` axis alone, regardless of `x` — so even a
door at row 8 would already be safe by this measure, but the design places it two full rows deeper
(row 10, `y = 160`, a 49-pixel margin) rather than resting on a five-pixel margin that a future
coordinate tweak could accidentally shrink. Test 10 (§11) checks this arithmetic directly rather than
trusting the placement by inspection.

**The key mechanism — an `npc`, not a `pickup`, for the reasons the engine actually enforces (round-1
finding 7 corrects v1's own wrong reasoning here).** A `pickup`-behaved placement's entity record
genuinely does carry its own `ent_event`/`ent_trigger` bytes, loaded independently of `ent_to_scr`
(`engine/entities.asm:47-48` vs. `:56-60`), and `main/build/textcompile.js`'s own per-entity loop
(`:541`) compiles `entity.props?.event` for **every** placement regardless of behavior — so "no event
slot" is not the reason. The real reasons are two, both structural: first, `availableTriggers`
(`shared/project.js:717-721`) excludes `touch` for any `pickup`-behaved actor's own stored trigger
outright; second, `entity_pickup` (`engine/entities.asm:369-383`) is the fixed routine
`update_entities` dispatches to for any pickup-behaved actor — it deactivates the entity and calls
`add_item` unconditionally, never reading `ent_event`/`ent_trigger` at all. The established idiom for
"a pickup with a side effect" is an `npc`-behaved actor with a `touch` trigger instead — exactly
`tools/make-mmc1-sample.js`'s own `Saver`.

**The guard this round restores, and why v2's own removal of it was wrong (round-2 finding 2 — the most
consequential fix in this round after the door coordinates).** v2 dropped the `switchOff` guard on the
give page, reasoning that `hideSwitch` alone would make the page unreachable after one visit.
**`hideSwitch` is read only once, inside `spawn_entities`, at the moment a screen's entities are placed
from its own record table (`engine/entities.asm:36-69`, the check at `:62-67`) — never consulted again
until the next time that happens.** `setSwitch`'s own opcode, `script_op_set`
(`engine/script.asm:312-320`), calls `switch_set` and touches no entity state at all.
**`test/unit/script.test.js:433`**'s own test title states the timing directly: `'an actor hidden by a
switch is gone the **next time the screen loads**'` — not the instant the switch is set. An unguarded
page relying on `hideSwitch` alone would therefore still be standing there, still touchable, for as
long as the player stays on the Key Hall screen — a second touch reruns the page, hands out a second
Key, and sets the same switch again (harmless to the switch, not harmless to the bag). **Fixed**: the
give page is guarded again (`cond: { type: 'switchOff', arg: 0 }`), so a second touch within the same
visit runs nothing at all — `hideSwitch: 0` is kept, for the *next* visit (leave Key Hall and come
back: the mechanism is gone for good, matching `tools/make-sample.js`'s own Wanderer (`:357-375`), the
identical "gone after one interaction, across a reload" shape). **What a same-visit second touch shows,
decided explicitly rather than left silent**: a second, unguarded page, `cond: { type: 'none', arg: 0
}` → `say: "Just an empty pedestal now."` — the identical two-page shape `tools/make-sample.js`'s own
Chest already uses for the identical guarded-give-then-fallback shape, restored here for the identical
reason: a silently unresponsive sprite standing in plain sight reads as broken, and this codebase's own
precedent already answers the same-visit re-touch question with a one-line `say`, not silence. **A
`{ op: 'visible', state: 'hidden' }` command targeting the actor itself is added to the give page
too** (`OP_VISIBLE`, self only, `engine/script.asm:608-629` — hides the actor from `draw_entities`
alone, "AI, contact and interaction never look at it," so it stays fully touchable; the `switchOff`
guard above, not this command, is what actually prevents a second grant) so the key's own sprite
disappears the instant it is taken rather than lingering, visible, through the remainder of the same
visit — `hideSwitch` is what makes that disappearance permanent across a reload; `visible: 'hidden'`
is what makes it immediate within the one it happens on. **The state is the string `'hidden'`, not a
boolean (round-3 finding 3)**: `VISIBLE_STATES` (`shared/project.js:1060-1063`) is `['hidden',
'shown']`, and both `normalizeEffect` (`shared/project.js:4139`) and `textcompile.js`'s own `'visible'`
case (`:304-306`) resolve an unrecognised `state` to `VISIBLE_STATES[0].id` — `'hidden'` — by falling
back to index 0, not by reading `false` as a meaningful value; a literal `false` would have compiled
to the intended byte only by that fallback's own coincidence, not because the command means anything
by it. Writing `'hidden'` directly is what actually round-trips through normalization unchanged. The
key mechanism's full record: a hand-authored `npc` actor whose `anims.idle` points at the **imported
Key pickup's own animation id**, `hideSwitch: 0`, placed in Key Hall (above) with `trigger: 'touch'`,
two pages — `switchOff(0)` → `say` + `give` (the Key item, below) + `setSwitch(0)` + `visible:
'hidden'` (self); unconditional → `say`. **This is the
starter's own "a door locked behind a switch that a key pickup sets,"** and test 10 (§11) now also
asserts the give page's own `setSwitch` operand equals the boundTiles entry's own `switchId` — both
`0` here, but a test that flips switch 0 directly (as v2's own test 10 did) proves nothing about
whether the *key* is what sets it, only that *something* named switch 0 does; the structural check
closes that gap (round-2 finding 3). The imported `Key` pickup actor itself is never placed on any screen —
only its art is reused, and (round-2 finding 8) it is now bound to the Key item below anyway, so no unbound-
pickup warning results (§6.2).

**Key Hall's own room**: a small bordered space — the identical border convention the Entrance uses
(`Wall` on the outer ring, `Stone Floor Plain` filling the interior), rows/cols 0 and 14/15 solid,
1-13/1-14 open. The key mechanism sits at `(128, 112)` (row 7, col 8 — an arbitrary interior cell; no
locked-door geometry applies inside this room). The `Door` back to the Entrance sits at `(32, 96)`
(above).

**Boss Chamber is not a dead end, and the fight is winnable with nothing this design has to add
(round-3 finding 7).** v3 gave the Skeleton `behavior: 'chaser'` and no way out of the room, which
reads as a trap rather than a boss fight — a `chaser` that always closes the distance, in a room with
no exit, is a fair fight only if the player can actually end it. **The Attack action already does
that, unconditionally, with no authoring by this starter at all**: `defaultInput()`
(`shared/project.js:3715-3734`) binds `gameplay.A = 'attack'` in every project, blank or content
starter alike, and `do_attack` (`engine/input.asm:202-…`) damages the nearest non-pickup actor within
`entity_in_reach` — the Skeleton's own `hp: 8` (`shared/library/monster/skeleton.js`) is an ordinary,
beatable number under the same contact-damage/attack loop `sample/`'s own Bramble already uses. This
starter changes nothing about combat; it only needed to say so, since a boss room with a chaser and no
stated way to fight back reads as broken even when it is not. **A return door is still worth adding,
for the player who wants to leave rather than fight** — a bordered same-shape room the identical
Skeleton fight is undefeated in should not also trap a player who came to look and decided not to
stay. `Door` (Doorway metasprite) at `(192, 64)`, `props.toScreen`: Dungeon Entrance, `props.toX: 192,
props.toY: 176` — landing in the Entrance's own back area, clear of the Boss Chamber door's own
resting spot (`128, 160`) on both axes (§11 test 17 checks this the same way it checks every other
door in this design).

**Items**: two `canBackItem`-backed pickups, one never placed and one genuinely placed — `{ id: 0,
name: 'Key', actorId: <the imported Key pickup's own actor id>, metaspriteId: null, effect: { kind:
'none', amount: 0 } }` (a key item, `kind: 'none'` — CLAUDE.md's own "an item's own effect...
`none`... a key item" line; bound the same ordinary way the Coin item is in §9.1 rather than through
an explicit `metaspriteId` with no backing actor, which is what left the unbound-pickup warning v2
carried — see §6.2); `{ id: 1, name: 'Potion', actorId: <the imported Potion's own actor id>,
metaspriteId: null, effect: { kind: 'heal', amount: 20 } }` (placed for real — the boss-room reward).
**The `20` is not a guess and not left to migration (finding 15):** the imported Potion library entry
declares `battle: { ..., heal: 20 }` (`shared/library/pickup/potion.js:48-51`), and `saveProject`
normalizes every project handed to it as its very first step (`main/project-io.js:39`) — so
`deriveItemEffect` (`shared/project.js:4940-4944`) would derive this exact value automatically with no
`effect` field at all. The starter sets it explicitly anyway, so a reader of the generator's own
source sees the real number without also having to know the migration's own derivation rule.

**Maps and screens (4 maps, 4 screens, `folder` exercised)**: "Dungeon Entrance" (1 screen, start map,
the locked door + threshold, above), "Key Hall" (1 screen, above), "Boss Chamber" (1 screen, bordered
the same way, the Skeleton at `(128, 192)`, the Potion reward at `(128, 64)`, and a return door to the
Entrance's own back area, above), all three `folder: 'Dungeon'` —
**`sample/` never sets `map.folder` at all** (confirmed: no existing generator writes a non-null
`folder`), so this is a real, novel exercise of item 7's own grouping field, on three genuinely
separate 1×1 maps linked only by door actors rather than one larger grid a player could otherwise
cross by walking off an edge — the literal "interior single-screen rooms linked by doors" decision 2
names. "Title" (1 screen, `folder: null`) — **as shipped, plain Stone Floor Plain, no border and no
entities**, the simplest legal screen this design needed nothing more elaborate for.

**What the player can do in the first minute**: spawn in the Dungeon Entrance's front area, take the
unlocked door into Key Hall, where the key mechanism can be touched to receive the Key, hear the wall
click open, and see the mechanism itself vanish immediately (and, permanently, on a later visit);
walking back into the Entrance lands safely in the front area, the row-7 gap is now open, and crossing
it reaches the Boss Chamber door in the back area, where the chasing Skeleton and the Potion reward
wait — fought with the same Attack button every project already binds by default, or avoided
altogether through the Boss Chamber's own return door back to the Entrance.

**Engine features demonstrated**: four door placements, each with a real, safe landing point (two
linking Entrance↔Key Hall, one Entrance→Boss Chamber, one Boss Chamber→Entrance), a pickup that
grants an item (the Potion, placed and genuinely `canBackItem`), a switch-guarded page (the key
mechanism, now genuinely guarded), an immediate self-hide via the `visible` command, a genuinely
effective locked door (the wall/threshold pair, proven reachable/unreachable — and unreachable-by-touch
— by test 10, §11), an item bound to an actor that is never placed (the Key), multiple maps and
`map.folder` grouping (item 7), a boss encounter the player can actually win or walk away from (the
Skeleton, overridden to `chaser`, beaten with the default-bound Attack action), an authored player
sprite, a shared Doorway metasprite, and a title screen. No Save (NROM has none — `saveCapable`,
`shared/cartridge.js:299-301`, is false for mapper 0) and no choice (left to the overworld starter).

### §9.3 Turn-based RPG (`rpg`, MMC1)

**Mapper**: MMC1 (`RPG_DEFAULT_MAPPER`, `shared/cartridge.js:257`) — the only reason this starter can
demonstrate Save at all (`saveCapable` is true for MMC1, false for NROM).

**Library imports, in order, with their measured palette outcomes** (re-probed fresh this round, on a
fresh `createProject('...', 'rpg')` with `cartridge.mapper` set to 1, through `planLibraryImport`'s
own returned `report.palette(s).written` — round-2 finding 6; a fresh RPG project's own background slot 1 is
already reserved for battle scenery, so the *first* terrain import lands on slot 2, not 1): `Grass
Plains` (terrain, background slot 2, **written fresh** — the reserved slot 1 skipped entirely, per
`reservedPaletteSlots`' own RPG-only reservation), `Dirt Path` (terrain, background slot 2,
**adopted**), `Stone Floor` (terrain, background slot 3, **written fresh**), `Slime` (monster, sprite
slot 1, **written fresh**), `Bat` (monster, sprite slot 1, **adopted**), `Potion` (pickup, sprite slot
2, **written fresh**). Both monsters keep `battle.battleTile: null` — no block-art tileset painting
needed at all, since a `null` battleTile falls back to drawing the battle screen's monster as its own
animation sprite.

**Battle rendering needs real sprite content in tileset 1, not tileset 0 — this is round-1 finding 2, and it
is the single most consequential fix in this round.** `planActorImport` writes an imported actor's own
sprite tiles into `options.tilesetId ?? 0` (`shared/project.js:7132-7133`) — tileset 0 ("Main") unless
told otherwise, and this starter's own imports above never pass `options.tilesetId` at all. Battle
rendering switches the whole CHR bank to `BATTLE_TILESET` before drawing anything
(`engine/battle.asm:261`, `lda #BATTLE_TILESET / jsr switch_chr_bank`) and draws a sprite-fallback
monster's own art out of *that* bank (`engine/battleui.asm:845-852`, `mon_tile,y` compared against
`$FF` before `draw_metasprite` runs) — so Slime and Bat's own imported tiles, sitting only in tileset
0, would be reading whatever tileset 1 happens to hold at those same indices during a real fight,
which is nothing this starter ever wrote there. **Fix, matching `tools/make-rpg-sample.js:166-171`'s
own idiom exactly**: after every terrain and actor import above, and after the player sprite (below)
is authored into tileset 0, copy tileset 0's entire sprite table into tileset 1's:
`project.tilesets[1].sprites.tiles = project.tilesets[0].sprites.tiles.slice()`. One copy, done last,
mirrors Slime, Bat, Potion and the player's own art into the Battle tileset in a single step — the
same blanket `.slice()` copy `tools/make-rpg-sample.js:170` already performs for its own field
tileset. (Background art is not copied: neither monster declares block art, so nothing this starter's
battles draw ever reads tileset 1's background table — `map.battleSkyTile`/`battleGroundTile` stay at
`createMap`'s own default `0`, `BLANK_TILE`, a plain backdrop.)

**Every party member needs a real `metaspriteId`, or it is skipped outright — the other half of
round-1 finding 2.** `createPartyMember`'s own default is `metaspriteId: null` (`shared/project.js:3751`), and
`battle_sprite_pc` (`engine/battleui.asm:818-843`) tests `pc_metasprite,x` against `$FF` and **skips
the whole slot** — never calling `draw_metasprite` at all — the instant that comparison is true
(`:823-825`). A starting party of one member with the schema's own default would therefore be
genuinely invisible in every battle. **Fix**: build one metasprite from the player's own authored art
(§5) — `metasprite(newId, 'Hero', 0, 0)` (`shared/library/authoring.js`'s own four-tile helper,
`firstTile: 0`, `palette: 0` — sprite palette 0, the same hardware slot the field player's own OAM
attribute is permanently hardcoded to, so the battle portrait matches the field sprite's own colours)
— pushed once, after the tileset-1 copy above (so its own referenced tiles `0-3` are already mirrored
there too, though `generateAssets`'s own per-tileset player stamp, `main/build/generate.js:2180-2202`,
would keep them correct regardless of copy order, since it re-stamps every tileset's own `$00-$1F`
from `playerTiles` on every build). Hero's own party record gets `metaspriteId: <that id>`. Ally
(below) **reuses the identical metaspriteId** — the same choice `tools/make-rpg-sample.js:281,284`
already makes for its own Rian and Iris, both `metaspriteId: 0`; nothing requires a party member's
battle portrait to be unique, and authoring a second figure just for Ally would be new art this
starter does not need. ~~This differs slightly from `tools/make-rpg-sample.js`'s own idiom, which
additionally duplicates its HERO art a second time at sprite index `0x20` for the identical purpose —
unnecessary here, since referencing tiles `0-3` directly works precisely because `generateAssets`
already guarantees their content in every tileset, and a metasprite is free to reference the player's
own reserved range (`design-starter-library.md §5.7`: "never the player — the player's own range is
deliberately never refused as artwork").~~

**As shipped (phase 4), `firstTile: 0` on the Hero metasprite is not legal either, for the identical
reason the Overworld's Villager (§9.1) is not** — this section's own "unnecessary here" claim is the
probe this design never ran, and the probe disproves it. `metasprite(newId, 'Hero', 0, 0)` names a
tile inside the player's own reserved `$00-$1F`, tripping the same `validateProject` reserved-tile
warning §9.1 already hit, which fails test 7. The fix is the identical one: a second, identical copy
of `HERO_IDLE_TILES` written into its own free four-tile run — written and mirrored into tileset 1
*before* the tileset-1 copy above (§5.7's "never the player" carve-out is real, but it covers only the
player's own permanent `$00-$1F`, not a second copy elsewhere), so this new index reaches the Battle
tileset the same way every other tile does. Probed against the shipped build: that run is **`$34-$37`
(52-55)**, after Slime/Bat (`$20-$27`), Potion (`$28-$2B`), the Doorway (`$2C-$2F`) and the shared NPC
frame below (`$30-$33`).

**As shipped (phase 4), the three Village NPCs need art this section never authored: one
procedurally-generated "Villager" frame, shared by the Saver, the Innkeeper and Ally.** §9.3 as
written names the Saver's and Innkeeper's dialogue and mechanics in full (below) but never states what
`anims.idle` any of the three points at — a real gap, not a deliberate choice. There is no player
*actor* with its own `anims.idle` to reuse the way the dungeon starter's key mechanism reuses the
imported Key's own animation (§9.2), since the field player is drawn directly from
`project.sprites.playerTiles`, never through an actor record — so this is the "otherwise" branch: one
small shared frame, authored once (`shared/starters/rpg.js`'s own `npcRows()`, a small procedurally
generated hooded figure — a pointed hood tip, a rounded head/shoulders band with a face highlight,
then a straight-sided robe — distinct from both `HERO` and the Doorway), on **sprite palette 0** —
never overwritten by an import (`reservedPaletteSlots`, `shared/project.js`, reserves that slot for
the player), so its
colours are stable and distinct from Slime/Bat's own "Creature" palette (slot 1) and Potion's "Item"
palette (slot 2). Written before the tileset-1 copy, so it mirrors there too, at the first free run
after the Doorway. Probed against the shipped build: **`$30-$33` (48-51)**.

**Spells**: one, hand-authored (the library has no `spell` kind at all — decision 4 names this
explicitly as something the library lacks): `{ ...createSpell(0, 'Ember'), mpCost: 3, kind: 'damage',
amountMin: 6, amountMax: 6, element: 'fire', scope: 'one' }` — a flat range (`amountMin === amountMax`),
the same simplest-legal-case choice `tools/make-rpg-sample.js:292`'s own `Ember` makes for its own
first spell.

**The party**: `createPartyMember(0, 'Hero')` (already `project.party`'s own default the moment
`createProject('X', 'rpg')` runs) with `spells: [{ spellId: 0, level: 1 }]` and `metaspriteId: <the
Hero battle metasprite, above>` added directly. A second member, hand-authored the same way `tools/
make-rpg-sample.js:284`'s `Iris` is: `{ ...createPartyMember(1, 'Ally'), startsInParty: false,
metaspriteId: <the same id>, spells: [] }`, recruited on the field via a `join` command from an NPC in
the Village, `hideSwitch` set to the same switch the join event sets — the identical `hideSwitch`
idiom §9.2's own key mechanism now also uses, already precedented by `tools/make-rpg-sample.js`'s own
recruit.

**As shipped (phase 4, a real engine gap found in review, not merely a probed number): naming
`hideSwitch` here is not sufficient on its own, and this section's own wording invited exactly the bug
§9.2's key mechanism had already been fixed for once (round-2 finding 2, above).**
`spawn_entities` (`engine/entities.asm`) reads an entity's `hideSwitch` only once, at the moment its
own screen's entities are placed from the record table — never consulted again until the next time
that happens. `setSwitch`'s own opcode, `script_op_set`, touches no entity state at all. So a single,
unguarded `join` page — the shape a bare "`hideSwitch` set to the same switch the join event sets"
reads as — would still be standing there, still `touch`/`interact`-able, for as long as the player
stays on the Village screen after recruiting Ally: a second interact reruns the page, joins the
already-recruited member a second time (a harmless store, since `PARTY_SIZE`-bounded `join` is
idempotent on `pc_in_party`) and sets the same switch again — silently, not a crash, but not the
one-shot recruitment this section implies either. **Fix, the identical two-page shape §9.2's key
mechanism already uses**: the recruit's page is `cond: { type: 'switchOff', arg: 0 }` guarding the
`say`/`join`/`setSwitch` — the dungeon key-mechanism idiom, restated here as a rule rather than left
implicit: *a one-shot interact page needs both a `switchOff` guard and an unconditional fallback page;
`hideSwitch` alone only removes the actor on the screen's next load, never within the same visit.* A
second, unconditional page states the fallback: `say: "Ready when you are."` `hideSwitch: 0` is kept
on the placement itself, for the *next* visit — the mechanism the section above already describes.
(Outside this design's own scope, recorded here only as an observation: `tools/make-rpg-sample.js`'s
own Iris has the identical unguarded shape and was left unfixed, since `sample-rpg/` is a checked-in
fixture no test may mutate.)

**A hand-authored Doorway metasprite here too (§9.1), at sprite index `$2C-$2F` (44-47), the first free
run after Slime, Bat and Potion (`$20-$2B`), on **sprite palette slot 2** — Potion's own slot, reused
rather than claimed, the same rule §9.1/§9.2 apply.** Both `Door` actors below use it.

**Maps and screens (3 maps, 3 screens), every placement given explicit coordinates (round-3 finding
6), and the Field's own arrival point moved clear of its own return door — round-3 finding 1, the
most consequential fix in this round: v3's own Village door arrived at exactly `(32, 112)`, and the
Field's own return door was placed at exactly the same point, so a player stepping through from the
Village would land already within `TOUCH_RANGE` of the door that sends them right back —
`entity_door` (`engine/entities.asm:388-399`) and `entity_touching_player` (`:452-478`) fire the
instant both axes are under 12 pixels apart, with no arrival cooldown of any kind, so the Field would
have bounced the player back to the Village before they ever saw it**:

| actor | screen | at (x, y) |
|---|---|---|
| player start | Village | `48, 176` |
| Saver NPC | Village | `64, 64` |
| Innkeeper NPC | Village | `192, 64` |
| Ally recruit NPC | Village | `128, 32` |
| Door (Doorway) → Field | Village | `224, 112`, `toX: 192, toY: 176` |
| Potion | Field | `192, 64` |
| Door (Doorway) → Village | Field | `32, 112`, `toX: 128, toY: 208` |

- **"Village"** (1 screen, start map) — Stone Floor terrain. Entities: a Saver NPC (`behavior:
  'npc'`, `trigger: 'interact'`, **one unguarded page** — `say` + `save`, no `switchOff` guard — this
  starter's own "a Save." **This deliberately does not copy the save-fixture idiom, and here is why
  (finding 13):** `sample-mmc1`'s/`sample-rpg-mmc1`'s own Savers guard themselves on the switch they
  set, and CLAUDE.md's own passage on why is explicit that the guard exists for **test determinism**
  — a `touch`-triggered Saver that also `give`s an item hands out a second one on the very next
  reload, because `Save` records the player standing on top of the actor that fired it, and
  `spawn_entities` re-arms the trigger during the load's own redraw; the guard is what makes "a load
  came back empty" and "a load came back correctly" distinguishable at all when re-running the page
  would otherwise refill the bag either way. This starter's own Saver grants nothing and uses
  `interact`, not `touch` — an `interact` trigger only ever fires from an explicit button press, never
  automatically on load, so there is no re-arm-on-reload hazard to guard against in the first place,
  and even if the page did somehow run twice, saying a line and saving again is idempotent. A starter
  wants a save point an author can return to and use repeatedly, which an unguarded, `interact`-
  triggered page is, and a one-shot `switchOff`-guarded one is not.) An Innkeeper NPC (`behavior:
  'npc'`, `trigger: 'interact'`, one unguarded page — `say` + `{ op: 'heal', value: 255 }` — this
  starter's own "an inn via Heal 255"). The Ally recruit NPC (`join`, above). A `Door` to the Field
  (above).
- **"Field"** (1 screen) — Grass Plains/Dirt Path terrain. `map.encounters = { rate: 20, actorIds:
  [<Slime's id>, <Bat's id>] }` — the identical shape `tools/make-rpg-sample.js:371`'s own single-
  monster encounter table uses, widened to both imported monsters — this starter's own "a battle." Its
  formation actors are never *placed* entities — a wandering encounter is rolled from the step
  counter, not walked into — so they need no `(x, y)` of their own and the table above has none for
  them. The Potion pickup and a `Door` back to the Village (both above).
- **"Title"** (1 screen) — `project.project.titleMap`/`titleScreen` set to it.

**Items**: `{ id: 0, name: 'Potion', actorId: <the imported Potion's own actor id>, metaspriteId:
null, effect: { kind: 'heal', amount: 20 } }` — the identical explicit setting and reasoning as
§9.2's own Potion item (finding 15).

**What the player can do in the first minute**: spawn in the Village, see three NPCs and a door;
talking to the Saver records a save, repeatably; talking to the Innkeeper restores full HP for a
party that has taken none yet; talking to the recruit adds Ally to the party, visible in the party
roster with a real battle portrait; walking into the Field risks a wandering Slime or Bat, fought with
Ember and visible monster/party art, or picks up the Potion instead.

**Engine features demonstrated**: a repeatable Save (Village), an inn via `Heal 255` (Village), a
battle with visible combatants on both sides and a wandering-encounter formation (Field), a party
with a starting member and a `join`-recruited second one sharing its own battle portrait, at least one
spell (Ember), a pickup that grants an item (the Potion), two door placements with real, safe (and
now, correctly, non-bouncing) landing points, an authored player sprite reused as a battle portrait, a
shared Doorway metasprite, a title screen, terrain imported for two distinct areas. No locked
door/bound tile and no scripted choice here — both already covered by the two action starters.

**Capacity, measured against the shipped build, not guessed (phase 4):** `buildRpg`'s own output
leaves **384 bytes free** in MMC1 kernel-lo (`kernelCodeBytes` 7135 + `fixedBytes` 409 +
`tableBytes` 264, against the 8192-byte bank `kernelbytes.test.js` checks against) — re-derived
directly from `checkCapacity`, not copied from `rpg.js`'s own comment recording the same figure. One
live `Move` command (`MOVE_KERNEL_ALLOWANCE`, 379 bytes, plus `FACE_KERNEL_ALLOWANCE`, 16 bytes, for
the facing routine Move and `Turn` share — 395 bytes together, CLAUDE.md's own "The kernel budget"
section) would already be refused by 11 bytes on this exact starter; an author who adds a cutscene to
this starter's own events is the first person this margin matters to.

## §10. Nesasm label-length check

CLAUDE.md's own "6502 traps"-adjacent note: nesasm v3.1 crashes (exit 134, a glibc buffer-overflow
abort, not a normal error line) on any label of 31 or more characters. **Checked directly: nothing in
this design ever becomes an assembler label.** Every name this design introduces — a starter's own
`id`/`label`, an actor's `name` (`"Key mechanism"`, `"Ally"`, …), a map's `name` (`"Dungeon
Entrance"`), an item's `name` — is either UI-only text or a value written into a generated *data*
table (`assets/*.inc`'s own `.db` byte lists), never a `.asm` label; every real label in the generated
output is derived from a numeric id or a flat screen index. No starter name approaches 31 characters
regardless (the longest, `"Dungeon Entrance"`, is 16), so this is a documented non-issue for this
design specifically, not a new guard this design needs to add.

## §11. Tests

Numbered in the order they are first useful, not the order they ship (§12 says which phase ships
each). Each names the wrong implementation it catches.

1. **The blank-action and blank-rpg starters are byte-for-byte deep-equal to `createProject`, with
   each test pinning its own literal expected game type** (§4) — `assert.deepStrictEqual(
   STARTERS.find(s => s.id === 'blank-action').build('X'), createProject('X', 'action'))`, and the
   RPG twin with `'rpg'` hardcoded on both sides independently. **Plus (round-1 finding 4b, since a
   catalog entry's own `gameType` field is metadata the build-output check above never inspects at
   all): `assert.equal(STARTERS.find(s => s.id === 'blank-action').gameType, 'action')` and the RPG
   twin with `'rpg'`, both literal.** *Catches*: a blank entry that sets or omits a field
   `createProject` itself does not (a stray `titleMap`, a palette tweak), a blank entry wired to the
   wrong `gameType` in its own `build` output, **and now also** a catalog entry whose `gameType`
   *field* disagrees with what it actually builds. **Corrected this round (round-3 finding 4): the
   reason this is worth a separate assertion is not that the IPC handler reads it** — it does not;
   `project:create` returns `{ dir, project }` (`main/ipc.js:91`), never `starter.gameType`, and §6.1's
   own proposed `createProjectAt` never reads that field either — **it is that `gameType` is metadata
   the picker (§8.1) may show or reason about (a starter's own hint text names its mapper by game
   type, §3.2), and the catalog test pins it as a correctness property of the catalog itself**,
   independent of what any one call site currently does with it; a field nothing reads today is still
   a field a future reader (the picker, a later phase) could reasonably trust, and this test is what
   keeps it trustworthy.
2. **`STARTERS` is the single writer the picker's rendered buttons match — honestly two different
   claims, tested two different ways (round-1 finding 4a: v2's own version of this test proved only
   consistency, not authorship).** First, the weaker, cheap claim: render the picker and assert the
   rendered button labels equal `STARTERS.map(s => s.label)`, in order — this proves the picker is
   *consistent* with the catalog at the moment it renders, nothing more; a picker that hand-lists its
   own five labels, kept in sync by hand, would also pass it. Second, the real structural proof, the
   same idiom CLAUDE.md's own "a delegation is structural, not behavioral, proven by reading
   `generate.js`'s source, not its output" passage names (`CLAUDE.md:672-675`,
   `test/unit/playerparts.test.js:380-394`'s own source-text-regex shape) — **widened this round to
   cover the whole file, not only `chooseStarter`'s own body (round-3 finding 2: a version scoped to
   one function's own text is not what `playerparts.test.js`'s own precedent does, and it lets a
   *second*, duplicate label list declared elsewhere in `renderer/app.js` and rendered from inside
   `chooseStarter` pass, since nothing checked the rest of the file for one)**: read the **entire**
   `renderer/app.js` source text and assert (a) it contains an import naming `STARTERS` from
   `shared/starters/index.js`, (b) **no literal starter label string** (`'Blank action'`, `'Overworld
   adventure'`, …) appears **anywhere in the file**, not only inside `chooseStarter`, and (c) the
   picker's own function body references the `STARTERS` identifier. (a)+(c) prove `chooseStarter`
   actually consumes the import rather than merely importing it and ignoring it; (b), read over the
   whole file, is what rules out a second, wired-correctly list declared elsewhere and rendered from
   inside the function — a narrower, function-body-only literal check would still pass a
   `renderer/app.js` that keeps a second, hand-maintained `STARTER_LABELS` array at module scope and
   maps over it inside `chooseStarter`, since no literal string would then appear inside the function
   itself at all. *Catches*: the first check alone catches nothing a hardcoded, hand-synced list would
   not also pass; the second, whole-file version catches that hardcoded list wherever in the file it
   is declared, the same class of bug `playerparts.test.js`'s own precedent exists to catch for a
   different delegation.
3. **Every starter's `build(name)` runs without throwing**, in a plain `node:test` process, no
   `mkdtemp` needed (pure object construction). *Catches*: a starter whose library-entry lookup
   (§7.2) fails, or any other construction-time error — the cheapest, fastest-failing test in this
   list.
4. **`project:create` refuses an unknown `starterId`** with a named error, and neither creates a
   project file nor calls any `build` function. *Catches*: a fallback to `'blank-action'` on a
   typo'd or stale id.
5. **`project:create`'s existing two call sites in `main/smoke.js` still work unmodified** — covered
   by every existing smoke run continuing to pass once §6.1 ships; named here so the phase that ships
   it checks this explicitly rather than by accident.
6. **Each starter builds into a `mkdtemp` directory with `buildProject`, and `inspectRom` passes** —
   one case per starter (5 total, blanks included). *Catches*: anything §7.1's "must assemble" bar
   exists for — a bad opcode, an out-of-range operand, a capacity overflow `checkCapacity` (test 8)
   would already have caught but `nesasm` is the final authority on.
7. **`validateProject` raises zero errors and zero warnings for every *content* starter** —
   simplified this round (round-2 finding 8): §6.2's own binding fix removes the dungeon's own
   unbound-pickup warning entirely, so no content starter carries an expected warning any more and
   this test needs no special case for one. **As shipped (phase 2), `blank-rpg` is excluded from this
   bar, not a fourth omission left implicit**: it is pinned byte-for-byte deep-equal to `createProject`
   (test 1, §4), which correctly raises "No actor deals damage, so no battle can ever start." for
   every fresh RPG project — a real warning this design does not get to silence, since silencing it
   would mean the blank entry no longer matches `createProject`'s own output. *Catches*:
   schema-legal-but-semantically-broken content, and any warning at all appearing in a content
   starter's own build log, which — now that none is expected there — would itself be a regression.
8. **`checkCapacity` raises zero errors for every starter**, and its own `screenCount`/`capacity`
   figures are logged (not asserted past zero-errors). *Catches*: §7.2's second risk — a schema/
   capacity tightening that starves a starter's fixed content.
9. **The overworld starter's own choice is structurally real**: its NPC's event contains a `choice`
   command with at least two options, each ending in a `say`. *Catches*: a choice authored with only
   one option, or an empty option body.
10. **The dungeon starter's locked door is a real, reachable-only-when-unlocked barrier — a
    reachability check, not only a structural one, substantially strengthened again this round
    (round-1 finding 5's own reachability test had three gaps of its own, closed here by round-2
    findings 1, 3 and 7).** Build a plain adjacency graph over the Entrance screen's 16×15 metatile
    grid (4-directional), where a cell is blocked exactly when its *effective* metatile —
    `screen.metatiles` with any active `boundTiles` substitution applied for the switch state under
    test — has `collision === 'solid'` **or `collision === 'water'`** (the corrected rule, round-2 finding 3:
    `probe_solid`'s own `cmp #COL_DAMAGE / bcc` range test, `engine/player.asm:257-264`, keeps the raw
    collision index for `open`/`solid`/`water` and zeroes it for `damage`/`warp`, so the final
    zero-vs-nonzero test the caller branches on blocks `solid` **and** `water` — v2's "solid blocks,
    everything else passes" omitted water; this starter uses no water tile today, so the omission
    changed nothing here, but the test states the real rule rather than a narrower one that happened
    not to matter yet). Four assertions, not one:
    - Flood-fill from the player's own start cell, `(32, 48)`. Assert the Boss Chamber door's own
      cell is **unreachable** with switch 0 off and **reachable** with switch 0 on.
    - **Flood-fill again from the Key-Hall-return door's own arrival cell, `(208, 80)`** (round-2
      round-2 finding 1 — the reachability test itself must exercise every way a player can be standing on
      this screen, not only the initial spawn; a landing point this design failed to give an explicit,
      safe value for is exactly the kind of bug a reachability test that only ever starts from the
      map's own recorded start position would never see). Assert the same unreachable/reachable
      pair for both switch states.
    - **The key mechanism's own give page contains a `setSwitch` whose operand equals the `boundTiles`
      entry's own `switchId`** (round-2 finding 3 — without this, a test that flips switch 0 directly,
      as this test's own flood-fill setup necessarily does, would pass even if the key event actually
      set some *other* switch, since nothing would then connect "the key was taken" to "the door
      opened" at all).
    - **No cell reachable with switch 0 off is within `TOUCH_RANGE` (12 pixels, `engine/constants.asm:
      782`) of the Boss Chamber door's own placed `(x, y)` on both axes** (round-2 finding 7) — for
      every reachable cell, compute the closest point on that cell's own 16×16 pixel boundary to the
      door's coordinates and assert the per-axis distance is `>= TOUCH_RANGE` on at least one axis,
      mirroring `entity_touching_player`'s own independent dx/dy-under-`TOUCH_RANGE` test
      (`engine/entities.asm:452-478`) rather than a Euclidean distance.

    **As shipped, the fourth assertion's own negative control moves the Boss Chamber door to `(128,
    116)`, documented here for the first time — v5's own text above prescribed no negative control at
    all.** The value is computed from §9.2's own reference point, the front area's own deepest
    reachable point, `y = 111` (the same point that paragraph's own 17-pixel figure for a row-8 door,
    `y = 128`, is measured from): `(128, 116)` sits only 5 pixels from `y = 111`, under `TOUCH_RANGE`
    (12), a real violation by the identical measure.
    *Catches*: everything the old, structural-only check could not — a "locked" cell that a real
    player can walk around because it is not part of a full barrier, a door placed somewhere the wall
    does not actually block; **and now also**: a bad `toX`/`toY` on the return door that drops the
    player inside solid geometry with no reachability check ever exercising that spot; a key event
    that sets the wrong switch while a test flips the right one directly and never notices; and a door
    placed close enough to a reachable cell to be touched through the wall even though the tile
    collision itself is sound.
11. **The dungeon starter's boss room contains real, observable content matching the library's own
    "Skeleton" entry — not a claim about import provenance the built project has no way to prove
    (round-1 finding 6, correcting v1's own hp-comparison oracle; round-2 finding 4c, correcting v2's
    own reliance on `planLibraryImport`'s transient `report`, which `build(name)` never retains — the
    starter returns only the finished project, so nothing downstream of it can ask "which report
    produced this actor").** Two independent, purely observable checks against the Boss Chamber's own
    placed monster actor: its `name` equals `LIBRARY_ENTRIES.find(e => e.name === 'Skeleton').name`
    (trivially `'Skeleton'` here, phrased this way so the assertion states *why* rather than a bare
    string literal); and the full, ordered set of unique tile contents its own `anims.idle` →
    metasprite → tile indices resolve to in `project.tilesets[0].sprites.tiles` equals the *set* of
    unique strings in the Skeleton library entry's own `spriteTiles` (a set comparison, not an index
    comparison, since `planActorImport`'s own `tileMap` is free to place the entry's tiles at any
    destination indices — §6 of `design-starter-library.md`). Also asserts `behavior === 'chaser'`. A
    second assertion, same test: the Potion pickup is placed and item-bound (`canBackItem(actor)`
    true, some `project.items` entry's `actorId` matches). *Catches*: a generator that swaps in a
    different, coincidentally-stronger or coincidentally-same-named monster and still passes a
    name-only check (the tile-content check closes that), a generator that swaps in a different
    monster with borrowed art (the name check closes that), or a pickup imported but left unbound.
12. **The RPG starter's Field map has a non-zero encounter rate naming at least one live monster
    actor**, its Village map contains a live `Save` command on an unguarded, `interact`-triggered
    page and a live `Heal 255` command, its party has at least one member with `startsInParty: false`
    and at least one `join` command naming it, and at least one spell exists with `kind !== 'none'`
    reachable by the starting party member's own `spells` list. *Catches*: any one of the RPG
    starter's own named features silently missing or, for Save specifically, silently guarded in a
    way that would make it a one-shot rather than the repeatable save point this starter intends.

    **A structural check of this shape cannot see the `hideSwitch`-at-spawn bug this section's own
    correction above describes, and a second, engine-level test was added for it (phase 4, unnumbered
    — the same shape `main/smoke.js`'s own boot-and-walk checks already take).** `pc_in_party`,
    `switches` and `ent_active` are a RAM-only oracle, and `join` is idempotent on every one of them:
    reading engine RAM after two interacts cannot tell "the join page ran twice" from "the join page
    ran once, then the fallback page ran" — both leave the identical bytes behind. The regression test
    instead boots the built ROM, walks to Ally, interacts twice, and reads the message box's own first
    nametable glyph after each — derived from the two pages' own authored `say` text at the moment the
    test runs (never hardcoded), with a precondition that the two lines' first characters actually
    differ, so a future edit to either line that made them start identically fails the test at that
    precondition rather than passing on a glyph comparison that could no longer tell the two apart.
13. **No test touches `sample*/`** — no starter test imports from or writes into any `sample*/` path,
    asserted starting with the first phase that ships any test at all and unchanged through every
    later one. *Catches*: a future contributor reaching for `sample/` as a shortcut "starting point"
    for a starter's own content, exactly the shortcut decision 1 already rules out.
14. **Every monster in the RPG starter's Field encounter list, and every party member, resolves to a
    non-blank sprite tile in tileset 1 (new test, round-1 finding 2).** For each `actorId` in `map.encounters.
    actorIds`, resolve its own `anims.idle` → metasprite → each referenced tile index, and assert
    `project.tilesets[1].sprites.tiles[index] !== BLANK_TILE`; for each party member, the same walk
    starting from `metaspriteId` directly (skip — do not silently pass — a member whose `metaspriteId`
    is `null`, which must itself fail the test). *Catches*: exactly round-1 finding 2's bug — imported
    monster art landing only in tileset 0 with no copy into tileset 1, and a party member left at the
    schema's own default `metaspriteId: null`, both of which the engine would render as nothing at
    all during a real battle.
15. **The three starters' own measured palette-adoption outcomes match a pinned table — slot *and*
    `written` flag both, now (round-2 finding 6: v2 pinned only slots, and its own "adopts"/"writes
    fresh" labels were wrong about what `written` even means).** Two complementary checks, since
    `build(name)` returns only the finished project and retains none of `planLibraryImport`'s own
    per-import `report` (the identical fact that shaped test 11's own rewrite above): first, replay
    each starter's own documented import sequence directly — a fresh matching `createProject` base,
    then `planLibraryImport`/`applyPlannedProject` in exactly §9's own stated order with no
    `options.paletteSlot` — and assert each import's own returned `{ slot, written }` equals the
    pinned table (Overworld: Grass Plains bg1/written, Dirt Path bg1/adopted, Wood Planks bg2/written,
    Bat sprite1/written, Coin sprite2/written; Dungeon: Stone Floor bg1/written, Skeleton
    sprite1/written, Bat sprite1/adopted, Key sprite2/written, Potion sprite2/adopted; RPG: Grass
    Plains bg2/written, Dirt Path bg2/adopted, Stone Floor bg3/written, Slime sprite1/written, Bat
    sprite1/adopted, Potion sprite2/written — every figure re-measured against this working tree this
    round by reading the real `report.palette(s).written` field, not inferred from colour-matching).
    Second, and independently: call the shipped `starter.build(name)` for real and assert its own
    final `project.palettes.bg`/`.sprite` arrays hold exactly the colour arrays this table implies at
    each named slot — fully observable from the finished project alone, no report needed, and what
    actually proves the shipped generator (not only a hand-replayed sequence mirroring its own
    documented order) produces the claimed result. *Catches*: an import-order change (reordering, or
    inserting/removing an entry earlier in a starter's own list) silently shifting every later entry
    onto a different slot or adoption outcome — still functionally correct on its own, but exactly the
    kind of drift that would make this design document's own "how palette placement plays out" prose
    false with nothing else noticing; and, via the second half, a `build()` whose real import calls
    have quietly drifted from what §9 documents even though a hand-replay of the *documented* sequence
    would still pass.
16. **`main/smoke.js`, through the main-side seam (§8.2), split by the phase that ships each
    catalog entry (round-1 finding 3):**
    - **16a** (ships with the merged catalog+picker phase, and keeps running unchanged as later
      phases add entries — round-2 finding 5: a version of this step that hardcodes "two buttons"
      breaks the moment phase 2 adds a third): stub the next `dialog:newProject` call via
      `setSmokeNewProjectPath`, click "New project," see the picker render, and assert its rendered
      button labels equal `STARTERS.map(s => s.label)` **at whatever length the catalog currently
      is** — never a literal count. Then click the two blank entries **by their own stable id**
      (`'blank-action'`, `'blank-rpg'`), not by position, and assert each created project's `gameType`
      matches.
    - **16b** (ships with the overworld phase): the same mechanism, clicking Overworld's own button;
      assert `gameType === 'action'` and `maps.length === 3`.
    - **16c** (ships with the dungeon phase): clicking Dungeon's own button; assert `gameType ===
      'action'` and `maps.length === 4`; build it and boot the ROM headlessly in the main process,
      walking the player from `(32, 48)` through the Key Hall door and east to the key mechanism,
      tapping A through the `Say` box — **as shipped**, the walk's own arrival asserts three real
      engine-RAM values, not merely that the walk completed: switch 0 set, `inv_count === 1`, and
      `inv_items[0] === 0` (the Key's own item id).
    - **16d** (ships with the RPG phase): clicking the RPG starter's own button; assert `gameType ===
      'rpg'` and `maps.length === 3`; build it and boot the ROM to real gameplay, the same idiom 16c
      already established for the dungeon phase.

    *Catches*, across all four: anything only a real DOM click and a real IPC round trip can — a
    picker that renders but whose buttons do not actually call `close` with the right id, a
    `starterId` that reaches the renderer's `create` call malformed, or a build that only "works"
    when constructed directly in a `node:test` process rather than through the real application flow
    every other feature in this codebase is ultimately proven against. Splitting by phase (rather
    than v1's single "test 14" written against a five-entry catalog that would not exist until every
    phase had shipped) is what makes each phase's own smoke coverage land alongside the feature it
    covers, not stubbed out until the last phase.
17. **Arrival safety, across all three starters — new last round, and this is exactly the test that
    would have caught the RPG's own door bounce (round-3 finding 1) — two field-path and passability
    corrections this round (round-4 findings 1 and 2).** Build each starter's own project with
    `build(name)` and read its real, generated entity placements directly: **`entity.actorId`,
    `entity.x`, `entity.y`** (top-level fields — `normalizeEntity`, `shared/project.js:4499-4502`, and
    `generate.js`'s own byte emission, `:2951-2952`, both read/write `entity.x`/`entity.y` directly,
    never `entity.props.x`/`y`, which do not exist) **and `entity.props.toScreen`/`toX`/`toY`**
    (nested — v4's own test description named the wrong path for the first two, `entity.props.x`/`y`;
    corrected here). The doc's own coordinates, above, are treated as expectations this test checks
    the built project against, not as ground truth assumed correct — **and every coordinate the test
    reads is first asserted to be a finite number** (round-4 finding 1's own second half: a field-path
    mistake like v4's own would otherwise silently read `undefined`, propagate into `NaN` on every
    distance computed from it, and have every comparison against `NaN` — `<`, `>=`, `===` alike —
    come back `false`, which a touch-range check misreads as "far enough" and a passability check
    misreads as "not the blocked collision type," passing for the worst possible reason). For every
    door placement on every screen, in every starter:
    - **Its `toX`/`toY` is at least `TOUCH_RANGE` (12 pixels, `engine/constants.asm:782`) away, on at
      least one axis, from every other door, NPC, monster and pickup placement on the *destination*
      screen** (the same independent-per-axis test `entity_touching_player` itself applies,
      `engine/entities.asm:452-478` — mirroring test 10's own touch-range assertion, generalized from
      "the one boss door" to "every door, every starter"). This is what a version of this test scoped
      to only the dungeon's Entrance (test 10) cannot see: the RPG's own Field arrived exactly on top
      of its own return door, and nothing in this design's test list before this round ever looked at
      a second or third screen's own arrival point at all.
    - **Every metatile the player's own collision body would overlap at `(toX, toY)` is passable** —
      `collision !== 'solid'` and `!== 'water'` (the corrected rule, test 10) — with any active
      `boundTiles` substitution applied for that screen's own default switch state. **Strengthened
      this round (round-4 finding 2): checking only the single metatile containing `(toX, toY)` itself
      is not enough.** The player's own collision body is offset from that point — `BODY_L = 2,
      BODY_R = 13, BODY_T = 8, BODY_B = 15` (`engine/constants.asm:1139-1144`, "the player is 16x16
      but only its lower half collides"), and movement collision probes exactly those offsets:
      `move_horizontal_probe` (`engine/player.asm:146-159`) checks `(new_pos + BODY_L/R, player_y +
      BODY_T)` and `(new_pos + BODY_L/R, player_y + BODY_B)`; `move_vertical_probe`
      (`engine/player.asm:206-222`) checks the mirror pair on the other axis. A body anchored at
      `(toX, toY)` therefore spans `[toX+2, toX+13] × [toY+8, toY+15]` — a rectangle that can overlap
      a *different* metatile than the one under `(toX, toY)` alone: an arrival at, say, `(120, 104)`
      has its own point in the Entrance's open row 6 (`104 >> 4 = 6`), but its body's own bottom edge
      (`y` up to `119`) reaches into row 7 (`112-127`), the locked wall row — a single-point check
      would call that arrival safe while the player spawns already standing partly inside a solid
      wall. The test now enumerates every metatile the full body rectangle overlaps, not only the one
      the raw coordinate falls in. **None of this design's own currently-listed arrivals actually
      needs the stronger check to pass — every one was placed well clear of any row/column boundary a
      body offset could carry it across — but the weaker, single-point version would not have caught
      it if one had not been**, which is exactly why the rule is worth stating precisely rather than
      left as "checks the metatile it lands on."

    *Catches*: exactly the RPG bounce (an arrival point coinciding with the very door meant to be
    reached, in either direction) — a bug three earlier rounds of review missed because every existing
    reachability test (test 10) was written against the dungeon's own Entrance specifically, and
    nothing generalized "does an arrival point make sense" to the other two starters; a field-path bug
    in the test itself that would have made every one of its own assertions vacuously pass on `NaN`;
    and an arrival point whose raw coordinate lands on open ground while the player's own collision
    body, offset from it, still overlaps a solid or water metatile next door.

    **As shipped (phase 4), this test's own negative control hardcodes `(32, 112)`** —
    `villageDoor.props.toX = 32; villageDoor.props.toY = 112;`, a literal, not a value read off the
    Field door's own object. That literal is the Field's own return door's real, placed `(x, y)`
    (`shared/starters/rpg.js`, the Field's own door placement), so the control reproduces the v3
    bounce bug directly rather than an arbitrary coordinate — but the literal on its own could
    silently drift away from what the Field door actually places if either number were ever edited,
    which is exactly what "moves the door to an arbitrary literal coordinate" would mean if nothing
    else were true. **What keeps it from going vacuous is a second, independent pin, not
    derivation**: this same test 17 also pins the RPG starter's own placement table directly
    (`'17: the rpg starter's own placement table (design §9.3) is pinned directly...'`,
    `assert.deepEqual([fieldDoor.x, fieldDoor.y], [32, 112], "the Field's own return door must sit at
    (32, 112)")`) — so a future edit that moved the Field door away from `(32, 112)` fails that pin
    first, and the negative control's own hardcoded literal can never silently point at the wrong
    place without the placement-table test catching it first.

## §12. Phasing

1. **The catalog/IPC rename and the renderer's own picker, merged into one phase** — v1 split these
   into two, and this merge is for a real correctness reason (round-1 finding 1), not tidiness: landing the
   IPC rename with the renderer's own `newProject()` left unchanged, even for one release, would mean
   the renderer keeps sending the old `{ dir, gameType }` shape while the handler now expects
   `{ dir, starterId }` — the handler simply finds no `starterId` on the request and falls back to its
   own default, so an author picking "RPG" in the still-unchanged dialog would silently get an action
   project instead. This phase ships together: `screenFromArt`'s promotion (§3.3), the
   `project:create`/`createProjectAt` rename to `starterId` (§6.1), the two blank `STARTERS` entries,
   and the renderer's own picker (§8.1) replacing `chooseGameType()` outright. **The implementer also
   performed, once, the ROM SHA-256 comparison §3.3 describes, as this phase shipped (`10f656c`)** —
   six generators, hashed on the commit before this phase and again on this phase's own tree, all six
   pairwise identical — the one-off check that `screenFromArt`'s move changed no ROM byte; this is not
   a checked-in test (§3.3, round-2 finding 10), so it is recorded here as a completed fact, not a
   promise. **This phase ships no
   authored art at all** — the shared player sprite (§5) does not exist until a content starter
   authors it, which is why `LICENSE-ASSETS`'s widening (§13) is phase 2's concern, not this one's.
   Tests: 1, 2, 3 (blanks only), 4, 5, 16a.

2. **The overworld starter** (§9.1) — the smallest content starter (no bound tiles, no multi-map
   folder grouping, no battle-tileset sprite copy), landed first to prove the "import via
   `planLibraryImport`, author the player sprite, then hand-author what is missing" shape end to end
   before the dungeon's own extra mechanism (locked doors) or the RPG's own extra mechanism (battle
   art in a second tileset) is added on top of it. **This is the phase `LICENSE-ASSETS`'s widening
   lands in** (§13) — the shared player sprite (§5) is new, original art the moment this starter
   authors it, and it is authored here first. Tests: 3, 6, 7, 8, 9, 15 (its own rows), 17 (its own
   screens), 16b.
3. **The dungeon starter** (§9.2) — depends on nothing from phase 2 beyond the shape it proved and
   the already-widened `LICENSE-ASSETS` (its own Wall metatile is more new art under the same
   widened dedication, needing no second wording change); independently reviewable on its own for the
   locked-door mechanism specifically. Tests: 3, 6, 7, 8, 10, 11, 15 (its own rows), 17 (its own
   screens), 16c.
4. **The RPG starter** (§9.3) — depends on nothing from phases 2-3; independently reviewable for the
   RPG-specific mechanisms (Save, Heal 255, encounters, join, and the battle-tileset sprite copy +
   party metasprites round-1 finding 2 requires). Tests: 3, 6, 7, 8, 12, 14, 15 (its own rows), 17
   (its own screens — the phase this design's own bounce bug would have been caught in, had test 17
   existed before this round), 16d.
5. **`ROADMAP.md`'s own strike-through**, last, once all three content starters and their own tests
   are in.

Test 13 (no `sample*/` contact) is a standing property of every phase above, not one phase's own new
test — it is asserted starting in phase 1 and re-run, unchanged, through every later phase.

## §13. License recording

**Phase 2 (the overworld starter, §12), not the dungeon phase — corrected from v1 (round-1 finding 4's own
downstream consequence).** Three categories of genuinely new art exist under this design, all
trivial, original NES Game Forge work with nothing to attribute to a third party, the identical
category `LICENSE-ASSETS`'s existing CC0-1.0 dedication already covers for `shared/library/`: the
shared authored player sprite (§5) and the shared Doorway metasprite (§9.1, round-3 finding 5), both
first authored the moment the overworld starter — the first content starter — ships, and the dungeon
starter's own `Wall` metatile brick art (§9.2, one phase later). Since all three are authored directly
inside `shared/starters/*.js`, not under `shared/library/`,
**`LICENSE-ASSETS`'s own opening paragraph should be widened from "every file under `shared/
library/`" to "every file under `shared/library/` and `shared/starters/`"** — a one-line wording
change, not a new file or a new license type, landed in phase 2, the first phase with anything under
`shared/starters/` for it to cover. `test/unit/library.test.js`'s existing assertions (`LICENSE-
ASSETS` exists and is tracked) need no change; a new, parallel assertion — `LICENSE-ASSETS`'s own
text mentions `shared/starters/` — is one more line in that same test file, added in phase 2.

## §14. Out of scope, explicitly

Not built here: a starter editor, or a flow that exports a project's own content back into a starter
(the identical exclusion `design-starter-library.md §14` already states for the library itself); a
fourth or later starter beyond the three decision 2 names; any change to `checkCapacity`,
`validateProject`'s rule set, or the engine (§7.2 is explicit that every risk named there is about
*future* drift, not something this design needs to fix now); a `build:capacity` preflight IPC surface
(`design-starter-library.md §14` already records this as a real limitation for library imports
specifically — a starter's own `build()` runs entirely offline, with no live author to preflight
anything for, so this limitation does not even apply here); re-theming or difficulty variants of an
existing starter; localizing any starter's dialogue text; and, as decision 1 already states outright,
turning any starter into a seventh test fixture — CLAUDE.md's six-fixture rule is unchanged by this
document in every direction.

## Open questions for Chris

- **Starter names and hint text.** §9's three starters are functionally specified (maps, screens,
  entities, items, features) but their `label`/`hint` strings in §3.2 are placeholders. Final
  copy — is "Overworld adventure" the right label, or something closer to `sample/`'s own tone; how
  much should each hint say about the mapper?
- **Dialogue tone and specific lines.** §9's quoted dialogue are illustrative, in the same register
  `tools/make-sample.js`'s own dialogue already uses. Chris may want a distinct voice per starter, or
  may be fine with the illustrative lines shipping as final.
- **The shared player figure's look.** §5 recommends the same small humanoid across all three
  content starters, in `tools/make-rpg-sample.js`'s own `HERO` idiom, to minimize authoring cost. If
  Chris wants each starter's protagonist to look distinct, that is three small art assets instead of
  one, with no mechanism change.
- ~~**Which library monster is the dungeon boss.**~~ **Answered (phase 3):** Skeleton, this section's
  own recommendation, stays the boss, overridden to `chaser` exactly as proposed — Chris's decision on
  the design's own recommendation, not a reopening of it.
- ~~**The RPG starter's recruit and inn framing**~~ **Answered (phase 4):** "Ally" is the shipped,
  fixed recruit name; the innkeeper's line stays purely in-fiction ("You look tired. Rest here a
  while."), naming no mechanic. A related question this design never asked, raised and settled the
  same round: **in-game renaming of a recruit on join is explicitly out of scope for this design** — a
  future engine slice of its own, should one ever be built, never folded into this starter.
- **How much of the player figure to author (round-2 finding 12).** §5's own recommendation authors
  only two of the player's eight frames (`down`'s idle and walk step); the other six stay at the
  build-time placeholder, so a player walking up, left or right sees a visibly different character
  than the one facing down. Two ways to close that seam, both with no mechanism change: keep two
  frames plus the placeholder for the rest (cheapest, and the seam may be acceptable for a starter
  meant to be edited further anyway), or author all eight frames per starter (three times the pixel
  art this design currently proposes, for a consistent look in every direction). Chris's call.

## Changelog

### v6 (as shipped) — every deviation the four implementation phases accepted

Every figure below was re-derived from the shipped code this round (`shared/starters/*.js`,
`test/unit/starters.test.js`, `main/smoke.js`), never copied from a commit message. Where a
deviation contradicts this document's own body text, the body is corrected in place, marked
"as shipped," and cross-referenced from here.

**Phase 1 (`10f656c`):**

1. `createProjectAt` resolves `starterId` **before** `fs.mkdir` runs, so an unknown id creates
   nothing at all — a deliberate tightening of §6.1's own snippet, which mkdir'd first. §6.1's code
   block is corrected to the shipped shape.
2. Tests 2 and 13, and the `shared/` Node/DOM-purity check, are built on `test/lib/sourcescan.js`,
   an `acorn`-tokenizer-backed scanner (with its own 24 tests) rather than a hand-rolled one: eight
   review rounds found a hand-rolled scanner cannot settle regex-vs-division or comment/string
   boundaries without hiding real violations. `acorn` 8.18.0 is an exact-pinned, test-only
   devDependency — this codebase's first non-Electron one — imported by that file and by
   `test/unit/project.test.js`; nothing under `main/`, `renderer/` or `shared/` imports it.
3. The one-off six-fixture ROM SHA-256 comparison §3.3/§12 required was performed at this phase
   (`10f656c`): all six generators, hashed before and after `screenFromArt`'s move, identical
   pairwise. §12's own phase-1 paragraph now records this as done, not merely planned.

**Phase 2 (`aeed4d9`):**

4. **The Overworld's Villager cannot reuse the player's own tiles `$00-$03` as §9.1 proposed** —
   pointing a metasprite at any tile inside the player's reserved `$00-$1F` trips `validateProject`'s
   reserved-tile-reference warning (ROADMAP item 8's own validate-as-you-draw check), failing test
   7's zero-warnings bar. The Villager gets its own copy of the idle art instead, at a probed run
   (`$28-$2B`, 40-43, as shipped), which in turn pushes the Doorway from §9.1's own `$28-$2B` to
   `$2C-$2F` (44-47). Both corrected in place in §9.1; sprite indices are probed at build time in
   every content starter, never assumed.
5. Test 7 ("every starter, zero warnings") cannot hold for `blank-rpg`, which is pinned
   byte-identical to `createProject` (test 1) and correctly carries "No actor deals damage" for
   every fresh RPG project — test 7 covers content starters only; §7.1 and §11 test 7 both corrected.
6. `choice` has no prompt field of its own, so the Overworld trader's question is a plain `say`
   immediately before the `choice` — §9.1 corrected.
7. **A product bug found in review, not a probed number:** `playerTiles` built by slicing a
   tileset held 24 `BLANK_TILE` *strings*, not `null`s, so `generateAssets` never substituted its
   own placeholder and the player vanished facing anything but down. `writePlayerFigure`
   (`shared/starters/figures.js`) returns eight authored tiles and 24 explicit `null`s, built
   directly rather than sliced. §5 corrected with the null rule stated as a rule, not left implicit.
8. `LICENSE-ASSETS` was widened to cover `shared/starters/` at this phase, exactly as §13 planned;
   `test/unit/library.test.js`'s test `28a2` asserts the wording. No correction needed — confirmed
   against the shipped file and test.

**Phase 3 (`b3be691`):**

9. §9.2 imports the Bat but its own placement table never placed it — a design gap, not a
   deliberate omission. The shipped fix patrols one Bat at Key Hall's leftmost interior column,
   `(16, 48)`, clear of the key mechanism's own touch line on the x axis alone. Added to §9.2's
   placement table and prose.
10. v5's own §11 test 10 write-up prescribed no negative control at all. The shipped test's own
    fourth assertion is checked by one, moving the Boss Chamber door to `(128, 116)` — computed from
    §9.2's own reference point, the front area's deepest reachable point (`y = 111`), the same point
    that section's own 17-pixel figure for a row-8 door is measured from: `(128, 116)` sits only 5
    pixels from it, under `TOUCH_RANGE`, a real violation. §11 test 10 now documents this. Separately:
    `test/unit/starters.test.js`'s own source comment above this negative control attributes a
    "(128, 128) fails (iv)" claim to §11 that no version of this document at HEAD contains — left
    alone by this docs pass, since it is code, not documented here; flagged for a later code pass.
11. The dungeon's Title screen is shipped as plain Stone Floor Plain, no border, no entities — noted
    in §9.2 where it was previously unstated.
12. The Skeleton is overridden to `chaser` after the import, exactly as §9.2 already recommended —
    Chris's decision on the design's own recommendation, not a reopening of it. No text change
    needed; the matching "Open question for Chris" is marked answered.
13. Tests 10 and 17 share one `TOUCH_RANGE` constant (`test/unit/starters.test.js`, "from
    `engine/constants.asm` -- shared by tests 10 and 17"); smoke step 16c boots the built ROM in the
    main process, walks the player to the key mechanism, then asserts three real engine-RAM values —
    switch 0 set, `inv_count === 1`, `inv_items[0] === 0` — not merely that the walk completed. §11's
    own 16c write-up corrected to say so.

**Phase 4 (`52c01a3`):**

14. §9.3's Hero battle portrait cannot reference the player's own tiles `$00-$03` either, for the
    identical reason as finding 4 — this section's own "unnecessary here" claim was the probe this
    design never ran, and the probe disproves it. A duplicate sits at a probed run, `$34-$37`
    (52-55) as shipped. §9.3 corrected in place, its own superseded "unnecessary" sentence struck
    rather than deleted.
15. §9.3 authors no NPC art for the Saver, the Innkeeper or Ally at all — a real gap, not a choice.
    One procedurally-generated "Villager" frame (`npcRows()`, `shared/starters/rpg.js`), shared by
    all three, lands at a probed run, `$30-$33` (48-51) as shipped, on sprite palette 0. Added to
    §9.3 as new body text, not merely the changelog.
16. **§9.3's own "hideSwitch idiom" sentence alone describes a real bug, and this is the most
    important correction in this pass.** `spawn_entities` reads `hideSwitch` only at spawn, so a
    single unguarded join page — the shape §9.3 as written implies — repeats on every interact until
    the screen reloads, silently re-joining an already-recruited member. The shipped recruit page is
    `switchOff 0`-guarded with an unconditional fallback `say`, the identical two-page shape §9.2's
    own key mechanism already uses (restored there in round 2, above) — restated in §9.3 as a rule,
    not only as a changelog line: *a one-shot interact page needs both a `switchOff` guard and a
    fallback; `hideSwitch` alone only removes the actor on the screen's next load.* Noted, outside
    this design's own scope: `tools/make-rpg-sample.js`'s Iris has the identical unguarded shape and
    was left untouched, since `sample-rpg/` is a checked-in fixture no test may mutate.
17. v5's own test 17 write-up described no negative control at all. The shipped test
    (`'17 negative control (rpg): ...'`) hardcodes `villageDoor.props.toX = 32; villageDoor.props.toY
    = 112;`, a literal. That literal is real (it is the Field return door's own placed `(x, y)`), and
    what actually keeps the control from going vacuous is a second, independent pin: test 17's own
    placement-table assertion names the Field door's position directly (`"the Field's own return door
    must sit at (32, 112)"`), so a future edit that moved it fails that pin before the negative
    control's own hardcoded literal could silently drift away from it. §11 test 17 now describes
    this — hardcoded literal, pinned elsewhere, not derived.
18. A RAM-only oracle (`pc_in_party`, `switches`, `ent_active`) cannot distinguish a repeated join
    from the fallback page, since `join` is idempotent on every one of those bytes. The shipped
    regression test (`'engine regression: the RPG starter's Ally recruit joins once per visit...'`)
    instead boots the ROM, interacts twice, and reads the message box's own first nametable glyph
    after each — derived from the two pages' own authored text, with a precondition that the two
    lines' first characters differ. Added to §11 under test 12.
19. **Capacity, measured, not guessed:** `buildRpg`'s own output leaves 384 bytes free in MMC1
    kernel-lo (re-derived via `checkCapacity`, matching `rpg.js`'s own comment); one live `Move`
    command (395 bytes) would already be refused by 11 bytes. Added to §9.3 as a new paragraph.
20. Chris's decisions, both settled during this phase: the recruit is named "Ally," fixed, not a
    placeholder; the innkeeper's line stays purely in-fiction, naming no mechanic; in-game renaming
    of a recruit on join is explicitly out of scope for this design, a future engine slice of its
    own should one ever be built. Both matching "Open questions for Chris" marked answered rather
    than deleted.
21. Smoke step 16d clicks the picker's RPG button, builds the ROM and boots it to real gameplay —
    the same idiom step 16c already established for the dungeon phase. §11's own 16d write-up
    corrected to say so.

### v5 (final) — GO WITH FIXES: two medium findings in test 17, plus one addition

**Reviewer round 4 findings:**

1. MEDIUM — test 17 named `entity.props.x`/`y` for a placed entity's own position; the real fields are
   top-level (`entity.x`, `entity.y` — `shared/project.js:4499-4502`, `main/build/generate.js:2951-
   2952`), and `entity.props` holds only `toScreen`/`toX`/`toY`. Fixed: corrected field paths, plus a
   new assertion that every coordinate the test reads is a finite number, so a future path mistake
   fails loudly instead of computing `NaN` distances that every comparison silently passes (§11).
2. MEDIUM — test 17's own passability check looked only at the single metatile containing an
   arrival's raw `(toX, toY)`, but the player's own collision body is offset from that point
   (`BODY_L/R/T/B`, `engine/constants.asm:1139-1144`) and can overlap an adjacent metatile the raw
   point never touches. Fixed: the test now checks every metatile the full body rectangle overlaps.
   Confirmed this round: every arrival this design currently lists already passes the stronger check,
   so no coordinate changed — the rule matters for edits still to come (§11).

**Found on a further read of v4 itself:**

3. Section 9 never said what happens at the edge of Greenwood, the Village or the Field — each a 1×1
   map with open terrain and no wall border. Checked: `flattenScreens`'s own neighbour computation
   (`main/build/generate.js:1557-1565`) resolves every direction from a `1×1` screen to `NO_SCREEN`,
   and `cross_left`/`right`/`up`/`down` (`engine/player.asm:268-309`) leave the player's position
   untouched on a `NO_SCREEN` neighbour, since the calling `move_*` routine never writes a new
   position before jumping there. The player is simply stopped at the edge, with no wall art and no
   starter change required — stated explicitly in §9's own preamble.

### v4 — four reviewer findings plus three from a further read of v3, all reconfirmed against the code

**Reviewer round 3 findings:**

1. HIGH — the RPG's own Field bounced the player straight back to the Village: the Village's door
   arrived at exactly `(32, 112)`, and the Field's own return door was placed at exactly the same
   point, so `entity_door`'s touch-range warp (`engine/entities.asm:388, :452`, no arrival cooldown)
   fired immediately on arrival. Fixed: the Field's own arrival point moved well clear of its return
   door (§9.3); a new, general test (17, §11) checks every door's own landing point against every
   other placement on its destination screen, across all three starters — not only the dungeon's own
   Entrance (test 10's own original scope).
2. MEDIUM — test 2's structural proof was scoped to `chooseStarter`'s own function body, so a
   duplicate, wired-correctly label list declared elsewhere in `renderer/app.js` and rendered from
   inside the function would still pass — narrower than `playerparts.test.js`'s own precedent, which
   checks a whole file. Fixed: the literal-label check now covers the entire file (§11).
3. LOW — the `visible` command's own `state` field is the string `'hidden'`/`'shown'`
   (`VISIBLE_STATES`, `shared/project.js:1060`), not a boolean; `false` only worked because
   normalization (`:4139`) and `textcompile.js`'s own `'visible'` case (`:304`) both fall back to
   `VISIBLE_STATES[0].id` on any unrecognised value. Fixed: the dungeon's key mechanism now writes
   `{ op: 'visible', state: 'hidden' }` directly (§9.2).
4. LOW — test 1's own rationale claimed the IPC handler hands `starter.gameType` back to the renderer;
   it does not (`main/ipc.js:91` returns `{ dir, project }`). Fixed: the sentence now states the real
   reason the metadata assertion is worth having — the picker may read `gameType`, and the catalog
   test pins it as a property of the catalog itself, not of any one caller (§11).

**Found on a further read of v3 itself:**

5. Every door in the dungeon starter used the imported Key's own animation — including the front door
   and the boss door, in the one starter whose puzzle is finding a key — and the Overworld's doors
   used the Villager's animation, making a door look like a person. Fixed: one small, hand-authored
   Doorway metasprite (a plain dark archway), authored once per starter at each starter's own first
   free sprite index (re-probed: Overworld `$28-$2B`, Dungeon `$30-$33`, RPG `$2C-$2F`), on sprite
   palette slot 2 in every starter (reused, not newly claimed, so test 15 needs no change) — used by
   every `Door` actor in all three starters (§9.1, §9.2, §9.3, §13).
6. NPC, monster and pickup placements in the Overworld's Greenwood and Cottage and the RPG's Village
   and Field had no stated coordinates, so arrival clearance there could not be checked at all. Fixed:
   every placement in every starter now has an explicit `(x, y)`, in the same table shape §9.2 already
   used, and test 17 reads them (§9.1, §9.3, §11).
7. The dungeon's Boss Chamber was a dead end holding a `chaser` with no stated way to win and no way
   to leave. Fixed: stated that the Attack action — already bound to A in every project by
   `defaultInput()` (`shared/project.js:3718`), no authoring needed — is what lets the player beat the
   Skeleton's ordinary `hp: 8`, and added a return door to the Entrance's own back area with safe,
   test-17-checked coordinates (§9.2).

### v3 — six reviewer findings plus five from a further read of v2, all reconfirmed against the code

**Reviewer round 2 findings:**

1. HIGH — no door named an explicit `toX`/`toY`; `normalizeEntity`'s own default (112, 112) lands
   inside the dungeon's new locked-wall row, and the headless path's own default (0, 0) lands inside
   the top border — either way, inside solid geometry a player can then simply walk out of, since
   collision is only ever probed against a move's candidate destination, never the player's own
   current cell. Fixed: every door placement in every starter now states real, verified-safe
   coordinates (§9.1-§9.3); test 10 extended to flood-fill from the Key-Hall-return door's own
   arrival point as well as the start position.
2. MEDIUM — `hideSwitch` only despawns an actor the *next* time its screen loads
   (`test/unit/script.test.js:433`'s own title says so), not the instant its switch is set, so the
   dungeon key mechanism's unguarded page would have handed out a second Key on every same-visit
   re-touch. Fixed: the `switchOff` guard is restored, `hideSwitch` is kept for next-visit permanence,
   an unconditional second page states the same-visit fallback, and a self-`visible: false` gives
   immediate (not merely eventual) disappearance (§9.2).
3. MEDIUM — test 10's own flood-fill flipped switch 0 directly, proving nothing about whether the
   *key* is what opens the door. Fixed: test 10 now also asserts the give page's own `setSwitch`
   operand equals the `boundTiles` entry's `switchId`. Also corrected the stated passability rule:
   `probe_solid` blocks `solid` **and** `water`, not `solid` alone (§11).
4. MEDIUM, three parts — (a) the picker's "single writer" test proved only rendered consistency; added
   a structural, source-text proof that the renderer imports `STARTERS` and contains no literal label
   string, the `playerparts.test.js`/CLAUDE.md precedent. (b) test 1 never inspected catalog
   `gameType` metadata directly; added literal assertions for both blank entries. (c) test 11 claimed
   import-provenance proof through a `planLibraryImport` report `build()` never retains; replaced with
   an observable name-and-tile-content check (§11).
5. MEDIUM — test 16a's fixed "two-button" expectation breaks the moment phase 2 adds a third catalog
   entry. Fixed: it now asserts the rendered list against the *current* catalog and clicks the two
   blank entries by stable id (§11).
6. LOW — the "adopts"/"writes fresh" language throughout §9.1-§9.3 was based on colour-matching, not
   on `finishPaletteResolution`'s own real rule (whether the chosen slot was already unused). Slot
   *numbers* were correct; the words describing them were not. Fixed throughout §9, using a fresh
   read of `planLibraryImport`'s own `report.palette(s).written`; test 15 now pins the `written` flags
   too, not only the slots.

**Found on a further read of v2 itself:**

7. §9.2 placed the boss door both "in the back area, past the gap" and "exactly in the wall's gap" in
   the same paragraph — a door in the gap cell is reachable by proximity (`entity_touching_player`'s
   own pixel-distance test, unrelated to collision) from the front side while that cell is still
   solid. Fixed: the door now sits two full metatiles inside the back area, with coordinates given;
   test 10 gained a fourth assertion checking no switch-off-reachable cell is within `TOUCH_RANGE` of
   it.
8. The Key item bound to an explicit `metaspriteId` with `actorId: null`, which left the imported Key
   pickup actor unbound and triggered a real `validateProject` warning. Fixed: the Key item now binds
   via `actorId`, exactly like every other item in this design; §6.2 rewritten to state there is no
   warning to explain any more.
9. The Overworld's trader and Cottage NPC reused the Bat's own imported animation — the talker and the
   biter looked identical. Fixed: a hand-authored Villager metasprite, built from the player's own
   authored tiles on a distinct, otherwise-unclaimed sprite palette slot (§9.1).
10. §3.3's ROM SHA-256 comparison was framed as "before and after the move," which cannot be a
    checked-in test (a permanent test cannot see a tree state that no longer exists, and pinning six
    literal hashes would break on any unrelated engine change forever). Reframed as a one-off
    verification the phase-1 implementer performs, the same shape the routes and draw-validation
    slices already used for an identical claim (§3.3, §12).
11. §12 phase 1's own paragraph was grammatically garbled and self-contradictory (claiming to be "the
    first phase to ship authored art" and "not this phase's own concern" in the same sentence).
    Rewritten cleanly; phase 2 is, and was already stated elsewhere to be, the first art phase (§12).
12. Round-1 finding 4's own residue: only two of the player's eight frames are authored, so walking
    any direction but down shows the build-time placeholder instead. §5 now states this plainly, and
    an open question asks Chris to choose between the current two-frame approach and authoring all
    eight.

### v2 — nine reviewer findings plus seven from a second read of v1, all reconfirmed against the code

**Reviewer findings:**

1. HIGH — phase 1 shipped the IPC rename while the renderer still sent `{ gameType }`, silently
   building the wrong game type for any RPG choice made in that window. Fixed by merging the catalog/
   IPC-rename phase and the renderer picker phase into one (§6.1, §8.1, §12).
2. HIGH — RPG battle combatants would have been invisible: imported monster art lands in tileset 0
   while battle rendering reads tileset 1, and a party member's default `metaspriteId: null` is
   skipped outright by `battle_sprite_pc`. Fixed with an explicit tileset-1 sprite-table copy after
   every import and a real Hero/Ally metasprite (§9.3); new test 14.
3. HIGH — the proposed `main/smoke.js` seam (assigning onto `window.forge.project.pickNew`) cannot
   work: `contextBridge`-exposed objects are frozen. Fixed by moving the seam into main
   (`setSmokeNewProjectPath`, §8.2) and splitting the old monolithic test 14 into 16a-16d, one per
   phase.
4. MEDIUM — v1 claimed no starter needed a player sprite; `tools/make-rpg-sample.js` already authors
   one, and decision 4 named it as something a starter supplies. Section 5 rewritten; `LICENSE-
   ASSETS`'s widening moved from the dungeon phase to the first content-starter phase (§12, §13).
5. MEDIUM — the dungeon's locked door did not lock anything: one solid cell can be walked around, and
   a door's own warp never checks a switch. Fixed with a full wall/gap geometry (§9.2, ASCII art) and
   a reachability (flood-fill) test replacing the old structural-only one (test 10).
6. MEDIUM — weak test oracles: test 1 derived its own expectation from the entry under test; the
   picker smoke test never actually clicked every button; the boss-room test compared HP only. All
   three fixed (tests 1, 11, 16a-16d).
7. MEDIUM — wrong reasoning for why the key mechanism is an `npc`: pickup placements do carry their
   own event bytes, compiled independently. The real reasons — `availableTriggers` excludes `touch`
   for pickups, and `entity_pickup` never reads the event system at all — are now cited correctly
   (§9.2).
8. MEDIUM — `test/unit/samplegen.test.js` is a normalized-project comparison, not a byte diff.
   Section 3.3's wording corrected; a real ROM SHA-256 comparison added for genuine byte neutrality.
9. LOW — the importer already assigns `patroller`/`pickup` behavior by default; v1 wrongly described
   this as something a starter's own `build()` had to set. Corrected in §9.1; the dungeon's Skeleton
   keeps a deliberate, now-correctly-framed override to `chaser` (§9.2).

**Found on a second read of v1 itself:**

10. Cross-references were broken throughout (a nonexistent §3.4, tests cited as being "in section 9"
    when they live in §11, phasing cited as §10 instead of §12, license recording cited as §11
    instead of §13, and an editing-leftover paragraph in the old §12). All fixed against this
    document's own final numbering; the leftover paragraph is gone.
11. §9.1's import list and prose disagreed about Wood Planks. Now agree (§9.1).
12. §9.2's door-actor sentence contradicted itself, and "via edge or a second door actor" assumed an
    adjacency that three separate 1×1 maps do not have. Rewritten to name the actual second `Door`
    placement and its reused animation id (§9.2).
13. The RPG Saver copied the save-fixture's own `switchOff` guard, which is a test-determinism
    device for fixtures that also grant an item on the same page, not a shape a starter's own
    repeatable save point should copy. Changed to an unguarded, `interact`-triggered page (§9.3).
14. The dungeon's key mechanism kept its art on screen after being taken and carried an unreachable
    second page. Fixed with `hideSwitch` and one page (§9.2).
15. Both Potion items left their `effect` an open question. Settled explicitly as `{ kind: 'heal',
    amount: 20 }` for both, matching what `normalizeItem`'s own migration would derive from the
    library entry's `battle.heal: 20` — verified, not assumed (§9.2, §9.3).
16. §8.3 promised specific palette-slot numbers without giving any. A fresh probe against this
    working tree supplies them, and test 15 pins the whole table (§8.3, §9, §11).

### v1 (superseded)

Initial design. See the git history for its full text; every numbered fix above names exactly what in
it was wrong.
