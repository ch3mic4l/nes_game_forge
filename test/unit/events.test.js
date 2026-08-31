// renderer/forges/map/events.js's own pure helpers, outside the modal UI they
// back.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripEmptyBattles, defaultCommand, describeCommand } from '../../renderer/forges/map/events.js';
import { MOVE_TARGETS, MOVE_DIRECTIONS } from '../../shared/project.js';

const EVENTS_JS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../renderer/forges/map/events.js');

test('an empty Start a battle command is dropped, wherever it is nested', () => {
  const commands = [
    { op: 'battle', monsters: [] },
    { op: 'battle', monsters: [3] },
    {
      op: 'branch',
      then: [{ op: 'battle', monsters: [] }],
      else: [{ op: 'battle', monsters: [4] }]
    },
    {
      op: 'choice',
      options: [{ commands: [{ op: 'battle', monsters: [] }] }, { commands: [{ op: 'say', text: 'Hi.' }] }]
    }
  ];
  const stripped = stripEmptyBattles(commands);
  assert.deepEqual(
    stripped.map((c) => c.op),
    ['battle', 'branch', 'choice']
  );
  assert.deepEqual(stripped[1].then, []);
  assert.equal(stripped[1].else.length, 1);
  assert.deepEqual(stripped[2].options[0].commands, []);
  assert.equal(stripped[2].options[1].commands.length, 1);
});

test('a switched-off empty battle command survives — the toggle is not a delete', () => {
  const commands = [
    { op: 'battle', monsters: [], off: true },
    { op: 'battle', monsters: [] }
  ];
  const stripped = stripEmptyBattles(commands);
  assert.equal(stripped.length, 1, 'only the enabled, genuinely empty one should go');
  assert.equal(stripped[0].off, true);
  assert.deepEqual(stripped[0].monsters, []);
});

test('a switched-off branch is returned untouched, not recursed into', () => {
  const commands = [
    {
      op: 'branch',
      off: true,
      then: [{ op: 'battle', monsters: [] }],
      else: []
    }
  ];
  const stripped = stripEmptyBattles(commands);
  assert.equal(stripped.length, 1);
  assert.equal(stripped[0].off, true);
  // The exact same object the compiler would also skip over, not a copy with
  // its insides quietly rewritten.
  assert.equal(stripped[0], commands[0]);
  assert.deepEqual(stripped[0].then, [{ op: 'battle', monsters: [] }]);
});

// -------------------------------------------------- Turn/Wait authoring

// The Map Forge's Turn and Wait controls had no coverage at all: a Wait input
// writing command.dist, a Turn selector writing the wrong field, or a Wait
// defaulting to 0 would all pass the whole suite while the command could not
// actually be authored. What is reachable from here, without a DOM, is
// defaultCommand (what a freshly-added Turn/Wait actually carries) and
// describeCommand (what the event list shows for one), both already pure
// exports the same way stripEmptyBattles is. Whether a control's own
// onchange handler actually *fires* and reaches the right field -- the part
// neither of those two touches -- is covered in main/smoke.js's real,
// Electron-driven event editor ('turn/wait authoring'), not here: a
// text-scan of the handler's source (see editorBlock below) cannot tell a
// wired 'onchange' from an inert 'onchanged' that registers a listener for
// an event nothing ever fires, since both spellings still contain the exact
// assignment string the scan looks for. Round 2 review confirmed that gap
// with exactly that sabotage. The scan below is kept anyway -- a real,
// cheap, narrower claim about the source text -- but it is a supplement to
// the smoke step, never a substitute for it.

test('a freshly-added Turn defaults to the first target and direction, and carries no Move-only fields', () => {
  const command = defaultCommand('turn');
  assert.equal(command.op, 'turn');
  assert.equal(command.who, MOVE_TARGETS[0].id, 'who should default to the first MOVE_TARGETS entry');
  assert.equal(command.dir, MOVE_DIRECTIONS[0].id, 'dir should default to the first MOVE_DIRECTIONS entry');
  assert.equal(command.dist, undefined, 'a Turn has no distance operand and must not carry one');
  assert.equal(command.frames, undefined, 'a Turn has no frame count and must not carry one');
});

test('a freshly-added Wait defaults to a real duration, not 0 -- a 0-frame Wait does nothing', () => {
  const command = defaultCommand('wait');
  assert.equal(command.op, 'wait');
  assert.equal(command.frames, 30, 'a brand-new Wait must default to half a second, not the honest-but-useless 0 every other number field defaults to');
  assert.equal(command.who, undefined, 'a Wait names no actor and must not carry one');
  assert.equal(command.dir, undefined, 'a Wait has no direction and must not carry one');
  assert.equal(command.dist, undefined, 'a Wait has no distance operand and must not carry one');
});

test('a Turn summarises who and which way it faces, in the event list', () => {
  assert.equal(describeCommand({ op: 'turn', who: 'self', dir: 'up' }), 'Turn This actor to face up');
  assert.equal(describeCommand({ op: 'turn', who: 'player', dir: 'left' }), 'Turn The player to face left');
  // Off is prefixed the same way every other command's summary is.
  assert.equal(describeCommand({ op: 'turn', who: 'self', dir: 'up', off: true }), '(off) Turn This actor to face up');
  // An unknown who/dir -- a hand-edited or later-version project -- falls
  // back to the first entry rather than the summary breaking.
  assert.equal(describeCommand({ op: 'turn', who: 'nobody', dir: 'sideways' }), 'Turn This actor to face down');
});

test('a Wait summarises its frame count, and says so plainly when it is 0', () => {
  assert.equal(describeCommand({ op: 'wait', frames: 45 }), 'Wait 45 frames');
  assert.equal(describeCommand({ op: 'wait', frames: 0 }), 'Wait 0 frames (does nothing)', 'a 0-frame Wait must read as a no-op, the same way a 0px Move already does');
  assert.equal(describeCommand({ op: 'wait', frames: 10, off: true }), '(off) Wait 10 frames');
});

