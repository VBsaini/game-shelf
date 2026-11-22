'use strict';
(() => {
// =====================================================================
//  Gravity Golf
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
  get(k, d) { try { const v = localStorage.getItem('gravity_golf_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('gravity_golf_' + k, JSON.stringify(v)); } catch (e) { } },
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

const GP = window.GP, HOLES = window.GG_HOLES;
const CHAPTERS = [['Inner System', 0], ['Outer Rim', 6], ['Deep Space', 12]];

// ---------------------------------------------------------------------
//  Sound
// ---------------------------------------------------------------------
{
  const { tone, noise, N } = Sound;
  Sound.define({
    click: () => tone('triangle', 700, 900, 0.06, 0.12),
    swing: p => { noise(0.18, 0.12 + 0.18 * p, 'bandpass', 1800, 600, 0, 1.2); tone('sine', 300 + 400 * p, 140, 0.12, 0.18); },
    bounce: v => tone('sine', 180 + Math.min(1, v / 600) * 260, 90, 0.14, 0.08 + Math.min(1, v / 600) * 0.2),
    sink: () => { const t = Sound.now(); tone('sine', N(76), N(76), 0.12, 0.2); [79, 84, 88, 91].forEach((n, i) => tone('triangle', N(n), N(n), 0.3, 0.13, t + 0.12 + i * 0.07)); },
    ace: () => { const t = Sound.now(); [72, 76, 79, 84, 88, 91, 96].forEach((n, i) => tone('triangle', N(n), N(n), 0.35, 0.13, t + i * 0.06)); },
    worm: () => { tone('sine', 300, 1500, 0.25, 0.12); noise(0.3, 0.06, 'bandpass', 800, 4000, 0, 2); },
    out: () => tone('triangle', 500, 120, 0.45, 0.15),
    void: () => { tone('sine', 120, 35, 0.8, 0.35); noise(0.7, 0.12, 'lowpass', 600, 60); },
    aim: () => tone('sine', 900, 900, 0.03, 0.03),
    star: i => tone('triangle', N(84 + i * 4), N(84 + i * 4), 0.25, 0.14),
  }, (step, t, mode) => {
    // slow ambient pads with a soft arpeggio
    const STEP = 0.5, CH = [[57, 64, 69, 72], [53, 60, 65, 69], [55, 62, 67, 71], [52, 59, 64, 67]];
    const bar = Math.floor(step / 8) % 4, ch = CH[bar], s = step % 8, bus = Sound.musBus;
    if (s === 0) for (const n of ch) tone('sine', N(n - 12), N(n - 12), STEP * 8.5, 0.03, t, bus);
    if (s % 2 === 1) { const n = ch[(step >> 1) % 4] + 12; tone('triangle', N(n), N(n), STEP * 1.6, 0.018, t, bus); }
    return STEP;
  });
}

// ---------------------------------------------------------------------
//  State
// ---------------------------------------------------------------------
let state = 'menu';                      // menu | holes | play | paused | done
let hn = 0, hole = null, ball = null, T = 0, strokes = 0, shotStart = null;
let flight = null;                       // { path, events, res, t, i }
let aim = null;                          // { ang, pow } while aiming (keyboard keeps it between frames)
let loadId = 0, drag = null, guideShots = 0, msg = null, trail = [], parts = [], sunk = 0, hideHud = false;
const best = Store.get('best', {});      // hole index -> fewest strokes
const starsOf = (n, s) => s <= HOLES[n].par ? 3 : s <= HOLES[n].par + 1 ? 2 : 1;
const totalStars = () => Object.keys(best).reduce((a, k) => a + starsOf(+k, best[k]), 0);
const unlocked = () => Math.min(HOLES.length - 1, Store.get('unlocked', 0));

function loadHole(n) {
  loadId++; pendingDone = false; hn = n; hole = HOLES[n]; T = 0; strokes = 0; flight = null; drag = null; msg = null; trail = []; parts = []; sunk = 0;
  ball = { x: hole.tee[0], y: hole.tee[1] }; shotStart = { ...ball };
  aim = { ang: Math.atan2(hole.cup[1] - ball.y, hole.cup[0] - ball.x), pow: 0.5, key: false };
  setState('play');
}

// ---------------------------------------------------------------------
//  Shooting
// ---------------------------------------------------------------------
function previewPath(a) {
  const r = GP.shoot(hole, ball.x, ball.y, Math.cos(a.ang) * GP.MAX_SPEED * a.pow, Math.sin(a.ang) * GP.MAX_SPEED * a.pow, T, { record: true, maxT: guideShots > 0 ? 6 : 1.1 });
  return r.path;
}
function shoot(a) {
  if (state !== 'play' || flight || a.pow < 0.04) return;
  const r = GP.shoot(hole, ball.x, ball.y, Math.cos(a.ang) * GP.MAX_SPEED * a.pow, Math.sin(a.ang) * GP.MAX_SPEED * a.pow, T, { record: true });
  strokes++; shotStart = { ...ball }; if (guideShots > 0) guideShots--;
  flight = { path: r.path, events: r.events, res: r, t: 0, i: 0, ei: 0, T0: T };
  trail = [];
  Sound.play('swing', 0, a.pow);
}
function finishShot() {
  const r = flight.res; flight = null; T = r.T;
  if (r.result === 'sink') {
    ball = { x: hole.cup[0], y: hole.cup[1] }; sunk = 0.001;
    Sound.play(strokes === 1 ? 'ace' : 'sink');
    for (let k = 0; k < 40; k++) parts.push({ x: ball.x, y: ball.y, vx: rand(-260, 260), vy: rand(-260, 260), t: 0, life: rand(0.5, 1.1), c: pick(['#7cf0c5', '#ffd166', '#fff', '#8ab4ff']) });
    const id = loadId; setTimeout(() => { if (id === loadId) holeDone(); }, 900);
    return;
  }
  if (r.result === 'out' || r.result === 'void') {
    strokes++;                           // penalty stroke, back to where the shot started
    ball = { ...shotStart };
    showMsg(r.result === 'out' ? 'Lost in space! +1 stroke' : 'Swallowed by the black hole! +1 stroke');
    Sound.play(r.result);
  } else ball = { x: r.x, y: r.y };
  aim = { ang: Math.atan2(hole.cup[1] - ball.y, hole.cup[0] - ball.x), pow: aim ? aim.pow : 0.5, key: false };
}
function scoreName(s, par) {
  if (s === 1) return 'HOLE IN ONE!';
  const d = s - par;
  return d <= -2 ? 'EAGLE!' : d === -1 ? 'BIRDIE!' : d === 0 ? 'PAR' : d === 1 ? 'BOGEY' : d === 2 ? 'DOUBLE BOGEY' : '+' + d;
}
let pendingDone = false;
function holeDone() {
  if (state !== 'play') { pendingDone = true; return; }   // paused during the sink: finish when play resumes
  pendingDone = false;
  const prev = best[hn], st = starsOf(hn, strokes);
  if (!prev || strokes < prev) { best[hn] = strokes; Store.set('best', best); }
  Store.set('unlocked', Math.max(Store.get('unlocked', 0), hn + 1));
  $('scoreName').textContent = scoreName(strokes, hole.par);
  $('stars').innerHTML = [0, 1, 2].map(i => `<span class="${i < st ? '' : 'off'}">★</span>`).join('');
  for (let i = 0; i < st; i++) setTimeout(() => Sound.play('star', 0, i), 250 + i * 180);
  const last = hn === HOLES.length - 1;
  $('doneStats').innerHTML = `Hole ${hn + 1}: <b>${hole.name}</b><br>Strokes <b>${strokes}</b> · Par ${hole.par}` + (prev ? ` · Best ${Math.min(prev, strokes)}` : '') +
    (last ? `<br><b style="color:#ffd166">Course complete! ${totalStars()} / ${HOLES.length * 3} stars</b>` : '');
  $('nextBtn').textContent = last ? 'Holes ☰' : 'Next hole ▶';
  if (st === 3) Platform.happy();
  setState('done');
}
function nextHole() {
  if (hn >= HOLES.length - 1) { setState('holes'); return; }
  const n = hn + 1;
  $('nextBtn').disabled = true;
  const go = () => { $('nextBtn').disabled = false; loadHole(n); };
  if (n % 3 === 0) Platform.commercialBreak().then(go); else go();
}
function restartHole() { if (hole) loadHole(hn); }
function skipHole() {
  Platform.rewardedBreak().then(ok => {
    if (!ok) return;
    Store.set('unlocked', Math.max(Store.get('unlocked', 0), hn + 1));
    if (hn < HOLES.length - 1) loadHole(hn + 1); else setState('holes');
  });
}
function buyGuide() {
  if (state !== 'play' || flight) return;
  Platform.rewardedBreak().then(ok => { if (ok) { guideShots = 1; showMsg('Full aim guide for your next shot'); } });
}
function showMsg(t) { msg = { t, life: 2.4 }; }

// ---------------------------------------------------------------------
//  Screens
// ---------------------------------------------------------------------
function setState(s, focusLoss) {
  state = s;
  if (s === 'play' && pendingDone && hole && sunk) setTimeout(holeDone, 200);
  if (s === 'play') Platform.gameplayStart(); else if (!(focusLoss && Platform.kind === 'crazy')) Platform.gameplayStop();
  for (const el of document.querySelectorAll('.screen')) if (el.id !== 'adstub') el.classList.toggle('show', el.id === ({ menu: 'menu', holes: 'holes', paused: 'pause', done: 'done' }[s]));
  $('pauseBtn').style.display = s === 'play' ? 'block' : 'none';
  if (s === 'holes') renderHoles();
  if (s === 'menu') { const n = Object.keys(best).length; $('menuInfo').textContent = n ? `${n} / ${HOLES.length} holes played · ★ ${totalStars()} / ${HOLES.length * 3}` : `${HOLES.length} holes across three star systems`; }
  Sound.music();
}
function renderHoles() {
  const g = $('grid'); g.innerHTML = '';
  const un = unlocked();
  HOLES.forEach((h, i) => {
    const ch = CHAPTERS.find(c => c[1] === i);
    if (ch) { const d = document.createElement('div'); d.className = 'chap'; d.textContent = ch[0]; g.appendChild(d); }
    const b = document.createElement('button');
    b.className = 'lvl' + (best[i] ? ' done' : '');
    const st = best[i] ? starsOf(i, best[i]) : 0;
    b.innerHTML = `${i + 1}<small>${best[i] ? '★'.repeat(st) + '☆'.repeat(3 - st) : i <= un ? 'Par ' + h.par : '🔒'}</small>`;
    b.disabled = i > un;
    b.onclick = () => loadHole(i);
    g.appendChild(b);
  });
}
function pauseGame(focusLoss) { if (state === 'play') { drag = null; setState('paused', focusLoss === true); } }

// ---------------------------------------------------------------------
//  Background (stars + nebula, drawn once)
// ---------------------------------------------------------------------
const bg = document.createElement('canvas'); bg.width = W; bg.height = H;
{
  const b = bg.getContext('2d');
  const g = b.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#0b1030'); g.addColorStop(1, '#05061a');
  b.fillStyle = g; b.fillRect(0, 0, W, H);
  for (const [x, y, r, c] of [[300, 200, 420, 'rgba(110,60,200,.16)'], [1000, 560, 480, 'rgba(30,140,170,.14)'], [760, 120, 300, 'rgba(200,70,140,.10)']]) {
    const rg = b.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, c); rg.addColorStop(1, 'rgba(0,0,0,0)');
    b.fillStyle = rg; b.fillRect(0, 0, W, H);
  }
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 260; i++) { const s = rnd() * 1.6 + 0.3; b.fillStyle = `rgba(255,255,255,${0.25 + rnd() * 0.7})`; b.fillRect(rnd() * W, rnd() * H, s, s); }
}
const PLANET_COLS = [['#6ec6ff', '#1b4f8c'], ['#ffb86b', '#9c4a17'], ['#9be38a', '#2f7a3a'], ['#d5a6ff', '#5b2f99'], ['#ffd86b', '#a07514'], ['#7fe0d4', '#1e6e68']];

// ---------------------------------------------------------------------
//  Drawing
// ---------------------------------------------------------------------
function drawPlanet(b, x, y, i, time) {
  if (b.bh) {
    const ring = b.r * 2.6;
    for (let k = 0; k < 3; k++) {
      ctx.strokeStyle = `rgba(${k ? '170,120,255' : '255,180,90'},${0.35 - k * 0.08})`; ctx.lineWidth = 6 - k;
      ctx.beginPath(); ctx.ellipse(x, y, ring - k * 10, (ring - k * 10) * 0.42, time * (0.6 + k * 0.3), 0, TAU); ctx.stroke();
    }
    const g = ctx.createRadialGradient(x, y, b.r * 0.3, x, y, b.r * 1.9); g.addColorStop(0, '#000'); g.addColorStop(0.5, 'rgba(0,0,0,.95)'); g.addColorStop(1, 'rgba(80,40,140,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, b.r * 1.9, 0, TAU); ctx.fill();
    return;
  }
  // gravity halo
  const halo = Math.min(260, Math.sqrt(b.m) / 9);
  ctx.strokeStyle = b.rep ? 'rgba(255,90,90,.18)' : 'rgba(140,200,255,.12)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 8]);
  for (let k = 1; k <= 2; k++) { ctx.beginPath(); ctx.arc(x, y, b.r + halo * k / 2 + (b.rep ? (time * 30) % 20 : -(time * 20) % 20), 0, TAU); ctx.stroke(); }
  ctx.setLineDash([]);
  const [c1, c2] = b.rep ? ['#ff8a80', '#a11d2b'] : b.moon ? ['#d9dde6', '#6b7180'] : PLANET_COLS[i % PLANET_COLS.length];
  const g = ctx.createRadialGradient(x - b.r * 0.35, y - b.r * 0.35, b.r * 0.1, x, y, b.r);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, b.r, 0, TAU); ctx.fill();
  if (b.moon) { for (const [u, v, s] of [[-0.3, 0.2, 0.22], [0.25, -0.25, 0.15], [0.3, 0.35, 0.12]]) circle(x + u * b.r, y + v * b.r, s * b.r, 'rgba(70,75,90,.35)'); }
  else if (b.rep) {
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 3;
    for (let k = 0; k < 6; k++) { const a = k * TAU / 6 + time * 0.4, r0 = b.r * 0.35, r1 = b.r * 0.75; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0); ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1); ctx.stroke(); }
  } else {
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, b.r, 0, TAU); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = b.r * 0.16;
    for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.ellipse(x, y + k * b.r * 0.42, b.r * 1.2, b.r * 0.16, -0.2, 0, TAU); ctx.stroke(); }
    ctx.restore();
  }
  ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, b.r, 0, TAU); ctx.stroke();
}
function drawCup(x, y, time) {
  const g = ctx.createRadialGradient(x, y, 4, x, y, 46); g.addColorStop(0, 'rgba(124,240,197,.45)'); g.addColorStop(1, 'rgba(124,240,197,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 46, 0, TAU); ctx.fill();
  circle(x, y, GP.CUP_R + 2, '#0d3b30'); circle(x, y, GP.CUP_R - 3, '#020a08');
  ctx.strokeStyle = '#7cf0c5'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, GP.CUP_R + 2, 0, TAU); ctx.stroke();
  ctx.strokeStyle = '#e8eef5'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x + 2, y); ctx.lineTo(x + 2, y - 62); ctx.stroke();
  ctx.fillStyle = '#ff5d73'; ctx.beginPath(); ctx.moveTo(x + 3, y - 62);
  for (let k = 0; k <= 8; k++) ctx.lineTo(x + 3 + k * 4, y - 62 + Math.sin(time * 5 + k * 0.6) * 2.5 + k * 0.6);
  for (let k = 8; k >= 0; k--) ctx.lineTo(x + 3 + k * 4, y - 44 + Math.sin(time * 5 + k * 0.6) * 2.5 - k * 0.6);
  ctx.fill();
}
function drawWorm(x, y, col, time) {
  for (let k = 0; k < 4; k++) {
    const ph = (time * 0.9 + k / 4) % 1;
    ctx.strokeStyle = col.replace('A', String(1 - ph)); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, GP.WORM_R * 1.6 * (1 - ph) + 4, 0, TAU); ctx.stroke();
  }
  circle(x, y, 7, '#fff');
}
function render(time) {
  ctx.setTransform(viewScale * dpr, 0, 0, viewScale * dpr, 0, 0);
  ctx.drawImage(bg, 0, 0);
  if (!hole) return;
  const Tn = flight ? flight.T0 + flight.t : T;
  // dust clouds
  for (const d of hole.dust || []) {
    const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r); g.addColorStop(0, 'rgba(196,150,100,.38)'); g.addColorStop(0.8, 'rgba(160,110,70,.22)'); g.addColorStop(1, 'rgba(160,110,70,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, TAU); ctx.fill();
    for (let k = 0; k < 14; k++) { const a = k * 2.4 + time * 0.05, r = d.r * ((k * 0.37) % 1) * 0.9; circle(d.x + Math.cos(a) * r, d.y + Math.sin(a) * r, 2, 'rgba(230,200,160,.45)'); }
  }
  // speed rings
  for (const b of hole.boosts || []) {
    const a = b.a * Math.PI / 180;
    ctx.strokeStyle = 'rgba(255,209,102,.8)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.stroke();
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(a);
    for (let k = 0; k < 3; k++) {
      const ox = ((time * 60 + k * 18) % 54) - 27;
      ctx.strokeStyle = `rgba(255,209,102,${0.9 - Math.abs(ox) / 40})`; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(ox - 8, -12); ctx.lineTo(ox + 4, 0); ctx.lineTo(ox - 8, 12); ctx.stroke();
    }
    ctx.restore();
  }
  // wormholes
  (hole.worms || []).forEach((w, i) => { const col = i ? 'rgba(80,220,255,A)' : 'rgba(190,120,255,A)'; drawWorm(w[0], w[1], col, time); drawWorm(w[2], w[3], col, time); });
  // moon orbits
  for (const b of hole.bodies) if (b.moon) { ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.setLineDash([3, 9]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(b.cx, b.cy, b.orbit, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
  // tee + cup
  ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.ellipse(hole.tee[0], hole.tee[1], 22, 22, 0, 0, TAU); ctx.fill();
  drawCup(hole.cup[0], hole.cup[1], time);
  hole.bodies.forEach((b, i) => { const [x, y] = GP.bodyPos(b, Tn); drawPlanet(b, x, y, i + hn * 2, time); });
  // aim
  if (state === 'play' && !flight && !sunk && aim && ((drag && drag.moved) || aim.key)) {
    const p = previewPath(aim);
    let n = 0;
    for (let i = 0; i < p.length; i += 3) {
      const q = p[i]; if (!q) continue;
      const f = i / p.length;
      circle(q[0], q[1], 3.2 * (1 - f * 0.6), `rgba(255,255,255,${0.85 * (1 - f) + 0.1})`); n++;
    }
    const L = 40 + aim.pow * 110;
    ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 3; ctx.setLineDash([2, 6]);
    ctx.beginPath(); ctx.moveTo(ball.x, ball.y); ctx.lineTo(ball.x - Math.cos(aim.ang) * L, ball.y - Math.sin(aim.ang) * L); ctx.stroke(); ctx.setLineDash([]);
    // power arc
    ctx.strokeStyle = `hsl(${120 - aim.pow * 120},90%,60%)`; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(ball.x, ball.y, 26, -Math.PI / 2, -Math.PI / 2 + aim.pow * TAU); ctx.stroke();
  }
  // trail + ball
  for (let i = 0; i < trail.length; i++) { const [x, y] = trail[i], f = i / trail.length; circle(x, y, 1 + 6 * f, `rgba(170,230,255,${0.35 * f})`); }
  if (ball && !(sunk > 0.25)) {
    const s = sunk ? 1 - sunk * 3 : 1;
    circle(ball.x + 2, ball.y + 3, GP.BALL_R * s, 'rgba(0,0,0,.35)');
    const g = ctx.createRadialGradient(ball.x - 3, ball.y - 3, 1, ball.x, ball.y, GP.BALL_R * s); g.addColorStop(0, '#fff'); g.addColorStop(1, '#b9c7d8');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ball.x, ball.y, GP.BALL_R * s, 0, TAU); ctx.fill();
  }
  for (const p of parts) { ctx.globalAlpha = 1 - p.t / p.life; circle(p.x, p.y, 3, p.c); } ctx.globalAlpha = 1;
  if (!hideHud) drawHUD(time);
}
function drawHUD(time) {
  if (state !== 'play' && state !== 'paused' && state !== 'done') return;
  ctx.fillStyle = 'rgba(0,0,0,.35)'; rr(12, 10, 480, 64, 12); ctx.fill();
  hudText(`HOLE ${hn + 1}  ·  ${hole.name}`, 28, 30, 21, '#fff', 'left', 900);
  hudText(`Par ${hole.par}`, 28, 56, 17, '#9fb0d9', 'left', 800);
  hudText(`Strokes ${strokes}`, 120, 56, 17, strokes > hole.par ? '#ffb86b' : '#7cf0c5', 'left', 800);
  if (guideShots > 0) hudText('👁 Full guide', 260, 56, 17, '#ffd166', 'left', 800);
  // buttons drawn on canvas (top right, left of pause/mute)
  for (const b of hudButtons()) {
    ctx.fillStyle = 'rgba(0,0,0,.4)'; rr(b.x, b.y, b.w, b.h, 9); ctx.fill();
    hudText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1, 16, b.color || '#fff', 'center', 800, null);
  }
  if (hole.hint && strokes === 0 && !flight) {
    ctx.font = '700 18px system-ui'; const tw = ctx.measureText(hole.hint).width + 40;
    ctx.fillStyle = 'rgba(5,8,25,.72)'; rr(W / 2 - tw / 2, H - 52, tw, 36, 18); ctx.fill();
    hudText(hole.hint, W / 2, H - 34, 18, '#fff', 'center', 700);
  }
  if (msg) {
    msg.life -= 1 / 60; if (msg.life <= 0) msg = null;
    else { ctx.globalAlpha = Math.min(1, msg.life * 2); hudText(msg.t, W / 2, 120, 26, '#ffb86b', 'center', 900); ctx.globalAlpha = 1; }
  }
}
function hudButtons() {
  if (state !== 'play') return [];
  return [
    { id: 'guide', x: W - 330, y: 13, w: 120, h: 38, label: '🎬 Full aim', color: '#e2c6ff' },
    { id: 'restart', x: W - 200, y: 13, w: 52, h: 38, label: '↺' },
  ];
}

// ---------------------------------------------------------------------
//  Update
// ---------------------------------------------------------------------
function tick(dt) {
  for (const p of parts) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.95; p.vy *= 0.95; }
  parts = parts.filter(p => p.t < p.life);
  if (sunk) sunk += dt;
  if (state !== 'play') return;
  if (aim && aim.key) { /* keyboard aim stays visible */ }
  if (!flight) return;
  flight.t += dt;
  const p = flight.path;
  // advance along the recorded path (each point carries its hole time)
  while (flight.i < p.length - 1 && (!p[flight.i + 1] || p[flight.i + 1][2] - flight.T0 <= flight.t)) {
    flight.i++;
    if (!p[flight.i]) { trail = []; continue; }
  }
  const q = p[flight.i];
  if (q) { ball = { x: q[0], y: q[1] }; trail.push([q[0], q[1]]); if (trail.length > 26) trail.shift(); }
  // events (sounds, sparks) at their moment
  while (flight.ei < flight.events.length) {
    const e = flight.events[flight.ei];
    if (e[e.length - 1] - flight.T0 > flight.t) break;
    flight.ei++;
    if (e[0] === 'bounce') { Sound.play('bounce', 0.05, e[3]); for (let k = 0; k < 6; k++) parts.push({ x: e[1], y: e[2], vx: rand(-90, 90), vy: rand(-90, 90), t: 0, life: 0.35, c: '#cfe6ff' }); }
    if (e[0] === 'worm') Sound.play('worm');
  }
  if (flight.i >= p.length - 1) finishShot();
}
// ---------------------------------------------------------------------
//  Input
// ---------------------------------------------------------------------
canvas.addEventListener('pointerdown', e => {
  if (state !== 'play' || Platform.inAd) return;
  const p = toCanvas(e);
  for (const b of hudButtons()) if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) { Sound.play('click'); if (b.id === 'restart') restartHole(); else buyGuide(); return; }
  if (flight || sunk) return;
  drag = { x: p.x, y: p.y, moved: false }; aim.key = false;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
});
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const p = toCanvas(e), dx = drag.x - p.x, dy = drag.y - p.y, d = Math.hypot(dx, dy);
  if (d > 6) { drag.moved = true; aim.ang = Math.atan2(dy, dx); aim.pow = clamp((d - 6) / 230, 0, 1); }
});
canvas.addEventListener('pointerup', () => { if (!drag) return; const moved = drag.moved; drag = null; if (moved && aim.pow >= 0.04) shoot(aim); });
canvas.addEventListener('pointercancel', () => { drag = null; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
const keys = {};
window.addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (Platform.inAd) return;
  if (state === 'play') {
    if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat && !flight && !sunk && aim.key) shoot(aim);
    else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'KeyW', 'KeyS'].includes(e.code) && aim) aim.key = true;
    if (e.code === 'KeyR' && !e.repeat) restartHole();
    if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) pauseGame();
  } else if (state === 'paused' && (e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) setState('play');
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
function keyAim(dt) {
  if (state !== 'play' || flight || !aim || !aim.key || Platform.inAd) return;
  const fine = keys.ShiftLeft || keys.ShiftRight ? 0.25 : 1;
  if (keys.ArrowLeft || keys.KeyA) aim.ang -= 1.1 * dt * fine;
  if (keys.ArrowRight || keys.KeyD) aim.ang += 1.1 * dt * fine;
  if (keys.ArrowUp || keys.KeyW) aim.pow = clamp(aim.pow + 0.45 * dt * fine, 0.04, 1);
  if (keys.ArrowDown || keys.KeyS) aim.pow = clamp(aim.pow - 0.45 * dt * fine, 0.04, 1);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(true); Sound.setHidden(document.hidden); });
