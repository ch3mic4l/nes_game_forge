// Character Forge — the party a project fights alongside, on either game
// type. An action project always has exactly one character (the hero); a
// turn-based RPG can hold up to RPG_LIMITS.party. Name, drawn-as sprite,
// starts-in-party, stats and learned spells moved here verbatim from the
// Sprite Forge's own Party tab (renderer/forges/sprite/battle.js, deleted);
// an actor's own battle stats stay on the Monster Forge, and the catalog of
// spells stays on the Magic Forge -- see docs/design-character-forge.md.

import { store } from '../../store.js';
import { el, fill, field } from '../../ui.js';
import { tileFromString, BLANK_TILE } from '../../../shared/chr.js';
import { NES_PALETTE } from '../../../shared/nespalette.js';
import {
  RPG_LIMITS,
  createPartyMember,
  characterCap,
  normalizeCharacterName,
  renumberPartyMemberDeletion,
  tilesetAt,
  storageIndex
} from '../../../shared/project.js';
import { drawMetaspritePreview } from '../../widgets/metasprite.js';

const number = (value, min, max, onChange, title = null) =>
  el('input', {
    type: 'number',
    min,
    max,
    value,
    title,
    onchange: (event) => onChange(Math.max(min, Math.min(max, Number(event.target.value))))
  });

const row = (...children) => el('div.field-row', { style: { gap: '8px', marginBottom: '6px' } }, ...children);

// The player's own "Down 1" frame (direction 0, walk frame 0) -- a single,
// representative pose, not the full 8-frame grid the Tile Forge's own Player
// view edits. Read-only: nothing here writes project.sprites.playerTiles.
const FIELD_SPRITE_FRAME = 0;

function drawFieldSprite(canvas) {
  const zoom = 4;
  canvas.width = 16;
  canvas.height = 16;
  canvas.style.width = `${16 * zoom}px`;
  canvas.style.height = `${16 * zoom}px`;
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  const image = context.createImageData(16, 16);
  const colors = store.project.palettes.sprite[0].map((index) => NES_PALETTE[index & 0x3f]);
  const playerTiles = store.project.sprites.playerTiles;
  const data = image.data;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const index = storageIndex(FIELD_SPRITE_FRAME, Math.floor(y / 8), Math.floor(x / 8));
      const pixels = tileFromString(playerTiles[index] ?? BLANK_TILE);
      const slot = pixels[(y % 8) * 8 + (x % 8)];
      const offset = (y * 16 + x) * 4;
      const color = colors[slot];
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = slot === 0 ? 0 : 255; // player art is always transparent-zero
    }
  }
  context.putImageData(image, 0, 0);
}

function drawBattleSprite(canvas, metasprite) {
  const tileset = tilesetAt(store.project, store.project.rpg.battleTilesetId);
  const decodedTiles = tileset.sprites.tiles.map(tileFromString);
  drawMetaspritePreview(canvas, metasprite, decodedTiles, store.project.palettes.sprite);
}

