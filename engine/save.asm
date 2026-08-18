; save.asm -- the one save slot, at SAVE_BASE, media-dependent: battery-backed
; WRAM at $6000-$7FFF, or the flash medium's RAM buffer at $0700
; (save_flash_buf, engine/constants.asm), actually persisted by
; save_media_fetch/save_media_commit below and engine/flash.asm's driver.
;
; Everything from here to those two routines addresses the record only as
; `SAVE_BASE,y` or LOW/HIGH(SAVE_BASE) -- never a literal $6000 -- which is
; what lets the same code serve both media unchanged; see save_media_fetch's
; own comment for the medium split itself.
;
; Battery WRAM is enabled once, at boot, by mapper_init (engine/banks.asm) --
; MMC3's $A001 write and MMC1's PRG-RAM-disable bit, the two register facts
; the emulator's core cannot check for you. Nothing here toggles it off again:
; once enabled it stays enabled for the cartridge's whole session, the same
; way the CHR/PRG mode bits mapper_init sets are never revisited. The flash
; medium has no such enable step -- SAVE_BASE there is ordinary RAM, always
; addressable, and it is save_media_fetch/commit's own job to move a real
; record into and out of it.
;
; The record, in address order, is the body, a two-byte checksum over it, a
; two-byte project identity, and a one-byte marker. Writing it is a four-step
; sequence and the order matters more than which byte lives where:
;
;   1. Invalidate the marker.
;   2. Write the identity (unconditionally -- see script_op_save).
;   3. Write the body.
;   4. Compute and write the checksum, then the marker, last of all.
;
; script_op_save adds a fifth step after all four, for flash only:
; save_media_commit actually programs the record built in RAM into the
; sector. On battery the first four steps *are* the whole save -- they
; already wrote directly into the medium the record lives in -- so that
; fifth step is a no-op there. That fifth step is also the one genuinely
; slow, power-loss-exposed operation this file has -- an erase-then-program
; commit spanning tens of milliseconds with rendering off, unlike the plain
; RAM writes above -- and engine/flash.asm's own header explains the second,
; independent fact (its program loop's own ascending order) that combines
; with this file's "marker last" to protect the *programming* half of that
; commit the same strong way: a tear once the erase has finished reads back
; as no save, never a corrupt one. A tear during the erase itself -- by
; duration the larger part of that commit, not a brief prelude to it -- is
; a different risk that ordering alone does not cover -- see flash.asm's
; own header for the numbers, and this file's identity/checksum/range
; gates below for what actually stands against it there.
;
; Step 1 is what makes overwriting an *existing* save interruption-safe, not
; only the very first one. Writing the marker last protects a save that has
; never succeeded before -- an old, still-valid record simply keeps reading
; as valid if the new one never finishes. But on the second save onward there
; already is an old valid record, and marker-last alone does not protect it:
; a power loss partway through step 3 leaves some of the new body sitting
; under the *old* checksum and marker, which can still agree with each other
; by coincidence (see the interruption scenario worked through in the commit
; that added this comment) without agreeing with what is actually now in the
; body. Invalidating the marker before touching anything else means that
; scenario instead leaves no valid save at all -- the previous one is lost,
; which is the deliberate trade stated here rather than left as a side
; effect: a refused save is recoverable by playing on and saving again, and a
; hybrid of two different sessions' state is not recoverable at all.
;
; A byte read out of the record is untrusted input regardless of medium: SRAM
; survives a reflash of the game, and a flash sector survives everything a
; power loss mid-erase or a hand-edited cartridge dumper can leave behind.
; Anything restored from it that is then used
; as an index -- a screen number, a party size, an actor id, a level, a
; direction, a Y coordinate -- must be checked against what *this build*
; actually has before it is used, never trusted because it came from a
; record that otherwise looked fine. save_check_valid below is where that
; happens, and it happens in two layers that are not the same mechanism:
;
; The identity (shared/save.js's saveIdentity()) folds in the project's own
; screen, map, actor and level-cap counts alongside the layout facts the
; first version of this used alone, so a save from a *differently-shaped*
; project no longer merely risks being misread as this one's -- see that
; function's own comment for the collisions it has closed, and for the one
; it still cannot: two projects that agree on every count it folds in but
; differ in content (a different actor roster of the same size, say) are
; indistinguishable to it by construction. The identity is what makes
; misapplying a foreign save *unlikely*. It is not what makes it *safe* --
; that is the range checks below, over the specific values load_apply_body
; is about to trust as table indices, and they are what stand between a
; save that passes the identity and checksum by coincidence (or by a
; hand-edit) and an out-of-bounds read. Once every restored index is
; bounded, a save that gets past the identity by coincidence still cannot
; corrupt memory -- it can only apply wrong-but-in-range values, a bad game
; rather than a crashed one. Keep both layers; neither one makes the other
; unnecessary.
;
; Loading is not a second init_session. continue_game below calls the real
; one first -- the same baseline reset boot and a game over already give a
; new game, including BE_INIT rebuilding the party from the level-1 tables --
; and only then overwrites what a fresh session set, with what was saved.
; Reversing that order would have BE_INIT's own party rebuild run *after* the
; load and silently erase it. cur_map is deliberately not part of the record
; at all -- see shared/save.js's own comment on SAVE_FIELDS -- which is what
; lets init_session's ordinary NO_MAP reset stand and apply_map_music decide
; the music fresh, the same as any other arrival, instead of a restored
; cur_map telling it a song is already playing that init_session just
; stopped.

  .if SAVE_ENABLED
  .include "assets/save.inc"

; A/X = the two-byte checksum of the SAVE_BODY_LEN body bytes already sitting
; at SAVE_BASE (A = the first accumulator, X = the second). Two running sums, not
; one: sum1 is a plain running total and sum2 is a running total *of* sum1,
; so two bytes trading places -- or one byte lost from the middle of a
; partial write and another gained at the end -- change sum2 even on the
; rare occasion they leave sum1 alone. A single running sum cannot see that
; at all, which is exactly the gap the interruption scenario in this file's
; header comment walks through: two bytes changing by amounts that happen to
; cancel mod 256 left the old one-byte sum matching a body it no longer
; described. Both sums still wrap at 256 rather than the 255 a textbook
; Fletcher checksum reduces to -- simpler on a 6502 with no divide, and the
; gap that leaves (blind to an all-zero byte inserted or removed) is not a
; shape corruption or a torn write takes.
save_checksum:
  lda #0
  sta tmp
  sta tmp2
  ldy #0
save_checksum_loop:
  lda SAVE_BASE,y
  clc
  adc tmp
  sta tmp
  clc
  adc tmp2
  sta tmp2
  iny
  cpy #SAVE_BODY_LEN
  bne save_checksum_loop
  lda tmp
  ldx tmp2
  rts

; Refreshes SAVE_BASE from wherever the record actually lives, before
; anything below reads it. On battery, SAVE_BASE already addresses the
; always-mapped SRAM directly -- mapper_init enabled it once, at boot, and
; nothing since has moved it -- so there is nothing to fetch. On flash, the
; record lives in bank SAVE_BANK's own ROM until this copies
; SAVE_RECORD_LEN bytes of it out to save_flash_buf (SAVE_BASE for that
; medium; engine/constants.asm), because the record is never resident in
; RAM the rest of the time the way battery's is.
;
; An ordinary ROM read, same as any other bank switch: the chip is never
; mid-operation here (only save_media_commit's own erase/program is), so
; write_mapper_reg's identity-table trick is exactly as safe as it is
; everywhere else in this engine. Clobbers A, X and Y; preserves nothing
; else, the same as save_check_valid, whose head is this routine's only
; caller today alongside script_op_save's own read of a stale buffer
; nothing else in this file needs.
;
; Both this and save_media_commit below are wrapped whole, call site
; included (see save_check_valid and script_op_save) rather than left
; standing as a bare `rts` battery never uses: a no-op *function* is still
; a jsr and an rts battery pays for on every save/load, which is exactly
; the "must not move by a byte" MMC1/MMC3 output promises -- caught by
; kernelbytes.test.js re-measuring a live Save command on MMC1 the first
; time this was only conditional on the inside.
  .if SAVE_FLASH
save_media_fetch:
  lda mapper_shadow
  pha
  lda #SAVE_BANK
  jsr switch_prg_bank
  ldy #0
save_media_fetch_loop:
  lda $B000,y
  sta SAVE_BASE,y
  iny
  cpy #SAVE_RECORD_LEN
  bne save_media_fetch_loop
  pla
  jsr write_mapper_reg
  rts
  .endif

; The dangerous direction: erase-then-program bank SAVE_BANK's own sector
; from whatever script_op_save has just finished composing at SAVE_BASE.
; Battery media has no call site for this at all -- see the comment above
; save_media_fetch -- because save_write_body already wrote the record
; directly into the always-mapped SRAM it lives in, and there is no second
; medium to commit it to.
;
; The whole operation runs under forced blank with NMI genuinely disabled
; (a $2000 write, not merely masked -- see engine/split.asm's own register-
; discipline comment for why "merely masked" is not the same thing) and IRQ
; masked for good measure, even though this board has no IRQ source of its
; own to mask: an interrupt vector fetch mid-operation would read chip
; status as a vector, the same hazard an instruction fetch is, so this
; costs nothing to close off anyway. php/plp bracket it rather than a bare
; sei/cli, so a caller's interrupt state comes back exactly as it was
; rather than this assuming it was on, the same discipline switch_prg_bank
; already holds itself to for the identical reason.
  .if SAVE_FLASH
save_media_commit:
  jsr wait_vblank_poll
  php
  sei
  lda #$00
  sta $2000                  ; NMI off, genuinely -- not merely masked
  sta $2001                  ; rendering off
  lda mapper_shadow
  pha
  ldx #0
save_media_commit_copy:
  lda flash_commit_driver,x
  sta flash_driver,x
  inx
  cpx #flash_commit_driver_len
  bne save_media_commit_copy
  jsr flash_driver            ; see engine/flash.asm's own header for why
                              ; this must run from here, never from ROM
  pla
  jsr write_mapper_reg        ; safe again: the operation is over
  jsr enable_rendering
  plp
  rts
  .endif

; Z set when the record at SAVE_BASE is one this build wrote, is not corrupt, and
; names values this build can actually index with. Four gates, in order from
; cheapest to most expensive to check, any one of which refuses the record:
;
;   1. The marker is the one byte a completed save ends on -- catches "never
;      saved" and a save interrupted before it finished.
;   2. The identity matches this build's own -- catches a save written by a
;      different-shaped project or an older engine version. This only makes
;      a foreign save *unlikely* to reach the checks below, not unable to;
;      see this file's header comment.
;   3. The checksum matches a fresh recompute over the body -- catches a
;      corrupt or (with WRAM enabled but never written) blank chip.
;   4. Every restored value load_apply_body is about to trust as a table
;      index is in range for *this* build -- catches what a perfect
;      identity and checksum still cannot: a hand-edited or bit-flipped
;      record, or a save from a project the identity happened not to
;      distinguish from this one, that names a screen, map, party size,
;      direction, actor, level or Y position this build does not have. The
;      same reasoning script_op_call already applies to a call naming no
;      live common event: a value that could index out of bounds must be
;      refused, not indexed with. This layer, not the identity above, is
;      what makes a load safe rather than merely likely to be this
;      project's own.
;
;      Every bound below is one of two kinds, and picking the wrong one is
;      its own bug even when a bound is present at all: a MAX_* constant is
;      what the *engine* can hold -- a fixed capacity, allocated the same on
;      every project, like MAX_PARTY's four pc_hp/pc_level/pc_in_party
;      bytes or MAX_LEVEL's xp_next_lo/hi rows. A NUM_* constant is what
;      *this project* actually emitted into a table sized to its content --
;      NUM_SCREENS, NUM_ACTORS, PARTY_SIZE. A value that indexes a
;      fixed-capacity array is safe under its MAX_*; a value that indexes a
;      table only as long as this project's own content -- pc_metasprite,
;      pc_speed, pc_name and the rest of the per-member battle tables among
;      them -- is only safe under its NUM_*, because two projects can share
;      every MAX_* (they always do; MAX_* never varies by project) while
;      differing in exactly the NUM_* that bounds the table a restored slot
;      reaches into. Bounding such a value against the matching MAX_*
;      instead reads as a real check and refuses nothing a differently-sized
;      project's save would actually trip.
;
; Clobbers A, X and Y; preserves nothing else.
save_check_valid:
  .if SAVE_FLASH
  jsr save_media_fetch
  .endif
  lda SAVE_MARKER
  cmp #SAVE_MARKER_VALID
  bne save_check_fail
  lda SAVE_IDENTITY_0_ADDR
  cmp #SAVE_IDENTITY_0
  bne save_check_fail
  lda SAVE_IDENTITY_1_ADDR
  cmp #SAVE_IDENTITY_1
  bne save_check_fail
  lda SAVE_IDENTITY_2_ADDR
  cmp #SAVE_IDENTITY_2
  bne save_check_fail
  lda SAVE_IDENTITY_3_ADDR
  cmp #SAVE_IDENTITY_3
  bne save_check_fail
  jsr save_checksum
  cmp SAVE_CHECKSUM_LO
  bne save_check_fail
  cpx SAVE_CHECKSUM_HI
  beq save_check_range       ; passed every early gate -- skip the relay below
save_check_fail:
  ; save_check_invalid is now too far past the party loop below for a plain
  ; branch from up here to reach (nesasm's "Branch address out of range!") --
  ; jmp has no such limit, so the early gates relay through this one instead
  ; of branching to the label directly. The late checks below stay direct
  ; branches; they are close enough to it not to need the relay.
  jmp save_check_invalid
save_check_range:
  ; NUM_SCREENS/MAX_PARTY/MAX_ITEMS are this build's own ceilings -- the same
  ; take_door (engine/boot.asm) already refuses an out-of-range warp target
  ; with, for the same reason: a value read out of the record has to earn its
  ; way into a table index, never be trusted into one.
  lda SAVE_FLAT_SCREEN
  cmp #NUM_SCREENS
  bcs save_check_invalid
  lda SAVE_PARTY_SIZE
  cmp #MAX_PARTY+1
  bcs save_check_invalid
  lda SAVE_INV_COUNT
  cmp #MAX_ITEMS+1
  bcs save_check_invalid
  ; player_dir indexes build_oam's four-direction player_tiles table
  ; (engine/oam.asm) at dir*8; an out-of-range value reads past it.
  lda SAVE_PLAYER_DIR
  cmp #4
  bcs save_check_invalid
  ; player_y: the collision body's bottom edge (player_y + BODY_B) indexes a
  ; 240-byte per-screen metatile record in probe_type (engine/player.asm);
  ; MAX_Y is the same ceiling ordinary movement already clamps to, in
  ; move_down, so this refuses nothing a normal frame of gameplay could not
  ; already have produced from a legitimate walk. It does refuse a save
  ; whose player_y came from a start position schema normalization allows
  ; up to 239 but movement itself would never reach -- a pre-existing
  ; mismatch between that clamp and MAX_Y, left alone here; see the note by
  ; MAX_Y in constants.asm.
  lda SAVE_PLAYER_Y
  cmp #MAX_Y+1
  bcs save_check_invalid
  ; Each *live* inv_items entry -- only the first inv_count of them are ever
  ; read (draw_menu, engine/ui.asm, stops at inv_count) -- is used unchecked
  ; as an actor id by draw_actor_icon, which indexes actor_anim_dir past the
  ; actor table if it names one this build does not have. inv_count itself
  ; was just bounded above, so this loop's own bound is trustworthy.
  ldy #0
save_check_inv_loop:
  cpy SAVE_INV_COUNT
  beq save_check_inv_done
  lda SAVE_INV_ITEMS,y
  cmp #NUM_ACTORS
  bcs save_check_invalid
  iny
  bne save_check_inv_loop     ; inv_count <= MAX_ITEMS (8), never wraps Y
save_check_inv_done:
  .if BATTLE_ENABLED
  ; Each pc_level needs a floor as well as a ceiling: 0 passes a ceiling-only
  ; check, and after the next victory try_level_up (engine/battleturn.asm)
  ; does `ldy pc_level,x / dey`, producing Y = $FF and reading
  ; xp_next_lo/hi[$FF] -- far past the table. Checked for all MAX_PARTY
  ; slots, not just the live ones: init_session already reset every slot's
  ; level to 1 before load_apply_body overwrites it, so a slot the save
  ; leaves at 0 is exactly a restored value that has no business being
  ; there, live party member or not.
  ldy #0
save_check_level_loop:
  cpy #MAX_PARTY
  beq save_check_level_done
  lda SAVE_PC_LEVEL,y
  beq save_check_invalid       ; 0 fails the floor
  cmp #MAX_LEVEL+1
  bcs save_check_invalid
  iny
  bne save_check_level_loop
save_check_level_done:
  ; PARTY_SIZE (assets/battle.inc) is how many members *this project actually
  ; has* -- MAX_PARTY is only the capacity every RPG-capable board reserves
  ; RAM for. A live pc_in_party slot at or beyond PARTY_SIZE names a member
  ; this build never generated: battle_sprite_pc indexes pc_metasprite with
  ; it (engine/battleui.asm), and the same slot reaches pc_speed
  ; (engine/battleturn.asm) and pc_name (engine/battleui.asm) once it is
  ; treated as a living combatant -- all three sized to the *real* party,
  ; unlike pc_hp/pc_level/pc_spells and the rest of this array family, which
  ; are plain kernel RAM at a fixed MAX_PARTY regardless of project. Folding
  ; the real party count into the identity (shared/save.js) only makes a
  ; mismatched save unlikely to reach here; this is what makes reaching here
  ; safe.
  ldy #0
save_check_party_loop:
  cpy #MAX_PARTY
  beq save_check_party_done
  lda SAVE_PC_IN_PARTY,y
  beq save_check_party_next    ; not live: nothing this slot names is read
  cpy #PARTY_SIZE
  bcs save_check_invalid
save_check_party_next:
  iny
  bne save_check_party_loop
save_check_party_done:
  .endif
  lda #0                     ; Z set: every gate passed
  rts
save_check_invalid:
  lda #1                    ; anything nonzero: cmp against itself would set Z
  cmp #0
  rts

; Point save_ptr at field sv_idx's RAM address and return X = its length.
; save_field_lo/hi/len (assets/save.inc) are the one generated table both
; save_write_body and load_apply_body below walk -- a field is addressed by
; its position in that table, never by a hand-written label reference, so
; the two directions cannot drift into disagreeing about the record's shape
; the way eighteen separately hand-written loops eventually would.
save_field_setup:
  ldx sv_idx
  lda save_field_lo,x
  sta save_ptr_lo
  lda save_field_hi,x
  sta save_ptr_hi
  lda save_field_len,x        ; X is still sv_idx -- none of the above touch it
  tax
  rts

; Engine RAM -> the record at SAVE_BASE, one field at a time: save_ptr walks
; the field's RAM home, save_cursor walks the record body it is packed into,
; and both use the same Y so neither needs its own byte counter. save_cursor
; starts at SAVE_BASE and advances by each field's length as it finishes,
; which is what makes the table's field *order* the record's byte layout --
; exactly what shared/save.js's SAVE_FIELDS already promises engine/save.asm
; will do.
save_write_body:
  lda #LOW(SAVE_BASE)
  sta save_cursor_lo
  lda #HIGH(SAVE_BASE)
  sta save_cursor_hi
  lda #0
  sta sv_idx
save_write_field:
  jsr save_field_setup
  stx sv_len
  ldy #0
  cpy sv_len
  beq save_write_field_done   ; a zero-length field never occurs, but costs
                              ; nothing to not assume
save_write_byte:
  lda [save_ptr_lo],y
  sta [save_cursor_lo],y
  iny
  cpy sv_len
  bne save_write_byte
save_write_field_done:
  lda save_cursor_lo
  clc
  adc sv_len
  sta save_cursor_lo
  bcc save_write_next
  inc save_cursor_hi
save_write_next:
  inc sv_idx
  lda sv_idx
  cmp #SAVE_FIELD_COUNT
  bne save_write_field
  rts

; The Save command's own implementation, in the order the header comment
; above states and requires: invalidate, identity, body, checksum, then the
; marker valid again -- last of all, and the only step that makes the record
; readable as a save at all. script_next1, not script_next2: OP_SAVE has no
; operand, so the two-byte skip script_next2 performs left script_ptr one
; byte into whatever followed Save, running it as if it were the next
; command's own opcode.
script_op_save:
  lda #0
  sta SAVE_MARKER             ; invalidate first -- see the header comment on
                              ; why an overwrite needs this and a first save does not
  lda #SAVE_IDENTITY_0
  sta SAVE_IDENTITY_0_ADDR
  lda #SAVE_IDENTITY_1
  sta SAVE_IDENTITY_1_ADDR
  lda #SAVE_IDENTITY_2
  sta SAVE_IDENTITY_2_ADDR
  lda #SAVE_IDENTITY_3
  sta SAVE_IDENTITY_3_ADDR
  jsr save_write_body
  jsr save_checksum
  sta SAVE_CHECKSUM_LO
  stx SAVE_CHECKSUM_HI
  lda #SAVE_MARKER_VALID
  sta SAVE_MARKER
  .if SAVE_FLASH
  jsr save_media_commit       ; see its own comment; no call site at all on
                              ; battery, where the record above was already
                              ; written to where it lives
  .endif
  jmp script_next1

; The record at SAVE_BASE -> engine RAM, the mirror of save_write_body: same
; table, same field order, same cursor arithmetic, only the direction of the
; one lda/sta pair inside the byte loop is reversed. Only ever called from
; continue_game below, after init_session -- never on its own, or a load
; would be applying a record on top of whatever RAM happened to hold rather
; than a known-fresh session.
load_apply_body:
  lda #LOW(SAVE_BASE)
  sta save_cursor_lo
  lda #HIGH(SAVE_BASE)
  sta save_cursor_hi
  lda #0
  sta sv_idx
load_apply_field:
  jsr save_field_setup
  stx sv_len
  ldy #0
  cpy sv_len
  beq load_apply_field_done
load_apply_byte:
  lda [save_cursor_lo],y
  sta [save_ptr_lo],y
  iny
  cpy sv_len
  bne load_apply_byte
load_apply_field_done:
  lda save_cursor_lo
  clc
  adc sv_len
  sta save_cursor_lo
  bcc load_apply_next
  inc save_cursor_hi
load_apply_next:
  inc sv_idx
  lda sv_idx
  cmp #SAVE_FIELD_COUNT
  bne load_apply_field
  rts

; Continue, from the title. init_session first -- the same "new game" boot and
; a game over already run, hearts/bag/switches/variables reset and BE_INIT
; rebuilding the party from the level-1 tables -- and only then the record on
; top, because init_session ends by calling BE_INIT and a load applied before
; that would be the party BE_INIT just rebuilt overwriting the one just
; loaded. Nothing here re-derives what "new game" means a third time; it asks
; init_session for it, the same way start_game and restart_game do.
continue_game:
  jsr init_session
  jsr load_apply_body
  lda #NO_ENTITY
  sta talk_ent
  lda #0
  sta box_state
  lda #ST_GAMEPLAY
  sta game_state
  jmp redraw_screen
  .endif
