// The VRAM + attribute oracle for a two-nametable streamed ring (phase 3b, Part 1 geometry).
//
// It computes the expected bytes of the two LIVE nametables from the PROJECT DATA (metatile ids, tiles, palettes, the fill
// metatile) and the ring geometry, and from nothing the engine generated: not the 4-entry nametable tables, not the build's .inc,
// not the strip builders. The one engine-shaped input is the camera rule, taken from test/lib/streamcamera.js's `expectedCamera`
// (docs/design-streamed-worlds.md's one formula per axis, already stated independently of the 6502), and the player's position,
// which is the scene's state, not a thing under test.
//
// Geometry (docs/design-streamed-worlds-phase3b.md Part 1.1): the ring is a torus the window (two screens) lays over the world.
//   vertical mirroring   ring 1: 32 x 15 blocks, live NTs {0,1} at $2000/$2400, physical (col,row) = (nt*16 + bc, br)
//   horizontal mirroring ring 2: 16 x 30 blocks, live NTs {0,2} at $2000/$2800, physical (col,row) = (bc, (nt>>1)*15 + br)
// A world block (wc,wr) sits at physical (wc mod 32, wr mod 30); the window is the 32 (30) consecutive world columns (rows) from
// its origin, so the block shown at a physical position is the one at origin + ((phys - origin) mod ring).
import { expectedCamera } from './streamcamera.js';
import { charToTile, BORDER_H, BORDER_V, BORDER_CORNER, TILE_SPACE, ARROW_TILE, wrapText } from '../../shared/font.js';

export const RING_LIVE_NTS = { 1: [0, 1], 2: [0, 2] };
export const NT_BASE = (nt) => 0x2000 + nt * 0x400;

const mod = (a, n) => ((a % n) + n) % n;

/** The metatile id the project puts at world block (wc, wr) of its one streamed map (the fill metatile outside the grid). */
export function worldMetatile(project, gridW, gridH, wc, wr) {
  const map = project.maps[0];
  const sc = Math.floor(wc / 16);
  const sr = Math.floor(wr / 15);
  if (wc < 0 || wr < 0 || sc >= gridW || sr >= gridH) return map.fillMetatileId ?? 0;
  return map.screens[sr * gridW + sc].metatiles[(wr % 15) * 16 + (wc % 16)];
}

/**
 * The dialogue box's footprint, from the viewport geometry alone (docs/design-streamed-worlds.md section 7: the box is six tile rows
 * at screen rows 24-29, all 32 columns, drawn against the camera AFTER the dialogue's own nudge floored it to a 16 px boundary).
 * `cam` = { nt, x, y } is that nudged camera (cam_nt, cam_x_lo, cam_y_lo). Returns
 *   tiles:  Map "liveIdx:tileIndex" -> tile id   (border, blank interior, typed glyphs, the page arrow); liveIdx is 0/1
 *   blocks: Set "physCol,physRow"                (the metatile blocks under the box: attribute quadrants drawn in palette 0)
 *   nts:    Set of live indices (0/1) holding any box tile
 * `typed` = { lines } the characters typed so far per text row; `arrow` = the page-wait arrow is shown.
 * Vertical ring: tile column = ((nt&1)*32 + x/8 + X) mod 64, row = (y/8 + 24 + Y) mod 30.
 * Horizontal ring: tile row = ((nt>>1)*30 + y/8 + 24 + Y) mod 60, column = (x/8 + X) mod 32.
 */
export function boxFootprint({ ring, cam, typed = { lines: [] }, arrow = false }) {
  const tiles = new Map();
  const nts = new Set();
  const put = (X, Y, tile) => {
    let nt, col, row;
    if (ring === 1) {
      const pc = mod((cam.nt & 1) * 32 + (cam.x >> 3) + X, 64);
      nt = pc >> 5; col = pc & 31; row = mod((cam.y >> 3) + 24 + Y, 30);
    } else {
      const pr = mod((cam.nt >> 1) * 30 + (cam.y >> 3) + 24 + Y, 60);
      nt = pr >= 30 ? 1 : 0; row = pr % 30; col = mod((cam.x >> 3) + X, 32);
    }
    nts.add(nt);
    tiles.set(`${nt}:${row * 32 + col}`, tile);
  };
  for (let Y = 0; Y < 6; Y++) {
    const edge = Y === 0 || Y === 5;
    for (let X = 0; X < 32; X++) put(X, Y, X === 0 || X === 31 ? (edge ? BORDER_CORNER : BORDER_V) : (edge ? BORDER_H : TILE_SPACE));
  }
  typed.lines.forEach((line, r) => { for (let c = 0; c < line.length; c++) put(2 + c, 1 + r, charToTile(line[c]) ?? TILE_SPACE); });
  if (arrow) put(30, 4, ARROW_TILE);
  const blocks = new Set();
  for (let i = 0; i < 16; i++) for (let r = 12; r < 15; r++) {
    if (ring === 1) blocks.add(`${mod((cam.nt & 1) * 16 + (cam.x >> 4) + i, 32)},${(cam.y >> 4) + r}`);
    else blocks.add(`${mod((cam.x >> 4) + i, 16)},${mod((cam.nt >> 1) * 15 + (cam.y >> 4) + r, 30)}`);
  }
  return { tiles, blocks, nts };
}

