# Reference: The kernel budget

Current-state reference, moved verbatim out of `CLAUDE.md` on 2026-09-20 so that file stays small
enough to load into every session. Maintain it the way CLAUDE.md was maintained: update it in the
same change that alters what it describes. Cross-references such as "The kernel budget, above" or
"The event system, below" name sibling sections, which are now sibling `docs/reference-*.md`
files; `CLAUDE.md` indexes them all.

### The kernel budget

Move's mechanism is described under "The event system" above; its cost is measured, not
guessed, since hand-written code assembling to an unknown size is exactly what the Code Forge's own
capacity philosophy (below) refuses to model. The kernel-lo bank is a fixed 8,192-byte region shared
by engine code and every project's own lookup tables, and `checkCapacity`
(`main/build/generate.js`) must know both halves exactly. Seven rules hold that model together.

Every figure in "Current allowance figures" further down was re-measured by the zero-page kernel
diet (`docs/design-kernel-diet.md`) and is post-diet; its own §6 records a one-time acceptance step
for that sweep — label order, relocated-table addresses and whole-ROM data equality outside the
swept code — structural and data preservation, not a proof of runtime behaviour, which the test
suite, `npm run smoke` and the Mesen checks assert separately.

- **A conditional feature's cost is a separate generated allowance, never folded into a base.**
  `kernelCodeBytes` charges Move, Turn, Wait, Save, Sting, Sfx, switch-bound tiles, Fade/Flash and
  the MMC3-only font-bank split as their own named `*_KERNEL_ALLOWANCE` terms, gated on the
  predicate that turns the feature on (`projectUsesMove`, `projectUsesSave`, …) — a project never
  using a feature assembles byte-for-byte as if it didn't exist, asserted by
  `move.test.js`, `codebuild.test.js` and neighbours comparing whole ROMs.
- **A term that varies by mapper is measured per mapper**, in a `*_BY_MAPPER` table
  (`BASE_KERNEL_CODE_BYTES_BY_MAPPER`, `TITLE_KERNEL_ALLOWANCE_BY_MAPPER`,
  `SAVE_KERNEL_ALLOWANCE_BY_MAPPER`), never charged to every board at whichever figure is largest.
  Base and title fall back to the largest measured figure for an unmeasured mapper (`??
  FALLBACK_...`), confirmed to leave real margin by `kernelbytes.test.js`. **Save has no fallback**
  — it indexes `SAVE_KERNEL_ALLOWANCE_BY_MAPPER[mapper.id]` directly: a newly implemented save
  medium with no measured entry must fail loudly, not silently inherit another board's figure. The
  converse holds too — **a term stays flat until real variance is measured** — which is why Save's
  own RPG supplement is a bare `SAVE_BATTLE_KERNEL_ALLOWANCE`, not a
  fourth table, while `TITLE_KERNEL_ALLOWANCE_BY_MAPPER`'s MMC3
  entry earned per-mapper shape on a measured 12-byte difference.
- **A term measured against one game type and charged to both is wrong for the one it was not
  measured on, and no delta-based test can see it.** `SAVE_KERNEL_ALLOWANCE_BY_MAPPER` and
  `BASE_KERNEL_CODE_BYTES_BY_MAPPER` both overcharged action projects this way until each was split
  into its action-side per-mapper base plus an RPG-only supplement —
  `BATTLE_KERNEL_ALLOWANCE_BY_MAPPER` for the base, and the flat `SAVE_BATTLE_KERNEL_ALLOWANCE` for
  Save (`docs/kernel-base-overcharge-report.md`); `SPLIT_KERNEL_ALLOWANCE` had the same blind spot
  without the game-type mismatch, measured only as a residual rather than its own delta
  (`docs/split-lock-not-pinned-report.md` §8) — every absolute `assertCovers` check ran only
  against `sample-rpg`, and every action-side check was a delta between two action builds
  that cancelled the base term out. A new allowance needs an
  absolute check on each game type and condition it is charged to.
- **Individual allowance deltas are equality-asserted against nesasm's real usage, per board, not
  margin-checked.** `kernelbytes.test.js` measures each named constant's own isolated delta with
  `assert.equal`, not `<=` — a margin check would let a stale, too-generous figure sit undetected
  until a project actually needed the bytes it silently claimed. The *combined* reservation is
  checked differently: `assertCovers` requires the real margin between `KERNEL_SLACK` and
  `KERNEL_SLACK * 2` — below it the reservation has fallen behind the engine, above it the term has
  stopped tracking closely enough to catch the next regression (`bankedbytes.test.js`
  holds the identical discipline for the separate banked ledger).
