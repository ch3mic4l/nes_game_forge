; constants.asm -- zero-page map and fixed constants for the Forge engine.
; Project-derived values (start position, speed, screen count) come from the
; generated assets/config.inc instead, so there is exactly one writer for each.

; ------------------------------------------------------------ zero page
ptr_lo      = $00           ; generic 16-bit pointer
ptr_hi      = $01
mtptr_lo    = $02           ; current screen's 240 metatile ids
mtptr_hi    = $03
atptr_lo    = $04           ; current screen's 64 attribute bytes
atptr_hi    = $05
tmp         = $06
tmp2        = $07
probe_x     = $08           ; collision probe point, screen pixels
probe_y     = $09
new_pos     = $0A           ; candidate coordinate before collision
ds_row      = $0B           ; draw_screen: metatile row counter
ds_base     = $0C           ; draw_screen: row * 16
copy_cnt    = $0D
ent_tmp     = $0E
ent_tmp2    = $0F

player_x    = $10           ; top-left of the 16x16 player, screen pixels
player_y    = $11
player_dir  = $12           ; 0 down, 1 up, 2 left, 3 right
anim_frame  = $13           ; 0 or 1
anim_timer  = $14
moving      = $15           ; nonzero if the player moved this frame
flat_screen = $16           ; index into the global screen tables
pad         = $17           ; A B Sel St U D L R (bit 7..0)
pad_new     = $18           ; buttons pressed this frame only
pad_last    = $19
vblank      = $1A           ; set by NMI, cleared by the main loop
frame_cnt   = $1B
esptr_lo    = $1C           ; this screen's actor list
esptr_hi    = $1D
msptr_lo    = $1E           ; metasprite tile list being drawn
msptr_hi    = $1F
oam_idx     = $20           ; next free byte in the sprite shadow
de_ex       = $21           ; entity being drawn: screen position
de_ey       = $22
de_left     = $23           ; tiles left in the metasprite
pickups     = $24           ; pickups collected this session
game_state  = $25           ; ST_GAMEPLAY / ST_MENU / ST_DIALOG
paused      = $26
defeated    = $27           ; actors beaten with the attack action
dash_on     = $28           ; a dash-bound button is held this frame
cur_speed   = $29           ; player pixels per frame, doubled while dashing
mus_vol     = $2A           ; volume resolved from the envelope this frame
mus_reg     = $2B           ; APU register offset for the channel being served
mus_tmp     = $2C
mus_enabled = $2D
warp_ready  = $2E           ; a door fired; the main loop performs the move
warp_scr    = $2F
warp_x      = $30
warp_y      = $31
chase_dx    = $32           ; distance to the player, for choosing a facing
chase_dy    = $33
mmc_tmp     = $34           ; banks.asm: the byte being shifted out to a mapper
mapper_shadow = $35         ; last value written to a mapper register whose bits
                            ; are shared between PRG and CHR (UNROM 512)
chr_init_idx = $36          ; chr_ram_init's tileset counter
inv_count   = $37           ; items in the bag
inv_sel     = $38           ; the slot the menu highlights
items_used  = $39           ; items spent with the confirm action
talk_ent    = $3A           ; entity being spoken to, NO_ENTITY when none
ui_slot     = $3B           ; draw_menu's slot counter
; The slot whose event the frame owes the player, or NO_ENTITY. Both triggers
; that are not the interact button arm this and neither starts a conversation
; itself, because both would be starting one in the middle of something: the
; entry trigger inside the redraw that spawned it, on a screen still being drawn,
; and the touch trigger inside the loop that is still walking the other seven
; slots. main_loop is the one place either of them turns into a conversation, at
; a frame boundary with the world not half-updated.
;
; First claim wins, which is the same rule for both: two actors cannot each own
; the moment a screen loads, and an entry event must not be pushed aside by a
; touch on the frame the screen arrives.
pending_ent = $7C
; A screen was drawn during this frame, so the rest of it does not belong to the
; world: crossing a screen edge redraws from inside update_player, and everything
; after that call would otherwise be a frame of the *new* screen running before
; the event it owes has had its turn.
screen_fresh = $7D

; The NMI's VRAM write queue. The main loop appends packets during the frame and
; sets vram_ready with its last store; NMI drains them after the OAM DMA. A frame
; that ran long leaves vram_ready clear, so NMI skips and the writes land next
; frame -- late, never torn.
vram_len    = $3C           ; next free byte in vram_buf
vram_cnt    = $3D           ; index of the open packet's count byte
vram_tmp    = $3E           ; vram_push's saved X
vram_ready  = $3F           ; the buffer is complete and NMI may drain it

; The message window. box_row is the sub-step of whichever multi-frame phase is
; running (opening, clearing a page, closing); box_col is its inner counter.
box_state   = $40
box_row     = $41
box_col     = $42
msg_ptr_lo  = $43           ; the string being typed out
msg_ptr_hi  = $44
msg_col     = $45           ; the cell the next glyph goes in
msg_line    = $46

script_ptr_lo = $47         ; the event command being run
script_ptr_hi = $48
script_active = $49         ; an event is mid-run, suspended on a message
script_tmp  = $4A

; switch_split's workings. The switch routines run inside two loops that already
; own X (the entity slot) and Y (the record cursor), so they keep their working
; values here and hand both registers back untouched.
switch_idx  = $4B           ; which of the eight switch bytes
switch_bit  = $4C           ; the mask within it
switch_y    = $4D           ; the caller's Y

