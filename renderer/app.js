// Application shell: rail navigation, project lifecycle, Forge mounting.

import { store } from './store.js';
import { el, clear, fill, toast, showModal, confirmModal } from './ui.js';
import { GAME_TYPES } from '../shared/project.js';
import { RPG_DEFAULT_MAPPER, mapperById } from '../shared/cartridge.js';
import { TOGGLE_NAMES } from '../shared/testoverrides.js';

const FORGES = [
  {
    id: 'tile',
    label: 'Tile',
    glyph: '▦',
    title: 'Tile Forge',
    load: () => import('./forges/tile/tile.js')
  },
  {
    id: 'sprite',
    label: 'Sprite',
    glyph: '👾',
    title: 'Sprite Forge',
    load: () => import('./forges/sprite/sprite.js')
  },
  {
    id: 'items',
    label: 'Items',
    glyph: '🎒',
    title: 'Items Forge',
    load: () => import('./forges/items/items.js')
  },
  {
    id: 'map',
    label: 'Map',
    glyph: '🗺',
    title: 'Map Forge',
    load: () => import('./forges/map/map.js')
  },
  {
    id: 'sound',
    label: 'Sound',
    glyph: '♪',
    title: 'Sound Forge',
    load: () => import('./forges/sound/sound.js')
  },
  {
    id: 'controller',
    label: 'Control',
    glyph: '🎮',
    title: 'Controller Forge',
    load: () => import('./forges/controller/controller.js')
  },
  {
    id: 'code',
    label: 'Code',
    glyph: '‹›',
    title: 'Code Forge',
    load: () => import('./forges/code/code.js')
  },
  { separator: true },
  {
    id: 'build',
    label: 'Build',
    glyph: '⚙',
    title: 'Build & Play',
    load: () => import('./forges/build/build.js')
  },
  { separator: true },
  {
    id: 'tutorial',
    label: 'Learn',
    glyph: '🎓',
    title: 'Tutorial',
    load: () => import('./forges/tutorial/tutorial.js')
  }
];

const dom = {
  rail: document.querySelector('#rail'),
  stage: document.querySelector('#stage'),
  projectName: document.querySelector('#projectName'),
  dirtyDot: document.querySelector('#dirtyDot'),
  saveButton: document.querySelector('#saveButton'),
  playButton: document.querySelector('#playButton'),
  statusDot: document.querySelector('#statusDot'),
  statusText: document.querySelector('#statusText'),
  statusMeta: document.querySelector('#statusMeta')
};

let activeForgeId = 'tile';
let mounted = null;

// The selected test scenario (ROADMAP item 3's "Reload the ROM" bullet) —
// session state, not project state: it lives here, at the same altitude as
// `mounted`/`activeForgeId`, specifically because the Build Forge's own
// module is exactly what gets destroyed by the edit this feature exists to
// let the user make (leave to fix something, come back). Never touches
// `store` — a test scenario is debugger configuration, not saved game data,
// and stuffing it into the project would mean either polluting every undo
// snapshot with it or hand-excluding it from structuredClone/save, both
// worse than a plain variable that was never going to be saved anyway.
// Cleared on project open/close so a description resolved against one
// project's names never lingers to be resolved against a different one.
let playScenario = null;

export const app = {
  store,
  setStatus(message, kind = '') {
    dom.statusText.textContent = message;
    dom.statusDot.className = `status-dot ${kind}`;
  },
  setMeta(text) {
    dom.statusMeta.textContent = text ?? '';
  },
  toast,
  showModal,
  goTo: (id) => selectForge(id),
  /**
   * Every real Forge id, in rail order — the single source `main/smoke.js`'s
   * "visit every Forge" step reads instead of keeping its own hand-written
   * list. `FORGES` itself stays module-private (its `load` closures are not
   * something a test needs, or should be able to call directly), so this is
   * the ids alone, in the same shape a second hardcoded array would have
   * been guessing at. Filters out `{ separator: true }` rail dividers, which
   * carry no `id` and mount nothing.
   */
  get forgeIds() {
    return FORGES.filter((entry) => !entry.separator).map((entry) => entry.id);
  },
  /**
   * A Forge holding an edit it has not committed to the store yet says so here.
   * Nothing else can: the store emits no event until the commit lands, and the
   * close guard asks main long before that.
   */
  notePendingEdits: () => refreshChrome(),
  /** The currently mounted Forge, for menu actions and the smoke test. */
  get current() {
    return mounted;
  },
  /** The remembered scenario, or null if none has been chosen this session. */
  get playScenario() {
    return playScenario;
  },
  /**
   * Merge a partial update into the remembered scenario — `{toggles:
   * {invincibility: true}}` leaves `startAt`/`battleTest` and the other two
   * toggles alone, which is what lets the debugger's toggle checkboxes echo
   * into this record live, one flip at a time, without each write clobbering
   * whatever a *different* flip just wrote. A fresh scenario choice (Map
   * Forge's own call) replaces `startAt`/`battleTest` and all three toggles
   * at once instead, by passing every field explicitly.
   */
  rememberPlayScenario(patch) {
    // TOGGLE_NAMES (shared/testoverrides.js) is the single writer for which
    // toggles exist -- built from it rather than a hardcoded {invincibility,
    // collision, encounters} literal, so a future fourth toggle is not
    // silently missing from what a scenario remembers just because this
    // object forgot to grow with it.
    const toggles = Object.fromEntries(TOGGLE_NAMES.map((name) => [name, playScenario?.toggles?.[name] ?? false]));
    Object.assign(toggles, patch.toggles);
    playScenario = {
      startAt: 'startAt' in patch ? patch.startAt : (playScenario?.startAt ?? null),
      battleTest: 'battleTest' in patch ? patch.battleTest : (playScenario?.battleTest ?? null),
      toggles
    };
  }
};

