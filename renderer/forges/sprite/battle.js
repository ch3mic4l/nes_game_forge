// The party a turn-based RPG fights alongside. An actor's own battle stats
// (attack, drops, battle artwork, and the rest of what only means something
// in a fight) moved to the Monster Forge -- see docs/design-monster.md §2
// for the boundary this file and that one now split on.
//
// Only shown for a turn-based RPG: an action game has no battles for any of this
// to matter in, and offering a stat that nothing reads is the thing this
// codebase does not do.

import { store } from '../../store.js';
import { el, field } from '../../ui.js';
import { RPG_LIMITS, createPartyMember, renumberPartyMemberDeletion } from '../../../shared/project.js';

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

const row = (...children) => el('div.field-row', { style: { gap: '8px', marginBottom: '6px' } }, ...children);

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
                      // Renumber every Join command's own member reference
                      // before the splice moves everyone above index down --
                      // renumberPartyMemberDeletion only measures the array,
                      // never mutates it, so either order gives the same
                      // answer, but doing it first keeps this in step with
                      // the actor/item/spell delete handlers' own contract.
                      renumberPartyMemberDeletion(project, index);
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

