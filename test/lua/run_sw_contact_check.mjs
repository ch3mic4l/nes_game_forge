// The R-stage CONTACT ENDPOINT of the sweep harness, in real Mesen (the Mesen-free half is test/unit/sweepharness.test.js).
//
//   node test/lua/run_sw_contact_check.mjs [--mesen=<path>] [--json]
//
// Background: the RPG walk of stage R ends in a contact battle, but phases advance on emulator frames and the script prints DONE whatever the mainline is
// doing, so a mainline hung inside the contact body (the slot-5 battle_begin bug: touch_encounter cleared pc_status with X and left it at MAX_PARTY, so the
// entity pass rescanned slots 5-7 and re-began the same fight for ever) still produced 177 completed bodies and a clean DONE. The harness now ends an R run
// at the completed contact body (run_sw_manifest.mjs CONTACT_IDLE_REG) and refuses an R run that never gets there. Three assertions, on two rows of the R
// plan (the front row and the first `s7.7.1.1.0.0.0.0` row):
//   completed   the run prints the CONTACT marker in walkD; the last measured body IS the contact body (its frame is the marker's, and the phase counted every
//               body); it ran past battle_begin AND main_loop_ready, so its G is the whole body, tail included (stopping at battle_begin, at main_loop_ready or at
//               a frame boundary inside the body would have measured less)
//   hung        the front row rebuilt with the OLD engine's two lines (a Code Forge override of entities.asm without the first-fight-wins test and of rpg.asm
//               with battle_begin clearing pc_status with X), in a mkdtemp: runJob refuses it ("not reached"), and the same build run WITHOUT the endpoint (stage A:
//               the old harness) finishes status 0 / DONE with exactly one body fewer than the completed run -- the evidence the old harness blessed
//   (the endpoint is R-only and a non-R rendered script is byte-identical to the pre-change one: sweepharness.test.js)
// Exit: 0 every assertion held, 1 one did not, 2 harness error. Mesen processes: one at a time (assertRoom 1).
import path from 'node:path';
import fs from 'node:fs';
import { plan, manifestArgs, runJob, isBad } from './sw_bound_sweep.mjs';
import { runManifest, MESEN_DEFAULT } from './run_sw_manifest.mjs';
import { REPO } from './sw_manifest_scene.mjs';
import { parseFlags, assertRoom, countMesen } from './sw_move_policy.mjs';

const MARKS = ['battle_begin', 'main_loop_ready'];
const ROWS = {
  front: 'rpg-tight-P0-n16-k0-front-y234-s9.1.1.1.1.1.1.1',
  high: 'rpg-tight-P0-n16-k0-part-y234-s7.7.1.1.0.0.0.0'
};

// each entry: [file, the FIXED text, the OLD text]. A fixed text that is no longer there is a harness error, never a silent no-op.
const OLD_ENGINE = [
  ['entities.asm', '  .if BATTLE_ENABLED\n  lda <game_state\n  bne update_entities_done\n  .endif\n  lda ent_hurt,x', '  lda ent_hurt,x'],
  ['rpg.asm', '  ldy #0\nbattle_begin_status:\n  sta pc_status,y\n  iny\n  cpy #MAX_PARTY', '  ldx #0\nbattle_begin_status:\n  sta pc_status,x\n  inx\n  cpx #MAX_PARTY'],
  ['rpg.asm', '  tay\n  lda ent_record,y\n  sta <bt_owner_rec', '  tax\n  lda ent_record,x\n  sta <bt_owner_rec']
];
const codeOverrides = () => {
  const text = {};
  for (const [file, fixed, old] of OLD_ENGINE) {
    text[file] ??= fs.readFileSync(path.join(REPO, 'engine', file), 'utf8');
    if (text[file].split(fixed).length !== 2) throw new Error(`engine/${file} no longer carries the fixed text this check reverts: ${JSON.stringify(fixed.slice(0, 50))}`);
    text[file] = text[file].replace(fixed, old);
  }
  return Object.entries(text).map(([name, t]) => ({ name, text: t }));
};
// the tweak hook of manifestArgs: every collected body prints an MK line; `hang` re-creates the pre-fix engine as a Code Forge override
const tweakFor = (hang) => (args) => {
  for (const p of args.phases) if (p.collect) p.marks = true;
  const base = args.mutate;
  return { ...args, marks: MARKS, mutate: hang ? (project, shared) => { const r = base(project, shared); project.code = { overrides: codeOverrides(), files: [] }; return r; } : base };
};
const gOf = (mk) => Number(/G=(\d+)/.exec(mk.line)[1]);
const offsetOf = (mk, name) => { const m = new RegExp(`${name}@(\\d+)`).exec(mk.line); return m ? Number(m[1]) : null; };

