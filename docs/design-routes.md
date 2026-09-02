# Design: Move/Turn/Wait routes (item 6's last unshipped line)

Status: design only, no code written, no tracked file touched. **Revised four times**, against
four review rounds (round 1: 11 findings; round 2: 7 findings; round 3: 1 finding; and
round 4: 2 findings), all confirmed by the orchestrator against
source before each revision was written — see the "Fix rounds" section at the end for what moved and
why in each. Companion precedent: the Tile Forge's own design (a Map Forge authoring + preview
feature, the closest shape to this one) and `docs/design-sting.md` (the most recent
cutscene-verb slice, same item) are the models this follows for depth and format. Written against
HEAD `6a44850`.

## §1. What this is, and the invariant everything below has to satisfy

A **route** is a Map Forge authoring convenience: one command that holds an ordered list of
"legs," each leg an ordinary Move, Turn or Wait. Authoring one route instead of chaining three
separate commands is the whole feature — per ROADMAP.md (lines ~659-672, ~916-925) and
CLAUDE.md's own note under the `move` entry in `EVENT_COMMANDS` ("the piece item 6's movement
routes are built out of: a route is this with a list of steps instead of one"), this was costed
and shipped as **zero engine cost**, because a route compiles to a linear run of the *existing*
`OP_MOVE`/`OP_TURN`/`OP_WAIT` opcodes on one page, and `script_resume` (`engine/script.asm`)
already chains suspending commands correctly with no new mechanism.

**The invariant the whole design hangs on:** a project authoring a route must produce a ROM
**byte-identical** to the same project authoring the equivalent commands hand-chained one at a
time, and a route-free project must be byte-identical to today. Every decision below is chosen,
first, to make that trivially true by construction — not to make it true by writing new
special-case code that happens to agree. Where a decision could go either way on authoring
grounds, the byte-identity argument breaks the tie.

I read the code before designing against it (§2), found one sharp, easy-to-miss constraint round 1
did not anticipate (§3.0 — `EVENT_COMMANDS`' array position *is* the wire opcode for most entries,
which bounds where `route` may be inserted), and built the rest of the design around reusing
already-correct machinery — `isLive`, `allCommands`, `liveCommands`, `encodeBody` — rather than
writing new pieces that would have to be proven correct independently. Round 1 got the reuse
argument half right: it correctly reused `encodeBody`'s recursion for the byte-identity proof, but
it misread two of the repository's own stated contracts along the way (`nests: true`'s actual
meaning, and `liveCommands`' "yield what `encodeBody` emits" contract) — both fixed in round 1's own
revision, §3.1 and §5.2. Round 2 found the shared-helper reuse round 1 introduced (`routeLegs`) was
itself introduced *inconsistently* — stated as universal but actually applied at only four of the
six places that read a route's legs, missing exactly the two (the editor's leg rows and the
preview's trace walker) where the gap is silently wrong rather than loudly broken — and that the
preview's own promised render data path (§5.4/§10) named a start position without naming anything
the background art could actually be drawn from. Both fixed in round 2's own revision. Round 3 found
that round 2's own fix for the first of those two gaps was itself incomplete: the leg rows rendered
the filtered, admitted list, but the row tools (`listTools`) kept splicing the *raw*, unfiltered
array by the filtered list's own position — correct only when nothing had actually been filtered
out, wrong (silently, editing the wrong leg) in precisely the case this whole line of fixes exists to
handle. Closed in round 3's own revision by canonicalizing the modal's own draft at render time (§9),
so there is no longer a second, differently-indexed array for the row tools to disagree with. Round 4
found two smaller things left over from round 3's own haste: its new smoke test asked to inspect the
modal's closure-private draft directly, which nothing outside `editEvent` can reach without adding a
test-only hook, and it mis-derived what round 2's actual bug would have shown on screen for its own
"illegal leg first" fixture. Both corrected in this revision (§13), along with one accounting fact
left stale since round 3 gave the pure trace-model helper its own defensive `routeLegs` re-filter
(§3.3, now counting it as a real seventh consumer instead of denying it a place in the count).

**No engine byte is required anywhere in this design.** Nothing below asks for one.

## §2. What I read

Round 1's reading list (`ROADMAP.md`, the relevant `CLAUDE.md` sections, `shared/project.js`,
`shared/eventrules.js`, `main/build/textcompile.js`, `main/build/generate.js`,
`engine/constants.asm`'s `OP_*` block, `renderer/forges/map/events.js`, `renderer/forges/map/
map.js`, `renderer/forges/map/render.js`, `renderer/forges/map/templates.js`, `renderer/ui.js`,
`main/smoke.js`, `test/unit/move.test.js`) stands; not repeated here. This revision additionally
read, to resolve the review's findings:

- `test/unit/project.test.js:2765-3025` in full — the `'liveCommands and encodeBody agree on the
  actual sequence of compiled opcodes'` test (finding 2's own citation): `FIXED_OPCODE_WIDTH`,
  `decodeOpSequence` (a real bytecode decoder, branch/choice included), and the scenario table,
  including the now-resolved dangling-`call` case, whose own comment documents that `call` used to
  be a deliberate, documented exception to "these two sequences must match" and is **not** one any
  longer — the precedent the fix brief points at for "do not add route as a second silent
  exception."
