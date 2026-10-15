// A SYNTHETIC two-nametable board for the two refusal arms no registered board reaches any more (phase 3b S5, C2).
//
// `streamedBoardProblems` (shared/project.js) keeps two arms for a streamable board whose registry datum says less than "everything":
//   * `capability` ("not implemented yet on this board"): a ring board WITHOUT `streamRingGameTypes`;
//   * `ringGame`: a ring board whose `streamRingGameTypes` does not list this project's game type.
// Since S4c every registered board has the datum and since S5 each lists both game types, so neither arm can fire for a real board. They stay as guards for a streamable board
// added without its datum (Chris, 2026-10-14: keep both, pinned by a test on a synthetic board). This helper registers such a board for the duration of `fn`: a deep copy of
// MMC3's registry entry under an id and name no real board has, with the datum set to `gameTypes` (undefined = absent). The registry is restored in `finally`, also on a throw.
// Production code is not edited: the entry lives in the exported `MAPPERS` array only while the callback runs.
import { MAPPERS } from '../../shared/cartridge.js';

export const SYNTHETIC_ID = 99;
export const SYNTHETIC_NAME = 'Synthetic board';

export function withSyntheticBoard(gameTypes, fn) {
  const template = MAPPERS.find((m) => m.id === 4);
  const board = { ...structuredClone(template), id: SYNTHETIC_ID, name: SYNTHETIC_NAME, supported: true };
  delete board.streamRingGameTypes;
  if (gameTypes !== undefined) board.streamRingGameTypes = gameTypes;
  if (MAPPERS.some((m) => m.id === SYNTHETIC_ID)) throw new Error('the synthetic board is already registered');
  MAPPERS.push(board);
  try {
    return fn(SYNTHETIC_ID, board);
  } finally {
    MAPPERS.splice(MAPPERS.findIndex((m) => m.id === SYNTHETIC_ID), 1);
  }
}
