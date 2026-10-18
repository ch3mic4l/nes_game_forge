; battle.asm -- the turn-based battle system, in its own switchable PRG bank.
;
; Everything in this file is assembled at $8000 in the region shared/cartridge.js
; reserves with `codeRegions()`, which is *not* mapped most of the time: the
; switchable window normally holds screen data, and `player.asm` dereferences
; `mtptr` out of it every single frame. So there is exactly one way in and one
; way out, both in engine/banks.asm:
;
;   call_battle   switches this bank in, jsr's battle_entry, and restores the
;                 screen bank with `jsr set_screen_ptr` before returning.
;
; Nothing else in the engine may `jsr` into $8000-$BFFF. Calling *out* is free:
; the kernel at $C000-$FFFF is permanently mapped, so the tables and helpers in
; text.asm, ui.asm and entities.asm are all reachable from here.
;
; Combatants live in one index space -- 0-3 are party members, 4-7 monsters --
; which is what lets the cursor, the targeting and the turn order be one code
; path rather than two that have to agree.

battle_entry:
  lda <bt_call
  bne battle_entry_tick
  jmp party_init
battle_entry_tick:
  .if SW_DLG_BANKED
  ; The streamed dialogue overlay's entry points (engine/streamdialog.asm) --
  ; every BE_DLG_* is >= BE_DLG_FIRST, so one compare keeps them off the chain
  ; below. Far away by include order, hence the jmp.
  cmp #BE_DLG_FIRST
  bcc battle_entry_notdlg
  jmp be_dlg_dispatch
battle_entry_notdlg:
  .endif
  cmp #BE_TICK
  bne battle_entry_join
  jmp battle_tick
battle_entry_join:
  cmp #BE_JOIN
  bne battle_entry_restore
  ldx <bt_arg                ; the Join command, run from the field mid-script
  ; A stale or hand-edited member (NO_MEMBER, or a numeric one the deleting
  ; party member's own party.length no longer covers) must not reach
  ; party_apply_level -> level_row, whose per-level tables are sized to
  ; PARTY_SIZE * MAX_LEVEL, not MAX_PARTY * MAX_LEVEL -- the same access
  ; party_init_slot already guards a few lines below (cpx #PARTY_SIZE /
  ; bcs party_init_next) before its own call to party_join. This is that
  ; guard's twin for the *other* caller: party_init already protects itself,
  ; and this is the asymmetry that was the defect.
  cpx #PARTY_SIZE
  bcs battle_entry_join_skip
  jmp party_join
battle_entry_join_skip:
  rts                        ; back to call_battle's own jmp set_screen_ptr --
                              ; battle_entry is reached by jsr, never jmp, so
                              ; this rts is the correct, and only, return.
battle_entry_restore:
  .if NAME_ENTRY_ENABLED
  cmp #BE_RESTORE
  bne be_name_begin_chk
  .endif
  jmp party_restore
  .if NAME_ENTRY_ENABLED
; The naming grid's own five entry points (engine/nameentry.asm), reached
; only through the kernel-lo shims' own NAME_ENTRY_BANKED arm -- never
; directly, and never on an action project, where nameentry.asm assembles
; into kernel-lo instead and this whole dispatch chain does not exist.
be_name_begin_chk:
  cmp #BE_NAME_BEGIN
  bne be_name_tick_chk
  lda <bt_arg
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

; ------------------------------------------------------------- a new game

; Build the party from the generated tables. Members who do not start in the
; party are left out until a Join command recruits them.
party_init:
  lda #0
  sta <party_size
  sta <gold_lo
  sta <gold_hi
  ldx #0
party_init_slot:
  lda #0
  sta pc_in_party,x
  sta pc_xp_lo,x
  sta pc_xp_hi,x
  lda #1
  sta pc_level,x
  cpx #PARTY_SIZE
  bcs party_init_next
  lda pc_starts,x
  beq party_init_next
  jsr party_join
party_init_next:
  inx
  cpx #MAX_PARTY
  bne party_init_slot
  .if EQUIP_ENABLED
  jmp equip_init            ; every member's starting pieces, then the bonus cache
  .else
  rts
  .endif

; X = member index. Recruit them at their current level and fill them up.
party_join:
  lda pc_in_party,x
  bne party_join_done
  lda #1
  sta pc_in_party,x
  inc <party_size
  ; Seeds pc_name_ram from the banked pc_name table -- widened from
  ; NAME_ENTRY_ENABLED to the wider NAME_SEED_ENABLED union
  ; (docs/design-name-entry.md §8, P1-2): party_init already calls this
  ; routine for every starting member, member 0 (the hero) included, so this
  ; is the RPG's own working seed path -- nameentry_begin's own preview-row
  ; scan (engine/nameentry.asm) needs a real name already sitting here the
  ; instant a naming session opens.
  .if NAME_SEED_ENABLED
  lda #LOW(pc_name)
  sta <ptr_lo
  lda #HIGH(pc_name)
  sta <ptr_hi
  txa
  jsr name_offset_pc
  stx <bt_tmp
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
  ldx <bt_tmp
  .endif
  jsr party_apply_level
  lda pc_hp_max,x
  sta pc_hp,x
  lda pc_mp_max,x
  sta pc_mp,x
party_join_done:
  rts

; X = member index. Read this member's stats for their current level out of the
; per-level tables. The tables are pre-computed by the generator because the
; 6502 has no multiply and fifteen bytes a member is cheaper than the code.
party_apply_level:
  txa
  jsr level_row             ; Y = member * MAX_LEVEL + level - 1
  lda pc_hp_at,y
  sta pc_hp_max,x
  lda pc_mp_at,y
  sta pc_mp_max,x
  lda pc_spells_at,y
  sta pc_spells,x
  rts

; BE_RESTORE: continue_game (engine/save.asm) calls this once, right after
; load_apply_body has overwritten RAM with the save record, to recompute
; every member's pc_spells (and, as an accepted side effect, pc_hp_max/
; pc_mp_max) from their restored pc_level against the *current* build's own
; tables. The save's raw pc_spells byte is a bitmask of catalog *positions*,
; not spell ids, and nothing renumbers it when a spell is deleted -- a save
; written before the delete would otherwise restore a party that knows the
; wrong spell, or one that no longer exists.
;
; Unconditional over every PARTY_SIZE slot, live or not -- no pc_in_party
; check. An unjoined slot's pc_spells/pc_hp_max/pc_mp_max are dead data by
; the engine's own convention (nothing reads them until pc_in_party goes
; live), and the only other writer that ever sets pc_in_party, party_join,
; unconditionally calls party_apply_level again the moment it does -- so
; whatever this loop computes for an unjoined slot is guaranteed to be
; overwritten with the then-current level's own figures regardless.
;
; Bounded PARTY_SIZE, not MAX_PARTY: pc_hp_at/pc_mp_at/pc_spells_at are each
; sized to the authored party count, not the fixed RAM capacity -- a
; MAX_PARTY-bounded loop would read past the end of those tables the moment
; a project's own party is smaller than four, which sample-rpg's already is.
; party_apply_level preserves X (it only ever reads X via txa; level_row
; never touches X), so the loop needs no save/restore of its own index
; across the call.
party_restore:
  ldx #0
