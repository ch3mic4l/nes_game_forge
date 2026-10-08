// Phase 3b S1c row 6 (plan 2.5 / 1.5): the text-box CLOSE frame on a RING build. The scene is the close-deadline fixture's (a streamed world whose talker stands where the
// camera is mid-scroll, an ordinary map carrying a switch-bound tile so flip_tick is assembled, a Flash command), carried onto a ring cell; the template
// (test/lua/sw_close_deadline.lua.template, its `ring` sections) validates the queue BY STRUCTURE and the judge here cross-checks it from the printed queue.
//
// The close frame's queue, in main_loop's call order (docs/reference-engine.md, plan 1.5):
//   vertical ring   Flip 5 + Flip 5 + Flash 35 + arrow hide 4 + close row split at the $2000/$2400 join (3+a) + (3+b) + terminator 1 = 88 (vram_len 87)
//   horizontal ring Flip 5 + Flip 5 + Flash 35 + arrow hide 4 + one 3+32 close row                             + terminator 1 = 85 (vram_len 84)
// 88 stays the global bound; 85 is the horizontal ring's real figure (the plan's review had it as 81, then 88).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeTree, sha256 } from './ringtree.mjs';
import { buildCell } from './ringworld.mjs';
import { createStreamedProject } from '../../lib/streamedproject.js';
import { renderSections } from './ringsections.mjs';
import { vblankMargin } from './ringnmi.mjs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH_CLOSE = path.join(HERE, '../sw_close_deadline.lua.template');
export const BOUND_SWITCH = 5;
/** Where the talker stands per ring: the camera is mid-scroll along the ring's own axis there (vertical: cam_x 80, horizontal: cam_y 88 + a whole screen). */
export const TALKER = { 1: { x: 200, y: 112 }, 2: { x: 120, y: 200 } };
const TALKER_SCREEN = 1;

/** The expected queue shape per ring: close-row packets (1 or 2) and vram_len. */
export const closeShape = (ring) => (ring === 1 ? { parts: 2, vramLen: 87, bytes: 88 } : { parts: 1, vramLen: 84, bytes: 85 });

export const CLOSE_MUTATIONS = {
  // declared HARNESS mutations (the validator is told something false about the ring; each must be rejected on its own diagnostic)
  'expect-87': 'the retired fixed vram_len = 87 assertion, on every ring (wrong for the horizontal ring, whose queue is 84)',
  'expect-split-horizontal': 'a horizontal ring is expected to publish its close row in two packets',
  'expect-unsplit-vertical': 'a vertical ring, mid-scroll, is expected to publish its close row in one packet'
};

/** The ring close scene: { project } for `cell`, `gt`, `placement`; `flat` resolves the start screen through the patched tree's own flattenScreens. */
export async function ringCloseProject({ tree, cell, gt, placement, n = 4 }) {
  const vertical = cell.ring === 1;
  const p = createStreamedProject({ gameType: gt, mixed: true, mapper: cell.mapper, mirroring: cell.mirroring, gridW: vertical ? n : 1, gridH: vertical ? 1 : n, camera: true });
  const [before, streamed] = p.maps;
  if (p.party?.[0]) p.party[0].renamable = false;
  p.metatiles[1].tiles = [5, 6, 7, 8];
  before.screens[0].boundTiles = [{ switchId: BOUND_SWITCH, row: 0, col: 0, metatileId: 1 }];
  const pos = TALKER[cell.ring];
  const talker = p.sprites.actors.length;
  p.sprites.actors.push({ name: 'Talker', behavior: 'npc', hp: 1, damage: 0 });
  const flasher = p.sprites.actors.length;
  p.sprites.actors.push({ name: 'Flasher', behavior: 'npc', hp: 1, damage: 0 });
  const screen = streamed.screens[TALKER_SCREEN];
  screen.entities = screen.entities ?? [];
  screen.entities.push({ actorId: talker, x: pos.x, y: pos.y, props: { trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'Hello there, traveler.' }] }] } } });
  screen.entities.push({ actorId: flasher, x: 40, y: 40, props: { trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'flash' }] }] } } });
  if (placement === 'banked') {
    // never-reached text, sized to push the dialogue overlay into the battle bank (the same lever ringProject's bulkText pulls)
    const bulk = p.sprites.actors.length;
    p.sprites.actors.push({ name: 'Bulk', behavior: 'npc', hp: 1, damage: 0 });
    const commands = [];
    for (let i = 0; i * 100 < 3000; i++) commands.push({ op: 'say', text: `BULK ${i} `.padEnd(100, String.fromCharCode(65 + (i % 26))) });
    streamed.screens[streamed.screens.length - 1].entities = [{ actorId: bulk, x: 232, y: 216, props: { trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } } }];
  }
  const { flattenScreens } = await import(pathToFileURL(path.join(tree.root, 'main/build/generate.js')).href);
  const { mapBase } = flattenScreens(p);
  p.project.startScreen = mapBase[1] + TALKER_SCREEN;
  p.project.startX = pos.x;
  p.project.startY = pos.y;
  return { project: p };
}

