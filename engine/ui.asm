; ui.asm -- the two frozen-world states: the inventory menu and dialogue.
;
; What they really are is the two states the Controller Forge binds buttons for:
; while either is open the world is frozen and the dispatcher reads that state's
; row of input_actions, which is what makes Item, Cancel and Confirm mean
; something.
;
; The menu is drawn entirely with sprites -- the pickups you are carrying, laid
; out along the top -- because a tileset's 256 background tiles all belong to the
; Tile Forge and the engine takes none of them for a menu. Dialogue is the
; exception, and only when a project asks for it: an actor with something to say
; gets the message box in text.asm, which costs the font's 96 background tiles,
; and an actor without one gets the portrait, which is what this engine had
; before there was a font at all.
;
; The sprite overlay is appended to the shadow after draw_entities has parked the
; unused slots, so it draws on top of the frozen world without the world having
; to know about it.

; ------------------------------------------------------------- inventory

; Add the actor id (or, under ITEMS_ENABLED, the item id) in A to the bag. A
; full bag keeps what it has; the pickup is still counted and still
; disappears, exactly as it did before there was a bag. Under ITEMS_ENABLED,
; NO_ITEM (an unbacked pickup, or an unresolved Give) is refused here rather
; than entered as a phantom bag slot -- guarded centrally, once, rather than
; at every caller: script_op_give already screens its own operand before
; reaching here, but the two field pickup paths (entity_pickup, do_interact)
; do not, and this is the one place both of them funnel through. Preserves X,
; clobbers Y.
add_item:
  .if ITEMS_ENABLED
  cmp #NO_ITEM
  beq add_item_done
  .endif
  ldy inv_count
  cpy #MAX_ITEMS
  bcs add_item_done
  sta inv_items,y
  inc inv_count
add_item_done:
  rts

; A = actor id. Take the first one of those out of the bag, if there is one --
; the Take command. Shares use_item's shape: the bag closes up over the gap, so
; the row on screen never has a hole in it and the highlight never points past
; the end.
remove_item:
  sta script_tmp
  ldx #0
remove_item_find:
  cpx inv_count
  bcs remove_item_done      ; not carrying one
  lda inv_items,x
  cmp script_tmp
  beq remove_item_shift
  inx
  jmp remove_item_find
remove_item_shift:
  inx
  cpx inv_count
  bcs remove_item_shifted
  lda inv_items,x
  sta inv_items-1,x
  jmp remove_item_shift
remove_item_shifted:
  dec inv_count
  lda inv_sel
  cmp inv_count
  bcc remove_item_done
  ldx inv_count
  beq remove_item_first
  dex
remove_item_first:
  stx inv_sel
remove_item_done:
  rts

; The item action, from gameplay.
open_menu:
  lda #0
  sta inv_sel
  lda #ST_MENU
  sta game_state
  rts

; Shared by cancel, by a second press of item, and by the end of a conversation:
; there is only one way back to gameplay. The message box and the script are
; cleared here as well, so this stays the single way out however a conversation
; ended.
close_ui:
  lda #NO_ENTITY
  sta talk_ent
  lda #0
  sta box_state
  sta script_active
  lda #ST_GAMEPLAY
  sta game_state
  rts

; The confirm action, in the menu: spend the highlighted item. The bag closes up
; over the gap, so the row on screen never has a hole in it and the highlight
; never points past the end.
use_item:
  lda inv_count
  beq use_item_done         ; an empty bag has nothing to spend
  ldx inv_sel
  cpx inv_count
  bcs use_item_done
use_item_shift:
  inx
  cpx inv_count
  bcs use_item_shifted
  lda inv_items,x
  sta inv_items-1,x
  jmp use_item_shift
use_item_shifted:
  dec inv_count
  inc items_used
  lda inv_sel               ; spending the last item pulls the highlight back
  cmp inv_count
  bcc use_item_done
  ldx inv_count
  beq use_item_first
  dex
use_item_first:
  stx inv_sel
use_item_done:
  rts

; -------------------------------------------------------------- dialogue

; X = the entity slot being spoken to. What it has to say -- if anything -- is
; its event; an actor without one still gets the portrait, which is all this
; engine had before there was a font.
start_dialog:
  stx talk_ent
  lda #ST_DIALOG
  sta game_state
  jmp script_start

; ------------------------------------------------------------------ tick

; Run instead of the world update while a frozen-world state is open. The d-pad
; is not in the Controller Forge's table -- during play it always walks, and here
; it always moves the highlight -- so the menu reads the pad directly.
ui_tick:
  ; A scripted Move owns the frame ahead of whatever state it is running
  ; inside. It is always ST_DIALOG in practice -- every event runs through
  ; start_dialog -- but the test is on the move rather than on the state,
  ; because the two answer different questions and a box may well be sitting
  ; open above the actor doing the walking. Nothing types while it runs: Say
  ; suspends until it is dismissed, so a box the script got past is finished
  ; being drawn and simply holds.
  .if MOVE_ENABLED
  lda mv_left
  beq ui_tick_state
  jmp move_tick
  .endif
ui_tick_state:
  lda game_state
  cmp #ST_DIALOG
  bne ui_tick_gameover
  jmp text_tick             ; the box types itself out one step per frame
ui_tick_gameover:
  cmp #ST_GAMEOVER
  bne ui_tick_title
  jmp ui_tick_dead
