// Gravity Golf scenario tests. Each prints PASS/FAIL.
const { chromium, devices } = require('playwright');
const URL = 'http://localhost:8131/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL); await p.waitForTimeout(300);
  const scr = () => p.evaluate(() => (document.querySelector('.screen.show:not(#adstub)') || { id: 'none' }).id);

  // 1. pause right after the ball drops in: the hole must still complete after resuming
  await p.evaluate(() => __gg.loadHole(0));
  await p.evaluate(async () => { const g = __gg, h = g.HOLES[0]; const hits = g.GP.search(h, h.tee[0], h.tee[1], 0, 360, 16, 'sink'); window.__shot = hits[0]; });
  await p.evaluate(() => { const s = window.__shot; __gg.aimAt(s.ang, s.pow); });
  await p.keyboard.press('Space');
  // wait until the flight ends, then pause immediately
  for (let i = 0; i < 200; i++) { if (!(await p.evaluate(() => !!__gg.flight))) break; await p.waitForTimeout(50); }
  await p.keyboard.press('Escape'); await p.waitForTimeout(1300);
  await p.click('#resumeBtn'); await p.waitForTimeout(1300);
  ok(await scr() === 'done', 'pausing during the sink still shows the hole-complete screen (got ' + await scr() + ')');

  // 2. a plain tap (no drag) must not shoot
  await p.evaluate(() => __gg.loadHole(1)); await p.waitForTimeout(200);
  await p.mouse.click(640, 400); await p.waitForTimeout(300);
  ok(await p.evaluate(() => __gg.strokes) === 0, 'a tap without dragging does not take a shot');

  // 3. keyboard shot during an ad is ignored
  await p.evaluate(() => { __gg.loadHole(1); __gg.aimAt(0, 0.5); });
  await p.evaluate(() => document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerdown', { clientX: 1280 - 330 + 40, clientY: 30, bubbles: true })));  // 🎬 Full aim
  await p.waitForTimeout(200);
  const adShowing = await p.evaluate(() => document.getElementById('adstub').classList.contains('show'));
  await p.keyboard.press('Space'); await p.waitForTimeout(1300);
  ok(adShowing && await p.evaluate(() => __gg.strokes) === 0, 'Space does nothing while an ad is showing (ad showing: ' + adShowing + ')');

  // 4. progress survives a reload
  await p.evaluate(() => __gg.autoplay(0)); await p.waitForTimeout(1200);
  await p.reload(); await p.waitForTimeout(300);
  await p.click('#playBtn'); await p.waitForTimeout(300);
  ok(await scr() === 'holes', 'returning players go to hole select');
  const h1 = await p.$eval('#grid .lvl:nth-of-type(1)', e => e.textContent);
  const h2disabled = await p.$eval('#grid button:nth-of-type(2)', e => e.disabled);
  ok(/★/.test(h1) && !h2disabled, 'hole 1 shows stars and hole 2 is unlocked after reload (' + h1.trim() + ')');

  // 5. last hole: Next goes to the hole list; skip on the last hole too
  await p.evaluate(() => __gg.autoplay(17)); await p.waitForTimeout(1300);
  ok(await scr() === 'done' && (await p.textContent('#nextBtn')).includes('Holes'), 'last hole offers the hole list');
  await p.click('#nextBtn'); await p.waitForTimeout(300);
  ok(await scr() === 'holes', 'Next on the last hole opens hole select');
  await p.evaluate(() => __gg.loadHole(17)); await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  await p.click('#skipBtn'); await p.waitForTimeout(1500);
  ok(await scr() === 'holes', 'skipping the last hole lands on hole select');

  // 6. restart in the middle of a flight
  await p.evaluate(() => { __gg.loadHole(4); __gg.aimAt(0.3, 1); }); await p.keyboard.press('Space'); await p.waitForTimeout(300);
  await p.keyboard.press('KeyR'); await p.waitForTimeout(500);
  ok(await p.evaluate(() => __gg.strokes === 0 && !__gg.flight), 'R mid-flight restarts cleanly');
  await p.waitForTimeout(1500);
  ok(await scr() === 'none', 'no stray popup after restarting mid-flight');

  // 7. phone: drag to shoot with touch
  const m = await b.newContext({ ...devices['iPhone 13 landscape'] }); const q = await m.newPage(); q.on('pageerror', e => errs.push('phone: ' + e.message));
  await q.goto(URL); await q.waitForTimeout(300);
  await q.evaluate(() => __gg.loadHole(0)); await q.waitForTimeout(200);
  const r = await q.evaluate(() => { const c = document.getElementById('game').getBoundingClientRect(); return [c.left, c.top, c.width / 1280]; });
  const cdp = await m.newCDPSession(q);
  const tp = (x, y) => [{ x: r[0] + x * r[2], y: r[1] + y * r[2] }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(180, 420) });
  for (let k = 1; k <= 6; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(180 - k * 15, 420 + k * 3) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await q.waitForTimeout(300);
  ok(await q.evaluate(() => __gg.strokes) === 1, 'a touch drag takes a shot on a phone');
  ok(await q.evaluate(() => getComputedStyle(document.getElementById('rotate')).display) === 'none', 'no rotate prompt in landscape');

  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await b.close();
})();
