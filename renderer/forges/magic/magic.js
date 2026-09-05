// Magic Forge — spell authoring, moved out of the Sprite Forge's Party tab
// (item 13, phase 3). A party member's own *learned* spells stay on that tab
// (they are edited per member, not per spell); this Forge owns the catalog
// itself: name, kind, damage/heal range, MP cost, element and scope.

import { store } from '../../store.js';
import { el, fill, field, confirmModal, toast } from '../../ui.js';
import { ELEMENTS, RPG_LIMITS, SPELL_KINDS, SPELL_SCOPES, createSpell, renumberSpellDeletion } from '../../../shared/project.js';

const NAME_LIMIT = RPG_LIMITS.nameLength;

// Mirrors POISON_DMG/BURN_DMG in engine/constants.asm: both status kinds
// ignore amountMin/amountMax and cost a fixed, un-authored amount per turn
// instead, so the Amount field below is replaced by a hint naming it rather
// than showing fields the ROM ignores.
const STATUS_KIND_DAMAGE = { poison: 2, burn: 3 };

const number = (value, min, max, onChange, title = null) =>
  el('input', {
    type: 'number',
    min,
    max,
    value,
    title,
    onchange: (event) => onChange(Math.max(min, Math.min(max, Number(event.target.value))))
  });

const select = (options, value, onChange) =>
  el(
    'select',
    { onchange: (event) => onChange(event.target.value) },
    options.map((entry) => el('option', { value: entry.id, selected: entry.id === value }, entry.label))
  );