party_restore_slot:
  jsr party_apply_level
  inx
  cpx #PARTY_SIZE
  bne party_restore_slot
  .if EQUIP_ENABLED
  ; Continue's restore: pc_equip was just loaded from the record (the bonuses are never saved), so
  ; rebuild them, and drop any worn id the sanitizer finds stale.
  jmp equip_recalc
  .else
  rts
  .endif

  .if EQUIP_ENABLED
; ------------------------------------------------------------------ equipment (docs/design-equipment.md)
; pc_equip is slot-major: index = slot * MAX_PARTY + member, NO_ITEM = empty. A worn piece has left the
; bag (equip_set), so Carrying and Take never see it. pc_eq_* are the per-member bonus caches that
; combatant_* adds after its level-derived stat; they are recomputed at exactly three triggers --
; equip_set, equip_init (party_init) and party_restore (Continue) -- and never saved.

; Recompute every member's bonus from the worn ids. Also the ONE place a stale worn id is dealt with: an
; id whose eq_slot entry is not this byte's slot (an ordinary item, a piece of another slot, or a
; non-equipment id whose zero-filled column says $FF) is emptied and contributes nothing. The piece is
; then neither worn nor in the bag -- the documented outcome for a stale or hand-edited save. usableBy is
; not re-validated here. Every sum saturates at 255. Clobbers A, X, Y and bt_tmp.
equip_recalc:
  ldx #0
equip_rc_member:
  lda #0
  sta pc_eq_atk,x
  sta pc_eq_def,x
  .if EQUIP_MAG_ENABLED
  sta pc_eq_mag,x
  .endif
  .if EQUIP_MDEF_ENABLED
  sta pc_eq_mdef,x
  .endif
  stx <bt_tmp                 ; the pc_equip index: member, member+MAX_PARTY, member+2*MAX_PARTY
equip_rc_slot:
  ldy <bt_tmp
  lda pc_equip,y
  cmp #NO_ITEM
  beq equip_rc_next
  tay                         ; Y = the worn item id
  lda <bt_tmp
  lsr a
  lsr a                       ; the slot this index belongs to (MAX_PARTY = 4)
  cmp eq_slot,y
  beq equip_rc_add
  ldy <bt_tmp
  lda #NO_ITEM
  sta pc_equip,y              ; stale: not a piece of this slot -> empty
  jmp equip_rc_next
equip_rc_add:
  lda pc_eq_atk,x
  clc
  adc eq_atk,y
  bcc equip_rc_a
  lda #$FF
equip_rc_a:
  sta pc_eq_atk,x
  lda pc_eq_def,x
  clc
  adc eq_def,y
  bcc equip_rc_d
  lda #$FF
equip_rc_d:
  sta pc_eq_def,x
  .if EQUIP_MAG_ENABLED
  lda pc_eq_mag,x
  clc
  adc eq_mag,y
  bcc equip_rc_m
  lda #$FF
equip_rc_m:
  sta pc_eq_mag,x
  .endif
  .if EQUIP_MDEF_ENABLED
  lda pc_eq_mdef,x
  clc
  adc eq_mdef,y
  bcc equip_rc_md
  lda #$FF
equip_rc_md:
  sta pc_eq_mdef,x
  .endif
equip_rc_next:
  lda <bt_tmp
  clc
  adc #MAX_PARTY
  sta <bt_tmp
  cmp #EQUIP_BYTES
  bcc equip_rc_slot
  inx
  cpx #MAX_PARTY
  bne equip_rc_member
  rts

; X = member, Y = slot, A = the piece to wear (it must be in the bag) or NO_ITEM. Carry set = refused
; (taking off at a full bag); the bag and the slot are then untouched. Putting a piece on over a worn one
; is net zero for the bag: the new piece leaves the bag first, which frees the slot the old piece returns
; to. Wearing what is already worn, and taking off an empty slot, are no-ops with carry clear.
; Clobbers A, X, Y, bt_arg, bt_x, bt_y, script_tmp and bt_tmp.
equip_set:
  sta <bt_arg
  stx <bt_x
  tya
  asl a
  asl a
  clc
  adc <bt_x
  sta <bt_y                   ; the pc_equip index
  tax
  lda pc_equip,x
  cmp <bt_arg
  beq equip_set_same
  lda <bt_arg
  cmp #NO_ITEM
  bne equip_set_wear
  lda <inv_count
  cmp #MAX_ITEMS
  bcs equip_set_refuse
  jmp equip_set_old
equip_set_wear:
  jsr remove_item             ; frees the bag slot the old piece goes back into
equip_set_old:
  ldx <bt_y
  lda pc_equip,x
  cmp #NO_ITEM
  beq equip_set_store
  jsr add_item
equip_set_store:
  ldx <bt_y
  lda <bt_arg
  sta pc_equip,x
  jsr equip_recalc
equip_set_same:
  clc
  rts
equip_set_refuse:
  sec
  rts

; New game and Game Over (party_init): every member's starting pieces -- all four, joined or not, so a
; later Join needs no equipment code -- then the cache. eq_start is the generator's, already sanitized.
equip_init:
  ldx #EQUIP_BYTES-1
equip_init_loop:
  lda eq_start,x
  sta pc_equip,x
  dex
  bpl equip_init_loop
  jmp equip_recalc

; ------------------------------------------------------------------ the Equip screen (docs/design-equipment.md section 4)
; A set of battle phases (BP_EQ_*) on ST_BATTLE, not a game state: it reuses the battle bank, the battle backdrop, the lists and the party
; sprites. battle_tick sends every phase >= BP_EQ_FIRST here and skips the fight's own ticks. The screen borrows battle scratch that is idle
; in these phases: bt_actor (the member), bt_sel/bt_len/bt_scroll/bt_list (the pick list), bt_str (the hint), bt_cmd (stat), bt_target
; (preview value), bt_vrow, bt_arg, bt_row/bt_col, bt_dmg_lo and bt_tmp -- and never bt_x/bt_y across a combatant_* call (they clobber them).
EQ_D_HEAD   = $01           ; dirty bits, one per content row (row = MSG_ROW + bit): the header...
EQ_D_SLOTS  = $0E           ; ...the three slot rows (they are the pick-list rows while it is open)...
EQ_D_STATS  = $30           ; ...the two stat rows...
EQ_D_HINT   = $40           ; ...and the hint
EQ_D_ALL    = $7F
EQ_D_NOHEAD = $7E
EQ_COLS     = 30            ; cells in a content row: columns 1-30, between the frame's two edge columns
EQ_QUEUE_MAX = 35           ; vram_buf bytes already queued above which a row waits a frame: Flash's 35 and Flash + Equip's 68 land by
                            ; scanline 255, a flip's two packets (10) + Flash (35) + a row (33) would settle past 256 on MMC3 (E12)
