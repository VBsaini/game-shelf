// =====================================================================
//  Gravity Golf physics. Pure functions shared by the game and the
//  solver (which also runs in Node to check every hole and set par).
// =====================================================================
(function (root) {
'use strict';
const W = 1280, H = 720;
const DT = 1 / 120;            // fixed physics step
const BALL_R = 9;              // ball radius
const CUP_R = 17;              // ball centre within this of the cup centre ...
const CUP_SPEED = 430;         // ... and slower than this drops in
const MAX_SPEED = 920;         // full-power shot
const DRAG = 0.42;             // space drag per second (so weak shots coast to a stop)
const BOUNCE = 0.55;           // restitution off planets
const MAX_FLIGHT = 14;         // seconds before a shot is called finished
const WORM_R = 20;

// Hole format:
//  tee: [x, y], cup: [x, y], par (filled in by the solver run)
//  bodies: planets { x, y, r, m }, repulsors { rep: true, ... }, black holes { bh: true, x, y, r, m }
//          moons { moon: true, cx, cy, orbit, a0, w, r, m }  (orbit while the ball is moving)
//  worms: [[x1, y1, x2, y2]]   linked wormholes: in one, out the other at the same velocity
//  dust: [{ x, y, r }]         thick dust: heavy drag
//  boosts: [{ x, y, a, r }]    speed rings: push along angle a (degrees)
function bodyPos(b, T) {
  if (!b.moon) return [b.x, b.y];
  const a = (b.a0 + b.w * T) * Math.PI / 180;
  return [b.cx + Math.cos(a) * b.orbit, b.cy + Math.sin(a) * b.orbit];
}

// Simulate one shot. T0 = flight time already spent in this hole (moons move with it).
// Returns { result: 'sink' | 'stop' | 'out' | 'void', x, y, T, path?, events? }
// (each event is [kind, x, y, ..., T])
function shoot(hole, x, y, vx, vy, T0, opt = {}) {
  let T = T0, t = 0, slow = 0, wormCool = -1, worms = hole.worms || [];
  const bodies = hole.bodies || [], dust = hole.dust || [], boosts = hole.boosts || [];
  const path = opt.record ? [[x, y, T]] : null, events = opt.record ? [] : null;
  const maxT = opt.maxT || MAX_FLIGHT;
  let lastHitT = -1;
  while (t < maxT) {
    let ax = 0, ay = 0;
    for (const b of bodies) {
      const [bx, by] = bodyPos(b, T);
      const dx = bx - x, dy = by - y, r2 = dx * dx + dy * dy, r = Math.sqrt(r2) || 1;
      const f = b.m / Math.max(r2, b.r * b.r) * (b.rep ? -1 : 1);
      ax += dx / r * f; ay += dy / r * f;
    }
    let drag = DRAG;
    for (const d of dust) if ((x - d.x) ** 2 + (y - d.y) ** 2 < d.r * d.r) drag = 2.6;
    for (const b of boosts) if ((x - b.x) ** 2 + (y - b.y) ** 2 < b.r * b.r) { const a = b.a * Math.PI / 180; ax += Math.cos(a) * 1500; ay += Math.sin(a) * 1500; }
    vx += ax * DT; vy += ay * DT;
    const k = 1 - drag * DT; vx *= k; vy *= k;
    x += vx * DT; y += vy * DT; t += DT; T += DT;
    // planets, repulsors and moons are solid; black holes swallow
    for (const b of bodies) {
      const [bx, by] = bodyPos(b, T);
      const dx = x - bx, dy = y - by, d = Math.hypot(dx, dy) || 1;
      if (b.bh) { if (d < b.r) { if (events) events.push(['void', x, y, 0, T]); if (path) path.push([x, y, T]); return { result: 'void', x, y, T, path, events }; } continue; }
      if (d < b.r + BALL_R) {
        const nx = dx / d, ny = dy / d;
        x = bx + nx * (b.r + BALL_R); y = by + ny * (b.r + BALL_R);
        const vn = vx * nx + vy * ny;
        if (vn < 0) {
          // moving bodies push the ball along
          let mvx = 0, mvy = 0;
          if (b.moon) { const [px, py] = bodyPos(b, T - DT); mvx = (bx - px) / DT; mvy = (by - py) / DT; }
          const rvn = (vx - mvx) * nx + (vy - mvy) * ny;
          vx -= (1 + BOUNCE) * rvn * nx; vy -= (1 + BOUNCE) * rvn * ny;
          const tx = -ny, ty = nx, vt = vx * tx + vy * ty;
          vx -= vt * tx * 0.12; vy -= vt * ty * 0.12;
          if (events && -rvn > 60 && T - lastHitT > 0.08) { events.push(['bounce', x, y, -rvn, T]); lastHitT = T; }
        }
      }
    }
    // wormholes
    if (wormCool >= 0) {
      const w = worms[wormCool >> 1], ex = wormCool & 1 ? w[0] : w[2], ey = wormCool & 1 ? w[1] : w[3];
      if ((x - ex) ** 2 + (y - ey) ** 2 > (WORM_R + BALL_R + 6) ** 2) wormCool = -1;
    } else for (let i = 0; i < worms.length; i++) {
      const w = worms[i];
      if ((x - w[0]) ** 2 + (y - w[1]) ** 2 < WORM_R * WORM_R) { if (events) events.push(['worm', x, y, w[2], w[3], T]); x = w[2]; y = w[3]; wormCool = i * 2; if (path) path.push(null); break; }
      if ((x - w[2]) ** 2 + (y - w[3]) ** 2 < WORM_R * WORM_R) { if (events) events.push(['worm', x, y, w[0], w[1], T]); x = w[0]; y = w[1]; wormCool = i * 2 + 1; if (path) path.push(null); break; }
    }
    const sp = Math.hypot(vx, vy);
    if (path && (Math.round(t / DT) % 2 === 0)) path.push([x, y, T]);
    if ((x - hole.cup[0]) ** 2 + (y - hole.cup[1]) ** 2 < CUP_R * CUP_R && sp < CUP_SPEED) {
      if (path) path.push([hole.cup[0], hole.cup[1], T]);
      return { result: 'sink', x: hole.cup[0], y: hole.cup[1], T, path, events };
    }
    if (x < -30 || y < -30 || x > W + 30 || y > H + 30) return { result: 'out', x, y, T, path, events };
    if (sp < 16) { slow += DT; if (slow > 0.3) break; } else slow = 0;
  }
  return { result: 'stop', x, y, T, path, events };
}

// Search shots from (x, y). Returns hits: [{ ang, pow, res }] sorted by nothing in particular.
function search(hole, x, y, T0, angSteps, powSteps, want = 'sink') {
  const out = [];
  for (let i = 0; i < angSteps; i++) for (let j = 1; j <= powSteps; j++) {
    const a = i / angSteps * Math.PI * 2, p = j / powSteps;
    const r = shoot(hole, x, y, Math.cos(a) * MAX_SPEED * p, Math.sin(a) * MAX_SPEED * p, T0);
    if (want === 'any' || r.result === want) out.push({ ang: a, pow: p, res: r, i, j });
  }
  return out;
}

const api = { W, H, DT, BALL_R, CUP_R, CUP_SPEED, MAX_SPEED, WORM_R, bodyPos, shoot, search };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GP = api;
})(typeof self !== 'undefined' ? self : this);
