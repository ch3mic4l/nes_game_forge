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
 * Whether a command would do anything if the page it is on ran.
 *
 * `!== true` rather than a truthiness test, to match the schema exactly:
 * normalization keeps `off` only when it is literally true, so anything else
 * means enabled. Reading `{ off: 'yes' }` as disabled here would have this
 * module and `normalizeEventCommand` give opposite answers about the same
 * hand-edited project, depending on whether it had been through normalization.
 *
 * A branch has to be asked about its contents rather than about itself. One with
 * nothing live inside it is not scaffolding that happens to be switched on: it
 * is a command that does nothing, and a page whose commands are all of that kind
 * is a page that matches and does nothing — which swallows every page below it
 * and the plain dialogue underneath them. That is the same failure an empty page
 * causes, and it must be the same answer.
 */
const isLive = (command) => {
  if (!command || command.off === true) return false;
  if (command.op === 'branch') {
    return [...(command.then ?? []), ...(command.else ?? [])].some(isLive);
  }
  return true;
};

/** The commands a page runs. A switched-off one is authoring scaffolding. */
export const enabledCommands = (page) => (page?.commands ?? []).filter(isLive);

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
