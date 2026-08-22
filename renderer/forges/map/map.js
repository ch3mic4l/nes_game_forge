// Map Forge — paint screens out of metatiles.
//
// One screen is exactly one NES nametable (16x15 metatiles = 256x240 px). A map
// is a grid of screens; walking off an edge moves to the neighbour.

import { store } from '../../store.js';
import { el, clear, fill, field, toast, confirmModal, showModal, fitZoom, observeSize } from '../../ui.js';
import {
  LIMITS,
  createScreen,
  createMap,
  COLLISION_TYPES,
  AUTHOR_NAME_MAX,
  flatScreens,
  screenLabel,
  entityLabel,
  canTalk,
  EVENT_TRIGGERS,
  availableTriggers,
  effectiveTrigger
} from '../../../shared/project.js';
import { BOX_COLS, BOX_ROWS, FONT_BASE, wrapText } from '../../../shared/font.js';
import { RPG_LIMITS, isMonsterActor, mapEncounterFormation } from '../../../shared/project.js';
import { saveCapable, resolveMapper } from '../../../shared/cartridge.js';
import { createMetatilePanel } from './metatiles.js';
import {
  describeCommand,
  describeCondition,
  editEvent,
  editSwitches,
  editVariables,
  editCommonEvents
} from './events.js';
import { openEventList } from './eventlist.js';
import { templatesFor, firstFreeSwitch } from './templates.js';
import {
  MetatileRenderer,
  drawCollisionOverlay,
  drawGridOverlay,
  METATILE_PX,
  SCREEN_PX_W,
  SCREEN_PX_H
} from './render.js';

// The gap between the screen and the navigator below it, kept here because the
// fit calculation has to subtract exactly what the stylesheet lays out.
const NAV_GAP = 14;

// Outside `mount` on purpose: copying an actor, going to the Sprite Forge to
// check what it looks like and coming back to paste is the ordinary way this
// gets used, and a clipboard that emptied itself on the way would be a trap.
//
// It remembers which project it was filled from, and paste is not offered
// anywhere else. Everything a placement carries is an *index* into the project
// around it — the actor, the switch it hides behind, the screen its door leads
// to, the item its event gives — and every one of those indices stays perfectly
// valid in another project while meaning something entirely different. There is
// no repair for that, only a refusal.
//
// It also remembers the actor roster it was copied against, because deleting an
// actor renumbers every *placed* actorId (see the Sprite Forge) and cannot
// renumber this one: copy actor 1, delete actor 0, and the index names somebody
// else while staying comfortably in range.
//
// The snapshot is every actor record, not a summary of them. Three weaker
// versions were tried and each let the wrong actor through:
//
//   - the copied actor's name: two actors called "Guard" at 1 and 2, delete
//     actor 0, and the one that shuffles into index 1 compares equal.
//   - the names up to the copied index: three actors called "Chest", copy the
//     middle, delete the first, and that prefix is *still* ["Chest","Chest"].
//   - every name: delete actor 0, then add an actor and call it "Chest" too.
//     The list of names matches again, so the paste comes back — while index 1
//     holds a different actor. A name list describes the state, and a state can
//     be arrived at twice.
//
// Whole records answer all three, and their residual case is the harmless one:
// they compare equal only when the actor now at that index is defined
// identically to the one copied, which is to say interchangeable with it. They
// also survive undo, whose structuredClone restores records that are equal
// without being the same objects — which is why object identity in a WeakMap
// was the wrong tool here, undo being far more frequent than editing an actor.
let clipboard = null;
const rosterOf = (project) => JSON.stringify(project.sprites.actors);

const clipboardIsHere = () =>
  Boolean(clipboard) && clipboard.dir === store.dir && rosterOf(store.project) === clipboard.roster;

const TOOLS = [
  { id: 'stamp', label: '▪ Stamp', title: 'Paint the selected metatile' },
  { id: 'rect', label: '▭ Rect', title: 'Fill a rectangle' },
  { id: 'fill', label: '🪣 Fill', title: 'Flood fill matching metatiles' },
  { id: 'pick', label: '💧 Pick', title: 'Pick up the metatile under the cursor, then return to Stamp' },
  { id: 'start', label: '⚑ Start', title: 'Place where the player begins' },
  { id: 'entity', label: '☗ Actor', title: 'Place an actor' },
  {
    id: 'play',
    label: '▶ Test',
    title: 'Build and play from the spot you click — the cartridge still starts at ⚑ Start'
  }
];

