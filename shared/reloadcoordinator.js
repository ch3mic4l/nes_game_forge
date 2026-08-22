// The decision logic behind "Reload Test" (ROADMAP item 3's last
// bullet-but-one), factored out so it is testable without Electron: every
// effectful step — building, resolving the scenario, mounting the player,
// telling the user — is a parameter here, not an import, so a test can hand
// in a controllable stub for any one of them and observe exactly what the
// real wiring would have done with it. renderer/forges/build/build.js is the
// only production caller, supplying its own `build`/`play`/`toast` and a
// combined `isLive` that also folds in its own "was this Build Forge mount
// destroyed" flag — see that file for why the combining happens there and
// not here.
//
// `isLive` is checked once here, right after the build settles, before this
// module does anything a user could see. It is the caller's job to also
// thread the same predicate into `play`, which re-checks it again after its
// own asynchronous reads — this module only owns the first checkpoint and
// the choice of what to resolve the scenario against.

/**
 * @param {object} deps
 * @param {() => Promise<object|null>} deps.build - rebuild the project; resolves to
 *   null on a failed build, or the build's own result (which must carry the
 *   exact `project` it was assembled from — see resolveScenario below)
 * @param {(project: object) => {startAt: {ok: boolean, value?: any, reason?: string},
 *   battleTest: {ok: boolean, value?: any, reason?: string}}} deps.resolveScenario
 *   resolve the remembered scenario against `project` — always the project
 *   the build just returned, never a second, possibly since-edited read of
 *   whatever is live: store.commit mutates a project in place, so re-reading
 *   it after the build's own await can name an entity the ROM in hand does
 *   not have (an earlier actor deleted during assembly shifts every later
 *   one's id, for instance) — resolving against anything but the build's own
 *   payload can select the wrong ROM entity for a name that still matches.
 * @param {(result: object, options: object) => Promise<any>} deps.play
 * @param {(message: string, kind: string) => void} deps.toast
 * @param {() => boolean} [deps.isLive] - false once this operation's own
 *   world (a Build Forge mount, a specific player) has gone; checked once
 *   here, and threaded into `play` for it to check again
 * @param {() => boolean} [deps.hasPlayer] - which failure sentence is
 *   honest: a live player survives a failed build and keeps running, an idle
 *   Build panel has nothing left to still be running
 * @param {() => object|null} [deps.desiredToggles] read once, right before
 *   `play`, not before the build -- a checkbox flipped on the still-visible,
 *   paused player while its own rebuild is in flight should reach the
 *   session that build produces, not be shadowed by a snapshot taken before
 *   the build even started (the reload could easily be the longest-running
 *   part of this whole operation)
 * @returns {Promise<{ok: boolean}>}
 */
export async function runReloadTest({
  build,
  resolveScenario,
  play,
  toast,
  isLive = () => true,
  hasPlayer = () => false,
  desiredToggles = () => null
}) {
  const result = await build();

  // Nobody is there to see a mount, a toast, or a restored session once this
  // operation's own world is gone — not a refusal, just nothing left to do.
  if (!isLive()) return { ok: false };

  if (!result) {
    toast(
      `Rebuild failed — see the Build log. ${hasPlayer() ? 'Still running the previous build.' : 'Nothing was started.'}`,
      'error'
    );
    return { ok: false };
  }

  const { startAt, battleTest } = resolveScenario(result.project);
  const failed = !startAt.ok ? startAt : !battleTest.ok ? battleTest : null;
  if (failed) {
    toast(`Could not resume the test scenario: ${failed.reason}.`, 'error');
    return { ok: false };
  }

  // play()'s own outcome, not an assumed success -- it can still fail (a
  // failed ROM read, or isLive() catching an abandonment during its own
  // asynchronous reads) after everything above here has already succeeded,
  // and a caller waiting to know whether to restore a paused session's run
  // state needs the real answer, not "we got this far without throwing."
  return play(result, {
    startAt: startAt.value,
    battleTest: battleTest.value,
    desiredToggles: desiredToggles(),
    scenarioBound: true,
    isLive
  });
}
