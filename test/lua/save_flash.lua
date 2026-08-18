-- save_flash.lua -- verifies UNROM 512's flash-backed save (engine/flash.asm,
-- engine/save.asm's save_media_fetch/save_media_commit) against Mesen2's own
-- FlashSST39SF040 model and its cross-process .ips persistence, neither of
-- which the vendored jsnes core used by the unit suite reproduces at all
-- (jsnes has no JEDEC state machine and no disk-backed artifact -- see
-- test/unit/flashsave.test.js's own header comment, which is exactly the gap
-- this file exists to close).
--
--   Mesen --testRunner test/lua/save_flash.lua <rom>
--
-- Division of labour with the unit suite, stated once rather than assumed:
-- test/unit/flashdriver.test.js proves the driver is genuinely RAM-resident
-- (its relocation and the vendored core's own busy model, added in phase 2.1
-- for exactly this purpose, are what make that provable at all). This file
-- proves the two things jsnes cannot: that Mesen's own JEDEC sequence
-- (unlock, command, erase, program, poll) accepts a correct driver and
-- rejects a broken one, and that the record genuinely survives a second,
-- independent Mesen process. Neither file proves both halves; see phase 2.5's
-- own note on why NOT to offer a RAM-residency break here -- Mesen's flash
-- model has no busy period at all (Core/NES/Mappers/Homebrew/FlashSST39SF040.h
-- -- Read() returns -1 unless _softwareId is set, so there is no DQ6 toggle
-- anywhere in this emulator), which means a driver that ran straight from ROM
-- would still pass under Mesen. That property is flashdriver.test.js's alone
-- to prove.
--
-- The same absence of a busy model means engine/flash.asm's own fd_poll --
-- two reads of $B000 EORed together, looping while bit 6 disagrees -- reads
-- the same settled value both times on this emulator and falls through on
-- its first pass every time. That is harmless (the poll still terminates and
-- returns), but it means **the poll itself is untested by this harness**: a
-- version of fd_poll that terminated too early on real hardware would still
-- pass every check below. Say so here rather than let a passing Mesen run
-- imply otherwise.
--
-- The ROM is sample-u512/ -- the third save-check fixture (CLAUDE.md's
-- "fixtures, deliberately"), same walk as sample-mmc1/ and sample-mmc3/,
-- mapper swapped and no opening Say (see tools/make-u512-sample.js's own
-- header for why not). Geometry, re-observed against a real build of this
-- fixture rather than assumed from MMC1's:
--
--   * a 2x1 world map -- flat screen 0 is the start screen (west), flat
--     screen 1 holds the saver (east), open to each other along rows 5-8
--   * a separate title map, so ST_TITLE is where the ROM boots
--   * the player starts at (112, 112), which is inside that doorway
--   * the saver stands at (128, 96) with trigger 'touch', and its one page
--     runs setSwitch 0, setVar 0 = 7, give actor 0 (the gem), then Save
--   * PLAYER_SPEED is 2, so every coordinate below stays even
--   * the resting position the walk below leaves the player at, (118, 100),
--     was re-observed against this fixture's own build (not copied from
--     save_sram.lua's MMC1 figure) and happens to match it exactly -- the
--     two fixtures share the same collision layout and PLAYER_SPEED, so
--     that agreement is expected, not assumed.
--
-- Same two-invocation, script-decides-its-own-half shape as save_sram.lua,
-- and the same reason for it: Mesen passes this script no arguments, and
-- sandboxed Lua cannot write a file to hand state to a second process, so
-- **the script determines which half of the power cycle it is running by
-- reading the save record's own marker byte before it touches a button**,
-- exactly as save_sram.lua's own header explains at more length. That
-- reasoning is not restated here beyond this paragraph; read it there.
--
-- The one real difference from save_sram.lua is *how the marker is read*:
--
--   - `emu.memType.nesSaveRam` is meaningless here -- there is no SRAM. The
--     record lives in PRG-ROM, bank SAVE_BANK, at $B000-$BFFF.
--   - This deliberately never reads CPU $B000 through nesMemory to check the
--     marker. Which 16 KB bank is mapped in at $8000-$BFFF at any given
--     frame depends on whatever the engine last banked in for unrelated
--     reasons (screen data, most of the time), so that read would be
--     nondeterministic -- a flaky *test*, not a flaky emulator, and the kind
--     of flake that is very easy to misdiagnose as the latter. The chip is
--     read directly instead, and that is the *primary* read throughout this
--     file, not a negative control the way save_sram.lua's readRaw is: there
--     is no CPU-mapped/raw-chip pair to cross-check here, because the
--     CPU-mapped route was never safe to use for this in the first place.
--   - The offset math below is deliberately PRG-relative -- SAVE_BANK*16384
--     + SECTOR_OFFSET, no header term -- and must **not** be reconciled with
--     main/build/pipeline.js's checkFlashSectorBlank, which adds a 16-byte
--     INES_HEADER because it indexes the whole .nes file on disk. Mesen's
--     emu.memType.nesPrgRom addresses PRG-ROM alone, as does the .ips patch
--     Mesen writes (confirmed by parsing one directly during phase 2.5's own
--     step A: its first record lands at exactly SAVE_BANK*16384+SECTOR_OFFSET,
--     no +16). Both offsets are correct in their own frame; they look like
--     they disagree only if you forget which frame each one lives in.
--   - The CPU-mapped counterpart worth having is the *RAM buffer*:
--     save_flash_buf ($0700, engine/constants.asm) is SAVE_BASE for this
--     medium, and save_check_valid's own save_media_fetch refreshes it from
--     the chip every time it runs -- including the periodic checks
--     title_tick makes while sitting on the title (engine/constants.asm's
--     comment on title_prompt_lo/hi), so by the time this script is looking
--     at the title at all, a fetch has already happened at least once. This
--     is read below as a second, independent proof after Continue -- but it
--     proves a different thing than save_sram.lua's mapped-view checks did:
--     not "the record survived," but "the fetch that copies the chip into
--     RAM actually ran and produced the right bytes." Described that way in
--     the assertion itself, not reused wording from the battery file.
--
-- The offsets restated below (SECTOR_OFFSET, SAVE_RECORD_LEN, the field
-- layout) are shared/save.js's SAVE_FIELDS and main/build/generate.js's
-- SAVE_BANK, byte-for-byte -- restated here rather than shared, the same
-- choice save_sram.lua makes, because this Lua cannot import that module.
--
-- Declared in this order -- locals before the functions that close over them
-- -- because getting it backwards is a real trap this file's own author hit
-- while writing the throwaway experiment for step A: a `log` helper written
-- above `local frame = 0` closes over a *global* `frame` (nil, since the
-- local did not exist yet at that point in the source), so every call to it
-- throws. --testRunner mode discards emu.log entirely (confirmed empirically,
-- same as save_sram.lua's own note on it), so the failure mode is not an
-- error message -- it is total silence and a run that never advances past
-- whatever phase first tried to log, indistinguishable from a hang until
-- someone bisects the script by hand.

-- engine/constants.asm
local PLAYER_X    = 0x10
local PLAYER_Y    = 0x11
local FLAT_SCREEN = 0x16
local FRAME_CNT   = 0x1B
local GAME_STATE  = 0x25
local INV_COUNT   = 0x37
local SWITCHES    = 0x390
local VARIABLES   = 0x500

local ST_GAMEPLAY = 0
local ST_TITLE    = 3

-- assets/config.inc / assets/save.inc for sample-u512's own build (mapper 30
-- always lands the sector in bank 30 -- shared/cartridge.js's
-- flashSaveSectorBank -- but this is restated as a literal, not derived, the
-- same reason SAVE_RECORD_LEN is: this Lua cannot import that module either).
local SAVE_BANK          = 30
local SECTOR_OFFSET      = 0x3000
local SAVE_RECORD_LEN    = 87
local SAVE_BODY_LEN      = 80 -- assets/save.inc's SAVE_BODY_LEN for this fixture
local SAVE_CHECKSUM_LO_OFFSET = SAVE_BODY_LEN     -- SAVE_CHECKSUM_LO - SAVE_BASE
local SAVE_CHECKSUM_HI_OFFSET = SAVE_BODY_LEN + 1 -- SAVE_CHECKSUM_HI - SAVE_BASE
local SAVE_IDENTITY_OFFSET    = SAVE_BODY_LEN + 2 -- SAVE_IDENTITY_0_ADDR - SAVE_BASE; 4 bytes
local SAVE_MARKER_OFFSET = SAVE_RECORD_LEN - 1
local SAVE_MARKER_VALID  = 0xA5

