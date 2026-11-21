// Run:  node test_levels.js
// Solves every level with the BFS solver and prints the shortest solution.
const PF = require('./logic.js');
const LEVELS = require('./levels.js');
let bad = 0;
LEVELS.forEach((L, i) => {
  try {
    const st = PF.parse(L);
    const t0 = Date.now();
    const sol = PF.solve(st, null, 2000000);
    const ms = Date.now() - t0;
    if (!sol) { bad++; console.log(`${String(i + 1).padStart(2)} ${L.name.padEnd(22)} ** ${sol === null ? 'UNSOLVABLE' : 'TOO BIG'} ** (${ms} ms)`); return; }
    const wallMoves = (() => { let s = PF.init(st), n = 0; for (const m of sol) { if (s.m === 1) n++; s = PF.step(st, s, m).s; } return n; })();
    console.log(`${String(i + 1).padStart(2)} ${L.name.padEnd(22)} ${String(sol.length).padStart(3)} moves (${wallMoves} in wall)  ${sol.join('')}  (${ms} ms)`);
  } catch (e) { bad++; console.log(`${i + 1} ${L.name}: ERROR ${e.message}`); }
});
process.exit(bad ? 1 : 0);
