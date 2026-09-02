# Design: a true sound effect (item 6's last open line) — shape (a), channel-steal

Status: design only, no code written, no tracked file touched. Written against HEAD `6a44850`
(current `master`, `ROADMAP`/`CLAUDE.md` docs pass `b36093e` already applied). Expects at least two
review rounds before implementation, the established pattern (`docs/design-sting.md`,
`docs/design-routes.md`, and the Tile Forge's own design). A "Fix rounds" section is
appended at the end for reviews to write into; empty for now.

**This is not a re-costing.** The costing pass's "Sound effect / sting" section
(read in full) already priced three shapes and Part 3's fit matrix already answered "does this fit."
The user picked shape (a) — channel-steal — from that closed pass. This document's job is the one
the costing pass explicitly declined to do: resolve every question the costing left open, against
the tree as it actually is *today*, not the tree the costing was priced against.

## §0. The tree moved under the costing — what changed and why it matters

The costing priced shape (a) and shape (b) as **independent, competing** shippables, each paying its
own copy of two "shared mechanisms" (a `force_trig` retrigger array, and a `music_play`/`music_stop`
cancellation pair). Shape (b) then shipped, as `Sting` — but **not** as the costing's own shape (b)
sketch. `docs/design-sting.md` and the real `engine/music.asm` (329 lines, read in full for
this design) show what actually shipped:

- `Sting` reuses the **full, unmodified 4-channel song format and driver** — `[OP_STING, songIndex,
  duration]` names a real entry in `project.songs`, compiled by the ordinary `compileSong`/
  `songTables`, played through the ordinary `music_play`. It is not a new format at all. The
  costing's own shape (c) framing ("sting-as-song") turned out to be closer to what shipped than
  its own shape (b) sketch (a bespoke shadow/restore pair over a *new* format) — except shape (b)'s
  *scripted-restore automation* is what shipped, not shape (c)'s manual `Wait`-then-replay recipe.
- The shared mechanisms are real, and already gated `.if STING_ENABLED`, not behind a placeholder:
  - `force_trig` (4 bytes, one per channel, `engine/constants.asm:587`) plus the check-and-self-clear
    inside `music_channel` (`engine/music.asm:154-167`).
  - The `music_play` cancellation check (`engine/music.asm:65-80`) — `A`-preserving, runs *after*
    `sta cur_song`.
  - The `music_stop` sting-state clear (`engine/music.asm:123-130`) — closes the `init_session`
    bypass (`engine/combat.asm` calls `music_stop` directly, never through `music_play`).

**This design's own §3.5 below shows that shape (a) needs only the *first* of those three as a
genuinely shared term — not all three, contrary to what the costing's Part 2 assumed.** That is a
real finding from tracing the shipped code, not a re-litigation of the costing's own numbers for
shape (a)'s driver-reading rows, which stand.

## §1. What this is, and the invariant

A **sound effect** ("SFX") is a short, fixed-volume, single-channel burst that steals the **noise**
channel for its own duration while the other three channels — whatever they are currently doing,
whether that is the field's own song, Silence, or an in-flight Sting — continue completely
untouched. It is authored once (Sound Forge, a new list beside songs), referenced by a new,
non-suspending event command, and playable regardless of what the music system is doing at the
moment it fires.

**The invariant everything below is built to satisfy:** firing an SFX must never corrupt, delay, or
silently drop any of the other three channels' own state, whether or not a song is playing, whether
or not a Sting is mid-flight, and regardless of the order in which an SFX, a Sting, and an ordinary
Play-music/map-change land relative to each other. Where the costing's own "cheapest policy that is
never wrong-sounding" discipline applies (second-sting replacement), the identical discipline governs
every ordering below — never queueing, never silently dropping, and stated for every case rather than
left implicit, per the brief's own instruction.

**Revised in fix round 1 (finding 4): "whatever they are currently doing" now names the one real
exception explicitly, rather than leaving it to be discovered by reading `music_stop`'s own call
graph.** An SFX survives *every* ordinary music transition — a different song, a map change, and,
now stated plainly, a request for **Silence** (`Play music: Silence`, or a map whose own song is
Silence) — because none of those name the SFX itself, the identical "not a request for the thing
that's playing" reasoning Sting's own cancellation check already uses for songs. The **one** thing
that does end an in-flight SFX outright is an actual new session — `init_session`, not `music_stop`
— because that is the real boundary an SFX has no business surviving (a game over or a fresh boot is
supposed to leave nothing running). §3.4/§3.6/§5.2 below reconcile every touched routine to this one
policy; nothing about it is assumed without a corresponding trace.

**One narrow, out-of-scope caveat, added in fix round 3 (finding 2) rather than left to be found only
in §3.4's own detail: the invariant above is about "the other three channels" — pulse1, pulse2,
triangle — and holds exactly as stated for them, every case, including the noise channel's own
hand-back to whatever was paused underneath it. It says nothing about whether *that paused content
itself* (a sting's own final note, specifically) survives being heard once handed back, on the one
frame a sting also happens to be ending into Silence at the same instant SFX's own cleanup resolves —
it does not, and this is inherited Sting behavior this design does not fix. See §3.4's own "Exact
co-end" bullet for the full trace and the reasoning for leaving it unfixed.**

## §2. What I read

The costing pass's own report, in full (its "Sound effect / sting" section, Part 1's margin
table, Part 3's fit matrix, and the three rounds of revisions at the end, to see which figures moved
and why). `engine/music.asm` in full (329 lines) — not the costing's sketch of it, the real shipped
file, including the now-shipped `.if STING_ENABLED` blocks. `engine/constants.asm`'s RAM map from
`ent_record` through the switch-bound-tiles block (`$0510`-`$0567`), and the confirmed-unused gap
after it (`$0568`-`$05FF`, before `flash_driver` at `$0600`). `engine/script.asm`'s dispatch chain
(`script_run_flash` through `script_run_bad`) and `script_op_sting` in full, for the exact
stop-the-event-on-a-recognised-but-empty-operand shape. `engine/boot.asm`'s `main_loop` (the
`music_tick`/`sting_tick`/`flip_tick`/`flash_tick` ordering) and `engine/ui.asm`'s own `ST_BATTLE` →
`BE_TICK` dispatch, to confirm `music_tick` really does run every field-loop frame, battle included.
`shared/audio.js` and `main/build/songcompile.js` in full, for the compiled-song format and the
`songByte`/`songFrameLength`/`songTimeline` shape `Sting`'s own compiler case (`main/build/
textcompile.js:355-368`) actually uses. `shared/project.js`'s `EVENT_COMMANDS` (through `sting`'s own
entry and the `route` virtual-tail comment), `IMPLEMENTED_COMMANDS`, `LIMITS`/`NO_ACTOR`/`NO_ITEM`/
`NO_METASPRITE`'s cap-equals-sentinel pattern, `projectUsesSting`/`projectUsesPaletteFx`/
`projectUsesFace` (the derived-predicate-from-two-others shape), and the Sting `validateProject`
block (missing/overlong song refusal). `main/build/generate.js`'s `kernelCodeBytes`,
`kernelShortfallAdvice`, `STING_KERNEL_ALLOWANCE`'s own comment (including its 4-byte
zero-page-vs-absolute correction history), `PALETTE_FX_ENABLED`/`FACE_ENABLED`'s emission as derived
flags, and `musicSize`/the kernel-hi capacity check. `renderer/forges/sound/replayer.js` and
`sound.js` (its tracker editor shape) for the authoring-surface precedent. `test/unit/
kernelbytes.test.js`'s Sting section (the isolation-measurement helper, the split-lock dependent
test, the documented-limitation refusal test) as the test-plan template. `CLAUDE.md`'s music-format
single-writer rule, its Sting passage, and the kernel-budget narrative (`STING_KERNEL_ALLOWANCE`,
`SPLIT_LOCK_KERNEL_ALLOWANCE`, `kernelShortfallAdvice`'s dependent-term reasoning).

**One fact I checked empirically rather than assumed:** whether nesasm v3.1 accepts an OR'd condition
in `.if` at all (§3.5 turns on this). A scratch `.if FLAG_X | FLAG_Y` / `.if FLAG_X & FLAG_Y` file,
assembled with the real `nesasm` binary on `PATH`, produced the expected bytes (`01 03`) — the
dialect does support `|`/`&` as constant-folding bitwise operators in `.if`. Kept out of the tracked
tree (scratchpad only, `git status` unaffected). This is stated so the choice in §3.5 reads as
verified, not assumed either way.

## §3. Central decisions

### §3.1 Which channel is stolen — fixed, noise, `SFX_CHANNEL = 3`

Fixed at compile time, not author-chosen per effect. `music_apply`'s own channel dispatch (`cpx #2 /
beq triangle / bcs noise`) makes noise channel index 3 the highest, so `SFX_CHANNEL = 3` needs no new
dispatch shape anywhere that already switches on channel index.

**Why fixed, and why noise specifically, argued rather than merely asserted:**

- **Engine cost.** A per-effect channel means `force_trig`'s check, the hand-back write, and — more
  importantly — the `music_tick` restructuring in §3.3 below would all need to test *which* channel
  is currently stolen rather than compare against one compile-time constant. That is real, avoidable
  branching cost on a bank with, per the costing's own Part 1 table, as little as 88 bytes of spare
  kernel-lo on some configurations.
- **Which channel is safest to interrupt.** The costing's own reasoning — noise is "least likely to
  be carrying a melody the player would miss" — holds up under a second look: in a 4-channel NES
  chiptune the two pulses typically carry the lead/harmony and the triangle typically carries the
  bass line; noise is where percussion/rhythm content lives. Stealing it for a fraction of a second
  interrupts a drum hit, not the tune or the bassline underneath it.
- **The real cost of this choice, stated rather than hidden.** Noise has no chromatic pitch — its
  period table selects one of 16 fixed "shades" (`music_apply_noise`: `15 - (note & $0F)`), not a
  note out of the full 96-note table pulse/triangle read from. A melodic, ascending "coin" ding
  (classically a pulse-channel effect) cannot be authored faithfully on noise. This is accepted as
  the honest cost of "smaller and simpler": the Sound Forge SFX editor (§6) restricts its note picker
  to the 16 values noise can actually express, so an author is never shown a control that lies about
  what will be heard. A percussive hit/hurt/jump-land effect is exactly what noise is good at; a
  bright melodic pickup jingle is not achievable with this design as specified, and that is named
  here as a real, deliberate limitation rather than discovered later. Author-chosen channel (trading
  simplicity for the full pitch range on pulse/triangle) is named in Open Questions as a real,
  uncosted follow-up, not built here.

### §3.2 The format — a genuinely separate, smaller one; single writer in `shared/audio.js`

Not `compileSong` reuse. `Sting` could reuse the full song format because it takes over *all four*
channels for its own duration — an SFX takes over exactly one, so a 4-channel pointer table (8 bytes
minimum per entry, `songTables`' own documented floor) would waste 6 of those 8 bytes on channels the
effect never touches, and the format carries instrument/envelope opcodes (`$F0-$F7`) a fixed-volume
reader has no use for. The costing's own framing — "a genuinely separate, smaller sting format...
which means `main/build/songcompile.js` needs its own small `compileSting()`-shaped sibling" — was
priced for a hypothetical sting before Sting shipped differently; it is exactly right for *this*
feature, just renamed. This design calls the new function `compileSfx()`.

**Compiled stream shape**, defined in `shared/audio.js` alongside the existing song format (single
writer: the format's facts live in exactly one place, imported by the driver's own generator
emission, the compiler, and the preview):

```
[volume]  [note-or-REST, duration]...
```

- **One leading volume byte**, 0-15, read once at trigger time — not per step, not per instrument.
  This is the format's whole answer to "fixed volume, no instrument/envelope": there is no envelope
  table, no per-note instrument select opcode, and no lookup at tick time at all — `sfx_volume` is a
  literal byte `sfx_channel_tick`'s own APU write ORs straight in, the cheapest thing that could
  still let an author pick how loud one specific effect is (a coin ding and a heavy hit landing do
  not want the same volume).
- **A flat sequence of `(note, duration)` pairs**, no loop opcode (`$FF`) and no instrument opcode
  range (`$F0-$F7`) — both are simply never emitted, so `sfx_read_event` (§5) never has to check for
  either, a real code-size win over `music_read_event`'s own reader. `$FE` is reused verbatim as REST
  (`MUS_REST` — no new constant).
  **Note range revised this round (finding 7): the stored/compiled note is canonically 0-15, not
  0-95.** Round 1 let the schema store the full 96-note range while the editor exposed only the 16
  values noise can actually express and the driver masked with `and #$0F` — six different stored
  values would alias each noise period, so a project file could hold a note the UI could never have
  produced and no round-trip could tell apart from five others. The song format's own 0-95 range
  exists for pulse/triangle's real chromatic table; SFX has no such table (§3.1's own fixed-noise
  argument), so there is nothing 0-95 was ever buying here. `normalizeSfx` now clamps a step's `note`
  to 0-15 directly (or `null` for a rest) — the one canonical value both the editor and the compiled
  byte agree on. `sfx_apply`'s own `and #$0F` mask (§5.2) is **kept anyway**, not removed: the schema
  guarantees an in-range byte, but the engine trusting a compiled value it could still be handed by a
  hand-edited or later-version project is exactly the defense-in-depth this codebase already applies
  everywhere else (`NO_ACTOR`/`NO_ITEM` checks exist even though `validateProject` already refuses
  the cases that would need them) — 2 bytes of cheap insurance, not redundant belt braced by nothing.
- **Terminated defensively, not authoritatively.** The whole effect's duration is a *separately*
  computed, compiler-baked operand on the command itself (see §3.7) — the engine never has to detect
  "end of stream" by reading a sentinel, the same shape Sting's own `sting_left` countdown already
  uses regardless of what the underlying song stream is doing. A trailing `REST, 0` pair is still
  emitted (mirroring `compileSong`'s own "a completely empty channel still needs something to play"
  convention) purely as insurance against a hand-edited or later-version project whose baked duration
  disagrees with its own stream — the identical defense-in-depth this codebase already applies to
  Give/Take/Call/Sting's own `NO_*` fallbacks, not a mechanism anything correctly-compiled ever
  exercises.

**New symbols in `shared/audio.js`**, placed beside the existing song-format exports:

```js
export const NO_SFX = 0xff;

// The step-count ceiling lives HERE, not in shared/project.js's LIMITS object
// -- placement reasoning unchanged from round 1's own fix (finding 7):
// shared/project.js already imports FROM shared/audio.js (NO_SONG/songByte/
// songFrameLength, and now NO_SFX/sfxByte/sfxFrameLength/normalizeSfx too),
// so audio.js importing LIMITS back out of project.js would be the exact
// cycle CLAUDE.md's own single-writer discipline exists to prevent.
//
// WHAT KIND of limit this is corrected this round (fix round 2, finding 6):
// SFX_MAX_STEPS is an AUTHORING/product limit, not a format-addressing one
// -- round 1 wrongly grouped it with NUM_NOTES/MAX_INSTRUMENTS/MAX_PERIOD
// above, which really are format/hardware ceilings (96 real notes, the
// 3-bit $F0-$F7 instrument-select range, an 11-bit APU period register).
// Nothing about the compiled stream caps step count at 8: sfx_ptr_lo/hi is
// a genuine 16-bit pointer (§4), sfx_read_event (§5.2) has no fixed-size
// buffer to overflow, and the whole-effect duration compileSfx/script_op_sfx
// bake into the command operand is computed separately from step count
// (sfxFrameLength sums whatever steps exist). Eight is chosen purely to
// keep an authored effect reading as "a coin/jump/hit," not a melody --
// nothing stops the format from holding more; SFX_MAX_STEPS is what stops
// the EDITOR from offering more (§3.9's own Add-step gate) and what
// normalizeSfx truncates an over-cap list down to on load (§3.9).
export const SFX_MAX_STEPS = 8;

export function sfxByte(sfxList, id) {
  if (id === null || id === undefined) return NO_SFX;
  const n = Number(id);
  return Number.isInteger(n) && n >= 0 && n < (sfxList?.length ?? 0) ? n : NO_SFX;
}

/** A raw SFX's own total length in frames -- the sum of every step's duration,
 *  uncapped; the 255-frame ceiling (one countdown byte) is enforced by callers,
 *  the identical split songFrameLength already holds to. */
export function sfxFrameLength(rawSfx) {
  const sfx = normalizeSfx(rawSfx);
  return sfx.steps.reduce((total, step) => total + step.duration, 0);
}

export function normalizeSfx(raw, name = 'Effect') { /* clamp shape, see below */ }
```

`normalizeSfx` mirrors `normalizeSong`'s own defaulting discipline: `volume` clamped 0-15 (default
15), `steps` **truncated** to `SFX_MAX_STEPS` entries (`.slice(0, SFX_MAX_STEPS)`), each step's
`note` either `null` (a rest) or an integer clamped **0-15** (revised this round, above), `duration`
clamped 1-255.

**Over-cap load policy, decided explicitly this round (fix round 2, finding 6): truncate-on-
normalize, not preserve-and-refuse.** This is a real choice between two precedents already in this
codebase, and the two do not agree — `LIMITS.actors`/`LIMITS.items`/`LIMITS.sfx` (§3.9) are all
preserve-and-refuse (`validateProject` names the over-count and stops the build, keeping every extra
entry intact) because those are **id spaces**: something *outside* the list references an actor/item/
effect by numeric index, so silently truncating would corrupt those references. A step inside one
effect has no such outside reference — nothing else in the project points at "step 3 of effect 5" —
so it is not that shape of problem at all; it is the identical shape `choice`'s own extra-options
truncation and `normalizeSong`'s own `.slice(0, MAX_INSTRUMENTS)` already are (`shared/project.js`'s
own comment on the `choice` case: extra options are "dropped rather than kept for a later version to
honour... this schema does not preserve" them). A hand-edited or later-version effect with more than
eight steps is silently trimmed to the first eight on load, the same answer this codebase already
gives every other purely-local, no-outside-reference overflow — not a new policy invented for SFX,
the existing one correctly applied rather than defaulted to the wrong precedent by proximity to
`LIMITS.sfx`'s own, unrelated over-cap rule a few lines away in §3.9.

**Zero-step policy — one coherent answer, not two contradictory ones (finding 7).** Round 1 claimed
both that a zero-step effect "normalizes to one rest step of duration 1" *and* that it "is refused by
`validateProject`" — those cannot both be true, and the shown validation sketch never actually
checked step count either way. The contradiction is resolved by noticing there is nothing left *to*
refuse once normalization has already run: `normalizeSfx` is the single writer of what a stored
effect looks like, `createSong`'s own identical "a raw song with nothing authored still gets one
real pattern" precedent, applied here — a raw `{ steps: [] }` normalizes to one rest step of
duration 1, full stop, the same way an empty song is never a distinct, refusable state from a
one-pattern song that happens to be silent. **`validateProject` does not check step count at all** —
there is no "empty" state left by the time a project reaches it to check for, and a one-step,
all-rest effect is a legitimate (if silent) authored asset, the same standing an entirely-rest song
channel already has today.

`main/build/songcompile.js` gains a small sibling, not a `compileSong` branch:

```js
export function compileSfx(rawSfx) {
  const sfx = normalizeSfx(rawSfx);
  const bytes = [sfx.volume & 0x0f];
  for (const step of sfx.steps) {
    bytes.push(step.note === null ? OP_REST : step.note, step.duration);
  }
  bytes.push(OP_REST, 0); // defensive terminator, see §3.2
  return { bytes };
}

export function sfxTables(sfxList) {
  // Mirrors songTables' own shape: a compiled-per-entry pointer table
  // (sfx_ptr_table_lo/hi, ONE 2-byte pointer per effect, not four), plus each
  // effect's own compiled bytes as a labeled block. No instrument tables, no
  // per-channel anything -- there is exactly one channel, fixed at assemble
  // time (SFX_CHANNEL), so the format needs none of songTables' multi-channel
  // plumbing. Appended into the SAME assets/music.inc file songTables already
  // writes (main/build/generate.js), not a new .inc/.include -- see §3.10.
}
```

