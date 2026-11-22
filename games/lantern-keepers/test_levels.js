// Run:  node test_levels.js   (solves every level; exits with an error if one is unsolvable)
const LK = require('./logic.js'), LEVELS = require('./levels.js');
let bad = 0;
LEVELS.forEach((L, i) => {
  try {
    const st = LK.parse(L), t0 = Date.now(), sol = LK.solve(st);
    if (!sol) { bad++; console.log(`${String(i + 1).padStart(2)} ${L.name.padEnd(20)} ** ${sol === null ? 'UNSOLVABLE' : 'TOO BIG'} **`); return; }
    const a = sol.filter(m => m[0] === 0).length;
    console.log(`${String(i + 1).padStart(2)} ${L.name.padEnd(20)} ${String(sol.length).padStart(3)} moves (Amber ${a}, Teal ${sol.length - a})${L.par && L.par !== sol.length ? '  ** par says ' + L.par : ''}  ${Date.now() - t0} ms`);
  } catch (e) { bad++; console.log(i + 1, L.name, 'ERROR', e.message); }
});
process.exit(bad ? 1 : 0);
