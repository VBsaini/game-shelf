// Random-input fuzzer for a game page.
// node fuzz.js <port> <seconds> <mobile 0|1> '<json: {keys:[], check:"js expr returning '' or a problem"}>'
const { chromium, devices } = require('playwright');
const [port, secs, mobile, cfgJson] = process.argv.slice(2);
const cfg = JSON.parse(cfgJson || '{}');
let seed = +(cfg.seed || 12345); const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
(async () => {
  const b = await chromium.launch();
  const ctx = mobile === '1' ? await b.newContext({ ...devices['iPhone 13 landscape'] }) : await b.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage();
  const errs = new Map(); const note = s => errs.set(s, (errs.get(s) || 0) + 1);
  p.on('pageerror', e => note('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') note('console: ' + m.text()); });
  await p.goto(`http://localhost:${port}/?` + Date.now()); await p.waitForTimeout(400);
  const end = Date.now() + secs * 1000; let actions = 0, checks = 0;
  const box = await p.evaluate(() => { const r = document.getElementById('game').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
  const tap = async (x, y) => { if (mobile === '1') await p.touchscreen.tap(x, y); else await p.mouse.click(x, y); };
  const states = new Map();
  while (Date.now() < end) {
    const r = rnd();
    try {
      if (r < 0.35) {
        const btns = await p.$$('button:visible:not([disabled])');
        const usable = [];
        for (const h of btns) { const id = await h.getAttribute('id'); if (id === 'muteBtn' && rnd() < 0.9) continue; usable.push(h); }
        if (usable.length) { const h = usable[Math.floor(rnd() * usable.length)]; await h.click({ timeout: 800 }).catch(() => {}); }
      } else if (r < 0.65) {
        await tap(box[0] + rnd() * box[2], box[1] + rnd() * box[3]);
      } else if (r < 0.8 && mobile !== '1') {
        const x = box[0] + rnd() * box[2], y = box[1] + rnd() * box[3];
        await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + (rnd() - 0.5) * 400, y + (rnd() - 0.5) * 400, { steps: 4 }); await p.waitForTimeout(rnd() * 400); await p.mouse.up();
      } else if (cfg.keys && cfg.keys.length) {
        const k = cfg.keys[Math.floor(rnd() * cfg.keys.length)];
        if (rnd() < 0.3) { await p.keyboard.down(k); await p.waitForTimeout(rnd() * 500); await p.keyboard.up(k); } else await p.keyboard.press(k);
      }
      if (rnd() < 0.15) await p.waitForTimeout(rnd() * 1500);
    } catch (e) { note('harness: ' + e.message.split('\n')[0]); }
    actions++;
    if (actions % 10 === 0) {
      if (cfg.check) { const bad = await p.evaluate(cfg.check).catch(e => 'check threw: ' + e.message); checks++; if (bad) note('INVARIANT: ' + bad); }
      if (cfg.state) { const s = await p.evaluate(cfg.state).catch(() => '?'); states.set(s, (states.get(s) || 0) + 1); }
    }
  }
  console.log(`${mobile === '1' ? 'phone' : 'desktop'}: ${actions} actions, ${checks} checks` + (states.size ? ', states seen: ' + [...states].map(([k, n]) => k + '×' + n).join(' ') : ''));
  for (const [k, n] of errs) console.log(`  ${n}× ${k}`);
  if (!errs.size) console.log('  no errors');
  await b.close();
})();