### §3.3 The ownership state machine — `mus_enabled`'s gate, the final-frame drop, and the shared
`$400C` register (fix round 1: findings 1, 2, 3, 4 revised together, per the review's own instruction
that these are one cluster, not four independent patches)

**Round 1 of this design had three compounding defects, all rooted in one mistake: treating
`sfx_left` (a plain countdown) as if it were also an ownership flag, and treating "who else writes
`$400C`" as a question only `music_channel`'s own normal path had to answer.** Fixed together below,
because the fix to each is only correct in light of the other three.

**Finding 2 first, since it is a precondition for everything else: `$4015` is never turned on for a
Silence-start project.** `engine/music.asm:109` (`music_play`'s own success path, `lda #$0F / sta
$4015`) is confirmed, by grep, the **only** write to `$4015` anywhere under `engine/` — a reset leaves
the APU's own channel-enable bits clear, and nothing in `music_stop` or round 1's own SFX sketch ever
sets them. A project that never plays a song before its first SFX would execute every proposed
`$400C`/`$400E`/`$400F` write against a channel the hardware itself has not enabled — silently
inaudible. **Fix: `script_op_sfx` (§5.3) now writes `$4015 = $0F` unconditionally on every trigger**,
the exact value `music_play`'s own success path already writes and the only value this engine has
ever written there — not a new policy, the existing one-value invariant applied to a second call
site. This is safe on a true cold boot, too, not merely asserted: `engine/boot.asm`'s own `reset`
calls `init_session` unconditionally (line 49), which calls `music_stop` (`engine/combat.asm:108`)
before the main loop ever runs, so every channel's own volume register already holds `music_stop`'s
safe, silent `$30`/`$00` stamp by the time an SFX could possibly fire — enabling their length
counters via `$4015` produces no pop, confirmed by tracing the boot sequence rather than assumed.

**Finding 1: the final authored frame's own note is applied, then never protected from being
overwritten *before it has been heard for even one frame*, and the hand-back that is supposed to
happen afterward may never be serviced at all.** Round 1's `sfx_channel_tick` decremented `sfx_left`
to zero and set `force_trig+SFX_CHANNEL` in the same instant `sfx_apply` had just written the
effect's real final note to `$400C` — and because `music_tick`'s own top-level gate (round 1: `mus_
enabled | sfx_left`) is now false the moment `sfx_left` reaches zero, the *next* frame may never call
`music_channel` **or** `sfx_channel_tick` for that channel at all if `mus_enabled` is also zero: `$400C`
keeps whatever value was last written, forever (the `$30 | volume` write sets the noise channel's own
length-halt bit, so nothing about the APU's own length counter rescues this either — `music_tick`
never runs again for this channel until something else touches it). **A same-frame fix does not
work either** — deciding hand-back-or-silence *on the same frame* `sfx_left` reaches zero, immediately
after `sfx_apply` just wrote the real note, would silence or retrigger the register before that note
was ever actually output for a full frame (**corrected wording, fix round 4 finding 3**: two writes
to the same register in one CPU frame do not mean the first is inaudible outright — its value takes
effect for the CPU cycles between the two writes — but the note is truncated to that short interval
rather than receiving its authored full frame, which for a same-frame resolution is not a real
audible note at all) — reproducing the exact drop finding 1 names, one mechanism later. **The fix is a genuine two-phase state, the same shape the
costing's own Tile design already uses for an identical reason** ("a naive one-frame suspend does
not actually enforce this bound... the fix is a two-phase armed state"): a new byte, `sfx_state`
(§4), replaces `sfx_left` as the *ownership* signal everywhere ownership is asked about (`sfx_left`
stays, but purely as the note-duration countdown it always was) —

```
sfx_state: 0 = idle (SFX does not own the noise channel at all)
           1 = playing (sfx_left counts down; sfx_apply writes real audio)
           2 = cleanup-pending (the frame AFTER the last playing frame --
               nothing has decided hand-back vs. silence yet)
```

`sfx_channel_tick` (§5.2) is entered whenever `sfx_state != 0`, regardless of `mus_enabled` (finding
2's own fix folded in): state 1 applies this tick's real audio *first*, then, only if `sfx_left` just
reached zero, moves to state 2 rather than resolving anything yet; state 2, entered on the *next*
tick, resolves exactly once and returns to state 0 — either writes `$400C = $30` directly if
`mus_enabled` is Silence, or (**revised in fix round 2, finding 1 — see below**) hands back *and
actually resumes the channel that same tick* if `mus_enabled` is true. `music_tick`'s own top-level
gate (§5.2) tests `mus_enabled | sfx_state`, not `sfx_left` — the distinction is exactly what keeps
the loop alive for the one extra frame state 2 needs, which `sfx_left` alone (already zero by then)
cannot express.

**Fix round 2, finding 1: the round-1 audible branch only set `force_trig` and returned — the real
music did not actually resume until the frame *after* the cleanup frame, one frame later than the
Silence branch's own immediate `$400C = $30` write.** Traced directly: `sfx_channel_tick`'s state-2
audible branch (round 1's own text) set `force_trig+SFX_CHANNEL` and `rts`'d without ever calling
`music_channel` for that index — and `music_channel` is called exactly once per channel per frame,
from `music_tick`'s own loop, so nothing consumes that flag until `music_tick`'s *next* invocation.
Concretely, with `sfx_left` reaching zero on frame N: frame N applies the real final note and moves
to state 2; frame N+1 (the cleanup frame) sets `force_trig` but writes nothing to `$400C` at all, so
the frame-N note — still physically latched in the register, nothing having overwritten it — keeps
sounding for a *second* frame; only frame N+2's ordinary `music_channel` call finally consumes
`force_trig` and resumes the real music. The Silence branch has no equivalent gap (it writes `$400C`
directly, on the cleanup frame, immediately) — so round 1's own fix for finding 1 left an asymmetric,
still-real one-extra-frame bug in exactly the branch it was supposed to have closed.

**The fix, traced against the 6502 traps and `music_channel`'s own register contract before adopting
it, not merely applied**: on the cleanup frame, when `mus_enabled` is true, set `force_trig` and then
**tail-call `music_channel`** for the current `X` (still `SFX_CHANNEL` — nothing between entering
`sfx_channel_tick` and this point touches `X`) instead of returning:

- **Does `X` survive to the tail call?** Yes — every instruction on the path from `sfx_channel_tick`'s
  own entry to this branch (`lda sfx_state`, `cmp #1`, `beq`, `lda #0`, `sta sfx_state`, `lda mus_
  enabled`, `beq`, `lda #1`, `sta force_trig+SFX_CHANNEL`) touches only `A` and flags, never `X` or
  `Y`. `music_channel`'s own body indexes every array with `,x` throughout — it needs exactly the `X`
  `music_tick`'s loop already set for this iteration, and that is exactly what is still in `X`.
- **Does the loop continue correctly on return?** Yes, by the identical "reached by `jmp`, never had a
  return address of its own" shape CLAUDE.md's own item-5 passage already documents for `use_item`/
  `player_died`. `music_tick`'s own loop calls `sfx_channel_tick` with `jsr` (§5.2's restored sketch,
  below) — that `jsr` pushes the address of the loop's own next instruction. A `jmp music_channel`
  from inside `sfx_channel_tick` pushes nothing new, so `music_channel`'s own trailing `rts` pops
  *that original* return address, landing the loop back exactly where an ordinary `rts` from
  `sfx_channel_tick` itself would have — the loop's own `inx`/`cpx`/`bne` tail runs unmodified.
- **Does `force_trig`'s check inside `music_channel` actually fire on that same call?** Yes — `sta
  force_trig+SFX_CHANNEL` runs immediately before the `jmp`, and `music_channel`'s own first act
  (`engine/music.asm:151-167`, gated `.if AUDIO_FX_ENABLED` after this round's own re-gate) is `lda
  #0 / sta mus_trig,x` followed immediately by the `force_trig,x` check — for the same `x`, on the
  same call, with nothing in between able to clear it early.
- **Does resuming through the ordinary duration/read-event/apply logic that follows read anything
  unsafe?** No — `mus_dur,x`/`mus_ptr_lo/hi,x` for `SFX_CHANNEL` have sat completely untouched since
  the steal began (§3.4's own disjoint-RAM argument), so `music_channel`'s own `lda mus_dur,x / bne
  tick / jsr music_read_event` correctly resumes exactly where the underlying song or sting was
  paused — the ordinary behavior every other channel's own tick already has, nothing special about
  reaching it via this tail call.

This gives the final SFX note exactly one full frame — the cleanup frame either silences it (Silence)
or hands the channel back with a real, same-frame retrigger (audible) — matching the Silence branch's
own timing exactly rather than lagging it by one frame. §5.2's own `sfx_channel_tick` sketch and §8's
byte count are both revised to match (`rts` → `jmp music_channel`, +2 bytes).

**Both audible co-end cases retraced against the corrected mechanism, not merely re-asserted:**

- **SFX ends first (state 2's own cleanup runs, sting still audible).** Cleanup reads `mus_enabled`
  (true), sets `force_trig`, tail-jumps into `music_channel` for `SFX_CHANNEL` — which correctly
  retriggers the sting's own paused noise content (its `mus_*` state was left untouched by the steal)
  on the *same* cleanup frame. No extra frame, no dropout.
- **Exact co-end, sting restores into an audible song.** Frame N: SFX's own playing branch applies
  the final note and moves to state 2 (unaffected by this fix — the playing branch never reaches the
  tail-call code at all); later the same frame, `sting_restore` runs, its audible branch sets `force_
  trig,x` for all four channels including `SFX_CHANNEL` (still harmless/idempotent — no APU register
  touched) and copies the restored song's own state into every channel's `mus_*`, `SFX_CHANNEL`
  included. Frame N+1 (SFX's cleanup frame): `mus_enabled` is now the freshly-restored song's own
  value (true), so the fixed branch fires, tail-calling `music_channel` — which correctly retriggers
  the *already-restored* song's own noise part (not the sting's), because `sting_restore` already
  overwrote that channel's `mus_*` on frame N. Hand-back lands on the correct frame, using the
  correct, fully-settled content.

**Finding 3: `sting_restore`'s own hand-back is not unconditional, and its Silence branch writes
`$400C` directly, racing the SFX's own write on the same channel.** Round 1 claimed `sting_restore`
"unconditionally runs `sting_retrig_loop` for all four channels" — false. Read directly from
`engine/music.asm:410-438`: `sting_restore` restores `mus_enabled` from the shadow and **branches on
it**. Only the audible branch reaches `sting_retrig_loop` (which writes only `force_trig,x` — no APU
register — so it stays harmless/idempotent against an active SFX exactly as round 1 argued for that
one branch). The **Silence** branch, `sting_restore_silence`, is a different routine entirely: it
writes `$30` to `$4000`, `$4004` **and `$400C`**, then `$0` to `$4008`, and **never touches
`force_trig`**. Because `sting_tick` runs after `music_tick` every frame (`engine/boot.asm:105-107`,
load-bearing order), a sting restoring into Silence on the same frame an SFX is still actively
sounding (`sfx_state` 1 or 2) overwrites that frame's just-applied `$400C` value with `$30` — a
one-frame dropout, exactly the failure mode finding 1 already fixes for the *ordinary* Silence case,
now reopened by a second, independent writer of the same register. **Fix: `sting_restore_silence`
becomes ownership-aware**, skipping its own `$400C` write whenever `sfx_state != 0` — SFX either owns
the channel outright (state 1) or is one frame from resolving it itself (state 2, and `music_tick`
always runs before `sting_tick`, so by the time `sting_restore_silence` could run on a genuine
cleanup frame, `sfx_channel_tick`'s own cleanup has *already* executed that same frame and reset
`sfx_state` to 0 — so the guard never suppresses a needed silence write, only a premature one):

```asm
sting_restore_silence:
  lda #$30
  sta $4000
  sta $4004
  .if SFX_ENABLED
  ldy sfx_state
  bne sting_restore_silence_skip_noise   ; SFX owns (or is a frame from
                                          ; finishing with) the noise channel
                                          ; -- its own cleanup phase silences
                                          ; it, not this restore. See §3.3.
  .endif
  sta $400C
sting_restore_silence_skip_noise:
  lda #0
  sta $4008
  rts
```

**This whole routine, `sting_restore_silence` itself, lives inside the shipped outer `.if
STING_ENABLED` block (`engine/music.asm:376-454`) — so the nested `.if SFX_ENABLED` guard above can
only ever assemble when *both* flags are true.** These 5 bytes are therefore **not** part of
`SFX_KERNEL_ALLOWANCE_STANDALONE` — see §3.6's own corrected decomposition (`STING_SFX_INTERACTION_
ALLOWANCE`, fix round 3 finding 1). Every other `.if SFX_ENABLED` block in this design (`music_tick`,
`script_op_sfx`, `sfx_channel_tick`/`sfx_read_event`/`sfx_apply`, `music_stop`'s own guard,
`init_session`'s clear) sits in code that assembles regardless of `STING_ENABLED`, so none of those
needed reclassifying — this is the one exception, and it is an exception specifically because of
*where* it is nested, not because of anything about the guard's own logic.

`sting_retrig_loop`'s own branch needs **no equivalent change** — traced above, it writes only
`force_trig,x`, never an APU register, so nothing it does can race `sfx_apply`'s own writes. **Every
other `$400C`/`$400E`/`$400F` write site in the engine** (`music_apply_noise`, `music_silence_noise`
— `engine/music.asm:314-349`, both reached only through `music_channel`'s own normal per-channel
path) is confirmed, by grep across every `.asm` file, to be unreachable for `SFX_CHANNEL` while
`sfx_state != 0` **by construction of §5.2's own restructured `music_tick`**, which diverts that
channel index to `sfx_channel_tick` instead of `music_channel` for exactly as long as ownership is
held — so `music_stop` and `sting_restore_silence` are the complete list of *external* writers that
needed a guard, not merely the two this design happened to find first.

**Finding 4: `music_stop` is not a session-only routine, and coupling the session-reset fix to it
cancels every ordinary Silence request too.** Round 1's `.if SFX_ENABLED: sta sfx_left` inside
`music_stop` assumed `music_stop` only ever runs at a session boundary — false: `music_play`'s own
`cmp #NO_SONG / beq music_stop` (`engine/music.asm:81-82`) means **every** ordinary "Play music:
Silence" command and **every** map transition whose destination song is Silence reaches `music_stop`
too, through the entirely ordinary `set_music`/`apply_map_music` paths — not merely `init_session`'s
own direct call. Clearing `sfx_left` there would cancel an in-flight SFX the instant an author's
completely unrelated "fade to silence" moment fires, directly contradicting §1's own promise that an
SFX survives whatever the music does around it. **The product decision, made explicitly rather than
left implicit: an SFX survives every ordinary music transition, silence included; only an actual new
session ends it.** This is not a new policy invented to patch the bug — it is what §1 already
promised, corrected to actually hold once `music_stop`'s own dual role (ordinary silence *and*
session reset) is traced rather than assumed away. Two consequences, reconciled below:

- **`music_stop`'s own existing, unconditional `$400C` stamp must respect SFX ownership**, the
  identical guard `sting_restore_silence` needed and for the identical reason — an ordinary
  Play-Silence must not clobber an active SFX's own note either:

  ```asm
  music_stop:
    lda #NO_SONG
    sta cur_song
    lda #0
    sta mus_enabled
    .if STING_ENABLED
    sta sting_left
    .endif
    lda #$30
    sta $4000
    sta $4004
    .if SFX_ENABLED
    ldy sfx_state
    bne music_stop_skip_noise    ; ordinary Silence must not cancel an
                                  ; active SFX -- see §3.3/§1
    .endif
    sta $400C
  music_stop_skip_noise:
    lda #0
    sta $4008
    rts
  ```

  **No `sfx_left`/`sfx_state` clear is added to `music_stop` at all** — that would be exactly the
  session/ordinary-Silence conflation this finding exists to remove.
- **The actual session-reset clear moves to `init_session`** (`engine/combat.asm`), the one place
  CLAUDE.md already names as "the single definition of 'new game'" and the one call site that is
  genuinely session-scoped (boot, a fresh game, and every game-over restart, never an ordinary
  Play-Silence). Placed immediately after `init_session`'s own existing `jsr music_stop`:

  ```asm
    jsr music_stop              ; unchanged call site; its own new guard above
                                 ; means this may have just skipped $400C if an
                                 ; SFX still owned it a moment ago
    .if SFX_ENABLED
    lda #0
    sta sfx_state                ; the real session boundary -- unlike an
    sta sfx_left                  ; ordinary Play-Silence, a new session
                                    ; really does end whatever SFX was
                                    ; mid-flight
    lda #$30
    sta $400C                        ; finish the job music_stop's own call,
                                      ; a moment ago, may have deliberately
                                      ; skipped
    .endif
  ```

  Sting's own equivalent fix (`music_stop`'s existing `.if STING_ENABLED: sta sting_left`) is
  **correctly left in `music_stop` unchanged** — this is not an inconsistency, it is the asymmetry
  §1's own revised text now states: Sting *does* shadow "what's playing," so any request for
  something else — Silence included — is legitimately a cancellation, the same reasoning `music_
  play`'s own cancellation check already applies uniformly to every non-repeat song request. SFX
  shadows nothing, so it has no analogous reason to care what the music does around it.

**The restored `music_tick` sketch (fix round 2, finding 5 — round 1's revision described this
routine in prose only; §5.2 pointed at "§3.3's full sketch," but no such sketch existed anywhere in
the document).** The complete conditional-assembly body, both `SFX_ENABLED` states:

```asm
music_tick:
  .if SFX_ENABLED
  lda mus_enabled
  ora sfx_state
  .else
  lda mus_enabled
  .endif
  beq music_tick_done
  ldx #0
music_tick_loop:
  .if SFX_ENABLED
  cpx #SFX_CHANNEL
  bne music_tick_normal
  lda sfx_state
  beq music_tick_normal        ; not stolen right now -- this index's own
                                ; song channel ticks normally below
  jsr sfx_channel_tick
  jmp music_tick_next
music_tick_normal:
  lda mus_enabled
  beq music_tick_next          ; Silence -- do not run this channel's normal
                                ; logic against a stopped song's stale state
  .endif
  jsr music_channel
music_tick_next:
  inx
  cpx #MUS_CHANNELS
  bne music_tick_loop
music_tick_done:
  rts
```

Traced against all four `(mus_enabled, sfx_state)` combinations, as the review's own required-next-
round instruction asks: **(nonzero, 0)** — the SFX branch is never taken (`beq music_tick_normal`),
every channel ticks exactly as today via the unconditional `jsr music_channel`, two extra
always-taken branches per channel (priced in §8) but byte-for-byte the same audible result. **(nonzero,
1 or 2)** — `SFX_CHANNEL` routes to `sfx_channel_tick` (which, per finding 1's fix above, may itself
tail into `music_channel` for that same index on the cleanup frame), the other three channels tick
normally. **(0, 1 or 2)** — the case finding 2 exists for: the top-level gate passes on `ora sfx_
state`, `SFX_CHANNEL` is serviced regardless of `mus_enabled`, and the other three channels are
correctly *skipped* (not merely left silent) by the in-loop `lda mus_enabled / beq music_tick_next`
re-check, so none of them replay stale `mus_ptr_lo/hi` left over from a song that has since stopped.
**(0, 0)** — identical to today, one instruction earlier exit. `SFX_ENABLED = 0` collapses the `.if`/
`.else` at entry and removes the entire in-loop `.if SFX_ENABLED ... .endif` block (including the
`music_tick_normal` label and its own `mus_enabled` re-check), leaving exactly today's 8-instruction
body — `lda mus_enabled / beq music_tick_done / ldx #0 / music_tick_loop: jsr music_channel / inx /
cpx #MUS_CHANNELS / bne music_tick_loop / music_tick_done: rts` — byte-for-byte, confirmed by reading
the collapsed structure directly rather than assumed.

