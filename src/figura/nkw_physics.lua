--[[ NKW Physics v1.0 - smooth spring-chain physics for Figura (hair, ears, tails, cloth)
  Same algorithm as the NKW Skin & Figura Custom editor preview (src/renderer/src/skin/hair.ts).

  local phys = require("nkw_physics")
  phys.chain({ models.model.Head.HairBack.s1, models.model.Head.HairBack.s1.s2 }, {
    side = "back",          -- "front" (bangs) or "back"
    stiffness = 0.22, damping = 0.26, gravity = 0.75, drag = 2.2, sway = 0.7,
    limitIn = 4, limitOut = 70,  -- degrees
    axis = 1,               -- flip to -1 if the plane swings the wrong way
  })

  Each segment must be the child of the previous one, with its pivot on its top edge.
  Physics runs at 20 ticks/s; rotations are interpolated every frame, so motion stays smooth
  at any FPS. Licensed with the NKW Skin & Figura Custom project.
]]
local P = { enabled = true }
local chains = {}
local D2R, R2D = math.pi / 180, 180 / math.pi
local prevYaw

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
    k = cfg.stiffness or 0.22, d = cfg.damping or 0.26, g = cfg.gravity or 0.75,
    drag = cfg.drag or 2.2, sway = cfg.sway or 0.7,
    lo = -(cfg.limitIn or 4) * D2R, hi = (cfg.limitOut or 70) * D2R,
    out = zeros(n), roll = zeros(n), vo = zeros(n), vr = zeros(n), po = zeros(n), pr = zeros(n),
    rest = {},
  }
  for i, p in ipairs(parts) do c.rest[i] = p:getRot() end
  chains[#chains + 1] = c
  return c
end

local function step(c, m)
  local outT = -c.s * m.vz * c.drag + math.max(0, -m.vy) * c.drag * 0.6 + c.s * m.pitch * c.g
  local rollT = -m.vx * c.drag * 0.8 - m.yawRate * c.sway * 4
  local po, pr = 0, 0
  for i = 1, c.n do
    c.po[i], c.pr[i] = c.out[i], c.roll[i]
    local share = 1 / (c.n - i + 1)
    c.vo[i] = (c.vo[i] + ((outT - po) * share - c.out[i]) * c.k) * (1 - c.d)
    c.vr[i] = (c.vr[i] + ((rollT - pr) * share - c.roll[i]) * c.k) * (1 - c.d)
    c.out[i] = c.out[i] + c.vo[i]
    c.roll[i] = c.roll[i] + c.vr[i]
    local total = po + c.out[i]
    if total < c.lo then c.out[i], c.vo[i] = c.lo - po, 0 end
    if total > c.hi then c.out[i], c.vo[i] = c.hi - po, 0 end
    c.roll[i] = math.max(-0.9, math.min(0.9, c.roll[i]))
    po, pr = po + c.out[i], pr + c.roll[i]
  end
end

events.TICK:register(function()
  if not P.enabled or #chains == 0 then return end
  local vel = player:getVelocity()
  local rot = player:getRot()
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
    for i = 1, c.n do
      local o = c.po[i] + (c.out[i] - c.po[i]) * delta
      local r = c.pr[i] + (c.roll[i] - c.pr[i]) * delta
      c.parts[i]:setRot(c.rest[i] + vec(o * R2D * c.axis, 0, -r * R2D))
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
