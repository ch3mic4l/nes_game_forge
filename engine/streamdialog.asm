; streamdialog.asm -- the streamed-world dialogue overlay, sw_dlg_origin_capture's
; predecessors and everything through sw_dlg_relocated_end: the address mapper,
; split-at-seam packet writer, masked-attribute code, the terrain-tile accessor,
; the production writers, the lifecycle state machine and the twelve relocated
; text.asm dispatch bodies (docs/design-streamed-worlds.md section 7).
;
; ONE source, assembled in exactly ONE of two placements, chosen by the
; generated SW_DLG_BANKED flag (main/build/generate.js, streamworldDialogueBanked
; -- the single predicate):
;   SW_DLG_BANKED = 0  included from engine/streamworld.asm, in kernel-hi, where
;                      this text has always lived.
;   SW_DLG_BANKED = 1  included from engine/battle.asm, in the RPG battle bank,
;                      entered only through call_battle's BE_DLG_* entry points
;                      (phase 2 slice 10b). engine/streamworld.asm then holds
;                      only the resident shims and the H2 terrain routine.
; Never included from anywhere else, and never assembled on a project with no
; text (the includers' own .if TEXT_ENABLED).

  .if SW_DLG_BANKED
sw_dlg_banked_start:
  .endif

; sw_dlg_attr_precompute's own 3-iteration band loop below assumes the box is
; exactly BOX_ROWS_HIGH (6) tile rows -- 3 metatile-row bands -- high; two
; one-directional comparisons, the same restricted `>`-only pattern
; flash.asm's own driver-size guard uses (nesasm v3.1's expression grammar
; has no working `!=`).
  .if BOX_ROWS_HIGH > 6
  .fail
  .endif
  .if 6 > BOX_ROWS_HIGH
  .fail
  .endif

; ==========================================================================
; sw_dlg_tile_addr -- the address mapper, tile granularity. A = box-
; relative tile row (0-5, added to the fixed row-24 origin every ordinary
; box already uses); X = box-local column (0-31). Returns A = $2006 hi
; byte, Y = $2006 lo byte. physRow = (cam_y_lo>>3 + 24 + A) mod 30
; (crossing XORs cam_nt bit 1); physCol = (cam_x_lo>>3 + X) mod 32
; (crossing XORs cam_nt bit 0); addrLo = (physRow AND 7)<<5 OR physCol;
; addrHi = sw_rw_nt_hi[cam_nt XOR ntbit] + (physRow>>3) -- sw_rw_nt_hi is
; sw_render_window's own nametable-hi table, above, reused rather than a
; second copy.
; ==========================================================================
sw_dlg_tile_addr:
  clc
  adc #BOX_MT_ROW*2         ; tile row 24 -- BOX_MT_ROW (metatile rows) in tile rows
  sta <sw_dlgw_ta_tmp
  lda <cam_y_lo
  lsr a
  lsr a
  lsr a
  clc
  adc <sw_dlgw_ta_tmp
  cmp #30
  bcc sw_dlgta_row_ok
  sbc #30
  sta <sw_dlgw_ta_row
  lda #2
  jmp sw_dlgta_row_done
sw_dlgta_row_ok:
  sta <sw_dlgw_ta_row
  lda #0
sw_dlgta_row_done:
  sta <sw_dlgw_ta_nt
  lda <cam_x_lo
  lsr a
  lsr a
  lsr a
  sta <sw_dlgw_ta_tmp
  txa
  clc
  adc <sw_dlgw_ta_tmp
  cmp #32
  bcc sw_dlgta_col_ok
  sbc #32
  sta <sw_dlgw_ta_col
  lda <sw_dlgw_ta_nt
  ora #1
  jmp sw_dlgta_combine
sw_dlgta_col_ok:
  sta <sw_dlgw_ta_col
  lda <sw_dlgw_ta_nt
sw_dlgta_combine:
  sta <sw_dlgw_ta_nt
  lda <sw_dlgw_ta_row
  and #7
  asl a
  asl a
  asl a
  asl a
  asl a
  ora <sw_dlgw_ta_col
  tay
  lda <cam_nt
  eor <sw_dlgw_ta_nt
  and #3
  tax
  lda <sw_dlgw_ta_row
  lsr a
  lsr a
  lsr a
  clc
  adc sw_rw_nt_hi,x
  rts

; ==========================================================================
; sw_dlg_write_row -- the split-at-seam packet writer, tile granularity.
; A = box-relative tile row (0-5); sw_dlgw_srclo/hi point at 32 source
; bytes. Queues them via the ordinary vram_open/push/end primitives
; (engine/text.asm), split into two packets when the row straddles a
; physical nametable seam. Never opens a packet it will not push to: the
; r==0 case (camera exactly nametable-aligned horizontally) skips the
; second packet outright rather than opening one with a zero count --
; vram_drain_byte's own 256-byte trap (CLAUDE.md), applied to this
; producer's own direct-write path.
; ==========================================================================
sw_dlg_write_row:
  sta <sw_dlgw_band
  lda <cam_x_lo
  lsr a
  lsr a
  lsr a
  sta <sw_dlgw_r
  beq sw_dlgwr_nosplit
  lda #32
  sec
  sbc <sw_dlgw_r
  sta <sw_dlgw_count1
  lda <sw_dlgw_band
  ldx #0
  jsr sw_dlg_tile_addr
  jsr vram_open
  ldy #0
sw_dlgwr_seg1_loop:
  lda [sw_dlgw_srclo],y
  jsr vram_push
  iny
  cpy <sw_dlgw_count1
  bne sw_dlgwr_seg1_loop
  jsr vram_end
  lda <sw_dlgw_band
  ldx <sw_dlgw_count1
  jsr sw_dlg_tile_addr
  jsr vram_open
  ldy <sw_dlgw_count1
sw_dlgwr_seg2_loop:
  lda [sw_dlgw_srclo],y
  jsr vram_push
  iny
  cpy #32
  bne sw_dlgwr_seg2_loop
  jmp vram_end
sw_dlgwr_nosplit:
  lda <sw_dlgw_band
  ldx #0
  jsr sw_dlg_tile_addr
  jsr vram_open
  ldy #0
sw_dlgwr_ns_loop:
  lda [sw_dlgw_srclo],y
  jsr vram_push
  iny
  cpy #32
  bne sw_dlgwr_ns_loop
  jmp vram_end

