// The text-box CLOSE scenarios of the M11 campaign's `closes` stage (the Say/Move overrun fix): every kind of streamed close, each measured
// full-system in Mesen on the deep streamed scene the Move cells use (the touch actor sits near the bottom of the world, where a close row
// resolves its terrain at the greatest depth), and every one held to the gate G <= 29,780 with no exemption.
//
//   plain-say     Say. One page: ENDWAIT, a press, the close.
//   multi-page    Say, Say. The second page reuses the box (a clear, not a close); the close follows the last page.
//   choice        Say, then a two-option Choice: the pick closes the box.
//   end           Say, End, and a Say that must never run: the End closes the box.
//   deferred-save Say, Save: the Save is deferred until the close has finished.
//   say-tail      Move player down, Say: the box opens at the end of the Move and closes on the press after it.
//   (close-for-Move is the existing `lead` stage -- a Say before the Move; its close is gated and its expectation names one close.)
//
// A scenario is { cmds, presses, frames, closes, title?, moves? }: the touch event's commands, the frame offsets (from the start of the measured phase, where
// the player is walking down into the touch actor) at which B is held for two frames, the phase length, and the number of closes the event
// authors. The presses are a fixed cadence, not a reaction to the box: a press while the box types is ignored, and one after the close finds
// nothing to answer. The expectation (validateCell's `closes`) is what makes that safe: a schedule that missed a wait would show too few
// closes, and the cell fails closed.
const say = (text) => ({ op: 'say', text });
const CADENCE = [235, 280, 325, 370, 415, 460, 505];
const common = { presses: CADENCE, frames: 600 };

export const SCENARIOS = {
  'plain-say': { ...common, cmds: [say('Hi.')], closes: 1 },
  'multi-page': { ...common, cmds: [say('Hi.'), say('Ho.')], closes: 1 },
  choice: { ...common, cmds: [say('Pick.'), { op: 'choice', options: [{ text: 'Yes', commands: [] }, { text: 'No', commands: [] }] }], closes: 1, marks: ['script_op_choice'] },
  end: { ...common, cmds: [say('Hi.'), { op: 'end' }, say('Never.')], closes: 1 },
  // Save needs a title screen (a project with a Save command is refused without one), so this scene boots to the title and the harness holds Start
  'deferred-save': { ...common, cmds: [say('Hi.'), { op: 'save' }], closes: 1, title: true, marks: ['script_op_save'] },
  // B during a script Move cancels it, so no press may land before the Move has finished (~100 frames from the touch at ~192) and the tail box is up
  'say-tail': { presses: [400, 445, 490, 535], frames: 600, cmds: [{ op: 'move', who: 'player', dir: 'down', dist: 150 }, say('Hi.')], closes: 1, moves: true }
};
export const SCENARIO_NAMES = Object.keys(SCENARIOS);

const get = (name) => {
  const s = SCENARIOS[name];
  if (!s) throw new Error(`unknown close scenario ${name}`);
  return s;
};
export const scenarioScript = (name) => ({ cmds: get(name).cmds, presses: get(name).presses, frames: get(name).frames, title: Boolean(get(name).title), marks: get(name).marks ?? [] });
export const scenarioCloses = (name) => get(name).closes;
/** The handlers a scenario's close must have been reached through (a mark the run must have recorded: the command really ran). */
export const scenarioMarks = (name) => get(name).marks ?? [];
/** What the scenario's Move bodies must show (a Move-free scenario has none). */
export const scenarioExpect = (name) => ({ ...(get(name).moves ? { step: 'strip', final: true } : { step: false, final: false }), ran: scenarioMarks(name) });
