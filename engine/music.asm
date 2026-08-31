; music.asm -- the song driver.
;
; Four independent byte streams, one per APU channel, stepped once per frame.
; The format is defined in shared/audio.js and is implemented identically by
; the preview replayer, so what you hear in the Sound Forge is what the ROM
; plays. A stream is a sequence of:
;
;   $00-$5F  note, followed by a duration in frames
;   $FE      rest, followed by a duration in frames
;   $F0-$F7  select instrument 0-7 (no duration byte)
;   $FF      jump to the 16-bit address that follows
;
; Periods come from the generated period_lo/period_hi tables. The triangle
; counts at half the pulse rate, so it looks up note + 12 in that same table
; and lands on the same pitch.

; A = the song to play, or NO_SONG for silence. Calls music_play only when it
; differs from cur_song, the shadow of what is already sounding -- calling
; this with the song already playing does nothing, which is what stops a
; screen edge or a Play music command from retriggering a song that never
; stopped. cur_song itself is not this routine's to keep: music_play and
; music_stop below are its single writers, so anything that reaches the APU
; by calling them directly -- a Code Forge routine, say, and $C000 is
; permanently mapped so one may call either from anywhere -- leaves cur_song
; as honest as this wrapper does, rather than needing to know a rule only
; set_music followed.
set_music:
  cmp cur_song
  beq set_music_done
  jmp music_play
set_music_done:
  rts

; The map underneath flat_screen decides the music -- but only when the map
; itself has changed. Called once from boot and once from redraw_screen (the
; single place every other arrival, including a battle return and a door,
; funnels through), it compares screen_map[flat_screen] against cur_map and
; returns at once, without even reading map_song, when they already agree.
; That is what lets a Play music command's override survive a screen edge
; inside the map it was issued on: the edge redraws the screen, but the map
; underneath it has not changed, so this never reaches set_music to reassert
; the map's own choice over it. Crossing into a different map -- or
; init_session resetting cur_map to NO_MAP, which start_game and restart_game
; both run through before this ever sees the new screen -- makes the compare
; fail and the map's own song takes over regardless of what was playing.
apply_map_music:
  ldy flat_screen
  lda screen_map,y
  cmp cur_map
  beq apply_map_music_done
  sta cur_map
  tay
  lda map_song,y
  jmp set_music
apply_map_music_done:
  rts

; A = song index, or NO_SONG to stop. The single writer of cur_song: every
; path that reaches the APU, whether through set_music above or by a caller
; going straight to music_play or music_stop, keeps the shadow honest by
; storing here rather than by convention -- a rule spread across callers is a
; rule a Code Forge routine calling this directly has no way to know.
music_play:
  sta cur_song
  .if STING_ENABLED
  ; A sting borrows cur_song for its own duration (script_op_sting, engine/
  ; script.asm), so any request that reaches here while one is playing is, by
  ; definition, a request for something other than the sting itself --
  ; set_music's own dedup above already caught a repeat request for the sting
  ; song and never called this. Cancel it: A is preserved around the check
  ; since the song index just stored is still needed below. See
  ; design-sting.md §5, mechanism 2.
  pha
  lda sting_left
  beq music_play_no_cancel
  lda #0
  sta sting_left
music_play_no_cancel:
  pla
  .endif
  cmp #NO_SONG
  beq music_stop
  asl a
  asl a                     ; four channel pointers per song
  sta mus_tmp

  ldx #0
music_play_loop:
  txa
  clc
  adc mus_tmp
  tay
  lda song_ptr_lo,y
  sta mus_ptr_lo,x
  lda song_ptr_hi,y
  sta mus_ptr_hi,x
  lda #0
  sta mus_dur,x
  sta mus_inst,x
  sta mus_step,x
  sta mus_trig,x
  lda #$FF
  sta mus_note,x
  inx
  cpx #MUS_CHANNELS
  bne music_play_loop

  lda #$0F                  ; enable both pulses, triangle and noise
  sta $4015
  lda #1
  sta mus_enabled
  rts

