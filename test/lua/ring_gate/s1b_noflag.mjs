#!/usr/bin/env node
// S1b part C: the two G-gate builders (sw_manifest_scene.mjs / run_sw_manifest.mjs and run_sw_move_manifest.mjs) gained ring selection flags. With the flag
// ABSENT each must produce byte-identical output to what it produced before: this records, then checks, the SHA-256 of every artifact a set of no-flag
// configurations emits (the scene ROM, the symbol file, the RENDERED Lua script, the normalized project).
//   node test/lua/ring_gate/s1b_noflag.mjs record <file.json>     (taken from the tree BEFORE the flags were added: handoff-next/s1b-noflag-before.json)
//   node test/lua/ring_gate/s1b_noflag.mjs check <file.json>      exit 0 = every artifact equals the recorded hash, 1 = a difference, 2 = usage
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LUA = path.resolve(HERE, '..');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const { runManifest, SCENARIOS } = await import(path.join(LUA, 'run_sw_manifest.mjs'));
const { measureMove } = await import(path.join(LUA, 'run_sw_move_manifest.mjs'));

export const CONFIGS = [
  { id: 'manifest-action-walk', kind: 'manifest', opts: { gt: 'action', sizes: [2, 2, 2, 2, 2, 2, 2, 2], scenario: 'walk' } },
  { id: 'manifest-action-walk-wide', kind: 'manifest', opts: { gt: 'action', sizes: [2, 2, 2, 2, 2, 2, 2, 2], wide: true, scenario: 'walk' } },
  { id: 'manifest-rpg-walk', kind: 'manifest', opts: { gt: 'rpg', sizes: [2, 2, 2, 2, 2, 2, 2, 2], scenario: 'walk' } },
  { id: 'manifest-action-say', kind: 'manifest', opts: { gt: 'action', sizes: [1, 1, 1, 1, 1, 1, 1, 8], scenario: 'say' } },
  { id: 'manifest-action-stand', kind: 'manifest', opts: { gt: 'action', sizes: [2, 2, 2, 2, 2, 2, 2, 2], scenario: 'stand' } },
  { id: 'manifest-rpg-name', kind: 'manifest', opts: { gt: 'rpg', sizes: [2, 2, 2, 2, 2, 2, 2, 2], scenario: 'name' } },
  { id: 'manifest-action-ord', kind: 'manifest', opts: { gt: 'action', sizes: [2, 2, 2, 2, 2, 2, 2, 2], scenario: 'ord', gridH: 40 } },
  { id: 'manifest-action-nosizes', kind: 'manifest', opts: { gt: 'action', scenario: 'walk' } },
  { id: 'move-action-say-say', kind: 'move', opts: { gt: 'action', tail: 'say', lead: 'say', dist: 150 } },
  { id: 'move-rpg-flash-flash', kind: 'move', opts: { gt: 'rpg', tail: 'flash', lead: 'flash', dist: 90, pop: 'few-large-3' } },
  { id: 'move-action-bound', kind: 'move', opts: { gt: 'action', tail: 'switch', dist: 60, bound: true, tiles: 14 } }
];

async function artifacts(cfg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-noflag-'));
  try {
    let res;
    if (cfg.kind === 'manifest') res = await runManifest({ ...cfg.opts, outDir: dir, prepareOnly: true });
    else ({ res } = await measureMove({ ...cfg.opts, outDir: dir, prepareOnly: true }));
    const out = { project: res.prov.project, rom: res.prov.rom };
    for (const f of ['scene.nes', 'symbols.json', 'manifest.lua']) out[f] = sha(fs.readFileSync(path.join(dir, f)));
    return out;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const [mode, file] = process.argv.slice(2);
if (!['record', 'check'].includes(mode) || !file) { console.error('usage: s1b_noflag.mjs record|check <file.json>'); process.exit(2); }
const now = {};
for (const c of CONFIGS) { now[c.id] = await artifacts(c); console.log(`${c.id.padEnd(30)} rom ${now[c.id].rom.slice(0, 12)} lua ${now[c.id]['manifest.lua'].slice(0, 12)}`); }
if (mode === 'record') { fs.writeFileSync(file, JSON.stringify(now, null, 1)); console.log(`recorded ${CONFIGS.length} configurations to ${file}`); process.exit(0); }
const before = JSON.parse(fs.readFileSync(file, 'utf8'));
let diffs = 0;
for (const c of CONFIGS) for (const k of Object.keys(before[c.id] ?? { missing: 1 })) if (before[c.id]?.[k] !== now[c.id][k]) { diffs++; console.log(`DIFF ${c.id} ${k}: ${before[c.id]?.[k]} -> ${now[c.id][k]}`); }
console.log(diffs ? `${diffs} artifact(s) differ from the recorded no-flag output` : `no-flag output byte-identical to ${file} (${CONFIGS.length} configurations x 5 artifacts)`);
process.exit(diffs ? 1 : 0);
