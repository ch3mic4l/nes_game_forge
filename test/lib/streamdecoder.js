// A test-only decoder for the streamed-world emitted layout, written from
// docs/design-streamed-worlds.md §3 and deliberately NOT from shared/streamlayout.js: every
// number below is spelled out (a decoder reading the table it checks proves nothing).
//
// decodeStreamedLayout(layout) -> { mapCount, mapBase, total, isStreamed(i), streamed(i) ->
//   { tileset, fill, baseBank, regionsPerRow, gridW, gridH }, screen(mapIndex, col, row) ->
//   { terrain, entities, bound }, resolve(id) }
// `layout` is emitStreamedLayout's return; only its bytes are read, never its `description` fields.

const RECORD = 338; // from docs/design-streamed-worlds.md §3: 240 + (1 + 8*9) + (1 + 8*3)
const PER_REGION = 24; // from §3: STREAM_SCREENS_PER_REGION = 24

export function decodeStreamedLayout(layout) {
  const mapCount = layout.mapBase.length;
  const isStreamed = (i) => ((layout.typeBits[i >> 3] >> (i & 7)) & 1) === 1;
  // compact index of a streamed map = the streamed maps strictly before it
  const compact = (i) => {
    let n = 0;
    for (let k = 0; k < i; k++) if (isStreamed(k)) n++;
    return n;
  };
  const streamed = (i) => {
    const c = compact(i) * 6; // §3: 6 streamed-only bytes per map
    const [tileset, fill, baseBank, regionsPerRow, gridW, gridH] = layout.streamedColumns.slice(c, c + 6);
    return { tileset, fill, baseBank, regionsPerRow, gridW, gridH };
  };
  // The metadata accessor of §3: Y reaches 0-255 of one base; past that the base moves by $100
  // and Y = offset - 256.
  const meta = (record, offset) => {
    if (offset < 256) return record[offset];
    const base = 256;
    return record[base + (offset - 256)];
  };
  const screen = (mapIndex, col, row) => {
    const g = streamed(mapIndex);
    const map = layout.maps[mapIndex];
    const region = map.regions[row * g.regionsPerRow + Math.floor(col / PER_REGION)];
    const at = (col % PER_REGION) * RECORD;
    const record = region.bytes.slice(at, at + RECORD);
    if (record.length !== RECORD) throw new Error('record runs off its region');
    const entities = [];
    const n = meta(record, 240);
    for (let e = 0; e < n; e++) {
      const o = 241 + e * 9;
      entities.push({
        actor: meta(record, o),
        x: meta(record, o + 1),
        y: meta(record, o + 2),
        target: meta(record, o + 3),
        toX: meta(record, o + 4),
        toY: meta(record, o + 5),
        event: meta(record, o + 6),
        trigger: meta(record, o + 7),
        hideSwitch: meta(record, o + 8)
      });
    }
    const bound = [];
    const b = meta(record, 313);
    for (let k = 0; k < b; k++) {
      const o = 314 + k * 3;
      bound.push({ switchId: meta(record, o), cell: meta(record, o + 1), metatileId: meta(record, o + 2) });
    }
    return { terrain: record.slice(0, 240), entities, bound, length: record.length };
  };
  // the prefix walk: first map whose next base exceeds the id
  const resolve = (id) => {
    let ordinary = 0;
    let streamedMaps = 0;
    for (let i = 0; i < mapCount; i++) {
      const next = i + 1 < mapCount ? layout.mapBase[i + 1] : layout.total;
      if (id < next) {
        if (!isStreamed(i)) return { map: i, streamed: false, ordinaryIndex: ordinary + (id - layout.mapBase[i]) };
        const w = streamed(i).gridW;
        const off = id - layout.mapBase[i];
        return { map: i, streamed: true, streamedMapIndex: streamedMaps, col: off % w, row: Math.floor(off / w) };
      }
      if (isStreamed(i)) streamedMaps++;
      else ordinary += next - layout.mapBase[i];
    }
    return null;
  };
  return { mapCount, mapBase: layout.mapBase, total: layout.total, isStreamed, streamed, screen, resolve };
}
