// What each sabotage patch is DECLARED to do to each row-1 identity cell, and which (sabotage, cell) combinations are PREDECLARED as unbuildable.
// Declared here, from reading the patch and the source, so the runners can compare every cell's actual outcome with its declared one and
// return a machine verdict that does not depend on a human reading the table (review 2 finding 4).
//
// identity outcome of a cell: 'catch' (row 1 rejects the build), 'pass' (row 1 cannot see it -- the row-3 oracle's job).
// build-error witness: a combination the patch makes UNBUILDABLE for a reason provable from source. It is left out of the behavioural run, but
// not on trust: the runner still attempts the build and requires it to fail with the predeclared message; a build that succeeds contradicts
// the declaration (exit 1) and a different error is an unexpected error (exit 2).

/**
 * The rings a sabotage has a patch for (sabotage/<name>.patch = ring 2, sabotage/vertical/<name>.patch = ring 1) -- THE single source of which rings a sabotage runs on. Both rings run on
 * shipped code (S2 C2 the vertical fork, S3 C1 the horizontal one), so a (sabotage, cell) combination is N/A only when the sabotage has no meaningful form for that ring:
 * 'wrap-row-32' on a vertical ring is an EQUIVALENT MUTANT, because the vertical ring's SW_RING_ROW_LEN is the torus literal 32; 'strip-len-30-vertical' and 'wrap-col-30' on a
 * horizontal ring are the mirror images, because the horizontal ring's SW_RING_COL_LEN is already 30 (NO_FORM_REASON; prov_unit.mjs builds each pair of ROMs and compares them: with the
 * mutation and without it they are byte for byte the same). The table is pinned against the patch files (prov_unit.mjs) and every excluded ring must carry a reason.
 */
export const SABOTAGE_RINGS = { 'strip-len-30-vertical': [1], 'wrap-col-30': [1], 'wrap-row-32': [2] };
export const sabotageRings = (name) => SABOTAGE_RINGS[name] ?? [1, 2];
/** Why a sabotage has no form on a ring SABOTAGE_RINGS leaves out: the printed source proof of the control-level N/A (run_identity / run_oracle / run_campaign / the gate). */
export const NO_FORM_REASON = {
  'strip-len-30-vertical': { 2: 'a horizontal ring\'s SW_RING_COL_LEN is already 30 (generate.js emits `ringMode === 1 ? 15 : 30`), so the mutation `SW_RING_COL_LEN = 30` generates the very constant it replaces: an equivalent mutant (an identical ROM) that no row can catch' },
  'wrap-col-30': { 2: 'a horizontal ring\'s SW_RING_COL_LEN is already 30, so `cmp #30` assembles to the very bytes `cmp #SW_RING_COL_LEN` already is: the mutation is an equivalent mutant (an identical ROM) that no row can catch' },
  'wrap-row-32': { 1: 'a vertical ring\'s SW_RING_ROW_LEN is the torus literal 32, so `cmp #32` assembles to the very bytes `cmp #SW_RING_ROW_LEN` already is: the mutation is an equivalent mutant (an identical ROM) that no row can catch' }
};
export const noFormReason = (name, ring) => NO_FORM_REASON[name]?.[ring] ?? `sabotage ${name} has no meaningful ring-${ring} form`;