const lua = (v) => {
  if (Array.isArray(v)) return `{${v.map(lua).join(',')}}`;
  if (v && typeof v === 'object') return `{${Object.entries(v).map(([k, x]) => `${k}=${lua(x)}`).join(',')}}`;
  return typeof v === 'string' ? JSON.stringify(v) : String(v);
};

const RAM = { GAME_STATE: 'game_state', MAP_IS_STREAMED: 'map_is_streamed', BOX_STATE: 'box_state', VRAM_LEN: 'vram_len', VRAM_READY: 'vram_ready', VRAM_BUF: 'vram_buf', FLIP_PENDING_IDX: 'flip_pending_idx', FLIP_PENDING_COUNT: 'flip_pending_count', FLASH_LEFT: 'flash_left' };
const CONSTS = { ST_TITLE: 'ST_TITLE', BOX_ENDWAIT: 'BOX_ENDWAIT', FLASH_ARM_VALUE: 'FLASH_ARM_VALUE' };

/**
 * Builds one ring cell's close-frame ROM and Lua (no Mesen). `breakMode` 'no-flash' | 'slow-drain' (the legacy negative controls); `mutation` a CLOSE_MUTATIONS key.
 * `sections` is 'ring' (the structure-aware validator).
 */
export async function buildCloseRing({ cell, gt = 'rpg', placement = 'resident', sabotage = null, mutation = null, breakMode = null, outDir = null, provDir = null, label = null, links = {}, tree = null }) {
  if (mutation && !(mutation in CLOSE_MUTATIONS)) throw new Error(`unknown --mutation ${mutation}: ${Object.keys(CLOSE_MUTATIONS).join(', ')}`);
  if (breakMode && !['no-flash', 'slow-drain'].includes(breakMode)) throw new Error(`unknown --break ${breakMode}`);
  const own = !tree;
  const t = tree ?? makeTree({ ring: true, extra: sabotage ? [sabotage] : [] });
  const { project } = await ringCloseProject({ tree: t, cell, gt, placement });
  const overrides = [];
  if (breakMode === 'slow-drain') {
    const text = fs.readFileSync(path.join(t.root, 'engine/text.asm'), 'utf8');
    const needle = 'vram_drain_byte:\n  lda vram_buf,x\n  sta $2007\n';
    if (text.split(needle).length - 1 !== 1) throw new Error('slow-drain: the vram_drain byte loop moved');
    overrides.push({ name: 'text.asm', text: text.replace(needle, needle + '  nop\n'.repeat(8)) });
  }
  project.code = { overrides, files: [] };
  const stamp = label ?? `s1c-close-${sabotage ? `sab-${sabotage}-` : ''}${mutation ? `mut-${mutation}-` : ''}${breakMode ? `brk-${breakMode}-` : ''}${cell.id}-${gt}-${placement}`;
  const built = await buildCell({ tree: t, project, cell, gameType: gt, label: stamp, provDir, links, requestedPlacement: placement, sabotage });
  try {
    const sym = built.symbols;
    for (const n of Object.values(RAM)) if (!sym.has(n)) throw new Error(`${n} did not resolve out of this build's own constants.asm/config.inc`);
    for (const n of Object.values(CONSTS)) if (!sym.has(n)) throw new Error(`${n} did not resolve out of this build's own constants.asm/config.inc`);
    for (const n of ['nmi', 'nmi_rti', 'main_loop_ready', 'flip_tick']) if (!Number.isFinite(built.fns[n])) throw new Error(`${n} is not a symbol of this build (no ${n}: the scene did not assemble the producer)`);
    const outd = outDir ?? built.dir;
    fs.mkdirSync(outd, { recursive: true });
    const romPath = path.join(outd, 'sw_close_deadline.nes');
    fs.writeFileSync(romPath, built.rom);
    const shape = closeShape(cell.ring);
    const struct = { ring: cell.ring, parts: shape.parts, palFx: Boolean(sym.get('PALETTE_FX_ENABLED')), ...(mutation === 'expect-87' ? { fixedLen: 87 } : {}), ...(mutation === 'expect-split-horizontal' ? { expectParts: 2 } : {}), ...(mutation === 'expect-unsplit-vertical' ? { expectParts: 1 } : {}) };
    const ram = Object.entries(RAM).map(([L, n]) => `${L} = 0x${sym.get(n).toString(16)}`).concat(Object.entries(CONSTS).map(([L, n]) => `${L} = ${sym.get(n)}`)).join('\n');
    const hex = (n) => `0x${n.toString(16)}`;
    let text = renderSections(fs.readFileSync(TEMPLATE_PATH_CLOSE, 'utf8'), 'ring');
    const subs = [['__NMI__', hex(built.fns.nmi)], ['__NMI_RTI__', hex(built.fns.nmi_rti)], ['__MAIN_LOOP_READY__', hex(built.fns.main_loop_ready)], ['__FLIP_TICK__', hex(built.fns.flip_tick)],
      ['__FLASH_LEFT__', hex(sym.get('flash_left'))], ['__PLACEMENT__', placement], ['__BREAK__', breakMode ?? ''], ['__STRUCT__', lua(struct)], ['__RAM_OVERRIDES__', ram]];
    for (const [tok, v] of subs) { if (text.split(tok).length !== 2) throw new Error(`expected one ${tok}`); text = text.split(tok).join(v); }
    const luaPath = path.join(outd, 'sw_close_deadline.lua');
    fs.writeFileSync(luaPath, text);
    return { tree: t, built, dir: built.dir, outDir: outd, romPath, luaPath, struct, shape, ring: cell.ring, romSha256: sha256(built.rom), luaSha256: sha256(text), dispose: () => { fs.rmSync(built.dir, { recursive: true, force: true }); if (own) fs.rmSync(t.root, { recursive: true, force: true }); } };
  } catch (e) { fs.rmSync(built.dir, { recursive: true, force: true }); if (own) fs.rmSync(t.root, { recursive: true, force: true }); throw e; }
}

