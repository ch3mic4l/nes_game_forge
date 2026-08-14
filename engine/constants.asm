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

; Which split program this frame runs. OFF disarms the counter entirely.
SPL_OFF     = 0
SPL_BOX     = 1             ; the message box: font in from tile row 24
SPL_BATTLE  = 2             ; the battle box: font in from tile row 20
SPL_TITLE   = 3             ; the title's two text bands

; ------------------------------------------------------------- music RAM
; Six parallel arrays, one byte per channel, at $0340.
MUS_CHANNELS = 4
mus_ptr_lo  = $0340
mus_ptr_hi  = $0344
mus_dur     = $0348         ; frames left on the current event
mus_inst    = $034C
mus_step    = $0350         ; envelope step
mus_note    = $0354         ; $FF when the channel is resting
mus_trig    = $0358         ; a note started this frame

MUS_REST    = $FE
MUS_LOOP    = $FF
MUS_INST    = $F0
NO_SONG     = $FF
NUM_NOTES   = 96

; ------------------------------------------------------------ entity RAM
; Eight parallel arrays at $0300, one byte per slot.
MAX_ENTITIES = 8
ent_active  = $0300
ent_actor   = $0308
ent_x       = $0310
ent_y       = $0318
ent_dir     = $0320
ent_frame   = $0328         ; index into the actor's animation
ent_timer   = $0330
ent_hp      = $0338         ; hits left, seeded from actor_hp at spawn
ent_to_scr  = $0360         ; door target: screen, then position
ent_to_x    = $0368
ent_to_y    = $0370
ent_event   = $0380         ; the event this actor runs when talked to
ent_hurt    = $0388         ; frames left flashing after a hit

; ------------------------------------------------------------- battle arrays
; Nine parallel arrays for the party, four entries each, and four for the
; monsters on screen. Everything the battle system needs about a combatant is
; one indexed load away.
MAX_PARTY   = 4
MAX_MONSTERS = 4
NUM_COMBATANTS = 8          ; party 0-3, monsters 4-7
pc_hp       = $0398
pc_hp_max   = $039C
pc_mp       = $03A0
pc_mp_max   = $03A4
pc_level    = $03A8
pc_xp_lo    = $03AC
pc_xp_hi    = $03B0
pc_in_party = $03B4         ; recruited, so it takes a slot in battle
pc_spells   = $03B8         ; bitmask of the spells known at this level

mon_slot_actor = $03BC      ; which actor id is in this monster slot
mon_slot_hp = $03C0
mon_slot_max = $03C4
mon_slot_alive = $03C8

turn_order  = $03CC         ; NUM_COMBATANTS entries, fastest first
bt_digits   = $03D4         ; three decimal digits, most significant first
bt_line     = $03D8         ; the message area's staging buffer, MSG_COLS wide
bt_list     = $03E4         ; the open spell or item list, one id per row
mon_slot_mp = $03EC         ; what each monster has left to cast with
; Status bits, one byte per combatant side. Bit 0 is poison, the only status;
; both are cleared when a battle starts, so nothing carries into the field.
pc_status   = $03F0
mon_slot_status = $03F4

MSG_ROW     = 21            ; the message area and the lists share these rows
LIST_ROWS   = 4

; ------------------------------------------------------------- switch RAM
; 64 one-bit flags, which is what an event sets and tests. They survive a screen
; change and a warp, and only a new game clears them.
NUM_SWITCHES = 64
switches    = $0390         ; eight bytes, bit (n & 7) of byte (n >> 3)
NO_SWITCH   = $FF           ; an actor that no switch hides

; ------------------------------------------------------------- variable RAM
; Named 8-bit counters an event sets, adds to, subtracts from and compares --
; what a switch cannot express, which is anything with more than two states.
; They live beside the switches in every other respect: cleared by init_session,
; and untouched by a screen change or a warp. NUM_VARIABLES is generated into
; config.inc from RPG_LIMITS.variables, so how many there are has one writer and
; it is not this file.
variables   = $0500

; ------------------------------------------------------------ inventory RAM
; One actor id per item carried, oldest first. Not a per-screen array: the bag
; travels with the player, so it survives a screen change.
MAX_ITEMS   = 8
inv_items   = $0378

; ------------------------------------------------------------- VRAM queue RAM
; One page, so the NMI's drain loop can index the whole queue with X. Packets are
; [addr_hi, addr_lo, count, bytes...] and a zero addr_hi terminates.
vram_buf    = $0400

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
; Punctuation rather than a command: the compiler emits it, nothing authors it,
; and it is numbered out of the way of EVENT_COMMANDS so the two orders cannot
; grow into each other. It ends a then-branch by stepping over the else-branch.
OP_JUMP     = $FE

; ------------------------------------------------------------- constants
OAM         = $0200         ; sprite shadow, DMA'd every frame

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

NO_SCREEN   = $FF           ; neighbour table: nothing that way

PPUCTRL_ON  = $88           ; NMI enabled, sprites read from $1000
PPUMASK_ON  = $1E           ; background + sprites, no left-column clipping

ANIM_RATE   = 8             ; frames between walk-cycle steps
