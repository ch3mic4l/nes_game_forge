; flash.asm -- the RAM-resident driver that erases and programs UNROM 512's
; own SST39SF040 flash chip, for the flash medium's save (engine/save.asm's
; save_media_commit).
;
; During a program or erase the chip drives status on *every* read of its
; own address space -- $8000-$FFFF, the fixed bank included, since both
; halves are the same physical chip (see mapper30.js's own comment). An
; instruction fetch from there mid-operation reads that status as if it
; were an opcode, which is not a data-corruption bug so much as the CPU
; itself derailing. So flash_commit_driver below never runs from ROM: it is
; assembled at an ordinary $Cxxx address purely so the copy loop in
; save_media_commit has real bytes to read, then copied verbatim to
; flash_driver ($0600, engine/constants.asm) and invoked with JSR there --
; every instruction in it actually executes out of console RAM, which
; $8000-$FFFF's busy overlay cannot touch.
;
; That gives this file exactly one rule, and it is a real constraint on
; every future edit here, not a one-time concern: **no absolute reference to
; this block's own internal labels.** Assembled at $Cxxx but run from
; $0600, a `JMP`/`JSR` straight to one of its own labels encodes that
; label's *ROM* address -- correct only there, and wrong the instant this
; runs relocated, jumping straight back into the fixed bank mid-operation
; and reading chip status as code, exactly the failure this whole file
; exists to avoid. Two techniques stay safe under relocation because
; neither one bakes in an absolute address at all:
;
;   - Relative branches (`BNE`/`BEQ`/...) -- the operand is a signed offset
;     from the branch, not a destination, so it is correct wherever the
;     branch itself ends up.
;   - `JSR $0600+(label-flash_commit_driver)` -- the *target* is a compile-
;     time constant (flash_driver plus the label's own offset from this
;     block's start), not the label's ROM address, so it points at exactly
;     where the copy will actually put that code. Proved against the real
;     core in test/unit/flashdriver.test.js before this was trusted to
;     carry the real unlock/erase/program sequence below.
;
; RTS is the one exception, and it is safe for the opposite reason: it pops
; whatever address JSR pushed, which -- for the one JSR that reaches this
; block at all, save_media_commit's own `jsr flash_driver` -- is always the
; wrapper's own correctly-addressed ROM location. Nothing in here ever JSRs
; into itself expecting a *matching* RTS to come back to a *relocated*
; address; every internal call above returns to its own caller inside this
; same block, which is exactly what the $0600-relative JSR already points
; at.
;
; See CLAUDE.md's "6502 traps this codebase has already hit" for the nesasm
; side of why this file cannot just reserve a fixed ROM offset and address
; it directly instead: a backward `.org` silently splices bytes into
; whatever already assembled there, with no error and no warning.
;
; Register discipline, the MMC3 scanline-split sense of the phrase
; (engine/split.asm): every raw $C000 write below only ever runs with
; rendering off, NMI genuinely disabled and IRQ masked (save_media_commit's
; job, not this file's), and writes straight to $C000 rather than through
; write_mapper_reg's identity-table trick -- that trick's bus-conflict
; avoidance reads the very ROM byte this operation may be mid-erasing, and
; the flashable configuration this file only ever runs under does not need
; it anyway (bus-conflict-free, unlike the plain register wiring
; write_mapper_reg exists for). mapper_shadow is deliberately left stale by
; every write in here -- save_media_commit resyncs it, and the real
; register, in one write_mapper_reg call once this returns, back in ROM
; where that call's own ROM read is safe again.
;
; The sector address is not a parameter anywhere in this file. SAVE_BANK
; and the $B000 base are compile-time constants baked into the instruction
; stream itself (`LDA #SAVE_BANK`, `STA $B000`), not values read out of a
; register or RAM a corrupted call could hand this the wrong ones for --
; the same "takes no sector address" guarantee that rules out a bad
; argument is what having no argument at all means.

  .if SAVE_FLASH

flash_commit_driver:
  ; --- erase the 4 KB sector at bank SAVE_BANK's $B000-$BFFF --------------
  jsr $0600+(fd_unlock-flash_commit_driver)
  lda #$80
  jsr $0600+(fd_cmd5555-flash_commit_driver)
  jsr $0600+(fd_unlock-flash_commit_driver)
  lda #SAVE_BANK
  sta $C000
  lda #$30
  sta $B000
  jsr $0600+(fd_poll-flash_commit_driver)

  ; --- program SAVE_RECORD_LEN bytes from the RAM buffer -------------------
  ; save_flash_buf (engine/constants.asm) is SAVE_BASE for a flash build --
  ; the record save_write_body just finished composing there, marker already
  ; restored to SAVE_MARKER_VALID by script_op_save (engine/save.asm) before
  ; this driver was ever invoked -- the chip only ever receives a complete,
  ; already-valid buffer to program, never the RAM copy's own briefly
  ; invalidated marker from earlier in that sequence.
  ;
  ; This loop runs x ascending, 0 to SAVE_RECORD_LEN-1, and that direction is
  ; not incidental: SAVE_MARKER is generated as the record's last byte
  ; (main/build/generate.js: `SAVE_BASE + saveBodyLen + 6`, one past
  ; SAVE_RECORD_LEN's own `saveBodySize() + 7`), so ascending here means the
  ; marker is the last byte this loop ever programs. That is what makes a
  ; tear *during this loop* -- once the erase above has already finished --
  ; safe in the strong sense: this sector's erase clears every byte to $FF,
  ; byte programming can only clear bits further (never set one, see
  ; fd_unlock's own header and mapper30.js's programFlashByte), and
  ; save_check_valid accepts only an exact SAVE_MARKER_VALID byte -- so power
  ; lost anywhere in this loop up to and including its second-to-last byte
  ; leaves the marker at $FF, and the next boot reads that as *no save*, not
  ; as a save silently loaded wrong.
  ;
  ; The erase above is a different risk this loop's own ordering does not
  ; cover, and by duration it is the *larger* one, not a narrower one: the
  ; SST39SF040 datasheet gives 18 ms typical / 25 ms maximum for the sector
  ; erase against roughly 1.2-1.7 ms of device time for this loop's own 87
  ; byte-program cycles (14-20 us each), so the erase is most of the
  ; commit's real-world 24-32 ms window (phase 2.4's own review, CLAUDE.md),
  ; not a brief prelude to it. It is also not instantaneous or ordered in
  ; any way this engine controls, so a tear mid-erase can leave the
  ; *previous* commit's own SAVE_MARKER_VALID byte still reading valid
  ; while some of the body underneath it has already gone to $FF. That
  ; record can present as valid-looking with a corrupted body -- what
  ; stands between that and a load applying wrong values is
  ; save_check_valid's identity, checksum and range gates (engine/save.asm's
  ; own header), which is real, layered defence and not nothing, but is
  ; explicitly not a proof against every case (see that header's own
  ; admission on checksum/identity coincidences and wrong-but-in-range
  ; values). So the honest claim spans both phases:
  ; a tear during this program loop cannot produce a corrupt save; a tear
  ; during the erase is subjected to validation that will normally catch
  ; it, which is strong but not airtight. Not "always no save, never a
  ; broken one" for the commit as a whole -- only for the phase this loop's
  ; own ordering actually covers.
  ; This comment has been wrong about that scope twice already, in opposite
  ; directions -- first claiming the guarantee held for "any" tear, then
  ; correcting that but calling the erase the "narrower" risk when it is
  ; the larger one by duration. Both times the error was in an unquantified
  ; comparative word standing in for a number that was available the whole
  ; time (the datasheet timings above). Where a number exists, use it;
  ; where one genuinely does not, say so rather than implying a magnitude.
  ;
  ; A slot ring or an atomic two-sector journal would remove the erase
  ; window's own risk entirely; CLAUDE.md records why phase 2.4 costed both
  ; and built neither. This loop's ordering is what makes living without one
  ; tolerable for the phase it covers, and it is two independent facts --
  ; the generated layout above, and this loop's own direction -- that happen
  ; to agree rather than anything that enforces the other.
  ; test/unit/flashmarkerorder.test.js pins both halves and negative-controls
  ; each: reversing this loop, or moving the marker off the record's end,
  ; fails its own test for its own reason.
  ldx #0
fd_program_loop:
  jsr $0600+(fd_unlock-flash_commit_driver)
  lda #$A0
  jsr $0600+(fd_cmd5555-flash_commit_driver)
  lda #SAVE_BANK
  sta $C000
  lda save_flash_buf,x
  sta $B000,x
  jsr $0600+(fd_poll-flash_commit_driver)
  inx
  cpx #SAVE_RECORD_LEN
  bne fd_program_loop
  rts

; The SST39SF040's JEDEC unlock: chip address $5555 <- $AA, then $2AAA <-
; $55. The chip only decodes A0-A14, so which CPU address reaches each one
; depends on the bank register's own low bit -- bank 1 puts $5555 at CPU
; $9555, bank 0 puts $2AAA at $AAAA (mapper30.js's own comment on why;
; test/unit/mapper30.test.js's chipWrite/unlock is the reference this
; mirrors exactly). Selects both banks itself; never assumes which one a
; caller already left selected.
fd_unlock:
  lda #1
  sta $C000
  lda #$AA
  sta $9555
  lda #0
  sta $C000
  lda #$55
  sta $AAAA
  rts

; A = the command byte for chip address $5555 (erase setup $80, program
; setup $A0) -- the third write of an unlock sequence, always at $5555, so
; always bank 1. Stacks A across its own bank-select write rather than
; assuming the caller's A survives one.
fd_cmd5555:
  pha
  lda #1
  sta $C000
  pla
  sta $9555
  rts

; DQ6-toggle poll of $B000: two reads that keep disagreeing on bit 6 mean
; the chip is still busy: with SAVE_BANK selected, $B000 is the *fixed*
; sector base regardless of whether the current operation is the sector
; erase above or one of the byte programs in the loop, so one poll routine
; serves both.
fd_poll:
  lda $B000
  eor $B000
  and #$40
  bne fd_poll
  rts

; A real label, not just `*` inline below -- the single writer for where the
; driver ends, so the copy loop's own length and anything outside this file
; that needs the driver's exact span (test/unit/flashdriver.test.js's
; relocation test) read the same boundary rather than each assuming a
; different "next thing" marks it. save.asm's save_checksum happens to
; follow directly today, but "whatever assembles next" is not this file's
; promise to keep, and was never meant to be one.
flash_commit_driver_end:

; A build-time tripwire, not a guess left to chance: fails the build loudly
; (see CLAUDE.md on nesasm's own "exits 0 anyway" quirk, and why
; main/build/nesasm.js falls back to its error count instead of trusting
; the exit code) the moment flash_commit_driver would no longer fit the RAM
; engine/constants.asm reserved for it, rather than silently letting the
; copy loop in save_media_commit read past the driver's own end.
flash_commit_driver_len = flash_commit_driver_end - flash_commit_driver
  .if flash_commit_driver_len > FLASH_DRIVER_MAX
  .fail
  .endif

; The one check that would matter most here -- the location counter, at the
; very end of everything this file assembles, still equals
; flash_commit_driver_end -- is deliberately NOT here. A check placed inside
; this file's own .if SAVE_FLASH block can only ever verify the counter's
; value at its own line; it has no way to see anything appended after
; itself but still before this block's own .endif, so a stray instruction
; there would execute entirely unchecked by it -- agreeing with the source
; scan on a premature marker rather than catching the disagreement. Placed
; instead in engine/main.asm, right after `.include "flash.asm"`, the same
; comparison runs only once this file's *entire* content -- however it
; ends, appended code included -- has already been assembled, which is what
; actually closes that gap: nothing in this file can escape being counted
; before control returns there. See that check's own comment for the rest.

  .endif