// A weaker, cheaper companion to the smoke step above: which field each
// control's own onchange handler's *source* assigns to, checked as a fact
// about the text -- the identical discipline CLAUDE.md documents for
// battleRegionRelocates's own token scan of hand-written 6502. It is real
// coverage of "does this handler assign to the field its label claims," and
// it costs nothing, but it cannot see whether the handler is ever actually
// invoked -- a prop renamed from 'onchange' to 'onchanged' leaves every
// string this scan looks for untouched while the control goes completely
// inert, which is exactly what main/smoke.js's 'turn/wait authoring' step
// exists to catch instead. The three editor blocks are adjacent and in this
// order in the source (move, turn, wait, save), so each is sliced out by the
// next block's own `if (command.op === ...)` marker rather than a
// brace-matcher.
function editorBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `could not find ${JSON.stringify(startMarker)} in events.js -- has the editor been restructured?`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `could not find ${JSON.stringify(endMarker)} after ${JSON.stringify(startMarker)} in events.js`);
  return source.slice(start, end);
}

test("the Turn editor's own onchange handlers write who and dir, and nothing else", () => {
  const source = fs.readFileSync(EVENTS_JS_PATH, 'utf8');
  const block = editorBlock(source, "if (command.op === 'turn') {", "if (command.op === 'wait') {");
  const count = (needle) => block.split(needle).length - 1;
  assert.equal(count('command.who = fired.target.value'), 1, 'exactly one control should write who -- zero means the field is unreachable, two means dir was overwritten with who as well');
  assert.equal(count('command.dir = fired.target.value'), 1, 'exactly one control should write dir -- zero means the field is unreachable, two means who was overwritten with dir as well');
  assert.equal(count('command.dist'), 0, 'a Turn has no distance operand and must never write one');
  assert.equal(count('command.frames'), 0, 'a Turn has no frame count and must never write one');
});

test("the Wait editor's own onchange handler writes frames, not dist", () => {
  const source = fs.readFileSync(EVENTS_JS_PATH, 'utf8');
  const block = editorBlock(source, "if (command.op === 'wait') {", "if (command.op === 'shake') {");
  const count = (needle) => block.split(needle).length - 1;
  assert.equal(count('command.frames = wholeNumber(fired.target.value, 255)'), 1, 'the frame-count input should write frames through the same whole-number clamp every other byte field uses');
  assert.equal(count('command.dist'), 0, 'a Wait input writing to command.dist instead of command.frames would leave this at 1, not 0');
  assert.equal(count('command.who'), 0, 'a Wait names no actor and must never write one');
  assert.equal(count('command.dir'), 0, 'a Wait has no direction and must never write one');
});

// -------------------------------------------------------- Shake authoring
//
// defaultCommand and describeCommand only -- the actual onchange wiring is
// covered by main/smoke.js's own real, Electron-driven 'shake authoring'
// step, not a lexical scan here: round 2 review of the Turn/Wait scans above
// found they cannot tell a wired 'onchange' from an inert 'onchanged', which
// is exactly the class of defect that matters for a control like this one.

test('a freshly-added Shake defaults to a real duration, not 0 -- a 0-frame Shake does nothing', () => {
  const command = defaultCommand('shake');
  assert.equal(command.op, 'shake');
  assert.equal(command.frames, 30, 'a brand-new Shake must default to half a second, the same reasoning Wait already gets');
  assert.equal(command.who, undefined, 'a Shake names no actor and must not carry one');
  assert.equal(command.dir, undefined, 'a Shake has no direction and must not carry one');
  assert.equal(command.dist, undefined, 'a Shake has no distance operand and must not carry one');
});

test('a Shake summarises its frame count, and says so plainly when it is 0', () => {
  assert.equal(describeCommand({ op: 'shake', frames: 45 }), 'Shake screen for 45 frames');
  assert.equal(describeCommand({ op: 'shake', frames: 0 }), 'Shake screen for 0 frames (does nothing)', 'a 0-frame Shake must read as a no-op, the same way a 0px Move and a 0-frame Wait already do');
  assert.equal(describeCommand({ op: 'shake', frames: 10, off: true }), '(off) Shake screen for 10 frames');
});

// ---------------------------------------------------------- SFX authoring
//
// design-sfx.md §7 test 20: a freshly-added Play-a-sound-effect command must
// name no effect (null), never effect 0 -- the identical 'item'/'song'
// reasoning defaultCommand already applies elsewhere, so a brand-new command
// reads as "not yet configured" rather than a real, plausible-looking choice
// nobody actually picked.

test('a freshly-added Play a sound effect command names no effect, never effect 0', () => {
  const command = defaultCommand('sfx');
  assert.equal(command.op, 'sfx');
  assert.equal(command.sfx, null, 'a brand-new sfx command must not silently pick effect 0');
});

test('a Play a sound effect command shows the real effect name, or Missing effect for a null or stale reference', () => {
  const context = { sfx: [{ name: 'Boop' }, { name: 'Zap' }] };
  assert.equal(describeCommand({ op: 'sfx', sfx: 1 }, context), 'Play a sound effect: Zap');
  assert.equal(describeCommand({ op: 'sfx', sfx: null }, context), 'Play a sound effect (missing effect)');
  assert.equal(describeCommand({ op: 'sfx', sfx: 99 }, context), 'Play a sound effect (missing effect)', 'a stale, out-of-range reference must read as missing too');
  assert.equal(describeCommand({ op: 'sfx', sfx: 0, off: true }, context), '(off) Play a sound effect: Boop');
});
