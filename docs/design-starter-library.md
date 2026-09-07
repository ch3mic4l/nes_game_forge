# Design: a small MIT/CC0 starter library (ROADMAP item 8, fourth sub-bullet) — v13

**v12 resolves three questions Chris left open in v11 — §7.2/§10's palette default, §2.4/§6's
multi-pose/multi-palette schema, §7.5's import-validity mechanism — then fixes what two further review
rounds found.** Round 1: **one High** (the `(severity, where)`-only occurrence count let two textually
different diagnostics at the same coarse location cancel out, hiding a real regression behind an
unrelated fix — closed, that round, by matching on message text, exact then digit-normalized), **three
Medium** (a multi-pose entry's own tiles needed a default `paletteIndex` for backward compatibility
with every v1 entry's literal; a multi-palette entry's own resolution needed a real
`options.paletteSlots` contract and had to resolve sequentially, not independently, to stop two
entry-local palettes racing onto the same slot; test 16b's own worked example named an impossible
scenario and the wrong file), and **three Low** (this opening paragraph and a comment in test 31 both
still described the withdrawn zero-errors rule; test 26b's own assertion was blind to a permutation of
otherwise-distinct ids). **Round 2, on that same fix: one further High** (digit-normalizing every
embedded number away made a genuine increase of the *same* aggregate message — `overlongSfx` going
2→3 — indistinguishable from an unchanged count, silently missing the regression; closed for good by
`isNotWorse`, §7.5, which compares the embedded numbers instead of erasing them) plus a cluster of
**Medium/Low** findings on the multi-palette exclusion mechanism itself: `nearestPaletteSlot` and the
headless default chain were not threading the same `excluded` set `paletteCandidates` already
respected (§7.2), `options.paletteSlots` did not refuse a duplicate index (§7.2), `entry.palettes.
length` was left unbounded (§2.4/§12), and three remaining sites still described per-palette
resolution as independent rather than sequential (§6/§10/test 26d). **No section says "Unchanged" or
defers to an earlier round.**

## §0. What I read for v6

