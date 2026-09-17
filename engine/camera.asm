; camera.asm -- design-camera.md, candidate (b): a same-tileset screen-edge
; crossing along the project's live axis (cameraAxes, shared/cartridge.js)
; slides the camera to the neighbouring screen over CAM_SLIDE_FRAMES frames
; instead of an instant cut. One draw per forced blank: the incoming screen
; goes into the FAR nametable while the outgoing screen sits untouched in
; nametable 0 (today's ordinary cut already pays for that one draw), the
; slide moves the camera register from (0,0) to the far nametable's own
; origin over CAM_SLIDE_FRAMES ticks, and a second forced blank moves the
; identical, already-drawn content from the far nametable back to nametable
; 0 so the camera can land back on (0,0) for the next crossing. Entered from
; player.asm's cross_* stubs in place of `jmp redraw_screen`; see §3
; "Candidate (b)" and "Frozen-world gate".

  .if CAMERA_SLIDE_ENABLED

CAM_SLIDE_FRAMES = 16
CAM_STEP_X = 256/CAM_SLIDE_FRAMES
CAM_STEP_Y = 240/CAM_SLIDE_FRAMES

; Which nametable a crossing in each direction reveals -- indexed by DIR_*
; (engine/constants.asm: DOWN 0, UP 1, LEFT 2, RIGHT 3). Horizontal crossings
; use nametable 1 (bit 0, the mirrored horizontal neighbour); vertical
; crossings use nametable 2 (bit 1, the mirrored vertical neighbour) --
; nametable 3 is never reached because this design ships one live axis at a
; time (cameraAxes never returns both true except on four-screen, and even
; there a single crossing only ever moves one axis).
cam_far_nt:
  .db 2, 2, 1, 1             ; DOWN, UP, LEFT, RIGHT

; Entered instead of `jmp redraw_screen`. A = DIR_* just crossed.
; flat_screen/player_x/y already point at the incoming screen, set by the
; caller (player.asm's cross_* stubs) before this is reached.
redraw_screen_slide:
  sta <cam_slide_dir
  tax
  lda cam_far_nt,x
  sta <cam_far

  lda #$00
  sta $2000
  sta $2001
  .if SPLIT_ENABLED
  sta $E000                 ; disables AND acknowledges MMC3's own scanline
                             ; IRQ (a plain write to this address does both,
                             ; on real hardware) -- this draw calls no
                             ; switch_chr_bank of its own (same-tileset only,
                             ; set_screen_ptr below selects PRG, never CHR),
                             ; so there is no $8000/$8001 register pair to
                             ; protect the way redraw_screen's own identical
                             ; write does; this is guarding against an
                             ; already-armed IRQ from before forced blank
                             ; began still landing mid-draw, alongside $2000's
                             ; own NMI-off write just above
  .endif
  jsr vram_reset             ; whatever was queued for the outgoing screen is
                             ; stale the instant the crossing is taken --
                             ; redraw_screen's own existing contract
                             ; (design-camera.md §6, "vram_reset drops queued
                             ; packets"), inherited unchanged

  ; Only ONE draw here -- the incoming screen, into the FAR nametable. The
  ; outgoing screen already occupies nametable 0 and is left completely
  ; alone: this is the one draw an ordinary cut already pays for.
  jsr set_screen_ptr          ; flat_screen already names the incoming screen
  .if BOUND_TILE_ENABLED
  jsr rebuild_bound_cache     ; design-camera.md §6, "bound_tile_lookup/
                             ; rebuild_bound_cache are keyed off a single
                             ; active cache": one cache, reused sequentially --
                             ; correct for whichever screen is about to be
                             ; drawn, and left holding the INCOMING screen's
                             ; own bindings for the rest of gameplay once the
                             ; slide starts
  .endif
bound_ready_arm:              ; bind_count is observable here (Mesen harness)
  ; The incoming screen's actors are placed once, here, before the far
  ; nametable content ever scrolls into view -- pending_ent/screen_fresh are
  ; armed exactly as they are today, just not SETTLED until the slide's last
  ; tick lets main_loop's gate fall through to settle_owed again (§3), so an
  ; entry event fires on the first ordinary frame after the slide ends
  ; rather than the frame after an instant cut does today.
  jsr apply_map_music
  jsr spawn_entities
  lda <cam_far
  jsr draw_screen_at          ; incoming -> the far nametable
  jsr title_draw
  jsr build_oam
  jsr draw_entities

  ; Camera starts at (0,0) -- already exactly what nametable 0 (the
  ; untouched outgoing screen) shows, so no pre-positioning is needed. Arm
  ; the slide toward the far nametable and flag the completion redraw this
  ; slide will owe once it lands.
  lda #0
  sta <cam_x_lo
  sta <cam_y_lo
  sta <cam_nt
  lda #CAM_SLIDE_FRAMES
  sta <cam_slide_left
  lda #1
  sta <cam_slide_b_pending

  ; The coordinate must be on the PPU before the first visible scanline
  ; whether or not an NMI lands first, so this owns its own publication
  ; rather than calling enable_rendering and relying on ITS hardcoded (0,0)
  ; write -- for this arm, both land on the identical (0,0, nt 0) (cam_x_lo/
  ; y_lo/nt were just reset above), so enable_rendering's own write would not
  ; be WRONG here, only coincidentally right for a consumer that always
  ; starts and ends at the origin. $2000/$2005/$2005 are written in that
  ; order, before $2001, so the address is already correct the instant
  ; rendering turns on.
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
  rts

; Ticked once per frame from main_loop while cam_slide_left is non-zero
; (boot.asm's own frozen-world gate). cam_dirty brackets both stores of a
; wrap -- raised before the first (the low-byte coordinate), released after
; the last (the cam_nt toggle) -- because nmi_scroll's own snapshot refresh
; (boot.asm) must never compose a torn combination of the two: the low byte
; landing at its wrapped value while cam_nt still names the OLD nametable
; would flash the wrong screen for one vblank, and the reverse (cam_nt
; already flipped, low byte not yet stored) would flash content that has not
; scrolled there yet.
camera_slide_tick:
  dec <cam_slide_left
  lda <cam_slide_dir
  cmp #DIR_LEFT
  bcc camera_slide_tick_y
  beq camera_slide_tick_x_dec
  lda <cam_x_lo
  clc
  adc #CAM_STEP_X
  bcc camera_slide_tick_x_store
  inc <cam_dirty
  sta <cam_x_lo
  lda <cam_nt
  eor #1
  sta <cam_nt
  dec <cam_dirty
  jmp camera_slide_tick_check
camera_slide_tick_x_store:
  sta <cam_x_lo
  jmp camera_slide_tick_check
camera_slide_tick_x_dec:
  lda <cam_x_lo
  sec
  sbc #CAM_STEP_X
  bcs camera_slide_tick_x_store
  inc <cam_dirty
  sta <cam_x_lo
  lda <cam_nt
  eor #1
  sta <cam_nt
  dec <cam_dirty
  jmp camera_slide_tick_check
camera_slide_tick_y:
  lda <cam_slide_dir
  cmp #DIR_DOWN
  beq camera_slide_tick_y_inc
  lda <cam_y_lo
  sec
  sbc #CAM_STEP_Y
  bcs camera_slide_tick_y_store
  sec
  sbc #(256-240)
  inc <cam_dirty
  sta <cam_y_lo
  lda <cam_nt
  eor #2
  sta <cam_nt
  dec <cam_dirty
  jmp camera_slide_tick_check
camera_slide_tick_y_inc:
  lda <cam_y_lo
  clc
  adc #CAM_STEP_Y
  cmp #240
  bcc camera_slide_tick_y_store
  sbc #240
  inc <cam_dirty
  sta <cam_y_lo
  lda <cam_nt
  eor #2
  sta <cam_nt
  dec <cam_dirty
  jmp camera_slide_tick_check
camera_slide_tick_y_store:
  sta <cam_y_lo

; Shared tail: has the slide just landed, and if so, is a completion redraw
; owed? Both cheap, paid every tick (15 of 16 fail the first check).
camera_slide_tick_check:
  lda <cam_slide_left
  bne camera_slide_tick_rts
  lda <cam_slide_b_pending
  beq camera_slide_tick_rts
  lda #0
  sta <cam_slide_b_pending
  jsr camera_slide_complete_b
camera_slide_tick_rts:
  rts

; The completion redraw a slide owes once it lands on the far nametable: a
; second forced blank moving the SAME already-drawn content to nametable 0,
; without re-running apply_map_music or spawn_entities -- nothing could have
; been authored during the frozen slide, so there is nothing new for either
; to react to. mtptr/atptr/the PRG bank are exactly what the arming draw
; already left them at; set_screen_ptr is called again anyway, cheaply,
; rather than trusting that no intervening code moved them.
camera_slide_complete_b:
  lda #$00
  sta $2000
  sta $2001
  .if SPLIT_ENABLED
  sta $E000                 ; disable/acknowledge, the identical reason the
                             ; arm's own $E000 write above does
  .endif
  jsr vram_reset
  jsr set_screen_ptr
  .if BOUND_TILE_ENABLED
  jsr rebuild_bound_cache     ; still the same screen's own bindings
  .endif
bound_ready_complete:          ; bind_count is observable here (Mesen harness)
  lda #0
  jsr draw_screen_at          ; incoming, again -> nametable 0 this time
  jsr wait_vblank_poll

  lda #0
  sta <cam_x_lo
  sta <cam_y_lo
  sta <cam_nt                 ; A is still 0 here (STA never touches A)
  ora #PPUCTRL_ON
  sta $2000
  lda <cam_x_lo
  sta $2005
  lda <cam_y_lo
  sta $2005
  lda #PPUMASK_ON
  sta $2001
  rts

  .endif
