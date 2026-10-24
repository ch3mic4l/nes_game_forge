// Monster Forge — everything about an actor that means something only in a
// battle: attack/defence/accuracy/evasion/speed, XP/gold, weak/resist, the
// spells it may cast, its drop, and its battle artwork. `hp` and `damage` stay
// on the Sprite Forge's general Actor panel because both are genuinely
// dual-purpose there (an action project's own enemies use them directly);
// see docs/design-monster.md §2 for the full boundary argument.
//
// The catalog this Forge lists is not "every hostile actor" — an actor
// still named by a map's encounter table, an encounter group or a Start a
// battle command stays listed and marked stranded even after its contact
// damage is cleared to zero, because that authored reference is still real,
// editable data. See monsterActorIds (shared/project.js).
//
// The Groups tab authors the project's encounter groups (up to four monsters
// each), which a map's group-mode table in the Map Forge then picks among. Its
// editing moves live in shared/encountergroups.js; this file only draws them.

import { store } from '../../store.js';
import { el, fill, field, showModal, confirmModal, toast } from '../../ui.js';
import {
  ELEMENTS,
  RPG_LIMITS,
  AUTHOR_NAME_MAX,
  isMonsterActor,
  itemPickerOptions,
  monsterActorIds,
  battleBlockIndices,
  describeBattleTileState,
  MONSTER_GROWTH_FIELDS,
  planMonsterGrowth,
  applyMonsterGrowth,
  ACTOR_BATTLE_DEFAULTS
} from '../../../shared/project.js';
import { monsterSeedSources } from './seed.js';
import {
  groupRoom,
  planAddGroup,
  applyAddGroup,
  commitGroupRename,
  setGroupMonster,
  deleteEncounterGroup,
  mapsUsingGroup,
  groupProblems,
  groupSlotOptions
} from '../../../shared/encountergroups.js';
import { FONT_BASE } from '../../../shared/font.js';
import { drawSheet, sheetIndexFromEvent, SHEET_COLS } from '../../widgets/sheet.js';
import { mountBattleFxPreview, animationSelect } from '../../widgets/battlefxpreview.js';

const number = (value, min, max, onChange, title = null) =>
  el('input', {
    type: 'number',
    min,
    max,
    value,
    title,
    onchange: (event) => onChange(Math.max(min, Math.min(max, Number(event.target.value))))
  });

// Same as number(...) above, but an empty input stores/renders null rather
// than 0 -- for a field like battle.level that means "not set," not "zero."
// An empty string or anything Number() can't parse into a finite value also
// stores null, never NaN: Chromium already sanitizes input[type=number] to
// '' for invalid text before onchange ever sees it, so this is defence in
// depth, not the normal path. Unlike normalizeActor's own on-disk garbage
// fallback (1, shared/project.js), unparseable input here means the author
// typed nothing usable, not "level 1."
// Rounds the parsed value (docs/design-monster-level-scaling.md §3.5) so a
// fractional Level typed here can never sit un-rounded in battle.level --
// planMonsterGrowth would otherwise have to treat a fractional stored level
// as if the button's own `!= null` enable check disagreed with it. Only
// caller today is the Level field below; a second one would need its own
// parameter rather than sharing this behaviour silently.
const numberOrNull = (value, min, max, onChange, title = null) =>
  el('input', {
    type: 'number',
    min,
    max,
    value: value === null || value === undefined ? '' : value,
    title,
    onchange: (event) => {
      const parsed = Number(event.target.value);
      onChange(
        event.target.value === '' || !Number.isFinite(parsed)
          ? null
          : Math.max(min, Math.min(max, Math.round(parsed)))
      );
    }
  });

const select = (options, value, onChange) =>
  el(
    'select',
    { onchange: (event) => onChange(event.target.value) },
    options.map((entry) => el('option', { value: entry.id, selected: entry.id === value }, entry.label))
  );

// The Derive modal's "Start from" picker: the first entry (no group) sits loose, every other entry sits under an <optgroup> of
// its own group name, in list order. No other Forge groups its options, so this stays local rather than shared.
const seedSelect = (sources, onChange) => {
  const groups = [];
  for (const source of sources.slice(1)) {
    let group = groups.find((entry) => entry.label === source.group);
    if (!group) groups.push((group = { label: source.group, sources: [] }));
    group.sources.push(source);
  }
  return el(
    'select',
    { onchange: (event) => onChange(event.target.value) },
    el('option', { value: sources[0].id, selected: true }, sources[0].label),
    groups.map((group) =>
      el(
        'optgroup',
        { label: group.label },
        group.sources.map((source) => el('option', { value: source.id }, source.label))
      )
    )
  );
};

