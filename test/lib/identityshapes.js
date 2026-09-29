// The generated project shapes the identity matrix (test/unit/identitymatrix.test.js,
// test/lib/build_identity_baseline.mjs) builds. A shape is a small descriptor; a project is
// generated from it in memory and written to an mkdtemp directory by the caller -- no checked-in
// fixture is read or mutated. The *expected outcome* of each shape lives in the test as a
// hand-written table keyed by `id`, never derived from anything here or from the generator's own
// predicates (a predicate bug must not agree with its own oracle).
//
// Axes that exist in the engine at 9f0136e (handoff-next/streamed-worlds-phase3a-plan.md §6.4):
//   game    'action' | 'rpg' (UNROM 512)
//   maps    'ord'   ordinary map only
//           'U-noA' an ordinary map plus a streamed map that has no placed actors
//           'U-A'   streamed map(s) with a placed actor
//   move    'none' | 'npc' (self-only) | 'player-ord' (player Move on the ordinary map of a
//           mixed project) | 'player-str' (player Move on a streamed map)
//   text / save / turn / visible   each on or off independently
// The handover-flag axis does not exist until S2: a shape descriptor gains it there (`handover`),
// and buildShapeProject reads it with a default that leaves every S0/S1 shape unchanged.

import { createProject } from '../../shared/project.js';
import { createStreamedProject } from './streamedproject.js';

const base = (game) => ({ game, maps: 'ord', move: 'none', text: false, save: false, turn: false, visible: false });

/** The commands the host NPC's one interact event runs, from the toggles (order is fixed). */
function hostCommands(d) {
  const commands = [];
  if (d.text) commands.push({ op: 'say', text: 'Hi' });
  if (d.turn) commands.push({ op: 'turn', who: 'self', dir: 'up' });
  if (d.visible) commands.push({ op: 'visible', state: 'hidden' }, { op: 'visible', state: 'shown' });
  if (d.move === 'npc') commands.push({ op: 'move', who: 'self', dir: 'up', dist: 16 });
  if (d.move === 'player-ord' || d.move === 'player-str') commands.push({ op: 'move', who: 'player', dir: 'right', dist: 16 });
  if (d.save) commands.push({ op: 'save' });
  return commands;
}

function addNpc(project, screen, name, commands) {
  const actorId = project.sprites.actors.length;
  project.sprites.actors.push({ name, behavior: 'npc', hp: 1, damage: 0 });
  screen.entities = screen.entities ?? [];
  screen.entities.push({
    actorId,
    x: 96,
    y: 96,
    props: commands ? { trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } } : {}
  });
}

/** Builds the in-memory project for a shape descriptor. */
export function buildShapeProject(d) {
  const commands = hostCommands(d);
  const hostOnStreamed = d.maps === 'U-A' && d.move !== 'player-ord';
  let project;
  if (d.maps === 'ord') {
    project = createProject('Identity', d.game);
    // Save needs a board that can write one; UNROM 512 is the one both game types share here
    if (d.game === 'rpg' || d.save) {
      project.cartridge.mapper = 30;
      project.cartridge.mirroring = 'fourscreen';
    }
  } else if (d.maps === 'U-noA') {
    project = createStreamedProject({ gameType: d.game, mixed: true });
  } else if (hostOnStreamed) {
    project = createStreamedProject({ gameType: d.game });
  } else {
    project = createStreamedProject({ gameType: d.game, mixed: true });
  }
  const streamed = project.maps.find((m) => m.streamed);
  const ordinary = project.maps.find((m) => !m.streamed);
  if (commands.length) addNpc(project, (hostOnStreamed ? streamed : ordinary).screens[0], 'Host', commands);
  // `A`: a streamed map with a placed actor that carries no commands (the host is on the streamed
  // map itself in the hostOnStreamed case)
  if (d.maps === 'U-A' && !hostOnStreamed) addNpc(project, streamed.screens[0], 'Bystander', null);
  if (d.maps === 'U-A' && hostOnStreamed && !commands.length) addNpc(project, streamed.screens[0], 'Bystander', null);
  if (d.save) {
    project.project.titleMap = project.maps.indexOf(ordinary);
    project.project.titleScreen = 0;
  }
  return project;
}

const SHAPE_ROWS = (game) => [
  ['base', {}],
  ['U-noA', { maps: 'U-noA' }],
  ['U-A', { maps: 'U-A' }],
  ['move-npc', { move: 'npc' }],
  ['move-player-ord', { maps: 'U-A', move: 'player-ord' }],
  ['move-player-str', { maps: 'U-A', move: 'player-str' }],
  ['text', { text: true }],
  ['save', { save: true }],
  ['turn', { turn: true }],
  ['visible', { visible: true }],
  ['turn+move-npc', { turn: true, move: 'npc' }],
  ['U-noA+turn', { maps: 'U-noA', turn: true }],
  ['U-A+turn', { maps: 'U-A', turn: true }],
  ['U-A+move-npc+text', { maps: 'U-A', move: 'npc', text: true }],
  ['U-noA+move-npc', { maps: 'U-noA', move: 'npc' }],
  ['all-toggles+move-npc', { move: 'npc', text: true, save: true, turn: true, visible: true }],
  ['U-A+text+visible', { maps: 'U-A', text: true, visible: true }],
  ['U-noA+text+save+visible', { maps: 'U-noA', text: true, save: true, visible: true }],
  ['move-player-ord+turn+text', { maps: 'U-A', move: 'player-ord', turn: true, text: true }],
  ['move-player-str+turn+text+visible', { maps: 'U-A', move: 'player-str', turn: true, text: true, visible: true }]
].map(([label, over]) => ({ id: `${game}:${label}`, desc: { ...base(game), ...over } }));

/** Every shape, in a fixed order; S2 adds the handover axis by extending the rows. */
export const SHAPES = [...SHAPE_ROWS('action'), ...SHAPE_ROWS('rpg')];
