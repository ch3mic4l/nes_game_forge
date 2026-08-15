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
  // A question is not asked about its contents the way a branch is. A branch
  // with nothing live inside it is invisible — the player never learns it was
  // there — but a question with two empty options still stops the conversation
  // and waits to be answered, which is a thing that happened on screen.
  if (command.op === 'choice') return (command.options ?? []).length > 0;
  return true;
};

/** The commands a page runs. A switched-off one is authoring scaffolding. */
export const enabledCommands = (page) => (page?.commands ?? []).filter(isLive);

/**
 * Every command in a list, including the ones inside the commands that hold
 * commands — a branch's two sides, a question's answers, and whatever those
 * hold in turn.
 *
 * Anything asking "does this event mention X" has to walk this rather than the
 * top level. A switch set inside a branch was invisible to the template
 * allocator, which handed the same switch to something else and coupled two
 * unrelated events; an answer is a second place to hide, and there will be a
 * third. Switched-off commands are included: the toggle is about what the ROM
 * runs, and a switch named by a command you are about to switch back on is not
 * a switch anybody else should be given.
 */
export function* allCommands(list) {
  for (const command of list ?? []) {
    yield command;
    yield* allCommands(command.then);
    yield* allCommands(command.else);
    for (const option of command.options ?? []) yield* allCommands(option.commands);
  }
}

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

/**
 * Every event body the project holds: each placed actor's, and every common
 * event's. A common event is not reached by walking a placement's own
 * commands — a `call` names it by index rather than holding its pages — so
 * anything that has to know what the whole project can show or set (does it
 * use text at all, which switches are already spoken for) walks this instead
 * of the placed actors alone. That is also why this needs no special handling
 * for a `call`: a called common event's own switches and text are found by
 * this same walk visiting it directly, not by following the reference.
 */
export function* projectEvents(project) {
  for (const map of project?.maps ?? []) {
    for (const screen of map.screens ?? []) {
      for (const entity of screen.entities ?? []) {
        if (entity.props?.event) yield entity.props.event;
      }
    }
  }
  for (const entry of project?.commonEvents ?? []) {
    if (entry.event) yield entry.event;
  }
}
