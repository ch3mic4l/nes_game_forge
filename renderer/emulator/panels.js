// Debugger panels: CPU registers, disassembly, memory, PPU viewers, and the
// switch/variable inspector.

import { el, clear, fill } from '../ui.js';
import { disassembleRange, alignBefore } from './disasm.js';
import { decodeTile } from '../../shared/chr.js';
import { NES_PALETTE } from '../../shared/nespalette.js';
import { inspectorProblem, switchBit, switchAddress, variableAddress, labelFor, clampByte } from '../../shared/switchvars.js';
import { toggleUnavailableReason } from '../../shared/testoverrides.js';

const hex2 = (value) => (value & 0xff).toString(16).padStart(2, '0').toUpperCase();
const hex4 = (value) => (value & 0xffff).toString(16).padStart(4, '0').toUpperCase();

const mono = { fontFamily: 'var(--mono)', fontSize: '11.5px', lineHeight: '1.5' };

// --------------------------------------------------------------- CPU panel

export function cpuPanel(emulator) {
  const body = el('div', { style: mono });

  function refresh() {
    const state = emulator.state();
    const flag = (name, on) =>
      el('span', { style: { color: on ? 'var(--accent)' : 'var(--text-faint)', marginRight: '5px' } }, on ? name : name.toLowerCase());

    fill(body,
      el(
        'div',
        { style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '2px 14px' } },
        reg('PC', hex4(state.pc)),
        reg('SP', `$${hex2(state.sp)}`),
        reg('A', `$${hex2(state.a)}`),
        reg('X', `$${hex2(state.x)}`),
        reg('Y', `$${hex2(state.y)}`),
        reg('Scanline', String(state.scanline))
      ),
      el(
        'div',
        { style: { marginTop: '8px' } },
        flag('N', state.flags.n),
        flag('V', state.flags.v),
        flag('D', state.flags.d),
        flag('I', state.flags.i),
        flag('Z', state.flags.z),
        flag('C', state.flags.c)
      ),
      el(
        'div.kv',
        { style: { marginTop: '8px' } },
        el('span', null, 'frames'),
        el('span', null, String(state.frames))
      ),
      el('div.kv', null, el('span', null, 'instructions'), el('span', null, state.instructions.toLocaleString()))
    );
  }

  const reg = (name, value) =>
    el(
      'div',
      { style: { display: 'flex', justifyContent: 'space-between' } },
      el('span', { style: { color: 'var(--text-faint)' } }, name),
      el('span', null, value)
    );

  refresh();
  return { node: body, refresh };
}

// ------------------------------------------------------------ disassembly

export function disassemblyPanel(emulator, labelsByAddress) {
  const body = el('div', { style: { ...mono, userSelect: 'text' } });
  let followPc = true;
  let anchor = null;

  const read = (address) => emulator.peek(address);

  function refresh() {
    const pc = emulator.pc;
    if (followPc) anchor = alignBefore(read, pc, 6);
    const rows = disassembleRange(read, anchor ?? pc, 26, labelsByAddress);

    clear(body);
    for (const row of rows) {
      const isCurrent = row.address === pc;
      const hasBreak = emulator.breakpoints.has(row.address);
      const label = labelsByAddress.get(row.address);
      if (label) {
        body.append(el('div', { style: { color: 'var(--blue)', marginTop: '4px' } }, `${label}:`));
      }
      body.append(
        el(
          'div',
          {
            style: {
              display: 'flex',
              gap: '8px',
              padding: '0 4px',
              cursor: 'pointer',
              borderRadius: '3px',
              background: isCurrent ? 'var(--accent-soft)' : null,
              color: isCurrent ? 'var(--accent)' : null
            },
            title: 'Click to toggle a breakpoint',
            onclick: () => {
              emulator.toggleBreakpoint(row.address);
              refresh();
            }
          },
          el(
            'span',
            { style: { width: '10px', color: 'var(--red)', flex: 'none' } },
            hasBreak ? '●' : ' '
          ),
          el('span', { style: { color: 'var(--text-faint)', flex: 'none' } }, hex4(row.address)),
          el(
            'span',
            { style: { color: 'var(--text-faint)', width: '62px', flex: 'none' } },
            row.bytes.map(hex2).join(' ')
          ),
          el('span', null, row.text)
        )
      );
    }
  }

  const node = el(
    'div',
    null,
    el(
      'div.field-row',
      { style: { marginBottom: '6px' } },
      el(
        'label.check',
        null,
        el('input', {
          type: 'checkbox',
          checked: followPc,
          onchange: (event) => {
            followPc = event.target.checked;
            refresh();
          }
        }),
        'Follow PC'
      ),
      el('span.spacer'),
      el(
        'button.btn.btn-sm',
        {
          onclick: () => {
            emulator.breakpoints.clear();
            refresh();
          }
        },
        'Clear breakpoints'
      )
    ),
    body
  );

  refresh();
  return { node, refresh };
}

