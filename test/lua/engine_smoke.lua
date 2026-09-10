-- engine_smoke.lua -- headless verification of a Forge-built ROM (Mesen2).
--
--   Mesen --testRunner test/lua/engine_smoke.lua sample/build/game.nes
--
-- Exit code 0 = every phase passed. Any other code identifies the phase that
-- failed, so a CI run can tell what broke without reading the log.
--
-- The zero-page addresses come from engine/constants.asm.

local PLAYER_X    = 0x10
local PLAYER_Y    = 0x11
local PLAYER_DIR  = 0x12
local FLAT_SCREEN = 0x16
local FRAME_CNT   = 0x1B
local GAME_STATE  = 0x25

local ST_TITLE      = 3
local ST_NAMEENTRY  = 6

-- The naming grid, from engine/constants.asm and test/lib/naming.js's own
-- shared shape.
local BOX_STATE      = 0x40
local BOX_ROW        = 0x41
local BOX_TEXT_ROWS  = 4
local BOX_NAMEENTRY  = 9
local NM_ROW         = 0x059b
local NM_COL         = 0x059c

local EXIT_TIMEOUT       = 99
local EXIT_NO_BOOT       = 2
local EXIT_NO_MOVE       = 3
local EXIT_NO_COLLISION  = 4
local EXIT_NO_TRANSITION = 5
local EXIT_BAD_RETURN    = 6
local EXIT_TITLE_STUCK   = 7
local EXIT_NAMING_STUCK  = 8

local frame = 0
local phase = 1
local held = {}
local mark = 0
local note = {}

local function log(message)
  emu.log(string.format("[%5d] %s", frame, message))
end

local function fail(code, message)
  log("FAIL: " .. message)
  emu.stop(code)
end

local function pass(message)
  log("ok   " .. message)
end

local function read(address)
  return emu.read(address, emu.memType.nesMemory)
end

local function onInput()
  emu.setInput(held, 0)
end

