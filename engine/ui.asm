; ui.asm -- the two frozen-world states: the inventory menu and dialogue.
;
; What they really are is the two states the Controller Forge binds buttons for:
; while either is open the world is frozen and the dispatcher reads that state's
; row of input_actions, which is what makes Item, Cancel and Confirm mean
; something.
;
; The menu is drawn entirely with sprites -- the items you are carrying, laid
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

; A = item id under ITEMS_ENABLED, the legacy backing-actor id otherwise. Take
; the first one of those out of the bag, if there is one -- the Take command.
; Shares use_item's shape: the bag closes up over the gap, so the row on
; screen never has a hole in it and the highlight never points past the end.
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

; use_item_apply's own return code -- purely internal to this file, not part
; of any wire format, so these three values answer to nothing but the cmp
; that reads them a few lines down.
USE_ITEM_NONE  = 0
USE_ITEM_ALIVE = 1
USE_ITEM_DIED  = 2

; The confirm action, in the menu: spend the highlighted item. The bag closes up
; over the gap, so the row on screen never has a hole in it and the highlight
; never points past the end. Under ITEMS_ENABLED, an item's effect is applied
; first -- a key item (kind none) is not spent at all, since use_item_apply
; found nothing to do; heal and damage are both spent regardless of which
; health model applied them.
;
; The lethal jmp to player_died is use_item's own, not use_item_apply's --
; see use_item_apply's own header for why, and CLAUDE.md's script_op_damage
; entry for the identical rule this mirrors. use_item is itself reached by a
; jmp (do_action_confirm, engine/input.asm), never a jsr, which is what
; makes that jmp safe here: there is no return address of use_item's own on
; the stack to strand.
use_item:
  lda inv_count
  beq use_item_done         ; an empty bag has nothing to spend
  ldx inv_sel
  cpx inv_count
  bcs use_item_done
  .if ITEMS_ENABLED
  lda inv_items,x
  jsr use_item_apply          ; clobbers X (party_heal/party_damage do)
  cmp #USE_ITEM_NONE
  beq use_item_done            ; a key item: nothing applied, nothing spent
  pha                          ; remember alive-vs-died across the shift below, which clobbers A
  ldx inv_sel                  ; reload explicitly -- X is not trustworthy after use_item_apply
  .endif
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
  bcc use_item_highlight_done
  ldx inv_count
  beq use_item_first
  dex
use_item_first:
  stx inv_sel
use_item_highlight_done:
  .if ITEMS_ENABLED
  pla
  cmp #USE_ITEM_DIED
  bne use_item_done
  jmp player_died
  .endif
use_item_done:
  rts

; A = item id. Applies its effect, if it has one. Returns a result in A --
; USE_ITEM_NONE, USE_ITEM_ALIVE or USE_ITEM_DIED (below) -- for use_item to
; act on. Never jumps to player_died itself: the jsr that reached this
; routine left a return address on the stack that only use_item, in tail
; position from do_action_confirm, may abandon -- the same reason
; script_op_damage's own jmp to player_died is that routine's own, not
; party_damage's or lose_hearts', and precisely finding 4 from the phase 4
; design's own review: its first draft had this routine jump to
; player_died directly, stranding use_item's jsr use_item_apply return
; address for some unrelated rts to mis-pop later. A two-state carry
; protocol cannot say "applied, and lethal" as a third thing distinct from
; "applied" and "not applied" without a second flag riding along beside it,
; which is exactly the shape this return-code avoids: one value in A, three
; cases, one cmp/beq each at the call site. Clobbers X (party_heal/
; party_damage do); the caller reloads inv_sel itself rather than trusting
; this routine's X on return.
;
; The whole routine, not just its one call site, is gated on ITEMS_ENABLED
; -- item_effect_kind/item_effect_amount (assets/items.inc) are not even
; emitted (not a stub, nothing) when items are disabled, the identical
; "guard the definition, not just the callers" fix draw_item_icon already
; needed for the same reason (round 3 finding, main/build/generate.js's
; itemTables).
  .if ITEMS_ENABLED
use_item_apply:
  tay
  lda item_effect_kind,y
  cmp #EFFECT_HEAL
  bne use_item_apply_damage
  lda item_effect_amount,y
  .if BATTLE_ENABLED
  jsr party_heal
  .endif
  .if !BATTLE_ENABLED
  jsr gain_hearts
  .endif
  lda #USE_ITEM_ALIVE
  rts
use_item_apply_damage:
  cmp #EFFECT_DAMAGE
  bne use_item_apply_none
  lda item_effect_amount,y
  .if BATTLE_ENABLED
  jsr party_damage
  bne use_item_apply_alive   ; someone recruited is still standing
  .endif
  .if !BATTLE_ENABLED
  jsr lose_hearts
  lda player_hp
  bne use_item_apply_alive
  .endif
  lda #USE_ITEM_DIED
  rts
use_item_apply_alive:
  lda #USE_ITEM_ALIVE
  rts
use_item_apply_none:
  lda #USE_ITEM_NONE
  rts
  .endif

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
  ; A scripted Move or Wait owns the frame ahead of whatever state it is
  ; running inside. It is always ST_DIALOG in practice -- every event runs
  ; through start_dialog -- but the test is on the counter rather than on the
  ; state, because the two answer different questions and a box may well be
  ; sitting open above the actor doing the walking (or the wait). Nothing
  ; types while either runs: Say suspends until it is dismissed, so a box the
  ; script got past is finished being drawn and simply holds.
  ;
  ; Two separate hard-coded checks, not one dispatcher over a table of
  ; suspend flags and resume routines: mv_left and wt_left can never both be
  ; non-zero (a page suspends on whichever of Move or Wait it reaches first,
  ; and cannot reach the other until that one resumes -- script_op_move and
  ; script_op_wait each advance script_ptr past their own command before
  ; suspending, so there is exactly one command "current" at a time), so a
  ; generalised dispatcher would trade two flat `lda`/`beq`/`jmp` triplets --
  ; cheaper in bytes than a table lookup already is at this size -- for
  ; indirection that has nothing to dispatch over yet. The same reasoning
  ; script.asm's own header already gives for a compare chain over a jump
  ; table: a table is a second place an order has to be kept in step with
  ; something else, for two entries that do not need one.
  .if MOVE_ENABLED
  lda mv_left
  beq ui_tick_wait
  jmp move_tick
  .endif
ui_tick_wait:
  .if WAIT_ENABLED
  lda wt_left
  beq ui_tick_state
  jmp wait_tick
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
