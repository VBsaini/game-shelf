'use strict';
(() => {
// =====================================================================
//  Merge Bastion — merge tower defense
// =====================================================================
const W = 1280, H = 720, TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const lerp = (a, b, t) => a + (b - a) * t;
function compact(arr) { let j = 0; for (let i = 0; i < arr.length; i++) if (!arr[i].dead) arr[j++] = arr[i]; arr.length = j; }
const $ = id => document.getElementById(id);

// ---------------------------------------------------------------------
//  Storage (wrapped: blocked storage must not crash the game)
// ---------------------------------------------------------------------
const Store = {
  get(k, d) { try { const v = localStorage.getItem('mbastion_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('mbastion_' + k, JSON.stringify(v)); } catch (e) { } },
};

// ---------------------------------------------------------------------
//  Sound: synthesized with WebAudio, starts on first user gesture
// ---------------------------------------------------------------------
const Sound = (() => {
  let ac = null, master, sfxBus, musBus, musLevel, noiseBuf;
  let muted = Store.get('muted', false), ducked = false, hidden = false;
  const lastPlay = {};
  const music = { on: false, step: 0, next: 0, timer: null, mode: 0 };
  function init() {
    if (ac) { if (ac.state === 'suspended' && !hidden) ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try { ac = new AC(); } catch (e) { ac = null; return; }
    master = ac.createGain(); master.connect(ac.destination);
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 5; comp.connect(master);
    sfxBus = ac.createGain(); sfxBus.gain.value = 0.6; sfxBus.connect(comp);
    const mf = ac.createBiquadFilter(); mf.type = 'lowpass'; mf.frequency.value = 2400; mf.connect(comp);
    musLevel = ac.createGain(); musLevel.gain.value = 0.3; musLevel.connect(mf);
    musBus = ac.createGain(); musBus.connect(musLevel);
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
  const N = n => 440 * Math.pow(2, (n - 69) / 12);
  const SFX = {
    click: () => tone('triangle', 700, 900, 0.06, 0.12),
    deny: () => { tone('square', 220, 180, 0.12, 0.06); },
    summon: () => { const t = now(); [67, 71, 74].forEach((n, i) => tone('triangle', N(n), N(n), 0.12, 0.13, t + i * 0.05)); noise(0.2, 0.06, 'highpass', 3000, 6000, t); },
    merge: (lv) => { const t = now(), b = 60 + Math.min(lv || 2, 8) * 2; [b, b + 4, b + 7, b + 12].forEach((n, i) => tone('triangle', N(n), N(n), 0.25, 0.14, t + i * 0.045)); tone('sine', N(b + 24), N(b + 31), 0.4, 0.05, t + 0.15); },
    move: () => tone('sine', 400, 300, 0.08, 0.1),
    sell: () => { tone('square', 988, 988, 0.06, 0.05); tone('square', 784, 784, 0.12, 0.05, now() + 0.06); },
    arrow: () => noise(0.07, 0.06, 'highpass', 1800, 4200),
    cannon: () => { tone('sine', 120, 50, 0.18, 0.35); noise(0.12, 0.15, 'lowpass', 900, 200); },
    boom: () => { noise(0.35, 0.25, 'lowpass', 1400, 100); tone('sine', 100, 40, 0.3, 0.25); },
    frost: () => { tone('sine', 1800, 2600, 0.1, 0.05); tone('sine', 2400, 3200, 0.12, 0.03, now() + 0.03); },
    zap: () => { tone('sawtooth', 1500, 200, 0.12, 0.07); noise(0.1, 0.08, 'highpass', 3200, 5000); },
    kill: () => { noise(0.08, 0.12, 'bandpass', 1300, 500, 0, 1.6); tone('square', 300, 120, 0.06, 0.03); },
    leak: () => { tone('sawtooth', 160, 60, 0.35, 0.22); noise(0.3, 0.25, 'lowpass', 600, 120); },
    wave: () => { const t = now(); tone('sawtooth', N(57), N(57), 0.22, 0.1, t); tone('sawtooth', N(62), N(62), 0.45, 0.1, t + 0.2); },
    boss: () => { const t = now(); for (const [n, v] of [[38, 0.2], [45, 0.14], [50, 0.1]]) tone('sawtooth', N(n), N(n) * 0.97, 1.4, v, t); },
    clear: () => { const t = now(); [72, 76, 79].forEach((n, i) => tone('square', N(n), N(n), 0.14, 0.05, t + i * 0.08)); },
    gift: () => { const t = now(); [72, 76, 79, 84, 88].forEach((n, i) => tone('triangle', N(n), N(n), 0.2, 0.12, t + i * 0.06)); },
    lose: () => { const t = now(); [[64, 0], [60, 0.22], [55, 0.44]].forEach(([n, d]) => tone('triangle', N(n), N(n) * 0.98, 0.45, 0.15, t + d)); noise(0.8, 0.3, 'lowpass', 900, 80); },
  };
  // music: gentle march, busier during waves, heavy on boss waves
  const STEP = 60 / 112 / 4;
  const CHORDS = [[50, 53, 57], [48, 52, 55], [46, 50, 53], [48, 52, 55]];   // Dm C Bb C
  const MEL = [62, -1, 65, 64, 62, -1, 60, -1, 62, 65, 69, -1, 67, 65, 64, -1];
  function schedule() {
    if (!ac || !music.on) return;
    while (music.next < now() + 0.15) {
      const s = music.step % 64, bar = Math.floor(s / 16), t = music.next, m = music.mode, ch = CHORDS[bar];
      if (s % 16 === 0) for (const n of ch) tone('triangle', N(n), N(n), STEP * 15, m ? 0.03 : 0.045, t, musBus);
      if (m >= 1) {
        if (s % 8 === 0) tone('sine', 140, 45, 0.2, 0.45, t, musBus);
        if (s % 8 === 4) noise(0.1, 0.12, 'bandpass', 1500, 1000, t, 0.8, musBus);
        if (s % 4 === 2 && m >= 2) tone('sine', 120, 40, 0.15, 0.35, t, musBus);
        if (s % 2 === 0) { const n = ch[0] - 12 + (s % 8 === 6 ? 7 : 0); tone('sawtooth', N(n), N(n), STEP * 1.6, 0.07, t, musBus); }
        if (s % 2 === 0 && bar % 2 === 1) { const n = MEL[(s / 2 | 0) % 16]; if (n > 0) tone('square', N(n + (m >= 2 ? 0 : 12)), N(n + (m >= 2 ? 0 : 12)), STEP * 1.8, 0.025, t, musBus); }
      } else if (s % 4 === 0) { const n = ch[(s / 4) % 3] + 12; tone('sine', N(n), N(n), STEP * 3, 0.035, t, musBus); }
      music.step++; music.next += STEP;
    }
  }
  function startMusic() {
    music.on = true;
    if (ac && !music.timer) { music.next = now() + 0.05; music.timer = setInterval(schedule, 40); }
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
    music(mode) { music.mode = mode; startMusic(); },
    musicLevel(v) { if (musLevel) musLevel.gain.setTargetAtTime(0.3 * v, now(), 0.15); },
    duck(on) { ducked = on; applyVolume(); },
    setHidden(h) { hidden = h; if (ac) { if (h) ac.suspend(); else ac.resume(); } },
    get muted() { return muted; },
    toggleMute() { muted = !muted; Store.set('muted', muted); applyVolume(); return muted; },
  };
})();

// ---------------------------------------------------------------------
//  Platform / ads wrapper (Poki or CrazyGames SDK, else a visible stub)
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
//  Board: a winding road and the tower slots between its loops
// ---------------------------------------------------------------------
const PATH = [[-40, 130], [1150, 130], [1150, 330], [130, 330], [130, 530], [1180, 530]];
const SEGS = []; let PATH_LEN = 0;
for (let i = 0; i < PATH.length - 1; i++) {
  const [x0, y0] = PATH[i], [x1, y1] = PATH[i + 1], len = Math.hypot(x1 - x0, y1 - y0);
  SEGS.push({ x0, y0, x1, y1, len, start: PATH_LEN }); PATH_LEN += len;
}
function pathPos(d) {
  for (const s of SEGS) if (d <= s.start + s.len) { const f = (d - s.start) / s.len; return { x: lerp(s.x0, s.x1, f), y: lerp(s.y0, s.y1, f) }; }
  const s = SEGS[SEGS.length - 1]; return { x: s.x1, y: s.y1 };
}
const CASTLE = { x: 1222, y: 530 };
const TRASH = { x: 70, y: 670, r: 40 };
const SLOTS = [];
for (const y of [195, 265, 395, 465]) for (let c = 0; c < 8; c++) SLOTS.push({ x: 360 + c * 80, y, tower: null });

// ---------------------------------------------------------------------
//  Definitions
// ---------------------------------------------------------------------
const MAX_LV = 8;
const LV_COL = ['#d7d7d7', '#8bc34a', '#29b6f6', '#ab47bc', '#ffb300', '#ff5722', '#e91e63', '#fff176'];
const TT = {
  archer: { name: 'Archer', color: '#5fb85a', dark: '#2f6b2c', range: 175, rate: 1.6, dmg: 9, desc: 'Fast single shots' },
  cannon: { name: 'Cannon', color: '#a1887f', dark: '#4e342e', range: 150, rate: 0.55, dmg: 18, splash: 62, desc: 'Splash damage' },
  frost:  { name: 'Frost', color: '#6fd0f5', dark: '#1f78b4', range: 155, rate: 1.0, dmg: 5, desc: 'Slows enemies' },
  storm:  { name: 'Storm', color: '#b76fd0', dark: '#6a1b9a', range: 165, rate: 0.75, dmg: 11, desc: 'Chain lightning' },
  // fusions: two different Lv 4 or Lv 5 towers dropped on each other
  sticky:   { name: 'Sticky Bomber', fusion: ['archer', 'cannon'], range: 180, rate: 0.95, dmg: 26, splash: 72, desc: 'Bombs stick to enemies, then blow up' },
  fsniper:  { name: 'Frost Sniper', fusion: ['archer', 'frost'], range: 270, rate: 0.8, dmg: 62, desc: 'Big-calibre shots; chills the road in range' },
  lance:    { name: 'Lightning Lance', fusion: ['archer', 'storm'], range: 230, rate: 0.9, dmg: 30, desc: 'A bolt that pierces every enemy in a line' },
  glacier:  { name: 'Glacier Mortar', fusion: ['cannon', 'frost'], range: 165, rate: 0.6, dmg: 20, splash: 72, desc: 'Shells freeze enemies solid' },
  thunder:  { name: 'Thunder Mortar', fusion: ['cannon', 'storm'], range: 170, rate: 0.5, dmg: 15, splash: 58, desc: 'Shells leave a shocking field on the road' },
  blizzard: { name: 'Blizzard', fusion: ['frost', 'storm'], range: 145, rate: 2, dmg: 4, desc: 'Freezing storm hurts everything in range' },
};
const BASIC = ['archer', 'cannon', 'frost', 'storm'];
const FUSE = {};
for (const k in TT) if (TT[k].fusion) {
  const [a, b] = TT[k].fusion; FUSE[a + '+' + b] = FUSE[b + '+' + a] = k;
  TT[k].color = TT[a].color; TT[k].color2 = TT[b].color; TT[k].dark = TT[a].dark; TT[k].dark2 = TT[b].dark;
}
const FUSE_MIN = 4, FUSE_MAX = 5;
const maxLv = type => TT[type].fusion ? FUSE_MAX : MAX_LV;
// buying better summons: [summon level, gold]
const SUMMON_UPS = [[2, 200], [3, 700], [4, 2000]];
const ET = {
  slime:  { hp: 26, speed: 95, gold: 2, r: 13, color: '#7cb342', dark: '#41721a' },
  runner: { hp: 17, speed: 175, gold: 2, r: 11, color: '#c6c13a', dark: '#6f6c14' },
  knight: { hp: 80, speed: 68, gold: 5, r: 15, color: '#9ea7b0', dark: '#545c63', armor: true },
  brute:  { hp: 60, speed: 78, gold: 4, r: 18, color: '#558b2f', dark: '#2c4d14', split: true },
  ogre:   { hp: 1100, speed: 48, gold: 60, r: 30, color: '#9c6b43', dark: '#5a3a1e', boss: true, lives: 10 },
};
const UPGRADES = [
  { id: 'archer', icon: '🏹', name: 'Archer power', desc: '+12% archer damage', max: 10 },
  { id: 'cannon', icon: '💣', name: 'Cannon power', desc: '+12% cannon damage', max: 10 },
  { id: 'frost', icon: '❄️', name: 'Frost power', desc: '+12% frost damage, stronger slow', max: 10 },
  { id: 'storm', icon: '⚡', name: 'Storm power', desc: '+12% storm damage', max: 10 },
  { id: 'gold', icon: '🪙', name: 'War chest', desc: '+20 starting gold', max: 5 },
  { id: 'walls', icon: '🧱', name: 'Thick walls', desc: '+3 castle lives', max: 5 },
  { id: 'lucky', icon: '🍀', name: 'Lucky summon', desc: '+6% chance a summon comes one level higher', max: 5 },
  { id: 'bounty', icon: '💰', name: 'Bounty', desc: '+8% gold from enemies', max: 5 },
];
const upCost = (u, lv) => Math.round((u.max === 10 ? 6 : 12) * Math.pow(1.45, lv));
const upLv = id => (Store.get('up', {})[id] || 0);

// ---------------------------------------------------------------------
//  State
// ---------------------------------------------------------------------
let state = 'menu';               // menu | shop | play | paused | over
let g = null;                     // current game
const enemies = [], shots = [], parts = [], texts = [], zaps = [], fields = [];
const pointer = { x: 0, y: 0, down: false };
let drag = null, selected = null, hideHud = false;

function newGame() {
  for (const a of [enemies, shots, parts, texts, zaps, fields]) a.length = 0;
  for (const s of SLOTS) s.tower = null;
  drag = null; selected = null;
  g = {
    wave: 0, lives: 20 + 3 * upLv('walls'), maxLives: 20 + 3 * upLv('walls'), gold: 40 + 20 * upLv('gold'),
    summons: 0, kills: 0, bosses: 0, time: 0, speed: 1, queue: [], spawnT: 0, breakT: 2.5, inWave: false,
    revived: false, gift: false, banked: false, banner: null, castleFlash: 0, shake: 0, giftUsedWave: 0,
    tips: !Store.get('tipsDone', false), firstMerge: false, sumLv: 1, fuseTip: false,
  };
  updateBar();
  setState('play');
}
function summonCost() { return 10 + 3 * g.summons; }
function nextSummonUp() { return SUMMON_UPS.find(u => u[0] > g.sumLv) || null; }
function upgradeSummons() {
  if (state !== 'play' || !g) return;
  const u = nextSummonUp(); if (!u) return;
  if (g.gold < u[1]) { Sound.play('deny'); flashText(W / 2, 600, 'Not enough gold', '#ff8a65'); return; }
  g.gold -= u[1]; g.sumLv = u[0];
  banner('SUMMONS ARE NOW LV ' + g.sumLv + '!', 1.8); Sound.play('gift');
  updateBar();
}

// ---------------------------------------------------------------------
//  Towers
// ---------------------------------------------------------------------
function towerStats(t) {
  const d = TT[t.type], lv = t.lv;
  // a fusion gets the average Workshop power of its two parents
  const up = d.fusion ? (upLv(d.fusion[0]) + upLv(d.fusion[1])) / 2 : upLv(t.type);
  return {
    // archers become snipers: much more range per level
    range: d.range * (1 + (t.type === 'archer' ? 0.09 : 0.05) * (lv - 1)),
    rate: d.rate * (1 + 0.06 * (lv - 1)),
    dmg: d.dmg * Math.pow(2.35, lv - 1) * (1 + 0.12 * up),
    splash: d.splash ? d.splash * (1 + 0.06 * (lv - 1)) : 0,
    chain: 2 + Math.floor(lv / 2),
    slow: Math.min(0.7, 0.3 + 0.05 * lv + 0.01 * upLv('frost')),
    chill: 0.35 + 0.05 * (lv - FUSE_MIN) + 0.01 * upLv('frost'),   // Frost Sniper's road chill / Blizzard slow
    freeze: 0.7 + 0.15 * (lv - FUSE_MIN),                          // Glacier Mortar
    field: 2.5,                                                     // Thunder Mortar field lasts this long
  };
}
function makeTower(type, lv) { return { type, lv, cd: rand(0, 0.4), aim: -Math.PI / 2, pop: 0.35, recoil: 0 }; }
function emptySlots() { return SLOTS.filter(s => !s.tower); }

function summon() {
  if (state !== 'play') return;
  const free = emptySlots(), cost = summonCost();
  if (!free.length) { Sound.play('deny'); flashText(W / 2, 600, 'No free spot. Merge or sell a tower!', '#ff8a65'); return; }
  if (g.gold < cost) { Sound.play('deny'); flashText(W / 2, 600, 'Not enough gold', '#ff8a65'); return; }
  g.gold -= cost; g.summons++;
  const slot = pick(free), lv = Math.min(MAX_LV, g.sumLv + (Math.random() < 0.06 * upLv('lucky') ? 1 : 0));
  slot.tower = makeTower(pick(BASIC), lv);
  if (lv >= 2) { parts.push({ ring: true, x: slot.x, y: slot.y, t: 0, life: 0.35, r0: 8, r1: 46, color: LV_COL[lv - 1] }); }
  checkFuseTip(slot.tower);
  burst(slot.x, slot.y, TT[slot.tower.type].color, 14, 140);
  Sound.play('summon');
  updateBar();
}
function placeGift() {
  const free = emptySlots(); if (!free.length) return false;
  const lv = Math.max(3, g.sumLv + 1);
  const slot = pick(free); slot.tower = makeTower(pick(BASIC), lv);
  burst(slot.x, slot.y, '#ffd54a', 30, 200); Sound.play('gift');
  flashText(slot.x, slot.y - 40, 'LV ' + lv + '!', '#ffd54a', 26);
  checkFuseTip(slot.tower);
  return true;
}
function sellValue(t) { return Math.round(6 * Math.pow(2, t.lv - 1) * (TT[t.type].fusion ? 2 : 1)); }
function canMerge(a, b) { return a && b && a !== b && a.type === b.type && a.lv === b.lv && a.lv < maxLv(a.type); }
// two different plain towers, both Lv 4 or both Lv 5, fuse into a special tower of that level
function fuseResult(a, b) {
  if (!a || !b || a === b || a.lv !== b.lv || a.lv < FUSE_MIN || a.lv > FUSE_MAX) return null;
  return FUSE[a.type + '+' + b.type] || null;
}
function fuseInto(dst, src) {
  const type = fuseResult(dst.tower, src.tower), lv = dst.tower.lv;
  dst.tower = makeTower(type, lv); dst.tower.pop = 0.6; dst.tower.cd = 0.3; src.tower = null;
  burst(dst.x, dst.y, TT[type].color, 22, 240); burst(dst.x, dst.y, TT[type].color2, 22, 240);
  for (const [r1, life] of [[80, 0.45], [120, 0.6]]) parts.push({ ring: true, x: dst.x, y: dst.y, t: 0, life, r0: 10, r1, color: '#fff' });
  Sound.play('merge', 0, 8); Sound.play('gift');
  banner(TT[type].name.toUpperCase() + '!', 1.8);
  flashText(dst.x, dst.y - 46, TT[type].desc, '#fff', 16);
  if (!Store.get('fused', false)) Store.set('fused', true);
  g.firstMerge = true;
}
// the first time a player owns a Lv 4 tower, tell them about fusing
function checkFuseTip(t) {
  if (!t || TT[t.type].fusion || t.lv < FUSE_MIN || g.fuseTip || Store.get('fused', false)) return;
  g.fuseTip = true;
  flashText(W / 2, 560, 'Lv 4 unlocked! Drop it on a different Lv 4 tower to FUSE them', '#80deea', 22);
  texts[texts.length - 1].life = 4.5;
}
function mergeInto(dst, src) {
  dst.tower.lv++; dst.tower.pop = 0.45; src.tower = null;
  burst(dst.x, dst.y, LV_COL[dst.tower.lv - 1], 26, 220);
  parts.push({ ring: true, x: dst.x, y: dst.y, t: 0, life: 0.4, r0: 10, r1: 70, color: LV_COL[dst.tower.lv - 1] });
  Sound.play('merge', 0, dst.tower.lv);
  if (dst.tower.lv >= 5) banner(TT[dst.tower.type].name.toUpperCase() + ' LV ' + dst.tower.lv + '!', 1.4);
  g.firstMerge = true;
  checkFuseTip(dst.tower);
}

// ---------------------------------------------------------------------
//  Waves
// ---------------------------------------------------------------------
function hpScale(w) { return (1 + 0.2 * (w - 1)) * Math.pow(1.1, w - 1); }
function startWave() {
  g.wave++; g.inWave = true;
  const w = g.wave, q = [];
  const boss = w % 10 === 0;
  const n = Math.min(10 + Math.floor(w * 1.6), 60);
  const gap = Math.max(0.26, 0.72 - w * 0.02);
  for (let i = 0; i < n; i++) {
    const pool = ['slime', 'slime'];
    if (w >= 3) pool.push('runner');
    if (w >= 5) pool.push('knight');
    if (w >= 7) pool.push('brute');
    if (w >= 12) pool.push('runner', 'knight');
    // some waves are themed swarms
    let type = pick(pool);
    if (w % 4 === 3 && w > 4) type = 'runner';
    if (w % 6 === 5 && w > 6) type = i % 2 ? 'knight' : 'brute';
    q.push({ type, gap: (w % 4 === 3 && w > 4) ? gap * 0.75 : gap });
  }
  if (boss) { q.push({ type: 'ogre', gap: 2.5 }); banner('WAVE ' + w + ': THE OGRE KING!', 2.6); Sound.play('boss'); Sound.music(2); }
  else { banner('WAVE ' + w, 1.5); Sound.play('wave'); Sound.music(1); }
  g.queue = q; g.spawnT = 0.5;
}
function spawnEnemy(type, d = 0, hpOverride) {
  const T = ET[type], hp = hpOverride || T.hp * hpScale(g.wave) * (T.boss ? 1 + Math.floor(g.wave / 10 - 1) * 0.8 : 1);
  const e = { type, d, hp, maxHp: hp, speed: T.speed * rand(0.94, 1.06), r: T.r, gold: T.gold, color: T.color, dark: T.dark,
    armor: !!T.armor, split: !!T.split, boss: !!T.boss, lives: T.lives || 1, slowT: 0, slowAmt: 0, flash: 0, bob: rand(0, TAU), x: 0, y: 0 };
  const p = pathPos(d); e.x = p.x; e.y = p.y;
  enemies.push(e);
  return e;
}
function endWave() {
  g.inWave = false; g.breakT = 3;
  const bonus = 8 + g.wave * 2;
  g.gold += bonus; updateBar();
  flashText(W / 2, 250, 'Wave cleared! +' + bonus + ' 🪙', '#ffd54a', 26);
  Sound.play('clear'); Sound.music(1);
  if (g.wave % 5 === 0 && !g.gift) { g.gift = true; updateBar(); }
}

// ---------------------------------------------------------------------
//  Combat
// ---------------------------------------------------------------------
// how fast an enemy moves right now (1 = full speed)
function speedFactor(e) {
  let f = 1;
  if (e.slowT > 0) f = 1 - e.slowAmt;
  if (e.chill) f = Math.min(f, 1 - e.chill);
  if (e.freezeT > 0) f = Math.min(f, e.boss ? 0.5 : 0);
  return f;
}
function damage(e, amt, src) {
  if (e.dead) return;
  if (e.armor && (src === 'archer')) amt *= 0.5;
  e.hp -= amt; e.flash = 0.08;
  if (e.hp <= 0) kill(e);
}
function kill(e) {
  e.dead = true; g.kills++;
  const gold = Math.max(1, Math.round(e.gold * (1 + 0.08 * upLv('bounty'))));
  g.gold += gold;
  burst(e.x, e.y, e.color, e.boss ? 60 : 9, e.boss ? 320 : 160);
  if (e.boss) {
    g.bosses++; g.shake = 14; banner('OGRE KING DEFEATED!', 2.2); Sound.play('boom');
    flashText(e.x, e.y - 40, '+' + gold + ' 🪙', '#ffd54a', 26);
  } else Sound.play('kill', 0.05);
  if (e.split) for (let k = 0; k < 2; k++) { const c = spawnEnemy('slime', Math.max(0, e.d - 10 - k * 18)); c.hp = c.maxHp = ET.slime.hp * hpScale(g.wave) * 0.6; }
  updateBar();
}
function targetFor(x, y, range) {
  let best = null, bd = -1;
  for (const e of enemies) {
    if (e.dead || e.d < 5) continue;
    const dx = e.x - x, dy = e.y - y;
    if (dx * dx + dy * dy <= (range + e.r) * (range + e.r) && e.d > bd) { bd = e.d; best = e; }
  }
  return best;
}
function fire(slot, t, st, tgt) {
  const type = t.type;
  t.aim = Math.atan2(tgt.y - slot.y, tgt.x - slot.x); t.recoil = 1;
  if (type === 'archer') {
    shots.push({ kind: 'arrow', x: slot.x, y: slot.y - 6, tgt, speed: 760, dmg: st.dmg, src: 'archer' });
    Sound.play('arrow', 0.06);
  } else if (type === 'cannon') {
    const lead = Math.min(0.6, Math.hypot(tgt.x - slot.x, tgt.y - slot.y) / 420);
    const fp = pathPos(tgt.d + tgt.speed * speedFactor(tgt) * lead);
    shots.push({ kind: 'ball', x0: slot.x, y0: slot.y - 6, x: slot.x, y: slot.y, tx: fp.x, ty: fp.y, t: 0, dur: lead + 0.15, dmg: st.dmg, splash: st.splash });
    Sound.play('cannon', 0.08);
  } else if (type === 'glacier' || type === 'thunder') {
    const lead = Math.min(0.6, Math.hypot(tgt.x - slot.x, tgt.y - slot.y) / 420);
    const fp = pathPos(tgt.d + tgt.speed * speedFactor(tgt) * lead);
    shots.push({ kind: 'ball', fx: type, x0: slot.x, y0: slot.y - 6, x: slot.x, y: slot.y, tx: fp.x, ty: fp.y, t: 0, dur: lead + 0.15, dmg: st.dmg, splash: st.splash, freeze: st.freeze, field: st.field });
    Sound.play('cannon', 0.08);
  } else if (type === 'sticky') {
    shots.push({ kind: 'sticky', x: slot.x, y: slot.y - 6, tgt, speed: 620, dmg: st.dmg, splash: st.splash });
    Sound.play('arrow', 0.06);
  } else if (type === 'fsniper') {
    // big-calibre hitscan shot; armour does not stop it
    damage(tgt, st.dmg, 'sniper');
    zaps.push({ pts: [{ x: slot.x, y: slot.y - 6 }, { x: tgt.x, y: tgt.y }], t: 0, life: 0.14, tracer: true });
    burst(tgt.x, tgt.y, '#e0f7fa', 6, 140);
    Sound.play('cannon', 0.06);
  } else if (type === 'lance') {
    // a bolt to the edge of range that hurts everything along it
    const a = Math.atan2(tgt.y - slot.y, tgt.x - slot.x), x1 = slot.x + Math.cos(a) * st.range, y1 = slot.y + Math.sin(a) * st.range;
    const vx = x1 - slot.x, vy = y1 - slot.y, L2 = vx * vx + vy * vy;
    for (const e of enemies) {
      if (e.dead) continue;
      const u = clamp(((e.x - slot.x) * vx + (e.y - slot.y) * vy) / L2, 0, 1), px = slot.x + vx * u, py = slot.y + vy * u;
      if ((e.x - px) ** 2 + (e.y - py) ** 2 <= (e.r + 12) ** 2) damage(e, st.dmg, 'storm');
    }
    zaps.push({ pts: [{ x: slot.x, y: slot.y - 10 }, { x: x1, y: y1 }], t: 0, life: 0.2, lance: true });
    Sound.play('zap', 0.08);
  } else if (type === 'blizzard') {
    for (const e of enemies) {
      if (e.dead || (e.x - slot.x) ** 2 + (e.y - slot.y) ** 2 > (st.range + e.r) ** 2) continue;
      damage(e, st.dmg, 'frost');
      if (!e.dead) { const amt = e.boss ? st.chill * 0.5 : st.chill; e.slowAmt = e.slowT > 0 ? Math.max(e.slowAmt, amt) : amt; e.slowT = Math.max(e.slowT, 0.7); }
    }
    parts.push({ ring: true, x: slot.x, y: slot.y, t: 0, life: 0.45, r0: 20, r1: st.range, color: 'rgba(225,245,254,.7)' });
    for (let k = 0; k < 4; k++) { const a = rand(0, TAU), r = rand(20, st.range); parts.push({ x: slot.x + Math.cos(a) * r, y: slot.y + Math.sin(a) * r, vx: rand(-20, 20), vy: rand(10, 40), t: 0, life: 0.6, color: '#fff', size: 4 }); }
    Sound.play('frost', 0.15);
  } else if (type === 'frost') {
    shots.push({ kind: 'ice', x: slot.x, y: slot.y - 6, tgt, speed: 560, dmg: st.dmg, slow: st.slow, src: 'frost' });
    Sound.play('frost', 0.08);
  } else if (type === 'storm') {
    const hit = new Set(), pts = [{ x: slot.x, y: slot.y - 10 }];
    let cur = tgt;
    for (let c = 0; c <= st.chain && cur; c++) {
      hit.add(cur); pts.push({ x: cur.x, y: cur.y });
      damage(cur, st.dmg * (c === 0 ? 1 : 0.8), 'storm');
      let nb = null, nd = 130 * 130;
      for (const e of enemies) { if (e.dead || hit.has(e)) continue; const d2 = (e.x - cur.x) ** 2 + (e.y - cur.y) ** 2; if (d2 < nd) { nd = d2; nb = e; } }
      cur = nb;
    }
    zaps.push({ pts, t: 0, life: 0.16 });
    Sound.play('zap', 0.08);
  }
}
function explode(x, y, dmg, splash, color = '#ffb74d') {
  for (const e of enemies) if (!e.dead && (e.x - x) ** 2 + (e.y - y) ** 2 < (splash + e.r) ** 2) damage(e, dmg, 'cannon');
  parts.push({ ring: true, x, y, t: 0, life: 0.3, r0: 8, r1: splash, color });
  burst(x, y, '#ff9f43', 10, 160); burst(x, y, '#5d4a36', 5, 100);
  Sound.play('boom', 0.09);
}

// ---------------------------------------------------------------------
//  Update
// ---------------------------------------------------------------------
function update(dt) {
  g.time += dt;
  // waves
  if (!g.inWave) { g.breakT -= dt; if (g.breakT <= 0) startWave(); }
  else {
    if (g.queue.length) {
      g.spawnT -= dt;
      if (g.spawnT <= 0) { const q = g.queue.shift(); spawnEnemy(q.type); g.spawnT = q.gap; }
    } else if (!enemies.some(e => !e.dead)) endWave();
  }
  // towers
  for (const s of SLOTS) {
    const t = s.tower; if (!t) continue;
    t.pop = Math.max(0, t.pop - dt); t.recoil = Math.max(0, t.recoil - dt * 5);
    if (drag && drag.slot === s) continue;
    t.cd -= dt;
    if (t.cd <= 0) {
      const st = towerStats(t), tgt = targetFor(s.x, s.y, st.range);
      if (tgt) { fire(s, t, st, tgt); t.cd = 1 / st.rate; } else t.cd = 0.1;
    }
  }
  // Frost Snipers chill the road inside their range
  const chillers = [];
  for (const s of SLOTS) if (s.tower && s.tower.type === 'fsniper' && !(drag && drag.slot === s)) { const st = towerStats(s.tower); chillers.push([s.x, s.y, st.range, st.chill]); }
  // Thunder Mortar fields
  for (const f of fields) {
    f.t += dt; if (f.t > f.life) { f.dead = true; continue; }
    for (const e of enemies) if (!e.dead && (e.x - f.x) ** 2 + (e.y - f.y) ** 2 < (f.r + e.r) ** 2) damage(e, f.dps * dt, 'storm');
  }
  // enemies
  for (const e of enemies) {
    if (e.dead) continue;
    e.flash -= dt; e.bob += dt * 8;
    if (e.slowT > 0) e.slowT -= dt;
    if (e.freezeT > 0) e.freezeT -= dt;
    e.chill = 0;
    for (const [cx, cy, r, c] of chillers) if ((e.x - cx) ** 2 + (e.y - cy) ** 2 <= r * r) e.chill = Math.max(e.chill, e.boss ? c * 0.5 : c);
    e.d += e.speed * speedFactor(e) * dt;
    const p = pathPos(e.d); e.x = p.x; e.y = p.y;
    if (e.d >= PATH_LEN) {
      e.dead = true; g.lives -= e.lives; g.castleFlash = 0.4; g.shake = Math.min(14, g.shake + (e.boss ? 14 : 5));
      Sound.play('leak', 0.08);
      flashText(CASTLE.x - 20, CASTLE.y - 60, '-' + e.lives + ' ❤', '#ff5252', 22);
      if (g.lives <= 0) { g.lives = 0; gameOver(); return; }
    }
  }
  // shots
  for (const s of shots) {
    if (s.kind === 'ball') {
      s.t += dt / s.dur; const f = Math.min(1, s.t);
      s.x = lerp(s.x0, s.tx, f); s.y = lerp(s.y0, s.ty, f); s.h = Math.sin(f * Math.PI) * 50;
      if (s.t >= 1) {
        s.dead = true;
        if (s.fx === 'glacier') {
          for (const e of enemies) if (!e.dead && (e.x - s.tx) ** 2 + (e.y - s.ty) ** 2 < (s.splash + e.r) ** 2) { damage(e, s.dmg, 'cannon'); if (!e.dead) e.freezeT = Math.max(e.freezeT || 0, s.freeze); }
          parts.push({ ring: true, x: s.tx, y: s.ty, t: 0, life: 0.4, r0: 8, r1: s.splash, color: '#b3e5fc' });
          burst(s.tx, s.ty, '#e1f5fe', 16, 170); Sound.play('frost', 0.08); Sound.play('boom', 0.12);
        } else if (s.fx === 'thunder') {
          explode(s.tx, s.ty, s.dmg, s.splash, '#ce93d8');
          fields.push({ x: s.tx, y: s.ty, r: s.splash, t: 0, life: s.field, dps: s.dmg * 0.9 });
        } else explode(s.tx, s.ty, s.dmg, s.splash);
      }
      continue;
    }
    if (s.kind === 'stuck') {
      // a sticky bomb riding on its enemy until the fuse runs out
      if (!s.tgt.dead) { s.x = s.tgt.x + s.ox; s.y = s.tgt.y + s.oy; }
      s.t += dt;
      if (s.t >= s.fuse) { s.dead = true; explode(s.x, s.y, s.dmg, s.splash); }
      continue;
    }
    const tg = s.tgt;
    if (tg.dead) { s.dead = true; continue; }
    const dx = tg.x - s.x, dy = tg.y - s.y, d = Math.hypot(dx, dy), step = s.speed * dt;
    s.a = Math.atan2(dy, dx);
    if (d <= step + tg.r * 0.5) {
      s.dead = true;
      if (s.kind === 'sticky') { shots.push({ kind: 'stuck', tgt: tg, ox: rand(-0.5, 0.5) * tg.r, oy: rand(-0.6, 0.2) * tg.r, x: tg.x, y: tg.y, t: 0, fuse: 0.9, dmg: s.dmg, splash: s.splash }); Sound.play('move', 0.1); continue; }
      damage(tg, s.dmg, s.src);
      if (s.kind === 'ice' && !tg.dead) { tg.slowT = 1.6; tg.slowAmt = tg.boss ? s.slow * 0.5 : s.slow; burst(tg.x, tg.y, '#bfefff', 4, 80); }
    } else { s.x += dx / d * step; s.y += dy / d * step; }
  }
  // fx
  for (const p of parts) { p.t += dt; if (!p.ring) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; } if (p.t > p.life) p.dead = true; }
  for (const z of zaps) { z.t += dt; if (z.t > z.life) z.dead = true; }
  for (const t of texts) { t.t += dt; t.y -= 30 * dt; if (t.t > t.life) t.dead = true; }
  for (const a of [enemies, shots, parts, zaps, texts, fields]) compact(a);
  if (g.banner) { g.banner.t += dt; if (g.banner.t > g.banner.life) g.banner = null; }
  g.castleFlash = Math.max(0, g.castleFlash - dt);
  g.shake *= Math.exp(-8 * dt); if (g.shake < 0.2) g.shake = 0;
  if (g.tips && g.wave >= 4) { g.tips = false; Store.set('tipsDone', true); }
}

// ---------------------------------------------------------------------
//  FX helpers
// ---------------------------------------------------------------------
function burst(x, y, color, n, speed) {
  for (let i = 0; i < n && parts.length < 600; i++) {
    const a = Math.random() * TAU, s = rand(30, speed);
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: rand(0.3, 0.6), color, size: rand(2, 5) });
  }
}
function flashText(x, y, str, color = '#fff', size = 20) { texts.push({ x, y, str, color, size, t: 0, life: 1.2 }); }
function banner(text, life) { g.banner = { text, t: 0, life }; }

// ---------------------------------------------------------------------
//  Game flow
// ---------------------------------------------------------------------
function setState(s, focusLoss) {
  state = s;
  if (s === 'play') Platform.gameplayStart(); else if (!(focusLoss && Platform.kind === 'crazy')) Platform.gameplayStop();
  Sound.music(s === 'play' ? (g && g.inWave ? (g.wave % 10 === 0 ? 2 : 1) : 1) : 0);
  Sound.musicLevel(s === 'paused' || s === 'over' ? 0.45 : 1);
  const showBar = s === 'play';
  $('bar').style.display = showBar ? 'block' : 'none';
  $('pauseBtn').style.display = showBar ? 'block' : 'none';
  for (const el of document.querySelectorAll('.screen')) if (el.id !== 'adstub') el.classList.toggle('show', el.id === ({ menu: 'menu', shop: 'shop', paused: 'pause', over: 'over' }[s]));
  if (s === 'menu') renderMenu();
  if (s === 'shop') renderShop();
}
function gemsEarned() { return Math.max(0, g.wave - 1) + g.bosses * 5; }
function gameOver() {
  setState('over');
  Sound.play('lose');
  drag = null;
  $('overStats').innerHTML = `You held until <b>wave ${g.wave}</b> &nbsp;·&nbsp; Enemies defeated <b>${g.kills}</b><br>Gems earned: <b>💎 ${gemsEarned()}</b>` +
    (g.wave > Store.get('best', 0) ? '<br><b style="color:#ffd54a">New best wave!</b>' : '');
  $('reviveBtn').style.display = g.revived ? 'none' : '';
}
function bank() {
  if (!g || g.banked) return;
  g.banked = true;
  Store.set('gems', Store.get('gems', 0) + gemsEarned());
  if (g.wave > Store.get('best', 0)) Store.set('best', g.wave);
}
function revive() {
  Platform.rewardedBreak().then(ok => {
    if (!ok || !g || state !== 'over') return;
    g.revived = true; g.lives = Math.min(g.maxLives, 10);
    for (const e of enemies) if (!e.boss && e.d > PATH_LEN * 0.55) { e.dead = true; burst(e.x, e.y, e.color, 6, 120); }
    setState('play'); banner('THE WALLS ARE REBUILT!', 1.8);
  });
}
function useGift() {
  if (!g || !g.gift || state !== 'play') return;
  if (!emptySlots().length) { Sound.play('deny'); flashText(W / 2, 600, 'Free a spot first!', '#ff8a65'); return; }
  Platform.rewardedBreak().then(ok => { if (!ok || !g) return; if (placeGift()) { g.gift = false; updateBar(); } });
}
function updateBar() {
  if (!g) return;
  const cost = summonCost();
  $('summonCost').textContent = '🪙 ' + cost;
  $('summonLbl').textContent = g.sumLv > 1 ? 'SUMMON LV ' + g.sumLv : 'SUMMON';
  $('summonBtn').disabled = g.gold < cost || !emptySlots().length;
  const up = nextSummonUp();
  $('sumUpBtn').style.display = up ? '' : 'none';
  if (up) { $('sumUpLbl').textContent = '⬆ Lv ' + up[0] + ' summons'; $('sumUpCost').textContent = '🪙 ' + up[1]; $('sumUpBtn').disabled = g.gold < up[1]; }
  $('giftBtn').style.display = g.gift ? '' : 'none';
  $('giftBtn').textContent = '🎬 Free Lv ' + Math.max(3, g.sumLv + 1) + ' tower';
  $('speedBtn').textContent = g.speed === 2 ? '▶▶ x2' : '▶ x1';
}
function pauseGame(focusLoss) { if (state === 'play') { drag = null; setState('paused', focusLoss === true); } }
function resumeGame() { if (state === 'paused') setState('play'); }

// menus ---------------------------------------------------------------
function renderMenu() {
  const best = Store.get('best', 0), gems = Store.get('gems', 0);
  $('menuInfo').innerHTML = `💎 <b>${gems}</b> gems &nbsp;·&nbsp; Best: <b>wave ${best}</b>`;
}
function renderShop() {
  const gems = Store.get('gems', 0), ups = Store.get('up', {});
  $('shopGems').innerHTML = `💎 <b>${gems}</b> gems`;
  const box = $('shopList'); box.innerHTML = '';
  for (const u of UPGRADES) {
    const lv = ups[u.id] || 0, cost = upCost(u, lv), maxed = lv >= u.max;
    const d = document.createElement('div'); d.className = 'up';
    d.innerHTML = `<b>${u.icon} ${u.name}</b><small>${u.desc}</small><div class="pips">${Array.from({ length: u.max }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</div>`;
    const b = document.createElement('button'); b.className = 'btn';
    b.textContent = maxed ? 'MAX' : `Upgrade 💎 ${cost}`; b.disabled = maxed || gems < cost;
    b.onclick = () => {
      const cur = Store.get('gems', 0); if (cur < cost || maxed) return;
      const all = Store.get('up', {}); all[u.id] = lv + 1; Store.set('up', all); Store.set('gems', cur - cost);
      Sound.play('merge', 0, lv + 2); renderShop();
    };
    d.appendChild(b); box.appendChild(d);
  }
}

// ---------------------------------------------------------------------
//  Rendering
// ---------------------------------------------------------------------
function circle(x, y, r, c) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
function rr(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
let bg = null;
function buildBackground() {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const b = c.getContext('2d');
  const gr = b.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#6aa84f'); gr.addColorStop(1, '#5a9440');
  b.fillStyle = gr; b.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) {
    b.fillStyle = Math.random() < 0.5 ? 'rgba(40,80,20,.16)' : 'rgba(190,230,140,.13)';
    const x = rand(0, W), y = rand(0, H); b.fillRect(x, y, rand(2, 5), rand(4, 9));
  }
  // road
  const road = (w, col) => { b.strokeStyle = col; b.lineWidth = w; b.lineJoin = 'round'; b.lineCap = 'round'; b.beginPath(); PATH.forEach(([x, y], i) => i ? b.lineTo(x, y) : b.moveTo(x, y)); b.stroke(); };
  road(70, '#7b5b39'); road(58, '#c9a46b'); road(40, '#d4b07a');
  for (let i = 0; i < 900; i++) {
    const p = pathPos(rand(0, PATH_LEN)); b.fillStyle = Math.random() < 0.5 ? 'rgba(120,85,45,.25)' : 'rgba(250,230,190,.3)';
    b.fillRect(p.x + rand(-26, 26), p.y + rand(-26, 26), rand(2, 5), rand(2, 5));
  }
  // decor: trees and rocks in the free areas
  const tree = (x, y, s) => {
    b.fillStyle = 'rgba(0,0,0,.18)'; b.beginPath(); b.ellipse(x + 6 * s, y + 10 * s, 22 * s, 12 * s, 0, 0, TAU); b.fill();
    b.fillStyle = '#5d4037'; b.fillRect(x - 4 * s, y - 2 * s, 8 * s, 14 * s);
    for (const [ox, oy, r, col] of [[0, -14, 20, '#2e7d32'], [-10, -6, 15, '#388e3c'], [10, -6, 15, '#388e3c'], [0, -20, 12, '#43a047']]) { b.fillStyle = col; b.beginPath(); b.arc(x + ox * s, y + oy * s, r * s, 0, TAU); b.fill(); }
  };
  const rock = (x, y, s) => { b.fillStyle = '#7d8a8f'; b.beginPath(); b.ellipse(x, y, 14 * s, 10 * s, 0.3, 0, TAU); b.fill(); b.fillStyle = '#a3b0b5'; b.beginPath(); b.ellipse(x - 3 * s, y - 3 * s, 7 * s, 5 * s, 0.3, 0, TAU); b.fill(); };
  for (const [x, y, s] of [[230, 210, 1], [250, 450, 0.9], [1050, 200, 1.1], [1060, 440, 0.95], [40, 230, 0.8], [1240, 250, 0.9], [60, 430, 0.9], [1240, 420, 0.8], [560, 60, 0.7], [820, 600, 0.8], [400, 600, 0.75]]) tree(x, y, s);
  for (const [x, y, s] of [[300, 250, 0.8], [1000, 260, 0.7], [180, 420, 0.9], [980, 480, 0.8], [700, 70, 0.6], [1180, 610, 0.7]]) rock(x, y, s);
  // cave entrance
  b.fillStyle = '#4e4036'; b.beginPath(); b.ellipse(8, 130, 46, 52, 0, 0, TAU); b.fill();
  b.fillStyle = '#1b1410'; b.beginPath(); b.ellipse(10, 132, 30, 36, 0, 0, TAU); b.fill();
  // slots
  for (const s of SLOTS) {
    b.fillStyle = 'rgba(0,0,0,.18)'; b.beginPath(); b.roundRect ? b.roundRect(s.x - 31, s.y - 27, 64, 62, 10) : b.rect(s.x - 31, s.y - 27, 64, 62); b.fill();
    b.fillStyle = '#b9ab8f'; b.beginPath(); b.roundRect ? b.roundRect(s.x - 32, s.y - 30, 64, 60, 10) : b.rect(s.x - 32, s.y - 30, 64, 60); b.fill();
    b.fillStyle = '#cfc2a6'; b.beginPath(); b.roundRect ? b.roundRect(s.x - 28, s.y - 27, 56, 52, 8) : b.rect(s.x - 28, s.y - 27, 56, 52); b.fill();
  }
  // bottom bar
  const bar = b.createLinearGradient(0, 620, 0, H); bar.addColorStop(0, '#5b3d22'); bar.addColorStop(1, '#3e2914');
  b.fillStyle = bar; b.fillRect(0, 622, W, H - 622);
  b.fillStyle = '#7a5532'; b.fillRect(0, 618, W, 6);
  bg = c;
}
function drawCastle() {
  const { x, y } = CASTLE, fl = g && g.castleFlash > 0;
  ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(x - 40, y - 34, 90, 84);
  ctx.fillStyle = fl ? '#ffcdd2' : '#9e9e9e'; ctx.fillRect(x - 44, y - 44, 88, 84);
  ctx.fillStyle = fl ? '#ef9a9a' : '#bdbdbd'; ctx.fillRect(x - 40, y - 40, 80, 76);
  for (let i = 0; i < 4; i++) { ctx.fillStyle = fl ? '#ffcdd2' : '#9e9e9e'; ctx.fillRect(x - 44 + i * 25, y - 56, 14, 14); }
  ctx.fillStyle = '#4e342e'; rr(x - 14, y + 4, 28, 36, 12); ctx.fill();
  ctx.fillStyle = '#5d4037'; ctx.fillRect(x - 1, y - 90, 3, 36);
  ctx.fillStyle = '#e53935'; ctx.beginPath(); ctx.moveTo(x + 2, y - 90); ctx.lineTo(x + 30, y - 82); ctx.lineTo(x + 2, y - 74); ctx.fill();
}
function halfDisc(r, c1, c2) {
  ctx.fillStyle = c1; ctx.beginPath(); ctx.arc(0, 0, r, Math.PI / 2, Math.PI * 1.5); ctx.fill();
  ctx.fillStyle = c2; ctx.beginPath(); ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2); ctx.fill();
}
function drawTower(x, y, t, alpha = 1) {
  const d = TT[t.type], fu = !!d.fusion, s = 1 + 0.05 * (t.lv - 1) + (fu ? 0.08 : 0) + (t.pop > 0 ? Math.sin(t.pop / 0.45 * Math.PI) * 0.25 : 0);
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.scale(s, s);
  circle(3, 6, 24, 'rgba(0,0,0,.25)');
  if (fu) {
    // fused towers: split in their parents' colours, with a glowing rim
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
    ctx.strokeStyle = `rgba(255,255,255,${0.25 + 0.35 * pulse})`; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(0, 0, 27, 0, TAU); ctx.stroke();
    halfDisc(24, d.dark, d.dark2);
    ctx.strokeStyle = LV_COL[t.lv - 1]; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, 24, 0, TAU); ctx.stroke();
    halfDisc(18, d.color, d.color2);
  } else {
    circle(0, 0, 24, d.dark);
    ctx.strokeStyle = LV_COL[t.lv - 1]; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, 24, 0, TAU); ctx.stroke();
    circle(0, 0, 18, d.color);
  }
  const rec = t.recoil * 3;
  ctx.save(); ctx.rotate(t.aim);
  if (fu) drawFusionTop(t, rec);
  else if (t.type === 'archer') {
    ctx.strokeStyle = '#4e342e'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.arc(-2 - rec, 0, 13, -1.2, 1.2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-2 - rec + Math.cos(-1.2) * 13, Math.sin(-1.2) * 13); ctx.lineTo(-2 - rec + Math.cos(1.2) * 13, Math.sin(1.2) * 13); ctx.stroke();
    ctx.strokeStyle = '#3e2723'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-8 - rec, 0); ctx.lineTo(14 - rec, 0); ctx.stroke();
  } else if (t.type === 'cannon') {
    ctx.fillStyle = '#37474f'; rr(-4 - rec * 2, -6, 26, 12, 4); ctx.fill();
    circle(0, 0, 9, '#455a64');
  } else if (t.type === 'frost') {
    ctx.rotate(-t.aim + performance.now() / 900);
    ctx.fillStyle = '#e1f5fe'; ctx.beginPath();
    for (let k = 0; k < 6; k++) { const a = k * TAU / 6; ctx.lineTo(Math.cos(a) * 12, Math.sin(a) * 12); ctx.lineTo(Math.cos(a + TAU / 12) * 5, Math.sin(a + TAU / 12) * 5); }
    ctx.fill();
  } else {
    circle(0, 0, 10, '#e1bee7'); circle(0, 0, 6, '#fff');
    ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1.5;
    const ph = performance.now() / 120;
    for (let k = 0; k < 3; k++) { const a = ph + k * TAU / 3; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 7, Math.sin(a) * 7); ctx.lineTo(Math.cos(a + 0.4) * 14, Math.sin(a + 0.4) * 14); ctx.stroke(); }
  }
  ctx.restore();
  if (fu) { ctx.fillStyle = '#fff'; ctx.font = '900 13px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = 3; ctx.strokeText('✦', -17, -16); ctx.fillText('✦', -17, -16); }
  // level badge
  circle(16, 15, 10, '#2b2b2b'); circle(16, 15, 8.5, LV_COL[t.lv - 1]);
  ctx.fillStyle = t.lv === 1 || t.lv === 8 ? '#222' : '#fff'; ctx.font = '900 12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(t.lv, 16, 15.5);
  ctx.restore();
}
// the turret on top of a fused tower (already rotated to its aim)
function drawFusionTop(t, rec) {
  const now = performance.now();
  if (t.type === 'sticky') {
    ctx.strokeStyle = '#4e342e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(-4 - rec, 0, 12, -1.1, 1.1); ctx.stroke();
    circle(6 - rec, 0, 7, '#263238'); circle(4 - rec, -2, 2, '#78909c');
    ctx.strokeStyle = '#8d6e63'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(12 - rec, 0); ctx.lineTo(16 - rec, -3); ctx.stroke();
    circle(16 - rec, -3, 2.2, Math.sin(now / 90) > 0 ? '#ff5252' : '#ffd54a');
  } else if (t.type === 'fsniper') {
    ctx.fillStyle = '#37474f'; rr(-8 - rec * 2, -3.5, 34, 7, 2); ctx.fill();
    ctx.fillStyle = '#b2ebf2'; rr(20 - rec * 2, -4.5, 8, 9, 2); ctx.fill();
    ctx.fillStyle = '#263238'; rr(-2 - rec, -9, 10, 5, 2); ctx.fill();
    circle(0, 0, 7, '#e0f7fa');
  } else if (t.type === 'lance') {
    ctx.strokeStyle = '#4e342e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(-3 - rec, 0, 12, -1.15, 1.15); ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-8 - rec, 0); ctx.lineTo(-1 - rec, -4); ctx.lineTo(5 - rec, 3); ctx.lineTo(18 - rec, 0); ctx.stroke();
    circle(18 - rec, 0, 3, '#e1bee7');
  } else if (t.type === 'glacier' || t.type === 'thunder') {
    const ice = t.type === 'glacier';
    ctx.fillStyle = ice ? '#4fa3c7' : '#6a4f8a'; rr(-4 - rec * 2, -8, 24, 16, 5); ctx.fill();
    circle(0, 0, 10, ice ? '#b3e5fc' : '#ce93d8'); circle(0, 0, 5, '#fff');
    if (!ice) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; const a = now / 100; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 6, Math.sin(a) * 6); ctx.lineTo(Math.cos(a + 0.5) * 13, Math.sin(a + 0.5) * 13); ctx.stroke(); }
  } else if (t.type === 'blizzard') {
    ctx.rotate(-t.aim + now / 500);
    ctx.fillStyle = '#e1f5fe'; ctx.beginPath();
    for (let k = 0; k < 6; k++) { const a = k * TAU / 6; ctx.lineTo(Math.cos(a) * 14, Math.sin(a) * 14); ctx.lineTo(Math.cos(a + TAU / 12) * 5, Math.sin(a + TAU / 12) * 5); }
    ctx.fill();
    ctx.strokeStyle = 'rgba(206,147,216,.9)'; ctx.lineWidth = 2;
    for (let k = 0; k < 3; k++) { const a = k * TAU / 3; ctx.beginPath(); ctx.arc(0, 0, 16, a, a + 0.9); ctx.stroke(); }
  }
}
function drawEnemy(e) {
  const sq = 1 + Math.sin(e.bob) * 0.08, fl = e.flash > 0, slow = e.slowT > 0 || e.chill > 0 || e.freezeT > 0;
  const body = fl ? '#fff' : slow ? '#9fdcf5' : e.color, dark = fl ? '#fff' : slow ? '#4aa3c9' : e.dark;
  ctx.save(); ctx.translate(e.x, e.y);
  ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.beginPath(); ctx.ellipse(2, e.r * 0.7, e.r, e.r * 0.4, 0, 0, TAU); ctx.fill();
  const r = e.r;
  if (e.type === 'slime' || e.type === 'brute') {
    ctx.scale(1 / sq, sq);
    ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.85, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = dark; ctx.lineWidth = 2.5; ctx.stroke();
    circle(-r * 0.3, -r * 0.2, r * 0.18, '#fff'); circle(r * 0.3, -r * 0.2, r * 0.18, '#fff');
    circle(-r * 0.27, -r * 0.18, r * 0.09, '#111'); circle(r * 0.33, -r * 0.18, r * 0.09, '#111');
    if (e.type === 'brute') { ctx.strokeStyle = '#1b2e0b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-r * 0.5, -r * 0.5); ctx.lineTo(-r * 0.1, -r * 0.35); ctx.moveTo(r * 0.5, -r * 0.5); ctx.lineTo(r * 0.1, -r * 0.35); ctx.stroke(); }
  } else if (e.type === 'runner') {
    ctx.translate(0, Math.sin(e.bob * 1.5) * 2);
    ctx.fillStyle = body; ctx.beginPath(); ctx.moveTo(-r * 1.3, -r * 0.5); ctx.lineTo(-r * 0.6, -r * 0.1); ctx.lineTo(-r * 0.6, -r * 0.6); ctx.fill();
    ctx.beginPath(); ctx.moveTo(r * 1.3, -r * 0.5); ctx.lineTo(r * 0.6, -r * 0.1); ctx.lineTo(r * 0.6, -r * 0.6); ctx.fill();
    circle(0, 0, r, body); ctx.strokeStyle = dark; ctx.lineWidth = 2; ctx.stroke();
    circle(-r * 0.35, -r * 0.15, r * 0.2, '#ff5252'); circle(r * 0.35, -r * 0.15, r * 0.2, '#ff5252');
  } else if (e.type === 'knight') {
    circle(0, 0, r, body); ctx.strokeStyle = dark; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = dark; ctx.fillRect(-r * 0.6, -r * 0.2, r * 1.2, r * 0.22);
    ctx.fillStyle = '#c62828'; ctx.beginPath(); ctx.moveTo(-2, -r); ctx.lineTo(2, -r); ctx.lineTo(0, -r * 1.6); ctx.fill();
    ctx.fillStyle = fl ? '#fff' : '#795548'; rr(r * 0.55, -r * 0.1, r * 0.55, r * 0.9, 3); ctx.fill();
  } else if (e.type === 'ogre') {
    ctx.scale(1 / sq * 1.02, sq);
    circle(0, 0, r, body); ctx.strokeStyle = dark; ctx.lineWidth = 4; ctx.stroke();
    circle(-r * 0.32, -r * 0.2, r * 0.13, '#ffeb3b'); circle(r * 0.32, -r * 0.2, r * 0.13, '#ffeb3b');
    ctx.fillStyle = '#fff8e1';
    ctx.beginPath(); ctx.moveTo(-r * 0.35, r * 0.25); ctx.lineTo(-r * 0.25, r * 0.6); ctx.lineTo(-r * 0.15, r * 0.25); ctx.fill();
    ctx.beginPath(); ctx.moveTo(r * 0.35, r * 0.25); ctx.lineTo(r * 0.25, r * 0.6); ctx.lineTo(r * 0.15, r * 0.25); ctx.fill();
    ctx.fillStyle = '#ffc107'; ctx.beginPath(); ctx.moveTo(-r * 0.5, -r * 0.75); ctx.lineTo(-r * 0.5, -r * 1.2); ctx.lineTo(-r * 0.25, -r * 0.95); ctx.lineTo(0, -r * 1.25); ctx.lineTo(r * 0.25, -r * 0.95); ctx.lineTo(r * 0.5, -r * 1.2); ctx.lineTo(r * 0.5, -r * 0.75); ctx.fill();
  }
  ctx.restore();
  if (e.hp < e.maxHp) {
    const w = e.boss ? 60 : 26, y = e.y - e.r - (e.boss ? 26 : 9);
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(e.x - w / 2, y, w, 4);
    ctx.fillStyle = e.boss ? '#ff5252' : '#76ff03'; ctx.fillRect(e.x - w / 2, y, w * Math.max(0, e.hp / e.maxHp), 4);
  }
}
function hudText(str, x, y, size, color = '#fff', align = 'left', weight = 800) {
  ctx.font = `${weight} ${size}px system-ui,-apple-system,"Segoe UI",sans-serif`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(3, size / 6); ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineJoin = 'round';
  ctx.strokeText(str, x, y); ctx.fillStyle = color; ctx.fillText(str, x, y);
}
function slotAt(x, y, rad = 38) {
  let best = null, bd = rad * rad;
  for (const s of SLOTS) { const d = (s.x - x) ** 2 + (s.y - y) ** 2; if (d < bd) { bd = d; best = s; } }
  return best;
}
const overTrash = (x, y) => (x - TRASH.x) ** 2 + (y - TRASH.y) ** 2 < (TRASH.r + 10) ** 2;

function render() {
  ctx.setTransform(viewScale * dpr, 0, 0, viewScale * dpr, 0, 0);
  const sh = g && g.shake ? g.shake : 0;
  ctx.save();
  if (sh) ctx.translate(rand(-1, 1) * sh, rand(-1, 1) * sh);
  ctx.drawImage(bg, 0, 0);
  drawCastle();
  if (g) {
    // merge hints while dragging
    if (drag && drag.moved) {
      const dt = drag.slot.tower;
      for (const s of SLOTS) if (s !== drag.slot && canMerge(s.tower, dt)) {
        ctx.strokeStyle = `rgba(255,235,59,${0.55 + 0.35 * Math.sin(performance.now() / 120)})`; ctx.lineWidth = 4;
        rr(s.x - 33, s.y - 31, 66, 62, 11); ctx.stroke();
      }
      // fusion targets glow cyan and show what they would make
      for (const s of SLOTS) {
        const fr = s !== drag.slot && fuseResult(s.tower, dt); if (!fr) continue;
        ctx.strokeStyle = `rgba(128,222,234,${0.6 + 0.35 * Math.sin(performance.now() / 120)})`; ctx.lineWidth = 4; ctx.setLineDash([8, 5]);
        rr(s.x - 33, s.y - 31, 66, 62, 11); ctx.stroke(); ctx.setLineDash([]);
        const near = Math.hypot(pointer.x - s.x, pointer.y - s.y) < 40;
        hudText('✦ ' + TT[fr].name, s.x, s.y - 42, near ? 15 : 12, near ? '#fff' : '#b2ebf2', 'center', 900);
      }
    }
    // range circle for selected / dragged tower
    const rs = drag && drag.moved ? null : selected;
    if (rs && rs.tower) {
      const st = towerStats(rs.tower);
      ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(rs.x, rs.y, st.range, 0, TAU); ctx.fill(); ctx.stroke();
    }
    for (const s of SLOTS) if (s.tower && !(drag && drag.moved && drag.slot === s)) drawTower(s.x, s.y, s.tower);
    for (const f of fields) {
      const a = 1 - f.t / f.life;
      ctx.fillStyle = `rgba(186,104,200,${0.22 * a})`; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = `rgba(243,229,245,${0.75 * a})`; ctx.lineWidth = 1.6;
      for (let k = 0; k < 3; k++) {
        const an = rand(0, TAU), r0 = rand(0, f.r * 0.4), r1 = rand(f.r * 0.6, f.r);
        ctx.beginPath(); ctx.moveTo(f.x + Math.cos(an) * r0, f.y + Math.sin(an) * r0);
        ctx.lineTo(f.x + Math.cos(an + rand(-0.4, 0.4)) * (r0 + r1) / 2, f.y + Math.sin(an + rand(-0.4, 0.4)) * (r0 + r1) / 2);
        ctx.lineTo(f.x + Math.cos(an) * r1, f.y + Math.sin(an) * r1); ctx.stroke();
      }
    }
    for (const e of enemies) {
      drawEnemy(e);
      if (e.freezeT > 0) { ctx.fillStyle = 'rgba(225,245,254,.5)'; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2; rr(e.x - e.r - 4, e.y - e.r - 6, e.r * 2 + 8, e.r * 2 + 8, 5); ctx.fill(); ctx.stroke(); }
    }
    for (const s of shots) {
      if (s.kind === 'arrow') {
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.a || 0);
        ctx.strokeStyle = '#4e342e'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(4, 0); ctx.stroke();
        ctx.fillStyle = '#cfd8dc'; ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(2, -3); ctx.lineTo(2, 3); ctx.fill();
        ctx.restore();
      } else if (s.kind === 'ice') {
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.a || 0);
        ctx.fillStyle = '#e1f5fe'; ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-5, -4); ctx.lineTo(-8, 0); ctx.lineTo(-5, 4); ctx.fill();
        ctx.restore();
      } else if (s.kind === 'ball') {
        const c = s.fx === 'glacier' ? '#4fc3f7' : s.fx === 'thunder' ? '#8e44ad' : '#263238';
        circle(s.x, s.y + 4, 5, 'rgba(0,0,0,.2)'); circle(s.x, s.y - (s.h || 0), 6.5, c); circle(s.x - 2, s.y - (s.h || 0) - 2, 2, '#e1f5fe');
      } else if (s.kind === 'sticky' || s.kind === 'stuck') {
        const blink = s.kind === 'stuck' && Math.sin(s.t * (8 + s.t * 30)) > 0;
        circle(s.x, s.y, 6, '#263238'); circle(s.x - 1.5, s.y - 1.5, 1.8, '#90a4ae');
        circle(s.x + 3, s.y - 5, 2.4, blink ? '#ff1744' : '#ffd54a');
        if (s.kind === 'stuck') { ctx.fillStyle = 'rgba(205,220,57,.7)'; ctx.beginPath(); ctx.ellipse(s.x, s.y + 5, 6, 2.5, 0, 0, TAU); ctx.fill(); }
      }
    }
    for (const z of zaps) {
      if (z.tracer) {
        const a = 1 - z.t / z.life, [p0, p1] = z.pts;
        ctx.strokeStyle = `rgba(178,235,242,${0.6 * a})`; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
        ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
        continue;
      }
      for (const [col, lw] of z.lance ? [['rgba(206,147,216,.6)', 12], ['#fff', 3.5]] : [['rgba(206,147,216,.55)', 7], ['#fff', 2.2]]) {
        ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath();
        for (let i = 0; i < z.pts.length - 1; i++) {
          const a = z.pts[i], b = z.pts[i + 1]; if (i === 0) ctx.moveTo(a.x, a.y);
          const nk = z.lance ? 10 : 4;
          for (let k = 1; k <= nk; k++) { const f = k / nk; ctx.lineTo(lerp(a.x, b.x, f) + (k < nk ? rand(-7, 7) : 0), lerp(a.y, b.y, f) + (k < nk ? rand(-7, 7) : 0)); }
        }
        ctx.stroke();
      }
    }
    for (const p of parts) {
      const f = p.t / p.life;
      if (p.ring) { ctx.strokeStyle = p.color; ctx.globalAlpha = 1 - f; ctx.lineWidth = 5 * (1 - f) + 1; ctx.beginPath(); ctx.arc(p.x, p.y, lerp(p.r0, p.r1, Math.sqrt(f)), 0, TAU); ctx.stroke(); }
      else { ctx.globalAlpha = 1 - f; ctx.fillStyle = p.color; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); }
    }
    ctx.globalAlpha = 1;
    // trash / sell zone
    if (!hideHud) {
      const hot = drag && drag.moved && overTrash(pointer.x, pointer.y);
      circle(TRASH.x, TRASH.y, TRASH.r, hot ? '#e53935' : 'rgba(0,0,0,.35)');
      ctx.font = '28px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText('🗑', TRASH.x, TRASH.y - 4);
      hudText(drag && drag.moved ? 'Sell +' + sellValue(drag.slot.tower) : 'Sell', TRASH.x + 52, TRASH.y, 15, hot ? '#ffcdd2' : '#e8dcc8');
    }
    // dragged tower on top
    if (drag && drag.moved && drag.slot.tower) drawTower(pointer.x, pointer.y, drag.slot.tower, 0.92);
    for (const t of texts) {
      ctx.globalAlpha = clamp(1 - (t.t / t.life) ** 3, 0, 1);
      hudText(t.str, t.x, t.y, t.size, t.color, 'center', 900);
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  if (g && !hideHud && state !== 'menu' && state !== 'shop') drawHUD();
}
function drawHUD() {
  ctx.fillStyle = 'rgba(0,0,0,.35)'; rr(12, 10, 470, 44, 12); ctx.fill();
  hudText('WAVE ' + Math.max(1, g.wave), 30, 32, 24, '#fff', 'left', 900);
  hudText('❤ ' + g.lives, 175, 32, 22, g.lives <= 5 ? '#ff5252' : '#ff8a80', 'left', 900);
  hudText('🪙 ' + g.gold, 290, 32, 22, '#ffd54a', 'left', 900);
  if (!g.inWave && g.breakT > 0 && state === 'play') hudText('Next wave in ' + Math.ceil(g.breakT), W / 2, 84, 20, '#fff', 'center', 800);
  if (g.banner) {
    const b = g.banner, f = b.t / b.life, a = f < 0.15 ? f / 0.15 : f > 0.8 ? (1 - f) / 0.2 : 1;
    ctx.globalAlpha = clamp(a, 0, 1); hudText(b.text, W / 2, 300, 46 * (f < 0.15 ? 1.25 - 0.25 * f / 0.15 : 1), '#ffd54a', 'center', 900); ctx.globalAlpha = 1;
  }
  // selected tower info card
  if (selected && selected.tower && !(drag && drag.moved)) {
    const t = selected.tower, st = towerStats(t), d = TT[t.type], ml = maxLv(t.type);
    const canFuse = !d.fusion && t.lv >= FUSE_MIN && t.lv <= FUSE_MAX;
    const cw = 300, ch = canFuse ? 106 : 88;
    const x = clamp(selected.x - cw / 2, 10, W - cw - 10), y = selected.y < 300 ? selected.y + 40 : selected.y - ch - 40;
    ctx.fillStyle = 'rgba(20,14,6,.88)'; rr(x, y, cw, ch, 10); ctx.fill();
    hudText((d.fusion ? '✦ ' : '') + d.name + '  Lv ' + t.lv, x + 12, y + 18, 17, LV_COL[t.lv - 1], 'left', 900);
    hudText(d.desc, x + 12, y + 41, 13, '#e8dcc8', 'left', 600);
    const dmgTxt = t.type === 'thunder' ? 'Damage ' + Math.round(st.dmg) + ' + field' : t.type === 'blizzard' ? 'Damage ' + Math.round(st.dmg) + ' to all in range' : 'Damage ' + Math.round(st.dmg);
    hudText(dmgTxt + '  ·  ' + st.rate.toFixed(2) + '/s', x + 12, y + 61, 13, '#fff', 'left', 700);
    hudText(t.lv < ml ? 'Merge with another Lv ' + t.lv + ' ' + d.name : d.fusion ? 'MAX LEVEL (fusions stop at Lv ' + FUSE_MAX + ')' : 'MAX LEVEL', x + 12, y + 78, 12, '#ffd54a', 'left', 700);
    if (canFuse) hudText('✦ or fuse with a different Lv ' + t.lv + ' tower', x + 12, y + 96, 12, '#80deea', 'left', 700);
  }
  // first-run tips
  if (g.tips && state === 'play') {
    let tip = null;
    if (g.summons === 0) tip = 'Tap SUMMON to build a tower';
    else if (!g.firstMerge && hasMergePair()) tip = 'Drag a tower onto a matching one (same type and level) to merge it';
    else if (g.wave <= 2 && g.summons < 4) tip = 'Spend gold on more towers. Enemies must not reach the castle!';
    if (tip) {
      ctx.font = '700 19px system-ui'; const tw = ctx.measureText(tip).width + 40;
      ctx.fillStyle = 'rgba(20,12,4,.78)'; rr(W / 2 - tw / 2, 566, tw, 38, 19); ctx.fill();
      hudText(tip, W / 2, 585, 19, '#fff', 'center', 700);
    }
  }
}
function hasMergePair() {
  for (let i = 0; i < SLOTS.length; i++) for (let j = i + 1; j < SLOTS.length; j++) if (canMerge(SLOTS[i].tower, SLOTS[j].tower)) return true;
  return false;
}

