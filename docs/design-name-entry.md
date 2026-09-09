# Design: in-game party-member name entry — v14

Chris wants the player to be able to type a name in-game: for the hero at the start of a new game,
and for any party member the moment an authored Join recruits them. This document is fully
standalone — every mechanism below is specified completely in this body, with every `.if` gate
written out, so it can be implemented without access to any earlier round of this design. Through
v12 (GO at round 11, 2026-09-08 morning), the grid's own drawing/input machinery lived in the banked
battle region only (§5), reached from a handful of tiny kernel-lo hooks (§4) through five new
`call_battle` entry points, and the whole feature was RPG-only. Chris then decided, the same evening
(D6-D8, §1), that an action project gets hero naming too, placed in kernel-lo rather than banked
(never both), and that authored `Say` text may carry a token the engine expands at runtime from the
hero's own name. v13 (this round) is the rewrite for that: §5 now specifies two mutually exclusive
placements for the identical `engine/nameentry.asm` source, decided by one generated flag; §9 gains a
new §9a for the token's own syntax, compiler and kernel-lo cost; §8's default-name mechanism is new,
since an action project has no `pc_name` table to seed from; and §11's capacity ledger gains the
action-side terms and a re-measured four-fixture headroom table, taken after phase 1 (the save
migration) landed in the working tree. v13 went to review and came back NO-GO: four P1s (real defects
this round fixes) and four P2s. **P1-1**: the token's own source pointer did not survive between
frames, since it shares `ptr_lo`/`ptr_hi` with `draw_entities`' own animation lookup. **P1-2**: two of
v13's own kernel-lo arms read the banked `pc_name` table directly, silently reading whatever screen
data happened to be mapped instead — fixed by making the token always read `pc_name_ram` and seeding
that RAM correctly at its source instead (the RPG half already had a working mechanism, `party_init`/
`party_join`, that v13 never used). **P1-3**: `NAME_LEN`'s own sole writer is omitted entirely from an
action build, an undefined-symbol assembler error — fixed by moving it to `config.inc`. **P1-4**:
`encodeLine`'s own return shape did not match its caller. Four P2s (§9a/§13/§11) are fixed alongside
them. Every prior round's own history (v1 through v13) is below, unmodified except where a v13 or v14
decision makes a specific sentence false, in which case the Changelog names exactly what changed and
why. No section below is allowed to shrink from an earlier round's own
line count without the Changelog saying what was cut and why — the v12→v13 per-section line counts are
in the Changelog's own v13 entry.

## §0. What was read to write this document (HEAD `12c5c79`)

**Names today.** `shared/project.js`: `RPG_LIMITS` (`:1111-1127`), `createPartyMember`
(`:3781-3800`), `createProject`'s party seed (`:3860`) and its own `rpg:` field (`:3862`).
`main/build/battletables.js`: `NAME_LIMIT`/`NAME_LEN` (`:48`, `:291`), `nameTiles` (`:102-106`),
`PARTY_SIZE = ${party.length}` (`:250`). `engine/battle.asm`: `draw_panel` (`:588-617`),
`name_offset_pc` (`:640-657`), `party_init`/`party_join` (`:54-91`), `battle_entry`/
`battle_entry_join` (`:20-46`).

**The trampoline.** `engine/banks.asm`: `call_battle` (`:410-415` — `sta bt_call / lda #BATTLE_BANK /
jsr switch_prg_bank / jsr battle_entry / jmp set_screen_ptr`; `A` is not preserved past the first
instruction). `switch_prg_bank` exists in three board-specific variants, each behind its own `.if
PRG_SWITCH_*` (`:132` `PRG_SWITCH_SIMPLE`, `:149` `PRG_SWITCH_MMC1`, `:184` `PRG_SWITCH_MMC3`, `:240`
`PRG_SWITCH_UNROM512`, `:271` `PRG_SWITCH_NONE`) — the `php`/`sei`/`split_lock` critical section
(`:207-231`) sits inside the `.if PRG_SWITCH_MMC3` arm specifically (confirmed by the `mmc3_init:`
label immediately following it at `:234`), consistent with `SPLIT_ENABLED` only ever being true on
MMC3. `CLAUDE.md`'s own "The battle system" section: "the restore *is* the return"; "Calling *out* of
this bank is free — the kernel at $C000-$FFFF is permanently mapped."

**The VRAM queue.** `engine/text.asm`: `vram_open`/`vram_push`/`vram_end` (`:111-144`) — every one of
these three routines only ever writes `vram_buf`, plain RAM, never `$2006`/`$2007` directly.
`vram_drain` (`:150-…`), run from NMI during vblank, is the routine that actually performs the PPU
writes, later, from whatever `vram_buf` already holds.

**RAM allocation.** `engine/constants.asm`: `MAX_PARTY = 4` (`:543`), the `pc_*` battle arrays as bare
equates (`:546-554`), the battle scratch bytes `bt_tmp`/`bt_tmp2` alongside `bt_actor` (`:141`),
`bt_sel` (`:142`), `bt_target` (`:143`), the sfx RAM block's own "confirmed-unused $0568-$05FF gap"
comment (`:709-722`) with `sting_shadow_inst_base` ending at `$0570` (`:746`). `ST_GAMEPLAY`..
`ST_BATTLE` (`:940-945`). `box_state` (`:104`), `box_after` (`:205`), `BOX_CLOSED`..`BOX_CHOICEWAIT`
(`:1001-1009`). Box geometry (`:957-979`).

**Game states, input, the box.** `shared/project.js`: `INPUT_STATES = ['gameplay', 'menu', 'dialog',
'title', 'gameover', 'battle']` (`:448`, a plain six-entry array with its own "**Append only**" doc
comment — no gating mechanism of any kind, confirmed this round by reading the array itself rather
than assuming one exists), `BUTTONS = ['A', 'B', 'SELECT', 'START']` (`:421`), `ACTIONS` (`:424-440`),
`EVENT_COMMANDS`'s `join` entry — `{ id: 'join', label: 'Party member joins', args: ['member'] }`
(`:773`, one arg, confirmed this round rather than assumed), `normalizeEventCommand`'s per-arg loop —
`for (const arg of command.args)` (`:4135`) — which only ever reaches a case for an arg actually
listed in `command.args`, `defaultInput` (`:3749-3768`), `normalizeInput` (`:4875-4884`). `engine/
input.asm` in full: `dispatch_input`/`dispatch_loop` (`:44-101`), `do_action`'s own dispatch chain
(`:108-126` — a straight-line `cmp`/`beq` sequence, `beq do_action_pause` at `:120`, `do_action_none:
rts` at `:125-126`), `do_action_confirm`/`do_action_cancel` (`:146-181`). `engine/text.asm`:
`box_begin`/`box_say`/`box_close` (`:183-221`), `text_tick` (`:224-253`), `text_advance` (`:262-283`),
`box_handover` (`:433-440`), `box_text_row_addr` (`:444-455`), `text_close_step`/`text_close_attr`
(`:586-657`). `renderer/forges/controller/controller.js`: `ENGINE_SUPPORT` (`:12-66`), `STATE_LABELS`
(`:71-80`), `bindableStates` (`:93-98`).

**Boot, title, the field.** `engine/boot.asm`: `reset` (`:3-118`), `main_loop`/`settle_owed`
(`:102-229`), `main_loop_ui`/`main_loop_draw` (`:230-256`, `draw_ui` at `:243`).
`engine/screens.asm`'s `redraw_screen` (`:100-164`). `engine/title.asm`: `title_draw`'s own gate
(`:15-19`), `start_game`/`restart_game` (`:233-269`). `engine/entities.asm`: `spawn_entities`
(`:5-100`), `draw_entities` (`:558-587`). `engine/script.asm`: `script_op_join` (`:380-386`),
`script_finish`/`script_resume` (`:256-259`, `:1082-1087`), `script_arg`/`script_next2`
(`:1076-1079`, `:353-356`). `engine/combat.asm`: `player_died` (`:368-376`), `init_session`
(`:58-147`). `engine/split.asm`: `split_select` (`:73-96`). `engine/ui.asm`: `ui_tick`'s dispatch
chain (`:240-331`, `ui_tick_battle:` at `:297`), `draw_ui`/`draw_menu`/`draw_dialog` (`:351-423`).

**Sprite reservation and OAM budget, re-read in full this round for the CHR-stamp gap X1 found.**
`shared/project.js`: `spriteReservedRanges` (`:2860-2869`), the two reserved-range collision checks
(`:5860-5894`), `overlaySpriteBudget` (`:3338-3355`). `main/build/generate.js`: the reserved-range
sprite-art stamp itself — `const fontSplit = fontBankSplit(project, mapper)` (`:2185`), `if (fontSplit
&& codeRegionCount(project)) { for (const tileset of tilesets) tileset.sprites[SPRITE_ARROW_TILE] =
SPRITE_ARROW_ART; }` (`:2322-2329` — confirmed this round to be gated on `fontSplit` ALONE, with no
naming-aware arm at all: a naming-only, non-split board would reserve the tile via
`spriteReservedRanges` but never draw into it, leaving the cursor sprite blank).

**The event system and the compiler, re-read in full this round for the args-array gap X1 found.**
`shared/project.js`: `NO_MEMBER = 0xff` (`:118`), `normalizeEventCommand`'s `'member'` case
(`:4149-4150`), `normalizeRpg` (`:4864-4873`) and its one caller at `:5257`, `normalizePartyMember`
(`:4831-4862`), `validateProject`'s Save-needs-a-title refusal (`:6098-6115`). `main/build/
textcompile.js`: the `join` case in `encodeCommand`'s switch — `case 'join': return [opIndex('join'),
command.member === null ? NO_MEMBER : byte(command.member, 3)];` (`:341-342`, confirmed this round to
read only `command.member`, never `command.named` — the packed-operand rewrite in §7 below is a real
change to this case, not something already present). `test/lib/eventdecoder.js`: the module's own
header (`:1-24` — "replacing only the two operand kinds a reorder/duplicate/delete/resize can ever
relocate... with resolved, build-independent content. Everything else... is compared as raw bytes,"
confirmed this round to mean `join`'s own member index — not a relocatable reference the way a Warp's
screen or a Say's string id are — belongs on the generic raw-bytes path, not a bespoke resolved-shape
case), `EXCEPTIONAL_WIDTHS = { sting: 3, sfx: 3, battle: 1 + RPG_LIMITS.monstersPerBattle }`
(`:33-37`), the generic fallback `const width = EXCEPTIONAL_WIDTHS[entry.id] ?? 1 + entry.args.length`
(`:132`, the exact place a second `args` entry on `join` would otherwise mispredict the wire width).
`test/unit/project.test.js:1304-1324`.

**The Sprite Forge's own editing pattern, re-read for the exact checkbox shape used elsewhere in the
same file.** `renderer/forges/sprite/battle.js`: `partyPanel`'s own `setMember` closure (`:29-37`,
`store.commit('Change party member', ...)` then `rerender()`), and its own "Starts in the party"
checkbox (`:87-95` — `el('label.check', {title}, el('input', {type: 'checkbox', checked, onchange}),
' label text')`), the exact pattern this round's own hero-naming checkbox in §13 is modeled on
verbatim rather than invented. `renderer/forges/build/build.js:55-60`'s own `project.rpg.*` editor.

**The Map Forge's join-row editor, re-read for the exact control/summary shapes.** `renderer/forges/
map/events.js`: the `join` case in the summary-line switch (`:333-336`), the `join` case in the
per-command control builder (`:1527-1559` — the member `<select>`, including its own comment on why
`command.member`'s `null` sentinel needs the empty-string round-trip a `Number()`-based select does
not), `defaultCommand` (`:194-197` — `for (const arg of entry.args)`, the identical args-driven loop
shape as the schema normalizer, meaning a default value for `'named'` is unreachable for the same
reason the normalizer's own case is until `'named'` is added to `EVENT_COMMANDS`'s `join` entry).

**Capacity, and its own two Node boundaries — re-read fully this round for the exact insertion points
X1/X2/X3 need.** `main/build/generate.js`: `kernelCodeBytes` (`:1031-1124`, read in full this round —
every `usesX ? ALLOWANCE : 0` term and the local `usesX` booleans it is built from, immediately above
the function body, at `:1044-1099`), `battleEnabledFor` (`:1027-1029`), `codeRegionCount` (`:191`),
`kernelTableBytes` (`:1837-1850`, read in full this round — `fixedBytes`'s own `INPUT_STATES.length *
BUTTONS.length` term at `:1849`, confirmed to be unconditional, derived directly from the array's
length rather than gated on any predicate — the same mechanism that already charges every project,
RPG or action, for the existing `battle` and `title` rows regardless of whether either state is ever
reached), `checkCapacity` (`:1886-1922`), `switchableMappers` (`:1224-1329`), `kernelShortfallAdvice`
(`:1357-1477`, read in full this round — its real signature is `(project, mapper, deficit)`, no
options object and no `exact` parameter at all; its `active` array of `{label, strip}` entries
(`:1380-1396`), `occupancy`/`freedByDropping` (`:1420-1428`), the solo search (`:1433-1438`) and the
combination search over every subset of size ≥2 (`:1451-1461`) — this combination search already
exists and is completely generic over whatever `active` holds, so a "both naming features together"
candidate needs no bespoke code once both are pushed onto `active`), `projectWithoutCommands`
(`:1140-1150` — `structuredClone` then `command.off = true` for every occurrence found by walking
`event.pages ?? []` through `allCommands`, deliberately not `liveCommands`, so a switched-off-branch's
own dead command is still disabled). `TITLE_KERNEL_ALLOWANCE_BY_MAPPER = { 30: 212, 1: 212, 4: 224 }`
(`:731`). The two locals `generateAssets` computes right before the CHR/config-writing steps used
above and below: `const bankedCode = codeRegionCount(project)` (`:2412`), `const codeSlots =
codeRegions(mapper, tilesets.length, bankedCode)` (`:2413`), and the flag line it already writes from
them — `` `BATTLE_ENABLED = ${codeSlots.length ? 1 : 0}` `` (`:2660`), the exact boolean this round's
own `NAME_ENTRY_ENABLED`/`JOIN_NAMING_ENABLED`/`HERO_NAMING_ENABLED` lines sit beside. The exact-vs-
overridden deficit computation X2 turns on: `const overridden = battleCodeOverridden(project)`
(`:2026`), `const regionBytes = overridden ? battleTableBytes(project) : battleRegionBytes(project,
mapper)` (`:2036` — confirmed this round: when overridden, the deficit passed to `battleShortfallAdvice`
is computed from `battleTableBytes` ALONE, with no reference anywhere to stock code size), the call
site itself (`:2053-2058`, `exact: !overridden`).

`main/build/battletables.js`, re-read in full this round: its own header (`:1-19`), `BASE_
BATTLE_CODE_BYTES_BY_MAPPER`/`ITEM_LIST_FILTER_BATTLE_ALLOWANCE = 17` (`:451-535`), `battleRegionBytes`
(`:803-809`), `BATTLE_REGION_SOURCES = ['battle.asm', 'battleui.asm', 'battleturn.asm']` (`:633`),
`battleShortfallAdvice` (`:867-969`, read in full again this round line by line): `target =
battleTableBytes(project) - deficit` (`:868`), the `levers` array and its own per-lever search, each
option checked with `battleTableBytes(draft) <= target` (`:896-906` — confirmed this round: every
existing lever is validated purely against `battleTableBytes`, the generated-tables figure, which is
exactly what stays well-defined and meaningful even when `exact` is false, since an override cannot
change what the generator itself emits), `options` (`:896`), the `roomier`/`boards` logic (`:908-949`,
`exact ? ... : 'Because this project overrides...'`), and the final `options`-driven return
(`:950-969`). `test/unit/bankedbytes.test.js`: `'an override of the battle sources withdraws the
claim rather than guessing'` (`:1154-1213`).
`engine/main.asm:29-104`. `CLAUDE.md`'s own nesasm zero-page passage and its "Branches are ±128 bytes"
trap entry.

**Test infrastructure and the save fixture, re-read this round for the exact helper shapes §14
restores.** `test/unit/rpg.test.js`: `boot` (`:115-119` — `new NES(...)`, `nes.loadROM(...)`, a fixed
frame count, returns `nes`), `tap` (`:122-127` — `buttonDown`/one frame/`buttonUp`/N more frames),
`talkThrough` (`:178-192` — presses B, then loops pressing A and waiting for `BOX_PAGEWAIT`/
`BOX_ENDWAIT`/`ST_GAMEPLAY` up to a budget), `chooseCommand`/`pressThrough`/`walkTo`/`walkIntoEncounter`
(`:130-175`, the same "press, read memory, loop with a budget" shape every helper in this file uses).
`test/unit/rammap.test.js`: `parseSizeAnnotations` (`:270-278`), `KNOWN_MAX_SIZES` (`:73-156`).
`test/lua/save_sram.lua`: read in full this round for its own numbered-`phase` state-machine style —
`local phase = 1` (`:211`), `read(address)` (`:218`), `onFrame`'s own `if phase == N then ... end`
ladder (`:239-…`), decimal sub-phases (`phase = 3.1`, `:357`) for a state that needs more than one
step without renumbering everything after it. `tools/make-rpg-sample.js` grepped for `'save'`/
`SAVE_ENABLED` — no match, confirming `sample-rpg/` carries no Save command and is itself titleless at
HEAD.

**What was additionally read to write v13, on top of the above (HEAD: phase 1 landed, uncommitted).**
Phase 1 shipped `shared/save.js`'s `SAVE_FIELDS`/`SAVE_LAYOUT_VERSION` bump and `engine/constants.asm`'s
RAM block exactly as §2/§10 already specified, so every §2 address is unchanged; everything citing a
line in `engine/constants.asm` past that block shifted by phase 1's own +20 lines, re-checked and
re-pinned throughout this round (`ST_GAMEPLAY..ST_BATTLE` now `:960-965`, `BOX_CLOSED..BOX_CHOICEWAIT`
now `:1021-1029`, `TXT_END/NEWLINE/PAGE` immediately after at `:1033-1035`, `box_state` `:104` and
`box_after` `:205` unchanged — both sit before the phase-1 insertion point). `shared/project.js` did
not move at all — every `:line` v12 cited for it (`RPG_LIMITS` `:1111`, `INPUT_STATES` `:448`,
`EVENT_COMMANDS`'s `join` entry `:773`, `defaultRpg`/`createPartyMember`/`normalizeRpg`/the per-arg
normalizer loop) still resolves to the identical line, confirmed by re-reading each one rather than
assumed — phase 1 touched only `shared/save.js` and `engine/constants.asm`.

**The action-side mechanism (D8) needed four things v12 never had to read.** `engine/text.asm`:
`text_type_step`/`text_type_control`'s own control-byte dispatch chain (`:336-362`, `bne
text_type_control` on a non-zero byte, then `cmp #TXT_NEWLINE`/`cmp #TXT_PAGE` in sequence, falling to
`text_type_glyph` for anything else — including, today, every glyph tile, since nothing between
`$01`-`$1F` is otherwise claimed), `msg_advance`/`text_put_char` (`:364-389`), `box_begin`'s own
`msg_col`/`msg_line` reset (`:186-187`, the exact precedent this round's own `msg_name_idx` reset
follows). `shared/font.js`: `BOX_COLS = 28`/`BOX_ROWS = 4` (`:39-40`, unchanged from v12's own citation),
`charToTile`/`TILE_SPACE`/`BORDER_H`/`BORDER_V`/`BORDER_CORNER`/`BORDER_FILL` (`:189-200`, confirmed
this round: `BORDER_H`/`BORDER_V`/`BORDER_CORNER`/`BORDER_FILL` are `charToTile('{')`/`'|'`/`'}'`/`'~'`
— the four ASCII punctuation characters a `{name}` token collides with), `wrapText` (`:227-263`, its
own `words`/`candidate.length <= cols`/`word.slice(0, cols)` shape). `main/build/textcompile.js`:
`TXT_END/NEWLINE/PAGE` (`:60-62`, the JS-side hand-duplicate of `engine/constants.asm`'s own equates —
the established two-literals-that-must-agree pattern `TXT_NAME` joins), `encodeString` (`:131-145`,
`wrapText` then per-line `textToTiles`, confirmed this round to call `shared/font.js`'s plain
character-by-character mapper with no token awareness at all). `engine/split.asm`: `split_select`
(`:73-96`), read to its own final, unconditional fallback arm this round rather than only its two
named `.if` arms — `lda #SPL_OFF / ldx box_state / beq split_select_store / lda #SPL_BOX` (`:90-93`)
sits **outside** both the `.if TITLE_ENABLED` (`:74-81`) and `.if BATTLE_ENABLED` (`:82-89`) blocks, and
treats **any** `box_state != BOX_CLOSED` as `SPL_BOX` — already true of `BOX_NAMEENTRY`/`BOX_NAMEDONE`
with no naming-specific code at all, on every board and every game type; see §5's own corrected finding
below. `engine/banks.asm`: `call_battle` (`:409-416`, confirmed this round to be **itself** wrapped in
`.if BATTLE_ENABLED`, i.e. it does not exist at all in an action project's own kernel-lo — the reason
the shim design in §5 has to exist, not merely a convenience). `engine/main.asm`: the full sequential
`.include` list (`:29-94`), confirmed this round to have no existing precedent for a *conditionally
included* kernel-lo file — every optional kernel-lo file (`combat.asm`, `title.asm`, `rpg.asm`,
`flash.asm`) is `.include`d unconditionally with its own body wrapped in `.if X_ENABLED` internally, a
pattern §5's own new action-side include line departs from on purpose, for the reason given there.
`renderer/forges/sprite/sprite.js`: `renderTabs` (`:1191-1212`), confirmed this round that the Sprite
Forge's own tab list is `metasprites`/`animations`/`actors`, plus `party` **only** when
`store.project.project.gameType === 'rpg'` (`:1196-1199`) — v12's own §13 checkbox lived inside the
`party` tab's own panel (`renderer/forges/sprite/battle.js`'s `partyPanel`), which therefore does not
exist at all for an action project; no other panel in this Forge, or anywhere else in the renderer,
edits a project-level (not per-actor) fact about "the player" for both game types today — `heroName`/
`nameHeroAtStart` need a genuinely new home, not a relocated existing one (§13). `shared/project.js`:
`createProject`'s own `project:` block (`:3812-3834`, `titleMap`/`maxHearts`/`saveCompatToken` as
project-level, both-game-types fields — the precedent `nameHeroAtStart`/`heroName` follow), and
`normalizeProject`'s own `project` object (`:5158-5195`, where `titleMap`/`saveCompatToken` are
clamped — where the two new fields' own clamps go). `main/build/generate.js`,
`main/build/battletables.js`: every line v12 cited, re-read and re-pinned at its current position
(shifted from v12's own citations by unrelated work landing on `main/build/generate.js` since HEAD
`12c5c79` — every citation in §4/§5/§9/§11 below is the current line, not v12's). Kernel-lo headroom for
all four action-side fixtures, measured post-phase-1 with a throwaway script
(`loadProject` + `kernelCodeBytes` + `kernelTableBytes`, `BANK_SIZE - kernelBudget - fixedBytes -
tableBytes`, the identical arithmetic `checkCapacity` itself performs): `sample` (NROM) 1008 free,
unchanged from pre-phase-1 (no Save command); `sample-mmc1` 812 (815 - 3); `sample-mmc3` 613 (616 - 3);
`sample-u512` 445 (448 - 3) — each save-capable fixture moved by exactly phase 1's own +3
`SAVE_KERNEL_ALLOWANCE_BY_MAPPER` shift (CLAUDE.md, "The kernel budget"), confirming the pre-phase-1
figures §11 now updates rather than re-deriving them from scratch.

## §1. Chris's decisions (2026-09-08) — restated, not reopened

1. Maximum name length is 10, `RPG_LIMITS.nameLength`.
2. The grid offers A-Z and a-z, 52 glyphs, no digits or punctuation, no space.
3. Naming applies to the hero — `project.party[0]` in an RPG; in an action project, which has no
   `party` array at all (`shared/project.js:3860`, `party: rpg ? [createPartyMember(0, 'Hero')] : []`),
   the single player character `pc_name_ram` slot 0 always means (§8) — at the start of a new game, and
   to any Join that opts in (RPG-only, a Join is an RPG-only command). **Corrected this round (D6): v12
   restricted this decision, and every mechanism built on it, to `project.party[0]` alone because naming
   was RPG-only; that restriction is gone, the hero half of it is not.**
4. The RPG starter and `sample-rpg` both opt in.
5. Delete and Done are grid controls, not new bindable actions; Delete is also reachable through the
   existing Cancel action wherever a project's own controller mapping already binds it (§4).
6. **(D2, confirming §19 open question 2 from v12, not reopened.)** No space in the grid — unchanged
   from item 2 above.
7. **(D3, confirming §19 open question 3.)** The controls-row UP/DOWN snapping rule and its own
   deliberate DOWN-forward/UP-different asymmetry (§6) — kept exactly as v12 specified; no mechanism
   change.
8. **(D4, confirming §19 open question 4.)** `sample-rpg`'s own opt-in covers both hero naming and
   Join naming — already item 4 above; §11's own fit numbers already assumed this for `sample-rpg`.
9. **(D5, confirming §19 open question 5.)** `sample-rpg-mmc1` carries `named: true` on its own Join,
   so `save_sram.lua` drives the grid and can assert a byte-exact restored name (§14).
10. **(D6, new.)** Action projects get hero naming too — the hero (item 3), never a party (action
    projects have none). Join naming stays RPG-only, since Join is itself an RPG-only command
    (`EVENT_COMMANDS`, `shared/project.js`) with nowhere to run in an action project's own compiled
    event set regardless of naming.
11. **(D7, new.)** The action game's own reader is a `Say` token: authored dialogue may contain a
    token the engine expands at runtime from the hero's own RAM name (`pc_name_ram` slot 0). RPG
    dialogue gets the identical token — one mechanism, not two, so a project that changes game type
    keeps whatever tokens it already authored working unchanged. `wrapText` reserves
    `RPG_LIMITS.nameLength` (10) columns for it wherever it appears (§9a).
12. **(D8, new.)** In an action project the naming grid's own code lives in kernel-lo, as a named,
    flat allowance charged only when hero naming is actually on, refused by `checkCapacity` with
    `kernelShortfallAdvice` naming "hero naming" the same way it already names every other optional
    kernel-lo feature when a project cannot afford it. An RPG keeps v12's banked placement completely
    unchanged. **One rule per game type, decided by the project+mapper combination alone, never a
    per-project "banked when it fits, kernel-lo otherwise" hybrid** (§5).

## §2. RAM — every address, all unconditional equates

**Unchanged from phase 1, which already shipped it exactly as specified below** (`engine/
constants.asm:760-766`, confirmed this round against the working tree rather than re-derived): 46
bytes — 40 for `pc_name_ram`, 6 scalar bytes — placed in the confirmed-unused `$0568-$05FF` gap past
`sting_shadow_inst_base` (`:746`, `$0570`). Every address below is a plain, unconditional equate.
**v13 adds one more, `msg_name_idx`, for the Say token (§9a) — the naming grid's own drawing/write
scratch still needs nothing beyond the original six, on either placement (§5).**

```
pc_name_ram    = $0571  ; @size=40 -- MAX_PARTY*NAME_LEN
nm_target      = $0599  ; which party slot (0-3) the open naming session writes into
nm_len         = $059A  ; letters committed so far, 0-NAME_LEN
nm_row         = $059B  ; grid cursor row: 0=A-Z, 1=a-z, 2=controls (DEL/END)
nm_col         = $059C  ; grid cursor column: 0-25 on rows 0/1, 0(DEL)/1(END) on row 2
nm_named       = $059D  ; script_op_join's own scratch (§7)
nm_acted       = $059E  ; per-frame latch: at most one grid action per frame (§4)
msg_name_idx   = $059F  ; TXT_NAME's own typewriter progress, 0-9 (§9a)
```

**Why `msg_name_idx` needs a byte of its own, and why not `bt_tmp`/`bt_tmp2` or `tmp`/`tmp2`.** The
Say token types one glyph of the hero's name per frame, the same one-byte-per-frame rate
`text_type_step` already runs at (§9a) — so something has to persist, frame to frame, how many
glyphs of the *current* token instance have already been drawn, the same way `msg_col`/`msg_line`
already persist the typewriter's own column/row across frames. `bt_tmp`/`bt_tmp2` are out for the
reason CLAUDE.md's own "6502 traps" entry gives: `bt_tmp2` is already `cast_all`'s own end-of-side
sentinel across its whole `spell_damage`/`roll_spell_amount`/`mod8` call chain, and more generally
both are banked-battle scratch that can be live *simultaneously* with an in-progress Say (a battle
message box types text too, via the identical `text_type_step`, while `bt_tmp`/`bt_tmp2` may already
be holding something the surrounding battle code still needs on the next frame) — reusing either
would silently corrupt whichever routine got there first. `tmp`/`tmp2` (zero page, `engine/save.asm`'s
own two-byte checksum scratch) are out for a narrower but equally real reason: they are explicitly
documented as safe only *within* a single subroutine call, never held across a frame boundary the way
this counter must be — `msg_advance`'s own comment on `tmp` usage elsewhere in this codebase already
warns against exactly this. A byte that must survive from one frame's `text_type_step` call to the
next, and that nothing else in the engine ever needs at the same moment, is precisely what the six
existing naming bytes already are for the grid — `msg_name_idx` is a seventh instance of the identical
requirement, so it gets the next free byte in the same confirmed-unused gap rather than reusing
anything.

`test/unit/rammap.test.js`'s `KNOWN_MAX_SIZES` gains: `pc_name_ram: 40,` (phase 1, shipped).
`msg_name_idx` needs no `KNOWN_MAX_SIZES` entry of its own — it is a bare scalar, and that table only
ever names *arrays*, whose own size the guard cannot otherwise infer (the same reason `nm_target`
through `nm_acted` above have none either).

## §3. The two ROM `pc_name` readers, swapped conditionally, at zero byte cost either way

`draw_panel` (`engine/battle.asm:601-604`) and `push_combatant_name` (`engine/battleui.asm:622-625`)
each become a two-way `.if`:

```
  .if NAME_ENTRY_ENABLED
  lda #LOW(pc_name_ram)
  sta ptr_lo
  lda #HIGH(pc_name_ram)
  sta ptr_hi
  .endif
  .if !NAME_ENTRY_ENABLED
  lda #LOW(pc_name)
  sta ptr_lo
  lda #HIGH(pc_name)
  sta ptr_hi
  .endif
```

An `lda #<label>` immediate load is two bytes regardless of which label's value is substituted, so a
feature-off build compiles to exactly today's bytes at these two sites.

**A third reader, new in v13: `text.asm`'s own Say-token expansion (§9a's own full listing) — corrected
this round (P1-2, round-1 finding) to drop the three-way source swap entirely and always read
`pc_name_ram` slot 0, no `.if` at all.** Unlike the two readers above — which walk `name_offset_pc`'s
own stride to reach *any* combatant's name, party or monster — the token always means the hero,
`pc_name_ram` slot 0 specifically (D7, §1), the reason it needs no stride at all: slot 0 sits at
`pc_name_ram`'s own base address with no offset to compute.

**Why not a three-way swap reading `pc_name` directly when naming is off, the way v13 first specified
it.** `pc_name` is banked data (`main/build/battletables.js:257`, emitted into `assets/battle.inc`,
included only inside the switchable region `generate.js` reserves for an RPG's own battle bank) — its
only two existing readers, `draw_panel` and `push_combatant_name`, only ever run *inside* that bank,
reached through `call_battle`'s own trampoline, which is what maps it in the first place. `text_type_
step` is kernel-lo code, running with whatever screen bank the field last switched in — `lda
#LOW(pc_name)` there is a real, resolvable label (nesasm has no complaint), but the byte it reads at
runtime belongs to whatever the switchable window actually holds at that moment, not `pc_name`'s own
data. **The fix is not a bank-switch around the read — kernel-lo code cannot cheaply bank-switch and
switch back around a single indirect read the way `call_battle`'s own trampoline does around a whole
banked call — it is to never need `pc_name` from kernel-lo at all**: `pc_name_ram` slot 0 is now always
kept correctly seeded by construction (§8's own `NAME_SEED_ENABLED` mechanism — the banked
`party_init`/`party_join` path for an RPG, `init_session`'s own kernel-lo copy from `hero_name_default`
for an action project), so the token can simply trust it, unconditionally, on either game type:

```
  .if NAME_TOKEN_ENABLED
  lda #LOW(pc_name_ram)
  sta ptr_lo
  lda #HIGH(pc_name_ram)
  sta ptr_hi
  .endif
```

one arm, not three — cheaper than v13's own three-way swap, not merely simpler, since only one of the
three `.if`-selected label pairs ever needed to exist once the underlying seed problem (P1-2) is fixed
at its source instead of read around. `NAME_TOKEN_ENABLED` (§9) is a separate flag from
`NAME_ENTRY_ENABLED` — the token can exist with naming entirely absent, reading whatever
`NAME_SEED_ENABLED` (§8) already seeded — so the token-reading code stays gated on `NAME_TOKEN_ENABLED`
alone, with no further sub-decision about which table to read left inside it at all.

## §4. The new game state, the readiness gate, every kernel-lo hook, the branch-range fix, and the two
capacity terms this round wires up for real (X1)

**`ST_NAMEENTRY = 6`**; **`BOX_NAMEENTRY = 9`**, the grid up and interactive; **`BOX_NAMEDONE = 10`**,
an inert value set once END is selected, matched by nothing in `text_tick`, `text_advance`,
`do_action_confirm`/`do_action_cancel`, or `draw_ui`.

**The readiness gate**: `box_row == BOX_TEXT_ROWS` in addition to `box_state == BOX_NAMEENTRY`,
everywhere below. **The per-frame action latch**, `nm_acted`, checked and set inside `nameentry_select`/
`nameentry_cancel`, on either placement (§5).

**v13: every kernel-lo hook below is "both" — gated on `NAME_ENTRY_ENABLED` (or `HERO_NAMING_ENABLED`
for the hero-only hooks in §8) alone, never on `BATTLE_ENABLED`/`battleEnabledFor`, so every one of
them already compiles for an action project the moment `HERO_NAMING_ENABLED` is true, with no
game-type branch of its own anywhere in this section.** Walked explicitly, since the brief asks for
it: `do_action`'s own dispatch chain and the branch-range fix (both — the growth these branches make
room for happens whenever naming is on, regardless of game type, so an action project with naming and
a title screen can hit the identical ±127-byte range problem an RPG can); `do_action_confirm`'s and
`do_action_cancel`'s own naming arms (both); `draw_ui`'s naming arm (both); `ui_tick`'s own
`ui_tick_nameentry` routing arm, which merely `jmp text_tick`s and touches no `call_battle` itself
(both — its neighbouring `ui_tick_battle` arm, `.if BATTLE_ENABLED`, is a *different*, pre-existing arm
for real turn-based combat, untouched by this feature on either game type); `text_tick`'s own naming
arm (both); the Y1 input-row fix, `projectUsesNameEntry(project)` alone with no `mapper` argument
(already both, unchanged — §4's own original reasoning for why no mapper check is needed already
covers both game types, since it was never RPG-specific to begin with). **None of these hooks was ever
written against `BATTLE_ENABLED` in the first place — the actual, real integration gap D8 opens is not
a `.if` to change here, but that four of them call `call_battle` directly, and `call_battle` itself is
`.if BATTLE_ENABLED`-wrapped (`engine/banks.asm:409-416`, confirmed this round) and consequently does
not exist at all in an action project's own kernel-lo — an undefined-symbol assembler error the moment
any of these four sites tried to reference it on such a build.** §5's own new shim layer
(`name_begin`/`name_tick`/`name_draw`/`name_select`/`name_cancel`) is the fix, and the four call sites
below are rewritten to use it in place of `call_battle` directly.

**A real branch-range problem, found by static count, and its fix.** `do_action`'s own dispatch chain
(`engine/input.asm:108-126`) is a straight-line `cmp`/`beq` sequence ending `do_action_none: rts` at
`:125-126`, immediately before `do_action_attack` through `do_action_pause` (`:128-196`). Adding this
design's own code to `do_action_confirm`/`do_action_cancel` inserts several dozen bytes *between*
`do_action:`'s own dispatch chain and `do_action_pause:`'s real label — with naming, a title screen,
and Save all enabled (the worst-case gate combination), the forward displacement from `beq
do_action_pause` (`engine/input.asm:120`) to its own target exceeds the 6502's ±127-byte signed range;
the same growth pushes any branch reaching backward from deep inside `do_action_cancel` toward
`do_action_none` (`:125`) out of range in the opposite direction. **The fix, the identical technique
`engine/music.asm` already needed for the same reason, applied in two different shapes depending on
which end of the range problem a given branch is on:**

1. **`do_action`'s own dispatch chain** — `beq do_action_pause` becomes an inverted branch over an
   unconditional `jmp`, whose own target is not limited to ±128 bytes, **conditionally, so a
   naming-off build keeps today's plain 2-byte branch exactly**:

   ```
     cmp #ACT_PAUSE
     .if NAME_ENTRY_ENABLED
     bne do_action_pause_skip
     jmp do_action_pause
   do_action_pause_skip:
     .endif
     .if !NAME_ENTRY_ENABLED
     beq do_action_pause
     .endif
     .if SAVE_ENABLED
     cmp #ACT_CONTINUE
     beq do_action_continue
     .endif
   do_action_none:
     rts
   ```

   Naming off: `cmp`(2) + `beq`(2) = 4 bytes, byte-for-byte identical to today. Naming on: `cmp`(2) +
   `bne`(2) + `jmp`(3) = 7 bytes — a 3-byte increase, charged to `NAME_ENTRY_KERNEL_ALLOWANCE` below.

2. **Every new branch inside `do_action_confirm`/`do_action_cancel` that would otherwise reach back
   toward the distant `do_action_none`** is redirected to a **local** `rts`, defined a few bytes away
   inside the very block that needs it, rather than inverted — since `do_action_none` is nothing but
   an `rts`, any other `rts` reached in range has the identical effect, and a local target can never
   be pushed out of range by unrelated code appearing later in the same file the way a shared, distant
   one can:

   ```
   ; engine/input.asm -- do_action_confirm. The only naming hook that still
   ; needs jsr, not jmp: it has to read box_state back afterward to decide
   ; whether the session just ended.
   do_action_confirm:
     .if NAME_ENTRY_ENABLED
     lda box_state
     cmp #BOX_NAMEENTRY
     bne do_action_confirm_notname
     lda box_row
     cmp #BOX_TEXT_ROWS
     bcc do_action_confirm_wait      ; LOCAL rts (below), never the distant
                                      ; do_action_none
     jsr name_select                 ; shim -- call_battle+BE_NAME_SELECT on
                                      ; an RPG, a direct tail call to
                                      ; nameentry_select on an action project
                                      ; (§5); either way returns here
     lda box_state
     cmp #BOX_NAMEDONE
     bne do_action_confirm_wait      ; LOCAL rts
     jmp script_resume               ; kernel-lo -- §7/§8
   do_action_confirm_wait:
     rts
   do_action_confirm_notname:
     .endif
     lda game_state
     cmp #ST_MENU
     beq do_action_use
     cmp #ST_DIALOG
     beq do_action_dialog
     .if TITLE_ENABLED
     cmp #ST_TITLE
     bne do_action_confirm_done
     jmp start_game
   do_action_confirm_done:
     .endif
     rts

   do_action_cancel:
     .if NAME_ENTRY_ENABLED
     lda box_state
     cmp #BOX_NAMEENTRY
     bne do_action_cancel_notname
     lda box_row
     cmp #BOX_TEXT_ROWS
     bcc do_action_cancel_wait       ; LOCAL rts (below)
     jmp name_cancel                 ; shim -- tail call either way (§5);
                                      ; never ends the session
   do_action_cancel_notname:
     .endif
     lda game_state
     .if NAME_ENTRY_ENABLED
     beq do_action_cancel_wait       ; RETARGETED from do_action_none -- the
                                      ; identical rts either way, now always
                                      ; in range regardless of how much code
                                      ; precedes this file. Same 2-byte cost
                                      ; as the branch it replaces; this is a
                                      ; pure retarget, not new bytes.
     .endif
     .if !NAME_ENTRY_ENABLED
     beq do_action_none              ; today's bytes, unchanged
     .endif
     cmp #ST_DIALOG
     beq do_action_dialog
     .if NAME_ENTRY_ENABLED
     cmp #ST_NAMEENTRY
     beq do_action_cancel_wait       ; RETARGETED from do_action_none, same
                                      ; reasoning and same byte cost
     .endif
   do_action_close:
     jmp close_ui
     .if NAME_ENTRY_ENABLED
   do_action_cancel_wait:
     rts
     .endif
   ```

   The pre-existing "during play there is nothing to back out of" check
   (`lda game_state / beq do_action_none`) is retargeted to the same local `do_action_cancel_wait`
   purely so it, too, stays in range once naming's own code grows the file — a pure retarget, not a
   behavior change, and not a byte-count change — kept conditional on `NAME_ENTRY_ENABLED` purely so a
   naming-off build's own compiled bytes at this exact line are provably identical to today's.

