// =====================================================================
//  Paperfold puzzle rules. Pure functions, shared by the game and the
//  solver (which also runs in Node to verify every level).
// =====================================================================
(function (root) {
'use strict';
const H = 4;                       // wall height in 2D cells
const DIRS = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };
const OBJ = 'PCK/\\';                       // floor chars that are objects standing on plain floor
const EMIT = { '>': [1, 0], '<': [-1, 0], '^': [0, -1], '!': [0, 1] };
const BOXES = ['crates', 'balls', 'mirA', 'mirB'];   // every kind of pushable block
const KIND = { crates: 'C', balls: 'K', mirA: '/', mirB: '\\' };

// Floor legend:  .  floor      #  stone block   _  pit        C  crate
//                P  start      E  exit          a/b  red/blue plate
//                A/B  red/blue door (open while that colour is on)
//                x/y  red/blue bridge (a pit while that colour is off)
//                T/t and V/v  linked floor teleporter pairs
//                ~  ice: you and crates slide until something stops you
//                K  rubber crate: rolls until it hits something, then bounces back one tile
//                w  water (a pit that lily pads float on)   l  lily pad on water
//                /  \  mirror crates (pushable, they turn light beams)
//                > < ^ !  light emitter shining right / left / up / down
//                1/2  red/blue light sensor (that colour is on while lit)
// Optional "over" rows put an object (C K / \ P) on top of the floor char
// below it, e.g. a crate standing on ice.
// Wall legend:   space empty   =  brick         O  portal
//                L/M  red/blue lever
//                r/u  red/blue block, solid while that colour is ON
//                R/U  red/blue block, solid while that colour is OFF
function parse(L) {
  const D = L.floor.length, W = L.floor[0].length, S = 2 * D + W;
  const st = { W, D, S, H, name: L.name, hint: L.hint || '', tiles: [], wall: [], tele: {}, start: null, crates: [], balls: [], mirA: [], mirB: [], pads: [], emit: [] };
  const telePos = {};
  for (let y = 0; y < D; y++) {
    if (L.floor[y].length !== W) throw new Error(L.name + ': floor row ' + y + ' has wrong width');
    for (let x = 0; x < W; x++) {
      let ch = L.floor[y][x];
      const i = y * W + x;
      const ov = L.over && L.over[y] ? L.over[y][x] : ' ';
      const obj = ov && ov !== ' ' ? ov : ch;
      if (ov && ov !== ' ' && !OBJ.includes(ov)) throw new Error(L.name + ': bad over char ' + ov);
      if (obj === 'P') st.start = [x, y];
      else if (obj === 'C') st.crates.push(i);
      else if (obj === 'K') st.balls.push(i);
      else if (obj === '/') st.mirA.push(i);
      else if (obj === '\\') st.mirB.push(i);
      if (OBJ.includes(ch)) ch = '.';
      if (ch === 'l') { st.pads.push(i); ch = 'w'; }
      if (EMIT[ch]) st.emit.push([i, EMIT[ch]]);
      if ('TtVv'.includes(ch)) { telePos[ch] = i; }
      st.tiles[i] = ch;
    }
  }
  for (const [a, b] of [['T', 't'], ['V', 'v']]) if (telePos[a] !== undefined) { st.tele[telePos[a]] = telePos[b]; st.tele[telePos[b]] = telePos[a]; }
  if (!st.start) throw new Error(L.name + ': no start');
  if (L.wall.length !== H) throw new Error(L.name + ': wall needs ' + H + ' rows');
  for (let r = 0; r < H; r++) {
    const row = L.wall[H - 1 - r];
    if (row.length > S) throw new Error(L.name + ': wall row too long (' + row.length + ' > ' + S + ')');
    st.wall[r] = row.padEnd(S, ' ');
  }
  for (const k of BOXES) st[k].sort((a, b) => a - b);
  return st;
}

// floor tile in front of a strip column (left wall front->back, back wall left->right, right wall back->front)
function colTile(st, c) {
  if (c < st.D) return [0, st.D - 1 - c];
  if (c < st.D + st.W) return [c - st.D, 0];
  return [st.W - 1, c - st.D - st.W];
}
function wallSide(st, c) { return c < st.D ? 'L' : c < st.D + st.W ? 'B' : 'R'; }

function init(st) {
  return { m: 0, x: st.start[0], y: st.start[1], c: 0, r: 0, crates: st.crates.slice(), balls: st.balls.slice(), mirA: st.mirA.slice(), mirB: st.mirB.slice(), pads: st.pads.slice(), filled: [], lever: [false, false], won: false, face: 1 };
}
function clone(s) { return { m: s.m, x: s.x, y: s.y, c: s.c, r: s.r, crates: s.crates.slice(), balls: s.balls.slice(), mirA: s.mirA.slice(), mirB: s.mirB.slice(), pads: s.pads.slice(), filled: s.filled.slice(), lever: s.lever.slice(), won: s.won, face: s.face }; }
function key(s) { return s.m + ',' + (s.m ? s.c + ',' + s.r : s.x + ',' + s.y) + '|' + s.crates.join('.') + '|' + s.balls.join('.') + '|' + s.mirA.join('.') + '|' + s.mirB.join('.') + '|' + s.pads.join('.') + '|' + s.filled.join('.') + '|' + (s.lever[0] ? 1 : 0) + (s.lever[1] ? 1 : 0); }

// which list (crates / balls / mirA / mirB) holds a block at i, or null
function boxAt(s, i) { for (const k of BOXES) if (s[k].indexOf(i) >= 0) return k; return null; }
const hasCrate = (s, i) => boxAt(s, i) !== null;
const padAt = (s, i) => s.pads.indexOf(i) >= 0;
const addSorted = (a, v) => { a.push(v); a.sort((p, q) => p - q); };

// Trace every light beam. Returns which colours its sensors switch on and
// the beam's path (cell centres) for drawing. Beams pass over pits and
// through doors; walls, emitters, crates and you (in the room) stop them.
function beams(st, s) {
  const lit = [false, false], paths = [], W = st.W, D = st.D;
  for (const [e, d0] of st.emit) {
    let x = e % W, y = (e / W) | 0, dx = d0[0], dy = d0[1];
    const pts = [[x + 0.5, y + 0.5]];
    for (let n = 0; n < 200; n++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= D) { pts.push([x + 0.5 + dx * 0.5, y + 0.5 + dy * 0.5]); break; }
      const i = ny * W + nx, t = st.tiles[i];
      if (t === '#' || EMIT[t]) { pts.push([nx + 0.5 - dx * 0.5, ny + 0.5 - dy * 0.5]); break; }
      x = nx; y = ny;
      if ((s.m === 0 && s.x === x && s.y === y) || s.crates.indexOf(i) >= 0 || s.balls.indexOf(i) >= 0) { pts.push([x + 0.5 - dx * 0.4, y + 0.5 - dy * 0.4]); break; }
      if (s.mirA.indexOf(i) >= 0) { pts.push([x + 0.5, y + 0.5]); const t2 = dx; dx = -dy; dy = -t2; continue; }
      if (s.mirB.indexOf(i) >= 0) { pts.push([x + 0.5, y + 0.5]); const t2 = dx; dx = dy; dy = t2; continue; }
      if (t === '1' || t === '2') { lit[t === '1' ? 0 : 1] = true; pts.push([x + 0.5, y + 0.5]); break; }
    }
    paths.push(pts);
  }
  return { lit, paths };
}
function colorOn(st, s, k) {
  if (s.lever[k]) return true;
  const plate = k ? 'b' : 'a';
  for (const b of BOXES) for (const i of s[b]) if (st.tiles[i] === plate) return true;
  if (s.m === 0 && st.tiles[s.y * st.W + s.x] === plate) return true;
  if (st.emit.length && beams(st, s).lit[k]) return true;
  return false;
}
function isPit(st, s, i) {
  const t = st.tiles[i];
  if (s.filled.indexOf(i) >= 0) return false;
  if (t === '_') return true;
  if (t === 'w') return !padAt(s, i);
  if (t === 'x') return !colorOn(st, s, 0);
  if (t === 'y') return !colorOn(st, s, 1);
  return false;
}
function doorClosed(st, s, i) {
  const t = st.tiles[i];
  if (t === 'A') return !colorOn(st, s, 0);
  if (t === 'B') return !colorOn(st, s, 1);
  return false;
}
function blocked3(st, s, i) { const t = st.tiles[i]; return t === '#' || !!EMIT[t] || doorClosed(st, s, i); }
// open water a lily pad can drift onto
function openWater(st, s, i) { return st.tiles[i] === 'w' && s.filled.indexOf(i) < 0 && !padAt(s, i); }
function playerFree(st, s, i) { return !blocked3(st, s, i) && !isPit(st, s, i) && !hasCrate(s, i); }

