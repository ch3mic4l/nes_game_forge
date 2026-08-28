// Items Forge — the item id space phase 4b introduced, with a place to
// actually author one. Give item / Take item, a Carrying condition and a
// monster's drop all name an entry here. "Collected from" is the other
// direction of the same relationship: which Pickup actor (Sprite Forge)
// grants this item when walked into or interacted with, or "None
// (script-only)" for an item only ever handed out by an event.

import { store } from '../../store.js';
import { el, fill, field, confirmModal, toast } from '../../ui.js';
import { LIMITS, ITEM_EFFECT_KINDS, itemActorOptions, renumberItemDeletion } from '../../../shared/project.js';

/**
 * What actually happens today if this effect is spent, honestly stated.
 * Round 2 (engine/ui.asm's use_item_apply) made `use_item` (the field/menu
 * "spend an item" action, every game type) read `effect` before spending
 * anything: a `none`-kind item is a real key item, kept rather than spent;
 * `heal` applies through whichever health model the build has (BATTLE_ENABLED:
 * party_heal; otherwise gain_hearts) and is spent, in both game types;
 * `damage` does the same through party_damage/lose_hearts, spent the same
 * way, and can be lethal.
 *
 * Round 3 (engine/battleui.asm's build_item_list) closed the two
 * inconsistencies round 2 review found between the field and the RPG battle
 * ITEM menu (item_chosen, engine/battleturn.asm): that menu's own list is now
 * filtered to `kind == heal AND amount > 0` -- exactly what item_chosen can
 * spend consistently -- so a Damages item or a Heals item left at Amount 0
 * simply never appears there as a row to choose wrongly. Neither is a
 * mismatch worth a hint any more; the one thing still true is narrower and
 * unavoidable rather than a defect: `damage` has no battle-menu presence at
 * all, by design (this phase does not implement battle-targeted damage), so
 * it is field-only in an RPG.
 */
function effectHint(kind, gameType) {
  if (kind !== 'damage' || gameType !== 'rpg') return null;
  return el(
    'p.hint',
    { style: { marginTop: '8px', color: 'var(--text-faint)' } },
    'Field-only in an RPG -- it never appears as a choice in the battle ITEM menu.'
  );
}

