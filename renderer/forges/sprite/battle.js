// The battle half of an actor, and the party it fights alongside.
//
// Only shown for a turn-based RPG: an action game has no battles for any of this
// to matter in, and offering a stat that nothing reads is the thing this
// codebase does not do.

import { store } from '../../store.js';
import { el, field } from '../../ui.js';
import { ELEMENTS, RPG_LIMITS, createPartyMember, isMonsterActor, itemPickerOptions } from '../../../shared/project.js';
import { FONT_BASE } from '../../../shared/font.js';
import { drawSheet, sheetIndexFromEvent, SHEET_COLS } from '../../widgets/sheet.js';

const NAME_LIMIT = RPG_LIMITS.nameLength;

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

/** An actor's battle stats: what it is worth fighting, and what fighting it costs. */
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

/** The party tab: who fights, how they grow, and what they learn. */
export function partyPanel(rerender, app) {
  const { party, spells } = store.project;

  const setMember = (index, key, value) => {
    store.commit('Change party member', (project) => {
      project.party[index][key] = value;
    });
    rerender();
  };

  return el(
    'div',
    null,
    el(
      'p.hint',
      { style: { maxWidth: '680px', marginBottom: '14px' } },
      `Up to ${RPG_LIMITS.party} members. Only the first walks the field — the rest exist in battle, and ` +
        'are recruited by an event’s Join command. Stats are base plus growth per level, worked out at ' +
        'build time into a table the engine reads, because the 6502 cannot multiply.'
    ),
    party.map((member, index) =>
      el(
        'div',
        {
          style: {
            background: 'var(--bg-2)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius)',
            padding: '10px',
            marginBottom: '10px',
            maxWidth: '680px'
          }
        },
        row(
          field(
            'Name',
            el('input', {
              type: 'text',
              value: member.name,
              maxlength: NAME_LIMIT,
              title: `The battle box has room for ${NAME_LIMIT} characters`,
              onchange: (event) => setMember(index, 'name', event.target.value.slice(0, NAME_LIMIT))
            })
          ),
          field(
            'Drawn as',
            el(
              'select',
              {
                onchange: (event) =>
                  setMember(index, 'metaspriteId', event.target.value === '' ? null : Number(event.target.value))
              },
              el('option', { value: '', selected: member.metaspriteId === null }, 'Not drawn'),
              store.project.sprites.metasprites.map((entry, id) =>
                el('option', { value: id, selected: id === member.metaspriteId }, entry.name)
              )
            )
          ),
          el(
            'label.check',
            { title: 'Members who do not start are recruited by an event' },
            el('input', {
              type: 'checkbox',
              checked: member.startsInParty,
              onchange: (event) => setMember(index, 'startsInParty', event.target.checked)
            }),
            ' Starts in the party'
          ),
          party.length > 1
            ? el(
                'button.btn.btn-sm',
                {
                  title: 'Remove',
                  onclick: () => {
                    store.commit('Remove party member', (project) => {
                      project.party.splice(index, 1);
                      project.party.forEach((entry, id) => (entry.id = id));
                    });
                    rerender();
                  }
                },
                '✕'
              )
            : null
        ),
        row(
          field('HP', number(member.baseHp, 1, 255, (v) => setMember(index, 'baseHp', v))),
          field('+ / level', number(member.hpPerLevel, 0, 32, (v) => setMember(index, 'hpPerLevel', v))),
          field('MP', number(member.baseMp, 0, 255, (v) => setMember(index, 'baseMp', v))),
          field('+ / level', number(member.mpPerLevel, 0, 32, (v) => setMember(index, 'mpPerLevel', v)))
        ),
        row(
          field('Attack', number(member.baseAtk, 0, 255, (v) => setMember(index, 'baseAtk', v))),
          field('+ / level', number(member.atkPerLevel, 0, 32, (v) => setMember(index, 'atkPerLevel', v))),
          field('Defence', number(member.baseDef, 0, 255, (v) => setMember(index, 'baseDef', v))),
          field('+ / level', number(member.defPerLevel, 0, 32, (v) => setMember(index, 'defPerLevel', v)))
        ),
        row(
          field('Speed', number(member.speed, 0, 255, (v) => setMember(index, 'speed', v))),
          field('Accuracy', number(member.acc, 0, 255, (v) => setMember(index, 'acc', v))),
          field('Evasion', number(member.eva, 0, 255, (v) => setMember(index, 'eva', v)))
        ),
        el(
          'div',
          null,
          el('span.field-label', null, 'Learns'),
          spells.length
            ? spells.map((spell, spellIndex) => {
                const learned = member.spells.find((entry) => entry.spellId === spell.id);
                return row(
                  el(
                    'label.check',
                    { style: { flex: '1' } },
                    el('input', {
                      type: 'checkbox',
                      checked: Boolean(learned),
                      // A member can only carry eight, because the engine holds
                      // what they know in one bitmask byte per level.
                      disabled: !learned && spellIndex >= 8,
                      onchange: (event) => {
                        store.commit('Change learned spells', (project) => {
                          const list = project.party[index].spells;
                          if (event.target.checked) list.push({ spellId: spell.id, level: 1 });
                          else {
                            const at = list.findIndex((entry) => entry.spellId === spell.id);
                            if (at >= 0) list.splice(at, 1);
                          }
                        });
                        rerender();
                      }
                    }),
                    ` ${spell.name}`
                  ),
                  learned
                    ? field(
                        'at level',
                        number(learned.level, 1, store.project.rpg.maxLevel, (value) => {
                          store.commit('Change learned spells', (project) => {
                            const entry = project.party[index].spells.find((item) => item.spellId === spell.id);
                            if (entry) entry.level = value;
                          });
                          rerender();
                        })
                      )
                    : null
                );
              })
            : el('p.hint', null, 'No spells defined yet.')
        )
      )
    ),
    row(
      el(
        'button.btn.btn-sm',
        {
          disabled: party.length >= RPG_LIMITS.party,
          onclick: () => {
            store.commit('Add party member', (project) => {
              project.party.push(createPartyMember(project.party.length));
            });
            rerender();
          }
        },
        '+ Member'
      ),
      el('button.btn.btn-sm', { onclick: () => app.goTo('magic') }, 'Manage spells in the Magic Forge →')
    )
  );
}

