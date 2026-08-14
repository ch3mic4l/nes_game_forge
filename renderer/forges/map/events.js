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
  CHOICE_LIMITS,
  EVENT_COMMANDS,
  EVENT_CONDITIONS,
  IMPLEMENTED_COMMANDS,
  MAX_BRANCH_DEPTH,
  RPG_LIMITS,
  enabledCommands
} from '../../../shared/project.js';

/** What a number field is worth as an engine byte: whole, and inside the range. */
const wholeNumber = (raw, max) => Math.max(0, Math.min(max, Math.round(Number(raw) || 0)));

/** Move an item within its list, or do nothing at the ends. */
function moveWithin(list, from, to) {
  if (to < 0 || to >= list.length) return false;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return true;
}

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
    else if (arg === 'branch') {
      out.cond = { type: 'none', arg: 0 };
      out.then = [];
      out.else = [];
    } else if (arg === 'choice') {
      // Yes and No, because that is the question nearly every first one is, and
      // a question that arrives already sayable is one you can try immediately.
      out.options = [
        { text: 'Yes', commands: [] },
        { text: 'No', commands: [] }
      ];
    } else out[arg] = 0;
  }
  return out;
};

/**
 * How a command reads in the list, so a page is legible without opening it.
 * A switched-off command says so wherever it is summarised — the alternative
 * is a list describing an event that is not the one the ROM will run.
 */
export function describeCommand(command, context = {}) {
  const text = describeEnabled(command, context);
  return command.off ? `(off) ${text}` : text;
}

/** What a nested list of commands reads as, inside a branch or an option. */
const describeList = (list, context) =>
  enabledCommands({ commands: list })
    .map((entry) => describeCommand(entry, context))
    .join('; ') || 'nothing';

function describeEnabled(command, context = {}) {
  const { actors = [], switches = [], variables = [], screens = [], party = [] } = context;
  const actorName = (id) => actors[id]?.name ?? `actor ${id}`;
  const switchName = (n) => switches[n]?.trim() || `switch ${n}`;
  const varName = (n) => variables[n]?.trim() || `variable ${n}`;
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
    case 'setVar':
      return `Set ${varName(command.variable)} to ${command.value ?? 0}`;
    case 'addVar':
      return `Add ${command.value ?? 0} to ${varName(command.variable)}`;
    case 'subVar':
      return `Subtract ${command.value ?? 0} from ${varName(command.variable)}`;
    case 'branch': {
      // Described down to its contents, because the event list's search runs
      // over exactly this text: a switch used only inside a branch has to be
      // findable by its name like any other.
      const otherwise = (command.else ?? []).length ? `, else ${describeList(command.else, context)}` : '';
      return `If ${describeCondition(command.cond, context)}: ${describeList(command.then, context)}${otherwise}`;
    }
    case 'choice':
      // Down to its contents for the same reason a branch is, and with the
      // labels as well: "Ask" on its own would find nothing and say less.
      return `Ask: ${(command.options ?? [])
        .map((option) => `“${option.text || '…'}” → ${describeList(option.commands, context)}`)
        .join('; ')}`;
    default:
      return EVENT_COMMANDS.find((entry) => entry.id === command.op)?.label ?? command.op;
  }
}

