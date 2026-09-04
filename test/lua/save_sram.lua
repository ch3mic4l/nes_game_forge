-- save_sram.lua -- verifies the battery-backed save (engine/save.asm) against
-- Mesen2's real MMC1/MMC3 WRAM-enable and write-protect emulation, which the
-- vendored jsnes core used by the unit suite does not model at all (see
-- test/unit/save.test.js's own header comment). Confirmed against Mesen's own
-- source before writing this: Core/NES/Mappers/Nintendo/MMC1.h sets
-- MemoryAccessType::NoAccess over $6000-$7FFF while _wramDisable (bit 4 of the
-- $E000 shift register) is set; MMC3.h gates the same range on
-- RegA001 & 0x80 and honours the write-protect bit at RegA001 & 0x40. A pass
-- here is a real signal; the unit suite's own save tests cannot produce one.
--
--   Mesen --testRunner test/lua/save_sram.lua <rom>
--
-- The ROM is sample-mmc1/, sample-mmc3/ or sample-rpg-mmc1/ -- the three
-- checked-in battery-save fixtures, one per save_sram.lua run (CLAUDE.md's
-- "six fixtures, deliberately"; see docs/design-rpg-save-fixture.md for why a
-- third exists here specifically). Everything this script walks to is
-- authored in their project JSON rather than grafted on at build time, so the
-- geometry below can be read out of tools/make-mmc1-sample.js /
-- tools/make-rpg-save-sample.js, or opened in the app and looked at:
--
--   * a 2x1 world map -- flat screen 0 is the start screen (west), flat
--     screen 1 holds the saver (east), open to each other along rows 5-8
--   * a separate title map, so ST_TITLE is where the ROM boots
--   * the player starts at (112, 112), which is inside that doorway
--   * the saver stands at (128, 96) with trigger 'touch', and its one page
--     runs setSwitch 0, setVar 0 = 7, give actor 0 (the gem) [, join member 1
--     on the RPG fixture only], then Save
--   * PLAYER_SPEED is 2, so every coordinate below stays even
--
-- All three fixtures are identical in that geometry and differ only in mapper
-- (MMC1 vs MMC3) or game type (action vs RPG), which is the entire point: one
-- walk, driven by one script, and the only thing that can make one board pass
-- and another fail is what actually differs about it.
--
-- **RPG detection.** The script does not take its game type as an argument
-- (Mesen passes none -- see the note on that a few paragraphs down); it
-- decides for itself, in phase 1, by reading `pc_level` slot 0 ($03A8,
-- engine/constants.asm) before any input. Boot runs init_session, which on an
-- RPG build reaches party_init (engine/battle.asm) via call_battle(BE_INIT);
-- party_init_slot writes `#1` to `pc_level,x` for *every* slot,
-- unconditionally, before it ever tests `pc_starts,x` -- so this is 1 for
-- every RPG build regardless of which member(s) start in the party. On an
-- action build nothing ever writes that byte: boot.asm's own RAM clear
-- (`lda #0` / `sta $0300,x` .. `sta $0700,x` over the reset's boot_clear loop)
-- zeroes it at reset and BATTLE_ENABLED code never runs to set it, so it
-- reads back exactly 0. This is what makes it a safe signal independent of
-- the save itself -- it is decided before SELECT is ever pressed, so which
-- assertions the rest of the script makes is never chosen by the very thing
-- being tested. Round 1 of this fixture used `pc_in_party` slot 0 instead,
-- which is a fail-open fixture assumption rather than a real detector: a
-- valid RPG only needs *some* member to start in the party, so a project
-- where member 0 does not would silently read as action and skip every RPG
-- assertion (round 2 review, finding 3). `pc_level` cannot fail open the same
-- way -- party_init_slot writes it before it branches on `pc_starts` at all --
-- so any value the detector reads that is neither 0 nor 1 is now a test
-- failure in its own right (`EXIT_DETECTOR_AMBIGUOUS`), not a silent
-- misclassification. `pc_in_party[0] == 1` is still asserted, in phases 4 and
-- 6, but now as this fixture's own authored invariant rather than the
-- detector: it fails loudly if member 0 is ever changed to not start in the
-- party, instead of quietly turning off the RPG branch that would have caught
-- it.
--
-- Where the RPG fixture's own party state is checked, it is checked in
-- addition to every existing assertion below, never instead of one -- the
-- action-board pass/fail shape (EXIT_* codes, phase numbers) is unchanged.
--
-- Mesen passes the script no arguments beyond what it reads from the ROM
-- itself (confirmed empirically -- neither `...` nor a global `arg` table
-- carries anything past the ROM path), and this sandboxed Lua cannot write a
-- file to hand state to a second process (io.open crashed the host process
-- outright when tried during development). So rather than requiring a
-- driver to tell this script which half of a power cycle it is running,
-- **the script determines that itself, by reading the save record's own marker
-- byte off the chip on the title screen before it touches a button**, and then
-- holds SELECT (bound to Continue in the title state -- see the fixtures'
-- input.json) to whichever behaviour that answer demands. The two are read
-- independently on purpose: inferring "there was no save" from "Continue did
-- nothing" would make the one thing being tested also the thing deciding what
-- the test expects, and a Continue that never worked at all would then read as
-- two clean runs.
--
--   - No marker on the chip: Mesen has nothing to load, so SELECT must leave
--     the title alone (leaving it is EXIT_CONTINUE_PRESENT_WITHOUT_SAVE). The
--     script then starts a new game, reaches the saver, and triggers the Save
--     -- exiting EXIT_RUN1_OK so the driver knows to launch Mesen again
--     against the same ROM path. Mesen persists SRAM to a .sav on disk keyed
--     by the ROM's own file name (confirmed empirically, and the reason
--     build_sram_roms.mjs copies each fixture's game.nes out under a
--     board-specific basename, or the two boards would silently share one save
--     slot). Two separate process invocations sharing that file are what makes
--     this a real power cycle rather than a soft reset.
--   - A marker on the chip (this is the second invocation): SELECT must load
--     it and resume gameplay (staying put is EXIT_CONTINUE_MISSING_WITH_SAVE).
--     The script then checks every piece of state the first run wrote --
--     switch, variable, bag, which of the two screens, and the exact resting
--     position, which is deterministic (fixed inputs, open screens, no
--     encounters on an action project) and hardcoded below from having watched
--     run 1 write it once.
--
-- Input is applied the way engine_smoke.lua does it: a `held` table set from
-- the endFrame phase logic below, re-sent to the controller on every single
-- inputPolled event by onInput. Calling emu.setInput directly from inside an
-- endFrame phase (an earlier version of this script did) applies a frame
-- late relative to inputPolled and was observed to lose held-button phases
-- entirely rather than merely lag -- this is the proven-working shape.
--
-- run_sram_check.sh drives the two invocations and interprets exit codes.

-- engine/constants.asm
local PLAYER_X    = 0x10
local PLAYER_Y    = 0x11
local FLAT_SCREEN = 0x16
local FRAME_CNT   = 0x1B
local GAME_STATE  = 0x25
local INV_COUNT   = 0x37
local SWITCHES    = 0x390
local VARIABLES   = 0x500
local PARTY_SIZE  = 0x65
local PC_HP_MAX   = 0x39C
local PC_MP_MAX   = 0x3A4
local PC_LEVEL    = 0x3A8
local PC_IN_PARTY = 0x3B4
local PC_SPELLS   = 0x3B8

local ST_GAMEPLAY = 0
local ST_DIALOG   = 2
local ST_TITLE    = 3

-- The RPG fixture's own two party members (tools/make-rpg-save-sample.js):
-- Rian (member 0, starts in the party, knows one spell -- catalog slot 0 --
-- from level 1) and Iris (member 1, recruited by the saver's own
-- `join member 1` moments before the Save, no spells at all). Neither ever
-- battles or levels up on this walk, so both stay at level 1 throughout --
-- pc_hp_max and pc_mp_max at level 1 are exactly createPartyMember's plain
-- baseHp/baseMp for both members (statAt(base, perLevel, 1) == base,
-- main/build/battletables.js). pc_spells is per-slot, not shared, precisely
-- because a spell known by *neither* member (the round-1 shape) makes this
-- assertion pass vacuously whether or not BE_RESTORE, or the raw save byte,
-- or nothing at all produced it -- Rian's bit 0 set and Iris's byte at 0 is
-- what a wrong restore (a stuck 0, a stuck 0xFF, a swapped slot) actually has
-- to get right. This still does not distinguish "the raw saved byte survived"
-- from "BE_RESTORE recomputed it" -- at level 1 both land on the same value
-- (test/unit/save.test.js is what proves the recomputation itself, on a build
-- where the two differ); what this fixture's own party/spell assertions
-- prove is narrower, and the mapper-gating claim itself rests on the WRAM
-- marker checks below, not on these numbers. Hardcoded here, in the Lua, the
-- same way SAVED_X/SAVED_Y are below rather than read out of the save record
-- itself -- see docs/design-rpg-save-fixture.md for how these were derived
-- and how to re-derive them if the fixture's own party ever changes;
-- test/lua/build_sram_roms.mjs prints the same numbers for the rpg-mmc1
-- board, per member, on every run, so a drift between the fixture and this
-- file is easy to catch by eye.
local RPG_PARTY_SIZE  = 2
local RPG_HP_MAX      = 24 -- createPartyMember's baseHp (both members)
local RPG_MP_MAX      = 8  -- createPartyMember's baseMp (both members)
local RPG_SPELLS_0    = 1  -- Rian: spell catalog slot 0, bit 0 set
local RPG_SPELLS_1    = 0  -- Iris: no spells learned

-- assets/save.inc (shared/save.js's SAVE_FIELDS, byte-for-byte -- restated
-- here rather than shared, the same choice test/unit/save.test.js makes,
-- because this file cannot import that module). Identical on both boards.
local SRAM_BASE          = 0x6000
local SAVE_PLAYER_X_OFF  = 0x01
local SAVE_PLAYER_Y_OFF  = 0x02
local SAVE_MARKER_OFFSET = 0x56
local SAVE_MARKER_VALID  = 0xA5

-- What the fixture's saver page writes, restated from
-- tools/make-mmc1-sample.js. Switch 0 is bit 0 of the first switches byte.
local SAVED_SWITCH_MASK = 0x01
local SAVED_VAR_INDEX   = 0
local SAVED_VAR_VALUE   = 7

-- Where the walk below leaves the player at the instant Save runs --
-- deterministic (fixed inputs, open screens, no encounters), and identical on
-- both boards because the two fixtures differ only in mapper. Hardcoded rather
-- than compared against the record's own bytes on purpose: run 2 reading the
-- save to decide what the save should say would assert nothing.
--
-- To re-observe after changing the walk or the fixtures: run 1 once, then read
-- the .sav Mesen wrote (~/.config/Mesen2/Saves/sram_<board>.sav), which is a
-- straight dump of the SRAM chip -- byte 0 is flat_screen, 1 is player_x, 2 is
-- player_y, per assets/save.inc. emu.log goes nowhere in --testRunner mode, so
-- the .sav is the only channel out of run 1 besides its exit code.
local SAVED_X = 118
local SAVED_Y = 100

-- The screen the saver stands on, and the one the player starts and returns
-- to. flattenScreens (main/build/generate.js) walks maps in order, so the 2x1
-- world map takes flat 0 and 1 and the title map takes flat 2.
local SCREEN_START = 0
local SCREEN_SAVER = 1

local EXIT_TIMEOUT                       = 99
local EXIT_NO_BOOT                       = 2
local EXIT_NO_TITLE                      = 3
local EXIT_NO_CROSS_TO_SAVER             = 4
local EXIT_SAVE_NEVER_WROTE              = 5
local EXIT_MARKER_LOST_AFTER_BANK_SWITCH = 6
local EXIT_STATE_WRONG_BEFORE_CYCLE      = 7
local EXIT_CONTINUE_MISSING_WITH_SAVE    = 8
local EXIT_CONTINUE_PRESENT_WITHOUT_SAVE = 9
local EXIT_RESTORED_STATE_WRONG          = 10
local EXIT_NO_ALIGN_TO_SAVER             = 11
local EXIT_NO_CROSS_BACK                 = 12
local EXIT_WRAM_LOST_AFTER_RESTORE       = 13 -- the SRAM marker did not survive continue_game's own BE_RESTORE bank switch
local EXIT_DETECTOR_AMBIGUOUS            = 14 -- pc_level slot 0 was neither 0 (action) nor 1 (RPG) at boot
local EXIT_RUN1_OK                       = 1 -- not a failure; see header comment

local frame = 0
local phase = 1
local mark = 0
local held = {}
local hasSave = false -- was a save already on the chip when this run booted?
local isRpg = false   -- decided in phase 1, before any input -- see the header comment
local restored = nil  -- run 2's snapshot of the loaded state, taken at the edge

local function read(address) return emu.read(address, emu.memType.nesMemory) end
-- The raw SRAM chip, bypassing the mapper's own access gating entirely --
-- used only as a negative control in phase 5 to prove the CPU-mapped reads
-- above are actually going through the mapper's own gate, not around it.
-- nesSaveRam addresses the chip itself, 0-based -- NOT the CPU's $6000+
-- window (confirmed empirically: reading SRAM_BASE + offset here silently
-- read the wrong location and made this negative control fail on every
-- build, broken and fixed alike, until this was caught).
local function readRaw(offset) return emu.read(offset, emu.memType.nesSaveRam) end

local function log(message) emu.log(string.format("[%5d] %s", frame, message)) end

local function fail(code, message)
  log("FAIL(" .. code .. "): " .. message)
  emu.stop(code)
end

local function onInput() emu.setInput(held, 0) end

local function saveWritten() return read(SRAM_BASE + SAVE_MARKER_OFFSET) == SAVE_MARKER_VALID end

local function onFrame()
  frame = frame + 1
  if frame > 4000 then fail(EXIT_TIMEOUT, "timed out in phase " .. phase); return end

  -- 1: boots, NMI running, sitting on the title. Whether a save is on the chip
  -- is read here, before SELECT is touched, and it is what says which half of
  -- the power cycle this invocation is -- so the two outcomes SELECT can have
  -- are each checked against an expectation formed independently of them,
  -- rather than one being inferred from the other.
  if phase == 1 then
    if frame < 20 then return end
    if read(FRAME_CNT) == 0 then fail(EXIT_NO_BOOT, "frame_cnt never advanced"); return end
    if read(GAME_STATE) ~= ST_TITLE then fail(EXIT_NO_TITLE, "did not boot to the title"); return end
    hasSave = saveWritten()
    log(hasSave and "a save is on the chip" or "no save on the chip")
    local detector = read(PC_LEVEL)
    if detector ~= 0 and detector ~= 1 then
      fail(EXIT_DETECTOR_AMBIGUOUS, "pc_level slot 0 read " .. detector .. ", neither 0 nor 1")
      return
    end
    isRpg = detector == 1
    log(isRpg and "RPG build detected (pc_level slot 0 is 1)" or "action build detected (pc_level slot 0 is 0)")
    held = { select = true }
    mark = frame
    phase = 2
    return
  end

  -- 2: SELECT decides which half of the power cycle this is -- see the header
  -- comment. Leaving the title at all means a save was found and loaded;
  -- staying on it for the whole window means there was none.
  --
  -- The restored state is snapshotted on the very first frame that leaves the
  -- title, and phase 6 asserts on that snapshot rather than on live RAM. The
  -- fixtures' saver page is guarded on the switch it sets, so nothing re-runs
  -- once the load is back; the snapshot is belt and braces for the reason that
  -- guard exists at all. Save records where the player is standing, and for a
  -- touch trigger that is on top of the actor that fired it, so Continue comes
  -- back mid-contact and spawn_entities arms the trigger again during the
  -- load's own redraw. Measured before the guard went in: the page had already
  -- re-run and put a second gem in the bag by the first frame this can observe,
  -- which is early enough that no snapshot could have got underneath it.
  if phase == 2 then
    if frame - mark < 8 then return end
    held = {}
    local state = read(GAME_STATE)
    if state ~= ST_TITLE then
      if not hasSave then
        fail(EXIT_CONTINUE_PRESENT_WITHOUT_SAVE, "Continue left the title with no save on the chip")
        return
      end
      restored = {
        state = state,
        flatScreen = read(FLAT_SCREEN),
        switches = read(SWITCHES),
        variable = read(VARIABLES + SAVED_VAR_INDEX),
        invCount = read(INV_COUNT),
        x = read(PLAYER_X),
        y = read(PLAYER_Y),
        -- Every board: the marker, read through the CPU-mapped view (the same
        -- one saveWritten() uses), at the first phase-2 observation after
        -- Continue leaves the title (phase 2 waits eight frames before
        -- reading state here) -- i.e. after continue_game's own
        -- call_battle(BE_RESTORE) has run and returned (.if BATTLE_ENABLED,
        -- engine/save.asm), which includes both its entry switch into the
        -- battle bank and its `jmp set_screen_ptr` exit switch back out. This
        -- is what phase 6 checks WRAM against; round 1 of this fixture never
        -- read WRAM again after either switch at all (round 2 review, finding
        -- 1) -- every other field in this snapshot is internal RAM, which
        -- load_apply_body had already copied the record into *before*
        -- BE_RESTORE ever ran, so none of them could have caught a BE_RESTORE
        -- that took WRAM away.
        sramMarker = read(SRAM_BASE + SAVE_MARKER_OFFSET),
        -- RPG-only fields -- see phase 6's own assertions. Snapshotted here
        -- for the identical reason every other field is: the saver page's
        -- guard keeps it from re-running, but the snapshot is belt and
        -- braces against exactly the re-run scenario the header comment on
        -- phase 2 already documents.
        partySize = read(PARTY_SIZE),
        pcInParty0 = read(PC_IN_PARTY + 0),
        pcInParty1 = read(PC_IN_PARTY + 1),
        pcLevel0 = read(PC_LEVEL + 0),
        pcLevel1 = read(PC_LEVEL + 1),
        pcHpMax0 = read(PC_HP_MAX + 0),
        pcHpMax1 = read(PC_HP_MAX + 1),
        pcMpMax0 = read(PC_MP_MAX + 0),
        pcMpMax1 = read(PC_MP_MAX + 1),
        pcSpells0 = read(PC_SPELLS + 0),
        pcSpells1 = read(PC_SPELLS + 1)
      }
      log("run 2: Continue loaded a save")
      phase = 6
      return
    end
    if frame - mark < 60 then return end
    if hasSave then
      fail(EXIT_CONTINUE_MISSING_WITH_SAVE, "Continue did nothing with a save on the chip")
      return
    end
    log("run 1: no save present, Continue correctly did nothing")
    held = { start = true }
    mark = frame
    phase = 3
    return
  end

  -- 3: Start begins a new game on flat screen 0 at (112, 112).
  if phase == 3 then
    if frame - mark < 6 then return end
    held = {}
    if frame - mark < 20 then return end
    if read(GAME_STATE) ~= ST_GAMEPLAY then fail(EXIT_NO_TITLE, "Start did not begin a new game"); return end
    -- 3a: east through the doorway onto the saver's screen. Crossing a screen
    -- edge is a real switch_prg_bank call, which is what has to happen between
    -- here and the Save for an MMC1 build to be proving anything: bit 4 of
    -- every PRG bank write is that board's WRAM-disable bit.
    held = { right = true }
    mark = frame
    phase = 3.1
    return
  end

  -- 3a: hold east until the crossing actually happens. cross_right sets
  -- player_x to 0, so this lands the player at (0, 112) -- west of the saver,
  -- which is what makes phase 3c a walk *into* it rather than past it.
  if phase == 3.1 then
    if read(FLAT_SCREEN) == SCREEN_SAVER then
      held = {}
      log(string.format("crossed east to screen %d at (%d, %d)",
        read(FLAT_SCREEN), read(PLAYER_X), read(PLAYER_Y)))
      mark = frame
      phase = 3.2
      return
    end
    if frame - mark > 300 then fail(EXIT_NO_CROSS_TO_SAVER, "never crossed east"); return end
    return
  end

  -- 3b: line up with the saver's row. It stands at y = 96 and is 16 pixels
  -- tall, so anything from ~82 to 111 overlaps it; stopping at 100 leaves
  -- margin on both sides rather than demanding an exact landing.
  if phase == 3.2 then
    held = { up = true }
    if read(PLAYER_Y) <= 100 then
      held = {}
      log(string.format("aligned to the saver's row at (%d, %d)", read(PLAYER_X), read(PLAYER_Y)))
      mark = frame
      phase = 3.3
      return
    end
    if frame - mark > 120 then fail(EXIT_NO_ALIGN_TO_SAVER, "never reached the saver's row"); return end
    return
  end

  -- 3c: walk east into the saver. Contact fires its touch trigger, whose page
  -- sets the switch, sets the variable, gives the gem and Saves.
  if phase == 3.3 then
    held = { right = true }
    if saveWritten() then
      held = {}
      mark = frame
      phase = 4
      return
    end
    -- The MMC3 fixture's page opens with a Say -- deliberately, because that
    -- board is the scanline-IRQ one and a message box is what puts the font
    -- split to work during real gameplay rather than only on the title. Say
    -- suspends the script, so the Save behind it does not land until the box
    -- is dismissed. The MMC1 fixture has no Say and never enters this phase;
    -- the script keys off the state it observes rather than off which board
    -- it was handed, so neither fixture needs the other's shape.
    if read(GAME_STATE) == ST_DIALOG then
      held = {}
      mark = frame
      phase = 3.4
      return
    end
    if frame - mark > 300 then fail(EXIT_SAVE_NEVER_WROTE, "walked east but the save never landed"); return end
    return
  end

  -- 3d: dismiss the box. Pulsed rather than held -- the engine advances on a
  -- fresh press, so a held button is one press, and the box needs one to
  -- finish typing and another to close. The world is frozen throughout, so
  -- the player is still standing exactly where contact stopped it, which is
  -- why the position this saves matches the board that never opened a box.
  if phase == 3.4 then
    if saveWritten() then
      held = {}
      mark = frame
      phase = 4
      return
    end
    local cycle = (frame - mark) % 12
    held = cycle < 4 and { a = true } or {}
    if frame - mark > 600 then fail(EXIT_SAVE_NEVER_WROTE, "the box never closed onto the Save"); return end
    return
  end

  -- 4: let the touch step settle, then confirm what is in RAM matches what the
  -- page was supposed to do -- through the CPU-mapped view, the same view
  -- gameplay itself reads and writes through.
  if phase == 4 then
    if frame - mark < 10 then return end
    if not saveWritten() then fail(EXIT_SAVE_NEVER_WROTE, "marker vanished after the save"); return end
    if (read(SWITCHES) & SAVED_SWITCH_MASK) == 0 then
      fail(EXIT_STATE_WRONG_BEFORE_CYCLE, "switch 0 not set"); return
    end
    if read(VARIABLES + SAVED_VAR_INDEX) ~= SAVED_VAR_VALUE then
      fail(EXIT_STATE_WRONG_BEFORE_CYCLE, "variable 0 not " .. SAVED_VAR_VALUE); return
    end
    if read(INV_COUNT) ~= 1 then
      fail(EXIT_STATE_WRONG_BEFORE_CYCLE, "inv_count is " .. read(INV_COUNT) .. ", not the one gem"); return
    end
    if read(FLAT_SCREEN) ~= SCREEN_SAVER then
      fail(EXIT_STATE_WRONG_BEFORE_CYCLE, "not on the saver's screen"); return
    end
    -- RPG-only. `party_size`/`pc_in_party`/`pc_level` below, like `switches`/
    -- `variable`/`inv_count` a few lines above, are internal RAM -- they
    -- verify what the saver's page put there (the saver's own `join member
    -- 1`, through call_battle(BE_JOIN), a real MMC1 PRG bank switch, moments
    -- before the Save above), but none of them observes WRAM itself: every
    -- one of them would read correctly even if BE_JOIN's bank switch had left
    -- WRAM disabled. Only `saveWritten()` a few lines above is SRAM-chip
    -- state (the marker at $6000+), and it alone is what proves WRAM was
    -- still reachable when the Save that immediately follows BE_JOIN on the
    -- same page actually ran (round 2 review, findings 1 and 10).
    if isRpg then
      if read(PARTY_SIZE) ~= RPG_PARTY_SIZE then
        fail(EXIT_STATE_WRONG_BEFORE_CYCLE, "party_size is " .. read(PARTY_SIZE) .. ", not " .. RPG_PARTY_SIZE); return
      end
      if read(PC_IN_PARTY + 0) ~= 1 then
        fail(EXIT_STATE_WRONG_BEFORE_CYCLE, "pc_in_party slot 0 is not set"); return
      end
      if read(PC_IN_PARTY + 1) ~= 1 then
        fail(EXIT_STATE_WRONG_BEFORE_CYCLE, "pc_in_party slot 1 is not set -- the field Join did not land"); return
      end
      if read(PC_LEVEL + 0) ~= 1 then
        fail(EXIT_STATE_WRONG_BEFORE_CYCLE, "pc_level slot 0 is " .. read(PC_LEVEL + 0) .. ", not 1"); return
      end
      if read(PC_LEVEL + 1) ~= 1 then
        fail(EXIT_STATE_WRONG_BEFORE_CYCLE, "pc_level slot 1 is " .. read(PC_LEVEL + 1) .. ", not 1"); return
      end
    end
    -- Cross back west -- a second real switch_prg_bank call, this time with
    -- the save already sitting in the chip -- to prove the marker written
    -- moments ago is still there through the mapper's own gated view after
    -- banking has moved on. This is what an MMC1 build needs: bit 4 of every
    -- later PRG bank write is the WRAM-disable bit, so a save that survives
    -- only its own write and not a subsequent ordinary bank switch would
    -- still pass a check that stopped here.
    held = { left = true }
    mark = frame
    phase = 5
    return
  end

  if phase == 5 then
    if read(FLAT_SCREEN) == SCREEN_START then
      held = {}
      if not saveWritten() then
        fail(EXIT_MARKER_LOST_AFTER_BANK_SWITCH, "marker gone after crossing back"); return
      end
      -- Negative control on the backdoor read: the raw chip must agree with
      -- the mapped view now that WRAM is known-enabled and idle. If these
      -- ever disagreed it would mean the checks above were reading around
      -- the mapper rather than through it, which would make them prove
      -- nothing about real hardware.
      if readRaw(SAVE_MARKER_OFFSET) ~= SAVE_MARKER_VALID then
        fail(EXIT_MARKER_LOST_AFTER_BANK_SWITCH, "raw chip and mapped view disagree"); return
      end
      log("run 1 complete: save survived a round trip across the screen edge")
      emu.stop(EXIT_RUN1_OK)
      return
    end
    if frame - mark > 300 then fail(EXIT_NO_CROSS_BACK, "never crossed back west"); return end
    return
  end

  -- 6 (run 2 only): Continue was pressed in phase 2 and it worked. It must
  -- have landed gameplay back on the saver's screen at the exact point Save
  -- was triggered, with every piece of saved state intact. Everything asserted
  -- here comes from the snapshot phase 2 took on the frame the title was left
  -- -- see the note there for why live RAM is not good enough.
  if phase == 6 then
    if restored.state ~= ST_GAMEPLAY then
      fail(EXIT_RESTORED_STATE_WRONG, "loaded into state " .. restored.state .. ", not gameplay"); return
    end
    if restored.flatScreen ~= SCREEN_SAVER then
      fail(EXIT_RESTORED_STATE_WRONG, "restored onto screen " .. restored.flatScreen); return
    end
    if (restored.switches & SAVED_SWITCH_MASK) == 0 then
      fail(EXIT_RESTORED_STATE_WRONG, "switch 0 did not survive"); return
    end
    if restored.variable ~= SAVED_VAR_VALUE then
      fail(EXIT_RESTORED_STATE_WRONG, "variable 0 restored as " .. restored.variable); return
    end
    -- Exactly one gem: the bag held one when Save ran, and the re-trigger that
    -- would add a second has not been given a frame to run yet. A loose ">= 1"
    -- here would pass on a load that restored an empty bag and then had the
    -- re-run refill it.
    if restored.invCount ~= 1 then
      fail(EXIT_RESTORED_STATE_WRONG, "inv_count restored as " .. restored.invCount .. ", not 1"); return
    end
    if restored.x ~= SAVED_X then
      fail(EXIT_RESTORED_STATE_WRONG, "player_x restored as " .. restored.x); return
    end
    if restored.y ~= SAVED_Y then
      fail(EXIT_RESTORED_STATE_WRONG, "player_y restored as " .. restored.y); return
    end
    -- Every board: the marker must still read through the CPU-mapped view at
    -- the first phase-2 observation after Continue leaves the title -- i.e.
    -- after continue_game's own call_battle(BE_RESTORE) (.if BATTLE_ENABLED,
    -- engine/save.asm) has run and returned -- on an action build there is no
    -- BE_RESTORE at all, so this is checking that ordinary gameplay leaves
    -- WRAM exactly as accessible as it always was; on the RPG board it is
    -- what actually proves BE_RESTORE's own bank switches (call_battle's own
    -- entry switch into the battle bank, and its `jmp set_screen_ptr` exit
    -- switch back to the screen bank) did not take WRAM away at either point.
    -- Round 1 of this fixture had no assertion that could ever fail here:
    -- every other value checked below is read out of internal RAM, which
    -- load_apply_body had already copied the save record into *before*
    -- BE_RESTORE ever ran, so a BE_RESTORE that disabled WRAM at any point
    -- would have left every one of them passing anyway (round 2 review,
    -- finding 1, confirmed against engine/save.asm's own
    -- load_apply_body/continue_game ordering).
    if restored.sramMarker ~= SAVE_MARKER_VALID then
      fail(EXIT_WRAM_LOST_AFTER_RESTORE, "SRAM marker read " .. restored.sramMarker .. " through the CPU-mapped view after Continue"); return
    end
    -- RPG-only: party_size/pc_in_party/pc_level are the save record's own raw
    -- bytes (shared/save.js's SAVE_FIELDS carries every pc_* array
    -- unconditionally) -- they prove the record itself, and BE_RESTORE's own
    -- entry into it, came back intact. pc_hp_max/pc_mp_max/pc_spells are what
    -- BE_RESTORE recomputes from the restored pc_level against this build's
    -- own tables (engine/battle.asm's party_apply_level); at level 1 the
    -- recomputed value and the raw saved value are numerically identical
    -- either way, so this does not distinguish "recomputed correctly" from
    -- "the raw byte merely survived" -- test/unit/save.test.js is what proves
    -- the recomputation itself, on a build where the two differ. What proves
    -- WRAM itself survived the BE_RESTORE bank switch is the marker check
    -- just above, which applies on every board, not only this one.
    if isRpg then
      if restored.partySize ~= RPG_PARTY_SIZE then
        fail(EXIT_RESTORED_STATE_WRONG, "party_size restored as " .. restored.partySize); return
      end
      if restored.pcInParty0 ~= 1 then
        fail(EXIT_RESTORED_STATE_WRONG, "pc_in_party slot 0 did not restore set"); return
      end
      if restored.pcInParty1 ~= 1 then
        fail(EXIT_RESTORED_STATE_WRONG, "pc_in_party slot 1 did not restore set"); return
      end
      if restored.pcLevel0 ~= 1 then
        fail(EXIT_RESTORED_STATE_WRONG, "pc_level slot 0 restored as " .. restored.pcLevel0); return
      end
      if restored.pcLevel1 ~= 1 then
        fail(EXIT_RESTORED_STATE_WRONG, "pc_level slot 1 restored as " .. restored.pcLevel1); return
      end
      if restored.pcHpMax0 ~= RPG_HP_MAX then
        fail(EXIT_RESTORED_STATE_WRONG, "pc_hp_max slot 0 restored as " .. restored.pcHpMax0); return
      end
      if restored.pcHpMax1 ~= RPG_HP_MAX then
        fail(EXIT_RESTORED_STATE_WRONG, "pc_hp_max slot 1 restored as " .. restored.pcHpMax1); return
      end
      if restored.pcMpMax0 ~= RPG_MP_MAX then
        fail(EXIT_RESTORED_STATE_WRONG, "pc_mp_max slot 0 restored as " .. restored.pcMpMax0); return
      end
      if restored.pcMpMax1 ~= RPG_MP_MAX then
        fail(EXIT_RESTORED_STATE_WRONG, "pc_mp_max slot 1 restored as " .. restored.pcMpMax1); return
      end
      if restored.pcSpells0 ~= RPG_SPELLS_0 then
        fail(EXIT_RESTORED_STATE_WRONG, "pc_spells slot 0 restored as " .. restored.pcSpells0); return
      end
      if restored.pcSpells1 ~= RPG_SPELLS_1 then
        fail(EXIT_RESTORED_STATE_WRONG, "pc_spells slot 1 restored as " .. restored.pcSpells1); return
      end
    end
    log("run 2 complete: every saved field came back")
    emu.stop(0)
  end
end

emu.addEventCallback(onFrame, emu.eventType.endFrame)
emu.addEventCallback(onInput, emu.eventType.inputPolled)
