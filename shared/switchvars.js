// Pure helpers for the debugger's switch/variable inspector: address math,
// bit packing, name resolution, and "can this build even be read" -- kept
// free of DOM/Node APIs so a unit test can reach them directly, the same
// reasoning enginesyms.js documents for testplay.js.
//
// engine/constants.asm packs the 64 switches into 8 bytes, bit (n & 7) of
// byte (n >> 3), and lays variables out one byte per counter -- switchBit is
// that packing written once rather than re-derived at each call site, and
// switchAddress/variableAddress are the one place `ram.switches`/`ram.variables`
// are added to an index to get somewhere to peek or poke.

import { missingEquates } from './enginesyms.js';

/** Engine RAM the inspector needs, by the names constants.asm gives them. */
export const REQUIRED_RAM = ['switches', 'NUM_SWITCHES', 'variables'];

/**
 * Why the switch/variable inspector cannot show anything for this build, or
 * null if it can. `numVariables` is NUM_VARIABLES out of the build's own
 * `assets/config.inc` -- generated from RPG_LIMITS.variables rather than
 * defined in constants.asm, so it is read and checked separately from `ram`
 * rather than folded into REQUIRED_RAM.
 */
export function inspectorProblem({ ram, numVariables }) {
  if (!ram) return 'the engine constants for this build could not be read';
  const missing = missingEquates(ram, REQUIRED_RAM);
  if (missing.length) return `engine/constants.asm no longer defines ${missing.join(', ')}`;
  if (typeof numVariables !== 'number') return "the build's config.inc does not define NUM_VARIABLES";
  return null;
}

/** The byte offset and bit mask holding switch `index`, within the switches array. */
export function switchBit(index) {
  return { byteOffset: index >> 3, mask: 1 << (index & 7) };
}

/** The absolute address of switch `index`'s byte, given the build's parsed `ram` equates. */
export function switchAddress(ram, index) {
  return ram.switches + switchBit(index).byteOffset;
}

/** The absolute address of variable `index`, given the build's parsed `ram` equates. */
export function variableAddress(ram, index) {
  return ram.variables + index;
}

/** Switch `index`'s value, given a `peek(address)` reader and the array's base address. */
export function readSwitch(peek, base, index) {
  const { byteOffset, mask } = switchBit(index);
  return (peek(base + byteOffset) & mask) !== 0;
}

/** Set switch `index` on or off, preserving the other seven bits of its byte. */
export function writeSwitch(peek, poke, base, index, on) {
  const { byteOffset, mask } = switchBit(index);
  const current = peek(base + byteOffset);
  poke(base + byteOffset, on ? current | mask : current & ~mask);
}

/** A switch or variable's label: its authored name, or its number if it has none. */
export function labelFor(names, index, kind) {
  const name = names?.[index]?.trim();
  return name || `${kind} ${index}`;
}

/**
 * A variable input's text, coerced to what `emulator.poke`'s own `& 0xff`
 * would actually store: truncated toward zero (not rounded) and clamped to
 * 0-255. Kept as one function so the field's displayed value and the byte
 * poked into RAM are computed the same way and cannot disagree -- entering
 * "42.9" must show 42, the same 42 that lands in RAM, not 42.9 beside a 42
 * nobody sees.
 */
export function clampByte(text) {
  return Math.max(0, Math.min(255, Math.trunc(Number(text)) || 0));
}
