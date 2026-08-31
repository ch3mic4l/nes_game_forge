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
  FADE_DIRECTIONS,
  IMPLEMENTED_COMMANDS,
  LIMITS,
  MAX_BRANCH_DEPTH,
  MOVE_DIRECTIONS,
  MOVE_TARGETS,
  VISIBLE_STATES,
  RPG_LIMITS,
  ROUTE_LEG_OPS,
  itemMissing,
  itemPickerOptions,
  compiledPages,
  damageAmount,
  enabledCommands,
  commonEventId,
  isMonsterActor,
  routeLegs,
  legWithWho
} from '../../../shared/project.js';
import { MetatileRenderer, SCREEN_PX_W, SCREEN_PX_H } from './render.js';

/** What a number field is worth as an engine byte: whole, and inside the range. */
const wholeNumber = (raw, max) => Math.max(0, Math.min(max, Math.round(Number(raw) || 0)));

// The route preview's own fixed, modest zoom -- not the Forge's main-stage
// fitZoom()/observeSize(), which exist to keep the pixel-exact editing
// canvas correctly sized against the window. This is a small, non-resizable
// reference thumbnail inside a dialog, closer in spirit to
// MetatileRenderer's own precomputed per-metatile canvases than to the
// Forge's live stage.
const ROUTE_PREVIEW_ZOOM = 0.5;

// A Move/Turn leg's own DIR_* id as a unit displacement -- the same mapping
// MOVE_DIRECTIONS' own engine-order encodes, spelled out here because the
// preview needs the vector, not the wire index.
const ROUTE_LEG_DELTA = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };

/**
 * The route preview's pure model: given a route command and optional
 * placement context (`{ screen, x, y, ... }`, or undefined for a common
 * event), what caption (if any, when nothing can be traced) and what trace
 * instructions to draw. No DOM, no canvas — see design-routes.md §10.
 *
 * routeLegs is applied here too, even though the editor's own row rendering
 * already canonicalizes `command.legs` before this can ever be called on a
 * rendered row (commandRow's own route branch) — this is deliberate,
 * redundant defense in depth, the same belt-and-suspenders precedent
 * describeEnabled's own route case already sets, so this function stays
 * correct in isolation regardless of what a future caller guarantees about
 * its input.
 */
export function routeTrace(command, place) {
  if (!place) {
    return {
      caption:
        "This is a common event — it can be called from anywhere, so there's no single screen or " +
        'starting position to preview from.',
      instructions: []
    };
  }
  if (command.who === 'player') {
    return {
      caption:
        "This route moves the player, not this actor — the Map Forge doesn't know where the player " +
        "will be standing, so there's nothing accurate to draw.",
      instructions: []
    };
  }
  let x = place.x;
  let y = place.y;
  const instructions = [];
  for (const leg of routeLegs(command.legs)) {
    if (leg.off === true) continue;
    if (leg.op === 'move') {
      const [dx, dy] = ROUTE_LEG_DELTA[leg.dir] ?? ROUTE_LEG_DELTA[MOVE_DIRECTIONS[0].id];
      if (leg.dist > 0) {
        const to = { x: x + dx * leg.dist, y: y + dy * leg.dist };
        instructions.push({ kind: 'segment', from: { x, y }, to });
        x = to.x;
        y = to.y;
      } else {
        // A zero-length segment paints no visible pixel on a canvas -- an
        // explicit point instruction is what keeps a real, live, authored
        // "stand here for a beat" leg from reading as though it were never
        // authored at all.
        instructions.push({ kind: 'point', at: { x, y } });
      }
    } else if (leg.op === 'turn') {
      instructions.push({ kind: 'facing', at: { x, y }, dir: leg.dir });
    } else if (leg.op === 'wait') {
      instructions.push({ kind: 'pause', at: { x, y }, frames: leg.frames });
    }
  }
  return { caption: null, instructions };
}

/**
 * Turns routeTrace's own instructions into canvas calls -- a thin, dumb draw
 * step over the pure model above. Exported so a test can pin the arrowhead's
 * own orientation and the pause glyph's own frame-count text against a fake
 * 2d-context object (this file has no DOM available under node:test) without
 * needing a real canvas or the modal around it.
 */
export function drawRouteTrace(context2d, instructions, zoom) {
  context2d.strokeStyle = '#ffd740';
  context2d.fillStyle = '#ffd740';
  context2d.lineWidth = 2;
  for (const instruction of instructions) {
    if (instruction.kind === 'segment') {
      context2d.beginPath();
      context2d.moveTo(instruction.from.x * zoom, instruction.from.y * zoom);
      context2d.lineTo(instruction.to.x * zoom, instruction.to.y * zoom);
      context2d.stroke();
    } else if (instruction.kind === 'point') {
      context2d.beginPath();
      context2d.arc(instruction.at.x * zoom, instruction.at.y * zoom, 3, 0, Math.PI * 2);
      context2d.fill();
    } else if (instruction.kind === 'facing') {
      // A directional arrowhead, oriented by dir -- undirected would say
      // "the actor turns here" without saying which way, the one thing a
      // Turn leg actually authors.
      const [dx, dy] = ROUTE_LEG_DELTA[instruction.dir] ?? ROUTE_LEG_DELTA[MOVE_DIRECTIONS[0].id];
      const cx = instruction.at.x * zoom;
      const cy = instruction.at.y * zoom;
      const len = 7;
      const perp = { x: -dy, y: dx };
      const tip = { x: cx + dx * len, y: cy + dy * len };
      const backLeft = { x: cx - dx * len * 0.4 + perp.x * len * 0.6, y: cy - dy * len * 0.4 + perp.y * len * 0.6 };
      const backRight = { x: cx - dx * len * 0.4 - perp.x * len * 0.6, y: cy - dy * len * 0.4 - perp.y * len * 0.6 };
      context2d.beginPath();
      context2d.moveTo(tip.x, tip.y);
      context2d.lineTo(backLeft.x, backLeft.y);
      context2d.lineTo(backRight.x, backRight.y);
      context2d.closePath();
      context2d.fill();
    } else if (instruction.kind === 'pause') {
      // The circle marks the position; the frame count is what an author
      // actually authored, so it is drawn too, not just implied by a marker
      // indistinguishable from any other Wait.
      context2d.beginPath();
      context2d.arc(instruction.at.x * zoom, instruction.at.y * zoom, 5, 0, Math.PI * 2);
      context2d.stroke();
      context2d.font = '8px sans-serif';
      context2d.textAlign = 'center';
      context2d.textBaseline = 'bottom';
      context2d.fillText(String(instruction.frames), instruction.at.x * zoom, instruction.at.y * zoom - 6);
    }
  }
}

