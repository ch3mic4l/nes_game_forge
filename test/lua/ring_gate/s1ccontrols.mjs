// The S1c control declarations (plan 2.5 row 9, 2.6, 2.7): one table a runner, the matrix job list, the gate script and the unit tests all read. A LEAF module (no imports): ringjobs.mjs
// and ringprov.mjs read it, so it must not import the gate.
//
// A control is a deliberate mutation of what is under test, run next to a MATCHING POSITIVE (the same row, cell, game type and placement, unmutated, which must pass). It is
// CAUGHT only when every item in `mustFail` FAILS in an operationally sound run: a control that fails some other item, or that dies in a harness error, is NOT caught (round-1 and
// round-2 reviews of S1b both found controls "caught" by an unrelated diagnostic). `kind`: 'patch' = a ring_gate/sabotage/*.patch applied to the engine copy (an ENGINE mutation);
// 'mutation' = the harness is told something false (a HARNESS mutation); 'break' = the built ROM/scene is altered the way build_sw_*_roms.mjs --break= always has been;
// 'split' = a row-8 override edit of banks.asm/split.asm (ringsplit.mjs SPLIT_SABOTAGES), built into the harness ROM of an MMC3 cell.
// `declare(ring)` answers what the control does on a cell whose ring axis is `ring` (1 vertical, 2 horizontal): { outcome: 'caught', mustFail } or { outcome: 'pass', why }.
export const CELL_IDS = ['MMC1-V', 'MMC1-H', 'MMC3-V', 'MMC3-H', 'U512-V', 'U512-H'];
export const MMC3_CELLS = ['MMC3-V', 'MMC3-H'];
export const SLICE = 'S1c';

/** The item ids a row's judge must emit, each exactly once, in any order: the certificate's per-row evidence is incomplete without every one (s1caudit.mjs). */
export const REQUIRED_ITEMS = {
  5: ['run:exit', 'run:complete', 'arm:geometry', 'ppu:writes', 'ppu:live-nt', 'block:advance', 'chunk:size', 'strip:blocks', 'wrap:covered', 'cover:domain', 'tail:scroll', 'deadline:strip', 'deadline:mixed', 'real:armed'],
  6: ['run:operational', 'close:queue', 'close:drain', 'close:publication', 'close:scroll', 'close:deadline'],
  8: ['run:exit', 'r8:run', 'r8:arm-grammar', 'r8:irq-grammar', 'r8:irq-count', 'r8:prg-group', 'r8:prg-window', 'r8:chr-regs', 'r8:terrain', 'r8:lock', 'r8:arm-deadline', 'r8:totals', 'r8:coverage']
};
/** Items whose failure means the RUN was not a sound one (a harness error, a timeout, an incomplete workload): a control with one of these not passing is never "caught". */
export const UNSOUND_IDS = ['run:exit', 'run:complete', 'run:operational', 'r8:run'];
/** The Mesen exit statuses a control's recorder may legitimately end with (a template's own diagnostic exit); a positive must exit 0. */
export const CONTROL_EXIT_OK = [0, 5, 7, 8, 9];

const caught = (...mustFail) => ({ outcome: 'caught', mustFail });
const passes = (why) => ({ outcome: 'pass', why });
const vOnly = (mustFail, why) => (ring) => (ring === 1 ? caught(...mustFail) : passes(why));
const hOnly = (mustFail, why) => (ring) => (ring === 2 ? caught(...mustFail) : passes(why));
const all = (...mustFail) => () => caught(...mustFail);