; Action-mode combat. The hearts are the player's whole health model; an RPG
; keeps its party's HP elsewhere and never touches these.
player_hp   = $4E           ; hearts left, 0 = dead
player_iframes = $4F        ; invincible for this many more frames, and flickering
kb_timer    = $50           ; knocked back for this many more frames
kb_dir      = $51           ; which way, as a DIR_*
hud_slot    = $52           ; draw_hud's heart counter
; ------------------------------------------------------------- battle RAM
; Only an RPG ever touches these, and only while ST_BATTLE is the game state.
; Combatants live in one index space -- 0-3 are party members, 4-7 monsters --
; so targeting, the cursor and the turn order are one code path for both sides.
bt_phase    = $53           ; BP_* below
bt_actor    = $54           ; whose turn it is, as a combatant index
bt_sel      = $55           ; the highlighted command, or list row
bt_target   = $56           ; the combatant being aimed at
bt_scroll   = $57           ; first visible row of a spell or item list
bt_dmg_lo   = $58           ; the number the message is about to print
bt_dmg_hi   = $59
bt_str      = $5A           ; which battle string is being shown
bt_count    = $5B           ; live monsters
bt_tmp      = $5C
bt_tmp2     = $5D
bt_timer    = $5E           ; frames left on a message before it moves on
bt_round    = $5F           ; index into turn_order
bt_flee     = $60           ; a run attempt succeeded
enc_step    = $61           ; steps since the last wandering-monster roll
rng         = $62           ; 8-bit Galois LFSR, advanced every frame and roll
gold_lo     = $63
gold_hi     = $64
party_size  = $65           ; members recruited so far
bt_esc      = $66           ; nonzero when the battle may be walked away from
bt_call     = $67           ; which entry point the trampoline is jumping to
bt_from_ent = $68           ; the entity that started a touch encounter
bt_row      = $69           ; seek_at's target cell
bt_col      = $6A
bt_len      = $6B           ; entries in the open spell or item list
bt_cmd      = $6C           ; the command chosen this turn
bt_arg      = $6D           ; the spell or item it chose
; The combatant_* lookups are all called from inside loops that own X or Y, so
; they save both here and hand them back untouched -- and return through bt_ret
; so the flags describe the answer rather than the register reload.
bt_x        = $6E
bt_y        = $6F
bt_ret      = $70
bt_fill     = $71           ; wipe_monster's background tile
bt_ptick    = $72           ; the line on screen is a poison tick, so the next
                            ; message-done advances the turn instead of poisoning
bt_vrow     = $73           ; draw_list's visible-row counter. Its own byte
                            ; because drawing a name runs through name_offset_pc,
                            ; which owns bt_tmp2 -- a shared counter hung the
                            ; whole game the first time a list had two entries

; The scanline split (engine/split.asm, MMC3 builds that show text). The main
; thread owns split_mode and nothing else; NMI and the IRQ own the rest, so no
; byte here is ever written from two sides of an interrupt.
chr_r1      = $74           ; the live tileset's R1 bank (tileset*8+2), kept by
                            ; switch_chr_bank so the interrupts can restore art
split_mode  = $75           ; SPL_*, decided once per frame by split_select
split_idx   = $76           ; the split_progs entry the next IRQ will run
irq_tmp     = $77           ; the IRQ handler's staging byte -- interrupt-only,
                            ; so it can never collide with mainline scratch
bt_tgt_vis  = $78           ; battle targeting cursor is showing (sprite cursor
                            ; on split builds; the BG-tile cursor ignores it)
script_val  = $79           ; the number a page condition or a variable command
                            ; works against. It cannot be an immediate: it comes
                            ; out of the event data, not out of the code
; A question the player answers. Which option the cursor is on is the whole of
; what is remembered: the labels are read out of the command script_ptr is still
; sitting on, and the answer is walked into a body once, when it is given.
choice_sel  = $7A
; Which phase the box hands itself to once it is up and clear -- typing a
; message, or listing a question's options. Decided by whoever asked for the
; box, so raising the frame and wiping a page stay one implementation each and
; neither has to ask what it is being done for.
box_after   = $7B

; How many common events may be nested inside one another before a call is
; simply skipped rather than pushed. Bounded here, once, because unlike a
; branch or a question -- nesting the schema itself limits at MAX_BRANCH_DEPTH
; and refuses past BRANCH_DEPTH_LIMIT -- two common events are free to call
; each other and no authoring-time check can see that cycle coming: it is only
; a cycle once both bodies exist. Four is enough for a call chain no game
; actually needs and cheap enough that a runaway one costs a few bytes of
; stack rather than a hang.
;
; Defined here, ahead of call_ret_lo/hi below, rather than beside OP_CALL
; further down: call_ret_hi's own address is an expression in this constant
; rather than a second literal, so raising it can never leave the two arrays
; overlapping the way two independently-hand-kept numbers could. It must stay
; small enough that call_ret_lo + 2*CALL_STACK_DEPTH does not run past $FF --
; the end of zero page -- and the next thing this map allocates after
; call_ret_hi has to move down with it if it ever needs to grow past what
; fits before $0340 (the music RAM below).
CALL_STACK_DEPTH = 4

; A common event's call stack: where to resume in the caller once the callee
; runs out of pages. call_depth is the count in use, and also the next free
; slot -- a call pushes the return point at call_ret_lo/hi[call_depth] and
; then increments it, a return decrements first and reads the same slot back.
call_depth  = $7E
call_ret_lo = $7F                          ; CALL_STACK_DEPTH bytes  @size=CALL_STACK_DEPTH
call_ret_hi = call_ret_lo+CALL_STACK_DEPTH ; CALL_STACK_DEPTH bytes  @size=CALL_STACK_DEPTH

; spawn_entities' own ascending counter: which record of the screen's entity
; list the loop is on, whether or not that record is the one being placed
; into a slot -- a hidden record still has to count, or the ordinal handed
; to the record after it would be wrong. Scratch, good for nothing once
; spawn_entities returns.
ent_spawn_rec = call_ret_hi+CALL_STACK_DEPTH

; What battle_begin (engine/rpg.asm) found in talk_ent the moment it ran:
; the entity slot whose event is mid-script and about to suspend on this
; battle, or NO_ENTITY for a random or contact-damage fight, neither of
; which has a script running to suspend. Captured before battle_begin's own
; "no conversation is showing" reset clears talk_ent, and translated to
; bt_owner_rec (ent_record's ordinal, not the slot) in the same breath, since
; the slot is exactly what the redraw at the other end of the battle is free
; to reassign.
bt_owner_ent = ent_spawn_rec+1
bt_owner_rec = bt_owner_ent+1

; Which map is on screen and which song is sounding, so a redraw can tell
; whether either has to change -- see apply_map_music and set_music in
; music.asm, the single place either is applied. Both are reset to their
; sentinels by init_session, since a game over is a genuinely new game and
; must not inherit the song of wherever the player died.
;
; Chained off bt_owner_rec, not off call_ret_hi directly: the comment beside
; CALL_STACK_DEPTH already warns that whatever this map allocates next has to
; move down with call_ret_hi's own array, and cur_map used to be that next
; thing until ent_spawn_rec/bt_owner_ent/bt_owner_rec (above) took the byte it
; was sitting on -- both chained from the same call_ret_hi+CALL_STACK_DEPTH
; expression, silently sharing $87/$88 between spawn_entities' record counter
; and the map/song bytes until a battle whose owner happened to be recorded
; as actor 4 also read back as cur_song 4, and music.asm's own next write
; stepped on bt_owner_ent mid-battle_end.
cur_map     = bt_owner_rec+1               ; NO_MAP until a screen decides
cur_song    = cur_map+1                    ; NO_SONG until set_music runs

; Which of the title's two prompt strings is on screen right now -- sys_press_start
; or sys_press_start_continue -- so title_tick's blink can reuse it without
; re-deciding (and re-running save_check_valid) every 32 frames. Set once, by
; title_draw, each time the title is (re)drawn. Unconditional rather than
; .if SAVE_ENABLED: title_blit_prompt/title_prompt_write read through this
; pointer either way, which costs one byte less per access than the label they
; used to address directly ([ptr],y is smaller than abs,y).
title_prompt_lo = cur_song+1
title_prompt_hi = title_prompt_lo+1

; The save record's table-driven copy (engine/save.asm): save_ptr is the
; current field's RAM address, save_cursor is where in the record (SAVE_BASE,
; media-dependent) it lands, sv_idx is which of SAVE_FIELD_COUNT fields is
; running and sv_len is its length -- one generic loop walks
; save_field_lo/hi/len (assets/save.inc) with these rather than eighteen
; hand-written copies, in both directions.
save_ptr_lo    = title_prompt_hi+1
save_ptr_hi    = save_ptr_lo+1
save_cursor_lo = save_ptr_hi+1
save_cursor_hi = save_cursor_lo+1
sv_idx         = save_cursor_hi+1
sv_len         = sv_idx+1