// The Character Forge's own names for a growth shape (character.js), used only to say which curves Derive flattens.
const SEED_SHAPE_LABELS = { early: 'an Early bloomer', late: 'a Late bloomer' };

const joinWords = (words) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);

/** What the picker just filled in, in words: which stats were copied and what Derive does with a curved one (§4, §6, §8). */
function describeSeed(source) {
  if (source.kind === 'self') return 'Showing this monster’s current values as Base (+ / level 0).';
  if (source.kind === 'actor') return `Copied all seven numbers from ${source.name} as Base (+ / level 0).`;
  const labelFor = (key) => MONSTER_GROWTH_FIELDS.find((f) => f.key === key).label;
  // A curved seed names the curved stats (design §4's example); a linear one says generically what was copied.
  const curved = source.curves.map((curve) => labelFor(curve.key));
  const parts = [curved.length ? `Copied ${joinWords(curved)} from ${source.name}.` : `Copied the five growth stats from ${source.name}.`];
  if (source.curves.length) {
    const grows = source.curves.map((curve) => `${labelFor(curve.key)} grows as ${SEED_SHAPE_LABELS[curve.shape]}`);
    const many = source.curves.length > 1;
    parts.push(
      `${source.name}’s ${joinWords(grows)}; Derive grows ${many ? 'each' : 'it'} in a straight line, so ${many ? 'they' : 'the two'} agree at level 1 and level 15 and can differ in between.`
    );
  }
  parts.push('Experience and Gold keep this monster’s values.');
  return parts.join(' ');
}

const row = (...children) => el('div.field-row', { style: { gap: '8px', marginBottom: '6px' } }, ...children);

// The renderer default for each of the seven derivable stats -- read by
// battleSection's own per-field `?? default` widgets below. The derive modal's
// Base pre-fill reads the same table through seedMonsterGrowth
// (./seed.js), so the two numbers cannot drift apart (round-2 review
// finding 5). Keyed to match MONSTER_GROWTH_FIELDS (shared/project.js)
// exactly; not every battleSection field has an entry here, only the ones the
// derive modal also covers. Its
// values are ACTOR_BATTLE_DEFAULTS' (shared/project.js), not re-typed --
// battleSection's own remaining `?? N` widgets and battleTables
// (main/build/battletables.js) read that identical shared table too, so a
// never-saved actor built in-session compiles the same numbers this panel
// shows for it.
const BATTLE_DEFAULTS = {
  atk: ACTOR_BATTLE_DEFAULTS.atk,
  def: ACTOR_BATTLE_DEFAULTS.def,
  mp: ACTOR_BATTLE_DEFAULTS.mp,
  gold: ACTOR_BATTLE_DEFAULTS.gold,
  mag: ACTOR_BATTLE_DEFAULTS.mag,
  mdef: ACTOR_BATTLE_DEFAULTS.mdef,
  xp: ACTOR_BATTLE_DEFAULTS.xp
};

// Casts, Also, or, or, ... -- the label for each of RPG_LIMITS.monsterSpells
// spell slots (§8): the first two are distinct, every slot after repeats
// "or" since there is nothing more specific to say about a third or fourth
// alternative.
const SPELL_SLOT_LABELS = ['Casts', 'Also'];

/**
 * An actor's battle stats: what it is worth fighting, and what fighting it
 * costs. Moved verbatim from renderer/forges/sprite/battle.js (the design's
 * "shrinks, it does not empty out") -- `actor.battle ?? {}` and a per-field
 * `?? default` throughout is not a change made for this move, it is the
 * discipline this code already followed, now the one this whole Forge is
 * held to (docs/design-monster.md §2).
 */
