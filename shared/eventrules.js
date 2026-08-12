// What an event actually runs — the single writer of that, for everybody.
//
// This is its own module rather than part of `project.js` because `font.js`
// needs it too, and `project.js` already imports `font.js`. Putting it in
// either would mean a cycle or a second copy of the rule, and a second copy is
// how the compiler and the font reservation end up disagreeing about whether a
// project shows any text at all.
//
// `project.js` re-exports both, so the schema stays the one place to look.

/**
 * The commands a page runs. A switched-off one is authoring scaffolding.
 *
 * `!== true` rather than a truthiness test, to match the schema exactly:
 * normalization keeps `off` only when it is literally true, so anything else
 * means enabled. Reading `{ off: 'yes' }` as disabled here would have this
 * module and `normalizeEventCommand` give opposite answers about the same
 * hand-edited project, depending on whether it had been through normalization.
 */
export const enabledCommands = (page) => (page?.commands ?? []).filter((command) => command?.off !== true);

/**
 * The pages that reach the ROM.
 *
 * A page whose commands are all switched off still *matches*, and a matching
 * page that does nothing swallows every page below it — so it has to leave the
 * ROM with them. Disabling the only command on page 1 would otherwise silently
 * turn the whole event off, which is the same failure as an empty page and cost
 * real debugging time before the editor learned to drop those.
 */
export const compiledPages = (event) =>
  (event?.pages ?? []).filter((page) => enabledCommands(page).length > 0);

/** Whether an entity's event puts anything at all into the build. */
export const entityHasLiveEvent = (entity) => compiledPages(entity?.props?.event).length > 0;
