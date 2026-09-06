# Design: a small MIT/CC0 starter library (ROADMAP item 8, fourth sub-bullet) — v11

**v11 responds to a NO-GO review of v10 (1495 lines): one Medium, blocking. Surgical, one fix:** the
`main/smoke.js` Monster Forge step now also selects an actor with an explicit `battle.battleTile:
255` and asserts the *rendered* label and button directly — the hint text reads `'No block chosen —
the actor is drawn from its animation.'`, never `` `Block at $FF, ${width}×${height} tiles.` ``, and
no "Use the animation" button is present — closing the one gap the prior round's tests left open: an
implementation could export and correctly unit-test `describeBattleTileState` and route the overlay
through `battleBlockIndices`, yet leave the original, independent ternary sitting unused at
`monster.js:214`/`:223`, and every test before this one would still pass. **No section says
"Unchanged" or defers to an earlier round.**

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
fields fixed to those two values. **No item is ever written by importing a `pickup` entry.** The
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
  palette: [p0, p1, p2, p3],                               // p0 placeholder, §7.3
  spriteTiles: ['<64-char>', ...],                          // entry-local pool, sprite table -- NEVER BLANK_TILE
  metasprite: { tiles: [{ x, y, tile, hflip, vflip }] },    // ONE resting pose; NO `.palette` per tile
  hp, speed, damage,
  battle: { atk, def, acc, eva, speed, mp, xp, gold, weak, strong, dropPct, heal }
}
```

**The entry declares the minimum; the core synthesizes the rest, always, identically, for every
actor-shaped entry:**

1. The one declared metasprite is pushed through `normalizeMetasprite` with every tile's `.palette`
   set to the resolved destination palette index (§7.3's outcome) — never a hardcoded `0`.
2. One animation is synthesized: `{ loop: true, frames: [{ metaspriteId: <the pushed metasprite's
   real destination id>, duration: 30 }] }`, pushed through `normalizeAnimation`.
3. The actor's `anims` object sets **all four** slots — `idle`, `walkDown`, `walkUp`, `walkSide`
   (`ANIM_SLOTS` has exactly these four; there is no `attack` slot on an actor at all) — to that one
   synthesized animation's real destination id, never `null` and never a hardcoded `0` unless that
   genuinely is where the animation landed.

`battle.drop`, `battle.spellId`, and `battle.battleTile`/`battleW`/`battleH`/`battlePalette` are
absent from the entry literal on purpose: an entry cannot assume the destination project has items
or spells to point at, and an absent `battleTile` normalizes to `null`, which already means "draw
the battle animation as a sprite instead of block art" — exactly the right default for content with
no battle-tileset art of its own. Only one resting pose is provided, deliberately — a real
per-direction walk cycle is exactly the enrichment an author is expected to add afterward through
the Sprite Forge, not something a *small* starter library needs to ship.

**A `monster`/`pickup` entry's `spriteTiles` pool may never contain the literal `BLANK_TILE`
string.** A metasprite quadrant meant to be fully transparent is **omitted from `metasprite.
tiles[]` entirely** rather than declared with a blank tile — a metasprite is already a list of
*placed* tiles, so leaving one out is the natural way to say "nothing here." §12's manifest test
enforces this mechanically by walking every `monster`/`pickup` entry's `spriteTiles` array.

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
font for tileset space. Under §7.5's own zero-errors rule, that false error would refuse *every*
library import into any project carrying such an actor, whether or not the import touches anything
related. The fix is the identical substitution: `battleTile === null || battleTile === undefined` →
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
player's, unconditional on whether the range is active or the tile is blank) stays exactly as it is
— it already covers the player's own range and the non-active or non-blank cases this new check does
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

**`monster`/`pickup`**: the identical `tileMap` shape, over the sprite table, built over
`entry.spriteTiles`. No separate palette/metasprite/animation map is needed in v1 — §2.4's synthesis
means each entry produces exactly one metasprite and one animation, so "the metasprite's destination
id" and "the animation's destination id" are simply the two values the core assigns when it pushes
them, used directly rather than resolved through a lookup. A future, richer entry (more than one pose
or more than one entry-local palette) would extend this additively — `metasprite.tiles[k].tile`
already resolves through a real map — but nothing in this design's own inventory needs that
generality yet, and building it unused now would be exactly the kind of speculative scope this
design's own orchestrator has repeatedly asked not to add.

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
else the first entry of `unusedPaletteSlots` (§5.3) for the target table, else slot `0` of that
table. All three are equally valid "the entry adopts whatever is already there" outcomes when no
unused slot exists — slot `0` is chosen purely for determinism, not because it is in any way
preferred, and this is true even when slot `0` happens to be reserved: a reserved slot is always
selectable (§7.3), so the headless default can land there exactly as any other slot without ever
refusing.

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
`palette[0]` is a placeholder with no meaning outside its own file, so it is replaced with the
destination project's real backdrop (`project.palettes.bg[0][0]`) before either an exact-match test
or a write: `canonical = [project.palettes.bg[0][0], entry.palette[1], entry.palette[2],
entry.palette[3]]`. Writing the entry's own literal slot-0 value verbatim into, say, a `$0F`-backdrop
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
calling `reservedPaletteSlots`:

```js
function paletteCandidates(project, entry, tileTable, mapper) {
  const paletteKey = tileTable === 'background' ? 'bg' : 'sprite';
  const canonical = [project.palettes.bg[0][0], ...entry.palette.slice(1)];
  const unused = unusedPaletteSlots(project, paletteKey, mapper);
  const reserved = reservedPaletteSlots(project, mapper)[paletteKey];
  return [0, 1, 2, 3].map((index) => {
    const colours = project.palettes[paletteKey][index];
    const exactMatch = colours.slice(1).every((c, i) => c === canonical[i + 1]);
    return {
      index, colours, exactMatch,
      unused: unused.has(index),
      reserved: reserved.has(index),
      reservedReason: reserved.has(index) ? reservedCaption(paletteKey, index, project) : null
    };
  });
}
```

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

**Name collisions on re-import are not refused — this codebase already treats duplicate names as
ordinary, not exceptional.** Every appended or claimed record's `name` is run through
`nameForDuplicateScreen(entry.name, destinationList)` — a function already generic over any
`{name}`-bearing array, and already reused by `duplicateActorPaletteSwapCore` for its own clones —
which returns the entry's own name unchanged if nothing in the destination list already has it,
else `"<name> copy"`, else `"<name> copy 2"`, `"<name> copy 3"`, and so on. Re-importing the same
entry a second time therefore never collides on name; it simply produces a second, distinctly named
record.

### §7.5 Post-import validity: the planned project must pass `validateProject` with zero errors

**This is the whole of the mechanism.** No diff against the pre-import project, no stable identity
codes, no occurrence counting of any kind: `planLibraryImport` runs `validateProject` on the
candidate clone and refuses if it reports **any** error at all. Warnings never refuse — this
codebase's own existing rule for every advisory check `validateProject` already makes (the
validate-as-you-draw warnings, CLAUDE.md's own "an error rather than a truncation," and every place
this document has already distinguished "error" from "warning" throughout §5).

```js
function planErrors(clone) {
  return validateProject(clone).filter((p) => p.severity === 'error');
}
```

If `planErrors(clone).length > 0`, the plan refuses, and the report lists every one of those error
messages **verbatim** — the identical strings the Build panel already shows for the same project
state, since they come from the same function.

**A structural change, made because a before/after `validateProject` *diff* kept breaking in new
ways across three review rounds rather than converging**: an aggregate error whose count decreases
(an import resolving one of several dangling references) changes its own message text and gets
misclassified as "new," spuriously refusing an improving import; one whose count could instead
increase without the diagnostic's text changing could hide a genuine worsening behind an unchanged
string; and giving every diagnostic a stable `code`/`subject` to fix both changed the shape of every
object `validateProject` returns, breaking existing exact-shape assertions elsewhere in this codebase
(`test/unit/drawvalidation.test.js`'s own `assert.deepEqual(problems[0], { severity, where,
message })` — a plain three-key comparison a fourth/fifth key would fail outright). Rather than patch
a fourth defect into that mechanism, this design withdraws it: `validateProject`'s own signature and
every object it returns are completely untouched (§5.7's new check uses the existing, unmodified
three-argument `add`), and the "zero errors" rule needs nothing from `validateProject` beyond what it
has always provided.

**The consequence, stated honestly: a project with *any* build error — a Map Forge warp to nowhere,
anything, whether or not it touches library content — cannot import anything until that error is
fixed.** Deliberate: such a project cannot build a ROM either way, and the Build panel already lists
the same errors in the same words today. Refusing an import into a project this design cannot reason
about the validity of is the failure direction this codebase already prefers over silently accepting
content into a project already known broken. **The refusal report makes no claim about which errors
are pre-existing and which the import itself introduced — `planErrors` (§7.5) only ever looks at the
clone, once, after the import; it never compares against the original project, so it has no way to
know.** An existing missing-item error and a heart-reference error the import's own damage-bearing
actor just activated are reported identically: by their message text alone. A display-only
before/after comparison, purely for framing what the author sees and never feeding back into whether
the import refuses, could label the two differently later — a real, separate piece of UI polish, out
of scope for this design.

**The single-writer argument holds and is simpler than ever**: whatever `validateProject` knows,
across every tileset, today or in the future, the import inherits automatically, because there is no
second list of "which errors count" to keep in step with it. §5.7's new check is exactly such an
addition — made once, with nothing on the import side needing to know it exists.

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
5. `planErrors(clone)` (§7.5) — refuse if non-empty, naming every error verbatim.
6. Return `{ ok: true, project: clone, report }`.

Every refusal returns `{ ok: false, reason }` with the caller's own project completely untouched —
not merely unchanged in content, but literally never passed to anything capable of mutating it,
since every step above operates on the clone alone.

### §7.7 What the operation reports — the full contract

**On success**: `report` names the entry's kind and name; how many tiles were written fresh versus
matched via dedup, and into which tileset; for `terrain`, which metatile slot was claimed; for
`monster`/`pickup`/`sfx`/`song`, the new id each appended record received; the palette outcome —
whether the entry's own colours were freshly written into a slot, or whether it adopted an existing
slot's colours, naming the slot either way; and, for `pickup` specifically, the fixed line pointing
the author at the Items Forge's "Collected from" control (§2.3), since no item is ever written
automatically. **Every success report also carries one further fixed line, unconditionally: "Capacity
is checked at build."** — §7.8 states why this line exists and what it is warning about. The
renderer turns the whole report into one `toast` call, the identical function `renderer/forges/tile/
import.js` already uses for its own PNG-import success message.

**On refusal**: `reason` is one of three specific, human-readable shapes, never a generic "import
failed" — an id-capacity or tile-capacity refusal names the exact ceiling and how much room the
entry needed against how much was available; a palette-slot validation refusal names the invalid
value and the valid range; and a `validateProject`-error refusal (§7.5) is neutral, factual wording —
`"The resulting project has these errors:"` followed by every offending message verbatim — with no
claim about which of them existed before the import and which it caused, since `planErrors` cannot
determine that (§7.5).

### §7.8 Generator capacity is outside this design's own contract — a named limitation, not a gap left silent

**§7.6's own capacity checks (id-space, tile-space) and §7.5's `validateProject` zero-errors rule are
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
the tightest passing case, still passing). `sample/` and `sample-rpg/`, which have too few free
palette slots for the whole shared-palette scheme, give the *first* entry of each shared-palette
group real, freshly-written colours where a genuinely free slot exists, and every later same-group
entry either exact-matches it (a real write happened, so this is a true match) or — where no free
slot ever existed for that group at all — adopts the deterministic default slot's existing colours
instead of refusing. **Tile-table and metatile-slot capacity never bind in any of the four scenarios
probed**: 25 unique background tiles and 28 unique sprite tiles remain comfortably under every
measured minimum, including the tightened 141-tile battle-tileset figure — which a terrain import
would not ordinarily even target, since the walkable "Overworld"/"Main" tileset is the natural
destination for scenery, not the tileset holding monster block art.

**§7.5's zero-errors rule is what can now refuse an import that palette placement alone never
could** — every one of the four scenarios above is drawn from a project with no pre-existing build
error, so none of them is affected by it; §11's own tests are what exercise the rule directly, since
neither fresh projects nor the two real fixtures happen to already carry one.

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
actual current colours, reserved slots captioned rather than disabled. Only after a slot is chosen
does `planLibraryImport` run.

**Monster / Pickup** (Sprite Forge): the identical two-step flow, over the sprite table and sprite
palettes, previewing the entry's one resting metasprite.

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
    raise under the unfixed `battleTile === null || undefined` skip, which — under §7.5's zero-errors
    rule — would refuse every library import into the project, whether or not the import touches
    anything related to the actor at all.
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
    active heart reservation → new error; (b) same reference, reservation inactive → only the
    pre-existing warning; (c) active reservation + genuinely non-blank art → only the pre-existing
    `:5796`-style error, not the new one. *Catches*: the §5.7 gap, and over-firing.
13. **The six-fixture gate for the new error** — `validateProject` on each of the six checked-in
    fixtures raises no new problem, the §5.7 probe made a permanent test.
14. **A clean import into a clean project succeeds.** *Catches*: a `planErrors` bug that refuses for
    an unrelated reason.
15. **Warnings alone never refuse** — import into a project already carrying a genuine
    `validateProject` warning; still succeeds. *Catches*: a severity filter that refuses on any
    problem, warnings included.
16. **An unrelated pre-existing error refuses, and is named verbatim** — a project with one genuine,
    unrelated build error (a live Give/Take naming a deleted item); a clean `sfx` import still
    refuses, naming that error's own text. *Catches*: checking only errors the import's own writes
    could have caused — exactly the diff shape this design withdrew.
17. **An import that itself creates an error refuses** — a damaging `monster` into an action project
    whose metasprite already references blank `$FE` (no active reservation yet); refuses, naming
    §5.7's new error. *Catches*: the review's own named interaction, covered end to end without the
    withdrawn diff mechanism.
18. **`options.paletteSlot` validation** — `4`, `-1`, `1.5`, `"2"` each refuse before palette
    resolution, project untouched. *Catches*: a fifth palette appended, an out-of-range crash, or a
    downstream `clamp()` silently resolving to a different slot than the report names.
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
27. **A monster is counted in the OAM budget through the exported `battleSpriteBudget`** — placed
    once, no save/reload, via the touch-encounter formation path (no encounter table needed).
    *Catches*: testing through the private `formationSpriteCost` instead of the real public API.
28. **License manifest, plus the `BLANK_TILE` sprite-pool rule** — `LICENSE-ASSETS` tracked by git;
    every entry's `license.type` allowed; no `monster`/`pickup` `spriteTiles` contains `BLANK_TILE`.
    *Catches*: a missing license field, or an explicit transparent tile instead of an omitted one.
29. **The whole inventory imports into fresh action and RPG projects, fixed order** — every entry
    succeeds; the RPG case's two background palettes end at `Nature`/`Built`, zero spare.
30. **The identical sequence against `sample/` and `sample-rpg/`** — asserts §8.3's exact colour-
    outcome table (which entries get fresh colours vs. adopt existing ones), never a refusal.
31. **A successful `sfx` import can leave the project one build away from a music/text-bank
    overflow, documented rather than prevented.** In `test/unit/library.test.js`, importing
    `checkCapacity` directly (the way other unit tests already do): construct a project whose
    compiled music+SFX+text bytes sit exactly one byte under the `$E000` bank ceiling
    (`main/build/generate.js`'s own `musicBytes + sfxBytes + text.bytes > BANK_SIZE - 64` check);
    `planLibraryImport` a one-step `sfx` entry; assert the plan succeeds (§7.5's zero-`validateProject`
    -errors rule has nothing to say about this), then call `checkCapacity` on the resulting project
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
shape `ITEM_EFFECT_KINDS`/`normalizeEffectKind` already enforces for `item.effect.kind`; and no
`monster`/`pickup` entry's `spriteTiles` array contains the literal `BLANK_TILE` string (§2.4).

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
   landing first. Tests 3, 3b, 3c, 3d, and the new `main/smoke.js` step (§11).
3. **§5.7's new `validateProject` error, on its own, gated by the six-fixture probe (§5.7/§11 test
   13) turning into a real, permanent test.** This must land *before* any kind's `planLibraryImport`
   is written to depend on §7.5's zero-errors rule, since that rule is what makes the check
   meaningful to an import in the first place — landing it later would mean phase 4's own terrain
   core temporarily shipped against a different, weaker validity contract than the one this document
   describes, a phasing contradiction an earlier review round found and this ordering removes.
4. **Schema, the `terrain` core, and its own tests** (§5.1-§5.6, §6, §7 for the `terrain` kind, the
   matching slice of §11).
5. **`monster`/`pickup` cores** — the synthesis contract (§2.4/§6), the remaining §11 tests for
   those kinds.
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

### v11 (this round — one Medium, blocking, down from one Medium plus one Low)

- **Medium** (the v10 test plan proved `describeBattleTileState` correct in isolation, and proved
  the overlay consumes `battleBlockIndices`, but neither test touched `monster.js:214`/`:223`
  themselves — an implementation could leave the original, independent `battle.battleTile === null
  || battle.battleTile === undefined` ternary sitting unused at both lines and still pass every
  proposed test, with an explicit-`255` actor still showing `"Block at $FF, 4×4 tiles."` and a live
  "Use the animation" button): fixed by extending the existing `main/smoke.js` Monster Forge step to
  also select an actor with `battle.battleTile: 255` and assert the *mounted* DOM directly — the
  rendered `span.hint` reads exactly `'No block chosen — the actor is drawn from its animation.'`,
  and no `'Use the animation'` button is present. §11's own test entry states this exact wrong
  implementation as what the new assertion closes.

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
    `validateProject` with zero errors, warnings never refusing** — this round's central decision;
    see the Changelog above for why — §7.5.
11. **A project with any pre-existing build error cannot import anything until fixed, even content
    unrelated to it — a deliberate trade-off**, since such a project cannot build a ROM either way —
    §7.5.
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
    compares nothing; it only ever looks at the clone, once — §7.5/§7.7.
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

## Open questions for Chris

1. **Is "adopt an existing slot's colours" a good enough default outcome** when no unused slot
   exists, or should the picker suggest a specific existing slot by some perceptual-closeness
   heuristic rather than always defaulting to "the first non-reserved index"?
2. **Should a future, richer entry (more than one pose, or more than one entry-local palette) be
   designed now**, given §6 already leaves room for it structurally, or only once a real inventory
   item actually needs it?
3. **Is the "any pre-existing error blocks every import, forever, until fixed" trade-off (§7.5,
   Decision 11) the right one for v1**, or should a future round narrow it to "only errors this
   import's own writes could plausibly interact with" — the exact shape the diff mechanism
   attempted and repeatedly failed to get right, which is precisely why this design does not
   attempt a narrower version of it now, but the underlying product question (should an unrelated
   pre-existing bug block importing an unrelated new pickup icon) is a real one worth Chris's own
   judgment, not merely a technical one this document can settle by itself.
