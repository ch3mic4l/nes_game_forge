// The ONE rebuild worker of the ROM-identity and harness-transfer certifiers (test/lua/sw_identity_cert.mjs, test/lua/sw_harness_transfer.mjs).
//
// It takes the harness from `--harness-root=<tree>`: sw_bound_sweep.mjs (manifestArgs), run_sw_manifest.mjs, sw_manifest_scene.mjs and sw_provenance.mjs are
// imported FROM THAT TREE, so the template, the runner, the scene builder, the mutator and the provenance code that execute are that tree's own (the runner
// reads its template relative to its own module and the scene builder imports its helpers relatively; a `root` argument selects build inputs only). A record
// is rebuilt through that tree's own `manifestArgs`, the sweep's single job-to-arguments function (scenario phases, trace suppression, idle, animation,
// mutation, gridH, the R contact endpoint), never through a hand-copied recipe.
//
//   --mode=prepare   build the scene and render the script, no Mesen: answers {id, prov, lua, romFile, sym, cacheKey, cnev}
//   --mode=measure   run Mesen: answers {id, measurement}
// Protocol: {ready}, then one answer (or {id, error}) per job sent; 'exit' ends it.
//
// Test-only sabotage (TRANSFER_SABOTAGE or CERT_SABOTAGE; TRANSFER_SABOTAGE_SIDE=old|new|current restricts it to one side; fires on worker 0's first job):
//   kill-worker | flip-rom-byte | drift-binding (script digest changes) | sym-address (a symbol address rewritten in the rendered `local SYM` line, its
//   digests recomputed) | sym-only (only the reported symbol-line digest changes) | recipe (the effective recipe changes: flashAt y + 1) | no-endpoint (the recipe drops the R contact endpoint, the defect review F1 found in the old hand-copied recipe)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const arg = (n, d) => { const a = process.argv.find((s) => s.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const harnessRoot = path.resolve(arg('harness-root', ''));
const mode = arg('mode', 'prepare');
const side = arg('side', 'current');
const index = Number(arg('index', '0'));
const mesen = arg('mesen', null);
const expectHarness = arg('expect-harness', null);
const sabotage = (process.env.TRANSFER_SABOTAGE || process.env.CERT_SABOTAGE || null);
const sabotageHere = sabotage && (!process.env.TRANSFER_SABOTAGE_SIDE || process.env.TRANSFER_SABOTAGE_SIDE === side) && index === 0;
const base = process.env.TMPDIR || os.tmpdir();
let count = 0;

const fromHarness = (n) => import(pathToFileURL(path.join(harnessRoot, 'test/lua', n)).href);
const [sweep, runner, scene, prov] = await Promise.all(['sw_bound_sweep.mjs', 'run_sw_manifest.mjs', 'sw_manifest_scene.mjs', 'sw_provenance.mjs'].map(fromHarness));
// the executing harness is the one asked for: its scene module lives in the tree, and its own hash is the expected one
if (fs.realpathSync(scene.REPO) !== fs.realpathSync(harnessRoot)) { console.error(`worker: the imported harness lives in ${scene.REPO}, not ${harnessRoot}`); process.exit(3); }
const harnessNow = prov.harnessHash(harnessRoot);
if (expectHarness && harnessNow !== expectHarness) { console.error(`worker: harness ${harnessNow.slice(0, 12)} is not the expected ${expectHarness.slice(0, 12)}`); process.exit(3); }

// a rendered script must not print a CN or EV line (run_sw_manifest.mjs parseOutput's two newer branches): the old parser has no such branch
const CNEV = /["'](?:CN|EV) /;

async function prepareOne(rec) {
  const dir = await fs.promises.mkdtemp(path.join(base, 'xfer-'));
  try {
    const args = sweep.manifestArgs(rec, { prepareOnly: true, waitInflight: true, ...(mesen ? { mesen } : {}), tweak: (a) => {
      const out = { ...a, outDir: dir };
      if (sabotageHere && count === 1 && sabotage === 'recipe' && out.flashAt) out.flashAt = [out.flashAt[0], out.flashAt[1] + 1];
      if (sabotageHere && count === 1 && sabotage === 'no-endpoint') delete out.contactEndpoint;
      return out;
    } });
    const r = await runner.runManifest(args);
    const romPath = path.join(dir, 'scene.nes');
    if (sabotageHere && count === 1 && sabotage === 'flip-rom-byte') { const b = fs.readFileSync(romPath); b[b.length >> 1] ^= 1; fs.writeFileSync(romPath, b); }
    let luaText = fs.readFileSync(path.join(dir, 'manifest.lua'), 'utf8');
    const symMatch = /^local SYM = .*$/m.exec(luaText);
    if (!symMatch || symMatch[0].length < 20) throw new Error('the rendered script has no (or an empty) `local SYM` line');
    if (sabotageHere && count === 1 && sabotage === 'sym-address') luaText = luaText.replace(/^(local SYM = .*?)(\d+)/m, (_, a, n) => `${a}${Number(n) + 1}`);
    let lua = sha(luaText);
    if (sabotageHere && count === 1 && sabotage === 'drift-binding') lua = sha(luaText + '\n-- a rebound symbol');
    const symLine = /^local SYM = .*$/m.exec(luaText)[0];
    let sym = sha(symLine);
    if (sabotageHere && count === 1 && sabotage === 'sym-only') sym = sha(symLine + ' ');
    return { id: rec.id, prov: r.prov, lua, romFile: sha(fs.readFileSync(romPath)), sym, cacheKey: r.cacheKey, cnev: CNEV.test(luaText) ? 1 : 0 };
  } finally { await fs.promises.rm(dir, { recursive: true, force: true }); }
}

async function measureOne(rec) {
  const args = sweep.manifestArgs(rec, { prepareOnly: false, waitInflight: true, ...(mesen ? { mesen } : {}) });
  const r = await runner.runManifest(args);
  const { symbols, stderr, ...rest } = r;
  // the full parsed measurement, with the symbol tables reduced to a digest; `extra` is every key the old parser could not have produced
  return { id: rec.id, result: { ...rest, symbols: sha(JSON.stringify(symbols ?? null)), keys: Object.keys(r).sort() } };
}

process.on('message', async (rec) => {
  if (rec === 'exit') process.exit(0);
  count++;
  if (sabotageHere && count === 1 && sabotage === 'kill-worker') process.kill(process.pid, 'SIGKILL');
  try { process.send(mode === 'measure' ? await measureOne(rec) : await prepareOne(rec)); } catch (e) { process.send({ id: rec.id, error: String(e?.message ?? e).slice(0, 400) }); }
});
process.send({ ready: true, harnessRoot, harness: harnessNow });
