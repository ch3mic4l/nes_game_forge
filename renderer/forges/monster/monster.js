// Monster Forge — everything about an actor that means something only in a
// battle: attack/defence/accuracy/evasion/speed, XP/gold, weak/resist, the
// spell it casts, its drop, and its battle artwork. `hp` and `damage` stay
// on the Sprite Forge's general Actor panel because both are genuinely
// dual-purpose there (an action project's own enemies use them directly);
// see docs/design-monster.md §2 for the full boundary argument.
//
// The catalog this Forge lists is not "every hostile actor" — an actor
// still named by a map's encounter table or a Start a battle command stays
// listed and marked stranded even after its contact damage is cleared to
// zero, because that authored reference is still real, editable data. See
// monsterActorIds (shared/project.js).

import { store } from '../../store.js';
import { el, fill, field } from '../../ui.js';
import { ELEMENTS, RPG_LIMITS, isMonsterActor, itemPickerOptions, monsterActorIds } from '../../../shared/project.js';
import { FONT_BASE } from '../../../shared/font.js';
import { drawSheet, sheetIndexFromEvent, SHEET_COLS } from '../../widgets/sheet.js';

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

const row = (...children) => el('div.field-row', { style: { gap: '8px', marginBottom: '6px' } }, ...children);

/**
 * An actor's battle stats: what it is worth fighting, and what fighting it
 * costs. Moved verbatim from renderer/forges/sprite/battle.js (the design's
 * "shrinks, it does not empty out") -- `actor.battle ?? {}` and a per-field
 * `?? default` throughout is not a change made for this move, it is the
 * discipline this code already followed, now the one this whole Forge is
 * held to (docs/design-monster.md §2).
 */
export function battleSection(actor, index, rerender) {
  const battle = actor.battle ?? {};
  const set = (key, value) => {
    store.commit('Change battle stats', (project) => {
      const target = project.sprites.actors[index];
      target.battle = { ...target.battle, [key]: value };
    });
    rerender();
  };

  const hostile = isMonsterActor(actor);
  // itemPickerOptions (shared/project.js) is the single writer of which
  // items a picker offers and how the currently-named one is represented if
  // it does not resolve -- the Map Forge's Carrying and Give/Take selects
  // ask it the identical question. `missing` is only rendered below when
  // `battle.drop` is not null: this field's own "Nothing" already covers
  // that case as a deliberate choice, not a broken reference, so this is
  // the one caller-specific decision the shared helper leaves to the field.
  const dropOptions = itemPickerOptions(store.project.items, battle.drop);

  return el(
    'div',
    { style: { marginTop: '16px', borderTop: '1px solid var(--line)', paddingTop: '12px' } },
    el('div.panel-head', { style: { paddingLeft: '0' } }, 'In battle'),
    el(
      'p.hint',
      { style: { marginBottom: '10px', color: hostile ? 'var(--text-faint)' : 'var(--accent)' } },
      hostile
        ? 'Contact damage above zero is what marks this actor a monster. These numbers decide how the fight goes.'
        : 'Contact damage is zero, so this actor never starts a fight. Items — including what they heal or damage for — are authored in the Items Forge now; set this actor’s Behaviour to Pickup and choose it there as an item’s “Collected from”, or hand one out with a scripted Give item command.'
    ),
    row(
      field('Attack', number(battle.atk ?? 4, 0, 255, (value) => set('atk', value))),
      field('Defence', number(battle.def ?? 2, 0, 255, (value) => set('def', value))),
      field('Speed', number(battle.speed ?? 4, 0, 255, (value) => set('speed', value)))
    ),
    row(
      field('Accuracy', number(battle.acc ?? 180, 0, 255, (value) => set('acc', value), 'Out of 255')),
      field('Evasion', number(battle.eva ?? 4, 0, 255, (value) => set('eva', value))),
      field('Magic points', number(battle.mp ?? 0, 0, 255, (value) => set('mp', value)))
    ),
    row(
      field('Experience', number(battle.xp ?? 4, 0, 65535, (value) => set('xp', value))),
      field('Gold', number(battle.gold ?? 2, 0, 255, (value) => set('gold', value)))
    ),
    row(
      field('Weak to', select(ELEMENTS, battle.weak ?? 'none', (value) => set('weak', value))),
      field('Resists', select(ELEMENTS, battle.strong ?? 'none', (value) => set('strong', value))),
      field(
        'Casts',
        el(
          'select',
          {
            title: 'Cast about half the time while the MP above lasts; otherwise it attacks',
            onchange: (event) => set('spellId', event.target.value === '' ? null : Number(event.target.value))
          },
          el('option', { value: '', selected: battle.spellId === null || battle.spellId === undefined }, 'Nothing'),
          store.project.spells.map((spell, id) =>
            el('option', { value: id, selected: id === battle.spellId }, spell.name)
          )
        )
      )
    ),
    row(
      field(
        'Drops',
        el(
          'select',
          { onchange: (event) => set('drop', event.target.value === '' ? null : Number(event.target.value)) },
          el('option', { value: '', selected: battle.drop === null || battle.drop === undefined }, 'Nothing'),
          battle.drop !== null && battle.drop !== undefined && dropOptions.missing
            ? el('option', { value: dropOptions.missing.value, selected: true }, dropOptions.missing.label)
            : null,
          dropOptions.healthy.map((option) => el('option', { value: option.value, selected: option.selected }, option.label))
        )
      ),
      field('Chance %', number(battle.dropPct ?? 10, 0, 100, (value) => set('dropPct', value)))
    ),

    el('div.panel-head', { style: { paddingLeft: '0', marginTop: '12px' } }, 'Battle artwork'),
    el(
      'p.hint',
      { style: { marginBottom: '8px' } },
      'A block of background tiles on the battle tileset, laid out on a 16-wide sheet. Colour 0 in it ' +
        'shows as the screen’s backdrop rather than the ground, so fill the block. Leave it off and the ' +
        'actor is drawn from its idle animation instead, which every actor already has.'
    ),
    artPicker(battle, set),
    row(
      field('Tiles across', number(battle.battleW ?? 4, 1, RPG_LIMITS.battleArtTiles, (v) => set('battleW', v))),
      field('Tiles down', number(battle.battleH ?? 4, 1, RPG_LIMITS.battleArtTiles, (v) => set('battleH', v))),
      field('Palette', number(battle.battlePalette ?? 2, 0, 3, (value) => set('battlePalette', value)))
    )
  );
}