export function mount(container, app) {
  const renderer = new MetatileRenderer();
  const state = {
    mapIndex: 0,
    screenIndex: 0,
    metatile: 1,
    tool: 'stamp',
    // 'fit' fills whatever room the window gives the stage; 1-3 pin it.
    zoom: 'fit',
    showGrid: true,
    showCollision: false,
    actorId: 0,
    painting: false,
    rectStart: null,
    rectEnd: null,
    // The free-form battle-test picker's own selection -- ephemeral debugger
    // state, not project data, so it is never committed and simply resets on
    // remount like the rest of `state` does.
    battleTestPicks: []
  };

  const currentMap = () => store.project.maps[Math.min(state.mapIndex, store.project.maps.length - 1)];
  const currentScreen = () => currentMap().screens[Math.min(state.screenIndex, currentMap().screens.length - 1)];

  // ------------------------------------------------------------- canvases

  const canvas = el('canvas.pixels', { style: { cursor: 'crosshair' } });
  const overlay = el('canvas', { style: { position: 'absolute', inset: '0', pointerEvents: 'none' } });
  const navigator = el('div', { style: { display: 'grid', gap: '4px', justifyContent: 'start' } });
  const entityList = el('div');
  const mapSettings = el('div');
  const cursorInfo = el('span.status-meta');
  const mapStage = el(
    'div.canvas-stage',
    { style: { flexDirection: 'column', gap: `${NAV_GAP}px` } },
    el('div', { style: { position: 'relative', lineHeight: '0' } }, canvas, overlay),
    navigator
  );

  // The navigator sits under the screen in the same stage, so its height is not
  // room the screen can grow into.
  function screenZoom() {
    if (state.zoom !== 'fit') return state.zoom;
    const reserve = navigator.offsetHeight + NAV_GAP;
    // Never below 2: in a narrow window scrolling a readable screen beats
    // shrinking it to something you cannot draw on.
    return fitZoom(mapStage, SCREEN_PX_W, SCREEN_PX_H, { min: 2, max: 8, reserve });
  }

  function renderScreen() {
    const zoom = screenZoom();
    canvas.width = SCREEN_PX_W * zoom;
    canvas.height = SCREEN_PX_H * zoom;
    canvas.style.width = `${SCREEN_PX_W * zoom}px`;
    canvas.style.height = `${SCREEN_PX_H * zoom}px`;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = false;
    renderer.drawScreen(context, currentScreen(), zoom);

    overlay.width = canvas.width;
    overlay.height = canvas.height;
    overlay.style.width = canvas.style.width;
    overlay.style.height = canvas.style.height;
    const layer = overlay.getContext('2d');
    layer.clearRect(0, 0, overlay.width, overlay.height);

    if (state.showCollision) drawCollisionOverlay(layer, currentScreen(), store.project.metatiles, zoom);
    if (state.showGrid) drawGridOverlay(layer, zoom);

    // Actors placed on this screen.
    for (const entity of currentScreen().entities) {
      const actor = store.project.sprites.actors[entity.actorId];
      layer.fillStyle = 'rgba(77,163,255,0.75)';
      layer.strokeStyle = '#fff';
      layer.lineWidth = 1;
      layer.beginPath();
      layer.arc((entity.x + 8) * zoom, (entity.y + 8) * zoom, 6 * zoom * 0.5, 0, Math.PI * 2);
      layer.fill();
      layer.stroke();
      if (actor) {
        layer.fillStyle = '#fff';
        layer.font = `${9 * Math.max(1, zoom - 1)}px system-ui`;
        layer.fillText(actor.name, (entity.x + 16) * zoom, (entity.y + 10) * zoom);
      }
    }

    // Player start, when it lands on the screen being edited.
    const { startMap, startScreen, startX, startY } = store.project.project;
    if (startMap === state.mapIndex && startScreen === state.screenIndex) {
      layer.strokeStyle = '#ff9d3c';
      layer.lineWidth = 2;
      layer.strokeRect(startX * zoom, startY * zoom, METATILE_PX * zoom, METATILE_PX * zoom);
      layer.fillStyle = '#ff9d3c';
      layer.font = `${10 * Math.max(1, zoom - 1)}px system-ui`;
      layer.fillText('START', startX * zoom, Math.max(10, startY * zoom - 3));
    }

    if (state.rectStart && state.rectEnd) {
      const minCol = Math.min(state.rectStart.col, state.rectEnd.col);
      const maxCol = Math.max(state.rectStart.col, state.rectEnd.col);
      const minRow = Math.min(state.rectStart.row, state.rectEnd.row);
      const maxRow = Math.max(state.rectStart.row, state.rectEnd.row);
      layer.strokeStyle = '#ff9d3c';
      layer.lineWidth = 2;
      layer.strokeRect(
        minCol * METATILE_PX * zoom,
        minRow * METATILE_PX * zoom,
        (maxCol - minCol + 1) * METATILE_PX * zoom,
        (maxRow - minRow + 1) * METATILE_PX * zoom
      );
    }
  }

  function renderNavigator() {
    const map = currentMap();
    clear(navigator);
    navigator.style.gridTemplateColumns = `repeat(${map.gridW}, auto)`;
    map.screens.forEach((screen, index) => {
      const thumb = el('canvas', {
        width: LIMITS.screenCols * 4,
        height: LIMITS.screenRows * 4,
        style: {
          width: `${LIMITS.screenCols * 4}px`,
          height: `${LIMITS.screenRows * 4}px`,
          imageRendering: 'pixelated',
          border: index === state.screenIndex ? '2px solid var(--accent)' : '1px solid var(--line)',
          borderRadius: '3px',
          cursor: 'pointer'
        },
        title: screen.name?.trim() ? `Screen ${index} — ${screen.name}` : `Screen ${index}`,
        onclick: () => {
          state.screenIndex = index;
          renderScreen();
          renderNavigator();
          renderEntities();
        }
      });
      const context = thumb.getContext('2d');
      context.imageSmoothingEnabled = false;
      for (let row = 0; row < LIMITS.screenRows; row++) {
        for (let col = 0; col < LIMITS.screenCols; col++) {
          renderer.draw(context, screen.metatiles[row * LIMITS.screenCols + col], col * 4, row * 4, 4);
        }
      }
      if (store.project.project.startMap === state.mapIndex && store.project.project.startScreen === index) {
        context.fillStyle = '#ff9d3c';
        context.fillRect(0, 0, 6, 6);
      }
      navigator.append(thumb);
    });
  }

  // ------------------------------------------------------------- painting

  function cellFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const col = Math.floor(((event.clientX - rect.left) / rect.width) * LIMITS.screenCols);
    const row = Math.floor(((event.clientY - rect.top) / rect.height) * LIMITS.screenRows);
    return {
      col: Math.max(0, Math.min(LIMITS.screenCols - 1, col)),
      row: Math.max(0, Math.min(LIMITS.screenRows - 1, row))
    };
  }

  function paintCell(cell, id = state.metatile) {
    const index = cell.row * LIMITS.screenCols + cell.col;
    const screen = currentScreen();
    if (screen.metatiles[index] === id) return false;
    screen.metatiles[index] = id;
    return true;
  }

  function floodFill(cell) {
    const screen = currentScreen();
    const target = screen.metatiles[cell.row * LIMITS.screenCols + cell.col];
    if (target === state.metatile) return false;
    const queue = [cell];
    screen.metatiles[cell.row * LIMITS.screenCols + cell.col] = state.metatile;
    while (queue.length) {
      const { col, row } = queue.pop();
      for (const [nextCol, nextRow] of [
        [col - 1, row],
        [col + 1, row],
        [col, row - 1],
        [col, row + 1]
      ]) {
        if (nextCol < 0 || nextRow < 0 || nextCol >= LIMITS.screenCols || nextRow >= LIMITS.screenRows) continue;
        const index = nextRow * LIMITS.screenCols + nextCol;
        if (screen.metatiles[index] !== target) continue;
        screen.metatiles[index] = state.metatile;
        queue.push({ col: nextCol, row: nextRow });
      }
    }
    return true;
  }

  /**
   * Play the game from the spot just clicked, rather than from ⚑ Start.
   *
   * Nothing about the project changes and nothing is committed: the Build panel
   * builds exactly the ROM it would have built anyway, and the position is
   * poked into the emulator's RAM once that ROM is running (see
   * renderer/emulator/testplay.js). Everything the Build panel needs is read
   * before handing over, because going there unmounts this Forge.
   */
  async function playFromHere(cell) {
    const flat = flatScreens(store.project);
    const screen = flat.findIndex((entry) => entry.screen === currentScreen());
    if (screen < 0) return;
    const x = cell.col * METATILE_PX;
    const y = cell.row * METATILE_PX;
    const label = `${flat[screen].label} at ${x},${y}`;
    await app.goTo('build');
    await app.current?.buildAndPlayScenario?.({ startAt: { screen, x, y, label } });
  }

  /**
   * Fire `formation` as a battle right now, without walking into it
   * (ROADMAP item 3's last bullet).
   *
   * Reuses "play from here"'s own startAt to reach a stable, freshly-drawn
   * ST_GAMEPLAY -- battle-test does not care where on the map this happens,
   * so it uses the project's own authored ⚑ Start rather than asking the
   * tester to click one, and gets the same past-the-title, past-any-stray-
   * world-tick handling that gives it for free. renderer/emulator/
   * battletest.js's own applyBattleTest does the rest once there.
   */
  async function battleTest(formation, label) {
    const { startMap, startScreen, startX, startY } = store.project.project;
    const flat = flatScreens(store.project);
    const screen = flat.findIndex((entry) => entry.mapIndex === startMap && entry.screenIndex === startScreen);
    if (screen < 0) return;
    await app.goTo('build');
    await app.current?.buildAndPlayScenario?.({
      startAt: { screen, x: startX, y: startY, label: `⚑ Start` },
      battleTest: { formation, label }
    });
  }

  function onPointerDown(event) {
    if (event.button > 2) return;
    event.preventDefault();
    const cell = cellFromEvent(event);

    if (state.tool === 'pick') {
      state.metatile = currentScreen().metatiles[cell.row * LIMITS.screenCols + cell.col];
      metatilePanel.render();
      setTool('stamp');
      return;
    }

    if (state.tool === 'start') {
      store.commit('Move player start', (project) => {
        project.project.startMap = state.mapIndex;
        project.project.startScreen = state.screenIndex;
        project.project.startX = cell.col * METATILE_PX;
        project.project.startY = cell.row * METATILE_PX;
      });
      renderScreen();
      renderNavigator();
      return;
    }

    if (state.tool === 'entity') {
      const actors = store.project.sprites.actors;
      if (!actors.length) {
        toast('Define an actor in the Sprite Forge before placing one.', 'error');
        return;
      }
      if (currentScreen().entities.length >= LIMITS.entitiesPerScreen) {
        toast(`A screen can hold at most ${LIMITS.entitiesPerScreen} actors.`, 'error');
        return;
      }
      const { mapIndex, screenIndex, actorId } = state;
      store.commit('Place actor', (project) => {
        project.maps[mapIndex].screens[screenIndex].entities.push({
          actorId,
          x: cell.col * METATILE_PX,
          y: cell.row * METATILE_PX,
          props: {}
        });
      });
      renderScreen();
      renderEntities();
      return;
    }

    if (state.tool === 'play') {
      if (event.button === 0) playFromHere(cell); // a right-click should not start a build
      return;
    }

    if (state.tool === 'rect') {
      state.rectStart = cell;
      state.rectEnd = cell;
      state.painting = true;
      canvas.setPointerCapture(event.pointerId);
      renderScreen();
      return;
    }

    const id = event.button === 2 ? 0 : state.metatile;
    if (state.tool === 'fill') {
      store.beginStroke('Fill area');
      if (floodFill(cell)) {
        store.endStroke();
        renderScreen();
        renderNavigator();
      } else {
        store.cancelStroke();
      }
      return;
    }

    store.beginStroke('Paint screen');
    state.painting = true;
    state.paintId = id;
    paintCell(cell, id);
    renderScreen();
    canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    const cell = cellFromEvent(event);
    const metatile = store.project.metatiles[currentScreen().metatiles[cell.row * LIMITS.screenCols + cell.col]];
    cursorInfo.textContent = `col ${cell.col} row ${cell.row} · ${metatile?.name ?? '?'} · ${metatile?.collision ?? ''}`;
    if (!state.painting) return;
    if (state.tool === 'rect') {
      state.rectEnd = cell;
      renderScreen();
      return;
    }
    if (paintCell(cell, state.paintId)) renderScreen();
  }

  function onPointerUp() {
    if (!state.painting) return;
    state.painting = false;

    if (state.tool === 'rect' && state.rectStart && state.rectEnd) {
      const minCol = Math.min(state.rectStart.col, state.rectEnd.col);
      const maxCol = Math.max(state.rectStart.col, state.rectEnd.col);
      const minRow = Math.min(state.rectStart.row, state.rectEnd.row);
      const maxRow = Math.max(state.rectStart.row, state.rectEnd.row);
      const { mapIndex, screenIndex, metatile } = state;
      store.commit('Fill rectangle', (project) => {
        const screen = project.maps[mapIndex].screens[screenIndex];
        for (let row = minRow; row <= maxRow; row++) {
          for (let col = minCol; col <= maxCol; col++) screen.metatiles[row * LIMITS.screenCols + col] = metatile;
        }
      });
      state.rectStart = null;
      state.rectEnd = null;
    } else {
      store.endStroke();
    }
    renderScreen();
    renderNavigator();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  // --------------------------------------------------------- right panel

  function resizeMap(newWidth, newHeight) {
    const index = state.mapIndex;
    store.commit('Resize map', (project) => {
      const map = project.maps[index];
      const screens = [];
      for (let row = 0; row < newHeight; row++) {
        for (let col = 0; col < newWidth; col++) {
          screens.push(
            row < map.gridH && col < map.gridW ? map.screens[row * map.gridW + col] : createScreen()
          );
        }
      }
      map.gridW = newWidth;
      map.gridH = newHeight;
      map.screens = screens;
      if (project.project.startMap === index && project.project.startScreen >= screens.length) {
        project.project.startScreen = 0;
      }
    });
    if (state.screenIndex >= currentMap().screens.length) state.screenIndex = 0;
    renderAll();
  }

  /** The names and labels the event editor needs to read as English. */
  function eventContext() {
    return {
      actors: store.project.sprites.actors,
      switches: store.project.switches ?? [],
      variables: store.project.variables ?? [],
      screens: flatScreens(store.project).map((entry) => entry.label),
      // Only an RPG has a party, so this is what decides whether Join is offered.
      party: store.project.project.gameType === 'rpg' ? store.project.party ?? [] : [],
      commonEvents: store.project.commonEvents ?? [],
      songs: store.project.songs ?? [],
      // Whether the current cartridge can even hold a save -- the same
      // question saveCapable (shared/cartridge.js) answers for the Build
      // panel's mapper picker, asked here to decide whether Save is offered.
      // Deliberately saveCapable rather than saveMediaImplemented: this is
      // "does the hardware have a save medium at all," a structural fact,
      // not "does the engine drive it today" -- the two currently agree on
      // every registered board, but a live Save on a board whose medium
      // exists but is not implemented yet should still be offered here and
      // refused by validateProject instead, the same reason the Build
      // panel's own mapper picker does not disable a board like that.
      canSave: saveCapable(resolveMapper(store.project.cartridge.mapper))
    };
  }

  /** Open the common events editor and commit whatever it hands back. Shared
   * by the toolbar button and the event list, since picking a common event
   * row there means the same thing as clicking this button. */
  async function openCommonEventsEditor() {
    const result = await editCommonEvents(
      store.project.commonEvents ?? [],
      store.project.commonEventSeq ?? 0,
      eventContext()
    );
    if (result !== undefined) {
      store.commit('Edit common events', (project) => {
        project.commonEvents = result.commonEvents;
        project.commonEventSeq = result.commonEventSeq;
      });
      renderEntities();
    }
  }

  /**
   * Search the project, and go where the answer is. Selecting a row moves the
   * Forge to that map and screen and scrolls its row into view — the point of
   * finding something is being taken to it, not being told where it was. A
   * common event has no place, only a name, so picking one opens the common
   * events editor instead of moving the screen underneath it.
   */
  async function findEvent(query = '') {
    const found = await openEventList(store.project, eventContext(), { query });
    if (!found) return;
    if (found.common) {
      await openCommonEventsEditor();
      return;
    }
    state.mapIndex = found.mapIndex;
    state.screenIndex = found.screenIndex;
    renderAll();
    const row = entityList.querySelectorAll('[data-entity]')[found.entityIndex];
    row?.scrollIntoView({ block: 'nearest' });
    row?.querySelector('input')?.focus();
  }

  /**
   * Put a copy of an actor on the current screen. Offset by one metatile and
   * kept on the screen, because a copy landing exactly under the original looks
   * like nothing happened and then two of them move as one.
   */
  function placeCopy(source, label) {
    const screen = currentScreen();
    if (screen.entities.length >= LIMITS.entitiesPerScreen) {
      return toast(`A screen can hold at most ${LIMITS.entitiesPerScreen} actors.`, 'error');
    }
    // The clipboard outlives the project it was filled from, and actorId is an
    // index into *this* project's actors. Pasting past the end would place an
    // actor that draws nothing and does nothing, which looks like a paste that
    // silently failed rather than one that should not have been offered.
    if (source.actorId >= store.project.sprites.actors.length) {
      return toast('That actor does not exist in this project, so there is nothing to place.', 'error');
    }
    const { mapIndex, screenIndex } = state;
    const copy = structuredClone(source);
    copy.x = Math.min(SCREEN_PX_W - METATILE_PX, source.x + METATILE_PX);
    copy.y = Math.min(SCREEN_PX_H - METATILE_PX, source.y + METATILE_PX);
    store.commit(label, (project) => {
      project.maps[mapIndex].screens[screenIndex].entities.push(copy);
    });
    renderScreen();
    renderEntities();
  }

  const setEntityProp = (index, label, patch) => {
    const { mapIndex, screenIndex } = state;
    store.commit(label, (project) => {
      const target = project.maps[mapIndex].screens[screenIndex].entities[index];
      target.props = { ...target.props, ...patch };
    });
    renderScreen();
    renderEntities();
  };

  /**
   * What an actor does when you talk to it. A line of dialogue is the common
   * case and gets a box right here; anything conditional is an event, which is
   * the same thing with pages, and opens its own editor.
   *
   * The preview wraps with the compiler's own `wrapText`, so the page count
   * under the box is a promise the ROM keeps rather than an approximation.
   */
  function dialogueEditor(entity, index) {
    const text = entity.props?.dialogue ?? '';
    const pages = text.trim() ? wrapText(text, BOX_COLS, BOX_ROWS) : [];
    const event = entity.props?.event ?? null;
    const context = eventContext();

    return el(
      'div',
      { style: { paddingLeft: '10px', borderLeft: '2px solid var(--line)' } },
      // An event overrides the plain line, so showing both editable at once
      // would be offering a field the build ignores.
      event
        ? el(
            'div',
            null,
            event.pages.map((page, position) =>
              el(
                'p.hint',
                { style: { margin: '0 0 2px' } },
                `${position + 1}. ${describeCondition(page.cond, context)} → ` +
                  (page.commands.map((command) => describeCommand(command, context)).join('; ') || 'nothing')
              )
            )
          )
        : el(
            'div',
            null,
            el('textarea', {
              rows: 4,
              value: text,
              placeholder: 'Say something when the player interacts…',
              // Monospace on purpose: the box on the NES is a fixed grid, so a
              // proportional font here would misrepresent how much fits on a line.
              style: { resize: 'vertical', fontFamily: 'var(--mono)', lineHeight: '1.4' },
              // On change, not input: every keystroke would be its own undo entry.
              onchange: (fired) => setEntityProp(index, 'Change dialogue', { dialogue: fired.target.value })
            }),
            pages.length
              ? el(
                  'p.hint',
                  { style: { marginTop: '4px' } },
                  `${pages.length} page${pages.length === 1 ? '' : 's'} of ${BOX_ROWS} lines — ` +
                    'a blank line starts a new one.'
                )
              : null
          ),
      el(
        'div.field-row',
        { style: { marginTop: '6px' } },
        el(
          'button.btn.btn-sm',
          {
            onclick: async () => {
              const result = await editEvent(event, eventContext());
              if (result !== undefined) setEntityProp(index, 'Edit event', { event: result });
            }
          },
          event ? 'Edit event…' : 'Event…'
        ),
        // Offered only where there is nothing to lose: a template replaces the
        // whole event, so with one already written this would be a button whose
        // job is to throw work away.
        event
          ? null
          : el(
              'button.btn.btn-sm',
              { title: 'Start from a chest, a gate, a one-off conversation…', onclick: () => applyTemplate(entity, index) },
              'Template…'
            ),
        triggerSelect(entity, index),
        hideSwitchSelect(entity, index)
      ),
      triggerNote(entity)
    );
  }

  /**
   * What makes this actor's event run. Only the triggers its behaviour has room
   * for are listed — `availableTriggers` is the single writer, and the compiler
   * applies the same rule, so this cannot offer a moment the ROM spends on
   * something else.
   */
  function triggerSelect(entity, index) {
    const actor = store.project.sprites.actors[entity.actorId];
    // The effective one, never the stored one: an actor edited in another Forge
    // can have taken the stored choice away, and a select with nothing selected
    // shows its first option while the project still says otherwise.
    const current = effectiveTrigger(entity, actor, store.project);
    return el(
      'select',
      {
        style: { flex: '1' },
        title: 'What makes this event run',
        onchange: (fired) => setEntityProp(index, 'Change trigger', { trigger: fired.target.value })
      },
      availableTriggers(actor, store.project).map((entry) =>
        el('option', { value: entry.id, selected: entry.id === current }, entry.label)
      )
    );
  }

  /**
   * The hint for the chosen trigger, and — for an entry event — whether this is
   * the actor that will actually get the moment. Only one event can run as a
   * screen loads, and the engine gives it to the first one placed; saying which
   * beats leaving it to be found by wondering why the other never fires.
   */
  function triggerNote(entity) {
    const actor = store.project.sprites.actors[entity.actorId];
    const stored = entity.props?.trigger ?? EVENT_TRIGGERS[0].id;
    const current = effectiveTrigger(entity, actor, store.project);
    // The stored choice is kept rather than rewritten — undo the change to the
    // actor and it comes back — so the only thing that has to happen here is
    // saying so, instead of describing a trigger the ROM will not use.
    if (current !== stored) {
      const label = (id) => EVENT_TRIGGERS.find((item) => item.id === id)?.label ?? id;
      return el(
        'p.hint',
        { dataset: { triggerHint: current }, style: { margin: '4px 0 0', color: 'var(--accent)' } },
        `“${label(stored)}” is not available for this actor any more — walking into it already ` +
          `means something else. This event runs “${label(current)}” instead until you pick again.`
      );
    }
    const entry = EVENT_TRIGGERS.find((item) => item.id === current);
    if (!entry || current === EVENT_TRIGGERS[0].id) return null;
    const entering =
      current === 'enter'
        ? (currentScreen().entities ?? []).filter((placed) => placed.props?.trigger === 'enter')
        : [];
    const shadowed = entering.length > 1 && entering[0] !== entity;
    return el(
      'p.hint',
      {
        // Named in the DOM because it is one of several hints in this panel and
        // the smoke test has no other way to ask for this one.
        dataset: { triggerHint: current },
        style: { margin: '4px 0 0', color: shadowed ? 'var(--accent)' : null }
      },
      shadowed
        ? 'Another actor on this screen already runs its event when the screen loads, and only ' +
            'the first one does. This one will not.'
        : entry.hint
    );
  }

  /**
   * Start an event from a ready-made shape. The template is built and then
   * *opened in the editor* rather than saved straight to the project: it is a
   * draft to adjust, and Cancel has to leave the actor exactly as it was.
   */
  async function applyTemplate(entity, index) {
    const templates = templatesFor(store.project);
    const free = firstFreeSwitch(store.project);
    if (free === null) {
      return toast(
        `Every one of the ${RPG_LIMITS.switches} switches is in use, so a template has none left ` +
          'to guard its first page with.',
        'error'
      );
    }

    const chosen = await showModal({
      title: 'Start from a template',
      width: 460,
      body: (close) =>
        el(
          'div',
          { style: { minWidth: '420px' } },
          el(
            'p.hint',
            { style: { marginBottom: '10px' } },
            `Each of these is a guarded page plus a fallback, wired to switch ${free} — the lowest ` +
              'one nothing else uses. It opens in the editor, so nothing is decided yet.'
          ),
          templates.map((template) =>
            el(
              'div',
              {
                dataset: { template: template.id },
                style: {
                  padding: '8px 10px',
                  marginBottom: '6px',
                  background: 'var(--bg-2)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--radius)',
                  cursor: 'pointer'
                },
                onclick: () => close(template)
              },
              el('div', { style: { fontWeight: '600' } }, template.label),
              el('p.hint', { style: { margin: '2px 0 0' } }, template.hint)
            )
          )
        ),
      actions: [{ label: 'Cancel', value: null }]
    });
    if (!chosen) return;

    const result = await editEvent(chosen.build(store.project, free), eventContext());
    if (result !== undefined) setEntityProp(index, `Event from ${chosen.label}`, { event: result });
  }

  /** A switch that makes this actor absent — an opened chest, a departed NPC. */
  function hideSwitchSelect(entity, index) {
    const current = entity.props?.hideSwitch;
    const names = store.project.switches ?? [];
    return el(
      'select',
      {
        style: { flex: '1' },
        title: 'This actor does not spawn once the chosen switch is on',
        onchange: (fired) =>
          setEntityProp(index, 'Change hide switch', {
            hideSwitch: fired.target.value === '' ? null : Number(fired.target.value)
          })
      },
      el('option', { value: '', selected: current === null || current === undefined }, 'Always here'),
      Array.from({ length: RPG_LIMITS.switches }, (_, n) =>
        el('option', { value: n, selected: n === current }, `Gone once ${names[n]?.trim() || `switch ${n}`}`)
      )
    );
  }

  /** Where a door leads: a screen anywhere in the project, and a landing spot. */
  function doorTarget(entity, index) {
    const flat = flatScreens(store.project);

    const setProp = (key, value) => {
      const { mapIndex, screenIndex } = state;
      store.commit('Change door target', (project) => {
        const target = project.maps[mapIndex].screens[screenIndex].entities[index];
        target.props = { ...target.props, [key]: value };
      });
      renderScreen();
      renderEntities();
    };

    return el(
      'div',
      { style: { paddingLeft: '10px', borderLeft: '2px solid var(--line)' } },
      el(
        'select',
        {
          style: { marginBottom: '4px' },
          onchange: (event) => setProp('toScreen', Number(event.target.value))
        },
        flat.map((entry, position) =>
          el('option', { value: position, selected: position === (entity.props?.toScreen ?? 0) }, `→ ${entry.label}`)
        )
      ),
      el(
        'div.field-row',
        null,
        el('input', {
          type: 'number',
          min: 0,
          max: 240,
          value: entity.props?.toX ?? 112,
          title: 'Landing x',
          onchange: (event) => setProp('toX', Math.max(0, Math.min(240, Number(event.target.value))))
        }),
        el('input', {
          type: 'number',
          min: 0,
          max: 224,
          value: entity.props?.toY ?? 112,
          title: 'Landing y',
          onchange: (event) => setProp('toY', Math.max(0, Math.min(224, Number(event.target.value))))
        })
      )
    );
  }

  function renderEntities() {
    const screen = currentScreen();
    const actors = store.project.sprites.actors;
    fill(entityList,
      el(
        'div.panel-head',
        { style: { paddingLeft: '0' } },
        `Actors on this screen (${screen.entities.length}/${LIMITS.entitiesPerScreen})`
      ),
      el(
        'div.field-row.wrap',
        null,
        // Searching for something is a project-wide question — a warp's
        // destination is somewhere else by definition — so this jumps the whole
        // Forge rather than filtering the list below it.
        el(
          'button.btn.btn-sm',
          {
            title: 'Search every placed actor in the project',
            onclick: () => findEvent()
          },
          'Find…'
        ),
        // The switches are project-wide, but this is where they get used, so
        // this is where they are named.
        el(
          'button.btn.btn-sm',
          {
            title: 'Name the 64 flags events can set and test',
            onclick: () =>
              editSwitches(store.project.switches ?? [], (names) => {
                store.commit('Rename switches', (project) => {
                  project.switches = names;
                });
                renderEntities();
              })
          },
          'Switches…'
        ),
        el(
          'button.btn.btn-sm',
          {
            title: `Name the ${RPG_LIMITS.variables} counters events can set and compare`,
            onclick: () =>
              editVariables(store.project.variables ?? [], (names) => {
                store.commit('Rename variables', (project) => {
                  project.variables = names;
                });
                renderEntities();
              })
          },
          'Variables…'
        ),
        el(
          'button.btn.btn-sm',
          {
            title: 'Author events any placement can run — a chest, a shop, a recurring cutscene',
            onclick: openCommonEventsEditor
          },
          'Common events…'
        )
      ),
      // Only once something has been copied *here*: an always-present Paste
      // that usually cannot do anything is worse than no button at all.
      clipboardIsHere()
        ? el(
            'button.btn.btn-sm',
            {
              style: { marginBottom: '8px' },
              title: 'Put the copied actor on this screen',
              onclick: () => placeCopy(clipboard.entity, 'Paste actor')
            },
            `Paste ${entityLabel(store.project, clipboard.entity)}`
          )
        : null,
      actors.length
        ? field(
            'Actor to place',
            el(
              'select',
              { onchange: (event) => (state.actorId = Number(event.target.value)) },
              actors.map((actor, index) =>
                el('option', { value: index, selected: index === state.actorId }, actor.name)
              )
            )
          )
        : el('p.hint', null, 'No actors defined yet — create them in the Sprite Forge.'),
      screen.entities.length
        ? screen.entities.map((entity, index) =>
            el(
              'div',
              { dataset: { entity: index }, style: { marginBottom: '6px' } },
              el(
                'div.field-row',
                null,
                // The name is what the event list and every "find uses" result
                // shows, so it is edited where the actor is placed rather than
                // behind another dialog. Unnamed placements keep reading as the
                // actor they are, which is what the placeholder says.
                el('input', {
                  type: 'text',
                  value: entity.props?.name ?? '',
                  maxLength: AUTHOR_NAME_MAX,
                  placeholder: actors[entity.actorId]?.name ?? `Actor ${entity.actorId}`,
                  title: 'What you call this one — “Gate key chest”, “Innkeeper”',
                  style: { flex: '1' },
                  onchange: (event) =>
                    setEntityProp(index, 'Rename placed actor', {
                      name: event.target.value.trim().slice(0, AUTHOR_NAME_MAX)
                    })
                }),
                el(
                  'button.btn.btn-sm',
                  {
                    title: 'Copy this actor, its dialogue and its event',
                    onclick: () => {
                      clipboard = {
                        dir: store.dir,
                        roster: rosterOf(store.project),
                        entity: structuredClone(entity)
                      };
                      renderEntities();
                      toast(`Copied ${entityLabel(store.project, entity)}.`);
                    }
                  },
                  '⧉'
                ),
                el(
                  'button.btn.btn-sm',
                  {
                    title: 'Place another one just like this',
                    onclick: () => placeCopy(entity, 'Duplicate actor')
                  },
                  '+⧉'
                ),
                el(
                  'button.btn.btn-sm',
                  {
                    title: 'Remove',
                    onclick: () => {
                      const { mapIndex, screenIndex } = state;
                      store.commit('Remove actor', (project) => {
                        project.maps[mapIndex].screens[screenIndex].entities.splice(index, 1);
                      });
                      renderScreen();
                      renderEntities();
                    }
                  },
                  '✕'
                )
              ),
              el(
                'p.hint',
                { style: { margin: '0 0 4px' } },
                `${actors[entity.actorId]?.name ?? `Actor ${entity.actorId}`} @ ${entity.x},${entity.y}`
              ),
              // A door needs somewhere to lead, so it gets its target inline;
              // anything else can be talked to, so it gets a line to say.
              actors[entity.actorId]?.behavior === 'door'
                ? doorTarget(entity, index)
                : canTalk(actors[entity.actorId])
                  ? dialogueEditor(entity, index)
                  : null
            )
          )
        : el('p.hint', null, 'Nothing placed here yet.')
    );
  }

  /**
   * Which screen the cartridge boots into, if any. The engine writes the game's
   * name and the prompt over it and forces those two bands to background palette
   * 0 so the text is legible whatever is underneath — which is worth saying here,
   * because it is the one rule an author has to design a title screen around.
   */
  function titleScreenSelect() {
    const { titleMap, titleScreen } = store.project.project;
    const options = flatScreens(store.project);
    const currentIndex = options.findIndex(
      (entry) => entry.mapIndex === titleMap && entry.screenIndex === titleScreen
    );

    return el(
      'div',
      null,
      el(
        'select',
        {
          onchange: (event) => {
            const chosen = event.target.value === '' ? null : options[Number(event.target.value)];
            store.commit('Change title screen', (project) => {
              project.project.titleMap = chosen ? chosen.mapIndex : null;
              project.project.titleScreen = chosen ? chosen.screenIndex : 0;
            });
            renderMapSettings();
          }
        },
        el('option', { value: '', selected: titleMap === null || titleMap === undefined }, 'None — start playing at once'),
        options.map((entry, index) =>
          el('option', { value: index, selected: index === currentIndex }, entry.label)
        )
      ),
      el(
        'p.hint',
        { style: { marginTop: '6px' } },
        titleMap === null || titleMap === undefined
          ? 'With no title screen the game begins the moment the cartridge boots.'
          : 'The game’s name and “PRESS START” are written over this screen. Metatile rows 4–5 and ' +
            '8–9 are recoloured to background palette 0 to keep the text readable, so leave them ' +
            'clear of art you care about.'
      )
    );
  }

  /**
   * What a battle on this map looks like, and how often one starts.
   *
   * The backdrop is two background tiles from the *battle* tileset rather than
   * this map's — the engine switches CHR banks on the way in, which is half of
   * why an RPG needs a cartridge that can switch them.
   */
  function battleSettings(map) {
    const mapIndex = state.mapIndex;
    const setMap = (label, patch) => {
      store.commit(label, (project) => Object.assign(project.maps[mapIndex], patch));
      renderMapSettings();
    };
    const encounters = map.encounters ?? { rate: 0, actorIds: [] };
    const hostile = store.project.sprites.actors
      .map((actor, id) => ({ actor, id }))
      .filter(({ actor }) => isMonsterActor(actor));

    const tilePicker = (value, onChange) =>
      el(
        'select',
        { onchange: (event) => onChange(Number(event.target.value)) },
        Array.from({ length: FONT_BASE }, (_, id) =>
          el('option', { value: id, selected: id === value }, `Tile $${id.toString(16).toUpperCase().padStart(2, '0')}`)
        )
      );

    return el(
      'div',
      null,
      el('div.panel-head', { style: { paddingLeft: '0' } }, 'Battles here'),
      field('Sky tile', tilePicker(map.battleSkyTile ?? 0, (value) => setMap('Change battle sky', { battleSkyTile: value }))),
      field(
        'Ground tile',
        tilePicker(map.battleGroundTile ?? 0, (value) => setMap('Change battle ground', { battleGroundTile: value }))
      ),
      field(
        'Steps between encounters',
        el('input', {
          type: 'number',
          min: 0,
          max: 255,
          value: encounters.rate,
          title: 'Zero turns wandering monsters off for this map',
          onchange: (event) =>
            setMap('Change encounter rate', {
              encounters: { ...encounters, rate: Math.max(0, Math.min(255, Number(event.target.value))) }
            })
        })
      ),
      el(
        'p.hint',
        null,
        encounters.rate
          ? 'A roll every this many steps, and the formation is picked from the list below.'
          : 'No wandering monsters on this map. Walking into a placed monster still starts a fight — one you cannot run from.'
      ),
      // Only hostile actors are offered as new choices: a formation slot
      // pointing at a gem would compile, and then stand there being a gem.
      // The rows themselves are shown whenever there is anything to add OR
      // anything already there to see or clear -- not only when hostile is
      // non-empty. mapEncounterFormation (shared/project.js), the compiler's
      // own single writer for this table, does not filter by damage at all:
      // an actor already sitting in a slot keeps compiling into real
      // wandering encounters after its damage is edited down to zero, so
      // collapsing these rows to a hint in that case would strand an author
      // unable to see or clear what the ROM still ships -- the same trap
      // battleTestSection below was fixed against.
      hostile.length || encounters.actorIds.length
        ? Array.from({ length: RPG_LIMITS.encounterActors }, (_, slot) => {
            const slotId = encounters.actorIds[slot];
            const stranded = slotId !== undefined && !hostile.some((entry) => entry.id === slotId);
            return el(
              'select',
              {
                'data-encounter-slot': slot,
                style: { marginBottom: '4px' },
                onchange: (event) => {
                  const ids = [...encounters.actorIds];
                  if (event.target.value === '') ids.splice(slot, 1);
                  else ids[slot] = Number(event.target.value);
                  setMap('Change encounter table', { encounters: { ...encounters, actorIds: ids.filter((id) => id !== undefined) } });
                }
              },
              el('option', { value: '', selected: slotId === undefined }, `Slot ${slot + 1} — empty`),
              hostile.map(({ actor, id }) => el('option', { value: id, selected: id === slotId }, actor.name)),
              stranded
                ? el(
                    'option',
                    { value: slotId, selected: true },
                    `${store.project.sprites.actors[slotId]?.name ?? `#${slotId}`} (no longer reads as a monster)`
                  )
                : null
            );
          })
        : el('p.hint', { style: { color: 'var(--accent)' } }, 'No actor deals damage yet, so none can be added to this table.'),
      battleTestSection(map, hostile)
    );
  }

  /**
   * The two battle-test entry points (ROADMAP item 3's last bullet): this
   * map's own wandering table, and an arbitrary formation. Both fire through
   * the same battleTest() above; only where the formation comes from differs.
   *
   * The map's own table is read through mapEncounterFormation
   * (shared/project.js) rather than raw map.encounters.actorIds -- the same
   * filtering main/build/generate.js's compiled map_enc_actors table applies
   * (a deleted or out-of-range actor id is dropped, not just truncated), so
   * this can never test a monster the shipped ROM would not actually place.
   *
   * "This map's table" is gated on tableEmpty alone, never on hostile: the
   * compiler's mapEncounterFormation does not filter by isMonsterActor/damage
   * at all -- an actor's damage only decides whether *touching it as a placed
   * entity* starts a contact fight, a different question the wandering table
   * has no concept of -- so an actor already sitting in this map's encounter
   * table keeps firing real wandering encounters after its damage is edited
   * down to zero, whether or not hostile still lists it. Gating this button
   * on hostile.length (as an earlier version did) hid it in exactly that
   * case: the ROM still shipped the fight, and the one tool for previewing
   * it disappeared. hostile only bounds the *hand-picked* formation below,
   * which is a genuinely different, broader tool ("any plausible monster
   * formation") than "what does this map's table actually contain".
   */
  function battleTestSection(map, hostile) {
    const actorCount = store.project.sprites.actors.length;
    const tableFormation = mapEncounterFormation(map, actorCount);
    const tableEmpty = tableFormation.every((id) => id === 0xff);
    if (tableEmpty && !hostile.length) return null; // genuinely nothing either entry point could fire
    const nameOf = (id) => hostile.find((entry) => entry.id === id)?.actor.name ?? `#${id}`;

    const picks = state.battleTestPicks.filter((id) => hostile.some((entry) => entry.id === id));
    const togglePick = (id) => {
      if (picks.includes(id)) state.battleTestPicks = picks.filter((pick) => pick !== id);
      else if (picks.length < RPG_LIMITS.monstersPerBattle) state.battleTestPicks = [...picks, id];
      renderMapSettings();
    };

    return el(
      'div',
      { style: { marginTop: '10px' } },
      el('div.panel-head', { style: { paddingLeft: '0' } }, 'Battle-test'),
      el('p.hint', { style: { marginBottom: '6px' } }, 'Fires a fight right now, from ⚑ Start — nothing about the project changes.'),
      el(
        'div.field-row',
        { style: { marginBottom: '10px' } },
        el(
          'button.btn.btn-sm',
          {
            disabled: tableEmpty,
            title: tableEmpty ? "This map's encounter table has no monster it would actually place" : '',
            onclick: () => battleTest(tableFormation, `${map.name}'s encounter table`)
          },
          "▶ This map's table"
        )
      ),
      hostile.length
        ? [
            el(
              'div',
              { style: { marginBottom: '4px' } },
              hostile.map(({ actor, id }) =>
                el(
                  'label.check',
                  { style: { display: 'inline-block', marginRight: '10px' } },
                  el('input', {
                    type: 'checkbox',
                    checked: picks.includes(id),
                    disabled: !picks.includes(id) && picks.length >= RPG_LIMITS.monstersPerBattle,
                    onchange: () => togglePick(id)
                  }),
                  actor.name
                )
              )
            ),
            el(
              'button.btn.btn-sm',
              {
                disabled: picks.length === 0,
                onclick: () => battleTest(picks, picks.map(nameOf).join(' + '))
              },
              '▶ Chosen formation'
            )
          ]
        : el(
            'p.hint',
            { style: { color: 'var(--accent)' } },
            'No actor deals damage yet, so there is nothing to hand-pick a formation from.'
          )
    );
  }

  function renderMapSettings() {
    const map = currentMap();
    const { startMap, startScreen, startX, startY } = store.project.project;
    fill(mapSettings,
      field(
        'Map',
        el(
          'div.field-row',
          null,
          el(
            'select',
            {
              onchange: (event) => {
                state.mapIndex = Number(event.target.value);
                state.screenIndex = 0;
                renderAll();
              }
            },
            store.project.maps.map((entry, index) =>
              el('option', { value: index, selected: index === state.mapIndex }, entry.name)
            )
          ),
          el(
            'button.btn.btn-sm',
            {
              title: 'Add a map',
              onclick: () => {
                store.commit('Add map', (project) => {
                  project.maps.push(createMap(project.maps.length, `Map ${project.maps.length}`));
                });
                state.mapIndex = store.project.maps.length - 1;
                state.screenIndex = 0;
                renderAll();
              }
            },
            '+'
          ),
          el(
            'button.btn.btn-sm',
            {
              title: 'Delete this map',
              onclick: async () => {
                if (store.project.maps.length === 1) return toast('A project needs at least one map.', 'error');
                if (!(await confirmModal('Delete map', `Delete "${map.name}" and everything on it?`, 'Delete'))) return;
                const index = state.mapIndex;
                store.commit('Delete map', (project) => {
                  project.maps.splice(index, 1);
                  project.maps.forEach((entry, position) => (entry.id = position));
                  if (project.project.startMap >= project.maps.length) {
                    project.project.startMap = 0;
                    project.project.startScreen = 0;
                  }
                });
                state.mapIndex = 0;
                state.screenIndex = 0;
                renderAll();
              }
            },
            '✕'
          )
        )
      ),
      field(
        'Name',
        el('input', {
          type: 'text',
          value: map.name,
          onchange: (event) => {
            const index = state.mapIndex;
            const value = event.target.value.trim() || `Map ${index}`;
            store.commit('Rename map', (project) => {
              project.maps[index].name = value;
            });
            renderMapSettings();
          }
        })
      ),
      // Only shown when the cartridge can hold more than one: with a single
      // tileset there is nothing to choose and the control would be noise.
      store.project.tilesets.length > 1
        ? field(
            'Tileset',
            el(
              'select.input',
              {
                onchange: (event) => {
                  const index = state.mapIndex;
                  const value = Number(event.target.value);
                  store.commit('Change map tileset', (project) => {
                    project.maps[index].tilesetId = value;
                  });
                  renderAll();
                }
              },
              store.project.tilesets.map((tileset, index) =>
                el('option', { value: index, selected: index === map.tilesetId }, tileset.name)
              )
            )
          )
        : null,
      field(
        'Screens across / down',
        el(
          'div.field-row',
          null,
          el('input', {
            type: 'number',
            min: 1,
            max: LIMITS.mapGrid,
            value: map.gridW,
            onchange: (event) => resizeMap(Math.max(1, Math.min(LIMITS.mapGrid, Number(event.target.value))), map.gridH)
          }),
          el('span', null, '×'),
          el('input', {
            type: 'number',
            min: 1,
            max: LIMITS.mapGrid,
            value: map.gridH,
            onchange: (event) => resizeMap(map.gridW, Math.max(1, Math.min(LIMITS.mapGrid, Number(event.target.value))))
          })
        )
      ),
      field(
        'Music',
        el(
          'select',
          {
            onchange: (event) => {
              const raw = event.target.value;
              const value = raw === '' ? null : Number(raw);
              const index = state.mapIndex;
              store.commit('Change map music', (project) => {
                project.maps[index].songId = value;
              });
              renderMapSettings();
            }
          },
          el('option', { value: '', selected: map.songId === null || map.songId === undefined }, 'Silence'),
          store.project.songs.map((song, index) =>
            el('option', { value: index, selected: index === map.songId }, song.name)
          )
        )
      ),
      // Naming the screen you are looking at, next to the navigator that
      // selected it. The name is authoring metadata and reaches no .inc file;
      // what it buys is every warp, door and search result reading as a place.
      field(
        `Screen ${state.screenIndex} name`,
        el('input', {
          type: 'text',
          value: currentScreen().name ?? '',
          maxLength: AUTHOR_NAME_MAX,
          placeholder: 'unnamed — e.g. Cave mouth',
          onchange: (event) => {
            const { mapIndex, screenIndex } = state;
            const value = event.target.value;
            store.commit('Rename screen', (project) => {
              project.maps[mapIndex].screens[screenIndex].name = value.trim().slice(0, AUTHOR_NAME_MAX);
            });
            renderAll();
          }
        })
      ),
      el('div.panel-head', { style: { paddingLeft: '0' } }, 'Player start'),
      el('p.hint', null, `${screenLabel(store.project, startMap, startScreen)} · x ${startX}, y ${startY}`),
      el('p.hint', null, 'Choose the ⚑ Start tool and click to move it.'),
      el('div.panel-head', { style: { paddingLeft: '0' } }, 'Title screen'),
      titleScreenSelect(),
      store.project.project.gameType === 'rpg' ? battleSettings(map) : null,
      el('div', { style: { marginTop: '14px' } }, entityList)
    );
    renderEntities();
  }

  // ------------------------------------------------------------- assembly

  const metatilePanel = createMetatilePanel({
    renderer,
    getSelected: () => state.metatile,
    getTilesetId: () => currentMap().tilesetId,
    onSelect: (id) => {
      state.metatile = id;
    },
    onChange: () => {
      renderer.rebuild(store.project, currentMap().tilesetId);
      renderAll();
    }
  });

  function renderAll() {
    renderer.rebuild(store.project, currentMap().tilesetId);
    metatilePanel.render();
    renderNavigator(); // before renderScreen: the fit subtracts the navigator's height
    renderScreen();
    renderMapSettings();
  }

  function setTool(id) {
    state.tool = id;
    root.querySelectorAll('[data-tool]').forEach((button) => {
      button.classList.toggle('active', button.dataset.tool === id);
    });
  }

  function toolButton(tool) {
    return el(
      'button.btn.btn-sm',
      {
        class: state.tool === tool.id ? 'active' : '',
        title: tool.title,
        dataset: { tool: tool.id },
        onclick: () => setTool(tool.id)
      },
      tool.label
    );
  }

  const root = el(
    'div.forge',
    { style: { gridTemplateColumns: '300px 1fr 272px' } },
    metatilePanel.node,
    el(
      'div.panel',
      { style: { borderRight: 'none' } },
      el(
        'div.toolbar',
        null,
        TOOLS.map(toolButton),
        el('span.sep'),
        el(
          'label.check',
          null,
          el('input', {
            type: 'checkbox',
            checked: state.showGrid,
            onchange: (event) => {
              state.showGrid = event.target.checked;
              renderScreen();
            }
          }),
          'Grid'
        ),
        el(
          'label.check',
          null,
          el('input', {
            type: 'checkbox',
            checked: state.showCollision,
            onchange: (event) => {
              state.showCollision = event.target.checked;
              renderScreen();
            }
          }),
          'Collision'
        ),
        el('span.sep'),
        el('span.field-label', null, 'Zoom'),
        ...['fit', 1, 2, 3].map((zoom) =>
          el(
            'button.btn.btn-sm',
            {
              class: state.zoom === zoom ? 'active' : '',
              dataset: { zoom },
              title: zoom === 'fit' ? 'Scale the screen to the window' : `${zoom} screen pixels per NES pixel`,
              onclick: () => {
                state.zoom = zoom;
                root.querySelectorAll('[data-zoom]').forEach((button) => {
                  button.classList.toggle('active', button.dataset.zoom === String(zoom));
                });
                renderScreen();
              }
            },
            zoom === 'fit' ? 'Fit' : `${zoom}×`
          )
        ),
        el('span.spacer'),
        cursorInfo
      ),
      mapStage
    ),
    el('div.panel', null, el('div.panel-head', null, 'Map'), el('div.panel-body#mapSettingsPanel', null, mapSettings))
  );

  container.append(root);
  renderAll();
  const stopWatchingStage = observeSize(mapStage, renderScreen);
  app.setMeta('Map Forge');

  return {
    destroy() {
      stopWatchingStage();
      app.setMeta('');
    },
    onProjectChange() {
      if (state.mapIndex >= store.project.maps.length) state.mapIndex = 0;
      if (state.screenIndex >= currentMap().screens.length) state.screenIndex = 0;
      renderAll();
    }
  };
}
