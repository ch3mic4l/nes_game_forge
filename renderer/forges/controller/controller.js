// Controller Forge — decide what each NES button does, and how the keyboard
// drives the built-in player.

import { store } from '../../store.js';
import { el, fill, field, toast } from '../../ui.js';
import { ACTIONS, BUTTONS, INPUT_STATES } from '../../../shared/project.js';

// What the engine does with each action, in each game state. A `null` means the
// engine ignores that action there — a bound button that does nothing is worth
// saying out loud, the same way an unimplemented action used to be.
const ENGINE_SUPPORT = {
  none: {
    gameplay: 'Nothing happens.',
    menu: 'Nothing happens.',
    dialog: 'Nothing happens.',
    title: 'Nothing happens.'
  },
  attack: {
    gameplay: 'Beats the nearest actor within 20 pixels that is not a pickup.',
    menu: null,
    dialog: null
  },
  interact: {
    gameplay:
      'Collects a nearby pickup without having to walk onto it, or — with nothing to collect — ' +
      'starts a conversation with an actor in reach.',
    menu: null,
    dialog: null
  },
  dash: {
    gameplay: 'Doubles walking speed for as long as the button is held.',
    menu: null,
    dialog: null
  },
  item: {
    gameplay: 'Opens the inventory: the pickups you are carrying, laid out along the top.',
    menu: 'Closes the inventory again.',
    dialog: null
  },
  pause: {
    gameplay: 'Freezes the player and every actor until the button is pressed again.',
    menu: 'Freezes the world, which a menu already does.',
    dialog: 'Freezes the world, which a conversation already does.',
    title: 'Freezes the title, blinking prompt and all, until pressed again.'
  },
  cancel: {
    gameplay: null,
    menu: 'Closes the inventory.',
    dialog: 'Ends the conversation.'
  },
  confirm: {
    gameplay: null,
    menu: 'Spends the highlighted item and leaves the inventory open.',
    dialog: 'Ends the conversation.',
    title: 'Begins the game.'
  }
};

const IGNORED = 'The engine ignores this action here.';

// The engine is in exactly one of these, and the row it reads its buttons from
// is the state it is in. Both of the frozen ones are reached from gameplay, so
// each says what opens it.
const STATE_LABELS = {
  gameplay: ['Walking around', 'The world is running.'],
  menu: ['In a menu', 'Opened by the Item action. The world freezes; the D-pad moves the highlight.'],
  dialog: [
    'Reading dialogue',
    'Opened by interacting with an actor that is not a pickup. The world freezes.'
  ],
  title: ['On the title screen', 'What the cartridge boots into when a title map is set. Start always works here.']
};

// `INPUT_STATES` is the wire format and runs ahead of the engine: a state is
// added there first so the compiled table has a row for it, and appears here
// only once there is something in the ROM to bind. Showing a row for a state the
// engine cannot enter would be offering a control that does nothing — which is
// why the title row also depends on the project actually having a title screen.
const bindableStates = (project) =>
  INPUT_STATES.filter(
    (state) =>
      state in STATE_LABELS &&
      (state !== 'title' || (project.project.titleMap !== null && project.project.titleMap !== undefined))
  );

const BUTTON_LABELS = { A: 'A', B: 'B', SELECT: 'Select', START: 'Start' };

const KEY_SLOTS = [
  ['up', 'D-pad up'],
  ['down', 'D-pad down'],
  ['left', 'D-pad left'],
  ['right', 'D-pad right'],
  ['a', 'A button'],
  ['b', 'B button'],
  ['select', 'Select'],
  ['start', 'Start']
];

