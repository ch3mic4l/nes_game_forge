// A fingerprint of the engine's 6502 source, comments and blank lines removed, so that an evidence file
// recorded against one engine can tell it is being read against another. Used by
// test/lua/sw_bound_sweep.mjs (records it) and test/unit/streamtilebound.test.js (checks it).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function engineFingerprint(root) {
  const dir = path.join(root, 'engine');
  const files = fs.readdirSync(dir).filter((n) => n.endsWith('.asm')).sort();
  const h = crypto.createHash('sha256');
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const code = text.split('\n').map((l) => l.replace(/;.*$/, '').replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
    h.update(f + '\n' + code + '\n');
  }
  return { files: files.length, sha256: h.digest('hex') };
}
