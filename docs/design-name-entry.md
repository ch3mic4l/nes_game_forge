# Design: in-game party-member name entry — v12

Chris wants the player to be able to type a name in-game: for the hero at the start of a new game,
and for any party member the moment an authored Join recruits them. This document is fully
standalone — every mechanism below is specified completely in this body, with every `.if` gate
written out, so it can be implemented without access to any earlier round of this design. The grid's
own drawing/input machinery lives in the banked battle region (§5), reached from a handful of tiny
kernel-lo hooks (§4) through five new `call_battle` entry points — the move round 7 accepted, and
round 8 statically checked every branch's range and the capacity arithmetic (no build was run). Round
9 fixed the input-row byte-identity regression and rewrote the isolation matrix against measured bytes;
round 10 found the JS readiness helpers still checked the wrong state for a Join and gave the banked
split coverage no framebuffer proof; round 11 fixed the Lua interception's own "too late" defect and
returned GO with two P3 nits, folded into this round. No section below is allowed to shrink from here
without the Changelog saying what was cut and why.

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

## §1. Chris's decisions (2026-09-08) — restated, not reopened

1. Maximum name length is 10, `RPG_LIMITS.nameLength`.
2. The grid offers A-Z and a-z, 52 glyphs, no digits or punctuation, no space.
3. Naming applies to the hero (`project.party[0]`) at the start of a new game, and to any Join that
   opts in.
4. The RPG starter and `sample-rpg` both opt in.
5. Delete and Done are grid controls, not new bindable actions; Delete is also reachable through the
   existing Cancel action wherever a project's own controller mapping already binds it (§4).

## §2. RAM — every address, all unconditional equates

46 bytes total — 40 for `pc_name_ram`, 6 scalar bytes — placed in the confirmed-unused `$0568-$05FF`
gap past `sting_shadow_inst_base` (`$0570`). Every address below is a plain, unconditional equate.
The banked naming code reuses `bt_tmp` for its own drawing/write scratch, needing no dedicated byte
of its own beyond the six listed here.

```
pc_name_ram    = $0571  ; @size=40 -- MAX_PARTY*NAME_LEN
nm_target      = $0599  ; which party slot (0-3) the open naming session writes into
nm_len         = $059A  ; letters committed so far, 0-NAME_LEN
nm_row         = $059B  ; grid cursor row: 0=A-Z, 1=a-z, 2=controls (DEL/END)
nm_col         = $059C  ; grid cursor column: 0-25 on rows 0/1, 0(DEL)/1(END) on row 2
nm_named       = $059D  ; script_op_join's own scratch (§7)
nm_acted       = $059E  ; per-frame latch: at most one grid action per frame (§4)
```

`test/unit/rammap.test.js`'s `KNOWN_MAX_SIZES` gains: `pc_name_ram: 40,`.

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

## §4. The new game state, the readiness gate, every kernel-lo hook, the branch-range fix, and the two
capacity terms this round wires up for real (X1)

**`ST_NAMEENTRY = 6`**; **`BOX_NAMEENTRY = 9`**, the grid up and interactive; **`BOX_NAMEDONE = 10`**,
an inert value set once END is selected, matched by nothing in `text_tick`, `text_advance`,
`do_action_confirm`/`do_action_cancel`, or `draw_ui`.

**The readiness gate**: `box_row == BOX_TEXT_ROWS` in addition to `box_state == BOX_NAMEENTRY`,
everywhere below. **The per-frame action latch**, `nm_acted`, checked and set inside the banked
`nameentry_select`/`nameentry_cancel` (§5).

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
     lda #BE_NAME_SELECT
     jsr call_battle                 ; runs nameentry_select, banked (§5)
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
     lda #BE_NAME_CANCEL
     jmp call_battle                 ; tail call -- nameentry_cancel (banked)
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