`engine/battle.asm:395-433` (`draw_mon_block` in full, read specifically for its byte-width
arithmetic): `bt_tmp` (the row's starting tile) and `bt_digits+1` (the tile written to the column
currently being drawn) are both **single zero-page bytes**. The row-advance at `:426-427`
(`lda bt_tmp / clc / adc #16 / sta bt_tmp`) is an ordinary 6502 8-bit addition whose result is stored
back into that same one byte — nothing anywhere reads the carry flag to extend the sum into a second
byte, so the value **wraps modulo 256** exactly the way any 8-bit register does. `main/build/
battletables.js:146-152` (`mon_tile`'s own emission: `b.battleTile === null || undefined ? 0xff :
b.battleTile`, with the comment "`$FF` means 'no block art'; the engine falls back to the actor's
own metasprite" — confirming `$FF` is read by the engine as "there is no block art here," not as a
real tile-256-that-happens-to-wrap-to-0). `shared/project.js`'s own `normalizeActor` (already read
in every prior round, re-checked here for one specific fact): `battleTile`'s clamp is `raw?.battleTile
=== null || undefined ? null : clamp(raw.battleTile, 0, LIMITS.tilesPerTable - 1, 0)` —
`LIMITS.tilesPerTable` is 256, so `clamp(255, 0, 255, 0)` keeps `255` as a **real, valid, non-null**
value. An actor can therefore be normalized with `battle.battleTile: 255` explicitly, which compiles
to the *identical* `$FF` byte `battletables.js` already emits for a `null` `battleTile` — the engine
cannot tell "no block art" from "block art starting at tile 255" apart, and treats both as "no block
art." `test/unit/drawvalidation.test.js:898-910` (`assert.deepEqual(problems[0], { severity, where,
message })` — a plain three-key exact-shape comparison against `validateProject`'s own output,
confirming that any change to what fields a `problems` entry carries would break this and every
similarly-shaped assertion; withdrawing the `code`/`subject` addition means this test needs no
change at all, verified directly rather than assumed).

## §1. The (A)-over-(B) recommendation

Author the library in-repo as CC0-dedicated `shared/library/*.js` data, in the same ASCII-row art
format `tools/sample-common.js` already uses (`tile(rows)`, `split16`, `metasprite`). Five reasons,
none touched by any review round since the first: **quantization is a lossy guess** —
`renderer/forges/tile/import.js`'s own PNG importer runs every pixel through a nearest-4-colour Lab
search plus a selectable dither mode and strength, because the conversion is approximate by nature,
and a starter library's whole point is content an author can trust sight-unseen. **This engine's
sound has no import path to source into at all** — `shared/audio.js`'s SFX and song formats are
per-frame APU register sequences (note, duration, envelope), not sample playback; a grep of
`renderer/forges/sound/` and `shared/` for `.wav`/`.nsf`/`decodeAudioData` finds only the in-app
preview synthesizer. Since the roadmap bullet names "sound effects" as one of five categories,
sourcing external packs cannot cover two of them without inventing an entirely new audio-
transcription subsystem this codebase has never attempted. **Attribution bookkeeping has no reader
today** — no schema entity in `shared/project.js` carries a `license` or `author` field, and nothing
in `renderer/` displays one, so recording it for sourced content would be new, unread metadata.
**The missing `LICENSE` file costs the same machinery either way** — `package.json` already says
`"license": "MIT"` but no `LICENSE` file exists in the repository today; §12 fixes this regardless
of which content-sourcing option was chosen. **An in-repo entry cannot fail this codebase's own
checks by construction** — it never has an opinion about which tile index it lands at; the import
operation (§7) decides that, with every reservation rule as an explicit input, so there is no
external asset whose colours or tile layout could silently collide with the font or player ranges
the way a sourced PNG's could.

## §2. What a library entry IS

Five kinds: `terrain`, `monster`, `pickup`, `sfx`, `song`. `effect` is deliberately absent — §2.6
explains why and what would be needed to add it later. Every entry is a plain object: `{ kind,
name, license: { type, author }, ...kind-specific fields }`. `license.type` is one of a fixed
vocabulary (`['CC0-1.0']` for v1); `author` is `'NES Game Forge'` on every entry shipped in v1,
since the project itself is the sole author under option (A).

### §2.1 Normalizers are private; the core synthesizes what an entry does not declare

`normalizeMetatile`, `normalizeMetasprite`, `normalizeAnimation`, `normalizeActor`, `normalizeItem`
(all in `shared/project.js`) are plain, **unexported** `function` declarations — confirmed by
reading each declaration directly. `planLibraryImport`/`applyPlannedProject` (§7) therefore live
inside `shared/project.js` itself, since nothing outside that module can call any of the five.
**Every record this design ever pushes into a project is produced by calling its matching normalizer
on remapped, fully-resolved data — never a raw literal object assigned directly.** This is what
makes an actor-shaped entry's own minimal literal (§2.4) safe: it never declares `battleTile` at
all, so `normalizeActor`'s own null-coalescing clamp always resolves the field to the literal
`null`, which `hasBattleBlockArt` (§5.3) reads as "no block art" the instant the actor is pushed,
with no save/reload needed in between.

### §2.2 `terrain`

```
{
  kind: 'terrain', name, license,
  palette: [p0, p1, p2, p3],           // NES colour indices; p0 is a placeholder, see §7.3
  tiles: ['<64-char>', ...],            // the entry's OWN unique tile-art pool, entry-local index 0..N-1
  metatiles: [
    { name, tiles: [i0, i1, i2, i3],   // entry-local indices INTO `tiles`, never destination indices
      collision },                      // one of COLLISION_TYPES's ids
    ...
  ]
}
```

A terrain entry's `tiles` pool **may** legitimately contain the literal `BLANK_TILE` string — a sky
or open quadrant genuinely is all colour 0 — because a metatile's own `tiles` array always needs
exactly four indices; there is no way to *omit* a metatile quadrant the way a metasprite can omit a
tile (§2.3/§2.4 below). §5.5 is what keeps this safe: a blank tile that anything already references
is never handed out as free, whether the reference is a metatile's or a metasprite's.

### §2.3 `pickup`

A plain, single-frame `behavior: 'pickup'`, `damage: 0` actor — exactly §2.4's shape with those two
fields fixed to those two values, poses and multiple palettes included: a `pickup` entry with its own
shine/idle pose difference is exactly as valid as a `monster` with a walk cycle, since it inherits
§2.4's schema wholesale. **No item is ever written by importing a `pickup` entry.** The
toast (§7.7) tells the author, in words, to bind the new actor to an item using the Items Forge's
existing "Collected from" control. This is deliberate, not an omission: `resolveItemIcon` gives an
item's own explicit `metaspriteId` priority over anything derived from its backing actor, and
`actorId` is not an icon-selection field at all — it is **gameplay ownership**. A placement of that
actor grants the item it names through `ent_to_scr` (`main/build/generate.js`'s `resolveEntityByte`),
and the placed entity vanishes off the screen whether or not the grant actually succeeds
(`engine/entities.asm`'s pickup-vanish logic). Writing `actorId` silently from an import would
conflate "which actor's art represents this item in a menu" with "which placed actor, walked into
anywhere on any screen, hands this item out and disappears" — a real behavioural commitment an
import must never make on the author's behalf.

### §2.4 `monster`

```
{
  kind: 'monster', name, license,
  palettes: [ [p0, p1, p2, p3], ... ],                      // one or more entry-local palettes; p0 of EACH is a placeholder, see §7.3
  spriteTiles: ['<64-char>', ...],                          // ONE shared entry-local pool, sprite table -- NEVER BLANK_TILE
  poses: {                                                   // one to four named poses; `idle` is required
    idle:     { tiles: [{ x, y, tile, paletteIndex, hflip, vflip }] },
    walkDown: { tiles: [...] },                              // optional
    walkUp:   { tiles: [...] },                              // optional
    walkSide: { tiles: [...] }                                // optional
  },
  hp, speed, damage,
  battle: { atk, def, acc, eva, speed, mp, xp, gold, weak, strong, dropPct, heal }
}
```

**`entry.palettes.length` must be between 1 and `LIMITS.palettes` (4) inclusive.** A background or
sprite table has exactly four physical palette slots (§7.2/§7.3), so a fifth entry-local palette could
never be given a distinct one — §7.4's own sequential resolution (an earlier palette's chosen slot
added to `excluded` before the next resolves) would have nothing left to hand it by the time it runs.
§12's own manifest test enforces this bound on every `monster`/`pickup` entry, alongside its existing
`BLANK_TILE` check.

**`palette` (singular) and `metasprite` (singular) remain valid, and are sugar for the general shape
above, not a second schema.** An entry declaring `palette: [...]` is read as `palettes: [that one
palette]`; an entry declaring `metasprite: {...}` is read as `poses: { idle: that one metasprite }`.
**Every tile in that sugared `metasprite` lacks a `paletteIndex` field entirely — v11's tile shape
never had one — and each such tile defaults to `paletteIndex: 0`,** the entry's own first (and, under
the singular sugar, only) declared palette; without this default, `paletteMap[tile.paletteIndex]`
(§6) would read `paletteMap[undefined]`, which is `undefined`, on every tile of every entry shipped
today. Every entry shipped in v1 still uses the singular form and needs no literal change at all —
nothing in the current inventory needs more than one pose or one palette — so this is a capability the
mechanism gains now, with no content yet exercising it, the same "additive, unused capability is fine
when the alternative is redesigning the mechanism twice" reasoning §6 already applied to `tileMap`.

**A pose's own `tile` field is an entry-local index into the ONE shared `spriteTiles` pool, exactly
as before — poses do not each get their own pool.** A four-pose entry with a genuine walk cycle
reuses body tiles across poses (a torso that doesn't change between `idle` and `walkSide`) the same
way a hand-authored actor already can; giving every pose its own pool would force needless
duplication and a bigger `tileMap` for zero benefit. A pose's own `paletteIndex` field is an
entry-local index into `palettes` — which of the entry's own declared palettes this tile draws from
— resolved through the new `paletteMap` (§6), never a project-level palette slot directly.

**The entry declares the minimum; the core synthesizes the rest, always, identically, for every
actor-shaped entry — generalized from "the one metasprite" to "each declared pose":**

1. Every declared pose's metasprite is pushed through `normalizeMetasprite`, with every tile's
   `.palette` set through `paletteMap[tile.paletteIndex]` (§6/§7.3's outcome for that entry-local
   palette) — never a hardcoded `0`, and never the same destination slot for two different
   entry-local palettes that happened to resolve differently.
2. One animation is synthesized **per declared pose**, same one-frame shape as before: `{ loop: true,
   frames: [{ metaspriteId: <that pose's own pushed metasprite's real destination id>, duration: 30
   }] }`, pushed through `normalizeAnimation`. A four-pose entry therefore pushes four metasprites and
   four animations, each following §7.4's ordinary append rule; a one-pose entry still pushes exactly
   one of each, byte-identical to today.
3. The actor's `anims` object sets each of the four `ANIM_SLOTS` — `idle`, `walkDown`, `walkUp`,
   `walkSide` — to **its own matching pose's** synthesized animation id when that pose was declared,
   else to the `idle` pose's synthesized animation id. A one-pose entry (only `idle` declared)
   therefore still sets all four slots to that single animation, exactly today's behaviour; nothing
   changes for an entry that declares only what §2.4 already required before this revision.

`battle.drop`, `battle.spellId`, and `battle.battleTile`/`battleW`/`battleH`/`battlePalette` remain
absent from the entry literal for the same reason as before this revision: an entry cannot assume the
destination project has items or spells to point at, and an absent `battleTile` normalizes to `null`,
which already means "draw the battle animation as a sprite instead of block art" — exactly the right
default for content with no battle-tileset art of its own.

**A `monster`/`pickup` entry's `spriteTiles` pool may never contain the literal `BLANK_TILE`
string** (unchanged from before this revision) — a metasprite quadrant meant to be fully transparent
is omitted from that pose's own `tiles[]` entirely, in every pose, not just `idle`. §12's manifest
test still enforces this by walking every `monster`/`pickup` entry's `spriteTiles` array, which the
multi-pose shape does not change the shape of at all — it is still one flat pool per entry, however
many poses reference it.

**Explicitly out of scope, kept honest rather than silently assumed away: a per-pose multi-frame walk
cycle** (two or more alternating frames within a single direction, the way a hand-authored walk
animation usually looks) is not part of this extension. "More than one pose" means up to four static,
per-direction images — a real, visible improvement (a monster now faces the direction implied by its
own `walkDown`/`walkUp`/`walkSide` slot instead of showing its resting pose in every direction)
without also asking a *small* starter library to author frame-interpolated animation, which remains
exactly the kind of enrichment an author is expected to add afterward through the Sprite Forge. A
future round could extend `poses.walkDown` etc. from one metasprite to a short `frames` list the same
additive way this revision extended a single metasprite to up to four named poses — nothing here
forecloses it, and nothing here builds it.

### §2.5 `sfx` / `song`

`sfx`: `{ kind: 'sfx', name, license, sfx: { name, volume, steps: [{ note, duration }] } }` — the
exact `normalizeSfx` shape, capped at `SFX_MAX_STEPS` (8). `song`: `{ kind: 'song', name, license,
song: { tempo, instruments, patterns, order, loop } }` — the exact `normalizeSong` shape, the same
literal structure `tools/make-sample.js`'s own hand-authored song already uses. Neither kind touches
a tileset or a palette at all.

### §2.6 Deferred: effects

The complete `EVENT_COMMANDS` vocabulary (`shared/project.js`) — `end, say, give, take, setSwitch,
clearSwitch, warp, join, setVar, addVar, subVar, branch, choice, call, music, battle, heal, damage,
save, move, turn, wait, shake, visible, fade, flash, sting, sfx, route` — has **no command that
selects or plays an animation or a metasprite**, and actors, not animations, are the only placeable,
triggerable thing this engine has. An `effect` entry (a metasprite plus an animation, no actor) would
therefore be data with no runtime hook: nothing in this vocabulary can spawn it, one-shot, at an
event's own moment. Attaching it as an actor's ordinary movement animation is not a substitute either
— those loop for as long as the actor exists; they are not "play once and stop." A real `Effect`
command would need a new `OP_*` opcode, a one-shot animation-playback state the engine has no shape
for today, and its own named kernel-lo allowance — a real engine slice this content-only design must
not carry. ROADMAP's "effects" word stays open until that slice exists.

## §3. Structural ownership of the authoring helpers

**`shared/library/authoring.js` owns `tile`, `split16`, `metasprite`** — moved, not duplicated, from
`tools/sample-common.js`. `tools/sample-common.js` becomes a re-export: `export { tile, split16,
metasprite } from '../shared/library/authoring.js';` — tools importing from `shared/` is the
direction this codebase already uses everywhere else; nothing in `shared/` may import from `tools/`.
`screenFromArt` stays exactly where it is today, in `tools/sample-common.js` alone, since it is a
fixture-authoring helper (screens, legends) the library has no use for.

**Every `tools/make-*.js` file was read to find every local copy of these three functions — verified
exhaustively, not assumed from one file.** `tools/make-mmc1-sample.js`, `make-mmc3-sample.js`,
`make-rpg-save-sample.js`, `make-u512-sample.js` already `import { tile, split16, screenFromArt,
metasprite } from './sample-common.js'`. Only **`tools/make-sample.js`** (its own local `tile`/
`split16`/`metasprite`, three separate function definitions) and **`tools/make-rpg-sample.js`**
(the identical local trio) carry copies today — both rewritten to the same import line the other
four already use. This is a **phase-1 task**, gated by `test/unit/samplegen.test.js`'s existing
`GENERATORS` list — all six sample-project generator scripts, each diffed byte-for-byte against its
own checked-in fixture — so the move from three implementations down to one is provable, not merely
asserted.

## §4. Where the data lives and how the renderer reaches it

`shared/library/authoring.js` (§3) plus `shared/library/{terrain,monster,pickup,sfx,song}/*.js`,
one file per entry, each `export default { kind, name, license, ... }`. `shared/library/index.js`
aggregates every file into one flat `export const LIBRARY_ENTRIES = [...]` — the single manifest
array every Forge picker and every test iterates.

**No `main/preload.cjs` change, no new IPC channel of any kind.** `main/main.js`'s own `forge://`
protocol handler serves the **entire repository root**, read-only, as static files — this is already
why `renderer/app.js` can `import { LIMITS } from '../shared/project.js'` directly with zero IPC
surface. A new `shared/library/*.js` tree is nothing more than additional files under that same
root, reachable the instant they exist on disk by an ordinary `import` statement. Building option
(B) instead would need either bundling external PNG/`.wav` files into a JS module as base64 (which
produces this exact same shape, only uglier) or a genuinely new `library:list`/`library:readAsset`
IPC surface and real main-process filesystem code — surface (A) never needs at all.

## §5. Reserved-resource and index-set predicates

### §5.1 `reservedPaletteSlots(project, mapper)`

Three engine facts, each independent of whether anything in the project's own content happens to
reference the slot:

- **Background palette 0** is reserved whenever `projectUsesText(project) ||
  projectUsesEffectiveTitle(project)` — the message box (`engine/text.asm`) and the title bands
  (`engine/title.asm`) both force background palette 0 unconditionally, regardless of any metatile.
- **Background palette 1** is reserved whenever `project.project?.gameType === 'rpg'` — battle
  scenery's ground row (`engine/battle.asm`'s `draw_battle_attr`) draws on every battle screen.
  Deliberately the *broader* `gameType === 'rpg'` test rather than the exact `battleEnabledFor`
  predicate (which lives in `main/build/generate.js`, a module that reaches for `node:fs` and that
  `shared/` must never depend on) — this can only ever over-reserve on a board where battle code
  happens not to actually assemble, never under-reserve.
- **Sprite palette 0** is reserved **always, unconditionally** — `main/build/generate.js`'s own
  generated `player_pal: .db 0` line is a hardcoded literal, never read from any project field at
  all: the player's OAM attribute byte is hardware sprite palette 0 no matter what colours
  `project.palettes.sprite[0]` holds. `engine/constants.asm`'s `HUD_PAL = 0` and the battle cursor's
  own hardcoded palette-0 write in `engine/battleui.asm` both reuse the identical slot, so there is
  only ever one sprite-palette reservation to make, never a second for hearts or a third for the
  cursor.

**This function's own return keys are `'bg'`/`'sprite'`, matching `project.palettes`' real keys —
never `'background'`/`'sprites'`.** Every consumer indexes its result the same way it indexes
`project.palettes` itself, since both describe the same four background and four sprite palette
slots; §7.3 states the one place these keys ever need bridging from the *tile-table* vocabulary.

```js
export function reservedPaletteSlots(project, mapper) {
  const bg = new Set();
  if (projectUsesText(project) || projectUsesEffectiveTitle(project)) bg.add(0);
  if (project.project?.gameType === 'rpg') bg.add(1);
  return { bg, sprite: new Set([0]) };
}
```

### §5.2 `claimed(id)` and `isPristine` — bound-tile-aware, name-aware

**A metatile id counts as `used` if any screen's `metatiles` array names it, OR if any screen's
`boundTiles[].metatileId` names it.** `normalizeScreen`'s own bound-tiles block
(`shared/project.js`) shows a screen carries a *second*, independent metatile reference per bound
cell — the alternate a switch swaps a cell to while its switch is on — normalized through the
identical clamp `screen.metatiles[i]` already gets. A metatile referenced *only* as a bound
alternate, never appearing in any screen's base layer, looks exactly like an untouched, claimable
slot to a walk that checks only `screen.metatiles` — which is precisely how an importer could
silently repaint what a screen shows the instant its switch flips, collision behaviour included.

```js
function usedMetatileIds(project) {
  const used = new Set();
  for (const map of project.maps ?? []) {
    for (const screen of map.screens ?? []) {
      for (const id of screen.metatiles) used.add(id);
      for (const bound of screen.boundTiles ?? []) used.add(bound.metatileId);
    }
  }
  return used;
}
```

**A metatile is pristine only if it also still carries its own default name.**
`isPristine(mt) = mt.name === createMetatile(mt.id).name && mt.tiles.every(t => t === 0) &&
mt.palette === 0 && mt.collision === 'open'`. Renaming a metatile before painting or otherwise
editing it (reserving slot 12 as "Lava Trigger," say) is a plain, always-available text field in the
Map Forge's own metatile editor — ordinary, expected use, not an edge case. This is demonstrated
against real, checked-in data, not synthesized: `sample/`'s own metatile id 0 is named `"Void"` (not
its default `"Empty"`), its `tiles`/`palette`/`collision` are still pristine, and no screen currently
paints it — a name-blind pristine check would classify it as an available slot to claim and silently
overwrite, discarding the author's own reservation.

`claimed(id) = usedMetatileIds(project).has(id) || !isPristine(project.metatiles[id])`.

### §5.3 `unusedPaletteSlots(project, table, mapper)`

**One shared predicate for "does this actor actually have block art," used everywhere that question
is asked — six readers in total: here (reader 1), in §5.6's reference walk (reader 2), in two
*existing* functions this design fixes as part of shipping — `formationSpriteCost` (reader 3) and
`validateProject`'s own battle-art font-collision check (reader 4), both below — and in the Monster
Forge's own actor editor, readers 5 and 6, once §5.6's `battleBlockIndices` is exported alongside
this predicate.** `main/build/battletables.js`'s own `mon_tile`
emission (`b.battleTile ===
null || undefined ? 0xff : b.battleTile`) and `normalizeActor`'s clamp (`clamp(raw.battleTile, 0,
LIMITS.tilesPerTable - 1, 0)`, which keeps an explicit `255` as `255`, not `null`) together mean the
engine's own "no block art" sentinel, `$FF`, is reachable two ways from JS — a `battleTile` of
`null`/`undefined`, or a real, normalized `255` — and the two are byte-identical once compiled.
Any check asking "does this actor draw block art" must treat both the same:

```js
export function hasBattleBlockArt(actor) {
  const battleTile = actor.battle?.battleTile;
  return typeof battleTile === 'number' && battleTile !== 0xff;
}
```

Background: sums every *claimed* metatile's own `palette` field, **plus every actor's
`battle.battlePalette` where `hasBattleBlockArt(actor)`** — `draw_mon_block`/`draw_attr_mon`
(`engine/battle.asm`) draw a monster's block art as background tiles tinted by exactly that field,
entirely independent of whether any metatile happens to point at the same slot; an actor whose
`battleTile` is `255` draws no block art at all and must not consume a background palette slot on
its account. Sprite: every metasprite's own `tiles[].palette`, unconditionally — `project.sprites.
metasprites` is append-only, with no pre-allocated pool to distinguish claimed from unclaimed the
way `project.metatiles` has, so every metasprite that exists counts, whether or not any actor or
placement currently reaches it. Both totals, minus `reservedPaletteSlots` for the matching table,
give the free set.

**`formationSpriteCost` (`shared/project.js`, the private helper `battleSpriteBudget` calls) has the
identical inconsistency today, and this design fixes it as part of shipping — a fix to existing
validation code, not to anything this design newly writes.** Its own guard reads `actor.battle?.
battleTile !== null`, so an explicit `battleTile: 255` is treated as "has block art" and the actor's
sprite cost is silently omitted from the OAM budget — the opposite of `hasBattleBlockArt`'s answer,
and the wrong one: the engine draws such an actor as a sprite (`draw_actor_icon`, since `mon_tile ==
$FF`), exactly the case `formationSpriteCost` exists to count. The fix is `battleTile !== null` →
`!hasBattleBlockArt(actor)` in that one guard — **validation-only and byte-neutral**: `battleSpriteBudget`
only ever feeds a `validateProject` *warning* (`describeBattleSpriteWarning`), never the generator or
any compiled byte, so the six-fixture SHA-256 ROM-hash gate (§9) proves this by construction, not
merely by argument. A direct probe of all six checked-in fixtures confirms it is also inert against
today's real data: **zero actors, in any of the six, carry an explicit `battleTile: 255`** — this fix
changes no fixture's validation output either, today; it only stops a future project's own explicit
`255` from silently undercounting its OAM budget. `normalizeActor` itself is deliberately **not**
changed to canonicalize `255` to `null` on load — that would rewrite stored project data the moment
an unrelated project is merely opened, which this codebase's own normalization discipline avoids
everywhere it can compute the same answer without doing so.

**A fourth reader, found by re-checking every remaining site rather than assuming three was the
whole list: `validateProject`'s own battle-art font-collision check (`shared/project.js:5864-5874`)
has the identical `battleTile === null || battleTile === undefined` skip (`:5868`), and it is a real,
live bug this design fixes as part of shipping too.** Left unfixed, an actor with an explicit
`battleTile: 255` on a non-split RPG computes `last = 255 + (battleH-1)*16 + battleW-1`, which is
`≥ FONT_BASE` for essentially any `battleW`/`battleH`, so this check would raise `"<actor>'s battle
artwork runs into the message font's tiles"` — a **false** error, since `battleTile: 255` means no
block art is drawn at all, the metasprite fallback is used instead, and nothing competes with the
font for tileset space. Under v11's now-superseded zero-errors rule, that false error would have
refused *every* library import into any project carrying such an actor, whether or not the import
touched anything related; under §7.5's current attribution rule (v12) a pre-existing instance of it
is never attributed to an unrelated import, but the fix still ships here regardless of which rule sits
above it, since a false `validateProject` error is a real defect independent of either. The fix is the
identical substitution: `battleTile === null || battleTile === undefined` →
`!hasBattleBlockArt(actor)`. **Validation-only and byte-neutral, the same shape as the
`formationSpriteCost` fix**: this is an `add('error', ...)` call inside `validateProject`, never a
generator or compiled-byte path, so the six-fixture SHA-256 gate (§9) proves no ROM changes, and the
identical zero-actors-with-`battleTile:255` probe (above) confirms no fixture's validation output
changes either.

**The Monster Forge's own actor editor is readers 5 and 6, found only by grepping `renderer/` too —
the prior round's own audit stopped at `shared/` and `main/build/` and missed it.**
`renderer/forges/monster/monster.js` reads `battle.battleTile` at three sites, none through any
predicate: `:196` (`if (battle.battleTile !== null && battle.battleTile !== undefined) {`, gating
whether the block-art outline is drawn on the tileset sheet at all), `:214` (the same test choosing
between `'No block chosen — the actor is drawn from its animation.'` and
`` `Block at $${...}, ${width}×${height} tiles.` ``), and `:223` (the same test again, choosing
whether to show a "Use the animation" button). Left unfixed, an actor with an explicit
`battleTile: 255` — which `hasBattleBlockArt` correctly reads as "no block art," the same answer the
engine and (once fixed) `validateProject` give — is shown in the Monster Forge as `"Block at $FF, 4×4
tiles."` with a drawn outline and a "Use the animation" button that makes no sense for an actor
already using its animation. **The overlay itself is also wrong for a wrapping block independent of
the `255` case**: `:200-201` draws one `strokeRect` spanning `width * cell` by `height * cell` pixels
from `(battleTile % SHEET_COLS, Math.floor(battleTile / SHEET_COLS))` — for `battleTile: 250,
battleW: 4, battleH: 2`, that is one rectangle from column 10, row 15 down to row 16, which does not
exist on a 16-row sheet (`256 / SHEET_COLS`) — an off-sheet rectangle, not the real cells
`draw_mon_block` actually reads (250-253, then 10-13, §5.6). Both defects are the same root cause:
the UI recomputes "is there block art, and where" from raw `battleTile` arithmetic instead of asking
the functions that already answer exactly this.

**The fix, and one new pure function alongside the two that already exist — `describeBattleTileState
(actor)`, exported from `shared/project.js` beside `hasBattleBlockArt`/`battleBlockIndices`, DOM-free
and independently testable** (this is the "one more pure step" the overlay's own label text needs,
the same way `battleBlockIndices` is the pure step its geometry needs — see the Low finding this
round resolves, §11):

```js
export function describeBattleTileState(actor) {
  const hasBlock = hasBattleBlockArt(actor);
  const { battleTile, battleW = 4, battleH = 4 } = actor.battle ?? {};
  return {
    hasBlock,
    label: hasBlock
      ? `Block at $${battleTile.toString(16).toUpperCase().padStart(2, '0')}, ${battleW}×${battleH} tiles.`
      : 'No block chosen — the actor is drawn from its animation.'
  };
}
```

The overlay draw (`:196`/`:200-201`) is replaced by one `cell`-sized `strokeRect` per index in
`battleBlockIndices(actor)` (`col = index % SHEET_COLS`, `row = Math.floor(index / SHEET_COLS)`), so
a wrapping block draws its real, possibly-disjoint cells instead of one possibly-off-sheet rectangle.
The two label sites (`:214`, `:223`, which today independently re-derive the identical
`battleTile === null || undefined` ternary — a second, smaller instance of exactly the drift this
predicate exists to end) both call `describeBattleTileState(actor)` once and read `.label`/
`.hasBlock` off the result, rather than each recomputing it.

**This is not a new design decision — it is a consistency fix CLAUDE.md's own single-writer rule
obliges the moment a shared predicate exists at all: one definition of "does this actor have block
art," every reader using it, never a fourth (now sixth) independent reimplementation that can drift
from the other five.** Validation/UI-only and byte-neutral, the identical framing the
`formationSpriteCost` and `validateProject` fixes already carry: nothing here is a generator or
compiled-byte path, so the six-fixture SHA-256 gate (§9) proves no ROM changes, and the same
zero-actors-with-`battleTile:255` probe (above) confirms no fixture's Monster Forge display changes
either, today. It lands in the same phase as the predicate itself — phase 2 (§13) — not deferred to
whichever phase happens to touch the Monster Forge next, since shipping the predicate without fixing
every reader that already exists would leave it half-adopted from the moment it lands.

**Checked, not assumed: `docs/design-monster.md` does not document the null/undefined-only check as
intentional.** Its own two `battleTile`-adjacent passages (the `actor.battle ?? {}` optional-
chaining discipline, and the `null`-or-`clamp(...)` storage convention `battle.spellId`/
`battle.battleTile` share) are both about a different question — how the field is *read safely* and
*stored* — neither claims anything about whether `255` and `null` should answer "has block art"
identically. No postscript is needed there; this was an overlooked inconsistency, not a reversed
decision.

**The complete `battleTile` reader list, `shared/`, `main/build/` and `renderer/` grepped
exhaustively this round — not assumed exhaustive from a two-tree grep again:**

1. `main/build/battletables.js:150` — the `mon_tile` compiled-byte emission itself
   (`b.battleTile === null || undefined ? 0xff : b.battleTile`). **Does not go through the
   predicate, and need not**: this is the *definition* of the sentinel `hasBattleBlockArt` is built
   to match, not a consumer asking whether one applies — it already treats `null`/`undefined` and an
   explicit `255` identically (both compile to `$FF`), so it is consistent with the predicate by
   construction rather than by calling it.
2. `shared/project.js`'s `normalizeActor` (`battleTile: battle.battleTile === null || undefined ?
   null : clamp(battle.battleTile, 0, LIMITS.tilesPerTable - 1, 0)`). **Does not go through the
   predicate, and need not**: this is normalization, deciding what value is *stored* (`null` stays
   `null`; a real number, `255` included, is clamped and kept), not a question about whether block
   art exists — it is upstream of every reader that asks that question, not one of them.
3. `formationSpriteCost` (`shared/project.js:3444`, via the exported `battleSpriteBudget`) — **goes
   through the predicate**, this design's fix (round 7).
4. `validateProject`'s battle-art font-collision check (`shared/project.js:5864-5874`) — **goes
   through the predicate**, this design's fix (round 8).
5. `renderer/forges/monster/monster.js:196`/`:200-201` — the block-outline gate and draw — **goes
   through `battleBlockIndices`**, this design's fix.
6. `renderer/forges/monster/monster.js:214`/`:223` — the label text and "Use the animation" button
   — **go through the new `describeBattleTileState(actor)`** (which itself calls `hasBattleBlockArt`
   once), this design's fix — a DOM-free pure function rather than either call site re-deriving the
   ternary, closing a small pre-existing duplication (the two sites computed the identical test
   independently) at the same time as the sentinel bug.
7. `renderer/forges/monster/monster.js:184`, `renderer/forges/build/build.js:89/91`,
   `shared/project.js:3712/3798/4806`, `main/build/generate.js:2599` — every remaining hit the
   exhaustive grep found. **All read `project.rpg.battleTilesetId` — a different field entirely**
   (which tileset the whole battle screen switches to, a project-level setting), not
   `actor.battle.battleTile` (one monster's own block-art tile). Named here explicitly so "every
   `battleTile` hit" cannot be misread as having skipped them; none is a reader of the field this
   predicate is about.

Reader count: two in this design's own new code (§5.3's palette sum, §5.6's reference walk) plus
four fixes to existing code — six total, all agreeing, with no seventh site left to find across all
three trees.

### §5.4 `unusedMetatileSlots(project)`

`project.metatiles` is a **fixed 64-slot array** created once by `createProject`
(`Array.from({ length: LIMITS.metatiles }, (_, id) => createMetatile(id))`) — not an appendable
list. Confirmed by grep: there is no "Add metatile" control anywhere in the Tile Forge. "Importing"
a terrain metatile therefore cannot mean "append" the way an actor/item/metasprite/animation/sfx/
song import does — it means **claiming an existing, still-unclaimed slot in place**:
`unusedMetatileSlots(project) = { id : !claimed(id) }`, using §5.2's `claimed`.

### §5.5 `permittedIndices` / `freePermittedIndices` — tileset-aware, reference-aware

`permittedIndices(project, table, mapper)` — every index outside the engine's reserved ranges (the
font range on `background` when `projectUsesText(project) && !fontBankSplit(project, mapper)`; the
player/heart/cursor ranges on `sprites`, from `spriteReservedRanges`) — **blank or not**. This is
the set dedup candidates are drawn from, since a real, non-blank tile identical to one an entry
wants to import is exactly the case cross-entry dedup (§6) needs to find and reuse, and a purely
blank-content-based scan can never see non-blank matches at all.

**`freePermittedIndices` is `permittedIndices` intersected with `freeTileSlots`'s own blank-content
answer, further reduced by every index anything already *references*, blank or not** — a blank tile
that some claimed metatile, some metasprite, or (new this round, restated in full below) some
actor's own battle block art already points at is not free, even though its stored content is all
zeroes. A pickup's fully-transparent quadrant maps to a real, deliberately blank sprite tile; handing
that same index to a later import as "free" because it is content-blank would silently overwrite the
earlier pickup's own transparent corner with unrelated new art.

```js
function referencedTileIndices(project, table, tilesetIndex) {
  const refs = new Set();
  if (table === 'background') {
    for (const mt of project.metatiles) if (claimed(mt.id)) for (const t of mt.tiles) refs.add(t);
    if (project.project?.gameType === 'rpg' && tilesetIndex === project.rpg.battleTilesetId) {
      for (const actor of project.sprites.actors) {
        for (const index of battleBlockIndices(actor)) refs.add(index); // §5.6
      }
    }
  } else {
    for (const ms of project.sprites.metasprites) for (const t of ms.tiles) refs.add(t.tile);
  }
  return refs;
}

function freePermittedIndices(tilesetTable, project, table, mapper, tilesetIndex) {
  const permitted = new Set(permittedIndices(project, table, mapper));
  const referenced = referencedTileIndices(project, table, tilesetIndex);
  return freeTileSlots(tilesetTable, table === 'background' ? 'background' : 'sprites')
    .filter((i) => permitted.has(i) && !referenced.has(i));
}
```

**A real, live effect on `sample-rpg/`'s own numbers, not a theoretical one**: every fresh project
already loses one usable background tile the instant it exists — `createMetatile`'s own default
`Empty` metatile (`tiles: [0,0,0,0]`) references background tile 0, `BLANK_TILE`, from creation — and
`sample-rpg/`'s own Battle tileset loses several more to its own monster's block art (§5.6).

### §5.6 The battle block reference walk mirrors `draw_mon_block`'s own byte-width arithmetic

**`draw_mon_block`'s row-start counter (`bt_tmp`) is a single zero-page byte; its row-advance
(`clc / adc #16 / sta bt_tmp`, `engine/battle.asm:426-427`) is ordinary 6502 8-bit addition with the
carry never read afterward, so the value wraps modulo 256 on real hardware.** A block starting at
tile 250, four wide, two tall, draws row 0 at 250-253 and row 1 at `(250+16) mod 256` through `+3` —
10-13 — **not** 266-269, which is not a byte at all. The within-row column counter (`bt_digits+1`) is
also a single byte incremented with a plain `inc`, wrapping the identical way. Both reduce to one
formula, since modular addition is associative:

**Exported, not private — the Monster Forge's own block-art overlay is a second, real consumer of
the exact cell list, not only the reference-walk internal to this design (§5.3).**

```js
export function battleBlockIndices(actor) {
  // hasBattleBlockArt (§5.3) is the one shared answer to "does this actor draw block art at all" --
  // called here rather than re-testing battleTile locally, so this walk, §5.3's palette count, and
  // every UI reader (below) can never drift apart on the $FF/explicit-255 sentinel.
  if (!hasBattleBlockArt(actor)) return [];
  const { battleTile, battleW = 4, battleH = 4 } = actor.battle;
  const indices = [];
  for (let row = 0; row < battleH; row++) {
    for (let col = 0; col < battleW; col++) indices.push((battleTile + row * 16 + col) & 0xff);
  }
  return indices;
}
```

**No new `validateProject` error is added for a block that wraps** — a wrapping block is exactly
what a real cartridge already draws for such an author-chosen `battleTile`/`battleW`/`battleH`
combination, so the reference walk's own job is only to mirror that reality, not to pass judgment on
it. A validator warning that a wrapping block probably was not intended is plausible future work,
noted here and left out of this design's own scope.

### §5.7 A `validateProject` error: a metasprite referencing a blank tile in an active reserved range

**A real gap in `validateProject` itself, independent of the import feature — this design proposes
fixing it there, not inside the importer.** A metasprite can reference a currently-blank sprite tile
inside `$FE`/`$FF` (or `$FD`, the split-font cursor) legitimately, in a project where nothing yet
reserves that range. The moment anything later makes a damage-bearing actor real (an import, or an
ordinary hand edit), `projectUsesHeartArt` activates, the build stamps heart art over `$FE`/`$FF`
(`main/build/generate.js`'s own per-tileset heart-stamping loop), and that reference now silently
draws heart art. `validateProject` already refuses a build over the identical consequence for
hand-drawn, non-blank content in the same range (`Tileset "X" has artwork in the last two sprite
tiles, which the HUD hearts reserve while anything in the project can hurt the player.`) — this is
consistency with that policy, not a new one:

```js
// A reference-based sibling of the existing non-blank-content check above. Scoped to the ACTIVE
// ranges only (hearts/cursor, never the player -- the player's own range is deliberately never
// refused as artwork, a pre-existing design-modular-parts.md decision this does not revisit) and to
// a tile that is genuinely blank in that SPECIFIC tileset (the same sprite-table index can be real
// art in one tileset and blank in another).
for (const range of spriteReservedRanges(project, artworkMapper).slice(1)) {
  const rangeIndices = Array.from({ length: range.end - range.start }, (_, i) => range.start + i);
  for (const [tilesetIndex, tileset] of project.tilesets.entries()) {
    const blankInRange = rangeIndices.filter((i) => tileset.sprites.tiles[i] === BLANK_TILE);
    if (!blankInRange.length) continue;
    for (const collision of metaspriteTileCollisions(project, blankInRange)) {
      add(
        'error', 'Sprite Forge',
        `Metasprite "${collision.name}" references a blank tile inside the range ${range.label} ` +
          `reserve on tileset "${tileset.name}" — the build will draw ${range.label} there instead ` +
          'of leaving it empty.'
      );
    }
  }
}
```

The existing warning (`metaspriteTileCollisions` against every reserved range including the
player's, already gated on the range being active via `spriteReservedRanges` itself, and
unconditional only on whether the tile is blank) stays exactly as it is — it already covers the
player's own range and the non-blank cases (within an already-active range) this new check does
not reach; both can fire for the same metasprite without conflict.

**Gate, probed directly against all six checked-in fixtures, not merely asserted**: `sample`,
`sample-rpg`, `sample-mmc1`, `sample-mmc3`, `sample-u512`, `sample-rpg-mmc1` — run through this exact
check, by hand, before writing this document. **Zero hits in every one.** `sample/` is the only
fixture with an active heart reservation today; none of its four metasprites references a blank tile
inside `$FE`/`$FF`. The other five currently have no active heart or cursor reservation at all. This
probe becomes a real `node:test` before this ships (§11).

### §5.8 A known, pre-existing gap this design does not fix

`renderer/forges/tile/import.js`'s own PNG-import path allocates directly into `freeTileSlots`, with
the identical content-based, reference-blind defect §5.5 fixes for the library importer — a
transparent PNG-imported quadrant matching `BLANK_TILE` could dedup or allocate onto an index a real
metasprite already references, for hand-drawn content. This design records that gap but does not fix
it: `import.js` is existing code with its own review history, outside this design's scope. §2.4's
authoring rule (no `BLANK_TILE` in a library sprite pool) sidesteps the half of the problem the
library itself could otherwise reintroduce.

## §6. Reference rewriting

**`terrain`**: one map, `tileMap: entry-local tiles[] index → destination background-table index`,
built by walking `entry.tiles` in order, resolving each through an exact-string match against
`permittedIndices` (blank or not — reusing existing, non-blank content is a real win, not merely a
theoretical one), and allocating anything unmatched from `freePermittedIndices`. Every metatile's own
`tiles` field is rewritten through this map — an entry-local index the map has no entry for (`≥
entry.tiles.length`, from a corrupted or future-schema entry) **refuses the whole import**, never a
silent passthrough of the raw number — the identical rule `remapScreenReferences` already holds to
elsewhere in this codebase ("there is deliberately no third 'leave it alone' answer"). `palette` is
the single resolved destination index from §7.3, applied uniformly to every metatile in the set,
since one entry declares exactly one palette.

**`monster`/`pickup`**: two maps, both over the sprite table. `tileMap` is unchanged in shape and
purpose — one map, built once over the entry's single shared `spriteTiles` pool (§2.4), used by every
declared pose's `tiles[k].tile`, however many poses there are. `paletteMap` is new: one entry-local
palette array index (into `entry.palettes`, §2.4) → destination palette slot, built by resolving each
of `entry.palettes` independently through §7.2/§7.3's own single-palette resolution — a one-palette
entry produces a `paletteMap` of length 1 and resolves byte-identically to how a `palette` (singular)
entry already did before this revision, since §7.2/§7.3 themselves are unchanged; they are simply
called once per entry-local palette instead of exactly once per entry, in `entry.palettes` order
(§7.4) — never independently, once P>1, since a later palette must see an earlier one's own chosen
slot as unavailable. Every declared pose's
`tiles[k].paletteIndex` resolves through `paletteMap`, exactly the way `tiles[k].tile` already
resolves through `tileMap` — a `paletteIndex` the map has no entry for (`≥ entry.palettes.length`,
from a corrupted or future-schema entry) refuses the whole import, never a silent passthrough of the
raw number, the identical rule `tileMap`'s own out-of-range case already holds to ("there is
deliberately no third 'leave it alone' answer"). §2.4's own synthesis (items 1-3) is what calls both
maps, once per pose, so no third map or lookup is needed for "the metasprite's destination id" or
"the animation's destination id" — those are still simply the values the core assigns when it pushes
each pose's own metasprite and animation, the same as before this revision, just done once per
declared pose instead of exactly once.

**`sfx`/`song`**: no references of any kind; the payload is self-contained and goes straight through
its own normalizer.

## §7. The import operation

### §7.1 Plan, then apply — a pure planning function, one defined apply operation

**`planLibraryImport(project, entry, options)` is pure: it never touches its `project` argument.**
It `structuredClone`s the project immediately, applies every remaining step in this section to the
clone alone, and returns either `{ ok: true, project: clonedAndImported, report }` or `{ ok: false,
reason }`. No partial mutation of anything the caller can see is possible, because nothing the
caller passed in is ever written to.

**`applyPlannedProject(target, planned) = Object.assign(target, planned)` — the one, single defined
operation that makes a successful plan real.** Since `planned` is a `structuredClone` of `target`
with new content only ever *added*, never a key removed, `planned`'s own top-level key set is always
identical to `target`'s — `Object.assign`'s "copy every own enumerable key" behaviour is therefore
already the total, correct operation; there is never a key present in `target` but absent from
`planned` to separately delete.

The renderer calls `planLibraryImport` **outside** `store.commit`; only on `ok: true` does it call
`store.commit('Import from library', (p) => applyPlannedProject(p, plan.project))` — a refused plan
therefore reaches `store.commit` never, creating no undo entry and no dirty mark. This is safe
because `renderer/store.js`'s own `commit()` always `pushUndo`s (a `structuredClone` snapshot) before
`mutate` runs and always bumps the revision counter and sets `dirty = true` afterward, **regardless
of what `mutate` actually changed** — wrapping a potentially-refusing operation directly in
`store.commit` would create a bogus undo entry and a false dirty mark on every refusal, which the
plan/apply split avoids by construction, since a refused plan is never handed to `commit` at all.

Wholesale top-level key replacement is safe against every Forge's own selection state, verified
directly rather than assumed: `undo()`/`redo()` already replace `store.project` outright with a
completely different top-level object on every call, so a Forge caching a sub-object reference
instead of re-deriving one from `store.project` on demand would already be broken by ordinary
undo/redo. The pattern already ships: `reorderMapsCore` (`shared/project.js`) does `project.maps =
newMapOrder.map(...)` inside an ordinary `store.commit`, today. Checked against three Forges for the
discipline that makes this safe: `map.js`'s selection state is a plain `state.mapIndex` number,
re-read through `store.project.maps[...]` fresh at every use; `tile.js`'s `state.tilesetId` and
`items.js`'s `state.selected` follow the identical index-based pattern. None caches a sub-object
reference `applyPlannedProject` would leave stale.

Sequencing makes this safe in practice too: the palette picker (§7.3) resolves `options.paletteSlot`
first, and `planLibraryImport`/`applyPlannedProject` then run back-to-back with **no `await`
between them** — the same "capture `store.revision` before an async step, refuse on any change
after" idiom `openGeneratePlayerSpriteModal` already uses guards the picker itself.

### §7.2 `options.paletteSlot` — validated, and a real headless default when it is omitted

**If `options.paletteSlot` is supplied, it must be `Number.isInteger(options.paletteSlot) &&
options.paletteSlot >= 0 && options.paletteSlot < LIMITS.palettes` (4)** — checked first, before any
capacity or reservation question is asked. A non-integer, negative, `≥ 4`, or numeric-string value
refuses immediately with a named reason, rather than reaching `project.palettes[key][options.
paletteSlot]` and either throwing, silently appending a fifth palette, or having a downstream
`clamp()` inside `normalizeMetatile`/`normalizeMetasprite` quietly resolve to a *different* slot than
the one the report would claim was used.

**If `options.paletteSlot` is omitted — the headless path every test, `main/smoke.js`'s default
step, and any future scripted caller uses — it resolves deterministically, never a prompt and never
a refusal on palette grounds:** the first exact match (post-canonicalization, §7.3) if one exists,
else the first entry of `unusedPaletteSlots` (§5.3) for the target table, else the slot chosen by
`nearestPaletteSlot` (below). All three are equally valid "the entry adopts whatever is already
there" outcomes when no unused slot exists, and this is true even when the chosen slot happens to be
reserved: a reserved slot is always selectable (§7.3), so the headless default can land there exactly
as any other slot without ever refusing.

**`nearestPaletteSlot(project, table, colors, excluded = new Set())` — a single-writer, called by
both the headless default above and the picker's own default selection (§10) — replaces the old,
purely positional "else slot 0" fallback.** It answers "the entry adopts whatever is already there"
with a real answer instead of an arbitrary one: which of the table's four slots looks least wrong to
render this entry in, rather than always "the first one." It reuses `shared/nespalette.js`'s own
existing perceptual machinery — `NES_LAB`/`labDistance`, the same CIE L*a*b* distance this codebase
already trusts for exactly this kind of judgement (`nearestNesColor`, `perceptualPaletteFor`) —
rather than inventing a second colour-distance metric: for each of the table's four slots, sum
`labDistance` over the three non-backdrop positions (`colors[1..3]` against that slot's own `[1..3]`,
position-matched — a palette's four colour roles are fixed, not reorderable, so position-matching is
correct and simpler than trying every permutation), and returns the slot with the lowest sum, lowest
slot index breaking a tie. Slot 0 of every palette is excluded from the comparison entirely, not
merely given zero weight, since §7.3's own backdrop canonicalization already forces it identical
across all eight palettes before any comparison runs — comparing it would only ever contribute an
identical, provably uninformative term to every candidate's sum. **`excluded` — the identical set
`paletteCandidates` (§7.3) now threads through — is removed from the candidate slots this function
sums over as well**, so a slot a different entry-local palette already claimed earlier in the same
plan can never be picked again here either, the same way it can no longer land in the "unused" outcome
above. This is a pure function of the four (or fewer, once `excluded` is applied) candidate slots'
existing colours and the entry's own three colours; it does not know or care whether a candidate slot
is reserved, exactly as `unusedPaletteSlots`'s own candidates never needed to either — reservation is
§7.3's concern, applied identically to whichever slot this function names.

**Every rule above is stated for "the palette" because v1's own inventory only ever declares one; a
`monster`/`pickup` entry with P declared palettes (§2.4) runs this exact resolution — validation, then
the exact-match/unused/`nearestPaletteSlot` priority chain — once per `entry.palettes[i]`, against
`options.paletteSlots[i]` when supplied.** `options.paletteSlots` (plural, an array) is the real
contract for P>1: each element, when supplied, is validated exactly as `options.paletteSlot` is above,
independently, against `entry.palettes[i]`; a length mismatch against `entry.palettes.length`, **or any
repeated value within `options.paletteSlots` itself**, refuses immediately (§7.6), before any
resolution runs — two entry-local palettes explicitly named onto the same slot is refused outright
rather than given adopt-or-overwrite semantics, since nothing about which one's colours a reader should
expect to see is otherwise well-defined for an interactive picker showing both steps in sequence. `options.paletteSlot` (singular) remains valid and is
read as `options.paletteSlots: [options.paletteSlot]` for the one-palette case; a caller may not
supply both. Every headless caller in this design's own inventory (§8) uses the singular form, since
no v1 entry declares more than one palette. Nothing about the per-palette resolution rule itself
changes for P>1 — what changes is only that it now runs P times, and (§7.4) each run after the first
must additionally treat any slot already claimed by an earlier run in this same plan as unavailable,
the same way an already-reserved slot already is, or two entry-local palettes could independently
resolve to, and both write into, the identical slot. **The same `excluded` set threads through every
step of the priority chain for `entry.palettes[i]` when `i > 0`, not only `paletteCandidates`'s own
outcome** — the exact-match test is checked against a slot only when it is not already in `excluded`;
`unusedPaletteSlots`'s own result is intersected with "not excluded" before its first entry is taken;
and `nearestPaletteSlot` is called with the identical `excluded` set (above), never a fresh, empty one
— so the headless default path (this section) and the picker's own per-palette step (§10) resolve
against the exact same available-slot set at every stage, and can never disagree about which slots
remain for a later entry-local palette to land on.

### §7.3 Palette placement — two outcomes, reserved slots always selectable

**A reserved slot is write-protected, not unsafe to select or adopt.** The picker (§10) shows all
four slots of the target table, every time, each previewed with the entry's own art rendered in
that slot's *actual current* colours; a reserved slot carries an informational caption naming the
engine fact that reserves it, but is never disabled. Resolution collapses to exactly **two**
outcomes, regardless of whether the chosen slot is reserved:

1. **The chosen slot is a member of `unusedPaletteSlots`** (§5.3 — genuinely non-reserved and
   unreferenced by anything, whether or not it also happens to be an exact match): write the
   entry's own canonicalized colours into it.
2. **Otherwise** — reserved, or in real use by something else, exact match or not — write **no
   colours at all**: the imported content's resolved palette index is simply that slot, and it
   renders in whatever colours already live there. Nothing else in the project ever changes as a
   side effect of this in v1. An exact match against a reserved slot lands here too, and is a
   perfectly fine outcome — nothing needs writing because the colours already agree, and reading a
   reserved slot's colours is never unsafe, only writing new ones into it is.

**Backdrop canonicalization happens before any comparison or write.** Every one of a project's 8
palettes (4 background, 4 sprite) has slot 0 forced to a single shared value on every load
(`normalizeProject`'s own palette block: `const backdrop = bg[0][0]; for (const palette of bg)
palette[0] = backdrop; for (const palette of sprite) palette[0] = backdrop;`), because the NES has
exactly one physical backdrop colour register shared across every palette. An entry's own declared
palette's own `[0]` (whether `entry.palette` for a `terrain` entry or one of `entry.palettes` for a
`monster`/`pickup` entry, §2.4/§6) is a placeholder with no meaning outside its own file, so it is
replaced with the destination project's real backdrop (`project.palettes.bg[0][0]`) before either an
exact-match test or a write: `canonical = [project.palettes.bg[0][0], colors[1], colors[2],
colors[3]]`. Writing the entry's own literal slot-0 value verbatim into, say, a `$0F`-backdrop
project would produce an internally inconsistent live project — one whose in-memory palettes
disagree with the invariant `normalizeProject` enforces on every load, which would visibly change
the instant the project is saved and reloaded purely from renormalization. Canonicalizing at import
time means the live project already is what a save/reload would produce.

**The discriminator, stated once, explicitly, since two genuinely different vocabularies already
exist in this codebase and neither should be reinvented.** The **tile table** side uses the tileset
object's own key names, `'background'` / `'sprites'` (plural — `tileset.background.tiles`,
`tileset.sprites.tiles`, and `freeTileSlots`'s own `kind` parameter). The **palette** side uses
`project.palettes`'s own key names, `'bg'` / `'sprite'` (singular). Every function in §5/§6/§7 that
takes a `table` argument for tile purposes (`permittedIndices`, `freePermittedIndices`,
`referencedTileIndices`) uses `'background'`/`'sprites'`; every function that returns or indexes
**palette** data — `reservedPaletteSlots` (§5.1), `unusedPaletteSlots`, `paletteCandidates` below —
uses `'bg'`/`'sprite'`, with no exception, since all three describe the identical four-plus-four
palette slots `project.palettes` itself holds. The one bridge point from the *other* vocabulary is
`paletteCandidates`, which receives the tile-table form (what the caller — the Tile or Sprite Forge —
already has as its own `state.table`) and maps it once, before ever touching `project.palettes` or
calling `reservedPaletteSlots`. **It resolves one palette at a time** — `colors` is a single
`[p0,p1,p2,p3]` array, `entry.palette` for a `terrain` entry (still exactly one) or one element of
`entry.palettes` for a `monster`/`pickup` entry (§2.4/§6) — since §10's picker already runs this step
once per entry-local palette:

```js
function paletteCandidates(project, colors, tileTable, mapper, excluded = new Set()) {
  const paletteKey = tileTable === 'background' ? 'bg' : 'sprite';
  const canonical = [project.palettes.bg[0][0], ...colors.slice(1)];
  const unused = unusedPaletteSlots(project, paletteKey, mapper);
  const reserved = reservedPaletteSlots(project, mapper)[paletteKey];
  return [0, 1, 2, 3].map((index) => {
    const colours = project.palettes[paletteKey][index];
    const exactMatch = colours.slice(1).every((c, i) => c === canonical[i + 1]);
    return {
      index, colours, exactMatch,
      unused: unused.has(index) && !excluded.has(index),
      excluded: excluded.has(index),
      reserved: reserved.has(index),
      reservedReason: reserved.has(index) ? reservedCaption(paletteKey, index, project) : null
    };
  });
}
```

**`excluded` — new, defaulting to empty — is the set of slot indices a *different* entry-local palette
already claimed earlier in this same plan (§7.4), and it is a genuinely third state, not a variant of
"reserved."** A reserved slot is always selectable — the whole point of §7.3's own two-outcome design
is that reading or adopting a reserved slot's colours is never unsafe. An excluded slot is different:
picking it a second time is not merely discouraged, it is refused outright at the options level (§7.2,
the duplicate-index check) the instant it happens through a headless or scripted caller — so offering
it as a live, clickable choice in the picker (§10) for `entry.palettes[i]` when `i > 0` would let an
author click something guaranteed to fail once submitted. The picker therefore disables — not merely
deprioritizes — any candidate with `excluded: true`, captioned to say which of the entry's own earlier
palettes already claimed it, the same way a reserved slot is captioned to say which engine fact claims
it. `unused: false` (already true for an excluded index, above) is what keeps it out of the *automatic*
resolution's "write fresh colours" outcome; `excluded: true` is the separate signal the picker uses to
refuse the click in the first place, so the options-level duplicate refusal (§7.2) is a backstop for a
scripted caller, never something an author using the picker can actually trigger.

`reservedCaption` names the exact engine fact from §5.1 in words: `"reserved for the player"`
(sprite, always), `"reserved because this project shows text"` / `"...has a title screen"`
(background slot 0), `"reserved for battle scenery"` (background slot 1, RPG only). It is a real
function returning real text, not a placeholder — §10's smoke step asserts the caption is present
in the picker's own rendered output, not merely computable in isolation.

### §7.4 Id and slot assignment, per kind — the full rules, restated

**`terrain` claims a slot from `unusedMetatileSlots` (§5.4) — in place, never appended.** There is
no "next id" to compute; the slot's own existing array index becomes the metatile's id, and its
record is overwritten wholesale by the result of `normalizeMetatile` on the remapped candidate.

**`monster`, `pickup`, `sfx`, `song` all append**: the new id is the destination array's current
`.length` at the moment of import — `project.sprites.actors.length` for an actor, `project.sprites.
metasprites.length`/`.animations.length` for the synthesized records, `project.sfx.length`/`project.
songs.length` for those two kinds — each capped by refusing outright (§7.6) if pushing would exceed
the matching ceiling: `LIMITS.actors`, `LIMITS.metasprites`, `LIMITS.animations`, `LIMITS.sfx`.
Songs share the identical `id < 0xFF, else NO_SONG` shape `shared/audio.js`'s own `songByte` already
enforces, with no separate `LIMITS` entry of their own. **An id is never reused from a deleted
slot** — this design follows the same "ids are dense; deletion renumbers, appending only ever grows
the array" discipline `renumberActorDeletion`/`renumberItemDeletion`/`renumberSfxDeletion` already
hold to everywhere else in this codebase; the next id for any appended kind is always exactly that
array's current length, full stop, never "the first gap."

**A `monster`/`pickup` entry with K declared poses appends K metasprites and K animations, each
following the identical append rule above** — `project.sprites.metasprites.length`/`.animations.
length` at the moment each one is pushed, capped by the same `LIMITS.metasprites`/`LIMITS.animations`
refusal (§7.6) — never a single combined allowance computed for "the entry" as a whole. An entry's P
declared entry-local palettes are each resolved through §7.2/§7.3 **in `entry.palettes` order, never
independently** — a slot chosen for `entry.palettes[i]` is added to the `excluded` set (§7.3) before
`entry.palettes[i+1]` ever resolves, so two entry-local palettes can never both land on, and both
write into, the same slot. A P=1 entry has no later palette to exclude anything from, so it resolves
byte-identically to how it already did before this revision.

**Name collisions on re-import are not refused — this codebase already treats duplicate names as
ordinary, not exceptional.** Every appended or claimed record's `name` is run through
`nameForDuplicateScreen(entry.name, destinationList)` — a function already generic over any
`{name}`-bearing array, and already reused by `duplicateActorPaletteSwapCore` for its own clones —
which returns the entry's own name unchanged if nothing in the destination list already has it,
else `"<name> copy"`, else `"<name> copy 2"`, `"<name> copy 3"`, and so on. Re-importing the same
entry a second time therefore never collides on name; it simply produces a second, distinctly named
record.

### §7.5 Post-import validity: only the errors this import actually causes may refuse it

**v11 shipped a deliberately blunt rule — the planned project must pass `validateProject` with zero
errors, full stop, no attribution — after three earlier attempts at attribution broke in three
different ways (Changelog, v6).** This round's first attempt at a fourth mechanism (`attributedErrors`,
comparing `(severity, where)` occurrence counts) was itself found unsound in review: `shared/
project.js`'s own `missingSfx`/`overlongSfx` checks (§11 test 16b) both report `where: 'Map Forge'`,
so an import that satisfies a dangling SFX reference (removing the `missingSfx` diagnostic) while its
own content happens to be over 255 frames long (adding the *different* `overlongSfx` diagnostic)
leaves that key's count unchanged before and after — the count-only comparison saw nothing, and let a
real new build error through. This is the mechanism below, revised a second time to close that gap.

**This mechanism does not rest on a claim that `planLibraryImport` leaves every pre-existing
diagnostic's truth unchanged — it does not, and the document's own test 16b is a case where it
doesn't:** appending an SFX entry at the exact id a live command already names genuinely changes
whether that pre-existing command has a missing-target error, because the reference it names has gone
from dangling to real. An earlier draft of this section claimed a general "nothing pre-existing is
affected" invariant; it was false (the append-only framing correctly notes `planLibraryImport` adds
content and, for `terrain`, overwrites one array slot nothing depends on — but *whether an existing
diagnostic fires* can absolutely change as a result, exactly as test 16b demonstrates on purpose).
Soundness instead comes directly from what `isNotWorse` checks, argued case by case below — not from
any blanket claim about what the import does or does not touch.

**The mechanism: within each `(severity, where)` bucket, match each `after` diagnostic against an
unclaimed `before` diagnostic whose message is textually the same *or numerically no worse* — never
merely "close enough after stripping digits."** Round 2's own first fix (exact match, then a
digit-normalized match) was itself found unsound in review: stripping every digit makes any two counts
of the *same* aggregate message indistinguishable, so a genuine increase (`shared/project.js`'s
`overlongSfx` check going from 2 to 3, in the exact scenario that satisfies a *different* dangling
reference at the same time) silently matched and the regression went unflagged. The fix compares the
embedded numbers instead of erasing them:

```js
function errorKey(problem) {
  return `${problem.severity} ${problem.where}`;
}

function messageSkeleton(message) {
  return message.replace(/\d+/g, '#');
}

function messageNumbers(message) {
  return (message.match(/\d+/g) || []).map(Number);
}

// True only if `after` is textually identical to `before`, or shares the same skeleton with
// every embedded number no greater than `before`'s corresponding number, position by position.
function isNotWorse(beforeMessage, afterMessage) {
  if (messageSkeleton(beforeMessage) !== messageSkeleton(afterMessage)) return false;
  const beforeNumbers = messageNumbers(beforeMessage);
  const afterNumbers = messageNumbers(afterMessage);
  if (beforeNumbers.length !== afterNumbers.length) return false;
  return afterNumbers.every((n, i) => n <= beforeNumbers[i]);
}

function attributedErrors(originalProject, candidateClone) {
  const before = new Map(); // key -> [{ message, used }]
  for (const p of validateProject(originalProject)) {
    if (p.severity !== 'error') continue;
    const key = errorKey(p);
    if (!before.has(key)) before.set(key, []);
    before.get(key).push({ message: p.message, used: false });
  }
  const regressions = [];
  for (const p of validateProject(candidateClone)) {
    if (p.severity !== 'error') continue;
    const pool = before.get(errorKey(p)) || [];
    const match = pool.find((entry) => !entry.used && isNotWorse(entry.message, p.message));
    if (match) {
      match.used = true;
    } else {
      regressions.push(p);
    }
  }
  return regressions;
}
```

`isNotWorse` subsumes an exact match: when every embedded number is unchanged, the skeleton and number
comparisons together are only satisfied by an identical message, so there is no separate exact-match
pass to keep in sync. `planErrors` (the name stays; only its body and signature change) is now
`attributedErrors(project, clone)`, called with the real, unmodified project and the fully-planned
candidate. The plan refuses only if `attributedErrors(...).length > 0`, and the refusal names exactly
those problems — never the project's other, unrelated errors, and never fewer than the real
regressions either. Matching is per-key, so a diagnostic at one `(severity, where)` can never be "used
up" satisfying an `after` diagnostic at a different key — `pool` is looked up fresh from `errorKey(p)`
on every `after` item.

**Why this closes all five known failures, each addressed by name:**

1. **"An aggregate error whose count decreases changes its own message text and gets misclassified as
   new" (v6) cannot happen: a decrease is exactly what `isNotWorse` is built to recognise, not merely
   tolerate as noise.** A diagnostic shrinking from `"3 ... commands do not ..."` to `"2 ... commands do
   not ..."` shares a skeleton and `2 <= 3`, so it matches and is never flagged — the decrease is
   *understood*, not merely ignored because the two strings happened to look similar after erasing
   information.
2. **"One whose count could increase without the diagnostic's text changing could hide a genuine
   worsening behind an unchanged string" (v6) cannot happen: `used` is per-instance, not per-key, and a
   real increase fails `isNotWorse` outright** (its number is *larger*, not merely different) rather
   than being erased into equality with its predecessor the way plain digit-stripping erased it.
3. **"Giving every diagnostic a stable `code`/`subject` ... changed the shape of every object
   `validateProject` returns" (v6) still does not apply.** `errorKey`, `messageSkeleton` and
   `messageNumbers` all read only `severity`/`where`/`message` — the exact three keys `test/unit/
   drawvalidation.test.js`'s own `assert.deepEqual(problems[0], { severity, where, message })` already
   asserts every diagnostic has — and compute values *outside* the diagnostic object, never written
   back onto it.
4. **Round 1's failure — "two different diagnostics sharing one coarse `where` can substitute for each
   other at an unchanged count" — is closed by requiring a skeleton match before any number is even
   compared**, exactly as round 2's digit-normalized pass already did: `missingSfx`'s and `overlongSfx`'s
   own message skeletons are completely different beyond any digit, so a substitution between them
   never reaches the numeric comparison at all and is unconditionally flagged.
5. **Round 2's own failure — "digit-normalizing erases whether the count went up, not just whether it
   changed for cosmetic reasons" — is closed by comparing the actual numbers rather than discarding
   them.** The exact counterexample reviewer found (`overlongSfx` 2→3, sharing a skeleton with a
   pre-existing count-2 instance) now fails `isNotWorse` (`3 <= 2` is false) and is correctly flagged;
   test 16c (§11, new) proves this against the real check.

**A remaining, disclosed limitation, narrower than before and still in the safe direction only:** a
diagnostic whose message pluralizes on its own live count (`"1 ... command does not"` vs `"2 ...
commands do not"`) changes its *skeleton*, not just its numbers, at the exact moment the count crosses
the singular/plural boundary — `messageSkeleton` sees different surrounding words, not only a
different digit. An *increasing* crossing (1→2) is still correctly flagged regardless, since a skeleton
mismatch alone already treats it as unmatched. A *decreasing* crossing (2→1, a genuine improvement)
is the one case this mechanism gets wrong: the skeleton mismatch means `isNotWorse` never even reaches
the numeric comparison that would have recognised the decrease, so it is treated as a new diagnostic
and the import is refused unnecessarily. This is, once again, an over-refusal, never a missed
regression — the same failure direction this codebase already prefers throughout — so it is named here
precisely rather than left for someone to rediscover with a different, possibly less charitable,
characterization.

**Ordering is unaffected**: §7.6's refuse-before-mutate order still puts this check last, after every
capacity refusal, so a validity refusal under this mechanism is, as before, never reached until the
candidate is fully planned.

**A stated boundary, not a silent one: `isNotWorse`'s own case-by-case argument above is what this
mechanism's soundness rests on, and it does not automatically transfer to a different feature that
edits or removes existing project content.** This design's own imports can and do change whether an
existing diagnostic fires — test 16b is exactly that — but every such change follows one of two shapes
`isNotWorse` is built to recognise: a diagnostic disappearing entirely (a reference fully satisfied,
nothing left to report), or a diagnostic's own live-embedded number moving in a way its message's
skeleton makes visible (a count growing or shrinking within the same aggregate check, tests 16c/16d).
**An operation that could change an existing diagnostic's `where` or its message's skeleton for content
that already existed — not merely shift a number within an unchanged skeleton, or make a diagnostic
disappear outright — would need its own argument for why matching by `(severity, where)` plus
`isNotWorse` still attributes correctly; this design does not make that argument, because nothing it
builds needs one.

### §7.6 Refuse-before-mutate, the full order

1. `options.paletteSlot` type/range, when supplied (§7.2) — before anything else.
2. Id-space capacity per kind — would this push the destination array's length past the matching
   `LIMITS.*`? Checked before any tile or palette work, since there is no point computing a remap
   for content that cannot be assigned an id at all.
3. Tile-space capacity — is `freePermittedIndices` (§5.5, tileset-aware) large enough for the
   entry's own tiles that dedup could not match to something already present?
4. Build the full candidate on the `structuredClone` — every step in §6's remap, §7.4's id/slot
   assignment and duplicate-name handling, §7.3's palette outcome (writing fresh colours or
   adopting existing ones, per that section's own two-outcome resolution).
5. `planErrors(project, clone)` (§7.5, i.e. `attributedErrors`) — refuse if non-empty, naming every
   text-matched-and-still-unattributed error verbatim. (`options.paletteSlot`/`options.paletteSlots`'
   own validation, and the duplicate-index refusal, are both step 1 above — checked before this step
   ever runs, exactly as every other palette-slot validation already is.)
6. Return `{ ok: true, project: clone, report }`.

Every refusal returns `{ ok: false, reason }` with the caller's own project completely untouched —
not merely unchanged in content, but literally never passed to anything capable of mutating it,
since every step above operates on the clone alone.

### §7.7 What the operation reports — the full contract

**On success**: `report` names the entry's kind and name; how many tiles were written fresh versus
matched via dedup, and into which tileset; for `terrain`, which metatile slot was claimed; for
`monster`/`pickup`/`sfx`/`song`, the new id each appended record received — every pushed metasprite
and animation for a multi-pose entry included, one line per pose; the palette outcome, once per
entry-local palette — whether that palette's own colours were freshly written into a slot, or whether
it adopted an existing slot's colours, naming the slot either way; and, for `pickup` specifically, the
fixed line pointing
the author at the Items Forge's "Collected from" control (§2.3), since no item is ever written
automatically. **Every success report also carries one further fixed line, unconditionally: "Capacity
is checked at build."** — §7.8 states why this line exists and what it is warning about. The
renderer turns the whole report into one `toast` call, the identical function `renderer/forges/tile/
import.js` already uses for its own PNG-import success message.

**On refusal**: `reason` is one of three specific, human-readable shapes, never a generic "import
failed" — an id-capacity or tile-capacity refusal names the exact ceiling and how much room the
entry needed against how much was available; a palette-slot validation refusal names the invalid
value and the valid range; and a `validateProject`-error refusal (§7.5) names exactly the errors this
import would newly introduce or worsen — `"This import would cause these problems:"` followed by each
attributed diagnostic's own message verbatim, never the project's other, pre-existing, unrelated
errors. Because §7.6 checks capacity before ever reaching §7.5, and because §7.5's own mechanism only
ever attributes errors the import's own writes actually pushed past their pre-import count, this list
is never empty at the moment this refusal fires and never contains anything the import did not cause.

### §7.8 Generator capacity is outside this design's own contract — a named limitation, not a gap left silent

**§7.6's own capacity checks (id-space, tile-space) and §7.5's `validateProject` attribution rule are
not the same thing as "this project will still build a ROM." `checkCapacity` (`main/build/
generate.js`) is a separate, larger function — it calls `validateProject` internally and then adds
generator-level checks `validateProject` itself has no way to express: whether the compiled music/
SFX/text data fits the fixed `$E000` kernel bank, whether the per-actor/per-item/per-metasprite
lookup tables fit kernel-lo, whether screen data fits its own banks, whether an RPG's compiled
battle tables fit the banked battle region. None of this is reachable from where `planLibraryImport`
runs**: `checkCapacity` needs `node:fs` (it is defined in `main/build/generate.js`, a main-process-
only module), `shared/` can never import it, and no IPC channel exposes it to the renderer at all —
verified directly, not assumed: `grep -i capacity main/preload.cjs` finds nothing.

**v1 therefore does not, and cannot, preflight kernel-lo table bytes, the music/text bank, screen
data, or the banked battle region before an import completes.** The consequence, stated plainly
rather than left for an author to discover unexplained: **a successful import can make the *next*
build report a capacity overflow in the Build panel that did not exist before the import.** This is
identical, byte for byte and in kind, to what hand-authoring the same SFX entry, actor, or metatile
through the ordinary Tile/Sprite/Sound Forge UI would already do — the library import writes nothing
`checkCapacity` treats specially, so it fails exactly the way manually-typed content already can and
always could. **It is never a corruption**: the imported content is ordinary, valid project data:
`undo` removes it cleanly, and the project remains fully open and editable either way — only the
*next build* is what reports the overflow, in the Build panel, by name, the same way it already
reports one for any other over-budget project.

**Both of those guarantees — a named `checkCapacity` report, and "never a corruption" — hold for
stock, non-placement-overridden builds. They are weaker, in ways this design inherits rather than
changes, whenever the Code Forge has overridden the battle system.** CLAUDE.md's own "The battle
system" section documents two such predicates, and this design does nothing to either — it does not
make their guarantee stronger or weaker than it already is for hand-authored content:

- **`battleCodeOverridden(project)`** — the author has replaced `battle.asm` (or `battleui.asm`/
  `battleturn.asm`, which it includes) with their own 6502. `checkCapacity` cannot size hand-written
  code from its text, so — exactly as CLAUDE.md already states — "an override project is checked
  against the one bound that holds no matter what it assembles to: the generated tables alone, which
  the override cannot shrink. Anything past that the assembler answers." An actor import that grows
  those generated tables is still checked by `checkCapacity` against that one bound, correctly; but
  if the override's *own* code plus those tables together overflow the banked battle region — a
  combination `checkCapacity` has no way to see — the *next build* fails with raw nesasm output
  (`Bank overflow, offset > $1FFF!` against `battle.asm`, `main/build/generate.js:2354-2366`'s own
  `.fail`-tripwire comment block, its exact quoted text at `:2363`, verified directly), not a named,
  Forge-attributed error the Build panel would otherwise show.
- **`battleRegionPlacementOverridden(project)`** — the author has additionally overridden `main.asm`
  itself, and it may relocate the battle region's tables somewhere else entirely, or drop them.
  CLAUDE.md: "No capacity refusal is raised at all in that case." `checkCapacity`'s own battle-region
  check (`main/build/generate.js:1978`, gated on `!battleRegionPlacementOverridden(project)`) does
  not run at all here — an import that grows the tables is checked by nothing generator-side, named
  or otherwise, exactly as any other content addition to such a project already is not.

**The import changes nothing about either guarantee — it inherits whichever one already applies to
the project being imported into, the same way it inherits every other consequence of `checkCapacity`
living outside its own contract (above).** The toast's fixed line, "Capacity is checked at build,"
stays exactly that in every case — it does not, and cannot, promise *which* of these three outcomes
(a named report, raw assembler output, or no check at all) the next build will actually produce,
since that depends entirely on the destination project's own Code Forge state, not on anything the
import itself does.

**Future closure, recorded here rather than built**: a `build:capacity` IPC channel taking a project
snapshot (exactly the clone `planLibraryImport` already produces) and returning `checkCapacity`'s own
verdict would let the renderer preflight an import against the real generator ceiling before
committing to it — out of scope for this design, restated in §14.

## §8. The concrete inventory, and what actually happens on import — real numbers

### §8.1 The inventory

**Terrain** (5 sets, 2 shared background palettes — `Nature` for Grass Plains, Dirt Path, Shallow
Water; `Built` for Stone Floor, Wood Planks — each set exactly 2 metatiles, Plain and Edge, and 5
unique tiles: one base tile repeated across all four quadrants of Plain, four distinct transition
tiles for Edge). Totals: 10 metatiles, 25 unique background tiles, 2 background palettes. Shallow
Water's metatiles use `collision: 'water'`.

**Monster** (3 — Slime, Bat, Skeleton — usable in either game type, sharing one sprite palette
`Creature`; each entry §2.4's shape, one resting metasprite of 4 tiles). **Pickup** (4 — Key, Coin,
Potion, Scroll — sharing one sprite palette `Item`; identical shape, `damage: 0`). Totals: 7 actors,
7 metasprites, 7 synthesized animations, 28 unique sprite tiles, 2 sprite palettes.

**Sfx** (8, the brief's own list: hit, pickup, menu, door, hurt, heal, error, jump — each ≤
`SFX_MAX_STEPS`, 8, steps). **Song** (2 — a short title jingle, a short ambient loop — each ≤ 2
patterns).

### §8.2 Real, probed budgets

Every figure below comes from a `node --input-type=module` probe against this working tree's own
`createProject`, `loadProject`, `freeTileSlots`, `spriteReservedRanges`, `projectUsesText`,
`fontBankSplit`, `projectUsesHeartArt`, and hand-rolled reference-count walks matching §5.2-§5.6's
own definitions exactly — not estimated.

| project | BG usable (Main/Overworld) | sprite usable | BG usable, battle tileset | metatile slots free | BG palette free | sprite palette free |
|---|---|---|---|---|---|---|
| fresh `createProject('Test', 'action')` | 255 | 224 | — (no battle tileset) | 63 | {1,2,3} | {1,2,3} |
| fresh `createProject('Test', 'rpg')` | 159 | 224 | 159 (no block art exists yet) | 63 | {2,3} | {1,2,3} |
| `sample/` (real) | 151 | 210 | — (action project) | 58 | {} | {3} |
| `sample-rpg/` (real) | 157 (Overworld) | 212 | 141 (tileset 1, its own `rpg.battleTilesetId`) | 61 | {2} | {3} |

`sample-rpg/`'s own battle-tileset figure (141) reflects §5.6's own reference walk against its real
`Slime` actor (`battle.battleTile: 32, battleW: 4, battleH: 4`) — sixteen indices in that rectangle,
five of which (`35, 51, 67, 82, 83`) are genuinely `BLANK_TILE` today (real, intentional gaps in
Slime's own art) and are correctly excluded from allocation. Its *second* tileset, also named
"Battle" but **not** the project's actual `rpg.battleTilesetId`, is correctly unaffected — 157,
identical to what it would be with no reference walk at all — proving the fix is scoped to the
tileset the field actually names, not to every tileset sharing a label.

### §8.3 What importing everything does

**No import in this inventory can refuse on palette grounds in any scenario** — §7.3's two-outcome
resolution never has a third, refusing branch. Fresh projects give every entry its own designed
colours (the RPG case's 2 free background slots exactly cover `Nature`+`Built`, with zero spare —
the tightest passing case, still passing). `sample/` and `sample-rpg/` never reach the
"genuinely free slot" case for the `Nature` group at all: §7.2's own priority chain tests every
candidate slot for an exact match — over the three non-backdrop positions, slot 0 included —
*before* it ever looks at which slots are free, and both fixtures' own background palette 0 already
holds `Nature`'s exact non-backdrop colours (`0x1a, 0x2a, 0x30`), so Grass Plains, Dirt Path and
Shallow Water all **adopt** slot 0 on both fixtures rather than writing anything. `sample-rpg/`'s one
genuinely free bg slot (2) therefore goes to the *next* group instead — `Built`'s first entry, Stone
Floor, writes it fresh, and Wood Planks then exact-matches it — while on `sample/` (no free bg slot
at all) every terrain entry adopts. The sprite side runs the way this paragraph's opening claim
already describes: Slime (the first `Creature`-group entry) takes the one free sprite slot (3), and
every later monster/pickup entry adopts. §11 test 30 pins this exact per-entry sequence against both
fixtures. **Tile-table and metatile-slot capacity never bind in any of the four scenarios
probed**: 25 unique background tiles and 28 unique sprite tiles remain comfortably under every
measured minimum, including the tightened 141-tile battle-tileset figure — which a terrain import
would not ordinarily even target, since the walkable "Overworld"/"Main" tileset is the natural
destination for scenery, not the tileset holding monster block art.

**§7.5's attribution rule is what can now refuse an import that palette placement alone never
could** — every one of the four scenarios above is drawn from a project with no pre-existing build
error, so none of them is affected by it either way; §11's own tests are what exercise the rule
directly, since neither fresh projects nor the two real fixtures happen to already carry one.

## §9. Zero cost, and the six-fixture gate

Nothing in this design changes the generator, the engine, or any wire format that did not already
exist — an imported entry is indistinguishable, the instant it lands in `project`, from identical
content a human typed by hand through the Tile/Sprite/Sound Forge. A project that never opens a
library picker is byte-for-byte what it would have been without this feature existing at all.

**The gate is all six fixtures, not a subset.** `sample/`, `sample-rpg/`, `sample-mmc1/`,
`sample-mmc3/`, `sample-u512/`, `sample-rpg-mmc1/` (`test/unit/samplegen.test.js`'s own six-generator
list) are never touched, imported into, or regenerated by this feature; `tools/make-*.js` and
`shared/library/*.js` share only the promoted `authoring.js` helpers (§3), proven inert by
`samplegen.test.js` itself. The commit that ships this feature pins a SHA-256 ROM hash for all six,
before and after, with nothing imported into any of them — the same per-slice pattern this codebase
already uses for every recent content-only slice, run six times rather than assumed to generalize
from one or two. **§5.7's new `validateProject` check gets its own, separate gate**: the identical
six fixtures, run through `validateProject` before and after that check exists, asserting the error
count is unchanged (already probed by hand in §5.7 — becoming a real test, §11) — a gate on the
*validation change itself*, since it alters what every existing project sees at build time, not only
what a future import can do.

## §10. The UI

**Terrain** (Tile Forge): a new "Import from library…" button beside the existing "Import image…."
Opens a picker listing every `terrain` entry, each previewed by drawing its metatiles' quadrants
through `shared/nespalette.js`'s RGB lookup on a canvas sized via `fitZoom`/`observeSize` — never a
fixed pixel size. Choosing an entry opens §7.3's own palette-candidate picker as a required second
step: all four background-palette slots shown, each rendered with the entry's own art in that slot's
actual current colours, reserved slots captioned rather than disabled. **One candidate is
pre-highlighted as "the suggestion"** — the exact slot §7.2's headless default would resolve to
(exact match, else `unusedPaletteSlots`'s first entry, else `nearestPaletteSlot`, §7.2) — but every
one of the four remains clickable regardless of which is highlighted; choosing a different one is not
a special path, only a different, equally valid input to the same §7.3 resolution. Only after a slot
is chosen does `planLibraryImport` run.

**Monster / Pickup** (Sprite Forge): the identical two-step flow, over the sprite table and sprite
palettes, previewing the entry's own poses — `idle` alone when that is all the entry declares (every
v1 entry), or all of `idle`/`walkDown`/`walkUp`/`walkSide` the entry actually provides, each labelled
by direction. **A multi-palette entry runs the second step's own palette-candidate picker once per
entry-local palette, in `entry.palettes` order, never all at once in one combined picker** — each
resolution runs in that same order, never independently (§6/§7.2/§7.4), so a two-palette entry can
freely adopt one existing slot and write fresh colours into another, but can never have its second
palette silently land on the slot its first one just claimed. **The second (and any later) step's own
candidate list disables whichever slot an earlier palette in this same import already chose** (§7.3's
`excluded` field), captioned to name which of the entry's own palettes claimed it — an author can see
why it is unavailable, but cannot click it, which is what keeps the options-level duplicate-index
refusal (§7.2) a backstop for a scripted caller rather than something the picker itself can ever walk
an author into. Every v1 entry declares exactly one palette, so this repeats exactly
once, unchanged from before this revision. A future entry that actually declares more than one pose or
palette will need its own `main/smoke.js` coverage of this repeated-picker flow; none of v1's inventory
does, so none exists yet — named here rather than left implicit.

**Sfx / Song** (Sound Forge): a picker with no palette step at all, since neither kind touches a
tileset or a palette — previewed by handing the entry's own raw `sfx`/`song` object to the existing
in-app player before import.

**`showModal`'s `null`-on-dismiss**: the picker resolves `null` on Escape or a backdrop click exactly
like every other `showModal` call in this codebase; the caller does nothing further and no partial
import state is left behind.

**`main/smoke.js` drives the picker for real, not only the headless default path.** At least one
Tile Forge step and one Sprite Forge step open the picker, **choose a specific, non-default,
already-in-use slot** (never the suggestion), and assert: `project.palettes` is byte-identical before
and after (proving a true adoption — no colours written); the pushed metatile/metasprite's own
`palette` field equals the *chosen* slot, not the suggested one; and the reserved slot's own caption
text is present somewhere in the picker's rendered candidate list, not merely computable in
isolation. A further step exercises the ordinary headless default path (§7.2) for the remaining
kinds, so both paths in this design are actually driven by something, not merely specified.

## §11. Tests

Each entry names the wrong implementation it catches, and where a real blind spot remains in this
design's own test list, states it plainly rather than silently.

1. **Sprite palette 0 excluded from `unusedPaletteSlots` with zero metasprite references** (a fresh
   action project has none). *Catches*: reservation by reference-count alone. *Still passes*: missing
   background-1 for RPG — test 2.
2. **Background palette 1 excluded for a fresh RPG project with zero metatile references**, plus a
   fresh-action control proving it is *not* excluded there. *Catches*: sprite-only coverage, and
   over-broad reservation for every game type.
3. **`bgRefCount` counts a monster's block-art `battlePalette` via `hasBattleBlockArt`** (an actor
   with `battleTile: 5, battlePalette: 2`, no metatile referencing 2) — `unusedPaletteSlots` excludes
   2. A second assertion, same test: an actor with `battleTile: 255, battlePalette: 2` explicitly set
   does **not** cause slot 2 to be excluded, since `hasBattleBlockArt` correctly reads `255` as "no
   block art." *Catches*: a background count that only walks `project.metatiles`, and (via the
   second assertion) one that still tests `battleTile !== null` directly instead of the shared
   predicate.
3b. **`battleSpriteBudget` counts an explicit-255 actor as a sprite, not as block art.** An RPG
    project with one actor whose `battle.battleTile: 255` is set explicitly (not `null`), placed once
    on a screen with `damage > 0`; assert the exported `battleSpriteBudget(project, mapper)` includes
    its resting metasprite's own tile count in `used`. *Catches*: reviewer Medium #3's own named
    defect in `formationSpriteCost` — treating a non-null `battleTile`, `255` included, as "has block
    art" and silently omitting the sprite the engine actually draws. A probe against all six
    checked-in fixtures (`sample`, `sample-rpg`, `sample-mmc1`, `sample-mmc3`, `sample-u512`,
    `sample-rpg-mmc1`) confirms zero actors anywhere carry an explicit `battleTile: 255` today, so
    this fix changes no fixture's validation output — this test is what proves the fix is real for a
    project that does.
3c. **The battle-art font-collision check raises no error for either "no block art" sentinel, on a
    non-split RPG.** Two actors in the same non-split-font RPG project — one with `battle.battleTile:
    null` (the ordinary default), one with `battle.battleTile: 255` set explicitly — neither with
    `battleW`/`battleH` chosen to matter, since neither should ever reach the rectangle arithmetic at
    all; assert `validateProject(project)` raises no `"battle artwork runs into the message font"`
    error for either. *Catches*: reviewer High #1 exactly — the false error an explicit `255` would
    raise under the unfixed `battleTile === null || undefined` skip, which — under v11's now-
    superseded zero-errors rule — would have refused every library import into the project, whether
    or not the import touched anything related to the actor at all; under §7.5's current attribution
    rule (v12) a pre-existing instance of it would only ever block an import that itself introduced
    it as a new occurrence, but the false error is a real `validateProject` defect regardless of
    which rule sits above it, and this test still needs it fixed.
3d. **`describeBattleTileState` is DOM-free and correct for the explicit-255 sentinel — no mounting,
    no DOM, no stub.** `test/unit/monster.test.js` (new file — no existing test currently mounts or
    exercises `renderer/forges/monster/monster.js` at all, verified by grep; `test/unit/
    monsterlevel.test.js` is the only `monster*.test.js` file and covers ROM byte-identity for
    `battle.level`, an unrelated field, never rendering). This repository has **no jsdom or
    jsdom-equivalent dependency at all** — verified directly: absent from `package.json`, and
    `test/unit/banked.test.js`'s own comment states plainly that "this codebase has no jsdom-style
    stand-in" for a real `document`, with renderer coverage living in the real-Electron smoke test
    instead. A `node:test` file therefore cannot mount `monster.js`'s rendering function at all — not
    even with a stubbed canvas context, which covers `strokeRect` alone and not the `document`/
    `el()`/`drawSheet` calls the mount would also need. The fix from the prior round already avoids
    this problem for the right reason, not by accident: `describeBattleTileState` (§5.3) is a plain
    function taking an actor and returning `{ hasBlock, label }`, with no DOM dependency whatsoever
    — the same shape `routes.test.js`/`banked.test.js` already use for shared-module logic, imported
    directly from `shared/project.js`. Call it with `{ battle: { battleTile: 255 } }`; assert
    `hasBlock === false` and `label === 'No block chosen — the actor is drawn from its animation.'`.
    *Catches*: reviewer's own named defect exactly — `"Block at $FF, 4×4 tiles."` with a live "Use the
    animation" button for an actor the engine and `validateProject` both already treat as having no
    block art at all, and (via the Low finding this round resolves) a test plan that would have
    silently depended on infrastructure this repository does not have.

Test 10 (above) already covers the wrapping case's own correctness (`battleBlockIndices({battleTile:
250, battleW: 4, battleH: 2, ...})` returns exactly `[250,251,252,253,10,11,12,13]`) — no separate
Monster-Forge-specific version of that assertion is needed, since the overlay now consumes that exact
function's output directly rather than recomputing anything of its own; a second copy of the same
assertion under a different test number would be duplication, not additional coverage.

**The mounted Forge itself is exercised by `main/smoke.js`, in the real Electron window §12's
manifest test and every `node:test` above cannot reach — and the smoke harness genuinely *can* read
what was drawn, verified against its own existing precedent rather than assumed.** `main/smoke.js`
already samples real canvas pixels in several places (`canvas.getContext('2d').getImageData(x, y, 1,
1).data` and `canvas.toDataURL()` comparisons, both used repeatedly already, e.g. its Tile Forge and
palette-swap steps) — a real rasterizer in a real window, not a stub, so this is not new
infrastructure. **The new step**: open the Monster Forge on an actor whose `battle.battleTile: 250,
battleW: 4, battleH: 2` is set, and sample the sheet canvas's own pixel data at a point inside tile
10's own cell (row 0, the wrapped-to cell the fix draws and the pre-fix code never reached at all,
since the old single-rectangle math only ever touched row 15 and an off-canvas row 16) — asserting
the orange stroke colour (`#ff9d3c`) is present there. This directly distinguishes the fix from the
defect: the old code drew nothing at row 0 for this actor at all, so this exact pixel is empty
tileset art before the fix and stroke-coloured after it — a real, rendered difference, not a label
string standing in for one.

**The same step then selects a second actor, one with `battle.battleTile: 255` set explicitly, and
asserts the rendered DOM directly — not the pure helper again, and not the overlay pixels, but the
two mounted call sites (`:214`/`:223`) themselves.** The pure-helper test (3d, above) proves
`describeBattleTileState` itself answers correctly in isolation; the pixel-sampling assertion just
above proves the overlay consumes `battleBlockIndices`; **neither one proves `monster.js:214`/`:223`
actually call `describeBattleTileState` at all** — an implementation that adds the exported helper
but leaves the original, independent `battle.battleTile === null || battle.battleTile === undefined`
ternary sitting at both of those two lines, unused, would still pass both. This closes exactly that
gap: query the rendered `span.hint` element's `textContent` and assert it equals
`'No block chosen — the actor is drawn from its animation.'` — the exact no-block-art label
`describeBattleTileState` returns — never `` `Block at $FF, ${width}×${height} tiles.` ``; and assert
no `button.btn.btn-sm` reading `'Use the animation'` is present in that row at all. *Catches*: an
implementation that exports and correctly tests `describeBattleTileState` and `battleBlockIndices` in
isolation, wires the overlay draw to the latter (passing the pixel-sampling assertion above), but
never actually replaces the two label/button call sites' own original ternary — the exact wrong
implementation the prior review round named, which every test before this one could pass while still
showing `"Block at $FF, 4×4 tiles."` and a live "Use the animation" button for an actor that has no
block art at all.
4. **Backdrop canonicalization round-trips**: import into a `$0F`-backdrop project, writing a
   genuinely unused slot; the live project's new slot 0 is already `$0F`; `saveProject`/
   `loadProject` changes nothing. *Catches*: writing the entry's literal slot-0 value verbatim.
   *Still passes*: comparing the uncanonicalized entry for exact-match — test 5.
5. **Exact-match ignores slot 0**: `[0x00,a,b,c]` vs. entry `[0x0f,a,b,c]` resolves as a match.
   *Catches*: test 4's blind spot.
6. **Cross-entry dedup against real, non-blank art**: import `Slime` twice; the second import's
   matching tiles reuse the first's destination index, nothing appended. *Catches*: a blank-only
   allocator, which would duplicate tiles on every re-import.
7. **A referenced blank tile is excluded from allocation**, on both tables: a sprite/background
   index still `BLANK_TILE` but referenced by an existing metasprite/metatile is skipped; allocation
   lands on the next genuinely free index. *Catches*: content-only allocation overwriting a
   deliberately transparent quadrant.
8. **Bound-tile alternates are claimed**: a metatile named only by `screen.boundTiles[].metatileId`
   (never `screen.metatiles`) is excluded from `unusedMetatileSlots`, and its `palette` from
   `unusedPaletteSlots`. *Catches*: a walk that reads only `screen.metatiles`.
9. **A renamed-but-pristine metatile is not claimable** — rename metatile 5 to `"Lava Trigger"`,
   leave its tiles/palette/collision default and unpainted; excluded from `unusedMetatileSlots`.
   The synthetic reproduction of `sample/`'s own real `"Void"` case. *Catches*: `isPristine` ignoring
   the name field.
10. **The battle-block walk mirrors the engine's byte wrap exactly**: `battleTile: 250, battleW: 4,
    battleH: 2` on the battle tileset references exactly `{250-253, 10-13}`, never `{250-253,
    266-269}`, never refused. A second assertion: importing into a *different* tileset is unaffected
    by this rectangle. *Catches*: reviewer High #2 — unbounded arithmetic, and over-applying the fix
    to every tileset sharing a name.
11. **`battleTile: 255` (explicit) and `battleTile: null` both reference nothing.** *Catches*: a
    guard checking only `null`/`undefined`, missing the byte-identical explicit-255 sentinel.
12. **The new `validateProject` error fires only when active and blank**: (a) blank `$FE` reference +
    active heart reservation → new error; (b) same reference, reservation inactive → neither check
    fires (the pre-existing warning is also already gated on the range being active, via
    `spriteReservedRanges` itself); (c) active reservation + genuinely non-blank art → only the
    pre-existing `:5796`-style error, not the new one. *Catches*: the §5.7 gap, and over-firing.
13. **The six-fixture gate for the new error** — `validateProject` on each of the six checked-in
    fixtures raises no new problem, the §5.7 probe made a permanent test.
14. **A clean import into a clean project succeeds.** *Catches*: a `planErrors` bug that refuses for
    an unrelated reason.
15. **Warnings alone never refuse** — import into a project already carrying a genuine
    `validateProject` warning; still succeeds. *Catches*: a severity filter that refuses on any
    problem, warnings included.
16. **An unrelated pre-existing error no longer blocks an unrelated import.** A project with one
    genuine, unrelated build error (a live Give/Take naming a deleted item); a clean `sfx` import
    succeeds, and that Give/Take error is still present and unchanged in the project afterward (this
    design never fixes anything it didn't cause). *Catches*: the v11 behaviour this round
    deliberately reverses — refusing on an error the import's own writes could not possibly have
    caused — and, separately, an implementation that discards the original project's own diagnostics
    entirely before comparing (so `before` is always empty and every `after` diagnostic reads as new),
    which this specific case — one unrelated, completely untouched error — would immediately expose.
16b. **A single import that satisfies a dangling reference while also introducing a genuinely
    different problem at the same coarse `where` is still caught — the exact case count-only matching
    missed in this round's own first review.** A project has one live `Play a sound effect` command
    naming SFX id 1, which does not exist yet (`shared/project.js`'s own `missingSfx` check fires:
    `"1 Play a sound effect command does not name a real effect..."`, `where: 'Map Forge'`). Import an
    `sfx` entry, deliberately authored past `SFX_MAX_STEPS`-worth of duration so `sfxFrameLength(...) >
    255`, landing at id 1 (the destination array's next append slot, §7.4); assert the plan **refuses**,
    naming the *new* `overlongSfx` diagnostic (`"...takes longer than 255 frames..."`) specifically —
    never the old `missingSfx` text, which genuinely no longer exists. A second, companion case: the
    identical starting project, importing a short (in-bounds) `sfx` entry at the same id instead;
    assert the plan **succeeds** — the dangling reference is satisfied, nothing new appears at that key,
    and an empty `before` pool at that key (nothing left unmatched) correctly finds nothing to flag.
    *Catches*: the v12-round-1 failure mode by name — two textually different diagnostics sharing one
    coarse `where` cancelling out under a count-only comparison — proven against the real checks
    (`shared/project.js`'s `missingSfx`/`overlongSfx`, both reporting `where: 'Map Forge'`) rather than
    a synthetic stand-in, and confirmed reachable through this exact import mechanism (an `sfx` kind
    entry's own append can land at precisely the id a dangling reference already names).
16c. **A same-template increase is flagged even when digit-stripping alone would have erased the
    difference — the exact case round 2's own first review found.** A project already has two live
    `Play a sound effect` commands whose targets are each independently over 255 frames
    (`overlongSfx` fires once, at count 2), plus a third live command naming a not-yet-existing SFX id
    (`missingSfx` fires once, count 1). Import an `sfx` entry at that id, itself also over 255 frames;
    assert the plan **refuses**, naming the new `overlongSfx` diagnostic (now count 3) — the
    `missingSfx` diagnostic has genuinely vanished and must not appear in the refusal. *Catches*:
    digit-normalizing away the difference between "2" and "3" in the identical surrounding wording,
    which silently matched the two counts against each other in round 2's own first fix and let this
    exact regression through.
16d. **A genuine decrease in the same aggregate still succeeds — the branch test 16c does not cover.**
    Three live `Play a sound effect` commands name ids 0, 1 and 2, none of which exist yet
    (`missingSfx` fires once, count 3). Import a short, in-bounds `sfx` entry landing at id 0
    (§7.4's append rule; satisfies exactly one of the three dangling references); `missingSfx` becomes
    count 2. Assert the plan **succeeds**. *Catches*: an `isNotWorse` reduced to strict message
    equality (no numeric comparison at all) — it would pass test 16c (a differently-worded message is
    still correctly flagged either way) while wrongly refusing this genuinely improving import, since
    `"2 ..."` never equals `"3 ..."` under equality alone.
17. **An import that itself creates an error refuses** — a damaging `monster` into an action project
    whose metasprite already references blank `$FE` (no active reservation yet); refuses, naming
    §5.7's new error, exactly once (this key had zero occurrences before the import). *Catches*: the
    review's own named interaction, still covered end to end — now via `attributedErrors` rather than
    the unconditional zero-errors rule, but the outcome for this specific case (an import's own new
    content causing a genuinely new problem) is identical either way, which is why this test alone
    cannot distinguish the two mechanisms; test 16 is what does.
18. **`options.paletteSlot` validation** — `4`, `-1`, `1.5`, `"2"` each refuse before palette
    resolution, project untouched. *Catches*: a fifth palette appended, an out-of-range crash, or a
    downstream `clamp()` silently resolving to a different slot than the report names.
18b. **`options.paletteSlots` validation for a two-palette entry** — a length mismatch (one element
    for a two-palette entry) refuses; two elements naming the *same* slot index refuses; project
    untouched either way. *Catches*: silently accepting a duplicate and falling into whatever
    adopt-or-overwrite behaviour §7.3's two outcomes would otherwise produce for it, which this design
    deliberately refuses to define.
18c. **A valid, distinct `options.paletteSlots` array succeeds end to end — not merely "an invalid one
    refuses."** A two-palette `monster`, `options.paletteSlots: [2, 3]` where slot 2 is a genuine exact
    match and slot 3 is genuinely unused; assert the plan succeeds, `entry.palettes[0]`'s tiles resolve
    to `palette: 2` with `project.palettes` unchanged at that slot (adopted), and `entry.palettes[1]`'s
    tiles resolve to `palette: 3` with slot 3's colours freshly written. *Catches*: an implementation
    that only ever exercises the automatic (omitted-option) resolution path and never actually reads
    `options.paletteSlots` when supplied — every other multi-palette test either omits the option
    (26d/26f) or supplies an invalid one (18b); none before this proves a valid explicit array is
    honoured at all.
19. **The omitted-`options.paletteSlot` headless default is real and deterministic** — two calls
    against the same project resolve to the same slot, matching §7.2's own stated priority. *Catches*:
    reviewer Medium #5 — requiring the option with no defined behaviour when it's absent.
20. **A reserved slot is a valid, adoptable choice, never refused** — `paletteSlot: 0` for a
    `monster` whose colours don't match; succeeds, `project.palettes` unchanged, pushed tiles resolve
    to `palette: 0`. *Catches*: disabling a reserved slot outright.
21. **The reserved caption is real, rendered text** — `reservedReason` is non-empty; `main/smoke.js`'s
    own picker step asserts it appears in the rendered candidate list. *Catches*: a caption computed
    but never wired into the picker's render function.
22. **The discriminator mapping is exercised both ways, for both the palette array and the reserved
    set** — `'background'`→`project.palettes.bg` and `reservedPaletteSlots(...).bg`; `'sprites'`→
    `.sprite` and `.sprite`; neither ever indexes `.background`/`.sprites` on either object
    (`undefined`, and `.has(index)` on `undefined` throws). *Catches*: following the tile-table
    discriminator straight into a palette-array lookup with the wrong key — and, separately, reviewer
    High #1 exactly: `reservedPaletteSlots` itself returning `{ background, sprite }` while its own
    caller indexes it with `'bg'`, which is what actually crashed a terrain import's `reserved.
    has(index)` call in the prior round, independent of the palette-array lookup working correctly.
23. **Plan/apply: a refusal creates no undo entry and no dirty mark** — an over-capacity entry
    refuses; `store.undoStack`/`store.dirty` completely unchanged. *Catches*: wrapping a refusing
    core directly in `store.commit`.
24. **`applyPlannedProject` deep-equals the plan** — called directly, no `store` involved, the real
    project matches `plan.project` exactly. *Catches*: a second, independent allocator run at apply
    time diverging from the plan.
25. **`pickup` writes no item** — `project.items` byte-identical before/after; report names
    "Collected from." *Catches*: reintroducing automatic item attachment.
26. **Synthesized `.palette`/`anims.*` are the real resolved values, never hardcoded** — palette
    resolves to slot 2, three animations already exist so the synthesized one is id 3; every
    metasprite tile is `palette: 2`, every `anims` slot is 3. *Catches*: hardcoding both, invisible
    against an empty project.
26b. **A four-pose entry pushes four metasprites and four animations, each `anims` slot pointing at
    its own, correctly corresponding pose's animation — not merely a different one.** Import a
    `monster` declaring `idle`/`walkDown`/`walkUp`/`walkSide`, each pose's own metasprite built from
    visibly distinct tile art (so each pushed metasprite's own tiles can be read back and matched to
    the pose that declared them); assert four new metasprite ids, four new animation ids, and for each
    of the four `ANIM_SLOTS` that `actor.anims[slot]`'s animation's own `frames[0].metaspriteId` points
    at the metasprite built from *that slot's own* declared pose's art — not merely that the four
    resulting ids are pairwise distinct. *Catches*: a synthesis that still hardcodes "all four slots
    share the one animation" even when the entry declares more than one pose, and, more narrowly, one
    that pushes four real, distinct animations but wires them to `anims` in the wrong order (e.g.
    `walkDown`'s slot pointing at `walkUp`'s own pose) — a defect the original pairwise-inequality
    assertion could not have caught, since four distinct-but-swapped ids are still pairwise distinct.
26c. **A partially-declared entry falls back to `idle` per slot, not per entry.** Import a `monster`
    declaring only `idle` and `walkDown`; assert `actor.anims.walkUp === actor.anims.idle` and
    `actor.anims.walkSide === actor.anims.idle`, while `actor.anims.walkDown` is its own, different
    animation id. *Catches*: a fallback that reuses `idle` for every undeclared slot only when *no*
    other pose is declared at all, rather than per slot independently.
26d. **A two-palette entry resolves each palette in order, and `paletteMap` routes each pose's tiles
    correctly.** Import a `monster` with `palettes: [a, b]`, one pose whose tiles mix
    `paletteIndex: 0` and `paletteIndex: 1`; assert the two resolve to different destination slots (one
    an exact match, the other freshly written, chosen so the test cannot pass by both landing on the
    same slot by coincidence), and that tiles with `paletteIndex: 0` carry the first destination slot
    while `paletteIndex: 1` tiles carry the second. *Catches*: a `paletteMap` that resolves only the
    first entry-local palette and silently reuses it for every index, invisible against a one-palette
    entry.
26f. **Two entry-local palettes that would BOTH resolve to the same "first unused slot" if resolved
    independently instead land on two different slots.** Import a `monster` with `palettes: [c, d]`,
    neither matching any existing colours exactly, into a project with at least two genuinely unused
    slots on the target table; assert `entry.palettes[0]` and `entry.palettes[1]` resolve to two
    *different* slot indices — never the identical one — and that both slots' colours were actually
    written (neither adopts, since neither was an exact match). *Catches*: a `paletteMap` builder that
    calls the P=1 resolution path P times without ever threading `excluded` through it, which test 26d
    alone cannot catch (its own two palettes are deliberately one exact-match and one fresh, so they
    could never collide even with no exclusion logic at all).
26e. **An out-of-range `paletteIndex` refuses the whole import, never a silent passthrough.** A
    corrupted/future-schema entry with `paletteIndex: 1` but only one declared palette; the import
    refuses entirely — `project` byte-identical before and after — rather than clamping or defaulting
    the index. *Catches*: treating `paletteIndex` as a clamped field the way `normalizeMetasprite`'s
    own destination `.palette` already is, instead of a reference that must resolve or refuse, the
    identical rule an out-of-range `tile` index already holds to (§6).
27. **A monster is counted in the OAM budget through the exported `battleSpriteBudget`** — placed
    once, no save/reload, via the touch-encounter formation path (no encounter table needed).
    *Catches*: testing through the private `formationSpriteCost` instead of the real public API.
28. **License manifest, plus the `BLANK_TILE` sprite-pool rule and the palette-count bound** —
    `LICENSE-ASSETS` tracked by git; every entry's `license.type` allowed; no `monster`/`pickup`
    `spriteTiles` contains `BLANK_TILE`; every `monster`/`pickup` entry's own `palettes.length` (or the
    sugared `palette`'s implicit 1) is between 1 and `LIMITS.palettes` (4) inclusive. *Catches*: a
    missing license field, an explicit transparent tile instead of an omitted one, or a hand-authored
    (or future-schema) entry declaring more entry-local palettes than any table has physical slots for.
29. **The whole inventory imports into fresh action and RPG projects, fixed order** — every entry
    succeeds; the RPG case's two background palettes end at `Nature`/`Built`, zero spare.
30. **The identical sequence against `sample/` and `sample-rpg/`** — asserts §8.3's exact colour-
    outcome table (which entries get fresh colours vs. adopt existing ones), never a refusal.
31. **A successful `sfx` import can leave the project one build away from a music/text-bank
    overflow, documented rather than prevented.** In `test/unit/library.test.js`, importing
    `checkCapacity` directly (the way other unit tests already do): construct a project whose
    compiled music+SFX+text bytes sit exactly one byte under the `$E000` bank ceiling
    (`main/build/generate.js`'s own `musicBytes + sfxBytes + text.bytes > BANK_SIZE - 64` check);
    `planLibraryImport` a one-step `sfx` entry; assert the plan succeeds (§7.5's own mechanism has
    nothing to say about this — the entry introduces no `validateProject` error), then call
    `checkCapacity` on the resulting project
    and assert it reports the bank overflow **by name**. *Catches*: a false belief that §7.5's rule
    already covers generator capacity — it does not, and this test documents the boundary rather than
    silently leaving it unverified.
32. **The identical shape for kernel-lo, via an actor import.** A project with its per-actor lookup
    tables one actor away from `checkCapacity`'s own kernel-lo ceiling; `planLibraryImport` a
    `monster` entry; assert the plan succeeds and `checkCapacity` on the result reports the kernel-lo
    overflow by name. *Catches*: the identical gap as test 31, for the id-space/table-byte axis
    rather than the music/text-bank one — named separately since §7.8 is explicit that both are real,
    independent generator ceilings this design's own capacity checks (§7.6) do not model.

**"Still passes" audit, whole list**: every test's own stated blind spot is closed by a named
neighbour, except one genuine, accepted limit carried forward unchanged from every prior round and
still true — no test in this list catches a Forge caching a stale sub-object reference generically;
that claim is addressed by the direct code audit in §7.1, not by a test, since it is a claim about
every Forge's own code rather than about `applyPlannedProject` itself. Tests 31-32 are themselves an
accepted limit made visible rather than closed: they *document* §7.8's named gap: they cannot catch
an implementation that fails to add a future `build:capacity` preflight, since this design does not
build one.

## §12. License recording

Top-level `LICENSE` — plain MIT text, matching `package.json`'s existing `"license": "MIT"` field,
which the repository does not have as an actual file today. Top-level `LICENSE-ASSETS` — a CC0-1.0
public-domain dedication covering everything under `shared/library/`, since option (A) makes the
project itself the sole author of new work with no third-party content to individually attribute.
`test/unit/library.test.js`: asserts `LICENSE-ASSETS` exists on disk **and is tracked by git**
(reusing `test/unit/docs.test.js`'s own `execFileSync('git', ['ls-files'])`-tracked-file pattern —
the identical failure mode that test already exists to catch, an untracked file silently vanishing
on a fresh clone, applies here just as much); every `LIBRARY_ENTRIES` entry's `license.type` is a
member of a fixed allowed set (`['CC0-1.0']` for v1, extendable later), the same closed-vocabulary
shape `ITEM_EFFECT_KINDS`/`normalizeEffectKind` already enforces for `item.effect.kind`; no
`monster`/`pickup` entry's `spriteTiles` array contains the literal `BLANK_TILE` string (§2.4); and
every `monster`/`pickup` entry's `palettes.length` (or the sugared `palette`'s implicit 1) is between
1 and `LIMITS.palettes` (4) inclusive (§2.4).

## §13. Phasing — one consistent dependency order

1. **The authoring-helper migration (§3), on its own, gated by `samplegen.test.js`'s existing six-
   generator diff.** A pure refactor with zero new behaviour, worth landing and proving inert before
   anything else depends on `shared/library/authoring.js` existing at all.
2. **`hasBattleBlockArt`/`battleBlockIndices` and every one of their six readers, together, on their
   own.** Independent of every other phase — it touches no library-import code at all, only the
   shared predicate itself (§5.3/§5.6) and the four existing-code sites it fixes:
   `formationSpriteCost`, `validateProject`'s battle-art font-collision check, and the Monster
   Forge's two consumers (§5.3/§5.6's own text). Landed here, on its own, because phase 4's `terrain`
   core already depends on the predicate existing for its own background-palette accounting — this
   is a prerequisite, not merely an early convenience — and because a validation/UI-only,
   byte-neutral fix to existing code has no reason to wait on any of this design's own new content
   landing first. Tests 3b, 3c, 3d, and the new `main/smoke.js` step (§11); test 3 (`unusedPaletteSlots`'s own
   background-palette accounting through `bgRefCount`, which reads `hasBattleBlockArt`) waits for phase
   4, where `unusedPaletteSlots` itself is built — `grep`-confirmed `unusedPaletteSlots` does not exist
   in `shared/project.js` today, so test 3 cannot be written yet regardless of phase.
3. **§5.7's new `validateProject` error, on its own, gated by the six-fixture probe (§5.7/§11 test
   13) turning into a real, permanent test.** This must land *before* any kind's `planLibraryImport`
   is written to depend on §7.5's attribution rule, since that rule is what makes the check
   meaningful to an import in the first place — landing it later would mean phase 4's own terrain
   core temporarily shipped against a different, weaker validity contract than the one this document
   describes, a phasing contradiction an earlier review round found and this ordering removes.
4. **Schema, the `terrain` core, and its own tests** (§5.1-§5.6, §6, §7 for the `terrain` kind, the
   matching slice of §11).
5. **`monster`/`pickup` cores** — the synthesis contract (§2.4/§6), including multi-pose and
   multi-palette resolution from the start (this round folded that capability into the schema itself
   rather than deferring it), and the remaining §11 tests for those kinds, tests 26b-26e included.
6. **`sfx`/`song` cores** — the simplest phase, no tile or palette interaction at all.
7. **The UI** (§10, including the picker) **and the `main/smoke.js` steps that drive it** — last,
   since every phase before this one is independently reviewable and testable with no UI at all.
8. **§12's manifest test and the license files** — can land as early as phase 1, since nothing about
   them depends on any later phase; listed last here only because §12 appears after this section in
   the document, not because of a real dependency.

## §14. Out of scope, explicitly

**Starter projects** (ROADMAP's fifth sub-bullet) are a separate slice — CLAUDE.md's own "six
fixtures, deliberately" passage forbids adding a seventh test fixture for any purpose other than
covering a board, and a starter *project* is not a test fixture at all; it needs its own design,
most plausibly a `templates/` directory the "New Project" dialog offers.

Not built here: a library editor, or a flow that exports a project's own content back into the
library; third-party pack import (§1 already argues against sourcing content this way at all); a
real `Effect` command or any engine change whatsoever (§2.6); destructive palette overwrite-and-
repaint at import time — the mechanism already exists (`duplicateActorPaletteSwapCore`'s own tile-
repaint-by-exact-palette-index loop) if this is ever wanted, but v1 ships only the non-destructive
adopt-or-write-fresh choice §7.3 describes; `renderer/forges/tile/import.js`'s own pre-existing
referenced-blank-tile allocation gap (§5.8) — recorded, not fixed, here; a validator warning for a
battle block that wraps past tile 255 (§5.6) — plausible future work, not this design's job.

**The Monster Forge's battle-tile picker shades and clamps unconditionally against the wrong
tileset budget on a split-font board — a real, pre-existing defect, out of scope, not touched by
this design.** `artPicker`'s own `fontRow` (`renderer/forges/monster/monster.js:188`,
`const fontRow = FONT_BASE / SHEET_COLS;`) is computed unconditionally "because an RPG always shows
text" (the function's own doc comment, `:175-179`) and feeds two things: the reserved-row shading
(`:193`) and the click-clamp that keeps a placed block's rows within `[0, fontRow - height]`
(`:208`). Neither honours `fontBankSplit(project, mapper)` (`shared/font.js:361`) — on MMC3 with
text shown, the font lives in its own bank via the scanline split (CLAUDE.md's own "MMC3's scanline
IRQ gives the font its own CHR bank" passage), so background tiles `$A0-$FF` on the *battle*
tileset are genuinely available block-art space, exactly as `validateProject`'s own font-collision
check (`:5770-5785`) already knows (it is gated on `!splitFont` for precisely this reason) — but the
picker shades them anyway and refuses to let an author click there, even though the engine and the
validator would both accept the placement. **Verified that this is not on the path v9/v10 rewire**:
`fontRow` (`:188`) feeds only `:193` (shading) and `:208` (click-clamp) — neither line is read by
`:196`/`:200-201` (the overlay gate and draw, now routed through `battleBlockIndices`) or `:214`/
`:223` (the label, now routed through `describeBattleTileState`), the four sites this design's own
predicate work touches. The fix this defect would need, for whoever picks it up as its own slice:
`fontRow` becomes `fontBankSplit(store.project, resolveMapper(store.project.cartridge.mapper)) ?
LIMITS.tilesPerTable / SHEET_COLS : FONT_BASE / SHEET_COLS` (16 rows instead of 10 when the split
applies), used identically at both `:193` and `:208`; the test it would need is an MMC3 RPG project
with text shown, asserting a pointer selection at a row ≥ 10 is accepted rather than clamped away,
and that the shading no longer covers those rows — the reviewer's own point that a mere display test
(reading pre-existing `battleTile` state) would not catch this, since the defect is in what the
picker *permits selecting*, not in how it renders an already-stored value.

**A `build:capacity` preflight** (§7.8): `checkCapacity` (`main/build/generate.js`) is reachable only
from the main process today, with no IPC exposing it and no path for `shared/` to import it directly.
A future `build:capacity` IPC channel, taking a project snapshot and returning `checkCapacity`'s own
verdict, would let `planLibraryImport` (or the renderer wrapping it) preflight the generator's real
kernel-lo, music/text-bank, screen-data and banked-battle-region ceilings before ever committing to an
import — closing §7.8's own named limitation. Not built here: it is a real IPC surface and a real
main-process round-trip this design's own content-only scope does not require, and §7.8's honestly-
stated fallback (the next build reports the same overflow it always would have) is judged sufficient
for v1.

## Changelog

### v13 (the content slice — real shipped inventory, plus a reviewer round on it)

- The real v1 inventory now ships: `shared/library/monster/{slime,bat,skeleton}.js`,
  `shared/library/pickup/{key,coin,potion,scroll}.js`, `shared/library/sfx/*.js` (8 entries),
  `shared/library/song/{title-jingle,ambient-loop}.js`, and the aggregate
  `shared/library/index.js` (`LIBRARY_ENTRIES`, fixed terrain/monster/pickup/sfx/song order) —
  §8.1's inventory was previously described but not authored.
- §12's license files and manifest test landed with this slice rather than waiting for phase 8,
  per §13's own "can land as early as phase 1" note: top-level `LICENSE` (MIT) and
  `LICENSE-ASSETS` (this project's own preamble plus the complete CC0 1.0 Universal legal code,
  not merely a summary — a reviewer finding this round) are both tracked by git.
- §11 tests 28 (split into 28a-28i once reviewer rounds found 28a-28g checked only manifest-level
  shape — license, kind, tile pool, palette count — and never a monster/pickup literal's own
  schema or gameplay values, nor §8.1's own shared-palette groups; 28h pins the v1 sugared §2.4
  literal shape and per-field gameplay values, 28i pins §8.1's shared-palette groups, and 28b pins
  each per-kind array's own `kind`), 29 (fresh action/RPG import of the whole inventory) and 30 (the
  identical sequence against the real `sample/`/`sample-rpg/` fixtures) are now written and passing.
- §8.3's own prose about what the two real fixtures do was wrong and is corrected above: it
  described the *first* entry of each shared-palette group getting a fresh write wherever a free
  slot exists, but on both fixtures Grass Plains exactly matches the existing background palette 0
  (byte-identical to `Nature`'s own colours) and adopts it instead — §7.2's exact-match check runs
  before the free-slot check, on every slot including reserved ones. Found by empirically running
  the real import sequence against the real fixtures rather than trusting the prose, and pinned by
  test 30 so it cannot silently drift back out of sync with the code again.
- The shipped Slime redraw (a reviewer round found it byte-identical to `tools/make-rpg-sample.js`'s
  own `SLIME` art, so all 4 of its tiles already sat in both fixtures' sprite tables) is now a
  visibly different silhouette with zero tile overlap against either fixture's sprite table.

### v12 (this round — three questions Chris left open in v11, settled at his own explicit direction; not a reviewer-finding round)

- Palette default when no unused slot exists is now `nearestPaletteSlot`, real CIE L*a*b* distance
  reusing `shared/nespalette.js`'s existing machinery, not an arbitrary "always slot 0" (§7.2/§10).
- Multi-pose (up to all four `ANIM_SLOTS`) and multi-palette (`entry.palettes`, a new `paletteMap`
  alongside `tileMap`) are built into the `monster`/`pickup` schema now; every v1 entry keeps using
  the singular `metasprite`/`palette` sugar unchanged (§2.4/§6/§7.4).
- §7.5's zero-errors rule is replaced by `attributedErrors`, now a per-`(severity, where)` match
  requiring the same message skeleton and no larger an embedded number — the fourth attempt at the
  diff mechanism v6 withdrew, after two more found unsound within this same round. Attempt two
  (occurrence-counting by `(severity, where)` alone): `shared/project.js`'s `missingSfx`/`overlongSfx`
  checks both report `where: 'Map Forge'`, so an import that satisfies a dangling SFX reference while
  its own content is separately over 255 frames long let one diagnostic vanish and a different one
  appear at an unchanged count — invisible to counting alone. Attempt three (exact-then-digit-
  normalized text matching, meant to fix attempt two): stripping every digit away also erases whether
  a count *increased* — `overlongSfx` going from 2 to 3 (the exact scenario above, with the newly
  imported effect itself also over 255 frames) digit-normalizes to the same string either way, so the
  genuinely worse count silently matched the old one. Attempt four compares the actual numbers instead
  of erasing them: `isNotWorse(before, after)` requires the same skeleton *and* every embedded number
  no larger than before's — 2→3 now fails (`3 <= 2` is false, correctly flagged), while a genuine
  decrease (3→2) still passes (`2 <= 3` is true, correctly not flagged). Test 16b covers the
  attempt-two failure (the substitution); test 16c (new) covers the attempt-three failure (the
  same-template increase). Test 16 is reversed to match: an unrelated pre-existing error no longer
  blocks an unrelated import.

### v11 (one Medium, blocking, down from one Medium plus one Low)

- The v10 test plan proved `describeBattleTileState` correct in isolation and proved the overlay
  consumes `battleBlockIndices`, but neither test touched `monster.js:214`/`:223` themselves; fixed
  by extending the `main/smoke.js` Monster Forge step to assert the *mounted* DOM directly for an
  explicit-`255` actor.

### Earlier rounds (full per-finding history retained in the orchestrator's own records, not here)

- **v10** — one Medium, one Low: the Monster Forge's own `fontBankSplit`-blind picker
  (`fontRow`, `:188`) named out of scope, verified off the path this design rewires; the v9 test
  plan's jsdom dependency replaced by a new DOM-free `describeBattleTileState` export and a
  real-canvas-pixel-sampling `main/smoke.js` step.

- **v9** — one Medium, blocking: `hasBattleBlockArt`/`battleBlockIndices` exported and routed
  through the Monster Forge's own actor editor, the fifth and sixth readers, after the v8 audit's
  two-tree grep missed `renderer/` entirely.
- **v8** — one High, two Medium: `hasBattleBlockArt` given a fourth reader
  (`validateProject`'s own battle-art font-collision check); the refusal report's provenance
  framing removed since the zero-errors mechanism cannot support it; §7.8's capacity guarantees
  qualified for Code Forge overrides.
- **v7** — two High, one Medium: `reservedPaletteSlots`'s return keys fixed to match
  `project.palettes`' real `'bg'`/`'sprite'` vocabulary; generator capacity (`checkCapacity`) named
  as an out-of-reach limitation (§7.8 introduced); `hasBattleBlockArt` introduced as one shared
  predicate for the `$FF`/explicit-`255` sentinel.
- **v6** — two High, three Medium, one Low: the before/after `validateProject` diff and its
  `code`/`subject`/multiset machinery withdrawn in favour of a zero-errors rule; the battle-block
  reference walk fixed to mirror the engine's own 8-bit byte wrap; §7.2/§7.4/§7.7 restored from
  "Unchanged" pointers to full content.
- **v5** — two High, two Medium, one Low: `permittedIndices`/`freePermittedIndices` split so dedup
  and allocation stop sharing one incompatible definition; the universal-backdrop invariant
  canonicalized before any palette compare or write; reserved palette slots made adopt-only instead
  of disabled; the palette/tile-table discriminator vocabularies separated explicitly.
- **v4** — five High, four Medium: the plan/apply split (`planLibraryImport`/`applyPlannedProject`)
  introduced so a refusal creates no undo entry; the battle-block reference walk and bound-tile
  claiming added; a `validateProject` error for a blank tile in an active reserved range proposed.
- **v3** — five High, four Medium: effects deferred out of the kinds entirely; `pickup` redefined to
  write no item; reserved-palette-slot reservation, dedup restriction and reference rewriting
  designed for the first time.
- **v2** — eight findings (four High, four Medium) on the first NO-GO: the (A)-over-(B)
  recommendation kept; the six-kind inventory and its arithmetic first probed against real fixtures.

## Decisions

1. **(A), not (B)** — §1, on the roadmap bullet's own "sound effects" category, which (B) cannot
   cover at all without a wholly separate audio-transcription subsystem.
2. **`effect` is deferred, not built** — §2.6; the event vocabulary has no hook for it yet.
3. **`pickup` writes no item; the toast points at the Items Forge's own control instead** — §2.3, on
   `resolveItemIcon`'s explicit-priority behaviour and `actorId`'s real meaning as gameplay
   ownership, not icon selection.
4. **Every pushed record goes through its normalizer; the import core lives inside
   `shared/project.js`** because the normalizers it needs are unexported — §2.1.
5. **`reservedPaletteSlots` is engine-fact-based, never reference-counted** — §5.1, demonstrated
   against `sample/`'s own real data (its metasprites reference sprite palette 0 zero times, yet it
   is reserved regardless).
6. **Metatile "import" claims an existing slot in place; it never appends** — §5.4, a structural fact
   (`project.metatiles` is fixed-size) this design's own reference-rewriting contract depends on.
7. **Dedup is restricted to `permittedIndices`; allocation to `freePermittedIndices`, which also
   excludes anything already referenced, blank or not** — §5.5.
8. **The battle-block reference walk mirrors `draw_mon_block`'s own 8-bit byte-wrap arithmetic
   exactly, including the `$FF`/explicit-255 sentinel, with no new validator error for a block that
   wraps** — §5.6.
9. **A `validateProject` error for a metasprite referencing a blank tile inside an active reserved
   sprite range is added to `validateProject` itself, gated on all six fixtures raising nothing
   new** — §5.7, probed and confirmed clean.
10. **The diff/`code`/`subject`/multiset mechanism is withdrawn; the planned project must pass
    `validateProject` with zero errors, warnings never refusing** — this round's (v6's) central
    decision; see the Changelog above for why — §7.5. **Superseded by Decision 24 (v12)**: the
    zero-errors rule itself is what that round replaces, with a mechanism that avoids v6's original
    three failures plus a fourth found in v12's own first review round — §7.5's "all four known
    failures" passage.
11. **A project with any pre-existing build error cannot import anything until fixed, even content
    unrelated to it — a deliberate trade-off**, since such a project cannot build a ROM either way —
    §7.5. **Superseded by Decision 24 (v12)**: an unrelated pre-existing error no longer blocks an
    unrelated import (test 16).
12. **Reserved palette slots are always selectable, never disabled; the reserved caption is
    computed through `reservedPaletteSlots` and asserted by a smoke step, not left as a
    placeholder** — §7.3/§10.
13. **The discriminator is `'bg'`/`'sprite'` for anything touching `project.palettes`
    — `reservedPaletteSlots`'s own return keys included, no exception — and `'background'`/
    `'sprites'` for anything touching a tileset's own tile tables, with one explicit mapping at the
    single bridge point** (`paletteCandidates`) — §7.3, §5.1.
14. **Phasing puts §5.7's new validator check before any kind's core is built against it**, so no
    phase ships against a weaker validity contract than the one this document describes — §13.
15. **Generator capacity (`checkCapacity`) is out of this design's reach and is a named, surfaced
    limitation, not a silent gap, qualified to stock, non-placement-overridden battle code** — no
    IPC exposes it and `shared/` cannot import a `node:fs`-dependent module; a successful import can
    make the next build report an overflow it did not preflight, exactly as hand-authored content
    already can, never a corruption. A Code Forge override of `battle.asm` or `main.asm` weakens this
    to raw assembler output or no capacity refusal at all — inherited, not changed, by the import —
    §7.8.
16. **One shared `hasBattleBlockArt(actor)`/`battleBlockIndices(actor)` pair answers "does this actor
    draw block art, and where" everywhere the question is asked** — six readers, all agreeing: §5.3's
    palette count, §5.6's reference walk, two existing functions this design fixes as part of
    shipping (`formationSpriteCost`, `validateProject`'s own battle-art font-collision check), and
    the Monster Forge's own actor editor (its three selected-state checks and its block-outline
    overlay draw) — never a seventh, independently-maintained check on `battleTile !== null`
    anywhere, across `shared/`, `main/build/`, or `renderer/` — §5.3/§5.6.
17. **`normalizeActor` does not canonicalize an explicit `battleTile: 255` to `null`** — doing so
    on load would rewrite stored project data the instant an unrelated project is opened; every
    consumer instead asks `hasBattleBlockArt` — §5.3.
18. **The refusal report never claims to know which errors pre-date an import** — `planErrors`
    compares nothing; it only ever looks at the clone, once — §7.5/§7.7. **Superseded by Decision 24
    (v12)**: `attributedErrors` now compares the original project against the candidate explicitly,
    and the refusal report names exactly the errors the import caused.
19. **The Monster Forge's own block-art overlay and labels are fixed as part of this design too, in
    their own phase, before any kind's core is built** — CLAUDE.md's single-writer rule applies to a
    shared predicate's readers regardless of which layer (validation, generator, or UI) they sit in;
    `docs/design-monster.md` was checked and does not document the narrower behaviour as intentional,
    so no postscript is needed there — §5.3/§13.
20. **The Monster Forge's own battle-tile picker (shading and click-clamp against `fontRow`,
    `monster.js:188`) is a separate, pre-existing, out-of-scope defect — not touched here, not
    conflated with the sentinel fix** — verified that neither line it feeds (`:193`, `:208`) is on
    the path this design's own four fixed sites (`:196`, `:200-201`, `:214`, `:223`) touch — §14.
21. **`describeBattleTileState(actor)` is a third exported pure function, alongside
    `hasBattleBlockArt`/`battleBlockIndices`, specifically so the Monster Forge's label text is
    DOM-free and testable without jsdom** — this repository has no jsdom or equivalent, verified
    directly (absent from `package.json`; `banked.test.js`'s own comment states it plainly), so a
    mounted-and-stubbed-canvas test was never viable; the mounted Forge itself is exercised by
    `main/smoke.js`'s real canvas pixel sampling instead, an existing technique, not new
    infrastructure — §5.3/§11.
22. **Palette headless/UI default, when no unused slot exists, is computed by real perceptual
    distance (`nearestPaletteSlot`, reusing `shared/nespalette.js`'s existing `NES_LAB`/`labDistance`)
    rather than always landing on slot 0** — §7.2, at Chris's own request; no new colour-distance
    metric invented, ties broken by lowest slot index for the same reason the old "else slot 0"
    fallback was deterministic.
23. **Multi-pose (up to all four `ANIM_SLOTS`) and multi-palette (more than one entry-local palette)
    are built into the `monster`/`pickup` schema now, not deferred to a future round** — §2.4/§6, at
    Chris's own request; `metasprite`/`palette` (singular) remain valid as sugar for the one-pose,
    one-palette case, so no entry shipped in v1 needs to change. A per-pose multi-frame walk cycle
    remains explicitly out of scope (§2.4) — "richer" here means per-direction static art and more
    than one palette, not animated walk frames.
24. **§7.5's zero-errors rule is replaced with `attributedErrors`, a per-`(severity, where)` match
    requiring the same message skeleton and no larger an embedded number, that only refuses on errors
    this import's own writes actually caused** — at Chris's own request, three further attempts
    (occurrence-counting alone, then exact-or-digit-normalized text matching) were each found unsound
    in this round's own reviews and replaced within the same round; sound this time because comparing
    the actual embedded numbers — not erasing them — is what tells a genuine increase (flagged) apart
    from a genuine decrease (not flagged), which digit-stripping alone could not do — §7.5. A narrow,
    disclosed, safe-direction limitation remains: a message that pluralizes on its own live count
    changes its skeleton, not just a digit, at the exact moment a *decreasing* count crosses that
    boundary, causing an unnecessary (never a missed) refusal — §7.5's own closing note.

## Open questions for Chris

None remain open as of v12 — all three of v11's open questions were settled by Chris directly (see
Decisions 22-24 and the v12 Changelog entry above).