- `shared/eventrules.js:89-124` (`liveCommands`' own doc comment) again, specifically the `call`
  carve-out paragraph, to confirm its shape (a documented, single, *named* exception — not a silent
  one) and that it no longer applies post-fix, which is what licenses treating route's own
  recursion as *conforming to* the "yield what `encodeBody` emits" contract rather than as a new
  exception to it (§5.2).
- `shared/project.js:587-626` again (the `EVENT_COMMANDS` array through `call`'s own entry) to
  re-read `nests`' contract sentence exactly ("the command holds a list of commands, whatever it
  calls them") and `call`'s own comment ("this does not hold its own commands... so it is not
  `nests: true`") — confirming a route, whose legs *are* real held commands, does not fit `call`'s
  exemption and must be `nests: true` (finding 1).
- `renderer/forges/map/events.js:1340-1378` in full (`editCommonEvents`) and its call site,
  `renderer/forges/map/map.js:646-661` (`openCommonEventsEditor`), to confirm the context it builds
  carries no entity/screen — and `renderer/forges/map/map.js:880-933` in full (`applyTemplate`) to
  confirm its own `editEvent` call site *is* placement-owned (`entity`/`index` in scope, same as
  the "Edit event…" button), giving three `editEvent` call sites total, two placement-owned and one
  not (finding 5).
- `renderer/forges/map/events.js:411-431` (`addCommand`) again, to confirm the `nests`-depth filter
  (`!entry.nests || depth < MAX_BRANCH_DEPTH`) is the only thing standing between "route is offered
  everywhere" and "route is offered exactly as deep as branch/choice are" — the direct knock-on of
  finding 1's fix.
- `main/build/generate.js:768-778` (`projectWithoutCommands`) again, confirming it is a plain,
  DOM/Node-free function operating only on project JSON despite living in a file that also imports
  `node:fs` for unrelated reasons — safe to export for test consumption without violating the
  renderer-import boundary that motivated `battletables.js`'s own separate module (finding 8).
- `shared/project.js:3060-3070` to correct the round-1 misattribution of `projectUsesFace` (finding
  11) — it is defined there, not in `generate.js`, which only imports it.
- `main/build/textcompile.js:27-53` (the file's own import block) to settle finding 11's import-
  consistency question: the file imports the great majority of `shared/project.js`-owned symbols
  from `shared/project.js` itself, with one pre-existing exception (`damageAmount`, imported
  directly from `shared/eventrules.js`) that this design does not touch or extend — the new symbols
  follow the majority pattern (§5.1's import list).

Round 2 additionally read, to resolve that review's findings:

- `test/unit/move.test.js:283-305` in full — `'a switched-off Move costs a project nothing — not
  one byte of ROM'` — confirming its exact shape: two ROMs, an `off: true` command plus a real one
  vs. the real one alone, both built in the *same test run*, asserted byte-identical. No checked-in
  reference ROM anywhere in this file, or (grepped) anywhere else in `test/unit/`. This is the
  precedent finding 1 names as what a route's own permanent test must actually look like (§6/§13
  test 3).
- `renderer/forges/map/map.js:622` (`eventContext()`'s own definition) again, confirming it takes
  **zero** parameters today — round 1's "gains an optional second parameter" was wrong on its face;
  there is no first parameter to be second to (finding 3, §5.4/§10).
- `renderer/forges/map/map.js:1595-1608` (the module's own live `MetatileRenderer` construction and
  its two `rebuild()` call sites) to find the exact expression the rest of the file already uses for
  a screen's tileset id — `currentMap().tilesetId` — and confirm `MetatileRenderer.rebuild(project,
  tilesetId)` (`render.js:24`) needs the whole project (for `project.metatiles`/`project.palettes.bg`)
  plus that id, never a screen alone, closing the gap finding 3 named (§5.4/§10).
- `test/unit/project.test.js:2772-2789` (`FIXED_OPCODE_WIDTH`'s own current entries) again,
  confirming it has no `move`, `turn`, or `wait` key today, so a route scenario reaching
  `decodeOpSequence`'s fixed-width fallback for any of the three would fail with "no known fixed
  width" before proving anything about routes at all (finding 4, §13).
- `test/unit/script.test.js:1259-1305` in full — `'nesting past what any project could hold fails by
  name, not by stack'` — confirming its `deep(levels)` helper alternates `branch`/`choice` wrapping
  levels around a plain `{ op: 'say', ... }` base case, and that the test only ever checks 200-deep
  (throws) against 60-deep (does not), never the exact `BRANCH_DEPTH_LIMIT` boundary against a
  `nests: true` command sitting *at* it — confirming the review's own point that this test, as it
  stands, would still pass in full even if `route` never got `nests: true` at all (finding 5, §13).
- `shared/eventrules.js:105-122` (the stale `call`-carve-out paragraph inside `liveCommands`' own
  doc comment) once more, this time to excerpt its exact current wording for deletion rather than
  merely to confirm it no longer applies (finding 6, §5.2).

## §3. Central decisions

### §3.0 — Where `route` may sit in `EVENT_COMMANDS`, and the catalog invariant that makes it safe forever, not just today

`opIndex(id) = Math.max(0, EVENT_COMMANDS.findIndex((entry) => entry.id === id))`
(`main/build/textcompile.js:65`). For every command whose `encodeCommand` case writes
`opIndex(command.op)` — `warp`, `give`/`take`, `setSwitch`/`clearSwitch`, `setVar`/`addVar`/
`subVar`, `heal`/`damage`, `save`, `move`, `turn`, `wait`, `shake`, `visible`, `fade`, `flash`,
`join`, `branch`, `choice` — **the compiled opcode byte is that command's position in the
`EVENT_COMMANDS` array**, not a constant declared anywhere in JS. `OP_SAY`/`OP_CALL`/`OP_MUSIC`/
`OP_BATTLE`/`OP_STING` are the same thing, just hoisted to named constants at module load. And
`engine/constants.asm` hand-writes `OP_END = $00` through `OP_STING = $1A` in the identical order,
by inspection — an unstated but load-bearing single-writer relationship that has held only because
nobody has ever inserted an entry into `EVENT_COMMANDS` anywhere but the end.

**The rule, stated once, directly, and made mechanically checkable rather than merely asserted in
prose (finding 4):** `EVENT_COMMANDS` is partitioned into a **real prefix** — every entry backed by
an actual engine `OP_*` constant, in the exact order `engine/constants.asm` lists them, starting at
index 0 — followed by a **virtual tail**, entries with no engine opcode of their own, each marked
`virtual: true`. Today the real prefix is `end` through `sting` (27 entries, indices 0-26) and the
virtual tail is exactly one entry: `route`.

- **A future engine-backed command** (a new `OP_*` constant, real dispatch code in
  `script_run`/`script_skip`) is inserted **at the end of the real prefix — immediately before the
  virtual tail begins**, never after any virtual entry. This gives it the next sequential opcode
  value and shifts every virtual entry after it by one position — which costs nothing, because
  nothing computes a virtual entry's own `opIndex()` value (see below) — while every *real* entry's
  opcode is completely undisturbed.
- **A future virtual (compiler-only, zero-engine-cost) command** is appended **at the very end**,
  after every existing virtual entry including `route`. This shifts nothing at all.
- Both rules are enforced by a new unit test, not merely documented (§13, the ordinal test): it
  asserts every real entry's `opIndex()` against a hardcoded table of `engine/constants.asm`'s own
  `OP_*` values (the same "hardcode it, do not read the file you are checking" discipline
  CLAUDE.md's own 6502-traps section already applies to engine RAM addresses), and separately
  asserts that every `virtual: true` entry forms one contiguous block immediately after the real
  entries — so an insertion in the wrong place fails a direct, named assertion rather than being
  merely "unsafe" in a way only a careful reviewer would notice.

`route` therefore carries `virtual: true` as a declared field on its `EVENT_COMMANDS` entry (§5.1),
not an unstated fact a reader has to infer from "nothing calls `opIndex('route')`." It gets a real
array position (27th, i.e. `opIndex('route') === 27` if anything ever computed it), but nothing
ever does — see §5.3's compiler case, which emits a route's legs directly with no opcode byte of
its own, the same way `end`'s own position exists in the array (as `OP_END`'s value) without
`opIndex('end')` ever being computed either (`normalizeEventCommand` drops an `end` command
outright, line 1660, before it could reach `encodeCommand` at all). An index that exists in the
array but is never asked for as a byte is not a new phenomenon this design introduces; `virtual:
true` is what makes it a declared, checked fact about that index rather than an implicit one.

### §3.1 — Schema shape: `route` is `nests: true`, with a strict, separately-enforced leg vocabulary

**Round 1 got this wrong, and the review's finding 1 is adopted as written.** Round 1 argued `route`
should *not* be `nests: true`, on the theory that the flag means "holds an arbitrary list of
commands, of any type, indefinitely nestable." That is not what the source contract says.
`EVENT_COMMANDS`' own comment (`shared/project.js:609-611`) states the flag's actual meaning
directly: *"`nests` says the command holds a list of commands, whatever it calls them. The
editor's depth limit and the schema's safety bound both ask this rather than naming the two
commands, so a third one is not a third place to edit."* Nothing in that sentence says the child
vocabulary must be unrestricted — whether the children are arbitrary is a fact about the command's
own arg handler and editor, entirely separate from whether `nests` is set. `call`'s own comment
(`shared/project.js:618-625`) makes the *actual* exemption condition explicit by contrast: `call`
is not `nests: true` because it **holds no commands at all**, only a reference to one authored
elsewhere. A route's legs are real, held, normalized command records — the opposite case. By the
contract as written, a route that holds commands must be `nests: true`, full stop; round 1's
alternative reading invented a narrower flag than the one that exists, and in doing so created
exactly the "specially named exception" CLAUDE.md's own comment says a third container must not
be — the very failure mode the flag exists to prevent (a hand-rolled, undocumented depth policy
that silently disagrees with branch/choice's).

**Adopted fix: `route` is `nests: true`, and the leg vocabulary restriction is enforced entirely
separately, by the shared admission helper `routeLegs` (finding 3, §3.3/§5.2), not by `nests`
itself.** A restricted child vocabulary and the common container-depth rule are not in tension —
they answer two different questions (*what* may a route hold vs. *how deep* may a route sit), and
this design now answers each with the mechanism actually built for it: `routeLegs`/`ROUTE_LEG_OPS`
for the first, the existing `nests`-driven depth machinery for the second.

**The knock-ons, worked through honestly, not glossed over:**

- `normalizeEventCommand`'s existing guard — `if (command.nests && depth >= BRANCH_DEPTH_LIMIT)
  throw` (line 1661) — now applies to `route` exactly as it already applies to `branch`/`choice`. A
  route authored 64 levels deep inside nested branches throws the identical error a branch that
  deep already does. This is the point of the fix, not a side effect to work around: a route is a
  container, and every container gets the same safety bound.
- The editor's `addCommand` depth filter (`events.js:427`, `!entry.nests || depth < MAX_BRANCH_DEPTH`)
  now hides `route` from the "+ Add a command…" dropdown once nesting depth reaches
  `MAX_BRANCH_DEPTH` (8), the same as `branch`/`choice` are already hidden there. Round 1's design
  offered `route` unconditionally at any depth; that is now corrected — §9 updates the editor
  section to describe the depth-gated offering rather than an unconditional one.
- **A route may still sit inside a branch or a choice** — nothing about being `nests: true` changes
  that; it is still an ordinary offered entry in `addCommand`'s list, now subject to the identical
  depth ceiling every other `nests: true` entry already has, not a new restriction beyond that.
- **A branch, a choice, or another route still may never sit inside a route's own leg list.** This
  is *not* a consequence of `nests: true` (which only gates depth, not vocabulary) — it is enforced
  entirely by `routeLegs`, the shared admission helper described in §3.3/§5.2, consumed by
  normalization, liveness, `liveCommands`, the compiler, and the editor's own leg-adding dropdown,
  so all five agree by construction rather than by five separately-written checks that could drift.
  The leg-list editor's own leg-adding control is hardcoded to the three admitted ops (§9); there is
  no UI path to construct the illegal nesting, and a hand-edited or later-version file that has one
  anyway is silently dropped at normalize time (§8), the identical "drop rather than reinterpret"
  answer `choice`'s own too-many-options truncation already gives.

`allCommands`/`liveCommands`/`isLive` still each need a small, deliberate addition to recognize a
route's own leg field (`command.legs`, a third shape these walks have never seen — `then`/`else`
and `options[].commands` being the first two, per this file's own "there will be a third" comment)
— but this is now clearly the *third recursion target*, unrelated to whether `route` is `nests:
true`; the two are separate facts about the same command, resolved in §5.2.

### §3.2 — Who moves: one `who` per route, not per leg

Unchanged from round 1, and not disputed by the review. A route-level `who` (reusing
`MOVE_TARGETS` — `self`/`player` — verbatim) applies to every Move and Turn leg in the route; Wait
legs ignore it. Argued three ways:

- **Authoring.** A cutscene walking two different actors along two different paths is naturally
  two routes, one per actor — nobody asks "and now which of these seven legs moves the shopkeeper
  and which move the player" inside a single route. Per-leg `who` buys nothing an author would
  reach for, and it is one more control to render and mis-set on every leg row.
- **The preview** (§10) needs a single walker with a single starting position to trace a path from.
  A per-leg `who` would mean the preview either draws multiple disconnected paths from the same
  entity's placement (wrong — the "other" `who` doesn't start there) or silently ignores every leg
  but the first `who` it sees, which is exactly the kind of silently-wrong-not-labeled preview this
  codebase refuses to ship. A route-level `who` makes "trace one path from one start point" the
  only question the preview ever has to answer.
- **Byte-identity is unaffected either way** — each leg still compiles to its own `[opcode, who,
  dir, (dist|frames)]` bytes regardless of where `who` is authored from, so this is a pure
  authoring-ergonomics call, not a compiler constraint.

**One addition following from §3.1:** since a route is now `nests: true`, a route sitting at
`MAX_BRANCH_DEPTH` is simply not offered at all (§3.1) — this has no bearing on `who`, but is
mentioned here only to note that "how deep can a route be nested" and "who does a route move" are
fully independent questions this design answers separately, with no interaction between them.

**The trap this creates, and the fix (unchanged from round 1):** `normalizeEventCommand`'s existing
`move`/`turn` arg handling (`arg === 'who'`) always stamps a `who` field onto whatever it
normalizes, defaulting to `MOVE_TARGETS[0]` (`self`) when absent — and §5.1 reuses that exact code
path to normalize each leg (single-writer: legs get the *same* who/dir/dist/frames clamping a
standalone Move/Turn already has, not a second copy of it). That means every normalized `move`/
`turn` leg comes back carrying a `who` field nothing ever reads. The leg normalizer explicitly
`delete`s `who` off each normalized `move`/`turn` leg before storing it, so the stored schema never
contains a field nothing reads.

### §3.3 — What a leg is; clamps; the shared admission helper; the empty-route/no-op-leg question

A leg is exactly one of:

```
{ op: 'move', dir: <MOVE_DIRECTIONS id>, dist: 0-255, off?: true }
{ op: 'turn', dir: <MOVE_DIRECTIONS id>, off?: true }
{ op: 'wait', frames: 0-255, off?: true }
```

No other op is legal in a leg list. `dir`/`dist`/`frames` are clamped by the **identical** code
path a standalone Move/Turn/Wait command already clamps through — reused, not duplicated (§5.1) —
so a leg's fields can never disagree with what the same field means on a bare command.

**The vocabulary restriction is enforced by one shared function, consumed everywhere `.legs` is
read (finding 3, adopted as written).** Round 1's design stated the restriction as a promise
("never a branch, a choice, or another route") but implemented it inconsistently: the normalizer
alone filtered by op, while `isLive`'s route branch, `liveCommands`' route recursion, and the
compiler's route case all walked `command.legs` raw, unfiltered — meaning a **live,
not-yet-normalized** project (exactly the kind `buildProject` compiles, per this repository's own
repeated caution that it "receives the project the app is holding rather than a freshly normalized
copy") holding a route with an illegally-shaped leg (a hand-edited `say`, a stray `branch`, a
future op this version doesn't recognize) would have been compiled and counted by round 1's design
even though a save/reload would silently drop it — the identical class of gap `choiceOptionsSlice`
already exists to close for `choice` (its own comment states the precedent directly: an unbounded
walk would let validation "see and approve a fifth option's battle command the compiler was always
going to drop, and read that agreement as proof of nothing").

The fix is one function, `shared/eventrules.js`'s `routeLegs`, alongside `ROUTE_LEG_OPS`:

```js
export const ROUTE_LEG_OPS = new Set(['move', 'turn', 'wait']);

export const routeLegs = (legs) =>
  (Array.isArray(legs) ? legs : []).filter((leg) => ROUTE_LEG_OPS.has(leg?.op));
```

**Every reader of a route's actual `.legs` array shares it — seven of them, named explicitly in §5,
not five (round 1 named five; round 2's finding 2 found only four of the then-six actually wired;
round 4's finding 2 corrects the count once more, to add the pure trace-model helper as a genuine
seventh — see below):** the normalizer (filters *before* normalizing each survivor, §5.1), `isLive`'s
route branch (§5.2), `liveCommands`' route recursion (§5.2), the compiler's route case (§5.3), the
editor's leg-row rendering (§9, canonicalizing the draft in place rather than reading a separate
filtered copy — round 3's fix), and the editor's summary line (§9's `describeEnabled`) are six. **The
pure trace-model helper (§10) is the seventh, and its own two call sites behave differently, both
worth stating rather than collapsing into one claim:** the modal's own call, against
`command.legs` after §9's canonicalization has already run, is genuinely redundant — the input is
already admitted-only by construction, so this particular call could never observe anything
`routeLegs` would remove. The helper filters anyway, as belt-and-suspenders matching
`describeEnabled`'s identical precedent, so it stays correct in isolation regardless of what a
future caller guarantees about its input — and that direct-call behavior (unfiltered input, no
canonicalization upstream of it) is exactly what §13 test 14's own unadmitted-leg case isolates and
exercises, load-bearing there even though it is provably inert on the modal's own call path.
`allCommands` deliberately does **not** filter through `routeLegs` — see §5.2 for why: it answers
"what is mentioned," the same reason it already walks a switched-off branch's contents unfiltered,
and an illegally-shaped leg about to be dropped at normalize time costs nothing to have briefly
visited by a renumbering walk that will find nothing on it relevant to renumber anyway (none of the
three renumberers read anything a leg could carry — see §5.5).

A **separate, smaller thing shares `ROUTE_LEG_OPS` (the `Set`) directly, not `routeLegs` (the
function that filters an actual `.legs` array)**: the editor's leg-*adding* dropdown, which filters
the static `EVENT_COMMANDS` catalog itself (`EVENT_COMMANDS.filter((entry) =>
ROUTE_LEG_OPS.has(entry.id))`, §9) to decide which three options to offer when *adding* a new leg —
a different question ("what may be added") from every reader above ("what is already there and
admitted"), answered with the same underlying vocabulary but not the same function, since there is
no `.legs` array to filter at that point.

**No leg-count limit is introduced**, unchanged from round 1 and not disputed by the review: the
emitted page/branch/choice one-byte length limits already impose the real ceiling (`MAX_BODY`,
255 bytes), the same ceiling a page hand-chaining sixty individual Move commands already runs into
today with no special per-feature cap. A dedicated `LIMITS.routeLegs` would have forced a second,
required limit parameter through every one of `liveCommands`' roughly 15 call sites across
`shared/project.js` — real, invasive churn bought for a bound `MAX_BODY` already provides for free.

**An empty route** (`legs: []`, or every leg switched `off`) is not a special case: `isLive`'s
route branch (§5.2) asks whether *any admitted* leg is live (`routeLegs(command.legs).some(isLive)`),
mirroring `branch`'s own "asked about its contents" treatment. A route with nothing live inside it
does not count as something the page did, precisely like a branch with nothing live inside it —
and this is now covered by a direct test (§13, finding 7), not only argued from the shared
`isLive` code path.

**A zero-distance Move leg or a zero-frame Wait leg is not special-cased or skipped.** A hand-
authored `Move ... 0px` already compiles to a real `OP_MOVE` with `dist = 0`, which
`script_op_move`/`move_tick` already treat as "does not suspend, continues immediately" — existing,
shipped, tested behavior (`move.test.js`). A route leg with the same zero value must compile to the
identical bytes for §1's invariant to hold, so the route compiler never filters or special-cases a
zero-value leg — it flows through `encodeCommand`'s existing `move`/`wait` cases completely
unchanged, the same way an `off` leg (not a zero-value one) is what gets filtered, by the ordinary
`enabledCommands` off-check every command list already applies.

### §3.4 — What emitting a route costs, in bytes, and where it lands

Unchanged from round 1's substance; the diagnostics wrapper mentioned below is corrected in §5.3.

**Zero framing bytes.** A route command itself never contributes an opcode, a length byte, or any
punctuation to the compiled output. The compiled bytes for a route are *exactly* the concatenation
of what each live, admitted leg would compile to standing alone: 4 bytes per live Move leg
(`opIndex('move')`, `who`, `dir`, `dist`), 3 per live Turn leg (`opIndex('turn')`, `who`, `dir`), 2
per live Wait leg (`opIndex('wait')`, `frames`) — the same figures a hand-chained sequence of the
same commands already costs today, because they are, byte for byte, the same commands.

**Where it lands: the kernel-hi event-data budget, already.** `generate.js`'s existing check —
`musicBytes + text.bytes > BANK_SIZE - 64` (line 1682) — reads `text.bytes` from
`compileText(project)`'s own `textSize(strings, events)`, which sizes the *actual emitted byte
arrays* `encodeEvent` produced, not a per-opcode model. Since a route's `encodeCommand` case emits
real bytes into that same array via `encodeBody`, this check already counts a route's compiled cost
correctly with no code change at all.

**Per-leg cost and where it lands is otherwise identical to the standalone command's own row** in
the CLAUDE.md costing table (`MOVE_KERNEL_ALLOWANCE`/`TURN_KERNEL_ALLOWANCE`/
`WAIT_KERNEL_ALLOWANCE`/`FACE_KERNEL_ALLOWANCE`) — all kernel-**lo** code allowances, not kernel-hi
data. A route changes nothing about that table; it only changes how many *instances* of those
opcodes' data bytes a project might emit.

## §4. Enable-predicate interaction

`projectUsesMove`/`projectUsesTurn`/`projectUsesWait` (`shared/project.js:2862-2916`) all walk
`liveCommands(page.commands, CHOICE_LIMITS.options)` and test `command.op`. Once `liveCommands`
gains its route-aware recursion (§5.2 — recurse into `routeLegs(command.legs)` *instead of*
yielding the route wrapper), these three predicates see route-nested legs automatically as
`command.op === 'move'`/`'turn'`/`'wait'` entries in the same yielded sequence a standalone command
would produce — **no change to any of the three predicates themselves**, and no change to this
argument from round 1: a route containing only Turn legs makes `projectUsesTurn` true and
`projectUsesMove` false, exactly matching a hand-authored, standalone Turn command.
`projectUsesFace` — **defined at `shared/project.js:3060-3070` as `projectUsesMove ||
projectUsesTurn`, and only *imported* by `generate.js`** (round 1 misattributed the definition
itself to `generate.js`; corrected here per finding 11) — is true either way, so
`FACE_KERNEL_ALLOWANCE` is charged whenever *either* a route or a bare command needs it — never
double-charged, never missed, by construction of the `||`.

`kernelShortfallAdvice`'s `active` list (`generate.js:976+`) is built from these same three
predicates plus `strip: (p) => projectWithoutCommands(p, ['move'])` etc. `projectWithoutCommands`
(`generate.js:768-778`, now **exported** rather than private — §5.5, finding 8) walks
`allCommands(page.commands)` and sets `command.off = true` on every command whose `op` is in the
given list. Once `allCommands` gains its own recursion into `command.legs` (§5.2 — unfiltered, for
the "what is mentioned" reason given there), `allCommands` yields **both** the route command itself
(`op: 'route'`) *and* each of its legs (`op: 'move'`/`'turn'`/`'wait'`) — mirroring exactly how it
already yields both a `branch` command and its `then`/`else` contents. `projectWithoutCommands(p,
['move'])` therefore switches off only the **Move-typed legs inside every route**, never the route
container itself (whose own `op` is `'route'`, never matched by `ops.includes('move')`) and never
the route's Turn or Wait legs. This directly answers the brief's original question — "does 'drop
every Move' mean remove Move legs from inside it, or remove the whole route" — **it removes just
the matching legs**, the same answer this mechanism already gives a Move command sitting inside a
branch. If that removal leaves a route with zero live legs, `isLive`'s route branch means the route
compiles to nothing, so `kernelCodeBytes`'s recomputed figure on the stripped clone correctly
reflects the full freed cost with no special-casing anywhere in `kernelShortfallAdvice` itself. This
is now directly testable, not only arguable, because `projectWithoutCommands` is exported (§13
finding 8).

**No code in `kernelShortfallAdvice`, `switchableMappers`, or `battleShortfallAdvice`
(`main/build/battletables.js`) needs to change.** All three ultimately call
`projectUsesMove`/`Turn`/`Wait`, `liveCommands`, `allCommands`, or `projectWithoutCommands` — every
one of which is corrected once, at the source, by §5.2's extension plus §5.5's export.

**There is no `projectUsesRoute` predicate, and none is needed** — unchanged from round 1: a route
carries no engine-code cost of its own; every kernel-lo byte it could possibly be responsible for
belongs to whichever leg types it contains, already answered by the route-aware
`projectUsesMove`/`Turn`/`Wait`.

## §5. Single-writer touchpoints — the exact diffs

### §5.1 — `shared/project.js`: `EVENT_COMMANDS`, `normalizeEventCommand`

`EVENT_COMMANDS`, appended immediately after `sting` (§3.0 — this position is load-bearing):

```js
// [who, {legs: [...]}]. An authoring convenience over Move/Turn/Wait: a route
// holds an ordered list of legs, each a real move/turn/wait record, and
// compiles to exactly what hand-chaining the same commands would -- no new
// opcode, no framing, see design-routes.md. `who` lives once, on the route,
// not per leg (design-routes.md §3.2); a leg's own `who` field, if
// normalizeEventCommand's reused move/turn handling stamped one, is deleted
// before storage, since nothing ever reads it there.
//
// `nests: true` -- a route holds real commands (its legs), and `nests`
// means exactly and only "the command holds a list of commands, whatever
// it calls them" (see this array's own comment on the flag, a few entries
// up). It therefore shares BRANCH_DEPTH_LIMIT/MAX_BRANCH_DEPTH with
// branch/choice -- a route 64 levels deep throws the identical error a
// branch that deep already does, and the editor stops offering it at
// MAX_BRANCH_DEPTH the same way. The leg vocabulary restriction (only
// move/turn/wait, never another route or a branch/choice) is a SEPARATE
// fact, enforced entirely by routeLegs/ROUTE_LEG_OPS (shared/eventrules.js)
// -- nests only gates depth, never vocabulary, for any container.
//
// virtual: true -- this entry carries no engine OP_* constant and no
// dispatch code; encodeCommand's 'route' case (main/build/textcompile.js)
// emits a route's legs directly, with no opcode byte of its own. See the
// EVENT_COMMANDS catalog invariant above OP_END/this array's own top
// comment: every real (OP_*-backed) entry stays contiguous from index 0,
// engine/constants.asm order; every virtual entry (currently only this
// one) forms one contiguous tail after them. A future engine-backed
// command is inserted immediately before this entry, never after; a future
// virtual command is appended after it. test/unit/project.test.js's own
// ordinal test enforces both halves of this directly.
{ id: 'route', label: 'Follow a route', args: ['route'], nests: true, virtual: true }
```

A short addition to the array's own top-of-file comment block (near the existing `nests`
explanation) states the real/virtual partition and the insertion policy as a standing rule, not
only as a comment on the one entry that currently needs it — so the *next* command added to this
array, real or virtual, finds the rule stated before it has to be rediscovered.

`normalizeEventCommand`, a new `arg === 'route'` branch alongside `branch`/`choice`:

```js
else if (arg === 'route') {
  out.who = MOVE_TARGETS.some((entry) => entry.id === raw?.who) ? raw.who : MOVE_TARGETS[0].id;
  // routeLegs (shared/eventrules.js) is the single admission filter every
  // consumer of .legs shares (design-routes.md §3.3) -- applied to the RAW
  // list before normalizing, not after: normalizing an illegally-nested
  // branch here first (via the generic `inner()` a container's contents
  // would otherwise go through) would do real recursive work, and possibly
  // trip BRANCH_DEPTH_LIMIT, for content about to be discarded anyway.
  out.legs = routeLegs(raw?.legs)
    .map((leg) => normalizeEventCommand(leg, depth + 1, itemCtx))
    .filter(Boolean)
    // who lives on the route, not the leg -- see the field comment above.
    .map((leg) => {
      if (leg.op === 'move' || leg.op === 'turn') delete leg.who;
      return leg;
    });
}
```

`depth + 1` is passed into the per-leg `normalizeEventCommand` call for symmetry with `inner()`,
but is inert for the legs themselves: `move`/`turn`/`wait` are not `nests: true`, so the
`command.nests && depth >= BRANCH_DEPTH_LIMIT` guard never fires for a leg regardless of how deep
the route itself is nested. The guard *does* fire for the route command itself, at whatever `depth`
it was reached at — this is the mechanism §3.1 relies on, requiring no code of its own beyond
`nests: true` on the entry.

`shared/project.js`'s existing internal import from `shared/eventrules.js` (line 10) gains
`routeLegs`:

```js
import { allCommands, choiceOptionsSlice, compiledPages, damageAmount, liveCommands, projectEvents, routeLegs } from './eventrules.js';
```

No change to `LIMITS` (§3.3 argues explicitly against adding `LIMITS.routeLegs`).

### §5.2 — `shared/eventrules.js`: `ROUTE_LEG_OPS`, `routeLegs`, `legWithWho`, and the corrected `isLive`/`allCommands`/`liveCommands`

**Single owner, resolved (finding 3 and finding 11's third item together).** Round 1 defined
`ROUTE_LEG_OPS` in `shared/project.js` while describing `legWithWho`/`ROUTE_LEG_OPS` as re-exported
from there in one section and imported from `shared/eventrules.js` in another — an internal
contradiction the review correctly flagged. **All three now live in `shared/eventrules.js`**,
placed near the top of the file, before `isLive` (which uses `routeLegs`) — the cycle-safe choice,
for the identical reason `choiceOptionsSlice` already lives there rather than in
`shared/project.js`: `eventrules.js` is imported *by* `project.js`, so anything `project.js`'s own
`normalizeEventCommand` needs (here, `routeLegs`) has to be defined upstream of it, not
downstream. `shared/project.js` re-exports all three, once, alongside its existing re-export block:

```js
export {
  enabledCommands,
  compiledPages,
  allCommands,
  choiceOptionsSlice,
  damageAmount,
  liveCommands,
  projectEvents,
  ROUTE_LEG_OPS,
  routeLegs,
  legWithWho
} from './eventrules.js';
```

`main/build/textcompile.js` and `renderer/forges/map/events.js` both import `routeLegs`/
`legWithWho` (and, for `events.js` only — see §9 — `ROUTE_LEG_OPS` directly, for its dropdown)
**from `shared/project.js`**, matching the majority pattern both files already follow for
everything else `eventrules.js` re-exports through it (`enabledCommands`, `compiledPages`,
`liveCommands`, `choiceOptionsSlice`, `damageAmount` in `events.js`'s case). `textcompile.js`
already has one pre-existing exception to this pattern — it imports `damageAmount` directly from
`shared/eventrules.js` rather than through `shared/project.js`'s re-export — which this design does
not touch, extend, or use as precedent; the new symbols follow the majority import path instead, so
this design introduces no *new* inconsistency even though one pre-existing one remains in the file.

```js
// Near the top of the file, before isLive.
export const ROUTE_LEG_OPS = new Set(['move', 'turn', 'wait']);

/**
 * The legs a route may actually hold, compile, or count -- the single
 * admission filter every consumer of a route's .legs shares (normalization,
 * isLive, liveCommands' recursion, the compiler, the editor's leg-adding
 * dropdown), so none of them can accept a different vocabulary than the
 * others compile or count. Defends a live, not-yet-normalized project the
 * same way choiceOptionsSlice already defends a live choice -- buildProject
 * compiles whatever the app is holding, not a freshly normalized copy.
 */
export const routeLegs = (legs) =>
  (Array.isArray(legs) ? legs : []).filter((leg) => ROUTE_LEG_OPS.has(leg?.op));

/**
 * A route leg as the move/turn/wait command it actually is, with the
 * route's own `who` injected -- legs never store their own `who`
 * (design-routes.md §3.2). Used identically by the compiler
 * (main/build/textcompile.js's 'route' case) and the Map Forge's own
 * describeCommand, so the ROM and the editor's summary line can never
 * disagree about which who a leg means.
 */
export const legWithWho = (leg, who) =>
  leg.op === 'move' || leg.op === 'turn' ? { ...leg, who } : leg;
```

`isLive`, one new branch, textually identical in shape to the existing `branch` case:

```js
const isLive = (command) => {
  if (!command || command.off === true) return false;
  if (command.op === 'branch') {
    return [...(command.then ?? []), ...(command.else ?? [])].some(isLive);
  }
  if (command.op === 'choice') return (command.options ?? []).length > 0;
  // A route is asked about its contents the same way a branch is: a route
  // with nothing live inside it (empty, every leg switched off, or every
  // leg an illegal op routeLegs already filters out) is not a thing that
  // happened on the page, and must not keep a page "alive" the way an
  // empty branch must not -- see design-routes.md §3.3. routeLegs, not a
  // raw command.legs.some(...), so a live-but-unadmitted leg (a hand-edited
  // 'say' sitting in .legs) is never read as making the route live -- it
  // would compile to nothing were the project built as-is.
  if (command.op === 'route') return routeLegs(command.legs).some(isLive);
  return true;
};
```

`allCommands` — **unfiltered** recursion into `command.legs`, deliberately, because this generator
answers a different question than `isLive`/`liveCommands` do (its own existing header comment:
"Anything asking 'does this event mention X' has to walk this... a switch set inside a branch was
invisible to the template allocator... an answer is a second place to hide, and there will be a
third"). It already walks a switched-off branch's `then`/`else` unfiltered and an unresolved
`call`'s target unresolved — "what is mentioned," not "what compiles" — so a route's raw legs,
admitted or not, are exactly the third shape this comment already predicts, walked the same
unconditional way:

```js
export function* allCommands(list) {
  for (const command of list ?? []) {
    yield command;
    yield* allCommands(command.then);
    yield* allCommands(command.else);
    for (const option of command.options ?? []) yield* allCommands(option.commands);
    // The third shape this walk has to know about. Deliberately NOT
    // filtered through routeLegs -- allCommands answers "what is
    // mentioned," not "what compiles" (see this function's own header
    // comment), and a leg about to be dropped at normalize time for
    // naming an illegal op costs nothing to have briefly been visited by
    // a renumbering walk that finds nothing on it relevant to renumber
    // (design-routes.md §5.5 -- none of the three renumberers read
    // anything a leg carries).
    yield* allCommands(command.legs);
  }
}
```

**A source touchpoint this same edit must also close, not merely note (finding 6).**
`liveCommands`' own doc comment (`shared/eventrules.js:105-122`) currently carries a paragraph that
is no longer true: *"A `call` naming a common event id nothing defines is structurally live (not
switched off, not past a limit) and is yielded here, even though `encodeCommand`'s own 'call' case
(main/build/textcompile.js) resolves the reference and compiles it away when it does not... A caller
comparing this against a real compile has to know that `call` in particular can lie in the
optimistic direction."* `encodeCommand`'s `'call'` case no longer "compiles it away" — it always
emits `[OP_CALL, NO_COMMON_EVENT_SLOT]` for a dangling reference, and
`test/unit/project.test.js:3022`'s own comment says so directly ("no filtering needed any more --
the two sequences agree on a dangling call directly"). This paragraph is deleted and replaced, in
the same edit that adds the route branch below, with text stating the current, accurate fact instead:
every structurally live command this generator yields — `call` included — now agrees with what
`encodeCommand` actually emits, with the single, *documented* departure being the route case itself
(below), which recurses rather than yields for the reason given inline. Leaving the stale paragraph
in place while adding a second, differently-shaped departure (route's) would read as two competing
explanations of when this generator's output may diverge from compiled reality — one true, one not
— which is worse than either alone.

`liveCommands` — **not** a fourth `yield*` line added alongside the existing three, but a
route-specific branch that recurses into `routeLegs(command.legs)` **instead of** yielding the
route command itself (finding 2, adopted as written, replacing round 1's design outright):

```js
export function* liveCommands(list, choiceOptionLimit) {
  if (!Number.isInteger(choiceOptionLimit) || choiceOptionLimit < 0) {
    throw new Error(/* unchanged */);
  }
  for (const command of enabledCommands({ commands: list })) {
    // A route contributes no opcode of its own -- encodeBody's route case
    // (main/build/textcompile.js) emits nothing but its own admitted legs'
    // bytes. This is not a new, silent exception to this generator's own
    // contract ("every command encodeBody actually emits" -- see this
    // file's header) the way the dangling-`call` case used to be before
    // encodeCommand's own 'call' case was fixed to always emit a slot byte
    // (test/unit/project.test.js's own comment on that fix: "no filtering
    // needed any more -- the two sequences agree on a dangling call
    // directly"). It is the SAME contract applied correctly: branch and
    // choice ARE yielded here because encodeBody genuinely writes an
    // OP_IF/OP_CHOICE byte for them; a route is NOT yielded because
    // encodeBody writes nothing for it. Whether a container appears in this
    // sequence is dictated by whether it costs a byte, uniformly -- not a
    // route-specific carve-out.
    //
    // routeLegs, not raw command.legs: the same admission filter isLive's
    // route branch and the compiler's route case already apply, so a live,
    // not-yet-normalized route holding a disallowed leg op is never counted
    // as though it compiled to something it will not.
    if (command.op === 'route') {
      yield* liveCommands(routeLegs(command.legs), choiceOptionLimit);
      continue;
    }
    yield command;
    yield* liveCommands(command.then, choiceOptionLimit);
    yield* liveCommands(command.else, choiceOptionLimit);
    for (const option of choiceOptionsSlice(command.options, choiceOptionLimit)) {
      yield* liveCommands(option.commands, choiceOptionLimit);
    }
  }
}
```

Note the loop's own top-level `enabledCommands({ commands: list })` call already applies `isLive`
(hence `isLive`'s own route branch, above) to `command` before the loop body ever runs — so a
switched-off route never reaches the `command.op === 'route'` check at all, the identical gate
`branch`/`choice` already pass through before their own recursion lines run. `command.legs` is
`undefined` for anything that is not a route, so `routeLegs(undefined)` degrades to `[]` via its
own `Array.isArray` guard — no crash, no special-casing needed for the non-route path.

This directly resolves finding 2's own cited test
(`test/unit/project.test.js:'liveCommands and encodeBody agree...'`), made executable as a concrete
§13 test item (below, "the equivalence test made executable"): a route scenario added to that
test's own scenario table now produces a `liveSequence` that omits `route` and lists only its
admitted legs' ops, matching `decodeOpSequence`'s real output exactly — because both now agree a
route costs zero bytes of its own.

**`routeLegs(command.legs)` is not only a compiler/predicate concern — round 2's own finding 2 is
that round 1 stopped applying it one file too early.** Round 1 correctly threaded `routeLegs`
through the normalizer, `isLive`, `liveCommands`, and the compiler — four of the six places that
ever read a route's `.legs` — but left the remaining two, both in the *editor* (§9's leg-row
rendering and §10's preview trace walker), reading `command.legs` raw. That is precisely the
silently-wrong UI state this helper exists to prevent: a live, not-yet-normalized route holding an
illegal leg would already compile and count correctly (predicates agree with the ROM), while the
editor simultaneously rendered an extra row for it and the preview traced a path through it — an
author staring at exactly the kind of "the editor shows one thing, the ROM does another" split
CLAUDE.md's own `effectiveTrigger` precedent names as the failure this whole class of helper exists
to close. The fix, applied in §9 and §10 below: **one call to `routeLegs(command.legs)` per route
row**, computed once at the top of that row's own render function and reused for the leg-list
itself, the summary line, and the preview trace — not three separately-filtered copies of the same
list that could drift from each other the way the six original readers already had.

**Every current `liveCommands` consumer, checked against the wrapper no longer appearing (finding
2's own explicit ask):**

- `projectUsesMove`/`Turn`/`Wait` (`shared/project.js`) — test `command.op === 'move'`/`'turn'`/
  `'wait'` directly; never tested `'route'` under round 1's design either, so unaffected either way.
- `projectUsesSave`/`projectUsesSting` and the battle/give/take `validateProject` checks
  (`shared/project.js`, all via `liveCommands(page.commands, CHOICE_LIMITS.options)` +
  `compiledPages`) — none test for `command.op === 'route'`; all only ever cared about the leg
  types a route can hold, which still arrive in the sequence, now at the position their own
  `op` implies rather than nested one level under a wrapper entry that would have needed its own
  `if (command.op === 'route') continue` to skip past in every one of these call sites had round
  1's design shipped. The fix in `liveCommands` itself is what keeps every one of these consumers
  simple — none of them has to know a route exists.
- `renumberSongDeletion`/`renumberActorDeletion`/`renumberItemDeletion` walk `allCommands`, not
  `liveCommands` — unaffected by this change; see §5.5 for their own (unaffected) route
  interaction.

### §5.3 — `main/build/textcompile.js`: `encodeCommand`'s `route` case

```js
case 'route': {
  // Zero framing: no opcode, no length byte, nothing route-specific at
  // all. The compiled bytes ARE the legs' own bytes, in order -- what
  // makes the byte-identity proof (design-routes.md §1, §6) hold by
  // construction. routeLegs (shared/eventrules.js, via shared/project.js's
  // re-export) is the same admission filter isLive/liveCommands already
  // apply, so an illegally-shaped leg in a live, not-yet-normalized
  // project is never compiled here either -- normalization and compilation
  // agree about what a route holds without a separate check in each.
  // legWithWho injects the route's own `who`, the same helper the editor's
  // describeCommand uses, so the two can never disagree about it.
  //
  // No measured() wrapper here (round 1 had one; dropped per review
  // finding 10 -- see design-routes.md §6 for the reasoning). A route has
  // no length byte of its own for an overflow to corrupt; the enclosing
  // page/branch/choice body -- which DOES have a real length byte -- is
  // already measured wherever this route sits, by that body's own caller,
  // and would report the real overflow. A second measured() call here
  // produced no wrong bytes, but did produce a second, redundant "too
  // long" diagnostic for one authored mistake -- purely a diagnostics
  // change, never a data change either way.
  const legs = routeLegs(command.legs).map((leg) => legWithWho(leg, command.who));
  return encodeBody(legs, `${where} → Route`);
}
```

`routeLegs`/`legWithWho` import from `shared/project.js` alongside the file's existing majority
import block (§5.2's ownership note); `ROUTE_LEG_OPS` itself is not imported here — nothing in
this file reads the raw set directly, only through `routeLegs`.

**This is the entire compiler change.** No new constant, no new byte, no touch to `encodeEvent`,
`compileText`, or anything in `main/build/generate.js` beyond the one export in §5.5.

### §5.4 — `renderer/forges/map/events.js`: the editor and the preview context (full detail in §9/§10)

`offeredCommands`/`addCommand`/`defaultCommand`/`describeCommand` all gain a `route` case; a new
leg-list block is added to `commandRow` alongside the existing `branch`/`choice` blocks;
`eventContext()` (`renderer/forges/map/map.js:622`) gains a parameter carrying placement/preview
context, threaded only from the two placement-owned `editEvent` call sites. **`eventContext()` takes
zero parameters today** (round 1's "gains an optional second parameter" was wrong on its face —
confirmed by re-reading the definition, finding 3 — there is no first parameter for this to be
second to; it is `function eventContext(placement)`, its first and only parameter, optional in the
sense that callers may omit it, not in the sense of being the second of two).

**The concrete data path (finding 3), one complete option, specified rather than merely gestured
at:** `placement` carries `{ project, tilesetId, screen, x, y }` — a *project reference* (not a
clone; the modal is read-only with respect to the rest of the project, and `showModal` already
blocks all other interaction while it is open, so nothing else can mutate `project` out from under
the preview during the same edit), the current map's own `tilesetId` (`currentMap().tilesetId`, the
exact expression `map.js`'s own live renderer already uses at its two `rebuild()` call sites,
`map.js:1602`/`1608`), the `screen` object itself, and the placement's own `x`/`y`. This is enough,
and only this much, because `MetatileRenderer.rebuild(project, tilesetId)` (`render.js:24`) needs
precisely a project (for `project.metatiles`, `project.palettes.bg`) and a tileset id — never a
screen alone, which is what round 1's `{ screen, x, y }` shape could not actually have rendered
anything from.

**The event editor constructs its own, fresh `MetatileRenderer` from this data — it does not reach
into `map.js`'s live instance.** `new MetatileRenderer().rebuild(placement.project,
placement.tilesetId)` runs once, when the modal opens (not on every `rerender()` — the background
art does not change while legs are being edited, only the trace overlay does), and the resulting
renderer is held in a modal-local variable reused across `rerender()` calls for `drawScreen`. The
cost is one rebuild of `project.metatiles.length` (≤ `LIMITS.metatiles`, 64) 16×16 per-metatile
canvases — `render.js`'s own comment on `rebuild()` already calls this "cheap enough to call on any
project change," and `map.js`'s live renderer already pays this identical cost on every tileset
switch and on mount; paying it once per modal open is strictly less frequent than that. The
alternative — passing `map.js`'s own live renderer instance through `eventContext()` instead of
rebuilding — was considered and rejected: it would couple `events.js` to `map.js`'s internal
renderer object (an implementation detail of a different module) and would need its own staleness
argument (what if the live renderer rebuilds, or the map/tileset selection changes, while the modal
is open — it structurally cannot, since the modal blocks the rest of the UI, but the coupling would
then exist for no benefit over the self-contained option, only a dependency this module does not
otherwise have). Self-contained and slightly wasteful beats coupled and only theoretically cheaper.

The common-event call site passes no `placement` at all — `eventContext()` with zero arguments,
exactly as it is called today — so `context.place` is `undefined` there by construction, not by a
special case the common-event path has to opt into. Full mechanics, including the two
placement-owned call sites' own exact `eventContext(...)` calls, are in §9/§10; listed here only to
complete the single-writer inventory.

### §5.5 — What does *not* change, and the one export that does (finding 8)

`main/build/generate.js`: **`projectWithoutCommands` is exported** (`export function
projectWithoutCommands(project, ops) { ... }`, body unchanged) so `test/unit/kernelbytes.test.js`
(or a new dedicated test — §13) can call the exact production function and assert on its output
structurally, rather than re-implementing the strip in a test, which would test the
reimplementation rather than the design (finding 8, "prefer the export," adopted). This is the one
change to `generate.js` this design makes; everything else there (`kernelShortfallAdvice`,
`switchableMappers`, `battleShortfallAdvice`) needs no change — see §4.

`renderer/forges/map/templates.js`'s `usedSwitches`: no change needed, confirmed by reading it — it
walks `allCommands` and only reads `.switch`/`.cond`, neither of which a leg ever carries, so the
(unfiltered) new recursion is a correct, harmless no-op pass-through for it.

`renumberSongDeletion`/`renumberActorDeletion`/`renumberItemDeletion`
(`shared/project.js`): no change needed, confirmed by reading all three — a leg's `who` names
`'self'`/`'player'` (fixed `MOVE_TARGETS` ids, and is deleted from a normalized leg entirely per
§3.2), never an actor index, item id, or song id, so none of the three finds anything new to
renumber inside a route; they simply visit route legs (via `allCommands`'s unfiltered recursion)
and correctly find nothing to do — true whether or not a given leg happens to be one `routeLegs`
would admit, since none of the three renumberers branch on `command.op` in a way a leg's op could
ever match (`'music'`, `'battle'`, `'give'`/`'take'` respectively — none of which `ROUTE_LEG_OPS`
contains).

`validateProject`: no new rule (§11, unchanged).
`SAVE_LAYOUT_VERSION`: unchanged (§8, unchanged).

## §6. The byte-identity proof

Claim: for any project, replacing every route with the hand-chained sequence of its own live,
admitted legs (in order, each carrying the route's own `who`) produces a project that compiles to
the byte-identical ROM.

**Proof sketch, from the actual code path, not asserted:**

1. `encodeBody(commands, where)` (`textcompile.js:454`) is `enabledCommands({commands}).map(encodeCommand).filter(Boolean).flat()` — a pure, order-preserving map-then-concatenate over whichever commands survive the `off` filter.
2. A route's own `encodeCommand` case (§5.3) is `encodeBody(legs, ...)` where `legs` is `routeLegs(command.legs)` with `who` injected. Its *return value* is therefore exactly what `encodeBody` would produce from that same ordered, admitted list of move/turn/wait commands standing alone at the top level of some other list.
3. Wherever a route sits — a page's own `commands`, a branch's `then`/`else`, a choice option's `commands` — that enclosing list is itself processed by the identical `encodeBody`. Because `encodeBody` treats every element uniformly (map over `enabledCommands`, `.flat()` the results), the route's returned byte array is spliced into the enclosing output at exactly the position the route command occupied — indistinguishable, downstream, from the same bytes having been produced by literally writing the hand-chained commands there instead.
4. **The branch/choice length-bookkeeping case round 1 already worked through, unaffected by dropping `measured()`** (finding 10 — the byte-identity argument only ever depended on `encodeBody`'s return *value*, never on whether `measured()` was additionally called around it; `measured()` mutates only the closure-local `tooLong` diagnostics array and returns its input completely unchanged, so removing the wrapper changes zero emitted bytes anywhere): `branch`'s own case computes `then.length`/`otherwise.length` as `encodeBody(command.then, ...).length` / `encodeBody(command.else, ...).length` — i.e. it measures the *already-flattened* output of everything in `then`/`else`, route-nested legs included, via the exact same recursive call this proof already covers in step 3. There is no separate length arithmetic for "how many bytes does a route contribute" anywhere — the branch's length byte is correct for the identical reason the top-level page body's own `body.length` (`encodeEvent`, line 464-466) is correct: both simply measure `encodeBody`'s real output, after the fact, never by summing a model of it. The same argument covers `choice`'s per-option `lengths`/`past` arithmetic, computed from `encodeBody(option.commands, ...).length` for whichever `option.commands` a route happens to be sitting in.
5. Steps 1-4 hold regardless of how many legs a route has, what they are, or whether some are `off` — `enabledCommands`'s filter runs identically whether the `off` command is a bare Move or a route leg, because a leg *is* an ordinary command object with an optional `.off`, not a distinguished second shape `enabledCommands` has to be taught about. `routeLegs`'s own filtering (step 2) runs *before* any of steps 1-4, so an illegally-shaped leg is simply never part of the `legs` array `encodeBody` sees — it is as though it were never authored, on both sides of the identity comparison, since the hand-chained control fixture never authors an illegal command inside a route to begin with (there is no equivalent "hand-chained illegal command" to compare against — this is a defensive property of the compiler alone, not a second thing the byte-identity proof has to establish).

**Why dropping the route-local `measured()` call is the right choice, not merely a permitted one
(finding 10):** a route has no engine-read length field of its own for a stale value to corrupt —
unlike a branch's `then.length`/`otherwise.length` byte or a choice option's own length byte, both
of which the *engine* reads at runtime to know where to skip to (`script_skip`,
`engine/script.asm`), and both of which therefore need their own overflow check so a silently wrong
length byte is caught before it reaches the ROM. A route's legs are simply spliced into whichever
enclosing body already has such a length byte, and that enclosing body is *always* measured by its
own owner (the page's `encodeEvent`, the branch's own `then`/`else` measurement, the choice option's
own body measurement) regardless of whether a route sits inside it. An author who writes a route
long enough to overflow a page still gets a "too long" error — from the page, correctly — without a
second, redundant one from the route itself. Retaining the round-1 `measured()` call would not have
changed any emitted byte (§ this proof, step 4), only produced a second diagnostic for the same
single authored mistake; dropping it is simpler and loses nothing an author needs to hear.

**The acceptance tests this proof licenses (see §13 for the full plan with sabotages) — corrected
per round 2's finding 1, which caught that the second bullet below had drifted into proposing a
mechanism (a checked-in reference ROM) this repository does not use anywhere and that would go
stale the moment an unrelated engine change landed:**

- A project with one route (say, three legs: Move, Turn, Wait) must produce a ROM byte-identical
  to the same project with those same three commands hand-chained, in order, at the same page
  position, each carrying the route's own `who`.
- **The permanent zero-conditional-residue test is the real `move.test.js` shape, not a reference
  ROM.** `move.test.js`'s own `'a switched-off Move costs a project nothing'` test
  (`test/unit/move.test.js:285-305`, read in full for this revision) builds **two ROMs in the same
  test run** — one project with an `off: true` Move plus a real command, one with just the real
  command — and asserts them byte-identical, proving a disabled command leaves no conditional
  residue (no `MOVE_ENABLED`, no kernel-lo allowance, nothing). A route's own permanent test is the
  identical shape: an `off: true` route and a project with no route at all, built in the same run,
  byte-identical. This needs no checked-in binary of any kind and cannot go stale, because it never
  compares against anything but itself.
- **A *different*, one-time claim — "a route-free project compiles exactly as it did before this
  slice existed" — is established once, at implementation time, not carried forward as a permanent
  test.** Build the same route-free project from the pre-slice tree and the post-slice tree, compare
  the two ROMs, and record the hashes and the result directly in the implementation report (§13
  marks this as an implementation-gate step). This is the stronger, cross-version claim round 1
  conflated with the permanent test above; it is real and worth establishing, but only ever needs to
  be true once, at the moment this slice lands — after that, ordinary regression coverage (this
  slice's own tests, plus everything that already existed) is what keeps route-free output correct,
  the same as it is for every other feature in this codebase's history. No reference ROM is checked
  in for it either; it is a one-time build-and-compare, not infrastructure.
- The ordinal test (§3.0/§13) remains the permanent guard against `EVENT_COMMANDS` catalog movement
  — unrelated to either bullet above, and not a ROM comparison at all.

## §7. Enable-predicate interaction — see §4 for the full argument

Unchanged pointer from round 1; §4 above (revised for findings 2/8/11) is the complete argument.

## §8. Forward/backward compatibility

Unchanged from round 1; not disputed by the review.

**`IMPLEMENTED_COMMANDS` gains `'route'`.** The set's own doc comment frames it as "the subset
`engine/script.asm` can actually run" — literally false for `route` (the engine never sees an
`OP_ROUTE` byte; there is no such opcode, `virtual: true` per §3.0), but the set's *actual job*, per
the same comment, is "the Map Forge only offers these, because a command that silently does nothing
is exactly what this codebase refuses to ship." A route is offered, builds, and does something real
— it just does it by compiling away into opcodes the engine already runs, the identical
relationship `branch`/`choice` already have. `route` belongs in `IMPLEMENTED_COMMANDS` by the set's
working definition, and its doc comment is worth a one-line addition noting this is the first entry
with no `OP_*` of its own.

**What a project written by *this* version does when opened by a version that predates `route`:**
that older version's own `EVENT_COMMANDS` array has no `route` entry. Its `normalizeEventCommand`'s
lookup fails for `raw.op === 'route'`, and the existing fallback — `if (!command || command.id ===
'end') return null;` — silently drops the whole route (legs included) the next time that older
version saves the project. **This is not new machinery `route` needs, and not a regression to fix**:
it is the exact behavior any hypothetical future command has always had against any version that
predates it. The forward direction — a project written *before* `route` existed, opened by a version
that has it — is the ordinary, already-guaranteed case: nothing about that project names `route` at
all, so nothing changes for it.

**`SAVE_LAYOUT_VERSION` does not move.** A route touches none of the battery-save record's own
bytes — it is purely an authoring/compile-time convenience over event script data, which is never
serialized into a save slot at all.

## §9. The Map Forge editor

**Offering.** `offeredCommands` (`events.js:48`) already filters `EVENT_COMMANDS` by
`IMPLEMENTED_COMMANDS` membership plus a few structural conditions. `route` needs none of those —
it is offered the same as `move`/`turn`/`wait` on that front. **What is different from round 1:**
because `route` is now `nests: true` (§3.1), `addCommand`'s own existing depth filter
(`.filter((entry) => !entry.nests || depth < MAX_BRANCH_DEPTH)`) now governs whether `route` appears
at all, identically to `branch`/`choice` — offered at any depth below `MAX_BRANCH_DEPTH`, hidden at
or past it. No code change to `addCommand` itself is needed for this; it is a direct, free
consequence of `route`'s own `nests: true` flag, exactly the "not a third place to edit" property
`nests` exists to provide.

**`defaultCommand('route', context)`** mirrors `branch`'s/`choice`'s own default-shape construction:
`{ op: 'route', who: MOVE_TARGETS[0].id, legs: [] }` — starts empty, exactly like a fresh branch
starts with empty `then`/`else`.

**The command row.** A new `command.op === 'route'` branch in `commandRow`, styled identically to
the existing `branch`/`choice` blocks (bordered box, `dim` when `off`, `tools` from `listTools`):

- **`commandRow`'s route branch canonicalizes the draft before rendering anything — round 3's own
  fix, replacing round 2's filtered-view approach, which the review demonstrated lets the row tools
  edit the wrong element (finding 1):**

  ```js
  if (command.op === 'route') {
    // Canonicalize the DRAFT to its admitted legs, at the moment this row
    // renders -- a real removal, not a filtered view of data that is still
    // there. store.commit() never runs normalizeProject (CLAUDE.md's own
    // reconcileCartridge passage), so an unadmitted leg reaching this draft
    // from a hand-edited or bypassed-normalization file would otherwise
    // survive in memory indefinitely; this is the one moment the editor can
    // honestly reconcile what it renders with what would actually compile.
    // Cancel discards the whole draft regardless, so this can never reach
    // store.project without the author choosing Save -- and Save writing
    // exactly the admitted list is no loss, because that is what a
    // save/load round-trip through normalizeProject (§5.1) would already
    // have produced on its own.
    command.legs = routeLegs(command.legs);
    // ...render the header, the leg rows, and the leg-adding control below,
    // all directly against command.legs -- which is now, by construction,
    // exactly the list that will compile. There is no second, filtered
    // view to keep in sync with it.
  }
  ```

  **Why canonicalize rather than keep a raw/filtered index mapping (the review's own second
  option):** round 2's design rendered rows from `routeLegs(command.legs)` (a filtered *copy*) but
  wired `listTools(command.legs, position, ...)` against the *raw* array by that filtered position —
  correct only when nothing was ever filtered out. With `[say, move]` (an unadmitted leg before an
  admitted one), the visible Move row has filtered position 0, so Remove would delete the hidden
  `say` and leave Move visible, and Duplicate would duplicate the hidden `say` — Remove/Duplicate/
  reorder all silently act on the wrong element, and no test caught it because none exercised the
  row tools against this exact shape. Retaining each admitted leg's own raw index and giving route
  rows dedicated remove/duplicate/reorder logic that operates at that raw index (against the
  previous/next *admitted* raw index for reordering) would also fix it, but it means every one of
  `listTools`' four operations needs a route-specific reimplementation carrying its own index
  translation — a second, parallel bookkeeping scheme this editor has nowhere else, for a case
  (an unadmitted leg) that can only ever exist for one render before canonicalization removes it
  anyway. Canonicalizing once, up front, means the ordinary `listTools(command.legs, position, ...)`
  call already used everywhere else in this editor is correct here too, with no route-specific index
  arithmetic anywhere — the simpler fix, and the one this design adopts.
- A header row: "Route" label, a `who` select (reusing the exact `MOVE_TARGETS`-mapped `<select>`
  markup the standalone `move`/`turn` rows already build), `tools`, and — for a placement-owned
  edit only (§10) — the preview canvas/caption.
- One row per entry in `command.legs` — now the canonical, already-admitted list, so `position` is
  simply that array's own index, the same index `listTools(command.legs, position, { what: 'leg',
  ... })` splices against — each rendered by a small dedicated function per leg op
  (`moveLegRow`/`turnLegRow`/`waitLegRow`) that is the existing `move`/`turn`/`wait` row markup
  **minus the `who` select** (stated once, at the route header).
  **What this means for a hand-edited project holding an unadmitted leg, precisely (finding 1,
  round 3 — corrected from round 2's "the row list simply does not render a row for it" to what
  actually happens now):** such a leg is possible only through a file that bypasses
  `normalizeProject` on load (the normal load path already strips it, §5.1) or a raw hand-edited
  file opened without going through it — there is no UI path to introduce one mid-session, since the
  leg-adding control below offers only the three admitted ops. **The first time this route's row
  renders, the unadmitted leg is not merely hidden from view — it is removed from the draft
  outright**, by the canonicalization above. An author who opens such a route's row and changes
  nothing else, then saves, has already lost the illegal entry — the same "opening and re-saving a
  project already drops content this version does not recognize" consequence §8 already documents
  for a whole unrecognized command, applied here to one leg inside a route instead. Cancel discards
  the draft (illegal leg gone from it in memory, never written anywhere); Save writes exactly the
  admitted list, identical to what a save/load round-trip through `normalizeProject` would already
  have produced.
  **`routeLegs` is not made redundant elsewhere by this canonicalization — it stays applied,
  unconditionally, everywhere it already was, because none of those other readers ever see the
  modal's draft:** the normalizer (§5.1) and the compiler (§5.3) run against whatever
  `normalizeProject`/`buildProject` are handed directly from `store.project`, never the modal's
  working copy; `describeEnabled`'s own summary line (below) is called from *outside* the modal
  entirely — `map.js:753`'s own placement property-panel one-line preview, and `eventlist.js`'s
  event-list overview, both reading `store.project` live — for a route whose editor row may never
  have been opened in this session at all. Canonicalization only ever touches a route the author has
  actually opened; every project that is never opened in the editor, or opened and then Cancelled,
  still depends entirely on `routeLegs` being applied at those other three sites, exactly as before
  this fix.
- A leg-adding control, styled like `addCommand` but its options are derived from
  `EVENT_COMMANDS.filter((entry) => ROUTE_LEG_OPS.has(entry.id))` — reusing `EVENT_COMMANDS`' own
  `id`/`label` pairs for Move/Turn/Wait rather than a second, hand-written three-item list that
  could drift from those labels (§3.3's own "editor's leg-adding dropdown" note — this reads
  `ROUTE_LEG_OPS`, the Set, directly, since it filters the static command catalog rather than an
  actual `.legs` array; see §3.3 for why that is a different consumer from `routeLegs` itself).
  Pushes `{ op, ...defaults }` onto `command.legs` (dir defaulting to `MOVE_DIRECTIONS[0]`,
  dist/frames defaulting to 0) — always admitted by construction, since the control only ever offers
  the three admitted ops, so this never needs to run through `routeLegs` itself.
- No leg-count ceiling (§3.3), so there is no `full`-disabled state to render.

**The summary line.** `describeEnabled`'s new `route` case:

```js
case 'route': {
  const who = MOVE_TARGETS.find((entry) => entry.id === command.who)?.label ?? MOVE_TARGETS[0].label;
  const legs = routeLegs(command.legs).filter((leg) => leg.off !== true);
  if (!legs.length) return `Route (${who}): nothing — every leg is off`;
  return `Route (${who}): ${legs
    .map((leg) => describeEnabled(legWithWho(leg, command.who), context))
    .join('; ')}`;
}
```

Filtering through `routeLegs` here too (not just `.filter(leg => leg.off !== true)`) keeps the
editor's own summary line honest about a live, not-yet-normalized project holding an illegal leg —
it describes exactly what would compile, not what is merely present in memory. Reusing
`describeEnabled` itself for each leg (via `legWithWho`) means a leg's own summary text is *exactly*
what the same command would say standing alone — the identical single-writer argument §5.3's
compiler case makes, applied to prose instead of bytes.

**Nesting.** Per §3.1: `route` is offered inside a branch/choice's own `addCommand` calls subject to
the same depth filter every `nests: true` entry already gets — it is not a special case there, just
an ordinary `nests: true` container being nested inside another one, exactly as `branch` can already
nest inside `choice` and vice versa. A branch or choice can never appear inside a route's own
leg-adding dropdown, because that dropdown is hardcoded to `ROUTE_LEG_OPS`, not `offeredCommands()`
— there is no UI path to construct the illegal nesting, matching what §5.1's normalizer also
refuses to accept from a hand-edited file.

**The "dead page" warning copy.** `pageCard`'s existing hint text ("the only thing left is a branch
with nothing live inside it") is widened by one clause to name routes too, since an empty/all-off
route now produces the identical `dead` condition (`enabledCommands(page).length === 0`, correct via
§5.2's `isLive` extension).

## §10. The preview

**Where it lives, and why not an in-place canvas overlay.** Unchanged from round 1: the event
editor is a real blocking modal (`showModal`, `renderer/ui.js`) — the map canvas is not visible
while it is open, so the preview is a small, self-contained static canvas rendered *inside* the
event editor modal, next to the route block, redrawn on the same `rerender()` calls every other
edit in that modal already triggers.

**What it draws.** `fill()`, not `clear().append()`, on every `rerender()`. The background art comes
from the modal-local `MetatileRenderer` built once at open time from `context.place.project`/
`context.place.tilesetId` (§5.4 — this is the concrete data path round 1 never specified and round 2
correctly refused to accept as implementable); the trace overlay is repainted on top of it each
redraw, from `context.place.screen`/`x`/`y` and the route's own legs.

**What round 1 got wrong, twice over: it assumed every `editEvent` call has a placement to start
from, and it never said what the background art was actually made of.** `editEvent(event, context)`
is reached from **three** call sites, only two of which are placement-owned (finding 5):

1. `renderer/forges/map/map.js:786` — the "Edit event…" button, inside a placement's own property
   panel. `entity`/`index`/`currentScreen()` are all in scope.
2. `renderer/forges/map/map.js:931` — inside `applyTemplate(entity, index)`, the "Start from a
   template" flow. Also a placement's own property panel; `entity`/`index`/`currentScreen()` are
   equally in scope, confirmed by reading the function in full — round 1 read this call site's
   arguments but did not check whether it, too, had placement data available, and it does.
3. `renderer/forges/map/events.js:1372`, inside `editCommonEvents`, reached from
   `renderer/forges/map/map.js:646-661`'s `openCommonEventsEditor()`. **Not placement-owned**: a
   common event is not attached to any one placement — it is called by whichever placement's script
   happens to `Run` it (`OP_CALL`), so there is no single screen or start position to draw from,
   confirmed by reading `editCommonEvents` and its own call site in full — its `context` carries
   only `{ ...eventContext(), commonEvents: draft }`, never an entity or a screen.

**The fix: `eventContext()` gains its first parameter — not, as round 1 wrongly said, "an optional
second" one, since it currently takes none at all (`map.js:622`, confirmed by re-reading it, finding
3) — and only the two placement-owned call sites pass it.**

```js
function eventContext(placement) {
  return {
    /* ...unchanged existing fields... */
    // Only present when editEvent was reached from a specific placement's
    // own property panel -- see design-routes.md §5.4/§10. undefined at the
    // common-event editor's own call site, which passes none.
    place: placement
  };
}
```

Call sites 1 and 2 call `eventContext({ project: store.project, tilesetId: currentMap().tilesetId,
screen: currentScreen(), x: entity.x, y: entity.y })` — the complete shape §5.4 specifies, enough to
both start the trace and actually paint the background it is traced over. Call site 3's own path
(`openCommonEventsEditor` → `editCommonEvents` → `editEvent`) is untouched and continues to call
`eventContext()` with no argument, so `context.place` is `undefined` there by construction, not by a
special case the common-event path has to opt into.

**What the preview draws, keyed on `context.place` and the route's own `who` — three honest states,
not two (round 1 only had the last two):**

- **No `context.place` at all (a common event).** No trace is drawn, regardless of `who`. Caption:
  *"This is a common event — it can be called from anywhere, so there's no single screen or
  starting position to preview from."* This is not the same message as the `who: 'player'` case
  below (a common event's route could still name `self`, and still cannot be drawn — the reason is
  "no caller," not "unknown player position") and the two are worth keeping textually distinct so an
  author isn't left guessing which limitation applies.
- **`context.place` present, `who: 'player'`.** No trace is drawn. Caption: *"This route moves the
  player, not this actor — the Map Forge doesn't know where the player will be standing, so there's
  nothing accurate to draw."*
- **`context.place` present, `who: 'self'`.** The trace is drawn from `(context.place.x,
  context.place.y)` on `context.place.screen`, walking `command.legs`. By the time this row (and
  therefore this preview) can render at all, `command.legs` has already been canonicalized to its
  admitted list by `commandRow`'s own route branch (§9, round 3's fix), so it cannot disagree with
  the leg-row list about which leg is at which position — both read the identical, already-admitted
  array rather than two independent filterings of it (finding 2, round 2; closed more strongly by
  round 3's canonicalization). **The pure trace-model function itself still runs its input through
  `routeLegs` before walking it, though** — cheap, redundant defense in depth, not load-bearing given
  the canonicalization guarantee above, but matching the identical belt-and-suspenders precedent
  `describeEnabled`'s own summary line already sets (it too re-filters through `routeLegs` even
  though, inside the modal, its input is already canonical by the same argument). This keeps the
  trace-model function correct in isolation regardless of what a future caller guarantees about its
  input, and is what §13 test 14's own unadmitted-leg case exercises directly, independent of the
  editor's own canonicalization.

  **The trace walker emits one instruction per admitted, live leg, from a small fixed vocabulary
  (finding 7 — specified here rather than left to "a line segment" alone, which the review correctly
  noted cannot represent every case):**

  - A live Move leg with `dist > 0`: `{ kind: 'segment', from: {x, y}, to: {x, y} }` — a line from
    the walker's position before the leg to its position after, and the walker's position advances
    to `to`.
  - **A live Move leg with `dist === 0`: `{ kind: 'point', at: {x, y} }`, not a zero-length segment.**
    A zero-length `lineTo` paints no visible pixel on a canvas, which would make a real, live,
    authored "stand here for a beat" leg (`Move ... 0px`, §3.3 — a legitimate, non-suspending no-op
    at compile time, but a real authored leg for preview purposes) visually indistinguishable from
    that leg not existing at all — the opposite of the "labelled, not silently wrong" convention
    this whole preview follows. The marker is a small filled dot, the same kind of small filled-arc
    marker `map.js`'s own entity-position drawing already uses on the main canvas, sized visibly
    smaller than the Turn arrowhead and the Wait glyph below so the three leg kinds stay
    distinguishable from each other, not merely from "nothing." The walker's position does not
    change (there is nothing to advance by).
  - A live Turn leg: `{ kind: 'facing', at: {x, y}, dir }` — a small arrowhead at the walker's
    current (unmoved) position, no displacement.
  - A live Wait leg: `{ kind: 'pause', at: {x, y}, frames }` — a small numbered pause glyph at the
    walker's current position, no displacement.
  - An `off` leg contributes no instruction at all (it is already excluded by `routeLegs`/
    `enabledCommands`-style filtering before the walker ever sees it — see above) and the walker's
    position is computed as though it were absent.

  This instruction list is what the pure trace-model function returns (§13 test 14 asserts against
  it directly, by `kind`, not merely by counting array length); the drawing step that turns each
  instruction into canvas calls is a thin, separately-testable-by-inspection layer on top, matching
  the same "pure model, then a dumb draw step" shape `render.js`'s own `drawBoundTileOverlay` already
  has (compute *what* to mark, then draw it).

**What the preview honestly still cannot know, unchanged from round 1:** runtime blocking (a wall,
the screen edge, or another actor can cut a Move short — the preview always draws the full authored
distance, with a fixed caption saying so) and a route reached only through branches/choices (drawn
unconditionally with a caption noting it is conditional, without deriving the full ancestor
condition text — marked severable, per round 1).

**Extensions marked severable, not built here, unchanged from round 1:** manual player-start
pinning; full ancestor-condition text; drawing a second actor's own current position for context;
collision/solid-terrain indication along the path.

## §11. Validation

Unchanged from round 1; not disputed by the review. No new `validateProject` rule — every field a
route introduces already has a total, always-safe fallback by construction (unrecognized `dir`/
`who` falls back to the first entry; a zero-value leg compiles to an already-safe no-suspend opcode;
an empty or all-off route compiles to nothing, the same as an empty/all-off branch; a disallowed leg
op is silently dropped at normalize time via `routeLegs`, the same "drop rather than refuse" answer
`choice`'s own too-many-options truncation already gives).

## §12. Non-goals

No engine changes, no new opcode (`OP_ROUTE` does not exist — `route` is `virtual: true`, §3.0), no
per-route runtime state in `engine/*.asm` or `engine/constants.asm`, no camera/scroll work (item 12,
unrelated), no sound effect (the other still-open half of item 6's cutscene list, unrelated), no
`LIMITS.routeLegs` cap (§3.3), no per-leg `who` (§3.2), no route nesting inside a route or a route
holding a branch/choice (enforced by `routeLegs`, §3.1/§3.3 — orthogonal to, and not granted by,
`route`'s own `nests: true`), no preview extensions beyond the minimal honest version (§10's
severable list). Does not touch `sample*/` fixtures — every test below builds its own project via
`createProject`/`normalizeProject` into an `mkdtemp` directory, the same discipline `move.test.js`
already follows.

## §13. Test plan, with sabotages

For each test, the wrong implementation that would still pass without it. Renumbered against round
1's own list (which had 11 items) to make room for three new items round 2 required (the compiled-
sequence equivalence extension and its direct `routeLegs` test, finding 4; the `nests: true` boundary
test, finding 5) and one new implementation-gate step that is explicitly *not* a permanent test
(finding 1). 14 permanent test items plus the one gate step below. Round 3 added no new numbered
item — its one finding (row-tool canonicalization, below) is folded into test 13 as a second,
dedicated scenario within the existing smoke step, for the reason given there.

1. **Byte-identity: route vs. hand-chained, standalone.** Build a project with one placed actor
   carrying a route (`who: 'player'` — see the note below), with three legs: Move down 32, Turn
   left, Wait 20 frames. Build a second project, identical in every other respect, with those same
   three commands hand-authored in order at the same page position, each carrying `who: 'player'`.
   Assert the two `.nes` files are byte-identical.
   *Fixture note (finding 9's own fixture-contradiction point, round 1):* **use `who: 'player'`
   throughout, consistently — not `who: 'self'` anywhere in this test.** A broken `legWithWho`
   injection that always compiles `who: MOVE_TARGETS[0]` (`self`) regardless of the route's own
   `who` would produce a *plausible-looking, wrong* ROM that this test only catches if the fixture's
   true `who` differs from the broken default.
   *Sabotage it would catch:* an implementation that emits legs in reverse order; an implementation
   that prepends even a single marker/count byte before the flattened legs; the `who`-injection
   failure described above, forced to disagree with the control by the fixture's own choice of
   `player`.

2. **The opcode-catalog ordinal test (finding 4, round 1 — new then).** Assert, for every entry in a
   hardcoded table of `engine/constants.asm`'s own `OP_END`\=$00 through `OP_STING`\=$1A values (the
   same "hardcode it, do not read the file you are checking" discipline this repo's other tests
   already apply to engine RAM addresses), that `opIndex(id)` equals the expected value. Separately
   assert that `EVENT_COMMANDS.filter((e) => !e.virtual)` is exactly that same 27-entry set, in that
   exact order, starting at index 0 (the "real prefix is contiguous from 0" half of §3.0's
   invariant), and that every `virtual: true` entry forms one contiguous block immediately after it
   (today, exactly one: `route`).
   *Sabotage it would catch:* the entire class of bug §3.0 exists to prevent — `route`, or any
   future entry, inserted anywhere in the array other than its policy-mandated position — caught
   directly and immediately, independent of whether any particular fixture happens to emit a command
   whose opcode byte would visibly shift.

3. **Byte-identity: an `off` route costs a project nothing — not one byte of ROM (rewritten per
   round 2's finding 1; this is now the permanent test, replacing round 1's mistaken reference-ROM
   design).** The real `move.test.js` shape (`test/unit/move.test.js:285-305`, read in full for this
   revision), applied to `route`: build **two ROMs in the same test run** — one project whose only
   event content is a route with `off: true` (any legs, since the whole route is switched off) plus
   one ordinary live command elsewhere on the page, and one project with the ordinary live command
   alone, no route at all. Assert the two `.nes` files are byte-identical. This needs no checked-in
   reference of any kind and cannot go stale.
   *What round 1 got wrong and why it mattered:* round 1's version of this test compared a route-free
   project against "a checked-in reference ROM produced by the pre-this-slice compiler" while still
   calling it "the `move.test.js` whole-ROM-comparison shape" — the review correctly identified these
   as two different mechanisms: `move.test.js` has no checked-in reference anywhere, builds both
   variants in the current session, and proves conditional residue is absent, none of which a stale
   pre-slice binary does. A checked-in ROM would also silently go stale the next time any unrelated
   engine change landed, and introduces a generated-binary-fixture class this repository does not
   otherwise maintain anywhere in `test/unit/` (confirmed by grep for this revision).
   *Sabotage it would catch:* an implementation that gates `MOVE_ENABLED`/`TURN_ENABLED`/
   `WAIT_ENABLED` (and their kernel-lo allowances) on whether a route *exists* in the project at all,
   rather than on whether it has any live, admitted leg — i.e. `isLive`'s route branch (or
   `liveCommands`'/`projectUsesMove`'s route handling) treating an `off` route as though it still
   contributed something. This is the *route-container* analogue of `move.test.js`'s own sabotage
   target (a disabled command silently still costing kernel bytes), and is a genuinely different
   fixture shape from test 7 below (an empty/all-off route with *no other live content on the page at
   all*, which exercises `compiledPages`/`compileText` dropping the page outright) — this test's own
   page always has a second, unconditionally live command, so it specifically isolates the route's
   own `off` handling from whether the page itself has anything to compile.

4. **Implementation-gate step, one-time — NOT a permanent test (finding 1).** During
   implementation, build the *same* route-free project from the pre-slice tree (before any of this
   design's changes land) and from the post-slice tree (after), compare the two `.nes` files, and
   record both SHA-256 hashes and the byte-identical/differs result directly in the implementation
   report. This establishes the stronger cross-version claim — "a route-free project compiles exactly
   as it did before this slice" — exactly once, at the moment it is true to check; it is not carried
   forward as a `node:test` case, is not backed by a checked-in binary, and does not need to be
   because every test in this file that runs afterward (especially test 3 above and test 2's ordinal
   check) is what keeps that property true going forward, the same way ordinary regression coverage
   protects every other already-shipped feature in this codebase without a permanent "diff against
   the last release" test of its own.

5. **Predicate: a route with a live Move leg turns `MOVE_ENABLED` on; a route with no Move leg
   (Turn/Wait only) leaves it off; a project's only Move being inside an `off` route leaves it
   off.** Three `projectUsesMove` assertions, direct — unchanged from round 1.
   *Sabotage it would catch:* an implementation that adds `allCommands`'s recursion line but forgets
   the corresponding branch in `liveCommands` (§5.2 — two separate, differently-shaped fixes, both
   needed) — this test specifically exercises `liveCommands` (via `projectUsesMove`), not
   `allCommands`, so it would fail even if `allCommands` alone were fixed.

6. **`FACE_KERNEL_ALLOWANCE` sharing — sabotage claim corrected (finding 7, round 1).** A project
   whose only Turn command is inside a route (with that Turn leg live, not off) measures the
   identical `TURN_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE` kernel-lo delta a standalone Turn
   command already measures (reuse `kernelbytes.test.js`'s own measured-delta style, on at least one
   RPG-capable board). **This test does not, and cannot, distinguish `isLive`'s route branch
   returning `true` unconditionally from the correct, leg-aware version** — a route with a genuinely
   live Turn is live under both implementations, so both charge the identical allowance.
   *What this test actually catches:* an implementation that never extends `liveCommands`/
   `projectUsesTurn` to recurse into `command.legs` at all — i.e. treats every route as contributing
   nothing regardless of its contents — which would measure a **zero** kernel-lo delta instead of the
   real Turn+Face allowance.
   *The `isLive`-unconditional-true failure mode is caught instead by test 7 below.*

7. **Direct empty-route and all-off-route test (finding 7, round 1 — new then).** Two fixtures: (a)
   a placed actor's only page holds one route with `legs: []`, and nothing else live on that page;
   (b) the same, but with three legs, all `off: true`. For both: assert `enabledCommands(page).length
   === 0` and `compiledPages(event)` drops the page; assert `compileText(project)` emits no event
   for that entity at all; assert `projectUsesMove`/`Turn`/`Wait` and `projectUsesText` all remain
   false, matching a project with no route at all — including on MMC3, where a wrongly "live" empty
   route would otherwise spuriously turn on the font-CHR split's kernel-lo cost.
   *Sabotage it would catch:* an implementation of `isLive`'s route branch that returns `true`
   unconditionally. Under that broken implementation, both fixtures above would keep their page in
   `compiledPages` (with nothing else on the page, unlike test 3 above), `compileText` would emit an
   otherwise-empty event, and `projectUsesText` could turn on the MMC3 split-lock cost for a project
   that authored nothing at all.

8. **`projectWithoutCommands`/advice: the route case, provable through the exported function
   (finding 8, round 1).** Build a project refused for kernel-lo capacity (reuse the existing
   documented-limitation fixture shape from `kernelbytes.test.js`, e.g. a Save + a route containing
   a Move leg on the tightest RPG-capable board) and assert `kernelShortfallAdvice` names "every
   Move command" with the correct freed-byte figure. **Separately, call the now-exported
   `projectWithoutCommands(project, ['move'])` directly** and assert on the returned clone's own
   structure: the route command is still present with its Move-typed leg(s) switched off, and any
   Turn/Wait legs in the same route are untouched.
   *Sabotage it would catch:* an implementation of `projectWithoutCommands` (or the `allCommands`
   recursion it depends on) that strips the whole route command instead of just the matching legs.

9. **Round-trip: an unrecognized `op` (a stand-in for "a version that predates `route`") is dropped
   without corrupting neighboring commands.** Construct a raw project JSON with a fabricated future
   op sitting between two ordinary commands on a page, run it through `normalizeProject`, and assert
   the surrounding commands are intact and in order — unchanged from round 1.
   *Sabotage it would catch:* an implementation that throws on an unrecognized op instead of
   returning `null`.

10. **Round-trip: a route written by a *later*, hypothetical version with an unknown extra field on
    a leg or on the route itself survives normalization with the unknown field dropped and the known
    fields preserved exactly.** Unchanged from round 1.
    *Sabotage it would catch:* an implementation that spreads `raw` wholesale into the normalized
    route/leg object instead of building it field by field the way `normalizeEventCommand` already
    does for every other command.

11. **The `nests: true` boundary test (finding 5 — new).** Extend
    `test/unit/script.test.js`'s existing `'nesting past what any project could hold fails by name,
    not by stack'` test with a route-at-the-boundary case, isolating `route`'s own `nests: true` flag
    specifically rather than relying on the existing 200-vs-60 check, which does not exercise it at
    all: that test's own `deep(levels)` helper terminates every chain in a plain `{ op: 'say', ... }`
    base case, which is not `nests: true`, so the existing throw (at `deep(200)`) happens purely from
    the branch/choice wrapping *before* the base command's own flag is ever consulted, and the
    existing non-throw (at `deep(60)`) proves nothing about a `nests: true` command sitting at the
    boundary either. Add a second base-case variant — the identical alternating branch/choice
    wrapping, but with the innermost command a `route` (e.g. `{ op: 'route', who: 'self', legs:
    [{ op: 'move', dir: 'down', dist: 8 }] }`) in place of `say` — and assert: a chain of exactly
    `BRANCH_DEPTH_LIMIT` (64) wrapping levels around that route throws the identical `/nests event
    commands more than 64 deep/` error branch/choice already do; a chain of 63 wrapping levels does
    not throw. (64 wrapping levels puts the route's own `normalizeEventCommand` call at `depth ===
    64`, at which `command.nests && depth >= BRANCH_DEPTH_LIMIT` trips for the first time on the
    route itself — the exact boundary, not merely "deep enough that something upstream already
    threw.")
    *Sabotage it would catch:* forgetting `nests: true` on `route`'s own `EVENT_COMMANDS` entry.
    Every other test in this plan — normalization, compilation, the preview, the editor's leg
    rendering — passes identically whether or not `route` carries `nests: true`, because none of them
    ever nests a route 64 levels deep; this is the only test that isolates the flag's own presence.
    *Why no second, hand-built editor-side test is needed:* per the review's own production grep
    (finding 5), only `normalizeEventCommand` and `addCommand` branch on `.nests` anywhere in the
    codebase, and `addCommand`'s own filter (`!entry.nests || depth < MAX_BRANCH_DEPTH`) is driven by
    the identical flag this schema-level test already pins — there is no separate editor-side state
    machine that could disagree with the schema's own answer. A schema-boundary test is sufficient.

12. **The compiled-sequence equivalence test, made executable (finding 4 — new).** Two additions to
    `test/unit/project.test.js`'s existing `'liveCommands and encodeBody agree on the actual sequence
    of compiled opcodes'` test, both required before a route scenario can run there at all (confirmed
    by re-reading `FIXED_OPCODE_WIDTH`, which today has no `move`/`turn`/`wait` entry — a legal route
    scenario would otherwise fail immediately with "no known fixed width," never reaching a
    comparison that says anything about routes):
    - Add `move: 4, turn: 3, wait: 2` to `FIXED_OPCODE_WIDTH`, matching this design's own §3.4 per-leg
      byte figures exactly (opcode plus operands: Move is opcode+who+dir+dist, Turn is
      opcode+who+dir, Wait is opcode+frames). **No `route` entry is added** — no byte ever decodes as
      one, `virtual: true` (§3.0), and adding one would silently paper over a bug where a route
      opcode *did* leak into the compiled output.
    - Add a route scenario to the scenario table: a route with three admitted, live legs (Move, Turn,
      Wait, each with concrete values) **and one unadmitted leg** (e.g. `{ op: 'say', text: 'nope' }`
      sitting directly in the same `legs` array — a live, not-yet-normalized project, exactly the
      shape `routeLegs` exists to defend against, §3.3). Beyond the table's own generic
      `compiledSequence === liveSequence` comparison (which a shared-but-wrong `routeLegs`
      implementation could pass by having both sides agree on the same bad answer — e.g. an
      accidentally-widened `ROUTE_LEG_OPS` that admits `'say'` would make *both* `decodeOpSequence`'s
      real-byte walk and `liveCommands`'s schema walk include a `say` they should not, and the two
      would still equal each other), add a **third, independently hand-written expected sequence** —
      literally `['move', 'turn', 'wait']`, never derived by calling `routeLegs` or any other shared
      code — and assert both `compiledSequence(routeCommands)` and `liveSequence(routeCommands)`
      equal it directly, mirroring the existing test's own dangling-`call` block
      (`test/unit/project.test.js`, the block asserting `danglingCompiled`/`danglingLive` both equal
      a literal `['say', 'call', 'give']`), which is the established precedent for exactly this
      three-way shape in this file.
    - **A small, direct `routeLegs` admission test**, separate from the scenario table: `routeLegs(
      null)`, `routeLegs(undefined)`, and `routeLegs('not an array')` all return `[]`; and
      `routeLegs([{op:'move'}, {op:'turn'}, {op:'wait'}, {op:'say'}, {op:'branch'}]).map((l) =>
      l.op)` equals exactly `['move', 'turn', 'wait']`, pinning the precise three-op admitted set
      directly against `ROUTE_LEG_OPS` rather than only through the two indirect consumers above.
    *Sabotage it would catch:* a `routeLegs` implementation that admits a fourth op (a typo'd
    `ROUTE_LEG_OPS`, or a version that forgot to exclude `branch`/`choice`/`route` itself) — caught
    directly by the small admission test, and again by the independently-hand-written expected
    sequence in the scenario, which a shared-but-wrong implementation cannot satisfy by agreeing with
    itself the way the table's own generic comparison could be fooled into accepting.

13. **Editor/smoke: the route tool is actually visited, and the preview is actually wired in
    (finding 6, round 1 — extended, not a new separate test).** `forgeIds` coverage only visits each
    Forge's top-level mount, not the event editor modal — confirmed by reading `main/smoke.js`.
    Extend the existing explicit event-editor smoke step: open the event editor from a **placed
    actor's own property panel** (call site 1 or 2, §10 — not the common-event editor), use "+ Add a
    command…" to add `route`, use the leg-adding control to add a Move and a Wait leg, set values,
    **and assert the route row's own preview canvas/caption is actually present in the DOM**.
    **Additionally assert that switching the route's `who` select to "The player" changes the DOM to
    the no-trace caption**, proving the wiring reacts to state, not just that it renders once on
    first paint. Save, and assert the saved project's own `event.pages[0].commands` shape and
    `describeCommand` text reflect the authored route.
    *Sabotage it would catch:* a route block wired with `onchanged` instead of `onchange`, or built
    with `clear(node).append(...)` instead of `fill()`; a pure trace-model helper that `commandRow`
    never actually calls, a preview canvas never appended to the modal at all, or a caption that
    renders once and never refreshes on `who` changing.

    **A second, dedicated smoke scenario in this same step covers the row-tool canonicalization fix
    itself (round 3's finding 1) — the smoke test is the right vehicle, and the only one available:**
    no lighter-weight DOM harness exists for this editor (`test/unit/events.test.js` is explicitly
    "pure helpers, outside the modal UI they back," confirmed by reading it — it never renders
    `commandRow`/`listTools` at all), and `main/smoke.js` is the one place that already drives real
    button clicks against the real `listTools` wiring. The fixture cannot be authored through the UI
    at all — the leg-adding control only ever offers the three admitted ops — so it has to be
    injected directly into the live project state before the modal opens:
    `window.__app.store.open(dir, project)` sets `store.project` with **no normalization** in
    between (confirmed by reading `renderer/store.js`'s own `open()` — a plain assignment, no
    `normalizeProject` call), which is exactly the vehicle this needs; equivalently, reach into an
    already-open `window.__app.store.project` and assign a hand-built `event` onto a placement
    directly, bypassing every UI path that would otherwise normalize it away.

    **Both fixtures assert only DOM state before Save and `store.project` state after it — never
    the modal's own draft (round 4's finding 1, correcting round 3's design, which asked smoke to
    inspect "the draft's own `command.legs`"; `editEvent`'s draft is `const draft =
    structuredClone(...)` inside the function's own closure, exposing nothing but rendered DOM
    until `showModal` resolves — confirmed by reading `events.js:294-297` — so reaching it directly
    would need a new test-only hook this codebase should not add just to make one test's assertions
    convenient). Both fixtures also put `who: 'self'` on the **route**, not on the legs — §3.2's
    stored leg schema has no per-leg `who` at all, and `routeLegs` filters only by `op`, never
    deletes a stray field, so a fixture that put `who` on a leg would have a *correct*
    implementation persist it, contradicting this very test's own closing claim that the result
    matches what a `normalizeProject` round-trip would produce (which deletes a leg's `who`,
    §3.2/§5.1). Legs stay bare (`{ op, dir, dist|frames }` only) in both fixtures, matching exactly
    what the leg-adding control itself would ever produce (§9) and what a normalized project would
    actually store:**

    - **Fixture A — illegal leg first.** Inject a placement whose event's only page holds one route,
      `{ op: 'route', who: 'self', legs: [{ op: 'say', text: 'illegal' }, { op: 'move', dir: 'down',
      dist: 16 }, { op: 'turn', dir: 'left' }] }`. Open its event editor row and assert the visible
      leg list is exactly two rows, Move then Turn (the illegal leg renders nothing, per §9 — true
      under both a correct and a buggy implementation, since round 2's design also filtered the
      *initial* render correctly; the divergence only appears once a tool is used, below). Click
      Remove on the **second** visible row (Turn). **Assert the visible list is now exactly one row,
      Move** — the DOM-observable proof Remove acted on Turn, not Move. (Round 2's buggy wiring
      would splice the *raw* array `[say, move, turn]` at the visible Turn row's filtered position,
      1 — which in the raw array is `move`, not `turn` — leaving raw `[say, turn]`; re-rendering that
      through the same filter shows one visible row, **Turn**, not Move. This corrects round 3's own
      wrong description of the broken outcome, which claimed the illegal leg would be "silently
      removed instead of Turn" leaving `[move, turn]` visible — the actual broken result removes
      `move` and leaves `[say, turn]`/a visible Turn-only row, confirmed by re-deriving the splice
      by hand against the stated fixture.) Click Save, then **deep-assert `store.project`'s own
      persisted route**: `legs` equals exactly `[{ op: 'move', dir: 'down', dist: 16 }]` — one leg,
      no `who` field on it, no trace of `say` anywhere.
    - **Fixture B — illegal leg between admitted ones.** The same shape, legs reordered to
      `[{ op: 'move', dir: 'down', dist: 16 }, { op: 'say', text: 'illegal' }, { op: 'turn', dir:
      'left' }]`. Open the row (visible list: Move, Turn, identical to fixture A). Click Duplicate on
      the **second** visible row (Turn). **Assert the visible list is now exactly three rows,
      Move/Turn/Turn** — the DOM-observable proof Duplicate acted on Turn. (Round 2's buggy wiring
      would splice the *raw* array `[move, say, turn]` at filtered position 1 — the hidden `say` —
      duplicating it into raw `[move, say, say, turn]`; re-rendering that through the same filter
      still shows only **two** visible rows, Move/Turn, unchanged from before the click — a directly
      observable "nothing happened" divergence from the correct three-row result, with no draft
      access needed to see it.) Click Save, then **deep-assert `store.project`'s own persisted
      route**: `legs` equals exactly `[{ op: 'move', dir: 'down', dist: 16 }, { op: 'turn', dir:
      'left' }, { op: 'turn', dir: 'left' }]` — three legs, no `who` field on any of them, no trace
      of `say` anywhere.

    *Sabotage it would catch:* exactly round 2's own shipped defect, reintroduced — `listTools`
    wired against `command.legs` before canonicalization reassigns it (or canonicalization only
    applied to a locally-scoped copy used for rendering rows, never written back onto `command.legs`
    itself, so `listTools` still splices the original, uncanonicalized array underneath a
    correctly-filtered row *list*). Both fixtures are needed: fixture A alone could pass under an
    implementation that canonicalizes correctly only when the illegal leg happens to sit first;
    fixture B is what forces the illegal leg to be genuinely absent from the array Remove/Duplicate
    operate on, regardless of its original position. And a fixture that put `who` on a leg (round
    3's own mistake, corrected here) would have hidden a real defect the other direction: a
    normalizer or Save path that forgot to strip a leg's stray `who` would pass such a fixture by
    accident, since the wrong field would simply be echoed back rather than exposed as unexpected.

14. **Preview honesty labels and trace-instruction correctness — pure unit-level, against the
    trace/caption logic directly (findings 5's third state and 2/7's own asks, round 2).** (a)
    `context.place` present, `who: 'player'` — asserts the player caption and an empty instruction
    list. (b) `context.place` absent (the common-event shape) — asserts the *different*, "no single
    caller/start position" caption and an empty instruction list, regardless of `who`. (c)
    `context.place` present, a route whose only legs are all `off` — asserts an empty instruction
    list. (d) `context.place` present, a route with one live Move leg at `dist: 0` — asserts the
    instruction list is exactly `[{ kind: 'point', at: {...} }]`, **not** `[{ kind: 'segment', from:
    ..., to: ... }]` with `from` equal to `to` — the trace/render *instruction* is asserted directly
    by `kind`, not inferred from array length or coordinate equality, since a zero-length segment and
    an explicit point instruction can describe the same geometry while only one of them is guaranteed
    to paint a visible pixel (§10). (e) **the pure trace-model function called directly** (not
    through a rendered row) on a route holding one admitted, live Move leg and one unadmitted leg
    (`{ op: 'say', ... }`) interleaved — asserts the instruction list contains exactly one entry (for
    the admitted Move) and that the walker's resulting position reflects only that leg's own
    displacement, i.e. the unadmitted leg neither emits an instruction nor advances the walker. This
    is a defense-in-depth test of the trace function's *own* `routeLegs` re-filtering (§10), not of
    the editor's row-render canonicalization — by the time a real row has actually rendered in the
    modal, `command.legs` is already admitted-only (§9's fix, round 3), so this exact input shape
    cannot reach the function through the normal editor path; the test exists so the function is
    still correct if ever called with unfiltered input by a future caller, the same reason
    `describeEnabled` re-filters even though its own input is, in practice, already clean by the time
    it runs inside the modal.
    *Sabotage it would catch:* a preview that silently draws *something* plausible-looking for
    `who: 'player'` or for a common event; an implementation that conflates the "no placement
    context" and "player, unknown position" captions into one generic message; a zero-distance Move
    rendered as an invisible zero-length segment instead of a distinct point marker (caught by
    asserting `kind`, not just that *an* instruction exists at the right coordinates); and removing
    the trace-model function's own defensive `routeLegs` filtering, leaving it correct only by luck
    of the editor's own canonicalization always happening to run first.

## Fix rounds

### Round 1 fixes

Resolutions of round 1's own review, by finding number:

- **Finding 1 (medium, confirmed).** `route` is now `nests: true`, per the source contract's actual
  wording (`shared/project.js:609-611`) and `call`'s own contrasting comment. §3.1 rewritten in
  full; knock-ons (the `BRANCH_DEPTH_LIMIT` throw, the editor's depth-gated offering) stated
  explicitly rather than left implicit. §5.1's `EVENT_COMMANDS` comment rewritten to declare
  `nests: true` and explain why it does not, by itself, grant vocabulary freedom (that is
  `routeLegs`' job, per finding 3). §9 updated: the editor no longer claims unconditional offering.
- **Finding 2 (medium, confirmed).** `liveCommands` now recurses into `routeLegs(command.legs)`
  *instead of* yielding the route wrapper; `allCommands` still yields both, unfiltered, since it
  answers a different question. §5.2 rewritten with the exact diff and an explicit walk of every
  current `liveCommands` consumer confirming none cares. §13 test 2 (originally "Round-trip:
  unrecognized op," now the ordinal test — see below) and the design's own §6 both updated to match;
  the design also states, per the brief's own instruction, that this is not a second silent
  exception in the shape the old `call` carve-out used to be — it is the same "yield what
  `encodeBody` emits" contract, applied correctly to a container that emits nothing of its own.
- **Finding 3 (medium, confirmed).** One shared admission helper, `routeLegs`/`ROUTE_LEG_OPS`, now
  consumed identically by normalization, `isLive`, `liveCommands`, the compiler, and the editor's
  leg-adding dropdown — replacing round 1's inconsistent, per-consumer raw walk of `.legs`. Placed
  in `shared/eventrules.js` (resolving finding 11's ownership question in the same stroke — see
  below), re-exported once by `shared/project.js`. §3.3, §5.1, §5.2, §5.3, §9 all updated.
- **Finding 4 (medium, confirmed).** §3.0 rewritten around an explicit, mechanically-enforced
  catalog invariant: a contiguous real (`OP_*`-backed) prefix, in `engine/constants.asm` order, then
  a contiguous `virtual: true` tail; a future real command is inserted immediately before the
  virtual tail, a future virtual command is appended after it. `route`'s own `EVENT_COMMANDS` entry
  now carries `virtual: true` as a declared field, not an implicit fact. §13 test 2 (new) enforces
  both halves of the invariant directly, and stands in for the part of the old test 3's sabotage
  claim finding 9 demonstrated it never actually carried.
- **Finding 5 (medium, confirmed).** §10 rewritten: placement preview context (`context.place`) is
  now optional, threaded only from the two placement-owned `editEvent` call sites
  (`map.js:786`/`map.js:931`, both confirmed by reading them in full), and explicitly absent at the
  common-event editor's own call site (`events.js:1372`, via `map.js:646-661`). A third, distinctly-
  worded honest caption ("no single caller/start position") is added for the common-event case,
  kept separate from the existing `who: 'player'` caption since the two limitations have different
  causes. §13 test 11 gained a third case.
- **Finding 6 (medium, confirmed).** §13 test 10 (was test 9) now asserts the preview canvas/caption
  is actually present in the DOM after adding a route in the real event-editor modal, and that
  toggling `who` to player changes the DOM to the no-trace caption — closing the gap where a
  correct-but-unwired pure trace helper would have passed round 1's unit-only coverage. The pure
  trace-model tests are retained separately (§13 test 11) rather than replaced, per the review's own
  "retaining... but extending" guidance.
- **Finding 7 (medium, confirmed).** §13 test 5's sabotage claim was wrong and is explicitly
  withdrawn rather than patched over — a live Turn is live under both a correct and a broken `isLive`
  route branch, so that fixture cannot distinguish them; the design now says so plainly and states
  what test 5 actually catches instead (a route contributing nothing at all to the predicates). A
  new, direct test (§13 test 6) exercises an empty route and an all-off route specifically, asserting
  `compiledPages` drops the page, `compileText` emits no event, and `projectUsesText`/the MMC3 split
  cost stay off — the only fixture shape that actually distinguishes the `isLive`-unconditional-true
  defect.
- **Finding 8 (medium, confirmed).** `projectWithoutCommands` is now exported from
  `main/build/generate.js` (§5.5), so §13 test 7 (was test 6) asserts on the real, exported
  function's returned clone rather than a test-side reimplementation of the strip. The brief's
  preferred resolution ("prefer the export") was adopted rather than the alternative (dropping the
  structural claim), since the export is a small, pure, DOM/Node-free addition with no cost beyond
  making an already-private pure function test-visible.
- **Finding 9 (medium, confirmed).** §13's byte-identity tests reworked: test 1's own fixture
  contradiction (`who: self` in the setup line, `who: player` in the sabotage justification) is
  resolved by using `who: 'player'` consistently throughout, stated explicitly as load-bearing. The
  old test 3's claim to catch an opcode-insertion sabotage is corrected — it does not, and is now
  described honestly as proving only route-free byte-identity, with that responsibility handed to
  the new ordinal test (finding 4/test 2); test 3's fixture keeps a live Sting only as a best-effort
  secondary property, not its stated guarantee, and is now explicit about being checked against a
  pre-change reference ROM rather than two same-session builds.
- **Finding 10 (low, confirmed).** The compiler's route case (§5.3) no longer wraps its output in
  `measured()` — it returns `encodeBody(legs, where)` directly, per the brief's own preferred
  resolution ("dropping is simpler and the enclosing owner already reports"). §6 states explicitly
  that this changes no emitted byte (measured() only ever mutated diagnostics, never data) and
  explains why a route has no length field of its own worth an independent overflow check, unlike a
  branch side or a choice option's record.
- **Finding 11 (low, confirmed, three items).** (1) §4's `projectUsesFace` citation corrected to
  `shared/project.js:3060-3070` (defined there, only imported by `generate.js`), not
  `main/build/generate.js` as round 1 mistakenly said. (2) §3.0's abandoned mid-sentence
  self-correction ("wrong opcode bytes for shake/visible/... no, those are all before the insertion
  point") is gone, replaced by the direct, positive catalog-invariant rule described under finding 4
  above. (3) `ROUTE_LEG_OPS`/`routeLegs`/`legWithWho` now have one stated owner
  (`shared/eventrules.js`), re-exported once by `shared/project.js`, with import lists in §5.1/§5.2/
  §5.3/§9 all naming the same source consistently — resolving the contradiction between round 1's
  §5.2 (claimed `shared/project.js` re-exports both) and §5.3 (claimed both import from
  `shared/eventrules.js`) while §5.1 defined `ROUTE_LEG_OPS` in `shared/project.js` itself.

**Nothing in round 1's revision was pushed back on** — every finding was confirmed by the
orchestrator against source before that revision began, per that round's brief, and each was
adopted as written or per that brief's own stated preference (findings 8 and 10, where the brief
offered two options and named a preferred one). See
that round's own fixes report for the same resolutions summarized at report
length.

### Round 2 fixes

Resolutions of round 2's own review, by finding number:

- **Finding 1 (medium, confirmed).** Round 1's own fix for the review-1 byte-identity concern had
  quietly drifted into proposing a checked-in reference ROM — a mechanism `move.test.js` does not
  use and this repository does not otherwise maintain. §6's acceptance-test list and §13 test 3 are
  rewritten around the real precedent: an `off: true` route and no route, built in the same test
  run, byte-identical (`move.test.js:285-305`'s own shape, read in full for this revision). The
  stronger cross-version claim ("route-free output is unchanged from before this slice") is now a
  one-time, explicitly-marked implementation-gate step (§13, new item 4) — build both trees, compare,
  record the hashes and result in the implementation report — never a permanent `node:test` case and
  never backed by a checked-in binary. The ordinal test (§3.0/§13 item 2) remains the permanent guard
  against catalog movement, unaffected by any of this.
- **Finding 2 (medium, confirmed).** Round 1 stated `routeLegs` was consumed "everywhere `.legs` is
  read" but actually wired it through only four of six real readers, leaving the editor's leg-row
  rendering and the preview's trace walker reading raw `command.legs` — exactly the silently-wrong
  UI state the helper exists to prevent. §9 now computes `routeLegs(command.legs)` once per route row
  and reuses that same list for the row rendering, the summary line, and (via §10) the preview trace;
  §3.3's own "consumers" accounting is corrected from "five" to the real count, with the
  editor-dropdown's *separate* use of `ROUTE_LEG_OPS` (not `routeLegs`) called out explicitly so the
  two are not conflated again. §9 also now states plainly what a hand-edited unadmitted leg does in
  the editor's own row list (nothing — no row, no error, matching `choice`'s own truncation
  precedent) rather than leaving that sixth reader's behavior implied. §13 test 14 (was 11) gained a
  fifth case asserting an unadmitted leg neither emits a trace instruction nor advances the walker.
  `allCommands` remains the one deliberate, documented raw-list exception, unchanged, since it
  answers "what is mentioned," not "what compiles or renders."
- **Finding 3 (medium, confirmed).** §5.4/§10 rewritten around one concrete, complete render-data
  path: the two placement-owned `editEvent` call sites now pass `{ project: store.project, tilesetId:
  currentMap().tilesetId, screen: currentScreen(), x: entity.x, y: entity.y }`, and the modal builds
  its own fresh `MetatileRenderer` from `project`/`tilesetId` at open time (cost and rationale for
  not coupling to `map.js`'s live renderer instance stated explicitly in §5.4). Also fixed round 1's
  factually wrong phrasing: `eventContext()` (`map.js:622`) takes zero parameters today, so this
  design gives it its *first*, not "an optional second."
- **Finding 4 (medium, confirmed).** Added §13 test 12 (new): `move: 4, turn: 3, wait: 2` added to
  `FIXED_OPCODE_WIDTH` (confirmed empty of all three today), a route scenario with an admitted trio
  plus one unadmitted leg added to `test/unit/project.test.js`'s existing compiled-sequence
  equivalence test, checked against an independently hand-written expected sequence
  (`['move','turn','wait']`, never derived by calling `routeLegs` itself, mirroring that test's own
  dangling-`call` precedent) so a shared-but-wrong `routeLegs` cannot make the compiler and the
  schema walker agree on the same wrong answer — plus a small, direct `routeLegs` admission test
  (non-array inputs, the exact three-op set). §5.2's own forward-reference to "a route scenario added
  to that test's own scenario table (§13)" now points at a real, specified test item instead of an
  unfulfilled promise.
- **Finding 5 (medium, confirmed).** Added §13 test 11 (new): extends
  `test/unit/script.test.js`'s existing nesting-depth test with a route sitting at the exact
  `BRANCH_DEPTH_LIMIT` boundary (64 wrapping branch/choice levels), asserting the identical throw
  branch/choice already get at 64 and no throw at 63 — isolating `route`'s own `nests: true` flag,
  which the existing 200-vs-60 check never exercised (its base case is a plain `say`, never itself
  `nests: true`, so the existing throw happens purely from the wrapping levels). States explicitly,
  per the review's own production grep, that no second editor-side test is needed: only
  `normalizeEventCommand` and `addCommand` branch on `.nests` anywhere in the codebase, and
  `addCommand`'s own depth filter is driven by the identical flag the schema-level test already pins.
- **Finding 6 (low, confirmed).** §5.2 now names the stale `call`-carve-out paragraph in
  `liveCommands`' own doc comment as an explicit source touchpoint, quotes its current (now
  inaccurate) wording, and states it is deleted/replaced in the same edit that adds the route branch
  — rather than merely asserting, as round 1 did, that the old exception "is not one any longer"
  without saying anything about the stale prose that still claims it is.
- **Finding 7 (low, confirmed).** §10's trace-instruction vocabulary is now fully specified: a live
  Move leg with `dist > 0` emits a `segment` instruction, a live Move leg with `dist === 0` emits an
  explicit `point` instruction (not a zero-length segment, which a canvas would render as no pixel at
  all — indistinguishable from the leg not existing), Turn emits a `facing` instruction, Wait emits a
  `pause` instruction. §13 test 14 (was test 11) asserts the zero-distance case by instruction `kind`
  directly, not by array length or coordinate equality. Compile-time behavior is untouched — this is
  preview rendering only, and §3.3's "a zero-distance leg is not special-cased or skipped" claim
  about compiled bytes is unaffected.

**Nothing in round 2's revision was pushed back on either** — every finding was verified by the
orchestrator against source before this revision began, per that round's brief, and each is adopted
as written. See that round's own fixes report for the same resolutions summarized
at report length.

### Round 3 fixes

Resolutions of round 3's own review, by finding number:

- **Finding 1 (medium, confirmed) — the last gate before the implementation brief.** Round 2's leg
  rows rendered `routeLegs(command.legs)` (a filtered *copy*) but wired
  `listTools(command.legs, position, ...)` against the *raw* array by that filtered `position` — a
  divergence whenever an unadmitted leg was actually present, which is exactly the case round 2's
  own fix was written to handle. For `[say, move]`, Remove on the visible Move row (filtered
  position 0) deleted the hidden `say` instead; for `[move, say, turn]`, Remove on the visible Turn
  row deleted `say`, not Turn — Remove/Duplicate/reorder were all wrong in this shape, and neither
  test 12 nor test 14 exercised the real row tools closely enough to notice, since neither drives
  `listTools` through the modal at all.

  **Resolution: canonicalize the modal's own draft, not just the rendered view of it.** §9's
  `commandRow` route branch now reassigns `command.legs = routeLegs(command.legs)` the moment the
  row renders — a real removal from the draft, not a filtered read of data that is still there —
  before building any leg rows, tools, or the leg-adding control, all of which now read and splice
  `command.legs` directly with no separate filtered variable and no index translation of any kind.
  `position` and the raw index are the same thing by construction from that point on, for the
  simple reason that there is no longer a second, differently-shaped array to disagree with. The
  raw-index-bookkeeping alternative (give route rows their own remove/duplicate/reorder logic that
  operates against each admitted leg's own raw index) was considered and rejected in §9's own text:
  it would need a second, route-specific reimplementation of all four `listTools` operations for a
  case (an unadmitted leg) that can only ever exist for one render before canonicalization would
  remove it anyway — real, ongoing complexity bought for a state that is inherently transient.
  §9 also states the extra reason CLAUDE.md itself supplies for doing this at all, not merely
  tolerating the illegal leg forever: `store.commit()` never runs `normalizeProject`
  (`reconcileCartridge`'s own passage), so without canonicalizing somewhere, an unadmitted leg
  reaching the draft would survive in memory indefinitely; opening this route's row in the editor is
  the one honest moment available to reconcile the stored shape with what actually compiles.

  §9's own "the row list simply does not render a row for it" description (round 2) is corrected to
  what actually happens now: the leg is *removed from the draft*, not merely hidden from a view of
  it that is still intact underneath — stated explicitly, with the practical consequence spelled out
  (an author who opens the row and saves has already lost the illegal entry, the same
  already-documented consequence §8 gives an entire unrecognized command opened by an older
  version, applied here to one leg). §9 and §10 both now state explicitly that `routeLegs` stays
  applied, unconditionally, at every site that does *not* see the modal's draft — the normalizer,
  the compiler, and `describeEnabled`'s own summary line, the last of which runs from `map.js` and
  `eventlist.js` against live `store.project` state for a route whose row may never have been opened
  in this session at all, so canonicalization (a per-row, per-open effect) cannot substitute for it
  there. §10's own trace walker now reads `command.legs` directly (already canonical whenever a row
  can render at all) while its underlying pure trace-model function keeps its own defensive
  `routeLegs` re-filter regardless, matching `describeEnabled`'s identical belt-and-suspenders
  precedent — so test 14's existing unadmitted-leg case (now explicitly reframed as exercising that
  function in isolation, not the editor's row-render path) still stands, unchanged in substance.

  A new, dedicated smoke scenario is added to test 13 (no new numbered item — see §13's own updated
  intro): two fixtures (`[say, move, turn]` and `[move, say, turn]`), each opened, then Remove or
  Duplicate exercised on a specific visible row chosen so that round 2's actual shipped bug and
  round 3's fix produce visibly different, separately-asserted outcomes. The vehicle is
  `main/smoke.js`, the established place for real `listTools`-DOM interaction — confirmed there is
  no lighter-weight alternative (`test/unit/events.test.js` is explicitly pure-helpers-only, never
  rendering `commandRow`/`listTools`) — and the illegal-leg fixture is injected directly into
  `store.project` via `window.__app.store.open(dir, project)`, confirmed by reading `renderer/
  store.js`'s own `open()` to carry no `normalizeProject` call, since the fixture cannot be produced
  through the UI at all (the leg-adding control only ever offers the three admitted ops).

**Nothing in round 3's revision was pushed back on** — the finding was verified by the orchestrator
against the design's own §9 text before this revision began, per the brief, and the reviewer's
preferred resolution (canonicalize the draft) is adopted as written. See
that round's own fixes report for the same resolution summarized at report length.

### Round 4 fixes

Resolutions of round 4's own review, by finding number:

- **Finding 1 (medium, confirmed).** §13 test 13's round-3 row-tool scenario asked smoke to inspect
  "the draft's own `command.legs`" — unreachable, since `editEvent`'s draft is `const draft =
  structuredClone(...)` inside the function's own closure (`events.js:294-297`, confirmed by
  reading it), exposing nothing but rendered DOM to a caller until `showModal` resolves; reaching it
  would need a new test-only hook this codebase should not add for one test's convenience. Reworked
  both fixtures to assert only the visible DOM row sequence before Save and a deep assertion against
  the now-observable `store.project` route after Save — no draft access anywhere. Also corrected
  fixture A's own description of round 2's broken outcome, which was wrong: re-deriving the splice
  by hand against the stated fixture (`[say, move, turn]`, Remove on the visible Turn row = filtered
  position 1 = raw index 1 = `move`, not `turn`) gives raw `[say, turn]` and a visible **Turn**-only
  row, not "`[move, turn]` with the illegal leg silently removed" as round 3 claimed. And removed the
  per-leg `who: 'self'` both fixtures had put on their Move/Turn legs — §3.2's stored leg schema
  never carries a per-leg `who`, and `routeLegs` filters only by `op`, so a *correct* implementation
  would have persisted those extra fields, directly contradicting the test's own closing claim that
  the result matches a `normalizeProject` round-trip (which deletes exactly that field). `who:
  'self'` now sits on the route itself; both fixtures' legs are bare.
- **Finding 2 (low, confirmed).** §3.3's `routeLegs` consumer count corrected from six to seven: the
  pure trace-model helper (§10) is the seventh, and the "rather than calling `routeLegs` a seventh
  time" phrasing — stale since round 3 gave that helper its own defensive re-filter — is removed.
  The two call sites are now distinguished explicitly: the modal's own call (against
  already-canonical `command.legs`) is provably redundant, while the helper's direct-call behavior
  (unfiltered input, no canonicalization upstream) is exactly what §13 test 14's unadmitted-leg case
  isolates and is load-bearing there.

**Nothing in round 4's revision was pushed back on** — both findings arrived with the correct
resolution already specified by the reviewer, confirmed by the orchestrator against source
(`events.js:294-297`'s closure-private draft) before this revision began, and both are adopted as
written. See that round's own fixes report for the same resolutions summarized at
report length.
