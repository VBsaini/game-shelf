'use strict';
(() => {
// =====================================================================
//  Tidepool Tycoon
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
  get(k, d) { try { const v = localStorage.getItem('tidepool_tycoon_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('tidepool_tycoon_' + k, JSON.stringify(v)); } catch (e) { } },
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
  let kind = 'none', playing = false, inAd = false;
  const poki = () => window.PokiSDK;
  const cg = () => window.CrazyGames && window.CrazyGames.SDK;
  return {
    get kind() { return kind; },
    get inAd() { return inAd; },          // true while any ad is on screen: games ignore input then
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
        inAd = true;
        const done = () => { inAd = false; Sound.duck(false); res(); };
        try {
          if (kind === 'poki') poki().commercialBreak(() => Sound.duck(true)).then(done, done);
          else if (kind === 'crazy') cg().ad.requestAd('midgame', { adStarted: () => Sound.duck(true), adFinished: done, adError: done });
          else done();
        } catch (e) { done(); }
      });
    },
    rewardedBreak() {
      return new Promise(res => {
        inAd = true;
        const done = ok => { inAd = false; Sound.duck(false); res(ok); };
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
//  Tidepool Tycoon: tap the pool for plankton, fill it with creatures that
//  earn on their own, and let the tide in for pearls that make every
//  future tide richer.
// =====================================================================
const CREATURES = [
  { id: 'snail', name: 'Periwinkle', cost: 15, pps: 0.1, desc: 'Grazes the rocks' },
  { id: 'shrimp', name: 'Shrimp', cost: 100, pps: 1, desc: 'Sifts the sand' },
  { id: 'crab', name: 'Hermit Crab', cost: 1100, pps: 8, desc: 'Shell collector' },
  { id: 'star', name: 'Starfish', cost: 12000, pps: 47, desc: 'Slow but steady' },
  { id: 'urchin', name: 'Sea Urchin', cost: 130000, pps: 260, desc: 'Prickly farmer' },
  { id: 'clown', name: 'Clownfish', cost: 1.4e6, pps: 1400, desc: 'Brings friends' },
  { id: 'octo', name: 'Octopus', cost: 2e7, pps: 7800, desc: 'Eight busy arms' },
  { id: 'seahorse', name: 'Seahorse', cost: 3.3e8, pps: 44000, desc: 'Graceful grazer' },
  { id: 'turtle', name: 'Sea Turtle', cost: 5.1e9, pps: 260000, desc: 'Wise old regular' },
  { id: 'shark', name: 'Whale Shark', cost: 7.5e10, pps: 1.6e6, desc: 'How did it fit?' },
];
const MILESTONES = [10, 25, 50, 100, 150, 200, 300, 400];     // each doubles that creature
const TIDE_UPS = [                                           // bought with plankton, lost at high tide
  { id: 'net1', name: 'Bigger Net', desc: 'Taps gather ×2', cost: 100, tap: 2 },
  { id: 'warm1', name: 'Warm Current', desc: 'All creatures +50%', cost: 2500, all: 1.5 },
  { id: 'net2', name: 'Fine Mesh', desc: 'Taps gather ×2', cost: 25000, tap: 2 },
  { id: 'kelp', name: 'Kelp Garden', desc: 'All creatures +50%', cost: 400000, all: 1.5 },
  { id: 'net3', name: 'Golden Net', desc: 'Taps also gather 5% of your per-second', cost: 2e6, tapPps: 0.05 },
  { id: 'sun', name: 'Sunny Spell', desc: 'All creatures ×2', cost: 3e7, all: 2 },
  { id: 'reef', name: 'Coral Reef', desc: 'All creatures ×2', cost: 2e9, all: 2 },
  { id: 'moon', name: 'Moon Pull', desc: 'All creatures ×2', cost: 2e11, all: 2 },
];
const PEARL_UPS = [                                          // permanent, bought with pearls
  { id: 'arm', name: 'Strong Arm', desc: 'Taps ×2 forever', base: 2, grow: 3, max: 6 },
  { id: 'nap', name: 'Long Nap', desc: '+2 h of offline earnings', base: 3, grow: 2, max: 5 },
  { id: 'start', name: 'Head Start', desc: 'Start each tide with 10 of the next creature', base: 5, grow: 2.5, max: 5 },
  { id: 'luck', name: 'Lucky Bottle', desc: 'Bottles float by more often', base: 4, grow: 2.2, max: 5 },
  { id: 'tidepow', name: 'Spring Tide', desc: '+25% pearls from each tide', base: 8, grow: 2.4, max: 6 },
];
const SAVE_KEY = 'save';
const GROWTH = 1.13;                                      // each creature costs 13% more than the last

// ---------------------------------------------------------------------
//  Economy (pure functions on the save object E)
// ---------------------------------------------------------------------
function freshTide(E) {
  E.plankton = 0; E.earnedTide = 0; E.owned = {}; E.ups = {};
  for (const c of CREATURES) E.owned[c.id] = 0;
  for (let k = 0; k < (E.pups.start || 0); k++) E.owned[CREATURES[k].id] = 10;
}
function newSave() {
  const E = { v: 1, pearls: 0, pearlsEver: 0, pups: {}, tides: 0, earnedAll: 0, taps: 0, last: Date.now(), boostUntil: 0, played: 0 };
  freshTide(E); return E;
}
const pearlUpCost = (u, lv) => Math.round(u.base * Math.pow(u.grow, lv));
function milestoneMult(n) { let m = 1; for (const t of MILESTONES) if (n >= t) m *= 2; return m; }
function nextMilestone(n) { return MILESTONES.find(t => t > n) || null; }
function globalMult(E, now) {
  let m = 1 + 0.05 * E.pearls;                               // every unspent pearl +5%
  for (const u of TIDE_UPS) if (E.ups[u.id] && u.all) m *= u.all;
  if (E.boostUntil > now) m *= 2;
  return m;
}
function creaturePps(E, c) { return c.pps * 1.5 * E.owned[c.id] * milestoneMult(E.owned[c.id]); }
function pps(E, now = Date.now()) { let s = 0; for (const c of CREATURES) s += creaturePps(E, c); return s * globalMult(E, now); }
function tapValue(E, now = Date.now()) {
  let v = 1, frac = 0;
  for (const u of TIDE_UPS) if (E.ups[u.id]) { if (u.tap) v *= u.tap; if (u.tapPps) frac += u.tapPps; }
  v *= Math.pow(2, E.pups.arm || 0);
  return v + frac * pps(E, now) + pps(E, now) * 0.01;
}
function costOf(c, owned, n = 1) {                            // n more of creature c
  const r = GROWTH; return c.cost * Math.pow(r, owned) * (Math.pow(r, n) - 1) / (r - 1);
}
function maxAffordable(E, c) {
  const r = GROWTH, base = c.cost * Math.pow(r, E.owned[c.id]);
  return Math.max(0, Math.floor(Math.log(E.plankton * (r - 1) / base + 1) / Math.log(r)));
}
const TIDE_MIN = 1e6;                                     // plankton earned in a tide before the tide can come in
// 10 pearls at 1M earned, 100 at 10B, 1000 at 100T: a fourth root, so tides never run away
function pearlsForTide(E) { if (E.earnedTide < TIDE_MIN) return 0; return Math.floor(10 * Math.pow(E.earnedTide / TIDE_MIN, 0.25) * (1 + 0.25 * (E.pups.tidepow || 0))); }
function earn(E, amt) { E.plankton += amt; E.earnedTide += amt; E.earnedAll += amt; }
function offlineCapHours(E) { return 3 + 2 * (E.pups.nap || 0); }

// ---------------------------------------------------------------------
//  Sound
// ---------------------------------------------------------------------
{
  const { tone, noise, N } = Sound;
  Sound.define({
    click: () => tone('triangle', 700, 900, 0.06, 0.12),
    tap: () => { tone('sine', rand(600, 900), rand(300, 400), 0.08, 0.08); noise(0.05, 0.04, 'bandpass', 2400, 1200, 0, 2); },
    buy: () => { tone('triangle', N(76), N(83), 0.1, 0.12); tone('sine', N(88), N(88), 0.12, 0.06, Sound.now() + 0.05); },
    deny: () => tone('sine', 160, 120, 0.1, 0.12),
    milestone: () => { const t = Sound.now(); [72, 76, 79, 84].forEach((n, i) => tone('triangle', N(n), N(n), 0.22, 0.12, t + i * 0.06)); },
    bottle: () => { const t = Sound.now(); [84, 88, 91, 96].forEach((n, i) => tone('sine', N(n), N(n), 0.2, 0.1, t + i * 0.05)); },
    tide: () => { noise(2.2, 0.25, 'lowpass', 300, 1800, 0, 0.7); noise(2.5, 0.12, 'bandpass', 600, 2400, Sound.now() + 0.6, 0.6); },
    pearl: () => { const t = Sound.now(); [79, 86, 91].forEach((n, i) => tone('sine', N(n), N(n), 0.5, 0.1, t + i * 0.09)); },
  }, (step, t) => {
    // lazy beach ukulele-ish plucks over soft pads
    const STEP = 60 / 84 / 2, bus = Sound.musBus, s = step % 16, bar = Math.floor(step / 16) % 4;
    const CH = [[60, 64, 67], [57, 60, 64], [62, 65, 69], [55, 59, 62]][bar];
    if (s === 0) for (const n of CH) tone('sine', N(n - 12), N(n - 12), STEP * 15, 0.025, t, bus);
    if ([0, 3, 4, 6, 8, 11, 12, 14].includes(s)) { const n = CH[(s * 5 + bar) % 3] + 12; tone('triangle', N(n), N(n), STEP * 1.2, 0.022, t, bus); }
    return STEP;
  });
}

// ---------------------------------------------------------------------
//  Number formatting
// ---------------------------------------------------------------------
const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
function fmt(n) {
  if (n < 1000) return n < 10 && n % 1 ? n.toFixed(1) : String(Math.floor(n));
  const e = Math.min(SUFFIX.length - 1, Math.floor(Math.log10(n) / 3));
  const v = n / Math.pow(1000, e);
  return (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.floor(v)) + SUFFIX[e];
}
function fmtTime(s) { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h} h ${m} min` : m ? `${m} min` : `${s} s`; }

// ---------------------------------------------------------------------
//  State
// ---------------------------------------------------------------------
let E = Store.get(SAVE_KEY, null);
if (!E || E.v !== 1) E = newSave();
let state = 'menu', tab = 'creatures', buyN = 1, hideHud = false;
let fish = [], parts = [], texts = [], ripples = [], bottle = null, nextBottle = 40, tideAnim = 0, saveT = 0, uiT = 0, offlineGain = 0;
function persist() { E.last = Date.now(); Store.set(SAVE_KEY, E); }

// ---------------------------------------------------------------------
//  Pool scene: creatures you can see (a few per kind, more as you own more)
// ---------------------------------------------------------------------
const POOL = { x: 30, y: 90, w: 720, h: 600 };
function inPool(x, y) {
  // an oval pool with a rocky rim
  const cx = POOL.x + POOL.w / 2, cy = POOL.y + POOL.h / 2;
  return ((x - cx) / (POOL.w / 2 - 40)) ** 2 + ((y - cy) / (POOL.h / 2 - 40)) ** 2 < 1;
}
function randInPool() { for (let k = 0; k < 50; k++) { const x = rand(POOL.x, POOL.x + POOL.w), y = rand(POOL.y, POOL.y + POOL.h); if (inPool(x, y)) return [x, y]; } return [POOL.x + POOL.w / 2, POOL.y + POOL.h / 2]; }
function shownCount(n) { return n <= 0 ? 0 : Math.min(7, 1 + Math.floor(Math.log2(n))); }
function syncFish() {
  for (const c of CREATURES) {
    const want = shownCount(E.owned[c.id]), have = fish.filter(f => f.id === c.id);
    for (let k = have.length; k < want; k++) { const [x, y] = randInPool(); fish.push({ id: c.id, x, y, tx: x, ty: y, a: rand(0, TAU), sp: rand(0.6, 1.2), ph: rand(0, TAU), born: 0 }); }
    if (have.length > want) fish = fish.filter(f => f.id !== c.id || have.indexOf(f) < want);
  }
}
const SPEED = { snail: 6, shrimp: 40, crab: 22, star: 4, urchin: 3, clown: 55, octo: 30, seahorse: 18, turtle: 26, shark: 34 };

// ---------------------------------------------------------------------
//  Actions
// ---------------------------------------------------------------------
function tapPool(x, y) {
  const v = tapValue(E); earn(E, v); E.taps++;
  texts.push({ x, y: y - 10, s: '+' + fmt(v), t: 0 });
  ripples.push({ x, y, t: 0 });
  for (let k = 0; k < 6; k++) parts.push({ x, y, vx: rand(-70, 70), vy: rand(-90, -20), t: 0, life: rand(0.5, 0.9), c: pick(['#c9fff2', '#8ff0d8', '#fff']) });
  Sound.play('tap', 0.03);
}
function buyCreature(c) {
  let n = buyN === 'max' ? maxAffordable(E, c) : buyN;
  if (n < 1) n = 1;
  const cost = costOf(c, E.owned[c.id], n);
  if (cost > E.plankton) { Sound.play('deny'); return; }
  const before = E.owned[c.id];
  E.plankton -= cost; E.owned[c.id] += n;
  if (milestoneMult(E.owned[c.id]) > milestoneMult(before)) { Sound.play('milestone'); toast(`${c.name} ×${E.owned[c.id]}: output doubled!`); }
  else Sound.play('buy');
  syncFish(); refreshPanel(true);
}
function buyTideUp(u) {
  if (E.ups[u.id] || E.plankton < u.cost) { Sound.play('deny'); return; }
  E.plankton -= u.cost; E.ups[u.id] = 1; Sound.play('milestone'); refreshPanel(true);
}
function buyPearlUp(u) {
  const lv = E.pups[u.id] || 0, cost = pearlUpCost(u, lv);
  if (lv >= u.max || E.pearls < cost) { Sound.play('deny'); return; }
  E.pearls -= cost; E.pups[u.id] = lv + 1; Sound.play('pearl'); refreshPanel(true);
}
function highTide() {
  const p = pearlsForTide(E); if (p < 1) return;
  $('tideMsg').innerHTML = `The tide washes your pool clean.<br>You keep <b>${p} pearl${p > 1 ? 's' : ''}</b> (each one +5% to everything, and they buy permanent upgrades).`;
  setState('tide');
}
function confirmTide() {
  const p = pearlsForTide(E);
  E.pearls += p; E.pearlsEver += p; E.tides++;
  freshTide(E); fish = []; syncFish(); tideAnim = 0.001; Sound.play('tide');
  persist(); setState('play'); refreshPanel(true);
  Platform.commercialBreak();
}
function toast(s) { texts.push({ x: POOL.x + POOL.w / 2, y: 150, s, t: 0, big: true }); }
function spawnBottle() {
  const fromLeft = Math.random() < 0.5, y = rand(POOL.y + 150, POOL.y + POOL.h - 150);
  bottle = { x: fromLeft ? POOL.x + 70 : POOL.x + POOL.w - 70, y, vx: fromLeft ? 45 : -45, t: 0 };
}
function catchBottle() {
  const gain = Math.max(50, pps(E) * 900);                   // 15 minutes of income
  earn(E, gain); toast('Message in a bottle: +' + fmt(gain) + ' 🫧');
  for (let k = 0; k < 24; k++) parts.push({ x: bottle.x, y: bottle.y, vx: rand(-150, 150), vy: rand(-150, 150), t: 0, life: 0.9, c: pick(['#ffd166', '#fff', '#8ff0d8']) });
  bottle = null; Sound.play('bottle');
  nextBottle = rand(70, 130) / (1 + 0.3 * (E.pups.luck || 0));
}
function adBoost() {
  Platform.rewardedBreak().then(ok => { if (!ok) return; E.boostUntil = Math.max(Date.now(), E.boostUntil) + 5 * 60 * 1000; toast('Production ×2 for 5 minutes!'); Sound.play('milestone'); persist(); });
}

// ---------------------------------------------------------------------
//  Side panel (DOM)
// ---------------------------------------------------------------------
function refreshPanel(rebuild) {
  for (const t of ['creatures', 'upgrades', 'pearls']) $('tab_' + t).classList.toggle('on', tab === t);
  $('amts').style.visibility = tab === 'creatures' ? 'visible' : 'hidden';
  const L = $('list');
  if (rebuild || L.dataset.tab !== tab) {
    L.dataset.tab = tab; L.innerHTML = '';
    if (tab === 'creatures') CREATURES.forEach((c, i) => {
      const row = document.createElement('button'); row.className = 'item'; row.id = 'c_' + c.id;
      row.innerHTML = `<canvas width="88" height="88"></canvas><div class="t"><b>${c.name}</b><small class="d"></small><small class="m"></small></div><div class="r"><span class="n"></span><span class="cost"></span></div>`;
      row.onclick = () => buyCreature(c);
      L.appendChild(row); drawIcon(row.querySelector('canvas').getContext('2d'), c.id);
    });
    if (tab === 'upgrades') TIDE_UPS.forEach(u => {
      const row = document.createElement('button'); row.className = 'item up'; row.id = 'u_' + u.id;
      row.innerHTML = `<div class="ic">⭐</div><div class="t"><b>${u.name}</b><small>${u.desc}</small></div><div class="r"><span class="cost"></span></div>`;
      row.onclick = () => buyTideUp(u); L.appendChild(row);
    });
    if (tab === 'pearls') {
      const head = document.createElement('div'); head.className = 'phead'; head.id = 'phead'; L.appendChild(head);
      PEARL_UPS.forEach(u => {
        const row = document.createElement('button'); row.className = 'item up'; row.id = 'p_' + u.id;
        row.innerHTML = `<div class="ic">🦪</div><div class="t"><b>${u.name}</b><small>${u.desc}</small><small class="m"></small></div><div class="r"><span class="cost"></span></div>`;
        row.onclick = () => buyPearlUp(u); L.appendChild(row);
      });
    }
  }
  const now = Date.now();
  if (tab === 'creatures') {
    let shown = 0;
    CREATURES.forEach((c, i) => {
      const row = $('c_' + c.id), own = E.owned[c.id];
      // show owned kinds, plus the next two you can't afford yet
      const visible = own > 0 || i <= Math.max(1, shownMax() + 1);
      row.style.display = visible ? '' : 'none'; if (!visible) return;
      const n = buyN === 'max' ? Math.max(1, maxAffordable(E, c)) : buyN, cost = costOf(c, own, n);
      row.querySelector('.n').textContent = own;
      row.querySelector('.cost').textContent = (n > 1 ? '×' + n + '  ' : '') + '🫧 ' + fmt(cost);
      const each = c.pps * 1.5 * milestoneMult(own) * globalMult(E, now);
      row.querySelector('.d').textContent = `+${fmt(each)}/s each`;
      const nm = nextMilestone(own);
      row.querySelector('.m').textContent = nm ? `×2 at ${nm}` : 'All milestones!';
      row.classList.toggle('poor', cost > E.plankton);
    });
  } else if (tab === 'upgrades') {
    TIDE_UPS.forEach(u => {
      const row = $('u_' + u.id), own = !!E.ups[u.id];
      row.querySelector('.cost').textContent = own ? '✓' : '🫧 ' + fmt(u.cost);
      row.classList.toggle('owned', own); row.classList.toggle('poor', !own && u.cost > E.plankton);
    });
  } else {
    $('phead').innerHTML = `🦪 <b>${E.pearls}</b> pearls · each unspent pearl gives +5% to everything`;
    PEARL_UPS.forEach(u => {
      const row = $('p_' + u.id), lv = E.pups[u.id] || 0, cost = pearlUpCost(u, lv);
      row.querySelector('.m').textContent = `Level ${lv} / ${u.max}`;
      row.querySelector('.cost').textContent = lv >= u.max ? 'MAX' : '🦪 ' + cost;
      row.classList.toggle('owned', lv >= u.max); row.classList.toggle('poor', lv < u.max && cost > E.pearls);
    });
  }
  const p = pearlsForTide(E);
  $('tideBtn').disabled = p < 1;
  $('tideBtn').innerHTML = p < 1 ? `🌊 High tide <small>${fmt(E.earnedTide)} / ${fmt(TIDE_MIN)} 🫧 earned this tide</small>` : `🌊 High tide <small>+${p} 🦪 pearls</small>`;
  for (const b of document.querySelectorAll('.amt')) b.classList.toggle('on', String(buyN) === b.dataset.n);
  $('boostBtn').innerHTML = E.boostUntil > now ? `⚡ ×2 for ${fmtTime((E.boostUntil - now) / 1000)}` : '🎬 ×2 for 5 min';
}
function shownMax() { let m = -1; CREATURES.forEach((c, i) => { if (E.owned[c.id] > 0 || E.plankton >= c.cost * 0.5) m = i; }); return m; }

// ---------------------------------------------------------------------
//  Drawing creatures (used in the pool and as panel icons)
// ---------------------------------------------------------------------
function drawCreature(c, id, s, t) {
  // drawn facing +x at origin, size ~ s
  const C = (x, y, r, col) => { c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); };
  if (id === 'snail') {
    C(-s * 0.1, 0, s * 0.5, '#a8794a');
    c.strokeStyle = '#6e4b29'; c.lineWidth = s * 0.08; c.beginPath();
    for (let a = 0; a < 10; a += 0.3) { const r = s * 0.45 * (1 - a / 11); c.lineTo(-s * 0.1 + Math.cos(a) * r, Math.sin(a) * r); } c.stroke();
    C(s * 0.45, 0, s * 0.16, '#cdb79a');
  } else if (id === 'shrimp') {
    c.fillStyle = '#ff9e80';
    for (let k = 0; k < 5; k++) C(-k * s * 0.18, Math.sin(t * 6 + k) * s * 0.05 + k * k * s * 0.02, s * (0.24 - k * 0.03), k % 2 ? '#ff8a65' : '#ffab91');
    c.strokeStyle = '#ff8a65'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(s * 0.2, -s * 0.05); c.quadraticCurveTo(s * 0.7, -s * 0.5, s * 0.9, -s * 0.2); c.moveTo(s * 0.2, s * 0.05); c.quadraticCurveTo(s * 0.7, s * 0.4, s * 0.9, s * 0.3); c.stroke();
    C(s * 0.18, -s * 0.08, s * 0.05, '#222');
  } else if (id === 'crab') {
    for (const k of [-1, 1]) { c.strokeStyle = '#c0392b'; c.lineWidth = s * 0.08; for (let j = 0; j < 3; j++) { c.beginPath(); c.moveTo(-s * 0.15 + j * s * 0.15, k * s * 0.2); c.lineTo(-s * 0.3 + j * s * 0.2, k * s * (0.55 + Math.sin(t * 10 + j) * 0.05)); c.stroke(); } C(s * 0.45, k * s * 0.35, s * 0.17, '#e74c3c'); }
    C(-s * 0.1, 0, s * 0.42, '#d98c45'); c.strokeStyle = '#8a5523'; c.lineWidth = s * 0.06; c.beginPath(); c.arc(-s * 0.1, 0, s * 0.25, 0, TAU * 0.8); c.stroke();
    C(s * 0.28, 0, s * 0.22, '#e74c3c'); C(s * 0.42, -s * 0.1, s * 0.05, '#222'); C(s * 0.42, s * 0.1, s * 0.05, '#222');
  } else if (id === 'star') {
    c.save(); c.rotate(t * 0.1); c.fillStyle = '#ff7f50'; c.beginPath();
    for (let k = 0; k < 10; k++) { const a = k * TAU / 10, r = k % 2 ? s * 0.22 : s * 0.6; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.fill();
    for (let k = 0; k < 5; k++) { const a = k * TAU / 5; C(Math.cos(a) * s * 0.3, Math.sin(a) * s * 0.3, s * 0.05, '#ffd0b5'); }
    c.restore();
  } else if (id === 'urchin') {
    c.strokeStyle = '#4a2c5a'; c.lineWidth = s * 0.05;
    for (let k = 0; k < 22; k++) { const a = k * TAU / 22 + Math.sin(t + k) * 0.05; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * s * 0.62, Math.sin(a) * s * 0.62); c.stroke(); }
    C(0, 0, s * 0.33, '#6c3d80'); C(-s * 0.1, -s * 0.1, s * 0.1, '#9b6bb0');
  } else if (id === 'clown') {
    c.fillStyle = '#ff8c1a'; c.beginPath(); c.ellipse(0, 0, s * 0.55, s * 0.32, 0, 0, TAU); c.fill();
    c.beginPath(); c.moveTo(-s * 0.45, 0); c.lineTo(-s * 0.8, -s * 0.28 + Math.sin(t * 12) * s * 0.06); c.lineTo(-s * 0.8, s * 0.28 + Math.sin(t * 12) * s * 0.06); c.fill();
    c.fillStyle = '#fff'; for (const x of [0.25, -0.15]) { c.fillRect(s * x - s * 0.06, -s * 0.3, s * 0.12, s * 0.6); }
    C(s * 0.38, -s * 0.06, s * 0.06, '#222');
  } else if (id === 'octo') {
    c.strokeStyle = '#9b59b6'; c.lineWidth = s * 0.12; c.lineCap = 'round';
    for (let k = 0; k < 8; k++) { const a = Math.PI * 0.55 + k * Math.PI * 0.9 / 7; c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(Math.cos(a) * s * 0.5 - s * 0.3, Math.sin(a) * s * 0.4, Math.cos(a + Math.sin(t * 4 + k) * 0.3) * s * 0.8 - s * 0.3, Math.sin(a + Math.sin(t * 4 + k) * 0.3) * s * 0.75); c.stroke(); }
    c.fillStyle = '#b07cc6'; c.beginPath(); c.ellipse(s * 0.1, 0, s * 0.45, s * 0.38, 0, 0, TAU); c.fill();
    C(s * 0.3, -s * 0.14, s * 0.08, '#fff'); C(s * 0.3, s * 0.14, s * 0.08, '#fff'); C(s * 0.33, -s * 0.14, s * 0.04, '#222'); C(s * 0.33, s * 0.14, s * 0.04, '#222');
  } else if (id === 'seahorse') {
    c.strokeStyle = '#f5b041'; c.lineWidth = s * 0.22; c.lineCap = 'round'; c.beginPath();
    c.moveTo(s * 0.3, -s * 0.4); c.quadraticCurveTo(-s * 0.1, -s * 0.1, s * 0.05, s * 0.25); c.quadraticCurveTo(s * 0.15, s * 0.55, -s * 0.15, s * 0.55); c.stroke();
    C(s * 0.35, -s * 0.45, s * 0.17, '#f5b041'); c.strokeStyle = '#f5b041'; c.lineWidth = s * 0.1; c.beginPath(); c.moveTo(s * 0.4, -s * 0.45); c.lineTo(s * 0.7, -s * 0.38); c.stroke();
    C(s * 0.36, -s * 0.5, s * 0.04, '#222');
  } else if (id === 'turtle') {
    for (const [x, y] of [[0.35, 0.4], [0.35, -0.4], [-0.35, 0.35], [-0.35, -0.35]]) { c.fillStyle = '#7dbb6b'; c.beginPath(); c.ellipse(s * x, s * y, s * 0.22, s * 0.1, Math.sin(t * 3) * 0.4 * (x > 0 ? 1 : -1), 0, TAU); c.fill(); }
    C(s * 0.62, 0, s * 0.17, '#8fcc7c');
    c.fillStyle = '#4e8a3e'; c.beginPath(); c.ellipse(0, 0, s * 0.52, s * 0.42, 0, 0, TAU); c.fill();
    c.strokeStyle = '#2f5e24'; c.lineWidth = 2; for (const [x, y] of [[0, 0], [-0.25, -0.15], [0.25, -0.15], [-0.25, 0.15], [0.25, 0.15]]) { c.beginPath(); c.arc(s * x, s * y, s * 0.12, 0, TAU); c.stroke(); }
  } else if (id === 'shark') {
    c.fillStyle = '#4a6d8c'; c.beginPath(); c.ellipse(0, 0, s * 0.75, s * 0.28, 0, 0, TAU); c.fill();
    c.beginPath(); c.moveTo(-s * 0.65, 0); c.lineTo(-s * 1.05, -s * 0.3 + Math.sin(t * 3) * s * 0.06); c.lineTo(-s * 0.95, s * 0.25 + Math.sin(t * 3) * s * 0.06); c.fill();
    c.fillStyle = '#dfe9f2'; for (let k = 0; k < 9; k++) C(-s * 0.5 + (k % 5) * s * 0.25, ((k * 37) % 3 - 1) * s * 0.1, s * 0.03, '#dfe9f2');
    c.fillStyle = '#3b5a75'; c.fillRect(s * 0.55, -s * 0.05, s * 0.18, s * 0.1);
  }
}
function drawIcon(c, id) {
  c.clearRect(0, 0, 88, 88); c.save(); c.translate(44, 44);
  c.fillStyle = 'rgba(255,255,255,.08)'; c.beginPath(); c.arc(0, 0, 40, 0, TAU); c.fill();
  drawCreature(c, id, id === 'shark' ? 30 : 34, 0.5); c.restore();
}

// ---------------------------------------------------------------------
//  Pool rendering
// ---------------------------------------------------------------------
const poolBg = document.createElement('canvas'); poolBg.width = W; poolBg.height = H;
{
  const b = poolBg.getContext('2d');
  // sand beach
  const g = b.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#f2dcab'); g.addColorStop(1, '#e3c48a'); b.fillStyle = g; b.fillRect(0, 0, W, H);
  let s = 11; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 900; i++) { b.fillStyle = `rgba(150,110,60,${rnd() * 0.18})`; b.fillRect(rnd() * W, rnd() * H, 2, 2); }
  const cx = POOL.x + POOL.w / 2, cy = POOL.y + POOL.h / 2;
  // rocky rim
  for (let i = 0; i < 70; i++) {
    const a = i / 70 * TAU, rx = POOL.w / 2 - 25 + rnd() * 20, ry = POOL.h / 2 - 25 + rnd() * 20, r = 26 + rnd() * 26;
    const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
    b.fillStyle = ['#7d746b', '#8d847a', '#6f675f'][i % 3]; b.beginPath(); b.ellipse(x, y, r, r * 0.8, a, 0, TAU); b.fill();
    b.fillStyle = 'rgba(255,255,255,.12)'; b.beginPath(); b.ellipse(x - r * 0.2, y - r * 0.25, r * 0.5, r * 0.3, a, 0, TAU); b.fill();
  }
  // water
  b.save(); b.beginPath(); b.ellipse(cx, cy, POOL.w / 2 - 40, POOL.h / 2 - 40, 0, 0, TAU); b.clip();
  const wg = b.createRadialGradient(cx, cy - 60, 40, cx, cy, POOL.w / 2); wg.addColorStop(0, '#5fd3c8'); wg.addColorStop(1, '#1f8a96'); b.fillStyle = wg; b.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) { b.fillStyle = `rgba(240,220,170,${0.15 + rnd() * 0.2})`; b.beginPath(); b.ellipse(POOL.x + rnd() * POOL.w, POOL.y + rnd() * POOL.h, 10 + rnd() * 30, 6 + rnd() * 16, rnd() * 3, 0, TAU); b.fill(); }
  for (let i = 0; i < 14; i++) { const x = POOL.x + 60 + rnd() * (POOL.w - 120), y = POOL.y + 60 + rnd() * (POOL.h - 120); b.fillStyle = 'rgba(80,90,85,.55)'; b.beginPath(); b.ellipse(x, y, 14 + rnd() * 16, 10 + rnd() * 12, rnd() * 3, 0, TAU); b.fill(); }
  b.restore();
}
function render(time) {
  ctx.setTransform(viewScale * dpr, 0, 0, viewScale * dpr, 0, 0);
  ctx.drawImage(poolBg, 0, 0);
  const cx = POOL.x + POOL.w / 2, cy = POOL.y + POOL.h / 2;
  ctx.save(); ctx.beginPath(); ctx.ellipse(cx, cy, POOL.w / 2 - 40, POOL.h / 2 - 40, 0, 0, TAU); ctx.clip();
  // seaweed
  for (let k = 0; k < 9; k++) {
    const x = POOL.x + 110 + k * 66, y = POOL.y + POOL.h - 90 - (k % 3) * 40;
    ctx.strokeStyle = k % 2 ? 'rgba(60,140,70,.8)' : 'rgba(90,170,80,.8)'; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y);
    for (let j = 1; j <= 5; j++) ctx.lineTo(x + Math.sin(time * 1.5 + k + j * 0.7) * 8 * j / 5, y - j * 16);
    ctx.stroke();
  }
  // creatures
  for (const f of fish) {
    ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.a);
    ctx.globalAlpha = Math.min(1, f.born * 2);
    drawCreature(ctx, f.id, f.id === 'shark' ? 70 : f.id === 'turtle' ? 40 : 26, time * f.sp + f.ph);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  // caustics shimmer
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 7; k++) {
    const x = cx + Math.sin(time * 0.3 + k * 1.7) * 260, y = cy + Math.cos(time * 0.23 + k * 2.3) * 200;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 120); g.addColorStop(0, 'rgba(255,255,255,.07)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(x - 120, y - 120, 240, 240);
  }
  ctx.globalCompositeOperation = 'source-over';
  for (const r of ripples) { ctx.strokeStyle = `rgba(255,255,255,${0.7 * (1 - r.t)})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(r.x, r.y, 10 + r.t * 50, 6 + r.t * 30, 0, 0, TAU); ctx.stroke(); }
  // bottle
  if (bottle) {
    ctx.save(); ctx.translate(bottle.x, bottle.y + Math.sin(time * 2) * 4); ctx.rotate(Math.sin(time * 1.5) * 0.3);
    ctx.fillStyle = 'rgba(255,209,102,.35)'; ctx.beginPath(); ctx.arc(0, 0, 34 + Math.sin(time * 5) * 4, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(170,230,210,.85)'; rr(-20, -9, 32, 18, 7); ctx.fill(); ctx.fillRect(10, -4, 12, 8);
    ctx.fillStyle = '#8d6e63'; ctx.fillRect(21, -4, 5, 8); ctx.fillStyle = '#fff8e1'; ctx.fillRect(-12, -5, 16, 10);
    ctx.restore();
  }
  // tide wave sweeping across
  if (tideAnim > 0) {
    const x = POOL.x - 200 + tideAnim * (POOL.w + 400);
    const g = ctx.createLinearGradient(x - 300, 0, x + 60, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.8, 'rgba(220,250,255,.75)'); g.addColorStop(1, 'rgba(255,255,255,.95)');
    ctx.fillStyle = g; ctx.fillRect(x - 300, 0, 360, H);
  }
  ctx.restore();
  for (const p of parts) { ctx.globalAlpha = 1 - p.t / p.life; circle(p.x, p.y, 3, p.c); }
  ctx.globalAlpha = 1;
  for (const t of texts) { ctx.globalAlpha = Math.min(1, 2.2 - t.t * (t.big ? 0.8 : 2)); hudText(t.s, t.x, t.y, t.big ? 24 : 20, t.big ? '#fff6d5' : '#fff', 'center', 900, 'rgba(10,60,70,.7)'); }
  ctx.globalAlpha = 1;
  if (!hideHud && state !== 'menu') drawHUD(time);
}
function drawHUD(time) {
  const now = Date.now();
  ctx.fillStyle = 'rgba(12,58,66,.72)'; rr(30, 14, 720, 66, 14); ctx.fill();
  hudText('🫧 ' + fmt(E.plankton), 52, 40, 30, '#fff', 'left', 900, null);
  hudText(fmt(pps(E, now)) + ' per second' + (E.boostUntil > now ? '  ⚡×2' : ''), 54, 66, 15, '#bff3ea', 'left', 700, null);
  hudText('🦪 ' + E.pearls, 730, 40, 22, '#fff', 'right', 900, null);
  hudText('Tide ' + (E.tides + 1), 730, 66, 14, '#bff3ea', 'right', 700, null);
  if (E.taps < 12 && state === 'play') hudText('Tap the pool to gather plankton!', POOL.x + POOL.w / 2, POOL.y + POOL.h / 2 + 4, 22, '#fff', 'center', 900, 'rgba(10,60,70,.7)');
}

// ---------------------------------------------------------------------
//  Update
// ---------------------------------------------------------------------
function update(dt) {
  const now = Date.now();
  earn(E, pps(E, now) * dt);
  E.played += dt;
  for (const f of fish) {
    f.born = Math.min(1, f.born + dt);
    const sp = SPEED[f.id] * f.sp;
    const dx = f.tx - f.x, dy = f.ty - f.y, d = Math.hypot(dx, dy);
    if (d < 10) { const [x, y] = randInPool(); f.tx = x; f.ty = y; }
    else { const want = Math.atan2(dy, dx); let da = want - f.a; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU; f.a += clamp(da, -2 * dt, 2 * dt); f.x += Math.cos(f.a) * sp * dt; f.y += Math.sin(f.a) * sp * dt; }
  }
  for (const p of parts) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt; }
  parts = parts.filter(p => p.t < p.life);
  for (const t of texts) { t.t += dt; t.y -= (t.big ? 14 : 50) * dt; }
  texts = texts.filter(t => t.t < (t.big ? 2.6 : 1.1));
  for (const r of ripples) r.t += dt * 1.6; ripples = ripples.filter(r => r.t < 1);
  if (tideAnim > 0) { tideAnim += dt / 2.2; if (tideAnim >= 1) tideAnim = 0; }
  if (bottle) { bottle.t += dt; bottle.x += bottle.vx * dt; if (bottle.t > 16) bottle = null; }
  else if (E.earnedTide > 200) { nextBottle -= dt; if (nextBottle <= 0) spawnBottle(); }
  saveT += dt; if (saveT > 5) { saveT = 0; persist(); }
  uiT += dt; if (uiT > 0.2) { uiT = 0; refreshPanel(false); }
}

// ---------------------------------------------------------------------
//  Screens
// ---------------------------------------------------------------------
function setState(s, focusLoss) {
  state = s;
  if (s === 'play') Platform.gameplayStart(); else if (!(focusLoss && Platform.kind === 'crazy')) Platform.gameplayStop();
  for (const el of document.querySelectorAll('.screen')) if (el.id !== 'adstub') el.classList.toggle('show', el.id === ({ menu: 'menu', paused: 'pause', away: 'away', tide: 'tide' }[s]));
  $('panel').style.display = s === 'menu' ? 'none' : 'flex';
  $('pauseBtn').style.display = s === 'play' ? 'block' : 'none';
  if (s === 'menu') $('menuInfo').innerHTML = E.earnedAll > 0 ? `Your pool: 🫧 ${fmt(E.plankton)} · 🦪 ${E.pearls} pearls · tide ${E.tides + 1}` : 'A sleepy rock pool is waiting for you.';
  Sound.music();
}
function enterPool() {
  // offline earnings, at half rate, capped
  const away = Math.max(0, (Date.now() - (E.last || Date.now())) / 1000);
  syncFish(); refreshPanel(true);
  if (away > 60 && E.earnedAll > 0) {
    const secs = Math.min(away, offlineCapHours(E) * 3600);
    offlineGain = pps(E, E.last) * secs * 0.5;
    if (offlineGain >= 1) {
      earn(E, offlineGain);
      $('awayMsg').innerHTML = `You were away for <b>${fmtTime(away)}</b>.<br>Your creatures gathered <b>🫧 ${fmt(offlineGain)}</b>` + (away > secs ? `<br><small>(earnings stop after ${offlineCapHours(E)} h away)</small>` : '');
      $('awayDouble').disabled = false; persist(); setState('away'); return;
    }
  }
  persist(); setState('play');
}
function pauseGame(focusLoss) { if (state === 'play') setState('paused', focusLoss === true); }

// ---------------------------------------------------------------------
//  Input
// ---------------------------------------------------------------------
canvas.addEventListener('pointerdown', e => {
  if (state !== 'play') return;
  const p = toCanvas(e);
  if (bottle && Math.hypot(p.x - bottle.x, p.y - bottle.y) < 44) { catchBottle(); return; }
  if (inPool(p.x, p.y)) tapPool(p.x, p.y);
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('keydown', e => {
  if (e.code === 'Space') { e.preventDefault(); if (state === 'play' && !e.repeat) tapPool(POOL.x + POOL.w / 2 + rand(-120, 120), POOL.y + POOL.h / 2 + rand(-80, 80)); }
  if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) { if (state === 'play') pauseGame(); else if (state === 'paused') setState('play'); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { persist(); pauseGame(true); } Sound.setHidden(document.hidden); });
window.addEventListener('pagehide', persist);
$('ui').addEventListener('click', e => { const b = e.target.closest('button'); if (b && b.id !== 'muteBtn' && !b.classList.contains('item')) Sound.play('click'); });
setupMute();
let firstPlay = true;
$('playBtn').onclick = () => { if (firstPlay) { firstPlay = false; $('playBtn').disabled = true; Platform.commercialBreak().then(() => { $('playBtn').disabled = false; enterPool(); }); } else enterPool(); };
$('pauseBtn').onclick = () => pauseGame();
$('resumeBtn').onclick = () => setState('play');
$('menuBtn').onclick = () => { persist(); setState('menu'); };
$('awayOk').onclick = () => setState('play');
$('awayDouble').onclick = () => Platform.rewardedBreak().then(ok => { if (!ok) return; earn(E, offlineGain); $('awayDouble').disabled = true; persist(); setState('play'); toast('Doubled! +' + fmt(offlineGain) + ' 🫧'); });
$('tideBtn').onclick = highTide;
$('tideYes').onclick = confirmTide;
$('tideNo').onclick = () => setState('play');
$('boostBtn').onclick = () => { if (E.boostUntil <= Date.now()) adBoost(); };
for (const t of ['creatures', 'upgrades', 'pearls']) $('tab_' + t).onclick = () => { tab = t; refreshPanel(true); };
for (const b of document.querySelectorAll('.amt')) b.onclick = () => { buyN = b.dataset.n === 'max' ? 'max' : +b.dataset.n; refreshPanel(false); };
const portraitMQ = window.matchMedia('(orientation: portrait) and (pointer: coarse)');
if (portraitMQ.addEventListener) portraitMQ.addEventListener('change', () => { if (portraitMQ.matches) pauseGame(); });

// ---------------------------------------------------------------------
//  Main loop
// ---------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  let dt = (now - last) / 1000; last = now; if (dt > 0.25) dt = 0.25;
  if (state === 'play') update(dt);
  render(now / 1000);
  requestAnimationFrame(frame);
}
(async function boot() {
  await Platform.init();
  setState('menu');
  Platform.loadingFinished();
  requestAnimationFrame(t => { last = t; frame(t); });
  // DEBUG-START (removed from release builds by build.py)
  window.__tt = {
    get E() { return E; }, set E(v) { E = v; }, newSave, pps, tapValue, pearlsForTide, CREATURES, enterPool, syncFish, refreshPanel, fmt,
    set hideHud(v) { hideHud = v; },
    // economy bot: taps `tps` times a second, buys the best value thing every second,
    // lets the tide in when the pearls would grow its total by `tideAt` (e.g. 0.5 = +50%)
    simulate(hours, tps = 3, tideAt = 1, log = false) {
      const S = newSave(), out = [];
      let t = 0, nextLog = 0; const dt = 1, start = Date.now();
      const now = () => start + t * 1000;
      while (t < hours * 3600) {
        for (let k = 0; k < tps; k++) earn(S, tapValue(S, now()) );
        earn(S, pps(S, now()) * dt);
        // spend: best payback among creatures and upgrades
        for (let loop = 0; loop < 50; loop++) {
          let best = null, bs = Infinity;
          const P = pps(S, now()) + tps * tapValue(S, now()) + 1e-9;
          for (const c of CREATURES) {
            const cost = costOf(c, S.owned[c.id], 1), before = pps(S, now());
            S.owned[c.id]++; const gain = pps(S, now()) - before; S.owned[c.id]--;
            const score = cost / Math.max(gain, 1e-9) + cost / P;
            if (score < bs) { bs = score; best = { kind: 'c', c, cost }; }
          }
          for (const u of TIDE_UPS) if (!S.ups[u.id]) {
            const before = pps(S, now()) + tps * tapValue(S, now()); S.ups[u.id] = 1; const gain = pps(S, now()) + tps * tapValue(S, now()) - before; delete S.ups[u.id];
            const score = u.cost / Math.max(gain, 1e-9) + u.cost / P;
            if (score < bs) { bs = score; best = { kind: 'u', u, cost: u.cost }; }
          }
          if (!best || best.cost > S.plankton) break;
          S.plankton -= best.cost; if (best.kind === 'c') S.owned[best.c.id]++; else S.ups[best.u.id] = 1;
        }
        // pearl shop: buy cheapest affordable
        for (const u of PEARL_UPS) { const lv = S.pups[u.id] || 0, c = pearlUpCost(u, lv); if (lv < u.max && S.pearls - c >= S.pearls * 0.5 && c <= S.pearls) { S.pearls -= c; S.pups[u.id] = lv + 1; } }
        const p = pearlsForTide(S);
        if (p >= 1 && p >= Math.max(10, S.pearls * tideAt)) { out.push(`tide ${S.tides + 1} at ${fmtTime(t)}: +${p} pearls (pps ${fmt(pps(S, now()))})`); S.pearls += p; S.pearlsEver += p; S.tides++; freshTide(S); }
        if (log && t >= nextLog) { out.push(`${fmtTime(t)}: ${fmt(S.plankton)} pps ${fmt(pps(S, now()))} best kind ${CREATURES.filter(c => S.owned[c.id]).length}`); nextLog += 600; }
        t += dt;
      }
      out.push(`end ${hours} h: tides ${S.tides}, pearls ${S.pearls}, pps ${fmt(pps(S, now()))}, kinds ${CREATURES.filter(c => S.owned[c.id]).length}`);
      return out.join('\n');
    },
    snap(w = 1920) {
      const vs = viewScale, d = dpr; viewScale = w / W; dpr = 1; canvas.width = w; canvas.height = Math.round(w * H / W);
      render(performance.now() / 1000); const url = canvas.toDataURL('image/png'); viewScale = vs; dpr = d; resize(); return url;
    },
  };
  // DEBUG-END
})();

})();
