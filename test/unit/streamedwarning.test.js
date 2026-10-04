// Phase 3a slice S3b (plan T11): the validator warning "the event ... moves the player, and a long enough Move can walk
// them to the edge of the screen ... cannot cross to a new screen" is DELETED -- the engine now crosses. Statement of
// the test, unchanged from the plan: no streamed project gets that warning, however its Move is reached (plain, behind
// a `call`, in a Choice option, in a player route), AND every other refusal in validateStreamedMaps still fires -- the
// deletion removed one `add()`, not the section. The other `add()` calls of the streamed-map section, enumerated at
// this slice's first step (shared/project.js validateStreamedMaps):
//   1  streamedBoardProblems     error  a streamed map that does not fit its board
//   2  the project screen total  error  more than LIMITS.projectScreens screens with a streamed map
//   3  switch-bound tiles        error  a streamed screen with boundTiles
//   4  the camera off            error  a streamed map needs the camera on
// (the moves-the-player warning was the fifth.)

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProject, LIMITS } from '../../shared/project.js';
import { createStreamedProject } from '../lib/streamedproject.js';

const MOVE = { op: 'move', who: 'player', dir: 'right', dist: 100 };
const MOVE_WORDS = /moves the player|long enough Move|cannot cross to a new screen|keep player Moves within the screen/;
const messages = (project) => validateProject(project).map((p) => `${p.severity}: ${p.message}`);

const SHAPES = {
  'a plain player Move': [MOVE],
  'a Move after a Say': [{ op: 'say', text: 'Hi' }, MOVE],
  'a Move behind a call': [{ op: 'call', event: 0 }],
  'a Move that goes up': [{ op: 'move', who: 'player', dir: 'up', dist: 16 }]
};

for (const gameType of ['action', 'rpg']) {
  for (const [name, commands] of Object.entries(SHAPES)) {
    test(`T11 (${gameType}) ${name} on a streamed map draws no moves-the-player warning, and no new problem of any kind`, () => {
      const project = createStreamedProject({ gameType, moveCommands: commands });
      if (name === 'a Move behind a call') {
        project.commonEvents = [{ id: 0, name: 'Hop', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [MOVE] }] } }];
        project.commonEventSeq = 1;
      }
      const control = createStreamedProject({ gameType, moveCommands: commands.map((c) => (c.op === 'move' ? { op: 'setVar', variable: 0, value: 1 } : c)) });
      if (name === 'a Move behind a call') {
        control.commonEvents = [{ id: 0, name: 'Hop', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'setVar', variable: 0, value: 1 }] }] } }];
        control.commonEventSeq = 1;
      }
      const got = messages(project);
      assert.deepEqual(got.filter((m) => MOVE_WORDS.test(m)), [], 'the deleted warning does not appear');
      assert.deepEqual(got, messages(control), 'the project with the Move draws exactly the problems the same project with a no-op does');
    });
  }
}

test('T11 every other refusal of the streamed-map section still fires', () => {
  // 3: switch-bound tiles on a streamed screen
  const bound = createStreamedProject({});
  bound.maps.find((m) => m.streamed).screens[0].boundTiles = [{ switchId: 0, row: 0, col: 0, metatileId: 1 }];
  assert.ok(messages(bound).some((m) => /^error: .*switch-bound tiles, which a streamed screen cannot use yet/.test(m)), 'switch-bound tiles');
  // 4: camera off
  const noCam = createStreamedProject({ camera: false });
  assert.ok(messages(noCam).some((m) => /^error: .*camera off, and a streamed map needs it on/.test(m)), 'camera off');
  // 1: the board (a mapper with no streaming board)
  const board = createStreamedProject({ mapper: 0, mirroring: 'horizontal' });
  assert.ok(validateProject(board).some((p) => p.severity === 'error'), 'a streamed map on a board that cannot hold it');
  // 2: the project total
  const many = createStreamedProject({ mixed: true });
  const extra = LIMITS.projectScreens + 1;
  many.maps[0].screens = Array.from({ length: extra }, () => structuredClone(many.maps[0].screens[0]));
  assert.ok(messages(many).some((m) => /^error: The project holds \d+ screens; with a streamed map the limit is/.test(m)), 'the screen total');
});