// --------------------------------------------------------------- memory

const REGIONS = [
  { id: 'cpu', label: 'CPU bus', start: 0x0000, length: 0x10000 },
  { id: 'ram', label: 'RAM ($0000-$07FF)', start: 0x0000, length: 0x800 },
  { id: 'vram', label: 'PPU VRAM', start: 0x0000, length: 0x4000 },
  { id: 'oam', label: 'OAM (sprites)', start: 0x0000, length: 0x100 },
  { id: 'palette', label: 'Palette RAM', start: 0x3f00, length: 0x20 }
];

export function memoryPanel(emulator) {
  let region = REGIONS[1];
  let offset = region.start;
  const rowsShown = 16;
  const body = el('div', { style: { ...mono, userSelect: 'text' } });

  function readByte(address) {
    if (region.id === 'cpu' || region.id === 'ram') return emulator.peek(address);
    if (region.id === 'oam') return emulator.nes.ppu.spriteMem[address & 0xff];
    return emulator.nes.ppu.vramMem[address & 0x7fff];
  }

  function writeByte(address, value) {
    if (region.id === 'cpu' || region.id === 'ram') emulator.poke(address, value);
    else if (region.id === 'oam') emulator.nes.ppu.spriteMem[address & 0xff] = value & 0xff;
    else emulator.nes.ppu.vramMem[address & 0x7fff] = value & 0xff;
  }

  function refresh() {
    clear(body);
    for (let row = 0; row < rowsShown; row++) {
      const base = offset + row * 16;
      if (base >= region.start + region.length) break;
      const line = el('div', { style: { display: 'flex', gap: '8px' } });
      line.append(el('span', { style: { color: 'var(--text-faint)', flex: 'none' } }, hex4(base)));
      const bytes = [];
      for (let column = 0; column < 16; column++) {
        const address = base + column;
        const value = readByte(address);
        bytes.push(value);
        line.append(
          el(
            'span',
            {
              style: { cursor: 'text', color: value ? null : 'var(--text-faint)' },
              title: `$${hex4(address)} — click to edit`,
              onclick: (event) => editByte(event.target, address)
            },
            hex2(value)
          )
        );
      }
      line.append(
        el(
          'span',
          { style: { marginLeft: '6px', color: 'var(--text-faint)' } },
          bytes.map((value) => (value >= 32 && value < 127 ? String.fromCharCode(value) : '.')).join('')
        )
      );
      body.append(line);
    }
  }

  function editByte(span, address) {
    const input = el('input', {
      type: 'text',
      value: hex2(readByte(address)),
      maxLength: 2,
      style: { width: '22px', padding: '0 1px', fontFamily: 'var(--mono)', fontSize: '11.5px' },
      onblur: commit,
      onkeydown: (event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') refresh();
      }
    });
    function commit() {
      const value = parseInt(input.value, 16);
      if (Number.isFinite(value)) writeByte(address, value);
      refresh();
    }
    span.replaceWith(input);
    input.focus();
    input.select();
  }

  const addressInput = el('input', {
    type: 'text',
    value: hex4(offset),
    style: { width: '70px' },
    onchange: (event) => {
      const value = parseInt(event.target.value.replace(/^\$/, ''), 16);
      if (Number.isFinite(value)) offset = Math.max(region.start, value & 0xfff0);
      addressInput.value = hex4(offset);
      refresh();
    }
  });

  const node = el(
    'div',
    null,
    el(
      'div.field-row',
      { style: { marginBottom: '6px' } },
      el(
        'select',
        {
          onchange: (event) => {
            region = REGIONS.find((entry) => entry.id === event.target.value);
            offset = region.start;
            addressInput.value = hex4(offset);
            refresh();
          }
        },
        REGIONS.map((entry) => el('option', { value: entry.id, selected: entry === region }, entry.label))
      ),
      addressInput,
      el(
        'button.btn.btn-sm',
        {
          onclick: () => {
            offset = Math.max(region.start, offset - rowsShown * 16);
            addressInput.value = hex4(offset);
            refresh();
          }
        },
        '▲'
      ),
      el(
        'button.btn.btn-sm',
        {
          onclick: () => {
            offset = Math.min(region.start + region.length - rowsShown * 16, offset + rowsShown * 16);
            addressInput.value = hex4(offset);
            refresh();
          }
        },
        '▼'
      )
    ),
    body
  );

  refresh();
  return { node, refresh };
}