// ---------------------------------------------------------------------
//  Input
// ---------------------------------------------------------------------
function setPointer(e) {
  const r = canvas.getBoundingClientRect();
  pointer.x = (e.clientX - r.left) / r.width * W; pointer.y = (e.clientY - r.top) / r.height * H;
}
canvas.addEventListener('pointerdown', e => {
  setPointer(e); pointer.down = true;
  if (state !== 'play') return;
  const s = slotAt(pointer.x, pointer.y, 34);
  if (s && s.tower) { drag = { slot: s, sx: pointer.x, sy: pointer.y, moved: false }; try { canvas.setPointerCapture(e.pointerId); } catch (err) { } }
  else selected = null;
});
canvas.addEventListener('pointermove', e => {
  setPointer(e);
  if (drag && !drag.moved && Math.hypot(pointer.x - drag.sx, pointer.y - drag.sy) > 10) { drag.moved = true; selected = null; }
});
function endDrag() {
  pointer.down = false;
  if (!drag || state !== 'play') { drag = null; return; }
  const src = drag.slot; const moved = drag.moved; drag = null;
  if (!src.tower) return;
  if (!moved) { selected = selected === src ? null : src; return; }
  if (overTrash(pointer.x, pointer.y)) {
    const v = sellValue(src.tower); g.gold += v; src.tower = null; Sound.play('sell');
    flashText(TRASH.x + 40, TRASH.y - 40, '+' + v + ' 🪙', '#ffd54a'); updateBar(); return;
  }
  const dst = slotAt(pointer.x, pointer.y);
  if (!dst || dst === src) return;
  if (canMerge(dst.tower, src.tower)) mergeInto(dst, src);
  else if (fuseResult(dst.tower, src.tower)) fuseInto(dst, src);
  else { const tmp = dst.tower; dst.tower = src.tower; src.tower = tmp; dst.tower.pop = 0.2; Sound.play('move'); }
  updateBar();
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', () => { drag = null; pointer.down = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('keydown', e => {
  Sound.init();
  if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'KeyM') toggleMute();
  if (state === 'play') {
    if (e.code === 'Space') summon();
    else if (e.code === 'KeyU') upgradeSummons();
    else if (e.code === 'KeyF') toggleSpeed();
    else if (e.code === 'KeyP' || e.code === 'Escape') pauseGame();
  } else if (state === 'paused' && (e.code === 'KeyP' || e.code === 'Space')) resumeGame();
});
window.addEventListener('pointerdown', () => Sound.init(), true);
window.addEventListener('blur', () => { drag = null; });
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(true); Sound.setHidden(document.hidden); });
$('ui').addEventListener('click', e => { const b = e.target.closest('button'); if (b && b.id !== 'muteBtn' && b.id !== 'summonBtn' && b.id !== 'sumUpBtn') Sound.play('click'); });