**Every hook's own byte cost, v12's own static count — kept as the starting figure, not re-derived by
hand, and now explicitly stale in one specific way (see the note below).**

- `dispatch_input`'s `sta nm_acted`: 3 bytes.
- `do_action_confirm`'s new block (13 instructions, including its own local `rts`): 30 bytes.
- `do_action_cancel`'s new block (8 instructions in the entry gate, plus the retargeted fallthrough
  guard, plus one new local `rts` shared by both): 24 bytes.
- `draw_ui`'s new block: 19 bytes.
- `text_tick`'s new block: 9 bytes.
- `ui_tick`'s new block: 7 bytes.
- The `do_action_pause` relay, above: 3 bytes.

```
NAME_ENTRY_KERNEL_ALLOWANCE = 3+30+24+19+9+7+3 = 95 bytes; NAME_ENTRY_ENABLED
```

**v13's own shim rewrite moves this figure in two offsetting directions, neither hand-computed here.**
Each of the four call sites above shrank by 2 bytes (`lda #BE_NAME_X` (2) + `jsr/jmp call_battle` (3) =
5, replaced by a single `jsr/jmp name_x` (3)) — but the five shims themselves (§5) are a *new* kernel-lo
block, paid by every project regardless of placement, that v12's own count never had to include because
v12's call sites reached `call_battle` directly with no indirection. Net, this is very likely a small
*increase* to `NAME_ENTRY_KERNEL_ALLOWANCE`, not a decrease — five shims at roughly 3-5 bytes each
(§5) against four call sites saving 2 bytes each — but it is reported as a direction, not a number:
per this document's own repeated discipline (CLAUDE.md, "The kernel budget" — "a term stays flat until
real variance is measured"), the number above is v12's own pre-implementation static count and was
never nesasm-measured even before this rewrite; phase 2 measures the real figure once the shims and
every naming-off/naming-on RPG and action variant actually assemble, the same way every other allowance
in §11 already is measured rather than counted.

**`draw_ui`**:

```
draw_ui:
  .if NAME_ENTRY_ENABLED
  lda box_state
  cmp #BOX_NAMEENTRY
  bne draw_ui_notname
  lda box_row
  cmp #BOX_TEXT_ROWS
  bcc draw_ui_notname
  jmp name_draw                 ; shim -- tail call either way, runs
                                 ; draw_nameentry_cursor (§5)
draw_ui_notname:
  .endif
  lda game_state
  cmp #ST_MENU
  beq draw_menu
  cmp #ST_DIALOG
  beq draw_dialog
  rts
```

**`ui_tick`, with the exact insertion point and the retargeted branch.** The battle arm's own `bne
ui_tick_menu` (`engine/ui.asm:300`) branches directly past every non-battle state; retargeted so a
block inserted after it is reachable:

```
ui_tick_battle:
  .if BATTLE_ENABLED
  cmp #ST_BATTLE
  bne ui_tick_nameentry        ; retargeted from ui_tick_menu -- same two
                                ; bytes either way, zero marginal cost
  lda #BE_TICK
  jmp call_battle
  .endif
ui_tick_nameentry:
  .if NAME_ENTRY_ENABLED
  cmp #ST_NAMEENTRY
  bne ui_tick_menu
  jmp text_tick
  .endif
ui_tick_menu:
  cmp #ST_MENU
  ...
```

**`text_tick`**:

```
text_tick_choicewait:
  cmp #BOX_CHOICEWAIT
  bne text_tick_nameentry
  jmp text_choice_move
text_tick_nameentry:
  .if NAME_ENTRY_ENABLED
  cmp #BOX_NAMEENTRY
  bne text_tick_wait
  jmp name_tick                 ; shim -- tail call either way, runs
                                 ; nameentry_tick (§5)
  .endif
text_tick_wait:
  rts
```

**Every one of these four hooks runs with rendering on, and the trampoline's own existing MMC3
critical section (`switch_prg_bank`'s own `.if PRG_SWITCH_MMC3` arm, `engine/banks.asm:184-231`)
already covers every one of them, with nothing new needed** — `text_tick`/`ui_tick` run from
`main_loop_ui`, `draw_ui` from `main_loop_draw`, and `do_action_confirm`/`do_action_cancel` from
`dispatch_loop`, all once per frame, all with the picture live, the identical situation `BE_TICK`
already runs `call_battle` inside every frame of a real fight. On MMC1 (or UNROM 512), no protection
is needed at all — `SPLIT_ENABLED` is false there.

**Y1 (round 9's own regression, X1's first fix corrected): `INPUT_STATES` stays append-only in the
schema, but the emitted table — and its capacity charge — must be conditional, not universal, or
naming-off byte identity breaks.** `INPUT_STATES` (`shared/project.js:448`) still gains a seventh
entry, appended per its own "Append only" rule — that half of X1's fix stands:

```js
export const INPUT_STATES = ['gameplay', 'menu', 'dialog', 'title', 'gameover', 'battle', 'nameentry'];
```

**Round 9's own mistake was treating `generate.js`'s existing `input_actions` emission
(`:2887-2896`, `INPUT_STATES.map(...)`, unconditional today) as something that could stay unconditional
once this array grew.** It cannot: `'battle'` and `'title'` are already unconditional precisely because
every project that exists today already pays for them — appending them cost nothing to any *existing*
ROM's own byte-identity, since no ROM predates their being in the array at all. `'nameentry'` is
different in exactly the way that matters: it is a genuinely new entry added *to an array projects
already depend on*, so an unconditional row would add 4 bytes to `input.inc` for every project ever
built from this point on, including every naming-off RPG and every action project — breaking the
phase-1/phase-2 byte-identity requirement §15/§17 both state, and falsifying §10's own "every ROM with
neither Save nor naming is fully byte-identical" claim the moment this array changed at all, regardless
of what any per-project predicate said. The fix is to make the *emission* conditional, keeping the
*schema* append-only:

```js
// main/build/generate.js:2887-2896, corrected
const nameEntryStates = projectUsesNameEntry(project) ? INPUT_STATES : INPUT_STATES.slice(0, -1);
const actionRows = nameEntryStates.map((state) => {
  const bindings = project.input.states[state] ?? {};
  return BUTTONS.map((button) => actionIndex(bindings[button]));
});
await fs.writeFile(
  path.join(assetsDir, 'input.inc'),
  [
    '; Generated -- one action per button, for each game state.',
    `; States: ${nameEntryStates.join(', ')}. Buttons: ${BUTTONS.join(', ')}.`,
    `input_actions:\n${actionRows.map((row) => `  .db ${row.map(hex).join(',')}`).join('\n')}`,
    ''
  ].join('\n')
);
```

`kernelTableBytes`'s own `fixedBytes` term (`generate.js:1837-1850`) mirrors the identical gate:

```js
// main/build/generate.js, corrected
export function kernelTableBytes(project) {
  const { flat } = flattenScreens(project);
  const boundTilesEnabled = projectUsesBoundTiles(project);
  const inputStateCount = projectUsesNameEntry(project) ? INPUT_STATES.length : INPUT_STATES.length - 1;
  const fixedBytes =
    32 +
    5 * LIMITS.metatiles +
    PLAYER_TILES +
    1 +
    inputStateCount * BUTTONS.length +      // 24 bytes off naming, 28 on
    (boundTilesEnabled ? 30 : 0);
  ...
}
```

**Why `projectUsesNameEntry(project)` — content-only, no `mapper` argument — is the correct gate, not
the full mapper-aware `NAME_ENTRY_ENABLED`.** `kernelTableBytes(project)` is called before `mapper` is
even resolved at one of its three call sites (`checkCapacity`, `generate.js:1892`, with
`resolveMapper` not running until `:1894`), and `switchableMappers`'s own use of this function
(`:1229`) already assumes `fixedBytes`/`tableBytes` are mapper-independent, comparing them across
candidate boards — widening the signature to take `mapper` would have to change that comparison's own
shape too. It is unnecessary: the actual safety requirement is only that the row exists whenever any
code could write `ST_NAMEENTRY` into `game_state`, and every such write is gated by `HERO_NAMING_ENABLED
= projectUsesHeroNaming(project)` (§9's own D8 fix, restated in §4 — **corrected this round, v14.1**:
this passage still carried v12's own `&& battleEnabledFor(project, mapper)`, stale since D8 dropped it
and left uncorrected through both v13 and v14, found only by this round's own grep for every
`HERO_NAMING_ENABLED` definition) — which implies `projectUsesHeroNaming(project)`, which itself
implies `projectUsesNameEntry(project)` by definition (§9), trivially and regardless of game type now
that neither predicate carries an RPG gate. So `projectUsesNameEntry(project)` is always true whenever
the code-side gate could possibly be true, making it a safe (if very occasionally generous) superset
gate that needs no mapper at all — the identical, content-only shape `kernelTableBytes`'s own existing
`boundTilesEnabled` term already uses for its own conditional 30 bytes, so this is not a new pattern for
this function, only a second instance of an existing one. **`projectUsesNameEntry` is no longer `false`
for every action project unconditionally — the second stale v12 claim this passage carried, corrected
alongside the first**: since D6, an action project with hero naming on has `projectUsesNameEntry(
project) === true` exactly like an RPG's own, which is precisely what makes the input row's own
conditional emission (this section) actually able to reserve `ST_NAMEENTRY`'s own row for such a
project in the first place — a claim that being false would have meant this whole Y1 mechanism silently
never fired for the one game type D8 added it to. `sample/`'s own
byte-identity is untouched by construction, not merely by coincidence.

**Why a short table is safe when naming is off**, stated explicitly per the brief's own steer:
`dispatch_input` indexes `input_actions` with `game_state * NUM_BUTTONS` (`engine/input.asm`), and the
*only* code anywhere that stores `ST_NAMEENTRY` (6) into `game_state` is `start_game`'s and `reset`'s
own `.if HERO_NAMING_ENABLED` arms (§8) — themselves unreachable whenever `projectUsesNameEntry` is
false, since `HERO_NAMING_ENABLED` implies it. A naming-off build's own `input_actions` table is
therefore only ever indexed at rows 0-5, exactly as many rows as it has — reading past a 24-byte table
at `game_state == 6` is a defect only if something could actually set `game_state` to 6, and nothing
can.

**`kernelShortfallAdvice`'s own removal candidates (§11) already pick this delta up automatically, with
no special-casing.** `projectWithoutHeroNaming`/`projectWithoutJoinNaming` (§9) each produce a project
whose `occupancy()` (`kernelCodeBytes + fixedBytes + tableBytes`) is recomputed from scratch, including
a fresh call to `kernelTableBytes` — so removing *both* naming features (the only way `projectUsesNameEntry`
can become false) correctly frees the input row's own 4 bytes as part of the same combination search
that already frees `NAME_ENTRY_KERNEL_ALLOWANCE` and its siblings, while removing only one leaves
`projectUsesNameEntry` true and the row correctly un-freed. This 4-byte term is never itself named as a
constant (`NAME_ENTRY_KERNEL_ALLOWANCE` and friends live in `kernelCodeBytes`, a different function from
`kernelTableBytes`) — it is simply what `kernelTableBytes` itself now computes, the same way an existing
project's own bound-tile removal already frees `kernelTableBytes`'s own 30-byte term with no bespoke
code in `kernelShortfallAdvice` either.

`bindableStates` (`renderer/forges/controller/controller.js:93-98`) is what keeps the *editable* row
hidden from a project that cannot reach `ST_NAMEENTRY` — see §9. That mechanism is unaffected by this
fix and remains correct as previously stated.

**X1's second fix: `checkCapacity`/`generateAssets`'s own shared boolean, made concrete — corrected
this round (D8) to drop the hero/overall flags' own `&& battleEnabled`, which v12 needed only because
naming was RPG-only.** `kernelCodeBytes` (`generate.js:1047-…`, `battleEnabled` itself declared at
`:1063`) gains three more `usesX` locals:

```js
// main/build/generate.js:1063 (existing) plus three new locals, same block
const battleEnabled = battleEnabledFor(project, mapper);
// v13 (D8): usesHeroNaming drops the "&& battleEnabled" v12 had here -- an
// action project's own battleEnabled is always false (no code region at all),
// so ANDing it in would make hero naming unreachable on exactly the game type
// D6 exists to add it to. usesJoinNaming keeps it: a Join can only ever be
// named through the banked party_join/battle_entry machinery (§7), so it is
// still correctly false whenever this project cannot host a code region at
// all, RPG or not. usesNameEntry is the plain OR of the two correctly-gated
// flags below it, not a third independent "&& battleEnabled" of its own.
const usesHeroNaming = projectUsesHeroNaming(project);                    // HERO_NAMING_ENABLED
const usesJoinNaming = projectUsesJoinNaming(project) && battleEnabled;   // JOIN_NAMING_ENABLED
const usesNameEntry = usesHeroNaming || usesJoinNaming;                   // NAME_ENTRY_ENABLED
const usesHeroNamingTitleless = usesHeroNaming && !usesTitle;             // && !TITLE_ENABLED
// NAME_ENTRY_BANKED (§5): the placement flag, a separate fact from any of
// the above -- true exactly when this project's own code region exists at
// all, independent of which naming features (if any) are live. Read by the
// shims (§5), not by any of the four allowance terms below, which stay keyed
// to *what* is on, never *where* its code physically lives.
const nameEntryBanked = battleEnabled;                                    // NAME_ENTRY_BANKED
// §8/§9a's own two new predicates, gating the remaining three terms in the
// return expression below: a compiled default-name table, and the token.
// needsHeroDefault reads shared/project.js's own projectNeedsHeroDefault
// (§8) rather than re-deriving the formula here -- v14's own two copies of
// this predicate (this one, and generateAssets's emission-site local, §8)
// disagreed by a full gameType check, an internal contradiction v14.1 found
// and fixed by making it a real single-writer function instead of a second
// inline formula (CLAUDE.md, "The single-writer rule").
const usesNameToken = projectUsesNameToken(project);                      // NAME_TOKEN_ENABLED
const needsHeroDefault = projectNeedsHeroDefault(project);
```

and seven more terms in the function's own return expression, beside `usesBoundTiles`'s — the last
three new this round (D7/D8, §8's own `needsHeroDefault`, §9a's own `NAME_TOKEN_ENABLED`, §11's own
action-placement term):

```js
    (usesNameEntry ? NAME_ENTRY_KERNEL_ALLOWANCE : 0) +
    (usesJoinNaming ? JOIN_NAMING_KERNEL_ALLOWANCE : 0) +
    (usesHeroNaming ? HERO_NAMING_KERNEL_ALLOWANCE : 0) +
    (usesHeroNamingTitleless ? HERO_NAMING_TITLELESS_KERNEL_ALLOWANCE : 0) +
    (usesHeroNaming && !nameEntryBanked ? NAME_ENTRY_ACTION_KERNEL_ALLOWANCE : 0) +
    (needsHeroDefault ? HERO_DEFAULT_KERNEL_ALLOWANCE : 0) +
    (usesNameToken ? NAME_TOKEN_KERNEL_ALLOWANCE : 0) +
    KERNEL_SLACK
```

`generateAssets`'s own `config.inc` emission gains all six flags this feature needs (all six read at
their real, current lines — `codeSlots`/`bankedCode` at `generate.js:2428-2429`, `BATTLE_ENABLED`/
`BATTLE_TILESET` at `:2676`/`:2680`), corrected for the identical D8 reason `kernelCodeBytes`'s own
locals were above — **this is the SAME bug X1's third fix below also found, in the sprite CHR stamp;
both are one instance of the same mistake, `&& codeSlots.length > 0` written where only
`usesJoinNaming` may have it.** **v14.1: this code block previously stopped at four flags, silently
missing `NAME_TOKEN_ENABLED` and `NAME_SEED_ENABLED` — both are real, both are read elsewhere in this
document as though `config.inc` already emitted them (§9a, §8), and neither had an actual emission
line anywhere until this round's own grep for `NAME_TOKEN_ENABLED` across every listing found the gap.
Added here, alongside the other four, not as a second emission site:**

```js
// main/build/generate.js, immediately after BATTLE_TILESET's own line (:2680)
const usesHeroNaming = projectUsesHeroNaming(project);
const usesJoinNaming = projectUsesJoinNaming(project) && codeSlots.length > 0;
const usesNameEntry = usesHeroNaming || usesJoinNaming;
const nameEntryBanked = codeSlots.length > 0;
const usesNameToken = projectUsesNameToken(project);
const usesNameSeed = projectNeedsNameSeed(project);  // shared/project.js (§11's own P2-2 fix) --
                                                       // not usesNameEntry || usesNameToken inline,
                                                       // the identical formula §11's battleRegionBytes
                                                       // now also reads from this one function
...
`NAME_ENTRY_ENABLED = ${usesNameEntry ? 1 : 0}`,
`JOIN_NAMING_ENABLED = ${usesJoinNaming ? 1 : 0}`,
`HERO_NAMING_ENABLED = ${usesHeroNaming ? 1 : 0}`,
`NAME_ENTRY_BANKED = ${nameEntryBanked ? 1 : 0}`,
`NAME_TOKEN_ENABLED = ${usesNameToken ? 1 : 0}`,
`NAME_SEED_ENABLED = ${usesNameSeed ? 1 : 0}`,
```

**X1's third fix, re-widened for D8: the sprite CHR stamp.** `spriteReservedRanges`
(`shared/project.js:2860-2869`) already reserves `SPRITE_ARROW_TILE` once `projectUsesNameEntry(
project)` is true — but v12's own proposed widening (`§5` below) still ANDed the whole disjunction with
`project.project?.gameType === 'rpg'`, which is wrong the moment naming can be true for an action
project: `(gameType === 'rpg') && (fontBankSplit(...) || projectUsesNameEntry(project))` would refuse
the reservation for exactly the case D8 exists to add. **The art stamp
(`generate.js:2343-2344`) has the mirror-image version of the identical mistake**, confirmed this round
to still read `if (fontSplit && codeRegionCount(project))` — a naming-only, non-split RPG board (MMC1,
UNROM 512) already reserves the tile via `spriteReservedRanges` and leaves it blank here (X1's own
original finding, still real), and now an action project with hero naming does too, for the added
reason that `codeRegionCount(project)` is unconditionally 0 there — no code region exists for an action
project at all, so the old `&&` could never pass regardless of the left side. Both fixes move the
naming disjunct **outside** the RPG/code-region-only condition, not merely alongside it:

```js
// shared/project.js:2860-2869, corrected (D8) -- the naming disjunct is no
// longer inside the "gameType === 'rpg'" AND at all
export function spriteReservedRanges(project, mapper) {
  const ranges = [{ start: 0, end: PLAYER_TILES, label: 'the player' }];
  if (projectUsesHeartArt(project)) {
    ranges.push({ start: HEART_FULL_TILE, end: LIMITS.tilesPerTable, label: 'the HUD hearts' });
  }
  if ((project.project?.gameType === 'rpg' && fontBankSplit(project, mapper)) || projectUsesNameEntry(project)) {
    ranges.push({ start: SPRITE_ARROW_TILE, end: SPRITE_ARROW_TILE + 1, label: 'the naming grid or battle cursor' });
  }
  return ranges;
}
```

```js
// main/build/generate.js:2343-2344, corrected (D8) -- the naming disjunct no
// longer needs codeRegionCount(project) at all, since an action project's own
// naming-grid cursor sprite needs the identical art with no code region in
// the picture
if ((fontSplit && codeRegionCount(project)) || projectUsesNameEntry(project)) {
  for (const tileset of tilesets) tileset.sprites[SPRITE_ARROW_TILE] = SPRITE_ARROW_ART;
}
```

`codeRegionCount(project)` is retained on the `fontSplit` side of the first stamp condition, unchanged
— a split-font battle cursor genuinely can only exist where a battle bank does, so that half of the
condition is correct as v12 already had it; only the naming half needed freeing from it, on both
functions.

`codeRegionCount(project)` is the same gate `spriteReservedRanges` already ANDs with `gameType ===
'rpg'` — both reduce to "is this an RPG at all," which is necessary but not sufficient on its own
(`battleEnabledFor`'s own mapper-capability check is what `NAME_ENTRY_ENABLED` itself further
requires, per §9), and is retained here unchanged rather than widened further, since the existing
`fontSplit` arm already relies on exactly this same weaker check today and no defect report exists
against it.

## §5. `engine/nameentry.asm` — one source file, two mutually exclusive placements, decided by
`NAME_ENTRY_BANKED`

**v13 rewrite (D8).** v12 had exactly one placement (banked, reached only through `call_battle`).
`engine/nameentry.asm`'s own body — every routine from `nameentry_begin` through
`draw_nameentry_cursor`, below — is now `.include`d from **either** `engine/battle.asm` (an RPG, banked,
v12's own placement, unchanged) **or** `engine/main.asm` directly (an action project, kernel-lo, new
this round), never both for the same project, decided by one generated flag,
`NAME_ENTRY_BANKED = battleBankEnabled(project, mapper)` (§4's own `nameEntryBanked` local; §9's own
`battleBankEnabled`). A project that is an RPG on an `rpgCapable` mapper always has `NAME_ENTRY_BANKED
= 1` — every such project already has a code region for unrelated reasons (its own battle system),
long before naming enters the picture — and an action project always has `NAME_ENTRY_BANKED = 0`, since
`codeRegions(...)` (`shared/cartridge.js`) never allocates one for `gameType !== 'rpg'` at all. D8's own
"one rule per game type, no hybrid" is therefore not a policy this design has to police at runtime — it
falls out of `battleBankEnabled`'s own existing, structural definition, the identical fact that already
decides whether a project's battle system is banked at all.

**Why a new file, not appended to `battle.asm`/`battleui.asm` directly:** the naming grid shares no
code and no data with the turn-based battle system beyond the bank and the `bt_tmp`/`ptr_lo`/`ptr_hi`
scratch both already have — true on either placement, since kernel-lo has the identical `bt_tmp`/
`ptr_lo`/`ptr_hi` mapped at the identical zero-page addresses regardless of which PRG bank is switched
in (`$C000-$FFFF` is permanently mapped; zero page is not banked at all). `engine/battle.asm` gains one
line, alongside its own existing `.include "battleui.asm"` (`engine/battle.asm:659`, unchanged from
v12) — this is the **banked** placement, reached only for an RPG:

```
  .if NAME_ENTRY_ENABLED
  .include "nameentry.asm"
  .endif
```

**`engine/main.asm` gains a second, mutually exclusive `.include` line, right after `ui.asm`
(`:57`)** — this codebase's own kernel-lo/UI-adjacent state machinery already lives there, and it is
what this feature's own kernel-lo shims (below) hook into — **this is the new, action-side placement,
reached only when a project has no code region for it to live in instead:**

```
  .include "ui.asm"
  .if NAME_ENTRY_ENABLED
  .if !NAME_ENTRY_BANKED
  .include "nameentry.asm"
  .endif
  .endif
  .include "combat.asm"
```

This departs from every other optional kernel-lo file's own convention on purpose — `combat.asm`,
`title.asm`, `rpg.asm` and `flash.asm` are each `.include`d **unconditionally**, with their own body
wrapped in `.if X_ENABLED` internally, so a disabled feature compiles to zero bytes without an `.if`
at the `.include` site itself (`engine/main.asm:58-61`, confirmed this round — no existing precedent
for a conditionally-`.include`d kernel-lo file exists anywhere in this file). `nameentry.asm` cannot
follow that convention: it is the **same source file** `battle.asm` may also pull in, and nesasm has no
way to `.include` the same file twice into two different regions of the same build and have it mean
two different things — exactly one of the two `.include` sites may ever fire for a given project, which
is precisely what `NAME_ENTRY_ENABLED && !NAME_ENTRY_BANKED` here and `NAME_ENTRY_ENABLED` alone at the
`battle.asm` site (implying `NAME_ENTRY_BANKED` whenever it is reached at all, since `battle.asm` itself
only assembles for a code-region-bearing project) between them guarantee. `engine/nameentry.asm`'s own
internal `.if NAME_ENTRY_ENABLED` wrapper (below) is therefore redundant at either site — both callers
already gate on it — and is kept anyway, unchanged from v12, as harmless defense in depth rather than
removed and re-verified line by line under time pressure.

**`BATTLE_REGION_SOURCES` (`main/build/battletables.js:633`) gains `'nameentry.asm'`, for the banked
placement only** — the banked region's own capacity ledger (§11) has nothing to do with a project whose
naming code never enters that region at all:

```js
export const BATTLE_REGION_SOURCES = ['battle.asm', 'battleui.asm', 'battleturn.asm', 'nameentry.asm'];
```

This needs no new test of its own: `test/unit/bankedbytes.test.js`'s own `'an override of the battle
sources withdraws the claim rather than guessing'` (`:1154-1213`) already reads `engine/battle.asm`'s
real source text from disk and walks every `.include "..."` line it finds via regex — a walk that is
entirely independent of the surrounding `.if` gate — and its own `for (const name of reachable)` loop
generically constructs a Code Forge override for every file the walk found and asserts
`battleCodeOverridden` catches it. Once `BATTLE_REGION_SOURCES` names `nameentry.asm` and the real
`.include` line exists, this existing test extends to cover it automatically.

**Five kernel-lo shims are what let the SAME hook call sites in §4 and §8 compile correctly on either
placement, without a game-type branch of their own.** `call_battle` itself is `.if BATTLE_ENABLED`-
wrapped (`engine/banks.asm:409-416`) — it does not exist at all in an action project's own kernel-lo, so
every v12 hook site that reached it directly (`do_action_confirm`'s `BE_NAME_SELECT`,
`do_action_cancel`'s `BE_NAME_CANCEL`, `draw_ui`'s `BE_NAME_DRAW`, `text_tick`'s `BE_NAME_TICK`, and
`start_game`'s/`reset`'s own `BE_NAME_BEGIN`, §8) would be an undefined-symbol assembler error on such
a build. Each shim is entered by `jsr`/`jmp` exactly the way the site it replaces already was — a
tail-called shim (`jmp name_x`) preserves whatever return address the shim's own caller pushed, whether
that caller reached the shim by `jsr` or itself by `jmp`, so `name_select` below is safe to call with
`jsr` from `do_action_confirm` even though its own body is nothing but two tail calls:

```
  .if NAME_ENTRY_ENABLED
name_begin:                 ; A = the party slot to name -- always 0, the
                             ; hero, from every hook site that reaches this
  .if NAME_ENTRY_BANKED
  sta bt_arg
  lda #BE_NAME_BEGIN
  jmp call_battle
  .endif
  .if !NAME_ENTRY_BANKED
  jmp nameentry_begin
  .endif
name_tick:
  .if NAME_ENTRY_BANKED
  lda #BE_NAME_TICK
  jmp call_battle
  .endif
  .if !NAME_ENTRY_BANKED
  jmp nameentry_tick
  .endif
name_draw:
  .if NAME_ENTRY_BANKED
  lda #BE_NAME_DRAW
  jmp call_battle
  .endif
  .if !NAME_ENTRY_BANKED
  jmp draw_nameentry_cursor
  .endif
name_select:
  .if NAME_ENTRY_BANKED
  lda #BE_NAME_SELECT
  jmp call_battle
  .endif
  .if !NAME_ENTRY_BANKED
  jmp nameentry_select
  .endif
name_cancel:
  .if NAME_ENTRY_BANKED
  lda #BE_NAME_CANCEL
  jmp call_battle
  .endif
  .if !NAME_ENTRY_BANKED
  jmp nameentry_cancel
  .endif
  .endif
```

Each shim compiles to either 5 bytes (`lda #BE_NAME_X` (2) + `jmp call_battle` (3), banked) or 3 bytes
(`jmp nameentry_x`, kernel-lo) — five shims, always resident in kernel-lo regardless of placement, since
they are the dispatch glue *deciding* the placement, not part of what moves. `script_op_join`'s own
`BE_NAME_BEGIN` call (§7) is **not** routed through `name_begin`: Join naming is RPG-only and always
banked (`JOIN_NAMING_ENABLED` already implies `NAME_ENTRY_BANKED`, since it additionally requires
`battleEnabled`, §4), so that one call site is left exactly as v12 specified, a direct `lda #BE_NAME_
BEGIN / jsr call_battle` with no indirection needed.

**Every routine in `engine/nameentry.asm` below references only kernel-lo code and kernel RAM, on
either placement — confirmed this round by listing every external symbol the file's own body uses,
not merely asserted, per the brief's own steer, and corrected once already (P1-3, round-1 finding —
`NAME_LEN` itself was missing from the very list this paragraph claims is exhaustive).** `bt_tmp` (zero
page, `$5C`), `ptr_lo`/`ptr_hi` (zero page, the shared indirect-addressing scratch every routine in
this codebase that walks a table already uses), `pc_name_ram` (kernel RAM, §2), `box_row` (kernel RAM),
`TILE_SPACE`/`NAME_GRID_*` (config.inc constants, generated, not banked data), `pad_new`/`BTN_LEFT`/
`BTN_RIGHT`/`BTN_UP`/`BTN_DOWN` (kernel RAM/constants), `BOX_TEXT_ROWS`/`BOX_COLS`/`BOX_TEXT_LO`/
`BOX_ADDR_HI` (kernel-lo constants), `vram_open`/`vram_push`/`vram_end` (kernel-lo routines,
`engine/text.asm`), `box_text_row_addr` (kernel-lo, `engine/text.asm`), `OAM`/`oam_idx`/
`SPRITE_ARROW_TILE` (kernel RAM/constants), `box_state` (kernel RAM), and **`NAME_LEN`** — which, at
HEAD, is *not* kernel-lo at all: its sole writer is `battleTables` (`main/build/battletables.js:291`,
`chunks.push(`NAME_LEN = ${NAME_LIMIT}`)`), whose whole output is omitted from an action project's own
build (`generate.js:2432`, `codeSlots.length ? battleTables(project) : '...not an RPG...'`), so `NAME_LEN`
is undefined on exactly the placement this section exists to add — an assembler error the moment
`nameentry.asm` (or, separately, §9a's own `text_type_step` arm) tried to reference it there, not a
silently-wrong read the way P1-2's `pc_name` mistake was. **Fixed by moving the equate, not duplicating
it**: `generateAssets`'s own `config` array (`generate.js:2583-…`, beside its own existing
`NUM_VARIABLES = ${RPG_LIMITS.variables}` at `:2599`, the identical "a project-independent
`RPG_LIMITS` figure, emitted unconditionally" shape) gains `` `NAME_LEN = ${RPG_LIMITS.nameLength}` ``,
and `battletables.js:291`'s own `chunks.push` line is deleted outright — nesasm would refuse a symbol
defined twice, so the single-writer move has to be a move, never an addition beside the original.
Every existing consumer inside the banked region — `name_offset_pc` (`engine/battle.asm`), `party_join`'s
own copy loop (§7/§8) — still resolves to the identical value, now read from `config.inc` (included
near the top of the assembled source, `engine/main.asm:32`) rather than `assets/battle.inc`; nesasm's
own single, whole-file symbol table makes no distinction between a kernel-lo-defined equate and a
banked-file-defined one once assembly begins; every other `config.inc` constant already crosses the
identical boundary the other way (`NUM_VARIABLES` is read from inside the banked region too), so this
is not a new kind of reference, only `NAME_LEN`'s own first time making it. Not one of the symbols in
this list — `NAME_LEN` now included — is a label defined inside `battle.asm`/`battleui.asm`/
`battleturn.asm` or any other banked-only file, so the identical source text still assembles to
identical bytes wherever it lands: nothing in it depends on *where* it is, only on facilities
permanently mapped either way. `test/unit/bankedbytes.test.js`'s existing `measureRegion` proves the
banked byte count directly (§11); a parallel measurement against a kernel-lo build proves the
action-side byte count is the *same* body, differently addressed — the same kind of proof
`test/unit/routes.test.js`'s own byte-identical-ROM comparison already gives for a different mechanism
(CLAUDE.md, "The kernel budget").

**`test/unit/rammap.test.js`'s own `pc_name_ram: 40` literal (§15, phase 1, already shipped) can now be
derived instead** — phase 1's own comment there explains precisely why it had to be a literal:
`NAME_LEN` lived only in `assets/battle.inc`, which this test's own `symbols` table (built from
`build/constants.asm` and `build/assets/config.inc` alone) never reads. Once `NAME_LEN` moves to
`config.inc` (this finding), that comment's own premise is gone, and `pc_name_ram`'s own
`KNOWN_MAX_SIZES` entry can become `(s) => s.MAX_PARTY * s.NAME_LEN` — matching this file's own existing
derived-entry convention (`switches: (symbols) => symbols.get('NUM_SWITCHES') / 8`) instead of the one
literal that had to be an exception. Named as a phase-2 follow-up (§15), not applied to the already-
shipped phase-1 file directly — this document edits nothing outside itself.

**MMC3 split coverage needs no change at all, on either placement — confirmed this round by reading
`split_select` to its own final, unconditional fallback arm, not merely its two named `.if` blocks.**
`split_select` (`engine/split.asm:73-96`) ends:

```
split_select:
  .if TITLE_ENABLED
  ...
  .endif
  .if BATTLE_ENABLED
  ...
  .endif
  lda #SPL_OFF
  ldx box_state               ; any box state but CLOSED is showing glyphs
  beq split_select_store
  lda #SPL_BOX
split_select_store:
  sta split_mode
  rts
```

This fallback (`:90-94`) sits **outside** both `.if` blocks — it runs on every board and every game
type, unconditionally — and treats **any** `box_state != BOX_CLOSED` as needing the font-bank program,
with no list of specific box states anywhere. `BOX_NAMEENTRY` and `BOX_NAMEDONE` (§4) are both non-zero,
non-`BOX_CLOSED` values, so this generic check already arms `SPL_BOX` for the naming grid, on an RPG
*and* an action project alike, whether the grid's own code lives banked or in kernel-lo — `split_select`
itself has nothing to do with where the naming *code* is, only what `box_state` currently reads, and
that byte is identical RAM on every board. §15's own framebuffer probe test still exists, not to prove
a code change here (there is none), but to prove this existing, general mechanism really does cover the
grid in practice, on real hardware timing, the same "prove the workload, then trust the deadline"
discipline CLAUDE.md's own NMI-timing tests already follow — a claim about behavior is not proven by
reading the source that produces it.

**Every routine below is reached either directly by `jmp`/`jsr` from another routine in this same
file, or from the five shims above, whichever placement compiled — never from `battle_entry`'s own
dispatch directly on an action project, since that dispatch table (below) is itself banked-only code
that never exists there at all.** Two new config.inc constants and four glyph-tile constants, generated
from `shared/font.js`'s own `charToTile`, emitted only when `NAME_ENTRY_ENABLED`:

```
NAME_GRID_UPPER_BASE = ${hex(charToTile('A'))}   ; $C1 today
NAME_GRID_LOWER_BASE = ${hex(charToTile('a'))}   ; $E1 today
NAME_GRID_D_TILE = ${hex(charToTile('D'))}
NAME_GRID_E_TILE = ${hex(charToTile('E'))}
NAME_GRID_L_TILE = ${hex(charToTile('L'))}
NAME_GRID_N_TILE = ${hex(charToTile('N'))}
NAME_GRID_TEXT_COL0 = ${(0x22 & 0x1f) * 8}       ; = 16 -- (BOX_TEXT_LO & $1F)*8
```

**The grid reuses the message box's own footprint exactly — tile rows 24-29.** The MMC3 scanline
split needs no change: nothing in `engine/nameentry.asm` ever writes `$8000`/`$8001` — every write in
this file is either a plain RAM store, or a `vram_open`/`vram_push`/`vram_end` call, and those three
routines only ever write `vram_buf` — NMI's own `vram_drain`, outside this file entirely, is what
later turns that queue into real `$2006`/`$2007` writes. `switch_prg_bank` — the only routine anywhere
in this feature that ever touches `$8000`/`$8001` — is called exclusively from `call_battle` itself,
once per entry, entirely outside this file.