local function onFrame()
  frame = frame + 1
  if frame > 2000 then
    fail(EXIT_TIMEOUT, "timed out in phase " .. phase)
    return
  end

  -- 1: the ROM boots and the engine's main loop is running.
  if phase == 1 then
    if frame < 30 then return end
    if read(FRAME_CNT) == 0 then
      fail(EXIT_NO_BOOT, "frame counter never advanced -- the NMI is not running")
      return
    end
    -- A project with a title screen (TITLE_ENABLED) boots onto it rather than
    -- into gameplay, and the world does not run while game_state stays
    -- ST_TITLE -- so phase 2's held-right walk would never move the player
    -- and this would misreport as EXIT_NO_MOVE. Press through it here,
    -- conditionally, the same way boot() (test/unit/items.test.js) does for
    -- the JS-side tests; a titleless project never sees game_state == ST_TITLE
    -- at all and falls straight through to the unconditional path below,
    -- unchanged from before this phase existed.
    if read(GAME_STATE) == ST_TITLE then
      pass("booted to the title -- pressing Start before the walk begins")
      held = { start = true }
      mark = frame
      phase = 1.5
      return
    end
    note.startX = read(PLAYER_X)
    note.startY = read(PLAYER_Y)
    note.startScreen = read(FLAT_SCREEN)
    pass(string.format("booted at x=%d y=%d screen=%d", note.startX, note.startY, note.startScreen))
    phase = 2
    held = { right = true }
    mark = frame
    return
  end

  -- 1.5: confirm Start actually cleared the title before trusting anything
  -- read after it -- a press that silently does nothing must not fall
  -- through into phase 2's walk and misreport as EXIT_NO_MOVE, so it gets
  -- its own exit code instead. note.startX/Y/startScreen are captured here,
  -- not in phase 1, because engine/boot.asm points flat_screen at the
  -- title's own flat screen number for as long as game_state is ST_TITLE
  -- (TITLE_FLAT_SCREEN, not START_SCREEN) -- reading it before the press
  -- would make every later phase compare screen crossings against the title
  -- map instead of the world the player is actually about to walk. Player
  -- x/y happen to already hold START_X/START_Y even before the press (boot
  -- sets them once, unconditionally, ahead of the title override), but they
  -- are re-read here too rather than relied on to still match after
  -- start_game (engine/title.asm) has run its own reset.
  if phase == 1.5 then
    if frame - mark < 6 then return end
    held = {}
    -- Start is a single press, not a hold -- 6 frames is comfortably longer
    -- than one input poll needs, and the remaining wait to frame 20 is dead
    -- time for start_game's own reset (engine/title.asm) to land before the
    -- check below, not more of the press.
    if frame - mark < 20 then return end
    if read(GAME_STATE) == ST_TITLE then
      fail(EXIT_TITLE_STUCK, "pressed Start for 6 frames and released, but the title still hadn't cleared 14 frames later")
      return
    end
    -- sample now carries hero naming on for real (docs/design-name-entry.md
    -- v16.4 §17 item 5), so Start opening the grid instead of gameplay
    -- outright is the expected case, not a stuck title -- phase 1.6 drives
    -- it to END with the seeded default name before phase 2's own walk.
    if read(GAME_STATE) == ST_NAMEENTRY then
      pass("Start opened the naming grid -- driving it to END before the walk begins")
      held = {}
      mark = frame
      phase = 1.6
      return
    end
    note.startX = read(PLAYER_X)
    note.startY = read(PLAYER_Y)
    note.startScreen = read(FLAT_SCREEN)
    pass(string.format("Start cleared the title -- x=%d y=%d screen=%d", note.startX, note.startY, note.startScreen))
    phase = 2
    held = { right = true }
    mark = frame
    return
  end

  -- 1.6: wait for the grid to finish raising -- the same two-part readiness
  -- gate test/lib/naming.js's own waitForNamingReady uses (box_state ==
  -- BOX_NAMEENTRY and box_row has reached BOX_TEXT_ROWS), so nothing is
  -- pressed against a box still mid-raise.
  if phase == 1.6 then
    if read(BOX_STATE) == BOX_NAMEENTRY and read(BOX_ROW) >= BOX_TEXT_ROWS then
      pass("naming grid finished raising")
      mark = frame
      phase = 1.61
      return
    end
    if frame - mark > 120 then
      fail(EXIT_NAMING_STUCK, "the naming grid never finished raising")
      return
    end
    return
  end

  -- 1.61: DOWN's own ring visits every row in the same forward order
  -- regardless of where it starts (0 -> 1 -> 2 -> 0), so pulsing it twice
  -- from the grid's own default row (0, upper-case) reaches row 2, the
  -- controls row -- test/lib/naming.js's own gotoCell idiom. Pulsed rather
  -- than held, the same reason phase 3d of save_sram.lua pulses A: the
  -- engine advances a selection on a fresh press, and a held button is one
  -- press, not a repeat.
  if phase == 1.61 then
    if read(NM_ROW) == 2 then
      held = {}
      pass("naming grid cursor reached the controls row")
      mark = frame
      phase = 1.62
      return
    end
    if frame - mark > 300 then
      fail(EXIT_NAMING_STUCK, "the naming grid cursor never reached the controls row")
      return
    end
    local cycle = (frame - mark) % 12
    held = cycle < 4 and { down = true } or {}
    return
  end

  -- 1.62: RIGHT from the controls row's own default column (0, DEL) reaches
  -- column 1, END.
  if phase == 1.62 then
    if read(NM_COL) == 1 then
      held = {}
      pass("naming grid cursor reached END")
      mark = frame
      phase = 1.63
      return
    end
    if frame - mark > 600 then
      fail(EXIT_NAMING_STUCK, "the naming grid cursor never reached END")
      return
    end
    local cycle = (frame - mark) % 12
    held = cycle < 4 and { right = true } or {}
    return
  end

  -- 1.63: confirm END with the seeded default name untouched, then wait for
  -- the session to hand off to gameplay. note.startX/Y/startScreen are
  -- captured only after this, not before -- the same reason phase 1.5
  -- itself re-reads them after start_game's own reset rather than trusting
  -- values read earlier in a different state.
  if phase == 1.63 then
    if read(GAME_STATE) ~= ST_NAMEENTRY then
      held = {}
      note.startX = read(PLAYER_X)
      note.startY = read(PLAYER_Y)
      note.startScreen = read(FLAT_SCREEN)
      pass(string.format("naming session ended -- x=%d y=%d screen=%d", note.startX, note.startY, note.startScreen))
      phase = 2
      held = { right = true }
      mark = frame
      return
    end
    if frame - mark > 300 then
      fail(EXIT_NAMING_STUCK, "the naming session never ended after confirming END")
      return
    end
    local cycle = (frame - mark) % 12
    held = cycle < 4 and { a = true } or {}
    return
  end

  -- 2: holding right moves the player and faces them right.
  if phase == 2 then
    if frame - mark < 20 then return end
    local x = read(PLAYER_X)
    if x <= note.startX then
      fail(EXIT_NO_MOVE, string.format("held right for 20 frames but x went %d -> %d", note.startX, x))
      return
    end
    if read(PLAYER_DIR) ~= 3 then
      fail(EXIT_NO_MOVE, "player is not facing right after moving right")
      return
    end
    pass(string.format("walked right x=%d -> %d", note.startX, x))
    note.rightX = x
    phase = 2.5
    held = { left = true }
    mark = frame
    return
  end

  -- 2.5: walk back into the north-south corridor the sample map keeps clear,
  -- so the later transition phases have a path to the screen edge.
  if phase == 2.5 then
    if frame - mark < 22 then return end
    local x = read(PLAYER_X)
    if x >= note.rightX then
      fail(EXIT_NO_MOVE, string.format("held left but x went %d -> %d", note.rightX, x))
      return
    end
    pass(string.format("walked back left x=%d -> %d", note.rightX, x))
    phase = 3
    held = { up = true }
    mark = frame
    return
  end

  -- 3: walking up runs into the tree wall along the top of the screen and stops.
  if phase == 3 then
    if frame - mark < 140 then return end
    local y = read(PLAYER_Y)
    if y == 0 then
      fail(EXIT_NO_COLLISION, "player reached y=0, so solid metatiles are not blocking")
      return
    end
    if read(FLAT_SCREEN) ~= note.startScreen then
      fail(EXIT_NO_COLLISION, "player left the screen through a wall")
      return
    end
    pass(string.format("blocked by the tree line at y=%d", y))
    note.wallY = y
    phase = 4
    held = { down = true }
    mark = frame
    return
  end

  -- 4: walking down far enough crosses into the screen below.
  if phase == 4 then
    if frame - mark < 220 then return end
    local screen = read(FLAT_SCREEN)
    if screen == note.startScreen then
      fail(
        EXIT_NO_TRANSITION,
        string.format("still on screen %d after walking down (y=%d)", screen, read(PLAYER_Y))
      )
      return
    end
    pass(string.format("crossed to screen %d at y=%d", screen, read(PLAYER_Y)))
    note.belowScreen = screen
    phase = 5
    held = { up = true }
    mark = frame
    return
  end

  -- 5: walking back up returns to the screen we started on.
  if phase == 5 then
    if frame - mark < 220 then return end
    local screen = read(FLAT_SCREEN)
    if screen ~= note.startScreen then
      fail(
        EXIT_BAD_RETURN,
        string.format("expected to return to screen %d but landed on %d", note.startScreen, screen)
      )
      return
    end
    pass("returned to the starting screen")
    log("all phases passed")
    emu.stop(0)
  end
end

emu.addEventCallback(onFrame, emu.eventType.endFrame)
emu.addEventCallback(onInput, emu.eventType.inputPolled)
