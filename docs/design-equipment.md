# Design: equipment (ROADMAP item 5, the next piece)

Status: **built** (2026-10-19; commits C1 `37ca96f`, C1b `720d976`, C2 `dd7af55`, C3 `31e7fff`, C3b `7294592`, C4 `a5336b3`, C5 `f2e4ebe`, C5b `3ca7b54`, C6a `0e59c68`, C6b `ce7d009`, C6c `afbbc26`, C6d; the **Built** section at the end records what changed from the design below). Originally proposed in design round D3 (D1 returned FIX with F1-F8, answered and E5-E8 recorded in D2; D2's review returned FIX on F1 only, which D3 answers, and D3 records Chris's ruling E9).
**No product code was written by the design itself.** It settles what ROADMAP item 5's equipment piece builds, with Chris's nine
rulings (quoted at the end) held fixed. Items (`project.items[]`, their
effects, the Items Forge) and skills/status effects (the Magic Forge) have shipped; nothing about weapons, armor or slots
exists anywhere in `shared/`, `main/build/`, `engine/` or `renderer/`.

Every byte figure below is tagged **[measured: probe]** (a throwaway script under `handoff-next/equip/d1/` or `d2/`, run as
shipped, output saved beside it) or **[estimate]** (reasoned from measured neighbours, to be replaced by a measurement in
the build commit named). Probes derive every address and constant from a real build (`constants.asm`, `config.inc`,
`game.fns`), never from a literal.

## What the probes found

- **`probe-budget.mjs` -> `probe-budget.out`.** Free bytes on `sample-rpg` built in `mkdtemp` copies on each RPG-capable board
  (nesasm's "BANK n used/free" rows, the model figures beside them). Kernel-lo free: **UNROM 512 1,522, MMC1 1,720, MMC3 1,537**;
  with a titled map, a live Save and a live Move (the tightest corner `kernelbytes.test.js` knows) **283, 651, 452**. Banked battle
  region free: **3,060 / 3,060 / 3,020** against nesasm, **3,040 / 3,040 / 3,000** against `battleRegionCeiling` (8,192 -
  `BATTLE_SLACK` 20). Kernel-hi has 7,800+ free everywhere and plays no part.
- **`probe-ram.mjs` -> `probe-ram.out`.** The RAM map as the build resolves it. Free bytes are **117 in $0300-$07FF**
  (runs: $03D7 1, $03F8-$03FF 8, $077F 1, **$078E-$07EF 98**, $07F6-$07F7 2, $07F9-$07FF 7) and **8 in zero page**
  ($C9-$CC, $F9-$FC). `SAVE_RECORD_LEN` is 127 for every project (`saveBodySize()` takes no argument and is 120), so on
  UNROM 512 `save_flash_buf` ($0700) ends at $077E and the next allocation, `sw_fc_wy_lo` ($0780), leaves **one byte** of
  headroom. This is the finding that shapes section 5.
- **`probe-sizes.mjs` -> `probe-sizes.out`.** Sizes of the existing banked routines the Equip menu is modelled on, from
  `game.fns`: `combatant_atk` 38, `battle_menu` 161, `battle_list` 82, `draw_list` 136, `draw_list_name` 47, `print_num` 93.
- **`probe-sketch.mjs` -> `probe-sketch.out`** (source `sketch/equip-sketch.asm`): the new routines as real nesasm, assembled
  against the build's own `constants.asm` and `config.inc`. Sizes are in sections 3-4.
- **`fixtures.out`** (`probe-fixtures.mjs`). `sample`, `sample-mmc1`, `sample-mmc3`, `sample-u512` are
  **action** games; only `sample-rpg` and `sample-rpg-mmc1` are RPGs. Equipment is RPG-only, so **no flash-save fixture can carry
  it**: UNROM 512 + Save + equipment gets a `mkdtemp` variant (section 10).
- **D2 `d2/probe-integrated.mjs` -> `probe-integrated.out`** (source `d2/sketch/equip.asm`, 706 lines). Replaces D1's fragment
  sizes with one **integrated measurement**: a temp copy of `engine/`, `main/`, `shared/` is patched with the design's hooks (every
  patch asserted to match once), the full sketch (recalc, set, init, dispatch, intro, slot and list phases, row-per-frame
  drawing, stat preview) is added to the banked region, and `sample-rpg` copies are built on MMC1, MMC3 and UNROM 512 x Save
  (title + Save + Move, the tight corner) on/off x naming on/off x magic off/on x {ATK+DEF, +MAG, +MDEF, both}: **60 equipment
  builds, 0 nesasm errors, and the 24 matching equipment-off builds of the patched tree are byte-identical to the unpatched
  repo** (the glue costs nothing when off). Figures are in sections 3, 4 and 8. In D2 spelling the sketch's slot column is
  `eq_slot_t`; the design calls it `eq_slot`. The saved equipment-on ROM hashes in `probe-integrated.out` predate the final sketch;
  fresh re-runs are deterministic, so a future hash claim uses a fresh output. The byte figures and the equipment-off hashes reproduce.
- **D2 the run phase, `RUN_ONLY=1 node d2/probe-integrated.mjs` -> `probe-run.out`, `probe-run-mapper4.out`,
  `probe-run-mapper30.out`.** Boots that build in the shipped emulator (`renderer/emulator/runcontrol.js`, stepping instruction by
  instruction) and drives the sketch with the pad: **22 of 22 checks pass on MMC1, MMC3 and UNROM 512.** Pinned by it: the opener from
  `ST_GAMEPLAY` and from the bag, refusal while paused, F1 (stale monster flags and hit/miss timers cleared, entity slot 0
  survives), F2 (eight pieces plus NONE, last piece worn), refused unequip, exit with the stack depth unchanged, and the largest
  `vram_buf` fill in any Equip frame (**33 bytes**, one row packet). Three negative controls (the sketch with one load-bearing line
  removed) each fail the check that names them: `NEG=from_ent` (entity 0 killed), `NEG=setup` (stale flags survive), `NEG=pla` (461
  instruction fetches from the switchable window after the exit; section 4). Not run: the Mesen timing and MMC3 register
  checks (named in section 10, C4), and a streamed variant.
- **D2 a pre-existing bug the run phase hit: `d2/probe-bcontrol.mjs` -> `probe-bcontrol.out`.** On the **unpatched** repo,
  `dispatch_input` runs in every state and the authored battle row is B = `cancel`, so one B press in a real fight (command
  menu, `bt_phase` 1) runs `do_action_cancel` -> `close_ui` and sets `game_state` to `ST_GAMEPLAY` (state 5 -> 0). Section 4 and
  ruling E9.
- **D2 `d2/probe-ram-equip.out`** (`RAM_ONLY=1`): the RAM map resolved with and without the design (section 5), plus
  `probe-ram-equip-negctl.out` (the shift equate placed in `config.inc` fails with `Internal error[1]!`).
- **D2 `d2/probe-diag-sites.mjs`, `probe-diag-subjects.mjs`** (AST scans, outputs beside them): the diagnostic producer inventory
  and what each message interpolates (section 9a).

## 1. The data model

**Decision: a weapon or armor is an `items[]` entry with an `equip` field; there is no `project.equipment[]`.** The bag,
Give/Take, drops (`battle.drop`), Carrying conditions, pickups (an actor retargeted to an item id) and the save's
`inv_items` all speak one id space, `NO_ITEM` ($FF) is its one sentinel, and `renumberItemDeletion` is its one deletion
helper. A second array would need a second id space and a tag on every one of those references; an `equip` field on the
existing record needs none of them to change.

```js
// project.items[i]  (normalizeItem, shared/project.js)
{ id, name, actorId, metaspriteId, effect: { kind, amount },
  equip: null | { slot, atk, def, mag, mdef, usableBy } }
```

- **Slots: three, `EQUIP_SLOTS = ['weapon', 'armor', 'accessory']`**, an append-only wire order exported from
  `shared/project.js` like `ACTIONS` and `SPELL_KINDS`; `slot` is its index. Three because every slot costs 4 bytes of
  RAM, 4 bytes of save record and a row of Equip menu; three fit the NES budget with room to spare and fill the menu's
  box exactly (section 4). A shield or helmet is one more append (E5 fixes three for this item).
- **Stats: `atk`, `def`, `mag`, `mdef`, each an unsigned integer 0-255**, added to the member's level-derived stat with a
  saturating add (section 3). These four are chosen because each has exactly one engine reader -- `combatant_atk/def/mag/
  mdef` in `engine/battleturn.asm` (verified: `pc_atk_at`, `pc_def_at`, `pc_mag_at`, `pc_mdef_at` are read at one site
  each) -- so a bonus is one addition per stat. HP, MP, speed, accuracy and evasion are read at many sites (the level
  tables, the turn order, `roll_hit`) and are left out (E6), as are negative values.
- **Who may equip: `usableBy`, a bitmask of party member indices** (bit *i* = member *i*; default `0x0F`, everyone). It is
  item-side, so the engine's test is one table byte against `bit_mask` (already in the battle bank), and the Items Forge
  edits it with one checkbox per member. Edge cases, all decided here:
  - **Domain.** `normalizeProject` caps an RPG party at four (`characterCap`), so a normalized mask uses bits 0-3. A hand-edited
    raw project with **more than eight members** cannot be stored in one byte: `validateProject` refuses it with an error naming
    the Character Forge, before any codegen runs (tested with a raw nine-member project).
  - **Deletion.** `renumberPartyMemberDeletion` deletes bit *index* and shifts the higher bits down, in this one place. An index
    outside 0-7 leaves every mask **unchanged** (a JS `1 << index` would wrap at 32 and corrupt it). A mask that covered every
    member keeps covering every remaining member (`0b1111` -> `0b0111`).
  - **"Everyone" after a deletion, and a member added later.** The mask is literal (no sentinel). To keep "everyone" meaning
    everyone, adding a party member in the Character Forge calls one shared function, `grantNewMember(project, index)`, in the
    same `store.commit`: it sets the new bit on every piece whose mask covered all previous members. A piece limited to
    some members does not gain the newcomer. Tested both ways, plus undo.
- **Starting equipment: `party[i].startEquip`, three entries by slot, each an item id or `null`.** Not in the bag.
- **Limits.** `RPG_LIMITS.equipSlots = 3` (single writer for the slot count: the RAM `@size`, the save field size and the
  menu all derive from it; a test pins `EQUIP_SLOTS.length === RPG_LIMITS.equipSlots`). The stat ceiling is the existing
  8-bit ceiling that `statAt(..., ceiling = 255)` already uses.
- **Normalization.** `normalizeItem` gives every item `equip: null`. A present `equip` is normalized field by field:
  `slot` outside `EQUIP_SLOTS` makes the whole object `null` (an unusable piece becomes an ordinary item rather than a
  piece in a slot that does not exist); each stat is clamped to an integer 0-255; `usableBy &= (1 << RPG_LIMITS.party) - 1`.
  `normalizePartyMember` gives every member `startEquip: [null, null, null]`; a post-pass in `normalizeProject` (after both
  lists are normalized, because `normalizePartyMember` does not see `items`) nulls an entry that does not name an equipment
  piece of that slot. Normalization does **not** strip `equip` from an action game: toggling the game type must not lose
  data; the engine and UI ignore it (section 7).
- **What an old project normalizes to.** Every item `equip: null`, every member `startEquip: [null, null, null]`, no other
  change. The ROM does not change at all (nothing reads the fields while `projectUsesEquipment` is false). The on-disk
  fixtures are not rewritten (they are never regenerated); the keys appear the next time an editor saves a project.
  `project.test.js:174` and `cartridge.test.js:162,735` compare `normalizeProject` against a freshly created project, which
  has the new keys, so they hold; build commit C2 greps for any other deep-equal against a raw fixture.

Two predicates, both in `shared/project.js` beside `projectUsesItems`:

