'use strict';
(() => {
// =====================================================================
//  Steel Colosseum — top-down car arena survivor
// =====================================================================
const W = 1280, H = 720;           // logical resolution (16:9)
const TAU = Math.PI * 2;
const MAX_ENEMIES = 240;
const RUN_LENGTH = 600;            // final boss arrives at 10:00

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const lerp = (a, b, t) => a + (b - a) * t;
const wrapAngle = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const fmtTime = s => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function compact(arr) { let j = 0; for (let i = 0; i < arr.length; i++) { const o = arr[i]; if (!o.dead) arr[j++] = o; } arr.length = j; }

// ---------------------------------------------------------------------
//  Storage (wrapped: incognito / blocked storage must not crash)
// ---------------------------------------------------------------------
const Store = {
  get(k, d) { try { const v = localStorage.getItem('steelcol_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('steelcol_' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
};

// ---------------------------------------------------------------------
//  Sound: everything is synthesized with WebAudio (no audio files).
//  The audio context starts on the first click/tap/key (browser rule).
// ---------------------------------------------------------------------
const Sound = (() => {
  let ac = null, master, sfxBus, musBus, musLevel, noiseBuf;
  let crowdG, crowdF, skidG, engO, engG, engF;
  let muted = Store.get('muted', false), ducked = false, hidden = false;
  const lastPlay = {};
  let music = { on: false, step: 0, next: 0, timer: null, mode: 0 };

  function init() {
    if (ac) { if (ac.state === 'suspended' && !hidden) ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try { ac = new AC(); } catch (e) { ac = null; return; }
    master = ac.createGain(); master.connect(ac.destination);
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
    comp.connect(master);
    sfxBus = ac.createGain(); sfxBus.gain.value = 0.6; sfxBus.connect(comp);
    const mf = ac.createBiquadFilter(); mf.type = 'lowpass'; mf.frequency.value = 2600; mf.connect(comp);
    musLevel = ac.createGain(); musLevel.gain.value = 0.32; musLevel.connect(mf);
    musBus = ac.createGain(); musBus.connect(musLevel);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // looping beds: crowd murmur, tyre squeal, engine hum
    const loopNoise = (type, f, q) => {
      const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
      const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = ac.createGain(); g.gain.value = 0;
      s.connect(fl); fl.connect(g); g.connect(sfxBus); s.start();
      return [g, fl];
    };
    [crowdG, crowdF] = loopNoise('bandpass', 650, 0.7);
    [skidG] = loopNoise('bandpass', 2300, 6);
    engO = ac.createOscillator(); engO.type = 'sawtooth'; engO.frequency.value = 50;
    engF = ac.createBiquadFilter(); engF.type = 'lowpass'; engF.frequency.value = 300;
    engG = ac.createGain(); engG.gain.value = 0;
    engO.connect(engF); engF.connect(engG); engG.connect(sfxBus); engO.start();
    applyVolume();
    if (music.on) startMusic();
  }
  function applyVolume() { if (master) master.gain.setTargetAtTime(muted || ducked ? 0 : 1, ac.currentTime, 0.03); }
  const now = () => ac.currentTime;
  function tone(type, f0, f1, dur, vol, at, dest) {
    const t = at || now(), o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || sfxBus); o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(dur, vol, type, f0, f1, at, q, dest) {
    const t = at || now(), s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; f.type = type; f.Q.value = q || 1;
    f.frequency.setValueAtTime(f0, t); if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || sfxBus); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.03);
  }
  const N = n => 440 * Math.pow(2, (n - 69) / 12);   // midi note -> Hz
  const SFX = {
    click: () => tone('triangle', 700, 900, 0.06, 0.12),
    shoot: () => { tone('square', 820 + Math.random() * 120, 260, 0.05, 0.05); noise(0.04, 0.05, 'highpass', 2500, 2500); },
    rocket: () => noise(0.32, 0.12, 'bandpass', 500, 2200, 0, 2.5),
    boom: () => { noise(0.55, 0.45, 'lowpass', 1600, 90); tone('sine', 110, 38, 0.45, 0.45); },
    zap: () => { tone('sawtooth', 1500, 180, 0.13, 0.08); noise(0.11, 0.1, 'highpass', 3200, 5000); },
    kill: () => { noise(0.1, 0.16, 'bandpass', 1300, 420, 0, 1.6); tone('square', 240, 90, 0.07, 0.04); },
    ram: () => { tone('sine', 150, 45, 0.24, 0.6); noise(0.16, 0.3, 'lowpass', 1000, 180); },
    hurt: () => { tone('sawtooth', 190, 70, 0.26, 0.2); noise(0.2, 0.2, 'lowpass', 700, 150); },
    xp: (k) => { const f = N(84 + Math.min(k, 12)); tone('sine', f, f * 1.5, 0.07, 0.06); },
    coin: () => { tone('square', 988, 988, 0.06, 0.05); tone('square', 1319, 1319, 0.14, 0.05, now() + 0.06); },
    pickup: () => { tone('triangle', 520, 1040, 0.16, 0.16); tone('triangle', 780, 1560, 0.16, 0.08, now() + 0.06); },
    level: () => [72, 76, 79, 84].forEach((n, i) => tone('triangle', N(n), N(n), 0.2, 0.16, now() + i * 0.07)),
    nitro: () => noise(0.6, 0.22, 'bandpass', 400, 3000, 0, 1.2),
    near: () => tone('sine', 1800, 900, 0.16, 0.06),
    arrow: () => noise(0.09, 0.06, 'highpass', 1800, 4200),
    trap: () => { noise(0.1, 0.25, 'highpass', 1800, 3500); tone('square', 650, 180, 0.08, 0.06); },
    stomp: () => { tone('sine', 85, 28, 0.65, 0.8); noise(0.6, 0.4, 'lowpass', 500, 60); },
    gate: () => { const t = now(); tone('sawtooth', N(57), N(57), 0.28, 0.12, t); tone('sawtooth', N(62), N(62), 0.55, 0.12, t + 0.26); tone('sawtooth', N(69), N(69), 0.55, 0.06, t + 0.26); },
    horn: () => { const t = now(); for (const [n, v] of [[45, 0.2], [52, 0.14], [57, 0.1]]) tone('sawtooth', N(n), N(n) * 0.97, 1.4, v, t); cheer(0.5); },
    cheer: () => cheer(1),
    win: () => { const t = now(); [[67, 0], [72, 0.15], [76, 0.3], [79, 0.45], [84, 0.62]].forEach(([n, d]) => tone('square', N(n), N(n), d === 0.62 ? 0.8 : 0.16, 0.08, t + d)); cheer(1.2); },
    lose: () => { const t = now(); [[64, 0], [60, 0.22], [55, 0.44]].forEach(([n, d]) => tone('triangle', N(n), N(n) * 0.98, 0.4, 0.15, t + d)); noise(0.8, 0.3, 'lowpass', 900, 80); },
  };
  function cheer(amount) {
    if (!crowdG) return;
    const t = now(), g = crowdG.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(Math.max(g.value, 0.02), t);
    g.linearRampToValueAtTime(0.06 + 0.12 * amount, t + 0.25); g.linearRampToValueAtTime(0.03, t + 2.2);
    crowdF.frequency.setTargetAtTime(900, t, 0.1); crowdF.frequency.setTargetAtTime(650, t + 1.5, 0.4);
  }

  // ---- music: simple procedural drums + bass + pad, scheduled ahead ----
  const STEP = 60 / 124 / 4;                 // 16th notes at 124 bpm
  const CHORDS = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]];  // Am F G Em
  const BASS = [0, 0, 12, 0, 7, 0, 12, 10];
  function schedule() {
    if (!ac || !music.on) return;
    while (music.next < now() + 0.15) {
      const s = music.step % 64, bar = Math.floor(s / 16), t = music.next, m = music.mode;
      const ch = CHORDS[bar], root = ch[0] - 12;
      if (m >= 1) {
        if (s % 16 === 0 || s % 16 === 8 || (m >= 2 && s % 16 === 10) || (s % 16 === 14 && bar === 3)) { tone('sine', 150, 42, 0.22, 0.55, t, musBus); }
        if (s % 16 === 4 || s % 16 === 12) { noise(0.14, 0.22, 'bandpass', 1800, 1200, t, 0.8, musBus); tone('triangle', 210, 160, 0.08, 0.1, t, musBus); }
        if (s % 2 === 0 || m >= 2) noise(0.035, s % 4 === 2 ? 0.07 : 0.035, 'highpass', 7500, 7500, t, 1, musBus);
        if (s % 2 === 0) { const n = root + BASS[(s / 2) % 8] - 12; tone('sawtooth', N(n), N(n), STEP * 1.7, m >= 2 ? 0.13 : 0.1, t, musBus); }
        if (m >= 2 && s % 4 === 2) { const n = ch[(s / 4 | 0) % 3] + 12; tone('square', N(n), N(n), STEP * 1.2, 0.035, t, musBus); }
      } else if (s % 16 === 0) { tone('sine', 120, 40, 0.3, 0.35, t, musBus); }
      if (s % 16 === 0) for (const n of ch) tone('triangle', N(n), N(n), STEP * 15, m >= 1 ? 0.035 : 0.05, t, musBus);
      music.step++; music.next += STEP;
    }
  }
  function startMusic() {
    music.on = true;
    if (!ac) return;
    if (!music.timer) { music.next = now() + 0.05; music.timer = setInterval(schedule, 40); }
  }

  return {
    init,
    play(name, gap, arg) {
      if (!ac || muted || ducked || hidden) return;
      const t = performance.now();
      if (gap && lastPlay[name] && t - lastPlay[name] < gap * 1000) return;
      lastPlay[name] = t;
      try { SFX[name](arg); } catch (e) { }
    },
    // called every frame: engine pitch, tyre squeal and crowd follow the game
    ambient(active, speed01, drifting, hype01) {
      if (!ac) return;
      const t = now();
      engG.gain.setTargetAtTime(active ? 0.05 + 0.04 * speed01 : 0, t, 0.08);
      engO.frequency.setTargetAtTime(42 + 70 * speed01, t, 0.1);
      engF.frequency.setTargetAtTime(220 + 500 * speed01, t, 0.1);
      skidG.gain.setTargetAtTime(active && drifting ? 0.05 : 0, t, 0.05);
      if (crowdG.gain.value < 0.05 || !active) crowdG.gain.setTargetAtTime(active ? 0.012 + 0.04 * hype01 : 0, t, 0.3);
    },
    music(mode) { music.mode = mode; startMusic(); },        // 0 menu, 1 fight, 2 boss
    musicLevel(v) { if (musLevel) musLevel.gain.setTargetAtTime(0.32 * v, now(), 0.15); },
    duck(on) { ducked = on; applyVolume(); },
    setHidden(h) { hidden = h; if (ac) { if (h) ac.suspend(); else ac.resume(); } },
    get muted() { return muted; },
    get debug() { return ac ? { state: ac.state, master: master.gain.value, music: music.on && !!music.timer, step: music.step, mode: music.mode } : null; },
    toggleMute() { muted = !muted; Store.set('muted', muted); applyVolume(); return muted; },
  };
})();

// ---------------------------------------------------------------------
//  Platform / ads wrapper. Works with Poki or CrazyGames SDK if present,
//  otherwise uses a visible test stub.
// ---------------------------------------------------------------------
const $ = id => document.getElementById(id);
const Platform = (() => {
  let kind = 'none', playing = false;
  const poki = () => window.PokiSDK;
  const cg = () => window.CrazyGames && window.CrazyGames.SDK;
  return {
    get kind() { return kind; },
    async init() {
      // If the SDK script exists but init fails (e.g. ad blocker), keep using it:
      // its ad calls then simply resolve without a reward, which is what portals expect.
      if (poki()) { kind = 'poki'; try { await poki().init(); } catch (e) { console.warn('Poki SDK init failed', e); } }
      else if (cg()) {
        kind = 'crazy';
        try { await cg().init(); cg().game.loadingStart(); } catch (e) { console.warn('CrazyGames SDK init failed', e); }
      }
    },
    loadingFinished() {
      try { if (kind === 'poki') poki().gameLoadingFinished(); else if (kind === 'crazy') cg().game.loadingStop(); } catch (e) { }
    },
    gameplayStart() {
      if (playing) return; playing = true;
      try { if (kind === 'poki') poki().gameplayStart(); else if (kind === 'crazy') cg().game.gameplayStart(); } catch (e) { }
    },
    gameplayStop() {
      if (!playing) return; playing = false;
      try { if (kind === 'poki') poki().gameplayStop(); else if (kind === 'crazy') cg().game.gameplayStop(); } catch (e) { }
    },
    // Game audio is muted for the whole ad (required by both portals).
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
//  Canvas & scaling
// ---------------------------------------------------------------------
const canvas = $('game'), ctx = canvas.getContext('2d'), wrap = $('wrap');
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

// ---------------------------------------------------------------------
//  Arena
// ---------------------------------------------------------------------
const ARENA = { rx: 1400, ry: 1000 };
const PILLARS = [
  { x: -560, y: -380, r: 46 }, { x: 560, y: -380, r: 46 },
  { x: -560, y: 380, r: 46 }, { x: 560, y: 380, r: 46 },
  { x: 0, y: -660, r: 46 }, { x: 0, y: 660, r: 46 },
];
const GATES = [
  { x: ARENA.rx - 70, y: 0 }, { x: -(ARENA.rx - 70), y: 0 },
  { x: 0, y: ARENA.ry - 70 }, { x: 0, y: -(ARENA.ry - 70) },
];
function ellipseK(x, y, pad) { const a = ARENA.rx - pad, b = ARENA.ry - pad; return (x * x) / (a * a) + (y * y) / (b * b); }
function keepInArena(o, r, bounce) {
  const k = ellipseK(o.x, o.y, r);
  if (k <= 1) return false;
  const s = 1 / Math.sqrt(k); o.x *= s; o.y *= s;
  if (bounce !== undefined && o.vx !== undefined) {
    const a = ARENA.rx - r, b = ARENA.ry - r;
    let nx = o.x / (a * a), ny = o.y / (b * b); const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    const vn = o.vx * nx + o.vy * ny;
    if (vn > 0) { o.vx -= (1 + bounce) * vn * nx; o.vy -= (1 + bounce) * vn * ny; }
  }
  return true;
}
function pushFromPillars(o, r) {
  for (const p of PILLARS) {
    const dx = o.x - p.x, dy = o.y - p.y, d = Math.hypot(dx, dy), m = r + p.r;
    if (d < m && d > 0.001) {
      const nx = dx / d, ny = dy / d; o.x = p.x + nx * m; o.y = p.y + ny * m;
      if (o.vx !== undefined) { const vn = o.vx * nx + o.vy * ny; if (vn < 0) { o.vx -= 1.5 * vn * nx; o.vy -= 1.5 * vn * ny; } }
    }
  }
}
function insidePillar(x, y) { for (const p of PILLARS) if ((x - p.x) ** 2 + (y - p.y) ** 2 < p.r * p.r) return true; return false; }

// Pre-rendered background (half resolution) --------------------------
const BG = { x0: -1750, y0: -1350, w: 3500, h: 2700, s: 0.5 };
let bgCanvas = null;
function buildBackground() {
  const c = document.createElement('canvas');
  c.width = BG.w * BG.s; c.height = BG.h * BG.s;
  const g = c.getContext('2d');
  g.scale(BG.s, BG.s); g.translate(-BG.x0, -BG.y0);
  g.fillStyle = '#3a2a1c'; g.fillRect(BG.x0, BG.y0, BG.w, BG.h);
  for (let i = 9; i >= 0; i--) {
    g.beginPath(); g.ellipse(0, 0, ARENA.rx + 60 + i * 42, ARENA.ry + 60 + i * 42, 0, 0, TAU);
    g.fillStyle = i % 2 ? '#4a3626' : '#56412d'; g.fill();
  }
  const cols = ['#e85d4a', '#f2c14e', '#4aa3e8', '#7bd389', '#f0eadc', '#c47ae8', '#ff9f43', '#e0a37a'];
  for (let i = 0; i < 6000; i++) {
    const a = Math.random() * TAU, t = rand(85, 440);
    g.globalAlpha = rand(0.55, 0.95); g.fillStyle = pick(cols);
    g.beginPath(); g.arc(Math.cos(a) * (ARENA.rx + t), Math.sin(a) * (ARENA.ry + t), rand(5, 8), 0, TAU); g.fill();
  }
  g.globalAlpha = 1;
  g.beginPath(); g.ellipse(0, 0, ARENA.rx + 32, ARENA.ry + 32, 0, 0, TAU); g.lineWidth = 64; g.strokeStyle = '#8f7a63'; g.stroke();
  g.beginPath(); g.ellipse(0, 0, ARENA.rx + 62, ARENA.ry + 62, 0, 0, TAU); g.lineWidth = 6; g.strokeStyle = '#a99178'; g.stroke();
  g.beginPath(); g.ellipse(0, 0, ARENA.rx + 3, ARENA.ry + 3, 0, 0, TAU); g.lineWidth = 8; g.strokeStyle = '#5e4c3b'; g.stroke();
  g.save();
  g.beginPath(); g.ellipse(0, 0, ARENA.rx, ARENA.ry, 0, 0, TAU); g.clip();
  const grad = g.createRadialGradient(0, 0, 100, 0, 0, ARENA.rx);
  grad.addColorStop(0, '#efd6a4'); grad.addColorStop(1, '#d4b077');
  g.fillStyle = grad; g.fillRect(-ARENA.rx, -ARENA.ry, ARENA.rx * 2, ARENA.ry * 2);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(120,85,40,.10)' : 'rgba(255,245,220,.13)';
    g.fillRect(rand(-ARENA.rx, ARENA.rx), rand(-ARENA.ry, ARENA.ry), rand(3, 10), rand(3, 10));
  }
  g.strokeStyle = 'rgba(140,100,50,.22)'; g.lineWidth = 12;
  g.beginPath(); g.arc(0, 0, 230, 0, TAU); g.stroke();
  g.beginPath(); g.arc(0, 0, 120, 0, TAU); g.stroke();
  g.restore();
  for (const gt of GATES) {
    const a = Math.atan2(gt.y, gt.x);
    const x = Math.cos(a) * (ARENA.rx + 24), y = Math.sin(a) * (ARENA.ry + 24);
    g.save(); g.translate(x, y); g.rotate(a);
    g.fillStyle = '#1c130b'; g.fillRect(-26, -72, 76, 144);
    g.strokeStyle = '#6a5440'; g.lineWidth = 7;
    for (let k = -54; k <= 54; k += 18) { g.beginPath(); g.moveTo(-26, k); g.lineTo(50, k); g.stroke(); }
    g.restore();
  }
  bgCanvas = c;
}

// ---------------------------------------------------------------------
//  Definitions
// ---------------------------------------------------------------------
const CARS = [
  { id: 'racer', name: 'Scrap Racer', color: '#e8443a', hp: 100, maxSpeed: 400, accel: 650, turn: 3.4, grip: 3.2, ram: 1.0, weapon: 'mg', cost: 0,
    desc: 'Balanced. Starts with the Repeater Gun.' },
  { id: 'bruiser', name: 'Bronze Bruiser', color: '#3d7dd8', hp: 150, maxSpeed: 350, accel: 540, turn: 3.0, grip: 4.2, ram: 1.7, weapon: 'blades', cost: 400,
    desc: 'Tough rammer. Starts with Scythe Wheels.' },
  { id: 'dart', name: 'Mercury Dart', color: '#9b4dff', hp: 75, maxSpeed: 470, accel: 800, turn: 3.9, grip: 2.5, ram: 0.8, weapon: 'tesla', cost: 900,
    desc: 'Fast and slippery. Starts with the Tesla Coil.' },
];
const WEAPONS = {
  mg:      { name: 'Repeater Gun',     icon: '🔫', desc: ['Auto-fires at the nearest enemy', '+Damage, +fire rate', 'Twin barrels', '+Damage, +fire rate', 'Triple barrels'] },
  rockets: { name: 'Rocket Pods',      icon: '🚀', desc: ['Fires homing exploding rockets', 'Faster reload, +damage', '2 rockets per volley', 'Bigger blasts', '3 rockets per volley'] },
  tesla:   { name: 'Tesla Coil',       icon: '⚡', desc: ['Lightning chains between enemies', '+1 chain', '+Damage, faster', '+1 chain', '+2 chains, +damage'] },
  fire:    { name: 'Greek Fire Trail', icon: '🔥', desc: ['Leave burning oil behind you', 'Hotter flames', 'Longer-lasting fire', 'Hotter flames', 'Inferno trail'] },
  mines:   { name: 'Spike Mines',      icon: '💣', desc: ['Drop mines that blast enemies', 'Faster drops', '+Damage, bigger blast', 'Faster drops', 'Huge blasts'] },
  blades:  { name: 'Scythe Wheels',    icon: '🌀', desc: ['Blades orbit your car', '+Damage', '3 blades', '+Damage, faster spin', '4 blades'] },
};
const WS = {
  mg:      { dmg: [6, 7, 8, 9, 11], rate: [5, 6, 6.5, 7, 8], barrels: [1, 1, 2, 2, 3] },
  rockets: { cd: [1.8, 1.6, 1.4, 1.2, 1.0], n: [1, 1, 2, 2, 3], dmg: [26, 30, 34, 40, 48], rad: [70, 75, 85, 95, 105] },
  tesla:   { cd: [1.3, 1.2, 1.05, 0.95, 0.8], ch: [2, 3, 3, 4, 6], dmg: [12, 14, 17, 20, 25] },
  fire:    { dur: [2, 2.4, 2.9, 3.3, 3.9], dps: [14, 18, 22, 28, 36] },
  mines:   { cd: [2.2, 1.9, 1.8, 1.5, 1.2], dmg: [40, 48, 58, 68, 85], rad: [80, 85, 95, 100, 120] },
  blades:  { n: [2, 2, 3, 3, 4], dmg: [10, 13, 15, 18, 23], spin: [4, 4, 4.5, 5.5, 6] },
};
const PASSIVES = {
  armor:     { name: 'Armor Plating',   icon: '🛡️', desc: '+25 max HP and repair 25' },
  engine:    { name: 'Tuned Engine',    icon: '⚙️', desc: '+7% top speed and acceleration' },
  magnet:    { name: 'Scrap Magnet',    icon: '🧲', desc: '+35% pickup range' },
  bumper:    { name: 'Spiked Bumper',   icon: '🦔', desc: '+35% ram damage' },
  repair:    { name: 'Repair Drone',    icon: '🔧', desc: '+0.6 HP regenerated per second' },
  overclock: { name: 'Overclock',       icon: '⏱️', desc: 'Weapons reload 8% faster' },
  nitro:     { name: 'Nitro Tank',      icon: '💨', desc: 'Automatic nitro bursts: faster, double ram damage' },
  might:     { name: "Champion's Fury", icon: '💪', desc: '+10% weapon damage' },
};
const NITRO_EVERY = [0, 7, 6, 5, 4.5, 4];
let lastPointerType = 'mouse';
const TIPS = [   // [start second, text] shown on the very first run only
  [1, () => lastPointerType === 'touch' ? 'Touch and hold where you want to drive' : 'Point the mouse where you want to drive (or use WASD)'],
  [7, 'Your weapons fire on their own. Grab the blue gems to level up'],
  [13, 'Ram enemies and drift past them to hype up the crowd!'],
  [19, 'Survive 10 minutes and beat the Colossus to win'],
];
const ETYPES = {
  automaton: { hp: 22, speed: 72, r: 16, dmg: 8, xp: 1, color: '#c98a3a', dark: '#7d521c' },
  lion:      { hp: 16, speed: 165, r: 15, dmg: 8, xp: 1, color: '#e0ad4e', dark: '#9c5a1e' },
  archer:    { hp: 20, speed: 65, r: 15, dmg: 8, xp: 2, color: '#b88a5a', dark: '#6b4524' },
  roller:    { hp: 70, speed: 55, r: 24, dmg: 15, xp: 3, color: '#9a7646', dark: '#5a4022', heavy: true },
  chariot:   { hp: 50, speed: 85, r: 20, dmg: 16, xp: 4, color: '#c0603a', dark: '#6e2f18' },
  bull:      { hp: 2200, speed: 90, r: 56, dmg: 25, xp: 60, color: '#b8732a', dark: '#6a3e12', heavy: true, boss: true, name: 'THE BRONZE BULL' },
  colossus:  { hp: 6500, speed: 100, r: 72, dmg: 30, xp: 100, color: '#d4a443', dark: '#7a5a14', heavy: true, boss: true, name: 'THE COLOSSUS' },
};

// ---------------------------------------------------------------------
//  State
// ---------------------------------------------------------------------
let state = 'menu';          // menu | play | levelup | paused | over
let run = null;
const keys = {};
const pointer = { x: W / 2, y: H / 2, active: false, mouse: false, over: false };
const cam = { x: 0, y: 0, shake: 0 };
const enemies = [], bullets = [], arrows = [], pickups = [], particles = [], effects = [],
  puddles = [], mines = [], traps = [], texts = [], skids = [];
let selectedCar = Store.get('car', 'racer');
let hideHud = false;   // only used when rendering store thumbnails

// Spatial grid for enemies ------------------------------------------
const CELL = 96, grid = new Map(), MAXR = 76;
const gkey = (cx, cy) => (cx + 500) * 1000 + (cy + 500);
function gridBuild() {
  grid.clear();
  for (const e of enemies) {
    if (e.dead) continue;
    const k = gkey(Math.floor(e.x / CELL), Math.floor(e.y / CELL));
    let c = grid.get(k); if (!c) { c = []; grid.set(k, c); } c.push(e);
  }
}
function gridQuery(x, y, r, cb) {
  const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
  const y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
  for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
    const c = grid.get(gkey(cx, cy));
    if (c) for (let i = 0; i < c.length; i++) if (!c[i].dead) cb(c[i]);
  }
}
function enemiesInRadius(x, y, r, cb) {
  gridQuery(x, y, r + MAXR, e => { const dx = e.x - x, dy = e.y - y, m = r + e.r; if (dx * dx + dy * dy < m * m) cb(e); });
}
function nearestEnemy(x, y, range, exclude) {
  let best = null, bd = range * range;
  for (const e of enemies) {
    if (e.dead || (exclude && exclude.has(e))) continue;
    const dx = e.x - x, dy = e.y - y, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

// ---------------------------------------------------------------------
//  FX helpers
// ---------------------------------------------------------------------
function addShake(n) { cam.shake = Math.min(18, cam.shake + n); }
function burst(x, y, color, n, speed = 220) {
  for (let i = 0; i < n && particles.length < 800; i++) {
    const a = Math.random() * TAU, s = rand(40, speed);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: rand(0.3, 0.7), color, size: rand(2, 5) });
  }
}
function popText(x, y, str, color = '#fff', size = 22) { texts.push({ x, y, str, color, size, t: 0, life: 0.9 }); }
function banner(text, life = 2) { if (run) run.banner = { text, t: 0, life }; }

// ---------------------------------------------------------------------
//  Run lifecycle
// ---------------------------------------------------------------------
function startRun() {
  const car = CARS.find(c => c.id === selectedCar) || CARS[0];
  for (const a of [enemies, bullets, arrows, pickups, particles, effects, puddles, mines, traps, texts, skids]) a.length = 0;
  run = {
    car, time: 0, kills: 0, coins: 0, level: 1, xp: 0, xpNeed: 5,
    hype: 0, hypeIdle: 0, gifts: 0, combo: 0, comboT: 0, spawnAcc: 0, nextWave: 40,
    bossStage: 0, boss: null, finalBoss: null, trapT: 0, revived: false, favor: 0,
    nitroT: 3, nitroOn: 0, bladeAng: 0, weapons: {}, passives: {}, banner: null,
    pendingLevels: 0, won: false, winT: 0, rerolled: false, banked: false, st: null,
    xpChain: 0, xpChainT: 0, tips: !Store.get('tipsDone', false),
    player: { x: 0, y: 300, vx: 0, vy: -60, angle: -Math.PI / 2, r: 20, hp: car.hp, maxHp: car.hp,
      iframes: 0, flash: 0, drifting: false, turret: -Math.PI / 2, aim: null, wheels: null },
  };
  run.weapons[car.weapon] = { lv: 1, cd: 0.4 };
  run.st = stats();
  cam.x = 0; cam.y = 300; cam.shake = 0;
  setState('play');
  banner('SURVIVE THE ARENA!', 2.5);
  checkOrientation();
}

function stats() {
  const c = run.car, lv = k => run.passives[k] || 0;
  const eng = 1 + 0.07 * lv('engine');
  return {
    maxSpeed: c.maxSpeed * eng, accel: c.accel * eng, turn: c.turn, grip: c.grip,
    ram: c.ram * (1 + 0.35 * lv('bumper')),
    magnet: 110 * (1 + 0.35 * lv('magnet')),
    regen: 0.3 + 0.6 * lv('repair'),
    cd: Math.pow(0.92, lv('overclock')),
    dmg: (1 + 0.10 * lv('might')) * (run.favor > 0 ? 2 : 1),
  };
}

function setState(s, focusLoss) {
  const prev = state; state = s;
  // CrazyGames: don't report a gameplay stop just because the tab lost focus
  if (s === 'play') Platform.gameplayStart(); else if (!(focusLoss && Platform.kind === 'crazy')) Platform.gameplayStop();
  Sound.music(s === 'menu' ? 0 : run && run.boss && !run.boss.dead ? 2 : 1);
  Sound.musicLevel(s === 'play' || s === 'menu' ? 1 : 0.45);
  $('pauseBtn').style.display = s === 'play' ? 'block' : 'none';
  showScreen({ menu: 'menu', levelup: 'levelup', paused: 'pause', over: 'over' }[s] || null);
  if (s === 'menu') renderGarage();
  return prev;
}
function showScreen(id) {
  for (const el of document.querySelectorAll('.screen')) if (el.id !== 'adstub') el.classList.toggle('show', el.id === id);
}

function earnedCoins() {
  return run.coins + Math.floor(run.kills / 40) + Math.floor(run.time / 30) + (run.won ? 100 : 0);
}
function bankRun() {
  if (!run || run.banked) return;
  run.banked = true;
  Store.set('coins', Store.get('coins', 0) + earnedCoins());
  if (run.time > Store.get('best', 0)) Store.set('best', Math.floor(run.time));
  if (run.won) Store.set('wins', Store.get('wins', 0) + 1);
}

function endRun(win) {
  run.won = win;
  setState('over');
  Sound.play(win ? 'win' : 'lose');
  $('overTitle').textContent = win ? 'VICTORY!' : 'DEFEATED';
  $('overStats').innerHTML =
    (win ? 'The crowd chants your name!<br>' : '') +
    `Survived <b>${fmtTime(run.time)}</b> &nbsp;·&nbsp; Level <b>${run.level}</b> &nbsp;·&nbsp; Kills <b>${run.kills}</b><br>` +
    `Coins earned: <b>🪙 ${earnedCoins()}</b>`;
  $('reviveBtn').style.display = (!win && !run.revived) ? '' : 'none';
}

function revive() {
  Platform.rewardedBreak().then(ok => {
    if (!ok || !run) return;
    const p = run.player;
    run.revived = true;
    p.hp = Math.ceil(p.maxHp * 0.6); p.iframes = 2.5;
    for (const e of enemies) if (!e.boss && (e.x - p.x) ** 2 + (e.y - p.y) ** 2 < 420 * 420) { e.dead = true; burst(e.x, e.y, e.color, 6); }
    arrows.length = 0;
    addShake(10);
    setState('play');
    Sound.play('cheer');
    banner('BACK IN THE FIGHT!', 1.8);
  });
}

function pauseGame(focusLoss) { if (state === 'play') setState('paused', focusLoss === true); }
function resumeGame() { if (state === 'paused') setState('play'); }

// ---------------------------------------------------------------------
//  Levelling & upgrades
// ---------------------------------------------------------------------
function addXp(v) {
  run.xp += v;
  while (run.xp >= run.xpNeed) {
    run.xp -= run.xpNeed; run.level++;
    run.xpNeed = Math.floor(5 + run.level * 4.5 + run.level * run.level * 0.2);
    run.pendingLevels++;
  }
  if (run.pendingLevels > 0 && state === 'play') openLevelUp();
}
function rollOptions() {
  const pool = [], ownedW = Object.keys(run.weapons).length;
  for (const k in WEAPONS) {
    const w = run.weapons[k];
    if (w) { if (w.lv < 5) pool.push({ kind: 'w', id: k, lv: w.lv + 1, weight: 3 }); }
    else if (ownedW < 5) pool.push({ kind: 'w', id: k, lv: 1, weight: run.level < 8 ? 4 : 2 });
  }
  for (const k in PASSIVES) { const lv = run.passives[k] || 0; if (lv < 5) pool.push({ kind: 'p', id: k, lv: lv + 1, weight: 2 }); }
  const out = [];
  while (out.length < 3 && pool.length) {
    let tot = 0; for (const o of pool) tot += o.weight;
    let r = Math.random() * tot, i = 0;
    for (; i < pool.length - 1; i++) { r -= pool[i].weight; if (r <= 0) break; }
    out.push(pool.splice(i, 1)[0]);
  }
  if (!out.length) out.push({ kind: 'heal' }, { kind: 'coins' });
  return out;
}
function renderCards(opts) {
  const box = $('cards'); box.innerHTML = '';
  for (const o of opts) {
    let icon, name, tag, desc;
    if (o.kind === 'w') { const d = WEAPONS[o.id]; icon = d.icon; name = d.name; tag = o.lv === 1 ? 'NEW WEAPON' : 'LEVEL ' + o.lv; desc = d.desc[o.lv - 1]; }
    else if (o.kind === 'p') { const d = PASSIVES[o.id]; icon = d.icon; name = d.name; tag = o.lv === 1 ? 'NEW UPGRADE' : 'LEVEL ' + o.lv; desc = d.desc; }
    else if (o.kind === 'heal') { icon = '🔧'; name = 'Field Repair'; tag = 'INSTANT'; desc = 'Repair 40 HP'; }
    else { icon = '🪙'; name = 'Purse of Coins'; tag = 'INSTANT'; desc = '+15 coins'; }
    const b = document.createElement('button');
    b.className = 'card';
    b.innerHTML = `<div class="ic">${icon}</div><div class="nm">${name}</div><div class="lv">${tag}</div><div class="ds">${desc}</div>`;
    b.addEventListener('click', () => chooseUpgrade(o));
    box.appendChild(b);
  }
}
function openLevelUp() {
  run.rerolled = false;
  setState('levelup');
  Sound.play('level');
  renderCards(rollOptions());
  $('rerollBtn').style.display = '';
}
function chooseUpgrade(o) {
  if (state !== 'levelup') return;
  const p = run.player;
  if (o.kind === 'w') { if (run.weapons[o.id]) run.weapons[o.id].lv = o.lv; else run.weapons[o.id] = { lv: 1, cd: 0.3 }; }
  else if (o.kind === 'p') { run.passives[o.id] = o.lv; if (o.id === 'armor') { p.maxHp += 25; p.hp += 25; } }
  else if (o.kind === 'heal') p.hp = Math.min(p.maxHp, p.hp + 40);
  else run.coins += 15;
  run.st = stats();
  run.pendingLevels--;
  if (run.pendingLevels > 0) { run.rerolled = false; $('rerollBtn').style.display = ''; renderCards(rollOptions()); }
  else setState('play');
}
function rerollUpgrades() {
  if (state !== 'levelup' || run.rerolled) return;
  Platform.rewardedBreak().then(ok => {
    if (!ok || state !== 'levelup') return;
    run.rerolled = true; $('rerollBtn').style.display = 'none';
    renderCards(rollOptions());
  });
}

// ---------------------------------------------------------------------
//  Combat
// ---------------------------------------------------------------------
function damageEnemy(e, amt, src) {
  if (e.dead) return;
  amt *= src === 'ram' ? (run.favor > 0 ? 2 : 1) : run.st.dmg;
  e.hp -= amt; e.flash = 0.07;
  if (e.hp <= 0) killEnemy(e, src);
}
function dropXp(x, y, val) {
  if (pickups.length > 380) { // merge into an existing gem to keep things fast
    for (let i = pickups.length - 1; i >= 0; i--) if (pickups[i].type === 'xp' && !pickups[i].pull) { pickups[i].val += val; return; }
  }
  pickups.push({ type: 'xp', x, y, val });
}
function killEnemy(e, src) {
  e.dead = true; run.kills++;
  const p = run.player;
  burst(e.x, e.y, e.color, e.boss ? 70 : 8, e.boss ? 400 : 220);
  if (e.boss) {
    for (let i = 0; i < 25; i++) dropXp(e.x + rand(-70, 70), e.y + rand(-70, 70), 3);
    for (let i = 0; i < 15; i++) pickups.push({ type: 'coin', x: e.x + rand(-80, 80), y: e.y + rand(-80, 80) });
    pickups.push({ type: 'heal', x: e.x, y: e.y });
    addShake(16); addHype(30);
    Sound.play('boom'); Sound.play('cheer');
    if (run.boss === e) { run.boss = null; Sound.music(1); }
    if (run.finalBoss === e) { run.finalBoss = null; run.winT = 1.8; p.iframes = 99; banner('THE COLOSSUS FALLS!', 3); }
    else banner('BOSS DEFEATED!', 2.2);
    return;
  }
  dropXp(e.x, e.y, e.xp);
  if (onScreen(e.x, e.y, 0)) Sound.play('kill', 0.045);
  if (Math.random() < 0.02) pickups.push({ type: 'coin', x: e.x + 8, y: e.y });
  addHype(0.25);
  if (src === 'ram') { addHype(3.5); popText(e.x, e.y - 10, 'RAM!', '#ffb347', 20); }
  else if (p.drifting) addHype(0.8);
  run.combo++; run.comboT = 1.6;
  if (run.combo % 15 === 0) { addHype(6); popText(p.x, p.y - 46, run.combo + ' COMBO!', '#ffd84a', 26); }
}
function explode(x, y, rad, dmg, src) {
  enemiesInRadius(x, y, rad, e => damageEnemy(e, dmg, src));
  effects.push({ kind: 'ring', x, y, r0: 10, r1: rad, t: 0, life: 0.3, color: '#ffb347' });
  burst(x, y, '#ff8c3a', 14, 260); burst(x, y, '#4a3b2c', 6, 140);
  addShake(2.5);
  if (onScreen(x, y, 0)) Sound.play('boom', 0.07);
}
function hurtPlayer(n) {
  const p = run.player;
  if (p.iframes > 0 || state !== 'play') return;
  p.hp -= n; p.iframes = 0.8; p.flash = 0.3; addShake(8);
  Sound.play('hurt');
  burst(p.x, p.y, '#ff4d4d', 10);
  if (p.hp <= 0) { p.hp = 0; burst(p.x, p.y, run.car.color, 40, 380); endRun(false); }
}
function addHype(n) {
  run.hype += n * 100 / hypeMax(); run.hypeIdle = 0;   // hype is shown as 0-100%
  if (run.hype >= 100) { run.hype = 0; run.gifts++; crowdGift(); }
}
function hypeMax() { return 100 + 60 * run.gifts; }   // each gift makes the next one harder to earn
function crowdGift() {
  banner('THE CROWD ROARS!', 2);
  addShake(5);
  Sound.play('cheer');
  const p = run.player, types = ['heal', 'bag', 'favor'];
  const base = Math.atan2(p.y / ARENA.ry, p.x / ARENA.rx);
  for (let i = 0; i < 3; i++) {
    const a = base + rand(-0.35, 0.35);
    const sx = Math.cos(a) * (ARENA.rx + 160), sy = Math.sin(a) * (ARENA.ry + 160);
    const o = { x: p.x + p.vx * 0.7 + rand(-140, 140), y: p.y + p.vy * 0.7 + rand(-140, 140) };
    keepInArena(o, 50);
    pickups.push({ type: types[i], x: sx, y: sy, fly: { sx, sy, tx: o.x, ty: o.y, t: -i * 0.15, dur: 0.9 } });
  }
}

// ---------------------------------------------------------------------
//  Spawning
// ---------------------------------------------------------------------
function spawnEnemy(type, x, y, extra) {
  const T = ETYPES[type];
  const hpMul = T.boss ? 1 : 1 + run.time / 200;
  const e = {
    type, x, y, r: T.r, hp: T.hp * hpMul, maxHp: T.hp * hpMul, speed: T.speed * rand(0.9, 1.1),
    dmg: T.dmg, xp: T.xp, color: T.color, dark: T.dark, heavy: !!T.heavy, boss: !!T.boss, name: T.name,
    kx: 0, ky: 0, flash: 0, contactCd: 0, bladeCd: 0, face: 0, state: 'chase', st: 1, stompT: 6,
    shootT: rand(1, 2.5), aim: 0, spawnT: 0.4, dead: false,
  };
  if (extra) Object.assign(e, extra);
  enemies.push(e);
  return e;
}
function pickType(t) {
  const w = [['automaton', 10], ['lion', t > 45 ? 6 : 0], ['archer', t > 100 ? 3 : 0], ['roller', t > 170 ? 3 : 0], ['chariot', t > 230 ? 2.2 : 0]];
  let tot = 0; for (const x of w) tot += x[1];
  let r = Math.random() * tot;
  for (const x of w) { r -= x[1]; if (r <= 0) return x[0]; }
  return 'automaton';
}
function offscreenPoint() {
  const p = run.player;
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * TAU, d = rand(740, 900);
    const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
    if (ellipseK(x, y, 40) <= 1 && !insidePillar(x, y)) return { x, y };
  }
  const g = pick(GATES); return { x: g.x + rand(-30, 30), y: g.y + rand(-30, 30) };
}
function spawnDirector(dt) {
  const t = run.time;
  let rate = 0.9 + t * 0.018 + Math.pow(t / 140, 2);
  if (run.finalBoss) rate *= 0.35;
  run.spawnAcc += rate * dt;
  while (run.spawnAcc >= 1) {
    run.spawnAcc -= 1;
    if (enemies.length >= MAX_ENEMIES) { run.spawnAcc = 0; break; }
    const pt = offscreenPoint(); spawnEnemy(pickType(t), pt.x, pt.y);
  }
  if (t >= run.nextWave && run.bossStage < 2) {
    run.nextWave += 50;
    const g = pick(GATES), n = Math.floor(12 + t / 18);
    for (let i = 0; i < n && enemies.length < MAX_ENEMIES + 30; i++)
      spawnEnemy(pickType(t), g.x * 0.96 + rand(-45, 45), g.y * 0.96 + rand(-45, 45), { spawnT: 0.4 + i * 0.04 });
    banner('THE GATES OPEN!', 1.8);
    Sound.play('gate');
  }
  if (run.bossStage === 0 && t >= 300) {
    run.bossStage = 1; const g = pick(GATES);
    run.boss = spawnEnemy('bull', g.x * 0.9, g.y * 0.9, { st: 3 });
    banner('THE BRONZE BULL CHARGES IN!', 3);
    Sound.play('horn'); Sound.music(2);
  }
  if (run.bossStage === 1 && t >= RUN_LENGTH) {
    run.bossStage = 2; const g = pick(GATES);
    run.boss = run.finalBoss = spawnEnemy('colossus', g.x * 0.88, g.y * 0.88, { st: 3 });
    banner('FINAL BOSS: THE COLOSSUS!', 3);
    Sound.play('horn'); Sound.music(2);
  }
}

// ---------------------------------------------------------------------
//  Update
// ---------------------------------------------------------------------
function update(dt) {
  run.time += dt;
  run.favor = Math.max(0, run.favor - dt);
  const st = run.st = stats();
  updatePlayer(dt, st);
  gridBuild();
  updateWeapons(dt, st);
  spawnDirector(dt);
  updateEnemies(dt, st);
  updateProjectiles(dt);
  updatePickups(dt, st);
  updateHazards(dt);
  updateFx(dt);
  run.hypeIdle += dt;
  if (run.hypeIdle > 3) run.hype = Math.max(0, run.hype - 4 * dt);
  run.comboT -= dt; if (run.comboT <= 0) run.combo = 0;
  run.xpChainT -= dt;
  if (run.tips && run.time > TIPS[TIPS.length - 1][0] + 6) { run.tips = false; Store.set('tipsDone', true); }
  if (run.banner) { run.banner.t += dt; if (run.banner.t > run.banner.life) run.banner = null; }
  if (run.winT > 0) { run.winT -= dt; if (run.winT <= 0) { endRun(true); return; } }
  for (const a of [enemies, bullets, arrows, pickups, puddles, mines, traps]) compact(a);
  // camera
  const p = run.player;
  const tx = p.x + p.vx * 0.25, ty = p.y + p.vy * 0.25;
  const k = Math.min(1, 5 * dt);
  cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k;
  clampCam();
}
function clampCam() {
  cam.x = clamp(cam.x, BG.x0 + W / 2, BG.x0 + BG.w - W / 2);
  cam.y = clamp(cam.y, BG.y0 + H / 2, BG.y0 + BG.h - H / 2);
}

function updatePlayer(dt, st) {
  const p = run.player;
  // --- steering target
  const kx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  const ky = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
  let want = null;
  if (kx || ky) want = Math.atan2(ky, kx);
  else if (pointer.active || (pointer.mouse && pointer.over)) {
    const wx = pointer.x - W / 2 + cam.x, wy = pointer.y - H / 2 + cam.y;
    const dx = wx - p.x, dy = wy - p.y;
    if (dx * dx + dy * dy > 34 * 34) want = Math.atan2(dy, dx);
  }
  if (want !== null) { const d = wrapAngle(want - p.angle), m = st.turn * dt; p.angle += clamp(d, -m, m); }

  // --- nitro
  const nl = run.passives.nitro || 0;
  if (nl) { run.nitroT -= dt; if (run.nitroT <= 0) { run.nitroT = NITRO_EVERY[nl]; run.nitroOn = 1.5; popText(p.x, p.y - 36, 'NITRO!', '#7fe3ff', 20); Sound.play('nitro'); } }
  run.nitroOn = Math.max(0, run.nitroOn - dt);
  const nitro = run.nitroOn > 0;

  // --- car physics: always throttling forward, lateral grip creates drift
  const fx = Math.cos(p.angle), fy = Math.sin(p.angle), rx = -fy, ry = fx;
  let vf = p.vx * fx + p.vy * fy, vl = p.vx * rx + p.vy * ry;
  vf += st.accel * (nitro ? 1.8 : 1) * dt;
  const maxS = st.maxSpeed * (nitro ? 1.6 : 1);
  if (vf > maxS) vf += (maxS - vf) * Math.min(1, 3 * dt);
  vl *= Math.exp(-st.grip * dt);
  vf *= Math.exp(-Math.abs(vl) / 900 * dt); // drifting scrubs a little speed
  p.vx = fx * vf + rx * vl; p.vy = fy * vf + ry * vl;
  p.drifting = Math.abs(vl) > 110;
  p.x += p.vx * dt; p.y += p.vy * dt;
  if (keepInArena(p, p.r, 0.35)) { const sp = Math.hypot(p.vx, p.vy); if (sp > 250) { addShake(2); burst(p.x, p.y, '#cbb08a', 3); } }
  pushFromPillars(p, p.r);

  if (st.regen) p.hp = Math.min(p.maxHp, p.hp + st.regen * dt);
  p.iframes = Math.max(0, p.iframes - dt); p.flash = Math.max(0, p.flash - dt);

  // --- skid marks
  if (p.drifting) {
    const bx = p.x - fx * 15, by = p.y - fy * 15;
    const w1 = [bx + rx * 11, by + ry * 11], w2 = [bx - rx * 11, by - ry * 11];
    if (p.wheels) {
      skids.push({ x1: p.wheels[0][0], y1: p.wheels[0][1], x2: w1[0], y2: w1[1], t: 0 });
      skids.push({ x1: p.wheels[1][0], y1: p.wheels[1][1], x2: w2[0], y2: w2[1], t: 0 });
    }
    p.wheels = [w1, w2];
    if (Math.random() < 0.4) particles.push({ x: bx, y: by, vx: rand(-20, 20), vy: rand(-20, 20), t: 0, life: 0.5, color: 'rgba(230,210,170,.7)', size: rand(4, 8), grow: true });
  } else p.wheels = null;
  if (skids.length > 800) skids.splice(0, skids.length - 800);

  if (nitro && particles.length < 800) particles.push({ x: p.x - fx * 24, y: p.y - fy * 24, vx: -fx * 120 + rand(-30, 30), vy: -fy * 120 + rand(-30, 30), t: 0, life: 0.3, color: pick(['#7fe3ff', '#ffffff', '#ffb347']), size: rand(3, 6) });

  // --- turret aim (set by weapons)
  if (p.aim !== null) p.turret += wrapAngle(p.aim - p.turret) * Math.min(1, 14 * dt);
  else p.turret += wrapAngle(p.angle - p.turret) * Math.min(1, 4 * dt);
}

function updateWeapons(dt, st) {
  const p = run.player;
  const speed = Math.hypot(p.vx, p.vy);
  const fx = Math.cos(p.angle), fy = Math.sin(p.angle);
  p.aim = null;
  for (const id in run.weapons) {
    const w = run.weapons[id], i = w.lv - 1;
    w.cd -= dt;
    if (id === 'mg') {
      const tgt = nearestEnemy(p.x, p.y, 520);
      if (!tgt) continue;
      const a = Math.atan2(tgt.y - p.y, tgt.x - p.x); p.aim = a;
      if (w.cd <= 0) {
        w.cd = st.cd / WS.mg.rate[i];
        Sound.play('shoot', 0.07);
        const n = WS.mg.barrels[i];
        for (let b = 0; b < n; b++) {
          const aa = a + (b - (n - 1) / 2) * 0.13;
          bullets.push({ kind: 'bullet', x: p.x + Math.cos(aa) * 18, y: p.y + Math.sin(aa) * 18, vx: Math.cos(aa) * 950, vy: Math.sin(aa) * 950, dmg: WS.mg.dmg[i], r: 4, life: 0.7 });
        }
      }
    } else if (id === 'rockets') {
      if (w.cd > 0) continue;
      const near = [];
      for (const e of enemies) if (!e.dead && (e.x - p.x) ** 2 + (e.y - p.y) ** 2 < 650 * 650) near.push(e);
      if (!near.length) { w.cd = 0.2; continue; }
      w.cd = WS.rockets.cd[i] * st.cd;
      Sound.play('rocket', 0.1);
      for (let k = 0; k < WS.rockets.n[i]; k++) {
        const a = p.angle + Math.PI + rand(-1.2, 1.2);
        bullets.push({ kind: 'rocket', x: p.x, y: p.y, vx: Math.cos(a) * 260, vy: Math.sin(a) * 260, target: pick(near), dmg: WS.rockets.dmg[i], rad: WS.rockets.rad[i], r: 6, life: 2.6 });
      }
    } else if (id === 'tesla') {
      if (w.cd > 0) continue;
      const first = nearestEnemy(p.x, p.y, 300);
      if (!first) { w.cd = 0.15; continue; }
      w.cd = WS.tesla.cd[i] * st.cd;
      const hit = new Set(), pts = [{ x: p.x, y: p.y }];
      let cur = first;
      for (let c = 0; c <= WS.tesla.ch[i] && cur; c++) {
        hit.add(cur); pts.push({ x: cur.x, y: cur.y });
        damageEnemy(cur, WS.tesla.dmg[i], 'tesla');
        cur = nearestEnemy(cur.x, cur.y, 210, hit);
      }
      effects.push({ kind: 'zap', pts, t: 0, life: 0.18 });
      Sound.play('zap', 0.08);
    } else if (id === 'fire') {
      if (w.cd <= 0 && speed > 80) {
        w.cd = 0.1;
        puddles.push({ x: p.x - fx * 22, y: p.y - fy * 22, r: 28, t: 0, life: WS.fire.dur[i], dps: WS.fire.dps[i], tick: 0 });
      }
    } else if (id === 'mines') {
      if (w.cd > 0) continue;
      w.cd = WS.mines.cd[i] * st.cd;
      if (mines.length < 30) mines.push({ x: p.x - fx * 26, y: p.y - fy * 26, t: 0, dmg: WS.mines.dmg[i], rad: WS.mines.rad[i] });
    } else if (id === 'blades') {
      run.bladeAng += WS.blades.spin[i] * dt;
      const n = WS.blades.n[i];
      for (let k = 0; k < n; k++) {
        const a = run.bladeAng + k * TAU / n, bx = p.x + Math.cos(a) * 64, by = p.y + Math.sin(a) * 64;
        enemiesInRadius(bx, by, 16, e => {
          if (e.bladeCd > 0) return;
          e.bladeCd = 0.35; damageEnemy(e, WS.blades.dmg[i], 'blade');
          if (!e.boss) { e.kx += Math.cos(a) * 120; e.ky += Math.sin(a) * 120; }
          burst(bx, by, '#e6edf2', 3, 120);
        });
      }
    }
  }
}

function updateEnemies(dt, st) {
  const p = run.player;
  for (const e of enemies) {
    if (e.dead) continue;
    e.flash -= dt; e.contactCd -= dt; e.bladeCd -= dt; if (e.spawnT > 0) e.spawnT -= dt;
    const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1, nx = dx / d, ny = dy / d;
    let mx = 0, my = 0, spd = e.speed;
    if (e.spawnT > 0) spd = 0;
    switch (e.type) {
      case 'archer': {
        if (d > 420) { mx = nx; my = ny; } else if (d < 300) { mx = -nx; my = -ny; } else { mx = -ny * 0.7; my = nx * 0.7; }
        e.face = Math.atan2(dy, dx);
        e.shootT -= dt;
        if (e.shootT <= 0 && d < 650 && e.spawnT <= 0) {
          e.shootT = rand(2.2, 3.1);
          arrows.push({ x: e.x + nx * 16, y: e.y + ny * 16, vx: nx * 340, vy: ny * 340, life: 2.6, dmg: 6, minD: 1e9, near: false });
          if (onScreen(e.x, e.y, 0)) Sound.play('arrow', 0.12);
        }
        break;
      }
      case 'chariot': {
        e.st -= dt;
        if (e.state === 'chase') { mx = nx; my = ny; e.face = Math.atan2(dy, dx); if (d < 520 && e.st <= 0) { e.state = 'wind'; e.st = 0.75; } }
        else if (e.state === 'wind') { e.aim = e.face = Math.atan2(dy, dx); if (e.st <= 0) { e.state = 'dash'; e.st = 1.0; } }
        else if (e.state === 'dash') { mx = Math.cos(e.aim); my = Math.sin(e.aim); spd = 520; if (e.st <= 0) { e.state = 'recover'; e.st = 0.9; } }
        else if (e.st <= 0) { e.state = 'chase'; e.st = 1.5; }
        break;
      }
      case 'bull': case 'colossus': {
        e.st -= dt; e.stompT -= dt;
        if (e.state === 'chase') {
          mx = nx; my = ny; e.face = Math.atan2(dy, dx);
          if (e.stompT <= 0 && d < 500) { e.state = 'stomp'; e.st = 0.9; e.stompT = 7; }
          else if (e.st <= 0 && d < 750) { e.state = 'wind'; e.st = 1.0; }
        } else if (e.state === 'wind') { e.aim = e.face = Math.atan2(dy, dx); if (e.st <= 0) { e.state = 'dash'; e.st = 1.2; } }
        else if (e.state === 'dash') { mx = Math.cos(e.aim); my = Math.sin(e.aim); spd = e.type === 'colossus' ? 720 : 640; if (e.st <= 0) { e.state = 'chase'; e.st = rand(3, 4.5); } }
        else if (e.state === 'stomp') {
          if (e.st <= 0) {
            const R = e.type === 'colossus' ? 290 : 230;
            effects.push({ kind: 'ring', x: e.x, y: e.y, r0: e.r, r1: R, t: 0, life: 0.4, color: '#ffcf6b' });
            if (d < R + p.r) hurtPlayer(15);
            Sound.play('stomp');
            addShake(12); burst(e.x, e.y, '#cbb08a', 30, 300);
            e.state = 'chase'; e.st = rand(2, 3);
          }
        }
        break;
      }
      default: mx = nx; my = ny; e.face = Math.atan2(dy, dx);
    }
    e.x += (mx * spd + e.kx) * dt; e.y += (my * spd + e.ky) * dt;
    const kd = Math.exp(-6 * dt); e.kx *= kd; e.ky *= kd;
    // separation from neighbours
    if (!e.boss) {
      gridQuery(e.x, e.y, e.r * 2 + MAXR, o => {
        if (o === e) return;
        const sx = e.x - o.x, sy = e.y - o.y, sd = sx * sx + sy * sy, m = e.r + o.r;
        if (sd < m * m && sd > 0.01) { const s = Math.sqrt(sd), push = (m - s) * (o.boss ? 1 : 0.5); e.x += sx / s * push; e.y += sy / s * push; }
      });
    }
    keepInArena(e, e.r);
    pushFromPillars(e, e.r);
    if (e.spawnT <= 0) enemyContact(e, p, st);
  }
}

function enemyContact(e, p, st) {
  const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy), m = e.r + p.r;
  if (d >= m || d < 0.001) return;
  const nx = dx / d, ny = dy / d, overlap = m - d;
  if (e.boss) { p.x -= nx * overlap; p.y -= ny * overlap; } else { e.x += nx * overlap; e.y += ny * overlap; }
  if (e.contactCd > 0) return;
  const closing = p.vx * nx + p.vy * ny;
  if (closing > 150) {
    const nitroMul = run.nitroOn > 0 ? 2 : 1;
    e.contactCd = 0.25;
    damageEnemy(e, closing * 0.09 * st.ram * nitroMul * (e.heavy ? 0.5 : 1), 'ram');
    if (!e.boss) { e.kx += nx * closing * 1.1; e.ky += ny * closing * 1.1; }
    const keep = e.heavy ? 0.55 : 0.88; p.vx *= keep; p.vy *= keep;
    addShake(e.heavy ? 6 : 3);
    Sound.play('ram', 0.06);
    burst(p.x + nx * p.r, p.y + ny * p.r, '#ffe08a', 5, 200);
    if (e.boss || (e.heavy && closing < 260)) hurtPlayer(Math.round(e.dmg * 0.6));
  } else {
    e.contactCd = 0.5;
    hurtPlayer(e.dmg);
    p.vx -= nx * 140; p.vy -= ny * 140;
  }
}

function updateProjectiles(dt) {
  const p = run.player;
  for (const b of bullets) {
    b.life -= dt;
    if (b.kind === 'rocket') {
      if (b.target && !b.target.dead) {
        const want = Math.atan2(b.target.y - b.y, b.target.x - b.x), cur = Math.atan2(b.vy, b.vx);
        const na = cur + clamp(wrapAngle(want - cur), -7 * dt, 7 * dt);
        const sp = Math.min(620, Math.hypot(b.vx, b.vy) + 900 * dt);
        b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
      } else b.target = nearestEnemy(b.x, b.y, 500);
      if (Math.random() < 0.7 && particles.length < 800) particles.push({ x: b.x, y: b.y, vx: rand(-15, 15), vy: rand(-15, 15), t: 0, life: 0.35, color: 'rgba(120,110,100,.6)', size: rand(3, 5), grow: true });
    }
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.life <= 0 || ellipseK(b.x, b.y, 0) > 1 || insidePillar(b.x, b.y)) {
      if (b.kind === 'rocket') explode(b.x, b.y, b.rad, b.dmg, 'rocket');
      b.dead = true; continue;
    }
    let hit = null;
    gridQuery(b.x, b.y, b.r + MAXR, e => {
      if (hit) return;
      const dx = e.x - b.x, dy = e.y - b.y, m = e.r + b.r;
      if (dx * dx + dy * dy < m * m) hit = e;
    });
    if (hit) {
      if (b.kind === 'rocket') explode(b.x, b.y, b.rad, b.dmg, 'rocket');
      else { damageEnemy(hit, b.dmg, 'bullet'); if (!hit.boss) { hit.kx += b.vx * 0.05; hit.ky += b.vy * 0.05; } burst(b.x, b.y, '#fff2b0', 2, 100); }
      b.dead = true;
    }
  }
  for (const a of arrows) {
    a.life -= dt; a.x += a.vx * dt; a.y += a.vy * dt;
    if (a.life <= 0 || ellipseK(a.x, a.y, 0) > 1 || insidePillar(a.x, a.y)) { a.dead = true; continue; }
    const d = Math.hypot(a.x - p.x, a.y - p.y);
    if (d < p.r + 4) { hurtPlayer(a.dmg); a.dead = true; continue; }
    if (d < a.minD) a.minD = d;
    else if (!a.near && a.minD < p.r + 32) { a.near = true; addHype(3); popText(p.x, p.y - 36, 'NEAR MISS!', '#9fe6ff', 18); Sound.play('near', 0.2); }
  }
}

