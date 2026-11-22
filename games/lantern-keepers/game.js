'use strict';
(() => {
// =====================================================================
//  Lantern Keepers
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
  get(k, d) { try { const v = localStorage.getItem('lantern_keepers_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('lantern_keepers_' + k, JSON.stringify(v)); } catch (e) { } },
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

const LK = window.LK, LEVELS = window.LK_LEVELS;
const TILE = 72, OX = 64, OY = 52;
const COLS = [{ name: 'Amber', light: '#ffb347', body: '#e8893a', dark: '#8a4a12', glow: 'rgba(255,179,71,' }, { name: 'Teal', light: '#4fe3d0', body: '#2fb3a3', dark: '#11645a', glow: 'rgba(79,227,208,' }];

// ---------------------------------------------------------------------
//  Sound
// ---------------------------------------------------------------------
{
  const { tone, noise, N } = Sound;
  Sound.define({
    click: () => tone('triangle', 700, 900, 0.06, 0.12),
    step: who => { tone('sine', who ? 520 : 390, who ? 480 : 360, 0.06, 0.07); noise(0.04, 0.03, 'highpass', 3000, 3000); },
    bump: () => tone('sine', 150, 110, 0.09, 0.14),
    bridge: () => { tone('sine', N(84), N(91), 0.25, 0.05); tone('sine', N(88), N(96), 0.25, 0.04, Sound.now() + 0.05); },
    door: () => noise(0.25, 0.1, 'lowpass', 700, 200),
    exit: () => tone('triangle', N(79), N(84), 0.2, 0.1),
    win: () => { const t = Sound.now(); [72, 76, 79, 83, 86].forEach((n, i) => tone('triangle', N(n), N(n), 0.35, 0.13, t + i * 0.09)); },
    undo: () => tone('triangle', 600, 400, 0.08, 0.1),
    star: i => tone('triangle', N(84 + i * 4), N(84 + i * 4), 0.25, 0.14),
  }, (step, t) => {
    // a slow music-box waltz
    const STEP = 0.36, bus = Sound.musBus, bar = Math.floor(step / 6) % 8, s = step % 6;
    const CH = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59], [57, 60, 64], [50, 53, 57], [52, 56, 59], [57, 60, 64]][bar];
    if (s === 0) tone('sine', N(CH[0] - 12), N(CH[0] - 12), STEP * 5, 0.04, t, bus);
    if (s === 2 || s === 4) for (const n of CH) tone('sine', N(n), N(n), STEP * 1.2, 0.012, t, bus);
    if (s % 2 === 1 && (bar + s) % 3 !== 0) { const n = CH[(s + bar) % 3] + 12; tone('triangle', N(n), N(n), STEP * 1.8, 0.022, t, bus); }
    return STEP;
  });
}

// ---------------------------------------------------------------------
//  State
// ---------------------------------------------------------------------
let state = 'menu';            // menu | levels | play | paused | win
let li = 0, st = null, cur = null, undoStack = [], moves = 0, par = 0, seen = null, hintMoves = null, msg = null, hideHud = false;
const draw = [[0, 0], [0, 0]];   // drawn positions (smoothly follow cur)
const done = Store.get('done', {});
const unlocked = () => Math.min(LEVELS.length - 1, Store.get('unlocked', 0));
const starsFor = m => m <= par ? 3 : m <= Math.ceil(par * 1.4) ? 2 : 1;

function loadLevel(i) {
  li = i; st = LK.parse(LEVELS[i]); cur = LK.init(st); undoStack = []; moves = 0; hintMoves = null; msg = null;
  par = (LK.solve(st) || []).length;
  seen = new Uint8Array(st.W * st.H);
  for (let k = 0; k < 2; k++) { draw[k] = cur.p[k].slice(); }
  markSeen();
  setState('play');
}
function markSeen() { for (let y = 0; y < st.H; y++) for (let x = 0; x < st.W; x++) if (LK.lit(x, y, cur.p[0]) || LK.lit(x, y, cur.p[1])) seen[y * st.W + x] = 1; }

function tryMove(who, dir) {
  if (state !== 'play') return;
  const r = LK.step(st, cur, who, dir);
  if (!r) {
    Sound.play('bump', 0.08); bump[who] = 0.18;
    const [dx, dy] = LK.DIRS[dir], tx = cur.p[who][0] + dx, ty = cur.p[who][1] + dy;
    const t = tx >= 0 && ty >= 0 && tx < st.W && ty < st.H ? st.tiles[ty * st.W + tx] : '#';
    if (t === '=') showMsg('Too dark! Bridges need both lanterns shining on them.');
    else if (t === 'a') showMsg('Amber floor only exists in Amber\'s light.');
    else if (t === 't') showMsg('Teal floor only exists in Teal\'s light.');
    else if (t === 'P' || t === 'Q') showMsg('The door is shut. Someone has to stand on its plate.');
    else if (t !== '#' && t !== ' ') showMsg('Not now: that would leave your partner in the dark.');
    return;
  }
  const doorsBefore = [LK.plateOn(st, cur, 'p'), LK.plateOn(st, cur, 'q')];
  undoStack.push(cur); cur = r; moves++;
  Sound.play('step', 0.02, who);
  const nt = st.tiles[r.p[who][1] * st.W + r.p[who][0]];
  if (nt === '=') Sound.play('bridge', 0.15);
  if (LK.plateOn(st, cur, 'p') !== doorsBefore[0] || LK.plateOn(st, cur, 'q') !== doorsBefore[1]) Sound.play('door');
  if (st.exits.includes(r.p[who][1] * st.W + r.p[who][0])) Sound.play('exit');
  if (hintMoves && hintMoves[0][0] === who && hintMoves[0][1] === dir) hintMoves = hintMoves.slice(1); else hintMoves = null;
  markSeen();
  if (LK.won(st, cur)) { Sound.play('win'); setTimeout(winLevel, 700); state = 'won'; }
}
const bump = [0, 0];
function undo() { if (state !== 'play' || !undoStack.length) return; cur = undoStack.pop(); moves = Math.max(0, moves - 1); hintMoves = null; Sound.play('undo'); }
function restart() { if (!st) return; const keep = seen; loadLevel(li); seen = keep; Sound.play('undo'); }
function showMsg(t) { msg = { t, life: 2.6 }; }
function winLevel() {
  const prev = done[li], s = starsFor(moves);
  if (!prev || moves < prev) { done[li] = moves; Store.set('done', done); }
  Store.set('unlocked', Math.max(Store.get('unlocked', 0), li + 1));
  const last = li === LEVELS.length - 1;
  $('winTitle').textContent = last ? 'DAWN BREAKS!' : 'LIGHT FOUND!';
  $('stars').innerHTML = [0, 1, 2].map(i => `<span class="${i < s ? '' : 'off'}">★</span>`).join('');
  for (let i = 0; i < s; i++) setTimeout(() => Sound.play('star', 0, i), 250 + i * 180);
  $('winStats').innerHTML = `${LEVELS[li].name}<br>Moves <b>${moves}</b> · Best possible ${par}` + (prev ? ` · Your best ${Math.min(prev, moves)}` : '');
  $('nextBtn').textContent = last ? 'Levels ☰' : 'Next ▶';
  if (s === 3) Platform.happy();
  setState('win');
}
function nextLevel() {
  if (li >= LEVELS.length - 1) { setState('levels'); return; }
  const n = li + 1; $('nextBtn').disabled = true;
  const go = () => { $('nextBtn').disabled = false; loadLevel(n); };
  if (n % 3 === 0) Platform.commercialBreak().then(go); else go();
}
function hint() {
  if (state !== 'play') return;
  const sol = LK.solve(st, cur);
  if (!sol) { showMsg('No way out from here. Undo or restart!'); return; }
  Platform.rewardedBreak().then(ok => { if (ok) { hintMoves = sol.slice(0, 6); showMsg('Follow the arrows!'); } });
}
function skipLevel() {
  Platform.rewardedBreak().then(ok => { if (!ok) return; Store.set('unlocked', Math.max(Store.get('unlocked', 0), li + 1)); if (li < LEVELS.length - 1) loadLevel(li + 1); else setState('levels'); });
}

// ---------------------------------------------------------------------
//  Screens
// ---------------------------------------------------------------------
function setState(s, focusLoss) {
  state = s;
  if (s === 'play') Platform.gameplayStart(); else if (!(focusLoss && Platform.kind === 'crazy')) Platform.gameplayStop();
  for (const el of document.querySelectorAll('.screen')) if (el.id !== 'adstub') el.classList.toggle('show', el.id === ({ menu: 'menu', levels: 'levels', paused: 'pause', win: 'win' }[s]));
  $('pauseBtn').style.display = s === 'play' ? 'block' : 'none';
  $('pads').style.display = s === 'play' && touchUI ? 'block' : 'none';
  if (s === 'levels') renderLevels();
  if (s === 'menu') { const n = Object.keys(done).length; $('menuInfo').textContent = n ? `${n} / ${LEVELS.length} levels lit` : `${LEVELS.length} dark places, two lanterns`; }
  Sound.music();
}
function renderLevels() {
  const g = $('grid'); g.innerHTML = '';
  const un = unlocked();
  LEVELS.forEach((L, i) => {
    const b = document.createElement('button'), st0 = done[i];
    b.className = 'lvl' + (st0 ? ' done' : '');
    let stars = '';
    if (st0) { const p = (LK.solve(LK.parse(L)) || []).length, s = st0 <= p ? 3 : st0 <= Math.ceil(p * 1.4) ? 2 : 1; stars = '★'.repeat(s) + '☆'.repeat(3 - s); }
    b.innerHTML = `${i + 1}<small>${st0 ? stars : i <= un ? L.name : '🔒'}</small>`;
    b.disabled = i > un; b.onclick = () => loadLevel(i);
    g.appendChild(b);
  });
}
function pauseGame(focusLoss) { if (state === 'play') setState('paused', focusLoss === true); }

// ---------------------------------------------------------------------
//  Drawing
// ---------------------------------------------------------------------
const dark = document.createElement('canvas'); dark.width = W; dark.height = H; const dctx = dark.getContext('2d');
const tx = x => OX + x * TILE, ty = y => OY + y * TILE;
function tileAt(x, y) { return x < 0 || y < 0 || x >= st.W || y >= st.H ? '#' : st.tiles[y * st.W + x]; }
function drawTiles(time) {
  for (let y = 0; y < st.H; y++) for (let x = 0; x < st.W; x++) {
    const t = st.tiles[y * st.W + x], X = tx(x), Y = ty(y);
    if (t === '#') {
      ctx.fillStyle = '#2a2740'; ctx.fillRect(X, Y, TILE, TILE);
      ctx.fillStyle = '#353152'; ctx.fillRect(X + 3, Y + 3, TILE - 6, TILE / 2 - 4); ctx.fillRect(X + 3, Y + TILE / 2 + 1, TILE / 2 - 4, TILE / 2 - 4); ctx.fillRect(X + TILE / 2 + 1, Y + TILE / 2 + 1, TILE / 2 - 4, TILE / 2 - 4);
      continue;
    }
    if (t === ' ' || t === '=' || t === 'a' || t === 't') {
      // abyss under everything that can vanish
      ctx.fillStyle = '#06050d'; ctx.fillRect(X, Y, TILE, TILE);
      for (let k = 0; k < 3; k++) { const ph = (time * 0.05 + (x * 7 + y * 13 + k * 31) % 100 / 100) % 1; circle(X + ((x * 37 + k * 23) % TILE), Y + ph * TILE, 1.2, 'rgba(160,150,220,.35)'); }
    }
    if (t === '=') {
      const both = LK.lit(x, y, cur.p[0]) && LK.lit(x, y, cur.p[1]), one = LK.lit(x, y, cur.p[0]) || LK.lit(x, y, cur.p[1]);
      if (both) {
        const g = ctx.createLinearGradient(X, Y, X + TILE, Y + TILE); g.addColorStop(0, '#fff6c9'); g.addColorStop(1, '#bfe9ff');
        ctx.fillStyle = g; ctx.fillRect(X + 4, Y + 10, TILE - 8, TILE - 20);
        ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2; ctx.strokeRect(X + 4, Y + 10, TILE - 8, TILE - 20);
        for (let k = 0; k < 3; k++) circle(X + 14 + k * 22, Y + TILE / 2 + Math.sin(time * 3 + k + x) * 6, 2.5, '#fff');
      } else if (one || seen[y * st.W + x]) {
        ctx.setLineDash([4, 6]); ctx.strokeStyle = `rgba(220,230,255,${one ? 0.55 + 0.25 * Math.sin(time * 4 + x) : 0.25})`; ctx.lineWidth = 2;
        ctx.strokeRect(X + 6, Y + 12, TILE - 12, TILE - 24); ctx.setLineDash([]);
      }
      continue;
    }
    if (t === 'a' || t === 't') {
      const who = t === 'a' ? 0 : 1, on = LK.lit(x, y, cur.p[who]), C = COLS[who];
      if (on) {
        ctx.fillStyle = C.light; ctx.globalAlpha = 0.85; ctx.fillRect(X + 3, Y + 3, TILE - 6, TILE - 6); ctx.globalAlpha = 1;
        ctx.strokeStyle = C.dark; ctx.lineWidth = 2; ctx.strokeRect(X + 3, Y + 3, TILE - 6, TILE - 6);
        ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(X + 8, Y + 8, TILE - 16, 6);
      } else { ctx.setLineDash([5, 6]); ctx.strokeStyle = C.light; ctx.globalAlpha = 0.45; ctx.lineWidth = 2; ctx.strokeRect(X + 6, Y + 6, TILE - 12, TILE - 12); ctx.setLineDash([]); ctx.globalAlpha = 1; }
      continue;
    }
    if (t === ' ') continue;
    // floor
    ctx.fillStyle = (x + y) % 2 ? '#4b4466' : '#544c72'; ctx.fillRect(X, Y, TILE, TILE);
    ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1; ctx.strokeRect(X + 0.5, Y + 0.5, TILE - 1, TILE - 1);
    if (t === 'X') {
      const g = ctx.createRadialGradient(X + TILE / 2, Y + TILE / 2, 4, X + TILE / 2, Y + TILE / 2, TILE * 0.55);
      g.addColorStop(0, `rgba(255,246,201,${0.75 + 0.2 * Math.sin(time * 3)})`); g.addColorStop(1, 'rgba(255,246,201,0)');
      ctx.fillStyle = g; ctx.fillRect(X, Y, TILE, TILE);
      ctx.strokeStyle = '#fff6c9'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(X + TILE / 2, Y + TILE / 2, 20, 0, TAU); ctx.stroke();
      for (let k = 0; k < 4; k++) { const a = time + k * TAU / 4; circle(X + TILE / 2 + Math.cos(a) * 26, Y + TILE / 2 + Math.sin(a) * 26, 2.5, '#fff6c9'); }
    } else if (t === 'p' || t === 'q') {
      const on = LK.plateOn(st, cur, t), col = t === 'p' ? '#e76f8a' : '#8ab4ff';
      ctx.fillStyle = col; ctx.globalAlpha = on ? 1 : 0.7; rr(X + 14, Y + (on ? 18 : 14), TILE - 28, TILE - 28, 8); ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 2; ctx.stroke();
    } else if (t === 'P' || t === 'Q') {
      const open = LK.plateOn(st, cur, t === 'P' ? 'p' : 'q'), col = t === 'P' ? '#e76f8a' : '#8ab4ff';
      if (!open) { ctx.fillStyle = col; ctx.fillRect(X + 4, Y + 4, TILE - 8, TILE - 8); ctx.fillStyle = 'rgba(0,0,0,.25)'; for (let k = 0; k < 4; k++) ctx.fillRect(X + 10 + k * 15, Y + 6, 4, TILE - 12); }
      else { ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.setLineDash([6, 5]); ctx.strokeRect(X + 6, Y + 6, TILE - 12, TILE - 12); ctx.setLineDash([]); }
    }
  }
}
function drawKeeper(k, time) {
  const C = COLS[k], [x, y] = draw[k], X = tx(x) + TILE / 2 + (bump[k] > 0 ? Math.sin(bump[k] * 60) * 4 : 0), Y = ty(y) + TILE / 2;
  const bob = Math.sin(time * 5 + k * 2) * 2;
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(X, Y + 22, 18, 6, 0, 0, TAU); ctx.fill();
  // cloak
  ctx.fillStyle = C.body; ctx.beginPath(); ctx.moveTo(X - 17, Y + 22); ctx.quadraticCurveTo(X - 15, Y - 10 + bob, X, Y - 20 + bob); ctx.quadraticCurveTo(X + 15, Y - 10 + bob, X + 17, Y + 22); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = C.dark; ctx.lineWidth = 2; ctx.stroke();
  // face in the hood
  circle(X, Y - 6 + bob, 9, '#1b1830'); circle(X - 3, Y - 7 + bob, 1.8, '#fff'); circle(X + 3, Y - 7 + bob, 1.8, '#fff');
  // lantern
  const lx = X + 17, ly = Y + 4 + bob;
  const g = ctx.createRadialGradient(lx, ly, 2, lx, ly, 22); g.addColorStop(0, C.glow + '0.95)'); g.addColorStop(1, C.glow + '0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(lx, ly, 22, 0, TAU); ctx.fill();
  ctx.fillStyle = '#3a3346'; ctx.fillRect(lx - 5, ly - 9, 10, 3); ctx.fillStyle = C.light; ctx.fillRect(lx - 4, ly - 6, 8, 10);
}
function render(time) {
  ctx.setTransform(viewScale * dpr, 0, 0, viewScale * dpr, 0, 0);
  ctx.fillStyle = '#06050d'; ctx.fillRect(0, 0, W, H);
  if (!st) { drawMenuBg(time); return; }
  drawTiles(time);
  // hint arrows
  if (hintMoves && hintMoves.length) {
    const [who, d] = hintMoves[0], [dx, dy] = LK.DIRS[d], p = cur.p[who];
    const ax = tx(p[0]) + TILE / 2 + dx * 30, ay = ty(p[1]) + TILE / 2 + dy * 30;
    ctx.save(); ctx.translate(ax, ay); ctx.rotate(Math.atan2(dy, dx)); ctx.globalAlpha = 0.6 + 0.4 * Math.sin(time * 8);
    ctx.fillStyle = COLS[who].light; ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(0, -14); ctx.lineTo(0, -6); ctx.lineTo(-14, -6); ctx.lineTo(-14, 6); ctx.lineTo(0, 6); ctx.lineTo(0, 14); ctx.fill();
    ctx.restore();
  }
  for (const k of [0, 1]) drawKeeper(k, time);
  // darkness: black everywhere, dim where you've been, open where the lanterns shine
  dctx.setTransform(1, 0, 0, 1, 0, 0); dctx.globalCompositeOperation = 'source-over'; dctx.clearRect(0, 0, W, H);
  dctx.fillStyle = 'rgba(4,3,10,1)'; dctx.fillRect(0, 0, W, H);
  dctx.globalCompositeOperation = 'destination-out';
  dctx.fillStyle = 'rgba(0,0,0,.28)';
  for (let y = 0; y < st.H; y++) for (let x = 0; x < st.W; x++) if (seen[y * st.W + x]) dctx.fillRect(tx(x), ty(y), TILE, TILE);
  for (const k of [0, 1]) {
    const X = tx(draw[k][0]) + TILE / 2, Y = ty(draw[k][1]) + TILE / 2, r = (LK.R + 0.55) * TILE * (1 + Math.sin(time * 7 + k * 3) * 0.015);
    const g = dctx.createRadialGradient(X, Y, r * 0.35, X, Y, r); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.75, 'rgba(0,0,0,.85)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    dctx.fillStyle = g; dctx.beginPath(); dctx.arc(X, Y, r, 0, TAU); dctx.fill();
  }
  ctx.save(); ctx.setTransform(dpr * viewScale, 0, 0, dpr * viewScale, 0, 0); ctx.drawImage(dark, 0, 0); ctx.restore();
  // exits glow through the dark like beacons, so you always know where to head
  for (const e of st.exits) {
    const X = tx(e % st.W) + TILE / 2, Y = ty((e / st.W) | 0) + TILE / 2, a = 0.35 + 0.15 * Math.sin(time * 2.5);
    const g = ctx.createRadialGradient(X, Y, 0, X, Y, 40); g.addColorStop(0, `rgba(255,246,201,${a})`); g.addColorStop(1, 'rgba(255,246,201,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, 40, 0, TAU); ctx.fill();
    circle(X, Y, 3, `rgba(255,246,201,${a + 0.3})`);
  }
  // warm/cool tint of each lantern
  ctx.globalCompositeOperation = 'lighter';
  for (const k of [0, 1]) {
    const X = tx(draw[k][0]) + TILE / 2, Y = ty(draw[k][1]) + TILE / 2, r = LK.R * TILE;
    const g = ctx.createRadialGradient(X, Y, 0, X, Y, r); g.addColorStop(0, COLS[k].glow + '0.16)'); g.addColorStop(1, COLS[k].glow + '0)');
    ctx.fillStyle = g; ctx.fillRect(X - r, Y - r, r * 2, r * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
  if (!hideHud) drawHUD(time);
}
function drawMenuBg(time) {
  for (let i = 0; i < 40; i++) { const x = (i * 131 + time * 10 * (1 + i % 3)) % (W + 40) - 20, y = (i * 71) % H; circle(x, y, 1.5 + i % 3, i % 2 ? 'rgba(255,179,71,.35)' : 'rgba(79,227,208,.35)'); }
}
function drawHUD(time) {
  if (state === 'menu' || state === 'levels') return;
  hudText(`${li + 1}. ${LEVELS[li].name}`, OX, 26, 20, '#f3eaff', 'left', 900);
  hudText(`Moves ${moves}  ·  best possible ${par}`, OX + 360, 26, 15, '#b9addb', 'left', 700);
  for (const b of hudButtons()) { ctx.fillStyle = 'rgba(255,255,255,.1)'; rr(b.x, b.y, b.w, b.h, 8); ctx.fill(); hudText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1, 15, b.c || '#fff', 'center', 800, null); }
  const text = msg ? msg.t : moves === 0 ? LEVELS[li].hint : '';
  if (msg) { msg.life -= 1 / 60; if (msg.life <= 0) msg = null; }
  if (text) {
    ctx.font = '700 17px system-ui'; const tw = ctx.measureText(text).width + 36;
    ctx.fillStyle = 'rgba(10,8,22,.85)'; rr(W / 2 - tw / 2, H - 42, tw, 32, 16); ctx.fill();
    hudText(text, W / 2, H - 26, 17, msg ? '#ffd9a0' : '#fff', 'center', 700);
  }
}
function hudButtons() {
  if (state !== 'play') return [];
  return [
    { id: 'undo', x: W - 410, y: 8, w: 80, h: 34, label: '↶ Undo' },
    { id: 'restart', x: W - 322, y: 8, w: 70, h: 34, label: '↺ Retry' },
    { id: 'hint', x: W - 244, y: 8, w: 90, h: 34, label: '🎬 Hint', c: '#e2c6ff' },
  ];
}

// ---------------------------------------------------------------------
//  Input: WASD = Amber, arrows = Teal, on-screen pads on touch screens
// ---------------------------------------------------------------------
const KEYS = { KeyW: [0, 'U'], KeyS: [0, 'D'], KeyA: [0, 'L'], KeyD: [0, 'R'], ArrowUp: [1, 'U'], ArrowDown: [1, 'D'], ArrowLeft: [1, 'L'], ArrowRight: [1, 'R'] };
const held = {};
window.addEventListener('keydown', e => {
  if (KEYS[e.code] || e.code === 'Space') e.preventDefault();
  if (state === 'play') {
    if (KEYS[e.code] && !held[e.code]) { held[e.code] = { t: 0.22 }; tryMove(...KEYS[e.code]); }
    if (e.code === 'KeyZ' || e.code === 'Backspace') undo();
    if (e.code === 'KeyR' && !e.repeat) restart();
    if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) pauseGame();
  } else if (state === 'paused' && (e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) setState('play');
});
window.addEventListener('keyup', e => { delete held[e.code]; });
window.addEventListener('blur', () => { for (const k in held) delete held[k]; });
function keyRepeat(dt) {
  if (state !== 'play') return;
  for (const code in held) { const h = held[code]; h.t -= dt; if (h.t <= 0) { h.t = 0.13; tryMove(...KEYS[code]); } }
}
canvas.addEventListener('pointerdown', e => {
  if (state !== 'play') return;
  const p = toCanvas(e);
  for (const b of hudButtons()) if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) { Sound.play('click'); if (b.id === 'undo') undo(); else if (b.id === 'restart') restart(); else hint(); }
});
const touchUI = window.matchMedia('(pointer: coarse)').matches;
for (const b of document.querySelectorAll('.pad button')) {
  let rep = null;
  const go = () => tryMove(+b.parentElement.dataset.who, b.dataset.d);
  b.addEventListener('pointerdown', e => { e.preventDefault(); Sound.init(); go(); clearInterval(rep); rep = setInterval(go, 170); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => clearInterval(rep));
}
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(true); Sound.setHidden(document.hidden); });
$('ui').addEventListener('click', e => { const b = e.target.closest('button'); if (b && b.id !== 'muteBtn' && !b.dataset.d) Sound.play('click'); });
setupMute();
$('playBtn').onclick = () => { if (!Object.keys(done).length) { $('playBtn').disabled = true; Platform.commercialBreak().then(() => { $('playBtn').disabled = false; loadLevel(0); }); } else setState('levels'); };
$('levelsBack').onclick = () => setState('menu');
$('pauseBtn').onclick = () => pauseGame();
$('resumeBtn').onclick = () => setState('play');
$('restartBtn').onclick = () => { setState('play'); restart(); };
$('skipBtn').onclick = skipLevel;
$('toLevels').onclick = () => setState('levels');
$('retryBtn').onclick = () => loadLevel(li);
$('nextBtn').onclick = nextLevel;
const portraitMQ = window.matchMedia('(orientation: portrait) and (pointer: coarse)');
if (portraitMQ.addEventListener) portraitMQ.addEventListener('change', () => { if (portraitMQ.matches) pauseGame(); });

// ---------------------------------------------------------------------
//  Main loop
// ---------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  let dt = (now - last) / 1000; last = now; if (dt > 0.05) dt = 0.05;
  keyRepeat(dt);
  if (st) for (const k of [0, 1]) { for (const a of [0, 1]) draw[k][a] += (cur.p[k][a] - draw[k][a]) * Math.min(1, dt * 16); bump[k] = Math.max(0, bump[k] - dt); }
  render(now / 1000);
  requestAnimationFrame(frame);
}
(async function boot() {
  await Platform.init();
  setState('menu');
  Platform.loadingFinished();
  requestAnimationFrame(t => { last = t; frame(t); });
  // DEBUG-START (removed from release builds by build.py)
  window.__lk = {
    get state() { return state; }, get cur() { return cur; }, get moves() { return moves; }, loadLevel, tryMove, LK, LEVELS,
    // play a level with the solver's moves through the real input path
    play(i) { loadLevel(i); const sol = LK.solve(st); for (const [w, d] of sol) tryMove(w, d); return LK.won(st, cur) ? 'won in ' + moves : 'NOT WON'; },
    jump(n) { const sol = LK.solve(st); for (const [w, d] of sol.slice(0, n)) tryMove(w, d); for (const k of [0, 1]) draw[k] = cur.p[k].slice(); },
    set hideHud(v) { hideHud = v; },
    revealAll() { seen.fill(1); },
    // store-art scene: every kind of tile around the two keepers
    stage() {
      loadLevel(0);
      st = LK.parse({ name: 'Promo', map: [
        '################',
        '#....#    #...X#',
        '#.p..aaa  #....#',
        '#....#  a===...#',
        '#..A.T..t  #...#',
        '#....#  tt=....#',
        '#....P    #...X#',
        '#....#    #....#',
        '################'] });
      cur = LK.init(st); cur.p = [[8, 3], [9, 5]]; for (const k of [0, 1]) draw[k] = cur.p[k].slice();
      seen = new Uint8Array(st.W * st.H).fill(1); moves = 0; par = 0;
    },
    snap(w = 1920) {
      const vs = viewScale, d = dpr; viewScale = w / W; dpr = 1; canvas.width = w; canvas.height = Math.round(w * H / W);
      render(performance.now() / 1000); const url = canvas.toDataURL('image/png'); viewScale = vs; dpr = d; resize(); return url;
    },
  };
  // DEBUG-END
})();

})();
