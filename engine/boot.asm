; boot.asm -- reset, the main loop, NMI/IRQ, palette loading, rendering control.

reset:
  sei
  cld
  ldx #$40
  stx $4017                 ; disable the APU frame IRQ
  ldx #$FF
  txs
  inx                       ; x = 0
  stx $2000                 ; NMI off
  stx $2001                 ; rendering off
  stx $4010                 ; DMC IRQ off

  bit $2002
boot_wait1:
  bit $2002
  bpl boot_wait1            ; first PPU warm-up vblank

  lda #0                    ; clear RAM $0000-$07FF
  ldx #0
boot_clear:
  sta $0000,x
  sta $0100,x
  sta $0300,x
  sta $0400,x
  sta $0500,x
  sta $0600,x
  sta $0700,x
  inx
  bne boot_clear

  lda #$FF                  ; park every sprite off-screen
  ldx #0
boot_clear_oam:
  sta OAM,x
  inx
  bne boot_clear_oam

boot_wait2:
  bit $2002
  bpl boot_wait2            ; second PPU warm-up vblank

  jsr mapper_init           ; PRG/CHR mode and mirroring, before any banked read
  jsr chr_ram_init          ; on a CHR-RAM board, stream the tilesets in

  jsr load_palette

  jsr init_session          ; hearts, bag and switches, exactly as a restart does

  lda #START_SCREEN         ; place the player where the Map Forge said
  sta flat_screen
  lda #START_X
  sta player_x
  lda #START_Y
  sta player_y
  lda #DIR_DOWN
  sta player_dir
  lda #PLAYER_SPEED
  sta cur_speed
  lda #NO_ENTITY            ; nobody is talking; the rest of the UI state is
  sta talk_ent              ; zero, which boot_clear has already arranged

  .if TITLE_ENABLED
  lda #TITLE_FLAT_SCREEN    ; the cartridge boots into its title, not its world
  sta flat_screen
  lda #ST_TITLE
  sta game_state
  .endif

  ; flat_screen is final now -- the title's, if there is one -- so this is the
  ; one point boot decides the music instead of hardcoding the start map's:
  ; apply_map_music reads whichever screen is actually about to be drawn.
  jsr apply_map_music

  ldy flat_screen           ; select the starting map's tileset before drawing
  lda screen_tileset,y
  jsr switch_chr_bank

  jsr set_screen_ptr
  jsr spawn_entities
  jsr draw_screen
  jsr title_draw            ; over the top, while rendering is still off
  jsr build_oam
  jsr draw_entities
  jsr enable_rendering

  .if SPLIT_ENABLED
  cli                       ; the MMC3 scanline counter is the only IRQ source:
                            ; the APU frame and DMC IRQs were disabled above
  .endif

main_loop:
  jsr wait_vblank
  jsr read_pad
  jsr music_tick            ; music keeps playing while the world is paused
  ; What the last frame left owed, settled before the buttons are read into
  ; actions. It has to be before them and not merely before the world: an
  ; interact reaches start_dialog and an event is free to warp, so a button on
  ; this frame could otherwise overwrite the destination of a warp already owed,
  ; or warp away from a screen whose opening is armed and never gets spoken --
  ; the redraw clears what is pending.
  jsr settle_owed
  bne main_loop_draw        ; it took the frame; the frame was the transition's
  lda #0
  sta screen_fresh          ; nothing has been drawn this frame yet
  jsr dispatch_input        ; button actions from the Controller Forge
  lda paused
  bne main_loop_draw        ; a pause action freezes the world, not the screen
  lda game_state
  bne main_loop_ui          ; so do the menu and dialogue states
  ; The buttons can have made work of their own. A warp, from an interact whose
  ; event carried one -- and the world must not update on the screen being left,
  ; where a door could overwrite the destination on its way past.
  lda warp_ready
  bne main_loop_owed_warp
  ; ...or a whole screen: Start, on the title, draws one from inside
  ; dispatch_input. The frame belongs to the screen that arrived, and the event
  ; it owes is settled at the top of the next one.
  lda screen_fresh
  bne main_loop_draw
  jsr update_player
  ; Crossing a screen edge redraws from inside update_player, and the rest of
  ; this frame does not belong to the screen that just arrived: its actors have
  ; spawned but its own event has not had its turn yet.
  lda screen_fresh
  bne main_loop_draw
  jsr update_entities
; A name for the moment a door is decided, emitting nothing: it is where the
; frame's movement is finished and warp_ready is about to be read, which is the
; only point outside the engine anything can hand it a destination. The Map
; Forge's "play from here" stops here to do exactly that, and a label costs the
; cartridge nothing while an assumption about which instruction follows
; update_entities would cost it correctness.
main_loop_warp:
  lda warp_ready            ; a door fires outside the entity loop, so the
  beq main_loop_draw        ; respawn cannot clear the array mid-walk
main_loop_owed_warp:
  jsr take_door
  jmp main_loop_draw