export function mount(container, app) {
  const state = { selected: 0 };

  const listHost = el('div');
  const detailHost = el('div');

  function setMember(index, key, value) {
    store.commit('Change character', (project) => {
      project.party[index][key] = value;
    });
    render();
  }

  function setName(index, raw) {
    store.commit('Change character name', (project) => {
      const member = project.party[index];
      member.name = normalizeCharacterName(raw, createPartyMember(index).name);
    });
    render();
  }

  function addMember() {
    // Guarded before store.commit, not inside it -- the disabled button
    // already keeps ordinary access away from this, but a no-op commit would
    // still record an undo entry and mark the project dirty for nothing.
    if (store.project.party.length >= characterCap(store.project.project.gameType)) return;
    store.commit('Add character', (project) => {
      project.party.push(createPartyMember(project.party.length));
    });
    state.selected = store.project.party.length - 1;
    render();
  }

  function removeMember(index) {
    store.commit('Remove character', (project) => {
      // Either order gives the same answer (renumberPartyMemberDeletion's own
      // comment, moved verbatim from battle.js) -- doing it first keeps this
      // in step with the actor/item/spell delete handlers' own contract.
      renumberPartyMemberDeletion(project, index);
      project.party.splice(index, 1);
      project.party.forEach((entry, id) => (entry.id = id));
    });
    if (state.selected >= index) state.selected = Math.max(0, state.selected - 1);
    render();
  }

  function renderList() {
    const { party } = store.project;
    const gameType = store.project.project.gameType;
    const cap = characterCap(gameType);
    const atCap = party.length >= cap;
    fill(
      listHost,
      el(
        'div.field-row',
        { style: { marginBottom: '8px' } },
        el(
          'select',
          {
            size: Math.min(10, Math.max(4, party.length)),
            style: { minWidth: '200px' },
            onchange: (event) => {
              state.selected = Number(event.target.value);
              render();
            }
          },
          party.map((member, index) => el('option', { value: index, selected: index === state.selected }, member.name))
        )
      ),
      row(
        el(
          'button.btn.btn-sm',
          {
            disabled: atCap,
            title: atCap
              ? gameType !== 'rpg'
                ? 'An action game has one character; nothing in the engine can draw or fight a second.'
                : `The party holds ${RPG_LIMITS.party} members.`
              : null,
            onclick: addMember
          },
          '+ Character'
        ),
        party.length > 1
          ? el(
              'button.btn.btn-sm',
              { title: 'Remove', onclick: () => removeMember(state.selected) },
              '✕ Remove'
            )
          : null
      )
    );
  }

  function renderStats(member, index) {
    const { spells } = store.project;
    return el(
      'div',
      { style: { marginTop: '12px' } },
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
        field('Magic', number(member.baseMag, 0, 255, (v) => setMember(index, 'baseMag', v))),
        field('+ / level', number(member.magPerLevel, 0, 16, (v) => setMember(index, 'magPerLevel', v)))
      ),
      row(
        field('Magic defence', number(member.baseMdef, 0, 255, (v) => setMember(index, 'baseMdef', v))),
        field('+ / level', number(member.mdefPerLevel, 0, 16, (v) => setMember(index, 'mdefPerLevel', v)))
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
                      render();
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
                        render();
                      })
                    )
                  : null
              );
            })
          : el('p.hint', null, 'No spells defined yet.')
      ),
      row(el('button.btn.btn-sm', { onclick: () => app.goTo('magic') }, 'Manage spells in the Magic Forge →'))
    );
  }

  function renderDetail() {
    const { party } = store.project;
    const gameType = store.project.project.gameType;
    const isRpg = gameType === 'rpg';
    const index = state.selected;
    const member = party[index];
    if (!member) {
      fill(detailHost, el('p.hint', null, 'No characters yet.'));
      return;
    }

    const startsInPartyInert = index > 0 && member.startsInParty;

    fill(
      detailHost,
      row(
        field(
          'Name',
          el('input', {
            type: 'text',
            value: member.name,
            maxlength: RPG_LIMITS.nameLength,
            title: `Letters only, up to ${RPG_LIMITS.nameLength} characters`,
            onchange: (event) => setName(index, event.target.value)
          })
        )
      ),
      row(
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
        el(
          'label.check',
          {
            title: startsInPartyInert
              ? 'Starts in the party, so is never recruited by a Join; only the hero is named at new game.'
              : 'Lets the player type this character’s name, at new game (member 0) or when a Join recruits them'
          },
          el('input', {
            type: 'checkbox',
            checked: member.renamable,
            disabled: startsInPartyInert,
            onchange: (event) => setMember(index, 'renamable', event.target.checked)
          }),
          ' Renamable'
        )
      ),
      el('div.field-row', { style: { gap: '24px', alignItems: 'flex-start', marginTop: '12px' } },
        // Only member 0 walks the field -- the engine draws every other
        // recruit exclusively from their own battle metasprite, so a
        // recruit's card shows no field-sprite section at all (design
        // §4: "the hero's own card shows both sprites").
        index === 0
          ? (() => {
              const fieldCanvas = el('canvas.pixels');
              drawFieldSprite(fieldCanvas);
              return el(
                'div',
                null,
                el('div.field-label', null, 'Field sprite'),
                fieldCanvas,
                el(
                  'button.btn.btn-sm',
                  { style: { marginTop: '6px' }, onclick: () => app.goTo('tile', { mode: 'player' }) },
                  'Edit in the Tile Forge →'
                )
              );
            })()
          : null,
        isRpg
          ? (() => {
              const metasprite = store.project.sprites.metasprites[member.metaspriteId] ?? null;
              const battleCanvas = el('canvas.pixels');
              drawBattleSprite(battleCanvas, metasprite);
              return el(
                'div',
                null,
                el('div.field-label', null, 'Battle sprite'),
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
                ),
                battleCanvas
              );
            })()
          : null
      ),
      isRpg
        ? renderStats(member, index)
        : el('p.hint', { style: { marginTop: '12px' } }, 'Stats are used by the turn-based battle system only.')
    );
  }

  function render() {
    // Clamped here, before either pane draws, so an external change to
    // party.length (an undo/redo, another commit) that leaves state.selected
    // out of range cannot show the list with nothing selected while the
    // detail pane still shows the previously-selected member.
    const { party } = store.project;
    if (state.selected >= party.length) state.selected = Math.max(0, party.length - 1);
    renderList();
    renderDetail();
  }

  const root = el(
    'div.forge',
    { style: { gridTemplateColumns: '240px 1fr' } },
    el(
      'div.panel',
      null,
      el('div.panel-head', null, 'Characters'),
      el('div.panel-body', null, listHost)
    ),
    el(
      'div.panel',
      { style: { borderRight: 'none' } },
      el('div.panel-head', null, 'Character Forge'),
      el('div.panel-body', null, detailHost)
    )
  );

  container.append(root);
  render();
  app.setMeta('Character Forge');

  return {
    destroy() {
      app.setMeta('');
    },
    onProjectChange: render
  };
}