- **`assertCovers` only ever compared post-`reset` *code* against the real usage a build measured,
  so drift in a *table* emitted before `reset` — CHR-RAM tileset tables, an empty-array
  placeholder byte — was invisible until a whole-bank absolute check existed.** In-game naming's
  phase 3 added that check (nesasm's total kernel-lo usage against `kernelCodeBytes +
  kernelTableBytes` together), surfacing three pre-existing table gaps in one pass: UNROM 512's
  `tileset_bank`/`tileset_lo`/`tileset_hi` CHR-RAM tables (3 bytes per region — why
  `kernelTableBytes` takes the mapper as a parameter), the one-byte `ms_data_0`/`anim_data_0`
  placeholders empty metasprite/animation arrays still emit, and the per-entry placeholder for an
  entry with no tiles/frames (`metaspriteKernelBytes` floors each data term at 1, not 0).
- **`kernelShortfallAdvice` (`main/build/generate.js`) prices a removal by disabling every live
  occurrence of a command — nested inside a branch, a choice option, or a common event — and asking
  what the resulting project's full kernel-lo occupancy (`kernelCodeBytes + fixedBytes +
  tableBytes`) would be (`projectWithoutCommands`), never by summing the flat allowance
  constants.** Summing under-counts: on MMC3, a Move (or Sting) can be a project's only reason
  `SPLIT_KERNEL_ALLOWANCE` is paid at all, so removing it must free both terms together, which only
  the counterfactual-occupancy approach knows. In-game naming's own strip helpers
  (`projectWithoutHeroNaming`/`projectWithoutJoinNaming`/`projectWithoutNameToken`,
  `shared/project.js`) apply the same rule to non-command content — a `renamable` flag or a
  dialogue token — and both `kernelShortfallAdvice` and `battleShortfallAdvice`
  (`main/build/battletables.js`) offer "the name token" as a removal. `battleShortfallAdvice`'s own
  list — generalized to `bankedFeatures` — also offers "every monster's extra spells" through
  `projectWithoutMonsterSpellList`, truncating every actor's `battle.spellIds` to its first entry.
  The same full-occupancy pricing lets an alternative *mapper* be recommended once a
  shortfall includes table bytes a summing guess would miss.
- **A mapper offered as a fix must still hold every tileset, every screen and the project's
  mirroring choice** — a smaller kernel-lo reservation alone is not a valid suggestion if
  `reconcileCartridge` would silently truncate one of those the moment the author switched.

Current allowance figures (`main/build/generate.js` unless noted; each named code allowance is a
delta `kernelbytes.test.js` measures exactly, on every board named — the base, the derived table
sizes, the route zero-cost proof and `KERNEL_SLACK` itself are each checked their own way, below):

- `BASE_KERNEL_CODE_BYTES_BY_MAPPER = { 0 (NROM): 5367, 1 (MMC1): 5428, 4 (MMC3): 5449, 30 (UNROM
  512): 5617 }` — action-side, nothing conditional on, falling back to the largest of the four for
  an unmeasured mapper (`docs/kernel-base-overcharge-report.md`; the NROM entry was added measuring
  in-game naming's own isolation deltas, below).
  `BATTLE_KERNEL_ALLOWANCE_BY_MAPPER = { 1: 229, 4: 240, 30: 229 }` is its RPG-only supplement — no
  fallback, deliberately, the same reason Save's table has none; MMC3's extra 11 bytes are
  `split_select`'s second `.if BATTLE_ENABLED` arm (`engine/split.asm`). Its gate,
  `battleEnabledFor` (`codeRegions(...).length > 0`), does not imply `rpgCapable(mapper)`, so
  `battleKernelAllowance(mapper)` THROWS on a missing entry rather than `undefined`-then-`NaN`;
  `checkCapacity` pre-checks the project's own mapper and reports a
  named problem, and `switchableMappers` filters out any candidate that would hit the throw.
- `TITLE_KERNEL_ALLOWANCE_BY_MAPPER = { 30: 200, 1: 200, 4: 211 }`, charged whenever a project has
  a title screen — MMC3's extra 11 bytes are its own `.if TITLE_ENABLED` branch in `split_select`.
  A live `Save` command pays this term even with `titleMap` currently unset, because
  `validateProject` requires a title wherever Save is live.
- `SAVE_KERNEL_ALLOWANCE_BY_MAPPER = { 1: 470, 4: 475, 30: 640 }` plus flat
  `SAVE_BATTLE_KERNEL_ALLOWANCE = 41`: the table is the action-side base every save-capable board
  pays (UNROM 512 costs more: flash-rewrite, not battery-WRAM); the flat RPG-only supplement is
  `save_check_valid`'s own `.if BATTLE_ENABLED` range-check block plus `BE_RESTORE`'s call site,
  summing to RPG totals `{1: 511, 4: 516, 30: 681}`, flat since the gap measures identical on all
  three boards. Its gate is NOT `gameType === 'rpg'` but `codeRegions(...).length > 0`
  (`kernelCodeBytes` recomputes it) — the real predicate `BATTLE_ENABLED` emits from, narrower on
  a CHR-RAM board whose tilesets have claimed every switchable region.
- `MOVE_KERNEL_ALLOWANCE = 335` plus `FACE_KERNEL_ALLOWANCE = 13` (the facing routine Move and
  `Turn` share, charged once) — 348 total for a Move-only project. Re-measured up from 324 for
  phase 2 slice 3's `mv_ent` identity capture (docs/design-streamed-worlds.md §7, ruling 7):
  `script_op_move`'s own 5-byte capture plus six call sites each trading a 2-byte `ldx <talk_ent`
  for a 3-byte `ldx mv_ent` — unconditional on `MOVE_ENABLED` itself, paid by every project using
  Move, streamed or not. `STREAMWORLD_MOVE_KERNEL_ALLOWANCE = 159` (kernel-lo only, gated
  `usesStreaming && usesMove`) is the streaming-only remainder on top: `move_tick`'s own
  streamed-player bound arms on all four directions and `move_speed_player`'s accumulator dispatch.
  A separate `STREAMWORLD_MOVE_KERNEL_HI_ALLOWANCE = 76` (kernel-hi, same gate; down from 80 in fix
  round 2, finding C: `sw_move_probe_solid`'s own tail shrank by 4 bytes when it switched to
  `sw_terrain_or_fill_solid_type`) charges the shared crossing-probe routine, `sw_move_probe`/
  `sw_move_probe_solid` (`engine/streamworld.asm`, gated `.if MOVE_ENABLED` there so a streamed
  project with no live Move pays nothing extra in kernel-hi either). Fix round 1 (`handoff-next/streamed-worlds-phase2-s3-review1.md` findings 1 and 4)
  replaced round 1's own clamp-to-the-exact-edge bound arms — which changed the wall's selected
  semantics rather than just its accounting — with the ordinary wall's own shape at a wider bound:
  an 8-bit carry is itself the wall for RIGHT (255 is the byte range's own maximum), a `cmp
  #240`/`bcs` is the wall for DOWN, and a borrow is the wall for LEFT/UP, identical to the ordinary
  wall and needing no streamed-specific arm at all. A step whose parity does not land exactly on
  the edge stops short of it, the same way the ordinary wall already stops short of `MAX_X`/`MAX_Y`
  on an off-parity step; this lowered kernel-lo from 172 to 159 (kernel-lo alone went down, since
  the clamp arms cost more than the wider-bound checks they replaced), and moved the crossing
  probe's own normalization — now one shared routine used by all four arms instead of a
  right/down-only special case — into kernel-hi as a separate, independently measured 80-byte term.
  Fix round 2: kernel-lo and kernel-hi are two different regions of the ROM, never added into one
  combined figure — 159+80=239 is not a decrease from 172, it is 159 down in kernel-lo alongside a
  new, separately charged 80 in kernel-hi.
- `SPLIT_KERNEL_ALLOWANCE = 151`, MMC3-only, charged whenever `projectUsesText` is true on that
  board — including a project whose only live event is a Move or a Sting, not just dialogue.
  Pinned by a text-on/off isolation on a fresh action project, plus a zero-delta control on every
  non-`scanlineIrq` board (`docs/split-lock-not-pinned-report.md` §8).
- `ITEM_KERNEL_ALLOWANCE = 16` (flat, unmoved by the kernel diet) plus 3 `kernelTableBytes` bytes
  *per item* (`item_metasprite`, `item_effect_kind`, `item_effect_amount`,
  one byte each in `assets/items.inc`); `ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE = { action: 61,
  rpg: 59 }` for `use_item_apply`.
- In-game party-member naming, seven kernel-lo terms plus two banked ones — flat across every board
  on both game types, nesasm-measured, not guessed (`docs/design-name-entry.md` §4/§11):
  `NAME_ENTRY_KERNEL_ALLOWANCE = 107` (shared naming hook glue — `nm_acted`, the
  `do_action`/`draw_ui`/`ui_tick`/`text_tick` arms, and the five `name_begin`/`tick`/`draw`/
  `select`/`cancel` shims above), charged whenever hero or Join naming is live;
  `JOIN_NAMING_KERNEL_ALLOWANCE = 63` (`script_op_join`'s growth, RPG-only);
  `HERO_NAMING_KERNEL_ALLOWANCE = 10` (`start_game`'s naming arm, both game types, unmoved by the
  diet); `HERO_NAMING_TITLELESS_KERNEL_ALLOWANCE = 14` (`reset`'s own titleless naming arm, paid
  only with no title screen to reach `start_game` through); `NAME_ENTRY_ACTION_KERNEL_ALLOWANCE =
  683` (the grid's own body, `engine/nameentry.asm`, on an action project with no battle bank —
  banked instead as `NAME_ENTRY_BATTLE_ALLOWANCE = 737` on an RPG, the grid plus `battle_entry`'s
  own dispatch growth); `HERO_DEFAULT_KERNEL_ALLOWANCE = 11` (`init_session`'s copy loop alone,
  unmoved by the diet — the 10-byte `hero_name_default` table is a `kernelTableBytes` term
  instead); `NAME_TOKEN_KERNEL_ALLOWANCE = 55` (`text_type_name`, flat on every board and both game
  types, gated on `NAME_TOKEN_ENABLED` alone); banked `NAME_COPY_BATTLE_ALLOWANCE = 43`
  (`party_join`'s own name-copy loop, gated on `projectNeedsNameSeed` — a
  token-only RPG pays this even with no `renamable` party member).
- `STING_KERNEL_ALLOWANCE_STANDALONE = 166` (`sting_snapshot`/`restore` shadow `mus_inst_base`)
  plus the shared `AUDIO_FX_KERNEL_ALLOWANCE = 15` (paid by either, unmoved by the diet);
  `SFX_KERNEL_ALLOWANCE_STANDALONE = 283`; `STING_SFX_INTERACTION_ALLOWANCE = 5` more when both
  live (unmoved). Aggregate: Sting-only 181, Sfx-only 298, both live 469.
- `BOUND_TILE_KERNEL_ALLOWANCE = 381`, plus a 30-byte fixed table (`bound_row_lo`/`bound_row_hi`)
  and 2 `kernelTableBytes` bytes per screen (`screen_bound_lo`/`hi`) — the first allowance whose
  removal `kernelShortfallAdvice` has to price by full kernel-lo occupancy (code and table
  together), the rule above.
- `TURN_KERNEL_ALLOWANCE = 33` composes with `FACE_KERNEL_ALLOWANCE` above (Move+Turn cost
  335+33+13=381, facing routine charged once); `WAIT_KERNEL_ALLOWANCE = 43` shares no other code
  with Turn (33+13+43=89 for Turn+Wait, no Move). `SHAKE_KERNEL_ALLOWANCE = 60` and
  `VISIBLE_KERNEL_ALLOWANCE = 47` (Show/Hide) are each flat, with no dependent term.
- `FADE_KERNEL_ALLOWANCE = 124` and `FLASH_KERNEL_ALLOWANCE = 91` name each routine's own cost;
  both share `PALETTE_FX_KERNEL_ALLOWANCE = 52` (`fade_apply_palette` plus the NMI PPUADDR fix,
  charged once whether Fade or Flash or both are live) — 176 total for Fade-only.
- `CAMERA_KERNEL_ALLOWANCE = 20` (the register and NMI rewrite, flat on all four measured boards
  and both game types) plus `CAMERA_SHAKE_INTERACTION_ALLOWANCE = 19` with Shake live;
  `CAMERA_SLIDE_KERNEL_ALLOWANCE = 298` (the consumer, measured against a register-only build,
  never camera-off) plus `CAMERA_AXIS_KERNEL_ALLOWANCE = 52` per live axis,
  `CAMERA_SPLIT_INTERACTION_ALLOWANCE = 6` with the MMC3 split and
  `BOUND_TILE_CAMERA_INTERACTION_ALLOWANCE = 6` with switch-bound tiles — 370 for one axis, five
  under the design's prototype, whose `_for` shims the shipped build never needed.
- A `route` (`docs/design-routes.md`) compiles to the identical bytes as hand-chaining
  the same `move`/`turn`/`wait` commands — zero additional kernel cost, proven by
  `test/unit/routes.test.js`'s byte-identical-ROM comparison and confirmed with a cross-tree
  SHA-256 gate.
- `KERNEL_SLACK = 20` (unmoved by the diet): `kernelbytes.test.js`'s `assertCovers` requires
  `KERNEL_SLACK <= margin <= KERNEL_SLACK * 2`. Correct accounting of the base and every conditional
  term should leave exactly the floor; the ceiling detects drift, not spare headroom.
- `STREAMWORLD_KERNEL_HI_ALLOWANCE = 3437` plus `STREAMWORLD_MT_PAL_KERNEL_HI_BYTES = LIMITS.metatiles`
  (64) are the one pair of allowances charged against kernel-**hi** ($E000) rather than kernel-lo —
  the resident streamed-worlds package (`engine/streamworld.asm`) and its metatile attribute-quadrant
  lookup (`mt_pal`), both assembled inside `.if STREAMING_ENABLED` after `assets/text.inc`, gated on
  `projectUsesStreaming` (`shared/streamlayout.js`). Measured as the real kernel-hi bank usage delta
  between a streamed build and the same project with every map's `streamed` flag forced off, flat
  at 3449 combined across game type and the `mixed` (streamed map alongside ordinary ones) shape —
  equality-asserted by `kernelbytes.test.js`. Phase 2 slice 2b's Part D narrowed streaming to UNROM
  512 (`streamCapableFourScreen`) alone, so this is no longer measured per mapper; MMC1/MMC3 are
  refused outright by `validateStreamedMaps` regardless of what this would measure there. Re-measured
  up from 2050 to 2376 by this same slice's own landing-site resolver and render call sites
  (`sw_resolve_screen`, `sw_render_window`, `sw_locate_current`), then to 2432 by fix round 1's own
  finding 1 (a real 16-bit locator pointer, `sw_resolve_owner_streamed`, replacing an 8-bit multiply
  that wrapped) and finding 9 (the `NO_SCREEN` park/`st_active` clear in `sw_resolve_screen`) — both
  real net growth in this same resident file, re-measured directly each time, never derived by
  adding a fix's own byte count to the prior figure by hand. Re-measured again to 2611 by phase 2
  slice 4a's own resident additions (`sw_oam_project_x`/`sw_oam_project_y`/`sw_oam_rowbase` and the
  landing origin write in `sw_resolve_divdone`), then to 2689 by that same slice's own round 1 review
  fix (finding 2's real per-tile clipping needs a general signed offset projection per axis, not the
  single-carry-bit contract the two `sw_oam_project_*` routines started with, so each gained a
  sibling — `sw_oam_project_tile_x`/`_tile_y` — plus a small shared core) — the same real-growth
  reasoning both times, not a formula fix. Grown again by *this* fix round
  (streamed-worlds-phase2-s4b-fix1), from 2689 to 3385: finding 1's real crossing implementation
  (ruling C's true 256(X)/240(Y) boundary with signed overshoot, replacing the old
  `cross_left`/`right`/`up`/`down` wall — see `STREAMWORLD_CROSS_KERNEL_ALLOWANCE`'s own retirement
  note below) lives entirely in new resident code — `sw_hazard_probe_solid`/
  `sw_hazard_probe_solid_cross`, six small per-axis recompute helpers
  (`sw_pr_calc`/`sw_pl_calc`/`sw_pd_calc_a`/`sw_pd_calc_b`/`sw_pu_calc_noborrow`/`sw_pu_calc_b`) and
  the four `sw_pstep_left`/`right`/`up`/`down` routine bodies, all ahead of `sw_update_player`, all
  unconditional under `STREAMING_ENABLED`, none of which falls inside any other named span.
  Re-measured directly (fix round 2: real kernel-hi delta 4601 on UNROM 512 action, 4566 rpg, 4601
  action-mixed; each equals `STREAMWORLD_MT_PAL_KERNEL_HI_BYTES`(64) +
  `STREAMWORLD_WINDOW_KERNEL_HI_ALLOWANCE`(834) + `STREAMWORLD_KNOCKBACK_KERNEL_HI_ALLOWANCE`(32,
  action only) + `streamworldUpdatePlayerKernelHiAllowance` (170 action / 167 rpg) +
  `STREAMWORLD_HAZARD_KERNEL_HI_ALLOWANCE`(64) + 3437 exactly, all three shapes), not derived by
  hand from the new code's own line count. The +52 over fix round 1's 3385 is
  `sw_terrain_or_fill_solid_type` (fix round 2 finding C, shared by `sw_move_probe_solid` and
  `sw_hazard_probe_cross`) plus the finding A/B rewrite of `sw_pstep_up`'s crossing case
  (per-probe renormalization, plus the `bcc`/`jmp` branch-range fix) net of the 4-byte shrink
  `STREAMWORLD_HAZARD_KERNEL_HI_ALLOWANCE` absorbed on its own (68 -> 64, below).
- Phase 2 slice 4b (the continuous movement driver, `docs/reference-engine.md`'s own Part C/movement
  section) adds four MORE kernel-hi terms, each its own named allowance rather than folded into
  `STREAMWORLD_KERNEL_HI_ALLOWANCE` above (all still resident in `engine/streamworld.asm`, all still
  gated on `projectUsesStreaming` alone, equality-asserted by `kernelbytes.test.js`'s Part F):
  - `STREAMWORLD_HAZARD_KERNEL_HI_ALLOWANCE = 64` (down from 68 in fix round 2: finding C collapsed
    `sw_hazard_probe_cross`'s tail from `jsr sw_terrain_or_fill / tay / lda mt_collision,y / rts` to
    `jsr sw_terrain_or_fill_solid_type / rts`, -4 bytes) — `sw_hazard_probe_type`, `player_hazard`'s
    own straddling-collision probe for a scripted player Move's wider ownership rectangle (Part C's
    "straddling probe" section, `docs/reference-engine.md`). Unconditional — not gated on
    `MOVE_ENABLED` or `BATTLE_ENABLED`, since `player_hazard` calls this on every streamed screen
    regardless of either (orchestrator ruling 9). Flat across action/RPG/mixed.
  - `STREAMWORLD_WINDOW_KERNEL_HI_ALLOWANCE = 834` — the window/camera-window region
    (`sw_win_col_inc`/`_dec`, `sw_win_row_inc`/`_dec`, `sw_win_entering_col_right`/`_row_down`,
    `sw_frame_camera_window`, `sw_win_arm`): the per-frame camera-to-PPU publish and the
    current/desired window-block arm decision. Flat across game type and the `mixed` shape —
    unconditional, no `BATTLE_ENABLED` interior gate.
  - `STREAMWORLD_KNOCKBACK_KERNEL_HI_ALLOWANCE = 32` — `sw_knockback_step`, the interim capped (1px)
    knockback step for a streamed map, gated `.if !BATTLE_ENABLED` inside this same file (action/
    mixed only; an RPG's knockback stays the ordinary battle-system one). nesasm emits no symbol
    table entry at all for a label inside a false `.if` — confirmed directly (the measurement's own
    symbol lookup throws on an RPG build) rather than assumed to share an address with whatever
    follows — so this is 0 on RPG, not merely unreachable.
  - `STREAMWORLD_UPDATE_PLAYER_KERNEL_HI_ALLOWANCE_BY_GAME_TYPE = {action: 170, rpg: 167}` plus a
    `streamworldUpdatePlayerKernelHiAllowance(project)` accessor (the `ITEM_EFFECT_KERNEL_ALLOWANCE_
    BY_GAME_TYPE` shape, above) — `sw_update_player` itself, the per-frame driver dispatch (the
    `sw_event_freeze` check, the capped-knockback branch above, axis arbitration via `sw_axis_pref`,
    the accumulator dispatch into `sw_pstep_left`/`right`/`up`/`down` — fix round 1, finding 1
    moved the true 256(X)/240(Y) crossing commit here from `cross_left`/`right`/`up`/`down`, which
    no longer see a streamed crossing at all — `player_hazard`/`check_encounter`, the tail call into
    `sw_frame_camera_window`). Game-type-varying because two blocks inside its own body are gated on
    `BATTLE_ENABLED` in opposite directions: an action-only knockback-dispatch arm near the top, an
    RPG-only `check_encounter` call near the bottom — net +3 action over rpg, exactly the measured
    170-vs-167 gap (the same +3 the prior 135-vs-132 figures held, since fix round 1's own growth —
    findings 1/4/7: the ownership commit and `flat_screen` update now live in `sw_pstep_*` rather
    than here, but the `screen_fresh` gate that arms them and finding 7's walk-animation restore on
    a same-frame crossing both grew this body directly — is identical on both game types). The
    `mixed` shape measures identical to plain action (170), confirmed directly, not assumed from the
    game type alone.
- Phase 2 slice 2b, Part F: ten more kernel-**lo** terms streaming adds (plus two more from phase 2
  slice 4b, listed at the end of this group), each its own named allowance (`main/build/generate.js`,
  all gated on `projectUsesStreaming`, added inside `kernelCodeBytes`), measured as
  `symbolAddr(after) - symbolAddr(before)` off a real build between a pair of unconditional boundary
  labels bracketing each site's own `.if STREAMING_ENABLED` addition — flat across game type and the
  `mixed` shape, confirmed by measuring all three (`test/lib/streamedproject.js`):
  - `STREAMWORLD_RESOLVER_KERNEL_ALLOWANCE = 49` — `engine/boot.asm`'s own copy of the
    resolve-and-render dispatch (cold boot draws its first screen inline rather than calling
    `redraw_screen`): `jsr sw_resolve_screen` plus the `map_is_streamed` branch, the whole
    streamed-landing render sequence, and the tail jump back into the ordinary path's shared tail.
  - `STREAMWORLD_REDRAW_KERNEL_ALLOWANCE = 47` — `engine/screens.asm`'s `redraw_screen`, the
    "re-keyed consumer" version of the identical dispatch, reached by every other landing
    (`start_game`, `restart_game`, `take_door`, `continue_game`); 2 bytes less than the resolver
    term because this copy ends in `rts` rather than boot's own 3-byte tail jump.
  - `STREAMWORLD_SET_SCREEN_PTR_KERNEL_ALLOWANCE = 8` — `engine/screens.asm`'s `set_screen_ptr`: an
    early return through `sw_locate_current` when the CURRENT screen is streamed (`call_battle`
    always ends `jmp set_screen_ptr`, so this runs even for a non-fight session-lifecycle entry).
  - `STREAMWORLD_SPAWN_KERNEL_ALLOWANCE = 12 + 164` — `engine/entities.asm`'s `spawn_entities`: the
    streamed-vs-ordinary dispatch in `spawn_clear`'s own preamble (12) plus `spawn_streamed`'s own
    body (164), the actor/x/y/target/toX/toY/event/trigger/hideSwitch field loop walked with
    `sw_adv_offset` instead of a bare `iny` since a streamed record is `STREAM_RECORD_BYTES` long.
  - `STREAMWORLD_MUSIC_KERNEL_ALLOWANCE = 0` — `engine/music.asm`'s `apply_map_music`/
    `apply_map_music_direct`, named for consistency even though the measured delta is exactly zero:
    `ldy <ord_screen` and `ldy <flat_screen` are both a 2-byte zero-page load.
  - `STREAMWORLD_ENCOUNTER_KERNEL_ALLOWANCE = 4`, RPG-only (`usesBattleBase`, same gate as every
    other RPG-only term on this page) — `engine/rpg.asm`'s `check_encounter`: no random encounter
    while the current screen is streamed (defensive; Part D already refuses a nonzero encounter rate
    reachable on any streamed map). `start_encounter`'s own re-keyed swap costs nothing, the same
    zero-page-both reasoning as the music term above.
  - `STREAMWORLD_INIT_SESSION_KERNEL_ALLOWANCE = 4` — `engine/combat.asm`'s `init_session`:
    `map_is_streamed`/`ord_screen` cleared defensively on every "new game" and game-over restart, so
    a stale value never survives into a reactive read that could run before the first landing does.
    Unconditional whenever streaming is on — the one term the worst-case margin test caught that
    Part F's own consumer list had missed.
  - `STREAMWORLD_BOUND_CACHE_KERNEL_ALLOWANCE = 8`, gated on BOTH `projectUsesStreaming` and
    `projectUsesBoundTiles` — `engine/screens.asm`'s `rebuild_bound_cache`: a streamed CURRENT
    screen returns an empty cache rather than reading a stale row (Part D refuses a streamed map its
    own bound tile, but `tile_switch_changed` can still reach this reactively from an ordinary map's
    Set/Clear while the player stands on a streamed screen).
  - `STREAMWORLD_CROSS_KERNEL_ALLOWANCE` is **retired** as of fix round 1
    (streamed-worlds-phase2-s4b-fix1, finding 1) — it no longer exists in `generate.js`, not merely
    zeroed in place. It used to price a per-direction crossing arm (the "clamp edges" grid-boundary
    guard plus a snap of the leaving axis) that phase 2 slice 4b had built directly inside
    `engine/player.asm`'s `cross_left`/`right`/`up`/`down` (flat `21 + 27 + 21 + 27 = 96` bytes,
    LEFT/UP cheaper than RIGHT/DOWN because RIGHT/DOWN's boundary compare needs an extra `+1` against
    `sw_grid_w`/`sw_grid_h`). Fix round 1 found that design itself defective: a held crossing needs
    to land mid-frame at the TRUE 256(X)/240(Y) boundary with its own signed overshoot (ruling C),
    not snap to `MAX_X`/`MAX_Y` on the *following* frame the way `cross_*` naturally would. The real
    crossing moved entirely into `sw_pstep_left`/`right`/`up`/`down` (`engine/streamworld.asm`),
    reached straight from `sw_update_player` — `sw_update_player` never falls through to
    `move_left`/`right`/`up`/`down` any more, so `cross_left`/`right`/`up`/`down` never see a
    streamed crossing at all. That left `cross_left`/`right`/`up`/`down` exactly as they were
    *before* slice 4b: pure ordinary-screen crossing code with no `map_is_streamed` branch, no
    grid-boundary guard, and no streaming-conditional byte cost beyond the `STREAMING_ENABLED`
    `ord_screen`/`flat_screen` operand choice already priced by
    `STREAMWORLD_CROSS_TRANSLATE_KERNEL_ALLOWANCE` below (a `ldy <ord_screen`/`ldy <flat_screen`
    swap costs the same 2 bytes either way). Re-measured directly
    (`measureStreamedSpan`'s `cross_left..cross_none` region-delta, streamed minus unstreamed
    baseline: 21 exactly, matching `STREAMWORLD_CROSS_TRANSLATE_KERNEL_ALLOWANCE` alone with nothing
    left over) — the crossing arm's own byte cost moved to `STREAMWORLD_UPDATE_PLAYER_KERNEL_HI_
    ALLOWANCE_BY_GAME_TYPE` above, inside `sw_update_player`'s own growth from 135/132 to 170/167.
  - `STREAMWORLD_CROSS_TRANSLATE_KERNEL_ALLOWANCE = 13 + 8` — `engine/player.asm`'s
    `cross_set_screen`: an ORDINARY crossing runs through this helper instead of a bare
    `sta <flat_screen`, so `flat_screen` stays the global id while `ord_screen` adopts the
    newly-crossed-to compacted index too. The helper itself is a fixed 13 bytes; each of its 8 call
    sites (the slide branch and the cut fallback, times all 4 directions) replaces a 2-byte store
    with a 3-byte `jsr`, +1 byte each, all 8 always assembling since a streamed map is only ever
    reachable on UNROM 512 with four-screen mirroring, whose `cameraAxes` answers both axes true.
  - Phase 2 slice 4b's own three more kernel-lo terms, the movement driver's caller-side glue outside
    `engine/streamworld.asm` itself: `STREAMWORLD_UPDATE_PLAYER_DISPATCH_KERNEL_ALLOWANCE = 7` —
    `engine/player.asm`'s `update_player_knock`, a `lda <map_is_streamed / bne` branch into the
    capped (1px, `SW_KNOCKBACK_SPEED`) knockback step instead of the ordinary 3px one.
    `STREAMWORLD_EVENT_FREEZE_KERNEL_ALLOWANCE = 4 + 4` — `sw_event_freeze`'s own two call sites
    summed into one term (the `STREAMWORLD_LANDING_BOUND_CACHE_KERNEL_ALLOWANCE` two-call-site
    precedent above): `engine/input.asm`'s `do_talk` (armed the same frame an interact press opens a
    conversation, so a page with nothing to wait on can't also let the player step that frame) and
    `engine/boot.asm`'s `main_loop_idle` (cleared every frame gameplay is live). Each site is
    `lda #imm/sta <sw_event_freeze`, 4 bytes. `STREAMWORLD_HAZARD_KERNEL_ALLOWANCE = 5 + 10` —
    `engine/combat.asm`'s `player_hazard`, summed the same two-site way (orchestrator ruling 9):
    the dx-capture triple right after the probe_x add (5 bytes) plus the `map_is_streamed` dispatch
    into `sw_hazard_probe_type` vs. the ordinary `probe_type` fallthrough (10 bytes). Unconditional
    — every streamed project pays it, not merely a Move-using one, the same "sabotage case 13" gate
    (above) this term's own dispatch half protects.
  - Fix round 1's own three additions, each measured as a marginal delta on top of the resolver/
    redraw spans above, not restated from scratch: `STREAMWORLD_LANDING_BOUND_CACHE_KERNEL_
    ALLOWANCE = 2 * 3`, gated on BOTH `projectUsesStreaming` and `projectUsesBoundTiles` — a `jsr
    rebuild_bound_cache` added at EACH of the two streamed-landing call sites (boot's own inline
    copy and `redraw_screen`'s), 3 bytes apiece, so a landing after a streamed map's own bound-tile
    cache is never a stale row instead of the empty one `rebuild_bound_cache` itself already returns
    for a streamed CURRENT screen. `STREAMWORLD_ORDINARY_CAM_RESET_KERNEL_ALLOWANCE = 8`, gated on
    `projectUsesStreaming` alone — `redraw_screen_ordinary`'s own `cam_x_lo`/`cam_y_lo`/`cam_nt`
    reset to 0 right before `enable_rendering`, so an ordinary landing reached AFTER a streamed one
    does not inherit the streamed screen's own nonzero scroll (cold boot needs no equivalent: its
    own RAM-clear loop already zeroes those bytes before that path ever runs, once). `STREAMWORLD_
    TILE_SWITCH_KERNEL_ALLOWANCE = 4`, gated on BOTH `projectUsesStreaming` and
    `projectUsesBoundTiles` — `tile_switch_changed`'s own SECOND, independent streamed guard
    (`engine/script.asm`), distinct from `rebuild_bound_cache`'s own: its ROM-side flip-queueing walk
    must also refuse to index `screen_bound_lo`/`hi` by `ord_screen` while the current screen is
    streamed, since a streamed screen has no row in that table at all.
- Phase 2 slice 4a's own three kernel-lo terms, gated on `projectUsesStreaming` (`main/build/
  generate.js`), each equality-asserted by `kernelbytes.test.js` on both game types and the `mixed`
  shape:
  - `STREAMWORLD_PROJECT_KERNEL_ALLOWANCE = 286` — the projection wiring's combined span, measured
    with the same single-build-span technique as the Part F terms above: `engine/oam.asm`'s
    `build_oam_draw_dispatch`/`_dispatch_done` branch (4) + `build_oam_draw_sw`/`_end` routine (108) =
    112, plus `engine/entities.asm`'s `draw_one_entity_show`/`de_show_dispatch_done` branch (4) +
    `draw_one_entity_ordinary_join`/`draw_one_entity_animate` routine (167) = 171, combined 283, plus
    a third `entities.asm` term that is a REPLACE rather than a purely-additive bracket —
    `draw_one_entity_hurt_dispatch`/`draw_one_entity_show` costs the ordinary build its original
    2-byte `bne` either way, a streamed build 5 bytes (a `jmp`'s-worth more), so only the 3-byte
    streamed-minus-ordinary delta belongs here (283 + 3 = 286). Grew from an earlier 45/161 in the
    round 1 review fix (real per-tile projection for entities, replacing origin-only projection):
    the join span now also duplicates `entity_animation`'s own `NO_ANIM`/metasprite-id lookup (needed
    before X is safe to spend on the per-tile projection calls) rather than sharing it with
    `draw_one_entity_animate`'s tail, and that larger streamed-only routine is what pushes
    `draw_one_entity`'s own `ent_hurt` dispatch out of a plain `bne`'s ±128 range in a streaming build
    alone.
  - `STREAMWORLD_NMI_KERNEL_ALLOWANCE = 24` — the ONE exception to that additive technique:
    `engine/boot.asm`'s NMI arbitration splice (`nmi_vram_dispatch`..`nmi_scroll`) *replaces* the
    ordinary six-line drain with a bigger three-way one rather than adding a branch in front of it,
    so this is the streamed build's own span over that boundary MINUS the same span on an ordinary
    build, not a single-build span (a single-build span would overcount by the surviving `.else`
    arm's own bytes).
  - `STREAMWORLD_NMI_PALETTE_FX_KERNEL_ALLOWANCE = 8`, gated on BOTH `projectUsesStreaming` and
    `usesPaletteFx` — the splice duplicates the `nmi_fade_ppuaddr`/`nmi_fade_ppuaddr_done` PPUADDR
    cleanup block on its own two live-drain exits, one more occurrence than the ordinary `.else`
    arm's single copy; isolated with the identical double-difference technique
    `STREAMWORLD_MOVE_KERNEL_ALLOWANCE` above already uses, since a lone Flash command on an
    ORDINARY map already pays for its own one copy of that block and would otherwise leak into a
    naive single delta.