$('ui').addEventListener('click', e => { const b = e.target.closest('button'); if (b && b.id !== 'muteBtn') Sound.play('click'); });
setupMute();
$('playBtn').onclick = () => {
  if (!Object.keys(best).length) { $('playBtn').disabled = true; Platform.commercialBreak().then(() => { $('playBtn').disabled = false; loadHole(0); }); }
  else setState('holes');
};
$('holesBack').onclick = () => setState('menu');
$('pauseBtn').onclick = () => pauseGame();
$('resumeBtn').onclick = () => setState('play');
$('restartBtn').onclick = () => restartHole();
$('skipBtn').onclick = () => skipHole();
$('toHoles').onclick = () => setState('holes');
$('retryBtn').onclick = () => restartHole();
$('nextBtn').onclick = () => nextHole();
const portraitMQ = window.matchMedia('(orientation: portrait) and (pointer: coarse)');
const checkOrientation = () => { if (portraitMQ.matches) pauseGame(); };
if (portraitMQ.addEventListener) portraitMQ.addEventListener('change', checkOrientation);

// ---------------------------------------------------------------------
//  Main loop
// ---------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  let dt = (now - last) / 1000; last = now; if (dt > 0.05) dt = 0.05;
  keyAim(dt); tick(dt); render(now / 1000);
  requestAnimationFrame(frame);
}
(async function boot() {
  await Platform.init();
  setState('menu');
  Platform.loadingFinished();
  requestAnimationFrame(t => { last = t; frame(t); });
  // DEBUG-START (removed from release builds by build.py)
  window.__gg = {
    get state() { return state; }, get strokes() { return strokes; }, get ball() { return ball; }, get flight() { return flight; }, loadHole, GP, HOLES,
    // play a hole with the solver's best shots through the real shot path; resolves strokes
    async autoplay(n) {
      loadHole(n);
      for (let s = 0; s < 6 && state === 'play' && !sunk; s++) {
        let hits = GP.search(hole, ball.x, ball.y, T, 360, 16, 'sink');
        let shot = hits[0];
        if (!shot) {   // aim for the stop closest to the cup
          const all = GP.search(hole, ball.x, ball.y, T, 180, 12, 'stop');
          all.sort((a, b) => Math.hypot(a.res.x - hole.cup[0], a.res.y - hole.cup[1]) - Math.hypot(b.res.x - hole.cup[0], b.res.y - hole.cup[1]));
          shot = all[0];
        }
        if (!shot) return 'stuck';
        shoot({ ang: shot.ang, pow: shot.pow });
        while (flight) { tick(1 / 60); render(0); }
      }
      return sunk ? 'sunk in ' + strokes : 'not sunk';
    },
    set hideHud(v) { hideHud = v; },
    // a compact made-up hole for store art: everything near the middle
    stage() {
      loadHole(0);
      hole = { name: 'Promo', par: 2, tee: [400, 470], cup: [930, 450],
        bodies: [{ x: 660, y: 520, r: 95, m: 5e6 }, { x: 650, y: 255, r: 30, m: 1e7, bh: true }, { moon: true, cx: 660, cy: 520, orbit: 165, a0: 215, w: 60, r: 26, m: 1e6 }, { x: 1010, y: 250, r: 42, m: 2e6, rep: true }],
        worms: [[300, 300, 820, 330]], boosts: [{ x: 500, y: 330, a: -20, r: 34 }], dust: [{ x: 930, y: 450, r: 80 }] };
      ball = { x: 400, y: 470 }; aim = { ang: -0.55, pow: 0.72, key: true };
    },
    aimAt(ang, pow) { aim = { ang, pow, key: true }; },
    snap(w = 1920) {
      const vs = viewScale, d = dpr; viewScale = w / W; dpr = 1; canvas.width = w; canvas.height = Math.round(w * H / W);
      render(performance.now() / 1000); const url = canvas.toDataURL('image/png'); viewScale = vs; dpr = d; resize(); return url;
    },
  };
  // DEBUG-END
})();

})();
