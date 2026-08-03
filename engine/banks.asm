; banks.asm -- CHR bank switching.
;
; One tileset is one 8 KB CHR bank (a background table plus a sprite table, which
; the hardware switches together). Which mapper is in use comes from the
; generated assets/config.inc; shared/cartridge.js is the single writer for that
; choice.
;
; Every discrete mapper this engine supports -- CNROM, GxROM, Color Dreams --
; selects a CHR bank by writing one byte anywhere in $8000-$FFFF, differing only
; in which bits carry the bank number. So the routine below is mapper-agnostic:
; the generated chr_bank_values table already holds the right byte for each
; tileset, and adding another such mapper needs no code here at all.
;
; Writing a table entry back over itself does double duty. On real hardware a
; write to ROM fights whatever the ROM is driving onto the bus; storing the value
; the ROM already holds at that address means the two agree, which is the
; standard bus-conflict avoidance for these boards.
;
; MMC1 and MMC3 do not work that way -- a serial shift register and a register pair
; respectively -- so they get their own blocks below.
;
; Every variant takes the tileset number in A and may clobber A, X and mmc_tmp.

  .if CHR_SWITCH_TABLE
  .include "assets/banktable.inc"

switch_chr_bank:
  cmp #NUM_TILESETS
  bcc switch_chr_table_ok
  lda #0                    ; a screen pointing past the last tileset uses the first
switch_chr_table_ok:
  tax
  lda chr_bank_values,x
  sta chr_bank_values,x
  rts
  .endif

  .if CHR_SWITCH_MMC1
; $A000 is MMC1's CHR bank-0 register, loaded serially like all of them. mmc1_init
; puts the control register in 8 KB CHR mode, where this register's low bit is
; ignored -- hence the shift, turning a tileset number into a 4 KB bank index.
switch_chr_bank:
  cmp #NUM_TILESETS
  bcc switch_chr_mmc1_ok
  lda #0
switch_chr_mmc1_ok:
  asl a
  sta mmc_tmp
  ldx #5
mmc1_chr_loop:
  lda mmc_tmp
  sta $A000                 ; only bit 0 is taken
  lsr a
  sta mmc_tmp
  dex
  bne mmc1_chr_loop
  rts
  .endif

  .if CHR_SWITCH_MMC3
; In MMC3's CHR mode 0, $0000-$1FFF is covered by six registers: R0 and R1 are
; 2 KB, R2-R5 are 1 KB. An 8 KB tileset is eight consecutive 1 KB banks spread over
; those six registers at the offsets below.
mmc3_chr_offsets:
  .db 0, 2, 4, 5, 6, 7

switch_chr_bank:
  cmp #NUM_TILESETS
  bcc switch_chr_mmc3_ok
  lda #0
switch_chr_mmc3_ok:
  asl a
  asl a
  asl a                     ; tileset -> first of its eight 1 KB banks
  sta mmc_tmp
  .if SPLIT_ENABLED
  clc                       ; the split's interrupts need to know what "the
  adc #2                    ; map's own art" means for R1 -- see split.asm
  sta chr_r1
  .endif
  ldx #0
mmc3_chr_loop:
  txa
  sta $8000                 ; registers 0-5 are the CHR slots, in order
  lda mmc_tmp
  clc
  adc mmc3_chr_offsets,x
  sta $8001
  inx
  cpx #6
  bne mmc3_chr_loop
  rts
  .endif

  .if CHR_SWITCH_UNROM512
; UNROM 512 has one register carrying both the PRG bank (bits 0-4) and the CHR-RAM
; page (bits 5-6), so neither can be set without knowing the other. mapper_shadow
; holds the last value written; each routine rewrites the whole byte.
switch_chr_bank:
  cmp #NUM_TILESETS
  bcc switch_chr_u512_ok
  lda #0
switch_chr_u512_ok:
  and #$03
  asl a
  asl a
  asl a
  asl a
  asl a                     ; tileset -> bits 5-6
  sta mmc_tmp
  lda mapper_shadow
  and #$1F                  ; keep the PRG bank
  ora mmc_tmp
  jmp write_mapper_reg
  .endif

  .if CHR_SWITCH_NONE
; NROM and UxROM have exactly one CHR bank, so selecting it is a no-op. The routine
; still exists so screens.asm need not know which mapper it was built for.
switch_chr_bank:
  rts
  .endif