```
  .if NAME_ENTRY_ENABLED
name_grid_control_col:
  .db 2, 22
name_grid_control_label:
  .db NAME_GRID_D_TILE, NAME_GRID_E_TILE, NAME_GRID_L_TILE
  .db NAME_GRID_E_TILE, NAME_GRID_N_TILE, NAME_GRID_D_TILE

; A = the party slot (0-3) this session names.
nameentry_begin:
  sta nm_target
  lda #0
  sta nm_row
  sta nm_col
  sta nm_acted
  jsr nameentry_seed_len
  rts

nameentry_seed_len:
  lda #LOW(pc_name_ram)
  sta ptr_lo
  lda #HIGH(pc_name_ram)
  sta ptr_hi
  lda nm_target
  jsr nameentry_stride
  ldy #NAME_LEN-1
nameentry_seed_scan:
  lda [ptr_lo],y
  cmp #TILE_SPACE
  bne nameentry_seed_found
  dey
  bpl nameentry_seed_scan
  lda #0
  sta nm_len
  rts
nameentry_seed_found:
  iny
  sty nm_len
  rts

; A DIFFERENT stride walk from name_offset_pc (engine/battle.asm:640-657) --
; used purely internally by this file's own routines. Caller loads ptr_lo/hi
; with a table base, A = index (0-3); adds index*NAME_LEN into the pointer
; and leaves Y at 0.
nameentry_stride:
  tax
  beq nameentry_stride_done
nameentry_stride_loop:
  clc
  lda ptr_lo
  adc #NAME_LEN
  sta ptr_lo
  bcc nameentry_stride_next
  inc ptr_hi
nameentry_stride_next:
  dex
  bne nameentry_stride_loop
nameentry_stride_done:
  ldy #0
  rts

nameentry_tick:
  lda box_row
  cmp #BOX_TEXT_ROWS
  bcs nameentry_tick_idle
  jmp nameentry_raise_step
nameentry_tick_idle:
  lda pad_new
  and #BTN_LEFT
  beq nameentry_tick_right
  jsr nameentry_move_left
  jmp nameentry_tick_done
nameentry_tick_right:
  lda pad_new
  and #BTN_RIGHT
  beq nameentry_tick_up
  jsr nameentry_move_right
  jmp nameentry_tick_done
nameentry_tick_up:
  lda pad_new
  and #BTN_UP
  beq nameentry_tick_down
  jsr nameentry_move_up
  jmp nameentry_tick_done
nameentry_tick_down:
  lda pad_new
  and #BTN_DOWN
  beq nameentry_tick_done
  jsr nameentry_move_down
nameentry_tick_done:
  rts

nameentry_raise_step:
  jsr box_text_row_addr
  lda box_row
  bne nameentry_raise_not0
  jsr nameentry_draw_preview
  jmp nameentry_raise_next
nameentry_raise_not0:
  cmp #1
  bne nameentry_raise_not1
  lda #NAME_GRID_UPPER_BASE
  jsr nameentry_draw_letters
  jmp nameentry_raise_next
nameentry_raise_not1:
  cmp #2
  bne nameentry_raise_ctrl
  lda #NAME_GRID_LOWER_BASE
  jsr nameentry_draw_letters
  jmp nameentry_raise_next
nameentry_raise_ctrl:
  jsr nameentry_draw_ctrl
nameentry_raise_next:
  jsr vram_end
  inc box_row
  rts

nameentry_draw_letters:
  sta bt_tmp
  lda #TILE_SPACE
  jsr vram_push
  ldx #0
nameentry_letters_loop:
  txa
  clc
  adc bt_tmp
  jsr vram_push
  inx
  cpx #26
  bne nameentry_letters_loop
  lda #TILE_SPACE
  jmp vram_push

nameentry_draw_preview:
  lda #TILE_SPACE
  jsr vram_push
  lda #LOW(pc_name_ram)
  sta ptr_lo
  lda #HIGH(pc_name_ram)
  sta ptr_hi
  lda nm_target
  jsr nameentry_stride
nameentry_preview_loop:
  lda [ptr_lo],y
  jsr vram_push
  iny
  cpy #NAME_LEN
  bne nameentry_preview_loop
  ldx #BOX_COLS-NAME_LEN-1
nameentry_preview_pad:
  lda #TILE_SPACE
  jsr vram_push
  dex
  bne nameentry_preview_pad
  rts

nameentry_draw_ctrl:
  ldx #0
  ldy #0
ndc_loop:
  cpx name_grid_control_col
  bne ndc_try_end
  jsr ndc_label
  jmp ndc_next
ndc_try_end:
  cpx name_grid_control_col+1
  bne ndc_blank
  jsr ndc_label
  jmp ndc_next
ndc_blank:
  lda #TILE_SPACE
  jsr vram_push
ndc_next:
  inx
  cpx #BOX_COLS
  bne ndc_loop
  rts
ndc_label:
  lda name_grid_control_label,y
  jsr vram_push
  iny
  lda name_grid_control_label,y
  jsr vram_push
  iny
  lda name_grid_control_label,y
  jsr vram_push
  iny
  inx
  inx
  rts

nameentry_queue_cell:
  tya
  clc
  adc #BOX_TEXT_LO+1
  tay
  lda #BOX_ADDR_HI
  jsr vram_open
  lda bt_tmp
  jsr vram_push
  jmp vram_end

; Reached from battle_entry's own BE_NAME_SELECT arm.
nameentry_select:
  lda nm_acted
  bne nameentry_select_done
  lda #1
  sta nm_acted
  lda nm_row
  cmp #2
  beq nameentry_select_ctrl
  lda nm_len
  cmp #NAME_LEN
  bcs nameentry_select_done
  jsr nameentry_current_tile
  sta bt_tmp
  jsr nameentry_write_cell
  jmp nameentry_select_done
nameentry_select_ctrl:
  lda nm_col
  bne nameentry_select_end
  jsr nameentry_delete
  jmp nameentry_select_done
nameentry_select_end:
  lda #BOX_NAMEDONE
  sta box_state
nameentry_select_done:
  rts

nameentry_cancel:
  lda nm_acted
  bne nameentry_cancel_done
  lda #1
  sta nm_acted
  jsr nameentry_delete
nameentry_cancel_done:
  rts

nameentry_current_tile:
  lda nm_row
  bne nameentry_ct_lower
  lda #NAME_GRID_UPPER_BASE
  jmp nameentry_ct_go
nameentry_ct_lower:
  lda #NAME_GRID_LOWER_BASE
nameentry_ct_go:
  clc
  adc nm_col
  rts

nameentry_write_cell:
  lda #LOW(pc_name_ram)
  sta ptr_lo
  lda #HIGH(pc_name_ram)
  sta ptr_hi
  lda nm_target
  jsr nameentry_stride
  ldy nm_len
  lda bt_tmp
  sta [ptr_lo],y
  jsr nameentry_queue_cell
  inc nm_len
  rts

nameentry_delete:
  lda nm_len
  beq nameentry_delete_done
  dec nm_len
  lda #LOW(pc_name_ram)
  sta ptr_lo
  lda #HIGH(pc_name_ram)
  sta ptr_hi
  lda nm_target
  jsr nameentry_stride
  ldy nm_len
  lda #TILE_SPACE
  sta [ptr_lo],y
  sta bt_tmp
  jsr nameentry_queue_cell
nameentry_delete_done:
  rts

nameentry_move_left:
  lda nm_row
  cmp #2
  beq nameentry_ml_ctrl
  lda nm_col
  bne nameentry_ml_dec
  lda #25
  sta nm_col
  rts
nameentry_ml_dec:
  dec nm_col
  rts
nameentry_ml_ctrl:
  lda nm_col
  eor #1
  sta nm_col
  rts

nameentry_move_right:
  lda nm_row
  cmp #2
  beq nameentry_mr_ctrl
  lda nm_col
  cmp #25
  bne nameentry_mr_inc
  lda #0
  sta nm_col
  rts
nameentry_mr_inc:
  inc nm_col
  rts
nameentry_mr_ctrl:
  jmp nameentry_ml_ctrl

nameentry_move_down:
  lda nm_row
  cmp #2
  beq nameentry_md_wrap
  inc nm_row
  lda nm_row
  cmp #2
  bne nameentry_md_done
  jsr nameentry_snap_ctrl
nameentry_md_done:
  rts
nameentry_md_wrap:
  lda #0
  sta nm_row
  sta nm_col
  rts

nameentry_move_up:
  lda nm_row
  bne nameentry_mu_dec
  lda #2
  sta nm_row
  jsr nameentry_snap_ctrl
  rts
nameentry_mu_dec:
  cmp #2
  bne nameentry_mu_plain
  lda nm_col
  bne nameentry_mu_end
  lda #0
  sta nm_col
  jmp nameentry_mu_row
nameentry_mu_end:
  lda #25
  sta nm_col
nameentry_mu_row:
  dec nm_row
  rts
nameentry_mu_plain:
  dec nm_row
  rts

nameentry_snap_ctrl:
  lda nm_col
  cmp #13
  bcc nameentry_snap_del
  lda #1
  sta nm_col
  rts
nameentry_snap_del:
  lda #0
  sta nm_col
  rts

draw_nameentry_cursor:
  ldy oam_idx
  beq draw_ne_cursor_done
  lda nm_row
  clc
  adc #26
  asl a
  asl a
  asl a
  sec
  sbc #1
  sta OAM,y
  iny
  lda #SPRITE_ARROW_TILE
  sta OAM,y
  iny
  lda #0
  sta OAM,y
  iny
  jsr nameentry_cursor_x
  sta OAM,y
  iny
  sty oam_idx
draw_ne_cursor_done:
  rts

nameentry_cursor_x:
  lda nm_row
  cmp #2
  bne nameentry_cx_letter
  ldx nm_col
  lda name_grid_control_col,x
  jmp nameentry_cx_go
nameentry_cx_letter:
  lda nm_col
  clc
  adc #1
nameentry_cx_go:
  asl a
  asl a
  asl a
  clc
  adc #NAME_GRID_TEXT_COL0
  rts
  .endif
```

**`battle_entry`'s own dispatch chain, extended with five new arms — banked-only, unchanged from v12,
reached only via the shims' own `NAME_ENTRY_BANKED` arm above, never directly and never on an action
project, where this whole file does not assemble at all.** HEAD's own final arm is
unconditional: `battle_entry_restore: jmp party_restore` (`engine/battle.asm:47`). The comparison that
must precede the new arms shares their own gate, and the plain, unconditional `jmp party_restore` sits
between the two `.if` blocks, common to both:

```
battle_entry:
  lda bt_call
  bne be_tick_chk
  jmp party_init
be_tick_chk:
  cmp #BE_TICK
  bne be_join_chk
  jmp battle_tick
be_join_chk:
  cmp #BE_JOIN
  bne be_restore_chk
  ldx bt_arg
  cpx #PARTY_SIZE
  bcs be_join_skip
  jmp party_join
be_join_skip:
  rts
be_restore_chk:
  .if NAME_ENTRY_ENABLED
  cmp #BE_RESTORE
  bne be_name_begin_chk
  .endif
  jmp party_restore
  .if NAME_ENTRY_ENABLED
be_name_begin_chk:
  cmp #BE_NAME_BEGIN
  bne be_name_tick_chk
  lda bt_arg
  jmp nameentry_begin
be_name_tick_chk:
  cmp #BE_NAME_TICK
  bne be_name_draw_chk
  jmp nameentry_tick
be_name_draw_chk:
  cmp #BE_NAME_DRAW
  bne be_name_select_chk
  jmp draw_nameentry_cursor
be_name_select_chk:
  cmp #BE_NAME_SELECT
  bne be_name_cancel_chk
  jmp nameentry_select
be_name_cancel_chk:
  cmp #BE_NAME_CANCEL
  bne be_entry_done
  jmp nameentry_cancel
be_entry_done:
  rts
  .endif
```

Naming off: `be_restore_chk: jmp party_restore` — three bytes, byte-for-byte identical to HEAD's own
`battle_entry_restore: jmp party_restore` today. Naming on: the comparison (4 bytes) plus the five new
arms (39 bytes) — 43 bytes total. `BE_NAME_BEGIN = 4`, `BE_NAME_TICK = 5`, `BE_NAME_DRAW = 6`,
`BE_NAME_SELECT = 7`, `BE_NAME_CANCEL = 8`, appended after `BE_INIT`/`BE_TICK`/`BE_JOIN`/`BE_RESTORE =
0..3`.

**Sprite reservation and `overlaySpriteBudget`.** `SPRITE_ARROW_TILE` widens from split-only to every
board once naming is on — **the naming disjunct moved outside the `gameType === 'rpg'` AND this round
(D8), the identical fix §4's own X1 third fix already gives in full; restated here only so this
section's own quoted body does not silently disagree with it**:

```js
export function spriteReservedRanges(project, mapper) {
  const ranges = [{ start: 0, end: PLAYER_TILES, label: 'the player' }];
  if (projectUsesHeartArt(project)) {
    ranges.push({ start: HEART_FULL_TILE, end: LIMITS.tilesPerTable, label: 'the HUD hearts' });
  }
  if ((project.project?.gameType === 'rpg' && fontBankSplit(project, mapper)) || projectUsesNameEntry(project)) {
    ranges.push({ start: SPRITE_ARROW_TILE, end: SPRITE_ARROW_TILE + 1, label: 'the naming grid or battle cursor' });
  }
  return ranges;
}

export function overlaySpriteBudget(project) {
  const hearts = projectUsesHeartArt(project) ? (project.project?.maxHearts ?? 3) : 0;
  const inventory = projectUsesItems(project)
    ? MAX_ITEMS * largestItemIconTiles(project)
    : MAX_ITEMS * largestActorRestingIconTiles(project);
  const portrait = largestActorRestingIconTiles(project);
  const nameEntryCursor = projectUsesNameEntry(project) ? 1 : 0;
  return hearts + Math.max(inventory, portrait, nameEntryCursor);
}
```

`overlaySpriteBudget` needed no D8 fix at all — its own `nameEntryCursor` term was already
`projectUsesNameEntry(project) ? 1 : 0` with no `gameType` gate, correct for both game types unchanged
since v12. The CHR-art stamp that fills the reserved tile with real pixels, widened to match this
reservation, is §4's own X1 third fix, above — the two must move together, and now do, on both game
types.

## §6. Cursor movement, typing, deleting — the grid's own rules, restored in full, including the ring's
real (and slightly asymmetric) shape

**Unchanged for v13 (D3, §1 item 7).** Every rule below is placement-independent and game-type-
independent by construction: `nm_row`/`nm_col`/`nm_len` and every routine that reads or writes them
(§5) are the identical source text on either placement, so the grid behaves identically for a hero
session on an action project, a hero session on an RPG, and a Join session (RPG-only). No sentence
below needed a word changed.

**Layout.** `nm_row` 0 is A-Z, `nm_row` 1 is a-z, each 26 columns wide (`nm_col` 0-25, left to right,
matching alphabetical order — `NAME_GRID_UPPER_BASE`/`NAME_GRID_LOWER_BASE` plus `nm_col` is the tile).
`nm_row` 2 is the controls row, exactly two columns: `nm_col` 0 is DEL, `nm_col` 1 is END. This is
distinct from `box_row`, which during the four-frame raise sequence (`nameentry_raise_step`) indexes
which of the four VISUAL rows is being drawn that frame — 0 is the name preview, 1 is A-Z, 2 is a-z, 3
is controls — and has no further meaning once the raise finishes; `nm_row`/`nm_col` only start moving
once `box_row` has reached `BOX_TEXT_ROWS` (the readiness gate, §4), and the preview row is drawn from
`pc_name_ram` directly, never revisited by the cursor.

**LEFT/RIGHT** wrap within the current row: 0↔25 on rows 0/1 (`nameentry_move_left`/`_move_right`'s own
boundary checks), and a plain two-way toggle on row 2 (`eor #1`, shared by both directions via
`nameentry_mr_ctrl: jmp nameentry_ml_ctrl` — LEFT and RIGHT are the identical operation on the controls
row, since there are only two cells to alternate between).

**DOWN cycles forward, in a clean, uniform ring**: row 0 → row 1 (column preserved, no snap — both
rows have the same 26 columns) → row 2 (column snapped by half: `nm_col < 13` lands on DEL,
otherwise END — `nameentry_snap_ctrl`) → row 0 (wraps, column reset to 0, unconditionally —
`nameentry_md_wrap`, which does not preserve whichever control was selected). Pressing DOWN
repeatedly from any starting cell visits every row in this same forward order and returns to row 0 in
at most three presses.

**UP is *not* simply DOWN run backward — a deliberate asymmetry, not an oversight.** From row 1, UP
goes to row 0 with the column preserved (`nameentry_mu_plain`), the exact mirror of DOWN's row 0→row 1
step — **so DOWN then UP from row 0 DOES return the cursor to exactly where it started**: DOWN carries
the column unchanged into row 1, and UP from row 1 carries that same column back into row 0. But from
row 0 directly, UP jumps **straight to row 2**, skipping row 1 entirely, snapped by the same
column-half rule DOWN uses (`nameentry_move_up`'s own `lda nm_row / bne .../ lda #2 / sta nm_row / jsr
nameentry_snap_ctrl` — reached only when `nm_row` was 0). And from row 2, UP goes to row 1 using a
**fixed representative column** keyed to which control was selected — DEL (`nm_col` 0) lands on column
0 (`'a'`), END (`nm_col` 1) lands on column 25 (`'z'`) — rather than any column-half memory
(`nameentry_mu_dec`'s own `nm_col`-based branch). The result: DOWN always visits row 0→1→2→0 in order,
but UP's own ring is row 0→2→1→0 — a *different* cycle, not simply the same one traversed the other
way, and the two rings only agree, and round-trip, on the row 0↔row 1 leg. **Pressing UP then DOWN from
row 0, by contrast, does NOT return the cursor to where it started** (unless it started at column 0):
UP from row 0 jumps to row 2, snapped to whichever control matches the column's own half, and DOWN
from row 2 always wraps to row 0 column 0 unconditionally (`nameentry_md_wrap`), discarding whichever
control was selected rather than reversing the half-snap that chose it — so a player who overshoots
upward from row 0 and corrects with DOWN lands on column 0, not back at their original column. This is
deliberate, not a bug: it is what lets a player reach DEL or END in exactly one press from either
letter row without ever having to pass through the other case's row first, at the cost of UP/DOWN not
being exact inverses of each other on that particular leg — a trade CLAUDE.md's own "6502 traps"
discipline says to document rather than leave implicit (§16 adds this as a named entry), and §14's own
`bootPastNaming`/`typeNameAndFinish` helpers navigate defensively (reading `nm_row` back after every
press, never assuming a fixed number of presses reaches a given cell) for exactly this reason.

**Typing** (A-Z/a-z, `nm_row` 0 or 1): the Confirm action while a letter is highlighted commits that
letter's tile at `pc_name_ram[nm_target * NAME_LEN + nm_len]`, then increments `nm_len` — always
appends at the end, never inserts, and is a no-op once `nm_len == NAME_LEN` (10) (`nameentry_select`'s
own `cmp #NAME_LEN / bcs nameentry_select_done` guard).

**DEL** is reachable two ways, both routed to the identical `nameentry_delete` routine, so behavior
cannot diverge between them: (a) selecting the DEL grid cell (`nm_row` 2, `nm_col` 0) via Confirm, and
(b) the existing Cancel action, wherever a project's own controller mapping binds it, while the grid is
up (`nameentry_cancel`, reached from `do_action_cancel`'s own naming arm in §4). Either path removes
the single most-recently-committed letter (`nm_len - 1`, if `nm_len > 0` — a no-op otherwise), writes a
space tile back into `pc_name_ram` at that position, and re-queues that one cell's own redraw via
`nameentry_queue_cell` — a single 4-byte packet (3-byte header, 1-byte body), never the whole row.

**No separate "cursor position within the name" marker exists in the preview row, by construction, not
omission**: because typing only ever appends and DEL only ever removes the last letter, `nm_len` tracks
the position on its own. `nameentry_seed_len`'s own scan (§5) is what makes this precise: it walks
`pc_name_ram[nm_target]`'s own ten bytes **backward from the last one**, looking for the first
non-space byte it finds, and sets `nm_len` to one past it — this trims only the **trailing run of
padding**, not "everything from the first space onward." A seeded default name is free to carry an
internal space (an author's own `pc_name` entry, e.g. "Sir Reginald," compiled from ROM, never typed by
the player, since the grid itself offers no space glyph) and that space survives the seed scan intact,
exactly where it was, because the backward scan never even looks at it once it has found a later
non-space byte to stop on. The preview row (drawn once during the raise, then re-queued a cell at a
time by `nameentry_write_cell`/`nameentry_delete`) is a live view of `pc_name_ram` itself, ten cells
wide, blank-padded on the right past `nm_len` — never a separately tracked display state that could
drift from what is actually stored, and never something a distinct blinking marker needs to duplicate.

**END** commits the session (`nameentry_select_end`) by setting `box_state = BOX_NAMEDONE` and
returning — it does **not** call `script_resume` itself: that call has to happen from kernel-lo, after
the trampoline has already restored the field's own screen bank (§4's own `do_action_confirm` hook,
§7/§8).

## §7. How a Join opts in — the packed operand, the args-array fix (X1), a working name-copy loop, and
the new `BE_NAME_BEGIN` call after recruitment

**Unchanged for v13 (D6, §1 item 10): Join naming stays RPG-only.** `join` is itself an `EVENT_COMMANDS`
entry with no action-project equivalent — an action project's compiler never emits `OP_JOIN` at all,
regardless of naming — so nothing below needed a word changed; `JOIN_NAMING_ENABLED` (§9) is the one
naming flag that keeps its own `&& battleBankEnabled(project, mapper)` term unconditionally (§4's own
D8 fix), and `party_join`'s copy loop below stays banked-only, reached only through
`battle_entry`/`call_battle` exactly as specified.

**The schema change X1 restores.** `EVENT_COMMANDS`'s `join` entry (`shared/project.js:773`) gains a
second arg, so `normalizeEventCommand`'s own per-arg loop (`:4135`, `for (const arg of command.args)`)
can actually reach a `'named'` case — without this, a `named` field on the raw authored command is
silently dropped by normalization no matter what case is added to the loop's own body, since the loop
never iterates an arg that is not listed here:

```js
// shared/project.js:773, corrected
{ id: 'join', label: 'Party member joins', args: ['member', 'named'] },
```

```js
// shared/project.js's normalizeEventCommand, new case beside 'member'
else if (arg === 'named') out.named = Boolean(raw?.named);
```

`renderer/forges/map/events.js`'s own `defaultCommand` (`:194-197`) needs the identical case, for the
same reason — it walks `entry.args` too, so a freshly placed Join needs `'named'` listed here as well
to seed `out.named = false` on arrival:

```js
// renderer/forges/map/events.js's defaultCommand, new case
else if (arg === 'named') out.named = false;
```

`encodeCommand`'s own `join` case (`main/build/textcompile.js:341-342`) packs both fields into the same
single operand byte, rather than adding a second byte — `named` rides bit 7 of the member index, which
fits because `RPG_LIMITS.party` (4) only ever needs bits 0-1:

```js
case 'join': {
  if (command.member === null) return [opIndex('join'), NO_MEMBER];
  const memberByte = byte(command.member, 3);          // 0-3
  return [opIndex('join'), command.named ? (memberByte | 0x80) : memberByte];
}
```

**Why the compiled width stays 2 even though `args` now has two entries — the exact mechanism, not
merely asserted.** `test/lib/eventdecoder.js`'s own generic fallback (`:132`, used for every opcode not
given an explicit `branch`/`choice`/`warp`/`say` case) is `EXCEPTIONAL_WIDTHS[entry.id] ?? 1 +
entry.args.length`. Before this change, `join`'s single-arg `args` already made the generic rule's own
prediction (`1 + 1 = 2`) match the real wire width by coincidence, needing no entry in
`EXCEPTIONAL_WIDTHS` at all. Widening `args` to two entries makes the SAME generic rule predict `1 + 2
= 3` — wrong, since both fields still pack into the one operand byte `encodeCommand`'s own case above
shows. `join` therefore joins `sting`/`sfx`/`battle` as a fourth, real entry in `EXCEPTIONAL_WIDTHS`,
overriding the now-wrong generic prediction back down to the real width:

```js
// test/lib/eventdecoder.js:33-37, corrected
const EXCEPTIONAL_WIDTHS = {
  sting: 3,
  sfx: 3,
  battle: 1 + RPG_LIMITS.monstersPerBattle,
  join: 2
};
```

`join` deliberately stays on the *generic* raw-bytes decode path (the module's own header,
`test/lib/eventdecoder.js:1-24`, reserves a bespoke resolved-shape case only for the two operand kinds
a structural map edit can relocate — a Warp's screen, a Say's string id) rather than gaining its own
explicit `if (entry.id === 'join')` branch the way `warp`/`say` have: a party member index is not a
relocatable reference the way a screen or a string id are, so per this module's own stated design, it
belongs on the raw-bytes path like every other non-relocating operand. A test that needs the member
index or the `named` bit reads `decoded.raw[0]`, masking `& 0x7f` for the member and `& 0x80` for
`named` itself, at the call site — the same thing a consumer of `sting`/`sfx`'s own raw two-byte
payload already has to do for their own packed fields.

Masking with `and #$7f`, never `and #$03`, preserves bits 2-6 so a stale operand like `$05` stays `$05`
and `battle_entry_join`'s own unmodified `cpx #PARTY_SIZE / bcs skip` refuses it. `script_op_join`
stays in kernel-lo — it runs every event tick regardless of whether that event is a Join, and moving it
into the bank would cost every non-Join command a trampoline round trip:

```
  .if JOIN_NAMING_ENABLED
script_op_join:
  jsr script_arg
  sta nm_named
  cmp #NO_MEMBER
  beq script_op_join_dangling
  and #$7F
  sta bt_arg
  cmp #PARTY_SIZE
  bcs script_op_join_unname
  tax
  lda pc_in_party,x
  bne script_op_join_unname
  lda nm_named
  and #$80
  beq script_op_join_unname
  lda #1
  sta nm_named
  jmp script_op_join_call
script_op_join_dangling:
  lda #NO_MEMBER
  sta bt_arg
script_op_join_unname:
  lda #0
  sta nm_named
script_op_join_call:
  lda #BE_JOIN
  jsr call_battle
  lda #2
  jsr script_skip
  lda nm_named
  beq script_op_join_plain
  lda #BE_NAME_BEGIN
  jsr call_battle                    ; bt_arg still holds the member index
  lda #BOX_NAMEENTRY
  jmp box_begin
script_op_join_plain:
  jmp script_run
  .endif
  .if !JOIN_NAMING_ENABLED
script_op_join:
  jsr script_arg
  sta bt_arg
  lda #BE_JOIN
  jsr call_battle
  jmp script_next2
  .endif
```

**A named Join's own naming session runs entirely inside `ST_DIALOG`, never `ST_NAMEENTRY` — worth
stating explicitly, since it is easy to assume otherwise.** `game_state` is set to `ST_DIALOG` once,
by `start_dialog` (`engine/ui.asm:227-233`), the moment the conversation that eventually reaches this
Join command begins, and nothing in `script_op_join_call`'s own code above ever touches `game_state`
again — the `jmp box_begin` at the end only ever sets `box_state` to `BOX_NAMEENTRY`. `ST_NAMEENTRY`
(§4) is reached **only** through `start_game`'s and `reset`'s own `HERO_NAMING_ENABLED` arms (§8), and
a Join happens strictly on the field, mid-conversation, never at either of those two points. This is
why `box_state === BOX_NAMEENTRY` — not `game_state` — is the one signal common to both a hero's own
naming session and a Join's own naming session, and why every readiness check in §4 and every test
helper in §14 keys off `box_state` alone (§9's own `bindableStates` comment already said as much: "
Join-only naming never enters `ST_NAMEENTRY`" — this is the reason why, spelled out).

**`party_join`'s own name-copy loop — already banked; its own gate widens this round (P1-2, §8) from
`NAME_ENTRY_ENABLED` to the new union flag `NAME_SEED_ENABLED`, since `party_init` (`:54`) already calls
this routine for every starting member, member 0 (the hero) included — the correct, working RPG half of
P1-2's own fix, not a new mechanism. Its own real, banked byte cost is charged under this wider gate in
§11's own `NAME_COPY_BATTLE_ALLOWANCE` term (P2-2, round-2 finding — split out from the grid's own term
there, since the two no longer share one gate):**

```
party_join:
  lda pc_in_party,x
  bne party_join_done
  lda #1
  sta pc_in_party,x
  inc party_size
  .if NAME_SEED_ENABLED
  lda #LOW(pc_name)
  sta ptr_lo
  lda #HIGH(pc_name)
  sta ptr_hi
  txa
  jsr name_offset_pc
  stx bt_tmp
  lda #0
name_copy_dst_loop:
  cpx #0
  beq name_copy_dst_ready
  clc
  adc #NAME_LEN
  dex
  jmp name_copy_dst_loop
name_copy_dst_ready:
  tax
  ldy #0
name_copy_loop:
  lda [ptr_lo],y
  sta pc_name_ram,x
  iny
  inx
  cpy #NAME_LEN
  bne name_copy_loop
  ldx bt_tmp
  .endif
  jsr party_apply_level
  lda pc_hp_max,x
  sta pc_hp,x
  lda pc_mp_max,x
  sta pc_mp,x
party_join_done:
  rts
```

## §8. How the hero opts in — three real arrivals, `game_state` before `redraw_screen`, and the
default-name mechanism an action project needs and an RPG already has (v13, new)

**Both game types, unchanged in shape from v12 except for the shim call (§5, D8) — `HERO_NAMING_ENABLED`
already dropped its own `&& battleEnabled` (§4), so these two hooks needed no `.if` of their own added
for the game-type split; only the call underneath changed, since `call_battle` does not exist on an
action build.** Re-verified against `boot.asm`/`title.asm`/`combat.asm` at HEAD this round, pinned:
`start_game` (`engine/title.asm:233-…`), `reset` (`engine/boot.asm:3-118`), `restart_game`
(`engine/title.asm:…-269`, unchanged, already funnels through `start_game`).

```
start_game:
  jsr init_session
  lda #NO_ENTITY
  sta talk_ent
  lda #START_SCREEN
  sta flat_screen
  lda #START_X
  sta player_x
  lda #START_Y
  sta player_y
  lda #DIR_DOWN
  sta player_dir
  lda #0
  sta box_state
  .if HERO_NAMING_ENABLED
  lda #ST_NAMEENTRY
  sta game_state
  jsr redraw_screen
  lda #0
  jsr name_begin                ; shim (§5) -- A = party slot 0, the hero
  lda #BOX_NAMEENTRY
  jmp box_begin
  .endif
  .if !HERO_NAMING_ENABLED
  lda #ST_GAMEPLAY
  sta game_state
  jmp redraw_screen
  .endif
```

**A titleless cold boot never reaches `start_game` at all**, so it needs its own fix in `reset`:

```
  .if TITLE_ENABLED
  lda #TITLE_FLAT_SCREEN
  sta flat_screen
  lda #ST_TITLE
  sta game_state
  .endif
  .if !TITLE_ENABLED
  .if HERO_NAMING_ENABLED
  lda #ST_NAMEENTRY
  sta game_state
  lda #0
  jsr name_begin                ; shim (§5) -- A = party slot 0, the hero
  lda #BOX_NAMEENTRY
  jsr box_begin
  .endif
  .endif
  jsr apply_map_music
  ldy flat_screen
  lda screen_tileset,y
  jsr switch_chr_bank
  jsr set_screen_ptr
  jsr spawn_entities
  jsr draw_screen
  jsr title_draw
  jsr build_oam
  jsr draw_entities
  jsr enable_rendering
```

**This covers all three real arrivals**: a titleless cold boot, the title's own Start press, and a
titleless restart after a game over (already funnels through `start_game`). **Continue is not one of
them.** The starting screen's own entry event is correctly deferred by the existing `settle_owed`
gate, with no new code. Closing the hero's own session reuses the identical `do_action_confirm` hook
the Join context uses — zero hero-specific closing code exists anywhere, and none is needed:
`do_action_confirm`'s own naming arm (§4) unconditionally ends with `jmp script_resume` once
`BOX_NAMEDONE` is seen, for both the hero's own boot-time session and a Join's own mid-conversation
one, and `script_resume` (`engine/script.asm:1082-1087`) is already safe for both — `lda script_active
/ beq script_resume_done / jmp script_run` falls to `script_resume_done: jmp box_close` whenever
`script_active` is 0, which it is for the hero's own naming (nothing suspended a script to end this
session; there is no event running at boot), and correctly resumes the real, suspended conversation
script whenever `script_active` is 1, which it is for a Join's own naming session. Neither case needed
a `box_after`-style discriminator of its own — `script_active` already is one.

### The default name (v13, new — D7's own reader needs a source; §8's own re-seed needs one too)

**The problem.** An RPG already has a default hero name: `pc_name`, the compiled ROM table
`party[0].name` produces, walked by `name_offset_pc` the identical way any other combatant's name is
(§3). An action project has no party at all (`project.party = []`, §1 item 3) and consequently no
`pc_name` table — nothing to seed `pc_name_ram` slot 0 from at boot, and nothing for the Say token
(§9a) to read when naming is off. Something has to fill both roles for an action project the way
`pc_name` already does for an RPG.

**The source: `project.project.heroName`, a new project-level string, default `"Hero"`, max 10
characters, A-Z/a-z only — normalized the way every other authored string is, with one added
restriction.** Placed beside `titleMap`/`maxHearts`/`saveCompatToken` in `createProject`'s own
`project:` block (`shared/project.js:3812-3834`, the exact precedent this field follows — a
project-level, both-game-types fact, not a per-actor one) and clamped in `normalizeProject`'s own
`project` object (`:5158-5195`, where `titleMap`/`saveCompatToken` already are):

```js
// shared/project.js, createProject's own project: block, beside titleMap
heroName: 'Hero',      // the compiled default; also this project's own
                        // nameHeroAtStart re-seed and the Say-token default
nameHeroAtStart: false,
```

```js
// shared/project.js, normalizeProject's own project object, beside titleMap/saveCompatToken
heroName: normalizeHeroName(raw.project?.heroName),
nameHeroAtStart: Boolean(raw.project?.nameHeroAtStart),
```

```js
// shared/project.js, a new normalizer beside normalizeLabel
function normalizeHeroName(value) {
  const filtered = typeof value === 'string' ? value.replace(/[^A-Za-z]/g, '').slice(0, RPG_LIMITS.nameLength) : '';
  return filtered || 'Hero';
}
```

**Why A-Z/a-z only, not `normalizeLabel`'s own free-text 40-character shape (party member names, item
names and every other authored label in this codebase already use).** `heroName` is not only a label —
it is the exact byte content `init_session`'s own re-seed writes into `pc_name_ram` slot 0 (below), the
same RAM the grid itself then lets the player edit, glyph by glyph, from a 52-letter alphabet with no
digits, punctuation or space (§1 item 2). A `heroName` outside that alphabet would seed a preview row
the grid's own controls could never have produced by typing — a real, visible inconsistency the moment
a player opened the grid on a default the compiler accepted but the grid cannot itself express — so
this is the one authored string in this codebase restricted to precisely what the runtime mechanism it
feeds can also produce.

