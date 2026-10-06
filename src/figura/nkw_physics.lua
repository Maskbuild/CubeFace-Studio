--[[ NKW Physics v2.1 - smooth, bounce-free chain physics for Figura (hair, cloth, ribbons)
  Same model as the NKW Skin & Figura Custom editor preview (src/renderer/src/skin/hair.ts).

  local phys = require("nkw_physics")
  phys.chain({ models.model.Head.HairBack.s1, models.model.Head.HairBack.s1.s2 }, {
    side = "back",          -- "front" (bangs) or "back"
    stiffness = 0.16,       -- how fast the hair follows (lower = floatier)
    gravity = 0.75, drag = 2.4, sway = 0.75,
    limitIn = 4, limitOut = 70,  -- degrees
    axis = 1,               -- flip to -1 if the plane swings the wrong way
  })

  Each segment's absolute angle is its own critically damped spring (it never bounces past
  its target); lower segments follow a little slower, so the chain bends in a soft wave.
  The root shows only part of its swing (ROOT), so hair stays on the scalp and curves smoothly.
  With a smooth head, call P.followHead(speed) with the same speed so the hair reacts to the
  lagging head instead of to where the player is already looking.
  Each segment must be the child of the previous one, with its pivot on its top edge.
  Physics runs at 20 ticks/s; rotations are interpolated every frame, so motion stays smooth
  at any FPS. Licensed with the NKW Skin & Figura Custom project.
]]
local P = { enabled = true }
local chains = {}
local D2R, R2D = math.pi / 180, 180 / math.pi
local LAG = 0.72 -- each lower segment follows at 72% of the stiffness above it
local ROOT = 0.3 -- the top segment shows 30% of its swing, the tip 100%
local function weight(i, n) return n <= 1 and 0.6 or ROOT + (1 - ROOT) * (i - 1) / (n - 1) end
local prevYaw
local smooth -- look direction smoothed like the smooth head (when followHead is used)
local function wrap(a) return (a + 180) % 360 - 180 end

--- Make the hair follow a smooth head that turns with this speed (0..1 per tick).
function P.followHead(speed) P.headSpeed = speed end

local function zeros(n)
  local t = {}
  for i = 1, n do t[i] = 0 end
  return t
end

---@param parts ModelPart[] top segment first
---@param cfg table
function P.chain(parts, cfg)
  local n = #parts
  local c = {
    parts = parts, n = n, s = cfg.side == "front" and 1 or -1, axis = cfg.axis or 1,
    k = cfg.stiffness or 0.16, g = cfg.gravity or 0.75,
    drag = cfg.drag or 2.4, sway = cfg.sway or 0.75,
    lo = -(cfg.limitIn or 4) * D2R, hi = (cfg.limitOut or 70) * D2R,
    a = zeros(n), r = zeros(n), va = zeros(n), vr = zeros(n), pa = zeros(n), pr = zeros(n),
    rest = {},
  }
  for i, p in ipairs(parts) do c.rest[i] = p:getRot() end
  chains[#chains + 1] = c
  return c
end

local function step(c, m)
  local outT = -c.s * m.vz * c.drag + math.max(0, -m.vy) * c.drag * 0.6 + c.s * m.pitch * c.g
  local rollT = -m.vx * c.drag * 0.8 - m.yawRate * c.sway * 4
  for i = 1, c.n do
    c.pa[i], c.pr[i] = c.a[i], c.r[i]
    local k = c.k * LAG ^ (i - 1)
    local keep = 1 / (1 + math.sqrt(k)) ^ 2 -- critical damping: fastest without overshoot
    c.va[i] = (c.va[i] + (outT - c.a[i]) * k) * keep
    c.vr[i] = (c.vr[i] + (rollT - c.r[i]) * k) * keep
    c.a[i] = c.a[i] + c.va[i]
    c.r[i] = c.r[i] + c.vr[i]
    if c.a[i] < c.lo then c.a[i], c.va[i] = c.lo, 0 end
    if c.a[i] > c.hi then c.a[i], c.va[i] = c.hi, 0 end
    c.r[i] = math.max(-0.9, math.min(0.9, c.r[i]))
  end
end

events.TICK:register(function()
  if not P.enabled or #chains == 0 then return end
  local vel = player:getVelocity()
  local rot = player:getRot()
  if P.headSpeed then
    smooth = smooth or rot
    smooth = smooth + vec(wrap(rot.x - smooth.x), wrap(rot.y - smooth.y)) * P.headSpeed
    rot = smooth
  end
  local yaw = math.rad(player:getBodyYaw())
  local sn, cs = math.sin(yaw), math.cos(yaw)
  local m = {
    vz = -vel.x * sn + vel.z * cs,
    vx = vel.x * cs + vel.z * sn,
    vy = vel.y,
    pitch = math.rad(rot.x),
    yawRate = prevYaw and -math.rad(rot.y - prevYaw) or 0,
  }
  prevYaw = rot.y
  for _, c in ipairs(chains) do step(c, m) end
end)

events.RENDER:register(function(delta)
  if not P.enabled then return end
  for _, c in ipairs(chains) do
    local lastA, lastR = 0, 0
    for i = 1, c.n do
      -- interpolate absolute angles, then rotate each segment by the difference to its parent
      local w = weight(i, c.n)
      local a = (c.pa[i] + (c.a[i] - c.pa[i]) * delta) * w
      local r = (c.pr[i] + (c.r[i] - c.pr[i]) * delta) * w
      c.parts[i]:setRot(c.rest[i] + vec((a - lastA) * R2D * c.axis, 0, -(r - lastR) * R2D))
      lastA, lastR = a, r
    end
  end
end)

--- Stop/start all physics (e.g. from an action wheel toggle).
function P.setEnabled(on)
  P.enabled = on
  if not on then
    for _, c in ipairs(chains) do
      for i = 1, c.n do c.parts[i]:setRot(c.rest[i]) end
    end
  end
end

return P
