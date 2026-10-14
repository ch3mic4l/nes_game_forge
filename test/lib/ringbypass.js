// A TEST-ONLY way to build a two-nametable streamed project (phase 3b S2).
//
// validateProject still refuses a two-nametable streamed map for every game type that is not admitted yet (since S4a / S4b / S4c: MMC3, MMC1 and UNROM 512 action are
// admitted; any streamed RPG on a two-nametable board is refused until S5). A test
// that needs one of those still refused builds, or the ring gate's scenes, go through a COPY of the product in which that refusal is neutralized: engine/ main/ shared/ and package.json are copied to a
// mkdtemp directory, `shared/project.js` has the capability branch's condition replaced (asserted to match exactly once, so a refactor
// of the refusal fails loudly instead of silently building nothing), and the copy's own buildProject is imported. There is no flag in the
// shipped code: the real tree is never touched, and a build through the real tree still refuses.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REFUSAL = '} else if (!streamCapableFourScreen(mapper, mirroringId)) {';
const NEUTRALIZED = '} else if (false) {';

/**
 * The sabotages of phase 3b S2 (handoff-next/s2-c2/sabotage.log): each is a set of exact-once edits to the COPY that breaks one piece of the
 * vertical ring on purpose. FORGE_RING_SABOTAGE=<name> makes every makeBypassTree() in the process apply it, so any ring test run under that
 * variable must fail somewhere (test/lua/run_ring_sabotage.mjs runs them). The shipped tree is never edited.
 */