function updatePickups(dt, st) {
  const p = run.player;
  for (const k of pickups) {
    if (k.fly) {
      const f = k.fly; f.t += dt / f.dur;
      const tt = clamp(f.t, 0, 1);
      k.x = lerp(f.sx, f.tx, tt); k.y = lerp(f.sy, f.ty, tt); k.h = Math.sin(tt * Math.PI) * 140;
      if (f.t >= 1) { k.fly = null; k.h = 0; burst(k.x, k.y, '#ffe08a', 8, 140); }
      continue;
    }
    const dx = p.x - k.x, dy = p.y - k.y, d = Math.hypot(dx, dy) || 1;
    if (k.pull || d < st.magnet) {
      k.pull = true; k.ps = (k.ps || 150) + 1400 * dt;
      const m = Math.min(d, k.ps * dt); k.x += dx / d * m; k.y += dy / d * m;
    }
    if (d < p.r + 12) {
      k.dead = true;
      if (k.type === 'xp') { run.xpChain = run.xpChainT > 0 ? run.xpChain + 1 : 0; run.xpChainT = 0.35; Sound.play('xp', 0.035, run.xpChain); addXp(k.val); }
      else if (k.type === 'coin') { run.coins++; Sound.play('coin', 0.05); }
      else Sound.play('pickup');
      if (k.type === 'heal') { p.hp = Math.min(p.maxHp, p.hp + 30); popText(p.x, p.y - 36, '+30 HP', '#7dff8a'); }
      else if (k.type === 'bag') { run.coins += 8; popText(p.x, p.y - 36, '+8 🪙', '#ffd84a'); }
      else if (k.type === 'favor') { run.favor = 8; popText(p.x, p.y - 36, "CROWD'S FAVOR: x2 DAMAGE", '#ffd84a', 20); }
    }
  }
}