/**
 * The battle tileset's background table, click-to-place. The block is drawn as
 * a rectangle over the sheet, so what is chosen is what the battle screen will
 * copy — and the click is clamped so the whole block stays on the sheet and
 * out of the font's reserved rows, because an RPG always shows text.
 */
function artPicker(battle, set) {
  const tilesets = store.project.tilesets;
  const tileset = tilesets[store.project.rpg?.battleTilesetId ?? 0] ?? tilesets[0];
  const palette = store.project.palettes.bg[battle.battlePalette ?? 2] ?? store.project.palettes.bg[0];
  const width = battle.battleW ?? 4;
  const height = battle.battleH ?? 4;
  const fontRow = FONT_BASE / SHEET_COLS;

  const canvas = el('canvas.sheet', { style: { cursor: 'crosshair' } });
  drawSheet(canvas, tileset.background.tiles, palette, 2);
  const context = canvas.getContext('2d');
  const cell = 16; // 8 px at zoom 2
  context.fillStyle = 'rgba(0,0,0,0.55)';
  context.fillRect(0, fontRow * cell, canvas.width, canvas.height - fontRow * cell);
  if (battle.battleTile !== null && battle.battleTile !== undefined) {
    context.strokeStyle = '#ff9d3c';
    context.lineWidth = 2;
    context.strokeRect(
      (battle.battleTile % SHEET_COLS) * cell + 1,
      Math.floor(battle.battleTile / SHEET_COLS) * cell + 1,
      width * cell - 2,
      height * cell - 2
    );
  }
  canvas.addEventListener('pointerdown', (event) => {
    const index = sheetIndexFromEvent(event, canvas);
    const col = Math.min(index % SHEET_COLS, SHEET_COLS - width);
    const rowIndex = Math.max(0, Math.min(Math.floor(index / SHEET_COLS), fontRow - height));
    set('battleTile', rowIndex * SHEET_COLS + col);
  });

  const chosen =
    battle.battleTile === null || battle.battleTile === undefined
      ? 'No block chosen — the actor is drawn from its animation.'
      : `Block at $${battle.battleTile.toString(16).toUpperCase().padStart(2, '0')}, ${width}×${height} tiles.`;
  return el(
    'div',
    { style: { marginBottom: '8px' } },
    el('div.sheet-wrap', null, canvas),
    row(
      el('span.hint', { style: { flex: '1', alignSelf: 'center' } }, chosen),
      battle.battleTile === null || battle.battleTile === undefined
        ? null
        : el('button.btn.btn-sm', { onclick: () => set('battleTile', null) }, 'Use the animation')
    )
  );
}

