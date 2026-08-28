// Ready-made events, for the shapes almost every game needs.
//
// Each one is the two-page pattern the event system was built around: a page
// guarded by a switch that the page itself turns on, and a fallback page for
// afterwards. Writing that by hand means picking a switch nobody else is using,
// remembering which way round the guard goes, and getting the page order right
// — three chances to build something that runs once too often or never at all.
//
// A template is a starting point, not a finished event: it opens in the editor
// with the pages already there, and every argument is still editable. Nothing
// here invents an actor or a sprite, because a template that quietly created
// art would be putting things in the Sprite Forge the author never drew.
//
// Only commands the engine implements are used. There is deliberately no boss
// template: starting a battle from an event is not a command that exists yet
// (ROADMAP.md item 1), and a template that compiles to nothing is exactly what
// this codebase refuses to ship.

import { RPG_LIMITS, allCommands, projectEvents, canBackItem } from '../../../shared/project.js';

/**
 * Which switches the project already spends. Every place a switch number can
 * hide: a page's condition, a branch's condition (which is the same object), a
 * set/clear command wherever it sits, and an actor's hide switch. Miss one and a
 * template hands out a switch that is already load-bearing, which presents as
 * two unrelated events firing together.
 *
 * Nested commands are reached through `allCommands` rather than by naming the
 * commands that hold commands, because the last two additions to that list were
 * each a place a switch could hide from this. A `call` is a third: the switch
 * it hides is not in the caller's own commands at all, it is in the common
 * event named by index — so this walks `projectEvents`, which visits every
 * common event directly, rather than the placed actors alone.
 */
export function usedSwitches(project) {
  const used = new Set();
  const fromCondition = (cond) => {
    if (cond?.type === 'switchOn' || cond?.type === 'switchOff') used.add(cond.arg);
  };
  for (const map of project.maps ?? []) {
    for (const screen of map.screens ?? []) {
      for (const entity of screen.entities ?? []) {
        const hideSwitch = entity.props?.hideSwitch;
        if (typeof hideSwitch === 'number') used.add(hideSwitch);
      }
    }
  }
  for (const event of projectEvents(project)) {
    for (const page of event.pages ?? []) {
      fromCondition(page.cond);
      for (const command of allCommands(page.commands)) {
        if (command.op === 'setSwitch' || command.op === 'clearSwitch') used.add(command.switch);
        fromCondition(command.cond); // a branch's, which a page's editor also writes
      }
    }
  }
  return used;
}

/** The lowest switch nobody is using, or null when all 64 are spoken for. */
export function firstFreeSwitch(project) {
  const used = usedSwitches(project);
  for (let n = 0; n < RPG_LIMITS.switches; n++) if (!used.has(n)) return n;
  return null;
}

/**
 * The first party member somebody could actually recruit: one the game does not
 * already start with. -1 when there is nobody, which is also what decides
 * whether the Recruit template is offered at all.
 */
export function recruitable(project) {
  if (project.project?.gameType !== 'rpg') return -1;
  const party = (project.party ?? []).slice(0, RPG_LIMITS.party);
  return party.findIndex((member) => !member.startsInParty);
}

/**
 * The first item whose backing actor behaves like a collectable, for a
 * template to hand over — `null` when the project has none, never `0`.
 * Falling back to `0` used to hand the Chest and Locked-gate templates a
 * real reference the moment a project had *any* actors at all: id 0 is
 * whatever happens to sit first in the roster, usually the player, so an
 * author who had drawn no pickup yet got a chest that gives away the
 * player character rather than one that visibly asks to be pointed at
 * something. `itemMissing` reads `null` as exactly what it is — nothing to
 * give yet — so the Map Forge's own picker shows "Missing item" instead of
 * a plausible-looking wrong one, the same repointing phase 2 already fixed
 * one id space over.
 */
const firstPickup = (project) => {
  const items = project.items ?? [];
  const actors = project.sprites?.actors ?? [];
  const item = items.find((entry) => canBackItem(actors[entry.actorId]));
  return item ? item.id : null;
};

/**
 * `rpg` templates are hidden outside an RPG project, the same way the Join
 * command is: in an action build the battle bank is not assembled, so the
 * command would stop the event rather than run.
 */
export const EVENT_TEMPLATES = [
  {
    id: 'chest',
    label: 'Chest — hands something over, once',
    hint: 'Gives an item and remembers it did. Talk to it again and it is empty.',
    build: (project, free) => ({
      pages: [
        {
          cond: { type: 'switchOff', arg: free },
          commands: [
            { op: 'say', text: 'The lid gives.' },
            { op: 'give', item: firstPickup(project) },
            { op: 'setSwitch', switch: free }
          ]
        },
        { cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'It is empty now.' }] }
      ]
    })
  },
  {
    id: 'talkOnce',
    label: 'Says one thing first, another after',
    hint: 'The greeting happens once; every conversation after it is the short version.',
    build: (_project, free) => ({
      pages: [
        {
          cond: { type: 'switchOff', arg: free },
          commands: [
            { op: 'say', text: 'You must be the one they spoke of.' },
            { op: 'setSwitch', switch: free }
          ]
        },
        { cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'Good luck out there.' }] }
      ]
    })
  },
  {
    id: 'lockedGate',
    label: 'Gate — opens for whoever carries the key',
    hint:
      'Turns a switch on when the player has the right item. Point the wall or door at that ' +
      'switch with “Gone once…” and it disappears.',
    build: (project, free) => ({
      pages: [
        {
          cond: { type: 'hasItem', arg: firstPickup(project) },
          commands: [
            { op: 'say', text: 'The key turns.' },
            { op: 'setSwitch', switch: free }
          ]
        },
        { cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'It is locked.' }] }
      ]
    })
  },
  {
    id: 'recruit',
    label: 'Recruit — joins the party, once',
    hint: 'Adds a party member and remembers it, so they cannot be recruited twice.',
    // Not just "is this an RPG", and not just "is there a second member".
    // `startsInParty` is authorable per member, so a project can have four of
    // them and nobody to recruit. Recruiting somebody who is already in the
    // party is a conversation that does nothing and then sets the switch saying
    // it happened, which is worse than no template at all — and `join` compiles
    // the index straight through, so naming a member who does not exist sends
    // `party_join` after stats past the end of the generated tables.
    available: (project) => recruitable(project) >= 0,
    build: (project, free) => ({
      pages: [
        {
          cond: { type: 'switchOff', arg: free },
          commands: [
            { op: 'say', text: 'I will come with you.' },
            { op: 'join', member: recruitable(project) },
            { op: 'setSwitch', switch: free }
          ]
        },
        { cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'Lead on.' }] }
      ]
    })
  }
];

export const templatesFor = (project) =>
  EVENT_TEMPLATES.filter((entry) => !entry.available || entry.available(project));
