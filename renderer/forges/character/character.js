// Character Forge — the party a project fights alongside, on either game
// type. An action project always has exactly one character (the hero); a
// turn-based RPG can hold up to RPG_LIMITS.party. Name, drawn-as sprite,
// starts-in-party, stats and learned spells moved here verbatim from the
// Sprite Forge's own Party tab (renderer/forges/sprite/battle.js, deleted);
// an actor's own battle stats stay on the Monster Forge, and the catalog of
// spells stays on the Magic Forge -- see docs/design-character-forge.md.

import { store } from '../../store.js';
import { el, fill, field, showModal } from '../../ui.js';
import { tileFromString, BLANK_TILE } from '../../../shared/chr.js';
import { NES_PALETTE } from '../../../shared/nespalette.js';
import {
  RPG_LIMITS,
  GROWTH_LIMITS,
  GROWTH_STATS,
  GROWTH_SHAPES,
  GROWTH_HORIZON_LEVEL,
  clampGrowthValue,
  createGrowthProfile,
  effectiveGrowth,
  memberStatAt,
  profileStatAt,
  growthProfileUsers,
  renumberGrowthProfileDeletion,
  createPartyMember,
  characterCap,
  normalizeCharacterName,
  renumberPartyMemberDeletion,
  EQUIP_SLOTS,
  tilesetAt,
  storageIndex
} from '../../../shared/project.js';
import { drawMetaspritePreview } from '../../widgets/metasprite.js';
import { mountBattleFxPreview, animationSelect } from '../../widgets/battlefxpreview.js';
import { commitAddMember, commitStartEquip, slotLabel, wearableCount, wearablePieces } from '../items/equipui.js';