// ---- the judge ----------------------------------------------------------------------------------------------------------------------------------------
const item = (id, status, detail, extra = {}) => ({ id, status, detail, ...extra });
const EXIT_ITEM = { 5: 'close:deadline', 7: 'close:queue', 8: 'close:publication', 9: 'close:scroll' };

/** Packets of a printed queue (`hex` = vram_buf[0..len] as hex): [{ hi, lo, cnt }], the terminator position, or a problem. */
export function parseQueue(len, hex) {
  const b = Uint8Array.from((hex.match(/../g) ?? []).map((x) => parseInt(x, 16)));
  const packets = [];
  let i = 0;
  while (i < len) {
    if (b[i] === 0) return { error: `terminator at ${i}, before vram_len ${len}` };
    packets.push({ hi: b[i], lo: b[i + 1], cnt: b[i + 2], at: i });
    i += 3 + b[i + 2];
  }
  if (i !== len) return { error: `packets end at ${i}, vram_len ${len}` };
  if (b[len] !== 0) return { error: `no terminator at ${len}` };
  return { packets };
}

/** The independent structure check of one ring's printed queue, from the contract above (not from the template's own test). */
export function queueProblems(parsed, ring) {
  if (parsed.error) return [parsed.error];
  const shape = closeShape(ring);
  const live = (hi) => (ring === 1 ? hi >= 0x20 && hi <= 0x27 : (hi >= 0x20 && hi <= 0x23) || (hi >= 0x28 && hi <= 0x2b));
  const p = parsed.packets;
  const bad = [];
  if (p.length !== 4 + shape.parts) return [`${p.length} packets, the ${ring === 1 ? 'vertical' : 'horizontal'} ring's close frame has ${4 + shape.parts} (flip, flip, Flash, arrow hide, close row in ${shape.parts})`];
  if (!(p[0].cnt === 2 && p[1].cnt === 2 && live(p[0].hi) && live(p[1].hi))) bad.push('flip packets');
  if (!(p[2].hi === 0x3f && p[2].lo === 0 && p[2].cnt === 32)) bad.push('Flash packet');
  if (!(p[3].cnt === 1 && live(p[3].hi))) bad.push('arrow hide');
  const c = p[4];
  if (!live(c.hi)) bad.push('close row nametable');
  if (shape.parts === 1) { if (!(c.cnt === 32 && (c.lo & 31) === 0)) bad.push('close row is not one whole row'); }
  else {
    const d = p[5];
    if (!(c.cnt >= 1 && c.cnt <= 31 && (c.lo & 31) + c.cnt === 32)) bad.push('first close part does not reach the right edge');
    if (!(live(d.hi) && c.cnt + d.cnt === 32 && (d.lo & 31) === 0 && (d.lo >> 5) === (c.lo >> 5) && Math.abs(d.hi - c.hi) === 4)) bad.push('second close part is not the same row on the other live nametable');
  }
  const total = p.reduce((a, k) => a + 3 + k.cnt, 0) + 1;
  if (total !== shape.bytes) bad.push(`queue is ${total} bytes, ${shape.bytes} expected`);
  return bad;
}