// ----------------------------------------------------------- PPU viewers

/** Raw palette index out of PPU palette RAM, honouring the backdrop mirrors. */
function paletteEntry(ppu, index) {
  let address = 0x3f00 + (index & 0x1f);
  if ((address & 0x13) === 0x10) address &= ~0x10; // $3F10/14/18/1C mirror $3F00/...
  return ppu.vramMem[address & 0x7fff] & 0x3f;
}

function tilePixels(ppu, table, index) {
  const base = table * 0x1000 + index * 16;
  return decodeTile(ppu.vramMem, base);
}

export function ppuPanel(emulator) {
  const nametableCanvas = el('canvas.pixels', {
    width: 512,
    height: 480,
    style: { width: '384px', height: '360px', border: '1px solid var(--line)' }
  });
  const patternCanvas = el('canvas.pixels', {
    width: 256,
    height: 128,
    style: { width: '384px', height: '192px', border: '1px solid var(--line)' }
  });
  const paletteHost = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(16, 1fr)', gap: '2px' } });
  const oamBody = el('div', { style: { ...mono, maxHeight: '150px', overflowY: 'auto', userSelect: 'text' } });
  let patternPalette = 0;
  let showAttributes = false;

  function drawNametables() {
    const ppu = emulator.nes.ppu;
    const context = nametableCanvas.getContext('2d');
    const image = context.createImageData(512, 480);
    const data = image.data;
    const bgTable = (ppu.regS ?? 0) & 1; // $2000 bit 4 selects the background table

    for (let nametable = 0; nametable < 4; nametable++) {
      const base = 0x2000 + nametable * 0x400;
      const originX = (nametable % 2) * 256;
      const originY = Math.floor(nametable / 2) * 240;
      for (let row = 0; row < 30; row++) {
        for (let column = 0; column < 32; column++) {
          const tileIndex = ppu.vramMem[base + row * 32 + column];
          const attribute = ppu.vramMem[base + 0x3c0 + (row >> 2) * 8 + (column >> 2)];
          const shift = ((row & 2) << 1) | (column & 2);
          const paletteSlot = (attribute >> shift) & 3;
          const pixels = tilePixels(ppu, bgTable, tileIndex);
          for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
              const slot = pixels[y * 8 + x];
              const color = NES_PALETTE[paletteEntry(ppu, slot === 0 ? 0 : paletteSlot * 4 + slot)];
              const px = originX + column * 8 + x;
              const py = originY + row * 8 + y;
              const target = (py * 512 + px) * 4;
              data[target] = color[0];
              data[target + 1] = color[1];
              data[target + 2] = color[2];
              data[target + 3] = 255;
            }
          }
        }
      }
    }
    context.putImageData(image, 0, 0);

    if (showAttributes) {
      context.strokeStyle = 'rgba(255,157,60,0.45)';
      context.lineWidth = 1;
      context.beginPath();
      for (let x = 0; x <= 512; x += 32) {
        context.moveTo(x + 0.5, 0);
        context.lineTo(x + 0.5, 480);
      }
      for (let y = 0; y <= 480; y += 32) {
        context.moveTo(0, y + 0.5);
        context.lineTo(512, y + 0.5);
      }
      context.stroke();
    }
    // Nametable boundaries.
    context.strokeStyle = 'rgba(77,163,255,0.8)';
    context.lineWidth = 2;
    context.strokeRect(0, 0, 512, 480);
    context.beginPath();
    context.moveTo(256, 0);
    context.lineTo(256, 480);
    context.moveTo(0, 240);
    context.lineTo(512, 240);
    context.stroke();
  }

  function drawPatternTables() {
    const ppu = emulator.nes.ppu;
    const context = patternCanvas.getContext('2d');
    const image = context.createImageData(256, 128);
    const data = image.data;
    for (let table = 0; table < 2; table++) {
      for (let index = 0; index < 256; index++) {
        const pixels = tilePixels(ppu, table, index);
        const originX = table * 128 + (index % 16) * 8;
        const originY = Math.floor(index / 16) * 8;
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const slot = pixels[y * 8 + x];
            const color = NES_PALETTE[paletteEntry(ppu, slot === 0 ? 0 : patternPalette * 4 + slot)];
            const target = ((originY + y) * 256 + originX + x) * 4;
            data[target] = color[0];
            data[target + 1] = color[1];
            data[target + 2] = color[2];
            data[target + 3] = 255;
          }
        }
      }
    }
    context.putImageData(image, 0, 0);
  }

  function drawPalettes() {
    const ppu = emulator.nes.ppu;
    clear(paletteHost);
    for (let index = 0; index < 32; index++) {
      const value = paletteEntry(ppu, index);
      const [r, g, b] = NES_PALETTE[value];
      paletteHost.append(
        el('div', {
          style: {
            background: `rgb(${r},${g},${b})`,
            aspectRatio: '1',
            borderRadius: '2px',
            border: index % 4 === 0 ? '1px solid var(--text-faint)' : '1px solid transparent'
          },
          title: `${index < 16 ? 'Background' : 'Sprite'} palette ${Math.floor((index % 16) / 4)}, slot ${
            index % 4
          } — $${hex2(value)}`
        })
      );
    }
  }

  function drawOam() {
    const ppu = emulator.nes.ppu;
    clear(oamBody);
    let visible = 0;
    for (let index = 0; index < 64; index++) {
      const y = ppu.spriteMem[index * 4];
      const tile = ppu.spriteMem[index * 4 + 1];
      const attributes = ppu.spriteMem[index * 4 + 2];
      const x = ppu.spriteMem[index * 4 + 3];
      if (y >= 0xef) continue; // parked off-screen
      visible++;
      oamBody.append(
        el(
          'div',
          { style: { display: 'flex', gap: '10px' } },
          el('span', { style: { color: 'var(--text-faint)', width: '20px' } }, String(index)),
          el('span', null, `x${String(x).padStart(3)} y${String(y).padStart(3)}`),
          el('span', null, `tile $${hex2(tile)}`),
          el('span', { style: { color: 'var(--text-faint)' } }, `pal ${attributes & 3}${attributes & 0x40 ? ' H' : ''}${attributes & 0x80 ? ' V' : ''}${attributes & 0x20 ? ' behind' : ''}`)
        )
      );
    }
    if (!visible) oamBody.append(el('div', { style: { color: 'var(--text-faint)' } }, 'No sprites on screen.'));
  }

  function refresh() {
    drawNametables();
    drawPatternTables();
    drawPalettes();
    drawOam();
  }

  const node = el(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
    el(
      'div',
      null,
      el(
        'div.field-row',
        { style: { marginBottom: '4px' } },
        el('span.field-label', null, 'Nametables'),
        el('span.spacer'),
        el(
          'label.check',
          null,
          el('input', {
            type: 'checkbox',
            onchange: (event) => {
              showAttributes = event.target.checked;
              drawNametables();
            }
          }),
          'Attribute grid'
        )
      ),
      nametableCanvas
    ),
    el(
      'div',
      null,
      el(
        'div.field-row',
        { style: { marginBottom: '4px' } },
        el('span.field-label', null, 'Pattern tables'),
        el('span.spacer'),
        el(
          'select',
          {
            style: { width: 'auto' },
            onchange: (event) => {
              patternPalette = Number(event.target.value);
              drawPatternTables();
            }
          },
          [0, 1, 2, 3, 4, 5, 6, 7].map((index) =>
            el('option', { value: index }, `${index < 4 ? 'BG' : 'SPR'} palette ${index % 4}`)
          )
        )
      ),
      patternCanvas
    ),
    el('div', null, el('div.field-label', { style: { marginBottom: '4px' } }, 'Palette RAM'), paletteHost),
    el('div', null, el('div.field-label', { style: { marginBottom: '4px' } }, 'Sprites on screen'), oamBody)
  );

  refresh();
  return { node, refresh };
}

