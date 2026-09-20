# Reference: The event system

Current-state reference, moved verbatim out of `CLAUDE.md` on 2026-09-20 so that file stays small
enough to load into every session. Maintain it the way CLAUDE.md was maintained: update it in the
same change that alters what it describes. Cross-references such as "The kernel budget, above" or
"The event system, below" name sibling sections, which are now sibling `docs/reference-*.md`
files; `CLAUDE.md` indexes them all.

### The event system

**What makes an event run is a byte of the entity record**, `EVENT_TRIGGERS` in
`shared/project.js` in wire order, `TRIG_*` in `engine/constants.asm` at the other end. `interact`
is index 0 because it is what every event did before the byte existed, and **a trigger is a choice
rather than a set** — `do_talk` requires `TRIG_INTERACT`, or an entry event could be replayed by
walking up to whatever carried it and pressing the button.

**A placed entity's own record has a second field whose meaning depends on the actor's
behaviour, not just its trigger.** `ent_to_scr` (`engine/constants.asm`) is written unconditionally
for every placement. `entity_door` (`engine/entities.asm`) reads it as a flat-screen target; under
`ITEMS_ENABLED`, `entity_pickup` and the interact-button pickup path in `do_interact`
(`engine/input.asm`) instead read it as the item id a pickup actor's placement grants. Behaviour is
exclusive (never both `door` and `pickup`), so the two meanings never collide, and
`resolveEntityByte(entity, actor, itemsEnabled, itemIdForActor, flatLength)`
(`main/build/generate.js`) is the single place that decides which one a given placement's byte is
— the same question resolves identically for `emitScreens` and for `test/lib/eventdecoder.js`'s
consumer (below). The trap: the door-target clamp inside `resolveEntityByte` must never run for a
pickup actor's byte — an item id above the current screen count would be silently corrupted into a
real, wrong screen number by a clamp meant for the other meaning entirely.

`NO_ACTOR == NO_ITEM == $FF` is what let most of that retarget reach the ROM with **no engine code
change at all**: Give, Take, a monster's drop, and a Carrying condition used to resolve an item id to the
actor byte it backed before compiling it; once the compiler hands over the item id directly, every
sentinel comparison already in the engine — `script_op_give`'s `cmp #NO_ITEM` (renamed from
`NO_ACTOR` for clarity, both `$FF`), `roll_drop`'s identical compare — keeps working unexamined,
since both sentinels were always the same byte. Only the compiler's choice of *which* function
resolves an authored reference changed, never what the engine compares it against.

