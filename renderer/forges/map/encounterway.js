// The Map Forge's "Use the actor list again" (group -> legacy), as the one place that decides whether a confirmed
// answer may still be acted on. The confirmation is awaited, and while it is open the project can move (Undo, an edit),
// the author can pick another map, or the Forge can be left and destroyed -- none of the last two bumps the Store's
// revision. So everything that says "the thing I asked about is still current" is checked here, AFTER the await and
// BEFORE `store.commit`, and the target is re-read from the store at that moment.
import { applyUseLegacyList, planUseLegacyList } from '../../../shared/encountergroups.js';

/**
 * `isCurrent()` answers whether this Forge is still mounted and still has `mapIndex` selected (the caller closes over its
 * own lifetime flag and selection). `confirm()` resolves true only for the confirming action; null (every dismissal) and
 * false cancel. Resolves 'refused' (the map cannot go back: not in group mode), 'cancelled' (dismissed), 'stale'
 * (revision, selection or lifetime moved while the dialog was open -- nothing committed), or 'committed' (exactly one
 * commit). A refusal and a stale answer leave project, undo/redo, dirty and revision untouched.
 */
export async function confirmUseActorListAgain(store, mapIndex, { confirm, isCurrent }) {
  if (!planUseLegacyList(store.project, mapIndex).ok) return 'refused';
  const revision = store.revision;
  if (!(await confirm())) return 'cancelled';
  if (!isCurrent() || store.revision !== revision) return 'stale';
  if (!planUseLegacyList(store.project, mapIndex).ok) return 'refused';
  store.commit('Use the encounter actor list again', (project) => {
    applyUseLegacyList(project, mapIndex);
  });
  return 'committed';
}
