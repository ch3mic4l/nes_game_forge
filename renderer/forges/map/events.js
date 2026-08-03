// The event editor — what a placed actor does when you talk to it.
//
// An event is a list of pages and the engine runs the first whose condition
// holds, which is the whole trick behind "a chest that says 'a gem!' once and
// 'it's empty.' after": page one is guarded by a switch the page itself turns
// on. The editor is therefore a list of pages in priority order, each with one
// condition and a list of commands, and it says out loud which page will run
// with the switches as they are now.
//
// Only commands the engine implements are offered — and `join` only when the
// project has a party for anyone to join, because in an action game the command
// would compile to an opcode the built engine stops on.

import { el, fill, showModal } from '../../ui.js';
import { BOX_COLS, BOX_ROWS, wrapText } from '../../../shared/font.js';
import {
  EVENT_COMMANDS,
  EVENT_CONDITIONS,
  IMPLEMENTED_COMMANDS,
  RPG_LIMITS
} from '../../../shared/project.js';

const offeredCommands = (context) =>
  EVENT_COMMANDS.filter(
    (entry) => IMPLEMENTED_COMMANDS.has(entry.id) && (entry.id !== 'join' || context.party?.length)
  );

const defaultCommand = (op) => {
  const entry = EVENT_COMMANDS.find((command) => command.id === op);
  const out = { op };
  for (const arg of entry.args) {
    if (arg === 'text') out.text = '';
    else if (arg === 'x') out.x = 112;
    else if (arg === 'y') out.y = 112;
    else out[arg] = 0;
  }
  return out;
};

/** How a command reads in the list, so a page is legible without opening it. */
export function describeCommand(command, { actors = [], switches = [], screens = [], party = [] } = {}) {
  const actorName = (id) => actors[id]?.name ?? `actor ${id}`;
  const switchName = (n) => switches[n]?.trim() || `switch ${n}`;
  switch (command.op) {
    case 'say':
      return `Say “${(command.text ?? '').trim().slice(0, 40) || '…'}”`;
    case 'give':
      return `Give ${actorName(command.actor)}`;
    case 'take':
      return `Take ${actorName(command.actor)}`;
    case 'setSwitch':
      return `Turn on ${switchName(command.switch)}`;
    case 'clearSwitch':
      return `Turn off ${switchName(command.switch)}`;
    case 'warp':
      return `Warp to ${screens[command.screen] ?? `screen ${command.screen}`} at ${command.x},${command.y}`;
    case 'join':
      return `${party[command.member]?.name ?? `Member ${command.member}`} joins the party`;
    default:
      return EVENT_COMMANDS.find((entry) => entry.id === command.op)?.label ?? command.op;
  }
}

/** How a page's condition reads. */
export function describeCondition(cond, { actors = [], switches = [] } = {}) {
  const entry = EVENT_CONDITIONS.find((item) => item.id === cond?.type) ?? EVENT_CONDITIONS[0];
  if (!entry.arg) return entry.label;
  if (entry.arg === 'switch') return `${entry.label}: ${switches[cond.arg]?.trim() || `switch ${cond.arg}`}`;
  return `${entry.label}: ${actors[cond.arg]?.name ?? `actor ${cond.arg}`}`;
}

/**
 * Edit an event. Resolves to the new event (or null to clear it), or undefined
 * if the editor was dismissed — which is why the caller must check for
 * `undefined` rather than falsiness before writing anything back.
 */