; ------------------------------------------------------- PRG bank switching
;
; Selects the 16 KB window at $8000-$BFFF, which holds screen data. The kernel is
; in the fixed last bank, so this never moves the code out from under itself.
;
; Only ever called with a value from the generated screen_bank table, so no range
; check is needed: the generator cannot emit a bank the cartridge lacks.

  .if PRG_SWITCH_SIMPLE
; UxROM: write the bank number anywhere in $8000-$FFFF. The identity table gives
; the same bus-conflict avoidance as the CHR path -- the byte written matches the
; byte the ROM is already driving.
prg_bank_identity:
  .db 0, 1, 2, 3, 4, 5, 6, 7
  .db 8, 9, 10, 11, 12, 13, 14, 15
  .db 16, 17, 18, 19, 20, 21, 22, 23
  .db 24, 25, 26, 27, 28, 29, 30, 31

switch_prg_bank:
  tax
  lda prg_bank_identity,x
  sta prg_bank_identity,x
  rts
  .endif

  .if PRG_SWITCH_MMC1
; MMC1 has no parallel register: each of its four registers is loaded one bit at a
; time, low bit first, by five writes to an address in that register's range. PRG
; bank select is $E000-$FFFF.
;
; Bit 7 set on any write resets the shift register, so the sequence must not be
; interrupted by anything that also writes $8000-$FFFF. Nothing here does.
;
; MMC1 is left in its power-on PRG mode: 16 KB switchable at $8000 with the last
; bank fixed at $C000, which is the layout the engine template assumes.
switch_prg_bank:
  sta mmc_tmp
  ldx #5
mmc1_prg_loop:
  lda mmc_tmp
  sta $E000                 ; only bit 0 is taken
  lsr a
  sta mmc_tmp
  dex
  bne mmc1_prg_loop
  rts
  .endif

  .if PRG_SWITCH_MMC3
; MMC3 uses a register pair: write which register to load at $8000, then the value
; at $8001. Register 6 is the 8 KB PRG bank at $8000 and register 7 is the 8 KB at
; $A000, so one 16 KB "bank" here is two consecutive 8 KB MMC3 banks.
;
; The engine template needs $C000-$FFFF fixed, which is MMC3's PRG mode 0 -- the
; power-on default, set explicitly in mmc3_init so a soft reset cannot leave the
; other mode selected.
switch_prg_bank:
  asl a                     ; 16 KB bank -> the first of its two 8 KB banks
  sta mmc_tmp               ; shared scratch; only one mapper family is ever built
  lda #6
  sta $8000
  lda mmc_tmp
  sta $8001
  lda #7
  sta $8000
  lda mmc_tmp
  clc
  adc #1
  sta $8001
  rts

; Called from boot: PRG mode 0 (fixed $C000), and the CHR/IRQ state left alone.
mmc3_init:
  lda #$00
  sta $8000                 ; register 0, PRG mode 0, CHR mode 0
  rts
  .endif

  .if PRG_SWITCH_UNROM512
switch_prg_bank:
  and #$1F
  sta mmc_tmp
  lda mapper_shadow
  and #$E0                  ; keep the CHR page and the mirroring bit
  ora mmc_tmp
  jmp write_mapper_reg

; A = the whole register value. The identity table is 128 bytes of `.db i` in the
; FIXED kernel, so writing an entry back over itself both selects the bank and
; matches what the ROM is driving onto the bus. It must not live in the switchable
; window, or the write would swap the table out from under the read.
write_mapper_reg:
  sta mapper_shadow
  tax
  lda unrom512_identity,x
  sta unrom512_identity,x
  rts

unrom512_identity:
  .db $00,$01,$02,$03,$04,$05,$06,$07,$08,$09,$0A,$0B,$0C,$0D,$0E,$0F
  .db $10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$1A,$1B,$1C,$1D,$1E,$1F
  .db $20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$2A,$2B,$2C,$2D,$2E,$2F
  .db $30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$3A,$3B,$3C,$3D,$3E,$3F
  .db $40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$4A,$4B,$4C,$4D,$4E,$4F
  .db $50,$51,$52,$53,$54,$55,$56,$57,$58,$59,$5A,$5B,$5C,$5D,$5E,$5F
  .db $60,$61,$62,$63,$64,$65,$66,$67,$68,$69,$6A,$6B,$6C,$6D,$6E,$6F
  .db $70,$71,$72,$73,$74,$75,$76,$77,$78,$79,$7A,$7B,$7C,$7D,$7E,$7F
  .endif

  .if PRG_SWITCH_NONE