**Every hook's own byte cost**:

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
  lda #BE_NAME_DRAW
  jmp call_battle               ; tail call -- runs draw_nameentry_cursor,
                                 ; banked (§5)
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
  lda #BE_NAME_TICK
  jmp call_battle               ; tail call -- runs nameentry_tick, banked (§5)
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
code could write `ST_NAMEENTRY` into `game_state`, and every such write is gated by
`HERO_NAMING_ENABLED = projectUsesHeroNaming(project) && battleEnabledFor(project, mapper)` (§8) —
which implies `projectUsesHeroNaming(project)`, which itself implies `projectUsesNameEntry(project)`
by definition (§9). So `projectUsesNameEntry(project)` is always true whenever the code-side gate could
possibly be true, making it a safe (if very occasionally generous) superset gate that needs no mapper
at all — the identical, content-only shape `kernelTableBytes`'s own existing `boundTilesEnabled` term
already uses for its own conditional 30 bytes, so this is not a new pattern for this function, only a
second instance of an existing one. `projectUsesNameEntry` is `false` for every action project
unconditionally (both of its own disjuncts require `gameType === 'rpg'`, §9), so `sample/`'s own
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

**X1's second fix: `checkCapacity`/`generateAssets`'s own shared boolean, made concrete.**
`kernelCodeBytes` (`generate.js:1031-1124`) gains three more `usesX` locals, reusing the `battleEnabled`
local it already computes at `:1047` rather than recomputing `battleBankEnabled` a second time:

```js
// main/build/generate.js:1047 (existing) plus three new locals, same block
const battleEnabled = battleEnabledFor(project, mapper);
const usesNameEntry = projectUsesNameEntry(project) && battleEnabled;      // NAME_ENTRY_ENABLED
const usesJoinNaming = projectUsesJoinNaming(project) && battleEnabled;    // JOIN_NAMING_ENABLED
const usesHeroNaming = projectUsesHeroNaming(project) && battleEnabled;    // HERO_NAMING_ENABLED
const usesHeroNamingTitleless = usesHeroNaming && !usesTitle;              // && !TITLE_ENABLED
```

and four more terms in the function's own return expression, beside `usesBoundTiles`'s:

```js
    (usesNameEntry ? NAME_ENTRY_KERNEL_ALLOWANCE : 0) +
    (usesJoinNaming ? JOIN_NAMING_KERNEL_ALLOWANCE : 0) +
    (usesHeroNaming ? HERO_NAMING_KERNEL_ALLOWANCE : 0) +
    (usesHeroNamingTitleless ? HERO_NAMING_TITLELESS_KERNEL_ALLOWANCE : 0) +
    KERNEL_SLACK
```

`generateAssets`'s own `config.inc` emission gains the three `_ENABLED` flags themselves, beside the
`BATTLE_ENABLED`/`BATTLE_BANK` lines it already writes from the same `codeSlots` local (`:2412-2413`,
`:2660-2661`):

```js
// main/build/generate.js, immediately after BATTLE_TILESET's own line
const usesNameEntry = projectUsesNameEntry(project) && codeSlots.length > 0;
const usesJoinNaming = projectUsesJoinNaming(project) && codeSlots.length > 0;
const usesHeroNaming = projectUsesHeroNaming(project) && codeSlots.length > 0;
...
`NAME_ENTRY_ENABLED = ${usesNameEntry ? 1 : 0}`,
`JOIN_NAMING_ENABLED = ${usesJoinNaming ? 1 : 0}`,
`HERO_NAMING_ENABLED = ${usesHeroNaming ? 1 : 0}`,
```

**X1's third fix: the sprite CHR stamp, widened to match the widened reservation.**
`spriteReservedRanges` (§5) already reserves `SPRITE_ARROW_TILE` on every
board once `projectUsesNameEntry(project)` is true, not only on a split board — but the art stamp at
`generate.js:2327` was never widened to match, confirmed this round to still read `if (fontSplit &&
codeRegionCount(project))` alone, meaning a naming-only, non-split board (MMC1, UNROM 512) would
reserve the tile and leave it blank. Fixed by widening the same condition `spriteReservedRanges` uses:

```js
// main/build/generate.js:2322-2329, corrected
if ((fontSplit || projectUsesNameEntry(project)) && codeRegionCount(project)) {
  for (const tileset of tilesets) tileset.sprites[SPRITE_ARROW_TILE] = SPRITE_ARROW_ART;
}
```