EQ_NSLOTS   = EQUIP_BYTES/MAX_PARTY
EQ_SHOWN_STATS = 3+MAGIC_POWER_ENABLED*4+MAGIC_DEFENCE_ENABLED*8  ; ATK and DEF always; MAG / MDEF only where the build has the stat

; Reached by `jsr` from battle_tick's hook, so at every exit the stack holds call_battle's return and then the hook's own. Each handler is
; entered by a branch or a jmp from here and helpers (eq_flush) return before the pad is read: no live jsr is ever between the hook and an exit.
equip_dispatch:
  lda <bt_phase
  cmp #BP_EQ_SLOTS
  bcc eq_intro
  beq eq_slots
  jmp eq_list

; The dedicated entry (F1), not battle_intro. battle_begin did not set bt_from_ent, which battle_end reads to deactivate the entity that
; started a touch encounter, so it is set here; the monster slots are emptied and setup_monsters (a free reset of every fight-only byte with
; no actors) clears a flee's live flags and feedback timers. The first recruited member is selected; nobody recruited leaves at once.
eq_intro:
  lda #NO_ACTOR
  ldx #MAX_MONSTERS-1
eq_in_clear:
  sta mon_slot_actor,x
  dex
  bpl eq_in_clear
  jsr setup_monsters
  lda #NO_ENTITY
  sta <bt_from_ent
  ldx #0
eq_in_member:
  lda pc_in_party,x
  bne eq_in_found
  inx
  cpx #MAX_PARTY
  bne eq_in_member
  jmp eq_leave
eq_in_found:
  stx <bt_actor
  lda #0
  sta eq_cur_slot
  jsr draw_battle_screen      ; bt_phase is still BP_EQ_INTRO: that selects the equip tail
  lda #BP_EQ_SLOTS
  sta <bt_phase
  lda #EQS_HINT_SLOT
  sta <bt_str
  lda #EQ_D_ALL
  sta eq_dirty
  rts

eq_slots:
  jsr eq_flush
  lda <pad_new
  and #BTN_B
  beq eq_s_notb
  jmp eq_leave
eq_s_notb:
  lda <pad_new
  and #BTN_A
  beq eq_s_down
  jmp eq_open_list
eq_s_down:
  lda <pad_new
  and #BTN_DOWN
  beq eq_s_up
  ldx eq_cur_slot
  inx
  cpx #EQ_NSLOTS
  bcc eq_s_slot
  ldx #0
  beq eq_s_slot
eq_s_up:
  lda <pad_new
  and #BTN_UP
  beq eq_s_lr
  ldx eq_cur_slot
  dex
  bpl eq_s_slot
  ldx #EQ_NSLOTS-1
eq_s_slot:
  stx eq_cur_slot
  lda #EQ_D_SLOTS
  jmp eq_mark
eq_s_lr:
  lda <pad_new
  and #BTN_LEFT|BTN_RIGHT
  beq eq_s_done
  ldy #MAX_PARTY-1            ; step -1 (mod MAX_PARTY)
  and #BTN_RIGHT
  beq eq_s_step
  ldy #1
eq_s_step:
  sty <bt_tmp
  ldx <bt_actor
eq_s_next:
  txa
  clc
  adc <bt_tmp
  and #MAX_PARTY-1
  tax
  lda pc_in_party,x
  beq eq_s_next               ; terminates: the current member is recruited
  stx <bt_actor
  lda #EQ_D_NOHEAD
  jsr eq_mark
  lda #EQ_D_HEAD
  jmp eq_mark
eq_s_done:
  rts

; The pick list: the bag's pieces for this slot that this member may wear, in bag order. Row 0 is the virtual NONE row, not in bt_list, so
; the list never exceeds the bag's eight and the navigation length is bt_len+1 (rows 0..bt_len). The cursor starts on the first piece, so a
; double A press cannot unequip by accident.
eq_open_list:
  lda #0
  sta <bt_len
  sta <bt_scroll
  ldy #0
eq_ol_slot:
  cpy <inv_count
  bcs eq_ol_done
  lda inv_items,y
  sta <bt_tmp
  tax
  lda eq_slot,x
  cmp eq_cur_slot
  bne eq_ol_next
  lda eq_who,x
  ldx <bt_actor
  and bit_mask,x
  beq eq_ol_next
  ldx <bt_len
  lda <bt_tmp
  sta bt_list,x
  inc <bt_len
eq_ol_next:
  iny
  bne eq_ol_slot              ; inv_count <= MAX_ITEMS ends the walk above
eq_ol_done:
  lda #0
  ldx <bt_len
  beq eq_ol_sel
  lda #1
eq_ol_sel:
  sta <bt_sel
  lda #BP_EQ_LIST
  sta <bt_phase
  lda #EQS_HINT_LIST
  sta <bt_str
  lda #EQ_D_SLOTS|EQ_D_STATS|EQ_D_HINT
  jmp eq_mark

eq_list:
  jsr eq_flush
  lda <pad_new
  and #BTN_B
  beq eq_l_notb
  jmp eq_back                 ; Equip Back (E9): the list returns to the slot rows, it never leaves
eq_l_notb:
  lda <pad_new
  and #BTN_A
  beq eq_l_down
  jmp eq_commit
eq_l_down:
  lda <pad_new
  and #BTN_DOWN
  beq eq_l_up
  inc <bt_sel
  lda <bt_sel
  cmp <bt_len
  bcc eq_l_moved
  beq eq_l_moved              ; rows run 0..bt_len inclusive
  lda #0
  sta <bt_sel
  beq eq_l_moved
eq_l_up:
  lda <pad_new
  and #BTN_UP
  beq eq_l_done
  dec <bt_sel
  bpl eq_l_moved
  lda <bt_len
  sta <bt_sel
eq_l_moved:
  jsr eq_follow
  lda #EQS_HINT_LIST
  sta <bt_str
  lda #EQ_D_SLOTS|EQ_D_STATS|EQ_D_HINT
  jmp eq_mark
eq_l_done:
  rts

; Row 0 -> NO_ITEM, row r -> bt_list[r-1]. A refused take-off (full bag) keeps the list open and says so in the hint row.
eq_commit:
  lda #NO_ITEM
  ldx <bt_sel
  beq eq_cm_go
  lda bt_list-1,x
eq_cm_go:
  ldx <bt_actor
  ldy eq_cur_slot
  jsr equip_set
  bcs eq_cm_refused
eq_back:
  lda #BP_EQ_SLOTS
  sta <bt_phase
  lda #EQS_HINT_SLOT
  sta <bt_str
  lda #EQ_D_NOHEAD
  jmp eq_mark