function updateHazards(dt) {
  const p = run.player;
  if (run.time > 120) {
    run.trapT -= dt;
    if (run.trapT <= 0) {
      run.trapT = Math.max(2.5, 6 - (run.time - 120) / 120);
      const a = rand(0, TAU), dd = rand(0, 320);
      const o = { x: p.x + p.vx * 0.9 + Math.cos(a) * dd, y: p.y + p.vy * 0.9 + Math.sin(a) * dd };
      keepInArena(o, 70);
      if (!insidePillar(o.x, o.y)) traps.push({ x: o.x, y: o.y, r: 55, t: 0, warn: 1.3, up: 1.4, hitP: false, hit: new Set() });
    }
  }
  for (const tr of traps) {
    tr.t += dt;
    if (tr.t > tr.warn) {
      if (!tr.popped) { tr.popped = true; if (onScreen(tr.x, tr.y, 0)) Sound.play('trap', 0.05); }
      if (!tr.hitP && Math.hypot(p.x - tr.x, p.y - tr.y) < tr.r + p.r * 0.4) { tr.hitP = true; hurtPlayer(10); }
      enemiesInRadius(tr.x, tr.y, tr.r, e => { if (!tr.hit.has(e)) { tr.hit.add(e); damageEnemy(e, 35, 'trap'); } });
    }
    if (tr.t > tr.warn + tr.up) tr.dead = true;
  }
  for (const pd of puddles) {
    pd.t += dt; pd.tick -= dt;
    if (pd.tick <= 0) { pd.tick = 0.25; enemiesInRadius(pd.x, pd.y, pd.r, e => damageEnemy(e, pd.dps * 0.25, 'fire')); }
    if (pd.t > pd.life) pd.dead = true;
  }
  for (const m of mines) {
    m.t += dt;
    if (m.t > 0.5) {
      let trig = false;
      gridQuery(m.x, m.y, 24 + MAXR, e => { if (!trig && (e.x - m.x) ** 2 + (e.y - m.y) ** 2 < (24 + e.r) ** 2) trig = true; });
      if (trig || m.t > 20) { explode(m.x, m.y, m.rad, m.dmg, 'mine'); m.dead = true; }
    }
  }
}

