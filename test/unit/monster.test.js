// ROADMAP item 8 (starter library, phase 2) -- design-starter-library.md
// §5.3/§5.6/§11 test 3d. This repo has no jsdom-equivalent dependency, so
// this file never mounts renderer/forges/monster/monster.js itself -- it
// only exercises the shared/project.js predicate that module's artPicker
// now calls, the same one test/unit/project.test.js already covers for
// hasBattleBlockArt/battleBlockIndices.

import test from 'node:test';
import assert from 'node:assert/strict';
import { describeBattleTileState } from '../../shared/project.js';

test('describeBattleTileState: an explicit battleTile of 255 (the engine\'s own $FF sentinel) reads as "no block chosen," the same label a null/undefined battleTile gets', () => {
  const { hasBlock, label } = describeBattleTileState({ battle: { battleTile: 255 } });
  assert.equal(hasBlock, false);
  assert.equal(label, 'No block chosen — the actor is drawn from its animation.');
});