/** identity[name](cell, gameType, banked) -> 'catch' | 'pass' */
export const IDENTITY_OUTCOME = {
  // SW_RING_COL_LEN = 30: wrong for the vertical ring (wants 15). The horizontal ring's own value is 30, so the form is an equivalent mutant there (SABOTAGE_RINGS: ring 1 only, never built on ring 2)
  'strip-len-30-vertical': () => 'catch',
  // the wrap compare operands: wrap-col-30 equals the horizontal geometry (30) -- ring 1 only, like the strip length; wrap-row-32 equals the vertical geometry (32) -- ring 2 only
  'wrap-col-30': () => 'catch',
  'wrap-row-32': () => 'catch', // ring 2 only: the vertical form is an equivalent mutant (SABOTAGE_RINGS, NO_FORM_REASON), that cell is N/A and never built
  // a destination-byte change: not an operand row 1 reads
  'dest-plus08-vertical': () => 'pass',
  // STEP 1 / END 4 differ from both geometries (vertical 1/2, horizontal 2/4)
  'render-four-nts': () => 'catch',
  // the player-step routines return at once: no label or constant changes
  'no-walk-v': () => 'pass',
  'no-walk-h': () => 'pass',
  // glyph / attribute-mask / shadow-offset changes inside the dialogue overlay: not row-1 operands
  'wrong-glyph': () => 'pass',
  'instant-text': () => 'pass',
  'dlg-attr-nomask': () => 'pass',
  // large-world faults (coverage campaign): operand/destination changes row 1 does not read
  'region-carry-23': () => 'pass',
  // Shake controls: only a real Shake event reaches them (the identity row builds, it never shakes)
  'continue-pos-zero': () => 'pass',
  'pjg-lag-7': () => 'pass',
  'pjg-no-col-local': () => 'pass',
  'pjg-no-row-local': () => 'pass',
  'battle-return-no-render': () => 'pass',
  'shake-no-nt-flip': () => 'pass',
  'shake-nt-eor2': () => 'pass',
  'camhi-mask-7f': () => 'pass',
  'blk-hi-drop': () => 'pass',
  'dlg-attr-offset-n32': () => 'pass',
  // the flag says banked: an RPG cell requested resident disagrees with the ROM (caught); a cell requested banked agrees with it (the flag is
  // true there anyway). Action cells cannot build (witness below).
  'forced-banked': (cell, gameType, banked) => (gameType === 'rpg' && !banked ? 'catch' : 'pass'),
  // compacted tables on horizontal: STEP/END changed to 1/2, which is the vertical geometry; the vertical cells' row-1 operands are unchanged
  'compacted-cam-nt-horizontal': (cell) => (cell.ring === 2 ? 'catch' : 'pass'),
  // S1b padding mutation: a delay loop at the top of the mainline body; no row-1 operand reads it
  'pad-mainline-over': () => 'pass',
  'pad-mainline-under': () => 'pass',
  // S1b round 2 seam sabotages: a stale Move scroll and a strip read from the wrong source column; both leave every ROW-1 operand identity as shipped (they only change what a Move frame publishes / which source byte a strip takes)
  'move-scroll-stale': () => 'pass',
  'strip-src-eor1': () => 'pass',
  // STREAM_RING forced 0: every cell that builds reports STREAM_RING 0 where it wants 1 or 2
  'ring-forced-0': () => 'catch'
};

/** buildErrorWitness(name, cell, gameType, banked) -> { match: RegExp, proof: string } | null */
export function buildErrorWitness(name, cell, gameType) {
  if (name === 'forced-banked' && gameType === 'action') {
    return {
      match: /Undefined symbol/,
      proof: 'SW_DLG_BANKED=1 makes engine/streamworld.asm assemble a reference to the battle-bank overlay symbol; an action project has no battle bank '
        + '(streamplacement.js:627-631 requires battleBankEnabled; project.js:2697-2699 requests no code regions for action; cartridge.js:674-675 supplies none), so the symbol is undefined'
    };
  }
  if (name === 'ring-forced-0' && cell.ring === 2) {
    return {
      match: /Branch address out of range/,
      proof: 'STREAM_RING=0 removes the horizontal ring\'s far branch (production since S3 C1: the `.if STREAM_RING` bne ring_far1 / jmp cross_none in engine/player.asm\'s cross_left_cut); '
        + 'the plain `beq cross_none` is out of range on every horizontal streamed build (the branch-site audit of round 1: only that site fails, on all three mappers)'
    };
  }
  return null;
}

/** Classifies one build failure of a sabotage run: 'witnessed' (predeclared and the message matches), 'contradicted' (message differs), 'unexpected'. */
export function classifyBuildError(name, cell, gameType, message) {
  const w = name ? buildErrorWitness(name, cell, gameType) : null;
  if (!w) return { kind: 'unexpected' };
  return w.match.test(message) ? { kind: 'witnessed', proof: w.proof, match: String(w.match) } : { kind: 'unexpected', declared: String(w.match) };
}