function updateFx(dt) {
  for (const pt of particles) { pt.t += dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vx *= 0.94; pt.vy *= 0.94; if (pt.t > pt.life) pt.dead = true; }
  compact(particles);
  for (const ef of effects) { ef.t += dt; if (ef.t > ef.life) ef.dead = true; }
  compact(effects);
  for (const tx of texts) { tx.t += dt; tx.y -= 40 * dt; if (tx.t > tx.life) tx.dead = true; }
  compact(texts);
  let cut = 0;
  for (const s of skids) { s.t += dt; if (s.t > 7) cut++; }
  if (cut) skids.splice(0, cut);
  cam.shake *= Math.exp(-9 * dt); if (cam.shake < 0.1) cam.shake = 0;
}

// ---------------------------------------------------------------------
//  Rendering
// ---------------------------------------------------------------------
function rr(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
function circle(x, y, r, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
const onScreen = (x, y, r) => Math.abs(x - cam.x) < W / 2 + r + 40 && Math.abs(y - cam.y) < H / 2 + r + 40;

function drawBackground() {
  const vx0 = cam.x - W / 2 - 40, vy0 = cam.y - H / 2 - 40, vw = W + 80, vh = H + 80;
  ctx.fillStyle = '#3a2a1c'; ctx.fillRect(vx0, vy0, vw, vh);
  const x0 = Math.max(vx0, BG.x0), y0 = Math.max(vy0, BG.y0);
  const x1 = Math.min(vx0 + vw, BG.x0 + BG.w), y1 = Math.min(vy0 + vh, BG.y0 + BG.h);
  if (x1 > x0 && y1 > y0) ctx.drawImage(bgCanvas, (x0 - BG.x0) * BG.s, (y0 - BG.y0) * BG.s, (x1 - x0) * BG.s, (y1 - y0) * BG.s, x0, y0, x1 - x0, y1 - y0);
}
function drawPillars() {
  for (const p of PILLARS) {
    if (!onScreen(p.x, p.y, p.r + 20)) continue;
    circle(p.x + 8, p.y + 10, p.r, 'rgba(0,0,0,.25)');
    circle(p.x, p.y, p.r, '#b8a58c');
    circle(p.x, p.y, p.r * 0.78, '#cdbca4');
    ctx.strokeStyle = '#9a8670'; ctx.lineWidth = 3;
    for (let k = 0; k < 8; k++) { const a = k * TAU / 8; ctx.beginPath(); ctx.moveTo(p.x + Math.cos(a) * p.r * 0.35, p.y + Math.sin(a) * p.r * 0.35); ctx.lineTo(p.x + Math.cos(a) * p.r * 0.92, p.y + Math.sin(a) * p.r * 0.92); ctx.stroke(); }
    circle(p.x, p.y, p.r * 0.3, '#a8957d');
  }
}
function drawCar(p) {
  if (p.iframes > 0 && Math.floor(p.iframes * 20) % 2 === 0 && state === 'play') return;
  const col = run.car.color;
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
  ctx.fillStyle = 'rgba(0,0,0,.28)'; rr(-21, -11, 46, 30, 7); ctx.fill();
  ctx.fillStyle = '#1d1d1d';
  for (const [wx, wy] of [[-17, -17], [7, -17], [-17, 11], [7, 11]]) { rr(wx, wy, 12, 6, 2); ctx.fill(); }
  ctx.fillStyle = p.flash > 0 ? '#ffffff' : col; rr(-23, -13, 46, 26, 7); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.25)'; rr(-23, -3, 46, 6, 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.85)'; rr(3, -9, 8, 18, 2); ctx.fill();
  ctx.fillStyle = 'rgba(30,30,30,.8)'; rr(-24, -12, 4, 24, 1); ctx.fill();
  if (run.passives.bumper) { ctx.fillStyle = '#ddd'; for (let k = -9; k <= 9; k += 6) { ctx.beginPath(); ctx.moveTo(23, k - 3); ctx.lineTo(30, k); ctx.lineTo(23, k + 3); ctx.fill(); } }
  ctx.restore();
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.turret);
  ctx.fillStyle = '#2b2b2b'; rr(0, -3, 18, 6, 2); ctx.fill();
  circle(0, 0, 7.5, '#3a3a3a'); circle(0, 0, 3.5, '#666');
  ctx.restore();
  if (run.favor > 0) { ctx.strokeStyle = `rgba(255,216,74,${0.4 + 0.3 * Math.sin(run.time * 12)})`; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(p.x, p.y, 34, 0, TAU); ctx.stroke(); }
}
function drawBlades(p) {
  const w = run.weapons.blades; if (!w) return;
  const n = WS.blades.n[w.lv - 1];
  for (let k = 0; k < n; k++) {
    const a = run.bladeAng + k * TAU / n, bx = p.x + Math.cos(a) * 64, by = p.y + Math.sin(a) * 64;
    ctx.save(); ctx.translate(bx, by); ctx.rotate(a + run.time * 10);
    ctx.fillStyle = '#dfe6ec'; ctx.strokeStyle = '#7d8a94'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -15); ctx.quadraticCurveTo(12, 0, 0, 15); ctx.quadraticCurveTo(5, 0, 0, -15); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-15, 0); ctx.quadraticCurveTo(0, -12, 15, 0); ctx.quadraticCurveTo(0, -5, -15, 0); ctx.fill(); ctx.stroke();
    circle(0, 0, 4, '#555');
    ctx.restore();
  }
}
function drawEnemy(e) {
  // telegraphs
  if ((e.type === 'chariot' || e.boss) && e.state === 'wind') {
    ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.aim);
    ctx.fillStyle = `rgba(255,60,40,${0.18 + 0.15 * Math.sin(run.time * 30)})`;
    ctx.fillRect(0, -e.r * 0.8, e.boss ? 760 : 520, e.r * 1.6);
    ctx.restore();
  }
  if (e.boss && e.state === 'stomp') {
    const R = e.type === 'colossus' ? 290 : 230, f = 1 - e.st / 0.9;
    ctx.strokeStyle = 'rgba(255,80,40,.6)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(e.x, e.y, R, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(255,80,40,.15)'; ctx.beginPath(); ctx.arc(e.x, e.y, R * f, 0, TAU); ctx.fill();
  }
  const s = e.spawnT > 0 ? Math.max(0.2, 1 - e.spawnT / 0.4) : 1;
  ctx.save(); ctx.translate(e.x, e.y); if (s !== 1) { ctx.scale(s, s); ctx.globalAlpha = s; }
  ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.beginPath(); ctx.ellipse(4, 6, e.r, e.r * 0.8, 0, 0, TAU); ctx.fill();
  const fl = e.flash > 0, body = fl ? '#fff' : e.color, dark = fl ? '#fff' : e.dark, r = e.r;
  ctx.rotate(e.face);
  switch (e.type) {
    case 'automaton':
      ctx.fillStyle = dark; ctx.fillRect(-r * 0.4, -r * 1.15, r * 0.8, r * 0.45); ctx.fillRect(-r * 0.4, r * 0.7, r * 0.8, r * 0.45);
      circle(0, 0, r, body); ctx.strokeStyle = dark; ctx.lineWidth = 3; ctx.stroke();
      circle(r * 0.45, 0, r * 0.45, dark); circle(r * 0.72, 0, 2.6, '#ff5a3a');
      break;
    case 'lion':
      ctx.fillStyle = fl ? '#fff' : '#a8551c';
      ctx.beginPath(); for (let k = 0; k < 12; k++) { const a = k * TAU / 12, rr2 = k % 2 ? r * 1.0 : r * 1.3; ctx.lineTo(Math.cos(a) * rr2, Math.sin(a) * rr2); } ctx.fill();
      circle(0, 0, r * 0.82, body);
      circle(r * 0.45, -r * 0.28, 2.4, '#3a1a08'); circle(r * 0.45, r * 0.28, 2.4, '#3a1a08');
      circle(r * 0.8, 0, 3, dark);
      break;
    case 'archer':
      circle(0, 0, r, body); ctx.strokeStyle = dark; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = fl ? '#fff' : '#5a3a1a'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.arc(r * 0.2, 0, r * 1.05, -1.1, 1.1); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(r * 0.2 + Math.cos(-1.1) * r * 1.05, Math.sin(-1.1) * r * 1.05); ctx.lineTo(r * 0.2 + Math.cos(1.1) * r * 1.05, Math.sin(1.1) * r * 1.05); ctx.stroke();
      circle(r * 0.35, 0, 2.6, '#ff5a3a');
      break;
    case 'roller':
      ctx.rotate(run.time * 5);
      ctx.fillStyle = fl ? '#fff' : '#d8d2c8';
      for (let k = 0; k < 10; k++) { const a = k * TAU / 10; ctx.beginPath(); ctx.moveTo(Math.cos(a - 0.16) * r, Math.sin(a - 0.16) * r); ctx.lineTo(Math.cos(a) * r * 1.38, Math.sin(a) * r * 1.38); ctx.lineTo(Math.cos(a + 0.16) * r, Math.sin(a + 0.16) * r); ctx.fill(); }
      circle(0, 0, r, body); circle(0, 0, r * 0.55, dark); circle(0, 0, r * 0.2, body);
      break;
    case 'chariot':
      ctx.fillStyle = fl ? '#fff' : '#6b4226'; ctx.beginPath(); ctx.ellipse(r * 1.25, 0, r * 0.7, r * 0.38, 0, 0, TAU); ctx.fill();
      circle(r * 1.85, 0, r * 0.25, fl ? '#fff' : '#6b4226');
      ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(r * 0.5, 0); ctx.lineTo(r * 0.7, 0); ctx.stroke();
      ctx.fillStyle = '#2a2a2a'; ctx.fillRect(-r * 0.75, -r * 1.05, r * 0.8, r * 0.3); ctx.fillRect(-r * 0.75, r * 0.75, r * 0.8, r * 0.3);
      ctx.strokeStyle = '#d8d2c8'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-r * 0.35, -r * 1.05); ctx.lineTo(-r * 0.35, -r * 1.5); ctx.moveTo(-r * 0.35, r * 1.05); ctx.lineTo(-r * 0.35, r * 1.5); ctx.stroke();
      ctx.fillStyle = body; rr(-r, -r * 0.75, r * 1.4, r * 1.5, 5); ctx.fill();
      ctx.strokeStyle = dark; ctx.lineWidth = 3; ctx.stroke();
      circle(-r * 0.2, 0, r * 0.35, dark);
      break;
    case 'bull': case 'colossus': {
      ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(-r * 0.1, 0, r * 1.05, r * 0.82, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = dark; ctx.lineWidth = 5; ctx.stroke();
      ctx.lineWidth = 3; for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(-r * 0.6 + k * r * 0.18, -r * 0.6); ctx.lineTo(-r * 0.6 + k * r * 0.18, r * 0.6); ctx.stroke(); }
      circle(r * 0.75, 0, r * 0.48, body); ctx.strokeStyle = dark; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(r * 0.75, 0, r * 0.48, 0, TAU); ctx.stroke();
      ctx.strokeStyle = fl ? '#fff' : (e.type === 'colossus' ? '#fff3c4' : '#efe6d2'); ctx.lineWidth = r * 0.14; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(r * 0.8, -r * 0.35); ctx.quadraticCurveTo(r * 1.0, -r * 0.95, r * 1.45, -r * 0.8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(r * 0.8, r * 0.35); ctx.quadraticCurveTo(r * 1.0, r * 0.95, r * 1.45, r * 0.8); ctx.stroke();
      ctx.lineCap = 'butt';
      const glow = e.state === 'wind' || e.state === 'stomp' ? '#ffec3a' : '#ff3a2a';
      circle(r * 0.95, -r * 0.2, r * 0.09, glow); circle(r * 0.95, r * 0.2, r * 0.09, glow);
      break;
    }
  }
  ctx.restore();
}