function toggleSpeed() { if (!g) return; g.speed = g.speed === 1 ? 2 : 1; updateBar(); }
function toggleMute() { Sound.init(); Sound.toggleMute(); updateMuteBtn(); }
function updateMuteBtn() { $('muteBtn').textContent = Sound.muted ? '🔇' : '🔊'; }
const portraitMQ = window.matchMedia('(orientation: portrait) and (pointer: coarse)');
function checkOrientation() { if (portraitMQ.matches) pauseGame(); }
if (portraitMQ.addEventListener) portraitMQ.addEventListener('change', checkOrientation); else if (portraitMQ.addListener) portraitMQ.addListener(checkOrientation);

$('summonBtn').onclick = summon;
$('sumUpBtn').onclick = upgradeSummons;
$('speedBtn').onclick = toggleSpeed;
$('giftBtn').onclick = useGift;
$('muteBtn').onclick = toggleMute;
$('pauseBtn').onclick = () => pauseGame();
$('resumeBtn').onclick = resumeGame;
$('quitBtn').onclick = () => { bank(); g = null; setState('menu'); };
$('continueBtn').onclick = () => { bank(); g = null; setState('menu'); };
$('reviveBtn').onclick = revive;
$('shopBtn').onclick = () => setState('shop');
$('shopBack').onclick = () => setState('menu');
$('playBtn').onclick = () => { $('playBtn').disabled = true; Platform.commercialBreak().then(() => { $('playBtn').disabled = false; newGame(); checkOrientation(); }); };
updateMuteBtn();

