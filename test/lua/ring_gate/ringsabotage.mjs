// What each sabotage patch is DECLARED to do to each row-1 identity cell, and which (sabotage, cell) combinations are PREDECLARED as unbuildable.
// Declared here, from reading the patch and the source, so the runners can compare every cell's actual outcome with its declared one and
// return a machine verdict that does not depend on a human reading the table (review 2 finding 4).
//
// identity outcome of a cell: 'catch' (row 1 rejects the build), 'pass' (row 1 cannot see it -- the row-3 oracle's job).
// build-error witness: a combination the patch makes UNBUILDABLE for a reason provable from source. It is left out of the behavioural run, but
// not on trust: the runner still attempts the build and requires it to fail with the predeclared message; a build that succeeds contradicts
// the declaration (exit 1) and a different error is an unexpected error (exit 2).

/** identity[name](cell, gameType, banked) -> 'catch' | 'pass' */
export const IDENTITY_OUTCOME = {
  // SW_RING_COL_LEN = 30 on every ring: wrong for the vertical ring (wants 15), the horizontal ring's own value
  'strip-len-30-vertical': (cell) => (cell.ring === 1 ? 'catch' : 'pass'),
  // the wrap compare operands are literals: wrap-col-30 equals the horizontal geometry (30), wrap-row-32 equals the vertical geometry (32)
  'wrap-col-30': (cell) => (cell.ring === 1 ? 'catch' : 'pass'),
  'wrap-row-32': (cell) => (cell.ring === 2 ? 'catch' : 'pass'),
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
      proof: 'STREAM_RING=0 removes the ring far-branch of 03-player-far-branch.patch (the `.if STREAM_RING` jmp at player.asm:339); the pristine `beq cross_none` is '
        + 'out of range on every horizontal streamed build (the branch-site audit of round 1: only that site fails, on all three mappers)'
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