export function editEvent(event, context) {
  // A working copy: nothing reaches the project until Save, so Escape really
  // does abandon the edit rather than leaving half of it behind.
  const draft = structuredClone(event ?? { pages: [] });
  if (!draft.pages.length) draft.pages.push({ cond: { type: 'none', arg: 0 }, commands: [] });

  const body = el('div', { style: { minWidth: '520px' } });

  const rerender = () => {
    fill(body,
      el(
        'p.hint',
        { style: { marginBottom: '12px' } },
        'The engine runs the first page whose condition holds, top to bottom. ' +
          'Guard a page with a switch it turns on itself and it happens once.'
      ),
      draft.pages.map((page, index) => pageCard(page, index)),
      el(
        'button.btn.btn-sm',
        {
          style: { marginTop: '6px' },
          onclick: () => {
            draft.pages.push({ cond: { type: 'none', arg: 0 }, commands: [] });
            rerender();
          }
        },
        '+ Page'
      )
    );
  };

  function pageCard(page, index) {
    const condition = EVENT_CONDITIONS.find((entry) => entry.id === page.cond.type) ?? EVENT_CONDITIONS[0];
    return el(
      'div',
      {
        style: {
          background: 'var(--bg-2)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius)',
          padding: '10px',
          marginBottom: '10px'
        }
      },
      el(
        'div.field-row',
        { style: { marginBottom: '8px' } },
        el('span.field-label', { style: { flex: 'none' } }, `Page ${index + 1}`),
        el(
          'select',
          {
            style: { flex: '1' },
            onchange: (fired) => {
              page.cond = { type: fired.target.value, arg: 0 };
              rerender();
            }
          },
          EVENT_CONDITIONS.map((entry) =>
            el('option', { value: entry.id, selected: entry.id === condition.id }, entry.label)
          )
        ),
        condition.arg ? conditionArg(page, condition) : null,
        el(
          'button.btn.btn-sm',
          {
            title: 'Remove this page',
            disabled: draft.pages.length === 1,
            onclick: () => {
              draft.pages.splice(index, 1);
              rerender();
            }
          },
          '✕'
        )
      ),
      page.commands.length
        ? page.commands.map((command, position) => commandRow(page, command, position))
        : el('p.hint', null, 'This page does nothing yet.'),
      el(
        'div.field-row',
        { style: { marginTop: '6px' } },
        el(
          'select',
          {
            value: '',
            onchange: (fired) => {
              if (!fired.target.value) return;
              page.commands.push(defaultCommand(fired.target.value));
              rerender();
            }
          },
          el('option', { value: '' }, '+ Add a command…'),
          offeredCommands(context).map((entry) => el('option', { value: entry.id }, entry.label))
        )
      )
    );
  }

  function conditionArg(page, condition) {
    if (condition.arg === 'switch') return switchSelect(page.cond.arg, (value) => (page.cond.arg = value));
    return el(
      'select',
      {
        style: { flex: '1' },
        onchange: (fired) => (page.cond.arg = Number(fired.target.value))
      },
      context.actors.map((actor, id) => el('option', { value: id, selected: id === page.cond.arg }, actor.name))
    );
  }

  function switchSelect(value, onChange) {
    return el(
      'select',
      { style: { flex: '1' }, onchange: (fired) => onChange(Number(fired.target.value)) },
      Array.from({ length: RPG_LIMITS.switches }, (_, n) =>
        el('option', { value: n, selected: n === value }, context.switches[n]?.trim() || `Switch ${n}`)
      )
    );
  }

  function commandRow(page, command, position) {
    const remove = el(
      'button.btn.btn-sm',
      {
        title: 'Remove',
        onclick: () => {
          page.commands.splice(position, 1);
          rerender();
        }
      },
      '✕'
    );

    if (command.op === 'say') {
      return el(
        'div',
        { style: { marginBottom: '6px' } },
        el(
          'div.field-row',
          null,
          el('span', { style: { flex: '1', color: 'var(--text-dim)' } }, 'Show text'),
          remove
        ),
        el('textarea', {
          rows: 3,
          value: command.text ?? '',
          style: { resize: 'vertical', fontFamily: 'var(--mono)', lineHeight: '1.4' },
          onchange: (fired) => {
            command.text = fired.target.value;
            rerender();
          }
        }),
        el(
          'p.hint',
          null,
          `${wrapText(command.text ?? '', BOX_COLS, BOX_ROWS).length} page(s) of ${BOX_ROWS} lines.`
        )
      );
    }

    const controls = [];
    if (command.op === 'give' || command.op === 'take') {
      controls.push(
        el(
          'select',
          { style: { flex: '1' }, onchange: (fired) => (command.actor = Number(fired.target.value)) },
          context.actors.map((actor, id) =>
            el('option', { value: id, selected: id === command.actor }, actor.name)
          )
        )
      );
    } else if (command.op === 'setSwitch' || command.op === 'clearSwitch') {
      controls.push(switchSelect(command.switch, (value) => (command.switch = value)));
    } else if (command.op === 'join') {
      controls.push(
        el(
          'select',
          { style: { flex: '1' }, onchange: (fired) => (command.member = Number(fired.target.value)) },
          (context.party ?? []).map((member, id) =>
            el('option', { value: id, selected: id === command.member }, member.name)
          )
        )
      );
    } else if (command.op === 'warp') {
      controls.push(
        el(
          'select',
          { style: { flex: '1' }, onchange: (fired) => (command.screen = Number(fired.target.value)) },
          context.screens.map((label, index) =>
            el('option', { value: index, selected: index === command.screen }, `→ ${label}`)
          )
        ),
        el('input', {
          type: 'number',
          min: 0,
          max: 240,
          value: command.x,
          title: 'Landing x',
          style: { width: '70px' },
          onchange: (fired) => (command.x = Number(fired.target.value))
        }),
        el('input', {
          type: 'number',
          min: 0,
          max: 224,
          value: command.y,
          title: 'Landing y',
          style: { width: '70px' },
          onchange: (fired) => (command.y = Number(fired.target.value))
        })
      );
    }

    return el(
      'div.field-row',
      { style: { marginBottom: '6px' } },
      el(
        'span',
        { style: { flex: 'none', minWidth: '96px', color: 'var(--text-dim)' } },
        EVENT_COMMANDS.find((entry) => entry.id === command.op)?.label ?? command.op
      ),
      controls,
      remove
    );
  }

  rerender();

  return showModal({
    title: 'Event',
    body,
    width: 560,
    actions: [
      { label: 'Cancel', value: undefined },
      { label: 'Clear event', value: null },
      {
        label: 'Save',
        primary: true,
        // A page with no commands compiles to a page that does nothing, which
        // would swallow every page below it. Dropping them here means the ROM
        // matches what the editor showed.
        onClick: () => {
          const pages = draft.pages.filter((page) => page.commands.length);
          return pages.length ? { pages } : null;
        }
      }
    ]
  });
}