// -------------------------------------------------- switches and variables

/**
 * A labelled view of the engine's 64 switches and its variables -- the same
 * bytes the Memory tab already shows as unlabelled hex, read and poked the
 * same way (`emulator.peek`/`emulator.poke`), so this replaces nothing the
 * Memory tab could do and only makes it readable. Editing here is a debug
 * poke exactly like the Memory tab's click-to-edit byte, never anything the
 * built ROM knows about: a reset restores whatever the game itself set.
 *
 * @param {import('./runcontrol.js').Emulator} emulator
 * @param {{ram: object|null, numVariables: number|null, switchNames?: string[], variableNames?: string[]}} build
 *   `ram` is the build's own constants.asm, parsed; `numVariables` is
 *   NUM_VARIABLES out of its config.inc. Both travel with the build rather
 *   than a remembered constant, so a Code Forge override or a changed
 *   `RPG_LIMITS.variables` is read correctly rather than guessed at.
 */
export function switchesPanel(emulator, { ram, numVariables, switchNames = [], variableNames = [] }) {
  const problem = inspectorProblem({ ram, numVariables });
  const body = el('div', { style: mono });
  const node = el('div', null, body);

  // The row DOM is built exactly once, the first time refresh() finds the
  // panel actually attached (see refresh() below). Every refresh after that
  // updates each row's existing input in place rather than rebuilding it --
  // the same defect class ROADMAP item 11 fixed for the Sprite Forge's
  // preview loop: a periodic rebuild tears down whatever the user is
  // currently focused in, and a variable input that loses focus mid-edit
  // loses the edit before it ever reaches RAM.
  let built = false;
  const switches = []; // { input, address, mask }, by switch index
  const variables = []; // { input, address }, by variable index

  function switchRow(index) {
    const { mask } = switchBit(index);
    const address = switchAddress(ram, index);
    const input = el('input', {
      type: 'checkbox',
      checked: (emulator.peek(address) & mask) !== 0,
      onchange: (event) => {
        const current = emulator.peek(address);
        emulator.poke(address, event.target.checked ? current | mask : current & ~mask);
      }
    });
    switches[index] = { input, address, mask };
    return el(
      'label.check',
      { dataset: { switch: index }, style: { padding: '2px 0' } },
      input,
      labelFor(switchNames, index, 'Switch')
    );
  }

  function variableRow(index) {
    const address = variableAddress(ram, index);
    const input = el('input', {
      type: 'number',
      min: 0,
      max: 255,
      value: emulator.peek(address),
      style: { width: '58px' },
      title: 'Poked directly into RAM, like the Memory tab -- a reset restores whatever the game itself set',
      onchange: (event) => {
        const next = clampByte(event.target.value);
        emulator.poke(address, next);
        event.target.value = next;
      }
    });
    variables[index] = { input, address };
    return el(
      'div.field-row',
      { dataset: { variable: index }, style: { padding: '2px 0' } },
      el('span', { style: { flex: '1' } }, labelFor(variableNames, index, 'Variable')),
      input
    );
  }

  function build() {
    if (problem) {
      fill(body, el('p.hint', { style: { color: 'var(--red)' } }, problem));
      built = true; // nothing will ever make this build readable, so stop rebuilding it every refresh
      return;
    }
    fill(body,
      el(
        'p.hint',
        { style: { marginBottom: '8px' } },
        'Poked directly into RAM, exactly like the Memory tab — a reset restores whatever the game itself set.'
      ),
      el('div.panel-head', { style: { paddingLeft: '0' } }, `Switches (${ram.NUM_SWITCHES})`),
      Array.from({ length: ram.NUM_SWITCHES }, (_, index) => switchRow(index)),
      el('div.panel-head', { style: { paddingLeft: '0', marginTop: '10px' } }, `Variables (${numVariables})`),
      Array.from({ length: numVariables }, (_, index) => variableRow(index))
    );
    built = true;
  }

  // Values only -- no DOM created or destroyed, so a focused input is left
  // alone entirely rather than merely restored after the fact.
  function updateValues() {
    if (problem) return;
    for (const { input, address, mask } of switches) input.checked = (emulator.peek(address) & mask) !== 0;
    for (const { input, address } of variables) {
      if (document.activeElement === input) continue; // mid-edit -- do not clobber
      input.value = emulator.peek(address);
    }
  }

  function refresh() {
    if (!node.isConnected) return;
    if (!built) build();
    else updateValues();
  }

  return { node, refresh };
}

