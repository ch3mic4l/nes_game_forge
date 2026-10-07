// The certificate matrix's job list, in a leaf module (no imports of the gate) so that BOTH the runner (run_matrix.mjs) and the harness fingerprint
// (ringprov.mjs) read the same declaration: the fingerprint is seeded from the argv[0] script of every job that is really executed, never from a
// second hand-kept list. A job: { name, argv, expect: { exit, log: RegExp }, group, stamps }. `stamps` = the job writes a provenance stamp (a --prov-dir
// job); a raw job (the repro guards, the harness's own tests, the selection-error probes, the capacity table) writes none.
import path from 'node:path';

const O = 'test/lua/ring_gate/run_oracle.mjs';
const I = 'test/lua/ring_gate/run_identity.mjs';
const CAMP = 'test/lua/ring_gate/run_campaign.mjs';
const S1B = 'test/lua/ring_gate/run_s1b.mjs';
const PAD_CELLS = ['MMC1-V', 'MMC1-H', 'MMC3-V', 'MMC3-H', 'U512-V', 'U512-H'];
const CELL_IDS = ['MMC1-V', 'MMC1-H', 'MMC3-V', 'MMC3-H', 'U512-V', 'U512-H'];
const ALL_SABOTAGE = ['strip-len-30-vertical', 'wrap-col-30', 'wrap-row-32', 'dest-plus08-vertical', 'render-four-nts', 'compacted-cam-nt-horizontal', 'ring-forced-0', 'dlg-attr-offset-n32',
  'dlg-attr-nomask', 'wrong-glyph', 'instant-text', 'forced-banked', 'no-walk-v', 'no-walk-h',
  // round 3 campaign sabotages: declared invisible to the identity row (they need a large world, a redraw entry or a Shake)
  'region-carry-23', 'camhi-mask-7f', 'blk-hi-drop', 'pjg-lag-7', 'pjg-no-col-local', 'pjg-no-row-local', 'battle-return-no-render', 'continue-pos-zero', 'shake-no-nt-flip', 'shake-nt-eor2',
  // S1b: the full-system padding mutation (over = fails the G gate; under = its matching positive)
  'pad-mainline-over', 'pad-mainline-under',
  // S1b round 2: seam sabotages (a stale Move scroll; a strip read from the wrong source column)
  'move-scroll-stale', 'strip-src-eor1'];

/**
 * The job list. A job: { name, argv, expect: { exit, log: RegExp }, group }. `group` orders execution (a later group starts after an earlier one ends).
 * exit 0 = the declared outcome was met; 2 = a deliberate selection/usage error that must STAY an error.
 */