; ==========================================================================
; sw_dlg_attr_precompute -- must run once before any sw_dlg_attr_open_band/
; sw_dlg_attr_close_band call for a given open box (the camera does not
; move while one is up -- §7's own frozen-world pending-open rule -- so one
; precompute per open/close transaction is enough). Computes, for each of
; the box's three metatile-row bands (0-2, tile rows 24-25/26-27/28-29):
; the attribute row (0-7) and row-wrap nt bit its own physical position
; resolves to, and its own row-half mask (top $0F, bottom $F0) -- promoted
; to the full byte ($FF) for BOTH bands of whichever adjacent pair shares
; one physical attribute byte (docs/design-streamed-worlds.md §7's own
; empirically-found addition: applying the half mask independently per row
; is wrong when two band rows share a byte, since each would compute from
; pristine attr_shadow and the second write would undo the first's already-
; correct half; forcing the full mask on both makes the write idempotent
; regardless of order). Also computes the column seam: edgeAc (the
; attribute column straddling it), cxodd (nonzero when the seam falls
; mid-attribute-column, needing a quadrant-only mask there) and wrapEnd
; (the last attribute column the wrapped-nt segment touches).
; ==========================================================================
sw_dlg_attr_precompute:
  lda <cam_y_lo
  lsr a
  lsr a
  lsr a
  lsr a
  clc
  adc #BOX_MT_ROW
  sta <sw_dlgw_baserow      ; held constant across the loop -- see its own comment
                              ; (engine/constants.asm) for why: each iteration below re-derives
                              ; that band's UNWRAPPED logical row from this same untouched base
                              ; plus its own index, rather than carrying a destructively-wrapped
                              ; remainder forward, so a band on the far side of the seam (its own
                              ; unwrapped row already >=15) is not mistaken for an unwrapped one
                              ; just because the PRIOR band's remainder happened to fall < 15
  ldx #0
sw_dlgap_loop:
  txa
  clc
  adc <sw_dlgw_baserow
  cmp #15
  bcc sw_dlgap_ok
  sbc #15
  sta <sw_dlgw_tmp
  lda #2
  sta <sw_dlgw_ntb,x
  jmp sw_dlgap_store
sw_dlgap_ok:
  sta <sw_dlgw_tmp
  lda #0
  sta <sw_dlgw_ntb,x
sw_dlgap_store:
  lda <sw_dlgw_tmp
  lsr a
  sta <sw_dlgw_arow,x
  lda <sw_dlgw_tmp
  and #1
  bne sw_dlgap_bottom
  lda #$0F
  jmp sw_dlgap_halfdone
sw_dlgap_bottom:
  lda #$F0
sw_dlgap_halfdone:
  sta <sw_dlgw_rowmask,x
  inx
  cpx #3
  bne sw_dlgap_loop
  ldx #0
  lda <sw_dlgw_arow,x
  ldx #1
  cmp <sw_dlgw_arow,x
  bne sw_dlgap_sh01_no
  ldx #0
  lda <sw_dlgw_ntb,x
  ldx #1
  cmp <sw_dlgw_ntb,x
  bne sw_dlgap_sh01_no
  lda #$FF
  ldx #0
  sta <sw_dlgw_rowmask,x
  ldx #1
  sta <sw_dlgw_rowmask,x
sw_dlgap_sh01_no:
  ldx #1
  lda <sw_dlgw_arow,x
  ldx #2
  cmp <sw_dlgw_arow,x
  bne sw_dlgap_sh12_no
  ldx #1
  lda <sw_dlgw_ntb,x
  ldx #2
  cmp <sw_dlgw_ntb,x
  bne sw_dlgap_sh12_no
  lda #$FF
  ldx #1
  sta <sw_dlgw_rowmask,x
  ldx #2
  sta <sw_dlgw_rowmask,x
sw_dlgap_sh12_no:
  lda <cam_x_lo
  lsr a
  lsr a
  lsr a
  lsr a
  and #1
  sta <sw_dlgw_cxodd
  lda <cam_x_lo
  lsr a
  lsr a
  lsr a
  lsr a
  lsr a
  sta <sw_dlgw_edgeac
  clc
  adc <sw_dlgw_cxodd
  sec
  sbc #1
  sta <sw_dlgw_wrapend
  rts

; sw_dlg_attr_addr -- A = column-seam nt bit (0 = home segment, 1 =
; wrapped). Uses sw_dlgw_curarow/curntb (set by the caller) and
; sw_dlgw_ac (the attribute column, 0-7) to compute both the $2006 hi/lo
; pair (returned A=hi, Y=lo) and the matching attr_shadow offset (left in
; sw_dlgw_shadowlo -- shadow's own high byte is always the constant
; HIGH(attr_shadow), a whole 256-byte page, so only the low byte varies:
; (nt<<6) | (arow<<3) | ac, the same bit-packed layout sw_ns_row_lo/
; sw_rw_shadow_lo already use above). This routine itself writes that
; constant into sw_dlgw_tmp (== sw_dlgw_shadowlo+1, the pointer's own hi
; byte) as the last thing before returning, since sw_dlgw_tmp is also this
; routine's own scratch for the seam-bit parameter earlier -- a caller
; indirecting through [sw_dlgw_shadowlo],y right after this call sees a
; valid pointer without setting anything up itself. The attribute region's
; own $2006 hi byte is constant per nametable (sw_rw_nt_hi[nt]+3) regardless
; of attribute row -- arow only ever affects the lo byte.
sw_dlg_attr_addr:
  sta <sw_dlgw_tmp
  lda <cam_nt
  eor <sw_dlgw_curntb
  eor <sw_dlgw_tmp
  and #3
  pha
  tax
  txa
  asl a
  asl a
  asl a
  asl a
  asl a
  asl a
  sta <sw_dlgw_shadowlo
  lda <sw_dlgw_curarow
  asl a
  asl a
  asl a
  clc
  adc <sw_dlgw_shadowlo
  clc
  adc <sw_dlgw_ac
  sta <sw_dlgw_shadowlo
  pla
  tax
  lda sw_rw_nt_hi,x
  clc
  adc #3
  pha
  lda <sw_dlgw_curarow
  asl a
  asl a
  asl a
  clc
  adc <sw_dlgw_ac
  clc
  adc #$C0
  tay
  lda #HIGH(attr_shadow)      ; same symbolic form as sw_ns_row_hi/sw_rw_shadow_hi above
                               ; (streamworld.asm:2008,2126) -- nesasm v3.1 accepts HIGH(), unlike
                               ; a `>`-of-equate expression
  sta <sw_dlgw_tmp
  pla
  rts

