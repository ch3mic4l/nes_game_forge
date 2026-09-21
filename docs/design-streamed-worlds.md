# Design: large streamed worlds (ROADMAP item 15)

## 0. Status and how to read this document

This is design-round output for a feature with no shipped code: nothing below has reached
`engine/`, `main/build/`, `shared/`, or a Forge. Every claim is either **proven** (backed by a
real, re-runnable script against the current codebase — see the evidence table, §9) or
**specified** (a real, checked contract with no assembled implementation yet). A claim never
carries both words at once, and a claim with neither is a mistake in this document, not a third
category.

The full round-by-round history that produced this contract — every discarded claim and every
measurement a later one replaced, and the complete accumulated prototype source — lives in
`docs/design-streamed-worlds-history.md`. This document states only what is current. It never
names a discarded claim or a round number in its own operative text; where two ideas conflicted
across the design process, only the surviving one appears here, and the history file is where the
conflict and its resolution are recorded.

Phasing (§2) is the map from this contract to shippable work: phase 1 is schema/generator/capacity
(no engine change), phase 2 is the UNROM 512 four-screen engine consumer, phase 3 is the MMC1/MMC3
two-nametable variant. Nothing in phases 2-3 is built; phase 1's own shipping generator diffs are
not built either. What phase 2 needs is a real, working design to implement against — that is what
this document is.

**Design round closed 2026-09-21 by Chris's acceptance, not by a reviewer GO.** The last review
(13) was FIX with five narrow items and itself said the remaining risk is better retired through
phase-1/2 implementation than further design expansion; those five items are carried into
implementation as obligations, listed in §10 ("Obligations carried from review 13"), together with
the revisit obligations attached to Chris's rulings in §1.

## 1. Decisions by Chris

Quoted verbatim where his own words exist; paraphrased only where the record is a settled scope
choice rather than a quotable sentence.

- **The authoring unit is a bigger grid of today's screens, not a new tilemap model.** A streamed
  map is a larger grid of this project's existing 16×15-metatile screens (today capped at
  `LIMITS.mapGrid = 4`), which the camera scrolls across seamlessly — never a continuous tilemap
  with no screen structure underneath it. An SMB3-style wide level is a 1-high, N-wide grid; an RPG
  overworld is W×H.
- **The streaming mechanism is FALLEN STAR's**, a reference implementation at
  `/home/chris/claude_nes_test/src/` (`world_stream.asm`/`world_render.asm`/`boot.asm`/
  `player.asm`/`data.asm`): a torus window, entering-edge strips drawn one chunk per vblank from
  NMI, a continuously-tracking camera, and a lag-threshold teleport guard. Adapted wherever this
  engine's own rules (a fixed, always-resident metatile catalogue; the `vram_buf` single-producer
  discipline; the six-fixture ROM-neutral-off requirement) force a real departure — never silently
  diverged from.
- **Board gating is accepted**: a mapper needing a switchable PRG bank to hold the streaming
  mechanism's own cold code, or four-screen mirroring for the four-screen consumer, is a real,
  named gate — the same shape `rpgCapable()` already gates the battle system with. NROM and the
  discrete-CHR boards keep today's hard cut or item 12's screen-edge slide; they were never
  candidates for this feature.
- **Match FALLEN STAR's own streaming performance, exactly, rather than a slower schedule this
  project invented.** Verbatim, rejecting an earlier 0.333 px/frame one-in-three movement
  schedule: *"I want you to match the streaming from fallen star. This is something fable wrote in
  another session we should just be able to reuse that streaming code and match that
  performance."* The chosen mechanism (§5, Movement) is FALLEN STAR's own exclusive-vblank NMI
  arbitration at `SW_STREAM_CHUNK = 3`, a per-axis subpixel accumulator at 1.5/1.4375 px/frame,
  dash disabled entirely on a streamed map, and no diagonal movement (4-way exclusive input,
  whichever axis was pressed most recently owns the accumulator).
- **No long forced-blank transaction for dialogue.** Verbatim, rejecting an earlier ~35-frame
  (0.58 s) open-then-close full-torus-redraw design: *"Ask for a cheaper path."* His earlier,
  still-standing framing of what a message box does on a streamed map: *"a message box on a
  streamed map opens by snapping the camera to the player's own screen origin and redrawing... on
  close, the full torus redraw around the player and the camera back to centred."* Only the
  transaction's own mechanics changed — the camera moves, the window (the resident torus buffer)
  never does, and no forced blank runs at all (§7).
- **Small maps: fill-metatile padding, not a refusal.** Verbatim: *"rows and columns outside the
  authored grid are padded with a fill metatile — a per-map field, named `fillMetatileId`, default
  0 — and collision outside the map is a wall. One-high and one-wide maps stay in scope."* (§3,
  §5.)

### Consequences of these decisions, and Chris's rulings (2026-09-21)

On 2026-09-21 Chris ruled on every consequence below: each carries a tag saying whether he confirmed it or accepted it as a working assumption with a named revisit obligation (all listed in §10). Most of it follows mechanically from
the decisions above — a necessary consequence of the mechanism he picked (FALLEN STAR's own
arbitration, the fixed-catalogue/`vram_buf` constraints, the fill-metatile decision), not a further
choice this document made on its own. **Five items below do not follow mechanically — they are
restrictions or figures this design proposed, marked where they appear: the vertical 1.4375 px/frame
rate, the knockback cap, which frame an event freezes, the player-Move boundary rule, and
close-for-Save.** Chris's rulings on them are recorded in their own tags, dated 2026-09-21 and no
earlier; a scratch-tree source
comment that attributes one of them to him is not authority for that attribution — it records which
session's own code the comment lives in, never whose choice the code encodes.

- **[Confirmed by Chris, 2026-09-21]** Vertical walking is 1.4375 px/frame (86.25 px/s), not the
  1.5 px/frame (90 px/s) horizontal rate — a real, felt asymmetry between the two directions on a
  streamed map. Why: the physical
  ring is 32 blocks wide but only 30 tall, so a horizontal (column) strip is 30 blocks at
  `SW_STREAM_CHUNK=3` (10 vblanks) while a vertical (row) strip is 32 blocks (11 vblanks); the row
  strip needs the slower rate to keep its own worst-case single-crossing time (12 frames) above its
  own 11-vblank service cost, with the identical one-frame margin the column axis gets at 1.5
  px/frame and 10 vblanks.
- **[Accepted by Chris for phases 1-2, 2026-09-21; revisit: phase 2 knockback model]** Knockback on a streamed map is capped at 8 px total (1
  px/frame, `KNOCKBACK_TIME` unchanged at 8 frames), down from the ordinary engine's 24 px (3
  px/frame) — one third the speed, not halved, and both slower and shorter over the same 8 frames. An
  ordinary (non-streamed) map's knockback is unaffected. **Revisit (phase 2):** run the
  scheduler/containment model with streamed knockback at walk speed (1.5 px/frame for 16 frames =
  24 px) and restore 24 px if it holds. That it will hold is an untested hypothesis, not a result.
- **[Confirmed by Chris, 2026-09-21]** On a streamed map, a frame in which an event ran is a frame the player does not move, with a
  scripted `Move` the one explicit exception (a `Move` calls through the identical accumulator
  ordinary held movement does — it *is* the player's own movement, not a frame the freeze policy
  applies to) — the interact path (walking up and pressing the button) gets the identical one-frame
  freeze the touch/enter path already has structurally, closing a real gap the unpatched engine has
  today (a repeatedly-mashed interact-triggered `[Flash]` never freezes movement at all, since
  `dispatch_input` runs it directly rather than through the `settle_owed` gate touch/enter use). **The
  felt effect is stated plainly, not waved away**: at the fastest legal interact-mash rate (period 2 —
  release one frame, press the next), the player walks at **half rate** while mashing, since every
  other frame is frozen by the event that just ran — a real, visible stutter, not "imperceptible in
  practice." (The streamed map's own camera/viewport tracking is unaffected either way — §5's own
  scheduler proof shows the freeze policy keeps camera lag at 0 during this exact mash, a claim about
  the *scheduler*, never about what the walking itself feels like to a player holding a direction
  while mashing interact.) It is a rule about events, not about walking speed: no axis speed changes
  because of this.
- **Dialogue draws its box in 9 frames each way (6 row + 3 attribute); open pays a further pending
  phase before the draw starts — 1 frame in the best case, up to 12 real vblanks in the worst
  directly-measured case (a real 32-block strip already draining, with a concurrent Flash burst) —
  and close pays a further 1-frame drain-acknowledgement after the draw ends (§7's own "Frame
  counts and timing" has the full breakdown and the reason the pending figure already counts its own
  transition frame, not a quantity to add a further +1 to).** Open therefore totals 10 frames in the
  best case, up to 21 in the worst directly-measured one; close totals 10 in the ordinary case, with
  a real, directly-measured but not generally bounded overrun case landing its own resumption two
  frames later than the ordinary case's own resumption (§7 — an *observed* delay for that one tested
  overrun, not a promise about an arbitrarily longer one), with no forced blank, on a streamed map —
  worse than an ordinary screen's 7-and-7=14, with **no aligned fast path back down to that figure**
  (the box palette must be set regardless of camera alignment), because a box that straddles a
  physical nametable seam splits into two `vram_buf` packets per row/attribute run. Invisible latency
  either way, since the world is already frozen by the ordinary dialogue-freeze gate before the wait
  even begins, and the strip itself keeps draining under NMI throughout the wait, frozen world or not
  (§5, §7). **The nudge itself always floors** — `AND #$F0` to the enclosing 16 px boundary, snapping
  toward the **lower** coordinate by 0-15 px on each axis independently, never upward, with no tie to
  break and no "nearest" rounding of any kind (§7) — the same rule everywhere this document mentions
  the nudge, including here.
- **[Confirmed by Chris, 2026-09-21]** **Dash is disabled outright on a streamed map**, and a scripted `Move` is not exempt from the
  accumulator's own rate — it is capped at the identical 1.5/1.4375 px/frame ceiling ordinary held
  movement is. **Obligation:** the UI labels dash "ignored on streamed maps" rather than letting it
  look functional (CLAUDE.md Conventions).
- **A player `Move` requested while a dialogue box is open on a streamed map closes the box first,
  visibly, before a single pixel of the move happens** — the box is not preserved or reopened
  automatically; the next `Say` raises a fresh one. Ordinary (non-streamed) dialogue has no
  equivalent cost, since it never nudges a camera in the first place.
- **[Confirmed by Chris, 2026-09-21]** A scripted `Save` requested while a dialogue box is open on
  a streamed map also closes the box first, visibly, before the save commits — a real, felt two-part
  cost, not one figure: the box
  itself takes the ordinary ~10 frames to visibly close (nine draw frames plus its own
  drain-acknowledgement, the identical close-for-Move animation), and **then a further, longer pause
  the player sees nothing during** — the screen holds whatever the closed box left behind while the
  real commit itself runs (measured at 34-45 real frames total, close included, in 
  fixture; dominated by the flash driver's own real write time and a genuine, disclosed jsnes/
  PPUSTATUS polling quirk `save_media_commit`'s own pre-existing `wait_vblank_poll` already carries,
  not new cost adds — §7). The next `Say` raises a fresh box rather than any typed text
  reappearing. This applies only on a flash-save board (UNROM 512): the save medium itself is what
  forces it — a battery board's own instantaneous SRAM write never touches anything the box depends
  on, so a battery-board `Save` costs nothing extra and never closes anything (§7).
- **[Accepted by Chris for phases 1-2, 2026-09-21; revisit: phase 3 handover window]** A non-player actor on the screen the player just left disappears the instant the crossing
  commits** — not merely off-screen, genuinely absent from the live array, mid-view, while the
  camera is still visibly showing the corner of that screen. This is a real, more jarring version
  of a cost the ordinary engine already accepts in a blunter form (a hard screen cut never lets the
  player witness the loss at all).
  **Revisit (phase 3, the top polish item):** a handover window for actors near the seam, or
  documented authoring guidance.
- **[Accepted by Chris for phases 1-2, 2026-09-21; revisit: phase 2/3 actor-identity Move]** A cutscene cannot walk the hero across a
  screen-*ownership* boundary on a streamed map — a
  scripted `Move` whose mover is the player is bounded by the **natural ownership rectangle** (x
  0-255, y 0-239), not the tighter actor-containment wall (`MAX_X`/`MAX_Y`, 240/224) a patroller
  stops at — the player may legally walk the scripted move all the way into the same 0-255/0-239
  fringe held movement and Save already admit (§7 corrects the earlier, wrong claim that these two
  bounds were the same edge), but never past it: ownership itself never changes mid-page. An author
  who wants a scripted crossing has to compose it as a `Warp` instead (§5, §6). Dropping the box is settled; the boundary stop is the
  working assumption. **Revisit (phase 2/3):** address the moved actor by identity rather than by live
  `talk_ent` slot so a `Move` can cross; until then the Map Forge's event editor warns when a
  scripted player `Move` on a streamed map can reach a screen edge.
- **[Accepted by Chris for phases 1-2, 2026-09-21; revisit: phase 2 measured RPG]** A streamed project's own music+SFX+text budget (kernel-hi) drops to 6,075 bytes with no
  dialogue or Move at all, 4,459 with dialogue alone, 4,336 once dialogue AND a scripted Move are
  both live on a streamed map (the fullest, most common case)**, from the ordinary 8,128 — a
  real, project-wide content cost paid by every streamed project regardless of how small the
  streamed map itself is, charged once the feature is used at all. These are measured consequences of kernel-hi placement,
  not a choice (§4). **Revisit (phase 2):** measure a real streamed RPG's music+sfx+text against the
  ceiling; if it pinches, relocate the dialogue overlay (the dialogue kernel-hi allowance) back to a
  switchable bank on boards with room. `checkCapacity` must report an overflow in plain language
  naming the Sound Forge / text either way.

## 2. Scope, board gating, and phasing