function render(now) {
  ctx.setTransform(viewScale * dpr, 0, 0, viewScale * dpr, 0, 0);
  ctx.fillStyle = '#120d08'; ctx.fillRect(0, 0, W, H);
  const sx = cam.shake ? rand(-1, 1) * cam.shake : 0, sy = cam.shake ? rand(-1, 1) * cam.shake : 0;
  ctx.save();
  ctx.translate(Math.round(W / 2 - cam.x + sx), Math.round(H / 2 - cam.y + sy));
  drawBackground();
  if (run) {
    // skid marks
    ctx.lineWidth = 5; ctx.lineCap = 'round';
    for (const s of skids) { ctx.strokeStyle = `rgba(70,45,20,${0.32 * (1 - s.t / 7)})`; ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke(); }
    ctx.lineCap = 'butt';
    // traps
    for (const tr of traps) {
      if (!onScreen(tr.x, tr.y, tr.r)) continue;
      if (tr.t < tr.warn) {
        const f = tr.t / tr.warn;
        ctx.fillStyle = `rgba(200,40,20,${0.12 + 0.18 * Math.abs(Math.sin(tr.t * 10))})`; ctx.beginPath(); ctx.arc(tr.x, tr.y, tr.r, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(160,30,10,.7)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(tr.x, tr.y, tr.r * f, 0, TAU); ctx.stroke();
      } else {
        circle(tr.x, tr.y, tr.r, 'rgba(60,40,25,.55)');
        ctx.fillStyle = '#e8e2d6';
        for (let k = 0; k < 9; k++) { const a = k * TAU / 9, d = k % 3 === 0 ? 0 : tr.r * 0.55; const x = tr.x + Math.cos(a) * d, y = tr.y + Math.sin(a) * d; ctx.beginPath(); ctx.moveTo(x - 7, y + 6); ctx.lineTo(x, y - 12); ctx.lineTo(x + 7, y + 6); ctx.fill(); }
      }
    }
    // fire puddles
    for (const pd of puddles) {
      if (!onScreen(pd.x, pd.y, pd.r)) continue;
      const a = 1 - pd.t / pd.life;
      circle(pd.x, pd.y, pd.r, `rgba(40,25,10,${0.35 * a})`);
      circle(pd.x + rand(-3, 3), pd.y + rand(-3, 3), pd.r * (0.55 + 0.15 * Math.random()), `rgba(255,${120 + (Math.random() * 80) | 0},30,${0.55 * a})`);
    }
    // mines
    for (const m of mines) {
      if (!onScreen(m.x, m.y, 12)) continue;
      circle(m.x, m.y, 10, '#3b3b3b'); circle(m.x, m.y, 6, '#555');
      if (m.t > 0.5 && Math.floor(m.t * 4) % 2 === 0) circle(m.x, m.y, 3, '#ff3a2a');
    }
    // pickups
    for (const k of pickups) {
      if (!onScreen(k.x, k.y - (k.h || 0), 20)) continue;
      const y = k.y - (k.h || 0);
      if (k.type === 'xp') {
        const big = k.val >= 3;
        ctx.fillStyle = big ? '#ff9f43' : '#4fd1ff';
        ctx.beginPath(); const s = big ? 8 : 6; ctx.moveTo(k.x, y - s); ctx.lineTo(k.x + s * 0.75, y); ctx.lineTo(k.x, y + s); ctx.lineTo(k.x - s * 0.75, y); ctx.fill();
      } else if (k.type === 'coin') { circle(k.x, y, 7, '#f5c542'); circle(k.x, y, 4, '#ffe28a'); }
      else {
        if (k.h) circle(k.x, k.y, 10, 'rgba(0,0,0,.2)');
        circle(k.x, y, 16, 'rgba(0,0,0,.35)');
        ctx.font = '22px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(k.type === 'heal' ? '🔧' : k.type === 'bag' ? '💰' : '⭐', k.x, y + 1);
      }
    }
  }
  drawPillars();
  if (run) {
    for (const e of enemies) if (onScreen(e.x, e.y, e.r * 2)) drawEnemy(e);
    if (state !== 'over' || run.won) drawCar(run.player);
    drawBlades(run.player);
    // projectiles
    for (const b of bullets) {
      if (b.kind === 'rocket') {
        const a = Math.atan2(b.vy, b.vx);
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(a);
        ctx.fillStyle = '#ddd'; rr(-8, -3, 16, 6, 2); ctx.fill(); ctx.fillStyle = '#e8443a'; ctx.fillRect(4, -3, 4, 6);
        circle(-10, 0, 3 + Math.random() * 2, '#ffb347');
        ctx.restore();
      } else {
        ctx.strokeStyle = '#fff2b0'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * 0.018, b.y - b.vy * 0.018); ctx.stroke();
      }
    }
    ctx.strokeStyle = '#4a2e14'; ctx.lineWidth = 2.5;
    for (const a of arrows) {
      const l = 0.045; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x - a.vx * l, a.y - a.vy * l); ctx.stroke();
      circle(a.x, a.y, 2.5, '#ccc');
    }
    // effects
    for (const ef of effects) {
      const f = ef.t / ef.life;
      if (ef.kind === 'ring') {
        ctx.strokeStyle = ef.color; ctx.globalAlpha = 1 - f; ctx.lineWidth = 6 * (1 - f) + 1;
        ctx.beginPath(); ctx.arc(ef.x, ef.y, lerp(ef.r0, ef.r1, Math.sqrt(f)), 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
      } else if (ef.kind === 'zap') {
        for (const [col, lw] of [['rgba(140,200,255,.5)', 7], ['#ffffff', 2.5]]) {
          ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath();
          for (let i = 0; i < ef.pts.length - 1; i++) {
            const a = ef.pts[i], b = ef.pts[i + 1];
            if (i === 0) ctx.moveTo(a.x, a.y);
            for (let s = 1; s <= 4; s++) { const t = s / 4; ctx.lineTo(lerp(a.x, b.x, t) + (s < 4 ? rand(-9, 9) : 0), lerp(a.y, b.y, t) + (s < 4 ? rand(-9, 9) : 0)); }
          }
          ctx.stroke();
        }
      }
    }
    for (const pt of particles) {
      const f = pt.t / pt.life;
      ctx.globalAlpha = 1 - f; ctx.fillStyle = pt.color;
      const s = pt.grow ? pt.size * (1 + f * 1.5) : pt.size * (1 - f * 0.5);
      ctx.fillRect(pt.x - s / 2, pt.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const tx of texts) {
      ctx.globalAlpha = 1 - (tx.t / tx.life) ** 2;
      ctx.font = `900 ${tx.size}px system-ui`; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.7)';
      ctx.strokeText(tx.str, tx.x, tx.y); ctx.fillStyle = tx.color; ctx.fillText(tx.str, tx.x, tx.y);
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  if (run && state !== 'menu' && !hideHud) drawHUD();
}

function hudText(str, x, y, size, color = '#fff', align = 'left', weight = 800) {
  ctx.font = `${weight} ${size}px system-ui,-apple-system,"Segoe UI",sans-serif`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(3, size / 6); ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.lineJoin = 'round';
  ctx.strokeText(str, x, y); ctx.fillStyle = color; ctx.fillText(str, x, y);
}
function bar(x, y, w, h, f, fill, bg = 'rgba(0,0,0,.55)') {
  ctx.fillStyle = bg; rr(x, y, w, h, h / 2); ctx.fill();
  if (f > 0) { ctx.fillStyle = fill; rr(x, y, Math.max(h, w * clamp(f, 0, 1)), h, h / 2); ctx.fill(); }
}
function drawHUD() {
  const p = run.player;
  // XP
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, W, 10);
  ctx.fillStyle = '#4fd1ff'; ctx.fillRect(0, 0, W * clamp(run.xp / run.xpNeed, 0, 1), 10);
  // HP + level
  hudText('LV ' + run.level, 20, 34, 24, '#4fd1ff');
  bar(86, 24, 250, 20, p.hp / p.maxHp, p.hp / p.maxHp > 0.35 ? '#5ad46a' : '#ff4d4d');
  hudText(Math.ceil(p.hp) + ' / ' + p.maxHp, 211, 34, 13, '#fff', 'center', 700);
  // timer
  const remain = RUN_LENGTH - run.time;
  hudText(remain > 0 ? fmtTime(remain) : 'FINAL BOSS', W / 2, 36, 32, remain > 0 && remain < 30 ? '#ff7a5a' : '#fff', 'center', 900);
  // kills / coins
  hudText('☠ ' + run.kills, W - 128, 30, 20, '#fff', 'right');
  hudText('🪙 ' + run.coins, W - 128, 56, 20, '#f5c542', 'right');
  // boss bar
  const b = run.boss;
  if (b && !b.dead) {
    hudText(b.name, W / 2, 72, 16, '#ffcf6b', 'center', 900);
    bar(W / 2 - 260, 84, 520, 14, b.hp / b.maxHp, '#e8443a');
  }
  // hype meter
  const hw = 380, hx = W / 2 - hw / 2, hy = H - 40;
  const hot = run.hype > 80;
  hudText('CROWD HYPE', W / 2, hy - 14, 14, hot ? '#ffcf6b' : '#e9dcc6', 'center', 900);
  bar(hx, hy, hw, 16, run.hype / 100, hot ? `hsl(${20 + 15 * Math.sin(run.time * 14)},95%,55%)` : '#ff9f43');
  if (run.combo >= 5) hudText(run.combo + 'x combo', hx + hw + 14, hy + 8, 16, '#ffd84a');
  // weapons & passives
  let x = 22;
  ctx.font = '22px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const id in run.weapons) {
    ctx.fillStyle = 'rgba(0,0,0,.45)'; rr(x, H - 52, 38, 38, 8); ctx.fill();
    ctx.font = '22px system-ui'; ctx.fillStyle = '#fff'; ctx.fillText(WEAPONS[id].icon, x + 19, H - 34);
    hudText(String(run.weapons[id].lv), x + 33, H - 18, 12, '#f5c542', 'center', 900);
    x += 44;
  }
  x += 8;
  for (const id in run.passives) {
    ctx.fillStyle = 'rgba(0,0,0,.3)'; rr(x, H - 44, 28, 28, 6); ctx.fill();
    ctx.font = '16px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.fillText(PASSIVES[id].icon, x + 14, H - 30);
    x += 32;
  }
  // status
  let sy = 64;
  if (run.favor > 0) { hudText("⭐ CROWD'S FAVOR " + run.favor.toFixed(1) + 's', 20, sy, 15, '#ffd84a'); sy += 22; }
  if (run.nitroOn > 0) { hudText('💨 NITRO', 20, sy, 15, '#7fe3ff'); }
  // banner
  if (run.banner) {
    const bn = run.banner, f = bn.t / bn.life;
    const a = f < 0.15 ? f / 0.15 : f > 0.8 ? (1 - f) / 0.2 : 1;
    const sc = f < 0.15 ? 1.3 - 0.3 * (f / 0.15) : 1;
    ctx.globalAlpha = clamp(a, 0, 1);
    hudText(bn.text, W / 2, H * 0.3, 44 * sc, '#f5c542', 'center', 900);
    ctx.globalAlpha = 1;
  }
  // first-run tips
  if (run.tips) {
    let tip = null;
    for (const t of TIPS) if (run.time >= t[0] && run.time < t[0] + 6) tip = t;
    if (tip) {
      const f = (run.time - tip[0]) / 6, a = clamp(Math.min(f / 0.08, (1 - f) / 0.1), 0, 1);
      const txt = typeof tip[1] === 'function' ? tip[1]() : tip[1];
      ctx.globalAlpha = a;
      ctx.font = '700 20px system-ui,-apple-system,"Segoe UI",sans-serif';
      const tw = ctx.measureText(txt).width + 40;
      ctx.fillStyle = 'rgba(20,12,4,.72)'; rr(W / 2 - tw / 2, H - 118, tw, 38, 19); ctx.fill();
      hudText(txt, W / 2, H - 99, 20, '#fff', 'center', 700);
      ctx.globalAlpha = 1;
    }
  }
  // damage vignette
  if (p.flash > 0) { ctx.fillStyle = `rgba(255,0,0,${p.flash * 0.5})`; ctx.fillRect(0, 0, W, H); }
}