export function battleSection(actor, index, rerender, openDerive) {
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

  // The spell list's own commit rule (docs/design-monster-spell-list.md §8):
  // derive the new array from the STORE's current battle.spellIds, never from
  // the other three <select> elements' DOM values -- a stale id in another
  // slot renders as "Nothing" (the browser's own default for an unmatched
  // <option>), so reading the DOM back would silently drop it. Setting a
  // slot writes the chosen id (or null for "Nothing") at that index, then
  // every empty entry -- interior gaps and trailing ones alike -- is
  // dropped, closing the list up. Duplicates are kept: they are the design's
  // weighting primitive, not accidental repeats to clean up.
  const spellSlotTooltip =
    'Cast about half the time while the MP above lasts, choosing at random among the affordable ones; otherwise it attacks';
  const spellSlot = (slot, label) =>
    field(
      label,
      el(
        'select',
        {
          'data-spell-slot': String(slot),
          title: spellSlotTooltip,
          onchange: (event) => {
            const chosen = event.target.value === '' ? null : Number(event.target.value);
            store.commit('Change battle stats', (project) => {
              const target = project.sprites.actors[index];
              const current = [...(target.battle?.spellIds ?? [])];
              current[slot] = chosen;
              target.battle = {
                ...target.battle,
                spellIds: current.filter((id) => id !== null && id !== undefined)
              };
            });
            rerender();
          }
        },
        el('option', { value: '', selected: (battle.spellIds ?? [])[slot] === undefined }, 'Nothing'),
        store.project.spells.map((spell, id) =>
          el('option', { value: id, selected: id === (battle.spellIds ?? [])[slot] }, spell.name)
        )
      )
    );

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
      field(
        'Level',
        numberOrNull(
          battle.level ?? null,
          1,
          RPG_LIMITS.maxLevel,
          (value) => set('level', value),
          'For your own reference only -- the battle system never reads this'
        )
      ),
      el(
        'button.btn.btn-sm',
        {
          style: { alignSelf: 'flex-end' },
          disabled: battle.level === null || battle.level === undefined,
          title:
            battle.level === null || battle.level === undefined
              ? 'Set a Level above first'
              : 'Fill in Attack, Defence, Magic, Magic defence, Magic points, Experience and Gold from a base value plus growth per level',
          onclick: () => openDerive(actor, index)
        },
        'Derive from level…'
      )
    ),
    row(
      field('Attack', number(battle.atk ?? BATTLE_DEFAULTS.atk, 0, 255, (value) => set('atk', value))),
      field('Defence', number(battle.def ?? BATTLE_DEFAULTS.def, 0, 255, (value) => set('def', value))),
      field('Speed', number(battle.speed ?? ACTOR_BATTLE_DEFAULTS.speed, 0, 255, (value) => set('speed', value))),
      field('Magic', number(battle.mag ?? BATTLE_DEFAULTS.mag, 0, 255, (value) => set('mag', value))),
      field('Magic defence', number(battle.mdef ?? BATTLE_DEFAULTS.mdef, 0, 255, (value) => set('mdef', value)))
    ),
    row(
      field('Accuracy', number(battle.acc ?? ACTOR_BATTLE_DEFAULTS.acc, 0, 255, (value) => set('acc', value), 'Out of 255')),
      field('Evasion', number(battle.eva ?? ACTOR_BATTLE_DEFAULTS.eva, 0, 255, (value) => set('eva', value))),
      field('Magic points', number(battle.mp ?? BATTLE_DEFAULTS.mp, 0, 255, (value) => set('mp', value)))
    ),
    row(
      field('Experience', number(battle.xp ?? BATTLE_DEFAULTS.xp, 0, 65535, (value) => set('xp', value))),
      field('Gold', number(battle.gold ?? BATTLE_DEFAULTS.gold, 0, 255, (value) => set('gold', value)))
    ),
    row(
      field('Weak to', select(ELEMENTS, battle.weak ?? 'none', (value) => set('weak', value))),
      field('Resists', select(ELEMENTS, battle.strong ?? 'none', (value) => set('strong', value)))
    ),
    row(
      ...Array.from({ length: RPG_LIMITS.monsterSpells }, (_, slot) =>
        spellSlot(slot, SPELL_SLOT_LABELS[slot] ?? 'or')
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
      field('Chance %', number(battle.dropPct ?? ACTOR_BATTLE_DEFAULTS.dropPct, 0, 100, (value) => set('dropPct', value)))
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
      field('Tiles across', number(battle.battleW ?? ACTOR_BATTLE_DEFAULTS.battleW, 1, RPG_LIMITS.battleArtTiles, (v) => set('battleW', v))),
      field('Tiles down', number(battle.battleH ?? ACTOR_BATTLE_DEFAULTS.battleH, 1, RPG_LIMITS.battleArtTiles, (v) => set('battleH', v))),
      field('Palette', number(battle.battlePalette ?? ACTOR_BATTLE_DEFAULTS.battlePalette, 0, 3, (value) => set('battlePalette', value))),
      field(
        'Attack animation',
        animationSelect(store.project, battle.attackAnim ?? null, (value) => set('attackAnim', value))
      )
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
  const palette = store.project.palettes.bg[battle.battlePalette ?? ACTOR_BATTLE_DEFAULTS.battlePalette] ?? store.project.palettes.bg[0];
  const width = battle.battleW ?? ACTOR_BATTLE_DEFAULTS.battleW;
  const height = battle.battleH ?? ACTOR_BATTLE_DEFAULTS.battleH;
  const fontRow = FONT_BASE / SHEET_COLS;
  const { hasBlock, label } = describeBattleTileState({ battle });

  const canvas = el('canvas.sheet', { style: { cursor: 'crosshair' } });
  drawSheet(canvas, tileset.background.tiles, palette, 2);
  const context = canvas.getContext('2d');
  const cell = 16; // 8 px at zoom 2
  context.fillStyle = 'rgba(0,0,0,0.55)';
  context.fillRect(0, fontRow * cell, canvas.width, canvas.height - fontRow * cell);
  context.strokeStyle = '#ff9d3c';
  context.lineWidth = 2;
  for (const index of battleBlockIndices({ battle })) {
    const col = index % SHEET_COLS;
    const row = Math.floor(index / SHEET_COLS);
    context.strokeRect(col * cell + 1, row * cell + 1, cell - 2, cell - 2);
  }
  canvas.addEventListener('pointerdown', (event) => {
    const index = sheetIndexFromEvent(event, canvas);
    const col = Math.min(index % SHEET_COLS, SHEET_COLS - width);
    const rowIndex = Math.max(0, Math.min(Math.floor(index / SHEET_COLS), fontRow - height));
    set('battleTile', rowIndex * SHEET_COLS + col);
  });

  return el(
    'div',
    { style: { marginBottom: '8px' } },
    el('div.sheet-wrap', null, canvas),
    row(
      el('span.hint', { style: { flex: '1', alignSelf: 'center' } }, label),
      !hasBlock ? null : el('button.btn.btn-sm', { onclick: () => set('battleTile', null) }, 'Use the animation')
    )
  );
}

export function mount(container, app) {
  const state = { selectedActorId: null, tab: 'monsters', group: 0 };
  // Set by destroy() below, read by openDeriveModal's own post-await guard
  // (docs/design-monster-level-scaling.md §3.8) -- a per-mount closure
  // variable, never module scope, so a fresh mount after destroy always
  // starts clean.
  let destroyed = false;

  // "Derive from level..." (ROADMAP item 14 point 2, phase 3): the modal's
  // own onClick returns only the raw { key: {base, perLevel} } pairs typed
  // into it -- nothing fallible, since showModal (renderer/ui.js) awaits
  // that callback before ever calling close(), and a throw there would
  // leave the dialog unresolved by the failed action until some later,
  // unrelated dismissal happened to settle it. Every fallible step -- the
  // three lifetime guards, planMonsterGrowth, the commit -- runs only
  // *after* the await, in one synchronous continuation with no further
  // await (design §3.1).
  async function openDeriveModal(actor, actorIndex) {
    const capturedActorId = actorIndex;
    const revisionAtOpen = store.revision;
    // Every pickable source is read once, here, into plain data (docs/design-monster-derive-seed.md §9): picking later reads
    // nothing from the store, so it cannot throw or disagree with its own label, and it never refreshes revisionAtOpen.
    // Entry 0 is this monster's own values -- the one source of the opening rows and of Clear -- and follows the same
    // `?? default` rule battleSection's widgets use (./seed.js, seedMonsterGrowth).
    const sources = monsterSeedSources(store.project, capturedActorId);
    const picked = {};
    const inputs = {};
    const note = el('p.hint', { style: { marginBottom: '10px' } }, describeSeed(sources[0]));
    // A programmatic .value write fires no `change`, so `picked` is set here as well as the inputs.
    const pickSource = (source) => {
      for (const f of MONSTER_GROWTH_FIELDS) {
        picked[f.key] = { ...source.rows[f.key] };
        inputs[f.key].base.value = picked[f.key].base;
        inputs[f.key].perLevel.value = picked[f.key].perLevel;
      }
      fill(note, describeSeed(source));
    };
    for (const f of MONSTER_GROWTH_FIELDS) picked[f.key] = { ...sources[0].rows[f.key] };

    const growth = await showModal({
      title: 'Derive stats from level',
      body: el(
        'div',
        null,
        el(
          'p.hint',
          { style: { marginBottom: '10px' } },
          'Base is the value this stat would have at level 1 -- the numbers shown are only a ' +
            'starting suggestion, not a remembered curve. Growth is never linked to a later Level ' +
            'edit: at level 12, Base 10 with + / level 2 gives 32; reopening this shows Base 32, ' +
            '+ / level 0 -- typing 2 again gives 54, not another 32.'
        ),
        field(
          'Start from',
          seedSelect(sources, (id) => pickSource(sources.find((source) => source.id === id)))
        ),
        note,
        ...MONSTER_GROWTH_FIELDS.map((f) => {
          inputs[f.key] = {
            base: number(picked[f.key].base, 0, f.ceiling, (v) => {
              picked[f.key].base = v;
            }),
            perLevel: number(picked[f.key].perLevel, 0, f.perLevelMax, (v) => {
              picked[f.key].perLevel = v;
            })
          };
          return row(field(f.label, inputs[f.key].base), field('+ / level', inputs[f.key].perLevel));
        })
      ),
      actions: [
        { label: 'Cancel', value: null },
        { label: 'Apply', primary: true, onClick: () => ({ ...picked }) }
      ]
    });

    if (!growth) return;
    if (destroyed) return;
    if (store.revision !== revisionAtOpen) {
      toast('The project changed while this dialog was open — try again.', 'error');
      return;
    }
    if (state.selectedActorId !== capturedActorId) {
      toast('The selected monster changed while this dialog was open — try again.', 'error');
      return;
    }
    const plan = planMonsterGrowth(store.project, capturedActorId, growth);
    if (!plan) return;
    store.commit('Derive stats from level', (project) => applyMonsterGrowth(project, plan));
    render();
  }

  // A cross-link from the Sprite Forge (app.goTo('monster', { actorId })).
  // No further validation here: render()'s own `ids.includes` fallback below
  // already lands a deleted or otherwise unlisted id on the catalog's first
  // entry, which is exactly the behaviour a bad context should get. See
  // docs/design-monster.md §2.
  const context = app.consumeContext();
  if (Number.isInteger(context?.actorId)) {
    state.selectedActorId = context.actorId;
  }
  if (context?.tab === 'groups') {
    state.tab = 'groups';
    if (Number.isInteger(context.group)) state.group = context.group;
  }

  // A persistent fields/preview split (docs/design-battle-animation.md
  // §15.5, §15.8): fieldsHost is replaceable on every render(), previewHost
  // is handed to mountBattleFxPreview ONCE at mount and never touched by
  // fill() again -- the identical split Magic gets, not a bare field()
  // insertion inside battleSection (which would be rebuilt and lost on
  // every render, §15.8's own corrected cost).
  const body = el('div.panel-body');
  const tabsHost = el('div.tabs');
  const groupsHost = el('div');
  const fieldsHost = el('div');
  const previewHost = el('div', { style: { marginTop: '16px', maxWidth: '360px' } });
  fill(body, tabsHost, fieldsHost, previewHost, groupsHost);

  const preview = mountBattleFxPreview(previewHost, {
    getProject: () => store.project,
    getAnimationId: () => {
      if (state.selectedActorId === null) return null;
      const actor = store.project.sprites.actors[state.selectedActorId];
      return actor?.battle?.attackAnim ?? null;
    }
  });

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
      fieldsHost,
      el(
        'p.hint',
        { style: { marginBottom: '12px', maxWidth: '640px' } },
        'Every actor that currently fights, or is named by a map’s encounter table, an encounter group or a ' +
          'Start a battle command, is listed here. To add, rename or delete a monster, or change its overworld sprite, ' +
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
                  'Harmless — a map’s encounter table, an encounter group or a Start a battle command still names ' +
                    'this actor, so it stays listed here, whether or not that reference currently reaches a fight.'
                ),
            battleSection(actor, state.selectedActorId, render, openDeriveModal)
          )
        : el(
            'p.hint',
            null,
            'No actor currently fights, and none is named by a map’s encounter table, an encounter group or a ' +
              'Start a battle command. Give an actor contact damage in the Sprite Forge to make it a monster.'
          )
    );

    preview.sync();
  }

  // ---------------------------------------------------------------- Groups tab

  // Re-rendered whole on every change, like render() above. The Groups tab is drawn only while it is showing, so
  // the Monsters tab's own selects are the only ones in the DOM until an author asks for groups.
  function renderGroups() {
    if (state.tab !== 'groups') {
      fill(groupsHost);
      return;
    }
    const project = store.project;
    const groups = project.encounterGroups ?? [];
    state.group = Math.max(0, Math.min(state.group, groups.length - 1));
    const room = groupRoom(project);
    const group = groups[state.group] ?? null;

    const addGroup = (copyOf) => {
      // Plan, refuse and commit in one synchronous run (the planEncounterConversion precedent): a refusal never
      // reaches store.commit, so it adds no undo entry and does not mark the project dirty.
      const plan = planAddGroup(store.project, copyOf);
      if (!plan.ok) {
        toast(plan.message, 'error');
        return;
      }
      let added = 0;
      store.commit(copyOf === null ? 'Add encounter group' : 'Duplicate encounter group', (draft) => {
        added = applyAddGroup(draft, plan);
      });
      state.group = added;
      renderGroups();
    };

    const deleteGroup = async () => {
      const index = state.group;
      const using = mapsUsingGroup(store.project, index);
      if (using.length) {
        const revisionAtOpen = store.revision;
        const names = using.map((mapIndex) => store.project.maps[mapIndex].name).join(', ');
        const confirmed = await confirmModal(
          'Delete group',
          `Delete "${group.name}"? It will also be removed from the encounter ${using.length === 1 ? 'table' : 'tables'} of ${names}.`,
          'Delete'
        );
        if (!confirmed || destroyed) return;
        if (store.revision !== revisionAtOpen) {
          toast('The project changed while this dialog was open — try again.', 'error');
          return;
        }
      }
      store.commit('Delete encounter group', (draft) => {
        deleteEncounterGroup(draft, index);
      });
      state.group = Math.max(0, index - 1);
      renderGroups();
    };

    const problems = group ? groupProblems(project, state.group) : null;
    const using = group ? mapsUsingGroup(project, state.group) : [];
    const slotCount = group ? Math.min(RPG_LIMITS.encounterActors, group.monsters.length + 1) : 0;

    fill(
      groupsHost,
      el(
        'p.hint',
        { style: { marginBottom: '12px', maxWidth: '640px' } },
        'A group is a set of up to four monsters that fight together. A map’s encounter table in the Map ' +
          'Forge (Battles here → Convert to groups) picks among groups, by weight, each time an encounter starts.'
      ),
      el(
        'div.field-row',
        { style: { alignItems: 'center', marginBottom: '12px', gap: '8px' } },
        el(
          'button.btn.btn-sm',
          {
            'data-group-add': '',
            disabled: room.full,
            title: room.full ? room.message : 'Add an empty encounter group',
            onclick: () => addGroup(null)
          },
          '+ Add group'
        ),
        el('span.hint', { 'data-group-count': '' }, `${room.count} of ${room.limit} groups` + (room.full ? ' — the limit' : ''))
      ),
      el(
        'div.field-row',
        { style: { marginBottom: '12px' } },
        el(
          'select',
          {
            'data-group-list': '',
            size: Math.min(10, Math.max(4, groups.length)),
            style: { minWidth: '220px' },
            onchange: (event) => {
              state.group = Number(event.target.value);
              renderGroups();
            }
          },
          groups.length
            ? groups.map((entry, index) =>
                el('option', { value: index, selected: index === state.group }, `${entry.name} (${entry.monsters.length})`)
              )
            : [el('option', null, 'No groups yet')]
        )
      ),
      !group
        ? el('p.hint', null, 'No groups yet. Add one, then choose the monsters that fight together.')
        : el(
            'div',
            null,
            row(
              field(
                'Name',
                el('input', {
                  'data-group-name': '',
                  type: 'text',
                  maxlength: AUTHOR_NAME_MAX,
                  value: group.name,
                  onchange: (event) => {
                    // A blank, unchanged or stale rename answers false without touching the store (no phantom undo entry).
                    if (!commitGroupRename(store, state.group, event.target.value)) event.target.value = group.name;
                    renderGroups();
                  }
                })
              )
            ),
            row(
              ...Array.from({ length: slotCount }, (_, slot) => {
                const current = group.monsters[slot];
                const options = groupSlotOptions(project, current);
                return field(
                  `Monster ${slot + 1}`,
                  el(
                    'select',
                    {
                      'data-group-slot': String(slot),
                      onchange: (event) => {
                        const index = state.group;
                        const chosen = event.target.value === '' ? null : Number(event.target.value);
                        store.commit('Change encounter group', (draft) => {
                          setGroupMonster(draft, index, slot, chosen);
                        });
                        renderGroups();
                      }
                    },
                    el('option', { value: '', selected: current === undefined }, 'Nothing'),
                    options.map((option) =>
                      el('option', { value: option.value, selected: option.value === current }, option.missing ? `${option.label} (missing)` : option.label)
                    )
                  )
                );
              })
            ),
            problems.missing.length
              ? el(
                  'p.hint',
                  { 'data-group-warning': 'missing', style: { color: 'var(--accent)', marginBottom: '8px' } },
                  `This group names an actor that no longer exists (${problems.missing.map((id) => `#${id}`).join(', ')}). ` +
                    'Choose another monster for that slot, or clear it.'
                )
              : null,
            problems.dead
              ? el(
                  'p.hint',
                  { 'data-group-warning': 'dead', style: { color: 'var(--accent)', marginBottom: '8px' } },
                  (group.monsters.length
                    ? 'None of this group’s monsters exists, so an encounter that picks it starts no fight.'
                    : 'This group has no monsters yet, so an encounter that picks it starts no fight.')
                )
              : null,
            el(
              'p.hint',
              { 'data-group-usage': '', style: { marginBottom: '8px' } },
              using.length
                ? `Used by the encounter ${using.length === 1 ? 'table' : 'tables'} of ${using.map((mapIndex) => project.maps[mapIndex].name).join(', ')}.`
                : 'No map’s encounter table uses this group yet.'
            ),
            row(
              el(
                'button.btn.btn-sm',
                {
                  'data-group-duplicate': '',
                  disabled: room.full,
                  title: room.full ? room.message : 'Add a copy of this group',
                  onclick: () => addGroup(state.group)
                },
                'Duplicate'
              ),
              el('button.btn.btn-sm', { 'data-group-delete': '', title: 'Delete', onclick: deleteGroup }, 'Delete')
            )
          )
    );
  }

  function renderTabs() {
    fill(
      tabsHost,
      ...[
        ['monsters', 'Monsters'],
        ['groups', 'Groups']
      ].map(([id, label]) =>
        el(
          'button.tab',
          {
            'data-monster-tab': id,
            class: state.tab === id ? 'active' : '',
            onclick: () => {
              state.tab = id;
              renderAll();
            }
          },
          label
        )
      )
    );
  }

  // Both tabs re-derive from the store on every change (undo, redo and navigation included), so one entry point
  // keeps the tab strip, the visible pane and the hidden pane in step.
  function renderAll() {
    renderTabs();
    fieldsHost.hidden = previewHost.hidden = state.tab !== 'monsters';
    render();
    renderGroups();
  }

  const root = el(
    'div.forge',
    { style: { gridTemplateColumns: '1fr' } },
    el('div.panel', { style: { borderRight: 'none' } }, el('div.panel-head', null, 'Monster Forge'), body)
  );

  container.append(root);
  renderAll();
  app.setMeta('Monster Forge');

  return {
    destroy() {
      destroyed = true;
      preview.destroy();
      app.setMeta('');
    },
    onProjectChange: renderAll,
    stepPreview: () => preview.stepPreview()
  };
}