; Settle whatever a previous frame left owed: a warp an event asked for, or an
; event a trigger armed. Returns A != 0 when it took the frame, in which case the
; caller must not run the world -- the frame belonged to the transition.
;
; The gate is here rather than at the call site because this is the only thing
; that needs it before dispatch_input: buttons are read in every state, but a
; warp and a pending event are gameplay's alone.
settle_owed:
  lda paused
  bne settle_owed_none      ; a pause freezes the world, and this is the world
  lda game_state
  bne settle_owed_none      ; so do the menu, dialogue and battle states
  ; A warp first: an event that warps finishes while the box is still up, so the
  ; frame that reads warp_ready after update_entities never runs. Without this
  ; the world gets one more update on a screen the player has already left.
  lda warp_ready
  bne settle_owed_warp
  ; Then the event: a screen that has just arrived, or an actor the player
  ; walked into on the frame before.
  lda pending_ent
  cmp #NO_ENTITY
  beq settle_owed_none
  tax
  lda #NO_ENTITY
  sta pending_ent           ; disarmed before it runs, not after: the event is
                            ; free to warp, and the redraw that follows arms
                            ; whatever the next screen owes
  ; The slot must still hold an actor. Nothing between the arming and here can
  ; empty one now that the buttons are read afterwards -- an entity only ever
  ; deactivates itself, and the frame that arms an entry event never reaches the
  ; entity loop. This is a guard rather than a fix: the index is remembered
  ; across a frame boundary, and a stale one would speak for something that is
  ; not there without saying so. If it is gone the frame is an ordinary one.
  lda ent_active,x
  beq settle_owed_none
  jsr start_dialog          ; X = the slot whose event the frame owes
  lda #1
  rts
settle_owed_warp:
  jsr take_door
  lda #1
  rts
settle_owed_none:
  lda #0
  rts
main_loop_ui:
  jsr ui_tick               ; the world is frozen: run the overlay instead
main_loop_draw:
  .if BATTLE_ENABLED
  lda game_state
  cmp #ST_BATTLE
  beq main_loop_ready       ; a battle owns the whole sprite shadow and has
  .endif                    ; already rebuilt it in ui_tick
  jsr build_oam
  jsr draw_entities
  .if !BATTLE_ENABLED
  jsr draw_hud              ; over the parked slots draw_entities just left
  .endif
  jsr draw_ui               ; on top of the frozen world, when one is open
main_loop_ready:
  .if SPLIT_ENABLED
  jsr split_select          ; every path through the frame decides its split
  .endif
  ; The handshake with NMI, and deliberately the last store of the frame: until
  ; it lands the queue may be half-written, and NMI leaves a half-written queue
  ; alone rather than drawing part of it.
  lda vram_len
  beq main_loop_idle        ; inverted into a jump: the frame between here and
  lda #1                    ; the top is past a branch's 128-byte reach
  sta vram_ready
main_loop_idle:
  jmp main_loop

take_door:
  lda #0
  sta warp_ready
  lda warp_scr
  cmp #NUM_SCREENS
  bcs take_door_done        ; a target that no longer exists is ignored
  sta flat_screen
  lda warp_x
  sta player_x
  lda warp_y
  sta player_y
  jmp redraw_screen
take_door_done:
  rts

; ---------------------------------------------------------------- helpers

wait_vblank:
  lda #0
  sta vblank
wait_vblank_loop:
  lda vblank
  beq wait_vblank_loop
  rts

; Used while the NMI is disabled (during a screen redraw).
wait_vblank_poll:
  bit $2002
wait_vblank_poll_loop:
  bit $2002
  bpl wait_vblank_poll_loop
  rts

enable_rendering:
  lda #$00                  ; reset the scroll latch after the $2006 writes
  sta $2005
  sta $2005
  lda #PPUCTRL_ON
  sta $2000
  lda #PPUMASK_ON
  sta $2001
  rts

load_palette:
  bit $2002
  lda #$3F
  sta $2006
  lda #$00
  sta $2006
  ldx #0
load_palette_loop:
  lda palette_data,x
  sta $2007
  inx
  cpx #32
  bne load_palette_loop
  rts

; ------------------------------------------------------------- interrupts

nmi:
  pha
  txa
  pha
  tya
  pha

  lda #$00
  sta $2003
  lda #$02
  sta $4014                 ; OAM DMA from $0200

  lda vram_ready            ; a frame that ran long has not finished appending;
  beq nmi_scroll            ; skipping leaves the writes for the next vblank
  jsr vram_drain

nmi_scroll:
  ; $2000 is rewritten *after* the drain, not before: a $2006 write copies its
  ; high byte into the PPU's `t` register, nametable-select bits and all, so the
  ; scroll reset below is not enough on its own to undo a queued write.
  lda #PPUCTRL_ON
  sta $2000
  lda #$00                  ; this engine draws one screen at a time
  sta $2005
  sta $2005

  .if SPLIT_ENABLED
  jsr split_arm             ; art back in for the top, first IRQ armed
  .endif

  inc frame_cnt
  lda #1
  sta vblank

  pla
  tay
  pla
  tax
  pla
  rti

  .if !SPLIT_ENABLED
irq:                        ; a split build's handler lives in split.asm
  rti
  .endif