-- save_flash_buf (engine/constants.asm) -- SAVE_BASE for a flash build. See
-- the header comment above for what a check against this proves that a check
-- against the chip does not.
local SAVE_FLASH_BUF = 0x0700

-- What the fixture's saver page writes, restated from tools/make-u512-sample.js.
local SAVED_SWITCH_MASK = 0x01
local SAVED_VAR_INDEX   = 0
local SAVED_VAR_VALUE   = 7

-- Re-observed against a real build of sample-u512/ (see the header comment) --
-- deterministic for the same reasons save_sram.lua's own SAVED_X/Y are.
local SAVED_X = 118
local SAVED_Y = 100

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
local EXIT_SECOND_COMMIT_CORRUPTED       = 13 -- see phase 4.4's own comment
local EXIT_RAM_BUFFER_MISMATCH           = 14
local EXIT_MARKER_INVALID_AFTER_CHANGE   = 15 -- see phase 4.4's own comment
local EXIT_IDENTITY_CHANGED_AFTER_RETOUCH = 16
local EXIT_METADATA_CHANGED_WITHOUT_BODY = 17
local EXIT_SECOND_COMMIT_OK              = 18 -- not a failure; see phase 4.4's own comment
local EXIT_RUN1_OK                       = 1 -- not a failure; see save_sram.lua's header comment