export function mount(container, app) {
  const state = { tab: 'actions', capturing: null };
  let settings = null;

  const tabsHost = el('div.tabs');
  const body = el('div.panel-body');

  function setBinding(stateName, button, action) {
    store.commit('Change button mapping', (project) => {
      project.input.states[stateName][button] = action;
    });
    render();
  }

  // --------------------------------------------------------- game actions

  function renderActions() {
    const input = store.project.input;

    fill(body,
      el(
        'p.hint',
        { style: { maxWidth: '640px', marginBottom: '16px' } },
        'The D-pad is not bindable: it walks the player, and moves the highlight in a menu. ' +
          'These four buttons are compiled into a table the engine looks up every frame — one row ' +
          'per game state — so changing one and rebuilding is all it takes.'
      ),
      ...bindableStates(store.project).map((stateName) => {
        const [label, note] = STATE_LABELS[stateName];
        return el(
          'div',
          { style: { marginBottom: '22px', maxWidth: '640px' } },
          el(
            'div.field-row',
            { style: { marginBottom: '8px' } },
            el('span.field-label', null, label),
            el('span.hint', { style: { color: 'var(--text-faint)' } }, `— ${note}`)
          ),
          el(
            'div',
            { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' } },
            BUTTONS.map((button) => {
              const action = input.states[stateName][button];
              // Start on the title is the engine's hardwired backstop: it
              // begins the game whatever this row says, so offering the select
              // would be offering a choice that is not one.
              const locked = stateName === 'title' && button === 'START';
              const detail = locked
                ? 'Always begins the game — the one binding that cannot be taken away.'
                : ENGINE_SUPPORT[action]?.[stateName] ?? null;
              return el(
                'div',
                {
                  style: {
                    background: 'var(--bg-2)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius)',
                    padding: '10px'
                  }
                },
                el(
                  'div',
                  {
                    style: {
                      fontFamily: 'var(--mono)',
                      fontWeight: '700',
                      color: 'var(--accent)',
                      marginBottom: '7px'
                    }
                  },
                  BUTTON_LABELS[button]
                ),
                el(
                  'select',
                  { disabled: locked, onchange: (event) => setBinding(stateName, button, event.target.value) },
                  ACTIONS.map((entry) =>
                    el('option', { value: entry.id, selected: entry.id === action }, entry.label)
                  )
                ),
                el(
                  'p.hint',
                  {
                    style: {
                      marginTop: '7px',
                      color: detail ? 'var(--text-faint)' : 'var(--accent)'
                    }
                  },
                  detail ?? IGNORED
                )
              );
            })
          )
        );
      })
    );
  }

  // -------------------------------------------------------- play bindings

  function renderKeys() {
    fill(body,
      el(
        'p.hint',
        { style: { maxWidth: '560px', marginBottom: '16px' } },
        'These control the emulator built into the Build panel. They are an app preference, ' +
          'not part of the project, so they follow you between games.'
      ),
      settings
        ? el(
            'div',
            { style: { maxWidth: '440px' } },
            ...KEY_SLOTS.map(([slot, label]) =>
              el(
                'div.field-row',
                { style: { marginBottom: '8px' } },
                el('span', { style: { flex: '1', color: 'var(--text-dim)' } }, label),
                el(
                  'button.btn',
                  {
                    class: state.capturing === slot ? 'active' : '',
                    style: { minWidth: '150px', fontFamily: 'var(--mono)' },
                    onclick: () => {
                      state.capturing = state.capturing === slot ? null : slot;
                      render();
                    }
                  },
                  state.capturing === slot ? 'Press a key…' : prettyKey(settings.playBindings[slot])
                )
              )
            ),
            el(
              'button.btn.btn-sm',
              {
                style: { marginTop: '10px' },
                onclick: async () => {
                  const result = await window.forge.settings.set({ playBindings: DEFAULT_BINDINGS });
                  if (result.ok) {
                    settings = result.value;
                    toast('Keyboard bindings reset', 'success');
                    render();
                  }
                }
              },
              'Reset to defaults'
            )
          )
        : el('p.hint', null, 'Loading settings…')
    );
  }

  const DEFAULT_BINDINGS = {
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    a: 'KeyX',
    b: 'KeyZ',
    select: 'ShiftRight',
    start: 'Enter'
  };

  const prettyKey = (code) =>
    (code ?? '')
      .replace(/^Key/, '')
      .replace(/^Digit/, '')
      .replace(/^Arrow/, '')
      .replace(/^Shift(Left|Right)$/, (_, side) => `${side} Shift`) || 'unset';

  async function onKeyDown(event) {
    if (!state.capturing) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      state.capturing = null;
      render();
      return;
    }
    const slot = state.capturing;
    const bindings = { ...settings.playBindings, [slot]: event.code };
    const result = await window.forge.settings.set({ playBindings: bindings });
    if (result.ok) settings = result.value;
    state.capturing = null;
    render();
  }
  window.addEventListener('keydown', onKeyDown, true);

  // ---------------------------------------------------------------- shell

  function renderTabs() {
    fill(tabsHost,
      ...[
        ['actions', 'Game actions'],
        ['keys', 'Play bindings']
      ].map(([id, label]) =>
        el(
          'button.tab',
          {
            class: state.tab === id ? 'active' : '',
            style: { flex: 'none', minWidth: '150px' },
            onclick: () => {
              state.tab = id;
              state.capturing = null;
              render();
            }
          },
          label
        )
      )
    );
  }

  function render() {
    renderTabs();
    if (state.tab === 'actions') renderActions();
    else renderKeys();
  }

  const root = el('div.forge', { style: { gridTemplateColumns: '1fr' } }, el('div.panel', { style: { borderRight: 'none' } }, tabsHost, body));

  container.append(root);
  render();
  window.forge.settings.get().then((result) => {
    if (result.ok) {
      settings = { playBindings: DEFAULT_BINDINGS, ...result.value };
      if (state.tab === 'keys') render();
    }
  });
  app.setMeta('Controller Forge');

  return {
    destroy() {
      window.removeEventListener('keydown', onKeyDown, true);
      app.setMeta('');
    },
    onProjectChange: render
  };
}