The same id-space-capping shape `NO_ACTOR`/`NO_ITEM` use closed a second, unrelated collision the
retarget's own icon table (`item_metasprite`) surfaced: before `LIMITS.metasprites` existed, a
metasprite array was genuinely uncapped, so a project could reach a real metasprite 255 —
byte-identical to `NO_METASPRITE`, an item's own "explicitly no icon". `LIMITS.metasprites =
NO_METASPRITE` (`shared/project.js`) closes it the same way `LIMITS.actors`/`LIMITS.items` already
do: the cap *is* the sentinel's own value. An already-over-cap project is refused by
`validateProject` with a named error and left intact rather than silently sliced — the same
policy the actor/item ceilings hold to.

ROADMAP item 8's modular-parts targets the player, not a Sprite Forge actor:
`PLAYER_FRAMES`/`PLAYER_TILES` (`shared/project.js`) name the player's 32 sprite-table slots.
`playerTiles` is the single canonical source — `generatePlayerSpriteCore`/`planPlayerSprite` write
only there, sharing one decision path: a frame is written whole or not at all, `BLANK_TILE`
staying the literal string, never `null`. The trap is separate: an out-of-range `frameIndex` grew
the array past 32, aliasing another frame. `generateAssets` stamps every tileset's `$00-$1F` from
it every build, into build-time copies only.
`openGeneratePlayerSpriteModal` (`renderer/forges/tile/tile.js`) is the only caller of
`generatePlayerSpriteCore`, using the `openPaletteSwapModal` revision-guard idiom, and
`describePlayerSpritePlan` (`shared/project.js`) writes every string the modal shows, pinned by
`playersprite.test.js`. See `docs/design-modular-parts.md` for the mechanism.

`renumberSpellDeletion` (`shared/project.js`) sits beside `renumberActorDeletion`/
`renumberItemDeletion`, the same shape applied to `project.spells`; the Magic Forge's own delete
handler (`renderer/forges/magic/magic.js`) is its real caller, exercised for real by
`main/smoke.js`, while `test/unit/project.test.js` calls the export directly as the actor/item
siblings' tests do (the real handler is renderer code no `node:test` process can drive). The
`wrongImplementation` closure beside those tests deliberately models the retired `Spells…` modal's
filter-without-shift bug, with a sanity assertion it really does get the fixture wrong.

**A fourth sibling, `renumberPartyMemberDeletion(project, index)`, exists for `project.party`**: a
Join's `member` above the deleted index shifts down, the hole becomes `null`. The Character Forge's
own party Remove handler calls it in its one `store.commit`. The normalizer keeps `null` `null`;
`validateProject` refuses a live Join naming `null` or an index ≥ `project.party.length`, via
`liveCommands` not `allCommands`. `project.party[0]` is unconditional on every game type — a
project always has someone to play as — and `project.party[N].renamable` is the single opt-in for
in-game naming, both for the hero (index 0, at boot or the title) and for a named Join (any other
index); the Map Forge's own join row shows `renamable` as a read-only hint, never an editable
control there, since the flag belongs to the Character Forge. `project.party` itself used to be
edited on the Sprite Forge's own `party` tab; that tab is removed entirely, a lossless move rather
than a copy — two editing surfaces for one record is the drift this codebase refuses. See
`docs/design-character-forge.md`.

`battle.attackAnim`/`spell.anim` name a `sprites.animations` row, whose frames name a
`sprites.metasprites` row (`docs/design-battle-animation.md`). `isValidAnimationRef`/
`isPlayableBattleAnimation` check each hop; `validateProject` refuses both, plus
`LIMITS.animations = NO_ANIM`. `animationReferenceLocations(project)` is the traversal
`renumberAnimationDeletion` (Sprite Forge's "Delete animation") and both refusals share, run
before the splice. `animationPickerOptions` answers a stale id with "Missing animation N", not a
rewrite.

**`SAVE_LAYOUT_VERSION` is 3**, bumped 1→2 when `inv_items`' own bytes started meaning an item
id rather than an actor id, then 2→3 when name entry (phase 1) added `pc_name_ram` to the body —
both cases `saveIdentity`'s own derived sizes cannot catch and what the version byte exists for. A
bump is unconditional and engine-wide: *any* save from the prior engine version fails
`save_check_valid`'s very first identity compare, regardless of whether that project uses items or
naming. An author sees nothing special: the old save is treated like a foreign or corrupted one, so
the title screen doesn't offer Continue — no message, no crash, the existing "this record
does not belong to this build" path doing what it already did for every other case.

**Item 7's `saveCompatToken` (`shared/save.js`'s `saveIdentity`, drawn by `drawSaveCompatToken` in
`shared/project.js`) closes a narrower hole the same way, and is deliberately not a second
`SAVE_LAYOUT_VERSION` bump.** A structural edit that reorders, deletes or resizes maps can leave
`screenCount`/`mapCount` — the only order-adjacent facts `saveIdentity` already folds in —
unchanged, letting `save_check_valid` accept a cartridge record whose `flat_screen` byte no longer
names the room it was saved in. Unlike a version bump, which breaks every prior save
unconditionally, `saveCompatToken` breaks one only for a project performing one of five
qualifying structural edits — `reorderMapsCore`/`deleteMapCore`/`growOrShrinkMap` are the three
call sites, `growOrShrinkMap` shared by grow, shrink and the growth-routed duplicate. It is a
random nonce in `[1, 0xffff]`, folded into `saveIdentity`'s hash only when nonzero, so an
unaffected project computes byte-identically to before the field existed. See
`docs/design-maporg.md` §6.10 for the full mechanism.

**An item's own effect is `{kind, amount}`, `kind` one of `none`/`heal`/`damage`.**
`ITEM_EFFECT_KINDS` (`shared/project.js`) is the wire format the same way `BEHAVIORS`/`ACTIONS`
already are: its array order is `EFFECT_NONE`/`EFFECT_HEAL`/`EFFECT_DAMAGE` in
`engine/constants.asm` written down by hand, so a kind's number is spelled in exactly one of those
two places. `none` stays index 0 because it is what every item meant before this field existed, and
`normalizeItem`'s own one-time migration — at normalization, not re-derived on every build — falls
back to it whenever an item's backing actor never had a positive `battle.heal` to derive a `heal`
from. `item_heal` (`main/build/battletables.js`, the RPG battle ITEM menu's own table) reads
`item.effect.amount` (heal kind, else 0) straight off the item, since the migration moved
that number there. The table's existence, size and only reader (`item_chosen`,
`engine/battleturn.asm`) are unchanged — only where each row's number comes from moved.

**`use_item` (`engine/ui.asm`) is the field/menu "spend an item" action, in every game type, and it
is the only place `none` genuinely means *key item*.** It calls `use_item_apply` first, which reads
`item_effect_kind`/`item_effect_amount` and answers one of three states in `A` —
`USE_ITEM_NONE`, `USE_ITEM_ALIVE`, `USE_ITEM_DIED` — a two-state carry protocol can't say
"applied, and lethal" without a second flag. A `none`-kind item makes `use_item` skip the
shift/`items_used` step entirely: it is kept, not spent, regardless of `amount` (kind alone
decides). `heal` and `damage` both apply through whichever health model the build has
(`BATTLE_ENABLED`: `party_heal`/`party_damage`; otherwise `gain_hearts`/`lose_hearts`), spent
either way. **`use_item_apply` is reached by `jsr` and must never itself `jmp player_died`** — the
same return-address constraint as a killing hit, but from the callee's side. The chain is
`dispatch_input`'s `dispatch_loop` → `jsr do_action` (`engine/input.asm`) → `do_action_use`'s own
`jmp use_item`, so that first `jsr`'s return address sits live on the stack through `use_item`,
`use_item_apply` and `player_died` alike, unstranded until some later `rts` unwinds the whole
tail-call chain back to `dispatch_loop`. `use_item` may safely `jmp player_died` only because
`use_item` itself was reached by `jmp` and so never had a return address of its own;
`use_item_apply` has one, so it must answer with `rts` rather than add a second return address and
abandon it with a `jmp`. `use_item` `pla`s that three-state result back (a `pha` at the top of the
routine, carrying the decision across the shift and highlight repair, which clobber `A`) before
performing its own `jmp player_died`.

**Neither of the other two starts a conversation itself.** Both arm `pending_ent`, and `main_loop`
is the single place it becomes one. Touch fires from inside `update_entities`, still walking the
other seven slots — starting there would leave the pickups, doors and contact damage below it
acting on a world that has just frozen, and a door on the same square would redraw the screen out
from under the conversation. Enter is armed by `spawn_entities`, inside the redraw that spawned it,
against a screen still being drawn. So both wait for a frame boundary — the rules below are all one
rule seen from different sides: **a frame that draws a screen or decides a warp belongs to that
transition, not to the player.**

- **First claim wins**, for both triggers through one `arm_event`. Two actors cannot each own the
  moment a screen loads, and a touch must not push aside the entry event of the screen it happened
  on. The Map Forge says which actor has the moment, on the ones that do not.
- **`pending_ent` is disarmed before the event runs, not after**, so an event that warps hands the
  moment on to whatever the next screen owes rather than swallowing it.
- **Work owed is settled before `dispatch_input`, not merely before the world**, since the frame
  ends there — it belongs to the transition, not the player. `settle_owed` carries its own
  `paused`/`game_state` gate: buttons are read in every state, but a warp and a pending event are
  gameplay's alone. Before the world, because an event can finish while the box is still up and the
  frame reading `warp_ready` after `update_entities` never runs; before the *buttons*, because an
  interact reaching `start_dialog` leaves an event free to warp, so a press that frame could
  overwrite a warp already owed, or warp away from a screen whose opening was armed and never
  spoken.
- **`dispatch_input` stops once a button has drawn a screen or decided a warp.** It re-reads
  `game_state` for every button, so two pressed together land in different states the moment the
  first changes it: confirm and interact on the same frame begin the game, then talk to whatever it
  spawned — on a screen never seen, and if that conversation warps, the opening goes with it. A is
  read first, which is why this is reachable at all; Start is read last and never could be.
- **`screen_fresh` means a screen has been drawn and the world has not run since**, cleared once
  per frame *before* `dispatch_input` and checked everywhere the world could start on a screen that
  has only just arrived — three ways one can: `dispatch_input` draws one outright (Start, on the
  title); `update_player` crosses an edge, which **does not unwind it** since `cross_*` is reached
  with a `jmp` ending in `redraw_screen`, whose `rts` lands back mid-routine with a different screen
  under the player, so `update_player` stops at the flag twice more (before the second axis of
  movement, and before the hazard and encounter checks); and the input can leave a warp for the next
  frame. Miss one and the new screen charges for its spikes, counts a step towards its wandering
  monsters, or moves the player against its collision before it has said a word.
- **A pending event is checked against `ent_active` before it runs.** With the settle ahead of the
  buttons nothing known can empty that slot in between, so this is a guard rather than a fix: the
  index is remembered across a frame boundary, and a stale one would speak for something that is
  not there without saying so.
- **`ent_touched` is cleared by walking off, not by the event ending.** The conversation ends with
  the player standing exactly where they started it.

Coming back from a battle is not entering a screen: `battle_end` redraws the field it never left,
so it puts down the entry event that redraw just armed — otherwise every fight replays whatever the
screen says on arrival.

`availableTriggers(actor, project)` is the single writer for which triggers are real for a
placement. `touch` is the only one that can be spoken for: walking into a pickup collects it,
walking into a door goes through it, and in an *RPG* walking into anything that deals damage starts
a battle, which freezes the world before the event could run — the same contact in an action game
costs a heart and the event still runs, which is why it asks the project and not only the actor.

**`effectiveTrigger(entity, actor, project)` is what everything then asks**, because an actor is
edited in a different Forge to the one that places it: a placement set to `touch` can find itself
on an actor that has since been given contact damage. The stored choice is deliberately *not*
rewritten — put the damage back and it is still there, since a change to an actor must not destroy
work on a placement — so the select, the hint under it and the compiler all derive the same answer
from it instead, and the Map Forge says out loud when the two differ. Three places deciding this
separately is exactly how the editor comes to show one trigger, the hint describe another and the
ROM run a third.

`engine/script.asm` runs an actor's event: a list of pages, first passing page wins, commands run
straight through until one has to wait for the player. `Say` is such a command, so the box's close
path calls `script_resume`. Plain dialogue compiles into an event of one unconditional page, so
"talking to somebody" has a single path through the engine rather than a special case beside the
scripted one. `IMPLEMENTED_COMMANDS` in `shared/project.js` is what the Map Forge offers; the
schema, `normalizeEntity` and the compiler handle every command in `EVENT_COMMANDS`, so a project
written by a later version round-trips through this one, and an opcode the engine cannot run stops
the event rather than being reinterpreted. `join` is hidden by the event editor unless the project
is a turn-based RPG (`map.js`), because in an action build `OP_JOIN`'s battle bank is not
assembled.

**`Move` is the first command conditionally assembled for a capacity reason rather than a hardware
one.** `Say` waits for the player; `Move` waits for the *world*, which is the thing this engine had
no shape for: `[OP_MOVE, who, DIR_*, distance]` suspends the script exactly as `OP_SAY` does, and
`move_tick` (`engine/entities.asm`) steps the mover one frame at a time out of `ui_tick`, ahead of
whatever state it is running inside, until the distance is paid off and it calls `script_resume`.
`mv_left` is the whole state machine — non-zero *is* "a move is running" — so there is no separate
flag to keep in step with the counter. Three rules hold it together:

- **A move that cannot finish must end, not hang.** Walking into a wall or the screen edge abandons
  the distance still owed and resumes the script, the same answer `script_op_call` gives a call
  stack that has run out, for the same reason: an author can't see from the Map Forge that a
  patroller will be standing in the way when the cutscene runs.
- **A distance of zero does not suspend at all.** The only thing that ever resumes a Move is
  `move_tick` watching `mv_left` reach zero, so suspending with it already zero is a wait nothing
  could ever end.
- **The facing is set once, before the first step**, not per step — the "decide once, before
  acting" trap below, and it is what makes a blocked move still turn to look the way it tried to go.

**A command that holds commands is not a special case to be named, it is a `nests: true` entry.**
Three exist — `branch`, `choice` and `route`, the last also `EVENT_COMMANDS`' only `virtual: true`
entry and the array's final one; array position is the wire opcode for every real, `OP_*`-backed
entry (`opIndex(id)`, `main/build/textcompile.js`), a contiguous real prefix then a
contiguous virtual tail, pinned by a unit test in `test/unit/project.test.js`; a future
engine-backed command inserts before the tail, a future virtual one after it. `route` holds one
`who` and an ordered list of `move`/`turn`/`wait` legs, admitted by the single filter
`routeLegs`/`ROUTE_LEG_OPS` (`shared/eventrules.js`) every consumer uses except `allCommands`,
which walks `command.legs` raw since it answers "what is mentioned," not "what compiles."
`liveCommands` recurses into a route's admitted legs rather than yielding the route command
itself, and `encodeCommand`'s own `'route'` case writes no opcode of its own, only its legs' bytes
— so an authored route compiles byte-identical to the same commands hand-chained, at zero engine
cost. See `docs/design-routes.md` for the full design.

Anything asking a question of a
whole event walks `allCommands` in `shared/eventrules.js` rather than a page's own list, and
anything asking how deep it may go asks `nests`. Both rules exist because the same defect happened
twice: `usedSwitches` in `templates.js` read only the top level, so a switch set inside a branch
was invisible to the free-switch scan and got handed out again — presenting as two unrelated
events firing together, reading as an engine bug.

**A question is a branch the player takes.** `[OP_CHOICE, count, a string id per option]` and then
one record per option, `[length, commands…, OP_JUMP, what is left of the question]` — the same
`OP_JUMP` a then-branch ends with. The string ids are contiguous and up front because `script_ptr`
**stays on the command** until it is answered: `text_choice_step` draws row *n* from the *n*'th
byte after the count, so nothing has to be remembered but `choice_sel`, and `script_choose` walks
that into a body exactly once — letting a `Say` inside an option suspend and resume
through `script_resume`, which knows nothing about questions. `CHOICE_LIMITS` in
`shared/project.js` is the single writer for what one holds — four options because `BOX_ROWS` is
four, a label as wide as `BOX_COLS` — so the schema, editor and compiler's clamp can't
offer an option the box has no row for. The cursor is `ARROW_TILE` in the padding column
(`BOX_TEXT_LO-1`), inside the frame and outside the text, so moving it cannot disturb a label and
wiping the labels cannot rub it out. `box_after` carries which phase the box was raised for, so
raising the frame and wiping a page stay one implementation each, and `box_handover` is the single
end of both, because **a phase must leave `box_row` at zero for the next one**. Typing counts in
`msg_line`, so as long as the box only ever typed, `box_row` could be left wherever it finished
and nothing noticed. Listing options reads `box_row`, and read the 4 the wipe left,
drawing no labels at all while every RAM assertion still passed — why `script.test.js` reads the
*nametable* for this one.

**The literal sequence `{name}` in a scripted `Say` or an entity's plain dialogue — never a
choice label — compiles to one `TXT_NAME` byte** (`$03`, defined in both hand-duplicated homes:
`engine/constants.asm:1055` and `main/build/textcompile.js:64`), expanded by
`engine/text.asm`'s `text_type_name` arm from `pc_name_ram` slot 0 at the typewriter's own
one-glyph-per-frame rate. `hero_name_default` (`assets/nameentry.inc`, a 10-byte table,
action-only) is what seeds that slot on an action project with no battle bank to read a name
from; an RPG never emits the table at all, seeding the identical slot from the banked `pc_name`
table through `party_join`'s own `NAME_SEED_ENABLED` copy instead (`engine/battle.asm`), since
`party_init` already calls `party_join` for every starting member, hero included. The pointer pair
is reloaded every frame the token is in progress, not only the first, because `ptr_lo`/`ptr_hi` are
shared scratch `draw_entities`' own animation path clobbers between frames.
`msg_name_idx = $059F` (`engine/constants.asm:767`, allocated with the Say token in phase 4, not
phase 1) is the token's own typewriter progress, reset to 0 in `box_begin`. `NAME_TOKEN_ENABLED`
gates the whole arm; a naming-off build still
keeps an empty `text_type_name` label so `text_type_page`'s branch target never moves.
`encodeLine`'s own `allowNameToken` flag (`main/build/textcompile.js`) decides eligibility at
compile time — true for a scripted `Say` and for plain dialogue (`effectiveDialogue`,
`shared/eventrules.js`, the compiler's own dialogue-vs-event precedence that `projectEvents` alone
never reaches), false for a choice option label, which compiles the literal text as six ordinary
glyphs instead and draws a Map Forge warning. `projectUsesNameToken` (`shared/project.js`) walks
`liveCommands` plus `effectiveDialogue` to answer whether any of this is live; `validateProject`
refuses a live token on an action project with no party member to read a default from.

A page is `[cond, arg, value, body length, commands…]`, and **a branch is that same header inline
in a body**: `[OP_IF, cond, arg, value, then-length]`, the then-branch, `[OP_JUMP, else-length]`,
the else-branch. Past the opcode the shapes are identical, so `script_cond` and the skip that
declines a page are the ones a branch uses too, and nesting costs the engine nothing since nothing
is remembered but where `script_ptr` points — a `Say` can suspend inside a branch with
`script_resume` knowing nothing about it. The `OP_JUMP` pair is emitted even for an empty else, so
both arrivals at the end of a then-branch look the same. The header is a fixed four bytes on
every page even though only variable comparisons read `value`, since `script_skip` steps over a
declined page without decoding its condition; `EVT_PAGE_HEAD` in `engine/constants.asm` and the
header written by `main/build/textcompile.js` are the two ends of that. The variables themselves
are 16 bytes at `variables` in `constants.asm`, but **how many there are is generated** —
`NUM_VARIABLES` in `config.inc`, from `RPG_LIMITS.variables`, which also clamps a variable index as
it is compiled — the engine range-checks nothing, since the compiler is the only thing that knows
how big the array is.

**`Run common event…` compiles to `[OP_CALL, table slot]`**, the slot a `call`'s target resolved to
in `main/build/textcompile.js`'s own events table — common events compile into it ahead of every
placement's, so a call's one-byte argument is just the position it landed in.
`shared/project.js`'s `liveCommonEvents(project)` is the single definition of which
`project.commonEvents` entries get a slot at all — one with at least one live page, carrying the id
`resolveCommonEventIds` gives it — consumed by both the compiler's slot assignment and
`validateProject`'s own "does this call's target still resolve" check — not two implementations
of the same rule that could disagree.

A `call` naming nothing live — deleted since, never live to begin with, or never given a target —
still compiles to `[OP_CALL, NO_COMMON_EVENT_SLOT]` rather than being dropped: `script_op_call`
(`engine/script.asm`) reads the operand and, finding the sentinel, stops the event exactly as
`script_run_bad` stops one on an opcode it does not recognise, and exactly as
`script_op_give`/`script_op_take` already do on `NO_ACTOR` — a recognised command whose operand
names nothing is that family's shape of bug. Silently dropping the command instead would let the
page carry on to whatever runs *after* the call, having not run the thing the call was there for.
`validateProject` also refuses a build over a *live* `call` like that, the same way it refuses a
missing Give/Take actor or an empty battle formation — defense in depth for a hand-edited project
or one written by a later version.

**Exceeding `CALL_STACK_DEPTH` is a different failure from `NO_COMMON_EVENT_SLOT` and gets a different
answer.** The callee there is perfectly real — there is just nowhere left on the small fixed
`call_ret_lo/hi` stack (`CALL_STACK_DEPTH` in `engine/constants.asm`) to remember the way back — so
`script_op_call` skips the call and runs the next command, on purpose: two common events are free to
call each other, and a cycle between them is only visible once both bodies exist, so past the
bound a call unwinds rather than hangs the game on an author-invisible cycle. The two checks
share no branch: `script_op_call` tests against `NO_COMMON_EVENT_SLOT` first, stopping before the
depth is even read, so a fix to one can't quietly change the other's behaviour.

The 64 switches and the 16 variables are the only state that outlives a screen change, which is
what makes "this happened already" expressible. `switch_test` / `switch_set` / `switch_clear`
**preserve X and Y**,
and `switch_split` builds its mask by shifting rather than indexing a table for exactly that
reason: `spawn_entities` calls `switch_test` with the entity slot in X and the record cursor in Y,
and reloading Y after the test would set the flags from the reload rather than from the switch.