/** Move an item within its list, or do nothing at the ends. */
function moveWithin(list, from, to) {
  if (to < 0 || to >= list.length) return false;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return true;
}

const offeredCommands = (context) =>
  EVENT_COMMANDS.filter(
    (entry) =>
      IMPLEMENTED_COMMANDS.has(entry.id) &&
      // Only an RPG has a party, and only an RPG has a battle bank to call
      // into — the same reason 'join' already hides here, extended to
      // 'battle' rather than given a second condition to ask.
      ((entry.id !== 'join' && entry.id !== 'battle') || context.party?.length) &&
      // Nothing to call until at least one common event exists — offering it
      // sooner would be exactly the "looks functional, does nothing" case
      // this codebase refuses to ship, one authoring step earlier.
      (entry.id !== 'call' || context.commonEvents?.length) &&
      // Only a save-capable cartridge has anywhere to write a save.
      (entry.id !== 'save' || context.canSave)
  );

export const defaultCommand = (op, context = {}) => {
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
    } else if (arg === 'route') {
      out.who = MOVE_TARGETS[0].id;
      out.legs = [];
    } else if (arg === 'event') {
      // A common event's *id*, not its row in the list — ids survive a
      // deletion elsewhere in the list undisturbed, positions do not. 0 would
      // be a stored preference for whichever common event happens to hold
      // that id, which the offered list may not even contain.
      out.event = context.commonEvents?.[0]?.id ?? 0;
    } else if (arg === 'song') {
      // Silence, the same default a brand-new map's own Music field has —
      // not song 0, which nothing here chose.
      out.song = null;
    } else if (arg === 'who') out.who = MOVE_TARGETS[0].id;
    else if (arg === 'dir') out.dir = MOVE_DIRECTIONS[0].id;
    // Hidden -- the verb an author reaches for this command to get, the
    // identical "the author is looking at the feature they added" reasoning
    // 'who' above gets for defaulting to 'self'.
    else if (arg === 'state') out.state = VISIBLE_STATES[0].id;
    // '(does nothing)' -- unlike 'who'/'dir'/'state' above, Fade's own index
    // 0 is a genuine no-op rather than a harmless default: both of Fade's
    // real directions are highly visible, so neither is safe for a freshly
    // placed, not-yet-configured command the way DIR_DOWN or Hidden are.
    else if (arg === 'fadeDir') out.dir = FADE_DIRECTIONS[0].id;
    // One metatile. Zero is the honest default for a number nobody has chosen
    // yet everywhere else in this editor, but a Move of zero is the one command
    // that would compile to nothing happening -- so a new one arrives having
    // already picked the smallest distance that reads as a step.
    else if (arg === 'dist') out.dist = 16;
    // Half a second at 60 fps, for the identical reason 'dist' above does not
    // arrive at 0: a Wait of 0 does nothing and the honest zero-default would
    // make a freshly-added one a no-op.
    else if (arg === 'frames') out.frames = 30;
    else if (arg === 'monsters') {
      // Empty, not a formation of one nothing chose — the picker below warns
      // about an empty formation rather than this reaching for a monster.
      out.monsters = [];
    }
    // `null` (Missing item), not item 0 — the same reason 'song' above
    // defaults to Silence rather than song 0: nothing here has chosen an
    // item, and falling into the generic `out[arg] = 0` below would hand a
    // brand-new Give/Take a real, plausible-looking reference nobody picked,
    // the same defect `firstPickup` (templates.js) used to have.
    else if (arg === 'item') out.item = null;
    else out[arg] = 0;
  }
  return out;
};

/**
 * Whether a `call` command's target is not among the common events on offer
 * — deleted, or never valid to begin with. Pulled out of the select that
 * uses it so the "does this reference resolve" question has one testable
 * answer, the same reason `commonEventId` itself is not inlined everywhere
 * it is asked.
 */
