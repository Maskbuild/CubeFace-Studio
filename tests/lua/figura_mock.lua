-- A small stand-in for the Figura Lua API, good enough to run exported avatars in tests.
-- It runs the scripts, fires events, presses every wheel button and calls every ping, so
-- typos, nil calls and wrong arguments show up as Lua errors.
--
-- Inputs (globals set from JS): FILES = { ["path/name.lua"] = source, ... },
-- AUTOSCRIPTS = { "script", ... } or nil, EXTRA_HEAD_MODELS = { "glass", ... }

unpack = unpack or table.unpack

-- ---- vectors ------------------------------------------------------------------------------
local V = {}
local function vec(...)
  local t = { ... }
  for i = 1, #t do t[i] = tonumber(t[i]) or 0 end
  return setmetatable(t, V)
end
local KEYS = { x = 1, y = 2, z = 3, w = 4, r = 1, g = 2, b = 3, a = 4 }
local methods = {}
V.__index = function(t, k)
  if KEYS[k] then return rawget(t, KEYS[k]) or 0 end
  if type(k) == "string" and #k > 1 and k:match("^[xyzw]+$") then
    local out = {}
    for c in k:gmatch(".") do out[#out + 1] = rawget(t, KEYS[c]) or 0 end
    return vec(unpack(out))
  end
  if methods[k] then return methods[k] end
  -- any other vector method: keep the vector (setters, in-place maths)
  return function(self) return self end
end
V.__newindex = function(t, k, v)
  if KEYS[k] then rawset(t, KEYS[k], v) else rawset(t, k, v) end
end
local function op(f)
  return function(a, b)
    local va, vb = getmetatable(a) == V, getmetatable(b) == V
    local n = math.max(va and #a or 0, vb and #b or 0)
    local out = {}
    for i = 1, n do out[i] = f(va and (rawget(a, i) or 0) or a, vb and (rawget(b, i) or 0) or b) end
    return vec(unpack(out))
  end
end
V.__add = op(function(a, b) return a + b end)
V.__sub = op(function(a, b) return a - b end)
V.__mul = op(function(a, b) return a * b end)
V.__div = op(function(a, b) return a / b end)
V.__mod = op(function(a, b) return a % b end)
V.__unm = function(a) return a * -1 end
V.__len = function(a) return rawlen(a) end
V.__eq = function(a, b)
  for i = 1, math.max(#a, #b) do if (a[i] or 0) ~= (b[i] or 0) then return false end end
  return true
end
V.__tostring = function(a) return "vec(" .. table.concat(a, ", ") .. ")" end
function methods.unpack(self) return unpack(self) end
function methods.augmented(self, n) local t = { unpack(self) }; t[#t + 1] = n or 1; return vec(unpack(t)) end
function methods.copy(self) return vec(unpack(self)) end
function methods.length(self) local s = 0; for i = 1, #self do s = s + self[i] ^ 2 end; return math.sqrt(s) end
function methods.lengthSquared(self) return methods.length(self) ^ 2 end
function methods.normalized(self) local l = methods.length(self); return l > 0 and self / l or vec(unpack(self)) end
function methods.dot(self, o) local s = 0; for i = 1, #self do s = s + self[i] * (o[i] or 0) end; return s end
function methods.toRad(self) return self * (math.pi / 180) end
function methods.toDeg(self) return self * (180 / math.pi) end
function methods.floor(self) local t = {}; for i = 1, #self do t[i] = math.floor(self[i]) end; return vec(unpack(t)) end
_G.vec = vec
vectors = setmetatable({ vec = vec, vec2 = vec, vec3 = vec, vec4 = vec, rgbToHex = function() return "ffffff" end }, {
  -- colour helpers (hexToRGB, hsvToRGB, rgbToHSV…): a colour vector
  __index = function() return function() return vec(1, 1, 1) end end
})

function math.lerp(a, b, t) return a + (b - a) * t end
function math.clamp(v, lo, hi) return math.max(lo, math.min(hi, v)) end
function math.round(v) return math.floor(v + 0.5) end
function math.sign(v) return v > 0 and 1 or v < 0 and -1 or 0 end
function math.map(v, a, b, c, d) return c + (v - a) / (b - a) * (d - c) end
local mmax, mmin = math.max, math.min
-- Figura's math works on vectors too
math.max = function(a, ...) if getmetatable(a) == V then return a end return mmax(a, ...) end
math.min = function(a, ...) if getmetatable(a) == V then return a end return mmin(a, ...) end

-- ---- generic API objects --------------------------------------------------------------------
CALLBACKS = {}
local MOCK = {}
local time = 0
local function mock(name, ptype)
  return setmetatable({ __name = name, __ptype = ptype or "None", __kids = {}, __order = {}, __fields = {}, __method = false }, MOCK)
end
local function isMock(v) return getmetatable(v) == MOCK end

-- what a method returns, by name (anything else: the object itself, for chaining)
local function call(owner, name, ...)
  local args = { ... }
  for _, a in ipairs(args) do
    if type(a) == "function" then CALLBACKS[#CALLBACKS + 1] = { name = name, fn = a, owner = owner } end
  end
  if name == "getChildren" then
    local out = {}
    for _, k in ipairs(owner.__order) do
      local c = owner.__kids[k]
      if c and not c.__method then out[#out + 1] = c end
    end
    return out
  end
  if name == "getParentType" then return owner.__ptype end
  if name == "getName" then return owner.__name end
  if name == "getTitle" then return owner.__title end
  if name == "getSystemTime" then time = time + 50; return time end
  if name == "getScaledWindowSize" or name == "getWindowSize" then return vec(854, 480) end
  if name == "getTextWidth" then return 10 end
  if name == "getFOV" then return 70 end
  if name == "getUUID" then return "00000000-0000-0000-0000-000000000000" end
  if name == "getScreen" then return nil end
  if name == "getTextures" then return { mock("texture") } end
  if name:match("Yaw$") or name:match("Time$") or name:match("Age$") or name:match("Level$") or name:match("Width$") or name:match("Height$") or name:match("Count$") or name:match("Health$") then
    return math.random() * 10
  end
  if name:match("^is") or name:match("^has") then return name == "isHost" or name == "isLoaded" end
  if name:match("Rot$") or name:match("^getRot") or name:match("^getPos") or name:match("Pos$") or name:match("^getVelocity") or name:match("^getLookDir") or name:match("^getScale") or name:match("^getMousePos") then
    return vec(math.random() * 20 - 10, math.random() * 60 - 30, 0)
  end
  if name:match("^new") or name:match("^get") or name == "of" or name == "fromVanilla" or name == "copy" then
    local m = mock(name)
    if name == "newPage" then m.__title = args[1] end
    return m
  end
  if name == "title" or name == "setTitle" then owner.__title = args[1] end
  return owner
end

MOCK.__index = function(t, k)
  local f = rawget(t, "__fields")[k]
  if f ~= nil then return f end
  local kids = rawget(t, "__kids")
  if kids[k] == nil then
    kids[k] = mock(k)
    kids[k].__owner = t
    local order = rawget(t, "__order")
    order[#order + 1] = k
  end
  return kids[k]
end
MOCK.__newindex = function(t, k, v) rawget(t, "__fields")[k] = v end
MOCK.__call = function(self, owner, ...)
  -- obj:method(...) indexes "method" (a mock) and calls it with the owner first
  self.__method = true
  if isMock(owner) and owner ~= self then return call(owner, self.__name, ...) end
  return call(self.__owner or self, self.__name, owner, ...)
end
MOCK.__add = function(a) return a end
MOCK.__sub = MOCK.__add
MOCK.__mul = MOCK.__add
MOCK.__div = MOCK.__add
MOCK.__unm = function(a) return a end
MOCK.__lt = function() return false end
MOCK.__le = function() return false end
MOCK.__len = function() return 0 end
MOCK.__concat = function(a, b) return tostring(isMock(a) and a.__name or a) .. tostring(isMock(b) and b.__name or b) end
MOCK.__tostring = function(a) return "mock:" .. tostring(a.__name) end

-- ---- globals --------------------------------------------------------------------------------
models = mock("models")
local own = models.model
local head = mock("Head", "Head")
own.__kids.Head = head
own.__order[#own.__order + 1] = "Head"
for _, name in ipairs(EXTRA_HEAD_MODELS or {}) do
  local m = models[name]
  local h = mock("Head", "Head")
  m.__kids.Head = h
  m.__order[#m.__order + 1] = "Head"
end
HEAD_PARTS = { head }

vanilla_model = mock("vanilla_model")
action_wheel = mock("action_wheel")
host = mock("host")
client = mock("client")
player = mock("player")
world = mock("world")
renderer = mock("renderer")
keybinds = mock("keybinds")
textures = mock("textures")
sounds = mock("sounds")
particles = mock("particles")
nameplate = mock("nameplate")
avatar = mock("avatar")
animations = mock("animations")
matrices = mock("matrices")
raycast = mock("raycast")
data = mock("data")
pings = {}
function log() end
function printTable() end
function toJson(v) return "" end

local EV = {}
local function evlist(k)
  local key = string.upper(k)
  EV[key] = EV[key] or {}
  return EV[key]
end
events = setmetatable({}, {
  __newindex = function(_, k, fn) table.insert(evlist(k), { fn = fn }) end,
  __index = function(_, k)
    local list = evlist(k)
    return {
      register = function(_, fn, name) table.insert(list, { fn = fn, name = name }) end,
      remove = function(_, name)
        for i = #list, 1, -1 do if list[i].name == name then table.remove(list, i) end end
      end,
      clear = function() for i = #list, 1, -1 do table.remove(list, i) end end,
      getRegisteredCount = function() return #list end
    }
  end
})
function FIRE(name, ...)
  local list = evlist(name)
  local copy = {}
  for i, e in ipairs(list) do copy[i] = e end
  for _, e in ipairs(copy) do e.fn(...) end
end

-- ---- scripts --------------------------------------------------------------------------------
local loaded, dirs = {}, { "" }
local function resolve(name)
  local base = dirs[#dirs]
  local p = name:gsub("%.lua$", "")
  if p:sub(1, 2) == "./" then
    p = (base ~= "" and base .. "/" or "") .. p:sub(3)
  elseif p:sub(1, 3) == "../" then
    p = (base:match("^(.*)/[^/]*$") or "") .. "/" .. p:sub(4)
  else
    p = p:gsub("%.", "/")
  end
  return (p:gsub("^/", ""))
end
function require(name)
  local p = resolve(name)
  if loaded[p] ~= nil then return loaded[p] end
  local src = FILES[p .. ".lua"]
  assert(src, "require: no script " .. name .. " (" .. p .. ")")
  local fn = assert(load(src, "@" .. p .. ".lua"))
  table.insert(dirs, p:match("^(.*)/[^/]*$") or "")
  loaded[p] = true
  local r = fn(p)
  table.remove(dirs)
  if r ~= nil then loaded[p] = r end
  return loaded[p]
end
function listFiles(dir)
  local d = resolve(dir)
  local out = {}
  for path in pairs(FILES) do
    if path:sub(1, #d + 1) == d .. "/" and not path:sub(#d + 2):find("/") and path:match("%.lua$") then
      out[#out + 1] = (path:gsub("%.lua$", ""):gsub("/", "."))
    end
  end
  table.sort(out)
  return out
end

function RUN(rounds)
  local names = {}
  if AUTOSCRIPTS then
    names = AUTOSCRIPTS
  else
    for path in pairs(FILES) do if path:match("%.lua$") then names[#names + 1] = path:gsub("%.lua$", ""):gsub("/", ".") end end
    table.sort(names, function(a, b) return a == "script" or (b ~= "script" and a < b) end)
  end
  -- Auria's wheel buttons are Lua objects: remember them to press them later
  local auria, auriaActions = nil, {}
  if FILES["auria_wheel/main.lua"] then
    auria = require("auria_wheel.main")
    local make = auria.lib.newAction
    auria.lib.newAction = function(...)
      local a = make(...)
      auriaActions[#auriaActions + 1] = a
      return a
    end
  end
  for _, n in ipairs(names) do require(n) end

  local function frames(n)
    for _ = 1, n do
      FIRE("tick")
      FIRE("render", 0.5, "RENDER")
      FIRE("post_render", 0.5, "RENDER")
      FIRE("world_render", 0.5)
    end
  end
  FIRE("entity_init")
  frames(rounds)
  -- press every wheel button and switch (twice, so toggles go off and back on)
  local seen = 0
  for _, c in ipairs(CALLBACKS) do
    if c.name == "onToggle" or c.name == "setOnToggle" then
      c.fn(false, c.owner); c.fn(true, c.owner)
    elseif c.name:match("^on") or c.name == "setOnLeftClick" then
      c.fn(c.owner)
    end
    seen = seen + 1
  end
  if auria then
    auria.setEnabled(true)
    for _, a in ipairs(auriaActions) do
      auria.clickAction(a)
      auria.clickAction(a, true)
      frames(1)
      auria.previousPage()
      seen = seen + 1
    end
  end
  frames(rounds)
  -- every ping with sample arguments
  local pinged = 0
  for name, fn in pairs(pings) do
    for i = 0, 4 do fn(i, i % 2 == 0) end
    pinged = pinged + 1
  end
  frames(rounds)
  return seen, pinged
end