eq_cm_refused:
  lda #EQS_BAGFULL
  sta <bt_str
  lda #EQ_D_HINT
  jmp eq_mark

; Three rows are visible (list_follow hardcodes four): scroll so the selected row is one of them.
eq_follow:
  lda <bt_sel
  cmp <bt_scroll
  bcc eq_fo_up
  sec
  sbc <bt_scroll
  cmp #3
  bcc eq_fo_done
  lda <bt_sel
  sec
  sbc #2
  sta <bt_scroll
  rts
eq_fo_up:
  lda <bt_sel
  sta <bt_scroll
eq_fo_done:
  rts

eq_mark:
  ora eq_dirty
  sta eq_dirty
  rts

; The exit. Reached only by a branch or jmp from a handler, so the stack top is the hook's `jsr equip_dispatch` return, an address inside
; the switchable window. The two pla discard it; battle_end (kernel) redraws the field, which re-maps the window to the field's screen
; bank, and its rts returns to call_battle's own `jmp set_screen_ptr`. Without them the rts would return into a window that no longer holds
; this bank (screen data run as code, with the stack still balanced).
eq_leave:
  pla
  pla
  jmp battle_end

; ------------------------------------------------------------------ F8: one row per frame
; The lowest dirty row only, one packet of EQ_COLS cells (header 3 + 30 = 33 bytes of vram_buf, 34 with the terminator). A change marks
; several rows and they drain over the following frames. A frame that already carries a flip and Flash (45 bytes queued before this tick)
; publishes no row: the dirty bit stays set and the row goes out next frame, so the Equip row never shares a frame with both and the NMI's
; rti settles by scanline 256 on every board (E12; docs/reference-engine.md).
eq_flush:
  lda eq_dirty
  beq eq_fl_done
  ldx <vram_len
  cpx #EQ_QUEUE_MAX+1
  bcs eq_fl_done              ; the frame already carries a flip and Flash: the row stays dirty and goes out next frame (E12)
  ldx #0
eq_fl_find:
  lsr a
  bcs eq_fl_row
  inx
  bne eq_fl_find
eq_fl_row:
  lda bit_mask,x
  eor eq_dirty
  sta eq_dirty                ; clear the bit being published
  txa
  clc
  adc #MSG_ROW
  sta <bt_row
  lda #1
  sta <bt_col
  jsr queue_at                ; preserves X
  jsr eq_draw_row
  jmp vram_end
eq_fl_done:
  rts

eq_draw_row:                  ; X = 0 header, 1-3 slot or list rows, 4-5 stat rows, 6 hint
  txa
  beq eq_row_head
  cmp #4
  bcc eq_row_slot
  cmp #6
  beq eq_row_hint
  sec
  sbc #4
  asl a
  sta <bt_vrow                ; the left cell's stat: 0 or 2
  ldy #2
  jsr eq_pad
  lda <bt_vrow
  jsr eq_stat_cell
  ldy #2
  jsr eq_pad
  ldx <bt_vrow
  inx
  txa
  jsr eq_stat_cell
  ldy #EQ_COLS-2-11-2-11
  jmp eq_pad

eq_row_head:
  lda #TILE_SPACE
  jsr vram_push
  lda #EQS_TITLE
  jsr eq_push_str
  ldy #2
  jsr eq_pad
  lda <bt_actor
  jsr push_combatant_name     ; the party member's NAME_LEN cells (pc_name_ram once naming is on)
  ldy #EQ_COLS-1-MSG_COLS-2-NAME_LEN
  jmp eq_pad

eq_row_hint:
  lda #TILE_SPACE
  jsr vram_push
  lda <bt_str
  jsr eq_push_str
  ldy #EQ_COLS-1-MSG_COLS
  jmp eq_pad

eq_row_slot:                  ; A = 1..3
  sec
  sbc #1
  sta <bt_vrow
  lda <bt_phase
  cmp #BP_EQ_LIST
  beq eq_row_list
  lda <bt_vrow
  cmp eq_cur_slot
  jsr eq_push_cursor
  lda <bt_vrow
  clc
  adc #EQS_SLOT_FIRST
  jsr eq_push_str
  lda <bt_vrow
  asl a
  asl a
  clc
  adc <bt_actor
  tax
  lda pc_equip,x
  cmp #NO_ITEM
  beq eq_row_none
  jsr eq_push_item_name
  ldy #EQ_COLS-1-MSG_COLS-NAME_LEN
  jmp eq_pad
eq_row_none:
  lda #EQS_NONE
  jsr eq_push_str
  ldy #EQ_COLS-1-MSG_COLS-MSG_COLS
  jmp eq_pad

eq_row_list:
  lda <bt_vrow
  clc
  adc <bt_scroll
  sta <bt_vrow                ; the absolute row
  cmp <bt_sel
  jsr eq_push_cursor
  lda <bt_vrow
  beq eq_rl_none
  cmp <bt_len
  beq eq_rl_piece
  bcs eq_rl_blank
eq_rl_piece:
  tax
  lda bt_list-1,x
  jsr eq_push_item_name
  ldy #EQ_COLS-1-NAME_LEN
  jmp eq_pad
eq_rl_none:
  lda #EQS_NONE
  jsr eq_push_str
  ldy #EQ_COLS-1-MSG_COLS
  jmp eq_pad
eq_rl_blank:
  ldy #EQ_COLS-1
  jmp eq_pad

; A = stat 0..3 (ATK DEF MAG MDEF) -> 11 cells "LBL bbb>aaa", or 11 blanks when this build does not have that stat. before = the member's
; real combatant stat; after = the same stat with the highlighted piece trial-worn (equip_recalc, read, put back, recalc), so the saturation
; and every other rule are the engine's own.
eq_stat_cell:
  sta <bt_cmd
  tax
  lda bit_mask,x
  and #EQ_SHOWN_STATS
  beq eq_sc_off
  lda <bt_cmd
  asl a
  asl a
  tay
  ldx #4
eq_sc_label:
  lda eq_label,y
  jsr vram_push
  iny
  dex
  bne eq_sc_label
  jsr eq_preview_stat
  sta <bt_target
  ldx <bt_cmd
  jsr eq_stat_val
  jsr eq_push_num
  lda #ARROW_TILE
  jsr vram_push
  lda <bt_target
  jmp eq_push_num
eq_sc_off:
  ldy #11
  jmp eq_pad

eq_preview_stat:              ; bt_cmd = stat -> A
  jsr eq_idx
  lda pc_equip,x
  sta <bt_arg
  jsr eq_candidate
  cmp <bt_arg
  beq eq_pv_same
  sta pc_equip,x
  jsr equip_recalc
  ldx <bt_cmd
  jsr eq_stat_val
  pha
  jsr eq_idx
  lda <bt_arg
  sta pc_equip,x
  jsr equip_recalc
  pla
  rts
eq_pv_same:
  ldx <bt_cmd
  jmp eq_stat_val