; A scripted Move in progress (OP_MOVE, engine/script.asm; move_tick,
; engine/entities.asm). mv_left is the whole state machine: non-zero means a
; move is running, which is what ui_tick tests before it dispatches on
; game_state, and reaching zero is what resumes the script. So there is no
; separate "is a move active" flag to keep in step with the distance left --
; the same reason box_state carries its own CLOSED rather than pairing a
; counter with a boolean.
;
; mv_step is this frame's step, which is the mover's speed except on the last
; frame, where it is whatever distance remains -- a Move of 5 with a speed of 2
; must land on 5, not overshoot to 6 and wrap the subtraction. mv_tmp holds the
; candidate coordinate across the probe, since probe_solid takes its arguments
; in probe_x/probe_y and answers in A.
;
; `mv_`, not `move_`, because engine/player.asm already owns move_left/
; move_right/move_up/move_down as the player's own direction setters -- a
; `move_left` byte here would be a second definition of a label this engine
; already jumps to, which is a collision nesasm has no reason to notice.
mv_who         = sv_len+1
mv_dir         = mv_who+1
mv_left        = mv_dir+1
mv_step        = mv_left+1
mv_tmp         = mv_step+1

; Set by switch_prg_bank (engine/banks.asm, MMC3 builds only) for the handful
; of instructions between selecting a mapper register and writing its value --
; the window a stray interrupt in that gap would corrupt (see the Register
; discipline comment at the top of split.asm). sei/php around that window
; keep the scanline IRQ out, but NMI cannot be masked that way, so this flag
; is how split_arm (called from NMI) knows to skip its own R1 write for the
; frame rather than land inside the pair: at most one frame of the wrong CHR
; bank on the split, never a half-selected PRG or CHR register.
split_lock     = mv_tmp+1

; A scripted Wait in progress (OP_WAIT, engine/script.asm; wait_tick,
; engine/entities.asm). The same "the counter is the whole state" shape
; mv_left already is: non-zero means a wait is running, and reaching zero is
; what resumes the script. mv_left and wt_left can never both be non-zero --
; the script suspends on whichever of Move or Wait it hits first, and cannot
; reach the other until that one resumes -- see wait_tick's own comment.
;
; Chained after split_lock, not after mv_tmp: wt_left is new, so it goes at
; the tail of the allocation map rather than pushing split_lock -- a symbol
; that pre-dates it -- one byte further along. A switched-off Wait must cost
; a project not one byte, including the byte of every *other* symbol's own
; address changing underneath it; putting the new symbol anywhere but the end
; of the chain is exactly how that happens by accident.
wt_left        = split_lock+1

; A scripted Shake in progress (OP_SHAKE, engine/script.asm; the shake block
; inside nmi_scroll, engine/boot.asm). Unlike mv_left/wt_left, this is ticked
; from NMI rather than a frozen-world tick, because Shake does not suspend
; the script: the world keeps running while it counts down, so it must keep
; counting down after the world unfreezes too, which ui_tick could not do --
; ui_tick only runs while game_state is non-zero. Reaching zero simply stops
; applying an offset; nothing resumes, because nothing was suspended.
;
; Shake also has no "world is frozen" invariant protecting it from a screen
; change mid-count the way mv_left/wt_left's own suspend does, so
; vram_reset (engine/text.asm) clears this explicitly on every real redraw
; rather than relying on it decrementing to zero naturally -- see its own
; comment.
;
; Chained after wt_left for the identical reason wt_left itself was chained
; after split_lock: a switched-off Shake must not move any other symbol's
; address, including wt_left's.
shake_left     = wt_left+1