// 2D: is wall cell (c, r) solid? r = -1 is the ground line along the wall's base
function solid2(st, s, c, r) {
  if (c < 0 || c >= st.S || r >= st.H) return true;
  const [tx, ty] = colTile(st, c), ti = ty * st.W + tx;
  if (r < 0) return !isPit(st, s, ti);
  const ch = st.wall[r][c];
  if (ch === '=') return true;
  if (ch === 'r') return colorOn(st, s, 0);
  if (ch === 'R') return !colorOn(st, s, 0);
  if (ch === 'u') return colorOn(st, s, 1);
  if (ch === 'U') return !colorOn(st, s, 1);
  if (r === 0 && (blocked3(st, s, ti) || hasCrate(s, ti))) return true;
  return false;
}

const colIdx = (st, c) => { const [tx, ty] = colTile(st, c); return ty * st.W + tx; };
const colIce = (st, c) => c >= 0 && c < st.S && st.tiles[colIdx(st, c)] === '~';
// in the wall, a rubber crate at the base is a springboard: from on top of it you can jump two blocks up
const onSpring = (st, s, c) => s.balls.indexOf(colIdx(st, c)) >= 0;

// crates resting on a bridge that switched off drop in and fill it
function settle(st, s, ev) {
  for (const b of BOXES) for (let k = s[b].length - 1; k >= 0; k--) {
    const i = s[b][k], t = st.tiles[i];
    if ((t === 'x' || t === 'y') && isPit(st, s, i)) { s[b].splice(k, 1); addSorted(s.filled, i); ev.push({ t: 'drop', i, kind: KIND[b] }); }
  }
}