eq_candidate:                 ; X = pc_equip index; A = the piece under the cursor (list open) or the worn one
  lda <bt_phase
  cmp #BP_EQ_LIST
  bne eq_cand_cur
  ldy <bt_sel
  beq eq_cand_none
  lda bt_list-1,y
  rts
eq_cand_none:
  lda #NO_ITEM
  rts
eq_cand_cur:
  lda pc_equip,x
  rts

eq_idx:
  lda eq_cur_slot
  asl a
  asl a
  clc
  adc <bt_actor
  tax
  rts

eq_stat_val:                  ; X = stat -> A = the member's combatant stat (these preserve X and Y)
  lda <bt_actor
  cpx #1
  beq eq_sv_def
  bcs eq_sv_hi
  jmp combatant_atk
eq_sv_def:
  jmp combatant_def
eq_sv_hi:
  cpx #3
  beq eq_sv_mdef
  ; A stat this build does not have is never asked for (EQ_SHOWN_STATS hides its cell), but the jmp is assembled either way so the
  ; screen's size does not depend on which stats exist: the two terms of the allowance stay the equipment engine's own.
  .if MAGIC_POWER_ENABLED
  jmp combatant_mag
  .endif
  .if !MAGIC_POWER_ENABLED
  jmp eq_sv_none
  .endif
eq_sv_mdef:
  .if MAGIC_DEFENCE_ENABLED
  jmp combatant_mdef
  .endif
  .if !MAGIC_DEFENCE_ENABLED
  jmp eq_sv_none
  .endif
eq_sv_none:
  rts

; ------------------------------------------------------------------ small drawing helpers
eq_push_num:                  ; A = 0-255 -> three cells
  sta <bt_dmg_lo
  jsr print_num
  ldy #0
eq_pn_loop:
  lda bt_digits,y
  jsr vram_push
  iny
  cpy #3
  bne eq_pn_loop
  rts

eq_push_item_name:            ; A = item id -> NAME_LEN cells, through draw_list_name's own tail
  sta <bt_tmp
  lda #LOW(item_name)
  sta <ptr_lo
  lda #HIGH(item_name)
  sta <ptr_hi
  jmp draw_list_name_go

eq_push_str:                  ; A = string index -> MSG_COLS cells from eq_text
  sta <bt_x
  asl a
  clc
  adc <bt_x
  asl a
  asl a
  tay
  lda #MSG_COLS
  sta <bt_x
eq_ps_loop:
  lda eq_text,y
  jsr vram_push
  iny
  dec <bt_x
  bne eq_ps_loop
  rts

eq_push_cursor:               ; flags from the caller's cmp: equal -> arrow, else a space
  bne eq_pc_space
  lda #ARROW_TILE
  jmp vram_push
eq_pc_space:
  lda #TILE_SPACE
  jmp vram_push

eq_pad:                       ; Y = how many spaces (> 0)
  lda #TILE_SPACE
eq_pad_loop:
  jsr vram_push
  dey
  bne eq_pad_loop
  rts
  .endif

; A = member index; returns Y = that member's row for their current level.
level_row:
  sta <bt_tmp
  lda #0
  ldy <bt_tmp
  beq level_row_add         ; member 0 needs no stride
level_row_stride:
  clc
  adc #MAX_LEVEL
  dey
  bne level_row_stride
level_row_add:
  clc
  adc pc_level,x
  sec
  sbc #1
  tay
  rts

; ------------------------------------------------------------------ tick

; One frame of battle: pay down any wipe still owed from a dead monster, then
; advance the state machine, then rebuild the sprite shadow. The party and any
; metasprite monsters are the only sprites on screen, so this owns the whole
; shadow rather than appending to it.
battle_tick:
  .if EQUIP_ENABLED
  ; Every Equip phase (docs/design-equipment.md section 4) is handled whole by equip_dispatch: the fight's own ticks below
  ; (the wipe, fx, hurt and miss producers) are bypassed, not made safe, and only the party's sprites are drawn.
  lda <bt_phase
  cmp #BP_EQ_FIRST
  bcc battle_tick_fight
  jsr equip_dispatch
  jmp battle_draw_sprites
battle_tick_fight:
  .endif
  jsr wipe_tick
  .if BATTLE_ANIM_ENABLED
  jsr battle_fx_tick
  .endif
  .if HIT_FEEDBACK_ENABLED
  jsr battle_hurt_tick
  .endif
  .if MISS_ENABLED
  jsr battle_miss_tick
  .endif
  jsr battle_dispatch
  jmp battle_draw_sprites