**Recount, from this exact final body** (finding 5's own instruction) — unchanged from round 1's own
figure of 22, since restoring the sketch to the document did not change what it says, only whether the
document actually says it:

| piece | bytes | basis |
|---|---|---|
| entry check (`ora sfx_state` added over plain `lda mus_enabled`) | +3 | `ora abs` (`sfx_state` lives at `$0300+`) |
| in-loop SFX-channel branch | 15 | `cpx #SFX_CHANNEL`(2)+`bne`(2)+`lda sfx_state`(3, abs)+`beq`(2)+`jsr sfx_channel_tick`(3)+`jmp music_tick_next`(3) |
| in-loop normal-channel `mus_enabled` re-check | 4 | `lda mus_enabled`(2, zp)+`beq music_tick_next`(2) |
| **`music_tick` restructuring subtotal** | **22** | 3 + 15 + 4, `.if SFX_ENABLED`-gated |

### §3.4 Sting × SFX interaction — every ordering, resolved (revised: the Silence-shadow branch and
both co-end orders, missing from round 1, are now traced explicitly)

Both `sting_left` and `sfx_state`/`sfx_left` are independent state over **disjoint RAM**: Sting's own
`mus_ptr_lo..mus_note` shadow/restore touches only the `mus_*` arrays and `cur_song`/`mus_enabled`;
SFX's own state (`sfx_ptr_lo/hi`, `sfx_dur`, `sfx_note`, `sfx_trig`, `sfx_state`, `sfx_left`, `sfx_
volume`) is never read or written by anything in `music.asm`'s Sting code, and vice versa — the two
guards §3.3 just added (`sting_restore_silence`, `music_stop`) are the only points of contact, and
both are ownership checks, never state mutation of the other feature's own bytes. That disjointness
is what makes every ordering below resolve with those two guards and nothing more — traced
explicitly, not assumed, per the brief's own instruction not to leave any case implicit:

- **SFX starts while a Sting is already playing (audible).** Unchanged from round 1's own tracing:
  the sting's own noise-channel `mus_*` state simply stops advancing for the steal's duration — no
  new code.
- **A Sting starts while an SFX is mid-flight.** Unchanged from round 1: `sting_snapshot` captures
  the paused field-song state correctly (SFX never writes `mus_*`); `music_play(stingIndex)`
  overwrites it with the sting's own fresh state, harmlessly, since nothing reads it while `sfx_state
  != 0`. Named cost, not a bug: the sting's noise part starts on its own once SFX hands back, a brief
  phase offset relative to its other three channels.
- **SFX ends first (state 2's own cleanup runs, sting still active).** `sfx_channel_tick`'s cleanup
  reads `mus_enabled` (true — a sting is audible), sets `force_trig,SFX_CHANNEL`, and — **corrected
  this round (fix round 3, finding 2): tail-calls `music_channel` for that same `SFX_CHANNEL` index
  during this exact cleanup tick**, per round 2's own `jmp music_channel` fix (§3.3, finding 1), not
  a *later* ordinary loop visit. Round 2's own text here still said "the *next* ordinary
  `music_channel` call" — a documentation error left over from before that fix, corrected now: the
  sting's own noise part resumes from where `music_play` first parked it on the *same* frame SFX's
  cleanup runs, not one frame later. No dropout, no new code beyond §3.3's own state machine.
- **Sting ends first into an audible song, SFX still active.** `sting_retrig_loop` sets
  `force_trig,x` for all four channels including `SFX_CHANNEL` — inert while `sfx_state != 0` (traced
  above), consumed correctly once SFX's own cleanup eventually hands back. No dropout.
- **Sting ends first into Silence, SFX still active (round 1's missing case).** `sting_restore_
  silence`'s new guard (finding 3, above) skips the `$400C` write this frame, so the SFX's own
  currently-sounding note survives untouched; `mus_enabled` is now 0. When SFX's own cleanup phase
  runs (state 2, on whichever later frame `sfx_left` actually reaches zero), it correctly reads the
  now-Silence `mus_enabled` and writes `$400C = $30` itself — the channel is silenced exactly once,
  at the correct moment, never left ringing and never dropped early.
- **Exact co-end: both `sting_left` and `sfx_left` reach their own end on the identical frame —
  honest contract corrected this round (fix round 3, finding 2).** `music_tick` (and therefore
  `sfx_channel_tick`, if `sfx_state` was 1 entering this frame) always runs before `sting_tick`
  (`engine/boot.asm`'s own fixed order). If this is SFX's *own* last playing frame, `sfx_apply` writes
  the real final note first, `sfx_state` becomes 2 — then, later the same frame, `sting_tick`/
  `sting_restore` runs. If the sting restores into an audible song, `sting_retrig_loop`'s write is
  inert as already traced, no issue. **If instead this frame is SFX's *cleanup* frame (`sfx_state` was
  already 2 entering it) and the sting *also* restores into Silence on this identical frame, the
  `$400C` write `sfx_channel_tick`'s own tail-call into `music_channel` just made — retriggering the
  sting's own paused noise content — is immediately overwritten by `sting_restore_silence`'s
  unconditional `$400C = $30` later the same frame, because `sfx_channel_tick`'s cleanup already
  reset `sfx_state` to 0 *before* `sting_tick` runs, so the guard correctly does not suppress this
  write (§3.3's own reasoning: "the guard never suppresses a needed silence write, only a premature
  one" — and by this point in the frame, the write genuinely is needed, since the sting really is
  ending into Silence).** The retriggered sting content is therefore **truncated to the interval
  before the second write, rather than receiving its authored full frame** (corrected wording, fix
  round 4 finding 3 — the register's value is real for the CPU cycles between the two writes, but
  that is not a full video/audio frame and may amount to only a very short transient, not simply
  "never heard") — a real, same-frame truncation of the sting's own genuinely-final note.

  **This is inherited Sting behavior, not a regression this design introduces, and is deliberately
  left unfixed rather than silently expanding this design's own scope to repair it.** Traced without
  SFX in the picture at all: on an *ordinary* sting-ends-into-Silence frame (no SFX involved),
  `music_tick`'s own normal per-channel loop already applies the sting's true final note to `$400C`,
  and `sting_tick`/`sting_restore_silence` — running later the *same* frame, per the identical
  `music_tick`-before-`sting_tick` order — already overwrites it with `$30` before that note ever
  receives its authored full frame: **the final note is truncated to the interval before the second
  write, rather than receiving its authored full frame**, immediate register semantics being what
  they are (the first value takes effect for the CPU cycles before the overwrite, it simply does not
  survive to be heard as a full frame). SFX's own hand-back mechanism does not create a new failure
  mode here;
  it exercises a pre-existing one, on the one narrow frame where SFX's own cleanup-phase retrigger
  happens to be the write that gets overwritten instead of an ordinary per-tick one. **The tree's own
  comment on this ordering (`engine/music.asm:440-444`, "the reverse order would run `sting_restore`
  before this frame's `music_tick`, so the resumed song would play one frame early and the sting's own
  final frame of audio would be silently dropped") over-claims what the ordering actually guarantees**
  — it correctly prevents a *premature* resume (resuming before that frame's sting audio was ever
  applied at all), but does not, and was never asked to, guarantee that a sting ending into Silence
  gets an audibly-heard final frame; `sting_restore_silence`'s own unconditional overwrite the same
  frame already defeats that regardless of SFX. Named here as a pre-existing, out-of-scope
  observation — the identical treatment §3.9 already gives `renumberSongDeletion`'s own gap — for a
  reviewer to decide whether it deserves its own, separate Sting-side fix ticket; this design does not
  price or build one.

  **The honest, narrowed contract this design actually holds to, stated once so §3.4's own conclusion
  and test 8's own pinned APU sequence say exactly the same thing:** SFX's own final playing frame is
  never dropped or truncated by anything in this design (§3.3's own two-phase state machine and both
  ownership guards exist precisely to hold this). What is *not* guaranteed, inherited from Sting and
  unrelated to SFX, is that a sting's own final frame survives being audibly heard when the sting
  itself ends into Silence on the exact same frame SFX's own cleanup hands the channel back to it —
  that one narrow case can still truncate the *sting's* content, never the SFX's own. If instead the
  sting restores into an audible song on this identical frame (not Silence), `sting_retrig_loop`'s own
  write is inert as already traced and no truncation occurs at all. Every other case traced above —
  SFX ending first, Sting ending first into either an audible song or Silence on a frame SFX is *not*
  simultaneously finishing on, and ordinary (non-co-end) hand-offs in both directions — resolves with
  no drop, exactly as originally stated.
- **A `music_play` for a different song lands while both are active.** Unchanged in mechanism from
  round 1 (Sting is cancelled by `music_play`'s own existing check, `SFX_CHANNEL`'s `mus_*` state is
  overwritten harmlessly), but now explicitly including the **Silence** variant per finding 4: a
  request for Silence reaches `music_stop`, whose own new ownership guard (above) protects an active
  SFX exactly as an ordinary Play-Silence already does. **SFX itself still needs no cancellation
  check in `music_play` at all** — see §3.5/§3.6 for why, unchanged from round 1's own reasoning
  (SFX shadows nothing "that would never come back").
- **A second SFX fires while the first is still stealing the channel.** Unchanged from round 1:
  replaces outright, no guard needed, since SFX never snapshots anything. `script_op_sfx` (§5.3) now
  also re-arms `sfx_state = 1` unconditionally as part of that replacement.
- **An actual new session (game over, fresh boot, a loaded Continue) while an SFX is active.**
  Newly named this round, per finding 4's own resolved policy: `init_session`'s new block (above)
  is the one and only path that cancels an in-flight SFX outright — clearing `sfx_state`/`sfx_left`
  and force-silencing `$400C`, regardless of whatever `music_stop`'s own call, a moment earlier
  within the same `init_session`, may have deliberately left alone.

### §3.5 Gating composition — a derived flag, verified against the alternative

The one genuinely shared piece of code is the `force_trig` check-and-self-clear inside
`music_channel` (`engine/music.asm:154-167`) — both Sting's hand-back (`sting_restore`'s retrigger
loop) and SFX's own hand-back (`sfx_channel_tick`'s completion write, §5) write into the *same* array
through the *same* checked-and-cleared mechanism, and it must assemble whenever *either* feature is
live, exactly once, never duplicated.

**Two live options, both checked, not merely the first one reached for:**

1. **An OR'd `.if` directly in the `.asm`**: `.if STING_ENABLED | SFX_ENABLED`. Confirmed to actually
   work in this nesasm dialect (§2's scratch test) — this was not assumed.
2. **A generator-emitted derived flag**, `AUDIO_FX_ENABLED`, computed once in JS and written into
   `config.inc` the same way `PALETTE_FX_ENABLED` (`= usesFade ? 1 : 0` — actually `usesPaletteFx`,
   itself `projectUsesFade(project) || projectUsesFlash(project)`) and `FACE_ENABLED`
   (`projectUsesMove(project) || projectUsesTurn(project)`) already are, in `main/build/generate.js`.

**Chosen: option 2, the generator-emitted flag**, and not merely because the brief's own "if in
doubt" clause points there — this codebase has exactly this shape solved twice already
(`PALETTE_FX_ENABLED`, `FACE_ENABLED`), and both times the composed condition needed a *name*, not
just a working boolean: `kernelCodeBytes`, `kernelShortfallAdvice`, and the `.asm` gate all need to
agree on what "either feature wants this code" means, and a name in exactly one place (`shared/
project.js`, imported everywhere else re-exports its siblings from) is what keeps them agreeing. An
inline `.if STING_ENABLED | SFX_ENABLED` would work in `music.asm`, but it puts the composition rule
in a third place (the `.asm` file) that `kernelCodeBytes`/`kernelShortfallAdvice` (JS) would still
need their own, independently-written copy of to charge the dependent term correctly — exactly the
drift this codebase's single-writer rule exists to prevent. Verifying the OR syntax actually works
was still worth doing: it rules out "we have no choice but the generator flag" as the reason, leaving
the real reason (single-writer) as the one actually driving the decision.

```js
// shared/project.js, beside projectUsesPaletteFx/projectUsesFace
export function projectUsesAudioFx(project) {
  return projectUsesSting(project) || projectUsesSfx(project);
}
```

```
// main/build/generate.js's config.inc emission, beside PALETTE_FX_ENABLED/FACE_ENABLED
`AUDIO_FX_ENABLED = ${usesAudioFx ? 1 : 0}`,
```

`engine/music.asm`'s one-line diff: the `force_trig` check block inside `music_channel`
(`engine/music.asm:154-167`) changes its guard from `.if STING_ENABLED` to `.if AUDIO_FX_ENABLED`.
**Nothing else in the shipped Sting code changes** — `sting_snapshot`, `sting_restore`, `sting_tick`,
`script_op_sting`, `music_play`'s cancellation check, and `music_stop`'s `sting_left` clear all stay
gated `.if STING_ENABLED` exactly as shipped (§3.6 explains why the latter two do *not* need to
become shared, contrary to what the costing's Part 2 assumed).

The `force_trig` array's own comment in `engine/constants.asm:576-582` (currently "the shared
retrigger array `force_trig` also uses... one per channel, self-clearing on use") gets a small
update: it is shared by *two* features now, not described as Sting's alone, and the comment's own
"See design-sting.md §6" pointer gains "and design-sfx.md §3.5" beside it.

### §3.6 Allowance restructuring — what is actually shared, corrected against §3.4/§3.5

The costing's Part 2 priced *both* the `force_trig` mechanism *and* the `music_play`/`music_stop`
pair as things shape (a) would need its "own copy" of, mirroring shape (b)'s. Tracing the real
interaction matrix (§3.4) shows this was an overcount for shape (a) specifically:

- **`force_trig` (array + check-and-clear): genuinely shared.** Both features write into it and both
  need the check-and-clear code to exist. This is the one dependent term, and it is *already paid
  for* — `STING_KERNEL_ALLOWANCE` (175, measured) already includes it. Re-gating it under
  `AUDIO_FX_ENABLED` does not change its size; it changes *when* it assembles. **A project with a
  live Sting and no live SFX must still pay exactly 175 for `STING_KERNEL_ALLOWANCE`** — the re-gate
  is a no-op for that project, because `AUDIO_FX_ENABLED` is already 1 whenever `STING_ENABLED` is,
  by construction of the OR. This needs an explicit **re-measurement**, not an assumption: `nesasm`
  must confirm the re-gated build produces byte-identical kernel-lo output to today's `STING_ENABLED`
  gate for a Sting-only project (Test plan, §7).
- **`music_play`'s cancellation check: NOT shared — SFX does not need it at all.** Sting needs it
  because `cur_song` is a *shadow of what the sting itself borrowed*, and a request for a genuinely
  different song while stinging "is, by definition, a request for something other than the sting
  itself" (the shipped code's own comment) — the shadow would otherwise point at a song "that would
  never come back." SFX shadows nothing: `sfx_left`/`sfx_ptr_lo/hi`/etc. never reference `cur_song`
  or anything about which song is playing. §3.4 already traced that a different-song `music_play`
  landing mid-SFX is harmless without any cancellation code — the SFX simply finishes over whatever
  the new song's noise channel becomes. Building an unnecessary cancellation check would be pure
  waste on a bank this tight. **Zero bytes, by design, not by omission.**
- **`music_stop`'s sting-state clear: NOT shared, and SFX's own session-boundary clear does NOT
  live in `music_stop` either — revised this round, finding 4.** Round 1 put an `.if SFX_ENABLED:
  sta sfx_left` inside `music_stop`, on the (wrong — §3.3, finding 4) assumption that `music_stop`
  only ever runs at a session boundary. It does not: `music_play`'s own `cmp #NO_SONG / beq music_
  stop` means every ordinary Play-Silence and every map-to-Silence transition reaches it too, so an
  unconditional clear there would cancel an in-flight SFX on a completely ordinary "fade to
  silence," not merely a real session reset. §3.3's revised fix instead (a) makes `music_stop`'s own
  *existing* `$400C` stamp ownership-aware (skip it while `sfx_state != 0`, so an ordinary Silence
  request no longer clobbers an active SFX at all — the opposite problem from what round 1 worried
  about, and the one actually present in the tree) and (b) moves the real session-boundary clear
  into `init_session` itself (`engine/combat.asm`), the one call site that is genuinely
  session-scoped. See §3.3 for both diffs in full; nothing further changes here.
- **`sting_restore_silence`'s own ownership guard (§3.3, finding 3): NOT SFX-standalone code — a
  genuine both-live interaction term, corrected this round (fix round 3, finding 1).** Every prior
  round classified this 5-byte guard (`ldy sfx_state / bne skip`) as part of `SFX_ENABLED`-only code,
  and §8's own rollup summed it straight into the 288-byte SFX total. That classification does not
  survive reading where the guard actually lives: `sting_restore_silence` sits entirely inside the
  shipped outer `.if STING_ENABLED` block (`engine/music.asm:376-454`), so the guard — nested
  `.if SFX_ENABLED` inside that already-conditional routine — can only ever assemble when **both**
  `STING_ENABLED` and `SFX_ENABLED` are true. A project with a live SFX and no live Sting never
  assembles `sting_restore_silence` at all, so it never pays these 5 bytes; a project with a live
  Sting and no live SFX pays for the routine but not this guard. Neither of the two single-feature
  cases can be charged for it — only the combination can. This is not a naming quibble: it changes
  what `kernelShortfallAdvice` must report when both are live and Sting is dropped (below).

**New/renamed allowance terms** (all pre-implementation estimates; see §7 for how each becomes
measured) — **now three, not two, per this round's own correction:**

| term | scope | estimate | notes |
|---|---|---|---|
| `SFX_KERNEL_ALLOWANCE_STANDALONE` | `SFX_ENABLED`-only code, **excluding** the `sting_restore_silence` guard: §3.3's restructured `music_tick`, `script_op_sfx` (including its `sfx_state`/`$4015` writes, finding 2), the two-phase `sfx_channel_tick` (including fix round 2's own tail-call fix, finding 1), `sfx_read_event`, `sfx_apply`, the `script_run` dispatch entry, `music_stop`'s own ownership guard (this one genuinely is SFX-only — `music_stop` assembles unconditionally, with or without Sting), and `init_session`'s new session-boundary clear | **283** — 288 minus the 5-byte guard this round's finding 1 reclassifies below; see §8 | the SFX-specific term, mirroring `STING_KERNEL_ALLOWANCE_STANDALONE`'s own shape |
| `AUDIO_FX_KERNEL_ALLOWANCE` | `force_trig` array + check-and-clear, now gated `AUDIO_FX_ENABLED` | **≈15 bytes, decomposed from the existing Sting cost; zero *net-new* bytes in a Sting-only build** — the term itself is not zero (fix round 4, finding 1: this cell previously said "0 new bytes," which reads as assigning zero to a term §5.1's own formula charges ≈15 for; the true net-zero claim is narrower — a Sting-only project's own total does not change when this block is re-gated, because it was already paying for this code) | `STING_KERNEL_ALLOWANCE` (175) is **unchanged** as a number; what changes is that its own 175 no longer includes this piece as Sting-exclusive-forever — see below |
| `STING_SFX_INTERACTION_ALLOWANCE` (new this round) | `sting_restore_silence`'s own ownership guard — real code, but reachable only when `STING_ENABLED` **and** `SFX_ENABLED` are both true | **5** — `ldy sfx_state`(3, abs)+`bne sting_restore_silence_skip_noise`(2) | gated `usesSting && usesSfx ? STING_SFX_INTERACTION_ALLOWANCE : 0` in `kernelCodeBytes` (§5.1) — a project with only one of the two features live pays 0 |

**`STING_KERNEL_ALLOWANCE` itself does not change its number, but its own comment must change what
it claims.** Today's comment (`main/build/generate.js:622-643`) describes `force_trig`'s check as
part of what the 175 pays for, correctly, for a project with no SFX ever shipped. Once `SFX_ENABLED`
exists, a Sting-only project still measures 175 (the re-gate is a no-op for it, per above) — but a
project with **both** a live Sting and a live SFX must not be charged `force_trig`'s own cost twice.
This is exactly the shape `kernelCodeBytes` already handles correctly for `PALETTE_FX_KERNEL_
ALLOWANCE` (Fade/Flash) and `FACE_KERNEL_ALLOWANCE` (Move/Turn): a **separate, dependent term**,
charged once regardless of how many of the features sharing it are live, via the `usesAudioFx ?
AUDIO_FX_KERNEL_ALLOWANCE : 0` shape in `kernelCodeBytes` (not folded into either
`STING_KERNEL_ALLOWANCE` or `SFX_KERNEL_ALLOWANCE` — see §5.1 for the exact `kernelCodeBytes` diff).
Because this piece is a **re-gate of unchanged code**, `AUDIO_FX_KERNEL_ALLOWANCE`'s own value is
whatever `force_trig`'s check-and-clear already costs inside `STING_KERNEL_ALLOWANCE`'s current 175
— **not a new measurement of new code**, but a **decomposition** of an existing one, the identical
move `MOVE_KERNEL_ALLOWANCE` → `MOVE_KERNEL_ALLOWANCE` + `FACE_KERNEL_ALLOWANCE` already made (Move
395 = 379 + Face's own 16), preserving the measured total. Concretely: `STING_KERNEL_ALLOWANCE`
becomes `STING_KERNEL_ALLOWANCE_STANDALONE` (the Sting-only code minus `force_trig`'s own piece) +
`AUDIO_FX_KERNEL_ALLOWANCE` (the `force_trig` piece, shared), summing to the *same* 175 a Sting-only
project has always measured. The exact byte split between the two halves is not estimated here —
it must be **measured directly** (nesasm's own symbol table span for `music_channel`'s `force_trig`
block, the identical `game.fns` technique `BOUND_TILE_KERNEL_ALLOWANCE`'s own correction used) rather
than guessed and later found wrong the way that allowance's own history already was once. Test plan
item 2 (§7) is exactly this measurement.

**What `kernelShortfallAdvice` must report for the dependent combinations — three terms compose now,
not two, and the mechanism already handles it correctly with zero new code, confirmed rather than
merely asserted.** A project with both a live Sting and a live SFX, over budget by more than either
term alone frees, must be told that dropping **both** together frees `SFX_KERNEL_ALLOWANCE_
STANDALONE + STING_KERNEL_ALLOWANCE_STANDALONE + AUDIO_FX_KERNEL_ALLOWANCE + STING_SFX_
INTERACTION_ALLOWANCE` (the shared term freed once, the interaction term freed once, neither missed
nor double-counted) — the `STING`+split-lock 175+19 shape extended by one more dependent term, not
two independent ones summed by hand.

**The behaviorally significant case this round's finding 1 actually turns on: dropping *only* Sting
while SFX stays live.** With both features live, removing every live Sting command must free
`STING_KERNEL_ALLOWANCE_STANDALONE` **and** `STING_SFX_INTERACTION_ALLOWANCE` together (the guard
goes with the routine it lives inside), but **not** `AUDIO_FX_KERNEL_ALLOWANCE` — SFX is still live,
so `force_trig`'s own shared check-and-clear still has to assemble. This is exactly the shape
`kernelShortfallAdvice` already gets right for Move/Turn's shared `FACE_KERNEL_ALLOWANCE` (dropping
Move alone frees Move's own term plus Face's, only if Turn is not also live) — confirmed by
re-reading `kernelCodeBytes`'s own formula (§5.1) rather than assumed: `usesSting &&
usesSfx ? STING_SFX_INTERACTION_ALLOWANCE : 0` recomputes fresh from `projectWithoutCommands(p,
['sting'])`'s own stripped clone, where `usesSting` is now false — the interaction term's own `&&`
evaluates false regardless of what `usesSfx` still is, so it drops out of the recomputed total
automatically, with no special case written anywhere. This requires **no new code in
`kernelShortfallAdvice` itself** — the same reasoning CLAUDE.md's own passage on this function
already gives, and the same reasoning this design already gave for the two-term case in every prior
round, now confirmed to extend to three terms without modification: it asks `kernelCodeBytes` what a
stripped clone would actually cost, rather than summing flat constants by hand, so an added
dependent term already composes correctly through `projectWithoutCommands` + `kernelCodeBytes` with
zero special-casing (§5.1's `active` list is unchanged by this finding — it already lists Sting and
SFX as two independent strippable features, and stripping either one already recomputes the whole
total including every dependent term correctly).

### §3.7 The command — wire format, `EVENT_COMMANDS` placement

`[OP_SFX, id, duration]` — id is the compiler-resolved index into `project.sfx`, duration is the
compiler-computed total length in frames (`sfxFrameLength`, capped the same way Sting's own duration
is: `Math.min(sfxFrameLength(project.sfx[id]), 255)`), never authored directly, so it can never drift
from the effect it names — the identical "single-writer duration" argument `Sting`'s own comment
already makes, applied here.

**`EVENT_COMMANDS` insertion — immediately before the virtual tail, per the routes ordinal rule**
(`shared/project.js`'s own catalog-invariant comment, `design-routes.md` §3.0): `route` is currently
the array's last entry and the catalog's sole `virtual: true` member. `sfx` is a **real**,
`OP_*`-backed entry, so it is inserted immediately after `sting` (the current last real entry) and
immediately before `route`:

```js
  { id: 'sting', label: 'Sound sting', args: ['song'] },
  // [id, duration in frames]. A short, fixed-volume, single-channel burst on a
  // dedicated stolen channel (SFX_CHANNEL, engine/constants.asm) -- the running
  // song's other three channels, or a live Sting, continue completely untouched.
  // Duration is never authored: the compiler measures the effect's own total
  // length (sfxFrameLength, shared/audio.js) and bakes it in, the identical
  // single-writer shape Sting's own duration operand already has. Does not
  // suspend the script, the same instant shape Turn/Shake/Visible/Flash/Sting
  // already share. See design-sfx.md for the full design.
  { id: 'sfx', label: 'Play a sound effect', args: ['sfx'] },
  { id: 'route', label: 'Follow a route', args: ['route'], nests: true, virtual: true }