; A separate entry point as well as music_play's own NO_SONG case, so a
; direct call -- init_session uses one, to make a new session's silence real
; rather than merely believed -- still leaves cur_song correct rather than
; relying on always arriving here through music_play's branch.
music_stop:
  lda #NO_SONG
  sta cur_song
  lda #0
  sta mus_enabled
  .if STING_ENABLED
  ; init_session calls this directly, bypassing music_play/set_music entirely
  ; -- without this, a sting mid-flight at a game over or a fresh boot would
  ; leave sting_left counting down into the new session and eventually splice
  ; the old session's own shadowed song state over it. A is already 0 from
  ; the line above. See design-sting.md §5, mechanism 2.
  sta sting_left
  .endif
  lda #$30                  ; constant volume, zero
  sta $4000
  sta $4004
  .if SFX_ENABLED
  ; An ordinary Play-Silence (or a map transition to a Silence map) reaches
  ; here through music_play's own NO_SONG branch -- not only init_session's
  ; own session-reset call -- so this must not clobber an active SFX's own
  ; note. init_session (engine/combat.asm) is the actual session boundary
  ; and force-silences $400C itself, immediately after this call, once the
  ; effect is genuinely being cancelled. See design-sfx.md §3.3, finding 4.
  ldy sfx_state
  bne music_stop_skip_noise
  .endif
  sta $400C
music_stop_skip_noise:
  lda #0
  sta $4008
  rts

music_tick:
  .if SFX_ENABLED
  lda mus_enabled
  ora sfx_state
  .else
  lda mus_enabled
  .endif
  beq music_tick_done
  ldx #0
music_tick_loop:
  .if SFX_ENABLED
  cpx #SFX_CHANNEL
  bne music_tick_normal
  lda sfx_state
  beq music_tick_normal        ; not stolen right now -- this index's own
                                ; song channel ticks normally below
  jsr sfx_channel_tick
  jmp music_tick_next
music_tick_normal:
  lda mus_enabled
  beq music_tick_next          ; Silence -- do not run this channel's normal
                                ; logic against a stopped song's stale state
  .endif
  jsr music_channel
music_tick_next:
  inx
  cpx #MUS_CHANNELS
  bne music_tick_loop
music_tick_done:
  rts

music_channel:
  lda #0
  sta mus_trig,x
  .if AUDIO_FX_ENABLED
  ; A sting resume (sting_restore below) copies the shadowed mus_* arrays
  ; back, but a copied mus_trig would be worthless -- the clear just above
  ; erases it before music_apply ever runs. force_trig is a second,
  ; self-clearing flag checked after that clear, so a restored note actually
  ; re-hits the APU. Shared with SFX's own hand-back (sfx_channel_tick,
  ; below) -- gated AUDIO_FX_ENABLED (Sting or SFX live), not STING_ENABLED
  ; alone. See design-sting.md §5, mechanism 1, and design-sfx.md §3.5.
  lda force_trig,x
  beq music_channel_noforce
  lda #0
  sta force_trig,x
  lda #1
  sta mus_trig,x
music_channel_noforce:
  .endif
  lda mus_dur,x
  bne music_channel_tick
  jsr music_read_event
music_channel_tick:
  dec mus_dur,x
  jsr music_apply           ; apply first, so a new note is heard at step 0

  lda mus_step,x            ; envelopes hold once they run out, so the step
  cmp #31                   ; only has to climb far enough to reach the end
  bcs music_channel_done
  inc mus_step,x
music_channel_done:
  rts

; Pull events off this channel's stream until one sets a duration.
music_read_event:
  lda mus_ptr_lo,x
  sta ptr_lo
  lda mus_ptr_hi,x
  sta ptr_hi

music_read_fetch:
  ldy #0
  lda [ptr_lo],y
  cmp #MUS_LOOP
  bne music_read_not_loop
  iny                       ; $FF is followed by the address to jump to
  lda [ptr_lo],y
  sta mus_tmp
  iny
  lda [ptr_lo],y
  sta ptr_hi
  lda mus_tmp
  sta ptr_lo
  jmp music_read_fetch

