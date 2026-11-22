// Deckhand scenario tests
const { chromium, devices } = require('playwright');
const URL = 'http://localhost:8136/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL); await p.waitForTimeout(300);
  const scr = () => p.evaluate(() => (document.querySelector('.screen.show:not(#adstub)') || { id: 'none' }).id);
  const hand = h => p.evaluate(h => { __dh.R.hand = h.slice(); __dh.R.energy = 5; }, h);
  await p.click('#playBtn'); await p.waitForTimeout(500);

  // 1. keys: pick a card with 1-8, a spot with Q W E R
  await hand(['bruiser', 'gunner', 'patch', 'deckhand']);
  await p.keyboard.press('Digit1'); await p.keyboard.press('KeyR'); await p.waitForTimeout(300);
  await p.keyboard.press('Digit1'); await p.keyboard.press('KeyW'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => __dh.R.slots[3]?.id === 'bruiser' && __dh.R.slots[1]?.id === 'gunner' && __dh.R.energy === 1), 'keys place a Bruiser at the bow and a Gunner at a cannon');
  // 2. orders: tap twice
  await p.evaluate(() => { __dh.R.hull = 20; __dh.R.energy = 3; });
  await p.keyboard.press('Digit1'); await p.keyboard.press('Digit1'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => __dh.R.hull) === 27, 'Patch Hull (pick it twice) repairs 7');
  // 3. replacing crew sends the old card to the discard pile
  const d0 = await p.evaluate(() => __dh.R.discard.length);
  await p.keyboard.press('Digit1'); await p.keyboard.press('KeyR'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => __dh.R.slots[3]?.id === 'deckhand') && await p.evaluate(() => __dh.R.discard.length) === d0 + 1, 'placing over a crew member replaces them (old one to the discard)');
  // 4. not enough energy
  await hand(['bruiser']); await p.evaluate(() => { __dh.R.energy = 1; });
  await p.keyboard.press('Digit1'); await p.keyboard.press('KeyE'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => __dh.R.hand.length === 1 && !__dh.R.slots[2]), 'cards you cannot afford are not played');
  // 5. deck view
  await p.mouse.click(1165, 580); await p.waitForTimeout(200);
  ok(await scr() === 'deckview' && await p.$$eval('.dcard', e => e.length) > 0, 'Deck button shows your deck');
  await p.click('#deckBack'); ok(await scr() === 'none', 'Back returns to the fight');

  // 6. quitting in the middle of the end-of-turn animation
  await p.keyboard.press('Space'); await p.waitForTimeout(200);
  await p.click('#pauseBtn'); await p.click('#quitBtn'); await p.waitForTimeout(3000);
  ok(await scr() === 'menu' && errs.length === 0, 'quitting mid-turn goes to the menu without errors' + (errs.length ? ' (' + errs[0] + ')' : ''));
  // 7. old run's win doesn't leak into a new run
  await p.click('#playBtn'); await p.waitForTimeout(300);
  await p.evaluate(() => { __dh.R.mon.hp = 1; __dh.R.mon.block = 0; __dh.R.slots[2] = { id: 'deckhand', hp: 4, hpMax: 4 }; });
  await p.keyboard.press('Space'); await p.waitForTimeout(100);
  await p.click('#pauseBtn'); await p.click('#quitBtn'); await p.click('#playBtn'); await p.waitForTimeout(2500);
  ok(await scr() === 'none' && await p.evaluate(() => __dh.R.fight === 0), 'the old voyage winning does not leak into the new one (screen ' + await scr() + ')');

  // 8. rewards: double click takes one card; Skip double click starts one fight
  await p.evaluate(() => { __dh.R.mon.hp = 1; __dh.R.mon.block = 0; __dh.R.slots[2] = { id: 'deckhand', hp: 4, hpMax: 4 }; });
  await p.keyboard.press('Space'); await p.waitForTimeout(2500);
  ok(await scr() === 'reward', 'winning offers cards');
  const deck0 = await p.evaluate(() => __dh.R.deck.length);
  await p.dblclick('.rcard'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => __dh.R.deck.length) === deck0 + 1 && await p.evaluate(() => __dh.R.fight) === 1, 'double-clicking a reward adds one card');
  await p.evaluate(() => { __dh.R.mon.hp = 1; __dh.R.mon.block = 0; __dh.R.slots[2] = { id: 'deckhand', hp: 4, hpMax: 4 }; });
  await p.keyboard.press('Space'); await p.waitForTimeout(2500);
  const deck1 = await p.evaluate(() => __dh.R.deck.length);
  await p.dblclick('#skipCard'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => __dh.R.deck.length) === deck1 && await p.evaluate(() => __dh.R.fight === 2 && __dh.R.turn === 1), 'Skip takes no card and starts one fight');

  // 9. losing, one revive, then the end
  await p.evaluate(() => { __dh.R.hull = 1; __dh.R.block = 0; __dh.R.slots = [null, null, null, null]; __dh.R.intent = ['hull', 50]; });
  await p.keyboard.press('Space'); await p.waitForTimeout(2500);
  ok(await scr() === 'over', 'the ship sinks at 0 hull');
  await p.click('#reviveBtn'); await p.waitForTimeout(1500);
  ok(await scr() === 'none' && await p.evaluate(() => __dh.R.hull > 0), 'revive patches the hull');
  await p.evaluate(() => { __dh.R.hull = 1; __dh.R.block = 0; __dh.R.slots = [null, null, null, null]; __dh.R.intent = ['hull', 50]; });
  await p.keyboard.press('Space'); await p.waitForTimeout(2500);
  ok(await scr() === 'over' && await p.evaluate(() => getComputedStyle(document.getElementById('reviveBtn')).display === 'none'), 'only one revive per voyage');

  // 10. victory over the Leviathan, remembered after reload
  await p.click('#againBtn'); await p.waitForTimeout(500);
  await p.evaluate(() => { __dh.R.fight = 8; __dh.R.mon.hp = 1; __dh.R.mon.block = 0; __dh.R.slots[2] = { id: 'deckhand', hp: 4, hpMax: 4 }; });
  await p.keyboard.press('Space'); await p.waitForTimeout(2500);
  ok(await scr() === 'over' && (await p.textContent('#endTitle')).includes('LEVIATHAN'), 'beating fight 9 shows the victory screen');
  await p.reload(); await p.waitForTimeout(300);
  ok((await p.textContent('#menuInfo')).includes('9 / 9'), 'furthest voyage is remembered (' + await p.textContent('#menuInfo') + ')');

  // 11. phone: tap a card, then a spot
  const m = await b.newContext({ ...devices['iPhone 13 landscape'] }); const q = await m.newPage(); q.on('pageerror', e => errs.push('phone: ' + e.message));
  await q.goto(URL); await q.waitForTimeout(300); await q.tap('#playBtn'); await q.waitForTimeout(500);
  await q.evaluate(() => { __dh.R.hand = ['deckhand', 'deckhand', 'deckhand', 'deckhand']; __dh.R.energy = 3; });
  const box = await q.evaluate(() => { const r = document.getElementById('game').getBoundingClientRect(); return [r.left, r.top, r.width / 1280]; });
  const n = 4, gap = 128, x0 = 640 - (gap * (n - 1) + 120) / 2;
  await q.touchscreen.tap(box[0] + (x0 + 40) * box[2], box[1] + 620 * box[2]); await q.waitForTimeout(150);
  await q.touchscreen.tap(box[0] + 779 * box[2], box[1] + 375 * box[2]); await q.waitForTimeout(300);
  ok(await q.evaluate(() => __dh.R.slots[3]?.id === 'deckhand'), 'tap a card then the bow works on a phone');

  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await b.close();
})();