export const RING_SABOTAGES = {
  'strip-len-30': { note: 'the column strip keeps its 30-block, two-screen length (and wrap)', edits: [
    { file: 'main/build/generate.js', from: '`SW_RING_COL_LEN = ${ringMode === 1 ? 15 : 30}`', to: '`SW_RING_COL_LEN = 30`' }] },
  'strip-load-30': { note: 'only the strip builder\'s st_len load keeps 30 (compare and wrap are 15)', edits: [
    { file: 'engine/streamworld.asm', from: 'sw_ring_col_len:\n  lda #SW_RING_COL_LEN', to: 'sw_ring_col_len:\n  lda #30' }] },
  'wrap-skipped': { note: 'sw_nmi_stream never wraps st_vary at the ring length', edits: [
    { file: 'engine/streamworld.asm', from: 'sw_ring_wrap_col:\n  cmp #SW_RING_COL_LEN', to: 'sw_ring_wrap_col:\n  cmp #$FF' }] },
  'render-4-nts': { note: 'sw_render_window enumerates all four nametable indices', edits: [
    { file: 'main/build/generate.js', from: '`SW_RW_NT_END = ${ringMode === 1 ? 2 : 4}`', to: '`SW_RW_NT_END = 4`' }] },
  'render-step-2': { note: 'sw_render_window steps the index by 2 (the horizontal ring\'s sequence): nametable 1 is never drawn', edits: [
    { file: 'main/build/generate.js', from: '`SW_RW_NT_STEP = ${ringMode === 2 ? 2 : 1}`', to: '`SW_RW_NT_STEP = 2`' }] },
  'shadow-n32': { note: 'sw_render_window stores the attribute shadow at n*32 instead of n*64', edits: [
    { file: 'engine/streamworld.asm', from: '  lda sw_rw_nt\n  asl a\n  asl a\n  asl a\n  asl a\n  asl a\n  asl a\n  sta <sw_rw_shadow_lo', to: '  lda sw_rw_nt\n  asl a\n  asl a\n  asl a\n  asl a\n  asl a\n  sta <sw_rw_shadow_lo' }] },
  'attr-hi-3-omitted': { note: 'the dialogue attribute address forgets the +3 that moves the nametable hi byte to its attribute table', edits: [
    { file: 'engine/streamdialog.asm', from: '  lda sw_rw_nt_hi,x\n  clc\n  adc #3\n  pha', to: '  lda sw_rw_nt_hi,x\n  pha' }] },
  'cam-nt-compacted': { note: 'cam_nt carries the X parity in bit 1 (a compacted {0,2} index instead of the parity index {0,1})', edits: [
    { file: 'engine/streamworld.asm', from: '  and #1\n  asl a\n  ora sw_tmp\n  sta <cam_nt\n  dec <cam_dirty', to: '  lda sw_tmp\n  asl a\n  sta <cam_nt\n  dec <cam_dirty' }] },
  'torus-leak': { note: 'the fork leaks into a four-screen build: the torus column compare reads 29 (only a STREAM_RING = 0 byte-identity test can see it)', edits: [
    { file: 'engine/streamworld.asm', from: '  .else\n  cmp #30\n  .endif\n  bne sw_ssc_loop', to: '  .else\n  cmp #29\n  .endif\n  bne sw_ssc_loop' }] },
  // ---- phase 3b S3 (C1): the horizontal ring. `side: 'h'` = caught by the horizontal files (test/lua/run_ring_sabotage.mjs runs those). ----
  'h-far-branch-omitted': { side: 'h', note: 'engine/player.asm keeps the plain beq cross_none the horizontal build cannot reach (the assembler refuses the build)', edits: [
    { file: 'engine/player.asm', from: '  .if STREAM_RING\n  bne ring_far1', to: '  .if 0\n  bne ring_far1' }] },
  'h-far-branch-inverted': { side: 'h', note: 'the far branch\'s condition is reversed (beq for bne): an ordinary screen with a left neighbour is refused and one with none takes the transition', edits: [
    { file: 'engine/player.asm', from: '  .if STREAM_RING\n  bne ring_far1', to: '  .if STREAM_RING\n  beq ring_far1' }] },
  'h-row-len-32': { side: 'h', note: 'SW_RING_ROW_LEN stays the torus 32 on a horizontal ring (the row strip keeps its two-screen length and wrap)', edits: [
    { file: 'main/build/generate.js', from: '`SW_RING_ROW_LEN = ${ringMode === 2 ? 16 : 32}`', to: '`SW_RING_ROW_LEN = 32`' }] },
  'h-row-load-32': { side: 'h', note: 'only the row strip builder\'s st_len load keeps 32 (compare and wrap are 16)', edits: [
    { file: 'engine/streamworld.asm', from: 'sw_ring_row_len:\n  lda #SW_RING_ROW_LEN', to: 'sw_ring_row_len:\n  lda #32' }] },
  'h-wrap-32': { side: 'h', note: 'sw_nmi_stream\'s row wrap stays at the torus 32', edits: [
    { file: 'engine/streamworld.asm', from: 'sw_ring_wrap_row:\n  cmp #SW_RING_ROW_LEN', to: 'sw_ring_wrap_row:\n  cmp #32' }] },
  'h-wrap-30': { side: 'h', note: 'sw_nmi_stream\'s row wrap compares 30 (the column modulus) instead of the ring row length', edits: [
    { file: 'engine/streamworld.asm', from: 'sw_ring_wrap_row:\n  cmp #SW_RING_ROW_LEN', to: 'sw_ring_wrap_row:\n  cmp #30' }] },
  'h-camera-x-unfrozen': { side: 'h', note: 'the streamed camera\'s X extent clamp is lifted: the camera follows the player\'s X on a one-screen-wide world', edits: [
    { file: 'engine/streamworld.asm', from: 'sw_fcw_x_nonneg:\n  lda sw_grid_w\n  sec\n  sbc #1\n  sta sw_tmp3', to: 'sw_fcw_x_nonneg:\n  lda #$FF\n  sec\n  sbc #1\n  sta sw_tmp3' }] },
  'h-column-strip-reached': { side: 'h', note: 'the window\'s row arm calls the vertical ring\'s column strip builder on a horizontal build', edits: [
    { file: 'engine/streamworld.asm', from: 'sw_win_arm_row_dec:\n  jsr sw_win_row_dec\n  lda win_row_screen\n  ldx win_row_local\n  jsr sw_stream_start_row', to: 'sw_win_arm_row_dec:\n  jsr sw_win_row_dec\n  lda win_row_screen\n  ldx win_row_local\n  jsr sw_stream_start_col' }] },
  'h-close-split-16': { side: 'h', note: 'the dialogue run writer hard-codes a seam at tile column 16: a horizontal ring\'s close row is published in two packets', edits: [
    { file: 'engine/streamdialog.asm', from: '  sta <sw_dlgw_tmp          ; r, transient -- no attr call is ever in flight\n                              ; here (see sw_dlgw_tmp\'s own comment above)\n  lda #32', to: '  sta <sw_dlgw_tmp          ; r, transient -- no attr call is ever in flight\n                              ; here (see sw_dlgw_tmp\'s own comment above)\n  lda #16' }] },
  'h-cam-nt-compacted': { side: 'h', note: 'cam_nt carries the Y parity in bit 0 (a compacted {0,1} index instead of the parity index {0,2})', edits: [
    { file: 'engine/streamworld.asm', from: '  and #1\n  asl a\n  ora sw_tmp\n  sta <cam_nt\n  dec <cam_dirty', to: '  and #1\n  ora sw_tmp\n  sta <cam_nt\n  dec <cam_dirty' }] },
  'h-render-step-1': { side: 'h', note: 'sw_render_window steps the index by 1 (the vertical ring\'s sequence) on a horizontal ring: nametables 1 and 3, aliases of 0 and 2, are drawn', edits: [
    { file: 'main/build/generate.js', from: '`SW_RW_NT_STEP = ${ringMode === 2 ? 2 : 1}`', to: '`SW_RW_NT_STEP = 1`' }] },
  'ring-flag-off': { note: 'the build is generated with STREAM_RING = 0: the unforked four-screen strip and render on a two-nametable board', edits: [
    { file: 'main/build/generate.js', from: '`STREAM_RING = ${ringMode}`', to: '`STREAM_RING = 0`' }] }
};
export const ACTIVE_SABOTAGE = process.env.FORGE_RING_SABOTAGE || null;
if (ACTIVE_SABOTAGE && !RING_SABOTAGES[ACTIVE_SABOTAGE]) throw new Error(`FORGE_RING_SABOTAGE=${ACTIVE_SABOTAGE} is not one of ${Object.keys(RING_SABOTAGES).join(', ')}`);