local frame = 0
local phase = 1
local mark = 0
local held = {}
local hasSave = false
local restored = nil
local preRecord = nil -- phase 4's full-record snapshot, read by phase 4.4

local function read(address) return emu.read(address, emu.memType.nesMemory) end
local function readPrg(offset) return emu.read(SAVE_BANK * 16384 + SECTOR_OFFSET + offset, emu.memType.nesPrgRom) end

local function log(message) emu.log(string.format("[%5d] %s", frame, message)) end

local function fail(code, message)
  log("FAIL(" .. code .. "): " .. message)
  emu.stop(code)
end

local function onInput() emu.setInput(held, 0) end

-- The primary read throughout this file -- see the header comment for why
-- this is a direct chip read rather than anything CPU-mapped.
local function saveWritten() return readPrg(SAVE_MARKER_OFFSET) == SAVE_MARKER_VALID end

-- The full record, read off the chip byte by byte into a plain array
-- (0-indexed, matching the offsets restated above). Phase 4 snapshots this
-- before the retouch and phase 4.4 snapshots it again after. Every one of
-- the SAVE_RECORD_LEN bytes is compared -- not a checksum of them, and (see
-- the split between bodyEqual and metadataEqual below) not only the body
-- either, despite an earlier round of this file claiming exactly that while
-- the code still checked the body alone: a change confined to the checksum,
-- identity or marker bytes read as "the guard held" until metadataEqual
-- closed that gap. A checksum is a many-to-one summary by design (that is
-- what makes it cheap on a 6502), so two differently-changed bodies can
-- share one: clearing the same bit at two same-parity offsets leaves both
-- of save_checksum's running sums unchanged mod 256 while the bytes
-- themselves plainly differ. Lua has no such budget to respect, so there is
-- no reason to inherit the engine's lossy comparison for a question ("did
-- anything change") the engine's own checksum was never built to answer
-- exactly.
local function readRecord()
  local record = {}
  for i = 0, SAVE_RECORD_LEN - 1 do record[i] = readPrg(i) end
  return record
end

-- The same running-pair checksum engine/save.asm's save_checksum computes,
-- over a record already read into Lua by readRecord() -- two sums over the
-- SAVE_BODY_LEN body bytes, sum2 a running total *of* sum1, both wrapping at
-- 256. This is the one place in this file a checksum-shaped summary is
-- actually the right tool: phase 4.4 uses it only to check whether a body it
-- has *already* proven changed is internally consistent with what got
-- stored as the record's own checksum, which is exactly the comparison
-- save_check_valid itself makes.
local function checksumOf(record)
  local sum1, sum2 = 0, 0
  for i = 0, SAVE_BODY_LEN - 1 do
    sum1 = (sum1 + record[i]) % 256
    sum2 = (sum2 + sum1) % 256
  end
  return sum1, sum2