export function jobs(P, L) {
  const link = (name, extra = []) => [...extra, `--prov-dir=${P}`, `--json=${path.join(L, `${name}.json`)}`, `--log=${path.join(L, `${name}.log`)}`];
  const out = [];
  const add = (name, script, args, expect, group, { stamp = true } = {}) => out.push({ name, argv: [script, ...args, ...(stamp ? link(name) : [])], expect, group, stamps: stamp });
  // group 1: positives -- identity incl. the six-fixture STREAM_RING=0 comparison and four-screen controls; row 3 on every cell, both emulators
  add('identity-positive', I, [], { exit: 0, log: /all identity cells pass/ }, 1);
  for (const c of ['MMC1-V', 'MMC1-H', 'MMC3-V', 'MMC3-H', 'U512-V', 'U512-H']) add(`oracle-positive-${c}`, O, [`--cell=${c}`, '--emu=both'], { exit: 0, log: /^all pass \(\d+ rows\)$/m }, 1);
  // group 1b: identity sabotage -- every cell's outcome must equal its declared one (ringsabotage.mjs)
  for (const s of ALL_SABOTAGE) add(`identity-${s}`, I, [`--sabotage=${s}`], { exit: 0, log: /(?<![0-9])0 outcomes differ from their declaration, \d+ predeclared-unbuildable cells witnessed, (?<![0-9])0 unexpected build errors/ }, 2);
  // group 2: row-3 controls, both emulators; each row must fail the declared verdict
  const oc = (name, args, verdict) => add(`oracle-${name}`, O, ['--emu=both', ...args, `--expect=${verdict}`], { exit: 0, log: /: (\d+)\/\1 rows fail it, 0 NOT CAUGHT/ }, 3);
  oc('strip-len-30-vertical', ['--ring=1', '--gt=action', '--talkers=enter', '--scenario=lap', '--sabotage=strip-len-30-vertical'], 'vram');
  oc('dest-plus08-vertical', ['--ring=1', '--gt=action', '--talkers=enter', '--scenario=lap', '--sabotage=dest-plus08-vertical'], 'vram');
  oc('render-four-nts-v', ['--ring=1', '--gt=action', '--talkers=enter', '--scenario=lap', '--sabotage=render-four-nts'], 'vram');
  oc('render-four-nts-h', ['--ring=2', '--gt=action', '--talkers=enter', '--scenario=lap', '--sabotage=render-four-nts'], 'vram');
  oc('compacted-cam-nt-h', ['--ring=2', '--gt=action', '--talkers=enter', '--scenario=lap', '--sabotage=compacted-cam-nt-horizontal'], 'vram');
  oc('dlg-attr-offset-n32', ['--gt=action', '--talkers=enter', '--sabotage=dlg-attr-offset-n32'], 'dialogue');
  oc('dlg-attr-nomask', ['--gt=action', '--talkers=enter', '--sabotage=dlg-attr-nomask'], 'dialogue');
  oc('wrong-glyph', ['--gt=action', '--talkers=enter', '--sabotage=wrong-glyph'], 'dialogue');
  oc('instant-text', ['--gt=action', '--talkers=enter', '--sabotage=instant-text'], 'dialogue');
  oc('no-walk-v', ['--ring=1', '--gt=action', '--talkers=enter', '--scenario=lap', '--sabotage=no-walk-v'], 'coverage');
  oc('no-walk-h', ['--ring=2', '--gt=action', '--talkers=enter', '--scenario=lap', '--sabotage=no-walk-h'], 'coverage');
  oc('ring-forced-0-v', ['--ring=1', '--gt=action', '--talkers=enter', '--scenario=lap', '--sabotage=ring-forced-0'], 'vram');
  // a DECLARED non-catch: the wrap fork is dead code in every legal scene (ringidentity.mjs, dead-axis invariant), so row 3 must NOT see it. If a
  // later change makes the wrap reachable this job flips (exit 0, rows caught) and the matrix reports it as unexpected.
  add('oracle-wrap-col-30-static', O, ['--emu=both', '--cell=MMC1-V', '--gt=action', '--talkers=enter', '--scenario=lap', '--sabotage=wrap-col-30', '--expect=any'], { exit: 1, log: /: 0\/\d+ rows fail it, \d+ NOT CAUGHT/ }, 3);
  // round 3: the capacity table (the admitted N per cell x game type x resource, asserted against the committed MAX_N) and the coverage campaign
  add('capacity-table', 'test/lua/ring_gate/ringcapacity.mjs', [], { exit: 0, log: /MAX_N table matches the capacity check \(12 entries\)/ }, 1, { stamp: false });
  for (const c of ['MMC1-V', 'MMC1-H', 'MMC3-V', 'MMC3-H', 'U512-V', 'U512-H']) for (const gt of ['action', 'rpg']) {
    add(`campaign-${c}-${gt}`, CAMP, [`--cell=${c}`, `--gt=${gt}`, '--emu=both'], { exit: 0, log: /^\d+ executed, 0 FAIL, 0 ERROR, \d+ N\/A, 0 unmeasured$/m }, 1);
  }
  // campaign controls: each sabotage is caught by the declared verdict in every row it runs (jsnes + Mesen; a Continue scene is a chain of private-HOME Mesen invocations)
  const cc = (name, args, verdict) => add(`campaign-ctl-${name}`, CAMP, ['--emu=both', ...args, `--expect=${verdict}`], { exit: 0, log: /: (\d+)\/\1 rows fail it, 0 NOT CAUGHT, \d+ N\/A, 0 unexpected errors, 0 unmeasured/ }, 3);
  cc('region-carry-23', ['--cell=MMC1-V', '--gt=action', '--scene=sw-N27', '--sabotage=region-carry-23'], 'vram');
  cc('camhi-mask-7f', ['--cell=MMC1-V', '--gt=action', '--scene=sw-N130', '--sabotage=camhi-mask-7f'], 'vram');
  cc('blk-hi-drop', ['--cell=MMC1-V', '--gt=action', '--scene=sw-N20', '--sabotage=blk-hi-drop'], 'vram');
  cc('pjg-lag-7-v', ['--cell=MMC1-V', '--gt=action', '--scene=redraw-guard', '--sabotage=pjg-lag-7'], 'coverage');
  cc('pjg-lag-7-h', ['--cell=MMC1-H', '--gt=action', '--scene=redraw-guard', '--sabotage=pjg-lag-7'], 'coverage');
  cc('pjg-no-col-local', ['--cell=MMC1-V', '--gt=action', '--scene=redraw-guard', '--sabotage=pjg-no-col-local'], 'vram');
  cc('pjg-no-row-local', ['--cell=MMC1-H', '--gt=action', '--scene=redraw-guard', '--sabotage=pjg-no-row-local'], 'vram');
  cc('warp-four-nts-v', ['--cell=MMC1-V', '--gt=action', '--scene=redraw-warp', '--sabotage=render-four-nts'], 'vram');
  cc('warp-four-nts-h', ['--cell=MMC1-H', '--gt=action', '--scene=redraw-warp', '--sabotage=render-four-nts'], 'vram');
  cc('battle-return-v', ['--cell=MMC1-V', '--gt=rpg', '--scene=redraw-battle', '--placement=resident', '--sabotage=battle-return-no-render'], 'vram');
  cc('battle-return-h', ['--cell=U512-H', '--gt=rpg', '--scene=redraw-battle', '--placement=resident', '--sabotage=battle-return-no-render'], 'vram');
  cc('continue-pos-zero-v', ['--cell=MMC1-V', '--gt=action', '--scene=redraw-continue', '--sabotage=continue-pos-zero'], 'coverage');
  cc('continue-pos-zero-h', ['--cell=MMC1-H', '--gt=action', '--scene=redraw-continue', '--sabotage=continue-pos-zero'], 'coverage');
  cc('shake-no-nt-flip', ['--cell=MMC1-H', '--gt=action', '--scene=shake', '--sabotage=shake-no-nt-flip'], 'coverage');
  cc('shake-nt-eor2', ['--cell=MMC1-H', '--gt=action', '--scene=shake', '--sabotage=shake-nt-eor2'], 'vram');
  cc('dlg-class-attr-nomask', ['--cell=MMC1-V', '--gt=action', '--scene=dlg-r0-p0', '--sabotage=dlg-attr-nomask'], 'vram');
  cc('land-continue-pos-zero-v', ['--cell=MMC1-V', '--gt=action', '--scene=land-s1-y225', '--sabotage=continue-pos-zero'], 'coverage');
  cc('land-continue-pos-zero-h', ['--cell=U512-H', '--gt=action', '--scene=land-s2-y224', '--sabotage=continue-pos-zero'], 'coverage');
  // a requested emulator the registry does not run is an UNMEASURED row and a failing exit, never a silent skip (--registry-emus is the campaign's test hook)
  add('campaign-ctl-unmeasured-row', CAMP, ['--emu=both', '--cell=MMC1-V', '--gt=action', '--scene=redraw-guard', '--registry-emus=jsnes'], { exit: 1, log: /redraw-guard resident mesen\s+UNMEASURED .*withdrew mesen[\s\S]*^1 executed, 0 FAIL, 0 ERROR, 0 N\/A, 1 unmeasured$/m }, 3);
  // DECLARED non-catch: shake-no-nt-flip is a coverage-only fault (the displayed live NT is the same through the mirroring), so the VRAM verdict must NOT see it
  add('campaign-ctl-shake-no-nt-flip-not-vram', CAMP, ['--emu=both', '--cell=MMC1-H', '--gt=action', '--scene=shake', '--sabotage=shake-no-nt-flip', '--expect=vram'], { exit: 1, log: /: 0\/2 rows fail it, 2 NOT CAUGHT/ }, 3);
  // regression guards for the two defects found at 9abc85c while building the scenes (not the ring prototype's) and fixed by 5138c1f: each repro asserts the
  // END state -- battle: eight fresh contacts (slots 0-7, on the streamed and ordinary layouts) and an overlap of slots 2 and 5 that slot 2 wins, each fought out
  // and returned to gameplay; Continue: gameplay at the saved worldX, worldY (in the y > MAX_Y band), cur_map and flat_screen -- declared exit 0. If either defect
  // returns the job flips to exit 1 and the matrix reports it as unexpected.
  out.push({ name: 'repro-battle-slot5', argv: ['test/lua/ring_gate/repro_battle_slot5.mjs', 'streamed'], expect: { exit: 0, log: /^all 8 fights \(slots 0-7\) and the overlap \(slot 2 first, then 5\) each fresh, fought out and returned to gameplay$/m }, group: 3, raw: true, stamps: false });
  out.push({ name: 'repro-battle-slot5-ordinary', argv: ['test/lua/ring_gate/repro_battle_slot5.mjs', 'ordinary'], expect: { exit: 0, log: /^all 8 fights \(slots 0-7\) and the overlap \(slot 2 first, then 5\) each fresh, fought out and returned to gameplay$/m }, group: 3, raw: true, stamps: false });
  out.push({ name: 'repro-continue-y', argv: ['test/lua/ring_gate/repro_continue_y.mjs', '239'], expect: { exit: 0, log: /^continue landed in gameplay at the saved place: worldX \d+ worldY \d+ \(local y \d+ > MAX_Y 224\) cur_map \d+ flat_screen \d+$/m }, group: 3, raw: true, stamps: false });
  // S1b rows 2, 4, 7 (run_s1b.mjs): every cell x game type x reachable dialogue placement. A positive's declared outcome = every item PASS or N/A with a source proof.
  const s1bPass = /^\S+ (action|rpg) (resident|banked): S1b all pass \(\d+ items, \d+ N\/A\)$/m;
  for (const c of CELL_IDS) {
    add(`s1b-${c}-action-resident`, S1B, [`--cell=${c}`, '--gt=action', '--placement=resident'], { exit: 0, log: s1bPass }, 4);
    add(`s1b-${c}-rpg-resident`, S1B, [`--cell=${c}`, '--gt=rpg', '--placement=resident'], { exit: 0, log: s1bPass }, 4);
    add(`s1b-${c}-rpg-banked`, S1B, [`--cell=${c}`, '--gt=rpg', '--placement=banked'], { exit: 0, log: s1bPass }, 4);
    // action banked: N/A, PROVED by the real capacity check refusing the bulk text that would force the overlay out of the resident kernel-hi
    add(`s1b-${c}-action-banked-na`, S1B, [`--cell=${c}`, '--gt=action', '--placement=banked'], { exit: 0, log: /action banked  N\/A  an action project cannot place the dialogue overlay/ }, 4, { stamp: false });
  }
  // the full-system padding mutation: padded past the gate it must FAIL the G gate (CAUGHT), the matching under-gate pad must pass
  for (const c of PAD_CELLS) {
    add(`s1b-pad-over-${c}`, S1B, [`--cell=${c}`, '--gt=action', '--sabotage=pad-mainline-over', '--expect=gate-fail'], { exit: 0, log: /sabotage pad-mainline-over \(expect gate-fail\): CAUGHT/ }, 5);
    add(`s1b-pad-under-${c}`, S1B, [`--cell=${c}`, '--gt=action', '--sabotage=pad-mainline-under', '--expect=bound-fail'], { exit: 0, log: /CAUGHT: sampled estimate refusal -- the measured gate passed and the class estimate alone refused/ }, 5);
  }
  // the S1 test 3b control: a classifier that drops the Move body (frozen-state filter) must fail the class, reads and seam rules
  add('s1b-fault-freeze-drops-move-MMC1-H', S1B, ['--cell=MMC1-H', '--gt=action', '--fault=freeze-drops-move', '--expect=fail'], { exit: 0, log: /fault freeze-drops-move \(expect fail\): CAUGHT/ }, 5);
  add('s1b-fault-freeze-drops-move-U512-V-rpg', S1B, ['--cell=U512-V', '--gt=rpg', '--fault=freeze-drops-move', '--expect=fail'], { exit: 0, log: /fault freeze-drops-move \(expect fail\): CAUGHT/ }, 5);
  // round 2, finding 4: a deliberately wrong executed-path counter hook must fail the transaction arithmetic / the required evidence (per mapper for the mapper-write range)
  const cf = (name, cell, fault) => add(`s1b-fault-${name}-${cell}`, S1B, [`--cell=${cell}`, '--gt=action', '--specs=walk,mv-say', `--fault=${fault}`, '--expect=fail'], { exit: 0, log: new RegExp(`fault ${fault} \\(expect fail\\): CAUGHT: the transaction arithmetic`) }, 5);
  cf('loc-half', 'MMC1-V', 'counter-loc-half'); cf('price-addr', 'MMC3-V', 'counter-price-addr'); cf('dead', 'U512-H', 'counter-dead');
  for (const c of ['MMC1-V', 'MMC3-H', 'U512-V']) cf('mwm-range', c, 'counter-mwm-range');
  // round 2, finding 5: the seam sabotages -- a stale Move scroll and a strip read from the wrong source column -- must each fail a seam item on the distinguishable-terrain specs, on every cell
  for (const c of CELL_IDS) for (const sb of ['move-scroll-stale', 'strip-src-eor1']) add(`s1b-seam-${sb}-${c}`, S1B, [`--cell=${c}`, '--gt=action', '--specs=seam-walk,seam-move', '--emu=jsnes', `--sabotage=${sb}`, '--expect=seam-fail'], { exit: 0, log: new RegExp(`sabotage ${sb} \\(expect seam-fail\\): CAUGHT: a seam item failed`) }, 5);
  // selection errors of the new runner stay errors
  add('selection-s1b-misspelled-cell', S1B, ['--cell=MMCl-V'], { exit: 2, log: /is not one of/ }, 3, { stamp: false });
  add('selection-s1b-undeclared-sabotage', S1B, ['--cell=MMC1-V', '--sabotage=no-such-patch'], { exit: 2, log: /not a declared sabotage/ }, 3, { stamp: false });
  add('selection-s1b-unknown-argument', S1B, ['--bogus=1'], { exit: 2, log: /unknown argument/ }, 3, { stamp: false });
  // the harness's own tests: judge/record/provenance/matrix controls
  const test = (name, file) => out.push({ name, argv: ['--test', file], expect: { exit: 0, log: /^# fail 0$/m }, group: 3, raw: true, stamps: false });
  test('judge-unit', 'test/lua/ring_gate/judge_unit.mjs');
  test('record-controls', 'test/lua/ring_gate/record_controls.mjs');
  test('prov-unit', 'test/lua/ring_gate/prov_unit.mjs');
  test('s1b-unit', 'test/lua/ring_gate/s1b_unit.mjs');
  test('iso-unit', 'test/lua/ring_gate/iso_unit.mjs');
  // the builder-identity proof (flag-absent output of the two G-gate builders equals the pre-flag snapshot) and the report tables are certificate evidence: executed by the matrix, so fingerprinted
  out.push({ name: 's1b-noflag', argv: ['test/lua/ring_gate/s1b_noflag.mjs', 'check', 'handoff-next/s1b-noflag-before.json'], expect: { exit: 0, log: /no-flag output byte-identical/ }, group: 3, raw: true, stamps: false });
  out.push({ name: 's1b-tables', argv: ['test/lua/ring_gate/s1b_tables.mjs', L], expect: { exit: 0, log: /^## Verdicts per cell/m }, group: 6, raw: true, stamps: false });
  out.push({ name: 's1b-coverage', argv: ['test/lua/ring_gate/s1b_coverage.mjs', L], expect: { exit: 0, log: /^# S1b round 3: coverage, agreement, class estimate and seam evidence/m }, group: 6, raw: true, stamps: false });
  // deliberate selection / usage errors: each must STAY an error (exit 2), never become "all pass"
  add('selection-misspelled-cell', O, ['--cell=MMCl-V', '--emu=jsnes'], { exit: 2, log: /names nothing valid/ }, 3, { stamp: false });
  add('selection-unknown-argument', O, ['--bogus=1'], { exit: 2, log: /unknown argument/ }, 3, { stamp: false });
  add('selection-undeclared-sabotage', O, ['--sabotage=no-such-patch', '--cell=MMC1-V'], { exit: 2, log: /not a declared sabotage/ }, 3, { stamp: false });
  add('selection-identity-bad-ring', I, ['--ring=3'], { exit: 2, log: /is not 1\|2/ }, 3, { stamp: false });
  return out;
}

/** The repo-relative script files the job list executes (argv[0], or the file after `--test`), each once, in first-use order. */
export function matrixScripts(list = jobs('/p', '/l')) {
  const out = [];
  for (const j of list) { const f = j.argv[0] === '--test' ? j.argv[1] : j.argv[0]; if (!out.includes(f)) out.push(f); }
  return out;
}