`codeRegionCount(project)` is the same gate `spriteReservedRanges` already ANDs with `gameType ===
'rpg'` — both reduce to "is this an RPG at all," which is necessary but not sufficient on its own
(`battleEnabledFor`'s own mapper-capability check is what `NAME_ENTRY_ENABLED` itself further
requires, per §9), and is retained here unchanged rather than widened further, since the existing
`fontSplit` arm already relies on exactly this same weaker check today and no defect report exists
against it.

## §5. The banked naming machinery — `engine/nameentry.asm`, included from `battle.asm`, and
`battle_entry`'s own dispatch

**Why a new file, not appended to `battle.asm`/`battleui.asm` directly:** the naming grid shares no
code and no data with the turn-based battle system beyond the bank and the `bt_tmp`/`ptr_lo`/`ptr_hi`
scratch both already have. `engine/battle.asm` gains one line, alongside its own existing `.include
"battleui.asm"` (`engine/battle.asm:659`):

```
  .if NAME_ENTRY_ENABLED
  .include "nameentry.asm"
  .endif
```

**`BATTLE_REGION_SOURCES` (`main/build/battletables.js:633`) gains `'nameentry.asm'`**:

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

**Every routine below is reached either directly by `jmp`/`jsr` from another routine in this same
file, or from `battle_entry`'s own extended dispatch via a `BE_NAME_*` entry code loaded into `A`
before `call_battle` runs.** Two new config.inc constants and four glyph-tile constants, generated
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

**`battle_entry`'s own dispatch chain, extended with five new arms.** HEAD's own final arm is
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
board once naming is on:

```js
export function spriteReservedRanges(project, mapper) {
  const ranges = [{ start: 0, end: PLAYER_TILES, label: 'the player' }];
  if (projectUsesHeartArt(project)) {
    ranges.push({ start: HEART_FULL_TILE, end: LIMITS.tilesPerTable, label: 'the HUD hearts' });
  }
  if (project.project?.gameType === 'rpg' && (fontBankSplit(project, mapper) || projectUsesNameEntry(project))) {
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

The CHR-art stamp that fills the reserved tile with real pixels, widened to match this reservation, is
§4's own X1 fix, above — the two must move together, and now do.

## §6. Cursor movement, typing, deleting — the grid's own rules, restored in full, including the ring's
real (and slightly asymmetric) shape

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

**`party_join`'s own name-copy loop — already banked, unaffected by this round's own fixes:**

```
party_join:
  lda pc_in_party,x
  bne party_join_done
  lda #1
  sta pc_in_party,x
  inc party_size
  .if NAME_ENTRY_ENABLED
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

## §8. How the hero opts in — three real arrivals, `game_state` before `redraw_screen`

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
  sta bt_arg
  lda #BE_NAME_BEGIN
  jsr call_battle
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
  sta bt_arg
  lda #BE_NAME_BEGIN
  jsr call_battle
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

## §9. Game types — three admission points, hero default input, and the normalizer/UI wiring

```js
export function projectUsesHeroNaming(project) {
  return project?.project?.gameType === 'rpg' && Boolean(project?.rpg?.nameHeroAtStart);
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
// shared/project.js, beside battleBankEnabled
export function projectWithoutHeroNaming(project) {
  const clone = structuredClone(project);
  clone.rpg.nameHeroAtStart = false;
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

**`normalizeRpg`'s one real caller** (`shared/project.js:5257`) threads `gameType` through:

```js
const rpg = normalizeRpg(raw.rpg, tilesets.length, project.gameType);
```

```js
function normalizeRpg(raw, tilesetCount, gameType) {
  const base = defaultRpg();
  return {
    xpBase: clamp(raw?.xpBase, 1, 255, base.xpBase),
    xpGrow: clamp(raw?.xpGrow, 0, 255, base.xpGrow),
    maxLevel: clamp(raw?.maxLevel, 1, RPG_LIMITS.maxLevel, base.maxLevel),
    battleTilesetId: clamp(raw?.battleTilesetId, 0, Math.max(0, tilesetCount - 1), 0),
    encounterMusic: raw?.encounterMusic ?? null,
    nameHeroAtStart: gameType === 'rpg' && Boolean(raw?.nameHeroAtStart)
  };
}
```

`defaultRpg()` gains `nameHeroAtStart: false`.

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
specifically — Join-only naming never enters `ST_NAMEENTRY`:

```js
export const bindableStates = (project) =>
  INPUT_STATES.filter(
    (state) =>
      state in STATE_LABELS &&
      (state !== 'title' || projectUsesEffectiveTitle(project)) &&
      (state !== 'nameentry' || projectUsesHeroNaming(project))
  );