music_read_not_loop:
  cmp #MUS_REST
  beq music_read_rest
  cmp #MUS_INST
  bcc music_read_note
  and #$07                  ; $F0-$F7 selects an instrument
  sta mus_inst,x
  jsr music_advance_one
  jmp music_read_fetch

music_read_rest:
  lda #$FF
  sta mus_note,x
  jmp music_read_duration

music_read_note:
  sta mus_note,x
  lda #0
  sta mus_step,x            ; a new note restarts its envelope
  inc mus_trig,x

music_read_duration:
  ldy #1
  lda [ptr_lo],y
  sta mus_dur,x
  lda ptr_lo                ; step past the event and its duration byte
  clc
  adc #2
  sta mus_ptr_lo,x
  lda ptr_hi
  adc #0
  sta mus_ptr_hi,x
  rts

music_advance_one:
  inc ptr_lo
  bne music_advance_one_done
  inc ptr_hi
music_advance_one_done:
  rts

; ---------------------------------------------------------------- output

music_apply:
  lda mus_note,x
  cmp #$FF
  bne music_apply_sounding  ; the silence handlers are past a branch's reach
  jmp music_silence
music_apply_sounding:
  jsr music_volume
  cpx #2
  beq music_apply_triangle
  bcs music_apply_noise

music_apply_pulse:
  txa
  asl a
  asl a
  sta mus_reg               ; $4000 or $4004
  ldy mus_inst,x
  lda inst_duty,y
  asl a
  asl a
  asl a
  asl a
  asl a
  asl a                     ; duty occupies the top two bits
  ora #$30                  ; halt the length counter, use constant volume
  ora mus_vol
  ldy mus_reg
  sta $4000,y

  lda mus_trig,x            ; retuning every frame would restart the phase
  beq music_apply_done
  ldy mus_note,x
  lda period_lo,y
  ldy mus_reg
  sta $4002,y
  ldy mus_note,x
  lda period_hi,y
  ora #$08
  ldy mus_reg
  sta $4003,y
music_apply_done:
  rts

music_apply_triangle:
  lda mus_vol               ; the triangle has no volume, only on or off
  bne music_apply_triangle_on
  jmp music_silence_triangle
music_apply_triangle_on:
  lda #$FF
  sta $4008
  lda mus_trig,x
  beq music_apply_done
  lda mus_note,x
  clc
  adc #12                   ; same pitch, half the counter rate
  cmp #NUM_NOTES
  bcc music_apply_triangle_period
  lda #NUM_NOTES-1
music_apply_triangle_period:
  tay
  lda period_lo,y
  sta $400A
  lda period_hi,y
  ora #$08
  sta $400B
  rts

music_apply_noise:
  lda #$30
  ora mus_vol
  sta $400C
  lda mus_trig,x
  beq music_apply_done
  lda mus_note,x
  and #$0F
  sta mus_tmp
  lda #15                   ; higher notes pick shorter periods
  sec
  sbc mus_tmp
  sta $400E
  lda #$08
  sta $400F
  rts

music_silence:
  cpx #2
  beq music_silence_triangle
  bcs music_silence_noise
  txa
  asl a
  asl a
  tay
  lda #$30
  sta $4000,y
  rts
music_silence_triangle:
  lda #0
  sta $4008
  rts
music_silence_noise:
  lda #$30
  sta $400C
  rts

; Envelope lookup: the step climbs each frame and holds at the sustain entry.
music_volume:
  ldy mus_inst,x
  lda inst_env_lo,y
  sta ptr_lo
  lda inst_env_hi,y
  sta ptr_hi
  lda mus_step,x
  cmp inst_env_len,y
  bcc music_volume_read
  lda inst_sustain,y
music_volume_read:
  tay
  lda [ptr_lo],y
  and #$0F
  sta mus_vol
  rts