export function callTargetMissing(commonEvents, eventId) {
  return !(commonEvents ?? []).some((entry) => entry.id === eventId);
}

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
  const {
    actors = [],
    items = [],
    switches = [],
    variables = [],
    screens = [],
    party = [],
    commonEvents = [],
    songs = []
  } = context;
  const itemName = (id) => items[id]?.name ?? `item ${id}`;
  const actorName = (id) => actors[id]?.name ?? `actor ${id}`;
  const switchName = (n) => switches[n]?.trim() || `switch ${n}`;
  const varName = (n) => variables[n]?.trim() || `variable ${n}`;
  const commonEventName = (id) =>
    commonEvents.find((entry) => entry.id === id)?.name?.trim() || `common event ${id}`;
  const songName = (id) => songs[id]?.name?.trim() || `song ${id}`;
  switch (command.op) {
    case 'say':
      return `Say “${(command.text ?? '').trim().slice(0, 40) || '…'}”`;
    case 'give':
      return itemMissing(items, command.item) ? 'Give (missing item)' : `Give ${itemName(command.item)}`;
    case 'take':
      return itemMissing(items, command.item) ? 'Take (missing item)' : `Take ${itemName(command.item)}`;
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
    case 'call':
      return `Run ${commonEventName(command.event)}`;
    case 'music':
      return command.song === null || command.song === undefined ? 'Silence' : `Play ${songName(command.song)}`;
    // Unlike 'music', null is not a legitimate reading here -- there is no
    // silence-equivalent sting -- so an unresolved reference (never chosen,
    // or chosen and since deleted) reads as an explicit error state rather
    // than being folded into songName's own "song N" fallback the way a
    // stale music reference would be.
    case 'sting':
      return command.song === null || command.song === undefined || !(context.songs ?? [])[command.song]
        ? 'Sting: (choose a song)'
        : `Sting: ${songName(command.song)}`;
    case 'battle':
      return (command.monsters ?? []).length
        ? `Battle ${command.monsters.map(actorName).join(', ')}`
        : 'Battle (no monsters — dropped on save)';
    case 'heal':
      return `Heal ${command.value ?? 0}`;
    case 'damage':
      return `Damage ${command.value ?? 0}`;
    case 'save':
      return 'Save the game';
    case 'move': {
      const who = MOVE_TARGETS.find((entry) => entry.id === command.who)?.label ?? MOVE_TARGETS[0].label;
      const dir = (MOVE_DIRECTIONS.find((entry) => entry.id === command.dir)?.label ?? MOVE_DIRECTIONS[0].label)
        .toLowerCase();
      // A distance of zero is the one Move that does nothing, and the compiler
      // does not drop it — the engine runs straight past it. Said here rather
      // than only in the hint, because this line is what the event list shows.
      return command.dist ? `Move ${who} ${dir} ${command.dist}px` : `Move ${who} ${dir} (0px — does nothing)`;
    }
    case 'turn': {
      const who = MOVE_TARGETS.find((entry) => entry.id === command.who)?.label ?? MOVE_TARGETS[0].label;
      const dir = (MOVE_DIRECTIONS.find((entry) => entry.id === command.dir)?.label ?? MOVE_DIRECTIONS[0].label)
        .toLowerCase();
      return `Turn ${who} to face ${dir}`;
    }
    // A frame count of zero is the one Wait that does nothing, the same
    // reason a zero-distance Move says so in its own summary line above.
    case 'wait':
      return command.frames ? `Wait ${command.frames} frames` : 'Wait 0 frames (does nothing)';
    case 'shake':
      return command.frames ? `Shake screen for ${command.frames} frames` : 'Shake screen for 0 frames (does nothing)';
    case 'visible':
      return command.state === 'shown' ? 'Show this actor' : 'Hide this actor';
    // A direction of 'none' is the one Fade that does nothing, the same
    // reason a zero-distance Move/Wait/Shake says so in its own summary line
    // above -- 'out'/'in' already read as full sentences on their own
    // ("Fade out (to black)"), but 'none' alone ("(does nothing)") would not.
    case 'fade':
      return command.dir === 'none'
        ? 'Fade (does nothing)'
        : FADE_DIRECTIONS.find((entry) => entry.id === command.dir)?.label ?? FADE_DIRECTIONS[0].label;
    // No operand at all, the same "nothing to configure" shape 'save' has
    // above -- every Flash command does the one thing it can do.
    case 'flash':
      return 'Flash the screen';
    case 'route': {
      const who = MOVE_TARGETS.find((entry) => entry.id === command.who)?.label ?? MOVE_TARGETS[0].label;
      // routeLegs here too, not just `.filter(leg => leg.off !== true)`: keeps
      // this summary honest about a live, not-yet-normalized route holding an
      // illegal leg -- it describes exactly what would compile, not what is
      // merely present in memory. Reusing describeEnabled itself for each leg
      // (via legWithWho) means a leg's own summary text is exactly what the
      // same command would say standing alone.
      const legs = routeLegs(command.legs).filter((leg) => leg.off !== true);
      if (!legs.length) return `Route (${who}): nothing — every leg is off`;
      return `Route (${who}): ${legs
        .map((leg) => describeEnabled(legWithWho(leg, command.who), context))
        .join('; ')}`;
    }
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
export function describeCondition(cond, { actors = [], items = [], switches = [], variables = [] } = {}) {
  const entry = EVENT_CONDITIONS.find((item) => item.id === cond?.type) ?? EVENT_CONDITIONS[0];
  if (!entry.arg) return entry.label;
  if (entry.arg === 'switch') return `${entry.label}: ${switches[cond.arg]?.trim() || `switch ${cond.arg}`}`;
  // A comparison reads as a sentence about the thing being compared, so the
  // name goes where the word "Variable" is in the label: "Gems is at least 3".
  if (entry.arg === 'variable') {
    const name = variables[cond.arg]?.trim() || `variable ${cond.arg}`;
    return `${entry.label.replace('Variable', name)} ${cond.value ?? 0}`;
  }
  // The same "does this resolve" question Give/Take above asks, and the same
  // wording: after an item is deleted, renumberItemDeletion (shared/project.js)
  // leaves a condition that named it pointing at NO_ITEM, and reading that
  // back as "item 255" would describe a number rather than the fact.
  if (itemMissing(items, cond.arg)) return `${entry.label}: (missing item)`;
  return `${entry.label}: ${items[cond.arg]?.name ?? `item ${cond.arg}`}`;
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

  // Built once, the first time a route's own preview needs it, and reused
  // across every route row and every rerender() for the rest of this modal
  // session -- context.place's own project/tilesetId never change while the
  // modal is open, so one MetatileRenderer serves every route in this event.
  // See design-routes.md §5.4/§10 for why this is a fresh, modal-local
  // renderer rather than map.js's own live instance.
  let previewRenderer;
  function getPreviewRenderer() {
    if (!context.place) return null;
    if (!previewRenderer) {
      previewRenderer = new MetatileRenderer().rebuild(context.place.project, context.place.tilesetId);
    }
    return previewRenderer;
  }

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
              'the only thing left is a branch or a route with nothing live inside it. A page ' +
              'that matches and does nothing would swallow every page below it.'
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
            list.push(defaultCommand(fired.target.value, context));
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
    // Only 'item' (Carrying) reaches here today — EVENT_CONDITIONS has no
    // other arg shape left once switch and variable are handled above.
    //
    // itemPickerOptions (shared/project.js) is the single writer of which
    // items this offers and how cond.arg is represented if it does not
    // resolve — the Give/Take select below and the Sprite Forge's Drops
    // select ask it the identical question, rather than each keeping its
    // own copy of the filter (the shape CLAUDE.md already warns about for
    // effectiveTrigger: three places deciding this separately is how the
    // editor comes to show one thing and the ROM run another).
    const { healthy, missing } = itemPickerOptions(context.items, cond.arg);
    return el(
      'select',
      {
        style: { flex: '1' },
        onchange: (fired) => (cond.arg = Number(fired.target.value))
      },
      missing ? el('option', { value: missing.value ?? '', selected: true }, missing.label) : null,
      healthy.map((option) => el('option', { value: option.value, selected: option.selected }, option.label))
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
   * Rounded here through damageAmount (shared/eventrules.js), not a second
   * clamp written here: a number field will hand back 1.5 for the asking,
   * and normalizeEventCommand/encodeCommand/projectUsesCombat all have to
   * agree with whatever this turns it into, or the same project builds
   * differently before and after being reopened. damageAmount is named for
   * the Heal/Damage field it was written for, but the clamp a 0-255 field
   * needs is the same clamp regardless of which field is asking.
   */
  function valueInput(value, onChange) {
    return el('input', {
      type: 'number',
      min: 0,
      max: 255,
      value,
      title: 'A number from 0 to 255',
      style: { width: '70px', flex: 'none' },
      onchange: (fired) => onChange(damageAmount(fired.target.value))
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

    // A route's legs are a fixed, small vocabulary (move/turn/wait), never
    // another route, a branch or a choice -- so unlike branch/choice above,
    // there is no addCommand()/offeredCommands() call anywhere in this
    // block, only the dedicated leg-adding control below.
    if (command.op === 'route') {
      // Canonicalize the DRAFT to its admitted legs, at the moment this row
      // renders -- a real removal, not a filtered view of data that is
      // still there. store.commit() never runs normalizeProject, so an
      // unadmitted leg reaching this draft from a hand-edited or
      // bypassed-normalization file would otherwise survive in memory
      // indefinitely; this is the one moment the editor can honestly
      // reconcile what it renders with what would actually compile. Cancel
      // discards the whole draft regardless, so this can never reach
      // store.project without the author choosing Save -- and Save writing
      // exactly the admitted list is no loss, because that is what a
      // save/load round-trip through normalizeProject would already have
      // produced on its own. From here on, command.legs IS the admitted
      // list -- position is simply that array's own index, so listTools
      // needs no route-specific index translation.
      command.legs = routeLegs(command.legs);

      const who = el(
        'select',
        {
          style: { flex: 'none' },
          onchange: (fired) => {
            command.who = fired.target.value;
            rerender();
          }
        },
        MOVE_TARGETS.map((entry) => el('option', { value: entry.id, selected: entry.id === command.who }, entry.label))
      );

      const legRow = (leg, index) => {
        const legDim = leg.off ? { opacity: '0.55' } : null;
        const legToggle = el(
          'label.check',
          { title: leg.off ? 'Switched off — not built' : 'Switch this leg off without deleting it' },
          el('input', {
            type: 'checkbox',
            checked: !leg.off,
            onchange: (fired) => {
              if (fired.target.checked) delete leg.off;
              else leg.off = true;
              rerender();
            }
          })
        );
        const legTools = [legToggle, ...listTools(command.legs, index, { what: 'leg', onChange: rerender })];
        if (leg.op === 'move') {
          const hint = leg.dist
            ? 'The event waits here until the walk finishes. It stops early at a wall or the edge of ' +
              'the screen. 16 pixels is one metatile.'
            : 'A distance of 0 does nothing and the event carries straight on. 16 pixels is one metatile.';
          return el(
            'div',
            { style: { marginBottom: '6px', ...legDim } },
            el(
              'div.field-row',
              null,
              el('span', { style: { flex: 'none', minWidth: '56px', color: 'var(--text-dim)' } }, 'Move'),
              el(
                'select',
                {
                  style: { flex: 'none' },
                  onchange: (fired) => {
                    leg.dir = fired.target.value;
                    rerender();
                  }
                },
                MOVE_DIRECTIONS.map((entry) => el('option', { value: entry.id, selected: entry.id === leg.dir }, entry.label))
              ),
              el('input', {
                type: 'number',
                min: 0,
                max: 255,
                value: leg.dist,
                title: 'Distance in pixels — 16 is one metatile',
                style: { width: '70px' },
                onchange: (fired) => {
                  leg.dist = wholeNumber(fired.target.value, 255);
                  rerender();
                }
              }),
              legTools
            ),
            el('p.hint', null, hint)
          );
        }
        if (leg.op === 'turn') {
          return el(
            'div',
            { style: { marginBottom: '6px', ...legDim } },
            el(
              'div.field-row',
              null,
              el('span', { style: { flex: 'none', minWidth: '56px', color: 'var(--text-dim)' } }, 'Turn'),
              el(
                'select',
                {
                  style: { flex: 'none' },
                  onchange: (fired) => {
                    leg.dir = fired.target.value;
                    rerender();
                  }
                },
                MOVE_DIRECTIONS.map((entry) => el('option', { value: entry.id, selected: entry.id === leg.dir }, entry.label))
              ),
              legTools
            ),
            el(
              'p.hint',
              null,
              'Sets the facing at once, without walking — the route carries straight on to the next leg ' +
                'on the same frame.'
            )
          );
        }
        // wait
        return el(
          'div',
          { style: { marginBottom: '6px', ...legDim } },
          el(
            'div.field-row',
            null,
            el('span', { style: { flex: 'none', minWidth: '56px', color: 'var(--text-dim)' } }, 'Wait'),
            el('input', {
              type: 'number',
              min: 0,
              max: 255,
              value: leg.frames,
              title: 'Frames — 60 is one second',
              style: { width: '70px' },
              onchange: (fired) => {
                leg.frames = wholeNumber(fired.target.value, 255);
                rerender();
              }
            }),
            el('span', { style: { color: 'var(--text-dim)' } }, 'frames'),
            legTools
          ),
          el(
            'p.hint',
            null,
            leg.frames
              ? 'The route pauses here, with the world frozen, until this many frames pass — 60 is one second.'
              : 'A wait of 0 does nothing and the route carries straight on.'
          )
        );
      };

      // Reuses EVENT_COMMANDS' own id/label pairs for Move/Turn/Wait rather
      // than a second, hand-written three-item list that could drift from
      // those labels. defaultCommand() gives a leg the identical
      // never-a-silent-no-op defaults a standalone Move/Turn/Wait already
      // gets (16px, not 0px; 30 frames, not 0) -- reused rather than
      // reinvented as a literal zero, which would silently add a leg that
      // does nothing the moment it is added.
      const addLeg = el(
        'div.field-row',
        { style: { marginTop: '6px' } },
        el(
          'select',
          {
            value: '',
            onchange: (fired) => {
              if (!fired.target.value) return;
              const leg = defaultCommand(fired.target.value, context);
              delete leg.who;
              command.legs.push(leg);
              rerender();
            }
          },
          el('option', { value: '' }, '+ Add a leg…'),
          EVENT_COMMANDS.filter((entry) => ROUTE_LEG_OPS.has(entry.id)).map((entry) =>
            el('option', { value: entry.id }, entry.label)
          )
        )
      );

      const { caption, instructions } = routeTrace(command, context.place);
      // Caption and canvas are mutually exclusive only across the three
      // no-trace states (no place, who: player, dead route via caption ===
      // null's absence never happening for those) -- the drawable self case
      // gets the canvas PLUS the fixed honesty note every drawable trace
      // carries (authored distance only -- runtime blocking is not
      // simulated), and a second, conditional note when this route is only
      // ever reached through a branch/choice (depth > 0), since the preview
      // cannot know whether that ancestor condition currently holds.
      const preview = caption
        ? el(
            'p.hint',
            { dataset: { routePreview: 'caption' }, style: { margin: '6px 0 0' } },
            caption
          )
        : (() => {
            const canvas = el('canvas', {
              dataset: { routePreview: 'canvas' },
              width: Math.round(SCREEN_PX_W * ROUTE_PREVIEW_ZOOM),
              height: Math.round(SCREEN_PX_H * ROUTE_PREVIEW_ZOOM),
              style: {
                display: 'block',
                marginTop: '6px',
                border: '1px solid var(--line)',
                background: '#000'
              }
            });
            const context2d = canvas.getContext('2d');
            const renderer = getPreviewRenderer();
            if (renderer && context.place) renderer.drawScreen(context2d, context.place.screen, ROUTE_PREVIEW_ZOOM);
            drawRouteTrace(context2d, instructions, ROUTE_PREVIEW_ZOOM);
            return el(
              'div',
              null,
              canvas,
              el(
                'p.hint',
                { dataset: { routePreview: 'limitation-note' }, style: { margin: '4px 0 0' } },
                'This traces the full authored distance of each leg. A wall, the screen edge, or ' +
                  'another actor can cut a Move short at runtime — the preview cannot know that.'
              ),
              depth > 0
                ? el(
                    'p.hint',
                    { dataset: { routePreview: 'conditional-note' }, style: { margin: '2px 0 0' } },
                    'This route only runs if this page’s page condition — and any surrounding If/Ask — allow it.'
                  )
                : null
            );
          })();

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
          el('span', { style: { flex: 'none', color: 'var(--text-dim)' } }, 'Route'),
          who,
          tools
        ),
        command.legs.length
          ? command.legs.map((leg, index) => legRow(leg, index))
          : el('p.hint', null, 'This route has no legs yet.'),
        addLeg,
        preview
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

    if (command.op === 'battle') {
      const monsters = command.monsters ?? [];
      const hostile = (context.actors ?? [])
        .map((actor, id) => ({ actor, id }))
        .filter(({ actor }) => isMonsterActor(actor));
      return el(
        'div',
        { style: { marginBottom: '6px', ...dim } },
        el(
          'div.field-row',
          { style: { marginBottom: '4px' } },
          el('span', { style: { flex: '1', color: 'var(--text-dim)' } }, 'Start a battle'),
          tools
        ),
        // Only monster-qualifying actors are offered — a formation slot
        // pointing at a pickup would compile, and then stand there being one.
        hostile.length
          ? Array.from({ length: RPG_LIMITS.monstersPerBattle }, (_, slot) =>
              el(
                'select',
                {
                  style: { marginBottom: '4px' },
                  onchange: (fired) => {
                    const next = [...monsters];
                    if (fired.target.value === '') next.splice(slot, 1);
                    else next[slot] = Number(fired.target.value);
                    command.monsters = next.filter((id) => id !== undefined);
                    rerender();
                  }
                },
                el('option', { value: '', selected: monsters[slot] === undefined }, `Slot ${slot + 1} — empty`),
                hostile.map(({ actor, id }) =>
                  el('option', { value: id, selected: id === monsters[slot] }, actor.name)
                )
              )
            )
          : el(
              'p.hint',
              { style: { color: 'var(--accent)' } },
              'No actor has contact damage above zero, so there is nothing to fight yet — give a monster ' +
                'damage in the Sprite Forge.'
            ),
        el(
          'p.hint',
          null,
          monsters.length
            ? 'The player cannot run from this fight, the same as walking into a placed monster on the map. ' +
              'Losing is a game over, the same as running out of hearts, so there is no lose branch to write — ' +
              'whatever comes after this command only ever runs when the player wins.'
            : 'An empty formation is dropped when you save — pick at least one monster above, or this ' +
              'command will not be there when you come back.'
        )
      );
    }

    if (command.op === 'heal' || command.op === 'damage') {
      // The same "does this project have a party" test that already decides
      // whether Join/Battle are offered at all — a party only exists in an
      // RPG, so it doubles as "is this project an RPG" without a second field
      // to keep in step with it.
      const isRpg = (context.party ?? []).length > 0;
      const unit = isRpg ? 'HP' : 'hearts';
      const whole = isRpg ? 'every recruited party member' : 'the player';
      const hint =
        command.op === 'heal'
          ? `Restores ${unit} to ${whole}, saturating at full.` +
            (isRpg ? ' A member who has fallen gets back up too, the same as an inn.' : ' 255 is a full heal.')
          : `Takes ${unit} away from ${whole}, saturating at 0. Reaching 0 is the same game over as ` +
            (isRpg ? 'a lost fight — everyone recruited falling at once ends it here too.' : 'running out of hearts.');
      return el(
        'div',
        { style: { marginBottom: '6px', ...dim } },
        el(
          'div.field-row',
          null,
          el(
            'span',
            { style: { flex: 'none', minWidth: '96px', color: 'var(--text-dim)' } },
            command.op === 'heal' ? 'Heal' : 'Damage'
          ),
          valueInput(command.value ?? 0, (value) => (command.value = value)),
          tools
        ),
        el('p.hint', null, hint)
      );
    }

    if (command.op === 'move') {
      const hint = command.dist
        ? 'The event waits here until the walk finishes. It stops early at a wall or the edge of the screen, ' +
          'so a route that is blocked on the day does not hang the game — 16 pixels is one metatile.'
        : 'A distance of 0 does nothing and the event carries straight on. 16 pixels is one metatile.';
      return el(
        'div',
        { style: { marginBottom: '6px', ...dim } },
        el(
          'div.field-row',
          null,
          el('span', { style: { flex: 'none', minWidth: '96px', color: 'var(--text-dim)' } }, 'Move'),
          el(
            'select',
            { style: { flex: 'none' }, onchange: (fired) => (command.who = fired.target.value) },
            MOVE_TARGETS.map((entry) =>
              el('option', { value: entry.id, selected: entry.id === command.who }, entry.label)
            )
          ),
          el(
            'select',
            { style: { flex: 'none' }, onchange: (fired) => (command.dir = fired.target.value) },
            MOVE_DIRECTIONS.map((entry) =>
              el('option', { value: entry.id, selected: entry.id === command.dir }, entry.label)
            )
          ),
          // Pixels, whole ones, for the same reason warp's landing position is:
          // this becomes a single byte, and the compiler and the schema round
          // differently.
          el('input', {
            type: 'number',
            min: 0,
            max: 255,
            value: command.dist,
            title: 'Distance in pixels — 16 is one metatile',
            style: { width: '70px' },
            onchange: (fired) => (command.dist = wholeNumber(fired.target.value, 255))
          }),
          tools
        ),
        el('p.hint', null, hint)
      );
    }

    if (command.op === 'turn') {
      return el(
        'div',
        { style: { marginBottom: '6px', ...dim } },
        el(
          'div.field-row',
          null,
          el('span', { style: { flex: 'none', minWidth: '96px', color: 'var(--text-dim)' } }, 'Turn'),
          el(
            'select',
            { style: { flex: 'none' }, onchange: (fired) => (command.who = fired.target.value) },
            MOVE_TARGETS.map((entry) =>
              el('option', { value: entry.id, selected: entry.id === command.who }, entry.label)
            )
          ),
          el(
            'select',
            { style: { flex: 'none' }, onchange: (fired) => (command.dir = fired.target.value) },
            MOVE_DIRECTIONS.map((entry) =>
              el('option', { value: entry.id, selected: entry.id === command.dir }, entry.label)
            )
          ),
          tools
        ),
        el(
          'p.hint',
          null,
          'Sets the facing at once, without walking — the event carries straight on to the next command ' +
            'on the same frame.'
        )
      );
    }

    if (command.op === 'wait') {
      return el(
        'div',
        { style: { marginBottom: '6px', ...dim } },
        el(
          'div.field-row',
          null,
          el('span', { style: { flex: 'none', minWidth: '96px', color: 'var(--text-dim)' } }, 'Wait'),
          el('input', {
            type: 'number',
            min: 0,
            max: 255,
            value: command.frames,
            title: 'Frames — 60 is one second',
            style: { width: '70px' },
            onchange: (fired) => (command.frames = wholeNumber(fired.target.value, 255))
          }),
          el('span', { style: { color: 'var(--text-dim)' } }, 'frames'),
          tools
        ),
        el(
          'p.hint',
          null,
          command.frames
            ? 'The event pauses here, with the world frozen, until this many frames pass — 60 is one second.'
            : 'A wait of 0 does nothing and the event carries straight on.'
        )
      );
    }

    if (command.op === 'shake') {
      return el(
        'div',
        { style: { marginBottom: '6px', ...dim } },
        el(
          'div.field-row',
          null,
          el('span', { style: { flex: 'none', minWidth: '96px', color: 'var(--text-dim)' } }, 'Shake'),
          el('input', {
            type: 'number',
            min: 0,
            max: 255,
            value: command.frames,
            title: 'Frames — 60 is one second',
            style: { width: '70px' },
            onchange: (fired) => (command.frames = wholeNumber(fired.target.value, 255))
          }),
          el('span', { style: { color: 'var(--text-dim)' } }, 'frames'),
          tools
        ),
        el(
          'p.hint',
          null,
          command.frames
            ? 'Shakes the screen for this many frames — 60 is one second. Unlike Wait, this does not ' +
              'pause the game: the world keeps moving while it shakes. Only the background moves — the ' +
              'player, entities and any sprite-based UI hold still. Because it does not pause, following ' +
              'a Shake with a Wait of the same length only roughly covers the shake’s duration, not exactly.'
            : 'A shake of 0 does nothing and the event carries straight on.'
        )
      );
    }

    if (command.op === 'visible') {
      return el(
        'div',
        { style: { marginBottom: '6px', ...dim } },
        el(
          'div.field-row',
          null,
          el('span', { style: { flex: 'none', minWidth: '96px', color: 'var(--text-dim)' } }, 'This actor is'),
          el(
            'select',
            { style: { flex: 'none' }, onchange: (fired) => (command.state = fired.target.value) },
            VISIBLE_STATES.map((entry) =>
              el('option', { value: entry.id, selected: entry.id === command.state }, entry.label)
            )
          ),
          tools
        ),
        el(
          'p.hint',
          null,
          'Only the sprite disappears — AI, contact damage and interaction all keep running on a hidden ' +
            'actor, so a hidden NPC can still be talked to and a hidden damage actor can still hurt the ' +
            'player. Hiding does not survive leaving the screen: the actor is visible again the next time ' +
            'this screen is drawn. For an actor gone for good, use a switch and a page condition instead.'
        )
      );
    }

    if (command.op === 'fade') {
      return el(
        'div',
        { style: { marginBottom: '6px', ...dim } },
        el(
          'div.field-row',
          null,
          el('span', { style: { flex: 'none', minWidth: '96px', color: 'var(--text-dim)' } }, 'Fade'),
          el(
            'select',
            { style: { flex: 'none' }, onchange: (fired) => (command.dir = fired.target.value) },
            FADE_DIRECTIONS.map((entry) =>
              el('option', { value: entry.id, selected: entry.id === command.dir }, entry.label)
            )
          ),
          tools
        ),
        el(
          'p.hint',
          null,
          command.dir === 'none'
            ? 'Fade (does nothing) — pick a direction to fade the screen out or back in.'
            : 'Ramps the whole screen — background and sprites alike — toward black or back, over a ' +
              'handful of frames. The event pauses here, with the world frozen, until the fade finishes. ' +
              'A completed fade sticks: it survives a warp, a battle, anything, until an explicit Fade the ' +
              'other way brings it back — only starting a new game or loading a save always restores full ' +
              'brightness regardless.'
        )
      );
    }

    if (command.op === 'save') {
      return el(
        'div',
        { style: { marginBottom: '6px', ...dim } },
        el('div.field-row', null, el('span', { style: { color: 'var(--text-dim)' } }, 'Save the game'), tools),
        el(
          'p.hint',
          null,
          'Writes the one save slot to the cartridge: where the player is, the switches and variables, the ' +
            'inventory and the party. This is the player\'s save, not the Map Forge\'s own — that one still ' +
            'happens whenever you save this project. An existing save can also just stop working: updating ' +
            'Forge, or a structural change to the project (adding a map, a screen or an actor, for instance), ' +
            'can make it incompatible with a later build — Continue then simply won\'t appear, with no message ' +
            'to say why.'
        )
      );
    }

    if (command.op === 'flash') {
      return el(
        'div',
        { style: { marginBottom: '6px', ...dim } },
        el('div.field-row', null, el('span', { style: { color: 'var(--text-dim)' } }, 'Flash the screen'), tools),
        el(
          'p.hint',
          null,
          'Flashes the whole screen — background and sprites alike — to white and back, a short, fixed ' +
            'burst with nothing to configure. Unlike Fade, this does not pause the game: the world keeps ' +
            'running while it flashes, the same way Shake does not pause it either.'
        )
      );
    }

    const controls = [];
    if (command.op === 'give' || command.op === 'take') {
      // itemPickerOptions (shared/project.js) is the single writer here too
      // -- see the Carrying select above for why this is not a second copy
      // of the same filter.
      const { healthy, missing } = itemPickerOptions(context.items, command.item);
      controls.push(
        el(
          'select',
          { style: { flex: '1' }, onchange: (fired) => (command.item = Number(fired.target.value)) },
          missing ? el('option', { value: missing.value ?? '', selected: true }, missing.label) : null,
          healthy.map((option) => el('option', { value: option.value, selected: option.selected }, option.label))
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
    } else if (command.op === 'call') {
      const commonEvents = context.commonEvents ?? [];
      controls.push(
        el(
          'select',
          { style: { flex: '1' }, onchange: (fired) => (command.event = Number(fired.target.value)) },
          // A reference the list no longer has — its common event was deleted
          // out from under it — gets its own option rather than being left to
          // fall on whichever option the browser renders first while
          // `command.event` keeps pointing at nothing: that would show one
          // event calling and compile a call to another, the editor and the
          // ROM disagreeing about what a command does.
          callTargetMissing(commonEvents, command.event)
            ? el('option', { value: command.event, selected: true }, 'Missing event')
            : null,
          // The option's value is the common event's own id, not its row in
          // the list — the list can be reordered or have an earlier entry
          // deleted out from under this without this select's value changing
          // what it names.
          commonEvents.map((entry) =>
            el(
              'option',
              { value: entry.id, selected: entry.id === command.event },
              entry.name || `Common event ${entry.id}`
            )
          )
        )
      );
    } else if (command.op === 'music') {
      const songs = context.songs ?? [];
      controls.push(
        el(
          'select',
          {
            style: { flex: '1' },
            onchange: (fired) => {
              const raw = fired.target.value;
              command.song = raw === '' ? null : Number(raw);
            }
          },
          el('option', { value: '', selected: command.song === null || command.song === undefined }, 'Silence'),
          songs.map((song, index) =>
            el('option', { value: index, selected: index === command.song }, song.name)
          )
        )
      );
    } else if (command.op === 'sting') {
      // Mirrors 'music' above almost exactly (same songs list, same onchange
      // shape) but drops the Silence option -- there is no silence-equivalent
      // sting -- and, per 'call's own callTargetMissing precedent for a stale
      // reference, shows a "Missing song" option whenever the current value
      // does not resolve, covering both "never chosen" (null) and "chosen,
      // then deleted" (an index songs no longer has) identically, so an
      // author opening an old project sees why the command is flagged rather
      // than a dropdown that silently shows nothing selected.
      const songs = context.songs ?? [];
      const stingSongMissing = command.song === null || command.song === undefined || !songs[command.song];
      controls.push(
        el(
          'select',
          {
            style: { flex: '1' },
            onchange: (fired) => (command.song = Number(fired.target.value))
          },
          stingSongMissing ? el('option', { value: command.song ?? '', selected: true }, 'Missing song') : null,
          songs.map((song, index) =>
            el('option', { value: index, selected: index === command.song }, song.name)
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
        //
        // A Start a battle command with nothing in its formation is dropped
        // too, wherever it is nested — the same thing normalizeEventCommand
        // already does on disk, applied here as well because the editor hands
        // Build the live project, not a normalized one: if Save let this
        // through, the gap between what the picker shows and what the ROM
        // does would only close on the next save-and-reload, and in between,
        // an author's actor-appears-to-fight, actor-instantly-wins reads as a
        // working boss fight right up until it is not one.
        onClick: () => {
          const pages = draft.pages
            .map((page) => ({ ...page, commands: stripEmptyBattles(page.commands) }))
            .filter((page) => page.commands.length);
          return pages.length ? { pages } : null;
        }
      }
    ]
  });
}

/**
 * A Start a battle command survives only with at least one monster in its
 * formation, however deep a branch or a question has nested it -- unless it,
 * or whatever holds it, is switched off. A disabled command is authoring
 * scaffolding: the whole point of the toggle is finding out whether a line
 * was the problem without losing what it said, so Save must not be the thing
 * that throws it away, and neither may this. That is also why a disabled
 * branch or option is returned untouched rather than recursed into — the
 * compiler already treats it as not there (compiledPages/liveCommands,
 * shared/eventrules.js), so stripping something out of it would be discarding
 * data nothing downstream was ever going to read anyway.
 */
export function stripEmptyBattles(commands) {
  return commands
    .map((command) => {
      if (command.off === true) return command;
      if (command.op === 'battle') return (command.monsters ?? []).length ? command : null;
      if (command.op === 'branch') {
        return { ...command, then: stripEmptyBattles(command.then ?? []), else: stripEmptyBattles(command.else ?? []) };
      }
      if (command.op === 'choice') {
        return {
          ...command,
          options: (command.options ?? []).map((option) => ({
            ...option,
            commands: stripEmptyBattles(option.commands ?? [])
          }))
        };
      }
      return command;
    })
    .filter(Boolean);
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

/**
 * Author the project's common events: bodies a `call` command reaches by name
 * rather than by place, so a chest, a shop or a recurring cutscene is written
 * once. Each row is a name and how many pages it holds; "Edit…" opens the same
 * page editor a placement's own event does, because a common event is that
 * same page/condition/command shape with a name instead of a place.
 *
 * `showModal` only ever has one modal open at a time, so "Edit…" cannot nest
 * one inside this one. Instead it resolves this list early with which row was
 * picked, edits that entry against the same `draft`, and reopens the list —
 * only Cancel and Save leave this function, resolving the same way `editEvent`
 * does (`undefined` for Cancel), or `{ commonEvents, commonEventSeq }` for
 * Save — both fields, because a "+ Common event" click during this session
 * consumed part of the id counter and that has to be saved along with the
 * list it was spent into, or the next session would hand the same id out
 * again. `seq` is a one-element array rather than a returned/reassigned
 * value so the add button in `listBody` — a plain function, not a closure
 * over this one — can advance it in place.
 */
export async function editCommonEvents(commonEvents, commonEventSeq, context) {
  const draft = structuredClone(commonEvents ?? []);
  // The same validity rule the schema applies wherever else an id is read,
  // not a second one hand-rolled here — see commonEventId in
  // shared/project.js for why the two must not drift apart.
  const seq = [commonEventId(commonEventSeq) ?? 0];

  for (;;) {
    const action = await showModal({ title: 'Common events', width: 480, body: (close) => listBody(draft, seq, close) });
    // Escape or a click outside the modal resolves with null, same as Cancel;
    // only an actual row's Edit… button resolves with an { edit } object.
    if (action && typeof action === 'object' && 'edit' in action) {
      const entry = draft[action.edit];
      // The live draft, not the caller's snapshot: a common event added,
      // renamed or removed earlier in this same session has to be what
      // "Run common event" offers here, or the picker shows names that no
      // longer exist and can save a call to one that is already gone.
      const result = await editEvent(entry.event, { ...context, commonEvents: draft });
      if (result !== undefined) entry.event = result;
      continue;
    }
    return action === 'save' ? { commonEvents: draft, commonEventSeq: seq[0] } : undefined;
  }
}

function listBody(draft, seq, close) {
  const body = el('div', { style: { minWidth: '460px' } });

  const row = (entry, index) => {
    const pages = compiledPages(entry.event).length;
    return el(
      'div.field-row',
      { style: { marginBottom: '6px' } },
      el('input', {
        type: 'text',
        value: entry.name,
        placeholder: `Common event ${index + 1}`,
        style: { flex: '1' },
        onchange: (fired) => (entry.name = fired.target.value)
      }),
      el('span.hint', { style: { flex: 'none', minWidth: '54px' } }, pages ? `${pages} page${pages === 1 ? '' : 's'}` : 'empty'),
      el('button.btn.btn-sm', { onclick: () => close({ edit: index }) }, 'Edit…'),
      el(
        'button.btn.btn-sm',
        { title: 'Remove this common event', onclick: () => { draft.splice(index, 1); rerender(); } },
        '✕'
      )
    );
  };

  const rerender = () => {
    const full = draft.length >= LIMITS.commonEvents;
    fill(
      body,
      el(
        'p.hint',
        { style: { marginBottom: '10px' } },
        'One body, callable from any placement’s event — a chest, a shop, a recurring cutscene ' +
          'authored once rather than repeated everywhere it happens.'
      ),
      draft.map(row),
      full
        ? el('p.hint', { style: { margin: '6px 0' } }, `Up to ${LIMITS.commonEvents} common events.`)
        : el(
            'button.btn.btn-sm',
            {
              style: { margin: '6px 0' },
              onclick: () => {
                // The next id off the running counter, never one recycled
                // from a deletion — see resolveCommonEventIds in
                // shared/project.js for why that distinction has to hold.
                draft.push({ id: seq[0]++, name: `Common event ${draft.length + 1}`, event: null });
                rerender();
              }
            },
            '+ Common event'
          ),
      el(
        'div.field-row',
        { style: { marginTop: '10px' } },
        el('button.btn.btn-sm', { onclick: () => close('cancel') }, 'Cancel'),
        el('button.btn.btn-sm.btn-accent', { onclick: () => close('save') }, 'Save')
      )
    );
  };
  rerender();
  return body;
}
