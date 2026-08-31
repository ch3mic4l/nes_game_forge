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
 * The only ops a route's own `legs` may hold. A route's legs are real,
 * normalized move/turn/wait command records — not an arbitrary nested list
 * the way a branch's `then`/`else` or a choice's own options are — so this
 * is a fixed, small vocabulary rather than a depth-limited recursion into
 * `EVENT_COMMANDS` as a whole. See design-routes.md §3.1/§3.3.
 */
export const ROUTE_LEG_OPS = new Set(['move', 'turn', 'wait']);

/**
 * The legs a route may actually hold, compile, or count — the single
 * admission filter every reader of a route's actual `.legs` array shares,
 * seven of them: the normalizer (shared/project.js), `isLive`,
 * `liveCommands`' recursion (both above), the compiler
 * (main/build/textcompile.js), the editor's own row canonicalization
 * (renderer/forges/map/events.js's commandRow, which reassigns
 * `command.legs` to this function's own result at render time), the
 * summary line (`describeEnabled`'s route case, same file), and the
 * preview's pure trace-model function (`routeTrace`, same file). The
 * editor's leg-*adding* dropdown is a separate, smaller thing: it filters
 * the static `EVENT_COMMANDS` catalog through `ROUTE_LEG_OPS` (the `Set`
 * above) directly, not this function, since there is no `.legs` array to
 * filter when deciding what may be added. Defends a live, not-yet-normalized
 * project the same way `choiceOptionsSlice` already defends a live choice —
 * `buildProject` compiles whatever the app is holding, not a freshly
 * normalized copy.
 */
export const routeLegs = (legs) =>
  (Array.isArray(legs) ? legs : []).filter((leg) => ROUTE_LEG_OPS.has(leg?.op));

/**
 * A route leg as the move/turn/wait command it actually is, with the
 * route's own `who` injected — legs never store their own `who`
 * (design-routes.md §3.2). Used identically by the compiler
 * (main/build/textcompile.js's 'route' case) and the Map Forge's own
 * describeCommand, so the ROM and the editor's summary line can never
 * disagree about which who a leg means.
 */
export const legWithWho = (leg, who) =>
  leg.op === 'move' || leg.op === 'turn' ? { ...leg, who } : leg;

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
  // A route is asked about its contents the same way a branch is: a route
  // with nothing live inside it (empty, every leg switched off, or every leg
  // an illegal op routeLegs already filters out) is not a thing that
  // happened on the page, and must not keep a page "alive" the way an empty
  // branch must not. routeLegs, not a raw command.legs.some(...), so a
  // live-but-unadmitted leg is never read as making the route live — it
  // would compile to nothing were the project built as-is.
  if (command.op === 'route') return routeLegs(command.legs).some(isLive);
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
    // The third shape this walk has to know about. Deliberately NOT filtered
    // through routeLegs -- allCommands answers "what is mentioned," not
    // "what compiles," and an illegally-shaped leg about to be dropped at
    // normalize time costs nothing to have briefly been visited by a
    // renumbering walk that finds nothing on it relevant to renumber.
    yield* allCommands(command.legs);
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
 * per-opcode semantic validity. `call` used to be a documented exception
 * here (a dangling reference used to compile away while this generator kept
 * yielding it regardless) but is not any longer: encodeCommand's own 'call'
 * case (main/build/textcompile.js) always emits [OP_CALL,
 * NO_COMMON_EVENT_SLOT] for a reference that does not resolve, so a live
 * `call` this generator yields always agrees with what actually compiles
 * (test/unit/project.test.js's own dangling-call assertions pin this).
 *
 * A route is the one deliberate departure from "yield the command, then
 * recurse into whatever it holds" every other container above follows —
 * not a new exception, but the same "yield what encodeBody emits" contract
 * applied correctly to a container that emits nothing of its own: branch
 * and choice are yielded because encodeBody genuinely writes an
 * OP_IF/OP_CHOICE byte for them, while a route contributes no opcode at
 * all, so this recurses into its admitted legs instead of yielding the
 * wrapper. See the route branch below and design-routes.md §5.2.
 */
export function* liveCommands(list, choiceOptionLimit) {
  if (!Number.isInteger(choiceOptionLimit) || choiceOptionLimit < 0) {
    throw new Error(
      'liveCommands requires choiceOptionLimit (CHOICE_LIMITS.options) — there is no default that would not ' +
        'silently repeat the divergence a limit exists to close.'
    );
  }
  for (const command of enabledCommands({ commands: list })) {
    // A route contributes no opcode of its own -- encodeBody's route case
    // (main/build/textcompile.js) emits nothing but its own admitted legs'
    // bytes -- so this recurses into them INSTEAD OF yielding the route
    // command itself. routeLegs, not raw command.legs: the same admission
    // filter isLive's route branch and the compiler's route case already
    // apply, so a live, not-yet-normalized route holding a disallowed leg
    // op is never counted as though it compiled to something it will not.
    if (command.op === 'route') {
      yield* liveCommands(routeLegs(command.legs), choiceOptionLimit);
      continue;
    }
    yield command;
    yield* liveCommands(command.then, choiceOptionLimit);
    yield* liveCommands(command.else, choiceOptionLimit);
    for (const option of choiceOptionsSlice(command.options, choiceOptionLimit)) {
      yield* liveCommands(option.commands, choiceOptionLimit);
    }
  }
}

/**
 * A Heal/Damage command's `value` field as the byte it means, rounded to the
 * nearest whole number and clamped to 0-255 — the single clamp for that
 * field, full stop. Everything that ever has to decide what one of these
 * commands is worth calls this rather than writing its own 0-255 clamp:
 * `normalizeEventCommand` (shared/project.js) for what gets saved,
 * `encodeCommand` (main/build/textcompile.js) for the byte written to the
 * ROM, `projectUsesCombat` (shared/font.js) for whether a live Damage can
 * reach the player at all, and the Map Forge's own number field
 * (renderer/forges/map/events.js) for what a keystroke turns into. A second,
 * independently-written clamp is exactly how this used to go wrong: an
 * un-normalized fractional value (hand-edited JSON, or a project written by
 * a later version) truncated one way through one clamp and rounded another
 * way through a second, so a save round-trip alone could turn a harmless
 * `Damage 0.6` into a real `Damage 1`. Rounds rather than truncates to match
 * `normalizeEventCommand`'s existing `clamp()` behaviour, so no project that
 * has already been through it changes meaning. Takes the bare value, not a
 * command object, so a raw keystroke or a raw `value` field is exactly as
 * valid an input as an already-shaped command's `.value`.
 */
export const damageAmount = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(255, Math.round(number)));
};

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
