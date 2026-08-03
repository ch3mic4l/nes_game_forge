// 6502 disassembler for the debugger's code view.

const MODES = {
  imp: { size: 1, format: () => '' },
  acc: { size: 1, format: () => 'A' },
  imm: { size: 2, format: (o) => `#$${byte(o[0])}` },
  zp: { size: 2, format: (o) => `$${byte(o[0])}` },
  zpx: { size: 2, format: (o) => `$${byte(o[0])},X` },
  zpy: { size: 2, format: (o) => `$${byte(o[0])},Y` },
  izx: { size: 2, format: (o) => `($${byte(o[0])},X)` },
  izy: { size: 2, format: (o) => `($${byte(o[0])}),Y` },
  abs: { size: 3, format: (o) => `$${word(o[1], o[0])}` },
  abx: { size: 3, format: (o) => `$${word(o[1], o[0])},X` },
  aby: { size: 3, format: (o) => `$${word(o[1], o[0])},Y` },
  ind: { size: 3, format: (o) => `($${word(o[1], o[0])})` },
  rel: { size: 2, format: () => '' } // handled specially: needs the PC
};

const byte = (value) => (value & 0xff).toString(16).padStart(2, '0').toUpperCase();
const word = (high, low) => (((high << 8) | low) & 0xffff).toString(16).padStart(4, '0').toUpperCase();

// opcode mnemonic mode, one entry per documented instruction.
const TABLE_TEXT = `
00 BRK imp|01 ORA izx|05 ORA zp|06 ASL zp|08 PHP imp|09 ORA imm|0A ASL acc|0D ORA abs|0E ASL abs
10 BPL rel|11 ORA izy|15 ORA zpx|16 ASL zpx|18 CLC imp|19 ORA aby|1D ORA abx|1E ASL abx
20 JSR abs|21 AND izx|24 BIT zp|25 AND zp|26 ROL zp|28 PLP imp|29 AND imm|2A ROL acc|2C BIT abs|2D AND abs|2E ROL abs
30 BMI rel|31 AND izy|35 AND zpx|36 ROL zpx|38 SEC imp|39 AND aby|3D AND abx|3E ROL abx
40 RTI imp|41 EOR izx|45 EOR zp|46 LSR zp|48 PHA imp|49 EOR imm|4A LSR acc|4C JMP abs|4D EOR abs|4E LSR abs
50 BVC rel|51 EOR izy|55 EOR zpx|56 LSR zpx|58 CLI imp|59 EOR aby|5D EOR abx|5E LSR abx
60 RTS imp|61 ADC izx|65 ADC zp|66 ROR zp|68 PLA imp|69 ADC imm|6A ROR acc|6C JMP ind|6D ADC abs|6E ROR abs
70 BVS rel|71 ADC izy|75 ADC zpx|76 ROR zpx|78 SEI imp|79 ADC aby|7D ADC abx|7E ROR abx
81 STA izx|84 STY zp|85 STA zp|86 STX zp|88 DEY imp|8A TXA imp|8C STY abs|8D STA abs|8E STX abs
90 BCC rel|91 STA izy|94 STY zpx|95 STA zpx|96 STX zpy|98 TYA imp|99 STA aby|9A TXS imp|9D STA abx
A0 LDY imm|A1 LDA izx|A2 LDX imm|A4 LDY zp|A5 LDA zp|A6 LDX zp|A8 TAY imp|A9 LDA imm|AA TAX imp|AC LDY abs|AD LDA abs|AE LDX abs
B0 BCS rel|B1 LDA izy|B4 LDY zpx|B5 LDA zpx|B6 LDX zpy|B8 CLV imp|B9 LDA aby|BA TSX imp|BC LDY abx|BD LDA abx|BE LDX aby
C0 CPY imm|C1 CMP izx|C4 CPY zp|C5 CMP zp|C6 DEC zp|C8 INY imp|C9 CMP imm|CA DEX imp|CC CPY abs|CD CMP abs|CE DEC abs
D0 BNE rel|D1 CMP izy|D5 CMP zpx|D6 DEC zpx|D8 CLD imp|D9 CMP aby|DD CMP abx|DE DEC abx
E0 CPX imm|E1 SBC izx|E4 CPX zp|E5 SBC zp|E6 INC zp|E8 INX imp|E9 SBC imm|EA NOP imp|EC CPX abs|ED SBC abs|EE INC abs
F0 BEQ rel|F1 SBC izy|F5 SBC zpx|F6 INC zpx|F8 SED imp|F9 SBC aby|FD SBC abx|FE INC abx
`;

