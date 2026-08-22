// The isLive-gated sequence behind mounting a player (renderer/forges/build/
// build.js's own play()): read the ROM, its symbols, and the two generated
// files the debugger needs, checking `isLive()` after every one of those
// reads and before anything else — Close or a Forge navigation can land
// during any one of them, not only during the build that produced what
// they're reading (round 7 review's finding 3: a failed readRom used to
// toast, and a failed constants.asm read used to write a log warning,
// before either checked whether anyone was still there to see it).
//
// Every read is a parameter, not an import, so a test can hand in a
// controllable, deferred promise for any one of them and flip `isLive()` in
// between — deterministically, with no real IPC latency and no timing hook
// added to production code, the same reasoning shared/reloadcoordinator.js
// already gives for its own dependency injection.
//
// Pure: never toasts, never writes to a log, never touches the DOM. Its
// caller owns every visible effect — reporting a failure reason, showing the
// constants-read warning, mounting the player — because only the caller,
// holding the actual UI, can answer "is there still anyone to see this
// specific toast" for its own copy; this module already answers the
// upstream question of whether to keep going at all.

import { parseEquates } from './enginesyms.js';

/**
 * @param {object} deps
 * @param {() => Promise<{ok: boolean, value?: ArrayBuffer, error?: string}>} deps.readRom
 * @param {() => Promise<{ok: boolean, value?: object, error?: string}>} deps.readSymbols
 *   resolves to `{ok: true, value: {}}` when there is nothing to read at all
 *   (a build with no symbol file) — the caller's job, not this module's, so
 *   this stays a uniform four-step sequence rather than a conditional one.
 * @param {() => Promise<{ok: boolean, value?: string, error?: string}>} deps.readConstants
 *   the raw text of constants.asm; parsed here with parseEquates so the
 *   caller never has to.
 * @param {() => Promise<{ok: boolean, value?: string, error?: string}>} deps.readConfig
 *   the raw text of assets/config.inc, likewise parsed here.
 * @param {() => boolean} [deps.isLive]
 * @returns {Promise<{ok: true, rom: ArrayBuffer, symbols: object, ram: object|null,
 *   numVariables: number|null, battleEnabled: boolean, constantsWarning: string|null}
 *   | {ok: false, reason?: string}>} `reason` is only ever set when a genuine failure
 *   (not abandonment) is what stopped this — the one case the caller should
 *   still toast.
 */
export async function preparePlaySession({ readRom, readSymbols, readConstants, readConfig, isLive = () => true }) {
  const rom = await readRom();
  if (!isLive()) return { ok: false };
  if (!rom.ok) return { ok: false, reason: rom.error };

  const symbolsResult = await readSymbols();
  if (!isLive()) return { ok: false };
  const symbols = symbolsResult.ok ? symbolsResult.value : {};

  const constants = await readConstants();
  if (!isLive()) return { ok: false };
  const ram = constants.ok ? parseEquates(constants.value) : null;
  const constantsWarning = constants.ok ? null : constants.error;

  const config = await readConfig();
  if (!isLive()) return { ok: false };
  let numVariables = null;
  let battleEnabled = false;
  if (config.ok) {
    // NUM_VARIABLES is generated into config.inc from RPG_LIMITS.variables —
    // not constants.asm — so how many variables the inspector can show is
    // read from there rather than the JS constant, the same single-writer
    // reasoning. battleEnabled is BATTLE_ENABLED out of the same file — the
    // single source for "is this an RPG-battle build," kept separate from
    // whether a symbol merely happens to exist, which a Code Forge override
    // can desync from the generated game type in either direction.
    const configEquates = parseEquates(config.value);
    numVariables = configEquates.NUM_VARIABLES ?? null;
    battleEnabled = configEquates.BATTLE_ENABLED === 1;
  }

  return { ok: true, rom: rom.value, symbols, ram, numVariables, battleEnabled, constantsWarning };
}
