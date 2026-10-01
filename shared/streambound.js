// The supported streamed-screen sprite-tile bounds (phase 3a slice S1, docs/reference-engine.md
// "The streamed entity projection"). A leaf module on purpose: shared/project.js needs the
// numbers inside validateProject, and shared/streamlayout.js (which imports project.js for
// LIMITS) re-exports them, so each value has ONE definition and no import cycle.
//
// THE BOUNDS ARE THE OUTPUT OF THE FRAME GATE (phase 3a plan section 5, 11.8) and are never hand-picked.
// test/unit/streamtilebound.test.js recomputes STREAM_TILE_CERTIFIED from test/fixtures/streambound-curve.json (the
// Mesen re-sweep of the (a1) engine) and fails if this file and the curve disagree. There are two bounds because
// switch-bound tiles (a project with `screen.boundTiles`, BOUND_TILE_ENABLED) make every streamed body dearer: each
// probe costs about 27 more cycles, and the curve fails one tile earlier.
//
//   STREAM_TILE_CERTIFIED  the largest n at which the whole sweep passes, per curve.
//                          plain 16 (no bound tile)  bound tiles 15
//   STREAM_TILE_MARGIN     the margin policy (Chris, 2026-09-30): SHIP ONE BELOW THE CERTIFIED n, per curve.
//   STREAM_TILE_BOUND                    the figure a streamed screen is held to: 15
//   STREAM_TILE_BOUND_WITH_BOUND_TILES   the figure when projectUsesBoundTiles(project): 14
//
// THE CURVE IS EVIDENCE FOR ONE ENGINE. The JSON stores a fingerprint of engine/*.asm (comments stripped) and
// streamtilebound.test.js fails when the engine no longer matches it. Any change that moves the cycles of a streamed
// body -- draw_entities, entity_animate, the mover parity gate, the strip arms, the NMI, the guard -- can move these
// numbers, so it needs the sweep re-run (test/lua/sw_bound_sweep.mjs: stages A, B, C, R, then `plan F` / `runF`, then
// `agg --write`) and this file re-derived. A green test on a stale record is impossible by construction; a hand-edited
// fingerprint is the only way round it, and is wrong.
//
// Provenance (2026-10-01, S1 option (a1): the engine runs each autonomous mover on half the bodies, `mover_parity_gate`
// in engine/entities.asm; the whole curve was re-swept on it, NO record of the earlier engine was kept):
//   design          EXHAUSTIVE at the certified n of each curve, ONE confirmed failing row at the next n. Exhaustive means,
//                   at plain 16 and bound tiles 15, on action: presets P1-P8 x both arts x the shapes even/front/back/scatter
//                   x blocked chasers k in {0,4,7,8} x (the 12 Flash-npc y values 193..234 + Flash-free; k = 8 has no Flash
//                   npc); the FULL unordered-partition set of n (186 at 16, 146 at 15) on P1/P2/P6/P8 x both arts x k = 0 x
//                   y 225 and 234; and the named rows: review 3's authored R3-F1 scenes (direction-specific turn animations
//                   and chasers in a solid patch), review 2's out-of-grid cases (Flash x 241, placement (174,203), sizes
//                   [1,3,1,3,1,3,1,3] at k=5), a dense Flash y band 186-238 on P6/P8 wide, odd k, and (plain only) the
//                   placement grid. RPG: 500 spot checks at n = 16, P0/P1/P5/P7/P8 x both arts x k {0,7}, y 234. The failing
//                   rows at the next n (plain 17: P8 wide k=7 y 212, Flash x 241, 31,741 cycles; bound tiles 16: 31,227 in the
//                   stage F isolated re-run, 31,746 in the grid) were found by a failure search and CONFIRMED by an isolated
//                   re-run; the search stopped at the first one.
//   sampled         everything else, and said so in the record (`sampling`): every other n; the partitions of P3/P4/P5/P7 and
//                   of y other than 225/234; odd k on 36 jobs per curve; Flash x other than 241/242; one bound tile (row 0,
//                   col 0, switch 0, metatile 2); frame counts and durations outside the presets P0-P8 (the editor admits up
//                   to 32 frames, durations 1..255 and non-looping animations; the presets use 1-4 frames, durations 1/2/8
//                   and loops, and `loop` has no reader in main/build, so a non-looping animation compiles to the same bytes);
//                   RPG beyond the n = 16 spot checks.
//   margin          the tightest passing row at the certified n: plain 16 -- 29,695 cycles, 85 under the 29,780 gate (action,
//                   wide art, P8, k = 7, Flash y 212, Flash x 241); bound tiles 15 -- 29,722, 58 under (the same shape). The
//                   shipped figures are one tile below, so the margin the author gets is larger than that, but only the
//                   certified n was swept exhaustively. STREAM_TILE_MARGIN_CYCLES records the two figures; the test
//                   recomputes them.
//   the failure     is the frame's own limit: the body that carries the deferred strip arm plus a coincident interrupt
//                   crosses 29,780 and the overrun skips a frame (plan 11.8). It needs blocked chasers (about 85 cycles each
//                   for their second probe), a Flash npc low on the screen and animated art; the same scenes with
//                   half-rate movers were measured at the prototype first (Q1c).
//   not measured    the SYNTHETIC forced-Flash stress (a RAM poke re-arms Flash every 7 frames while a strip is in flight;
//                   stage S, optional, NOT run on this engine: the earlier engine overran it at every n swept, and no
//                   authored schedule has been observed to reach it). Code Forge code that draws a pose the animation
//                   tables do not define, or overrides the mover gate, voids the bounds (plan T11).
export const STREAM_TILE_CERTIFIED = Object.freeze({ plain: 16, boundTiles: 15 });
export const STREAM_TILE_MARGIN = 1;
export const STREAM_TILE_MARGIN_CYCLES = Object.freeze({ plain: 85, boundTiles: 58 });
export const STREAM_TILE_BOUND = STREAM_TILE_CERTIFIED.plain - STREAM_TILE_MARGIN;
export const STREAM_TILE_BOUND_WITH_BOUND_TILES = STREAM_TILE_CERTIFIED.boundTiles - STREAM_TILE_MARGIN;
