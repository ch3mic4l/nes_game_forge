; script.asm -- running an actor's event.
;
; An event is a list of pages; the first page whose condition passes is the one
; that runs, which is how the same chest says "a gem!" once and "it's empty."
; after. A page is [cond, arg, value, body length, commands...] and the list ends
; with EVT_PAGES_END -- the value byte is on every page, whether or not its
; condition is one of the comparisons that reads it, because script_skip steps
; over a page it has declined without decoding what declined it.
; Commands run straight through until one of them has to wait for
; the player -- Say does, because the message box types over several frames -- at
; which point script_ptr is left pointing at the next command and the box's close
; path calls script_resume.
;
; Dispatch is a chain of compares rather than a jump table for the same reason
; do_action's is: a table would be a second place the opcode order had to be kept
; in step with EVENT_COMMANDS in shared/project.js.

; X = the entity slot being spoken to. Starts its event, or -- if it has none --
; leaves the old portrait-only dialogue in place.
script_start:
  lda #0
  sta script_active
  sta box_state
  lda ent_event,x
  cmp #NO_EVENT
  beq script_start_done
  tay
  lda event_ptr_lo,y
  sta script_ptr_lo
  lda event_ptr_hi,y
  sta script_ptr_hi
  jmp script_page
script_start_done:
  rts

; Pick the page to run, then fall into the command loop.
script_page:
  ldy #0
  lda [script_ptr_lo],y
  cmp #EVT_PAGES_END
  beq script_finish         ; every page was ruled out: nothing to say
  jsr script_cond
  beq script_page_run
  ldy #EVT_PAGE_HEAD-1      ; skipped: step over the header and the body, whose
  lda [script_ptr_lo],y     ; length is the last byte of that header
  clc
  adc #EVT_PAGE_HEAD
  jsr script_skip
  jmp script_page
script_page_run:
  lda #EVT_PAGE_HEAD
  jsr script_skip
  lda #1
  sta script_active
  ; fall through

; Run commands until one suspends or the event ends. The compares are spread
; over `bne`-and-`jmp` pairs rather than a run of `beq`s because the handlers are
; well past the 128-byte reach of a branch.
script_run:
  ldy #0
  lda [script_ptr_lo],y
  bne script_run_say
  jmp script_finish         ; OP_END
script_run_say:
  cmp #OP_SAY
  bne script_run_give
  jmp script_op_say
script_run_give:
  cmp #OP_GIVE
  bne script_run_take
  jmp script_op_give
script_run_take:
  cmp #OP_TAKE
  bne script_run_set
  jmp script_op_take
script_run_set:
  cmp #OP_SET_SW
  bne script_run_clear
  jmp script_op_set
script_run_clear:
  cmp #OP_CLR_SW
  bne script_run_warp
  jmp script_op_clear
script_run_warp:
  cmp #OP_WARP
  bne script_run_join
  jmp script_op_warp
script_run_join:
  .if BATTLE_ENABLED
  cmp #OP_JOIN
  bne script_run_setvar
  jmp script_op_join
  .endif
script_run_setvar:
  cmp #OP_SET_VAR
  bne script_run_addvar
  jmp script_op_setvar
script_run_addvar:
  cmp #OP_ADD_VAR
  bne script_run_subvar
  jmp script_op_addvar
script_run_subvar:
  cmp #OP_SUB_VAR
  bne script_run_bad
  jmp script_op_subvar
script_run_bad:
  jmp script_finish         ; an opcode this engine cannot run stops the event
                            ; rather than being reinterpreted as another one

script_finish:
  lda #0
  sta script_active
  jmp box_close             ; which returns to gameplay once the box is down

script_op_say:
  ldy #1
  lda [script_ptr_lo],y     ; string id
  tay
  lda str_ptr_lo,y
  sta msg_ptr_lo
  lda str_ptr_hi,y
  sta msg_ptr_hi
  lda #2
  jsr script_skip
  jmp box_say               ; suspends here; the box drives the rest

script_op_give:
  jsr script_arg
  jsr add_item
  jmp script_next2

script_op_take:
  jsr script_arg
  jsr remove_item
  jmp script_next2

script_op_set:
  jsr script_arg
  jsr switch_set
  jmp script_next2

script_op_clear:
  jsr script_arg
  jsr switch_clear
script_next2:
  lda #2
  jsr script_skip
  jmp script_run

; The player is sent somewhere else, which ends the conversation: the move is
; left to main_loop's warp_ready, exactly as walking into a door is, so the
; redraw never happens underneath a caller that is still walking a list.
script_op_warp:
  ldy #1
  lda [script_ptr_lo],y
  sta warp_scr
  iny
  lda [script_ptr_lo],y
  sta warp_x
  iny
  lda [script_ptr_lo],y
  sta warp_y
  lda #1
  sta warp_ready
  jmp script_finish

  .if BATTLE_ENABLED
; Recruit a party member. party_join lives in the battle bank, so this goes
; through call_battle -- the trampoline restores the screen bank on the way out,
; which matters here more than anywhere: the script keeps running afterwards,
; and the frame this ran in still has to dereference mtptr.
script_op_join:
  jsr script_arg
  sta bt_arg
  lda #BE_JOIN
  jsr call_battle
  jmp script_next2
  .endif

