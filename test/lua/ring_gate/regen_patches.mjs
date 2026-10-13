#!/usr/bin/env node
// Regenerates test/lua/ring_gate/*.patch (what production does NOT ship: the refusal lift and the horizontal half of the phase 3b ring prototype),
// test/lua/ring_gate/sabotage/*.patch (each on top of the horizontal prototype tree) and test/lua/ring_gate/sabotage/vertical/*.patch (each on top of the
// vertical production tree = BASELINE + 00-refusal-lift) from the CURRENT engine/ main/ shared/, which must equal ringtree.mjs's BASELINE. The patches are the
// artifact the gate applies (ringtree.mjs); this script is only how they were made, kept so a
// rebase onto a moved HEAD is a re-run, not a hand edit. Each edit asserts that its anchor text is
// found exactly once, so a moved site fails here, loudly, not as a silently shorter patch.
//
//   node test/lua/ring_gate/regen_patches.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyBaseline, RING_PATCH_SETS } from './ringtree.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const HERE = path.join(ROOT, 'test/lua/ring_gate');
const DIRS = ['engine', 'main', 'shared'];

function copyTree(dest) {
  for (const d of DIRS) fs.cpSync(path.join(ROOT, d), path.join(dest, d), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(dest, 'package.json'));
}
function edit(tree, file, from, to, { all = false } = {}) {
  const p = path.join(tree, file);
  const text = fs.readFileSync(p, 'utf8');
  const n = text.split(from).length - 1;
  if (n < 1 || (!all && n !== 1)) throw new Error(`${file}: anchor found ${n} times, expected exactly 1:\n${from}`);
  fs.writeFileSync(p, text.split(from).join(to));
}
/**
 * The span [a, b) of a block delimited by two marks: `startMark` must occur exactly once in `text`, and `endMark` exactly once in the region that follows it (the intended search
 * region), so a second matching delimiter can never silently pick the wrong end. Throws naming `what` otherwise.
 */
export function locateBlock(text, startMark, endMark, what) {
  const starts = text.split(startMark).length - 1;
  if (starts !== 1) throw new Error(`${what}: start anchor found ${starts} times, expected exactly 1`);
  const a = text.indexOf(startMark);
  const ends = text.slice(a + startMark.length).split(endMark).length - 1;
  if (ends !== 1) throw new Error(`${what}: end anchor found ${ends} times after the start, expected exactly 1`);
  return { a, b: text.indexOf(endMark, a + startMark.length) };
}
// `git diff --no-index` over two sibling dirs `a` and `b` -> a patch applied with `git apply -p2`.
function diffTrees(base, work, out, files) {
  let text = '';
  for (const f of files) {
    try {
      text += execFileSync('git', ['diff', '--no-index', '--no-color', '--', path.join('a', f), path.join('b', f)], { cwd: path.dirname(base), encoding: 'utf8' });
    } catch (e) {
      if (e.status === 1) text += e.stdout; else throw e;
    }
  }
  if (!text) throw new Error(`${out}: empty patch (every patch of the shipped set must change something)`);
  fs.writeFileSync(out, text);
}

