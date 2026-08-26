// The save record — its layout, size and identity, in one place, for either
// medium the engine can hold it in.
//
// `engine/save.asm` writes and reads this shape at SAVE_BASE, which is
// media-dependent (main/build/generate.js): battery RAM at $6000+ on MMC1
// and MMC3, or a plain RAM buffer a flash driver commits to PRG-ROM on
// UNROM 512 (engine/flash.asm). The shape this file describes is identical
// either way -- only where it lives differs, and save.asm's own routines
// address it as `SAVE_BASE,y` throughout for exactly that reason.
// `main/build/generate.js` emits the field offsets, its total size and its
// identity byte into `assets/save.inc` from the exact same list below, so the
// engine never spells an offset that this module did not hand it. Neither
// side of that boundary invents its own number.
//
// Field order here is also the write/read order in engine/save.asm — reordering
// this list changes nothing about correctness (every field is addressed by its
// generated offset, not by position) but does change the identity byte below,
// which is exactly the point: a reordered or resized record must not be read
// as an old one's.

import { RPG_LIMITS, projectUsesItems } from './project.js';

/**
 * `inv_items`' size (engine/constants.asm's `MAX_ITEMS`). Hardcoded there,
 * not generated — the same "two literals that happen to agree" situation
 * `NUM_SWITCHES` is already in, and for the same reason: nothing today makes
 * either project-configurable. If that ever changes, this is the JS side that
 * would need to become the generated one.
 */
export const MAX_ITEMS = 8;

/**
 * Bumped by hand whenever this list's *shape* changes in a way its own sizes
 * would not otherwise catch — reordering fields, splitting one, changing what
 * a byte means. A version number nobody has to remember to bump is the point
 * of deriving `saveIdentity` from the sizes below; this one covers the part
 * that cannot be derived, a change to what the bytes mean rather than how many
 * there are.
 *
 * 1 -> 2 (phase 4b): `inv_items`' own bytes can now mean an item id rather
 * than an actor id (engine/save.asm's `.if ITEMS_ENABLED` bound switches
 * between NUM_ITEMS and NUM_ACTORS on exactly this). `SAVE_FIELDS` below is
 * unchanged -- same field, same size -- which is exactly the case this
 * version exists for: a meaning change `saveIdentity`'s derived sizes cannot
 * catch on their own. The bump is engine-wide and unconditional, for every
 * project built with this engine version, regardless of whether that
 * particular project's own `ITEMS_ENABLED` happens to be on: the
 * *capability* exists in the binary the moment this ships, so any save from
 * the prior engine version must stop validating, not only saves from
 * projects that use items. What an author sees: nothing special -- an old
 * save fails `save_check_valid`'s very first identity compare and is
 * treated exactly like a foreign or corrupted one, the same path a save from
 * a different project already takes. The title screen simply does not offer
 * Continue.
 */
export const SAVE_LAYOUT_VERSION = 2;

/**
 * Every field the record carries, and the RAM array or scalar it comes from.
 * `size` is a literal for every fixed-size engine array, and `RPG_LIMITS.variables`
 * for the one field whose length is itself project-independent-but-generated
 * (see NUM_VARIABLES in engine/constants.asm). `ram` is the engine label the
 * field is copied to/from — engine/save.asm addresses every field by the
 * generated `SAVE_<RAM LABEL UPPERCASE>` equate, never by a hand-counted offset.
 *
 * What is deliberately absent: `pc_status`. The heal/damage work made it
 * provably zero anywhere outside a battle — cleared at `battle_begin`,
 * `battle_end` *and* `init_session` — so there is no live status left on the
 * field to lose by not serializing it, and a save format is exactly what would
 * have turned that byte's old stale-but-harmless existence into a real bug: a
 * poisoned status read back out of a save into a session that never re-enters
 * a battle to clear it.
 *
 * `cur_map` is the other deliberate absence, and it used to be here: it is
 * not world state, it is `engine/music.asm`'s own cache of which map's song
 * is already playing, and restoring a stale copy of somebody else's cache is
 * exactly how a save/load round trip broke it. `apply_map_music` trusts
 * "`cur_map` matches this screen's map" to mean "and that map's music is
 * already playing" — true everywhere else, because the only other writer of
 * `cur_map` is `apply_map_music` itself, immediately after it starts that
 * music. Restoring a saved `cur_map` here would satisfy the first half of
 * that sentence without the second: `redraw_screen` would see them match and
 * conclude nothing needed to start, and Continue would come back silent.
 * `init_session` already sets `cur_map = NO_MAP` for exactly this reason —
 * "a game over must not inherit it" is the same fact `continue_game`
 * (engine/save.asm) needs, since it runs `init_session` first — so simply
 * not restoring `cur_map` is what lets `apply_map_music` do its ordinary job
 * instead of needing a second, load-specific way to be told to.
 */
