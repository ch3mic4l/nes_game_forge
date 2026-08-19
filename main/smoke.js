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
