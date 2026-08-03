; split.asm -- the MMC3 scanline split that gives the font its own CHR bank.
;
; On a board with a scanline IRQ, the generator does not stamp the 96 glyphs
; into every tileset: they live in one extra CHR page after the tilesets, and
; this file switches MMC3's R1 register -- the 2 KB slot holding background
; tiles $80-$FF -- to that page exactly where the text windows start. Above the
; split the map draws its own art, so a project that shows text keeps all 256
; background tiles; that is the entire point. Sprites read $1000-$1FFF (R2-R5),
; which nothing here touches, so the hearts, portraits and party metasprites
; are unaffected.
;
; A split program is a list of 2-byte entries: a scanline count for MMC3's
; counter, then a target -- 0 puts the tileset's art back, nonzero puts the
; font in. A zero count ends the program. NMI arms the first entry each frame
; (split_arm); each IRQ applies its entry and arms the next. The counter
; counts filtered A12 rises -- one per rendered scanline, pre-render included --
; and the IRQ asserts on the clock that leaves it at zero, so a first entry
; armed from vblank with count N lands at the start of visible scanline N,
; and a follow-up armed from inside the handler with count N lands N+1
; scanlines after the entry before it.
;
; Register discipline, which is what makes this safe against its own timing:
;   - The interrupts only ever select MMC3 register 1. If NMI lands between an
;     IRQ's $8000/$8001 pair (or vice versa), the re-selected register is the
;     one the interrupted write wanted anyway.
;   - The mainline writes $8000/$8001 pairs too (switch_chr_bank, and
;     switch_prg_bank on this board) but only ever with rendering off and the
;     counter disabled -- redraw_screen and draw_battle_screen write $E000 the
;     moment they force blank, which both disables and acknowledges it.
;   - The main thread owns split_mode and nothing else; a single store, so a
;     frame never sees half a decision.

  .if SPLIT_ENABLED

; The programs. Rows come from the same constants that draw the windows
; (BOX_MT_ROW, BT_BOX_ROW, the generated TITLE_*_ROW), so moving a window moves
; its split with it.
;
; The counts are calibrated against the built-in player and asserted per
; scanline by split.test.js: a first entry armed from vblank with count N
; switches at the start of scanline N+1, and a follow-up armed inside the
; handler at a switch on scanline S lands at S+count+1 — hence the -1 on first
; entries and gap-1 on follow-ups. Real hardware clocks at dot 260 and so runs
; one scanline ahead of this: there the switch lands on the last line of the
; row above, which for tiles $80-$FF shows one sliver of the other bank. Both
; readings put every whole row where it belongs.
split_progs:
split_prog_box:
  .db BOX_MT_ROW*2*8-1, 1         ; font in at the box's top border row
  .db 0
split_prog_battle:
  .db BT_BOX_ROW*8-1, 1           ; font in at the battle box's top border row
  .db 0
split_prog_title:
  .db TITLE_NAME_ROW*8-1, 1       ; font in for the game's name...
  .db 7, 0                        ; ...one row later, the map's art returns
  .db (TITLE_PROMPT_ROW-TITLE_NAME_ROW-1)*8-1, 1
  .db 7, 0                        ; and the same band around the prompt
  .db 0

; Program start offsets, indexed by split_mode - 1.
split_prog_start:
  .db split_prog_box-split_progs
  .db split_prog_battle-split_progs
  .db split_prog_title-split_progs

; Decide this frame's program from the game state. Main thread, once per frame,
; and the store of split_mode is the only word it says to the interrupt side.
split_select:
  .if TITLE_ENABLED
  lda game_state
  cmp #ST_TITLE
  bne split_select_not_title
  lda #SPL_TITLE
  jmp split_select_store
split_select_not_title:
  .endif
  .if BATTLE_ENABLED
  lda game_state
  cmp #ST_BATTLE
  bne split_select_not_battle
  lda #SPL_BATTLE
  jmp split_select_store
split_select_not_battle:
  .endif
  lda #SPL_OFF
  ldx box_state               ; any box state but CLOSED is showing glyphs
  beq split_select_store
  lda #SPL_BOX
split_select_store:
  sta split_mode
  rts

; Called from NMI with A, X and Y already saved, during vblank: put the live
; tileset's art back for the top of the frame, then arm this frame's first
; entry. The counter only starts clocking when rendering does, so nothing can
; fire before the arm is complete.
split_arm:
  lda #1                      ; select R1, the $0800-$0FFF background slot
  sta $8000
  lda chr_r1
  sta $8001
  lda split_mode
  bne split_arm_go
  sta $E000                   ; no split this frame: disable and acknowledge
  rts
split_arm_go:
  tax
  lda split_prog_start-1,x    ; modes are 1-based
  sta split_idx
  tax
  lda split_progs,x
  sta $C000                   ; the latch...
  sta $C001                   ; ...reloads into the counter on the next clock...
  sta $E001                   ; ...and the line is enabled (any value works)
  rts

; The scanline IRQ. Acknowledge first -- the line stays asserted until $E000 --
; then apply the armed entry and set up the next one, if any.
irq:
  pha
  sta $E000                   ; ack + disable while we work; value irrelevant
  txa
  pha
  ldx split_idx
  lda split_progs+1,x         ; the entry's target
  beq irq_art
  lda #FONT_R1
  jmp irq_switch
irq_art:
  lda chr_r1
irq_switch:
  sta irq_tmp
  lda #1
  sta $8000
  lda irq_tmp
  sta $8001
  inx
  inx
  stx split_idx
  lda split_progs,x           ; the next entry's count, or 0 = done this frame
  beq irq_done
  sta $C000
  sta $C001
  sta $E001
irq_done:
  pla
  tax
  pla
  rti

  .endif