/** What the engine's dialogue has typed after `msgLine`/`msgCol` of the first page of `text` (the lines already finished plus the partial one). */
export function typedSoFar(text, msgLine, msgCol) {
  const page = wrapText(text)[0] ?? [];
  return { lines: page.map((line, r) => (r < msgLine ? line : r === msgLine ? line.slice(0, msgCol) : '')) };
}

/**
 * Expected state for a player standing at screen (col,row), pixel (px,py), once every strip has drained.
 * Returns { camera, nts: { [nt]: { tiles: Uint8Array(960), attr: Uint8Array(64) } } } for the live NTs only.
 * `box` (optional, a boxFootprint result) overlays the dialogue box: its tiles, and palette 0 on every block under it.
 */
export function ringExpected({ project, ring, gridW, gridH, player, box }) {
  const camera = expectedCamera({ gridW, gridH, col: player.col, row: player.row, px: player.px, py: player.py });
  const originX = camera.sw_fc_desc * 16 + camera.sw_fc_desl;
  const originY = camera.sw_fc_desr * 15 + camera.sw_fc_desrl;
  const meta = (id) => project.metatiles[id];
  const physBlock = (nt, bc, br) => (ring === 1 ? [nt * 16 + bc, br] : [bc, (nt >> 1) * 15 + br]);
  const blockAt = (nt, bc, br) => {
    const [physCol, physRow] = physBlock(nt, bc, br);
    const wc = ring === 1 ? originX + mod(physCol - originX, 32) : physCol;
    const wr = ring === 1 ? physRow : originY + mod(physRow - originY, 30);
    return worldMetatile(project, gridW, gridH, wc, wr);
  };
  const nts = {};
  for (const nt of RING_LIVE_NTS[ring]) {
    const tiles = new Uint8Array(960);
    const attr = new Uint8Array(64);
    const liveIdx = ring === 1 ? nt : nt >> 1;
    for (let br = 0; br < 15; br++) {
      for (let bc = 0; bc < 16; bc++) {
        const t = meta(blockAt(nt, bc, br)).tiles;
        const o = 64 * br + 2 * bc;
        tiles[o] = t[0]; tiles[o + 1] = t[1]; tiles[o + 32] = t[2]; tiles[o + 33] = t[3];
      }
    }
    for (let arow = 0; arow < 8; arow++) {
      for (let acol = 0; acol < 8; acol++) {
        const pal = (bc, br) => {
          if (box?.blocks.has(physBlock(nt, bc, br).join(','))) return 0;
          return meta(blockAt(nt, bc, br)).palette & 3;
        };
        const tl = pal(2 * acol, 2 * arow);
        const tr = pal(2 * acol + 1, 2 * arow);
        // the 15 block rows pair into 7 attribute rows and a leftover: the last row's lower quadrants are never drawn (0)
        const bl = arow === 7 ? 0 : pal(2 * acol, 2 * arow + 1);
        const br2 = arow === 7 ? 0 : pal(2 * acol + 1, 2 * arow + 1);
        attr[arow * 8 + acol] = tl | (tr << 2) | (bl << 4) | (br2 << 6);
      }
    }
    if (box) for (const [k, tile] of box.tiles) { const [n, i] = k.split(':').map(Number); if (n === liveIdx) tiles[i] = tile; }
    nts[nt] = { tiles, attr };
  }
  return { camera, nts };
}

/** Which physical live NT index (0/1) a PPUCTRL nametable select shows, after mirroring: vertical -> bit0, horizontal -> bit1. */
export const displayedLiveIndex = (ring, ppuctrlNt) => (ring === 1 ? ppuctrlNt & 1 : (ppuctrlNt >> 1) & 1);

/**
 * Compares a reader (addr -> byte, reading THROUGH the board's mirroring) against the expectation.
 * Returns a list of mismatches {where, addr, got, want}; empty = equal. `skip` is an optional (addr) predicate.
 */
export function diffAgainst(read, expected, ring, { skip, limit = 12 } = {}) {
  const bad = [];
  for (const nt of RING_LIVE_NTS[ring]) {
    const base = NT_BASE(nt);
    const { tiles, attr } = expected.nts[nt];
    for (let i = 0; i < 960; i++) {
      if (skip?.(base + i)) continue;
      const got = read(base + i);
      if (got !== tiles[i] && bad.length < limit) bad.push({ where: `nt${nt} tile(${i & 31},${i >> 5})`, addr: base + i, got, want: tiles[i] });
    }
    for (let i = 0; i < 64; i++) {
      if (skip?.(base + 0x3c0 + i)) continue;
      const got = read(base + 0x3c0 + i);
      if (got !== attr[i] && bad.length < limit) bad.push({ where: `nt${nt} attr(${i & 7},${i >> 3})`, addr: base + 0x3c0 + i, got, want: attr[i] });
    }
  }
  return bad;
}

/** The mirror aliases that must read identically: vertical $2800=$2000,$2C00=$2400; horizontal $2400=$2000,$2C00=$2800. */
export function aliasMismatches(read, ring) {
  const pairs = ring === 1 ? [[0x2800, 0x2000], [0x2c00, 0x2400]] : [[0x2400, 0x2000], [0x2c00, 0x2800]];
  const bad = [];
  for (const [alias, live] of pairs) for (let i = 0; i < 0x400; i++) if (read(alias + i) !== read(live + i)) { bad.push({ alias: alias + i, live: live + i }); break; }
  return bad;
}