// Push the block at `from` one way (the player steps into `from`).
// Plain crates and mirrors move one tile, or slide on ice; rubber crates roll
// until they hit something and then bounce back a tile. A block falling into
// a pit fills it; a block stopping on a swirl pad comes out of the other one.
function pushBox(st, s, from, dx, dy, ev) {
  const W = st.W, D = st.D, list = boxAt(s, from), kind = KIND[list];
  const free = j => !blocked3(st, s, j) && !hasCrate(s, j) && !padAt(s, j);
  s[list].splice(s[list].indexOf(from), 1);
  let x = from % W, y = (from / W) | 0;
  const path = [from];
  let hit = false;
  while (true) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= D || !free(ny * W + nx)) { hit = true; break; }
    x = nx; y = ny; const j = y * W + x; path.push(j);
    if (isPit(st, s, j)) { addSorted(s.filled, j); ev.push({ t: 'fill', kind, from, to: j, path }); return true; }
    const tp = st.tele[j];
    if (tp !== undefined && tp !== from && !hasCrate(s, tp) && playerFree(st, s, tp)) { addSorted(s[list], tp); ev.push({ t: 'ctele', kind, from, mid: j, to: tp, path }); return true; }
    if (kind !== 'K' && st.tiles[j] !== '~') break;
  }
  if (path.length === 1) { addSorted(s[list], from); return false; }
  let to = path[path.length - 1];
  if (kind === 'K' && hit && path.length > 2) { to = path[path.length - 2]; path.push(to); ev.push({ t: 'bounce' }); }
  addSorted(s[list], to);
  ev.push({ t: 'push', kind, from, to, path });
  return true;
}