// ---------------------------------------------------------------------
//  Garage (menu)
// ---------------------------------------------------------------------
function renderGarage() {
  const coins = Store.get('coins', 0), owned = Store.get('owned', ['racer']);
  if (!owned.includes(selectedCar)) selectedCar = 'racer';
  const g = $('garage'); g.innerHTML = '';
  const maxes = { hp: 150, spd: 470, ram: 1.7 };
  for (const c of CARS) {
    const has = owned.includes(c.id), sel = c.id === selectedCar;
    const d = document.createElement('div');
    d.className = 'car' + (sel ? ' sel' : '');
    const st = (label, v, m) => `<div class="stat"><span>${label}</span><i><em style="width:${Math.round(100 * v / m)}%"></em></i></div>`;
    d.innerHTML = `<div class="sw" style="background:${c.color}"></div><b>${c.name}</b><p>${c.desc}</p>` +
      st('Armor', c.hp, maxes.hp) + st('Speed', c.maxSpeed, maxes.spd) + st('Ram', c.ram, maxes.ram);
    const b = document.createElement('button');
    b.className = 'btn' + (has ? (sel ? '' : ' alt') : '');
    if (has) { b.textContent = sel ? '✔ Selected' : 'Select'; b.onclick = () => { selectedCar = c.id; Store.set('car', c.id); renderGarage(); }; }
    else {
      b.textContent = `Unlock 🪙 ${c.cost}`; b.disabled = coins < c.cost;
      b.onclick = () => {
        const cur = Store.get('coins', 0); if (cur < c.cost) return;
        Store.set('coins', cur - c.cost); Store.set('owned', [...owned, c.id]);
        selectedCar = c.id; Store.set('car', c.id); renderGarage();
      };
    }
    d.appendChild(b); g.appendChild(d);
  }
  const best = Store.get('best', 0), wins = Store.get('wins', 0);
  $('menuInfo').innerHTML = `🪙 <b>${coins}</b> coins &nbsp;·&nbsp; Best survival: <b>${fmtTime(best)}</b>` + (wins ? ` &nbsp;·&nbsp; Victories: <b>${wins}</b>` : '');
}

