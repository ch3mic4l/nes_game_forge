# Design: the `Sting` cutscene verb (item 6, sound effect slice)

Status: design only, no code written, no tracked file touched. Companion precedent: Fade
(`handoff-fade/design-fade.md`) and Flash (`handoff-flash/design-flash.md`) are the designs this
slice is required to build on, both in mechanism (the frozen-vs-unfrozen split, the shared-array
copy trick) and in document format. The costing pass (`handoff-costing/costing-report.md`, closed
after three review rounds) priced this exact shape — shape (b), "the whole song pauses, the sting
plays alone through the unmodified driver, then the song resumes exactly where it left off" — at
**145-157 kernel-lo bytes**, and its Part 2 "Sound effect / sting" section is reused verbatim
below wherever it settled a question; nothing there is re-derived. This design resolves the
questions the costing pass deliberately left open, lands its own instruction-level total, and
reconciles the difference. Written against HEAD `4a4be92` plus the uncommitted CLAUDE.md edit
documenting the costing pass's Part-1 findings (MMC1 ALL-verbs+Save+Move+item refused at 296
short; UNROM 512 Save+Move-no-item refused at 88 short) — neither of those two findings is
disturbed by anything here, since Sting is a kernel-hi/`$0300+`/kernel-lo cost with its own,
separate documented limitation (below), not an addition to either existing one.

**Revised twice.** Round 1 against `handoff-sting/sting-design-review1.md` (12 findings, all
confirmed by the orchestrator against engine/compiler source before the fix brief was written) —
three findings (2, 4, and the destructive-`NO_SONG` half of 8) were real defects that would have
shipped broken or silently refused-when-it-shouldn't. Round 2 against
`handoff-sting/sting-design-review2.md` (1 high, 3 medium, 2 low, all confirmed) — the high finding
would have broken two existing files' own module loading outright (§4); the mediums fixed a
normalization-boundary gap, a charging sketch that didn't fit the real shape of `generate.js`, and
a test that didn't exercise the recursion it claimed to guard; the lows corrected two sabotage
claims that overstated what their own assertions actually proved, without changing the design
itself. See "Round 1 revisions" and "Round 2 revisions" at the end for what moved and why in each.
The 176-byte kernel-lo headline is unchanged by round 2 — every round-2 finding is a JS-module-graph,
layering, wiring, or test-contract fix, not an engine-code change.

## §1. What Sting is, and the wire format

A scripted command that pauses whatever song is currently playing, plays a second, short song
(the "sting" — a fanfare, a jingle, a stinger) alone through the same unmodified 4-channel driver,
and resumes the original song exactly where it left off — same channel pointers, same envelope
step, same note-in-progress — once the sting's own compiled length has elapsed, **provided nothing
else asks the driver to play a song in the meantime** (§5, mechanism 2 — an intervening request,
even for the same field song, cancels the resume rather than seaming into it). It does not suspend
the calling script (§3). It costs the author no duration field: the compiler measures the sting
song's own length and bakes it in (§4).

Wire format:

```
[OP_STING, songByte, durationFrames]
```

Three bytes total — one opcode (`OP_STING = $1A`, §10), one song reference (the same
`songByte(project.songs, id)` resolution `music` already uses, moved to `shared/audio.js` in this
revision, §4/§10; `NO_SONG = $FF` sentinel), one compiler-computed duration in frames, clamped to
a single byte (§4). Compare `OP_MOVE`'s four bytes (`who`, `dir`, `dist`) and `OP_WAIT`'s two (just
the frame count) — Sting sits between them, and like both, `script_skip` advances past the whole
command before anything branches on its operands (§3, §7).

## §2. What I read

`engine/music.asm` (329 lines, in full): `music_channel`, `music_play` (including its own
`ldx #0` / `cpx #MUS_CHANNELS` channel-init loop, load-bearing for round-1 finding 1, §7),
`music_stop`, `set_music`, `apply_map_music`, the loop-jump (`MUS_LOOP = $FF`) handling, and the
exact call site of `music_tick` in `boot.asm`'s `main_loop`. `engine/constants.asm`'s complete
zero-page and `$0300+` allocation map, confirmed address-by-address (§6), and its `OP_*` numeric
table (§10). `engine/script.asm`'s suspending (`OP_MOVE`, `OP_WAIT`) and non-suspending (`OP_TURN`,
`OP_FLASH`) command shapes, `script_op_give`'s `NO_ITEM`-skip shape (the round-1 finding-8
precedent, §7), and `script_resume`. `engine/entities.asm`'s `move_tick`, `wait_tick`, `flash_tick`
in full. `engine/ui.asm`'s `ui_tick` dispatch chain and its mutual-exclusion argument.
`engine/banks.asm`'s `call_battle` trampoline. `engine/rpg.asm`'s `battle_begin`/`battle_end` in
full (no music code in either). `engine/combat.asm`'s `init_session` and `player_died` in full.
`engine/title.asm`'s `restart_game`. `main/build/songcompile.js` and `shared/audio.js` in full
(song format; `timeline()`'s exact row/loop-index semantics, re-derived carefully in this revision
after round-1 finding 2 showed the first draft misread them). `renderer/forges/sound/replayer.js`.
`test/unit/music.test.js` (510 lines, in full, including the exact assertions of `'a game over
into a Silence map actually silences the APU, not just cur_song'`, re-read directly for round-1
finding 5). `test/unit/move.test.js` (407 lines, in full), `test/unit/kernelbytes.test.js`'s
droppable-advice, documented-limitation, and per-mapper-equality test shapes. `shared/project.js`'s
`EVENT_COMMANDS`, `IMPLEMENTED_COMMANDS`, `LIMITS`, `CHOICE_LIMITS`, `projectUsesMove` and its five
siblings, and `validateProject`'s Give/Take and `call` refusal checks. `main/build/textcompile.js`'s
`music` compile case, `songByte`, and `opIndex`'s exact export shape (`OP_SAY`/`OP_CALL`/
`OP_MUSIC`/`OP_BATTLE`, round-1 finding 10). `renderer/forges/map/events.js`'s `music` and `flash`
field-editor cases. `main/build/generate.js`'s `MOVE_ENABLED` generation site, `kernelShortfallAdvice`
in full, the `musicBytes`/kernel-hi budget check, and the flat-vs-per-mapper allowance constant
styles. `main/smoke.js`'s real Flash-authoring scenario (the exact DOM-selector shape a Sting smoke
scenario has to match, round-1 finding 12). `handoff-fade/design-fade.md` and
`handoff-flash/design-flash.md` in full, as the format template. For round 2: `main/build/
generate.js`'s own import line for `songByte` (line 37) and the exact line numbers/local-scope
shape of `kernelCodeBytes` (622, one `return` expression starting at 675), `kernelShortfallAdvice`
(905), and `generateAssets` (1511) — each independently computing its own local `usesMove` (round-2
finding 3). `test/unit/script.test.js`'s own `NO_SONG` import line (26). `shared/audio.js`'s
`normalizeSong` in full (round-2 finding 2 — confirmed it guarantees a nonempty `order`, at least
one row per pattern, and `framesPerRow >= 1`, so only the `NO_SONG` fallback, never a normalized
song, can compile to a zero-frame Sting duration).

## §3. Central decision: Sting does not suspend the script

Non-suspending, ticked unconditionally from `main_loop` — Flash's shape, not Fade's or Move's.
Unaffected by round 1.

The costing pass's own shape-(b) pricing already assumes this: its `sting_left countdown
(top-level, not per-channel)` row is priced as a flat per-frame check with no `ui_tick`
integration, and its `script_op_sting` trigger row is priced as a non-suspending trigger (an
"arm and continue" op, not an "arm and return" one). This design confirms that assumption rather
than reopening it, for three reasons:

1. **An author who wants the script to hold for the fanfare can already compose it**: `Sting`
   followed by `Wait N` (the sting's own duration, or longer). Building suspension into Sting
   itself would duplicate `wt_left`'s own mechanism inside a second suspending op for a shape the
   existing primitive already covers.
2. **A suspending Sting would need a new entry in `ui_tick`'s frozen-world chain** — `mv_left`
   /`wt_left`/`fade_left` are pairwise-exclusive today *by construction*: a script suspends on
   whichever of Move/Wait/Fade it reaches first and cannot reach a second until the first resumes.
   A suspending Sting would need to join that exclusion group, changing `script_start`'s reset
   list and `ui_tick`'s dispatch chain — real, unpriced surface area the costing pass's total does
   not include.
3. **A musical sting is exactly the case where the world usually shouldn't freeze.** A pickup
   jingle, a level-up fanfare, a hazard warning — the common case is "keep playing while this
   plays," the same argument Flash's own design makes for why the screen flash doesn't pause the
   game either. The suspending case (a cutscene stinger that really should hold the frame) is the
   less common one, and `Wait` already expresses it without adding an option to a command that
   would otherwise never need it.

**Consequence for `script_start`**: no change. `script_start` resets `mv_left`, `wt_left`, and
`fade_left` at the top of every new event — Sting is not one of the mutually-exclusive three, so
it needs no reset there, matching `flash_left`'s own precedent (also absent from that reset list).
A sting armed by one event and still counting down when a *different* event starts is not reset by
`script_start` — is this correct? Yes: the sting is scoped to the *song*, not the script that
triggered it, and a second event starting while a sting from an earlier one is still playing is
exactly the "does not suspend" case working as intended — the new event's own commands run
immediately, on top of a sting still resolving in the background. If the new event tries to change
music, the cancellation lifecycle (§5, mechanism 2) is what governs the interaction, not
`script_start`.

**Consequence for the state machine.** Unlike Flash (a three-state machine — idle / counting /
pending-restore — needed because its resume writes to `vram_buf`, which can race an NMI drain),
Sting's resume touches only RAM shadow state and APU registers directly. There is no VRAM packet,
no drain race, and therefore no need for a third state: `sting_left` is a plain two-state counter
(`0` = idle, non-zero = counting down), the same shape as `wt_left`, ticked once per frame,
unconditionally, from `main_loop`, after `music_tick` (§7 — the relative order between the two is
timing-critical; immediate source adjacency is a maintainability convention, not itself
load-bearing — corrected in round 1, finding 6, and clarified in round 2, finding 5).

## §4. Duration: compiler-computed, not author-supplied

**Resolved, not open — the formula itself is corrected in this revision (round-1 finding 2).** The
costing pass left this an open question; the first draft of this design closed it, but with the
wrong scalar. Re-derived carefully this time, directly against `main/build/songcompile.js`:

`timeline(song)` builds one shared `rows` array — every row of every pattern in `song.order`, in
play order, flattened — and a `loopRow` marking where playback jumps **back to** once it reaches
the end. **`loopRow` is the loop's target, not the point at which the first loop-back happens.**
`channelEvents()` (called once per channel against this same `rows`/`loopRow` pair) walks every row
in `rows`, from index 0 through `rows.length - 1`, building one continuous per-channel event stream
over the *entire* range; `compileSong`'s own `loopOffset` marks the byte position within that
stream corresponding to `loopRow`, but the compiled stream still encodes the whole pass — the
driver plays through all of it, head and tail alike, once, and only jumps back to `loopOffset`
after reaching the very end (`MUS_LOOP`). **So a sting's own one-time duration is `rows.length *
framesPerRow` — the full first pass through the song's whole authored order — not `loopRow *
framesPerRow`.** With the schema's own default `loop: 0`, `loopRow` computes to 0 (the loop target
is the very start of the order), and the first draft's formula turned that into a duration of 0
frames: `script_op_sting` would arm `sting_left` with 0, which the countdown (§7) never
decrements away from idle — the sting would play forever, exactly the bug round-1 finding 2 named.
The corrected formula gives the real, nonzero length of one full pass regardless of where `loop`
points, because `rows.length` is the length of the *whole* order, computed independently of the
loop index.

The "uniform across every channel" claim from the first draft survives unchanged, for the identical
reason: `rows` — now the relevant scalar, not `loopRow` — is a single per-song value, computed once
by `timeline()` and reused unchanged for all four `channelEvents()` calls. A sting's duration
cannot differ between channels under the current song schema, whichever of the two scalars turns
out to be the right one.

This makes compiler-computed duration strictly better than an author-supplied one, for a concrete
reason beyond "the author doesn't have to think about it": an author-supplied duration can drift
from the song the moment the song is re-edited (verses added, a loop point moved), silently
cutting the sting off early or leaving dead air before the resume. A compiler-computed duration is
recomputed on every build from whatever the song currently is — it cannot go stale. **Decision:
no author-facing duration field. The Sound Forge song *is* the duration.**

**Mechanism — moved to `shared/audio.js`, not threaded through `compileSong`'s own return value
(round-1 finding 9, alongside the formula fix above); the raw/normalized boundary made explicit
and the old `textcompile.js` exports kept working (round-2 findings 1 and 2).** The first draft
proposed exposing `loopRow` from `compileSong()` itself — wrong scalar, and the wrong layer:
`shared/project.js`'s `validateProject` needs this exact duration figure too (for the 255-frame
ceiling, §10) and cannot import from `main/build/songcompile.js` (`shared/` modules are imported by
main, renderer, and `node:test` alike, and must never depend upward on `main/build` — the direction
every other single-writer rule in this codebase already runs). The fix: `timeline()` needs none of
`compileSong`'s own per-channel note/instrument compilation — it is purely structural (`song.order`,
each pattern's row count, `song.loop`) — so it moves to `shared/audio.js` outright, alongside a
small duration helper and the song-reference resolution `music` already has:

```js
// shared/audio.js
export const NO_SONG = 0xff;