// Apply one move. Returns { s, ev } or null if nothing happens.
// ev entries describe what changed, for animation and sound.
function step(st, s0, dir) {
  if (s0.won) return null;
  const s = clone(s0), ev = [];
  const W = st.W, D = st.D;
  if (s.m === 0) {
    const [dx, dy] = DIRS[dir], nx = s.x + dx, ny = s.y + dy;
    if (dx) s.face = dx;
    if (nx < 0 || ny < 0 || nx >= W || ny >= D) {
      let c = null;
      if (nx < 0) c = D - 1 - s.y; else if (ny < 0) c = D + s.x; else if (nx >= W) c = D + W + s.y;
      if (c === null || st.wall[0][c] !== 'O') return null;
      ev.push({ t: 'enter', from: [s.x, s.y], c });
      s.m = 1; s.c = c; s.r = 0;
      if (solid2(st, s, c, 0)) return null;
      if (!solid2(st, s, c, -1)) return null;
      settle(st, s, ev);
      return { s, ev };
    }
    const ni = ny * W + nx, here = s.y * W + s.x;
    // standing on a lily pad and pushing off into open water: drift until something stops it
    if (padAt(s, here) && openWater(st, s, ni)) {
      let x = nx, y = ny;
      while (true) { const ax = x + dx, ay = y + dy; if (ax < 0 || ay < 0 || ax >= W || ay >= D || !openWater(st, s, ay * W + ax)) break; x = ax; y = ay; }
      const to = y * W + x;
      s.pads.splice(s.pads.indexOf(here), 1); addSorted(s.pads, to);
      ev.push({ t: 'raft', from: here, to }, { t: 'move', from: [s.x, s.y], to: [x, y] });
      s.x = x; s.y = y;
      settle(st, s, ev);
      return { s, ev };
    }
    if (blocked3(st, s, ni)) return null;
    if (hasCrate(s, ni)) { if (!pushBox(st, s, ni, dx, dy, ev)) return null; }
    else if (isPit(st, s, ni)) return null;
    // ice: keep sliding while standing on it
    let ex = nx, ey = ny;
    while (st.tiles[ey * W + ex] === '~') {
      const ax = ex + dx, ay = ey + dy;
      if (ax < 0 || ay < 0 || ax >= W || ay >= D || !playerFree(st, s, ay * W + ax)) break;
      ex = ax; ey = ay;
    }
    ev.push({ t: 'move', from: [s.x, s.y], to: [ex, ey] });
    s.x = ex; s.y = ey;
    const at = ey * W + ex, tp = st.tele[at];
    if (tp !== undefined && playerFree(st, s, tp)) { s.x = tp % W; s.y = (tp / W) | 0; ev.push({ t: 'tele', from: at, to: tp }); }
    const pi2 = s.y * W + s.x;
    // the floor must still hold the player (a bridge can vanish if a plate was released)
    settle(st, s, ev);
    if (isPit(st, s, pi2)) return null;
    if (st.tiles[pi2] === 'E') { s.won = true; ev.push({ t: 'win' }); }
    return { s, ev };
  }
  // ---- inside the wall (2D) ----
  if (dir === 'L' || dir === 'R') {
    const d = dir === 'L' ? -1 : 1;
    s.face = d;
    let nc, nr;
    if (!solid2(st, s, s.c + d, s.r)) { nc = s.c + d; nr = s.r; }
    else if (!solid2(st, s, s.c + d, s.r + 1) && !solid2(st, s, s.c, s.r + 1)) { nc = s.c + d; nr = s.r + 1; ev.push({ t: 'climb' }); }
    else if (s.r === 1 && onSpring(st, s, s.c) && !solid2(st, s, s.c, 2) && !solid2(st, s, s.c, 3) && !solid2(st, s, s.c + d, 3)) { nc = s.c + d; nr = 3; ev.push({ t: 'climb' }, { t: 'spring' }); }
    else return null;
    const from = [s.c, s.r];
    while (!solid2(st, s, nc, nr - 1)) {
      nr--;
      if (nr < 0) return { s: s0, ev: [{ t: 'death', from, at: [nc, s.r] }], death: true };
    }
    // the ground in front of ice is slippery in the wall too
    while (nr === 0 && colIce(st, nc) && !solid2(st, s, nc + d, 0)) {
      nc += d;
      if (!solid2(st, s, nc, -1)) return { s: s0, ev: [{ t: 'death', from, at: [nc, 0] }], death: true };
    }
    ev.push({ t: 'move2', from, to: [nc, nr] });
    s.c = nc; s.r = nr;
    return { s, ev };
  }
  if (dir === 'U') {
    const ch = st.wall[s.r][s.c];
    if (ch === 'O') {
      const [tx, ty] = colTile(st, s.c), ti = ty * W + tx;
      s.m = 0; s.x = tx; s.y = ty;
      if (!playerFree(st, s, ti)) return null;
      ev.push({ t: 'exit', c: s.c, to: [tx, ty] });
      settle(st, s, ev);
      if (st.tiles[ti] === 'E') { s.won = true; ev.push({ t: 'win' }); }
      return { s, ev };
    }
    if (ch === 'L' || ch === 'M') {
      const k = ch === 'L' ? 0 : 1;
      s.lever[k] = !s.lever[k];
      if (solid2(st, s, s.c, s.r)) return null;            // a block would appear on top of us
      ev.push({ t: 'lever', k, on: s.lever[k] });
      settle(st, s, ev);
      const from = [s.c, s.r];
      let nr = s.r;
      while (!solid2(st, s, s.c, nr - 1)) { nr--; if (nr < 0) return { s: s0, ev: [{ t: 'death', from, at: [s.c, s.r] }], death: true }; }
      if (nr !== s.r) { ev.push({ t: 'move2', from, to: [s.c, nr] }); s.r = nr; }
      return { s, ev };
    }
  }
  return null;
}