// ------------------------------------------------------------- test overrides

export const TOGGLE_COPY = {
  invincibility: {
    label: 'Invincibility',
    on: (battleEnabled) =>
      battleEnabled
        ? 'Invincible to floor hazards only — battle damage is not affected.'
        : 'Invincible — no contact or floor damage.'
  },
  collision: {
    label: 'Collision off',
    on: () =>
      'Terrain does not block the player or any moving actor — patrols, chasers and scripted Move walk ' +
      'through walls and water. Screen transitions and map boundaries are unchanged, damage tiles still ' +
      'hurt, and door triggers still fire: none of those were ever gated by this collision check.'
  },
  encounters: {
    label: 'Encounters off',
    on: () => 'Wandering encounters off — placed monsters still trigger a fight on contact.'
  }
};

/**
 * The invincibility / encounters-off / collision-off toggles (ROADMAP item 3).
 * All three are debugger-side intercepts armed by `emulator.configureTestOverrides`
 * when the build was loaded (`shared/testoverrides.js`) -- this panel only ever
 * flips `emulator.setTestOverrides`, the same "poke, never the ROM" honesty rule
 * the switch/variable inspector above already holds: a reset restores whatever
 * the game itself set, and the toggle itself survives the reset exactly like a
 * breakpoint does, staying visible on screen so nothing is silently active.
 *
 * @param {import('./runcontrol.js').Emulator} emulator
 * @param {{ram: object|null, symbols: object, battleEnabled: boolean}} build
 *   `battleEnabled` is generated `BATTLE_ENABLED` out of the build's own
 *   `config.inc` -- the single source for "is this an RPG-battle build," kept
 *   separate from whether `check_encounter` merely happens to exist in the
 *   symbol table (a Code Forge override can remove or rename it either way).
 * @param {(name: string, checked: boolean) => void} [onChange] echoed into the
 *   session's remembered test scenario (ROADMAP item 3's "Reload the ROM"
 *   bullet) when this session is scenario-bound -- only ever passed then, so
 *   an ordinary session's own checkbox has nowhere to write.
 */
