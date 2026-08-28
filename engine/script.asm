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
; path calls script_resume. A question waits in the same way and resumes through
; script_choose instead, because what it is waiting for is an answer rather than
; an acknowledgement.
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
  sta call_depth            ; a fresh conversation starts with an empty stack
  .if MOVE_ENABLED
  sta mv_left               ; ...and with nothing walking. Nothing known can
                            ; leave a move running -- the world is frozen for
                            ; the whole of one and only move_tick clears it --
                            ; but a stale counter here would have ui_tick
                            ; stepping an actor on behalf of an event that
                            ; ended, and resuming a script that is not there
  .endif
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
  bne script_page_test      ; inverted into a jump: the branch runner between
  jmp script_end            ; here and script_end put it out of ±128 bytes
script_page_test:
  jsr script_cond
  beq script_page_run
  ; Skipped: step over the header and then over the body, whose length is the
  ; last byte of that header. Two steps, not one sum: a body may be 255 bytes,
  ; and adding the header to that carries out of the accumulator -- which
  ; script_skip cannot see, because it clears the carry before adding to the
  ; pointer. The sum wrapped, and the page after a long declined one was entered
  ; four bytes into the middle of it.
  ldy #EVT_PAGE_HEAD-1
  lda [script_ptr_lo],y
  pha
  lda #EVT_PAGE_HEAD
  jsr script_skip
  pla
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
  jmp script_end            ; OP_END
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
  bne script_run_if
  jmp script_op_subvar
script_run_if:
  cmp #OP_IF
  bne script_run_choice
  jmp script_op_if
script_run_choice:
  cmp #OP_CHOICE
  bne script_run_jump
  jmp script_op_choice
script_run_jump:
  cmp #OP_JUMP
  bne script_run_call
  jmp script_op_jump
script_run_call:
  cmp #OP_CALL
  bne script_run_music
  jmp script_op_call
script_run_music:
  cmp #OP_MUSIC
  bne script_run_battle
  jmp script_op_music
script_run_battle:
  .if BATTLE_ENABLED
  cmp #OP_BATTLE
  bne script_run_heal
  jmp script_op_battle
  .endif
script_run_heal:
  cmp #OP_HEAL
  bne script_run_damage
  jmp script_op_heal
script_run_damage:
  cmp #OP_DAMAGE
  bne script_run_save
  jmp script_op_damage
script_run_save:
  .if SAVE_ENABLED
  cmp #OP_SAVE
  bne script_run_move
  jmp script_op_save
  .endif
script_run_move:
  .if MOVE_ENABLED
  cmp #OP_MOVE
  bne script_run_bad
  jmp script_op_move
  .endif
script_run_bad:
  jmp script_finish         ; an opcode this engine cannot run stops the event
                            ; rather than being reinterpreted as another one

; Reached when a page's commands run out (OP_END) or script_page finds no
; further page (EVT_PAGES_END). A call left on the stack is not finished --
; the event that made it is still mid-page -- so this pops the return point
; and keeps that one running; only an empty stack really ends the
; conversation. script_op_warp skips this and jumps to script_finish directly,
; because the player leaving the screen ends the conversation regardless of
; how many calls deep it was.
script_end:
  lda call_depth
  beq script_finish
  dec call_depth
  ldx call_depth
  lda call_ret_lo,x
  sta script_ptr_lo
  lda call_ret_hi,x
  sta script_ptr_hi
  jmp script_run

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

; NO_ITEM ($FF, the same value NO_ACTOR always was) is what
; main/build/textcompile.js compiles a Give/Take naming an item that
; itemMissing says does not exist to -- validateProject refuses a build over
; a *live* command like that, but buildProject compiles the project the app
; is holding rather than one that has passed validation, the same reason a
; battle formation's own actor ids are checked again here rather than
; trusted. Under ITEMS_ENABLED, add_item (engine/ui.asm) now also refuses a
; NO_ITEM operand centrally, so this check and that one are redundant for
; Give specifically -- kept here anyway because it is cheap, because
; remove_item (what Take calls) has no check of its own regardless, and
; because a build with ITEMS_ENABLED false still reads this operand as a
; legacy actor id, where add_item's own guard does not fire at all: a
; command the compiler deliberately marked "nothing to give/take" must never
; reach add_item/remove_item on that path, or the byte that meant "nothing"
; becomes an id past the end of the actor-indexed tables the inventory then
; draws from.
;
; script_finish, not script_next2: the opcode is recognised but its operand
; names nothing, which is the same situation script_run_bad's unknown-opcode
; case is in, and gets the same answer -- an unrunnable command stops the
; event rather than being skipped. Skipping would carry on to whatever comes
; after silently having not done the thing it was there for: a page that
; reads "give the Lantern, then mark the shop visited" would mark the shop
; visited without ever having given the Lantern, and nothing about the
; conversation would say so.
script_op_give:
  jsr script_arg
  cmp #NO_ITEM
  beq script_finish
  jsr add_item
  jmp script_next2

