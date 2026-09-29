// Engine source reader for the sabotage tests that mutate the streamed-world dialogue overlay.
//
// Phase 2 slice 10b moved that overlay out of engine/streamworld.asm into engine/streamdialog.asm
// (one source, assembled in kernel-hi or in the battle bank -- see the latter's header). A mutant
// is still a scratch COPY of streamworld.asm handed in as a project.code override, and every
// mutant test built its needle against the RESIDENT placement's text, so this returns exactly that
// text: the one `.include "streamdialog.asm"` line expanded in place, then every
// `.if SW_DLG_BANKED` / `.if !SW_DLG_BANKED` conditional resolved for SW_DLG_BANKED = 0 (the
// conditional lines themselves removed, the banked-only bytes dropped). What is left is the
// overlay as it read before the relocation slice, so each needle stays unique and means what it
// always meant; the result is a valid streamworld.asm on its own -- the stock streamdialog.asm is
// still copied into the build, it is simply never included, and the generated flag is 0 in those
// builds. test/unit/streamworlddialoguebanked.test.js pins the flattening against the pre-slice
// text (59d4468) so this helper cannot silently drift from what it claims to produce.
import fs from 'node:fs';

const INCLUDE = '  .include "streamdialog.asm"\n';

/** Resolves every SW_DLG_BANKED conditional for the resident placement (flag = 0). */
export function resolveResidentPlacement(text) {
  const out = [];
  // Each frame: {own: true when this .if is an SW_DLG_BANKED one, keep: whether the current arm
  // is emitted}. A frame nested under a dropped arm is dropped whatever its own arm says.
  const stack = [];
  const live = () => stack.every((f) => f.keep);
  for (const line of text.split('\n')) {
    const t = line.trim();
    const m = /^\.if\s+(!?)SW_DLG_BANKED\b/.exec(t);
    if (m) {
      stack.push({ own: true, keep: m[1] === '!' });
      continue;
    }
    if (/^\.if\b/.test(t)) {
      stack.push({ own: false, keep: true });
      if (live()) out.push(line);
      continue;
    }
    if (/^\.else\b/.test(t)) {
      const top = stack[stack.length - 1];
      if (top?.own) {
        top.keep = !top.keep;
        continue;
      }
      if (live()) out.push(line);
      continue;
    }
    if (/^\.endif\b/.test(t)) {
      const top = stack.pop();
      if (!top) throw new Error('unbalanced .endif in engine source');
      if (!top.own && live()) out.push(line);
      continue;
    }
    if (live()) out.push(line);
  }
  if (stack.length) throw new Error('unbalanced .if in engine source');
  return out.join('\n');
}

export function readEngineSource(name) {
  const text = fs.readFileSync(new URL(`../../engine/${name}`, import.meta.url), 'utf8');
  if (name !== 'streamworld.asm') return text;
  if (text.split(INCLUDE).length !== 2) {
    throw new Error('engine/streamworld.asm must contain the streamdialog.asm include line exactly once');
  }
  const overlay = fs.readFileSync(new URL('../../engine/streamdialog.asm', import.meta.url), 'utf8');
  return resolveResidentPlacement(text.replace(INCLUDE, overlay.endsWith('\n') ? overlay : `${overlay}\n`));
}