export function parseCloseOutput(stdout, status) {
  const q = /^QUEUE len=(\d+) hex=([0-9a-f]*)$/m.exec(stdout);
  const fail = /^FAIL (\d+) (.*)$/m.exec(stdout);
  const rti = /^RTI scanline=(\d+) cycle=(\d+) vram_len=(\d+) vram_ready=(\d+) writes=(\d+)$/m.exec(stdout);
  const fin = /^FINISH scanline=(\d+) cycle=(\d+) lastscroll=(\d+)$/m.exec(stdout);
  return {
    status, queue: q ? { len: +q[1], hex: q[2] } : null, fail: fail ? { code: +fail[1], message: fail[2] } : null,
    rti: rti ? { scanline: +rti[1], cycle: +rti[2], vramLen: +rti[3], vramReady: +rti[4], writes: +rti[5] } : null,
    finish: fin ? { scanline: +fin[1], cycle: +fin[2], lastScroll: +fin[3] } : null,
    oks: [...stdout.matchAll(/^OK (.*)$/gm)].map((m) => m[1])
  };
}

/** Items of one close run for a ring cell; each its own predicate. */
export function judgeClose(parsed, { ring, struct }) {
  const items = [];
  const operational = [2, 3, 4, 6, 99].includes(parsed.status) || parsed.status === null || (![0, 5, 7, 8, 9].includes(parsed.status));
  items.push(operational ? item('run:operational', 'FAIL', `Mesen exited ${parsed.status}${parsed.fail ? `: ${parsed.fail.message}` : ''} (not a close-frame verdict)`) : item('run:operational', 'PASS', `the scene reached its close frame (exit ${parsed.status})`));
  const shape = closeShape(ring);
  // the queue: the template's own verdict (exit 7 = not the structure it was told) AND this judge's independent parse of the printed queue
  let queue;
  if (!parsed.queue) queue = item('close:queue', 'UNMEASURED', 'no queue was printed (the frame was never armed)');
  else {
    const jp = queueProblems(parseQueue(parsed.queue.len, parsed.queue.hex), ring);
    if (parsed.status === 7) queue = item('close:queue', 'FAIL', `the template rejected the queue: ${parsed.fail?.message ?? 'exit 7'}`, { vramLen: parsed.queue.len });
    else if (jp.length) queue = item('close:queue', 'FAIL', `the printed queue (vram_len ${parsed.queue.len}) is not the ring's close frame: ${jp.join('; ')}`, { vramLen: parsed.queue.len });
    else queue = item('close:queue', 'PASS', `${shape.bytes}-byte queue (vram_len ${parsed.queue.len}): flip 5, flip 5, Flash 35, arrow 4, close row ${shape.parts === 2 ? 'split at the nametable join (3+a, 3+b)' : 'one 3+32 packet'}, terminator`, { vramLen: parsed.queue.len });
  }
  items.push(queue);
  const reached = (code) => parsed.status === 0 || (parsed.status !== null && [5, 8, 9].includes(parsed.status) && code <= parsed.status);
  const step = (id, exit, okLine, label) => {
    if (parsed.status === exit) return item(id, 'FAIL', parsed.fail?.message ?? `exit ${exit}`);
    if (parsed.status === 0 && parsed.oks.some((o) => o.startsWith(okLine))) return item(id, 'PASS', parsed.oks.find((o) => o.startsWith(okLine)));
    return item(id, 'UNMEASURED', `${label}: the run stopped before it (exit ${parsed.status})`);
  };
  items.push(step('close:drain', 8, 'all ', 'drain'));
  items.push(parsed.status === 8 && parsed.fail && /^publication:/.test(parsed.fail.message) ? item('close:publication', 'FAIL', parsed.fail.message)
    : parsed.status === 8 ? item('close:publication', 'UNMEASURED', 'the drain check failed first')
      : step('close:publication', 8, 'publication:', 'publication'));
  items.push(step('close:scroll', 9, 'scroll reset', 'scroll restore'));
  // the deadline, recomputed here from the printed position
  if (parsed.status === 5) items.push(item('close:deadline', 'FAIL', parsed.fail?.message ?? 'exit 5'));
  else if (parsed.status === 0 && parsed.rti) {
    const v = vblankMargin(parsed.rti.scanline, parsed.rti.cycle);
    items.push(v.ok && parsed.finish && parsed.finish.lastScroll <= 260 ? item('close:deadline', 'PASS', `the ${shape.bytes}-byte close frame's nmi_rti at scanline ${parsed.rti.scanline} cycle ${parsed.rti.cycle}, last scroll write on scanline ${parsed.finish.lastScroll}: inside vblank, margin ${v.margin.toFixed(1)} cycles`, { margin: v.margin }) : item('close:deadline', 'FAIL', v.ok ? 'no FINISH line' : v.why));
  } else items.push(item('close:deadline', 'UNMEASURED', `the run stopped before the deadline (exit ${parsed.status})`));
  return items;
}