/**
 * Resolves the nested `.if STREAM_RING ... .else <original> .endif` forks of an engine source for STREAM_RING = 0: the fork lines and the
 * ring-only labels go, the `.else` body stays. What is left is the engine as it read before the ring existed (a build of it is the identity
 * control for every four-screen ROM). Throws on any other shape, so a new fork nesting cannot be half-resolved silently.
 */
export function collapseRingFork(text) {
  const out = [];
  let state = 'none'; // none | ring (before .else) | else
  for (const line of text.split('\n')) {
    if (/^\s*\.if STREAM_RING\s*$/.test(line)) { if (state !== 'none') throw new Error('nested .if STREAM_RING'); state = 'ring'; continue; }
    if (state === 'ring') { if (/^\s*\.else\s*$/.test(line)) state = 'else'; else if (/^\s*\.endif\s*$/.test(line)) throw new Error('.if STREAM_RING without .else'); continue; }
    if (state === 'else') { if (/^\s*\.endif\s*$/.test(line)) state = 'none'; else out.push(line); continue; }
    out.push(line);
  }
  if (state !== 'none') throw new Error('unterminated .if STREAM_RING');
  return out.join('\n');
}

/**
 * makeBypassTree({ edits, transforms }) -> { root, dispose() }. `edits` = [{ file, from, to }] exact-once replacements applied to the copy;
 * `transforms` = { 'engine/x.asm': (text) => text }. The active FORGE_RING_SABOTAGE (if any) is applied after them. The copy is a distinct
 * file URL per call, so module caches never alias the real tree or another copy.
 */
export function makeBypassTree({ edits = [], transforms = {}, bypass = true, sabotage = ACTIVE_SABOTAGE } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-bypass-'));
  for (const d of ['engine', 'main', 'shared']) fs.cpSync(path.join(ROOT, d), path.join(root, d), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(root, 'package.json'));
  const replaceOnce = (file, from, to) => {
    const p = path.join(root, file);
    const text = fs.readFileSync(p, 'utf8');
    const n = text.split(from).length - 1;
    if (n !== 1) throw new Error(`ringbypass: ${file}: expected exactly one match for ${JSON.stringify(from)}, found ${n}`);
    fs.writeFileSync(p, text.replace(from, () => to));
  };
  if (bypass) replaceOnce('shared/project.js', REFUSAL, NEUTRALIZED);
  for (const [file, fn] of Object.entries(transforms)) fs.writeFileSync(path.join(root, file), fn(fs.readFileSync(path.join(root, file), 'utf8')));
  for (const e of edits) replaceOnce(e.file, e.from, e.to);
  if (sabotage) for (const e of RING_SABOTAGES[sabotage].edits) replaceOnce(e.file, e.from, e.to);
  return { root, dispose: () => fs.rmSync(root, { recursive: true, force: true }) };
}

/** The copy's own public build path: { buildProject, saveProject, loadProject, generate, shared, cartridge }. */
export async function loadBypassTree(tree) {
  const u = (p) => pathToFileURL(path.join(tree.root, p)).href;
  const [pipeline, projectIo, generate, shared, cartridge] = await Promise.all([
    import(u('main/build/pipeline.js')), import(u('main/project-io.js')), import(u('main/build/generate.js')),
    import(u('shared/project.js')), import(u('shared/cartridge.js'))
  ]);
  return { buildProject: pipeline.buildProject, saveProject: projectIo.saveProject, loadProject: projectIo.loadProject, generate, shared, cartridge };
}

/** Builds `project` through the copy into a fresh mkdtemp dir. Returns { dir, romPath, symbolPath, log, built } (the dir is the caller's to remove). */
export async function buildThrough(loaded, project) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-build-'));
  const log = [];
  await loaded.saveProject(dir, project);
  const built = await loaded.buildProject({ dir, project, log: (l) => log.push(l) });
  return { dir, romPath: built.romPath, symbolPath: built.symbolPath, log, built };
}