export function songByte(songs, id) {
  if (id === null || id === undefined) return NO_SONG;
  const n = Number(id);
  return Number.isInteger(n) && n >= 0 && n < (songs?.length ?? 0) ? n : NO_SONG;
}

// Moved from main/build/songcompile.js's own timeline(): purely structural (song order and
// pattern row counts, the loop index), no per-channel note/instrument data, so it has no
// main/build dependency and can be shared by the compiler and validateProject alike. Takes an
// ALREADY-NORMALIZED song, the same boundary compileSong's own private timeline() always assumed
// -- songFrameLength below is the raw-song entry point every direct caller outside compileSong
// itself should use instead of calling this directly (round-2 finding 2).
export function songTimeline(normalizedSong) {
  const rows = [];
  let loopRow = 0;
  normalizedSong.order.forEach((patternId, orderIndex) => {
    if (orderIndex === normalizedSong.loop) loopRow = rows.length;
    const pattern = normalizedSong.patterns[patternId] ?? normalizedSong.patterns[0];
    for (let row = 0; row < pattern.rows; row++) rows.push({ pattern, row });
  });
  return { rows, loopRow };
}

// A song's own duration as a Sting: one full pass through every row of song.order before the
// first loop-back -- rows.length, not loopRow (see design-sting.md §4). Normalizes its own input
// -- the single place this boundary is enforced, not duplicated at each call site -- so a direct
// caller (the compiler, validateProject) can hand it a raw, possibly hand-edited or legacy song
// exactly the way compileSong's own callers already can, and get the identical duration compileSong
// itself would compute. Returns frames, uncapped; the 255-frame Sting ceiling is enforced by
// callers, not here, so this stays a fact about the song, not a policy about Sting.
export function songFrameLength(rawSong) {
  const song = normalizeSong(rawSong);
  return songTimeline(song).rows.length * song.tempo.framesPerRow;
}
```

`main/build/songcompile.js`'s own private `timeline()` is deleted and replaced with an import of
`songTimeline` from `shared/audio.js`, called on `compileSong`'s own already-normalized `song`
(`compileSong` still calls `normalizeSong(rawSong)` first, exactly as today, and passes the
*normalized* value into `songTimeline` — it does not call `songFrameLength`, since re-normalizing a
value it has already normalized would be redundant, not wrong, but there is no reason to pay for
it). `compileSong()` itself is otherwise unchanged, and every existing caller of it is unaffected.

**Existing external imports of `songByte`/`NO_SONG` from `textcompile.js` keep working, via an
explicit compatibility re-export — round-2 finding 1.** The first draft's "consumed identically by
the compiler and `validateProject`" language skipped over two existing importers this design's own
§2 source inventory had already named but not checked against the move: `main/build/generate.js`
(`import { NO_EVENT, compileText, textTables, songByte } from './textcompile.js'`, its own line 37)
and `test/unit/script.test.js` (`import { ..., NO_SONG, ... } from '../../main/build/textcompile.js'`,
its own line 26). Moving the definitions to `shared/audio.js` without also keeping these two names
reachable from `textcompile.js` would make both files fail at module-instantiation time — an ESM
import of a name a module no longer exports is a load-time error, not a runtime one, so this would
break before any test's own logic even ran. `textcompile.js` now imports the real definitions for
its own internal use (its `sting` and `music` compile cases both need them) and re-exports the two
names verbatim, rather than requiring `generate.js` or `script.test.js` to change what they import
from:

```js
// main/build/textcompile.js
import { NO_SONG, songByte, songFrameLength } from '../../shared/audio.js';
export { NO_SONG, songByte };   // compatibility: main/build/generate.js:37 and
                                  // test/unit/script.test.js both still import these names from
                                  // this module; shared/audio.js (above) is the single-writer
                                  // definition now, this is a re-export of it, not a second copy
```

`main/build/textcompile.js` computes each `sting` command's duration operand from the shared
helper:

```js
case 'sting': {
  const songIndex = songByte(project.songs, command.song);
  if (songIndex === NO_SONG) return [OP_STING, NO_SONG, 0]; // guarded at runtime too -- §7,
                                                               // round-1 finding 8
  const frames = songFrameLength(project.songs[songIndex]);
  // frames > 255 is also a validateProject error (§10); this Math.min is the compiler's own
  // matching guard so a hand-edited or later-version project cannot silently wrap a long
  // sting's duration into a short, wrong one.
  return [OP_STING, songIndex, Math.min(frames, 255)];
}
```

**Why refuse rather than clamp a >255-frame sting**, matching this codebase's standing policy
(the `NO_METASPRITE`/`LIMITS.metasprites` precedent: "an already-over-cap project is refused...
not silently sliced," and the door-target clamp trap CLAUDE.md names as the shape to avoid): a
silently truncated sting duration is real, audible wrongness — the song keeps playing past what
`sting_left` will wait for, so the "resume" fires mid-note and the original song's resumed
position no longer lines up with what the player actually heard. 255 frames is 4.25 seconds at 60
fps, generous for anything actually called a "sting"; a song that long is almost certainly
authored as ordinary music, not a sting, and the refusal message should say exactly that
("`<name>` is 4.6s long — a Sting's own song must resolve its own full pass within 255 frames
(4.25s at 60fps). Shorten the song or pick a different one.").

## §5. The two shared mechanisms and the shape-(b) state machine

Reused verbatim from the costing pass — designed in detail here, not re-litigated, per the brief.
Mechanism 2's policy is corrected in this revision (round-1 finding 3); mechanism 5 is demoted
from a correctness fix to state hygiene (round-1 finding 7).

### Mechanism 1 — `force_trig`

`music_channel` clears `mus_trig,x` at the very top of *every* call (`engine/music.asm:127-129`,
confirmed directly: `lda #0 / sta mus_trig,x`, before `music_apply` is ever reached). Restoring a
shadowed `mus_trig` value therefore does nothing — the very next tick erases it before anything
reads it. The fix is a second, self-clearing flag checked *after* the ordinary clear:

```asm
music_channel:
  lda #0
  sta mus_trig,x
  .if STING_ENABLED
  lda force_trig,x
  beq music_channel_noforce
  lda #0
  sta force_trig,x
  lda #1
  sta mus_trig,x
music_channel_noforce:
  .endif
  lda mus_dur,x
  ...                        ; unchanged from here
```

15 bytes (`lda force_trig,x`(3, absolute,X) + `beq`(2) + `lda #0`(2) + `sta force_trig,x`(3) +
`lda #1`(2) + `sta mus_trig,x`(3, absolute,X)), `.if STING_ENABLED`-gated so it costs a
sting-free project nothing and leaves `music_channel`'s existing two-instruction clear
byte-identical when the gate is closed.

### Mechanism 2 — cancellation lifecycle, corrected policy (round-1 finding 3)

`music_play` (`engine/music.asm:63`) opens with `sta cur_song`, using `A` for the song index
throughout. A naive cancellation check placed before that line clobbers the argument. It must run
*after* `cur_song` is stored, with `A` preserved around it:

```asm
music_play:
  sta cur_song
  .if STING_ENABLED
  pha                        ; the song index is still needed below
  lda sting_left
  beq music_play_no_cancel
  lda #0
  sta sting_left
music_play_no_cancel:
  pla
  .endif
  cmp #NO_SONG
  ...                        ; unchanged from here
```

12 bytes (`pha`(1) + `lda sting_left`(3, absolute) + `beq`(2) + `lda #0`(2) + `sta sting_left`(3,
absolute) + `pla`(1)). This code is unchanged from the first draft — round 1 corrected the *prose*
around it, not the routine.

**Corrected policy — this is shape (a)'s reasoning, not shape (b)'s, and the first draft
generalized it wrongly.** Verified directly: `music_play(stingIndex)` — what `script_op_sting`
calls to actually play the sting (§7) — stores the *sting's own* song index into `cur_song` as its
very first instruction. From that moment until `sting_restore` runs, **`cur_song` holds the sting's
index, not the field song's.** `set_music`'s own dedup (`cmp cur_song / beq set_music_done`,
confirmed directly, `engine/music.asm:27-32`) therefore only catches a request naming the *sting*
itself while it is already playing — a narrow, real case (the identical `Sting` command
re-triggering the identical song mid-flight is already handled a level up by mechanism 4's own
"second sting replaces the first" rule, before `set_music` is even reached). **Every other
request — including one naming the original field song the player was hearing before the sting
started — sees a `cur_song` that does not match, reaches `music_play`, and cancels the sting.**

**Consequence, stated plainly: resume-in-place is a property of an *undisturbed* sting only.** A
script that fires `Sting` and then, before it resolves, plays the field song again — even by name,
even the identical song the player was already hearing — does not get a seamless resume. It gets
an ordinary `music_play` restart of that song from byte zero, exactly as if the sting's own shadow
had never been taken; the shadow is simply dropped, unread, on cancellation. This is the correct,
if less magical, behavior: the driver has one `cur_song` slot, and a sting simply borrows it for
its own duration. `sting_left` reading 0 after such a request is the entire observable difference
between "the sting cancelled" and "the sting is still counting down" — there is no separate
cancelled/uncancelled flag to keep in step with it.

The costing report's own "a request naming the song already playing is already a no-op" passage
*is* accurate — for shape (a) specifically, where `cur_song` never changes at all (only one channel
is borrowed; the other three, and the shadow of "what's playing," are untouched throughout). It
does not carry over to shape (b), where playing the sting is exactly what changes `cur_song`. The
first draft of this design made precisely this generalization error; recorded in the revisions
section at the end.

A direct Code Forge call to `music_play` bypasses `set_music`'s dedup entirely and always restarts
the song from byte zero (`music_play` does not check `cur_song` itself, only `set_music` does) —
the cancellation check above still fires correctly in that case, since it lives inside `music_play`,
not `set_music`.

**`init_session` bypasses `music_play` and `set_music` entirely** — it calls `music_stop` directly
(`engine/combat.asm`, confirmed: `jsr music_stop` is the only music-related line in the whole
routine). A sting mid-flight at the moment of a game over or a fresh boot would leave `sting_left`
counting down into the *new* session, and `sting_tick` (§7) would eventually fire `sting_restore`,
splicing the *old* session's own shadowed song state into the new one — audible, wrong, and hard to
reproduce (it depends on exact frame timing across a game-over). The fix is one more line in
`music_stop` itself, since every silencing path funnels through it:

```asm
music_stop:
  lda #NO_SONG
  sta cur_song
  lda #0
  sta mus_enabled
  .if STING_ENABLED
  sta sting_left             ; A is already 0 from the line above
  .endif
  lda #$30
  sta $4000
  sta $4004
  sta $400C
  lda #0
  sta $4008
  rts
```

3 bytes (`sta sting_left`, absolute — RAM, not zero page, see §6). `music_stop`'s four existing
silencing writes are **untouched, still inline** — no refactor into a shared subroutine (see the
callout at the end of this section for why that specific temptation is a trap).

### Mechanism 3 — Silence restore

