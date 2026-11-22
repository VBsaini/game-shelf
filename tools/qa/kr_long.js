const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8132/'); await p.waitForTimeout(300);
  const r = await p.evaluate(() => {
    __kr.newRun(3); const G = __kr.G; const t0 = performance.now();
    for (let i = 0; i < 60000; i++) { G.inv = 5; if (i % 3 === 0) __kr.bot(1); __kr.update(0.01); if (G.p.y < 60) G.p.y = 60; if (G.p.y > 660) G.p.y = 660; }
    return { secs: Math.round(G.t), metres: Math.floor(G.dist / 10), speed: Math.round(G.speed), posts: G.posts.length, saws: G.saws.length, coins: G.coins.length, trail: G.trail.length, ms: Math.round(performance.now() - t0) };
  });
  console.log(JSON.stringify(r), 'errors', errs.length); await b.close();
})();
