// =====================================================================
//  Paperfold puzzle rules. Pure functions, shared by the game and the
//  solver (which also runs in Node to verify every level).
// =====================================================================
(function (root) {
'use strict';
const H = 4;                       // wall height in 2D cells
const DIRS = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };

// Floor legend:  .  floor      #  stone block   _  pit        C  crate
//                P  start      E  exit          a/b  red/blue plate
//                A/B  red/blue door (open while that colour is on)
//                x/y  red/blue bridge (a pit while that colour is off)
//                T/t and V/v  linked floor teleporter pairs
// Wall legend:   space empty   =  brick         O  portal
//                L/M  red/blue lever
//                r/u  red/blue block, solid while that colour is ON
//                R/U  red/blue block, solid while that colour is OFF
function parse(L) {
  const D = L.floor.length, W = L.floor[0].length, S = 2 * D + W;
  const st = { W, D, S, H, name: L.name, hint: L.hint || '', tiles: [], wall: [], tele: {}, start: null, crates: [] };
  const telePos = {};
  for (let y = 0; y < D; y++) {
    if (L.floor[y].length !== W) throw new Error(L.name + ': floor row ' + y + ' has wrong width');
    for (let x = 0; x < W; x++) {
      let ch = L.floor[y][x];
      const i = y * W + x;
      if (ch === 'P') { st.start = [x, y]; ch = '.'; }
      if (ch === 'C') { st.crates.push(i); ch = '.'; }
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
  st.crates.sort((a, b) => a - b);
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
  return { m: 0, x: st.start[0], y: st.start[1], c: 0, r: 0, crates: st.crates.slice(), filled: [], lever: [false, false], won: false, face: 1 };
}
function clone(s) { return { m: s.m, x: s.x, y: s.y, c: s.c, r: s.r, crates: s.crates.slice(), filled: s.filled.slice(), lever: s.lever.slice(), won: s.won, face: s.face }; }
function key(s) { return s.m + ',' + (s.m ? s.c + ',' + s.r : s.x + ',' + s.y) + '|' + s.crates.join('.') + '|' + s.filled.join('.') + '|' + (s.lever[0] ? 1 : 0) + (s.lever[1] ? 1 : 0); }

const hasCrate = (s, i) => s.crates.indexOf(i) >= 0;
function colorOn(st, s, k) {
  if (s.lever[k]) return true;
  const plate = k ? 'b' : 'a';
  for (const i of s.crates) if (st.tiles[i] === plate) return true;
  if (s.m === 0 && st.tiles[s.y * st.W + s.x] === plate) return true;
  return false;
}
function isPit(st, s, i) {
  const t = st.tiles[i];
  if (s.filled.indexOf(i) >= 0) return false;
  if (t === '_') return true;
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
function blocked3(st, s, i) { return st.tiles[i] === '#' || doorClosed(st, s, i); }
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
  if (r === 0 && (st.tiles[ti] === '#' || hasCrate(s, ti) || doorClosed(st, s, ti))) return true;
  return false;
}

// crates resting on a bridge that switched off drop in and fill it
function settle(st, s, ev) {
  for (let k = s.crates.length - 1; k >= 0; k--) {
    const i = s.crates[k], t = st.tiles[i];
    if ((t === 'x' || t === 'y') && isPit(st, s, i)) { s.crates.splice(k, 1); s.filled.push(i); s.filled.sort((a, b) => a - b); ev.push({ t: 'drop', i }); }
  }
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
    const ni = ny * W + nx;
    if (blocked3(st, s, ni)) return null;
    if (hasCrate(s, ni)) {
      const px = nx + dx, py = ny + dy;
      if (px < 0 || py < 0 || px >= W || py >= D) return null;
      const pi = py * W + px;
      if (blocked3(st, s, pi) || hasCrate(s, pi)) return null;
      s.crates.splice(s.crates.indexOf(ni), 1);
      if (isPit(st, s, pi)) { s.filled.push(pi); s.filled.sort((a, b) => a - b); ev.push({ t: 'fill', from: ni, to: pi }); }
      else {
        let dest = pi;
        const tp = st.tele[pi];
        if (tp !== undefined && !hasCrate(s, tp) && tp !== ni && playerFree(st, s, tp)) { dest = tp; ev.push({ t: 'ctele', from: ni, mid: pi, to: tp }); }
        else ev.push({ t: 'push', from: ni, to: pi });
        s.crates.push(dest); s.crates.sort((a, b) => a - b);
      }
    } else if (isPit(st, s, ni)) return null;
    ev.push({ t: 'move', from: [s.x, s.y], to: [nx, ny] });
    s.x = nx; s.y = ny;
    const tp = st.tele[ni];
    if (tp !== undefined && playerFree(st, s, tp)) { s.x = tp % W; s.y = (tp / W) | 0; ev.push({ t: 'tele', from: ni, to: tp }); }
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
    else return null;
    const from = [s.c, s.r];
    while (!solid2(st, s, nc, nr - 1)) {
      nr--;
      if (nr < 0) return { s: s0, ev: [{ t: 'death', from, at: [nc, s.r] }], death: true };
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

const api = { H, parse, init, clone, key, step, solve, colTile, wallSide, solid2, isPit, colorOn, doorClosed, hasCrate, playerFree };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PF = api;
})(typeof self !== 'undefined' ? self : this);
