// Run:  node solve.js [hole numbers...]
// For every hole: how many of the shots on a fine grid are holes-in-one, and the best
// two-shot plan. Prints a suggested par (1 if holes-in-one are reasonably easy to hit,
// else 2 if two-shot plans are, else 3) and exits with an error if a hole looks unplayable.
const GP = require('./physics.js');
const HOLES = require('./holes.js');
const only = process.argv.slice(2).map(Number);
let bad = 0;
HOLES.forEach((h, n) => {
  if (only.length && !only.includes(n + 1)) return;
  const t0 = Date.now();
  const A = 720, P = 24;
  const all = GP.search(h, h.tee[0], h.tee[1], 0, A, P, 'any');
  const ones = all.filter(s => s.res.result === 'sink');
  // two-shot: from the best-placed stops, look for a sink
  const stops = all.filter(s => s.res.result === 'stop').map(s => ({ s, d: Math.hypot(s.res.x - h.cup[0], s.res.y - h.cup[1]) }));
  stops.sort((a, b) => a.d - b.d);
  const seen = [], starts = [];
  for (const o of stops) { if (seen.some(p => Math.hypot(p[0] - o.s.res.x, p[1] - o.s.res.y) < 25)) continue; seen.push([o.s.res.x, o.s.res.y]); starts.push(o.s); if (starts.length >= 24) break; }
  let twoRate = 0, twoPlans = 0;
  for (const s of starts) {
    const hits = GP.search(h, s.res.x, s.res.y, s.res.T, 360, 16, 'sink');
    if (hits.length) { twoPlans++; twoRate = Math.max(twoRate, hits.length / (360 * 16)); }
  }
  const oneRate = ones.length / (A * P);
  const par = oneRate >= 0.004 ? 1 : (ones.length && twoRate >= 0.01) || twoRate >= 0.004 ? 2 : twoPlans ? 3 : 4;
  if (!ones.length && !twoPlans) bad++;
  console.log(`${String(n + 1).padStart(2)} ${(h.name || '').padEnd(18)} hole-in-one ${String(ones.length).padStart(4)} (${(oneRate * 100).toFixed(2)}%)  two-shot starts ${twoPlans}/${starts.length} best ${(twoRate * 100).toFixed(1)}%  -> par ${par}${h.par ? ' (set ' + h.par + ')' : ''}  ${Date.now() - t0}ms`);
});
process.exit(bad ? 1 : 0);