end

local function bodyEqual(a, b)
  for i = 0, SAVE_BODY_LEN - 1 do
    if a[i] ~= b[i] then return false end
  end
  return true
end

local function identityEqual(a, b)
  for i = SAVE_IDENTITY_OFFSET, SAVE_IDENTITY_OFFSET + 3 do
    if a[i] ~= b[i] then return false end
  end
  return true
end

-- The record's metadata -- checksum, identity and marker, offsets
-- SAVE_BODY_LEN..SAVE_RECORD_LEN-1 -- as opposed to bodyEqual's body.
-- readRecord() snapshots all SAVE_RECORD_LEN bytes, but bodyEqual only ever
-- walked the body; phase 4.4 used that alone to decide "unchanged" and so
-- took no notice of a change confined to this range, which would report as
-- "the guard held" while the checksum, identity or marker had actually moved
-- underneath it. This is what closes that gap.
local function metadataEqual(a, b)
  for i = SAVE_BODY_LEN, SAVE_RECORD_LEN - 1 do
    if a[i] ~= b[i] then return false end
  end
  return true
end

local function onFrame()
  frame = frame + 1
  if frame > 4500 then fail(EXIT_TIMEOUT, "timed out in phase " .. phase); return end

  -- 1: boots, NMI running, sitting on the title. Whether a save is on the
  -- chip is read here, before SELECT is touched -- see save_sram.lua's header
  -- for why this and phase 2's read of what SELECT actually did are kept
  -- independent of each other.
  if phase == 1 then
    if frame < 20 then return end
    if read(FRAME_CNT) == 0 then fail(EXIT_NO_BOOT, "frame_cnt never advanced"); return end
    if read(GAME_STATE) ~= ST_TITLE then fail(EXIT_NO_TITLE, "did not boot to the title"); return end
    hasSave = saveWritten()
    log(hasSave and "a save is on the chip" or "no save on the chip")
    held = { select = true }
    mark = frame
    phase = 2
    return
  end

  -- 2: SELECT decides which half of the power cycle this is.
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
        -- The RAM-buffer proof: save_media_fetch's own copy, read back
        -- through the CPU-mapped view at SAVE_FLASH_BUF -- see the header
        -- comment for what this proves that the chip-level checks do not.
        bufMarker = read(SAVE_FLASH_BUF + SAVE_MARKER_OFFSET)
      }
      log("run 2: Continue loaded a save")
      phase = 8
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
    held = { right = true }
    mark = frame
    phase = 3.1
    return
  end

  -- 3a: hold east until the crossing actually happens.
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

  -- 3b: line up with the saver's row.
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

  -- 3c: walk east into the saver. Contact fires its touch trigger, whose
  -- page sets the switch, sets the variable, gives the gem and Saves --
  -- erase-then-program, engine/flash.asm, all committed under forced blank
  -- inside a single frame's worth of world-freeze, so there is no MMC3-style
  -- dialogue phase to wait through here the way save_sram.lua's own phase 3c
  -- has: see tools/make-u512-sample.js's header for why this fixture has no
  -- opening Say.
  if phase == 3.3 then
    held = { right = true }
    if saveWritten() then
      held = {}
      mark = frame
      phase = 4
      return
    end
    if frame - mark > 300 then fail(EXIT_SAVE_NEVER_WROTE, "walked east but the save never landed"); return end
    return
  end

  -- 4: let the touch step settle, then confirm RAM matches what the page was
  -- supposed to do, through the CPU-mapped view gameplay itself reads and
  -- writes through -- the marker check alone stays on the chip (see header).
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
    -- Snapshot the whole committed record before the retouch below -- what
    -- phase 4.4 actually checks against, since the marker byte alone
    -- cannot: the second commit rewrites the marker with the value it
    -- already holds ($A5 & $A5 = $A5, byte programming on this chip is
    -- AND-only), so no bit of the marker ever needs to go 0 -> 1 and it
    -- stays valid whether the retouch happened at all, happened and landed
    -- cleanly, or happened and corrupted the body. The body is what
    -- actually moves.
    preRecord = readRecord()
    held = { down = true }
    mark = frame
    phase = 4.1
    return
  end

  -- 4.1/4.2: step off the saver and straight back onto it. The page is
  -- guarded on the switch it just set, so on a correct build (and under
  -- both u512-no-unlock and u512-bad-cmd-addr, which never touch the
  -- project) this is a genuine no-op: the page's cond does not match a
  -- second time, no commit happens, and phase 4.4 below finds the body
  -- unchanged and moves on. Its real job is a build-time one, for
  -- run_flash_check.sh's own --break=u512-no-erase and its positive-control
  -- counterpart --break=u512-second-commit-ok, both of which strip this
  -- fixture's switch guard (build_flash_roms.mjs) so a *second* commit to
  -- the same sector actually happens here -- the only place in this file
  -- that exercises one at all, and the only shape either an omitted-erase
  -- corruption or a clean second commit can be observed in.
  if phase == 4.1 then
    if frame - mark < 8 then return end
    held = { up = true }
    mark = frame
    phase = 4.2
    return
  end
  if phase == 4.2 then
    if frame - mark < 8 then return end
    held = {}
    mark = frame
    phase = 4.3
    return
  end
  -- 4.3: let a second commit, if the retouch actually triggered one, finish
  -- running before phase 4.4 reads the result.
  if phase == 4.3 then
    if frame - mark < 30 then return end
    mark = frame
    phase = 4.4
    return
  end
  -- 4.4: the assertion phase 4.3 used to skip straight past. Body-unchanged
  -- and metadata-unchanged is a legitimate, expected outcome on every build
  -- where the guard is intact (production and both unlock breaks) -- there
  -- is nothing to check further and this phase must not fail on it. Every
  -- other outcome is a distinct, separately-coded exit rather than folded
  -- into either "unchanged, carry on" or a single generic failure, because
  -- two different rounds of review each found a case that collapsing them
  -- had been quietly swallowing:
  --
  --   - Body changed but the guard should have blocked it at all (only
  --     --break=u512-no-erase and --break=u512-second-commit-ok relax the
  --     guard to produce a real second commit) -- checked, in order, against
  --     the three things save_check_valid itself gates a load on
  --     (engine/save.asm:212-253: marker, then identity, then checksum),
  --     because "defence in depth past the marker caught it" means asserting
  --     all three, not just noticing the checksum disagrees:
  --       1. The marker must still read valid. It always will (see phase 4's
  --          own comment on $A5 & $A5), so this is asserted for completeness
  --          rather than because it is expected to ever fail here.
  --       2. The identity bytes must be unchanged from the pre-retouch
  --          snapshot -- both commits are the same project, so they are
  --          always written with the same four bytes, and AND-ing a byte
  --          onto itself is a no-op with or without an erase between the
  --          two commits.
  --       3. The checksum recomputed over the *current* body (the exact
  --          bytes just read, not a second independent chip read) is
  --          compared against what is actually stored. A mismatch here
  --          (EXIT_SECOND_COMMIT_CORRUPTED) is --break=u512-no-erase's own
  --          signature: whichever bits the new body needed set that the
  --          first commit had already cleared are the ones this
  --          byte-program-only chip cannot set back, so the body it ends up
  --          with is neither the old record nor the new one. A match
  --          (EXIT_SECOND_COMMIT_OK) is --break=u512-second-commit-ok's own
  --          signature, and its own exit code rather than falling through to
  --          EXIT_RUN1_OK the way the unchanged path does: that fall-through
  --          is exactly what let an earlier round of this file's own
  --          positive control pass without this branch ever running at all
  --          -- a retouch that silently stopped happening, or a guard
  --          relaxation that silently did not take, produced the identical
  --          EXIT_RUN1_OK a real changed-and-matching commit does. Only this
  --          branch may emit EXIT_SECOND_COMMIT_OK, so run_flash_check.sh
  --          can require it exactly and mean "the comparison ran and
  --          matched," not "the round trip finished somehow."
  --   - Body unchanged but the metadata (checksum, identity or marker --
  --     metadataEqual, SAVE_BODY_LEN..SAVE_RECORD_LEN-1) did not agree with
  --     the pre-retouch snapshot either (EXIT_METADATA_CHANGED_WITHOUT_BODY)
  --     -- a change bodyEqual alone cannot see, since it only ever walked
  --     the body. Nothing on any build this file knows how to construct
  --     produces this today; it exists so a future change to the retouch
  --     phases, or a new break mode, cannot reintroduce the exact gap round
  --     4's own review found -- "unchanged" silently meaning "the body
  --     didn't move," not "nothing did."
  if phase == 4.4 then
    local postRecord = readRecord()
    local bodySame = bodyEqual(preRecord, postRecord)
    if bodySame and metadataEqual(preRecord, postRecord) then
      log("record unchanged after the retouch (body and metadata both identical) -- the guard held, as expected on this build")
      held = { left = true }
      mark = frame
      phase = 5
      return
    end
    if bodySame then
      fail(
        EXIT_METADATA_CHANGED_WITHOUT_BODY,
        "body unchanged after the retouch but the checksum, identity or marker metadata changed underneath it"
      )
      return
    end
    if postRecord[SAVE_MARKER_OFFSET] ~= SAVE_MARKER_VALID then
      fail(
        EXIT_MARKER_INVALID_AFTER_CHANGE,
        string.format("body changed after the retouch and the marker no longer reads valid (%02X)", postRecord[SAVE_MARKER_OFFSET])
      )
      return
    end
    if not identityEqual(preRecord, postRecord) then
      fail(EXIT_IDENTITY_CHANGED_AFTER_RETOUCH, "body changed after the retouch and the identity bytes changed with it")
      return
    end
    local postSum1, postSum2 = checksumOf(postRecord)
    local storedLo = postRecord[SAVE_CHECKSUM_LO_OFFSET]
    local storedHi = postRecord[SAVE_CHECKSUM_HI_OFFSET]
    if postSum1 == storedLo and postSum2 == storedHi then
      log("body changed after the retouch, marker and identity still validate, and the checksum still matches -- a clean second commit")
      emu.stop(EXIT_SECOND_COMMIT_OK)
      return
    end
    fail(
      EXIT_SECOND_COMMIT_CORRUPTED,
      string.format(
        "body changed after the retouch (marker and identity still validate) but its checksum does not match " ..
          "a recompute over it (stored %02X%02X, computed %02X%02X) -- a second commit corrupted the record",
        storedHi, storedLo, postSum2, postSum1
      )
    )
    return
  end

  -- 5: cross back west -- a second real bank switch, this time with the save
  -- already sitting in the chip, to prove the marker written moments ago
  -- (and, on the retouch above, possibly rewritten) is still there once
  -- SAVE_BANK is no longer the mapped-in bank.
  if phase == 5 then
    if read(FLAT_SCREEN) == SCREEN_START then
      held = {}
      if not saveWritten() then
        fail(EXIT_MARKER_LOST_AFTER_BANK_SWITCH, "marker gone after crossing back"); return
      end
      log("run 1 complete: save survived a round trip across the screen edge")
      emu.stop(EXIT_RUN1_OK)
      return
    end
    if frame - mark > 300 then fail(EXIT_NO_CROSS_BACK, "never crossed back west"); return end
    return
  end

  -- 8 (run 2 only): Continue was pressed in phase 2 and it worked.
  if phase == 8 then
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
    if restored.invCount ~= 1 then
      fail(EXIT_RESTORED_STATE_WRONG, "inv_count restored as " .. restored.invCount .. ", not 1"); return
    end
    if restored.x ~= SAVED_X then
      fail(EXIT_RESTORED_STATE_WRONG, "player_x restored as " .. restored.x); return
    end
    if restored.y ~= SAVED_Y then
      fail(EXIT_RESTORED_STATE_WRONG, "player_y restored as " .. restored.y); return
    end
    -- The RAM-buffer proof (see header comment): save_media_fetch's own copy
    -- should read as valid too, independent of the chip-level marker already
    -- checked at the moment Continue was pressed.
    if restored.bufMarker ~= SAVE_MARKER_VALID then
      fail(EXIT_RAM_BUFFER_MISMATCH, "save_flash_buf's marker was " .. restored.bufMarker .. ", fetch did not land"); return
    end
    log("run 2 complete: every saved field came back, and the RAM buffer agrees")
    emu.stop(0)
  end
end

emu.addEventCallback(onFrame, emu.eventType.endFrame)
emu.addEventCallback(onInput, emu.eventType.inputPolled)