// ---------------------------------------------------------------- the patches (BASELINE = C2: the vertical ring is production code)
// What production (C2) does NOT ship, and the gate therefore still patches in:
//   00  the validateProject refusal of every two-nametable streamed board (both rings; this is the whole vertical tree's patch set);
//   01  the horizontal half of the generated constants: SW_RING_ROW_LEN, the mode-2 render step, and the lift of generate.js's mode-2 refusal;
//   02  the horizontal row-strip fork and the row wrap (the vertical column fork and the render index are C2's, in BASELINE already);
//   03  player.asm's far branch (a horizontal streamed build's `beq cross_none` is out of range).
// 01-03 are the S1 prototype's horizontal half, which S3 productionizes. The vertical ring runs on C2's shipped code with 00 alone.
const stages = [
  {
    name: '00-refusal-lift.patch',
    files: ['shared/project.js'],
    apply(t) {
      // lift the "two-nametable ring not implemented" refusal (validateProject), keeping the dead-axis refusals
      const p = path.join(t, 'shared/project.js');
      let s = fs.readFileSync(p, 'utf8');
      const startMark = '    } else if (!streamCapableFourScreen(mapper, mirroringId)) {\n      // Phase 2 slice 2b:';
      const endMark = '    for (const problem of gridProblems)';
      const { a, b } = locateBlock(s, startMark, endMark, 'project.js refusal block');
      s = s.slice(0, a) + '    }\n' + s.slice(b);
      fs.writeFileSync(p, s);
    }
  },
  {
    name: '01-ring-select.patch',
    files: ['main/build/generate.js'],
    apply(t) {
      const g = 'main/build/generate.js';
      // C2's generator refuses mode 2 (the S3 row fork): the horizontal tree carries the fork (02), so the refusal goes
      edit(t, g, `  if (ringMode === 2) {
    throw new Error(
      'Build panel: this project streams a map on a board with horizontal mirroring, which needs the horizontal two-nametable ' +
        'ring -- not implemented yet. Streamed maps need UNROM 512 with four-screen mirroring today; change the board and ' +
        'mirroring in the Build panel, or remove "streamed" for this map.'
    );
  }
`, `  // Phase 3b ring prototype (gate-only): mode 2 builds, with the row fork of 02-ring-engine.patch.
`);
      edit(t, g, `    \`SW_RW_NT_STEP = 1\`,`,
`    \`SW_RING_ROW_LEN = \${ringMode === 2 ? 16 : 32}\`,
    // vertical 0,1 (end 2), horizontal 0,2 (end 4)
    \`SW_RW_NT_STEP = \${ringMode === 2 ? 2 : 1}\`,`);
    }
  },
  {
    name: '02-ring-engine.patch',
    files: ['engine/streamworld.asm'],
    apply(t) {
      const f = 'engine/streamworld.asm';
      // row strip: 32 -> SW_RING_ROW_LEN (loop end + st_len)
      edit(t, f, `  lda ss_i
  cmp #32
  bne sw_ssr_loop
  jsr sw_locate_current
  lda #32
  sta st_len`,
`  lda ss_i
  .if STREAM_RING
sw_ring_row_cmp:
  cmp #SW_RING_ROW_LEN
  .else
  cmp #32
  .endif
  bne sw_ssr_loop
  jsr sw_locate_current
  .if STREAM_RING
sw_ring_row_len:
  lda #SW_RING_ROW_LEN
  .else
  lda #32
  .endif
  sta st_len`);
      // sw_nmi_stream row wrap modulus (the column wrap is C2's)
      edit(t, f, `sw_ns_wrap32:
  lda st_vary
  cmp #32
  bne sw_ns_wrapdone`,
`sw_ns_wrap32:
  lda st_vary
  .if STREAM_RING
sw_ring_wrap_row:
  cmp #SW_RING_ROW_LEN
  .else
  cmp #32
  .endif
  bne sw_ns_wrapdone`);
    }
  },
  {
    name: '03-player-far-branch.patch',
    files: ['engine/player.asm'],
    apply(t) {
      // Filled in by the branch-site audit (FAR_SITES below): every site that fails a horizontal streamed build.
      const f = 'engine/player.asm';
      const text = fs.readFileSync(path.join(t, f), 'utf8').split('\n');
      let k = 0;
      const out = [];
      text.forEach((line, i) => {
        const site = i + 1;
        if (FAR_SITES.includes(site) && /^\s+beq cross_none\s*$/.test(line)) {
          k += 1;
          out.push(`  .if STREAM_RING`, `  bne ring_far${k}`, `  jmp cross_none`, `ring_far${k}:`, `  .else`, line, `  .endif`);
        } else out.push(line);
      });
      if (k !== FAR_SITES.length) throw new Error(`player.asm: expected ${FAR_SITES.length} far-branch sites, rewrote ${k}`);
      fs.writeFileSync(path.join(t, f), out.join('\n'));
    }
  }
];
/** The stages each ring's tree carries (ringtree.mjs RING_PATCH_SETS says the same; regen asserts the two agree). */
const STAGES_OF_RING = { 1: ['00-refusal-lift.patch'], 2: stages.map((s) => s.name) };

// Source lines of the `beq cross_none` sites that fail a horizontal streamed build at the pristine HEAD (see the S1a report).
const FAR_SITES = JSON.parse(process.env.RING_FAR_SITES ?? '[339]');

