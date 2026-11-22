// Knot Runner scenario tests
const { chromium, devices } = require('playwright');
const URL = 'http://localhost:8132/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL); await p.waitForTimeout(300);
  const scr = () => p.evaluate(() => (document.querySelector('.screen.show:not(#adstub)') || { id: 'none' }).id);
  await p.click('#playBtn'); await p.waitForTimeout(600);

  // 1. crash, then pause straight away: the game-over screen must still come
  await p.evaluate(() => { __kr.G.p.vy = -1; __kr.G.p.vx = 0; });     // run straight off the roof
  for (let i = 0; i < 100 && !(await p.evaluate(() => !!__kr.G.dead)); i++) await p.waitForTimeout(30);
  await p.keyboard.press('Escape'); await p.waitForTimeout(1200);
  ok(await scr() === 'pause', 'pause works right after crashing');
  await p.click('#resumeBtn'); await p.waitForTimeout(1400);
  ok(await scr() === 'over', 'game-over screen still appears after resuming (got ' + await scr() + ')');
  ok((await p.textContent('#overTitle')) === 'FELL!', 'heading says FELL! for running off the roof');

  // 2. revive and double coins
  const coins0 = await p.evaluate(() => __kr.save.coins);
  await p.evaluate(() => { __kr.G.coinsRun = 5; });
  await p.click('#reviveBtn'); await p.waitForTimeout(1600);
  ok(await p.evaluate(() => __kr.state === 'play' && !__kr.G.dead && __kr.G.inv > 0), 'revive puts you back in the run with a moment of safety');
  ok(await p.evaluate(() => __kr.G.trail.every(q => q.t > __kr.G.t - 1.8)), 'revive clears the old rope trail');
  await p.evaluate(() => { __kr.G.inv = 0; __kr.G.p.vy = 1; __kr.G.p.vx = 0; __kr.G.anchor = null; });
  for (let i = 0; i < 200 && await scr() !== 'over'; i++) await p.waitForTimeout(50);
  ok(await scr() === 'over' && await p.evaluate(() => getComputedStyle(document.getElementById('reviveBtn')).display === 'none'), 'only one revive per run');
  const before = await p.evaluate(() => __kr.save.coins);
  await p.click('#doubleBtn'); await p.waitForTimeout(1500);
  const after = await p.evaluate(() => __kr.save.coins);
  ok(after > before && await p.$eval('#doubleBtn', e => e.disabled), `double coins adds the run's coins again once (${before} -> ${after})`);

  // 3. quitting a run keeps the coins you picked up
  await p.click('#againBtn'); await p.waitForTimeout(800);
  const c1 = await p.evaluate(() => __kr.save.coins);
  await p.evaluate(() => { __kr.G.coinsRun = 7; });
  await p.keyboard.press('Escape'); await p.click('#quitBtn'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => __kr.save.coins) === c1 + 7, 'quitting mid-run banks the coins collected');

  // 4. shop: buy and equip, persists after reload
  await p.evaluate(() => { __kr.save.coins = 500; }); await p.click('#shopBtn'); await p.waitForTimeout(200);
  const ropes = await p.$$('.rope'); await ropes[1].click(); await p.waitForTimeout(100);
  ok(await p.evaluate(() => __kr.save.rope === 'gold' && __kr.save.owned.includes('gold') && __kr.save.coins === 440), 'buying a rope takes the coins and equips it');
  await p.reload(); await p.waitForTimeout(300);
  ok(await p.evaluate(() => __kr.save.rope === 'gold' && __kr.save.coins === 440), 'rope and coins survive a reload');
  ok(await p.evaluate(() => __kr.save.best > 0), 'best score survives a reload');

  // 5. Space to swing; release lets go
  await p.click('#playBtn'); await p.waitForTimeout(1500);
  await p.keyboard.down('Space'); await p.waitForTimeout(200);
  const grabbed = await p.evaluate(() => !!__kr.G.anchor);
  await p.keyboard.up('Space'); await p.waitForTimeout(80);
  ok(grabbed && await p.evaluate(() => !__kr.G.anchor), 'holding Space swings, releasing lets go');

  // 6. phone: touch and hold swings
  const m = await b.newContext({ ...devices['iPhone 13 landscape'] }); const q = await m.newPage(); q.on('pageerror', e => errs.push('phone: ' + e.message));
  await q.goto(URL); await q.waitForTimeout(300); await q.tap('#playBtn'); await q.waitForTimeout(1500);
  const cdp = await m.newCDPSession(q);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 200 }] }); await q.waitForTimeout(250);
  const g2 = await q.evaluate(() => !!__kr.G.anchor);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await q.waitForTimeout(80);
  ok(g2 && await q.evaluate(() => !__kr.G.anchor), 'touch and hold swings on a phone');

  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await b.close();
})();