; sw_dlg_attr_overlay -- A = column mask (quadrant bits actually inside the
; band for the byte at sw_dlgw_shadowlo). Combines with sw_dlgw_currm (the
; band's own row mask) and returns overlay = shadow AND NOT (row AND col)
; in A -- the box's fixed background palette 0 (text.asm's identical
; choice) makes "mask in the box palette" a plain clear, no OR needed.
sw_dlg_attr_overlay:
  and <sw_dlgw_currm
  eor #$FF
  sta <sw_dlgw_mask            ; NOT sw_dlgw_tmp -- sw_dlgw_tmp is [sw_dlgw_shadowlo]'s own
                                ; pointer hi byte (sw_dlg_attr_addr's own doc comment); clobbering
                                ; it here before the indirect read below would misdirect the read
                                ; to page $00 or the mask's own byte instead of attr_shadow.
  ldy #0
  lda [sw_dlgw_shadowlo],y
  and <sw_dlgw_mask
  rts

; ==========================================================================
; sw_dlg_attr_open_band -- A = band index (0-2). Requires
; sw_dlg_attr_precompute to have already run for this open. Writes the
; masked attribute bytes for this band: one packet for the home-nt segment
; (attribute columns edgeAc..7, full width -- the box always spans the
; whole visible screen), one for the wrapped-nt segment (columns
; 0..wrapEnd, only when non-empty), each byte computed straight from
; attr_shadow via sw_dlg_attr_overlay -- attr_shadow itself is never
; written here, only read.
; ==========================================================================
sw_dlg_attr_open_band:
  tax
  lda <sw_dlgw_arow,x
  sta <sw_dlgw_curarow
  lda <sw_dlgw_ntb,x
  sta <sw_dlgw_curntb
  lda <sw_dlgw_rowmask,x
  sta <sw_dlgw_currm

  lda <sw_dlgw_edgeac
  sta <sw_dlgw_ac
  lda #0
  jsr sw_dlg_attr_addr
  jsr vram_open
sw_dlg_aob_home_loop:
  lda <sw_dlgw_ac
  cmp <sw_dlgw_edgeac
  bne sw_dlg_aob_home_mask
  lda <sw_dlgw_cxodd
  beq sw_dlg_aob_home_mask
  lda #$CC                    ; edge byte, home side: right quadrants only
  jmp sw_dlg_aob_home_go
sw_dlg_aob_home_mask:
  lda #$FF
sw_dlg_aob_home_go:
  jsr sw_dlg_attr_overlay
  jsr vram_push
  inc <sw_dlgw_shadowlo
  inc <sw_dlgw_ac
  lda <sw_dlgw_ac
  cmp #8
  bne sw_dlg_aob_home_loop
  jsr vram_end

  lda <sw_dlgw_edgeac
  ora <sw_dlgw_cxodd
  beq sw_dlg_aob_done          ; wrapped segment empty -- never open its packet
  lda #0
  sta <sw_dlgw_ac
  lda #1
  jsr sw_dlg_attr_addr
  jsr vram_open
sw_dlg_aob_wrap_loop:
  lda <sw_dlgw_ac
  cmp <sw_dlgw_edgeac
  bne sw_dlg_aob_wrap_mask
  lda <sw_dlgw_cxodd
  beq sw_dlg_aob_wrap_mask
  lda #$33                    ; edge byte, wrapped side: left quadrants only
  jmp sw_dlg_aob_wrap_go
sw_dlg_aob_wrap_mask:
  lda #$FF
sw_dlg_aob_wrap_go:
  jsr sw_dlg_attr_overlay
  jsr vram_push
  lda <sw_dlgw_ac
  cmp <sw_dlgw_wrapend
  beq sw_dlg_aob_wrap_end
  inc <sw_dlgw_shadowlo
  inc <sw_dlgw_ac
  jmp sw_dlg_aob_wrap_loop
sw_dlg_aob_wrap_end:
  jsr vram_end
sw_dlg_aob_done:
  rts

; ==========================================================================
; sw_dlg_attr_close_band -- A = band index (0-2). Restores every attribute
; byte sw_dlg_attr_open_band touched for this band, verbatim from
; attr_shadow -- no mask math on close (docs/design-streamed-worlds.md
; §7's "masked on open, plain on close, one rule": the masked write never
; touches an outside-band quadrant, so every quadrant stays byte-identical
; to attr_shadow for the whole transaction, and close can restore the
; whole byte unmasked). Reads attr_shadow only; never writes it.
; ==========================================================================
sw_dlg_attr_close_band:
  tax
  lda <sw_dlgw_arow,x
  sta <sw_dlgw_curarow
  lda <sw_dlgw_ntb,x
  sta <sw_dlgw_curntb

  lda <sw_dlgw_edgeac
  sta <sw_dlgw_ac
  lda #0
  jsr sw_dlg_attr_addr
  jsr vram_open
sw_dlg_acb_home_loop:
  ldy #0
  lda [sw_dlgw_shadowlo],y
  jsr vram_push
  inc <sw_dlgw_shadowlo
  inc <sw_dlgw_ac
  lda <sw_dlgw_ac
  cmp #8
  bne sw_dlg_acb_home_loop
  jsr vram_end

  lda <sw_dlgw_edgeac
  ora <sw_dlgw_cxodd
  beq sw_dlg_acb_done
  lda #0
  sta <sw_dlgw_ac
  lda #1
  jsr sw_dlg_attr_addr
  jsr vram_open
sw_dlg_acb_wrap_loop:
  ldy #0
  lda [sw_dlgw_shadowlo],y
  jsr vram_push
  lda <sw_dlgw_ac
  cmp <sw_dlgw_wrapend
  beq sw_dlg_acb_wrap_end
  inc <sw_dlgw_shadowlo
  inc <sw_dlgw_ac
  jmp sw_dlg_acb_wrap_loop
sw_dlg_acb_wrap_end:
  jsr vram_end
sw_dlg_acb_done:
  rts

; ==========================================================================
; sw_dlg_origin_capture -- phase 2 slice 7b: Chris ruled (2026-09-25) this
; slice owns sw_dlg_metatile, the close-path terrain-tile accessor, and this
; is its companion. Captures this open/close transaction's own box origin
; into sw_dlg_ocol/ocol_l/orow/orow_l (engine/constants.asm), once, from
; sw_cam_origin_x_lo/hi and sw_cam_origin_y_lo/hi -- the streamed camera's
; own published world-space origin, "the world position already sitting at
; screen column/row 0" (that pair's own constants.asm comment). The
; dialogue nudge (not yet built -- see this slice's own report) keeps that
; origin floored to a 16px boundary and in lockstep with cam_x_lo/cam_y_lo
; for as long as a box stays open, and the world is frozen for the whole
; transaction (docs/design-streamed-worlds.md §7's own DLG_PENDING rule),
; so one capture serves every sw_dlg_metatile call of that transaction --
; the identical "compute once, consult many times" shape sw_dlg_attr_
; precompute already has, above.
;
; screenCol needs no division: a screen is exactly 256px wide, so
; sw_cam_origin_x_hi already IS the origin's own screenCol, and
; sw_cam_origin_x_lo>>4 is its local metatile column (0-15) -- a clean
; shift because the nudge floors it to a 16px multiple. screenRow needs a
; real divmod: a screen is 240px tall, not a power of two -- the same
; bounded repeated-subtract idiom sw_camera_window_recompute's own
; sw_fcw_ydiv_loop already uses (bounded by sw_grid_h, as that routine's
; own header documents), run here on a local copy in sw_dlg_scr0/scr1 so
; sw_cam_origin_y_lo/hi itself is left untouched for sw_project_axis's own
; next frame.
;
; In: none. Out: sw_dlg_ocol/ocol_l/orow/orow_l set. Clobbers A, X.
; ==========================================================================
sw_dlg_origin_capture:
  lda sw_cam_origin_x_hi
  sta sw_dlg_ocol
  lda sw_cam_origin_x_lo
  lsr a
  lsr a
  lsr a
  lsr a
  sta sw_dlg_ocol_l

  lda sw_cam_origin_y_lo
  sta sw_dlg_scr0
  lda sw_cam_origin_y_hi
  sta sw_dlg_scr1
  ldx #0
sw_dlgoc_ydiv_loop:
  lda sw_dlg_scr1
  bne sw_dlgoc_ydiv_sub
  lda sw_dlg_scr0
  cmp #240
  bcc sw_dlgoc_ydiv_done
sw_dlgoc_ydiv_sub:
  lda sw_dlg_scr0
  sec
  sbc #240
  sta sw_dlg_scr0
  lda sw_dlg_scr1
  sbc #0
  sta sw_dlg_scr1
  inx
  jmp sw_dlgoc_ydiv_loop
sw_dlgoc_ydiv_done:
  stx sw_dlg_orow
  lda sw_dlg_scr0
  lsr a
  lsr a
  lsr a
  lsr a
  sta sw_dlg_orow_l
  rts

; ==========================================================================
; sw_dlg_metatile -- the close-path terrain-tile accessor: composes
; sw_terrain_or_fill with the caller-supplied origin sw_dlg_origin_capture
; (above) already resolved, exactly as docs/design-streamed-worlds.md §7's
; own "On close ... via sw_dlg_metatile (composing sw_terrain_or_fill with a
; caller-supplied origin ...)" describes. sw_dlg_origin_capture must already
; have run for this transaction; this routine does not call it, so a
; caller's every close-path cell lookup pays only this routine's own small
; add/wrap arithmetic, not a fresh divmod per cell.
;
; In: A = box-relative metatile row (0-2, BOX_MT_ROW's own three bands);
;     X = box-relative metatile column (0-15).
; Out: A = the metatile id at that cell (sw_terrain_or_fill's own fill-aware
;     read). Clobbers X, Y (as sw_terrain_or_fill's real-read case does) and
;     this routine's own sw_dlg_scr0-3 scratch.
; ==========================================================================
sw_dlg_metatile:
  sta sw_dlg_scr1          ; stash box-relative row; A is about to be reused
  txa
  clc
  adc sw_dlg_ocol_l
  cmp #16
  bcc sw_dlgmt_col_ok
  sbc #16
  sta sw_dlg_scr0
  lda sw_dlg_ocol
  clc
  adc #1
  sta sw_dlg_scr2
  jmp sw_dlgmt_row
sw_dlgmt_col_ok:
  sta sw_dlg_scr0
  lda sw_dlg_ocol
  sta sw_dlg_scr2
sw_dlgmt_row:
  lda sw_dlg_scr1          ; the stashed box-relative row
  clc
  adc #BOX_MT_ROW
  clc
  adc sw_dlg_orow_l
  cmp #15
  bcc sw_dlgmt_row_ok
  sbc #15
  sta sw_dlg_scr1
  lda sw_dlg_orow
  clc
  adc #1
  sta sw_dlg_scr3
  jmp sw_dlgmt_offset
sw_dlgmt_row_ok:
  sta sw_dlg_scr1
  lda sw_dlg_orow
  sta sw_dlg_scr3
sw_dlgmt_offset:
  lda sw_dlg_scr1          ; local row (0-14)
  asl a
  asl a
  asl a
  asl a                     ; * 16 metatiles per row
  clc
  adc sw_dlg_scr0          ; + local col -- offset within the target screen
  tay
  ldx sw_dlg_scr3          ; screenRow
  lda sw_dlg_scr2          ; screenCol
  .if SW_DLG_BANKED
  ; H2 (slice 10b): sw_terrain_or_fill reads map data THROUGH the $8000
  ; window this code is running from, so a banked caller goes through the one
  ; resident routine that re-selects BATTLE_BANK before returning here.
  jmp sw_dlg_terrain_read
  .else
  jmp sw_terrain_or_fill
  .endif

; ==========================================================================
; sw_dlg_run_open/push/reopen -- the split-aware run writer, generalised
; from sw_dlg_write_row above to an arbitrary starting column and an
; arbitrary (even variable, caller-decided) length: border/close-row writes
; run the full 32-tile width from column 0, but a text-clear or choice-label
; row starts at column 2 and runs at most BOX_COLS (28), and a choice
; label's real length is however many glyphs precede its TXT_END, capped
; there. sw_dlg_write_row's own single fixed-shape split is unaffected (its
; producers, the attribute band writers, keep using it).
;
; sw_dlg_run_open never calls vram_open itself -- only sw_dlg_run_push's own
; first call does, lazily, so a caller that computes the seam and then finds
; it has nothing to write (a blank choice label) never opens a zero-push
; packet (CLAUDE.md's "a count of zero drains as 256" trap).
;
; In: A = box-relative tile row (0-5); X = box-relative starting column
;     (0-31). Out: sw_dlgw_band/col store the row/column for
;     sw_dlg_run_push's own first-call reopen; sw_dlgw_seamcol is the column
;     at which the physical nametable wraps (32 minus cam_x_lo>>3 -- 32 when
;     cam_x_lo is nametable-aligned, a value no real 0-31 column ever
;     equals, so no split ever fires); sw_dlgw_open = 0. Clobbers A.
; ==========================================================================
sw_dlg_run_open:
  sta <sw_dlgw_band
  stx <sw_dlgw_col
  lda <cam_x_lo
  lsr a
  lsr a
  lsr a
  sta <sw_dlgw_tmp          ; r, transient -- no attr call is ever in flight
                              ; here (see sw_dlgw_tmp's own comment above)
  lda #32
  sec
  sbc <sw_dlgw_tmp
  sta <sw_dlgw_seamcol
  lda #0
  sta <sw_dlgw_open
  rts

; In: A = the byte to write at the current column (sw_dlgw_col), advanced
; here. Must be called once per column in strictly ascending order, starting
; at the column sw_dlg_run_open was given. Preserves X and Y -- matching
; vram_push's own contract, which every caller here is written against (a
; loop counter in X, or a shared index/id in Y computed once and read again
; after the call, the same shapes the ordinary vram_push callers already
; use) -- even though the reopen path below genuinely clobbers both via
; sw_dlg_tile_addr, saved and restored around it rather than left to leak.
sw_dlg_run_push:
  pha
  txa
  pha
  tya
  pha
  lda <sw_dlgw_open
  bne sw_dlgrp_check_seam
  jsr sw_dlg_run_reopen
  lda #1
  sta <sw_dlgw_open
  jmp sw_dlgrp_restore
sw_dlgrp_check_seam:
  lda <sw_dlgw_col
  cmp <sw_dlgw_seamcol
  bne sw_dlgrp_restore
  jsr vram_end
  jsr sw_dlg_run_reopen
sw_dlgrp_restore:
  pla
  tay
  pla
  tax
  pla
  jsr vram_push
  inc <sw_dlgw_col
  rts

; Open a fresh packet at sw_dlgw_band/col's own current position. Clobbers
; A, X, Y.
sw_dlg_run_reopen:
  lda <sw_dlgw_band
  ldx <sw_dlgw_col
  jsr sw_dlg_tile_addr
  jmp vram_open

; ==========================================================================
; sw_dlg_write_border -- one 32-tile-wide border row (text_open_step's own
; corner/rule-or-frame/blank byte choice, made by the caller), split-aware.
; In: A = box-relative tile row (0-5); sw_dlgw_edge = the tile at columns 0
; and 31; sw_dlgw_fill = the tile for columns 1-30.
; ==========================================================================
sw_dlg_write_border:
  ldx #0
  jsr sw_dlg_run_open
  lda <sw_dlgw_edge
  jsr sw_dlg_run_push
  ldx #30
sw_dlgwb_loop:
  lda <sw_dlgw_fill
  jsr sw_dlg_run_push
  dex
  bne sw_dlgwb_loop
  lda <sw_dlgw_edge
  jsr sw_dlg_run_push
  jmp vram_end

; ==========================================================================
; sw_dlg_close_row -- rebuild one 32-tile-wide tile row from terrain via
; sw_dlg_metatile, split-aware -- text_close_step's own metatile math
; (box-relative tile row 0-5 maps to metatile row (tile_row>>1)+BOX_MT_ROW,
; top/bottom half = tile_row&1), reusing sw_dlgw_edge as the metatile-column
; loop counter (0-15) -- safe because a border write and a close-row rebuild
; never run in the same transaction (opposite ends of the box's own
; open/close lifecycle).
; In: A = box-relative tile row (0-5). Clobbers A, X, Y, sw_dlgw_mtrow/half/
; edge, sw_dlg_metatile's own scratch.
; ==========================================================================
sw_dlg_close_row:
  tax
  and #1
  sta <sw_dlgw_half
  txa
  lsr a
  sta <sw_dlgw_mtrow
  txa
  ldx #0
  jsr sw_dlg_run_open
  lda #0
  sta <sw_dlgw_edge
sw_dlgcr_loop:
  lda <sw_dlgw_mtrow
  ldx <sw_dlgw_edge
  jsr sw_dlg_metatile
  tay
  lda <sw_dlgw_half
  bne sw_dlgcr_bottom
  lda mt_tl,y
  jsr sw_dlg_run_push
  lda mt_tr,y
  jsr sw_dlg_run_push
  jmp sw_dlgcr_next
sw_dlgcr_bottom:
  lda mt_bl,y
  jsr sw_dlg_run_push
  lda mt_br,y
  jsr sw_dlg_run_push
sw_dlgcr_next:
  inc <sw_dlgw_edge
  lda <sw_dlgw_edge
  cmp #16
  bne sw_dlgcr_loop
  jmp vram_end

; ==========================================================================
; sw_dlg_single -- one tile, through the mapper; a single byte can never
; straddle a seam, so no split bookkeeping is needed. In: A = box-relative
; tile row (0-5); X = box-relative tile column (0-31); the byte to write is
; already on the caller's own stack (the same pha/…/pla shape every ordinary
; single-tile site in engine/text.asm already uses around its own
; vram_open). Pulls it, pushes it, closes the packet.
; ==========================================================================
sw_dlg_single:
  jsr sw_dlg_tile_addr
  jsr vram_open
  pla
  jsr vram_push
  jmp vram_end

; ==========================================================================
; sw_dlg15_pending_step -- called once per frame from text_tick while
; sw_dlg15_state == SW_DLG15_PENDING (box_begin deferred this transaction's
; own open). Waits for the strip to go idle, then floors the camera to a
; 16px boundary (snapshotting the exact pre-nudge state for the un-nudge to
; restore verbatim, never re-derived) and opens the camera/OAM publication
; hold, then completes the deferred box_begin transition.
;
; X axis: cam_x_lo and sw_cam_origin_x_lo are always the same value
; (sw_camera_window_recompute writes both from sw_fc_px_lo, above) -- floored
; independently here anyway, for symmetry with the Y axis rather than
; leaning on that equality. Y axis: cam_y_lo = worldY mod 240 while
; sw_cam_origin_y_lo/hi is the full world-space value; 240 is itself a
; multiple of 16, so flooring each independently by AND #$F0 cannot
; disagree. Neither hi byte is ever touched by a floor (AND only clears
; bits, never borrows) -- saved and restored anyway, matching the design's
; own 4-byte x_lo/x_hi/y_lo/y_hi block rather than depending on that.
; ==========================================================================
sw_dlg15_pending_step:
  lda st_active
  bne sw_dlg15p_wait
  lda <cam_x_lo
  sta sw_dlg_cam_x_lo
  lda <cam_y_lo
  sta sw_dlg_cam_y_lo
  lda sw_cam_origin_x_lo
  sta <sw_dlg15_origin_x_lo
  lda sw_cam_origin_x_hi
  sta <sw_dlg15_origin_x_hi
  lda sw_cam_origin_y_lo
  sta <sw_dlg15_origin_y_lo
  lda sw_cam_origin_y_hi
  sta <sw_dlg15_origin_y_hi
  ; Fix round 1, finding A1: acquire the publication lock BEFORE the first
  ; store to a byte nmi_scroll/nmi_oam_guard actually read (cam_x_lo,
  ; sw_cam_origin_x/y_lo) -- an NMI landing between these stores must never
  ; see a torn floor. Unlike the shipped code this replaces, the lock is
  ; held only for this one mainline frame: OAM is rebuilt against the
  ; already-floored origin (below) before the lock is released, so the same
  ; NMI that first observes cam_dirty==0 finds the scroll write and the OAM
  ; DMA mutually consistent. The world itself stays motionless for the
  ; whole conversation by a completely different, pre-existing mechanism --
  ; game_state != ST_GAMEPLAY already keeps main_loop from ever calling
  ; update_player again (engine/boot.asm) once a box is up, so
  ; sw_frame_camera_window/sw_camera_window_recompute do not run again
  ; until the box closes. This lock is not what holds the camera still; it
  ; only brackets the two moments (nudge, un-nudge) the published camera
  ; actually changes.
  inc <cam_dirty
  lda <cam_x_lo
  and #$F0
  sta <cam_x_lo
  lda sw_cam_origin_x_lo
  and #$F0
  sta sw_cam_origin_x_lo
  lda <cam_y_lo
  and #$F0
  sta <cam_y_lo
  lda sw_cam_origin_y_lo
  and #$F0
  sta sw_cam_origin_y_lo
  ; Fix round 1, finding A2: capture this transaction's own terrain-restore
  ; origin now, the instant the camera has settled at its floored value --
  ; the only production call site sw_dlg_close_row's own sw_dlg_metatile
  ; call depends on.
  ; Fix round 1, finding A4: sw_dlg_lifecycle_open_start/_end brackets only
  ; this fix round's own new bytes (A1's rebuild-before-release call pair
  ; plus A2's origin capture) -- kept OUT of the pre-existing
  ; STREAMWORLD_DIALOGUE_MAPPER_KERNEL_HI_ALLOWANCE span measurement and
  ; charged instead to its own STREAMWORLD_DIALOGUE_LIFECYCLE_KERNEL_HI_
  ; ALLOWANCE, per Chris's 2026-09-25 ruling not to fold lifecycle growth
  ; into the 7a mapper term.
sw_dlg_lifecycle_open_start:
  jsr sw_dlg_origin_capture
  ; Fix round 1, finding A1: rebuild the sprite shadow against the just-
  ; floored origin before the lock is released below -- otherwise the very
  ; next NMI could DMA a shadow still describing the pre-nudge camera while
  ; already publishing the floored scroll, the exact one-frame mismatch the
  ; walk/interact/open probe recorded. build_oam/draw_entities are already
  ; called unconditionally, every frame, from main_loop_draw
  ; (engine/boot.asm) right after this routine's own caller returns --
  ; calling them again there this same frame is redundant, not wrong (both
  ; are pure projections of state this routine does not otherwise touch),
  ; and is what makes it safe to publish before that second call runs.
  jsr build_oam
  jsr draw_entities
  ; the release itself is also new -- the pre-fix routine never decremented
  ; here at all, relying on sw_dlg17_camrelease's own dec to match an
  ; inc <cam_dirty this routine left standing across the whole conversation.
  dec <cam_dirty
sw_dlg_lifecycle_open_end:
  lda #1
  sta sw_dlg17_camhold
  lda #SW_DLG15_IDLE
  sta <sw_dlg15_state
  lda #BOX_OPENING
  sta <box_state
  rts
sw_dlg15p_wait:
  rts

; ==========================================================================
; sw_dlg17_camrelease -- called unconditionally, once per frame, from
; main_loop_idle (engine/boot.asm), regardless of game_state -- text_tick is
; not reached once close_ui has already run, so the drain-acknowledged
; release cannot live there. sw_dlg17_camhold makes the common case (no
; hold open, every ordinary frame of the whole game) a single cheap flag
; test.
; ==========================================================================
  .if SW_DLG_BANKED
  ; Banked placement: the per-frame poll and the Save/Move/close_ui continuation
  ; are the resident shim's (engine/streamworld.asm, sw_dlg17_camrelease); this
  ; is only the camera restore the poll found due, entered as BE_DLG_CAMRELEASE.
sw_dlg_be_camrelease:
  .else
sw_dlg17_camrelease:
  lda sw_dlg17_camhold
  beq sw_dlg17cr_done
  lda <sw_dlg15_state
  cmp #SW_DLG15_DRAINING
  bne sw_dlg17cr_done
  lda <vram_ready
  bne sw_dlg17cr_done
  .endif
  ; Fix round 1, finding A1: acquire before the first restore store, exactly
  ; as sw_dlg15_pending_step's own nudge does above -- this routine is
  ; polled from main_loop_idle (engine/boot.asm), AFTER this same frame's
  ; main_loop_draw already ran build_oam/draw_entities against the still-
  ; floored camera, so without a rebuild here the shadow DMA'd at the very
  ; next NMI would still describe the floored position even though that
  ; same NMI's scroll write already shows the restored one -- the
  ; observed one-frame, 14-pixel sprite pop. Restore the camera, rebuild
  ; OAM against it, THEN release: the matching pair publishes together.
  ; sw_dlg_lifecycle_close_a/_close_b bracket only this fix round's own new
  ; bytes (the fresh acquire, then the rebuild-before-release call pair) --
  ; the restore stores between them already existed before this fix round
  ; and stay counted in the pre-existing mapper span, not this new term. See
  ; sw_dlg_lifecycle_open_start's own comment above.
  ;
  ; Round 2, finding A1: draw_entities parks every remaining sprite
  ; (engine/entities.asm), which erases the action HUD's hearts that
  ; main_loop_draw's own earlier draw_hud call (engine/boot.asm) already drew
  ; this same frame -- this second, later rebuild must reproduce the whole
  ; applicable OAM composition main_loop_draw itself publishes
  ; (build_oam/draw_entities/draw_hud, in that order), not just the world
  ; projection, or the very next real DMA shows a heart-less HUD for one
  ; frame. Matches main_loop_draw's own !BATTLE_ENABLED gate exactly -- an
  ; RPG has no action HUD to preserve here (ui_tick's own battle overlay
  ; owns the shadow instead, the same reason main_loop_draw itself skips
  ; draw_hud there).
sw_dlg_lifecycle_close_a_start:
  inc <cam_dirty
sw_dlg_lifecycle_close_a_end:
  lda sw_dlg_cam_x_lo
  sta <cam_x_lo
  lda sw_dlg_cam_y_lo
  sta <cam_y_lo
  lda <sw_dlg15_origin_x_lo
  sta sw_cam_origin_x_lo
  lda <sw_dlg15_origin_x_hi
  sta sw_cam_origin_x_hi
  lda <sw_dlg15_origin_y_lo
  sta sw_cam_origin_y_lo
  lda <sw_dlg15_origin_y_hi
  sta sw_cam_origin_y_hi
sw_dlg_lifecycle_close_b_start:
  jsr build_oam
  jsr draw_entities
  .if !BATTLE_ENABLED
  jsr draw_hud
  .endif
sw_dlg_lifecycle_close_b_end:
  dec <cam_dirty
  lda #0
  sta sw_dlg17_camhold
  lda #SW_DLG15_IDLE
  sta <sw_dlg15_state
; Phase 2 slice 9 -- close-for-Save. A deferred Save's own draw-down is
; acknowledged the same way a close-for-Move one is (sw_dlg15_state just
; reached IDLE, above), but this routine does not resolve it -- it only
; leaves game_state/script_active/script_ptr/talk_ent exactly as script_op_
; save's own dispatch (engine/save.asm) left them and returns, the same
; "acknowledge here, resolve on a later poll" split sw_dlg_closeformove_
; check's own move_finish half already uses. ui_tick (engine/ui.asm) is
; that poll: it runs the real commit once it sees this flag set with sw_
; dlg15_state back at IDLE. Checked before the MOVE_ENABLED branch below
; because a Save's own close never touches sw_dlg17_move_close (and vice
; versa) but a project can have SAVE_FLASH without MOVE_ENABLED at all, so
; this cannot be folded into sw_dlg_closeformove_check's own MOVE_ENABLED-
; gated body.
  .if SW_DLG_BANKED
  rts                       ; the shim resolves the deferred Save / Move / close_ui
  .else
sw_dlg17cr_save_check_start:
  .if SAVE_FLASH
  lda sw_dlg20_save_pending
  beq sw_dlg17cr_no_save
  rts
sw_dlg17cr_no_save:
  .endif
sw_dlg17cr_save_check_end:
; Phase 2 slice 8 -- close-for-Move. Whichever target this jmps to, it is
; one 3-byte JMP absolute either way, so this line costs the
; sw_dlg_origin_capture..sw_dlg_relocated_start span (measured above,
; STREAMWORLD_DIALOGUE_LIFECYCLE_TERRAIN_CONSUMER_KERNEL_HI_ALLOWANCE_BY_
; GAME_TYPE) nothing whether or not MOVE_ENABLED -- sw_dlg_closeformove_check
; itself lives out of line, after sw_dlg_relocated_end, and is counted by
; its own separate STREAMWORLD_CLOSEFORMOVE_KERNEL_HI_ALLOWANCE.
  .if MOVE_ENABLED
  jmp sw_dlg_closeformove_check
  .else
  jmp close_ui
  .endif
sw_dlg17cr_done:
  rts
  .endif

; ==========================================================================
; Fix round 1 (review round 1, finding A4): six text.asm call sites --
; text_open_row, text_open_attr, text_put_char, text_clear_step,
; text_choice_step, text_close_attr -- kept only a 7-byte kernel-lo dispatch
; (`lda <map_is_streamed / beq ordinary / jmp` here); this is where their
; bodies actually live now. Fix round 2 (review round 2, finding A4):
; finished the same relocation for the remaining six sites Chris's
; 2026-09-25 ruling also named -- box_begin, text_tick, text_arrow_write,
; choice_cursor, text_close_step, text_close_attr_tail -- so all thirteen
; kernel-lo call sites (the twelve in text.asm plus boot.asm's own
; camrelease_call) now hold only their own small dispatch. Each relocated
; body is byte-for-byte the guard body text.asm used to hold inline, only
; relocated -- every jmp back into text.asm targets the exact label the
; inline version fell through to (a bare conditional branch back to a
; text.asm label would be out of range from here -- CLAUDE.md's own "branches
; are +-128 bytes" trap -- so every one of these ends in a jmp, or, where the
; original body itself branched into two different distant continuations
; (sw_dlg_hi_text_tick, sw_dlg_hi_close_attr_tail), a short LOCAL branch to a
; second local label that then jmps). sw_dlg_relocated_start/_end brackets
; the combined span of all twelve -- STREAMWORLD_DIALOGUE_RELOCATED_KERNEL_HI_
; ALLOWANCE (main/build/generate.js), a THIRD term kept apart from both the
; 7a mapper allowance and this fix round's own lifecycle-hi allowance above,
; since it is neither: it is the kernel-lo bytes A4 moved, not new bytes A1/
; A2 added.
; ==========================================================================
sw_dlg_relocated_start:
  .if SW_DLG_BANKED
sw_dlg_be_open_row:
  .else
sw_dlg_hi_open_row:
  .endif
  lda <tmp
  sta <sw_dlgw_edge
  lda <tmp2
  sta <sw_dlgw_fill
  lda <box_row
  jsr sw_dlg_write_border
  jmp text_open_row_done

; Fix round 1 (A6): contract §7 (docs/design-streamed-worlds.md) requires six
; row frames PLUS THREE attribute frames -- one band per frame -- not all
; three bands queued in a single frame the way the pre-fix body here did.
; box_row already tracks exactly this: text_open_step keeps calling here on
; every frame box_row is >= BOX_ROWS_HIGH, so this routine reads the same
; register text_open_row_dispatch already reads to tell rows apart, and
; steps its OWN one band per call, `inc <box_row` (or `jmp box_handover`,
; which resets it to 0 itself) instead of the caller. sw_dlg_attr_precompute
; still runs exactly once, on the first of the three calls, per its own
; header requirement.
  .if SW_DLG_BANKED
sw_dlg_be_open_attr:
  .else
sw_dlg_hi_open_attr:
  .endif
  lda <box_row
  cmp #BOX_ROWS_HIGH
  bne sw_dlg_hi_open_attr_1
  jsr sw_dlg_attr_precompute
  lda #0
  jsr sw_dlg_attr_open_band
  inc <box_row
  rts
sw_dlg_hi_open_attr_1:
  cmp #BOX_ROWS_HIGH+1
  bne sw_dlg_hi_open_attr_2
  lda #1
  jsr sw_dlg_attr_open_band
  inc <box_row
  rts
sw_dlg_hi_open_attr_2:
  lda #2
  jsr sw_dlg_attr_open_band
  inc <box_row
  jmp box_handover

  .if SW_DLG_BANKED
sw_dlg_be_put_char:         ; H4: the glyph rode across call_battle in bt_arg
  lda <bt_arg
  pha
  .else
sw_dlg_hi_put_char:
  .endif
  lda <msg_line
  clc
  adc #1                    ; tile row 1-4 -- the four interior text rows
  pha
  lda <msg_col
  clc
  adc #2                    ; tile col 2-29 -- BOX_TEXT_LO's own col
  tax                       ; component (2), never overflowing 32
  pla
  jmp sw_dlg_single

  .if SW_DLG_BANKED
sw_dlg_be_clear_step:
  .else
sw_dlg_hi_clear_step:
  .endif
  lda <box_row
  clc
  adc #1
  ldx #2
  jsr sw_dlg_run_open
  ldy #BOX_COLS
sw_dlg_hi_clear_loop:
  lda #TILE_SPACE
  jsr sw_dlg_run_push
  dey
  bne sw_dlg_hi_clear_loop
  jsr vram_end
  jmp text_clear_step_done

  .if SW_DLG_BANKED
sw_dlg_be_choice_step:
  .else
sw_dlg_hi_choice_step:
  .endif
  lda <box_row
  clc
  adc #1
  ldx #2
  jsr sw_dlg_run_open
  lda #BOX_COLS
  sta <box_col
  ldy #0
sw_dlg_hi_choice_glyph:
  lda [msg_ptr_lo],y
  beq sw_dlg_hi_choice_drawn
  jsr sw_dlg_run_push       ; preserves Y, which is walking the label
  iny
  dec <box_col
  bne sw_dlg_hi_choice_glyph
sw_dlg_hi_choice_drawn:
  jsr vram_end
  jmp text_choice_blank

; Fix round 1 (A6): the close-side twin of sw_dlg_hi_open_attr's own fix
; above -- one band per frame, paced off the same box_row range
; text_close_step already dispatches through. sw_dlg_attr_close_band reuses
; sw_dlg_attr_precompute's open-time results (its own header: one precompute
; per open/close transaction), so no precompute call belongs here.
  .if SW_DLG_BANKED
sw_dlg_be_close_attr:
  .else
sw_dlg_hi_close_attr:
  .endif
  lda <box_row
  cmp #BOX_ROWS_HIGH
  bne sw_dlg_hi_close_attr_1
  lda #0
  jsr sw_dlg_attr_close_band
  inc <box_row
  rts
sw_dlg_hi_close_attr_1:
  cmp #BOX_ROWS_HIGH+1
  bne sw_dlg_hi_close_attr_2
  lda #1
  jsr sw_dlg_attr_close_band
  inc <box_row
  rts
sw_dlg_hi_close_attr_2:
  lda #2
  jsr sw_dlg_attr_close_band
  inc <box_row
  .if SW_DLG_BANKED
  ; text_close_attr_tail's own first two lines, inline: jumping to it would
  ; re-dispatch through the resident shim and call_battle a second time from
  ; inside the bank. Everything after them is sw_dlg_hi_close_attr_tail, in-bank.
  lda #BOX_CLOSED
  sta <box_state
  jmp sw_dlg_be_close_attr_tail
  .else
  jmp text_close_attr_tail
  .endif

; Fix round 2 (review round 2, finding A4): the six remaining relocated
; bodies -- box_begin, text_tick, text_arrow_write, choice_cursor,
; text_close_step, text_close_attr_tail. Each is byte-for-byte the guard
; body text.asm used to hold inline.
  .if SW_DLG_BANKED
sw_dlg_be_box_begin:
  .else
sw_dlg_hi_box_begin:
  .endif
  lda #SW_DLG15_PENDING     ; defer the open until sw_dlg15_pending_step's
  sta <sw_dlg15_state        ; own strip-idle wait and camera nudge run
  rts

; text_tick's own body branched to TWO different distant text.asm
; continuations depending on sw_dlg15_state (the ordinary fallthrough, or a
; tail call into sw_dlg15_pending_step) -- neither is reachable by a bare
; conditional branch from here, so the PENDING check itself stays a local
; branch (to a second local label, within range) and each of the two real
; destinations is reached by its own jmp.
  .if SW_DLG_BANKED
  ; Banked placement: the PENDING test itself is resident (engine/streamworld.asm,
  ; sw_dlg_hi_text_tick) so an ordinary typing/opening frame pays no bank switch;
  ; only a PENDING frame enters sw_dlg15_pending_step, as BE_DLG_PENDING.
  .else
sw_dlg_hi_text_tick:
  lda <sw_dlg15_state
  cmp #SW_DLG15_PENDING
  beq sw_dlg_hi_text_tick_pending
  jmp text_tick_ordinary    ; IDLE or DRAINING -- DRAINING's own completion
                            ; is main_loop_idle's sw_dlg17_camrelease, not
                            ; this per-tick dispatch; box_state is already 0
                            ; throughout both, so falling through here is
                            ; already exactly "waiting"
sw_dlg_hi_text_tick_pending:
  jmp sw_dlg15_pending_step  ; tail call -- its own rts answers for ours
  .endif

  .if SW_DLG_BANKED
sw_dlg_be_arrow_write:      ; H4: the arrow tile rode across in bt_arg
  lda <bt_arg
  pha
  .else
sw_dlg_hi_arrow_write:
  .endif
  lda #4                    ; ARROW_LO (158) -- fixed tile row 4, col 30
  ldx #30
  jmp sw_dlg_single

  .if SW_DLG_BANKED
sw_dlg_be_choice_cursor:    ; H4: the cursor tile rode across in bt_arg
  lda <bt_arg
  pha
  .else
sw_dlg_hi_choice_cursor:
  .endif
  lda <choice_sel
  clc
  adc #1                    ; tile row 1-4, same four rows text_put_char uses
  ldx #1                    ; the padding column, left of the text (BOX_TEXT_LO-1)
  jmp sw_dlg_single

  .if SW_DLG_BANKED
sw_dlg_be_close_step:
  .else
sw_dlg_hi_close_step:
  .endif
  lda <box_row
  jsr sw_dlg_close_row
  jmp text_close_step_done

; text_close_attr_tail's own body: a session that never engaged the streamed
; camera-hold (in-game naming's own raise never floors the camera -- it
; never goes through box_begin/sw_dlg15_pending_step at all) has nothing for
; sw_dlg17_camrelease to resolve later; close immediately, exactly as an
; ordinary (non-streamed) close already would. The camhold check's own
; false branch used to fall straight into text_close_attr_done -- out of
; range from here, so it goes through a local label first.
  .if SW_DLG_BANKED
sw_dlg_be_close_attr_tail:
  .else
sw_dlg_hi_close_attr_tail:
  .endif
  lda sw_dlg17_camhold
  beq sw_dlg_hi_close_attr_tail_done
  lda #SW_DLG15_DRAINING
  sta <sw_dlg15_state
  rts
sw_dlg_hi_close_attr_tail_done:
  jmp text_close_attr_done
sw_dlg_relocated_end:

  .if SW_DLG_BANKED
; --------------------------------------------------------------------------
; battle_entry's own dispatch for the BE_DLG_* entry points (engine/battle.asm
; sends every bt_call >= BE_DLG_FIRST here). The RTS trick, so no zero-page
; scratch is needed and Y survives: each table word is the entry's address - 1.
; Order == the BE_DLG_* order in engine/constants.asm (the wire format).
; --------------------------------------------------------------------------
be_dlg_dispatch:
  sec
  sbc #BE_DLG_FIRST
  asl a
  tax
  lda be_dlg_table+1,x
  pha
  lda be_dlg_table,x
  pha
  rts