export const CONTROLS = {
  // ---- row 5: the NMI strip drain (ringnmi.mjs judgeNmi) ------------------------------------------------------------------------------------------------------------------------------
  'nmi-chunk4': { row: 5, kind: 'break', arg: 'chunk4', what: 'the strip drainer\'s block chunk raised from 3 to 4 (sw_ns_go operand patched in the built ROM)', declare: all('chunk:size', 'deadline:strip'), slice: SLICE, scope: 'every cell, action resident + rpg banked' },
  'nmi-mixed3': { row: 5, kind: 'break', arg: 'mixed3', what: 'the mixed arm\'s block chunk raised from 2 to 3 (sw_nsr_go operand patched)', declare: all('chunk:size', 'deadline:mixed'), slice: SLICE, scope: 'every cell, action resident + rpg banked' },
  'nmi-strip-len-30-vertical': { row: 5, kind: 'patch', arg: 'strip-len-30-vertical', what: 'the vertical ring arms a 30-block column strip instead of 15 (ENGINE patch)', declare: vOnly(['arm:geometry', 'strip:blocks'], 'the patch edits the vertical ring\'s column length only; a horizontal ring is the same code as the baseline'), slice: 'S1a patch, S1c row 5', scope: 'every cell' },
  'nmi-dest-plus08-vertical': { row: 5, kind: 'patch', arg: 'dest-plus08-vertical', what: 'the vertical strip\'s second half is drawn at nametable +$08 (ENGINE patch)', declare: vOnly(['arm:geometry', 'ppu:live-nt'], 'the patch edits the vertical ring\'s destination nametable only'), slice: 'S1a patch, S1c row 5', scope: 'every cell' },
  'nmi-wrap-col-30': { row: 5, kind: 'patch', arg: 'wrap-col-30', what: 'the vertical ring\'s column strip wraps at 30 blocks (the four-screen modulus) instead of 15 (ENGINE patch)', declare: vOnly(['ppu:writes', 'block:advance', 'ppu:live-nt'], 'the patch edits the column wrap only; the row strip has its own wrap'), slice: 'S1a patch, S1c row 5', scope: 'every cell' },
  'nmi-wrap-row-32': { row: 5, kind: 'patch', arg: 'wrap-row-32', what: 'the horizontal ring\'s row strip wraps at 32 instead of 16 (ENGINE patch)', declare: hOnly(['ppu:writes', 'block:advance', 'ppu:live-nt'], 'the patch edits the row wrap only; the column strip has its own wrap'), slice: 'S1a patch, S1c row 5', scope: 'every cell' },
  'nmi-arm-len30': { row: 5, kind: 'mutation', arg: 'arm-len30', what: 'the harness arms the strip with length 30 on a ring (HARNESS mutation of the armed strip, then the real NMI drains it)', declare: all('arm:geometry', 'strip:blocks'), slice: SLICE, scope: 'every cell' },
  'nmi-arm-wrong-axis': { row: 5, kind: 'mutation', arg: 'arm-wrong-axis', what: 'the harness arms the other axis\'s strip (st_active 1 on a horizontal ring, 2 on a vertical one)', declare: all('arm:geometry', 'strip:blocks'), slice: SLICE, scope: 'every cell' },
  'nmi-arm-start-past-wrap': { row: 5, kind: 'mutation', arg: 'arm-start-past-wrap', what: 'the harness arms a start offset at the ring\'s wrap (past its last block)', declare: all('arm:geometry'), slice: SLICE, scope: 'every cell' },
  // the coverage-removal controls: a plan that omits part of the required timing domain (a start offset, the second attribute class on a mixed strip, the worst family) must fail cover:domain and nothing else
  'nmi-cover-drop-start': { row: 5, kind: 'mutation', arg: 'cover-drop-start', what: 'the plan omits every case that starts at the middle offset of the ring (HARNESS mutation of the case list)', declare: all('cover:domain'), slice: SLICE, scope: 'every cell' },
  'nmi-cover-drop-class': { row: 5, kind: 'mutation', arg: 'cover-drop-class', what: 'the plan omits the second strip-coordinate attribute class (st_ftile bit 1 set) from every mixed case, base and worst family (HARNESS mutation of the case list)', declare: all('cover:domain'), slice: SLICE, scope: 'every cell' },
  'nmi-cover-drop-worst': { row: 5, kind: 'mutation', arg: 'cover-drop-worst', what: 'the plan omits the whole worst family (the highest page-crossing metatile ids, class 1, the armed split tail on MMC3, mixed work under the one-packet and the eight-packet queue) (HARNESS mutation of the case list)', declare: all('cover:domain'), slice: SLICE, scope: 'every cell' },
  // ---- row 6: the text-box close frame (ringclose.mjs judgeClose) ------------------------------------------------------------------------------------------------------------------------
  'close-no-flash': { row: 6, kind: 'break', arg: 'no-flash', what: 'the Flash command is removed from the scene, so the close frame queues no 3+32 palette packet', declare: all('close:queue'), slice: SLICE, scope: 'every cell, action resident + rpg banked' },
  'close-slow-drain': { row: 6, kind: 'break', arg: 'slow-drain', what: 'eight nops added to vram_drain\'s byte loop (text.asm override), so the close frame\'s drain overruns vblank', declare: all('close:deadline'), slice: SLICE, scope: 'every cell, action resident + rpg banked' },
  'close-expect-87': { row: 6, kind: 'mutation', arg: 'expect-87', what: 'the retired fixed vram_len = 87 assertion is re-applied to a ring (HARNESS mutation); on a horizontal ring the true length is 84, and the exit-7 route must FAIL, not pass', declare: hOnly(['close:queue'], 'the vertical ring\'s close frame really is vram_len 87'), slice: SLICE, scope: 'every cell' },
  'close-expect-split-horizontal': { row: 6, kind: 'mutation', arg: 'expect-split-horizontal', what: 'a horizontal ring is expected to publish its close row in two packets (HARNESS mutation)', declare: hOnly(['close:queue'], 'a vertical ring mid-scroll really does split its close row'), slice: SLICE, scope: 'every cell' },
  'close-expect-unsplit-vertical': { row: 6, kind: 'mutation', arg: 'expect-unsplit-vertical', what: 'a vertical ring mid-scroll is expected to publish its close row in one packet (HARNESS mutation)', declare: vOnly(['close:queue'], 'a horizontal ring really does publish one 3+32 close row'), slice: SLICE, scope: 'every cell' },
  // ---- row 8: the MMC3 split, split_lock and switch_prg_bank (ringsplit.mjs judgeSplit; MMC3 cells only) --------------------------------------------------------------------------------
  'split-prg-r7-wrong': { row: 8, kind: 'split', arg: 'prg-r7-wrong', what: 'switch_prg_bank writes R7 = bank+2 (R6/R7 corrupted; an override of banks.asm)', declare: all('r8:prg-group', 'r8:prg-window'), slice: SLICE, scope: 'MMC3 cells, action resident (a permanently wrong R7 runs the banked RPG overlay out of the wrong window: the run is not a sound one there)' },
  'split-prg-transient': { row: 8, kind: 'split', arg: 'prg-transient', what: 'switch_prg_bank commits a wrong R6/R7 pair and restores the right one before it returns (a transient wrong window; an override of banks.asm)', declare: all('r8:prg-group', 'r8:prg-window'), slice: SLICE, scope: 'MMC3 cells, action resident + rpg banked (the window is wrong for a few dozen cycles inside the fixed-bank routine and right again on return: a sound run on the banked overlay too)' },
  'split-r0': { row: 8, kind: 'split', arg: 'split-r0', what: 'split_arm selects R0 instead of R1 (override of split.asm)', declare: all('r8:arm-grammar', 'r8:chr-regs'), slice: SLICE, scope: 'MMC3 cells, action resident + rpg banked' },
  'split-wrong-r1': { row: 8, kind: 'split', arg: 'split-wrong-r1', what: 'split_arm writes the font bank into R1 at the top of the frame (override of split.asm)', declare: all('r8:arm-grammar', 'r8:terrain'), slice: SLICE, scope: 'MMC3 cells, action resident + rpg banked' },
  'split-no-sei': { row: 8, kind: 'split', arg: 'no-sei', what: 'switch_prg_bank does not mask the scanline IRQ (sei removed)', declare: all('r8:prg-group', 'r8:terrain'), slice: SLICE, scope: 'MMC3 cells, action resident + rpg banked' },
  'split-no-lock': { row: 8, kind: 'split', arg: 'no-lock', what: 'split_arm ignores split_lock', declare: all('r8:lock', 'r8:prg-group', 'r8:arm-grammar'), slice: SLICE, scope: 'MMC3 cells, action resident + rpg banked' },
  'split-arm-while-locked': { row: 8, kind: 'split', arg: 'arm-while-locked', what: 'a locked frame still latches and enables the IRQ (skipping only the R1 select)', declare: all('r8:lock'), slice: SLICE, scope: 'MMC3 cells, action resident + rpg banked' },
  'split-irq-left-armed': { row: 8, kind: 'split', arg: 'irq-left-armed', what: 'the IRQ handler leaves the line enabled when its program ends', declare: all('r8:irq-count', 'r8:irq-grammar'), slice: SLICE, scope: 'MMC3 cells, action resident + rpg banked' }
};