If the shadowed state is Silence (`mus_enabled = 0`), restoring the flag alone leaves the sting's
last-written APU values latched forever: `music_tick`'s very first instruction is `lda mus_enabled
/ beq music_tick_done`, so once `mus_enabled` goes back to 0, nothing will ever touch
`$4000-$400F` again — the hardware has to be explicitly re-silenced somewhere in the restore path
(`music_stop`'s own four writes, reused inline — §5's own callout on why they are not factored into
a shared subroutine). `sting_restore` (§7) writes the shadowed `mus_enabled` flag first and, only
in the branch where that value is 0, the four silencing writes after. **The order between those two
does not matter here, and the first draft's "before the flag is restored, not after" claim was an
unearned ordering requirement — corrected in this revision, round-2 finding 6.** This is
non-reentrant, single-threaded-per-frame code: nothing else runs between the flag write and the
silencing writes within the same call to `sting_restore`, NMI does not read `mus_enabled` or write
any of the four APU registers Sting touches, and no other code observes `mus_enabled` until
`sting_restore` has already returned — by which point both writes have long settled. What matters
is that *both* happen before the routine returns, not which comes first. See §12's own rewritten
test (round-1 finding 5, sabotage claim corrected in round-2 finding 6): it proves both writes occur
on the restore frame, which is the actual requirement; it does not, and does not need to, assert an
order between them.

### Mechanism 4 — snapshot ordering and the second-sting policy

A second sting arriving while the first is still counting down **replaces it outright** — no
queueing, no stacking, the same minimum-viable policy shape (a) would use. The guard: **the
snapshot is only taken when `sting_left == 0`** at trigger time — a second sting must not
re-snapshot the *first* sting's own state over the real song's already-shadowed state. Order:
**check the guard (before writing anything) → snapshot only if the guard says idle → call
`music_play(stingIndex)` → arm `sting_left`.** `music_play`'s own cancellation check (mechanism 2)
fires harmlessly on this call regardless of whether it was a first or second sting — it zeroes
`sting_left` as a side effect, which is immediately overwritten by the arm step that follows. This
ordering is unaffected by round 1: no bytes beyond the trigger routine (§7's `script_op_sting`) and
the shared cancellation check already priced.

### Mechanism 5 — force-retrigger on restore, kept as state hygiene, not an audible fix (round-1 finding 7)

All four channels get `force_trig,x = 1` on restore, via a loop, but only on the audible branch —
the code is unchanged from the first draft (§7's `sting_restore`). **What changed is why this is
worth doing.** The first draft claimed force-retriggering unconditionally, even into a restored
Silence, would cause an audible "one-frame mis-trigger blip" on whatever *unrelated* song plays
next. Walked through carefully against the actual driver, this is not true: a later, ordinary song
starts through `music_play`, which zeroes every `mus_dur`. On that song's first `music_channel`
call, an event is read regardless — a sounding note sets `mus_trig` on its own, making a leftover
`force_trig` redundant rather than harmful; a rest's own silence path in `music_apply` ignores
`mus_trig`/`force_trig` either way. **A stale `force_trig` is consumed inertly on that very first
tick and cannot add an otherwise-absent period write.** There is no real audible bug here for the
retrigger-scope restriction to prevent.

**Kept anyway, as hygiene, at no extra cost.** Restricting the retrigger loop to the audible-restore
branch is still the smaller of the two options — skipping work that provably cannot matter is not a
reason to spend the bytes running it unconditionally — and it keeps `force_trig` from sitting armed
through an arbitrary stretch of silence for no observable reason, which is simply tidier state to
reason about later if anything else ever reads `force_trig`. It is retained because it is free, not
because dropping it would be a correctness bug. §12's test 7 is downgraded accordingly, from a
behavioral APU-timeline assertion to a RAM-invariant check.

**A refactor to avoid, despite looking tempting:** factoring `music_stop`'s four silencing writes
into a shared subroutine both `music_stop` and `sting_restore`'s silence branch could call would
save real bytes in the *unconditional* base engine (replacing ~16 inline bytes with a 3-byte
`jsr`) — but doing so changes `music_stop`'s own compiled byte sequence for *every* ROM, including
one with no live Sting at all, which breaks the "a sting-free project must assemble byte-identical
to today" requirement (§8) outright: the bytes would differ even though the behavior wouldn't.
`sting_restore`'s silence branch instead duplicates the four writes inline, entirely inside its
own `.if STING_ENABLED` block (§7) — paid only by projects that use Sting, and `music_stop` itself
is touched by nothing but the one already-gated `sta sting_left` line from mechanism 2.

## §6. New engine RAM

Unaffected by round 1 — every finding's fix (the stack-based operand fix, the `NO_SONG` runtime
guard, the `main_loop` call site) uses only the stack and registers, adding no new persistent RAM.

**No new zero-page state.** `sting_left`, the shadow arrays, and `force_trig` are all priced by
the costing pass as 3-byte absolute accesses, not 2-byte zero-page ones — a deliberate choice this
design keeps, since it matches the accepted 145-157 price closely and zero page is the more
contested resource of the two (every existing suspend counter — `mv_left`, `wt_left`,
`shake_left`, `fade_*`, `flash_left` — already lives there; Sting does not need the speed and
shouldn't compete for the space).

**Placement: `$0528`, verified free.** `engine/constants.asm`'s `$0300+` region is tightly packed
through `ent_record` (`$0520`, `@size=MAX_ENTITIES=8`, ending at `$0527`) — confirmed by listing
every `$03xx`/`$05xx` symbol in the file and checking for gaps: two apparent gaps ($0378 and
$0390) turned out to already be claimed by `inv_items` and `switches` respectively, declared
later in the file's linear order but at those addresses. **`$0528` through `$05FF` (216 bytes) is
genuinely unclaimed** — the next used address is `flash_driver` at `$0600`, a full page later,
confirming the file uses page-aligned starts for driver-scale blocks rather than packing every
byte. 31 bytes fits with a large margin to spare:

```asm
; ------------------------------------------------------------- sting RAM
; Six arrays' worth of shadowed channel state (24 contiguous bytes, indexed
; identically to mus_ptr_lo,x for x=0..23 -- this only works because those
; six arrays are declared back-to-back in exactly this order in the music RAM
; block above, with no gap and no seventh array inserted between any two of
; them; moving one, or adding a new per-channel music array later, silently
; breaks sting_snapshot/sting_restore's shared loop without an assembler
; error), then the two flags and the countdown, then the shared retrigger
; array force_trig also uses (mechanism 1, §5) -- four bytes, one per
; channel, self-clearing on use.
sting_shadow        = $0528  ; @size=24, mirrors mus_ptr_lo..mus_note
sting_shadow_song   = $0540  ; the shadowed cur_song
sting_shadow_enabled = $0541 ; the shadowed mus_enabled
sting_left          = $0542  ; frames left on the sting; 0 = idle
force_trig          = $0543  ; @size=MUS_CHANNELS
```

31 bytes total (`$0528`-`$0546`), 569 bytes clear of `flash_driver` at `$0600`. If a future
feature needs the smaller confirmed-free blocks elsewhere in the file (`$035C-$035F`, 4 bytes; the
documented `$03D8-$03E3`, 12 bytes) those remain untouched by this design — appending at the tail
of the chain is the convention this file's own comments establish elsewhere (Fade/Flash's own RAM
sections cite the same rule), and this placement follows it exactly rather than reusing either
smaller gap.

## §7. Engine implementation sketch, and the byte-priced routine table

```asm
; ---- new: engine/music.asm ----------------------------------------------

  .if STING_ENABLED

sting_snapshot:
  ldx #0
sting_snapshot_loop:
  lda mus_ptr_lo,x
  sta sting_shadow,x
  inx
  cpx #24
  bne sting_snapshot_loop
  lda cur_song
  sta sting_shadow_song
  lda mus_enabled
  sta sting_shadow_enabled
  rts

sting_restore:
  ldx #0
sting_restore_loop:
  lda sting_shadow,x
  sta mus_ptr_lo,x
  inx
  cpx #24
  bne sting_restore_loop
  lda sting_shadow_song
  sta cur_song
  lda sting_shadow_enabled
  sta mus_enabled
  beq sting_restore_silence
  ldx #0
sting_retrig_loop:
  lda #1
  sta force_trig,x
  inx
  cpx #MUS_CHANNELS
  bne sting_retrig_loop
  rts
sting_restore_silence:
  lda #$30
  sta $4000
  sta $4004
  sta $400C
  lda #0
  sta $4008
  rts

sting_tick:                   ; called unconditionally from main_loop, like flash_tick --
                                ; see the boot.asm sketch below for why the call site's
                                ; ordering relative to music_tick is not free to move
  lda sting_left
  beq sting_tick_rts
  dec sting_left
  bne sting_tick_rts
  jsr sting_restore
sting_tick_rts:
  rts

  .endif

; ---- existing: engine/boot.asm, main_loop --------------------------------
; One new line (round-1 finding 6: the first draft's table priced sting_tick's own body but
; never counted the call needed to reach it, and never pinned where in main_loop it belongs).
; The load-bearing contract, restated honestly (round-2 finding 5): sting_tick must run after
; music_tick and before anything that can affect or observe music/APU state -- not "before
; flash_tick specifically," since flash_tick touches neither music nor the APU and so cannot
; make the two orders observably different from each other. Placed immediately after music_tick
; below purely as a source-adjacency convention (easy to see at a glance that it belongs to the
; same per-frame audio step), not because anything downstream of flash_tick depends on it.

main_loop:
  jsr wait_vblank
  jsr read_pad
  jsr music_tick
  .if STING_ENABLED
  jsr sting_tick               ; must come after music_tick -- music_tick is what actually plays
                                 ; this frame's sting audio (advancing the sting's own compiled
                                 ; stream by one more event), and sting_tick's countdown decides,
                                 ; on the same frame, whether that was the sting's last frame.
                                 ; Reversed order would run sting_restore BEFORE this frame's
                                 ; music_tick, so music_tick would play the RESUMED song's state
                                 ; instead -- the sting's own final frame of audio is silently
                                 ; dropped and the resumed song starts one frame early. See §12's
                                 ; own test for the two orders relative to music_tick.
  .endif
  jsr flash_tick
  ...                            ; unchanged from here

; ---- new: engine/script.asm ----------------------------------------------
; Corrected in this revision (round-1 finding 1: the first draft's tax/txa scheme did not
; survive either callee, since both sting_snapshot (X 0..23) and music_play (X 0..MUS_CHANNELS,
; verified directly) clobber X) and extended with a runtime guard (round-1 finding 8: an
; unguarded NO_SONG operand would snapshot the real song and then silence it permanently, since
; music_play(NO_SONG) routes to music_stop, which never calls sting_restore). The guard checks
; only for a zero duration, not NO_SONG specifically, because that is the only way a compiled
; operand can BE zero: normalizeSong (shared/audio.js) guarantees a nonempty order, at least one
; row per pattern, and framesPerRow >= 1, so songFrameLength is positive for every real,
; normalized song -- only the NO_SONG compiler fallback (§4) ever emits 0 (round-2 finding 2
; sharpened this; the first draft's own "or an empty song" hedge is gone because normalizeSong
; makes a genuinely empty song impossible to reach this operand at all).

  .if STING_ENABLED
script_op_sting:
  ldy #2
  lda [script_ptr_lo],y      ; duration operand (offset 2) -- read first, before anything is
                               ; pushed or skipped, so the guard below can act on it directly
  beq script_op_sting_skip     ; duration 0 means NO_SONG (see above) -- skip the sting entirely
                                 ; rather than snapshot a song that will never come back. The
                                 ; script_op_give/NO_ITEM family shape: skip the effect, keep
                                 ; running the script.
  pha                            ; push duration (nonzero -- real work to do)
  dey                              ; y = 1
  lda [script_ptr_lo],y            ; song operand (offset 1)
  pha                                ; push song (on top of duration)
  lda #3
  jsr script_skip                     ; advance past the whole command
  lda sting_left
  bne script_op_sting_armed             ; already mid-sting: skip the snapshot (mechanism 4)
  jsr sting_snapshot
script_op_sting_armed:
  pla                                     ; pop song
  jsr music_play                            ; plays the sting; harmlessly re-triggers the
                                              ; cancellation check (mechanism 2) on sting_left,
                                              ; which the next two lines immediately overwrite
  pla                                          ; pop duration
  sta sting_left
  jmp script_run                                ; non-suspending: continue the same page
script_op_sting_skip:
  lda #3
  jsr script_skip                                 ; still advance past the command
  jmp script_run
  .endif