```

`opIndex('sfx')` becomes 27 (`$1B`), one past `OP_STING` ($1A). `opIndex('route')`, if anything ever
computed it, becomes 28 — nothing does, per `route`'s own `virtual: true` design, unaffected. The
existing ordinal test (`test/unit/project.test.js`, `'EVENT_COMMANDS: every real-opcode entry keeps
its engine constant value; the virtual tail is contiguous and last'`) needs its own hardcoded
`OP_*`-value table extended with `sfx: 0x1b` — the exact mechanism that test exists for: it fails
loudly, by name, the moment an insertion lands in the wrong place, rather than merely being "unsafe."

`engine/constants.asm`'s `OP_*` block gains, immediately after `OP_STING`:

```asm
OP_SFX      = $1B           ; [id, duration in frames] -- see design-sfx.md.
                             ; Non-suspending, the same instant shape OP_STING
                             ; is (script_op_sting does not suspend either).
```

`engine/script.asm`'s dispatch chain gains one more link, in the identical shape every prior one
already has, before the final `script_run_bad` fallthrough:

```asm
script_run_sting:
  .if STING_ENABLED
  cmp #OP_STING
  bne script_run_sfx
  jmp script_op_sting
  .endif
script_run_sfx:
  .if SFX_ENABLED
  cmp #OP_SFX
  bne script_run_bad
  jmp script_op_sfx
  .endif
script_run_bad:
  jmp script_finish
```

(`script_run_sting`'s own `bne` target changes from `script_run_bad` to the new `script_run_sfx`
label — a one-line diff to already-shipped code, the identical shape every prior verb's own insertion
into this chain has already made to the link before it.)

### §3.8 Predicate and gating

```js
// shared/project.js, beside projectUsesSting
export function projectUsesSfx(project) {
  for (const event of projectEvents(project)) {
    for (const page of compiledPages(event)) {
      for (const command of liveCommands(page.commands, CHOICE_LIMITS.options)) {
        if (command.op === 'sfx') return true;
      }
    }
  }
  return false;
}
```

Byte-for-byte the same shape as `projectUsesSting`. **Corrected this round (finding 9): `sfx` is
found through branch/choice recursion, never through a route's own legs.** Round 1 claimed
`liveCommands` "already yields an `sfx`-op command wherever it sits, including inside a route's own
legs" — false, checked directly against `shared/eventrules.js:26-39`: `ROUTE_LEG_OPS` is exactly
`{move, turn, wait}`, and `routeLegs` filters every route's own `.legs` array through it before
`liveCommands`' own route branch recurses — an `sfx` command sitting in a raw route leg is not an
admitted leg at all. It is dropped identically by normalization (never stored) and by compilation
(`routeLegs` filters again inside the compiler's own `'route'` case, `design-routes.md` §3.3), so an
illegally-placed `sfx` leg can never make `SFX_ENABLED` disagree with what the ROM actually contains
— it simply never counts, on either side, which is the property that matters. `liveCommands`' generic
recursion into a `branch`'s `then`/`else` and a `choice`'s own options **does** find an `sfx` command
correctly wherever it is legally reachable — the same two containers `projectUsesSting` already
relies on, unmodified. Drives `SFX_ENABLED` in `config.inc`, the same emission shape every other verb
already has.

**The whole-ROM identity promise, narrowed and made honest (fix round 2, finding 4).** A project
with **no authored effects at all and no live `sfx` command** assembles byte-for-byte identical to
today — kernel-lo *and* kernel-hi both, verified the `move.test.js` whole-ROM-comparison way (§7).
**This is narrower than round 1's own claim**, which said "no live SFX command" with no qualifier
about `project.sfx` itself, and is false as stated: §3.10's own unconditional `sfxTables(project.sfx)`
emission (kept, this round, over the alternative of gating it — see §3.10 for why) means a project
that has authored one or more effects in the Sound Forge but never referenced any of them from a
live command still pays real kernel-hi bytes for those effects, with `SFX_ENABLED` staying 0 the
whole time. This is not a defect to fix — it is the **identical, pre-existing behavior
`songTables(project.songs)` already has** for an authored-but-unreferenced song, not a new cost SFX
introduces — but round 1's own promise did not say so, and needed to.

### §3.9 Authoring surface (revised this round — finding 7 closes every gap named: normalization
default, editor selector/context, over-cap refusal/Add-button gating, the `LIMITS.sfxSteps`
cycle, and the note range/zero-step contradictions already fixed in §3.2)

**A new top-level list, `project.sfx`, beside `project.songs`** — not nested under songs, because an
SFX is not a song variant; it has its own format, its own list, its own Sound Forge tab. Shape,
**note now canonically 0-15** (§3.2):

```js
{ name: string, volume: 0-15, steps: [{ note: 0-15 | null, duration: 1-255 }, ...] }
```

`LIMITS` (`shared/project.js`) gains **one** entry now, not two — `sfxSteps` moved to `shared/
audio.js` as `SFX_MAX_STEPS` (§3.2), to avoid the import cycle round 1 did not resolve
(`shared/project.js` already imports *from* `shared/audio.js`; the reverse would be one):

```js
sfx: NO_SFX,        // ids 0..$FE, same shape as actors/items/metasprites -- NO_SFX
                     // is a byte in this space too, so the cap IS the sentinel's
                     // own value, never a bare 255 that could drift from it
sfxSteps: SFX_MAX_STEPS   // re-exported from shared/audio.js for display/UI
                            // purposes only -- shared/audio.js is the single
                            // writer (§3.2), this is an alias, not a second
                            // definition
```

`shared/project.js`'s existing import from `shared/audio.js` (line 9) gains `NO_SFX`, `sfxByte`,
`sfxFrameLength`, `normalizeSfx`, `SFX_MAX_STEPS`.

`normalizeProject` gains, beside the existing `songs:` line:

```js
sfx: (Array.isArray(raw.sfx) ? raw.sfx : []).map((entry, index) =>
  normalizeSfx(entry, `Effect ${index}`)
),
```

**`normalizeEventCommand` needs its own explicit `arg === 'sfx'` case — closing the gap round 1 left
open (finding 7).** `shared/project.js:1741-1889`'s existing per-arg dispatch has a real, checked
precedent for exactly this shape at `arg === 'song'` (line 1783): `out.song = raw?.song === null ||
raw?.song === undefined ? null : clamp(raw?.song, 0, 255, 0)` — nullable, because "never chosen" and
"song 0" must stay distinguishable, the same reason `arg === 'item'` (`defaultCommand`'s own comment,
below) does not default to item 0 either. Without an explicit case, an unrecognised `arg` falls
through to nothing in the normalizer (the generic clamp path other numeric args use does not apply to
new `arg` strings it has never seen), and — the concrete failure the review named — the *editor's*
own `defaultCommand` (below) falls all the way to its own generic `else out[arg] = 0`, silently
handing a freshly placed command a real, plausible-looking reference to effect 0 that nobody chose.
Mirroring `song` exactly:

```js
else if (arg === 'sfx') out.sfx = raw?.sfx === null || raw?.sfx === undefined ? null : clamp(raw?.sfx, 0, 255, 0);
```

**`validateProject`** gains two blocks, not one — the missing/overlong check round 1 already had, and
the over-cap catalog check round 1 named in `LIMITS.sfx` but never actually enforced (finding 7).
Missing/overlong mirrors the Sting block exactly, for the identical author-facing reason: a live
command promising to play a specific effect at a specific moment is a promise the ROM must be able to
keep, checked at build time rather than silently swallowed at runtime — the same policy Give/Take/
Call/Sting already hold to.

```js
let missingSfx = 0;
let overlongSfx = 0;
for (const event of projectEvents(project)) {
  for (const page of compiledPages(event)) {
    for (const command of liveCommands(page.commands, CHOICE_LIMITS.options)) {
      if (command.op !== 'sfx') continue;
      const sfxIndex = sfxByte(project.sfx, command.sfx);
      if (sfxIndex === NO_SFX) missingSfx++;
      else if (sfxFrameLength(project.sfx[sfxIndex]) > 255) overlongSfx++;
    }
  }
}
// ...same add('error', 'Map Forge', ...) shape as the Sting block, naming
// "Play a sound effect" instead of "Sound sting".
```

The over-cap check mirrors `project.items.length > LIMITS.items`'s own existing block
(`shared/project.js:3582-3589`) exactly — a project holding more effects than `LIMITS.sfx` allows
(hand-edited, or authored by a later version) is refused with a named, actionable count, not silently
truncated:

```js
if (project.sfx.length > LIMITS.sfx) {
  add(
    'error',
    'Sound Forge',
    `This project has ${project.sfx.length} sound effects but the Forge holds ${LIMITS.sfx} ` +
      `(ids 0-${LIMITS.sfx - 1}) — id $FF is reserved to mean "no effect". Delete ` +
      `${project.sfx.length - LIMITS.sfx} of them before this can build.`
  );
}
```

**`renumberSfxDeletion(project, index)`**, a new function mirroring `renumberSongDeletion`'s own
shape exactly, walking `allCommands` (not `liveCommands` — the identical reasoning every other
renumberer in this file already gives: a switched-off command's reference must still track a
deletion, so a switch back on does not silently point at the wrong effect):

```js
export function renumberSfxDeletion(project, index) {
  for (const event of projectEvents(project)) {
    for (const page of event.pages ?? []) {
      for (const command of allCommands(page.commands)) {
        if (command.op !== 'sfx') continue;
        if (command.sfx === index) command.sfx = null;
        else if (command.sfx > index) command.sfx -= 1;
      }
    }
  }
  return project;
}
```

*Aside, out of scope for this design but worth flagging rather than silently reproducing*:
`renumberSongDeletion` (`shared/project.js:1118-1133`) walks `command.op === 'music'` only — it does
**not** renumber a `Sting` command's own `song` field on a song deletion, even though `sting`'s wire
shape also carries `args: ['song']`. This reads as a pre-existing gap unrelated to this design; the
function sketched above for `sfx` deliberately does not copy it (it is `command.op === 'sfx'` only,
against `project.sfx`, a wholly separate list from `project.songs`, so it cannot inherit the same
gap). Named here so a reviewer can decide whether it deserves its own, separate fix ticket.

**Map Forge command-row plumbing — the pieces round 1 asked for but never specified (finding 7):**

- `renderer/forges/map/events.js`'s `defaultCommand` (§ line 194-245) gains, beside the existing
  `arg === 'item'` case and for the identical reason: `else if (arg === 'sfx') out.sfx = null;` — a
  freshly placed `Play a sound effect` command starts as "no effect chosen," never effect 0.
- The command-row editor gains an SFX selector, mirroring the Sting selector
  (`renderer/forges/map/events.js:1541-1564`) almost exactly: the same `select`/`onchange` shape
  against `context.sfx` instead of `context.songs`, with the identical "Missing effect" option
  whenever the current value does not resolve (`command.sfx === null || command.sfx === undefined ||
  !effects[command.sfx]`) — Sting's own `callTargetMissing`-family reasoning, covering "never chosen"
  and "chosen, then deleted" identically. Unlike Sting's own song list (no Silence option — there is
  no silence-equivalent sting either), SFX's own list also has no Silence option, for the identical
  reason: naming nothing is refused by `validateProject`, not offered as a legitimate choice.
- `renderer/forges/map/map.js`'s `eventContext()` (line 633) gains `sfx: store.project.sfx ?? []`,
  beside the existing `songs: store.project.songs ?? []` — the selector above reads `context.sfx`,
  and without this the control has nothing to list.
- `describeCommand`'s own `'sfx'` case (§6) names the referenced effect, or "no effect chosen" —
  the same summary-line precedent Flash's own §8 already set, now also covering the missing-reference
  state the way Sting's own summary line does for a stale song.

**Sound Forge editor and Add-button gating** (`renderer/forges/sound/`): a new "Effects" tab/list
beside the existing song list (`sound.js`'s own `state.song`/`songs()` pattern extends to a parallel
`state.sfx`/`sfx()`), a compact ordered step editor rather than the existing 32-row pattern grid — an
SFX authors a handful of steps (`SFX_MAX_STEPS`, 8, an authoring limit, not a format one — see §3.2's
own corrected reasoning), not a multi-bar composition, so a step-add/remove/reorder list (each row: a
note picker restricted to the 16 noise-expressible values per §3.1, or "Rest"; a duration field) fits
the content better than reusing the tracker grid. One effect-wide volume slider (0-15), matching the
format's own single leading byte. Preview reuses the existing `Synth`
(`renderer/forges/sound/synth.js`) the same way song preview already does, driven by a small
`SfxReplayer` (§3.10) rather than the full multi-channel `Replayer`.