export function mount(container, app) {
  const state = { selectedActorId: null };

  // A cross-link from the Sprite Forge (app.goTo('monster', { actorId })).
  // No further validation here: render()'s own `ids.includes` fallback below
  // already lands a deleted or otherwise unlisted id on the catalog's first
  // entry, which is exactly the behaviour a bad context should get. See
  // docs/design-monster.md §2.
  const context = app.consumeContext();
  if (Number.isInteger(context?.actorId)) {
    state.selectedActorId = context.actorId;
  }

  const body = el('div.panel-body');

  function render() {
    // The catalog and the live actor are both re-derived fresh on every
    // render, never cached across renders: an external commit, an undo or
    // a redo can change either while this Forge is mounted
    // (docs/design-monster.md §2). Selection is by actor id, never an
    // index into the catalog, because the catalog's own order and
    // membership can both change between renders.
    const ids = monsterActorIds(store.project);
    if (!ids.includes(state.selectedActorId)) {
      state.selectedActorId = ids.length ? ids[0] : null;
    }
    const actor = state.selectedActorId === null ? null : store.project.sprites.actors[state.selectedActorId] ?? null;

    fill(
      body,
      el(
        'p.hint',
        { style: { marginBottom: '12px', maxWidth: '640px' } },
        'Every actor that currently fights, or is named by a map’s encounter table or a Start a battle ' +
          'command, is listed here. To add, rename or delete a monster, or change its overworld sprite, ' +
          'hit points, contact damage or animations, use the Sprite Forge.'
      ),
      state.selectedActorId === null
        ? null
        : el(
            'button.btn.btn-sm',
            {
              style: { marginBottom: '12px' },
              onclick: () => app.goTo('sprite', { tab: 'actors', actorId: state.selectedActorId })
            },
            'Edit in the Sprite Forge →'
          ),
      el(
        'div.field-row',
        { style: { marginBottom: '12px' } },
        el(
          'select',
          {
            size: Math.min(10, Math.max(4, ids.length)),
            style: { minWidth: '220px' },
            onchange: (event) => {
              state.selectedActorId = Number(event.target.value);
              render();
            }
          },
          ids.length
            ? ids.map((id) => {
                const entry = store.project.sprites.actors[id];
                const stranded = !isMonsterActor(entry);
                return el(
                  'option',
                  { value: id, selected: id === state.selectedActorId },
                  stranded ? `${entry.name} (stranded)` : entry.name
                );
              })
            : [el('option', null, 'No monsters yet')]
        )
      ),
      actor
        ? el(
            'div',
            null,
            el(
              'div.field-row',
              { style: { alignItems: 'center', marginBottom: '4px' } },
              el('span.panel-head', { style: { paddingLeft: '0', flex: '1' } }, actor.name),
              el(
                'button.btn.btn-sm',
                {
                  disabled: !isMonsterActor(actor),
                  title: isMonsterActor(actor)
                    ? 'Clear this actor’s contact damage to zero'
                    : 'Contact damage is already zero',
                  onclick: () => {
                    const id = state.selectedActorId;
                    store.commit('Make harmless', (project) => {
                      project.sprites.actors[id].damage = 0;
                    });
                    render();
                  }
                },
                'Make harmless'
              )
            ),
            isMonsterActor(actor)
              ? null
              : el(
                  'p.hint',
                  { style: { marginBottom: '8px' } },
                  'Harmless — a map’s encounter table or a Start a battle command still names this actor, ' +
                    'so it stays listed here, whether or not that reference currently reaches a fight.'
                ),
            battleSection(actor, state.selectedActorId, render)
          )
        : el(
            'p.hint',
            null,
            'No actor currently fights, and none is named by a map’s encounter table or a Start a battle ' +
              'command. Give an actor contact damage in the Sprite Forge to make it a monster.'
          )
    );
  }

  const root = el(
    'div.forge',
    { style: { gridTemplateColumns: '1fr' } },
    el('div.panel', { style: { borderRight: 'none' } }, el('div.panel-head', null, 'Monster Forge'), body)
  );

  container.append(root);
  render();
  app.setMeta('Monster Forge');

  return {
    destroy() {
      app.setMeta('');
    },
    onProjectChange: render
  };
}