; Phase 2a hit feedback (docs/design-battle-animation.md §12.3) -- ticks the
; shared hit-feedback pair. Guarded on BP_INTRO the identical reason
; battle_fx_tick already is: this runs before battle_dispatch on every tick,
; including the very first one of a fresh battle, where bt_phase is still
; genuinely BP_INTRO and bt_hurt_left has not been reset yet for this battle
; -- setup_monsters (below) is reached only through battle_dispatch ->
; battle_intro, later the same tick.
;
; Which of the two hit-feedback halves applies is decided here, every tick,
; from what bt_hurt_slot currently names:
;   - a party member, or a metasprite-fallback monster (mon_tile == $FF):
;     nothing to queue -- battle_sprite_pc/battle_sprite_mon read
;     bt_hurt_slot/bt_hurt_left directly at draw time and skip the icon on
;     alternate frames.
;   - a block-art monster (mon_tile != $FF): the attribute-flash half.
;
; If the named monster has died since it was armed (mon_slot_alive == 0),
; this is the LAST chance to fix its attribute cell before the shared state
; moves on to a different slot -- wipe_tick only ever rewrites that
; monster's own TILES, one row a frame; it never touches the attribute byte
; at all, so whatever this mechanism last queued for that cell (the flash
; tint, $FF, or the monster's own authored tint) would otherwise sit there,
; uncorrected, on top of the wiped ground, for the rest of the battle.
; Fixed by forcing one last packet: BT_GROUND_ATTR, never the dead
; monster's own now-meaningless mon_attr.
  .if HIT_FEEDBACK_ENABLED
battle_hurt_tick:
  lda <bt_phase
  cmp #BP_INTRO
  beq battle_hurt_tick_rts
  lda <bt_hurt_left
  beq battle_hurt_tick_rts
  lda <bt_hurt_slot
  cmp #MAX_PARTY
  bcc battle_hurt_tick_dec       ; a party member -- nothing to queue, just tick
  sec
  sbc #MAX_PARTY
  tax
  lda mon_slot_alive,x
  bne battle_hurt_tick_dec
  lda #0
  sta <bt_hurt_left               ; stop ticking regardless of block art
  lda mon_slot_actor,x
  tay
  lda mon_tile,y
  cmp #$FF
  beq battle_hurt_tick_rts        ; no block art -- nothing to restore
  jsr battle_hurt_attr_open       ; X = monster slot, preserved
  lda #BT_GROUND_ATTR
  jsr vram_push
  jmp vram_end
battle_hurt_tick_dec:
  dec <bt_hurt_left
  lda <bt_hurt_slot
  cmp #MAX_PARTY
  bcc battle_hurt_tick_rts        ; party member: sprite blink only, done
  sec
  sbc #MAX_PARTY
  tax
  lda mon_slot_actor,x
  tay
  lda mon_tile,y
  cmp #$FF
  beq battle_hurt_tick_rts        ; metasprite fallback -- sprite blink only
  jsr battle_hurt_attr_open       ; X = monster slot, preserved
  lda mon_slot_actor,x            ; re-read (X survives the call); Y was
  tay                             ; clobbered by battle_hurt_attr_open itself
  lda <bt_hurt_left
  beq battle_hurt_attr_restore
  and #2
  bne battle_hurt_attr_flash
battle_hurt_attr_restore:
  lda mon_attr,y
  jmp battle_hurt_attr_push
battle_hurt_attr_flash:
  lda #$FF
battle_hurt_attr_push:
  jsr vram_push
  jmp vram_end
battle_hurt_tick_rts:
  rts

; X = monster slot. Opens vram_buf at that monster's own anchored attribute
; cell (draw_battle_attr's own per-monster offset). The address math is a
; pure function of the slot number (X), never the actor id, so this never
; needs to park anything in shared scratch to do its own job -- cast_all's
; own end-of-side sentinel (bt_tmp2, engine/battleturn.asm) survives
; untouched. X itself survives the call (never touched here after the
; address math begins, and vram_open its own self saves/restores X
; internally) -- callers that need the actor id re-read mon_slot_actor,x
; themselves once this returns, at no cost, rather than trust a value
; parked here. Clobbers A, Y.
battle_hurt_attr_open:
  txa
  clc
  adc #1
  asl a
  asl a
  asl a
  clc
  adc #1
  clc
  adc #$C0
  tay
  lda #$23
  jmp vram_open
  .endif

; Phase 2b MISS overlay (docs/design-battle-animation.md §13.4) -- ticks the
; independent MISS overlay's own countdown. Guarded on BP_INTRO for the
; identical reason battle_hurt_tick is: this runs before battle_dispatch on
; every tick, including the very first one of a fresh battle, where bt_phase
; is still genuinely BP_INTRO and bt_miss_left has not been reset yet for
; this battle. No vram_buf work: MISS is sprite-drawn (see battle_miss_draw,
; engine/battleui.asm), so ticking it costs nothing but the countdown itself.
  .if MISS_ENABLED
battle_miss_tick:
  lda <bt_phase
  cmp #BP_INTRO
  beq battle_miss_tick_rts
  lda <bt_miss_left
  beq battle_miss_tick_rts
  dec <bt_miss_left
battle_miss_tick_rts:
  rts
  .endif

; A dying monster's own block wipe is budgeted at one row a frame (see
; bt_wipe_mask/bt_wipe_row/bt_wipe_slot, engine/constants.asm): four dead
; monsters in the same tick used to queue wipe_monster's whole four-row sweep
; four times over -- up to 176 bytes of PPUDATA in one frame, past the
; ~2273-cycle vblank window -- so apply_damage_mon (engine/battleturn.asm)
; only sets a bit now, and this is what actually queues a row, called first
; thing in battle_tick so it never competes with whatever the state machine
; below queues the same frame.
;
; The active slot is sticky: a fresh pick (lowest set bit) only happens when
; bt_wipe_row is back at zero, i.e. nothing is mid-wipe. Re-picking the
; lowest bit every frame regardless -- the review's own finding -- let a
; newly-dead lower slot steal a higher slot's in-progress bt_wipe_row, so the
; lower slot inherited whatever row the interrupted one had reached and its
; own earlier rows were never queued at all.
wipe_tick:
  lda <bt_wipe_mask
  bne wipe_tick_go
  rts
wipe_tick_go:
  lda <bt_wipe_row
  bne wipe_tick_slot        ; mid-wipe: bt_wipe_slot already names who
  ldx #0
wipe_tick_bit:
  lda bit_mask,x
  and <bt_wipe_mask
  bne wipe_tick_pick
  inx
  cpx #MAX_MONSTERS
  bne wipe_tick_bit
  rts                       ; unreachable: bt_wipe_mask was non-zero above
wipe_tick_pick:
  stx <bt_wipe_slot
wipe_tick_slot:
  ldx <bt_wipe_slot
  jsr wipe_monster
  inc <bt_wipe_row
  lda <bt_wipe_row
  cmp #4
  bcc wipe_tick_done
  lda #0
  sta <bt_wipe_row
  ldx <bt_wipe_slot
  lda bit_mask,x
  eor #$FF
  and <bt_wipe_mask
  sta <bt_wipe_mask
wipe_tick_done:
  rts

battle_dispatch:
  lda <bt_phase
  cmp #BP_INTRO
  bne battle_tick_menu
  jmp battle_intro
battle_tick_menu:
  cmp #BP_MENU
  bne battle_tick_target
  jmp battle_menu
battle_tick_target:
  cmp #BP_TARGET
  bne battle_tick_spells
  jmp battle_target
battle_tick_spells:
  cmp #BP_SPELLS
  bne battle_tick_items
  jmp battle_list
battle_tick_items:
  cmp #BP_ITEMS
  bne battle_tick_act
  jmp battle_list
battle_tick_act:
  cmp #BP_ACT
  bne battle_tick_message
  jmp battle_act
battle_tick_message:
  cmp #BP_MESSAGE
  bne battle_tick_next
  jmp battle_message_wait
battle_tick_next:
  cmp #BP_NEXT
  bne battle_tick_over
  jmp battle_next
battle_tick_over:
  cmp #BP_DONE
  bne battle_tick_walk
  jmp battle_finish
battle_tick_walk:
  cmp #BP_WALK
  bne battle_tick_end
  jmp battle_walk_wait
battle_tick_end:
  jmp battle_outcome        ; victory, defeat and running away all wait here

; ------------------------------------------------------------ the screen

battle_intro:
  jsr setup_monsters
  jsr draw_battle_screen
  jsr battle_round
  lda #BP_MENU
  sta <bt_phase
  lda #0
  sta <bt_actor
  jmp battle_first_turn

; Fill in each monster slot's hit points from its actor's row.
setup_monsters:
  lda #0
  sta <bt_count
  sta <bt_wipe_mask
  sta <bt_wipe_row
  sta <bt_wipe_slot
  .if BATTLE_ANIM_ENABLED
  lda #NO_ANIM
  sta <bt_fx_anim           ; no effect carries in from a previous battle
  .endif
  ; A fresh battle must not inherit a countdown, or a slot, left over from
  ; the previous one (neither is cleared by battle_end or player_died --
  ; see the design's own §12.4 for why that is safe now that
  ; battle_hurt_tick guards on BP_INTRO). A cannot be trusted to still be 0
  ; here: the BATTLE_ANIM_ENABLED block above, when it runs, leaves NO_ANIM
  ; ($FF) in A, not 0. This gets its own lda #0 rather than sharing one with
  ; a MISS-side reset (docs/design-battle-animation.md §12.7's own ledger
  ; decision, option (i)): two independent toggles cannot share a load that
  ; only one of them may assemble.
  .if HIT_FEEDBACK_ENABLED
  lda #0
  sta <bt_hurt_left
  .endif
  ; MISS's own half of the same reset (docs/design-battle-animation.md
  ; §13.4/§13.9 ledger decision, option (i)): its own lda #0 rather than
  ; sharing hit feedback's, so the two allowances stay genuinely independent
  ; and a MISS-only build pays for this even with HIT_FEEDBACK_ENABLED off.
  .if MISS_ENABLED
  lda #0
  sta <bt_miss_left
  .endif
  ; §16 (docs/design-battle-animation.md, fix round 1): a fresh battle must
  ; not inherit a stepped-forward sprite from whatever battle came before --
  ; unconditional, the identical "a switched-off feature must not move any
  ; other symbol's address" chain reasoning does not apply here since the
  ; walk has no gate at all; this is just the ordinary per-battle reset every
  ; other bt_* countdown above already gets.
  lda #0
  sta <bt_walk_step
  ldx #0