/** Name the 64 switches, so an event reads as English rather than as numbers. */
export function editSwitches(names, onSave) {
  const draft = [...names];
  const body = el('div', { style: { minWidth: '380px' } });

  const rerender = () => {
    // Only named switches and the next free one are listed: 64 rows of "Switch
    // 37" would bury the handful that are actually in use.
    const shown = Math.min(RPG_LIMITS.switches, Math.max(1, lastNamed(draft) + 2));
    fill(body,
      el('p.hint', { style: { marginBottom: '10px' } }, 'A name is for you — the engine only sees 64 bits.'),
      Array.from({ length: shown }, (_, n) =>
        el(
          'div.field-row',
          { style: { marginBottom: '6px' } },
          el('span', { style: { flex: 'none', minWidth: '70px', fontFamily: 'var(--mono)' } }, `#${n}`),
          el('input', {
            type: 'text',
            value: draft[n] ?? '',
            placeholder: 'unnamed',
            onchange: (fired) => {
              draft[n] = fired.target.value.trim();
              rerender();
            }
          })
        )
      )
    );
  };
  rerender();

  return showModal({
    title: 'Switches',
    body,
    actions: [
      { label: 'Cancel', value: false },
      {
        label: 'Save',
        primary: true,
        onClick: () => {
          onSave(draft.map((name) => name ?? ''));
          return true;
        }
      }
    ]
  });
}

const lastNamed = (names) => {
  for (let n = names.length - 1; n >= 0; n--) if (names[n]?.trim()) return n;
  return -1;
};
