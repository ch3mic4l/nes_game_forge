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
  lda #$30                  ; constant volume, zero
  sta $4000
  sta $4004
  sta $400C
  lda #0
  sta $4008
  rts

music_tick:
  lda mus_enabled
  beq music_tick_done
  ldx #0
music_tick_loop:
  jsr music_channel
  inx
  cpx #MUS_CHANNELS
  bne music_tick_loop
music_tick_done:
  rts

music_channel:
  lda #0
  sta mus_trig,x
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