// ---------------------------------------------------------------------
//  Main loop
// ---------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.05) dt = 0.05;
  if (state === 'play' && g) { for (let i = 0; i < g.speed && state === 'play'; i++) update(dt); }
  render();
  requestAnimationFrame(frame);
}
(async function boot() {
  buildBackground();
  await Platform.init();
  setState('menu');
  Platform.loadingFinished();
  requestAnimationFrame(t => { last = t; frame(t); });
  // DEBUG-START (removed from release builds by build.py)
  window.__mb = {
    get g() { return g; }, get state() { return state; }, SLOTS, enemies, newGame, summon, towerStats, makeTower, fuseInto, fuseResult, TT, noUps: false, noFuse: false,
    // simple bot: summon whenever possible, merge the lowest pair, sell the weakest when full
    botStep() {
      if (state !== 'play') return;
      const up = this.noUps ? null : nextSummonUp(), towers = SLOTS.filter(s => s.tower).length;
      if (up && g.gold >= up[1]) upgradeSummons();
      const reserve = up && g.wave >= (this.saveAt || { 2: 4, 3: 11, 4: 21 })[up[0]] ? up[1] : 0;   // from these waves on, save for better summons
      while (g.gold - reserve >= summonCost() && emptySlots().length) summon();
      let merged = true;
      while (merged) {
        merged = false;
        const ts = SLOTS.filter(s => s.tower).sort((a, b) => a.tower.lv - b.tower.lv);
        outer: for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) if (canMerge(ts[i].tower, ts[j].tower)) { mergeInto(ts[j], ts[i]); merged = true; break outer; }
      }
      // fuse Lv 4-5 towers that have no identical partner
      if (!this.noFuse) {
        const lone = SLOTS.filter(s => s.tower && !TT[s.tower.type].fusion && s.tower.lv >= FUSE_MIN && s.tower.lv <= FUSE_MAX && !SLOTS.some(o => canMerge(o.tower, s.tower)));
        for (let i = 0; i < lone.length; i++) for (let j = i + 1; j < lone.length; j++) if (lone[i].tower && lone[j].tower && fuseResult(lone[i].tower, lone[j].tower)) fuseInto(lone[j], lone[i]);
      }
      if (!emptySlots().length && g.gold >= summonCost() * 1.5) {
        const low = SLOTS.filter(s => s.tower).sort((a, b) => a.tower.lv - b.tower.lv)[0];
        if (low && low.tower.lv <= Math.max(2, g.sumLv)) { g.gold += sellValue(low.tower); low.tower = null; }
      }
    },
    // still scene for store thumbnails (no HUD)
    stage() {
      newGame(); setState('paused');
      for (const el of document.querySelectorAll('.screen')) el.classList.remove('show');
      $('bar').style.display = 'none'; $('pauseBtn').style.display = 'none'; $('muteBtn').style.display = 'none';
      hideHud = true; g.wave = 10;
      const layout = { 1: ['storm', 5], 2: ['archer', 3], 4: ['cannon', 4], 6: ['frost', 2], 9: ['archer', 6], 11: ['frost', 3], 13: ['storm', 4],
        17: ['cannon', 2], 18: ['archer', 4], 20: ['storm', 3], 22: ['cannon', 5], 26: ['frost', 4], 28: ['archer', 2], 29: ['cannon', 3] };
      for (const k in layout) { SLOTS[k].tower = makeTower(layout[k][0], layout[k][1]); SLOTS[k].tower.pop = 0; }
      const kinds = ['slime', 'runner', 'knight', 'brute', 'slime', 'knight', 'slime', 'runner'];
      for (let i = 0; i < 26; i++) { const e = spawnEnemy(kinds[i % kinds.length], 260 + i * 105 + rand(-15, 15)); e.hp = e.maxHp * rand(0.35, 1); }
      const boss = spawnEnemy('ogre', 2280); boss.hp = boss.maxHp * 0.6;
      for (const s of SLOTS) if (s.tower) { const t = targetFor(s.x, s.y, towerStats(s.tower).range); if (t) { s.tower.aim = Math.atan2(t.y - s.y, t.x - s.x); if (s.tower.type !== 'storm') fire(s, s.tower, towerStats(s.tower), t); } }
      for (const sh of shots) { if (sh.kind === 'ball') { sh.t = 0.5; sh.x = lerp(sh.x0, sh.tx, 0.5); sh.y = lerp(sh.y0, sh.ty, 0.5); sh.h = 50; } else { sh.x = lerp(sh.x, sh.tgt.x, 0.55); sh.y = lerp(sh.y, sh.tgt.y, 0.55); sh.a = Math.atan2(sh.tgt.y - sh.y, sh.tgt.x - sh.x); } }
      for (const k of [1, 13, 20]) { const s = SLOTS[k], t = targetFor(s.x, s.y, 200); if (t) fire(s, s.tower, towerStats(s.tower), t); }
      for (const z of zaps) z.t = 0;
      for (const [x, y] of [[700, 330], [400, 530]]) { parts.push({ ring: true, x, y, t: 0.08, life: 0.3, r0: 8, r1: 70, color: '#ffb74d' }); burst(x, y, '#ff9f43', 22, 120); }
      for (const p of parts) if (!p.ring) { p.x += p.vx * 0.15; p.y += p.vy * 0.15; p.t = 0; p.life = 1; }
      enemies.forEach(e => e.flash = 0);
    },
    snap(w = 1920, zoom = 1, cx = W / 2, cy = H / 2) {
      const vs = viewScale, d = dpr;
      dpr = 1; canvas.width = w; canvas.height = Math.round(w * H / W);
      viewScale = w / W * zoom;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const realRender = ctx.setTransform.bind(ctx);
      // shift so (cx, cy) lands in the image centre
      ctx.setTransform = (a, b, c2, d2) => realRender(a, b, c2, d2, w / 2 - cx * viewScale, canvas.height / 2 - cy * viewScale);
      render();
      ctx.setTransform = realRender;
      const url = canvas.toDataURL('image/png');
      viewScale = vs; dpr = d; resize();
      return url;
    },
    sim(n, dt = 1 / 60, bot = true) {
      for (let i = 0; i < n && state === 'play'; i++) { if (bot && i % 15 === 0) this.botStep(); update(dt); }
      return state;
    },
  };
  // DEBUG-END
})();
})();
