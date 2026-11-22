// =====================================================================
//  Lantern Keepers rules. Pure functions shared by the game and the
//  solver (which runs in Node to check every level and count par).
// =====================================================================
(function (root) {
'use strict';
const R = 2.6;                 // lantern light radius, in tiles (centre to centre)
const DIRS = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };

// Level legend:
//   #  wall          .  floor        (space)  abyss: nothing to stand on
//   =  starlight bridge: solid only where BOTH lanterns' light overlaps
//   a  amber floor: solid only in the Amber lantern's light
//   t  teal floor:  solid only in the Teal lantern's light
//   p / q  pressure plates: while anyone stands on one, its doors (P / Q) are open
//   A / T  where Amber / Teal start      X  exit (both keepers must stand on one)
function parse(L) {
  const rows = L.map;
  const H = rows.length, W = Math.max(...rows.map(r => r.length));
  const st = { W, H, name: L.name, hint: L.hint || '', tiles: [], start: [null, null], exits: [] };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let ch = rows[y][x] || ' ';
    if (ch === 'A') { st.start[0] = [x, y]; ch = '.'; }
    if (ch === 'T') { st.start[1] = [x, y]; ch = '.'; }
    if (ch === 'X') st.exits.push(y * W + x);
    st.tiles.push(ch);
  }
  if (!st.start[0] || !st.start[1]) throw new Error(L.name + ': needs A and T');
  if (st.exits.length < 2) throw new Error(L.name + ': needs two exits');
  return st;
}
const lit = (x, y, p) => (x - p[0]) ** 2 + (y - p[1]) ** 2 <= R * R;
function init(st) { return { p: [st.start[0].slice(), st.start[1].slice()] }; }
function key(s) { return s.p[0][0] + ',' + s.p[0][1] + '|' + s.p[1][0] + ',' + s.p[1][1]; }
function plateOn(st, s, plate) { return s.p.some(q => st.tiles[q[1] * st.W + q[0]] === plate); }
// can a keeper stand on (x, y), given where both keepers are?
function solid(st, s, x, y) {
  if (x < 0 || y < 0 || x >= st.W || y >= st.H) return false;
  const t = st.tiles[y * st.W + x];
  if (t === '#' || t === ' ') return false;
  if (t === '=') return lit(x, y, s.p[0]) && lit(x, y, s.p[1]);
  if (t === 'a') return lit(x, y, s.p[0]);
  if (t === 't') return lit(x, y, s.p[1]);
  if (t === 'P') return plateOn(st, s, 'p');
  if (t === 'Q') return plateOn(st, s, 'q');
  return true;
}
// Move keeper `who` (0 Amber, 1 Teal). Returns the new state or null.
// A move is refused if it would leave either keeper standing on something
// that is no longer there (a bridge going dark, a door closing on them).
function step(st, s, who, dir) {
  const [dx, dy] = DIRS[dir], me = s.p[who], other = s.p[1 - who];
  const nx = me[0] + dx, ny = me[1] + dy;
  if (nx === other[0] && ny === other[1]) return null;
  const n = { p: [s.p[0].slice(), s.p[1].slice()] };
  n.p[who] = [nx, ny];
  // the destination must be solid with the keeper already there (their own light counts)
  if (!solid(st, n, nx, ny)) return null;
  if (!solid(st, n, other[0], other[1])) return null;
  return n;
}
function won(st, s) { return s.p.every(q => st.exits.includes(q[1] * st.W + q[0])); }

// Breadth-first search over both keepers' positions. Returns the shortest list of [who, dir].
function solve(st, s0, maxStates = 400000) {
  const start = s0 || init(st), seen = new Map([[key(start), null]]);
  let frontier = [start], n = 0;
  while (frontier.length) {
    const next = [];
    for (const s of frontier) for (const who of [0, 1]) for (const d of 'UDLR') {
      const r = step(st, s, who, d); if (!r) continue;
      const k = key(r); if (seen.has(k)) continue;
      seen.set(k, [key(s), who, d]);
      if (won(st, r)) {
        const path = []; let kk = k;
        while (seen.get(kk)) { const [pk, w, dd] = seen.get(kk); path.push([w, dd]); kk = pk; }
        return path.reverse();
      }
      next.push(r); if (++n > maxStates) return undefined;
    }
    frontier = next;
  }
  return null;
}
const api = { R, DIRS, parse, init, key, step, solid, lit, won, solve, plateOn };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LK = api;
})(typeof self !== 'undefined' ? self : this);