- `projectUsesEquipment(project)`: `gameType === 'rpg'` and some item has a non-null `equip`. It gates everything that is
  new in the engine, the generator, the save record and the identity.
- `projectUsesMagicPower` and `projectUsesMagicDefence` gain one more source each: a piece with `mag > 0` (resp. `mdef > 0`)
  on an RPG. Equipment is a third source of magic power exactly as `battle.mag` is the second (`docs/design-magic-power.md`
  §6: an authored choice taken at face value). Their `projectWithout...` helpers zero that source too, or the isolation
  tests would silently measure it live. **Gated consistently (settled in D2: authored MAG/MDEF bonuses enable the
  respective features):** one predicate result drives the generator, `validateProject`, the `battletables.js` columns, the allowances
  and the engine flags; the isolation test builds {neither, MAG only, MDEF only, both} and requires the flag, the `eq_mag`/`eq_mdef`
  column, the allowance and the per-stat add to appear and disappear together (a column emitted without its flag, or a flag
  without the add, fails).

## 2. Acquisition and the bag

**Equipment is acquired through the existing item paths and lives in the same bag until it is worn.** Nothing new is
needed to obtain a piece: a Give command, a placed pickup actor, a monster drop, all of which end in `add_item`
(`engine/ui.asm:31`). An equipped piece **leaves the bag** (`remove_item`), and taking it off puts it back (`add_item`), so
the bag never holds a piece that is also worn and the 8-slot `MAX_ITEMS` limit counts only what is carried.

- **Bag full.** Taking a piece off with a full bag is refused (the menu says so; `equip_set` returns carry). Putting a
  piece on over a worn one is net zero: the new piece is removed from the bag first, which frees the slot the old piece
  returns to. (The order matters: adding first fails at a full bag. Section 10 has the test.) Putting on the piece that is already
  worn, and taking off an empty slot, are **no-ops that return carry clear**; D1's sketch refused the latter at a full bag, which D2's
  sketch fixes. **A worn piece is bag-only state (E7):** it leaves the bag, so it does not count for Carrying, and Take cannot remove it
  from a member.
- **`use_item` on a piece.** The field bag menu's Confirm runs `use_item` -> `use_item_apply`; an equipment piece carries
  `effect.kind = 'none'` (a validate rule, section 6), which `use_item_apply` already treats as a key item: kept, nothing
  happens. No engine change. Equipment is put on through the Equip menu only.
- **Every path that reads the bag, and what it does with equipment** (verified by grepping `inv_items`, `inv_count`,
  `items_used` over `engine/`):

| reader | where | with a piece |
|---|---|---|
| `add_item` | `engine/ui.asm:31` (Give, `entity_pickup`, `do_interact`, `roll_drop`) | unchanged: a piece is an item id |
| `remove_item` | `engine/ui.asm:48` (Take) | unchanged; **the Equip menu also calls it** (kernel is always mapped). Take acts on the bag, so a worn piece is out of its reach (E7) |
| `use_item` / `use_item_apply` | `engine/ui.asm` ~120-152 | unchanged: `none` kind is kept |
| `ui_tick_menu`, `draw_menu` | `engine/ui.asm` 370-472 | unchanged: a piece shows as its `actorId` icon like any item |
| battle command availability, `build_item_list` | `engine/battleui.asm:192`, `:407` | unchanged: the heal filter drops a piece (a test pins it) |
| `item_chosen`, `item_heal` | `engine/battleturn.asm:227`, the `item_heal` table | unchanged and unreachable for a piece: `build_item_list` lists only heal items with an amount, so a `none`-kind piece never appears; if one were chosen, `item_chosen_none` answers `BS_NOTHING` without calling `remove_item` (the defensive path a test drives by hand) |
| the drop consumer | `roll_drop` -> `add_item` (`engine/battleturn.asm`) | unchanged: a monster may drop a piece; a full bag is the existing silent skip |
| Carrying condition | `engine/script.asm:1471` | unchanged: **the bag only**; a worn piece does not satisfy it (E7) |
| `save_check_valid`, `load_apply_body` | `engine/save.asm:371-396` | bag unchanged; one new range check for `pc_equip` (section 5) |
| `init_session` clears | `engine/combat.asm:66` | unchanged; `party_init` sets starting equipment (section 3) |

- **Join.** A member's `startEquip` is copied into `pc_equip` for **all three slots of all four members at boot** (`equip_init`),
  not at Join: a member who has not joined simply is not reachable in the menu (`pc_in_party`), and Join needs no
  equipment code at all (the sketch measured a Join-time copy at 23 bytes; boot-time initialization removes it).

## 3. Applying the bonuses

**Decision: add the bonus where the stat is read, from a small per-member cache, recomputed only when equipment changes.**
Folding the bonus into `pc_atk_at` cannot work (ROM tables, runtime change); recomputing from the three worn ids on every
read costs three lookups per stat; a cache costs 16 RAM bytes and one `adc` per read.

- **RAM** (`engine/constants.asm`; the allocation map is the single writer): `pc_equip` 12 bytes, slot-major
  (`index = slot * MAX_PARTY + member`), `NO_ITEM` = empty, `@size=EQUIP_BYTES` (a generated `config.inc` equate,
  `RPG_LIMITS.equipSlots * RPG_LIMITS.party`); and `pc_eq_atk`, `pc_eq_def`, `pc_eq_mag`, `pc_eq_mdef`, 4 bytes each,
  `@size=MAX_PARTY`. 28 bytes in all, claimed from the **top** of the free run $078E-$07EF (**[measured: probe-ram]**
  98 bytes free): `$07D4-$07EF`, the streamed-world block keeps growing up from below. The Equip screen adds two state bytes under it,
  `eq_dirty` (`$07D2`, the dirty-row mask) and `eq_cur_slot` (`$07D3`): a 30-byte block, `$07D2-$07EF`, which leaves **68** of the
  98 free bytes (`$078E-$07D1`) **[measured: probe-ram-equip]**; the flash shift of section 5 takes 12 more, leaving 56.
  `constants.asm` carries no `.if`, so the names exist in every build and cost nothing unreferenced. Zero page needs nothing new: the
  screen borrows battle scratch that is idle in the Equip phases -- `bt_actor` (the member), `bt_sel`/`bt_len`/`bt_scroll`/`bt_list`,
  `bt_str` (hint index), `bt_cmd` (stat), `bt_target` (preview value), `bt_vrow`, `bt_arg`, `bt_row`/`bt_col`, `bt_dmg_lo` (for
  `print_num`) and `bt_tmp` -- and never `bt_x`/`bt_y` across a `combatant_*` call (they clobber them) nor `bt_tmp2` (`cast_all`'s
  sentinel). The run phase exercises every path that touches them. `rammap.test.js`'s `KNOWN_MAX_SIZES` gains the seven entries.
- **Tables** (generated into `assets/battle.inc` by `main/build/battletables.js`, **in the banked region, not kernel-lo**),
  indexed by item id, `.db` only so `emittedBytes` counts them exactly: `eq_slot` (`$FF` = not equipment), `eq_who`,
  `eq_atk`, `eq_def`, and `eq_mag`/`eq_mdef` each only under their own flag; plus `eq_start`, 12 bytes. **Every column is
  `NUM_ITEMS` long and zero-filled (`$FF` for `eq_slot`) for ids that are not equipment** (F3): D1 cut the columns at the highest
  piece, so a stale save naming an ordinary item above it indexed past the end of a shorter column. Now any id the load check admits
  (`< NUM_ITEMS`) indexes inside every column, and the answer for a non-piece is "not equipment". Cost: 4 bytes per item id, plus 1 per
  `eq_mag` / `eq_mdef` column **[measured: probe-integrated, 1 B per id per column]**; at most 6 x 254 = 1,524 bytes, the same worst
  case D1 gave, now paid by every id rather than by the highest piece.
- **Routines**, all in the battle bank, in `d2/sketch/equip.asm`. **[measured: probe-integrated]** (spans between `game.fns` labels,
  ATK+DEF only; the totals are nesasm's own "BANK used" deltas):
  - the per-stat add inside `combatant_*`'s party path, after `lda pc_atk_at,y` (X is still the member, since `level_row`
    preserves it): `clc; adc pc_eq_atk,x; bcc ok; lda #$FF` = **8 bytes per stat**, so 16 for atk+def;
  - `equip_recalc` **86** (it is also the one sanitizer, below); `equip_set` **64** (wear, take off, no-op, refuse); `equip_init` **14**;
  - the glue: the `battle_tick` head hook (sends every `BP_EQ_*` phase to `equip_dispatch`, skipping the fight's own ticks) 12, the
    `draw_battle_screen` tail (F1, section 4) 12, and `party_init` / `party_restore` each ending in a `jmp` instead of an `rts` (+2
    each); with the 16 above, **44**;
  - the screen (section 4): dispatch and intro 67, slot phase 104, pick-list open 73, list phase 81, commit 41, follow 26, mark 7,
    exit 5, row flush 42, row drawing 211, stat cells and preview 148, small helpers 78 = **883**;
  - **Total banked: +1,219 B at one item id (1,217 when the project already has magic), of which 128 B are data -- 4 B/id, `eq_start`
    12, strings 96, stat labels 16 -- so about 1,091 B is code. MAG adds 25 B of code (+1 B per id), MDEF 25 (+1): +1,243 / +1,269.**
  D1's estimate (164 core + ~550 screen + 120 strings, about 830) was low by about 400 bytes: the F1/F2/F8 work (a dedicated init path,
  the virtual NONE row, row-per-frame drawing, a trial-recalc preview) is real code, and now it is counted.
- **Where recomputation happens.** `equip_recalc` runs after exactly **three recalc triggers**: `equip_set` (an Equip menu change),
  `equip_init` (called from `party_init`, so New Game and Game Over) and `party_restore` (**Continue is its caller**: `continue_game`
  loads the record, then runs `BE_RESTORE`), and nothing else. Level-ups do not
  touch it: the bonus is a separate term, so `party_apply_level` and `try_level_up` are unchanged and the effective stat is
  always `level stat + bonus`. Status effects (`pc_status`) never read or write these stats. Monsters are never touched
  (the add is on the party path only).
