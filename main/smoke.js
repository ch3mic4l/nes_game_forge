// Headless-ish integration check: boots the real window, drives the renderer
// through a scripted scenario, and fails on any console error or uncaught
// exception. Run with `npm run smoke`.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unsavedChanges } from './ipc.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const scenario = (dir, sampleDir) => `
(async () => {
  const report = { steps: [] };
  const step = (name, detail) => report.steps.push({ name, detail });
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  /**
   * Wait for a condition rather than for a guessed number of milliseconds. A
   * fixed sleep is a bet on how fast a machine under load answers an IPC, and
   * losing that bet reads as a broken feature rather than as a slow reply.
   */
  const until = async (what, condition, ms = 4000) => {
    for (let waited = 0; waited < ms; waited += 25) {
      if (condition()) return;
      await wait(25);
    }
    throw new Error('timed out waiting for ' + what);
  };

  const created = await window.forge.project.create({ dir: ${JSON.stringify(dir)}, name: 'Smoke Game' });
  if (!created.ok) throw new Error('create: ' + created.error);
  step('create project', created.value.project.project.name);

  window.__app.store.open(created.value.dir, created.value.project);
  await wait(250);

  const stage = document.querySelector('#stage');
  if (!stage.querySelector('canvas.sheet')) throw new Error('Tile Forge sheet canvas did not render');
  step('tile forge mounted', stage.querySelectorAll('canvas').length + ' canvases');

  const swatches = stage.querySelectorAll('.swatch').length;
  if (swatches !== 16) throw new Error('expected 16 palette swatches, saw ' + swatches);
  const chips = stage.querySelectorAll('.color-chip').length;
  if (chips !== 64) throw new Error('expected 64 colour chips, saw ' + chips);
  step('palette rendered', swatches + ' swatches, ' + chips + ' chips');

  // Draw into tile 0 through the store the same way the pencil tool does.
  const store = window.__app.store;
  store.commit('smoke draw', (project) => {
    project.tilesets[0].background.tiles[0] = '3'.repeat(8) + '0'.repeat(56);
  });
  await wait(120);
  if (!store.dirty) throw new Error('store did not mark itself dirty after an edit');
  step('edit applied', store.project.tilesets[0].background.tiles[0].slice(0, 8));

  const undone = store.undo();
  if (!undone) throw new Error('undo returned false');
  if (store.project.tilesets[0].background.tiles[0] !== '0'.repeat(64)) throw new Error('undo did not restore the tile');
  store.redo();
  if (store.project.tilesets[0].background.tiles[0].slice(0, 8) !== '33333333') throw new Error('redo did not reapply the tile');
  step('undo/redo', 'ok');

  const saved = await window.forge.project.save(store.dir, store.project);
  if (!saved.ok) throw new Error('save: ' + saved.error);
  const reopened = await window.forge.project.open(store.dir);
  if (!reopened.ok) throw new Error('reopen: ' + reopened.error);
  if (reopened.value.project.tilesets[0].background.tiles[0].slice(0, 8) !== '33333333') {
    throw new Error('tile did not survive the save/load round trip');
  }
  if (JSON.stringify(reopened.value.project) !== JSON.stringify(store.project)) {
    throw new Error('project did not round-trip byte for byte through disk');
  }
  step('save/load round trip', 'identical');

  // Visit every Forge so a syntax error in any module is caught here.
  for (const id of ['sprite', 'map', 'sound', 'controller', 'code', 'build', 'tutorial', 'tile']) {
    window.__app.goTo(id);
    await wait(140);
    if (!document.querySelector('#stage').children.length) throw new Error(id + ' forge mounted nothing');
  }
  step('all forges mount', 'ok');

  // --- Map Forge ---------------------------------------------------------
  window.__app.goTo('map');
  await wait(300);
  const mapStage = document.querySelector('#stage');
  const canvases = mapStage.querySelectorAll('canvas');
  if (canvases.length < 4) throw new Error('Map Forge rendered only ' + canvases.length + ' canvases');
  // The zoom is "Fit" by default, so the size depends on the window; what has to
  // hold is that a screen is drawn at some whole multiple of one nametable.
  const screenCanvas = [...canvases].find(
    (c) => c.width % 256 === 0 && c.width >= 256 && c.height === (c.width / 256) * 240
  );
  if (!screenCanvas) {
    throw new Error(
      'no screen canvas at a whole 256x240 zoom, saw ' + [...canvases].map((c) => c.width + 'x' + c.height).join(' ')
    );
  }
  step('map forge mounted', canvases.length + ' canvases, screen at ' + screenCanvas.width / 256 + 'x');

  store.commit('smoke metatile', (project) => {
    project.metatiles[1].tiles = [1, 1, 1, 1];
    project.metatiles[1].collision = 'solid';
    project.metatiles[1].palette = 2;
  });
  await wait(200);
  store.commit('smoke paint', (project) => {
    const screen = project.maps[0].screens[0];
    for (let col = 0; col < 16; col++) screen.metatiles[14 * 16 + col] = 1;
  });
  await wait(200);
  if (store.project.maps[0].screens[0].metatiles[14 * 16] !== 1) throw new Error('painting did not stick');
  step('metatile edit + paint', 'bottom row solid');

  store.commit('smoke resize', (project) => {
    const map = project.maps[0];
    map.gridW = 2;
    map.gridH = 2;
    while (map.screens.length < 4) {
      map.screens.push({ metatiles: new Array(240).fill(0), entities: [] });
    }
  });
  await wait(250);
  if (store.project.maps[0].screens.length !== 4) throw new Error('map resize failed');
  const thumbs = [...document.querySelectorAll('#stage canvas')].filter((c) => c.width === 64 && c.height === 60);
  if (thumbs.length !== 4) throw new Error('navigator shows ' + thumbs.length + ' thumbnails, expected 4');
  step('multi-screen map', thumbs.length + ' screens in navigator');

  const roundTrip = await window.forge.project.save(store.dir, store.project);
  if (!roundTrip.ok) throw new Error('save after map edits: ' + roundTrip.error);
  const reloaded = await window.forge.project.open(store.dir);
  if (JSON.stringify(reloaded.value.project.maps) !== JSON.stringify(store.project.maps)) {
    throw new Error('maps did not survive the disk round trip');
  }
  step('map round trip', 'identical');

  // --- mapper selection and the tileset list -----------------------------
  window.__app.goTo('tile');
  await wait(250);
  const tilesetRows = () => [...document.querySelectorAll('#stage .tileset-row')];
  const addButton = () =>
    [...document.querySelectorAll('#stage button')].find((b) => b.textContent.includes('+ Add'));
  if (tilesetRows().length !== 1) throw new Error('expected one tileset row on NROM, saw ' + tilesetRows().length);
  if (!addButton()) throw new Error('the Tile Forge has no Add tileset button');
  if (!addButton().disabled) throw new Error('Add must be disabled on NROM, which holds one tileset');
  step('tileset list on NROM', '1 row, Add disabled');

  // Switching the mapper is what makes more tilesets legal.
  store.commit('smoke mapper', (project) => {
    project.cartridge.mapper = 3;
  });
  window.__app.goTo('tile');
  await wait(250);
  if (addButton().disabled) throw new Error('Add should be enabled on CNROM');
  step('mapper change enables Add', 'CNROM');

  store.commit('smoke tileset', (project) => {
    project.tilesets.push({
      id: 1,
      name: 'Dungeon',
      background: { tiles: new Array(256).fill('0'.repeat(64)) },
      sprites: { tiles: new Array(256).fill('0'.repeat(64)) }
    });
    project.maps[0].tilesetId = 1;
  });
  window.__app.goTo('tile');
  await wait(250);
  if (tilesetRows().length !== 2) throw new Error('expected two tileset rows, saw ' + tilesetRows().length);
  if (!tilesetRows()[1].textContent.includes('Dungeon')) throw new Error('the second tileset is not named Dungeon');
  step('second tileset appears', tilesetRows().length + ' rows');

  // The Map Forge must offer the choice once there is more than one.
  window.__app.goTo('map');
  await wait(300);
  const tilesetSelect = [...document.querySelectorAll('#stage select')].find((s) =>
    [...s.options].some((o) => o.textContent === 'Dungeon')
  );
  if (!tilesetSelect) throw new Error('the Map Forge has no tileset selector');
  if (Number(tilesetSelect.value) !== 1) throw new Error('the map tileset selector shows the wrong tileset');
  step('map picks its tileset', 'Dungeon');

  // A CNROM project must actually assemble.
  const cnromSave = await window.forge.project.save(store.dir, store.project);
  if (!cnromSave.ok) throw new Error('save cnrom: ' + cnromSave.error);
  const cnromBuild = await window.forge.build.run(store.dir, store.project);
  if (!cnromBuild.ok) throw new Error('build cnrom: ' + cnromBuild.error);
  if (cnromBuild.value.mapper !== 3) throw new Error('built mapper ' + cnromBuild.value.mapper + ', expected 3');
  step('CNROM project builds', cnromBuild.value.size + ' bytes, mapper ' + cnromBuild.value.mapper);

  // Four-screen is UNROM 512 only, and costs a tileset.
  store.commit('smoke u512', (project) => {
    project.cartridge.mapper = 30;
    project.cartridge.mirroring = 'fourscreen';
  });
  window.__app.goTo('build');
  await wait(300);
  const mirrorSelect = [...document.querySelectorAll('#stage select')].find((s) =>
    [...s.options].some((o) => o.textContent === 'Four-screen')
  );
  if (!mirrorSelect) throw new Error('UNROM 512 should offer a four-screen mirroring option');
  if (mirrorSelect.value !== 'fourscreen') throw new Error('the mirroring selector shows the wrong mode');
  step('four-screen selectable', 'UNROM 512');

  // Drive the real mapper selector rather than the store, so the Build panel's own
  // reconciliation runs: that is what has to drop an unsupported mirroring mode.
  const mapperSelect = [...document.querySelectorAll('#stage select')].find((s) =>
    [...s.options].some((o) => o.textContent.startsWith('CNROM'))
  );
  if (!mapperSelect) throw new Error('the Build panel has no mapper selector');
  mapperSelect.value = '3';
  mapperSelect.dispatchEvent(new Event('change'));
  await wait(300);
  const stillThere = [...document.querySelectorAll('#stage select')].some((s) =>
    [...s.options].some((o) => o.textContent === 'Four-screen')
  );
  if (stillThere) throw new Error('CNROM has no nametable RAM, so four-screen must not be offered');
  if (store.project.cartridge.mirroring === 'fourscreen') {
    throw new Error('moving to a board without nametable RAM should drop four-screen');
  }
  step('four-screen hidden elsewhere', 'CNROM falls back');

  // Put the project back on NROM so later steps see the default cartridge.
  store.commit('smoke mapper back', (project) => {
    project.cartridge.mapper = 0;
    project.tilesets.length = 1;
    project.maps[0].tilesetId = 0;
  });
  await wait(120);

  // --- build the sample project and run it in the embedded emulator ------
  const sample = await window.forge.project.open(${JSON.stringify(sampleDir)});
  if (!sample.ok) throw new Error('open sample: ' + sample.error);
  const build = await window.forge.build.run(sample.value.dir, sample.value.project);
  if (!build.ok) throw new Error('build sample: ' + build.error);
  step('sample builds', build.value.size + ' bytes, mapper ' + build.value.mapper);

  const romResult = await window.forge.build.readRom(build.value.romPath);
  if (!romResult.ok) throw new Error('read rom: ' + romResult.error);

  const { Emulator, BUTTON } = await import('./emulator/runcontrol.js');
  let lastFrame = null;
  const emu = new Emulator({ onFrame: (buffer) => { lastFrame = buffer.slice(); } });
  emu.loadROM(new Uint8Array(romResult.value));

  for (let i = 0; i < 40; i++) emu.runFrame();
  if (emu.frames < 30) throw new Error('emulator only produced ' + emu.frames + ' frames');
  if (!lastFrame) throw new Error('the emulator never emitted a frame');

  const distinct = new Set(lastFrame).size;
  if (distinct < 3) throw new Error('screen has only ' + distinct + ' colours -- it is probably blank');
  if (emu.pc < 0x8000) throw new Error('PC is $' + emu.pc.toString(16) + ', outside ROM');
  step('emulator runs the ROM', emu.frames + ' frames, ' + distinct + ' distinct colours');

  // The sample boots into its title screen, so the first thing to prove is that
  // Start gets past it. game_state (engine/constants.asm) is ST_TITLE = 3.
  // No backticks in this scenario: the whole block is a template literal.
  if (emu.peek(0x0025) !== 3) throw new Error('the sample should boot into its title screen');
  emu.setButton(BUTTON.START, true);
  emu.runFrame();
  emu.setButton(BUTTON.START, false);
  for (let i = 0; i < 12; i++) emu.runFrame();
  if (emu.peek(0x0025) !== 0) throw new Error('Start did not get past the title screen');
  step('title screen', 'booted into it, Start began the game');

  // The engine's own zero page: walking right must move the player.
  const startX = emu.peek(0x0010);
  emu.setButton(BUTTON.RIGHT, true);
  for (let i = 0; i < 30; i++) emu.runFrame();
  emu.setButton(BUTTON.RIGHT, false);
  const movedX = emu.peek(0x0010);
  if (movedX <= startX) throw new Error('player x did not increase (' + startX + ' -> ' + movedX + ')');
  step('input reaches the game', 'player x ' + startX + ' -> ' + movedX);

  // Breakpoints: stop on the NMI handler, which must run every frame.
  const nmiAddress = ${JSON.stringify(null)} || null;
  const resetLow = emu.peek(0xFFFA), resetHigh = emu.peek(0xFFFB);
  const nmiVector = resetLow | (resetHigh << 8);
  emu.breakpoints.add(nmiVector);
  let hit = null;
  for (let i = 0; i < 5 && !hit; i++) {
    const outcome = emu.runFrame();
    if (outcome.hit) hit = outcome.hit;
  }
  if (!hit) throw new Error('breakpoint on the NMI vector ($' + nmiVector.toString(16) + ') never fired');
  step('breakpoint fires', 'stopped at $' + hit.address.toString(16).toUpperCase());
  emu.breakpoints.clear();

  // Stepping must advance the program counter.
  const beforePc = emu.pc;
  emu.stepInstruction();
  if (emu.pc === beforePc) throw new Error('stepInstruction did not advance the PC');
  step('single stepping', '$' + beforePc.toString(16) + ' -> $' + emu.pc.toString(16));

  // The PPU viewers read these directly; make sure they hold real data.
  const ppu = emu.nes.ppu;
  const chrNonZero = ppu.vramMem.subarray(0, 0x2000).some((b) => b !== 0);
  const ntNonZero = ppu.vramMem.subarray(0x2000, 0x2400).some((b) => b !== 0);
  if (!chrNonZero) throw new Error('pattern tables are empty in PPU memory');
  if (!ntNonZero) throw new Error('nametable 0 is empty -- the engine never drew a screen');
  step('ppu state populated', 'CHR and nametable 0 both non-empty');

  // --- Sprite Forge ------------------------------------------------------
  window.__app.store.open(sample.value.dir, sample.value.project);
  await wait(200);
  window.__app.goTo('sprite');
  await wait(350);
  const spriteStage = document.querySelector('#stage');
  if (!spriteStage.querySelector('canvas.sheet')) throw new Error('Sprite Forge sheet did not render');
  const tabs = [...spriteStage.querySelectorAll('.tab')].map((t) => t.textContent);
  if (tabs.length !== 3) throw new Error('expected 3 Sprite Forge tabs, saw ' + tabs.join(','));
  step('sprite forge mounted', tabs.join(' / '));

  for (const label of ['Animations', 'Actors']) {
    [...document.querySelectorAll('#stage .tab')].find((t) => t.textContent === label).click();
    await wait(250);
    if (!document.querySelector('#stage canvas')) throw new Error(label + ' tab rendered no canvas');
  }
  step('sprite forge tabs', 'animations and actors render');

  // --- Sound Forge -------------------------------------------------------
  window.__app.goTo('sound');
  await wait(350);
  const soundStage = document.querySelector('#stage');
  const rows = soundStage.querySelectorAll('[data-row]');
  if (rows.length !== 16) throw new Error('expected 16 pattern rows, saw ' + rows.length);
  if (!store.project.songs.length) throw new Error('the sample should have a song');
  step('sound forge mounted', rows.length + ' rows, ' + store.project.songs[0].instruments.length + ' instruments');

  // Entering a note through the keyboard must reach the project.
  rows[4].querySelectorAll('span')[1].click();
  await wait(120);
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', bubbles: true }));
  await wait(150);
  const written = store.project.songs[0].patterns[0].channels.pulse1[4];
  if (!written) throw new Error('typing a note did not write a cell');
  const beforeNote = 55; // the sample writes G-5 at row 4
  store.undo();
  await wait(150);
  const restored = store.project.songs[0].patterns[0].channels.pulse1[4];
  if (!restored || restored.note !== beforeNote) {
    throw new Error('undo left row 4 as ' + JSON.stringify(restored) + ', expected note ' + beforeNote);
  }
  step('note entry', 'wrote note ' + written.note + ', undo restored ' + restored.note);

  // --- Controller Forge --------------------------------------------------
  window.__app.goTo('controller');
  await wait(300);
  // The sample is open and has a title screen, so the title row is shown too:
  // four states of four buttons. Start on the title is the engine's hardwired
  // backstop, so its dropdown is the one that must be disabled.
  const selects = document.querySelectorAll('#stage select');
  if (selects.length !== 16) throw new Error('expected 16 button dropdowns (4 states x 4), saw ' + selects.length);
  if (!selects[15].disabled) throw new Error('Start on the title row should be locked');
  const beforeBinding = store.project.input.states.gameplay.A;
  selects[0].value = 'dash';
  selects[0].dispatchEvent(new Event('change'));
  await wait(150);
  if (store.project.input.states.gameplay.A !== 'dash') throw new Error('rebinding A did not reach the project');
  store.undo();
  await wait(150);
  if (store.project.input.states.gameplay.A !== beforeBinding) throw new Error('undo did not restore the binding');
  step('controller forge', '16 bindings incl. the title row, rebind + undo work');

  // --- Tutorial Forge ----------------------------------------------------
  window.__app.goTo('tutorial');
  await wait(300);
  const topics = document.querySelectorAll('#stage [data-topic]');
  if (topics.length < 8) throw new Error('the Tutorial Forge listed only ' + topics.length + ' topics');
  const firstHeading = document.querySelector('#stage .tutorial-body h2').textContent;
  document.querySelector('#stage [data-topic="dialogue"]').click();
  await wait(150);
  const secondHeading = document.querySelector('#stage .tutorial-body h2').textContent;
  if (secondHeading === firstHeading) throw new Error('selecting a topic did not change the page');
  // The jump button is how a topic hands over to the Forge it explains.
  const jump = [...document.querySelectorAll('#stage .tutorial-body .btn-accent')].find((b) =>
    b.textContent.includes('Map Forge')
  );
  if (!jump) throw new Error('the dialogue topic has no jump into the Map Forge');
  jump.click();
  await wait(300);
  if (!document.querySelector('#stage canvas')) throw new Error('the tutorial jump did not mount the Map Forge');
  step('tutorial forge', topics.length + ' topics, topic switch + jump to Map Forge work');

  // --- Code Forge --------------------------------------------------------
  // The engine's file list arrives over IPC, so wait for the tree it fills in.
  await window.__app.goTo('code');
  const codeStage = document.querySelector('#stage');
  await until('the Code Forge file tree', () => codeStage.querySelectorAll('.tree-row').length >= 15);
  const engineRows = [...codeStage.querySelectorAll('.tree-row')];

  // Open a stock engine file. Nothing is copied into the project yet.
  const playerRow = engineRows.find((row) => row.querySelector('.tree-name').textContent === 'player.asm');
  if (!playerRow) throw new Error('player.asm is missing from the file tree');
  playerRow.click();
  await wait(300);
  const input = codeStage.querySelector('.code-input');
  if (!input) throw new Error('the editor did not mount');
  if (!input.value.includes('update_player')) throw new Error('the stock engine source did not load');
  if (!codeStage.querySelector('.tok-mnemonic')) throw new Error('nothing was syntax highlighted');
  if (store.project.code.overrides.length) throw new Error('merely opening a file made an override');
  const highlightedLines = codeStage.querySelectorAll('.hl-line').length;
  const sourceLines = input.value.split('\\n').length;
  if (highlightedLines !== sourceLines) {
    throw new Error('highlight layer has ' + highlightedLines + ' lines for ' + sourceLines + ' of source');
  }
  const sourceRows = input.value.split('\\n');
  const renderedRows = [...codeStage.querySelectorAll('.hl-line')].map((row) =>
    row.textContent === String.fromCharCode(160) ? '' : row.textContent
  );
  const wrongRow = renderedRows.findIndex((text, index) => text !== sourceRows[index]);
  if (wrongRow >= 0) throw new Error('highlight changed source line ' + (wrongRow + 1));
  step('code forge mounted', engineRows.length + ' files, ' + highlightedLines + ' lines highlighted');

  // Type. The edit becomes an override once typing pauses.
  const stockText = input.value;
  input.value = '; smoke test\\n' + stockText;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(900);
  if (store.project.code.overrides.length !== 1) throw new Error('typing did not create an override');
  if (!store.project.code.overrides[0].text.startsWith('; smoke test')) throw new Error('the override lost the edit');
  if (!store.dirty) throw new Error('editing code did not mark the project dirty');
  const badge = [...codeStage.querySelectorAll('.tree-badge')].some((b) => b.textContent === 'edited');
  if (!badge) throw new Error('the edited file is not badged in the tree');
  step('engine override', 'player.asm edited, badged and dirty');

  // Committing re-renders the Forge, and re-rendering must not move the editor
  // in the DOM: that blurs it, so the caret would vanish a moment after every
  // pause in typing. Typing is the one thing this Forge exists to do.
  input.focus();
  input.value = '; more\\n' + input.value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.setSelectionRange(500, 500);
  await wait(900);
  if (document.activeElement !== input) throw new Error('the editor lost focus when the edit committed');
  if (input.selectionStart !== 500) throw new Error('the caret moved to ' + input.selectionStart + ' on commit');
  step('typing survives a commit', 'focus and caret held at 500');

  // Undo is the project's own undo, because the code lives in the project. Two
  // pauses in typing were two commits, so undoing back to stock takes two.
  store.undo();
  store.undo();
  await wait(250);
  if (store.project.code.overrides.length) throw new Error('undo did not remove the override');
  if (codeStage.querySelector('.code-input').value !== stockText) {
    throw new Error('undo did not put the stock text back in the open editor');
  }
  step('code undo', 'override removed, editor resynced');

  // Create a user file through the real modal, then undo its creation while
  // its tab is open. The tab must disappear with the model entry.
  const addFile = [...codeStage.querySelectorAll('button.tree-add')].find(
    (button) => button.textContent === '+'
  );
  if (!addFile) throw new Error('the Code Forge has no new-file button');
  addFile.click();
  await wait(100);
  const modalInput = document.querySelector('#modalHost input');
  const createButton = document.querySelector('#modalHost .btn-accent');
  if (!modalInput || !createButton) throw new Error('the new-file modal did not open');
  modalInput.value = 'smoke_hook.asm';
  createButton.click();
  await wait(300);

  let userRow = [...codeStage.querySelectorAll('.tree-name')].find(
    (node) => node.textContent === 'smoke_hook.asm'
  );
  if (!userRow) throw new Error('the new file is missing from the tree');
  if (![...codeStage.querySelectorAll('.code-tab-name')].some((node) => node.textContent === 'smoke_hook.asm')) {
    throw new Error('the new file did not open in a tab');
  }

  store.undo();
  await wait(300);
  if (store.project.code.files.some((file) => file.name === 'smoke_hook.asm')) {
    throw new Error('undoing Create left the user file in the project');
  }
  if ([...codeStage.querySelectorAll('.code-tab-name')].some((node) => node.textContent === 'smoke_hook.asm')) {
    throw new Error('undoing Create left its tab open and editable');
  }

  store.redo();
  await wait(300);
  userRow = [...codeStage.querySelectorAll('.tree-name')].find(
    (node) => node.textContent === 'smoke_hook.asm'
  );
  if (!userRow) throw new Error('redoing Create did not restore the file');
  userRow.click();
  await wait(250);
  // Delete uses its confirmation UI and closes the tab; undo restores the file.
  const deleteAction = userRow.closest('.tree-row')?.querySelector('.tree-action');
  if (!deleteAction) throw new Error('the user file has no delete action');
  deleteAction.click();
  await wait(100);
  document.querySelector('#modalHost .btn-accent')?.click();
  await wait(300);
  if (store.project.code.files.some((file) => file.name === 'smoke_hook.asm')) {
    throw new Error('the delete action left the file in the project');
  }
  if ([...codeStage.querySelectorAll('.code-tab-name')].some((node) => node.textContent === 'smoke_hook.asm')) {
    throw new Error('deleting a file left its tab open');
  }
  store.undo();
  await wait(300);
  userRow = [...codeStage.querySelectorAll('.tree-name')].find(
    (node) => node.textContent === 'smoke_hook.asm'
  );
  if (!userRow) throw new Error('undoing Delete did not restore the file');
  userRow.click();
  await wait(200);

  // Invalid names are rejected by the same modal path, and the creation cap is
  // enforced before opening another modal.
  const codeAddButton = () => [...codeStage.querySelectorAll('button.tree-add')].find(
    (button) => button.textContent === '+'
  );
  codeAddButton().click();
  await wait(100);
  document.querySelector('#modalHost input').value = 'bad/name.asm';
  document.querySelector('#modalHost .btn-accent').click();
  await wait(150);
  if (store.project.code.files.some((file) => file.name === 'bad/name.asm')) {
    throw new Error('the new-file UI accepted a path separator');
  }

  store.commit('smoke seed code-file cap', (project) => {
    for (let index = 0; index < 63; index++) {
      project.code.files.push({ name: 'cap_' + String(index).padStart(2, '0') + '.asm', text: '' });
    }
  });
  await wait(250);
  codeAddButton().click();
  await wait(150);
  if (!document.querySelector('#modalHost').hidden) {
    throw new Error('the new-file UI opened past its 64-file creation cap');
  }
  store.undo();
  await wait(300);
  step('user file UI and lifecycle', 'create, validate, cap, delete, undo/redo');

  // The saved project must carry the code back off disk unchanged.
  const codeSaved = await window.forge.project.save(store.dir, store.project);
  if (!codeSaved.ok) throw new Error('save with code: ' + codeSaved.error);
  const codeReopened = await window.forge.project.open(store.dir);
  if (!codeReopened.ok) throw new Error('reopen with code: ' + codeReopened.error);
  if (JSON.stringify(codeReopened.value.project.code) !== JSON.stringify(store.project.code)) {
    throw new Error('code did not round-trip through disk');
  }
  step('code round trip', codeReopened.value.project.code.files.length + ' user file(s) survived');

  // A broken engine override drives the complete diagnostic path, including
  // the asynchronous engine list and the exact marked/selected source line.
  const brokenText = stockText.replace(
    'update_player:\\n',
    'update_player:\\n  this is not an opcode\\n'
  );
  const brokenLine = brokenText.split('\\n').findIndex((line) => line.includes('this is not an opcode')) + 1;
  store.commit('smoke broken engine override', (project) => {
    project.code.overrides.push({ name: 'player.asm', text: brokenText });
  });
  await window.__app.goTo('build');
  await window.__app.current.build();
  await wait(300);
  const errorLine = [...document.querySelectorAll('#stage div')].find(
    (node) => node.title?.startsWith('Open player.asm')
  );
  if (!errorLine) throw new Error('a broken engine override produced no clickable error line');
  if (!errorLine.textContent.includes('player.asm:' + brokenLine)) {
    throw new Error('the error line named the wrong location: ' + errorLine.textContent);
  }
  errorLine.click();
  await until('the engine error deep link', () => document.querySelector('#stage .code-editor'));
  const marker = document.querySelector('#stage .code-errline');
  const markedRow = document.querySelectorAll('#stage .hl-line')[brokenLine - 1];
  const linkedInput = document.querySelector('#stage .code-input');
  if (!marker || marker.hidden || !markedRow) throw new Error('the offending line was not marked');
  if (parseFloat(marker.style.top) !== markedRow.offsetTop) {
    throw new Error('the error marker was not positioned on line ' + brokenLine);
  }
  if (!linkedInput.value.slice(linkedInput.selectionStart, linkedInput.selectionEnd).includes('this is not an opcode')) {
    throw new Error('the error deep link selected the wrong source line');
  }
  step('engine build-error deep link', errorLine.textContent.trim());

  store.undo();
  await wait(300);

  // Large externally authored files are preserved by normalization, and an
  // in-app edit must use the same lossless path.
  await window.__app.current.openFile('smoke_hook.asm', 0);
  const bigInput = codeStage.querySelector('.code-input');
  const largeText = '; ' + 'x'.repeat(140 * 1024) + '\\n';
  bigInput.value = largeText; // one comment line, so highlighting stays cheap
  bigInput.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(900);
  const largeFile = store.project.code.files.find((file) => file.name === 'smoke_hook.asm');
  if (largeFile?.text !== largeText) throw new Error('a large source edit was truncated or dropped');
  store.undo();
  await wait(300);
  step('large source preserved', '140 KB committed losslessly');

  // --- drive the real Build & Play UI so the screenshot shows it running --
  window.__app.store.open(sample.value.dir, sample.value.project);
  await wait(200);
  window.__app.goTo('build');
  await wait(300);
  await window.__app.current.buildAndPlay();
  await wait(1200);
  const playCanvas = [...document.querySelectorAll('#stage canvas')].find(
    (c) => c.width === 256 && c.height === 240
  );
  if (!playCanvas) throw new Error('the play view never showed a 256x240 screen');
  step('build & play UI', 'emulator mounted in the Build panel');

  return report;
})()
`;

export async function runSmoke(window) {
  const problems = [];
  window.webContents.on('console-message', (event) => {
    const { level, message, lineNumber, sourceId } = event;
    const text = `[renderer:${level}] ${message} (${sourceId}:${lineNumber})`;
    if (level === 'error' || level === 3) problems.push(text);
    console.log(text);
  });
  window.webContents.on('render-process-gone', (_event, details) =>
    problems.push(`renderer gone: ${details.reason}`)
  );

  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-smoke-'));
  const dir = path.join(scratch, 'Smoke.forge');
  // The scenario edits and saves the sample, so work on a copy: a test must
  // never leave the repository's fixture in a different state than it found it.
  const sampleCopy = path.join(scratch, 'Sample.forge');
  await fs.cp(path.join(REPO_ROOT, 'sample'), sampleCopy, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}build`)
  });

  try {
    await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
    const report = await window.webContents.executeJavaScript(scenario(dir, sampleCopy));
    for (const entry of report.steps) console.log(`  ok  ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}`);

    // The window's close handler decides whether to interrupt the X with a
    // "save first?" question using only what the renderer last reported. If that
    // report stops arriving, the X either loses work silently or — as it once
    // did — stops closing the window at all, and neither shows up in the
    // renderer-side scenario.
    const dirtyReport = async (label, script) => {
      await window.webContents.executeJavaScript(script);
      for (let attempt = 0; attempt < 40 && unsavedChanges().dirty !== label; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return unsavedChanges().dirty;
    };
    const wentDirty = await dirtyReport(
      true,
      `window.__app.store.commit('smoke', (p) => { p.project.startX = 96; }); true`
    );
    const wentClean = await dirtyReport(false, 'window.__app.saveProject()');
    if (wentDirty !== true || wentClean !== false) {
      problems.push(
        `unsaved-changes reporting is broken: after an edit main saw dirty=${wentDirty}, ` +
          `after a save dirty=${wentClean}`
      );
    } else {
      console.log('  ok  unsaved changes reach the close handler — edit → dirty, save → clean');
    }

    // Typing in the Code Forge does not reach the store until it pauses, and the
    // X does not wait for the pause. So main has to hear about a buffer the
    // moment it diverges — which is why this asks *sooner* than the commit delay
    // rather than polling past it, where the commit alone would answer yes and
    // the question would prove nothing.
    await window.webContents.executeJavaScript(`(async () => {
      const tick = () => new Promise((resolve) => setTimeout(resolve, 25));
      const find = () => [...document.querySelectorAll('#stage .tree-row')].find(
        (node) => node.querySelector('.tree-name').textContent === 'player.asm'
      );
      await window.__app.goTo('code');
      for (let waited = 0; waited < 4000 && !find(); waited += 25) await tick();
      const row = find();
      if (!row) throw new Error('the Code Forge did not list player.asm');
      row.click();
      for (let waited = 0; waited < 4000 && !document.querySelector('#stage .code-input'); waited += 25) await tick();
      const input = document.querySelector('#stage .code-input');
      if (!input) throw new Error('the editor did not open player.asm');
      input.value = '; unsaved\\n' + input.value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    for (let attempt = 0; attempt < 20 && !unsavedChanges().dirty; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (!unsavedChanges().dirty) {
      problems.push('typing in the Code Forge did not reach the close handler before the commit landed');
    } else {
      console.log('  ok  uncommitted typing reaches the close handler — dirty before the commit lands');
    }
    await window.webContents.executeJavaScript('window.__app.saveProject()');

    // The Electron menu owns Cmd/Ctrl+Z, so the keystroke never reaches the
    // textarea by itself and has to be handed back. What that buys is
    // granularity, which is the only thing worth asserting: two insertions with
    // no pause between them are one project commit but two entries in the
    // textarea's own history, so undo has to take back the second one alone.
    // Sending it to the store instead commits the pair and takes back both —
    // the same end state whenever the burst is a single edit, which is why this
    // types twice. Asserting the end state alone passes either way.
    const menuUndo = await window.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('#stage .code-input');
      input.focus();
      input.setSelectionRange(0, 0);
      const before = input.value;
      const first = document.execCommand('insertText', false, '; first\\n');
      // Moving the caret ends the typing group, so the two insertions are two
      // entries in the textarea's history rather than one coalesced edit.
      input.setSelectionRange(0, 0);
      const second = document.execCommand('insertText', false, '; second\\n');
      return {
        before,
        typed: first && second && input.value === '; second\\n; first\\n' + before
      };
    })()`);
    window.webContents.send('menu:action', 'edit:undo');
    // Past the commit delay, so what the editor is left holding is also what the
    // project ends up with.
    await new Promise((resolve) => setTimeout(resolve, 900));
    const afterUndo = await window.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('#stage .code-input');
      const override = window.__app.store.project.code.overrides.find((file) => file.name === 'player.asm');
      return { text: input.value, projectText: override?.text };
    })()`);
    const wantedAfterUndo = '; first\n' + menuUndo.before;
    if (!menuUndo.typed) {
      problems.push('the smoke test could not type into the code editor');
    } else if (afterUndo.text !== wantedAfterUndo) {
      problems.push('menu undo in the Code Forge took back more than the last thing typed');
    } else if (afterUndo.projectText !== wantedAfterUndo) {
      problems.push('the editor and the project disagree about the text after a menu undo');
    } else {
      console.log('  ok  focused menu undo stays in the editor — one insertion, not the whole burst');
    }

    // The map screen is drawn at the largest whole zoom its stage has room for,
    // so the check is that the canvas matches the room it was given. Asserting
    // the relationship rather than a remembered pixel count keeps this true at
    // any window size — which matters because a window manager is free to refuse
    // a resize, and a test that silently depended on one would be a flake.
    const measure = () =>
      window.webContents.executeJavaScript(`(() => {
        const stage = document.querySelector('#stage .canvas-stage');
        const canvas = [...stage.querySelectorAll('canvas')].find(
          (c) => c.width % 256 === 0 && c.width >= 256 && c.height === (c.width / 256) * 240
        );
        const style = getComputedStyle(stage);
        const pad = (a, b) => parseFloat(style[a]) + parseFloat(style[b]);
        const navigator = stage.lastElementChild;
        return {
          zoom: canvas ? canvas.width / 256 : 0,
          across: stage.clientWidth - pad('paddingLeft', 'paddingRight'),
          // The navigator shares the stage with the screen, so its height is not
          // room the screen may grow into.
          down: stage.clientHeight - pad('paddingTop', 'paddingBottom') - navigator.offsetHeight - 14,
          inner: innerWidth
        };
      })()`);
    // `min: 2` in the Map Forge means a narrow window scrolls rather than
    // shrinking the screen below something you can draw on.
    const wantedZoom = ({ across, down }) =>
      Math.max(2, Math.min(8, Math.floor(Math.min(across / 256, down / 240))));
    // Zoom rather than `setContentSize`: it changes the layout viewport through
    // exactly the same path a resize does, and a window manager is free to
    // refuse a resize — which is how this check would quietly stop testing
    // anything. Zooming out gives the stage more CSS pixels, so the fitted
    // screen must grow.
    const layoutAt = async (factor) => {
      window.webContents.setZoomFactor(factor);
      // Poll rather than sleep a fixed time: how soon the renderer relays out is
      // not ours to predict, and a frame-timing guess is how this becomes a flake.
      let last = null;
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        last = await measure();
        if (last.zoom === wantedZoom(last)) break;
      }
      return last;
    };
    await window.webContents.executeJavaScript("window.__app.goTo('map'); true");

    const seen = [await layoutAt(1), await layoutAt(0.6), await layoutAt(1.4), await layoutAt(1)];
    for (const entry of seen) {
      if (entry.zoom !== wantedZoom(entry)) {
        problems.push(
          `the map screen is ${entry.zoom}x in a stage with room for ${wantedZoom(entry)}x ` +
            `(${entry.across}x${entry.down})`
        );
      }
    }
    if (!seen.some((entry) => entry.across !== seen[0].across)) {
      problems.push('the stage never changed size, so nothing about resizing was actually tested');
    } else if (!seen.some((entry) => entry.zoom !== seen[0].zoom)) {
      problems.push(
        `the map screen stayed ${seen[0].zoom}x while its stage went ` +
          `${seen.map((e) => Math.round(e.across)).join(' → ')} pixels wide`
      );
    } else {
      console.log(`  ok  content follows the window — map screen ${seen.map((e) => `${e.zoom}x`).join(' → ')}`);
    }

    if (process.env.FORGE_SHOT) {
      // FORGE_SHOT_FORGE=map (etc.) picks which pane the screenshot shows.
      if (process.env.FORGE_SHOT_FORGE) {
        await window.webContents.executeJavaScript(
          `window.__app.goTo(${JSON.stringify(process.env.FORGE_SHOT_FORGE)});` +
            'new Promise((resolve) => setTimeout(resolve, 500))'
        );
      }
      // FORGE_SHOT_SETUP runs in the renderer once that Forge is up, for panes
      // whose interesting state needs a click to reach — the Code Forge shows an
      // empty stage until a file is opened.
      if (process.env.FORGE_SHOT_SETUP) {
        await window.webContents.executeJavaScript(
          `(async () => { ${process.env.FORGE_SHOT_SETUP} })().then(() => new Promise((r) => setTimeout(r, 400)))`
        );
      }
      const image = await window.webContents.capturePage();
      await fs.writeFile(process.env.FORGE_SHOT, image.toPNG());
      console.log(`  ok  screenshot — ${process.env.FORGE_SHOT}`);
    }
    if (problems.length) {
      console.error('\nRenderer reported errors:');
      for (const problem of problems) console.error(`  ${problem}`);
      return 1;
    }
    console.log(`\nSmoke test passed (${report.steps.length} steps).`);
    return 0;
  } catch (error) {
    console.error(`\nSmoke test failed: ${error?.message ?? error}`);
    for (const problem of problems) console.error(`  ${problem}`);
    return 1;
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}