; A scripted Fade in progress (OP_FADE, engine/script.asm; fade_tick,
; engine/entities.asm). Suspends the script the way mv_left/wt_left already do --
; see script.asm's own header for why mv_left, wt_left and fade_left can never
; more than one be non-zero at a time. fade_step is the palette's current
; darkness level (0 = the project's own palette, FADE_STEPS = fully black);
; unlike mv_left/wt_left it must persist between steps, because the ramp has
; somewhere to remember *where it is*, not just *how much longer*. fade_reload
; is unrelated to the ramp itself -- it is a one-shot "the next redraw_screen
; must reload the palette from ROM" flag, set only by init_session (and
; cleared again by reset right after cold boot's own call, so it cannot leak
; into the session's first ordinary redraw) and consumed only by
; redraw_screen.
;
; Chained after shake_left for the identical reason shake_left itself was
; chained after wt_left: a switched-off Fade must not move any other symbol's
; address, including shake_left's.
fade_step   = shake_left+1     ; 0..FADE_STEPS, current darkness level
fade_target = fade_step+1      ; 0..FADE_STEPS, where this ramp is headed
fade_left   = fade_target+1    ; frames until the next step is applied
fade_reload = fade_left+1      ; non-zero: the next redraw_screen must reload
                                ; palette_data before re-enabling rendering

; A scripted Flash in progress (OP_FLASH, engine/script.asm; flash_tick,
; engine/entities.asm, ticked unconditionally from main_loop, not ui_tick --
; see flash_tick's own header for why Flash does not suspend and cannot join
; mv_left/wt_left/fade_left's own mutual exclusion). flash_left is the whole
; state machine, one byte, three kinds of value: 0 is idle; 1..FLASH_ARM_VALUE
; is counting down through the arm-and-hold (FLASH_ARM_VALUE itself is the
; tick flash_tick recognises as "just armed, push the flash colour now");
; FLASH_PENDING is a distinct, nonzero sentinel meaning "the restore packet
; was queued on the previous tick, not yet confirmed drained by the following
; NMI" -- a redraw racing that exact window (vram_reset, engine/text.asm)
; must still see something outstanding, which a bare 0 could not tell it.
;
; Chained after fade_reload for the identical reason fade_step itself was
; chained after shake_left: a switched-off Flash must not move any other
; symbol's address, including fade_reload's.
flash_left  = fade_reload+1

; The $10-per-row darken trick reaches solid black in at most this many
; subtractions from any starting row; the hold between steps is an engine
; constant, not authored -- see OP_FADE below and shared/project.js's
; FADE_DIRECTIONS for why the wire format carries no duration of its own.
FADE_STEPS       = 4
FADE_STEP_FRAMES = 6

; Flash's own engine constants, none of them authored -- see OP_FLASH below
; and shared/project.js's EVENT_COMMANDS comment for why Flash's wire format
; carries no colour or duration operand at all. FLASH_COLOR ($30) is the
; brightest white row 3 hue 0 of the NES master palette has
; (shared/nespalette.js's own RAW table); it is a fixed constant, never
; derived from project data, so it needs no isUnsafeColor-style clamp the way
; Fade's own ramp does. FLASH_TOTAL_FRAMES is the visible hold, in NMI
; drains, between the flash colour landing and the restore landing;
; FLASH_ARM_VALUE is one more than that -- the value flash_left is armed to,
; and the edge flash_tick's first tick since arming recognises -- because the
; arming tick itself only queues the flash-on packet and does not yet count
; as a held frame. FLASH_PENDING ($FF) is chosen the same way this codebase's
; NO_ACTOR/NO_ITEM sentinels already are: a value the ordinary counting range
; (0..FLASH_ARM_VALUE) can never reach on its own.
FLASH_COLOR      = $30
FLASH_TOTAL_FRAMES = 6
FLASH_ARM_VALUE  = FLASH_TOTAL_FRAMES+1
FLASH_PENDING    = $FF

; Which split program this frame runs. OFF disarms the counter entirely.
SPL_OFF     = 0
SPL_BOX     = 1             ; the message box: font in from tile row 24
SPL_BATTLE  = 2             ; the battle box: font in from tile row 20
SPL_TITLE   = 3             ; the title's two text bands

; ------------------------------------------------------------- music RAM
; Six parallel arrays, one byte per channel, at $0340.
MUS_CHANNELS = 4
mus_ptr_lo  = $0340  ; @size=MUS_CHANNELS
mus_ptr_hi  = $0344  ; @size=MUS_CHANNELS
mus_dur     = $0348         ; frames left on the current event  @size=MUS_CHANNELS
mus_inst    = $034C  ; @size=MUS_CHANNELS
mus_step    = $0350         ; envelope step  @size=MUS_CHANNELS
mus_note    = $0354         ; $FF when the channel is resting  @size=MUS_CHANNELS
mus_trig    = $0358         ; a note started this frame  @size=MUS_CHANNELS

MUS_REST    = $FE
MUS_LOOP    = $FF
MUS_INST    = $F0
NO_SONG     = $FF
NO_MAP      = $FF           ; cur_map: no screen has decided the music yet
NUM_NOTES   = 96

; ------------------------------------------------------------ entity RAM
; Eight parallel arrays at $0300, one byte per slot.
MAX_ENTITIES = 8
; ent_active packs two facts into one byte rather than two arrays: bit 0 is
; "this slot is occupied at all" (every one of the nine existing reads of
; ent_active is `lda ent_active,x` immediately followed by beq/bne, never a
; cmp #1 or an arithmetic use, so a slot holding ENT_HIDDEN|ENT_PRESENT still
; reads as occupied everywhere unchanged) and bit 1, ENT_HIDDEN, is
; script_op_visible's own flag -- invisible but otherwise fully alive: AI,
; contact and interaction all keep reading bit 0 and never look at bit 1.
; Only draw_entities tests ENT_HIDDEN, because a second array would be one
; more thing spawn_entities and every future writer has to keep in sync, and
; a packed bit cannot drift out of sync with itself.
ENT_PRESENT = $01
ENT_HIDDEN  = $02
ent_active  = $0300  ; @size=MAX_ENTITIES
ent_actor   = $0308  ; @size=MAX_ENTITIES
ent_x       = $0310  ; @size=MAX_ENTITIES
ent_y       = $0318  ; @size=MAX_ENTITIES
ent_dir     = $0320  ; @size=MAX_ENTITIES
ent_frame   = $0328         ; index into the actor's animation  @size=MAX_ENTITIES
ent_timer   = $0330  ; @size=MAX_ENTITIES
ent_hp      = $0338         ; hits left, seeded from actor_hp at spawn  @size=MAX_ENTITIES
ent_to_scr  = $0360         ; door target: screen, then position  @size=MAX_ENTITIES
ent_to_x    = $0368  ; @size=MAX_ENTITIES
ent_to_y    = $0370  ; @size=MAX_ENTITIES
ent_event   = $0380         ; the event this actor runs  @size=MAX_ENTITIES
ent_hurt    = $0388         ; frames left flashing after a hit  @size=MAX_ENTITIES

; ------------------------------------------------------------- battle arrays
; Nine parallel arrays for the party, four entries each, and four for the
; monsters on screen. Everything the battle system needs about a combatant is
; one indexed load away.
MAX_PARTY   = 4
MAX_MONSTERS = 4
NUM_COMBATANTS = 8          ; party 0-3, monsters 4-7
pc_hp       = $0398  ; @size=MAX_PARTY
pc_hp_max   = $039C  ; @size=MAX_PARTY
pc_mp       = $03A0  ; @size=MAX_PARTY
pc_mp_max   = $03A4  ; @size=MAX_PARTY
pc_level    = $03A8  ; @size=MAX_PARTY
pc_xp_lo    = $03AC  ; @size=MAX_PARTY
pc_xp_hi    = $03B0  ; @size=MAX_PARTY
pc_in_party = $03B4         ; recruited, so it takes a slot in battle  @size=MAX_PARTY
pc_spells   = $03B8         ; bitmask of the spells known at this level  @size=MAX_PARTY

mon_slot_actor = $03BC      ; which actor id is in this monster slot  @size=MAX_MONSTERS
mon_slot_hp = $03C0  ; @size=MAX_MONSTERS
mon_slot_max = $03C4  ; @size=MAX_MONSTERS
mon_slot_alive = $03C8  ; @size=MAX_MONSTERS

turn_order  = $03CC         ; NUM_COMBATANTS entries, fastest first  @size=NUM_COMBATANTS
bt_digits   = $03D4         ; three decimal digits, most significant first  @size=3
; $03D8-$03E3 (12 bytes) is free. It held bt_line, "the message area's
; staging buffer" -- a byte array push_battle_string (engine/battleui.asm)
; never turned out to need: it writes each glyph straight to VRAM out of
; bs_text and bt_digits as it goes, with no local buffer to stage a line
; into first. Nothing else ever read or wrote it either; the RAM guard
; (test/unit/rammap.test.js) has no way to catch a block that is simply
; unused, only one that collides, so this was only found by checking every
; @size annotation against the code that actually indexes it.
bt_list     = $03E4  ; the open spell or item list -- up to eight  @size=8
                            ; entries, not the four the box shows at once:
                            ; build_spell_list/build_item_list
                            ; (engine/battleui.asm) fill the whole list, and
                            ; spell_chosen/item_chosen (engine/battleturn.asm)
                            ; index it with bt_sel directly, which draw_list's
                            ; own cursor comparison (bt_vrow+bt_scroll against
                            ; bt_sel) proves is the *absolute* position in
                            ; that list, not a 0-3 row on screen. LIST_ROWS is
                            ; how many of those eight the box can show at
                            ; once, scrolled by bt_scroll -- not how many
                            ; entries this array holds.
mon_slot_mp = $03EC         ; what each monster has left to cast with  @size=MAX_MONSTERS
; Status bits, one byte per combatant side. Bit 0 is poison, the only status;
; both are cleared when a battle starts, so nothing carries into the field.
pc_status   = $03F0  ; @size=MAX_PARTY
mon_slot_status = $03F4  ; @size=MAX_MONSTERS

MSG_ROW     = 21            ; the message area and the lists share these rows
LIST_ROWS   = 4

; ------------------------------------------------------------- switch RAM
; 64 one-bit flags, which is what an event sets and tests. They survive a screen
; change and a warp, and only a new game clears them.
NUM_SWITCHES = 64
switches    = $0390         ; eight bytes, bit (n & 7) of byte (n >> 3)  @size=8
NO_SWITCH   = $FF           ; an actor that no switch hides

; ------------------------------------------------------------- variable RAM
; Named 8-bit counters an event sets, adds to, subtracts from and compares --
; what a switch cannot express, which is anything with more than two states.
; They live beside the switches in every other respect: cleared by init_session,
; and untouched by a screen change or a warp. NUM_VARIABLES is generated into
; config.inc from RPG_LIMITS.variables, so how many there are has one writer and
; it is not this file.
variables   = $0500  ; @size=NUM_VARIABLES

; ------------------------------------------------------------- trigger RAM
; Three more per-slot arrays, over here rather than beside the others because
; the $0300 page is spoken for down to its last eight bytes.
;
; ent_trigger is the record's trigger byte, held per slot because the touch test
; has to run for every actor every frame. ent_touched is that test's memory: the
; player is still standing on the actor when the conversation it started ends,
; so without it the event would begin again the moment the box came down, for
; as long as the player stood there.
;
; ent_record is which record in the screen's own entity list -- the fixed,
; authored order the Map Forge saved, not the slot a hide switch or a
; respawn happened to land it in -- spawn_entities filled this slot from.
; That ordinal is the one thing about a placement spawn_entities cannot
; change: hiding an earlier actor moves *slots* around, never records. A
; battle that began mid-script remembers the record here (battle_end,
; engine/rpg.asm) rather than the slot, so it can find the same actor again
; after the redraw that ended the battle has possibly handed it a new one.
ent_trigger = $0510  ; @size=MAX_ENTITIES
ent_touched = $0518  ; @size=MAX_ENTITIES
ent_record  = $0520  ; @size=MAX_ENTITIES

; Triggers, in the same order as EVENT_TRIGGERS in shared/project.js.
TRIG_INTERACT = 0           ; the interact action, in reach -- what every event
                            ; did before this byte existed, which is why it is 0
TRIG_TOUCH  = 1
TRIG_ENTER  = 2             ; the screen loaded

; ------------------------------------------------------------- sting RAM
; Six arrays' worth of shadowed channel state (24 contiguous bytes, indexed
; identically to mus_ptr_lo,x for x=0..23 -- this only works because those
; six arrays are declared back-to-back in exactly this order in the music RAM
; block above, with no gap and no seventh array inserted between any two of
; them; moving one, or adding a new per-channel music array later, silently
; breaks sting_snapshot/sting_restore's shared loop without an assembler
; error), then the two flags and the countdown, then the shared retrigger
; array force_trig also uses (music_channel, engine/music.asm) -- four bytes,
; one per channel, self-clearing on use. Appended right after ent_record
; (above, ending $0527) rather than reusing either of the two smaller
; confirmed-free blocks elsewhere on this page ($035C-$035F, 4 bytes; the
; documented $03D8-$03E3, 12 bytes) -- the convention this file's own
; comments hold to elsewhere. See design-sting.md §6.
sting_shadow        = $0528  ; @size=24, mirrors mus_ptr_lo..mus_note
sting_shadow_song   = $0540  ; the shadowed cur_song
sting_shadow_enabled = $0541 ; the shadowed mus_enabled
sting_left          = $0542  ; frames left on the sting; 0 = idle
force_trig          = $0543  ; @size=MUS_CHANNELS

; ------------------------------------------------------------ inventory RAM
; One id per item carried, oldest first -- an item id under ITEMS_ENABLED, or
; the legacy backing-actor id on the disabled economy, which never gained a
; real item id space of its own. Not a per-screen array: the bag travels with
; the player, so it survives a screen change.
MAX_ITEMS   = 8
inv_items   = $0378  ; @size=MAX_ITEMS

; ------------------------------------------------------------- VRAM queue RAM
; One page, so the NMI's drain loop can index the whole queue with X. Packets are
; [addr_hi, addr_lo, count, bytes...] and a zero addr_hi terminates.
vram_buf    = $0400  ; @size=256

; --------------------------------------------------- UNROM 512 flash save RAM
; Console RAM the self-flashing driver runs from and the record it flashes
; sits in -- see engine/flash.asm's own header for why the driver cannot
; execute from ROM during a program or erase, and why that requires it to
; run from true console RAM ($0000-$07FF) rather than anywhere the flash
; chip's own busy overlay ($8000-$FFFF) can reach. Both are reserved
; unconditionally, the same reasoning vram_buf and every other array on
; this page already holds to:
; the labels cost nothing on a board that never assembles .if SAVE_FLASH
; code, and reserving them only there would leave this guard unable to see
; them on every other build.
;
; $0600, not lower: ent_record (above) ends at $0527, and this leaves a
; clean page boundary between the two rather than packing the driver
; immediately after it purely to save the space -- sting RAM (above) now
; uses 31 of those bytes, and flash_driver still starts cleanly at the next
; page regardless of how many of the rest anything else ever claims.
;
; FLASH_DRIVER_MAX is a measured ceiling, not a guess: engine/flash.asm's
; own .if guard fails the build the moment the assembled driver grows past
; it, the same discipline KERNEL_SLACK enforces for the kernel bank as a
; whole -- see that guard for the real measured size.
FLASH_DRIVER_MAX = 160
flash_driver     = $0600  ; @size=FLASH_DRIVER_MAX
; SAVE_RECORD_LEN (config.inc) is the whole record -- body, checksum,
; identity and marker together, the same span save.inc's own SAVE_BASE..
; SAVE_MARKER equates lay out contiguously. This is the flash medium's
; SAVE_BASE (main/build/generate.js): two independent literals that have to
; agree on the number $0700, not one computed from the other, the same
; situation MAX_ITEMS above is already in with shared/save.js's own copy.
save_flash_buf   = $0700  ; @size=SAVE_RECORD_LEN

; Behaviours, in the same order as BEHAVIORS in shared/project.js.
BEH_PLAYER  = 0
BEH_PATROL  = 1
BEH_CHASE   = 2
BEH_PICKUP  = 3
BEH_DOOR    = 4
BEH_NPC     = 5             ; stands still; update_entities only animates it

NO_ANIM     = $FF
NO_ENTITY   = $FF           ; talk_ent: nobody is speaking
NO_EVENT    = $FF           ; ent_event: this actor has nothing to say
NO_ACTOR    = $FF           ; mon_slot_actor: an empty formation slot
NO_ITEM     = $FF           ; inv_items under ITEMS_ENABLED, and every
                            ; give/take/Carrying/drop operand -- an item
                            ; that does not exist. Matches shared/project.js's
                            ; own NO_ITEM; same value as NO_ACTOR by
                            ; convention (both $FF), not by any relationship
                            ; between the two id spaces.
NO_METASPRITE = $FF         ; item_metasprite: no icon, whether because none
                            ; was ever set and legacy derivation found
                            ; nothing to derive from, or because an author
                            ; explicitly chose no icon. Matches
                            ; shared/project.js's own NO_METASPRITE.
NO_COMMON_EVENT = $FF       ; OP_CALL's own operand: the named common event
                            ; does not resolve to a table slot -- see
                            ; script_op_call

; An item's effect, in the same order as ITEM_EFFECT_KINDS in
; shared/project.js -- item_effect_kind (engine/ui.asm's use_item_apply)
; indexes this order directly, so a kind's number is spelled here and
; nowhere else.
EFFECT_NONE   = 0
EFFECT_HEAL   = 1
EFFECT_DAMAGE = 2

TOUCH_RANGE = 12            ; how close counts as touching, in pixels
REACH_RANGE = 20            ; how far attack and interact reach

; Collision types, in the same order as COLLISION_TYPES in shared/project.js.
; Anything from COL_DAMAGE up is walked through rather than blocked, which is why
; probe_solid's range test uses it as the boundary.
COL_OPEN    = 0
COL_SOLID   = 1
COL_WATER   = 2
COL_DAMAGE  = 3
COL_WARP    = 4

; Battle phases. Each is a state the tick advances; the world is frozen behind
; all of them because ST_BATTLE is not ST_GAMEPLAY.
BP_INTRO    = 0             ; the screen has just been drawn
BP_MENU     = 1             ; a party member is choosing
BP_TARGET   = 2             ; ...and now picking who to do it to
BP_SPELLS   = 3
BP_ITEMS    = 4
BP_ACT      = 5             ; resolve the chosen action
BP_MESSAGE  = 6             ; hold a line of text for a moment
BP_NEXT     = 7             ; advance the turn order
BP_VICTORY  = 8
BP_DEFEAT   = 9
BP_FLEE     = 10
BP_DONE     = 11            ; leave the battle on the next tick

; What the trampoline is being asked for. One entry point, because every extra
; one is another place the bank could be left switched in.
BE_INIT     = 0             ; build the party from the tables: a new game
BE_TICK     = 1             ; one frame of battle
BE_JOIN     = 2             ; recruit the party member in bt_arg (the Join command)

; The battle screen, in tile rows. Sky, then ground with the monsters standing
; on it, then the box -- FALLEN STAR's geometry, which is what the user asked
; this to look like.
BT_SKY_ROWS = 4
BT_BOX_ROW  = 20
BT_MON_ROW  = 4             ; the first monster's top row
BT_MON_STEP = 4             ; and the rows between them
BT_MON_COL  = 4
BT_CMD_COL  = 3             ; FIGHT / MAGIC / ITEM / RUN down the left
BT_CMD_ROW  = 22
BT_CMD_STEP = 2
BT_PANEL_COL = 15           ; the party's names and hit points down the right
BT_PANEL_ROW = 21
MSG_COL     = 2             ; the message area, which replaces the command column
MSG_COLS    = 12
BT_PARTY_X  = 200           ; where the party stands, in screen pixels
BT_PARTY_Y  = 32
BT_PARTY_STEP = 32
MSG_HOLD    = 45            ; frames a line of battle text stays up

; The battle menu, in the order it is drawn down the left of the box.
BC_FIGHT    = 0
BC_MAGIC    = 1
BC_ITEM     = 2
BC_RUN      = 3
NUM_COMMANDS = 4

; Spell kinds, in the order of SPELL_KINDS in shared/project.js -- that order is
; the wire format, exactly as the actions and the game states are.
SK_DAMAGE   = 0
SK_HEAL     = 1
SK_POISON   = 2
POISON_DMG  = 2             ; what a poisoned combatant loses after each turn

; Getting hit. The invincible window is long enough to walk out of whatever hit
; you, which is what stops a chaser draining the whole bar in half a second.
IFRAME_TIME = 60
KNOCKBACK_TIME = 8
KNOCKBACK_SPEED = 3
HURT_TIME   = 16            ; how long a struck actor flashes
HUD_X       = 16            ; where the hearts sit, in screen pixels
HUD_Y       = 16
HUD_PAL     = 0             ; sprite palette 0, which the hearts are drawn for

; Actions, in the same order as ACTIONS in shared/project.js.
ACT_NONE    = 0
ACT_ATTACK  = 1
ACT_INTERACT = 2
ACT_DASH    = 3
ACT_ITEM    = 4
ACT_PAUSE   = 5
ACT_CANCEL  = 6
ACT_CONFIRM = 7
ACT_CONTINUE = 8            ; title only, and only where SAVE_ENABLED -- loads
                            ; the one save slot; do_action ignores it anywhere
                            ; else, the same as any action bound somewhere it
                            ; means nothing

NUM_STATES  = 6             ; gameplay, menu, dialogue, title, game over, battle
NUM_BUTTONS = 4             ; A, B, Select, Start

; Game states, in the same order as INPUT_STATES in shared/project.js: the state
; is the row of input_actions the dispatcher reads, so the two orders are one
; fact. Every state but the first freezes the world.
ST_GAMEPLAY = 0
ST_MENU     = 1
ST_DIALOG   = 2
ST_TITLE    = 3
ST_GAMEOVER = 4
ST_BATTLE   = 5

; Where the frozen-world overlays sit, in screen pixels. The inventory is a row
; of item sprites across the top; the highlighted one lifts, which is the cursor.
ITEM_ROW_X  = 32
ITEM_ROW_Y  = 24
ITEM_ROW_DX = 24            ; pixels between slots; 8 slots fit the screen
ITEM_LIFT   = 4
PORTRAIT_X  = 116           ; where the actor you are talking to is drawn
PORTRAIT_Y  = 40
PORTRAIT_LIFT = 2

; ------------------------------------------------------------- message window
;
; The box is the bottom six tile rows, 24-29, which is exactly metatile rows
; 12-14 with no half-row left over -- that alignment is what lets box_close
; rebuild the rows straight out of the metatile table instead of keeping a copy.
; Full width, so the frame runs down columns 0 and 31; the four text rows are
; BOX_COLS wide with one space of padding inside each border.
;
; Character cells therefore start at $2300 + 32 + 2 = $2322, and the whole box
; fits inside $23xx, which is why every address below is a single low byte.
; The glyph indices themselves (TILE_SPACE, BORDER_*, ARROW_TILE) are generated
; into config.inc from shared/font.js, which is their single writer.
BOX_ADDR_HI   = $23         ; the whole box lives inside $2300-$23FF
BOX_ROWS_HIGH = 6           ; border, four text rows, border
BOX_TEXT_ROWS = 4           ; keep in step with BOX_ROWS in shared/font.js
BOX_TEXT_LO   = $22         ; low byte of the first character cell
BOX_ATTR_LO   = $F0         ; attribute bytes 48-63 cover tile rows 24-31
BOX_MT_ROW    = 12          ; metatile row the box starts on
; The page arrow goes in the last text row's right-hand padding column, not on
; the frame below it: tile row 29 and columns 0 and 31 are inside the overscan a
; TV throws away, and so is the frame that runs through them. Losing decoration
; there is normal for an NES message box -- losing the prompt that tells the
; player to press a button is not.
ARROW_LO      = $9E

; box_state. Everything but CLOSED freezes the world, and everything but the
; WAIT states is a multi-frame job the tick advances by one step per frame -- the
; NMI queue only carries one row of tiles per vblank.
BOX_CLOSED    = 0
BOX_OPENING   = 1
BOX_TYPING    = 2
BOX_PAGEWAIT  = 3           ; page full, more text after it
BOX_CLEARING  = 4
BOX_CLOSING   = 5
BOX_ENDWAIT   = 6           ; the message is over; confirm resumes the script
BOX_CHOICE    = 7           ; listing a question's options, one row per frame
BOX_CHOICEWAIT = 8          ; ...and waiting for one of them to be picked

; String bytes. Glyphs are $A0-$FF (see shared/font.js), so anything below the
; font's base is free to be a control code.
TXT_END     = $00
TXT_NEWLINE = $01
TXT_PAGE    = $02

; Event page conditions and command opcodes, in the order of EVENT_CONDITIONS
; and EVENT_COMMANDS in shared/project.js. That order is the wire format, so
; adding one means editing both ends in the same change.
COND_NONE     = 0
COND_SW_ON    = 1
COND_SW_OFF   = 2
COND_HAS_ITEM = 3
COND_VAR_EQ   = 4
COND_VAR_GE   = 5
COND_VAR_LT   = 6

EVT_PAGES_END = $FF         ; no further page: the event has nothing to say
; cond, arg, value, body length. The value byte is there on every page, not only
; the ones whose condition compares against a number, because script_skip steps
; over a declined page without decoding what declined it.
EVT_PAGE_HEAD = 4

OP_END      = $00
OP_SAY      = $01
OP_GIVE     = $02
OP_TAKE     = $03
OP_SET_SW   = $04
OP_CLR_SW   = $05
OP_WARP     = $06
OP_JOIN     = $07
OP_SET_VAR  = $08
OP_ADD_VAR  = $09
OP_SUB_VAR  = $0A
OP_IF       = $0B           ; [cond, arg, value, length of the then-branch] --
                            ; deliberately the same four bytes a page header is,
                            ; so script_cond reads a branch and a page alike
OP_CHOICE   = $0C           ; [count, a string id per option] then one record per
                            ; option: [length, commands, OP_JUMP, the rest of the
                            ; question]. A branch the player takes rather than
                            ; the condition, down to ending each option the same
                            ; way a then-branch ends
OP_CALL     = $0D           ; [which common event] -- run it and come back to
                            ; the command after this one; see call_depth and
                            ; CALL_STACK_DEPTH in the zero page map above
OP_MUSIC    = $0E           ; [song index or NO_SONG] -- see set_music in
                            ; music.asm, which both this and a map arriving
                            ; apply through
OP_BATTLE   = $0F           ; [MAX_MONSTERS actor ids, NO_ACTOR-padded] --
                            ; suspends the script exactly as OP_SAY does; see
                            ; script_op_battle and battle_end in engine/rpg.asm.
                            ; Only assembled where BATTLE_ENABLED is, the same
                            ; as OP_JOIN: an action build has no battle bank to
                            ; call into, so the opcode has nowhere to dispatch
OP_HEAL     = $10           ; [amount] -- unlike OP_JOIN/OP_BATTLE, always
OP_DAMAGE   = $11           ; assembled: gain_hearts/lose_hearts (combat.asm)
                            ; or party_heal/party_damage (rpg.asm), decided by
                            ; BATTLE_ENABLED inside script_op_heal/
                            ; script_op_damage rather than at dispatch, because
                            ; neither command is RPG-only the way Join is
OP_SAVE     = $12           ; no operand -- one slot, nothing to name. Only
                            ; assembled where SAVE_ENABLED is (engine/save.asm);
                            ; validateProject refuses a live one elsewhere the
                            ; opcode has nowhere to dispatch, the same shape as
                            ; OP_JOIN/OP_BATTLE on a build with no battle bank
OP_MOVE     = $13           ; [who, DIR_*, distance in pixels] -- suspends the
                            ; script the way OP_SAY does, and move_tick
                            ; (engine/entities.asm) resumes it once the walk
                            ; finishes or runs into something. The direction
                            ; byte is a DIR_* because MOVE_DIRECTIONS
                            ; (shared/project.js) is written in that order, so
                            ; nothing has to translate it
OP_TURN     = $14           ; [who, DIR_*] -- Move's own facing decision
                            ; (move_face, engine/entities.asm) made reachable
                            ; on its own. Does not suspend: script_op_turn
                            ; (engine/script.asm) applies it and runs straight
                            ; on to the next command, the same instant shape
                            ; OP_SET_SW already has.
OP_WAIT     = $15           ; [frames] -- suspends the script like OP_MOVE,
                            ; but pauses the world rather than walking anyone.
                            ; wait_tick (engine/entities.asm), hooked into
                            ; ui_tick the same way move_tick already is,
                            ; resumes it once the count reaches zero.
OP_SHAKE    = $16           ; [frames] -- does not suspend, the same instant
                            ; shape OP_TURN already has. shake_tick
                            ; (engine/boot.asm's nmi_scroll) ticks in NMI, not
                            ; ui_tick, because the shake must keep running
                            ; after the world unfreezes -- see shake_left's
                            ; own comment below.
OP_VISIBLE  = $17           ; [state] -- self only, resolved through talk_ent
                            ; the way OP_MOVE/OP_TURN's own MOVE_SELF already
                            ; is; there is only one target this command can
                            ; ever mean, so there is no "who" byte to spend.
                            ; Does not suspend, the same instant shape OP_TURN
                            ; already has. state 0 = hidden, 1 = shown -- see
                            ; ENT_HIDDEN below for what hidden actually means.
OP_FADE     = $18           ; [direction] -- suspends the script exactly as
                            ; OP_WAIT/OP_MOVE do, because a cutscene fade has
                            ; something to wait for and nothing to walk; see
                            ; fade_step's own comment above and script_op_fade
                            ; (engine/script.asm). direction 0 = none (does
                            ; nothing -- a fresh, unconfigured command), 1 =
                            ; out (to black), 2 = in (from black), matching
                            ; FADE_DIRECTIONS' own array order in
                            ; shared/project.js exactly.
OP_FLASH    = $19           ; no operand -- flash the screen to FLASH_COLOR
                            ; and back, a fixed engine-timed burst with no
                            ; configuration surface at all. Does not suspend,
                            ; the same instant shape OP_TURN/OP_VISIBLE/
                            ; OP_SHAKE already have -- see flash_tick's own
                            ; comment (engine/entities.asm) for why it ticks
                            ; from main_loop rather than ui_tick.
OP_STING    = $1A           ; [song index or NO_SONG, duration in frames] --
                            ; pauses the current song, plays the named one
                            ; alone through the unmodified driver, and resumes
                            ; the original where it left off once the duration
                            ; elapses -- unless something else asks the driver
                            ; to play a song in the meantime, which cancels
                            ; the resume rather than seaming into it (see
                            ; music_play's own cancellation check below). Does
                            ; not suspend, the same instant shape OP_FLASH
                            ; already has. A duration of 0 means the operand
                            ; is NO_SONG -- normalizeSong (shared/audio.js)
                            ; guarantees every real, normalized song has a
                            ; positive duration, so 0 cannot arise any other
                            ; way -- and script_op_sting stops the event
                            ; (jmp script_finish) rather than snapshotting a
                            ; song that would never come back, the same
                            ; family shape script_op_give/NO_ITEM and
                            ; script_op_call/NO_COMMON_EVENT already use for
                            ; a recognised command whose operand names
                            ; nothing: stop, don't silently continue. See
                            ; script_op_sting (engine/script.asm) and
                            ; design-sting.md.

; OP_FADE's own operand. FADE_NONE is 0, unlike OP_TURN/OP_VISIBLE's own
; categorical operands, because both of Fade's real directions are highly
; visible and neither is a safe do-nothing default for a freshly placed
; command -- see shared/project.js's FADE_DIRECTIONS comment.
FADE_NONE   = 0
FADE_OUT    = 1
FADE_IN     = 2

; OP_MOVE/OP_TURN's first operand. MOVE_SELF is 0 for the same reason
; 'interact' is trigger 0: it is the actor the author is looking at when they
; add the command.
MOVE_SELF   = 0             ; whoever the conversation belongs to -- talk_ent
MOVE_PLAYER = 1

; SAVE_MARKER (engine/save.asm) reads as a completed save only when it holds
; exactly this value -- not 0 or 1 or $FF, each of which a blank or corrupt
; chip could plausibly already hold.
SAVE_MARKER_VALID = $A5
; Punctuation rather than a command: the compiler emits it, nothing authors it,
; and it is numbered out of the way of EVENT_COMMANDS so the two orders cannot
; grow into each other. It ends a then-branch by stepping over the else-branch.
OP_JUMP     = $FE

; ------------------------------------------------------------- constants
OAM         = $0200         ; sprite shadow, DMA'd every frame  @size=256

BTN_A       = $80
BTN_B       = $40
BTN_SELECT  = $20
BTN_START   = $10
BTN_UP      = $08
BTN_DOWN    = $04
BTN_LEFT    = $02
BTN_RIGHT   = $01

DIR_DOWN    = 0
DIR_UP      = 1
DIR_LEFT    = 2
DIR_RIGHT   = 3

; The player is 16x16 but only its lower half collides, so it can walk
; "behind" the top edge of a wall the way most top-down games do.
BODY_L      = 2
BODY_R      = 13
BODY_T      = 8
BODY_B      = 15

MAX_X       = 240           ; 256 - 16
MAX_Y       = 224           ; 240 - 16
; NOTE: shared/project.js normalizes a project's startY up to 239, eight more
; than this. A project authored with a start Y past 224 can spawn the player
; somewhere ordinary movement would never walk it to and this engine cannot
; safely index (see save_check_valid, engine/save.asm, which refuses exactly
; such a value coming back out of a save). Pre-existing, independent of
; saving, and left alone here -- flagged, not fixed, the same as
; player_hazard's action/RPG asymmetry.

NO_SCREEN   = $FF           ; neighbour table: nothing that way

PPUCTRL_ON  = $88           ; NMI enabled, sprites read from $1000
PPUMASK_ON  = $1E           ; background + sprites, no left-column clipping

ANIM_RATE   = 8             ; frames between walk-cycle steps