export const SAVE_FIELDS = [
  { ram: 'flat_screen', size: 1 },
  { ram: 'player_x', size: 1 },
  { ram: 'player_y', size: 1 },
  { ram: 'player_dir', size: 1 },
  { ram: 'player_hp', size: 1 }, // action-mode hearts; unused but harmless in an RPG
  { ram: 'switches', size: 8 }, // NUM_SWITCHES (constants.asm) is 64 bits = 8 bytes
  { ram: 'variables', size: RPG_LIMITS.variables },
  { ram: 'inv_items', size: MAX_ITEMS },
  { ram: 'inv_count', size: 1 },
  { ram: 'pickups', size: 1 },
  { ram: 'defeated', size: 1 },
  { ram: 'items_used', size: 1 },
  { ram: 'party_size', size: 1 },
  { ram: 'gold_lo', size: 1 },
  { ram: 'gold_hi', size: 1 },
  { ram: 'pc_hp', size: RPG_LIMITS.party },
  { ram: 'pc_hp_max', size: RPG_LIMITS.party },
  { ram: 'pc_mp', size: RPG_LIMITS.party },
  { ram: 'pc_mp_max', size: RPG_LIMITS.party },
  { ram: 'pc_level', size: RPG_LIMITS.party },
  { ram: 'pc_xp_lo', size: RPG_LIMITS.party },
  { ram: 'pc_xp_hi', size: RPG_LIMITS.party },
  { ram: 'pc_in_party', size: RPG_LIMITS.party },
  { ram: 'pc_spells', size: RPG_LIMITS.party }
];

/** Total body size in bytes — everything above, before the checksum and identity. */
export function saveBodySize() {
  return SAVE_FIELDS.reduce((total, field) => total + field.size, 0);
}

/**
 * The record's four-byte fingerprint. First version of this folded in only
 * layout facts — `RPG_LIMITS.variables`, `RPG_LIMITS.party`, `MAX_ITEMS`,
 * `SAVE_LAYOUT_VERSION` — which are the same for every project this engine
 * builds today, making it a *layout* identity, not a project one: reflash a
 * different project with the same engine version onto the same cartridge and
 * the old save's marker and checksum both still matched, because nothing
 * about the identity depended on which project it was. A second round added
 * `screenCount` and `mapCount`. This round adds `actorCount` — the ceiling
 * `draw_actor_icon` (engine/ui.asm) indexes a restored inventory entry
 * against — and `maxLevel` — the ceiling `try_level_up`'s (engine/battleturn.asm)
 * restored party levels are checked against — because those are two more
 * facts a restored value gets trusted as an index into, and a save from a
 * project with a smaller actor roster or a lower level cap is exactly the
 * shape of "different project, same counts elsewhere" collision the second
 * round's own worked example (two 1-map/1-screen projects, one with an
 * actor id the other's roster does not reach) was still open to.
 *
 * A third round found two more of the same shape: `partyCount` — the actual
 * `project.party.length`, not `RPG_LIMITS.party`'s capacity already folded
 * in above — because a project with fewer recruited members than another
 * of otherwise-identical shape is exactly the case `save_check_valid`'s
 * `pc_in_party` bound (engine/save.asm) now exists to catch, and the two are
 * meant to agree, not just the range check alone; and `battleEnabled`,
 * because an action project and an RPG can otherwise feed this function
 * identical inputs. (Earlier text here claimed `maxLevel` folds in as 0 for
 * an action project and that an action record has no `pc_level` field --
 * both wrong: `normalizeProject` leaves `rpg.maxLevel` at its default of 15
 * whether or not the project is an RPG, and `SAVE_FIELDS` below always
 * carries every `pc_*` array regardless of game type, so `maxLevel` alone
 * never distinguished the two. `battleEnabled` is computed the same way
 * `codeRegionCount` -- main/build/generate.js, which this module cannot
 * import without pulling Node-only code into a module the renderer also
 * loads -- already decides whether the battle system assembles at all, so
 * the two must be kept in lockstep by hand if that predicate ever changes.)
 *
 * Phase 4b adds `itemsEnabled` and `itemCount`, the identical shape of fact
 * `battleEnabled`/`actorCount` already are: `save_check_valid`'s own
 * enabled-path bound switches from NUM_ACTORS to NUM_ITEMS on exactly
 * `itemsEnabled`, so two builds that agree on every other count here but
 * disagree on which economy `inv_items` holds must not collide -- and
 * `SAVE_LAYOUT_VERSION`'s own bump to 2 already invalidates every save from
 * before this capability existed at all (see its own docstring), which is a
 * different, coarser guarantee than this one: the version bump separates
 * old engine from new; `itemsEnabled`/`itemCount` separate two same-version
 * projects whose bags mean different things from each other.
 *
 * Folded with a small multiplicative hash (each value XORed in after
 * multiplying the running hash by 33 — a shape often called djb2) rather
 * than a weighted sum, because the weighted sum this replaced collided on
 * its own terms: `(vars:16, party:4, items:8, version:1)` and `(vars:7,
 * party:5, items:8, version:3)` both folded to 135, despite describing
 * genuinely different-shaped records with the same total body length. A
 * weighted sum's collisions are exactly the linear combinations that add
 * up; multiplying before folding in the next value means every input
 * perturbs bits the next input's own weight would not otherwise reach, so
 * an accidental collision between two real project shapes takes actual bad
 * luck rather than solvable arithmetic.
 *
 * Widened from 16 to 32 bits this round, folding two rounds of the djb2
 * step into two 16-bit halves (`hashLo` sees every input, `hashHi` is
 * folded from `hashLo` after each step so it depends on the same inputs by
 * a different path) rather than truncating one 32-bit accumulator down to
 * 16 — SRAM is 8 KB and this record uses well under 100 bytes of it, so the
 * extra two bytes cost nothing, and a wider fingerprint only ever narrows
 * the birthday-bound coincidence this is still not proof against.
 *
 * That bound is the reason this is not, on its own, what makes loading a
 * save safe. **The identity only makes a collision between two
 * differently-shaped projects unlikely; it cannot make one impossible, and
 * it says nothing at all about two projects this fold considers the
 * *same* shape** — same variable/party/item/screen/map/actor/level counts,
 * different content (a different actor roster of the same size, say). Two
 * such projects pass this check every time, by construction, because
 * nothing about their content is in it. What makes a load *safe* — refusing
 * to index a table with a value that does not fit it, whether the record
 * came from a foreign project this check missed or was hand-edited or
 * bit-flipped — is `save_check_valid`'s own range checks in
 * `engine/save.asm`, over the specific values `load_apply_body` is about to
 * trust as indices. Read this identity as what it is: the cheap check that
 * makes misapplying a foreign save merely unlikely. Do not let its presence
 * argue any range check out of the file — remove one and the case this
 * comment describes (identically-shaped, differently-populated) reaches an
 * out-of-bounds index with nothing left to catch it.
 */