export function mount(container, app) {
  const state = { selected: 0 };

  const body = el('div.panel-body');

  const spells = () => store.project.spells;
  const spell = () => spells()[state.selected] ?? null;

  function updateSpell(label, mutate) {
    const index = state.selected;
    store.commit(label, (project) => mutate(project.spells[index]));
    render();
  }

  // The equivalent of the old modal's Save-time swap (`Math.min`/`Math.max`
  // across the pair), moved to the commit itself now that there is no Save to
  // swap on: whichever end the author just edited, both fields are written
  // together so `amountMin <= amountMax` holds the instant the commit lands
  // — never a backwards pair sitting in `store.project`, which store.commit
  // never normalizes and would compile straight into a negative
  // `spell_amount_n`.
  function updateRange(min, max) {
    const amountMin = Math.min(min, max);
    const amountMax = Math.max(min, max);
    updateSpell('Change spell amount range', (target) => {
      target.amountMin = amountMin;
      target.amountMax = amountMax;
    });
  }

  function render() {
    // A deletion elsewhere in the same undo/redo history (or an undo of an
    // Add made here) can leave `state.selected` past the end of a shorter
    // list; onProjectChange fires on every project change, not only ones
    // this Forge made, so this has to be resilient to both.
    if (state.selected >= spells().length) state.selected = Math.max(0, spells().length - 1);

    const list = spells();
    const current = spell();

    fill(
      body,
      el(
        'p.hint',
        { style: { marginBottom: '12px', maxWidth: '640px' } },
        'A spell against something weak to its element does half again as much; against something ' +
          'that resists it, half. The first eight are the only ones a party member can learn — the ' +
          'engine keeps what they know in one bitmask byte.'
      ),
      el(
        'div.field-row',
        { style: { marginBottom: '12px' } },
        el(
          'select',
          {
            size: Math.min(10, Math.max(4, list.length)),
            style: { minWidth: '220px' },
            onchange: (event) => {
              state.selected = Number(event.target.value);
              render();
            }
          },
          list.length
            ? list.map((entry, index) => el('option', { value: index, selected: index === state.selected }, entry.name))
            : [el('option', null, 'No spells yet')]
        ),
        el(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
          el(
            'button.btn.btn-sm',
            {
              disabled: list.length >= RPG_LIMITS.spells,
              title:
                list.length >= RPG_LIMITS.spells
                  ? `${RPG_LIMITS.spells} spells is the ceiling.`
                  : 'Add a spell',
              onclick: () => {
                store.commit('Add spell', (project) => {
                  const id = project.spells.length;
                  if (id >= RPG_LIMITS.spells) return;
                  project.spells.push(createSpell(id));
                });
                state.selected = spells().length - 1;
                render();
              }
            },
            '+'
          ),
          el(
            'button.btn.btn-sm',
            {
              disabled: !current,
              title: 'Delete',
              onclick: async () => {
                // Same capture-before-await / re-resolve-by-identity /
                // abort-with-toast shape as the Items Forge's own delete
                // (items.js) — the identical D2/E4 hazard applies here: the
                // project can change (an unrelated edit, an undo/redo, a
                // different project entirely) while this confirmation is
                // still open, and only re-resolving by object identity after
                // the await tells a genuine deletion apart from that.
                const target = current;
                if (
                  !(await confirmModal(
                    'Delete spell',
                    `Delete "${target.name}"? Anything that casts or has learned it will name nothing instead.`,
                    'Delete'
                  ))
                ) {
                  return;
                }
                const index = store.project.spells.indexOf(target);
                if (index === -1) {
                  toast('The project changed while that confirmation was open — nothing was deleted. Try again.', 'error');
                  render();
                  return;
                }
                store.commit('Delete spell', (project) => {
                  renumberSpellDeletion(project, index);
                  project.spells.splice(index, 1);
                  project.spells.forEach((entry, position) => (entry.id = position));
                });
                if (state.selected >= index) state.selected = Math.max(0, state.selected - 1);
                render();
              }
            },
            '✕'
          )
        )
      ),
      current
        ? el(
            'div',
            null,
            field(
              'Name',
              el('input', {
                type: 'text',
                value: current.name,
                maxlength: NAME_LIMIT,
                title: `The battle box has room for ${NAME_LIMIT} characters`,
                onchange: (event) =>
                  updateSpell('Rename spell', (entry) => {
                    entry.name = event.target.value.slice(0, NAME_LIMIT);
                  })
              })
            ),
            field('Kind', select(SPELL_KINDS, current.kind, (value) => updateSpell('Change spell kind', (entry) => (entry.kind = value)))),
            // Poison and Burn are statuses, not a number: the victim loses a
            // fixed amount after each of its turns, so amountMin/amountMax
            // would be fields the ROM ignores. See STATUS_KIND_DAMAGE above.
            current.kind in STATUS_KIND_DAMAGE
              ? field(
                  'Amount',
                  el(
                    'span.hint',
                    { title: `${SPELL_KINDS.find((k) => k.id === current.kind).label} costs a fixed ${STATUS_KIND_DAMAGE[current.kind]} HP per turn` },
                    `${STATUS_KIND_DAMAGE[current.kind]}/turn`
                  )
                )
              : field(
                  'Amount',
                  el(
                    'span.field-row',
                    { style: { gap: '4px' } },
                    number(current.amountMin, 1, 255, (value) => updateRange(value, current.amountMax), 'Minimum'),
                    el('span.hint', {}, '–'),
                    number(current.amountMax, 1, 255, (value) => updateRange(current.amountMin, value), 'Maximum')
                  )
                ),
            field('MP cost', number(current.mpCost, 0, 255, (value) => updateSpell('Change spell MP cost', (entry) => (entry.mpCost = value)))),
            field('Element', select(ELEMENTS, current.element, (value) => updateSpell('Change spell element', (entry) => (entry.element = value)))),
            field('Scope', select(SPELL_SCOPES, current.scope, (value) => updateSpell('Change spell scope', (entry) => (entry.scope = value))))
          )
        : null
    );
  }

  const root = el(
    'div.forge',
    { style: { gridTemplateColumns: '1fr' } },
    el('div.panel', { style: { borderRight: 'none' } }, el('div.panel-head', null, 'Magic'), body)
  );

  container.append(root);
  render();
  app.setMeta('Magic Forge');

  return {
    destroy() {
      app.setMeta('');
    },
    onProjectChange: render
  };
}