**Board gating** is per mapper-registry entry, matching `rpgCapable()`'s own shape — never a
session-global flag. `streamCapableFourScreen` is true only for UNROM 512 under `fourscreen`
mirroring (phase 2, the only consumer this document specifies to engine-implementation depth).
`streamCapableTwoNametable` is true for MMC1 and MMC3 under `vertical` or `horizontal` mirroring,
and for UNROM 512 under either mirroring without `fourscreen` (phase 3, addressing only — not
engine-specified here). Every other mapper/mirroring pair is `false`. The two-nametable capability
additionally restricts grid shape wherever it is live: the axis that cannot scroll under
two-nametable mirroring has exactly **one screen** of physical ring depth (half the four-screen
ring's own 32×30 physical area on that axis), so a two-nametable streamed map is N×1 or 1×N, never
N×M with both N,M > 1 — an authoring restriction (`validateProject`), not a capability-flag
distinction.

### Phases

| Phase | Content | Design-vs-implementation state |
|---|---|---|
| **1 — world model, generator, capacity** | `map.streamed`, the streamed grid ceiling, the emitted layout (§3), the aggregate capacity check (§4), `saveCompatToken` wiring for a streamed map's own structural edits, phase-1 build refusal for a `map.streamed=true` project with no engine consumer | Specified to the byte level (§3-§4); no generator diff written |
| **2 — UNROM 512 four-screen consumer** | The torus/strip mechanism and movement (§5), reads (§6), the dialogue overlay (§7), transitions (§8) | Every mechanism is proven by a real, reproducible prototype (evidence table, §9); zero of it is wired into `engine/`, `main/build/`, or a Forge |
| **3 — two-nametable variant (MMC1/MMC3)** | A 32×15 or 16×30 ring (half the four-screen ring's physical area), the dead-axis authoring restriction, its own Mesen deadline proof, **and a re-proof of the coincident-frame bound (§5) on that ring, per board, with real mapper-switch costs measured against that ring's own addressing** — not an assumption that phase 2's own four-screen figures transfer | Not started. Nothing in this document's own proofs directly times a two-nametable ring; phase 2's mechanisms (the accumulator, the arbitration shape, the dialogue overlay) are expected to generalise, not re-derive, but that generalisation is unverified. §5's own indicative (not proven) arithmetic for MMC1/MMC3, corrected for every mapper-switch delta the four-screen conversion had omitted, already shows MMC3 fitting narrowly (307 cyc, 1.11%) and MMC1's own corrected arithmetic negative (−137 cyc) under a conservative generic bound — **entry to phase 3 requires closing this question for real, on that ring's own geometry, before any production wiring**, not carrying the indicative figures forward as if proven |

Order is 1→2→3 strictly: phase 2 answers every hard mechanism question (the torus, the NMI budget,
frame ownership) against real hardware timing on the simpler board family; phase 3 reuses those
answers against a harder addressing shape rather than re-deriving them; a Map Forge deliverable
(phase 4, `design-maporg.md` §12's own world overview, made a required rather than optional
deliverable the moment a map can hold 100+ screens) and the CLAUDE.md docs pass (phase 5) follow
once an engine exists to describe.

**ROM-neutral off, unconditionally, at every phase**: a project with no `map.streamed=true` map
must assemble byte-for-byte identical to today. This is the same discipline every other conditional
engine feature already holds to (CLAUDE.md's own kernel-budget section), and the six checked-in
fixtures never set the flag, so their own SHA-256 is the standing proof that nothing here has
touched them.

## 3. Data model and emitted layout

### The record

A **streamed screen's own record is 338 bytes, uncapped**: 240 bytes of raw terrain (metatile ids,
no baked attribute table — a streamed screen's own palette is computed at draw/stream time from
`mt_pal`, never stored per screen) plus 98 bytes of metadata at the full, uncapped
`MAX_ENTITIES=8`/`BOUND_CAP=8` worst case (1 entity count + 8×9 entity records = 73, 1 bound-tile
count + 8×3 bindings = 25; 73+25=98). No per-screen cap is applied — PRG space is not the resource
this design is short of, and a cap would only buy back bytes at the cost of a real authoring
restriction. `STREAM_SCREENS_PER_REGION = 24` (`floor(8176/338)`).

**Metadata addressing**: the record's own base pointer (`mtptr`) addresses byte 0; terrain (bytes
0-239) is read with an ordinary 8-bit `Y` index. Metadata (bytes 240-337, 98 bytes) needs a second
step because an 8-bit `Y` cannot reach past byte 255 from one base: for offsets 240-255 (16 bytes)
`Y` still reaches them directly; for offsets 256-337 the accessor advances the record's own 16-bit
base pointer by `$0100` first (the PRG bank stays selected — only the pointer moves, the identical
step `sw_goto`'s own cold path already performs internally), then indexes `Y = offset - 256`
(0-81, 82 bytes). Whichever consumer does this (`spawn_entities`, not rebuilt) must
restore the record's own original base pointer before returning to anything that expects `mtptr` to
address byte 0 again — the shared terrain pointer is a piece of state every other consumer also
reads, and this is the one accessor that must temporarily move it.

**An ordinary (non-streamed) map's own screens are unchanged**: today's 304 bytes (240 terrain + 64
baked attributes) plus variable entity/bound-tile metadata, addressed by the existing per-screen
kernel-lo pointer columns. The two formats are genuinely distinct, never a shared record — that is
what lets a streamed map pay **zero** per-screen kernel-lo pointer bytes at all, the design's own
central saving.

### One field/offset/index table, resolved

The prior open questions here — global vs. compact ids, four vs. six emitted bytes per streamed
map, whether the six streamed-only columns are charged per map or per streamed map — are resolved
by one algorithm, a single map-order walk maintaining three counters:

```js
let nextGlobalId = 0;      // = map_base for whichever map comes next, in project order
let ordinaryIndex = 0;     // compact index into the ordinary-only 13-byte pointer columns
let streamedMapIndex = 0;  // compact index into the streamed-only 6-byte-per-map columns
for (const map of project.maps) {
  const mapBase = nextGlobalId;
  emitMapIdentity(map, { mapBase, mapSong: true, encounters: true }); // 9 bytes, EVERY map, unconditional
  setMapTypeBit(map.streamed);                                        // 1 bit, packed, EVERY map
  if (!map.streamed) {
    for (const screen of map.screens) emitOrdinaryScreen(screen, ordinaryIndex++); // unchanged
    nextGlobalId += map.screens.length;
  } else {
    emitStreamedMapColumns(map, streamedMapIndex++, {
      tileset: map.tilesetId,           // 1 byte -- a streamed map draws with ONE tileset for its whole grid
      fillMetatileId: map.fillMetatileId ?? 0, // 1 byte
      locator: { baseBank: computeBaseBank(map), regionsPerRow: computeRegionsPerRow(map), gridW: map.gridW, gridH: map.gridH } // 4 bytes
    });
    for (let row = 0; row < map.gridH; row++)
      for (let col = 0; col < map.gridW; col++)
        emitStreamedScreenRecord(map.screens[row * map.gridW + col]); // the 338-byte record, packed by region
    nextGlobalId += map.gridW * map.gridH;
  }
}
```

- `map_base` is **the one and only base-id field either map type uses** — computed by this single
  in-order walk, never duplicated. `emitMapIdentity`'s own 9 bytes (`map_base`, `map_song`,
  encounter configuration) are unconditional and identical for both map types; a streamed map's
  own `tilesetId` is a **new, separate** per-map byte, because `screen_tileset` (the existing
  per-screen column that carries it for an ordinary map) does not exist for a streamed map at all.
- The **map-type table** is 1 bit per map, packed (`ceil(mapCount / 8)` bytes total, not 1 byte per
  map — an explicit rejection of an 8×-wasteful alternative), indexed by raw map index (0..mapCount-1,
  never a compact index of either kind), since it is the one thing every consumer must read
  *before* it knows which compact index applies.
- **Charge, resolved**: `13 × ordinaryScreens + 9 × maps + 6 × streamedMaps + ceil(maps / 8)` — the
  9 identity bytes are paid by every map exactly once (never doubled against the streamed-only
  charge); the 6 streamed-only bytes (tileset + fill + 4-byte locator) are paid **only** by a
  streamed map, indexed by its own compact `streamedMapIndex`, never by raw map count.

### Global id resolution and packed type bits

**At generate time** (JS), given a global screen id, `flattenScreens` walks the map-type table in
project order; the first map whose own `[map_base, map_base + screenCount)` range contains the id
is the owner (`screenCount` is `gridW × gridH` for a streamed map, `screens.length` for an
ordinary one) — the existing, already-shipped algorithm, unchanged.

**At runtime, every global-target resolution goes through the SAME map-order prefix walk — there is
no raw-`flat_screen` exception for an ordinary-to-ordinary warp.** A prior version of this section
claimed such an exception ("an ordinary-to-ordinary warp uses the target `flat_screen` directly
against the already-compacted ordinary columns, exactly as today"), and it does not hold: a global
id is only equal to its owner's compacted index when no streamed map with a lower `map_base`
exists. **Worked example:** a project with streamed map A (2 screens) followed by
ordinary map B (1 screen) gives B's one screen global id **2**, but B's own compacted
`ordinaryIndex` is **0** — the two numbers agree only by coincidence in a project with no streamed
maps at all, which is exactly the case that let the old exception go unnoticed.

The walk itself is a single linear scan of the emitted `map_base` table plus one generated
final-total constant — the first map where `id < map_base[mapIndex+1]` (the next map's own base, or
the final total for the last map) is the owner, `O(mapCount)`. It runs for **every** global-target
resolution, not only a streamed one, and produces two things: the owner's map-type bit, and a
running count of how many ordinary screens and how many streamed maps the walk has passed so far
(the two prefix counters `emitScreens`' own emission loop already threads through, §3's own three-
counter table) — cheap to keep as running totals during the SAME scan rather than a second pass.
The map-type bit then picks which of those two counters is the answer: an ordinary target's
compacted `ordinaryIndex` is the ordinary-screen prefix count at the owner map, exactly as many
ordinary screens as were emitted strictly before it; a streamed target computes `(screenCol,
screenRow) = ((id - map_base) % gridW, (id - map_base) / gridW)` and calls `sw_goto`. No new ROM
table is needed for either count — both are recomputed by the walk itself, from data already
emitted for §3's own reasons.

Every consumer that reads the ordinary per-screen pointer columns by raw `flat_screen` must instead
resolve the map-type bit and its own compacted `ordinaryIndex` first via this walk — true for a
streamed target as it always was, and now equally true for an ordinary one. `rebuild_bound_cache`
(and any future site reading `screen_bound_lo/hi` by `flat_screen`) is the concrete case named in
§8; the fix is the same branch, not a new mechanism. **Ordinary gameplay's own hot paths — the ones
that run every frame, not once per warp — may cache the resolved compacted index** (the current
screen's own index does not change except on a warp or a structural map edit, both already rare,
already-settling events), so this is a per-warp cost, never a per-frame one; a project with no
streamed maps at all still pays the walk once per warp; the loop still terminates on its very first
iteration in that case (mapIndex 0 already owns every id), so the walk costs nothing observable
there beyond one comparison.

**The metadata accessor's own calling convention, stated explicitly.** `emitMapIdentity`'s 9 bytes
and `emitStreamedMapColumns`' 6 (the locator: `baseBank`, `regionsPerRow`, `gridW`, `gridH`) live in
resident kernel-hi tables, read with an ordinary 16-bit pointer (`ptr_lo`/`ptr_hi`) advanced by a
fixed stride per map. **Advancing that pointer never selects a PRG bank** — incrementing `ptr_hi`
on a carry out of `ptr_lo` (crossing a `$100` boundary within the SAME resident table) is plain
pointer arithmetic, not a `switch_prg_bank` call, so a caller resuming immediately after a metadata
read finds the switchable window exactly as it left it: whichever screen bank the field's own
`mtptr` currently names, untouched. That is a real property, not an incidental one — it is *why*
the map-order prefix walk above (run from ordinary mainline code, itself resident) can call into
this table freely, mid-walk, with no bank bookkeeping of its own, the same way `sw_peek_byte`
already returns through `sw_locate_current`. **An accessor advertised as callable from switchable
code is a different contract, and must say so:** a genuinely banked caller (RPG battle code, or any
future `codeRegions` occupant) that reads this metadata mid-call must restore *its own* bank
afterward exactly as `sw_read_transaction` already does for terrain reads — the metadata table's own
"no bank change" property protects the *field's* current selection, never a distant caller's,
because from that caller's perspective the metadata read still ran through whatever bank *it*
started in, and only that caller knows what to restore it to.

**The wait_vblank-first mainline premise, stated once, for every read in this section.**
`main_loop` begins with `jsr wait_vblank` (§5, "Frame order"): NMI for iteration *n* has already
run to completion by the time any of mainline(n)'s own reads — the prefix walk, `sw_goto`,
`sw_peek_byte`, the metadata accessor above — ever execute. Every read in this section is therefore
reading a state that is already fully settled for this frame: no NMI can interleave with a mainline
read and observe or produce a half-updated value, because the one NMI that could run during this
same iteration already ran, in full, before mainline started. This is the same guarantee `checkCapacity`'s own capacity math and every fixed-kernel table in this
codebase already lean on implicitly;
naming it once here is what lets every accessor above describe itself as simply "safe," without
re-deriving why on each one.

### Save identity and the mode-dependent coordinate rule

`save_check_valid` reads the saved screen's own map-type bit before applying a position range: an
ordinary-screen save keeps today's `0-224` (`MAX_Y`)/`0-240` (`MAX_X`) range unchanged; a
streamed-screen save accepts the full `0-239`/`0-255` range the continuous-crossing model (§4) can
legitimately produce. Toggling a single map's own `streamed` flag with no other structural edit
does **not** bump `saveCompatToken` — the position's own meaning (a `flat_screen`-addressed point)
is unchanged — but it does change which range a saved position on that map is checked against on
the next load, since the map-type bit is live project state, not baked into the save. A save taken
while streamed (legitimately at y=230) that is then loaded after the map is toggled back to
ordinary correctly fails the now-active 224 check: the position genuinely does not exist on an
ordinary screen, and the standing "this save does not belong to this build" path is the right
response, not a silent clamp. A *structural* edit to a streamed map (reordering its own screens,
resizing its grid) uses the identical `saveCompatToken` bump every other structural edit already
gets (item 7's own mechanism) — never a parallel, streaming-specific one.

The project-wide screen ceiling is **255**, not 256: `NO_SCREEN = $FF` is the existing
neighbour-table sentinel, so a real screen id of 255 would be indistinguishable from "no screen"
the instant a project reached exactly 256 — the identical "the cap is the sentinel's own value"
rule this codebase already applies to `LIMITS.actors`/`LIMITS.items`/`LIMITS.metasprites`. The
refusal is `count > 255`, not `count >= 255`: 255 screens is legal (ids 0-254, sentinel 255).

## 4. Capacity and placement

### The allocator-based packing predicate

The acceptance check calls the real, already-shipped packer in validation mode rather than trusting
a generic capacity count:

```js
function fitsCapacity(mapper, tilesetCount, bankedCode, reserveFlashSave, flat, actorCount, boundTilesEnabled, options) {
  try {
    assignScreenBanks(mapper, tilesetCount, bankedCode, reserveFlashSave, flat, actorCount, boundTilesEnabled, options);
    return true;
  } catch {
    return false;
  }
}
```

**`options` (the eighth argument, `{ regionsOverride }`) was previously silently discarded** — the
wrapper's own signature stopped at seven parameters, so the streamed-first allocation's own call
below (passing `{ regionsOverride: remainingRegions }`) was accepted by JavaScript's own arity
tolerance and then dropped on the floor, meaning `fitsCapacity` always checked against the FULL
region list rather than the post-streamed-reservation remainder — a false pass for exactly the
project this whole reservation exists to refuse (ordinary content that only fits because it is
still counting streamed-reserved regions as available). Fixed here: the eighth parameter is declared and forwarded into `assignScreenBanks`, which — like
`fitsCapacity` itself — is not yet shipped with streaming's own extensions and must gain the
matching `options.regionsOverride` parameter (packing against that region list in place of the
mapper's own full `screenRegions` call) in the same phase-1/2 implementation pass; this section's
own fix is the design contract's internal consistency (a wrapper that does not silently drop what
its caller passes it), not a claim that either function ships this way today.

`screenCapacityFor`'s own count is not a valid substitute: it counts a region's own leftover tail
as capacity for one more *empty* screen, which can be too small for the real, larger record a
caller is actually asking about — proven against the real shipped functions with a 26-record MMC3
case (28 filler regions of 26 empty 306-byte screens each, a 25-record tail, one oversized
402-byte record): `screenCapacityFor` reports 754 of 754 requested records fit; `assignScreenBanks`
throws, naming exactly the one record that does not. The corrected predicate (calling
`assignScreenBanks` itself) rejects the bad case and accepts the same records minus the oversized
one.

**Streamed-first region allocation**: streamed and ordinary content never share one region — a
streamed map's own row-chunks are whole regions (`ceil(gridW / STREAM_SCREENS_PER_REGION)` per
row), packed independently of ordinary byte-level packing — so streamed regions are reserved first,
unconditionally, and the real packer runs against whatever regions remain:

```js
usable = screenRegions(mapper, tilesetCount, codeRegionCount(project), { reserveFlashSave })
streamedNeed = sum over every streamed map of gridH * ceil(gridW / STREAM_SCREENS_PER_REGION)
refuse if streamedNeed > usable.length
remainingRegions = usable.slice(streamedNeed)
refuse unless fitsCapacity(mapper, tilesetCount, codeRegionCount(project), reserveFlashSave,
                           flatOrdinaryScreens, actorCount, boundTilesEnabled,
                           { regionsOverride: remainingRegions })
```

`codeRegionCount(project)` is **unchanged by streaming** — the streaming mechanism's own cold code
needs no switchable PRG region at all once it is placed in kernel-hi (below); a candidate formula
from an earlier round that added `+ (anyStreamedMap ? 1 : 0)` to reserve one is not used, since the
real, measured resident placement (below) makes that reservation unnecessary. `tilesetCount` is the
project's own real tileset count (never a placeholder of 1); `reserveFlashSave` is charged only
when the project's own save configuration actually uses UNROM 512's flash sector.

**Preflight ordering for a mapper/mirroring switch** (`checkStreamedMapperSwitch(project,
candidateMapperId, candidateMirroring)`): runs against a `structuredClone` with the candidate
cartridge fields applied and passed through `reconcileCartridge` first (a switch can itself shrink
the tileset ceiling or force a mirroring change, and the aggregate check must see the *post*-switch
shape); checks, in order, (1) the candidate carries `streamCapable*` for every streamed map already
in the project, (2) a two-nametable candidate's own dead-axis restriction holds for every streamed
map's current grid, (3) the aggregate check above passes for the candidate. On any failure the real
project is untouched — `store.commit` never runs. A hand-edited or later-version project carrying a
now-illegal combination is refused **at load**, before `normalizeProject`, the same ordering every
other over-capacity refusal already uses.

**Which boards are candidates** for a mapper-switch suggestion asks the existing authorities rather
than restating their rules by hand (`switchableMappers`'s own shape, CLAUDE.md's "The battle
system"): does `reconcileCartridge` change the project at all, and would the result still pass
every content and capacity check including this one — never a hand-written filter chain. **No
board is offered to a project carrying hand-written 6502** (a Code Forge override), the same
standing rule this codebase already applies to a mapper-switch suggestion for the RPG battle
region — two of the checks above model stock code, and a hand-written override could save more or
fewer bytes than the model assumes.

### Resident placement in kernel-hi

**`$E000-$FFFF` (kernel-hi) is part of the same permanently-mapped fixed kernel as `$C000-$DFFF`
(kernel-lo)** — reachable by an ordinary `jsr`/`jmp` from either half with no trampoline and none
of a genuinely switchable bank's hazards. This is where the streaming mechanism's own resident set
lives, now measured from **one combined build** (`build_fix16.mjs`), not from separate
experiments — the prior 1,901-byte figure was derived before the fill-aware routing and the
mixed-vblank branch existed and, separately, never included the dialogue overlay at all (that still
lived in a bank-14 scratch excursion). The stale 6,569/1,663-free figures below
are likewise removed — they came from a failed relocation experiment, never a working build.

**Two kernel-hi allowances, both gated on `projectUsesStreaming`-family predicates:**

```
STREAMWORLD_KERNEL_HI_ALLOWANCE          = 2,053   -- mandatory: fill-aware readers, the mixed-vblank
                                                    -- sw_nmi_stream_reduced branch, accumulators,
                                                    -- clamps, crossings, projection, the renderer
STREAMWORLD_DIALOGUE_KERNEL_HI_ALLOWANCE = 1,616   -- the dialogue overlay: fix-12's mapper/split-
                                                    -- packet-writer/attribute code, the
                                                    -- sw_dlg_metatile accessor, fix-15's
                                                    -- lifecycle glue, fix-17's own
                                                    -- sw_dlg17_camrelease/save_resync routines
                                                    -- (+100, measured), and fix-20/23's own
                                                    -- isolated close-for-Save delta (-33, a real
                                                    -- decrease -- the new resync body is smaller
                                                    -- than the box-redraw loop it replaces) --
                                                    -- gated on
                                                    -- projectUsesStreaming && projectUsesText
                                                    -- (close-for-Save needs a live dialogue box
                                                    -- to close in the first place)
STREAMWORLD_MOVE_KERNEL_HI_ALLOWANCE     = 123     -- fix-22/23's own isolated Move-boundary/
                                                    -- probe-crossing delta (sw_dlg22_wrap_y240/
                                                    -- probe_streamed/bound_x_right/bound_y_down) --
                                                    -- a SEPARATE, independently-gated term, not
                                                    -- folded into the dialogue allowance above:
                                                    -- gated on projectUsesStreaming && MOVE_ENABLED,
                                                    -- needed by any streamed project using Move
                                                    -- WHETHER OR NOT it shows any text at all --
                                                    -- folding it into the text-gated allowance
                                                    -- would silently under-reserve for a
                                                    -- streaming+Move project with no text
musicBytes + sfxBytes + text.bytes + STREAMWORLD_KERNEL_HI_ALLOWANCE
  + (projectUsesText ? STREAMWORLD_DIALOGUE_KERNEL_HI_ALLOWANCE : 0)
  + (MOVE_ENABLED ? STREAMWORLD_MOVE_KERNEL_HI_ALLOWANCE : 0) > BANK_SIZE - 64
```

The largest music+SFX+text payload a streamed project can carry is **6,075 bytes** (streaming with
no dialogue and no Move at all — vanishingly rare) or **4,336 bytes** once dialogue AND a scripted
Move are both live on a streamed map (the fullest, most common single-project case this document
otherwise frames its worst case around: 6,075 − 1,616 − 123 = 4,336 bytes — down from an earlier
**4,426 bytes** (down from an earlier 4,526 by the +100 bytes the camera/OAM barrier and Save-resync
routines measurably add to the dialogue-gated kernel-hi allowance) by a further −84 bytes (the
close-for-Save delta's own real DECREASE of 39 bytes, minus the newly-charged, separately-gated
Move-boundary term's own 123 bytes), down from the ordinary 8,128. A dialogue-only
streamed project with no scripted Move at all keeps the higher **4,459-byte** ceiling (6,075 − 1,616,
no Move term to subtract). **Worked example:** a streamed project with dialogue and Move at 4,336
bytes of combined music+SFX+text data passes; the identical project at 4,343 bytes is refused, by
`generate.js`'s own `checkCapacity`, naming whichever Forge's content (Sound Forge for music/SFX, the
event editor's own dialogue text otherwise) pushed the total over.

**The mandatory 2,053 and the original 1,549 overlay figure are real symbol-span measurements**
(`main.fns` address deltas: `sw_goto` at `$E143` through the byte immediately before
`sw_dlg_metatile` at `$E948` is the 2,053-byte mandatory set; `sw_dlg_metatile` through the last
byte of `sw_dlg15_t_end` (`$EF51`, `+4` for its own `jsr`/`rts`) is the 1,549-byte overlay), with the
three never-shipped debug-only tables **excluded for real** — built without them, not merely
excluded from a span calculation — and the negative-control old-gate NMI branch also excluded
(**8 bytes**, kernel-hi; never ships). **The camera/OAM barrier and Save-resync routines' own +100,
and the two further isolated deltas below, are all measured the same way, for a reason that matters
(see the kernel-lo methodology note below): as an isolated build-total delta**, not a hand-picked
address span — `build_fix19_clean.mjs`'s own BANK 63 total (4,031) against an otherwise-identical
control build with none of the camera/OAM barrier, close-for-Move or Save-resync patches applied
(`build_fix19_savebaseline.mjs`, 3,931) — because a naive address-span guess risks exactly the kind of
confound (below) that the equivalent kernel-lo measurement actually had. The identical discipline
applies twice more: `build_fix23_save_clean.mjs` (7,840/**3,998**) against
`build_fix19_clean.mjs` (7,794/4,031) isolates the close-for-Save mechanism's own real production
delta (−33 kernel-hi, a genuine decrease, including the review-12-finding-4 corrected OAM passes); `build_fix23_move_clean.mjs` (7,881/**4,121**) against
`build_fix23_save_clean.mjs` (7,840/3,998) isolates the Move-boundary fix's own real production delta
(+123 kernel-hi) — both clean, production-shaped variants with every negative control, coverage
counter, and hand-placed test event excluded for real, matching `build_fix19_clean.mjs`'s own
precedent exactly. Placement decision: the dialogue overlay moves out of its bank-14/PRG-register-7
scratch excursion and becomes plain kernel-hi resident code, appended alongside the rest
of streaming's own resident set — chosen over kernel-lo because it exists only alongside that same
resident set (no case needs the overlay without the base, so a second gate/location would only
duplicate the first), because it tail-calls `sw_terrain_or_fill`/`sw_goto` directly with no bank
concern either way, and because it leaves kernel-lo — CLAUDE.md's own scarcer, more contested budget
— completely unaffected by this feature. The camera/OAM barrier's own new routines (`sw_dlg17_camrelease` and,
until close-for-Save deleted its box-redraw branch and replaced it, `sw_dlg17_save_resync`) are
appended the identical way, for the identical reason — `sw_dlg20_save_resync` (§7)
is appended alongside them the same way in turn.

**A measurement confound found and corrected, disclosed before the table because it
changes how every figure in it must be read.** An earlier "isolated" kernel-lo comparison
(`build_fix16.mjs`'s baseline, 7,123, against `build_fix17.mjs`'s own combined build, 7,844, "+721")
was not actually isolated to the camera/OAM barrier's own new code: `build_fix16.mjs`'s baseline leaves
`SAVE_ENABLED=0`/`SAVE_FLASH=0` (no save subsystem assembled at all), while `build_fix17.mjs` (to
exercise item 4's Save-with-a-live-box proof) flips both to 1 — pulling in the entire **pre-existing**
save subsystem's own kernel-lo footprint (`save_write_body`/`save_checksum`/`save_media_commit`/
`wait_vblank_poll`/etc.) alongside the camera/OAM barrier's own small resync-tail patch. Measured directly,
round (`build_fix19_savebaseline.mjs`: the fix-16 baseline with `SAVE_ENABLED`/`SAVE_FLASH` flipped
but **none** of the camera/OAM-barrier or close-for-Move/Save patches applied): the save subsystem alone costs **+607 bytes**
of kernel-lo on this board with none of it attributable to streaming at all — already covered,
project-wide, by CLAUDE.md's own `SAVE_KERNEL_ALLOWANCE_BY_MAPPER[30] = 640` (the action-side figure
for UNROM 512; this prototype's 607 is in the right range for an independent cross-check, not a
reconciliation this design owes CLAUDE.md's own ledger). The genuinely isolated camera/OAM-barrier-plus-Save-resync delta
— `build_fix19_clean.mjs` (7,794, clean production-shaped variant, below) against
`build_fix19_savebaseline.mjs` (7,730), both with `SAVE_ENABLED`/`SAVE_FLASH` already flipped so the
subtraction cancels the confound exactly — is **+64 bytes**, not +721 and not +671 (the figure a
naive "just subtract the fix-16 baseline" comparison gives even after excluding test scaffolding).
**A second, independent error found in the same pass**: the pre-existing table below
already summed the *measured* 15-byte prototype-only "dialogue lifecycle's own driving hook" *and*
the *bounded* ≈40-byte production `text.asm` wiring that **replaces** it in production, double-
charging 15 bytes no shipped build ever pays twice. Both corrections are applied in the table below;
neither changes any accepted mechanism, only what the ledger charges for it.

**Kernel-lo hooks — measured where built (`build_fix19_clean.mjs`, a clean
production-shaped variant with every test-only routine/flag/hook excluded for real, matching
`build_fix16.mjs`'s own "debug tables excluded for real" precedent), conservatively bounded where
production glue remains unbuilt, never zero. The Gate column states each row's own predicate
explicitly, since not every row is charged to every streamed project:**

| Hook | Bytes | Gate | Basis |
|---|---:|---|---|
| NMI arbitration splice (`MIXED_VBLANK_MAX_BYTES` branch, incl. the duplicated `PALETTE_FX_ENABLED` v-pointer cleanup) | **23** | `projectUsesStreaming` | Measured: an isolated three-way `nesasm -s` bank-62 comparison (baseline 7,085 → +splice 7,108) |
| Camera/OAM publication barrier, NMI-side gate (`nmi:`'s own `cam_dirty`-gated `$4014` DMA check) | **4** | `projectUsesStreaming` (the doc's own `.if projectUsesStreaming`, §7 — not text-gated, even though only dialogue ever sets the hold today; see §7's own justification for the broader gate) | Measured: `build_fix19_clean.mjs` vs. `build_fix19_savebaseline.mjs`, isolated `main.fns` delta (`wait_vblank` $C36A→$C38D is +35 upstream of this check; `nmi_rti` $C411→$C438 is +39 total; the +4 here is the remainder) |
| Text.asm's own streamed branches (the *production* version of the dialogue-lifecycle driving hook, wired into `box_begin`/`text_open_step`/`text_close_step` — 3 call sites: the pending-open check inside `box_begin`, the mapped row/attribute dispatch inside `text_open_step`, and the mapped close draw + un-nudge trigger inside `text_close_step`) | ≈ **40** | `projectUsesStreaming && projectUsesText` | Bounded: three call sites, each a small dispatch comparable in shape to the measured 15-byte prototype hook it **replaces in production** (below) — not summed alongside it |
| *(replaced in production, not charged)* The dialogue lifecycle's own **prototype-only** driving hook (`sw_dlg15_tick` call + `move_tick` IDLE gate, a single `main_loop`-level call site standing in for the row above) | *(15, excluded)* | — | Measured: +splice 7,108 → +hook 7,123. Never ships — the row above is what production actually wires; summing both would double-count what production actually pays once |
| Close-for-Move mechanism (the detector in `main_loop`'s own frozen-world dispatch, `ui_tick`'s own priority patch, `text_close_attr`'s own tail patch — all three against real, generated engine-file copies, not prototype-only scaffolding) | **55** | `projectUsesStreaming && projectUsesText && MOVE_ENABLED` | Measured, isolated (`build_fix19_clean.mjs` vs. `build_fix19_savebaseline.mjs`): detector 30 (`main_loop_ui`→`wait_vblank` delta, net of the barrier's own +4) + `ui_tick` priority patch 19 (`ui_tick`→`save_media_commit` delta) + `text_close_attr` tail patch 6 (`text_close_attr`→`dispatch_input` delta) |
| *(excluded, prototype artefact only)* The existing fix-15/16 prototype hook's own move-tick gate extension (`sw_dlg17_move_close` check added to the `main_loop`-level `move_tick` call) | *(5, excluded)* | — | Measured (`main_loop`→`main_loop_f15_nomove` delta, isolated): this patches the SAME prototype-only hook the row above already supersedes — in production, `ui_tick`'s own real dispatch (already counted, above) is the only place `move_tick` is called at all, so this 5-byte fix has no production analogue |
| Close-for-Save mechanism (`script_op_save`'s own deferral tail — set a pending flag, request the overlay's close, suspend the same way a Move does, rather than committing mid-box — plus `main_loop`'s own per-frame completion hook, which runs the real, deferred commit and `script_resume` once the close's own drain is acknowledged) | **+46 kernel-lo / −33 kernel-hi** | `projectUsesStreaming && projectUsesText && SAVE_FLASH` | **ISOLATED, real production figures**: a clean, production-shaped variant (`build_fix23_save_clean.mjs`) layered on `build_fix19_clean.mjs`'s own clean baseline (7,794/4,031), with the real resync path only — no `sw_dlg20_oldresync` negative control, no test-only camera-dependent OAM marker, `save.asm`'s tail with no escape hatch, `boot.asm`'s completion hook with no test-kickoff material, and the resync's own OAM rebuild corrected to the real `main_loop_draw` order (`build_oam`/`draw_entities`/conditional `draw_hud`/`draw_ui`, the runtime dispatch/OAM-pass review) — measures **7,840/3,998**, an isolated delta of **+46 kernel-lo / −33 kernel-hi**. Kernel-hi still genuinely DECREASES: even with the corrected OAM passes, the new resync body is smaller than the box-redraw loop it deletes. Replaces the prior "+96/+94, not yet isolated" upper bound |
| *(deleted, not charged)* The camera/OAM barrier's own `sw_dlg17_save_resync` box-redraw branch (`sw_dlg12_open_row`/`open_attr` called from the resync tail) | *(was counted at 0 above, now removed)* | — | Redrawing an EMPTY box frame over whatever was actually displayed. Close-for-Save (above) closes the overlay for real before a commit ever runs, so there is no overlay content left to redraw from state at all; the branch does not exist in the current build, not merely dead code kept for show (`build_fix20.mjs`) |
| The event-freeze flag check (the interact-path freeze policy, §5) | ≈ **15** | `projectUsesStreaming` | Bounded: one flag set (interact dispatch), one check-and-skip (`update_player`), one clear (`main_loop_idle`; the byte cost itself is unchanged from an earlier, wrong hook site, only where the third branch lives) |
| The capped-knockback distance (24→8 px), a project with only streamed maps or only ordinary maps | **0** | — | A constant substitution (`KNOCKBACK_DISTANCE`), not new branching code — genuinely free either way |
| The capped-knockback map-mode branch, a **mixed** project (both streamed and ordinary maps) only | ≈ **10** | `projectUsesStreaming && projectHasOrdinaryMaps` (a project mixing map types) | Bounded (a named gap: `KNOCKBACK_SPEED` is a single global constant, so a mixed project needs a runtime branch — read `map_is_streamed` (below), select 3 or 1 — comparable to a `screen_fresh`-shaped single-byte dispatch |
| `map_is_streamed` — the runtime byte named for every consumer that could otherwise only say "the current map's own streamed flag": read by the capped-knockback branch above, by a scripted player Move's own same-axis bound choice (§7), and by `script_op_save`'s own mixed-project dispatch (§4) | **0** (the byte itself; each *consumer*'s own branch is charged in its own row) | `projectUsesStreaming` | A single shared zero-page byte, one writer (map entry/warp, from the generated per-map table), multiple readers — not three separately-invented flags |
| The Move boundary/probe-crossing branch (the carry-safe X bound, the corrected Y bound, and the four crossing-aware probe-offset captures feeding the shared `sw_terrain_or_fill`/`sw_peek_byte`-shaped dispatch, §7) | **+41 kernel-lo / +123 kernel-hi** | `projectUsesStreaming && MOVE_ENABLED` | **ISOLATED, real production figures**: a clean, production-shaped variant (`build_fix23_move_clean.mjs`) layered on `build_fix23_save_clean.mjs`'s own clean baseline (7,840/3,998), with `map_is_streamed`/`sw_dlg22_wrap_y240`/`sw_dlg22_probe_streamed`/`sw_dlg22_bound_x_right`/`bound_y_down` real path only — no `sw_dlg22_forceold` negative control, no coverage counters, no hand-placed test events — measures **7,881/4,121**, an isolated delta of **+41 kernel-lo / +123 kernel-hi**. Replaces the prior "≈277 combined, not yet isolated" upper bound |
| `script_op_save`'s own `map_is_streamed` dispatch check (item 4: one compare, before `sw_dlg15_state` is even read, routing an ordinary-map Save straight to the unconditional immediate commit) | ≈ **8** | `projectUsesStreaming && projectUsesText && SAVE_FLASH` | Bounded: one zero-page load, one branch — the smallest possible dispatch, charged separately from the Close-for-Save row above rather than silently folded into its already-disclosed, not-yet-isolated total |
| The movement/camera driver (`update_player`, unbuilt, §10 point 2 — a named, line-itemised byte estimate; §5 charges its real measured cycle cost) | ≈ **533** | `projectUsesStreaming` | Bounded from the specification-complete skeleton's own measured span (551 bytes, minus 18 bytes of test-only coverage counters with no production analogue) — see the six-line breakdown immediately below, unchanged in shape though not in scale |
| Runtime mixed-map prefix resolution (the map-order walk, §3 — every global-target resolution, per warp/entry, not per frame) | ≈ **55** | `projectUsesStreaming` (needed by any project with at least one streamed map, since it decides which counter a streamed OR ordinary target uses) | Bounded: a linear scan comparing a target id against a table of per-map bases, updating two running prefix counters, `O(mapCount)` in size but a fixed-size loop body — table read (10) + compare (8) + branch (4) + counter update (10) + loop overhead (9) + exit handling (~14) |
| Boundary-probe routing in `player.asm` (up to 4 collision-probe call sites × the cost of branching to `sw_peek_byte` instead of an ordinary same-screen dereference) | ≈ **56** | `projectUsesStreaming` | Bounded: 4 sites × ≈14 bytes each (an out-of-screen compare + a neighbour-coordinate computation + the `sw_peek_byte` call, replacing a plain `[mtptr],y`). `entities.asm` needs none — §6's "actor policy, current screen only" means no entity-side probe can ever straddle a boundary |
| The 16-bit metadata accessor's own extension to `spawn_entities` (§3 — the `$0100` pointer-advance-and-restore for a streamed record's offsets 256-337) | ≈ **30** | `projectUsesStreaming` | Bounded: an offset≥256 compare (6) + `ptr_hi` carry increment (4) + `Y=offset-256` computation (4) + the read itself (existing cost) + the restore-before-return (6) + loop/dispatch overhead (~10) |
| `main_loop_idle`'s own settle-the-freeze-flag hook (`dispatch_done` is the tail of `dispatch_input` itself, which returns to `main_loop` **before** `update_player` ever runs that frame, so clearing there would be clear-before-read, not end-of-frame; `main_loop_idle` is the frame's own single, always-reached convergence point, the same hook site `sw_dlg17_camrelease` already uses for exactly this shape) | ≈ **10** | `projectUsesStreaming` (paired with the event-freeze check, above) | Bounded: one flag clear, comparable in shape to `screen_fresh`'s own single-byte handling — the byte cost is unchanged from the prior (wrong) hook site, only the site itself moved |
| **Total, general (`projectUsesStreaming` alone — a streamed project with no text at all)** | **726** | | 23+4+15+10+533+55+56+30 |
| **Total, streamed + dialogue + Move + flash save (the fullest single-project case)** | **916** | | 726+40+55+46+41+8 |
| **Total, a mixed project (streamed + ordinary maps) with the same features** | **926** | | 916+10 |

**Reconciled for real:** the driver's own corrected byte estimate
(≈533, up from an earlier ≈140 — see its own line-by-line breakdown below, unchanged in shape but not
in scale) is gated
on `projectUsesStreaming` alone, the same gate the general "streaming with no text" total already
uses, so correcting it moves the BASE 333→726 figure, not merely the dialogue/Move/save additions —
every project with a streamed map pays this, whether or not it shows any text at all. The Close-for-Save
row and the Move boundary/probe-crossing row are ISOLATED, real production deltas (+46/−33 and
+41/+123 kernel-lo/kernel-hi respectively, both measured against clean baselines — see
their own rows above), not upper bounds combined with test scaffolding. `script_op_save`'s own
`map_is_streamed` dispatch check (≈8) remains a bounded, not isolated, estimate — a single
compare/branch too small to justify a fourth clean-build pass. `check_fix23_ram_ledger.mjs` (below)
confirms every new production RAM byte (`map_is_streamed`, `sw_dlg20_save_pending`) is real,
addressed, and clear of every other region — 0 failures, 15 regions, no overlaps.

**Movement/camera driver, line by line** (the "size it from the prototype routines that exist plus a
line-by-line estimate of what does not" the brief asks for — the accumulator itself,
`sw_walk_step_x/y`, is already resident kernel-hi code, part of the measured 2,053-byte mandatory
set; everything below is the unbuilt **caller-side** driver, `update_player`'s own extension):

| Sub-item | Bytes | Reasoning |
|---|---:|---|
| Accumulator call sites + axis dispatch | ≈ 17 | Read `sw_axis_pref`, branch to the owning axis (6) + `jsr sw_walk_step_x`/`_y` (3) + apply the returned pixel delta to the player's own position with carry into the high byte (8) |
| Signed crossing detection | ≈ 24 | Recompute `camPx` (a 16-bit subtract+clamp, 12) + divide by 16 (four `lsr`/`ror` pairs on a 16-bit value, 8) + compare the resulting `camBlock` against `current` (4) |
| Arm decision | ≈ 23 | Idle check (`st_active`, 4) + `desired` vs. `current` compare, both axes, X preferred on a tie (10) + move `current` one block toward `desired` (6) + `jsr sw_stream_start_col`/`_row` (3) |
| Axis arbitration (`sw_axis_pref` update, decision A's own "whichever axis was pressed most recently") | ≈ 20 | A small state machine over 4 pad-direction bits, comparing against the currently-held axis and updating the flag |
| Camera tracking + clamp (the continuous camera-feed driver, §10 point 4 — `cameraOrigin = clamp(desiredOrigin, 0, max(mapPixels-viewportPixels,0))`, both axes) | ≈ 40 | Two axes × (16-bit subtract for `desiredOrigin - centre`, a 16-bit clamp against 0 and against `mapPixels-viewportPixels`, store into `cam_x_lo`/`cam_y_lo` under the `cam_dirty` guard) |
| Position-jump guard, steady-state check (the `lag >= 6` test every frame; the rare forced-blank resync path itself is charged once, when triggered, not every frame) | ≈ 14 | Compute `lag` from `desired`/`current` (10) + compare against the guard threshold and branch (4) |
| **Subtotal** | **≈ 138, rounded to 140 — an estimate this document no longer charges, see below** | |

**The ≈140-byte subtotal above does not survive contact with a specification-complete skeleton, and
this document no longer treats it as the charged figure.** An earlier skeleton this estimate was
never reconciled against was neither spec-complete (one-byte one-axis origins, an arm decision blind to
Y, arbitration that ignored "most recently pressed," no negative-direction code, a one-axis camera
clamp) nor conservatively priced. The corrected, specification-complete skeleton (§5's own
frame-budget table, `driver-skeleton/driver.asm`, real 16-bit arithmetic on both axes throughout)
assembles, with real `nesasm`, to **551 bytes** for the six named parts plus the `driver_whole`
call-site wrapper (measured directly from the assembled bank usage and each label's own real
address, `diag_f23_driver_skeleton.mjs` — excluding the two already-separately-charged stand-in stubs
this skeleton uses for the resident accumulator and the resident strip-starter, which are not part of
this estimate either way). Of that, 18 bytes (two zero-page `inc` per coverage-counter branch, nine
counters) are this skeleton's own test-only instrumentation with no production analogue at all —
production needs no counter to know which branch it took. **A justified production figure is
therefore ≈533 bytes** (551 − 18), replacing ≈140 as this document's own byte-level estimate for the
unbuilt caller-side driver. The gap between the two (≈393 bytes) is the real cost of everything the
old estimate silently assumed away: a full second axis's own crossing-detect and camera-clamp code,
a real edge-triggered arbitration state machine, and real negative-direction arithmetic on both axes
— all genuinely necessary code, not padding a tighter implementation could shed.

This is the byte estimate; §5's own frame-budget table charges the driver's real, assembled,
`callRoutine`-measured worst-path **cycle** cost instead (563 cyc — the same corrected, six-part
skeleton, one label per row above), which is what replaces the prior "≈150 cycle" placeholder (and,
in between, an intervening "432 cyc" figure an uncorrected skeleton produced). The camera
tracking + clamp row is where the publication barrier's own hold/release lives on this path
(`cam_dirty` set before the write, left SET on return for the caller to clear after the OAM build —
never cleared inline, which was the exact bug an earlier skeleton had) — the continuous
camera-feed driver (§10 point 4), once built, must hold `cam_dirty` across its own camera-origin
write and OAM build exactly as the dialogue nudge/un-nudge already does (§7), including on an
ordinary moving frame with no dialogue live at all; that hold/release is inside this row's own
charged bound, not a separate, uncharged cost.

**What stays a separate, conditional allowance, not folded into either kernel-lo or kernel-hi
above**: the strip-fetch primitive and the arm built on it (`sw_strip_fetch_run_col`/`row`,
`sw_banked_stream_start_col`/`row`, `STREAM_BANKED_ALLOWANCE ≈ 348` bytes — 73 + 275, measured).
**Production needs neither, stated plainly**: now that the whole resident streaming mechanism lives
in kernel-hi (reachable from anywhere with a plain `jsr`, no bank concern), nothing streaming is
itself banked, so no caller resident in a switchable bank needs to read a strip's own content
through this primitive at all — it would only matter for a hypothetical future banked consumer
(e.g., an RPG battle-region routine) that does not exist today. Not charged; the contract says so
rather than leaving it an open question.

**No extra switchable code region is needed for streaming at all** — the earlier idea of reserving
one for the cold addressing path (`sw_goto` and everything that dereferences `mtptr` immediately
after calling it, which cannot be banked under this project's single-bank-at-a-time PRG model
regardless of where the *rest* of the mechanism lives) is unnecessary once the resident set moves to
kernel-hi, confirmed again by combined build.

**The combined build's own `nesasm -s` totals** (`minimal-u512-fix16`, debug tables
and the old-gate negative control both excluded, matching production): kernel-lo (bank 62)
**7,123/8,192 used, 1,069 free**; kernel-hi (bank 63) **3,931/8,192 used, 4,261 free**. Both banks
fit with real margin, on UNROM 512's own tightest-measured board. **A clean
production-shaped variant** (`build_fix19_clean.mjs`, the camera/OAM barrier and close-for-Move/Save features with every
test-only routine/flag/hook excluded for real — the interruption-check stall hooks, the
`sw_dlg17_oldbarrier` negative control, the two test-kickoff hooks and their hand-placed events, the
camera-dependent OAM test marker): kernel-lo **7,794/8,192 used** (818 kernel-lo bytes still charged
to the pre-existing, unrelated save subsystem in this particular build — see the confound note
above; the genuinely fix-round-17/19-attributable kernel-lo growth is **+64**, isolated against
`build_fix19_savebaseline.mjs`); kernel-hi **4,031/8,192 used** (**+100**, isolated the same way,
zero confound since the save subsystem has no kernel-hi footprint at all). Test scaffolding costs a
further **+50 kernel-lo / +125 kernel-hi** in the full (`build_fix17.mjs`) build, confirmed by the
same three-way arithmetic (7,844 full − 7,794 clean = 50; 4,156 full − 4,031 clean = 125) — never
shipped, excluded from every allowance above.

**Fixture fit check, the five real fixtures' kernel-lo free space, switchable-PRG boards only.**
`sample` (NROM, mapper 0, 1,024 bytes free) is **excluded** — NROM has no switchable PRG bank at all
and was never a streaming candidate (§1, §2: "NROM and the discrete-CHR boards keep today's hard
cut"). The remaining four are all real streaming candidates (`sample-rpg` and `sample-mmc1`: MMC1,
mapper 1; `sample-mmc3`: MMC3, mapper 4; `sample-u512`: UNROM 512, mapper 30) and are checked against
the **926-byte** mixed-project total above (the fullest case this ledger charges: streaming,
dialogue, Move, close-for-Save, flash save, and a mixed streamed/ordinary project, all at once) — no
per-mapper variance is modelled in this kernel-lo ledger (unlike CLAUDE.md's own
`BASE_KERNEL_CODE_BYTES_BY_MAPPER`, none of line items branch on the mapper id, only on
feature predicates). The driver's own corrected byte estimate (≈533, up from ≈140) is the largest
single contributor to the higher total; the close-for-Save and Move-boundary rows are
ISOLATED, real production deltas (above), not unisolated upper bounds — this worst-case total is
still conservative (the `script_op_save` dispatch check's own ≈8 bytes remains bounded, not
isolated), but far less padded with test scaffolding than the figure this table previously used:

| Fixture | Mapper | Kernel-lo free today | − 926 (this ledger, worst case, conservative) | Margin over `KERNEL_SLACK=20` |
|---|---|---:|---:|---|
| `sample-rpg` | MMC1 | 1,724 | 798 | **FITS**, 778 bytes to spare |
| `sample-u512` | UNROM 512 | 1,122 | 196 | **FITS**, 176 bytes to spare |
| `sample-mmc3` | MMC3 | 1,296 | 370 | **FITS**, 350 bytes to spare |
| `sample-mmc1` | MMC1 | 1,484 | 558 | **FITS**, 538 bytes to spare |

Every switchable-PRG fixture still fits the full, worst-case streaming kernel-lo allowance, but
**`sample-u512` is now the tightest fixture by a wide margin** (176 bytes to spare, down from the
previous table's own 568) — the driver's corrected byte cost lands here for real, since UNROM 512 is
also the board phase 2 targets first. Still comfortably above `KERNEL_SLACK`, and no board named here
needs the "move more to kernel-hi" fallback the brief asks for if the fit failed, but this is the
clearest evidence in this section that the driver's true cost narrows real headroom, not merely a
paper estimate. This is a fit check against **today's** free space in real, already-shipping
fixtures, not a guarantee for an arbitrary future project already spending most of its own kernel-lo
budget on unrelated content (a large item catalogue, many bound tiles, a big battle region) —
`checkCapacity`'s own per-project refusal (phase 1/2, unbuilt) is what enforces the real bound once
this feature ships, exactly as every other conditional allowance in CLAUDE.md's "The
kernel budget" already works.

**NMI re-timing: not needed for this ledger completion pass.** The work here is ledger/RAM-map completion,
glue-category sizing, and text consistency — no `.asm` source changed relative to the camera/OAM-barrier/containment work,
confirmed directly: `build_fix19_clean.mjs` applies the identical `nmi:` patch the camera/OAM barrier's own
`build_fix17.mjs` already proved and Mesen-timed (the `cam_dirty`-gated `$4014` DMA check), and
neither RAM-ledger additions (`sw_event_freeze`, the folded-in `sw_dlg17_*` table rows)
nor the glue-category estimates above touch NMI-side code at all — every new/revised kernel-lo line
item (the movement/camera driver, mixed-map prefix resolution, boundary-probe routing, the metadata
accessor) is mainline-only, per its own description. The Mesen figures therefore still
apply unchanged: worst chunk-3 strip-only MMC3 **137.0 cyc** / UNROM 512 **204.7 cyc**; mixed @35
bytes, reduced chunk 2, MMC3 **41.0 cyc** / UNROM 512 **105.7 cyc** — the tightest margin recorded
anywhere in this document, and what the frame-budget accounting below still derives its own worst
NMI cost (2,167 cycles) from.

**Placement is a real, reproducible build, not an argument.** The root cause of an earlier
relocation attempt's own corruption (a resident label resolving to a RAM-range address) was two
never-shipped, bank-14-only prototype routines (`sw_dlg_metatile`, a test-only bank-14 caller)
sitting interleaved inline inside the same source file being relocated wholesale — not an nesasm
multi-bank bug (nesasm's own `.bank`/`.org` state genuinely round-trips per bank correctly).
Splitting those two routines into their own file, kept at its original kernel-lo position, and
leaving the resident file with no `.bank` directive of its own, made the relocation work
immediately, confirmed by every functional/timing proof this document cites re-passing against the
relocated placement.

**Anything reached by a 6502 branch (not `jsr`/`jmp`) from code that stays in kernel-lo must stay in
kernel-lo too** — branches are ±128 bytes, so a routine split across the kernel-lo/kernel-hi
boundary by a stray branch would fail to assemble (a build-time-caught error, matching this
codebase's own "the assembler is the capacity check" philosophy). A clean split moves whole
routines only.

### The complete RAM map

**Resolved for real, completed**
— checked by script (`check_fix19_ram_ledger.mjs`, extending
`check_fix16_ram_ledger.mjs` wholesale rather than re-deriving it) against `engine/constants.asm`
plus the prototype's own equates, no overlaps, every address real. The `$C7` contention is settled:
`sw_axis_pref` keeps its already-documented `$C7`, and the dialogue overlay's own scratch —
dialogue's mapper/writer/attribute code plus the accessor, and the lifecycle bytes — each
shift up by exactly one byte from `dlg_fix12.asm`/`dlg_fix15.asm`'s own literal (untouched) source, to
make room. The lifecycle's own production footprint is **10 bytes, not 13**: `dlg_fix15.asm`
literally defines 14 ($F2-$FF), but only the first 10 are real lifecycle state
(`sw_dlg15_state`/`row`/`request`/`movepending`/origin ×4/`pubframe`/`closeackframe`) — the last 4
(`busy`, `oldgate_mode`, `typewhat`, `force_overrun`) are the negative control's own machinery and
pure test hooks, never shipped. **Two more resolved regions are added** (below): the camera/OAM barrier's own
17's own three production bytes (`sw_dlg17_camhold`/`move_close`/`resync_i`, disclosed but not
ledger-resolved) and the event-freeze flag (`sw_event_freeze`, which had
a kernel-lo code charge but no RAM assignment at all until now — an explicit
complaint).

| Bytes | Field | Address | Status |
|---|---|---|---|
| 12 | `sw_ns_row`/`col`/`nt`/`q`/`pb`/`cm`/`ai`/`row_lo`/`row_hi`, `sw_rw_shadow_lo`/`hi`, `sw_ns_chunk` — NMI-side strip-service scratch | `$BB-$C6` | Proven |
| 1 | `sw_axis_pref` — decision A's own "whichever axis was pressed most recently owns input" flag | `$C7` | Specified; still not written by any built code |
| 43 | Dialogue overlay scratch — the mapper/split-packet-writer/attribute-mask working set (`dlg_fix12.asm`'s own 43 bytes, shifted +1 from its literal `$C7` to make room for `sw_axis_pref`) | `$C8-$F2` | Proven (§7), address shifted for this ledger |
| 10 | Dialogue lifecycle, **production only** — `sw_dlg15_state`/`row`/`request`/`movepending`, origin ×4, `pubframe`, `closeackframe` (shifted +1 from `dlg_fix15.asm`'s literal `$F2`; excludes 4 test-only bytes, below) | `$F3-$FC` | Proven (§8), address shifted for this ledger |
| 1 | `sw_event_freeze` — the event-freeze policy flag (§5, Movement): **set** by interact dispatch the instant an event reached via the interact button finishes running within the same frame `dispatch_input` is still executing (streamed maps only); **read** by `update_player` before either axis's own movement/crossing logic runs that frame, nonzero skipping movement outright; **cleared** at `main_loop_idle` (the frame's own literal last mainline instruction, below), corrected from the wrong `dispatch_done` site (`dispatch_done` is `dispatch_input`'s own tail, which returns to `main_loop` before `update_player` ever runs that same frame, so clearing there was clear-before-read; `check_fix20_event_freeze_order.mjs` checks the real `engine/boot.asm`/`input.asm` call order this correction depends on) | `$FD` | Specified; real, reserved address, not yet written by any built prototype code |
| 1 | `map_is_streamed` — "the current map's own streamed flag," named once here (a runtime `Save` dispatch, a player-Move same-axis bound choice, and the capped-knockback map-mode branch, above, all read this same byte rather than three independently-invented ones): **set** at map entry/warp from a generated per-map table (the runtime twin of `map.streamed`); **read** by all three consumers named above, never re-derived per call site | `$FE` | Specified; real, reserved address, not yet written by any built prototype code |
| 1 | *(free — `$FF`)* | `$FF` | — |
| 4 | `sw_cam_origin_x_lo/hi`, `sw_cam_origin_y_lo/hi` — the camera's own world-space origin, `sw_project_axis`'s second argument | `$035C-$035F` | Proven (§7) |
| 2 | `sw_walk_acc_x`, `sw_walk_acc_y` — the per-axis subpixel accumulators (`sw_walk_step_x/y`) | `$03D8-$03D9` | Proven (§5) |
| 2 | `sw_dlg_cam_x_lo`, `sw_dlg_cam_y_lo` — the dialogue overlay's pre-nudge camera snapshot | `$03DA-$03DB` | Proven (§7) |
| 8 | `sw_dlg_ocol/olcol/orow/olrow` (persistent box origin) + `sw_dlg_rbrow/rscol/rlcol/rlrow` (transient resolve scratch) — `sw_dlg_metatile`'s own working set | `$03DC-$03E3` | Proven (§7) |
| 95 | The `sw_col`/`sw_row`/.../`sw_tmp6`/`win_col_screen`/.../`st_vary`/`ss_i`/`sbuf`(32)/`sw_ss_sc`/.../`sw_caller_bank`/`sw_run_off`/`sw_run_len`/`sw_rw_*`/`sw_fill_metatile_id`/`sw_rw_oob` chain, ending `sw_rw_oob = $05FE` | `$05A0-$05FE` (1 byte free to `$05FF`) | Proven (§6) |
| 256 | `attr_shadow` — the dialogue overlay's own attribute-byte shadow, **deliberately aliasing** `flash_driver` (the flash-save RAM staging buffer, `engine/constants.asm`) at the same address; a flash commit genuinely can run with a box open (below) — the alias is safe because the commit's own resync rebuilds `attr_shadow` before anything reads it again, not because the two are mutually exclusive | `$0600` (256 bytes; overlaps `flash_driver`'s own 160-byte `FLASH_DRIVER_MAX`, on purpose) | Proven (§7); ownership/lifetime rule below |
| 1 | `sw_dlg17_camhold` — a nudge/un-nudge publication hold is currently open, released at the end of the mainline frame that set it | `$07F0` | Proven (§7) |
| 1 | `sw_dlg17_move_close` — a close-for-Move draw-down is in progress, read by `ui_tick`'s own priority check and `text_close_attr`'s own patched tail | `$07F1` | Proven (§7) |
| 1 | `sw_dlg17_resync_i` — the save-resync's own row/band loop counter (deliberately not `X` — `sw_dlg12_open_row`/`open_attr` freely clobber it — and deliberately not `dlg_fix12.asm`'s own `sw_dlgw_col2`, which `sw_dlg_addr` uses internally for the identical reason) | `$07F2` | Proven (§7) |
| 1 | `sw_dlg20_save_pending` — a deferred Save's own real media commit and `script_resume` continuation are waiting for the close-for-Save draw-down to finish (the overlay reaching its drain-acknowledged closed state); set by `script_op_save`'s own patched tail, read and cleared by `main_loop`'s own per-frame completion hook | `$07F8` | Proven (§7) |

**`attr_shadow`'s own ownership and lifetime rule**: the prior
text's premise — "no save can complete while a box transaction is open, so the two consumers are
temporally exclusive by construction" — is false. `script_op_save` (`engine/save.asm`) runs *inside*
a suspended event's own continuation, the identical shape `script_op_move` suspends into (§7); a
`Say` reaching `BOX_ENDWAIT` and dismissed straight into a scripted `Save` command commits a flash
save with the box fully drawn, box-state machinery untouched by anything Save-specific — menu/save
*input* is blocked whenever `game_state != 0` (a player cannot *open* the save menu mid-conversation),
but that has never stopped a scripted `Save` command from running mid-conversation, on either the
ordinary engine or this one. A flash commit overwrites `attr_shadow`'s same page with its own
staging bytes the instant it runs, so its content is **invalid from that point until the commit's
own resync (below) rebuilds it** — real invalidation, not a race that resolves itself, and not
guarded by any temporal-exclusion property.

**Close-for-Save: the box is closed for real before a commit ever runs, never redrawn from state.**
A retained-content redraw was tried and rejected — `sw_dlg12_open_row`/`open_attr` draw the box's
own fixed border/background pattern, appropriate for a freshly-opened *empty* box, never the typed
glyphs, an expanded `{name}` token or a listed choice's own labels an actually-completed `Say` or
`Choice` left on screen; redrawing them in place after the fact silently lost whatever content was
there. The adopted rule is simpler and reuses existing, already-proven machinery instead of building
a second one: **on a streamed map, a scripted `Save` with a box up closes the box first — the same
drain-acknowledged close a scripted `Move` already gets (§7's own close-for-Move above) — commits
only once that close is acknowledged, then resyncs, then continues the script; a following `Say`
reopens through the ordinary pending-open path, from scratch, exactly as it does after a Move.**
Concretely: `script_op_save`'s own tail, reached after the record is written and checksummed (the
same order the header comment already requires — invalidate, identity, body, checksum, marker valid
— unchanged), checks whether the dialogue overlay reads `DLG15_OPEN_IDLE` (the one state a live Save
can actually interrupt, since `script_op_save` is reached from a suspended `Say`'s own continuation,
which never advances box drawing further). If so, it does **not** run the commit at all yet: it
advances `script_ptr` past `Save`'s own opcode (the identical "advance before suspending" shape
`script_op_move` already uses), sets a new flag (`sw_dlg20_save_pending`) and requests the overlay's
own ordinary close (`DLG15_REQ_CLOSE` — the exact request a player-initiated close already uses, no
new close mechanism), then returns to its own caller — suspended, exactly as a `Move` suspends with
`mv_left` set. `script_active`/`script_ptr`/`talk_ent`/`game_state` are therefore untouched by any of
this, the same invariant close-for-Move holds itself to, and for the identical reason: nothing in
this path ever calls `close_ui`. A new per-frame completion hook (`main_loop`, paired with the
existing close-for-Move gate) watches for the overlay reaching its drain-acknowledged `DLG15_IDLE`
state while a Save is pending; once it does, that hook runs the real, deferred commit
(`save_media_commit`) and then `script_resume`, continuing the page for real. If no box is up when
`Save` runs, nothing changes: the commit runs immediately, exactly as it always has.

**The dispatch itself is a runtime decision, not merely a compile-time one — `map_is_streamed`
(§7's own scripted-Move-boundary section names this same production byte) is what
`script_op_save`'s own deferral check and the per-frame completion hook both read, alongside the
existing compile-time `SAVE_FLASH` gate.** A mixed project — one with both streamed and ordinary maps
— assembles this mechanism's code once, behind `projectUsesStreaming`, but that code must not run for
a `Save` reached on the project's own *ordinary* maps: they share the identical ROM and RAM allocation
(`sw_dlg15_state`/`sw_dlg20_save_pending` exist for the whole project the instant any one map is
streamed, not per-map), so a compile-time gate alone cannot tell the two apart at the moment `Save`
actually runs. Concretely: `script_op_save`'s own tail checks `map_is_streamed` (set at map entry/warp
from the generated per-map table, the runtime twin of `map.streamed`) *before* it ever inspects
`sw_dlg15_state` — zero on the current map routes straight to the unconditional immediate commit,
byte-for-byte what `script_op_save` already does today, on every board, streamed project or not; only
a nonzero reading goes on to ask whether a box is actually open. **On an ordinary map in a mixed
project, `script_op_save` therefore behaves exactly as it does today** — the qualification finding 4
asked for, closing the gap between "gated on `projectUsesStreaming`" (a project-wide, compile-time
fact) and "unaffected on an ordinary map" (a per-map, runtime fact the compile-time gate alone cannot
establish). The per-frame completion hook (`main_loop`) needs no such check of its own: it only ever
acts on `sw_dlg20_save_pending`, a flag `script_op_save`'s own map-aware tail is the only writer of, so
it can never fire for a Save that took the ordinary-map path in the first place.

This is the **same generalised shape** close-for-Move already established — arm a flag the instant a
suspending command needs the box down first, let the ordinary close draw-down run to completion
under its own real timing, only then let the command's own effect (a walk; a commit) actually
happen — applied a second time rather than invented twice, though as two distinct flags rather than
one literal shared byte: close-for-Move closes the real, ordinary (non-streamed) box `script_op_move`
already suspends into, while close-for-Save closes the streamed dialogue overlay `script_op_save`
checks against (`sw_dlg15_state`) — the two still-disconnected box implementations §7's own "Not
built" paragraph already discloses. Unifying them into one literal flag is production wiring's own
job, once a real `Say` on a streamed map is connected to this overlay at all; until then, honestly
naming two instances of the identical pattern is more accurate than forcing one flag to mean two
different things.

**The resync, rebuilt: terrain, attributes, OAM and scroll, all before rendering resumes — no box
redraw at all.** `screenAttributes` (`main/build/generate.js:1980`) is a **JavaScript build-time
generator function** — it cannot execute once the ROM exists, and streamed records carry no baked
per-screen attribute table for it to populate from in the first place. The real runtime
attribute-population path is `sw_render_window`'s own attribute pass (§6's `sw_rw_read_metatile`,
feeding both the terrain and attribute probes, in **physical ring coordinates**, never authored
screen coordinates) — the same routine every other resync in this document (a teleport, a map/door
warp, a battle return) already uses. The resync, called from `save_media_commit` in place of the
plain `jsr enable_rendering` tail and still fully inside its `php`/`sei`/`$2000=0`/`$2001=0` bracket,
now does three things in order, all before rendering resumes: (1) `jsr sw_render_window` at the
window's own **unchanged** origin — the ring's resident content was never touched by the commit
(rendering was off; nothing but `flash_driver`'s own RAM page was written), so this is a real cost (a
full redraw), never a correctness risk, and it rebuilds `attr_shadow` as a side effect of rebuilding
the physical nametable/attribute bytes; **there is no longer a second step redrawing the box** — the
overlay is already genuinely closed by the time this ever runs, so there is no box content left to
draw back in, and the branch that used to attempt it does not exist in the current build, not merely dead code kept for
show (§4). (2) **every OAM pass an ordinary frame runs before its own DMA, not merely the first two**:
`build_oam`, `draw_entities`, and — matching `main_loop_draw`'s own real, unconditional order
(`engine/boot.asm`) — the conditional `draw_hud` (skipped only under `BATTLE_ENABLED`, irrelevant to
a streamed map's own action-only save path) and `draw_ui` (draws the frozen-world menu/dialogue
overlay on top, when one is open — a live inventory menu can coexist with a scripted `Save` exactly as
a live dialogue box already does, §4's own `attr_shadow` paragraph). Calling only `build_oam`/
`draw_entities` — an earlier draft of this resync did — is not a general promise that every relevant
sprite is rebuilt: a project with `ITEMS_ENABLED` and the menu open during a scripted Save would
resume showing a stale (or entirely absent) menu overlay otherwise. The ordinary `$4014` DMA (the
identical mechanism `nmi:` uses, safe to call directly here since NMI is genuinely off for this
routine's entire body) then publishes the complete, fresh shadow — required because rendering has
been off for the *whole* commit-plus-resync transaction, not merely narrowly bracketed around a
two-byte write, so "OAM does not decay while rendering is on" does not excuse leaving a stale shadow
(or a stale published OAM) for whatever comes back on next; nothing else in the whole transaction
reads or writes `$0200`, so without every one of these passes the very first rendered frame after a
Save would show OAM left over from before the commit began, a stale menu included. (3) the PPU scroll
registers are re-published from the **unchanged**
`cam_x_lo`/`cam_y_lo`/`cam_nt` — `enable_rendering`'s own hardcoded `$2000=PPUCTRL_ON`/`$2005=(0,0)`
reset would otherwise snap the screen to the world origin, discarding whatever camera position was
actually held (by the time this runs, the close-for-Save un-nudge above has already restored it to
its pre-open value, the identical acknowledgement-time restore the barrier's own reconciliation
established), the identical hazard `camera_slide_tick`'s own boot-up snippet (`engine/camera.asm`)
already works around by writing the real scroll pair instead of relying on that default. "No nudge,
no pending phase, camera untouched" (§7) means exactly this: the camera *value* never changes, only
its publication to hardware is repeated because `enable_rendering` would otherwise have clobbered it.

**Battery-backed boards (MMC1/MMC3) never close anything and never touch `$0600` at all** —
`save_media_commit`'s `.if SAVE_FLASH` body, close-for-Save's own deferral included, is flash-only;
on those boards the record is written directly into always-mapped SRAM (`save_write_body`), the
commit is instantaneous (no forced-blank erase/program cycle at all), and the box simply stays
exactly as it was, no close and no resync needed because nothing was ever invalidated. This is a
deliberate divergence, not an oversight left for a later "unify the two boards" pass: closing the box
unconditionally, on every board, would be the simpler *rule* to state, but it would also cost every
battery-board project an unnecessary ~10-frame box-drop (the close draw-down alone — a battery
board's own commit is instantaneous either way, so unifying would add only the close, never the
flash-specific wait the felt-effect bullet above discloses) for a save medium that never needed one —
a real, felt, unjustified cost with no correctness benefit, exactly the kind of charge CLAUDE.md's own
"a project never using a feature assembles as if it didn't exist" rules out. The rule is therefore
gated on the save *medium* genuinely invalidating something the box depends on, not on the *command*
alone — one simple, justified rule, not a simpler-sounding one that overcharges two of the three
supported boards. **A non-streamed map is unaffected either way**: every part of this mechanism lives
behind `projectUsesStreaming`-gated code (`sw_dlg15_state`/`sw_dlg20_save_pending` do not exist on an
ordinary map), so an ordinary project's own `script_op_save` stays byte-for-byte what it already is.

Proven directly (§9): a real `script_op_save` call, with the streamed dialogue overlay genuinely
`OPEN_IDLE` and holding real typed content (five real single-tile writes through the same real
`sw_dlg12_write_tile` primitive an earlier trace already proved lands at the mapped address —
a disclosed stand-in for a `Say`'s own typewriter, since a real `Say` is not yet wired to this
overlay, the identical disclosure already made elsewhere in this document), and `$0600` genuinely clobbered
immediately beforehand: the commit is genuinely deferred (`sw_dlg20_save_pending` stays set, and the
box stays visibly open, for every one of the real frames the close draw-down takes); the box closes
for real, drain-acknowledged, and the typed content is genuinely gone by the time it does (overwritten
by real field content, not preserved in place); only once closed does the real commit run
(`SAVE_MARKER` becomes valid and `attr_shadow` regenerates only at that point, not before); OAM is
rebuilt fresh and DMA'd, matching the current camera, before rendering resumes; the script continues
for real past `Save`; and a following open reaches `OPEN_IDLE` again through the ordinary pending-open
path, with fresh content typing cleanly into it. A separate, shorter confirmation runs the identical
sequence at a non-zero, seam-crossing camera origin (20 nudging to 16, `seamx(16)=30`), proving the
mechanism is not specific to a trivial (zero, no-op) nudge. A negative control
(`sw_dlg20_oldresync`, reverting `script_op_save` to the pre-round-20 immediate-commit path and the
resync to its own deleted box-redraw branch) reproduces the original defect exactly, through the same
real call chain: the commit runs immediately with the box never closed, and the typed content is
lost, overwritten by the empty open-box frame — the script itself still finishes normally, since this
defect is about the box's own displayed content, not a stranded script (finding 3's own separate
concern, below).

**The camera/OAM barrier's three bytes, ledger-resolved for real.** `sw_dlg17_camhold`,
`sw_dlg17_move_close`, and `sw_dlg17_resync_i` are all real, production-shaped state, folded into the
table above at `$07F0`-`$07F2` (RAM's own top page, clear of `save_flash_buf`'s real
`SAVE_RECORD_LEN=127` bytes at `$0700-$077E` for this project — checked numerically by
`check_fix19_ram_ledger.mjs`, not merely asserted disjoint) rather than the zero-page gap: each is
read at most once per mainline frame from a routine that already pays a `jsr` to get there
(`sw_dlg17_camrelease`, `ui_tick`'s own dispatch, `save_media_commit`'s own tail), so the cheaper
zero-page encoding buys nothing there worth spending the gap's own last bytes on. Three more bytes
(`sw_dlg17_stall_a`/`_b`/`_d`, the targeted interruption checks' own forced-overrun triggers) and
`sw_dlg17_teststart`/`sw_dlg17_oldbarrier` are test-only, never shipped, the identical distinction
an earlier distinction between `sw_dlg15_busy`/`oldgate_mode`/`typewhat`/`force_overrun` already drew.

**The production byte `sw_dlg20_save_pending` folds into the same `$07xx` page** at
`$07F8`, immediately after the camera/OAM barrier's own three — read at most once per mainline frame (the
per-frame completion hook), the identical "no benefit from the cheaper zero-page encoding" reasoning
above. Two more bytes adds — `sw_dlg20_oldresync` (item 1's own negative control) and
`sw_dlg20_nocrossclamp` (item 3's own negative control) — are test-only, never shipped, at `$07F9`
and `$07FA`.

**`sw_event_freeze`, now assigned an address** (a code charge with
no RAM assignment). Placed in the zero-page gap, not the `$07xx` page: unlike the three bytes above,
it is read every frame in a genuine hot path (`update_player`, before either axis moves), so it earns
the cheaper zero-page encoding while the gap still has a free byte to give it. Its full lifetime is
stated once, in the table row above, in CLAUDE.md's own "a conditional feature's cost is a separate
generated allowance" style (set/read/clear, per frame, streamed maps only).

**Zero-page gap, `$C7-$FF`: 56 of 57 bytes used, 1 free (`$FF`)** — resolved, completed here.
Of the 3 bytes once free (`$FD-$FF`), `sw_event_freeze` took the
first (`$FD`); `map_is_streamed` (§7/§4) takes the second
(`$FE`) — the identical "read every frame/hot path, cheap encoding" reasoning `sw_event_freeze`
already earned. `sw_dlg17_camhold`/`move_close`/`resync_i` still do not fit
here and remain at `$07F0`-`$07F2` (above) — the gap's own remaining 1 byte is free for a future
single-byte flag, not for any of this document's own currently-specified state.

## 5. Runtime

### The torus and window

Physical position in the resident 32×30-block ring is a pure function of a metatile's own
**absolute** `(screenCol, localCol)`/`(screenRow, localRow)`: because a screen (16×15 metatiles) is
exactly half the ring on each axis, the screen's own row/column parity selects the physical half
(even → first half, odd → second), and the position within that half is `2×local`. This is exact,
not approximate, and is what makes the ring's own defining retention property hold: drawing the
entering edge at its own computed physical slot can never disturb any other slot's content, because
that computation never depends on where the window currently sits.

The **window** (the logical torus the resident ring currently represents) is addressed in
`(screen, local)` terms, tracked block-granular via a physical ring origin
(`sw_rw_wbase_col`/`row`) that a full redraw or an incremental strip converts a torus position
against, wrapping, before decomposing it into a physical nametable cell — the missing half of
FALLEN STAR's own `modx`/`mody` this project's addressing needed and now has, proven at both
parities (even/even and odd/odd window origins) and confirmed by direct VRAM readback across two
successive streaming operations that a strip's own new content never disturbs an already-drawn
column's own bytes.

**The window-viewport clamp is not one bound — it is three, applied independently (Chris's own
fill-metatile decision, §1):**

1. **The window/viewport clamp** (`sw_clamp_col`/`sw_clamp_row`) keeps the resident ring's own
   origin inside a map **at least as big as the window on that axis** — `[0, gridSize-2]` screens,
   exact (not approximate) because the window's own far edge is always exactly 32 (or 30) blocks
   from its origin and a screen is exactly 16 (or 15) blocks. This clamp engages only on an axis
   where the map's own extent exceeds the window's.
2. **The terrain-padding bound** (`sw_terrain_or_fill`) checks the resolved `(screenCol, screenRow)`
   against the map's own `sw_grid_w`/`sw_grid_h` **before any bank switch is attempted**, in both
   directions at once (an unsigned compare catches a wrapped-negative coordinate the same way it
   catches one past the far edge), substituting `sw_fill_metatile_id` whenever either axis is out
   of range — a map smaller than the window on some axis, or a window origin near a large map's own
   far edge, both resolve through the identical check. `fillMetatileId` is an ordinary metatile
   reference on the map's own tileset, refused by the same out-of-range check any other metatile id
   already fails.
3. **The collision/probe bound**: a neighbour outside the authored grid is a **wall**,
   unconditionally, non-mutating (no bank switch, no `sw_goto` call at all) — distinct from the
   window clamp, since a column that is a legal *neighbour* to probe (real content, real bank) can
   sit outside the window clamp's own maximum-origin bound on a map narrower than the window.

**One-high/one-wide maps are explicitly in scope**: the window clamp never engages on the
degenerate (size-1) axis, the terrain-padding bound supplies fill for every row/column beyond the
single legal one, and collision treats anything beyond it as a wall. A map exactly the window's own
size on an axis (32 blocks = 2 screens wide, or 30 = 2 tall) permanently fixes the window's own
origin at 0 on that axis (nothing to re-render) but the **camera does not freeze** — it still
clamps to the map's real pixel extent, which on this axis is one screen wider/taller than the fixed
viewport. A map smaller than the window on an axis fixes the window at 0 **and** freezes the
camera, since the map's own pixel extent no longer exceeds the viewport at all.

**The camera clamp, one formula for every case**: `cameraOrigin = clamp(desiredOrigin, 0,
max(mapPixels - viewportPixels, 0))` per axis, where `mapPixels` is the map's own authored extent
(`gridW × 256` or `gridH × 240`) and `viewportPixels` is the fixed 256/240 — independent of
whatever the *window's* own origin currently is. The two-nametable dead axis (phase 3) is this same
rule at its one-screen-deep authoring restriction, needing no special case: one screen deep exactly
equals that axis's own ring capacity, so it is simply the "map exactly the window's own size"
case above.

### Frame order

`main_loop` begins with `jsr wait_vblank` (`boot.asm:114-115`), so the real per-iteration order is
**NMI(n) service, then mainline(n) update/crossing/arm, then NMI(n+1)** — never the reverse, and
never both in the same vblank. Concretely, for mainline iteration *n*: **(1) NMI(n) service** —
this is the vblank `wait_vblank` just returned from; if a strip is active, it advances by whichever
chunk was decided by iteration *n-1*'s own work (the compiled chunk, or a reduced chunk if a small
queue is also draining, below); **(2) mainline(n) update** — the currently-owning axis's own
accumulator advances, and a completed 16 px crossing changes that axis's own `desired` position by
exactly one block, clamped; **(3) mainline(n) arm** — only when idle (including idle because
NMI(n) just completed a strip this same iteration), and only if `desired != current` on some axis
(X preferred on a tie), `current` moves by exactly one block toward `desired` and a fresh strip is
armed for that entering edge. **An arm made during mainline(n) is first serviced at NMI(n+1), never
NMI(n)** — NMI(n) already ran, at the top of this same iteration, before the arm existed. This
closes the prior contradiction (a newly armed strip cannot both "begin service" and "not be
serviced" in the same vblank): it simply is not serviced yet, full stop, until the next NMI.

**Flash's own arm/push relationship has the identical one-iteration lag, confirmed against the real
engine.** `flash_tick` runs early in mainline(n) (before dispatch), so it only ever sees the
Flash state as it stood at the *end* of iteration n-1 — an event that arms Flash during mainline(n)
(after that iteration's own `flash_tick` call has already run) is invisible to `flash_tick` until
mainline(n+1), which is the iteration that actually queues the on-edge push NMI(n+2) will drain.
`measure_f14_interact_flash.mjs`'s real-engine trace confirms this exactly: the arm frame
(`flash_left` 0→7) publishes nothing (`vram_len` stays 0); the very next frame's `flash_tick`
performs the push. The NMI arbitration's mixed-vs-exclusive decision for a given vblank is
therefore always based on what the *previous* mainline iteration's `flash_tick` queued, never the
current one's.

`sw_nmi_stream` publishes a completed strip as safe to scroll past; the camera/viewport's own
continuous position (item 12's existing register) is a separate concern this window-origin
bookkeeping never touches directly. **Publication is coherent**: the window origin's own multi-byte
updates (a resync, a crossing that moves both the origin and the ring state) are guarded by
`cam_dirty` exactly as item 12's own `redraw_screen_slide` already guards its multi-field
publication, so NMI never applies a half-written combination.

**Signed desired/current origin, the corrected centred-window geometry, guard measure, guard
threshold**: `desired`/`current` per axis are signed, flat (never torus-wrapped — only the
physical-ring addressing wraps, at draw time), and `desired` is a **pure function of the player's
own continuous signed position**, recomputed fresh every frame — never a separately incremented
counter. That correction matters: an incrementing counter driven by unsigned crossing *magnitude*
(the prior model) reads 8 px forward then 8 px back as a full completed crossing despite zero net
displacement, and needs a full 16 px in the new direction before a reversal exactly at a boundary
crosses back — both wrong. Deriving `desired` straight from position fixes both: forward-then-back
nets out exactly, and a boundary reversal crosses on the very next pixel.

**The window is centred on the camera, not one-sided.** FALLEN STAR's own shape
(`world_stream.asm:137-159`), generalised to this project's asymmetric axis costs:
`desiredWinX = clamp(camBlockX - 8)`, `desiredWinY = clamp(camBlockY - 7)` — a **fixed offset**,
applied regardless of travel direction, where `camBlock` is the viewport's own leading (world
position sitting at screen column/row 0) edge in blocks. This is not "the viewport occupies the
window's first half" (the prior, wrong claim, margin only ahead, none behind): on X the 32-block
window and 16-block viewport split their 16 spare blocks 8-behind/8-ahead of the viewport,
symmetric; on Y the 30-block window and 15-block viewport split their 15 spare blocks 7-behind/
8-ahead — FALLEN STAR's own number for this exact geometry, restored rather than the flat 8/8 the
prior text guessed.

**The valid-content invariant is now checked as real geometric containment, not inferred from a
lag scalar.** `abs(desired - current)` — the prior check — never
computed what the viewport actually shows: at X camera pixel 257, window origin 0, desired 8, it
reported margin 0 ("accepted"), but the viewport (256 px wide) starting at pixel 257 ends at pixel
512, block 32 — one block past the window's own last resident block (31). The corrected check
computes two real rectangles every frame and asserts the first is a subset of the second, both axes,
both sides:

1. **The visible block rectangle**, from the *camera's own pixel-precise position* — a value
   distinct from the block-granular `current`/`desired` the arm scheduler tracks, clamped
   independently: `camPx = clamp(playerPos - centre, 0, mapPixels - viewportPixels)`, `centre = 120`
   (X) / `112` (Y) — FALLEN STAR's own `playerX-120`/`playerY-112` convention
   (`data.asm:1109-1115`), the offset that centres a 16 px-wide player sprite in a 256/240 px
   viewport (`(256-16)/2=120`, `(240-16)/2=112`). Visible range: `[floor(camPx/16),
   floor((camPx+viewportPx-1)/16)]` — the fine-scroll partial edge included by construction, since
   this is real division, not a block-rounded proxy.
2. **The conservative completed-content rectangle**, from the window's own `current` (block
   origin, `win` blocks wide) and whether a strip is presently servicing this axis: normally
   `[current, current+win-1]`, fully valid; while a strip is in flight on this axis, the **entering
   edge is excluded** (not valid until its last chunk is drawn) — the high edge if the window is
   advancing in the positive direction, the low edge if negative. The block the strip's own draw
   physically overwrites on the ring (the old trailing edge) needs no separate term: `current`
   already excludes it from the window's own range the instant it advances past it, so excluding
   the entering edge alone models both halves of "on arm, one edge is not valid yet and the
   opposite edge starts being overwritten."

**A real, previously undetected bug was found deriving this**, not assumed away: `desired`'s own
accepted formula computed `blockOf(playerPos) - margin` directly off the
player's raw block position — silently substituting it for `camBlock` (the camera's own low edge
in blocks), which the contract's own fixed formula (`camBlock-8`, `camBlock-7`) has always
literally named. Because `camBlock = floor((playerPos-centre)/16)` is not the same value as
`floor(playerPos/16)` (they differ by up to one block depending on the sub-block remainder), the
substitution left as little as **0 blocks** of real margin at its tightest remainder under true
containment — not the intended, designed-in 7-8 block buffer FALLEN STAR's own margin split
exists to provide. Routing `desired` through the real `camBlock` (via the identical `camPx` clamp
the visible rectangle already computes) restores the intended buffer exactly: this is a fix to the
*model's* own approximation of the fixed formula, not a change to the formula, and every exercise
below (`diag_f18_scheduler.mjs`) re-passes under the corrected derivation with real, comfortable
slack (5-7 blocks under the 7-8 block hard limit, in every ordinary-gameplay exercise: held axes,
turning, reversal at both signs of backlog, map clamps, both Flash workloads at five press periods
plus an irregular one, capped knockback in all four directions, an already-active strip at the
instant the guard fires) — never merely a lag scalar staying low.

**The resync guard, specified once, here**: flat **6** — see "The position-jump guard" below for the
guard's own full mechanism and proof. Under true containment, the guard fires with the visible
rectangle sitting **exactly flush against the valid-content boundary (0 blocks of margin, never
negative)** at the instant of detection, in every direction, with and without an in-flight strip on
the same axis. The guard's own safety therefore depends entirely on its detection-then-resync
response actually suppressing publication for as long as the real redraw takes, not on a
pre-existing buffer — proven directly: the identical forced jump with the resync response *disabled*
and the player continuing to walk afterward genuinely diverges into containment violation, while the
SAME jump with the resync response active never does, in any of the four directions, with or without
an in-flight strip, at any redraw duration (see "The position-jump guard" below).

**Reversal is finish-the-in-flight-strip, never cancel or replace.** `current` only ever advances at
arm time, gated on idle, so an in-flight strip represents a crossing that has already physically
happened; a later reversal simply queues its own opposite-direction demand, serviced once idle. The
per-axis accumulator is magnitude-only (it never reads direction), so a reversal costs the scheduler
nothing a same-direction hold would not also cost.

**NMI arbitration**: a single branch, decided before `vram_drain` is even called (no saved flag
needed across it), on the published queue's own size. **The literal claim "never both a drain and a
chunk in the same vblank" does not hold universally — the mixed branch below contradicts it outright**, and
stating both together would be a contradiction. What is actually true: a
queue at or under `MIXED_VBLANK_MAX_BYTES = 35` bytes (one real packet) **both** drains **and** lets
a reduced strip chunk advance the *same* vblank (`SW_STREAM_MIXED_CHUNK`, sharing the unmodified
strip-draw body, armed with a smaller chunk); a queue larger than that (only ever built while the
world is frozen, so it never actually competes with a live strip) takes the **exclusive**-drain
path, and only *there* does the old "never both" description hold. `vram_ready`/`vram_len` are
cleared by the same single drain call either path takes — nothing is ever deferred, so a producer's
own "the next NMI already drained it" handshake (Flash's `flash_tick_confirm`) is never broken by
this branch. Chunk 3 is the ceiling under exclusive arbitration on both measured boards; the
mixed-vblank reduced chunk is 2 on both boards.

**The publication premise, stated explicitly:**
`main_loop_ready` (mainline) publishes the queue — its last store sets `vram_ready = 1` — and then
`main_loop` immediately loops back to `jsr wait_vblank`; no producer runs, and therefore nothing can
append to `vram_buf`, between that publication and the NMI that drains it. A published queue
therefore can never grow past whatever it held at the moment `vram_ready` was set — this is why the
branch above may safely decide "small vs. large" from `vram_len` alone, read once, before calling
`vram_drain`: the value cannot change out from under it. **`MIXED_VBLANK_MAX_BYTES = 35` is the
mixed-service eligibility threshold for the moving world — it is not a claim that 35 bytes bounds every queue this document produces.** The dialogue
overlay's own split-at-seam packet writer genuinely can, and does, queue more than one real packet
for a single transaction — a split 32-tile terrain row is **38** packet bytes (§7), above the
threshold — and it coexists with Flash (both are real `vram_buf` producers). A queue over 35 bytes
simply falls back to the **exclusive**-drain path above (only ever built while the world is frozen,
so it never actually competes with a live strip for THIS engine's own producers, dialogue included:
opening/closing a box already freezes the world for the whole transaction) rather than being
disallowed — the existing exclusive-drain boundary (unrelated to this feature, proven up to 175/210
bytes per board, §7) is what actually bounds a queue that large, not 35.

### Movement

Two per-axis subpixel accumulators, FALLEN STAR's own `WHOLE_STEP` plus an accumulator that carries
one extra pixel on overflow, duplicated per axis because the two axes need different rates here:
**`SW_SPEED_SUB_X = 128` (1.5 px/frame)**, **`SW_SPEED_SUB_Y = 112` (1.4375 px/frame)**. 4-way
exclusive input (`sw_axis_pref`): whichever axis was pressed most recently owns the accumulator for
as long as both remain held, masking the other axis's pad bits out; releasing the winning axis hands
ownership back to whichever is still held; a simultaneous first press from idle gives X the tie
(stateless, re-derived from the pad state alone, needing no stored byte). No diagonal movement, and
dash never applies on a streamed map — `sw_walk_step_x/y` never read `PLAYER_SPEED`/`dash_on` at
all while a streamed map is current.

**The scheduler closes under every legal workload measured, at the corrected signed-position model
and the real NMI(n)→mainline(n)→NMI(n+1) frame order (`diag_f14_scheduler.mjs`, superseding the
prior round's own model, whose unsigned crossing counter and one-sided window geometry were both
real bugs — see above)**: held single-axis walking, either direction, never exceeds 0 blocks of
lag over a 2,000,000-frame hold; turning onto the other axis every block stays at lag ≤ 1 (worst
fixed cycle swept, `nX=nY=1`); reversing mid-strip at 1/2/3/5 crossings between reversals stays at
lag ≤ 1 on both axes; walking into a map clamp edge never spikes lag. Every exercise also asserts
viewport validity **directly** every frame (containment against the derived per-direction margins
above), not only the lag scalar. **Knockback is capped at 8 px** (`KNOCKBACK_SPEED` cut from 3 to 1
px/frame on a streamed map only, `KNOCKBACK_TIME` unchanged at 8 frames), repeated every legal
`IFRAME_TIME=60`-frame cooldown forever: **lag stays exactly 0 on both axes** under the corrected
model — the 8 px cap does not merely keep repeated knockback under the guard, it removes the
knockback workload as a lag contributor at all, so the old "accepted, rare backstop" exception for
an adversarial repeated-knockback case no longer has a case to except (§ below, "The position-jump
guard"). **A scripted `Move` on a streamed map is not exempt** — it calls through the identical
accumulator, so it can never exhaust the window's own margin faster than the player's own held
movement already cannot.

**Flash's own worst legal recurrence is bounded for every trigger shape the engine's rules permit,
not only the touch corridor — including a workload the prior round's own model excluded
entirely: repeated *interact*-triggered Flash re-arms, which have no touch-style freeze credit on
the unpatched engine at all.**

`dispatch_input` → `do_action_interact` → `do_talk` → `start_dialog` runs *inside* `dispatch_input`
itself, never through the `settle_owed`/`pending_ent` gate a touch or entry event uses — so a
`[Flash]`-only page reached by interact finishes synchronously (`script_finish` → `box_close` →
`close_ui` restores `ST_GAMEPLAY`) with `game_state` already back to 0 by the time `dispatch_input`
returns, and `update_player` runs that same frame. Measured against the real, unpatched engine
(`measure_f14_interact_flash.mjs`, holding a direction while mashing the interact button at the
fastest period `input.asm`'s own edge detector allows — release one frame, press the next, the
true minimum since `pad_new` needs a fresh 0→1 transition): **zero frozen frames while in reach of
the actor** (170 frozen frames were observed over the whole 400-frame run, but all outside the
actor's reach window, from ordinary screen-edge/crossing churn unrelated to Flash); the fastest
observed arm-to-arm recurrence is exactly **2 frames**; and re-arming an active burst confirms the
prior round's own source-level finding by direct execution — `flash_left` jumps straight from a
mid-hold value back to 7 with no restore edge ever queued for the interrupted burst (9 of 10
observed re-arms). An `enter`-triggered Flash (screen-entry) was also traced and behaves exactly
like touch's own already-proven one-frame freeze (`measure_f14_interact_flash.mjs` scenario B),
confirming entry-plus-touch on one screen raises no interaction the existing touch proof does not
already cover.

**The chosen policy: on a streamed map, a frame in which an event ran is a frame the player does
not move** — the interact path gets the identical one-frame freeze the touch/enter path already
has structurally, via `settle_owed`'s own gate; a single flag checked before `update_player`,
streamed maps only, so every existing (non-streamed) fixture stays byte-for-byte identical. This is
not merely disclosed as closing the gap — it **overcloses** it: modelled against the real engine's
own rules (`diag_f14_scheduler.mjs`, exercise 5b, immediate arm+freeze in the same iteration
dispatch runs in, matching interact's own no-latency dispatch path exactly), a continuous
period-2 mash while walking, bounded to the real ~20 px-either-side reach window a single actor
offers, holds **lag exactly 0 on both axes** — identical to the no-Flash baseline, not merely under
the guard. The mechanism is arithmetic, not incidental, and follows the same one-iteration lag
established above (frame order): on the frozen (arming) frame, that same frame's own `flash_tick`
call already ran, using the *prior* iteration's state, before the freeze/arm decision — so its NMI
draws whatever the prior iteration queued (typically nothing), a **full**, unmixed chunk against
**zero demand** (the frame is frozen, nothing moves). The first *moving* frame after it is where
`flash_tick` finally sees the arm and queues the push — but that push is not itself drained until
the following NMI, which (at the period-2 mash rate) coincides with the *next* re-arm's own frozen
frame: the reduced (mixed) chunk lands on a frame that is **already contributing zero demand**,
never on an ordinary moving frame. Every interact re-arm is therefore a net *service surplus*
against demand, not a deficit — the reverse of the touch corridor's own tight-but-closing balance,
where the mixed chunk lands on a frame that IS moving. A direct
negative control (the identical mash, same reach-bounded window, but with the arm **never**
freezing movement — the unpatched engine's real behaviour) still stays bounded at lag ≤ 1 in this
reach-limited form, but an **unbounded** version of the identical no-freeze mash (no reach gate,
sustained indefinitely) diverges hard: lag reaches the resync guard by frame 634
(`diag_f14_scheduler.mjs`'s own negative control (b)), confirming the rate math (2.5
blocks/vblank service against a 2.875 blocks/frame Y demand) describes a real divergence, not a
false alarm — it is the reach-boundedness *and* the freeze policy together that the real engine
already guarantees; the freeze policy is what makes the safety margin large rather than merely
adequate.

**The general bound behind the policy, checked across press periods, not only the regular
period-2 mash.** "Every mixed chunk lands on a frozen frame"
is only literally true at the fastest, perfectly regular period-2 alignment; the general claim the
policy actually relies on is weaker but sufficient: a freeze removes a whole frame of movement
demand outright (a net service surplus, never a deficit), and an unfrozen mixed-chunk frame — a
push landing on a moving frame instead of a frozen one, which only becomes possible once the press
period is long enough that `flash_tick`'s own one-iteration arm/push lag stops aligning with the
next freeze — costs at most `CHUNK - MIXED_CHUNK = 1` block of reduced service, and the same
reach-bounded window (an actor can only be re-triggered while the player stays within ~20 px of it)
means this can recur at most twice before the actor is out of reach again. Checked directly, not
merely quoted: press periods 2, 3, 4, 5 and 7, plus an irregular non-constant gap pattern
`[2,5,3,7,2,4,6,3]`, all held under true containment (§5) at `lagMax ≤ 1` on both axes
(`diag_f18_scheduler.mjs`), matching the bound's own prediction rather than the narrower
period-2-only claim. **A scripted `Move` on a streamed map is the explicit exception** to the
broader "an event ran means the player does not move" wording — a Move calls through the identical
accumulator itself, so it is the player's own movement, not a frame the freeze policy needs to
apply to.

Combined workloads were also exercised together, not only in isolation: a touch corridor
(`MAX_ENTITIES = 8` per screen caps how many of any 16/15 consecutive crossings can carry a
touch-triggered `[Flash]`-only actor) *and* a separate interact-mash actor further down the same
walk holds **lag ≤ 1** on both axes over 5,000,000 simulated frames (`diag_f14_scheduler.mjs`
exercise 5c). The touch corridor alone, at the restored FALLEN STAR speeds with the real one-frame
freeze credited and the real 8-per-screen cap enforced (both `clustered` and `spread` placements):
**lag ≤ 1** on both axes over 10,000,000 simulated frames, including a labelled beyond-legal
unbounded-corridor stress case (lag 0) — comfortably under even the tighter 7-block Y-up hard limit.
No walking-speed reduction is needed for any of these cases to close.

**Mainline arm cost, charged to a single frame, never sustained — measured at the real worst
reachable case, not only near the origin.** The near-origin 3×3 figures already measured
(`sw_stream_start_col` 3,911 cycles, `sw_stream_start_row` 4,077 cycles) are real but not worst-case:
they use an aligned entering edge and low bank/region indices. The true worst case
(`diag_f14_worst_arm.mjs`) combines an **unaligned entering edge spanning three screens** (not two —
the relocate cache starts invalid, so every one of the three triggers its own cold `sw_goto`) with
the **largest reachable bank/region index** (UNROM 512's own 61-region ceiling, confirmed reachable
under the real `gridH × ceil(gridW / STREAM_SCREENS_PER_REGION) ≤ 61` packing formula, not assumed):
`sw_goto`'s own row loop (`sw_goto_rowloop`) costs *linearly* in whatever row value it is handed on
every relocate call, so a near-origin measurement structurally cannot see this term at all.
Measured: **`sw_stream_start_col` 7,365 cycles (24.7%)**, **`sw_stream_start_row` 7,668 cycles
(25.8%)** — both orientations, both real reads across all three screens (a fill-aware tail variant,
where the map's own authored grid ends one screen short, costs less, 4,014 cycles, confirming fill
is cheaper as designed, never the worst case). Paid once on the single frame a crossing arms a
strip (once per 10-11 frames), never every frame.

**The full-frame bound — a corrected, complete accounting,
not the prior subtotal.** The prior "65.8%, 34.2% to spare" figure combined the worst arm with an
*ordinary*-engine busy-frame measurement that both used a flawed classifier and omitted everything
streaming itself adds to the mainline. Both are fixed here.

*The classifier fix.* `diag_f14_busy_frame.mjs` classified "ordinary" (non-redraw) samples with
`sorted.filter(v => v < 10000)` — a cycle-count cutoff that discarded any genuinely ordinary frame
over 10,000 cycles **by construction**, which cannot establish an upper bound. `diag_f18_busy_frame.mjs`
classifies by **executed path** instead: every crossing stub (`cross_left/right/up/down`) reaches
`redraw_screen` by an unconditional `jmp`, so watching whether the mainline body's own PC lands on
`redraw_screen` — not an elapsed-cycle threshold — correctly separates the two classes. Re-run
against the ACTUAL busiest legal scenario this engine can produce (not 7 filler NPCs): all 8
`MAX_ENTITIES` slots are chasers with contact damage (the most expensive AI this engine has,
`entity_chase`, plus a live heart-HUD redraw), a Shake and a Flash both triggered and ticking, and
music playing an authored long Sfx note (`music_tick`'s own `SFX_CHANNEL` diversion, not the
ordinary per-channel tick) — every real per-frame cost category this document's own engine section
names, combined on the busiest real frame this engine reaches. (This engine has no projectile
mechanic — grep-confirmed across `engine/`, `shared/`, `main/` — so that named category is not
applicable, disclosed rather than silently dropped.) Result: **80 real ordinary samples the old
filter would have wrongly discarded**, up to 11,839 cycles — the corrected worst ordinary mainline
body is **11,839 cycles (39.75%)**, not 9,661 (32.4%); NMI on this ordinary (non-streaming) engine
stays at 615 cycles (2.1%) even under this busier scenario, unchanged.

*The streamed additions, counted, replacing rather than double-counting existing work, coincidence
stated explicitly.* An arm frame is a crossing frame — it CAN coincide with the busy-content
scenario above (nothing about 8 chasers, Shake, Flash and an Sfx note precludes the player also
crossing a screen edge the same frame) — so the two combine. A box-open frame has no movement (the
world-freeze gate), so the dialogue lifecycle tick and the close-for-Move detector (gated on
`game_state != 0`, only reached when frozen) **never** coincide with a moving/arming frame and are
excluded. Mixed-map prefix resolution runs only on a warp/screen-entry — itself a forced-blank
transition like `redraw_screen`, excluded from "ordinary" the same way — and is likewise excluded,
not double-counted against the arm cost.

| Term | Cost | Basis |
|---|---:|---|
| Boundary probes, player's own worst-case corner check | 5,648 cyc | Measured (§6, `4 × 1,412`, reused unchanged) |
| Boundary probes, entities | 0 cyc | Source-derived: "actor policy, current screen only" (§6) means no entity ever crosses a screen boundary, so no entity-side terrain probe can ever straddle one — every entity probe stays an ordinary same-screen dereference |
| Per-sprite `sw_project_axis`, worst reachable position count | 1,206 cyc | Source-derived: 9 positions (player + `MAX_ENTITIES=8`) × 2 axes × 67 cyc (the measured worst-case per-call cost, §7) — replaces, not adds to, the ordinary engine's own comparable sprite-placement subtract already inside the busy-frame figure above, treated as a full addition (a deliberate overcount, the conservative direction) since no measured ordinary-placement figure exists to net out cleanly |
| The movement/camera driver (accumulator call sites, signed crossing detection, arm decision, axis arbitration, camera tracking + clamp on both axes, the guard's own steady-state check) | **563 cyc** | **Measured**: a standalone, assembled, SPECIFICATION-COMPLETE skeleton of the driver's own six named parts (below), `callRoutine`-measured worst-path. An earlier skeleton was neither spec-complete nor conservatively priced (one-byte one-axis origins with no `player_y` at all, an arm decision that never looked at Y, arbitration that picked X whenever any X button was held rather than retaining whichever axis was pressed most recently, position application that always added to X with no negative-direction code, a camera clamp with an implicit zero desired-high-byte that cleared `cam_dirty` itself instead of leaving it for the caller). The corrected skeleton fixes every one of those for real: real 16-bit signed arithmetic on both axes (`player_y_lo/hi`, real X and Y crossing-detect paths, each independently reachable and coverage-counted), a real edge-triggered "most recently pressed" arbitration state machine (X wins a simultaneous tie), a real arm decision comparing both axes (X preferred when both differ), real negative-direction position application on both axes, and a real two-axis camera clamp that leaves `cam_dirty` SET on return for the caller (`main_loop_idle`) to release after the OAM build — never clearing it inline. `driver_whole` now measures the real two-axis clamp in a single call, replacing an earlier "measure one axis, double it" workaround for the axis it never built. 563 cyc is the sum of each of the six parts' own separately-measured worst branch (a conservative additive bound, since parts run sequentially via `jsr`); one concrete combined single-call scenario measures 562. Coverage counters assert every claimed branch actually ran (both crossing-detect axes, both clamp branches per axis, the arbitration tie/reselect/steady-state cases, all four arm-decision cases, the negative-direction path, the guard threshold) — replacing an earlier harness, which wrote its claimed pad state and map-dimension bytes to the WRONG addresses ($20/$21/$22 instead of the real $11/$24/$25 the assembled skeleton actually used), so its own advertised arbitration-reselection path never actually ran. This harness reads every address out of `driver.asm` itself via the same `name = $HH` equate parser (`shared/enginesyms.js`'s `parseEquates`) the real engine's own `constants.asm` is read through — symbol-derived, not hardcoded (`diag_f23_driver_skeleton.mjs`) |
| Event-freeze check | 10 cyc | Source-derived: one flag load/compare/branch before `update_player`, streamed maps only |
| `sw_dlg17_camrelease`, called unconditionally every mainline frame | 19 cyc | Measured (`callRoutine`, hold-clear path — the ordinary, every-frame case; the rare hold-set release frame costs 29) |
| **Total streamed additions** | **7,446 cyc** | |

**Combined worst coincident mainline total (UNROM 512): 11,839 (busy ordinary) + 7,668 (worst arm)
+ 7,446 (streamed additions) = 26,953 cycles.** (7,446 = 5,648 + 0 + 1,206 + 563 + 10 + 19, the driver's
own corrected 563-cyc figure above replacing 432; `diag_f23_frame_bound_recompute.mjs`.)

**The continuous ownership crossing — the mainline work an in-progress player crossing does that the
figure above still left out, and why it does not raise the worst coincident total.** A streamed
crossing is continuous (§6): no forced blank, no `redraw_screen`. What replaces it is five
bookkeeping steps, each assigned same-frame or deferred:

| Step | Same-frame or deferred | Cost |
|---|---|---:|
| Current-screen id + record-pointer update (`sw_cross_left/right/up/down` incrementing `sw_col`/`sw_row`/`sw_col_byte_lo/hi`/`sw_col_region`/`sw_row_bank_base`, then `sw_locate_current` switching the bank and setting `mtptr`) | Same frame — this *is* what "the crossing committed" means; nothing downstream can wait for it | **773 cyc measured** (`sw_cross_left`'s own region-boundary-wrap branch, 671 cyc, the most expensive of the four — plus `sw_locate_current`, 102 cyc) |
| Entity array repopulation (despawn the outgoing screen's up to 8 actors, spawn the incoming screen's up to 8, through the 16-bit metadata accessor for a streamed record's offsets 256-337) | Same frame — the identical, unmodified `spawn_entities` this engine already runs on every ordinary crossing; no design reason to delay it | **1,937 cyc measured** (the real, unmodified `engine/entities.asm`, `MAX_ENTITIES=8`, one `TRIG_ENTER` actor so `arm_event`'s own cost is included) **+ 44 cyc measured** for the streamed accessor's own offset≥256 arithmetic — a real, assembled stand-in of the exact five-step sequence the kernel-lo hooks table's own byte estimate already names (an offset≥256 compare, a `ptr_hi` carry increment, `Y=offset-256`, the read itself, the restore-before-return), `callRoutine`-measured worst path (`diag_f23_metadata_accessor.mjs`), replacing the prior "≈30 cyc" figure that was inferred from the ≈30-byte allowance rather than measured or instruction-counted = **1,981 cyc** |
| Entry-event arming (`arm_event` for the one actor, if any, carrying `TRIG_ENTER`) | Same frame | Included in the 1,937 cyc above — `spawn_entities` calls it inline, for at most one record per screen |
| Bound-cache/flip resets | **N/A — $0** | Bound tiles are forbidden on any streamed screen (§8): `bind_count`/`flip_pending_count` are zero for every streamed screen already, zeroed once at map *entry*, never per crossing. There is nothing to reset on an ordinary crossing |
| Encounter bookkeeping (`check_encounter`, `player_hazard`) | **Deferred to the next mainline frame** | $0 this frame — the identical, unmodified `screen_fresh` gate `update_player_vertical`/`update_player_anim` already carry (`engine/player.asm`): `spawn_entities` sets `screen_fresh`, and the very next read of it inside `update_player` stops the frame before either reaches. This is the *ordinary* engine's own existing rule, reused unchanged, not a new mechanism |

The last row also answers the deeper question directly: **`update_entities` — the routine that
supplies almost all of the busy-content scenario's own 11,839-cycle figure — is gated on the
identical `screen_fresh` flag, one call site later in `main_loop` (`engine/boot.asm:197-198`,
unmodified).** Measured on the same 8-chaser fixture the busy figure above uses, over every one of the 405 paired
`{body, entities}` samples the run collects (not merely the single sample carrying the largest
`body`: `max(body) - entities-at-that-one-sample` is not `max(body -
entities)`, and the two need not agree). The corrected floor is `diag_f23_busy_decompose.mjs`'s own
**`max(body - entities)` computed per sample, 8,663 cycles** — from a genuinely different sample
than the worst-`body` one (body 8,663, `entities` 0: one of 99 samples in this run where
`update_entities` is skipped outright that frame, the identical mechanism a crossing frame's own
`screen_fresh` gate uses). This is 1,751 cycles higher than the naive (wrong) figure an earlier
decomposition reported (the worst-`body` frame's own `body` minus its own `entities` span, 11,839 − 4,927 =
6,912) — everything that still runs every frame regardless of `update_entities`
(`music_tick`, `flip_tick`, `flash_tick`, `dispatch_input`, `draw_hud`, `build_oam`/`draw_entities`
for whichever entities are active, the per-frame housekeeping around `wait_vblank`) can cost more,
on some other frame, than what the single worst-`body` frame happened to leave over. **A screen crossing and a full chaser AI tick are therefore
mutually exclusive on the same frame, by the identical mechanism §5's own dialogue/close-for-Move
exclusion already uses** — not asserted by analogy, confirmed against the real, unmodified call
order.

The crossing frame's own worst case is therefore **not** floor + busy, it is floor plus the
crossing-specific work above, still combined with the worst arm (a screen edge is a block edge, so
an ownership crossing always coincides with a torus arm) and the same streamed additions minus the
entity-projection/boundary-probe terms' own busy-content assumption (those stay, since collision and
projection still run on a crossing frame):

**Crossing-frame total, corrected: 8,663 (floor) + 7,668 (worst arm) + 7,446 (streamed additions,
including the corrected 563-cyc driver) + 2,754 (current-screen update 773 + entity repopulation
1,981) = 26,531 cycles** — still under the 26,953-cycle busy-arm total above, by 422 cycles
(`diag_f23_frame_bound_recompute.mjs`). **The busy-arm scenario remains the worst coincident frame
on UNROM 512**, but the margin between the two scenarios has narrowed considerably from the
uncorrected figures' own 2,187-cycle gap (26,822 − 24,635) — the corrected floor closes most of the
distance the crossing scenario was behind by.

*The NMI-side denominator, measured for the streamed build itself, not the ordinary engine's 615,*
and the per-board arm cost, since both vary by mapper (below). UNROM 512's own Mesen re-timing gives
the tightest real margin recorded anywhere in this document: the mixed-vblank-at-35-bytes/reduced-
chunk-2 scenario, 105.7 cyc of margin against the full 20-scanline (2,273-cycle) vblank window — a
derived worst NMI cost of `2,273 - 105.7 ≈ 2,167` cycles. An independent jsnes cross-check
(`diag_f18_streamed_nmi.mjs`, replaying the identical worst-case RAM state the Mesen fixtures use,
cycle-counted `nmi`→`nmi_rti` directly) measures a lower 1,324-1,856 cycles across both boards and
scenarios — a known-shaped discrepancy, not a contradiction: this exact codebase already documents
mapper4's own scanline-IRQ counter inflating an isolated jsnes measurement by 300-400 cycles for
reasons unrelated to the routine being timed (`build_f9_worst_chunk_fixture.mjs`'s own header
comment); the real, full-system Mesen figure is what this document treats as authoritative elsewhere
and is used here too, as the conservative (larger-subtraction) choice.

**Per-board denominators and arm costs — UNROM 512 proven, MMC1/MMC3 indicative arithmetic only,
UNPROVEN pending phase 3 (§2's own phasing table).** The
worst-arm figure (7,668 cyc) is UNROM 512-specific: `sw_goto`'s own cold row loop calls
`switch_prg_bank` once per screen the unaligned, three-screen worst-reachable arm touches, PLUS one
more at the arm's own end when `sw_stream_start_col`/`_row` calls `sw_locate_current` to restore the
caller's current screen — **four switches per arm, not three** (`sw_stream_start_col`'s own body,
read directly: three `jsr sw_goto` inside its per-block relocate branch, one `jsr sw_locate_current`
after the loop exits). The four-probe boundary-check term (`4 × 1,412` above) carries its own switches
too: `sw_peek_byte` is `jsr sw_goto` + `jsr sw_locate_current`, **two switches per probe, eight for a
corner check** — omitted entirely from the fix-21 conversion, which only ever touched the arm's own
three. `diag_f23_mapper_switch_count.mjs` counts every one of these by reading
`sw_goto`/`sw_locate_current`/`sw_stream_start_col`/`sw_peek_byte`'s own real bodies (not asserted by
hand): **4 (arm) + 8 (four probes) = 12 switches total**, nine more than the earlier conversion counted. For UNROM
512 itself every one of these twelve is already the real, measured UNROM 512 `switch_prg_bank` cost,
embedded in the 7,668-cyc and 5,648-cyc figures above (confirmed by reading the routines, not
assumed) — no double count.

`switch_prg_bank`'s own cost differs by mapper family (`engine/banks.asm`): UNROM 512 writes one byte
through a lookup table (≈36 cyc, source-counted); MMC3 writes a select/value register pair, masked
against its own scanline IRQ under `php`/`sei` (≈60 cyc with `SPLIT_ENABLED`, the shape every
text-showing MMC3 project carries — the board named as "longer: split, and the DMA gate"); MMC1
shifts five single-bit writes through a serial port (≈97 cyc) — the board needing the slowest
primitive, confirmed from source. Per the phasing in §2, MMC1/MMC3's own two-nametable streamed ring
is phase 3, **not started** — nothing in this document times that ring's own addressing directly, so
the figures below reuse the phase-2 (UNROM 512, four-screen) worst-arm/streamed-additions measurement
with all twelve mapper-switch deltas added (not three), a conservative generic bound on the
arbitration/switching cost alone, **not a phase-3 proof** (`diag_f23_frame_bound_recompute.mjs`):

| Board | Worst NMI | Available budget | Worst arm (+4 switches) | Streamed additions (+8 switches) | Worst coincident total | Margin |
|---|---:|---:|---:|---:|---:|---:|
| UNROM 512 (PROVEN) | 2,167 cyc (Mesen-measured) | 27,613 cyc | 7,668 cyc (measured) | 7,446 cyc | 26,953 cyc | **660 cyc (2.39%) — FITS** |
| MMC3 (indicative, UNPROVEN pending phase 3) | 2,232 cyc (Mesen-measured, mixed@35/reduced-2's own 41.0 cyc margin) | 27,548 cyc | 7,764 cyc (7,668 + 4×24) | 7,638 cyc (7,446 + 8×24) | 27,241 cyc | **307 cyc (1.11%) — FITS, indicative only** |
| MMC1 (indicative, UNPROVEN pending phase 3) | 2,232 cyc (no Mesen data exists for this board — conservatively borrowed from MMC3) | 27,548 cyc | 7,912 cyc (7,668 + 4×61) | 7,934 cyc (7,446 + 8×61) | 27,685 cyc | **−137 cyc (−0.50%) — OVERRUNS, indicative only** |

**UNROM 512 is the one board this document proves fits, with a real if narrower-than-previously-stated
margin (660 cyc, 2.39%).** MMC1/MMC3's own two-nametable ring is unbuilt and untimed; the indicative
arithmetic above is a conservative generic bound on switching cost alone, carried over from the
phase-2 (four-screen) measurement, and is not a substitute for a real phase-3 Mesen proof against
that board's own ring geometry. Under this indicative accounting MMC3 still fits, narrowly (307 cyc,
1.11%); **MMC1's own corrected indicative arithmetic is negative (−137 cyc) — stated plainly, not
reclassified.** This is not a demonstrated reachable overrun (phase 3's real geometry and packing may
cost less than this generic bound assumes, per the levers below), but it is not a claim that MMC1
fits either. **Phase 3's own entry criteria (§2) must include re-proving this frame bound on the
two-nametable ring, per board, with real mapper-switch costs measured against that ring's own
addressing** — not an assumption that the four-screen figures transfer. What phase 3 has to work
with, if MMC1's own real ring construction does carry a comparable cost: a precomputed row-address
table for `sw_goto`'s own linear row loop (its single largest per-call cost — see the phase-2 levers
paragraph below) would remove most of the per-switch overhead these deltas are built from; batching
multiple reads per bank entry (fewer `sw_peek_byte`-shaped round trips for the same corner check)
would cut the eight probe-side switches directly. Neither is built; both are real, available
reductions the moment phase 3 needs them.

**No overrun occurs under UNROM 512's own proven accounting**, so the contract does not need to claim
overrun modelling is unnecessary by assumption for that board — it is checked directly by the
position-jump guard's own scheduler exercises, below, including a real overrun's own actual
behaviour (not only a stress proxy). MMC1/MMC3 have no equivalent guard proof yet, since their own
ring is unbuilt.

**A typical streamed frame, for contrast — a note for the implementer, not a new proof.** The
26,953-cycle total above is a deliberately stacked worst case: 8 chasers with contact damage, a live
Shake, a live Flash, an authored Sfx note, AND a screen edge arming the same frame, at the single
worst reachable arm coordinate. An **ordinary** frame — no crossing this frame (arming happens
roughly once per 10-11-frame crossing, not every frame), the player away from any screen boundary
(no probe needed at all, not merely a cheaper one), and the *average* of the same busy-content
scenario's own 405 sampled frames (6,148.9 cycles, itself still conservative for "typical," since it
is the average of the worst-content scenario, not a lightly loaded one) — totals roughly **6,149
(avg ordinary) + 0 (no arm) + 1,798 (streamed additions minus the boundary-probe term, which is 0
away from any edge: 1,206 projection + 563 driver + 10 event-freeze check + 19 `camrelease`) ≈ 7,947
cycles**, about **28.8%** of the 27,613-cycle UNROM 512 available budget — comfortable, unremarkable
headroom, next to the worst case's 97.6%.

**Phase-2 levers that buy margin back without changing any accepted decision here** — implementer
notes, not new mechanism: `sw_goto`'s own row loop (`sw_goto_rowloop`) costs linearly in whatever row
value it is handed, which is why the worst-reachable-coordinate arm (7,668 cyc) and boundary-probe
(1,412 cyc/probe) figures are so much larger than their near-origin counterparts (4,077 and 274-317)
— a precomputed row-address table, or a cached base pointer updated incrementally as the window's own
origin moves rather than recomputed cold on every relocate, would remove most of both costs without
touching the addressing scheme itself. The per-block fill-bounds compare
(`sw_terrain_or_fill`, ~24 cycles/block) can be hoisted out of a strip's own per-block loop for the
common case where an entire strip is known in advance to be fully in-bounds (a map at least one
window's width/height larger than its own streamed grid on that axis), paying the check only once per
strip rather than once per block. Deferring entity repopulation to the next frozen settlement frame
(the same frame encounter bookkeeping already waits for) would remove the whole 1,981-cycle
entity-repopulation term from the crossing frame, at the cost of one more frame where the newly
entered screen's actors are not yet present — not needed today, since the crossing-frame scenario
already sits well clear of the busy-arm total it is compared against, but available if a future
addition (a bigger entity record, a costlier accessor) narrows that gap. None of these levers is
required for phase 2 to ship — the worst case already fits, on every board, with real (if thin)
margin — but any would widen it for a project that turns out to need it.

### The position-jump guard

**The guard fires at lag ≥ 6** (`deriveHardLimits()` gives the true per-direction hard limit as 8
blocks X either direction, 8 blocks Y moving down, 7 blocks Y moving up — §5, "The torus and
window"). **Guard semantics, specified precisely, in the actual operative order:** detection runs
in the mainline update, before the camera for that frame is published. The instant `lag >= 6`, the
engine (1) suppresses camera/OAM publication for this frame and every frame until the resync
completes — holding `cam_dirty`, the identical publication barrier §7 already proves — and cancels
any in-flight strip service (`st_active := 0`, made moot by the redraw about to run); (2) installs
the **target** window origin immediately (`current := desired`, both axes); (3) forces blank — **and a
forced blank is exactly this: nothing else in the mainline frame runs either, so mainline movement
itself is frozen for the redraw's whole length**, the same "the world is frozen for the whole
transaction" rule this document's own dialogue-freeze gate already applies to a different forced wait
(§7); a command that would otherwise move the player or an actor is dropped for any frame the blank
still owns, never queued to replay once it lifts; (4) `sw_render_window` redraws the whole window **at
that target origin** — rendering at the old, pre-jump origin and relabelling the result "desired" does
not populate the desired window, since the ring's own physical content at the target origin was never
drawn there; (5) rebuilds OAM; (6) publishes the new camera; (7) resumes ordinary rendering and
publication. The forced blank lasts as long as the redraw actually takes — the same multi-frame
`sw_render_window` cost this document charges everywhere else a full window redraw runs (§7's own
nine-frames-per-side dialogue figures are the measured *shape* of that cost, not its magnitude here: a
full torus redraw is a real, separately measured **969,527-cycle** worst case,
`handoff-next/streamed-worlds-design-fix10-report.md`'s own `diag_r10_routed_costs.mjs` output,
`sw_render_window (full 4-nametable redraw): 3x3-real=969527 cycles` — **≈33 frames** at this
document's own 29,780-cycle NTSC frame budget, rounded up) — and **no containment assertion applies to
a blanked frame**: forced blank shows no PPU-scanned content at all, so there is nothing displayed to
contain-check while it runs. Containment resumes being checked **on the very first publication after
the blank, not merely from the following frame onward** — the frame that finishes the resync is itself
checked, against the now-genuinely-valid window, exactly like every ordinary frame after it. **No
finite margin can cover an unrestricted jump published first**: the guard's own safety comes entirely
from suppressing every frame's publication until the redraw is real, not from a buffer that would
tolerate showing an unfinished one.

**Proved directly under true geometric containment (§5), against the corrected order above**: a
forced, single discontinuous jump (a warp, not a walk) lands `lag` exactly at 6 in every one of the
four directions, both with and without a strip already in flight servicing that axis at the instant
of the jump; the worst real margin at the instant of detection is **exactly 0 blocks (never
negative)**. Two negative controls confirm the resync response is load-bearing, not decorative: the
identical jump with **no** further movement and no resync never violates containment on its own
(`current` catches up to the now-fixed `desired` over the next few completed strips, honestly
reported rather than asserted); the identical jump followed by the player **continuing to walk** in
the jump's own direction, with no resync response, genuinely diverges into containment violation
within a few frames — the realistic "a warp lands mid-input" case, and exactly why an active
response (not a passive threshold) is required. Two further checks close the gap the corrected order
itself opened: **very large jumps** (thousands of pixels, far beyond one window's own width, not
merely just past the guard threshold), all four directions, with and without an in-flight strip, at
**four** different redraw durations — the three already-accepted stand-in magnitudes (1/9/40 frames)
**and the real measured `sw_render_window` cost derived just above (≈33 frames)**, not assumed
sufficient at the three stand-ins alone — never violate, confirming the
model's safety does not depend on jump magnitude or how long the real redraw happens to take, only on
publication staying suppressed for its whole length, and that a strip genuinely in flight at the
instant of the jump is genuinely cancelled (a counter asserted non-zero exactly when a strip was
armed beforehand, zero otherwise — not inferred from the absence of a violation); and a **direct
boundary negative control**, replacing the prior
long-random-run exercise, which never happened to trip the entering-edge exclusion in 200,000 frames
and so could not itself demonstrate the rule doing anything: the camera is placed so the viewport's
own last visible column lands exactly on an in-flight strip's own entering column. Excluding that
column from valid content (the shipped rule) correctly reports this placement as a violation — the
strip genuinely has not finished drawing it yet, so showing it would be unsafe; counting the same
column as already-completed content (the rejected alternative) reports no violation at all,
silently accepting the same unsafe frame. This is a boundary no legal gameplay ever reaches — the
guard's own job, proved above, is exactly to keep lag inside the 6-block threshold so this placement
is never published — but it shows the exclusion rule is "hot," able to catch a real problem at the
tightest margin, not merely never contradicted by whichever workload happened to be run against it.

**The scheduler model verifying this order had its own faults, distinct from the order itself.** Three
faults, all in the model, none in the contract's own sequence above: the redraw-duration parameter
named in one exercise's own loop was never actually passed into the scheduler, so every case blanked
for the same 9 frames regardless of its own label; the very first frame could fire the guard
spuriously, because the model's own initial `current` value did not match what a resting, un-jumped
window's own `desired` value computes to at that same starting position — the fix seeds `current` once,
before the loop, from the identical formula `desired` itself uses, rather than a literal placeholder;
and, most directly, the model applied mainline movement unconditionally even while blanked and then
skipped the containment check on the very frame the blank ended, which is exactly the publication the
order above requires checking. Reproducing an inserted diagnostic explains why the first two faults
compounded into the third's own visible symptom: an un-jumped, spuriously-fired frame-zero guard would
freeze `current` at the resting window origin while the *unfrozen* model kept applying the real jump
command anyway, so by the time that stale blank finally lifted, the published camera and the frozen
window origin had drifted arbitrarily far apart — not a property of the order itself, confirmed by
construction: once movement is genuinely frozen for a blank's whole length and `current` starts from a
value consistent with an un-jumped `desired`, the first resumed publication is *always* self-consistent
(the same frozen position feeds both), and the explicit assertion on it — kept because a check that can
never fail is still worth keeping as a regression guard against exactly this class of bug — passes not
vacuously but *because* the two root causes that could have violated it are both closed. No further
contract-sequence flaw was found underneath the model's own bugs: the operative order itself (detect →
suppress → install target → blank, frozen → render → OAM → publish → resume) is unchanged and, modeled
faithfully, verifies clean end to end, sanity check (a valid initial state fires no guard) included.

**A real overrun's own actual behaviour, not only a stress proxy.** A mainline body that runs long
enough to miss a vblank leaves that vblank's own NMI service simply skipped and retried next — never
torn, the ordinary `vram_ready` rule already in this document. Because the gate on `sw_nmi_stream` is
`st_active` alone, never `paused`/`game_state`/`vram_ready` (§8), an already-active strip keeps
draining on every NMI regardless of whether that frame's mainline body ran long; what an overrun
actually costs is the arm decision and the camera/OAM publication for that one frame slipping to the
next mainline iteration, not a lost or corrupted strip. A periodic, one-vblank-late NMI was fed into
the identical scheduler and assertion as a **deliberately harsher service-loss stress test** — not a
claim that this document's own frame-budget accounting (above, which finds a real, positive margin
on every board with no overrun expected) predicts an overrun this frequent. At an occasional
recurrence (one missed vblank every 50-100 frames) containment holds with ordinary margin and the
guard is never approached. At a **sustained** recurrence (one missed vblank every 30 frames,
forever) the touch-corridor workload alone reaches the guard threshold repeatedly; **without** the
guard's own active resync response this sustained fault genuinely diverges (a real, reported
failure, not swept into a looser assertion), while **with** it active, containment holds
indefinitely across every tested recurrence down to every second frame, the guard re-firing and
re-resyncing as many times as the fault demands. This is the guard doing real, necessary work against
a sustained anomaly, not a coincidence of unused margin — a materially stronger claim than "the
worst legal frame fits," and, combined with the actual-overrun reasoning above (a slipped arm/
publication, never a torn or lost strip), a complete answer to what an overrun does on this engine,
not merely a proxy for it.

**The old repeated-knockback exception is gone, proven rather than merely no-longer-claimed**: under
the corrected model (both the signed-position fix and `camBlock`
correction), capped knockback (8 px, `KNOCKBACK_TIME` unchanged at 8 frames) repeated at the fastest
legal `IFRAME_TIME = 60`-frame cooldown, forever, in **all four directions**, run through the
identical scheduler and containment assertion every other exercise uses (not a separate scalar
loop, fixed), holds lag at **exactly 0** on the moving axis with 6-7 blocks of real
slack — not merely under the guard, but not a lag contributor at all. There is no remaining
adversarial case this guard exists to catch beyond the genuine position jumps (and, defensively, a
sustained service anomaly) named above.

## 6. Reads

Three bank-safe read contracts, each with a distinct restore contract, kept as three named routines
rather than one generalised one:

- **`sw_goto`** — the cold, arbitrary-`(screenCol, screenRow)` relocate: switches the PRG bank
  holding that screen's own record and sets `mtptr` to its byte 0. The one-time division/multiply
  this design needs at a map entry or any cold reposition; `sw_locate_current` is its O(1) restore
  of whichever screen is "current." **Neither can ever be banked** — each is exactly the routine
  that changes which bank is selected, and the instruction after its own `jsr` already executes
  from whatever it just switched to.
- **`sw_peek_byte`** — read one byte of a neighbour screen, then restore the **caller's own current
  field screen** (bank and `mtptr` both) via `sw_locate_current`. The right choice for a caller that
  genuinely *is* field/mainline code and expects to keep dereferencing `mtptr` directly afterward —
  the straddling-collision case. Cost: 274 cycles at a near coordinate, 317 at a one-row/one-column
  boundary coordinate, 1,412 at the real worst reachable coordinate (below).
- **`sw_read_transaction`** — restores the **caller's own PRG bank**, given as an explicit argument
  (`sw_caller_bank`), never the field's current screen. Correct for a caller resident in a different
  bank entirely (the RPG battle region, or any future banked reader) — it has no `mtptr` of its own
  to restore, so it does not try to. Proven from a genuinely banked context (three distinct hardware
  banks live at once: the caller's own code, the field's current screen, and the probed target).
- **`sw_read_run`** — the resident bounded-run primitive for a consumer needing more than one byte:
  relocates once, copies up to `sw_run_len` bytes (sized to 8, the real worst case a straddled
  collision edge needs) into a dedicated `sw_run_buf` **before** restoring the caller's bank (the
  target bytes cannot be dereferenced a second time once the bank is back), then restores via the
  caller's own bank argument. Never reuses `sbuf` (the incremental-strip buffer) — a probe can share
  a frame with an in-flight NMI-drained strip still reading it.

**Every terrain and attribute read routes through the fill-aware bounds check** (§5, point 2) —
confirmed by grep, not by inspection alone, across all four consumers that could otherwise
dereference `[mtptr_lo],y` raw: the two mainline strip arms, the full renderer (one shared
`sw_rw_read_metatile` routine feeding both its terrain and attribute probes), and the banked
strip-fetch primitive (which checks bounds once per call, since a call always targets exactly one
screen, and either fills the whole requested run or reads it for real, never a mix). Proven on a
1×1, a 1×N, an N×1 and a 3×3 grid, both strip arms in both directions and the renderer's terrain and
attribute output alike (528 real-6502 observations); the full unaligned × all-parity render
regression (7,680 independently-computed comparisons across all 4 origin parities, all 240
local-offset combinations, all 4 physical nametables) all pass, many resolving to fill where the
fixture's own real extent ends. The bounds check costs about 24 cycles/block, paid on the single
arming frame the mainline cost above already charges.

**Actor policy, current screen only**: a non-player actor (any NPC, monster, or scripted-`Move`/
patrol AI) is clamped to its own screen's edge — `MAX_X`/`MAX_Y` (240/224) containment, the
identical bound the player's own ordinary map-edge wall already uses — and can never cross a screen
boundary at all; a `Move` or AI step that would carry it past the edge stops there instead, the same
"a move that cannot finish must end, not hang" rule this engine's own `Move` command already applies
to a wall. Storage, lifetime, duplicate-spawn-on-revisit and stable identity are all unchanged from
today's ordinary per-screen entity model, since no actor ever changes which screen owns it. **The
player's own ordinary held movement alone crosses continuously**: at world x=256+n (or y=240+n), the
player's own position continues at the neighbour's local x=n (or y=n), preserving overshoot exactly
as ordinary mid-frame movement would — never a discontinuous snap to the neighbour's far edge
(`MAX_X`/`MAX_Y` landings are the *ordinary*, non-streamed engine's own mechanism, for a hard screen
cut with no continuous camera to preserve motion across; they are not reused here). The second axis
of movement is deferred on an ownership-changing crossing, matching today's engine's own actual
single-axis-per-frame exit behaviour (confirmed by direct reading — `update_player` genuinely does
not cross both axes in one frame today). **A *scripted* player `Move` is the one exception to "the
player alone crosses continuously": it never changes which screen is current mid-page, but — unlike
an NPC — it is NOT walled at the tighter `MAX_X`/`MAX_Y` actor-containment bound.** It is bounded
instead by the **natural ownership rectangle** (x 0-255, y 0-239, the same legal range held movement
and Save already admit), with carry/borrow-safe arithmetic (§7 has the full fix and the fringe trace).
`MAX_X`/`MAX_Y` (240/224) and the natural 256/240 ownership origin are
**different bounds on the same top-left position**, not, as an earlier draft of this section claimed,
the identical edge — a scripted Move walled at 240/224 would refuse the legal 240-255/224-239 fringe
outright, and `move_tick`'s own unmodified wall test wraps rather than blocks a legal x=255 (or
x=254 at speed 2) right-moving step, since `256` (not `241`) is the byte's own true ceiling there. The
identity hazard a suspended page's own `talk_ent` would otherwise be exposed to if ownership itself
ever changed still makes the scripted case the one place this engine deliberately does *not* give the
player the continuous-*crossing* treatment its own held movement gets — only crossing, never the
fringe itself, is refused.

**A boundary probe's collision cost, at the real reachable worst case**: the worst legal
`(screenCol, screenRow)` a collision probe can reach is not the naive `(254,254)` (a 255×255
rectangle cannot exist under the 255-screen ceiling) nor `(0,254)` (a 1-column×255-row map needs 255
screen regions, more than any board has — UNROM 512's own ceiling is 61 once no code region is
reserved for streaming, §4) — it is `(0,60)`, the true region ceiling on the largest board. There,
`sw_peek_byte`'s own full transaction costs **1,412 cycles** (not `sw_goto`'s bare 1,288 — the byte
read plus the O(1) restore add a real, disclosed 124 cycles). A corner check (four probes, both axes
resolved independently) at this true worst case costs `4 × 1,412 = 5,648` cycles, **19.0%** of the
29,780-cycle frame budget — real, but bounded, alongside `music_tick`, `read_pad`, and one block of
streaming service that same frame.

**The map-edge wall applies before any read is attempted**: a probe resolving to a neighbour outside
the authored grid returns solid unconditionally, with no bank switch and no `sw_read_transaction`
call — a non-mutating answer, distinct from the window clamp (§5).

## 7. Sprites, projection, and the dialogue overlay

### Projection

`sw_project_axis` converts a world position and a camera **origin** (the world position sitting at
screen column/row 0 — never a separate centring constant added a second time) into an OAM value:
`delta = world - origin`, one 16-bit subtract; visible iff `delta_hi == 0 AND delta_lo <
visibleWidth` (256 for X, 240 for Y — a real argument, not a hardcoded 255). World position and the
camera origin are unsigned 16-bit pairs (a legal 255-screen-wide world can reach world x=65,279, past
what a signed 16-bit value could hold); the subtract itself needs no change for this, since 6502
`SBC` is representation-agnostic. **Any negative delta hides, unconditionally** — OAM X/Y are
unsigned bytes with no representation for a negative screen position at all (a tile at X=-7 truncates
to 249, which the PPU draws at the *right* edge, not a partial sliver at the left); there is no
"partial-left-edge" case to special-case, since the right/bottom edge already gets free hardware
clipping for genuinely in-range values (X=248-255) that the left/top edge has no equivalent of.
**OAM Y's one-scanline-early convention belongs to the caller**: `sw_project_axis` answers "is this
logical row visible," and a Y-axis caller subtracts 1 from the returned byte before writing OAM — the
one edge case this produces (logical row 0 wraps to OAM Y 255, indistinguishable from this engine's
own "hide" sentinel) is the same standard trade-off real NES engines already accept. Measured: 51-67
cycles/call, 14 independently hand-computed test cases (never an oracle repeating the routine's own
arithmetic), all passing. An attached effect projects through the identical routine at the entity's
position plus its own authored offset — no new mechanism.

**Neighbouring actors are absent, not drawn-but-inert**: a screen's own record holds terrain ids
only, never entity sprites, so an actor on a screen the player does not currently own is simply not
drawn — the concrete shape of the "actors disappear at the crossing" consequence in §1.

### The dialogue overlay

**No forced blank, no torus/window change, no redraw of nametable 0.** Opening and closing are each
a small state machine — `DLG_IDLE → DLG_PENDING → DLG_OPEN_ROW → DLG_OPEN_ATTR → DLG_OPEN →
DLG_CLOSE_ROW → DLG_CLOSE_ATTR → DLG_CLOSING_DRAIN → DLG_IDLE` — stepped one state per mainline
frame, never a synchronous multi-frame block. `DLG_PENDING` is the pending-open phase (below);
`DLG_OPEN_ROW`/`DLG_OPEN_ATTR`/`DLG_CLOSE_ROW`/`DLG_CLOSE_ATTR` are six and three packet-producing
frames respectively, the same shape `text_open_step`/`text_close_step` already have today; the world
is frozen for the whole transaction by the ordinary dialogue gate, raised the instant an open is
requested — before the pending wait, before the nudge, before a single packet is queued — so no
frame of the wait, the nudge, or the draw is ever visible as a mid-transition flicker. On open, once
the strip has idled (`DLG_PENDING`'s own job), the camera floors to the enclosing 16 px (metatile)
boundary on both axes independently (at most 15 px/axis, one mainline frame, `cam_dirty`-guarded).
The box's six tile rows (rows 24-29) then draw through the **existing, unmodified** `vram_buf`
mechanism, with row/attribute addresses resolved against the floored camera instead of the fixed
`$23xx` literal an ordinary screen uses. On close, the same six rows are rebuilt from the streamed
record via `sw_dlg_metatile` (composing `sw_terrain_or_fill` with a caller-supplied origin — the
identical fill-aware accessor every other terrain read now uses); the camera un-nudges back to
continuous tracking once the whole close sequence — including the drain acknowledgement below — has
finished, not merely once the last packet is queued.

**Naming reuses this identical cheap path, with no mechanism of its own.** In-game naming (hero or
Join) draws through the same six-row footprint (`tile rows 24-29`) Say/choice already use — its own
larger kernel-lo cost is a code-size fact (more cells drawn within those six rows: the A-Z grid, the
preview, the sprite cursor), never a larger visual footprint. There is exactly one cheap path on a
streamed map, used by every overlay that fits in six rows.

**The address mapper, one for every destination.** The aligned camera's own `cam_x_lo`/`cam_y_lo`
(0-255/0-239, always metatile-aligned so the low 3 bits are 0) give the within-nametable tile
remainder (`/8`) directly; `cam_nt`'s own two bits are the crossing quotient for the viewport's
origin, established once by the nudge (an ordinary carry/borrow/compare on the same bytes
`camera_slide_tick` already performs for a slide — nudging by up to 15 either direction, never
tile-parity-based). For a given logical row/column offset within the box, the absolute torus tile
position before wrap is `cameraRemainder + boxOffset`, wrapping at 30 (rows) or 32 (columns) with a
crossing quotient that XORs the corresponding `cam_nt` bit — a corner packet crossing both seams at
once XORs both bits, reaching the diagonally-opposite physical nametable. The `$2006` hi/lo pair
follows with no 16-bit multiply (`addrLo = ((physRow AND 7) << 5) OR physCol`, `addrHi = ($20 +
ntIndex*4) + (physRow >> 3)`), verified against the ordinary-screen box's own fixed case as a
control. Every destination — the border frame, interior text, the page-turn arrow, the choice
cursor, and naming's own cell writes — routes through this one mapper.

**The split-at-seam packet writer**: a row that straddles a physical nametable seam splits into two
`vram_buf` packets (one per side of the seam), each with its own 3-byte header — a split 32-tile
terrain row is **38 packet bytes** (32 payload + 2×3 headers), not 35; a split attribute run
similarly. The worst single-transaction queue measured is **38 bytes**, comfortably under every
exclusive-drain queue already proven safe.

**`attr_shadow` is populated at runtime by `sw_render_window`'s own attribute pass, never by
`screenAttributes` — the same runtime-shadow attribution already fixed at §4 but restated here for this section's own context.** `screenAttributes`
(`main/build/generate.js:1980`) is a **JavaScript build-time generator function**: it cannot execute
once the ROM exists, and streamed records carry no baked per-screen attribute table for it to read
from regardless (§3). The real runtime path is `sw_render_window`'s own attribute pass
(`sw_rw_read_metatile`, §6), in physical ring coordinates, the same routine every other resync in
this document already uses — §4 has the full mechanism.

**`screenAttributes`'s own quadrant-skip rule survives here only as a generator-side precedent for
*why* "row 30 doesn't exist" is already a solved shape of problem, not as the mechanism itself.** That
function skips a quadrant lookup whose metatile `(col, row)` falls outside the screen's own
15-row/16-column grid (`if (col >= LIMITS.screenCols || row >= LIMITS.screenRows) continue`), which is
exactly why an ordinary screen's own bottom-most attribute row only ever has its top half (the real
metatile row 14) populated — metatile row 15 does not exist on a single screen, so the bottom two
quadrants of that byte are always 0, contributed by no real tile. That is a fact about the **generator's**
own baked-attribute-table construction for an ordinary screen, unrelated to how the streamed torus's
own attribute bytes get built at runtime — cited here only because it establishes the same shape of
boundary this design's own runtime mapper independently enforces: the streamed torus stacks two
screens' worth of metatile rows (0-29) but the dialogue overlay's own attribute mapper
(`sw_dlg_attr_yinfo`/`sw_dlg_attr_byte`, above) works in attribute-row units (0-14 per nametable half,
each covering two REAL metatile rows, 0-29 total across the wrap), so it never constructs a metatile
row past 29 to begin with — enforced by the same modular arithmetic that already proves
`sw_render_window`'s own wrap correct, not a second, separate skip this design has to invent, and not
anything `screenAttributes` itself does at runtime.

**Attributes: masked on open, plain on close, one rule.** `attr_shadow` is never written by the box
on either edge — the box only ever mutates the physical PPU byte, always by `overlay = (terrain AND
NOT mask) OR (boxPalette AND mask)`, where `mask` covers only the quadrant bits this specific byte's
row-half and column-edge position puts inside the band (a middle byte gets the full row-half mask; an
edge byte where the band starts on an odd metatile column gets only the one quadrant actually
inside). Because the masked write never touches an outside-band quadrant, those quadrants stay
byte-identical to `attr_shadow` for the whole transaction (no strip runs concurrently — below), so
**close can restore the whole byte unmasked**, straight from `attr_shadow`, with no mask math at all.
One real, empirically-found addition to this rule: when the box's own start row lands exactly on an
attribute-row boundary, two adjacent band rows can share one physical attribute byte's two
row-halves — applying the masked formula independently per row is then wrong (each computes from
pristine shadow, so the second row's write undoes the first's already-correct half); the fix forces
the **full** mask on both sides whenever two band rows are detected to share a byte, making the write
idempotent regardless of order.

**The pending-open phase, `DLG_PENDING`: a box does not open while a strip is active, but the world
freezes before that check, not after.** Every one of the three real entry paths — `settle_owed`'s own
entry-event dispatch, interact dispatch (`do_action_interact` → `do_talk` → `start_dialog`), and
`script_resume` continuing a page straight into a `Say` — reaches `box_begin` (or an equivalent
first-run call) with the ordinary dialogue freeze *already* applied, because that freeze is the same
`game_state`/`paused`-shaped gate that already stops `update_player`/`update_entities`/
`dispatch_input` for every other frozen-world state, raised at the same point those paths already
raise it today (`start_dialog`'s own `game_state = ST_DIALOG` write, unconditionally, before the
script or box has run). `box_begin` itself then checks `st_active`: nonzero, and it enters
`DLG_PENDING` — no nudge, no state change beyond the world already being frozen — and leaves it the
first mainline frame `st_active` reads 0 on its own. **This is what actually closes the
deadlock finding**: the earlier text's mistake was gating the *strip's own NMI service* on the same
frozen-world flag that gates *arming* — an armed strip can never finish servicing while the world is
frozen if servicing itself is gated on `!frozen`, so a box waiting for that same strip to idle before
it may open waits forever. The fix is not a new synchronization primitive, it is the existing
distinction the rest of this contract already draws (§5's own "Strip service is gated on
`st_active`, not on `game_state`"), applied here too: **NMI drains an active strip in every state**,
frozen or not — a full chunk if nothing else is queued, a reduced (mixed) chunk if a small
Flash/UI queue is also draining that same vblank — and only *arming a new strip* is what the frozen
world forbids, which a box waiting to open never needs to do anyway (nothing new is armed for the
whole open-through-close transaction, so no new crossing demand accrues during it, closing the
"could a box's own write and a strip's own write ever target the same attribute byte" question by
construction — they are never both live at once — rather than by a geometric disjointness proof,
which attribute-byte granularity, coarser than tile granularity, makes genuinely hard to establish
otherwise). Measured against a real 32-block row strip (the worst single-axis case) with a
concurrently publishing Flash burst: **12 real vblanks** of pending wait in the worst observed case —
not the 11 a plain `ceil(32/3)` would suggest, because Flash's own arm-push and its later restore
each cost the strip one *reduced* (2-block, not 3) vblank, exactly the "two reduced
mixed-vblank opportunities" prediction, confirmed by direct execution rather than assumed. Against
the old (deadlocking) gate, the identical workload never opens at all — proven directly (a 3,000-
vblank watchdog exhausted with the strip still active and the box still pending), the negative
control this finding's own fix must pass.

**The nudge publication barrier — camera, world-origin, OAM and the whole mainline
frame, not just the camera write, held from every real entry path.** The instant
`DLG_PENDING` sees `st_active == 0`, the SAME mainline frame performs, in order: (1) the floor-to-16px
nudge on `cam_x_lo`/`cam_y_lo`; (2) the identical pixel delta applied to `sw_cam_origin_x_lo/hi` and
`sw_cam_origin_y_lo/hi` (§4's own RAM-map entry) — the world-space origin `sw_project_axis` actually
projects sprites against, distinct from the PPU-scroll `cam_x_lo`/`cam_y_lo` pair, and the "Counts"
gap: nudging the scroll bytes alone would leave every entity's own OAM position
computed against the *pre-nudge* world origin for one frame, a real background/sprite mismatch;
(3) `build_oam`/`draw_entities`, unconditionally reached later in that identical mainline pass
(`main_loop_draw`), off the now-nudged origin. **`cam_dirty` is raised before step (1) and HELD
through step (3)**, released only at the very end of the mainline frame (`main_loop_idle`, the last
action before looping back to `wait_vblank`) — not, as the fix-16 text claimed, immediately after
step (1)'s own two-byte write. That earlier, narrow bracket was a real, proven defect, not a
theoretical one: an NMI landing after the camera write but before `build_oam`/`draw_entities` finish
would see `cam_dirty` already clear, so `nmi_scroll` would refresh its scroll snapshot from the
*new*, nudged `cam_x_lo`/`cam_y_lo` while the real `$4014` OAM DMA — unconditional, at the very top of
`nmi:`, run before any of that — copied whatever the *old* frame's `$0200` shadow still held, since
`build_oam`/`draw_entities` had not run yet: a genuine **(new scroll, old OAM)** mixed pair, reaching
the PPU for real.

**The fix is two changes together, both gated on the extended hold, neither alone sufficient.**
First, **the real `$4014` OAM DMA is now gated on `cam_dirty`** — `nmi:` checks it immediately after
the existing `sta $2003`, and skips the DMA entirely while `cam_dirty` is set. Skipping costs
nothing real: rendering stays on, so the PPU keeps displaying last frame's sprites (OAM does not
decay from being un-refreshed for the one or two frames an ordinary hold ever spans), and the check
itself is one `lda`/`bne` — a few cycles — paid on *every* NMI regardless of whether the hold is
active, since `cam_dirty` already reads 0 on the overwhelming majority of frames and a narrower
"only during nudge/un-nudge frames" gate would need its own separate flag for a benefit `cam_dirty`
does not already provide (a project not using streaming never assembles this branch at all — see
below). Second, **the release point moves to the true end of the mainline frame**: `sw_dlg17_
camrelease`, called from `main_loop_idle` right before `jmp main_loop`, decrements `cam_dirty` if and
only if a nudge or un-nudge set a hold flag (`sw_dlg17_camhold`) earlier that same frame — a no-op on
every other frame, one flag read and one branch. Together these mean: an NMI landing *anywhere* in
the window from the camera write through the end of `build_oam`/`draw_entities` — including inside a
genuine overrun, where the whole mainline frame spills past a single vblank — sees `cam_dirty` still
set, so it skips the DMA and leaves `nmi_scroll`'s own snapshot stale, publishing the coherent **(old
scroll, old OAM)** pair every time; the *next* NMI after release publishes **(new scroll, new
OAM)**, equally coherent. A mixed pair is now structurally unreachable, not merely rare. This
degrades gracefully to "every streamed frame pays a few extra NMI cycles for a check that almost
always does nothing" rather than "only the nudge/un-nudge frames pay it" — deliberately: the
alternative needs its own flag and its own frame-scoping logic for a benefit `cam_dirty`'s own
existing semantics already provide for free. In production this whole block is `.if
projectUsesStreaming`; a non-streamed build's `nmi:` stays the plain, unconditional DMA it already
is, byte-identical to before.

**Interaction with the rest of `cam_dirty`'s own callers, checked, not assumed.** Item 12's own
`camera_slide_tick` (`engine/camera.asm`) brackets `cam_dirty` narrowly around its own two-byte
writes, exactly as before — unextended here, and correctly so: a streamed map never calls
it at all (`map.streamed` routes crossings through the continuous camera tracker instead, per §8's
own transitions table), so the slide and the dialogue nudge/un-nudge hold are mutually exclusive by
construction, never both live on the same build's own live code path. Shake's own per-NMI
composition (`nmi_scroll_cam_shake_*`) reads the already-published `nmi_cam_x_lo`/`nt` snapshot each
frame regardless of `cam_dirty`, so it keeps compositing correctly whether that snapshot is fresh or
held stale — unaffected either way, since it never writes `cam_dirty` itself.

Proven directly (§9), against a real forced overrun (a genuine ~35,000-cycle busy-loop, long enough
that a real vblank's NMI lands inside it — never a JS-side poke), at four separate boundaries: (a)
after the camera write, before `build_oam`/`draw_entities`; (b) mid-way through `draw_entities`'s own
loop; (c) on close, before the final restore packet is published; (d) during the un-nudge itself
(below). At each, the pair actually reaching the PPU — `nmi_cam_x_lo`/`y_lo`/`nt` (what `nmi_scroll`
publishes) against a camera-dependent OAM marker DMA'd for real through the unmodified `$4014`
mechanism — stays coherently old throughout the hold and becomes coherently new, together, only
after release. A negative control (`sw_dlg17_oldbarrier`, reverting to the narrow, fix-16-shaped
bracket) reproduces a genuinely observed mixed pair at both (a) and (d), confirming the fix closes a
real defect rather than one that was never reachable. The floor itself still needs no tie-break:
`AND #$F0` cannot carry (it only ever clears bits of the same byte), so `cam_nt` is provably
untouched by the nudge and every one of the 16 possible remainders has exactly one deterministic
answer.

**Player Move while a box is up: close first, then move, without losing the
script.** A scripted `Move` whose `who` is the player, requested while a box is
open, closes it first through a **close-for-Move draw-down**, not the ordinary end-of-event close:
the same row/attribute drawing `text_close_step`/`text_close_attr` already do, but the tail that
would normally call `close_ui` is skipped — `script_active`, `talk_ent`, `script_ptr` and
`game_state` all survive untouched, because `close_ui`'s own "there is only one way back to
gameplay" clear is for the event genuinely ending, and a Move suspending mid-page is not that.
Concretely: the instant `mv_left` becomes nonzero while `game_state == ST_DIALOG` and a box is still
open, a close-for-Move draw-down is armed (one new flag latching for the draw-down's own duration);
`ui_tick`'s own priority — today `mv_left` is checked *before* `game_state`, so `move_tick` would
otherwise start ticking the instant the Move suspends, stranding the close mid-draw — is patched to
finish the draw-down first, falling through to the ordinary `game_state`-dispatched `text_tick` while
it runs and only handing the frame to `move_tick` once the box has actually reached `BOX_CLOSED`;
`text_close_attr`'s own tail, patched the same way, sets `box_state = BOX_CLOSED` and returns
directly instead of calling `close_ui` while the draw-down flag is set, and takes the ordinary
`close_ui` path unchanged whenever it is not (every other close is byte-for-byte what it already
was). Once the box is down, `move_tick` runs with **normal camera tracking and normal arming** — it
calls the same accumulator/crossing/arm step ordinary held movement does, so a streamed strip can arm
and fully drain *while* the scripted move is in progress, exactly as it would for the player walking
there by hand — and `move_finish`'s own `script_resume` call, unmodified, finds `script_active` still
set and continues the suspended page for real, into whatever follows the `Move` (typically a second
`Say`, reopening through the identical pending-open path, from scratch — nothing about the
interrupted box's own drawn content is remembered or restored automatically). Proven directly (§9)
against a real, hand-placed `Say → Move(player) → Say` event driven through the genuinely
unmodified `script.asm`/`text.asm`/`ui.asm` machinery (a real button press dismisses each `Say`): the
close-for-Move draw-down runs to completion with `mv_left` provably untouched throughout, the Move
then ticks the player a real 16px, and the second `Say` genuinely opens — `script_resume` having
found the page still alive. A negative control confirms the failure mode this fixes: routing the
same close through the *ordinary* `close_ui` (what a naive "just close it" fix would do) strands the
page — `script_active` reads 0 by the time `move_finish` calls `script_resume`, so it finds nothing
to resume, and no second `Say` ever opens. The disclosed cost is the same visible one this document
already named: **the box visibly drops for the walk**, closing before the player moves and not
reopening until the next `Say` explicitly raises it again (§1) — now proven to preserve the
*conversation*, not merely its own visual reappearance. NPC Moves never touch the camera and need
nothing: they are not the player, so they carry no camera-tracking obligation and cannot arm a strip
at all (§6's own "actor policy, current screen only"), and a non-player `Move`'s own suspension is
unaffected by any of this — the close-for-Move detector only ever arms for `mv_who != 0` reaching
`mv_left`, i.e., the player.

**A scripted player `Move` on a streamed map never crosses a screen-ownership boundary at all — but an
earlier draft of this section got the *bound* wrong.** The hazard this
closes: `OP_MOVE`/`OP_TURN` read and write the mover's position and facing through `talk_ent`
(`move_get_x/y`, the setters, and `move_face`, `engine/entities.asm:807-864`) — a slot **index**, not a
stable identity. If a player `Move` crossed a screen boundary, the crossing would repopulate the
entity array for the newly-owned screen (§1's own "a non-player actor on the screen the player just
left disappears the instant the crossing commits"), and `talk_ent`'s own slot could then name a
completely different actor. A page such as `Move(player, across the edge) → Turn(Self)` would silently
turn whichever actor now happens to occupy that slot on the new screen — not the one the conversation
was actually with. The rule removes the hazard rather than working around it: the mover simply never
reaches the far side, so `talk_ent`'s own screen never stops being current for the rest of the page,
and no identity scheme is needed at all. **This much survives unchanged.** What does not survive is
the earlier claim that `move_tick`'s own *existing, unmodified* `MAX_X`/`MAX_Y` wall test already
implements it correctly, with no engine change at all.

**`MAX_X`/`MAX_Y` (240/224) and the natural 256/240 ownership origin are different bounds on the same
top-left position, not the same edge.** `MAX_X`/`MAX_Y` are the *actor-containment* rectangle every
NPC is walled at (§6) — `256 - 16`/`240 - 16`, the sprite's own leading-edge bound. The player's own
*ownership* rectangle is the full `256`/`240` a screen actually spans (§1, §7: streamed player
coordinates legally reach x=0-255, y=0-239, the identical range held movement and Save already admit)
— a real, `16`/`16`-pixel-wide **fringe** (x 240-255, y 224-239) exists between the two where the
player's own top-left position is legally past containment but has not yet crossed ownership.
`move_tick`'s own unmodified wall test gets this fringe wrong in two different ways, not one:

- **Rightward, it silently wraps rather than blocks.** `clc; adc mv_step; cmp #MAX_X+1; bcs move_wall`
  reads the *sum after* the addition, never the addition's own carry. From a legal x=255 with
  `mv_step=1`, the sum is `0` (a true 8-bit overflow) and `0 < 241`, so the wall never fires — the
  player teleports to x=0 on the same, still-current screen, mid-walk, on ordinary open terrain.
  x=254 with `mv_step=2` wraps identically. This is a real, silent teleport bug, not a cosmetic one.
- **Downward, the SAME test wrongly blocks a legal position from ever moving further.** `MAX_Y+1=225`
  refuses any downward step once y is already ≥ 224 — but y=224-239 is *inside* the legal fringe, so a
  scripted Move can never walk the player down through it at all, even though held movement and Save
  both already admit that range. (Leftward/upward have no such bug on their *own* axis: `sec; sbc
  mv_step; bcc move_wall` already detects going below 0 correctly regardless of the bound chosen — the
  defect is specific to the two *increasing* directions.)

**The fix: bound a streamed player's Move by the natural ownership rectangle (x 0-255, y 0-239), with
arithmetic that is actually safe at each axis's own true ceiling.** X's own ceiling (255) sits exactly
at the byte's own natural wraparound, so the correct test is the addition's own carry alone — `clc;
adc mv_step; bcs move_wall` — no compare needed or correct there at all, closing the wrap defect by
construction (a carry out of the byte **is** "past the legal range," full stop). Y's own ceiling (239)
has real headroom below 256 (the largest reachable sum is `239 + PLAYER_SPEED` — at most 241 — never
overflowing a byte), so the existing `cmp`-based shape stays correct with only its constant changed:
`cmp #240` in place of `cmp #225`. Leftward/upward keep their existing `sec`/`sbc`/`bcc` test
byte-for-byte — the floor (0) does not change, and it was never the buggy side. **This IS a small
engine change** — a streamed-map, player-only branch in `move_tick`'s own right/down bound tests,
gated on the new production byte `map_is_streamed` (§4, item 4's own name for "the current map's own
streamed flag") **and** `mv_who != 0` — never a claim that no code change is needed. `map_is_streamed`
is what lets a *mixed* project keep an ordinary-map Move byte-for-byte at the old `MAX_X`/`MAX_Y` test
(a runtime fact a compile-time gate alone cannot express, the identical reasoning behind the
capped-knockback map-mode branch, §4) while a streamed map's own Move reaches the full fringe. An NPC
mover is unaffected either way — `mv_who == 0` always keeps the unmodified `MAX_X`/`MAX_Y` test,
regardless of `map_is_streamed` — since an NPC's own containment already keeps it clear of the fringe:
it never occupies x > 240 or y > 224 in the first place, so the extended bound never has anything to
extend for it.

**The collision probe is the other half of the fix, and needs its own care: reaching the fringe makes
some of `move_tick`'s existing probe points straddle a real screen boundary, and one of the two axes
fails differently from the other.** Every probe point is the mover's own coordinate (after the step,
for the axis actually moving; unchanged, for the other axis) plus a fixed body offset — `BODY_R=13`
(right), `BODY_L=2` (left, and the *other*-axis probe shared by every vertical move), `BODY_T=8` (up),
`BODY_B=15` (down, and the *other*-axis probe shared by every horizontal move) — fed into
`probe_type`'s own index formula, `(probe_y AND $F0) + (probe_x >> 4)`, against the **current**
screen's own `[mtptr]` table. Once either coordinate is in the fringe, the corresponding probe offset
can push that specific probe point onto the *neighbouring* screen's own territory:

- **X (`probe_x`) never causes an out-of-range table read, only a wrong-screen one.** `probe_x` is
  stored as an ordinary byte, and `probe_type`'s own `probe_x >> 4` term is always 0-15 for any byte
  value — so an overflowing sum (e.g. `mv_tmp=243, +BODY_R(13)=256`) simply wraps to the byte value
  that, numerically, already equals the correct neighbour-local x (`256 mod 256 = 0`) — but
  `probe_type` still dereferences the **current** screen's own table at that column, silently reading
  the wrong screen's terrain rather than crashing.
- **Y (`probe_y`) is worse: a genuine out-of-range table read.** The metatile array is 240 entries
  (15 rows × 16 columns, rows 0-14). `probe_type`'s row term is `probe_y AND $F0` — for `probe_y` in
  240-254 (reachable the instant the mover's own relevant y coordinate is in the 225-239 fringe for a
  `BODY_B` probe, or 232-239 for the smaller `BODY_T` probe — reachable on an **UP** move too, not
  only DOWN, since `BODY_T` is added to the *decreased* position which can still be in the fringe
  right after one small step up from y=239), the masked row term becomes 240 or more — one row past
  the real array, reading whatever RAM happens to sit next to `mt_collision` as if it were a
  legitimate collision byte.

**The fix routes a straddling probe through the collision/probe bound (§6, point 3) instead of the
current screen's own table — a neighbour outside the *authored* grid is a wall, unconditionally,
non-mutating; a neighbour inside it is a real, bank-switched read via `sw_peek_byte`, restoring the
caller's own current field screen afterward, exactly the contract §6 already specifies for this
shape of probe.** Concretely: after computing each probe coordinate the ordinary way, the addition's
own carry (X) or a `cmp #240` (Y, using the identical safe-because-bounded reasoning the same-axis fix
above already established) marks whether that axis crossed; if either did, the neighbour's
`(screenCol, screenRow)` is `(sw_col, sw_row)` plus 1 on whichever axis (crossings only ever go
forward — `col+1`/`row+1` — never backward, since every offset here is added, never subtracted, and a
decreasing move's own probe offsets are too small to ever push a coordinate negative), checked against
`sw_grid_w`/`sw_grid_h` before any bank switch is attempted; out of range answers solid directly, in
range reads the real neighbour screen's own real terrain. Every one of the four movement branches
needs this treatment somewhere: the two "same-axis" forward probes (`BODY_R` for right, `BODY_B` for
down) and the two "other-axis" probes shared by both directions on an axis (`BODY_B` for every
horizontal move, `BODY_L` for every vertical move) — `BODY_T` (up) and `BODY_L`/`BODY_R` used as the
*same*-axis probe for left (small offsets against a *decreasing* coordinate) are the only two of the
six offset-additions in `move_tick` that can never straddle from a legal starting position, and even
those two still route through the identical shared check for uniformity, at zero cost, since it is
unconditionally a no-op there.

**Ordinary held movement is unaffected**: this fix lives entirely in `move_tick` (the scripted-Move
driver), never in `update_player` (the held-movement driver) — the player still crosses continuously
under normal walking, exactly as §5/§6 already specify; only a *scripted* Move targeting the player,
on a streamed map, is affected by any of this.

**Byte bound (for the ledger): ≈277 bytes combined (kernel-lo +32, kernel-hi
+245), measured, not yet isolated from its own test scaffolding** — §4's ledger table has the
full breakdown and the three new rows this adds.

**Proven directly (§9), not merely re-argued in prose**: a real `[Move(player, DIR, 250px) →
Turn(Self) → Say]` event, driven through the completely unmodified `script_page`/`script_run`/
`script_op_move`/`move_face`/`script_op_turn`/`script_op_say` chain, from every one of the six named
starting positions (x=240/241/254/255, y=224/225/239), both `PLAYER_SPEED` values (1
and 2, via a test-only speed override — production's own `PLAYER_SPEED` is the fixed constant 2), all
four directions: the final position always stays within the legal 0-255/0-239 rectangle, the position
observed across the *whole* walk (not merely the final one) never dips back toward 0 the way the
unfixed test does, `talk_ent` still names the original speaker throughout, the script genuinely
continues into `Turn(Self)` and a real `Say` (`box_state` reaches `BOX_ENDWAIT`), and the seeded
"NPC"'s own identity (`ent_actor`) is untouched — 416 assertions, 0 failures. Dedicated crossing-
coverage cases (not merely inferred from the final position) prove each of the four probe-crossing
branches genuinely fires exactly when the formulas above predict — including an UP move crossing
*down* via `BODY_T`, and a LEFT/DOWN move crossing via the *other* axis's `BODY_B`/`BODY_L` while its
own moving axis stays put — and that the ordinary same-screen path is what runs everywhere else
(a coverage counter for each, asserted non-zero or zero as predicted, never merely "the position
looked plausible"). An NPC mover and a player on an *ordinary* (non-streamed) map both still stop
at `MAX_X`/`MAX_Y` (240) exactly as today, from the identical fix-round-17-accepted x=236 starting
point, even on this same, now-patched build. **Negative control**: forcing the pre-fix-22
unconditional `cmp`-based test (`map_is_streamed` bypassed) reproduces the wraparound directly, through
the same real call chain — x=255/step=1 and x=254/step=2 both genuinely dip to x≈0 mid-walk (observed,
not merely asserted), before the *unmodified* `MAX_X` containment the reverted test still carries
re-catches the player on the way back up, settling at x=240 — the identical unfixed engine's own real,
compound, visible-teleport-then-walk-back behaviour, not a value picked to make the demonstration
tidy.

**Enumerated: nothing else can change which screen is current while `script_active` is set on a
streamed map.** Walking every entry in `EVENT_COMMANDS` (`shared/project.js`): `end`/`say`/`give`/
`take`/`setSwitch`/`clearSwitch`/`join`/`setVar`/`addVar`/`subVar`/`branch`/`choice`/`call`/`music`/
`battle`/`heal`/`damage`/`save`/`turn`/`wait`/`shake`/`visible`/`fade`/`flash`/`sting`/`sfx` touch no
entity's screen-relative position and no `flat_screen` at all; `route` reduces to `move`/`turn`/`wait`
legs (§ "A command that holds commands"), so a route's own `move` leg inherits the identical clamp
just specified, no separate case. `move` is therefore the *only* command that can move anything, and
`warp` is the only command that can change which screen is current — and a `warp` **ends the event
outright** before that change ever takes effect (`script_op_warp` jumps straight to `script_finish`,
skipping the ordinary return-from-call path — `script_active` clears immediately, so there is no
suspended page left for a screen change to outlive). Knockback — the one *non-scripted* way an
actor's position ordinarily changes — cannot occur while `script_active` is set either, since it is
driven from `update_entities`/`update_player`, which never run while the world is frozen
(`game_state != 0`, the same frozen-world gate every suspending command already relies on).

**A `validateProject`-style warning is phase 1, not built**: a player `Move` on a streamed map whose
authored `dist` is large enough that, from *some* legal starting position for the page that reaches
it, the walk could reach the screen's own **ownership** edge (255/239, §7's corrected bound — not the
tighter 240/224 containment wall an NPC stops at), earns a warning naming the Map Forge and the
event — the check can only ever bound the *authored* distance against the screen's own fixed pixel
extent (paired with which edge the Move's direction points toward), since the player's actual
position when the page runs is a runtime fact no static check can know, so it necessarily flags every
Move whose distance is large enough to reach an edge from *some* starting position, not only the ones
that will in any particular playthrough, and it cannot narrow that down for a Move reached only
through a `branch`/`choice`/`call` whose own runtime path might have already constrained the player's
position further.

**Close and resumption: an explicit drain-acknowledgement state, not a status-byte race.**
`DLG_CLOSING_DRAIN` is entered the instant the close sequence's own final packet is *queued*
(`text_close_attr`'s equivalent), same frame, and is left on the first mainline frame where
`vram_ready` reads 0 **and** that frame's own tick queued nothing new for the box — true by
construction, since `DLG_CLOSING_DRAIN` itself never calls `vram_open`. This is deliberately not the
prior text's `box_state == BOX_CLOSED AND vram_ready == 0` formulation: that gate could still accept
the exact case it worried about (the last packet queued, `vram_ready` not yet cleared by a drain that
has not run) on any frame where `vram_ready` happened to read 0 for an unrelated reason. The explicit
state removes the ambiguity — there is no byte whose meaning is "closed, maybe drained, maybe not";
there is a state that means exactly "closed, not yet acknowledged" and a transition out of it that
only fires once a real NMI has actually drained the real queued packet. Proven directly against a
manufactured overrun (a frame that queues the final packet and then genuinely fails to reach its own
`vram_ready = 1` store before the next vblank, so that vblank's NMI sees the stale value and skips
the drain exactly as `vram_ready`'s own "a frame that ran long" contract already documents): resumption
lands two frames later than the non-overrun case, never on the queued-but-undrained frame itself, and
the nametable stays byte-identical to its pre-drain state for the whole extra wait. **Ownership
(tracking resumes, arming allowed) AND the camera un-nudge both release at that same acknowledgement
frame** — the world-freeze flag clears there too, not before. (The prior contract split these:
ownership at acknowledgement, the camera restore at queue time — the
reconciliation, below, resolves the split in favour of acknowledgement for both.)

**Un-nudge is an exact snapshot restore, not a re-derived reverse delta — and, runs at
the drain-acknowledgement frame, never at queue time (correcting an earlier
15/16's own choice).** The pre-nudge PPU-scroll pair is snapshotted into `sw_dlg_cam_x_lo`/
`sw_dlg_cam_y_lo` ($03DA-$03DB, already reserved for exactly this) and the
pre-nudge world-origin pair into four new bytes (`sw_dlg15_origin_x/y_lo/hi`, part of §4's own
ledger) at the moment the nudge runs; closing restores both pairs *exactly*, rather than computing
"add the delta back" a second time. This is deliberately the simpler of the two designs, and it is
what makes "does the un-nudge cross a boundary that was not already drawn" a non-question rather
than a geometric proof: the restored position is, by construction, the exact position the window
already held — and was already valid at — before the box ever opened, since nothing arms during the
whole frozen transaction. **Where it runs**: an earlier version ran it at the transition into
`DLG_CLOSING_DRAIN` — the same frame the final packet is merely *queued* — reasoning that nothing
further is ever queued against the aligned addresses once that state is entered, so there was "no
coherence reason to wait." That reasoning addressed VRAM coherence and missed *publication*
coherence: an NMI landing after that queue-time un-nudge but before the final packet's own real drain
(a genuine overrun, or simply the ordinary one-vblank lag) would see the *restored* (pre-open)
`cam_x_lo`/`cam_y_lo` and `sw_cam_origin` published — via the identical `cam_dirty`-held barrier
above, itself now extended through `build_oam`/`draw_entities` of *that* frame — while the physical
box content was still visibly on screen, not yet replaced by the close's own final drained packet: a
real, if narrow, camera/content mismatch window the fix-16 text never proved closed and, once looked
for directly, was not. The un-nudge now runs inside `sw_dlg15_t_closing_drain`'s own transition to
`DLG_IDLE`, at the exact same instant ownership releases (above) — bracketed by the identical
`cam_dirty` hold the nudge itself uses (a call to `sw_dlg15_unnudge` now also raises and holds
`sw_dlg17_camhold`, released the same end-of-frame way), so an NMI anywhere in *this* frame's own
hold window sees the coherent pre-un-nudge pair throughout, and the next NMI after release sees the
coherent restored pair — never a mix of "camera already back" and "box still visibly there." Proven
directly (§9): interruption check (c) confirms the camera stays at its nudged value for the whole
extra wait of a genuine close-side overrun (un-nudge has not run — the acknowledgement condition
was not met); check (d) confirms an NMI landing during the un-nudge itself, now that it runs under
the extended hold, sees the coherent pre-restore pair, never a mix of restored scroll against
not-yet-rebuilt OAM. A negative control (the old, fix-16-shaped queue-time timing) reproduces exactly
the mismatch this reconciliation closes.

**Same-box reuse, nesting, Shake, and the naming sprite cursor**: a same-box continuation (one `Say`
page's box staying open into the next) does not re-nudge — the camera is already aligned, and
re-deriving the identical value is idempotent, so the nudge fires only on the transition into
`DLG_OPEN_ROW` from `DLG_IDLE`/`DLG_PENDING`, never on an already-open box. A nested menu/save overlay
while a dialogue's own aligned camera is already active reuses that same alignment rather than
re-nudging; the un-nudge/rebuild is owned by whichever overlay's own close is outermost. A running
Shake composes after the camera rewrite exactly as it already does today — a fixed aligned camera for
the whole transaction makes Shake's own ±2 px perturbation visually identical to a Shake during
ordinary stationary dialogue on a non-streamed screen. The naming grid's own cursor
(`draw_nameentry_cursor`, `SPRITE_ARROW_TILE`) is a **sprite**, positioned in ordinary screen-space
OAM coordinates (`de_ex`/`de_ey`) exactly like any other drawn entity — it needs no streamed-map
mapper at all, since OAM is always viewport-relative; only the dialogue box's own text-plane choice
cursor (`ARROW_TILE`, a nametable write) routes through the address mapper above.

**Frame counts and timing, measured against a real prototype build, not arithmetic alone — nine
drawing transactions distinguished from the end-to-end open/close totals.**
**9 frames draw the box each way** (6 row + 3 attribute) — better than a per-packet accounting would
suggest, because a split row's own two packets, and a split attribute band's own two packets, queue
and drain together, one transaction per band row rather than one per packet. Those 9 are not the
whole story on either side: **open pays a pending phase before its own draw starts**, and **close
pays a drain-acknowledgement frame after its own draw ends** — two different additions, on two
different sides, not both added to both. The pending phase is **1 frame in the best case (no strip
active at request time) and up to 12 real vblanks in the worst directly-measured case** (a real
32-block strip already draining, with a concurrent Flash burst, measured directly, above). **This
figure already counts its own transition frame as its last tick — it is not a quantity that a
further "+1 for the transition" gets added to**: the trace this document's own evidence table cites
measures the pending phase as ending the instant the state machine leaves `DLG_PENDING` for
`DLG_OPEN_ROW`, so "up to 12 vblanks of pending latency" and "the one same-frame transition frame"
are the identical quantity at its two extremes (1 when there is nothing to wait for, up to 12 when
there is), never two figures to sum. **Open therefore totals 10 frames in the best case (1 pending +
9 draw) and up to 21 in the worst directly-measured case (12 pending + 9 draw).** Close's own
drain-acknowledgement is a genuinely separate, single additional frame in the ordinary case — close
never waits for anything before its own draw starts, so there is no pending-phase-shaped quantity to
conflate it with — giving **10 frames to close in the ordinary case (9 draw + 1 acknowledgement)**.
Under a genuinely manufactured overrun (a frame that queues the close's own final packet but fails to
reach its own `vram_ready = 1` store before the next vblank), the one directly-tested case resumes
**two frames later than the non-overrun case's own resumption** — an *observed* delay for that
specific, single-vblank-missed overrun, not a general bound on an arbitrarily longer one: this
document has measured exactly the one overrun shape named in §9, not the relationship between overrun
length and resumption delay in general. **There is no aligned fast path, and the old "unchanged at
7+7=14" claim does not hold — no aligned fast path back to that figure was ever specified or proven.** The attribute
band (3 of the 9 open/close frames each way) is never skippable: the box palette must be set
regardless of whether the camera happens to land nametable-aligned, since alignment changes nothing
about which quadrants the box's own three metatile rows occupy. **Best case, end to end — no strip
active at request time, no overrun on close — is 10 frames to open, 10 to close (20 total)**,
measured directly. That is 6 frames worse than the ordinary (non-streamed) screen's
own 7+7=14, not equal to it — the real, disclosed cost of routing every packet through the
split-at-seam mapper even when nothing this transaction touches happens to straddle a seam. Real
Mesen timing at the worst single-transaction
queue (38 bytes), both boards, with Shake active and (MMC3) the split forced to its longer program:
passes with real margin on both boards; the existing exclusive-drain mechanism's own boundary (not
new to this feature) misses first on MMC3 at 175 bytes, on UNROM 512 at 210 — both roughly 4-5× this
design's own real worst case.

**Proven, as combined traces of real frames (jsnes; mainline and NMI in the engine's own order, never
a synchronous stub)**: the pending-open wait against a real 32-block strip plus a real concurrent
Flash burst (12 vblanks, matching the predicted worst case); idle open frames queuing nothing, a
typed-character write and a choice-cursor write each landing at the mapped address; close with a
genuinely manufactured overrun, resumption at the correct boundary and nowhere earlier, nametables
byte-identical to a realistic pre-open scene; the identical open/close sequence at a map-edge clamp
origin and at the seam-crossing origin (1,13); the old (deadlocking) gate failing exactly as claimed,
against a live watchdog; the camera/OAM publication barrier holding coherent at four targeted
interruption boundaries under a real forced overrun, with a negative control reproducing a genuine
mixed pair at two of them; a real, hand-placed `Say → Move(player) → Say` event, driven through the
unmodified `script.asm`/`text.asm`/`ui.asm` machinery with real button presses, proving the
close-for-Move draw-down preserves `script_active`/`talk_ent`/`game_state` and that `move_finish`'s
own `script_resume` genuinely continues the page, against a negative control that strands it through
the ordinary `close_ui`; a real, hand-placed `[Save, End]` event against the streamed overlay
genuinely `OPEN_IDLE` and holding real typed content (via the real `sw_dlg12_write_tile` primitive),
proving the commit is genuinely deferred until the overlay's own real, drain-acknowledged close
finishes (the typed content gone, replaced by real field content, before the commit ever runs),
`attr_shadow` and a deliberately-staled OAM shadow both rebuilt and DMA'd fresh before rendering
resumes, the camera restored and republished at its own unchanged value, the script continuing for
real, and a following open reaching `OPEN_IDLE` again through the ordinary pending-open path with
fresh content typing cleanly — repeated at a non-zero, seam-crossing origin — against a negative
control (`sw_dlg20_oldresync`) that reproduces the empty-box-redraw defect exactly, through the same
real call chain; and a real, hand-placed `[Move(player, across the edge) → Turn(Self) → Say]` event,
driven through the completely unmodified `script.asm`/`entities.asm` machinery, proving the player's
own scripted Move stops exactly at `MAX_X` (240) — `move_tick`'s own existing wall check, unmodified
— so `talk_ent`'s own entity slot is never touched and `Turn(Self)` turns the correct, original
actor, against a negative control (`sw_dlg20_nocrossclamp`) that lets the Move overshoot, simulates
the crossing's own array repopulation, and shows `Turn(Self)` mutating the wrong (newly-repopulated)
actor's facing instead. See §9.

**Not built**: the nudge/rounding computation, the world-camera-origin update, the camera/OAM
publication hold, close-for-Move, close-for-Save and the Save resync are all real code across these
rounds — what remains unbuilt is feeding `cam_x_lo`/`cam_y_lo` *continuously* from the player's own
live position (the still-unbuilt "camera register fed continuously" scope, §10 point 4), which none
of this document's own snapshot/restore or close/resync mechanisms need, since every dialogue
transaction and every Save commit holds the camera fixed (or merely re-publishes its unchanged value,
or restores its pre-open value via the identical un-nudge close-for-Move already uses) by
construction; and **the actual production wiring into the real `box_begin`/`text_open_step`/
`text_close_step` state machine remains phase 1/2** — the camera/OAM barrier and the Save resync (now
including close-for-Save) are proven against the streamed overlay's own `sw_dlg15_*` lifecycle (which
stands in for the eventual production box, a substitution already disclosed elsewhere in this
document), while
close-for-Move is proven against the REAL, ordinary (non-streamed) box specifically, since its own
defect — script state lost across a close — is general to any box implementation reached through
`script_op_move`'s real suspension, not specific to the streamed overlay; connecting a real `Say` on a
streamed map to the streamed overlay's own open/close requests (so the two proofs become one system,
and close-for-Move/close-for-Save could share one literal flag rather than two) is still unbuilt
production wiring, not a gap in either individual proof. The player-Move screen-ownership clamp needs
no production wiring at all beyond what already ships — it is `move_tick`'s own existing, unmodified
wall check. The zero-page allocation for the mapper/packet-writer scratch and the lifecycle bytes is
resolved (§4 — `sw_axis_pref` at `$C7`, the overlay and lifecycle each shifted up by one
byte); the camera/OAM barrier's own three production bytes (`sw_dlg17_camhold`/`move_close`/`resync_i`) and this
round's own production byte (`sw_dlg20_save_pending`) are placed at `$07F0`-`$07F8`, disclosed but not
ledger-resolved (§4); wiring any of this into the
actual shipped source files (`dlg_fix12.asm`/`dlg_fix15.asm`/`dlg_fix17.asm`/`dlg_fix20.asm` are
themselves left as historical scratch, never edited in place) remains phase 1/2.

## 8. Transitions and lifecycle

| Transition | Active strip | `screen_fresh` | Spawn/entry event | Overlay | Camera publication |
|---|---|---|---|---|---|
| Ordinary crossing (continuous) | Continues uninterrupted | Set (ownership changed) | Armed for the newly-owned screen | None | Continuous, unaffected |
| Same-map warp/door | Cancelled, reinitialised via the one warp handshake | Set | Armed (a warp is always a fresh context) | None | Reset to the target's own resolved window origin |
| Battle entry | Cancelled **before** `call_battle` — protects battle's own VRAM writes (streaming's hot path reads the fixed kernel-lo metatile catalogue, never the switched field-data bank, so an in-flight chunk would not fail, it would corrupt battle's own drawing) | N/A (world frozen) | N/A | Battle screen | Frozen |
| Battle return | Needs its own `sw_render_window` resync dispatch — `battle_end` redraws the field it never left, through the ordinary `redraw_screen` path today, which a streamed map cannot use | **Set** — re-settles the field's own owed work, independent of ownership | Spawn/restoration re-runs (real, needed); the **entry event** is suppressed — the redraw must not re-arm what a fresh arrival would trigger | Field, restored | Resynced fresh at the resume point |
| Menu open | Continues uninterrupted (an already-active strip always drains, in every state — the gate on `sw_nmi_stream` is `st_active` alone, never `paused`/`game_state`, below); arming a new strip stays forbidden while the menu is open, the real, demand-side thing `paused OR game_state != 0` forbids | Unaffected | N/A | Menu over the frozen field | Frozen while open |
| Dialogue open | Continues uninterrupted (an already-active strip always drains, in every state); a new open request enters `DLG_PENDING` and waits for it to idle before arming is possible again, plus the camera-nudge transaction (§7) | Unaffected on the field | N/A | Message box, via the mapper | Nudged at open (pending-phase gated), restored at the close drain-acknowledgement (§7) |
| Flash save | If a box is up (`DLG_OPEN_IDLE`), cancelled **before** the commit ever runs — close-for-Save (§7) closes it first, the same drain-acknowledged close a Move gets; once closed (or if no box was ever up), the resync runs inside the render-disabled save transaction, **in place of** the plain `enable_rendering` tail, not merely before it | N/A (already cancelled by the close, if one was needed) | Not respawned/armed — a resync is not a crossing | The box is genuinely **closed** by the time a commit runs (not merely painted over) — `sw_render_window`'s own redraw is terrain-only, no box content left to redraw; a live Save genuinely can interrupt an open box (§7, correcting the prior "temporally exclusive" premise), it just closes it first rather than redrawing it in place | OAM rebuilt and DMA'd fresh, then re-published at its own **unchanged** (already-restored-by-the-close, if it was nudged) value before rendering resumes — `enable_rendering`'s own hardcoded `(0,0)` scroll reset is not used, since it would discard whatever camera position was actually held. Battery boards (MMC1/MMC3): unaffected — no close, no resync, the commit is instantaneous and the box is untouched |
| Continue | Cancelled | Set | Armed | None | Reset via the same one-initialiser resolution as a warp |
| ▶ Test | Cancelled | Set | Armed | None | Reset via the identical warp handshake |
| Game over | Cancelled | N/A | N/A | Game-over screen | Reset at the next session's start |
| Teleport resync (lag guard) | Cancelled, replaced by a full `sw_render_window` | Not set — no ownership change | Not armed | Whatever was on screen | Resynced to the corrected window origin |

**The gate on `sw_nmi_stream` is `st_active` alone, never `paused`/`game_state`.** An earlier version
of this contract additionally gated NMI's own strip service on `paused OR game_state != 0` — the same
byte `main_loop`'s own world-update dispatch checks — and that was a real, proven deadlock (§7's own
pending-open phase, finding 3): a box waiting for an active strip to idle before it may open, under a
gate that *also* stops the strip's own NMI service the instant the world freezes, can never see the
strip finish, because the freeze that starts the wait is what silences the only thing that could end
it. What `paused OR game_state != 0` actually needs to forbid is **arming** a new strip — a real
demand-side rule (§5's "What `game_state != 0` forbids is *arming*, with the one exception" for a
player Move already closing its box first) — never **servicing** one already in flight. `st_active`
is therefore the whole gate: nonzero, NMI drains it (a full chunk, or a reduced one on a mixed
vblank) in every state, frozen or not; zero, there is nothing to drain regardless of `paused`/
`game_state`, so the byte was never doing any work of its own even before this correction — it was
only ever wrong on the one path (§7's own pending-open wait) that could observe the difference.
Proven directly: the old gate reproduces the deadlock exactly as claimed (a live watchdog exhausted
with the strip still active), and the `st_active`-only gate opens the identical workload normally —
see §7's own combined trace and §9.

**Bound tiles are forbidden on a streamed screen.** No streaming read this design has proven or
specified resolves a switch-bound tile's own current variant — the entering edge of a strip, a full
redraw, and a neighbour peek would all show a bound tile's base id, never whichever variant a Flash
edge or a switch last selected. `validateProject` refuses a nonzero bound-tile count on any streamed
screen, naming the Map Forge and the screen — the 338-byte record still reserves the full
`BOUND_CAP` bytes regardless (PRG space is not scarce here), it is simply never populated. Entering
a streamed map through a mixed project must zero `bind_count`/`flip_pending_count` at entry, so a
flip armed on the screen just left does not keep draining; any later rebuild path reading
`screen_bound_lo/hi` by `flat_screen` (`rebuild_bound_cache` is the concrete case) must branch on the
map-type bit first, taking a zero-record accessor for a streamed screen rather than indexing a table
that was never sized for it.

**▶ Test goes through the existing warp handshake, never a direct `sw_*` poke from the renderer.**
`testplay.js` pokes `warp_scr`/`warp_x`/`warp_y` exactly as it does for an ordinary map today; the
engine's own warp-entry initialiser (once built) does the `sw_goto`-style resolution internally —
the same path Continue, a door's `ent_to_scr`, and a warp command's own `screen` operand all resolve
through, so there is exactly one place that decides "how do I land on a streamed screen," never two
independently agreeing by luck.

**The camera checkbox stays project-wide, with no per-map hiding.** `CAMERA_ENABLED` (the register
and its NMI publication) and `CAMERA_SLIDE_ENABLED` (item 12's own screen-edge slide, used by
ordinary maps' crossings) are unchanged, both on whenever any map in a mixed project needs either —
a streamed map's own crossing simply never calls the slide code at runtime; `map.streamed` is what
decides the runtime path, with no UI change needed at all.

**The Map Forge minimum**: a "Streamed" checkbox on a map's own properties (visible only when
`streamCapable`), replacing `growOrShrinkMap`'s own `LIMITS.mapGrid` read with the aggregate check
(§4) for that map; per-screen editing is unchanged from today's metatile painter (a streamed
screen looks and edits identically to a non-streamed one); a minimum click-to-select world overview
(the existing item-7 grid picker, extended to address a streamed map's own `(screenCol, screenRow)`
rather than a flat index, scaled to stay usable past a handful of screens) is committed as a phase-4
deliverable — `design-maporg.md` §12's own richer interaction (warp/entry overlays, a zoomed
thumbnail, pan/zoom) remains that document's own scope.

## 9. Evidence table

Every script below was re-run this round, against the current codebase, from the fix-12 scratch
prototype (`handoff-next/streamed-worlds-scratch-backup-fix12.tgz`, restored and rebuilt where a
build artefact was not itself archived — `.nes`/`.patched.nes` files are excluded from that archive
by size policy and were reassembled with `nesasm` and `shared/cartridge.js`'s own `applyHeaderPatch`,
never hand-edited). Commands are relative to the repo root with the scratch `proto-tools/` and
prototype project directories placed there for the run and removed afterward.

| Claim | Script | Result | Limitation |
|---|---|---|---|
| The torus's physical mapping is correct at both parities, retention holds across successive strips, reversal round-trips exactly, a resident single-transaction restore works, a genuinely banked caller's restore works | `node proto-tools/verify_torus.mjs` | **61/61 ALL PASS, exit 0** | jsnes functional proof, not a timing proof (that is Appendix B's own Mesen checks) |
| Every terrain/attribute read is fill-aware, on a 1×1/1×N/N×1/3×3 grid, both strip arms and the renderer | `node proto-tools/diag_r10_smallgrid.mjs` | **528 observations, ALL PASS** | jsnes, functional only |
| The banked strip-fetch primitive's own fill path | `node proto-tools/diag_r10_primitive_fill.mjs` | **4/4 PASS** | — |
| The full unaligned × all-parity render regression | `node proto-tools/diag_r10_full_parity.mjs` | **7,680 comparisons, ALL PASS (107.6 s)** | Sampled tile reads over the origin × parity sweep (every local-offset combination, all 4 physical nametables, both strip directions), not an exhaustive per-tile/per-attribute readback of a rendered screen; many of the sampled comparisons resolve to fill past the 3×3 fixture's own real extent, by design |
| The fill-aware banked strip arm, proven from a genuinely banked caller, real cycle costs | `node proto-tools/diag_r10_banked_strip.mjs` | **ALL PASS** (2,378-2,877 cycles per complete arm, 8.0-9.7% of a frame) | Required rebuilding `main.patched.nes` with `applyHeaderPatch`'s `saveEnabled` argument matched to this board's own `SAVE_ENABLED=0` (the header patch is a build artefact of its own, regenerated whenever `main.nes` changes, per this document's own standing trap) |
| Every resident label falls inside `$E000-$FFF9`; music/text's own end (via `main.asm`'s literal include order) falls below the resident span's start; the resident span's own real end (from the caller's real `nesasm -s` bank-63 total, not a label-start guess) falls below `$FFFA`; a label textually present but missing from `main.fns` FAILS rather than being silently skipped | `node proto-tools/check_r10_symbol_ranges.mjs minimal-u512-fix16 <bank63UsedBytes>` | **ALL PASS, exit 0** (fix round 16: widened per review 9 finding 6 — was start-only, silently skipped a missing symbol) | The end-of-bank-63 check needs the real `nesasm -s` total as an argument; it cannot be re-derived from label starts alone, which are blind to a label's own trailing bytes |
| The window/viewport clamp is exact at all four edges/corners of a real grid | `node proto-tools/diag_r2_clamp.mjs` | **14/14 PASS** | — |
| The fill-aware terrain resolver, the reviewer's own exact small-grid reproduction | `node proto-tools/diag_r5_fill.mjs` | **PASS**, all five cases | — |
| Camera projection, double-centring and negative-edge bugs fixed, 14 independent cases | `node proto-tools/diag_r5_projection.mjs` | **ALL PASS** | — |
| The dialogue close-path accessor vs. an independently-resolved direct call, 7 wrap/fill cases | `node proto-tools/diag_r7_dialogue_accessor.mjs` | **ALL PASS** | — |
| `sw_goto`/`sw_read_transaction`/`sw_read_run` real cycle costs, decomposed | `node proto-tools/diag_r4_run_cost.mjs` | Reproduced (149-5,479 cycles depending on coordinate) | — |
| `sw_read_run` proven from a genuinely banked caller, three live hardware banks at once | `node proto-tools/diag_r4_bank_run.mjs` | **PASS** | — |
| The allocator-based packing predicate rejects an oversized record `screenCapacityFor` wrongly accepts | `node proto-tools/diag_r8_packing_predicate.mjs` | **ALL PASS, exit 0** | — |
| The full renderer's unaligned/all-parity regression (fix round 8's own narrower sweep) | `node proto-tools/diag_r8_unaligned_parity.mjs` | **56/56 PASS** | Superseded in coverage by `diag_r10_full_parity.mjs`, kept as a smaller, faster check |
| Per-axis sustained rate, real 6502 execution, worst-case single crossing, 5,000,000-frame lag simulation | `node proto-tools/diag_r7_sustained_rate.mjs` | **ALL PASS** (1.5/1.4375 px/frame exact; lag never exceeds 1 block on either axis) | — |
| The shared single-server scheduler model (not independent per-axis queues) | `node proto-tools/diag_f9_shared_strip_lag.mjs` | **PASS** | Superseded in coverage by `diag_f14_scheduler.mjs` below (identical single-server property, corrected geometry); kept as a smaller, faster check |
| Historical only — **does not back any positive claim about the shipped mixed-vblank policy.** `diag_f9_flash_priority.mjs` implements review 9's own rejected lag-priority/defer policy (including the recurrence bug that policy had), never the corrected mixed-drain arbitration `build_f11_mixed_vblank_fixture.mjs`/`diag_f14_scheduler.mjs` actually prove | `node proto-tools/diag_f9_flash_priority.mjs` | **PASS** (against its OWN, superseded policy — a passing run says nothing about the shipped mechanism) | Retired; kept only as the historical negative control the fix-round-9 report quotes, never re-labelled as current evidence again |
| Historical only, kept for its own three negative controls' record — **superseded as a positive validity claim by `diag_f18_scheduler.mjs` below**: this script's own `checkViewport` only ever computed `abs(desired-current)` margins, never a real visible-vs-completed-content rectangle, and its `desired` formula substituted the player's raw block for `camBlock` (review 10 finding 2; see the true-containment row below for what replaces it) | `node proto-tools/diag_f14_scheduler.mjs` | **ALL PASS, exit 0** (unchanged from when it ran) — the pass itself is real, but proves less than fix round 17's own report claimed | Superseded in coverage, not merely re-run; neither this script's own `checkViewport` nor its `desired` formula back any current validity claim any longer |
| **True geometric viewport containment (fix round 18, review 10 finding 2)**: every frame, the visible block rectangle (from the clamped, pixel-precise camera position, `camPx = clamp(playerPos-centre,0,mapPixels-viewportPixels)`, `centre=120/112`) asserted as a subset of the conservative completed-content rectangle (the window's own `current`, with the entering edge excluded while a strip services that axis) — held axis (both directions), turning, reversal at 1/2/3/5 crossings **and both signs of starting backlog**, a map clamp with the player/camera **actually walled** (not merely a clamped `desired` behind an unbounded `pos`), the touch-corridor Flash workload with contacts generated from the scheduler's own real post-movement positions (no private shadow accumulator), the interact-mash Flash workload at **five press periods (2/3/4/5/7) plus an irregular pattern**, the combined workload, capped knockback in **all four directions through the identical scheduler+assertion**, an already-active strip at the instant the guard fires, fine-scroll remainder coverage (0-15, both axes), the guard's own forced-jump proof (all four directions, with/without an in-flight strip, under an explicit forced-blank resync model), a periodic late-vblank (overrun proxy) at six recurrences with and without the guard's resync active, and seven negative controls (wrong Y speed; unbounded no-policy mash; the old off-centre geometry; review 10's own pixel-257 counterexample under the old predicate vs. the new; an armed strip's entering edge treated as completed content; an isolated jump with no resync — honestly does not violate on its own; the same jump with continued movement and no resync — genuinely diverges) | `node proto-tools/diag_f18_scheduler.mjs` | **ALL PASS, exit 0.** Every ordinary-gameplay exercise holds real containment slack of 5-7 blocks (never merely a passing lag scalar); the guard fires with exactly 0 blocks of margin at the instant of detection in every direction, and the resync model never publishes a violated frame; the sustained late-vblank exercise genuinely diverges without the guard's resync active and holds indefinitely with it active, re-firing as needed | A real bug was found and fixed while building this: the accepted `desired` formula (fix rounds 14-17) substituted the player's raw block position for `camBlock`, leaving as little as 0 blocks of margin at its tightest remainder under true containment rather than the intended 7-8 block buffer; routing `desired` through the real, pixel-precise `camBlock` (the same clamp the visible rectangle already computes) fixed it — a correction to the model's own approximation of the fixed formula, not a change to the formula itself. **Its own guard-resync model is superseded by `diag_f21_guard_order.mjs`, below**: this script ran the containment check before the guard-detection block for the same frame, froze publication at the already-jumped camera rather than the last one actually published, and modelled the blank as exactly one frame while still asserting containment during it. Every held-axis/turning/reversal/clamp/Flash/knockback/fine-scroll containment claim above is unaffected — only the resync portion is superseded |
| The real, unpatched engine's interact-vs-touch Flash timing: interact mashed at the fastest legal period while walking (frozen frames, arm-to-arm recurrence, re-arm-while-active), plus an entry event and a separate touch actor on one screen | `node proto-tools/measure_f14_interact_flash.mjs` | **Reproduced exactly**: 0 frozen frames while in reach of the interact actor (170 frozen frames elsewhere, unrelated screen-edge churn); fastest arm-to-arm recurrence 2 frames; 9 of 10 re-arms observed mid-hold (restore edge dropped); entry event arms and resolves identically to touch's own already-proven one-frame freeze | Built against `mkdtemp` copies of `sample/`; the checked-in fixture is never mutated |
| The real worst reachable mainline arm cost (unaligned origin spanning three screens, UNROM 512's own 61-region ceiling, both orientations, a fill-aware tail control) | `node proto-tools/diag_f14_worst_arm.mjs` | **Reproduced exactly**: `sw_stream_start_col` 7,365 cycles (24.7%), `sw_stream_start_row` 7,668 cycles (25.8%) — both above the near-origin 3,911/4,077-cycle figures fix round 10 measured; the fill-aware tail variant costs 4,014 cycles, cheaper as expected | Region counts checked against the real `gridH × ceil(gridW/24) ≤ 61` packing formula before use, not assumed reachable |
| Historical only — **superseded by `diag_f18_busy_frame.mjs` below**: this script's own classifier, `sorted.filter(v => v < 10000)`, discarded any genuinely ordinary sample over 10,000 cycles by construction (review 10 finding 3), and its own scenario (7 filler NPCs) was not the engine's actual busiest legal content | `node proto-tools/diag_f14_busy_frame.mjs` | Reproduced exactly as before (9,661 cyc) — the number itself is real for what it measured, but cannot be read as an upper bound | Superseded in coverage; not re-run this round |
| **The corrected worst ordinary mainline body (fix round 18, review 10 finding 3)**: classified by EXECUTED PATH (did the mainline body's own PC land on `redraw_screen`, not an elapsed-cycle cutoff), against the actual busiest legal scenario — all 8 `MAX_ENTITIES` slots are chasers with contact damage, a live Shake, a live Flash, and music playing an authored long Sfx note | `node proto-tools/diag_f18_busy_frame.mjs` | **Reproduced exactly: worst ordinary mainline body 11,839 cycles (39.75%)**, NOT 9,661 — 80 real ordinary samples up to this figure that the OLD `< 10000` filter would have wrongly discarded are reported explicitly; NMI stays at 615 cycles (2.1%) even under this busier scenario | No projectile mechanic exists in this engine (grep-confirmed across `engine/`, `shared/`, `main/`) — that named cost category is not applicable, disclosed rather than silently dropped |
| The real, measured worst-case NMI cost for the STREAMED build itself (not the ordinary engine's 615), jsnes cycle-exact, replaying the identical worst-case RAM state the Mesen fixtures use | `node proto-tools/diag_f18_streamed_nmi.mjs` | **MMC3: 1,607 (strip)/1,856 (mixed@35) cycles. UNROM 512: 1,543 (strip)/1,324 (mixed@35) cycles.** Lower than the Mesen-margin-derived figures (§5 uses the Mesen figures as authoritative, conservative) | A known-shaped jsnes/Mesen discrepancy (mapper4's own scanline-IRQ counter, already documented in `build_f9_worst_chunk_fixture.mjs`'s own header comment as a 300-400-cycle inflation/deflation source) — this script is a cross-check, not the accounting's own primary source |
| Fix round 17's `sw_dlg17_camrelease`, called unconditionally every mainline frame (item 1's barrier release) — real cost, both paths | `node proto-tools/diag_f18_camrelease_cost.mjs` | **hold clear (the ordinary, every-frame case): 19 cycles. hold set (the rare release frame): 29 cycles.** | `callRoutine`, against the real fix-17 `minimal-u512` build |
| The knockback displacement table, archived | `node proto-tools/diag_f11_knockback_archive.mjs` | Reproduced exactly (D=24/20/16/12/8 → lag max 7,174/4,674/2,175/2/1) | This is the ORDINARY (non-streamed) engine's own table, kept for historical reference; the streamed-map figure is `diag_f14_scheduler.mjs`'s own knockback exercise (lag 0), not this script |
| A real touch-triggered Flash event freezes movement for exactly one frame, against the real engine | `node proto-tools/measure_f11b_flash_touch_row.mjs` | Reproduced the exact frame trace (freeze coincident with arm, 8 real actor contacts) | Built against an `mkdtemp` copy of `sample/`; the checked-in fixture is never mutated |
| The dialogue overlay prototype: mapper, split-seam packet writer, masked open/unmasked close, pending-strip gate, at five origins including a map-edge fill case | `node proto-tools/dlg_fix12_readback.mjs` (after `node proto-tools/rebuild_fix12.mjs`) | **ALL PASS, exit 0** at all five origins; 9 frames to open, 9 to close, 38-byte worst queue | Requires `rebuild_fix12.mjs` run first this session (rebuilds `minimal-u512-fix12` from a fresh copy of `minimal-u512`, injects the prototype, reassembles) |
| The NMI arbitration itself: chunk 3 passes, chunk 4 misses, both boards, both physical parities, with and without a queued drain | `node proto-tools/build_arb_fixtures.mjs <board> <out> <chunk> <chunk> <parity>` then `Mesen --testRunner <out>/sw_nmi_arb_striponly.lua <out>/sw_nmi_arb.nes` (and `_both.lua`) | **Reproduced exactly**: chunk 3 exit 0 on both boards/both parities/both drain states; chunk 4 exit 5 (strip-only), exit 0 (drain-present — the strip yields entirely) | — |
| The true worst non-final chunk (row, odd parity, wrap-crossing), real NMI, camera+Shake+split live | `node proto-tools/build_f9_worst_chunk_fixture.mjs <board> <out> [chunk]` then Mesen | **Reproduced exactly**: chunk 3 exit 0 both boards (real positive margin); chunk 4 exit 5 both boards | — |
| The mixed-vblank branch: a small queue drains and a reduced chunk advances the same vblank; a 3-block chunk misses; a 36-byte queue correctly falls back to exclusive drain | `node proto-tools/build_f11_mixed_vblank_fixture.mjs <board> <out> <reducedChunk> <queueBytes>` then Mesen | **Reproduced exactly**: reduced=1,2 at 35 bytes exit 0 both boards; reduced=3 at 35 bytes exit 5 (`EXIT_DEADLINE_MISS`); reduced=2 at 36 bytes exit 7 (`EXIT_WORKLOAD_SHORT` — the correct, expected outcome: the strip did **not** advance, proving the boundary control routed to exclusive drain, not a failure) | — |
| The dialogue overlay's real worst single-transaction queue (38 bytes) drains inside vblank on both boards; the existing exclusive-drain boundary (not new to this feature) | `node proto-tools/build_dlg_drain_fixture.mjs <board> <out> <payloads>` then Mesen | **Reproduced exactly**: 38 and 76 bytes exit 0 both boards; MMC3 misses at 175 bytes (exit 5), UNROM 512 at 210 (exit 5) | — |
| The historical negative control: the pre-arbitration (unconditional) NMI genuinely misses the deadline on both boards | `node proto-tools/build_unconditional_board.mjs <board> <out>` then `node proto-tools/build_deadline_fixture.mjs <out> <dlOut> 3 3 even` then Mesen | **Reproduced exactly: exit 5 (`EXIT_DEADLINE_MISS`) on both boards** | Confirms the arbitration is load-bearing, not decorative |
| The addressing/reversal proof this document's torus mapping is built on (an earlier, narrower reproduction of the same fact `verify_torus.mjs` T1/T3/T8 now cover) | `node proto-tools/diag_r1_repro.mjs` | **No longer runs meaningfully**: exit 1, both reads return the fill id (0/0), because this script predates fix round 10's fill-aware bounds check and never sets `sw_grid_w`/`sw_grid_h` — every coordinate now reads as out-of-grid | Superseded in coverage by `verify_torus.mjs` (which does set `sw_grid_w`/`sw_grid_h`, per its own inline comment); reported here rather than silently dropped, per this round's own brief |
| The combined dialogue-overlay lifecycle: pending-open wait against a real active strip plus a real Flash burst (12 vblanks), idle-open frames queuing nothing, typed-character/choice-cursor single-tile writes, close with a genuinely manufactured overrun (resumption at the correct two-frames-later boundary, not before), a player Move closing the box first then moving with a strip armed and drained alongside it then reopening, the identical open/close at a map-edge clamp and the seam origin (1,13), and the old (deadlocking) gate failing against a live watchdog while the corrected gate opens the identical workload normally | `node proto-tools/build_fix15.mjs` then `node proto-tools/dlg_fix15_trace.mjs` | **56/56 ALL PASS, exit 0** | jsnes, real `nes.frame()` stepping (mainline+NMI in the engine's real order), not the synchronous `callRoutine` stub `dlg_fix12_readback.mjs` used; the mainline movement/arming driver is still unbuilt (§10 point 2), so a strip used alongside the player Move is poked directly (armed state, not a real crossing-detection arm), matching this project's existing precedent for exercising `sw_nmi_stream` ahead of that driver's own construction |
| Fix round 16: the dialogue overlay relocated out of bank-14 scratch into kernel-hi resident code, one combined production-placed build, debug tables and the old-gate negative control both excluded for real (built without them) | `node proto-tools/build_fix16.mjs` (clean) / `--debug --oldgate` (functional verification variant) | Both assemble clean, exit 0. Clean: BANK 62 (kernel-lo) 7,123/8,192, BANK 63 (kernel-hi) 3,931/8,192. Debug+oldgate: BANK 63 3,974/8,192 (+43, matching the excluded content exactly) | The dialogue lifecycle glue is IDENTICAL logic to `dlg_fix15.asm`, with every `switch_prg_bank` preamble removed (no bank switch needed once resident) |
| The final ROM ledger, measured from that one combined build's own `main.fns` symbol spans | `node proto-tools/measure_fix16_ledger.mjs` | **0 failures.** `sw_goto=$E143` (matches review 9's own cited figure exactly); mandatory resident 2,053 B; dialogue overlay+lifecycle 1,549 B; debug tables +35 B, old-gate +8 B (both excluded from the clean figures, confirmed as real measured deltas, not assumed) | — |
| The final RAM ledger: every streaming byte, real addresses, no overlaps, the `$C7` contention resolved | `node proto-tools/check_fix16_ram_ledger.mjs` | **0 failures.** 9 regions, no overlaps; zero-page gap `$C7-$FF`: 54/57 used, 3 free; `attr_shadow`/`flash_driver` alias confirmed intentional at `$0600` | Resolves engine/constants.asm plus the prototype's own equates via the SAME `scanEquates`/`resolveEquates` `test/lib/equates.js` already provides |
| Every resident label falls inside kernel-hi bounds, range-END checks (music/text end < resident start; resident end < `$FFFA`, from the real `nesasm -s` total, not a label-start guess), and a missing symbol now fails rather than being silently skipped | `node proto-tools/check_r10_symbol_ranges.mjs minimal-u512-fix16 3931` | **ALL PASS, exit 0** (also verified against the debug+oldgate variant at 3974) | Widened this round per review 9 finding 6 |
| Historical — the resync guard's own fix-16 proof (lowered from 8 to 6, `≥1` block of margin claimed under the `abs(desired-current)` proxy) — **the margin claim is corrected below under true containment; the guard value (6) itself is unchanged and still current** | `node proto-tools/diag_f14_scheduler.mjs` | Reproduced exactly as before | Superseded as a margin claim by the row above (fix round 18); the guard's own value (6) was never in question |
| Fix round 16 Mesen re-timing: worst chunk-3 strip-only (Shake on, split forced), mixed vblank at 35 bytes/reduced chunk 2, its two negative controls (reduced=3@35, reduced=2@36), chunk 4 (negative control), the 38-byte dialogue drain — both boards, nothing about the mixed-vblank mechanism itself changed this round, so this re-confirms rather than discovers | `build_f9_worst_chunk_fixture.mjs`/`build_f11_mixed_vblank_fixture.mjs`/`build_arb_fixtures.mjs`/`build_dlg_drain_fixture.mjs`, each then `Mesen --testRunner` | **All PASS as expected, both boards.** Worst chunk-3: MMC3 margin 143.0 cyc (scanline 259/235), U512 208.7 cyc (259/38). Mixed@35/reduced=2: MMC3 47.0 cyc (260/182, unchanged from review 9's own accepted figure — no regression), U512 109.7 cyc (259/335). Chunk 4 and reduced=3@35: both MISS both boards (negative controls, as required). Reduced=2@36: correctly falls back to exclusive drain both boards (negative control). 38-byte drain: MMC3 963.0 cyc, U512 1025.7 cyc | MMC3's mixed margin did not go negative, so the brief's own reduced-chunk-1 contingency does not trigger; the event-freeze flag check and the dialogue lifecycle hooks are mainline-only by construction (never touch `boot.asm`'s `nmi:` routine), so there is nothing NMI-side from those two to re-time |
| Fix round 17, item 1: the camera/OAM/final-restore publication barrier at four targeted interruption boundaries — (a) after the camera write, before `build_oam`/`draw_entities`; (b) mid-`draw_entities`; (c) on close, before the final restore packet is published; (d) during the un-nudge itself — against a real forced overrun (a genuine ~35,000-cycle busy-loop, never a JS-side poke), plus two negative controls (a, d) reverting to the narrow, fix-16-shaped `cam_dirty` bracket | `node proto-tools/build_fix17.mjs --debug` then `node proto-tools/dlg_fix17_trace.mjs` | **ALL PASS.** At each of (a)/(b)/(d), the published pair (`nmi_cam_x_lo`/`y_lo`/`nt` against a camera-dependent OAM marker DMA'd through the real, unmodified `$4014` mechanism) stays coherently old throughout the observed hold and becomes coherently new only after release; (c) confirms the camera stays at its nudged value for the whole extra wait of a genuine close-side overrun. Both negative controls (`sw_dlg17_oldbarrier`) reproduce a genuine mixed pair | A camera-dependent OAM marker (`OAM+255 := cam_x_lo`, written every frame after `draw_entities`) is a test-only stand-in for the not-yet-wired `sw_project_axis` dependency real entity/effect sprites will carry once phase 2 connects them to the camera — this prototype's own `build_oam`/`draw_entities` still draw `player_x`/`ent_x` directly, camera-independent, by design |
| Fix round 17, item 4 sequence (e): a real, hand-placed `Say → Move(player) → Say` event, driven through the completely unmodified `script.asm`/`text.asm`/`ui.asm` machinery (real `OP_SAY`/`OP_MOVE`/`OP_END` dispatch, real button presses dismissing each `Say`) | `node proto-tools/build_fix17.mjs --debug` then `node proto-tools/dlg_fix17_trace.mjs` | **ALL PASS.** The close-for-Move draw-down runs to completion (5 real frames) with `mv_left` provably untouched throughout; `script_active`/`game_state` survive the close; the Move then ticks the player a real 16px; the second `Say` genuinely reopens and reaches `BOX_ENDWAIT`; the event finishes for real afterward | The string table (`str_data_0`, id 0) is the project's own real, already-compiled empty-string sentinel, not a fixture addition; the event bytes themselves and the test-only kickoff hook (a faithful reproduction of `start_dialog`+`script_start`'s own tail with a fixed `script_ptr` in place of the real `ent_event`/`event_ptr_lo/hi` table lookup) are disclosed stand-ins, everything downstream of them real |
| Fix round 17, item 4 sequence (f): a real `script_op_save`/`save_media_commit` call (UNROM 512, real flash driver) against the streamed dialogue overlay genuinely `OPEN_IDLE`, with `$0600` deliberately filled with junk immediately beforehand | `node proto-tools/build_fix17.mjs --debug` then `node proto-tools/dlg_fix17_trace.mjs` | **ALL PASS.** `SAVE_MARKER` becomes valid for real; the box's own six-row footprint is byte-identical to its pre-save content; `attr_shadow` no longer holds the clobber value anywhere; the overlay's own lifecycle state and the camera are both untouched by the resync; the script continues for real past `Save` | `save_media_commit`'s own real, pre-existing `wait_vblank_poll` (unmodified) polls PPUSTATUS directly in a tight loop; jsnes's own PPU models a real NES quirk on that register (a read landing one dot before VBlank sets suppresses the flag for that whole frame) that a highly deterministic, fast polling loop can resonate with for dozens of real frames before drifting clear — observed at 35 frames here, never during ordinary gameplay's own far less regular timing; the trace budgets 200 frames for this specific wait, unrelated to fix round 17's own logic |
| Fix round 17 negative controls (g): (g1) the fix-15/16-shaped "just call `close_ui`" fix strands a page suspended on a real Move; (g2) a flash commit with no resync at all leaves the box band physically untouched (never redrawn) while `attr_shadow` stays corrupt | `node proto-tools/dlg_fix17_trace.mjs` | **Both FAIL-AS-EXPECTED.** (g1): after the close_ui-shaped clear, `script_active` reads 0 and `script_resume` finds nothing to resume, no second `Say` opens. (g2): the nametable's box band matches the pre-save snapshot exactly (never touched) while `attr_shadow` still reads the clobber value — confirming the resync, not luck, is what closes review 10 finding 4 | (g1) simulates close_ui's own three stores directly at the point a naive fix would call it, rather than building a second ROM variant with fix round 17's own conditional removed — the STATE close_ui leaves behind is what is being asserted has the described effect |
| Fix round 17 Mesen re-timing: the NMI's new cam_dirty-gated OAM DMA check, applied to real `sample-mmc3`/`sample-u512` copies (already carrying the persisted mixed-vblank splice from earlier rounds) — worst chunk-3 strip-only and the 35-byte mixed vblank, both boards | `proto-tools/build_fix17_retime_board.mjs` then `build_f9_worst_chunk_fixture.mjs`/`build_f11_mixed_vblank_fixture.mjs`, each then `Mesen --testRunner` | **PASS, both boards, both scenarios — margins reduced but still comfortably positive.** Worst chunk-3: MMC3 137.0 cyc (was 143.0, −6.0), U512 204.7 cyc (was 208.7, −4.0). Mixed@35/reduced=2: MMC3 **41.0 cyc** (was 47.0, −6.0 — the brief's own reduced-chunk-1 contingency does not trigger, since the margin stays positive), U512 105.7 cyc (was 109.7, −4.0). Both negative controls (chunk 4; reduced=3@35) still MISS as required | The reduction on every scenario matches the new check's own fixed per-NMI cost (`lda cam_dirty`/`bne`, paid every vblank regardless of whether the hold is ever active) — a real, small, disclosed cost, not a regression in the arbitration logic itself, which the still-failing negative controls confirm is unaffected |
| Fix round 19: a clean, production-shaped isolation of fix round 17's own two features (the camera/OAM barrier, close-for-Move, Save resync), every test-only routine/flag/hook excluded for real (built without them) | `node proto-tools/build_fix19_clean.mjs` | **Assembles clean, exit 0.** BANK 62 (kernel-lo) 7,794/8,192; BANK 63 (kernel-hi) 4,031/8,192 | Not itself a functional re-proof — `dlg_fix17_trace.mjs`'s own checks are what prove the mechanisms; this build proves only that the same patches, stripped of test scaffolding, still assemble and where the bytes land |
| Fix round 19: the isolation control for the kernel-lo save-subsystem confound — the fix-16 baseline with `SAVE_ENABLED`/`SAVE_FLASH` flipped but **none** of fix round 17/19's own patches applied | `node proto-tools/build_fix19_savebaseline.mjs` | **Assembles clean, exit 0.** BANK 62 7,730/8,192 (+607 over the fix-16 baseline, attributable to the pre-existing save subsystem alone, cross-checking CLAUDE.md's own `SAVE_KERNEL_ALLOWANCE_BY_MAPPER[30]=640`); BANK 63 3,931/8,192 (unchanged — the save subsystem has no kernel-hi footprint) | This is what turns the naive `build_fix17.mjs`-vs-`build_fix16.mjs` "+721" figure into the genuinely isolated "+64 kernel-lo / +100 kernel-hi" this round's own ledger uses |
| Fix round 19: the complete RAM ledger, extending `check_fix16_ram_ledger.mjs` with fix round 17's three production bytes (`sw_dlg17_camhold`/`move_close`/`resync_i`, $07F0-$07F2) and this round's own `sw_event_freeze` ($FD) | `node proto-tools/check_fix19_ram_ledger.mjs` | **0 failures, 13 regions, no overlaps.** Zero-page gap `$C7-$FF`: 55 of 57 used, 2 free (`$FE-$FF`); `$07F0-$07F2` checked numerically clear of `save_flash_buf`'s real `SAVE_RECORD_LEN=127` bytes | Resolves every address from `engine/constants.asm` plus the prototype's own equates (now including `dlg_fix19_clean.asm` and `config.inc` for `SAVE_RECORD_LEN`) via the same `scanEquates`/`resolveEquates` `test/lib/equates.js` already provides |
| Fix round 23: extends the RAM ledger to every production RAM byte added since fix round 19 — `map_is_streamed` (`$FE`, fix round 22) and `sw_dlg20_save_pending` (`$07F8`, fix round 20), both real, addressed, resolved from `dlg_fix20.asm`/`dlg_fix22.asm` via the same equate scanner | `node proto-tools/check_fix23_ram_ledger.mjs` | **0 failures, 15 regions, no overlaps.** Zero-page gap `$C7-$FF`: 56 of 57 used, 1 free (`$FF`); both new bytes checked numerically clear of `save_flash_buf` and of every other region | Extends `check_fix19_ram_ledger.mjs` wholesale, per this project's own convention, rather than re-deriving it |
| Fix round 19: the contract's own self-check — every known-stale phrase/number absent (Part A), and a **selected-context consistency lint** (Part B) for the dozen key quantities review 11 named: each one's own labelled occurrences (e.g. every `SW_SPEED_SUB_X = …` spelling, not every prose/table mention of a speed) agree with each other | `node proto-tools/check_contract_consistency.mjs` | **ALL PASS, exit 0** (see the report for the full output) | Greps `docs/design-streamed-worlds.md` itself; a documentation-consistency check over the SPECIFIC spellings it scans for, never a functional proof of anything in the engine and never a claim that every number describing a quantity anywhere in the document's own prose is covered — confirm anything outside its own listed regexes by diff and source inspection |
| The repository's own test suite is unaffected by any of the above (no shipped code changed) | `npm test` | **1812/1812 pass, 0 fail, 0 skipped** | — |
| This round: close-for-Save (item 1) and the player-Move screen-ownership clamp (item 3) layered on a fresh `build_fix17.mjs --debug` output — `script_op_save`'s own deferral tail, `main_loop`'s own completion hook, the rebuilt (box-redraw branch deleted) resync with OAM rebuild/DMA, and item 3's own negative-control-only crossing-simulation branch in `move_tick` (the production path is byte-for-byte unmodified) | `node proto-tools/build_fix20.mjs` | **Assembles clean, exit 0.** BANK 62 (kernel-lo) 7,973/8,192 (+129 over the `build_fix17.mjs --debug` baseline of 7,844); BANK 63 (kernel-hi) 4,285/8,192 (+94 over 4,191) | `TURN_ENABLED` (a pre-existing engine feature, hand-flipped only so item 3's own Turn(Self) step has something real to dispatch to) measures +33 kernel-lo / +0 kernel-hi in isolation (`build_fix20_turnonly.mjs`), leaving **+96 kernel-lo / +94 kernel-hi** for item 1's production code plus every test-only branch/event for both items combined, not yet isolated from each other — **the real isolated figure is +46 kernel-lo / −33 kernel-hi, `build_fix23_save_clean.mjs`, §4 and §9 above |
| Sequence (f2): close-for-Save, real typed content (via the real `sw_dlg12_write_tile` primitive), the deferred commit genuinely waiting for the close's own drain-acknowledgement, OAM/scroll resume order, script continuation, and a following reopen — plus a seam-origin confirmation (camera 20→16, non-zero, seam-crossing) — against `build_fix20.mjs`'s own output | `node proto-tools/dlg_fix20_trace.mjs` | **ALL PASS** (57/57 checks across both items) | The hand-placed `[OP_SAVE, OP_END]` event and its kickoff hook are the same disclosed stand-in shape fix round 17's own sequence (f) already used; the five typed glyphs stand in for a `Say`'s own typewriter (not yet wired to this overlay), the same disclosed substitution fix round 15's own `sw_dlg15_typewhat` hook already established |
| Negative control (h1): `sw_dlg20_oldresync` reverts `script_op_save`/the resync to the pre-round-20 immediate-commit + empty-box-redraw path, through the SAME real call chain | `node proto-tools/dlg_fix20_trace.mjs` | **FAIL-AS-EXPECTED**: the commit runs immediately (box never closed), and the typed content is lost, overwritten by the empty open-box frame — the script itself still finishes normally (this defect is about the box's own content, not a stranded script) | Reproduces review 11 finding 1 directly, not merely asserted absent |
| Sequence (i): a real, hand-placed `[Move(player, right, 20px, starting at x=236) → Turn(Self, up) → Say]` event, driven through the completely unmodified `script.asm`/`entities.asm` machinery | `node proto-tools/dlg_fix20_trace.mjs` | **PASS**: the player stops at exactly `player_x=240` (`MAX_X`); entity slot 0 (`talk_ent`) still holds the original NPC's own identity (`ent_actor`/`ent_x`/`ent_y` unchanged) after the blocked Move; `Turn(Self)` sets that slot's `ent_dir` correctly; the Say opens afterward | This trace's own single starting point (x=236, well short of the fringe) never exercised the wraparound defect review 12 finding 1 found; superseded in scope (not in correctness — its own result is still accurate for x=236) by the fringe trace below |
| Negative control (i1): `sw_dlg20_nocrossclamp` lets the same Move overshoot past `MAX_X` and simulates a crossing repopulating `talk_ent`'s own slot with a different actor (`sw_dlg20_simulate_crossing`), through the SAME real `move_tick`/`move_face`/`script_op_turn` call chain | `node proto-tools/dlg_fix20_trace.mjs` | **FAIL-AS-EXPECTED**: the player overshoots; slot 0 now holds the simulated "actor B"'s own identity; `Turn(Self)` mutates actor B's facing, not the original NPC's | Reproduces review 11 finding 3 directly |
| Fix round 22 (review 12 finding 1): a real `[Move(player, DIR, 250px) → Turn(Self) → Say]` event per direction, driven through the corrected `move_tick` (`build_fix22.mjs` over `build_fix20.mjs --debug`), from all six fringe starting positions review 12 named (x=240/241/254/255, y=224/225/239), both `PLAYER_SPEED` values (1 and 2, via a test-only override), all four directions, plus dedicated crossing-coverage cases (an UP move crossing down via `BODY_T`; a LEFT/DOWN move crossing via the other axis's `BODY_B`/`BODY_L`; a same-screen-only short walk; NPC and ordinary-map controls) | `node proto-tools/dlg_fix22_trace.mjs` | **416/416 PASS.** Final position always legal (0-255/0-239) and never wrapped (tracked across the WHOLE walk, not just start/end); `talk_ent`/`ent_actor` untouched throughout; script genuinely continues into `Turn(Self)`/`Say` (`box_state` reaches `BOX_ENDWAIT`); every crossing-coverage counter fires exactly on its predicted branch and nowhere else; an NPC and an ordinary-map player both still stop at `MAX_X` (240), unaffected | `sw_dlg22_forceold` (negative control): the SAME two defect cases (x=255/step=1, x=254/step=2) genuinely dip to x≈0 mid-walk under the reverted, unconditional `cmp`-based test, before the still-unmodified `MAX_X` containment re-catches the player walking back up, settling at 240 — the unfixed engine's own real, compound, visible teleport-then-walk-back, not a value chosen to make the demonstration tidy |
| Byte cost of fix round 22's own Move-boundary/probe-crossing branch, measured against a fresh `build_fix20.mjs --debug` baseline (SUPERSEDED by the isolated figure below) | `node proto-tools/build_fix22.mjs --debug` (nesasm bank report) | **kernel-lo (`BANK 62`) +32 bytes, kernel-hi (`BANK 63`) +245 bytes, combined ≈277** | Combined with that round's own test scaffolding (four hand-placed events, the kickoff, three coverage counters, the step override), not isolated — an upper bound, not the production figure the row below now gives |
| Move-boundary/probe-crossing branch, ISOLATED: a clean production-shaped variant (`map_is_streamed`, `sw_dlg22_wrap_y240`, `sw_dlg22_probe_streamed`, `sw_dlg22_bound_x_right`/`bound_y_down`, real path only — no `sw_dlg22_forceold` negative control, no coverage counters, no hand-placed test events) layered on `build_fix23_save_clean.mjs`'s own clean baseline | `node proto-tools/build_fix23_move_clean.mjs` (nesasm bank report, `minimal-u512-fix23-move-clean` 7,881/4,121 vs. `minimal-u512-fix23-save-clean` 7,840/3,998) | **kernel-lo +41 bytes, kernel-hi +123 bytes** — the real production delta, folded into §4's own Total rows this round | Isolated the same way `build_fix19_clean.mjs` isolated fix round 17's own delta: an otherwise-identical clean build with and without the feature, same flags both sides |
| Close-for-Save mechanism, ISOLATED: a clean production-shaped variant (the real resync path only — no `sw_dlg20_oldresync` negative control, no test-only camera-dependent OAM marker; `save.asm`'s real deferred-commit tail with no escape hatch; `boot.asm`'s real completion hook with no test-kickoff material; the OAM rebuild corrected to the real `main_loop_draw` order — `build_oam`/`draw_entities`/conditional `draw_hud`/`draw_ui`, the runtime dispatch/OAM-pass review) layered on `build_fix19_clean.mjs`'s own clean baseline | `node proto-tools/build_fix23_save_clean.mjs` (nesasm bank report, `minimal-u512-fix23-save-clean` 7,840/3,998 vs. `minimal-u512-fix19-clean` 7,794/4,031) | **kernel-lo +46 bytes, kernel-hi −33 bytes** (a real DECREASE in kernel-hi even with the corrected OAM passes — the new resync body is smaller than the deleted box-redraw loop it replaces) — the real production delta, folded into §4's own Total rows, replacing the fix-20 row's own "+96 kernel-lo / +94 kernel-hi, not yet isolated" figure | Isolated the same way `build_fix19_clean.mjs` isolated fix round 17's own delta |
| Every `switch_prg_bank` call reachable from the worst arm (`sw_stream_start_col`/`_row`) and the four-probe boundary check (`sw_peek_byte`), counted from the real prototype source rather than asserted by hand | `node proto-tools/diag_f23_mapper_switch_count.mjs` | **ALL PASS**: `sw_goto`/`sw_locate_current` each confirmed to call `switch_prg_bank` exactly once; the worst arm costs 4 switches (3 relocates + 1 restore), not 3; a corner check costs 8 (2 per probe × 4); the correction adds exactly the nine omitted deltas review 12 found | For UNROM 512 itself every one of these twelve switches is already the real, measured UNROM 512 cost, embedded in the worst-arm/boundary-probe figures above — confirmed by reading the routines, not assumed |
| The corrected driver skeleton (real 16-bit arithmetic on both axes, real arbitration/arm-decision/negative-direction/camera-clamp code, symbol-derived harness addresses, coverage counters for every claimed branch) | `node proto-tools/diag_f23_driver_skeleton.mjs` | **ALL CHECKS PASS**: 563 cyc (sum of each part's own worst branch), 562 cyc (one concrete combined worst-path call); 551 bytes assembled (six parts + `driver_whole`, excluding the two stand-in stubs) | Replaces `diag_f21_driver_skeleton.mjs`, whose harness wrote its claimed pad state and map-dimension bytes to the wrong addresses ($20/$21/$22 instead of the real $11/$24/$25), so its own advertised arbitration-reselection path never ran; that script and its 432-cyc/259–326-byte figures are superseded, not reused |
| The streamed metadata accessor's own offset≥256 arithmetic, a real assembled stand-in of the five named steps, `callRoutine`-measured | `node proto-tools/diag_f23_metadata_accessor.mjs` | **ALL CHECKS PASS**: 44 cyc worst path (offset≥256), 28 cyc cheap path (offset<256) | Replaces the prior "≈30 cyc" figure, which was inferred from the ≈30-byte kernel-lo allowance rather than measured or instruction-counted |
| The crossing-frame residual, recomputed as `max(body − entities)` over every one of the 405 paired samples the busy fixture collects, not `max(body)` minus that one sample's own `entities` value | `node proto-tools/diag_f23_busy_decompose.mjs` | **8,663 cycles** (from a sample with `body`=8,663, `entities`=0 — one of 99 samples where `update_entities` is genuinely skipped that frame, the identical `screen_fresh`-gated mechanism a real crossing frame uses), 1,751 cycles higher than the old (wrong) 6,912 figure | Confirms review 12's own finding: the two computations are not the same thing and can genuinely disagree; the busy-fixture and its instrumentation are otherwise unchanged from fix round 18/21 |
| The final per-board frame-bound table, assembling every one of this round's own corrected inputs (the 563-cyc driver, the 44-cyc accessor, the 8,663-cyc floor, the 12-switch mapper accounting) into UNROM 512's own proven total and MMC1/MMC3's own indicative arithmetic | `node proto-tools/diag_f23_frame_bound_recompute.mjs` | **ALL CHECKS PASS**: UNROM 512 26,953 cyc, margin 660 (2.39%) FITS; MMC3 (indicative) 27,241 cyc, margin 307 (1.11%) FITS; MMC1 (indicative) 27,685 cyc, margin −137 (−0.50%) OVERRUNS; the crossing-frame scenario stays under the busy-arm total on every board | A pure arithmetic assembly script — every input it uses is itself cited to the measurement that produced it, above |
| The final kernel-lo/kernel-hi ledger totals, assembling this round's own two isolated deltas (close-for-Save, Move-boundary) plus the driver's own corrected byte estimate into the kernel-lo hooks totals, the dialogue/Move kernel-hi allowances, the content ceilings, and the fixture fit table | `node proto-tools/diag_f23_ledger_recompute.mjs` | **ALL CHECKS PASS**: kernel-lo hooks total 726 (streaming alone, was 333) / 916 (+dialogue+Move+save, was ≈524) / 926 (+mixed knockback, was ≈534); `STREAMWORLD_DIALOGUE_KERNEL_HI_ALLOWANCE` 1,616 (was 1,649, close-for-Save only) plus a SEPARATE `STREAMWORLD_MOVE_KERNEL_HI_ALLOWANCE` 123 (gated on `MOVE_ENABLED`, independent of text); content ceiling 4,336 with both dialogue and Move live (was 4,426), 4,459 with dialogue alone; every switchable-PRG fixture still FITS, `sample-u512` now tightest at 176 bytes to spare | A pure arithmetic assembly script; the driver's own byte-cost correction (≈140→≈533) is gated on `projectUsesStreaming` alone, so it moves the BASE "streaming alone" total, not merely the dialogue/Move/save additions — the largest single correction in this round's own ledger work |
| Item 2: the real, current `engine/boot.asm`/`engine/input.asm` call order the corrected event-freeze lifetime depends on — `dispatch_input`'s own call site precedes `update_player`'s; `dispatch_done` (the wrong, as-written clear point) sits inside `dispatch_input` and so necessarily runs before `update_player`; `update_player`'s own call site precedes `main_loop_idle` (the corrected clear point) | `node proto-tools/check_fix20_event_freeze_order.mjs` | **ALL PASS**, all four order assertions, against the real, unmodified repository source (not this scratch tree's own mirror) | A structural/textual check, not a functional proof — `sw_event_freeze` itself remains specified, not written by any built prototype code (review 10 finding 5's own disclosure, unchanged); the brief's own "text/call-order diff is enough for design closure" instruction is what this checks against |
| `verify_torus.mjs` and `dlg_fix17_trace.mjs` re-run, unaffected by this round's own work | `node proto-tools/verify_torus.mjs` / `node proto-tools/dlg_fix17_trace.mjs` | **61/61 ALL PASS** / **78/78 ALL PASS** | Neither `minimal-u512`'s own baseline nor `dlg_fix17.asm`/`build_fix17.mjs` were touched this round |
| The real cycle cost of the current-screen id/record-pointer update a continuous ownership crossing needs (`sw_cross_left/right/up/down`, `sw_locate_current`), all branches, against the real `minimal-u512` build | `node proto-tools/diag_f21_crossing_cost.mjs` | **Reproduced exactly**: `sw_cross_right` 52-55 cyc, `sw_cross_left` 54 cyc (no wrap) / **671 cyc (region-boundary wrap, the worst of the four)**, `sw_cross_down`/`sw_cross_up` 32 cyc each, `sw_locate_current` 100-102 cyc. Worst pair (one `sw_cross_*` + one `sw_locate_current`): **773 cyc** | These routines are real, assembled, and already functionally proven by `verify_torus.mjs`, but never cycle-measured before this round |
| The real cycle cost of entity-array repopulation (`spawn_entities`, unmodified `engine/entities.asm`) at `MAX_ENTITIES=8` with one `TRIG_ENTER` actor, against a real built fixture (not the scratch prototype, which has no entity model) | `node proto-tools/diag_f21_spawn_cost.mjs` | **Reproduced exactly**: 8-actor screen (despawn+respawn+one `arm_event` call, all in one call) **1,937 cyc**; 0-actor screen (despawn-only) 174 cyc | `mkdtemp` copy of `sample`, never mutated; the streamed 16-bit metadata-accessor extension this loop will need is bounded separately from source (≈30 cyc), not measured, since it does not exist in either the shipped engine or the prototype |
| Whether the busy-content scenario's own 11,839-cycle figure can coincide with a screen crossing: `update_entities`' own cost *within the same worst-body frame* the busy-frame classifier already found (not an isolated cold call — see the limitation column), against the real, unmodified `engine/boot.asm` call order (`update_entities` gated on the identical `screen_fresh` flag a crossing sets, one call site later than `update_player`) — **the aggregation below is SUPERSEDED by `diag_f23_busy_decompose.mjs`'s own corrected `max(body − entities)` row, above; the fixture and per-frame measurement themselves are unchanged and still cited** | `node proto-tools/diag_f21_busy_decompose.mjs` | **Reproduced exactly**: the worst-body frame's own `update_entities` span is 4,927 of its 11,839 cycles, leaving a **6,912-cycle floor** that still runs on a `screen_fresh`-gated crossing frame | Confirms the busy-AI-tick cost and the crossing-specific cost are mutually exclusive on the same frame, by the identical mechanism already established for the dialogue-tick/close-for-Move exclusion. An earlier attempt (`diag_f21_crossing_frame.mjs`) called `update_entities` in isolation right after boot, with no walk-in and no real pursuit state, and measured only 125 cycles — misleadingly low, because the chasers had nothing to chase yet; decomposing the ACTUAL worst-sampled busy frame in place (instrumenting the same PC-sampling walk `diag_f18_busy_frame.mjs` already drives, tracking cycles between `update_entities`'s own entry and `main_loop_warp`) is what gives the real, in-context 4,927-cycle figure used above |
| The unbuilt movement/camera driver's own worst-path cycle cost, replacing the prior "≈150, a dozen instructions" placeholder — **SUPERSEDED by `diag_f23_driver_skeleton.mjs`, above: this skeleton was neither spec-complete nor conservatively priced, and its harness wrote its claimed pad state/map-dimension bytes to the wrong addresses**: a standalone, assembled skeleton (`driver-skeleton/driver.asm`) of the six named parts the byte-level line-item table already lists, `callRoutine`-measured | `node proto-tools/diag_f21_driver_skeleton.mjs` | **432 cyc** (worst path: both clamps taken, negative-subtract clamp taken, ceiling clamp taken, an arm decision taken, axis arbitration re-selecting, lag pinned at the guard threshold) | A skeleton matching the real arithmetic each part needs, not wired to real input (per the brief's own allowance); not itself a claim that the real, integrated driver assembles to exactly this instruction sequence |
| The corrected guard order/model (review 11 finding 5): detect → suppress publication/cancel service → install the target origin → forced blank (no containment check while blanked) → render at the target origin → publish, replacing the prior model's wrong publication order, its use of the already-jumped camera as the "frozen" value, and its one-frame-only blank; very large jumps (four directions, with/without an in-flight strip, three redraw durations); the same jump plus continued walking; the boundary negative control exposing the unfinished entering edge | `node proto-tools/diag_f21_guard_order.mjs` | **ALL PASS** at the time (review 12 later found this script's own verification incomplete — see below; the operative order it implements was and remains correct) | **Superseded by `diag_f22_guard_order.mjs`, below**: this script's own redraw-duration parameter was never actually threaded into the scheduler (every case blanked for the same hardcoded 9 frames regardless of its own loop label), its initial state let the guard fire spuriously on frame 0, and it skipped the containment check on the exact frame a blank ends — the identical publication a genuinely uncontained frame would first reach the screen through |
| Review 12 finding 3's own corrected guard model: the same operative order, now with the redraw duration genuinely threaded through (1/9/40 frames plus the real measured `sw_render_window` cost, ≈33 frames), mainline movement genuinely frozen for a blank's whole length, the containment check genuinely running on the first publication after a blank, a valid (non-spurious) initial state, and a counter proving a genuinely in-flight strip is what the guard cancelled | `node proto-tools/diag_f22_guard_order.mjs` | **ALL PASS.** Sanity (idle, no movement): 0 violations, 0 guard fires at frame 0. Every large-jump/strip/duration combination (4 directions × 2 strip states × 4 durations = 32 cases): 0 violations, the guard fires, every completed blank observed to have run for EXACTLY its own requested duration, the strip-cancellation counter fires only when a strip was genuinely armed beforehand. Continued-walking exercise: 0 violations across every re-triggered resync. Boundary control (unchanged from fix round 21): discriminates as before | No further contract-sequence flaw found underneath the model's own three bugs — the operative order itself (unchanged since review 11) verifies clean once modelled faithfully. Reproducing the reviewer's own inserted diagnostic traced the exact compound cause: a spurious frame-0 guard fire (from the bad initial state) froze the window origin while the model's own unfrozen movement kept applying the real jump anyway, so the two had already drifted apart by the time the stale blank lifted — not a property of the corrected order, closed by fixing the initial state and freezing movement together |

## 10. Open questions and known gaps

1. **CLOSED.** The `$C7` zero-page contention (§4): resolved for real, not
   merely disclosed — `sw_axis_pref` keeps `$C7`, the dialogue overlay's own scratch and the
   lifecycle's own production bytes each shift up by one to make room, checked by script against no
   overlaps. `sw_event_freeze` was assigned the gap's own next production byte, `$FD`;
   `map_is_streamed` (§4, §7) takes `$FE`. 1 byte remains free (`$FF`). What is *not* closed:
   `sw_axis_pref` itself is still specified but not written by any built code — that remains
   phase 1/2, same as every other unbuilt production hook this document names.
2. **The mainline movement driver** (`sw_axis_arbitrate`, the routine that would actually call
   `sw_walk_step_x/y`, detect a crossing, and perform the arm sequence) is specified in full and
   proven as a standalone model, never wired into `engine/input.asm`. Its own kernel-lo cost is now a
   line-itemised, six-part estimate (§4) rather than a flat analogy to an
   unrelated allowance, but the estimate remains a bound on unbuilt code, not a measurement — building
   the real routine could still land above or below it.
3. **The full production dialogue state machine** (`box_begin`/`text_open_step`/`text_close_step`
   actually calling the mapper and packet writer, against the real `box_state`/`game_state` bytes) is
   unbuilt; the lifecycle itself — the pending-open phase, the publication barrier, the player-Move
   rule, and the drain-acknowledgement close — is now specified and proven as a combined real-frame
   trace (§7, §9), but that trace stands `paused` in for the real world-freeze flag specifically to
   avoid driving the unrelated real `box_state` machine while proving the lifecycle transitions
   themselves; wiring the real `box_begin`/`text_open_step`/`text_close_step`/`game_state` call chain
   is phase 2, same as before. The nudge computation is real code (a floor, `cam_dirty`-
   guarded, plus the world-camera-origin update), not merely poked — only the *continuous* camera-feed
   register (below) remains poked rather than fed.
4. **The camera-feed driver itself** — a per-frame derivation of the camera's own world-space origin
   from `flat_screen`+`player_x/y`, feeding item 12's existing register continuously rather than only
   at a screen-edge slide — is named as the right destination (the register already exists) but not
   built.
5. **The straddling-collision consumer wiring** (`player_hazard`/`entity_contact` actually computing
   a wide/signed probe position and calling `sw_peek_byte` on a cross-screen result) is specified
   (§6) but not wired into either routine.
6. **The two-nametable variant (phase 3)** has no addressing proof of its own — nothing in this
   document's evidence table times a 32×15 or 16×30 ring; phase 2's mechanisms are expected to
   generalise but that has not been checked.
7. **The variable-rate (`vram_len`-read) chunk budget**, an early alternative to a fixed
   `SW_STREAM_CHUNK`, no longer needs that motivation (arbitration already gives chunk 3 real margin
   with no dynamic sizing) but was never itself built or benchmarked against the fixed-chunk scheme.
8. **A narrower residual sentinel/count-boundary sweep** beyond the two confirmed `NUM_SCREENS`
   comparison sites and the `NO_SCREEN` argument itself has not been performed — this document's own
   255-screen conclusion is resolved, but whether some other fixed-width count elsewhere in the
   engine shares the identical risk is not audited.
9. **Bound tiles remain restricted, not synchronised** (§8) — a real flip-synchronisation design for
   a streamed screen (resolving a bound variant at every streaming read site, and defining what a
   flip does to content already drawn into a physical nametable while the camera has moved past it)
   is out of scope, not merely unbuilt.
10. **The entity pop-out cost is accepted, not mitigated** — a wider live-entity window (drawing a
    neighbouring screen's own actors near a boundary) would remove the "disappears mid-view" cost
    §1 names, but is a real scope increase this document does not cost.
11. **Shipping generator code** for every specified-but-unbuilt piece in §3-§4 (`emitScreens`'s real
    diff, the map-type bit table, `kernelTableBytes`'s per-map branch, the runtime `map_base`-walk
    routine, `checkStreamedMapperSwitch`'s own implementation) does not exist.

### Obligations carried from review 13, and from Chris's 2026-09-21 rulings

The design round closed by Chris's acceptance (§0). Review 13's verdict was FIX with five items; they
are implementation obligations, not open design questions. This subsection is the single list.

1. **Driver specification and timing** (phase 2). The 563-cycle bound is not the worst measured path
   (a combined call measured 587); the 89-cycle release-handoff arbitration case was dropped from the
   sum (only 60/68 were added); required 16-bit arithmetic (block width, centres 120/112, minus 8/7
   and window-origin clamp, unsigned world above 32767, ordering, physical-scroll conversion) is
   missing. *Discharged by:* the production driver measured in the real engine on UNROM 512 and the
   frame bound recomputed from it. **The 660-cycle / 2.39% margin is PROVISIONAL until then.**
2. **Spawn adapter bound** (phase 2, same measurement). The 44-cycle charge covers one metadata byte,
   but the streamed metadata is 73 bytes read by `spawn_entities`. *Discharged by:* bounding the
   complete adapter (pointer rebasing or actual accessor count, page crossings) and recomputing the
   crossing case.
3. **Guard blank-duration assertion echoes its input** (phase 2). *Discharged by:* the production
   harness counting actual blank iterations, with a one-frame mutation that must fail it.
4. **Save post-commit dispatch** (phase 1/2). *Discharged by:* wiring ordinary map -> original
   rendering tail and streamed map -> resync after commit, including a streamed Save with no open
   box, plus a mixed-project test; the completion-hook wording made consistent.
5. **Driver byte span / resource ledger** (phase 2). 549 measured versus 551/533 stated. *Discharged
   by:* `kernelbytes.test.js`-style equality assertions on the real allowances, superseding the
   estimate.

From Chris's rulings (§1):

6. **Knockback** (phase 2): model streamed knockback at 1.5 px/frame for 16 frames (24 px); restore
   24 px if it holds. Untested hypothesis.
7. **Scripted player `Move` boundary** (phase 2/3): address the moved actor by identity, not live
   `talk_ent` slot; until then the Map Forge event editor warns on a reachable screen edge.
8. **Previous screen's actors vanish at a crossing** (phase 3, top polish item): handover window or
   authoring guidance.
9. **Content ceilings** (phase 2): measure a real streamed RPG's music+sfx+text; if it pinches,
   relocate the dialogue overlay to a switchable bank where room exists; `checkCapacity` reports
   overflow naming the Sound Forge / text.
10. **Dash label**: the UI labels dash "ignored on streamed maps".

## Appendix: the prototype, extracted from the current scratch tree

The routines below are not hand-copied. They are pulled, by the script that follows, from the
fix-12 scratch prototype (`handoff-next/streamed-worlds-scratch-backup-fix12.tgz`, restored to
`minimal-u512/build/` and `minimal-u512-fix12/build/` for this round's own re-verification, §9), so
this appendix cannot silently drift from what was actually proven. Every retired mechanism (the
one-in-three movement schedule, the old snap-and-full-redraw dialogue transaction, the pre-round-10
kernel-lo placement, the discarded Flash lag-priority-threshold policy) is in
`docs/design-streamed-worlds-history.md` under its own fix round, not reproduced here.

### The extraction script

```js
#!/usr/bin/env node
// extract_appendix.mjs -- pulls named routines out of the CURRENT scratch
// prototype files (never hand-copied) so this appendix cannot go stale
// relative to what fix round 12 actually built and proved. Run from the
// repo root, against minimal-u512/-fix12 restored from
// handoff-next/streamed-worlds-scratch-backup-fix12.tgz:
//
//   node extract_appendix.mjs > appendix_body.md
import fs from 'node:fs';

const SRC = process.env.SW_SRC || 'minimal-u512/build';
const SRC12 = process.env.SW_SRC12 || 'minimal-u512-fix12/build';

function readLines(path) { return fs.readFileSync(path, 'utf8').split('\n'); }

// Extracts from `label:` up to (not including) the next top-level label
// (no leading whitespace). A heuristic, not an assembler -- checked by
// throwing if the requested label is not found at all.
function extractRoutine(lines, label) {
  const startIdx = lines.findIndex((l) => l.trim() === `${label}:`);
  if (startIdx === -1) throw new Error(`label not found: ${label}`);
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^[A-Za-z_][A-Za-z0-9_]*:/.test(lines[i]) && !lines[i].startsWith(' ') && !lines[i].startsWith('\t')) {
      endIdx = i; break;
    }
  }
  return lines.slice(startIdx, endIdx).join('\n');
}

const out = [];
const sw = readLines(`${SRC}/streamworld.asm`);
for (const [title, labels] of [
  ['sw_walk_step_x / sw_walk_step_y -- the per-axis subpixel accumulators', ['sw_walk_step_x', 'sw_walk_step_y']],
  ['sw_terrain_or_fill -- the fill-aware bounds check', ['sw_terrain_or_fill']],
  ['sw_clamp_col / sw_clamp_row -- the window/viewport clamp', ['sw_clamp_col', 'sw_clamp_row']],
  ['sw_goto / sw_locate_current -- the cold relocate and its O(1) restore', ['sw_goto', 'sw_locate_current']],
  ['sw_peek_byte / sw_read_transaction / sw_read_run -- the three read contracts', ['sw_peek_byte', 'sw_read_transaction', 'sw_read_run']],
  ['sw_project_axis -- camera projection', ['sw_project_axis']],
  ['sw_nmi_stream / sw_ns_draw_block / sw_ns_draw_attr -- the NMI draw chain', ['sw_nmi_stream', 'sw_ns_draw_block', 'sw_ns_draw_attr']],
  ['sw_stream_start_col / sw_stream_start_row -- the mainline strip arms', ['sw_stream_start_col', 'sw_stream_start_row']],
  ['sw_cross_right / sw_cross_left -- ring crossings', ['sw_cross_right', 'sw_cross_left']],
]) {
  out.push(`### \`${title}\`\n\n\`\`\`asm\n${labels.map((l) => extractRoutine(sw, l)).join('\n\n')}\n\`\`\`\n`);
}

const bank14 = readLines(`${SRC}/streamworld_bank14.asm`);
out.push(`### \`sw_dlg_metatile\` -- the close-path accessor\n\n\`\`\`asm\n${extractRoutine(bank14, 'sw_dlg_metatile')}\n\`\`\`\n`);

const prim = readLines(`${SRC}/streamworld_banked_primitive.asm`);
const arm = readLines(`${SRC}/streamworld_banked_arm.asm`);
out.push(`### \`sw_strip_fetch_run_col\` and \`sw_banked_stream_start_col\` -- plain kernel-lo since fix round 10\n\n\`\`\`asm\n${extractRoutine(prim, 'sw_strip_fetch_run_col')}\n\`\`\`\n\n\`\`\`asm\n${extractRoutine(arm, 'sw_banked_stream_start_col')}\n\`\`\`\n`);

const dlg12 = readLines(`${SRC12}/streamworld_bank14.asm`);
out.push('### The dialogue overlay prototype (fix round 12)\n');
for (const label of ['sw_dlg_addr', 'sw_dlg12_open_row', 'sw_dlg12_open_attr', 'sw_dlg12_can_open']) {
  out.push(`\`\`\`asm\n${extractRoutine(dlg12, label)}\n\`\`\`\n`);
}

const boot = readLines(`${SRC}/boot.asm`);
const nmiStart = boot.findIndex((l) => l.trim() === 'nmi:');
const nmiEnd = boot.findIndex((l, i) => i > nmiStart && l.trimStart().startsWith('nmi_rti:'));
out.push(`### The real \`nmi:\` routine, in full -- decision A's own arbitration\n\n\`\`\`asm\n${boot.slice(nmiStart, nmiEnd + 3).join('\n')}\n\`\`\`\n`);

process.stdout.write(out.join('\n'));
```

### Extracted routines (this round's own run, against the restored fix-12 scratch tree)

Retired-mechanism pointers into the history file: the one-in-three movement schedule
(`sw_move_tick`/`sw_move_gate`) — `design-streamed-worlds-history.md`, round 6→7; the snap-and-
full-redraw dialogue transaction — round 6→7 and round 8→9; the bank-14 cold-path placement for
the strip-fetch primitive/arm — round 8→9 and round 9→10; the lag-priority-threshold Flash policy
— round 10→11.

### `sw_walk_step_x / sw_walk_step_y — the per-axis subpixel accumulators (Decision 1, proof 2)` (from `minimal-u512/build/streamworld.asm`)

```asm
sw_walk_step_x:
  lda sw_walk_acc_x
  clc
  adc #SW_SPEED_SUB_X
  sta sw_walk_acc_x
  lda #1
  bcc sw_walk_step_x_done
  lda #2

sw_walk_step_y:
  lda sw_walk_acc_y
  clc
  adc #SW_SPEED_SUB_Y
  sta sw_walk_acc_y
  lda #1
  bcc sw_walk_step_y_done
  lda #2
```

### `sw_terrain_or_fill — the fill-aware bounds check every terrain read now goes through (Decision 3, point 2)` (from `minimal-u512/build/streamworld.asm`)

```asm
sw_terrain_or_fill:
  cmp sw_grid_w
  bcs sw_tof_fill              ; screenCol >= gridW (or wrapped negative) -> fill
  cpx sw_grid_h
  bcs sw_tof_fill              ; screenRow >= gridH (or wrapped negative) -> fill
  jmp sw_peek_byte             ; in bounds -- the real, restoring read
```

### `sw_clamp_col / sw_clamp_row — the window/viewport clamp (Decision 3, point 1)` (from `minimal-u512/build/streamworld.asm`)

```asm
sw_clamp_col:
  sta sw_tmp2               ; desired screenCol
  stx sw_tmp                ; desired localCol
  lda sw_grid_w
  sec
  sbc #2
  cmp sw_tmp2
  bcc sw_clamp_col_clamp    ; max < screenCol -> overflow, clamp
  bne sw_clamp_col_fine     ; max > screenCol -> always fine, no clamp
  lda sw_tmp                ; max == screenCol: only local==0 is fine
  beq sw_clamp_col_fine

sw_clamp_row:
  sta sw_tmp2
  stx sw_tmp
  lda sw_grid_h
  sec
  sbc #2
  cmp sw_tmp2
  bcc sw_clamp_row_clamp
  bne sw_clamp_row_fine
  lda sw_tmp
  beq sw_clamp_row_fine
```

### `sw_goto / sw_locate_current — the one-time cold relocate and its O(1) restore` (from `minimal-u512/build/streamworld.asm`)

```asm
sw_goto:
  stx sw_tmp3                ; row
  ldx #0

sw_locate_current:
  lda sw_row_bank_base
  clc
  adc sw_col_region
  clc
  adc sw_base_bank
  lsr a
  pha
  lda sw_col_byte_hi
  bcc sw_lc_8000
  clc
  adc #$A0
  jmp sw_lc_orgset
```

### `sw_peek_byte / sw_read_transaction / sw_read_run — the three bank-safe read contracts` (from `minimal-u512/build/streamworld.asm`)

```asm
sw_peek_byte:
  ; Y (the offset) needs no stashing at all: sw_goto's own body never
  ; touches Y (confirmed by reading it -- only A/X and sw_tmp*), so it
  ; survives the jsr naturally. Two real bugs this round's own isolated
  ; test caught before landing here: (1) stashing the offset in sw_tmp3
  ; -- sw_goto uses sw_tmp/sw_tmp2/sw_tmp3/sw_tmp4/sw_tmp5/sw_tmp6 as its
  ; own scratch (sw_tmp3 as its row accumulator, from its very first
  ; instruction), clobbering it before sw_goto even returned; (2) a `tya`
  ; to stash Y on the stack, which clobbers A -- the very register holding
  ; the caller's own screenCol argument sw_goto needs. Y needs no register
  ; transfer and no stash; A and X must reach sw_goto exactly as the
  ; caller set them.
  jsr sw_goto
  lda [mtptr_lo],y
  pha
  jsr sw_locate_current
  pla
  rts

; ==========================================================================
; sw_terrain_or_fill -- review 5, finding 2's own required fix: routes
; EVERY terrain read through a fill-aware bounds check BEFORE any bank
; switch is attempted, closing the exact gap the reviewer's own
; reproduction demonstrated (sw_grid_w=sw_grid_h=1, requesting screen
; (1,1), returned fixture id 12 -- a real screen's own data, not fill 0 --
; because nothing before this round ever checked the resolved screen
; against the map's own authored grid at all).
;
; Works for EVERY caller shape this design has (the same-screen fast path,
; a cross-screen collision probe, a full-render probe, a strip starter)
; because the check is UNSIGNED: a resolved screenCol/Row of 255 (the
; 8-bit wraparound of a probe one column/row past the LEFT/TOP edge, e0g.
; screenCol=-1) is >= any real sw_grid_w/sw_grid_h, so it falls into the
; fill path exactly the same way a resolved coordinate past the RIGHT/
; BOTTOM edge does -- one check covers every direction, with no separate
; sign test needed.
;
; In: A=screenCol, X=screenRow, Y=offset within that screen (as
;     sw_peek_byte/sw_goto already expect).
; Out: A = the byte -- either the real terrain byte (sw_peek_byte's own
;     full switch/read/restore, unchanged) or sw_fill_metatile_id, with NO
;     bank switch attempted at all in the fill case (there is no real
;     screen there to switch to). Clobbers X, Y exactly as sw_peek_byte
;     does in the real-read case; clobbers nothing in the fill case.
; ==========================================================================

sw_read_transaction:
  jsr sw_goto
  lda [mtptr_lo],y
  pha
  lda sw_caller_bank
  jsr switch_prg_bank
  pla
  rts

; ==========================================================================
; sw_read_run -- review 4, finding 2: the resident BOUNDED-RUN transaction.
; sw_read_transaction (above) reads exactly one byte; several real
; consumers (a collision probe checking more than one metatile across a
; straddled edge, §4/finding 5) need more than one, and copying them to a
; buffer BEFORE the restoring switch_prg_bank runs is mandatory for the
; same reason sw_read_transaction restores before returning at all: the
; instruction immediately after switch_prg_bank executes from whatever
; bank it just selected, so a caller resident in a DIFFERENT bank cannot
; safely dereference the target screen's own mtptr a second time once the
; restore has happened -- the whole run must complete first.
;
; In: A = target screenCol, X = target screenRow, Y = starting offset
;     within that screen's record, sw_run_len = byte count (1-8),
;     sw_caller_bank = the PRG bank number to restore (as sw_read_transaction).
; Out: sw_run_buf[0..sw_run_len-1] holds the copy. Clobbers A, X, Y.
; Constraint, real and disclosed rather than guarded: Y+sw_run_len-1 must
; not exceed 255 (indirect-indexed addressing has no second index register
; to carry an overflow into mtptr_hi). Every caller in this design reads at
; most 8 bytes starting at a probe-computed offset within a 240-byte
; terrain block, so this never binds; a future caller requesting a run
; that WOULD cross 255 must split it into two calls.
; ==========================================================================

sw_read_run:
  jsr sw_goto
  sty sw_run_off
  ldx #0
```

### `sw_project_axis — camera projection, one axis at a time` (from `minimal-u512/build/streamworld.asm`)

```asm
sw_project_axis:
  sta sw_tmp6                 ; stash visibleWidth (0 means "256" for X)
  lda sw_tmp
  sec
  sbc sw_tmp3                 ; delta_lo = world_lo - cam_lo
  sta sw_tmp
  lda sw_tmp2
  sbc sw_tmp4                 ; delta_hi = world_hi - cam_hi
  sta sw_tmp2
  bne sw_project_hide         ; delta_hi != 0 (neither a small positive nor
                                ; a small negative delta) -> nowhere close
  lda sw_tmp6
  beq sw_project_visible      ; visibleWidth==0 means 256 -- every delta_hi==0
                                ; value (0-255) is visible, no further test
  lda sw_tmp
  cmp sw_tmp6                 ; delta_lo < visibleWidth (Y's real 240)?
  bcc sw_project_visible
```

### `sw_nmi_stream / sw_ns_draw_block / sw_ns_draw_attr — the NMI draw chain` (from `minimal-u512/build/streamworld.asm`)

```asm
sw_nmi_stream:
  lda st_active
  bne sw_ns_go
  rts

sw_ns_draw_block:
  ldy st_cur
  ldx sbuf,y
  lda st_active
  cmp #1
  bne sw_ndb_row
  lda st_ftile
  sta <sw_ns_col
  lda st_vary
  cmp #15
  bcc sw_ndb_col_top
  sec
  sbc #15
  asl a
  sta <sw_ns_row
  lda st_fnt
  clc
  adc #$08
  sta <sw_ns_nt
  jmp sw_ndb_addr

sw_ns_draw_attr:
  lda <sw_ns_col
  lsr a
  and #1
  sta <sw_ns_q
  lda <sw_ns_row
  lsr a
  and #1
  asl a
  ora <sw_ns_q
  sta <sw_ns_q
  lda mt_pal,x
  ldy <sw_ns_q
  beq sw_nda_pdone
```

### `sw_stream_start_col / sw_stream_start_row — the mainline strip arms (fill-aware, fix round 10)` (from `minimal-u512/build/streamworld.asm`)

```asm
sw_stream_start_col:
  stx sw_ss_lc
  sta sw_ss_sc
  txa
  asl a
  sta st_ftile                ; tile column = 2*localCol
  lda sw_ss_sc
  and #1
  asl a
  asl a
  sta st_fnt                  ; nt-hi contribution = (screenCol&1)*4
  ; st_vary starting value = (win_row_screen&1)*15 + win_row_local -- the
  ; window's own CURRENT physical row start, R1's own fix (round 1/2 left
  ; this uninitialised).
  lda win_row_local
  sta st_vary
  lda win_row_screen
  and #1
  beq sw_ssc_novoffset
  lda st_vary
  clc
  adc #15
  sta st_vary

sw_stream_start_row:
  stx sw_ss_lr
  sta sw_ss_sr
  txa
  asl a
  sta st_ftile                ; tile row = 2*localRow
  lda sw_ss_sr
  and #1
  asl a
  asl a
  asl a
  sta st_fnt                  ; nt-hi contribution = (screenRow&1)*8
  lda win_col_local
  sta st_vary
  lda win_col_screen
  and #1
  beq sw_ssr_novoffset
  lda st_vary
  clc
  adc #16
  sta st_vary
```

### `sw_cross_right / sw_cross_left — ring crossings (up/down are the mirror-image pair)` (from `minimal-u512/build/streamworld.asm`)

```asm
sw_cross_right:
  inc sw_col
  inc sw_col_rem
  lda sw_col_rem
  cmp #STREAM_SCREENS_PER_REGION
  bne sw_cr_addbyte
  lda #0
  sta sw_col_rem
  inc sw_col_region
  sta sw_col_byte_lo
  sta sw_col_byte_hi
  rts

sw_cross_left:
  lda sw_col_rem
  bne sw_cl_subbyte
  lda #STREAM_SCREENS_PER_REGION-1
  sta sw_col_rem
  dec sw_col_region
  ; recompute byte via a bounded repeated-add (rare: only at a region-
  ; boundary crossing, at most once every 24 screens of walking)
  lda #0
  sta sw_col_byte_lo
  sta sw_col_byte_hi
  ldx #STREAM_SCREENS_PER_REGION-1
```

### `sw_dlg_metatile` (from `minimal-u512/build/streamworld_bank14.asm`) -- the close-path accessor

```asm
sw_dlg_metatile:
  stx sw_dlg_rbrow          ; boxRow, stashed (X is about to be reused)
  clc
  adc sw_dlg_olcol
  cmp #16
  bcc sw_dlgm_col_ok
  sbc #16
  sta sw_dlg_rlcol
  lda sw_dlg_ocol
  clc
  adc #1
  jmp sw_dlgm_col_done
```

### `sw_strip_fetch_run_col` (from `minimal-u512/build/streamworld_banked_primitive.asm`) and `sw_banked_stream_start_col` (from `minimal-u512/build/streamworld_banked_arm.asm`) -- proven plain kernel-lo since fix round 10, no longer bank-14

```asm
sw_strip_fetch_run_col:
  cmp sw_grid_w
  bcs sw_sfr_fill
  cpx sw_grid_h
  bcs sw_sfr_fill
  jsr sw_goto
  sty sw_tmp2                 ; starting sbuf index -- safe NOW, sw_goto
                               ; has already returned and never touched Y
  lda #16                     ; column stride
  sta sw_tmp3
  jmp sw_sfr_body
```

```asm
sw_banked_stream_start_col:
  stx sw_ss_lc
  sta sw_ss_sc
  txa
  asl a
  sta st_ftile
  lda sw_ss_sc
  and #1
  asl a
  asl a
  sta st_fnt
  lda win_row_local
  sta sw_probe_row_local
  lda win_row_screen
  sta sw_probe_row_screen
  lda #0
  sta ss_i                    ; sbuf write cursor / blocks placed so far
```

### The dialogue overlay prototype (fix round 12) -- `sw_dlg_addr`/`sw_dlg12_open_row`/`sw_dlg12_open_attr`/`sw_dlg12_can_open` (from `minimal-u512-fix12/build/streamworld_bank14.asm`, injected after `sw_dlg_metatile`)

```asm
sw_dlg_addr:
  stx <sw_dlgw_col2
  lda <sw_dlgw_physrow
  and #7
  asl a
  asl a
  asl a
  asl a
  asl a
  ora <sw_dlgw_col2
  tay
  lda <cam_nt
  eor <sw_dlgw_ntbit
  and #3
  tax
  lda <sw_dlgw_physrow
  lsr a
  lsr a
  lsr a
  clc
  adc sw_dlg_nt_hi,x
  rts
```

```asm
sw_dlg12_open_row:
  sta <sw_dlgw_lograw
  jsr sw_dlg_yinfo
  lda <sw_dlgw_lograw
  jsr sw_dlg_seamx
  sta <sw_dlgw_seam
  lda <sw_dlgw_lograw
  bne sw_dlg12_o_notfirst
  jmp sw_dlg12_o_edge
```

```asm
sw_dlg12_open_attr:
  sta <sw_dlgw_lograw          ; the band-row index (0-2), stashed because
                                 ; sw_dlg_attr_rows_precompute's own three
                                 ; internal sw_dlg_attr_yinfo calls (for
                                 ; bIdx 0,1,2) overwrite the "official"
                                 ; ayflip/arow/rowhalf as a side effect --
                                 ; re-set them for THIS row afterward
  jsr sw_dlg_attr_rows_precompute
  lda <sw_dlgw_lograw
  jsr sw_dlg_attr_yinfo
  jsr sw_dlg_attr_setup
  lda <sw_dlgw_lograw
  jsr sw_dlg_attr_forcefull_for
```

```asm
sw_dlg12_can_open:
  lda st_active
  beq sw_dlg12_co_yes
  sec
  rts
```

### The real `nmi:` routine, in full (from `minimal-u512/build/boot.asm`) — decision A's arbitration and the mixed-vblank branch

**Provenance, corrected this round (review 9 finding 6).** The mixed-vblank branch
(`MIXED_VBLANK_MAX_BYTES`/`sw_nmi_stream_reduced`/`nmi_drain_big`) has, until now, only ever existed
as a *temporary* patch (`build_f11_mixed_vblank_fixture.mjs` applies it, runs one Mesen fixture, then
reverts it) or as a copy inside a separate per-round directory (`minimal-u512-fix15`,
`minimal-u512-fix16`) — the shared `minimal-u512/build/boot.asm` this Appendix's own extraction
script reads from still carried the pre-fix-11 EXCLUSIVE-drain-only arbitration, so this excerpt was
showing a superseded branch under a heading that already claimed the mixed one. Fixed by
`proto-tools/persist_mixed_vblank_fix16.mjs`, which makes the branch permanent in a **dedicated**
copy (`minimal-u512-appendix16`) rather than the shared baseline — the same outcome `SW_STREAM_CHUNK
= 3` already has (a permanent, checked-in value, never a temporary patch), reached without breaking
every other proto-tools script's own `replaceOnce` search against the shared baseline's pre-mixed-
vblank anchor text. Re-extracted from that copy; assembles clean (`nesasm -s`, 0 errors).

```asm
nmi:
  pha
  txa
  pha
  tya
  pha

  lda #$00
  sta $2003
  lda #$02
  sta $4014                 ; OAM DMA from $0200

  lda <vram_ready            ; a frame that ran long has not finished appending;
  beq nmi_no_drain           ; skipping leaves the writes for the next vblank
  ; Fix round 11 Part A, made PERMANENT fix round 16 (review 9 finding 6 --
  ; the Appendix must show the SELECTED code, not a temporarily-patched-then-
  ; reverted branch): a SMALL queue (<= MIXED_VBLANK_MAX_BYTES bytes, one
  ; real packet) still drains in full, right here, but ALSO lets a REDUCED
  ; strip chunk advance the SAME vblank.
MIXED_VBLANK_MAX_BYTES = 35
  lda <vram_len
  cmp #MIXED_VBLANK_MAX_BYTES+1
  bcs nmi_drain_big
  jsr vram_drain

  ; Fade's own packets were the first producer into vram_buf whose own
  ; address ends inside palette space ($3F00-$3F1F): after vram_drain
  ; finishes a 32-byte packet from $3F00, the PPU's internal VRAM address
  ; register (v) is left at $3F20 -- still a palette mirror. Real hardware
  ; (and emulators modelling it faithfully) documents a real risk of visible
  ; corruption when v is left pointing into $3F00-$3FFF at the moment
  ; rendering resumes. Every other producer in this engine is safe from this
  ; by accident of what it draws -- text.asm's packets all end inside
  ; nametable space ($2000-$23FF), so nobody had to think about this before
  ; Fade. The fix is two more $2006 writes with NO following $2007 -- moving v
  ; without touching any actual VRAM byte. This runs after *any* drain, not
  ; only a palette one: tracking "was the packet just drained a palette one"
  ; would cost more bytes than the few cycles this costs to run
  ; unconditionally, and gating the whole block on PALETTE_FX_ENABLED already
  ; means a project using neither Fade nor Flash pays nothing for it at all.
  ;
  ; Gated on PALETTE_FX_ENABLED (usesFade || usesFlash), not FADE_ENABLED
  ; alone -- Flash's own packets (flash_apply_on/fade_apply_palette,
  ; engine/entities.asm) end in palette space too, and this is the identical
  ; hazard for them. One physical copy of this block, labels unchanged, so a
  ; Fade-only build still assembles byte-identically to before: PALETTE_FX_
  ; ENABLED is true under exactly the same condition FADE_ENABLED alone used
  ; to be for that configuration.
  .if PALETTE_FX_ENABLED
nmi_fade_ppuaddr:
  lda #$00
  sta $2006
  sta $2006
nmi_fade_ppuaddr_done:
  .endif

  ; R4's own NMI hook (prototype only, never part of the shipping engine):
  ; the streaming chunk runs after vram_drain and the fade PPUADDR fixup,
  ; before the $2000/$2005 rewrite below -- CLAUDE.md's own ordering rule
  ; ("NMI rewrites $2000 after draining, not before"), so a chunk's own
  ; $2006/$2007 writes can never leave the PPU's t register pointed at the
  ; wrong nametable when rendering resumes.
  jsr sw_nmi_stream_reduced   ; fix round 11 Part A: the small-queue path --
                              ; the reduced chunk advances the SAME vblank
  jmp nmi_scroll

  nmi_drain_big:              ; fix round 11 Part A: a queue too big for a
                              ; mixed vblank -- exclusive drain, unchanged
  jsr vram_drain
  .if PALETTE_FX_ENABLED
  lda #$00
  sta $2006
  sta $2006
  .endif
  jmp nmi_scroll

  nmi_no_drain:
  jsr sw_nmi_stream           ; nothing else touched vram_buf this vblank
                              ; -- the strip may advance one chunk

nmi_scroll:
  ; $2000 is rewritten *after* the drain, not before: a $2006 write copies its
  ; high byte into the PPU's `t` register, nametable-select bits and all, so the
  ; scroll reset below is not enough on its own to undo a queued write.
  ;
  ; Screen shake (item 6). PPUSCROLL's X is a 9-bit unsigned coordinate --
  ; $2005 supplies the low 8 bits, PPUCTRL bit 0 supplies bit 8 -- not a plain
  ; byte a caller can wrap on its own the way OAM's 8-bit X can under ADC.
  ; PPUCTRL_ON ($88) has bit 0 clear, so a -2 pixel offset is the 9-bit value
  ; 510, composed as PPUCTRL bit 0 SET together with $2005=$FE.
  ;
  ; The sign alternates on shake_left's own low bit, not frame_cnt's. frame_cnt
  ; is a wall clock unrelated to when any particular Shake started, so deriving
  ; sign from it would make two identical Shakes look different (or, for a
  ; short one, land entirely on one phase) purely from accumulated timing that
  ; has nothing to do with the authored effect. shake_left's own bit is
  ; effect-local -- it decrements every active frame of *this* shake, so which
  ; phase a given frame shows depends only on how many frames of this shake
  ; are left, the same way a duration-1 shake always lands on the same phase
  ; regardless of when it was triggered.
  ;
  ; Every active frame shows +2 or -2 -- there is no zero phase -- so a
  ; 2-pixel sliver of whatever nametable is horizontally adjacent (never
  ; drawn by this engine; see CLAUDE.md's own note on nametable 0) is visible
  ; at the left or right screen edge for the whole shake, alternating sides.
  ; Accepted and documented, the same way CLAUDE.md already accepts the MMC3
  ; split's own one-line real-hardware sliver and the overscan columns: a
  ; real, small, known cost, not a defect to chase out.
  ;
  ; Background only: PPU scrolling moves the nametable, not OAM. The player,
  ; entities and any sprite-based UI hold still while the world shakes around
  ; them -- a known, accepted v1 limitation (costed and rejected: syncing
  ; sprites needs the OAM DMA above reordered behind the shake decision, plus
  ; a per-frame cost of roughly 1,500-1,600 cycles against a ~2,273-cycle
  ; vblank budget that already spends 513 on that same DMA).
  .if !CAMERA_ENABLED
  .if SHAKE_ENABLED
  lda <shake_left
  beq nmi_scroll_no_shake
  dec <shake_left
  lda <shake_left
  and #1
  bne nmi_scroll_shake_neg
  lda #PPUCTRL_ON
  sta $2000
  lda #2
  jmp nmi_scroll_shake_x
nmi_scroll_shake_neg:
  lda #PPUCTRL_ON|1
  sta $2000
  lda #$FE
nmi_scroll_shake_x:
  sta $2005
  lda #$00
  sta $2005
  jmp nmi_scroll_done
nmi_scroll_no_shake:
  .endif
  lda #PPUCTRL_ON
  sta $2000
  lda #$00                  ; this engine draws one screen at a time
  sta $2005
  sta $2005
  .endif

  ; docs/design-camera.md §2: cam_x_lo/cam_y_lo/cam_nt replace the constant
  ; (0,0) above once a project turns the camera on. Shake still perturbs the
  ; horizontal 9-bit coordinate by +-2, only now that coordinate is
  ; cam_nt/cam_x_lo instead of always (0,0) -- the ADC carry and SBC borrow
  ; each fire at a different threshold of cam_x_lo (255 vs 0..1), so the +2
  ; and -2 phases cannot share one carry test the way a fixed-at-zero shake
  ; could get away with skipping entirely. Reduces to today's exact
  ; PPUCTRL/$2005 sequence when cam_x_lo=cam_nt=0 (camera at rest) -- see
  ; camera.test.js's own shake-over-rest-camera assertion.
  .if CAMERA_ENABLED
  ; docs/design-camera.md §2: cam_dirty is a publication lock, raised before
  ; the first store of a wrap update (the low-byte coordinate) and released
  ; after the last (the cam_nt toggle) by whichever consumer writes cam_*,
  ; covering both stores of the pair, not just the second one -- a lock that
  ; only guards the last store is not a lock. nmi_scroll's own camera path
  ; never *skips* the scroll write when dirty is set: the drain above
  ; (vram_drain) and PALETTE_FX_ENABLED's own PPUADDR cleanup both already
  ; move the PPU's v/t register before nmi_scroll ever runs, so "skip the
  ; write and the PPU keeps the last value" is false here -- not rewriting
  ; $2000/$2005 below would leave the picture scrolled to wherever the drain
  ; last pointed it, not to any camera position at all. Instead nmi_scroll
  ; maintains its own last-complete snapshot (nmi_cam_x_lo/y_lo/nt, below):
  ; refreshed from cam_x_lo/y_lo/cam_nt only while cam_dirty is clear, left
  ; alone (the last known-good coordinate) while it is set, and always what
  ; gets composed with Shake and written to $2000/$2005 -- so every vblank
  ; writes a real, complete coordinate, torn or not, refreshed or stale (the
  ; coherent-stale-frame policy, docs/design-camera.md §2).
  lda <cam_dirty
  bne nmi_scroll_cam_stale
  lda <cam_x_lo
  sta <nmi_cam_x_lo
  lda <cam_y_lo
  sta <nmi_cam_y_lo
  lda <cam_nt
  sta <nmi_cam_nt
nmi_scroll_cam_stale:
  .if SHAKE_ENABLED
  ; docs/design-camera.md §2: nmi_tmp, not mainline <tmp -- nmi only saves/
  ; restores A/X/Y (this handler's own pha/txa/pha/tya/pha above), so reusing
  ; mainline's <tmp here would corrupt whatever mainline routine (e.g.
  ; probe_type, engine/player.asm) is mid-use of it on a long frame. Composes
  ; on nmi_cam_x_lo/nmi_cam_nt (the snapshot), not cam_x_lo/cam_nt directly --
  ; those may be mid-update.
  lda <shake_left
  beq nmi_scroll_cam_no_shake
  dec <shake_left
  lda <shake_left
  and #1
  bne nmi_scroll_cam_shake_neg
  lda <nmi_cam_x_lo
  clc
  adc #2
  sta <nmi_tmp
  lda <nmi_cam_nt
  bcc nmi_scroll_cam_shake_pos_nt
  eor #1
nmi_scroll_cam_shake_pos_nt:
  jmp nmi_scroll_cam_shake_apply
nmi_scroll_cam_shake_neg:
  lda <nmi_cam_x_lo
  sec
  sbc #2
  sta <nmi_tmp
  lda <nmi_cam_nt
  bcs nmi_scroll_cam_shake_neg_nt
  eor #1
nmi_scroll_cam_shake_neg_nt:
nmi_scroll_cam_shake_apply:
  ora #PPUCTRL_ON
  sta $2000
  lda <nmi_tmp
  sta $2005
  lda <nmi_cam_y_lo
  sta $2005
  jmp nmi_scroll_done
nmi_scroll_cam_no_shake:
  .endif
  lda <nmi_cam_nt
  ora #PPUCTRL_ON
  sta $2000
  lda <nmi_cam_x_lo
  sta $2005
  lda <nmi_cam_y_lo
  sta $2005
  .endif
nmi_scroll_done:

  .if SPLIT_ENABLED
  jsr split_arm             ; art back in for the top, first IRQ armed
  .endif

  inc <frame_cnt
  lda #1
  sta <vblank

  pla
  tay
  pla
  tax
  pla
nmi_rti:                    ; zero bytes -- a Mesen CPU-execute callback keyed
                            ; to this symbol is test/lua's own anchor for
                            ; asserting the whole two-producer NMI still
```