export function saveIdentity(project) {
  const screenCount = (project?.maps ?? []).reduce((total, map) => total + (map.screens?.length ?? 0), 0);
  const mapCount = (project?.maps ?? []).length;
  const actorCount = (project?.sprites?.actors ?? []).length;
  const maxLevel = project?.rpg?.maxLevel ?? 0;
  const partyCount = (project?.party ?? []).length;
  const battleEnabled = project?.project?.gameType === 'rpg' ? 1 : 0;
  // Phase 4: itemsEnabled distinguishes a project whose bag holds item ids
  // from an otherwise-identically-shaped one whose bag still holds legacy
  // actor ids -- save_check_valid's own bound switches between NUM_ITEMS and
  // NUM_ACTORS on this exact fact (engine/save.asm), so two projects that
  // agree on every other count here but disagree on it must not collide.
  // itemCount only when enabled -- an items-disabled project's item catalog
  // (if any items[] entries exist despite ITEMS_ENABLED being computed from
  // `.length > 0`, which it cannot, but a future predicate change should not
  // silently start folding in a fact save_check_valid never bounds against)
  // is not one save_check_valid ever bounds against, so it must not be part
  // of what makes two builds' identities differ.
  const itemsEnabled = projectUsesItems(project) ? 1 : 0;
  const itemCount = itemsEnabled ? (project?.items ?? []).length : 0;
  let hashLo = SAVE_LAYOUT_VERSION;
  let hashHi = SAVE_LAYOUT_VERSION;
  for (const value of [
    RPG_LIMITS.variables,
    RPG_LIMITS.party,
    MAX_ITEMS,
    screenCount,
    mapCount,
    actorCount,
    maxLevel,
    partyCount,
    battleEnabled,
    itemsEnabled,
    itemCount
  ]) {
    hashLo = (hashLo * 33) ^ (value & 0xffff);
    hashLo &= 0xffff;
    hashHi = (hashHi * 33) ^ (hashLo & 0xffff);
    hashHi &= 0xffff;
  }
  return ((hashHi << 16) | hashLo) >>> 0;
}
