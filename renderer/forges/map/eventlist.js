// Every placed actor in the project, in one searchable list.
//
// Two problems, one answer. Finding something again — "where did I put the
// innkeeper?" — is a search over names. Finding *uses* of something — "what
// touches the Gate opened switch?", "what warps into the throne room?" — is a
// search over what each event does. Both work because the text searched is the
// text shown, and the text shown is `describeCommand`'s: it has already
// resolved switch numbers, actor ids and screen indices into their names. So
// the switch's own name is what finds it, and nothing here has to know what
// kind of thing is being looked for.
//
// The index is the whole project, not the current map. A warp is exactly the
// case where the thing you are looking for is somewhere else.

import { el, fill, showModal } from '../../ui.js';
import {
  screenLabel,
  entityLabel,
  flatScreens,
  canTalk,
  BEHAVIORS,
  RPG_LIMITS
} from '../../../shared/project.js';
import { describeCommand, describeCondition } from './events.js';

/**
 * One row per placed actor: where it is, what it is called, and what it does.
 * Pure — no DOM — so the search that runs over it is testable on its own.
 */
export function buildEventIndex(project, context) {
  const rows = [];
  const switchName = (n) => context.switches?.[n]?.trim() || `switch ${n}`;
  const screens = flatScreens(project);

  screens.forEach(({ mapIndex, screenIndex, screen }) => {
    screen.entities.forEach((entity, entityIndex) => {
      const actor = project.sprites.actors[entity.actorId];
      const props = entity.props ?? {};
      const detail = [];

      if (actor?.behavior === 'door') {
        const target = screens[props.toScreen ?? 0];
        detail.push(`→ ${target?.label ?? `screen ${props.toScreen ?? 0}`} at ${props.toX ?? 0},${props.toY ?? 0}`);
      }
      if (props.event) {
        props.event.pages.forEach((page, position) => {
          const commands = page.commands.map((command) => describeCommand(command, context)).join('; ');
          detail.push(`${position + 1}. ${describeCondition(page.cond, context)} → ${commands || 'nothing'}`);
        });
      } else if (props.dialogue?.trim()) {
        detail.push(`Says “${props.dialogue.trim().slice(0, 60)}”`);
      }
      if (props.hideSwitch !== null && props.hideSwitch !== undefined) {
        detail.push(`Gone once ${switchName(props.hideSwitch)} is on`);
      }

      const behavior = BEHAVIORS.find((entry) => entry.id === actor?.behavior);
      rows.push({
        mapIndex,
        screenIndex,
        entityIndex,
        title: entityLabel(project, entity),
        // What a row with no detail says for itself. A pickup with nothing to
        // say is doing its job; only an actor the interact action can reach
        // gets remarked on, which is `canTalk` — the engine's own rule.
        note: canTalk(actor) ? 'says nothing when talked to' : behavior?.label ?? actor?.behavior ?? '',
        // The actor is named even when it is also the title, because searching
        // for "chest" should find every chest however each one was named.
        actorName: actor?.name ?? `Actor ${entity.actorId}`,
        where: screenLabel(project, mapIndex, screenIndex),
        at: `${entity.x},${entity.y}`,
        detail,
        haystack: [
          entityLabel(project, entity),
          actor?.name ?? '',
          actor?.behavior ?? '',
          screenLabel(project, mapIndex, screenIndex),
          props.dialogue ?? '',
          ...detail
        ]
          .join('   ')
          .toLowerCase()
      });
    });
  });
  return rows;
}

/**
 * Every term has to match, in any order and anywhere in the row — the same rule
 * every editor's fuzzy-ish filter uses, and the one that makes "chest gate"
 * find the gate key chest without having to remember which word came first.
 */
export function searchEvents(rows, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return rows;
  return rows.filter((row) => terms.every((term) => row.haystack.includes(term)));
}

/**
 * Show the list. Resolves to the row the user picked, or null if they dismissed
 * it — the caller is what knows how to navigate to a screen.
 */
export function openEventList(project, context, { query = '' } = {}) {
  const rows = buildEventIndex(project, context);
  let current = query;

  return showModal({
    title: 'Events in this project',
    width: 640,
    body: (close) => {
      const results = el('div');
      const summary = el('p.hint', { style: { margin: '8px 0' } });

      const search = el('input', {
        type: 'text',
        value: current,
        placeholder: 'Search names, dialogue, switches, destinations…',
        oninput: (event) => {
          current = event.target.value;
          render();
        }
      });

      function render() {
        const found = searchEvents(rows, current);
        summary.textContent = current
          ? `${found.length} of ${rows.length} placed actors`
          : `${rows.length} placed actor${rows.length === 1 ? '' : 's'}`;

        fill(results,
          found.length
            ? found.map((row) =>
                el(
                  'div',
                  {
                    style: {
                      padding: '8px 10px',
                      marginBottom: '6px',
                      background: 'var(--bg-2)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--radius)',
                      cursor: 'pointer'
                    },
                    title: 'Go to this actor',
                    onclick: () => close(row)
                  },
                  el(
                    'div.field-row',
                    null,
                    el('span', { style: { flex: '1', fontWeight: '600' } }, row.title),
                    el('span.hint', { style: { flex: 'none' } }, `${row.where} · ${row.at}`)
                  ),
                  row.detail.length
                    ? row.detail.map((line) => el('p.hint', { style: { margin: '2px 0 0' } }, line))
                    : el('p.hint', { style: { margin: '2px 0 0' } }, `${row.actorName} — ${row.note}`)
                )
              )
            : el(
                'p.hint',
                null,
                rows.length ? 'Nothing matches.' : 'No actors are placed anywhere in this project yet.'
              )
        );
      }
      render();

      return el(
        'div',
        { style: { minWidth: '600px' } },
        search,
        summary,
        results,
        el(
          'p.hint',
          { style: { marginTop: '10px' } },
          `Searching a switch's name finds everything that sets, clears or tests it — there are ` +
            `${RPG_LIMITS.switches}, and this is how you find out which are spoken for.`
        )
      );
    },
    actions: [{ label: 'Close', value: null }]
  });
}
