#!/usr/bin/env node
// Builds the ROM and the generated equip_nmi_timing.lua that test/lua/equip_nmi_timing.lua.template describes (docs/design-equipment.md
// section 10 row 15; obligation F8 (b) and (c)): a sample-rpg with four wearable pieces, `equip` bound to Select, on one board, in one of
// three workload shapes.
//
//   node test/lua/build_equip_nmi_roms.mjs <outDir> --mode=equip|flash|flipeq|flip [--board=1|4|30] [--control=rows|nodefer|norestore|wrongfont] [--regcheck] [--streamed]
//
//   --mode=equip   one Equip row in the frame                                     (vram_len 33)
//   --mode=flash   a Flash on-edge shares the frame with the Equip row            (68)
//   --mode=flipeq  a bound-tile flip shares the frame with the Equip row          (43)
//   --mode=flip    a bound-tile flip and a Flash edge: the frame already holds 45 bytes, so the Equip row waits a frame (E12)
//   --control=rows the engine's Equip tick is replaced by one that publishes every dirty row in the same frame (a Code Forge override of
//                  engine/battle.asm, built in the temp directory: the repository is never touched); the generated script skips the
//                  workload-shape check, so the verdict that flips is the rti-before-scanline-257 judge alone
//   --control=nodefer   the Equip tick without E12's deferral: it publishes its row into the flip + Flash frame (the C4 code before this fix)
//   --control=wrongfont the split handler switches R1 to page 0 instead of the font page (review R2 of C4's override)
//   --regcheck     observe the MMC3 register file (R0-R7 through what they map), split_lock and the split at every frame boundary
//
// Writes <outDir>/equip_nmi.nes and <outDir>/equip_nmi_timing.lua. flash_left is a computed equate (`fade_reload+1`) that
// shared/enginesyms.js cannot resolve, so it is measured exactly as build_flash_nmi_roms.mjs does it: a Code Forge file emits `.db flash_left`
// and the byte is read back out of the ROM. The fixtures sample/ and sample-rpg/ are only read.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { parseSymbolFile } from '../../main/build/symbols.js';
import { Emulator } from '../../renderer/emulator/runcontrol.js';
import { gearProject, gearStreamedProject, withEngineEdit } from '../lib/equipscreen.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATE_PATH = path.join(ROOT, 'test/lua/equip_nmi_timing.lua.template');

const args = process.argv.slice(2);
const flag = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const outDir = args.find((a) => !a.startsWith('--')) ?? '/tmp/nesforge-equip-nmi-roms';
const mode = flag('mode', 'equip');
const board = Number(flag('board', '4'));
const control = flag('control', 'none');
const regcheck = args.includes('--regcheck');
const streamed = args.includes('--streamed'); // a streamed world (board 1 or 30): the screen's own bank differs from the battle bank, and the close rows exist
if (!['equip', 'flash', 'flipeq', 'flip'].includes(mode)) throw new Error(`--mode must be equip, flash or flip, not ${mode}`);
if (!['none', 'rows', 'nodefer', 'norestore', 'wrongfont'].includes(control)) throw new Error(`--control must be none, rows, nodefer, norestore or wrongfont, not ${control}`);

const EXPECT_LEN = { equip: 33, flash: 68, flipeq: 43, flip: 45 };
// eq_flush's E12 deferral, as engine/battle.asm spells it: the controls that must publish regardless remove exactly these lines.
const DEFERRAL = '  ldx <vram_len\n  cpx #EQ_QUEUE_MAX+1\n  bcs eq_fl_done              ; the frame already carries a flip and Flash: the row stays dirty and goes out next frame (E12)\n';