; One switchable bank means nothing to switch.
switch_prg_bank:
  rts
  .endif

; --------------------------------------------------------- mapper init
;
; Called once from boot, before anything reads ROM data or the PPU is enabled.
; MMC1 and MMC3 both ignore the iNES header's mirroring bit and take mirroring from
; their own registers, so the header value is passed through as MAPPER_MIRROR.

  .if PRG_SWITCH_MMC1
; Control register at $8000: bits 0-1 mirroring, bits 2-3 PRG mode, bit 4 CHR mode.
; PRG mode 3 is "switch $8000, fix the last bank at $C000" -- the layout the engine
; template requires -- and CHR mode 0 makes the CHR register select a whole 8 KB
; tileset. Bit 7 first resets the shift register in case a partial write was in
; flight at reset.
mapper_init:
  lda #$80
  sta $8000                 ; reset the serial port
  lda #($0C | MAPPER_MIRROR)
  sta mmc_tmp
  ldx #5
mmc1_ctrl_loop:
  lda mmc_tmp
  sta $8000
  lsr a
  sta mmc_tmp
  dex
  bne mmc1_ctrl_loop
  rts
  .endif

  .if PRG_SWITCH_MMC3
mapper_init:
  jsr mmc3_init
  lda #MAPPER_MIRROR        ; $A000 bit 0: 0 vertical, 1 horizontal
  sta $A000
  lda #$00
  sta $E000                 ; acknowledge and disable the scanline IRQ
  rts
  .endif

  .if PRG_SWITCH_UNROM512
; The shadow must match the hardware before anything reads it, and the PRG bank at
; reset is not guaranteed, so write a known value: bank 0, CHR page 0. Mirroring
; comes from the header on this board, so bit 7 stays clear.
mapper_init:
  lda #0
  sta mapper_shadow
  jmp write_mapper_reg
  .endif

  .if MAPPER_INIT_NONE
; The discrete boards need no setup: the header already describes them.
mapper_init:
  rts
  .endif

; ------------------------------------------------------------ CHR-RAM upload
;
; A CHR-RAM board ships no pattern data: the tables are blank RAM at power-on and
; the program fills them. Each tileset's 8 KB payload sits in program space, so
; filling a page means selecting both that page and the payload's PRG bank -- which
; on UNROM 512 is a single register write, hence the shadow.
;
; Runs once from boot with rendering off. Pages are filled and left alone
; afterwards, so switch_chr_bank at run time is only a page select.

  .if CHR_RAM
chr_ram_init:
  ldx #0
cri_next:
  stx chr_init_idx
  txa
  jsr switch_chr_bank       ; select the destination page
  ldx chr_init_idx
  lda tileset_bank,x
  jsr switch_prg_bank       ; and the bank the payload lives in
  ldx chr_init_idx
  lda tileset_lo,x
  sta ptr_lo
  lda tileset_hi,x
  sta ptr_hi
  jsr copy_chr_page
  ldx chr_init_idx
  inx
  cpx #NUM_TILESETS
  bne cri_next
  lda #0
  jmp switch_chr_bank       ; leave page 0 live, as boot expects

; 8 KB from [ptr_lo] into $0000-$1FFF. Rendering must already be off.
copy_chr_page:
  bit $2002                 ; clear the address latch
  lda #$00
  sta $2006
  sta $2006
  ldx #32                   ; 32 x 256 bytes
ccp_page:
  ldy #0
ccp_byte:
  lda [ptr_lo],y
  sta $2007
  iny
  bne ccp_byte
  inc ptr_hi
  dex
  bne ccp_page
  rts
  .else

; A CHR-ROM board has its patterns in the cartridge already.
chr_ram_init:
  rts
  .endif

; --------------------------------------------------- the banked code region
;
; The first and only cross-bank call in this engine. The switchable window
; normally holds screen data and `player.asm` dereferences `mtptr` out of it
; every frame, so the bank must be put back before gameplay resumes -- which is
; what the `jmp set_screen_ptr` on the way out is for, and why it is a `jmp`
; rather than a `jsr` followed by an `rts`: the restore *is* the return.
;
; Assembled only for a project that reserved a code region, because there is
; nothing to call into otherwise.
  .if BATTLE_ENABLED
call_battle:                ; A = a BE_* entry point
  sta bt_call
  lda #BATTLE_BANK
  jsr switch_prg_bank
  jsr battle_entry
  jmp set_screen_ptr
  .endif