setup_monsters_slot:
  lda #0
  sta mon_slot_alive,x
  sta mon_slot_status,x
  lda mon_slot_actor,x
  cmp #$FF
  beq setup_monsters_next
  tay
  lda mon_hp,y
  sta mon_slot_hp,x
  sta mon_slot_max,x
  lda mon_mp,y
  sta mon_slot_mp,x
  lda #1
  sta mon_slot_alive,x
  inc <bt_count
setup_monsters_next:
  inx
  cpx #MAX_MONSTERS
  bne setup_monsters_slot
  rts

; Drawn once, with rendering off. Everything after this goes through the NMI
; queue, so there is never a second force-blank in the middle of a battle.
draw_battle_screen:
  lda #$00
  sta $2000
  sta $2001
  .if SPLIT_ENABLED
  sta $E000                 ; scanline counter off while the mainline owns the
                            ; mapper registers -- same rule as redraw_screen
  .endif
  jsr vram_reset
  ; The monsters are drawn out of their own CHR bank, which is the other half of
  ; why an RPG needs a cartridge that can switch banks. redraw_screen puts the
  ; field's tileset back on the way out.
  lda #BATTLE_TILESET
  jsr switch_chr_bank

  ; A streamed screen has no screen_map row (that table holds only the compact
  ; ordinary rows), and in a mixed project an ordinary screen's flat_screen is no
  ; longer its compact row either -- cur_map already names the owning map for
  ; both (apply_map_music / apply_map_music_direct set it at every landing), the
  ; owner engine/rpg.asm's streamed encounter lookup reads too.
  .if STREAMING_ENABLED
  lda <cur_map
  .else
  ldy <flat_screen
  lda screen_map,y
  .endif
  sta <bt_tmp2               ; this map's backdrop tiles

  bit $2002
  lda #$20
  sta $2006
  lda #$00
  sta $2006

  lda #0
  sta <bt_tmp                ; row
draw_bs_row:
  lda <bt_tmp
  cmp #BT_SKY_ROWS
  bcc draw_bs_sky
  cmp #BT_BOX_ROW
  bcs draw_bs_box
  ldy <bt_tmp2
  lda map_battle_ground,y
  jmp draw_bs_fill
draw_bs_sky:
  ldy <bt_tmp2
  lda map_battle_sky,y
  jmp draw_bs_fill
draw_bs_box:
  lda #TILE_SPACE
draw_bs_fill:
  ldy #32
draw_bs_cell:
  sta $2007
  dey
  bne draw_bs_cell
  inc <bt_tmp
  lda <bt_tmp
  cmp #30
  bne draw_bs_row

  jsr draw_box_frame
  .if EQUIP_ENABLED
  ; The Equip screen's intro (eq_intro) wants the backdrop and the frame but no monsters, commands or panel: only the attribute
  ; table (with every monster slot empty, the ground and the box alone).
  lda <bt_phase
  cmp #BP_EQ_INTRO
  bne draw_bs_fight
  jsr draw_battle_attr
  jmp draw_bs_shown
draw_bs_fight:
  .endif
  jsr draw_monsters
  jsr draw_battle_attr
  jsr draw_commands
  jsr draw_panel
  .if EQUIP_ENABLED
draw_bs_shown:
  .endif

  jsr wait_vblank_poll
  jmp enable_rendering

; The frame around the bottom box, drawn straight to $2007 while the picture is
; off. Same furniture as the message box, so the two read as one interface.
draw_box_frame:
  lda #BT_BOX_ROW
  sta <bt_row
draw_box_row:
  lda #0
  sta <bt_col
  jsr seek_at
  lda <bt_row
  cmp #BT_BOX_ROW
  beq draw_box_edge
  cmp #29
  beq draw_box_edge
  lda #BORDER_V
  sta $2007
  ldy #30
  lda #TILE_SPACE
draw_box_mid:
  sta $2007
  dey
  bne draw_box_mid
  lda #BORDER_V
  sta $2007
  jmp draw_box_next
draw_box_edge:
  lda #BORDER_CORNER
  sta $2007
  ldy #30
  lda #BORDER_H
draw_box_bar:
  sta $2007
  dey
  bne draw_box_bar
  lda #BORDER_CORNER
  sta $2007
draw_box_next:
  inc <bt_row
  lda <bt_row
  cmp #30
  bne draw_box_row
  rts

; bt_row / bt_col -> the PPU's write address. A row is 32 tiles and a nametable
; is $400 bytes, so the high byte is $20 + (row >> 3) and the low byte cannot
; carry: (row & 7) * 32 + col tops out at 255.
seek_at:
  lda <bt_row
  lsr a
  lsr a
  lsr a
  clc
  adc #$20
  bit $2002
  sta $2006
  lda <bt_row
  and #7
  asl a
  asl a
  asl a
  asl a
  asl a
  clc
  adc <bt_col
  sta $2006
  rts

; Each monster is a block of background tiles on the battle tileset, laid out on
; a 16-wide sheet. An actor with no block art is drawn as sprites instead, so
; every actor in the project can fight without having to be redrawn for it.
draw_monsters:
  ldx #0
draw_mon_slot:
  lda mon_slot_alive,x
  beq draw_mon_next
  ldy mon_slot_actor,x
  lda mon_tile,y
  cmp #$FF
  beq draw_mon_next         ; metasprite fallback, drawn with the sprites
  jsr draw_mon_block
draw_mon_next:
  inx
  cpx #MAX_MONSTERS
  bne draw_mon_slot
  rts