export function mount(container, app) {
  const state = { selected: 0 };

  const body = el('div.panel-body');

  const items = () => store.project.items;
  const item = () => items()[state.selected] ?? null;

  function updateItem(label, mutate) {
    const index = state.selected;
    store.commit(label, (project) => mutate(project.items[index]));
    render();
  }

  function render() {
    // A deletion elsewhere in the same undo/redo history (or an undo of an
    // Add made here) can leave `state.selected` past the end of a shorter
    // list; onProjectChange fires on every project change, not only ones
    // this Forge made, so this has to be resilient to both.
    if (state.selected >= items().length) state.selected = Math.max(0, items().length - 1);

    const list = items();
    const current = item();

    fill(
      body,
      el(
        'p.hint',
        { style: { marginBottom: '12px', maxWidth: '640px' } },
        'Give item / Take item, a Carrying condition and a monster’s drop all name one of these. ' +
          '“Collected from” below picks which placed Pickup actor grants it — give an actor Pickup ' +
          'behaviour in the Sprite Forge first, then choose it here.'
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
            : [el('option', null, 'No items yet')]
        ),
        el(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
          el(
            'button.btn.btn-sm',
            {
              disabled: list.length >= LIMITS.items,
              title:
                list.length >= LIMITS.items
                  ? `${LIMITS.items} items is the ceiling — id $FF is reserved to mean "no item".`
                  : 'Add an item',
              onclick: () => {
                store.commit('Add item', (project) => {
                  const id = project.items.length;
                  if (id >= LIMITS.items) return;
                  project.items.push({
                    id,
                    name: `Item ${id}`,
                    actorId: null,
                    metaspriteId: null,
                    effect: { kind: 'none', amount: 0 }
                  });
                });
                state.selected = items().length - 1;
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
                // Round 1d, finding D2: `current` used to be captured before
                // this await but the index was read after it, and
                // onProjectChange keeps firing while the modal is open --
                // an undo, a redo, or an entirely different project being
                // opened all replace `project.items` (undo/redo restore a
                // structuredClone, a fresh open swaps `store.project`
                // outright) with new objects, so a *later* re-read of
                // `state.selected` can name a completely different item, or
                // one belonging to a project that no longer exists. `target`
                // is this delete's own identity, captured before the await;
                // after it, the only question that matters is whether that
                // exact object is still sitting in whatever `store.project`
                // now is -- not merely whether some index still looks valid,
                // which would say nothing about which item is actually there.
                const target = current;
                if (
                  !(await confirmModal(
                    'Delete item',
                    `Delete "${target.name}"? Anything that gives, takes, checks for or drops it will name nothing instead.`,
                    'Delete'
                  ))
                ) {
                  return;
                }
                const index = store.project.items.indexOf(target);
                if (index === -1) {
                  // Round 1e finding E4: this used to say the item "no
                  // longer exists", which is only true for one of the ways
                  // it can end up missing here. An undo/redo of some
                  // unrelated edit also fails this same identity check --
                  // it restores a structuredClone, so the same logical item
                  // is still there, just as a new object -- and indexOf
                  // cannot tell that apart from a genuine deletion. Say the
                  // true, general thing: the project changed while the
                  // confirmation was open, not a claim about this specific
                  // item's fate.
                  toast('The project changed while that confirmation was open — nothing was deleted. Try again.', 'error');
                  render();
                  return;
                }
                store.commit('Delete item', (project) => {
                  renumberItemDeletion(project, index);
                  project.items.splice(index, 1);
                  project.items.forEach((entry, position) => (entry.id = position));
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
                onchange: (event) =>
                  updateItem('Rename item', (entry) => {
                    entry.name = event.target.value.trim() || `Item ${state.selected}`;
                  })
              })
            ),
            field(
              'Collected from',
              (() => {
                const { healthy, missing } = itemActorOptions(store.project.sprites.actors, current.actorId);
                return el(
                  'select',
                  {
                    onchange: (event) =>
                      updateItem('Change item’s backing actor', (entry) => {
                        entry.actorId = event.target.value === '' ? null : Number(event.target.value);
                      })
                  },
                  el('option', { value: '', selected: current.actorId === null }, 'None (script-only)'),
                  missing ? el('option', { value: missing.value, selected: true }, missing.label) : null,
                  healthy.map((option) => el('option', { value: option.value, selected: option.selected }, option.label))
                );
              })()
            ),
            el(
              'div.field-row',
              null,
              field(
                'Effect',
                el(
                  'select',
                  {
                    onchange: (event) =>
                      updateItem('Change item effect', (entry) => {
                        entry.effect = { kind: event.target.value, amount: event.target.value === 'none' ? 0 : entry.effect?.amount ?? 0 };
                      })
                  },
                  ITEM_EFFECT_KINDS.map((entry) =>
                    el('option', { value: entry.id, selected: entry.id === current.effect?.kind }, entry.label)
                  )
                )
              ),
              field(
                'Amount',
                el('input', {
                  type: 'number',
                  min: 0,
                  max: 255,
                  // Means nothing for kind `none` -- disabled rather than left
                  // live-looking with nothing behind it, per CLAUDE.md's rule
                  // on offering something the engine does not implement.
                  disabled: (current.effect?.kind ?? 'none') === 'none',
                  title: (current.effect?.kind ?? 'none') === 'none' ? 'No effect is selected, so this does nothing' : null,
                  value: current.effect?.amount ?? 0,
                  onchange: (event) =>
                    updateItem('Change item effect amount', (entry) => {
                      entry.effect = { ...entry.effect, amount: Math.max(0, Math.min(255, Number(event.target.value) || 0)) };
                    })
                })
              )
            ),
            // Round 2's own use_item (engine/ui.asm) reads effect before
            // spending anything, so a None-kind key item is kept rather than
            // destroyed. See effectHint's own header for what is still
            // worth a hint after round 3's battle-list filter closed the
            // field/battle inconsistencies round 2 review found.
            effectHint(current.effect?.kind, store.project.project.gameType)
          )
        : null
    );
  }

  const root = el('div.forge', { style: { gridTemplateColumns: '1fr' } }, el('div.panel', { style: { borderRight: 'none' } }, el('div.panel-head', null, 'Items'), body));

  container.append(root);
  render();
  app.setMeta('Items Forge');

  return {
    destroy() {
      app.setMeta('');
    },
    onProjectChange: render
  };
}