```

`NAME_ENTRY_ENABLED = projectUsesNameEntry(project) && battleEnabledFor(project, mapper)`,
`JOIN_NAMING_ENABLED = projectUsesJoinNaming(project) && battleEnabledFor(project, mapper)`,
`HERO_NAMING_ENABLED = projectUsesHeroNaming(project) && battleEnabledFor(project, mapper)`.

## §10. Save — the descriptor field, the version bump, and exactly what shifts

`shared/save.js`'s `SAVE_FIELDS` gains `{ ram: 'pc_name_ram', size: RPG_LIMITS.party *
RPG_LIMITS.nameLength }` (40, three more descriptor bytes: `LOW`/`HIGH`/`len`, one each, in the
generated `save_field_lo/hi/len` tables — a real, unconditional kernel-lo cost for every save-enabled
project regardless of whether naming is used). `SAVE_LAYOUT_VERSION` bumps 2 → 3. `save_write_body`/
`load_apply_body` need no changes.

`text.asm`/`script.asm`/`input.asm`/`music.asm`/`assets/usercode.inc` all shift, sitting in
kernel-lo's own sequential run after `save.asm`. `assets/kernel_hi.inc`/`assets/music.inc`/
`assets/text.inc` are unaffected, since `kernel_hi.inc` opens with its own fresh `.bank <N> / .org
$E000`.

This affects `sample-mmc1`, `sample-mmc3`, `sample-u512`, and `sample-rpg-mmc1`. `sample-rpg/` carries
no Save command, untouched unless it opts into naming. **Every ROM with neither Save nor naming —
`sample/` included — is fully byte-identical, on both counts named here and on the input-row count
§4's own Y1 fix restores**: `sample/`'s own `gameType` is `'action'`, so `projectUsesNameEntry(sample)`
is `false` by construction (§9 — both of its disjuncts require an RPG), which is what keeps its own
`input_actions` table at today's 24 bytes rather than growing to 28 the moment `INPUT_STATES` gained a
seventh entry — a claim that only holds because that entry's own row is conditionally emitted (§4), not
because the schema array happens not to matter to this fixture.

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

**These two banked terms share one gate, `NAME_ENTRY_ENABLED`, and there is no build-time lever that
turns one on without the other.** `battleRegionBytes` (`main/build/battletables.js:803-809`) becomes:

```js
export function battleRegionBytes(project, mapper) {
  return (
    baseBattleCodeBytes(mapper) +
    battleTableBytes(project) +
    (projectUsesItems(project) ? ITEM_LIST_FILTER_BATTLE_ALLOWANCE : 0) +
    (projectUsesNameEntry(project) && battleBankEnabled(project, mapper)
      ? NAME_ENTRY_BATTLE_ALLOWANCE + NAME_COPY_BATTLE_ALLOWANCE
      : 0)
  );
}
```

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
moment a candidate removal would turn `projectUsesNameEntry` false.

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
// main/build/generate.js:1380-1396, two more entries in the existing active array
if (projectUsesHeroNaming(project)) {
  active.push({ label: 'hero naming at the start of a new game', strip: projectWithoutHeroNaming });
}
if (projectUsesJoinNaming(project)) {
  active.push({ label: 'every named Join', strip: projectWithoutJoinNaming });
}
```

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
  withHeroNaming = false,   // project.rpg.nameHeroAtStart = true
  withJoinNaming = false    // the fixture's own Join gains named: true
}
```

**The matrix, listed exactly, 18 points total, each a real `nesasm`-measured delta asserted with
`assert.equal` unless noted, never a same-formula-against-itself comparison:**

| # | Region | Boards | Build A vs. Build B | Save | Real assertion | Expected |
|---|---|---|---|---|---|---|
| 1-3 | Banked | MMC1, MMC3, UNROM 512 | `measureRegion` with naming off vs. both hero + Join naming on | — | `used(B) - used(A)` | 812 |
| 4-6 | Kernel-lo | MMC1, MMC3, UNROM 512 | `measureCodeBytes({withJoinNaming: false})` vs. `{withJoinNaming: true}`, titled | off | `codeBytes(B) - codeBytes(A)` | 159 (N+J) |
| 7-9 | Kernel-lo | MMC1, MMC3, UNROM 512 | `measureCodeBytes({withHeroNaming: false})` vs. `{withHeroNaming: true}`, titled | off | `codeBytes(B) - codeBytes(A)` | 110 (N+H) |
| 10-12 | Kernel-lo | MMC1, MMC3, UNROM 512 | naming off vs. `{withHeroNaming: true, withJoinNaming: true}`, titled | off | `codeBytes(B) - codeBytes(A)` | 174 (N+H+J) |
| 13-15 | Kernel-lo | MMC1, MMC3, UNROM 512 | naming off vs. `{withHeroNaming: true}`, **`withTitle: false`** | off (illegal with title) | `codeBytes(B) - codeBytes(A)` | 130 (N+H+HT) |
| 16-18 | Both | MMC1, MMC3, UNROM 512 | one real build with naming (hero+Join) + title + Save all on | on | the build itself: nesasm exits 0; kernel-lo's real measured margin sits inside `assertCovers`'s `[KERNEL_SLACK, KERNEL_SLACK * 2]` band; the banked region's real measured usage equals `battleRegionBytes`'s own prediction exactly | pass |

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
own tables-alone-overflow regression is a separate correctness check, outside this 18-point isolation
matrix, since it does not measure a delta either.

**Do the two real fixtures fit, with real margin?**

```
sample-rpg (titleless at HEAD, both hero and Join naming, no Save):
  kernel-lo: 95 (shared) + 64 (Join) + 15 (hero) + 20 (hero, titleless hook)
             + 4 (input-row -- paid here because this fixture opts into naming, §4's own Y1 fix;
                  an RPG that did not opt in would pay 0 of this) = 198 bytes
             1283 bytes free at HEAD -> 1283 - 198 = 1085 bytes free after