be_dlg_table:
  .dw sw_dlg_be_open_row-1       ; BE_DLG_OPEN_ROW
  .dw sw_dlg_be_open_attr-1      ; BE_DLG_OPEN_ATTR
  .dw sw_dlg_be_put_char-1       ; BE_DLG_PUT_CHAR
  .dw sw_dlg_be_clear_step-1     ; BE_DLG_CLEAR_STEP
  .dw sw_dlg_be_choice_step-1    ; BE_DLG_CHOICE_STEP
  .dw sw_dlg_be_close_attr-1     ; BE_DLG_CLOSE_ATTR
  .dw sw_dlg15_pending_step-1    ; BE_DLG_PENDING
  .dw sw_dlg_be_arrow_write-1    ; BE_DLG_ARROW
  .dw sw_dlg_be_choice_cursor-1  ; BE_DLG_CURSOR
  .dw sw_dlg_be_close_step-1     ; BE_DLG_CLOSE_STEP
  .dw sw_dlg_be_close_attr_tail-1 ; BE_DLG_CLOSE_TAIL
  .dw sw_dlg_be_box_begin-1      ; BE_DLG_BOX_BEGIN
  .dw sw_dlg_be_camrelease-1     ; BE_DLG_CAMRELEASE
sw_dlg_banked_end:
  .endif