// ---------------------------------------------------------------- sabotage patches (each on top of the complete prototype)
const sabotages = {
  'strip-len-30-vertical': { files: ['main/build/generate.js'], apply: (t) => edit(t, 'main/build/generate.js', 'SW_RING_COL_LEN = ${ringMode === 1 ? 15 : 30}', 'SW_RING_COL_LEN = 30') },
  'wrap-col-30': { files: ['engine/streamworld.asm'], apply: (t) => edit(t, 'engine/streamworld.asm', `sw_ring_wrap_col:
  cmp #SW_RING_COL_LEN`, `sw_ring_wrap_col:
  cmp #30`) },
  'wrap-row-32': { rings: [2], files: ['engine/streamworld.asm'], apply: (t) => edit(t, 'engine/streamworld.asm', `sw_ring_wrap_row:
  cmp #SW_RING_ROW_LEN`, `sw_ring_wrap_row:
  cmp #32`) },
  'dest-plus08-vertical': { files: ['engine/streamworld.asm'], apply: (t) => edit(t, 'engine/streamworld.asm', `  asl a
  asl a
  sta st_fnt                  ; nt-hi contribution = (screenCol&1)*4`, `  asl a
  asl a
  ora #$08
  sta st_fnt                  ; nt-hi contribution = (screenCol&1)*4`) },
  // The render loop visits 0,1,2,3 on BOTH orientations: step 1, end 4. (Round 1's version set only END = 4, which on horizontal is already the
  // value, so it visited 0,2 and was a no-op there -- phase3b-s1a-review1.md finding 4.)
  // (The vertical production generator emits the literal STEP = 1, so only END changes there; the horizontal prototype's STEP expression is 01-ring-select's.)
  'render-four-nts': { files: ['main/build/generate.js'], apply: (t, ring) => {
    if (ring === 2) edit(t, 'main/build/generate.js', 'SW_RW_NT_STEP = ${ringMode === 2 ? 2 : 1}', 'SW_RW_NT_STEP = 1');
    edit(t, 'main/build/generate.js', 'SW_RW_NT_END = ${ringMode === 1 ? 2 : 4}', 'SW_RW_NT_END = 4');
  } },
  // coverage control: the walk does not walk (both player-step routines return at once)
  'no-walk-v': { files: ['engine/streamworld.asm'], apply: (t) => {
    edit(t, 'engine/streamworld.asm', 'sw_pstep_right:\n', 'sw_pstep_right:\n  rts\n');
    edit(t, 'engine/streamworld.asm', 'sw_pstep_left:\n', 'sw_pstep_left:\n  rts\n');
  } },
  'no-walk-h': { files: ['engine/streamworld.asm'], apply: (t) => {
    edit(t, 'engine/streamworld.asm', 'sw_pstep_down:\n', 'sw_pstep_down:\n  rts\n');
    edit(t, 'engine/streamworld.asm', 'sw_pstep_up:\n', 'sw_pstep_up:\n  rts\n');
  } },
  // dialogue-content control: every typed glyph is a space tile
  'wrong-glyph': { files: ['engine/text.asm'], apply: (t) => edit(t, 'engine/text.asm', 'text_type_glyph:\n  jsr text_put_char', 'text_type_glyph:\n  lda #$A0\n  jsr text_put_char') },
  // premature-text control (review 2 finding 1): the typewriter draws the WHOLE first line in one frame and only then leaves the typing state,
  // so the first typing observation (box_state 2, >= 3 glyphs down) already shows a complete page with msg_col at its full length
  'instant-text': { files: ['engine/text.asm'], apply: (t) => edit(t, 'engine/text.asm', `text_type_glyph:
  jsr text_put_char
  jsr msg_advance
  inc <msg_col
  rts`, `text_type_glyph:
  jsr text_put_char
  jsr msg_advance
  inc <msg_col
  ldy #0
  lda [msg_ptr_lo],y
  cmp #$A0                    ; a glyph tile (the control tokens are $00-$03): keep drawing this frame
  bcc text_type_instant_done
  jmp text_type_glyph
text_type_instant_done:
  rts`) },
  // Sweep controls (coverage campaign): faults only a LARGE world reaches, which the 4-screen lap cannot.
  // bank/region carry at screen 23 instead of 24: every screen at column >= 23 resolves to the wrong record (visible from N = 24 up)
  'region-carry-23': { files: ['engine/streamworld.asm'], apply: (t) => edit(t, 'engine/streamworld.asm', 'sw_goto_coldiv:\n  cmp #STREAM_SCREENS_PER_REGION', 'sw_goto_coldiv:\n  cmp #23') },
  // the hi byte of the camera's 16-bit X loses its top bit when the desired window block is derived: wrong windows from screen 128 on (N >= 129)
  'camhi-mask-7f': { files: ['engine/streamworld.asm'], apply: (t) => edit(t, 'engine/streamworld.asm', 'lda sw_fc_px_hi\n  sta sw_tmp\n  lda #0\n  sta sw_tmp2\n  ldx #4\nsw_fcw_blkx_shift:', 'lda sw_fc_px_hi\n  and #$7F\n  sta sw_tmp\n  lda #0\n  sta sw_tmp2\n  ldx #4\nsw_fcw_blkx_shift:') },
  // the hi byte of the 16-bit camera block is dropped: wrong windows from block 256 on (screen 16, N >= 17)
  'blk-hi-drop': { files: ['engine/streamworld.asm'], apply: (t) => edit(t, 'engine/streamworld.asm', 'lda sw_tmp2\n  adc #0\n  sta sw_tmp4                   ; camBlockX hi', 'lda #0\n  adc #0\n  sta sw_tmp4                   ; camBlockX hi') },
  // Redraw-entry controls (a real position-jump guard / battle return): the guard's trip threshold is one block too high, so the scene's lag of 6 never fires it
  'pjg-lag-7': { files: ['engine/streamworld.asm'], apply: (t) => edit(t, 'engine/streamworld.asm', 'sw_pjg_lt_abs_done:\n  cmp #6\n', 'sw_pjg_lt_abs_done:\n  cmp #7\n') },
  // the guard never installs the desired LOCAL column (resp. row): it redraws at the stale, lagged origin on that axis (a ring's dead axis never lags)
  'pjg-no-col-local': { files: ['engine/streamworld.asm'], apply: (t) => edit(t, 'engine/streamworld.asm', 'sta win_col_local           ; own one-block-at-a-time approach', 'lda win_col_local           ; own one-block-at-a-time approach') },
  'pjg-no-row-local': { files: ['engine/streamworld.asm'], apply: (t) => edit(t, 'engine/streamworld.asm', 'lda sw_fc_desrl\n  sta win_row_local\n  jsr sw_render_window        ; full torus redraw at the target origin', 'lda sw_fc_desrl\n  lda win_row_local\n  jsr sw_render_window        ; full torus redraw at the target origin') },
  // the battle return (rpg.asm battle_end) never redraws the field: the battle bank's own backdrop is left in the live NTs (cold boot is untouched)
  'battle-return-no-render': { files: ['engine/rpg.asm'], apply: (t) => edit(t, 'engine/rpg.asm', 'bne battle_end_status\n  jsr redraw_screen\n', 'bne battle_end_status\n  nop\n  nop\n  nop\n') },
  // Continue lands the player at (0,0) of the loaded screen: the landing is coherent but not where the save was (the scene's required windows are not
  // the ones the continue lands in -- a coverage catch)
  'continue-pos-zero': { files: ['engine/save.asm'], apply: (t) => edit(t, 'engine/save.asm', '  lda #ST_GAMEPLAY\n  sta <game_state\n  jmp redraw_screen', '  lda #ST_GAMEPLAY\n  sta <game_state\n  lda #0\n  sta <player_x\n  sta <player_y\n  jmp redraw_screen') },
  // Shake controls (a real Shake on a horizontal-mirroring cell): the 9-bit camera X's carry/borrow never flips PPUCTRL's select -- the transient
  // select 1/3 is never produced (coverage: the shake:ppuctrl witnesses)
  'shake-no-nt-flip': { files: ['engine/boot.asm'], apply: (t) => {
    edit(t, 'engine/boot.asm', 'bcc nmi_scroll_cam_shake_pos_nt\n  eor #1\nnmi_scroll_cam_shake_pos_nt:', 'bcc nmi_scroll_cam_shake_pos_nt\n  nop\n  nop\nnmi_scroll_cam_shake_pos_nt:');
    edit(t, 'engine/boot.asm', 'bcs nmi_scroll_cam_shake_neg_nt\n  eor #1\nnmi_scroll_cam_shake_neg_nt:', 'bcs nmi_scroll_cam_shake_neg_nt\n  nop\n  nop\nnmi_scroll_cam_shake_neg_nt:');
  } },
  // the flip toggles the vertical select (bit 1) instead of bit 0: the displayed live NT is the WRONG one during the shake (VRAM verdict)
  'shake-nt-eor2': { files: ['engine/boot.asm'], apply: (t) => {
    edit(t, 'engine/boot.asm', 'bcc nmi_scroll_cam_shake_pos_nt\n  eor #1\nnmi_scroll_cam_shake_pos_nt:', 'bcc nmi_scroll_cam_shake_pos_nt\n  eor #2\nnmi_scroll_cam_shake_pos_nt:');
    edit(t, 'engine/boot.asm', 'bcs nmi_scroll_cam_shake_neg_nt\n  eor #1\nnmi_scroll_cam_shake_neg_nt:', 'bcs nmi_scroll_cam_shake_neg_nt\n  eor #2\nnmi_scroll_cam_shake_neg_nt:');
  } },
  // dialogue-attribute control: the open band leaves the terrain's palette under the box (the mask is never applied)
  'dlg-attr-nomask': { files: ['engine/streamdialog.asm'], apply: (t) => edit(t, 'engine/streamdialog.asm', 'sw_dlg_attr_overlay:\n  and <sw_dlgw_currm', 'sw_dlg_attr_overlay:\n  and #0') },
  // placement control: the generated flag says banked while the overlay is still assembled resident (a prediction that disagrees with the ROM)
  'forced-banked': { files: ['main/build/generate.js'], apply: (t) => edit(t, 'main/build/generate.js', 'SW_DLG_BANKED = ${streamworldDialogueBanked(project, mapper) ? 1 : 0}', 'SW_DLG_BANKED = 1') },
  // index 1 names the $2800 screen: tables compacted, sequence 0,1, shadow offset n*64, cam_nt = screenRow&1 -- the NMI then selects $2400, a mirror of $2000
  'compacted-cam-nt-horizontal': { files: ['engine/streamworld.asm', 'main/build/generate.js'], apply: (t, ring) => {
    edit(t, 'engine/streamworld.asm', `sw_rw_nt_hi:  .db $20, $24, $28, $2C
sw_rw_ntx:    .db 0, 16, 0, 16
sw_rw_nty:    .db 0, 0, 15, 15`, `sw_rw_nt_hi:  .db $20, $28, $28, $2C
sw_rw_ntx:    .db 0, 0, 0, 16
sw_rw_nty:    .db 0, 15, 15, 15`);
    edit(t, 'engine/streamworld.asm', `  lda sw_fc_scr
  and #1
  asl a
  ora sw_tmp
  sta <cam_nt`, `  lda sw_fc_scr
  and #1
  ora sw_tmp
  sta <cam_nt`);
    if (ring === 2) edit(t, 'main/build/generate.js', 'SW_RW_NT_STEP = ${ringMode === 2 ? 2 : 1}', 'SW_RW_NT_STEP = 1');
    edit(t, 'main/build/generate.js', 'SW_RW_NT_END = ${ringMode === 1 ? 2 : 4}', 'SW_RW_NT_END = ${ringMode ? 2 : 4}');
  } },
  // S1b full-system padding mutation (plan 2.6's only G-gate control): a delay loop at the TOP of every mainline body (main_loop_body_start: every frame class
  // runs it). Each outer pass costs 256 x 5 - 1 + 7 = 1,286 CPU cycles (ldx #0 / dex / bne x256, dey / bne). `over` adds 12 passes = 15,432 cycles, enough to push the
  // worst walking/crossing body past the 29,780-cycle gate; `under` adds 6 passes = 7,716, which no measured class can exceed the gate with: the matching positive.
  'pad-mainline-over': { files: ['engine/boot.asm'], apply: (t) => edit(t, 'engine/boot.asm', 'main_loop_body_start:\n  jsr read_pad', 'main_loop_body_start:\n  ldy #12\ngate_pad_outer:\n  ldx #0\ngate_pad_inner:\n  dex\n  bne gate_pad_inner\n  dey\n  bne gate_pad_outer\n  jsr read_pad') },
  'pad-mainline-under': { files: ['engine/boot.asm'], apply: (t) => edit(t, 'engine/boot.asm', 'main_loop_body_start:\n  jsr read_pad', 'main_loop_body_start:\n  ldy #6\ngate_pad_outer:\n  ldx #0\ngate_pad_inner:\n  dex\n  bne gate_pad_inner\n  dey\n  bne gate_pad_outer\n  jsr read_pad') },
  'ring-forced-0': { files: ['main/build/generate.js'], apply: (t) => edit(t, 'main/build/generate.js', 'const ringMode = hasStreamed ? projectStreamRing(project, resolveMapper(project.cartridge.mapper)) : 0;', 'const ringMode = 0;') },
  // S1b round 2, row 7 (finding 5): a scripted Move publishes a STALE scroll while its RAM origin stays coherent -- the camera lock is left raised after every Move step's camera update, so the NMI
  // never refreshes its snapshot (the coherent-stale-frame policy, docs/design-camera.md section 2) and the PPU keeps the scroll of the Move's first frame. Only a Move reaches it.
  'move-scroll-stale': { files: ['engine/entities.asm'], apply: (t) => edit(t, 'engine/entities.asm', 'move_tick_s_done:\n  lda <moving\n  beq move_wall              ; the driver refused the step: blocked, exactly as shipped\n  jsr sw_frame_camera_window\n', 'move_tick_s_done:\n  lda <moving\n  beq move_wall              ; the driver refused the step: blocked, exactly as shipped\n  jsr sw_frame_camera_window\n  inc <cam_dirty\n') },
  // a strip read from the WRONG SOURCE: the entering block is taken from the neighbouring column of its screen (index eor 1) in both strip starters; every RAM identity, the strip's length and destination stay coherent.
  'strip-src-eor1': { files: ['engine/streamworld.asm'], apply: (t) => { edit(t, 'engine/streamworld.asm', '  adc sw_probe_col_local\n  tay\n  lda [mtptr_lo],y\n  jmp sw_ssr_store', '  adc sw_probe_col_local\n  eor #1\n  tay\n  lda [mtptr_lo],y\n  jmp sw_ssr_store'); edit(t, 'engine/streamworld.asm', '  adc sw_ss_lc\n  tay\n  lda [mtptr_lo],y\n  jmp sw_ssc_store', '  adc sw_ss_lc\n  eor #1\n  tay\n  lda [mtptr_lo],y\n  jmp sw_ssc_store'); } },
  'dlg-attr-offset-n32': { files: ['engine/streamdialog.asm'], apply: (t) => edit(t, 'engine/streamdialog.asm', `  pha
  tax
  txa
  asl a
  asl a
  asl a
  asl a
  asl a
  asl a
  sta <sw_dlgw_shadowlo`, `  pha
  tax
  txa
  asl a
  asl a
  asl a
  asl a
  asl a
  sta <sw_dlgw_shadowlo`) }
};