```

| routine | bytes | bank | basis |
|---|---|---|---|
| `force_trig` check in `music_channel` (mechanism 1) | 15 | kernel-lo | `lda force_trig,x`(3)+`beq`(2)+`lda #0`(2)+`sta force_trig,x`(3)+`lda #1`(2)+`sta mus_trig,x`(3) |
| `music_play` cancellation check (mechanism 2) | 12 | kernel-lo | `pha`(1)+`lda sting_left`(3)+`beq`(2)+`lda #0`(2)+`sta sting_left`(3)+`pla`(1) |
| `music_stop` sting-state clear (mechanism 2/4) | 3 | kernel-lo | `sta sting_left`(3, absolute), reusing the `A=0` already loaded two lines above |
| `sting_snapshot` | 24 | kernel-lo | `ldx #0`(2)+loop[`lda mus_ptr_lo,x`(3)+`sta sting_shadow,x`(3)+`inx`(1)+`cpx #24`(2)+`bne`(2)=11]+`lda cur_song`(2, zp)+`sta sting_shadow_song`(3)+`lda mus_enabled`(2, zp)+`sta sting_shadow_enabled`(3)+`rts`(1) |
| `sting_restore` | 55 | kernel-lo | shared prefix: `ldx#0`(2)+loop(11)+`lda shadow_song`(3)+`sta cur_song`(2,zp)+`lda shadow_enabled`(3)+`sta mus_enabled`(2,zp)+`beq`(2) = 25; audible branch: `ldx#0`(2)+retrig-loop[`lda#1`(2)+`sta force_trig,x`(3)+`inx`(1)+`cpx#4`(2)+`bne`(2)=10]+`rts`(1) = 13; silence branch: `lda#$30`(2)+`sta$4000`(3)+`sta$4004`(3)+`sta$400C`(3)+`lda#0`(2)+`sta$4008`(3)+`rts`(1) = 17. Both branches are assembled (25+13+17=55); only one runs per call |
| `sting_tick` (body) | 14 | kernel-lo | `lda sting_left`(3)+`beq`(2)+`dec sting_left`(3)+`bne`(2)+`jsr sting_restore`(3)+`rts`(1) |
| `sting_tick` call site in `main_loop`, immediately after `music_tick` (**new row, round-1 finding 6**) | 3 | kernel-lo | `jsr sting_tick`(3) |
| `script_op_sting` trigger (**revised, round-1 findings 1 and 8**) | 43 | kernel-lo | `ldy#2`(2)+`lda[ind],y`(2)+`beq`(2)+`pha`(1)+`dey`(1)+`lda[ind],y`(2)+`pha`(1)+`lda#3`(2)+`jsr script_skip`(3)+`lda sting_left`(3)+`bne`(2)+`jsr sting_snapshot`(3)+`pla`(1)+`jsr music_play`(3)+`pla`(1)+`sta sting_left`(3)+`jmp script_run`(3) = 35, plus the skip-target block `lda#3`(2)+`jsr script_skip`(3)+`jmp script_run`(3) = 8; 35+8=43 |
| dispatch entry (one more opcode in `script_run`'s chain) | 7 | kernel-lo | precedent, unpriced further here — same flat cost every existing `OP_*` addition pays |
| **`STING_KERNEL_ALLOWANCE` (this design's own total)** | **176** | | 15+12+3+24+55+14+3+43+7 |

### Reconciling against the costed 145-157 (revised, round 1)

This design's own instruction-level total is now **176 kernel-lo bytes, 19 bytes above the costing
pass's upper estimate (157)** — up from the first draft's 163 (a 6-byte gap), for three reasons
this revision's own findings surfaced, none of them silently absorbed:

- **`script_op_sting` grew from 33 to 43 bytes.** The first draft's `tax`/`txa` scheme was simply
  broken — round-1 finding 1 confirmed both `sting_snapshot` (which runs `X` 0 through 23) and
  `music_play` (which loops `X` 0 through `MUS_CHANNELS`, verified directly) clobber `X`, so a
  duration held in `X` across either call is destroyed: every sting would arm for a stray 4 frames
  regardless of its real length, not just an occasional one. The corrected routine holds both
  operands on the stack across both calls — the same byte count as the broken `tax`/`txa` version
  would have been (33, reconfirmed by direct recount) — but round-1 finding 8 additionally
  requires a runtime guard against a `NO_SONG` or zero-length operand (§5, mechanism-adjacent;
  §7's code above), which costs its own +10 bytes: a duplicated `lda #3`/`jsr script_skip` pair in
  the guard's own skip path, needed because the zero-check has to run on a value read directly out
  of `[script_ptr_lo],y` before `script_ptr` is known to still point at the unread operand. 33
  (corrected, unchanged cost) + 10 (the guard) = 43.
- **A new row: the `main_loop` call site, 3 bytes (round-1 finding 6).** The first draft's table
  counted `sting_tick`'s own 14-byte body but never counted the `jsr sting_tick` needed to reach
  it every frame — every other per-frame ticker in this design (and in Fade/Flash before it) needs
  exactly this kind of call site, and omitting it was an oversight the review caught, not a real
  saving.
- **`sting_snapshot`/`sting_restore` (24+55=79 vs. the costed rows' combined ~68-75):** unchanged
  from the first draft's own reconciliation — still the `rts`/branch overhead a componentized
  pre-implementation estimate does not carry, still budgeted room for by the costed "cur_song/
  mus_enabled save+restore, plus explicit hardware silencing" row (~30-35).

**This still changes no Part-3 classification.** MMC3 Save+Move-no-item's 88 free is still the
nearest threshold in either direction, and 176 clears (exceeds) it by more than 157 or 163 did in
the sense that actually matters here — all three totals are refused there, and the new documented
limitation (§9) names exactly the same configuration regardless of which of the three figures is
used. No configuration moves from FITS to NO FIT or back because of this growth.

**If 176 needs trimming, two independent levers exist, cheapest first.** Dropping the finding-8
`NO_SONG`/zero-length runtime guard and relying solely on `validateProject`'s own build-time
refusal (§10) recovers exactly 10 bytes, back to 33 for the trigger — a real, available trade this
design keeps by default for defense-in-depth (the `script_op_give`/`NO_ITEM` family precedent, and
the only layer that protects a hand-edited or later-version project that bypasses the JS-level
check), not because it is cheap. Past that, the `sting_snapshot`/`sting_restore` split is the same
lever the first draft named, unchanged: no further trim is available there without giving up the
mechanism-5 hygiene branch (§5) or the two-loop clarity the shared 24-byte-block trick already
buys.

## §8. Capacity integration

**`STING_KERNEL_ALLOWANCE = 176`, flat, not per-mapper** (`main/build/generate.js`, beside
`MOVE_KERNEL_ALLOWANCE`/`WAIT_KERNEL_ALLOWANCE`/etc.) — nothing in this design branches on
`SPLIT_ENABLED` or any other mapper-specific fact the way MMC3's extra 46 battle-region bytes or
its `SPLIT_LOCK_KERNEL_ALLOWANCE` do; every routine above is identical on all boards. Per this
codebase's own standing rule ("used only when real per-board... measurement shows variance"),
`STING_KERNEL_ALLOWANCE` stays flat unless a real `kernelbytes.test.js` measurement disagrees — and
this revision's own test 3 (§12, rewritten per round-1 finding 11) is what actually confirms that,
per board, by equality rather than a floor/ceiling band.

**The load-bearing charge, spelled out completely and now matching the actual shape of
`generate.js` (round-1 finding 4, corrected again in round-2 finding 3 — the first draft's fix
still didn't fit the functions it was meant to modify).** Without the charge below,
`checkCapacity` reserves no kernel-lo space for any of §7's routines at all: the §9 MMC3 test would
never refuse (nothing would be charged against the bank), and `kernelShortfallAdvice` would have
nothing real to report freeing.

**The invariant is "one predicate implementation, called locally in each scope" — not "one computed
value shared across scopes."** Confirmed directly against the real source: `kernelCodeBytes`,
`kernelShortfallAdvice`, and `generateAssets` are three separate functions
(`main/build/generate.js`, lines 622, 905, and 1511 respectively), each already computing its own
local `usesMove = projectUsesMove(project)` (and the equivalent for every other verb) at its own
top, independently. There is no shared accumulator to write into and no outer scope to cache a
single `usesSting` in — caching it globally would also be *wrong*, not merely inconvenient, since
`kernelCodeBytes` and `kernelShortfallAdvice` are both called repeatedly against different
hypothetical project variants (`kernelShortfallAdvice`'s own `projectWithoutCommands` simulation,
§8 below) and a cached value would go stale the moment the project passed in differs from whichever
call cached it. So `projectUsesSting(project)` — one implementation, in `shared/project.js` — is
called three times, once per scope, each locally:

1. **`kernelCodeBytes(project, mapper)`** (`main/build/generate.js:622`) already computes
   `usesMove`/`usesTurn`/etc. as local `const`s at its own top and adds each into **one big
   parenthesized `return` expression** (line 675 onward: `baseKernelCodeBytes(mapper) + ... +
   KERNEL_SLACK`) — there is no mutable accumulator to `+=` into, which is what the first draft's
   sketch wrongly assumed. Sting joins the same pattern, at both ends:
   ```js
   // inside kernelCodeBytes, alongside the other const usesX = projectUsesX(project) lines:
   const usesSting = projectUsesSting(project);
   // ...and inside the same function's own return expression, alongside every other term:
   return (
     baseKernelCodeBytes(mapper) +
     // ...every existing term, unchanged...
     (usesSting ? STING_KERNEL_ALLOWANCE : 0) +
     KERNEL_SLACK
   );
   ```
2. **`kernelShortfallAdvice(project, mapper, deficit)`** (`main/build/generate.js:905`) computes its
   own local `usesMove` at line 910 and pushes into its own local `active` array at line 922. Sting
   gets its own local computation and push, in the same function, unrelated to `kernelCodeBytes`'s
   own local variable of the same name:
   ```js
   const usesSting = projectUsesSting(project);
   // ...
   if (usesSting) active.push({ op: 'sting', label: 'every Sting command' });
   ```
3. **`generateAssets({ dir, project, log })`** (`main/build/generate.js:1511`) computes its own
   local `usesMove` at line 1616 to emit `` `MOVE_ENABLED = ${usesMove ? 1 : 0}` `` at line 2012.
   Sting's own generated flag follows the identical local shape, in this third function:
   ```js
   const usesSting = projectUsesSting(project);
   // ...
   `STING_ENABLED = ${usesSting ? 1 : 0}`,
   ```

**`projectUsesSting`** (`shared/project.js`, beside `projectUsesMove`, byte-identical shape to
every one of its five siblings):

```js
export function projectUsesSting(project) {
  for (const event of projectEvents(project)) {
    for (const page of compiledPages(event)) {
      for (const command of liveCommands(page.commands, CHOICE_LIMITS.options)) {
        if (command.op === 'sting') return true;
      }
    }
  }
  return false;
}
```

**A latent dependent-term interaction, inherited from Move's own precedent — flag it, no new code
needed, and now backed by its own test (round-1 finding 11).** `fontBankSplit` reads
`projectUsesText`, and `projectUsesText` counts *any* event that survives to the ROM, a live
Move-only one included (CLAUDE.md's own documented case). By the identical reasoning, on MMC3 a
project whose *only* live event is a Sting-only command still counts as using text, so
`SPLIT_LOCK_KERNEL_ALLOWANCE` (19 bytes) is paid for that project on Sting's account alone, exactly
the way it can be on Move's. This needs **no special-casing in `kernelShortfallAdvice`**: the
function already reasons about dependent terms by simulating command removal
(`projectWithoutCommands`) and re-measuring `kernelCodeBytes`, never by summing flat constants —
which is precisely why the brief says "reason from `kernelCodeBytes`, not the constants." §12's own
new advice test (round-1 finding 11) is what actually exercises this: an MMC3 project whose sole
live event is a Sting must report removing it frees `STING_KERNEL_ALLOWANCE + SPLIT_LOCK_KERNEL_
ALLOWANCE` (176 + 19 = 195) together, not 176 alone — a wrong implementation that sums the flat
constant instead of asking `kernelCodeBytes` fails that test for exactly this reason.

**`STING_ENABLED`, not `SFX_ENABLED`.** The costing pass's own code sketches use `SFX_ENABLED`
throughout (a placeholder, reasonably general given it was pricing three different shape
candidates under one name) — this design renames it to `STING_ENABLED` for the one thing the brief
asks to be decided and used consistently: every existing flag names its exact command
(`MOVE_ENABLED`, `TURN_ENABLED`, `WAIT_ENABLED`, `SHAKE_ENABLED`, `VISIBLE_ENABLED`,
`FADE_ENABLED`, `FLASH_ENABLED`), never a category. `STING_ENABLED` matches that convention; an
implementer copying code out of the costing report directly should rename `SFX_ENABLED` to
`STING_ENABLED` throughout, not ship the report's placeholder spelling.

**Kernel-hi: no change needed, confirmed from `generate.js`.** `musicSize(project.songs)` already
sums every compiled song in the project's Sound Forge list, regardless of how (or whether) any
script command references it — a sting is just an existing song used a new way, not new song data,
so `musicBytes + text.bytes > BANK_SIZE - 64`'s existing check already charges it correctly with
zero code change. The "28-byte compiled-song floor" the brief's own framing mentions is a property
of a very short song's own compiled size (the 8-byte pointer table plus four minimum 5-byte
channel streams `songTables` emits for any song, sting-authored or not) — not a cost Sting adds on
top of an existing song's own already-counted bytes. **Build panel surfacing:** none needed, for
the same reason — there is no new capacity check for the panel to display; whatever it already
shows for kernel-hi usage already includes every sting song's bytes. (I did not find a dedicated
kernel-hi/music budget meter in the Build panel during this research pass; if the panel's kernel-hi
display is limited to the pass/fail message `checkCapacity` already produces, Sting changes nothing
about what that message says either, since no new check exists.)

**Byte identity.** A sting-free project must assemble to the same bytes as one built before Sting
existed. Every routine in §7 — including the `main_loop` call site added in this revision — is
inside its own `.if STING_ENABLED` block, `music_channel`'s and `music_play`'s and `music_stop`'s
*existing* code is otherwise untouched (§5's callout on why the `music_stop`-refactor temptation is
specifically rejected), and `STING_ENABLED` is computed from the single `usesSting` value above the
same way `MOVE_ENABLED` is from `usesMove` — closing the gate closes every one of §7's additions to
zero bytes. §12's test 1 names the whole-ROM comparison that proves this, not merely asserts it by
construction.

## §9. The new documented limitation

**MMC3 Save+Move-no-item, at exactly 88 free (`handoff-costing/costing-report.md`, Part 1's own
MMC3 table), is where Sting creates a clean NO FIT.** `STING_KERNEL_ALLOWANCE` (176, or even the
costed low end of 145) exceeds 88 either way — this is not close. Per Part 3's own fit matrix
(reused verbatim, both sting shapes create "the same one new refusal as visual-only tile change on
MMC3's Save+Move-no-item row, and otherwise fit every configuration that was not already broken");
confirmed this design changes nothing about which configurations were already broken for unrelated
reasons (MMC3 Save+Move+item, MMC3 ALL-verbs+Save+Move+item, MMC1 ALL-verbs+Save+Move+item, UNROM
512 Save+Move-no-item, UNROM 512 ALL-verbs+Save+Move+item) — those stay broken regardless of
Sting, and every currently-FITS row not named above stays FITS with Sting live (MMC3's own
Save+Move+item row is *already* refused for unrelated reasons, so Sting cannot make it "more"
refused; MMC1's Save+Move+item row has 220 free, comfortably clearing 176).

**Test** (`test/unit/kernelbytes.test.js`, the established `kernelShortfallMessage`/refusal-only
pattern — never assert the literal deficit, per the file's own stated reason: it drifts with any
unrelated kernel-lo change):

```js
test(
  'sample-rpg with Save, Move (no item) and a live Sting does not build on MMC3 -- a documented limitation',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const project = await loadProject(SAMPLE_RPG);
    project.cartridge.mapper = 4; // MMC3
    project.project.titleMap = 0;
    project.project.titleScreen = 0;
    project.items = [];           // isolate the no-item row this refusal actually lands on
    project.maps[0].screens[0].entities.push(saveAndMoveEvent());
    project.maps[0].screens[0].entities.push(stingEvent());   // new helper, mirrors saveAndMoveEvent()

    const message = kernelShortfallMessage(project);
    assert.match(
      message,
      new RegExp(
        `removing every Sting command \\(frees ${STING_KERNEL_ALLOWANCE} bytes\\)`
      ),
      'the refusal should name Sting and its real byte figure, the same discipline every other ' +
        'documented limitation in this file is held to'
    );

    // Confirm the design's own stated mitigation: dropping Sting alone is a real fix.
    const droppedSting = structuredClone(project);
    droppedSting.maps[0].screens[0].entities.pop();
    assert.deepEqual(
      checkCapacity(droppedSting).problems.filter((p) => p.severity === 'error'),
      [],
      'dropping the Sting command should still be a real fix, the same way it is for Move/Save elsewhere'
    );
  }
);
```

**CLAUDE.md paragraph** (to be added beside the existing MMC3 Save+Move-no-item mentions at
implementation time, not written into the tree by this design pass): state the 176-byte figure (or
whatever nesasm measures for real), name the exact configuration (MMC3, Save+Move, no item, one
live Sting), and note — per §7's reconciliation — that the gap between this design's total and the
costing pass's own 145-157 estimate does not change which board/configuration pairs this refusal
applies to.

## §10. Schema, validation, and the Map Forge editor

**`EVENT_COMMANDS`** (`shared/project.js`, beside `move`/`wait`/`shake`/`fade`/`flash`/`music`):

```js
{ id: 'sting', label: 'Sound sting', args: ['song'] }
```

**`IMPLEMENTED_COMMANDS`**: add `'sting'` to the flat `Set`.

**Opcode touchpoints — both ends, named explicitly (round-1 finding 10; the first draft's code
sketches used `OP_STING` without ever defining it anywhere).** `EVENT_COMMANDS`'s own order is the
wire format (CLAUDE.md's own single-writer rule), so appending `sting` last — after `flash` — fixes
the opcode value:

```js
// main/build/textcompile.js, beside OP_SAY/OP_CALL/OP_MUSIC/OP_BATTLE
export const OP_STING = opIndex('sting');
```

and the matching numeric definition in `engine/constants.asm`, appended after `OP_FLASH = $19`
(confirmed the current value directly, by counting the file's own `OP_*` table):

```asm
OP_STING    = $1A           ; [song index or NO_SONG, duration in frames] -- pauses the current
                             ; song, plays the named one alone, and resumes the original where it
                             ; left off; see script_op_sting (engine/script.asm) and
                             ; design-sting.md
```

§12's own new opcode-agreement test is what keeps these two from drifting apart — nothing else in
the codebase cross-checks `EVENT_COMMANDS`' order against `constants.asm`'s numbers except by
construction (appending both entries at the same relative position) and a test that actually reads
both.

**Default value — no song chosen, not song 0.** Mirrors `music`'s own `defaultCommand` precedent
(`renderer/forges/map/events.js`: `out.song = null` for a freshly-added `music` command) rather
than defaulting to an arbitrary first song nobody chose. Unlike `music`, `null` is *not* a
legitimate end state for Sting — there is no "Silence" reading of "play no sting" — so this is
purely the freshly-added-command default, immediately refused by `validateProject` if the author
never picks one and leaves it live (below).

**`songByte`'s existing resolution is reused unchanged, deliberately, with one inherited caveat
flagged rather than fixed.** `songByte(songs, id)` — moved to `shared/audio.js` in this revision
(round-1 finding 9; see §4) so both the compiler and `validateProject` can share it without either
one duplicating the logic — resolves by *raw array index*, not a stable id the way `call`'s
common-event resolution does. Deleting an earlier song silently retargets every later reference
(`music` *and*, if this ships, `sting`) that named a later song by position. This is a pre-existing
property of `music`'s own reference scheme, not something Sting introduces, and it is **out of
scope for this design** (§11) — Sting inherits `music`'s existing behavior for consistency (one
song-reference scheme in the codebase, not two), not because raw-index is the ideal scheme. If that
scheme is ever revisited, it should be revisited for both commands at once, not patched for Sting
alone.

**`validateProject` refusal — the Give/Take shape, not `music`'s silent-fallback shape, now sharing
its song-reference and duration logic with the compiler (round-1 finding 9).** A `music` command
naming a deleted song currently compiles silently to `NO_SONG` (Silence) with no `validateProject`
check anywhere — confirmed absent from the file. That silent fallback is a *legitimate* choice for
`music` (Silence is a real, authorable state), but not for Sting, where `NO_SONG` can only mean
"the author never picked one" or "the song they picked is gone" — neither is a state that should
reach a ROM quietly. This mirrors Give/Take's `itemMissing` refusal exactly, not `music`'s own gap,
and adds the §4 length ceiling as real code rather than only prose (the first draft described the
length refusal but never wrote it):

```js
import { NO_SONG, songByte, songFrameLength } from './audio.js';

let missingStings = 0;
let overlongStings = 0;
for (const event of projectEvents(project)) {
  for (const page of compiledPages(event)) {
    for (const command of liveCommands(page.commands, CHOICE_LIMITS.options)) {
      if (command.op !== 'sting') continue;
      const songIndex = songByte(project.songs, command.song);
      if (songIndex === NO_SONG) {
        missingStings++;
      } else if (songFrameLength(project.songs[songIndex]) > 255) {
        overlongStings++;
      }
    }
  }
}
if (missingStings) {
  add('error', 'Map Forge',
    `${missingStings} Sound sting command${missingStings === 1 ? '' : 's'} do not name a real ` +
      'song. Pick a song or switch the command off.');
}
if (overlongStings) {
  add('error', 'Map Forge',
    `${overlongStings} Sound sting command${overlongStings === 1 ? '' : 's'} name a song that ` +
      'takes longer than 255 frames (4.25s) to complete its own first pass. Shorten the song or ' +
      'pick a different one.');
}
```

**Map Forge editor** (`renderer/forges/map/events.js`): `describeEnabled` gets a `sting` case
mirroring `music`'s (`Sting: ${songName(command.song)}` or, for a not-yet-chosen one, something
distinct from `music`'s own "Silence" reading — e.g. `'Sting: (choose a song)'`, since an
unresolved sting is an error state, not a legitimate one). The field editor mirrors `music`'s own
`select` almost exactly (same `songs` list, same `onchange` shape) but **drops the "Silence"
option** `music`'s dropdown offers, since there is no silence-equivalent choice for a sting — and,
per `call`'s own precedent for a stale reference (the "Missing event" option `callTargetMissing`
injects), adds a "Missing song" option when the currently-stored `command.song` no longer resolves,
so an author opening an old project sees *why* the command is flagged rather than a dropdown that
silently shows nothing selected. §12's own new smoke-test scenario (round-1 finding 12) is what
actually exercises this wiring against the real editor.

## §11. Non-goals, explicitly out of scope for this design

- **Shapes (a) (channel-steal) and (c) (sting-as-song-with-scripted-restore).** The user picked
  shape (b); this document designs only that shape. Shape (a)'s own open question (does the
  stolen channel pause or advance silently in the background?) does not arise here — it is a
  shape-(a)-specific question this design never needed to answer.
- **A stable-id song reference scheme.** `music` and, following it, `sting` both resolve by raw
  list position. Moving either (or both) to a `call`-style stable-id/slot-table scheme is a
  pre-existing question, unrelated to Sting, and not designed here.
- **Sound Forge preview support for the pause/resume interaction.** Recommended as severable
  (below), not designed.
- **An author-supplied duration override.** Explicitly rejected in §4, not merely deferred — a
  compiler-computed duration is strictly more correct (§4's staleness argument), and there is no
  authoring need an override would serve that composing `Sting` + `Wait` doesn't already cover for
  the suspending case.
- **A suspending variant of Sting.** §3's decision is final for this design; if a future author
  need genuinely requires the script to hold, `Sting` + `Wait <duration>` composes it today with
  no engine change.
- **Fixing `music`'s own missing `validateProject` check** for a deleted-song reference. Flagged
  in §10 as a pre-existing gap this design's own Sting-specific check does not extend backward to
  cover. If `music`'s own gap is worth closing, that is a separate, small change with its own
  brief.

## §12. Test plan

Each item names the wrong implementation it exists to catch, per the sabotage discipline
established in `handoff-fade/design-fade.md`/`handoff-flash/design-flash.md`. Items marked
**(round 1)** are new or substantially rewritten against `sting-design-review1.md`; items noting a
**round-2** correction had their sabotage claim narrowed or their case list extended against
`sting-design-review2.md` without changing what they were already correctly catching.

1. **Byte identity — a sting-free project assembles identically to one built before Sting
   existed** (`test/unit/move.test.js`'s own `assert.deepEqual([...fs.readFileSync(...)], ...)`
   shape, full-ROM byte array compare, not a hash). *Catches:* an implementation that forgets to
   gate one of §7's several `.if STING_ENABLED` blocks — the `main_loop` call site (round-1
   finding 6) included, not only `music_channel`'s `force_trig` check — which would pass every
   *other* test here (since a project with no live Sting also has every Sting-related counter
   permanently zero, so the extra instructions are functionally inert) while silently costing
   every ROM in the codebase kernel-lo bytes it never needed to spend.

2. **`projectUsesSting` — live counts, switched-off doesn't, nested-in-a-branch still does**
   (`test/unit/move.test.js`'s own `projectUsesMove` test shape exactly: a common event with one
   live `sting`, then the same with `off: true`, then one nested inside a `branch`). *Catches:* an
   implementation that scans `page.commands` directly instead of the recursive `liveCommands` —
   the exact `usedSwitches`-shaped bug CLAUDE.md already documents happening once for switches; a
   Sting nested in a branch would silently fail to turn `STING_ENABLED` on, and the branch's own
   Sting command would then reference code that was never assembled.

3. **`STING_KERNEL_ALLOWANCE` covers the real cost exactly, per board, isolated from the split-lock
   term — rewritten (round 1, finding 11).** The first draft's floor (`cost >
   STING_KERNEL_ALLOWANCE - 120`) was too loose to prove anything: with an allowance around 176, an
   implementation silently missing both the 24-byte `sting_snapshot` and the 55-byte
   `sting_restore` routines (a combined 79 of the 176 bytes — most of the feature) would still
   clear that floor and pass. It was also contaminated: comparing a Sting-only event against a
   *no-event* baseline on MMC3 measures Sting plus `SPLIT_LOCK_KERNEL_ALLOWANCE` (19 bytes)
   together, not Sting alone, directly contradicting §8's own claim of an identical flat delta on
   every board. Corrected shape: measure the real kernel-lo delta of adding a live Sting **against
   a baseline that already carries a different, surviving event** (e.g. a `Say`, so
   `projectUsesText` is already true and `SPLIT_LOCK_KERNEL_ALLOWANCE` is already being charged
   *before* Sting is added, the same way `kernelbytes.test.js`'s own existing per-mapper tests
   isolate one term from another) on **all three RPG-capable boards** (MMC1, MMC3, UNROM 512), and
   assert **equality** — `cost === STING_KERNEL_ALLOWANCE`, not a band — the same discipline this
   file already holds every per-mapper allowance to (`SAVE_KERNEL_ALLOWANCE_BY_MAPPER`'s own
   equality assertions), extended here to a flat constant to prove the flatness itself is real, not
   assumed.

   **A second case, added in this revision, for the dependent term directly:** an MMC3 project
   whose *sole* live event is a Sting-only command (no `Say`, nothing else that would make
   `projectUsesText` true on its own) — assert `kernelShortfallAdvice`'s message reports removing
   Sting frees `STING_KERNEL_ALLOWANCE + SPLIT_LOCK_KERNEL_ALLOWANCE` (176 + 19 = 195) together,
   the exact §8 dependent-term claim. *Catches:* an implementation of the advice logic that sums
   the flat `STING_KERNEL_ALLOWANCE` constant directly instead of asking `kernelCodeBytes` what a
   Sting-free version of the project would actually cost — it would report 176 alone, wrong by
   exactly the split-lock term, for precisely the reason §8 describes.

4. **Duration — rewritten (round 1, finding 2) to use the corrected formula and an independent
   expectation that distinguishes it from the first draft's bug.** Author a fixture song with a
   single order entry (`order: [0]`) and the schema's own default `loop: 0` — under the *wrong*
   (`loopRow`) formula this compiles to duration 0 (since `loopRow` is 0 at the very start of the
   order); under the *correct* (`rows.length`) formula it compiles to `pattern.rows *
   framesPerRow`, computed independently in the test (not re-derived from `songFrameLength` itself)
   as `pattern.rows` (known from the fixture) times `song.tempo.framesPerRow` (also known). Assert
   the compiled Sting's third operand byte equals this independently-computed, nonzero value.
   *Catches:* precisely the bug this revision fixes — an implementation still using `loopRow *
   framesPerRow` would compile a 0-frame duration for this exact fixture and pass silently if the
   test's own expectation were derived from the same wrong formula instead of independently from
   `pattern.rows`/`framesPerRow`.

5. **A live sting fires, resumes, and the resumed song is audibly correct** — the core behavioral
   test `test/unit/music.test.js` does not currently exercise at all (confirmed: it diffs 150-200
   frames of the checked-in `sample` project's *ordinary, untouched* boot song against `Replayer`
   and never authors, triggers, or executes a sting). Boot a ROM with a live Sting authored in
   (a fixture project, or an in-test mutation of `sample-rpg` the way `kernelbytes.test.js` already
   builds throwaway variants), hook `cur_song`/`mus_enabled`/`$4000-$400F` writes the way
   `music.test.js:143`'s `recordRomActivity` already does, and assert against a hand-computed
   timeline: the frame the sting's own first note fires, the exact frame `sting_left` reaches zero
   and the resume fires, and — critically — **real APU period writes in the frames immediately
   after resume**, not just the shadow bytes matching. *Catches:* an implementation missing
   mechanism 1 (`force_trig`) entirely — the shadow bytes would restore correctly (`cur_song`,
   `mus_ptr_lo/hi`, etc. all match expectations), `mus_enabled` would read as playing, and yet no
   further `$4002`/`$400A`/etc. period write would ever occur until the *original* song's own next
   natural note change (which could be many frames later, or — for a long-held note — never inside
   the test's own window) — a test that only checks shadow RAM values would pass this broken
   implementation outright. Independent hand-computed expectations, explicitly not a `Replayer`
   cross-check: `Replayer` has no sting-over-song concept and extending it in lockstep with the
   engine risks exactly the matched-pair hole this codebase's own reviewer-role brief warns
   against.

6. **Silence-restore case — rewritten (round 1, finding 5) to assert the actual re-silencing
   writes, not merely their absence downstream; sabotage claim narrowed in round-2 finding 6.**
   The first draft's assertion (`mus_enabled == 0` plus zero further `$4002`/`$400A` writes for 30
   frames) does not distinguish a correct implementation from mechanism 3 omitted entirely: a
   broken implementation that restores `mus_enabled = 0` *without* re-silencing the hardware
   produces exactly the same two observations, because `mus_enabled = 0` stops `music_tick` from
   running at all — nothing further ever touches the APU either way, correct or broken. The
   corrected assertion hooks `nes.mmap.write` across the exact hand-computed restore frame (known
   from the sting's own compiled duration, the same timeline test 5 already establishes) and
   asserts the actual writes that frame produces: `$30` written to `$4000`, `$4004`, and `$400C`,
   and `$0` written to `$4008` — `sting_restore`'s own silence-branch writes, matching
   `music_stop`'s identical four. *Catches:* mechanism 3 omitted entirely — an implementation with
   no re-silencing code at all now fails immediately, on the restore frame itself, instead of
   passing on a downstream absence-of-writes check that a broken and a correct implementation both
   satisfy identically. **Does not, and does not need to, catch an order swap between the flag
   write and the silencing writes** — round-2 finding 6 established that order is not behaviorally
   significant in this non-reentrant, single-frame code (§5, mechanism 3), so the first draft's own
   claim of catching "restoring the flag before, instead of after, re-silencing" is removed rather
   than kept as an untested and, it turns out, unfounded promise.

7. **Mechanism 5, demoted to a RAM-invariant hygiene check (round 1, finding 7) — no longer a
   behavioral APU-timeline test.** The first draft's test asserted a "later, unrelated song" was
   not audibly corrupted by a stale `force_trig`; walked through directly against the driver, this
   cannot happen regardless of whether the retrigger loop runs unconditionally or only on the
   audible branch (§5) — a stale `force_trig` is consumed inertly on the next song's own first
   `music_channel` tick either way. The test that survives checks the invariant this design still
   chooses to hold, as a RAM fact rather than an audible one: after a sting resolves into Silence,
   assert `force_trig` reads all zero (never armed at all on that path), distinguishing "the hygiene
   branch is present" from "it was dropped, and `force_trig` is left set through the silence" —
   *purely* a state-shape assertion now, not a claim that dropping it would be audibly wrong. If a
   future implementer chooses to drop the hygiene branch entirely (§5 explicitly permits this),
   this test should be deleted along with it, not weakened to pass regardless.

8. **Second sting replaces the first, without re-snapshotting over it** (mechanism 4). Trigger two
   stings back to back, before the first resolves; assert the eventual resume restores the *real
   field song's* state (correct channel pointers, correct position), not the *first sting's own*
   state. *Catches:* an implementation missing the `sting_left == 0` snapshot guard — the second
   trigger would snapshot the first sting's own in-flight playback and "resume" into that instead
   of the real song, an error a test only checking "does the sting eventually stop" would never
   notice.

9. **Cancellation — rewritten (round 1, finding 3) for the corrected policy.** (a) A `music`/
   map-change request for a genuinely *different* song than the one currently sounding — including
   the *original field song* the player was hearing before the sting started — cancels an
   in-flight sting: `sting_left` reads 0 immediately, no resume ever fires, and the requested song
   plays from its own beginning rather than seaming into where the field song had been (this is the
   field-song-cancels case, added in this revision as its own explicit assertion — the first
   draft's test claimed the opposite for exactly this case). (b) A request naming the **sting's own
   currently-playing song** again is the true no-op: `set_music`'s existing dedup (`cmp cur_song`)
   catches it before `music_play` is ever reached, `sting_left` is untouched, and the sting's own
   playback continues undisturbed. *Catches:* an implementation that checks a triggered `music`
   command's song against the *shadowed field song id* instead of the live `cur_song` — it would
   wrongly treat "the field song is being requested again" as the dedup case (since that check
   would compare against the wrong value), silently failing to cancel when it should and leaving a
   sting to corrupt the newly-requested field song's own playback once it eventually resolves.

10. **`init_session`/game-over path**: a sting live at the moment `player_died` fires, followed by
    `restart_game` → `init_session` → a fresh map's own song. Assert `sting_left` reads 0
    immediately after `init_session` runs (not merely "eventually," since a stale non-zero value
    ticking down into the new session is exactly the bug mechanism 2's `music_stop` fix closes),
    and that the new session's own song is never spliced with the *old* session's shadowed state.
    *Catches:* the exact bug the costing pass's own "corrected this round" passage names — a
    `music_stop` missing the `sta sting_left` line would let a stale shadow eventually restore the
    *previous* session's song state directly over a freshly-silenced new one.

11. **RPG battle interaction**: a sting live when `battle_begin` fires. Confirmed from
    `engine/rpg.asm` directly that neither `battle_begin` nor `battle_end` touches music at all —
    the field song (sting included) keeps playing straight through a battle, unmuted, exactly as
    it does today for ordinary field music (this engine currently has no battle-music swap of any
    kind). Assert `sting_left` keeps counting down unaffected by `ST_BATTLE` (ticked from
    `main_loop`, before the `game_state` branch that gates `ui_tick`, the same reason
    `flash_left`/`music_tick` are already unaffected by battle) and that a resume mid-battle
    behaves identically to a resume outside one. *Catches:* an implementation that mistakenly ties
    `sting_tick`'s call site to `ui_tick` instead of `main_loop` — it would silently stall during
    every battle, a bug invisible outside an RPG project and invisible inside one unless a test
    specifically triggers a sting immediately before a battle.

12. **NEW (round 1, finding 8) — the runtime `NO_SONG`/zero-duration guard actually engages.**
    Compile (or hand-construct) an `[OP_STING, NO_SONG, 0]` operand directly into a fixture's
    compiled event bytes — bypassing `validateProject`, the way a hand-edited or later-version
    project could — boot it, drive the script to the command, and assert: `cur_song`/`mus_enabled`
    are completely unchanged by it (the field song plays on, undisturbed), and `sting_left` stays 0
    throughout. *Catches:* an implementation without the `beq script_op_sting_skip` guard in §7 —
    it would snapshot the real song, call `music_play(NO_SONG)` (which routes to `music_stop`),
    arm `sting_left` at 0 (a no-op counter, never decremented away from idle since it starts there),
    and never call `sting_restore` at all — the field song is silenced permanently, exactly the
    destructive bug round-1 finding 8 identified in the first draft's own "harmless no-op" claim.

13. **NEW (round 1, finding 9) — `validateProject`'s song-reference and duration checks; the
    recursion case actually exercised, and a normalization-boundary case added (round-2 findings
    4 and 2).** Eight cases, each isolating one failure mode `shared/audio.js`'s new helpers could
    get wrong: (a) a top-level live Sting naming `null` (never chosen) is refused; (b) a top-level
    live Sting naming a song index that no longer exists (deleted since authored) is refused
    identically — both must produce the same "do not name a real song" error, since `songByte`
    collapses both cases to `NO_SONG` identically; (c) a *switched-off* (`off: true`) Sting naming
    nothing or a deleted song is **not** refused — the same `liveCommands` filter every other
    refusal in this file already applies; (d)/(e) a song whose `songFrameLength` computes to
    exactly 255 frames is accepted, and one computing to 256 is refused — both sides of the
    ceiling asserted explicitly, not just "some large song is refused."

    **(f) NEW, round-2 finding 4 — a live Sting naming a deleted song, authored not as a top-level
    map-event command but nested inside a `branch`'s own then-branch, inside a *common event* (not
    a map event at all)** — refused with the identical "do not name a real song" error as (b).
    **(g) NEW, its `off: true` counterpart, nested the same way** — not refused, proving the
    liveness filter still applies correctly once recursion and common-event placement are both in
    play together, not only at the top level either individually.

    **(h) NEW, round-2 finding 2 — a malformed/legacy song compares identically through both entry
    points.** Construct a deliberately non-normalized raw song object (e.g. missing `tempo`
    entirely, or an `order` referencing a pattern index past the end of `patterns`) that
    `normalizeSong` would coerce to a real, specific value (`framesPerRow` defaulting to 6,
    `order` falling back to `[0]`, etc.), reference it from a live Sting, and assert
    `validateProject`'s own accept/refuse decision (and, for an accepted one, the compiled
    duration byte) matches exactly what `compileSong` would produce for the identical raw input —
    proving `songFrameLength`'s own internal normalization (§4) actually runs, rather than the
    caller needing to have normalized first.

    *Catches:* an implementation that scans only a page's own top-level commands instead of the
    recursive `liveCommands` over `projectEvents` (cases (a)-(e) cannot catch this at all, since
    none of them is nested — this was round-2 finding 4's own point: the sabotage test must place
    the case where the sabotage actually lives, not merely claim to); an implementation that walks
    only map events and skips common events entirely (case (f)/(g)'s specific placement); an
    implementation that inlines a *different* duration formula in `validateProject` than
    `textcompile.js` uses (the exact duplication risk round-1 finding 9 named, closed by both
    consuming the same `shared/audio.js` helper — this test would catch a future edit to one call
    site that forgot the other); an off-by-one at the 255/256 boundary in either direction; and an
    implementation of `songFrameLength` that dereferences `song.order`/`song.patterns`/
    `song.tempo.framesPerRow` directly without normalizing first (case (h)) — it would throw,
    return `NaN`, or silently compute a different duration than `compileSong` does for the exact
    same raw song, on any project carrying an older or hand-edited song definition.

14. **NEW (round 1, finding 6) — the load-bearing order (`sting_tick` after `music_tick`) is
    distinguishable, and the design's own order ships correctly; sabotage claim narrowed in
    round-2 finding 5.** Author a sting whose own last frame (the final tick before `sting_left`
    reaches 0) has a distinct, known APU signature — a note starting on exactly that frame —
    different from the resumed field song's own expected signature on the frame immediately after.
    With `sting_tick` placed correctly (after `music_tick`), assert the sting's own final-frame
    note write appears on the last counted frame, and the resumed song's write on the frame after
    that reflects exactly the position the field song was at when the sting started, advanced by
    zero frames (not one). *Catches:* `sting_tick` placed **before** `music_tick` specifically —
    with that order, `sting_restore` would run before that final frame's `music_tick`, so
    `music_tick` would apply the *resumed* song's state instead of the sting's own last note,
    silently dropping the sting's final frame of audio and starting the resumed song one frame
    early. **Does not, and cannot, catch a placement after `flash_tick` instead of immediately
    after `music_tick`** — confirmed directly that `flash_tick` touches neither music/Sting state
    nor the APU, so `music_tick; flash_tick; sting_tick` and `music_tick; sting_tick; flash_tick`
    produce an identical audio/counter timeline; the load-bearing contract this test actually
    proves is "after `music_tick`, before anything that can affect or observe music state," not
    "immediately adjacent to `music_tick` in the source." Immediate adjacency (§7's boot.asm
    sketch) is kept as a maintainability convention only — a reviewer scanning `main_loop` should
    be able to see at a glance that `sting_tick` belongs to the same per-frame audio step as
    `music_tick` — and is not something this or any other test in this plan asserts; a source-order
    check (asserting the two `jsr` lines appear adjacent in `engine/boot.asm`'s own text) would be
    the right tool for that, if the convention is ever considered worth enforcing mechanically
    rather than by review.

15. **NEW (round 1, finding 10) — the compiler's `OP_STING` and the engine's `OP_STING` agree.**
    Parse `engine/constants.asm`'s own `OP_STING = $1A` line (the same `parseEquates`
    (`shared/enginesyms.js`) machinery CLAUDE.md already names as the single way tooling is meant
    to know an engine value, rather than assuming one), and assert it equals
    `main/build/textcompile.js`'s exported `OP_STING` numeric value. *Catches:* the two constants
    drifting apart — e.g. a later verb inserted between `flash` and `sting` in `EVENT_COMMANDS`
    without the matching `constants.asm` renumber, or vice versa — silently miscompiling every
    `sting` command into whatever opcode the drifted numbers happen to collide with.

16. **NEW (round 1, finding 12) — real Map Forge editor wiring, in `main/smoke.js`, not just
    compiler/engine unit tests.** Mirrors the existing real Flash-authoring scenario in
    `main/smoke.js` exactly (same `#modalHost select` "Add a command" dropdown, same
    `.field-row`/`p.hint` row lookups, same before/after summary-segment diffing), adapted for
    Sting's own song-selecting field:
    - Open the event editor, select `sting` from the "Add a command" dropdown, and confirm the
      fresh row renders with a song `select` (not Flash's "nothing to configure" case) whose
      option list **does not include a "Silence" entry** — enumerate every `option` in the row's
      own `select` and assert none reads "Silence", the exact option `music`'s own dropdown offers
      that Sting's must not.
    - Pick a real song from the dropdown (`select.value = <index>`, dispatch `change`), save, and
      assert `store.project`'s own command object landed with `op: 'sting'` and `song: <that
      index>` — mutation through the real `onchange` handler, not a hand-constructed command.
    - Assert the outside-the-modal summary row gained exactly one new segment reading `Sting:
      <chosen song's name>` (or the design's own chosen label, §10's Open Question 3), using the
      same "exact segment list, not merely `includes`" discipline the existing Flash scenario's own
      comment explains (a malformed summary that prepends garbage before a correct-looking tail
      would pass a substring check and fail this one).
    - Reopen the editor and confirm the row still shows the same song selected — the same
      round-trip proof every other verb's own field already gets.

    *Catches:* a handler wired to the wrong DOM event (`onchanged` instead of `onchange` — a
    misspelling a lexical scan of `events.js` cannot see, since `el()`'s own event-binding is
    itself the thing under test, not the source text describing it — the exact shape the Turn/Wait
    slice's own seventh finding already established as this codebase's precedent for why compiler/
    engine tests alone cannot stand in for real control wiring); a dropdown that still offers
    Silence (an author could pick it, compiling to `NO_SONG`, silently relying on the runtime guard
    from test 12 rather than being told at authoring time); a selection that updates the DOM but
    never commits to `store.project` (a rendering-only bug invisible to every unit test in this
    plan, all of which construct commands directly rather than driving the real editor).

17. **NEW (round 2, finding 1) — the module graph still loads after `songByte`/`NO_SONG` move to
    `shared/audio.js`.** Confirmed two existing, unrelated files import these names directly from
    `main/build/textcompile.js` — `main/build/generate.js` (`import { NO_EVENT, compileText,
    textTables, songByte } from './textcompile.js'`, its own line 37) and
    `test/unit/script.test.js` (`NO_SONG` among its own imports from
    `'../../main/build/textcompile.js'`, its own line 26). §4's compatibility re-export
    (`export { NO_SONG, songByte };`, added to `textcompile.js` alongside its own new import of the
    real definitions from `shared/audio.js`) is what keeps both working unmodified. A dedicated
    check, rather than relying on incidental coverage from whichever other tests happen to import
    these files first:
    ```js
    test('songByte/NO_SONG stay importable from textcompile.js after their shared/audio.js move', async () => {
      const textcompile = await import('../../main/build/textcompile.js');
      assert.equal(typeof textcompile.songByte, 'function',
        'main/build/generate.js:37 imports songByte from here');
      assert.equal(textcompile.NO_SONG, 0xff,
        'test/unit/script.test.js imports NO_SONG from here');
      const audio = await import('../../shared/audio.js');
      assert.equal(textcompile.songByte, audio.songByte,
        'must be the re-exported SAME function, not a second, stale implementation');
    });
    ```
    *Catches:* deleting `songByte`/`NO_SONG` from `textcompile.js` outright when moving them to
    `shared/audio.js` without adding the compatibility re-export — an ESM import of a name a module
    no longer exports fails at module-instantiation time, before any test's own logic runs, so
    `generate.js` and `script.test.js` would both fail to load at all (a defect round-1's own
    revision introduced and round-2's review caught, despite this design's own §2 source inventory
    already naming `generate.js` as something read during research — reading a file is not the same
    as checking every one of its import lines against a planned rename). The identity assertion
    additionally catches a "fix" that added a second, independent `songByte` definition inside
    `textcompile.js` instead of truly re-exporting the shared one — it would load without error but
    silently reintroduce the two-implementations risk finding 9 (round 1) moved the code to avoid
    in the first place.

## §13. Replayer / preview — recommendation, marked severable

**What "hear the sting itself" already gets for free: nothing new.** A sting is not a new asset —
it's an existing Sound Forge song, played a new way. The Sound Forge preview can already play any
song in isolation today; an author can already hear exactly what a sting will sound like by
previewing its source song directly. No engine or replayer change is needed for that.

**What would need real new work: previewing the pause/resume *interaction* in context** — hearing
the field song play, then duck out, then resume, from inside the Map Forge event editor.
`Replayer` (`renderer/forges/sound/replayer.js`) is a pure per-song class with no concept of
switching or layering two songs; there is no small extension available here. Building this would
mean instantiating two `Replayer` instances and writing new orchestration logic in JS that mirrors
§7's engine design — snapshot, force-trigger equivalent, silence handling, cancellation — on the
order of the engine routines themselves, not a thin wrapper. **Recommend deferring.** This is
explicitly severable from the engine feature: an author can ship and use Sting fully without any
preview beyond "audition the source song," and the in-context pause/resume preview can be added
later with zero engine-side change if it's ever prioritized.

## Open Questions

1. **The exact `STING_KERNEL_ALLOWANCE` figure (176 here, up from the first draft's 163 after
   round 1's corrections) is this design's own estimate, not a real nesasm measurement** — the same
   status Part 2 of the costing report explicitly holds its own pre-implementation numbers to.
   Confirm by building and measuring on all three RPG-capable boards before this number goes into
   `generate.js` for real (§12's own rewritten test 3 is what that confirmation looks like), per
   this file's own "measured, not assumed" convention. If margin ever gets tight, dropping the
   finding-8 runtime guard (§7's reconciliation) is the first lever, worth exactly 10 bytes.
2. **The refusal message text in §9** ("removing every Sting command (frees N bytes)") assumes
   `kernelShortfallAdvice`'s existing message-composition logic needs no format change to
   accommodate a new droppable feature — confirmed structurally true from reading the function
   (§2), and now additionally exercised by §12 test 3's own MMC3 dependent-term case, though still
   not against a real, fully-implemented Sting until the code exists.
3. **Is "Sound sting" the right author-facing label**, or should it read "Sting" to match the
   feature's own name throughout this document? A product/UX call, not a technical one — this
   design used "Sound sting" in §10's `EVENT_COMMANDS` entry only because `music`'s own label is
   "Play music" (a verb phrase), and matched that convention; either is a one-string change with no
   other consequence (§12 test 16's own summary-segment assertion would need updating to match
   whichever label ships).
4. **Whether an authored Sting should be listable/previewable from the Sound Forge's own song list
   with a "used as a sting by N events" annotation** (discoverability — an author renaming or
   deleting a song has no in-editor signal that a Sting command depends on it until
   `validateProject` refuses the next build). Not designed here; `validateProject`'s refusal (§10)
   is a correctness backstop, not a discoverability aid, the same relationship `call`'s own
   dangling-reference check has to the common-event editor's own UI.

## Round 1 revisions

Against `handoff-sting/sting-design-review1.md`, all 12 findings, all confirmed by the orchestrator
before the fix brief was written. Recorded in the costing report's own convention: what moved, and
why.

1. **High — `script_op_sting`'s `tax`/`txa` did not survive either callee.** Verified: both
   `sting_snapshot` (X 0→23) and `music_play` (X 0→`MUS_CHANNELS`) clobber X, so a duration held in
   X across either call was destroyed — every sting would have armed for a stray 4 frames
   regardless of its authored length. §7's trigger routine rewritten to hold both operands on the
   stack across both calls (same byte count as the broken version, 33, before finding 8's own
   addition). Table row, reconciliation, and total all updated.
2. **High — the duration formula used the loop *target*, not the pass *length*.** `loopRow *
   framesPerRow` is the point playback jumps back to, not the time to reach it; the real duration
   is `rows.length * framesPerRow`, the length of one full pass through `song.order`. With the
   schema's default `loop: 0`, the wrong formula produced a duration of 0 — an idle counter, so the
   sting would have played forever. §4 rewritten around the corrected formula; the "uniform across
   channels" claim is unaffected (it was always about which scalar was single-valued per song, not
   which one was correct). Test 4 rewritten to use an independently-computed expectation from a
   `loop: 0`, single-order fixture, so the old formula's 0-duration bug is exactly what the test
   would have caught.
3. **High — the same-song cancellation policy was shape (a)'s, not shape (b)'s.** Verified:
   `music_play(stingIndex)` stores the sting's own index into `cur_song` first thing, so during a
   sting `cur_song` names the sting, not the field song — `set_music`'s dedup therefore only
   protects a re-request of the sting itself, and any request for the field song (even by name)
   reaches `music_play` and cancels. §5 mechanism 2 rewritten with the corrected policy and its
   consequence (resume-in-place only for an undisturbed sting); test 9 rewritten (9(b) is now "the
   sting's own song is the no-op," and the field-song-cancels case is its own explicit assertion).
   The costing report's own same-song reasoning is confirmed accurate for shape (a) and inapplicable
   to shape (b) — the divergence is noted here rather than treated as a report error.
4. **High — the capacity plan never actually charged `kernelCodeBytes`.** The constant, the gate,
   and the advice entry were all specified, but the load-bearing `kernelCodeBytes += usesSting ?
   STING_KERNEL_ALLOWANCE : 0` line was missing — without it `checkCapacity` reserves nothing and
   §9's refusal test would never fire. §8 rewritten to spell the single `usesSting` value driving
   all three touchpoints explicitly.
5. **High — the Silence test would have passed a driver that never re-silences the hardware.**
   Asserting only `mus_enabled == 0` and "no further writes" cannot distinguish a correct restore
   from one that skips mechanism 3 entirely, since both produce identical silence downstream (
   `mus_enabled == 0` stops `music_tick` from running at all, either way). Test 6 rewritten to
   assert the actual restore-frame writes (`$30` to `$4000`/`$4004`/`$400C`, `0` to `$4008`) at the
   exact hand-computed restore frame.
6. **Medium — the `sting_tick` call site was priced nowhere and pinned nowhere.** The table counted
   `sting_tick`'s 14-byte body but never the `jsr sting_tick` needed to reach it, and §3's prose
   named `main_loop` without pinning the order relative to `music_tick`. Added: a `boot.asm` sketch
   placing the call immediately after `music_tick` (with the timing argument for why that order is
   load-bearing), a new 3-byte table row, an updated total (163→176), a rewritten reconciliation,
   and a new test (14) that distinguishes the two relative orders behaviorally.
7. **Medium — the mechanism-5 "audible blip" does not exist.** Walked through directly against the
   driver: a stale `force_trig` surviving into a later, unrelated song is consumed inertly on that
   song's own first tick (a note sets `mus_trig` on its own regardless; a rest's silence path
   ignores it) and cannot add a period write. §5 mechanism 5 rewritten to describe the audible-only
   retrigger restriction as state hygiene, kept because it is free, not because dropping it would
   be audibly wrong. Test 7 downgraded from a behavioral APU-timeline assertion to a RAM-invariant
   check.
8. **Medium — an invalid `NO_SONG`/zero-duration operand was destructive, not harmless.** The
   original runtime sketch had no guard: it would snapshot the real song, call
   `music_play(NO_SONG)` (routing to `music_stop`), arm a zero counter that never resumes, and
   silence the field song permanently. Chose to add a runtime guard (the
   `script_op_give`/`NO_ITEM` family precedent — defense in depth for a hand-edited or
   later-version project, not merely reliance on the build-time refusal) rather than remove the
   false "harmless" claim and rely on `validateProject` alone. Costs 10 bytes (§7's trigger
   routine, 33→43); a new test (12) exercises the guard directly by constructing the operand
   `validateProject` would normally prevent.
9. **Medium — validation had no importable path, and no tests.** `songByte`/`NO_SONG` lived in
   `main/build/textcompile.js`, which `shared/project.js` cannot import upward from; the duration
   computation likewise had no shared home. Moved `songByte`, `NO_SONG`, and a new
   `songTimeline`/`songFrameLength` pair (replacing `songcompile.js`'s own local `timeline()`,
   which now imports the shared version) into `shared/audio.js`, consumed identically by the
   compiler and `validateProject`. §4 and §10 rewritten around the shared helpers; §10's
   `validateProject` snippet now includes the 255-frame ceiling as real code, not only prose; four
   new tests (13) cover null/deleted reference, switched-off, nested/common-event placement, and
   both sides of the duration ceiling.
10. **Medium — the opcode's two single-writer touchpoints were both unwritten.** The design's own
    code sketches referenced `OP_STING` without ever defining it. Added: `OP_STING = opIndex
    ('sting')` exported from `textcompile.js`, and `OP_STING = $1A` in `engine/constants.asm`
    (appended after `OP_FLASH = $19`, confirmed against the file's own current table), plus a new
    test (15) asserting the two never drift apart.
11. **Medium — the allowance test's floor was too loose, and its baseline was contaminated.** A
    `cost > STING_KERNEL_ALLOWANCE - 120` floor would pass an implementation missing the entire
    79-byte `sting_snapshot`/`sting_restore` pair; comparing against a no-event MMC3 baseline
    measured Sting plus `SPLIT_LOCK_KERNEL_ALLOWANCE` together, not Sting alone. Test 3 rewritten
    to assert exact per-board equality against a baseline that already carries a surviving
    text-triggering event (isolating the split-lock term out of Sting's own delta), plus a new,
    separate MMC3 case asserting that removing a project's *sole* Sting-carrying event frees Sting
    and split lock together — the dependent-term claim §8 already made, now actually tested.
12. **Medium — no test exercised the real editor.** The design specified a distinct
    `(choose a song)` summary, a no-Silence selector, `onchange`-driven mutation, and a
    Missing-song fallback, but nothing in the test plan drove the real Map Forge. Added a
    `main/smoke.js` scenario (16), mirroring the existing real Flash-authoring scenario's own
    selector shapes exactly, covering the dropdown's option list, the mutation through the real
    change handler, and the outside-the-modal summary segment.

**Net effect on the headline total: 163 → 176 kernel-lo bytes** (findings 1, 6, and 8 are the only
ones that moved engine-code bytes; findings 2-5, 7, 9-12 corrected mechanism, formula, wiring, and
test-plan defects without changing the byte count). §7's reconciliation section is the single place
this new figure is derived and explained; every other reference to it in this document (§8's
`STING_KERNEL_ALLOWANCE` declaration, §9's documented-limitation prose, Open Question 1) was updated
to match rather than left stale.

## Round 2 revisions

Against `handoff-sting/sting-design-review2.md`, 1 high + 3 medium + 2 low, all confirmed by the
orchestrator before the fix brief was written. None of these findings moved engine-code bytes —
`STING_KERNEL_ALLOWANCE` stays 176 — so there is no new reconciliation to perform; each finding is
a JS-module-graph, layering, charging-site, or test-contract correction.

1. **High — moving `songByte`/`NO_SONG` to `shared/audio.js` would have broken two existing
   files' own module loading.** Confirmed directly: `main/build/generate.js:37` imports `songByte`
   from `./textcompile.js`, and `test/unit/script.test.js`'s own import block (line 26) imports
   `NO_SONG` from the same module — both real, pre-existing dependencies the round-1 revision's own
   §2 source inventory had already named as read, but never checked against the planned rename.
   Deleting the definitions from `textcompile.js` without replacing them with something importable
   would fail both files at ESM module-instantiation time, before any test logic runs. Chose the
   compatibility re-export remedy (`export { NO_SONG, songByte } from '../../shared/audio.js';`,
   effectively — written as an import-then-re-export so `textcompile.js` also has its own local
   binding for its own `sting`/`music` compile cases) over auditing and rewriting every existing
   import site, since it is strictly less invasive and leaves `generate.js`/`script.test.js`
   unmodified. §4 rewritten with the exact import-site citations; a new test (17) asserts the
   module graph still loads and that the re-exported `songByte` is the *same* function object as
   `shared/audio.js`'s own, not a second, driftable copy.
2. **Medium — `songFrameLength` skipped the normalization boundary `compileSong` always
   respected.** `compileSong(rawSong)` calls `normalizeSong` before ever touching `song.order`/
   `song.patterns`/`song.tempo`; the round-1 revision's `songFrameLength`/`songTimeline` pair
   dereferenced those fields directly, so a caller handing it a raw, older, or hand-edited song
   (exactly the defensive case this design invokes elsewhere, for `validateProject`'s own refusal
   checks) could throw, produce `NaN`, or silently compute a duration `compileSong` itself would
   never produce for the same input. Fixed by making `songFrameLength(rawSong)` the one place that
   normalizes, deriving its `songTimeline` call from the result; `songTimeline` itself now
   documented as taking an already-normalized song, which is exactly what `compileSong` continues
   to pass it (unchanged, no second normalization there). A new test-13 case ((h)) compares
   `validateProject`'s own accept/refuse decision and compiled duration, for a deliberately
   malformed raw song, against what `compileSong` produces for the identical input.
3. **Medium — the charging sketch still didn't fit the functions it was meant to modify.** Round
   1's fix added a `kernelCodeBytes += ...` line and a single shared `const usesSting`, neither of
   which the real source supports: `kernelCodeBytes` (`main/build/generate.js:622`) has no mutable
   accumulator, only one `return` expression starting at line 675; `kernelShortfallAdvice` (905)
   and `generateAssets` (1511) are separate functions with their own separate local `usesMove`-style
   variables, confirmed by reading all three directly. A single cached `usesSting` would also be
   substantively wrong, not merely inconvenient, since `kernelCodeBytes`/`kernelShortfallAdvice` are
   both called repeatedly against different hypothetical project variants
   (`projectWithoutCommands`). §8 rewritten around the real invariant — one predicate
   implementation (`projectUsesSting`), called locally inside each of the three functions — with
   the `kernelCodeBytes` term shown correctly inside its own `return` expression rather than as a
   standalone `+=` line.
4. **Medium — test 13's four cases never exercised the recursion the sketch's own `liveCommands`
   call is meant to protect.** All four were authorable as top-level map-event commands, so a
   validator that only scanned a page's own top-level array — missing the recursive walk into
   branches and common events entirely — would still pass every one of them. Added cases (f) and
   (g): a live, refused invalid Sting nested inside a `branch`'s own then-branch inside a common
   event, and its switched-off, not-refused counterpart at the identical nested location — proving
   liveness and recursion are both actually exercised together, not merely claimed.
5. **Low — test 14's sabotage claim overstated what an APU-timeline assertion can prove.**
   `flash_tick` touches neither music/Sting state nor the APU, confirmed directly, so
   `music_tick; flash_tick; sting_tick` and `music_tick; sting_tick; flash_tick` are audibly
   identical — the test cannot distinguish "immediately after `music_tick`" from "after
   `music_tick`, separated by unrelated code." Restated the load-bearing contract honestly (after
   `music_tick`, before anything that can affect or observe music state) in both the `boot.asm`
   sketch's own comment and test 14's own catch list; immediate source adjacency to `music_tick` is
   now named explicitly as a maintainability convention, not a tested invariant, with a note that a
   source-order check (not an audio test) would be the right tool if the convention is ever worth
   enforcing mechanically.
6. **Low — mechanism 3's ordering requirement contradicted the code, and test 6 could not have
   caught the contradiction either way.** `sting_restore` writes the shadowed `mus_enabled` flag
   first and only then, in the silence branch, performs the four re-silencing writes — the reverse
   of mechanism 3's original "before the flag is restored, not after" prose. Judged (and confirmed
   by reasoning about this codebase's own interrupt structure: NMI never reads `mus_enabled` or
   writes the four APU registers Sting touches, and nothing else runs between the two writes within
   one call) that the order is not behaviorally significant in this non-reentrant, single-frame
   code. Took the removal remedy rather than reordering: mechanism 3's prose no longer claims an
   order requirement, and test 6's own catch list no longer claims to distinguish one — the actual
   write-value assertions (the real fix from round 1, finding 5) are unchanged and remain the load-
   bearing part of that test.

## Round 3 revisions

Against `handoff-sting/sting-design-review3.md`, 2 low, both purely textual, both confirmed by the
orchestrator. No design, mechanism, or byte-total change; 176 stands.

1. **Low — §3 still stated the immediate-adjacency contract round-2 finding 5 had already demoted
   to convention in §7/test 14.** Changed "immediately after `music_tick` (§7 — the exact placement
   is timing-critical)" to "after `music_tick` (§7 — the relative order between the two is
   timing-critical; immediate source adjacency is a maintainability convention, not itself
   load-bearing)."
2. **Low — §12 test 13 said "Seven cases" while naming (a) through (h), eight.** Corrected to
   "Eight cases."