// `focusKey` marks a control render() must hand focus back to after it rebuilds the pane (see focusSnapshot).
const number = (value, min, max, onChange, title = null, focusKey = null) =>
  el('input', {
    type: 'number',
    dataset: focusKey ? { focus: focusKey } : null,
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
  const state = { selected: 0, profile: 0, profilesOpen: false };

  const listHost = el('div');

  // A persistent fields/preview split (docs/design-battle-animation.md
  // §16.8, §15.5's own precedent): detailHost is replaceable on every
  // render(), previewHost is handed to mountBattleFxPreview ONCE at mount
  // and never touched by fill() again. Unlike Magic/Monster, this Forge
  // mounts on BOTH game types, so previewHost's own visibility is toggled
  // by render() (isRpg ? '' : 'none') rather than always shown -- a style
  // toggle, never a mount/unmount cycle, so the widget's own playback state
  // survives switching between an RPG's Character Forge and an action
  // project's.
  const detailBody = el('div.panel-body');
  const detailHost = el('div');
  const previewHost = el('div', { style: { marginTop: '16px', maxWidth: '360px' } });
  fill(detailBody, detailHost, previewHost);

  const preview = mountBattleFxPreview(previewHost, {
    getProject: () => store.project,
    getAnimationId: () => {
      if (store.project.project.gameType !== 'rpg') return null;
      return store.project.party[state.selected]?.attackAnim ?? null;
    }
  });

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
    // One commit: the new member and every "everyone" piece's grant of them (grantNewMember), so one undo takes both back.
    commitAddMember(store);
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
    const { spells, growthProfiles } = store.project;
    const profile = growthProfiles[member.profileId] ?? null;
    const effective = effectiveGrowth(store.project, member);
    // A profile's per-level number is the average through level 15 (R3), so a profile-backed member's readout says so; Custom is linear.
    const perLevelLabel = profile ? `Avg / level to Lv ${GROWTH_HORIZON_LEVEL}` : '+ / level';
    // While a profile is assigned the twelve inputs show what the build will use and cannot be edited; the member's own numbers stay in
    // the project untouched (the input's onchange can never fire while disabled) and come back on Custom.
    const lock = (stat, kind, input) => {
      if (!profile) return input;
      input.value = String(effective[stat][kind]);
      input.disabled = true;
      input.classList.add('growth-locked');
      input.title = `From growth profile "${profile.name}" -- choose Custom to edit this member's own numbers`;
      return input;
    };
    return el(
      'div',
      { style: { marginTop: '12px' } },
      row(
        field(
          'Growth',
          el(
            'select',
            { dataset: { focus: 'member-growth' }, onchange: (event) => setGrowth(index, event.target.value === '' ? null : Number(event.target.value)) },
            el('option', { value: '', selected: !profile }, 'Custom (own numbers)'),
            growthProfiles.map((entry, id) => el('option', { value: id, selected: id === member.profileId }, entry.name))
          )
        ),
        profile
          ? el(
              'button.btn.btn-sm',
              {
                title: 'Open this profile in the Growth profiles section',
                onclick: () => {
                  state.profile = member.profileId;
                  state.profilesOpen = true;
                  render();
                }
              },
              'Edit profile ↑'
            )
          : null,
        el(
          'span.hint',
          null,
          profile
            ? `Stats come from "${profile.name}"; this member's own numbers are kept and return on Custom.`
            : growthProfiles.length
              ? 'Custom: this member uses the numbers below.'
              : 'No growth profiles yet; add one under Growth profiles above.'
        )
      ),
      row(
        field('HP', lock('hp', 'base', number(member.baseHp, GROWTH_LIMITS.hp.baseMin, GROWTH_LIMITS.hp.baseMax, (v) => setMember(index, 'baseHp', v)))),
        field(perLevelLabel, lock('hp', 'perLevel', number(member.hpPerLevel, GROWTH_LIMITS.hp.perLevelMin, GROWTH_LIMITS.hp.perLevelMax, (v) => setMember(index, 'hpPerLevel', v)))),
        field('MP', lock('mp', 'base', number(member.baseMp, GROWTH_LIMITS.mp.baseMin, GROWTH_LIMITS.mp.baseMax, (v) => setMember(index, 'baseMp', v)))),
        field(perLevelLabel, lock('mp', 'perLevel', number(member.mpPerLevel, GROWTH_LIMITS.mp.perLevelMin, GROWTH_LIMITS.mp.perLevelMax, (v) => setMember(index, 'mpPerLevel', v))))
      ),
      row(
        field('Attack', lock('atk', 'base', number(member.baseAtk, GROWTH_LIMITS.atk.baseMin, GROWTH_LIMITS.atk.baseMax, (v) => setMember(index, 'baseAtk', v)))),
        field(perLevelLabel, lock('atk', 'perLevel', number(member.atkPerLevel, GROWTH_LIMITS.atk.perLevelMin, GROWTH_LIMITS.atk.perLevelMax, (v) => setMember(index, 'atkPerLevel', v)))),
        field('Defence', lock('def', 'base', number(member.baseDef, GROWTH_LIMITS.def.baseMin, GROWTH_LIMITS.def.baseMax, (v) => setMember(index, 'baseDef', v)))),
        field(perLevelLabel, lock('def', 'perLevel', number(member.defPerLevel, GROWTH_LIMITS.def.perLevelMin, GROWTH_LIMITS.def.perLevelMax, (v) => setMember(index, 'defPerLevel', v))))
      ),
      row(
        field('Magic', lock('mag', 'base', number(member.baseMag, GROWTH_LIMITS.mag.baseMin, GROWTH_LIMITS.mag.baseMax, (v) => setMember(index, 'baseMag', v)))),
        field(perLevelLabel, lock('mag', 'perLevel', number(member.magPerLevel, GROWTH_LIMITS.mag.perLevelMin, GROWTH_LIMITS.mag.perLevelMax, (v) => setMember(index, 'magPerLevel', v))))
      ),
      row(
        field('Magic defence', lock('mdef', 'base', number(member.baseMdef, GROWTH_LIMITS.mdef.baseMin, GROWTH_LIMITS.mdef.baseMax, (v) => setMember(index, 'baseMdef', v)))),
        field(perLevelLabel, lock('mdef', 'perLevel', number(member.mdefPerLevel, GROWTH_LIMITS.mdef.perLevelMin, GROWTH_LIMITS.mdef.perLevelMax, (v) => setMember(index, 'mdefPerLevel', v))))
      ),
      el('div.field-label', null, `Stats by level${profile ? ` (profile "${profile.name}")` : ' (own numbers)'}`),
      previewTable((stat, level) => memberStatAt(store.project, member, stat, level)),
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
      row(el('button.btn.btn-sm', { onclick: () => app.goTo('magic') }, 'Manage spells in the Magic Forge →')),
      renderStartEquip(member, index)
    );
  }

  // ---- Growth profiles (docs/design-growth-profiles.md; handoff-next/classes/design.md sec 5) ----------------------------------------
  // Up to RPG_LIMITS.growthProfiles named curves a member may reference instead of its own numbers. The generator reads them through
  // effectiveGrowth / memberStatAt (shared/project.js), and so does every preview here, so the table cannot disagree with the ROM.

  const STAT_LABELS = { hp: 'HP', mp: 'MP', atk: 'Attack', def: 'Defence', mag: 'Magic', mdef: 'Magic defence' };
  const SHAPE_LABELS = { linear: 'Linear', early: 'Early bloomer', late: 'Late bloomer' };

  /** Levels 1..rpg.maxLevel across, the six stats down; a cell at the 255 ceiling is marked. `valueAt(stat, level)` is the only input. */
  function previewTable(valueAt) {
    const levels = Array.from({ length: store.project.rpg.maxLevel }, (_, i) => i + 1);
    return el(
      'table.growth-table.growth-preview',
      null,
      el('thead', null, el('tr', null, el('th', null, 'Level'), levels.map((level) => el('th', null, level)))),
      el(
        'tbody',
        null,
        GROWTH_STATS.map((stat) =>
          el(
            'tr',
            { dataset: { stat } },
            el('th', null, STAT_LABELS[stat]),
            levels.map((level) => {
              const value = valueAt(stat, level);
              return el('td', { class: value === 255 ? 'cap' : '', title: value === 255 ? 'At the 255 ceiling' : null }, value);
            })
          )
        )
      )
    );
  }

  function setGrowth(index, profileId) {
    deferred(() => {
      store.commit('Change character', (project) => {
        project.party[index].profileId = profileId;
      });
      refresh();
    });
  }

  function setProfileField(index, stat, key, value) {
    deferred(() => commitProfileField(index, stat, key, value));
  }

  function commitProfileField(index, stat, key, value) {
    const record = store.project.growthProfiles[index][stat];
    // Base and per-level are integers in GROWTH_LIMITS, exactly as the normalizer keeps them: 24.6 is 25 here, not 24.6 until a reload.
    const next = key === 'shape' ? value : clampGrowthValue(stat, key, value, record[key]);
    if (next === record[key]) {
      refresh(); // nothing changed (24.4 rounds back to 24): no undo entry, but show the stored value again
      return;
    }
    store.commit('Change growth profile', (project) => {
      project.growthProfiles[index][stat][key] = next;
    });
    refresh();
  }

  function addProfile() {
    if (store.project.growthProfiles.length >= RPG_LIMITS.growthProfiles) return;
    store.commit('Add growth profile', (project) => {
      project.growthProfiles.push(createGrowthProfile(project.growthProfiles.length, `Profile ${project.growthProfiles.length + 1}`));
    });
    state.profile = store.project.growthProfiles.length - 1;
    state.profilesOpen = true;
    render();
  }

  function duplicateProfile(index) {
    if (store.project.growthProfiles.length >= RPG_LIMITS.growthProfiles) return;
    store.commit('Duplicate growth profile', (project) => {
      const copy = structuredClone(project.growthProfiles[index]);
      copy.id = project.growthProfiles.length;
      copy.name = `${copy.name} copy`.slice(0, 40);
      project.growthProfiles.push(copy);
    });
    state.profile = store.project.growthProfiles.length - 1;
    render();
  }

  function renameProfile(index, raw) {
    deferred(() => commitRename(index, raw));
  }

  function commitRename(index, raw) {
    const text = String(raw).trim().slice(0, 40);
    if (!text) {
      refresh(); // an empty name is not a rename: put the old one back
      return;
    }
    store.commit('Rename growth profile', (project) => {
      project.growthProfiles[index].name = text;
    });
    refresh();
  }

  // R2: a profile some member still uses cannot be deleted. The members are named, nothing is committed, and the author unassigns first.
  async function deleteProfile(index) {
    const users = growthProfileUsers(store.project, index);
    if (users.length) {
      await showModal({
        title: 'Cannot delete this profile',
        body: el('p', null, `Used by ${users.map((member) => member.name).join(', ')}. Set their Growth to Custom first.`),
        actions: [{ label: 'OK', primary: true }]
      });
      return;
    }
    store.commit('Delete growth profile', (project) => {
      // Throws if a member still references the index, so a skipped refusal can never silently null one (shared/project.js).
      renumberGrowthProfileDeletion(project, index);
      project.growthProfiles.splice(index, 1);
      project.growthProfiles.forEach((entry, id) => (entry.id = id));
    });
    if (state.profile >= index) state.profile = Math.max(0, state.profile - 1);
    render();
  }

  function renderProfiles() {
    const { growthProfiles } = store.project;
    const atCap = growthProfiles.length >= RPG_LIMITS.growthProfiles;
    const index = Math.min(state.profile, growthProfiles.length - 1);
    const profile = growthProfiles[index] ?? null;
    return el(
      'details.growth-profiles',
      {
        open: state.profilesOpen,
        ontoggle: (event) => (state.profilesOpen = event.target.open)
      },
      el('summary', null, `Growth profiles (${growthProfiles.length}/${RPG_LIMITS.growthProfiles})`),
      el(
        'p.hint',
        null,
        'A profile is a named growth curve a party member can use instead of its own numbers. A shape moves only the levels in between: ' +
          `every shape reaches base + ${GROWTH_HORIZON_LEVEL - 1} × (average per level) at level ${GROWTH_HORIZON_LEVEL}, whatever the level cap.`
      ),
      row(
        el(
          'select',
          {
            size: Math.min(8, Math.max(3, growthProfiles.length)),
            style: { minWidth: '200px' },
            title: 'Growth profiles',
            dataset: { focus: 'pf-list' },
            onchange: (event) => {
              deferred(() => {
                state.profile = Number(event.target.value);
                refresh();
              });
            }
          },
          growthProfiles.map((entry, id) => el('option', { value: id, selected: id === index }, entry.name))
        ),
        el(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
          el(
            'button.btn.btn-sm',
            {
              disabled: atCap,
              dataset: { focus: 'pf-add' },
              title: atCap ? `A project holds ${RPG_LIMITS.growthProfiles} growth profiles.` : null,
              onclick: addProfile
            },
            '+ Profile'
          ),
          profile
            ? el('button.btn.btn-sm', { disabled: atCap, dataset: { focus: 'pf-duplicate' }, title: 'Duplicate this profile', onclick: () => duplicateProfile(index) }, 'Duplicate')
            : null,
          profile ? el('button.btn.btn-sm', { dataset: { focus: 'pf-delete' }, title: 'Delete profile', onclick: () => deleteProfile(index) }, '✕ Delete') : null
        )
      ),
      profile
        ? [
            row(
              el('span.field-label', null, 'Profile name'),
              el('input', {
                type: 'text',
                value: profile.name,
                maxlength: 40,
                title: 'Profile name',
                dataset: { focus: 'pf-name' },
                onchange: (event) => renameProfile(index, event.target.value)
              })
            ),
            el(
              'table.growth-table.growth-edit',
              null,
              el(
                'thead',
                null,
                el(
                  'tr',
                  null,
                  el('th', null, 'Stat'),
                  el('th', null, 'Base'),
                  el('th', { title: `Average gain per level through level ${GROWTH_HORIZON_LEVEL}` }, `Avg / level to Lv ${GROWTH_HORIZON_LEVEL}`),
                  el('th', null, 'Shape')
                )
              ),
              el(
                'tbody',
                null,
                GROWTH_STATS.map((stat) => {
                  const record = profile[stat];
                  const limits = GROWTH_LIMITS[stat];
                  return el(
                    'tr',
                    { dataset: { stat } },
                    el('th', null, STAT_LABELS[stat]),
                    el('td', null, number(record.base, limits.baseMin, limits.baseMax, (v) => setProfileField(index, stat, 'base', v), null, `pf-${stat}-base`)),
                    el('td', null, number(record.perLevel, limits.perLevelMin, limits.perLevelMax, (v) => setProfileField(index, stat, 'perLevel', v), null, `pf-${stat}-perLevel`)),
                    el(
                      'td',
                      null,
                      el(
                        'select',
                        { dataset: { focus: `pf-${stat}-shape` }, onchange: (event) => setProfileField(index, stat, 'shape', event.target.value) },
                        GROWTH_SHAPES.map((shape) => el('option', { value: shape, selected: shape === record.shape }, SHAPE_LABELS[shape]))
                      )
                    )
                  );
                })
              )
            ),
            el('div.field-label', null, `Stats by level (profile "${profile.name}")`),
            previewTable((stat, level) => profileStatAt(profile[stat], level))
          ]
        : el('p.hint', null, 'No growth profiles yet. Add one, then choose it under Growth on a character.')
    );
  }

  // Starting equipment (docs/design-equipment.md section 7): worn at New Game, not in the bag. Each slot lists only the pieces of
  // that slot this member may wear. A value the list no longer offers (a hand-edited project) is kept visible and marked, so the
  // select never shows None while the project says otherwise; validateProject names it as an error.
  function renderStartEquip(member, index) {
    const project = store.project;
    const count = wearableCount(project, index);
    return el(
      'div',
      { style: { marginTop: '12px' } },
      el('span.field-label', null, 'Starting equipment'),
      row(
        EQUIP_SLOTS.map((_, slot) => {
          const choices = wearablePieces(project, index, slot);
          const current = member.startEquip?.[slot] ?? null;
          const stale = current !== null && !choices.some((choice) => choice.id === current);
          return field(
            slotLabel(slot),
            el(
              'select',
              {
                onchange: (event) => {
                  commitStartEquip(store, index, slot, event.target.value === '' ? null : Number(event.target.value));
                  render();
                }
              },
              el('option', { value: '', selected: current === null }, 'None'),
              stale
                ? el('option', { value: current, selected: true }, `${project.items[current]?.name ?? `Item ${current}`} (not allowed)`)
                : null,
              choices.map((choice) => el('option', { value: choice.id, selected: choice.id === current }, choice.name))
            )
          );
        })
      ),
      row(
        el('span.hint', null, `Can wear ${count} piece${count === 1 ? '' : 's'}`),
        el('button.btn.btn-sm', { onclick: () => app.goTo('items') }, 'Manage equipment in the Items Forge →')
      )
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
      isRpg ? renderProfiles() : null,
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
          : null,
        isRpg
          ? el(
              'div',
              null,
              el('div.field-label', null, 'Attack animation'),
              animationSelect(store.project, member.attackAnim ?? null, (value) => setMember(index, 'attackAnim', value))
            )
          : null
      ),
      isRpg
        ? renderStats(member, index)
        : el('p.hint', { style: { marginTop: '12px' } }, 'Stats are used by the turn-based battle system only.')
    );
  }

  // render() replaces every control with fill(), so a control that has focus is gone when it returns. The profile editor's controls carry a
  // data-focus key: render() notes the focused one (and a text caret) and focuses the rebuilt equivalent.
  function focusSnapshot() {
    const active = document.activeElement;
    if (!active?.dataset?.focus || !detailHost.contains(active)) return null;
    const text = active.type === 'text';
    return { key: active.dataset.focus, start: text ? active.selectionStart : null, end: text ? active.selectionEnd : null };
  }

  function restoreFocus(snapshot) {
    if (!snapshot) return;
    const node = detailHost.querySelector(`[data-focus="${snapshot.key}"]`);
    if (!node || node.disabled) return;
    node.focus();
    if (snapshot.start !== null) node.setSelectionRange(snapshot.start, snapshot.end);
  }

  // A rebuild while a keyed control is focused waits for the event that asked for it to finish: replacing the node inside its own change
  // event (which a Tab fires before it moves focus) strands the Tab, and focus lands on the body instead of the next field.
  // A change event from a Tab fires after the browser has already cleared document.activeElement, so "is a keyed control focused?" cannot see
  // it: the handlers of the keyed controls say so with deferred(), which also covers the store's own notification inside their commit.
  //
  // A rebuild also waits while a pointer button is down. Leaving the name field for a button commits the name at mouse-down, and a rebuild
  // then would remove the button before its mouse-up, so the click would never happen (a focus key cannot bring back a press that already
  // lost its target). The held rebuild runs once the press has finished and its click has been delivered.
  let pendingRefresh = null;
  let deferring = false;
  let pointerHeld = false;
  let refreshWaiting = false;
  // Set by destroy(): a timer or a late call on a destroyed mount must not rebuild its detached subtree (or, with the project closed or
  // another one open, read a project this mount no longer belongs to). The release timer is tracked so destroy() can cancel it, and a
  // repeated up / cancel / blur while it is queued rides on the one already waiting.
  let disposed = false;
  let pointerTimer = null;
  const onPointerDown = () => {
    pointerHeld = true;
  };
  const onPointerUp = () => {
    if (disposed || pointerTimer !== null) return;
    // The click is dispatched with the mouse-up, so a timer lands after it.
    pointerTimer = setTimeout(() => {
      pointerTimer = null;
      if (disposed) return;
      pointerHeld = false;
      if (refreshWaiting) {
        refreshWaiting = false;
        render();
      }
    }, 0);
  };
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('pointercancel', onPointerUp, true);
  window.addEventListener('blur', onPointerUp);
  function deferred(run) {
    deferring = true;
    try {
      run();
    } finally {
      deferring = false;
    }
  }
  function refresh() {
    if (disposed) return;
    if (pointerHeld) {
      refreshWaiting = true;
      return;
    }
    if (!deferring && !focusSnapshot()) {
      render();
      return;
    }
    if (pendingRefresh === null) {
      pendingRefresh = setTimeout(() => {
        pendingRefresh = null;
        if (disposed) return;
        if (pointerHeld) refreshWaiting = true;
        else render();
      }, 0);
    }
  }

  function render() {
    if (disposed) return;
    const focused = focusSnapshot();
    // Clamped here, before either pane draws, so an external change to
    // party.length (an undo/redo, another commit) that leaves state.selected
    // out of range cannot show the list with nothing selected while the
    // detail pane still shows the previously-selected member.
    const { party } = store.project;
    if (state.selected >= party.length) state.selected = Math.max(0, party.length - 1);
    renderList();
    renderDetail();
    restoreFocus(focused);

    // previewHost is never touched by fill() -- only its own visibility
    // toggles, so the widget's own internal playback state survives a
    // game-type check untouched (docs/design-battle-animation.md §16.8).
    const isRpg = store.project.project.gameType === 'rpg';
    previewHost.style.display = isRpg ? '' : 'none';
    preview.sync();
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
      detailBody
    )
  );

  container.append(root);
  render();
  app.setMeta('Character Forge');

  return {
    destroy() {
      disposed = true;
      clearTimeout(pendingRefresh);
      pendingRefresh = null;
      clearTimeout(pointerTimer);
      pointerTimer = null;
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerUp, true);
      window.removeEventListener('blur', onPointerUp);
      preview.destroy();
      app.setMeta('');
    },
    onProjectChange: refresh,
    stepPreview: () => (disposed ? undefined : preview.stepPreview())
  };
}
