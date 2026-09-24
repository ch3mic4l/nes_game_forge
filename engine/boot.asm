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
  .if FADE_ENABLED
  lda #0
  sta <fade_reload            ; consumed by nobody here -- reset draws the
                              ; first screen itself (below) and already ran
                              ; load_palette moments earlier, so a flag left
                              ; armed from cold boot would otherwise survive
                              ; into the first real redraw_screen call of the
                              ; session and wrongly reload the palette there
  .endif

  lda #START_SCREEN         ; place the player where the Map Forge said
  sta <flat_screen
  lda #START_X
  sta <player_x
  lda #START_Y
  sta <player_y
  lda #DIR_DOWN
  sta <player_dir
  lda #PLAYER_SPEED
  sta <cur_speed
  lda #NO_ENTITY            ; nobody is talking; the rest of the UI state is
  sta <talk_ent              ; zero, which boot_clear has already arranged

  .if TITLE_ENABLED
  lda #TITLE_FLAT_SCREEN    ; the cartridge boots into its title, not its world
  sta <flat_screen
  lda #ST_TITLE
  sta <game_state
  .endif
  ; A titleless cold boot never reaches start_game at all, so hero naming
  ; needs its own arrival here too (docs/design-name-entry.md §8).
  .if !TITLE_ENABLED
  .if HERO_NAMING_ENABLED
  lda #ST_NAMEENTRY
  sta <game_state
  lda #0
  jsr name_begin             ; shim (engine/ui.asm) -- A = party slot 0
  lda #BOX_NAMEENTRY
  jsr box_begin
  .endif
  .endif

  ; flat_screen is final now -- the title's, if there is one -- so this is the
  ; one point boot decides the music instead of hardcoding the start map's:
  ; apply_map_music reads whichever screen is actually about to be drawn.
  ;
  ; Phase 2 slice 2b: cold boot draws its first screen inline rather than
  ; calling redraw_screen (engine/screens.asm), so it carries its own copy of
  ; that routine's own GLOBAL/resolved dispatch -- sw_resolve_screen either
  ; leaves ord_screen naming an ordinary row (unchanged body below) or lands
  ; the field screen itself and returns, the same split, same landing-frame
  ; scroll write (cam_nt/cam_x_lo/cam_y_lo -- phase 2 slice "landing": the
  ; real clamped, player-centred window's own scroll, in general NOT
  ; zero-local on either axis; design derivation in docs/reference-engine.md).
  ;
  ; boot_streamed_landing brackets exactly this dispatch (to boot_draw_ordinary,
  ; below) -- Part F's STREAMWORLD_RESOLVER_KERNEL_ALLOWANCE measures this span
  ; directly off nesasm's own symbol table (kernelbytes.test.js), not by hand.
boot_streamed_landing:
  .if STREAMING_ENABLED
  lda <flat_screen
  jsr sw_resolve_screen
  lda <map_is_streamed
  beq boot_draw_ordinary
  jsr sw_render_window
  ; F3 (phase 2 slice 2b fix round 1): see engine/screens.asm's identical
  ; comment on redraw_screen's own streamed branch -- cold boot carries its
  ; own copy of the same dispatch, so it needs the same empty-cache call.
  .if BOUND_TILE_ENABLED
  jsr rebuild_bound_cache
  .endif
  jsr spawn_entities
  jsr build_oam
  jsr draw_entities
  jsr wait_vblank_poll
  lda <cam_nt
  ora #PPUCTRL_ON
  sta $2000
  lda <cam_x_lo
  sta $2005
  lda <cam_y_lo
  sta $2005
  lda #PPUMASK_ON
  sta $2001
  jmp boot_draw_done
boot_draw_ordinary:
  .endif
  jsr apply_map_music

  .if STREAMING_ENABLED
  ldy <ord_screen
  .else
  ldy <flat_screen           ; select the starting map's tileset before drawing
  .endif
  lda screen_tileset,y
  jsr switch_chr_bank

  jsr set_screen_ptr
  jsr spawn_entities
  jsr draw_screen
  jsr title_draw            ; over the top, while rendering is still off
  jsr build_oam
  jsr draw_entities
  jsr enable_rendering
boot_draw_done:

  .if SPLIT_ENABLED
  cli                       ; the MMC3 scanline counter is the only IRQ source:
                            ; the APU frame and DMC IRQs were disabled above
  .endif

main_loop:
  jsr wait_vblank
