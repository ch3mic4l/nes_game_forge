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
 * A choice command's own options, truncated to how many the message box has
 * rows for. The single definition `encodeBody` (main/build/textcompile.js)
 * and `liveCommands` below both slice by, so the bound can only be changed
 * in the one place rather than in two definitions that can drift apart —
 * exactly what let a live, not-yet-normalized fifth option compile away
 * silently while `liveCommands` still counted it as reachable. `limit` is
 * `CHOICE_LIMITS.options` (shared/project.js), passed in rather than
 * imported for the reason `liveCommands` explains below.
 */
export const choiceOptionsSlice = (options, limit) => (Array.isArray(options) ? options : []).slice(0, limit);

/**
 * Every command the compiler would actually emit from a page's own list: the
 * same traversal `encodeBody` (main/build/textcompile.js) performs, so a
 * check asking "would the compiler run this" gets the compiler's own answer
 * rather than a second guess at it that can disagree. `allCommands` exists
 * for the opposite question — what a switch or actor is *named by*, off or
 * not — and must not be reused here: a battle command sitting inside a
 * disabled branch would fail a build the ROM was never going to contain.
 *
 * `choiceOptionLimit` is `CHOICE_LIMITS.options` (shared/project.js), passed
 * in rather than imported: that constant is derived from the message box's
 * own row count in `shared/font.js`, and this module cannot import either
 * without the cycle the file header explains. `encodeBody` truncates a live,
 * not-yet-normalized choice to that same limit before encoding a single one
 * of its options, so a fifth option — live or not — never reaches the ROM.
 *
 * Required, not defaulted: an unbounded walk is exactly the divergence a
 * caller forgetting this argument used to reproduce silently — validation
 * would see and approve a fifth option's battle command the compiler was
 * always going to drop, and read that agreement as proof of nothing. A
 * caller that is not asking what compiles has no business calling this at
 * all; `allCommands` is the walk that does not care.
 *
 * Structural liveness only — off, nesting, and this one option limit — not
 * per-opcode semantic validity. A `call` naming a common event id nothing
 * defines is structurally live (not switched off, not past a limit) and is
 * yielded here, even though `encodeCommand`'s own 'call' case
 * (main/build/textcompile.js) resolves the reference and compiles it away
 * when it does not. Telling the two apart would mean threading the live
 * common event table through this traversal for the sake of one opcode;
 * an empty battle formation and a missing give/take actor are the same
 * shape of gap, both left to validateProject's own per-opcode checks rather
 * than folded in here. A caller comparing this against a real compile has
 * to know that `call` in particular can lie in the optimistic direction.
 */
export function* liveCommands(list, choiceOptionLimit) {
  if (!Number.isInteger(choiceOptionLimit) || choiceOptionLimit < 0) {
    throw new Error(
      'liveCommands requires choiceOptionLimit (CHOICE_LIMITS.options) — there is no default that would not ' +
        'silently repeat the divergence a limit exists to close.'
    );
  }
  for (const command of enabledCommands({ commands: list })) {
    yield command;
    yield* liveCommands(command.then, choiceOptionLimit);
    yield* liveCommands(command.else, choiceOptionLimit);
    for (const option of choiceOptionsSlice(command.options, choiceOptionLimit)) {
      yield* liveCommands(option.commands, choiceOptionLimit);
    }
  }
}

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
