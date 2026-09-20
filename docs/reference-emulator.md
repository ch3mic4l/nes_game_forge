# Reference: The emulator

Current-state reference, moved verbatim out of `CLAUDE.md` on 2026-09-20 so that file stays small
enough to load into every session. Maintain it the way CLAUDE.md was maintained: update it in the
same change that alters what it describes. Cross-references such as "The kernel budget, above" or
"The event system, below" name sibling sections, which are now sibling `docs/reference-*.md`
files; `CLAUDE.md` indexes them all.

### The emulator

`renderer/emulator/core/` is a vendored jsnes. **Read `renderer/emulator/core/FORGE-PATCHES.md`
before touching or upgrading it** — it lists the deliberate divergences from upstream. Run control
(stepping, breakpoints, watchpoints) is layered *outside* the core in `runcontrol.js` to keep the
vendored code close to upstream; `Emulator.stepInstruction()` mirrors the body of `nes.frame()`
and must be updated in step with it. `Emulator.reset()` goes through the core's own `reloadROM()`
rather than `nes.reset()`: that builds a *new* PPU and mapper, and hand-reimplementing only
part of what `loadROM` does can leave state like the nametables unallocated, throwing from
inside the PPU on the first background write after reset.

**The run loop paces itself by wall-clock time, never one-frame-per-rAF.** `requestAnimationFrame`
fires at the display's refresh rate; on a 120 Hz monitor a frame-per-callback loop runs the game at
2× and produces audio twice as fast as the sound card drains it, which fills the worklet's ring
buffer and then garbles everything after (this shipped, and presented as "the music sounds garbled
towards the end"). `tick()` in `player.js` owes frames to elapsed time at 60.0988 fps, and the
worklet reports its buffer depth back so `AudioOut.driftRatio()` can trim the pace ±2% to hold a
~93 ms cushion — that feedback, not the ring buffer's size, is what absorbs the residual clock skew
between `performance.now()` and the audio hardware.

**Capture is read-only of what was already drawn, and the encoder never runs inside the
emulator.** 📷 Shot is `canvas.toBlob` on the player's own canvas; ⏺ Record drives
`renderer/emulator/capture.js` (the recorder's policy: keep the frame on screen at Record, then
every third one, a pending queue bounded at 8, a 300-frame cap) over `renderer/emulator/gif.js`
(the GIF format itself: a full 256-entry global colour table with LZW minimum code size 8, one
independent LZW stream per frame, bounding-box diffs with disposal 1 and no transparent index,
nearest-colour substitution once the table fills). Neither belongs in `shared/`: both are
DOM- and Node-free and `node:test` imports them directly, but nothing outside the renderer has to
agree with them. Two rules hold the recorder together. `onFrame` **copies and queues, nothing
more** — it runs inside `emulator.runFrame()` (up to four times per animation callback via
`tick()`, far more via `stepOut()`), so encoding there would be unbounded work in the run loop, and
an exception there would surface via `tick()` as `Crashed:`, a recorder bug wearing an emulator
crash's clothes; `drainCapture()` encodes afterwards inside its own try/catch. The copy is not
defensive style: jsnes hands `onFrame` its **one reused PPU buffer**, whose pre-render lookahead
writes row 0 before the next frame, so a stored reference turns into a frame correct on the canvas
but wrong in the file. `stepAnd`'s own `writeFrame` is excluded from sampling by a flag, or the
Frame button records a duplicate and an instruction step records a partial frame. **And the GIF's
real test is Chromium's, not ours.** `test/lib/gifdecode.js` decodes what `gif.js` produced and the
unit tests assert pixel-identity, except in the one case that can't be exact — a frame carrying
more colours than the table holds, where the nearest-colour substitution is asserted against an
independently computed expectation instead. Both files were written together, though, so a
matched-pair error in their shared LZW code-width rule can pass every round trip here while
producing a file nothing else accepts — only the smoke test, decoding the same bytes via the
platform's own `ImageDecoder`, has ever caught one; any change to `gif.js` must keep that check,
and a new format written the same way should get one too.

**Item 7's `test/lib/eventdecoder.js` is a comparable test-only layer for a different wire format.**
It walks the actual bytes `encodeCommand`/`encodeEvent` (`main/build/textcompile.js`) produce,
opcode by opcode: `decodeCommand` handles `branch`, `choice`, `warp` and `say` explicitly (each has
its own compiled shape a generic width can't express), gives `sting`/`sfx`/`battle` their real
exceptional widths, and falls back to `EVENT_COMMANDS[opcode].args.length` for everything else —
schema-driven for that remainder. An exhaustive corpus in `test/unit/project.test.js` exercises
every real `encodeCommand` case against it. It resolves a warp's raw screen operand to a real
screen *object* (the shape `flatScreens` returns), so two builds compare by identity rather than by
an index a reorder/duplicate/delete/resize would change. Like `gif.js`/`gifdecode.js` above, it
lives beside the tests that use it — never exported from or imported by `main/build/` — so a change
to the wire format must keep this decoder in step, not the other way around.
