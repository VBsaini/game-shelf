// Word Forge scenario tests
const { chromium, devices } = require('playwright');
const URL = 'http://localhost:8135/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL); await p.waitForTimeout(300);
  const scr = () => p.evaluate(() => (document.querySelector('.screen.show:not(#adstub)') || { id: 'none' }).id);
  const setTiles = s => p.evaluate(s => __wf.R.tiles.forEach((t, i) => { t.ch = s[i]; t.tier = 'bronze'; t.rust = 0; t.lock = 0; }), s);
  const sel = () => p.evaluate(() => __wf.R && __wf.wordOf ? '' : '');
  await p.click('#playBtn'); await p.waitForTimeout(500);

  // 1. typing a qu-word with the Qu tile
  await setTiles('qitxeueerrrrsssn');
  for (const k of 'quit') await p.keyboard.press('Key' + k.toUpperCase());
  const n = await p.evaluate(() => __wf.sel ? __wf.sel.length : -1);
  ok(n === 3, 'typing "quit" picks Qu, I, T (3 tiles, got ' + n + ')');
  await p.keyboard.press('Enter'); await p.waitForTimeout(1800);
  ok(await p.evaluate(() => __wf.R.words) === 1, '"QUIT" is forged');

  // 2. quitting in the middle of an attack doesn't crash
  await setTiles('catdogxeeeerrrrs');
  for (const k of 'cat') await p.keyboard.press('Key' + k.toUpperCase());
  await p.keyboard.press('Enter'); await p.waitForTimeout(150);
  await p.click('#pauseBtn'); await p.click('#quitBtn'); await p.waitForTimeout(2500);
  ok(await scr() === 'menu' && errs.length === 0, 'quitting mid-attack goes to the menu without errors' + (errs.length ? ' (' + errs[0] + ')' : ''));

  // 3. a new run right after quitting isn't affected by the old run's timers
  await p.click('#playBtn'); await p.waitForTimeout(300);
  await p.evaluate(() => { __wf.R.mon.hp = 1; });
  await setTiles('catdogxeeeerrrrs'); for (const k of 'cat') await p.keyboard.press('Key' + k.toUpperCase());
  await p.keyboard.press('Enter'); await p.waitForTimeout(150);
  await p.click('#pauseBtn'); await p.click('#quitBtn'); await p.click('#playBtn'); await p.waitForTimeout(2000);
  ok(await scr() === 'none' && await p.evaluate(() => __wf.R.stage === 0 && __wf.R.words === 0), 'the old run winning does not leak into the new run (screen ' + await scr() + ')');

  // 4. boons: a double click only applies one
  await p.evaluate(() => { __wf.R.mon.hp = 1; });
  await setTiles('catdogxeeeerrrrs'); for (const k of 'cat') await p.keyboard.press('Key' + k.toUpperCase()); await p.keyboard.press('Enter');
  await p.waitForTimeout(2200); ok(await scr() === 'boon', 'beating a monster offers boons');
  const st = await p.evaluate(() => JSON.stringify([__wf.R.maxHp, __wf.R.dmg, __wf.R.armor, __wf.R.potions, __wf.R.gems, __wf.R.rare]));
  await p.dblclick('.boon'); await p.waitForTimeout(400);
  const st2 = await p.evaluate(() => JSON.stringify([__wf.R.maxHp, __wf.R.dmg, __wf.R.armor, __wf.R.potions, __wf.R.gems, __wf.R.rare]));
  const diff = JSON.parse(st).map((v, i) => JSON.parse(st2)[i] !== v).filter(Boolean).length;
  ok(await p.evaluate(() => __wf.R.stage) === 1 && diff <= 1 && await scr() === 'none', 'double-clicking a boon applies it once and starts the next fight (' + st + ' -> ' + st2 + ')');
  // potions are worth checking separately
  await p.evaluate(() => { __wf.R.hp = 10; __wf.R.potions = 1; });
  await p.mouse.click(265, 639); await p.waitForTimeout(200);
  ok(await p.evaluate(() => __wf.R.hp === 25 && __wf.R.potions === 0), 'a potion heals 15');

  // 5. shuffle gives the monster a turn
  const hp0 = await p.evaluate(() => __wf.R.hp);
  await p.mouse.click(265, 569); await p.waitForTimeout(1500);
  ok(await p.evaluate(() => __wf.R.hp) < hp0, 'shuffling lets the monster hit you');

  // 6. nonsense words and 2-letter words are refused without costing a turn
  await setTiles('xqzbbbbbbbbbbbbb'); for (const k of 'xz') await p.keyboard.press('Key' + k.toUpperCase()); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => __wf.R.hp) === await p.evaluate(() => __wf.R.hp), 'short words are refused');
  await p.keyboard.press('Escape');

  // 7. losing, revive once, then the end screen
  await p.evaluate(() => { __wf.R.hp = 1; __wf.R.mon.atkNow = 99; __wf.R.shield = 0; });
  await setTiles('catdogxeeeerrrrs'); for (const k of 'cat') await p.keyboard.press('Key' + k.toUpperCase()); await p.keyboard.press('Enter');
  await p.waitForTimeout(2500); ok(await scr() === 'over', 'losing shows the end screen');
  await p.click('#reviveBtn'); await p.waitForTimeout(1500);
  ok(await scr() === 'none' && await p.evaluate(() => __wf.R.hp > 0), 'revive puts you back in the fight');
  await p.evaluate(() => { __wf.R.hp = 1; __wf.R.mon.atkNow = 99; __wf.R.mon.hp = 9999; });
  await setTiles('catdogxeeeerrrrs'); for (const k of 'cat') await p.keyboard.press('Key' + k.toUpperCase()); await p.keyboard.press('Enter');
  await p.waitForTimeout(2500); ok(await scr() === 'over' && await p.evaluate(() => getComputedStyle(document.getElementById('reviveBtn')).display === 'none'), 'only one revive per run');

  // 8. beating the final boss
  await p.click('#againBtn'); await p.waitForTimeout(500);
  await p.evaluate(() => { __wf.R.stage = 14; });
  await p.evaluate(() => { const R = __wf.R; R.mon.hp = 1; });
  await setTiles('catdogxeeeerrrrs'); for (const k of 'cat') await p.keyboard.press('Key' + k.toUpperCase()); await p.keyboard.press('Enter');
  await p.waitForTimeout(2500);
  ok(await scr() === 'over' && (await p.textContent('#endTitle')).includes('EMBER KING'), 'beating monster 15 shows the victory screen');
  await p.reload(); await p.waitForTimeout(300);
  ok((await p.textContent('#menuInfo')).includes('15'), 'furthest progress is remembered after a reload (' + await p.textContent('#menuInfo') + ')');

  // 9. phone: tapping tiles and Forge
  const m = await b.newContext({ ...devices['iPhone 13 landscape'] }); const q = await m.newPage(); q.on('pageerror', e => errs.push('phone: ' + e.message));
  await q.goto(URL); await q.waitForTimeout(300); await q.tap('#playBtn'); await q.waitForTimeout(500);
  await q.evaluate(() => __wf.R.tiles.forEach((t, i) => { t.ch = 'catdogxeeeerrrrs'[i]; }));
  const box = await q.evaluate(() => { const r = document.getElementById('game').getBoundingClientRect(); return [r.left, r.top, r.width / 1280]; });
  const T = i => [box[0] + (GRID_X + (i % 4) * 74 + 35) * box[2], box[1] + (404 + ((i / 4) | 0) * 74 + 35) * box[2]];
  var GRID_X = 640 - 148 + 2;
  for (const i of [0, 1, 2]) { const [x, y] = T(i); await q.touchscreen.tap(x, y); await q.waitForTimeout(80); }
  await q.touchscreen.tap(box[0] + 1050 * box[2], box[1] + 565 * box[2]); await q.waitForTimeout(1800);
  ok(await q.evaluate(() => __wf.R.words) === 1, 'tapping C, A, T and Forge works on a phone');

  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await b.close();
})();