- **The sanitizer (F3).** `equip_recalc` is also the one place a stale worn id is dealt with, so the three triggers all get it. For each
  of the twelve `pc_equip` bytes that is not `NO_ITEM` it requires `eq_slot[id] == slot of that byte`; otherwise the byte is set to
  `NO_ITEM` and contributes nothing. That empties a worn **ordinary item** (`eq_slot` is `$FF`, a zero-filled entry), a piece of the
  wrong slot, and any id the columns call "not equipment". The dropped piece is **neither worn nor in the bag** afterwards: a hand-edited
  or stale save loses it, and that is the documented outcome. `usableBy` is **not** re-validated on restore (a save that wears a piece
  its member may not use keeps it; the bonus is the table's). `save_check_valid`'s range check in section 5 still refuses ids
  `>= NUM_ITEMS` outright.
- **Overflow.** Level stat + bonus saturates at 255 (`bcc; lda #$FF`, the idiom `physical_damage` and `spell_damage`
  already use). The bonus itself saturates the same way when three pieces sum past 255 in `equip_recalc`.
  `physical_damage` is `max(1, atk - def) + noise`, so a saturated atk cannot wrap.
- **Magic power.** A piece with `mag > 0` turns `MAGIC_POWER_ENABLED` on (section 1), which pulls in its measured 62 bytes
  (`MAGIC_POWER_BATTLE_ALLOWANCE`) and the `pc_mag_at` table. This is deliberate: a project whose only source of magic is a
  staff must still add it to its spells. `EQUIP_MAG_ENABLED` (the `eq_mag` column and its add) is a subset of that flag.

## 4. The in-game Equip menu

**Decision: the Equip screen is a set of battle phases, not a new game state.** It reuses the battle bank, the battle
screen, the lists and the party sprites. The new surface is `ST_BATTLE` with `bt_phase` in a new range `BP_EQ_FIRST...`
(13 onward, appended after `BP_WALK` = 12), so **`INPUT_STATES` and `ST_*` are not touched** and the "conditional row" rule
for `nameentry` does not have to be reopened. The battle bank already reads the pad directly (A, B and the D-pad are
hardwired there: the battle phases read `pad_new` directly), so the menu has no bindings of its own -- **but read the battle-row finding below**; `battle` stays hidden in the Controller
Forge.

- **Opens from** a bindable action, `equip` (E8): appended to `ACTIONS` at index 9, `ACT_EQUIP = 9` in `engine/constants.asm`, **in C4,
  the commit that ships the working handler** (F6: the Controller Forge builds its list from `ACTIONS`, so an earlier append would
  offer an action nothing implements). Existing action numbers do not move. `do_action` gains `cmp #ACT_EQUIP; beq do_action_equip`
  **before** `cmp #ACT_PAUSE`, so the pause-branch inversion that Naming forced in `engine/input.asm` is undisturbed. The handler refuses
  while `paused` (`main_loop` skips `ui_tick` while paused: Equip would open with nothing to drive it and strand the player), accepts
  `ST_GAMEPLAY` and `ST_MENU` (so the bag's Select can open it) and refuses every other state (a script conversation runs under
  `ST_DIALOG`, so that one test also covers `script_active`); then `jsr battle_begin; lda #BP_EQ_INTRO; sta bt_phase; rts` (the freeze,
  status reset and owner capture are the fight's own). **[measured: probe-integrated]** chain entry 4 B + handler 20 B = **24 B of
  kernel-lo**, identical on all three boards and every Save / naming / magic variant (a branch out of range would be an error that
  nesasm reports and still exits 0; the 60 builds were scanned for it). D1 measured 20 for a single-state opener with no `paused`
  refusal. **No new `BE_*` trampoline entry**: the per-frame `BE_TICK` runs the phases. Default binding: none (`defaultInput()` and the
  pinned blank starters are untouched); the Items Forge offers to bind `menu.SELECT` (section 7), and `validateProject` warns when equipment
  exists and nothing opens it. Equip opens by an input action, not by an event hook (E7), so an author cannot set a switch from it.
- **The battle input row (found by D2's run phase; pre-existing; fixed repo-wide by ruling E9).** `dispatch_input` runs in every state, and the authored `battle` row is
  A = `confirm`, B = `cancel`. A B press under `ST_BATTLE` therefore runs `do_action_cancel` -> `close_ui`, sets `game_state` to
  `ST_GAMEPLAY` and abandons the battle's phase and screen, before the battle code reads the pad. `probe-bcontrol.out` reproduces it
  **on the unpatched repo in a real fight** (command menu, state 5 -> 0 after one B). For Equip it would be fatal: B is Back, and the
  exit would skip `battle_end` (no redraw). The equipment-only generated battle row of four `none` actions that D2 proposed is
  **superseded by E9**: nothing is generated and no authored row is overridden.
  **The E9 fix (its own commit, C1b, right after C1 and before any equipment commit).** In `engine/input.asm`, `dispatch_input` leaves for
  `dispatch_done` without reading a button action when `game_state == ST_BATTLE` (`dispatch_done` still sets `cur_speed`, and `dash_on` is
  already cleared at the head), under `.if BATTLE_ENABLED`, so an action ROM does not gain it. The battle phases read `pad_new` directly, so
  nothing the battle needs is lost (`confirm` under `ST_BATTLE` was an `rts`, and Select and Start were already `none`). Kernel-lo cost: about
  6 bytes **[estimate]**, measured on each RPG board in C1b and folded into the RPG kernel base (the `BATTLE_ENABLED` figure the kernel model
  measures per mapper), not a new feature term, because nothing an RPG can turn off conditions it. It **deliberately changes every RPG ROM**
  and so every pinned RPG hash (the RPG entries among the section 8 pins, and any RPG fixture or ring cell the ring gate hashes); C1b updates
  them in the same commit and records old and new, and the four action fixtures' pins must **not** move (the proof that the gate holds). The
  one certificate renewal at the end (C6) covers it. Tests: (1) a real fight on `sample-rpg` -- one B at the command menu leaves `game_state`
  at `ST_BATTLE` and `bt_phase` unchanged (control: without the change it goes 5 -> 0, as `probe-bcontrol.out`); (2) field B still cancels --
  the bag closes, a dialogue cancels, a naming grid cancels, and a bound action still dispatches in `ST_GAMEPLAY` (control: a dispatcher that
  skips every state fails these); (3) Equip Back, in C4: B in the pick list returns to the slot rows and B on a slot row leaves to gameplay,
  with no row override anywhere. The D2 run phase passed 22/22 only with the row emitted as `none`; E9 removes the cause for every RPG instead.
- **Controls.** Up/Down choose a slot; Left/Right change member (skipping members with `pc_in_party = 0`; the first recruited member is
  selected on entry, and an empty party leaves at once); A opens the pick list for the slot; in the list Up/Down move, the stat preview
  updates live, A equips, B returns to the slot rows; B on the slot row leaves. **Exit returns to gameplay, not to the bag**
  (`battle_begin` clears `box_state` and `battle_end` redraws the field), so a player who opened Equip from the bag finds the bag closed.
  `enc_step` is zeroed on exit, a side effect of `battle_end` that is documented rather than avoided (a walk toward an encounter
  restarts its count), and status flags are cleared as for any fight.
- **The exit's call chain, and why the two `pla` are right.** Per frame: `ui_tick` -> `lda #BE_TICK; jmp call_battle` -> `call_battle` maps
  `BATTLE_BANK` and does `jsr battle_entry` (pushes **R1**, a kernel address whose next instruction is `jmp set_screen_ptr`) ->
  `battle_entry` is `jmp battle_tick` (no push) -> the new hook does `jsr equip_dispatch` (pushes **R2**, an address *inside the switchable
  window*, followed by `jmp battle_draw_sprites`). Every handler is reached by a branch or `jmp` from `equip_dispatch`, with no live `jsr`
  between the hook and an exit (a handler that needs a helper, such as `eq_flush`, calls it first and reads the pad afterwards), so at an
  exit the stack top is R2. `eq_leave` is `pla; pla; jmp battle_end`: the two `pla` discard **R2**, `battle_end` (kernel) redraws the
  field, which **re-maps the window to the field's screen bank**, and its `rts` returns to **R1**: `set_screen_ptr`, and the field bank
  is restored. Without the `pla` pair the `rts` would return to R2, into a window that no longer holds the battle bank. **[measured:
  probe-run, `NEG=pla`]** that control executes **461 instruction fetches from the window** after the exit (screen data run as code) while
  the stack still balances, so a stack-depth check alone cannot find the omission; the run phase asserts both (depth equal before the
  open and after the exit, and **no** window fetch once `game_state` is `ST_GAMEPLAY`). `battle_finish_live` (`engine/battleturn.asm`)
  ends the same way; `eq_leave` is its own label so the two stay independent.
- **The pick list (F2).** `build_item_list`'s shape over the bag: the pieces whose `eq_slot` equals the slot and whose `eq_who` has the
  member's bit, in bag order. D1 needed `NONE` as a ninth entry in the eight-byte `bt_list` and could not draw it (`draw_list_name`
  indexes a name table and cannot draw `$FF`). **Decision: `NONE` is a virtual row 0 that is not in `bt_list`.** Rows are `0..bt_len`: row
  0 is `NONE`, row *r* is `bt_list[r-1]`, so the backing list never exceeds the bag's eight and the navigation length is `bt_len + 1`, at
  most 9. Down past `bt_len` wraps to row 0; Up from row 0 wraps to `bt_len`. Three rows are visible (rows 22-24; the stat rows below
  need the rest), so the list scrolls with the screen's own `eq_follow` (`list_follow` hardcodes four rows): `sel < scroll` -> `scroll =
  sel`; `sel - scroll >= 3` -> `scroll = sel - 2`. Names: `NONE` is one of the screen's own 12-column strings; a piece is drawn by entering
  `draw_list_name` at its `draw_list_name_go` label with `item_name` and the id (the existing routine's tail, so the font and padding are
  the bag's). The cursor starts on row 1 when any piece is eligible (a double A press cannot unequip by accident), else on row 0.
  **Commit:** row 0 -> `equip_set(member, slot, NO_ITEM)`, row *r* -> `equip_set(member, slot, bt_list[r-1])`. A refused take-off (full
  bag) keeps the list open and shows `BAG FULL` in the hint row. **[measured: probe-run]** eight eligible weapons in a full bag give
  `bt_len` 8; Down x7 reaches row 8 with `scroll` 6; A wears the last piece (`pc_equip` = `bt_list[7]`, bag 7, ATK bonus 8); a further Down
  wraps to NONE; NONE with room returns the piece; NONE at a full bag is refused and the list stays open with `bt_str` = `BAG FULL`.
- **Entry (F1): a dedicated init path, not `battle_intro`.** `battle_begin` (kernel) sets `ST_BATTLE` and `BP_INTRO`, zeroes `bt_flee`,
  `bt_round`, `bt_sel`, `bt_scroll`, `box_state`, `bt_ptick` and `bt_tgt_vis`, clears `pc_status` and captures `talk_ent` into
  `bt_owner_ent`/`bt_owner_rec`; it does **not** set `bt_from_ent`, which `battle_end` reads to deactivate the entity that started a touch
  encounter. At power-on that byte is 0, so the first Equip exit would kill entity slot 0 (`NEG=from_ent` does exactly that). The opener
  sets `bt_phase` to `BP_EQ_INTRO`, and the first tick, `eq_intro`, does in order: (a) all four `mon_slot_actor` to `NO_ACTOR`, then
  `jsr setup_monsters`, which with no actors is a free reset of every fight-only byte (`bt_count`, the wipe mask/row/slot, `bt_fx_anim`,
  `bt_hurt_left`, `bt_miss_left`, `bt_walk_step`, and per slot `mon_slot_alive` and `mon_slot_status`) -- so a flee that left live monsters
  and feedback timers cannot leak into Equip (`NEG=setup` shows them surviving without it); (b) `bt_from_ent = NO_ENTITY`; (c) select
  the first recruited member, else leave; (d) `jsr draw_battle_screen`, **the screen primitive it reuses**: it blanks the display, selects
  the battle tileset, draws sky, ground and `draw_box_frame`, and re-enables rendering, with a 12-byte tail that, while `bt_phase ==
  BP_EQ_INTRO`, draws only the attribute table instead of the monsters, commands and panel. **The fight's own ticks are bypassed, not made
  safe:** the `battle_tick` head hook sends every phase `>= BP_EQ_FIRST` straight to `equip_dispatch`, skipping `wipe_tick` and the
  fx/hurt/miss ticks (which guard only on `BP_INTRO`), and then runs `battle_draw_sprites` for the party. The glue is the 44 bytes counted
  in section 3. Tests (section 10): first-use exit with an entity active in slot 0; opening after a flee with live monsters and feedback on.
- **Text.** An RPG always reserves the message font (`projectUsesText` is true for `gameType === 'rpg'`), so there is **no new
  font reservation**. The labels are a separate small table, `EQUIP_STRINGS`, not additions to `BATTLE_STRINGS`: that list
  holds 13 of its 21 addressable entries (`checkBattleStringsCapacity`), the equip screen needs about ten, and touching it
  would change the bytes of every RPG. Eight 12-column strings -- the title `EQUIP`, `WEAPON`, `ARMOR`,
  `ACCESSORY`, `NONE`, `BAG FULL` and two hints (for example `A:PICK B:OUT`, `A:OK  B:BACK`) -- are 96 bytes, and the four 4-character
  stat labels (`ATK `, `DEF `, `MAG `, `MDEF`) 16: **112 bytes [measured: probe-integrated, as zero placeholders of the real length]**.
  The MAG and MDEF cells are blank-filled when their feature is off.

```
      col 0         1         2         3
          01234567890123456789012345678901
 row  0   (sky, 4 rows -- the battle backdrop)
 row  4   (ground; the party stands at the right as in a fight)
 row 19
 row 20   +------------------------------+   draw_box_frame: edges at rows 20 and 29
 row 21   | EQUIP     < IRIS >           |   header: title, member (Left/Right)
 row 22   | > WEAPON     WOODEN SWORD    |   slots (Up/Down); > is the cursor
 row 23   |   ARMOR      LEATHER         |
 row 24   |   ACCESSORY  NONE            |
 row 25   |  ATK  12>15    DEF   8>  8   |   current > the highlighted
 row 26   |  MAG   0>  0   MDEF  0>  0   |   candidate (rows follow the flags)
 row 27   | A:PICK B:OUT                 |   hint
 row 28   |                              |   spare
 row 29   +------------------------------+
```

  The pick list replaces rows 22-24 while open. Text over the ground fill is the one legibility risk: the smoke screenshot checks it;
  the fallback keeps everything inside the box (content rows 21-28). **D1's mockup was wrong twice:** it drew the box to row 28, but
  `draw_box_frame` puts its edges at `BT_BOX_ROW` 20 and row 29 (content rows 21-28); and it placed the active member "under the existing
  target cursor", which is a monster-side sprite (`bt_tgt_vis`) -- no marker is drawn on the party, and the header names the member.
- **Per-frame draw schedule (F8).** Nothing but `text.asm` may write the nametable while rendering is on, so Equip queues packets in
  `vram_buf`, and only the intro draws under forced blank. One **row per frame**: `eq_dirty` has a bit per content row (bit 0 the header,
  row 21; bits 1-3 the slot or pick-list rows 22-24; bits 4-5 the stat rows 25-26; bit 6 the hint, row 27); each tick `eq_flush` publishes
  only the **lowest dirty row**, as one packet of 3 header bytes + 30 cells (columns 1-30) and a terminator. A change marks several rows (a
  new member marks all seven) and they drain over the following frames; the intro fills in over seven. **Worst frame: flip 10 + Flash 35 +
  one row 34 (33 + the terminator) = 79 of 256 bytes**, under the 88-byte worst case of the published accounting in
  `docs/reference-engine.md` (flip 10 + Flash 35 + arrow hide 4 + the dialogue close's row split, one 38-byte packet holding 32 tiles, + terminator; "a fourth independent
  producer must re-open that accounting"). Equip is not a fourth producer: it *replaces* the fight's own producers (it bypasses the wipe,
  hurt, miss and fx ticks), `call_battle` cancels any strip, and `ST_BATTLE` has no message box, so the row stands in for the dialogue
  close's share and 79 stays below 88 **[reasoned; the bound itself is measured below]**. **[measured: probe-run]** the largest `vram_len`
  sampled before an NMI drain in any Equip frame is **33** on all three boards (the terminator is not counted by `vram_len`). Two checks
  validate it: a jsnes assertion on `vram_len` after every Equip tick (`<= 34`) with the negative control of publishing two rows per tick,
  and the Mesen NMI-deadline templates (`test/lua/bound_tile_nmi_timing.lua.template` with `run_bound_tile_nmi_check.sh`,
  `flash_nmi_timing.lua.template` with `run_flash_nmi_check.sh`, and `run_sw_close_deadline_check.sh`) extended with an Equip frame whose
  NMI `rti` must land before scanline 257 (vblank ends 260), each with a named negative control (an unbounded multi-row publish).
  **MMC3 split.** `split_select` picks `SPL_BATTLE` under `ST_BATTLE`, the font's R1 split starts at `BT_BOX_ROW*8-1`, and
  `draw_battle_screen` writes `$E000` first; the C4 tests pin the register file at open, after the redraw and at exit (R6/R7 a pair,
  R0-R5 the live tileset, R1 on the tileset page when idle, `split_lock` 0). `call_battle` ends `jmp set_screen_ptr`, which restores the
  **field** bank: pinned by a streamed RPG whose field bank differs from the battle bank. **Not run in D2** (the MMC3 and streamed checks);
  the cost of the extended checks is part of C4's allowance work.
- **Cost.** Kernel-lo **[measured: probe-integrated]**: 24 bytes (above). Banked: **+1,219 B** at one item id, about 1,091 B of code,
  itemised in section 3, against a measured free banked region of 2,621 (MMC1 / UNROM 512, no naming) down to 1,593 (MMC3 with naming, magic
  and all four stats) -- section 8. Side effects, checked in the run phase rather than assumed: `setup_monsters` *is* run (with all four slots
  empty) and `battle_round` is not; the fight's tick producers are bypassed; the music is not touched (`grep -i 'song\|music'` over
  `battle.asm`, `battleui.asm` and `rpg.asm` finds only comments about `cur_map`); `enc_step` is zeroed on exit.
- **Streamed worlds.** `battle_begin` is already reachable from a streamed screen and `call_battle` already cancels an
  in-flight strip, so the Equip screen inherits both; C4 pins it with a streamed RPG variant (the field-bank case above).

## 5. Saves

**Decision: no `SAVE_LAYOUT_VERSION` bump. The record grows by 12 bytes only for a project that uses equipment.** The 2 -> 3
bump (name entry) reserved 40 bytes **unconditionally** so that a later naming-off ROM could be compared byte for byte; that
precedent is exactly what E4 forbids here, since an unconditional field would change every RPG's ROM and every save.

- `shared/save.js`: `SAVE_FIELDS` stays the base list. A new `saveFields(project)` returns it plus
  `{ ram: 'pc_equip', size: RPG_LIMITS.equipSlots * RPG_LIMITS.party }` last, when `projectUsesEquipment(project)`;
  `saveBodySize(project)` follows (called with no argument it returns today's 120, so `flashsave.test.js:56`,
  `flashdriver.test.js:103` and `streamsavey.test.js` keep passing unchanged). `generate.js` emits `SAVE_RECORD_LEN =
  saveBodySize(project) + 7` (line 4316 today: 127; 139 with equipment) and the three `save_field_*` descriptor tables from
  `saveFields(project)`. `engine/save.asm`'s copy loops are table-driven, so the field itself costs **3 bytes of kernel-lo**
  (one entry in each descriptor table) and no code. **Ledger (F4):** the descriptor tables are assembled from `assets/save.inc`, included
  after `reset` inside `.if SAVE_ENABLED` (`engine/save.asm`), so these 3 bytes belong to the **Save-gated supplement** below, not to
  the equipment-only term -- the same shape as `pc_name_ram`'s +3 inside `SAVE_KERNEL_ALLOWANCE_BY_MAPPER`.
- **`saveIdentity(project)`** folds a flag `equipEnabled` **only when true** (the pattern `saveCompatToken` already uses:
  pushed only when nonzero), so every existing project's identity is byte-identical, and an equipment project's save is
  refused by any non-equipment build of the same project and vice versa. `saveCompatToken` is unchanged: it is about
  map/screen structure. Honest limit, as for the bag today: identity folds counts, not contents; `save_check_valid`'s range checks keep a stale id
  safe, and `pc_equip` gets one (below).
- **What is saved:** the 12 `pc_equip` bytes. The bag is already saved. The four `pc_eq_*` bonus arrays are **not** saved:
  `party_restore` (`BE_RESTORE`, called by `continue_game`) recomputes them, the same reason `pc_hp_max` and `pc_spells`
  are recomputed from `pc_level` rather than trusted.
- **`save_check_valid`** gets a loop: each of the 12 bytes must be `NO_ITEM` or `< NUM_ITEMS`. **[measured: probe-integrated]** the loop
  is 16 bytes and the three descriptor bytes make the Save supplement **19 bytes of kernel-lo** (D1's 20 was a fragment). It is a bound,
  not a slot or `usableBy` check. **D1 said "nothing indexes out of range"; that was wrong (F3)** -- D1's columns stopped at the highest
  piece, so a checksum-valid stale save whose worn byte named an ordinary item above the last piece (still `< NUM_ITEMS`, so the check
  admits it) indexed past the end of `eq_atk` and read whatever table followed. D2 closes it in two layers: (1) every `eq_*` column is
  `NUM_ITEMS` long and zero-filled (section 3), so every admitted id indexes in range; (2) `equip_recalc` is the sanitizer and
  clears any worn byte whose `eq_slot` does not match its slot (section 3). So on load: `NO_ITEM` is accepted and stays empty; an
  ordinary item or a wrong-slot piece is cleared to empty (bonus 0); an id `>= NUM_ITEMS` fails `save_check_valid` and **Continue is not
  offered**, the existing refusal path for a bad record. The remaining honest limit: a piece worn by a member its `usableBy` excludes
  keeps its bonus, and a stale save can lose a piece (it is in neither slot nor bag).
- **The UNROM 512 collision (probe-ram).** The flash medium stages the record in RAM at $0700; with 12 more bytes it ends at
  $078A and overruns `sw_fc_wy_lo` ($0780) and the `sw_kb_*` bytes ($078C-$078D). The record cannot move down ($0600 holds
  `flash_driver` and its 256-byte `attr_shadow` alias, $0571-$05FF is dense). **Decision: shift the streamed-world block
  up instead.** `constants.asm` defines `sw_fc_wy_lo ... sw_kb_*` as equates off a base: `SW_BLK_BASE = $0780`, `sw_fc_wy_lo = SW_BLK_BASE +
  EQUIP_SAVE_SHIFT`, each later name chained off the one before (`sw_fc_wy_lo+1`...), which the `rammap.test.js` grammar already parses.
  `EQUIP_SAVE_SHIFT` is 12 when the board saves to flash **and** the project uses equipment **and** Save is on, else 0. **It must be
  emitted into `assets/cartridge.inc`, not `config.inc`** (D2 probe): `main.asm` includes `cartridge.inc`, then `constants.asm`, then
  `config.inc`, so an equate defined in `config.inc` is an undefined symbol while `constants.asm` assembles, which nesasm reports as
  `constants.asm:1343: Internal error[1]!` and still exits 0 (`probe-ram-equip-negctl.out`, `PLACE_SHIFT=config`). Consequence:
  `rammap.test.js`'s `buildAndRead` reads only `constants.asm` and `config.inc`, so it must read `cartridge.inc` too (C3). The base is
  spelled upper-case because the rammap guard treats a lower-case equate as a RAM name (in the probe `sw_blk_base` produced a false
  `save_flash_buf~sw_blk_base` overlap). **[measured: probe-ram-equip]** With a shift of 0 every address is today's, so no other ROM
  changes; with 12 the `sw_*` block is `$078C-$0799` and `save_flash_buf` ends at `$078A`, keeping a one-byte gap (`$078B`), the same
  headroom as today. The Equip block at `$07D2-$07EF` does not touch it; the whole map then has **75 free bytes** (117 before equipment),
  and the only overlap the checker reports is the pre-existing, documented `flash_driver~attr_shadow`. The rule
  that follows -- *growing the flash record moves the `sw_*` block with it* -- is a silent-bug rule, so it is one sentence in
  CLAUDE.md's single-writer list at the close (section 12). Cost: no code bytes. Alternatives rejected: refusing
  Save + equipment on UNROM 512 (a real limit on the largest board for no byte reason), and packing the 12 bytes into 8
  (still collides at $0786).
  *Decision, from the review's question (5): shift the flash-overlapped scratch block, keep `EQUIP_SAVE_SHIFT`.*
- **Save checks to re-run** (`docs/reference-fixtures.md`): `test/lua/run_sram_check.sh` (sample-mmc1, sample-mmc3,
  sample-rpg-mmc1) and `test/lua/run_flash_check.sh` (sample-u512) must pass **unchanged** at C3: their fixtures have no
  equipment, so their ROMs are byte-identical and this is mostly the identity proof. The new coverage is two `mkdtemp`
  variants built by the runners' `build_*_roms.mjs`: an RPG-on-MMC1 variant (equipment worn, saved, power-cycled, Continued)
  and an **RPG-on-UNROM 512 variant** (the flash path and the relocated block, also with a streamed map), since no
  checked-in flash fixture is an RPG. **No checked-in fixture gets equipment** (review question (6)): a fixture edit would change its
  pinned hashes and the save-check fixtures' ROMs; every equipment case is a `mkdtemp` variant of the fixture. The Lua scenarios
  (`test/lua/save_sram.lua`, `save_flash.lua`) and their builders (`build_sram_roms.mjs`, `build_flash_roms.mjs`) are extended in C3 to
  cover the new bytes, and each judge gets a targeted control (section 10, test 8).

## 6. Deletion and renumbering

Each reference has exactly one owner, and nothing is renumbered twice (a test deletes one item that is Given, dropped,
carried-on and equipped at once and checks every field once).

| reference | owner |
|---|---|
| `battle.drop`, Give/Take `command.item`, Carrying `cond.arg` (already) | `renumberItemDeletion` (`shared/project.js:2533`), unchanged |
| `party[].startEquip[slot]` | **`renumberItemDeletion`**: the deleted id becomes `null`, a higher id shifts down |
| `items[].equip.usableBy` bit *i* | **`renumberPartyMemberDeletion`** (`:2644`): drop bit *index*, shift the higher bits down one; an index outside 0-7 leaves the mask **unchanged** (no JS shift wrap); a mask covering every member keeps covering every remaining member (section 1) |
| `party[index].startEquip` itself | goes with the deleted member; nothing to renumber |
| `items[].actorId` (the icon) | `renumberActorDeletion`, unchanged |
| Join `command.member` (already) | `renumberPartyMemberDeletion`, unchanged |
| the slot index | none: `EQUIP_SLOTS` is a fixed list |

**Deleting a piece that is worn** is not possible in the editor (worn state exists only in a running game), so the only stored
references are `startEquip` and the bag-side ones above; a saved game that wore a deleted piece is handled by the compat rules of
section 5 (the stored item count changed, `saveIdentity` refuses the save). Turning a piece back into an ordinary item, or moving it to another slot, in an editor must also fix `startEquip` entries
that named it: one shared function, `releaseEquipment(project, itemId, newSlot?)` in `shared/project.js`, called by the Items
Forge in the **same `store.commit`** (`commit()` never runs `normalizeProject`), and `validateProject` reports a leftover as
an error naming the Character Forge. New `validateProject` rules (each born with a stable `rule` id, C1 below):
a piece whose `effect.kind` is not `none` is an error naming the Items Forge (a heal that also wears is two features);
`startEquip` naming a non-piece or a piece of another slot or one the member may not use is an error naming the Character
Forge; a piece on an action game is a **warning** ("ignored in action games", the CLAUDE.md "labelled, not silent" rule);
equipment present and no button bound to `equip` is a warning naming the Controller Forge.

## 7. The authoring UI

**Decision: extend the Items Forge, no new Forge.** `FORGES` in `renderer/app.js` and `isForgeAvailable` stay as they are:
equipment is a kind of item, and a new Forge would put a second list of the same ids in front of the author. In
`renderer/forges/items/items.js`:

- an **Equipment** section on the selected item, shown only for an RPG: a "Can be worn" toggle (sets `equip` to a default
  weapon with all stats 0 and everyone allowed; unsets it through `releaseEquipment`), a Slot select, four number fields
  (ATK, DEF, MAG, MDEF; the MAG/MDEF note says it turns Magic power on), and a "Worn by" checkbox per party member
  (writes `usableBy`);
- on the first piece, if `input.states.menu.SELECT` is `none`, a one-click "Open Equip from the bag with Select" that binds it;
  otherwise the validate warning only.

In `renderer/forges/character/` (name per `docs/design-character-forge.md`): a **Starting equipment** row of three
selects, one per slot, each listing only pieces of that slot the member may use, plus "None"; a read-only line "Can wear
N pieces" that `goTo`s the Items Forge. In the Controller Forge the `equip` action appears in every state's list **from C4 on** (F6: the list is built
from `ACTIONS`, so it grows the moment the append lands, and C4 is the commit with a working handler); for an action game it is
labelled "ignored here" (the mechanism `continue` already has), never hidden or silently dead. The "nothing opens Equip" warning is likewise C4; the Items Forge's Select-in-bag helper is
C5 (the Items Forge commit). Equip is opened by an input action and by nothing else: there is no event command, so an
author cannot set a switch "when Equip opens" (E7).

**Action games.** Equipment is **RPG-only and hidden**: `projectUsesEquipment` requires `gameType === 'rpg'`, the Items Forge
Equipment section does not render on an action project, existing `equip` data is kept (section 1) and warned about. An action
project has no battle bank for the Equip screen to live in, and `rpgCapable()` already says which boards can host one.
Capacity messages name the Forge responsible (section 8). **Dormant equipment on an action project** (data kept, the section hidden) is
tested as a byte-identity case in section 8 and as a `validateProject` warning case in section 10.

## 8. Capacity and checks

Every term is conditional, gated on a predicate, and a project not using it assembles byte for byte as it does today (E4).

| allowance | gate | amount | basis |
|---|---|---|---|
| `EQUIP_KERNEL_ALLOWANCE` (`generate.js`, beside `ITEM_KERNEL_ALLOWANCE`) | `projectUsesEquipment` | **24** = chain entry 4 + `do_action_equip` 20 | **[measured: probe-integrated]**, identical on MMC1, MMC3 and UNROM 512 across Save on/off x naming on/off x magic off/on x the four stat sets; includes the `paused` refusal and the dual-state (`ST_GAMEPLAY` and `ST_MENU`) opener D1 lacked. Flat per board and condition *as measured*; any conjunction outside the matrix is **provisional** (see Fit) |
| `EQUIP_SAVE_KERNEL_ALLOWANCE` | `projectUsesEquipment` **and** Save on | **19** = `save_check_valid` loop 16 + descriptor bytes 3 | **[measured: probe-integrated]**, same on all three boards; the descriptors live in `assets/save.inc`, included post-`reset` under `.if SAVE_ENABLED`, so they cannot be charged to an equipment-only project (F4). The `SAVE_KERNEL_ALLOWANCE_BY_MAPPER` shape (+3 for `pc_name_ram`) is the precedent |
| `EQUIP_BATTLE_ALLOWANCE` (`battletables.js`) | `projectUsesEquipment` | **about 1,091 B of code** (1,089 when magic is on) | **[measured: probe-integrated]** as the delta of "banked bytes used" between the matching equipment-on and -off builds, minus the fixed data below. The opener itself is kernel (above); the banked figure includes the F1 `draw_battle_screen` tail, the `battle_tick` hook, `equip_init`'s wiring and the F2 virtual-`NONE` list, the row-per-frame drawing and the stat preview |
| fixed data: `EQUIP_STRINGS` 96, stat labels 16, `eq_start` 12 | `projectUsesEquipment` | 124 | counted exactly (`.db` emitted, so `emittedBytes` sees it) |
| the `eq_*` columns | `projectUsesEquipment` | **4 B x `NUM_ITEMS`** (slot, who, atk, def) | zero-filled through `NUM_ITEMS` (F3), so the charge is by item count, not by highest piece; counted by `battleTableBytes` off the real emit, so exact |
| `EQUIP_MAG_BATTLE_ALLOWANCE`, `EQUIP_MDEF_BATTLE_ALLOWANCE` | a piece with `mag` / `mdef` > 0 (the same predicates that turn magic power / defence on) | 25 code + 1 B x `NUM_ITEMS` column each | **[measured: probe-integrated]** (+1,243 / +1,269 vs +1,219 at N = 1) |
| `EQUIP_SAVE_SHIFT` | flash board **and** equipment **and** Save | 0 code bytes | RAM only (section 5) |

The one gated predicate is `projectUsesEquipment(project)` (RPG, at least one piece), computed once in `shared/project.js` and consumed
by the generator, `validateProject`, `battletables.js`, `save.js` and the engine flags, so the table cannot disagree with the ROM.

- **Fit (F4), measured on the tight corner.** Corner: a title screen (Save sets one, `probe-integrated.mjs:211-212`), Save on, a `move` command in an event, naming on -- the conjunction
  where D1 found the least kernel-lo room. Kernel-lo free before / after equipment **[measured: probe-integrated]**: UNROM 512 **283 ->
  240**, MMC1 **651 -> 608**, MMC3 **452 -> 409** (43 each: 24 + 19). Across the whole matrix the minimum kernel-lo free after equipment
  is 240 / 608 / 409; kernel-hi is unchanged (delta 0). Banked free after equipment (nesasm), minimum over the matrix: 1,633 on MMC1 and
  UNROM 512 (naming + magic + MAG + MDEF), 1,593 on MMC3, from baselines of 3,060 / 3,060 / 3,020 (about 2,902 with magic). The worst
  case, **N = 254 pieces with all six columns**, adds 1,524 B of tables and leaves about 75 B against nesasm's free count (about 55 against
  `battleRegionCeiling` = 8,192 - `BATTLE_SLACK` 20) on the MMC3 naming + magic corner; it is the limit, not a margin, and `checkCapacity`
  refuses anything over it with the message below. **Provisional (not measured in D2):** the conjunctions with `HIT_FEEDBACK` (235 B),
  `MISS` (134), `BATTLE_ANIM` (264), and a streamed map (the tight corner already has a title with Save); the C3/C4 matrix must add them before the allowances are
  frozen, and C4 re-measures the whole table once the dirty-row code is final. Nothing above is claimed beyond what the 60 builds show.
- **Messages** (they name the Forge, never raw nesasm): kernel-lo -> the existing shortfall path with an added line "Equipment
  costs N bytes of the program kernel; remove equipment pieces in the Items Forge, or choose a board with more room in the Build
  panel" (the board clause obeys nit (b) below); banked -> `battleShortfallAdvice` gains a term naming the Items Forge and, when
  `EQUIP_MAG`/`MDEF` is on, the Magic/Magic defence fields.
- **Per-board and per-game-type discipline (CLAUDE.md).** Terms are measured on MMC1, MMC3 and UNROM 512 and stay flat until
  measured to differ (MMC3's banked base is already 40 larger). The game type is always RPG, so that rule is met by the gate; the
  conditions that vary (Save, naming, magic, a streamed map, a title, feedback) are the C3/C4 measurement matrix, and a term stays
  "measured on N cells" in the docs until it is measured on the rest.
- **Byte identity (E4), tested three ways.** (1) The six fixtures' pinned ROM hashes (`items.test.js`'s `PINNED_BASELINE_HASH`
  / `PINNED_RPG_BASELINE_HASH` and the pins in `bankedbytes`, `boundtiles`, `nameentry`, `project`, `streamworldresident`,
  `worldmarkers`, `identitycert`, `identitymatrix`) must pass **unchanged** at every commit but C1b, which deliberately changes the RPG ROMs and so the RPG pins (E9; the action pins still must
  not move); none of the six gains equipment, and E4 is measured against the post-C1b tree.
  (2) C2 adds **per-board pins** for `sample-rpg` on MMC3 and UNROM 512 (today only MMC1 is pinned), captured *after C1b and before* any equipment engine
  change, so C3 and C4 can prove identity on all three RPG boards. (3) A test builds `sample-rpg` with `equip: null` on every
  item and with the section 1 fields present and checks the hash equals the base: the normalized shape itself changes nothing.
  A new file `test/unit/equipidentity.test.js` holds (2) and (3). **D2 adds the E4 cases the review asked for:** (4) a **dormant-equipment
  action project** -- an action game whose `items[]` carry `equip` data -- builds byte-identical to the same project with the fields
  stripped, on every action board; (5) **equipment-free Save and naming variants** -- an RPG with Save on, naming on, and each together
  and apart, on the three boards, builds byte-identical to the post-C1b tree (the probe did this for 24 builds against the pre-fix repo: the patched tree with
  equipment off equals the repo). Both live in `equipidentity.test.js`, and the hashes are captured after C1b and before the first equipment engine change (C2).

## 9. The bundled follow-ups (E3) and the certificate renewal

**(a) Stable diagnostic ids -- without changing either policy.** Today a problem is `{ severity, where, message }`, and two
callers invent an identity for it from the wording: `ruleKey` in `renderer/forges/map/streamedui.js:51` (a *multiset* key:
`where` plus the message's words with digits, plurals and `has/have` folded, quoted names verbatim; `newErrors` ignores the numbers
and counts instances) and `errorKey` + `isNotWorse` in `shared/project.js:8324-8350` (`severity + where` bucket, then
the same digit-folded skeleton with every number **no greater**; `attributedErrors` refuses growth within a message). The
reviewer judged these deliberately different policies; they differ in *counting* (ignore the numbers vs. numbers may not
grow), not in what "the same rule" means. "Stable ids" therefore means only this: **every problem carries a `rule` (a
semantic variant id fixed at its producer) and a structured `subject` (what it is about), and each caller takes "same
problem" from them instead of re-deriving it from the wording -- each keeping its own count policy.** D1 proposed a rule string
alone; the review (F5) showed that is not enough, for three reasons D2's inventory confirms (`d2/probe-diag-sites.*`,
`probe-diag-subjects.*`, `probe-diag-interp.out`): one `add(...)` site can emit several semantic variants (the Tile Forge
reservation error near `shared/project.js:7179` builds three different messages -- the HUD hearts, the MISS overlay, the battle
targeting cursor -- through one call), the unquoted screen and map names live *in the message* (`screenLabel`, `project.js:5219`,
`${map.name} · ${name || `screen N`}`, eleven sites), so two different screens' errors share a rule and differ only in a name, and
the metadata is dropped by forwarding (`validateStreamedMaps` re-adds `streamedBoardProblems` results with `add('error',
problem.where, problem.message)`, losing `kind` and `mapIndex`).

- **Inventory (F5, redone).** Producers of `{severity, where, message}`: `shared/project.js` **64** call sites -- `streamedGridProblems` 2
  (`{mapIndex, message}`), `streamedBoardProblems`' `add` closure plus 6 `add(kind, where, message)` calls (kinds `capability`, `ringGame`,
  `grid`, `deadAxis`; one forwards `streamedGridProblems`' `problem.message`), `validateStreamedMaps` 4 (one forwards the board problems,
  dropping `kind` and `mapIndex`), and `validateProject`'s own `add` closure with **50** `add(` sites (7023-8028; error Map Forge 17,
  warning Map Forge 8, error Sprite Forge 7, warning Sprite Forge 5, error Tile Forge 2, Build 2, Items Forge 2, Sound Forge 2, warning Monster
  Forge 2, Build 1, error Character Forge 1, Monster Forge 1). Seven **message builders outside `validateProject`'s range** feed its
  warnings (`describeMetaspriteDensityWarning` 5420, `describeReservedReferenceWarning` 3122, `describeScreenSpriteWarning` 3833,
  `describeStreamTileWarning` 3721, `describeFieldDensityWarning` 4233, `describeBattleSpriteWarning` 3875,
  `describeBattleAnimationOamWarning` 3995). `main/build/generate.js` **14** more (`checkCode` 4, `checkCapacity` 10) and
  `main/build/battletables.js` **5** (`checkBattleTables`). `shared/cartridge.js`, `shared/library/index.js`,
  `shared/streamlayout.js`, `shared/eventrules.js` have none. By what they interpolate: 33 numbers or nothing named, 10 helper-built, 11
  unquoted `screenLabel`, 7 static, 2 quoted names, 1 quoted plus label. **Wording-derived consumers: three, not two.** `ruleKey`
  (`streamedui.js:51`; multiset `newErrors` :65, used at :120 and :214 via `boardRefusal`); `errorKey` + `messageSkeleton` + `isNotWorse`
  (`project.js:8324` and callers ~8508, 8796, 8866, 8913); and a **third**, local `errorKey = (problem) => `${problem.where}:
  ${problem.message}`` at `generate.js:2384` (`switchableMappers`' tally: a count per key, refuse if any grows), which D1
  missed. `streamedBoardProblems` also feeds `generate.js:3166` and `boardRefusal`.
- **The shape.** A problem becomes `{severity, where, message, rule, subject, counts}` (`counts` is defined below). `rule` is a short kebab id naming one *semantic variant*
  (`tile-reserved-hud-hearts`, `tile-reserved-miss`, `tile-reserved-targeting-cursor`, `screens-per-map`...), not a site: a site that
  chooses between messages passes the matching id. `subject` is a small structured identity, never a string built from names:
  `{map: index}`, `{map, screen}`, `{actor}`, `{tileset}`, `{metasprite}`, `{item}`, `{range: 'hud-hearts'}`... (indices, not names, so a
  rename does not look like a new problem and two same-named screens stay distinct). `add(severity, where, message, rule, subject, counts)`;
  the message builders return `{message, rule, subject, counts}` (or take a callback that does), so the warnings that come from helpers carry them.
  `streamedGridProblems` and `streamedBoardProblems` already carry `mapIndex` and `kind`; `streamedBoardProblems` keeps them and the
  forwarding sites pass `rule` (derived from `kind` plus the rule that failed), `subject` and `counts` through unchanged instead of re-stringifying.
- **`counts`: the producer's numeric vector (D3, answering the second review's F1).** A problem also carries `counts`, an ordered array of the
  *quantities* its message states (a total, a limit, a size), fixed at the producer for that rule and **required** (an empty array when the
  message states none), no longer the optional field D2 left. It is **not parsed from the wording**: a producer lists its own numbers, in the
  order today's message prints them (`holds 271 screens` -> `[271]`), so rewording the message (grammar, plural, word order, a new clause)
  cannot change it. It holds quantities only; which map or screen the problem is about is `subject` (today's `screenLabel` digits are part of
  the message's numbers, which is why the old digit comparison could not tell screen 3 from screen 5). The message builders and the forwarding sites carry `counts` beside `rule` and `subject`. The source-scan test fails on a
  producer without `counts` as it does on one without `rule`.
- **Each caller keeps its policy, keyed on the same identity; the three comparisons differ and stay different.**
  - `ruleKey` (Map Forge): `where | rule | JSON(subject)`; ignores `counts` entirely and is still a **multiset**. `newErrors`
    (`streamedui.js:65-75`) consumes one known instance per matching key: an edit that **raises or lowers the number on an existing
    instance** ("holds 271" -> "holds 272") is not new, and an **added instance** (a second map, a second screen, a rule that was not
    failing) is. The fold table (`IRREGULAR`, `SILENT`, `foldWord`) is deleted: rule + subject replace it.
  - `attributedErrors` (library imports): keeps `errorKey`'s `severity + where` bucket and matches an unclaimed before-instance by `rule` +
    `subject` equality (replacing `messageSkeleton` equality), then compares `counts` **positionally, every value no greater**, with equal
    length (`isNotWorse` today: `after[i] <= before[i]`, equal lengths). So a value that **rises refuses** the import, equal or lower is
    accepted, and an added instance has no unclaimed before-instance and refuses. **A->B migration:** an error that moves between two
    *different unquoted named screens* with the same counts has the same bucket and rule but a different subject, so it is an introduced
    error and the import is refused -- the case wording-based skeletons cannot see.
  - `generate.js:2384` tally (`switchableMappers`): keyed `where | rule | JSON(subject) | JSON(counts)`, a count per key, refuse if any
    count grows -- **equal values required**. Today's key `where: message` embeds the numbers, so one error changing "holds 271" to "holds
    272", or to "holds 270", is a different key and refuses the candidate; keying on `counts` preserves exactly that (a key without `counts`
    would pass both, which is the hole the second review found). Multiplicity is kept: a second identical instance raises the key's count
    and refuses, while a *fall* in multiplicity is accepted as today.
- **Legacy fallbacks, specified separately per caller.** A problem without `rule` (built by code not yet migrated, or a hand-built test
  problem) falls back to **that caller's present derivation**: `ruleKey` to its folded words, `attributedErrors` to `messageSkeleton`
  and the message's own digits, the tally to `where: message`. There is no shared fallback function: D1's single `diagnosticRule(problem)` would have silently changed one
  caller's meaning. The source-scan test fails when any producer lacks `rule` (so the fallbacks stay unreachable in the product).
- **Tests (the ones the review names), all new unless noted:** (1) *migration between different unquoted named screens* -- an
  error on `Overworld . screen 3` becomes the same error on `Overworld . screen 5`: `ruleKey` multiset sees one new, `attributedErrors`
  refuses, the tally refuses; a count change on the same subject is the matrix of test (4); (2) *forwarded rule change* through
  `validateStreamedMaps` -- the board problem's variant changes (grid -> deadAxis on one map) and the forwarded problem's `rule` follows;
  (3) *duplicate instances* -- two identical problems on one subject count as two in the multiset and in the tally, and a second instance
  has no unclaimed before-instance in `attributedErrors`; (4) *values, at all three consumers*, one problem on one subject, before -> after
  (`newErrors` / `attributedErrors` / the `switchableMappers` tally): **equal** -> not new / accepted / accepted; **increase** (271 -> 272)
  -> not new / **refused** / **refused**; **decrease** (272 -> 271) -> not new / accepted / **refused**; **duplicate instance added** -> new /
  refused / refused; **one of two instances removed** -> accepted by all three; (5) *wording-only changes* -- rewording every message (plural,
  word order, an extra clause) changes none of the three results **and does not change any producer's `counts`** (the missing property; a
  `counts` parsed from the words would fail it); (6) `library.test` 16b-16d and 17 and `mapstreamedui.test.js` 177-178 and
  591-598 **pass unmodified**; (7) a source-scan test (`test/lib/sourcescan.js`) over **every producer, including the seven builders, the
  forwarding sites and the two build files**, failing on any `add(` / `problems.push` without `rule`. Sabotage: a `rule` that embeds a count
  makes `newErrors` flag "holds 272" as new; a `subject` built from a name makes a rename look new; a tally key without `counts` passes
  271 -> 272 (the F1 hole); an `attributedErrors` that ignores `counts` accepts the increase. Neither policy changes under E3.
- This lands **first** (C1), so the equipment rules in section 6 are born with ids and subjects and are not swept later.

**(b) The two wording nits.**
- `main/build/generate.js:3126`, `streamedCapacityProblems`: "...or choose a board with more program space in the Build panel"
  cannot work on the largest board. The clause is appended only when a larger streamable board exists
  (`SUPPORTED_MAPPERS.some((m) => m.streamable && m.prgUnits > mapper.prgUnits)`, derived, not the literal id 30); on UNROM 512
  the message ends after "remove one." No test pins the string (grep over `test/`, `docs/`, `main/`, `shared/`, `renderer/`
  found it only in the follow-up note).
- `shared/cartridge.js:305`: MMC3's `summary` becomes "Up to 256 KB of program and 256 KB of graphics: 32 tilesets and 15 screen
  banks." (`prgUnits: 16`, and the README mapper table at line 585 already says 256 KB). `docclaims.test.js` pins the README
  row, not this string, so the change is a one-line edit plus a `cartridge.test.js` assertion that every summary's "N KB of
  program" equals `prgUnits * 16`.

**The renewal, once, at the end (C6).** C1, C1b and C2-C5 change fingerprinted files (`shared/project.js`, `shared/cartridge.js`,
`shared/save.js`, `main/build/generate.js`, `battletables.js`, `engine/*`), so the S5 C3 certificate (baseline `f3833db`, 250-input
harness fingerprint, GATE PASS 146/54/232/0/0, 385 jobs, 84 minutes) is stale. Procedure, as the S4-S6 renewals ran it: (1) a
harness-only commit sets `BASELINE` in `test/lua/ring_gate/ringtree.mjs` to C5's hash and re-cuts the patches with
`node test/lua/ring_gate/regen_patches.mjs` (it asserts every anchor); (2) a small pilot of the matrix; (3) reviewer
CODE-ACCEPT; (4) **one** full run, `node test/lua/ring_gate/run_matrix.mjs --jobs=18` (about 90 minutes); (5)
`node test/lua/ring_gate/ringprovindex.mjs --verify` and `test/lua/run_sw_ring_gate.sh <provenance-dir> <matrix-log-dir>`; (6)
the identity pins (`identitycert`, `identitymatrix`) and the design record's certificate history get the new fingerprint and
a dated section. **[Corrected as built: the identity pins bind to the S3b parent and the sweep stage files, not to the ring fingerprint, so no identity certificate was reissued; the dated section is `docs/design-streamed-worlds-phase3b.md` section 21.]** **E4 makes this checkable early**: no fixture and no ring cell uses equipment, so the six ROM hashes the certificate stamps into
every record must equal the post-C1b values (the RPG hashes changed once, on purpose, at C1b under E9; the action ones equal the
previous certificate's). `node test/lua/ring_gate/fixture-hashes.mjs` (a few minutes; it builds the six from
`mkdtemp` copies) prints them, `fixture-hashes-before.txt` is the precedent for recording the before-state, and a difference means E4 is
broken and the 90-minute matrix is not started. Fix rounds in between run units plus the pilot only
(the "matrix once at the end" rule).

## 10. Tests

Unit tests (file: `test/unit/equipment.test.js` unless named), each with the wrong implementation it catches. D2 reworked rows 2-6, 8,
10-15 after the review (F7); rows 1, 7 (kernel half) and 9 stand as in D1.

1. **Normalization.** Old project -> `equip: null`, `startEquip: [null,null,null]`; out-of-range slot -> `null`; stats clamp;
   `usableBy` masked. *Catches:* a normalizer that defaults `usableBy` to 0 (nobody can wear anything), or that forgets the mask.
2. **`renumberItemDeletion` / `renumberPartyMemberDeletion`.** One project, one item deleted that is Given, dropped, carried-on and
   a `startEquip`; one member deleted whose bit sits mid-mask (`0b1101` -> `0b101`); **edge cases (section 1):** a raw project with nine
   members is refused before codegen; deleting index 8, 31 or -1 leaves every mask unchanged (no JS shift wrap); a mask covering all four
   members becomes the three-member mask; adding a member later extends only "everyone" masks (`grantNewMember`), and undo restores. *Catches:*
   clearing the bit without shifting the higher ones; `1 << index` wrapping at 32; shifting a `startEquip` id but leaving the deleted id;
   renumbering a reference in both helpers; "everyone" silently excluding the newcomer.
3. **Predicates, in isolation (question 7).** For {no piece, MAG only, MDEF only, both, ATK/DEF only} build and assert that
   `projectUsesEquipment`, `projectUsesMagicPower` and `projectUsesMagicDefence` agree with the emitted equates, columns and allowances: a
   column without its flag, or a flag without the per-stat add, fails; an action game with `equip` data -> false everywhere and the ROM equals
   the stripped project. *Catches:* a predicate that ignores `gameType`; a `without` helper that leaves the source; MAG turning on
   magic power but not its column.
4. **`validateProject` rules** (each asserts its `rule` **and `subject`**, section 9): heal-effect piece; wrong-slot `startEquip`;
   action-game warning; unbound-equip warning (C4); `releaseEquipment` leaves no dangling `startEquip`. Plus the diagnostics tests of section 9a.
5. **Save layout.** `saveBodySize()` is 120 and `saveBodySize(equipProject)` is 132; `SAVE_RECORD_LEN` 127 vs 139; `saveIdentity` of
   every fixture is unchanged (pinned) and an equipment project's differs from the same project with equipment off. **Stale-save
   cases (F3), each checksum-valid, built by writing a record into emulated SRAM and recomputing the checksum, on a project with two pieces
   so the feature stays enabled:** (a) a worn byte naming an ordinary item **above the last equipment id** -> after `party_restore` the byte
   is `NO_ITEM`, bonus 0; the byte just past each shortened column is made non-zero in the harness so an unbounded lookup reads a wrong
   value instead of a lucky 0; (b) `$FF` -> accepted; (c) `NUM_ITEMS` and 254 -> `save_check_valid` rejects, Continue is not offered; (d)
   `NUM_ITEMS - 1` boundary accepted. *Catches:* an unconditional field; an identity that forgets the flag; the D1 claim that nothing
   indexes out of range (columns cut at the highest piece).
6. **Generator tables.** `battleTableBytes` equals nesasm's used count to the byte on all three boards with equipment, with and
   without `mag`/`mdef`, **and with columns zero-filled through `NUM_ITEMS`** (`bankedbytes.test.js`'s equality, extended). *Catches:* a
   column emitted but not counted; a column cut at the highest piece.
7. **Kernel and RAM.** `EQUIP_KERNEL_ALLOWANCE` measured by `kernelbytes.test.js`'s method on each board and each of Save/naming;
   `rammap.test.js` on an equipment UNROM 512 build (no overlap; `sw_fc_wy_lo` at $078C) and a non-equipment one (`sw_fc_wy_lo` at
   $0780). *Catches:* a shift applied unconditionally; a flash record grown without moving the block.

Integration tests (boot the built ROM headlessly, assert on engine RAM; addresses from `constants.asm`/`game.fns`; the battle pad bytes
are driven directly, never through the input row; E9 (C1b) makes that row inert under `ST_BATTLE` anyway):

8. **Bonus and damage.** For each stat: equip a +N piece, run a real battle round to completion and read the damage actually dealt
   (`roll_hit` fixed) -- ATK by N more damage to a fixed-defence monster, **DEF by N less damage taken**, **MAG by N more spell damage**,
   **MDEF by N less magic damage taken** -- and the other three stats, other members and monsters do not move; at level stat 250 + 20 the
   result is 255, not 14; **a summed-bonus overflow** (three slots each +100) saturates the *bonus* at 255 as well as the total. *Catches:* a
   bonus added to monsters too, to member 0 only, or without saturation; a DEF bonus that adds instead of subtracting; an MDEF add wired to
   the wrong table.
9. **Swap and bag.** Swapping with a full bag keeps `inv_count`; taking off with a full bag is refused and leaves everything as it was.
   *Catches:* adding the old piece before removing the new one.
10. **Persistence.** **Non-default** equipment on **several members and slots** (member 0 weapon, member 2 armor and accessory, member 3 a
    piece in all three), Save, **reset**, Continue: `pc_equip` (all 12 ids) and each member's four `pc_eq_*` equal their values before. A
    second pass writes the record, then edits the cached bonus so a restore that trusts it would differ. Run in the headless emulator on MMC1,
    MMC3 and the UNROM 512 flash path. The Lua judges get **targeted controls**, each observed as a named verdict flip: (i) *omitted
    serialization* (the field left out of `saveFields`) -> the judge reports `pc_equip` zero after Continue; (ii) *omitted recalc* (`party_restore`
    without `equip_recalc`) -> ids right, bonuses zero; (iii) *unshifted flash scratch* (`EQUIP_SAVE_SHIFT` forced to 0 on a flash build) -> the
    record and `sw_*` bytes disagree (the same RAM-map overlap the checker names, plus corrupted `sw_kb_*` after a save). *Catches:* a
    restore that loads ids but not bonuses; the flash buffer overrunning the relocated `sw_*` block.
11. **Starting equipment, Game Over and late Join.** `startEquip` is applied at New Game and again after a Game Over restart; a member who
    joins later (A6: `equip_init` ran at boot for all four) already holds their `startEquip` and their bonus without any Join code; a member
    never recruited keeps their equipment dormant. *Catches:* applying it only in `party_join`; applying it before `pc_in_party`.
12. **Level-up, status, and item use.** `try_level_up` leaves `pc_eq_*` alone and the effective stat is `level row + bonus`; poison/burn change
    nothing. **Field and battle item use on pieces (A4):** `use_item` on a worn-able piece in the bag does nothing and the piece stays
    (`none` kind); the battle Item menu does not list it (`build_item_list` filters to heal amounts); a hand-built `item_chosen` for a piece
    answers `BS_NOTHING` and removes nothing; a monster drop of a piece lands in the bag (full bag: the existing skip).
13. **The screen (F1, F2).** Drive the pad: open (from gameplay and from the bag), change member, equip, unequip, B out. Assert the stack
    pointer is the same before open and after exit, **no instruction fetch from `$8000-$BFFF` once `game_state` is `ST_GAMEPLAY` (a stack
    count alone is balanced with or without the `pla` pair)**, `game_state` is `ST_GAMEPLAY`, the screen bank is restored, `enc_step` is
    zero, and the **entry event does not replay**. Plus: **(F1 first use)** a fresh boot with an entity active in slot 0 -> open, B out ->
    entity 0 is still active, `bt_from_ent` was `NO_ENTITY`; **(F1 after a flee)** a fight with live monsters, hit feedback and miss on, flee,
    then open Equip -> `mon_slot_alive` zero, `bt_hurt_left` and `bt_miss_left` zero, no monster sprites, no fx; **(F2)** eight eligible
    pieces plus `NONE`: `bt_len` 8, nine navigable rows, Down x8 wraps, select the last real piece -> worn, bag 7; NONE with a full bag is
    refused and the list stays open; **(paused)** the opener does nothing while `paused`; **(allowed members)** the list shows only pieces whose
    `usableBy` has the active member's bit; **(B in the list)** B returns to the slot rows, not the field, and **(Equip Back, E9)** B on a slot row leaves to gameplay with no generated row. Open it from a streamed RPG whose field
    bank differs from the battle bank and assert the field bank is back. Negative controls (the probe's `NEG=`): without `bt_from_ent` the
    first check fails; without the `setup_monsters` reset the flee case fails; without `pla; pla` the fetch check fails. *Catches:* all three.
14. **E4.** `equipidentity.test.js` (section 8), including the **dormant-equipment action project** and the **equipment-free Save/naming
    variants** on all three boards.
15. **Mesen and timing.** The two `mkdtemp` variants of section 5 through `run_sram_check.sh` / `run_flash_check.sh`, with their existing
    negative controls unchanged **plus the three above** (and a streamed + flash + equipment variant); `run_bound_tile_nmi_check.sh`,
    `run_flash_nmi_check.sh` and `run_sw_close_deadline_check.sh` extended with an Equip frame (section 4), each with its own control
    (an unbounded multi-row publish makes the `rti`-before-scanline-257 judge flip); a jsnes assertion that `vram_len <= 34` after every
    Equip tick; an MMC3 check that the register file is the field's at exit and the split is armed correctly after open. *Catches:* the
    flash buffer overrunning the relocated `sw_*` block; a producer that blows the NMI deadline; a lost mapper restore.

**Smoke** (`main/smoke.js`, on a temp copy of `sample-rpg`): Items Forge -> new item -> Equipment on, Weapon, ATK 5 -> Character Forge
lists it under Starting equipment -> select it -> Controller Forge shows `equip` -> bind -> undo/redo each step -> build -> run, press
the bound button, assert the Equip screen is up (a `FORGE_SHOT` screenshot, which settles the legibility risk) and leave. No renderer
console errors.

**Fixtures.** **None of the six gains equipment.** A fixture edit changes its ROM hash, which breaks the pins listed in section 8 and
re-stamps the ring gate's `fixture-hashes.mjs`, and for the four save-check fixtures it changes the Mesen inputs; all of that would
bury the E4 proof under churn. Equipment variants are `mkdtemp` copies of `sample-rpg`/`sample-rpg-mmc1` built by the tests. (If a
shipped example of equipment is wanted, it belongs to a content starter in `shared/starters/`, a separate decision.)

## 11. Slicing

Seven commits (C1, C1b, C2-C6), each independently reviewable, committed locally, one push when the item closes. The authoring UI comes **after** the engine so
no commit offers something the engine does not implement.

| | content | proves |
|---|---|---|
| **C1** | Follow-ups (a) stable ids and (b) the two wording fixes. `shared/`, `main/build/generate.js`, `renderer/forges/map/streamedui.js`, tests. | No ROM changes (all six pins pass); both policies unchanged (`library.test` 16c, `streamedui` tests); rewording a message does not change either result. |
| **C1b** | The B-press battle-input fix (E9, Chris 2026-10-17): `dispatch_input` skips button actions under `ST_BATTLE`, `.if BATTLE_ENABLED` (section 4); the RPG kernel base re-measured per RPG board (about 6 B **[estimate]**); every RPG pin updated deliberately and recorded old -> new; the section 4 tests. `engine/input.asm`, `main/build/generate.js` (kernel base), tests. Its own commit, before any equipment commit. | A real fight's B no longer closes the UI; field B still cancels; the four action pins do not move and every RPG pin moves exactly once; the kernel model equals nesasm on the three RPG boards. |
| **C2** | Data model **only**: `EQUIP_SLOTS`, `RPG_LIMITS.equipSlots`, `normalizeItem`/`normalizePartyMember` fields, predicates, `renumber*` extensions (party-mask edge cases, `grantNewMember`), `releaseEquipment`, the validate rules (with `rule` + `subject`), per-board RPG pins (captured after C1b), `equipidentity.test.js` (including the dormant action project). `shared/` + tests only. **No `ACTIONS` change, no `ACT_EQUIP`, no Controller Forge change (F6)**: the Controller Forge builds its options from `ACTIONS`, so appending before a handler exists would offer a dead action, and the "unbound equip" warning waits for C4. | Old projects normalize as stated; deletions renumber once; the new fields change no ROM on any of the three RPG boards, and `ACTIONS` is untouched (a test pins `ACTIONS.length` 9 until C4). |
| **C3** | Engine bonuses and saves: NUM_ITEMS-long tables, `pc_equip`/`pc_eq_*`, `combatant_*` adds, `equip_recalc` (sanitizer) / `equip_set` / `equip_init` wired into `party_init` and `party_restore`, `saveFields(project)`, identity, `save_check_valid`, `EQUIP_SAVE_SHIFT` in `cartridge.inc` (and `rammap.test.js` reading it), the split allowances (`EQUIP_SAVE_KERNEL_ALLOWANCE` ships here, the opener's 24 B with C4). No menu: pieces are put on by `startEquip` only. | Damage changes by exactly the bonus per stat; saturation; stale-save cases; persistence of non-default equipment on MMC1/MMC3/UNROM 512 with the three targeted controls; flash relocation; allowances measured per board; E4 pins hold. |
| **C4** | The Equip screen **and its opener**: `ACTIONS` append at index 9, `ACT_EQUIP`, Controller Forge availability and label, `do_action_equip` (dual-state, paused refusal), `BP_EQ_*`, the `battle_tick` hook and `draw_battle_screen` tail, the "nothing opens Equip" validate warning, `EQUIP_STRINGS`, the row-per-frame draw and input code, `EQUIP_KERNEL_ALLOWANCE` and `EQUIP_BATTLE_ALLOWANCE` with the schedule's cost folded in (F8). | The screen opens/exits cleanly (stack, no window fetch, bank, no event replay), the F1/F2 cases, the NMI-deadline and MMC3 register checks with controls, streamed variant, allowances re-measured on the full matrix (no item provisional). |
| **C5** | Authoring UI: Items Forge section, Character Forge row, the Select-in-bag bind helper, smoke. (The Controller Forge entry and the unbound-equip warning came with C4.) | The smoke path above; the UI never shows a piece in an action game. |
| **C6** | Certificate renewal (section 9) and docs (section 12), in explicit steps: (6a) the harness-only rebaseline commit; (6b) the pilot; (6c) **an intermediate reviewer pass on the harness commit** (CODE-ACCEPT before the 90-minute run); (6d) the one matrix run, `ringprovindex.mjs --verify`, `run_sw_ring_gate.sh`; (6e) **a final certificate and docs amendment** -- the design record's certificate history and the pins get the new fingerprint, the prior declared cell outcomes and negative controls are **preserved as written** (the amendment adds a dated section, it does not edit the earlier ones), then the docs of section 12. Harness and docs only. | `GATE PASS`, `--verify` clean, ring-cell hashes unchanged since C1b (an RPG cell's hash moved once, at C1b), prior declared outcomes and controls reproduced. |

## 12. Docs at the close

- `ROADMAP.md` item 5 (equipment shipped; classes/growth profiles and encounter groups remain -- E1) and the `README.md` feature table
  (an Equipment row, the Items Forge row).
- `docs/reference-battle-system.md`: the `BP_EQ_*` phases and `battle_end` exit; `combatant_*`'s bonus term; `pc_equip` slot-major layout and its three recalc triggers (`equip_set`, `equip_init`, `party_restore`).
- `docs/reference-kernel-budget.md`: the new allowances with measured per-board figures; `docs/reference-event-system.md`:
  `startEquip`/`usableBy` ownership, the save field and identity rule; `docs/reference-single-writer.md`: `EQUIP_SLOTS`,
  `RPG_LIMITS.equipSlots`, the stat list, the diagnostic `rule` + `subject` shape.
- `docs/reference-engine.md`: the RAM additions and `EQUIP_SAVE_SHIFT`; `docs/reference-fixtures.md`: the `mkdtemp` equipment variants.
- `CLAUDE.md`: **one sentence** only, in the single-writer list (growing the flash save record moves the `sw_*` block; `pc_equip` is slot-major and recalculated at three triggers -- `equip_set`, `equip_init`, `party_restore`; Continue is the restore caller). It is an index under a 40,000-character budget (`docs.test.js`); depth stays in docs.
- This file gains a **Built** section with the build's corrections, as `design-world-overview.md` has.

## Open questions for Chris

D1's seven questions are closed: 1-4 by Chris's rulings E5-E8 below, 5-7 settled in the body as design decisions (the flash scratch block
shifts, section 5; no checked-in fixture gets equipment, sections 5 and 10; authored MAG/MDEF bonuses enable their features, gated
consistently, section 1). D2's one question (the B-press bug: every RPG or only equipment projects) is closed by Chris's ruling E9. **No question remains open.**

## Rulings quoted

Chris, 2026-10-17 (the briefs' wording, verbatim; E5-E8 were given after D1, E9 after D2's review):

- **E1 Scope: equipment.** Weapons and armor as records, equipment slots per party member, stat bonuses applied in
  battle, an in-game Equip menu, and the authoring UI. Encounter groups and classes/growth profiles are NOT in this
  round.
- **E2 Process: like item 7.** This short design doc, reviewed (budget about 2 review rounds); then build commits
  (budget about 3 review rounds each), committed locally and pushed once when the item closes.
- **E3 Bundle the certificate follow-ups.** The build will change `shared/`, `main/build/` and probably `engine/`, so
  it costs a ring-certificate renewal (~90 minutes) anyway. Fold in, as their own small commit, the two follow-ups
  that were waiting for one: (a) stable diagnostic ids, unifying `renderer/forges/map/streamedui.js`'s `ruleKey` with
  `shared/project.js`'s `attributedErrors` (see memory `streamed-worlds-phase4-mapforge-progress.md`, the 2026-10-15
  23:00-23:10 and 2026-10-16 07:15 lines: the reviewer judged them deliberately different policies, so the design
  must say what "stable ids" means without changing either policy); (b) the two fingerprinted wording nits,
  `main/build/generate.js:3126` ("choose a board with more program space", shown on UNROM 512) and
  `shared/cartridge.js:305` (MMC3's "Up to 512 KB" summary) -- see `docs/design-streamed-worlds-phase3b.md` section
  20 for what is wrong with each. Plan one renewal covering everything, at the end.
- **E4 (orchestrator default, from CLAUDE.md's kernel-budget rules).** Equipment's engine cost is conditional: a
  project with no equipment assembles byte-for-byte as it does today, and every allowance is measured per mapper and
  per game type it is charged to. If the design finds this impossible somewhere, name it as an open question.
- **E5 Slots:** three, weapon / armor / accessory.
- **E6 Stats:** ATK / DEF / MAG / MDEF, positive bonuses only, saturating at 255. No HP/MP/speed, no negative bonuses.
- **E7 Worn pieces:** bag only. A worn piece does not count for Carrying, and Take does not remove it from a member.
  Also remove the suggestion that an author can set a switch from an "Equip-opening event" (the reviewer's note on
  question 3: Equip opens by an input action, not an event hook).
- **E8 Opening Equip:** a bindable `equip` action, unbound by default, with the Select-in-bag binding helper.
- **E9 The B-press battle-input bug (2026-10-17):** the B-press battle-input bug is fixed repo-wide, as its own commit right after
  C1 and before any equipment commit. It deliberately changes every RPG ROM and the pinned RPG hashes, and the one certificate
  renewal at the end covers it.

## Built (2026-10-19)

What the build did differently from, or added to, the design above. Commit references are in the Status line.

- **C1 review (F1-F3), as built.** The diagnostic `counts` vector no longer counts quantities its message never states (F1); an aggregate animation
  error keeps the locations it names (F2); and the producer scan in `test/lib/sourcescan.js` follows returned values, including expression-bodied
  arrows, conditional and logical branches and spreads of literal arrays, so the two diagnostic producers this change added are found (F3; scope
  limits are explicit: `return list.map(...)` stays outside it).
- **E9 / C1b: the B-press fix.** Under `ST_BATTLE` the new `beq dispatch_done` in `dispatch_input` skips the old button-dispatch loop, so a B at the
  battle command menu no longer runs `do_action_cancel`. It costs 6 kernel-lo bytes on every RPG board (folded into
  `BATTLE_KERNEL_ALLOWANCE_BY_MAPPER`) and deliberately changed every RPG ROM; the ring certificate's per-cell timing attribution for it is in
  `docs/design-streamed-worlds-phase3b.md` section 21.
- **E11 / C3b: the physical-damage fix** is its own commit (two zero-page operands in `physical_damage`), found by the equipment-free high-ATK monster
  regression, not folded into C3.
- **E12: the Equip frame's NMI `rti` settles before scanline 257**, not 260. `eq_flush` publishes no row into a frame already holding more than
  `EQ_QUEUE_MAX` (35) bytes; `docs/reference-engine.md` has the measured scanlines per board.
- **C5b: the stat preview shows `>`** between the current and candidate value; the glyph is the generated `EQ_CMP_TILE`.
- **Section 9(6) corrected** (above): the identity pins do not bind to the ring fingerprint.
- **C6: the certificate renewal** took the `exact` route (the bound curve's figures were unchanged), issued no new identity certificate, and moved the
  ring gate to baseline `ce7d009` with additive no-flag rebaselines (`s1b-ce7d009.json`, `s1c-ce7d009.json`). Everything it found, decided and
  proved is in `docs/design-streamed-worlds-phase3b.md` section 21: the matrix (385 jobs, 0 unexpected, GATE PASS 146/54/232/0/0), the row-8 harness
  RAM collision with `pc_eq_*` and its relocation to `$07C0-$07CF`, the 44-item counterfactual attributing every moved RPG margin to C1b's six bytes and
  none to C3b, and the `prov_unit.mjs` and `split_prebuild.mjs` checks the release run must include.
- **Not built (E1):** classes and selectable growth profiles, and encounter groups, remain open on `ROADMAP.md`.

## Encounter groups, built afterwards (2026-10-21)

The "encounter groups remain" lines above (section 12, E1 and the Built list) are history. Encounter groups shipped as their own
piece of ROADMAP item 5 (commits `fa0fa3d`, `8a14dcd`, `4b5d17b`, `bf03b65` and the docs commit); the design record is `docs/design-encounter-groups.md`.
Classes and selectable growth profiles are the part of item 5 that remains open.
