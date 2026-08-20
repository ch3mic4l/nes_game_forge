// The debugger's switch/variable inspector: a labelled view of the same
// engine RAM the Memory tab already shows as unlabelled hex (ROADMAP item 3).
// What's worth pinning down here is the pure logic the panel leans on --
// the bit packing engine/constants.asm documents in its own comment, name
// resolution for an unnamed switch or variable, and the "can this build even
// be read" check -- kept in shared/switchvars.js precisely so a test can
// reach it without a DOM or a running emulator.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEquates } from '../../shared/enginesyms.js';
import {
  inspectorProblem,
  switchBit,
  switchAddress,
  variableAddress,
  readSwitch,
  writeSwitch,
  labelFor,
  clampByte,
  REQUIRED_RAM
} from '../../shared/switchvars.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engineConstants = () => parseEquates(fs.readFileSync(path.join(ROOT, 'engine/constants.asm'), 'utf8'));

test('the engine still defines every name the inspector reads', () => {
  const ram = engineConstants();
  assert.equal(inspectorProblem({ ram, numVariables: 16 }), null);
  // Spot values, so a parser that returned an empty object could not pass by
  // accident.
  assert.equal(ram.switches, 0x0390);
  assert.equal(ram.NUM_SWITCHES, 64);
  assert.equal(ram.variables, 0x0500);
});

test('a build the inspector cannot read says so, naming what is missing', () => {
  const ram = engineConstants();
  assert.match(inspectorProblem({ ram: null, numVariables: 16 }), /could not be read/);
  assert.match(inspectorProblem({ ram, numVariables: null }), /NUM_VARIABLES/);
  assert.match(inspectorProblem({ ram, numVariables: undefined }), /NUM_VARIABLES/);

  for (const name of REQUIRED_RAM) {
    const { [name]: _omitted, ...withoutOne } = ram;
    assert.match(inspectorProblem({ ram: withoutOne, numVariables: 16 }), new RegExp(name));
  }
});

test('switch bit packing matches the comment in engine/constants.asm: bit (n & 7) of byte (n >> 3)', () => {
  assert.deepEqual(switchBit(0), { byteOffset: 0, mask: 1 });
  assert.deepEqual(switchBit(7), { byteOffset: 0, mask: 0x80 });
  assert.deepEqual(switchBit(8), { byteOffset: 1, mask: 1 });
  assert.deepEqual(switchBit(63), { byteOffset: 7, mask: 0x80 });
});

test('switchAddress/variableAddress add the index to the build\'s own base, not a remembered one', () => {
  const ram = { switches: 0x0390, variables: 0x0500 };
  assert.equal(switchAddress(ram, 0), 0x0390);
  assert.equal(switchAddress(ram, 7), 0x0390); // still byte 0, only the mask differs
  assert.equal(switchAddress(ram, 8), 0x0391); // byte 1
  assert.equal(switchAddress(ram, 63), 0x0397); // byte 7, the last one
  assert.equal(variableAddress(ram, 0), 0x0500);
  assert.equal(variableAddress(ram, 15), 0x050f);

  // A base other than the real engine's, proving this is not hardcoded: the
  // whole point of reading ram.switches/ram.variables from the build instead
  // of a constant.
  const moved = { switches: 0x0400, variables: 0x0600 };
  assert.equal(switchAddress(moved, 8), 0x0401);
  assert.equal(variableAddress(moved, 3), 0x0603);
});

test('readSwitch/writeSwitch round-trip through memory without disturbing the other 7 flags', () => {
  const bytes = {}; // a sparse fake "RAM" -- any address is valid, like emulator.peek/poke
  const peek = (address) => bytes[address] ?? 0;
  const poke = (address, value) => {
    bytes[address] = value & 0xff;
  };

  writeSwitch(peek, poke, 0, 3, true);
  assert.equal(bytes[0], 0b00001000);
  assert.equal(readSwitch(peek, 0, 3), true);
  for (const other of [0, 1, 2, 4, 5, 6, 7]) assert.equal(readSwitch(peek, 0, other), false);

  writeSwitch(peek, poke, 0, 7, true); // a different byte's worth of index
  assert.equal(bytes[0], 0b10001000);
  writeSwitch(peek, poke, 0, 3, false); // clearing one leaves its neighbour alone
  assert.equal(bytes[0], 0b10000000);
  assert.equal(readSwitch(peek, 0, 7), true);

  // A base address other than zero: byte 8 of the switches array.
  writeSwitch(peek, poke, 0x0390, 65, true); // switch 65 -> byte 8, bit 1
  assert.equal(bytes[0x0390 + 8], 0b00000010);
});

test('labelFor falls back to the index when a switch or variable has no name', () => {
  const names = ['Chest opened', '', '  ', undefined];
  assert.equal(labelFor(names, 0, 'Switch'), 'Chest opened');
  assert.equal(labelFor(names, 1, 'Switch'), 'Switch 1'); // empty string
  assert.equal(labelFor(names, 2, 'Switch'), 'Switch 2'); // whitespace only
  assert.equal(labelFor(names, 3, 'Switch'), 'Switch 3'); // present but undefined
  assert.equal(labelFor(names, 12, 'Switch'), 'Switch 12'); // past the end of the array entirely
  assert.equal(labelFor([], 0, 'Variable'), 'Variable 0');
  assert.equal(labelFor(null, 5, 'Variable'), 'Variable 5');
});

test('clampByte truncates toward zero rather than rounding, matching emulator.poke’s own "& 0xff"', () => {
  assert.equal(clampByte('42.9'), 42); // not 43 -- Math.round would disagree with poke's truncation
  assert.equal(clampByte('42.1'), 42);
  assert.equal(clampByte('-1.9'), 0); // clamped, not -1
  assert.equal(clampByte('300'), 255);
  assert.equal(clampByte('-300'), 0);
  assert.equal(clampByte(''), 0);
  assert.equal(clampByte('not a number'), 0);
  assert.equal(clampByte('7'), 7);
});