**Two independent Add-button gates, not one — closed this round (fix round 2, finding 6: round 1
gated only the effect count, leaving the per-effect step count with no editor-side guard at all, so a
live in-memory project could display or accept a ninth step that `compileSfx(normalizeSfx(...))`
would then silently truncate away).**

- The Effects list's own "Add effect" button is gated at `LIMITS.sfx`, mirroring the Items Forge's
  identical gate on its own Add button exactly (`renderer/forges/items/items.js:98-106`: `disabled:
  list.length >= LIMITS.items`, plus a message naming the ceiling and the reserved sentinel).
  Unchanged from round 1.
- **The per-effect step editor's own "Add step" control is gated at `SFX_MAX_STEPS` (`LIMITS.
  sfxSteps`, its re-exported alias) — new this round**: `disabled: currentEffect.steps.length >=
  LIMITS.sfxSteps`, the identical shape, with a message naming the ceiling directly rather than
  silently doing nothing on the eighth step's own Add press. This is what keeps the live, in-memory
  editor state from ever disagreeing with what `normalizeSfx`'s own truncation would produce on
  save/reload — an author sees the boundary in the UI rather than discovering it as steps that
  silently vanish after a reload.

`renumberSfxDeletion` is wired into the Effects list's own delete action, the identical wiring
`renumberSongDeletion` already has on the Song list's delete action.

### §3.10 Kernel-hi placement and capacity (revised this round — finding 8: the phantom bytes, the
gating decision, and the empty-table case are all resolved now, not deferred)

Compiled SFX streams are audio data, the same category compiled songs already are — they land in the
**same kernel-hi region**, folded into the same capacity check rather than opening a second one.
**Corrected sizing**: round 1's own `+4` per effect was never real — labels emit zero ROM bytes, and
the actual fixed overhead is exactly the one 2-byte pointer-table entry (`sfx_ptr_table_lo/hi`) each
emitted effect owns, **not** `musicSize`'s own `+3` (that figure is a real, physical `OP_LOOP` byte
plus a 2-byte loop address every song *channel* stream emits — SFX has no loop opcode at all, §3.2 —
so it is not analogous overhead to reuse here, just a coincidentally similar-looking constant):

```js
function sfxSize(sfxList) {
  const list = sfxList?.length ? sfxList : [];
  return list.reduce((total, sfx) => total + compileSfx(sfx).bytes.length + 2, 0);
  // +2: the one 2-byte sfx_ptr_table_lo/hi entry this effect owns. Nothing else.
}
```

**Table emission is gated by nothing but the list itself, deliberately not by `projectUsesSfx`/
`SFX_ENABLED` — kept this way this round (fix round 2, finding 4 offered two ways to resolve the
resulting promise gap: gate emission, or narrow the promise; this design keeps the *unconditional*
emission and narrows the promise instead, argued below rather than merely asserted).** This mirrors
`songTables(project.songs)`'s own existing, unconditional behavior exactly: every authored song
compiles into kernel-hi regardless of whether any live `music`/`sting` command currently references
it (a map's own `Music` field, or simple pre-authoring, can leave a song unreferenced for a while).
`project.sfx` is authored content the same way — gating its compilation by whether some command
happens to reference it today would make kernel-hi capacity depend on order of authoring (add the
effect, then the command; or the reverse) rather than on what is actually in the project, which is
not a distinction this codebase draws for songs and should not invent for effects. Gating emission on
`SFX_ENABLED` was the *other* live option and was rejected for the identical reason: it would make an
author's kernel-hi budget silently jump the instant they wire up the first `Play a sound effect`
command referencing an effect that has sat in the Sound Forge, fully compiled-sized in every capacity
meter, for a while already — order-dependent in exactly the way songs already refuse to be.

**The honest consequence, stated in §3.8 rather than hidden here: this narrows the whole-ROM identity
promise, not merely the kernel-lo one.** Round 1's own text claimed the promise was already
kernel-lo-only and therefore unaffected — that reading does not survive contact with §3.8's own
actual wording ("no live SFX command → byte-for-byte identical," no kernel-lo qualifier present). The
real, narrower, now-honest promise: a project with **no authored effects and no live command**
matches today exactly, kernel-hi included, because `sfxSize([])`/`sfxTables([])` both reduce to the
empty case below — but a project with an authored, unreferenced effect pays real kernel-hi bytes for
it regardless of `SFX_ENABLED`, the identical (and already-accepted) cost an authored, unreferenced
*song* already pays today.

**The empty-table case, defined exactly, not deferred:** `sfxTables([])` emits the two pointer-table
labels with **zero** `.db` bytes under either —

```
sfx_ptr_table_lo:
sfx_ptr_table_hi:
```

— legal nesasm (a label costs nothing and simply resolves to whatever address immediately follows).
This is required even when zero effects are authored, because **`script_op_sfx`'s own source code
still references these labels whenever `SFX_ENABLED` is 1** — which can happen with `project.sfx`
empty (a live `sfx` command exists, naming a reference that resolves to `NO_SFX`, e.g. after its one
authored effect was deleted) — and an assembler reference to an undefined label is a hard error
regardless of whether that code path is ever reached at runtime. `script_op_sfx`'s own duration-zero
guard (§3.7/§5.3) means the table is genuinely never *read* in that degenerate case, but nesasm still
has to resolve the symbol to assemble at all. One, many, or the general case emit exactly
`compileSfx`'s own bytes per effect under a per-effect label, plus the two pointer-table `.db` rows
indexing them — the direct structural mirror of `songTables`' own per-song emission, minus every
per-channel/instrument/loop piece that format needs and this one does not (§3.2).

The existing capacity check (`main/build/generate.js:1682`) becomes, reporting the **combined,
concrete** music/SFX/text figures rather than a two-way split that would leave a reader wondering
where the SFX contribution went:

```js
if (musicBytes + sfxBytes + text.bytes > BANK_SIZE - 64) {
  add(
    'error',
    musicBytes + sfxBytes > text.bytes ? 'Sound Forge' : 'Map Forge',
    `The songs and sound effects compile to ${musicBytes + sfxBytes} bytes (${musicBytes} music, ` +
      `${sfxBytes} effects) and the dialogue to ${text.bytes}, which together do not fit ...`
  );
}
```

`sfxTables(project.sfx ?? [])`'s output is appended to the **same** `assets/music.inc` write
(`main/build/generate.js:2375`) `songTables` already produces — one file, one `.include` site in
`engine/main.asm` (already unconditional, already in the kernel-hi bank, right after
`kernel_hi.inc`), no new plumbing.

### §3.11 Battle and dialogue reachability

**`music_tick` (and therefore `sfx_channel_tick`) keeps running, unconditionally, every field-loop
frame — dialogue, menu states, and battle alike.** Confirmed by tracing the call graph, not asserted:
`engine/boot.asm`'s `main_loop` calls `jsr music_tick` unconditionally, before `dispatch_input`/
`ui_tick` even run — this is the "music keeps playing while the world is paused" comment already on
that call site. During an RPG battle, the field's own `main_loop` **does not stop running** — battle
is not a separate, standalone loop the field yields to for its whole duration; `ui_tick`'s own
dispatch (`engine/ui.asm:299-302`) reaches `cmp #ST_BATTLE` / `lda #BE_TICK` / `jmp call_battle` once
per field-loop frame while `game_state == ST_BATTLE`, banking into the battle region for exactly one
frame's worth of battle logic and back (`call_battle`'s own trampoline restore) before the next
field-loop iteration. So `music_tick` — called *before* `ui_tick` in `main_loop`'s own order — runs
every frame regardless of `game_state`, battle included, and an SFX ticking mid-battle is exactly as
correct as an SFX ticking mid-dialogue: neither is a special case.

**`script_op_sfx` itself is reachable exactly where every other scripted command already is, and no
more.** Events run through `script_run`, driven from `dispatch_input`/`ui_tick`'s dialogue state
machinery — never from `ST_BATTLE`'s own `battle_tick` state machine, which has no concept of running
a placed actor's event at all. `Play a sound effect` is therefore never *unreachable* in a way that
needs a refusal or a special case; it is simply not a command battle's own menu-driven system can
invoke, the identical (unremarkable) fact already true of Say, Turn, Sting, and every other scripted
command. Nothing about this design changes that. An **engine-triggered** SFX (a hit landing in
battle, an item pickup) — as opposed to an *authored, scripted* one — is a different, real feature
this design deliberately does not build; see Open Questions.

### §3.12 Documented-limitation expectations (revised a third time — fix round 3, finding 1: the
5-byte `sting_restore_silence` guard was never SFX-standalone cost, so the Sting-free marginal figure
drops from ≈303 to ≈298, and MMC1 Save+Move-no-item moves from a refusal back to a fit)

**The mistake round 1 made, named exactly so it is not repeated: comparing a mixed marginal cost
against rows that do not carry that mix.** None of the costing pass's own Part 1
rows include a live Sting at all — every one of them is a plain action/RPG project with some
combination of Save/Move/item/"ALL 7 shipped verbs" (Turn/Wait/Shake/Show-Hide/Fade/Flash), never
Sting. Comparing those rows' own signed-free headroom against a figure that assumes Sting is already
paying some of SFX's own cost silently borrows a discount none of those rows actually has.

**Recomputed from §3.6/§8's own corrected decomposition (fix round 3, finding 1) before redoing the
matrix, per the brief's own instruction — recount first, then redo the matrix once:** `SFX_KERNEL_
ALLOWANCE_STANDALONE` is **283** (288 minus the 5-byte `sting_restore_silence` guard, which is a
both-live interaction term, not SFX-standalone code — §3.6). The Sting-free marginal cost of adding
SFX is therefore **283 + 15 (`AUDIO_FX_KERNEL_ALLOWANCE`) = ≈298**, not ≈303. The Sting-already-live
marginal cost is **283 + 5 (`STING_SFX_INTERACTION_ALLOWANCE`) = 288** — arithmetically the same 288
this design has quoted since round 2, but now for the honest reason (two separate terms that happen
to sum to the old, wrong single figure) rather than the wrong reason (one term, misclassified).

**Every currently-fitting Part-1 row, recomputed against 298:**

| board | row | Part 1 signed free | − 298 | verdict |
|---|---|---|---|---|
| MMC3 | Save+Move, no item | +88 | −210 | REFUSED (already known, now more decisively) |
| MMC1 | Save+Move+item | +220 | **−78** | **REFUSED — newly exposed** (round 1 wrongly called this "comfortable, 45-75 spare") |
| MMC1 | Save+Move, no item | +299 | **+1** | **FITS — a fit control, razor-thin, not a refusal.** Round 2's own 303-based figure had this at −4 (refused); the corrected 298 flips it. Exactly the kind of margin real measurement could move either way, which is precisely why this row is worth its own dedicated test (below) rather than merely being asserted either way. |
| MMC3 | ALL 7 verbs + Move + item, no Save | +289 | **−9** | **REFUSED — newly exposed** (round 1 called this "borderline"; it is a real, if narrow, refusal against the corrected baseline) |
| UNROM 512 | Save only, w/ item | +239 | **−59** | **REFUSED — newly exposed** (round 1's own "still fits comfortably" bullet was wrong) |
| UNROM 512 | ALL 7 verbs + Move + item, no Save | +279 | **−19** | **REFUSED — newly exposed**, omitted entirely from round 1's own matrix |
| UNROM 512 | Save+Move, no item | −88 | n/a | already broken, independent of SFX |
| MMC3 | Save only, w/ item | +404 | +106 | fits |
| MMC3 | Move+item, no Save | +785 | +487 | fits |
| MMC3 | ALL 7 verbs only, no Save/Move, w/ item | +668 | +370 | fits |
| MMC1 | Save only, w/ item | +615 | +317 | fits |
| MMC1 | Move+item, no Save | +979 | +681 | fits |
| MMC1 | ALL 7 verbs + Move + item, no Save | +483 | +185 | fits |
| MMC1 | ALL 7 verbs only, no Save/Move, w/ item | +862 | +564 | fits |
| UNROM 512 | Move+item, no Save | +775 | +477 | fits |
| UNROM 512 | ALL 7 verbs only, no Save/Move, w/ item | +658 | +360 | fits |
| all three | baseline (no Save/Move, no title, w/ item) | +1170 to +1374 | +872 to +1076 | fits |

**Four rows newly refused by SFX alone, not five: MMC1 Save+Move+item, MMC3 ALL-7+Move+item-no-Save,
UNROM 512 Save-only-w/-item, and UNROM 512 ALL-7+Move+item-no-Save.** MMC1 Save+Move-no-item — round
2's own fifth row — is **not** one of them; it is a fit, confirmed above, and is kept in the test plan
below specifically *as* a fit control rather than dropped from discussion. Action boards (NROM/UxROM,
800+ bytes of margin even with every shipped verb live per Part 1's own "action side" table) remain
unaffected by any of this — the constraint is, as it already was for Sting, specific to the three
RPG-capable boards' tightest configurations.

**A worked example with Sting genuinely already live, since Part 1's own rows never carry one —
constructed, not read off the table directly, per the brief's own request, recomputed against the
corrected 283/5/15 decomposition.** Take MMC1's Save+Move+item row (+220 signed free) and add a live
Sting *first*: 220 − 175 (`STING_KERNEL_ALLOWANCE`) = 45 bytes actually free. Adding SFX on top of
that now costs 283 (standalone) + 5 (interaction, since both are now live) = 288 (the shared 15
already paid by Sting's own 175) — 45 − 288 = −243, refused, and more decisively than the Sting-free
comparison alone (−78) suggested, because Sting itself already consumed real budget the Sting-free
comparison never charged. Contrast with MMC3's own "ALL 7 verbs only, no Save/Move, w/ item" row
(+668): with Sting already live, 668 − 175 = 493 free; adding SFX, 493 − 288 = 205 free — **fits**,
on a row this design's own Sting-free 298-based comparison (668 − 298 = 370) would also have called a
fit, for the right underlying reason in both cases here, but which will not always agree once a row
is close enough to the boundary that whether Sting is already present changes the verdict — the
reason the two-vs-three-term figures are kept as separate rows in §8 rather than collapsed into one.

**No cheap trim was found, and that is stated rather than glossed over.** §3.3 already shows the
two-phase `sfx_state` machine is not over-engineering: a same-frame resolution of hand-back-vs-silence
would overwrite the effect's own final note before it was ever audible for a single frame, reproducing
finding 1's own (round 2) bug through a different mechanism — there is no cheaper design that keeps
the final frame of every effect audible, and round 2's own further +2 bytes (the `jmp music_channel`
fix) is exactly this same category of unavoidable correctness cost, not padding. This round's own
finding 1 does not add bytes at all — it only corrects which feature pays for 5 bytes that were
always going to assemble under the same conditions; the headline totals move down slightly (298, not
303) as a result, not because anything got cheaper, but because it was never SFX's own cost alone to
begin with. No further optimization is designed in this round — a future kernel diet remains a real,
opportunistic possibility (CLAUDE.md's own precedent for `entity_patrol`/`move_tick`), not something
blocking a first correct implementation.

**Tests the implementation will need to write** — four newly-refused rows plus the already-known
refusal (corrected wording, fix round 4 finding 4a), one dedicated fit-control row, and the
Sting-already-live pair, not the six-refusal set round 2 specified: refusal-asserting tests,
each mirroring `kernelbytes.test.js`'s existing Sting refusal test exactly (the `kernelShortfallAdvice`
message-naming assertion, and the "dropping SFX alone is a real fix" build-and-confirm step), for
**MMC3 Save+Move-no-item**, **MMC1 Save+Move+item**, **MMC3 ALL-7-verbs+Move+item-no-Save**, and
**UNROM 512 Save-only-w/-item and ALL-7-verbs+Move+item-no-Save** — five refusal rows total. A
**dedicated fit-control test for MMC1 Save+Move-no-item with a live SFX**, asserting a real,
buildable ROM (not a refusal) — the row this round's own correction moves back across the boundary,
worth its own explicit assertion precisely because the margin (+1) is thin enough that this is the
test most likely to catch a future regression in either direction. An equality-asserting isolation
test for `SFX_KERNEL_ALLOWANCE_STANDALONE` (now 283), `AUDIO_FX_KERNEL_ALLOWANCE`, and `STING_SFX_
INTERACTION_ALLOWANCE` on all three RPG-capable boards (§7); the worked Sting-already-live example
above as its own dedicated test (MMC1 Save+Move+item with a live Sting *and* a live SFX, asserting
refusal at the corrected combined cost); and a fits-with-Sting-already-live control on a comfortable
row (MMC3 ALL-7-only-no-Save/Move-w/-item, both Sting and SFX live, asserting a real, buildable ROM)
so the "baseline matters" argument above is checked, not merely argued.

## §4. RAM map additions

Appended immediately after the switch-bound-tiles RAM block (`engine/constants.asm`, ends
`flip_pending_count = $0567`), inside the confirmed-unused gap before `flash_driver` ($0600) —
**152 bytes free there today** (`$0568`-`$05FF` inclusive, `0x600 − 0x568 = 0x98 = 152`; corrected
this round, fix round 3 finding 3 — every prior round undercounted this span by 6 bytes), of which
this design claims **8** (`sfx_state`, round 2's own two-phase ownership fix, added; `sfx_left` kept
as a pure countdown, no longer doubling as the ownership signal), leaving 144 bytes still free after
this design's own allocation:

```asm
; ---------------------------------------------------------------------- sfx RAM
; One channel's worth of playback state for a fixed-volume, single-channel
; sound effect stolen onto SFX_CHANNEL -- deliberately NOT part of the mus_*
; arrays (engine/music.asm's own driver state): keeping this fully disjoint
; from mus_ptr_lo..mus_note is what lets an SFX steal, pause, and hand back a
; channel regardless of whether a song, Silence, or a Sting is underneath it
; with only two small ownership guards elsewhere (music_stop, sting_restore_
; silence) -- see design-sfx.md §3.3/§3.4. sfx_ptr_lo/hi are copied into the
; shared zero-page ptr_lo/ptr_hi scratch for the duration of each indirect
; read, the identical convention music_read_event's own mus_ptr_lo,x ->
; ptr_lo copy-in/copy-out already uses -- (zp),Y addressing is a hard 6502
; requirement and zero page is already fully allocated.
sfx_state    = $0568        ; 0 idle / 1 playing / 2 cleanup-pending -- the
                             ; OWNERSHIP signal every guard checks; see
                             ; design-sfx.md §3.3
sfx_ptr_lo   = $0569
sfx_ptr_hi   = $056A
sfx_dur      = $056B        ; frames left on the current step
sfx_note     = $056C        ; last note read; $FF = resting
sfx_trig     = $056D        ; a new note started this tick -- write the period
                             ; registers; mirrors mus_trig,x's own role
sfx_left     = $056E        ; frames left on the whole PLAYING phase; a pure
                             ; countdown, not an ownership flag -- see §3.3
sfx_volume   = $056F        ; fixed for the whole effect, read once at trigger
```

`engine/constants.asm`'s hand-written sentinel block (near `NO_SONG`/`NO_ACTOR`/`NO_ITEM`/
`NO_METASPRITE`) gains:

```asm
NO_SFX      = $FF           ; project.sfx has nothing at this index -- see
                             ; design-sfx.md §3.9
```

And, near `MUS_CHANNELS = 4`:

```asm
SFX_CHANNEL = 3              ; noise -- see design-sfx.md §3.1
```

## §5. Routine sketches

### §5.1 `main/build/generate.js` — `kernelCodeBytes`, `kernelShortfallAdvice` (revised this round —
finding 1: a third term, `STING_SFX_INTERACTION_ALLOWANCE`, gated on both features at once)

```js
const usesSfx = projectUsesSfx(project);
const usesAudioFx = projectUsesAudioFx(project); // = usesSting || usesSfx
return (
  ...
  (usesSting ? STING_KERNEL_ALLOWANCE_STANDALONE : 0) +
  (usesSfx ? SFX_KERNEL_ALLOWANCE_STANDALONE : 0) +
  (usesAudioFx ? AUDIO_FX_KERNEL_ALLOWANCE : 0) +
  (usesSting && usesSfx ? STING_SFX_INTERACTION_ALLOWANCE : 0) +
  ...
  KERNEL_SLACK
);
```

`kernelShortfallAdvice`'s `active` list gains, alongside the existing Sting entry:

```js
if (usesSfx) active.push({ label: 'every Play a sound effect command', strip: (p) => projectWithoutCommands(p, ['sfx']) });
```

No other change to `kernelShortfallAdvice` — the solo/combination search, the occupancy function, and
the mapper-swap fallback all already generalize, per §3.6's own reasoning.

`config.inc` gains, beside `STING_ENABLED`:

```
`SFX_ENABLED = ${usesSfx ? 1 : 0}`,
`AUDIO_FX_ENABLED = ${usesAudioFx ? 1 : 0}`,
```

### §5.2 `engine/music.asm` — six diffs, not three (revised this round: `sting_restore_silence`'s
own guard and `sfx_channel_tick`'s two-phase state machine are new; `music_stop`'s diff changed
shape; `init_session`, in `engine/combat.asm`, is a seventh touched file)

1. `music_tick` restructured per §3.3's own restored sketch (replaces the existing 8-instruction
   body; the gate now tests `mus_enabled | sfx_state`, not `sfx_left`).
2. `music_channel`'s `force_trig` check block: `.if STING_ENABLED` → `.if AUDIO_FX_ENABLED`
   (one-line change, `engine/music.asm:154`). Unchanged from round 1.
3. `music_stop` gains an ownership-aware skip of its own existing `$400C` write (§3.3, finding 4) —
   **not** an unconditional `sta sfx_left` the way round 1 had it; that mistake is corrected, not
   merely renamed.
4. `sting_restore_silence` gains the identical ownership-aware skip (§3.3, finding 3) — **new this
   round**, not in round 1's design at all.
5. `init_session` (`engine/combat.asm`) gains the real session-boundary clear (§3.3, finding 4) —
   **new this round**, and the reason finding 4 moved this logic out of `music_stop` in the first
   place.
6. New code: `sfx_channel_tick` (now a real two-phase state machine, not a single-shot decrement),
   `sfx_read_event`, `sfx_apply` — appended after the existing `.if STING_ENABLED ... .endif` sting
   block, in their own `.if SFX_ENABLED ... .endif`.

Diffs 1, 3, 4 are given in full in §3.3 and not repeated here. Diff 5 is given in full in §3.3 as
well (the `init_session` block). Diff 6:

```asm
  .if SFX_ENABLED

; Entered from music_tick (above) whenever sfx_state != 0 and X = SFX_CHANNEL
; -- independent of mus_enabled by construction, which is the whole point:
; see design-sfx.md §3.3 for why the top-level gate alone is not enough.
; Two-phase, not a single decrement-and-handback -- see design-sfx.md §3.3,
; finding 1, for why a same-frame resolution would silence the effect's own
; final note before it was ever heard.
sfx_channel_tick:
  lda sfx_state
  cmp #1
  beq sfx_channel_tick_playing
  ; sfx_state == 2: the cleanup frame -- resolve exactly once, then idle.
  lda #0
  sta sfx_state
  lda mus_enabled
  beq sfx_channel_tick_cleanup_silence
  lda #1
  sta force_trig+SFX_CHANNEL   ; hand back -- see design-sfx.md §3.4 for what
                                ; the channel resumes into
  jmp music_channel            ; FIX ROUND 2, finding 1: tail-call, not rts --
                                ; retriggers the same X = SFX_CHANNEL this
                                ; same tick, so the final SFX note gets
                                ; exactly one frame instead of two. X is
                                ; untouched since entry; music_channel's own
                                ; trailing rts pops the return address
                                ; music_tick_loop's own jsr sfx_channel_tick
                                ; pushed, landing back at "jmp music_tick_next"
                                ; exactly as an ordinary rts here would have --
                                ; see design-sfx.md §3.3 for the full trace.
sfx_channel_tick_cleanup_silence:
  lda #$30
  sta $400C                    ; nothing else will touch this register again
                                ; until a real song resumes or another SFX fires
  rts
sfx_channel_tick_playing:
  lda sfx_dur
  bne sfx_channel_tick_apply
  jsr sfx_read_event
sfx_channel_tick_apply:
  dec sfx_dur
  jsr sfx_apply              ; write this frame's audio BEFORE deciding
                              ; whether this was the effect's last playing
                              ; frame -- the identical ordering sting_tick's
                              ; own header comment already requires of
                              ; music_tick/sting_tick, for the identical
                              ; reason: apply first, or the final frame of
                              ; audio is silenced before it is ever heard
  dec sfx_left
  bne sfx_channel_tick_done
  lda #2
  sta sfx_state                ; one more frame needed before resolving
                                ; hand-back vs. silence -- see §3.3
sfx_channel_tick_done:
  rts

; Pulls one note/duration pair off the current effect's own stream. No
; instrument opcode, no loop -- see design-sfx.md §3.2 for why this is
; genuinely separate code from music_read_event, not a shared reader.
; Unchanged in shape from round 1 -- findings 1-4 touched sfx_channel_tick's
; own dispatch, not this reader.
sfx_read_event:
  lda sfx_ptr_lo
  sta ptr_lo
  lda sfx_ptr_hi
  sta ptr_hi
  ldy #0
  lda [ptr_lo],y
  cmp #MUS_REST
  beq sfx_read_rest
  sta sfx_note
  lda #1
  sta sfx_trig
  jmp sfx_read_duration
sfx_read_rest:
  lda #$FF
  sta sfx_note
sfx_read_duration:
  ldy #1
  lda [ptr_lo],y
  sta sfx_dur
  lda ptr_lo
  clc
  adc #2
  sta sfx_ptr_lo
  lda ptr_hi
  adc #0
  sta sfx_ptr_hi
  rts

; The single stolen channel's own APU write -- fixed volume (sfx_volume, read
; once at trigger), no instrument/envelope lookup at all. Hardcodes $400C/
; $400E/$400F rather than X-indexing: X is always SFX_CHANNEL here, so the
; generic mus_reg-computation music_apply_noise needs is dead weight this
; routine does not pay for. and #$0F kept as defense-in-depth even though the
; schema now stores a canonical 0-15 note (§3.2/§3.9, finding 7) -- unchanged
; in shape from round 1.
sfx_apply:
  lda sfx_note
  cmp #$FF
  bne sfx_apply_sounding
  lda #$30
  sta $400C
  rts
