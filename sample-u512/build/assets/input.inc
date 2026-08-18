; Generated -- one action per button, for each game state.
; States: gameplay, menu, dialog, title, gameover, battle. Buttons: A, B, SELECT, START.
input_actions:
  .db $01,$02,$04,$05
  .db $07,$06,$00,$05
  .db $07,$07,$00,$00
  .db $07,$00,$08,$07
  .db $07,$00,$00,$07
  .db $07,$06,$00,$00