; ------------------------------------------------------------------ sting
; Shape (b): the whole song pauses, plays a second, short song alone through
; this same unmodified driver, and resumes exactly where it left off. See
; design-sting.md for the full design; script_op_sting (engine/script.asm) is
; the trigger, sting_tick below is what counts the duration down and calls
; sting_restore when it reaches zero.

  .if STING_ENABLED

; Copies the six contiguous per-channel arrays (mus_ptr_lo..mus_note, 24
; bytes, mus_trig excluded -- see music_channel's own force_trig comment for
; why a copied mus_trig would be worthless) into sting_shadow, plus cur_song
; and mus_enabled. Only called when sting_left == 0 (script_op_sting,
; mechanism 4) -- a second sting arriving mid-first must not re-snapshot the
; first sting's own state over the real song's already-shadowed one.
sting_snapshot:
  ldx #0
sting_snapshot_loop:
  lda mus_ptr_lo,x
  sta sting_shadow,x
  inx
  cpx #24
  bne sting_snapshot_loop
  lda cur_song
  sta sting_shadow_song
  lda mus_enabled
  sta sting_shadow_enabled
  rts

; The mirror copy-back, plus force-retriggering every channel (so the
; restored notes are actually heard, not just shadowed correctly -- mechanism
; 1) and, if the restored state was Silence, re-silencing the hardware
; explicitly (mechanism 3): mus_enabled going back to 0 alone stops
; music_tick from ever touching the APU again, so the sting's own last
; written values would otherwise ring forever. The retrigger loop runs only
; on the audible branch -- retriggering into a restored Silence would arm
; force_trig for a channel music_channel will not visit again until some
; later, unrelated song starts, which is harmless (a stale flag is consumed
; inertly on that song's own first tick) but pointless to pay for, kept as
; state hygiene rather than a correctness requirement. See design-sting.md
; §5, mechanisms 3 and 5.
sting_restore:
  ldx #0
sting_restore_loop:
  lda sting_shadow,x
  sta mus_ptr_lo,x
  inx
  cpx #24
  bne sting_restore_loop
  lda sting_shadow_song
  sta cur_song
  lda sting_shadow_enabled
  sta mus_enabled
  beq sting_restore_silence
  ldx #0
sting_retrig_loop:
  lda #1
  sta force_trig,x
  inx
  cpx #MUS_CHANNELS
  bne sting_retrig_loop
  rts
sting_restore_silence:
  lda #$30                  ; the same four writes music_stop makes
  sta $4000
  sta $4004
  .if SFX_ENABLED
  ldy sfx_state
  bne sting_restore_skip_sfx   ; SFX owns (or is a frame from
                                          ; finishing with) the noise channel
                                          ; -- its own cleanup phase silences
                                          ; it, not this restore. See
                                          ; design-sfx.md §3.3.
  .endif
  sta $400C
sting_restore_skip_sfx:
  lda #0
  sta $4008
  rts

; Ticked unconditionally from main_loop, immediately after music_tick (engine/
; boot.asm) -- the relative order is load-bearing: music_tick has to apply
; this frame's sting audio before this counter decides whether that was the
; sting's last frame, or the resume would run one frame early and drop the
; sting's own final note. See design-sting.md §3/§7.
sting_tick:
  lda sting_left
  beq sting_tick_rts
  dec sting_left
  bne sting_tick_rts
  jsr sting_restore
sting_tick_rts:
  rts

  .endif

; -------------------------------------------------------------------- sfx
; Shape (a): a short, fixed-volume, single-channel burst stolen onto
; SFX_CHANNEL. See design-sfx.md for the full design; script_op_sfx
; (engine/script.asm) is the trigger, music_tick above is what diverts
; SFX_CHANNEL to sfx_channel_tick whenever sfx_state != 0.

  .if SFX_ENABLED

; Entered from music_tick (above) whenever sfx_state != 0 and X = SFX_CHANNEL
; -- independent of mus_enabled by construction, which is the whole point:
; see design-sfx.md §3.3 for why the top-level gate alone is not enough.
; Two-phase, not a single decrement-and-handback -- see design-sfx.md §3.3,
; finding 1, for why a same-frame resolution would silence the effect's own
; final note before it was ever heard.
sfx_channel_tick:
  lda sfx_state
  cmp #1
  beq sfx_channel_tick_playing
  ; sfx_state == 2: the cleanup frame -- resolve exactly once, then idle.
  lda #0
  sta sfx_state
  lda mus_enabled
  beq sfx_tick_cleanup_silence
  lda #1
  sta force_trig+SFX_CHANNEL   ; hand back -- see design-sfx.md §3.4 for what
                                ; the channel resumes into
  jmp music_channel            ; tail-call, not rts -- retriggers the same
                                ; X = SFX_CHANNEL this same tick, so the
                                ; final SFX note gets exactly one frame
                                ; instead of two. X is untouched since entry;
                                ; music_channel's own trailing rts pops the
                                ; return address music_tick_loop's own jsr
                                ; sfx_channel_tick pushed, landing back at
                                ; "jmp music_tick_next" exactly as an
                                ; ordinary rts here would have -- see
                                ; design-sfx.md §3.3 for the full trace.
sfx_tick_cleanup_silence:
  lda #$30
  sta $400C                    ; nothing else will touch this register again
                                ; until a real song resumes or another SFX fires
  rts
sfx_channel_tick_playing:
  lda sfx_dur
  bne sfx_channel_tick_apply
  jsr sfx_read_event
sfx_channel_tick_apply:
  dec sfx_dur
  jsr sfx_apply              ; write this frame's audio BEFORE deciding
                              ; whether this was the effect's last playing
                              ; frame -- the identical ordering sting_tick's
                              ; own header comment already requires of
                              ; music_tick/sting_tick, for the identical
                              ; reason: apply first, or the final frame of
                              ; audio is silenced before it is ever heard
  dec sfx_left
  bne sfx_channel_tick_done
  lda #2
  sta sfx_state                ; one more frame needed before resolving
                                ; hand-back vs. silence -- see §3.3
sfx_channel_tick_done:
  rts

; Pulls one note/duration pair off the current effect's own stream. No
; instrument opcode, no loop -- see design-sfx.md §3.2 for why this is
; genuinely separate code from music_read_event, not a shared reader.
sfx_read_event:
  lda sfx_ptr_lo
  sta ptr_lo
  lda sfx_ptr_hi
  sta ptr_hi
  ldy #0
  lda [ptr_lo],y
  cmp #MUS_REST
  beq sfx_read_rest
  sta sfx_note
  lda #1
  sta sfx_trig
  jmp sfx_read_duration
sfx_read_rest:
  lda #$FF
  sta sfx_note
sfx_read_duration:
  ldy #1
  lda [ptr_lo],y
  sta sfx_dur
  lda ptr_lo
  clc
  adc #2
  sta sfx_ptr_lo
  lda ptr_hi
  adc #0
  sta sfx_ptr_hi
  rts

; The single stolen channel's own APU write -- fixed volume (sfx_volume, read
; once at trigger), no instrument/envelope lookup at all. Hardcodes $400C/
; $400E/$400F rather than X-indexing: X is always SFX_CHANNEL here, so the
; generic mus_reg-computation music_apply_noise needs is dead weight this
; routine does not pay for. and #$0F kept as defense-in-depth even though the
; schema stores a canonical 0-15 note.
sfx_apply:
  lda sfx_note
  cmp #$FF
  bne sfx_apply_sounding
  lda #$30
  sta $400C
  rts
sfx_apply_sounding:
  lda #$30
  ora sfx_volume
  sta $400C
  lda sfx_trig
  beq sfx_apply_done
  lda #0
  sta sfx_trig
  lda sfx_note
  and #$0F
  sta tmp
  lda #15
  sec
  sbc tmp
  sta $400E
  lda #$08
  sta $400F
sfx_apply_done:
  rts

  .endif