script_op_take:
  jsr script_arg
  cmp #NO_ITEM
  beq script_finish
  jsr remove_item
  jmp script_next2

script_op_set:
  jsr script_arg
  jsr switch_set
  jmp script_next2

  .if SAVE_ENABLED
; Advances past an opcode with no operand at all -- Save (engine/save.asm) is
; the only such command today, so this has one caller, but it is named the
; same way script_next2/script_next3 are rather than inlined into that one
; caller, so a future no-operand command finds it here instead of copying it
; a second time or, worse, reaching for script_next2 because it is what is
; already in scope. Gated on SAVE_ENABLED rather than assembled
; unconditionally like script_next2/3: it has exactly one caller today and
; that caller does not exist in a build with no Save command, so this would
; otherwise be a few bytes every non-saving project paid for code it cannot
; reach -- the same accidental-unconditional-cost mistake the kernel
; reservation fix (main/build/generate.js's kernelCodeBytes) was written to
; stop happening.
script_next1:
  lda #1
  jsr script_skip
  jmp script_run
  .endif

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

; [OP_MUSIC, song index or NO_SONG]. set_music (engine/music.asm) is the same
; routine apply_map_music calls when a screen arrives on a new map, so an
; event and the map it is running on agree about what counts as a change and
; neither can retrigger a song the other just started.
script_op_music:
  jsr script_arg
  jsr set_music
  jmp script_next2

; [OP_BATTLE, MAX_MONSTERS actor ids, NO_ACTOR-padded]. Copies the formation
; straight into mon_slot_actor and hands over to battle_begin (engine/rpg.asm)
; -- the same routine touch_encounter and the step counter use, so a scripted
; fight is not a fourth way in. script_ptr is advanced past the whole command
; first and script_active is left set, exactly how OP_SAY suspends: script_run
; is not reached again this frame, and nothing here calls script_finish, so
; the event stays open across the thousands of frames a battle takes. Losing
; already ends the game elsewhere (player_died, reached from battle_finish)
; and never comes back through here, so whatever runs next -- if anything --
; is only ever the win case; battle_end is where the script picks back up.
  .if BATTLE_ENABLED
script_op_battle:
  ldy #1
  ldx #0
script_op_battle_slot:
  lda [script_ptr_lo],y
  sta mon_slot_actor,x
  iny
  inx
  cpx #MAX_MONSTERS
  bne script_op_battle_slot
  lda #NO_ENTITY
  sta bt_from_ent            ; not a touch or a step -- nothing to despawn
  lda #0
  sta bt_esc                 ; a scripted fight cannot be run from
  lda #1+MAX_MONSTERS
  jsr script_skip
  jmp battle_begin
  .endif

; [op, value]. Heals or damages the whole party -- always assembled, unlike
; OP_JOIN/OP_BATTLE just above, because neither command is RPG-only. Which
; health model that means is decided here, at assemble time, by the same
; BATTLE_ENABLED flag: every recruited pc_hp in an RPG (party_heal/
; party_damage, engine/rpg.asm) or the action game's one player_hp meter
; (gain_hearts/lose_hearts, engine/combat.asm) otherwise -- there is no
; third model for a script to invent, and the two must not silently disagree
; about whether the player is alive.
script_op_heal:
  jsr script_arg
  .if BATTLE_ENABLED
  jsr party_heal
  .endif
  .if !BATTLE_ENABLED
  jsr gain_hearts
  .endif
  jmp script_next2

; A killing Damage must stop the event exactly where it happens, not carry on
; into whatever the page says next -- the same "must be a jmp, never a jsr
; that returns into script_next" shape script_op_call's NO_COMMON_EVENT_SLOT
; stop already is. Both sides jsr a routine that only ever saturates and
; returns (party_damage / lose_hearts), then decide death themselves, right
; here, with their own jmp to player_died -- neither callee may jump there
; on our behalf, because the jsr that reached it would leave its own return
; address sitting on the stack for some unrelated rts to pop later. In an
; RPG, party_damage's own Z flag says whether that hit wiped the party;
; lose_hearts leaves the answer in player_hp for the same reason gain_hearts
; does, so this side reads it back instead of carrying its own flag.
script_op_damage:
  jsr script_arg
  .if BATTLE_ENABLED
  jsr party_damage
  bne script_op_damage_done  ; someone recruited is still standing
  jmp player_died
  .endif
  .if !BATTLE_ENABLED
  jsr lose_hearts
  lda player_hp
  bne script_op_damage_done
  jmp player_died
  .endif
script_op_damage_done:
  jmp script_next2

; [OP_MOVE, who, DIR_*, distance]. Walks one actor a fixed distance with the
; world otherwise frozen, and suspends the script exactly as OP_SAY does:
; script_ptr is advanced past the whole command first, script_active is left
; set, and this returns to the main loop with mv_left non-zero. ui_tick tests
; that byte before it dispatches on game_state, so move_tick
; (engine/entities.asm) gets the frame instead of the message box's own tick,
; and move_tick is what calls script_resume once the walk is over.
;
; The facing is set here rather than in move_tick, once, before the first step:
; a move that is blocked on its very first frame should still have turned to
; look the way it tried to go, and doing it per-step would be re-deciding
; something already decided -- the trap CLAUDE.md records as "deciding a state
; inside several branches lets the last one win".
;
; A distance of zero does not suspend. There would be nothing to wait for, and
; the only thing that ever resumes a Move is move_tick watching that counter
; reach zero -- so returning with mv_left already zero would hang the event on a
; tick that never comes. It falls through to the next command instead.
  .if MOVE_ENABLED
script_op_move:
  ldy #1
  lda [script_ptr_lo],y
  sta mv_who
  iny
  lda [script_ptr_lo],y
  sta mv_dir
  iny
  lda [script_ptr_lo],y
  sta mv_left
  lda #4
  jsr script_skip
  ; MOVE_SELF with nobody to be: defense in depth rather than a live case --
  ; every event runs through start_dialog, which puts the slot it was given in
  ; talk_ent, and the world is frozen for the whole of one, so nothing can
  ; empty that slot mid-event. If it ever were empty, ent_x,x with x = $FF
  ; would read and *write* a byte 240 past the end of the entity arrays. Stop
  ; the event, the same answer script_run_bad gives an opcode it cannot run and
  ; script_op_give gives a NO_ITEM operand.
  lda mv_who
  bne script_op_move_ready
  lda talk_ent
  cmp #NO_ENTITY
  bne script_op_move_ready
  jmp script_finish
script_op_move_ready:
  lda mv_left
  bne script_op_move_wait
  jmp script_run
script_op_move_wait:
  lda mv_dir
  jmp move_face             ; sets the mover's facing and returns to our caller,
                            ; which suspends the script exactly as box_say does
  .endif

; ------------------------------------------------------------------- calls
;
; [OP_CALL, which common event]. Unlike a branch or a question, what follows
; the opcode is not more of the event -- it is a reference to one compiled
; elsewhere, at the table slot commonEventTableIndex resolved in
; main/build/textcompile.js. Running it is exactly script_start's own trick,
; minus the entity lookup: point script_ptr at that event's first page and
; fall into script_page, the same way talking to an actor does.
;
; What has to be remembered is where to come back to, because unlike a branch
; -- which is bytes inside the body already being walked -- a common event's
; body is bytes somewhere else entirely. That is call_ret_lo/hi: a small
; fixed-depth stack rather than one more branch to script_ptr, because two
; common events are free to call each other and a cycle between them would
; recurse this routine forever if depth were not bounded. CALL_STACK_DEPTH in
; engine/constants.asm is that bound.
;
; There are two different reasons a call can fail to run, and they get two
; different answers. NO_COMMON_EVENT -- the compiler could not give this
; `call` a table slot at all, because nothing it names is live -- is the same
; situation script_op_give/script_op_take's own NO_ITEM is in: a recognised
; command whose operand names nothing, which stops the event exactly as
; script_run_bad does for an opcode this engine cannot run at all, rather
; than silently not doing the thing the page said it would and carrying on
; to whatever comes after. Past CALL_STACK_DEPTH is not that: the callee is
; perfectly real, there is just nowhere left on the small fixed stack to
; remember the way back, so the call is skipped -- the command after it just
; runs next -- and stays a skip on purpose. Two common events are free to
; call each other, and a cycle between them is only visible once both bodies
; exist, not while either is being authored; turning the bound into a stop
; would make an author-invisible cycle hang the game rather than unwind.
script_op_call:
  ldy #1
  lda [script_ptr_lo],y      ; which common event's table slot, or NO_COMMON_EVENT
  sta tmp
  lda #2
  jsr script_skip            ; past the opcode and the argument -- the return
                              ; point, saved below before script_ptr moves again
  lda tmp
  cmp #NO_COMMON_EVENT
  bne script_op_call_depth   ; a real slot: fall through to the depth check
  jmp script_finish          ; the sentinel: stop, the same answer script_run_bad
                              ; and script_op_give/take give an operand naming nothing
script_op_call_depth:
  lda call_depth
  cmp #CALL_STACK_DEPTH
  bcc script_op_call_push    ; below the bound: push the return point and call
  jmp script_run             ; at the bound already: skip the call, keep going
                              ; -- script_run is well past a branch's reach
script_op_call_push:
  ldx call_depth
  lda script_ptr_lo
  sta call_ret_lo,x
  lda script_ptr_hi
  sta call_ret_hi,x
  inc call_depth
  ldy tmp
  lda event_ptr_lo,y
  sta script_ptr_lo
  lda event_ptr_hi,y
  sta script_ptr_hi
  jmp script_page

; --------------------------------------------------------------- branching
;
; [OP_IF, cond, arg, value, then-length] then-branch [OP_JUMP, else-length]
; else-branch. Past the opcode that is exactly a page header, so `script_cond`
; and the skip below are the ones script_page already uses -- an If is a page
; inside a page, which is why neither needed a second implementation.
;
; There is no stack and nothing is remembered: which way a branch went is only
; ever where script_ptr is pointing. That is what lets Say suspend inside a
; branch and script_resume pick the event up again knowing nothing about it, and
; it is why nesting costs the engine nothing at all -- an inner branch is just
; more bytes inside the outer one's count.
;
; The compiler emits the OP_JUMP pair even when there is no else-branch, so both
; arrivals at the end of a then-branch look the same. Two bytes for a shape the
; engine does not have to ask questions about.

script_op_if:
  lda #1
  jsr script_skip           ; now script_ptr is at a page header
  jsr script_cond
  bne script_op_if_else
  lda #EVT_PAGE_HEAD        ; taken: step over the header into the then-branch
  jsr script_skip
  jmp script_run
; Not taken: over the header, over the then-branch, over the OP_JUMP pair that
; ends it -- three steps rather than one sum, because a page body may be up to
; 255 bytes and the total would not fit in the accumulator.
script_op_if_else:
  ldy #EVT_PAGE_HEAD-1
  lda [script_ptr_lo],y     ; the then-branch's length, before the pointer moves
  pha
  lda #EVT_PAGE_HEAD
  jsr script_skip
  pla
  jsr script_skip           ; now on the OP_JUMP that ends the then-branch
  lda #2                    ; over it, and the else-branch runs
  jsr script_skip
  jmp script_run

; Reached only by running off the end of a taken then-branch, which is the one
; place the else-branch has to be stepped over rather than into.
script_op_jump:
  ldy #1
  lda [script_ptr_lo],y     ; the else-branch's length
  pha
  lda #2                    ; the OP_JUMP and its length byte
  jsr script_skip
  pla
  jsr script_skip
  jmp script_run

; --------------------------------------------------------------- questions
;
; [OP_CHOICE, count, a string id per option] and then one record per option:
; [length, commands..., OP_JUMP, what is left of the question].
;
; A branch asks the game which way to go; this asks the player. Past that the
; two are the same shape, down to the OP_JUMP every option ends with -- the one
; a finished then-branch runs into, doing the same job of stepping over the
; alternatives that were not taken.
;
; script_ptr stays on the command for as long as the question is up, because the
; box reads the option labels back out of it as it draws them. Which row the
; cursor is on is the only thing remembered, and it is turned into a body once,
; here, when the player presses a button. Nothing else is kept -- so a Say inside
; an option suspends and resumes through script_resume, which knows nothing
; about questions, exactly as it does inside a branch.

script_op_choice:
  jmp box_choose            ; suspends here; text_advance answers it

; The player picked option choice_sel. Step over the header, then over every
; record above the answer -- each one a length byte and the bytes it counts --
; and then into the answer's own body.
script_choose:
  ldy #1
  lda [script_ptr_lo],y     ; count
  clc
  adc #2                    ; the opcode, the count, and one string id per option
  jsr script_skip
  ldx choice_sel
  beq script_choose_enter
; Two steps per record rather than one sum, for the reason script_page's skip
; takes two: a record may be 255 bytes long, and adding its length byte to that
; carries out of the accumulator where script_skip cannot see it.
script_choose_walk:
  ldy #0
  lda [script_ptr_lo],y     ; this record's length
  pha
  lda #1                    ; and the byte that carried it
  jsr script_skip
  pla
  jsr script_skip           ; script_skip and pha/pla both leave X alone
  dex
  bne script_choose_walk
script_choose_enter:
  lda #1                    ; over the answer's own length byte, into its body
  jsr script_skip
  jmp script_run

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

; A = item id under ITEMS_ENABLED, the legacy backing-actor id otherwise.
; Returns A = 0 (Z set) when the bag holds one.
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
