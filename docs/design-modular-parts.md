# Design: the player character's walk cycle from modular parts (ROADMAP item 8, v4)

**v4 fixes a final, focused verification pass on v3's own new architecture.** Round 2 (v3) adopted
build-time stamping into a canonical `project.sprites.playerTiles` field to close the tileset-
lifecycle gap in v2's own design. Round 3 confirmed all three of v3's own structural fixes are
correct, but found one new, serious defect that v3's own architecture introduced — `BLANK_TILE` was
overloaded to mean both "never generated" and "generated, deliberately transparent," which silently
prevented an author from ever getting a real, intentional blank quadrant into the finished ROM — plus
three smaller gaps (migration validation depth, a second CHR-import path, and a build-time silent-
repaint risk with no warning). §9 has the full, finding-by-finding account. v1's own target (the
Sprite Forge's NPC actor/metasprite/animation system) remains out of scope, established wrong back in
v2; that history is not repeated in this body, only in §9.

## §0. What I read

Everything v2 already read (ROADMAP item 8, `PLAYER_FRAMES`/`PLAYER_TILES`, `PLACEHOLDER_FRAMES`/
`split16`, the `spriteTableEmpty` check, the `HEART_TILES`/`SPRITE_ARROW_TILE` stamping loops,
`build_oam` in full, the `DIR_*` equates, `redraw_screen`/`switch_chr_bank`, `createTileset`/
`tilesetAt`, `duplicateActorPaletteSwapCore`/`openPaletteSwapModal`) plus, for this round, read
closely rather than assumed: `regionOrigin()`/`regionTiles()`/`writeTile()`/`writeRegion()`
(`renderer/forges/tile/tile.js`, the exact grid arithmetic the region editor uses); `addTileset()`
and `deleteTileset()` (`tile.js:414-448`); the CHR-import flow in full
(`renderer/forges/tile/import.js`, specifically how it decides which tile slots are "free"); both
`fontReserved()` call sites individually rather than assumed identical (`tile.js:141-151` and
`:297-310`); every call site of `authorName` in `shared/project.js` (a plain grep, not an assumption
from memory); and `renderer/store.js`'s `revision` getter and its five bump sites again, directly,
since getting this wrong once already cost a review round. For this round: `BLANK_TILE`
(`shared/chr.js:77`) and `isBlank()` (`:79-81`) alongside `transparentZero()`/its own hint text
(`tile.js:40, 830`), to confirm a blank sprite tile really is a legitimate, transparent, intentional
composed result and not merely "nothing drawn yet"; `normalizeTileTable`
(`shared/project.js:2866-2874`) and `tileFromString`/`encodeTiles` (`shared/chr.js:39-45, 67-75`), to
establish exactly what guarantee a tile string already carries elsewhere in this schema;
`importChr()` in full (`tile.js:603-625`), read separately from the image-import path rather than
assumed to share its mechanism; and `generateAssets`' own `log` parameter and its existing
`warning:`-prefixed lines (`main/build/generate.js:2096, 3018-3029`), to find the real, already-
established mechanism for a build-time informational notice.

## §1. Inventory — what already exists, verified against the code

### §1.1 The compiled player sprite is a wholly separate system from an actor's metasprites

