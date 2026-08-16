; combat.asm -- the player's health in an action game.
;
; Three things can take a heart through hurt_player: an actor whose damage is
; more than zero walking into you, a metatile the Map Forge marked Damage, and
; nothing else -- the invincible window, the knockback and the way a game ends
; are one implementation because all three share it. A scripted Damage command
; is a fourth thing that can take a heart, and deliberately does not go through
; hurt_player: a trap that says "you take 2 hearts" has no attacker to knock
; back and must land every time, iframes included, so script_op_damage
; (engine/script.asm) calls lose_hearts directly -- the saturating store and
; the death check hurt_player itself falls into, factored out so there is
; still one implementation of what losing a heart means, not two that can
; disagree. A scripted Heal is the only way a heart is ever given back outside
; a new game, through gain_hearts, its saturating-add mirror.
;
; None of this is conditional on the project: it is a few hundred bytes and the
; alternative is two engines. What *is* conditional is whether it can ever fire
; -- COMBAT_ENABLED is zero when no actor deals damage, no Damage metatile is
; painted anywhere and no live Damage command is compiled in, and then the
; hearts are not drawn and nothing calls in here.

; Start a new life: full hearts, an empty bag, and every switch and variable back
; to zero. Run at boot and again whenever a game-over screen is dismissed, so
; "new game" means the same thing both times.
init_session:
  lda #MAX_HEARTS
  sta player_hp
  lda #0
  sta player_iframes
  sta kb_timer
  sta pickups
  sta defeated
  sta inv_count
  sta inv_sel
  sta items_used
  sta paused
  .if MOVE_ENABLED
  sta mv_left               ; a new game has nothing mid-walk, whatever the last
                            ; one was doing when it ended
  .endif
  sta talk_ent              ; NO_ENTITY is $FF, but boot re-writes it after this
  ldx #7
init_session_switches:
  sta switches,x
  dex
  bpl init_session_switches
  ldx #NUM_VARIABLES-1      ; the counters go back to zero with the flags: they
init_session_vars:          ; are the same kind of state and outlive a screen
  sta variables,x           ; change for the same reason
  dex
  bpl init_session_vars
  lda #NO_MAP               ; forces apply_map_music to redecide even when the
  sta cur_map               ; next screen is the same map index the player was
                             ; already on -- a game over must not inherit it
  jsr music_stop             ; makes the session's silence real rather than
                              ; merely believed: resetting cur_map is not
                              ; enough on its own, because the destination map
                              ; can itself be Silence, and set_music only calls
                              ; back into music_play/music_stop when something
                              ; has actually changed
  .if BATTLE_ENABLED
  lda #0
  sta enc_step
  ; A status only means anything inside a battle -- battle_begin and
  ; battle_end (engine/rpg.asm) both already hold that at the two ordinary
  ; edges of one, but a defeat is not an ordinary edge: battle_finish jumps
  ; straight to player_died on a loss, so battle_end never runs and a status
  ; a losing fight left behind survives the game over. restart_game already
  ; calls in here for everything else "new game" means, so this is that
  ; boundary's own business rather than a third clear bolted onto the defeat
  ; path specifically -- one more exit a status must never survive would be
  ; exactly how this bug happened the first time.
  ldx #MAX_PARTY-1
init_session_status:
  sta pc_status,x
  dex
  bpl init_session_status
  lda #BE_INIT              ; the party, out of the tables in the battle bank
  jmp call_battle
  .endif
  rts

; A = hearts to take, X = the entity slot responsible (MAX_ENTITIES or more when
; it was the floor, which knocks the player straight backwards instead).
; Does nothing while the player is still invincible from the last hit.
hurt_player:
  ldy player_iframes
  bne hurt_player_done
  pha                        ; hearts to lose -- knockback_dir clobbers A
  lda #IFRAME_TIME
  sta player_iframes
  jsr knockback_dir
  lda #KNOCKBACK_TIME
  sta kb_timer
  pla
  jsr lose_hearts
  lda player_hp
  bne hurt_player_done
  jmp player_died
hurt_player_done:
  rts

; A = hearts to lose, saturating at 0. Always returns -- the saturating store
; is the one implementation of what losing hearts means, shared by
; hurt_player above and script_op_damage (engine/script.asm), but *deciding*
; the game is over from it is each caller's own job, done with its own jmp
; to player_died right after the jsr returns and its own read of player_hp.
; lose_hearts jumping there itself, on top of being called with jsr, would
; leave that jsr's own return address sitting unpopped on the stack: nothing
; would ever get around to using it *incorrectly* until the next unrelated
; rts happened to pop it, which turned out to be one deep inside the message
; box's own call chain -- control returned into the middle of
; script_op_damage as though the jsr to this routine had simply finished,
; and the page carried on past a killing hit as though it had never landed.
; That is the failure combat.test.js's killing-Damage test caught, and the
; reason every caller decides player_died for itself instead of trusting a
; callee to jump there on its behalf.
lose_hearts:
  sta tmp
  lda player_hp
  sec
  sbc tmp
  bcs lose_hearts_store
  lda #0                     ; more damage than hearts left
lose_hearts_store:
  sta player_hp
  rts

; A = hearts to restore, saturating at MAX_HEARTS. The Heal command's own
; implementation -- nothing else in the base engine ever gives a heart back
; outside a new game, so this has no other caller. Two comparisons, not one:
; the 8-bit add itself can carry past 255 before the sum is ever compared
; against a MAX_HEARTS far below that, and a value clamped to a byte at
; authoring time can still be handed here as large as 255.
gain_hearts:
  sta tmp
  lda player_hp
  clc
  adc tmp
  bcs gain_hearts_max         ; wrapped past 255: certainly over MAX_HEARTS
  cmp #MAX_HEARTS+1
  bcc gain_hearts_store