// --------------------------------------------------------------- rail nav

function renderRail() {
  clear(dom.rail);
  for (const entry of FORGES) {
    if (entry.separator) {
      dom.rail.append(el('div.rail-sep'));
      continue;
    }
    const item = el(
      'button.rail-item',
      {
        class: entry.id === activeForgeId ? 'active' : '',
        title: entry.title,
        onclick: () => selectForge(entry.id)
      },
      el('span.rail-glyph', null, entry.glyph),
      el('span.rail-label', null, entry.label)
    );
    dom.rail.append(item);
  }
}

async function selectForge(id) {
  if (!store.isOpen) return;
  const entry = FORGES.find((forge) => forge.id === id);
  if (!entry) return;
  activeForgeId = id;
  renderRail();

  mounted?.destroy?.();
  mounted = null;
  clear(dom.stage);

  try {
    const module = await entry.load();
    mounted = module.mount(dom.stage, app) ?? null;
    app.setStatus(entry.title, '');
  } catch (error) {
    console.error(error);
    fill(dom.stage,
      el(
        'div.placeholder',
        null,
        el('div.placeholder-glyph', null, '⚠'),
        el('h2', null, `${entry.title} failed to load`),
        el('p', null, String(error?.message ?? error))
      )
    );
  }
}

// ---------------------------------------------------------------- welcome

async function renderWelcome() {
  mounted?.destroy?.();
  mounted = null;
  const recent = await window.forge.project.recent();
  fill(dom.stage,
    el(
      'div.welcome',
      null,
      el('h1', null, 'NES Game Forge'),
      el(
        'p',
        null,
        'Build NES games with a UI: draw tiles and sprites, paint maps, compose music, ' +
          'map the controller, then assemble a real .nes ROM and play it right here.'
      ),
      el(
        'div.welcome-actions',
        null,
        el('button.btn.btn-accent', { onclick: newProject }, 'New project'),
        el('button.btn', { onclick: openProject }, 'Open project')
      ),
      recent.ok && recent.value.length
        ? el(
            'div.recent-list',
            null,
            recent.value.map((entry) =>
              el(
                'button.recent-item',
                { onclick: () => loadProject(entry.dir) },
                el('span', null, entry.name),
                el('span.recent-path', null, entry.dir)
              )
            )
          )
        : null
    )
  );
}

// -------------------------------------------------------- project actions

/**
 * Action adventure or turn-based RPG. This is the one decision a project cannot
 * comfortably change its mind about later — an RPG's battle system lives in a
 * switchable program bank, which rules out half the cartridges and takes screen
 * capacity with it — so it is asked once, up front, and said out loud.
 */
function chooseGameType() {
  return showModal({
    title: 'New project',
    width: 460,
    body: (close) =>
      el(
        'div',
        null,
        el('p.hint', { style: { marginBottom: '14px' } }, 'What kind of game is this?'),
        ...GAME_TYPES.map((type) =>
          el(
            'button.btn',
            {
              style: { display: 'block', width: '100%', textAlign: 'left', marginBottom: '8px', padding: '10px' },
              onclick: () => close(type.id)
            },
            el('div', { style: { fontWeight: '700', marginBottom: '3px' } }, type.label),
            el('div.hint', { style: { margin: '0' } }, type.hint)
          )
        ),
        el(
          'p.hint',
          { style: { marginTop: '12px' } },
          `A turn-based RPG starts on ${mapperById(RPG_DEFAULT_MAPPER).name}, because its battle system ` +
            'needs a cartridge that can switch program banks. Action games start on NROM.'
        )
      ),
    actions: [{ label: 'Cancel', value: null }]
  });
}

async function newProject() {
  // Asked before the folder picker, because the answer decides the cartridge as
  // well as the engine: an RPG needs a mapper that can switch program banks, and
  // changing your mind afterwards means rebuilding the maps around a battle
  // system that was not there.
  const gameType = await chooseGameType();
  if (!gameType) return;
  const picked = await window.forge.project.pickNew();
  if (!picked.ok) return toast(picked.error, 'error');
  if (!picked.value) return;
  const result = await window.forge.project.create({ dir: picked.value, gameType });
  if (!result.ok) return toast(result.error, 'error');
  store.open(result.value.dir, result.value.project);
  toast('Project created', 'success');
}

async function openProject() {
  const picked = await window.forge.project.pickOpen();
  if (!picked.ok) return toast(picked.error, 'error');
  if (!picked.value) return;
  await loadProject(picked.value);
}