; ------------------------------------------------------------- the variables
;
; [op, which, value], three bytes. `which` is an index into a 16-byte array, and
; it is not range-checked here: every byte of an event is clamped as it is
; compiled (see normalizeEventCommand in shared/project.js and encodeCommand in
; main/build/textcompile.js), which is the one place that can know how many
; variables this build has. A check here would need a second answer to that.
;
; Add and subtract saturate instead of wrapping. A counter that rolls 255 -> 0
; is a quest that silently starts over, and the 6502 makes the cheap thing the
; wrong one.

script_op_setvar:
  jsr script_var
  sta variables,x
  jmp script_next3

script_op_addvar:
  jsr script_var
  clc
  adc variables,x
  bcc script_var_store
  lda #$FF
  jmp script_var_store

script_op_subvar:
  jsr script_var
  sta script_val
  lda variables,x
  sec
  sbc script_val
  bcs script_var_store
  lda #0
script_var_store:
  sta variables,x
script_next3:
  lda #3
  jsr script_skip
  jmp script_run

; The variable command at script_ptr: X = which variable, A = the operand.
script_var:
  ldy #1
  lda [script_ptr_lo],y
  tax
  iny
  lda [script_ptr_lo],y
  rts

; The one-byte argument of the command at script_ptr.
script_arg:
  ldy #1
  lda [script_ptr_lo],y
  rts

; The player dismissed the message: pick up where the event left off.
script_resume:
  lda script_active
  beq script_resume_done    ; inverted into a jmp: the command loop is well past
  jmp script_run            ; a branch's 128-byte reach
script_resume_done:
  jmp box_close

; A = bytes to advance script_ptr by.
script_skip:
  clc
  adc script_ptr_lo
  sta script_ptr_lo
  bcc script_skip_done
  inc script_ptr_hi
script_skip_done:
  rts

; Does the page at script_ptr apply? Returns A = 0 (Z set) when it does.
script_cond:
  ldy #0
  lda [script_ptr_lo],y
  beq script_cond_pass      ; COND_NONE
  cmp #COND_SW_ON
  beq script_cond_on
  cmp #COND_SW_OFF
  beq script_cond_off
  cmp #COND_HAS_ITEM
  beq script_cond_item
  cmp #COND_VAR_EQ
  beq script_cond_var_eq
  cmp #COND_VAR_GE
  beq script_cond_var_ge
  cmp #COND_VAR_LT
  beq script_cond_var_lt
  lda #1                    ; a condition this engine cannot test never passes,
  rts                       ; so a project built by a later version stays quiet
script_cond_on:
  jsr script_arg
  jsr switch_test
  beq script_cond_fail
  lda #0
  rts
script_cond_off:
  jsr script_arg
  jsr switch_test
  bne script_cond_fail
  lda #0
  rts
script_cond_item:
  jsr script_arg
  jmp has_item              ; already answers 0/1 with the flags to match

; The three variable comparisons. Each one runs the same subtraction and reads a
; different flag out of it -- equal, at least, under -- so what they compare is
; written down once.
script_cond_var_eq:
  jsr script_cond_var
  bne script_cond_fail
  lda #0
  rts
script_cond_var_ge:
  jsr script_cond_var
  bcc script_cond_fail
  lda #0
  rts
script_cond_var_lt:
  jsr script_cond_var
  bcs script_cond_fail
script_cond_pass:
  lda #0
  rts
script_cond_fail:
  lda #1
  rts

; The page header's variable against the page header's value, as flags:
; Z means they are equal, C means the variable is the greater of the two. The
; index needs no check for the reason script_var does not have one.
script_cond_var:
  ldy #2
  lda [script_ptr_lo],y     ; the value the page compares against
  sta script_val
  ldy #1
  lda [script_ptr_lo],y     ; which variable
  tax
  lda variables,x
  cmp script_val
  rts

; ------------------------------------------------------------- the switches
;
; 64 flags an event can set, clear and test. Both callers are mid-loop on a
; register the obvious implementation would clobber -- spawn_entities holds the
; entity slot in X and the record cursor in Y -- so these preserve both, and the
; mask is shifted rather than looked up in a table so no index register is
; needed to build it.

; A = switch number. Splits it into switch_idx (which byte) and switch_bit
; (which bit). Preserves X and Y.
switch_split:
  sta switch_idx
  and #7
  sta switch_bit
  lda #1
switch_split_shift:
  dec switch_bit
  bmi switch_split_done
  asl a
  jmp switch_split_shift
switch_split_done:
  sta switch_bit
  lsr switch_idx
  lsr switch_idx
  lsr switch_idx
  rts

; A = switch number. Returns A = 0 (Z set) when the switch is off. Y is put back
; before the AND, so the flags describe the switch and not the reload.
switch_test:
  sty switch_y
  jsr switch_split
  ldy switch_idx
  lda switches,y
  ldy switch_y
  and switch_bit
  rts

switch_set:
  sty switch_y
  jsr switch_split
  ldy switch_idx
  lda switches,y
  ora switch_bit
  sta switches,y
  ldy switch_y
  rts

switch_clear:
  sty switch_y
  jsr switch_split
  ldy switch_idx
  lda switch_bit
  eor #$FF
  and switches,y
  sta switches,y
  ldy switch_y
  rts

; A = actor id. Returns A = 0 (Z set) when the bag holds one.
has_item:
  sta script_tmp
  ldx inv_count
  beq has_item_no
has_item_loop:
  dex
  lda inv_items,x
  cmp script_tmp
  beq has_item_yes
  cpx #0
  bne has_item_loop
has_item_no:
  lda #1
  rts
has_item_yes:
  lda #0
  rts
