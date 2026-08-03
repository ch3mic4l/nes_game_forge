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

local EXIT_TIMEOUT       = 99
local EXIT_NO_BOOT       = 2
local EXIT_NO_MOVE       = 3
local EXIT_NO_COLLISION  = 4
local EXIT_NO_TRANSITION = 5
local EXIT_BAD_RETURN    = 6

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
    note.startX = read(PLAYER_X)
    note.startY = read(PLAYER_Y)
    note.startScreen = read(FLAT_SCREEN)
    pass(string.format("booted at x=%d y=%d screen=%d", note.startX, note.startY, note.startScreen))
    phase = 2
    held = { right = true }
    mark = frame
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