gain_hearts_max:
  lda #MAX_HEARTS
gain_hearts_store:
  sta player_hp
  rts

; Which way to be thrown: away from the actor in slot X, on whichever axis it is
; furthest along. Decided once, here, rather than inside each movement branch --
; the chaser's facing bug was exactly that mistake.
knockback_dir:
  cpx #MAX_ENTITIES
  bcc knockback_from_actor
  lda player_dir            ; hurt by the floor: bounce back the way you came
  eor #1
  sta kb_dir
  rts
knockback_from_actor:
  lda player_x
  sec
  sbc ent_x,x
  bcs knockback_dx
  eor #$FF
  clc
  adc #1
knockback_dx:
  sta chase_dx
  lda player_y
  sec
  sbc ent_y,x
  bcs knockback_dy
  eor #$FF
  clc
  adc #1
knockback_dy:
  sta chase_dy
  cmp chase_dx              ; A still holds the vertical distance
  bcc knockback_side

  lda player_y
  cmp ent_y,x
  bcs knockback_down
  lda #DIR_UP
  sta kb_dir
  rts
knockback_down:
  lda #DIR_DOWN
  sta kb_dir
  rts
knockback_side:
  lda player_x
  cmp ent_x,x
  bcs knockback_right
  lda #DIR_LEFT
  sta kb_dir
  rts
knockback_right:
  lda #DIR_RIGHT
  sta kb_dir
  rts

; Run instead of reading the pad while kb_timer lasts, so being hit throws you
; clear of whatever hit you rather than letting you walk straight back into it.
; Screen edges and walls still stop the slide -- the move_* routines do the
; collision, exactly as they do for a step the player asked for.
knockback_step:
  dec kb_timer
  lda #KNOCKBACK_SPEED
  sta cur_speed
  lda kb_dir
  cmp #DIR_UP
  beq knockback_up
  cmp #DIR_LEFT
  beq knockback_left
  cmp #DIR_RIGHT
  beq knockback_right_step
  jmp move_down
knockback_up:
  jmp move_up
knockback_left:
  jmp move_left
knockback_right_step:
  jmp move_right

; The floor, once per frame, from update_player. The probe is the middle of the
; body rather than a corner: standing with one pixel over a spike tile and
; taking damage for it reads as a bug.
player_hazard:
  lda #COMBAT_ENABLED
  beq player_hazard_done
  lda player_iframes
  bne player_hazard_done
  lda player_x
  clc
  adc #8
  sta probe_x
  lda player_y
  clc
  adc #12
  sta probe_y
  jsr probe_type
  cmp #COL_DAMAGE
  bne player_hazard_done
  ldx #MAX_ENTITIES         ; no actor to be thrown away from
  lda #1
  jmp hurt_player
player_hazard_done:
  rts

; X = entity slot. Contact damage, checked for every live actor after it has
; moved, so an actor that walked into the player counts as much as the reverse.
entity_contact:
  lda #COMBAT_ENABLED
  beq entity_contact_done
  lda player_iframes
  bne entity_contact_done
  ldy ent_actor,x
  lda actor_damage,y
  beq entity_contact_done
  sta ent_tmp2
  jsr entity_touching_player
  bne entity_contact_done
  .if BATTLE_ENABLED
  jmp touch_encounter       ; in an RPG, walking into a monster starts a fight
  .endif
  .if !BATTLE_ENABLED
  lda ent_tmp2
  jmp hurt_player
  .endif
entity_contact_done:
  rts

player_died:
  lda #0
  sta player_iframes
  sta kb_timer
  sta script_active
  lda #NO_ENTITY
  sta talk_ent
  lda #ST_GAMEOVER
  sta game_state
  ; The game-over screen is the message box saying one thing, which is why the
  ; string is emitted whether or not the project has any dialogue of its own.
  lda #LOW(sys_game_over)
  sta msg_ptr_lo
  lda #HIGH(sys_game_over)
  sta msg_ptr_hi
  jmp box_say

; Start, on the game-over screen, goes through restart_game in title.asm: where
; it lands depends on whether the cartridge has a title to go back to.

; --------------------------------------------------------------------- HUD

; One sprite per heart along the top of the screen, appended to the shadow after
; draw_entities has parked what is left over. The art is stamped into sprite
; tiles $FE/$FF at build time from shared/font.js, so it costs the project two
; tiles and only when something in it can actually hurt the player.
draw_hud:
  lda #COMBAT_ENABLED
  beq draw_hud_done
  lda game_state
  cmp #ST_TITLE
  beq draw_hud_done         ; no hearts before the game has started
  ldy oam_idx
  beq draw_hud_done         ; the shadow is completely full
  ldx #0
draw_hud_loop:
  lda #HUD_Y
  sta OAM,y
  iny
  txa
  cmp player_hp
  bcs draw_hud_empty
  lda #HEART_FULL_TILE
  jmp draw_hud_tile
draw_hud_empty:
  lda #HEART_EMPTY_TILE
draw_hud_tile:
  sta OAM,y
  iny
  lda #HUD_PAL
  sta OAM,y
  iny
  txa
  asl a
  asl a
  asl a                     ; eight pixels apart
  clc
  adc #HUD_X
  sta OAM,y
  iny
  beq draw_hud_full         ; wrapped past the 64th sprite
  inx
  cpx #MAX_HEARTS
  bne draw_hud_loop
draw_hud_full:
  sty oam_idx
draw_hud_done:
  rts