/** How a page's condition reads. */
export function describeCondition(cond, { actors = [], switches = [], variables = [] } = {}) {
  const entry = EVENT_CONDITIONS.find((item) => item.id === cond?.type) ?? EVENT_CONDITIONS[0];
  if (!entry.arg) return entry.label;
  if (entry.arg === 'switch') return `${entry.label}: ${switches[cond.arg]?.trim() || `switch ${cond.arg}`}`;
  // A comparison reads as a sentence about the thing being compared, so the
  // name goes where the word "Variable" is in the label: "Gems is at least 3".
  if (entry.arg === 'variable') {
    const name = variables[cond.arg]?.trim() || `variable ${cond.arg}`;
    return `${entry.label.replace('Variable', name)} ${cond.value ?? 0}`;
  }
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

  /** ↑ ↓ ⧉ ✕ over a list, which pages, commands and options all need. */
  function listTools(list, index, { what, onChange, canRemove = true, canDuplicate = true }) {
    const button = (label, title, disabled, act) =>
      el(
        'button.btn.btn-sm',
        {
          title,
          disabled,
          onclick: () => {
            act();
            onChange();
          }
        },
        label
      );
    return [
      button('↑', `Move this ${what} up`, index === 0, () => moveWithin(list, index, index - 1)),
      button('↓', `Move this ${what} down`, index === list.length - 1, () => moveWithin(list, index, index + 1)),
      button('⧉', `Duplicate this ${what}`, !canDuplicate, () =>
        list.splice(index + 1, 0, structuredClone(list[index]))
      ),
      button('✕', `Remove this ${what}`, !canRemove, () => list.splice(index, 1))
    ];
  }

  function pageCard(page, index) {
    // Order is the whole semantics of an event — the first passing page wins —
    // so a page that will never be reached, or one left with nothing to do, is
    // worth saying out loud rather than leaving to be discovered in the ROM.
    const dead = page.commands.length > 0 && enabledCommands(page).length === 0;
    const unreachable = draft.pages.some(
      (earlier, position) =>
        position < index && earlier.cond.type === 'none' && enabledCommands(earlier).length > 0
    );
    return el(
      'div',
      {
        style: {
          background: 'var(--bg-2)',
          border: `1px solid ${dead ? 'var(--accent)' : 'var(--line)'}`,
          borderRadius: 'var(--radius)',
          padding: '10px',
          marginBottom: '10px'
        }
      },
      el(
        'div.field-row',
        { style: { marginBottom: '8px' } },
        el('span.field-label', { style: { flex: 'none' } }, `Page ${index + 1}`),
        conditionControls(page.cond, rerender),
        listTools(draft.pages, index, {
          what: 'page',
          onChange: rerender,
          canRemove: draft.pages.length > 1
        })
      ),
      dead
        ? el(
            'p.hint',
            { style: { color: 'var(--accent)', margin: '0 0 6px' } },
            'Nothing here would run, so this page is not built — everything is switched off, or ' +
              'the only thing left is a branch with nothing live inside it. A page that matches ' +
              'and does nothing would swallow every page below it.'
          )
        : null,
      unreachable
        ? el(
            'p.hint',
            { style: { color: 'var(--accent)', margin: '0 0 6px' } },
            'An “Always” page above this one runs first, so this page is never reached.'
          )
        : null,
      page.commands.length
        ? page.commands.map((command, position) => commandRow(page.commands, command, position))
        : el('p.hint', null, 'This page does nothing yet.'),
      addCommand(page.commands, 0)
    );
  }

  /**
   * The "+ Add a command…" control for one list — a page's, or one side of a
   * branch. `depth` is what stops a branch being offered inside a branch inside
   * a branch forever. Nothing breaks past it — neither the schema nor the engine
   * has a limit — so this is only about what stays readable in a modal, and a
   * project that arrives already nested deeper keeps every level.
   */
  function addCommand(list, depth) {
    return el(
      'div.field-row',
      { style: { marginTop: '6px' } },
      el(
        'select',
        {
          value: '',
          onchange: (fired) => {
            if (!fired.target.value) return;
            list.push(defaultCommand(fired.target.value));
            rerender();
          }
        },
        el('option', { value: '' }, '+ Add a command…'),
        offeredCommands(context)
          .filter((entry) => !entry.nests || depth < MAX_BRANCH_DEPTH)
          .map((entry) => el('option', { value: entry.id }, entry.label))
      )
    );
  }

  /**
   * The controls for one condition — a page's or a branch's, which are the same
   * object and so get the same editor.
   */
  function conditionArg(cond, condition) {
    if (condition.arg === 'switch') return switchSelect(cond.arg, (value) => (cond.arg = value));
    // A variable is compared against a number, so it is the one condition that
    // needs the header's second byte as well.
    if (condition.arg === 'variable') {
      return [
        variableSelect(cond.arg, (value) => (cond.arg = value)),
        valueInput(cond.value ?? 0, (value) => (cond.value = value))
      ];
    }
    return el(
      'select',
      {
        style: { flex: '1' },
        onchange: (fired) => (cond.arg = Number(fired.target.value))
      },
      context.actors.map((actor, id) => el('option', { value: id, selected: id === cond.arg }, actor.name))
    );
  }

  /** The condition picker plus whatever that condition takes as an argument. */
  function conditionControls(cond, onChange) {
    const condition = EVENT_CONDITIONS.find((entry) => entry.id === cond.type) ?? EVENT_CONDITIONS[0];
    return [
      el(
        'select',
        {
          style: { flex: '1' },
          onchange: (fired) => {
            // A fresh condition rather than a retyped one: the old argument
            // indexes a different list, and its value byte may not exist at all.
            cond.type = fired.target.value;
            cond.arg = 0;
            delete cond.value;
            onChange();
          }
        },
        EVENT_CONDITIONS.map((entry) =>
          el('option', { value: entry.id, selected: entry.id === condition.id }, entry.label)
        )
      ),
      condition.arg ? conditionArg(cond, condition) : null
    ];
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

  function variableSelect(value, onChange) {
    return el(
      'select',
      { style: { flex: '1' }, onchange: (fired) => onChange(Number(fired.target.value)) },
      Array.from({ length: RPG_LIMITS.variables }, (_, n) =>
        el('option', { value: n, selected: n === value }, context.variables?.[n]?.trim() || `Variable ${n}`)
      )
    );
  }

  /**
   * The 0-255 a variable is set to, counted by, or compared against.
   *
   * Rounded here, not left to the schema: a number field will hand back 1.5 for
   * the asking, the compiler truncates it to 1 and the schema rounds it to 2, so
   * the same project would build differently before and after being reopened.
   */
  function valueInput(value, onChange) {
    return el('input', {
      type: 'number',
      min: 0,
      max: 255,
      value,
      title: 'A number from 0 to 255',
      style: { width: '70px', flex: 'none' },
      onchange: (fired) => onChange(wholeNumber(fired.target.value, 255))
    });
  }

  function commandRow(list, command, position, depth = 0) {
    // Switched off is not deleted: it is how you find out whether a line was
    // the problem without losing what it said. The row stays legible and
    // editable, so what comes back is what went away.
    const toggle = el(
      'label.check',
      { title: command.off ? 'Switched off — not built' : 'Switch this command off without deleting it' },
      el('input', {
        type: 'checkbox',
        checked: !command.off,
        onchange: (fired) => {
          if (fired.target.checked) delete command.off;
          else command.off = true;
          rerender();
        }
      })
    );
    const tools = [toggle, ...listTools(list, position, { what: 'command', onChange: rerender })];
    const dim = command.off ? { opacity: '0.55' } : null;

    // The one command that holds commands. Switching it off takes both sides out
    // with it, which is what the indentation is saying.
    if (command.op === 'branch') {
      // Each side is named in the DOM as well as on screen: which list a control
      // belongs to is the whole question a branch asks of the editor, and the
      // smoke test has no other way to ask it.
      const side = (label, commands) =>
        el(
          'div',
          {
            dataset: { branch: label.toLowerCase() },
            style: { borderLeft: '2px solid var(--line)', paddingLeft: '10px', marginLeft: '6px' }
          },
          el('div.field-row', { style: { marginBottom: '4px' } }, el('span.field-label', null, label)),
          commands.map((entry, index) => commandRow(commands, entry, index, depth + 1)),
          addCommand(commands, depth + 1)
        );
      return el(
        'div',
        {
          style: {
            marginBottom: '8px',
            padding: '8px',
            background: 'var(--bg-1)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius)',
            ...dim
          }
        },
        el(
          'div.field-row',
          { style: { marginBottom: '6px' } },
          el('span', { style: { flex: 'none', color: 'var(--text-dim)' } }, 'If'),
          conditionControls(command.cond, rerender),
          tools
        ),
        side('Then', command.then),
        side('Else', command.else)
      );
    }

    // The other command that holds commands, and the only one whose lists the
    // player picks between rather than a condition. Each option is one row of
    // the message box, which is why there can be four of them and why a label
    // is as wide as a row of text.
    if (command.op === 'choice') {
      const options = command.options ?? [];
      const full = options.length >= CHOICE_LIMITS.options;
      return el(
        'div',
        {
          style: {
            marginBottom: '8px',
            padding: '8px',
            background: 'var(--bg-1)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius)',
            ...dim
          }
        },
        el(
          'div.field-row',
          { style: { marginBottom: '6px' } },
          el('span', { style: { flex: 'none', color: 'var(--text-dim)' } }, 'Ask'),
          el(
            'span.hint',
            { style: { flex: '1', margin: '0' } },
            'and run whichever answer the player picks'
          ),
          tools
        ),
        options.map((option, index) =>
          el(
            'div',
            {
              // Named in the DOM the way a branch's sides are, and for the same
              // reason: which list a control belongs to is the whole question,
              // and the smoke test has no other way to ask it.
              dataset: { option: String(index) },
              style: { borderLeft: '2px solid var(--line)', paddingLeft: '10px', marginLeft: '6px' }
            },
            el(
              'div.field-row',
              { style: { marginBottom: '4px' } },
              el('input', {
                type: 'text',
                value: option.text ?? '',
                maxLength: CHOICE_LIMITS.label,
                placeholder: `Answer ${index + 1}`,
                title: `One row of the message box: up to ${CHOICE_LIMITS.label} characters`,
                onchange: (fired) => {
                  option.text = fired.target.value;
                  rerender();
                }
              }),
              listTools(options, index, {
                what: 'answer',
                onChange: rerender,
                canRemove: options.length > 1,
                canDuplicate: !full
              })
            ),
            option.commands.map((entry, position) =>
              commandRow(option.commands, entry, position, depth + 1)
            ),
            addCommand(option.commands, depth + 1)
          )
        ),
        // An answer with no label is a legitimate thing to be holding while you
        // write one, and the engine draws its row blank rather than breaking —
        // but it reaches the ROM as a row the player can put the cursor on and
        // nothing to tell them what it means, so it is worth saying out loud.
        options.some((option) => !(option.text ?? '').trim())
          ? el(
              'p.hint',
              { style: { color: 'var(--accent)', margin: '6px 0 0' } },
              'An answer with no label draws an empty row. The player can still pick it — they ' +
                'just have nothing to go on.'
            )
          : null,
        full
          ? el(
              'p.hint',
              { style: { margin: '6px 0 0' } },
              `The message box has ${CHOICE_LIMITS.options} rows of text, so a question can offer ` +
                `${CHOICE_LIMITS.options} answers.`
            )
          : el(
              'button.btn.btn-sm',
              {
                style: { marginTop: '6px' },
                onclick: () => {
                  options.push({ text: '', commands: [] });
                  rerender();
                }
              },
              '+ Answer'
            )
      );
    }

    if (command.op === 'say') {
      return el(
        'div',
        { style: { marginBottom: '6px', ...dim } },
        el(
          'div.field-row',
          null,
          el('span', { style: { flex: '1', color: 'var(--text-dim)' } }, 'Show text'),
          tools
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
    } else if (command.op === 'setVar' || command.op === 'addVar' || command.op === 'subVar') {
      controls.push(
        variableSelect(command.variable, (value) => (command.variable = value)),
        valueInput(command.value ?? 0, (value) => (command.value = value))
      );
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
        // Whole numbers for the same reason valueInput rounds: these become
        // single bytes, and the compiler and the schema round differently.
        el('input', {
          type: 'number',
          min: 0,
          max: 240,
          value: command.x,
          title: 'Landing x',
          style: { width: '70px' },
          onchange: (fired) => (command.x = wholeNumber(fired.target.value, 240))
        }),
        el('input', {
          type: 'number',
          min: 0,
          max: 224,
          value: command.y,
          title: 'Landing y',
          style: { width: '70px' },
          onchange: (fired) => (command.y = wholeNumber(fired.target.value, 224))
        })
      );
    }

    return el(
      'div.field-row',
      { style: { marginBottom: '6px', ...dim } },
      el(
        'span',
        { style: { flex: 'none', minWidth: '96px', color: 'var(--text-dim)' } },
        EVENT_COMMANDS.find((entry) => entry.id === command.op)?.label ?? command.op
      ),
      controls,
      tools
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
        // Only the genuinely empty page is dropped — one with no commands at
        // all, which would compile to a page that matches and does nothing and
        // so swallow every page below it.
        //
        // A page whose commands are merely switched off is kept, and so is an
        // event whose every command is. That is the whole promise of the
        // toggle: switching a line off is how you find out whether it was the
        // problem without losing what it said, so Save must not be the thing
        // that throws it away. `compiledPages` leaves them out of the ROM, and
        // the plain dialogue underneath comes back until they are switched on.
        onClick: () => {
          const pages = draft.pages.filter((page) => page.commands.length);
          return pages.length ? { pages } : null;
        }
      }
    ]
  });
}

/** Name the 64 switches, so an event reads as English rather than as numbers. */
export const editSwitches = (names, onSave) =>
  editNameList(names, onSave, {
    title: 'Switches',
    count: RPG_LIMITS.switches,
    hint: 'A name is for you — the engine only sees 64 bits.'
  });

/** The same for the variables, which are counters rather than flags. */
export const editVariables = (names, onSave) =>
  editNameList(names, onSave, {
    title: 'Variables',
    count: RPG_LIMITS.variables,
    hint:
      `A name is for you — the engine only sees ${RPG_LIMITS.variables} bytes. Each holds 0 to 255, ` +
      'and adding or subtracting stops at those ends rather than wrapping round.'
  });

function editNameList(names, onSave, { title, count, hint }) {
  const draft = [...names];
  const body = el('div', { style: { minWidth: '380px' } });

  const rerender = () => {
    // Only named entries and the next free one are listed: 64 rows of "Switch
    // 37" would bury the handful that are actually in use.
    const shown = Math.min(count, Math.max(1, lastNamed(draft) + 2));
    fill(body,
      el('p.hint', { style: { marginBottom: '10px' } }, hint),
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
    title,
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