**`hero_name_default`: a new 10-byte compiled table, emitted only for a project that needs it —
`needsHeroDefault` corrected this round (P1-2, round-1 finding): an RPG never needs it at all, since
its own seed comes from `pc_name` through the banked path below, never from this table.** Generated the
same way `pc_name` already is (`main/build/battletables.js`'s own `nameTiles`, §0), padded to
`RPG_LIMITS.nameLength` with `TILE_SPACE` exactly like every `pc_name` entry, but from `shared/font.js`'s
own `charToTile` directly rather than through `battleTables`' own per-member walk, since there is no
party to walk.

**v14.1: `needsHeroDefault` is now a real single-writer function, `shared/project.js`'s own
`projectNeedsHeroDefault(project)`, not a formula written out twice.** v14 defined it inline at two
call sites — this one, and `kernelCodeBytes`'s own local (§4) — and the two disagreed: this site
already had the `gameType !== 'rpg'` exclusion (P1-2's own fix), but `kernelCodeBytes`'s own copy still
read `usesHeroNaming || (usesNameToken && gameType !== 'rpg')`, which charges an RPG with hero naming
the 10-byte `HERO_DEFAULT_KERNEL_ALLOWANCE` term for a table `generateAssets` would never actually emit
for that same project — a real, ten-byte disagreement between the generator and its own capacity ledger
that `kernelbytes.test.js`'s own equality assert would have failed on the first RPG-with-hero-naming
build in phase 2, per CLAUDE.md's own single-writer rule ("Anything the 6502 engine and the JavaScript
tooling both depend on has **one** definition"). Fixed by moving the formula to `shared/project.js`,
beside `projectUsesNameToken` (§9a) — the identical pattern `battleBankEnabled`'s own move already set
(§9: "so both `main/build/generate.js` and `main/build/battletables.js` can share one real
implementation instead of... two closures that could drift"):

```js
// shared/project.js, beside projectUsesNameToken
export function projectNeedsHeroDefault(project) {
  return project?.project?.gameType !== 'rpg' && (projectUsesHeroNaming(project) || projectUsesNameToken(project));
}
```

```js
// main/build/generate.js -- emitted only when needsHeroDefault, below
const needsHeroDefault = projectNeedsHeroDefault(project);
if (needsHeroDefault) {
  const padded = project.project.heroName.padEnd(RPG_LIMITS.nameLength, ' ').slice(0, RPG_LIMITS.nameLength);
  lines.push(`hero_name_default:\n  .db ${[...padded].map((ch) => hex(charToTile(ch))).join(',')}`);
}
```

Both call sites — this one and `kernelCodeBytes`'s own local (§4) — now read the identical `const
needsHeroDefault = projectNeedsHeroDefault(project);`, so there is exactly one place this predicate's
own formula can be wrong, not two that can silently drift apart again. Grepped for a third copy this
round: none found — every other reference to `needsHeroDefault` anywhere in this document is a
paraphrase or a citation of one of these same two call sites, never a third independent formula.

An action project with **neither** the token nor hero naming needs no table at all, and gets none, the
same "pay only for what you use" discipline every other conditional table in this codebase already
holds to (`validateProject`'s own refusal below is what catches the one case left over — a token with
nothing to read at all).

**Placement: kernel-lo, not the `$E000` text/music bank.** Ten bytes is a real but small kernel-lo
table cost (§11's own `HERO_DEFAULT_KERNEL_ALLOWANCE`, now 21 bytes — the table plus the copy loop that
reads it, P2-3 below), chosen over `$E000` because the one reader that needs it — `init_session`'s own
action-side re-seed, below — is kernel-lo code already, and `$E000` has no generated-table ledger term
at all today (music, sound effects and dialogue share that half of the fixed kernel by their own
combined byte budget, `checkCapacity`'s own "the songs and sound effects compile to..." check, not a
per-table allowance the way kernel-lo's tables are) — adding one there for a single ten-byte table
would be new ledger machinery this feature does not need when kernel-lo already has the identical
mechanism ready.

**P1-2 (round-1 finding): `init_session`'s own re-seed cannot read `pc_name` from kernel-lo at all —
`pc_name` is banked data, mapped only inside the switchable window `call_battle` itself controls, and
`init_session` runs with whatever screen bank the field last left mapped, not the battle bank.** v13's
own RPG arm (`.if BATTLE_ENABLED / lda #LOW(pc_name) / ...`) read whatever happened to be at that
address in the *currently switched-in screen bank* — silently wrong data, not a build error, since
`pc_name` the symbol still resolves (it is a real label, just not the one mapped at that moment).
`pc_name`'s own two existing readers, `draw_panel` (`engine/battle.asm:601`) and `push_combatant_name`
(`engine/battleui.asm:622`), only ever run *inside* the banked region they are compiled into, reached
through `call_battle`'s own trampoline — which is exactly why they have never needed this caveat before
now. **The fix removes the RPG arm from `init_session` entirely, rather than trying to bank-switch
around it**: an RPG's own seed already has a real, working path — `init_session`'s own pre-existing
`jmp call_battle` (`BE_INIT`) is what enters the banked region in the first place, and
`battle_entry`'s own `BE_INIT` arm already runs `party_init` (`engine/battle.asm:54`), which already
calls `party_join` (`:76`) for every member whose `pc_starts` flag is set — member 0, the hero,
included, on every RPG project, confirmed this round by reading `party_init`'s own loop rather than
assumed: `lda pc_starts,x / beq party_init_next / jsr party_join` runs unconditionally for a starting
member, not only from a scripted field Join. §7's own `party_join` copy loop (already banked, already
copying a member's `pc_name` row into `pc_name_ram` at the identical stride index) is therefore already
the correct, working RPG seed path — it needed only its own gate widened, not a second, broken kernel-lo
attempt beside it.

**A new generated flag, the union `NAME_SEED_ENABLED = NAME_ENTRY_ENABLED || NAME_TOKEN_ENABLED`,
emitted in `config.inc` beside `NAME_ENTRY_ENABLED`/`JOIN_NAMING_ENABLED`/`HERO_NAMING_ENABLED`/
`NAME_ENTRY_BANKED`/`NAME_TOKEN_ENABLED` (§9) — corrected this round (v14.1, an internal contradiction
the orchestrator found): `NAME_ENTRY_ENABLED` is itself `HERO_NAMING_ENABLED || JOIN_NAMING_ENABLED`
(§9), so the real formula is three disjuncts, hero OR join OR token, not two.** v14's own text here
both stated the formula as `HERO_NAMING_ENABLED || NAME_TOKEN_ENABLED` and then claimed, in the very
next sentence, that this was "deliberately not `NAME_ENTRY_ENABLED`" — a self-contradiction (the stated
formula could not even be compared against `NAME_ENTRY_ENABLED` correctly, since `NAME_ENTRY_ENABLED`
was never one of its own two disjuncts to begin with), and a real defect besides: with `JOIN_NAMING_
ENABLED` left out, a project with a named Join and neither hero naming nor a token would compile
`party_join`'s own copy loop as dead code, so a recruit's `pc_name_ram` slot would never be seeded and
the Join's own naming grid would open reading whatever garbage was already in RAM. Each of the three
disjuncts needs the seed for its own reason: **hero naming** — `nameentry_begin`'s own preview-row seed
scan (`nameentry_seed_len`, §5) needs a real, trimmable name already in `pc_name_ram` slot 0 the instant
the hero's own session opens; **Join naming** — the identical routine seeds whichever slot a *recruit*
is about to be named in, and that slot is only ever populated by this same `party_join` copy loop, never
by the hero-only path; **the token** — reads `pc_name_ram` slot 0 unconditionally, on every game type,
the moment any live `Say` containing it runs, regardless of whether any naming session has ever opened
at all (§3's own P1-2 correction). `party_join`'s own copy loop (§7) widens from `NAME_ENTRY_ENABLED` to
this three-disjunct union flag:

```
party_join:
  ...
  .if NAME_SEED_ENABLED
  lda #LOW(pc_name)
  ... (unchanged -- the existing name_offset_pc stride and copy loop)
  .endif
  ...
```

**`init_session`'s own action-side arm — the only arm left in `init_session` itself, RPG handled
entirely by the banked path above, §8's own kernel-lo RPG arm deleted outright:**

```
  .if NAME_SEED_ENABLED
  .if !BATTLE_ENABLED
  ldy #NAME_LEN-1
init_session_name_loop:
  lda hero_name_default,y
  sta pc_name_ram,y
  dey
  bpl init_session_name_loop
  .endif
  .endif
```

No `ptr_lo`/`ptr_hi` indirection at all — `hero_name_default` is a single, fixed, absolute label with
no per-project stride to compute (unlike `pc_name`, which `party_join` must index by member), so direct
`lda hero_name_default,y` addressing is both simpler and, per P1-1's own finding two paragraphs below,
avoids that whole class of bug outright: nothing here is a pointer that could be clobbered between
frames, because the entire copy happens synchronously inside one `jsr init_session` call, never spread
across frames the way the Say token's own typewriter is.

**P2-3 (round-2 finding): this loop is real kernel-lo code, and until this round it had no allowance of
its own at all.** `ldy #NAME_LEN-1` (2 bytes) + `lda hero_name_default,y` (3, absolute,Y) + `sta
pc_name_ram,y` (3, absolute,Y) + `dey` (1) + `bpl init_session_name_loop` (2) = **11 bytes**, static
count per instruction width, the same discipline every other allowance in this ledger starts from
before phase 2 measures it against real nesasm output. Neither `HERO_DEFAULT_KERNEL_ALLOWANCE` (the
10-byte table alone) nor `NAME_TOKEN_KERNEL_ALLOWANCE` (`text.asm`'s own token-typing code, an entirely
different routine) covers it — it was simply uncharged. **Folded into `HERO_DEFAULT_KERNEL_ALLOWANCE`
itself, table plus loop, 10 + 11 = 21 bytes, rather than given a separate term**, because on the one
game type this loop ever compiles for (action; the arm is `.if !BATTLE_ENABLED`), its own gate
(`NAME_SEED_ENABLED && !BATTLE_ENABLED`) reduces to exactly `projectNeedsHeroDefault(project)`: with
`JOIN_NAMING_ENABLED` always false on an action project (it requires `battleBankEnabled`, always false
there), `NAME_ENTRY_ENABLED` reduces to `HERO_NAMING_ENABLED` alone, so `NAME_SEED_ENABLED` reduces to
`usesHeroNaming || usesNameToken` — the identical two disjuncts `projectNeedsHeroDefault` already ANDs
with `gameType !== 'rpg'`, which is exactly what `!BATTLE_ENABLED` already means for a real project
(§5's own D8 discussion). Table and loop share one gate on the only game type either exists on, so one
term, not two, is the accurate ledger shape — a second term would only ever be 0 or the first term's
own gate value, never independently informative.

Placed in `init_session` (`engine/combat.asm:58-147`) after the existing switch/variable/bag reset and
before the routine's own trailing `rts` (the same `rts` action projects already fall through to, since
`.if BATTLE_ENABLED` closes just above it) — `init_session` is the single definition of "new game"
(CLAUDE.md, "The event system"), run by both boot paths and every game over, so this re-seed runs
exactly once per session start, always before the hero's own naming session (if any) can begin, which
is what makes it safe for `nameentry_begin`'s own preview-row seed scan (§5's own `nameentry_seed_len`)
to find a real, trimmable name already sitting in `pc_name_ram` the instant the grid opens rather than
reading whatever the previous session left behind.

**Confirmed this round: which PRG bank is mapped at each of `init_session`'s four callers does not
matter to this action-side arm at all**, since `hero_name_default` lives in kernel-lo (`$C000-$FFFF`),
permanently mapped regardless of what the switchable window ($8000-$BFFF) currently holds — `reset`
(`engine/boot.asm:49`, cold boot, before any screen has been drawn at all), `start_game`
(`engine/title.asm:234`, from the title or a titleless cold boot), `restart_game` (`engine/title.asm:256`,
a game over), and `continue_game` (`engine/save.asm:541`, whatever screen bank a Continue's own
`load_apply_body` call happens to leave switched in) — a kernel-lo copy needs none of that context, and
none of these four callers needs to change to accommodate it.

**The Sprite Forge's own Player tab (§13) is where `heroName`/`nameHeroAtStart` are edited — a new
tab, not the existing, RPG-only `party` one v12 used, and (P2-7, §13) only `nameHeroAtStart`'s own
checkbox is universal; the `heroName` field itself is shown only for an action project, since it is the
one game type whose build ever reads it** — see §13 for why v12's own location does not exist on an
action project at all, and the new tab this round adds instead.

**`validateProject` gains one new refusal**, alongside its existing Save-needs-a-title check
(`:6098-6115`): a live Say token (§9a, `projectUsesNameToken`) in a project where neither
`projectUsesHeroNaming(project)` nor a compiled default exists to back it is refused, naming the Map
Forge — this can only happen for an action project with the token authored but `heroName` never having
had a chance to compile a table for (impossible in practice once `needsHeroDefault`'s own `usesNameToken`
disjunct above is correctly wired, since the token itself is what makes `needsHeroDefault` true — this
check is defense in depth for a hand-edited or future-version project whose generator disagrees with
this one, the same role every other capacity-adjacent `validateProject` check already plays).

## §9. Game types — three admission points, hero default input, and the normalizer/UI wiring

**v13 (D6/D8): `projectUsesHeroNaming` drops its own `gameType === 'rpg'` gate entirely — hero naming
is the one naming feature that now applies to any game type — and its field moves from
`project.rpg.nameHeroAtStart` to `project.project.nameHeroAtStart` (below). `projectUsesJoinNaming`
and `projectUsesNameEntry` are unchanged in shape; `projectUsesNameEntry`'s own `||` already meant
"either," which is still exactly right now that the left side can be true on either game type.**

```js
export function projectUsesHeroNaming(project) {
  return Boolean(project?.project?.nameHeroAtStart);
}
export function projectUsesJoinNaming(project) {
  if (project?.project?.gameType !== 'rpg') return false;
  for (const event of projectEvents(project)) {
    for (const page of compiledPages(event)) {
      for (const command of liveCommands(page.commands, CHOICE_LIMITS.options)) {
        if (command.op === 'join' && command.named) return true;
      }
    }
  }
  return false;
}
export function projectUsesNameEntry(project) {
  return projectUsesHeroNaming(project) || projectUsesJoinNaming(project);
}
```

**The battle-bank admission predicate moves to `shared/`, so both `main/build/generate.js` and
`main/build/battletables.js` can share one real implementation instead of `battletables.js` importing
Node-dependent `generate.js`, which its own header forbids.**

```js
// shared/project.js, beside projectUsesNameEntry
export function battleBankEnabled(project, mapper) {
  const bankedCode = project.project?.gameType === 'rpg' ? 1 : 0;
  return codeRegions(mapper, project.tilesets.length, bankedCode).length > 0;
}
```

`main/build/generate.js`'s own `battleEnabledFor` becomes a one-line wrapper: `export function
battleEnabledFor(project, mapper) { return battleBankEnabled(project, mapper); }`.

**The two shared strip helpers X1/X2 both rely on**, defined once beside `projectUsesHeroNaming`/
`projectUsesJoinNaming` so `kernelShortfallAdvice` (generate.js, Node-side) and `battleShortfallAdvice`
(battletables.js, shared-only) consume the identical implementation rather than two closures that could
drift — mirroring `projectWithoutCommands`'s own `event.pages ?? []` / `allCommands` shape
(`generate.js:1140-1150`) exactly, so a naming candidate is switched off everywhere a Move or Save
command already is (branch and choice contents included), not merely among live occurrences:

```js
// shared/project.js, beside battleBankEnabled -- v13: clone.project, not
// clone.rpg, since the field moved (below) and now applies to any game type
export function projectWithoutHeroNaming(project) {
  const clone = structuredClone(project);
  clone.project.nameHeroAtStart = false;
  return clone;
}
export function projectWithoutJoinNaming(project) {
  const clone = structuredClone(project);
  for (const event of projectEvents(clone)) {
    for (const page of event.pages ?? []) {
      for (const command of allCommands(page.commands)) {
        if (command.op === 'join') command.named = false;
      }
    }
  }
  return clone;
}
```

**`normalizeRpg` (`shared/project.js:4864`, its one real caller at `:5257`) no longer carries this
field at all — the project-block normalizer does (§8's own code, `normalizeProject`'s `project` object,
`:5158-5195`), because hero naming is no longer an RPG-only fact and `project.rpg` is meant to hold
RPG-only ones.** (Checked precisely rather than assumed this round: `normalizeRpg` is in fact called
**unconditionally**, `:5257`, for every project regardless of `gameType` — `project.rpg` technically
exists on an action project too, its fields simply inert there, contrary to what an earlier pass of
this document's own reasoning for the move assumed. That does not change the conclusion: `project.rpg`
is still the *RPG settings* object by every existing convention in this codebase — `xpBase`/`xpGrow`/
`maxLevel`/`battleTilesetId`/`encounterMusic`, every field it already holds, means nothing outside an
RPG — and a field meaningful on *both* game types belongs beside `titleMap`/`gameType`/
`saveCompatToken` in `project.project` on that basis alone, not because `project.rpg` is technically
unreachable for an action project, which it is not.) `normalizeRpg`'s own signature and body are
otherwise completely unchanged from HEAD — no `gameType` parameter needed, since it never gated on it
for this field to begin with once the field is gone entirely:

```js
function normalizeRpg(raw, tilesetCount) {
  const base = defaultRpg();
  return {
    xpBase: clamp(raw?.xpBase, 1, 255, base.xpBase),
    xpGrow: clamp(raw?.xpGrow, 0, 255, base.xpGrow),
    maxLevel: clamp(raw?.maxLevel, 1, RPG_LIMITS.maxLevel, base.maxLevel),
    battleTilesetId: clamp(raw?.battleTilesetId, 0, Math.max(0, tilesetCount - 1), 0),
    encounterMusic: raw?.encounterMusic ?? null
  };
}
```

`defaultRpg()` gains nothing — `nameHeroAtStart`/`heroName` are `createProject`'s own `project:` block
fields now (§8), never `defaultRpg()`'s. **Nothing shipped with v12's own `project.rpg.nameHeroAtStart`
location** — no phase past 1 (the save migration) has landed in the working tree, confirmed this round
by grepping the tree for `nameHeroAtStart` and finding no match anywhere outside this document — so this
is a location change to an unbuilt field, not a migration, and needs none.

**`defaultInput()` gains its own `nameentry` row:**

```js
export function defaultInput() {
  return {
    states: {
      gameplay: { A: 'attack', B: 'interact', SELECT: 'item', START: 'pause' },
      menu: { A: 'confirm', B: 'cancel', SELECT: 'none', START: 'pause' },
      dialog: { A: 'confirm', B: 'confirm', SELECT: 'none', START: 'none' },
      title: { A: 'confirm', B: 'none', SELECT: 'continue', START: 'confirm' },
      gameover: { A: 'confirm', B: 'none', SELECT: 'none', START: 'confirm' },
      battle: { A: 'confirm', B: 'cancel', SELECT: 'none', START: 'none' },
      nameentry: { A: 'confirm', B: 'cancel', SELECT: 'none', START: 'none' }
    }
  };
}
```

`normalizeInput` needs no code change once this key exists.

**The Controller Forge.** `STATE_LABELS` gains `nameentry`, gated on hero-naming's own reachability
specifically — Join-only naming never enters `ST_NAMEENTRY`. **Needs no code change at all for D6/D8**:
`projectUsesHeroNaming` itself dropped its own `gameType === 'rpg'` gate (above), so this existing
filter — unchanged, byte for byte, from v12 — already reads correctly on an action project the moment
that predicate does, which is exactly the point of pushing the game-type decision down into the
predicate rather than repeating it at every call site:

```js
export const bindableStates = (project) =>
  INPUT_STATES.filter(
    (state) =>
      state in STATE_LABELS &&
      (state !== 'title' || projectUsesEffectiveTitle(project)) &&
      (state !== 'nameentry' || projectUsesHeroNaming(project))
  );
```

**The three generated flags, corrected for D8 (§4's own fix, restated here where they are declared as
a group) — `NAME_ENTRY_BANKED` added as a fourth, the placement flag none of the other three are:**

- `HERO_NAMING_ENABLED = projectUsesHeroNaming(project)` — no `battleEnabledFor` at all; true on either
  game type the moment the project authors it.
- `JOIN_NAMING_ENABLED = projectUsesJoinNaming(project) && battleEnabledFor(project, mapper)` —
  unchanged from v12; Join naming still needs a real code region to run in.
- `NAME_ENTRY_ENABLED = HERO_NAMING_ENABLED || JOIN_NAMING_ENABLED` — the plain OR of the two correctly-
  gated flags above, not an independent `battleEnabledFor` AND of its own.
- `NAME_ENTRY_BANKED = battleEnabledFor(project, mapper)` — which placement compiles (§5); read only
  inside `.if NAME_ENTRY_ENABLED` contexts, so its value is meaningless (and never read) when naming is
  off entirely.

## §9a. The Say token (D7, new) — syntax, the brace collision, the compiler, `wrapText`, the preview,
`validateProject`, and its own kernel-lo cost

**Syntax: the exact sequence `{name}`, recognised only as that literal run of six characters — a lone
`{`, `|`, `}` or `~` elsewhere in the same string still renders as window furniture, exactly as
today.** `shared/font.js`'s own `BORDER_H`/`BORDER_V`/`BORDER_CORNER`/`BORDER_FILL` (`:197-200`) are
`charToTile('{')`/`charToTile('|')`/`charToTile('}')`/`charToTile('~')` — four ASCII punctuation
characters an author could otherwise type into a `Say` and get a real glyph for (the message-box frame
art itself is authored this way, per `shared/font.js`'s own doc comment: "Named window furniture, so
nothing hardcodes the characters that carry it"). Two designs were open: recognise the six-character
sequence exactly, leaving a lone brace as furniture the way it already is; or reserve `{`/`}` entirely,
refusing them outside a token. **Recommendation: the exact-sequence rule, kept in §19 as the
question anyway per the brief's own steer** — reserving the braces outright would silently break any
project that already uses `{`/`}`/`|`/`~` as window furniture inside ordinary text (a real, if unusual,
existing use this codebase's own font module explicitly documents as intentional), for a token most
projects will never combine with furniture on the same line at all; the exact-sequence rule costs
nothing for the common case and preserves the existing one.

**`TXT_NAME = $03`, appended after `TXT_PAGE` in both hand-duplicated locations that already carry
`TXT_END`/`TXT_NEWLINE`/`TXT_PAGE`** — `engine/constants.asm:1033-1035` (append at `:1036`, immediately
before the blank line and `; Event page conditions...` comment) and `main/build/textcompile.js:60-62`
(`export const TXT_NAME = 0x03;`), the identical two-literals-that-must-agree pattern `MAX_ITEMS`
already establishes (`shared/save.js`'s own comment on it) and `TXT_END`/`TXT_NEWLINE`/`TXT_PAGE`
themselves already are.

**`text_type_step`'s own control-byte chain (`engine/text.asm:336-362`), the full listing, corrected —
one new arm between the existing `TXT_PAGE` check and the fallthrough-to-glyph case. P1-1 (round-1
finding) removed the "only select the source table on frame 0" shortcut entirely; P1-2 removed the
three-way source swap (§3) down to one unconditional pair.** Reached once per frame, exactly the
typewriter's own existing one-glyph-per-frame rate — the token spends the identical budget every
ordinary glyph already does, never more than one draw per frame (§12):

```
text_type_step:
  ldy #0
  lda [msg_ptr_lo],y
  bne text_type_control
  lda #BOX_ENDWAIT
  sta box_state
  jmp text_show_arrow
text_type_control:
  cmp #TXT_NEWLINE
  bne text_type_page
  jsr msg_advance
  inc msg_line
  lda #0
  sta msg_col
  rts
text_type_page:
  cmp #TXT_PAGE
  bne text_type_name
  jsr msg_advance
  lda #BOX_PAGEWAIT
  sta box_state
  jmp text_show_arrow
  .if NAME_TOKEN_ENABLED
text_type_name:
  cmp #TXT_NAME
  bne text_type_glyph
  lda #LOW(pc_name_ram)         ; reloaded EVERY frame this token is in
  sta ptr_lo                    ; progress -- not only the first -- because
  lda #HIGH(pc_name_ram)        ; ptr_lo/ptr_hi are shared, volatile scratch
  sta ptr_hi                    ; (P1-1, below) draw_entities' own animation
                                 ; path clobbers between frames
  ldy msg_name_idx
text_type_name_lookahead:     ; is there a real (non-space) glyph at or after
  cpy #NAME_LEN                ; msg_name_idx? If not, we are already inside
  beq text_type_name_done      ; the trailing pad -- the token is finished.
  lda [ptr_lo],y                ; An internal space (an authored default like
  cmp #TILE_SPACE               ; "Sir Reginald") is NOT trailing pad, so this
  bne text_type_name_draw       ; loop must look past it, not stop on it.
  iny
  jmp text_type_name_lookahead
text_type_name_draw:
  ldy msg_name_idx             ; reload -- the lookahead above may have moved
  lda [ptr_lo],y                ; Y past msg_name_idx while searching ahead
  jsr text_put_char
  inc msg_col
  inc msg_name_idx
  rts
text_type_name_done:
  lda #0
  sta msg_name_idx
  jsr msg_advance               ; consume the TXT_NAME byte itself
  rts
  .endif
  .if !NAME_TOKEN_ENABLED
text_type_name:
  .endif
text_type_glyph:
  jsr text_put_char
  jsr msg_advance
  inc msg_col
  rts

msg_advance:
  inc msg_ptr_lo
  bne msg_advance_done
  inc msg_ptr_hi
msg_advance_done:
  rts
```

**P1-1 (round-1 finding): the removed invariant was false the moment two token frames could ever have
anything else run between them, which is every time — `ptr_lo`/`ptr_hi` are shared, per-frame scratch,
not this token's own private state.** v13's own "only select the source table on frame 0" shortcut
(`lda msg_name_idx / bne text_type_name_scan`) assumed `ptr_lo`/`ptr_hi`, once set, would still hold
the same value on the *next* frame this same token instance is drawn. Between those two frames the main
loop runs `draw_entities` (`engine/boot.asm:239`, called from `main_loop_draw`, `:232`), whose own
`draw_one_entity`/`entity_animation` path (`engine/entities.asm:494-521`, `:606-609`) writes `ptr_lo`/
`ptr_hi` as scratch for its own, completely unrelated animation-frame lookup — so a second glyph of the
same token, on the very next frame, would read `[ptr_lo],y` against whatever animation data the last
entity drawn that frame left there, not `pc_name_ram`. Every naming grid draw in §5 has the identical
shared-scratch exposure in principle, but never the identical *bug*, because `nameentry_raise_step`
and the grid's own per-cell routines each set `ptr_lo`/`ptr_hi` and consume them within the same call,
never assuming a value set on an earlier frame survives to a later one — the token's own "set once,
reuse across frames" shortcut was the one place in this whole feature that broke that discipline, and
the fix brings it into line with everywhere else: reload every frame, treat `ptr_lo`/`ptr_hi` as
never trustworthy across a frame boundary, full stop.

**Byte cost, re-counted after both fixes.** The removed `lda msg_name_idx / bne text_type_name_scan`
(4 bytes) and the three-way swap's own two now-dead arms (P1-2) are gone; the one remaining pointer-set
pair (`lda #LOW(pc_name_ram) / sta ptr_lo / lda #HIGH(pc_name_ram) / sta ptr_hi`, 4 instructions, 8
bytes) now runs unconditionally at the top of every frame this arm is reached, in place of running
conditionally on frame 0 only — a net *reduction* in the listing's own static instruction count
(one unconditional 8-byte pair replaces a 4-byte conditional-skip plus what was, on the naming-on arm
alone, an equivalent 8-byte pair — the two now-deleted `!NAME_ENTRY_ENABLED` arms cost nothing on any
build that reaches this file at all, since the token is `NAME_TOKEN_ENABLED`-gated the same way either
version was) even though it now executes every frame rather than once per token. `NAME_TOKEN_KERNEL_
ALLOWANCE` (§11) was already an unmeasured placeholder before this fix and remains one — phase 2b
measures the real figure regardless of which shape of this listing it measures against.

The `.if !NAME_TOKEN_ENABLED` arm's bare `text_type_name:` label with nothing under it is not a mistake
— `text_type_page`'s own `bne text_type_name` must resolve to *some* label regardless of whether the
token is compiled in, and a naming-off (or naming-without-token) build simply falls straight through
the empty label into `text_type_glyph` immediately below, identical to what `bne text_type_glyph`
would have compiled to directly — the label costs nothing, but writing it this way means
`text_type_page`'s own `bne` target text never has to change between the two builds, only what sits at
the target.

**`msg_name_idx`'s own reset, alongside `msg_col`/`msg_line`'s existing one.** `box_begin`
(`engine/text.asm:186-187`, `sta msg_col` / `sta msg_line`) gains `sta msg_name_idx` in the same
store-a-zero sequence — the exact precedent §2 already cites for why this counter is always 0 the
first time `text_type_name` sees a fresh token instance, whether that token is the message's first or
third: `text_type_name_done` above resets it back to 0 on its own way out, and `box_begin` resets it
once more at the top of every fresh box, so by induction it is 0 at the start of every token instance
this routine will ever see.

**Why the token never sees a byte it should not, and `textToTiles` never sees the raw braces —
`encodeString`'s own change, `main/build/textcompile.js:131-145`.** `encodeString` already calls
`wrapText` then, per wrapped line, `shared/font.js`'s plain per-character `textToTiles` — confirmed
this round to have no token awareness at all today. It gains a scan for the literal `{name}` substring
*before* the per-character mapper runs on each wrapped line, splitting the line into ordinary runs
(mapped by `textToTiles`, unchanged) and token occurrences (emitting the single `TXT_NAME` byte, never
six glyph tiles) — **gated on a new `allowNameToken` parameter, `false` by default (P2-5, below), so a
caller that never opts in gets exactly today's behavior with no token recognition at all:**

```js
// main/build/textcompile.js, encodeString's per-line helper, corrected --
// P1-1's own round-1 finding: this must return { tiles, unmapped }, the exact
// shape encodeString's own existing caller line (below) already expects from
// textToTiles -- a { bytes, unmapped } shape here would desync that line
// silently (bytes.push(...mapped.tiles) reading undefined).
const NAME_TOKEN = '{name}';
function encodeLine(line, allowNameToken) {
  if (!allowNameToken) return textToTiles(line);
  const tiles = [];
  const unmapped = new Set();
  let rest = line;
  let cut;
  while ((cut = rest.indexOf(NAME_TOKEN)) !== -1) {
    const mapped = textToTiles(rest.slice(0, cut));
    for (const char of mapped.unmapped) unmapped.add(char);
    tiles.push(...mapped.tiles, TXT_NAME);
    rest = rest.slice(cut + NAME_TOKEN.length);
  }
  const mapped = textToTiles(rest);
  for (const char of mapped.unmapped) unmapped.add(char);
  tiles.push(...mapped.tiles);
  return { tiles, unmapped };
}

export function encodeString(text, allowNameToken = false) {
  const bytes = [];
  const unmapped = new Set();
  wrapText(text, BOX_COLS, BOX_ROWS).forEach((page, pageIndex) => {
    if (pageIndex) bytes.push(TXT_PAGE);
    page.forEach((line, lineIndex) => {
      if (lineIndex) bytes.push(TXT_NEWLINE);
      const mapped = encodeLine(line, allowNameToken);       // was textToTiles(line) directly
      for (const char of mapped.unmapped) unmapped.add(char);
      bytes.push(...mapped.tiles);                            // unchanged -- both branches of
    });                                                        // encodeLine now return .tiles
  });
  bytes.push(TXT_END);
  return { bytes, unmapped };
}
```

`textToTiles` is never given a substring containing an unconsumed `{`/`n`/`a`/`m`/`e`/`}` run that was
meant to be a token — every token instance is sliced out and replaced with the one-byte `TXT_NAME`
opcode before the character mapper ever sees that span, so a lone brace elsewhere on the same line
still reaches `textToTiles` and renders as furniture, per the exact-sequence rule above.

**P2-5: `allowNameToken` is `Say` text only, never a choice option label — `internString`
(`main/build/textcompile.js:161-170`) is the one function both go through, and it gains the flag as its
own second parameter, threaded to `encodeString`:**

```js
// main/build/textcompile.js, internString, corrected
const internString = (text, allowNameToken = false) => {
  const encoded = encodeString(text, allowNameToken);
  for (const char of encoded.unmapped) unmapped.add(char);
  const key = encoded.bytes.join(',');
  if (!stringIds.has(key)) {
    stringIds.set(key, strings.length);
    strings.push(encoded.bytes);
  }
  return stringIds.get(key);
};
```

Three call sites, two flipped to `true`, one left at its own default: `internString(command.text ?? '',
true)` for a scripted `Say` (`:241`); `internString(dialogue, true)` for the "plain dialogue, no
scripted event" shortcut (`:554` — CLAUDE.md's own "plain dialogue is compiled into an event of one
unconditional page" case, itself `OP_SAY`, so it gets the identical treatment); `internString(
choiceLabel(option.text))` for a choice option label (`:471`, unchanged — `allowNameToken` defaults
`false`) — `projectUsesNameToken` (§9a) and the runtime expansion both cover `Say` text only, so a
`{name}` typed into a choice label would otherwise compile a `TXT_NAME` byte no renderer expands
(`text_choice_step` draws a choice row's own glyphs directly, with no control-byte dispatch of its own
at all — confirmed this round by reading it, not assumed).

**A choice label containing the literal `{name}` still compiles — `allowNameToken: false` does not
refuse it, it simply stops treating it as a token.** With `encodeLine` falling straight to `textToTiles`,
`{`/`n`/`a`/`m`/`e`/`}` are six ordinary charactes with real glyphs (§9a's own brace-collision
paragraph): the label renders as the border-corner glyph (`{`), the four letters "name", and the
border-corner glyph again (`}`) — legal, displayable, and almost certainly not what an author meant,
which is exactly why `validateProject` gains a **warning**, not a refusal, for this case: a live choice
option label containing `{name}` (walked the same `liveCommands`/`CHOICE_LIMITS.options` way
`projectUsesJoinNaming` already does) is flagged, naming the Map Forge, with a message stating plainly
that the token only expands inside `Say` text and this label will show the literal braces instead — a
warning, not an error, because it is legal text that compiles and runs, just not the way an author
who copy-pasted a `Say` line into a choice label likely intended.

**`wrapText` itself is unchanged by P2-5 — deliberately, a scope decision, not an oversight.** A choice
label containing `{name}` still gets the 10-column visual-length treatment §9a's own `wrapText`
correction already applies to any `{name}`-shaped substring, mildly overestimating its wrapped width
against what it will actually render as (6 literal characters) once `allowNameToken: false` reaches
`encodeLine`. This is a real, accepted asymmetry, not a second bug to chase: `wrapText` has no way to
know a given line is destined for a choice label rather than a `Say` at the point it runs (it is called
before `encodeString`, on raw text, for both), threading `allowNameToken` through it as well would only
tighten a choice label's own wrap by up to 4 columns in the rare case an author puts the literal
sequence there at all — a cosmetic-only difference this round chooses not to spend a second parameter
on.

**`wrapText`'s own word-measurement, corrected so a word containing the token is measured with the
token counted as 10 columns, and a token is never split across a wrap.** `wrapText`
(`shared/font.js:227-263`) measures a candidate line with plain `.length`; a word containing `{name}`
(6 literal characters) has to be measured as if it were `RPG_LIMITS.nameLength` (10) characters wide,
since that is the real column budget the compiled token will occupy once the engine expands it at
runtime — the compiler cannot know the *actual* typed name's length at wrap time, only the reserved
worst case:

```js
// shared/font.js, wrapText's own word loop, corrected
const NAME_TOKEN = '{name}';
function visualLength(str) {
  const extra = RPG_LIMITS.nameLength - NAME_TOKEN.length; // 10 - 6 = 4
  let count = 0;
  let from = 0;
  let at;
  while ((at = str.indexOf(NAME_TOKEN, from)) !== -1) {
    count++;
    from = at + NAME_TOKEN.length;
  }
  return str.length + count * extra;
}
...
for (const word of words) {
  const candidate = line ? `${line} ${word}` : word;
  if (visualLength(candidate) <= cols) {
    line = candidate;
  } else if (line) {
    push(line);
    line = word;                 // no longer sliced to cols here (below)
  } else {
    line = word;                 // a single word longer than the window
  }
}
```

**The one real edge case this reopens: the existing `word.slice(0, cols)` truncation, for a single
"word" (no internal whitespace) too wide for the window on its own, must never cut through a `{name}`
occurrence.** This case is rare in practice — a lone token is only 10 visual columns wide, well under
`BOX_COLS` (28), so it can only be reached by a token glued, with no space, to enough surrounding
non-space text to push the combined word past 28 — but "rare" is not "impossible," and a naive
`slice(0, cols)` could otherwise cut a `{name}` token in half, emitting a dangling `{na` that
`encodeLine`'s own exact-sequence scan above would then render as raw, unmapped furniture-adjacent
characters rather than a token at all. `wrapText`'s own truncation is corrected to cut at the *nearest
token boundary at or before* the visual column limit, never inside one:

```js
// shared/font.js, wrapText's own overflow branch, corrected
function truncateAtVisualLimit(word, cols) {
  let visual = 0;
  let cut = 0;
  let i = 0;
  while (i < word.length) {
    const isToken = word.startsWith(NAME_TOKEN, i);
    const width = isToken ? RPG_LIMITS.nameLength : 1;
    if (visual + width > cols) break;
    visual += width;
    i += isToken ? NAME_TOKEN.length : 1;
    cut = i;
  }
  return word.slice(0, cut);
}
```

used in place of the bare `word.slice(0, cols)` in both of `wrapText`'s own overflow branches. A token
that does not fit at all on an otherwise-empty line (an authored line under 10 characters wide, which
`validateProject`'s own existing box-geometry checks already make unreachable in practice — `BOX_COLS`
is 28) is not specially handled beyond this, since it cannot occur given the box's own real dimensions.

**The event editor's own preview (`renderer/forges/map/events.js`) and the box preview both call
`wrapText` directly** — confirmed this round, no separate rendering path of their own. Both show the
token as a fixed, 10-column placeholder rather than the literal `{name}` text, so an author sees the
same width their compiled message will actually reserve.

**P2-6: substitution has to happen *after* wrapping, never before, or the padded placeholder's own
internal spaces desync the preview from the compiler.** `wrapText` (`shared/font.js:241`) splits on
whitespace to find word boundaries — a naive fix that substitutes a 10-character, space-padded display
name into the raw source string *before* calling `wrapText` would hand it a string whose padding spaces
`wrapText` reads as ordinary word breaks, wrapping the padded name across a line boundary `wrapText`'s
own real, token-aware wrap (`visualLength`/`truncateAtVisualLimit`, above) would never produce — a
preview genuinely disagreeing with the ROM for exactly the input that most exercises the reservation
this whole mechanism exists to get right. The fix wraps the **literal, unsubstituted** text first (the
same call the compiler itself makes, `{name}` still six characters wide but measured as the reserved
ten by `visualLength`), and only then substitutes the display name into each already-wrapped line —
a plain string swap that cannot move a line break, since the break was already decided:

```js
// renderer/forges/map/events.js (and the box preview's identical helper)
function previewLines(text, project) {
  const displayName = previewHeroName(project)
    .padEnd(RPG_LIMITS.nameLength, ' ')
    .slice(0, RPG_LIMITS.nameLength);
  return wrapText(text).map((page) => page.map((line) => line.split('{name}').join(displayName)));
}
```

**P2-7: the display name substituted above is `project.project.heroName` on an action project, but
`party[0].name` on an RPG — `heroName` itself is action-only, and editing it on an RPG changes nothing
a real build reads.** On an RPG, `needsHeroDefault` (P1-2's own correction, §8) is `false` — the hero's
own seed comes from `pc_name` via the banked `party_init`/`party_join` path, itself derived from
`party[0].name`, never from `hero_name_default` — so a `heroName` value stored on an RPG project is
inert: nothing in the compiled ROM, and nothing this preview should show either, ever reads it.

```js
// renderer/forges/map/events.js, beside previewLines
function previewHeroName(project) {
  return project.project.gameType === 'rpg' ? (project.party[0]?.name ?? 'Hero') : project.project.heroName;
}
```

`normalizeProject`'s own behavior for a stored `heroName` on an RPG project: **kept, not stripped, but
ignored** — the same dormant-field convention `project.rpg`'s own fields already hold to on an action
project (P1-2's own research this round: `normalizeRpg` runs unconditionally for every project
regardless of `gameType`, its fields simply inert where they do not apply). `normalizeHeroName` (§8)
still clamps whatever value is present, on either game type, so a hand-edited or format-drifted value
cannot reach the UI or the compiler malformed — it is only the *use* of the field, not its presence or
validity, that becomes RPG-conditional.

**`validateProject` gains one new refusal, alongside the existing Save-needs-a-title check
(`:6098-6115`) and §8's own default-name refusal**: a live token (`projectUsesNameToken`, below) in a
project with **neither** hero naming **nor** a compiled default name source is refused, naming the Map
Forge — in practice unreachable once `needsHeroDefault` (§8) is wired correctly, since the token itself
is one of that predicate's own two disjuncts, kept as the same defense-in-depth every other
capacity-adjacent refusal in this codebase already is for a hand-edited or future-version project.

**`projectUsesNameToken(project)`, live-only, `liveCommands` not `allCommands` — the identical choice
`projectUsesMove` already makes (`shared/project.js:5457-5466`, cited directly rather than merely
described), for the identical reason: a token switched off, or sitting inside a switched-off branch, is
scaffolding the compiler already drops and must not cost a project the token's own kernel-lo term
below.**

**P1-1 (round-2 finding): v14.1's own version covered authored `Say` commands only, never plain
dialogue — a genuinely separate compile path this predicate never walked at all.** `projectEvents`
(`shared/eventrules.js:249`) yields `entity.props.event` for every entity that has one — plain
dialogue (`entity.props.dialogue`) is a sibling field, never wrapped in an "event" object, so
`projectEvents` never yields it, and neither did anything downstream of it. Verified directly against
both source lines the round-2 finding names: `main/build/textcompile.js:541-554`'s own dialogue-vs-
event choice — `const pages = compiledPages(entity.props?.event); ... pages.length ? encodeEvent(pages,
...) : [...COND_NONE, ..., OP_SAY, internString(dialogue), ...]` — compiles plain dialogue into exactly
this project's own ROM the moment `entity.props?.event` compiles to **zero** live pages (no event
authored at all, or one whose every page a switch has disabled), with `internString(dialogue, true)`
already passing `allowNameToken: true` (P2-5, §9a) — so a `{name}` in plain dialogue genuinely compiles
to a `TXT_NAME` byte, on a project whose `NAME_TOKEN_ENABLED` this predicate's own gap left at 0: no
`text_type_name` arm assembled to expand it, and (since `NAME_SEED_ENABLED` is itself gated on the
identical predicate, §8) no seed either — reproduced by the reviewer directly against these two lines,
not merely argued from the code shape.

**The fix needs one more shared helper — `shared/eventrules.js`'s own `effectiveDialogue`, beside
`compiledPages` — because "which text does this placement actually compile" was never a single
answer anywhere in `shared/` before this finding, only inline in `textcompile.js` itself:**

```js
// shared/eventrules.js, beside compiledPages -- the single answer to "which
// text does this placement actually compile," matching main/build/
// textcompile.js's own dialogue-vs-event precedence (:541-554) exactly: an
// authored event with at least one compiled page wins outright, and plain
// dialogue is read only when the event compiles to nothing at all.
export function effectiveDialogue(entity) {
  if (compiledPages(entity.props?.event).length) return ''; // the event wins; dialogue is dead text
  return String(entity.props?.dialogue ?? '').trim();
}
```

`projectUsesNameToken` and `projectWithoutNameToken` (§11) both walk every placed entity through it,
in addition to their existing event walk — never in place of it, since an authored event's own live
`Say` commands are a separate, real source the token can also appear in:

```js
// shared/project.js, projectUsesNameToken, corrected
export function projectUsesNameToken(project) {
  for (const event of projectEvents(project)) {
    for (const page of compiledPages(event)) {
      for (const command of liveCommands(page.commands, CHOICE_LIMITS.options)) {
        if (command.op === 'say' && String(command.text ?? '').includes('{name}')) return true;
      }
    }
  }
  for (const map of project?.maps ?? []) {
    for (const screen of map.screens ?? []) {
      for (const entity of screen.entities ?? []) {
        if (effectiveDialogue(entity).includes('{name}')) return true;
      }
    }
  }
  return false;
}
```

`effectiveDialogue`'s own precedence check (`compiledPages(entity.props?.event).length`) is exactly
why a `{name}` sitting in a dialogue field the compiler will never emit — because that same entity's
own authored event already compiles at least one live page — does not charge this predicate: the
second loop reads `''` for that entity and moves on, the identical "a switched-off branch is
scaffolding the compiler already drops" discipline the live-`Say` half already holds itself to, applied
to the other compile path rather than skipped for it.

`NAME_TOKEN_ENABLED = projectUsesNameToken(project)` — no `battleEnabledFor`/`NAME_ENTRY_BANKED` term
at all, since the token is always kernel-lo (`text.asm` is unconditionally kernel-lo on every board and
every game type, banked naming or not) and needs no placement decision of its own the way the grid does.

**`NAME_TOKEN_KERNEL_ALLOWANCE`, flat until real variance is measured** — CLAUDE.md's own "a term stays
flat until real variance is measured" rule (The kernel budget), gated on `NAME_TOKEN_ENABLED` alone,
charged on top of whichever of `HERO_DEFAULT_KERNEL_ALLOWANCE`/nothing §8's own `needsHeroDefault` adds:
covers `text_type_step`'s own new arm (the listing above), `msg_name_idx`'s reset in `box_begin`, and
the three-way pointer swap. Not yet measured against nesasm — phase 2b (§17) measures it for real, the
same discipline every other allowance in this document already holds itself to before its first real
build.

## §10. Save — the descriptor field, the version bump, and exactly what shifts — shipped, phase 1,
unmodified by v13

**Past tense: this section describes what phase 1 already did, in the working tree, uncommitted, under
review as this round is written — not a proposal any more.** `shared/save.js`'s `SAVE_FIELDS` gained
`{ ram: 'pc_name_ram', size: RPG_LIMITS.party * RPG_LIMITS.nameLength }` (40, three more descriptor
bytes: `LOW`/`HIGH`/`len`, one each, in the generated `save_field_lo/hi/len` tables — a real,
unconditional kernel-lo cost for every save-enabled project regardless of whether naming is used).
`SAVE_LAYOUT_VERSION` bumped 2 → 3 (`shared/save.js:68`, pinned this round). `save_write_body`/
`load_apply_body` needed no changes, and got none.

`text.asm`/`script.asm`/`input.asm`/`music.asm`/`assets/usercode.inc` all shifted, sitting in
kernel-lo's own sequential run after `save.asm`. `assets/kernel_hi.inc`/`assets/music.inc`/
`assets/text.inc` were unaffected, since `kernel_hi.inc` opens with its own fresh `.bank <N> / .org
$E000`.

This affected `sample-mmc1`, `sample-mmc3`, `sample-u512`, and `sample-rpg-mmc1` (confirmed this round
against the working tree: each fixture's own kernel-lo headroom moved by exactly phase 1's own +3
`SAVE_KERNEL_ALLOWANCE_BY_MAPPER` shift, §0's own re-measurement). `sample-rpg/` carries no Save
command, untouched unless it opts into naming.

**Every ROM with neither Save nor naming — `sample/` included — is fully byte-identical, on both
counts named here and on the input-row count §4's own Y1 fix restores — corrected this round for D6:
`sample/`'s own byte-identity is no longer structural, it is contingent on content.** v12 could say
`projectUsesNameEntry(sample)` is `false` "by construction," since both of its disjuncts required an
RPG and `sample`'s own `gameType` is `'action'`. `projectUsesHeroNaming` dropped that requirement this
round (D6, §9) — an action fixture genuinely *can* opt into hero naming now, and phase 4 (§17) is
exactly where `sample` itself is planned to. The claim that holds today is narrower and content-based:
`sample`'s own `project.project.nameHeroAtStart` is unset (`false`, the default, §8) as shipped, so
`projectUsesHeroNaming(sample)` — and therefore `projectUsesNameEntry(sample)` — reads `false` for
exactly as long as that stays true, the same way any other optional feature's byte-identity in this
codebase already depends on content rather than game type (`projectUsesMove`, `projectUsesSave`, every
other predicate this document's own kernel budget already cites). Its own `input_actions` table stays
at today's 24 bytes rather than growing to 28 for the identical reason — that row is conditionally
emitted (§4's own Y1 fix) on the same content-only predicate.

## §11. Capacity — the banked/kernel ledgers, `battleShortfallAdvice`/`kernelShortfallAdvice` both
correctly extended, the override-deficit fix (X2), and the exact isolation matrix (X3)

**The static count**, adopted from the round-8 reviewer's own independently-confirmed figures (banked
grid 722, dispatch growth 43, copy loop 47):

```
Banked grid, including tables         722 bytes
battle_entry's own dispatch growth     43 bytes  (§5)
NAME_ENTRY_BATTLE_ALLOWANCE           765 bytes  (722 + 43)
NAME_COPY_BATTLE_ALLOWANCE             47 bytes  (party_join's copy loop)
Total banked addition                 812 bytes
```

**P2-2 (round-2 finding): these two banked terms do NOT share one gate any more, and charging them
together under-reserves a real, buildable project.** v14.1's own text here still claimed `NAME_ENTRY_
BATTLE_ALLOWANCE` (the grid) and `NAME_COPY_BATTLE_ALLOWANCE` (`party_join`'s own copy loop) shared one
gate and "there is no build-time lever that turns one on without the other" — true through v14, false
the moment P1-2 widened the copy loop's own gate from `NAME_ENTRY_ENABLED` to `NAME_SEED_ENABLED` (§7):
a **token-only RPG** — the token authored, neither hero naming nor a named Join live — has
`projectUsesNameEntry(project) === false` (no naming feature at all) but `NAME_SEED_ENABLED === true`
(the token alone triggers it), so `party_join`'s own copy loop genuinely assembles, 47 real banked
bytes, while the grid itself (`nameentry.asm`'s own body, `battle_entry`'s own dispatch growth) does
not, since `battle.asm`'s own `.include "nameentry.asm"` site is still gated on `NAME_ENTRY_ENABLED`
alone (§5) and stays inert. `battleRegionBytes` charged this project **zero** of either term — a
47-byte under-reservation on any token-only RPG, the exact shape of bug the banked region's own "exact,
not merely covering" discipline (§11's own Y3/Z4 paragraphs) exists to catch, caught here before a
build ever ran rather than after. Split into two independently-gated terms, each keyed to the real
condition that actually turns its own code on:

```js
// shared/project.js, beside projectNeedsHeroDefault -- the single answer to
// "does this project need pc_name_ram seeded at all," the identical formula
// NAME_SEED_ENABLED's own kernel-lo emission already computes (§4/§9),
// consumed here too rather than re-derived a second time
export function projectNeedsNameSeed(project) {
  return projectUsesNameEntry(project) || projectUsesNameToken(project);
}
```

```js
// main/build/battletables.js:803-809, battleRegionBytes, corrected
export function battleRegionBytes(project, mapper) {
  const banked = battleBankEnabled(project, mapper);
  return (
    baseBattleCodeBytes(mapper) +
    battleTableBytes(project) +
    (projectUsesItems(project) ? ITEM_LIST_FILTER_BATTLE_ALLOWANCE : 0) +
    (projectUsesNameEntry(project) && banked ? NAME_ENTRY_BATTLE_ALLOWANCE : 0) +
    (projectNeedsNameSeed(project) && banked ? NAME_COPY_BATTLE_ALLOWANCE : 0)
  );
}
```

`kernelCodeBytes`'s own `usesNameSeed`-shaped local (§4, wherever `NAME_SEED_ENABLED` is computed for
the kernel-lo emission) is corrected in place too, to call this same `projectNeedsNameSeed` rather than
restate `usesNameEntry || usesNameToken` inline a second time — the identical single-writer move P1-2's
own `projectNeedsHeroDefault` already made for the sibling predicate, now extended so this one has
exactly one home as well, not the two (kernel-lo's own inline local, and this section's now-corrected
banked formula) it would otherwise have started with.

**The kernel-lo side:**

```
NAME_ENTRY_KERNEL_ALLOWANCE            = 95 bytes (§4: 3+30+24+19+9+7+3); NAME_ENTRY_ENABLED
JOIN_NAMING_KERNEL_ALLOWANCE           = 64 bytes (script_op_join's growth); JOIN_NAMING_ENABLED
HERO_NAMING_KERNEL_ALLOWANCE           = 15 bytes (start_game's own delta); HERO_NAMING_ENABLED
HERO_NAMING_TITLELESS_KERNEL_ALLOWANCE = 20 bytes (reset's own new block);
                                          HERO_NAMING_ENABLED && !TITLE_ENABLED
```

None of these four terms include the input-row's own 4 bytes — that cost lives in `kernelTableBytes`'s
own `fixedBytes`, a different function from `kernelCodeBytes`, and (per §4's own Y1 fix) is gated on
`projectUsesNameEntry(project)` alone, paid only when a project actually opts into naming, never by an
action project or a naming-off RPG. It is still not folded into `NAME_ENTRY_KERNEL_ALLOWANCE` — a code
term and a table term stay in the ledgers they each belong to — but it *does* toggle in step with
`projectUsesNameEntry`, which is why the fixture arithmetic below both counts it (both fixtures opt in)
and why `kernelShortfallAdvice`'s own combination search (§4's own Y1 fix) frees it automatically the
moment a candidate removal would turn `projectUsesNameEntry` false. `NAME_ENTRY_KERNEL_ALLOWANCE`'s own
95-byte figure is unchanged in *what* it covers this round — the shared hook glue in §4, identical
source text on either placement — but its real value moved with §5's own shim rewrite (§4's own note)
and is no longer nesasm-measured even as a starting point; phase 2 re-measures it, on both game types.

**A fifth, action-only kernel-lo term, new this round (D8): the grid's own body, when it has nowhere
else to live.** On an RPG, the 722-byte grid (§5's own routines, `nameentry_begin` through
`draw_nameentry_cursor`) is banked, charged against the banked ledger below, not this one. On an action
project it is `NAME_ENTRY_ENABLED`-gated kernel-lo code like any other optional feature in this file —
the identical source, the identical static count, adopted as a starting figure the same way the banked
count originally was (round 8), never yet nesasm-measured on this placement:

```
NAME_ENTRY_ACTION_KERNEL_ALLOWANCE = 722 bytes (start flat -- §5's own grid body, kernel-lo placement);
                                      HERO_NAMING_ENABLED && !NAME_ENTRY_BANKED
```

Gated on `!NAME_ENTRY_BANKED`, not on `gameType`, for the identical reason every other placement-aware
term in this document already is (§5) — `battleBankEnabled` is the structural fact, `gameType` is only
ever a proxy for it. Named apart from the brief's own shorthand for it (which reused
`NAME_ENTRY_KERNEL_ALLOWANCE`'s own name for "the action-side cost as a whole") to avoid a genuine
collision with the pre-existing, both-placements term immediately above — the two are separate
allowances covering separate code, and folding them into one name would make `kernelShortfallAdvice`'s
own per-term removal candidate (below) ambiguous about which one a given board's own deficit was
actually charging.

**Two more flat kernel-lo terms, both game types, both new this round (§8/§9a):**

```
HERO_DEFAULT_KERNEL_ALLOWANCE = 21 bytes (hero_name_default's own table, 10, plus init_session's
                                 own action-side copy loop that reads it, 11, §8 -- P2-3, round-2
                                 finding: one term, since the loop's own gate reduces to the exact
                                 same predicate as the table's on the only game type either exists
                                 on); projectNeedsHeroDefault
NAME_TOKEN_KERNEL_ALLOWANCE   = flat until measured (§9a); NAME_TOKEN_ENABLED
```

`HERO_DEFAULT_KERNEL_ALLOWANCE`'s own 21 bytes are exact, not a static guess — the 10-byte `.db` table
has nothing conditional inside it, and the 11-byte copy loop (§8's own P2-3 fix: `ldy #NAME_LEN-1` (2)
+ `lda hero_name_default,y` (3) + `sta pc_name_ram,y` (3) + `dey` (1) + `bpl ...` (2)) is a fixed,
unconditional instruction sequence with no branch whose outcome could change its own size — the one
term in this whole feature whose size nesasm can be trusted to match on paper before it is ever built,
the same confidence `MOVE_KERNEL_ALLOWANCE`'s own siblings place in a flat table row elsewhere in this
codebase's kernel budget. `NAME_TOKEN_KERNEL_ALLOWANCE` is not — it covers real branching code (§9a's
own `text_type_name` block) and stays an unmeasured placeholder until phase 2b actually assembles it.

**X2: `battleShortfallAdvice`'s naming candidates must be suppressed, not merely reworded, when the
battle code is overridden.** HEAD's own call site (`generate.js:2026-2058`) computes the deficit two
different ways depending on `overridden = battleCodeOverridden(project)`: `const regionBytes =
overridden ? battleTableBytes(project) : battleRegionBytes(project, mapper)`. When `overridden` is
true, the deficit passed to `battleShortfallAdvice` is `battleTableBytes(project) - regionCeiling` —
computed **entirely** from the generated tables, with no reference anywhere to stock code size, because
the stock code's real size is unknown (a Code Forge override replaced it). Removing naming changes
`battleRegionBytes` (it lives in `baseBattleCodeBytes`'s half of the region) but leaves
`battleTableBytes` completely untouched — so in the overridden case, a naming-removal candidate closes
none of the actual deficit, no matter how it is phrased. HEAD's own existing `levers` (actors, spells,
party, max level) remain valid advice in this case, since each is checked against `battleTableBytes(draft)
<= target` (`battletables.js:901`), the identical quantity the deficit itself was computed from — only
the naming candidates need suppressing:

```js
export function battleShortfallAdvice(project, mapper, deficit, { alternatives = [], exact = true } = {}) {
  const target = battleTableBytes(project) - deficit;
  const levers = [ /* unchanged -- actors, spells, party members, maxLevel, each checked against
                       battleTableBytes, which stays meaningful whether or not exact is true */ ];

  const options = [];
  for (const lever of levers) { /* unchanged */ }

  // Suppressed entirely when exact is false: with an overridden battle
  // system, the deficit above was computed from battleTableBytes ALONE
  // (generate.js:2036) -- removing naming changes battleRegionBytes, never
  // battleTableBytes, so it cannot close this particular deficit no matter
  // how the advice is worded. Offering it here would be worse than a
  // mis-worded hedge: the number itself would not even be the quantity the
  // deficit measures.
  const nameFeatures = [];
  if (exact) {
    if (battleBankEnabled(project, mapper) && projectUsesHeroNaming(project)) {
      nameFeatures.push({ label: 'hero naming at the start of a new game', strip: projectWithoutHeroNaming });
    }
    if (battleBankEnabled(project, mapper) && projectUsesJoinNaming(project)) {
      nameFeatures.push({ label: 'every named Join', strip: projectWithoutJoinNaming });
    }
  }
  if (nameFeatures.length) {
    const nameBudget = battleRegionBytes(project, mapper);
    const nameFreed = (subset) =>
      nameBudget - battleRegionBytes(subset.reduce((p, f) => f.strip(p), project), mapper);
    const soloWinners = nameFeatures.filter((f) => nameFreed([f]) >= deficit);
    if (soloWinners.length) {
      for (const f of soloWinners) options.push(`removing ${f.label}`);
    } else if (nameFeatures.length > 1 && nameFreed(nameFeatures) >= deficit) {
      options.push(`removing ${nameFeatures.map((f) => f.label).join(' and ')}`);
    }
  }

  const roomier = exact ? alternatives.filter(/* unchanged */).sort(/* unchanged */)[0] : undefined;
  // ... the rest of the function -- boards, withBoards, the options.length
  // checks, the exact-driven phrasing -- is entirely unchanged.
}
```

Because `exact` is always false exactly when naming's own candidates would be irrelevant to the
deficit, and always true exactly when they are valid, gating the whole `nameFeatures` block on `exact`
is sufficient — no separate uncertainty flag is needed. **Regression test**: `'battleShortfallAdvice
never proposes removing naming when the battle code is overridden and the generated tables alone
overflow the region'` — construct a project with a `battle.asm` override (any content, `battleCode
Overridden` only checks presence) whose tables alone exceed `battleRegionCeiling(mapper)`, with both
hero and Join naming on, and assert the returned string contains none of `'hero naming'`/`'named
Join'`, only the existing lever-based table-reduction phrasing (`test/unit/bankedbytes.test.js`, beside
the existing override tests).

**`kernelShortfallAdvice`'s own naming candidates need no bespoke combination logic at all.** Unlike
`battleShortfallAdvice`, `kernelShortfallAdvice` (`generate.js:1357-1477`) already searches every subset
of size ≥2 of its own `active` array for a combination that frees enough (`:1451-1461`), generic over
whatever `active` holds — so pushing hero-naming and Join-naming onto that same array is the entire
change; the existing solo-then-combination search automatically tries "both together" the moment
neither alone suffices, with no new code:

```js
// main/build/generate.js:1397-1412, three more entries in the existing active array
if (projectUsesHeroNaming(project)) {
  active.push({ label: 'hero naming at the start of a new game', strip: projectWithoutHeroNaming });
}
if (projectUsesJoinNaming(project)) {
  active.push({ label: 'every named Join', strip: projectWithoutJoinNaming });
}
if (projectUsesNameToken(project)) {
  active.push({ label: 'the name token', strip: projectWithoutNameToken });
}
```

`projectWithoutNameToken`, defined beside `projectWithoutHeroNaming`/`projectWithoutJoinNaming` (§9),
the identical `allCommands`-not-`liveCommands` shape `projectWithoutCommands` already uses for the same
reason — a candidate strip has to switch a token off everywhere it could compile, branch and choice
contents included, not merely among live occurrences. **P1-1's own fix applies here too, and
deliberately more broadly than `effectiveDialogue`'s own live-only check**: the events half already
strips `{name}` from every `Say`, switched-off branches included, on the reasoning that a removal
candidate has to stay honest against a *later* edit that makes a currently-dead branch live — the
identical reasoning extends to dialogue, so this strip clears every placed entity's own `dialogue`
field unconditionally, not only the ones `effectiveDialogue` currently reads as live (an entity whose
event happens to compile today could lose that event in a later edit, making its own dormant dialogue
live without ever having been stripped):

```js
// shared/project.js, beside projectWithoutJoinNaming
export function projectWithoutNameToken(project) {
  const clone = structuredClone(project);
  for (const event of projectEvents(clone)) {
    for (const page of event.pages ?? []) {
      for (const command of allCommands(page.commands)) {
        if (command.op === 'say' && typeof command.text === 'string') {
          command.text = command.text.split('{name}').join('');
        }
      }
    }
  }
  for (const map of clone.maps ?? []) {
    for (const screen of map.screens ?? []) {
      for (const entity of screen.entities ?? []) {
        if (typeof entity.props?.dialogue === 'string') {
          entity.props.dialogue = entity.props.dialogue.split('{name}').join('');
        }
      }
    }
  }
  return clone;
}
```

This candidate is independent of the two naming ones above it — stripping the token never turns
`projectUsesHeroNaming`/`projectUsesJoinNaming` off, and vice versa — so it needs no combination-search
special case either; it is simply a fourth entry in the same generic array, tried alone and in every
combination with the others by the existing search unchanged.

`kernelShortfallAdvice` has no `exact`/override-uncertainty parameter at all today (its own signature is
`(project, mapper, deficit)`, confirmed this round) — that distinction is specific to the banked
region's own override-detection mechanism (`battleCodeOverridden`/`battleRegionPlacementOverridden`),
which kernel-lo has no equivalent of, and adding one is out of scope for this round: nothing in the
round-8 findings asks for it, and CLAUDE.md's own "Hand-written code is deliberately outside
`checkCapacity`'s byte math" already covers a Code Forge override of a kernel-lo file the same blunt
way it always has.

**X3: the titleless isolation, and the matrix, made exact.** A prior round's own framing —
"titleless minus titled, hero-only" — conflated two different deltas: removing the title screen also
removes `TITLE_KERNEL_ALLOWANCE_BY_MAPPER`'s own 212/224-byte term (`generate.js:731`), so a raw
titleless-vs-titled comparison cannot isolate the 20-byte titleless hook on its own. The correct
isolation compares the SAME naming toggle across both title states, then subtracts:

```
Delta(titled)    = kernelCodeBytes(hero-naming on, titled)    - kernelCodeBytes(off, titled)
                  = NAME_ENTRY_KERNEL_ALLOWANCE + HERO_NAMING_KERNEL_ALLOWANCE            = 95+15  = 110
Delta(titleless) = kernelCodeBytes(hero-naming on, titleless) - kernelCodeBytes(off, titleless)
                  = NAME_ENTRY_KERNEL_ALLOWANCE + HERO_NAMING_KERNEL_ALLOWANCE
                    + HERO_NAMING_TITLELESS_KERNEL_ALLOWANCE                              = 95+15+20 = 130

HERO_NAMING_TITLELESS_KERNEL_ALLOWANCE = Delta(titleless) - Delta(titled) = 130 - 110 = 20
```

Both deltas hold the title term fixed (present in every term of `Delta(titled)`'s subtraction, absent
from every term of `Delta(titleless)`'s), so it cancels out of each delta on its own — neither delta
ever needs to know `TITLE_KERNEL_ALLOWANCE_BY_MAPPER`'s own value, only that it is held constant within
each comparison.

**Y3: every row below asserts against nesasm's own reported usage, never against `kernelCodeBytes`/
`battleRegionBytes` called on project data and compared with themselves — a mistake round 9's own
rewrite of this matrix made silently, since a delta between two *predicted* figures can never detect
the assembled code actually growing while the constant charged for it stays the same.** HEAD's own two
ledger test files already establish the real pattern this design reuses rather than invents:
`kernelbytes.test.js`'s own `measureCodeBytes(t, mapper, {...})` (`:116-…`, its own real call site at
`:2869`) builds `sample-rpg` into a temp directory with a chosen set of `with*` toggles and returns
`codeBytes`, nesasm's own reported kernel-lo usage past `reset`; `bankedbytes.test.js`'s own
`measureRegion(t, mapper, mutate)` (`:110-…`, its own real call site at `:334`) does the identical thing
for the banked region, parsing nesasm's own `BANK N used/free` line rather than asking `battleRegionBytes`
what it predicts. `measureCodeBytes`'s own options object gains two more toggles, the same shape as its
existing `withMove`/`withSave`/`withTitle`:

```js
// test/unit/kernelbytes.test.js's measureCodeBytes, two more options
{
  ...,
  withHeroNaming = false,   // project.project.nameHeroAtStart = true
  withJoinNaming = false    // the fixture's own Join gains named: true
}
```

**The matrix, listed exactly, 21 points total, each a real `nesasm`-measured delta asserted with
`assert.equal` unless noted, never a same-formula-against-itself comparison:**

| # | Region | Boards | Build A vs. Build B | Save | Real assertion | Expected |
|---|---|---|---|---|---|---|
| 1-3 | Banked | MMC1, MMC3, UNROM 512 | `measureRegion` with naming off vs. both hero + Join naming on | — | `used(B) - used(A)` | 812 |
| 4-6 | Kernel-lo | MMC1, MMC3, UNROM 512 | `measureCodeBytes({withJoinNaming: false})` vs. `{withJoinNaming: true}`, titled | off | `codeBytes(B) - codeBytes(A)` | 159 (N+J) |
| 7-9 | Kernel-lo | MMC1, MMC3, UNROM 512 | `measureCodeBytes({withHeroNaming: false})` vs. `{withHeroNaming: true}`, titled | off | `codeBytes(B) - codeBytes(A)` | 110 (N+H) |
| 10-12 | Kernel-lo | MMC1, MMC3, UNROM 512 | naming off vs. `{withHeroNaming: true, withJoinNaming: true}`, titled | off | `codeBytes(B) - codeBytes(A)` | 174 (N+H+J) |
| 13-15 | Kernel-lo | MMC1, MMC3, UNROM 512 | naming off vs. `{withHeroNaming: true}`, **`withTitle: false`** | off (illegal with title) | `codeBytes(B) - codeBytes(A)` | 130 (N+H+HT) |
| 16-18 | Both | MMC1, MMC3, UNROM 512 | one real build with naming (hero+Join) + title + Save all on | on | the build itself: nesasm exits 0; kernel-lo's real measured margin sits inside `assertCovers`'s `[KERNEL_SLACK, KERNEL_SLACK * 2]` band; the banked region's real measured usage equals `battleRegionBytes`'s own prediction exactly | pass |
| 19-21 | Banked | MMC1, MMC3, UNROM 512 | `measureRegion` with **neither** hero nor Join naming live, `{name}` absent vs. present in an existing Say (`projectUsesNameEntry` stays false throughout; only `NAME_TOKEN_ENABLED` flips) | — | `used(B) - used(A)` | 47 (`NAME_COPY_BATTLE_ALLOWANCE` alone — P2-2, round-2 finding) |

Rows 19-21 are the token-only isolation P2-2 asks for by name: rows 1-3 alone cannot distinguish "the
two banked terms share one gate" from "they are independently gated but always toggled together,"
because turning both hero and Join naming on together always fires both terms regardless of which
theory is true. A build with **only** the token live is the one configuration where the two theories
predict different numbers — 812 (if the terms still shared `NAME_ENTRY_ENABLED`, since a token-only
project has no live naming feature to trip that gate, so the old, wrong theory predicts **0**) against
47 (if `NAME_COPY_BATTLE_ALLOWANCE` alone answers to `NAME_SEED_ENABLED`, as `battleRegionBytes`'s
corrected formula above now has it) — so this row is the real discriminator between them, not a
restatement of rows 1-3 at a different toggle setting. `mutate` for the "present" build injects
`{name}` into one line of an existing live `Say` command already in the fixture (`(p) => { const say
= p.maps[...]...; say.text = say.text.replace(/\.$/, ' {name}.'); }`, the same "mutate one already-live
line" shape row 372-373's own `withItems`/`noItems` pair in `bankedbytes.test.js` already uses for a
different predicate) rather than adding a new page or command, so nothing else about the fixture's
compiled bytes moves between the two builds being differenced.

Rows 4-6, 7-9, 10-12 together triangulate `N`, `H`, `J` per board against **measured** bytes, with no
redundancy left unexplained: letting `A` = row 4-6's own measured delta (`N+J`), `B` = row 7-9's
(`N+H`), `D` = row 10-12's (`N+H+J`), `N = A + B - D`, `H = B - N`, `J = A - N` — the identical algebra
as before, now applied to nesasm's own numbers rather than to `kernelCodeBytes`'s own prediction of
them. Rows 13-15 then isolate `HT` the same, corrected way (X3, restated against measured bytes): row
13-15's own measured delta is `Delta(titleless)`, row 7-9's own measured delta is `Delta(titled)`, and
`HERO_NAMING_TITLELESS_KERNEL_ALLOWANCE = Delta(titleless) - Delta(titled)` — both measured deltas hold
the title term fixed within themselves (present in both configurations compared in row 7-9, absent from
both compared in row 13-15), so it cancels the same way whether the underlying numbers are predicted or
real. Rows 16-18 are the worst-case absolute check §4's own branch-range fix exists for — the exact gate
combination (naming + title + Save) that pushed `do_action`'s branches out of range in round 8's own
finding — proving the fix holds under real assembly, not just static count. **The two regions are held
to two different, region-appropriate accuracy bars here, not one shared rule — two sentences, since one
would misstate the other (Z4's own correction):** kernel-lo's real measured margin must sit inside
`assertCovers`'s own `[KERNEL_SLACK, KERNEL_SLACK * 2]` band — **non-negative remaining space alone does
not establish ledger accuracy** (a formula could under-reserve by exactly the amount that happens to
still leave `kernelFree >= 0`), so a bare sign check would not do. The banked region has no such band at
all: `bankedbytes.test.js`'s own discipline (`:346`, `assert.equal(used, predicted, ...)`) requires the
real measured usage to equal `battleRegionBytes`'s own prediction **exactly**, with its own comment
explaining why a margin check would be wrong there too ("a `<=` check here would let the base drift
upward silently") — the banked region's own model has no estimation error to absorb, since its tables
are counted off the real generator output rather than approximated the way the kernel-lo base is. X2's
own tables-alone-overflow regression is a separate correctness check, outside this 21-point isolation
matrix, since it does not measure a delta either.

**Do the two real RPG fixtures fit, with real margin? — re-measured post-phase-1, not re-derived by
hand.** §0's own kernel-lo headroom re-measurement (`loadProject` + `kernelCodeBytes` +
`kernelTableBytes`, the identical arithmetic `checkCapacity` performs) confirms `sample-rpg`'s own
headroom is untouched by phase 1 (it carries no Save command) and `sample-rpg-mmc1`'s moved by exactly
phase 1's own +3 `SAVE_KERNEL_ALLOWANCE_BY_MAPPER` shift, 524 → 521:

```
sample-rpg (titleless, both hero and Join naming, no Save):
  kernel-lo: 95 (shared) + 64 (Join) + 15 (hero) + 20 (hero, titleless hook)
             + 4 (input-row -- paid here because this fixture opts into naming, §4's own Y1 fix;
                  an RPG that did not opt in would pay 0 of this) = 198 bytes
             (P1-2's own needsHeroDefault correction (§8) means an RPG never charges
             HERO_DEFAULT_KERNEL_ALLOWANCE at all -- 198 is unchanged by that fix, but v13's own figure
             here was accidentally correct for the wrong reason: v13's own needsHeroDefault charged
             every hero-naming project this term, RPG included, which this arithmetic never actually
             added in -- a real omission P2-8(a) found, now resolved structurally rather than
             coincidentally)
             1283 bytes free (unchanged by phase 1, no Save command) -> 1283 - 198 = 1085 bytes free after

sample-rpg-mmc1 (titled, carries a Save command; Join naming only):
  kernel-lo: 95 (shared) + 64 (Join) + 4 (input-row -- same reasoning, paid because this fixture
             opts into Join naming) = 163 bytes
             (P2-8(b), round-1 finding: v13's own arithmetic added a THIRD term here, "+ 3
             (SAVE_FIELDS descriptor growth...)" -- double-charging phase 1's own +3
             SAVE_KERNEL_ALLOWANCE_BY_MAPPER cost, which is already folded into the post-phase-1
             headroom figure below (§0's own direct re-measurement, 524 -> 521, not derived by adding
             3 to a pre-phase-1 number by hand). This feature's own real, remaining cost against
             already-post-phase-1 headroom is 163, not 166.)
             521 bytes free post-phase-1 (was 524) -> 521 - 163 = 358 bytes free after

Both fixtures, banked:
  812 bytes needed
  sample-rpg:      3441 - 812 = 2629 bytes free after
  sample-rpg-mmc1: 3451 - 812 = 2639 bytes free after
```

Both RPG fixtures still fit, on both ledgers, with hundreds to low thousands of bytes of margin left
over. The banked figures (812 bytes needed, both fixtures' own 3441/3451-byte baselines) carry no
phase-1 or double-charge exposure at all — `SAVE_FIELDS`' own descriptor growth is a kernel-lo cost
only (`save.inc` is kernel-lo, not banked), so nothing about phase 1 ever touches this half of the
ledger, checked directly rather than assumed clean by the same P2-8 pass that found the two kernel-lo
errors above.

**Do the four action fixtures fit, with hero naming turned on — re-derived this round for P2-3's own
+11-byte correction.** Static estimate, the identical **857-byte** total on every board (`NAME_ENTRY_
KERNEL_ALLOWANCE` 95 + `NAME_ENTRY_ACTION_KERNEL_ALLOWANCE` 722 + `HERO_NAMING_KERNEL_ALLOWANCE` 15 +
`HERO_DEFAULT_KERNEL_ALLOWANCE` **21** (was 10 — P2-3, round-2 finding: the table's own 10 bytes plus
`init_session`'s own 11-byte copy loop, which had no allowance at all until this round) + the 4-byte
input row — none of the four action fixtures is titleless, so `HERO_NAMING_TITLELESS_KERNEL_ALLOWANCE`
never applies here), against each board's own real, re-measured post-phase-1 headroom (§0):

```
sample      (NROM,      1008 free, no Save): 1008 - 857 =  151 free  -- FITS
sample-mmc1 (MMC1,       812 free, live Save): 812 - 857 =  -45 short -- REFUSED
sample-mmc3 (MMC3,       613 free, live Save): 613 - 857 = -244 short -- REFUSED
sample-u512 (UNROM 512,  445 free, live Save): 445 - 857 = -412 short -- REFUSED
```

Every conclusion this table already supported still holds — `sample-mmc1` still refuses, not only
`sample-mmc3`/`sample-u512`, and `sample` (NROM) is still the one board with real margin, now **151**
bytes rather than 162 — the P2-3 correction moves every figure by exactly the same 11 bytes it adds to
the shared 857-byte total, since it is a flat term charged identically on every board, not a per-board
adjustment: `sample`'s own margin shrinks from 162 to 151, and each of the three refusals grows by
exactly 11 bytes short (34→45, 233→244, 401→412). None of P1-1 (the token's `text_type_step` listing,
§9a), P1-2 (the seed path, §3/§8), or P1-3 (`NAME_LEN`'s own emission, §5) touches any of these terms
either — `NAME_ENTRY_ACTION_KERNEL_ALLOWANCE` is the grid's own body, untouched by any of the three;
`NAME_ENTRY_KERNEL_ALLOWANCE`/`HERO_NAMING_KERNEL_ALLOWANCE`/the input row are hook glue and a
table-row count, neither touched by any P1 fix; only `HERO_DEFAULT_KERNEL_ALLOWANCE` moved, and only
because P2-3 gave its own previously-uncharged loop a home inside it. The action-side estimate was
never double-charged the way the RPG fixtures' own kernel-lo arithmetic was (P2-8b, v15's own round),
since each of the four action fixtures' own headroom figures in §0 is a direct, fresh measurement
against the current tree, not a hand-adjusted pre-phase-1 number. `sample`'s own remaining margin,
because its own `BASE_KERNEL_CODE_BYTES_BY_MAPPER` has no measured entry at all (§0) and NROM's own
kernel-lo code is genuinely smaller than any of the three save-capable boards' (`switch_prg_bank`/
`switch_chr_bank` are bare `rts` stubs there, CLAUDE.md's own "NROM is the degenerate case" passage) —
its **fallback** to the largest of the three measured figures (6217, UNROM 512's own) would
*understate* that margin if ever charged, not overstate it, so 151 bytes of headroom against an
unmeasured, conservatively-large base is a real result, not an artifact of the fallback being generous
in the wrong direction. **A real per-board measurement in phase 2 could still move any of these four
figures in either direction — nothing here is a final verdict on which boards can host action-side
hero naming, only this round's own honest static count against this round's own real headroom.**

**The hero-naming + token both-enabled case, asked for explicitly this round.** Turning the token on
alongside hero naming adds exactly one more term to the 857-byte sum — `NAME_TOKEN_KERNEL_ALLOWANCE`
(§9a), gated on `NAME_TOKEN_ENABLED` alone, independent of `HERO_NAMING_KERNEL_ALLOWANCE`/
`HERO_DEFAULT_KERNEL_ALLOWANCE` since nothing about the token's own gate reads hero naming's — so the
combined static total is **857 + `NAME_TOKEN_KERNEL_ALLOWANCE`**, not a fifth board-independent
constant of its own. That term is explicitly unmeasured (§9a: "flat until real variance is measured,"
phase 2b's own job), so this design states the honest thing it can state today rather than a number it
cannot yet back with a real assemble: `sample`'s own 151-byte margin is what the combination has left
to spend, and every other action board is already short before the token's own bytes are even added,
so turning the token on together with hero naming cannot newly break `sample-mmc1`/`sample-mmc3`/
`sample-u512` — they are refused already — but it is squarely what could turn `sample`'s own FITS into
a REFUSED once phase 2b's real number is in hand. Phase 2b's own report (§17) must check this specific
combination on `sample` before either feature ships together on an action project, the same
"measure, don't guess" instruction this whole ledger already holds every other term to.

**The absolute `assertCovers`-style check has no board to run against for NROM today, and that gap is
inherited, not new.** `CAPABLE_MAPPERS` (`test/unit/kernelbytes.test.js:87`,
`SUPPORTED_MAPPERS.filter(rpgCapable)`) excludes NROM by construction — every existing per-mapper
measured test in this file already only ever runs against MMC1/MMC3/UNROM 512, since the whole file was
built around `sample-rpg`. `sample` (NROM) has never had its own kernel-lo base absolutely measured by
this suite, naming or not, and `BASE_KERNEL_CODE_BYTES_BY_MAPPER`'s own fallback (`generate.js:655-658`,
`Math.max(...Object.values(BASE_KERNEL_CODE_BYTES_BY_MAPPER))`, currently `6217`) exists precisely so a
mapper with no measured entry still gets a safe, if imprecise, number rather than `NaN`. An absolute
worst-case check on `sample`/NROM (phase 2's own version of matrix rows 16-18, extended to the fourth
action board) is trustworthy today only up to that fallback's own honesty — real, but conservative in
the safe direction, per the paragraph above — and the durable fix, consistent with "a term stays flat
until real variance is measured," is a real, measured `BASE_KERNEL_CODE_BYTES_BY_MAPPER[0]` entry before
phase 2 leans on an absolute NROM check the way it already leans on the three RPG-capable boards'.

`KERNEL_SLACK` is not a statement about how much of the 8 KB bank remains unused — it is the floor
(and, at double its value, the ceiling) `assertCovers` (`test/unit/kernelbytes.test.js:238-257`) holds
the *combined, measured reservation's own accuracy* to, once every live term is counted — proof the
formula tracks nesasm's real usage closely, not a claim about spare bank space.

**`kernelShortfallAdvice`/`battleShortfallAdvice`** both correctly offer naming-removal candidates now
— kernel-lo's through the existing generic combination search, banked's through the hand-rolled
solo-then-both search matching HEAD's own lever-based shape, suppressed on the banked side whenever
`exact` is false per X2.

**`switchableMappers` (`generate.js:1223-…`) must re-check every candidate under both new kernel-lo
terms, not only the pre-existing four — no code change of its own, since it already asks `kernelCodeBytes`
what a candidate board would cost rather than re-deriving a list of terms by hand (CLAUDE.md's own
"asks the authorities rather than restating their rules" passage, quoted for this exact function
elsewhere in this codebase).** Because `NAME_ENTRY_ACTION_KERNEL_ALLOWANCE` and
`HERO_DEFAULT_KERNEL_ALLOWANCE` are two more terms `kernelCodeBytes` itself now returns, any caller that
already asks that function for a candidate's own total cost — which `switchableMappers` already does —
picks them up automatically, the identical "ask the authority, do not restate it" property this
function's own three-rule check (art in `$A0-$FF`, sprite tile `$FD`, a monster's battle-art block) was
specifically rewritten to hold to after missing three rules the hand-written way. One new wrinkle worth
naming rather than assuming away: a mapper switch that changes a project from `NAME_ENTRY_BANKED` to
kernel-lo placement, or back, changes *which* term applies (`NAME_ENTRY_ACTION_KERNEL_ALLOWANCE` versus
the banked ledger entirely) — `switchableMappers`' own existing `reconcileCartridge`-then-`validateProject`
two-question shape (does the switch change the project; would the result still build) already answers
this correctly with no special case, since `kernelCodeBytes(project, candidate)` is recomputed fresh for
each candidate mapper and will read `nameEntryBanked` (§4) as whatever is true *for that candidate*, not
carried over from the project's current mapper.

## §12. Cycle budget — the naming grid is one of the frozen-world four's own mutually exclusive arms,
not a fifth producer, and its own worst-case packet is bounded by the box's already-established rules

CLAUDE.md's own producer accounting: the frozen-world four (`move_tick`/`wait_tick`/`fade_tick`/
`text_tick`) are mutually exclusive among *themselves*, since only one game state can own the current
frame's `ui_tick` dispatch — flip and flash are two further, genuinely independent producers, giving a
worst case of three simultaneous packets (flip + flash + whichever of the frozen four is running),
81 of `vram_buf`'s 256 bytes.

**The naming grid does not add a fourth producer — it occupies `text_tick`'s own existing slot**,
reached the same way dialogue already is: `ST_NAMEENTRY` is `game_state`'s own distinct value (§4),
mutually exclusive with `ST_DIALOG`/`ST_MENU`/every other frozen-world state by construction (only one
`game_state` value is live on a given frame), and `ui_tick`'s own dispatch (§4's own hook) routes
`ST_NAMEENTRY` through `text_tick`, which then further dispatches into `BE_NAME_TICK` only when
`box_state == BOX_NAMEENTRY`. Naming's own two phases never overlap within a frame, mirroring the box's
own raise/interactive split exactly: while `box_row < BOX_TEXT_ROWS`, `nameentry_tick`'s own gate
(`lda box_row / cmp #BOX_TEXT_ROWS / bcs nameentry_tick_idle`) runs *only* `nameentry_raise_step`,
never the D-pad handling; once `box_row` reaches `BOX_TEXT_ROWS`, only the D-pad handling runs, never
the raise step.

**Byte cost, both phases.** `BOX_COLS = 28` (`shared/font.js:39`, confirmed this round rather than
assumed to be 32 — the message window is 4 rows of 28 characters, not 32):

- **Raising** (`nameentry_raise_step`, up to four frames, one row per frame): each row is a single
  packet, at most `BOX_COLS` (28) bytes of body plus a 3-byte header — **31 bytes**, identical in shape
  and size to the box's own existing row-raise producer (dialogue's own raise, or a question's own
  option list) that already occupies this exact slot today.
- **Interactive ticking** (`nameentry_write_cell`/`nameentry_delete`, via `nameentry_select`/
  `nameentry_cancel`): each queues exactly one packet, a single cell — 1-byte body plus a 3-byte
  header, 4 bytes — bounded to at most one per frame by `nm_acted`'s own per-frame latch (§4).

Since naming's own worst-case packet (31 bytes, during the raise) is no larger than what `text_tick`'s
own existing producers already cost in that same dispatch slot, substituting naming into it changes
neither the byte-count nor the cycle-count ceiling CLAUDE.md's own three-producer worst case (81 bytes)
already established — the worst single frame combination remains flip + flash + whichever frozen-world
producer (dialogue, a question, or now naming) is running, unchanged in magnitude. **The "roughly
1670-1740 cycles" figure is CLAUDE.md's own *two*-producer measurement (flash plus one coincident
frozen-world producer, two 32-byte-class packets, the OAM DMA, and both register save/restore) — it is
not itself a measurement of the three-producer case naming now joins.** CLAUDE.md is explicit that the
three-producer bound (flip + flash + one of the frozen four) is established separately, against real
Mesen timing, by `test/lua/bound_tile_nmi_timing.lua.template` — not re-derived by hand from the
two-producer figure — so this design does the same rather than borrowing a number measured for a
different combination: naming's own worst-case frame is covered by that same existing three-producer
timing proof once it is re-run with a naming-driven frame substituted for the frozen-world slot,
exactly as CLAUDE.md's own closing line already requires of any change to this accounting ("a fourth
independent producer must re-open this accounting again, not assume it still holds" — naming is not a
fourth producer, so the existing three-producer proof's own byte/cycle shape already covers it, but the
timing test itself should still be run once for a naming-carrying frame to confirm the substitution
holds in practice, not merely in the byte count). A fourth *genuinely independent* producer — one that
could land on the same frame as naming rather than replacing one of the four — is not introduced by
this feature, and this section's own arithmetic would need reopening the day one is.

**The Say token (§9a, D7) adds nothing to this accounting beyond what it already covers.** The token
types at most one glyph per frame — `text_type_name`'s own draw arm runs exactly once through
`text_type_step`, the same one-call-per-frame rate every other control byte in this same routine
already runs at — so a message carrying `{name}` costs no more of `text_tick`'s own producer slot than
the identical number of ordinary characters would; the token does not introduce a new packet shape, a
larger one, or a second draw within the same frame. `text_put_char`'s own `vram_open`/`vram_push`/
`vram_end` sequence, called once per token-glyph frame, is byte-for-byte the same packet
`text_type_glyph` already queues for an ordinary character — one glyph, one 4-byte packet (3-byte
header, 1-byte body) — so the worst-case arithmetic against the ~2273-cycle vblank window is entirely
unchanged: the token is not a new case for that arithmetic to cover, it is the *existing* dialogue-typing
case, with a different byte source selected ahead of time (§9a's own one-time pointer swap, itself not
a VRAM producer at all — a zero-page store, not a queue write).

## §13. UI — a new Sprite Forge Player tab (both game types), the Map Forge join-row checkbox and
summary suffix, with real code for both, modeled on this codebase's own existing patterns rather than
invented

**v12's own location does not exist for an action project — confirmed this round, not assumed, and a
new tab is the fix, not a relocation of an existing one.** `renderer/forges/sprite/sprite.js`'s own tab
list (`renderTabs`, `:1191-1212`) is `metasprites` / `animations` / `actors`, plus `party` **only**
when `store.project.project.gameType === 'rpg'` (`:1196-1199`) — v12's checkbox lived inside that
`party` tab's own panel (`renderer/forges/sprite/battle.js`'s `partyPanel`), which an action project
therefore never renders at all. No other panel anywhere in this renderer edits a project-level (not
per-actor) fact about "the player" for both game types today (§0) — `titleMap` lives in the Map Forge,
`maxHearts` has no UI yet at all — so this needs a genuinely new home, not a relocated existing one.
**A new `player` tab, unconditional, first in the list** (the player exists before anything else does,
on either game type):

```js
// renderer/forges/sprite/sprite.js, renderTabs' own tab array, corrected
[
  ['player', 'Player'],
  ['metasprites', 'Metasprites'],
  ['animations', 'Animations'],
  ['actors', 'Actors'],
  ...(store.project.project.gameType === 'rpg' ? [['party', 'Party']] : [])
]
```

```js
// renderer/forges/sprite/sprite.js's render(), corrected dispatch -- the
// same shape the existing party/metasprites/animations/actors branches use
const player = state.tab === 'player';
const party = state.tab === 'party';
editStage.style.display = player || party ? 'none' : '';
partyHost.style.display = party ? '' : 'none';
playerHost.style.display = player ? '' : 'none';
if (player) renderPlayerPane();
else if (state.tab === 'metasprites') renderMetaspritePane();
else if (state.tab === 'animations') renderAnimationPane();
else if (party) renderPartyPane();
else renderActorPane();
```

**`renderPlayerPane()`, a new module (`renderer/forges/sprite/player.js`), mirroring `battle.js`'s own
`partyPanel` shape (one exported function, `(rerender, app) => Node`, `store.commit` on change, the
identical `el('label.check', ...)` checkbox this codebase already uses for every other boolean toggle
— `battle.js:87-95`'s own "Starts in the party" row, cited verbatim as the pattern this follows rather
than invented fresh) — the hero-naming checkbox and the `heroName` field, both project-level, both
present on either game type:**

**P2-7: the "Default name" field is action-only — on an RPG it edits a value nothing reads.**
`needsHeroDefault` (P1-2's own correction, §8) is `gameType !== 'rpg' && (usesHeroNaming ||
usesNameToken)` — an RPG's own default always comes from `party[0].name` through the banked `pc_name`
table (P1-2), never `hero_name_default`, so a `heroName` control that stayed editable on an RPG would
change the preview (P2-6) and nothing else a real build ever reads — the exact defect this finding
names. The field is shown only for an action project; an RPG sees `party[0].name` instead, read-only,
with a hint pointing at where it is actually edited:

```js
// renderer/forges/sprite/player.js
export function playerPanel(rerender) {
  const project = store.project;
  const isRpg = project.project.gameType === 'rpg';
  return el(
    'div',
    null,
    el('div.panel-head', { style: { paddingLeft: '0' } }, 'Player'),
    el(
      'label.check',
      { title: 'The player types this name at the start of a new game' },
      el('input', {
        type: 'checkbox',
        checked: Boolean(project.project.nameHeroAtStart),
        onchange: (event) => {
          store.commit('Change hero naming', (draft) => {
            draft.project.nameHeroAtStart = event.target.checked;
          });
          rerender();
        }
      }),
      ' Player names the hero at the start'
    ),
    isRpg
      ? el(
          'div.field-row',
          null,
          el('span.field-label', null, 'Default name'),
          el('span', null, project.party[0]?.name ?? 'Hero'),
          el('p.hint', null, 'Edited on the Party tab — the hero is party member 1 there.')
        )
      : el(
          'label.field-row',
          null,
          el('span.field-label', null, 'Default name'),
          el('input.input', {
            type: 'text',
            maxlength: RPG_LIMITS.nameLength,
            value: project.project.heroName,
            onchange: (event) => {
              store.commit('Change hero default name', (draft) => {
                draft.project.heroName = event.target.value; // clamped by normalizeProject on save
              });
              rerender();
            }
          })
        ),
    isRpg
      ? null
      : el('p.hint', null, 'A-Z and a-z only, up to 10 letters — the same alphabet the in-game grid offers.')
  );
}
```

`el()`'s own null-skipping (CLAUDE.md's "Conventions" section) is what lets the trailing hint disappear
cleanly on an RPG rather than showing an empty paragraph — the one place in this panel the pattern is
actually exercised, unlike v12's own per-member row, which this panel otherwise has no equivalent of:
this is not a per-row list, it is the whole content of an unconditional tab, so there is no `index ===
0 ? ... : null` branch to write at all; the RPG-only concern that branch existed for (only member 0
gets the checkbox) is now moot, since there is no
per-member list here in the first place.

**The Map Forge's join-row checkbox and summary suffix** (`renderer/forges/map/events.js`), added
beside the existing member `<select>` (`:1527-1559`) and the existing `join` case in the summary-line
switch (`:333-336`):

```js
// events.js's per-command control builder, join case, appended after the
// existing member <select>
} else if (command.op === 'join') {
  const party = context.party ?? [];
  controls.push(
    el('select', { /* unchanged member select */ }),
    el(
      'label.check',
      { title: 'Show the naming grid the moment this member joins' },
      el('input', {
        type: 'checkbox',
        checked: Boolean(command.named),
        onchange: (fired) => { command.named = fired.target.checked; }
      }),
      ' Named'
    )
  );
}
```

```js
// events.js's summary-line switch, join case, corrected
case 'join':
  return partyMemberMissing(party, command.member)
    ? 'Join (missing member)'
    : `${party[command.member].name} joins the party${command.named ? ', named by the player' : ''}`;
```

`defaultCommand`'s own per-arg default switch (`:194-197`) gains `else if (arg === 'named') out.named =
false;`, reachable only because `'named'` now appears in `EVENT_COMMANDS`'s own `join.args` (§7's own
X1 fix) — the identical dependency the schema normalizer has on the same array. `validateProject` gains
no new check: an unresolved `named` Join is refused for the same, pre-existing reason a plain
unresolved Join already is (a missing/out-of-range member), with no naming-specific case needed.

**The Controller Forge's own hero-gated row** is §9's own `bindableStates` change, cross-referenced
rather than repeated here — `nameentry` only ever appears as an editable row when
`projectUsesHeroNaming(project)` is true, since Join-only naming never puts `ST_NAMEENTRY` on screen at
all (a Join names the party member entirely within `ST_DIALOG`, per §7 — not `ST_GAMEPLAY`, corrected
this round).

## §14. Test infrastructure — every helper written out in full, keyed to the real, asymmetric movement
rules §6 documents, plus the RPG save fixture's own new Lua phases

**Every constant this file needs, taken from real addresses (§2) and real, already-confirmed values —
no placeholders**, alongside this file's own existing `// engine/constants.asm` block
(`test/unit/rpg.test.js:194-196`'s own precedent for how this file names a raw address):

```js
// engine/constants.asm
const BOX_ROW = 0x41;        // box_row (:105)
const BOX_TEXT_ROWS = 4;     // (:971)
const NM_LEN = 0x059a;       // §2
const NM_ROW = 0x059b;       // §2
const NM_COL = 0x059c;       // §2
const PC_NAME_RAM = 0x0571;  // §2
const NAME_LEN = 10;         // RPG_LIMITS.nameLength
const ST_NAMEENTRY = 6;      // engine/constants.asm, appended after ST_BATTLE (§4)
const BOX_NAMEENTRY = 9;     // §4 -- appended after BOX_CHOICEWAIT (:1008)
const BOX_NAMEDONE = 10;     // §4
```

**Z2's own correction, restated so it is not missed again: round 10's own listing declared these six but
silently referenced two more — `ST_NAMEENTRY` inside `bootPastNaming` and `NAME_LEN` inside
`clearName`'s own bound — neither of which existed anywhere in that round's own constant block,
producing a real `ReferenceError` the moment either helper actually ran.** Both are added above,
following this file's own existing provenance-comment convention (`test/unit/rpg.test.js:194-196`,
`// engine/constants.asm` for a raw address, a plain citation for a derived limit). Every remaining
identifier the five helpers below use — `BOX_STATE`/`GAME_STATE`/`A`/`B`/`DOWN`/`RIGHT`/`ROM_PATH`/
`ST_GAMEPLAY`/`BOX_PAGEWAIT`/`BOX_ENDWAIT` — is one of this file's own pre-existing constants, re-checked
this round by walking every helper's own body and confirming each name it reads resolves to something
declared either here or already in the file.

`GAME_STATE`/`BOX_STATE` are the file's own existing constants (`:36`, `:40`) — no new ones are needed
for either, since **readiness is a `box_state`/`box_row` question, never a `game_state` one (Y2's own
correction)**: a hero's own naming session runs with `game_state === ST_NAMEENTRY`, but a named Join's
own session runs entirely inside `game_state === ST_DIALOG` (§7) — the two never agree on `game_state`,
so any helper that checked it would work for one and silently time out for the other, which is exactly
what round 9's own `namingReady()` did.

**Navigation helpers, written defensively against §6's own asymmetric UP/DOWN ring and every loop
explicitly bounded with its own assertion on exhaustion** — the `talkThrough` shape (`:178-192`, a
budget plus a final assertion, never a bare `while`):

```js
/** True once the grid has finished raising and nm_row/nm_col are live -- true
 *  for a hero session (game_state === ST_NAMEENTRY) and a Join session
 *  (game_state stays ST_DIALOG) alike, since box_state is the one signal
 *  both paths actually set (§4, §7). */
function namingReady(nes) {
  return nes.cpu.mem[BOX_STATE] === BOX_NAMEENTRY && nes.cpu.mem[BOX_ROW] >= BOX_TEXT_ROWS;
}

function waitForNamingReady(nes, budget = 40) {
  for (let i = 0; i < budget && !namingReady(nes); i++) nes.frame();
  assert.ok(namingReady(nes), 'the naming grid never finished raising');
}

/**
 * Move the grid cursor to (row, col). DOWN's own ring (row 0 -> 1 -> 2 -> 0,
 * §6) visits every row in the same forward order regardless of where it
 * starts, so it -- never UP, whose own ring takes a different path -- is what
 * a shared row-seeking helper can rely on without special-casing the start
 * row. RIGHT's own wraparound is likewise uniform on every row (26-wide on
 * rows 0/1, a 2-way toggle on row 2), so the same counted-loop shape works
 * for the column too. Both loops are bounded and assert on exhaustion, never
 * looping past a budget silently.
 */
function gotoCell(nes, row, col) {
  for (let i = 0; i < 3 && nes.cpu.mem[NM_ROW] !== row; i++) tap(nes, DOWN);
  assert.equal(nes.cpu.mem[NM_ROW], row, 'the naming grid cursor never reached that row');
  for (let i = 0; i < 26 && nes.cpu.mem[NM_COL] !== col; i++) tap(nes, RIGHT);
  assert.equal(nes.cpu.mem[NM_COL], col, 'the naming grid cursor never reached that column');
}

/** Delete every already-committed letter, from wherever the cursor sits. Bounded
 *  at NAME_LEN presses -- one per possible committed letter -- with its own
 *  assertion, never an unbounded while. */
function clearName(nes) {
  gotoCell(nes, 2, 0); // DEL
  for (let i = 0; i < NAME_LEN && nes.cpu.mem[NM_LEN] > 0; i++) tap(nes, A);
  assert.equal(nes.cpu.mem[NM_LEN], 0, 'DEL never emptied the name');
}

/** Clear the seeded default, type `text` (A-Z/a-z only), then select END. */
function typeNameAndFinish(nes, text) {
  waitForNamingReady(nes);
  clearName(nes);
  for (const ch of text) {
    const upper = ch !== ch.toLowerCase();
    const row = upper ? 0 : 1;
    const col = ch.toUpperCase().charCodeAt(0) - 65; // 'A'-'Z' -> 0-25
    gotoCell(nes, row, col);
    tap(nes, A); // Confirm -> nameentry_select -> commits this letter
  }
  gotoCell(nes, 2, 1); // END
  tap(nes, A);
  for (let i = 0; i < 20 && nes.cpu.mem[BOX_STATE] === BOX_NAMEDONE; i++) nes.frame();
  assert.notEqual(nes.cpu.mem[BOX_STATE], BOX_NAMEDONE, 'the naming session never handed off after END');
}

/** Boot, then clear any hero-naming session with the default seeded name
 *  untouched. game_state gates the OUTER check correctly here -- this helper
 *  only ever runs immediately after boot, before any event (a Join included)
 *  could possibly be live, so ST_NAMEENTRY unambiguously means "this project
 *  has hero naming and it just triggered," never a Join's own session. */
function bootPastNaming(romPath = ROM_PATH, frames = 40) {
  const nes = boot(romPath, frames);
  if (nes.cpu.mem[GAME_STATE] === ST_NAMEENTRY) {
    waitForNamingReady(nes);
    gotoCell(nes, 2, 1); // END, leaving the seeded default name exactly as compiled
    tap(nes, A);
    for (let i = 0; i < 20 && nes.cpu.mem[GAME_STATE] === ST_NAMEENTRY; i++) nes.frame();
    assert.notEqual(nes.cpu.mem[GAME_STATE], ST_NAMEENTRY, 'the hero naming session never ended');
  }
  return nes;
}
```

Every `= boot(` call site in `test/unit/rpg.test.js` that is not itself testing the naming grid switches
to `bootPastNaming()`. **`talkThrough` (`:178-192`) gains a naming check ahead of, not instead of, its
own `BOX_PAGEWAIT`/`BOX_ENDWAIT` loop, since a named Join's own session opens mid-conversation, before
the box would otherwise reach either wait state:**

```js
// test/unit/rpg.test.js's talkThrough, corrected -- checked once per loop
// iteration, before the existing BOX_PAGEWAIT/BOX_ENDWAIT wait
function talkThrough(nes, budget = 30) {
  tap(nes, B);
  for (let press = 0; press < budget; press++) {
    if (nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY) return true;
    for (let frame = 0; frame < 600; frame++) {
      const box = nes.cpu.mem[BOX_STATE];
      if (box === BOX_NAMEENTRY) return false; // a named Join opened -- caller
                                                // must drive it with typeNameAndFinish
      if (box === BOX_PAGEWAIT || box === BOX_ENDWAIT || nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY) break;
      nes.frame();
    }
    if (nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY) return true;
    if (nes.cpu.mem[BOX_STATE] === BOX_NAMEENTRY) return false;
    tap(nes, A);
    for (let i = 0; i < 20; i++) nes.frame();
  }
  return nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY;
}
```

A caller driving a named-Join conversation therefore calls `talkThrough` (which returns `false` the
moment the grid opens, pressing nothing further into it), then `typeNameAndFinish`, then — since ending
the naming session resumes the very same conversation script via `script_resume` (§8) — `talkThrough`
again for whatever the script does after the Join, mirroring how any other mid-conversation suspend in
this engine is already driven one segment at a time.

**`test/lua/save_sram.lua` needs its own constant declarations — JavaScript's do not define Lua
globals (Z2's own correction) — none of which exist in this file today**, confirmed this round by
grepping the file for each name before assuming any of them were already there. Added alongside the
file's own existing address block (`:110-127`'s shape, one `local NAME = 0xHEX` per line):

```lua
local BOX_STATE   = 0x40
local BOX_ROW     = 0x41
local BOX_AFTER   = 0x7B
local NM_LEN      = 0x059A
local NM_ROW      = 0x059B
local NM_COL      = 0x059C
local PC_NAME_RAM = 0x0571

local BOX_TEXT_ROWS = 4
local BOX_NAMEENTRY = 9
local NAME_LEN       = 10
```

**`test/lua/save_sram.lua`'s own new logic, at its two real insertion points, written out in full, and
corrected this round for a real "too late" defect (Z1).** The Continue snapshot this fixture's own
restored-name assertion piggybacks on is captured in phase 2 (`:290`, the `restored = {...}` table
built the first time `game_state` is observed off `ST_TITLE` after Continue); naming interception
belongs inside phase 3.3 (`:395`), the saver's own touch-triggered page, **before** its existing
dialogue check at `:410`.

**Round 10's own mistake was checking `box_state == BOX_NAMEENTRY` at this point, which is too late.**
`box_begin` (`engine/text.asm:183-184`) stores the *requested* phase into `box_after` as its very first
instruction — `sta box_after` — before `box_state` itself becomes anything but `BOX_OPENING` (a fresh
box) or `BOX_CLEARING` (an already-open one being reused); `box_state` does not actually reach
`BOX_NAMEENTRY` until `box_handover` completes the raise, several frames later. But `game_state` is
already `ST_DIALOG` from the very start of the whole touch-triggered page (`start_dialog`, well before
the Join ever runs), so the *existing* `if read(GAME_STATE) == ST_DIALOG` check at `:410` would already
be satisfied on nearly the very first post-touch frame — sending the test into the Say-dismissal phase
(3.4, blind A-pulsing) before `box_state` ever reaches `BOX_NAMEENTRY` at all. `box_after` is the fix:
it is set synchronously, the same frame the Join requests naming, strictly before `box_state` changes
and strictly before the existing `ST_DIALOG` check could misfire:

```lua
-- Inserted into phase 3.3, immediately after the existing saveWritten() early
-- return and before the existing `if read(GAME_STATE) == ST_DIALOG` check.
-- box_after, not box_state, is checked here -- box_state lags behind it by
-- several frames (the raise), during which the existing ST_DIALOG check
-- below would already have claimed the frame for Say-dismissal otherwise.
if read(BOX_AFTER) == BOX_NAMEENTRY then
  held = {}
  mark = frame
  phase = 3.31
  return
end

-- 3.31: wait for the grid to finish raising -- box_state == BOX_NAMEENTRY
-- AND box_row >= BOX_TEXT_ROWS, the same two-part readiness gate §4/§14's own
-- JS helper (namingReady()) uses. box_row alone is not enough: box_begin's
-- own BOX_OPENING/BOX_CLEARING raise (engine/text.asm:319) also advances
-- box_row before box_handover (:433) resets it back to 0 and hands box_state
-- over to the real requested phase, so box_row can already read >=
-- BOX_TEXT_ROWS from the box's own opening/clearing raise, well before
-- BOX_NAMEENTRY is actually live.
if phase == 3.31 then
  if read(BOX_STATE) == BOX_NAMEENTRY and read(BOX_ROW) >= BOX_TEXT_ROWS then
    mark = frame
    phase = 3.32
    return
  end
  if frame - mark > 40 then fail(EXIT_NAMING_NEVER_READY, "the naming grid never finished raising"); return end
  return
end

-- 3.32: clear the seeded default. Pulsed DOWN (4-frame cycle, matching phase
-- 3.4's own idiom below) drives the cursor to the controls row, then pulsed
-- RIGHT selects DEL if END is currently highlighted, then pulsed A presses
-- DEL until nm_len reaches zero.
if phase == 3.32 then
  local cycle = (frame - mark) % 12
  local pressing = cycle < 4
  if read(NM_ROW) ~= 2 then
    held = pressing and { down = true } or {}
  elseif read(NM_COL) ~= 0 then
    held = pressing and { right = true } or {}
  elseif read(NM_LEN) > 0 then
    held = pressing and { a = true } or {}
  else
    held = {}
    mark = frame
    phase = 3.33
    return
  end
  if frame - mark > 400 then fail(EXIT_NAMING_NEVER_READY, "DEL never emptied the seeded default"); return end
  return
end

-- 3.33: type "I" -- row 0 (A-Z), column 8 ('I' is the ninth letter, 0-indexed).
if phase == 3.33 then
  local cycle = (frame - mark) % 12
  local pressing = cycle < 4
  if read(NM_ROW) ~= 0 then
    held = pressing and { down = true } or {} -- from row 2, DOWN wraps to row 0
  elseif read(NM_COL) ~= 8 then
    held = pressing and { right = true } or {}
  else
    held = pressing and { a = true } or {}
    if read(NM_LEN) == 1 then
      held = {}
      mark = frame
      phase = 3.34
      return
    end
  end
  if frame - mark > 400 then fail(EXIT_NAMING_NEVER_READY, "'I' was never committed"); return end
  return
end

-- 3.34: select END, then wait for the Save behind it to land -- ending the
-- naming session resumes the suspended script (script_resume, §8), which
-- runs the page's own trailing Save command.
if phase == 3.34 then
  local cycle = (frame - mark) % 12
  local pressing = cycle < 4
  if read(NM_ROW) ~= 2 then
    held = pressing and { down = true } or {}
  elseif read(NM_COL) ~= 1 then
    held = pressing and { right = true } or {}
  else
    held = pressing and { a = true } or {}
  end
  if saveWritten() then
    held = {}
    mark = frame
    phase = 4
    return
  end
  if frame - mark > 400 then fail(EXIT_SAVE_NEVER_WROTE, "the save never landed after naming"); return end
  return
end
```

**The same `box_after` check is also kept inside phase 3.4 itself (the pre-existing Say-dismissal path),
not only ahead of it — the literal "keep the same detection inside the dialogue-advance path" the brief
asks for.** `sample-rpg-mmc1`'s own page today has no Say before its Join, so phase 3.4 is never reached
for this fixture's own real content once the `box_after` check above intercepts the Join directly from
phase 3.3. But the general engine allows a Join to follow a Say in any authored conversation (§7), and
this Lua script's own dialogue-advance phase already exists to dismiss exactly such a Say — if it ever
ran against content shaped that way, it must hand off to the naming phases the instant the Say closes
and a named Join opens the grid right behind it, rather than continuing to blindly pulse A into a
raising or interactive grid forever until its own budget expires:

```lua
-- Inserted at the top of the existing phase 3.4 body, before its own pulsed-A
-- logic -- general-purpose: this fixture's own real content never reaches
-- phase 3.4 at all once the box_after check above catches its Join directly,
-- but a Join following a Say in some other authored page would land here
-- once the Say closes, and must be handed off the same way.
if phase == 3.4 then
  if read(BOX_AFTER) == BOX_NAMEENTRY then
    held = {}
    mark = frame
    phase = 3.31
    return
  end
  -- ... the existing pulsed-A / saveWritten() body, unchanged, follows here
end
```

`EXIT_NAMING_NEVER_READY` is a new exit code, alongside the file's own existing `EXIT_*` constants, for
a naming-specific timeout distinct from `EXIT_SAVE_NEVER_WROTE` so a failure here is diagnosed as a
grid problem rather than a save problem.

**The 10-byte-per-slot snapshot and comparison.** Phase 2's own `restored = {...}` table (`:290-…`)
gains one more field, read the same way `restored.pcLevel1`/`restored.pcHpMax1` already are (party
slot 1 is "Iris," the saver page's own recruit, `member 1`):

```lua
-- Inside phase 2's restored = {...} table, beside the existing pcInParty1/
-- pcLevel1 fields
pcName1 = {
  read(PC_NAME_RAM + 1 * NAME_LEN + 0), read(PC_NAME_RAM + 1 * NAME_LEN + 1),
  read(PC_NAME_RAM + 1 * NAME_LEN + 2), read(PC_NAME_RAM + 1 * NAME_LEN + 3),
  read(PC_NAME_RAM + 1 * NAME_LEN + 4), read(PC_NAME_RAM + 1 * NAME_LEN + 5),
  read(PC_NAME_RAM + 1 * NAME_LEN + 6), read(PC_NAME_RAM + 1 * NAME_LEN + 7),
  read(PC_NAME_RAM + 1 * NAME_LEN + 8), read(PC_NAME_RAM + 1 * NAME_LEN + 9)
}
```

with `PC_NAME_RAM = 0x0571` and `NAME_LEN = 10` added beside this file's own existing address
constants. Phase 6's own comparison block (`:523-…`, the same block that already checks
`restored.pcLevel1`) gains the byte-exact assertion, against the real, computed tile ids for `'I'` and
space (`charToTile('I') = 0xc9`, `charToTile(' ') = 0xa0`, both confirmed against `shared/font.js`'s
own `charToTile` this round rather than guessed):

```lua
-- Inside phase 6, beside the existing pcLevel1/pcHpMax1 checks
local expectedName1 = { 0xc9, 0xa0, 0xa0, 0xa0, 0xa0, 0xa0, 0xa0, 0xa0, 0xa0, 0xa0 } -- "I" + 9 spaces
for i = 1, 10 do
  if restored.pcName1[i] ~= expectedName1[i] then
    fail(EXIT_RESTORED_STATE_WRONG, "pc_name_ram slot 1 byte " .. i .. " restored as " .. restored.pcName1[i])
    return
  end
end
```

`tools/make-rpg-save-sample.js`'s own existing `{ op: 'join', member: 1 }` (`:230`) gains `named: true`
— the one, minimal content change this whole mechanism exists to exercise (§19's own open question 5).

**Every JS helper above already works unchanged for the action side — checked, not assumed.** `boot`,
`bootPastNaming`, `namingReady`, `waitForNamingReady`, `gotoCell`, `clearName` and `typeNameAndFinish`
read only `GAME_STATE`/`BOX_STATE`/`BOX_ROW`/`NM_ROW`/`NM_COL`/`NM_LEN` — plain kernel RAM addresses,
identical whether the code writing them lives banked or in kernel-lo (§5) — and none of them branches on
`gameType` or any RPG-specific fact. `test/unit/nameentry.test.js` (phase 1's own file, holding the six
fixture-hash pins, §15) is where an action-side test needs these helpers from, so it gains its own copy
of this file's constant block and the same five/six functions verbatim, per this codebase's own
per-file-duplication convention — `test/unit/project.test.js:6435`'s own comment on its own duplicated
`reorderBoot`/`reorderTap` states the rule directly: "every other ROM-booting test file duplicates its
own `boot`, never imports one from a sibling file."

## §15. Tests, named with what each catches — the wrong implementation each one rules out, per the
original brief's own requirement, restored in full

Every test below names its own destination file, per the original brief's own requirement.

**Phase 1 (the save migration alone):**

- *`SAVE_FIELDS`'s new entry and `SAVE_LAYOUT_VERSION` 3, all six fixture ROMs re-hashed.*
  (`test/unit/samplegen.test.js`, beside its own existing per-fixture SHA-256 pins.) Catches: a
  descriptor emitted in the wrong table, or a version bump that only bumps the constant without
  actually changing any fixture's compiled bytes (a stale pin would silently keep passing).
- *A pre-migration save is rejected by the version bump alone, with no naming code present yet.*
  (`test/unit/rpg.test.js`, beside `SAVE_LAYOUT_VERSION`'s own existing rejection test.) Catches:
  `save_check_valid` comparing only the size-derived identity fields (`saveIdentity`) and missing the
  version byte, which would accept a foreign-shaped record that merely happens to be the same length.

**Phase 2 (the gated engine core):**

- *Preserved-baseline leak test: a naming-off project's ROM is byte-identical to the pre-feature
  baseline, six fixtures, SHA-256.* (`test/unit/samplegen.test.js`, the `move.test.js`/`routes.test.js`
  shape.) Catches: any `.if NAME_ENTRY_ENABLED` gate this design specifies that was actually left
  unconditional, or a shared routine (`party_join`'s copy loop, `battle_entry`'s dispatch, or
  `input_actions`'s own row count, §4's own Y1 fix) that grew even when the feature is off.
- *`do_action`'s own dispatch chain assembles correctly, every branch in range, under naming+title+Save
  all enabled (§4's own worst-case gate combination, matrix row 16-18).* (`test/unit/kernelbytes.test.js`,
  a real build via `measureCodeBytes`.) Catches: the exact regression round 8 found — a branch pushed
  past ±127 bytes by unrelated code inserted between it and its target, which a naming-only or
  naming+title-only build would never trigger, since only the fully-loaded combination reaches the
  range limit.
- *`battle_entry`'s naming-off dispatch assembles to exactly today's `jmp party_restore`, byte for
  byte.* (`test/unit/bankedbytes.test.js`, a real build via `measureRegion`.) Catches: the
  comparison/branch pair sitting outside its own `.if` (round 7's own defect) — an undefined-symbol
  assembler error on a naming-off build, or four unconditional extra bytes.
- *`BATTLE_REGION_SOURCES`'s own existing override test extends to `nameentry.asm` automatically.*
  (`test/unit/bankedbytes.test.js:1154-1213`, the existing generic test — no new test code, per §5.)
  Catches: `nameentry.asm` being reachable from `battle.asm` without being registered, which would let
  an override of it be silently treated as measured stock code rather than unknown-size code.
- *The bit-packed Join operand and its mask, including the `$05`-aliasing regression (`and #$7f`, never
  `and #$03`).* (`test/unit/rpg.test.js`, patching a built ROM's own compiled operand byte, the same
  technique the existing `BE_JOIN` guard tests already use.) Catches: a narrower mask folding a stale,
  out-of-range operand into a valid-looking member index rather than refusing it.
- *`EXCEPTIONAL_WIDTHS`'s own `join: 2` entry, proven against a real compiled Join with `named: true`
  and one with `named: false`.* (`test/unit/project.test.js`, beside the existing `EVENT_COMMANDS`
  corpus that already exercises `test/lib/eventdecoder.js`.) Catches: the generic `1 + args.length`
  fallback silently mispredicting the wire width the moment `args` grew to two entries, which would
  desynchronize `decodeBody`'s own cursor and corrupt every command decoded after it in the same event.
- *A typed name, read back from `pc_name_ram` after `typeNameAndFinish`.* (`test/unit/rpg.test.js`.)
  Catches: the write-cell routine writing to the wrong stride offset, or `nm_len` not actually
  advancing.
- *The drawn grid's own nametable content — letters, preview row, controls row — matches the expected
  tile ids at the expected addresses.* (`test/unit/rpg.test.js`, reading the nametable the same way
  `name_offset_pc`'s own two regression tests already do.) Catches: `nameentry_draw_letters`'s own
  base-tile arithmetic being off by one glyph, which would silently draw the wrong letter under a
  correctly-positioned cursor.
- *Cursor OAM position, at least one cell per row.* (`test/unit/rpg.test.js`.) Catches:
  `nameentry_cursor_x`'s own two-branch (letter vs. control) column formula disagreeing with where the
  corresponding tile was actually drawn.
- *DEL reached both via the grid cell and via the Cancel action, from the same starting name, produce
  identical `pc_name_ram` contents afterward.* (`test/unit/rpg.test.js`.) Catches: the two paths
  diverging because one was wired to a different routine (or a copy of one) rather than the single
  shared `nameentry_delete`.
- *`nm_acted`'s own per-frame latch: two button presses queued on the same frame produce exactly one
  grid action, not two.* (`test/unit/rpg.test.js`.) Catches: `nameentry_select`/`nameentry_cancel`
  missing their own `lda nm_acted / bne ... / lda #1 / sta nm_acted` guard, which would let a single
  frame both type a letter and delete it (or select END and immediately un-delete it) depending on
  dispatch order.
- *The `BOX_NAMEDONE` mechanism: `nameentry_select_end` sets the flag and returns without calling
  `script_resume` directly.* (`test/unit/rpg.test.js`, the `BOX_NAMEDONE` Wait/Move regression shape
  the original brief's own predecessor rounds already established.) Catches: a return-through-the-
  trampoline violation — calling `script_resume` from inside the banked routine would skip
  `call_battle`'s own restore step (`jmp set_screen_ptr`), leaving the field's screen bank pointed at
  whatever the naming bank last set.
- *DOWN then UP from row 0 returns the cursor to its exact starting cell; UP then DOWN from row 0 does
  NOT, unless it started at column 0 (§6's own corrected, documented asymmetry).* (`test/unit/
  rpg.test.js`.) Catches: a future simplification that makes UP mirror DOWN exactly, silently changing
  the "one-press shortcut to the controls row" behavior this design deliberately built in, without
  anyone deciding to change it — and, in the other direction, a regression that broke the row 0↔row 1
  round trip this design relies on for ordinary navigation.
- *MMC3 split coverage over the naming grid — a real framebuffer probe, not a source-text scan (Y4's
  own correction), driving BOTH hero naming and a named Join, not hero naming alone (Z3's own
  correction to Y4).* (`test/unit/split.test.js`, alongside its own existing `'the title bands and the
  message box draw glyphs...'` test, `:228-…`, using the same `buildVariant`/`boot`/`probe`/`probeKind`
  helpers, and `SAMPLE_RPG` (`:34`), which this file already builds a variant from for its own
  `'an MMC3 battle splits...'` test, `:270`.) **The "above the box" probe is row 2, matching the
  existing test's own established probe exactly** — not row 24, which is the box's own **top border**
  (`engine/constants.asm:959`, "the box is the bottom six tile rows, 24-29") and is exactly where the
  split program switches the font bank *in* (`engine/split.asm:53`, `split_prog_box`'s own comment:
  "font in at the box's top border row") — row 24 is legitimately `'font'`, not `'art'`, and asserting
  otherwise would reject correct behavior, per round 10's own finding. The four text rows are 25-28.

  Build an MMC3 `SAMPLE_RPG` variant with `project.project.nameHeroAtStart = true` and the recruiter's own
  Join (`actorId: 2`, `tools/make-rpg-sample.js:331-344`) mutated to `named: true`. **Hero naming
  first**: boot, wait for readiness, probe `'font'` on rows 25-28 and `'art'` on row 2 while the grid is
  up, select END with the seeded default, and probe `'art'` again on row 25 once `game_state` returns to
  `ST_GAMEPLAY`. **Then the named Join, explicitly, in the same test**: walk to the recruiter (slot 2),
  press B, press through her `Say` (`talkThrough` or an equivalent inline press loop) until `box_state
  === BOX_NAMEENTRY` — `game_state` stays `ST_DIALOG` throughout this whole second half, never
  `ST_NAMEENTRY` (§7) — probe `'font'` on rows 25-28 and `'art'` on row 2 again while this second
  session is up, select END, and probe `'art'` on row 25 once more after `game_state` returns to
  `ST_GAMEPLAY`. Catches: `split_select` (`engine/split.asm:73-96`) never being told to arm the
  font-bank program while `box_state == BOX_NAMEENTRY` — wrong tiles on screen, invisible to any test
  that only inspects source text — and, specific to the Join half, `split_select`'s own state read
  keying off `game_state` alone rather than `box_state`, which would leave a Join's own naming session
  undetected by the split entirely, since `game_state` never leaves `ST_DIALOG` for it the way it
  visibly changes to `ST_NAMEENTRY` for the hero.
- *The register-write source scan, kept as its own separate, narrower check* — nothing in
  `engine/nameentry.asm`'s own source text matches `$8000`/`$8001` or any mapper-register write.
  (`test/unit/bankedbytes.test.js`, a plain text-content assertion, not a split-coverage claim.)
  Catches: a future edit adding a direct register write inside the banked file, which would race the
  scanline IRQ's own R1 switching with no critical section protecting it (unlike `switch_prg_bank`,
  which the trampoline already wraps) — a narrower, purely textual check that the framebuffer test
  above does not replace, since split *coverage* and the *absence of a race* are two different claims.
- *The hero's entry event fires exactly once after naming completes.* (`test/unit/rpg.test.js`.)
  Catches: `settle_owed`'s own gate not covering the naming-then-redraw sequence, which would let the
  starting screen's own entry event fire once before naming (against a screen not yet fully drawn) and
  again after.
- *Default-name trimming and empty-name acceptance*: selecting END with `nm_len == 0` is accepted (an
  all-space name), and the seeded default from `bootPastNaming` round-trips unchanged when END is
  pressed immediately. (`test/unit/rpg.test.js`.) Catches: a hidden minimum-length requirement nowhere
  in this design's own rules.
- *The restored game-over/new-game default-name regression test.* (`test/unit/rpg.test.js`.) Catches:
  `init_session`'s own re-seed of `pc_name_ram` from `pc_name` on a fresh game not actually running,
  leaving a game-over'd player's typed name attached to the next new game.
- *The 21-point kernel/banked ledger matrix (§11), plus the absolute worst-case build per board.*
  (`test/unit/kernelbytes.test.js` for rows 4-15 and the kernel-lo half of 16-18; `test/unit/
  bankedbytes.test.js` for rows 1-3, 19-21 and the banked half of 16-18.) Catches: any of the four
  kernel-lo terms or the two banked terms silently drifting from their documented value as the real
  implementation lands — against nesasm's own real usage, per Y3, not a formula compared with itself.
- *`kernelShortfallAdvice` offers "hero naming" and "every named Join" together automatically once
  neither alone frees enough, with no naming-specific combination code.* (`test/unit/kernelbytes.test.js`,
  beside its own existing shortfall-advice tests.) Catches: the generic combination search failing to
  reach naming's own two entries because they were pushed onto a different array, or filtered out
  before the search runs.
- *`battleShortfallAdvice` never proposes removing naming when `exact` is false (X2's own regression,
  named in §11).* (`test/unit/bankedbytes.test.js`, beside its own existing override-advice tests.)
  Catches: the naming candidates leaking into the overridden-code advice path despite measuring a
  quantity (`battleRegionBytes`) the deficit was never computed from.
- *`kernelTableBytes`'s own naming-gated input-row term (§4's own Y1 fix).* (`test/unit/
  kernelbytes.test.js`, an isolation delta on `fixedBytes` alone, not folded into the `codeBytes`
  matrix above since it lives in a different function.) Catches: the row being emitted or charged
  unconditionally, breaking the naming-off byte-identity test above the moment it regressed, or being
  gated on a mapper-aware predicate that `kernelTableBytes` has no way to evaluate at one of its own
  call sites (§4).

**Phase 2 (action side, D8) — new this round:**

- *Action-side hero naming, end to end, on a `sample` (NROM) variant.* (`test/unit/nameentry.test.js`,
  beside the six phase-1 pins.) Grid appears at new game (`bootPastNaming`'s own outer `game_state ===
  ST_NAMEENTRY` check, unchanged); a typed name lands in `pc_name_ram` (`typeNameAndFinish`, then a
  direct RAM read); END returns to `ST_GAMEPLAY`; the starting screen's own entry event fires exactly
  once. Catches: the shims (§5) routing to the wrong arm on a non-banked build — an undefined-symbol
  assembler error if `NAME_ENTRY_BANKED` were miscomputed as true for NROM, or a silent hang if a shim's
  `!NAME_ENTRY_BANKED` arm jumped to a label that was never actually `.include`d because `engine/main.asm`'s
  own new conditional line (§5) was missed.
- *The naming-off action ROM is byte-identical to the phase-1 pin — the leak test, action side (v12 had
  this RPG-only).* (`test/unit/nameentry.test.js`, the identical `move.test.js`/`routes.test.js`
  SHA-256 shape the six phase-1 pins already use.) Catches: any `.if HERO_NAMING_ENABLED`/`.if
  NAME_ENTRY_BANKED` gate in §4/§5/§8 left actually unconditional on an action build, or the five shims
  (§5) costing kernel-lo bytes even when naming is off.
- *An MMC3 action variant (`sample-mmc3`, hero naming on) gets the identical split coverage v12's own
  RPG probe already proves, same rows.* (`test/unit/split.test.js`, alongside the existing RPG probe —
  §5's own split_select finding predicts this needs no new engine code, only a new build variant to
  prove it against real framebuffer output rather than trust the RPG probe to generalize.) Catches:
  anything specific to the *kernel-lo* placement that the RPG-only probe could not have exercised — in
  practice nothing, per §5's own finding that `split_select` never distinguishes placement at all, which
  is exactly the claim this test exists to hold to account rather than merely assert in prose.
- *The new ledger rows (§11) — `NAME_ENTRY_ACTION_KERNEL_ALLOWANCE`/`HERO_DEFAULT_KERNEL_ALLOWANCE`,
  isolated deltas — on every action-capable board.* (`test/unit/kernelbytes.test.js`, `measureCodeBytes`
  extended with a `fixture: SAMPLE` + `withHeroNaming` combination, the same shape its own existing
  `{ fixture: SAMPLE, withSave: true }` calls already use, §0.) Catches: either term silently drifting
  from nesasm's real usage the moment the grid's own kernel-lo body is actually written, or
  `needsHeroDefault` (§8) charging the wrong boards. **This is also P1-3's own real-assembly test,
  named directly**: `measureCodeBytes`'s own `{ fixture: SAMPLE, withHeroNaming: true }` build is a
  real `nesasm` invocation against an action project with naming (and, through it, `text.asm`'s own
  `NAME_TOKEN_ENABLED` machinery whenever the same build also carries a token) — `NAME_LEN` undefined
  on that placement (P1-3's own defect) fails this exact build with a real assembler error, not a
  silent pass, the same way the first bullet's own end-to-end build in `test/unit/nameentry.test.js`
  already would. Both existing/planned real-build tests catch it; neither needed a new one written
  solely for this finding.
- *The five shims' own byte cost, both arms.* (`test/unit/kernelbytes.test.js` for the kernel-lo arm,
  `test/unit/bankedbytes.test.js` for the banked arm — `measureCodeBytes`/`measureRegion` around a
  build with and without the shims present, the identical isolation shape every other term in this
  ledger already uses.) Catches: `NAME_ENTRY_KERNEL_ALLOWANCE`'s own stale 95-byte static count (§4's
  own note) silently diverging from either arm's real cost once nesasm actually assembles them.

**Phase 2b (the Say token, D7) — new this round, reviewable on its own after phase 2 per §17:**

- *The token renders the typed name in the nametable after a `Say`, read from the nametable, not RAM —
  the `name_offset_pc` precedent (§0).* (`test/unit/rpg.test.js` for the RPG placement,
  `test/unit/nameentry.test.js` for the action placement.) Catches: `text_type_name`'s own lookahead
  (§9a) drawing the wrong glyph, or advancing `msg_col`/`msg_name_idx` out of step with what was
  actually queued.
- *P1-1 (round-1 finding), named directly: a Say carrying the token TWICE (`"{name} and {name} again"`),
  typed across a frame boundary during which an animated entity (any patroller or chaser, already
  placed by the fixture) draws — so `draw_entities`' own `ptr_lo`/`ptr_hi` clobber (`engine/
  entities.asm:494-521`) lands between the token's own first and second glyph frames, not merely
  between two ordinary characters where it would go unnoticed because ordinary glyphs read `msg_ptr_lo`,
  never `ptr_lo`.* (`test/unit/rpg.test.js`, an entity with an idle animation left running on the same
  screen as the naming session, or `test/unit/nameentry.test.js` for the action placement.) Catches:
  the "only select the source table on frame 0" shortcut this round removes — with it still present,
  the second glyph onward would read whatever `entity_animation`'s own animation-frame lookup last left
  in `ptr_lo`/`ptr_hi`, not `pc_name_ram`, and the nametable assertion above would catch it directly
  (the wrong glyph, not a crash) — a two-token, single-line test with only one animated entity on
  screen would not: the second token's own first frame could get lucky and still read a byte that
  happens to render correctly, which is why a *second* animated entity, or the *second* token's own
  glyphs specifically, is what this test needs, not merely "a token near an entity."
- *P1-2 (round-1 finding), named directly: an RPG with the token authored and naming switched OFF reads
  `party[0].name`'s own compiled name into the nametable, byte-exact — not merely "some name," since a
  wrong bank read would often still produce *some* glyph, just not the right one.* (`test/unit/
  rpg.test.js`, `NAME_ENTRY_ENABLED` off, `NAME_TOKEN_ENABLED` on.) Catches: `init_session`'s own
  deleted RPG arm resurfacing (silently reading the wrong bank's data into `pc_name_ram`, per this
  round's own finding), or `party_join`'s widened `NAME_SEED_ENABLED` gate failing to actually seed
  member 0 through `party_init` at boot, before any Join has ever run.
- *`projectUsesNameToken` live/dead cases — a token inside a switched-off branch does not count, the
  same `liveCommands` discipline `projectUsesMove` already holds to.* (`test/unit/project.test.js`,
  beside the existing `projectUsesMove`/`projectUsesSave` predicate tests.) Catches: the predicate
  reading `allCommands` instead of `liveCommands` and over-charging a project for a token nothing in the
  compiled ROM will ever reach.
- *P1-1 (round-2 finding), named directly: a token in plain dialogue only — `NAME_TOKEN_ENABLED` is 1,
  and the nametable shows the real name after touching the entity; the identical token on an entity
  whose own authored event compiles at least one live page — `NAME_TOKEN_ENABLED` is 0, since
  `textcompile.js`'s own precedence (`:541-554`) never reaches the dialogue field at all in that case.*
  (`test/unit/project.test.js` for the two predicate cases against `projectUsesNameToken`/
  `effectiveDialogue` directly; `test/unit/rpg.test.js` or `test/unit/nameentry.test.js` for the
  nametable half, a real build.) Catches exactly the round-2 finding: `projectUsesNameToken` walking
  `projectEvents` alone, which never yields plain dialogue at all (`shared/eventrules.js:249`) — a
  project whose only `{name}` lives in a `dialogue` field would otherwise compile a live `TXT_NAME`
  byte with `NAME_TOKEN_ENABLED` (and, transitively, `NAME_SEED_ENABLED`) both computed `0`: no
  expansion arm assembled, no seed either — and, in the second case, `effectiveDialogue` wrongly
  counting a dialogue field the compiler will never reach because the same entity's own event already
  supersedes it.
- *`wrapText`'s own token-width cases — a word containing `{name}` is measured as 10 columns, never 6;
  a token is never split across a wrap; a lone `{`/`}`/`|`/`~` outside the exact sequence still renders
  as furniture.* (`test/unit/font.test.js` — `shared/font.js`'s own test file, confirmed this round by
  grepping for a `test/unit/font.test.js` file, which exists and already tests `wrapText`/`charToTile`
  directly.) Catches: the `visualLength`/`truncateAtVisualLimit` helpers (§9a) under- or over-counting
  the token, or the exact-sequence rule accidentally reserving `{`/`}` outside a real token.
- *`encodeString` never hands `textToTiles` a raw, unconsumed token substring.* (`test/unit/
  script.test.js` or `test/unit/project.test.js`, wherever this codebase's own existing `EVENT_COMMANDS`/
  `encodeCommand` corpus already lives — confirmed against the real file before this phase lands, not
  guessed here.) Catches: `encodeLine`'s own slice-and-scan (§9a) leaving a fragment of `{name}` for
  the character mapper to render as furniture-adjacent glyphs instead of splitting cleanly on every
  occurrence.
- *P1-4 (round-1 finding), named directly: `encodeString('Hi {name}!', true).bytes` is a real array
  (not `undefined`) containing the expected `TXT_NAME` byte at the expected position.* (`test/unit/
  project.test.js` or `test/unit/script.test.js`, a plain unit test on `encodeString`/`encodeLine`
  directly, no build required.) Catches exactly the round-1 defect: `encodeLine` returning `{ bytes,
  unmapped }` while `encodeString`'s own existing caller line (`bytes.push(...mapped.tiles)`) reads
  `mapped.tiles` — a shape mismatch `TypeError`s the instant any token-bearing string compiles, on
  either game type, so this test is the cheapest one in the whole design (no `nesasm`, no `NES`
  instance) and the one every other token test above depends on transitively without saying so.
- *A choice option label containing `{name}` compiles to the literal six characters, not `TXT_NAME`
  (P2-5).* (`test/unit/project.test.js`, beside the `EVENT_COMMANDS` corpus.) Catches: `internString`'s
  own `allowNameToken` default leaking `true` into the choice-label call site, which — per
  `text_choice_step`'s own unconditional `vram_push` loop (`engine/text.asm:503-509`, no control-byte
  dispatch of its own at all, confirmed this round) — would render as a stray, undefined glyph tile at
  runtime, not merely the wrong text.
- *A token in a project with neither hero naming nor a default source is refused by `validateProject`,
  naming the Map Forge.* (`test/unit/project.test.js`, beside the existing Save-needs-a-title refusal.)
  Catches: `needsHeroDefault` (§8) failing to cover every case the token itself can reach, silently
  compiling a `TXT_NAME` byte with nothing behind it to read.
- *`NAME_TOKEN_KERNEL_ALLOWANCE`, isolated, on every board and both game types.* (`test/unit/
  kernelbytes.test.js`.) Catches: the flat placeholder (§9a) drifting from nesasm's real usage the
  moment `text_type_name`'s own listing is actually assembled.

**Phase 3 (UI):** (`main/smoke.js`, driving the real renderer, for all three — this is UI behavior a
`node:test` process cannot exercise directly.) The Sprite Forge's hero-naming checkbox (`checked`
reflects `project.project.nameHeroAtStart` — corrected this round from a stale `project.rpg.
nameHeroAtStart` this passage had not been updated to match §9's own field move, found while pinning
lines for this round, not one of the eight findings proper but fixed alongside them — `onchange`
commits and rerenders — catches a checkbox wired to `oninput` instead, which would commit on every
intermediate browser event rather than once on change); the "Default name" field's own RPG/action
split (P2-7, §13 — catches it showing the editable input on an RPG, or the read-only `party[0].name`
span on an action project, either one backwards);
the Map Forge's join-row checkbox and its own summary-line suffix (catches the checkbox existing but
never actually setting `command.named`, which would look correct in the editor while compiling a
plain, unnamed Join); the Controller Forge's hero-gated `nameentry` row (catches it appearing for a
Join-only-naming project, which can never reach `ST_NAMEENTRY` and so has nothing for the row to bind).

**Phase 4 (starter/fixture opt-in):** the naming-on/off data deltas on the two capacity ledgers, for
real, assembled ROMs rather than the static count (`test/unit/kernelbytes.test.js`/`bankedbytes.test.js`,
run against the real `sample-rpg` fixture once it opts in rather than a synthetic project); `sample-rpg`'s
own opt-in (both hero and Join, per decision 4), with every `rpg.test.js` caller of `boot()` that needs
it switched to `bootPastNaming()` (`test/unit/rpg.test.js` itself — catches a caller left on plain
`boot()`, which would then observe `ST_NAMEENTRY` where it expected `ST_GAMEPLAY` and fail confusingly
far from the actual cause); `sample-rpg-mmc1`'s own restored-name assertion, byte-exact against the WRAM
snapshot (`test/lua/save_sram.lua`, §14's own new phases and comparison — catches the save/restore path
silently truncating or corrupting the RAM-resident name across a Continue).

**Phase 5 (docs):** `docs.test.js`'s own CLAUDE.md pointer and character-budget check — this feature
needs a short passage in CLAUDE.md's own "The battle system" section naming `nameentry.asm`'s place
alongside `battle.asm`/`battleui.asm`/`battleturn.asm` and the five new `BE_NAME_*` entry points, paid
for with a trim elsewhere in the file rather than simply appended, per the original brief's own
requirement (CLAUDE.md was at 134,921 of 135,000 characters when that brief was written).

## §16. nesasm limits and 6502 traps — every label audited, the longest named, every `.if`/`.endif`
pair counted and correctly attributed, and the movement ring's own asymmetry added as a named trap

**Every label in every listing was re-extracted and re-measured this round, against v14's own final
text, not carried forward from v13's count.** Longest label unchanged across both rounds:
`do_action_confirm_notname`, 25 characters — no label introduced or touched by this round's own eight
fixes reaches it (`text_type_name_lookahead`, unchanged from v13, is still the longest new one, 24).
Extracted with `grep -oE '^[[:space:]]*[a-zA-Z_][a-zA-Z0-9_]*:'` against this document's own final text
and sorted by length, the same mechanical check as the `.if`/`.endif` count below, not a manual re-scan.

**`.if`/`.endif` pairs, recounted per section this round (`grep -c '^\s*\.if '`/`grep -c
'^\s*\.endif\s*$'` against each section's own line range in this document's final text) — moved from
v13's own 52 to **49**, entirely from P1-2's own removal of the three-way pointer swap:**

- §3 (the reader swap — **three pairs, up from v12's two**): the original two-way swap, unchanged
  (`draw_panel`/`push_combatant_name`'s own `NAME_ENTRY_ENABLED`/`!NAME_ENTRY_ENABLED` pair); plus the
  token's own new reader, corrected this round (P1-2) from a three-way, six-`.if` swap down to a single
  `NAME_TOKEN_ENABLED` pair that always reads `pc_name_ram`. 2 + 1 = 3.
- §4 (the kernel-lo hooks, including the branch-range fix; unchanged from v13 — this round's own fixes
  touched call targets and prose, not this section's `.if` structure): fourteen pairs — the
  `do_action_pause` relay's own two arms plus the pre-existing `SAVE_ENABLED` Continue arm (three);
  `do_action_confirm`'s own `NAME_ENTRY_ENABLED` gate plus its pre-existing `TITLE_ENABLED` arm (two);
  `do_action_cancel`'s own entry gate, its retargeted "during play" check's own two mutually-exclusive
  arms, its `ST_NAMEENTRY` fallthrough guard, and its own shared local `do_action_cancel_wait` label's
  gate (five); `draw_ui` (one); `ui_tick`'s own pre-existing `BATTLE_ENABLED` arm plus its new
  `NAME_ENTRY_ENABLED` arm (two); `text_tick` (one). 3+2+5+1+2+1 = 14.
- §5 (the naming machinery, unchanged from v13): nineteen pairs — the two `.include` gates (`battle.asm`'s
  `NAME_ENTRY_ENABLED`, one pair; the `engine/main.asm` site's own nested `NAME_ENTRY_ENABLED`/
  `!NAME_ENTRY_BANKED`, two pairs — three total); the whole-file `.if NAME_ENTRY_ENABLED` wrapping every
  routine in `engine/nameentry.asm` (one); the five shims, each its own `NAME_ENTRY_BANKED`/
  `!NAME_ENTRY_BANKED` pair, all five wrapped in one outer `NAME_ENTRY_ENABLED` (eleven); `battle_entry`'s
  own dispatch, two independent pairs (the `be_restore_chk` comparison, and the five new arms past it);
  and `split_select`'s own two **pre-existing** pairs (`TITLE_ENABLED`, `BATTLE_ENABLED`), counted here
  only because this section quotes that routine's real body in full. 3+1+11+2+2 = 19.
- §7 (`script_op_join`/`party_join`, structurally unchanged from v12 — `party_join`'s own gate is
  renamed this round, `NAME_ENTRY_ENABLED` → `NAME_SEED_ENABLED` (P1-2), the identical single `.if`):
  three pairs.
- §8 (`start_game`/`reset`'s hooks, plus `init_session`'s own re-seed — **eight pairs, down from v13's
  own eight but reshaped**: v13's RPG arm inside `init_session` is deleted outright (P1-2), replaced by
  a simpler action-only arm, netting the identical total by coincidence, not by design): `start_game`'s
  own `HERO_NAMING_ENABLED` arm and its `!HERO_NAMING_ENABLED` counterpart (two, unchanged); `reset`'s
  pre-existing `TITLE_ENABLED` arm, its `!TITLE_ENABLED` counterpart, and the `HERO_NAMING_ENABLED` gate
  nested inside that `!TITLE_ENABLED` arm (three, unchanged); `party_join`'s own gate is counted in §7,
  not here; `init_session`'s own two remaining pairs — one for the deleted-but-still-quoted-as-history
  `NAME_SEED_ENABLED` reference `party_join`'s gate widening explains (one) and the real, corrected
  action-only arm's own outer `NAME_SEED_ENABLED` + nested `!BATTLE_ENABLED` pair (two, replacing v13's
  own three-armed RPG/action split). 2+3+1+2 = 8.
- §9a (the Say token — **two pairs, down from v13's own six**, entirely P1-2's own simplification):
  `text_type_step`'s own outer `.if NAME_TOKEN_ENABLED`/`.if !NAME_TOKEN_ENABLED` pair around the
  `text_type_name` label itself — the three-way pointer swap's own four nested pairs are gone, replaced
  by one unconditional pointer-set with no `.if` of its own at all inside the `NAME_TOKEN_ENABLED` arm.

3 (§3) + 14 (§4) + 19 (§5) + 3 (§7) + 8 (§8) + 2 (§9a) = **49** `.if`/`.endif` pairs total — confirmed
against this document's own final text as a whole, not only as the sum of the per-section counts above:
`grep -c '^\s*\.if '`/`grep -c '^\s*\.endif\s*$'` against the entire file both return 49, matching the
per-section total exactly.

- **"A guard copied from another routine may not mean the same thing."** `draw_nameentry_cursor`'s
  own `oam_idx == 0` guard is deliberately copied from `draw_entities`, not `battle_sprite_mon`'s own
  unguarded append.
- **"An 8-bit multiply used as a table offset silently wraps."** `nameentry_stride`'s own repeated-add
  loop and `party_join`'s own destination-index multiply both advance with `clc`/`adc`/`bcc`/`inc`.
- **A mask that is too narrow can fold a sentinel or an out-of-range value into a valid-looking one.**
  §7's own `and #$7F`, not `and #$03`.
- **Deciding a state inside several independent handlers lets the last one win.** `nameentry_tick`'s
  own D-pad chain is a real priority chain.
- **A dismissed phase must actually leave the state that made it dismissible.** `BOX_NAMEDONE`.
- **A cross-bank return path must return through the trampoline, never around it.** `nameentry_
  select`'s own END branch sets `BOX_NAMEDONE` and returns normally rather than calling `script_
  resume` directly from inside the bank.
- **Branches are ±128 bytes, and inserting code between a branch and its target can push a branch
  that was fine yesterday out of range today, even when the branch itself never changed.** `do_action`'s
  own `beq do_action_pause` (`engine/input.asm:120`) needed no code change of its own to break — the
  growth was entirely in code inserted *between* it and its target. `music.asm`'s own precedent is the
  identical shape.
- **Widening a table's own count (`args.length`) can silently change what a formula derived from that
  count predicts, even in code that never touches the table directly.** `join`'s own compiled wire
  width stayed 2 bytes throughout this round, but the *generic* width-prediction formula
  (`EXCEPTIONAL_WIDTHS[id] ?? 1 + entry.args.length`, `test/lib/eventdecoder.js:132`) silently started
  predicting 3 the moment `EVENT_COMMANDS`'s own `join.args` grew a second entry for an unrelated
  reason (reaching the schema normalizer's own `'named'` case) — a genuinely new instance of "adding a
  field can break code that never reads that field," caught only because this design traced the
  formula itself rather than assuming a two-arg command must cost two bytes on the wire.
- **A gate must be balanced across its own listing, and a "not simply the reverse" rule deserves its
  own name, not just correct code.** The naming grid's own UP/DOWN ring (§6) is intentionally
  asymmetric — DOWN's forward cycle (row 0→1→2→0) is not the reverse of UP's own cycle (row 0→2→1→0) —
  a genuine, deliberate exception to "an inverse control should undo its counterpart," worth a named
  regression test (§15) precisely because a future "simplification" reads as an obvious, harmless
  cleanup to whoever makes it.
- **New this round (v13): `(ptr),Y` indirect-indexed addressing only ever works with `Y`, never `X` —
  a lookahead that must not disturb the position it is looking ahead *from* has to reload that position
  into `Y` afterward, not carry it in `X` across the read.** `text_type_name`'s own lookahead (§9a)
  scans forward from `msg_name_idx` looking for a non-space glyph, using `Y` for the scan; the position
  it actually needs to *draw* is the original `msg_name_idx`, not wherever the scan stopped, so
  `text_type_name_draw` reloads `Y` from `msg_name_idx` before the real `lda [ptr_lo],y` — a second
  register cannot substitute for `Y` here the way it could for an ordinary loop counter, because the
  addressing mode itself has no `X` form.
- **A shim reached by `jsr` may still `jmp` onward, and the eventual `rts` still returns to the shim's
  own caller — not to the shim.** `name_select` (§5) is entered by `jsr` from `do_action_confirm`, which
  needs to run code immediately after the call returns, yet `name_select`'s own body is nothing but two
  `jmp` tail calls with no `rts` of its own anywhere in it. This is correct, not an oversight: `jmp`
  never pushes a return address, so the single `rts` that eventually fires — deep inside `call_battle`'s
  own chain, or inside `nameentry_select` directly — pops the *original* return address `do_action_
  confirm`'s own `jsr name_select` pushed, regardless of how many further `jmp`s sit in between. A shim
  written with an `rts` of its own after either arm would be a real bug — an extra stack pop with
  nothing left to balance it — precisely because none of the tail-called routines it reaches ever
  expects one.
- **A placement flag and a feature flag answer different questions, and conflating them costs the wrong
  game type its own feature.** `battleBankEnabled`/`NAME_ENTRY_BANKED` answers "where does this
  project's naming code live," never "does this project use naming at all" — v12's own
  `usesHeroNaming`/`usesNameEntry` locals (§4) ANDed the two together because, when only one game type
  could ever use naming, the two questions always had the same answer. D8 is exactly the case where they
  come apart, and `spriteReservedRanges`/the sprite CHR stamp (§4's own X1 third fix) had the identical
  mistake in the opposite direction — `codeRegionCount(project)` (a placement fact) gating a reservation
  that should have been keyed to `projectUsesNameEntry(project)` (a feature fact) alone.
- **New this round (v14, P1-1): shared, per-frame scratch is not this frame's own private state, even
  when the same routine set it last.** `ptr_lo`/`ptr_hi` are zero-page scratch every table-walking
  routine in this engine reuses — `text_type_name`'s own "only select the source table on the token's
  first frame" shortcut assumed a value it set would still be there on the *next* frame, when in fact
  `main_loop_draw`'s own `draw_entities` (`engine/boot.asm:239`) runs in between and its own
  `entity_animation`/`draw_one_entity` path (`engine/entities.asm:494-521`, `:606-609`) overwrites both
  bytes for its own, unrelated animation lookup on every single frame, animated entity or not. Anything
  that must survive from one frame's use of `ptr_lo`/`ptr_hi` to the next has to be re-derived every
  frame, never cached across the boundary — the six original naming-grid bytes (§2) never made this
  mistake because every routine that touches `ptr_lo`/`ptr_hi` there sets and consumes it within the
  same call; the token's own typewriter was the first routine in this feature spread thinly enough
  across frames to get it wrong.
- **New this round (v14, P1-2): a bank being reachable through `call_battle` does not mean its data is
  mapped for a caller that reaches the *data* directly, only for one that goes through the trampoline.**
  `pc_name` (`main/build/battletables.js:257`) is real, compiled data — nesasm resolves `lda
  #LOW(pc_name)` from anywhere in the assembled source with no error — but it lives inside the
  switchable window `call_battle`'s own bank-switch controls, and reading it from kernel-lo code that
  never went through that trampoline reads whatever the switchable window happens to hold at that
  moment instead: a *silently wrong value*, not an assembler error, which is a harder class of bug to
  catch than the undefined-symbol failure P1-3 (below) produces from the identical root cause (banked
  data referenced from outside the bank) applied to a symbol rather than its contents.
- **New this round (v14, P1-3): a symbol's own single writer can itself be conditionally compiled, and
  the audit that lists every symbol a file uses still has to check that each one is *always* defined,
  not merely defined somewhere.** `NAME_LEN`'s sole writer, `battleTables` (`main/build/
  battletables.js:291`), is itself omitted entirely from an action project's own build
  (`generate.js:2432`) — a `.if`-style omission one level removed from the referencing file, which is
  exactly why §5's own "every external symbol" audit missed it on the first pass: the audit checked
  *where* each symbol lived, not whether its own home was reachable on every placement the referencing
  code itself needed to reach.
- **New this round (v15, P1-1): `projectEvents` yields authored events only — plain dialogue is a
  separate compile path with no "event" object of its own to be yielded, and a content-predicate walk
  that only visits `projectEvents` silently never sees it at all.** `shared/eventrules.js:249`'s own
  loop reads `entity.props?.event` and nothing else; `entity.props?.dialogue` is a sibling field on the
  identical entity, compiled by an entirely different branch of `main/build/textcompile.js:541-554`
  (`pages.length ? encodeEvent(pages, ...) : [...OP_SAY, internString(dialogue), ...]`) whenever the
  entity's own event compiles to zero live pages. Any predicate meant to answer "does this project's
  compiled ROM contain X" has to walk both paths, with the compiler's own precedence rule applied, or
  it silently answers only for the one path it happens to have been written against — `projectUsesMove`/
  `projectUsesSave`/`projectUsesJoinNaming` all escape this trap by construction, since none of Move,
  Save or a named Join can ever appear in plain dialogue (dialogue compiles to nothing but a single
  `Say`), but `projectUsesNameToken` could not, because a `Say`'s own text and a dialogue field's own
  text are the identical shape by design (CLAUDE.md: "Plain dialogue is compiled into an event of one
  unconditional page... so 'talking to somebody' has a single path through the engine rather than a
  special case beside the scripted one" — true of the *engine's* own runtime path, not of the
  *compiler's* own two authoring surfaces feeding it).

## §17. Phasing

1. **The save migration alone.** `SAVE_FIELDS`'s new entry, `SAVE_LAYOUT_VERSION` 2→3, every RAM
   equate in §2. Fixtures regenerated; SHA-256 of all six pinned. Reviewable and mergeable on its own:
   nothing downstream depends on anything but the version bump and the RAM layout existing.
2. **The gated engine core — now including the action placement and the shims, not deferred to a later
   phase (D8).** The mechanism (§5) is designed once, for both game types, and has to land with the RPG
   side or the two would drift the moment either was implemented alone: `engine/nameentry.asm` (the
   identical source, `.include`d from `battle.asm` *or* `engine/main.asm`, never both), the five
   kernel-lo shims and every hook site rewritten to call them (§4/§5), `battle_entry`'s own extended
   dispatch (banked-only, unchanged from v12), `BATTLE_REGION_SOURCES` extended (§5), `party_join`'s
   copy loop (banked, §7, RPG-only, unchanged), the kernel-lo hooks including the branch-range fix (§4,
   now correctly reachable on either game type since `HERO_NAMING_ENABLED` dropped its own
   `battleEnabledFor` AND), `script_op_join`'s growth (§7, RPG-only, unchanged), `start_game`/`reset`'s
   hero hooks including `init_session`'s own three-way default-name re-seed (§8), the schema fixes
   (`INPUT_STATES`'s seventh entry, `join.args`'s second entry, `EXCEPTIONAL_WIDTHS`'s `join: 2`,
   §4/§7's own X1 fixes, `heroName`/`nameHeroAtStart` moved to `project.project`, §8/§9), all
   normalizer/predicate work including the shared `battleBankEnabled`/`projectWithoutHeroNaming`/
   `projectWithoutJoinNaming` helpers (§9) and the X1 sprite-CHR-stamp D8 fix (§4), all capacity
   allowances measured for real against nesasm's own output on **every** action-capable board as well as
   every RPG-capable one (not the static count this document uses — §11's own re-measured headroom
   table is this phase's own starting point, not its result), `kernelShortfallAdvice`/
   `battleShortfallAdvice` both correctly extended including X2's own suppression. Every real fixture
   rebuilt with naming still off and re-hashed against phase 1's own pins — this phase must leave every
   existing test green with the feature fully present but universally disabled, on both game types, the
   same discipline every prior optional feature in this codebase shipped under.
3. **The Say token (D7) — its own phase, after 2, reviewable independently.** The compiler
   (`TXT_NAME`, `encodeString`'s own token split, §9a), `text.asm`'s own `text_type_name` arm and the
   three-way reader swap (§3/§9a), `wrapText`'s own token-width and never-split-a-token corrections
   (§9a), the event editor's and box preview's own 10-column placeholder rendering (§9a),
   `validateProject`'s new refusal (§8), and `NAME_TOKEN_KERNEL_ALLOWANCE`'s own real measurement.
   Deliberately after phase 2, not folded into it: the token can be authored and tested with the naming
   grid itself still entirely absent (a project with only a compiled default, no naming feature live at
   all), so nothing about it depends on phase 2 having landed first except the *existence* of
   `pc_name_ram` as one of its three possible sources (phase 1, already shipped) — but it is placed
   after 2 anyway, matching phase 4's own reason for going last among the earlier functional phases:
   this is the second phase to change what an authored `Say` can mean, and phase 2's own naming-off
   byte-identity discipline is the baseline it has to hold to as well.
4. **UI.** The new Sprite Forge Player tab — the hero-naming checkbox and the `heroName` field, both
   game types (§13) — the Map Forge checkbox and summary suffix, the Controller Forge's hero-gated row.
   Independently reviewable once phases 2 and 3's own predicates and fields exist, since the UI layer
   only ever writes the same fields those phases already read.
5. **Starter/fixture opt-in.** `shared/starters/rpg.js` and `tools/make-rpg-sample.js` opt in per
   decision 4 (§1 item 8); `sample-rpg-mmc1`'s own Join gets `named: true` and `save_sram.lua` gains its
   own new phases (§14); every `rpg.test.js` caller of `boot()` that needs it switches to
   `bootPastNaming()`. **New this round: `sample` (the action fixture) opts in too** — hero naming
   turned on, and its own token authored into one existing `Say` (the specific line to name is a phase-5
   content decision, not a phase-1-of-this-design one — recommended: the entrance NPC's own greeting,
   the first `Say` a fresh action project's own player ever sees, so the token's effect is visible
   immediately rather than buried in a later screen) — so an action fixture exercises both D6/D8 (the
   grid) and D7 (the token) for real, alongside `sample-rpg` and `sample-rpg-mmc1`. Left last among the
   functional phases deliberately, unchanged reasoning from v12: it is the only one that changes what a
   shipped fixture's own ROM contains, and every other phase's own tests must already be green against
   the feature switched off before this phase turns it on for three real projects, not two.
6. **Docs.** CLAUDE.md's own budget check (§15), a short passage naming `nameentry.asm`'s place in the
   include graph on both placements, the five new `BE_NAME_*` entry points, and the Say token's own
   three constants (`TXT_NAME`, `hero_name_default`, `NAME_TOKEN_ENABLED`), paid for with a trim
   elsewhere in the file.

## §18. Out of scope, explicitly

**"An action-project equivalent of any of this" is removed this round — it is now in scope (D6/D7/D8),
which is what this whole document is for.** What remains explicitly out of scope: renaming an
already-recruited member (or the hero) later, after the naming session that named them has ended;
naming a monster or any non-party actor; digits, punctuation, or any glyph outside A-Z/a-z, on the grid
or in `heroName` (§8); any new save-atomicity mechanism beyond `pc_name_ram` riding the existing
`SAVE_FIELDS` sequence; localized/non-Latin name entry; a Say token naming anyone but the hero (§9a —
`{name}` is always `pc_name_ram` slot 0, never a per-Say-configurable party member); Continue's own
title-screen prompt showing the saved name (§19's own question 6, unchanged); any second token syntax
beyond the exact `{name}` sequence (§9a's own recommendation, kept as an open question anyway).

## §19. Open questions for Chris

**v12's own six questions are now settled** — §1 items 6-9 restate Chris's own D2/D3/D4/D5 answers to
questions 2, 3, 4 and 5; question 1 (RPG-only) is overruled outright by D6 (§1 item 10); question 6
(Continue's own title prompt showing the saved name) remains open, unchanged, out of scope unless
wanted — nothing this round touches it. Two new questions replace them, each already answered by a
recommendation this document builds on, restated here per the original brief's own requirement that
every open question carry one:

1. **The default hero name source (§8).** Recommended and built: `project.project.heroName`, a new
   string field, default `"Hero"`, A-Z/a-z only, max 10 — compiled into `hero_name_default` only for
   the projects that need it. The alternative considered and rejected: an all-spaces default, so a
   naming-off action project's own Say token would print nothing at all rather than a placeholder name.
   Rejected because it makes the *common* case — an author who authors `{name}` and never touches
   `heroName` at all — read as broken (a message with a name-shaped hole in it) rather than merely
   generic; `"Hero"` costs nothing extra to compile (the table exists either way once anything needs it)
   and reads as an intentional default the way every other unset string field in this schema already
   does (a party member's own name defaults to `"Member N"`, never blank).
2. **The token's own syntax and the brace collision (§9a).** Recommended and built: the exact sequence
   `{name}`, recognised only as that literal run of six characters, leaving a lone `{`/`|`/`}`/`~`
   elsewhere in the same string as window furniture exactly as today. The alternative considered: reserve
   the four characters outright, refusing them anywhere outside a token. Rejected because it would
   silently break any existing project that already uses them as furniture inside ordinary `Say` text —
   a real, if unusual, use `shared/font.js`'s own doc comment explicitly names as intentional — for a
   token most authored text will never combine with furniture on the same line at all.

## Places a claim could not be pinned to a line and was reasoned instead

- Every byte figure in §11 is a static instruction-width count, not a nesasm measurement — adopted
  from round 8's own independently-confirmed figures; phase 2 replaces every figure here with a real,
  assembled, per-board number regardless.
- Which documented-limitation rows the banked region's own new terms create or worsen — phase 2
  is where this gets a real answer.
- Whether `sample-rpg-mmc1` ultimately carries naming — Chris's own call, designed in full either way.
- The exact frame budgets in §14's own test helpers (`waitForNamingReady`'s 40, `gotoCell`'s 26) are
  reasoned from the raise sequence's own known length (four frames) and the grid's own known column
  count (26), with generous headroom, not measured against a real assembled ROM — phase 2's own tests
  will tighten or loosen them against reality.
- **New this round.** `NAME_ENTRY_ACTION_KERNEL_ALLOWANCE` (722 bytes, §11) is the banked grid's own
  static count, reused unchanged for the kernel-lo placement — a real, board-independent measurement of
  the *same source assembled a different way* has never been taken, since neither placement has been
  built yet; phase 2 measures both. `NAME_ENTRY_KERNEL_ALLOWANCE`'s own 95-byte figure (§4) is flagged
  stale rather than re-derived: the shim rewrite (§5) demonstrably moves it (four call sites shrank by 2
  bytes each, five new shims were added at 3-5 bytes each), but by how much depends on real assembly,
  not arithmetic done here. `HERO_DEFAULT_KERNEL_ALLOWANCE` (21 bytes, §8/§11 -- widened this round by
  P2-3, table 10 plus `init_session`'s own action-side copy loop 11) is still the one exception, not
  merely its table half: the loop is a fixed, branch-free instruction sequence (`ldy #NAME_LEN-1` /
  `lda hero_name_default,y` / `sta pc_name_ram,y` / `dey` / `bpl ...`) whose byte width nesasm can be
  trusted to match on paper the same way the table's own row already was, per §11's own fuller
  argument for why this term alone earns that trust. `NAME_TOKEN_KERNEL_ALLOWANCE` (§9a) is unmeasured entirely, a placeholder
  until phase 2b. The four-action-fixture headroom table (§11) is real, measured, present-tense data —
  not reasoned — but what it is compared *against* (the 857-byte static estimate) inherits every one of
  the unmeasured figures above, so which boards actually refuse hero naming once the real code exists
  is itself an open question this round's own honest arithmetic raises rather than closes (§11's own
  correction to the brief's "expect `sample-mmc3` and `sample-u512`" framing).
- `text_type_name`'s own listing (§9a) is unbuilt code, like every other listing in §3-§5, §7-§9a — the
  same status every banked-machinery listing in v12 carried before phase 2 assembled it for the first
  time. Nothing about it has been run through nesasm.

## Changelog

- **v15.1**: one P3 from round 3, the only finding on v15 — round 3 otherwise passed every
  substantive check. Per-section line counts, v15 → v15.1 (awk `## §`-boundary): §0 217→217, §1
  38→38, §2 45→45, §3 61→61, §4 507→507, §5 763→763, §6 86→86, §7 195→195, §8 319→319, §9 155→155,
  §9a 462→462, §10 36→36, §11 497→497, §12 65→65, §13 164→164, §14 367→367, §15 295→295, §16
  161→161, §17 59→59, §18 12→12, §19 483→(this entry, grows). No section shrank; every section but
  §19 (this entry) is byte-for-byte untouched. `.if`/`.endif`: 49/49, unchanged.
  - **P3** ("Places a claim could not be pinned to a line and was reasoned instead", ~:4580-4589):
    this section still described `HERO_DEFAULT_KERNEL_ALLOWANCE` as 10 bytes, table-only, and used
    846 as the action-side static total — both stale since P2-3 (v15) widened the term to 21 bytes
    (table 10 + `init_session`'s own copy loop 11) and recomputed the total to 857. Fixed in place:
    the passage now states 21 bytes and explains, agreeing with §11's own fuller argument (~:3031-
    3038) rather than contradicting it, that the *whole* 21-byte term — table and loop together —
    stays this document's one true "exact, not reasoned" exception, because the loop is a fixed,
    branch-free instruction sequence whose width nesasm can be trusted to match on paper the same way
    the table's own row already was; and the 846-byte comparison figure corrected to 857. (A first
    pass at this fix wrongly reclassified the loop half as an unmeasured, phase-2-only static count,
    contradicting §11's own paragraph — caught by re-reading §11 immediately after, before this entry
    was written, and corrected to agree with it rather than left standing as a second live
    inconsistency.)
  - **Grep, whole document, every non-historical occurrence**: `846` (5 hits total — one in this
    fix's own §19 passage, now 857; four inside the v13→v14 and v14→v14.1 Changelog entries
    describing that round's own then-current figure correctly, left as history); `10 bytes`/
    `10-byte` in connection with `HERO_DEFAULT`/the default-name table (8 hits — one now corrected in
    §19 above; the rest either describe `hero_name_default`'s own 10-byte *table* specifically, which
    is still accurate since the table itself did not change size, or sit inside v14/v14.1/v15
    Changelog entries describing a past round's own then-current figure, left as history); `HERO_
    DEFAULT_KERNEL_ALLOWANCE = 10` (0 live hits anywhere in the document). No other live statement
    found.
  - Findings not contested: none.

- **v15**: round-2 review findings on v14.1 — NO-GO, one P1 (a real defect) and three P2s, all four
  fixed. Per-section line counts, v14.1 → v15 (awk `## §`-boundary line counts, both baselines
  mechanical rather than hand-counted): §0 217→217, §1 38→38, §2 45→45, §3 61→61, §4 504→507, §5
  763→763, §6 86→86, §7 193→195, §8 300→319, §9 155→155, §9a 411→462, §10 36→36, §11 418→497, §12
  65→65, §13 164→164, §14 367→367, §15 282→295, §16 145→161, §17 59→59, §18 12→12, §19 420→(this
  entry, grows). No section shrank. `.if`/`.endif`: 49/49, unchanged — none of this round's four fixes
  touched an assembly listing, only JS predicates, generated-flag prose and §11's arithmetic.
  - **P1-1** (§9a): `projectUsesNameToken` walked `projectEvents` alone (`shared/eventrules.js:249`),
    which yields authored events only — plain dialogue (`entity.props.dialogue`,
    `main/build/textcompile.js:541`) is a separate compile path with no event object to be yielded, so
    a project whose only `{name}` sat in plain dialogue got `TXT_NAME` bytes compiled with
    `NAME_TOKEN_ENABLED = 0` — no runtime expansion arm assembled at all, and no seed either. Fixed:
    a new shared helper, `shared/eventrules.js`'s `effectiveDialogue(entity)` (§9a, ~:2830), applies the
    compiler's own precedence rule (`compiledPages(entity.props?.event).length` wins — read straight off
    `textcompile.js`'s own dialogue-vs-event choice at `:541`) so a `{name}` in dialogue an authored
    event has already shadowed is correctly not counted; `projectUsesNameToken` now walks both the
    events half (unchanged) and every placed entity's `effectiveDialogue` (§9a, ~:2842), and
    `projectWithoutNameToken` strips `entity.props.dialogue` unconditionally, matching the existing
    events-half `allCommands`-broad strip philosophy rather than `effectiveDialogue`'s own live-only
    read (§11, ~:3141). New §15 test: a token in plain dialogue only enables the flag and shows the real
    name; the identical token on an entity whose own authored event compiles a live page does not.
  - **P2-2** (§7, §11): `party_join`'s copy loop widened to `NAME_SEED_ENABLED` in an earlier round
    (token-only RPGs included), but §11's banked ledger still charged both banked terms under one
    shared `NAME_ENTRY_ENABLED` gate and charged neither for a token-only RPG — a real 47-byte
    under-reservation. Fixed: a new shared predicate, `shared/project.js`'s `projectNeedsNameSeed`
    (§11, ~:2951), and `battleRegionBytes` (`main/build/battletables.js:803`) now charges
    `NAME_ENTRY_BATTLE_ALLOWANCE` on `projectUsesNameEntry(project) && banked` and
    `NAME_COPY_BATTLE_ALLOWANCE` separately on `projectNeedsNameSeed(project) && banked` — two
    independently gated terms, not one. `kernelCodeBytes`'s own `usesNameSeed` local (§4) now calls the
    same shared function rather than restating the formula inline. Three new matrix rows, 19-21 (§11),
    isolate the token-only case on its own — the one configuration where "one shared gate" and "two
    independent gates" predict different numbers (0 vs. 47) — bringing the isolation matrix to 21
    points; the `bankedbytes.test.js` isolation-test list in §15 updated to match.
  - **P2-3** (§8, §11): `init_session`'s 11-byte `hero_name_default` copy loop (action-only,
    `NAME_SEED_ENABLED && !BATTLE_ENABLED`) was real kernel-lo code with no allowance of its own — not
    the 10-byte `HERO_DEFAULT_KERNEL_ALLOWANCE` table (data, not the loop that reads it) and not
    `NAME_TOKEN_KERNEL_ALLOWANCE` (unrelated text-handling code). Fixed: folded into
    `HERO_DEFAULT_KERNEL_ALLOWANCE` itself, now table-plus-loop, 10 + 11 = **21 bytes**, one term rather
    than two, because on the only game type the loop ever compiles for (action), its own gate reduces
    algebraically to exactly `projectNeedsHeroDefault(project)` — the identical predicate the table's
    own gate already reduces to there (§8). §11's action-side static estimate recomputed from 846 to
    **857** bytes (95 + 722 + 15 + 21 + 4), and the four-fixture FITS/REFUSED table recomputed:
    `sample` 1008−857=151 free, FITS (was 162); `sample-mmc1` 812−857=−45, REFUSED (was −34);
    `sample-mmc3` 613−857=−244, REFUSED (was −233); `sample-u512` 445−857=−412, REFUSED (was −401) — no
    conclusion about which boards refuse changes, only the margins, each moving by exactly the same 11
    bytes the flat term adds. A new paragraph also states the hero-naming + token both-enabled case by
    name: the combined static total is 857 + `NAME_TOKEN_KERNEL_ALLOWANCE`, that second term is still
    explicitly unmeasured (§9a), and `sample`'s own 151-byte margin is what phase 2b's real measurement
    of it has to fit inside before the two features can ship together on an action project.
  - **P2-4** (§11, §15): two prescribed tests set the obsolete `project.rpg.nameHeroAtStart` — the
    field moved to `project.project.nameHeroAtStart` in v13 (§9). Fixed both (§11's `measureCodeBytes`
    options comment, ~:3216; §15's MMC3 split-coverage test's own fixture setup, ~:4099). Grepped the
    whole document for every `rpg.nameHeroAtStart`/`rpg?.nameHeroAtStart` occurrence afterward: three
    remain, all historical — §9's own "the field moves from `project.rpg.nameHeroAtStart` to
    `project.project.nameHeroAtStart`" sentence describing the move itself, and two v13/v14 Changelog
    entries (~:4723, ~:4747-4749) describing that same move and a prior stale-reference fix, in the
    past tense, correctly as written. No other occurrence found.
  - **Also**: §16 gained a new trap — `projectEvents` yields authored events only; plain dialogue is a
    separate compile path with no event object of its own — naming both source lines (P1-1's own root
    cause, generalized for future code that walks events looking for "everything the project says").
  - Findings not contested: none — round 2 is what produced these findings; this entry is the response
    to it, not a second round's own review of it.

- **v14.1**: two internal contradictions the orchestrator found in v14, before this round ever reached
  a reviewer — both are single-writer-rule violations, the same class of defect this document's own
  Changelog has already named more than once (X1's own sprite-CHR-stamp/reservation mismatch, X2's
  `battleShortfallAdvice` suppression). Per-section line counts, v14 → v14.1: §0 217→217, §1 38→38, §2
  45→45, §3 61→61, §4 482→504, §5 763→763, §6 86→86, §7 193→193, §8 264→300, §9 155→155, §9a 411→411,
  §10 36→36, §11 418→418, §12 65→65, §13 164→164, §14 367→367, §15 282→282, §16 145→145, §17 59→59,
  §18 12→12, §19 368→420. No section shrank; only §4 and §8 (where both formulas lived) and §19 (this
  entry) actually grew.
  - **Finding 1**: §8's own `NAME_SEED_ENABLED` definition read `HERO_NAMING_ENABLED ||
    NAME_TOKEN_ENABLED` — hero OR token, silently dropping Join naming — while the very next sentence
    claimed this was "deliberately not `NAME_ENTRY_ENABLED`" (hero OR join), a direct
    self-contradiction the stated formula could not even be compared against correctly. Real
    consequence: a project with a named Join and neither hero naming nor a token would compile
    `party_join`'s own copy loop as dead code, so a recruit's `pc_name_ram` slot would never be seeded
    and that Join's own naming grid would open on whatever garbage RAM already held. Fixed:
    `NAME_SEED_ENABLED = NAME_ENTRY_ENABLED || NAME_TOKEN_ENABLED` (hero OR join OR token), with one
    sentence each for why hero naming, Join naming and the token all need the seed (§8). Every
    occurrence of `NAME_SEED_ENABLED` in the document was grepped and cross-checked; only the one
    definition site and one changelog paraphrase (v14's own entry, below) stated the formula at all,
    both now corrected to agree.
  - **Finding 2**: `needsHeroDefault` was defined twice — `kernelCodeBytes`'s own local (§4) still read
    v13's own `usesHeroNaming || (usesNameToken && gameType !== 'rpg')`, charging an RPG with hero
    naming the 10-byte `HERO_DEFAULT_KERNEL_ALLOWANCE` table, while `generateAssets`'s own emission-site
    local (§8) already carried P1-2's own correct `gameType !== 'rpg' && (usesHeroNaming ||
    usesNameToken)` and would never actually emit that table for the same project — a real, ten-byte
    disagreement between the ledger and the generator `kernelbytes.test.js`'s own equality assert would
    have caught as a failing test on the first RPG-with-hero-naming build in phase 2, not before. Fixed
    by making it a genuine single-writer function, `shared/project.js`'s own
    `projectNeedsHeroDefault(project)` (§8), consumed identically by both call sites — the same
    `battleBankEnabled`-style move §9 already made once for the identical reason. Grepped for a third
    copy: none found.
  - **While there (item 3 of the brief)**: every other flag/predicate appearing in more than one
    listing was grepped and cross-checked — `NAME_ENTRY_ENABLED`, `JOIN_NAMING_ENABLED`,
    `NAME_ENTRY_BANKED`, `usesNameToken`/`projectUsesNameToken` all agreed everywhere already. **A
    third real inconsistency turned up doing this, not asked for by name but squarely inside "grep for
    every other flag/predicate"**: §4's own "why `projectUsesNameEntry` is the correct gate" passage
    (the Y1 fix's own explanation) still stated `HERO_NAMING_ENABLED = projectUsesHeroNaming(project)
    && battleEnabledFor(project, mapper)` — v12's own formula, stale since D8 dropped that `&&` in v13,
    left uncorrected through both v13 and v14 — and, immediately after it, the further stale claim that
    `projectUsesNameEntry` is "`false` for every action project unconditionally," false since D6. Fixed
    in place: the formula now matches §9's own `HERO_NAMING_ENABLED = projectUsesHeroNaming(project)`,
    and the false claim is corrected to state that an action project with hero naming on now has
    `projectUsesNameEntry(project) === true`, exactly what makes the input-row mechanism this passage
    is explaining able to reserve `ST_NAMEENTRY`'s own row for such a project at all. A second real gap
    found the same way: `generateAssets`'s own config.inc emission code block (§4/§9) never actually
    emitted `NAME_TOKEN_ENABLED` or `NAME_SEED_ENABLED` at all, despite prose elsewhere (§8, §9a)
    describing both as already emitted there — both added to the one real emission block, not a second
    site.
  - Findings not contested: none.

- **v14**: round-1 review findings on v13 — NO-GO, four P1s (real defects) and four P2s, all eight
  fixed. Per-section line counts are this entry's own second-to-last bullet, below.
  - **P1-1** (§9a, §16): the token's own source pointer (`ptr_lo`/`ptr_hi`) did not survive between two
    frames of the same token — `text_type_name`'s own "select the source table on frame 0 only"
    shortcut assumed a value it set would still be there later, but `draw_entities`' own animation
    lookup (`engine/entities.asm:494-521`, run every frame from `main_loop_draw`) clobbers both bytes
    for its own purposes in between. Fixed by reloading `ptr_lo`/`ptr_hi` on every frame the token is
    in progress, dropping the shortcut and the invariant prose that justified it; kept as a named trap
    in §16.
  - **P1-2** (§3, §7, §8, §9a, §16): two v13 arms read the banked `pc_name` table directly from
    kernel-lo code that never went through `call_battle`'s own trampoline — a silently wrong read
    (whatever screen data happened to be mapped), not an assembler error. Fixed at the source rather
    than around the read: the token now always reads `pc_name_ram` slot 0 unconditionally (§3's own
    three-way swap removed down to one arm); `pc_name_ram` slot 0 is seeded correctly by construction
    instead — a new union flag, `NAME_SEED_ENABLED = NAME_ENTRY_ENABLED || NAME_TOKEN_ENABLED` (hero OR
    join OR token — this entry's own formula corrected in v14.1, below, which found it had silently
    dropped the join disjunct), widens `party_join`'s own pre-existing copy loop (§7), which
    `party_init` (`engine/battle.asm:54`) already
    calls for every starting member including the hero, confirmed this round by reading the loop rather
    than assumed; `init_session`'s own kernel-lo RPG arm is deleted outright, and its action-side arm
    (copying `hero_name_default` directly, no pointer indirection needed) is what remains. Consequence:
    `needsHeroDefault` (§8) excludes RPGs entirely, since their own seed never touches
    `hero_name_default` at all — `gameType !== 'rpg' && (usesHeroNaming || usesNameToken)`, not v13's
    own `usesHeroNaming` alone. Confirmed which PRG bank is mapped at each of `init_session`'s four
    callers (`boot.asm:49`, `title.asm:234`/`256`, `save.asm:541`) — irrelevant to the action-side arm,
    since kernel-lo is always mapped regardless.
  - **P1-3** (§5, §15, §16): `NAME_LEN`'s sole writer, `battleTables` (`main/build/
    battletables.js:291`), is itself omitted from an action project's own build (`generate.js:2432`) —
    an undefined-symbol assembler error the moment kernel-lo code (the action-placed grid, or the
    token's own `text_type_step` arm) referenced it. Fixed by moving the equate to `config.inc`,
    emitted unconditionally (`generate.js`'s own `config` array, beside `NUM_VARIABLES`), and deleting
    `battletables.js`'s own now-redundant line. §5's own "every external symbol is kernel-lo" audit is
    corrected to actually include `NAME_LEN` in its own list, having omitted it the first time — the
    round-1 finding this whole defect traces back to. `test/unit/rammap.test.js`'s own phase-1-shipped
    `pc_name_ram: 40` literal can become a derived `MAX_PARTY * NAME_LEN` expression once this lands —
    named in §15 as a phase-2 follow-up, not applied to the already-shipped file directly.
  - **P1-4** (§9a, §15): `encodeLine`'s own listing returned `{ bytes, unmapped }`; `encodeString`'s
    real, existing caller line (`main/build/textcompile.js:140`) reads `mapped.tiles`, unchanged —
    `bytes.push(...mapped.tiles)` against a `{ bytes, unmapped }` object reads `undefined`. Fixed by
    returning `{ tiles, unmapped }` from both of `encodeLine`'s own branches (matching what
    `textToTiles` already returns, so the non-token branch needed no change at all) rather than
    changing the caller — the caller line quoted in §9a is now byte-for-byte the same line that exists
    in the tree today.
  - **P2-5** (§9a, §15): a choice option label goes through the identical `internString`/`encodeString`
    path a `Say` does, but `text_choice_step`'s own draw loop (`engine/text.asm:503-509`, confirmed
    this round to have no control-byte dispatch of its own at all) would `vram_push` a raw `TXT_NAME`
    byte as if it were a glyph tile — a real, undefined-tile rendering glitch, not merely wrong text.
    Fixed with a new `allowNameToken` parameter on `encodeString`/`internString`, default `false`,
    passed `true` only at the `Say` and "plain dialogue" call sites (`:241`, `:554`), left at its
    default for the choice-label call site (`:471`). A choice label containing the literal `{name}`
    still compiles — as six ordinary characters, rendering as furniture-bracket, "name", furniture-
    bracket — so `validateProject` gains a **warning** (not a refusal) naming the Map Forge.
    `wrapText` itself is deliberately left unchanged (a documented scope decision, not a second bug):
    a choice label's own token-shaped substring still gets measured as 10 visual columns even though
    it will render as 6 literal characters, a cosmetic-only overestimate this round chooses not to
    spend a second parameter threading through `wrapText` to close.
  - **P2-6** (§9a): the preview's own padded-name substitution happened *before* `wrapText` ran,
    letting the padded name's own internal spaces desync the preview's line breaks from the compiler's
    real, token-aware wrap. Fixed by wrapping the literal, unsubstituted text first (the identical call
    the compiler makes), then substituting the display name into each already-wrapped line — a plain
    string swap that cannot move a line break once wrapping has already decided it.
  - **P2-7** (§8, §13): the "Default name" control edited `heroName` on an RPG project too, where
    nothing reads it — the real default there is `party[0].name`, through `pc_name`. Fixed: the Player
    tab (§13) shows the editable field only for an action project; an RPG sees `party[0].name`
    read-only, with a hint pointing at the Party tab. The preview's own display-name source (P2-6)
    follows the identical rule. `normalizeProject`'s own behavior for a stored `heroName` on an RPG:
    kept, not stripped, simply ignored — the same dormant-field convention `project.rpg`'s own fields
    already hold to on an action project.
  - **P2-8** (§11): two arithmetic errors, both found and fixed by re-deriving every §11 figure from
    the post-phase-1 headroom directly rather than adjusting the v13 numbers by hand. (a)
    `sample-rpg`'s own hero-naming total (198) had omitted `HERO_DEFAULT_KERNEL_ALLOWANCE`, which v13's
    own (then-unfixed) `needsHeroDefault` formula should have charged it — moot now that P1-2's
    correction excludes every RPG from that term structurally, so 198 is confirmed correct, for the
    right reason this time, not merely left alone. (b) `sample-rpg-mmc1`'s own row charged phase 1's
    +3-byte `SAVE_FIELDS` cost a second time, on top of post-phase-1 headroom that already reflects it
    — corrected from 166 needed / 355 free to **163 needed / 358 free**. The action-side 846-byte
    estimate and the "only `sample` fits" conclusion were re-checked against all three P1 fixes and
    found unaffected — none of P1-1/P1-2/P1-3 changes the size of any term the 846-byte figure sums,
    only gating logic or an unrelated, separately-ledgered term (the token's own allowance).
  - A stale `project.rpg.nameHeroAtStart` reference survived into §15's own Phase 3 UI test
    description, never updated when §9 moved the field to `project.project` during v13 itself — found
    while pinning lines for this round, corrected alongside the eight findings though not one of them.
  - Findings not contested: none — round 1 is what produced these findings; this entry is the response
    to it, not a second round's own review of it.
  - **Per-section line counts, v13 → v14** (awk `## §`-boundary line counts, both baselines mechanical
    rather than hand-counted): §0 217→217, §1 38→38, §2 45→45, §3 50→61, §4 482→482, §5 734→763, §6
    86→86, §7 190→193, §8 221→264, §9 155→155, §9a 289→411, §10 36→36, §11 394→418, §12 65→65, §13
    142→164, §14 367→367, §15 239→282, §16 110→145, §17 59→59, §18 12→12, §19 278→368. Every section
    at or above its v13 count; none shrank. Sections touched by this round's own eight fixes: §3, §5,
    §7, §8, §9a, §11, §13, §15, §16, plus this Changelog and the intro/title. Sections this round left
    completely untouched: §0, §1, §2, §4, §6, §9, §10, §12, §14, §17, §18 — none of the eight findings
    reached them.
- **v13**: action-project support (D6/D8) and the Say token (D7), Chris's decisions from 2026-09-08
  evening. Every section below §1 grew from its v12 line count; none shrank (per-section counts,
  v12 → v13, awk `## §`-boundary line counts, both baselines mechanical rather than hand-counted):
  §0 156→217, §1 10→38, §2 19→45, §3 23→50, §4 387→482, §5 559→734, §6 80→86, §7 183→190, §8 83→221,
  §9 123→155, §9a (new) 0→289, §10 22→36, §11 253→394, §12 52→65, §13 78→142, §14 356→367, §15
  169→239, §16 63→110, §17 30→59, §18 7→12, §19 172→198 (§19's own count includes the un-headered
  "Places a claim..."/Changelog lead-in in both baselines, an existing measurement quirk, not new
  this round). Sections touched: every one. Sections whose *content* is unchanged, restated only to
  say so and cite why (§6, §7's own Join-naming-stays-RPG-only half, §10's own already-shipped body):
  §6, most of §7, §10.
  - **D6** (§1 item 10, §9): `projectUsesHeroNaming` drops its own `gameType === 'rpg'` gate —
    "`return project?.project?.gameType === 'rpg' && Boolean(project?.rpg?.nameHeroAtStart);`" becomes
    "`return Boolean(project?.project?.nameHeroAtStart);`" — and the field moves from
    `project.rpg.nameHeroAtStart` to `project.project.nameHeroAtStart`. `normalizeRpg` no longer
    carries it at all; `normalizeProject`'s own `project` object does. Nothing shipped with v12's own
    location (grepped, no match), so no migration is needed. §1 item 3 ("Naming applies to the hero —
    `project.party[0]`...") rewritten in place: an action project has no `party` array at all, so the
    hero is `pc_name_ram` slot 0 directly, never a party-indexed fact.
  - **D8** (§1 item 12, §4, §5, §9, §11): one source file, two mutually exclusive placements
    (`NAME_ENTRY_BANKED = battleBankEnabled(project, mapper)`), decided per project+mapper, never a
    hybrid. Five new kernel-lo shims (`name_begin`/`name_tick`/`name_draw`/`name_select`/
    `name_cancel`) replace every v12 hook site's own direct `call_battle` reference, since
    `call_battle` itself is `.if BATTLE_ENABLED`-wrapped and does not exist on an action build — four
    hook sites in §4 rewritten in place (`do_action_confirm`'s "`lda #BE_NAME_SELECT / jsr
    call_battle`" → "`jsr name_select`"; `do_action_cancel`'s, `draw_ui`'s and `text_tick`'s analogous
    `jmp call_battle` sites → `jmp name_cancel`/`name_draw`/`name_tick`) plus `start_game`'s and
    `reset`'s own `BE_NAME_BEGIN` sites in §8 (`lda #0 / sta bt_arg / lda #BE_NAME_BEGIN / jsr
    call_battle` → `lda #0 / jsr name_begin`). `kernelCodeBytes`'s own three `usesX` locals (§4, X1's
    second fix) rewritten in place: `usesHeroNaming`/`usesNameEntry` drop their own `&& battleEnabled`,
    which v12 needed only because naming was RPG-only; `usesJoinNaming` keeps it, Join naming stays
    RPG-only. A new, genuinely independent kernel-lo term, `NAME_ENTRY_ACTION_KERNEL_ALLOWANCE` (§11),
    charges the grid's own body when it lands in kernel-lo instead of the banked region.
  - **A real bug found while pinning D8, beyond what the brief named**: v12's own proposed
    `spriteReservedRanges`/CHR-stamp widening (§4's X1 third fix) both ANDed the naming disjunct with
    an RPG-only or code-region-only condition — `(gameType === 'rpg') && (fontBankSplit(...) ||
    projectUsesNameEntry(project))` and `(fontSplit && codeRegionCount(project))` respectively —
    which would refuse the sprite reservation and leave the cursor tile blank on exactly the game type
    D8 exists to add it to. Both rewritten in place this round to move the naming disjunct outside the
    AND — `(gameType === 'rpg' && fontBankSplit(...)) || projectUsesNameEntry(project)` and
    `(fontSplit && codeRegionCount(project)) || projectUsesNameEntry(project)`.
  - **§5's own split_select finding, stronger than what the brief asked to confirm**: reading
    `split_select` to its own final, unconditional fallback arm (not just its two named `.if` blocks)
    shows `box_state != BOX_CLOSED → SPL_BOX` sitting outside both `.if TITLE_ENABLED` and `.if
    BATTLE_ENABLED` — it already covers `BOX_NAMEENTRY`/`BOX_NAMEDONE` on every board and every game
    type, with no naming-specific code needed at all, stronger than v12's own §15 catches-line implied
    ("`split_select` never being told to arm the font program").
  - **D7** (§1 item 11, §3, §8, §9a, new): the Say token, `{name}`, expanded at runtime from
    `pc_name_ram` slot 0. New: `TXT_NAME = $03`, `text_type_step`'s own `text_type_name` arm and its
    three-way pointer swap (RAM when naming is on; `pc_name` when off on an RPG; `hero_name_default`
    when off on an action project), `encodeString`'s own token-splitting `encodeLine`, `wrapText`'s
    own `visualLength`/`truncateAtVisualLimit` corrections, the event editor's and box preview's own
    10-column placeholder, `validateProject`'s new refusal, `NAME_TOKEN_KERNEL_ALLOWANCE`.
  - **`project.project.heroName`** (§8, new): the default hero name, `"Hero"`, A-Z/a-z only, max 10 —
    compiled into `hero_name_default` only for the projects that need it (`needsHeroDefault`), read by
    `init_session`'s own re-seed (corrected in place: v12's own §15 catches-line already named this
    re-seed but only ever specified it seeding from `pc_name`, since v12 had no other source; now a
    two-way `.if BATTLE_ENABLED` swap between `pc_name` and `hero_name_default`) and by the token's own
    third reader when naming is off.
  - **A factual correction to this round's own reasoning, caught and fixed before it shipped**: an
    early draft of the `project.project` vs. `project.rpg` placement argument (§9) claimed
    `project.rpg` "is only ever normalized for an RPG" — checked directly against `shared/project.js:
    5257` and found false: `normalizeRpg` runs unconditionally, for every project. The move to
    `project.project` is unaffected — `project.rpg` is still the *RPG-settings* object by every
    existing convention this codebase already holds it to, regardless of whether it is technically
    reachable on an action project — but the sentence claiming the field could not be reached there is
    corrected in place rather than left standing on a checked-and-wrong premise.
  - **A correction to the brief's own capacity expectation, reported rather than silently matched**:
    the brief's own steer for §11 expected `sample-mmc3` and `sample-u512` to become documented-
    limitation refusals once hero naming turns on, with `sample-mmc1` implied to still fit. Computed
    directly against §0's own re-measured post-phase-1 headroom and the static 846-byte action-side
    estimate, `sample-mmc1` refuses too (812 free, 846 needed, 34 short) — only `sample` (NROM, 162
    bytes to spare) fits. Reported as measured, not adjusted to match the brief's own guess.
  - §0 gains its own new provenance block for everything read to write this round that v12 never
    needed (`engine/text.asm`'s control-byte chain, `shared/font.js`'s `wrapText`/border constants,
    `main/build/textcompile.js`'s `encodeString`, `engine/split.asm`'s full `split_select`,
    `engine/banks.asm`'s `call_battle`, `engine/main.asm`'s own `.include` sequence, the Sprite Forge's
    own tab list, `createProject`/`normalizeProject`'s own `project:` block) plus the post-phase-1
    kernel-lo headroom re-measurement for all four action fixtures.
  - Findings not contested: none — this round has not yet been reviewed.

- **v12**: GO at round 11; two P3 nits folded in.
  - §14 Lua phase 3.31's own readiness check now requires `box_state == BOX_NAMEENTRY` *and*
    `box_row >= BOX_TEXT_ROWS` together, not `box_row` alone — `box_begin`'s own `BOX_OPENING`/
    `BOX_CLEARING` raise (`engine/text.asm:319`) also advances `box_row` before `box_handover`
    (`:433`) resets it and hands `box_state` over to the real requested phase, so `box_row` alone
    could already read past `BOX_TEXT_ROWS` while the box is still merely opening — matching the
    JavaScript helper (`namingReady()`), which already checked both.
  - §14 Lua's defensive `read(BOX_STATE) ~= BOX_ENDWAIT` guard inside phase 3.4's own `box_after`
    check is removed, along with its own explanatory paragraph: `BOX_ENDWAIT` is declared nowhere
    in this design's own Lua constants or in `save_sram.lua` itself, so in real Lua the comparison
    is against `nil` and always passes — a guard that never actually guards anything. The
    `box_after == BOX_NAMEENTRY` check ahead of it is the entire interception; nothing else is
    needed.
  - Findings not contested: none.
- **v11**: fixes three P2s in the test/Lua specification (Z1-Z3, one of them — Z1 — a genuine
  regression against a mechanism round 5 had already accepted) and two P3 prose corrections (Z4, Z5).
  - **Z1** (§14, regression): v10's own Lua fix checked `box_state == BOX_NAMEENTRY` to intercept a
    naming transition, but `box_state` does not reach `BOX_NAMEENTRY` until several frames after
    `box_begin` requests it — `box_begin` (`engine/text.asm:183-184`) stores the requested phase into
    `box_after` first, and `box_state` sits at `BOX_OPENING`/`BOX_CLEARING` throughout the raise. Since
    `game_state` is already `ST_DIALOG` from the start of the whole touch-triggered page, the existing
    `ST_DIALOG` check would already have claimed the frame for Say-dismissal before `box_state` ever
    reached `BOX_NAMEENTRY` — the same class of "too late" defect round 4's own U6 already fixed once,
    by intercepting on `box_after` instead, which round 10's own rewrite of this section had quietly
    gone back on. Fixed by checking `box_after` (a new Lua constant, along with `box_state`/`box_row`/
    the naming addresses, none of which existed in `save_sram.lua` before this change) before the
    existing dialogue check, and by keeping the identical check inside the existing Say-dismissal phase
    too, for a Join that follows a Say in some other authored page.
  - **Z2** (§14): `bootPastNaming`'s own `ST_NAMEENTRY` and `clearName`'s own `NAME_LEN` were both
    referenced without ever being declared in the JS constant listing — a real `ReferenceError` on
    execution. Both are added, with the file's own provenance-comment convention; `PC_NAME_RAM` is
    added too. `save_sram.lua`'s own new constants are now spelled out explicitly and confirmed (by
    grepping the real file) not to exist there already — a JavaScript declaration defines nothing in a
    separate Lua process.
  - **Z3** (§15): row 24 is the box's own top border, not "above the box" — the split program switches
    the font bank in exactly at that row (`engine/split.asm:53`), so asserting `'art'` there would
    reject correct behavior. The "above the box" probe is now row 2, matching the existing test's own
    established probe exactly. The test now explicitly drives a named Join (walking to the recruiter,
    reaching the grid inside `ST_DIALOG`, probing, ending, probing the field restored) alongside hero
    naming, not hero naming alone — a Join's own session never changes `game_state`, so a test that only
    exercised the hero's own `ST_NAMEENTRY` path could not catch `split_select` failing to recognize a
    Join's own naming session at all.
  - **Z4** (§11): rows 16-18 of the absolute-check list now state two separate, region-appropriate
    accuracy bars instead of one — kernel-lo holds to `assertCovers`'s own margin band, the banked
    region requires exact equality between measured and predicted bytes (`bankedbytes.test.js:346`,
    `assert.equal`, never a band), since the banked model has no estimation error the kernel-lo model
    does.
  - **Z5** (§13): the Controller Forge paragraph's own last stale claim — "a Join names the party
    member entirely within `ST_GAMEPLAY`" — corrected to `ST_DIALOG`, matching §7's own correction from
    round 9.
  - Findings not contested: none.
- **v10**: fixes two regressions v9's own restoration pass introduced (Y1, Y2), a measurement-fidelity
  gap in the isolation matrix (Y3), a real coverage gap in the MMC3 split test (Y4), and a P3 clutch of
  factual corrections in restored prose (Y5).
  - **Y1** (§4/§10/§15/§17, regression): v9's own X1 fix made `input_actions`' seventh row
    unconditional, which would have added 4 bytes to every ROM ever built after this feature shipped —
    action projects and non-naming RPGs included — falsifying the very naming-off byte-identity
    requirement §15/§17 both state and §10's own `sample/` claim. Fixed by gating the row's emission
    (and `kernelTableBytes`'s own charge for it) on `projectUsesNameEntry(project)` alone — no `mapper`
    argument needed, since the code-side gate that could ever write `ST_NAMEENTRY` into `game_state`
    always implies this predicate, and it is the same content-only shape `kernelTableBytes`'s own
    existing `boundTilesEnabled` term already uses. Restored §10's own `sample/` byte-identity claim on
    that basis, and corrected the fixture arithmetic to say the 4 bytes are paid only because
    `sample-rpg`/`sample-rpg-mmc1` each opt into naming, never universally.
  - **Y2** (§7/§13/§14, regression): v9's own restored test helpers checked `game_state ===
    ST_NAMEENTRY` for readiness, which is correct only for the hero's own session — a named Join runs
    entirely inside `ST_DIALOG` (`engine/ui.asm:227-233`), since nothing in `script_op_join_call` ever
    touches `game_state`, so those same helpers would time out the moment a test drove a named Join.
    `namingReady()` is corrected to `box_state === BOX_NAMEENTRY && box_row === BOX_TEXT_ROWS`,
    independent of `game_state` entirely — the one signal both a hero session and a Join session
    actually share. Every constant is now a real value (no `0x??` placeholder), every loop is bounded
    with its own assertion (`clearName`'s own `while` was unbounded), `talkThrough` now detects and
    hands off to the grid before its own dialogue-advance loop rather than never seeing it, and §7
    gained an explicit note on why `script_resume`'s own `script_active` check already makes ending a
    hero session and ending a Join session safe through the identical code path. `test/lua/
    save_sram.lua`'s own new logic is now real Lua, inserted at its two real, cited points (the phase-2
    Continue snapshot, and phase 3.3 before its own dialogue check), including the pulsed navigation
    and the ten-byte-per-slot snapshot/comparison.
  - **Y3** (§11/§15): the isolation matrix now specifies every row as a real `nesasm`-measured delta
    (`measureCodeBytes`/`measureRegion`, the same helpers `kernelbytes.test.js`/`bankedbytes.test.js`
    already use) rather than a delta between two calls to `kernelCodeBytes`/`battleRegionBytes` on
    project data, which could never detect the assembled code drifting while the constant charged for
    it stayed put. The titleless difference-of-differences (X3) is restated against measured bytes, and
    the absolute `assertCovers`-shaped checks are kept as their own separate list, now explicitly tied
    to a real margin-band check rather than a bare non-negative sign check.
  - **Y4** (§15): the MMC3 split test is now a real framebuffer probe in `test/unit/split.test.js`
    (font pixels on rows 25-28, map art intact above, restored after END), the same technique that
    file's own existing Say-coverage test uses — a source-text scan for mapper-register writes cannot
    detect `split_select` simply never being told to arm the font program for `BOX_NAMEENTRY`. The
    register-write scan is kept as its own separate, narrower check. Every test in §15 now names its
    destination file.
  - **Y5** (§6/§12/§16): fixed the DOWN-then-UP/UP-then-DOWN sentence, which had contradicted itself
    (claiming DOWN-then-UP fails to round-trip, then describing why it does); corrected `nm_len` from
    "contiguous non-space cells from the left" to "trailing padding trimmed," since the seed scan
    trims only the trailing run and an authored default name's own internal space would survive it;
    corrected `BOX_COLS` from an assumed 32 to its real value, 28 (`shared/font.js:39`), making a grid
    row packet 31 bytes, not 35; attributed the "1670-1740 cycles" figure to CLAUDE.md's own
    two-producer measurement rather than the three-producer case naming actually joins, and cited the
    real three-producer bound (the Lua timing proof) separately; and changed "round 8 confirmed
    assembles cleanly" to "round 8 statically checked," since round 8 was reviewer analysis with no
    real build.
  - Findings not contested: none.
- **v9**: restores the depth several earlier rewrites had worn away (X0) and fixes the three
  remaining round-8 integration gaps (X1-X3).
  - **X0** (orchestrator, whole document): §6 (cursor movement/typing/deleting), §12 (cycle budget),
    §13 (UI), §14 (test infrastructure), §15 (tests), and §17 (phasing) are restored to full depth —
    §6 now documents the grid's own real, deliberately asymmetric UP/DOWN ring (a genuine mechanism
    this design already built but had stopped describing accurately); §12 now derives the cycle-budget
    bound instead of asserting it; §13 carries real code for both the Sprite Forge and Map Forge
    controls, modeled on this codebase's own existing checkbox pattern; §14 carries full, working test
    helpers (`gotoCell`, `clearName`, `typeNameAndFinish`, `bootPastNaming`) written defensively against
    §6's own asymmetry, plus the Lua fixture's own new phases; §15 names, per test, the wrong
    implementation each one catches, per the original brief's own requirement. No section is smaller
    than its v8 counterpart.
  - **X1** (§4/§7/§9/§11): `INPUT_STATES` actually gains its seventh entry, `EVENT_COMMANDS`'s `join`
    entry actually gains a second (`'named'`) arg so the normalizer's own per-arg loop can reach it,
    `EXCEPTIONAL_WIDTHS` gains a real `join: 2` entry (needed *because* of the args-array growth, not
    despite it — the generic width formula would otherwise mispredict 3), the input-row's own
    unconditional 4-byte cost is derived from real code and explicitly separated from the naming-gated
    allowances it is not part of, `kernelCodeBytes`/`generateAssets` both gain the concrete local
    booleans and ledger/flag lines that were previously described only as "a prior round's" work, and
    the sprite CHR-art stamp (`generate.js:2327`) is widened to match the reservation
    `spriteReservedRanges` already widened, so a non-split naming-only board actually draws the cursor
    art it reserves a tile for.
  - **X2** (§11): `battleShortfallAdvice` now suppresses its naming-removal candidates entirely when
    `exact` is false, rather than merely rewording them — an overridden battle system's own deficit is
    computed from `battleTableBytes` alone (`generate.js:2036`), which naming's removal never changes,
    so offering it there was advice about the wrong quantity, not merely an unhedged one. A regression
    test is named for it.
  - **X3** (§11): the titleless isolation is corrected from a single raw "titleless minus titled"
    comparison (which silently included the 212/224-byte title allowance) to a same-toggle,
    different-title-state delta comparison that cancels the title term out algebraically. The
    isolation matrix is listed exactly — 18 points, not "roughly 21" — with the triangulation algebra
    for all four kernel-lo terms shown in full.
  - Findings not contested: none.
- **v8**: closed 6 round-7 integration blockers and two P3s — the branch-range fix, the `battle_entry`
  naming-off gate, the `battleShortfallAdvice` parameter contract, combined-removal advice, exact
  isolation-delta wording, `BATTLE_REGION_SOURCES`, adopted byte counts, and the MMC3/VRAM-queue
  citation fixes. Superseded in full by the standalone body above.
- **v7, v6, v5, v4, v3, v2, v1**: superseded in full by the standalone body above.