; Fix round 2 (finding D/ruling M): the sw_driver_timing Mesen harness (test/lua/
; sw_driver_timing.lua.template) anchors its own full-mainline-body span here -- the instant
; wait_vblank's own blocking poll loop has returned, so the span excludes that poll's dead time
; (real elapsed cycles, but not real work: it is however much of the frame was left over once the
; PREVIOUS iteration's own body finished) and measures only actual game-logic/draw-prep cost,
; ending at main_loop_ready (below) where the frame hands off to NMI. A label costs the cartridge
; nothing, the same precedent main_loop_after_player already set.
main_loop_body_start:
  jsr read_pad
  jsr music_tick            ; music keeps playing while the world is paused
  .if STING_ENABLED
  jsr sting_tick             ; must come after music_tick -- music_tick is
                              ; what actually plays this frame's sting audio,
                              ; and sting_tick's own countdown decides, on the
                              ; same frame, whether that was the sting's last
                              ; one. The reverse order would run sting_restore
                              ; before this frame's music_tick, so the resumed
                              ; song would play one frame early and the
                              ; sting's own final frame of audio would be
                              ; silently dropped -- see design-sting.md §3/§7.
                              ; Placed immediately after music_tick as a
                              ; source-adjacency convention, not because
                              ; anything downstream (flash_tick included)
                              ; depends on the exact distance between them.
  .endif
  .if BOUND_TILE_ENABLED
  jsr flip_tick               ; design-tile.md §7 -- a fresh per-frame visual-
                              ; flip budget must be available before
                              ; dispatch_input, so any script code that frame
                              ; (a Turn switch command) sees flip_budget
                              ; already reset. Placed after sting_tick for the
                              ; same source-adjacency reason, unrelated to
                              ; flash_tick's own real ordering requirement
                              ; below.
  .endif
  .if FLASH_ENABLED
  jsr flash_tick             ; a Flash burst keeps counting down whether the
                              ; world is frozen or running -- see its own
                              ; header (engine/entities.asm) for why this
                              ; call must come before settle_owed/
                              ; dispatch_input/ui_tick: that ordering is what
                              ; makes a coincident Fade step win a shared NMI,
                              ; a documented, tested contract (test/unit/
                              ; flash.test.js), not an incidental placement
  .endif
  ; design-camera.md §3 "Frozen-world gate": a live slide owns the whole
  ; frame, the same way paused/game_state already do below -- no buttons, no
  ; settle_owed. Work CAN be owed mid-slide: redraw_screen_slide's own
  ; spawn_entities already armed whatever the incoming screen owes
  ; (pending_ent/screen_fresh) the instant the slide was armed -- but its
  ; SETTLEMENT is deferred until this check falls through, once the slide's
  ; last tick lands the camera on (0,0), so the very next frame reaches
  ; settle_owed and picks it up. music_tick/flip_tick/flash_tick above keep
  ; running during a slide; settle_owed/dispatch_input/the world below do not.
  .if CAMERA_SLIDE_ENABLED
  lda <cam_slide_left
  beq main_loop_no_slide
  jsr camera_slide_tick
  jmp main_loop_draw
main_loop_no_slide:
  .endif
  ; What the last frame left owed, settled before the buttons are read into
  ; actions. It has to be before them and not merely before the world: an
  ; interact reaches start_dialog and an event is free to warp, so a button on
  ; this frame could otherwise overwrite the destination of a warp already owed,
  ; or warp away from a screen whose opening is armed and never gets spoken --
  ; the redraw clears what is pending.
  jsr settle_owed
  bne main_loop_draw        ; it took the frame; the frame was the transition's
  lda #0
  sta <screen_fresh          ; nothing has been drawn this frame yet
  jsr dispatch_input        ; button actions from the Controller Forge
  lda <paused
  bne main_loop_draw        ; a pause action freezes the world, not the screen
  lda <game_state
  bne main_loop_ui          ; so do the menu and dialogue states
  ; The buttons can have made work of their own. A warp, from an interact whose
  ; event carried one -- and the world must not update on the screen being left,
  ; where a door could overwrite the destination on its way past.
  lda <warp_ready
  bne main_loop_owed_warp
  ; ...or a whole screen: Start, on the title, draws one from inside
  ; dispatch_input. The frame belongs to the screen that arrived, and the event
  ; it owes is settled at the top of the next one.
  lda <screen_fresh
  bne main_loop_draw
  jsr update_player
  ; Crossing a screen edge redraws from inside update_player, and the rest of
  ; this frame does not belong to the screen that just arrived: its actors have
  ; spawned but its own event has not had its turn yet.
main_loop_after_player:
  ; Reached on every frame immediately after update_player returns, whichever
  ; way the screen_fresh check below goes. Fix round 1 (finding 5/ruling E):
  ; the sw_driver_timing Mesen harness (test/lua/sw_driver_timing.lua.
  ; template) anchors its own per-frame span here rather than on
  ; update_entities' own entry point, because a continuous streamed ownership
  ; crossing sets screen_fresh from inside update_player itself (finding 1),
  ; and update_entities is skipped -- by design, see the comment above -- on
  ; exactly that frame. A label costs the cartridge nothing.
  lda <screen_fresh
  bne main_loop_draw
  jsr update_entities
; A name for the moment a door is decided, emitting nothing: it is where the
; frame's movement is finished and warp_ready is about to be read, which is the
; only point outside the engine anything can hand it a destination. The Map
; Forge's "play from here" stops here to do exactly that, and a label costs the
; cartridge nothing while an assumption about which instruction follows
; update_entities would cost it correctness.
main_loop_warp:
  lda <warp_ready            ; a door fires outside the entity loop, so the
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
  lda <paused
  bne settle_owed_none      ; a pause freezes the world, and this is the world
  lda <game_state
  bne settle_owed_none      ; so do the menu, dialogue and battle states
  ; A warp first: an event that warps finishes while the box is still up, so the
  ; frame that reads warp_ready after update_entities never runs. Without this
  ; the world gets one more update on a screen the player has already left.
  lda <warp_ready
  bne settle_owed_warp
  ; Then the event: a screen that has just arrived, or an actor the player
  ; walked into on the frame before.
  lda <pending_ent
  cmp #NO_ENTITY
  beq settle_owed_none
  tax
  lda #NO_ENTITY
  sta <pending_ent           ; disarmed before it runs, not after: the event is
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
  lda <game_state
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
  lda <vram_len
  beq main_loop_idle        ; inverted into a jump: the frame between here and
  lda #1                    ; the top is past a branch's 128-byte reach
  sta <vram_ready
main_loop_idle:
  ; Phase 2 slice 4b: sw_event_freeze is a one-frame latch (engine/input.asm's
  ; do_talk sets it), cleared unconditionally every frame regardless of state
  ; -- the streamed driver only ever reads it on a frame update_player itself
  ; runs, so clearing here rather than conditionally is simplest and cannot
  ; leave it stuck set across a frame that never checked it.
main_loop_idle_freeze_dispatch:
  .if STREAMING_ENABLED
  lda #0
  sta <sw_event_freeze
  .endif
main_loop_idle_freeze_done:
  jmp main_loop

take_door:
  lda #0
  sta <warp_ready
  lda <warp_scr
  cmp #NUM_SCREENS
  bcs take_door_done        ; a target that no longer exists is ignored
  sta <flat_screen
  lda <warp_x
  sta <player_x
  lda <warp_y
  sta <player_y
  jmp redraw_screen
take_door_done:
  rts

; ---------------------------------------------------------------- helpers

wait_vblank:
  lda #0
  sta <vblank
wait_vblank_loop:
  lda <vblank
  beq wait_vblank_loop
  rts

; Safe with NMI enabled or disabled, unlike wait_vblank above it: this polls
; PPUSTATUS ($2002) bit 7 directly rather than the vblank RAM byte NMI sets,
; and nothing in this engine's own NMI handler (nmi, below) ever reads
; $2002 -- so nothing consumes the flag this loop is waiting on out from
; under it. wait_vblank, by contrast, genuinely does need NMI enabled: it
; waits on vblank, and only NMI ever sets that byte, so a caller with NMI
; disabled would spin forever. Used during a screen redraw (NMI disabled,
; where wait_vblank could not be used at all) and, since save_media_commit
; (engine/save.asm) needs to wait for vblank *before* it disables NMI and
; forces blank, here too -- proved safe either way, not merely assumed.
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

  ; Fade's own packets were the first producer into vram_buf whose own
  ; address ends inside palette space ($3F00-$3F1F): after vram_drain
  ; finishes a 32-byte packet from $3F00, the PPU's internal VRAM address
  ; register (v) is left at $3F20 -- still a palette mirror. Real hardware
  ; (and emulators modelling it faithfully) documents a real risk of visible
  ; corruption when v is left pointing into $3F00-$3FFF at the moment
  ; rendering resumes. Every other producer in this engine is safe from this
  ; by accident of what it draws -- text.asm's packets all end inside
  ; nametable space ($2000-$23FF), so nobody had to think about this before
  ; Fade. The fix is two more $2006 writes with NO following $2007 -- moving v
  ; without touching any actual VRAM byte. This runs after *any* drain, not
  ; only a palette one: tracking "was the packet just drained a palette one"
  ; would cost more bytes than the few cycles this costs to run
  ; unconditionally, and gating the whole block on PALETTE_FX_ENABLED already
  ; means a project using neither Fade nor Flash pays nothing for it at all.
  ;
  ; Gated on PALETTE_FX_ENABLED (usesFade || usesFlash), not FADE_ENABLED
  ; alone -- Flash's own packets (flash_apply_on/fade_apply_palette,
  ; engine/entities.asm) end in palette space too, and this is the identical
  ; hazard for them. One physical copy of this block, labels unchanged, so a
  ; Fade-only build still assembles byte-identically to before: PALETTE_FX_
  ; ENABLED is true under exactly the same condition FADE_ENABLED alone used
  ; to be for that configuration.
  ;
  ; docs/design-streamed-worlds.md §5 (phase 2 slice 4a): a streamed
  ; project's own arbitration splice, reachable but never armed in
  ; production yet (nothing arms a strip until slice 4b's movement driver
  ; exists) -- st_active alone gates sw_nmi_stream/sw_nmi_stream_reduced
  ; (each rts's immediately when it is clear), never game_state/paused, so
  ; this call site adds no flag check of its own. Exactly one vram_drain
  ; call executes on any ready frame, in every one of the three exits below;
  ; the strip's own $2006/$2007 writes all land before nmi_scroll's
  ; $2000/$2005 rewrite (CLAUDE.md's NMI ordering rule), and neither
  ; sw_nmi_stream nor sw_nmi_stream_reduced ever selects a PRG/CHR bank
  ; (interrupt-time code must never switch banks, the same MMC3-split
  ; discipline). A non-streamed project assembles this whole splice out --
  ; byte-identical to before -- via the .else arm below.
  ;
  ; nmi_vram_dispatch/nmi_scroll bracket the WHOLE .if/.else pair (both
  ; labels exist unconditionally, unlike every label inside either arm), so
  ; test/unit/kernelbytes.test.js can measure this replacement's real net
  ; cost directly: this span's byte count on a streaming build minus this
  ; SAME span's byte count on an ordinary build is
  ; STREAMWORLD_NMI_KERNEL_ALLOWANCE (main/build/generate.js) -- unlike every
  ; other streaming kernel-lo term, which only ADDS a branch in front of
  ; code that stays, this splice REPLACES the ordinary six-line drain with a
  ; bigger three-way one, so the plain single-build span the other terms use
  ; would overcount by the ordinary arm's own bytes.
nmi_vram_dispatch:
  .if STREAMING_ENABLED
  lda <vram_ready
  beq nmi_no_drain
  lda <vram_len
  cmp #MIXED_VBLANK_MAX_BYTES+1
  bcs nmi_drain_big
  jsr vram_drain
  .if PALETTE_FX_ENABLED
nmi_fade_ppuaddr:
  lda #$00
  sta $2006
  sta $2006
nmi_fade_ppuaddr_done:
  .endif
  jsr sw_nmi_stream_reduced    ; a small (<= MIXED_VBLANK_MAX_BYTES) queue
                                ; still drained above, but a reduced strip
                                ; chunk ALSO advances the same vblank
  jmp nmi_scroll

nmi_drain_big:                 ; too big for a mixed vblank (only ever built
  jsr vram_drain                ; while the world is frozen) -- exclusive
  .if PALETTE_FX_ENABLED         ; drain, the strip yields the whole window
  lda #$00
  sta $2006
  sta $2006
  .endif
  jmp nmi_scroll

nmi_no_drain:
  jsr sw_nmi_stream             ; nothing else touched vram_buf this vblank
                                ; -- the strip may advance a full chunk
  jmp nmi_scroll
  .else
  lda <vram_ready            ; a frame that ran long has not finished appending;
  beq nmi_scroll            ; skipping leaves the writes for the next vblank
  jsr vram_drain
  .if PALETTE_FX_ENABLED
nmi_fade_ppuaddr:
  lda #$00
  sta $2006
  sta $2006
nmi_fade_ppuaddr_done:
  .endif
  .endif

nmi_scroll:
  ; $2000 is rewritten *after* the drain, not before: a $2006 write copies its
  ; high byte into the PPU's `t` register, nametable-select bits and all, so the
  ; scroll reset below is not enough on its own to undo a queued write.
  ;
  ; Screen shake (item 6). PPUSCROLL's X is a 9-bit unsigned coordinate --
  ; $2005 supplies the low 8 bits, PPUCTRL bit 0 supplies bit 8 -- not a plain
  ; byte a caller can wrap on its own the way OAM's 8-bit X can under ADC.
  ; PPUCTRL_ON ($88) has bit 0 clear, so a -2 pixel offset is the 9-bit value
  ; 510, composed as PPUCTRL bit 0 SET together with $2005=$FE.
  ;
  ; The sign alternates on shake_left's own low bit, not frame_cnt's. frame_cnt
  ; is a wall clock unrelated to when any particular Shake started, so deriving
  ; sign from it would make two identical Shakes look different (or, for a
  ; short one, land entirely on one phase) purely from accumulated timing that
  ; has nothing to do with the authored effect. shake_left's own bit is
  ; effect-local -- it decrements every active frame of *this* shake, so which
  ; phase a given frame shows depends only on how many frames of this shake
  ; are left, the same way a duration-1 shake always lands on the same phase
  ; regardless of when it was triggered.
  ;
  ; Every active frame shows +2 or -2 -- there is no zero phase -- so a
  ; 2-pixel sliver of whatever nametable is horizontally adjacent (never
  ; drawn by this engine; see CLAUDE.md's own note on nametable 0) is visible
  ; at the left or right screen edge for the whole shake, alternating sides.
  ; Accepted and documented, the same way CLAUDE.md already accepts the MMC3
  ; split's own one-line real-hardware sliver and the overscan columns: a
  ; real, small, known cost, not a defect to chase out.
  ;
  ; Background only: PPU scrolling moves the nametable, not OAM. The player,
  ; entities and any sprite-based UI hold still while the world shakes around
  ; them -- a known, accepted v1 limitation (costed and rejected: syncing
  ; sprites needs the OAM DMA above reordered behind the shake decision, plus
  ; a per-frame cost of roughly 1,500-1,600 cycles against a ~2,273-cycle
  ; vblank budget that already spends 513 on that same DMA).
  .if !CAMERA_ENABLED
  .if SHAKE_ENABLED
  lda <shake_left
  beq nmi_scroll_no_shake
  dec <shake_left
  lda <shake_left
  and #1
  bne nmi_scroll_shake_neg
  lda #PPUCTRL_ON
  sta $2000
  lda #2
  jmp nmi_scroll_shake_x
nmi_scroll_shake_neg:
  lda #PPUCTRL_ON|1
  sta $2000
  lda #$FE
nmi_scroll_shake_x:
  sta $2005
  lda #$00
  sta $2005
  jmp nmi_scroll_done
nmi_scroll_no_shake:
  .endif
  lda #PPUCTRL_ON
  sta $2000
  lda #$00                  ; this engine draws one screen at a time
  sta $2005
  sta $2005
  .endif

  ; docs/design-camera.md §2: cam_x_lo/cam_y_lo/cam_nt replace the constant
  ; (0,0) above once a project turns the camera on. Shake still perturbs the
  ; horizontal 9-bit coordinate by +-2, only now that coordinate is
  ; cam_nt/cam_x_lo instead of always (0,0) -- the ADC carry and SBC borrow
  ; each fire at a different threshold of cam_x_lo (255 vs 0..1), so the +2
  ; and -2 phases cannot share one carry test the way a fixed-at-zero shake
  ; could get away with skipping entirely. Reduces to today's exact
  ; PPUCTRL/$2005 sequence when cam_x_lo=cam_nt=0 (camera at rest) -- see
  ; camera.test.js's own shake-over-rest-camera assertion.
  .if CAMERA_ENABLED
  ; docs/design-camera.md §2: cam_dirty is a publication lock, raised before
  ; the first store of a wrap update (the low-byte coordinate) and released
  ; after the last (the cam_nt toggle) by whichever consumer writes cam_*,
  ; covering both stores of the pair, not just the second one -- a lock that
  ; only guards the last store is not a lock. nmi_scroll's own camera path
  ; never *skips* the scroll write when dirty is set: the drain above
  ; (vram_drain) and PALETTE_FX_ENABLED's own PPUADDR cleanup both already
  ; move the PPU's v/t register before nmi_scroll ever runs, so "skip the
  ; write and the PPU keeps the last value" is false here -- not rewriting
  ; $2000/$2005 below would leave the picture scrolled to wherever the drain
  ; last pointed it, not to any camera position at all. Instead nmi_scroll
  ; maintains its own last-complete snapshot (nmi_cam_x_lo/y_lo/nt, below):
  ; refreshed from cam_x_lo/y_lo/cam_nt only while cam_dirty is clear, left
  ; alone (the last known-good coordinate) while it is set, and always what
  ; gets composed with Shake and written to $2000/$2005 -- so every vblank
  ; writes a real, complete coordinate, torn or not, refreshed or stale (the
  ; coherent-stale-frame policy, docs/design-camera.md §2).
  lda <cam_dirty
  bne nmi_scroll_cam_stale
  lda <cam_x_lo
  sta <nmi_cam_x_lo
  lda <cam_y_lo
  sta <nmi_cam_y_lo
  lda <cam_nt
  sta <nmi_cam_nt
nmi_scroll_cam_stale:
  .if SHAKE_ENABLED
  ; docs/design-camera.md §2: nmi_tmp, not mainline <tmp -- nmi only saves/
  ; restores A/X/Y (this handler's own pha/txa/pha/tya/pha above), so reusing
  ; mainline's <tmp here would corrupt whatever mainline routine (e.g.
  ; probe_type, engine/player.asm) is mid-use of it on a long frame. Composes
  ; on nmi_cam_x_lo/nmi_cam_nt (the snapshot), not cam_x_lo/cam_nt directly --
  ; those may be mid-update.
  lda <shake_left
  beq nmi_scroll_cam_no_shake
  dec <shake_left
  lda <shake_left
  and #1
  bne nmi_scroll_cam_shake_neg
  lda <nmi_cam_x_lo
  clc
  adc #2
  sta <nmi_tmp
  lda <nmi_cam_nt
  bcc nmi_scroll_cam_shake_pos_nt
  eor #1
nmi_scroll_cam_shake_pos_nt:
  jmp nmi_scroll_cam_shake_apply
nmi_scroll_cam_shake_neg:
  lda <nmi_cam_x_lo
  sec
  sbc #2
  sta <nmi_tmp
  lda <nmi_cam_nt
  bcs nmi_scroll_cam_shake_neg_nt
  eor #1
nmi_scroll_cam_shake_neg_nt:
nmi_scroll_cam_shake_apply:
  ora #PPUCTRL_ON
  sta $2000
  lda <nmi_tmp
  sta $2005
  lda <nmi_cam_y_lo
  sta $2005
  jmp nmi_scroll_done
nmi_scroll_cam_no_shake:
  .endif
  lda <nmi_cam_nt
  ora #PPUCTRL_ON
  sta $2000
  lda <nmi_cam_x_lo
  sta $2005
  lda <nmi_cam_y_lo
  sta $2005
  .endif
nmi_scroll_done:

  .if SPLIT_ENABLED
  jsr split_arm             ; art back in for the top, first IRQ armed
  .endif

  inc <frame_cnt
  lda #1
  sta <vblank

  pla
  tay
  pla
  tax
  pla
nmi_rti:                    ; zero bytes -- a Mesen CPU-execute callback keyed
                            ; to this symbol is test/lua's own anchor for
                            ; asserting the whole two-producer NMI still
                            ; finishes inside vblank. build_flash_nmi_roms.mjs
                            ; resolves this symbol's address out of that
                            ; build's own game.fns and stamps it into
                            ; flash_nmi_timing.lua.template each run -- it is
                            ; not hand-copied into the checked-in Lua the way
                            ; this comment used to claim -- and the generated
                            ; script itself preflights the resolved address by
                            ; reading the byte there back and refusing to
                            ; proceed unless it is still $40 (rti); see the
                            ; two-producer invariant paragraph in CLAUDE.md
  rti

  .if !SPLIT_ENABLED
irq:                        ; a split build's handler lives in split.asm
  rti
  .endif