export const controlIds = (row) => Object.keys(CONTROLS).filter((id) => CONTROLS[id].row === row);
export const declaredFor = (id, ring) => CONTROLS[id].declare(ring);
/** The runner flags for a control: { sabotage, mutation, breakMode }. */
export const controlFlags = (id) => { const c = CONTROLS[id]; return { sabotage: c.kind === 'patch' ? c.arg : null, mutation: c.kind === 'mutation' ? c.arg : null, breakMode: c.kind === 'break' ? c.arg : null, split: c.kind === 'split' ? c.arg : null }; };
/** Which (gameType, placement) builds a control runs on: a deadline control is also run on the banked RPG placement, which changes the timing. */
export const controlBuilds = (id) => (CONTROLS[id].scope.includes('rpg banked') ? [['action', 'resident'], ['rpg', 'banked']] : [['action', 'resident']]);
/** Every reachable (gameType, placement): action banked does not exist (N/A with a source proof). */
export const BUILDS = [['action', 'resident'], ['rpg', 'resident'], ['rpg', 'banked']];
export const positiveLabel = (row, cell, gt, placement) => `s1c-r${row}-${cell}-${gt}-${placement}`;
export const controlLabel = (id, cell, gt, placement) => `s1c-r${CONTROLS[id].row}-ctl-${id}-${cell}-${gt}-${placement}`;