export const OPCODES = (() => {
  const table = new Array(256).fill(null);
  for (const entry of TABLE_TEXT.split(/[|\n]/)) {
    const parts = entry.trim().split(/\s+/);
    if (parts.length !== 3) continue;
    const [code, mnemonic, mode] = parts;
    table[parseInt(code, 16)] = { mnemonic, mode, size: MODES[mode].size };
  }
  return table;
})();

/** Bytes an instruction occupies, 1 for anything undocumented. */
export function instructionSize(opcode) {
  return OPCODES[opcode & 0xff]?.size ?? 1;
}

/**
 * Disassemble one instruction.
 * @param {(address:number)=>number} read byte reader
 * @param {number} address CPU address of the opcode
 * @param {Map<number,string>} labels optional address -> label
 */
export function disassemble(read, address, labels = null) {
  const opcode = read(address) & 0xff;
  const entry = OPCODES[opcode];
  if (!entry) {
    return { address, size: 1, text: `.db $${byte(opcode)}`, bytes: [opcode], undocumented: true };
  }

  const operands = [];
  for (let i = 1; i < entry.size; i++) operands.push(read(address + i) & 0xff);

  let argument;
  let target = null;
  if (entry.mode === 'rel') {
    const offset = operands[0] < 0x80 ? operands[0] : operands[0] - 256;
    target = (address + 2 + offset) & 0xffff;
    argument = `$${target.toString(16).padStart(4, '0').toUpperCase()}`;
  } else {
    argument = MODES[entry.mode].format(operands);
    if (entry.size === 3) target = ((operands[1] << 8) | operands[0]) & 0xffff;
    else if (['zp', 'zpx', 'zpy', 'izx', 'izy'].includes(entry.mode)) target = operands[0];
  }

  if (labels && target !== null && labels.has(target) && entry.mode !== 'imm') {
    const label = labels.get(target);
    argument = argument.replace(/\$[0-9A-F]{2,4}/, label);
  }

  return {
    address,
    size: entry.size,
    mnemonic: entry.mnemonic,
    argument,
    target,
    bytes: [opcode, ...operands],
    text: argument ? `${entry.mnemonic} ${argument}` : entry.mnemonic
  };
}

/** Disassemble `count` instructions starting at `address`. */
export function disassembleRange(read, address, count, labels = null) {
  const rows = [];
  let cursor = address & 0xffff;
  for (let i = 0; i < count; i++) {
    const row = disassemble(read, cursor, labels);
    rows.push(row);
    cursor = (cursor + row.size) & 0xffff;
  }
  return rows;
}

/**
 * Find an address to start disassembling from so that `target` lands on an
 * instruction boundary. 6502 code is not self-synchronising, so we walk
 * forward from a little earlier and keep the alignment that hits the target.
 */
export function alignBefore(read, target, instructions = 8) {
  for (let back = instructions * 3; back >= 0; back--) {
    let cursor = (target - back) & 0xffff;
    let steps = 0;
    while (cursor < target && steps < instructions * 3) {
      cursor = (cursor + instructionSize(read(cursor))) & 0xffff;
      steps++;
    }
    if (cursor === target && steps >= instructions) return (target - back) & 0xffff;
  }
  return target;
}