export function togglesPanel(emulator, { ram, symbols, battleEnabled, onChange }) {
  const body = el('div', { style: mono });
  const node = el('div', null, body);
  const rows = {}; // name -> input

  const reasonFor = (name) => toggleUnavailableReason(name, { ram, symbols, battleEnabled });

  function toggleRow(name) {
    const reason = reasonFor(name);
    const copy = TOGGLE_COPY[name];
    const input = el('input', {
      type: 'checkbox',
      disabled: Boolean(reason),
      checked: emulator.testOverrides[name] && !reason,
      onchange: (event) => {
        emulator.setTestOverrides({ [name]: event.target.checked });
        onChange?.(name, event.target.checked);
      }
    });
    rows[name] = input;
    return el(
      'div',
      { dataset: { toggle: name }, style: { padding: '4px 0' } },
      el('label.check', null, input, copy.label),
      el('p.hint', { style: { margin: '2px 0 0 20px' } }, reason ? `Unavailable: ${reason}.` : copy.on(battleEnabled))
    );
  }

  function build() {
    fill(
      body,
      el(
        'p.hint',
        { style: { marginBottom: '8px' } },
        'Debugger-only; the ROM is never modified. A reset restores whatever the game itself set, but ' +
          'the toggle itself stays on, the same as a breakpoint would.'
      ),
      ...Object.keys(TOGGLE_COPY).map(toggleRow)
    );
  }

  function refresh() {
    if (!node.isConnected) return;
    for (const [name, input] of Object.entries(rows)) {
      const reason = reasonFor(name);
      input.disabled = Boolean(reason);
      input.checked = emulator.testOverrides[name] && !reason;
    }
  }

  build();
  return { node, refresh };
}
