#!/usr/bin/env node
// Builds the ROM and the generated sw_close_deadline.lua (the three-producer, 88-byte close frame) runs against, into a temp
// directory, never touching a checked-in fixture. See sw_close_deadline.lua.template's header for what the check asserts.
//
//   node test/lua/build_sw_close_deadline_roms.mjs [outDir] [--placement=resident|banked] [--break=no-flash|slow-drain]
//
// --break builds a negative control the check must FAIL: no-flash never arms Flash (the workload check, exit 7, because vram_len is 52,
// not 87); slow-drain overrides engine/text.asm so vram_drain wastes 16 cycles a byte, which pushes the 88-byte frame past vblank (exit 5).
//
// resident: createStreamedProject-based (the dialogue code stays in kernel-hi). banked: the committed-inventory project, whose
// dialogue code relocates into the battle bank (the build asserts which placement it got). Writes <outDir>/sw_close_deadline.nes and
// <outDir>/sw_close_deadline.lua. flash_left is a computed equate shared/enginesyms.js cannot resolve, so it is measured the way
// build_bound_tile_nmi_roms.mjs does: a Code Forge file emits `.db flash_left`, and the byte is read back out of the booted ROM.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { parseSymbolFile } from '../../main/build/symbols.js';
import { Emulator } from '../../renderer/emulator/runcontrol.js';
import { resolveMapper } from '../../shared/cartridge.js';
import { streamworldDialogueBanked } from '../../main/build/generate.js';
import { buildCloseDeadlineProject, buildCloseDeadlineBanked } from '../lib/closedeadline.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATE_PATH = path.join(ROOT, 'test/lua/sw_close_deadline.lua.template');
const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith('--')) ?? '/tmp/nesforge-sw-close-deadline-roms';
const placement = (args.find((a) => a.startsWith('--placement=')) ?? '--placement=resident').split('=')[1];
if (!['resident', 'banked'].includes(placement)) throw new Error(`unknown placement ${placement}`);
const brk = (args.find((a) => a.startsWith('--break=')) ?? '--break=').split('=')[1];
if (!['', 'no-flash', 'slow-drain'].includes(brk)) throw new Error(`unknown --break ${brk}`);

const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-swclosedl-'));
try {
  const project = placement === 'banked' ? buildCloseDeadlineBanked() : buildCloseDeadlineProject();
  const banked = streamworldDialogueBanked(project, resolveMapper(30));
  if (banked !== (placement === 'banked')) throw new Error(`the ${placement} fixture came out ${banked ? 'banked' : 'resident'}`);
  const overrides = [];
  if (brk === 'slow-drain') {
    const text = await fs.promises.readFile(path.join(ROOT, 'engine/text.asm'), 'utf8');
    const needle = 'vram_drain_byte:\n  lda vram_buf,x\n  sta $2007\n';
    if (text.split(needle).length - 1 !== 1) throw new Error('slow-drain: the vram_drain byte loop moved');
    overrides.push({ name: 'text.asm', text: text.replace(needle, needle + '  nop\n'.repeat(8)) });
  }
  project.code = { overrides, files: [{ name: 'flash_left_probe.asm', text: 'flash_left_probe:\n  .db flash_left\n' }] };
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const symbols = parseSymbolFile(await fs.promises.readFile(built.symbolPath, 'utf8'));
  for (const name of ['nmi', 'nmi_rti', 'main_loop_ready', 'flip_tick', 'flash_left_probe']) {
    if (!Number.isFinite(symbols[name])) throw new Error(`${name} was not a named symbol in game.fns`);
  }
  const emulator = new Emulator({ onFrame: () => {} });
  emulator.loadROM(new Uint8Array(await fs.promises.readFile(built.romPath)));
  const flashLeft = emulator.peek(symbols.flash_left_probe);
  if (!Number.isFinite(flashLeft) || flashLeft === 0) throw new Error(`flash_left_probe read back as ${flashLeft}`);
  await fs.promises.mkdir(outDir, { recursive: true });
  const romPath = path.join(outDir, 'sw_close_deadline.nes');
  await fs.promises.copyFile(built.romPath, romPath);
  const hex = (n) => `0x${n.toString(16)}`;
  const substitutions = {
    __NMI__: hex(symbols.nmi),
    __NMI_RTI__: hex(symbols.nmi_rti),
    __MAIN_LOOP_READY__: hex(symbols.main_loop_ready),
    __FLIP_TICK__: hex(symbols.flip_tick),
    __FLASH_LEFT__: hex(flashLeft),
    __PLACEMENT__: placement,
    __BREAK__: brk
  };
  let generated = await fs.promises.readFile(TEMPLATE_PATH, 'utf8');
  for (const [token, value] of Object.entries(substitutions)) {
    if (generated.split(token).length - 1 !== 1) throw new Error(`expected exactly one ${token} in the template`);
    generated = generated.split(token).join(value);
  }
  const luaPath = path.join(outDir, 'sw_close_deadline.lua');
  await fs.promises.writeFile(luaPath, generated, 'utf8');
  console.log(`rom: ${romPath}\nlua: ${luaPath}\nplacement: ${placement}`);
} finally {
  await fs.promises.rm(dir, { recursive: true, force: true });
}