sample-rpg-mmc1 (titled, carries a Save command; Join naming only):
  kernel-lo: 95 (shared) + 64 (Join) + 4 (input-row -- same reasoning, paid because this fixture
             opts into Join naming)
             + 3 (SAVE_FIELDS descriptor growth, unconditional for any save-enabled project) = 166 bytes
             524 bytes free at HEAD -> 524 - 166 = 358 bytes free after

Both fixtures, banked:
  812 bytes needed
  sample-rpg:      3441 - 812 = 2629 bytes free after
  sample-rpg-mmc1: 3451 - 812 = 2639 bytes free after
```

Both fixtures fit, on both ledgers, with hundreds to low thousands of bytes of margin left over.
`KERNEL_SLACK` is not a statement about how much of the 8 KB bank remains unused — it is the floor
(and, at double its value, the ceiling) `assertCovers` (`test/unit/kernelbytes.test.js:238-257`) holds
the *combined, measured reservation's own accuracy* to, once every live term is counted — proof the
formula tracks nesasm's real usage closely, not a claim about spare bank space.

**`kernelShortfallAdvice`/`battleShortfallAdvice`** both correctly offer naming-removal candidates now
— kernel-lo's through the existing generic combination search, banked's through the hand-rolled
solo-then-both search matching HEAD's own lever-based shape, suppressed on the banked side whenever
`exact` is false per X2.

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

## §13. UI — the Sprite Forge checkbox, the Map Forge join-row checkbox and summary suffix, with real
code for both, modeled on this codebase's own existing patterns rather than invented

**The Sprite Forge's party panel** (`renderer/forges/sprite/battle.js`) already renders a per-member
row with its own "Starts in the party" checkbox (`:87-95`); hero naming is a project-level flag that
only ever means anything for `party[0]` (decision 3), so its own checkbox is rendered on that member's
row alone, using the identical `el('label.check', ...)` shape already established two lines above it in
the same file:

```js
// renderer/forges/sprite/battle.js, inside partyPanel's own party.map(...) row builder
index === 0
  ? el(
      'label.check',
      { title: 'The player types this name at the start of a new game' },
      el('input', {
        type: 'checkbox',
        checked: Boolean(store.project.rpg.nameHeroAtStart),
        onchange: (event) => {
          store.commit('Change hero naming', (project) => {
            project.rpg.nameHeroAtStart = event.target.checked;
          });
          rerender();
        }
      }),
      ' Player names this member at the start'
    )
  : null
