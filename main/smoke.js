// Headless-ish integration check: boots the real window, drives the renderer
// through a scripted scenario, and fails on any console error or uncaught
// exception. Run with `npm run smoke`.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ipcMain } from 'electron';
import { unsavedChanges } from './ipc.js';
import { decodePng } from '../test/lib/pngdecode.js';
import { decodeGif } from '../test/lib/gifdecode.js';
import { loadProject } from './project-io.js';
import { checkCapacity } from './build/generate.js';
import { battleRegionBytes, battleRegionCeiling } from './build/battletables.js';
import { resolveMapper } from '../shared/cartridge.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const scenario = (dir, sampleDir, sampleRpgDir) => `
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
  // window.__app.forgeIds (renderer/app.js) is the FORGES registry's own ids,
  // not a second hand-written list here -- a hardcoded array in this file
  // agreeing with FORGES by hand is exactly the single-writer violation that
  // let the Items Forge almost ship unvisited by this very step.
  const forgeIds = window.__app.forgeIds;
  if (!forgeIds.length) throw new Error('window.__app.forgeIds returned nothing -- the registry is not reaching this test');
  for (const id of forgeIds) {
    window.__app.goTo(id);
    await wait(140);
    if (!document.querySelector('#stage').children.length) throw new Error(id + ' forge mounted nothing');
  }
  step('all forges mount', 'ok (' + forgeIds.join(', ') + ')');

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

  // The right-hand settings panel must not grow a horizontal scrollbar — see
  // ROADMAP.md item 10.
  const settingsPanelBody = document.querySelector('#mapSettingsPanel');
  if (!settingsPanelBody) throw new Error('map settings panel body not found');
  if (settingsPanelBody.scrollWidth > settingsPanelBody.clientWidth) {
    throw new Error(
      'map settings panel scrolls sideways: scrollWidth ' +
        settingsPanelBody.scrollWidth +
        ' > clientWidth ' +
        settingsPanelBody.clientWidth
    );
  }
  step('map settings panel does not scroll sideways', settingsPanelBody.clientWidth + 'px wide, no overflow');

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
    // Spelled out rather than built by createScreen, so this is also the check
    // that a screen literal knows every field: the round trip below compares
    // this against what normalization produced on the way back off disk.
    while (map.screens.length < 4) {
      map.screens.push({ name: '', metatiles: new Array(240).fill(0), entities: [] });
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

  // Naming a screen has to reach every menu that offers one, which is the whole
  // point of it: the label is built in one place so a warp, a door and the
  // title-screen picker cannot disagree about what a screen is called.
  const screenName = [...document.querySelectorAll('#stage input')].find((node) =>
    (node.placeholder ?? '').startsWith('unnamed')
  );
  if (!screenName) throw new Error('the Map Forge offers no screen name field');
  screenName.value = 'Cave mouth';
  screenName.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(250);
  if (store.project.maps[0].screens[0].name !== 'Cave mouth') throw new Error('the screen name did not commit');
  const named = [...document.querySelectorAll('#stage option')].filter((node) =>
    node.textContent.includes('Cave mouth')
  );
  if (!named.length) throw new Error('a named screen is still listed by its number');
  step('named screen', named.length + ' menu(s) show it by name');

  // Search, and be taken to what was found. Two actors with the same name on
  // two different screens, so the assertion is that the Forge lands on the one
  // the row described rather than on the first match anywhere.
  store.commit('smoke placed actors', (project) => {
    // Three actors sharing a name and differing only in a field nothing here
    // reads, because the clipboard check further down is about what a weaker
    // guard would miss. With distinct names almost anything passes; with the
    // copied actor last, deleting an earlier one puts its index out of range
    // and the bounds check answers first — which is how that check once passed
    // while testing nothing at all.
    // Carrying an id from the start, because the delete below assigns one: with
    // these omitted here the records would differ by having gained a field, and
    // a guard that looked at nothing but the id would pass this test too.
    project.sprites.actors.push({ id: 0, name: 'Chest', behavior: 'npc', speed: 1 });
    project.sprites.actors.push({ id: 1, name: 'Chest', behavior: 'npc', speed: 2 });
    project.sprites.actors.push({ id: 2, name: 'Chest', behavior: 'npc', speed: 3 });
    const actorId = 1; // the middle one: another of the same name sits after it
    project.maps[0].screens[0].entities.push({ actorId, x: 16, y: 16, props: { name: 'Empty chest' } });
    project.maps[0].screens[3].entities.push({
      actorId,
      x: 48,
      y: 32,
      props: { name: 'Gate key chest', dialogue: 'A brass key.' }
    });
  });
  await wait(250);
  [...document.querySelectorAll('#stage button')].find((node) => node.textContent === 'Find…')?.click();
  await wait(200);
  const findInput = document.querySelector('#modalHost input');
  if (!findInput) throw new Error('the Find button did not open the event list');
  findInput.value = 'brass key';
  findInput.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(150);
  const hits = [...document.querySelectorAll('#modalHost [title="Go to this actor"]')];
  if (hits.length !== 1) throw new Error('searching dialogue matched ' + hits.length + ' rows, expected 1');
  hits[0].click();
  await until('the event list to navigate', () => document.querySelector('#modalHost').hidden);
  const shown = [...document.querySelectorAll('#stage input')].map((node) => node.value);
  if (!shown.includes('Gate key chest')) {
    throw new Error('the search result did not take the Map Forge to the screen it named');
  }
  step('event search', 'dialogue on screen 3 found and jumped to');

  // A template writes the two-page pattern the event system is built around,
  // and opens it in the editor rather than saving it — so this drives the
  // editor's own Save and then checks the guard is the free switch the picker
  // promised, not one something else already holds.
  const rowButton = (entityIndex, label) =>
    [...document.querySelectorAll('#stage [data-entity="' + entityIndex + '"] button')].find(
      (node) => node.textContent === label
    );
  rowButton(0, 'Template…').click();
  await wait(200);
  const chestTemplate = document.querySelector('#modalHost [data-template="chest"]');
  if (!chestTemplate) throw new Error('the template picker offered no chest');
  chestTemplate.click();
  await until('the event editor', () => document.querySelector('#modalHost .btn-accent'));
  document.querySelector('#modalHost .btn-accent').click();
  await wait(300);
  const templated = store.project.maps[0].screens[3].entities[0].props.event;
  if (!templated || templated.pages.length !== 2) throw new Error('the chest template saved no two-page event');
  if (templated.pages[0].cond.type !== 'switchOff' || templated.pages[0].cond.arg !== 0) {
    throw new Error('the template did not guard its first page with the free switch');
  }

  // Reordering and switching a command off, through the editor's own controls.
  // The last of these is the one worth driving end to end: switching off the
  // only live command on a page has to take the page out of the build, not
  // leave a page that matches and does nothing.
  rowButton(0, 'Edit event…').click();
  await until('the event editor', () => document.querySelector('#modalHost .btn-accent'));
  const pageOne = document.querySelectorAll('#modalHost .field-row');
  const sayRow = [...document.querySelectorAll('#modalHost .field-row')].find((node) =>
    node.textContent.includes('Show text')
  );
  if (!sayRow || !pageOne.length) throw new Error('the event editor did not lay the template out');
  [...sayRow.querySelectorAll('button')].find((node) => node.textContent === '↓').click();
  await wait(150);
  document.querySelector('#modalHost .btn-accent').click();
  await wait(300);
  const reordered = store.project.maps[0].screens[3].entities[0].props.event.pages[0].commands;
  if (reordered[0].op !== 'give') throw new Error('moving a command down did not reorder the page');

  rowButton(0, 'Edit event…').click();
  await until('the event editor', () => document.querySelector('#modalHost .btn-accent'));
  for (const box of document.querySelectorAll('#modalHost .check input')) {
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(60);
  }
  const warned = [...document.querySelectorAll('#modalHost p')].some((node) =>
    node.textContent.includes('not built')
  );
  if (!warned) throw new Error('a page with everything switched off was not called out');
  document.querySelector('#modalHost .btn-accent').click();
  await wait(300);
  // Saving must keep what was switched off — that is the whole promise of the
  // toggle. What it stops doing is reaching the ROM, which compiledPages
  // decides and the build asserts, not this.
  const offEvent = store.project.maps[0].screens[3].entities[0].props.event;
  if (!offEvent?.pages?.length) throw new Error('saving an all-off event threw the commands away');
  if (offEvent.pages.some((page) => page.commands.some((command) => !command.off))) {
    throw new Error('some command did not switch off');
  }
  store.undo();
  await wait(200);
  store.undo();
  await wait(200);

  // A variable command, added the way a user adds one: pick it out of the
  // command list, type a number, save. Nothing else can see that the select,
  // the default command, the controls and the schema all agree on its shape.
  rowButton(0, 'Edit event…').click();
  await until('the event editor', () => document.querySelector('#modalHost .btn-accent'));
  const addCommand = [...document.querySelectorAll('#modalHost select')].find((node) =>
    node.textContent.includes('Add a command')
  );
  if (!addCommand) throw new Error('the event editor offered no command list');
  addCommand.value = 'addVar';
  addCommand.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(200);
  const varRow = [...document.querySelectorAll('#modalHost .field-row')].find((node) =>
    node.textContent.includes('Add to variable')
  );
  if (!varRow) throw new Error('adding a variable command produced no row');
  const varAmount = varRow.querySelector('input[type=number]');
  // Deliberately not a whole number: a number field hands back what it is given,
  // the compiler truncates and the schema rounds, so the editor has to settle it
  // before those two can disagree about the same project.
  varAmount.value = '2.6';
  varAmount.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(120);
  document.querySelector('#modalHost .btn-accent').click();
  await wait(300);
  const varCommands = store.project.maps[0].screens[3].entities[0].props.event.pages[0].commands;
  const added = varCommands[varCommands.length - 1];
  if (added?.op !== 'addVar' || added.value !== 3) {
    throw new Error('the variable command saved as ' + JSON.stringify(added));
  }
  store.undo();
  await wait(200);

  // And naming one, which is the other half of it reading as English.
  document.querySelector('#stage button[title^="Name the 16"]').click();
  await until('the variables dialog', () => document.querySelector('#modalHost input[type=text]'));
  const varName = document.querySelector('#modalHost input[type=text]');
  varName.value = 'Gems handed over';
  varName.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(120);
  document.querySelector('#modalHost .btn-accent').click();
  await wait(250);
  if (store.project.variables?.[0] !== 'Gems handed over') {
    throw new Error('naming a variable did not reach the project: ' + JSON.stringify(store.project.variables));
  }
  store.undo();
  await wait(200);
  step('variables', 'Add to variable authored and a variable named');

  // A branch, and a command inside it. The nesting is the part only the real
  // editor can show: the inner list has its own "+ Add a command…", and what it
  // adds has to land inside the branch rather than beside it.
  rowButton(0, 'Edit event…').click();
  await until('the event editor', () => document.querySelector('#modalHost .btn-accent'));
  const addToPage = [...document.querySelectorAll('#modalHost select')].find((node) =>
    node.textContent.includes('Add a command')
  );
  addToPage.value = 'branch';
  addToPage.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(200);
  const thenSide = document.querySelector('#modalHost [data-branch="then"]');
  const elseSide = document.querySelector('#modalHost [data-branch="else"]');
  if (!thenSide || !elseSide) throw new Error('the branch did not render both of its sides');
  const addToThen = [...thenSide.querySelectorAll('select')].find((node) =>
    node.textContent.includes('Add a command')
  );
  if (!addToThen) throw new Error('the Then side offered no command list of its own');
  addToThen.value = 'setSwitch';
  addToThen.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(200);
  document.querySelector('#modalHost .btn-accent').click();
  await wait(300);
  const branched = store.project.maps[0].screens[3].entities[0].props.event.pages[0].commands;
  const branch = branched[branched.length - 1];
  if (branch?.op !== 'branch') throw new Error('the branch saved as ' + JSON.stringify(branch));
  if (branch.then?.length !== 1 || branch.then[0].op !== 'setSwitch') {
    throw new Error('the command went beside the branch instead of inside it: ' + JSON.stringify(branch));
  }
  if (branch.else?.length !== 0) throw new Error('the else side started with something in it');
  store.undo();
  await wait(200);
  step('branching', 'If authored with a command inside its Then side');

  // A question, which is the other command that holds commands — and the one
  // whose lists are named by the author rather than by the editor, so both the
  // label and the list underneath it have to land on the right answer.
  rowButton(0, 'Edit event…').click();
  await until('the event editor', () => document.querySelector('#modalHost .btn-accent'));
  const addQuestion = [...document.querySelectorAll('#modalHost select')].find((node) =>
    node.textContent.includes('Add a command')
  );
  addQuestion.value = 'choice';
  addQuestion.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(200);
  const answers = [...document.querySelectorAll('#modalHost [data-option]')];
  if (answers.length !== 2) throw new Error('a new question rendered ' + answers.length + ' answers, expected 2');
  const firstLabel = answers[0].querySelector('input[type=text]');
  firstLabel.value = 'Hand it over';
  firstLabel.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(200);
  // The second answer's own command list, which is the part only the real
  // editor can show: what it adds has to land inside that answer and nowhere
  // else — not in the first answer, and not beside the question.
  const addToSecond = [...document.querySelectorAll('#modalHost [data-option="1"] select')].find((node) =>
    node.textContent.includes('Add a command')
  );
  if (!addToSecond) throw new Error('the second answer offered no command list of its own');
  addToSecond.value = 'setSwitch';
  addToSecond.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(200);
  document.querySelector('#modalHost .btn-accent').click();
  await wait(300);
  const asked = store.project.maps[0].screens[3].entities[0].props.event.pages[0].commands;
  const question = asked[asked.length - 1];
  if (question?.op !== 'choice') throw new Error('the question saved as ' + JSON.stringify(question));
  if (question.options?.[0]?.text !== 'Hand it over') {
    throw new Error('the answer label did not reach the project: ' + JSON.stringify(question.options));
  }
  if (question.options[0].commands.length !== 0) {
    throw new Error('the command landed in the first answer: ' + JSON.stringify(question.options));
  }
  if (question.options[1]?.commands?.[0]?.op !== 'setSwitch') {
    throw new Error('the command went beside the answer instead of inside it: ' + JSON.stringify(question));
  }
  store.undo();
  await wait(200);
  step('questions', 'Ask authored with a labelled answer and a command inside another');

  // Turn, added the way a user adds one: pick it out of the command list,
  // drive both of its real selects, save. Neither field is exercised by
  // events.test.js's own coverage of this command -- that file's lexical
  // scan of events.js can only see which property name a handler's source
  // text assigns to, never whether the handler actually fires (an onchange
  // renamed to onchanged, for instance, would leave every string that scan
  // looks for untouched while the control went completely inert) -- so this
  // is the one place that promise is actually kept: real <select> elements,
  // real change events, and the saved command read back out of the store.
  rowButton(0, 'Edit event…').click();
  await until('the event editor', () => document.querySelector('#modalHost .btn-accent'));
  const addTurn = [...document.querySelectorAll('#modalHost select')].find((node) =>
    node.textContent.includes('Add a command')
  );
  if (!addTurn) throw new Error('the event editor offered no command list');
  addTurn.value = 'turn';
  addTurn.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(200);
  // The label span reads exactly "Turn" -- setSwitch/clearSwitch's own rows
  // are labelled "Turn switch on"/"Turn switch off", which a plain
  // textContent.includes('Turn') would also match, so this has to be exact.
  const turnRow = [...document.querySelectorAll('#modalHost .field-row')].find(
    (node) => node.querySelector('span')?.textContent === 'Turn'
  );
  if (!turnRow) throw new Error('adding a Turn command produced no row');
  const [turnWho, turnDir] = turnRow.querySelectorAll('select');
  if (!turnWho || !turnDir) throw new Error('the Turn row did not offer both of its selects');
  // Away from both commands' own defaults (self/down), so a select that
  // silently failed to reach the command -- or that reached the wrong field
  // -- cannot pass by coincidentally already matching what got saved.
  turnWho.value = 'player';
  turnWho.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(120);
  turnDir.value = 'left';
  turnDir.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(120);
  document.querySelector('#modalHost .btn-accent').click();
  await wait(300);
  const turnCommands = store.project.maps[0].screens[3].entities[0].props.event.pages[0].commands;
  const turnAdded = turnCommands[turnCommands.length - 1];
  if (turnAdded?.op !== 'turn' || turnAdded.who !== 'player' || turnAdded.dir !== 'left') {
    throw new Error('the Turn command saved as ' + JSON.stringify(turnAdded));
  }
  if ('dist' in turnAdded || 'frames' in turnAdded) {
    throw new Error('a Turn must not carry Move/Wait-only fields: ' + JSON.stringify(turnAdded));
  }
  store.undo();
  await wait(200);

  // Wait, the same way -- one real number input this time, and the one thing
  // worth confirming is which field it landed in: a Wait input mistakenly
  // wired to command.dist instead of command.frames is exactly the defect a
  // lexical scan of the handler's own source cannot rule out.
  rowButton(0, 'Edit event…').click();
  await until('the event editor', () => document.querySelector('#modalHost .btn-accent'));
  const addWait = [...document.querySelectorAll('#modalHost select')].find((node) =>
    node.textContent.includes('Add a command')
  );
  addWait.value = 'wait';
  addWait.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(200);
  const waitRow = [...document.querySelectorAll('#modalHost .field-row')].find(
    (node) => node.querySelector('span')?.textContent === 'Wait'
  );
  if (!waitRow) throw new Error('adding a Wait command produced no row');
  const waitFrames = waitRow.querySelector('input[type=number]');
  if (!waitFrames) throw new Error('the Wait row offered no frame-count input');
  waitFrames.value = '40';
  waitFrames.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(120);
  document.querySelector('#modalHost .btn-accent').click();
  await wait(300);
  const waitCommands = store.project.maps[0].screens[3].entities[0].props.event.pages[0].commands;
  const waitAdded = waitCommands[waitCommands.length - 1];
  if (waitAdded?.op !== 'wait' || waitAdded.frames !== 40) {
    throw new Error('the Wait command saved as ' + JSON.stringify(waitAdded));
  }
  if ('dist' in waitAdded) {
    throw new Error('the frame-count input wrote to command.dist instead of command.frames: ' + JSON.stringify(waitAdded));
  }
  store.undo();
  await wait(200);
  step('turn/wait authoring', 'Turn wired both selects (who, dir); Wait wired its frame count, not dist');

  // Shake, the same way as Wait -- one real number input, and the same
  // dist-vs-frames question a lexical scan cannot answer. 77, not 25 or 30:
  // neither the default (30) nor close enough to it, or to any of Shake's
  // own named constants (SHAKE_KERNEL_ALLOWANCE 65, WAIT_KERNEL_ALLOWANCE 48,
  // the +/-2px perturbation, PPUMASK_ON's own $1E=30 decimal) for a handler
  // hard-coding one of those to pass by coincidence.
  rowButton(0, 'Edit event…').click();
  await until('the event editor', () => document.querySelector('#modalHost .btn-accent'));
  const addShake = [...document.querySelectorAll('#modalHost select')].find((node) =>
    node.textContent.includes('Add a command')
  );
  addShake.value = 'shake';
  addShake.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(200);
  const findShakeRow = () =>
    [...document.querySelectorAll('#modalHost .field-row')].find((node) => node.querySelector('span')?.textContent === 'Shake');
  const firstShakeRow = findShakeRow();
  if (!firstShakeRow) throw new Error('adding a Shake command produced no row');
  const firstShakeFrames = firstShakeRow.querySelector('input[type=number]');
  if (!firstShakeFrames) throw new Error('the Shake row offered no frame-count input');
  firstShakeFrames.value = '77';
  firstShakeFrames.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(120);
  document.querySelector('#modalHost .btn-accent').click();
  await wait(300);
  const shakeCommands = store.project.maps[0].screens[3].entities[0].props.event.pages[0].commands;
  const shakeAdded = shakeCommands[shakeCommands.length - 1];
  if (shakeAdded?.op !== 'shake' || shakeAdded.frames !== 77) {
    throw new Error('the Shake command saved as ' + JSON.stringify(shakeAdded));
  }
  if ('dist' in shakeAdded || 'who' in shakeAdded || 'dir' in shakeAdded) {
    throw new Error('a Shake must not carry Move/Turn-only fields: ' + JSON.stringify(shakeAdded));
  }

  // Edited to a second, equally distinctive value -- rules out a handler
  // that merely echoes whatever was typed on the FIRST change back to the
  // same fixed 77 every time, rather than genuinely tracking the input.
  rowButton(0, 'Edit event…').click();
  await until('the event editor', () => document.querySelector('#modalHost .btn-accent'));
  const secondShakeRow = findShakeRow();
  if (!secondShakeRow) throw new Error('the saved Shake command produced no row when reopened');
  const secondShakeFrames = secondShakeRow.querySelector('input[type=number]');
  if (String(secondShakeFrames.value) !== '77') {
    throw new Error('the reopened Shake row did not show the value it was saved with: ' + secondShakeFrames.value);
  }
  secondShakeFrames.value = '133';
  secondShakeFrames.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(120);
  document.querySelector('#modalHost .btn-accent').click();
  await wait(300);
  const shakeCommandsAgain = store.project.maps[0].screens[3].entities[0].props.event.pages[0].commands;
  const shakeEdited = shakeCommandsAgain[shakeCommandsAgain.length - 1];
  if (shakeEdited?.op !== 'shake' || shakeEdited.frames !== 133) {
    throw new Error('the edited Shake command saved as ' + JSON.stringify(shakeEdited));
  }
  store.undo();
  await wait(200);
  store.undo();
  await wait(200);
  step('shake authoring', 'Shake wired its frame count (77, then edited to 133), not dist');

  // Show/Hide, a select rather than a number field -- the lexical-scan gap
  // this whole family of steps exists to close applies just as much to an
  // onchange on a <select> as to one on an <input type=number>. 'shown' is
  // the value to switch to first because it is NOT VISIBLE_STATES[0]
  // ('hidden'): confirming the row starts at the default and then moves off
  // it rules out a handler that merely renders whichever option happens to
  // be first regardless of the stored value.
  rowButton(0, 'Edit event…').click();
  await until('the event editor', () => document.querySelector('#modalHost .btn-accent'));
  const addVisible = [...document.querySelectorAll('#modalHost select')].find((node) =>
    node.textContent.includes('Add a command')
  );
  addVisible.value = 'visible';
  addVisible.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(200);
  const findVisibleRow = () =>
    [...document.querySelectorAll('#modalHost .field-row')].find(
      (node) => node.querySelector('span')?.textContent === 'This actor is'
    );
  const selectedLabel = (select) => select.options[select.selectedIndex]?.textContent;
  const firstVisibleRow = findVisibleRow();
  if (!firstVisibleRow) throw new Error('adding a Show/Hide command produced no row');
  const firstVisibleSelect = firstVisibleRow.querySelector('select');
  if (!firstVisibleSelect) throw new Error('the Show/Hide row offered no state select');
  if (firstVisibleSelect.value !== 'hidden') {
    throw new Error('a freshly added Show/Hide command should default to Hidden: ' + firstVisibleSelect.value);
  }
  // The value alone is not the whole UI: a select whose 'hidden'/'shown'
  // options carry swapped display labels would pass every value check above
  // while showing the author the opposite of what they picked.
  if (selectedLabel(firstVisibleSelect) !== 'Hidden') {
    throw new Error('value hidden must display as label Hidden: saw ' + JSON.stringify(selectedLabel(firstVisibleSelect)));
  }
  // The footgun has to actually be on screen, not just accurate in the
  // source -- a hint that said the right thing but never rendered, or was
  // deleted outright, would be invisible to an author relying on it.
  const visibleHint = firstVisibleRow.parentElement?.querySelector('p.hint');
  if (!visibleHint || visibleHint.textContent.indexOf('AI, contact damage and interaction all keep running') === -1) {
    throw new Error('the Show/Hide row is missing its AI/contact/interaction warning: ' + JSON.stringify(visibleHint?.textContent));
  }
  if (visibleHint.textContent.indexOf('does not survive leaving the screen') === -1) {
    throw new Error('the Show/Hide row is missing its does-not-survive-a-redraw warning: ' + JSON.stringify(visibleHint.textContent));
  }
  firstVisibleSelect.value = 'shown';
  firstVisibleSelect.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(120);
  document.querySelector('#modalHost .btn-accent').click();
  await wait(300);
  const visibleCommands = store.project.maps[0].screens[3].entities[0].props.event.pages[0].commands;
  const visibleAdded = visibleCommands[visibleCommands.length - 1];
  if (visibleAdded?.op !== 'visible' || visibleAdded.state !== 'shown') {
    throw new Error('the Show/Hide command saved as ' + JSON.stringify(visibleAdded));
  }
  if ('frames' in visibleAdded || 'dist' in visibleAdded || 'who' in visibleAdded || 'dir' in visibleAdded) {
    throw new Error('a Show/Hide command must not carry Move/Turn/Wait/Shake-only fields: ' + JSON.stringify(visibleAdded));
  }

  // Reopen and edit back to the other value -- the same "genuinely tracking
  // the input, not echoing the first change" proof Shake's own 77 -> 133
  // step above relies on.
  rowButton(0, 'Edit event…').click();
  await until('the event editor', () => document.querySelector('#modalHost .btn-accent'));
  const secondVisibleRow = findVisibleRow();
  if (!secondVisibleRow) throw new Error('the saved Show/Hide command produced no row when reopened');
  const secondVisibleSelect = secondVisibleRow.querySelector('select');
  if (secondVisibleSelect.value !== 'shown') {
    throw new Error('the reopened Show/Hide row did not show the value it was saved with: ' + secondVisibleSelect.value);
  }
  if (selectedLabel(secondVisibleSelect) !== 'Shown') {
    throw new Error('value shown must display as label Shown: saw ' + JSON.stringify(selectedLabel(secondVisibleSelect)));
  }
  secondVisibleSelect.value = 'hidden';
  secondVisibleSelect.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(120);
  document.querySelector('#modalHost .btn-accent').click();
  await wait(300);
  const visibleCommandsAgain = store.project.maps[0].screens[3].entities[0].props.event.pages[0].commands;
  const visibleEdited = visibleCommandsAgain[visibleCommandsAgain.length - 1];
  if (visibleEdited?.op !== 'visible' || visibleEdited.state !== 'hidden') {
    throw new Error('the edited Show/Hide command saved as ' + JSON.stringify(visibleEdited));
  }
  store.undo();
  await wait(200);
  store.undo();
  await wait(200);
  step('show/hide authoring', 'Show/Hide wired its state select (defaulted Hidden, set Shown, then edited back to Hidden)');

  // Fade, a select over FADE_DIRECTIONS -- the identical shape Show/Hide's
  // own select already proves, but with one property unique to Fade among
  // this codebase's categorical-operand verbs: index 0 ('none') is a genuine
  // no-op rather than a harmless default, so a freshly added row must default
  // there rather than to 'out' or 'in', either of which would darken the
  // screen the instant an author placed the command before choosing anything.
  // 'out' is the value to switch to first because it is NOT FADE_DIRECTIONS[0]
  // ('none') -- confirming the row starts at the default and then moves off
  // it rules out a handler that merely renders whichever option happens to be
  // first regardless of the stored value, the same proof Show/Hide's own
  // hidden -> shown step already relies on.
  rowButton(0, 'Edit event…').click();
  await until('the event editor', () => document.querySelector('#modalHost .btn-accent'));
  const addFade = [...document.querySelectorAll('#modalHost select')].find((node) =>
    node.textContent.includes('Add a command')
  );
  addFade.value = 'fade';
  addFade.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(200);
  const findFadeRow = () =>
    [...document.querySelectorAll('#modalHost .field-row')].find((node) => node.querySelector('span')?.textContent === 'Fade');
  const firstFadeRow = findFadeRow();
  if (!firstFadeRow) throw new Error('adding a Fade command produced no row');
  const firstFadeSelect = firstFadeRow.querySelector('select');
  if (!firstFadeSelect) throw new Error('the Fade row offered no direction select');
  if (firstFadeSelect.value !== 'none') {
    throw new Error('a freshly added Fade command should default to none (does nothing): ' + firstFadeSelect.value);
  }
  if (selectedLabel(firstFadeSelect) !== '(does nothing)') {
    throw new Error('value none must display as label (does nothing): saw ' + JSON.stringify(selectedLabel(firstFadeSelect)));
  }
  const fadeHint = firstFadeRow.parentElement?.querySelector('p.hint');
  if (!fadeHint || fadeHint.textContent.indexOf('(does nothing)') === -1) {
    throw new Error('the fresh Fade row is missing its does-nothing hint: ' + JSON.stringify(fadeHint?.textContent));
  }

  // The event-list summary rendered outside the modal (map.js's own
  // dialogueEditor, under the placed actor's panel) is what an author
  // actually reads without opening the editor at all -- round-1, finding 5:
  // a wrong describeEnabled that always says "Fade (does nothing)", swaps
  // the out/in labels, or omits the summary entirely would pass every
  // check above and every unit test while the Map Forge lies about the
  // saved command out here. Saved with the still-default 'none' first
  // (cheap while here), then re-checked after the out save and the in save
  // below.
  const fadeSummaryRow = () =>
    [...document.querySelectorAll('#stage [data-entity="0"] p.hint')].find((node) => node.textContent.includes('Fade'));
  document.querySelector('#modalHost .btn-accent').click();
  await wait(300);
  const fadeSummaryNone = fadeSummaryRow();
  if (!fadeSummaryNone || fadeSummaryNone.textContent.indexOf('Fade (does nothing)') === -1) {
    throw new Error('the event-list summary outside the modal did not read Fade (does nothing): ' + JSON.stringify(fadeSummaryNone?.textContent));
  }

  rowButton(0, 'Edit event…').click();
  await until('the event editor', () => document.querySelector('#modalHost .btn-accent'));
  const noneFadeRow = findFadeRow();
  if (!noneFadeRow) throw new Error('the saved Fade command produced no row when reopened');
  const noneFadeSelect = noneFadeRow.querySelector('select');
  noneFadeSelect.value = 'out';
  noneFadeSelect.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(120);
  document.querySelector('#modalHost .btn-accent').click();
  await wait(300);
  const fadeCommands = store.project.maps[0].screens[3].entities[0].props.event.pages[0].commands;
  const fadeAdded = fadeCommands[fadeCommands.length - 1];
  if (fadeAdded?.op !== 'fade' || fadeAdded.dir !== 'out') {
    throw new Error('the Fade command saved as ' + JSON.stringify(fadeAdded));
  }
  if ('frames' in fadeAdded || 'dist' in fadeAdded || 'who' in fadeAdded || 'state' in fadeAdded) {
    throw new Error('a Fade command must not carry Move/Turn/Wait/Shake/Visible-only fields: ' + JSON.stringify(fadeAdded));
  }
  const fadeSummaryOut = fadeSummaryRow();
  if (!fadeSummaryOut || fadeSummaryOut.textContent.indexOf('Fade out (to black)') === -1) {
    throw new Error('the event-list summary outside the modal did not read Fade out (to black): ' + JSON.stringify(fadeSummaryOut?.textContent));
  }

  // Reopen, confirm the round trip, then edit a second time -- the same
  // "genuinely tracking the input, not echoing the first change" proof
  // Shake's own 77 -> 133 and Show/Hide's own hidden -> shown steps rely on.
  rowButton(0, 'Edit event…').click();
  await until('the event editor', () => document.querySelector('#modalHost .btn-accent'));
  const secondFadeRow = findFadeRow();
  if (!secondFadeRow) throw new Error('the saved Fade command produced no row when reopened');
  const secondFadeSelect = secondFadeRow.querySelector('select');
  if (secondFadeSelect.value !== 'out') {
    throw new Error('the reopened Fade row did not show the value it was saved with: ' + secondFadeSelect.value);
  }
  if (selectedLabel(secondFadeSelect) !== 'Fade out (to black)') {
    throw new Error('value out must display as label Fade out (to black): saw ' + JSON.stringify(selectedLabel(secondFadeSelect)));
  }
  secondFadeSelect.value = 'in';
  secondFadeSelect.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(120);
  document.querySelector('#modalHost .btn-accent').click();
  await wait(300);
  const fadeCommandsAgain = store.project.maps[0].screens[3].entities[0].props.event.pages[0].commands;
  const fadeEdited = fadeCommandsAgain[fadeCommandsAgain.length - 1];
  if (fadeEdited?.op !== 'fade' || fadeEdited.dir !== 'in') {
    throw new Error('the edited Fade command saved as ' + JSON.stringify(fadeEdited));
  }
  const fadeSummaryIn = fadeSummaryRow();
  if (!fadeSummaryIn || fadeSummaryIn.textContent.indexOf('Fade in (from black)') === -1) {
    throw new Error('the event-list summary outside the modal did not read Fade in (from black) after the second save: ' + JSON.stringify(fadeSummaryIn?.textContent));
  }
  store.undo();
  await wait(200);
  store.undo();
  await wait(200);
  store.undo();
  await wait(200);
  step('fade authoring', 'Fade wired its direction select (defaulted none, set out, then edited to in) and its outside-the-modal summary tracked all three');

  // Flash, the one command with no operand at all. §9 test 16 (the modal
  // half): a row that silently renders no field could either mean
  // "correctly configuration-free" or "the field exists in the data model
  // but the UI forgot to expose it," so this asserts absence directly
  // (no input/select anywhere in the row) rather than merely not looking
  // for one. §9 test 17 (the outside-the-modal half, finding 10): close
  // the modal and check the real collapsed summary reads exactly "Flash
  // the screen" -- a case 'flash' in the summary function that is missing,
  // stale or generic would pass the modal-only half and only fail here.
  //
  // Captured before the editor opens (finding 5). Fade's own section above
  // ends with three store.undo() calls that unwind Fade's command entirely
  // back out of this page (its add plus two edits), so by this point the
  // accumulated line no longer mentions Fade at all -- selecting by a verb
  // name is not reliable here. dialogueEditor (map.js) renders exactly one
  // p.hint per event page, each starting "N. <condition> -> ..."
  // (map.js's own template literal), which distinguishes it from the
  // unrelated "<actor> @ x,y" placement hint rendered just above it -- this
  // fixture has exactly one page, so the first match is the whole summary.
  // No backslash escapes in this regex (this whole scenario is one big
  // template literal, so \d/\.\/s here would be silently eaten by the
  // outer literal's own escape processing before this code ever runs --
  // the identical trap CLAUDE.md already documents for finding 8's own
  // apostrophe) -- character classes [0-9] and [.] need no escaping.
  const preFlashRow = [...document.querySelectorAll('#stage [data-entity="0"] p.hint')].find((node) => /^[0-9]+[.] /.test(node.textContent.trim()));
  if (!preFlashRow) throw new Error('could not find the accumulated pre-Flash summary row to compare against');
  const preFlashSegments = preFlashRow.textContent.split(';').map((segment) => segment.trim());

  rowButton(0, 'Edit event…').click();
  await until('the event editor', () => document.querySelector('#modalHost .btn-accent'));
  const addFlash = [...document.querySelectorAll('#modalHost select')].find((node) =>
    node.textContent.includes('Add a command')
  );
  addFlash.value = 'flash';
  addFlash.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(200);
  const findFlashRow = () =>
    [...document.querySelectorAll('#modalHost .field-row')].find((node) => node.querySelector('span')?.textContent === 'Flash the screen');
  const firstFlashRow = findFlashRow();
  if (!firstFlashRow) throw new Error('adding a Flash command produced no row');
  // input:not([type=checkbox]) excludes the universal switch-off toggle
  // every command row's own tools column carries (commandRow's own toggle,
  // renderer/forges/map/events.js) -- that one is not a configuration
  // field, it is the same "off without deleting" control every other verb's
  // row already has too.
  if (firstFlashRow.querySelector('input:not([type=checkbox])') || firstFlashRow.querySelector('select')) {
    throw new Error('a Flash row must have no configuration input or select -- there is nothing to configure');
  }
  const flashHint = firstFlashRow.parentElement?.querySelector('p.hint');
  if (!flashHint || flashHint.textContent.indexOf('Flashes the whole screen') === -1) {
    throw new Error('the fresh Flash row is missing its own explanatory hint: ' + JSON.stringify(flashHint?.textContent));
  }

  const flashSummaryRow = () =>
    [...document.querySelectorAll('#stage [data-entity="0"] p.hint')].find((node) => node.textContent.includes('Flash'));
  document.querySelector('#modalHost .btn-accent').click();
  await wait(300);
  const flashCommands = store.project.maps[0].screens[3].entities[0].props.event.pages[0].commands;
  const flashAdded = flashCommands[flashCommands.length - 1];
  if (flashAdded?.op !== 'flash') throw new Error('the Flash command saved as ' + JSON.stringify(flashAdded));
  if (Object.keys(flashAdded).some((key) => key !== 'op' && key !== 'off')) {
    throw new Error('a Flash command must carry no fields beyond op -- there is nothing to configure: ' + JSON.stringify(flashAdded));
  }
  // This entity's own page has accumulated every earlier verb's own smoke
  // command by this point (turn/wait, shake, show/hide, fade), so the real
  // summary line concatenates all of them with semicolons -- the same
  // reason Fade's own check above matches a substring rather than the whole
  // line. The post-save summary must equal exactly the pre-Flash segment list plus
  // one new final segment -- not merely "ends with the expected phrase"
  // (finding 5), which a malformed summary like "Wrong; Flash the screen"
  // would also satisfy despite the Flash command contributing a spurious
  // extra segment and an incorrect one.
  const flashSummary = flashSummaryRow();
  const flashSummarySegments = (flashSummary?.textContent ?? '').split(';').map((segment) => segment.trim());
  const expectedFlashSegments = [...preFlashSegments, 'Flash the screen'];
  if (JSON.stringify(flashSummarySegments) !== JSON.stringify(expectedFlashSegments)) {
    throw new Error(
      'the event-list summary outside the modal was not exactly the pre-Flash segments plus "Flash the screen": expected ' +
        JSON.stringify(expectedFlashSegments) + ', saw ' + JSON.stringify(flashSummarySegments)
    );
  }

  // Reopen and confirm the row still renders identically -- the same
  // "nothing to lose on a round trip" proof every other verb's own
  // edit-and-reopen step gives for its own field, here applied to a row
  // with no field to lose at all.
  rowButton(0, 'Edit event…').click();
  await until('the event editor', () => document.querySelector('#modalHost .btn-accent'));
  const secondFlashRow = findFlashRow();
  if (!secondFlashRow) throw new Error('the saved Flash command produced no row when reopened');
  if (secondFlashRow.querySelector('input:not([type=checkbox])') || secondFlashRow.querySelector('select')) {
    throw new Error('the reopened Flash row must still have no configuration input or select');
  }
  document.querySelector('#modalHost .btn-accent').click();
  await wait(300);
  store.undo();
  await wait(200);
  store.undo();
  await wait(200);
  step('flash authoring', 'Flash rendered with no field to configure, and the outside-the-modal summary exact final segment read "Flash the screen"');

  // The trigger, which is the one part of an event that lives on the placement
  // rather than in the event. Only the real panel can show the select is wired
  // to the store and that the hint under it follows the choice.
  const triggerSelect = document.querySelector('#stage [data-entity="0"] select[title="What makes this event run"]');
  if (!triggerSelect) throw new Error('the placed actor offered no trigger control');
  const offered = [...triggerSelect.options].map((option) => option.value);
  if (offered.join(',') !== 'interact,touch,enter') {
    throw new Error('the trigger list was ' + offered.join(','));
  }
  triggerSelect.value = 'touch';
  triggerSelect.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(250);
  if (store.project.maps[0].screens[3].entities[0].props.trigger !== 'touch') {
    throw new Error('the trigger did not reach the project');
  }
  const triggerHint = document.querySelector('#stage [data-entity="0"] [data-trigger-hint="touch"]');
  if (!triggerHint || !triggerHint.textContent.includes('walks into it')) {
    throw new Error('the hint did not follow the trigger: ' + (triggerHint?.textContent ?? 'missing'));
  }
  store.undo();
  await wait(200);
  if ((store.project.maps[0].screens[3].entities[0].props.trigger ?? 'interact') !== 'interact') {
    throw new Error('undo left the trigger changed');
  }
  step('triggers', 'trigger set to touch, hint followed, undo put it back');

  // Common events: authored in one modal, referenced in a nested one that has
  // to see entries added earlier in the *same* session. Regression coverage
  // for a bug where the picker was handed the project's commonEvents as it
  // stood when the toolbar button was clicked, rather than the list being
  // built up inside this modal — so a project's first common event could not
  // reference the second one added right beside it until after a save and a
  // reopen.
  document.querySelector('#stage button[title^="Author events any placement"]').click();
  await until('the common events dialog', () => document.querySelector('#modalHost button'));
  const addCommonEvent = () =>
    [...document.querySelectorAll('#modalHost button')].find((node) => node.textContent === '+ Common event');
  addCommonEvent().click();
  await wait(150);
  addCommonEvent().click();
  await wait(150);
  const commonEditButtons = () =>
    [...document.querySelectorAll('#modalHost button')].filter((node) => node.textContent === 'Edit…');
  if (commonEditButtons().length !== 2) throw new Error('two common events did not produce two rows');
  commonEditButtons()[0].click(); // edit the first one, from inside the same unsaved session
  await until('the common event’s own page editor', () => document.querySelector('#modalHost .btn-accent'));
  const addToCommon = [...document.querySelectorAll('#modalHost select')].find((node) =>
    node.textContent.includes('Add a command')
  );
  if (!addToCommon) throw new Error('the common event’s page editor offered no command list');
  const offeredCall = [...addToCommon.options].some((option) => option.textContent === 'Run common event');
  if (!offeredCall) {
    throw new Error('Run common event was not offered — the picker used a stale, pre-session list');
  }
  addToCommon.value = 'call';
  addToCommon.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(200);
  const callRow = [...document.querySelectorAll('#modalHost .field-row')].find((node) =>
    node.textContent.includes('Run common event')
  );
  const callSelect = callRow?.querySelector('select');
  if (!callSelect) throw new Error('the call command rendered no target picker');
  if (callSelect.options.length !== 2) {
    throw new Error('the target picker offered ' + callSelect.options.length + ', expected both common events');
  }
  const secondId = callSelect.options[1].value;
  callSelect.value = secondId;
  callSelect.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(200);
  document.querySelector('#modalHost .btn-accent').click(); // save the call command's own page editor
  // Closing this nested modal and the outer list modal reopening both cross a
  // promise resolution, same as any other Save — a fixed settle rather than
  // polling, matching every other modal-closing click in this scenario.
  await wait(300);
  await until('back at the common events list', () =>
    [...document.querySelectorAll('#modalHost button')].some((node) => node.textContent === 'Save')
  );
  const saveList = [...document.querySelectorAll('#modalHost button')].find((node) => node.textContent === 'Save');
  if (!saveList) throw new Error('the common events list did not come back after saving the call');
  saveList.click();
  await wait(300);
  const savedCommon = store.project.commonEvents;
  if (savedCommon?.length !== 2) throw new Error('common events saved as ' + JSON.stringify(savedCommon));
  const savedCall = savedCommon[0].event?.pages?.[0]?.commands?.[0];
  if (savedCall?.op !== 'call' || String(savedCall.event) !== secondId) {
    throw new Error('the call did not save against the common event picked from the live list: ' + JSON.stringify(savedCall));
  }
  store.undo();
  await wait(200);
  if ((store.project.commonEvents ?? []).length !== 0) throw new Error('undo left a common event behind');
  step('common events', 'authored one from inside the same session it referenced another');

  // Duplicate keeps the event, and lands somewhere you can see it.
  rowButton(0, '+⧉').click();
  await wait(250);
  const twins = store.project.maps[0].screens[3].entities;
  if (twins.length !== 2) throw new Error('duplicate produced ' + twins.length + ' actors, expected 2');
  if (JSON.stringify(twins[1].props.event) !== JSON.stringify(templated)) {
    throw new Error('the duplicate did not carry the event across');
  }
  if (twins[1].x === twins[0].x && twins[1].y === twins[0].y) {
    throw new Error('the duplicate landed exactly under the original');
  }

  // Copy and paste is the same thing across screens.
  rowButton(0, '⧉').click();
  await wait(150);
  [...document.querySelectorAll('#stage canvas')]
    .filter((node) => node.width === 64 && node.height === 60)[1]
    .click();
  await wait(250);
  const paste = [...document.querySelectorAll('#stage button')].find((node) =>
    node.textContent.startsWith('Paste ')
  );
  if (!paste) throw new Error('a copied actor offered no paste on another screen');
  paste.click();
  await wait(250);
  if (store.project.maps[0].screens[1].entities.length !== 1) throw new Error('paste put nothing on screen 1');

  // Deleting an actor renumbers every placed actorId, and cannot renumber the
  // clipboard's. All three actors share a name, so after the deletion the
  // copied index is in range, holds a *different* actor, and every weaker
  // guard still says yes: the bounds check, the copied actor's name, and the
  // names up to that index are all unchanged. Only the whole roster differs.
  // Asserted present first, or this would pass for finding nothing.
  const pasteOffered = () =>
    [...document.querySelectorAll('#stage button')].some((node) => node.textContent.startsWith('Paste '));
  if (!pasteOffered()) throw new Error('paste is not offered even before the actor list changes');
  const copiedActor = store.project.sprites.actors[1];
  store.commit('smoke delete an earlier actor', (project) => {
    project.sprites.actors.splice(0, 1); // the first Chest, ahead of the copied one
    project.sprites.actors.forEach((actor, position) => (actor.id = position));
    for (const map of project.maps) {
      for (const screen of map.screens) {
        screen.entities = screen.entities
          .filter((entity) => entity.actorId !== 0)
          .map((entity) => ({ ...entity, actorId: entity.actorId - 1 }));
      }
    }
  });
  await wait(250);
  if (store.project.sprites.actors[1] === copiedActor) {
    throw new Error('the smoke setup did not actually shuffle the copied index onto another actor');
  }
  if (store.project.sprites.actors[1]?.name !== copiedActor.name) {
    throw new Error('the shuffled-into actor should share the name, or the guard is not being tested');
  }
  if (store.project.sprites.actors.slice(0, 2).some((actor) => actor.name !== copiedActor.name)) {
    throw new Error('the names up to the copied index should be unchanged, or a prefix guard would pass');
  }
  if (pasteOffered()) throw new Error('paste survived the actor it copied being renumbered');

  // And it must not come back when the roster merely *looks* the way it did.
  // Adding a third actor called Chest restores the count and the sequence of
  // names, so any guard comparing those says yes again — while index 1 still
  // holds the actor that shuffled into it. Only comparing the records notices,
  // and only because this new one is not a copy of what was deleted.
  // Same name, same position, same id as the record that used to sit at the end
  // — so the roster differs by speed alone, and nothing weaker than the whole
  // record can tell this apart from what was copied.
  store.commit('smoke add a same-named actor', (project) => {
    project.sprites.actors.push({ id: 2, name: 'Chest', behavior: 'npc', speed: 8 });
  });
  await wait(250);
  const names = store.project.sprites.actors.map((actor) => actor.name);
  if (names.length !== 3 || names.some((name) => name !== 'Chest')) {
    throw new Error('the smoke setup did not restore the roster of names: ' + names.join(','));
  }
  if (pasteOffered()) throw new Error('paste came back for a roster that only looks like the one copied');

  store.undo();
  await wait(200);
  store.undo();
  await wait(250);
  if (!pasteOffered()) throw new Error('undoing the deletion did not bring the paste back');
  step('event authoring', 'chest template, reorder, switch off, duplicate, paste');

  for (let undone = 0; undone < 4; undone++) {
    store.undo();
    await wait(120);
  }
  if (store.project.maps[0].screens[3].entities.length) throw new Error('undo did not unwind the actor edits');

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

  // The over-cap delete warning, through the real confirmation dialog.
  // overCapDeleteWarning is unit-tested for its wording; what only the real
  // window can show is that it reaches the author at the moment of the edit —
  // which is the whole point of putting it here rather than trusting the
  // Build panel's refusal, since validateProject is rendered only by the
  // Build Forge and a project reopens in whichever Forge was last active.
  {
    const spriteStore = window.__app.store;
    const before = spriteStore.project.sprites.actors.length;
    spriteStore.commit('Smoke: over the actor ceiling', (project) => {
      const template = project.sprites.actors[0];
      // LIMITS.actors is 255; one past it is what the warning is about.
      while (project.sprites.actors.length <= 255) {
        project.sprites.actors.push({ ...structuredClone(template), id: project.sprites.actors.length });
      }
    });
    await wait(250);
    const deleteButton = [...document.querySelectorAll('#stage button.btn.btn-sm')].find(
      (b) => b.textContent.trim() === '✕'
    );
    if (!deleteButton) throw new Error('Actors tab has no delete button');
    deleteButton.click();
    await until('the delete confirmation', () => document.querySelector('#modalHost p'));
    const confirmText = document.querySelector('#modalHost p').textContent;
    if (!/actor ceiling/.test(confirmText) || !/not preserved/.test(confirmText)) {
      throw new Error('the delete confirmation did not warn about the actor ceiling: ' + confirmText);
    }
    // Cancel: this check must not actually delete anything.
    const cancel = [...document.querySelectorAll('#modalHost button')].find((b) => b.textContent.trim() === 'Cancel');
    if (!cancel) throw new Error('the delete confirmation has no Cancel button');
    cancel.click();
    await until('the confirmation to close', () => document.querySelector('#modalHost').hidden);
    // Truncate back rather than store.undo(): open() holds the caller's
    // project object by reference and commit() mutates it in place, but undo()
    // swaps this.project for a *clone* — so undoing would leave the object
    // sample.value.project still points at carrying all 255 extra actors, and
    // the Build & Play step further down re-opens exactly that object. Since
    // this only ever pushed, setting the length back restores the original
    // entries themselves.
    spriteStore.commit('Smoke: back under the actor ceiling', (project) => {
      project.sprites.actors.length = before;
    });
    await wait(200);
    if (spriteStore.project.sprites.actors.length !== before) {
      throw new Error('the over-cap roster was not restored: ' + spriteStore.project.sprites.actors.length);
    }
    step('over-cap delete warning', 'reaches the real confirmation, and nothing was deleted');
  }

  // ROADMAP item 11: the Actors and Animations tabs' preview loops used to
  // call the same fill() that builds their own buttons, fields and (on
  // Animations) the Play checkbox itself on every animation tick, destroying
  // and recreating them out from under whatever the player was doing with the
  // page. stepPreview() is the exact per-tick step loop() drives from
  // requestAnimationFrame (renderer/forges/sprite/sprite.js), exposed on the
  // mounted Forge so this calls it a known number of times directly instead
  // of waiting on real frames -- a backgrounded or unfocused window throttles
  // requestAnimationFrame unpredictably, which made an earlier, elapsed-time
  // version of this check flaky. 16 is the sample project's own idle
  // animation's frame duration in ticks, so it reliably crosses exactly one
  // frame boundary.
  const spriteForge = window.__app.current;
  const STEPS = 16;

  // Still on the Actors tab from the loop above.
  const findAddActorButton = () =>
    [...document.querySelectorAll('#stage button.btn.btn-sm')].find((b) => b.textContent.trim() === '+');
  const actorAddButton = findAddActorButton();
  if (!actorAddButton) throw new Error('Actors tab has no "+" button to track');
  const actorPreviewCanvas = document.querySelector('#stage .canvas-stage canvas.pixels');
  const actorPreviewBefore = actorPreviewCanvas.toDataURL();
  for (let i = 0; i < STEPS; i++) {
    spriteForge.stepPreview();
    if (findAddActorButton() !== actorAddButton) {
      throw new Error('the Actors tab rebuilt its own "+" button while the preview was running -- item 11 regressed');
    }
  }
  if (actorPreviewCanvas.toDataURL() === actorPreviewBefore) {
    throw new Error(
      'the Actors tab preview never animated -- a fix for item 11 must not silence the preview to stop the DOM churn'
    );
  }
  step('sprite forge actors preview', 'panel DOM held steady across 16 ticks, preview still animates');

  // Same check on the Animations tab, whose own Play checkbox is the control
  // that a shared "not metasprites" render used to destroy every tick too.
  [...document.querySelectorAll('#stage .tab')].find((t) => t.textContent === 'Animations').click();
  await wait(150);
  const findPlayCheckbox = () => document.querySelector('#stage input[type=checkbox]');
  const playCheckbox = findPlayCheckbox();
  if (!playCheckbox) throw new Error('Animations tab has no Play checkbox to track');
  if (!playCheckbox.checked) throw new Error('expected the Animations preview to default to playing');
  const animPreviewCanvas = document.querySelector('#stage .canvas-stage canvas.pixels');
  const animPreviewBefore = animPreviewCanvas.toDataURL();
  for (let i = 0; i < STEPS; i++) {
    spriteForge.stepPreview();
    if (findPlayCheckbox() !== playCheckbox) {
      throw new Error('the Animations tab rebuilt its own Play checkbox while the preview was running -- item 11 regressed');
    }
  }
  if (animPreviewCanvas.toDataURL() === animPreviewBefore) {
    throw new Error(
      'the Animations tab preview never animated -- a fix for item 11 must not silence the preview to stop the DOM churn'
    );
  }
  step('sprite forge animations preview', 'Play checkbox held steady across 16 ticks, preview still animates');

  // The two tabs' previews must have separate clocks, not just a separately
  // gated shared one: pausing Animations and then stepping Actors must not
  // move the frame Animations shows on return, or "paused" only holds while
  // the user never leaves the tab. This check compares exact frame content
  // before and after, unlike the two above, so it cannot tolerate the real
  // requestAnimationFrame loop sneaking in extra ticks alongside the 16
  // manual ones -- an even number of stray ticks on the sample's two-frame
  // animation would land back on identical pixels and hide a shared clock.
  // Tab clicks render synchronously (no await inside their handlers), so with
  // no await wait(...) anywhere in this block, nothing yields to the event
  // loop between capturing the paused snapshot and re-reading it -- the real
  // loop cannot run a single callback in that span, and 16 manual steps are
  // then the only thing that can move either clock.
  playCheckbox.checked = false;
  playCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
  const pausedAnimSnapshot = animPreviewCanvas.toDataURL();

  [...document.querySelectorAll('#stage .tab')].find((t) => t.textContent === 'Actors').click();
  for (let i = 0; i < STEPS; i++) spriteForge.stepPreview();

  [...document.querySelectorAll('#stage .tab')].find((t) => t.textContent === 'Animations').click();
  if (findPlayCheckbox()?.checked !== false) {
    throw new Error('the Animations tab lost its own paused state after a visit to Actors');
  }
  const resumedAnimSnapshot = document.querySelector('#stage .canvas-stage canvas.pixels').toDataURL();
  if (resumedAnimSnapshot !== pausedAnimSnapshot) {
    throw new Error(
      'a paused Animations preview moved while the Actors tab was stepping -- the two previews do not have separate clocks'
    );
  }
  step('sprite forge preview clocks separated', 'pausing Animations then stepping Actors left its frame untouched');

  // ROADMAP item 11 follow-up: the actor's own Idle animation select changes
  // which animation actorPreview is showing without changing state.actor, so
  // a reset keyed only to actor selection never saw it -- neither did an
  // undo of the same edit, since the selected index stays in range either
  // way. Deterministic, same style as above: the select's change handler is
  // synchronous, so no wait() is needed here either.
  //
  // This does not assume the clock is at frame 0 when the block starts --
  // it carries over whatever the earlier checks above left it at, correctly,
  // since a tab visit alone must never reset it. So the baseline for "reset"
  // is established here, by round-tripping Idle once before touching
  // anything else, rather than assumed from a fresh mount.
  [...document.querySelectorAll('#stage .tab')].find((t) => t.textContent === 'Actors').click();
  const findIdleSelect = () =>
    [...document.querySelectorAll('#stage .field')]
      .find((f) => f.querySelector('.field-label')?.textContent === 'Idle animation')
      ?.querySelector('select');
  const idleSelect = findIdleSelect();
  if (!idleSelect) throw new Error('Actors tab has no Idle animation select to track');
  const setIdle = (value) => {
    idleSelect.value = String(value);
    idleSelect.dispatchEvent(new Event('change', { bubbles: true }));
  };
  setIdle(1); // Gem shine -- a different animation, so this is a genuine identity change
  setIdle(0); // back to Slime idle -- another genuine identity change, and a known-fresh clock
  const freshFrame0 = document.querySelector('#stage .canvas-stage canvas.pixels').toDataURL();

  for (let i = 0; i < STEPS; i++) spriteForge.stepPreview();
  const advancedFrame = document.querySelector('#stage .canvas-stage canvas.pixels').toDataURL();
  if (advancedFrame === freshFrame0) {
    throw new Error("the sample actor's idle animation never visibly changed frames -- cannot test the reset");
  }

  // The real check: round-trip Idle again after advancing, and confirm it
  // lands back on the *same* fresh frame 0 captured above -- not just some
  // frame, the specific one a genuine reset produces.
  setIdle(1);
  setIdle(0);
  const afterReselect = document.querySelector('#stage .canvas-stage canvas.pixels').toDataURL();
  if (afterReselect !== freshFrame0) {
    throw new Error('switching the Idle animation away and back did not reset the preview to frame 0');
  }
  step('sprite forge actor idle identity reset', 'switching Idle away and back restarted its own preview clock');

  // ROADMAP item 11 follow-up, second gap: two actors that share the same
  // idle animation (Slime id 0 and Hunter id 2, both animation 0 in the
  // sample project) must still reset the clock when switching between them.
  // Tracking only the resolved animation reference misses this -- the
  // animation itself does not change -- so the actor reference has to be
  // tracked too. Still on Slime (actor 0) with a known-fresh clock from
  // above, captured in freshFrame0.
  for (let i = 0; i < STEPS; i++) spriteForge.stepPreview();
  const beforeActorSwitch = document.querySelector('#stage .canvas-stage canvas.pixels').toDataURL();
  if (beforeActorSwitch === freshFrame0) {
    throw new Error('expected the actor preview to have advanced before switching actors');
  }
  const findActorSelect = () =>
    [...document.querySelectorAll('#stage select')].find((s) => [...s.options].some((o) => o.textContent === 'Hunter'));
  const actorSelect = findActorSelect();
  if (!actorSelect) throw new Error('Actors tab has no actor select with a Hunter option to track');
  actorSelect.value = '2'; // Hunter -- a different actor, same idle animation as Slime
  actorSelect.dispatchEvent(new Event('change', { bubbles: true }));
  const afterActorSwitch = document.querySelector('#stage .canvas-stage canvas.pixels').toDataURL();
  if (afterActorSwitch !== freshFrame0) {
    throw new Error('selecting an actor that shares the same idle animation did not reset the preview to frame 0');
  }
  actorSelect.value = '0'; // back to Slime, so nothing after this depends on which actor was left selected
  actorSelect.dispatchEvent(new Event('change', { bubbles: true }));
  step(
    'sprite forge actor identity reset on shared animation',
    'selecting an actor with the same idle animation still restarted the preview clock'
  );

  // --- Items Forge: round 1d finding D2, round 1e finding E3 --------------
  // The delete race only a real async modal and a real undo can prove: the
  // item a confirmation names must still be the item deleted (or nothing
  // deleted at all) even if the project changes while that confirmation is
  // still open. A unit test cannot reproduce this -- the bug is entirely in
  // the ordering between a real await and a real, independently-firing
  // onProjectChange, not in any pure function's output.
  //
  // Round 1e finding E3: this used to run on the already-opened sample
  // project. store.open() holds the caller's project object by reference
  // and commit() mutates it in place, so pushing A and B mutated
  // sample.value.project.items directly; store.undo() then swapped
  // store.project for a *clone* that excluded B, and the restore commit
  // after this block reset that clone back to the original items -- leaving
  // sample.value.project itself (the object every later sample-based step
  // reopens by reference, not from disk) still carrying A and B, with their
  // hardcoded ids colliding with the sample's own Gem. The restoration
  // assertion never caught it because it read store.project (the clone),
  // not sample.value.project (the thing actually reused later). Reopening
  // the very first project this scenario created (at dir, unused again
  // after its own early save/reload steps, well before the sample project
  // is ever opened) sidesteps the whole hazard: this runs against a
  // disposable object nothing else in this scenario reads from.
  {
    const forItemsRace = await window.forge.project.open(${JSON.stringify(dir)});
    if (!forItemsRace.ok) throw new Error('reopen for the items delete-race test: ' + forItemsRace.error);
    window.__app.store.open(forItemsRace.value.dir, forItemsRace.value.project);
    await wait(200);
    window.__app.goTo('items');
    await wait(200);
    const itemsStore = window.__app.store;
    itemsStore.commit('smoke: add A', (project) => {
      project.items.push({ id: 0, name: 'A', actorId: null, metaspriteId: null, effect: { kind: 'none', amount: 0 } });
    });
    await wait(150);
    itemsStore.commit('smoke: add B', (project) => {
      project.items.push({ id: 1, name: 'B', actorId: null, metaspriteId: null, effect: { kind: 'none', amount: 0 } });
    });
    await wait(150);

    const findItemListSelect = () =>
      [...document.querySelectorAll('#stage select')].find((s) => [...s.options].some((o) => o.textContent === 'B'));
    const listSelect = findItemListSelect();
    if (!listSelect) throw new Error('Items Forge has no item list select with a B option');
    const bOptionIndex = [...listSelect.options].findIndex((o) => o.textContent === 'B');
    if (bOptionIndex === -1) throw new Error('B is not among the item list’s own options');
    listSelect.value = String(bOptionIndex);
    listSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(150);

    const deleteButton = [...document.querySelectorAll('#stage button.btn.btn-sm')].find((b) => b.title === 'Delete');
    if (!deleteButton) throw new Error('Items Forge has no Delete button');
    deleteButton.click();
    await until('the delete confirmation', () => document.querySelector('#modalHost p'));
    const confirmText = document.querySelector('#modalHost p').textContent;
    if (confirmText.indexOf('"B"') === -1) {
      throw new Error('the delete confirmation did not name B: ' + confirmText);
    }

    // The race itself: while the confirmation for B is open, undo the Add of
    // B. store.undo() restores a structuredClone snapshot -- entirely new
    // objects -- so the exact item this dialog captured before the await no
    // longer exists anywhere in the live project once this line runs.
    itemsStore.undo();
    await wait(150);

    const confirmButton = [...document.querySelectorAll('#modalHost button')].find(
      (b) => b.textContent.trim() === 'Delete'
    );
    if (!confirmButton) throw new Error('the delete confirmation has no Delete button');
    confirmButton.click();
    await until('the confirmation to close', () => document.querySelector('#modalHost').hidden);
    await wait(150);

    // B was undone away before the confirmation was answered, so it must be
    // gone regardless of anything this test does; the only question that
    // proves D2 is fixed is whether A -- correctly named in a confirmation
    // that had already resolved by the time the project changed -- survived.
    const namesAfter = itemsStore.project.items.map((i) => i.name);
    if (namesAfter.indexOf('B') !== -1) throw new Error('B should already be gone (undone), but is still present: ' + JSON.stringify(namesAfter));
    if (namesAfter.indexOf('A') === -1) {
      throw new Error('the wrong item was deleted -- A should have survived, items are now: ' + JSON.stringify(namesAfter));
    }
    // Round 1e finding E4: the toast used to say the item "no longer
    // exists", which is false in the common case this guards -- an undo of
    // some unrelated edit leaves the same logical item present as a new
    // object, and indexOf legitimately can't tell "deleted" from "the
    // project changed underneath the confirmation". The wording has to say
    // the true, general thing instead.
    const toastText = [...document.querySelectorAll('#toastHost .toast')].map((n) => n.textContent).join(' | ');
    if (toastText.indexOf('changed') === -1 || toastText.toLowerCase().indexOf('try again') === -1) {
      throw new Error('expected a toast explaining the project changed and asking to try again, saw: ' + toastText);
    }
    step('Items Forge delete race', 'undoing the add mid-confirmation deleted nothing, A survived, toast shown');
  }

  // Round 1f finding F2: the race step above has no positive control --
  // every one of its assertions is also satisfied by a Delete button that
  // is a permanent no-op (B's absence comes from the undo, not from any
  // real deletion; A surviving is what doing nothing produces; the toast
  // is the abandon path's own text). Confirmed the hard way: replacing
  // indexOf's result with a hardcoded -1 still passed every assertion
  // above. This is the missing control -- one ordinary confirmed
  // deletion, no intervening undo.
  //
  // Round 1g finding G2: this used to run in the same disposable project as
  // the race step above, right after it, with C hardcoded to id 1 on the
  // assumption that A (the race step's own leftover) was still sitting at
  // id 0. That made the two steps order-dependent for no real reason, and
  // worse: a future refactor that hoisted "add A" into something shared by
  // both steps could let the race step's own "A survived" check pass
  // falsely against a deletion that removed the wrong item, since some A
  // would still be present either way. Reopening dir fresh -- the same
  // on-disk project the race step's own reopen read, still untouched on
  // disk because none of that step's mutations were ever saved -- gives
  // this its own independent, empty, actually-asserted starting point
  // instead: neither step can borrow the other's state or mask its
  // failure.
  {
    const forPositiveControl = await window.forge.project.open(${JSON.stringify(dir)});
    if (!forPositiveControl.ok) throw new Error('reopen for the items positive-control test: ' + forPositiveControl.error);
    window.__app.store.open(forPositiveControl.value.dir, forPositiveControl.value.project);
    await wait(200);
    window.__app.goTo('items');
    await wait(200);
    const itemsStore = window.__app.store;
    if (itemsStore.project.items.length !== 0) {
      throw new Error('expected a fresh reopen to start with no items, saw: ' + JSON.stringify(itemsStore.project.items));
    }
    if (itemsStore.project.commonEvents.length !== 0 || itemsStore.project.sprites.actors.length !== 0) {
      throw new Error('expected a fresh reopen to start with no common events or actors either');
    }
    //
    // Round 1g finding G1: this used to claim deleting C "exercises both
    // renumberItemDeletion's exact-match path (nothing targets C) and its
    // shift path" -- a contradiction in the same sentence (nothing named C,
    // so the exact-match path was never reached at all), and a real gap: a
    // handler that shifts only Give/Take references greater than the
    // deleted id, ignoring exact matches and ignoring Carrying conditions
    // and monster drops entirely, passed this smoke test before this fix.
    // That handler's worst failure mode is silent, not a crash: a reference
    // left at C's old id after C is gone now names whatever the restamp
    // moved into that slot -- D -- so a Give/Take/Carrying/drop that used
    // to name C would silently start naming D instead, and that wrong
    // reference reaches the ROM. So this now names C directly from four
    // separate places -- a Give command, a Take command, a Carrying
    // condition, and a monster's drop -- covering both remaining code paths
    // in renumberItemDeletion (the Give/Take loop and the two it does not
    // touch), and asserts each becomes NO_ITEM/null rather than following
    // to D. D and E (below) are the shift half of the same proof, kept
    // separately: a handler could satisfy the shift checks while still
    // getting every exact match wrong, or vice versa, so neither stands in
    // for the other.
    itemsStore.commit('smoke: add C, and four references naming it directly', (project) => {
      project.items.push({ id: 0, name: 'C', actorId: null, metaspriteId: null, effect: { kind: 'none', amount: 0 } });
      project.sprites.actors.push({ id: 0, name: 'Monster', behavior: 'npc', damage: 1, battle: { drop: 0 } });
      project.commonEvents.push({
        id: 0,
        name: 'Give C',
        event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'give', item: 0 }] }] }
      });
      project.commonEvents.push({
        id: 1,
        name: 'Take C, Carrying C',
        event: { pages: [{ cond: { type: 'hasItem', arg: 0 }, commands: [{ op: 'take', item: 0 }] }] }
      });
    });
    await wait(150);
    itemsStore.commit('smoke: add D and E, and a reference to each', (project) => {
      project.items.push({ id: 1, name: 'D', actorId: null, metaspriteId: null, effect: { kind: 'none', amount: 0 } });
      project.items.push({ id: 2, name: 'E', actorId: null, metaspriteId: null, effect: { kind: 'none', amount: 0 } });
      project.commonEvents.push({
        id: 2,
        name: 'Give D',
        event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'give', item: 1 }] }] }
      });
      project.commonEvents.push({
        id: 3,
        name: 'Take E',
        event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'take', item: 2 }] }] }
      });
    });
    await wait(150);
    const giveCCommand = () => itemsStore.project.commonEvents[0].event.pages[0].commands[0];
    const takeCCommand = () => itemsStore.project.commonEvents[1].event.pages[0].commands[0];
    const carryingCCond = () => itemsStore.project.commonEvents[1].event.pages[0].cond;
    const monsterDrop = () => itemsStore.project.sprites.actors[0].battle.drop;
    const giveDCommand = () => itemsStore.project.commonEvents[2].event.pages[0].commands[0];
    const takeECommand = () => itemsStore.project.commonEvents[3].event.pages[0].commands[0];
    // Round 1 review, ride-along P3: this used to hardcode 255, duplicating
    // shared/project.js's own NO_ITEM. Importing the real constant means a
    // sentinel change cannot make this smoke test silently disagree with
    // production.
    const { NO_ITEM: NO_ITEM_SENTINEL } = await import('../shared/project.js');

    const findOptionByText = (text) =>
      [...document.querySelectorAll('#stage select')].find((s) => [...s.options].some((o) => o.textContent === text));
    const listSelectForC = findOptionByText('C');
    if (!listSelectForC) throw new Error('Items Forge has no item list select with a C option');
    const cOptionIndex = [...listSelectForC.options].findIndex((o) => o.textContent === 'C');
    listSelectForC.value = String(cOptionIndex);
    listSelectForC.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(150);

    const deleteButtonForC = [...document.querySelectorAll('#stage button.btn.btn-sm')].find((b) => b.title === 'Delete');
    if (!deleteButtonForC) throw new Error('Items Forge has no Delete button for the positive-control delete');
    deleteButtonForC.click();
    await until('the C delete confirmation', () => document.querySelector('#modalHost p'));
    const cConfirmText = document.querySelector('#modalHost p').textContent;
    if (cConfirmText.indexOf('"C"') === -1) throw new Error('the delete confirmation did not name C: ' + cConfirmText);
    const confirmButtonForC = [...document.querySelectorAll('#modalHost button')].find(
      (b) => b.textContent.trim() === 'Delete'
    );
    if (!confirmButtonForC) throw new Error('the C delete confirmation has no Delete button');
    confirmButtonForC.click();
    await until('the C confirmation to close', () => document.querySelector('#modalHost').hidden);
    await wait(150);

    function assertPostDeleteState(label) {
      const items = itemsStore.project.items;
      const names = items.map((i) => i.name);
      if (JSON.stringify(names) !== JSON.stringify(['D', 'E'])) {
        throw new Error(label + ': expected exactly D and E to remain after deleting C, got: ' + JSON.stringify(names));
      }
      items.forEach((entry, position) => {
        if (entry.id !== position) {
          throw new Error(label + ': id restamp did not run -- ' + entry.name + ' has id ' + entry.id + ' at position ' + position);
        }
      });
      if (giveCCommand().item !== null) {
        throw new Error(label + ': the Give command naming C directly must become null, not follow to D -- got ' + giveCCommand().item);
      }
      if (takeCCommand().item !== null) {
        throw new Error(label + ': the Take command naming C directly must become null, not follow to D -- got ' + takeCCommand().item);
      }
      if (carryingCCond().arg !== NO_ITEM_SENTINEL) {
        throw new Error(label + ': the Carrying condition naming C directly must become NO_ITEM, not follow to D -- got ' + carryingCCond().arg);
      }
      if (monsterDrop() !== null) {
        throw new Error(label + ': the monster’s drop naming C directly must become null, not follow to D -- got ' + monsterDrop());
      }
      if (giveDCommand().item !== 0) {
        throw new Error(label + ': the Give command should still name D (now id 0) after C was deleted, but names ' + giveDCommand().item);
      }
      if (takeECommand().item !== 1) {
        throw new Error(label + ': the Take command should still name E (now id 1) after C was deleted, but names ' + takeECommand().item);
      }
    }
    assertPostDeleteState('after delete');
    step(
      'Items Forge positive-control delete',
      'C deleted, D/E survived with restamped ids; the four references naming C directly became NO_ITEM/null, and the Give/Take shifts for D and E followed correctly'
    );

    // Undo must restore the array and every reference together, and redo
    // must re-apply all of them -- not just the array, which a shift-only
    // or a restamp-only implementation could still get half right.
    itemsStore.undo();
    await wait(150);
    const namesAfterUndo = itemsStore.project.items.map((i) => i.name);
    if (JSON.stringify(namesAfterUndo) !== JSON.stringify(['C', 'D', 'E'])) {
      throw new Error('undo should restore C, D, E in order, got: ' + JSON.stringify(namesAfterUndo));
    }
    if (giveCCommand().item !== 0) throw new Error('undo should restore the Give-C command to id 0, got ' + giveCCommand().item);
    if (takeCCommand().item !== 0) throw new Error('undo should restore the Take-C command to id 0, got ' + takeCCommand().item);
    if (carryingCCond().arg !== 0) throw new Error('undo should restore the Carrying-C condition to id 0, got ' + carryingCCond().arg);
    if (monsterDrop() !== 0) throw new Error('undo should restore the monster’s drop to id 0, got ' + monsterDrop());
    if (giveDCommand().item !== 1) throw new Error('undo should restore the Give command to D’s original id 1, got ' + giveDCommand().item);
    if (takeECommand().item !== 2) throw new Error('undo should restore the Take command to E’s original id 2, got ' + takeECommand().item);

    itemsStore.redo();
    await wait(150);
    assertPostDeleteState('after redo');
    step('Items Forge positive-control delete: undo/redo', 'the item array and all four references tracked the delete and its reversal together');
  }

  // Round 1e finding E3's own verification, not just reasoning about it: the
  // shared sample fixture must carry no trace of either Items Forge block
  // above, checked directly rather than assumed from "neither referenced
  // it".
  const sampleItemNames = sample.value.project.items.map((i) => i.name);
  for (const stray of ['A', 'B', 'C', 'D', 'E']) {
    if (sampleItemNames.indexOf(stray) !== -1) {
      throw new Error('the sample fixture was contaminated by the items tests: ' + JSON.stringify(sampleItemNames));
    }
  }

  // Back to the sample project, unmodified: this block never touched
  // sample.value.project, so re-opening it is a clean switch of context, not
  // a restoration of anything -- the steps below expect the sample's own
  // song data, same as before this block ran.
  window.__app.store.open(sample.value.dir, sample.value.project);
  await wait(200);

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
  // The run loop paces itself by wall-clock time (renderer/emulator/player.js),
  // so a fixed sleep here is a bet on how fast this machine actually delivers
  // requestAnimationFrame callbacks -- a bet a throttled or contended window
  // can lose outright, landing every read below on RAM from before
  // init_session has run at all (still $FF, the NES's own power-on fill)
  // rather than on a genuinely booted game. This is exactly the "fixed sleep
  // is a bet" the until() helper above exists to avoid.
  //
  // A readiness predicate must exclude the power-on fill, not merely differ
  // from the idle value -- this line has cost three rounds learning that the
  // hard way, so the rule, not just the third patch, belongs here:
  //
  //   The NES's own power-on RAM state (engine/boot.asm's comment, and what
  //   jsnes fills fresh RAM with) is $FF, not $00 and not whatever an "idle"
  //   reading of a byte happens to look like. A predicate is only safe once
  //   it is checked against BOTH: the value the byte holds before init runs
  //   (which is $FF, unconditionally, for every byte in $0000-$07FF, until
  //   boot_clear's own sweep reaches it) AND the value some *other* boot step
  //   writes before the one this cares about (boot_clear's own zero fill,
  //   here). "differs from 0" is not that check -- $FF differs from 0 too.
  //
  // Two failures already happened on this exact line from skipping that:
  // game_state (0) is what boot_clear itself writes, so ST_GAMEPLAY/RPG's
  // own target is indistinguishable from "not booted yet"; and player_hp
  // reading "!== 0" is ALSO satisfied by $FF, the power-on fill it starts at
  // -- so a throttled renderer could observe the exact boot_clear boundary
  // where game_state ($25) has just been zeroed but player_hp ($4E, later in
  // the same $0000-$07FF sweep) has not, and wrongly call that "booted".
  // Proven empirically, not assumed: stepping this ROM instruction by
  // instruction from reset, player_hp reads $FF (satisfying "!== 0") for
  // 16614 straight instructions before it is genuinely in range.
  //
  // player_hp ($4E) is still the right byte -- init_session sets it to
  // MAX_HEARTS unconditionally, for both action and RPG builds -- but the
  // predicate has to be its real range, 1-6 (shared/project.js's own clamp
  // on maxHearts), which $FF fails and 0 fails and only a genuine post-init
  // value satisfies.
  //
  // game_state itself is safe to poll here, unlike the RPG build's own
  // target below: ST_TITLE (3) is written only once, in the .if
  // TITLE_ENABLED block that runs strictly after init_session (boot.asm),
  // and boot_clear only ever writes 0 -- never 3 -- so nothing before that
  // one write can produce it by coincidence. Also verified empirically, not
  // merely read off the source: game_state reaches 3 at instruction 16729,
  // after player_hp is already in its valid range (16614) -- there is no
  // window where this build's own game_state target arrives early.
  await until(
    'the sample to boot into its title screen',
    () => {
      const emulator = window.__app.current?.player?.emulator;
      if (!emulator) return false;
      const playerHp = emulator.peek(0x004e);
      return playerHp >= 1 && playerHp <= 6 && emulator.peek(0x0025) === 3;
    },
    20000
  );
  const playCanvas = [...document.querySelectorAll('#stage canvas')].find(
    (c) => c.width === 256 && c.height === 240
  );
  if (!playCanvas) throw new Error('the play view never showed a 256x240 screen');
  step('build & play UI', 'emulator mounted in the Build panel');

  // --- switch/variable inspector: a labelled view of the same engine RAM the
  // Memory tab already shows as unlabelled hex (ROADMAP item 3) ------------
  const debugBtn = [...document.querySelectorAll('#stage button')].find((b) => b.textContent.includes('Debugger'));
  if (!debugBtn) throw new Error('debugger toggle button not found');
  debugBtn.click();
  await wait(150);
  const switchesTab = document.querySelector('#stage [data-tab="switches"]');
  if (!switchesTab) throw new Error('the Switches tab was not offered in the debugger');
  switchesTab.click();
  await wait(150);

  const switchRows = [...document.querySelectorAll('#stage [data-switch]')];
  if (switchRows.length !== 64) throw new Error('expected 64 switch rows, saw ' + switchRows.length);
  const namedRow = switchRows.find((row) => row.textContent.indexOf('Chest opened') !== -1);
  if (!namedRow) throw new Error('the named switch from the sample project was not shown labelled');
  // No regex literal here: \d would reach this template literal's own parser
  // (see the "No backticks in this scenario" note above), not the renderer.
  const isUnnamedSwitchLabel = (text) =>
    text.indexOf('Switch ') === 0 && [...text.slice(7)].every((ch) => ch >= '0' && ch <= '9') && text.length > 7;
  const unnamedRow = switchRows.find((row) => isUnnamedSwitchLabel(row.textContent.trim()));
  if (!unnamedRow) throw new Error('an unnamed switch should still appear, labelled by its index');

  const varRows = [...document.querySelectorAll('#stage [data-variable]')];
  if (varRows.length !== 16) throw new Error('expected 16 variable rows (NUM_VARIABLES), saw ' + varRows.length);

  const buildEmu = window.__app.current.player.emulator;
  // switches = $0390 (engine/constants.asm): bit 0 of byte 0 is switch 0, the
  // sample's own "Chest opened" -- unset on a fresh boot.
  if (buildEmu.peek(0x0390) & 1) throw new Error('switch 0 should start off on a fresh boot');
  const chestCheckbox = namedRow.querySelector('input[type="checkbox"]');
  if (chestCheckbox.checked) throw new Error('the labelled row disagrees with engine RAM before any edit');

  // Poke a different switch directly, the way a running game would, then force
  // a refresh by leaving the tab and coming back -- proving the panel actually
  // reads RAM on refresh rather than only rendering once at open.
  buildEmu.poke(0x0390, 0x04); // switch 2 on
  document.querySelector('#stage [data-tab="memory"]').click();
  await wait(80);
  switchesTab.click();
  await wait(80);
  const switch2 = document.querySelector('#stage [data-switch="2"] input');
  if (!switch2.checked) throw new Error('the panel did not pick up a switch changed in RAM on refresh');

  // And the write path: clicking the checkbox has to poke RAM, not just the DOM.
  const namedCheckbox = document.querySelector('#stage [data-switch="0"] input');
  namedCheckbox.click();
  await wait(80);
  if (!(buildEmu.peek(0x0390) & 1)) throw new Error('toggling the labelled switch row did not poke engine RAM');

  // variables = $0500 (engine/constants.asm): one byte per counter.
  const varInput = document.querySelector('#stage [data-variable="0"] input');
  varInput.value = '42';
  varInput.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(80);
  if (buildEmu.peek(0x0500) !== 42) throw new Error('editing the labelled variable row did not poke engine RAM');

  // A periodic refresh (the same 30-frame tick the CPU/PPU panels already use)
  // must not tear down a variable input the user is still typing into -- the
  // exact defect class ROADMAP item 11 already fixed once for the Sprite
  // Forge's preview loop, now checked here so it cannot come back in the
  // inspector's own refresh. Driven through refreshPanels() itself -- the
  // exact per-tick call the run loop makes -- rather than waiting on real
  // requestAnimationFrame callbacks, which a throttled or unfocused window
  // may never deliver 30 of: a wait-based version of this assertion can pass
  // by never actually exercising a refresh at all.
  const focusInput = document.querySelector('#stage [data-variable="3"] input');
  focusInput.focus();
  focusInput.value = '77';
  focusInput.dispatchEvent(new Event('input', { bubbles: true })); // typing, not yet committed
  for (let i = 0; i < 3; i++) window.__app.current.player.refreshPanels();
  if (document.activeElement !== focusInput) {
    throw new Error('the variable input lost focus during a periodic refresh while mid-edit');
  }
  if (focusInput.value !== '77') {
    throw new Error('a periodic refresh clobbered a variable input mid-edit: now shows "' + focusInput.value + '"');
  }
  if (buildEmu.peek(0x0503) !== 0) throw new Error('an uncommitted edit should not have reached RAM yet');
  focusInput.dispatchEvent(new Event('change', { bubbles: true })); // commit
  await wait(80);
  if (buildEmu.peek(0x0503) !== 77) throw new Error('committing the edit after the refresh did not poke engine RAM');

  // A fractional entry must be truncated the same way emulator.poke's own
  // "& 0xff" truncates it, so the field and RAM cannot disagree.
  const fracInput = document.querySelector('#stage [data-variable="4"] input');
  fracInput.value = '42.9';
  fracInput.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(80);
  if (fracInput.value !== '42') throw new Error('a fractional entry should display truncated, saw "' + fracInput.value + '"');
  if (buildEmu.peek(0x0504) !== 42) {
    throw new Error('a fractional entry should poke the truncated integer, RAM has ' + buildEmu.peek(0x0504));
  }

  step(
    'switch/variable inspector',
    '64 switches + 16 variables, labelled, read/poked live, survives a mid-edit refresh, truncates fractions'
  );

  // --- invincibility / encounters-off / collision-off toggles (ROADMAP item 3,
  // after the inspector above) -- a click has to move real Emulator state, not
  // just the checkbox's own DOM, or an unwired control would pass this test by
  // producing no console error and nothing else. --------------------------
  const togglesTab = document.querySelector('#stage [data-tab="toggles"]');
  if (!togglesTab) throw new Error('the Toggles tab was not offered in the debugger');
  togglesTab.click();
  await wait(150);

  const toggleRows = [...document.querySelectorAll('#stage [data-toggle]')];
  if (toggleRows.length !== 3) throw new Error('expected 3 toggle rows, saw ' + toggleRows.length);

  // sample/ is an action build: encounters off has nothing to operate on
  // (no check_encounter at all) and must say so rather than look clickable.
  const encountersInput = document.querySelector('#stage [data-toggle="encounters"] input');
  if (!encountersInput.disabled) throw new Error('encounters off should be disabled on an action build');
  const encountersHint = document.querySelector('#stage [data-toggle="encounters"] .hint');
  if (!encountersHint || encountersHint.textContent.indexOf('no wandering encounters') === -1) {
    throw new Error('the disabled encounters toggle did not say why');
  }

  const invincibilityInput = document.querySelector('#stage [data-toggle="invincibility"] input');
  const collisionInput = document.querySelector('#stage [data-toggle="collision"] input');
  if (invincibilityInput.disabled || collisionInput.disabled) {
    throw new Error('invincibility and collision off should both be available on any build');
  }
  if (buildEmu.testOverrides.invincibility || buildEmu.testOverrides.collision) {
    throw new Error('a fresh build should not have any toggle on already');
  }

  // setTestOverrides() merges the boolean regardless of whether anything was
  // ever resolved/armed -- it would do that even if mountPlayer's own call to
  // configureTestOverrides() were deleted entirely, leaving the checkbox
  // fully wired to DOM and completely inert against the running ROM. This is
  // the check that catches exactly that: a resolved spec, and the matching
  // trap actually present in the armed table, before any click happens.
  function assertArmed(emulator, name) {
    const spec = emulator.overrideTargets && emulator.overrideTargets[name];
    if (!spec) throw new Error('the mounted emulator never resolved a ' + name + ' override target');
    if (!emulator.interceptsByTrap.has(spec.trap)) {
      throw new Error("the " + name + " trap address is not armed in the mounted emulator's intercept table");
    }
  }
  assertArmed(buildEmu, 'invincibility');
  assertArmed(buildEmu, 'collision');

  invincibilityInput.click();
  await wait(50);
  if (!buildEmu.testOverrides.invincibility) throw new Error('clicking the invincibility checkbox did not arm the Emulator override');
  if (buildEmu.testOverrides.collision) throw new Error('clicking invincibility should not have also armed collision');

  collisionInput.click();
  await wait(50);
  if (!buildEmu.testOverrides.collision) throw new Error('clicking the collision checkbox did not arm the Emulator override');

  invincibilityInput.click(); // back off
  await wait(50);
  if (buildEmu.testOverrides.invincibility) throw new Error('unchecking invincibility did not disarm the Emulator override');
  if (!buildEmu.testOverrides.collision) throw new Error('unchecking invincibility should not have also disarmed collision');

  step('invincibility/encounters-off/collision-off toggles', '3 rows, RPG-only encounters labelled unavailable, clicks reach Emulator state');

  // --- the same Toggles tab, against an RPG build: the action sample above
  // can only ever show encounters off *disabled*, so nothing yet has clicked
  // it while it is live. Reusing the exact project.open + store.open +
  // buildAndPlay path already exercised for the action sample, just pointed
  // at sample-rpg -- not a special-cased flow. ------------------------------
  const sampleRpg = await window.forge.project.open(${JSON.stringify(sampleRpgDir)});
  if (!sampleRpg.ok) throw new Error('open sample-rpg: ' + sampleRpg.error);
  window.__app.store.open(sampleRpg.value.dir, sampleRpg.value.project);
  await wait(200);
  window.__app.goTo('build');
  await wait(300);

  // The Build panel's "Battle system" meter, read out of the DOM it actually
  // rendered. This has to happen here rather than in a unit test: the
  // invariant is that the *renderer* shows the same two numbers the capacity
  // check decides on, and a unit test that calls battleRegionBytes itself
  // proves only that the function agrees with the function. An earlier version
  // of this check lived in test/unit/bankedbytes.test.js and never imported
  // the renderer at all, so changing the meter's expression would not have
  // failed it. The main process asserts the numbers below; all this does is
  // report what was on screen.
  //
  // sample-rpg is the only RPG the smoke test opens, and the meter is RPG-only
  // (a project that is not one reserves no such region), so this is the one
  // place the meter is on screen at all.
  const readBattleMeter = () => {
    // Any .kv in the document whose label is exactly "Battle system" -- the
    // Build panel's summary div carries no id, and the meter's own label is
    // unique, so matching on it beats depending on the container's shape.
    const row = [...document.querySelectorAll('.kv')].find(
      (node) => node.firstElementChild && node.firstElementChild.textContent.trim() === 'Battle system'
    );
    if (!row) return null;
    // Split rather than match: this whole scenario is a template literal, so a
    // regex escape here would be eaten before the renderer ever sees it.
    const parts = row.lastElementChild.textContent.split('/');
    if (parts.length !== 2) return null;
    const used = Number(parts[0].trim());
    const total = Number(parts[1].trim());
    return Number.isFinite(used) && Number.isFinite(total) ? { used, total } : null;
  };
  const meterFits = readBattleMeter();
  if (!meterFits) throw new Error('the Build panel showed no "Battle system" meter for an RPG project');

  // ...and again past the ceiling, so the boundary itself is crossed on screen
  // rather than only the comfortable side of it being checked. Enough actors
  // to overflow an 8 KB region; the exact count does not matter, only that the
  // meter and the capacity check change their minds about the same project.
  window.__app.store.commit('smoke: overflow the battle region', (draft) => {
    const template = draft.sprites.actors[draft.sprites.actors.length - 1];
    for (let i = 0; i < 200; i++) {
      draft.sprites.actors.push({ ...structuredClone(template), id: draft.sprites.actors.length, name: 'M' + i });
    }
  });
  await wait(300);
  const meterOver = readBattleMeter();
  if (!meterOver) throw new Error('the "Battle system" meter vanished once the project overflowed');
  report.battleMeter = { fits: meterFits, over: meterOver, overProject: structuredClone(window.__app.store.project) };
  step(
    'Build panel battle-system meter rendered',
    meterFits.used + '/' + meterFits.total + ' fitting, ' + meterOver.used + '/' + meterOver.total + ' overflowing'
  );

  // Back to the pristine project before anything is built. Re-read from disk
  // rather than reusing the object already handed to store.open, so nothing
  // the commit above touched can survive into the build below.
  const sampleRpgAgain = await window.forge.project.open(${JSON.stringify(sampleRpgDir)});
  if (!sampleRpgAgain.ok) throw new Error('re-open sample-rpg: ' + sampleRpgAgain.error);
  window.__app.store.open(sampleRpgAgain.value.dir, sampleRpgAgain.value.project);
  await wait(200);
  window.__app.goTo('build');
  await wait(300);

  await window.__app.current.buildAndPlay();
  // sample-rpg has no title screen (project.titleMap is null), so game_state
  // settles at ST_GAMEPLAY = 0 once boot finishes -- the same value
  // boot_clear itself writes as part of its blanket $0000-$07FF clear,
  // before mapper_init, chr_ram_init, load_palette or init_session have run
  // at all, so game_state alone cannot tell "booted" from "not booted yet"
  // here. See the general rule and its evidence above (the action sample's
  // own readiness poll): a readiness predicate must exclude the power-on
  // fill, not merely differ from the idle value -- player_hp reading "!== 0"
  // is NOT that check, since $FF (what it holds at power-on) also satisfies
  // it. player_hp's real range is 1-6 (MAX_HEARTS, clamped by
  // shared/project.js), which only a genuine init_session run produces;
  // proven empirically for this exact build too, not assumed from the
  // action sample alone: player_hp reads $FF (an old "!== 0" pass) for
  // 16649 straight instructions from reset before it is genuinely in range.
  await until(
    'the RPG build to boot into gameplay',
    () => {
      const emulator = window.__app.current?.player?.emulator;
      if (!emulator) return false;
      const playerHp = emulator.peek(0x004e);
      return playerHp >= 1 && playerHp <= 6 && emulator.peek(0x0025) === 0;
    },
    20000
  );
  const rpgPlayCanvas = [...document.querySelectorAll('#stage canvas')].find(
    (c) => c.width === 256 && c.height === 240
  );
  if (!rpgPlayCanvas) throw new Error('the RPG build never showed a 256x240 screen');

  const rpgDebugBtn = [...document.querySelectorAll('#stage button')].find((b) => b.textContent.includes('Debugger'));
  if (!rpgDebugBtn) throw new Error('debugger toggle button not found on the RPG build');
  rpgDebugBtn.click();
  await wait(150);
  const rpgTogglesTab = document.querySelector('#stage [data-tab="toggles"]');
  if (!rpgTogglesTab) throw new Error('the Toggles tab was not offered for the RPG build');
  rpgTogglesTab.click();
  await wait(150);

  const rpgEncountersInput = document.querySelector('#stage [data-toggle="encounters"] input');
  if (!rpgEncountersInput) throw new Error('the encounters row was not offered for the RPG build');
  if (rpgEncountersInput.disabled) throw new Error('encounters off should be enabled on an RPG build (BATTLE_ENABLED)');
  const rpgEncountersHint = document.querySelector('#stage [data-toggle="encounters"] .hint');
  if (!rpgEncountersHint || rpgEncountersHint.textContent.indexOf('Wandering encounters off') === -1) {
    throw new Error('the RPG build should show the "on" copy, not the action-build unavailability message');
  }

  const rpgEmu = window.__app.current.player.emulator;
  if (rpgEmu.testOverrides.encounters) throw new Error('a fresh RPG build should not have encounters on already');
  assertArmed(rpgEmu, 'encounters');
  rpgEncountersInput.click();
  await wait(50);
  if (!rpgEmu.testOverrides.encounters) throw new Error('clicking the RPG encounters checkbox did not arm the Emulator override');
  rpgEncountersInput.click();
  await wait(50);
  if (rpgEmu.testOverrides.encounters) throw new Error('unchecking the RPG encounters checkbox did not disarm the Emulator override');

  step('encounters-off toggle on an RPG build', 'enabled with the RPG copy, clicks reach Emulator state');

  // --- battle-test: fire a chosen encounter from the Map Forge without
  // walking into it (ROADMAP item 3's last bullet), on the RPG build still
  // open above. Both entry points, and both checked against real Emulator
  // RAM -- a toast alone cannot tell "started the requested fight" apart
  // from "silently failed and fell back to playing from the start". -------
  await window.__app.goTo('map');
  await wait(300);
  const battleTestHead = [...document.querySelectorAll('#stage .panel-head')].find(
    (h) => h.textContent.trim() === 'Battle-test'
  );
  if (!battleTestHead) throw new Error('the Map Forge did not offer a Battle-test section for the RPG build');
  const tableBtn = [...document.querySelectorAll('#stage button')].find((b) => b.textContent.includes("This map's table"));
  if (!tableBtn) throw new Error("the map's own table battle-test button was not offered");
  if (tableBtn.disabled) throw new Error("Starfall Plain's encounter table should not read as empty");
  tableBtn.click();
  await until('battle-test (map table) to build and boot', () => window.__app.current?.player?.emulator, 60000);
  const tableEmu = window.__app.current.player.emulator;
  // Engine RAM, from engine/constants.asm: game_state ($25), bt_phase ($53),
  // mon_slot_actor ($03BC, 4 bytes). Starfall Plain's own table
  // (sample-rpg/maps/0.json: encounters.actorIds = [0], Slime) compiles to
  // [0, $FF, $FF, $FF].
  if (tableEmu.peek(0x0025) !== 5) {
    throw new Error('battle-test (map table) did not land in ST_BATTLE, game_state is ' + tableEmu.peek(0x0025));
  }
  // bt_phase is deliberately not asserted here: the moment .emulator exists,
  // setRunning(true) has already scheduled the real run loop
  // (renderer/emulator/player.js), and until() polls for it on real 25ms
  // setTimeout boundaries -- real wall-clock time a throttled or contended
  // window can use to have already ticked a real battle frame forward,
  // legitimately advancing bt_phase past BP_INTRO before this read. That
  // exact postcondition is already covered deterministically, with no rAF in
  // the loop at all, by test/unit/battletest.test.js.
  const tableFormation = [0, 1, 2, 3].map((slot) => tableEmu.peek(0x03bc + slot));
  if (tableFormation.join(',') !== '0,255,255,255') {
    throw new Error("battle-test (map table) formation was [" + tableFormation.join(',') + '], expected [0,255,255,255]');
  }
  step('battle-test: map encounter table', 'Slime formation landed, ST_BATTLE/BP_INTRO confirmed in Emulator RAM');

  // Second entry point: an arbitrary formation picked by hand -- proves the
  // free-form picker's checkboxes actually reach the compiled formation the
  // emulator receives, not just the map's own table.
  await window.__app.goTo('map');
  await wait(300);
  const snakeCheckbox = [...document.querySelectorAll('#stage label.check')]
    .find((label) => label.textContent.includes('Snake'))
    ?.querySelector('input');
  if (!snakeCheckbox) throw new Error('the free-form battle-test picker did not offer Snake');
  snakeCheckbox.click();
  await wait(100);
  const formationBtn = [...document.querySelectorAll('#stage button')].find((b) => b.textContent.includes('Chosen formation'));
  if (!formationBtn) throw new Error('the "chosen formation" battle-test button was not offered');
  if (formationBtn.disabled) throw new Error('picking Snake should have enabled the chosen-formation button');
  formationBtn.click();
  await until('battle-test (chosen formation) to build and boot', () => window.__app.current?.player?.emulator, 60000);
  const pickEmu = window.__app.current.player.emulator;
  if (pickEmu.peek(0x0025) !== 5) {
    throw new Error('battle-test (chosen formation) did not land in ST_BATTLE, game_state is ' + pickEmu.peek(0x0025));
  }
  const pickFormation = [0, 1, 2, 3].map((slot) => pickEmu.peek(0x03bc + slot));
  if (pickFormation.join(',') !== '3,255,255,255') {
    throw new Error(
      "battle-test (chosen formation) formation was [" + pickFormation.join(',') + '], expected [3,255,255,255] (Snake alone)'
    );
  }
  step('battle-test: chosen formation', 'Snake-alone formation reaches the emulator, distinct from the map table');

  // A second map, with its own distinct encounter table -- proving the "This
  // map's table" entry point reads whichever map is actually selected
  // (state.mapIndex) rather than always Starfall Plain at index 0, which the
  // steps above alone cannot tell apart from a hardcoded map 0.
  await window.__app.goTo('map');
  await wait(300);
  document.querySelector('#stage [title="Add a map"]').click();
  await wait(150);
  const newMapSlot0 = document.querySelector('#stage [data-encounter-slot="0"]');
  if (!newMapSlot0) throw new Error('the new map has no encounter-table slot 0 to configure');
  const snakeOption = [...newMapSlot0.options].find((o) => o.textContent === 'Snake');
  if (!snakeOption) throw new Error('the new map’s encounter-table slot did not offer Snake');
  newMapSlot0.value = snakeOption.value;
  newMapSlot0.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(150);
  const secondMapBtn = [...document.querySelectorAll('#stage button')].find((b) => b.textContent.includes("This map's table"));
  if (!secondMapBtn) throw new Error("the second map's own table battle-test button was not offered");
  if (secondMapBtn.disabled) throw new Error("the second map's encounter table should not read as empty after being set");
  secondMapBtn.click();
  await until('battle-test (second map) to build and boot', () => window.__app.current?.player?.emulator, 60000);
  const secondMapEmu = window.__app.current.player.emulator;
  if (secondMapEmu.peek(0x0025) !== 5) {
    throw new Error('battle-test (second map) did not land in ST_BATTLE, game_state is ' + secondMapEmu.peek(0x0025));
  }
  const secondMapFormation = [0, 1, 2, 3].map((slot) => secondMapEmu.peek(0x03bc + slot));
  if (secondMapFormation.join(',') !== '3,255,255,255') {
    throw new Error(
      'battle-test (second map) formation was [' +
        secondMapFormation.join(',') +
        '], expected [3,255,255,255] (Snake, this map’s own table) -- not Starfall Plain’s'
    );
  }
  step('battle-test: second map’s own table', "Snake formation from the newly added map, not Starfall Plain's Slime");

  // A monster's damage edited down to zero must not hide "This map's table":
  // mapEncounterFormation (shared/project.js), the compiler's own single
  // writer for what a map's wandering table contains, does not filter by
  // damage at all, so Starfall Plain's compiled table still runs a real
  // Slime encounter regardless of what Slime's own damage now reads. Gating
  // the button on isMonsterActor (damage > 0) independently -- which an
  // earlier version of this feature did -- is the exact "three places give
  // three different answers" trap CLAUDE.md's effectiveTrigger section
  // describes, just for "what does this map encounter" instead of triggers.
  // battleTest() (renderer/forges/map/map.js) navigates to the Build panel
  // to fire the fight it just clicked, so the previous step ends there, not
  // on the Map Forge -- back to map before looking for anything in it.
  await window.__app.goTo('map');
  await wait(300);
  store.commit('smoke zero every actor damage', (project) => {
    project.sprites.actors.forEach((actor) => (actor.damage = 0));
  });
  await wait(120);
  const mapSelect = [...document.querySelectorAll('#stage select')].find((s) =>
    [...s.options].some((o) => o.textContent === 'Starfall Plain')
  );
  if (!mapSelect) throw new Error('the map selector no longer offers Starfall Plain');
  mapSelect.value = '0';
  mapSelect.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(150);
  const zeroDamageBtn = [...document.querySelectorAll('#stage button')].find((b) => b.textContent.includes("This map's table"));
  if (!zeroDamageBtn) {
    throw new Error(
      "the map's own table button disappeared once every actor read as non-hostile, even though Starfall " +
        "Plain's compiled table still places a real Slime encounter"
    );
  }
  if (zeroDamageBtn.disabled) throw new Error("Starfall Plain's own table should still read non-empty after a damage edit alone");
  // The hand-picked picker is correctly narrower, and should say so instead
  // of offering checkboxes for nothing.
  const noHostileHint = [...document.querySelectorAll('#stage p.hint')].some((p) =>
    p.textContent.includes('nothing to hand-pick a formation from')
  );
  if (!noHostileHint) throw new Error('the free-form picker should explain why it is offering nothing, once no actor reads as hostile');
  zeroDamageBtn.click();
  await until('battle-test (zero-damage actor) to build and boot', () => window.__app.current?.player?.emulator, 60000);
  const zeroDamageEmu = window.__app.current.player.emulator;
  if (zeroDamageEmu.peek(0x0025) !== 5) {
    throw new Error('battle-test (zero-damage actor) did not land in ST_BATTLE, game_state is ' + zeroDamageEmu.peek(0x0025));
  }
  const zeroDamageFormation = [0, 1, 2, 3].map((slot) => zeroDamageEmu.peek(0x03bc + slot));
  if (zeroDamageFormation.join(',') !== '0,255,255,255') {
    throw new Error(
      'battle-test (zero-damage actor) formation was [' + zeroDamageFormation.join(',') + '], expected [0,255,255,255] (Slime)'
    );
  }
  step(
    'battle-test: a zero-damage actor already in the table',
    "the map's own table stays offered and fires the real compiled encounter, even once no actor reads as hostile"
  );

  // Back to the action sample for the rest of this scenario: the RPG
  // excursion above was self-contained, and "play from here" below expects
  // the action sample's own map layout.
  window.__app.store.open(sample.value.dir, sample.value.project);
  await wait(200);

  // --- play from here: the Map Forge's Test tool, clicked for real ---------
  // The whole path only exists in the app: the tool reads the selected screen,
  // the Build panel reads the engine constants back out of the build over IPC,
  // and the player pokes them. Where the player ended up is engine RAM, which
  // no amount of looking at the screen can tell you.
  await window.__app.goTo('map');
  await wait(300);
  const testThumbs = [...document.querySelectorAll('#stage canvas')].filter((c) => c.width === 64 && c.height === 60);
  if (testThumbs.length < 4) throw new Error('the navigator showed ' + testThumbs.length + ' screens, expected 4');
  testThumbs[3].click(); // Greenwood's far corner: not where the cartridge starts
  await wait(200);
  document.querySelector('#stage [data-tool="play"]').click();
  const testCanvas = document.querySelector('#stage .canvas-stage canvas.pixels');
  const testBox = testCanvas.getBoundingClientRect();
  const testCol = 3, testRow = 4; // metatile cell -> 48,64 in screen pixels
  testCanvas.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    button: 0,
    clientX: testBox.left + ((testCol + 0.5) / 16) * testBox.width,
    clientY: testBox.top + ((testRow + 0.5) / 15) * testBox.height
  }));
  await until('play from here to build and boot', () => window.__app.current?.player?.emulator, 60000);
  const testEmu = window.__app.current.player.emulator;
  // Engine RAM, from engine/constants.asm: flat_screen, player_x, player_y and
  // game_state. Screen 3 is the fourth screen of the first map, and reaching
  // gameplay without a Start press means the title screen was skipped too.
  if (testEmu.peek(0x0016) !== 3) throw new Error('play from here landed on screen ' + testEmu.peek(0x0016));
  if (testEmu.peek(0x0010) !== 48 || testEmu.peek(0x0011) !== 64) {
    throw new Error('player is at ' + testEmu.peek(0x0010) + ',' + testEmu.peek(0x0011) + ', expected 48,64');
  }
  if (testEmu.peek(0x0025) !== 0) throw new Error('play from here did not get past the title screen');
  step('play from here', 'screen 3 at 48,64, title skipped');

  // And the cartridge that just built is the one the user would ship: reset it
  // and it boots into its own title screen at the authored start. This is the
  // honesty rule end to end -- the unit test can only say the RAM helper does
  // not patch anything, while this is the whole Map Forge to Build path.
  testEmu.reset();
  for (let i = 0; i < 40; i++) testEmu.runFrame();
  if (testEmu.peek(0x0025) !== 3) throw new Error('after a reset the ROM did not boot into its title screen');
  if (testEmu.peek(0x0010) !== 112 || testEmu.peek(0x0011) !== 112) {
    throw new Error('after a reset the player is at ' + testEmu.peek(0x0010) + ',' + testEmu.peek(0x0011));
  }
  step('the built ROM is unchanged', 'reset boots the title at the authored start');

  // --- Reload the ROM while keeping the selected test scenario (ROADMAP
  // item 3's last bullet-but-one), driven through the real player and Build
  // panel. Reuses the exact scenario "play from here" above already proved
  // lands correctly -- screen 3 at 48,64 -- rather than re-deriving one, so
  // a failure here is about Reload Test, not about a second, independent
  // scenario setup. ---------------------------------------------------------
  const findButton = (text) => [...document.querySelectorAll('#stage button')].find((b) => b.textContent.trim() === text);
  const isHidden = (el) => !el || el.offsetParent === null || getComputedStyle(el).display === 'none';
  // Two "↻ Reload Test" buttons exist in the DOM at once once a player is
  // mounted: the Build panel's own standalone control (build.js's own
  // buttons.reloadTest, kept in the DOM and hidden via CSS by
  // refreshReloadVisibility() while a player is showing) and the in-player
  // one (player.js's buttons.reload). findButton() picks the first DOM
  // match, which is the hidden Build-panel one -- harmless for the
  // rebuild+resume assertions below (both call reloadTest(), just one
  // directly and one through discardRecording() first), but wrong for
  // anything that needs the in-player control specifically, since the
  // Build panel's own button has no recording to discard at all.
  const findVisibleButton = (text) =>
    [...document.querySelectorAll('#stage button')].find((b) => b.textContent.trim() === text && !isHidden(b));

  await window.__app.current.buildAndPlayScenario({ startAt: { screen: 3, x: 48, y: 64 } });
  await until('the reload scenario to build and boot', () => window.__app.current?.player?.emulator, 60000);
  let reloadEmu = window.__app.current.player.emulator;
  if (reloadEmu.peek(0x0016) !== 3 || reloadEmu.peek(0x0010) !== 48 || reloadEmu.peek(0x0011) !== 64) {
    throw new Error('buildAndPlayScenario did not start the reload scenario where asked');
  }

  // A real, observable edit to the assembled ROM's own bytes -- a tile
  // pixel, not project metadata a build could ignore -- so a passing Reload
  // Test can only mean a fresh build actually ran, not that the same bytes
  // were quietly remounted.
  const beforeBytes = Array.from(reloadEmu.nes.romData).join(',');
  store.commit('smoke tile edit before reload', (project) => {
    const tiles = project.tilesets[0].background.tiles;
    tiles[0] = (tiles[0] === '1'.repeat(64) ? '2' : '1').repeat(64);
  });
  await wait(150);

  const reloadBtn = findVisibleButton('↻ Reload Test');
  if (!reloadBtn) throw new Error('the in-player Reload Test control was not offered on a scenario-bound session');

  // Finding 9: a recording in flight when Reload Test fires must be
  // discarded, not left running against a rebuild it cannot represent --
  // started here, right before the same click already under test above for
  // its own rebuild+resume behaviour. discardRecording() runs synchronously,
  // at the very top of the reload's own onclick, before anything is
  // awaited, so both the button label and the toast are checkable
  // immediately after the click returns, with no wait needed.
  const reloadRecordButton = findButton('⏺ Record');
  if (!reloadRecordButton) throw new Error('no Record button available for the reload-discard check');
  reloadRecordButton.click();
  if (reloadRecordButton.textContent.indexOf('⏹ Stop') !== 0) {
    throw new Error('Record did not switch to Stop before the reload-discard check');
  }

  reloadBtn.click();
  if (reloadRecordButton.textContent !== '⏺ Record') {
    throw new Error(
      'Reload Test did not immediately discard the in-flight recording (button still reads "' + reloadRecordButton.textContent + '")'
    );
  }
  const sawReloadDiscardToast = [...document.querySelectorAll('#toastHost .toast')].some((node) =>
    node.textContent.includes('Recording discarded: the test is reloading')
  );
  if (!sawReloadDiscardToast) throw new Error('Reload Test did not toast that the in-flight recording was discarded');
  step('Reload Test discards an in-flight recording', 'Record started, Reload Test clicked, discarded synchronously with a toast');

  await until(
    'Reload Test to mount a new emulator instance',
    () => window.__app.current?.player?.emulator && window.__app.current.player.emulator !== reloadEmu,
    60000
  );
  reloadEmu = window.__app.current.player.emulator;
  if (reloadEmu.peek(0x0016) !== 3 || reloadEmu.peek(0x0010) !== 48 || reloadEmu.peek(0x0011) !== 64) {
    throw new Error('Reload Test did not resume the same scenario after rebuilding');
  }
  if (Array.from(reloadEmu.nes.romData).join(',') === beforeBytes) {
    throw new Error('Reload Test did not actually rebuild -- the loaded ROM bytes are unchanged');
  }
  step('Reload Test: rebuild + resume', 'a real edit reached the new ROM and the scenario resumed at screen 3, 48,64');

  // --- production play() actually forwards isLive() into
  // preparePlaySession's own read sequence, not just accepts and ignores
  // the parameter (round 8 review's finding 2). Calling the real
  // reloadTest() directly with a predicate that lets the coordinator's own
  // checkpoint pass exactly once, then turns false, proves the checks
  // *inside play()'s own reads* see it too: if production play() dropped
  // isLive on the floor, this predicate would only ever be called once and
  // the reload would still succeed. -------------------------------------
  let isLiveCalls = 0;
  const staleWorldOutcome = await window.__app.current.reloadTest({
    isLive: () => {
      isLiveCalls += 1;
      return isLiveCalls <= 1; // true only for the coordinator's own checkpoint in runReloadTest
    }
  });
  if (staleWorldOutcome.ok) {
    throw new Error("reloadTest reported success even though isLive() had already turned false during play()'s own reads");
  }
  if (isLiveCalls <= 1) {
    throw new Error('isLive() was checked only once -- production play() never re-checked it during its own read sequence at all');
  }
  if (window.__app.current.player.emulator !== reloadEmu) {
    throw new Error('a reload whose own isLive() check failed mid-flight must not mount a new player');
  }
  step(
    'Reload Test: isLive threaded into play()',
    "a predicate that turns false during play()'s own reads is honored there, not only before play() is called (checked " +
      isLiveCalls +
      ' times)'
  );

  // Arm a toggle, reload again, and prove the *new* emulator instance has it
  // armed -- the end-to-end proof of onChange -> rememberPlayScenario ->
  // desiredToggles -> play() -> applyDesiredToggles that no dependency-
  // injected unit test can reach on its own.
  findButton('🐞 Debugger').click();
  await wait(150);
  document.querySelector('#stage [data-tab="toggles"]').click();
  await wait(150);
  const reloadInvincibility = document.querySelector('#stage [data-toggle="invincibility"] input');
  if (!reloadInvincibility) throw new Error('the invincibility toggle was not offered on the reload scenario session');
  reloadInvincibility.click();
  await wait(50);
  if (!reloadEmu.testOverrides.invincibility) throw new Error('arming invincibility before a reload did not reach Emulator state');

  const reloadBtn2 = findButton('↻ Reload Test');
  reloadBtn2.click();
  await until(
    'a second Reload Test to mount yet another emulator instance',
    () => window.__app.current?.player?.emulator && window.__app.current.player.emulator !== reloadEmu,
    60000
  );
  const toggledEmu = window.__app.current.player.emulator;
  if (!toggledEmu.testOverrides.invincibility) throw new Error('Reload Test did not re-arm invincibility on the new build');
  const invincibilitySpec = toggledEmu.overrideTargets && toggledEmu.overrideTargets.invincibility;
  if (!invincibilitySpec || !toggledEmu.interceptsByTrap.has(invincibilitySpec.trap)) {
    throw new Error("invincibility reads armed but its trap is not in the new emulator's own intercept table");
  }
  step('Reload Test: toggle re-arming', 'invincibility armed before a reload is armed again on the new build');

  // --- an unsupported toggle is cleared from the remembered scenario, not
  // merely left un-armed (round 8 review's finding 3). "encounters" never
  // resolves on sample's own action build -- no battle system at all, so
  // toggleUnavailableReason refuses it regardless of anything a rebuild
  // could change -- forcing it into the scenario directly (bypassing the
  // UI, which never lets you check a disabled box) simulates "desired but
  // unsupported" without needing a build that only sometimes supports it. -
  window.__app.rememberPlayScenario({ toggles: { encounters: true } });
  if (!window.__app.playScenario.toggles.encounters) {
    throw new Error('rememberPlayScenario did not record the desired-but-unsupported toggle for this test to mean anything');
  }
  const toggleClearReloadBtn = findButton('↻ Reload Test');
  if (!toggleClearReloadBtn) throw new Error('the in-player Reload Test control was not offered for the toggle-clearing scenario');
  toggleClearReloadBtn.click();
  await until(
    'the toggle-clearing reload to mount a new emulator instance',
    () => window.__app.current?.player?.emulator && window.__app.current.player.emulator !== toggledEmu,
    60000
  );
  let toggleClearedEmu = window.__app.current.player.emulator;
  if (toggleClearedEmu.testOverrides.encounters) {
    throw new Error('encounters should not have armed on an action build with no battle system at all');
  }
  if (window.__app.playScenario.toggles.encounters !== false) {
    throw new Error('an unsupported desired toggle must be cleared from the remembered scenario, not merely left un-armed');
  }
  // And it must stay cleared: a later reload must not "remember" wanting it
  // again and report the identical loss a second time.
  const secondToggleClearReloadBtn = findButton('↻ Reload Test');
  secondToggleClearReloadBtn.click();
  await until(
    'a second toggle-clearing reload to mount yet another emulator instance',
    () => window.__app.current?.player?.emulator && window.__app.current.player.emulator !== toggleClearedEmu,
    60000
  );
  toggleClearedEmu = window.__app.current.player.emulator;
  if (window.__app.playScenario.toggles.encounters !== false) {
    throw new Error('the cleared toggle must stay cleared across a later reload, not silently come back');
  }
  step('Reload Test: unsupported toggle cleared', 'a desired-but-unsupported toggle is cleared from the remembered scenario and stays cleared');

  // Ordinary Play must keep meaning exactly "play from the project's own
  // start": it must neither read nor overwrite the remembered scenario, and
  // the Build panel's own Reload Test control must stay hidden while any
  // player -- ordinary or scenario-bound -- is showing.
  findButton('✕ Close').click();
  await wait(150);
  if (isHidden(findButton('↻ Reload Test'))) {
    throw new Error("the Build panel's Reload Test control should be visible once no player is showing and a scenario is remembered");
  }
  const scenarioBefore = JSON.stringify(window.__app.playScenario);
  findButton('▶ Build & Play').click(); // a real DOM click -- proves the wrapped onclick, not a direct function call
  await until('ordinary Build & Play to boot', () => window.__app.current?.player?.emulator, 60000);
  const ordinaryEmu = window.__app.current.player.emulator;
  await until('the ordinary session to reach its own title screen', () => ordinaryEmu.peek(0x0025) === 3, 20000);
  if (ordinaryEmu.peek(0x0016) === 3 && ordinaryEmu.peek(0x0010) === 48) {
    throw new Error("ordinary Build & Play resumed the remembered scenario instead of the project's own start");
  }
  if (JSON.stringify(window.__app.playScenario) !== scenarioBefore) {
    throw new Error('an ordinary Play session must not overwrite the remembered scenario');
  }
  if (!isHidden(findButton('↻ Reload Test'))) {
    throw new Error("the Build panel's Reload Test control should stay hidden while an ordinary session is showing too");
  }
  step('ordinary Play vs. scenario', 'Build & Play always starts fresh, and never reads or clobbers the remembered scenario');

  findButton('✕ Close').click();
  await wait(150);
  findButton('↻ Reload Test').click();
  await until(
    'the final Reload Test to resume the original scenario after an intervening ordinary session',
    () => window.__app.current?.player?.emulator && window.__app.current.player.emulator !== ordinaryEmu,
    60000
  );
  const finalEmu = window.__app.current.player.emulator;
  if (finalEmu.peek(0x0016) !== 3 || finalEmu.peek(0x0010) !== 48 || finalEmu.peek(0x0011) !== 64) {
    throw new Error('the scenario did not survive an intervening ordinary Play session');
  }
  step('scenario survives ordinary Play', 'Reload Test still resumes screen 3, 48,64 after an intervening ordinary session');

  // startedFrom must not lie when battleTest's own fallback discards a
  // successful startAt (a real, pre-existing defect fixed alongside this
  // feature -- see player.js). Driven through the *initial* scenario-bound
  // call, not a reload: resolveFormation would refuse an all-$FF formation
  // before player.js's own fallback could ever run, so only the first play
  // -- which receives raw, unresolved options -- can actually reach it.
  await window.__app.current.buildAndPlayScenario({
    startAt: { screen: 3, x: 48, y: 64 },
    battleTest: { formation: [255, 255, 255, 255], label: 'deliberately empty' }
  });
  await until(
    'the broken battle-test scenario to fall back to the authored start',
    () => {
      const emulator = window.__app.current?.player?.emulator;
      if (!emulator) return false;
      const playerHp = emulator.peek(0x004e);
      return playerHp >= 1 && playerHp <= 6 && emulator.peek(0x0025) === 3;
    },
    20000
  );
  const statusText = document.querySelector('#statusText').textContent;
  if (statusText.includes('Playing from')) {
    throw new Error('status line read "' + statusText + '" for a session that fell back to the authored start');
  }
  // The status text alone only proves the lie is gone, not that the fallback
  // actually landed where it claims. It reloaded fresh, so it is back at the
  // title (flat_screen there is wherever the *title* art lives, not the
  // authored gameplay start -- sample's own titleScreen, not its
  // startScreen) -- a real Start press is what actually proves position, the
  // same way "the built ROM is unchanged" above already proved it after its
  // own reset. Pressed straight on the Emulator (BUTTON, imported earlier in
  // this scenario for exactly this) rather than through a keyboard event and
  // the Controller Forge's own rebindable layer: an earlier step in this
  // same run rebinds Start, and this has no business depending on whatever
  // that left the binding as. Not screen 3, 48,64, which is where startAt
  // had already landed the player before the battle-test fallback discarded
  // it.
  const fellBackTitleEmu = window.__app.current.player.emulator;
  // Held well past a single frame, not pulsed: the run loop paces itself by
  // wall-clock time (renderer/emulator/player.js), and a throttled or
  // contended window can deliver rAF callbacks far slower than 60fps -- a
  // brief press risks landing between two real ticks and never being seen
  // as a press at all by the engine's own frame-by-frame input read.
  fellBackTitleEmu.setButton(BUTTON.START, true);
  await wait(1000);
  fellBackTitleEmu.setButton(BUTTON.START, false);
  await until(
    'the battle-test fallback session to get past its own title screen',
    () => window.__app.current?.player?.emulator?.peek(0x0025) === 0,
    20000
  );
  const fellBackEmu = window.__app.current.player.emulator;
  if (fellBackEmu.peek(0x0016) !== 0 || fellBackEmu.peek(0x0010) !== 112 || fellBackEmu.peek(0x0011) !== 112) {
    throw new Error(
      'the battle-test fallback did not land at the authored start (screen 0, 112,112) -- was at screen ' +
        fellBackEmu.peek(0x0016) +
        ', ' +
        fellBackEmu.peek(0x0010) +
        ',' +
        fellBackEmu.peek(0x0011)
    );
  }
  step('startedFrom regression', 'a battle-test fallback after a successful startAt no longer claims "Playing from" the discarded position, and genuinely lands at screen 0, 112,112');

  // --- build() clones store.project before dispatching, rather than handing
  // through a live reference (review finding 5): rename the scenario's own
  // map in the very same synchronous tick as the reload click -- everything
  // from the click down to window.forge.build.run's own dispatch, including
  // build()'s own clone if it really is one, is a synchronous prefix that
  // has already run by the time the next line of this script executes (JS
  // does not yield mid-statement, and a DOM click calls its handler
  // synchronously). preparePlaySession/resolveStartAt only ever see the
  // build's own returned project: if that is a frozen clone, this rename
  // cannot reach it and the reload resumes exactly as before; if it were a
  // live reference, resolution would look for the map under a name it no
  // longer has and the reload would never mount a new player at all. -------
  await window.__app.current.buildAndPlayScenario({ startAt: { screen: 3, x: 48, y: 64 } });
  await until('the clone-race scenario to build and boot', () => window.__app.current?.player?.emulator, 60000);
  let cloneRaceEmu = window.__app.current.player.emulator;
  if (cloneRaceEmu.peek(0x0016) !== 3 || cloneRaceEmu.peek(0x0010) !== 48 || cloneRaceEmu.peek(0x0011) !== 64) {
    throw new Error('clone-race scenario setup did not start where asked');
  }
  const cloneRaceReloadBtn = findButton('↻ Reload Test');
  if (!cloneRaceReloadBtn) throw new Error('the in-player Reload Test control was not offered for the clone-race scenario');
  cloneRaceReloadBtn.click();
  store.commit('smoke rename the scenario map immediately after the reload click', (project) => {
    project.maps[0].name += ' (renamed mid-reload)';
  });
  await until(
    'the clone-race Reload Test to mount a new emulator instance',
    () => window.__app.current?.player?.emulator && window.__app.current.player.emulator !== cloneRaceEmu,
    60000
  );
  cloneRaceEmu = window.__app.current.player.emulator;
  if (cloneRaceEmu.peek(0x0016) !== 3 || cloneRaceEmu.peek(0x0010) !== 48 || cloneRaceEmu.peek(0x0011) !== 64) {
    throw new Error('the clone-race reload did not resume the pre-edit scenario');
  }
  step('build() clones before dispatch', 'a map renamed in the same tick as the reload click never reaches resolution against a stale live reference');
  store.commit('smoke undo the clone-race rename', (project) => {
    project.maps[0].name = project.maps[0].name.replace(' (renamed mid-reload)', '');
  });

  // --- one in-flight build per project directory, in the main process
  // (round 6/7's mechanism 1): two real, unawaited window.forge.build.run
  // calls for the same directory prove the actual IPC wiring is what
  // refuses the second one, not merely the extracted gate object tested in
  // isolation, and not the renderer's own per-mount "building" flag, which
  // this bypasses entirely by calling the bridge directly. --------------
  const gateDir = window.__app.store.dir;
  const gateProject = window.__app.store.project;
  const firstGateCall = window.forge.build.run(gateDir, gateProject);
  const secondGateCall = window.forge.build.run(gateDir, gateProject);
  const [firstGateResult, secondGateResult] = await Promise.all([firstGateCall, secondGateCall]);
  if (secondGateResult.ok) {
    throw new Error('a second, concurrent build:run for the same directory should have been refused');
  }
  if (!/already running/.test(secondGateResult.error || '')) {
    throw new Error('the refused build did not carry the expected message, got: ' + secondGateResult.error);
  }
  if (!firstGateResult.ok) {
    throw new Error('the first, legitimate build:run call should have succeeded: ' + firstGateResult.error);
  }
  step('main-process build gate', 'a second, unawaited build:run for the same directory is refused by the real IPC handler while the first is in flight');

  // --- a failed scenario-bound build must not fall back to a stale
  // lastBuild (round 7's own finding 1, and round 8 review's finding 4: the
  // earlier fix had no direct regression test). Two things had to be worked
  // out to make this a real test rather than an accidental pass:
  //
  // First, which failure to force. build() itself sets lastBuild = null
  // whenever *it* is the one that fails (an assemble or capacity error), so
  // that path can never exercise a stale fallback at all -- there is
  // nothing left to fall back to either way, bug or no bug (a broken Code
  // Forge override, and a deliberate capacity overflow, were both tried and
  // rejected for exactly this reason before landing here). The one path
  // that returns null *without* touching lastBuild is build()'s own
  // per-mount "building" guard, which fires for a second, reentrant call
  // while an earlier one is still genuinely in flight.
  //
  // Second, how to force reentrancy without a timing hook: everything from
  // a synchronous call down to build()'s own setBusy(true) runs before
  // either promise's first await (the same synchronous-dispatch guarantee
  // the build-gate test above already relies on), so firing a second call
  // immediately after the first, with neither awaited yet, guarantees the
  // second sees building === true. The second call also targets a
  // deliberately different, recognisable position: if it wrongly fell
  // through to lastBuild, it would try to land there instead of wherever
  // the legitimate first call is headed, and it resolves near-instantly
  // (a synchronous guard, not a real assemble), so checking state right
  // after it settles is checking before the slower, legitimate call could
  // possibly have finished on its own.
  const playerBeforeReentrant = window.__app.current.player;
  const legitimateReentrantCall = window.__app.current.buildAndPlayScenario({ startAt: { screen: 3, x: 48, y: 64 } });
  const refusedReentrantCall = window.__app.current.buildAndPlayScenario({ startAt: { screen: 0, x: 200, y: 8 } });
  await refusedReentrantCall;
  if (window.__app.current.player !== playerBeforeReentrant) {
    throw new Error(
      'a reentrant scenario-bound build, refused by the per-mount "building" guard, still ended up mounting a player from a stale lastBuild'
    );
  }
  await legitimateReentrantCall;
  // The ordering bug this same reentrancy exposed (round 9 review): the
  // refused call B used to call rememberPlayScenario() before build() ever
  // checked "building", so B's own (never-mounted) screen 0,200,8 was still
  // what got remembered, clobbering A's, even though A -- not B -- is what
  // actually mounted moments later. build.js now records only once its own
  // build() has been accepted, so the remembered scenario has to agree with
  // what is genuinely running: A's screen 3, 48,64, never B's.
  const mountedEmu = window.__app.current.player.emulator;
  if (mountedEmu.peek(0x0016) !== 3 || mountedEmu.peek(0x0010) !== 48 || mountedEmu.peek(0x0011) !== 64) {
    throw new Error('the legitimate reentrant call did not end up mounted at screen 3, 48,64');
  }
  const rememberedStart = window.__app.playScenario?.startAt;
  if (!rememberedStart || rememberedStart.x !== 48 || rememberedStart.y !== 64) {
    throw new Error(
      'the remembered scenario is ' +
        JSON.stringify(rememberedStart) +
        " -- expected the mounted call's own 48,64, not the refused call's 200,8"
    );
  }
  step(
    'stale-ROM regression',
    'a reentrant scenario-bound build refused by the "building" guard, with a real lastBuild already present, mounts nothing, ' +
      "and the remembered scenario matches what actually mounted, not the refused call's own"
  );

  // --- Screenshot + GIF capture (ROADMAP item 3's last bullet), driven
  // through the player's real toolbar buttons. A fresh player is mounted
  // (rather than reusing the one the reentrancy check above left behind,
  // which can be paused on an arbitrary, possibly visually-uniform instant
  // after all that rebuilding) and left running for a moment first, so the
  // screen a pixel-identity check runs against is known to hold real,
  // varied content -- a mutated Shot/Record that quietly saved a blank
  // image must have something non-blank to differ from. Pausing after that
  // means the canvas cannot change out from under either snapshot: the run
  // loop is entirely requestAnimationFrame-driven, so with running stopped
  // nothing but this script's own synchronous clicks moves the emulator at
  // all -- the same reasoning the sprite-preview checks above rely on. The
  // real byte-for-byte comparison happens back in the main process, once the
  // saved bytes have been captured through the files:writeBinary override
  // below -- what this collects is the *expected* side of that comparison,
  // read from the same canvas the buttons are about to save. -------------
  window.__app.goTo('build');
  await wait(200);
  await window.__app.current.buildAndPlay();
  await until('a fresh player to boot for the capture checks', () => window.__app.current?.player?.emulator, 60000);
  // A fixed sleep here is a fallible assertion, not a setup step: nothing
  // establishes that a frame with real, varied content actually arrived
  // before Pause freezes the canvas, so under sufficiently delayed
  // animation scheduling a blank-screenshot mutation could compare blank
  // against blank and pass. Poll for the condition that actually matters --
  // the canvas holding more than one distinct colour -- and let until()'s
  // own timeout fail the step rather than silently proceeding on a screen
  // that never left its initial, uniform state.
  const canvasHasVariedContent = () => {
    const canvas = document.querySelector('#stage .canvas-stage canvas.pixels');
    if (!canvas) return false;
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const first = (data[0] << 16) | (data[1] << 8) | data[2];
    for (let i = 4; i < data.length; i += 4) {
      if (((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]) !== first) return true;
    }
    return false;
  };
  await until('the canvas to hold more than one distinct colour (real gameplay frames rendering)', canvasHasVariedContent, 5000);
  const pauseButton = findButton('⏸ Pause');
  if (pauseButton) pauseButton.click();
  // Finding 10: the project name lives at project.project.name (see
  // renderer/app.js's own chrome, which reads the identical field) -- captured
  // here, at the same moment as the pixels below, so the main process can
  // check the filenames it receives actually used it.
  report.expectedProjectName = window.__app.store.project.project.name;
  const rgbaToPacked = (data) => {
    const out = new Array(data.length / 4);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) out[p] = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    return out;
  };
  const screenCanvasPixels = () => {
    const canvas = document.querySelector('#stage .canvas-stage canvas.pixels');
    const ctx = canvas.getContext('2d');
    return rgbaToPacked(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  };

  const shotButton = findButton('📷 Shot');
  if (!shotButton) throw new Error('the player toolbar has no Shot button');
  report.shotPixels = screenCanvasPixels();
  shotButton.click();

  const recordButton = findButton('⏺ Record');
  const frameButton = findButton('Frame');
  if (!recordButton) throw new Error('the player toolbar has no Record button');
  if (!frameButton) throw new Error('the player toolbar has no Frame button');
  const gifSnapshots = [screenCanvasPixels()]; // the frame on screen at the instant Record is clicked
  recordButton.click();
  if (recordButton.textContent.indexOf('⏹ Stop') !== 0) {
    throw new Error('Record did not switch the button to Stop, saw "' + recordButton.textContent + '"');
  }
  const GIF_STEPS = 10;
  for (let gifStep = 0; gifStep < GIF_STEPS; gifStep++) {
    frameButton.click();
    gifSnapshots.push(screenCanvasPixels());
  }
  recordButton.click();
  if (recordButton.textContent !== '⏺ Record') {
    throw new Error('Stop did not return the button to its idle label, saw "' + recordButton.textContent + '"');
  }
  report.gifSnapshots = gifSnapshots;
  report.gifSteps = GIF_STEPS;
  step(
    'screenshot + GIF captured through the real toolbar',
    'Shot clicked, ' + GIF_STEPS + ' frames stepped between Record and Stop'
  );

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

  // The seam for files:writeBinary lives here, in the harness, not in
  // shipping code: the Save dialog is native and cannot be driven, and
  // window.forge is exposed through contextBridge, so the page itself has no
  // way to replace files.writeBinary. Overriding the real main-process
  // handler captures the exact bytes the real Shot/Record buttons sent over
  // the real IPC channel -- proof the feature works end to end, not just
  // that the renderer *tried* to save something. `failNextWrite` is how the
  // "one designated capture whose handler throws" case (below) is forced,
  // without a test hook anywhere in player.js itself.
  const capturedWrites = [];
  let failNextWrite = false;
  ipcMain.removeHandler('files:writeBinary');
  ipcMain.handle('files:writeBinary', async (_event, name, bytes) => {
    if (failNextWrite) {
      failNextWrite = false;
      throw new Error('smoke: forced writeBinary failure');
    }
    capturedWrites.push({ name, bytes: Buffer.from(bytes) });
    return { ok: true, value: `/smoke/fake/${name}` };
  });

  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-smoke-'));
  const dir = path.join(scratch, 'Smoke.forge');
  // The scenario edits and saves the sample, so work on a copy: a test must
  // never leave the repository's fixture in a different state than it found it.
  const sampleCopy = path.join(scratch, 'Sample.forge');
  await fs.cp(path.join(REPO_ROOT, 'sample'), sampleCopy, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}build`)
  });
  // Only the encounters-off toggle needs an RPG build (BATTLE_ENABLED) to be
  // offered at all -- the action sample above never exercises it.
  const sampleRpgCopy = path.join(scratch, 'SampleRpg.forge');
  await fs.cp(path.join(REPO_ROOT, 'sample-rpg'), sampleRpgCopy, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}build`)
  });

  try {
    await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
    const report = await window.webContents.executeJavaScript(scenario(dir, sampleCopy, sampleRpgCopy));
    for (const entry of report.steps) console.log(`  ok  ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}`);

    // The Build panel's battle-system meter, checked against the capacity
    // check itself rather than against the expression the meter already uses.
    // That is the whole point of doing it here: the renderer computed those
    // two numbers in its own process, and the invariant is that they are the
    // numbers the build decides on -- a unit test calling battleRegionBytes
    // would only prove the function agrees with itself, which is exactly what
    // the earlier version of this check did while claiming more.
    const meter = report.battleMeter;
    if (!meter) throw new Error('the scenario reported no battle-system meter');
    const refusesRegion = (project) =>
      checkCapacity(project).problems.some(
        (problem) => problem.severity === 'error' && /battle system/i.test(problem.message)
      );
    // The fitting side: read the fixture copy from disk here rather than
    // trusting a project marshalled back out of the renderer, so both halves
    // of the comparison come from independent sources.
    const pristine = await loadProject(sampleRpgCopy);
    const pristineMapper = resolveMapper(pristine.cartridge.mapper);
    if (
      meter.fits.used !== battleRegionBytes(pristine, pristineMapper) ||
      meter.fits.total !== battleRegionCeiling(pristineMapper)
    ) {
      throw new Error(
        `the Build panel showed ${meter.fits.used}/${meter.fits.total} for the battle region, but the ` +
          `capacity check says ${battleRegionBytes(pristine, pristineMapper)}/${battleRegionCeiling(pristineMapper)}`
      );
    }
    if (meter.fits.used > meter.fits.total) throw new Error('the pristine RPG fixture should not overflow its region');
    if (refusesRegion(pristine)) throw new Error('the pristine RPG fixture should not be refused');

    // ...and the overflowing side, so the boundary is crossed on screen.
    const overMapper = resolveMapper(meter.overProject.cartridge.mapper);
    if (
      meter.over.used !== battleRegionBytes(meter.overProject, overMapper) ||
      meter.over.total !== battleRegionCeiling(overMapper)
    ) {
      throw new Error(
        `the Build panel showed ${meter.over.used}/${meter.over.total} for the overflowing project, but the ` +
          `capacity check says ${battleRegionBytes(meter.overProject, overMapper)}/${battleRegionCeiling(overMapper)}`
      );
    }
    if (meter.over.used <= meter.over.total) throw new Error('the overflow case never actually overflowed the meter');
    if (!refusesRegion(meter.overProject)) {
      throw new Error('the meter read over-full but checkCapacity did not refuse — the panel is promising room the build denies');
    }
    console.log(
      `  ok  battle-system meter agrees with checkCapacity — ${meter.fits.used}/${meter.fits.total} accepted, ` +
        `${meter.over.used}/${meter.over.total} refused`
    );
    report.steps.push({ name: 'battle-system meter agrees with checkCapacity' });

    // The Shot/Record buttons clicked inside the scenario above kick off
    // their own async save (canvas.toBlob, then writeBinary) that the
    // scenario's own script never awaits -- it returns as soon as the click
    // handlers have fired, not once they've finished -- so the write can
    // still be in flight once executeJavaScript resolves here. Poll rather
    // than assume, the same reasoning `until()` inside the scenario already
    // uses for everything else that crosses a promise.
    const waitForWrite = async (label, matches, ms = 4000) => {
      for (let waited = 0; waited < ms; waited += 25) {
        const found = capturedWrites.find(matches);
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`timed out waiting for ${label}`);
    };

    // Finding 10: the filename must actually use the project's own name --
    // matches player.js's own captureFilename() slug exactly, so a filename
    // that silently fell back to "game-..." (the bug: reading
    // project.name instead of project.project.name) is caught here rather
    // than by nothing at all.
    const slugify = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'game';
    const expectedSlug = slugify(report.expectedProjectName || '');

    const pngWrite = await waitForWrite('the screenshot PNG over files:writeBinary', (w) => w.name.endsWith('.png'));
    if (!pngWrite.name.startsWith(`${expectedSlug}-`)) {
      problems.push(
        `the screenshot filename "${pngWrite.name}" does not start with the project's own slug "${expectedSlug}-" ` +
          `(project.project.name was "${report.expectedProjectName}")`
      );
    }
    const decodedPng = decodePng(pngWrite.bytes);
    if (decodedPng.width !== 256 || decodedPng.height !== 240) {
      problems.push(`the screenshot PNG is ${decodedPng.width}x${decodedPng.height}, expected the native 256x240`);
    } else {
      // All four channels: the canvas's own alpha is always 255 by
      // construction (onFrame ORs in 0xff000000), so an encoder that wrote
      // correct RGB but alpha 0 -- a fully transparent screenshot -- must
      // fail here rather than being let through by an RGB-only comparison.
      let pngMismatches = 0;
      for (let i = 0; i < report.shotPixels.length; i++) {
        const packed = (decodedPng.pixels[i * 4] << 16) | (decodedPng.pixels[i * 4 + 1] << 8) | decodedPng.pixels[i * 4 + 2];
        const alpha = decodedPng.pixels[i * 4 + 3];
        if (packed !== report.shotPixels[i] || alpha !== 255) pngMismatches++;
      }
      if (pngMismatches) {
        problems.push(`the screenshot PNG differs from the canvas (RGB or alpha) at ${pngMismatches} of ${report.shotPixels.length} pixels`);
      } else {
        console.log('  ok  screenshot PNG is pixel- and alpha-identical to the canvas it was taken from (256x240)');
      }
    }

    const gifWrite = await waitForWrite('the GIF recording over files:writeBinary', (w) => w.name.endsWith('.gif'));
    if (!gifWrite.name.startsWith(`${expectedSlug}-`)) {
      problems.push(
        `the GIF filename "${gifWrite.name}" does not start with the project's own slug "${expectedSlug}-" ` +
          `(project.project.name was "${report.expectedProjectName}")`
      );
    }
    const decodedGif = decodeGif(gifWrite.bytes);
    const expectedGifFrames = 1 + Math.floor(report.gifSteps / 3);
    if (decodedGif.frames.length !== expectedGifFrames) {
      problems.push(
        `the GIF has ${decodedGif.frames.length} frames, expected ${expectedGifFrames} ` +
          `(1 immediate + every 3rd of ${report.gifSteps} stepped frames)`
      );
    } else {
      let badFrame = -1;
      let badFrameReason = '';
      for (let k = 0; k < decodedGif.frames.length; k++) {
        // Every frame's delay, not just frame 0 -- emitting 5cs for the
        // first frame and anything at all for the rest must not pass.
        if (decodedGif.frames[k].delayCs !== 5) {
          badFrame = k;
          badFrameReason = `delay is ${decodedGif.frames[k].delayCs} centiseconds, expected 5`;
          break;
        }
        // Sampling rule: the immediate frame, then every 3rd stepped one --
        // gifSnapshots[0] is the immediate frame, gifSnapshots[3], [6], [9]
        // are what capture.js's own every-third rule should have kept.
        const expectedSnapshot = report.gifSnapshots[k * 3];
        const decodedPixels = decodedGif.frames[k].pixels;
        let mismatches = 0;
        for (let i = 0; i < expectedSnapshot.length; i++) {
          if (decodedPixels[i] !== expectedSnapshot[i]) mismatches++;
        }
        if (mismatches) {
          badFrame = k;
          badFrameReason = `differs from the canvas snapshot the sampling rule says was kept, at ${mismatches} of ${expectedSnapshot.length} pixels`;
          break;
        }
      }
      if (badFrame !== -1) {
        problems.push(`decoded GIF frame ${badFrame} ${badFrameReason}`);
      } else {
        console.log(`  ok  GIF recording: ${decodedGif.frames.length} frames, exactly as the sampling rule predicts, pixel-identical to their source frames, every delay 5cs`);
      }
    }

    // --- Rev 4: cross-check the same GIF with Chromium's own ImageDecoder
    // (WebCodecs), a decoder written by nobody in this repository. gif.js
    // and test/lib/gifdecode.js were written in the same sitting, and their
    // LZW code-width rule was fixed in both at once to make their own round
    // trip pass -- exactly the bug shape a self-consistent round trip cannot
    // see: if the pair is wrong in the same direction, every test above
    // still passes and every real viewer still fails. This runs in the
    // renderer (WebCodecs is a web API, unavailable in the main process),
    // so the bytes captured through the files:writeBinary override above
    // have to be handed back in, base64-encoded through the script text. ---
    const imageDecoderResult = await window.webContents.executeJavaScript(`(async () => {
      if (typeof ImageDecoder === 'undefined') return { unavailable: true, reason: 'ImageDecoder is not defined' };
      const bytes = Uint8Array.from(atob(${JSON.stringify(gifWrite.bytes.toString('base64'))}), (c) => c.charCodeAt(0));
      const decoder = new ImageDecoder({ data: bytes, type: 'image/gif' });
      await decoder.tracks.ready;
      const track = decoder.tracks.selectedTrack;
      if (!track) return { unavailable: true, reason: 'no selected track' };
      const frameCount = track.frameCount;
      const frames = [];
      for (let i = 0; i < frameCount; i++) {
        const { image } = await decoder.decode({ frameIndex: i });
        const buf = new Uint8Array(image.allocationSize());
        await image.copyTo(buf);
        // Chromium's own byte order for this decode path (verified against
        // a known frame's own colour): BGRX/BGRA, not RGBA -- read generically
        // off image.format rather than assuming, in case that ever changes.
        const bgrFirst = image.format && image.format.startsWith('BGR');
        const pixels = new Array(image.codedWidth * image.codedHeight);
        for (let p = 0; p < pixels.length; p++) {
          const o = p * 4;
          pixels[p] = bgrFirst ? (buf[o + 2] << 16) | (buf[o + 1] << 8) | buf[o] : (buf[o] << 16) | (buf[o + 1] << 8) | buf[o + 2];
        }
        frames.push({ width: image.codedWidth, height: image.codedHeight, format: image.format, durationUs: image.duration, pixels });
        image.close();
      }
      return { unavailable: false, frameCount, frames };
    })()`);
    if (imageDecoderResult.unavailable) {
      problems.push(
        `Chromium's ImageDecoder (WebCodecs) is unavailable in the renderer (${imageDecoderResult.reason}) -- the GIF cannot be cross-checked against an independent decoder`
      );
    } else if (imageDecoderResult.frameCount !== expectedGifFrames) {
      problems.push(`ImageDecoder reports ${imageDecoderResult.frameCount} frames, expected ${expectedGifFrames}`);
    } else {
      let badImageDecoderFrame = -1;
      for (let k = 0; k < imageDecoderResult.frames.length && badImageDecoderFrame === -1; k++) {
        const frame = imageDecoderResult.frames[k];
        if (frame.durationUs !== 50000) {
          problems.push(`ImageDecoder frame ${k} duration is ${frame.durationUs}us, expected 50000us (50ms, matching the encoder's delayCs of 5)`);
          badImageDecoderFrame = k;
          continue;
        }
        const expectedSnapshot = report.gifSnapshots[k * 3];
        let mismatches = 0;
        for (let i = 0; i < expectedSnapshot.length; i++) {
          if (frame.pixels[i] !== expectedSnapshot[i]) mismatches++;
        }
        if (mismatches) {
          problems.push(`ImageDecoder frame ${k} (format ${frame.format}) differs from the canvas snapshot at ${mismatches} of ${expectedSnapshot.length} pixels`);
          badImageDecoderFrame = k;
        }
      }
      if (badImageDecoderFrame === -1) {
        console.log(
          `  ok  Chromium's own ImageDecoder independently decodes the GIF: ${imageDecoderResult.frameCount} frames, pixel-identical to their source frames, each 50ms`
        );
      }
    }

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

    // --- a files:writeBinary that rejects must toast, not crash or leave an
    // unhandled rejection (Rev 2, finding 5's renderer half; the main-process
    // fail() half above is not reachable this way -- see this file's own
    // header comment on that). The resize test above navigated off the Build
    // Forge, so a fresh player is mounted first. ---------------------------
    await window.webContents.executeJavaScript(`(async () => {
      window.__app.goTo('build');
      await new Promise((resolve) => setTimeout(resolve, 200));
      await window.__app.current.buildAndPlay();
      const started = Date.now();
      while (!(window.__app.current && window.__app.current.player && window.__app.current.player.emulator) && Date.now() - started < 60000) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (!(window.__app.current && window.__app.current.player && window.__app.current.player.emulator)) {
        throw new Error('buildAndPlay did not mount a player for the capture error/teardown checks');
      }
      return true;
    })()`);

    // Finding 3: "keeps the player running" has to mean the run state, not
    // merely that the player/emulator objects still exist -- a screenshot
    // failure path that called setRunning(false) while still toasting would
    // pass an existence-only check. Confirmed running beforehand too, so
    // this fails loudly if the freshly mounted player was not.
    const isRunningScript = `(() => document.querySelector('#stage .status-meta')?.textContent === 'Running')()`;
    const runningBeforeForcedFailure = await window.webContents.executeJavaScript(isRunningScript);
    if (!runningBeforeForcedFailure) {
      throw new Error('the freshly mounted player is not running before the forced writeBinary failure check');
    }

    const problemsBeforeForcedFailure = problems.length;
    failNextWrite = true;
    await window.webContents.executeJavaScript(`(() => {
      const shotButton = [...document.querySelectorAll('#stage button')].find((b) => b.textContent.trim() === '📷 Shot');
      if (!shotButton) throw new Error('no Shot button to force a writeBinary failure through');
      shotButton.click();
      return true;
    })()`);
    // The rejected invoke's own catch runs asynchronously in the renderer --
    // poll for the toast rather than betting on a fixed delay.
    let afterForcedFailure = { sawErrorToast: false, playerAlive: false, stillRunning: false };
    for (let waited = 0; waited < 3000 && !afterForcedFailure.sawErrorToast; waited += 50) {
      afterForcedFailure = await window.webContents.executeJavaScript(`(() => {
        const toasts = [...document.querySelectorAll('#toastHost .toast')];
        return {
          sawErrorToast: toasts.some(
            (node) => node.className.includes('error') && node.textContent.includes('smoke: forced writeBinary failure')
          ),
          playerAlive: !!(window.__app.current && window.__app.current.player && window.__app.current.player.emulator),
          stillRunning: document.querySelector('#stage .status-meta')?.textContent === 'Running'
        };
      })()`);
      if (!afterForcedFailure.sawErrorToast) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!afterForcedFailure.sawErrorToast) {
      problems.push('a forced files:writeBinary failure did not produce a matching error toast');
    }
    if (!afterForcedFailure.playerAlive) {
      problems.push('a forced files:writeBinary failure left no live player mounted');
    }
    if (!afterForcedFailure.stillRunning) {
      problems.push('a forced files:writeBinary failure left the player not running (status is not "Running")');
    }
    if (problems.length === problemsBeforeForcedFailure) {
      console.log(
        '  ok  a forced files:writeBinary failure toasts an error, keeps the player running, and raises no console error (an unhandled rejection would have)'
      );
    }

    // --- Finding 11: a null canvas.toBlob() result (a real, if rare,
    // browser outcome -- an unsupported or failed encode) must route
    // through the same toast path as any other capture failure, not be
    // silently swallowed. toBlob is monkey-patched here, in the harness,
    // for exactly the one call the Shot click below makes -- there is no
    // other way to force a real browser API to hand back null, the same
    // reasoning as the files:writeBinary override above. No shipping-code
    // hook: the patch lives only in this injected script. --------------
    await window.webContents.executeJavaScript(`(() => {
      const original = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, ...rest) {
        HTMLCanvasElement.prototype.toBlob = original;
        callback(null);
      };
      const shotButton = [...document.querySelectorAll('#stage button')].find((b) => b.textContent.trim() === '📷 Shot');
      if (!shotButton) throw new Error('no Shot button for the null-blob check');
      shotButton.click();
      return true;
    })()`);
    let sawNullBlobToast = false;
    for (let waited = 0; waited < 3000 && !sawNullBlobToast; waited += 50) {
      sawNullBlobToast = await window.webContents.executeJavaScript(`(() => {
        return [...document.querySelectorAll('#toastHost .toast')].some(
          (node) => node.className.includes('error') && node.textContent.includes('the canvas produced no image data')
        );
      })()`);
      if (!sawNullBlobToast) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!sawNullBlobToast) {
      problems.push('a null canvas.toBlob() result did not produce the expected error toast');
    } else {
      console.log(
        '  ok  a null canvas.toBlob() result (a real, if rare, browser outcome) toasts an error rather than being silently swallowed'
      );
    }

    // --- Finding 4: the player's own 300-frame cap handling, driven
    // through the real Frame button. Frame goes through stepAnd(), which
    // calls drainCapture() after every single click, so the queue drains
    // exactly as it does in real use and never gets a chance to overflow
    // (the pending-queue limit) before the cap itself can fire. 900 real
    // frames is comfortably past the ~897 offers the 300-frame cap needs
    // (kept every 3rd offer). No test hook, no injectable cap -- this is
    // the real button, the real capture.js, the real 300. ----------------
    const writesBeforeCapCheck = capturedWrites.length;
    const capCheck = await window.webContents.executeJavaScript(`(async () => {
      window.__app.goTo('build');
      await new Promise((resolve) => setTimeout(resolve, 200));
      await window.__app.current.buildAndPlay();
      const mountDeadline = Date.now() + 60000;
      while (!(window.__app.current && window.__app.current.player && window.__app.current.player.emulator) && Date.now() < mountDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (!(window.__app.current && window.__app.current.player && window.__app.current.player.emulator)) {
        throw new Error('buildAndPlay did not mount a player for the cap check');
      }
      const pauseButton = [...document.querySelectorAll('#stage button')].find((b) => b.textContent === '⏸ Pause');
      if (pauseButton) pauseButton.click(); // only this script's own Frame clicks may advance a frame from here on
      const recordButton = [...document.querySelectorAll('#stage button')].find((b) => b.textContent.trim() === '⏺ Record');
      const frameButton = [...document.querySelectorAll('#stage button')].find((b) => b.textContent.trim() === 'Frame');
      if (!recordButton) throw new Error('no Record button for the cap check');
      if (!frameButton) throw new Error('no Frame button for the cap check');
      recordButton.click();
      if (recordButton.textContent.indexOf('⏹ Stop') !== 0) throw new Error('Record did not switch to Stop before the cap check');
      for (let i = 0; i < 900; i++) frameButton.click();
      // Finding 1 (phase 5): the reason a recording stopped must toast even
      // if the save that follows is cancelled or fails -- deleting the
      // reason toast used to still pass here, since nothing checked for it.
      const sawCapReasonToast = [...document.querySelectorAll('#toastHost .toast')].some((node) =>
        node.textContent.includes('Recording hit the 300-frame cap')
      );
      return { idleAfter900: recordButton.textContent === '⏺ Record', finalLabel: recordButton.textContent, sawCapReasonToast };
    })()`);
    if (!capCheck.idleAfter900) {
      problems.push(
        `900 real Frame clicks did not stop the recording on their own (the 300-frame cap) -- button still reads "${capCheck.finalLabel}"`
      );
    }
    if (!capCheck.sawCapReasonToast) {
      problems.push('the 300-frame cap did not toast why the recording stopped, independent of whether the file saved');
    }
    let capWrite = null;
    for (let waited = 0; waited < 4000 && !capWrite; waited += 25) {
      capWrite = capturedWrites.slice(writesBeforeCapCheck).find((w) => w.name.endsWith('.gif'));
      if (!capWrite) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!capWrite) {
      problems.push("the player's own 300-frame cap did not result in a GIF being sent over files:writeBinary");
    } else {
      const decodedCapGif = decodeGif(capWrite.bytes);
      if (decodedCapGif.frames.length !== 300) {
        problems.push(`the cap-triggered GIF has ${decodedCapGif.frames.length} frames, expected exactly 300`);
      } else {
        console.log(
          "  ok  the player's own 300-frame cap: 900 real Frame clicks (through stepAnd(), draining normally) stopped the recording on their own and sent a 300-frame GIF"
        );
      }
    }

    // --- Phase 5, finding 3: the player-side integration of the recorder's
    // queue-overflow policy (finish, save, reason toast) -- capture.test.js
    // already exercises the *recorder's own* overflow policy directly, but
    // nothing drove it through the real player. It is reachable: stepOut()
    // (runcontrol.js) is a synchronous loop of up to 2,000,000
    // stepInstruction() calls that only stops on an RTS popping the stack
    // above where it started, or a breakpoint. Invoked from the very top of
    // main_loop -- itself entered by a bare `jmp`, never a `jsr`, and the
    // only routine main_loop calls that waits on real time (wait_vblank)
    // waits for exactly one vblank before returning -- no subroutine call
    // reachable from there returns above that starting depth, so the loop
    // runs to its full instruction ceiling, spanning far more than the ~24
    // real frames (8 pending slots * capture.js's SAMPLE_EVERY=3) the
    // recorder's queue can hold before it stops itself. runToAddress() is
    // not a test-only hook: testplay.js and battletest.js already use it in
    // shipping code for the identical purpose (landing exactly on
    // main_loop's own address) via the same MAIN_LOOP = 'main_loop' symbol
    // name. -----------------------------------------------------------
    const stepOutBuild = await window.webContents.executeJavaScript(`(async () => {
      const built = await window.__app.current.build({ silent: true });
      if (!built || !built.symbolPath) throw new Error('no symbolPath from a silent build for the stepOut overflow check');
      const symbolsResult = await window.forge.build.readSymbols(built.symbolPath);
      if (!symbolsResult.ok) throw new Error('could not read symbols for the stepOut overflow check: ' + symbolsResult.error);
      const mainLoopAddress = symbolsResult.value.main_loop;
      if (mainLoopAddress === undefined) throw new Error('no main_loop symbol in the build');
      return mainLoopAddress;
    })()`);
    const writesBeforeStepOutCheck = capturedWrites.length;
    const stepOutCheck = await window.webContents.executeJavaScript(`(async () => {
      await window.__app.current.buildAndPlay();
      const mountDeadline = Date.now() + 60000;
      while (!(window.__app.current && window.__app.current.player && window.__app.current.player.emulator) && Date.now() < mountDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (!(window.__app.current && window.__app.current.player && window.__app.current.player.emulator)) {
        throw new Error('buildAndPlay did not mount a player for the stepOut overflow check');
      }
      const pauseButton = [...document.querySelectorAll('#stage button')].find((b) => b.textContent === '⏸ Pause');
      if (pauseButton) pauseButton.click();

      const emulator = window.__app.current.player.emulator;
      const landed = emulator.runToAddress(${stepOutBuild}, { frames: 60 });
      if (!landed) throw new Error('runToAddress(main_loop) did not land within 60 frames');
      if (emulator.pc !== ${stepOutBuild}) throw new Error('emulator.pc is $' + emulator.pc.toString(16) + ', not at main_loop ($${stepOutBuild.toString(16)})');

      const recordButton = [...document.querySelectorAll('#stage button')].find((b) => b.textContent.trim() === '⏺ Record');
      const outButton = [...document.querySelectorAll('#stage button')].find((b) => b.textContent.trim() === '⤴ Out');
      if (!recordButton) throw new Error('no Record button for the stepOut overflow check');
      if (!outButton) throw new Error('no Out button for the stepOut overflow check');
      recordButton.click();
      if (recordButton.textContent.indexOf('⏹ Stop') !== 0) throw new Error('Record did not switch to Stop before the stepOut overflow check');

      outButton.click(); // synchronous: stepOut() runs its full loop, then drainCapture() reacts to the overflow, before this line returns control

      const sawOverflowToast = [...document.querySelectorAll('#toastHost .toast')].some((node) =>
        node.textContent.includes('A step ran further than the recorder can hold')
      );
      return { idleAfterOut: recordButton.textContent === '⏺ Record', finalLabel: recordButton.textContent, sawOverflowToast };
    })()`);
    if (!stepOutCheck.idleAfterOut) {
      problems.push(
        `stepOut() from the top of main_loop did not stop the recording on its own (the queue-overflow policy) -- button still reads "${stepOutCheck.finalLabel}"`
      );
    }
    if (!stepOutCheck.sawOverflowToast) {
      problems.push('stepOut() overflow did not toast why the recording stopped, independent of whether the file saved');
    }
    let stepOutWrite = null;
    for (let waited = 0; waited < 4000 && !stepOutWrite; waited += 25) {
      stepOutWrite = capturedWrites.slice(writesBeforeStepOutCheck).find((w) => w.name.endsWith('.gif'));
      if (!stepOutWrite) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!stepOutWrite) {
      problems.push('stepOut() overflow did not result in a GIF being sent over files:writeBinary');
    } else {
      console.log(
        `  ok  stepOut() from the top of main_loop overflows the recorder's pending queue: stopped itself, toasted why, and sent a ${decodeGif(stepOutWrite.bytes).frames.length}-frame GIF`
      );
    }

    // --- Finding 8: the elapsed label must come from kept frames, not
    // wall-clock time -- the button's own title already promises "records
    // emulated frames." A wait with nothing stepped can't distinguish the
    // two by itself: updateRecordLabel() only runs from
    // startRecording()/drainCapture(), so the label plainly cannot change
    // while neither runs. The real test needs exactly one more real frame
    // *after* a long real wait: capture.js samples every 3rd offered frame
    // (SAMPLE_EVERY -- confirmed above, since the cap check's own 900 clicks
    // produced exactly 300 kept), and start() already consumes the first
    // slot via its own immediate keep(), so this one frame lands on
    // offeredSinceKeep=1 and keeps nothing new. A frame-derived label must
    // therefore read identically to the instant Record was clicked; a
    // wall-clock-derived one gets its one chance here to show the
    // unaccounted real time the moment it next recomputes. ---------------
    const writesBeforeLabelCheck = capturedWrites.length;
    const labelCheck = await window.webContents.executeJavaScript(`(async () => {
      const recordButton = [...document.querySelectorAll('#stage button')].find((b) => b.textContent.trim() === '⏺ Record');
      const frameButton = [...document.querySelectorAll('#stage button')].find((b) => b.textContent.trim() === 'Frame');
      if (!recordButton) throw new Error('no Record button for the elapsed-label check');
      if (!frameButton) throw new Error('no Frame button for the elapsed-label check');
      recordButton.click();
      if (recordButton.textContent.indexOf('⏹ Stop') !== 0) throw new Error('Record did not switch to Stop before the elapsed-label check');
      const labelAtStart = recordButton.textContent;
      await new Promise((resolve) => setTimeout(resolve, 3000));
      frameButton.click();
      const labelAfterOneFrame = recordButton.textContent;
      recordButton.click(); // Stop -- this throwaway recording's own GIF is only waited for below, never inspected
      return { labelAtStart, labelAfterOneFrame };
    })()`);
    if (labelCheck.labelAfterOneFrame !== labelCheck.labelAtStart) {
      problems.push(
        `the Record button's elapsed label changed after one real frame following a 3s real wait ` +
          `("${labelCheck.labelAtStart}" -> "${labelCheck.labelAfterOneFrame}"), even though that one frame could not ` +
          `have added a kept frame -- it is tracking wall-clock time, not kept frames`
      );
    } else {
      console.log(
        "  ok  the Record button's elapsed label tracks kept frames, not wall-clock time (unchanged across a 3s real wait plus one frame that kept nothing new)"
      );
    }
    // Wait for this check's own Stop to land before the next check takes its
    // own capturedWrites snapshot, so a write that is really this one's own
    // can never be mistaken for something the next check sent.
    for (let waited = 0; waited < 4000 && capturedWrites.length === writesBeforeLabelCheck; waited += 25) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (capturedWrites.length === writesBeforeLabelCheck) {
      problems.push("the elapsed-label check's own Stop did not send a GIF over files:writeBinary");
    }

    // --- tearing the player down mid-recording discards it: nothing is sent
    // over files:writeBinary, and the discard itself toasts (Rev 2, finding
    // 4; Rev 3, finding 5's discard-policy half). -------------------------
    const writesBeforeTeardown = capturedWrites.length;
    await window.webContents.executeJavaScript(`(() => {
      const recordButton = [...document.querySelectorAll('#stage button')].find((b) => b.textContent.trim() === '⏺ Record');
      if (!recordButton) throw new Error('no Record button to start the teardown-mid-recording check with');
      recordButton.click();
      if (recordButton.textContent.indexOf('⏹ Stop') !== 0) throw new Error('Record did not switch to Stop before teardown');
      return true;
    })()`);
    await window.webContents.executeJavaScript("window.__app.goTo('map'); true"); // tears the player down mid-recording
    await new Promise((resolve) => setTimeout(resolve, 300));
    const sawDiscardToast = await window.webContents.executeJavaScript(`(() => {
      return [...document.querySelectorAll('#toastHost .toast')].some((node) =>
        node.textContent.includes('Recording discarded: the player closed')
      );
    })()`);
    if (!sawDiscardToast) problems.push('tearing the player down mid-recording did not toast that the recording was discarded');
    if (capturedWrites.length !== writesBeforeTeardown) {
      problems.push('tearing the player down mid-recording still sent something over files:writeBinary');
    } else if (sawDiscardToast) {
      console.log('  ok  tearing the player down mid-recording discards it -- nothing sent over files:writeBinary, and it toasts');
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
