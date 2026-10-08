#!/usr/bin/env node
// S1c parts A and B: the two deadline builders (build_sw_nmi_roms.mjs, build_sw_close_deadline_roms.mjs) gained a `--ring=<cell>` flag. With the flag ABSENT each must
// produce byte-identical output to what it produced before: this records, then checks, the SHA-256 of every artifact (the ROM and the RENDERED Lua script) of every
// no-flag configuration the two run scripts use (both parities x the two breaks and none; both placements x the two breaks and none).
//   node test/lua/ring_gate/s1c_noflag.mjs record <file.json>   (taken from the tree BEFORE the flags were added: handoff-next/s1c-noflag-before.json)
//   node test/lua/ring_gate/s1c_noflag.mjs check <file.json>    exit 0 = every artifact equals the recorded hash, 1 = a difference, 2 = usage
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LUA = path.resolve(HERE, '..');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

export const CONFIGS = [
  ...['even', 'odd'].flatMap((parity) => ['', 'chunk4', 'mixed3'].map((brk) => ({ id: `nmi-${parity}${brk ? `-${brk}` : ''}`, script: 'build_sw_nmi_roms.mjs', args: [`--parity=${parity}`, ...(brk ? [`--break=${brk}`] : [])], files: ['sw_nmi.nes', 'sw_nmi_deadline.lua'] }))),
  ...['resident', 'banked'].flatMap((pl) => ['', 'no-flash', 'slow-drain'].map((brk) => ({ id: `close-${pl}${brk ? `-${brk}` : ''}`, script: 'build_sw_close_deadline_roms.mjs', args: [`--placement=${pl}`, ...(brk ? [`--break=${brk}`] : [])], files: ['sw_close_deadline.nes', 'sw_close_deadline.lua'] })))
];

function artifacts(cfg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-noflag-c-'));
  try {
    execFileSync('node', [path.join(LUA, cfg.script), dir, ...cfg.args], { stdio: 'pipe' });
    return Object.fromEntries(cfg.files.map((f) => [f, sha(fs.readFileSync(path.join(dir, f)))]));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const [mode, file] = process.argv.slice(2);
if (!['record', 'check'].includes(mode) || !file) { console.error('usage: s1c_noflag.mjs record|check <file.json>'); process.exit(2); }
const now = {};
for (const c of CONFIGS) { now[c.id] = artifacts(c); console.log(`${c.id.padEnd(26)} ${Object.entries(now[c.id]).map(([f, h]) => `${f} ${h.slice(0, 12)}`).join('  ')}`); }
if (mode === 'record') { fs.writeFileSync(file, JSON.stringify(now, null, 1)); console.log(`recorded ${CONFIGS.length} configurations to ${file}`); process.exit(0); }
const before = JSON.parse(fs.readFileSync(file, 'utf8'));
let diffs = 0;
for (const c of CONFIGS) for (const k of c.files) if (before[c.id]?.[k] !== now[c.id][k]) { diffs++; console.log(`DIFF ${c.id} ${k}: ${before[c.id]?.[k]} -> ${now[c.id][k]}`); }
console.log(diffs ? `${diffs} artifact(s) differ from the recorded no-flag output` : `no-flag output byte-identical to ${file} (${CONFIGS.length} configurations x 2 artifacts)`);
process.exit(diffs ? 1 : 0);
