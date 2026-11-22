// Tidepool Tycoon scenario tests
const { chromium, devices } = require('playwright');
const URL = 'http://localhost:8133/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL); await p.waitForTimeout(300);
  const scr = () => p.evaluate(() => (document.querySelector('.screen.show:not(#adstub)') || { id: 'none' }).id);
  await p.click('#playBtn'); await p.waitForTimeout(400);

  // 1. buying ×1, ×10 and Max
  await p.evaluate(() => { __tt.E.plankton = 1e6; __tt.refreshPanel(true); });
  await p.click('#c_snail'); ok(await p.evaluate(() => __tt.E.owned.snail) === 1, 'buy ×1 adds one');
  await p.click('.amt[data-n="10"]'); await p.click('#c_snail'); ok(await p.evaluate(() => __tt.E.owned.snail) === 11, 'buy ×10 adds ten');
  await p.click('.amt[data-n="max"]'); const pl = await p.evaluate(() => __tt.E.plankton); await p.click('#c_shrimp');
  ok(await p.evaluate(() => __tt.E.owned.shrimp > 10 && __tt.E.plankton >= 0 && __tt.E.plankton < __tt.CREATURES[1].cost * Math.pow(1.13, __tt.E.owned.shrimp)), 'Max buys as many as you can afford and never goes negative');
  await p.evaluate(() => { __tt.E.plankton = 0; __tt.refreshPanel(false); }); await p.click('#c_crab');
  ok(await p.evaluate(() => __tt.E.owned.crab) === 0, 'cannot buy what you cannot afford');

  // 2. upgrades tab and pearl shop
  await p.click('#tab_upgrades'); await p.evaluate(() => { __tt.E.plankton = 1e4; __tt.refreshPanel(true); });
  await p.click('#u_net1'); ok(await p.evaluate(() => __tt.E.ups.net1 === 1), 'buying an upgrade works');
  const pk = await p.evaluate(() => __tt.E.plankton); await p.click('#u_net1');
  ok(await p.evaluate(() => __tt.E.plankton) >= pk, 'an owned upgrade cannot be bought twice');
  await p.click('#tab_pearls'); await p.evaluate(() => { __tt.E.pearls = 10000; __tt.refreshPanel(true); });
  for (let k = 0; k < 9; k++) await p.click('#p_arm');
  ok(await p.evaluate(() => __tt.E.pups.arm === 6), 'pearl upgrades stop at their maximum level');
  await p.click('#tab_creatures');

  // 3. high tide
  await p.evaluate(() => { const E = __tt.E; E.earnedTide = 8e6; E.pups.start = 2; __tt.refreshPanel(true); });
  const pearls0 = await p.evaluate(() => __tt.E.pearls), expect = await p.evaluate(() => __tt.pearlsForTide(__tt.E));
  await p.click('#tideBtn'); await p.waitForTimeout(150); ok(await scr() === 'tide', 'High tide asks to confirm');
  await p.click('#tideYes'); await p.waitForTimeout(1400);
  ok(await p.evaluate(() => __tt.E.pearls) === pearls0 + expect, `tide pays ${expect} pearls`);
  ok(await p.evaluate(() => __tt.E.owned.snail === 10 && __tt.E.owned.shrimp === 10 && __tt.E.owned.crab === 0 && !__tt.E.ups.net1 && __tt.E.pups.arm === 6), 'tide resets plankton, creatures and upgrades, keeps pearl upgrades, applies the head start');
  ok(await p.$eval('#tideBtn', e => e.disabled), 'tide button is disabled again right after a tide');

  // 4. offline earnings must not use a 5-minute boost for the whole absence
  await p.evaluate(() => { const E = __tt.E; E.boostUntil = Date.now() + 5 * 60e3; E.last = Date.now() - 3 * 3600e3; });
  const base = await p.evaluate(() => { const E = __tt.E, b = E.boostUntil; E.boostUntil = 0; const v = __tt.pps(E); E.boostUntil = b; return v; });
  const pk2 = await p.evaluate(() => __tt.E.plankton);
  await p.keyboard.press('Escape'); await p.click('#menuBtn'); await p.evaluate(() => { __tt.E.last = Date.now() - 3 * 3600e3; });
  await p.click('#playBtn'); await p.waitForTimeout(300);
  const gain = await p.evaluate(() => __tt.E.plankton) - pk2;
  const cap = await p.evaluate(() => (3 + 2 * (__tt.E.pups.nap || 0)) * 3600);
  ok(Math.abs(gain - base * cap * 0.5) / (base * cap * 0.5) < 0.05, `offline earnings ignore the short ad boost (got ${Math.round(gain)}, expected about ${Math.round(base * cap * 0.5)})`);
  await p.click('#awayOk');

  // 5. hiding the tab for a while and coming back through the pause menu pays offline earnings
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForTimeout(100);
  await p.evaluate(() => { __tt.E.last = Date.now() - 2 * 3600e3; Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  ok(await scr() === 'pause', 'hiding the tab pauses');
  await p.click('#resumeBtn'); await p.waitForTimeout(300);
  ok(await scr() === 'away', 'coming back after a long time shows offline earnings (got ' + await scr() + ')');
  if (await scr() === 'away') await p.click('#awayOk');

  // 6. huge numbers stay readable and buying Max stays quick
  await p.evaluate(() => { __tt.E.plankton = 1e40; __tt.refreshPanel(true); });
  await p.click('.amt[data-n="max"]'); const t0 = Date.now(); await p.click('#c_shark'); const dt = Date.now() - t0;
  const txt = await p.evaluate(() => [__tt.fmt(1e40), __tt.fmt(1e60), __tt.fmt(1234), __tt.fmt(0.5)].join(' '));
  ok(!/NaN|undefined|Infinity/.test(txt) && dt < 2000, 'huge numbers format cleanly (' + txt + ') and Max is quick (' + dt + ' ms)');
  ok(await p.evaluate(() => isFinite(__tt.E.plankton) && __tt.E.plankton >= 0), 'plankton stays a real number');

  // 7. progress survives a reload
  const snap = await p.evaluate(() => JSON.stringify([__tt.E.pearls, __tt.E.owned.shark, __tt.E.tides]));
  await p.waitForTimeout(5500); await p.reload(); await p.waitForTimeout(300);
  ok(await p.evaluate(() => JSON.stringify([__tt.E.pearls, __tt.E.owned.shark, __tt.E.tides])) === snap, 'pearls, creatures and tides survive a reload');

  // 8. phone: tap the pool, panel buttons work
  const m = await b.newContext({ ...devices['iPhone 13 landscape'] }); const q = await m.newPage(); q.on('pageerror', e => errs.push('phone: ' + e.message));
  await q.goto(URL); await q.waitForTimeout(300); await q.tap('#playBtn'); await q.waitForTimeout(500);
  if (await q.evaluate(() => (document.querySelector('.screen.show:not(#adstub)') || {}).id) === 'away') await q.tap('#awayOk');
  const box = await q.evaluate(() => { const r = document.getElementById('game').getBoundingClientRect(); return [r.left, r.top, r.width / 1280]; });
  const pk3 = await q.evaluate(() => __tt.E.plankton);
  await q.touchscreen.tap(box[0] + 390 * box[2], box[1] + 400 * box[2]); await q.waitForTimeout(100);
  ok(await q.evaluate(() => __tt.E.plankton) > pk3, 'tapping the pool on a phone gathers plankton');
  await q.tap('#tab_pearls'); ok(await q.evaluate(() => document.getElementById('tab_pearls').classList.contains('on')), 'panel tabs work on a phone');

  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await b.close();
})();
