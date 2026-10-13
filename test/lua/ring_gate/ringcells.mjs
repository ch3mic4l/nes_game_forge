// The six mapper/mirroring cells of the ring gate's acceptance table, in a leaf module (no imports) so that the tree-maker (ringtree.mjs: which cells need the refusal lift) and the
// provenance audit (ringprovindex.mjs) read the SAME table the scene builder (ringworld.mjs, which re-exports it) does -- never a second hand-kept list of boards.
/** The six mapper/mirroring pairs of the acceptance table (plan 2.5). `ring` is the STREAM_RING value the pair must build with. */
export const CELLS = [
  { id: 'MMC1-V', mapper: 1, mirroring: 'vertical', ring: 1, header: { mapper: 1, mirror: 'V' } },
  { id: 'MMC1-H', mapper: 1, mirroring: 'horizontal', ring: 2, header: { mapper: 1, mirror: 'H' } },
  { id: 'MMC3-V', mapper: 4, mirroring: 'vertical', ring: 1, header: { mapper: 4, mirror: 'V' } },
  { id: 'MMC3-H', mapper: 4, mirroring: 'horizontal', ring: 2, header: { mapper: 4, mirror: 'H' } },
  { id: 'U512-V', mapper: 30, mirroring: 'vertical', ring: 1, header: { mapper: 30, mirror: 'V' } },
  { id: 'U512-H', mapper: 30, mirroring: 'horizontal', ring: 2, header: { mapper: 30, mirror: 'H' } }
];
export const cellById = (id) => CELLS.find((c) => c.id === id) ?? (() => { throw new Error(`unknown ring cell ${id}`); })();
export const GAME_TYPES = ['action', 'rpg'];