// ---------------------------------------------------------------------
//  Input
// ---------------------------------------------------------------------
function setPointer(e) {
  const r = canvas.getBoundingClientRect();
  pointer.x = (e.clientX - r.left) / r.width * W;
  pointer.y = (e.clientY - r.top) / r.height * H;
}
canvas.addEventListener('pointerdown', e => {
  setPointer(e); pointer.active = true; pointer.mouse = e.pointerType === 'mouse'; if (pointer.mouse) pointer.over = true;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
});
canvas.addEventListener('pointermove', e => { setPointer(e); if (e.pointerType === 'mouse') { pointer.mouse = true; pointer.over = true; } });
canvas.addEventListener('pointerup', () => { pointer.active = false; });
canvas.addEventListener('pointercancel', () => { pointer.active = false; });
canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') pointer.over = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if ((e.code === 'KeyP' || e.code === 'Space') && !e.repeat) { if (state === 'play') pauseGame(); else if (state === 'paused') resumeGame(); }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; pointer.active = false; });
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(true); Sound.setHidden(document.hidden); });

// audio may only start after a user gesture
const unlockAudio = () => Sound.init();
window.addEventListener('pointerdown', e => { lastPointerType = e.pointerType === 'touch' ? 'touch' : 'mouse'; unlockAudio(); }, true);
window.addEventListener('keydown', e => {
  unlockAudio();
  if (e.code === 'KeyM' && !e.repeat) toggleMute();
}, true);
$('ui').addEventListener('click', e => { const b = e.target.closest('button'); if (b && b.id !== 'muteBtn') Sound.play('click'); });
function toggleMute() { Sound.init(); const m = Sound.toggleMute(); updateMuteBtn(); return m; }
function updateMuteBtn() { $('muteBtn').textContent = Sound.muted ? '🔇' : '🔊'; $('muteBtn').setAttribute('aria-label', Sound.muted ? 'Unmute' : 'Mute'); }
$('muteBtn').onclick = toggleMute;
updateMuteBtn();