async function loadProject(dir) {
  const result = await window.forge.project.open(dir);
  if (!result.ok) return toast(result.error, 'error');
  store.open(result.value.dir, result.value.project);
}

async function saveProject() {
  if (!store.isOpen) return false;
  // A Forge holding an edit it has not committed yet — the Code Forge's editor
  // waits for typing to pause — writes it into the project first, so Ctrl+S
  // never saves a version older than what is on screen.
  mounted?.flushPendingEdits?.();
  const result = await window.forge.project.save(store.dir, store.project);
  if (!result.ok) {
    toast(result.error, 'error');
    return false;
  }
  store.markSaved();
  app.setStatus('Project saved', 'ready');
  return true;
}

app.saveProject = saveProject;

async function buildAndPlay() {
  if (!store.isOpen) return;
  await selectForge('build');
  mounted?.buildAndPlay?.();
}

// --------------------------------------------------------------- chrome

// Unsaved work is protected in the main process, on the window's close event,
// because that is the only place that can ask the question and still let the
// window shut afterwards. Cancelling `beforeunload` from here instead — which is
// what this used to do — vetoed the close silently: no prompt, and the title-bar
// X simply stopped working for the rest of the session.
//
// "Unsaved" is not `store.dirty` alone. The Code Forge waits for typing to pause
// before it commits, so a buffer that has diverged is work at risk that the store
// has not heard about yet — and the window's X does not wait for the debounce.
const unsavedWork = () => store.isOpen && (store.dirty || Boolean(mounted?.hasPendingEdits?.()));

let reportedDirty = null;
function reportDirty() {
  const dirty = unsavedWork();
  const name = store.project?.project?.name ?? '';
  const key = `${dirty}:${name}`;
  if (key === reportedDirty) return; // one message per real change, not per stroke
  reportedDirty = key;
  window.forge.project.reportDirty(dirty, name);
}

function refreshChrome() {
  const open = store.isOpen;
  const unsaved = unsavedWork();
  dom.saveButton.disabled = !open || !unsaved;
  dom.playButton.disabled = !open;
  dom.dirtyDot.hidden = !unsaved;
  dom.projectName.textContent = open ? store.project.project.name : 'No project open';
  dom.projectName.title = store.dir ?? '';
  reportDirty();
}

store.subscribe((detail) => {
  refreshChrome();
  if (detail.type === 'open') {
    playScenario = null;
    selectForge(activeForgeId);
  } else if (detail.type === 'close') {
    playScenario = null;
    renderWelcome();
  } else if (detail.type === 'undo' || detail.type === 'redo') {
    mounted?.onProjectChange?.(detail);
    app.setStatus(`${detail.type === 'undo' ? 'Undo' : 'Redo'}${detail.label ? `: ${detail.label}` : ''}`);
  } else if (!detail.live) {
    mounted?.onProjectChange?.(detail);
  }
});

document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', () => runAction(button.dataset.action));
});

/**
 * Ctrl+Z with the caret in a code editor means "undo my typing", not "undo a
 * project snapshot" — but the application menu owns the accelerator, so the
 * keystroke never reaches the textarea by itself and has to be handed back.
 * `execCommand` is deprecated and is still the only way into a textarea's own
 * undo stack; it fires `input`, so the editor re-highlights and re-commits like
 * any other edit. It answers false when that stack is empty, and the project's
 * undo takes over from there.
 */
function undoInFocusedEditor(redo) {
  const node = document.activeElement;
  if (!node?.classList?.contains('code-input') || node.readOnly) return false;
  return document.execCommand(redo ? 'redo' : 'undo');
}

async function runAction(action) {
  switch (action) {
    case 'project:new':
      return newProject();
    case 'project:open':
      return openProject();
    case 'project:save':
    case 'project:saveAs':
      return saveProject();
    case 'edit:undo':
      if (undoInFocusedEditor(false)) return;
      // Uncommitted typing has to become an undo entry before it can be undone.
      // Skipping this reverts the project *underneath* the buffer, and the
      // pending commit then writes the typing back into the undone state.
      mounted?.flushPendingEdits?.();
      if (!store.undo()) app.setStatus('Nothing to undo');
      return;
    case 'edit:redo':
      if (undoInFocusedEditor(true)) return;
      mounted?.flushPendingEdits?.();
      if (!store.redo()) app.setStatus('Nothing to redo');
      return;
    case 'build:run':
      await selectForge('build');
      return mounted?.build?.();
    case 'build:play':
      return buildAndPlay();
    case 'build:mesen':
      await selectForge('build');
      return mounted?.openInMesen?.();
    default:
      return undefined;
  }
}

window.forge.on('menu:action', runAction);

window.addEventListener('keydown', (event) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName ?? '');
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveProject();
  } else if (mod && event.key.toLowerCase() === 'z' && !typing) {
    event.preventDefault();
    runAction(event.shiftKey ? 'edit:redo' : 'edit:undo');
  }
});


// Exposed for the smoke test and for poking at state from DevTools.
window.__app = app;

renderRail();
refreshChrome();
renderWelcome();