const results = [];
const check = (label, ok, detail) => { results.push({ label, ok: !!ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  [${detail}]` : ''}`); };

async function main() {
  const a = parseFlags(process.argv.slice(2), { mesen: 'value' });
  const mesen = a.mesen ?? MESEN_DEFAULT;
  assertRoom(1, countMesen());
  const jobs = plan('R');
  const job = (id) => jobs.find((j) => j.id === id) ?? (() => { throw new Error(`${id} is not in plan('R')`); })();
  const run = (j, hang) => runManifest({ ...manifestArgs(j, { tweak: tweakFor(hang) }), mesen });
  const completed = {};
  for (const [name, id] of Object.entries(ROWS)) {
    const m = await run(job(id), false);
    const mk = m.marks.walkD ?? [];
    const last = mk.at(-1);
    check(`${name}: the CONTACT marker is printed, in walkD`, m.contact?.phase === 'walkD', JSON.stringify(m.contact));
    check(`${name}: the last measured body is the contact body (every body counted, the marker's frame)`, last && mk.length === m.phases.walkD.n && last.f === m.contact?.frame, `${mk.length} MK, n ${m.phases.walkD.n}, last f ${last?.f}`);
    const begin = last && offsetOf(last, 'battle_begin');
    const ready = last && offsetOf(last, 'main_loop_ready');
    check(`${name}: the contact body began the battle AND reached main_loop_ready, and G is the whole body (G > both)`, begin !== null && ready !== null && gOf(last) > begin && gOf(last) > ready, `battle_begin@${begin} main_loop_ready@${ready} G=${last && gOf(last)}`);
    check(`${name}: nothing after the contact body was measured (the phase ends with it)`, last && m.contact && m.frames <= m.contact.frame + 1, `frames ${m.frames}, contact frame ${m.contact?.frame}`);
    completed[name] = { n: m.phases.walkD.n, maxG: m.phases.walkD.maxG, gateFail: m.phases.walkD.gateFail, contactG: last && gOf(last) };
    console.log(`     ${name}: ${JSON.stringify(completed[name])}`);
  }
  // the hung run: the pre-fix engine, same row
  const front = job(ROWS.front);
  let refused = null;
  try { await run(front, true); } catch (e) { refused = String(e.message ?? e); }
  check('hung: the pre-fix engine with the R endpoint is REFUSED (contact endpoint not reached)', refused && /contact endpoint was not reached/.test(refused), refused?.slice(0, 160));
  const err = await runJob(front, { mesen, tweak: tweakFor(true) }).catch((e) => ({ ...front, error: String(e).slice(0, 300) }));
  check('hung: through runJob the refusal is an error record, which isBad rejects', err.error && isBad(err));
  const old = await run({ ...front, stage: 'A' }, true);
  check('hung: the same build WITHOUT the endpoint (the old harness) finishes, status 0 and DONE, no CONTACT marker', old.done && old.status === 0 && !old.timeout && !old.contact, `status ${old.status}, done ${old.done}`);
  check('hung: and it measured exactly one body fewer than the completed run (the contact body never completed)', old.phases.walkD.n === completed.front.n - 1, `${old.phases.walkD.n} vs ${completed.front.n}`);
  const bad = results.filter((r) => !r.ok).length;
  console.log(`${results.length - bad}/${results.length} checks held`);
  return bad ? 1 : 0;
}

process.exit(await main().catch((e) => { console.error(e); return 2; }));