ui_tick_title:
  .if TITLE_ENABLED
  cmp #ST_TITLE
  bne ui_tick_battle
  jmp title_tick
  .endif
ui_tick_battle:
  .if BATTLE_ENABLED
  cmp #ST_BATTLE
  bne ui_tick_menu
  lda #BE_TICK
  jmp call_battle           ; the only way into the banked bank, and back out
  .endif
ui_tick_menu:
  cmp #ST_MENU
  bne ui_tick_done
  lda inv_count
  cmp #2
  bcc ui_tick_done          ; nothing to choose between
  lda pad_new
  and #BTN_LEFT
  beq ui_tick_right
  ldx inv_sel
  bne ui_tick_left
  ldx inv_count             ; the row wraps at both ends
ui_tick_left:
  dex
  stx inv_sel
ui_tick_right:
  lda pad_new
  and #BTN_RIGHT
  beq ui_tick_done
  ldx inv_sel
  inx
  cpx inv_count
  bcc ui_tick_store
  ldx #0
ui_tick_store:
  stx inv_sel
ui_tick_done:
  rts

; The game-over screen. Start is hardwired here rather than bound in the
; Controller Forge for the same reason the D-pad is: there is exactly one thing
; to do, and offering a row of bindings for it would be offering a choice that
; is not one.
ui_tick_dead:
  jsr text_tick
  lda box_state
  cmp #BOX_ENDWAIT
  bne ui_tick_dead_done     ; the message is still typing itself out
  lda pad_new
  and #BTN_START
  beq ui_tick_dead_done
  jmp restart_game
ui_tick_dead_done:
  rts

; --------------------------------------------------------------- drawing

draw_ui:
  lda game_state
  cmp #ST_MENU
  beq draw_menu
  cmp #ST_DIALOG
  beq draw_dialog
  rts

draw_menu:
  lda inv_count
  beq draw_menu_done        ; an empty bag draws nothing at all
  lda #0
  sta ui_slot
draw_menu_loop:
  lda #ITEM_ROW_X
  ldx ui_slot
  beq draw_menu_placed
draw_menu_step:
  clc
  adc #ITEM_ROW_DX
  dex
  bne draw_menu_step
draw_menu_placed:
  sta de_ex

  lda #ITEM_ROW_Y
  sta de_ey
  lda ui_slot               ; the highlighted item bobs: that is the cursor
  cmp inv_sel
  bne draw_menu_item
  lda frame_cnt
  and #$10
  beq draw_menu_item
  lda #ITEM_ROW_Y-ITEM_LIFT
  sta de_ey
draw_menu_item:
  ldx ui_slot
  lda inv_items,x
  .if ITEMS_ENABLED
  jsr draw_item_icon
  .endif
  .if !ITEMS_ENABLED
  jsr draw_actor_icon
  .endif

  inc ui_slot
  lda ui_slot
  cmp inv_count
  bne draw_menu_loop
draw_menu_done:
  rts

draw_dialog:
  lda box_state
  bne draw_dialog_done      ; a message box speaks for itself
  ldx talk_ent
  cpx #MAX_ENTITIES
  bcs draw_dialog_done      ; NO_ENTITY: nobody is speaking
  lda ent_active,x
  beq draw_dialog_done      ; the slot emptied out from under the conversation
  lda #PORTRAIT_X
  sta de_ex
  lda #PORTRAIT_Y
  sta de_ey
  lda frame_cnt
  and #$10
  beq draw_dialog_speaker
  lda #PORTRAIT_Y-PORTRAIT_LIFT
  sta de_ey
draw_dialog_speaker:
  lda ent_actor,x
  jmp draw_actor_icon
draw_dialog_done:
  rts

; A = actor id. Draws that actor's resting metasprite at de_ex/de_ey, which is
; the first frame of the animation it faces the camera with.
draw_actor_icon:
  asl a
  asl a                     ; four animations per actor, DIR_DOWN first
  tay
  lda actor_anim_dir,y
  cmp #NO_ANIM
  beq draw_actor_icon_done
  tay
  lda anim_ptr_lo,y
  sta ptr_lo
  lda anim_ptr_hi,y
  sta ptr_hi
  ldy #0
  lda [ptr_lo],y            ; frame 0's metasprite
  jmp draw_metasprite
draw_actor_icon_done:
  rts

; A = item id. Draws that item's own icon at de_ex/de_ey -- item_metasprite
; (assets/items.inc), computed once at generation time by generate.js's
; resolveItemIcon (an explicit metaspriteId, or a legacy derivation from the
; backing actor's own resting frame for a migrated item that never set one).
; No facing to resolve, unlike draw_actor_icon: an item has one icon, not
; four animations, which is why this is the simpler of the two rather than a
; variant of it.
;
; The whole routine, not just its one caller above, is gated on
; ITEMS_ENABLED: item_metasprite itself is not emitted at all when items are
; disabled (generate.js's itemTables writes nothing, not even a stub), so an
; unconditionally-assembled reference to it here would be an undefined
; symbol the moment a project has no items.
  .if ITEMS_ENABLED
draw_item_icon:
  tay
  lda item_metasprite,y
  cmp #NO_METASPRITE
  beq draw_item_icon_done
  jmp draw_metasprite
draw_item_icon_done:
  rts
  .endif
