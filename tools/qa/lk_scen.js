// Lantern Keepers scenario tests
const { chromium, devices } = require('playwright');
const URL = 'http://localhost:8134/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL); await p.waitForTimeout(300);
  const scr = () => p.evaluate(() => (document.querySelector('.screen.show:not(#adstub)') || { id: 'none' }).id);
  const pos = () => p.evaluate(() => JSON.stringify(__lk.cur.p));
  await p.click('#playBtn'); await p.waitForTimeout(400);

  // 1. holding a key keeps walking
  const s0 = await pos(); await p.keyboard.down('KeyD'); await p.waitForTimeout(700); await p.keyboard.up('KeyD');
  ok(await p.evaluate(() => __lk.cur.p[0][0]) >= 4, 'holding D keeps Amber walking (' + s0 + ' -> ' + await pos() + ')');
  // 2. undo and retry
  const m1 = await p.evaluate(() => __lk.moves); await p.keyboard.press('KeyZ');
  ok(await p.evaluate(() => __lk.moves) === m1 - 1, 'Z undoes one move');
  await p.keyboard.press('KeyR'); await p.waitForTimeout(100);
  ok(await p.evaluate(() => __lk.moves === 0 && JSON.stringify(__lk.cur.p) === '[[1,1],[1,7]]'), 'R puts both keepers back at the start');
  // 3. no moves while the hint ad plays
  await p.evaluate(() => document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerdown', { clientX: 1280 - 244 + 40, clientY: 25, bubbles: true })));
  await p.waitForTimeout(150);
  const ad = await p.evaluate(() => document.getElementById('adstub').classList.contains('show'));
  const before = await pos(); await p.keyboard.press('KeyD'); await p.keyboard.press('ArrowUp'); await p.waitForTimeout(1300);
  ok(ad && await pos() === before, 'keepers do not move while the hint ad is showing');
  ok(await p.evaluate(() => Array.isArray(__lk.hintMoves) && __lk.hintMoves.length > 0), 'hint arrows appear after the ad');
  // 4. a refused move explains itself on a bridge level
  await p.evaluate(() => __lk.loadLevel(1)); await p.waitForTimeout(100);
  for (const k of ['KeyD', 'KeyD', 'KeyS', 'KeyS', 'KeyD', 'KeyD']) await p.keyboard.press(k);
  ok(await p.evaluate(() => __lk.cur.p[0][0]) <= 5, 'Amber alone cannot walk onto a dark bridge');
  // 5. pause and resume, skip the last level, Next on the last level
  await p.keyboard.press('Escape'); ok(await scr() === 'pause', 'Esc pauses'); await p.keyboard.press('Escape'); ok(await scr() === 'none', 'Esc resumes');
  await p.evaluate(() => __lk.play(11)); await p.waitForTimeout(1000);
  ok(await scr() === 'win' && (await p.textContent('#nextBtn')).includes('Levels'), 'finishing the last level offers the level list');
  await p.click('#nextBtn'); await p.waitForTimeout(200); ok(await scr() === 'levels', 'Next on the last level opens level select');
  // 6. progress survives a reload; stars shown
  await p.reload(); await p.waitForTimeout(300); await p.click('#playBtn'); await p.waitForTimeout(300);
  const t12 = await p.$eval('#grid button:nth-child(12)', e => e.textContent);
  ok(await scr() === 'levels' && /★/.test(t12), 'level select remembers finished levels after a reload (' + t12 + ')');
  // 7. pressing keys during the win pause does nothing odd
  await p.evaluate(() => __lk.loadLevel(0)); await p.evaluate(() => { const sol = __lk.LK.solve(__lk.LK.parse(__lk.LEVELS[0])); for (const [w, d] of sol) __lk.tryMove(w, d); });
  for (const k of ['KeyZ', 'KeyR', 'KeyD', 'Escape']) await p.keyboard.press(k);
  await p.waitForTimeout(900);
  ok(await scr() === 'win', 'keys pressed during the win moment do not break the win screen (got ' + await scr() + ')');

  // 8. phone: d-pads move each keeper and don't hide the start tiles
  const m = await b.newContext({ ...devices['iPhone 13 landscape'] }); const q = await m.newPage(); q.on('pageerror', e => errs.push('phone: ' + e.message));
  await q.goto(URL); await q.waitForTimeout(300); await q.tap('#playBtn'); await q.waitForTimeout(400);
  ok(await q.evaluate(() => getComputedStyle(document.getElementById('pads')).display) === 'block', 'd-pads show on a phone');
  await q.tap('.pad[data-who="0"] [data-d=R]'); await q.waitForTimeout(250);
  await q.tap('.pad[data-who="1"] [data-d=U]'); await q.waitForTimeout(250);
  ok(await q.evaluate(() => __lk.cur.p[0][0] === 2 && __lk.cur.p[1][1] === 6), 'left pad moves Amber, right pad moves Teal (' + await q.evaluate(() => JSON.stringify(__lk.cur.p)) + ')');
  await q.screenshot({ path: process.argv[2] + '/lk_phone.png' });
  const overlap = await q.evaluate(() => {
    // does a pad cover the centre of any keeper's start tile in any level?
    const c = document.getElementById('game').getBoundingClientRect(), k = c.width / 1280, hits = [];
    const pads = [...document.querySelectorAll('.pad')].map(e => e.getBoundingClientRect());
    __lk.LEVELS.forEach((L, i) => { const st = __lk.LK.parse(L); for (const s of [...st.start, ...st.exits.map(e => [e % st.W, (e / st.W) | 0])]) { const x = c.left + (64 + s[0] * 72 + 36) * k, y = c.top + (52 + s[1] * 72 + 36) * k; if (pads.some(r => x > r.left && x < r.right && y > r.top && y < r.bottom)) hits.push(i + 1); } });
    return [...new Set(hits)];
  });
  ok(!overlap.length, 'd-pads never cover a start or exit tile (covered in levels: ' + overlap.join(',') + ')');
  ok(!(await q.evaluate(() => document.querySelector('.keepers').textContent)).includes('W A S D'), 'the phone menu talks about pads, not keys');

  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await b.close();
})();