function main() {
  verifyBaseline(); // the patches are made against, and only against, BASELINE (ringtree.mjs)
  for (const ring of [1, 2]) {
    if (JSON.stringify(RING_PATCH_SETS[ring]) !== JSON.stringify(STAGES_OF_RING[ring])) throw new Error(`ringtree.mjs RING_PATCH_SETS[${ring}] disagrees with this script's stages`);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-regen-'));
  const base = path.join(tmp, 'work', 'a');
  const cur = path.join(tmp, 'work', 'b');
  fs.mkdirSync(base, { recursive: true });
  copyTree(base);
  copyTree(cur);
  // stage patches: a -> b accumulates, patch k is the diff between the tree before and after stage k
  let before = path.join(tmp, 'work', 'a');
  const snaps = {}; // ring -> the tree its sabotages are diffed against (after the last stage the ring carries)
  for (const stage of stages) {
    const wk = path.join(tmp, 'work', 'b');
    stage.apply(wk);
    // diff `before` vs `wk` for this stage's files only
    const pair = path.join(tmp, `pair-${stage.name}`);
    fs.mkdirSync(pair, { recursive: true });
    fs.cpSync(before, path.join(pair, 'a'), { recursive: true });
    fs.cpSync(wk, path.join(pair, 'b'), { recursive: true });
    diffTrees(path.join(pair, 'a'), path.join(pair, 'b'), path.join(HERE, stage.name), stage.files);
    before = path.join(tmp, `snap-${stage.name}`);
    fs.cpSync(wk, before, { recursive: true });
    if (stage.name === STAGES_OF_RING[1].at(-1)) snaps[1] = before;
  }
  snaps[2] = before;
  fs.mkdirSync(path.join(HERE, 'sabotage', 'vertical'), { recursive: true });
  for (const [name, s] of Object.entries(sabotages)) {
    for (const ring of s.rings ?? [1, 2]) {
      const pair = path.join(tmp, `sab-${ring}-${name}`);
      fs.mkdirSync(pair, { recursive: true });
      fs.cpSync(snaps[ring], path.join(pair, 'a'), { recursive: true });
      fs.cpSync(snaps[ring], path.join(pair, 'b'), { recursive: true });
      s.apply(path.join(pair, 'b'), ring);
      diffTrees(path.join(pair, 'a'), path.join(pair, 'b'), path.join(HERE, ring === 1 ? path.join('sabotage', 'vertical') : 'sabotage', `${name}.patch`), s.files);
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('patches written to', HERE);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