Unchanged from v2, re-confirmed, not re-derived. `build_oam` (`engine/oam.asm:6-86`) computes
`x = (player_dir * 2 + anim_frame) * 4` (`:28-34`) and reads `player_tiles,x` / `+1` / `+2` / `+3` as
four fixed 8x8 tiles at top-left/top-right/bottom-left/bottom-right offsets, every one sharing the
identical, non-per-tile `player_pal` attribute (`:44-82`) — no flip bit anywhere in the routine.
`DIR_DOWN = 0`, `DIR_UP = 1`, `DIR_LEFT = 2`, `DIR_RIGHT = 3` (`engine/constants.asm:1134-1137`) are
four genuinely independent, unmirrored directions — unlike an actor's own `walkSide`, which is one
shared animation for both left and right (CLAUDE.md's single-writer-rule passage). `player_tiles`
itself (`generate.js:3051`) is a literal identity table (`generate.js:2774`,
`Array.from({ length: PLAYER_TILES }, (_, index) => index)`) with no comment justifying the
indirection and no consumer that ever changes it — read as vestigial, and irrelevant either way
to this design, which only ever changes what pixel content sits at the 32 fixed storage indices the
identity table already names. `player_pal` is hardcoded to `$00` (`generate.js:3052`), confirmed by
grep to have no project-level control anywhere — a part (§3) needs no palette field of its own for
the identical reason.

### §1.2 The generator's existing player-art assistance, and why it must change under v3's own architecture

`generateAssets` fills the sprite table with a fallback character only when `tilesets[0].sprites`'s
own first 32 entries are *all* `BLANK_TILE` (`generate.js:2165-2167`), inspecting and writing only
`tilesets[0]` — every other tileset is untouched by this check today. `PLACEHOLDER_FRAMES` (two
16x16 grids, split into quadrants by `split16`, `:1439-1503`) are written into
`tilesets[0].sprites[frame * 4 + quadrant]` (`:2168-2177`), alternating by `frame % 2` — the same two
generic poses regardless of direction, existing only "so a brand-new project builds into something
you can actually see" (`:1437-1438`), never to demonstrate the real feature. **§4.3 replaces this
check entirely, not alongside it** — the reasons why, and the corrected per-slot behavior that
results, are worked out there in full once the new canonical field (`project.sprites.playerTiles`)
exists to check against instead of a tileset's own raw content.

### §1.3 Zero authoring assistance today, confirmed by absence

Unchanged from v2. A grep of `renderer/forges/tile/tile.js` and `shared/project.js` for anything
resembling a reserved-range concept for the sprite table's first 32 slots finds nothing — no
shading, no label, no grouping, no warning. An author edits these 32 tiles today exactly the way
they edit any of the other 224 sprite-table tiles.

### §1.4 The real precedent for "this must look right on every tileset": hearts and the battle cursor

Unchanged from v2, and now doing double duty as the precedent for §4.3's own architecture, not just
for §2's multi-tileset scope decision. `redraw_screen` (`engine/screens.asm:106`) reads the entering
screen's own `screen_tileset,y` and calls `switch_chr_bank` (`:145-146`), switching the entire 8 KB
CHR bank at once; `build_oam` has no idea which tileset is currently banked in. `generateAssets`
already solves the identical problem twice: `HEART_TILES` (`generate.js:2218-2222`) and
`SPRITE_ARROW_TILE`/`SPRITE_ARROW_ART` (`:2229-2231`) are both stamped into **every** tileset,
unconditionally, at build time — `for (const tileset of tilesets) { ... }` — because both can appear
over any screen regardless of which tileset that screen uses. The player is the one piece of
always-potentially-visible content this convention was never extended to, and §4.3 is what extends
it, not merely what decides the scope of a direct write the way v2's own §2 did.

### §1.5 The Tile Forge's region editor cannot be reused for a player frame as-is — a real defect, not a stretch

**v2 claimed the Tile Forge's existing 2x2 region editor already maps a player frame's four tiles.
That claim is false, confirmed directly by reading the arithmetic rather than the header comment
alone.** `regionTiles()` (`tile.js:60-69`) computes, for a region at `(col, row)` of size `size`:
`(row + ry) * SHEET_COLS + col + rx` for `ry, rx` in `[0, size)` — `SHEET_COLS = 16`
(`tile.js:16-17`), the sheet's own fixed 16-tiles-wide grid. A 2x2 region at sheet index 0 (`col = 0,
row = 0`) therefore names tiles `[0, 1, 16, 17]` — row-major over a **16-column grid**. A player
frame's four quadrant tiles are stored **contiguously**: `player_tiles,x` / `+1` / `+2` / `+3`
(`engine/oam.asm:46, 55, 66, 75`), i.e. `[base, base + 1, base + 2, base + 3]` for `base = frame *
4`. `[0, 1, 16, 17]` and `[0, 1, 2, 3]` are different index sets for the same nominal "2x2 region at
tile 0" — **the existing region editor cannot be reused as-is for a player frame.** This needs a new,
small, dedicated mapping specific to the player view, not a reuse of `regionTiles()`/`SHEET_COLS`:

```
quadrantIndex(row, col) = row * 2 + col              // 0=TL, 1=TR, 2=BL, 3=BR
storageIndex(frame, row, col) = frame * 4 + quadrantIndex(row, col)
```

This is genuinely tiny (four lines, no loop, no dependence on `SHEET_COLS`) precisely because a
player frame's own four tiles are already contiguous in storage — the new function's whole job is
presenting those four contiguous entries as a 2x2 visual grid, the mirror image of what `split16`
already does going the other way (`main/build/generate.js:1489-1503`, whose own comment states the
identical TL/TR/BL/BR quadrant order this mapping must agree with). §6.2 uses this mapping directly;
§7 phase 1 must test it by name, precisely because it is new UI logic that happens to look, at a
glance, like it could reuse something that already exists.

**What genuinely does carry over from the region editor is the underlying pixel-painting canvas
itself** — the part of `tile.js` that turns pointer input into a written tile string, independent of
which index arithmetic decided *which* tile is being written. Only the index math is new; the paint
tool is not rebuilt.

### §1.6 `fontReserved()` — corrected: shading and an explanatory hint, not a paint-blocker

**v2 claimed `fontReserved()`'s second call site "disables painting." That is also false, confirmed
by reading it rather than the surrounding prose.** `fontReserved()` itself (`tile.js:44-47`) is used
at two sites: `:141-151` shades the reserved range on the sheet canvas (a translucent overlay plus a
border line), and `:297-310` — not `:303`, the line the predicate is merely *checked* on — renders a
plain `p.hint` **text** explanation ("Tiles \$A0–\$FF are shaded because this game shows text: the
message font is stamped over them when the ROM is built"). **Neither call site disables painting.**
An author can still paint into the font-reserved range in the Tile Forge; nothing in the editor
stops them. What actually refuses a build over it is a *separate* mechanism, `validateProject`'s own
collision check (CLAUDE.md's own font-reservation passage: "validateProject refuses artwork here
from the same predicate") — a build-time refusal, not an editor-time block. This distinction matters
for §4.4/§6.2 below: the mitigation this design recommends for the player's own reserved range is the
identical two-part shape — shading plus an explanatory hint, both purely informational — and,
per §4.4, the question of whether to add a matching `validateProject`-level refusal is answered
fresh rather than assumed, because v3's own architecture (§4.3) changes the premise v2's answer to
that question rested on.

## §2. The multi-tileset question — unchanged conclusion, now the same decision as §4.3's own architecture

**Confirmed again by reading `redraw_screen`/`switch_chr_bank` (§1.4): a project with more than one
tileset genuinely shows whichever tileset's own indices 0-31 happen to be switched in.** v2's own
conclusion — propagate to every tileset, by default, unconditionally, following the `HEART_TILES`/
`SPRITE_ARROW_TILE` precedent rather than a "just tileset 0" or per-tileset-opt-in design — still
holds, for the same three reasons v2 already gave (reproducing the defect, inverting the correct
default, and costing nothing extra). **What changes in v3 is not the scope decision but its
mechanism**: v2 had the generator itself loop over every tileset and write directly into each one at
generation time; §4.3 below moves that loop to build time instead, for a reason v2's own multi-
tileset scope reasoning did not anticipate — a tileset that does not exist yet at generation time.

## §3. Schema: `project.sprites.playerParts` and `project.sprites.playerTiles`

**Two new arrays, not one, with genuinely different shapes and different consumers.**
`playerParts` is the *library* — reusable, author-tagged single tiles, exactly as v2 described.
`playerTiles` is *new in v3*: the one canonical, always-exactly-`PLAYER_TILES`-long array holding the
player's own currently-composed pixel content, which `main/build/generate.js` reads at build time
(§4.3) instead of any tileset's own raw sprite data. Neither is per-tileset; both are pure project
JSON with no compiled-byte representation of their own (§5).

### §3.0 A prerequisite: `PLAYER_FRAMES`/`PLAYER_TILES` must move to `shared/`

**This design needs these two constants in two places that cannot import from each other.**
`normalizePlayerTiles` (§3.2) and the direction/quadrant arithmetic (§3.3) both need `PLAYER_TILES`/
`PLAYER_FRAMES` inside `shared/project.js`, but today both constants are private (`const`, not
`export const`) inside `main/build/generate.js:1434-1435` — and `shared/` modules must stay free of
anything `main/build/`-specific (CLAUDE.md's own Electron-layout section: "`shared/` modules must
stay free of DOM and Node APIs: they are imported by the main process, the renderer, and `node:test`
alike," which in practice also means never importing *downward* from `main/build/`, or the layering
this codebase otherwise holds to would invert). **Phase 1 (§7) must move `PLAYER_FRAMES`/
`PLAYER_TILES` into `shared/project.js`, exported, with `main/build/generate.js` importing them
instead of defining its own copy** — a small, genuinely necessary single-writer fix this design's
own schema forces, not optional cleanup.

### §3.1 `playerParts` — one tagged, reusable tile, not a multi-tile fragment

```js
{ id, name, category, direction, frameSlot, quadrant, tile }
```

Unchanged in shape from v2, with one naming correction (§3.3): `direction`/`quadrant` are validated
against, and share their array with, the same canonical order the generator's own address arithmetic
uses (§4.1) — there is exactly one array per field, doing both jobs, not two that could drift.

- **`category`** — free-form text, the explicit prior decision this design does not revisit.
  Normalized with `authorName` (`shared/project.js:242`) — **corrected citation**: `authorName` is
  used today for a *placed entity's* own display name (`props.name`, "Gate key chest," not an actor's
  own `name` field — `normalizeEntity`, `shared/project.js:3463`) and for a screen's own name
  (`normalizeScreen`, `:3477`). It is not used for an actor or a map name today (an actor's `name` is
  normalized with the plain `typeof raw?.name === 'string' && raw.name ? raw.name : ...` fallback
  shape instead, `:3608`) — v2's "a map/screen/actor name" claim named two consumers that do not
  exist. `authorName`'s own purpose (trimmed, whitespace-collapsed, capped at `AUTHOR_NAME_MAX` = 32,
  `:236-240`, "keeping a dropdown readable rather than about ROM bytes") applies to a part's
  `category` regardless of which two call sites it currently has.
- **`direction`** — one of `DIRECTION_ORDER = ['down', 'up', 'left', 'right']` (§3.3). Falls back to
  `'down'`.
- **`frameSlot`** — one of `PART_FRAME_SLOTS = ['0', '1', 'both']`, unchanged from v2: a part tagged
  `'both'` qualifies for either of its direction's two output frames without being authored twice.
  This field is a **qualification predicate**, not an arithmetic index — see §3.3 for why it does not
  need (and must not get) an ordinal array the way `direction`/`quadrant` do. Falls back to `'both'`,
  the most permissive choice.
- **`quadrant`** — one of `QUADRANT_ORDER = ['TL', 'TR', 'BL', 'BR']` (§3.3). Falls back to `'TL'`.
- **`name`** — the same `typeof raw?.name === 'string' && raw.name ? raw.name : \`Part ${id}\``
  fallback shape every other named record in this file already uses.

**A part is never tileset-scoped, and its own editor (§6.2) needs no `state.tilesetId` at all.**
This is a genuine simplification worth stating plainly: because generation writes to the canonical,
tileset-independent `playerTiles` (§3.2) rather than to any specific tileset's own sprite table, a
part is authored once and applies everywhere the moment it is picked — there is no "which tileset is
this part for" question anywhere in this schema.

`normalizeProject` adds one line beside `.metasprites`/`.animations` (`shared/project.js:4152-4154`):
`playerParts: (raw.sprites?.playerParts ?? []).map(normalizePlayerPart)`.

### §3.2 `playerTiles` — the canonical, always-32-entry array, `null` versus a generated blank, and its one-time migration

```js
project.sprites.playerTiles = [ /* exactly PLAYER_TILES (32) entries, each null or a tile-pixel string */ ]
```

**`BLANK_TILE` cannot mean "never generated" here, because it is also a completely legitimate,
deliberate composed result — this was a serious, confirmed defect in the prior draft, fixed by
giving "never generated" its own, distinct representation.** A sprite tile of `BLANK_TILE`
(`'0'.repeat(64)`, `shared/chr.js:77`) is not merely "no art typed in" — for a *sprite* tile
specifically, palette slot 0 renders fully transparent (`transparentZero()`, `tile.js:40`; the
Tile Forge's own hint text, `tile.js:830`, "Sprites treat slot 0 as transparent"), so a part whose
`tile` is `BLANK_TILE` is an ordinary, intentional choice — "this quadrant of this pose shows
nothing," a real thing a pixel artist can want (a silhouette whose corner is meant to be empty).
Collapsing "never generated" and "generated, and deliberately blank" onto the same string value
means an author can *never* get an intentionally-blank quadrant into the finished ROM: even after a
fully successful 4-quadrant generation where one part's own tile happens to be `BLANK_TILE`, a
build-time check keyed on `=== BLANK_TILE` would read that slot back as "ungenerated" and substitute
the placeholder over the author's real, deliberate choice.

**Fix: `null` means "never generated, use the placeholder"; any valid tile string — `BLANK_TILE`
included, when that is genuinely what was composed — means "has real, generated content."** `null`
is an ordinary, unremarkable value to use here precisely because `playerTiles` is a plain JS array
that is not itself any kind of wire format (unlike, say, `ANIM_SLOTS`' own array order) — nothing
about NES hardware or the compiled ROM constrains how "unset" is spelled in this one project-JSON
field, so there is no reason to reuse a sentinel *string* (the way `NO_ACTOR`/`NO_ITEM`/
`NO_METASPRITE` reuse a real byte value, because those genuinely are wire-format bytes) when a
type-level `null` says the same thing more plainly and cannot collide with any real tile content by
construction.

```js
function normalizePlayerTiles(raw, tilesetZeroSprites) {
  if (Array.isArray(raw)) {
    return Array.from({ length: PLAYER_TILES }, (_, i) => {
      const entry = raw[i];
      if (entry === null) return null;
      // A malformed or missing entry degrades to "unset," never to BLANK_TILE: a
      // corrupt value carries no evidence of deliberate intent, and "unset" is the
      // conservative reading -- it costs nothing worse than the generic placeholder,
      // never a silently wrong pixel. No character-level (0-3) validation beyond
      // length: see this section's own note on why relying on tileFromString's
      // existing tolerance is sufficient, the identical guarantee normalizeTileTable
      // already provides every other tile string in this schema.
      return typeof entry === 'string' && entry.length === TILE_PIXELS ? entry : null;
    });
  }
  // Migration: no playerTiles field yet -- a project saved before this schema existed.
  // See below for why this reproduces spriteTableEmpty's own whole-range granularity
  // rather than deciding null-vs-literal per slot.
  const legacy = tilesetZeroSprites.tiles.slice(0, PLAYER_TILES);
  const neverTouched = legacy.every((tile) => isBlank(tile));
  return neverTouched ? Array(PLAYER_TILES).fill(null) : legacy;
}
```

**No character-level digit validation is added, and this is a checked conclusion, not an assumption
either way.** `normalizeTileTable` (`shared/project.js:2866-2874`), the function that validates
every tileset's own `tiles` array today, checks only `typeof tile === 'string' && tile.length ===
64` — it does not verify every character is a `0`-`3` digit. That gap is already safe by
construction, confirmed by reading the actual consumer: `tileFromString` (`shared/chr.js:67-75`)
degrades any out-of-range character to `0` at read time (`value >= 0 && value <= 3 ? value : 0`),
and `encodeTiles` (`:39-45`) reaches CHR bytes exclusively through it. So a tile string with
non-digit characters was already harmless everywhere else in this codebase before this design
existed, and `normalizePlayerTiles`'s own validation matches `normalizeTileTable`'s exact guarantee
— length and type only — rather than inventing a stricter check for this one array that nothing
else in the schema holds itself to.

**The migration's own null-versus-literal judgment call, decided at the whole-range level, not
per-slot — reusing `spriteTableEmpty`'s own existing granularity rather than a new heuristic.** A
pre-existing `BLANK_TILE` sitting in tileset 0's own indices today is genuinely ambiguous in
isolation — nobody can tell, after the fact, whether an author drew a deliberate blank quadrant or
simply never touched that one tile. But the *whole 32-tile range*, taken together, is not
ambiguous, because this codebase already computes and acts on exactly that whole-range question
today: `spriteTableEmpty` (§1.2) already treats "every one of the 32 is blank" as "untouched," and
"at least one is real" as "an author has been drawing here" — the placeholder fires only in the
first case, never the second, today. The migration reuses that identical distinction:

- **If tileset 0's entire 32-tile range is blank** (matching `spriteTableEmpty`'s own condition
  exactly), every slot migrates to `null` — reproducing today's own behavior precisely: an untouched
  project keeps showing the placeholder, now correctly on every tileset instead of only tileset 0
  (§4.3's own free side effect).
- **If any of the 32 already holds real content**, every slot migrates as its *literal* string,
  blanks included, never coerced to `null` — because today, for exactly this project, a blank tile
  sitting among mostly-real ones is *already* being treated as real, deliberate content: the
  all-or-nothing placeholder check has already stopped touching it, precisely because not every
  slot is blank. Coercing an individual blank slot to `null` here would silently reintroduce the
  placeholder for that one tile the very first time this project is rebuilt under the new schema —
  a real, visible content change for a project whose player already looks correct today, which is
  the exact class of surprise this whole design exists to prevent, not one it should introduce.

This is a project-level decision, not a slot-level one, made once, using a fact this codebase
already computes today rather than a new heuristic invented for this migration alone.

`tilesets` is already computed and in scope before `normalizeProject`'s own `sprites: {...}` object
literal is assembled (`shared/project.js:4122, 4129`, both well before `:4152`), so
`normalizePlayerTiles(raw.sprites?.playerTiles, tilesets[0].sprites)` can read the already-normalized
tileset directly.

**The migration still reads only tileset 0, never any other tileset**, matching this codebase's own
existing asymmetry (§1.2) rather than inventing a new rule — the same narrow, named limitation v3
already stated: a project with genuinely *different* hand-drawn player art on another tileset loses
that divergence the moment migration runs. §4.3's own new divergence warning is what keeps this from
being silent.

**This migration is one-time, at normalization, not re-derived on every build** — the identical
discipline CLAUDE.md's own single-writer-rule section documents for `normalizeItem`'s one-time
`battle.heal`-to-`effect` migration. The moment a project has been saved with a `playerTiles` field
present, it is authoritative from then on.

**A consequence stated plainly rather than left for an implementer to discover: once `playerTiles`
exists at all — every project, from the moment this feature ships — hand-drawing directly into any
tileset's own indices 0-31 in the ordinary Tile Forge Sprites tab no longer has any lasting effect.**
§4.3's own build-time stamp always wins there, on every build, for every tileset — the same posture
the message font's own reserved range already has, except the player's reservation is now
**unconditional** rather than gated behind `projectUsesText`-style project content, because every
game has a player. §4.4/§6.2 cover the authoring-side consequence; §4.4 also answers, freshly rather
than by assuming v2's own now-superseded reasoning, whether this warrants a `validateProject`-level
refusal.

### §3.3 One canonical order per arithmetic field, used for both validation and address math

**`direction`/`quadrant` are stored as strings but §4.1's own address formula treats them
arithmetically — this needs one explicit, named ordinal mapping, stated once and reused everywhere,
not re-derived at each call site.**

```js
export const DIRECTION_ORDER = ['down', 'up', 'left', 'right']; // matches DIR_DOWN..DIR_RIGHT
export const QUADRANT_ORDER = ['TL', 'TR', 'BL', 'BR'];          // matches split16's own order
```

Both arrays serve two jobs at once, deliberately: `normalizePlayerPart`'s own enum validation
(`DIRECTION_ORDER.includes(value)`) and the generator's own address arithmetic
(`DIRECTION_ORDER.indexOf(direction)`), from the identical array — the same "array order is the wire
format" discipline `ANIM_SLOTS`/`BEHAVIORS`/`ACTIONS` already hold themselves to elsewhere in this
file, applied here to an order that matters for the design's own arithmetic rather than a literal
`engine/constants.asm` wire format, but for the identical reason: two independently-maintained lists
that must agree can drift, and one list that does both jobs cannot. `frame = DIRECTION_ORDER.indexOf
(direction) * 2 + frameIndex`; `storageIndex = frame * 4 + QUADRANT_ORDER.indexOf(quadrant)` — §4.1
is the one place this formula is stated in full; every other section that needs it cites this one.

`PART_FRAME_SLOTS = ['0', '1', 'both']` (§3.1) is **not** an ordinal array of this kind — a part's
`frameSlot` is consulted as a qualification predicate (`part.frameSlot === String(frameIndex) ||
part.frameSlot === 'both'`), never indexed into an arithmetic formula, so giving it the same
`.indexOf`-shaped treatment would be a false parallel to the two fields that actually need one.

### §3.4 Capacity — `LIMITS.playerParts`

Unchanged from v2. A pure authoring-list-readability ceiling, the `LIMITS.commonEvents`-shaped
precedent (`shared/project.js:168-173`) — no part is ever compiled into the ROM as a byte-addressed
reference, so there is no `NO_*` sentinel for this cap to equal. **256**, sliced at normalization
time, matching `normalizeCommonEvents`'s own precedent (`:3427`). `playerTiles` needs no equivalent
capacity entry at all — it is always exactly `PLAYER_TILES` (32) entries, never appended to, never
sliced, the fixed-length array §4.5 already establishes needs no capacity check on the output side.

### §3.5 Deletion — the same conclusion as v2, re-derived once more, now for two arrays

**A part is never referenced by anything else.** Generation (§4.1) reads a part's `tile` string and
copies it verbatim into `project.sprites.playerTiles` — a plain string assignment, never a
reference, an id, or a pointer. Nothing downstream can name a part by id, so deleting one is a plain
splice-and-restamp with no cascading function: `project.sprites.playerParts.splice(index, 1);
project.sprites.playerParts.forEach((entry, position) => (entry.id = position));`

**`playerTiles` is never deleted at all — it has no notion of an entry being removed**, only ever
overwritten in place (a specific slot reset to `null` — reverting it to "never generated," so the
placeholder covers it again — is the closest analogue to "deleting" a generated frame, and even that
is not a schema operation this design defines — §4.2's own atomicity rule means a slot only ever
changes as part of a whole, successfully-composed frame). Resetting a slot to `BLANK_TILE` instead
would be a different, real operation — composing it as deliberately transparent — never a stand-in
for deletion, per §3.2's own distinction.

## §4. The generator: "Generate Player Sprite"

### §4.1 What it writes: one commit to `project.sprites.playerTiles`, never a tileset directly

**v3's central architectural change.** The generator writes to exactly one place —
`project.sprites.playerTiles` — never to any tileset's own sprite table. For a chosen
direction/frame combination with all 4 quadrants resolved (§4.2's own atomicity rule), the address
arithmetic from §3.3 gives the storage index for each: `frame = DIRECTION_ORDER.indexOf(direction) *
2 + frameIndex`, `storageIndex = frame * 4 + QUADRANT_ORDER.indexOf(quadrant)`, and
`project.sprites.playerTiles[storageIndex] = part.tile`. This is a plain assignment into an array
that is always exactly `PLAYER_TILES` (32) entries long (§3.2) — no append, no id, no growable
bound, the same "nothing to check on the output side" shape v2 already established, now attached to
the correct destination.

**Every tileset's own sprite table is touched only at build time, by `generateAssets`, never by this
generator.** This is what closes the lifecycle gap review round 2 found: `addTileset()`
(`tile.js:414-428`) creates a brand-new, blank tileset via `createTileset()`
(`shared/project.js:1133-1135`, `sprites: { tiles: blankTileTable() }`) at any point *after* Generate
Player Sprite has already run, and CHR import (`renderer/forges/tile/import.js:230-246`) can write
into whichever of a tileset's own 256 sprite slots it finds blank — both, under v2's own direct-write
architecture, would silently leave a tileset showing the wrong (blank, or import-donated) player art
with no warning and no way for an author to notice without opening the emulator. Under v3's own
architecture there is nothing to notice: `project.sprites.playerTiles` is unaffected by either
operation (neither one touches project-level `sprites.playerTiles` at all), and the very next build
stamps the same canonical 32 tiles into *every* tileset present at that time — including one added
seconds before the build starts — with zero special-case lifecycle code anywhere. **This is the
identical reason `HEART_TILES`/`SPRITE_ARROW_TILE` never have this problem today**: a tileset added
after a project starts using hearts gets the heart tiles the very next time it builds, because the
stamp is a build-time, not an edit-time, operation, run fresh over whatever tilesets exist at that
moment.

**Two separate import code paths touch this range, and they need two different fixes — confirmed by
reading each rather than assuming they share one mechanism.**

- **The image-import path** (`renderer/forges/tile/import.js:230-246`) scans for currently-blank
  slots and places imported tiles only into those (`free.push(i)` for every `i` where `table[i] ===
  BLANK_TILE`). This one needs the fix already named: exclude indices `< PLAYER_TILES` from ever
  counting as free, on every tileset, unconditionally — once this feature exists, those indices are
  always build-time-stamped, so offering them as "free" would let imported art sit there only to be
  silently discarded at the very next build.
- **The raw CHR-import path, `importChr()` (`tile.js:603-625`), works differently and needs a
  different fix.** It has no "free slot" concept at all: it writes a contiguous run of tiles
  starting at `state.selected` (wherever the sheet cursor currently is) for `count = min(tiles.length,
  LIMITS.tilesPerTable - start)`, **unconditionally overwriting whatever is already there** —
  blank or not (`tile.js:613-619`). Excluding "free slots" makes no sense for a path that never
  checks for blank in the first place. The right fix here is a **confirmation before the commit**,
  not an exclusion list: if `[start, start + count)` overlaps `[0, PLAYER_TILES)`, show a
  `confirmModal`-shaped prompt naming how many of the about-to-be-overwritten tiles fall inside the
  player's own reserved range and that they will be replaced again at the very next build regardless
  of what this import writes — then proceed on confirmation, exactly the "warn, do not silently
  refuse" posture this design already applies to the NPC-metasprite collision (§4.4): a raw CHR
  import that happens to target this range is not necessarily wrong (an author importing a
  full custom sheet exported from another tool, already correctly including the player's own art at
  0-31, is a legitimate reason to do this on purpose), so a hard refusal would be the wrong tool
  here too — the author only needs to know the write will not be the last word.

§7 phase 2 includes both fixes; §8 names the risk of shipping either one without its own mitigation.

### §4.2 Partial-frame atomicity: a frame is written whole, or not at all

**Adopted as a real, enforced rule, not merely a modal warning.** A frame — one direction paired with
one of its two frame indices — is written to `project.sprites.playerTiles` only if all 4 of its
quadrants (TL/TR/BL/BR) have a valid, resolved part pick. A frame with 1, 2, or 3 quadrants picked is
refused entirely — none of its 4 slots are written, and whatever those 4 slots already held (blank,
or the result of an earlier successful generation) is left exactly as it was. This is the same
"refuse rather than silently produce a broken half-result" discipline this codebase applies
everywhere else a partial mutation could leave inconsistent state — `duplicateActorPaletteSwapCore`'s
own all-or-nothing capacity refusal (`shared/project.js:2686-2708`) is the closest precedent, applied
here to a completeness question rather than a capacity one. Concretely: `generatePlayerSpriteCore`
computes, for every direction/frameIndex pair the author has attempted, whether a pick exists for
all 4 quadrants; only the pairs that pass are applied to `playerTiles`, and the function reports
which pairs (if any) were skipped and why, so a modal built on top of it (§6.3) can say so plainly
rather than silently generating six of eight intended frames.

**Interaction with §4.3's own per-slot placeholder fallback, stated precisely**: a frame skipped for
incompleteness leaves its 4 `playerTiles` slots exactly as they were before this run — if they were
already blank, they continue to resolve to the placeholder at build time (§4.3); if an earlier,
successful run had already composed real content there, that earlier content survives untouched.
Atomicity is scoped to *this run's own attempted change*, never to the whole 32-slot array — a
successful `down` generation and a simultaneously-incomplete `up` attempt do not roll each other
back.

### §4.3 Build-time stamping, and its precise interaction with the placeholder

**The old `spriteTableEmpty` check (§1.2) is replaced outright, not supplemented.** In
`generateAssets`, in the same section of the function the old placeholder block occupied (before the
`HEART_TILES`/`SPRITE_ARROW_TILE` stamps that already follow it, `generate.js:2218-2231`), one loop
now runs unconditionally, for every project, over every tileset:

```js
const placeholderQuadrants = PLACEHOLDER_FRAMES.map(split16); // unchanged, 2 entries of 4 tiles each
const placeholderFor = (i) => Array.from(placeholderQuadrants[Math.floor(i / 4) % 2][i % 4]).join('');
for (const [tilesetIndex, tileset] of tilesets.entries()) {
  const overwrittenReal = [];
  for (let i = 0; i < PLAYER_TILES; i++) {
    const canonical = project.sprites.playerTiles[i];
    const replacement = canonical !== null ? canonical : placeholderFor(i);
    // A real, non-blank tile already sitting here that is about to become something
    // different is the "silent repaint of existing content" risk (§3.2's own migration
    // limitation, an NPC's own art, or simply a tileset nobody has stamped yet) --
    // named below, once per divergent tileset, per build. A tile that is already blank
    // becoming real content (or the placeholder) is the ordinary, intended case and
    // never worth a warning.
    if (!isBlank(tileset.sprites[i]) && tileset.sprites[i] !== replacement) overwrittenReal.push(i);
    tileset.sprites[i] = replacement;
  }
  if (overwrittenReal.length) {
    log(
      `warning: tileset ${tilesetIndex} ("${project.tilesets[tilesetIndex].name}") has ` +
        `${overwrittenReal.length} tile(s) in the player's reserved range ($00-$1F) that do not ` +
        'match the generated character and will look different in this build.'
    );
  }
}
```

**Corrected from v3's own now-fixed defect: the check is `canonical !== null`, never `!== BLANK_TILE`
— §3.2 is what makes this correct**, since a genuinely-generated, deliberately-transparent quadrant
now survives as the literal `BLANK_TILE` string rather than being misread as "ungenerated."

**This answers the placeholder-interaction question precisely, as the brief asked, and it is a
strictly per-slot decision, never a whole-array one.** A `playerTiles` entry that is still `null`
for some of the 32 slots lets the placeholder fill in *just those slots* — per direction, per frame,
per quadrant — rather than the old all-or-nothing "every one of the 32 must be blank" gate. This is
the direct, structural fix for review's own finding about a partial run leaving the player invisible
in an ungenerated direction (§1.2's old risk, restated precisely in §8): under this design, an
ungenerated direction never resolves to a blank (invisible) tile — it resolves to the placeholder's
own generic pose, exactly the same fallback a brand-new project already gets today, just applied
per-slot instead of per-whole-table.

**The divergence warning above (`log('warning: tileset ... has N tile(s) ...')`) is a real, if
narrow, second layer of protection review's own round-3 pass specifically asked for — the first
build after this feature ships can otherwise silently repaint existing tileset content with nobody
told.** §4.4's own Generate-modal preflight only ever runs when an author explicitly opens that
modal; this loop runs on *every* build, unconditionally, starting with the very first build after
migration (§3.2) — including for a project that never touches Generate Player Sprite at all. If some
tileset other than 0 already has real, non-blank content at indices 0-31 today (an NPC's own
metasprite art placed there, or divergent hand-drawn player art — §3.2's own named migration risk),
that content changes the moment this feature's build step runs, with no author action in between
except updating the app. `generateAssets`' own `log` parameter (`main/build/generate.js:2096`,
`log = () => {}`) and its existing `warning:`-prefixed lines (`:3019`, `:3026-3029`, the
dropped-placed-actor and over-64-sprites cases) are the exact, already-established mechanism this
reuses — a build that still succeeds, but says plainly what changed and why.

**This warning recomputes fresh on every build and is not a one-time "first occurrence" notice —
deliberately, matching every existing `warning:` line in this function rather than inventing a new,
stateful convention for this one case.** Neither `droppedEntities` nor the over-64-sprites check
(`:3018-3029`) tracks "have I warned about this before"; both simply re-evaluate the current project
state on every build and fire exactly when the condition currently holds. `playerTiles`' own build-
time stamp is deliberately transient — it never writes back into `project.tilesets[N].sprites.tiles`
itself (§4.3's own opening line: only the build-time-local `tilesets` copy is touched, matching
`HEART_TILES`'s "never into project data" precedent) — so a genuinely divergent tileset's own raw,
*saved* content does not self-correct merely because one build has already warned about it; it stays
divergent in the project file until an author does something about it. Firing once and then falling
silent forever would let a real, still-unresolved divergence go unnoticed on every build after the
first one a busy author happened to miss. Recomputing fresh every time is both the more honest answer
and the one requiring no new "has this been acknowledged" state anywhere in the schema.

**A free, structural side effect, named honestly rather than claimed as an explicit goal**: this
also fixes the pre-existing tileset-0-only placeholder gap (§1.2) for *every* project, including one
that never touches this feature at all — since the loop above runs over every tileset unconditionally,
a project with multiple tilesets and no `playerTiles` content whatsoever (an old, unmigrated-in-
substance project, or a brand-new one) now shows the placeholder consistently on every tileset, not
only tileset 0. This was not a defect this design set out to fix, but it falls out for free from the
architecture change §4.1 already requires for an unrelated reason (the lifecycle gap), the same way
`HEART_TILES`'s own every-tileset loop was never fixing a bug when it was written — it simply never
had the bug the player's own tileset-0-only special case does.

**Zero-engine-cost consequence, made explicit here rather than only in §5**: this loop touches only
the already-existing, already-flattened, build-time-local `tilesets` array (`generate.js:2144-2146`)
— the exact same object `HEART_TILES`/`SPRITE_ARROW_TILE`'s own loops already mutate a few lines
below it. No new `.inc` file, no new table, no change to `chrPayloads`' own encoding step
(`:2237` onward), which already treats every tileset as a fixed-size block regardless of pixel
content.

### §4.4 The shared-pixel-table collision — now two mitigations, not one, and the refusal question answered fresh

**The risk itself is unchanged from v2**: a metasprite's own `tile` field is a raw index into
whichever tileset happens to be switched in (`shared/project.js:3576`, `clamp(t?.tile, 0,
LIMITS.tilesPerTable - 1, 0)`, no exclusion of any range) — the same shared table the player's own 32
slots occupy. An NPC actor whose metasprite references index 5 of some tileset has its own look
silently repainted the moment a build stamps new player content into that index.

**Whether this now also warrants a `validateProject` refusal — answered fresh, because v3's own
architecture changes the premise v2's "no" rested on.** v2 argued a refusal was unwarranted because
"nothing here is silently destroyed at build time the way font tiles are." Under v3's own build-time
stamping (§4.3), that is no longer quite true in the abstract — raw tileset content at indices 0-31
*is* now unconditionally overwritten every build, the identical shape the font's own reservation
already has. **The conclusion is still no refusal, but for a different, more precise reason**: what
gets overwritten there is never a *loss* the way a font-reserved background tile's fresh artwork
would be. Tileset 0's own content is, by construction (§3.2's migration), already what `playerTiles`
holds; any other tileset's own divergent or blank content at those indices is exactly the
inconsistency this feature exists to *correct*, not an author's fresh work being silently discarded.
A `validateProject` refusal here would be flagging the very state this feature is designed to fix as
though it were a mistake — the opposite of the font's own posture, where painting in the reserved
range is *always* a mistake regardless of what the build would otherwise do. So: shading and an
explanatory hint (§1.6, §6.2), unconditional rather than conditional (§3.2), remain the whole
mitigation for a tileset's own raw content — no new `validateProject` rule.

**The NPC-metasprite-reference collision is a genuinely separate risk from the one above, and it does
get a second, generation-time mitigation, per round-2 review.** A metasprite's own tile reference is
not overwritten *content* the way a tileset's raw sprite slot is — it is a live *pointer* that will
resolve to whatever the build just stamped there, indefinitely, for as long as the reference exists.
**In addition to (not instead of) the passive shading (§6.2), the Generate Player Sprite modal
performs a preflight scan immediately before it lets the author confirm**: compute the exact set of
storage indices the current, atomicity-passing picks are about to change (§4.2 — only the indices
belonging to frames that will actually be written this run, not the full 0-31 range indiscriminately),
then scan every metasprite in `project.sprites.metasprites` (project-wide — a metasprite carries no
tileset of its own, so one scan covers every tileset) for any `tiles[].tile` value landing in that
set. The modal's own closing summary (§6.3) names the count and, where practical, which metasprites
(by name) are affected, *before* the author confirms — still a warning, never a `validateProject`
refusal, per the brief's own explicit instruction and v2's already-settled reasoning for why a hard
refusal is the wrong tool for this specific collision (an NPC deliberately built from copies of the
player's own art is a legitimate, if unusual, choice this design should not block).

### §4.5 Capacity at generation time — unchanged conclusion

`project.sprites.playerTiles` is fixed-length and never appended to (§3.2, §4.1); there is no
over-cap refusal for the generator to perform on the output side. The one capacity question this
feature touches is `LIMITS.playerParts` on the library side (§3.4), already covered by the library's
own Add button refusing past the ceiling, matching `addMetasprite`'s own disabled-button shape
(`sprite.js:324-328`).

## §5. Verifying the zero-engine-cost claim — corrected: no new *compiled* array, not "no new array at all"

**v2's own claim — "no new array or table of any kind" — was too strong, and the brief's own
correction is adopted verbatim.** `project.sprites.playerParts` is a new array; under v3,
`project.sprites.playerTiles` is a second one. Both are real, new entries in project JSON. **The
honest, still-true claim is narrower**: neither is a new *compiled, engine-side* array or table —
nothing in `engine/*.asm` reads either one directly, and no new `.inc` file exists because of either.
Both belong to the same category `tilesets[].sprites` itself already is: ordinary project data that
`main/build/generate.js` reads in order to decide what to write into an *already-existing,
already-compiled* table — here, a tileset's own sprite-table entries, which were always going to be
emitted, at a fixed size, regardless of what pixel content this feature places in them.

- **`kernelTableBytes`' own `fixedBytes` term already, unconditionally, includes `PLAYER_TILES`**
  (`generate.js:1805`) — a flat `+ 32`, dependent only on the *existence* of the `player_tiles`
  lookup table, never on the content of any tile or on whether `project.sprites.playerTiles`/
  `.playerParts` exist at all. `checkCapacity` (`:1849` onward) calls `kernelTableBytes` exactly
  once, unmodified.
- **Each tileset's own CHR payload is already a fixed 8 KB block regardless of pixel content.**
  `chrPayloads` (`:2237` onward) is unchanged by §4.3's own stamping loop, which only ever
  overwrites string values already living inside an array `chrPayloads` was always going to encode.
- **No new id space, no new `NO_*` sentinel** — unchanged from v2's own reasoning (§3.4): nothing
  compiled ever carries a part id or a `playerTiles` index as a byte-addressed reference.
- **A direct grep of `engine/` for anything naming a "part," "playerPart," or "playerTiles"** finds
  nothing, as expected.

**The one test worth keeping is now sharper than v2's own version, because there is a real,
canonical field to diff against rather than only a tileset's own raw content.** Build the same
project twice from the same tree: once with `project.sprites.playerTiles` left entirely blank
(exercising the placeholder path, §4.3) and once with the identical content a real generation run
would produce, and confirm every `.inc` file outside the CHR payload itself, and the CHR payload's
own size, are byte-identical between the two — proving the narrower, sufficient claim that filling
these already-reserved bytes changes no table and no capacity number, the same same-tree comparison
shape `docs/design-monster.md` §5 already uses for an analogous "field exists, nothing compiled reads
it specially" claim.

## §6. UI

### §6.1 Where this lives: the Tile Forge, not the Sprite Forge

Unchanged from v2. Neither `project.sprites.actors`/`.metasprites`/`.animations` (the Sprite Forge's
own domain) nor anything this feature reads or writes belongs there; both new arrays and the
build-time stamp all sit in territory the Tile Forge already owns or that is genuinely new,
tileset-independent project data.

### §6.2 A real view/data-source split — corrected: not a third `state.table` value

**v2 described a third `state.table` value, `'player'`, indexed the same way `'background'`/
`'sprites'` already are. That is unworkable, confirmed by reading `tilesetAt(...)[state.table].tiles`
(`tile.js:50, 72`) directly: this accessor assumes every `state.table` value names a property that
exists on *every tileset object* — `background` and `sprites` both do (`createTileset`,
`shared/project.js:1133-1135`), but `project.sprites.playerParts` is not a tileset property at all;
it is a separate, project-level array with no per-tileset existence to index into. Describing this as
"a third table value" was gesturing at a mechanism that cannot exist as written; §6.2 replaces that
gesture with the two real, separately-sourced views this feature actually needs.**

**View 1 — the 8 labeled frame slots, reading and writing `project.sprites.playerTiles` directly,
never any specific tileset's own sprite data.** Because `playerTiles` is the one canonical,
tileset-independent source of truth (§3.2, §4.1), this view needs no `state.tilesetId` at all — it
is not "a view of tileset N," it is a view of the one project-level array every tileset's own build
output is later derived from (§4.3). Each of the 8 frames is presented as a 16x16 canvas built from
its own 4 contiguous `playerTiles` entries via `storageIndex(frame, row, col)` (§1.5's new mapping),
reusing the Tile Forge's existing pixel-painting canvas for the actual drawing but *not* its
`regionTiles()`/`writeRegion()` machinery, which assumes the mismatched 16-column grid layout §1.5
already ruled out. A direct edit here commits through a small, dedicated mutation — `store.commit
('Edit player tile', (project) => { project.sprites.playerTiles[index] = tileToString(pixels); })`
— not through `writeTile()`, which is hard-wired to `tilesetAt(...)[state.table]`.

**View 2 — the parts library, reading and writing `project.sprites.playerParts`, equally
tileset-independent (§3.1).** Create, name, tag (`category`/`direction`/`frameSlot`/`quadrant`), and
draw a part's one tile using the same single-tile pixel canvas. Add/Delete follow the disabled-past-
`LIMITS.playerParts` and plain-splice-and-restamp shapes already established in §3.4/§3.5.

**The reservation shading is now unconditional, not `fontReserved()`-conditional, and this is a
deliberate, stated departure from copying that mechanism verbatim.** `fontReserved()`
(`tile.js:44-47`) is conditional because the font's own reservation is conditional
(`projectUsesText`) — but per §3.2/§4.3, the player's own reservation of indices 0-31 is
**unconditional**, true for every project the moment this feature ships, because every game has a
player. So the ordinary Sprites tab's own sheet view shades indices 0-31, on every tileset, always
— a flat, always-true predicate, simpler than `fontReserved()`'s own conditional one — paired with
an explanatory hint following §1.6's corrected understanding of what that hint actually does
(text only, never a paint-block): "Tiles \$00–\$1F are reserved for the player character and are
replaced at build time; edit them from the Player view instead." The identical shading extends to
the Sprite Forge's own metasprite tile-picker sheet (`sprite.js:99, 1202`) — the second surface where
an author could place a metasprite tile inside this range, feeding §4.4's own separate,
generation-time preflight check.

### §6.3 The Generate Player Sprite modal

Lives in View 1's own space (§6.2), opened with the `store.revision`-capture-then-revalidate idiom
`openPaletteSwapModal` already demonstrates (`sprite.js:783-826`), confirmed correct against
`renderer/store.js`'s own header comment: `revision` moves on `commit`/`undo`/`redo`/`open`/`close`,
never on a stroke (`renderer/store.js:24-33`).

- One row per direction (`DIRECTION_ORDER`'s real four), each with two columns (frame 1/frame 2),
  each column four selectors — one per quadrant — populated with every part whose `direction`
  matches and whose `frameSlot` is that column's frame index or `'both'`.
- A live 16x16 preview per direction/frame combination.
- **Atomicity feedback (§4.2), shown before Generate is even pressable for a given frame**: a
  direction/frame combination missing any of its 4 quadrant picks is visibly incomplete (e.g. a
  greyed row) rather than silently excluded from the eventual result.
- **The NPC-collision preflight (§4.4)**, computed from the current, atomicity-passing picks and
  shown in the closing summary alongside the ordinary "what will change" note — e.g. "Facing down,
  both frames — nothing else is touched" followed by, only when it applies, "2 metasprites (Slime,
  Chest) reference tile indices inside this range and will look different after this."
- **Cancel** / **Generate**. On Generate: revalidate `store.revision`, then one
  `store.commit('Generate player sprite', (project) => generatePlayerSpriteCore(project, picks))` —
  writing only to `project.sprites.playerTiles` (§4.1), a single, small mutation, one undo entry.

## §7. Phased implementation plan

**Phase 1 — the prerequisite move, schema, normalizer, `LIMITS`, and both Tile Forge views.**
Move `PLAYER_FRAMES`/`PLAYER_TILES` into `shared/project.js`, exported (§3.0);
`project.sprites.playerParts` and `project.sprites.playerTiles` (§3.1-§3.2, including the one-time
migration), `DIRECTION_ORDER`/`QUADRANT_ORDER`/`PART_FRAME_SLOTS` (§3.3), `LIMITS.playerParts = 256`
(§3.4); the Tile Forge's two new views (§6.2) — the 8 labeled frame slots (read/write
`playerTiles` via the new `storageIndex` mapping) and the parts library editor
(create/rename/delete/tag/draw) — plus the unconditional reservation shading on the ordinary Sprites
tab. No generator yet. Must prove: `normalizePlayerPart`/`normalizePlayerTiles` unit tests (tile
validity, category trim, direction/frameSlot/quadrant fallback, slice-at-`LIMITS.playerParts`,
a malformed/wrong-length entry degrading to `null` rather than `BLANK_TILE`); **both migration
branches from §3.2, each its own test**: a project whose tileset 0 is entirely blank migrates to all
`null`, and a project with any real content among those 32 migrates every slot as its literal
string, blanks included — the fixture proving the second case specifically must plant a genuine
`BLANK_TILE` alongside non-blank tiles and assert it survives as the literal string, not `null`;
**a test proving `storageIndex`/the new frame-view mapping renders `[base..base+3]` correctly as a
2x2 canvas despite the sheet's own 16-column layout elsewhere** (the direct regression test for
§1.5's own defect); a delete-part test confirming no other array is touched; a `main/smoke.js` step
exercising both new views and confirming a hand-edited `playerTiles` slot round-trips through
save/reload. **This is a
real, independently testable milestone, not a claim that phase 1 changes what a player of the
finished game sees** — with no generator wired up yet, no project's compiled output differs from
before phase 1 landed; its value is entirely in giving an author a place to build and browse a parts
library and hand-edit the canonical frame data, with nothing yet consuming either automatically.

**Phase 2 — the generator core, the build-time stamp, and both import-path fixes.** A pure
`generatePlayerSpriteCore(project, picks)` in `shared/project.js` implementing §4.1-§4.2 in full
(the address arithmetic, atomicity, `null` versus a generated `BLANK_TILE`); the replacement of
`generateAssets`' own `spriteTableEmpty` block with the per-slot, every-tileset stamping loop and
its own divergence warning from §4.3; the image-import "free slot" fix (excluding indices `<
PLAYER_TILES` from ever counting as free); and `importChr()`'s own confirm-before-overwrite prompt
when its target range overlaps `[0, PLAYER_TILES)` (§4.1). Unit tests: composition correctness (the
right tile lands at the right storage index for a representative spread of direction/frame/quadrant
combinations, including a picked part whose own `tile` is `BLANK_TILE` surviving in `playerTiles` as
the literal string, not `null`); **a malformed/incomplete-picks refusal test proving partial-frame
atomicity** (1-3 quadrants picked leaves all 4 of that frame's slots untouched); the per-slot
placeholder-fallback behavior confirmed across a multi-tileset project with `playerTiles` partially
populated, including confirming a `null` slot resolves to the placeholder while a `BLANK_TILE` slot
resolves to genuine transparency; **a regression test for the lifecycle gap itself**: generate a
full player, then add a new tileset (or simulate a CHR import) and build again, confirming the new
tileset's own indices 0-31 hold the identical composed content with no special-case code involved;
**a test confirming the divergence warning fires** for a fixture tileset whose own raw indices 0-31
hold real, non-blank content that differs from what the stamp is about to write there, and does
**not** fire when a target slot was already blank; **a test confirming the NPC-collision preflight
actually fires** when a metasprite's own tile reference lands inside the set of indices a pending
generation is about to change; a test for `importChr()`'s own overlap prompt firing exactly when its
target range intersects `[0, PLAYER_TILES)`, on any tileset; and the same-tree capacity-neutrality
test from §5. No UI yet — exercised directly, the commit-free-core discipline every other core
function in this file follows. **Also not yet user-visible on its own** — a correct, fully-tested
generator with no modal in front of it changes nothing an author can reach through the UI; its value,
like phase 1's, is a real milestone provable by `node:test`, not a release.

**Phase 3 — the Generate Player Sprite modal, wired to phase 2.** The modal from §6.3 in full,
including the atomicity feedback and the NPC-collision preflight summary, plus `main/smoke.js`
coverage: author a small parts library covering all 4 directions with a mix of frame-specific and
`both`-tagged parts, run Generate Player Sprite, confirm every tileset's own indices 0-31 hold the
expected composed content, confirm a second run with different picks replaces the first run's own
output with nothing orphaned (§4.1's "one place, plain assignment" claim, made concrete), and confirm
the preflight warning renders when a fixture metasprite is deliberately set up to collide. **This is
the phase that actually delivers the ROADMAP bullet's own promise** — the first two are real,
separately provable milestones on the way there, not a staged release in their own right.

## §8. What could go wrong

**A partial parts library leaves some quadrant/direction/frame combinations un-composable.** Not an
error — the atomicity rule (§4.2) refuses that specific frame rather than writing a broken quarter of
it, and the modal shows the gap plainly before the author confirms anything.

**An ungenerated direction no longer risks an invisible player, but it does look generic until it is
generated.** Superseded, not merely restated, from v2's own worse framing: §4.3's per-slot
placeholder fallback means a still-blank `playerTiles` slot always resolves to the placeholder's own
pose at build time, never to a literal blank (transparent) tile — the worst case for an unfinished
library is "this direction looks like the generic placeholder," not "this direction is invisible."
Still worth a plain note in the modal ("3 of 4 directions still use the placeholder look"), since a
generic-looking player in three directions is still a surprise an author would rather see coming.

**The migration's own narrow blind spot (§3.2)**: a project with genuinely different, hand-authored
player art on a tileset other than 0 loses that divergence the moment `playerTiles` is first
migrated from tileset 0 alone — a real, if unlikely, one-time cost of fixing the larger "tilesets
disagree about the player" defect this feature exists to close. §4.3's own divergence warning is
what keeps this specific case from being silent, the same mechanism the broader first-build risk
below relies on.

**A `BLANK_TILE`-versus-`null` mistake in the migration itself would be a second, self-inflicted
version of the very defect this feature exists to prevent, which is why §3.2 makes it a whole-range
decision rather than a per-slot guess.** Getting this wrong in the naive, per-slot direction (coerce
every pre-existing blank tile to `null`) would silently reintroduce the placeholder into a project
whose player already looks correct today, the moment it is first rebuilt under the new schema —
worth restating here because it is exactly the kind of narrow, easy-to-miss judgment call this
document's own review process exists to catch before an implementer has to discover it by shipping
it.

**Both import-path fixes are load-bearing, not optional polish (§4.1).** Shipping the image-import
fix without its own exclusion would let an author import art into what the tool still reports as a
free slot inside 0-31, only to have that import silently discarded at the very next build — a worse,
more confusing surprise than anything this feature otherwise introduces, since the import itself
would report success. Shipping `importChr()` without its own overlap prompt has the identical
consequence through a different door: nothing about that path currently distinguishes "the player's
own reserved range" from any other 32 tiles at all.

**The first build after this feature ships can silently repaint existing tileset content, with no
warning, unless §4.3's own divergence check ships alongside the architecture change itself, not as a
later addition.** The Generate-modal's own NPC-collision preflight (§4.4) only ever runs when an
author explicitly opens that modal; §4.3's build-time stamp runs on *every* build, unconditionally,
starting with the very first one after migration — for a project that may never touch Generate
Player Sprite at all. A tileset other than 0 that already has non-blank content at indices 0-31
today (an NPC's own metasprite art placed there by coincidence, or the migration's own named
divergence risk above) has that content silently replaced the moment this feature's build step runs,
with zero author action in between besides updating the app. The divergence warning (§4.3) is the
mitigation, not an optional nicety: it must ship in the same phase as the stamping loop itself
(§7 phase 2), never as a follow-up, precisely because the risk it covers is present from that phase's
very first build.

**The shared-pixel-table collision, mitigated two ways now, eliminated by neither (§4.4).** Passive,
unconditional shading in both the Tile Forge and the Sprite Forge's own tile-picker sheet, plus a
generation-time preflight naming any metasprite already colliding — but a metasprite authored *after*
a given generation run, referencing an index that run already claimed, gets no forward-looking
warning at the moment it is authored, only the passive shading an author could still miss. A stronger
mitigation (refusing a metasprite tile-pick inside the reserved range outright) is deliberately not
recommended, per §4.4's own reasoning: this range is not silently destroying fresh authored work the
way the font's is, so a hard refusal would be solving a problem this design does not have while
blocking a legitimate, if unusual, authoring choice.

**NES hardware sprite-per-scanline limits are not worsened by this feature.** Unchanged from v2: the
player is always exactly 4 sprites in one 16x16 area, well under the 8-sprite ceiling on its own;
this constraint only bites in combination with other on-screen entities, a pre-existing, general NES
limitation this feature neither introduces nor makes more likely. Out of scope for that reason.

**A stale pick inside the modal's own in-flight state.** Unchanged from v2: `store.revision`
(confirmed correct in §6.3) catches a part deleted while the modal is open, via the same
capture/revalidate idiom `openPaletteSwapModal` already relies on.

## §9. Changelog

**v4 (this document)** — a final, focused verification pass on v3's own new architecture, confirmed
by `reviewer` to have gotten all three of round-2's structural fixes right (the tileset lifecycle,
the `storageIndex` mapping, the view/data-source split), but found one new, serious defect v3's own
design introduced, plus three smaller gaps. **The serious defect, confirmed independently**:
`BLANK_TILE` was overloaded to mean both "this slot was never generated" (§3.2's own migration and
§4.3's own stamping loop both checked `=== BLANK_TILE` to decide whether to substitute the
placeholder) and "generated, and deliberately transparent" (a real, ordinary composed result, since
sprite palette slot 0 is transparent — confirmed directly in `shared/chr.js` and the Tile Forge's own
"Sprites treat slot 0 as transparent" hint) — the two meanings conflict, and under v3's own design an
author could never get a real, intentional blank quadrant into the finished ROM at all. Fixed by
giving `playerTiles` a genuine third state: `null` means "never generated, use the placeholder," any
tile string (including the literal `BLANK_TILE`) means "has real, generated content" — every
occurrence of the old `!== BLANK_TILE` check (§3.2's normalizer, §4.3's stamping loop) is now
`!== null`. Worked out and decided the one real judgment call this fix required: how the migration
should treat a *pre-existing* `BLANK_TILE` already sitting in tileset 0 today, genuinely ambiguous in
isolation (nobody can tell after the fact whether it was deliberate or simply untouched) — resolved
by reusing `spriteTableEmpty`'s own existing whole-range granularity rather than inventing a new,
per-slot heuristic: if the entire 32-tile range is blank, every slot migrates to `null`
(reproducing today's own "untouched project" behavior exactly); if any of the 32 already holds real
content, every slot migrates as its literal string, blanks included, because today's own
all-or-nothing placeholder check has already stopped touching that project's blanks the moment any
one tile became real — coercing an individual blank tile to `null` in that case would be a new,
self-inflicted content change this feature has no business making. Fixed the three smaller gaps
`reviewer` named: (1) confirmed `normalizeTileTable` validates only length and type, never per-
character digit validity, and confirmed this is already safe by construction because `tileFromString`
degrades any invalid character to `0` at read time — so `normalizePlayerTiles` correctly matches that
existing guarantee rather than needing (or inventing) a stricter one; (2) found and specified the fix
for a second CHR-import code path, `importChr()` (`tile.js:603-625`), which works by unconditional,
contiguous overwrite rather than the image-import path's "free slot" scan, and therefore needs a
different fix — a confirm-before-overwrite prompt when its target range overlaps the reserved indices,
not an exclusion list; (3) specified the first-build silent-repaint mitigation `reviewer` asked for: a
`generateAssets` log warning (reusing its existing `warning:`-prefixed convention, confirmed against
two real precedents already in that function) naming any tileset whose own real, non-blank content
at indices 0-31 is about to change, computed and re-evaluated fresh on every single build rather than
fired once and suppressed thereafter — decided by matching the identical, already-established
behavior of every other `warning:` line in `generateAssets`, none of which tracks "has this been
shown before." §7's phase 2 now names this warning, both import-path fixes, and the null-vs-`BLANK_TILE`
distinction as tests required in that phase, not later additions.

**v3** — a focused fix pass on `reviewer`'s round-2 findings against v2, three
confirmed defects and several smaller ones, all re-verified independently rather than taken on the
review's own word. **Adopted the build-time-stamping architecture** the orchestrator proposed for
the tileset-lifecycle gap (the most consequential finding): §4.1-§4.3 replace v2's own direct,
generation-time writes into every existing tileset with a single canonical field
(`project.sprites.playerTiles`) written once by the generator and stamped into every tileset by
`generateAssets` at build time, the same `for (const tileset of tilesets)` shape `HEART_TILES`/
`SPRITE_ARROW_TILE` already use — closing the gap where a tileset added, or CHR-imported over, after
generation would silently show the wrong player art with zero special-case code, and, as a named free
side effect, fixing the pre-existing tileset-0-only placeholder gap for every project. Fixed
`§1.5`/`§6.2`'s false claim that the Tile Forge's existing 2x2 region editor already maps a player
frame's contiguous four tiles (it does not — `regionTiles()`'s 16-column grid arithmetic and
`build_oam`'s own contiguous `[base..base+3]` addressing are different index spaces), replaced with a
new, explicitly-small `storageIndex` mapping. Fixed `§6.2`'s unworkable "third `state.table` value"
description (`project.sprites.playerParts` is not a tileset property `tilesetAt(...)[state.table]`
can ever resolve) with a real two-view split: one reading/writing the new, tileset-independent
`playerTiles` directly, the other reading/writing `playerParts`, neither needing `state.tilesetId` at
all. Adopted partial-frame atomicity as an enforced rule (§4.2), not merely a modal warning. Added a
generation-time NPC-collision preflight (§4.4) alongside the existing passive shading, still a
warning rather than a `validateProject` refusal, per the brief's own instruction to preserve v2's
already-settled reasoning for that specific collision — while separately, freshly re-deciding (rather
than assuming) whether the *different* question of a tileset's own raw hand-drawn content now
warrants a refusal under the new architecture, and concluding no, for a reason specific to that
architecture (§4.4). Corrected two factual errors found by direct re-reading rather than trusted
prose: `fontReserved()`'s second call site renders explanatory text, not a paint-block (§1.6), and
`authorName`'s real call sites are a placed entity's own name and a screen's own name, not an actor's
or a map's (§3.1). Corrected §5's own overclaim ("no new array or table of any kind") to the honest,
narrower version the brief specified: no new *compiled/engine-side* array, while `playerParts` and
`playerTiles` are themselves real, new, ordinary project-JSON arrays. Softened §7's own
"independently shippable" framing for phases 1 and 2, which change nothing a player of the finished
game sees on their own — reframed as real, separately testable milestones rather than staged
releases. Added the phase-1 storage-index-mapping test, and phase-2's partial-atomicity-refusal,
add-tileset-after-generation, and NPC-collision-preflight tests, all named directly by the review
findings they exist to close.

**v2** — the prior full rewrite, retargeting this document from v1's wrong system (the Sprite
Forge's NPC actor/metasprite/animation machinery) to the player character's own, separate system
(`PLAYER_FRAMES`/`PLAYER_TILES`, `build_oam`). Full account preserved in this document's own git
history; not repeated here now that v3 supersedes it.