```

`el()`'s own null-skipping (CLAUDE.md's "Conventions" section) is what lets this sit unconditionally
inside every member's row without a second branch for members 1-3.

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

  Build an MMC3 `SAMPLE_RPG` variant with `project.rpg.nameHeroAtStart = true` and the recruiter's own
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
- *The 18-point kernel/banked ledger matrix (§11), plus the absolute worst-case build per board.*
  (`test/unit/kernelbytes.test.js` for rows 4-15 and the kernel-lo half of 16-18; `test/unit/
  bankedbytes.test.js` for rows 1-3 and the banked half of 16-18.) Catches: any of the four kernel-lo
  terms or the two banked terms silently drifting from their documented value as the real
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

**Phase 3 (UI):** (`main/smoke.js`, driving the real renderer, for all three — this is UI behavior a
`node:test` process cannot exercise directly.) The Sprite Forge's hero-naming checkbox (`checked`
reflects `project.rpg.nameHeroAtStart`, `onchange` commits and rerenders — catches a checkbox wired to
`oninput` instead, which would commit on every intermediate browser event rather than once on change);
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

**Every label in every listing was extracted and measured this round.** None exceeds 25 characters;
the longest is `do_action_confirm_notname`. X0-X3's own fixes are entirely JavaScript-side (schema,
generator, advice functions) and test-side, touching no nesasm label or `.if`/`.endif` gate anywhere in
the assembly listings in §3-§5, §7 and §8 — the count below is re-verified directly against this
document's own final text, not assumed to hold from an earlier round:

- §3 (the reader swap): two pairs.
- §4 (the kernel-lo hooks, including the branch-range fix): fourteen pairs — the `do_action_pause`
  relay's own two arms plus the pre-existing `SAVE_ENABLED` Continue arm (three); `do_action_confirm`'s
  own `NAME_ENTRY_ENABLED` gate plus its pre-existing `TITLE_ENABLED` arm (two); `do_action_cancel`'s
  own entry gate, its retargeted "during play" check's own two mutually-exclusive arms, its
  `ST_NAMEENTRY` fallthrough guard, and its own shared local `do_action_cancel_wait` label's gate
  (five); `draw_ui` (one); `ui_tick`'s own pre-existing `BATTLE_ENABLED` arm plus its new
  `NAME_ENTRY_ENABLED` arm (two); `text_tick` (one). 3+2+5+1+2+1 = 14.
- §5 (the banked machinery): four pairs — the one-line `.include "nameentry.asm"` gate in
  `battle.asm`; the whole-file `.if NAME_ENTRY_ENABLED` wrapping every routine in
  `engine/nameentry.asm`; and `battle_entry`'s own dispatch, two independent pairs (the
  `be_restore_chk`'s own comparison, and the five new arms past it).
- §7 (`script_op_join`/`party_join`): three pairs.
- §8 (`start_game`/`reset`): five pairs — `start_game`'s own `HERO_NAMING_ENABLED` arm and its
  `!HERO_NAMING_ENABLED` counterpart (two); `reset`'s pre-existing `TITLE_ENABLED` arm, its
  `!TITLE_ENABLED` counterpart, and the `HERO_NAMING_ENABLED` gate nested inside that `!TITLE_ENABLED`
  arm (three).

2 + 14 + 4 + 3 + 5 = **28** `.if`/`.endif` pairs total, confirmed this round by direct `grep -c
'^\s*\.if '`/`grep -c '^\s*\.endif\s*$'` count of this document's own final text (28 and 28, balanced).

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

## §17. Phasing

1. **The save migration alone.** `SAVE_FIELDS`'s new entry, `SAVE_LAYOUT_VERSION` 2→3, every RAM
   equate in §2. Fixtures regenerated; SHA-256 of all six pinned. Reviewable and mergeable on its own:
   nothing downstream depends on anything but the version bump and the RAM layout existing.
2. **The gated engine core.** `engine/nameentry.asm` and `battle_entry`'s own extended dispatch
   (banked, §5), `BATTLE_REGION_SOURCES` extended (§5), `party_join`'s copy loop (banked, §7), the
   kernel-lo hooks including the branch-range fix (§4), `script_op_join`'s growth (§7), `start_game`/
   `reset`'s hero hooks (§8), the schema fixes (`INPUT_STATES`'s seventh entry, `join.args`'s second
   entry, `EXCEPTIONAL_WIDTHS`'s `join: 2`, §4/§7's own X1 fixes), all normalizer/predicate work
   including the shared `battleBankEnabled`/`projectWithoutHeroNaming`/`projectWithoutJoinNaming`
   helpers (§9), all capacity allowances measured for real against nesasm's own output (not the static
   count this document uses), `kernelShortfallAdvice`/`battleShortfallAdvice` both correctly extended
   including X2's own suppression. Every real fixture rebuilt with naming still off and re-hashed
   against phase 1's own pins — this phase must leave every existing test green with the feature fully
   present but universally disabled, the same discipline every prior optional feature in this codebase
   shipped under.
3. **UI.** The Sprite Forge checkbox and its real setter, the Map Forge checkbox and summary suffix,
   the Controller Forge's hero-gated row (§13). Independently reviewable once phase 2's own predicates
   exist, since the UI layer only ever writes the same fields phase 2 already reads.
4. **Starter/fixture opt-in.** `shared/starters/rpg.js` and `tools/make-rpg-sample.js` opt in per
   decision 4; `sample-rpg-mmc1`'s own Join gets `named: true` and `save_sram.lua` gains its own new
   phases (§14); every `rpg.test.js` caller of `boot()` that needs it switches to `bootPastNaming()`.
   Left last among the functional phases deliberately: it is the only one that changes what a shipped
   fixture's own ROM contains, and every other phase's own tests must already be green against the
   feature switched off before this phase turns it on for two real projects.
5. **Docs.** CLAUDE.md's own budget check (§15), a short passage naming `nameentry.asm`'s place in
   the banked include graph and the five new `BE_NAME_*` entry points, paid for with a trim elsewhere
   in the file.

## §18. Out of scope, explicitly

Renaming an already-recruited member later; naming a monster or any non-party actor; digits,
punctuation, or any glyph outside A-Z/a-z; any new save-atomicity mechanism beyond `pc_name_ram`
riding the existing `SAVE_FIELDS` sequence; an action-project equivalent of any of this;
localized/non-Latin name entry.

## §19. Open questions for Chris

1. RPG-only, action projects fully invisible — recommended, enforced three independent ways (§9).
2. No space in the grid — recommended.
3. The controls-row UP/DOWN snapping rule, and its own deliberate asymmetry with DOWN (§6) — a
   plausible default with no existing engine precedent to anchor it; worth a taste check specifically
   on whether the one-press UP shortcut from A-Z straight to the controls row (skipping a-z) feels
   right, versus a simpler, fully-mirrored ring that costs an extra press to reach DEL/END from either
   letter row.
4. Does `sample-rpg`'s own opt-in cover hero-naming, Join-naming, or both? Recommended: both — and
   §11's own fit numbers assume exactly this for `sample-rpg` (both, and titleless) and Join-only for
   `sample-rpg-mmc1` (open question 5 below).
5. `sample-rpg-mmc1` carrying `named: true` on its own Join, with `save_sram.lua` driving the grid —
   the only way to meet the original brief's own byte-exact restored-name requirement for this
   fixture. Chris's veto stands either way.
6. Continue's own title prompt showing the saved name — out of scope unless wanted.

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

## Changelog

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