// phones held upright: show a "rotate" overlay and pause the run
const portraitMQ = window.matchMedia('(orientation: portrait) and (pointer: coarse)');
function checkOrientation() { if (portraitMQ.matches) pauseGame(); }
if (portraitMQ.addEventListener) portraitMQ.addEventListener('change', checkOrientation); else if (portraitMQ.addListener) portraitMQ.addListener(checkOrientation);

$('playBtn').onclick = () => { $('playBtn').disabled = true; Platform.commercialBreak().then(() => { $('playBtn').disabled = false; startRun(); }); };
$('pauseBtn').onclick = pauseGame;
$('resumeBtn').onclick = resumeGame;
$('quitBtn').onclick = () => { bankRun(); run = null; setState('menu'); };
$('continueBtn').onclick = () => { bankRun(); run = null; setState('menu'); };
$('reviveBtn').onclick = revive;
$('rerollBtn').onclick = rerollUpgrades;

// ---------------------------------------------------------------------
//  Main loop
// ---------------------------------------------------------------------
let last = performance.now(), menuT = 0;
function frame(now) {
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.05) dt = 0.05;
  if (state === 'play' && run) {
    update(dt);
    if (run) { const p = run.player; Sound.ambient(state === 'play', clamp(Math.hypot(p.vx, p.vy) / 470, 0, 1), p.drifting, run.hype / 100); }
  } else Sound.ambient(false, 0, false, 0);
  if (!run) { menuT += dt; cam.x = Math.cos(menuT * 0.12) * 700; cam.y = Math.sin(menuT * 0.12) * 450; clampCam(); }
  render(now);
  requestAnimationFrame(frame);
}

(async function boot() {
  buildBackground();
  await Platform.init();
  setState('menu');
  Platform.loadingFinished();
  requestAnimationFrame(t => { last = t; frame(t); });
  // DEBUG-START (removed from release builds by build.py)
  window.__steel = {
    get run() { return run; }, get state() { return state; }, enemies, pickups, particles, startRun, pointer, cam, Sound,
    setCar(id) { selectedCar = id; },
    // simulate n frames of dt seconds; auto-picks the first upgrade card
    sim(n, dt = 1 / 60) {
      for (let i = 0; i < n; i++) {
        if (state === 'levelup') document.querySelector('#cards .card').click();
        if (state !== 'play') break;
        update(dt);
      }
      return state;
    },
    // build a dramatic still scene for store thumbnails (no HUD)
    stage(carId = 'racer') {
      selectedCar = carId; startRun(); setState('paused'); showScreen(null); $('pauseBtn').style.display = 'none';
      hideHud = true;
      const p = run.player; p.x = 0; p.y = 120; p.angle = -0.35; p.turret = -0.9; p.vx = 300; p.vy = -60; p.iframes = 0;
      run.time = 3.194; run.bladeAng = 0.6; run.favor = 0;   // time chosen so the boss telegraph is at full glow
      run.weapons = { mg: { lv: 3, cd: 0 }, blades: { lv: 5, cd: 0 }, tesla: { lv: 3, cd: 0 } };
      run.passives = { bumper: 2 };
      cam.x = 110; cam.y = 10; cam.shake = 0;
      for (let i = 0; i < 26; i++) skids.push({ x1: -i * 14 - 20, y1: 128 + i * 7 + Math.sin(i * 0.4) * 6, x2: -(i + 1) * 14 - 20, y2: 128 + (i + 1) * 7 + Math.sin((i + 1) * 0.4) * 6, t: i * 0.15 });
      const types = ['automaton', 'lion', 'automaton', 'archer', 'roller', 'lion', 'chariot', 'automaton'];
      for (let i = 0; i < 70; i++) {
        const a = i * 2.39996, d = 125 + (i % 9) * 34 + rand(0, 20);
        const x = p.x + Math.cos(a) * d * 1.6, y = p.y + Math.sin(a) * d;
        if (insidePillar(x, y) || (x > 170 && x < 520 && y > -60 && y < 200)) continue;   // keep the boss lane clear
        if (enemies.some(o => Math.hypot(o.x - x, o.y - y) < 40)) continue;
        const e = spawnEnemy(types[i % types.length], x, y, { spawnT: 0 });
        e.face = Math.atan2(p.y - y, p.x - x);
      }
      const b = spawnEnemy('bull', 420, 60, { spawnT: 0, state: 'wind' });
      b.aim = b.face = Math.atan2(p.y - b.y, p.x - b.x);
      const blasts = [];
      for (const [x, y, r] of [[-300, 40, 80], [120, 300, 95]]) {
        effects.push({ kind: 'ring', x, y, r0: 10, r1: r, t: 0.06, life: 0.3, color: '#ffb347' });
        const n0 = particles.length;
        burst(x, y, '#ff8c3a', 40, 260); burst(x, y, '#ffe08a', 24, 200); burst(x, y, '#4a3b2c', 14, 160);
        for (let k = n0; k < particles.length; k++) blasts.push(particles[k]);
      }
      for (const pt of blasts) { pt.x += pt.vx * 0.22; pt.y += pt.vy * 0.22; pt.size *= 1.8; pt.t = 0; pt.life = 1; }
      const zp = [{ x: p.x, y: p.y }];
      for (const e of enemies.filter(e => !e.boss).sort((a, c) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(c.x - p.x, c.y - p.y)).slice(0, 3)) zp.push({ x: e.x, y: e.y });
      effects.push({ kind: 'zap', pts: zp, t: 0, life: 0.18 });
      for (let i = 0; i < 4; i++) { const a = -0.9 + (i - 1.5) * 0.06; bullets.push({ kind: 'bullet', x: p.x + Math.cos(a) * (40 + i * 70), y: p.y + Math.sin(a) * (40 + i * 70), vx: Math.cos(a) * 950, vy: Math.sin(a) * 950, r: 4, life: 1 }); }
      for (let i = 0; i < 22; i++) pickups.push({ type: i % 9 ? 'xp' : 'coin', x: rand(-560, 560), y: rand(-280, 380), val: i % 5 ? 1 : 3 });
      for (let i = 0; i < 40; i++) particles.push({ x: p.x - 30 - rand(0, 40), y: p.y + 14 + rand(-12, 12), vx: 0, vy: 0, t: rand(0, 0.3), life: 0.6, color: 'rgba(230,210,170,.7)', size: rand(4, 9), grow: true });
    },
    // render the current scene at w x h (16:9) and return a PNG data URL
    snap(w = 1920, zoom = 1) {
      const vs = viewScale, d = dpr, cx = cam.x, cy = cam.y;
      viewScale = w / W * zoom; dpr = 1; canvas.width = w; canvas.height = Math.round(w * H / W);
      cam.x += W / 2 - W / (2 * zoom); cam.y += H / 2 - H / (2 * zoom);
      render(performance.now());
      const url = canvas.toDataURL('image/png');
      cam.x = cx; cam.y = cy; viewScale = vs; dpr = d; resize();
      return url;
    },
  };
  // DEBUG-END
})();
})();
