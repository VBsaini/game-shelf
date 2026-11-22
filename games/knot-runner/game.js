'use strict';
(() => {
// =====================================================================
//  Knot Runner
// =====================================================================
const W = 1280, H = 720, TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const irand = (a, b) => Math.floor(rand(a, b + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const $ = id => document.getElementById(id);

// ---------------------------------------------------------------------
//  Storage
// ---------------------------------------------------------------------
const Store = {
  get(k, d) { try { const v = localStorage.getItem('knot_runner_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('knot_runner_' + k, JSON.stringify(v)); } catch (e) { } },
};

// ---------------------------------------------------------------------
//  Sound (WebAudio, synthesized; the game fills in SFX and MUSIC)
// ---------------------------------------------------------------------
const Sound = (() => {
  let ac = null, master, sfxBus, musBus, noiseBuf;
  let muted = Store.get('muted', false), ducked = false, hidden = false;
  const lastPlay = {};
  const music = { on: false, step: 0, next: 0, timer: null, mode: 1 };
  let SFX = {}, MUSIC = null;
  function init() {
    if (ac) { if (ac.state === 'suspended' && !hidden) ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try { ac = new AC(); } catch (e) { ac = null; return; }
    master = ac.createGain(); master.connect(ac.destination);
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 5; comp.connect(master);
    sfxBus = ac.createGain(); sfxBus.gain.value = 0.6; sfxBus.connect(comp);
    const mf = ac.createBiquadFilter(); mf.type = 'lowpass'; mf.frequency.value = 2200; mf.connect(comp);
    const ml = ac.createGain(); ml.gain.value = 0.26; ml.connect(mf);
    musBus = ac.createGain(); musBus.connect(ml);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    applyVolume();
    if (music.on) startMusic();
  }
  function applyVolume() { if (master) master.gain.setTargetAtTime(muted || ducked ? 0 : 1, ac.currentTime, 0.03); }
  const now = () => ac.currentTime;
  function tone(type, f0, f1, dur, vol, at, dest) {
    const t = at || now(), o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || sfxBus); o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(dur, vol, type, f0, f1, at, q, dest) {
    const t = at || now(), s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; f.type = type; f.Q.value = q || 1;
    f.frequency.setValueAtTime(f0, t); if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || sfxBus); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.03);
  }
  const N = n => 440 * Math.pow(2, (n - 69) / 12);
  function schedule() {
    if (!ac || !music.on || !MUSIC) return;
    while (music.next < now() + 0.2) { const dt = MUSIC(music.step, music.next, music.mode); music.step++; music.next += dt; }
  }
  function startMusic() { music.on = true; if (ac && !music.timer) { music.next = now() + 0.1; music.timer = setInterval(schedule, 50); } }
  const api = {
    init,
    define(sfx, mus) { SFX = sfx; MUSIC = mus; },
    play(name, gap, arg) {
      if (!ac || muted || ducked || hidden) return;
      const t = performance.now();
      if (gap && lastPlay[name] && t - lastPlay[name] < gap * 1000) return;
      lastPlay[name] = t;
      try { SFX[name](arg); } catch (e) { }
    },
    music(mode) { if (mode != null) music.mode = mode; startMusic(); },
    duck(on) { ducked = on; applyVolume(); },
    setHidden(h) { hidden = h; if (ac) { if (h) ac.suspend(); else ac.resume(); } },
    get muted() { return muted; },
    toggleMute() { muted = !muted; Store.set('muted', muted); applyVolume(); return muted; },
    // building blocks for SFX / MUSIC definitions
    tone: (...a) => tone(...a), noise: (...a) => noise(...a), N, now: () => now(), get musBus() { return musBus; },
  };
  return api;
})();

// ---------------------------------------------------------------------
//  Platform / ads (Poki SDK, CrazyGames SDK v3, or a local test stub)
// ---------------------------------------------------------------------
const Platform = (() => {
  let kind = 'none', playing = false;
  const poki = () => window.PokiSDK;
  const cg = () => window.CrazyGames && window.CrazyGames.SDK;
  return {
    get kind() { return kind; },
    async init() {
      if (poki()) { kind = 'poki'; try { await poki().init(); } catch (e) { console.warn('Poki SDK init failed', e); } }
      else if (cg()) { kind = 'crazy'; try { await cg().init(); cg().game.loadingStart(); } catch (e) { console.warn('CrazyGames SDK init failed', e); } }
    },
    loadingFinished() { try { if (kind === 'poki') poki().gameLoadingFinished(); else if (kind === 'crazy') cg().game.loadingStop(); } catch (e) { } },
    gameplayStart() { if (playing) return; playing = true; try { if (kind === 'poki') poki().gameplayStart(); else if (kind === 'crazy') cg().game.gameplayStart(); } catch (e) { } },
    gameplayStop() { if (!playing) return; playing = false; try { if (kind === 'poki') poki().gameplayStop(); else if (kind === 'crazy') cg().game.gameplayStop(); } catch (e) { } },
    happy() { try { if (kind === 'crazy') cg().game.happytime(); } catch (e) { } },
    commercialBreak() {
      return new Promise(res => {
        const done = () => { Sound.duck(false); res(); };
        try {
          if (kind === 'poki') poki().commercialBreak(() => Sound.duck(true)).then(done, done);
          else if (kind === 'crazy') cg().ad.requestAd('midgame', { adStarted: () => Sound.duck(true), adFinished: done, adError: done });
          else done();
        } catch (e) { done(); }
      });
    },
    rewardedBreak() {
      return new Promise(res => {
        const done = ok => { Sound.duck(false); res(ok); };
        Sound.duck(true);
        try {
          if (kind === 'poki') poki().rewardedBreak().then(ok => done(!!ok), () => done(false));
          else if (kind === 'crazy') cg().ad.requestAd('rewarded', { adFinished: () => done(true), adError: () => done(false) });
          else { $('adstub').classList.add('show'); setTimeout(() => { $('adstub').classList.remove('show'); done(true); }, 1100); }
        } catch (e) { done(false); }
      });
    },
  };
})();

// ---------------------------------------------------------------------
//  Canvas (fixed 1280x720 design space, letterboxed, crisp on HiDPI)
// ---------------------------------------------------------------------
const canvas = $('game'), wrap = $('wrap');
let ctx = canvas.getContext('2d');
let viewScale = 1, dpr = 1;
function resize() {
  viewScale = Math.min(window.innerWidth / W, window.innerHeight / H);
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = Math.floor(W * viewScale), ch = Math.floor(H * viewScale);
  canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
  canvas.width = Math.floor(cw * dpr); canvas.height = Math.floor(ch * dpr);
  wrap.style.width = cw + 'px'; wrap.style.height = ch + 'px';
  wrap.style.fontSize = (16 * viewScale) + 'px';
}
window.addEventListener('resize', resize);
resize();
function toCanvas(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H }; }
function hudText(str, x, y, size, color = '#fff', align = 'left', weight = 800, outline = 'rgba(0,0,0,.55)') {
  ctx.font = `${weight} ${size}px system-ui,-apple-system,"Segoe UI",sans-serif`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  if (outline) { ctx.lineWidth = Math.max(3, size / 6); ctx.strokeStyle = outline; ctx.lineJoin = 'round'; ctx.strokeText(str, x, y); }
  ctx.fillStyle = color; ctx.fillText(str, x, y);
}
function rr(x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
function circle(x, y, r, c) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
function setupMute() {
  const upd = () => { $('muteBtn').textContent = Sound.muted ? '🔇' : '🔊'; };
  $('muteBtn').onclick = () => { Sound.init(); Sound.toggleMute(); upd(); }; upd();
  window.addEventListener('keydown', e => { if (e.code === 'KeyM' && !e.repeat) { Sound.init(); Sound.toggleMute(); upd(); } });
  window.addEventListener('pointerdown', () => Sound.init(), true);
  window.addEventListener('keydown', () => Sound.init(), true);
}

// =====================================================================
//  Knot Runner: hold to swing round a post, let go to fly. Your rope stays
//  behind you for a few seconds, and running into it tangles you.
// =====================================================================
const EDGE = 46;                 // rooftop edge: the void above and below
const TRAIL_LIFE = 3.2;          // seconds the rope stays on the ground
const TRAIL_SAFE = 0.3;          // the newest bit of rope never trips you
const GRAB_RANGE = 270;
const ROPES = [
  { id: 'red', name: 'Red', col: '#ff5d5d', cost: 0 },
  { id: 'gold', name: 'Gold', col: '#ffd166', cost: 60 },
  { id: 'mint', name: 'Mint', col: '#5ef2b8', cost: 120 },
  { id: 'sky', name: 'Sky', col: '#6cc6ff', cost: 200 },
  { id: 'violet', name: 'Violet', col: '#b98bff', cost: 320 },
  { id: 'rainbow', name: 'Rainbow', col: 'rainbow', cost: 600 },
];

// ---------------------------------------------------------------------
//  Sound
// ---------------------------------------------------------------------
{
  const { tone, noise, N } = Sound;
  Sound.define({
    click: () => tone('triangle', 700, 900, 0.06, 0.12),
    grab: () => { tone('square', 520, 760, 0.05, 0.06); noise(0.06, 0.05, 'highpass', 3000, 3000); },
    release: () => tone('sine', 700, 380, 0.08, 0.08),
    coin: i => tone('triangle', N(84 + Math.min(i || 0, 8)), N(88 + Math.min(i || 0, 8)), 0.09, 0.1),
    whip: () => noise(0.12, 0.12, 'bandpass', 4000, 1200, 0, 3),
    crash: () => { noise(0.5, 0.3, 'lowpass', 1500, 100); tone('sawtooth', 220, 50, 0.5, 0.15); },
    fall: () => tone('triangle', 600, 80, 0.7, 0.15),
    revive: () => { const t = Sound.now(); [72, 76, 79, 84].forEach((n, i) => tone('triangle', N(n), N(n), 0.2, 0.12, t + i * 0.06)); },
    best: () => { const t = Sound.now(); [79, 83, 86, 91].forEach((n, i) => tone('triangle', N(n), N(n), 0.25, 0.13, t + i * 0.08)); },
  }, (step, t, mode) => {
    // driving bass + hats; quieter on menus
    const STEP = 60 / 128 / 2, bus = Sound.musBus, s = step % 16, bar = Math.floor(step / 16) % 4;
    const ROOT = [45, 45, 41, 43][bar];
    if (mode === 2) {
      if (s % 4 === 0) tone('sine', 110, 45, 0.18, 0.12, t, bus);
      if (s % 2 === 1) noise(0.03, 0.025, 'highpass', 7000, 7000, t, 1, bus);
      if ([0, 3, 6, 8, 11, 14].includes(s)) tone('sawtooth', N(ROOT), N(ROOT), STEP * 0.9, 0.035, t, bus);
      if (s === 0 || s === 10) { const n = ROOT + 24 + [0, 7, 12, 3][bar]; tone('triangle', N(n), N(n), STEP * 3, 0.03, t, bus); }
    } else if (s % 4 === 0) tone('triangle', N(ROOT + 12), N(ROOT + 12), STEP * 3, 0.025, t, bus);
    return STEP;
  });
}

// ---------------------------------------------------------------------
//  State
// ---------------------------------------------------------------------
let state = 'menu';             // menu | shop | play | paused | over
let G = null;                   // current run
let hideHud = false, holding = false;
const save = { best: Store.get('best', 0), coins: Store.get('coins', 0), owned: Store.get('owned', ['red']), rope: Store.get('rope', 'red') };
function persist() { Store.set('best', save.best); Store.set('coins', save.coins); Store.set('owned', save.owned); Store.set('rope', save.rope); }

function newRun(seed) {
  G = {
    p: { x: 220, y: H / 2, vx: 1, vy: 0 }, speed: 330, camX: 0, t: 0, dist: 0,
    anchor: null, dir: 1, posts: [], saws: [], coins: [], trail: [], genX: 420, combo: 0, coinsRun: 0,
    dead: null, revived: false, inv: 0, shake: 0, parts: [], texts: [], swingAngle: 0, rnd: seed || (Math.random() * 1e9) | 0,
    tipT: 0, grabs: 0,
  };
  holding = false;
  generate();
  setState('play');
}
// a small seeded RNG so a run can be replayed by the test bot
function rng() { G.rnd = (G.rnd * 1664525 + 1013904223) >>> 0; return G.rnd / 4294967296; }
function rr2(a, b) { return a + rng() * (b - a); }

// ---------------------------------------------------------------------
//  World generation: columns of posts, later saws, coins round posts
// ---------------------------------------------------------------------
function generate() {
  while (G.genX < G.camX + W + 400) {
    const x = G.genX, d = x / 100;                      // metres
    const n = rng() < 0.35 ? 2 : 1;
    const placed = [];
    for (let k = 0; k < n; k++) {
      for (let tries = 0; tries < 8; tries++) {
        const y = rr2(EDGE + 70, H - EDGE - 70);
        if (placed.every(py => Math.abs(py - y) > 170) && G.posts.every(p => Math.hypot(p.x - x, p.y - y) > 150)) { placed.push(y); G.posts.push({ x: x + rr2(-30, 30), y, r: 13 }); break; }
      }
    }
    // coins: an arc round a post, or a straight line
    if (rng() < 0.45 && G.posts.length) {
      const p = G.posts[G.posts.length - 1], side = rng() < 0.5 ? -1 : 1, R = rr2(85, 120);
      for (let k = 0; k < 5; k++) { const a = side * (Math.PI / 2) + (k - 2) * 0.35 * side + (side < 0 ? Math.PI : 0); G.coins.push({ x: p.x + Math.cos(a) * R, y: p.y + Math.sin(a) * R }); }
    } else if (rng() < 0.3) {
      const y = rr2(EDGE + 80, H - EDGE - 80);
      for (let k = 0; k < 4; k++) G.coins.push({ x: x + 40 + k * 34, y });
    }
    // saws from 250 m, moving saws from 600 m (d counts 10 m per unit)
    if (d > 25 && rng() < Math.min(0.5, 0.12 + d / 700)) {
      for (let tries = 0; tries < 8; tries++) {
        const y = rr2(EDGE + 50, H - EDGE - 50), sx = x + rr2(80, 140);
        if (G.posts.every(p => Math.hypot(p.x - sx, p.y - y) > 120)) {
          const moving = d > 60 && rng() < 0.45;
          G.saws.push({ x: sx, y, y0: y, r: rr2(20, 30), amp: moving ? rr2(60, 130) : 0, ph: rr2(0, 6.28), sp: rr2(1.2, 2.2) });
          break;
        }
      }
    }
    G.genX += rr2(175, 250) + Math.min(60, d * 0.3);
  }
  // forget things far behind
  const cut = G.camX - 200;
  G.posts = G.posts.filter(p => p.x > cut || p === G.anchor);
  G.saws = G.saws.filter(s => s.x > cut); G.coins = G.coins.filter(c => c.x > cut);
}

// ---------------------------------------------------------------------
//  Update
// ---------------------------------------------------------------------
function segHit(ax, ay, bx, by, cx, cy, dx, dy) {
  const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx); if (d === 0) return false;
  const u = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d, v = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1;
}
function pickAnchor() {
  const p = G.p; let best = null, bs = -1e9;
  for (const q of G.posts) {
    const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
    if (d > GRAB_RANGE || d < 30) continue;
    const ahead = (dx * p.vx + dy * p.vy) / d;          // prefer posts ahead of you
    const s = ahead * 120 - d;
    if (s > bs) { bs = s; best = q; }
  }
  return best;
}
function grab() {
  if (!G || G.dead || G.anchor) return;
  const a = pickAnchor(); if (!a) return;
  G.anchor = a; G.grabs++;
  const dx = a.x - G.p.x, dy = a.y - G.p.y;
  G.dir = (G.p.vx * dy - G.p.vy * dx) > 0 ? 1 : -1;       // swing the way you were already turning
  G.ropeLen = Math.hypot(dx, dy); G.swingAngle = 0;
  Sound.play('grab');
}
function release() {
  if (!G || !G.anchor) return;
  if (Math.abs(G.swingAngle) > Math.PI * 0.9) { const bonus = Math.round(Math.abs(G.swingAngle) / Math.PI * 5); G.combo += bonus; text(G.p.x, G.p.y - 30, 'HAIRPIN +' + bonus, '#ffd166'); }
  G.anchor = null; Sound.play('release');
}
function text(x, y, s, c) { G.texts.push({ x, y, s, c, t: 0 }); }
function die(kind) {
  if (G.dead || G.inv > 0) return;
  G.dead = { kind, t: 0 }; G.anchor = null; G.shake = 16;
  Sound.play(kind === 'edge' ? 'fall' : 'crash');
  for (let k = 0; k < 30; k++) G.parts.push({ x: G.p.x, y: G.p.y, vx: rand(-300, 300), vy: rand(-300, 300), t: 0, life: rand(0.4, 0.9), c: pick(['#fff', ropeCol(0), '#ffd166']) });
  setTimeout(gameOver, 900);
}
function update(dt) {
  if (!G) return;
  G.t += dt;
  for (const q of G.parts) { q.t += dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.94; q.vy *= 0.94; }
  G.parts = G.parts.filter(q => q.t < q.life);
  for (const q of G.texts) { q.t += dt; q.y -= 40 * dt; }
  G.texts = G.texts.filter(q => q.t < 1);
  G.shake *= Math.exp(-8 * dt);
  if (G.dead) { G.dead.t += dt; return; }
  if (holding && !G.anchor) grab();
  if (!holding && G.anchor) release();
  G.inv = Math.max(0, G.inv - dt);
  G.speed = Math.min(600, 300 + G.dist / 10 * 0.25);     // +0.3 px/s per metre, capped
  const p = G.p, ox = p.x, oy = p.y;
  if (G.anchor) {
    // circular swing at constant speed
    const a = G.anchor, ang = Math.atan2(p.y - a.y, p.x - a.x), w = G.speed / G.ropeLen * G.dir;
    const na = ang + w * dt;
    p.x = a.x + Math.cos(na) * G.ropeLen; p.y = a.y + Math.sin(na) * G.ropeLen;
    p.vx = -Math.sin(na) * G.dir; p.vy = Math.cos(na) * G.dir;
    G.swingAngle += w * dt;
  } else { p.x += p.vx * G.speed * dt; p.y += p.vy * G.speed * dt; }
  // camera: follows you, and creeps forward on its own
  G.camX = Math.max(G.camX + G.speed * 0.42 * dt, p.x - 420);
  G.dist = Math.max(G.dist, p.x - 220);
  // rope trail
  const tr = G.trail, lastPt = tr[tr.length - 1];
  if (!lastPt || Math.hypot(p.x - lastPt.x, p.y - lastPt.y) > 7) tr.push({ x: p.x, y: p.y, t: G.t });
  while (tr.length && G.t - tr[0].t > TRAIL_LIFE) tr.shift();
  // dangers
  if (G.inv <= 0) {
    if (p.y < EDGE || p.y > H - EDGE) return die('edge');
    if (p.x < G.camX + 8) return die('behind');
    for (const s of G.saws) { const sy = s.y0 + Math.sin(G.t * s.sp + s.ph) * s.amp; s.y = sy; if (Math.hypot(p.x - s.x, p.y - sy) < s.r + 11) return die('saw'); }
    for (let i = 1; i < tr.length; i++) {
      if (G.t - tr[i].t < TRAIL_SAFE) break;
      if (segHit(ox, oy, p.x, p.y, tr[i - 1].x, tr[i - 1].y, tr[i].x, tr[i].y)) return die('knot');
    }
  } else for (const s of G.saws) s.y = s.y0 + Math.sin(G.t * s.sp + s.ph) * s.amp;
  // coins
  for (const c of G.coins) if (!c.got && Math.hypot(p.x - c.x, p.y - c.y) < 24) {
    c.got = true; G.coinsRun++; Sound.play('coin', 0, G.coinsRun % 9);
    for (let k = 0; k < 5; k++) G.parts.push({ x: c.x, y: c.y, vx: rand(-80, 80), vy: rand(-80, 80), t: 0, life: 0.4, c: '#ffd166' });
  }
  G.coins = G.coins.filter(c => !c.got);
  generate();
}
const score = () => Math.floor(G.dist / 10) + G.combo;

// ---------------------------------------------------------------------
//  Screens
// ---------------------------------------------------------------------
function setState(s, focusLoss) {
  state = s;
  if (s === 'play') Platform.gameplayStart(); else if (!(focusLoss && Platform.kind === 'crazy')) Platform.gameplayStop();
  for (const el of document.querySelectorAll('.screen')) if (el.id !== 'adstub') el.classList.toggle('show', el.id === ({ menu: 'menu', shop: 'shop', paused: 'pause', over: 'over' }[s]));
  $('pauseBtn').style.display = s === 'play' ? 'block' : 'none';
  if (s === 'menu') $('menuInfo').innerHTML = `Best <b>${save.best}</b> &nbsp;·&nbsp; 🪙 ${save.coins}`;
  if (s === 'shop') renderShop();
  Sound.music(s === 'play' ? 2 : 1);
}
function gameOver() {
  if (!G || state !== 'play') return;
  const sc = score(), isBest = sc > save.best;
  if (isBest) { save.best = sc; Sound.play('best'); }
  save.coins += G.coinsRun; persist();
  const why = { edge: 'You ran off the roof!', knot: 'Tangled in your own rope!', saw: 'Sliced by a saw!', behind: 'Too slow, the city caught you!' }[G.dead.kind];
  $('overWhy').textContent = why;
  $('overTitle').textContent = { edge: 'FELL!', knot: 'TANGLED!', saw: 'SLICED!', behind: 'CAUGHT!' }[G.dead.kind];
  $('overStats').innerHTML = `Score <b>${sc}</b>${isBest ? ' <b style="color:#ffd166">NEW BEST!</b>' : ` · Best ${save.best}`}<br>${Math.floor(G.dist / 10)} m · 🪙 ${G.coinsRun}`;
  $('reviveBtn').style.display = G.revived ? 'none' : '';
  $('doubleBtn').style.display = G.coinsRun ? '' : 'none'; $('doubleBtn').disabled = false;
  setState('over');
}
function revive() {
  Platform.rewardedBreak().then(ok => {
    if (!ok || !G) return;
    G.revived = true; G.dead = null; G.trail = []; G.inv = 2; G.anchor = null;
    const p = G.p; p.x = Math.max(p.x, G.camX + 300); p.y = H / 2; p.vx = 1; p.vy = 0;
    G.saws = G.saws.filter(s => Math.abs(s.x - p.x) > 260);
    save.coins -= G.coinsRun; persist();     // coins are banked again at the next game over
    Sound.play('revive'); setState('play');
  });
}
function doubleCoins() {
  Platform.rewardedBreak().then(ok => {
    if (!ok || !G) return;
    save.coins += G.coinsRun; persist(); $('doubleBtn').disabled = true;
    $('overStats').innerHTML += `<br><b style="color:#ffd166">+${G.coinsRun} bonus coins!</b>`;
  });
}
function renderShop() {
  $('shopCoins').textContent = '🪙 ' + save.coins;
  const list = $('shopList'); list.innerHTML = '';
  for (const r of ROPES) {
    const own = save.owned.includes(r.id), on = save.rope === r.id;
    const d = document.createElement('button');
    d.className = 'rope' + (on ? ' on' : '');
    const sw = r.col === 'rainbow' ? 'linear-gradient(90deg,#ff5d5d,#ffd166,#5ef2b8,#6cc6ff,#b98bff)' : r.col;
    d.innerHTML = `<i style="background:${sw}"></i><b>${r.name}</b><small>${on ? 'In use' : own ? 'Use' : '🪙 ' + r.cost}</small>`;
    d.disabled = !own && save.coins < r.cost;
    d.onclick = () => { if (!own) { save.coins -= r.cost; save.owned.push(r.id); } save.rope = r.id; persist(); renderShop(); };
    list.appendChild(d);
  }
}
function pauseGame(focusLoss) { if (state === 'play') { holding = false; setState('paused', focusLoss === true); } }
function ropeCol(i) {
  const r = ROPES.find(r => r.id === save.rope) || ROPES[0];
  return r.col === 'rainbow' ? `hsl(${(i * 3 + performance.now() / 8) % 360},90%,62%)` : r.col;
}

// ---------------------------------------------------------------------
//  Drawing
// ---------------------------------------------------------------------
// rooftop tiles, drawn once and scrolled
const roof = document.createElement('canvas'); roof.width = 640; roof.height = H;
{
  const c = roof.getContext('2d');
  c.fillStyle = '#2b3150'; c.fillRect(0, 0, 640, H);
  let s = 3; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 10; i++) {
    const w = 70 + rnd() * 110, h = 50 + rnd() * 90, x = 10 + rnd() * (620 - w), y = 70 + rnd() * (H - 140 - h);
    c.fillStyle = ['#2f3657', '#2d3454', '#313961'][i % 3]; c.fillRect(x, y, w, h);
    c.strokeStyle = 'rgba(0,0,0,.18)'; c.lineWidth = 2; c.strokeRect(x, y, w, h);
  }
  c.strokeStyle = 'rgba(255,255,255,.04)'; c.lineWidth = 1;
  for (let x = 0; x < 640; x += 32) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
  for (let y = 0; y < H; y += 32) { c.beginPath(); c.moveTo(0, y); c.lineTo(640, y); c.stroke(); }
  for (let i = 0; i < 4; i++) { const x = rnd() * 600, y = 100 + rnd() * (H - 200); c.fillStyle = '#434c74'; c.fillRect(x, y, 26, 26); c.fillStyle = '#20253d'; c.fillRect(x + 5, y + 5, 16, 16); }
}
function render(time) {
  ctx.setTransform(viewScale * dpr, 0, 0, viewScale * dpr, 0, 0);
  const cx = G ? G.camX : time * 60;
  // roofs (scroll), city glow in the void
  const off = -(cx % 640);
  for (let x = off; x < W; x += 640) ctx.drawImage(roof, x, 0);
  ctx.save();
  if (G && G.shake > 0.3) ctx.translate(rand(-1, 1) * G.shake, rand(-1, 1) * G.shake);
  // the void above and below
  for (const [y0, y1] of [[0, EDGE], [H - EDGE, H]]) {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    if (y0 === 0) { g.addColorStop(0, '#05060f'); g.addColorStop(1, '#141832'); } else { g.addColorStop(0, '#141832'); g.addColorStop(1, '#05060f'); }
    ctx.fillStyle = g; ctx.fillRect(0, y0, W, y1 - y0);
    for (let i = 0; i < 26; i++) { const x = ((i * 157 - cx * 0.3) % (W + 40) + W + 40) % (W + 40) - 20; circle(x, y0 + (y1 - y0) * ((i * 37) % 100) / 100, 2, ['#ffd166', '#6cc6ff', '#ff8fa3'][i % 3]); }
  }
  // hazard stripes on the roof edge
  ctx.save();
  for (const y of [EDGE, H - EDGE - 10]) {
    ctx.beginPath(); ctx.rect(0, y, W, 10); ctx.clip();
    for (let x = -40 - (cx % 40); x < W + 40; x += 40) { ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 20, y); ctx.lineTo(x + 10, y + 10); ctx.lineTo(x - 10, y + 10); ctx.fill(); }
    ctx.restore(); ctx.save();
  }
  ctx.restore();
  if (G) {
    ctx.save(); ctx.translate(-G.camX, 0);
    // trail
    const tr = G.trail;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 1; i < tr.length; i++) {
      const age = G.t - tr[i].t, a = 1 - age / TRAIL_LIFE;
      ctx.strokeStyle = ropeCol(i); ctx.globalAlpha = Math.max(0.15, a) * (age < TRAIL_SAFE ? 0.6 : 1);
      ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(tr[i - 1].x, tr[i - 1].y); ctx.lineTo(tr[i].x, tr[i].y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // coins
    for (const c of G.coins) {
      const s = Math.abs(Math.sin(time * 4 + c.x * 0.02));
      ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.ellipse(c.x, c.y, 9 * s + 2, 10, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#b07d12'; ctx.lineWidth = 2; ctx.stroke();
    }
    // posts
    const target = G.anchor || (!G.dead && pickAnchor());
    for (const q of G.posts) {
      if (q === target && !G.anchor) { ctx.strokeStyle = `rgba(255,255,255,${0.35 + 0.25 * Math.sin(time * 8)})`; ctx.lineWidth = 3; ctx.setLineDash([5, 6]); ctx.beginPath(); ctx.arc(q.x, q.y, 26, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
      circle(q.x + 3, q.y + 4, 15, 'rgba(0,0,0,.35)'); circle(q.x, q.y, 15, '#8f97b8'); circle(q.x, q.y, 9, '#d8dcef'); circle(q.x - 3, q.y - 3, 3, '#fff');
    }
    // saws
    for (const s of G.saws) {
      if (s.amp) { ctx.strokeStyle = 'rgba(255,90,90,.18)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(s.x, s.y0 - s.amp); ctx.lineTo(s.x, s.y0 + s.amp); ctx.stroke(); }
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(time * 9);
      ctx.fillStyle = '#c9ced9'; ctx.beginPath();
      for (let k = 0; k < 16; k++) { const a = k * TAU / 16, r = k % 2 ? s.r * 0.78 : s.r; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.fill(); circle(0, 0, s.r * 0.35, '#e05555'); ctx.restore();
    }
    // rope to anchor
    const p = G.p;
    if (G.anchor) { ctx.strokeStyle = ropeCol(0); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(G.anchor.x, G.anchor.y); ctx.stroke(); }
    // runner
    if (!G.dead || G.dead.t < 0.05) {
      const ang = Math.atan2(p.vy, p.vx);
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(ang); ctx.scale(1.45, 1.45);
      if (G.inv > 0 && Math.floor(time * 12) % 2) ctx.globalAlpha = 0.4;
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(3, 4, 14, 10, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = ropeCol(0); ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-6, 0); ctx.quadraticCurveTo(-18, Math.sin(time * 20) * 6, -26, Math.sin(time * 20 + 1) * 8); ctx.stroke();   // scarf
      const step = Math.sin(time * 22) * 6;
      circle(4, -7 + step * 0.3, 4, '#20253d'); circle(4, 7 - step * 0.3, 4, '#20253d');
      circle(0, 0, 10, '#f4f1ea'); circle(3, 0, 7, '#20253d'); circle(5, -2, 1.6, '#fff'); circle(5, 2, 1.6, '#fff');
      ctx.restore();
    }
    for (const q of G.parts) { ctx.globalAlpha = 1 - q.t / q.life; circle(q.x, q.y, 3, q.c); }
    ctx.globalAlpha = 1;
    for (const q of G.texts) { ctx.globalAlpha = 1 - q.t; hudText(q.s, q.x, q.y, 18, q.c, 'center', 900); }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  ctx.restore();
  if (G && !hideHud && (state === 'play' || state === 'paused')) drawHUD(time);
}
function drawHUD(time) {
  hudText(String(score()), W / 2, 34, 34, '#fff', 'center', 900);
  hudText(Math.floor(G.dist / 10) + ' m', W / 2, 64, 15, '#c3c9e8', 'center', 700);
  hudText('🪙 ' + G.coinsRun, 24, 32, 22, '#ffd166', 'left', 900);
  if (G.grabs < 2 && G.t < 12) {
    const tip = G.t < 1.5 ? 'HOLD to swing round a post · LET GO to fly' : 'Don\'t run into your own rope or off the roof!';
    ctx.font = '700 19px system-ui'; const tw = ctx.measureText(tip).width + 40;
    ctx.fillStyle = 'rgba(5,6,15,.75)'; rr(W / 2 - tw / 2, H - 112, tw, 38, 19); ctx.fill();
    hudText(tip, W / 2, H - 93, 19, '#fff', 'center', 700);
  }
}

// ---------------------------------------------------------------------
//  Input: one button (mouse, touch or Space)
// ---------------------------------------------------------------------
canvas.addEventListener('pointerdown', e => { if (state === 'play') { holding = true; try { canvas.setPointerCapture(e.pointerId); } catch (err) { } } });
canvas.addEventListener('pointerup', () => { holding = false; });
canvas.addEventListener('pointercancel', () => { holding = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  if (state === 'play' && (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'Enter')) holding = true;
  if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) { if (state === 'play') pauseGame(); else if (state === 'paused') setState('play'); }
});
window.addEventListener('keyup', e => { if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'Enter') holding = false; });
window.addEventListener('blur', () => { holding = false; });
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(true); Sound.setHidden(document.hidden); });
$('ui').addEventListener('click', e => { const b = e.target.closest('button'); if (b && b.id !== 'muteBtn') Sound.play('click'); });
setupMute();
let firstPlay = true;
$('playBtn').onclick = () => { if (firstPlay) { firstPlay = false; $('playBtn').disabled = true; Platform.commercialBreak().then(() => { $('playBtn').disabled = false; newRun(); }); } else newRun(); };
$('shopBtn').onclick = () => setState('shop');
$('shopBack').onclick = () => setState('menu');
$('pauseBtn').onclick = () => pauseGame();
$('resumeBtn').onclick = () => setState('play');
$('quitBtn').onclick = () => { G = null; setState('menu'); };
$('againBtn').onclick = () => { $('againBtn').disabled = true; Platform.commercialBreak().then(() => { $('againBtn').disabled = false; newRun(); }); };
$('menuBtn').onclick = () => { G = null; setState('menu'); };
$('reviveBtn').onclick = revive;
$('doubleBtn').onclick = doubleCoins;
const portraitMQ = window.matchMedia('(orientation: portrait) and (pointer: coarse)');
if (portraitMQ.addEventListener) portraitMQ.addEventListener('change', () => { if (portraitMQ.matches) pauseGame(); });

// ---------------------------------------------------------------------
//  Main loop
// ---------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  let dt = (now - last) / 1000; last = now; if (dt > 0.05) dt = 0.05;
  if (state === 'play') { const n = Math.ceil(dt / 0.01); for (let i = 0; i < n; i++) update(dt / n); }
  else if (G) { for (const q of G.parts) q.t += dt; }
  render(now / 1000);
  requestAnimationFrame(frame);
}
(async function boot() {
  await Platform.init();
  setState('menu');
  Platform.loadingFinished();
  requestAnimationFrame(t => { last = t; frame(t); });
  // DEBUG-START (removed from release builds by build.py)
  window.__kr = {
    get G() { return G; }, get state() { return state; }, newRun, update, save,
    set hideHud(v) { hideHud = v; },
    // store-art scene: a rope that loops round two posts, runner mid-swing
    stage() {
      newRun(5); G.saws = []; G.coins = []; G.posts = [];
      const pts = [], add = (x, y) => pts.push({ x, y });
      for (let x = 40; x <= 360; x += 8) add(x, 470 - (x - 40) * 0.25);
      const A = { x: 470, y: 300, r: 13 }, B = { x: 820, y: 430, r: 13 };
      // round A anticlockwise, then off towards B and halfway round it
      const arc = (c, r, a0, a1) => { const n = Math.ceil(Math.abs(a1 - a0) * r / 8); for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; add(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r); } };
      arc(A, 130, 2.6, -0.4);
      for (let k = 1; k <= 18; k++) add(pts[pts.length - 1].x + 13, pts[pts.length - 1].y + 6.5);
      const last = pts[pts.length - 1];
      const rB = Math.hypot(last.x - B.x, last.y - B.y), aB = Math.atan2(last.y - B.y, last.x - B.x);
      arc(B, rB, aB, aB + 2.2);
      G.trail = pts.map((q, i) => ({ x: q.x, y: q.y, t: G.t - (pts.length - i) * 0.006 }));
      const end = pts[pts.length - 1];
      G.p.x = end.x; G.p.y = end.y; const a = aB + 2.2; G.p.vx = -Math.sin(a); G.p.vy = Math.cos(a);
      G.posts = [A, B, { x: 1080, y: 230, r: 13 }, { x: 1180, y: 560, r: 13 }, { x: 260, y: 170, r: 13 }];
      G.anchor = B; G.ropeLen = rB; G.camX = 0;
      G.saws = [{ x: 1010, y: 420, y0: 420, r: 28, amp: 0, ph: 0, sp: 1 }, { x: 640, y: 150, y0: 150, r: 22, amp: 0, ph: 0, sp: 1 }];
      for (let k = 0; k < 5; k++) G.coins.push({ x: 1080 + Math.cos(1.2 + k * 0.35) * 105, y: 230 + Math.sin(1.2 + k * 0.35) * 105 });
      for (let k = 0; k < 4; k++) G.coins.push({ x: 560 + k * 36, y: 560 });
      G.coinsRun = 23; G.dist = 3120;
    },
    // a simple bot: looks ahead along its current path; grabs a post when danger is close, lets go when heading roughly right again
    bot(skill = 1) {
      if (!G || G.dead) return;
      const p = G.p, look = (0.32 + 0.25 * skill) * G.speed;
      const fx = p.x + p.vx * look, fy = p.y + p.vy * look;
      const danger = fy < EDGE + 40 || fy > H - EDGE - 40 || G.saws.some(s => Math.hypot(fx - s.x, fy - s.y) < s.r + 50) || p.vx < -0.2;
      if (G.anchor) {
        const toMid = (H / 2 - p.y) / 300, want = Math.atan2(toMid, 1), cur = Math.atan2(p.vy, p.vx);
        let d = Math.abs(cur - want); if (d > Math.PI) d = TAU - d;
        const safe = !(fy < EDGE + 40 || fy > H - EDGE - 40) && p.vx > 0.35;
        holding = !(safe && d < 0.45 * skill + 0.15);
      } else holding = danger;
    },
    sim(seconds, skill = 1) { const steps = Math.round(seconds / 0.01); for (let i = 0; i < steps && G && !G.dead; i++) { if (i % 3 === 0) this.bot(skill); update(0.01); } return G.dead ? G.dead.kind : 'alive'; },
    snap(w = 1920) {
      const vs = viewScale, d = dpr; viewScale = w / W; dpr = 1; canvas.width = w; canvas.height = Math.round(w * H / W);
      render(performance.now() / 1000); const url = canvas.toDataURL('image/png'); viewScale = vs; dpr = d; resize(); return url;
    },
  };
  // DEBUG-END
})();

})();