async function main() {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-equip-nmi-'));
  try {
    const project = streamed ? gearStreamedProject({ mapper: board }) : await gearProject({ mapper: board });
    // Flash and the bound-tile cache have to be assembled into the ROM for the poked producers to exist.
    const npcId = project.sprites.actors.length;
    project.sprites.actors.push({ name: 'Sayer', behavior: 'npc', hp: 1, damage: 0 });
    const commands = [{ op: 'flash' }];
    if (mode === 'flip' || mode === 'flipeq') {
      project.metatiles[1].tiles = [5, 6, 7, 8];
      project.metatiles[1].palette = project.metatiles[0].palette;
      project.maps[0].screens[0].metatiles = new Array(240).fill(0); // one palette group, so the substitute below matches it
      project.maps[0].screens[0].boundTiles = [{ switchId: 5, row: 0, col: 0, metatileId: 1 }];
      commands.unshift({ op: 'setSwitch', switch: 5 });
    }
    {
      // An entry event (it runs once, as the screen is drawn at boot), far from the party's start: it sets the switch for real and carries the
      // Flash command, so FLASH_ENABLED / BOUND_TILE_ENABLED are genuinely on. The timing-critical frame is armed by the Lua script's pokes.
      project.maps[0].screens[0].entities.push({
        actorId: npcId,
        x: 200,
        y: 40,
        props: { trigger: 'enter', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } }
      });
    }
    if (control === 'rows') {
      // Every dirty row in one frame: eq_slots calls eq_flush seven times (one per Equip row) instead of once. With the flip's and Flash's packets
      // already queued, seven rows would overrun vram_buf (10 + 35 + 7 * 33 > 256), so that mode's control publishes four.
      const rows = mode === 'flip' || mode === 'flipeq' ? 4 : 7;
      withEngineEdit(project, 'battle.asm', [[DEFERRAL, ''], ['eq_slots:\n  jsr eq_flush\n', `eq_slots:\n${'  jsr eq_flush\n'.repeat(rows)}`]]);
    }
    if (control === 'nodefer') withEngineEdit(project, 'battle.asm', [[DEFERRAL, '']]);
    if (control === 'wrongfont') {
      // Only the font page is wrong: the IRQ still fires on the right scanline, once a frame, and selects R1 -- onto page 0.
      withEngineEdit(project, 'split.asm', [['  lda #FONT_R1\n  jmp irq_switch', '  lda #0\n  jmp irq_switch']]);
    }
    if (control === 'norestore') {
      // The lost-restore control: battle_end no longer redraws the field screen, so the leaving Equip frame keeps the battle tileset's CHR
      // registers, the font split and the Equip nametable. The register check after leaving must flip.
      withEngineEdit(project, 'rpg.asm', [['  jsr redraw_screen\n  lda #NO_ENTITY\n  sta <pending_ent\n  ldx <bt_from_ent', '  lda #NO_ENTITY\n  sta <pending_ent\n  ldx <bt_from_ent']]);
    }
    project.code = { ...(project.code ?? {}), overrides: project.code?.overrides ?? [], files: [{ name: 'flash_left_probe.asm', text: 'flash_left_probe:\n  .db flash_left\n' }] };
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });

    const symbols = parseSymbolFile(await fs.promises.readFile(built.symbolPath, 'utf8'));
    for (const name of ['nmi_rti', 'main_loop_ready', 'flash_tick', 'equip_dispatch', 'flash_left_probe', ...(mode === 'flip' ? ['flip_tick'] : [])]) {
      if (!Number.isFinite(symbols[name])) throw new Error(`${name} was not a named symbol in game.fns${name === 'flip_tick' ? ' (is BOUND_TILE_ENABLED on? --mode=flip builds a bound tile)' : ''}`);
    }
    if (mode !== 'flip' && symbols.flip_tick === undefined) symbols.flip_tick = symbols.nmi_rti; // never reached: the callback is mode-gated
    const emulator = new Emulator({ onFrame: () => {} });
    emulator.loadROM(new Uint8Array(await fs.promises.readFile(built.romPath)));
    const flashLeft = emulator.peek(symbols.flash_left_probe);
    if (!Number.isFinite(flashLeft) || flashLeft === 0) throw new Error(`flash_left_probe read back as ${flashLeft}`);

    await fs.promises.mkdir(outDir, { recursive: true });
    await fs.promises.copyFile(built.romPath, path.join(outDir, 'equip_nmi.nes'));
    const configInc = fs.readFileSync(path.join(dir, 'build', 'assets', 'config.inc'), 'utf8');
    const config = (name) => {
      const match = configInc.match(new RegExp(`^${name}\\s*=\\s*(\\d+)`, 'm'));
      if (!match) throw new Error(`${name} is not a plain number in config.inc`);
      return match[1];
    };
    const substitutions = {
      __NMI_RTI__: `0x${symbols.nmi_rti.toString(16)}`,
      __MAIN_LOOP_READY__: `0x${symbols.main_loop_ready.toString(16)}`,
      __FLASH_TICK__: `0x${symbols.flash_tick.toString(16)}`,
      __FLIP_TICK__: `0x${symbols.flip_tick.toString(16)}`,
      __EQUIP_DISPATCH__: `0x${symbols.equip_dispatch.toString(16)}`,
      __IRQ__: `0x${(symbols.irq ?? symbols.nmi_rti).toString(16)}`,
      __IRQ_DONE__: `0x${(symbols.irq_done ?? symbols.nmi_rti).toString(16)}`,
      __FLASH_LEFT__: `0x${flashLeft.toString(16)}`,
      __MODE__: mode,
      __STRICT__: control === 'rows' || control === 'nodefer' ? '0' : '1',
      __REGCHECK__: regcheck ? '1' : '0',
      __EXPECT_LEN__: String(EXPECT_LEN[mode]),
      __BATTLE_TILESET__: config('BATTLE_TILESET'),
      __FONT_R1__: config('FONT_R1')
    };
    let generated = await fs.promises.readFile(TEMPLATE_PATH, 'utf8');
    for (const [token, value] of Object.entries(substitutions)) {
      const occurrences = generated.split(token).length - 1;
      if (occurrences !== 1) throw new Error(`expected exactly one occurrence of ${token} in the template, found ${occurrences}`);
      generated = generated.split(token).join(value);
    }
    await fs.promises.writeFile(path.join(outDir, 'equip_nmi_timing.lua'), generated, 'utf8');
    console.log(`rom: ${path.join(outDir, 'equip_nmi.nes')}  mode=${mode} board=${board} control=${control} regcheck=${regcheck}`);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

main();