sfx_apply_sounding:
  lda #$30
  ora sfx_volume
  sta $400C
  lda sfx_trig
  beq sfx_apply_done
  lda #0
  sta sfx_trig
  lda sfx_note
  and #$0F
  sta tmp
  lda #15
  sec
  sbc tmp
  sta $400E
  lda #$08
  sta $400F
sfx_apply_done:
  rts

  .endif
```

### §5.3 `engine/script.asm` — `script_op_sfx` (revised: `sfx_state` armed, `$4015` enabled —
finding 2's own fix lives here)

```asm
  .if SFX_ENABLED

; [OP_SFX, id, duration in frames]. Does not suspend, the same instant shape
; OP_STING already has. A duration of 0 can only mean the id operand was
; NO_SFX -- the identical "recognised command naming nothing stops the
; event" family script_op_give/take, script_op_call and script_op_sting
; already are; see design-sfx.md §3.7/§3.9.
;
; Unlike script_op_sting, no register needs to survive a jsr across this
; routine's own body: nothing below clobbers X, so there is nothing to
; push/pop -- see §3.6/§8 for why this trigger is still cheaper than Sting's
; per instruction, even though this round adds two new writes to it.
script_op_sfx:
  ldy #2
  lda [script_ptr_lo],y
  bne script_op_sfx_go
  jmp script_finish
script_op_sfx_go:
  sta sfx_left
  ldy #1
  lda [script_ptr_lo],y       ; sfx id
  tay
  lda sfx_ptr_table_lo,y
  sta ptr_lo
  lda sfx_ptr_table_hi,y
  sta ptr_hi
  ldy #0
  lda [ptr_lo],y               ; the compiled stream's own leading volume byte
  sta sfx_volume
  lda ptr_lo
  clc
  adc #1
  sta sfx_ptr_lo
  lda ptr_hi
  adc #0
  sta sfx_ptr_hi
  lda #0
  sta sfx_dur                  ; force sfx_read_event on the very next tick,
                                ; the identical "duration 0 forces an
                                ; immediate read" convention music_play's own
                                ; channel-init loop already relies on
  lda #1
  sta sfx_state                ; playing -- this also correctly re-arms a
                                ; second SFX replacing a first mid-flight
                                ; (§3.4), with no separate guard needed
  lda #$0F
  sta $4015                    ; NEW (finding 2): the only value this engine
                                ; ever writes here (music_play's own success
                                ; path, engine/music.asm:109) -- confirmed
                                ; safe unconditionally even on a true cold
                                ; boot, since init_session's own jsr
                                ; music_stop already stamps every channel's
                                ; volume register silent before main_loop
                                ; ever runs. See §3.3, finding 2.
  lda #3
  jsr script_skip
  jmp script_run                ; non-suspending: continue the same page,
                                 ; same frame
  .endif
```

`sfx_ptr_table_lo`/`sfx_ptr_table_hi` are generated tables (`assets/music.inc`, via `sfxTables`,
§3.10), one 2-byte pointer per authored effect — the SFX-format equivalent of `song_ptr_lo/hi`, sized
`project.sfx.length` rather than `project.sfx.length * 4` (one channel, not four). Emitted even for
zero effects (§3.10's own empty-table definition), so this reference always resolves.

## §6. Compiler / schema / editor work

- **`main/build/textcompile.js`**: a `case 'sfx':` in `encodeCommand`, mirroring the `'sting'` case
  exactly (`main/build/textcompile.js:355-368`):

  ```js
  case 'sfx': {
    const sfxIndex = sfxByte(project.sfx, command.sfx);
    if (sfxIndex === NO_SFX) return [OP_SFX, NO_SFX, 0];
    return [OP_SFX, sfxIndex, Math.min(sfxFrameLength(project.sfx[sfxIndex]), 255)];
  }
  ```

  Imports `NO_SFX`, `sfxByte`, `sfxFrameLength` from `shared/project.js`'s own re-export (matching
  the majority import pattern that file already follows, not the one pre-existing `damageAmount`
  exception `design-routes.md` already documents and does not extend).

- **`shared/project.js`**: `EVENT_COMMANDS` entry (§3.7), `IMPLEMENTED_COMMANDS` gains `'sfx'`
  (inserted after `'sting'`, before `'route'`, matching the array's own ordering convention even
  though it is a `Set`), the new `arg === 'sfx'` case in `normalizeEventCommand` (§3.9, finding 7),
  `LIMITS.sfx` (a single new entry now, not two — §3.9), `normalizeProject`'s `sfx:` field (§3.9),
  `validateProject`'s missing/overlong block **and** its new over-cap block (§3.9, finding 7),
  `renumberSfxDeletion` (§3.9), `projectUsesSfx`/`projectUsesAudioFx` (§3.8/§3.6), re-export of
  `NO_SFX`/`sfxByte`/`sfxFrameLength`/`SFX_MAX_STEPS` from `shared/audio.js` alongside the existing
  `NO_SONG`/`songByte`/`songFrameLength` re-export.

- **`renderer/forges/map/events.js`**: `defaultCommand`'s own `arg === 'sfx'` case (§3.9, finding 7 —
  `out.sfx = null`, not the generic `0` fallback); `describeCommand`'s own `'sfx'` case (the
  summary-line precedent every prior verb's own Flash-shaped "§8 precedent — cheap, a case in the
  summary function" already sets) — names the referenced effect, or "no effect chosen" the same way
  a missing-song Sting row already reads; and the command-row SFX selector itself, mirroring the
  Sting selector at lines 1541-1564 (§3.9, finding 7).

- **`renderer/forges/map/map.js`**: `eventContext()` gains `sfx: store.project.sfx ?? []` beside
  `songs:` (§3.9, finding 7) — the new selector above has nothing to list without it.

- **`renderer/forges/sound/`**: the Effects tab/editor and its own Add-button gating at `LIMITS.sfx`
  (§3.9, finding 7), a small `SfxReplayer` for preview (mirrors `renderer/forges/sound/replayer.js`'s
  `Replayer` class, but single-channel, no instrument/envelope lookup, reading `compileSfx`'s own
  two-part output — volume byte, then note/duration pairs). `renumberSfxDeletion` wired into the
  Effects list's own delete action, the identical wiring `renumberSongDeletion` already has on the
  Song list's delete action.

- **`main/smoke.js`**: an "SFX authoring" step mirroring the existing Sting step's own shape (add an
  effect in the Sound Forge, add a `Play a sound effect` command via the Map Forge's "+ Add a
  command…" dropdown by its `EVENT_COMMANDS` label "Play a sound effect", confirm the row offers an
  effect-select control the way a fresh Sting row offers a song-select control).

## §7. Test plan (revised this round — finding 6: the repository's own three-implementation
contract for the music format now explicitly covers SFX, and every behavioral case findings 1-4
introduced is a named, added test, not a description of coverage that was never actually specified)

**Finding 6's own core complaint, restated so the fix is legible against it**: round 1's own tests
covered `compileSfx` (unit), kernel-byte deltas, and a shape of smoke coverage that only checked
controls exist — none of that would fail a driver that never enables `$4015`, drops the final note,
races `sting_restore_silence`, or cancels on Play-Silence, because none of it ever puts a built ROM
through the actual behavior findings 1-4 fixed. CLAUDE.md's own three-implementation contract for the
music format (`engine/music.asm`, `main/build/songcompile.js`, the Sound Forge replayer, cross-
checked by `test/unit/music.test.js`'s ROM-vs-preview frame diff) is the template this test plan now
follows explicitly, not merely cites.

1. **`test/unit/music.test.js` gains an SFX golden trace, the same shape as its existing song
   test.** Build a ROM with a live `sfx` command authored into it, boot it headlessly, step N frames,
   and diff the ROM's real `$4000-$400F` writes against `SfxReplayer`'s own frame-by-frame output for
   the identical compiled effect — the direct extension of the contract finding 6 names, not a new
   mechanism. Assert writes to **all four** channel register groups, not only `$400C`/`$400E`/
   `$400F`: a driver that clobbers `$4000`/`$4004`/`$4008` (an unrelated channel) while servicing SFX
   must fail this test, not merely one that gets the noise channel itself wrong.
2. **Silence-at-boot audibility (finding 2; assertion corrected in fix round 2, finding 3).** Boot a
   ROM whose project never plays a song before its first SFX, fire the effect, and assert **a `$4015
   <- $0F` write occurred before the first SFX period/length write** — intercepted at write-time, the
   same way `test/unit/music.test.js`'s own `recordRomActivity` already intercepts `$4000-$400F`, not
   read back afterward. **Round 1's own proposed assertion — "`$4015` actually holds `$0F`" — is
   impossible to check this way and would reject a correct implementation**: `$4015` is a
   *status* register on read (`renderer/emulator/core/papu/index.js:107-132`), constructed live from
   each channel's own length-counter/DMC/IRQ status bits, not a latch of the last value written — a
   correct `sta $4015` of `$0F` need not read back as `$0F` at all. `recordRomActivity`'s own
   interception range (`test/unit/music.test.js:121-122`, `APU_LOW = 0x4000`/`APU_HIGH = 0x400f`)
   does not currently include `$4015` either — this test needs its own, wider interception (or a
   second hook) covering `$4015` specifically, named here as real test-infrastructure work rather
   than assumed already covered.
3. **The final-frame drop and cleanup (finding 1; timing corrected in fix round 2, finding 1).** A
   built ROM asserting the exact APU register sequence across an effect's own last playing frame and
   the cleanup frame after it: the last authored note's real value must appear at `$400C` on its own
   frame (not overwritten before that frame completes), and the channel must be silenced or handed
   back **on the frame immediately after, never later and never on the same frame as the last note**
   — this assertion is unchanged from round 1 and is exactly what exposed round 1's own extra-frame
   bug in the design itself (fix round 2 finding 1); kept exactly as specified rather than loosened.
4. **Underlying-song pause and retrigger (assertion corrected in fix round 2, finding 3).** A song
   audibly playing before an SFX fires: assert the other three channels' own writes **match the
   no-SFX baseline/replayer trace for the identical frames — unchanged, not absent.** **Round 1's own
   proposed assertion — "completely absent from the trace" — is wrong for the real APU and would
   reject a correct implementation**: `engine/music.asm:139-177` (`music_tick`'s own restructured
   loop, §3.3) ticks every non-stolen channel exactly as before, and `music_apply` writes each
   active channel's volume/control register **every frame**, active-note or not — `renderer/forges/
   sound/replayer.js:73-128` models the identical behavior. "Completely absent" directly contradicts
   §1's own requirement that the other three channels continue *untouched*, which means continuing to
   receive their own normal, expected writes, not receiving none. Only an unexpected or a missing
   write (relative to the baseline trace) should fail this test. Also assert the stolen channel's own
   paused note resumes correctly — same pitch, same remaining duration behavior — once the SFX hands
   back.
5. **Second-SFX replacement.** Fire a second SFX mid-first; assert the trace shows the *second*
   effect's own notes from the moment it replaces the first, with no trace of the first effect's
   remaining steps.
6. **Ordinary song change and Silence change during an active SFX survive it (finding 4's resolved
   policy).** Two built-ROM cases: a `Play music` naming a different song while an SFX is active, and
   a `Play music: Silence` (or a map transition to a Silence map) while an SFX is active — both must
   show the SFX's own trace continuing uninterrupted at `$400C`/`$400E`/`$400F` across the transition,
   while the other three channels correctly reflect the new song or Silence.
7. **Session reset cancels an active SFX (finding 4's own exception, the one case that does cancel
   it).** A game-over or fresh-boot triggered while an SFX is mid-flight: assert `$400C` is silenced
   by the frame after the reset and stays silent — the direct proof of `init_session`'s own new block
   (§3.3), distinguished from test 6 above by asserting the *opposite* outcome for the one case that
   is supposed to differ.
8. **Every Sting×SFX end order named in §3.4, each its own built-ROM case:** SFX active, sting ends
   into an audible song; SFX active, sting ends into Silence; SFX ends first while a sting is still
   audible (asserting the hand-back write lands on the *same* frame as SFX's own cleanup, per fix
   round 3's own correction to this bullet); exact co-end (both end on the identical frame), traced
   for both the sting-restores-audible and sting-restores-Silence sub-cases (§3.4's own bullet trace,
   each becomes one case here). Every case asserts the real APU trace, not merely that
   `sfx_state`/`sting_left` reached their expected RAM values — a passing RAM-only assertion is
   exactly what let round 1's own gap through undetected. **The exact co-end / sting-restores-Silence
   sub-case (fix round 3, finding 2) pins the write order explicitly, per §3.4's own honest contract,
   rather than asserting "no drop" the way the other sub-cases do**: on that one frame, the trace must
   show `music_channel`'s own retriggered sting-noise write landing at `$400C` *first* (via SFX's own
   cleanup-phase tail-call), immediately followed within the same frame by `sting_restore_silence`'s
   own `$400C = $30` write — i.e., the test asserts the *truncation itself* as the correct, expected
   behavior for this one sub-case (matching inherited Sting behavior), not its absence. Every other
   sub-case in this test continues to assert no drop, exactly as before.
9. **`test/unit/kernelbytes.test.js`**: extend `measureCodeBytes`'s options with `withSfx` (mirroring
   `withSting`'s own shape: if `!project.sfx?.length`, seed one short effect; push an `{ op: 'sfx',
   sfx: 0 }` command). An isolation test asserting **`SFX_KERNEL_ALLOWANCE_STANDALONE +
   AUDIO_FX_KERNEL_ALLOWANCE`** — the exclusive term (283) plus the shared term (~15), **not** the
   interaction term, since this isolation is SFX with no Sting live at all — equals the real measured
   delta, on all three RPG-capable boards, equality-asserted the way `STING_KERNEL_ALLOWANCE`'s own
   test already is (corrected this round, fix round 3 finding 1: round 2's own version of this test
   summed in the interaction term by omission, since it did not yet exist as a separate term) —
   `withMove: true` on both sides of the isolation, matching that test's own reasoning for why a bare
   baseline would conflate unrelated terms.
10. **The `force_trig` re-gate must not change a Sting-only project's own measured cost.** A dedicated
    test: build `sample-rpg` with a live Sting and no live SFX, before-and-after the `.if
    STING_ENABLED` → `.if AUDIO_FX_ENABLED` change (i.e., against the implementation once it exists)
    — assert the kernel-lo byte count is unchanged from what `STING_KERNEL_ALLOWANCE`'s own existing
    test already measures. This is what turns §3.6's "the re-gate is a no-op for a Sting-only
    project" claim from an argument into a checked fact. **Also confirms `STING_SFX_INTERACTION_
    ALLOWANCE` truly costs nothing on a Sting-only project** — the nested `.if SFX_ENABLED` guard
    inside `sting_restore_silence` collapses away identically to any other `SFX_ENABLED`-gated block
    when SFX is not live, which this same before/after comparison already exercises.
11. **The `STING_KERNEL_ALLOWANCE_STANDALONE`/`AUDIO_FX_KERNEL_ALLOWANCE`/`STING_SFX_INTERACTION_
    ALLOWANCE` split — three terms now, not two (fix round 3, finding 1)** — measure `force_trig`'s
    own check-and-clear block's real byte span via nesasm's symbol table (`game.fns`), the identical
    technique `BOUND_TILE_KERNEL_ALLOWANCE`'s own correction used, for the shared term; separately
    confirm the interaction term's own 5 bytes **by a span-difference measurement, not by asserting a
    label is absent (corrected fix round 4, finding 2 — `game.fns` lists labels, not individual
    instructions, and the `sting_restore_silence_skip_noise` label itself sits outside `.if
    SFX_ENABLED`, so it can still appear in a Sting-only symbol file even though the guarded `ldy`/
    `bne` do not assemble there)**: compare the `sting_restore_silence`/`sting_restore_silence_
    skip_noise` address span between a Sting-only build and a both-live build, and assert the
    both-live span is exactly 5 bytes larger (a listing or binary diff of the routine is an equally
    valid way to check the same fact) — the direct proof that this term is correctly gated on both
    flags, not one.
12. **Both live at once.** A test building `sample-rpg` with a live Sting *and* a live SFX together,
    asserting the combined kernel-lo delta equals **`STING_KERNEL_ALLOWANCE_STANDALONE +
    SFX_KERNEL_ALLOWANCE_STANDALONE + AUDIO_FX_KERNEL_ALLOWANCE + STING_SFX_INTERACTION_ALLOWANCE`**
    exactly (the shared term charged once, the interaction term charged once — corrected this round,
    fix round 3 finding 1: round 2's own version of this test omitted the fourth term, since it did
    not yet exist separately, though the arithmetic total it asserted happened to still be correct by
    coincidence) — the direct executable proof of §3.6's dependent-term accounting, mirroring the
    existing `'a route whose only leg is Turn measures exactly TURN_KERNEL_ALLOWANCE + FACE_KERNEL_
    ALLOWANCE'` test's own shape for a different dependent pair. **A companion test drops only Sting**
    from this same both-live project and asserts the freed byte count equals `STING_KERNEL_
    ALLOWANCE_STANDALONE + STING_SFX_INTERACTION_ALLOWANCE` exactly, **not** `AUDIO_FX_KERNEL_
    ALLOWANCE` (SFX is still live, so the shared term must still be charged) — the direct executable
    proof of §3.6's own "dropping only Sting while SFX stays live" worked example.