// Breadth-first search for the shortest solution (list of moves)
function solve(st, s0, maxStates = 300000) {
  const start = s0 || init(st);
  const seen = new Map([[key(start), null]]);
  let frontier = [start], count = 0;
  const parents = new Map();
  while (frontier.length) {
    const next = [];
    for (const s of frontier) {
      const moves = s.m === 0 ? ['U', 'D', 'L', 'R'] : ['L', 'R', 'U'];
      for (const mv of moves) {
        const res = step(st, s, mv);
        if (!res || res.death) continue;
        const k = key(res.s);
        if (seen.has(k)) continue;
        seen.set(k, true); parents.set(k, [key(s), mv, s]);
        if (res.s.won) {
          const path = []; let kk = k;
          while (parents.has(kk)) { const [pk, m] = parents.get(kk); path.push(m); kk = pk; }
          return path.reverse();
        }
        next.push(res.s);
        if (++count > maxStates) return undefined;
      }
    }
    frontier = next;
  }
  return null;
}

const api = { H, parse, init, clone, key, step, solve, colTile, wallSide, solid2, isPit, colorOn, doorClosed, hasCrate, boxAt, padAt, beams, playerFree, EMIT, KIND, BOXES };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PF = api;
})(typeof self !== 'undefined' ? self : this);
