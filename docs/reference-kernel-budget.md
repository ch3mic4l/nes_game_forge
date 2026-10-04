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
- `MOVE_KERNEL_ALLOWANCE = 335` plus `FACE_KERNEL_ALLOWANCE = 37` (the facing routine Move and
  `Turn` share, charged once; 13 until `move_face` gained its frame clamp, +24) — 372 total for a
  Move-only project. Re-measured up from 324 for
  phase 2 slice 3's `mv_ent` identity capture (docs/design-streamed-worlds.md §7, ruling 7):
  `script_op_move`'s own 5-byte capture plus six call sites each trading a 2-byte `ldx <talk_ent`
  for a 3-byte `ldx mv_ent` — unconditional on `MOVE_ENABLED` itself, paid by every project using
  Move, streamed or not. `STREAMWORLD_MOVE_KERNEL_ALLOWANCE = 77` (**S3b, 2026-10-04: 83 from S3a, minus the 6 bytes of the `sw_step_nocross` inc/dec pair
  the slice deleted**; 117 before S3a, 159 before S1 (a1); kernel-lo only, gated
  `usesStreaming && usesMove`) is the streaming-only remainder on top. Since S3a it is exactly two measured
  pieces: the DELEGATION span (67 bytes at S3a, **61 since S3b**, `S3A_DELEGATION_SPAN_BYTES` in `kernelbytes.test.js`) of `move_tick` (`move_tick_streamed` .. `move_tick_ordinary`: the
  `cur_speed`/`moving` setup, the `sw_step_nocross` raise and drop, the four `jsr sw_pstep_<dir>` arms and the
  camera call) and the 16-byte streamed branch of `move_speed_player`'s accumulator dispatch. Before S3a it paid
  for a private probe stage (the four per-direction copies, then S1 (a1)'s fold into `move_tick_probe_v_streamed`/
  `move_tick_probe_h_streamed`, 4 x 25 = 100 -> 58, which paid for `MOVER_PARITY_GATE_KERNEL_ALLOWANCE = 7`);
  that stage and its kernel-hi twin are deleted. A separate `STREAMWORLD_MOVE_KERNEL_HI_ALLOWANCE = 20`
  (`main/build/streamplacement.js`; kernel-hi, same gate; 76 before S3a, 80 before fix round 2) was, from S3a, the four
  `sw_step_nocross` guards in `sw_pstep_right/left/down/up`, 5 bytes each (`lda abs` + `bne`), gated
  `.if MOVE_ENABLED` so a streamed project with no live Move paid nothing extra. **S3b deleted the term with the guards**
  (the symbol is gone from `streamplacement.js`; the talker terms below are the Move's whole kernel-hi cost now). Both are equality-asserted
  against nesasm's own usage by `kernelbytes.test.js` on action, rpg and action-mixed (the delegation-span test replaced
  S1's probe-stage test). The deleted `sw_move_probe`/`sw_move_probe_solid` pair is recorded in the history
  below (fix round 1 findings 1 and 4 replaced the clamp-to-the-edge bound arms with the ordinary wall's shape at a wider bound:
  an 8-bit carry is the wall for RIGHT, `cmp #240`/`bcs` for DOWN, a borrow for LEFT/UP; fix round 2 shrank the
  kernel-hi probe from 80 to 76 by `sw_terrain_or_fill_solid_type`, which `sw_hazard_probe_cross` still inlines).
  Kernel-lo and kernel-hi are two different regions of the ROM, never added into one figure: S3a's -34 and -56 are
  separate decreases. Content ceilings after S3a (`contentCeilingBytes`, Move shapes): action 1151 -> 1207, rpg 1208 -> 1264
  (+56, the kernel-hi term); the no-Move shapes are unchanged (2861 action, 1560 rpg). **Dated 2026-10-04: S3a.5 added 78 to
  every one of these (1285 / 1342 Move, 2939 / 1638 no-Move) and S3b took 188 off the Move shapes (1097 / 1154): see "Phase 3a
  slice S3b" below for the final figures.**
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
  335+33+37=405, facing routine charged once); `WAIT_KERNEL_ALLOWANCE = 43` shares no other code
  with Turn (33+37+43=113 for Turn+Wait, no Move). `SHAKE_KERNEL_ALLOWANCE = 60` and
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
  `STREAMWORLD_WINDOW_KERNEL_HI_ALLOWANCE`(834 at that measurement; 1024 since S3a.5) + `STREAMWORLD_KNOCKBACK_KERNEL_HI_ALLOWANCE`(32,
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
  - `STREAMWORLD_WINDOW_KERNEL_HI_ALLOWANCE = 1024` (834 here at slice 4b; 1102 after the landing, guard and fix-round
    growth recorded at the constant; **1024 since phase 3a S3a.5, 2026-10-02**, when `sw_camera_window_recompute`'s two
    per-frame repeated-subtract loops became closed forms off `player_y` and the region shrank by 78, on every streamed
    project) — the window/camera-window region
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
- **Phase 2 slice 10 (content ceiling, R1):** `contentCeilingBytes(project)` and
  `streamworldHiBytesFor(project)` (`main/build/generate.js`) are the single writer of the shared
  music+SFX+text budget the $E000 kernel-hi bank leaves for content once the resident package above
  is accounted for — `ceiling = BANK_SIZE - 64 - streamworldHiBytesFor(project)`. **The 64 is the
  fixed kernel's whole reserved margin, not "the CPU vector table"** (corrected 2026-09-28, fix
  round 1, item 5): the CPU vectors are exactly 6 of those 64 bytes (`engine/main.asm:134-137`,
  `.dw nmi` / `.dw reset` / `.dw irq`); the other 58 are the rest of the always-present fixed-kernel
  tail, never varying with project content. `checkCapacity`'s own refusal check and message (naming
  Sound Forge and/or Map Forge, never a per-category quota, R2) both call `contentCeilingBytes`
  rather than repeating the arithmetic inline. `streamworldHiBytesFor` returns 0 for a non-streaming
  project, so an unstreamed project's overflow message never mentions streaming (R8) and its ceiling
  is the ordinary `BANK_SIZE - 64`. Every reachable action/RPG × text × Move × Save combination's
  ceiling, re-measured 2026-09-28 directly against the current tree
  (`test/unit/streamedceiling.test.js`, cross-checked by an independent re-run of
  `handoff-next/review-phase2-s10-round1-evidence/probe.mjs`) — **eight** unique accepted predicate
  combinations, not eleven: an action project's `Move` or `Save` script activates text on its own,
  and an RPG's text is *always* on (`projectUsesText`, `shared/font.js`), so "RPG + text off" is not
  a reachable row, and neither is "action, no text/Move/Save requested, but a duplicate row with a
  different `requestedText` input" — RPG+Move+Save is refused by kernel-**lo** capacity regardless
  of content, a separate ceiling from the one this table measures, and so is not reachable here
  either:

  | game type | text | Move | Save | ceiling (bytes) |
  |---|---|---|---|---|
  | action | off | off | off | 2861 |
  | action | on | off | off | 1503 |
  | action | on | off | on | 1385 |
  | action | on | on | off | 1382 |
  | action | on | on | on | 1264 |
  | rpg | on | off | off | 1560 |
  | rpg | on | off | on | 1445 |
  | rpg | on | on | off | 1439 |
  | rpg | on | on | on | — (refused by kernel-lo, not this ceiling) |

  (This table is the 2026-09-28 record, before phase 3a: S1 moved every streamed-actors row down by 231 and S3a moved the Move rows up by 56 -- the current figures are in the S1, S3a and S3b notes below (`test/unit/streamedceiling.test.js` derives its ceilings at run time and verifies the computed boundaries; it holds no literal ceiling). S3a.5 then added 78 to every row, and S3b (2026-10-04) took 188 off every Move row -- measured directly for the plain Move shapes, 1,285 -> 1,097 action and 1,342 -> 1,154 rpg, "Phase 3a slice S3b" below.)
  (RPG's `text` is always on — `projectUsesText` hardcodes true for `gameType === 'rpg'`,
  `shared/font.js` — so "RPG + text off" does not exist, matching the "reachable" framing above.)
  **2026-09-28, fix round 1 (item 2):** the real per-category byte model
  (`musicBytes`/`sfxBytes`/`text.bytes` from `checkCapacity`) is now reconciled to nesasm's own real
  kernel-hi bank usage by an independently-derived, *named* exact relationship, not merely a
  cross-case-consistent unexplained constant:

  ```
  realKernelHiUsed = musicBytes + sfxBytes + textBytes(modeled) + streamworldHiBytesFor(project)
                     + 6 (CPU vectors) - textOverestimateBytes(project) + emptyTableStubBytes(project)
  ```

  `textOverestimateBytes(project) = placeholderTitleBytes + 4*TITLE_LINE_LIMIT(28) - realTitleBytes`
  — the pre-existing, deliberate text padding: `textSize()` (`main/build/textcompile.js`) models all
  four always-emitted system strings, including the title, at a fixed 28-byte pad using the
  placeholder `'UNTITLED'` fallback, but `textTables()` then emits the real title at its own real
  length with no padding — only `sys_title` differs between the two, so this term is exactly that
  one difference. `emptyTableStubBytes(project) = (strings.length?0:1) + (events.length?0:1)` — a
  second, independently-found gap of the same kind: `textTables()` emits a 1-byte `_0: .db $00`
  placeholder per *empty* strings/events table that `textSize()`'s own `total()` never counts.
  Neither is a bug needing a fix; both are asserted by name (not folded into an unexplained residual)
  across five builds varying title length, empty-vs-nonempty tables, game type and the text/Move/Save
  predicate, and the named relationship's residual is exactly **0** in every one — correcting the
  round-0 measurement's unexplained **-101 bytes**, which was only ever a cross-case consistency
  check (`predicted == BANK_SIZE` is tautological at any exact-fit point by construction, and was
  rejected during round 0 for that reason, but the -101 constant itself was never independently
  derived, so a shared omitted or overcharged term common to every boundary build could have passed
  it unnoticed — `handoff-next/review-phase2-s10-round1-findings.md`, item 2).

  **2026-09-28, fix round 1 (item 1, Chris's Option-B ruling):** the round-0 "645 bytes spare against
  a 1,445-byte ceiling" measurement above used a 5-line placeholder sample, not a justified
  shipped-RPG inventory, and did not establish that the revisit was actually closed. A concrete,
  named, pairwise-distinct 24-line/2-song/8-sfx/3-monster inventory was committed in writing
  (`handoff-next/progress-phase2-s10-fix1.md`; committed under Chris's Option-B ruling — whether
  it was written before or after it was first measured cannot be independently established, and
  this note makes no claim either way) and pinned so the measurement and coexistence tests fail
  if it shrinks. Measured honestly, untrimmed: **PINCH — 568
  bytes over** the 1,560-byte ceiling for RPG+dialogue with neither Move nor Save live (music 288 +
  sfx 84 + text 1,756 = 2,128 bytes), against 6,000 bytes of spare headroom the identical content
  would have unstreamed on the same board (8,128-byte ordinary ceiling). It does pinch — see
  `docs/design-streamed-worlds.md`'s own slice 10 note for the full inventory and the ordinary-board
  comparison. A pinch is not a stop; slice 10b (relocating the dialogue overlay, the revisit's own
  named fallback) is scoped as a later, separate brief and was not started here. The revisit stays
  open until slice 10b runs — the PINCH result is what triggers it, not a closure of it.

  **2026-09-28, fix round 3 — three separate measured findings** (a fresh run of the same
  constructions, `handoff-next/s10-fix3-scratch/details.log`, identical to the round-3 reviewer's
  `handoff-next/review-phase2-s10-round3-evidence/details.log`; each is a measurement, not a
  subtraction from another, and none changes the PINCH figure above):

  - **Save:** with the committed inventory's `save` command live (which adds the Save terms to the
    streaming reservation, 6,683 bytes, and drops the ceiling to 1,445), music 288 + sfx 84 + text
    1,757 = 2,129 bytes against 1,445: **684 bytes over** (288 + 84 + 1,757 − 1,445).
  - **Grouping:** the case-12 build placing the 24 lines one per actor compiles to 1,757 bytes of
    dialogue; the shipped 3-lines-per-actor grouping compiles to 1,629 — **128 compiled bytes
    saved** (1,757 − 1,629). This is dialogue text only; it does not change the ceiling.
  - **Kernel-lo entity tables (a fixture-specific finding):** the one-line-per-actor build
    (24 placed actors plus the full monster/item/spell/battle roster) is separately refused by
    kernel-lo: the lookup tables need **310** bytes and only **239** are free, **71 over**. The same
    build with every dialogue line replaced by `Hello.` (text 445) reports the identical 310/239, so
    the shortfall is independent of dialogue text. It is a measured finding for this fixture's actor
    and roster count, not a universal NPC limit.

  **2026-09-28, fix round 2 (item 5) — per-term decomposition**, re-deriving the RPG+dialogue+Move
  (no Save) row above (1439) directly from `generate.js`, file:line each (**S3a.5, 2026-10-02:** the window term is carried
  at its current 1024, so every sum derived from it is 78 lower -- 5135, 6611, 1517, +3082, +2819, below -- and the table row
  above stays the 2026-09-28 record, 1439; no other term here was re-measured since): RPG base
  `STREAMWORLD_KERNEL_HI_ALLOWANCE` 3342 (`:1369`) + `STREAMWORLD_MT_PAL_KERNEL_HI_BYTES` 64
  (`:1383`) + `STREAMWORLD_WINDOW_KERNEL_HI_ALLOWANCE` 1024 (`:2200`; 1102 until S3a.5) +
  `streamworldUpdatePlayerKernelHiAllowance` (rpg) 167 (`:2248`, `:2252`) +
  `STREAMWORLD_HAZARD_KERNEL_HI_ALLOWANCE` 64 (`:2267`) + `STREAMWORLD_SPAWN_KERNEL_HI_ALLOWANCE` 164
  (`:1563`) + `STREAMWORLD_OAM_DRAW_SW_KERNEL_HI_ALLOWANCE` 108 (`:1784`) +
  `STREAMWORLD_ENTITY_SHOW_SW_KERNEL_HI_ALLOWANCE` 164 (`:1791`) +
  `STREAMWORLD_REDRAW_LANDING_KERNEL_HI_ALLOWANCE` 38 (`:1537`) = **5135** (5213 until S3a.5); dialogue
  `STREAMWORLD_DIALOGUE_MAPPER_KERNEL_HI_ALLOWANCE` 613 (`:1407`) +
  `streamworldDialogueLifecycleTerrainConsumerKernelHiAllowance` (rpg) 520 (`:1439-1442`, `:1446`) +
  `STREAMWORLD_DIALOGUE_RELOCATED_KERNEL_HI_ALLOWANCE` 222 (`:1475`) = **1355**; Move
  `STREAMWORLD_MOVE_KERNEL_HI_ALLOWANCE` 76 (`:1827`; 20 since phase 3a S3a, which lifts this table row's Move figures by 56) + `STREAMWORLD_CLOSEFORMOVE_KERNEL_HI_ALLOWANCE`
  14 (`:2053`) + `STREAMWORLD_CLOSEFORMOVE_GUARD_KERNEL_HI_ALLOWANCE` 31 (`:2065`) = **121**. Sum
  5135+1355+121 = 6611; `contentCeilingBytes` = `BANK_SIZE`(8192, `:231`) − 64 − 6611 = **1517**,
  which is the table row's 1439 plus the 78 S3a.5 gave back (the row itself is the 2026-09-28 record).
  **Dated 2026-10-04 (S3b): this decomposition is a 2026-09-28 record and is not re-run.** It predates S1's entity
  projection (+231) and both Move-term changes, so its Move term (76 + 14 + 31) and its totals no longer describe the tree.
  The current Move shapes are measured directly, by building the streamed Move project on 15c11b7 and on the S3b tree
  (`streamworldHiBytesFor` / `contentCeilingBytes`): action 6,843 -> 7,031 / 1,285 -> 1,097, rpg 6,786 -> 6,974 / 1,342 ->
  1,154 (+188 each; the whole delta is `TALKER_KERNEL_HI_ALLOWANCE` 196 + `TALKER_CROSS_CALLS_KERNEL_HI_ALLOWANCE` 12 = 208 added and
  the 20 of `STREAMWORLD_MOVE_KERNEL_HI_ALLOWANCE` deleted). Save's own four terms (not charged in this row, since Save is not
  live): `STREAMWORLD_SAVE_CAMRELEASE_KERNEL_HI_ALLOWANCE` 6 (`:2082`) +
  `STREAMWORLD_SAVE_DISPATCH_KERNEL_HI_ALLOWANCE` 52 (`:2097`) +
  `STREAMWORLD_SAVE_COMMIT_TAIL_KERNEL_HI_ALLOWANCE` 12 (`:2109`) +
  `streamworldSaveResyncKernelHiAllowance` (rpg) 45 (`:2137`, `:2141`) = **115** (matches the
  1560→1445 drop between the two `rpg`/`text=on`/`Move=off` rows above: 1560−1445=115 exactly).
  Against the design's own original 2053+1616+123 split for base/dialogue/Move, the growth is +3082
  (base) −261 (dialogue) −2 (Move) = **+2819** (+3160 / +2897 until S3a.5), entirely inside the resident package's measured
  growth since the design estimate (`docs/design-streamed-worlds.md`'s own matching note).
- **Phase 2 slice 10b — the dialogue overlay relocated (`streamworldDialogueBanked`,
  `main/build/streamplacement.js:584`, the one predicate, re-exported by `generate.js`; it also writes the generated `SW_DLG_BANKED`).**
  For a pinching project (streamed + text + battle bank + content over the resident ceiling) the three
  overlay terms above (613 + lifecycle/terrain consumer + 222 = 1,355) are **not charged to kernel-hi at
  all**; instead `STREAMWORLD_DIALOGUE_BANKED_KERNEL_HI_ALLOWANCE` 113 (`generate.js:1311`, the resident shim block
  `sw_dlg_shim_start..end` less the `.if SAVE_FLASH` check the Save allowance already charges) and
  `STREAMWORLD_DIALOGUE_BANKED_KERNEL_ALLOWANCE` 4 (`generate.js:1315`, kernel-lo: `call_battle`'s
  `cmp #BE_DLG_FIRST / bcs`) are, and the overlay's own bytes are charged to the battle region as
  `STREAMWORLD_DIALOGUE_BATTLE_ALLOWANCE` 1,385 (`main/build/battletables.js:777`, passed to
  `battleRegionBytes` as `{streamDialogueBanked}` because that file must stay renderer-safe and cannot
  import the predicate; the Build panel's meter reaches the predicate through `battleRegionBytesPlaced`,
  `streamplacement.js:645`, which the renderer may import because that module and everything it
  imports is pure — the predicate and the resident kernel-hi allowances it sums moved there verbatim,
  and `generate.js` re-exports every name it used to export; `test/unit/streamplacement.test.js` pins
  the import closure, the panel's call and the 1,385-byte difference against the resident twin). Each is equality-asserted against nesasm: the 1,385 by
  `test/unit/bankedbytes.test.js` (per variant, no-Save/Save/Move, against the resident twin), the 113 and
  the 4 by `test/unit/kernelbytes.test.js`. `residentContentCeilingBytes` (`generate.js:3200`) is the ceiling the
  predicate compares against; `contentCeilingBytes` is the relocated one (resident + 1,242). The
  region-fit check (`checkCapacity`) and `switchableMappers` both pass the predicate, so a candidate
  mapper is never offered on the resident ceiling's arithmetic. Measured figures: see
  `docs/design-streamed-worlds.md`'s slice 10b note.
- Phase 2 slice 2b, Part F: ten more kernel-**lo** terms streaming adds (plus two more from phase 2
  slice 4b, listed at the end of this group), each its own named allowance (`main/build/generate.js`,
  all gated on `projectUsesStreaming`, added inside `kernelCodeBytes`), measured as
  `symbolAddr(after) - symbolAddr(before)` off a real build between a pair of unconditional boundary
  labels bracketing each site's own `.if STREAMING_ENABLED` addition — flat across game type and the
  `mixed` shape, confirmed by measuring all three (`test/lib/streamedproject.js`):
  - `STREAMWORLD_RESOLVER_KERNEL_ALLOWANCE = 15` — `engine/boot.asm`'s own copy of the
    resolve-and-render dispatch (cold boot draws its first screen inline rather than calling
    `redraw_screen`): `jsr sw_resolve_screen` plus the `map_is_streamed` branch, a `jsr` into the
    shared landing render routine (below), and the tail jump back into the ordinary path's shared
    tail. **B1** (phase 2 slice 9 fix round 1b, Chris's relocation ruling): originally 49 bytes,
    carrying the whole streamed-landing render sequence inline; that sequence deduplicated into one
    shared kernel-hi routine (`STREAMWORLD_REDRAW_LANDING_KERNEL_HI_ALLOWANCE` below), leaving only
    the dispatch and the `jsr` to it.
  - `STREAMWORLD_REDRAW_KERNEL_ALLOWANCE = 13` — `engine/screens.asm`'s `redraw_screen`, the
    "re-keyed consumer" version of the identical dispatch, reached by every other landing
    (`start_game`, `restart_game`, `take_door`, `continue_game`); 2 bytes less than the resolver
    term because this copy ends in `rts` rather than boot's own 3-byte tail jump. **B1**: originally
    47 bytes, same relocation as the resolver term above.
  - `STREAMWORLD_REDRAW_LANDING_KERNEL_HI_ALLOWANCE = 38` — **B1** (phase 2 slice 9 fix round 1b):
    the shared kernel-hi render routine both dispatches above now `jsr` into
    (`engine/streamworld.asm`'s `sw_redraw_screen_landing`) — `sw_render_window`, `spawn_entities`,
    `build_oam`, `draw_entities`, `wait_vblank_poll`, the `cam_nt`/`cam_x_lo`/`cam_y_lo` scroll
    write. New code only in the sense that it is now its own routine rather than being inlined
    byte-for-byte at both call sites; deduplicating the two identical copies is exactly what shrank
    the resolver and redraw terms above. Gated identically (`hasStreamed` alone).
  - `STREAMWORLD_SET_SCREEN_PTR_KERNEL_ALLOWANCE = 8` — `engine/screens.asm`'s `set_screen_ptr`: an
    early return through `sw_locate_current` when the CURRENT screen is streamed (`call_battle`
    always ends `jmp set_screen_ptr`, so this runs even for a non-fight session-lifecycle entry).
  - `STREAMWORLD_SPAWN_KERNEL_ALLOWANCE = 12` — `engine/entities.asm`'s `spawn_entities`: the
    streamed-vs-ordinary dispatch in `spawn_clear`'s own preamble — the `map_is_streamed` branch,
    the ordinary side's shared join, and `jmp spawn_streamed` for the streamed side. **B1**:
    `spawn_streamed`'s own body (the actor/x/y/target/toX/toY/event/trigger/hideSwitch field loop,
    walked with `sw_adv_offset` instead of a bare `iny` since a streamed record is
    `STREAM_RECORD_BYTES` long) relocated to `engine/streamworld.asm` —
    `STREAMWORLD_SPAWN_KERNEL_HI_ALLOWANCE` below; a `jmp` costs the same regardless of distance, so
    the dispatch itself shrank from 176 to 12.
  - `STREAMWORLD_SPAWN_KERNEL_HI_ALLOWANCE = 164` — **B1**: `spawn_streamed`'s own body, relocated
    whole to `engine/streamworld.asm` — see the term above. Byte-for-byte the same body, unchanged
    by the move.
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
  - `STREAMWORLD_PROJECT_KERNEL_ALLOWANCE = 17` — the projection wiring's combined dispatch-only
    span: `engine/oam.asm`'s `build_oam_draw_dispatch`/`_dispatch_done` trampoline (7) +
    `engine/entities.asm`'s `draw_one_entity_show`/`de_show_dispatch_done` trampoline (7) + the
    `draw_one_entity_hurt_dispatch`/`draw_one_entity_show` streamed-minus-ordinary REPLACE delta
    (3, unchanged by B1 below — streamed 5, ordinary 2, `kernelbytes.test.js`'s own
    double-difference technique) = 17. **B1** (phase 2 slice 9 fix round 1b, Chris's relocation
    ruling): originally 286 — `build_oam_draw_sw` (108) and the
    `draw_one_entity_ordinary_join`/`draw_one_entity_animate` join span (167, of which 164 is
    `draw_one_entity_show_sw` itself, the other 3 the ordinary-join `jmp` that no longer exists now
    that `draw_one_entity_animate` is unconditional) relocated whole to `engine/streamworld.asm` —
    `STREAMWORLD_OAM_DRAW_SW_KERNEL_HI_ALLOWANCE`/`STREAMWORLD_ENTITY_SHOW_SW_KERNEL_HI_ALLOWANCE`
    below — leaving each call site a `beq`-then-`jmp` trampoline (a `bne` can no longer reach the
    relocated body), 3 bytes more than the original 4-byte `bne` apiece. The 286 figure itself had
    already grown from an earlier 45/161 in the round 1 review fix (real per-tile projection for
    entities, replacing origin-only projection): the join span duplicated `entity_animation`'s own
    `NO_ANIM`/metasprite-id lookup (needed before X is safe to spend on the per-tile projection
    calls) rather than sharing it with `draw_one_entity_animate`'s tail, and that larger
    streamed-only routine is what pushed `draw_one_entity`'s own `ent_hurt` dispatch out of a plain
    `bne`'s ±128 range in a streaming build alone — that pre-B1 history is unaffected by the
    relocation, which only moved WHERE the bodies live, not their own byte count.
  - `STREAMWORLD_OAM_DRAW_SW_KERNEL_HI_ALLOWANCE = 108` — **B1**: `build_oam_draw_sw`'s own body,
    relocated whole to `engine/streamworld.asm` — see the term above. Byte-for-byte the same body.
  - `STREAMWORLD_ENTITY_SHOW_SW_KERNEL_HI_ALLOWANCE = 164` — **B1**: `draw_one_entity_show_sw`'s own
    body, relocated whole to `engine/streamworld.asm` — see the term above. Byte-for-byte the same
    body.
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
- Phase 2 slice 9 (Close-for-Save) adds **seven** kernel terms, each gated on `projectUsesStreaming
  && projectUsesText && usesSave` (SAVE_FLASH) except where noted, equality-asserted by
  `kernelbytes.test.js` on both game types and the `mixed` shape (`node --test --test-name-pattern
  "every Save kernel-lo/kernel-hi term equals its real assembled span"`), plus two separate gates
  outside that predicate. Four are kernel-lo, summing to a flat **28 bytes**:
  - `STREAMWORLD_SAVE_DISPATCH_KERNEL_ALLOWANCE = 7` — `engine/save.asm`'s
    `script_op_save_dispatch`: the tail-dispatch on `map_is_streamed` that reroutes a streamed
    commit into `sw_save_commit_tail` (kernel-hi) instead of the ordinary immediate-commit path.
    Nested inside `.if SAVE_FLASH` in `engine/save.asm`, so its label is entirely ABSENT (not
    merely zero-length) from a build with Save off.
  - `STREAMWORLD_SAVE_ARMING_GATE_KERNEL_ALLOWANCE = 5` — `engine/input.asm`'s
    `dispatch_save_arm_gate`, round-2 finding A1's own fix: stops the *rest of the same frame's*
    `dispatch_loop` pass the instant an action arms the deferred Save (`sw_dlg20_save_pending` set),
    so no later button on that identical frame can reach `do_action_dialog`/`do_action_pause`
    against a transaction that has already begun. Gated `STREAMING_ENABLED && TEXT_ENABLED &&
    SAVE_FLASH`, but the label itself sits OUTSIDE all three nested `.if`s, so it is present (at
    span 0) in every build regardless of the predicate — only the body's cost depends on it.
  - `STREAMWORLD_SAVE_GATE_KERNEL_ALLOWANCE = 16` — `engine/boot.asm`'s `main_loop_save_gate`,
    round 1 finding A1: from the frame after arming through the frame `sw_dlg20_pending_tick`
    commits, this `jmp`s straight to `main_loop_draw` ahead of `dispatch_input`, so `dispatch_input`
    does not run at all on any of those frames. Same outside-the-`.if` label placement as the
    arming gate above, present at span 0 in every build regardless of predicate.
  - `STREAMWORLD_SAVE_COMMIT_RESYNC_KERNEL_ALLOWANCE = 0` — `save_media_commit`'s own dispatch
    between the streamed resync tail and the ordinary `enable_rendering` tail is a REPLACEMENT at
    an identical call site inside an existing `.if STREAMING_ENABLED / .else`, not an addition (the
    physical `jsr sw_save_commit_tail` is 3 bytes, but its own incremental cost against
    `kernelCodeBytes` is 0 since it displaces an equal-size `jsr enable_rendering` at the same site
    — `save_media_commit_resync_start..end`'s own span is asserted at the literal 3, separately from
    this allowance; `phase 2 slice 9 fix 2 (A3)` proves the 0 delta empirically against a real
    streamed-vs-STREAMING_ENABLED-forced-off build pair, not merely by construction).
  Four are kernel-hi, summing to **118 bytes (action) / 115 bytes (rpg)** — the RPG figure is lower
  because `STREAMWORLD_SAVE_RESYNC_KERNEL_HI_ALLOWANCE_BY_GAME_TYPE` is the only per-game-type term
  among the four (48/45 is that one term's own span, not the combined total):
  - `STREAMWORLD_SAVE_CAMRELEASE_KERNEL_HI_ALLOWANCE = 6` — `engine/streamworld.asm`'s
    `sw_dlg17cr_save_check`, checked ahead of the MOVE_ENABLED camera-release branch so a Save's own
    close is never folded into `sw_dlg_closeformove_check`'s MOVE_ENABLED-gated body. Nested inside
    that file's own `.if TEXT_ENABLED` block (lines 3754-5125 as of this fix round) on top of the
    file-level `STREAMING_ENABLED` gate, so on the streamed-without-Save shape specifically it is
    ABSENT for an action project (no dialogue at all, so `projectUsesText` is false) but PRESENT at
    span 0 for an RPG project (`projectUsesText` hard-codes true for `gameType === 'rpg'`,
    `shared/font.js`) — the one place in this whole ledger where a term's PRESENCE, not merely its
    span, differs by game type on an off-predicate build.
  - `STREAMWORLD_SAVE_DISPATCH_KERNEL_HI_ALLOWANCE = 52` — `sw_dlg20_save_dispatch`, same
    `.if TEXT_ENABLED` nesting and the same action/RPG presence split as the term above.
  - `STREAMWORLD_SAVE_COMMIT_TAIL_KERNEL_HI_ALLOWANCE = 12` — `sw_save_commit_tail`, the kernel-hi
    trampoline B1 relocated `save_media_commit`'s own streamed-vs-ordinary branch onto (see B1,
    above). Its label sits at TOP LEVEL in `engine/streamworld.asm` — only inside its own local
    `.if SAVE_FLASH`, not nested under `TEXT_ENABLED` — so unlike the two terms above it is PRESENT
    at span 0 on both game types whenever the file assembles at all (`STREAMING_ENABLED`), and
    wholly ABSENT only once the project stops being streamed.
  - `STREAMWORLD_SAVE_RESYNC_KERNEL_HI_ALLOWANCE_BY_GAME_TYPE = { action: 48, rpg: 45 }` —
    `sw_save_resync`'s own full redraw/OAM/manual-DMA/scroll-republish body (`docs/reference-
    engine.md`'s "34 additional real frames" paragraph). Same top-level label placement as
    `sw_save_commit_tail` above (present at span 0 whenever streamed, regardless of Save or text).
  `kernelbytes.test.js`'s own off-predicate section builds both the opposite-shape pairs directly —
  a streamed project with no live Save, and a non-streamed project WITH a live Save — and asserts
  each of these seven spans by name against the exact presence/absence + value matrix above, rather
  than assuming "every span is 0" (round 3 finding A-blocking 3: the two shapes are not symmetric,
  and two of the seven terms are not even symmetric across game types within the same shape).
  **B1's tradeoff** (Chris's ruling, fix round 1b): relocating `spawn_streamed`, `build_oam_draw_sw`,
  `draw_one_entity_show_sw` and `sw_redraw_screen_landing` from kernel-lo into kernel-hi, unconditional
  within streaming (paid by every streamed project, Save or not — see `STREAMWORLD_PROJECT_KERNEL_
  ALLOWANCE`/`STREAMWORLD_OAM_DRAW_SW_KERNEL_HI_ALLOWANCE`/`STREAMWORLD_ENTITY_SHOW_SW_KERNEL_HI_
  ALLOWANCE` above), saves a measured **501 kernel-lo bytes** but costs a measured **474 kernel-hi
  bytes** on a no-Save streamed project versus the same project built against a flat, unreconstructed
  2563ef4 — a net **27-byte reduction**, not equality (`B1 total kernel-lo+hi bytes` test, both game
  types: `node --test --test-name-pattern "B1 total kernel-lo\+hi bytes"` — 2 pass, 0 fail,
  re-verified against the current tree while writing this ledger). This buys streamed-project
  kernel-lo headroom at kernel-hi's expense rather than a wash, and is why a streamed project without
  Save is never byte-identical to flat 2563ef4 even though it pays none of the seven Save-specific
  terms above. The accepted-boundary figures for how many ordinary 1x1 maps a streamed+camera project
  can still add before capacity refuses (Action Move family: 31; Action Save family: 25; RPG Say
  family: 44) were re-measured directly against the tree at phase 2's close, before phase 3a
  (`handoff-next/s9-fix3-scratch/accepted-boundary-remeasure.mjs`, a path-adjusted copy of round 3's
  own `E3/accepted-boundary.mjs`). The Save and RPG Say figures are unchanged from the round-3
  review's own recorded figures; the Move figure is one lower than round 3's 32 because
  `move_face`'s pose clamp (`FACE_KERNEL_ALLOWANCE` 13 -> 37, +24 bytes) is charged to every
  Move project (31 maps accepted at 8,165 bytes used; the 32nd needs 740 bytes of lookup tables
  with 724 free).

**Phase 3a slice S1 — the streamed entity projection, the OAM-ready flag and the Flash guard.**
Four named allowances, each equality-asserted in `kernelbytes.test.js` and gated on its own predicate,
so a project not using the feature assembles byte-for-byte as before:

- `OAM_BUSY_KERNEL_LO_ALLOWANCE = 18` (`main/build/generate.js`) — the inverted `oam_busy` flag's
  `boot.asm`/`combat.asm` sites, gated on `OAM_BUSY_ENABLED` (any streamed project; paid by Save and
  non-Save alike).
- `PROJ_SETUP_KERNEL_LO_ALLOWANCE = 3` — the `jsr sw_ent_setup` call at `draw_entities`, gated on
  `STREAM_PROJ_ENABLED` (`projectUsesStreamedActors`).
- `STREAMWORLD_ENTITY_PROJ_KERNEL_HI_ALLOWANCE = 395` (`main/build/streamplacement.js`) — the
  `sw_ent_setup` routine and the cull/inside/straddle projection. It *replaces*
  `STREAMWORLD_ENTITY_SHOW_SW_KERNEL_HI_ALLOWANCE` (164) rather than adding to it, so the Move-project
  arithmetic in `kernelbytes.test.js` carries `395 - 164 = 231`, and an actorless streamed project
  keeps the 164-byte per-tile routine.
- `STREAMWORLD_WIN_ARM_FLASH_GUARD_KERNEL_HI_ALLOWANCE = 10` — the row-strip Flash guard in
  `sw_win_arm_row` (`lda <flash_left / cmp #FLASH_PENDING / beq / cmp #FLASH_ARM_VALUE-1 / beq`),
  gated on `FLASH_ENABLED`.

Measured consequences for the author (before → after, S1 with (a1)'s gate on):

| Quantity | Before | After |
| --- | --- | --- |
| kernel-hi content ceiling, resident dialogue | 1560 | 1329 |
| kernel-hi ceiling, relocated dialogue, no Save | 2802 | 2571 |
| kernel-hi ceiling, relocated dialogue, Save | 2687 | 2456 |
| kernel-hi ceiling, relocated dialogue, Move | 2681 | 2450 (2506 after S3a, which deleted the private Move probe: `STREAMWORLD_MOVE_KERNEL_HI_ALLOWANCE` 76 -> 20; 2584 after S3a.5; **2396 after S3b**, `streamworlddialogueboundary.test.js`) |
| kernel-lo on a Save project with streamed actors | — | +21 (18 + 3) |
| maximum placed actors, the Save inventory project | 24 | 21 (8 lookup bytes per actor; 22 actors need 288 against 289 free before (a1)'s gate and 282 after it; `S1_SAVE_ACTORS_DROPPED` = 3, accepted 2026-09-30) |
| accepted-boundary ordinary maps, Move family | 31 | 31 |
| accepted-boundary ordinary maps, Save family | 25 | 23 |
| accepted-boundary ordinary maps, RPG Say family | 44 | 43 |

The accepted-boundary rows were re-measured against the final (a1) tree
(`handoff-next/s9-fix3-scratch/accepted-boundary-remeasure.mjs`, log `handoff-next/s1-a1/fix6/accepted-boundary.log`; the
final reviewer's own run gave the same figures): Move 31 maps at 8,151 bytes used (41 free), Save 23 at 8,153 (39 free),
RPG Say 43 at 8,160 (32 free); the next map is refused in each. Where the figures stood before the gate: with S1's flag
alone each family lost one map (Move 30 at 8,164 used, Save 24 at 8,169, RPG Say 43 at 8,153, the S1-only tree's
`handoff-next/s1-defer3/accepted-boundary-s1.log`). The (a1) gate then moved them again: the Move-probe fold (159 -> 117,
-42 bytes) gives the Move family its map back, the gate's 7 bytes cost the Save family another, and the RPG Say family keeps
its 43 maps with seven fewer free bytes.

**Phase 3a slice S1 (a1) — the mover parity gate.** `MOVER_PARITY_GATE_KERNEL_ALLOWANCE = 7`
(`main/build/generate.js`): the `txa / eor <frame_cnt / and #1 / bne update_entities_anim` gate in
`update_entities_behave` (`engine/entities.asm`), kernel-lo only, gated on `usesStreaming` (the same predicate as
`STREAMING_ENABLED`, so it is charged to every streamed project -- ordinary maps included -- and to no other), flat across
mappers and game types, equality-asserted in `kernelbytes.test.js`. In a streamed Move project the Move-probe fold
(`STREAMWORLD_MOVE_KERNEL_ALLOWANCE` 159 -> 117, above) pays for it. The behaviour and the bounds it supports are in
`docs/reference-engine.md`, "The mover parity gate, and the two bounds"; it also costs the author a placed
actor of the Save inventory project: S1 had already taken the capacity from 24 to 22 (the flag, the setup call and the
projection's lookup bytes), and the gate takes it from 22 to 21, so the combined drop is 24 to 21 (table above).

**Phase 3a slice S3b — the talker bookkeeping (2026-10-04; every figure below is measured on the final tree).**
A live `Move` on a streamed map switches on `TALKER_ENABLED` (`projectUsesTalker` = streaming AND a Move anywhere in the project,
`main/build/streamplacement.js`: the one predicate for the generated flag and every allowance; an NPC-only Move pays the same,
`talkerflag.test.js`). A project with no Move, or no streamed map, assembles none of it (`identitymatrix.test.js`, ROMs byte-identical
to the parent's). The mechanism is `docs/reference-engine.md`, "The talker across a seam"; the cost is:

| Term | Region | Bytes | Gate |
| --- | --- | ---: | --- |
| `TALKER_KERNEL_HI_ALLOWANCE` (`sw_talker_capture`..`sw_talker_end`, one span) | kernel-hi | 196 | streaming and Move, every board and game type |
| `TALKER_CROSS_CALLS_KERNEL_HI_ALLOWANCE` (the four `jsr sw_talker_cross` ending `sw_pstep_*`) | kernel-hi | 12 | same |
| `STREAMWORLD_MOVE_KERNEL_HI_ALLOWANCE` (the four `sw_step_nocross` guards) | kernel-hi | 20 -> **deleted** | (was streaming and Move) |
| `TALKER_KERNEL_LO_ALLOWANCE_START_DIALOG` (`start_dialog`'s `jsr`) | kernel-lo | 3 | same |
| `TALKER_KERNEL_LO_ALLOWANCE_CLOSE` (`close_ui`'s `jsr`) | kernel-lo | 3 | same |
| `TALKER_KERNEL_LO_ALLOWANCE_SCRIPT` (Rule R's three entries swap a 3-byte `jmp` for a 3-byte `jmp`) | kernel-lo | **0** (a measured zero) | same |
| `TALKER_KERNEL_LO_ALLOWANCE_SETTLE` (`settle_owed`'s `bne / jsr / beq`) | kernel-lo | 5 | same |
| `TALKER_RESET_KERNEL_LO_ALLOWANCE_INIT_SESSION` (`jsr` plus the `lda #0` it needs after it) | kernel-lo | 5 | same |
| `TALKER_RESET_KERNEL_LO_ALLOWANCE_TAKE_DOOR` | kernel-lo | 3 | same |
| `TALKER_BATTLE_KERNEL_LO_ALLOWANCE` (`battle_end`'s `jsr sw_battle_resume`) | kernel-lo | 3 | also needs the battle base (RPG) |
| `STREAMWORLD_MOVE_KERNEL_ALLOWANCE` | kernel-lo | 83 -> **77** | the `inc/dec sw_step_nocross` pair is gone |

Each is equality-asserted against nesasm's own usage by `test/unit/kernelbytes.test.js`: the supplement sums for a live Move on a
streamed map (kernel-lo, each tested board, action and rpg), the kernel-hi span and the four crossing calls
(`TALKER_KERNEL_HI_ALLOWANCE` + `TALKER_CROSS_CALLS_KERNEL_HI_ALLOWANCE` equal the real kernel-hi cost of the Move, on
UNROM 512, both game types and the mixed shape; the same double difference as before isolates it), and **site by site** (`TALKER_SITES`: each kernel-lo site measured by removing its own
lines from a Code Forge override of the file). Net kernel-lo: **+13 bytes** on an action project (19 - 6) and **+16** on an RPG (22 - 6),
which is exactly the measured fall of the RPG Move scenes' free lookup bytes from **160 to 144**
(`test/fixtures/crossstage/exclusions-conditional.json`, `finalAllowance`). Net kernel-hi: **+188** (208 - 20).

**`contentCeilingBytes` after S3b.** The ceiling is `BANK_SIZE - 64 - streamworldHiBytesFor`, so the +188 comes straight off the Move
shapes and nothing else: action **1,285 -> 1,097**, rpg **1,342 -> 1,154** (the 1,285 / 1,342 are the S3a figures plus S3a.5's 78;
re-derived 2026-10-04 by building the streamed Move project on 15c11b7 and on this tree; `streamworldHiBytesFor` 6,843 -> 7,031 and
6,786 -> 6,974). The no-Move shapes are unchanged (2,939 action, 1,638 rpg, same method) and so are the Save and no-Move dialogue rows;
the relocated-dialogue Move row moves **2,584 -> 2,396**, the one ceiling literal pinned by `streamworlddialogueboundary.test.js`
(its comment records the arithmetic: 208 - 20 = 188). An author's cost: 188 fewer bytes of music + sfx + dialogue fit beside a streamed Move.

**The capacity-refusal set (RPG with a switch-bound tile; all kernel-lo lookup bytes, free 144 against 160 on the parent).** The kernel-lo
tax makes a set of composed cross-stage scenes the generator refuses on the S3b tree. They are held as five **exact-ID groups, kept apart,
never merged and never counted as coverage** (`test/fixtures/crossstage/exclusions-*.json`, per-id need / free / shortfall and parent receipt
in `exclusions-evidence.json`; the counts are asserted by `crossstages.test.js`, `crossevidence.test.js`):

| Group | ids | What it means | Shortfall on the new tree |
| --- | ---: | --- | --- |
| `approved74` (`streamedmove-unreachable.json`) | 74 | Chris's S3a ruling; the parent refuses them too | 19-21 bytes |
| `conditional111` | 111 | Chris's 2026-10-02 conditional acceptance of the S3b tax; **the parent builds every one**, only S3b's +16 refuses it; final since step C regenerated it from the real allowances (4,016 existing-stage cells built, 185 refused = these 111 + the 74; no id added or removed) | 3-11 |
| `appendix` | 89 | 11 F1 + 78 class (a); Chris 2026-10-02; the parent refuses them too; **grants no population or shape exclusion and does not certify the unmeasured RPG-bound class-(a) composition** | 19-72 |
| `origParentRefused` | 18 | Chris 2026-10-03: originals of composed cross-stage scenes (17 x4, 1 x6 with hand-written code) the unchanged parent refuses too | 18-38 |
| `origNewRegression` | 48 | Chris 2026-10-03: originals (33 x4, 13 x5h, 1 x5r, 1 x6 with code) that **build on the parent** and are refused on S3b | 1-14 |

The last two are the **66 originals** (2 with hand-written code, all RPG + bound-tile): an exact-ID acceptance with no population, shape or
game-type exclusion, conditional on every other buildable composition passing, and no substitute or "damage-merged" scene stands for any of
them (those were tried, removed, and are not coverage). The final aggregate (`node test/lua/run_sw_cross.mjs --aggregate=<the six launch files>`, run 2026-10-04; `handoff-next/s3b/impl/D/aggregate.json`): **13,808 planned results, 0 problems, 0 refusals outside every group, evidence 7,526 raw and
5,761 historical, `complete: true`**. The RPG-bound class-(a) composition (`ref` lead) is a capacity refusal, *not covered*: see
`docs/design-streamed-worlds-phase3a.md`, "S3b: measured outcomes", for the X5 probe that confirms hseam-a on the leads that do build.
