// The ring-only labels of 02-ring-engine.patch, the opcode each names, and which RING_GEOMETRY field its operand must equal.
export const RING_FORK_LABELS = {
  sw_ring_col_cmp: { opcode: 0xc9, field: 'col' },
  sw_ring_col_len: { opcode: 0xa9, field: 'col' },
  sw_ring_row_cmp: { opcode: 0xc9, field: 'row' },
  sw_ring_row_len: { opcode: 0xa9, field: 'row' },
  sw_ring_wrap_col: { opcode: 0xc9, field: 'col' },
  sw_ring_wrap_row: { opcode: 0xc9, field: 'row' },
  sw_ring_nt_step: { opcode: 0x69, field: 'step' },
  sw_ring_nt_end: { opcode: 0xc9, field: 'end' }
};
