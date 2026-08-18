; NES Game Forge -- template engine (top-down adventure).
;
; The cartridge type is chosen per project and generated into
; assets/cartridge.inc by main/build/generate.js, whose facts come from
; shared/cartridge.js. Never write .ines* directives here: the UI, the capacity
; math and the header would then have three separate definitions of the mapper.
;
; A CHR bank is 8 KB, which is exactly the two 256-tile pattern tables the Forge
; edits -- one tileset. Mappers that switch CHR can hold several.
;
; PRG layout. Every cartridge the Forge supports uses the same shape, which is
; what lets one template serve a banked ROM and an unbanked one:
;
;   $8000-$BFFF  switchable window -- screen data only, one 16 KB bank at a time
;   $C000-$DFFF  fixed kernel      -- lookup tables, then engine code
;   $E000-$FFFF  fixed kernel      -- music and text data, then the CPU vectors
;
; The kernel is the LAST 16 KB, which is the bank every one of these mappers
; leaves permanently mapped. Anything the engine may touch at an arbitrary moment
; -- tables, music, code -- therefore lives there; only bulk screen data is
; banked. That is why `set_screen_ptr` is the single place a PRG bank is selected.
;
; NROM is the degenerate case: its one switchable bank never needs switching, so
; the generated screen_bank table is all zeroes and switch_prg_bank is an `rts`.
;
; The .bank/.org directives are generated (assets/kernel_*.inc, assets/screens.inc)
; because which nesasm bank is "last" depends on the mapper's PRG size.

  .include "assets/cartridge.inc"

  .include "constants.asm"
  .include "assets/config.inc"

; --------------------------------------------------- switchable screen data

  .include "assets/chrram.inc"
  .include "assets/code.inc"
  .include "assets/screens.inc"

; ------------------------------------------- fixed kernel: tables and code

  .include "assets/kernel_lo.inc"
  .include "assets/palettes.inc"
  .include "assets/metatiles.inc"
  .include "assets/sprites.inc"
  .include "assets/input.inc"
  .include "assets/maps.inc"
  .include "assets/chrtables.inc"
  .include "boot.asm"
  .include "banks.asm"
  .include "split.asm"
  .include "screens.asm"
  .include "player.asm"
  .include "entities.asm"
  .include "oam.asm"
  .include "ui.asm"
  .include "combat.asm"
  .include "title.asm"
  .include "rpg.asm"
  .include "flash.asm"
; The check that actually closes the "something got appended to the
; driver's tail" gap flash.asm's own comment (beside flash_commit_driver_end)
; explains: placed here, after the whole file has already been assembled
; rather than inside flash.asm's own .if SAVE_FLASH block, it sees the
; location counter's *final* value for that file -- appended code
; anywhere inside it, however far past flash_commit_driver_end, has
; already been counted by the time this runs, which a check living inside
; the file itself could never guarantee about content placed after its own
; line. Two one-directional comparisons rather than a single `!=`, the same
; restricted comparison nesasm's expression grammar already proves it
; accepts (flash.asm's own driver-size guard uses `>` the same way).
  .if SAVE_FLASH
  .if * > flash_commit_driver_end
  .fail
  .endif
  .if flash_commit_driver_end > *
  .fail
  .endif
  .endif
  .include "save.asm"
  .include "text.asm"
  .include "script.asm"
  .include "input.asm"
  .include "music.asm"
; The Code Forge's own files, last so they can call anything above them. Always
; generated -- empty for a project that has none.
  .include "assets/usercode.inc"

; -------------------------- fixed kernel: music and text, then the vectors

  .include "assets/kernel_hi.inc"
  .include "assets/music.inc"
  .include "assets/text.inc"

  .org $FFFA
  .dw nmi
  .dw reset
  .dw irq

; ---------------------------------------------------------------- CHR-ROM
; One .bank per 8 KB tileset, generated because the count is per project.

  .include "assets/chr.inc"