; X = monster slot, Y = its actor id.
draw_mon_block:
  lda mon_tile,y
  sta <bt_tmp                ; the row's first tile
  lda mon_h,y
  sta <bt_tmp2               ; rows left
  txa
  asl a
  asl a                     ; slot * BT_MON_STEP
  clc
  adc #BT_MON_ROW
  sta <bt_row
draw_mon_block_row:
  lda #BT_MON_COL
  sta <bt_col
  jsr seek_at
  ldy mon_slot_actor,x
  lda mon_w,y
  sta bt_digits             ; columns left
  lda <bt_tmp
  sta bt_digits+1           ; the tile being written
draw_mon_block_cell:
  lda bt_digits+1
  sta $2007
  inc bt_digits+1
  dec bt_digits
  bne draw_mon_block_cell
  lda <bt_tmp
  clc
  adc #16                   ; the art is a 16-wide region of the tileset
  sta <bt_tmp
  inc <bt_row
  dec <bt_tmp2
  bne draw_mon_block_row
  rts

; Sky on background palette 0, ground on 1, the box back on 0, and one byte per
; monster for its own tint. A monster's art is anchored to a four-row, four-column
; grid precisely so that one attribute byte covers all of it.
draw_battle_attr:
  bit $2002
  lda #$23
  sta $2006
  lda #$C0
  sta $2006
  ldy #0
draw_attr_byte:
  tya
  lsr a
  lsr a
  lsr a                     ; attribute row
  beq draw_attr_zero        ; row 0: the sky
  cmp #5
  bcs draw_attr_zero        ; rows 5-7: the box
  lda #BT_GROUND_ATTR       ; rows 1-4: the ground
  jmp draw_attr_write
draw_attr_zero:
  lda #$00
draw_attr_write:
  sta $2007
  iny
  cpy #64
  bne draw_attr_byte

  ; Then one byte per live monster, over the top.
  ldx #0
draw_attr_mon:
  lda mon_slot_alive,x
  beq draw_attr_mon_next
  ldy mon_slot_actor,x
  lda mon_tile,y
  cmp #$FF
  beq draw_attr_mon_next
  txa
  clc
  adc #1                    ; attribute row 1 + slot
  asl a
  asl a
  asl a
  clc
  adc #1                    ; attribute column 1 holds tile columns 4-7
  sta <bt_tmp
  bit $2002
  lda #$23
  sta $2006
  lda #$C0
  clc
  adc <bt_tmp
  sta $2006
  ldy mon_slot_actor,x
  lda mon_attr,y
  sta $2007
draw_attr_mon_next:
  inx
  cpx #MAX_MONSTERS
  bne draw_attr_mon
  rts

; FIGHT / MAGIC / ITEM / RUN down the left of the box.
draw_commands:
  lda #0
  sta <bt_tmp
draw_cmd_row:
  lda <bt_tmp
  asl a
  clc
  adc #BT_CMD_ROW
  sta <bt_row
  lda #BT_CMD_COL
  sta <bt_col
  jsr seek_at
  lda <bt_tmp
  jsr name_offset_cmd
draw_cmd_char:
  lda cmd_names,y
  sta $2007
  iny
  dec <bt_tmp2
  bne draw_cmd_char
  inc <bt_tmp
  lda <bt_tmp
  cmp #NUM_COMMANDS
  bne draw_cmd_row
  rts

; A = command index; returns Y = its first glyph and bt_tmp2 = the length.
name_offset_cmd:
  asl a
  asl a
  asl a                     ; CMD_NAME_LEN is 8
  tay
  lda #8
  sta <bt_tmp2
  rts

; Names and hit points down the right of the box, one member per two rows.
draw_panel:
  ldx #0
draw_panel_slot:
  lda pc_in_party,x
  beq draw_panel_next
  txa
  asl a
  clc
  adc #BT_PANEL_ROW
  sta <bt_row
  lda #BT_PANEL_COL
  sta <bt_col
  jsr seek_at
  ; A party slot's own name reads pc_name_ram once naming is on -- the
  ; player's actual, possibly-typed name, not the compiled default
  ; (docs/design-name-entry.md §3).
  .if NAME_ENTRY_ENABLED
  lda #LOW(pc_name_ram)
  sta <ptr_lo
  lda #HIGH(pc_name_ram)
  sta <ptr_hi
  .endif
  .if !NAME_ENTRY_ENABLED
  lda #LOW(pc_name)
  sta <ptr_lo
  lda #HIGH(pc_name)
  sta <ptr_hi
  .endif
  txa
  jsr name_offset_pc
draw_panel_char:
  lda [ptr_lo],y
  sta $2007
  iny
  dec <bt_tmp2
  bne draw_panel_char
draw_panel_next:
  inx
  cpx #MAX_PARTY
  bne draw_panel_slot
  rts

; A = an entry's index into whichever name table the caller has already based
; at ptr_lo/ptr_hi (the generic 16-bit pointer, engine/constants.asm). Adds
; index * NAME_LEN into that pointer -- as a 16-bit address, not the 8-bit
; offset this used to hand back, which silently wrapped at index 26 (NAME_LEN
; is 10; 26*10 = 260, and the discarded carry left every reader pointing four
; glyphs into the next entry). Returns Y = 0 and bt_tmp2 = NAME_LEN as before,
; so every consumer's loop is unchanged in shape: lda [ptr_lo],y / iny /
; dec bt_tmp2 / bne.
;
; Adds NAME_LEN into the pointer `index` times rather than a shift-add, so the
; loop stays parameterized by NAME_LEN (config.inc's single writer for it,
; via assets/battle.inc) instead of a decomposition baked in for whatever
; NAME_LEN happens to be today. Preserves X, which draw_panel's own caller
; relies on across the call.
;
; Cost is bounded by the largest legal index, LIMITS.actors/items = 254: at
; most 254 sixteen-bit adds, each ~18 cycles (~22 on the roughly one-in-26
; that carry) -- worst case is under 4,700 cycles, and draw_list calls this at
; most four times in one tick (under 18,800 cycles), push_combatant_name once
; per message. Both stay comfortably inside a frame's ~29,780-cycle NTSC
; budget, with the rest of that frame's own work still to run.
name_offset_pc:
  tay
  beq name_offset_pc_len
name_offset_pc_stride:
  clc
  lda <ptr_lo
  adc #NAME_LEN
  sta <ptr_lo
  bcc name_offset_pc_nocarry
  inc <ptr_hi
name_offset_pc_nocarry:
  dey
  bne name_offset_pc_stride
name_offset_pc_len:
  ldy #0
  lda #NAME_LEN
  sta <bt_tmp2
  rts

  .include "battleui.asm"
  .include "battleturn.asm"
  .if NAME_ENTRY_ENABLED
  .include "nameentry.asm"
  .endif
  .if SW_DLG_BANKED
  .include "streamdialog.asm"
  .endif
