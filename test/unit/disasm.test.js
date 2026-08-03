import test from 'node:test';
import assert from 'node:assert/strict';
import { disassemble, disassembleRange, instructionSize, alignBefore, OPCODES } from '../../renderer/emulator/disasm.js';

const reader = (bytes, base = 0x8000) => (address) => bytes[address - base] ?? 0;

test('common opcodes decode with the right size and text', () => {
  const cases = [
    { bytes: [0xa9, 0x42], text: 'LDA #$42', size: 2 },
    { bytes: [0xad, 0x34, 0x12], text: 'LDA $1234', size: 3 },
    { bytes: [0xbd, 0x00, 0x80], text: 'LDA $8000,X', size: 3 },
    { bytes: [0x91, 0x02], text: 'STA ($02),Y', size: 2 },
    { bytes: [0xa1, 0x02], text: 'LDA ($02,X)', size: 2 },
    { bytes: [0x6c, 0xfa, 0xff], text: 'JMP ($FFFA)', size: 3 },
    { bytes: [0x0a], text: 'ASL A', size: 1 },
    { bytes: [0xea], text: 'NOP', size: 1 },
    { bytes: [0x60], text: 'RTS', size: 1 },
    { bytes: [0x96, 0x10], text: 'STX $10,Y', size: 2 }
  ];
  for (const entry of cases) {
    const row = disassemble(reader(entry.bytes), 0x8000);
    assert.equal(row.text, entry.text);
    assert.equal(row.size, entry.size);
  }
});

test('branches resolve to an absolute target', () => {
  // BNE +4 at $8000 targets $8000 + 2 + 4.
  assert.equal(disassemble(reader([0xd0, 0x04]), 0x8000).text, 'BNE $8006');
  // A negative displacement branches backwards.
  assert.equal(disassemble(reader([0xd0, 0xfc]), 0x8000).text, 'BNE $7FFE');
});

test('undocumented opcodes decode as one data byte instead of throwing', () => {
  const row = disassemble(reader([0x02]), 0x8000);
  assert.equal(row.size, 1);
  assert.ok(row.undocumented);
  assert.match(row.text, /\.db/);
});

test('every table entry has a consistent size', () => {
  for (let opcode = 0; opcode < 256; opcode++) {
    const entry = OPCODES[opcode];
    if (!entry) continue;
    assert.ok(entry.size >= 1 && entry.size <= 3, `opcode ${opcode}`);
    assert.equal(instructionSize(opcode), entry.size);
  }
});

test('symbol labels replace addresses but never immediates', () => {
  const labels = new Map([[0x1234, 'update_player'], [0x42, 'player_x']]);
  assert.equal(disassemble(reader([0x20, 0x34, 0x12]), 0x8000, labels).text, 'JSR update_player');
  assert.equal(disassemble(reader([0xa5, 0x42]), 0x8000, labels).text, 'LDA player_x');
  // $42 as an immediate is a value, not an address.
  assert.equal(disassemble(reader([0xa9, 0x42]), 0x8000, labels).text, 'LDA #$42');
});

test('disassembleRange walks instruction boundaries', () => {
  const program = [0xa9, 0x01, 0x8d, 0x00, 0x20, 0xea, 0x60];
  const rows = disassembleRange(reader(program), 0x8000, 4);
  assert.deepEqual(
    rows.map((row) => row.text),
    ['LDA #$01', 'STA $2000', 'NOP', 'RTS']
  );
  assert.deepEqual(
    rows.map((row) => row.address),
    [0x8000, 0x8002, 0x8005, 0x8006]
  );
});

test('alignBefore lands on an instruction boundary containing the target', () => {
  // Three-byte instructions: a naive "PC - N" would desynchronise.
  const program = new Array(64).fill(0).map((_, index) => (index % 3 === 0 ? 0xad : 0x00));
  const read = reader(program);
  const start = alignBefore(read, 0x8000 + 30, 6);
  let cursor = start;
  const seen = [];
  while (cursor < 0x8000 + 30 && seen.length < 40) {
    seen.push(cursor);
    cursor += instructionSize(read(cursor));
  }
  assert.equal(cursor, 0x8000 + 30, 'walking forward from the anchor must hit the target exactly');
});
