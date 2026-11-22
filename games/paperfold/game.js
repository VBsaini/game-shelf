'use strict';
(() => {
// =====================================================================
//  Paperfold — 3D rooms whose walls are a 2D world
// =====================================================================
const W = 1280, H = 720, TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const $ = id => document.getElementById(id);
const PF = window.PF, LEVELS = window.PF_LEVELS;

// ---------------------------------------------------------------------
//  Storage
// ---------------------------------------------------------------------
const Store = {
  get(k, d) { try { const v = localStorage.getItem('paperfold_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('paperfold_' + k, JSON.stringify(v)); } catch (e) { } },
};

// ---------------------------------------------------------------------
//  Sound (WebAudio, synthesized)
// ---------------------------------------------------------------------
const Sound = (() => {
  let ac = null, master, sfxBus, musBus, musLevel, noiseBuf;
  let muted = Store.get('muted', false), ducked = false, hidden = false;
  const lastPlay = {};
  const music = { on: false, step: 0, next: 0, timer: null };
  function init() {
    if (ac) { if (ac.state === 'suspended' && !hidden) ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try { ac = new AC(); } catch (e) { ac = null; return; }
    master = ac.createGain(); master.connect(ac.destination);
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 5; comp.connect(master);
    sfxBus = ac.createGain(); sfxBus.gain.value = 0.6; sfxBus.connect(comp);
    const mf = ac.createBiquadFilter(); mf.type = 'lowpass'; mf.frequency.value = 2000; mf.connect(comp);
    musLevel = ac.createGain(); musLevel.gain.value = 0.28; musLevel.connect(mf);
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
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || sfxBus); o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(dur, vol, type, f0, f1, at, q) {
    const t = at || now(), s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; f.type = type; f.Q.value = q || 1;
    f.frequency.setValueAtTime(f0, t); if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(sfxBus); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.03);
  }
  const N = n => 440 * Math.pow(2, (n - 69) / 12);
  const SFX = {
    click: () => tone('triangle', 700, 900, 0.06, 0.12),
    step: () => { tone('sine', 300 + Math.random() * 40, 220, 0.06, 0.12); noise(0.04, 0.04, 'highpass', 2500, 2500); },
    paper: () => noise(0.08, 0.07, 'bandpass', 3500, 2500, 0, 2),
    bump: () => tone('sine', 140, 110, 0.08, 0.15),
    push: () => noise(0.16, 0.16, 'bandpass', 500, 300, 0, 1.5),
    fill: () => { tone('sine', 160, 50, 0.3, 0.45); noise(0.25, 0.25, 'lowpass', 800, 100); },
    tele: () => { tone('sine', 400, 1600, 0.25, 0.1); tone('sine', 600, 2400, 0.25, 0.06, now() + 0.05); },
    enter: () => { noise(0.35, 0.12, 'bandpass', 1200, 5000, 0, 1.5); tone('triangle', N(72), N(84), 0.3, 0.1); },
    exit: () => { noise(0.35, 0.12, 'bandpass', 5000, 1200, 0, 1.5); tone('triangle', N(84), N(72), 0.3, 0.1); },
    lever: () => { tone('square', 900, 600, 0.05, 0.08); tone('sine', 220, 160, 0.2, 0.2, now() + 0.04); },
    door: () => noise(0.4, 0.14, 'lowpass', 600, 200),
    fall: () => tone('triangle', 700, 120, 0.5, 0.15),
    undo: () => tone('triangle', 600, 400, 0.08, 0.1),
    win: () => { const t = now(); [72, 76, 79, 84, 88].forEach((n, i) => tone('triangle', N(n), N(n), 0.3, 0.14, t + i * 0.08)); },
    hint: () => { const t = now(); [79, 84].forEach((n, i) => tone('sine', N(n), N(n), 0.25, 0.12, t + i * 0.1)); },
    slide: () => noise(0.32, 0.08, 'highpass', 5000, 2500, 0, 0.7),
    boing: () => { tone('sine', 220, 520, 0.09, 0.2); tone('sine', 520, 260, 0.18, 0.12, now() + 0.08); },
    splash: () => { noise(0.3, 0.14, 'lowpass', 1800, 300, 0, 0.8); tone('sine', 420, 180, 0.15, 0.06); },
    beam: () => { tone('sine', N(88), N(91), 0.18, 0.05); tone('triangle', N(76), N(76), 0.25, 0.05, now() + 0.06); },
  };
  const CH = [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65]];   // Cmaj7 Am7 Fmaj7 G7
  const STEP = 60 / 72 / 2;
  function schedule() {
    if (!ac || !music.on) return;
    while (music.next < now() + 0.2) {
      const s = music.step % 32, bar = Math.floor(s / 8), t = music.next, ch = CH[bar];
      if (s % 8 === 0) { for (const n of ch) tone('sine', N(n - 12), N(n - 12), STEP * 8, 0.035, t, musBus); tone('triangle', N(ch[0] - 24), N(ch[0] - 24), STEP * 6, 0.06, t, musBus); }
      if ([0, 3, 5, 6].includes(s % 8)) { const n = ch[(s * 3 + bar) % 4] + 12; tone('triangle', N(n), N(n), STEP * 2.5, 0.03, t, musBus); }
      music.step++; music.next += STEP;
    }
  }
  function startMusic() { music.on = true; if (ac && !music.timer) { music.next = now() + 0.1; music.timer = setInterval(schedule, 50); } }
  return {
    init,
    play(name, gap) {
      if (!ac || muted || ducked || hidden) return;
      const t = performance.now();
      if (gap && lastPlay[name] && t - lastPlay[name] < gap * 1000) return;
      lastPlay[name] = t;
      try { SFX[name](); } catch (e) { }
    },
    music() { startMusic(); },
    duck(on) { ducked = on; applyVolume(); },
    setHidden(h) { hidden = h; if (ac) { if (h) ac.suspend(); else ac.resume(); } },
    get muted() { return muted; },
    toggleMute() { muted = !muted; Store.set('muted', muted); applyVolume(); return muted; },
  };
})();

// ---------------------------------------------------------------------
//  Platform / ads
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
//  Canvas
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
//  Game state
// ---------------------------------------------------------------------
let state = 'menu';                 // menu | levels | play | paused | win
let lvl = 0, st = null, cur = null, undoStack = [], moves = 0;
let anim = null, queued = null, fold = 0, foldTarget = 0, hintMoves = null, hintT = 0, msg = null, deathAnim = null;
let hideHud = false;
const CELL_W = 64, CELL_H = 48;     // texture pixels per wall cell
const tex = document.createElement('canvas'), tctx = tex.getContext('2d');
let cam = null;

function loadLevel(i) {
  lvl = i; st = PF.parse(LEVELS[i]); st.WH = st.H * 0.75;
  cur = PF.init(st); undoStack = []; moves = 0; anim = null; queued = null; hintMoves = null; msg = null; deathAnim = null;
  fold = foldTarget = 0;
  tex.width = st.S * CELL_W; tex.height = st.H * CELL_H;
  setupCamera();
  setState('play');
}

// ---------------------------------------------------------------------
//  Camera / projection
// ---------------------------------------------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
function setupCamera() {
  const Wd = st.W, Dd = st.D;
  const C = [Wd / 2, Dd + 2.6 + Dd * 0.55, 4.2 + Dd * 0.8];
  const T = [Wd / 2, Dd * 0.42, 0.5];
  const f = norm(sub(T, C)), r = norm(cross([0, 0, 1], f)), u = cross(f, r);
  cam = { C, f, r, u, s: 1, ox: 0, oy: 0 };
  const pts = [[0, 0, 0], [Wd, 0, 0], [0, Dd, 0], [Wd, Dd, 0], [0, 0, st.WH], [Wd, 0, st.WH], [0, Dd, st.WH], [Wd, Dd, st.WH]].map(raw);
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  cam.s = Math.min(1180 / (x1 - x0), 560 / (y1 - y0));
  cam.ox = 640 - (x0 + x1) / 2 * cam.s; cam.oy = 375 - (y0 + y1) / 2 * cam.s;
}
function raw(p) { const v = sub(p, cam.C), zc = dot(v, cam.f); return [dot(v, cam.r) / zc, -dot(v, cam.u) / zc]; }
function P(x, y, z) { const q = raw([x, y, z]); return [q[0] * cam.s + cam.ox, q[1] * cam.s + cam.oy]; }

// flat layout of the unfolded walls
function flatLayout() {
  const cw = Math.min(1180 / st.S, 84), ch = cw * 0.75;
  const sw = st.S * cw, x0 = (W - sw) / 2, y0 = 345 - st.H * ch / 2;
  return { cw, ch, x0, y0 };
}
// screen corners of wall cell (c, r) in 3D
function wallCell3D(c, r) {
  const z0 = r * st.WH / st.H, z1 = (r + 1) * st.WH / st.H, D = st.D, Wd = st.W;
  let a, b;   // bottom-left and bottom-right in world (as seen from inside the room)
  if (c < D) { const y = D - 1 - c; a = [0, y + 1]; b = [0, y]; }
  else if (c < D + Wd) { const x = c - D; a = [x, 0]; b = [x + 1, 0]; }
  else { const y = c - D - Wd; a = [Wd, y]; b = [Wd, y + 1]; }
  return [P(a[0], a[1], z1), P(b[0], b[1], z1), P(a[0], a[1], z0), P(b[0], b[1], z0)];   // TL TR BL BR
}
function wallCellFlat(c, r, L) {
  const x = L.x0 + c * L.cw, y = L.y0 + (st.H - 1 - r) * L.ch;
  return [[x, y], [x + L.cw, y], [x, y + L.ch], [x + L.cw, y + L.ch]];
}

// ---------------------------------------------------------------------
//  Moves, undo, animation
// ---------------------------------------------------------------------
const ANIM_DUR = 0.14;
function tryMove(dir) {
  if (state !== 'play' || cur.won) return;
  if (anim || deathAnim || Math.abs(fold - foldTarget) > 0.01) { queued = dir; return; }
  const res = PF.step(st, cur, dir);
  if (!res) {
    if (cur.m === 0 && (dir === 'L' || dir === 'R')) cur.face = dir === 'L' ? -1 : 1;
    Sound.play('bump', 0.1); return;
  }
  if (res.death) {
    deathAnim = { t: 0, from: res.ev[0].from, at: res.ev[0].at }; Sound.play('fall');
    return;
  }
  undoStack.push(cur); if (undoStack.length > 400) undoStack.shift();
  const prev = cur; cur = res.s; moves++;
  hintMoves = hintMoves && hintMoves[0] === dir ? hintMoves.slice(1) : null;
  let dur = ANIM_DUR;
  const colBefore = [PF.colorOn(st, prev, 0), PF.colorOn(st, prev, 1)];
  for (const e of res.ev) {
    if (e.t === 'move') {
      const d = Math.abs(e.to[0] - e.from[0]) + Math.abs(e.to[1] - e.from[1]);
      if (d > 1) { dur = Math.max(dur, 0.06 + 0.075 * d); if (!res.ev.some(x => x.t === 'raft')) Sound.play('slide'); } else Sound.play('step');
    }
    if (e.t === 'raft') { Sound.play('splash'); const d = Math.abs(e.to % st.W - e.from % st.W) + Math.abs(((e.to / st.W) | 0) - ((e.from / st.W) | 0)); dur = Math.max(dur, 0.12 + 0.1 * d); }
    if (e.t === 'move2') { Sound.play('paper'); if (Math.abs(e.to[0] - e.from[0]) > 1) { Sound.play('slide'); dur = Math.max(dur, 0.06 + 0.07 * Math.abs(e.to[0] - e.from[0])); } }
    if (e.t === 'push' || e.t === 'fill' || e.t === 'ctele') {
      if (e.t === 'push') Sound.play('push');
      if (e.path.length > 2) { dur = Math.max(dur, 0.06 + 0.07 * (e.path.length - 1)); if (e.kind !== 'K') Sound.play('slide'); }
    }
    if (e.t === 'bounce' || e.t === 'spring') Sound.play('boing');
    if (e.t === 'fill' && st.tiles[e.to] === 'w') Sound.play('splash');
    if (e.t === 'fill' || e.t === 'drop') { Sound.play('fill'); dur = Math.max(dur, e.path ? 0.16 + 0.07 * e.path.length : 0.22); }
    if (e.t === 'tele' || e.t === 'ctele') { Sound.play('tele'); dur = 0.24; }
    if (e.t === 'enter') { Sound.play('enter'); foldTarget = 1; }
    if (e.t === 'exit') { Sound.play('exit'); foldTarget = 0; }
    if (e.t === 'lever') { Sound.play('lever'); Sound.play('door'); }
    if (e.t === 'move2' && Math.abs(e.to[1] - e.from[1]) > 0) dur = Math.max(dur, 0.12 + 0.05 * Math.abs(e.to[1] - e.from[1]));
  }
  if (PF.colorOn(st, cur, 0) !== colBefore[0] || PF.colorOn(st, cur, 1) !== colBefore[1]) { Sound.play('door'); if (st.emit.length) Sound.play('beam'); }
  anim = { t: 0, dur, prev, ev: res.ev };
  if (cur.won) { Sound.play('win'); setTimeout(winLevel, 650); }
}
function undo() {
  if (state !== 'play' || !undoStack.length || cur.won) return;
  const prev = cur; cur = undoStack.pop(); moves = Math.max(0, moves - 1);
  anim = null; deathAnim = null; queued = null; hintMoves = null;
  if (prev.m !== cur.m) fold = foldTarget = cur.m;
  Sound.play('undo');
}
function restart() {
  if (state !== 'play' && state !== 'paused') return;
  if (moves) undoStack.push(cur);
  cur = PF.init(st); moves = 0; anim = null; deathAnim = null; queued = null; hintMoves = null; fold = foldTarget = 0;
  if (state === 'paused') setState('play');
  Sound.play('undo');
}
function winLevel() {
  if (state !== 'play') return;
  const done = Store.get('done', {}), best = done[lvl];
  const newBest = !best || moves < best;
  if (newBest) { done[lvl] = moves; Store.set('done', done); }
  Store.set('unlocked', Math.max(Store.get('unlocked', 0), lvl + 1));
  const last = lvl >= LEVELS.length - 1;
  $('winTitle').textContent = last ? 'YOU FOLDED THEM ALL!' : 'ROOM CLEARED!';
  $('winStats').innerHTML = `${LEVELS[lvl].name}<br>Moves: <b>${moves}</b>` + (best ? ` &nbsp;·&nbsp; Best: <b>${Math.min(best, moves)}</b>` : '') + (newBest && best ? '<br><b style="color:#ffd166">New best!</b>' : '');
  $('nextBtn').style.display = last ? 'none' : '';
  setState('win');
}
function nextLevel() {
  $('nextBtn').disabled = true;
  Platform.commercialBreak().then(() => { $('nextBtn').disabled = false; loadLevel(Math.min(lvl + 1, LEVELS.length - 1)); });
}
function skipLevel() {
  Platform.rewardedBreak().then(ok => {
    if (!ok) return;
    Store.set('unlocked', Math.max(Store.get('unlocked', 0), lvl + 1));
    if (lvl < LEVELS.length - 1) loadLevel(lvl + 1); else setState('levels');
  });
}
function hint() {
  if (state !== 'play' || cur.won) return;
  showMsg('Thinking…'); render(performance.now() / 1000);
  const at = cur;
  setTimeout(() => {
    if (cur !== at || state !== 'play') return;
    const sol = PF.solve(st, cur, 600000);
    if (!sol) { showMsg(sol === null ? 'No way out from here. Undo or restart!' : 'Too tangled to see. Try restarting.'); return; }
    msg = null;
    Platform.rewardedBreak().then(ok => {
      if (!ok || cur !== at) return;
      hintMoves = sol.slice(0, 6); hintT = 0; Sound.play('hint');
    });
  }, 40);
}
function showMsg(text) { msg = { text, t: 0 }; }

// ---------------------------------------------------------------------
//  State / screens
// ---------------------------------------------------------------------
function setState(s, focusLoss) {
  state = s;
  if (s === 'play') Platform.gameplayStart(); else if (!(focusLoss && Platform.kind === 'crazy')) Platform.gameplayStop();
  $('hud').style.display = s === 'play' ? 'block' : 'none';
  for (const el of document.querySelectorAll('.screen')) if (el.id !== 'adstub') el.classList.toggle('show', el.id === ({ menu: 'menu', levels: 'levels', paused: 'pause', win: 'win' }[s]));
  if (s === 'levels') renderLevels();
  if (s === 'menu') renderMenu();
  Sound.music();
}
function renderMenu() {
  const done = Object.keys(Store.get('done', {})).length;
  $('menuInfo').textContent = done ? `Rooms cleared: ${done} / ${LEVELS.length}` : `${LEVELS.length} rooms to unfold`;
}
function renderLevels() {
  const g = $('grid'); g.innerHTML = '';
  const unlocked = Store.get('unlocked', 0), done = Store.get('done', {});
  LEVELS.forEach((L, i) => {
    const b = document.createElement('button');
    b.className = 'lvl' + (done[i] ? ' done' : '');
    b.innerHTML = `${i + 1}<small>${done[i] ? '✓ ' + done[i] + ' moves' : i <= unlocked ? L.name : '🔒'}</small>`;
    b.disabled = i > unlocked;
    b.onclick = () => loadLevel(i);
    g.appendChild(b);
  });
}
function pauseGame(focusLoss) { if (state === 'play') setState('paused', focusLoss === true); }

// ---------------------------------------------------------------------
//  Wall texture (the 2D world)
// ---------------------------------------------------------------------
const RED = '#e74c3c', BLUE = '#3b82f6';
function paperGuy(c, x, y, s, face, squash = 0, alpha = 1) {
  // a little paper cut-out figure, feet at (x, y), height ~ s
  c.save(); c.globalAlpha *= alpha; c.translate(x, y); c.scale(face < 0 ? -1 : 1, 1); c.scale(1 + squash * 0.25, 1 - squash * 0.25);
  c.fillStyle = 'rgba(0,0,0,.18)'; c.beginPath(); c.ellipse(0, 0, s * 0.28, s * 0.07, 0, 0, TAU); c.fill();
  c.fillStyle = '#ffffff'; c.strokeStyle = '#2a2050'; c.lineWidth = Math.max(1.5, s * 0.05); c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(-s * 0.2, 0); c.lineTo(-s * 0.16, -s * 0.5); c.lineTo(-s * 0.24, -s * 0.52); c.lineTo(-s * 0.22, -s * 0.62);
  c.lineTo(s * 0.22, -s * 0.62); c.lineTo(s * 0.24, -s * 0.52); c.lineTo(s * 0.16, -s * 0.5); c.lineTo(s * 0.2, 0); c.closePath();
  c.fill(); c.stroke();
  c.beginPath(); c.arc(0, -s * 0.8, s * 0.2, 0, TAU); c.fill(); c.stroke();
  c.fillStyle = '#2a2050'; c.beginPath(); c.arc(s * 0.07, -s * 0.82, s * 0.035, 0, TAU); c.arc(s * 0.15, -s * 0.82, s * 0.035, 0, TAU); c.fill();
  c.strokeStyle = '#8a6cf0'; c.lineWidth = Math.max(1, s * 0.035); c.beginPath(); c.moveTo(-s * 0.13, -s * 0.36); c.lineTo(s * 0.13, -s * 0.36); c.stroke();
  c.restore();
}
function drawTexture(time, playerCell) {
  const t = tctx, S = st.S, Hh = st.H;
  t.setTransform(1, 0, 0, 1, 0, 0);
  for (let c = 0; c < S; c++) {
    const side = PF.wallSide(st, c);
    t.fillStyle = side === 'B' ? '#f3e9d2' : '#e6d8bb';
    t.fillRect(c * CELL_W, 0, CELL_W, Hh * CELL_H);
    t.fillStyle = side === 'B' ? 'rgba(160,130,90,.10)' : 'rgba(140,110,70,.12)';
    t.fillRect(c * CELL_W + 8, 0, 6, Hh * CELL_H); t.fillRect(c * CELL_W + 40, 0, 6, Hh * CELL_H);
  }
  // corner folds
  t.fillStyle = 'rgba(80,60,40,.25)';
  t.fillRect(st.D * CELL_W - 2, 0, 4, Hh * CELL_H); t.fillRect((st.D + st.W) * CELL_W - 2, 0, 4, Hh * CELL_H);
  t.fillStyle = '#b39b75'; t.fillRect(0, Hh * CELL_H - 5, S * CELL_W, 5);  // skirting
  const redOn = PF.colorOn(st, cur, 0), blueOn = PF.colorOn(st, cur, 1);
  for (let r = 0; r < Hh; r++) for (let c = 0; c < S; c++) {
    const ch = st.wall[r][c], x = c * CELL_W, y = (Hh - 1 - r) * CELL_H;
    if (ch === '=') brick(t, x, y);
    else if (ch === 'O') portal(t, x, y, time);
    else if (ch === 'L' || ch === 'M') lever(t, x, y, ch === 'L' ? RED : BLUE, cur.lever[ch === 'L' ? 0 : 1]);
    else if ('rRuU'.includes(ch)) {
      const col = 'rR'.includes(ch) ? RED : BLUE, on = 'rR'.includes(ch) ? redOn : blueOn;
      const solid = (ch === 'r' || ch === 'u') ? on : !on;
      colorBlock(t, x, y, col, solid, ch === 'r' || ch === 'u');
    }
    if (r === 0) {
      const [tx, ty] = PF.colTile(st, c), ti = ty * st.W + tx, tile = st.tiles[ti];
      const bk = PF.boxAt(cur, ti);
      if (tile === '#') silhouette(t, x, y, '#8d8a85', '#6b6863');
      else if (PF.EMIT[tile]) { silhouette(t, x, y, '#4a4458', '#2a2533'); t.fillStyle = '#fff3a0'; t.beginPath(); t.arc(x + CELL_W / 2, y + CELL_H / 2 + 3, 6, 0, TAU); t.fill(); }
      else if (bk && !(anim && animCrateTo(ti))) {
        if (bk === 'balls') { spring(t, x, y); }
        else if (bk === 'crates') silhouette(t, x, y, '#a5713f', '#7a4f26');
        else silhouette(t, x, y, '#8fa6bd', '#56697d');
      }
      else if (PF.doorClosed(st, cur, ti)) silhouette(t, x, y, tile === 'A' ? RED : BLUE, 'rgba(0,0,0,.3)');
    }
  }
  if (playerCell) paperGuy(t, playerCell[0], playerCell[1], CELL_H * 0.95, cur.face, playerCell[2] || 0, playerCell[3] == null ? 1 : playerCell[3]);
}
function brick(t, x, y) {
  t.fillStyle = '#b5654a'; t.fillRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2);
  t.fillStyle = '#c97a5c'; t.fillRect(x + 1, y + 1, CELL_W - 2, 5);
  t.strokeStyle = '#8a4733'; t.lineWidth = 2;
  t.beginPath(); t.moveTo(x, y + CELL_H / 2); t.lineTo(x + CELL_W, y + CELL_H / 2);
  t.moveTo(x + CELL_W / 2, y); t.lineTo(x + CELL_W / 2, y + CELL_H / 2); t.moveTo(x + CELL_W / 4, y + CELL_H / 2); t.lineTo(x + CELL_W / 4, y + CELL_H);
  t.moveTo(x + CELL_W * 0.75, y + CELL_H / 2); t.lineTo(x + CELL_W * 0.75, y + CELL_H); t.stroke();
  t.strokeRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2);
}
function portal(t, x, y, time) {
  const cx = x + CELL_W / 2, w = CELL_W * 0.62, h = CELL_H * 0.95, top = y + CELL_H - h;
  t.save();
  t.beginPath(); t.moveTo(cx - w / 2, y + CELL_H); t.lineTo(cx - w / 2, top + w / 2); t.arc(cx, top + w / 2, w / 2, Math.PI, 0); t.lineTo(cx + w / 2, y + CELL_H); t.closePath();
  const g = t.createLinearGradient(0, top, 0, y + CELL_H); g.addColorStop(0, '#c4a8ff'); g.addColorStop(1, '#6a3fd6');
  t.fillStyle = g; t.fill();
  t.clip();
  t.strokeStyle = 'rgba(255,255,255,.5)'; t.lineWidth = 2;
  for (let k = 0; k < 3; k++) { const ph = (time * 0.8 + k / 3) % 1; t.beginPath(); t.ellipse(cx, top + h * 0.55, w * 0.5 * ph, h * 0.5 * ph, 0, 0, TAU); t.globalAlpha = 1 - ph; t.stroke(); }
  t.restore();
  t.strokeStyle = '#3d2a7a'; t.lineWidth = 3;
  t.beginPath(); t.moveTo(cx - w / 2, y + CELL_H); t.lineTo(cx - w / 2, top + w / 2); t.arc(cx, top + w / 2, w / 2, Math.PI, 0); t.lineTo(cx + w / 2, y + CELL_H); t.stroke();
}
function lever(t, x, y, col, on) {
  const cx = x + CELL_W / 2, by = y + CELL_H - 6;
  t.fillStyle = '#5b5560'; t.fillRect(cx - 14, by - 4, 28, 8);
  const a = on ? 0.6 : -0.6;
  t.strokeStyle = '#3a3540'; t.lineWidth = 4; t.beginPath(); t.moveTo(cx, by); t.lineTo(cx + Math.sin(a) * 26, by - Math.cos(a) * 26); t.stroke();
  t.fillStyle = col; t.beginPath(); t.arc(cx + Math.sin(a) * 26, by - Math.cos(a) * 26, 6, 0, TAU); t.fill();
  t.strokeStyle = 'rgba(0,0,0,.4)'; t.lineWidth = 1.5; t.stroke();
}
function colorBlock(t, x, y, col, solid, appearsWhenOn) {
  if (solid) {
    t.fillStyle = col; t.fillRect(x + 2, y + 2, CELL_W - 4, CELL_H - 4);
    t.fillStyle = 'rgba(255,255,255,.25)'; t.fillRect(x + 2, y + 2, CELL_W - 4, 6);
    t.strokeStyle = 'rgba(0,0,0,.35)'; t.lineWidth = 2; t.strokeRect(x + 2, y + 2, CELL_W - 4, CELL_H - 4);
  } else {
    t.setLineDash([6, 5]); t.strokeStyle = col; t.globalAlpha = 0.7; t.lineWidth = 2.5; t.strokeRect(x + 5, y + 5, CELL_W - 10, CELL_H - 10);
    t.setLineDash([]); t.globalAlpha = 1;
  }
  // small mark: ▲ appears when the colour turns on, ▼ disappears
  t.fillStyle = solid ? 'rgba(255,255,255,.75)' : col;
  t.font = 'bold 14px system-ui'; t.textAlign = 'center'; t.textBaseline = 'middle';
  t.fillText(appearsWhenOn ? 'ON' : 'OFF', x + CELL_W / 2, y + CELL_H / 2 + 1);
}
function silhouette(t, x, y, col, dark) {
  t.fillStyle = col; t.globalAlpha = 0.85; t.fillRect(x + 4, y + 6, CELL_W - 8, CELL_H - 6); t.globalAlpha = 1;
  t.strokeStyle = dark; t.lineWidth = 2; t.strokeRect(x + 4, y + 6, CELL_W - 8, CELL_H - 6);
  t.beginPath(); t.moveTo(x + 4, y + 6); t.lineTo(x + CELL_W - 4, y + CELL_H); t.moveTo(x + CELL_W - 4, y + 6); t.lineTo(x + 4, y + CELL_H); t.stroke();
}
// a rubber crate seen from the wall: a springboard
function spring(t, x, y) {
  t.fillStyle = '#34a46c'; t.fillRect(x + 4, y + 6, CELL_W - 8, CELL_H - 6);
  t.fillStyle = '#5fd39a'; t.fillRect(x + 4, y + 6, CELL_W - 8, 8);
  t.strokeStyle = '#1f6e47'; t.lineWidth = 2; t.strokeRect(x + 4, y + 6, CELL_W - 8, CELL_H - 6);
  t.strokeStyle = 'rgba(255,255,255,.8)'; t.lineWidth = 3; t.beginPath();
  const cx = x + CELL_W / 2; for (let k = 0; k <= 6; k++) { const px = cx + (k % 2 ? 10 : -10), py = y + 18 + k * 4; k ? t.lineTo(px, py) : t.moveTo(px, py); }
  t.stroke();
}
function animCrateTo(i) { return anim.ev.some(e => (e.t === 'push' || e.t === 'ctele') && e.to === i && anim.t < 1); }

// textured triangle (affine map of a texture triangle onto a screen triangle)
function texTri(x0, y0, x1, y1, x2, y2, u0, v0, u1, v1, u2, v2) {
  const cx = (x0 + x1 + x2) / 3, cy = (y0 + y1 + y2) / 3, g = 0.6;
  const e = (x, y) => { const dx = x - cx, dy = y - cy, l = Math.hypot(dx, dy) || 1; return [x + dx / l * g, y + dy / l * g]; };
  const [a0, b0] = e(x0, y0), [a1, b1] = e(x1, y1), [a2, b2] = e(x2, y2);
  ctx.save(); ctx.beginPath(); ctx.moveTo(a0, b0); ctx.lineTo(a1, b1); ctx.lineTo(a2, b2); ctx.closePath(); ctx.clip();
  const det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
  const a = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / det;
  const b = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / det;
  const c = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / det;
  const d = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / det;
  ctx.transform(a, b, c, d, x0 - a * u0 - c * v0, y0 - b * u0 - d * v0);
  const sx = Math.max(0, Math.min(u0, u1, u2) - 2), sy = Math.max(0, Math.min(v0, v1, v2) - 2);
  const sw = Math.min(tex.width - sx, Math.max(u0, u1, u2) - sx + 4), sh = Math.min(tex.height - sy, Math.max(v0, v1, v2) - sy + 4);
  ctx.drawImage(tex, sx, sy, sw, sh, sx, sy, sw, sh);
  ctx.restore();
}
function drawWalls(k) {
  const L = flatLayout(), e = ease(k);
  if (e >= 0.999) { ctx.drawImage(tex, L.x0, L.y0, st.S * L.cw, st.H * L.ch); return; }
  for (let c = 0; c < st.S; c++) for (let r = 0; r < st.H; r++) {
    const a = wallCell3D(c, r), b = wallCellFlat(c, r, L);
    const q = a.map((p, i) => [lerp(p[0], b[i][0], e), lerp(p[1], b[i][1], e)]);
    const u0 = c * CELL_W, v0 = (st.H - 1 - r) * CELL_H, u1 = u0 + CELL_W, v1 = v0 + CELL_H;
    texTri(q[0][0], q[0][1], q[1][0], q[1][1], q[2][0], q[2][1], u0, v0, u1, v0, u0, v1);
    texTri(q[1][0], q[1][1], q[3][0], q[3][1], q[2][0], q[2][1], u1, v0, u1, v1, u0, v1);
  }
  // wall top edge
  if (e > 0.08) return; ctx.strokeStyle = `rgba(60,45,30,${0.6 * (1 - e / 0.08)})`; ctx.lineWidth = 3; ctx.beginPath();
  const top = [P(0, st.D, st.WH), P(0, 0, st.WH), P(st.W, 0, st.WH), P(st.W, st.D, st.WH)];
  top.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
}
function drawGroundBand(alpha) {
  if (alpha <= 0) return;
  const L = flatLayout(), y = L.y0 + st.H * L.ch;
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(L.x0 - 10, L.y0 - 10, st.S * L.cw + 20, st.H * L.ch + L.ch * 0.55 + 20);
  ctx.drawImage(tex, L.x0, L.y0, st.S * L.cw, st.H * L.ch);
  for (let c = 0; c < st.S; c++) {
    const [tx, ty] = PF.colTile(st, c), ti = ty * st.W + tx, x = L.x0 + c * L.cw;
    const tt = st.tiles[ti], filledHere = cur.filled.indexOf(ti) >= 0;
    if (PF.isPit(st, cur, ti)) { ctx.fillStyle = tt === 'w' ? '#1d4f8c' : '#120e1f'; ctx.fillRect(x, y, L.cw, L.ch * 0.55); }
    else {
      ctx.fillStyle = tt === 'E' ? '#ffd166' : filledHere || PF.isPit(st, { ...cur, filled: [] }, ti) && tt !== 'w' ? '#9c7a4c' : tt === 'w' ? '#4caf50' : tt === '~' ? '#bfe6f7' : '#cdbb98';
      ctx.fillRect(x, y, L.cw, L.ch * 0.55); ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(x, y, 1, L.ch * 0.55);
      if (tt === '~' && !filledHere) { ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillRect(x + L.cw * 0.2, y + 3, L.cw * 0.35, 3); }
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = '700 15px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('LEFT WALL', L.x0 + st.D * L.cw / 2, L.y0 - 22);
  ctx.fillText('BACK WALL', L.x0 + (st.D + st.W / 2) * L.cw, L.y0 - 22);
  ctx.fillText('RIGHT WALL', L.x0 + (st.D + st.W + st.D / 2) * L.cw, L.y0 - 22);
  ctx.restore();
}

// ---------------------------------------------------------------------
//  3D room drawing
// ---------------------------------------------------------------------
function quad(pts, fill, stroke) {
  ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
}
function tileQuad(x, y, z = 0, inset = 0) { return [P(x + inset, y + inset, z), P(x + 1 - inset, y + inset, z), P(x + 1 - inset, y + 1 - inset, z), P(x + inset, y + 1 - inset, z)]; }
function cube(x0, y0, x1, y1, z0, z1, top, front, side, line = 'rgba(0,0,0,.35)') {
  const cx = st.W / 2;
  if (cx < x0) quad([P(x0, y0, z0), P(x0, y1, z0), P(x0, y1, z1), P(x0, y0, z1)], side, line);
  if (cx > x1) quad([P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], side, line);
  quad([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], front, line);
  quad([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], top, line);
}
function drawFloor(time) {
  const redOn = PF.colorOn(st, cur, 0), blueOn = PF.colorOn(st, cur, 1);
  for (let y = 0; y < st.D; y++) for (let x = 0; x < st.W; x++) {
    const i = y * st.W + x, t = st.tiles[i];
    const filled = cur.filled.indexOf(i) >= 0 && !(anim && anim.t < 1 && anim.ev.some(e => (e.t === 'fill' || e.t === 'drop') && (e.to === i || e.i === i)));
    const pit = PF.isPit(st, cur, i) || (cur.filled.indexOf(i) >= 0 && !filled);
    const checker = (x + y) % 2 ? '#d9cdb4' : '#e4d9c2';
    if (t === 'w' && !filled) {
      quad(tileQuad(x, y), '#2f6fb8');
      const behind = y > 0 ? st.tiles[i - st.W] : '#';
      if (behind !== 'w' || cur.filled.indexOf(i - st.W) >= 0) quad([P(x, y, 0), P(x + 1, y, 0), P(x + 1, y, -0.25), P(x, y, -0.25)], '#1d4f8c');
      for (let k = 0; k < 2; k++) {
        const ph = (time * 0.35 + (x * 0.37 + y * 0.61 + k * 0.5)) % 1;
        const a = P(x + 0.15 + ph * 0.5, y + 0.3 + k * 0.4, 0.002), b = P(x + 0.35 + ph * 0.5, y + 0.3 + k * 0.4, 0.002);
        ctx.strokeStyle = `rgba(200,230,255,${0.5 * Math.sin(ph * Math.PI)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      continue;
    }
    if (pit) {
      quad(tileQuad(x, y), '#15101f');
      quad([P(x, y, 0), P(x + 1, y, 0), P(x + 1, y, -0.5), P(x, y, -0.5)], '#2a2238');
      if (t === 'x' || t === 'y') { ctx.setLineDash([5, 5]); quad(tileQuad(x, y, 0, 0.08), null, t === 'x' ? RED : BLUE); ctx.setLineDash([]); }
      continue;
    }
    if (filled) { quad(tileQuad(x, y), '#a5713f', 'rgba(0,0,0,.25)'); quad(tileQuad(x, y, 0, 0.18), '#94612f'); continue; }
    if (t === 'x' || t === 'y') {
      quad(tileQuad(x, y), '#15101f');
      const col = t === 'x' ? RED : BLUE;
      for (let k = 0; k < 4; k++) quad([P(x + 0.04, y + k / 4 + 0.03, 0), P(x + 0.96, y + k / 4 + 0.03, 0), P(x + 0.96, y + (k + 1) / 4 - 0.03, 0), P(x + 0.04, y + (k + 1) / 4 - 0.03, 0)], col, 'rgba(0,0,0,.3)');
      continue;
    }
    if (t === '~') {
      quad(tileQuad(x, y), (x + y) % 2 ? '#bfe6f7' : '#cdeefb', 'rgba(90,150,190,.35)');
      quad([P(x + 0.2, y + 0.75, 0.001), P(x + 0.45, y + 0.25, 0.001), P(x + 0.55, y + 0.25, 0.001), P(x + 0.3, y + 0.75, 0.001)], 'rgba(255,255,255,.75)');
      continue;
    }
    quad(tileQuad(x, y), checker, 'rgba(120,100,70,.25)');
    if (t === '1' || t === '2') {
      const on = PF.colorOn(st, cur, t === '1' ? 0 : 1), col = t === '1' ? RED : BLUE;
      quad(tileQuad(x, y, 0.002, 0.12), '#3a3446', 'rgba(0,0,0,.4)');
      ctx.beginPath();
      for (let a = 0; a <= 20; a++) { const an = a / 20 * TAU, p = P(x + 0.5 + Math.cos(an) * 0.26, y + 0.5 + Math.sin(an) * 0.26, 0.004); a ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
      ctx.fillStyle = on ? '#fff3a0' : col; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.stroke();
    } else if (t === 'E') {
      const pulse = 0.5 + 0.5 * Math.sin(time * 3);
      quad(tileQuad(x, y, 0.001, 0.06), `rgba(255,209,102,${0.6 + 0.3 * pulse})`);
      quad(tileQuad(x, y, 0.002, 0.25), '#fff3c4');
    } else if (t === 'a' || t === 'b') {
      const on = t === 'a' ? redOn : blueOn, col = t === 'a' ? RED : BLUE;
      quad(tileQuad(x, y, on ? 0.005 : 0.04, 0.15), col, 'rgba(0,0,0,.35)');
    } else if (t === 'T' || t === 't' || t === 'V' || t === 'v') {
      const col = 'Tt'.includes(t) ? '#8a6cf0' : '#2ec4b6';
      for (let k = 0; k < 3; k++) {
        const ph = (time * 0.7 + k / 3) % 1, rr = 0.42 * (1 - ph);
        ctx.beginPath();
        for (let a = 0; a <= 24; a++) { const an = a / 24 * TAU, p = P(x + 0.5 + Math.cos(an) * rr, y + 0.5 + Math.sin(an) * rr, 0.01); a ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
        ctx.strokeStyle = col; ctx.globalAlpha = 0.3 + 0.7 * ph; ctx.lineWidth = 3; ctx.stroke(); ctx.globalAlpha = 1;
      }
    } else if (t === 'A' || t === 'B') {
      quad(tileQuad(x, y, 0.002, 0.04), null, t === 'A' ? RED : BLUE);
    }
  }
  drawPads();
}
function drawPads() {
  const raft = anim && anim.t < 1 ? anim.ev.find(e => e.t === 'raft') : null;
  for (const i of cur.pads) {
    let x = i % st.W, y = (i / st.W) | 0;
    if (raft && raft.to === i) { const k = ease(anim.t); x = lerp(raft.from % st.W, x, k); y = lerp((raft.from / st.W) | 0, y, k); }
    ctx.beginPath();
    for (let a = 0; a <= 28; a++) {
      const an = 0.35 + a / 28 * (TAU - 0.7), p = P(x + 0.5 + Math.cos(an) * 0.44, y + 0.5 + Math.sin(an) * 0.44, 0.01);
      a ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
    }
    const c = P(x + 0.5, y + 0.5, 0.01); ctx.lineTo(c[0], c[1]); ctx.closePath();
    ctx.fillStyle = '#4caf50'; ctx.fill(); ctx.strokeStyle = '#2e7d32'; ctx.lineWidth = 2; ctx.stroke();
    const v = P(x + 0.5 - 0.3, y + 0.5, 0.012); ctx.strokeStyle = 'rgba(30,90,35,.6)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(c[0], c[1]); ctx.lineTo(v[0], v[1]); ctx.stroke();
  }
}
function rubberAt(x, y, z = 0, alpha = 1) {
  ctx.globalAlpha = alpha;
  cube(x + 0.12, y + 0.12, x + 0.88, y + 0.88, z, z + 0.72, '#5fd39a', '#34a46c', '#2b8a5a', 'rgba(20,70,45,.6)');
  const a = P(x + 0.5, y + 0.5, z + 0.721);
  ctx.beginPath();
  for (let k = 0; k <= 20; k++) { const an = k / 20 * TAU, p = P(x + 0.5 + Math.cos(an) * 0.22, y + 0.5 + Math.sin(an) * 0.22, z + 0.721); k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
  ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(a[0], a[1], 2.5, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
}
// mirror crate: a low base with a pane of glass along its diagonal
function mirrorAt(x, y, kind, z = 0, alpha = 1) {
  ctx.globalAlpha = alpha;
  cube(x + 0.1, y + 0.1, x + 0.9, y + 0.9, z, z + 0.22, '#8fa6bd', '#6f8499', '#5d7083');
  const [ax, ay, bx, by] = kind === '/' ? [x + 0.14, y + 0.86, x + 0.86, y + 0.14] : [x + 0.14, y + 0.14, x + 0.86, y + 0.86];
  quad([P(ax, ay, z + 0.22), P(bx, by, z + 0.22), P(bx, by, z + 0.95), P(ax, ay, z + 0.95)], 'rgba(190,235,255,.72)', 'rgba(255,255,255,.9)');
  const m0 = P(lerp(ax, bx, 0.3), lerp(ay, by, 0.3), z + 0.75), m1 = P(lerp(ax, bx, 0.5), lerp(ay, by, 0.5), z + 0.85);
  ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(m0[0], m0[1]); ctx.lineTo(m1[0], m1[1]); ctx.stroke();
  ctx.globalAlpha = 1;
}
function boxAt3(kind, x, y, z = 0, alpha = 1) {
  if (kind === 'K') rubberAt(x, y, z, alpha);
  else if (kind === '/' || kind === '\\') mirrorAt(x, y, kind, z, alpha);
  else crateAt(x, y, z, alpha);
}
function emitterAt(x, y, d, time) {
  cube(x + 0.08, y + 0.08, x + 0.92, y + 0.92, 0, 0.75, '#5b5468', '#4a4458', '#3d3849');
  const c = P(x + 0.5 + d[0] * 0.43, y + 0.5 + d[1] * 0.43, 0.42), s = Math.abs(P(x + 0.5, y + 0.5, 0)[1] - P(x + 0.5, y + 0.5, 0.2)[1]);
  ctx.fillStyle = '#fff3a0'; ctx.globalAlpha = 0.6 + 0.3 * Math.sin(time * 4); ctx.beginPath(); ctx.arc(c[0], c[1], Math.max(4, s * 0.7), 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
  const top = P(x + 0.5, y + 0.5, 0.751); ctx.fillStyle = '#fff3a0'; ctx.beginPath(); ctx.arc(top[0], top[1], 3, 0, TAU); ctx.fill();
}
function crateAt(x, y, z = 0, alpha = 1) {
  ctx.globalAlpha = alpha;
  cube(x + 0.1, y + 0.1, x + 0.9, y + 0.9, z, z + 0.8, '#c98d55', '#a5713f', '#8d5d30');
  const a = P(x + 0.1, y + 0.9, z), b = P(x + 0.9, y + 0.9, z + 0.8), c2 = P(x + 0.9, y + 0.9, z), d = P(x + 0.1, y + 0.9, z + 0.8);
  ctx.strokeStyle = 'rgba(80,45,15,.6)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.moveTo(c2[0], c2[1]); ctx.lineTo(d[0], d[1]); ctx.stroke();
  ctx.globalAlpha = 1;
}
function playerBillboard(x, y, z, face, alpha = 1, squash = 0) {
  const base = P(x + 0.5, y + 0.55, z), top = P(x + 0.5, y + 0.55, z + 1.0);
  paperGuy(ctx, base[0], base[1], Math.abs(base[1] - top[1]), face, squash, alpha);
}
function drawObjects(time, pl) {
  const list = [];
  const redOn = PF.colorOn(st, cur, 0), blueOn = PF.colorOn(st, cur, 1);
  for (let y = 0; y < st.D; y++) for (let x = 0; x < st.W; x++) {
    const i = y * st.W + x, t = st.tiles[i];
    if (t === '#') list.push({ y, x, f: () => cube(x, y, x + 1, y + 1, 0, 1, '#b7b2aa', '#9a958d', '#85807a') });
    if (PF.EMIT[t]) list.push({ y, x, f: () => emitterAt(x, y, PF.EMIT[t], time) });
    if ((t === 'A' || t === 'B') && PF.doorClosed(st, cur, i)) {
      const col = t === 'A' ? RED : BLUE;
      list.push({ y, x, f: () => { ctx.globalAlpha = 0.85; cube(x + 0.04, y + 0.3, x + 0.96, y + 0.7, 0, 1.1, col, col, col, 'rgba(0,0,0,.45)'); ctx.globalAlpha = 1; } });
    }
    if (t === 'E') list.push({ y: y + 0.01, x, f: () => {
      const b = P(x + 0.5, y + 0.5, 0.75 + Math.sin(time * 2.5) * 0.08), s = Math.abs(P(x + 0.5, y + 0.5, 0)[1] - P(x + 0.5, y + 0.5, 0.4)[1]);
      ctx.save(); ctx.translate(b[0], b[1]); ctx.rotate(Math.sin(time * 1.5) * 0.2);
      ctx.fillStyle = '#ffd166'; ctx.strokeStyle = '#a8761c'; ctx.lineWidth = 2; ctx.beginPath();
      for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? s * 0.4 : s; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    } });
  }
  // blocks (with animation along their path)
  const moving = new Map();
  if (anim && anim.t < 1) for (const e of anim.ev) {
    if (e.t === 'push' || e.t === 'fill' || e.t === 'ctele') moving.set(e.t === 'fill' ? -1000 - e.to : e.to, e);
    if (e.t === 'drop') moving.set(-1 - e.i, e);
  }
  const along = (path, k) => {
    const f = clamp(k, 0, 1) * (path.length - 1), a = Math.floor(f), b = Math.min(path.length - 1, a + 1), u = f - a;
    return [lerp(path[a] % st.W, path[b] % st.W, u), lerp((path[a] / st.W) | 0, (path[b] / st.W) | 0, u)];
  };
  for (const list0 of PF.BOXES) for (const ci of cur[list0]) {
    const kind = PF.KIND[list0], x = ci % st.W, y = (ci / st.W) | 0, e = moving.get(ci);
    if (e && e.t === 'push') { const [px, py] = along(e.path, anim.t < 0.999 ? ease(anim.t) : 1); list.push({ y: py, x: px, f: () => boxAt3(kind, px, py) }); }
    else if (e && e.t === 'ctele') {
      const k = anim.t, mx = e.mid % st.W, my = (e.mid / st.W) | 0;
      if (k < 0.5) { const [px, py] = along(e.path, k * 2); list.push({ y: my, x: mx, f: () => boxAt3(kind, px, py, 0, 1 - k) }); }
      else list.push({ y, x, f: () => boxAt3(kind, x, y, (1 - k) * 0.6, k) });
    } else list.push({ y, x, f: () => boxAt3(kind, x, y) });
  }
  for (const [kk, e] of moving) if (e.t === 'fill') {
    const k = anim.t, tx = e.to % st.W, ty = (e.to / st.W) | 0, n = e.path.length, slideK = (n - 1) / n;
    const [px, py] = along(e.path, Math.min(1, k / slideK));
    list.push({ y: ty - 0.01, x: tx, f: () => boxAt3(e.kind, px, py, -Math.max(0, k - slideK) / (1 - slideK) * 0.8) });
  } else if (e.t === 'drop') { const tx = e.i % st.W, ty = (e.i / st.W) | 0; list.push({ y: ty - 0.01, x: tx, f: () => boxAt3(e.kind, tx, ty, -anim.t * 0.8) }); }
  // light beams, cut into short pieces so they sort in depth with everything else
  if (st.emit.length) for (const pts of PF.beams(st, cur).paths) for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], len = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(len / 0.5));
    for (let j = 0; j < n; j++) {
      const x0 = lerp(ax, bx, j / n), y0 = lerp(ay, by, j / n), x1 = lerp(ax, bx, (j + 1) / n), y1 = lerp(ay, by, (j + 1) / n);
      list.push({ y: Math.max(y0, y1) - 0.5 + 0.03, x: (x0 + x1) / 2 - 0.5, f: () => beamSeg(x0, y0, x1, y1, time) });
    }
  }
  if (pl) list.push({ y: pl.y + 0.02, x: pl.x, f: () => playerBillboard(pl.x, pl.y, pl.z || 0, cur.face, pl.a == null ? 1 : pl.a, pl.sq || 0) });
  const cx = st.W / 2 - 0.5;
  list.sort((a, b) => a.y - b.y || Math.abs(b.x - cx) - Math.abs(a.x - cx));
  for (const o of list) o.f();
  // hint arrow at the player's feet
  if (hintMoves && hintMoves.length && cur.m === 0 && !anim) {
    const d = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] }[hintMoves[0]];
    const a = P(cur.x + 0.5, cur.y + 0.5, 0.02), b = P(cur.x + 0.5 + d[0] * 0.85, cur.y + 0.5 + d[1] * 0.85, 0.02);
    arrow(a, b, '#ffd166');
  }
}
function beamSeg(x0, y0, x1, y1, time) {
  const a = P(x0, y0, 0.42), b = P(x1, y1, 0.42);
  ctx.lineCap = 'round';
  ctx.strokeStyle = `rgba(255,236,140,${0.28 + 0.08 * Math.sin(time * 6)})`; ctx.lineWidth = 11; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  ctx.strokeStyle = '#fff6c8'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  ctx.lineCap = 'butt';
}
function arrow(a, b, col) {
  const an = Math.atan2(b[1] - a[1], b[0] - a[0]), l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  ctx.save(); ctx.translate(a[0], a[1]); ctx.rotate(an);
  ctx.globalAlpha = 0.6 + 0.4 * Math.sin(performance.now() / 150);
  ctx.fillStyle = col; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(l * 0.25, -5); ctx.lineTo(l * 0.7, -5); ctx.lineTo(l * 0.7, -13); ctx.lineTo(l, 0); ctx.lineTo(l * 0.7, 13); ctx.lineTo(l * 0.7, 5); ctx.lineTo(l * 0.25, 5); ctx.closePath();
  ctx.fill(); ctx.stroke(); ctx.restore();
}

// player position for this frame (3D tile coords or 2D texture coords)
function playerNow() {
  const k = anim ? ease(Math.min(1, anim.t)) : 1;
  let p3 = null, p2 = null;
  const cellPos = (c, r) => [c * CELL_W + CELL_W / 2, (st.H - r) * CELL_H - 3];
  if (cur.m === 0) {
    p3 = { x: cur.x, y: cur.y };
    if (anim && anim.t < 1) {
      const mv = anim.ev.find(e => e.t === 'move'), tp = anim.ev.find(e => e.t === 'tele'), ex = anim.ev.find(e => e.t === 'exit');
      if (mv && tp) {
        if (anim.t < 0.5) { const kk = ease(anim.t * 2); p3 = { x: lerp(mv.from[0], mv.to[0], kk), y: lerp(mv.from[1], mv.to[1], kk), a: 1 - anim.t * 2 }; }
        else p3 = { x: cur.x, y: cur.y, a: (anim.t - 0.5) * 2, z: (1 - anim.t) * 0.6 };
      } else if (mv) p3 = { x: lerp(mv.from[0], mv.to[0], k), y: lerp(mv.from[1], mv.to[1], k), z: Math.sin(k * Math.PI) * 0.08 };
      else if (ex) { p3 = { x: cur.x, y: cur.y, a: k }; p2 = cellPos(ex.c, anim.prev.r); p2.push(0, 1 - k); }
    }
  } else {
    const [x, y] = cellPos(cur.c, cur.r); p2 = [x, y, 0, 1];
    if (anim && anim.t < 1) {
      const mv = anim.ev.find(e => e.t === 'move2'), en = anim.ev.find(e => e.t === 'enter');
      if (mv) {
        const [fx, fy] = cellPos(mv.from[0], mv.from[1]), [tx, ty] = cellPos(mv.to[0], mv.to[1]);
        const climb = mv.to[1] > mv.from[1], fall = mv.to[1] < mv.from[1];
        let px, py;
        if (climb) { px = lerp(fx, tx, k); py = lerp(fy, ty, k) - Math.sin(k * Math.PI) * CELL_H * 0.4; }
        else if (fall) { const kh = Math.min(1, k * 2.2); px = lerp(fx, tx, kh); py = lerp(fy, ty, Math.max(0, (k - 0.2) / 0.8) ** 2); }
        else { px = lerp(fx, tx, k); py = fy - Math.sin(k * Math.PI) * 5; }
        p2 = [px, py, 0, 1];
      }
      if (en) { p3 = { x: en.from[0], y: en.from[1], a: 1 - k }; p2[3] = k; }
    }
  }
  if (deathAnim) {
    const [x, y] = cellPos(deathAnim.at[0], deathAnim.from[1]);
    const t = deathAnim.t; p2 = [lerp(cellPos(deathAnim.from[0], 0)[0], x, Math.min(1, t * 3)), y + t * t * 900, 0, 1 - t];
  }
  return { p3, p2 };
}

// ---------------------------------------------------------------------
//  Render
// ---------------------------------------------------------------------
function render(time) {
  ctx.setTransform(viewScale * dpr, 0, 0, viewScale * dpr, 0, 0);
  const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#2d2452'); bg.addColorStop(1, '#17122b');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  if (!st) { drawMenuBackdrop(time); return; }
  const { p3, p2 } = playerNow();
  drawTexture(time, p2);
  const k = fold;
  if (k < 0.02) { drawWalls(0); drawFloor(time); drawObjects(time, p3); }
  else {
    drawFloor(time); drawObjects(time, p3);
    ctx.fillStyle = `rgba(20,14,40,${0.85 * ease(k)})`; ctx.fillRect(0, 0, W, H);
    if (k > 0.98) drawGroundBand(1); else { drawWalls(k); drawGroundBand(Math.max(0, (k - 0.85) / 0.15)); }
  }
  if (!hideHud) drawHUD(time);
}
function drawMenuBackdrop(time) {
  ctx.save(); ctx.globalAlpha = 0.25;
  for (let i = 0; i < 14; i++) {
    const x = (i * 97 + time * 20) % (W + 200) - 100, y = 120 + (i * 53) % 480;
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(time + i) * 0.4);
    ctx.fillStyle = '#fff6e0'; ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(34, 0); ctx.lineTo(0, 24); ctx.lineTo(-10, 0); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}
function hudText(str, x, y, size, color = '#fff', align = 'left', weight = 800) {
  ctx.font = `${weight} ${size}px system-ui,-apple-system,"Segoe UI",sans-serif`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(3, size / 6); ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineJoin = 'round';
  ctx.strokeText(str, x, y); ctx.fillStyle = color; ctx.fillText(str, x, y);
}
function drawHUD(time) {
  if (state !== 'play' && state !== 'paused' && state !== 'win') return;
  hudText('ROOM ' + (lvl + 1) + '  ·  ' + LEVELS[lvl].name, 22, 30, 22, '#fff6e0', 'left', 900);
  hudText('Moves ' + moves, 22, 58, 16, '#d6ccf5', 'left', 700);
  const L = LEVELS[lvl];
  const text = cur.m === 1 ? 'Inside the wall: ◀ ▶ walk and climb · ▲ use a portal or lever' : L.hint;
  if (text) {
    ctx.font = '700 17px system-ui'; const tw = ctx.measureText(text).width + 36;
    ctx.fillStyle = 'rgba(15,10,30,.7)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(W / 2 - tw / 2, H - 50, tw, 34, 17) : ctx.rect(W / 2 - tw / 2, H - 50, tw, 34); ctx.fill();
    hudText(text, W / 2, H - 33, 17, '#fff', 'center', 700);
  }
  if (hintMoves && hintMoves.length) {
    const g = { U: '▲', D: '▼', L: '◀', R: '▶' };
    hudText('Hint: ' + hintMoves.map(m => g[m]).join(' '), W / 2, 92, 22, '#ffd166', 'center', 900);
  }
  if (msg) {
    msg.t += 1 / 60; if (msg.t > 2.5) msg = null;
    else hudText(msg.text, W / 2, 130, 22, '#ff9e80', 'center', 800);
  }
}

// ---------------------------------------------------------------------
//  Input
// ---------------------------------------------------------------------
const KEYMAP = { ArrowUp: 'U', KeyW: 'U', Space: 'U', ArrowDown: 'D', KeyS: 'D', ArrowLeft: 'L', KeyA: 'L', ArrowRight: 'R', KeyD: 'R' };
window.addEventListener('keydown', e => {
  Sound.init();
  if (KEYMAP[e.code] || e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyM' && !e.repeat) toggleMute();
  if (state === 'play') {
    if (KEYMAP[e.code]) tryMove(KEYMAP[e.code]);
    else if (e.code === 'KeyZ' || e.code === 'Backspace') undo();
    else if (e.code === 'KeyR' && !e.repeat) restart();
    else if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) pauseGame();
  } else if (state === 'paused' && (e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) setState('play');
});
// swipes on the canvas
let swipe = null;
canvas.addEventListener('pointerdown', e => { Sound.init(); swipe = { x: e.clientX, y: e.clientY, used: false }; });
canvas.addEventListener('pointermove', e => {
  if (!swipe || swipe.used) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y, th = 26 * viewScale + 8;
  if (Math.hypot(dx, dy) > th) { swipe.used = true; tryMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'D' : 'U')); }
});
canvas.addEventListener('pointerup', () => { swipe = null; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
// on-screen pad (touch devices) with hold-to-repeat
for (const b of document.querySelectorAll('#dpad button')) {
  let rep = null;
  const go = () => tryMove(b.dataset.d);
  b.addEventListener('pointerdown', e => { e.preventDefault(); Sound.init(); go(); clearInterval(rep); rep = setInterval(go, 230); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => clearInterval(rep));
}
if (window.matchMedia('(pointer: coarse)').matches) $('dpad').style.display = 'block';
window.addEventListener('pointerdown', () => Sound.init(), true);
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(true); Sound.setHidden(document.hidden); });
$('ui').addEventListener('click', e => { const b = e.target.closest('button'); if (b && b.id !== 'muteBtn' && !b.dataset.d) Sound.play('click'); });
function toggleMute() { Sound.init(); Sound.toggleMute(); $('muteBtn').textContent = Sound.muted ? '🔇' : '🔊'; }
$('muteBtn').textContent = Sound.muted ? '🔇' : '🔊';
$('muteBtn').onclick = toggleMute;
$('playBtn').onclick = () => {
  const unlocked = Store.get('unlocked', 0);
  if (unlocked === 0 && !Object.keys(Store.get('done', {})).length) { $('playBtn').disabled = true; Platform.commercialBreak().then(() => { $('playBtn').disabled = false; loadLevel(0); }); }
  else setState('levels');
};
$('levelsBack').onclick = () => { st = null; setState('menu'); };
$('menuBtn').onclick = () => pauseGame();
$('undoBtn').onclick = undo;
$('restartBtn').onclick = restart;
$('hintBtn').onclick = hint;
$('resumeBtn').onclick = () => setState('play');
$('pRestartBtn').onclick = restart;
$('skipBtn').onclick = skipLevel;
$('toLevelsBtn').onclick = () => setState('levels');
$('winLevelsBtn').onclick = () => setState('levels');
$('nextBtn').onclick = nextLevel;
const portraitMQ = window.matchMedia('(orientation: portrait) and (pointer: coarse)');
const checkOrientation = () => { if (portraitMQ.matches) pauseGame(); };
if (portraitMQ.addEventListener) portraitMQ.addEventListener('change', checkOrientation);

// ---------------------------------------------------------------------
//  Main loop
// ---------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  let dt = (now - last) / 1000; last = now; if (dt > 0.05) dt = 0.05;
  tick(dt);
  render(now / 1000);
  requestAnimationFrame(frame);
}
function tick(dt) {
  if (!st) return;
  if (anim) { anim.t += dt / anim.dur; if (anim.t >= 1) anim = null; }
  if (fold !== foldTarget) { const sp = dt / 0.55; fold = foldTarget > fold ? Math.min(foldTarget, fold + sp) : Math.max(foldTarget, fold - sp); }
  if (deathAnim) { deathAnim.t += dt / 0.7; if (deathAnim.t >= 1) { deathAnim = null; showMsg('Mind the gap! The floor below is missing.'); } }
  if (!anim && !deathAnim && Math.abs(fold - foldTarget) < 0.01 && queued) { const q = queued; queued = null; tryMove(q); }
}
(async function boot() {
  await Platform.init();
  setState('menu');
  Platform.loadingFinished();
  requestAnimationFrame(t => { last = t; frame(t); });
  // DEBUG-START (removed from release builds by build.py)
  window.__pf = {
    get st() { return st; }, get cur() { return cur; }, get state() { return state; }, loadLevel,
    get busy() { return !!(anim || deathAnim || queued || Math.abs(fold - foldTarget) > 0.01); },
    // play a whole level through the real input path; resolves with the final state
    play(i) {
      loadLevel(i); const sol = PF.solve(st, cur, 2000000); if (!sol) return 'unsolvable';
      let t = 0; const run = () => { let n = 0; while (this.busy && n++ < 200) { tick(1 / 30); t += 1 / 30; render(t); } };
      for (const m of sol) { run(); tryMove(m); }
      run(); return (cur.won ? 'won ' : 'NOT WON ') + sol.length;
    }, tryMove, undo, restart, PF,
    // play the solver's solution instantly (no animation)
    autoSolve() { const sol = PF.solve(st, cur, 2000000); if (!sol) return 'none'; for (const m of sol) { const r = PF.step(st, cur, m); cur = r.s; moves++; } fold = foldTarget = cur.m; anim = null; if (cur.won) winLevel(); return sol.length; },
    setFold(v) { fold = foldTarget = v; },
    // jump n moves into the solution (for screenshots)
    jump(n) { const sol = PF.solve(st, cur, 2000000); for (const m of sol.slice(0, n)) { cur = PF.step(st, cur, m).s; moves++; } anim = null; fold = foldTarget = cur.m; return cur.m; },
    set hideHud(v) { hideHud = v; },
    snap(w = 1920) {
      const vs = viewScale, d = dpr; viewScale = w / W; dpr = 1; canvas.width = w; canvas.height = Math.round(w * H / W);
      render(performance.now() / 1000); const url = canvas.toDataURL('image/png'); viewScale = vs; dpr = d; resize(); return url;
    },
  };
  // DEBUG-END
})();
})();