13. **An off SFX costs a project nothing (corrected this round, finding 4 — same authored catalog on
    both sides).** The `move.test.js` whole-ROM-comparison precedent: build two ROMs from projects
    that carry the **same authored `project.sfx` catalog** — one with an `{ op: 'sfx', ..., off: true
    }` command plus other live content, one with the live content alone and no such command at all —
    assert byte-identical. **Round 1's own version of this test did not pin the catalog on both
    sides**, so as written it could not distinguish "the `off` flag costs nothing" (the actual claim)
    from "an unreferenced effect costs nothing" (a different, narrower, and now-false claim per
    §3.8/§3.10's own revision) — pinning the catalog is what makes this test isolate the `off` flag's
    own cost specifically.
14. **No authored effects and no live SFX command assembles byte-for-byte identical to today
    (narrowed this round, finding 4 — kernel-hi included, per §3.8's own corrected promise).** Applied
    to a project with `project.sfx === []` **and** zero `sfx` commands — confirms the `music_tick`
    restructuring, the `music_stop`/`sting_restore_silence` guards, `init_session`'s new block, and
    every other `.if SFX_ENABLED` block collapse to nothing on the kernel-lo side, that `AUDIO_FX_
    ENABLED` correctly stays whatever `STING_ENABLED` alone would already make it (per §3.5's OR),
    and that `sfxSize([])`/`sfxTables([])` add nothing measurable to kernel-hi.
14a. **A project with an authored-but-unreferenced effect and no live SFX command is *not*
    byte-identical to today, and that is asserted directly, not left implicit (new this round,
    finding 4).** One or more effects authored in `project.sfx`, zero live `sfx` commands anywhere —
    assert the built ROM's kernel-hi size grows by exactly `sfxSize(project.sfx)` relative to the
    same project with `project.sfx = []`, and that `SFX_ENABLED` stays 0 (kernel-lo untouched). This
    is the test that would have caught round 1's own promise contradiction directly, and it doubles
    as the proof that the cost genuinely mirrors `songTables`' own identical, pre-existing behavior
    for an authored-but-unreferenced song (a parallel assertion against `project.songs` in the same
    test, confirming both formats agree on this point).
15. **Documented-limitation refusal — five refusal rows plus one dedicated fit control, matching
    §3.12's own corrected matrix exactly (fix round 3, finding 1 — round 2's own six-row set wrongly
    included MMC1 Save+Move-no-item as a refusal)**: mirroring the existing Sting test exactly (the
    `kernelShortfallAdvice` message-naming assertion, and the "dropping SFX alone is a real fix"
    build-and-confirm step, an actual nesasm build, not just the JS-side prediction) for each of the
    four newly-refused rows — **MMC1 Save+Move+item**, **MMC3 ALL-7-verbs+Move+item-no-Save**,
    **UNROM 512 Save-only-w/-item**, and **UNROM 512 ALL-7-verbs+Move+item-no-Save** — plus the
    already-known **MMC3 Save+Move-no-item**. **A separate, dedicated fit-control test for MMC1
    Save+Move-no-item with a live SFX**, asserting a real, buildable ROM rather than a refusal — the
    razor-thin (+1) row this round's correction moves back across the boundary, named as its own test
    precisely because that margin is thin enough to be worth guarding against regression in either
    direction, not merely folded into the "fits comfortably" rows nobody bothers to test explicitly.
    Plus two more, specific to the Sting-already-live baseline §3.12's own worked example established:
    a refusal test for MMC1 Save+Move+item with **both** a live Sting **and** a live SFX (asserting
    the combined-cost refusal, not merely the SFX-alone one), and a fits-with-both-live control on
    MMC3's own ALL-7-verbs-only-no-Save/Move-w/-item row (asserting a real, buildable ROM) — so the "a
    row's baseline determines which marginal cost applies" argument is checked, not merely argued.
16. **`test/unit/project.test.js`**: extend the ordinal test's hardcoded `OP_*` table with `sfx:
    0x1b`; extend the `'liveCommands and encodeBody agree on the actual sequence of compiled
    opcodes'` scenario table with an `sfx` entry (a live one, and a switched-off one). **New this
    round (finding 9): a negative route-leg test** — a hand-constructed project with an `sfx` command
    sitting directly in a route's own `.legs` array, asserting it is dropped by normalization, absent
    from `liveCommands`' own output, and absent from the compiled byte stream, so `SFX_ENABLED` can
    never disagree with what the ROM actually contains for this specific illegal placement.
17. **`shared/audio.js`/`main/build/songcompile.js` unit tests**: `sfxFrameLength` sums step
    durations correctly (including the `null`-note/rest case); `compileSfx` emits the leading volume
    byte correctly clamped 0-15, the note/rest/duration pairs in order (note clamped 0-15, per
    finding 7), and the defensive trailing `REST, 0`; `normalizeSfx` clamps `steps` to
    `SFX_MAX_STEPS` and each step's fields into range; a raw `{ steps: [] }` normalizes to one rest
    step, and `sfxTables([])` emits both pointer-table labels with zero data bytes (§3.10, finding
    8).
18. **`validateProject`**: a live `sfx` command naming nothing is refused (mirroring the Sting
    missing-song test); a live `sfx` command naming an effect whose own `sfxFrameLength` exceeds 255
    is refused (mirroring the Sting overlong-song test); a project with more effects than `LIMITS.sfx`
    is refused with the real over-count named (finding 7's new over-cap block, §3.9) — none of this
    was in round 1's own test list.
19. **`renumberSfxDeletion`**: mirrors `renumberSongDeletion`'s own existing test shape — deleting a
    middle effect renumbers references above it down by one and nulls references to the deleted one
    itself, walked through `allCommands` so a switched-off reference is still tracked.
20. **Fresh and missing SFX references in the editor (finding 7)**: `defaultCommand('sfx')` produces
    `{ sfx: null }`, never effect 0; the command-row selector shows "Missing effect" for a `null` or
    out-of-range reference and the real effect name otherwise; the Effects list's own "Add effect"
    button disables at `LIMITS.sfx` with the same message shape `LIMITS.items`'s own Add button
    already has.
20a. **The step-count boundary, both in the editor and on load (new this round, finding 6).** A
    real-window or editor-state test: an effect with seven steps offers an enabled "Add step" button;
    adding an eighth disables it; the ninth addition is refused by the control itself (not merely by
    a later save). Separately, a unit test loading a hand-constructed effect with more than
    `SFX_MAX_STEPS` steps through `normalizeSfx` asserts it is silently truncated to exactly the
    first eight — the truncate-on-normalize policy §3.2 now states explicitly, checked rather than
    left implicit.
21. **Load/save round-trip and the real-window smoke scenario (finding 6's own explicit "not merely
    find the tab and selector" ask).** `main/smoke.js`'s SFX step is revised, not merely described: it
    must add an effect in the Sound Forge, **edit its steps and volume**, **select it** on a `Play a
    sound effect` command added via the Map Forge's "+ Add a command…" dropdown, **preview it**
    (confirms the `Synth`/`SfxReplayer` path actually runs, not merely that a preview button exists),
    **save and reload the project** (confirms `normalizeSfx`'s own round-trip is lossless — an inert
    selector or a preview that silently no-ops would still pass a smoke step that only checks controls
    exist, which is exactly finding 6's own complaint about round 1's plan), and **build** the ROM.
22. **Sabotage-style checks worth pre-naming for whoever implements this** (the discipline
    the routes implementation report's own "Sabotage evidence" section already models
    — each of these is a plausible wrong implementation that a correct one must fail against):
    reversing the `music_stop`/`sting_restore_silence` ownership guards' own `.if SFX_ENABLED` order
    relative to the surrounding code should not change behavior — test 8's own co-end cases are what
    actually exercise this, not a test that only ever builds with one feature live at a time; an
    implementation that resolves hand-back on the *same* frame as the final note (skipping the
    two-phase `sfx_state` machine) would pass every RAM-level assertion but fail test 3's own
    APU-trace assertion specifically; an implementation that forgets the `mus_enabled` re-check inside
    `music_tick_loop`'s normal-channel branch would replay stale song state during Silence for the
    *other three* channels the moment an SFX is also active — test 2 combined with test 4's own
    "other three channels stay silent/correct" assertion is what catches this, not redundant with
    either alone.

## §8. Byte accounting rollup — every figure ESTIMATE unless stated otherwise (revised a third time
— fix round 3, finding 1: the `sting_restore_silence` guard is pulled out of the SFX-standalone sum
into its own, correctly-gated interaction term; nothing about the underlying instruction counts
changes, only which term each one belongs to)

| routine | bytes (ESTIMATE, full-body count) | basis |
|---|---|---|
| `music_tick` restructuring (§3.3) | 22 | unchanged; recounted directly from the restored sketch in round 2 (finding 5) |
| `script_op_sfx` trigger (§5.3) | 72 | unchanged |
| `sfx_channel_tick` (§5.2) | 55 | unchanged; round 2's own `jmp music_channel` fix (finding 1) |
| `sfx_read_event` (§5.2) | 57 | unchanged |
| `sfx_apply` (§5.2) | 52 | unchanged |
| `script_run` dispatch entry (§3.7) | 7 | unchanged |
| `music_stop`'s ownership-aware skip (§3.3, finding 4) | 5 | unchanged — genuinely SFX-only: `music_stop` assembles unconditionally, with or without Sting |
| `init_session`'s session-boundary clear (§3.3, finding 4; `engine/combat.asm`) | 13 | unchanged |
| **`SFX_KERNEL_ALLOWANCE_STANDALONE` (pre-implementation total)** | **283** | 22+72+55+57+52+7+5+13 — **down from 288 this round (fix round 3, finding 1), not because any instruction count changed, but because the 5-byte `sting_restore_silence` guard (next row) was misclassified as part of this sum in rounds 1-2 and is removed here** |
| `sting_restore_silence`'s ownership-aware skip (§3.3, finding 3) | 5 | `ldy sfx_state`(3, abs)+`bne`(2) — **reclassified this round (finding 1): NOT part of `SFX_KERNEL_ALLOWANCE_STANDALONE`.** `sting_restore_silence` sits entirely inside the shipped outer `.if STING_ENABLED` block (`engine/music.asm:376-454`), so this nested `.if SFX_ENABLED` guard can only ever assemble when *both* flags are true — see the code sketch's own note in §5.2 and §3.6's corrected decomposition |
| `AUDIO_FX_KERNEL_ALLOWANCE` (the `force_trig` check-and-clear, decomposed out of the existing 175) | **~15** — unchanged; a full-body count of `engine/music.asm:154-167`'s own existing block | shared, `AUDIO_FX_ENABLED`-gated; **measured directly**, not estimated from this instruction count alone, per §7 |
| **`STING_SFX_INTERACTION_ALLOWANCE` (new name this round)** | **5** | exactly the `sting_restore_silence` guard row above, renamed to reflect what it actually is: a term gated `usesSting && usesSfx`, not `usesSfx` alone |
| **Marginal cost of adding SFX to a project with no live Sting** | **≈298** | 283 + 15 — corrected down from round 2's own ≈303, since the 5-byte guard was never part of the SFX-alone cost to begin with (§3.12) |
| **Marginal cost of adding SFX to a project that already has a live Sting** | **288** | 283 + 5 — the shared `AUDIO_FX_KERNEL_ALLOWANCE` is already paid by `STING_KERNEL_ALLOWANCE`'s own 175, but the interaction term is now genuinely new the moment both are live; arithmetically identical to round 2's own 288, now for the correct reason (two separate terms summing to it, not one misclassified one) |
| Kernel-hi (compiled SFX streams) | per-effect, author-controlled; 1 volume byte + 2 bytes/step + 2-byte defensive terminator + 2-byte pointer-table entry | own capacity check (§3.10), not kernel-lo |
| `$0300+` RAM | **8 bytes, exact** (§4 — a concrete address map, not a range) | `sfx_state`, `sfx_ptr_lo/hi`, `sfx_dur`, `sfx_note`, `sfx_trig`, `sfx_left`, `sfx_volume` |

**This total (283 exclusive + ~15 shared + 5 interaction) is real, not padded, and is a
reclassification, not a new cost — every underlying instruction count is unchanged from round 2's own
honest recount.** It remains meaningfully **above** the costing's own shape (a) headline of 122-165.
The two cost-saving arguments from round 1 still stand: `script_op_sfx` needs no register-
preservation stack juggling the way Sting's own trigger does, and SFX needs no `music_play`
cancellation check at all (§3.6) — both real, both already priced (or absent) in the table above,
neither large enough to offset the correctness cost findings 1-4 (round 2) required.

## §9. Open questions this design does not settle (revised: finding 8's empty-table question is
resolved in §3.10 this round and removed from this list — genuinely out-of-scope items only, per
the brief's own completeness bar)

1. **Author-chosen channel, not fixed to noise.** §3.1's fixed-channel choice is argued on cost and
   on "safest channel to interrupt," but concedes a real product limitation (no melodic pickup
   jingle). A per-effect channel operand is a real, uncosted follow-up if that limitation turns out
   to matter to the user.
2. **Engine-triggered SFX** (a hit landing in combat, a pickup collected) as opposed to an
   authored, scripted command. Explicitly out of scope (§3.11) — this design only builds the
   scripted `Play a sound effect` command.
3. **`renumberSongDeletion`'s own apparent gap for `Sting`'s `song` field** (§3.9's aside) — flagged,
   not fixed, as outside this design's scope.
4. **The exact per-step authoring UI** (§6) is sketched at the level of "a compact step list, not the
   pattern grid," not wireframed — a real UI design pass, not blocked on anything here, is still
   needed before implementation of the Sound Forge Effects tab specifically.
5. **The kernel diet opportunity §3.12 names but does not design** — whether `entity_patrol`/
   `move_tick`-style duplication exists anywhere in the newly-added SFX code (or elsewhere) that a
   later, opportunistic pass could remove, recovering some of the headroom cost of adding SFX to a
   project that already has a live Sting (288 bytes — corrected wording, fix round 4 finding 4b: not
   an unqualified "total," specifically the Sting-already-live marginal cost, §8 — the Sting-free
   marginal is ≈298, and the SFX-exclusive allowance alone is 283). Not designed here, consistent with
   how this codebase treats such diets elsewhere (real, but opportunistic, never blocking a first
   correct shipped version).

## Fix rounds

### Round 1 — against that round's own review, all nine findings accepted

- **Finding 1 (high — final SFX note dropped when Silence follows).** Replaced the single-shot
  `sfx_left`-reaches-zero-then-handback shape with a real two-phase `sfx_state` machine (0 idle / 1
  playing / 2 cleanup-pending), the same shape the costing's own Tile design already used for an
  identical reason. §3.3 (new), §4 (`sfx_state` RAM byte), §5.2 (`sfx_channel_tick` rewritten).
- **Finding 2 (high — `$4015` never enabled for a Silence-start project).** `script_op_sfx` now
  writes `$4015 = $0F` unconditionally on every trigger — the only value this engine has ever written
  there, confirmed safe on a true cold boot by tracing `reset` → `init_session` → `music_stop`'s own
  unconditional register silence, which runs before any SFX could fire. §3.3, §5.3.
- **Finding 3 (high — `sting_restore` traced against a path the engine does not take).** Corrected:
  `sting_restore` branches on `mus_enabled`; only the audible branch reaches `sting_retrig_loop`
  (harmless, force_trig-only). The Silence branch, `sting_restore_silence`, writes `$400C` directly
  and never touched `force_trig` — given a new ownership-aware guard (`sfx_state` check) so it no
  longer races an active SFX's own write to the same register. §3.3, §3.4 (every ordering re-traced,
  including both co-end sub-cases), §5.2.
- **Finding 4 (high — `music_stop` is not session-only; the session clear cancelled ordinary
  Play-Silence too).** Product decision made explicitly: an SFX survives every ordinary music
  transition, Silence included; only an actual new session ends it. `music_stop`'s own existing
  `$400C` stamp became ownership-aware instead of gaining an unconditional `sfx_left` clear; the real
  session-boundary clear moved to `init_session` (`engine/combat.asm`), the one genuinely
  session-scoped call site. §1 (invariant restated), §3.3, §3.6.
- **Finding 5 (high — kernel-lo rollup did not match the sketches, off by ~76-81 bytes before
  findings 1-4's own new code).** Recounted every routine instruction-by-instruction against nesasm's
  real addressing-mode costs; independently re-derived figures matched the review's own count exactly
  (`script_op_sfx` 62, `sfx_channel_tick` 25, `sfx_read_event` 57, `sfx_apply` 52, for the
  *pre-finding-1-4* code). Findings 1-4's own new/changed code added on top:
  `SFX_KERNEL_ALLOWANCE_STANDALONE` is now **286** (was ~147-152), `AUDIO_FX_KERNEL_ALLOWANCE`
  estimated at ~15. §3.12 and §7's documented-limitation expectations redone against the honest
  total — MMC1 Save+Move+item, previously reported as comfortable, is now expected to be a new
  refusal; no cheap trim was found that preserves correctness, stated plainly rather than hidden. §8
  rewritten in full.
- **Finding 6 (high — tests omitted the repository's three-implementation contract and would pass
  the broken driver).** §7 rewritten: an explicit SFX golden trace in `test/unit/music.test.js`
  against `SfxReplayer`, plus 8 new built-ROM behavioral cases covering Silence-at-boot audibility,
  the final-frame/cleanup sequence, underlying-song pause/retrigger, second-SFX replacement, ordinary
  song/Silence-survival, session-reset cancellation, and every Sting×SFX end order from finding 3 —
  each asserting the real APU trace, not RAM state alone. The smoke scenario now edits/selects/
  previews/saves-reloads/builds, not merely finds controls.
- **Finding 7 (medium — schema/editor plan incomplete and internally inconsistent).** Closed every
  named gap: explicit `arg === 'sfx'` normalization case; `defaultCommand`'s own nullable default;
  the Map Forge SFX selector, `eventContext()` plumbing, and missing-reference display; `LIMITS.sfx`
  over-cap `validateProject` refusal and Effects-tab Add-button gating; `SFX_MAX_STEPS` moved to
  `shared/audio.js` to avoid the import cycle round 1 left unresolved; the stored note range
  canonicalized to 0-15 (was 0-95 aliasing 16 driver values); the zero-step contradiction resolved to
  one coherent policy (normalize-to-one-rest-step, nothing left for `validateProject` to check). §3.2,
  §3.9, §6.
- **Finding 8 (medium — kernel-hi sizing charged phantom bytes, empty-table emission
  undecided).** `sfxSize`'s `+4` corrected to `+2` (one real pointer-table entry; labels are free).
  Table emission decided explicitly: unconditional, matching `songTables`' own precedent, not gated
  by `SFX_ENABLED`. The empty-table case defined exactly (both pointer labels, zero data bytes) rather
  than deferred. Capacity error message revised to report combined concrete music/SFX/text figures.
  §3.10.
- **Finding 9 (medium — `projectUsesSfx`'s route-recursion claim was false).** Corrected: `sfx` is
  found through branch/choice recursion only; `routeLegs`/`ROUTE_LEG_OPS` (`move`/`turn`/`wait` only)
  means an `sfx` command in a raw route leg is dropped by both normalization and compilation, never
  counted on either side. Added the negative route-leg test the review asked for. §3.8, §7 test 16.

### Round 2 — against that round's own review, all six findings accepted

- **Finding 1 (high — active-music hand-back landed one frame later than Silence cleanup).**
  Confirmed directly: the cleanup state's audible branch set `force_trig` and `rts`'d without ever
  calling `music_channel`, so the flag sat unconsumed until `music_tick`'s *next* invocation — the
  final SFX note rang for two frames instead of one, asymmetric with the Silence branch's own
  immediate write. Traced the reviewer's own proposed fix against the 6502 traps and `music_
  channel`'s register contract before adopting it, not merely applying it: confirmed `X` survives
  untouched from `sfx_channel_tick`'s own entry to the tail-call point, confirmed the loop continues
  correctly on return (the `jmp`-not-`jsr` shape already documented elsewhere in this codebase for
  `use_item`/`player_died`), and confirmed `force_trig`'s own check inside `music_channel` fires on
  that exact same call. Both audible co-end cases retraced against the corrected mechanism. `rts` →
  `jmp music_channel`, +2 bytes (53 → 55). §3.3, §3.4, §5.2, §8.
- **Finding 2 (high — fit/refusal analysis compared a Sting-paid marginal cost against rows that do
  not carry Sting).** Confirmed: none of Part 1's own costing rows include a live Sting, so every
  comparison must use the Sting-free marginal cost (≈303, not 288/286). Recomputed the total from
  finding 1's own corrected figure first (303 = 288 + 15), then redid the matrix once against every
  Part-1 row with its own baseline stated explicitly. **Five rows newly refused, not the reviewer's
  four alone**: MMC1 Save+Move+item, MMC1 Save+Move-no-item (this design's own honest arithmetic —
  round 1's rounding had put this row at −2, this round's own 303-based figure makes it an
  unambiguous, if razor-thin, −4), MMC3 ALL-7-verbs+Move+item-no-Save, UNROM 512 Save-only-w/-item,
  and UNROM 512 ALL-7-verbs+Move+item-no-Save. Added a worked Sting-already-live example (constructed,
  since no Part-1 row carries one) showing the 288-only figure applies only once a row's own headroom
  already has Sting's 175 subtracted, with both a refusal and a fits case to check the distinction
  matters. §3.12 rewritten in full; §7 test 15 expanded from two rows to six, plus two Sting-already-
  live tests.
- **Finding 3 (high — two proposed APU assertions are impossible/wrong for the real APU).** Confirmed
  `renderer/emulator/core/papu/index.js:107-132`: `$4015` is a status register on read, constructed
  from live length-counter/DMC/IRQ bits, not a latch of the last write — reading it back after
  writing `$0F` need not return `$0F`. Test 2 corrected to intercept the `$4015` write itself
  (noting `test/unit/music.test.js`'s own existing `recordRomActivity` interception range, `$4000-
  $400F`, does not currently cover `$4015` and needs extending). Confirmed `engine/music.asm:139-177`
  and `renderer/forges/sound/replayer.js:73-128` both write every active channel's own register every
  frame regardless of note activity — test 4 corrected from "completely absent" to "matches the
  no-SFX baseline trace, unchanged," since "absent" directly contradicted §1's own "continues
  untouched" requirement (untouched means normal, expected writes continue, not that writes stop).
  Test 3's own immediate-cleanup assertion — the one that actually exposed finding 1 — kept exactly
  as specified. §7 tests 2 and 4.
- **Finding 4 (medium — whole-ROM byte-identity promise still false for authored-but-unreferenced
  effects).** Confirmed §3.8 carried no kernel-lo qualifier despite round 1's own §3.10 claiming the
  promise was kernel-lo-only, and that unconditional `sfxTables(project.sfx)` emission genuinely does
  grow kernel-hi for an authored, unreferenced effect with `SFX_ENABLED` still 0. Decided explicitly,
  against the precedent cited last round: **kept unconditional table emission** (matches `songTables`'
  own existing, order-independent behavior for songs; gating by `SFX_ENABLED` would make capacity
  depend on authoring order, which this codebase does not do for songs and should not invent here) and
  **narrowed the promise** instead, rather than reversing the emission decision. §3.8's own promise now
  reads "no authored effects and no live command," §3.10's reasoning corrected to match, and test 13
  fixed to pin the same authored catalog on both sides (round 1's version could not actually isolate
  the `off` flag's own cost) with a new test 14a asserting the narrower promise's own boundary directly
  (an authored-but-unreferenced effect *does* grow kernel-hi, checked against the identical, parallel
  fact for an unreferenced song). §3.8, §3.10, §7 tests 13/14/14a.
- **Finding 5 (medium — the document directs readers to "§3.3's full sketch" for `music_tick`, but no
  such sketch exists).** Confirmed by search: no `music_tick:` label or `ora sfx_state` instruction
  appeared anywhere in the document. Restored the complete conditional-assembly body — entry gate,
  SFX-channel diversion, normal-channel Silence re-check, all labels and branch targets, and the
  `SFX_ENABLED = 0` collapse traced explicitly down to today's unmodified 8-instruction body — and
  recounted directly from that final body per the brief's own instruction, confirming 22 bytes
  unchanged from round 1's own (previously undocumented) figure. §3.3, §5.2, §8.
- **Finding 6 (medium — the step cap has no authoring guard and is mischaracterized as a format
  limit).** Confirmed the compiled stream has no addressing reason to cap step count at 8 (`sfx_ptr_
  lo/hi` is a genuine 16-bit pointer, the whole-effect duration is computed separately from step
  count) — `SFX_MAX_STEPS`'s own comment corrected from "format-level fact" to "authoring/product
  limit," explicitly distinguished from `NUM_NOTES`/`MAX_INSTRUMENTS`/`MAX_PERIOD`'s own genuine
  hardware/format ceilings it was wrongly grouped with. Added a second, independent Add-button gate
  (the step editor's own "Add step," at `SFX_MAX_STEPS`/`LIMITS.sfxSteps`) beside the existing
  Add-effect gate at `LIMITS.sfx` — round 1 gated only the latter. Decided the over-cap load policy
  explicitly: truncate-on-normalize, following `choice`'s own extra-options and `normalizeSong`'s own
  instrument-list precedent (a step has no outside reference the way an actor/item/effect id does, so
  it is not the preserve-and-refuse shape `LIMITS.sfx` itself correctly uses one level up). Added the
  editor-boundary test. §3.2, §3.9, §7 test 20a.

### Round 3 — against that round's own review, all three findings accepted

- **Finding 1 (high — the 5-byte `sting_restore_silence` guard was classified as SFX-standalone code,
  but it can only assemble when both features are live).** Confirmed directly: `sting_restore_
  silence` sits entirely inside the shipped outer `.if STING_ENABLED` block (`engine/music.asm:376-
  454`), so the guard's own nested `.if SFX_ENABLED` requires both flags true to assemble at all — a
  project with SFX and no Sting never pays these 5 bytes, and one with Sting and no SFX pays for the
  routine but not the guard. Pulled the term out of `SFX_KERNEL_ALLOWANCE_STANDALONE` (288 → 283) into
  a new, explicitly-named `STING_SFX_INTERACTION_ALLOWANCE` (5), gated `usesSting && usesSfx` in
  `kernelCodeBytes`. Recomputed §3.12's entire matrix from this corrected total first (298, not 303)
  before redoing the fit/refusal table once, per the brief's own instruction — **four rows newly
  refused, not five**: MMC1 Save+Move+item, MMC3 ALL-7-verbs+Move+item-no-Save, and both UNROM 512
  rows; **MMC1 Save+Move-no-item moves from a refusal (round 2's own −4) to a fit (+1, razor-thin)**,
  now a dedicated fit-control test rather than a refusal test. Confirmed, not merely asserted, that
  `kernelShortfallAdvice`'s existing ask-`kernelCodeBytes` mechanism already reports the interaction
  term correctly when Sting alone is dropped from a both-live project (the term's own `&&` clause
  evaluates false the moment `usesSting` does, with no special-casing needed — the identical
  Move/Face-shared-term reasoning already established, now confirmed to extend to three terms).
  Sections: §3.6 (decomposition and the interaction-term reasoning), §5.1/§5.2 (the formula and the
  code sketch's own reclassification note), §3.12 (matrix redone), §7 (tests 9, 11, 12, 15 realigned),
  §8 (rollup redone).
- **Finding 2 (medium — §3.4 still said "next ordinary `music_channel` call" after the tail-call fix,
  and the cleanup/Silence co-end trace hid a same-frame overwrite).** Fixed the stale sentence: the
  "SFX ends first" bullet now correctly says the sting's own noise part resumes via the *same-tick*
  tail-call (round 2's own fix), not a later ordinary loop visit. Traced the exact cleanup-frame
  co-end into Silence by hand: `sfx_channel_tick`'s own tail-call retriggers the sting's paused
  content, `sting_restore_silence` runs later the *same* frame (`sting_tick` after `music_tick`,
  `engine/boot.asm`), sees `sfx_state` already reset to 0 by SFX's own cleanup, and correctly does not
  suppress its own `$400C = $30` write — overwriting the just-retriggered sting content before it is
  ever heard. Confirmed this is **inherited Sting behavior, not an SFX regression**, by tracing the
  identical scenario with no SFX involved at all: an ordinary sting-into-Silence frame already has
  `music_tick`'s own normal per-channel tick apply the sting's true final note, immediately followed
  the same frame by `sting_restore_silence`'s own unconditional overwrite — the same double-write,
  same-frame mechanism, with or without SFX. Chose, per the brief's own two options and its "do not
  silently expand scope" instruction: **preserved the legacy truncation rather than pricing a fix**,
  narrowed §1's own invariant and §3.4's own conclusion to state precisely what is and is not
  guaranteed (SFX's own final frame is never dropped; the sting's own final frame can still be
  truncated on this one co-end sub-case, exactly as it already can be without SFX), and flagged the
  tree's own over-claiming comment (`engine/music.asm:440-444`) as a named, out-of-scope observation
  — the identical treatment §3.9 already gives the `renumberSongDeletion` gap, not a fix. Test 8
  revised to pin the exact APU write order on this one sub-case (the retrigger write, then the
  overwrite, asserted as the correct expected behavior) rather than leaving its trace implicit.
  Sections: §1 (new caveat), §3.4 (both bullets rewritten), §7 test 8.
- **Finding 3 (low — the documented free RAM span was six bytes short).** Confirmed:
  `flip_pending_count = $0567`, `flash_driver = $0600`, `0x600 − 0x568 = 0x98 = 152` bytes, not 146.
  This design's own 8-byte allocation still fits comfortably (144 bytes remain free) — only the
  factual count needed correcting. Section: §4.

### Round 4 — against that round's own review, all four findings accepted (final wording
round; no further substantive review round required per the reviewer's own verdict)

- **Finding 1 (medium — §3.6's primary decomposition table still said `AUDIO_FX_KERNEL_ALLOWANCE` is
  "0 new bytes," contradicting the ≈15-byte figure used everywhere else in the document).** The table
  cell that *introduces* the constant is the one place an implementer would read it in isolation, and
  it disagreed with the term's own real value. Replaced with the reviewer's own exact framing:
  "≈15 bytes, decomposed from the existing Sting cost; zero net-new bytes in a Sting-only build" — the
  allowance itself is not zero; only a Sting-only project's own *total* stays unchanged when the block
  is re-gated, because it was already paying for this code. Section: §3.6.
- **Finding 2 (low — test 11's Sting-only assertion asked for something `game.fns` cannot express).**
  Confirmed the reviewer's own point: nesasm's symbol table lists labels, not individual instructions,
  and the `sting_restore_silence_skip_noise` label itself sits outside the guarded `.if SFX_ENABLED`
  block, so it can appear in a Sting-only build's own symbol file even when the guarded instructions
  do not assemble — "absent from the symbol table entirely" was not a fact nesasm's own output could
  confirm. Replaced with the reviewer's specified mechanism: measure the `sting_restore_silence`/
  `sting_restore_silence_skip_noise` address span in a Sting-only build and in a both-live build, and
  assert the both-live span is exactly 5 bytes larger (a listing or binary diff of the routine works
  identically). Section: §7 test 11.
- **Finding 3 (low — "only the second write is ever heard" overstates what immediate APU register
  semantics actually guarantee).** Confirmed: the first of two same-frame writes to one register is
  not inaudible outright — its value is real for the CPU cycles before the second write — it simply
  does not survive to be heard as a full authored frame, which for a short transient reads as
  effectively silent but is not the same physical claim. Replaced both occurrences (§3.3's own
  same-frame-fix-does-not-work argument, and §3.4's inherited-Sting-truncation trace) with the
  reviewer's specified framing: "truncated to the interval before the second write, rather than
  receiving its authored full frame." Also corrected one adjacent sentence in §3.4 making the
  identical overclaim in different words ("never actually heard"), for internal consistency within
  the same paragraph the review's own two citations sit in — not a new finding, the same wording fix
  applied where the same imprecision recurred one sentence away. Test 8's own pinned write order is
  unchanged, per the review's own note that it needs no mechanical change. Sections: §3.3, §3.4.
- **Finding 4 (low — two summary lines retained superseded wording from before round 3's own
  correction).** §3.12's own "Tests the implementation will need to write" paragraph still opened
  with "four refusal rows" despite correctly listing five total (four newly-refused plus the
  already-known MMC3 Save+Move-no-item) later in the same sentence — replaced the opening count with
  the reviewer's own exact phrasing, "four newly-refused rows plus the already-known refusal." §9's
  own kernel-diet item called 288 "the ... total" with no qualifier, ambiguous now that the
  decomposition has three separate figures (283 exclusive, ≈298 Sting-free marginal, 288
  Sting-already-live marginal) — named the intended baseline explicitly (the Sting-already-live
  marginal cost) rather than leaving 288 to stand alone. Left the Fix rounds changelog's own
  historical 286/303/five-refusal figures untouched, per the review's own explicit exemption — they
  describe what past rounds changed, not current promises. Sections: §3.12, §9.

### Implementation — measured values, per the implementation brief's own instruction that
the design changelog receive one line per allowance term once real nesasm figures replace the
pre-implementation estimates above (§8's own table stays as the historical record of what was
estimated before any of this was built; this entry is the measured record alongside it, not a
silent edit to it)

- `STING_KERNEL_ALLOWANCE_STANDALONE`: estimated 160, **measured: 160** (unchanged).
- `AUDIO_FX_KERNEL_ALLOWANCE`: estimated ~15, **measured: 15** (unchanged) — direct label-address span
  in `game.fns` (`music_channel`..`music_channel_tick`: 13 bytes with neither feature live, 28 with
  either live), not a subtraction of two larger totals.
- `STING_SFX_INTERACTION_ALLOWANCE`: estimated 5, **measured: 5** (unchanged) — direct span
  (`sting_restore_silence`..`sting_tick`: 17 bytes Sting-only, 22 both-live).
- `SFX_KERNEL_ALLOWANCE_STANDALONE`: estimated 283, **measured: 295** (+12 bytes) — solved from three
  real kernel-total deltas (Sting-only 175, SFX-only 310, both-live 475) minus the two span-measured
  terms above; internally consistent (160 + 295 + 15 + 5 = 475, exactly the independently measured
  both-live total). See `main/build/generate.js`'s own comment beside the constant, and
  `docs/sfx-implementation-report.md` §1 for the full account, including the two documented-limitation
  rows this 12-byte deviation moved (and code review round 1's own correction to a fixture bug that
  had misattributed a further, unrelated row to this same deviation — see that report's §3).
