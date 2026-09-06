# Design: validate sprite size, palette count and tile budget as you draw (ROADMAP item 8, v7)

**v7 fixes a v6 design omission — missed by every review round, found by a direct probe after Phase 2
was implemented — and keeps the document self-contained — no other file or revision needs to be read
alongside it.** §9 carries the full history of every prior finding and how it was addressed.

## §0. What I read

CLAUDE.md in full (its single-writer-rule passage is this design's spine: any predicate the editor
hint, `validateProject` and the build all consult must live in exactly one function in `shared/`, the
`projectUsesText`/`fontBankSplit` shape). ROADMAP.md item 8 (`ROADMAP.md:1044-1065`, the bullet itself
at `:1057`). `docs/design-modular-parts.md` in full, for its format and because it already built most
of the machinery this design extends (the reserved-range shading precedent, `playerSpriteCollisions`,
the `confirmModal`/shading/hint severity vocabulary).

`shared/project.js`: `LIMITS`, `normalizeMetatile`, `normalizeMetasprite`, `normalizePaletteSet`,
`validateProject`'s tile/sprite entries, `freeTileSlots`, `chrImportOverlap`, `playerSpriteCollisions`
(before its rename), `generatePlayerSpriteCore`, `PLAYER_FRAMES`/`PLAYER_TILES`, `ANIM_SLOTS`,
`normalizeActor`, `normalizeEntity`, `battleFormationSlice`, `mapEncounterFormation`,
`monsterActorIds`, its own top-of-file import block (to confirm exactly what it already imports from
`shared/font.js` and `shared/cartridge.js` before proposing any new function's home), and the exact
line where `normalizeProject` stamps every actor's `id` from its own array position.

`shared/font.js`: `FONT_BASE`, `HEART_FULL_TILE`, `SPRITE_ARROW_TILE`, `fontBankSplit`, `fontChrPages`,
`projectUsesCombat`, `projectUsesHeartArt` (specifically re-verified that this predicate is always
false for `gameType === 'rpg'`, unconditionally). `shared/chr.js` (the 2bpp tile encoding, `BLANK_TILE`,
`isBlank`). `shared/save.js`: its own `MAX_ITEMS` export, every one of its internal uses, its own
import line, and its `saveIdentity`-feeding comment.

`renderer/forges/tile/tile.js`: `paletteKind`/`paletteSet`/`palette`/`transparentZero`, `fontReserved`/
`playerReserved`, `renderSheet`'s two shading blocks, `renderStats`, `importChr`.
`renderer/forges/tile/import.js`: the image-import free-slot scan. `renderer/widgets/sheet.js` (read in
full twice: once for `drawSheet`/`SHEET_COLS`/`reservedUpTo`, once more specifically checking for any
*module-scope* DOM call before deciding where a `node:test`-importable geometry helper belongs — none
found; `document.createElement` appears only inside `drawSheet`'s own function body, `:37`).
`renderer/forges/sprite/sprite.js`: metasprite tile add/drag/offset editing, the `LIMITS.metasprites`/
`LIMITS.metaspriteTiles` disabled-button precedent, the Generate-modal collision summary.
`renderer/forges/map/map.js`: entity placement, the `Actors on this screen (n/8)` header.
`renderer/forges/build/build.js`: `renderSummary`, its `meter()` helper, the Problems list, and its own
`build:log` subscription. `main/ipc.js`'s own forwarding of `build:log`.

`main/build/generate.js`: `kernelTableBytes`, `checkCapacity`, `flattenScreens`, `screenAttributes`,
the old global 64-sprite log line, `animFor` and `resolveItemIcon` in full (before their relocation),
the actor-admission filter in `emitScreens` (`entity.actorId < actorCount`, then direct array-index
lookup), and `spriteTables`'s own compiled `actor_anim_dir` order.

`engine/oam.asm` (`build_oam`) in full, twice — once for the four-OAM-record draw layout, once more for
the player's own `tmp`/`tmp2` row computation. `engine/entities.asm`: `draw_metasprite` in full,
`draw_entities`'s own fixed slot-order loop, `draw_one_entity`'s facing/frame dereference (including the
exact two-step `de_ey`/tile-offset arithmetic runtime performs), and the hide-switch spawn gate.
`engine/boot.asm`'s `main_loop_ui`/`main_loop_draw` call order, including the `BATTLE_ENABLED` early
branch that skips the whole field draw path during a battle frame. `engine/ui.asm`: `draw_ui`/
`draw_menu`/`draw_dialog`/`draw_actor_icon`/`draw_item_icon`, read together to see which draws how many
`draw_metasprite` calls and through which exact resolver. `engine/combat.asm`: `draw_hud` in full (the
heart-loop bound) and `entity_contact` in full (what actually gates a hostile placement).
`engine/rpg.asm` in full: `check_encounter`, `touch_encounter`, `start_encounter` — read directly,
branch by branch, to verify the encounter-prefix arithmetic rather than trust a description of it.
`engine/battleui.asm`'s `battle_draw_sprites` in full (party, fallback-monster, and MMC3-cursor sprite
draws, including the exact call site for `draw_actor_icon`). `engine/battle.asm`'s own
`PARTY_SIZE`-vs-`MAX_PARTY` distinction (why a fixed-4 OAM loop is still safe for a project with fewer
than four party members). `main/build/battletables.js`'s `pc_metasprite`/`mon_tile`/`PARTY_SIZE`
emission. `engine/constants.asm`: `PPUCTRL_ON`, `MAX_ITEMS`, `MAX_PARTY`, `MAX_MONSTERS`, `OAM`'s own
size comment, and its existing note on `startY`'s normalization exceeding `MAX_Y`.

`test/unit/playersprite.test.js` (the existing `playerSpriteCollisions` test). `test/unit/font.test.js`.
`test/unit/kernelbytes.test.js` (confirmed, by grep, that it imports `kernelTableBytes` but never calls
it directly — every existing assertion goes through `checkCapacity`'s combined totals). `test/unit/
items.test.js`'s three existing `animFor`-chain tests, read together to determine exactly which matrix
cell each one covers (directional override, zero frames, no animation at all) and which it does not
(idle fallback). A full-tree grep for every JS-side `MAX_ITEMS` occurrence, to find out who actually
imports it from `shared/save.js` (nobody — both other occurrences are independent local declarations).
`main/smoke.js` (the `step()` helper and how a live hint is asserted via `p.hint` text).

## §1. Inventory — what exists in the current tree, and what this design changes

### §1.1 Palette count is unrepresentable-by-construction, confirmed at the data-format level

A tile is stored as a 64-character string of digits `0`-`3`; `tileToString` (`shared/chr.js:60-64`)
masks every pixel with `& 3`, and `tileFromString` (`:67-75`) degrades any out-of-range character to
`0` at read time. There is no path from a pixel to a fifth colour — the storage format itself is 2bpp.
`LIMITS.palettes = 4` (`shared/project.js:217`) bounds both palette arrays: `normalizePaletteSet`
(`:3420-3426`, called from `normalizeProject` at `:4576-4577`) builds exactly `LIMITS.palettes` entries
for `project.palettes.bg` and `.sprite` alike, each clamped to `[0, 0x3f]`. A metatile names one
palette for all four of its own tiles (`normalizeMetatile`, `:3428-3439`, one `palette` field clamped
`[0, LIMITS.palettes-1]` at `:3436`); a metasprite tile names its own palette per-entry
(`normalizeMetasprite`, `:4073-4087`, `palette` clamped identically at `:4082`). Both are already
capped at exactly 4 by `clamp(..., 0, LIMITS.palettes - 1, 0)` — a fifth palette index cannot be
authored, let alone survive normalization. More than 4 colours per tile or more than 4 palettes is not
a gap this design can validate against; it is a claim the schema already makes true by construction.

The one candidate that looked real — a metatile's four tiles drawn "assuming different palettes" —
is not real either, confirmed by reading the attribute emission itself. `screenAttributes`
(`main/build/generate.js:1505-1532`) packs one NES attribute byte per 32x32 pixel block, but the byte
carries **four independent 2-bit fields, one per 16x16 quadrant** (the `quadrants` table at
`:1512-1517`, each shifted into its own 2-bit slot by `metatiles[id]?.palette`). A 16x16 quadrant is
exactly one metatile. So `metatile.palette` already *is* the hardware's own attribute-table
granularity — one 2-bit selector per metatile, exactly matching the 16x16 block real hardware assigns
one palette to. There is no coarser hardware grouping a metatile's own palette field could disagree
with. No check is proposed for either concern.

A real, but explicitly out-of-scope, adjacent fact: a raw background tile's pixel *indices* are shared
verbatim across every metatile that happens to reference it, and different metatiles can assign that
tile different palettes. This is not a defect — a background tile's stored value is deliberately
palette-independent 2bpp index data — but it does mean the Tile Forge's background-table pixel editor
previews a raw tile under whichever one palette is currently active, not under every palette some
metatile elsewhere in the project has assigned it. That is an authoring-convenience question (a
"preview this tile under every palette that uses it" feature), not a validation question, and is
rejected from this slice for that reason.

### §1.2 Sprite size: four real OAM ceilings, none of them checked before this design

**Sprite mode is 8x8 throughout.** `PPUCTRL_ON = $88` (`engine/constants.asm:1158`) has bit 5 clear,
which is 8x8 sprite mode — every metasprite tile is one hardware sprite.

**Draw order is fixed.** `main_loop_ui`/`main_loop_draw` (`engine/boot.asm:230-243`) run `build_oam`
(player), then `draw_entities` (`engine/entities.asm:542-556`, a fixed loop over `MAX_ENTITIES = 8`
zero-page slots, `engine/constants.asm:467`, in slot order — not placement order, not distance order),
then, outside `BATTLE_ENABLED`, `draw_hud` (hearts), then `draw_ui` (the inventory row or the dialogue
portrait) — unconditionally, on every frame that is not a battle, including a frame where the inventory
menu or dialogue box is open: `main_loop_ui` falls straight into `main_loop_draw` with no branch that
skips `build_oam`/`draw_entities` for those states. So the field's own sprites (player + entities) and
the HUD/menu/portrait overlay are additive on the same frame, not alternatives. A battle frame is the
one exception: `.if BATTLE_ENABLED` branches straight to `main_loop_ready` before `build_oam` ever runs
(`engine/boot.asm:233-237`), because `ui_tick` has already rebuilt the entire shadow itself for that
frame — the field figure and the battle figure are two different frames, never summed.

**Ceiling 1 — a metasprite's own intrinsic scanline density.** A metasprite's own tiles
(`normalizeMetasprite`, up to `LIMITS.metaspriteTiles = 16`, `shared/project.js:4078`) sit at
independent offsets, and nothing counts how many of them can occupy one scanline in isolation from
where the metasprite is placed or which frame is showing. This is a real, useful, *conservative,
position-independent* upper bound on one metasprite's own shape — not "definitive hardware behavior":
`draw_one_entity` (`engine/entities.asm:576-579`) adds the entity's own, byte-sized, runtime `ent_y` to
every tile offset, so an actual on-screen overlap depends on where the entity stands, not only on the
metasprite's own authored shape — two 5-tile metasprites belonging to different entities can overlap on
a real scanline even though each one, alone, is well under 8. And overflow does not "flicker": OAM
order is fixed (restated above), so a tile that loses the race for one of the 8 hardware slots on a
given scanline simply does not appear that frame — a static, missing sprite, not flicker, unless
something else (movement, animation) changes which tiles are competing from one frame to the next.

**Ceiling 2 — the field: player + placed entities, on one screen, resolved to their own worst pose.**
An entity is admitted and read by direct array-index lookup in the compiler
(`entity.actorId < actorCount`, then `project.sprites.actors[entity.actorId]`,
`main/build/generate.js:2929-2945`) — provable to agree with a lookup by stored `id` only because
`normalizeProject` stamps every actor's `id` from its own array position
(`.map((actor, id) => normalizeActor(actor, id, itemCtx))`, `shared/project.js:4704`), not because the
two lookups are interchangeable in general. The real per-facing resolution is `animFor(actor, slot)`
(`main/build/generate.js:3153-3158`) — the directional slot if set, else `idle`, else `NO_ANIM` (draws
nothing). An animation with zero authored frames does not draw nothing: its own compiled data is a
one-byte `.db $00` stub (`spriteTables`, `:3109-3115`), and `draw_one_entity`'s own frame dereference
(`ent_frame,x` doubled and indexed into that stub, `engine/entities.asm:591-595`) reads that byte as
**metasprite 0**, not "no icon" — an existing regression test pins exactly this
(`test/unit/items.test.js:573`, for the identical fallback chain used by an item's derived icon).
Finally, a placement hidden by a switch still spawns and draws whenever that switch is *off* — the
default, initial state — and is skipped only once the switch is set
(`engine/entities.asm:62-67`, `jsr switch_test` / `bne spawn_next`); a "could this screen ever demand N
sprites" bound has to count it, not exclude it.

**Ceiling 3 — the overlay: hearts, the inventory row, the dialogue portrait, additive with Ceiling 2 on
the identical frame (established above).** `draw_hud` (`engine/combat.asm:398-439`) draws exactly
`MAX_HEARTS` sprites — one per heart, full or empty, both drawn (`cpx #MAX_HEARTS`, `:434`) — where
`MAX_HEARTS` is `project.project.maxHearts`, clamped `[1, 6]` (`shared/project.js:4553`). `draw_menu`
(`engine/ui.asm:359-401`) calls `draw_item_icon`/`draw_actor_icon` — each exactly one `draw_metasprite`
call — once per bag slot, up to `inv_count`, whose own ceiling is `MAX_ITEMS = 8`
(`engine/constants.asm:696`). `draw_dialog` (`engine/ui.asm:403-424`) draws **at most one** portrait,
also via `draw_actor_icon`. `ST_MENU` and `ST_DIALOG` are mutually exclusive `game_state` values
dispatched by `draw_ui`'s own `cmp`/`beq` chain (`engine/ui.asm:351-357`), so the inventory row and the
portrait never both draw on the same frame — but each is independently additive with hearts.

**`draw_actor_icon` always draws one specific, fixed frame — never an actor's largest reachable
pose.** `draw_actor_icon` (`engine/ui.asm:428-444`) always resolves `animFor(actor, 'walkDown')` (the
compiled table's first of four per-actor entries, `actor_anim_dir,y` for `y = actor_id * 4`, confirmed
by `animTable`'s own compiled order, `main/build/generate.js:3135-3140`) and always draws that
animation's **frame 0** (`ldy #0` / `lda [ptr_lo],y`, `:440-441`) — never any other facing, never any
other frame. This routine is what the no-items inventory row, the dialogue portrait, **and** battle's
own fallback-monster draw all go through: `battle_sprite_mon`'s own draw call is `tya` /
`jsr draw_actor_icon` (`engine/battleui.asm:864-865`), the identical routine, not a separate
battle-specific resolver. A field entity's own facing/frame state (`draw_one_entity`,
`engine/entities.asm:576-595`) is the one and only place every one of an actor's four compiled facings
and every one of their frames genuinely can be shown — everywhere else in this design that needs an
actor's icon must resolve it through `draw_actor_icon`'s own exact chain, not a maximum over every
pose.

**Ceiling 4 — battle, a wholly separate draw path with its own OAM shadow rebuild, and a fourth,
easy-to-miss way a battle can start.** `battle_draw_sprites` (`engine/battleui.asm:802-904`) runs only
during `ST_BATTLE`, clearing the whole shadow first (`:806-816`) rather than building on top of
`build_oam`'s output — confirmed by `main_loop_draw`'s own early branch to `main_loop_ready` when
`game_state = ST_BATTLE` (`engine/boot.asm:233-237`). It draws, in order: up to `MAX_PARTY = 4`
(`engine/constants.asm:498`) living party members via their own explicit `pc_metasprite` id
(`:818-843`) — a single author-picked metasprite per member, compiled straight from
`project.party[i].metaspriteId` (`main/build/battletables.js:238`), no facing/animation resolution at
all; up to `MAX_MONSTERS = 4` (`:499`) monsters that have **no block art** (`mon_tile,y == $FF`,
compiled from `actor.battle.battleTile === null`, `main/build/battletables.js:150`), each via
`draw_actor_icon` (`:845-869`); and, only on a split-font board with the cursor visible, one more
sprite for the MMC3 targeting cursor (`.if SPLIT_ENABLED`, `:871-902`). The `MAX_PARTY`-bounded loop is
safe even when a project has fewer than four party members for a specific, checked reason: the
compiled `pc_metasprite`/`pc_speed`/etc. tables are exactly `project.party.length` long (`PARTY_SIZE`,
`main/build/battletables.js:235`, a real per-project constant distinct from the fixed RAM allocation
`MAX_PARTY`, `engine/battle.asm:124-126`'s own comment explains the identical distinction for a
different table), but the *loop* (`battleui.asm:842`, `cpx #MAX_PARTY`) always runs 0-3 regardless — it
is safe only because `pc_in_party,x` (zero-initialized RAM, never set true for a slot past
`PARTY_SIZE`) gates the read before `pc_metasprite,x` is ever touched for an out-of-table slot.

**A hostile placed actor is a fourth, entirely separate way a battle can start.** `entity_contact`
(`engine/combat.asm:340-365`) runs for every live, non-hidden entity slot after it has moved, and gates
purely on `actor_damage,y` being non-zero (`:352-354`, `ldy ent_actor,x` / `lda actor_damage,y` /
`beq entity_contact_done`) — no behavior check, no "is this a monster" classification, just contact
damage, in an action game or an RPG alike. On an RPG build (`BATTLE_ENABLED`), a nonzero-damage actor
that is touched jumps to `touch_encounter` (`:358-359`) rather than hurting the player.
`touch_encounter` (`engine/rpg.asm:57-67`) builds a **one-monster formation** directly from the touched
entity's own actor id (`ent_actor,x` into `mon_slot_actor`, the other three slots set to `$FF`) and
starts the fight. So every placement of a damage-dealing actor, anywhere in the project, is its own
reachable formation, regardless of whether that actor ever appears in an authored `battle` command or a
map's encounter table. A hide-switch placement still counts here too, for the identical reason as
Ceiling 2: it spawns and can be touched whenever its switch is off, the default state.

**A map's own encounter table is not reachable at all when its rate is zero.** `check_encounter`
(`engine/rpg.asm:29-53`) reads `map_enc_rate,y` and returns immediately when it is zero (`:36-37`,
`beq check_encounter_done`) — "this map has no wandering monsters."

**The wandering-encounter roll has a real, confirmed off-by-one against its own comment — an engine bug
outside this slice.** `check_encounter` rolls `rng_next`, masks it to `and #3` (0-3, uniformly), and
stores it as `bt_tmp2` before jumping to `start_encounter` (`:46-51`). `start_encounter`'s own header
comment says `bt_tmp2` is "how many of this map's encounter slots to take, minus one" — but its loop
(`:79-93`) fills slot `x` only while `x < bt_tmp2` (`cpx bt_tmp2` / `bcs start_encounter_next`,
branching *away* from filling once `x >= bt_tmp2`), which takes exactly `bt_tmp2` slots, not
`bt_tmp2 + 1` — so a roll of `bt_tmp2 = 0` fills **zero** slots (`start_encounter_none` then fires,
`:94-96`, since slot 0 stays `$FF`) and a roll of `bt_tmp2 = 3` fills **three**, never four. The
comment's own "one to four... minus one" language describes a design where a roll of 0 means one
monster and a roll of 3 means four — the code as written delivers zero-to-three instead, and the fourth
encounter-table slot is dead code no wandering encounter can ever reach today. This is a real,
confirmed engine defect, and fixing it is out of scope for this slice — CLAUDE.md's own testing
discipline requires this slice's byte-identity gate to hold, and fixing a 6502 branch is not something
that gate can survive. **Decision, stated here in full and restated in §3.10/§8**: `battleSpriteBudget`
counts the *full authored formation*, all four slots a rate-nonzero map's own table can name — the
number the engine's own comment describes as intended, and the number it will actually reach once the
off-by-one is fixed as its own, separate, filed defect. Against today's actual, still-buggy runtime,
this makes the figure a **one-icon over-bound** for the wandering-encounter path specifically (today's
worst real roll is three monsters, not four) — never an under-bound. This does not apply to a `battle`
command's own formation (`battleFormationSlice`, unaffected by this roll entirely) or to a
touch-encounter singleton (also unaffected — always exactly one monster, no roll involved).

[Postscript: the off-by-one described above was fixed in a later slice — `start_encounter`'s roll is
now genuinely 1..4, matching the comment it used to contradict, so `battleSpriteBudget`'s four-slot
figure is exact rather than a one-icon over-bound. The passage otherwise stands as written.]

### §1.3 Tile budget: one live per-tileset meter, no kernel-lo visibility, and shading that only works because two existing ranges happen to be row-aligned

`tile.js`'s `renderStats()` (`:381-415`) shows `Tiles used: N / 256` for whichever tileset table is
open, plus standing hints for the font (`fontReserved()`, conditional) and player (`playerReserved()`,
unconditional) reservations. The Build Forge's `renderSummary()` sums Background/Sprite tiles and
Metatiles across every tileset (`renderer/forges/build/build.js:439-442, 584-586`), plus Screens and,
for an RPG, Battle system (`:591, 618`). There is no kernel-lo meter of any kind: `kernelCodeBytes` and
the fixed/table halves of `kernelTableBytes` (`main/build/generate.js:1795-1846`) live in a module that
imports `node:fs` (`:7-8`) and cannot be imported by the renderer. Yet metasprite/animation/actor data
has a real, refusable kernel-lo cost today: `kernelTableBytes`'s `spriteBytes` term (`:1809-1815`) is
`3 * max(1, metasprites.length) + 4 * sum(metasprite.tiles.length) + 3 * max(1, animations.length) + 2
* sum(animation.frames.length) + 8 * max(1, actors.length)` — and this term is pure: it reads only
`project.sprites`, needing neither `flattenScreens` nor `node:fs`.

Three reserved sprite-table ranges exist, enforced at build time by `validateProject`, and shaded
inconsistently in the editor: `$00-$1F` (player, `PLAYER_TILES`, `shared/project.js:164-165`) —
unconditional, every project, shaded on every sheet that shows the sprite table, and never refused by
`validateProject` for raw artwork (a deliberate decision: stamping over this range never destroys an
author's fresh work, it corrects an inconsistency the modular-parts feature exists to fix); `$FE-$FF`
(hearts, `HEART_FULL_TILE = 0xfe`, `shared/font.js:27`) — conditional on `projectUsesHeartArt(project)`
(`:481-483`, always false when `gameType === 'rpg'`, unconditionally, regardless of combat), refused as
an `error` when painted directly (`shared/project.js:5232-5246`), **not shaded anywhere**; `$FD` (the
split-font battle cursor, `SPRITE_ARROW_TILE = 0xfd`, `shared/font.js:36`) — conditional on
`gameType === 'rpg' && fontBankSplit(project, mapper)` (MMC3 only), also refused as an `error`
(`:5248-5263`), also **not shaded anywhere**.

The existing shading for `$00-$1F` and `$A0-$FF` (the font range) works as one simple, bottom-aligned
or single-band rectangle **only because both ranges happen to start at column 0 of their own row and
run to the end of the table** — `PLAYER_TILES = 32` is exactly two full rows of 16, and
`FONT_BASE = 0xa0 = 160` is exactly the start of row 10, with row 15 the table's last. `$FE-$FF`
occupies only the last two columns of row 15; `$FD` occupies only one column of row 15. Neither new
range is row-aligned, so the existing shading code cannot draw either correctly without a
generalization — §3.4 is that generalization.

Nothing anywhere checks whether a metasprite tile *references* an index inside any of these three
ranges (as opposed to raw artwork sitting there in a tileset). A metasprite's `tile` field is a live,
unbounded pointer (`clamp(t?.tile, 0, LIMITS.tilesPerTable - 1, 0)`, `shared/project.js:4081`, no
exclusion of any range) into whichever tileset happens to be banked in.

### §1.4 Existing severity/moment patterns this design reuses rather than inventing new ones

Five shapes already exist and are the full menu CLAUDE.md's own conventions section documents: `p.hint`
with `var(--accent)` for a standing, non-blocking note (`tile.js:387-393`, `build.js:558-582` for four
different examples); a disabled control with its refusal reason in `title`
(`sprite.js:325-328`, the metasprite-cap Add button; `:417`, the metasprite-tile-cap Add button); a
`toast` on a completed action (`import.js`'s free-slot-shortfall message, `:234-236`); a `confirmModal`
before a destructive-but-sometimes-intended action (`tile.js:739-750`, "N of these tiles fall inside
the player's reserved range… will be replaced… Import anyway" — the direct precedent for treating a
reserved-range collision as a warning, not a refusal); and a `validateProject` error or warning
surfaced in the Build Forge's Problems list (`build.js:642-655`, red for `severity: 'error'`, accent
for `'warning'`, both rendered from the identical `{severity, where, message}` shape `add()` pushes,
`shared/project.js:5099`). Every check this design proposes reuses one of these five; none needs a
sixth.

### §1.5 Explicit absences, stated plainly

No per-metasprite scanline-density check exists anywhere. No check models a hostile contact battle
(§1.2's fourth path), a rate-zero map's own exclusion, or the wandering-encounter roll's real prefix
limit. No check resolves an icon-drawing path (inventory-no-items, portrait, battle's fallback
monsters) through the actual, single, fixed routine that draws it, rather than a maximum over every
facing and frame. No check models the field's own position-aware density using real, wrapping, clipped
OAM-Y bytes. No shading, hint, or `validateProject` entry exists for a metasprite *referencing* any of
the three reserved sprite-table ranges. No shading exists for the `$FD`/`$FE-$FF` ranges on either
sheet, and no pure, `node:test`-importable specification of the rectangle geometry needed to shade them
existed before this design. No kernel-lo visibility of any kind exists in the renderer.

## §2. Scope — decided, candidate by candidate

**Accepted, in full:**

1. A metasprite's own intrinsic scanline density (§3.1) — conservative and position-independent, a
   real defect on its own terms regardless of placement.
2. The field figure — player + placed entities, resolved by array-index lookup and the real `animFor`
   fallback chain, including the zero-frame-stub and hide-switch cases (§3.6, §3.8).
3. The overlay figure — hearts + the larger of the inventory row's or the portrait's own worst case,
   shown *beside* the field figure rather than folded into one misleading total (§3.8).
4. A position-aware field scanline bound, at the placed entities' own runtime OAM-Y coordinates plus,
   on the start screen only, the player's own start position — explicitly labeled a heuristic (§3.9):
   it is a real, additional way two individually-legal metasprites can still overflow a scanline
   together, and the position data needed to check it already exists on every placed entity.
5. Battle's own OAM budget — party, fallback-monster, and MMC3-cursor sprites, across every formation
   the project can reach, including a hostile placement's own singleton formation (§3.10).
6. Reserved-tile references from a metasprite, for all three ranges (§3.2, §3.3).
7. A minimal, honest kernel-lo figure for metasprite/animation/actor data (§3.11).

This is every hardware-limit path this design's own review process named; none is deferred without a
stated reason.

**Rejected, with reasons kept here:**

- A metatile's four tiles "assuming different palettes," and attribute-table granularity as an
  authoring blind spot — both false by construction (§1.1).
- A background-tile "preview under every palette that uses it" feature — an authoring convenience,
  not a validation question (§1.1).
- A full kernel-lo meter (`kernelCodeBytes` plus every allowance term). Out of scope:
  `kernelCodeBytes` depends on a large, per-mapper, per-feature allowance table (CLAUDE.md's own
  "kernel budget" section) that has nothing to do with sprites, palettes, or tiles, and moving it would
  be a second, unrelated project with its own single-writer questions.
- Folding HUD hearts, the inventory row, and the dialogue portrait into the *field* figure, or into the
  position-aware sweep. They are a real, computed, separate *overlay* figure instead (§3.8) — a
  deliberate presentation choice, not an omission: the two use genuinely different coordinate spaces
  (screen position vs. fixed HUD position), so combining them into one joint sweep is a materially
  larger calculation than either alone (§8).

## §3. The single-writer predicates

### §3.1 `metaspriteScanlineDensity(metasprite)` — a metasprite's own intrinsic density

```js
export function metaspriteScanlineDensity(metasprite) {
  const tiles = metasprite.tiles ?? [];
  if (!tiles.length) return 0;
  // Half-open [y, y+8) spans -- a tile at y=0 and one at y=8 must not
  // overlap (rows 0-7 vs 8-15), so an "end" event at the same y as a "start"
  // event must be applied first, before that y's own coverage is measured.
  // y=0 and y=7 genuinely overlap (both cover row 7).
  const events = [];
  for (const tile of tiles) {
    events.push([tile.y, 1]);
    events.push([tile.y + 8, -1]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]); // -1 (end) before +1 (start) at a tie
  let running = 0;
  let peak = 0;
  for (const [, delta] of events) {
    running += delta;
    if (running > peak) peak = running;
  }
  return peak;
}
```

This function's own arithmetic operates on a metasprite's *local* tile offsets, which never wrap and
never need clipping — it is an intrinsic property of the metasprite's own shape, independent of where
any entity places it. `hflip`/`vflip` and a tile's own `tile`/`palette` fields never change an 8x8
tile's own row footprint, so they play no part in this arithmetic. Its own sweep is deliberately **not**
shared with `fieldScanlineDensity` (§3.9): that function needs a materially different shape
(max-over-poses-then-sum-across-entities on wrapped, clipped bytes), and forcing the two to share one
helper would either weaken this one or wrongly complicate it.

**Home: `shared/project.js`, beside `normalizeMetasprite`.** **Call sites**: the Sprite Forge's own
standing hint (§6.1) and the matching `validateProject` warning (§4).

### §3.2 `metaspriteTileCollisions(project, indices)` — which metasprites reference a given index set

```js
export function metaspriteTileCollisions(project, indices) {
  const indexSet = new Set(indices);
  const collisions = [];
  (project.sprites.metasprites ?? []).forEach((metasprite, index) => {
    const hits = new Set();
    for (const entry of metasprite.tiles ?? []) {
      if (indexSet.has(entry.tile)) hits.add(entry.tile);
    }
    if (hits.size) collisions.push({ index, name: metasprite.name, tiles: [...hits].sort((a, b) => a - b) });
  });
  return collisions;
}
```

Renamed from `playerSpriteCollisions` (originally `shared/project.js:2774-2785`, written for
`docs/design-modular-parts.md`'s own Generate Player Sprite preflight): the function was already
generic over whatever `indices` it is given, never hardcoded to `PLAYER_TILES` — only its name assumed
one caller. `test/unit/playersprite.test.js:442-461`'s existing assertions must still pass verbatim
under the new name. Deduplicates and sorts each metasprite's own hit set (`[...hits].sort(...)`) so a
metasprite with two tiles referencing the identical reserved index reports that index once, not twice.

**Home: `shared/project.js`.** **Call sites**: the Generate Player Sprite modal's own preflight
(`renderer/forges/tile/tile.js`, unchanged caller, updated import); the Sprite Forge's own standing
reserved-range hint (§6.1), called with the flattened union of every range `spriteReservedRanges`
(§3.3) currently returns; the matching `validateProject` warning (§4).

### §3.3 `spriteReservedRanges(project, mapper)` — which sprite-table ranges are reserved, and why

```js
// shared/project.js -- fontBankSplit, projectUsesHeartArt, HEART_FULL_TILE
// and SPRITE_ARROW_TILE are already imported here one-way from shared/
// font.js; PLAYER_TILES and LIMITS are already local. Putting this function
// in shared/font.js instead would need font.js to import PLAYER_TILES/LIMITS
// back from project.js -- a two-way dependency between the two modules that
// is fragile even where native ESM happens to tolerate it, and it would
// contradict fontBankSplit's own deliberate design: it takes an
// already-resolved `mapper` specifically so it never has to import
// resolveMapper itself, keeping shared/font.js import-free of shared/
// cartridge.js. This function keeps that same discipline for its own mapper
// argument.
export function spriteReservedRanges(project, mapper) {
  const ranges = [{ start: 0, end: PLAYER_TILES, label: 'the player' }];
  if (projectUsesHeartArt(project)) {
    ranges.push({ start: HEART_FULL_TILE, end: LIMITS.tilesPerTable, label: 'the HUD hearts' });
  }
  if (project.project?.gameType === 'rpg' && fontBankSplit(project, mapper)) {
    ranges.push({ start: SPRITE_ARROW_TILE, end: SPRITE_ARROW_TILE + 1, label: 'the battle cursor' });
  }
  return ranges;
}
```

`projectUsesHeartArt` is always false for `gameType === 'rpg'` (`shared/font.js:481-483`,
`projectUsesCombat(project) && project.project?.gameType !== 'rpg'`), so the returned ranges are exactly
one of: `[player]` (action, no combat); `[player, hearts]` (action, with combat); `[player]` (RPG, any
non-split-font mapper — never hearts, regardless of combat); `[player, cursor]` (RPG, split-font — two
ranges, never three, since hearts is excluded by game type alone).

**Home: `shared/project.js`, beside `PLAYER_TILES` and `metaspriteTileCollisions`.** **Call sites**:
`tile.js`'s `renderSheet()` (§6.3); `sprite.js`'s tile-picker `drawSheet()` call (§6.1); `validateProject`'s
existing `$FE-$FF`/`$FD` artwork-refusal blocks (`shared/project.js:5232-5263`), rewritten to iterate
this function's own output instead of re-deriving the identical two conditions inline a second time —
same conditions, same ranges, same `error` severity, a pure refactor; the reserved-range reference
warning (§3.2's second caller), which flattens every range's own `[start, end)` into one combined index
list.

### §3.4 `reservedRangeRects(start, end, cols)` — decomposing a reserved range into shadable cell rectangles

```js
// renderer/widgets/sheetgeom.js
//
// Pure integer geometry, zero imports, zero DOM references anywhere in the
// file -- the CLAUDE.md-documented shape a node:test-importable renderer
// helper needs (the same shape gif.js/capture.js already hold to: "DOM-free
// and Node-free... node:test imports them directly"). renderer/widgets/
// sheet.js does not qualify for that today: document.createElement sits
// inside drawSheet's own function body, not at module scope, so importing
// it under node:test would not itself throw, but relying on that
// distinction would be fragile and against the codebase's own convention.
// Not shared/ either: shared/ holds the project-data model and the
// schema-adjacent pure logic that operates on it; a sheet's own column-grid
// geometry has no project-domain meaning at all, and belongs beside its
// existing siblings (SHEET_COLS/SHEET_ROWS/sheetIndexFromEvent) in
// renderer/widgets/ instead.

/**
 * Decompose a half-open tile-index range [start, end) on a `cols`-wide sheet
 * into the minimal set of cell rectangles covering it. Collapses to one
 * rectangle when the whole range sits in a single row, merges every
 * consecutive whole row (including a first or last row that happens to be
 * whole) into one taller rectangle, and returns [] when `end <= start`.
 */
export function reservedRangeRects(start, end, cols) {
  if (end <= start) return [];
  const segments = [];
  let i = start;
  while (i < end) {
    const row = Math.floor(i / cols);
    const rowStart = row * cols;
    const rowEnd = rowStart + cols;
    const segEnd = Math.min(end, rowEnd);
    segments.push({ row, col: i - rowStart, cols: segEnd - i });
    i = segEnd;
  }
  const rects = [];
  for (const seg of segments) {
    const full = seg.col === 0 && seg.cols === cols;
    const prev = rects[rects.length - 1];
    if (full && prev && prev.col === 0 && prev.cols === cols && prev.row + prev.rows === seg.row) {
      prev.rows += 1;
    } else {
      rects.push({ col: seg.col, row: seg.row, cols: seg.cols, rows: 1 });
    }
  }
  return rects;
}
```

Worked examples: `[0, 32)` at `cols = 16` (the player range) produces **one** rectangle,
`{col: 0, row: 0, cols: 16, rows: 2}` — both rows are whole, so they merge, matching the existing
shading's own visual result exactly. `[160, 256)` (the font range) produces one rectangle,
`{col: 0, row: 10, cols: 16, rows: 6}` — rows 10-15, merged. `[254, 256)` (hearts, `$FE-$FF`) produces
one rectangle, `{col: 14, row: 15, cols: 2, rows: 1}` — only the last two columns of the last row.
`[253, 254)` (the arrow, `$FD`) produces `{col: 13, row: 15, cols: 1, rows: 1}` — one cell. `[10, 40)`
at `cols = 16` — a genuinely partial first row, one whole row, and a genuinely partial last row —
produces three rectangles: `{col: 10, row: 0, cols: 6, rows: 1}`, `{col: 0, row: 1, cols: 16, rows: 1}`,
`{col: 0, row: 2, cols: 8, rows: 1}`.

**`drawSheet`'s own shading loop** (`renderer/widgets/sheet.js`, replacing the old single
`reservedUpTo` prefix band with a `reservedRanges: [{start, end}]` option):

```js
for (const range of reservedRanges) {
  for (const rect of reservedRangeRects(range.start, range.end, SHEET_COLS)) {
    const x = rect.col * cell, y = rect.row * cell, w = rect.cols * cell, h = rect.rows * cell;
    context.fillStyle = 'rgba(255, 157, 60, 0.16)';
    context.fillRect(x, y, w, h);
    context.strokeStyle = 'rgba(255, 157, 60, 0.7)';
    context.lineWidth = 1;
    context.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
}
```

`sheet.js` imports `reservedRangeRects` from `./sheetgeom.js`; `tile.js`'s own hand-rolled
`renderSheet()` imports it from the same place directly (not through `sheet.js`, since nothing about it
needs `sheet.js`'s own DOM-touching code path) and runs the identical loop, replacing its two existing
hand-rolled band blocks — but over a **table-specific** range list, never `spriteReservedRanges(...)`'s
own output alone: `spriteReservedRanges` names only sprite-table ranges (player, hearts, cursor), and
`tile.js`'s own sheet shows either the background or the sprite table depending on `state.table`, so
handing its background-table band the sprite-only range list (or vice versa) would either shade a
sprite reservation on the background sheet or silently drop the background table's own font shading.
§6.3 specifies the exact table-specific split this function's two callers actually need.

**Home: `renderer/widgets/sheetgeom.js` (new file).** **Call sites**: `renderer/widgets/sheet.js`'s
`drawSheet` (used by `sprite.js`'s tile-picker); `renderer/forges/tile/tile.js`'s own `renderSheet()`.

### §3.5 `animFor(actor, slot)` and `resolveItemIcon(item, actor, animations, metasprites)` — relocated to `shared/project.js`

```js
// Exactly the existing main/build/generate.js:3153-3158, relocated
// verbatim. The directional slot if set, else idle, else NO_ANIM (draws
// nothing). Needed here because §3.6/§3.8/§3.9/§3.10 all need the real
// per-facing resolution, and a second copy of this exact logic is the
// drift single-writer exists to prevent (the function's own prior home
// already said so of resolveItemIcon's own copy, main/build/
// generate.js:3130-3134).
export function animFor(actor, slot) {
  const value = actor.anims?.[slot];
  if (value !== null && value !== undefined) return value;
  const idle = actor.anims?.idle;
  return idle === null || idle === undefined ? NO_ANIM : idle;
}
```

`main/build/generate.js` imports `animFor` back rather than defining its own copy; `NO_ANIM` is already
exported from `shared/project.js:153`, whose own comment already named `animFor` as the function that
uses it — one module away from where it actually lived before this relocation.

`resolveItemIcon` (originally `main/build/generate.js:3184-3212`) also relocates, one step further
than a literal reading of "move `animFor`" would require: its own derivation branch (an item with no
explicit `metaspriteId`) needs the identical facing/zero-frame fallback chain `resolveActorRestingIcon`
(§3.6) now owns, and reimplementing that chain a third time inside this module would be exactly the
duplication the function's own header comment already warns against. `resolveItemIcon`'s own new body
is in §3.6, where it delegates to `resolveActorRestingIcon` directly. The one caller outside
`generate.js` — `test/unit/items.test.js:24`'s own `import { generateAssets, resolveItemIcon } from
'../../main/build/generate.js'` — updates its import path; `generate.js` re-imports both functions
under their existing names, so its own two call sites (`spriteTables`'s `animTable`, `:3135-3140`, and
`itemTables`'s own `resolveItemIcon` call, `:3241`) need no change beyond the import line.

**Home: `shared/project.js`, both functions.** **Call sites**: `main/build/generate.js`'s
`spriteTables`/`itemTables` (unchanged behavior, relocated import); `resolveActorRestingIcon` (§3.6);
`test/unit/items.test.js` (relocated import).

### §3.6 `resolveActorRestingIcon(actor, animations, metasprites)` — the exact `draw_actor_icon` resolver

```js
// Exactly draw_actor_icon (engine/ui.asm:428-444): the down-facing
// animation's own frame 0, never any other facing or frame -- returned as
// the RAW frame-0 metaspriteId, with NO range check against `metasprites`,
// because neither side of the real chain checks one. normalizeAnimation
// clamps a frame's metaspriteId to a single byte only (`clamp(f?.metaspriteId,
// 0, 255, 0)`, shared/project.js:4096), never to the CURRENT metasprites
// array length, so a metasprite deleted after an animation frame was
// authored to reference it leaves a real, valid, stale byte sitting in the
// project; draw_actor_icon's own runtime read (`lda [ptr_lo],y`, engine/
// ui.asm:441) performs no range check either -- it hands whatever byte is
// there straight to draw_metasprite. resolveItemIcon's own pre-existing
// derivation branch (main/build/generate.js:3208-3211, before this
// relocation) already returned this raw, unchecked value; a version of this
// function that clamped it to NO_METASPRITE instead would be a real,
// accidental behavior change introduced BY this relocation, not a
// correction of one. `metasprites` is accepted for signature symmetry with
// resolveItemIcon's own explicit-id branch (below), which does need it for
// its own, separate bounds check; this function's own derivation does not
// consult it at all.
export function resolveActorRestingIcon(actor, animations, metasprites) {
  if (!actor) return NO_METASPRITE;
  const animId = animFor(actor, 'walkDown');
  if (animId === NO_ANIM) return NO_METASPRITE;
  const frames = animations[animId]?.frames ?? [];
  return frames.length ? frames[0].metaspriteId : 0;
}

// A small, project-scoped convenience wrapper used by every consumer in
// §3.8/§3.10 that wants a tile count rather than a raw metasprite id. This
// is the one place a stale or out-of-range id is actually handled: array
// indexing a JS array past its own end returns `undefined`, so `?.tiles`
// short-circuits to `undefined` and `?? 0` supplies the safe worst-case-bound
// answer -- 0 tiles -- without `resolveActorRestingIcon` itself needing to
// know or care that the id it returned was stale.
function actorRestingIconTiles(actor, project) {
  const id = resolveActorRestingIcon(actor, project.sprites.animations, project.sprites.metasprites);
  return project.sprites.metasprites[id]?.tiles.length ?? 0;
}
```

**`resolveItemIcon`'s own derivation branch now delegates to this, rather than repeating it —
byte-identical output for every input, including a stale, out-of-range derived id (its own explicit-id
branch keeps its own, separate, pre-existing bounds check unchanged — that check was never the one
this relocation had to preserve, only the derivation branch's own lack of one):**

```js
export function resolveItemIcon(item, actor, animations, metasprites) {
  if (item.metaspriteId === NO_METASPRITE) return NO_METASPRITE;
  if (item.metaspriteId !== null) {
    return item.metaspriteId < metasprites.length ? item.metaspriteId : NO_METASPRITE;
  }
  return resolveActorRestingIcon(actor, animations, metasprites);
}
```

**`actorMaxMetaspriteTiles(actor, project)` — the field figure's own resolver, the one place every
facing and every frame genuinely can be shown:**

```js
function animationMetaspriteTileCount(animation, project) {
  // Zero authored frames compiles to a one-byte $00 stub the engine
  // dereferences as metasprite 0, not "draws nothing" (main/build/
  // generate.js's spriteTables, engine/entities.asm's draw_one_entity,
  // test/unit/items.test.js:573's regression proof).
  if (!animation.frames.length) return project.sprites.metasprites[0]?.tiles.length ?? 0;
  let max = 0;
  for (const frame of animation.frames) {
    const metasprite = project.sprites.metasprites[frame.metaspriteId];
    if (metasprite && metasprite.tiles.length > max) max = metasprite.tiles.length;
  }
  return max;
}

// The four facings actor_anim_dir actually compiles (main/build/generate.js's
// spriteTables), in the same order -- walkSide covers both left and right, so
// it is asked twice rather than once here, matching the compiled table
// exactly. (fieldScanlineDensity, §3.9, asks for the three DISTINCT slots
// instead, for its own, different reason.)
const FACING_SLOTS = ['walkDown', 'walkUp', 'walkSide', 'walkSide'];

export function actorMaxMetaspriteTiles(actor, project) {
  if (!actor) return 0;
  let max = 0;
  for (const slot of FACING_SLOTS) {
    const animId = animFor(actor, slot);
    if (animId === NO_ANIM) continue;
    const animation = project.sprites.animations[animId];
    if (!animation) continue;
    const count = animationMetaspriteTileCount(animation, project);
    if (count > max) max = count;
  }
  return max;
}
```

**Home: `shared/project.js`, all four (`resolveActorRestingIcon`, `actorRestingIconTiles`,
`animationMetaspriteTileCount`, `actorMaxMetaspriteTiles`) — the latter three private to the module.**
**Call sites**: `resolveItemIcon` (above); `overlaySpriteBudget`/`formationSpriteCost` (§3.8, §3.10) use
`actorRestingIconTiles`, since both draw through `draw_actor_icon`; `screenSpriteBudget` (§3.8) uses
`actorMaxMetaspriteTiles`, since a field entity's own facing/frame state genuinely can show any of
them.

### §3.7 Central OAM/bag constants

```js
// build_oam (engine/oam.asm) always writes exactly four fixed OAM records --
// four `sta OAM+N` stores in both the parked case (:19-22) and the drawn case
// (four blocks of four stores each, :44-82) -- and leaves oam_idx at 16
// either way (:23-24 parked, :84-85 drawn). Declared outright, not derived
// from PLAYER_TILES / PLAYER_FRAMES's own 32/8 quotient (which happens to
// equal 4 today only because of how the player's own tile storage is laid
// out, and could change independently of build_oam's own draw layout).
export const PLAYER_OAM_ENTRIES = 4;

// The sprite shadow is OAM ($0200, engine/constants.asm:1123, "@size=256"),
// four bytes per hardware sprite.
export const MAX_OAM_ENTRIES = 64;

// The bag's own physical size -- NOT the same concept as LIMITS.items (the
// actor/item id-space ceiling, shared/project.js:236): this is how many
// slots the bag itself has. Mirrors engine/constants.asm's own MAX_ITEMS
// (:696), the one hand-written mirror this design cannot remove, since
// nothing generates engine/constants.asm's own literals. A full-tree grep
// found this codebase already carries three independent hand-written JS
// mirrors of this same engine constant before this design: shared/save.js's
// own (updated below to import from here instead), and two more,
// renderer/emulator/battletest.js:75 and test/unit/battletest.test.js:583 --
// neither of the latter two importing from anywhere, both declaring their
// own literal `8`. All three are consolidated onto this one declaration;
// none is left as an independent mirror after this design.
export const MAX_ITEMS = 8;
```

```js
// shared/save.js -- was its own independent `export const MAX_ITEMS = 8`;
// now imported from the one canonical declaration above and re-exported
// under the identical name, so every existing internal use (`shared/
// save.js:98`, `:242`) and the saveIdentity hash it feeds (`:124`'s own
// "layout facts" comment) are byte-for-byte unchanged.
import { RPG_LIMITS, projectUsesItems, MAX_ITEMS } from './project.js';
export { MAX_ITEMS };
```

**The two remaining hand-mirrors are updated in the same phase, not left as drift.**
`renderer/emulator/battletest.js:75` (`const MAX_ITEMS = 8; // engine/constants.asm`) and
`test/unit/battletest.test.js:583` (`const MAX_ITEMS = 8; // engine/constants.asm`) both become
`import { MAX_ITEMS } from '../../shared/project.js';` (adjusted for each file's own relative path) —
the unit test already imports several other bindings from that module (`mapEncounterFormation`,
`RPG_LIMITS`, `createScreen`), so this adds one name to an existing import rather than a new one.
Leaving either in place would make "one canonical declaration" a false claim the moment either file's
own literal drifted from the real engine constant with nobody noticing — the exact risk a
single-writer consolidation exists to close, and closing it for one of three mirrors while leaving two
untouched closes none of the real risk.

**Home: `PLAYER_OAM_ENTRIES`/`MAX_OAM_ENTRIES`/`MAX_ITEMS` all in `shared/project.js`.** **Call sites**:
`screenSpriteBudget` (`PLAYER_OAM_ENTRIES`, `MAX_OAM_ENTRIES`, §3.8); `overlaySpriteBudget`
(`MAX_ITEMS`, §3.8); `battleSpriteBudget` (`MAX_OAM_ENTRIES`, §3.10); `shared/save.js` (`MAX_ITEMS`,
re-exported); `renderer/emulator/battletest.js` and `test/unit/battletest.test.js` (`MAX_ITEMS`,
imported directly, replacing their own former independent declarations).

### §3.8 `screenSpriteBudget(project, screen)` and `overlaySpriteBudget(project)` — the field and overlay figures

```js
export function screenSpriteBudget(project, screen) {
  const field = screen.entities.reduce((total, entity) => {
    // Direct array-index lookup, matching the compiler exactly (main/build/
    // generate.js's emitScreens: entity.actorId < actorCount, then
    // actors[entity.actorId]). A hide-switch placement is not excluded: it
    // draws whenever its switch is off, the default, initial state
    // (engine/entities.asm:62-67), so it counts toward what this screen
    // could ever demand.
    const actor = project.sprites.actors[entity.actorId];
    return total + actorMaxMetaspriteTiles(actor, project); // every facing genuinely showable here
  }, PLAYER_OAM_ENTRIES);
  return { field, overlay: overlaySpriteBudget(project), limit: MAX_OAM_ENTRIES };
}

function largestActorRestingIconTiles(project) {
  let max = 0;
  for (const actor of project.sprites.actors ?? []) {
    const count = actorRestingIconTiles(actor, project);
    if (count > max) max = count;
  }
  return max;
}

function largestItemIconTiles(project) {
  let max = 0;
  for (const item of project.items ?? []) {
    const actor = project.sprites.actors[item.actorId];
    const iconId = resolveItemIcon(item, actor, project.sprites.animations, project.sprites.metasprites);
    const metasprite = project.sprites.metasprites[iconId];
    if (metasprite && metasprite.tiles.length > max) max = metasprite.tiles.length;
  }
  return max;
}

export function overlaySpriteBudget(project) {
  // draw_hud (engine/combat.asm) draws MAX_HEARTS sprites, full or empty,
  // both drawn -- gated the same way its own reservation is
  // (projectUsesHeartArt: COMBAT_ENABLED and not an RPG).
  const hearts = projectUsesHeartArt(project) ? (project.project?.maxHearts ?? 3) : 0;
  // draw_menu (engine/ui.asm:359-401) draws up to MAX_ITEMS icons, one
  // draw_metasprite call each -- through draw_item_icon (an item's own exact
  // icon, resolveItemIcon) when ITEMS_ENABLED, otherwise through
  // draw_actor_icon (resolveActorRestingIcon) reading inv_items as raw actor
  // ids directly.
  const inventory = projectUsesItems(project)
    ? MAX_ITEMS * largestItemIconTiles(project)
    : MAX_ITEMS * largestActorRestingIconTiles(project);
  // draw_dialog (engine/ui.asm:403-424) draws at most one portrait, also
  // through draw_actor_icon. ST_MENU and ST_DIALOG are exclusive game_state
  // values (engine/ui.asm:351-357), so the two never draw on the same
  // frame, but each is additive with hearts.
  const portrait = largestActorRestingIconTiles(project);
  return hearts + Math.max(inventory, portrait);
}
```

**Home: `shared/project.js`, `screenSpriteBudget` and `overlaySpriteBudget` exported,
`largestActorRestingIconTiles`/`largestItemIconTiles` private.** **Call sites**: the Map Forge's own
two-line meter (§6.2); a `validateProject` warning naming both `field` and `overlay` for any screen
whose sum exceeds `MAX_OAM_ENTRIES` (§4).

### §3.9 `fieldScanlineDensity(project, screen, { isStartScreen })` — a position-aware field bound

```js
// Every distinct pose (metasprite) reachable through this actor's own three
// distinct facing slots -- walkDown, walkUp, and walkSide asked ONCE, not
// twice, since the compiled table asks for it twice (main/build/
// generate.js:3135-3140) but it is one animation either way. The zero-frame
// stub contributes metasprite 0, the same substitution §3.6 already applies
// to a single icon.
function reachablePoses(actor, project) {
  const animIds = new Set();
  for (const slot of ['walkDown', 'walkUp', 'walkSide']) {
    const animId = animFor(actor, slot);
    if (animId !== NO_ANIM) animIds.add(animId);
  }
  const poseIds = new Set();
  for (const animId of animIds) {
    const animation = project.sprites.animations[animId];
    if (!animation) continue;
    if (!animation.frames.length) { poseIds.add(0); continue; }
    for (const frame of animation.frames) poseIds.add(frame.metaspriteId);
  }
  return [...poseIds].map((id) => project.sprites.metasprites[id]).filter(Boolean);
}

// A single pose's own per-OAM-Y-row tile counts, placed so its local y=0
// lands at OAM-Y `baseY`. Runtime computes (ent_y - 1 + tile.y) & 0xFF
// (engine/entities.asm:576-578 for the -1, :617-619 for the tile.y add) --
// the whole sum wraps as one 8-bit byte, matching real 6502 arithmetic, not
// a signed/unbounded JS number. OAM Y is one scanline above the sprite (the
// identical -1 convention, oam.asm:36/entities.asm:576's own comments), so
// a byte of 239 or more puts the entire sprite's own 8 rows below the
// 240-line visible picture: the sprite's own first drawn scanline is
// OAM-Y + 1, and the visible picture is rows 0-239, so any OAM-Y >= 239 has
// no visible row at all. Wrap first, clip second -- a positive sum that
// wraps past 255 back down to a small value genuinely does reappear at a
// real, visible, low row on real hardware, and must be counted there, not
// treated as still "near the bottom."
function poseRowCounts(metasprite, baseY) {
  const counts = new Map();
  for (const tile of metasprite.tiles) {
    const oamY = (((baseY + tile.y) % 256) + 256) % 256; // wrap first
    for (let row = oamY; row < Math.min(oamY + 8, 239); row++) { // then clip
      counts.set(row, (counts.get(row) ?? 0) + 1);
    }
  }
  return counts;
}

// One entity's own contribution, per row: the MAX across its reachable
// poses, never their sum -- only one pose is ever on screen for a given
// entity at a given instant, so two mutually exclusive poses must never be
// added together.
function entityRowMax(entity, actor, project) {
  const baseY = entity.y - 1;
  const rowMax = new Map();
  for (const pose of reachablePoses(actor, project)) {
    for (const [row, count] of poseRowCounts(pose, baseY)) {
      rowMax.set(row, Math.max(rowMax.get(row) ?? 0, count));
    }
  }
  return rowMax;
}

// The full per-row map this bound is built from -- exported in its own
// right, not merely a private step of fieldScanlineDensity below, because
// the scalar peak alone cannot be tested for per-row correctness: two
// materially different implementations (the player's own two OAM rows
// modeled as two real 8-scanline spans, versus a single-row hit of weight 2
// at each of topRow/bottomRow) can report an identical peak on a
// player-only screen while disagreeing on every other row. Exporting this
// function is the chosen fix over exporting poseRowCounts directly (the
// brief's own two named options): poseRowCounts alone only proves the
// player's own synthetic pose wraps and clips correctly in isolation, but
// says nothing about entityRowMax's own max-over-poses step or the
// sum-across-entities step actually combining with it correctly -- the same
// "prove the real pipeline, not an isolated piece of it" reasoning
// battleTables(project, battleStrings) already applies elsewhere in this
// codebase by taking a test-facing parameter rather than asking a test to
// reach into a private helper. fieldScanlineDensity itself becomes a
// two-line reduction of this function's own output, so there remains
// exactly one place the per-row arithmetic is computed.
export function fieldScanlineRows(project, screen, { isStartScreen } = {}) {
  const total = new Map();
  for (const entity of screen.entities) {
    const actor = project.sprites.actors[entity.actorId];
    if (!actor) continue;
    for (const [row, count] of entityRowMax(entity, actor, project)) {
      total.set(row, (total.get(row) ?? 0) + count); // different entities ARE simultaneous
    }
  }
  if (isStartScreen) {
    // build_oam's own tmp/tmp2 (engine/oam.asm:36-42): top-left and
    // top-right each an 8x8 sprite at OAM-Y `player_y - 1` (tmp), bottom-left
    // and bottom-right each one at `tmp + 8` (tmp2) -- four sprites, two
    // per row, each covering its own 8-scanline span, not two single-row
    // hits of weight 2. Modeled as a synthetic four-tile pose and run
    // through the identical poseRowCounts every other pose already uses,
    // so there is one span implementation in this function, not two: a
    // second, hand-written "just add 2 at one row" version (an earlier
    // draft of this design had exactly that defect) would silently miss any
    // entity tile that overlaps the interior of the player's own span
    // without landing on its very first row.
    const playerPose = { tiles: [{ y: 0 }, { y: 0 }, { y: 8 }, { y: 8 }] };
    for (const [row, count] of poseRowCounts(playerPose, project.project.startY - 1)) {
      total.set(row, (total.get(row) ?? 0) + count);
    }
  }
  return total;
}

export function fieldScanlineDensity(project, screen, opts = {}) {
  return Math.max(0, ...fieldScanlineRows(project, screen, opts).values());
}
```

`isStartScreen` is the caller's own responsibility, computed from both a map index and a screen index,
not one: neither `screen` nor this function's own arguments carry either index, so the caller (the Map
Forge, and every test) must compute `isStartScreen = mapIndex === project.project.startMap &&
screenIndex === project.project.startScreen`.

**Home: `shared/project.js`, `fieldScanlineRows` and `fieldScanlineDensity` both exported,
`reachablePoses`/`poseRowCounts`/`entityRowMax` private.** **Call sites**: `fieldScanlineDensity` is
what the Map Forge's own standing hint and the matching `validateProject` warning both call (§4, §6.2);
`fieldScanlineRows` has no product call site of its own — it exists to be tested directly (§7).

### §3.10 `battleSpriteBudget(project, mapper)` — the project-wide battle OAM figure

```js
// An action project has no battle system at all: entity_contact
// (engine/combat.asm) jumps to hurt_player, never touch_encounter, unless
// BATTLE_ENABLED -- so a hostile placement's "singleton formation" and a
// map's own encounter table are both engine fictions on that build. Gated on
// gameType, the same fact the party term below already keys off of, not on
// codeRegions(...) (whether the mapper actually has room for the battle
// bank): a CHR-RAM board too small for the battle region is already refused
// by checkCapacity on its own, so computing a battle figure for that project
// anyway is harmless -- game type alone is the real, single gate. A v6
// design omission, missed by every review round; found by a direct probe
// after Phase 2 was implemented. See §9 v7.
export function battleSpriteBudget(project, mapper) {
  if (project.project?.gameType !== 'rpg') return { used: 0, limit: MAX_OAM_ENTRIES };
  const actorCount = project.sprites.actors.length;
  const party = project.party.reduce((total, member) => {
    const metasprite = project.sprites.metasprites[member.metaspriteId];
    return total + (metasprite?.tiles.length ?? 0); // $FF (NO_METASPRITE) naturally resolves to 0
  }, 0);
  const formations = battleFormations(project, actorCount);
  const monsters = Math.max(0, ...formations.map((formation) => formationSpriteCost(formation, project)));
  // The MMC3 targeting cursor is one more sprite, whenever the split font is
  // live -- the same SPLIT_ENABLED gate the engine's own cursor draw uses
  // (engine/battleui.asm:871, `.if SPLIT_ENABLED`).
  const cursor = fontBankSplit(project, mapper) ? 1 : 0;
  return { used: party + monsters + cursor, limit: MAX_OAM_ENTRIES };
}

// Every formation the project can reach, from all three sources the engine
// actually has. liveCommands, not allCommands -- a compiled-ROM question,
// the same distinction projectUsesText/projectUsesCombat already draw,
// deliberately different from monsterActorIds' own "what is mentioned"
// catalog rule.
function battleFormations(project, actorCount) {
  const formations = [];
  for (const event of projectEvents(project)) {
    for (const page of compiledPages(event)) {
      for (const command of liveCommands(page.commands, BOX_ROWS)) {
        if (command.op === 'battle') formations.push(battleFormationSlice(command.monsters));
      }
    }
  }
  for (const map of project.maps ?? []) {
    // check_encounter returns immediately when map_enc_rate is zero
    // (engine/rpg.asm:36-37) -- this map's own table can never fire.
    if ((map.encounters?.rate ?? 0) > 0) formations.push(mapEncounterFormation(map, actorCount));
  }
  formations.push(...touchEncounterFormations(project));
  return formations;
}

// entity_contact (engine/combat.asm:340-365) starts a fight through
// touch_encounter (engine/rpg.asm:57-67) for ANY placed actor whose own
// actor_damage is nonzero, gated on nothing else -- a one-monster formation
// per such placement, project-wide, on every screen. A hide-switch
// placement still counts, the same reasoning as §3.8: it draws whenever its
// switch is off, the default state.
function touchEncounterFormations(project) {
  const formations = [];
  for (const map of project.maps ?? []) {
    for (const screen of map.screens ?? []) {
      for (const entity of screen.entities ?? []) {
        const actor = project.sprites.actors[entity.actorId];
        if (actor && (actor.damage ?? 0) > 0) formations.push([entity.actorId]);
      }
    }
  }
  return formations;
}

// A formation's own worst-case sprite cost: only a monster with no block art
// (battleTile === null, i.e. mon_tile === $FF) draws as a sprite at all
// (engine/battleui.asm's battle_sprite_mon, via draw_actor_icon, :845-869)
// -- through the exact resolver, resolveActorRestingIcon, not the field's
// own every-facing maximum.
function formationSpriteCost(formation, project) {
  return formation.reduce((total, actorId) => {
    if (actorId === NO_ACTOR) return total;
    const actor = project.sprites.actors[actorId];
    if (!actor || actor.battle?.battleTile !== null) return total;
    return total + actorRestingIconTiles(actor, project);
  }, 0);
}
```

**The wandering-encounter term deliberately does not truncate `mapEncounterFormation`'s own full,
up-to-four-slot authored table down to the engine's own current, buggy 0-3-slot roll ceiling** (§1.2).
This makes the term a one-icon over-bound against today's actual ROM and exact against the engine's own
stated intent and any future fix — stated here, not silently assumed.

**The whole function is gated on `project.project.gameType !== 'rpg'` before any of the above ever
runs, returning `{used: 0, limit: MAX_OAM_ENTRIES}` outright** — a v6 design omission, missed by every
review round and found only by a direct probe after Phase 2 was implemented (§9 v7): an action project
has no battle bank and no `touch_encounter` at all, so a hostile placement's singleton formation and a
map's own wandering table are both engine fictions there, and reporting a nonzero figure for either
would be validating a system the ROM never assembles. The gate is `gameType`, the same fact the party
term already keyed off of in v6 — not `codeRegions(...).length > 0` (whether the resolved mapper
actually has room for the battle bank): a CHR-RAM board too small for the region is already refused by
`checkCapacity` on its own terms, so this function computing a battle figure for that doomed project
anyway costs nothing extra.

**Home: `shared/project.js`, `battleSpriteBudget` exported, `battleFormations`/
`touchEncounterFormations`/`formationSpriteCost` private.** **Call sites**: the Build Forge's own
RPG-only meter (§6.4); a matching `validateProject` warning (§4). **Surfaced in the Build Forge, not
the Monster Forge**: a formation is not owned by one place in the editor — a `battle` command's own
monster list can be authored inside any actor's event on any screen, a map's wandering table is edited
per-map, and now a hostile placement's own singleton is implicit in the Map Forge's ordinary actor
placement, not an editable "formation" at all. A live, per-formation hint would have to be attached at
every one of those separate surfaces to be complete; a single, project-wide worst-case figure fits
naturally beside the existing, already-RPG-only "Battle system" (kernel bytes) meter the Build Forge
already shows (`renderer/forges/build/build.js:618`), the same "project-wide RPG figure lives here"
precedent that meter already establishes.

### §3.11 `metaspriteKernelBytes(project)` — the sprite/animation/actor kernel-lo byte count

```js
// shared/project.js -- the pure spriteBytes term main/build/generate.js's
// kernelTableBytes (:1809-1815) computed inline. Needs neither
// flattenScreens nor node:fs, so it can live here and be read by the Sprite
// Forge as well as the generator.
export function metaspriteKernelBytes(project) {
  const { metasprites, animations, actors } = project.sprites;
  return (
    3 * Math.max(1, metasprites.length) +
    4 * metasprites.reduce((total, entry) => total + entry.tiles.length, 0) +
    3 * Math.max(1, animations.length) +
    2 * animations.reduce((total, entry) => total + entry.frames.length, 0) +
    8 * Math.max(1, actors.length)
  );
}
```

`main/build/generate.js`'s `kernelTableBytes` replaces its own inline `spriteBytes` computation with
`const spriteBytes = metaspriteKernelBytes(project);` — the formula itself does not change, only which
file names it, so this is a pure relocation, not a rewrite.

**Home: `shared/project.js`.** **Call sites**: `main/build/generate.js`'s `kernelTableBytes`; the
Sprite Forge's own informational `div.kv` (§6.1).

### §3.12 The five warning-message builders — one writer per string, shared by the live hint and the Problems list

**Every one of this design's five new advisory checks (§4) needs message text in two places: a live
hint and a `validateProject` entry.** Writing that text twice — once inline in a Forge's own render
function, once inline in `validateProject` — is exactly the two-independently-maintained-copies shape
CLAUDE.md's single-writer rule exists to prevent, the same reasoning `describePlayerSpritePlan`
(`shared/project.js:2823`) already applies to the Generate Player Sprite modal: "the modal,
`playersprite.test.js` and the smoke assert identical text" because one function writes it, once.
`validateProject` renders `problem.message` verbatim in the Build Forge's own Problems list
(`renderer/forges/build/build.js:647`, `` `${problem.where}: ${problem.message}` ``), so whatever these
functions return is exactly what a user reads there — there is no further formatting step to hide a
sloppy string behind.

```js
export function describeMetaspriteDensityWarning(metasprite, count) {
  return `Metasprite "${metasprite.name}": ${count} of its tiles can share one scanline; the NES ` +
    'can only show 8 there, so some of them will not appear on that row.';
}

// `collision` is one entry of metaspriteTileCollisions' own return array
// (§3.2): {index, name, tiles}. `ranges` is spriteReservedRanges' own output
// (§3.3), consulted only to look up each hit tile's own `label`.
export function describeReservedReferenceWarning(collision, ranges) {
  const labels = collision.tiles.map((tile) => {
    const range = ranges.find((r) => tile >= r.start && tile < r.end);
    const hex = `$${tile.toString(16).toUpperCase().padStart(2, '0')}`;
    return range ? `${hex} (${range.label})` : hex;
  });
  return `Metasprite "${collision.name}" references ${labels.join(', ')}, which will be replaced at ` +
    'build time.';
}

// `budget` is screenSpriteBudget's own return shape (§3.8): {field, overlay, limit}.
export function describeScreenSpriteWarning(project, mapIndex, screenIndex, budget) {
  const total = budget.field + budget.overlay;
  return `${screenLabel(project, mapIndex, screenIndex)} could need ${total} sprites at once ` +
    `(${budget.field} for the player and its actors, plus up to ${budget.overlay} for the HUD and ` +
    `menus); the NES can only show ${budget.limit}.`;
}

export function describeFieldDensityWarning(project, mapIndex, screenIndex, count) {
  return `${screenLabel(project, mapIndex, screenIndex)}: at these actors' own placed positions (a ` +
    `rough estimate — actors and the player both move), ${count} tiles could share one scanline.`;
}

// `budget` is battleSpriteBudget's own return shape (§3.10): {used, limit}.
export function describeBattleSpriteWarning(budget) {
  return `A battle could need ${budget.used} sprites at once; the NES can only show ${budget.limit}.`;
}
```

**`screenLabel(project, mapIndex, screenIndex)` — already exists, `shared/project.js:4008-4013`, and is
the exact existing precedent for naming a screen in a `validateProject` message**, not a new naming
scheme invented for this design: `` `${map.name} · ${name || `screen ${screenIndex}`}` ``, the identical
function two existing checks already call (`shared/project.js:5109`, `:5125`, "`${screenLabel(...)} has
${screen.entities.length} entities; the engine allows ${LIMITS.entitiesPerScreen}.`" — this design's own
`describeScreenSpriteWarning`/`describeFieldDensityWarning` follow that exact wording shape). Iterating
every screen project-wide (for the `validateProject` warnings) uses the existing `flatScreens(project)`
(`shared/project.js:4023-4031`), which already yields `{mapIndex, screenIndex, screen, map, label}` per
screen in engine order — the same function `screenLabel` is built from — rather than a hand-rolled
`for (const map of project.maps) for (const screen of map.screens)` walk that would have to independently
track the two indices `screenLabel` itself needs.

**Live hints call the identical function, even where the surrounding UI already shows some of the
same information — the text is shared by construction, not separately worded to fit each context.** A
Sprite Forge hint for the currently-open metasprite still says `Metasprite "Name": …` rather than just
`…` on its own, even though the pane already makes clear which metasprite is open; a Map Forge hint for
the currently-open screen still says `Map · Screen: …` rather than just `…`, for the identical reason.
This is the same tradeoff `describePlayerSpritePlan`'s own text already accepts inside its own modal.

**Home: `shared/project.js`, all five, beside the checks whose text they write.** **Call sites**: each
function's own live-hint call site (§6.1, §6.2, §6.4) and its own `validateProject` `add(...)` call
(§4); `test/unit/*.test.js` asserts each builder's return value directly against a hand-built input,
independent of any DOM or Problems-list rendering.

## §4. Severity and moment, per check

| Check | Moment | Mechanism | Severity |
|---|---|---|---|
| Metasprite intrinsic scanline density > 8 | Live, editing a metasprite | Sprite Forge `p.hint` (accent), `describeMetaspriteDensityWarning` | — |
| (same) | Build | `validateProject`, `add('warning', 'Sprite Forge', describeMetaspriteDensityWarning(...))` | **warning** |
| Field figure (shown with the overlay figure, never alone) | Live, viewing a screen | Map Forge two-line `div.kv`+`div.meter` | — |
| Field + overlay sum > 64 | Build | `validateProject`, `add('warning', 'Map Forge', describeScreenSpriteWarning(...))` — names the screen, the field count, the overlay count, their total, and the 64 limit | **warning** |
| Position-aware field density (§3.9) | Live, viewing a screen | Map Forge `p.hint` (accent), `describeFieldDensityWarning`, labeled a heuristic | — |
| (same) | Build | `validateProject`, `add('warning', 'Map Forge', describeFieldDensityWarning(...))` | **warning** |
| Battle sprite budget (§3.10) | Live, viewing the Build panel (RPG only) | Build Forge `div.kv`+`div.meter`, `describeBattleSpriteWarning` | — |
| (same) | Build | `validateProject`, `add('warning', 'Build', describeBattleSpriteWarning(...))` | **warning** |
| Metasprite references a reserved sprite-table index | Live, editing a metasprite | Sprite Forge `p.hint`, `describeReservedReferenceWarning`; sheet shading (both sprite-table sheets) | — |
| (same) | Build | `validateProject`, `add('warning', 'Sprite Forge', describeReservedReferenceWarning(...))`, named per metasprite and range | **warning** |
| Raw artwork in `$FE-$FF`/`$FD` | Live, painting | Sheet shading (new — previously unshaded) | — |
| (same) | Build | `validateProject` (existing check, unchanged) | **error** |
| Kernel-lo sprite/animation/actor bytes | Live, viewing the Sprite Forge | Informational `div.kv`, no meter bar | — |

**Warning for every advisory check.** None of the six advisory checks above corrupts data, silently
discards authored work, or produces a ROM that fails to build — each degrades to a real, working game
with a visible (or missing) sprite, the same category this codebase already treats as advisory
elsewhere (`add('warning', 'Sprite Forge', 'No actor deals damage…')`, `shared/project.js:5315`). Every
warning-level check pairs a live hint with a `validateProject` entry, so a runtime truncation is never
reported only where an author happens to be looking: a hint alone, with no `validateProject` entry,
would let a real risk go unmentioned in the Build Forge's own Problems list, the one place CLAUDE.md's
own stated rule requires every such truncation to surface. The two artwork-refusal rows are the
existing, unchanged `$FE-$FF`/`$FD` checks (`shared/project.js:5232-5263`) — genuine `error`-severity
refusals, because that artwork really is destroyed at build time, unlike a metasprite merely
*referencing* one of those indices (which still renders something, just not what was intended).

## §5. Zero engine-cost proof

Every function in §3 is either pure editor/UI logic with no compiled representation (§3.1, §3.2, §3.4's
shading, the Map/Sprite/Build Forge hints and meters), or a `validateProject`-only check — `problems`
never reach the assembler (`checkCapacity`, `main/build/generate.js:1848-1851`, folds `validateProject`'s
own output into `problems`, which `buildProject` reports as build failures/warnings, never as bytes).
The one place this design touches code that *does* feed the ROM is `kernelTableBytes`'s `spriteBytes`
term (§3.11): moving that arithmetic verbatim into `metaspriteKernelBytes` and having `kernelTableBytes`
call it, rather than inlining the formula, is a pure refactor — the returned number is identical for
identical input, by construction, since the expression itself never changes, only which file names it.

**Six fixture hashes prove those fixtures' ROMs did not change; they do not, on their own, prove the
new function is correct or that `kernelTableBytes` actually delegates to it — both are needed.**
`test/unit/kernelbytes.test.js` imports `kernelTableBytes` (`:63`) but never calls it directly anywhere
in the file, confirmed by grep — every existing assertion goes through `checkCapacity`'s combined
totals, which could stay numerically identical even if the extraction silently duplicated the formula
instead of delegating to it. §7's phase 1 therefore adds two further, direct proofs: **per-coefficient
synthetic assertions** against hand-built projects (not the six fixtures), isolating each array's own
floor and its own per-record/per-tile/per-frame coefficient one at a time; and **one delegation-delta
assertion** — load one of the six fixtures, record `kernelTableBytes(project).tableBytes`, add one tile
to an existing metasprite, recompute, and assert the difference is exactly 4 (the per-tile coefficient)
— proving `kernelTableBytes` genuinely calls the new function rather than merely agreeing with it by
coincidence on the six unmodified fixtures. The six-fixture SHA-256 gate (`sample`, `sample-rpg`,
`sample-mmc1`, `sample-mmc3`, `sample-u512`, `sample-rpg-mmc1`, before and after every phase) runs
alongside these, not instead of them — it is still the right proof that nothing about this design
changes a shipped ROM, just not, on its own, a proof that the new function is the thing actually
producing that ROM's numbers.

## §6. UI

### §6.1 The Sprite Forge

**Scanline-density hint**, in `renderMetaspritePane()` (`sprite.js:298-427`), beside the existing
`'p.hint', null, 'Drag a tile on the canvas to move it…'` (`:484`):

```js
metaspriteScanlineDensity(metasprite) > 8
  ? el('p.hint', { style: { color: 'var(--accent)' } },
      describeMetaspriteDensityWarning(metasprite, metaspriteScanlineDensity(metasprite)))
  : null
```

Recomputed on every render — the same "no cached state, just ask the predicate again" discipline
`fontReserved()`/`playerReserved()` already follow (`tile.js:109-116`), so a drag that resolves the
overflow makes the hint disappear on the very next render. The identical `describeMetaspriteDensityWarning`
call, given the same metasprite and count, is what `validateProject`'s own warning uses (§4) — the hint
text and the Problems-list text are the same string by construction, not two independently-worded
copies of the same fact.

**Reserved-range hint**, in the same pane, driven by `metaspriteTileCollisions(store.project,
flattenedReservedIndices)` (the union of every `spriteReservedRanges(...)` entry's own `[start, end)`),
filtered to the currently-selected metasprite:

```js
const ranges = spriteReservedRanges(store.project, resolveMapper(store.project.cartridge.mapper));
const flattenedIndices = ranges.flatMap((r) => Array.from({ length: r.end - r.start }, (_, i) => r.start + i));
const collision = metaspriteTileCollisions(store.project, flattenedIndices).find((c) => c.index === state.metasprite);
collision
  ? el('p.hint', { style: { color: 'var(--accent)' } }, describeReservedReferenceWarning(collision, ranges))
  : null
```

**Reserved-range shading** on the Sprite Forge's own tile-picker sheet (`sprite.js:1203-1209`, which
calls `drawSheet` from `renderer/widgets/sheet.js`): replaces the single `reservedUpTo: PLAYER_TILES`
option with `reservedRanges: spriteReservedRanges(store.project, resolveMapper(store.project.cartridge.mapper))`
— an author sees the shaded bands *before* picking a tile from them, strictly earlier warning than the
hint text, which only fires once a bad pick has already been made.

**Kernel-lo visibility**: a plain `div.kv` (no meter — there is no ceiling to show a percentage of, per
§2's rejection of a full kernel-lo meter): `Sprite/animation/actor tables: N bytes`, computed from
`metaspriteKernelBytes(project)`, placed near the top of the Sprite Forge's own summary area alongside
the existing `Tiles used` line the Tile Forge already shows for the raw tile count.

### §6.2 The Map Forge

**The Map Forge's own state uses `mapIndex`/`screenIndex`, not `mapId`/`screenId` — confirmed by
reading the module rather than guessing at a name.** `state` is declared with `mapIndex: 0, screenIndex:
0` (`map.js:155-157`), and both are read consistently throughout the file — `currentMap()`/
`currentScreen()` (`:185-186`), the screen picker's own click handler (`:371`), and, most directly, the
player-start overlay already does the *exact* comparison this design needs:
`startMap === state.mapIndex && startScreen === state.screenIndex` (`:317`), the identical shape
`isStartScreen` below reuses rather than inventing a new one.

Beside `Actors on this screen (n/8)` (`map.js:1392-1399`), one new field/overlay meter, the exact
`div.kv` + `div.meter` shape `build.js:444-457` already establishes:

```js
const budget = screenSpriteBudget(store.project, screen);
const total = budget.field + budget.overlay;
el('div', { style: { marginBottom: '10px' } },
  el('div.kv', null, el('span', null, 'Field sprites (player + actors, worst pose)'),
    el('span', null, `${budget.field}`)),
  el('div.kv', null, el('span', null, 'Plus up to, for the HUD and menus'),
    el('span', null, `${budget.overlay}`)),
  el('div.meter', null, el('div.meter-fill', {
    class: total > budget.limit ? 'full' : '',
    style: { width: `${Math.min(100, (total / budget.limit) * 100)}%` }
  })),
  total > budget.limit
    ? el('p.hint', { style: { color: 'var(--accent)' } },
        describeScreenSpriteWarning(store.project, state.mapIndex, state.screenIndex, budget))
    : el('p.hint', null, `${total} / ${budget.limit} sprites, worst case.`))
```

Immediately below, the position-aware density hint, labeled as a heuristic in its own text:

```js
const isStartScreen =
  state.mapIndex === store.project.project.startMap && state.screenIndex === store.project.project.startScreen;
const density = fieldScanlineDensity(store.project, screen, { isStartScreen });
density > 8
  ? el('p.hint', { style: { color: 'var(--accent)' } },
      describeFieldDensityWarning(store.project, state.mapIndex, state.screenIndex, density))
  : null
```

Both recomputed on every `renderEntities()` call — the same no-cached-state discipline every other hint
in this design follows. `describeFieldDensityWarning`/`describeScreenSpriteWarning` (§3.12) are the
identical functions `validateProject`'s own warnings for these two checks call (§4), so the Map Forge's
own live text and the Build Forge's Problems-list text agree by construction — down to naming the
screen with `screenLabel`, even though the Map Forge's own hint is already showing the currently-open
screen and does not strictly need to repeat its own name to the author looking at it.

**Integration coverage, not only the pure helper — a threshold-crossing UI fixture with no direct call
into `fieldScanlineDensity` anywhere in the test, so the only way to pass is through the real wiring.**
A version of this test that fell back to comparing two direct `fieldScanlineDensity(project, screen,
{isStartScreen: true})` / `{isStartScreen: false})` calls would prove the *helper*, not that the Map
Forge's own UI correctly derives `isStartScreen` from its real `state.mapIndex`/`state.screenIndex` —
that fallback is deliberately not part of this design. The fixture instead crosses the live-hint
threshold (8) only when the real wiring is correct:

- Two maps, `Map A` (`project.project.startMap = 0`) and `Map B`, each with a screen at the same local
  index as `project.project.startScreen` (say, `1`).
- On **both** of those two screens, place one entity whose resolved metasprite has **seven** tiles, all
  at the identical local `y` offset, positioned so that offset lands on one of the eight rows the
  player's own top span covers at `project.project.startY` — i.e., `entityRowMax` reports `7` at that
  one row on both screens, identically, regardless of which map it is on.
- Navigate through the real Map Forge UI, the same way an author would: select `Map A` via its own map
  picker — the `<select>` inside the field labeled "Map" (`field('Map', ...)`, `map.js:1862-1884`).
  Found in the DOM the same way `main/smoke.js`'s own existing `findFieldInput(labelText)` helper
  already finds a labeled field's control (`:5404-5409`, `` [...document.querySelectorAll('#stage
  .field')].find((f) => f.querySelector('.field-label')?.textContent === labelText) `` , then
  `.querySelector('select')` on that same `.field` div instead of that helper's own `input`) — then
  click the screen at local index `1` in the map's own
  navigator grid, a `<canvas>` whose `title` starts with `Screen 1` (`map.js:357-377`, each screen
  thumbnail's own `onclick` sets `state.screenIndex = index`).
- **On `Map A`'s screen 1 — the real start screen (`mapIndex === startMap && screenIndex ===
  startScreen`)**: the field-density hint is present, reading exactly `9` (`7` from the placed entity
  plus `2` from the player's own span at that row) — its text is exactly what
  `describeFieldDensityWarning(project, 0, 1, 9)` returns: `` `${screenLabel(project, 0, 1)}: at these
  actors' own placed positions (a rough estimate — actors and the player both move), 9 tiles could
  share one scanline.` ``.
- Switch to `Map B` via the identical map-picker `<select>`, then click its own screen at local index
  `1` (the identical navigator-grid lookup). **On `Map B`'s screen 1 — the wrong map, same local
  index**: no field-density hint appears at all — the identical placed entity contributes only `7` at
  that row (no player term, since `isStartScreen` is false there), under the 8-tile threshold.
- **Caught**: exactly the wiring bug this fixture exists to catch — reading the wrong state field (a
  stray `state.mapId` typo, say) or comparing against the wrong project field, either of which would
  leave `isStartScreen` permanently `false` (the hint never appears, even on the real start screen —
  caught by the `9` assertion) or permanently derived from something that happens to look right by
  coincidence on a project with only one map (caught by `Map B`'s own negative case, which a
  single-map project could never distinguish from correct wiring at all).

### §6.3 The Tile Forge

**`spriteReservedRanges` names only sprite-table ranges (player, hearts, cursor — §3.3); the Tile
Forge's own `renderSheet()` toggles between the background and sprite tables (`state.table`), and the
two must never be conflated.** Today, font shading is gated to the background table and player shading
to the sprite table by two separate predicates — `fontReserved()`
(`state.table === 'background' && projectUsesText(...) && !fontBankSplit(...)`) and `playerReserved()`
(`state.table === 'sprites'`), both at `tile.js:109-116` — and this design keeps exactly that gating
structure rather than replacing it with a new, single predicate that would have to reproduce the
identical table split by hand. `renderSheet()` builds a **table-specific range list before the common
rectangle loop**, so a background sheet can never be handed a sprite-only reservation and a sprite sheet
never a background-only one:

```js
// tile.js's own renderSheet() -- fontReserved()/playerReserved() stay the
// existing gates (:109-116) and are the ONLY things this list consults to
// decide which ranges apply to whichever table happens to be open; neither
// predicate is replaced, and neither is re-derived by comparing state.table
// directly a second time (which would duplicate playerReserved()'s own
// `state.table === 'sprites'` body rather than calling it).
const ranges = playerReserved()
  ? spriteReservedRanges(store.project, resolveMapper(store.project.cartridge.mapper))
  : fontReserved()
    ? [{ start: FONT_BASE, end: LIMITS.tilesPerTable, label: 'the message font' }]
    : [];
for (const range of ranges) {
  for (const rect of reservedRangeRects(range.start, range.end, SHEET_COLS)) {
    // fill + stroke, identical to §3.4's own drawSheet loop
  }
}
```

This replaces the two existing hand-rolled, row-aligned-only band blocks (`tile.js:206-237`), verified
to produce the identical pixels for the two ranges that already shaded correctly (`$00-$1F` on the
sprite table, `$A0-$FF` on the background table, both of which decompose to whole-row rectangles,
§3.4's own worked examples) while now also correctly shading `$FD`/`$FE-$FF` as partial-row rectangles
on the sprite table for the first time — and never on the background table, since `playerReserved()` is
false there by its own existing definition, and `ranges` is `[]` for that table unless `fontReserved()`
is true. `renderStats()` (`:381-415`) follows the identical split: its own font hint stays gated on
`fontReserved()` exactly as today, and gains one more conditional hint per non-player *sprite* range
present (hearts, cursor), gated on `playerReserved()`, naming the range's own `label` from
`spriteReservedRanges` — "Tiles \$FE–\$FF are shaded because this project can hurt the player: the HUD
hearts are stamped over them when the ROM is built," and the equivalent for the battle cursor. Neither
hint can appear on the wrong table, because each is gated on the identical predicate its own shading
already uses — the single-writer arrangement the prose above claims, now actually reflected in the code
rather than reproduced as a second, parallel `state.table` comparison.

### §6.4 The Build Forge

One new meter, RPG-only, beside the existing "Battle system" one (`build.js:618`):

```js
const battleBudget = isRpg ? battleSpriteBudget(store.project, mapper) : null;
isRpg
  ? [
      meter('Battle sprites (worst case)', battleBudget.used, MAX_OAM_ENTRIES),
      battleBudget.used > battleBudget.limit
        ? el('p.hint', { style: { marginTop: '-6px', color: 'var(--accent)' } },
            describeBattleSpriteWarning(battleBudget))
        : null
    ]
  : null
```

The four new field/overlay/position-aware/battle `validateProject` warnings, plus the reserved-range
reference warning, all appear in the existing Problems list (`build.js:642-655`) — no other Build Forge
change is needed for those five; every new check is routed through `validateProject` rather than
Forge-specific rendering, which is what lets the Build Forge itself stay this small a change.
`describeBattleSpriteWarning` (§3.12) is the identical function both this meter's own over-budget note
and `validateProject`'s own warning call.

## §7. Phased implementation plan

**Every phase ends with a byte-identical `game.nes` (SHA-256) for all six fixtures.**

**Phase 1 — relocations and central constants, no UI.** Move `animFor`/`resolveItemIcon` into
`shared/project.js` (§3.5); declare `resolveActorRestingIcon` and have `resolveItemIcon` delegate to it
(§3.6); declare `PLAYER_OAM_ENTRIES = 4` and `MAX_OAM_ENTRIES = 64` outright (§3.7); move `MAX_ITEMS`
into `shared/project.js`, with `shared/save.js` importing and re-exporting it under its existing name;
extract `metaspriteKernelBytes` (§3.11). Tests:

- **The `animFor` matrix, all three cells.** Directional override (`anims = {walkDown: A, idle: B}`,
  `A !== B`) resolves to `A` — **caught**: an implementation that checks `idle` first and only falls
  back to the directional slot, which would resolve to `B` instead, passing every *existing*
  `test/unit/items.test.js` case (none of which sets both fields to different values) but failing this
  one. Idle fallback (`anims = {walkDown: null, idle: B}`) resolves to `B` — the actual gap the existing
  suite never covered (`:563` covers only a set `walkDown`, `:573` covers a zero-frame `walkDown`,
  `:588` covers neither field set at all) — **caught**: an implementation that treats a `null`
  directional slot the same as "no fallback exists" and returns `NO_ANIM` regardless of `idle`. Neither
  set (`anims = {}`) resolves to `NO_ANIM` — the one cell the existing suite does cover, re-asserted
  here as the third point of the same matrix.
- `resolveActorRestingIcon`: a real `walkDown` animation's frame 0 resolves to that frame's own
  `metaspriteId`, not the actor's largest reachable pose — **caught**: calling
  `actorMaxMetaspriteTiles`'s own resolution path by mistake, which would report a larger number for an
  actor whose `walkUp` or later frames are bigger; the zero-frame stub resolves to metasprite 0, not
  `NO_METASPRITE` — **caught**: the "more intuitive but wrong" answer `test/unit/items.test.js:573`
  already exists to catch for `resolveItemIcon`, re-asserted here for the new, more general function;
  `resolveItemIcon`'s own three existing tests (`:563, :573, :588`) still pass unchanged after the
  delegation — **caught**: a delegation that subtly changes behavior for any of the three cases already
  under test.
- **A stale-derived-frame regression test**: an animation's `walkDown`-resolved frame 0 names a
  `metaspriteId` past the current `project.sprites.metasprites` array's own end (a metasprite deleted
  after that frame was authored to reference it) — `resolveActorRestingIcon` returns that raw,
  out-of-range id verbatim, not `NO_METASPRITE` — **caught**: reintroducing a bounds check against
  `metasprites.length`, which would silently change behavior for this exact, real, reachable project
  state; the *compiled* `item_metasprite` byte for an item deriving its icon from this same actor is
  byte-for-byte identical before and after the `animFor`/`resolveItemIcon` relocation — **caught**: the
  relocation itself introducing a bounds check that was never there in `main/build/
  generate.js:3208-3211`'s own pre-relocation derivation branch; `actorRestingIconTiles` for this same
  actor still returns tile count `0` (not a thrown error) — **caught**: assuming the raw id is always
  safe to index with directly, rather than going through the `?.tiles.length ?? 0` guard at the one
  place a tile count, not a raw id, is actually needed.
- `PLAYER_OAM_ENTRIES`/`MAX_OAM_ENTRIES`: plain value assertions (`4`, `64`) — no coefficient
  arithmetic to sabotage-test, since neither is derived from anything this design computes; the test
  exists to catch a future accidental edit to either literal without a matching engine change.
- `MAX_ITEMS`, **consolidated at all three of its own former sites in this one phase**:
  `shared/save.js`'s own existing exported binding is referentially the same value after the re-export
  — **caught**: an import cycle or a re-export typo that would leave `save.js`'s own `MAX_ITEMS` as
  `undefined`; `saveIdentity`'s own computed hash, pinned for each of the six fixtures before and after
  the relocation, is unchanged — **caught**: accidentally changing the *value* during the move (the
  hash does not change merely because the declaration moved, since the identical numeric `8` is still
  folded in, `shared/save.js:242` — pinning the existing hash is the whole proof needed here, not a new
  computation); `renderer/emulator/battletest.js` and `test/unit/battletest.test.js` each import the
  relocated constant rather than keeping their own literal `8` — **caught**: updating only
  `shared/save.js` and leaving the other two hand-mirrors in place, which would make "one canonical
  declaration" a false claim the moment either drifted from the real engine constant unnoticed.
- `metaspriteKernelBytes`, **direct coefficient tests, each isolating one term**: an empty project
  (`createProject()`) returns exactly `3 + 3 + 8` (the three `max(1, …)` floors) — **caught**: dropping
  a floor and returning less; going from 1 to 2 metasprites (each with the same fixed tile count, so
  the `4 * sum(tiles.length)` term's own delta is already known and subtracted out) changes the total
  by exactly 3 — **caught**: a hardcoded return value that happens to pass the empty-project test but
  not this one; the identical shape of test for animations (delta of 3 per record) and for a tile/frame
  added to an *existing* record (delta of 4 per metasprite tile, 2 per animation frame) — **caught, per
  component**: swapping which coefficient attaches to which array; going from 1 to 2 actors changes the
  total by exactly 8 — **caught**: reusing the metasprite or animation coefficient by copy-paste error.
  **The delegation-delta proof**: load one of the six fixtures, record
  `kernelTableBytes(project).tableBytes`, add one tile to an existing metasprite, recompute, and assert
  the difference is exactly 4 — **caught**: an extraction that defines `metaspriteKernelBytes` correctly
  but never actually wires `kernelTableBytes` to call it. The six-fixture SHA-256 gate runs alongside
  these.

**Phase 2 — the battle predicate, no UI.** `battleSpriteBudget`/`battleFormations`/
`touchEncounterFormations`/`formationSpriteCost` (§3.10). Tests, each with concrete numbers:

- **Contact battle from a hostile placement**: an actor with `damage: 1`, placed on a screen, named in
  no `battle` command and no map's encounter table at all, still contributes a one-monster formation of
  its own resting-icon size — **caught**: scanning only scripted `battle` commands and map encounter
  tables and never placed entities at all, the exact false negative this design's own inventory found.
- **Rate-zero map excluded**: a map with `encounters.rate = 0` and a full, four-actor
  `encounters.actorIds` table contributes nothing — **caught**: reading `actorIds.length` as the
  admission test instead of `rate`, which would wrongly include this map since its table is non-empty.
- **A four-entry table is charged all four**, not the runtime's own current 0-3 roll ceiling — a map
  with `rate = 1` and four distinct, no-block-art monster actors in `encounters.actorIds` contributes a
  formation whose cost sums all four actors' own resting icons — **caught**: an implementation that
  "helpfully" clamps to what `start_encounter`'s own buggy loop can currently reach (three), silently
  under-counting relative to this design's own stated, deliberate decision (§1.2/§3.10).
- **A monster whose down/frame-0 icon is smaller than its largest pose is charged the icon, not the
  pose** — an actor whose `walkDown` animation's frame 0 is a 2-tile metasprite but whose `walkUp`
  animation reaches a 10-tile one contributes 2, not 10, to its own formation's cost — **caught**:
  reusing `actorMaxMetaspriteTiles` here instead of `actorRestingIconTiles`.
- The overall figure is the **maximum** across every reachable formation, not their sum — **caught**:
  summing every formation's own cost together, which would count monsters from two different,
  mutually-exclusive fights as if they could appear in the same battle.
- **An action project with a hostile placement returns `{used: 0, limit: 64}`** — the identical
  project, switched to `gameType: 'rpg'` and renormalized so it gains its default party, counts that
  same placement's 3-tile resting icon instead — **caught**: no game-type gate, which would report a
  battle budget for a battle system an action build never assembles (`entity_contact` jumps to
  `hurt_player`, never `touch_encounter`, unless `BATTLE_ENABLED`) — a v6 design omission, missed by
  every review round, found by a direct probe after Phase 2 was implemented; see §9 v7.

**Phase 3 — the field position-aware predicate, no UI.** `fieldScanlineRows`/`fieldScanlineDensity`/
`reachablePoses`/`poseRowCounts`/`entityRowMax` (§3.9). Tests, each with concrete numbers:

- **Mutually exclusive poses are not summed**: one entity whose `walkDown` resolves to a 5-tile pose
  and whose `walkUp` resolves to a different 5-tile pose, both placed at the identical local offsets so
  they would occupy the same OAM-Y rows if summed, reports a peak of 5 for that entity's own
  contribution, not 10 — **caught**: unioning every reachable tile across every pose instead of maxing
  them.
- **A `walkSide`-only actor is included**: an actor whose `walkSide` animation is the only one set (both
  `walkDown` and `walkUp` unset, falling back to `idle`, itself unset — `NO_ANIM`) still contributes that
  one pose's own row counts — **caught**: a facing-slot resolution that skips `walkSide` entirely, or
  resolves it to `NO_ANIM` the way an unset `walkDown`/`walkUp` correctly does.
- **Negative underflow wraps to an invisible row, not a JS-negative one**: an entity at `y = 0` with a
  pose tile at `tile.y = -18` computes `oamY = (0 - 1 - 18) & 0xff = 237`, still visible (rows 237-238,
  2 of its 8 rows); a tile placed so the wrapped result lands at or past 239 contributes zero rows —
  **caught**: clamping a negative sum to `0` (top of screen) instead of wrapping it, which would place
  the tile somewhere entirely different from where hardware actually would.
- **Positive byte wrap reappears at a real, visible, low row — and must be counted there, not
  clipped.** `entity.y` is itself normalization-clamped to `[0, 239]` (`shared/project.js:3962`,
  `clamp(raw?.y, 0, 239, 0)`), so the fixture uses a value that clamp can actually produce, not an
  impossible one: `entity.y = 239` with a pose tile at `tile.y = 18` computes
  `oamY = (239 - 1 + 18) & 0xff = 256 & 0xff = 0` — row 0, well within the visible picture —
  **caught**: an implementation that clips anything computed from a large `entity.y` as "near the
  bottom, therefore off-screen" without actually performing the wrap first, wrongly dropping a
  genuinely visible (if visually strange) overlap real hardware would show; also **caught**: a fixture
  builder that lets a test construct an `entity.y` normalization could never produce in the first
  place, which would prove nothing about a reachable project state.
- **Clipping at 239**: a tile whose `oamY = 235` contributes to rows 235-238 only (4 of its 8, the
  portion before 239), and a tile whose `oamY = 239` or more contributes to no row at all — **caught**:
  clipping at 240 instead of 239 (an off-by-one against the documented one-scanline OAM-Y delay), or
  not clipping the *span* and only checking the starting row.
- **The player's own two OAM rows each cover all eight of their own scanlines, not one row of weight
  2 — asserted directly against `fieldScanlineRows`, the one place this is actually observable.**
  `fieldScanlineDensity` exposes only the reduced scalar peak, which cannot by itself distinguish "two
  real 8-row spans" from "two single-row hits of weight 2 at `topRow`/`bottomRow` alone" on a
  player-only screen — both report a peak of `2`. The test therefore calls
  `fieldScanlineRows(project, screen, { isStartScreen: true })` directly, with no placed entities, and
  asserts the returned `Map` holds exactly sixteen entries — every one of
  `[topRow, topRow + 8)`'s eight rows and every one of `[bottomRow, bottomRow + 8)`'s eight rows, each
  valued `2` — not merely that two of them are — **caught**: the exact shape of bug this design itself
  introduced and had to fix, which this row-level assertion catches directly rather than by inference:
  an implementation reporting only two populated map entries (`topRow: 2`, `bottomRow: 2`) fails this
  test immediately, on the map's own `size`, before any per-row value is even compared. The public-API
  `bottomRow + 3` probe stays as well, unchanged, as the integration-level
  proof that a real placed entity's own tile genuinely raises `fieldScanlineDensity`'s own scalar
  result: a placed entity whose own pose tile lands at `bottomRow + 3` (the *interior* of the bottom
  span, not its first row) raises `fieldScanlineDensity`'s own peak to `3` — **caught**: a fix that
  only satisfies the new row-level assertion in isolation without actually wiring
  `fieldScanlineDensity`'s own reduction to read from the corrected map.
- **The `isStartScreen` option, in isolation**: `true` includes the player's own sixteen rows; `false`,
  and omitting the option entirely, includes none of them — **caught**: an implementation that reads the
  option incorrectly, or that includes the player's rows regardless of it. The real two-index caller
  proof — that the Map Forge's own `state.mapIndex`/`state.screenIndex` correctly decide `isStartScreen`,
  not `screenIndex` alone — is not this test's job: a version computing that comparison *inside* the
  test and handing only the resulting boolean to `fieldScanlineRows` could never catch a caller bug,
  since the comparison itself never reaches production code. That proof belongs to, and stays in, Phase
  5's own UI integration test (§6.2's "Integration coverage" fixture), which drives the real Map Forge
  controls rather than calling `fieldScanlineRows` directly.

**Phase 4 — `reservedRangeRects` and the reserved-range fixtures.** `reservedRangeRects` (§3.4) in the
new `renderer/widgets/sheetgeom.js`; `sheet.js`/`tile.js` updated to call it. Unit tests, each a direct,
DOM-free `node:test` case: **empty** (`end <= start` returns `[]`); **same-row partial** (a range
entirely inside one row returns one rectangle, `cols` less than the sheet's own width); **row-aligned**
(the `[0, 32)` case worked through by hand in §3.4, one merged rectangle, not one per row);
**partial-first/partial-last** (the `[10, 40)` case worked through by hand in §3.4, three rectangles);
**multi-row** (a range spanning three or more whole rows plus a partial tail merges every whole row
into one rectangle and keeps the tail separate). **Reservation-range fixtures, three separate,
individually-possible projects**: an action-with-combat project (a damaging actor, metatile, or item)
is charged the player and hearts ranges and asserts the **cursor range is absent** (no RPG, no split
font); an RPG-on-MMC3 project is charged the player and cursor ranges and asserts the **hearts range is
absent** (`shared/font.js:481-483`'s own unconditional RPG exclusion, regardless of how much combat the
project has); an RPG-on-MMC1 project is charged the player range only, asserting **both** hearts and
cursor are absent. `metaspriteTileCollisions`'s own **duplicated-input-indices** case: a metasprite
with two tiles both referencing the identical reserved index reports that index once, deduplicated and
sorted. **Smoke coverage is two explicit, separate runs, not one project asked to show both conditional
ranges at once** — RPG heart art is impossible by predicate (`shared/font.js:481-483`, `projectUsesHeartArt`
is always false when `gameType === 'rpg'`), so a single "RPG-on-MMC3 project with combat" fixture could
never exercise `$FE-$FF` shading no matter how it were built:
  - **Run 1, action-with-combat**: confirm shading rectangles appear at `$FE` and `$FF`'s own sheet
    coordinates, and, as explicit negative controls, confirm `$FC` and `$F0` — both in the same last
    row, immediately adjacent to the reserved cells — remain unshaded; toggle combat off and confirm
    the heart shading disappears while the player range's own shading does not.
  - **Run 2, RPG-on-MMC3**: confirm a shading rectangle appears at `$FD`'s own sheet coordinate, and,
    as the identical negative controls, confirm `$FC` and `$F0` remain unshaded; switch the mapper to
    MMC1 and confirm the cursor shading disappears while the player range's own shading does not.

**A third smoke check, specifically for the table-conflation fix (§6.3): on a text-using, non-MMC3
project (font shading applies, no sprite-only reservation is RPG/split-font-gated), the Tile Forge's
background sheet keeps its existing `$A0-$FF` font band and shows no sprite-table reservation at all**
(no player band, no heart band, regardless of whether the project also has combat) — **caught**: the
literal implementation of the pre-fix design, which handed `spriteReservedRanges(...)`'s own output to
*both* sheets and would have shaded `$00-$1F` (or `$FE-$FF`, with combat) on the background table where
neither belongs. **The sprite sheet, same project, shows the player band and, if the project has
combat, the hearts band — and never a font band**, confirming the two sheets' own range lists are
genuinely independent, not the same list read twice.

**Phase 5 — Map Forge and Build Forge UI, and every `validateProject` warning.** The five message
builders (§3.12), each tested directly against a hand-built input, independent of any rendering:
`describeMetaspriteDensityWarning({name: 'Boss'}, 9)` returns the exact string containing `'Boss'` and
`9` — **caught**: an off-by-one or a hardcoded count that happens to render correctly for one call site
but not another; `describeReservedReferenceWarning` given a collision whose `tiles` fall in two
different ranges names both ranges' own `label`s, not just the first — **caught**: looking up only
`ranges[0]` instead of `ranges.find(...)` per tile; `describeScreenSpriteWarning` given
`{field: 56, overlay: 8, limit: 64}` for a *named* screen includes the screen's own label (via
`screenLabel`), `56`, `8`, `64`, and their sum `64` all as literal substrings — **caught**: omitting any
one of the five (screen name, field, overlay, total, limit), which the brief's own review round
specifically asked to verify a document promising "the message must include the screen name, field
count, overlay count, total, and 64 limit" actually keeps its promise for; the identical assertion
for an *unnamed* screen (`screenLabel`'s own fallback, `` `screen ${screenIndex}` ``) — **caught**: a
builder that assumes every screen has an author-given name; `describeBattleSpriteWarning` and
`describeFieldDensityWarning` get the analogous direct assertions. The two-line field/
overlay meter and the position-aware density hint (§6.2); the battle-sprite Build Forge meter (§6.4);
the four new `validateProject` warnings (metasprite density, field+overlay sum, position-aware density,
battle budget), each calling its own message builder rather than a second, inline copy of the same
text, plus the reserved-range reference warning; deletion of the old global 64-sprite log line
(`main/build/generate.js`'s own `largest * LIMITS.entitiesPerScreen` heuristic) — the Build Forge does
subscribe to and display `build:log` (`renderer/forges/build/build.js:171`, forwarded by
`main/ipc.js:123`), so the real objection to this line is not that it is unseen, but that it is
post-build, global, and worst-case-only, answering "what is the single largest metasprite in the whole
project times the maximum possible entity count" rather than "does this specific screen actually
overflow" — exactly the question §3.8/§3.9 now answer, live, per screen, before a build is ever
attempted. No test asserts the line's own exact text (confirmed by grep before proposing the deletion);
removing the `log()` call changes no `.inc` file and no ROM byte. `main/smoke.js` coverage: a **Map
Forge fixture using heterogeneous actors and fewer than eight placements**, with an
independently-hand-computed expected field/overlay total, chosen so an implementation that silently
reproduces the retired `largest × LIMITS.entitiesPerScreen` heuristic would produce a visibly different,
and therefore caught, number; confirm the meter's `full` class and warning text state both the field
and overlay parts, not a single combined figure with no breakdown; confirm the Build Forge's
battle-sprite meter appears only for an RPG project and updates when a formation is edited. The
**concrete 64/65 boundary fixture, stated precisely enough that its own asserted overlay actually
follows from it**: an action project with combat off (no hearts term), items enabled, one item whose
resolved icon is a single-tile metasprite (`largestItemIconTiles = 1`, so the inventory overlay term is
`MAX_ITEMS * 1 = 8`), and a screen placing four actors, each with **two** authored animations: a
`walkDown` animation whose own frame 0 is an 8-tile-or-smaller metasprite (so every actor's own
*resting* icon — what `resolveActorRestingIcon`/`overlaySpriteBudget`'s `portrait` term would read were
either of these actors ever shown as a portrait — stays at or under 8, keeping the fixture's own stated
`overlay = max(8, portrait ≤ 8) = 8` actually true rather than merely asserted), and a `walkUp` (or
`walkSide`) animation resolving to a 13-tile metasprite — so each actor's own field-figure contribution,
`actorMaxMetaspriteTiles` (which maxes over *every* facing, §3.6), is 13, while its *resting*-icon
contribution, `actorRestingIconTiles` (down-facing frame 0 only), is small. Four such actors placed on
one screen sum to `field = PLAYER_OAM_ENTRIES(4) + 4*13 = 56`; `overlay = max(8, portrait ≤ 8) = 8`;
total `56 + 8 = 64`: no warning. Adding one tile to any one of the four actors' own `walkUp`/`walkSide`
metasprite (13 → 14 tiles) raises the field total to 57 and the grand total to 65: the warning fires —
**caught**: an off-by-one comparing `>` instead of `>=`, or the reverse, against the wrong side of
`MAX_OAM_ENTRIES`; also **caught**, by this fixture's own explicit two-animation construction rather
than by assumption: an implementation that conflates the field figure's own every-facing maximum with
the overlay figure's own down-facing-only resting icon, which — without the fixture forcing the two
values apart like this — could silently pass a looser version of this same test for the wrong reason.

**CLAUDE.md budget note.** CLAUDE.md sits at 134,995 of a 135,000-character budget
(`test/unit/docs.test.js`). Any documentation this slice eventually adds to CLAUDE.md has to trim at
least as much as it adds — the nearest candidate found while reading for this design: the "kernel
budget" section's own worked per-mapper allowance tables (`BASE_KERNEL_CODE_BYTES_BY_MAPPER` and its
siblings) restate the identical "measured, not assumed, per-mapper, per-board" justification in
near-identical prose four separate times (base, title, save, battle); a single shared paragraph stating
the discipline once, followed by four short figures-only entries, would very likely recover more than
this design's own documentation needs, without losing any figure or any of the load-bearing reasoning.
Not attempted here, per the standing instruction not to edit CLAUDE.md as part of a design round.

## §8. What could go wrong

**The field figure and the overlay figure are never combined into one true, single-frame worst case.**
Each is individually accurate to what it models, but the two remain separate numbers, summed only for
the pass/fail comparison, never a joint sweep across both screen-space and HUD-space coordinates
together. Named, not attempted: the two use genuinely different coordinate spaces (screen position vs.
fixed HUD position, hearts/portrait/inventory icons drawn at fixed HUD coordinates rather than screen
coordinates), and combining them into one joint calculation is materially larger than either check
alone.

**`fieldScanlineDensity`'s max-over-poses-then-sum-across-entities is a real, correct worst-case bound
for the set of entities' own possible poses, but still assumes every entity could be showing its own
worst pose at the identical instant every other entity is.** No two poses of the *same* entity are ever
summed together — but one specific real frame reaching every entity's own worst pose simultaneously is
possible, not guaranteed. This is the intended, stated shape of a heuristic check (§3.9's own UI text
says so directly), not a gap.

**`battleSpriteBudget`'s wandering-encounter term is a deliberate, named one-icon over-bound against
today's actual runtime.** Until the encounter-prefix off-by-one (§1.2) is fixed as its own, separate
engine change, a project's real worst wandering encounter is three monsters, not four; this design's
own figure charges for four anyway, matching the engine's own stated intent and comment rather than its
current, buggy behavior — a warning could therefore fire, in principle, for a formation-cost
combination that cannot quite be reached by a wandering encounter specifically today (though it remains
exactly reachable through a `battle` command or a hostile placement's own touch-encounter, neither of
which is affected by this bug). Once the engine fix ships, this term becomes exact with no change
needed here.

**A metasprite can be genuinely, deliberately built by referencing the player's own compiled art, or
the heart/cursor tiles specifically** — an author building a "life-drain" effect that visually borrows
the heart glyph, say, or an NPC deliberately built from copies of the player's own art
(`docs/design-modular-parts.md` §4.4's own already-settled reasoning for the player range, extended
here to all three ranges). The warning fires either way, which is correct, real information — "this
will look like a heart," true regardless of intent — but means an author with a genuinely deliberate
reference sees a standing warning they cannot clear short of picking a different tile. This is the
concrete cost of choosing warning over error for this check (§4): a permanent, ignorable accent-colored
note is the price of not blocking the legitimate case.

**`metaspriteKernelBytes`'s figure has no ceiling shown beside it, which could read as either more or
less alarming than it is.** A bare byte count with no "of how much" is honest about what this design
can show without also relocating `kernelCodeBytes` (§2's rejection of a full kernel-lo meter), but an
author with no mental model for "8192 bytes total, minus a large, mapper-dependent base" has no way to
judge whether a given figure is trivial or means the project is close to a real refusal. The real
refusal, when it happens, still comes from `checkCapacity` with `kernelShortfallAdvice`'s own named,
actionable guidance (CLAUDE.md's "kernel budget" section) — this figure is a directional signal during
editing, not a substitute for that mechanism, and should not be read as one.

**NES hardware sprite-per-scanline and OAM limits are not worsened by anything in this design.** This
design adds visibility into pre-existing hardware ceilings across every path its own review process
named; it does not change what the hardware allows or make hitting any ceiling more or less likely than
authoring the identical project today without this feature.

## §9. Changelog

**v1** — initial design. Scoped the palette-count question as unrepresentable-by-construction; named
the sprite-size gap (a metasprite's own scanline density, and a global, log-only, worst-case OAM
estimate with no per-screen story); proposed `metaspriteScanlineDensity`, `playerSpriteCollisions`
generalized to `metaspriteTileCollisions`, `spriteReservedRanges` (placed, incorrectly, in
`shared/font.js`), and a `screenSpriteBudget` built on `.find(a => a.id === entity.actorId)` and a
maximum over every facing/frame.

**v2** — a full revision after the first review round's ten findings, all accepted: corrected the
draw-order and overlay claims (hearts/inventory/portrait are additive with the field, not
alternatives); split the single "worst case" figure into separate field and overlay figures; added a
position-aware field bound and a first version of the battle OAM budget; renamed
`metaspriteScanlineDensity`'s own framing from "definitive" to "conservative, intrinsic"; moved
`spriteReservedRanges` to `shared/project.js`; corrected the reservation-range test expectations
(`projectUsesHeartArt` is always false for an RPG); reworked §7 to name a wrong implementation per
test; specified `reservedRangeRects` for the first time (a contract only, no code yet); corrected the
retired-log-line rationale; strengthened the kernel-extraction proof with coefficient and delegation
tests.

**v3** — a full revision after a second review round's seven findings, all accepted:

- **Finding 1**: `battleFormations` gained a singleton formation for every placed actor whose
  `actor_damage` is nonzero (`touchEncounterFormations`, modeling `entity_contact`/`touch_encounter`,
  `engine/combat.asm:340-365`, `engine/rpg.asm:57-67`), excluded any map whose `encounters.rate` is zero
  (`engine/rpg.asm:36-37`), and stated the real, confirmed encounter-prefix off-by-one in
  `start_encounter` (`engine/rpg.asm:79-93`) — an engine bug filed separately, left untouched by this
  byte-identity-gated slice — alongside the deliberate decision to model the intended, full four-slot
  formation rather than today's actual 0-3-slot runtime ceiling, a one-icon over-bound stated as such.
- **Finding 2**: `fieldScanlineDensity` was rewritten so an entity's own reachable poses are maxed
  against each other (never summed) before different entities' own contributions are summed against
  each other, `walkSide` is asked for once rather than twice, and every coordinate is the runtime's own
  wrapping `(entity.y - 1 + tile.y) & 0xff` OAM-Y byte, clipped to the visible picture at row 239 — not
  an unbounded JS sum. `metaspriteScanlineDensity` was explicitly left on its own local, non-wrapping
  arithmetic.
- **Finding 3**: a new `resolveActorRestingIcon`, the exact `draw_actor_icon` resolver
  (`engine/ui.asm:428-444`), now backs the no-items inventory term, the dialogue portrait term, and
  battle's fallback-monster term (`engine/battleui.asm:845-869`'s own `draw_actor_icon` call) —
  `actorMaxMetaspriteTiles` is scoped, in both code and prose, to the field figure alone, the one place
  every facing and frame genuinely can be shown. `resolveItemIcon`'s own derivation branch now
  delegates to the new function rather than repeating its fallback chain a third time.
- **Finding 4**: the reservation-range fixtures were split into three separate, individually-possible
  cases (action-with-combat, RPG-on-MMC3, RPG-on-MMC1), each asserting which range is present *and*
  which is absent, replacing an impossible "all three ranges on one RPG-on-MMC3 project" case; an
  impossible "adjacent boundary collision" fixture for `metaspriteTileCollisions` was deleted and
  replaced with a duplicated-input-indices case.
- **Finding 5**: `PLAYER_OAM_ENTRIES = 4` was declared outright, citing `build_oam`'s own four OAM
  records and `oam_idx = 16` directly, not derived from `PLAYER_TILES`/`PLAYER_FRAMES`. The bag size
  gained one canonical declaration in `shared/project.js`, with `shared/save.js` importing and
  re-exporting it under its existing name — and, found while checking who would need updating, neither
  of the *other* two existing hand-written `MAX_ITEMS` mirrors (`renderer/emulator/battletest.js:75`,
  `test/unit/battletest.test.js:583`) actually imports from `shared/save.js` at all; both are
  independent declarations, left alone as out of this slice's own scope.
- **Finding 6**: §7 gained concrete numbers for the 64/65 boundary's own field (4 + 52) and overlay (8)
  components; the full three-cell `animFor` matrix, naming exactly which cell (idle fallback) the
  existing `items.test.js` suite never covered; the field-density mutually-exclusive-pose,
  `walkSide`-dedup, negative-underflow, positive-wrap, and 239-clipping cases, each with worked
  coordinates; the battle contact/rate-zero/four-slot/smaller-icon cases; and `isStartScreen`'s own
  two-index requirement with a second map at the same screen index as the negative control.
- **Finding 7**: `reservedRangeRects` was specified in full for the first time — a half-open
  `[start, end)` decomposition into `{col, row, cols, rows}` rectangles, worked through by hand for five
  cases including the two ranges that already shaded correctly before this design existed — and placed
  in a new, genuinely DOM-free module, `renderer/widgets/sheetgeom.js`, rather than
  `renderer/widgets/sheet.js` (which references `document` inside a function body, not at module scope,
  a distinction this design declines to rely on) or `shared/` (reserved for project-data-model logic,
  not sheet-grid geometry with no project-domain meaning).

**This pass (self-contained repair, no review round)**: every section that previously deferred to a
prior revision ("unchanged from v2," "see v2's own §N," "the same shape as v2") was rewritten to state
its own content directly — the function's code, its home, its signature, every call site, and the
reasoning behind it, all in the present tense. No decision made in v3 changed. Restoring §1.3/§1.4/§2/
§3.1-§3.3/§3.5/§3.11/§4/§5/§6.1-§6.4/§7's phase 5 and CLAUDE.md-budget notes/§8 in full surfaced no
inconsistency with any v3 decision — every restored section already matched the corrected functions
(`resolveActorRestingIcon`, the two-figure field/overlay meter, `reservedRangeRects`'s real
specification) once written out, so nothing needed to change in v3's own favor beyond writing the
content down. The prior revisions' own content is preserved only as history, above.

**v4** — a GO WITH FIXES review's five findings, all accepted:

- **v4, finding 1**: `fieldScanlineDensity`'s own player-row term was rewritten to run through the
  identical `poseRowCounts` span logic every other pose already uses — a synthetic four-tile pose
  (`{y: 0}, {y: 0}, {y: 8}, {y: 8}`, matching `build_oam`'s own two top-row and two bottom-row sprites,
  `engine/oam.asm:36-42`) run through `poseRowCounts(pose, startY - 1)` — rather than adding a flat
  weight of 2 at each of `topRow`/`bottomRow` alone, which under-counted every one of the other 14
  scanlines each player sprite actually covers. §7 gained a test placing an entity tile at the
  *interior* of the player's own bottom span, specifically because a player-only fixture asserting only
  "the peak is 2" cannot tell the fixed and broken versions apart.
- **v4, finding 2**: `resolveActorRestingIcon` now returns the raw, unchecked frame-0 `metaspriteId` —
  including a stale, out-of-range one — exactly matching `resolveItemIcon`'s own pre-relocation
  derivation branch (`main/build/generate.js:3208-3211`) and `draw_actor_icon`'s own unchecked runtime
  read (`engine/ui.asm:441`), rather than clamping an out-of-range or zero-metasprite-count result to
  `NO_METASPRITE` — a real behavior change the prior revision's own bounds check would have introduced.
  §7 gained a stale-derived-frame regression test asserting the raw id survives, the compiled
  `item_metasprite` byte is unchanged across the relocation, and `actorRestingIconTiles` still safely
  reports 0 tiles for the stale reference.
- **v4, finding 3**: the `MAX_ITEMS` consolidation now updates all three of its own prior hand-mirrors
  in the same phase — `shared/save.js` (already planned) plus `renderer/emulator/battletest.js:75` and
  `test/unit/battletest.test.js:583` (previously left alone as "out of scope"), each now importing the
  one canonical declaration instead of keeping an independent literal `8`. `saveIdentity`'s own hash,
  pinned per fixture before and after, is the proof the relocation alone changes nothing.
- **v4, finding 4**: §7's own fixtures were corrected in four places — the player-density tests now
  assert coverage across all eight scanlines of each of the player's own two spans, not just
  `topRow`/`bottomRow` themselves; the positive-byte-wrap example now uses `entity.y = 239` (the real
  normalization ceiling, `shared/project.js:3962`) rather than an impossible `entity.y = 250`; the
  64/65 boundary fixture now states explicitly that each actor's 13/14-tile maximum sits in a
  *non-resting* pose (`walkUp`/`walkSide`) while its own down/frame-0 resting icon stays at or under 8
  tiles, so the fixture's own asserted `overlay = 8` actually follows from what is described rather than
  being merely asserted alongside an under-specified fixture; and Phase 4's smoke coverage is now two
  explicit, separate runs (action-with-combat for `$FE-$FF`, RPG-on-MMC3 for `$FD`) rather than one
  fixture asked to show both conditional ranges at once, which `projectUsesHeartArt`'s own unconditional
  RPG exclusion (`shared/font.js:481-483`) makes impossible for any single project to do.
- **v4, finding 5**: five message-builder functions (§3.12) — `describeMetaspriteDensityWarning`,
  `describeReservedReferenceWarning`, `describeScreenSpriteWarning`, `describeFieldDensityWarning`,
  `describeBattleSpriteWarning` — now write the exact text for every one of this design's new
  `validateProject` warnings, following the `describePlayerSpritePlan` precedent
  (`shared/project.js:2823`) so the live hint and the Problems-list entry are the identical string by
  construction rather than two independently-worded copies of the same fact. Every UI code sketch in
  §6 and every `validateProject` row in §4 now names its own builder explicitly, each given its own
  `where` (`'Sprite Forge'`, `'Map Forge'`, or `'Build'`); §7 added direct tests for each builder.

**Found while re-reading this round, not raised by the reviewer**: `screenLabel(project, mapIndex,
screenIndex)` (`shared/project.js:4008-4013`) and `flatScreens(project)` (`:4023-4031`) already exist
and are already the precedent this design's own new per-screen warnings needed — two existing
`validateProject` checks already call `screenLabel` for the identical "name this screen" purpose
(`:5109`, `:5125`). Earlier revisions of this document invented their own ad-hoc
`for (const map of project.maps) for (const screen of map.screens)` walks and never named a screen in
any message text at all, missing a function that was sitting three lines away from `validateProject`
itself the whole time.

**v5** — a GO WITH FIXES review's three findings, all accepted:

- **v5, finding 1**: the Tile Forge's own `renderSheet()` (§6.3) now builds a **table-specific** range
  list before the common rectangle loop — `spriteReservedRanges(...)` only when `state.table ===
  'sprites'`, and `[{start: FONT_BASE, end: 256, label: 'the message font'}]` only when
  `state.table === 'background' && fontReserved()` — rather than handing `spriteReservedRanges(...)`'s
  own sprite-only output to both sheets, which would have shaded a sprite-table reservation on the
  background sheet (or dropped the background table's own existing `$A0-$FF` font shading). The
  existing `fontReserved()`/`playerReserved()` gates (`tile.js:109-116`) are unchanged, consulted rather
  than replaced. §3.4's own description of `tile.js`'s caller was corrected to match. §7 gained a third
  smoke check specifically for this: a text-using, non-MMC3 project's background sheet keeps its font
  band and shows no sprite reservation at all, while its sprite sheet shows the player (and, with
  combat, hearts) band and no font band.
- **v5, finding 2**: every `state.mapId`/`state.screenId` reference in §6.2 was replaced with
  `state.mapIndex`/`state.screenIndex` — the Map Forge's own real state field names, confirmed by
  reading `map.js:155-157` (the state's own declaration) and, most directly, `map.js:317`'s own
  pre-existing `startMap === state.mapIndex && startScreen === state.screenIndex` comparison, the exact
  shape this design's `isStartScreen` now reuses rather than inventing independently. §7 gained a Map
  Forge integration/smoke test — the real start screen shows the player term, and a second map whose
  own local screen index equals `startScreen` does not — exercising the call-site wiring itself, not
  only `fieldScanlineDensity`'s own pure `isStartScreen` parameter, which a wiring bug (the prior
  revision's own defect) could leave silently broken while every unit test of the function still passed.
- **v5, finding 3**: a new `fieldScanlineRows(project, screen, opts)` is exported alongside
  `fieldScanlineDensity`, which becomes a two-line reduction of it (`Math.max(0, ...rows.values())`) —
  chosen over exporting `poseRowCounts` directly (the brief's own other named option) because
  `poseRowCounts` alone would only prove the player's own synthetic pose wraps and clips correctly in
  isolation, saying nothing about `entityRowMax`'s own max-over-poses step or the sum-across-entities
  step actually combining with it correctly, the same "test the real pipeline, not an isolated piece of
  it" reasoning `battleTables(project, battleStrings)` already applies elsewhere in this codebase via a
  test-facing parameter. §7's player-row test now asserts `fieldScanlineRows`' own returned `Map` holds
  exactly sixteen entries (both of the player's own 8-row spans, not just `topRow`/`bottomRow`
  themselves), each valued `2` — a claim `fieldScanlineDensity`'s own scalar peak could never make
  observable on its own, since two materially different implementations agree on that scalar for a
  player-only screen. The `bottomRow + 3` public-API probe from round 3 stays, unchanged, as the
  integration-level proof that a real entity genuinely raises the exported scalar.

**v6** — a GO WITH FIXES review's two findings, both accepted:

- **v6, finding 1**: §6.2's Map Forge integration test no longer has a direct-helper fallback that
  could pass by calling `fieldScanlineDensity(..., {isStartScreen: true/false})` directly instead of
  going through the real UI. It is now a fully concrete, threshold-crossing fixture: two maps sharing a
  screen at the same local index as `startScreen`, both screens carrying an identical seven-tile entity
  placement on a row the player's own span covers — contributing `7` alone, `9` once the real start
  screen's own player term is correctly added. The test navigates through the actual Map Forge
  controls (the map picker `<select>`, found the same way `main/smoke.js`'s own existing
  `findFieldInput`-shaped lookup already finds a labeled field's control, `:5404-5409`; the navigator
  grid's own per-screen `<canvas title="Screen N">`, `map.js:357-377`) rather than calling the helper
  directly, and states the exact hint text expected: `describeFieldDensityWarning`'s own returned
  string for the real start screen, naming `9`.
- **v6, finding 2**: §6.3's code sketch now calls `playerReserved()`/`fontReserved()` themselves to
  decide which range list applies, rather than re-deriving the same table split with a second,
  parallel `state.table === 'sprites'` comparison the prose already claimed (incorrectly) not to need —
  the single-writer arrangement §6.3's own prose describes is now what the code actually does.

**v7 (a v6 design omission, missed by every review round)**: `battleSpriteBudget` was ungated on game
type, so an action project with a hostile placement reported a battle budget for a battle system it
does not assemble; found by the orchestrator's probe after Phase 2 was implemented; fixed in code and
here.

**v7.1** (Phase 3 review round 1, findings 3 and 4): the `walkSide` bullet's own "once, not twice" claim
was unobservable — `animIds` and `poseIds` are both `Set`s, so a duplicate `walkSide` request collapses
before the per-row maximum ever runs — reframed to state only that a `walkSide`-only actor is included.
The `isStartScreen` bullet's own claim — that its test exercises two map/screen indices and catches a
caller comparing `screenIndex` alone — was equally unobservable, for the identical reason: the test
computed that comparison itself, inside the test, and handed only the resulting boolean across the
boundary into `fieldScanlineRows`, so no caller bug on the far side of that boundary could ever fail it.
Reframed to state only what the test actually proves — the `isStartScreen` option's own `true`/`false`/
omitted behavior in isolation — with the real two-index caller proof left where it already belonged,
Phase 5's own UI integration test (§6.2's "Integration coverage" fixture; found in review round 2).
