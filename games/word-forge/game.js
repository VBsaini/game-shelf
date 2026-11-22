'use strict';
(() => {
// =====================================================================
//  Word Forge
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
  get(k, d) { try { const v = localStorage.getItem('word_forge_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('word_forge_' + k, JSON.stringify(v)); } catch (e) { } },
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
//  Word Forge: spell words with metal letter tiles to forge blades and
//  beat the monsters of three acts.
// =====================================================================
const VAL = { a: 1, b: 3, c: 3, d: 2, e: 1, f: 3, g: 2, h: 3, i: 1, j: 5, k: 4, l: 1, m: 3, n: 1, o: 1, p: 3, q: 6, r: 1, s: 1, t: 1, u: 1, v: 4, w: 3, x: 5, y: 3, z: 6 };
const FREQ = 'eeeeeeeeeeeeaaaaaaaaaiiiiiiiiioooooooonnnnnnrrrrrrttttttllllssssuuuuddddgggbbccmmppffhhvvwwyykjxqz';
const VOWELS = 'aeiou';
const LEN_MULT = [0, 0, 0, 1, 1.3, 1.7, 2.2, 2.8, 3.5];
const TIER = { bronze: { mult: 1, col: '#c98a4b', edge: '#7a4b1f' }, silver: { mult: 1.5, col: '#d9dde6', edge: '#7c8496' }, gold: { mult: 2, col: '#ffd34d', edge: '#9c7413' },
  ruby: { mult: 1.25, col: '#ff5d6c', edge: '#8c1f2b', gem: 'Burns the monster' }, sapphire: { mult: 1.25, col: '#5da9ff', edge: '#1d4f8c', gem: 'Heals you' }, emerald: { mult: 1.25, col: '#4fd88a', edge: '#1f7a46', gem: 'Shields the next hit' } };
const MONSTERS = [
  // act 1: the Old Woods
  { name: 'Slime', hp: 18, atk: 2, col: '#7fd17a', kind: 'blob' },
  { name: 'Goblin', hp: 26, atk: 3, col: '#8fb35a', kind: 'imp' },
  { name: 'Thief Crow', hp: 30, atk: 3, col: '#4a4e6b', kind: 'bird', trick: 'lock' },
  { name: 'Grey Wolf', hp: 40, atk: 4, col: '#8d95a3', kind: 'beast' },
  { name: 'Moss Troll', hp: 72, atk: 5, col: '#5f8f4e', kind: 'giant', trick: 'rage', boss: true },
  // act 2: the Deep Mines
  { name: 'Rust Golem', hp: 64, atk: 5, col: '#b5653a', kind: 'giant', trick: 'rust' },
  { name: 'Bat Swarm', hp: 58, atk: 6, col: '#5b4a73', kind: 'bird', trick: 'drain' },
  { name: 'Mine Mole', hp: 74, atk: 6, col: '#8a6a52', kind: 'beast', trick: 'lock' },
  { name: 'Kobold Chief', hp: 86, atk: 7, col: '#c0884a', kind: 'imp' },
  { name: 'Iron Wyrm', hp: 160, atk: 8, col: '#7d8798', kind: 'dragon', trick: 'rust', boss: true },
  // act 3: the Ember Peak
  { name: 'Frost Witch', hp: 130, atk: 8, col: '#9fd6f0', kind: 'imp', trick: 'lock' },
  { name: 'Gargoyle', hp: 150, atk: 9, col: '#8b8f99', kind: 'giant' },
  { name: 'Shade', hp: 160, atk: 10, col: '#4b3f63', kind: 'blob', trick: 'drain' },
  { name: 'Fire Drake', hp: 180, atk: 11, col: '#e8643b', kind: 'dragon', trick: 'rage' },
  { name: 'The Ember King', hp: 320, atk: 12, col: '#ff8a3d', kind: 'dragon', trick: 'rust', boss: true },
];
const ACTS = ['The Old Woods', 'The Deep Mines', 'The Ember Peak'];
const BOONS = [
  { id: 'hp', name: 'Thick Apron', desc: '+10 max health and heal fully', icon: '❤️' },
  { id: 'dmg', name: 'Whetstone', desc: 'Every blade hits 15% harder', icon: '🗡️' },
  { id: 'armor', name: 'Iron Gloves', desc: 'Take 1 less damage from every hit', icon: '🧤' },
  { id: 'potion', name: 'Healing Draught', desc: '+2 potions (each heals 15)', icon: '🧪' },
  { id: 'silver', name: 'Silversmith', desc: 'Every word leaves a silver tile', icon: '🥈' },
  { id: 'gems', name: 'Gem Cutter', desc: 'Gem tiles appear twice as often', icon: '💎' },
  { id: 'rare', name: 'Rare Ore', desc: 'Rare letters are worth +1', icon: '⛏️' },
];

// ---------------------------------------------------------------------
//  Dictionary: words as tile tokens ('qu' is one tile)
// ---------------------------------------------------------------------
const DICT = new Set(), TOKENS = [];
for (const w of window.WF_WORDS) {
  if (/q(?!u)/.test(w)) continue;                    // a lone q can't be spelled with the Qu tile
  DICT.add(w);
  const t = w.replace(/qu/g, 'q');
  if (t.length >= 3 && t.length <= 16) TOKENS.push([w, t]);
}
function letterCounts(s) { const c = new Uint8Array(26); for (let i = 0; i < s.length; i++) c[s.charCodeAt(i) - 97]++; return c; }

// ---------------------------------------------------------------------
//  Rules (pure-ish: work on a run object R)
// ---------------------------------------------------------------------
function rnd(R) { R.seed = (R.seed * 1664525 + 1013904223) >>> 0; return R.seed / 4294967296; }
function rpick(R, a) { return a[Math.floor(rnd(R) * a.length)]; }
function newRun(seed) {
  const R = { seed: seed || ((Math.random() * 1e9) | 0), stage: 0, hp: 40, maxHp: 40, dmg: 1, armor: 0, potions: 1, silver: false, gems: 1, rare: 0,
    gold: 0, words: 0, best: '', bestDmg: 0, revived: false, tiles: [], mon: null, shield: 0, log: [] };
  R.tiles = Array.from({ length: 16 }, () => newTile(R));
  balance(R); startFight(R);
  return R;
}
function newTile(R, tier = 'bronze') { return { ch: rpick(R, FREQ), tier, rust: 0, lock: 0 }; }
function balance(R) {
  // keep between 4 and 7 vowels, and at most one each of j, q, x, z
  const vowels = () => R.tiles.filter(t => VOWELS.includes(t.ch)).length;
  for (let g = 0; g < 20 && vowels() < 4; g++) { const t = rpick(R, R.tiles.filter(t => !VOWELS.includes(t.ch) && t.tier === 'bronze')); if (t) t.ch = rpick(R, 'aeiouae'); }
  for (let g = 0; g < 20 && vowels() > 7; g++) { const t = rpick(R, R.tiles.filter(t => VOWELS.includes(t.ch) && t.tier === 'bronze')); if (t) t.ch = rpick(R, 'rstlnmdcpb'); }
  for (const ch of 'jqxzkv') { const ts = R.tiles.filter(t => t.ch === ch); for (const t of ts.slice(1)) t.ch = rpick(R, 'rstlne'); }
}
function startFight(R) {
  const M = MONSTERS[R.stage];
  const act = Math.floor(R.stage / 5), hp = Math.round(M.hp * [1, 1.35, 1.6][act]), atk = M.atk + [0, 0, 1][act];
  R.mon = { ...M, hpMax: hp, hp, atk, atkNow: atk, burn: 0, turn: 0 };
  R.shield = 0;
  for (const t of R.tiles) { t.rust = 0; t.lock = 0; }
}
function tileValue(R, t) { if (t.rust) return 0; const v = VAL[t.ch] + (VAL[t.ch] >= 4 ? R.rare : 0); return v * TIER[t.tier].mult; }
function wordDamage(R, idxs) {
  const n = idxs.length; if (n < 3) return 0;
  let s = 0; for (const i of idxs) s += tileValue(R, R.tiles[i]);
  return Math.max(1, Math.round(s * LEN_MULT[Math.min(8, n)] * (n > 8 ? 1 + (n - 8) * 0.5 : 1) * R.dmg));
}
const wordOf = (R, idxs) => idxs.map(i => R.tiles[i].ch === 'q' ? 'qu' : R.tiles[i].ch).join('');
// Play a word. Returns the events of the turn (for animation) or null if not a word.
function playWord(R, idxs) {
  const word = wordOf(R, idxs);
  if (idxs.length < 3 || !DICT.has(word) || idxs.some(i => R.tiles[i].lock)) return null;
  const ev = [], n = idxs.length, dmg = wordDamage(R, idxs);
  R.words++; if (dmg > R.bestDmg) { R.bestDmg = dmg; R.best = word; }
  ev.push({ t: 'strike', dmg, word, n });
  R.mon.hp -= dmg;
  for (const i of idxs) {
    const tr = R.tiles[i].tier;
    if (tr === 'ruby') { R.mon.burn += 3; ev.push({ t: 'burn' }); }
    if (tr === 'sapphire') { const h = Math.min(6, R.maxHp - R.hp); R.hp += h; ev.push({ t: 'heal', amt: h }); }
    if (tr === 'emerald') { R.shield += 6; ev.push({ t: 'shield' }); }
  }
  // used tiles are replaced; long words leave better metal behind
  const fresh = idxs.slice();
  for (const i of fresh) R.tiles[i] = newTile(R);
  const pickNew = () => fresh.length ? fresh.splice(Math.floor(rnd(R) * fresh.length), 1)[0] : null;
  if (n >= 7 || (n >= 5 && rnd(R) < 0.22 * R.gems)) { const i = pickNew(); if (i != null) R.tiles[i].tier = rpick(R, ['ruby', 'sapphire', 'emerald']); }
  if (n >= 6) { const i = pickNew(); if (i != null) R.tiles[i].tier = 'gold'; }
  else if (n >= 5 || R.silver) { const i = pickNew(); if (i != null) R.tiles[i].tier = 'silver'; }
  balance(R);
  if (R.mon.hp <= 0) { R.mon.hp = 0; ev.push({ t: 'win' }); return ev; }
  monsterTurn(R, ev);
  return ev;
}
function shuffleTiles(R) {
  const ev = [{ t: 'shuffle' }];
  for (const t of R.tiles) if (t.tier === 'bronze' && !t.lock) t.ch = rpick(R, FREQ);
  balance(R); monsterTurn(R, ev);
  return ev;
}
function monsterTurn(R, ev) {
  const M = R.mon; M.turn++;
  for (const t of R.tiles) if (t.lock) t.lock--;
  if (M.burn > 0) { const b = Math.min(M.burn, 3) * 2; M.hp -= b; M.burn = Math.max(0, M.burn - 1); ev.push({ t: 'burnTick', dmg: b }); if (M.hp <= 0) { M.hp = 0; ev.push({ t: 'win' }); return; } }
  // tricks every other turn
  if (M.trick && M.turn % 2 === 0) {
    if (M.trick === 'rust') { const ts = R.tiles.filter(t => !t.rust && t.tier !== 'gold'); for (let k = 0; k < 2 && ts.length; k++) ts.splice(Math.floor(rnd(R) * ts.length), 1)[0].rust = 1; ev.push({ t: 'trick', s: 'Rust! Two tiles are worth nothing' }); }
    if (M.trick === 'lock') { const ts = R.tiles.filter(t => !t.lock); for (let k = 0; k < 2 && ts.length; k++) ts.splice(Math.floor(rnd(R) * ts.length), 1)[0].lock = 2; ev.push({ t: 'trick', s: 'Two tiles are locked for a turn' }); }
    if (M.trick === 'drain') { const h = Math.round(M.hpMax * 0.08); M.hp = Math.min(M.hpMax, M.hp + h); ev.push({ t: 'trick', s: M.name + ' drains ' + h + ' health' }); }
    if (M.trick === 'rage') { M.atkNow += 1; ev.push({ t: 'trick', s: M.name + ' grows angrier (+1 attack)' }); }
  }
  let hit = Math.max(1, M.atkNow - R.armor);
  const blocked = Math.min(R.shield, hit); R.shield -= blocked; hit -= blocked;
  R.hp -= hit; ev.push({ t: 'hit', dmg: hit, blocked });
  if (R.hp <= 0) { R.hp = 0; ev.push({ t: 'lose' }); }
}
function drinkPotion(R) { if (R.potions <= 0 || R.hp >= R.maxHp) return false; R.potions--; R.hp = Math.min(R.maxHp, R.hp + 15); return true; }
function applyBoon(R, id) {
  if (id === 'hp') { R.maxHp += 10; R.hp = R.maxHp; }
  if (id === 'dmg') R.dmg *= 1.15;
  if (id === 'armor') R.armor += 1;
  if (id === 'potion') R.potions += 2;
  if (id === 'silver') R.silver = true;
  if (id === 'gems') R.gems *= 2;
  if (id === 'rare') R.rare += 1;
}
function boonChoices(R) {
  const pool = BOONS.filter(b => !(b.id === 'silver' && R.silver) && !(b.id === 'gems' && R.gems > 1) && !(b.id === 'rare' && R.rare >= 2));
  const out = []; while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(rnd(R) * pool.length), 1)[0]);
  return out;
}
// Best words on the board, strongest first (used by hints and the test bot)
function findWords(R, limit = 5, maxLen = 16) {
  const counts = new Uint8Array(26), byLetter = {};
  R.tiles.forEach((t, i) => { if (t.lock) return; counts[t.ch.charCodeAt(0) - 97]++; (byLetter[t.ch] = byLetter[t.ch] || []).push(i); });
  const found = [];
  outer: for (const [w, tok] of TOKENS) {
    if (tok.length > maxLen) continue;
    const c = new Uint8Array(26);
    for (let k = 0; k < tok.length; k++) { const x = tok.charCodeAt(k) - 97; if (++c[x] > counts[x]) continue outer; }
    // choose the most valuable tile for each letter
    const used = {}, idxs = [];
    for (const ch of tok) { const opts = byLetter[ch].slice().sort((a, b) => tileValue(R, R.tiles[b]) - tileValue(R, R.tiles[a])); idxs.push(opts[used[ch] = (used[ch] || 0)]); used[ch]++; }
    found.push({ w, idxs, dmg: wordDamage(R, idxs) });
  }
  found.sort((a, b) => b.dmg - a.dmg || b.w.length - a.w.length);
  return found.slice(0, limit);
}

// ---------------------------------------------------------------------
//  Sound
// ---------------------------------------------------------------------
{
  const { tone, noise, N } = Sound;
  Sound.define({
    click: () => tone('triangle', 700, 900, 0.06, 0.12),
    tile: i => tone('square', N(67 + Math.min(i || 0, 10)), N(67 + Math.min(i || 0, 10)), 0.05, 0.05),
    untile: () => tone('square', N(60), N(55), 0.05, 0.04),
    bad: () => { tone('sawtooth', 160, 120, 0.15, 0.08); tone('sawtooth', 150, 110, 0.15, 0.06, Sound.now() + 0.1); },
    forge: n => { for (let k = 0; k < Math.min(4, n - 2); k++) { noise(0.12, 0.2, 'bandpass', 3500, 2500, Sound.now() + k * 0.07, 6); tone('triangle', 1900 + k * 120, 1700, 0.18, 0.08, Sound.now() + k * 0.07); } },
    hit: big => { noise(0.25, 0.3 + (big ? 0.15 : 0), 'lowpass', 1500, 200); tone('sine', 160, 60, 0.25, 0.3); },
    hurt: () => { noise(0.18, 0.2, 'bandpass', 600, 300, 0, 2); tone('square', 220, 110, 0.15, 0.07); },
    heal: () => { const t = Sound.now(); [72, 76, 79].forEach((n, i) => tone('sine', N(n), N(n), 0.25, 0.08, t + i * 0.06)); },
    gem: () => tone('sine', N(88), N(95), 0.3, 0.08),
    trick: () => tone('sawtooth', 300, 200, 0.3, 0.05),
    win: () => { const t = Sound.now(); [72, 76, 79, 84].forEach((n, i) => tone('triangle', N(n), N(n), 0.3, 0.13, t + i * 0.09)); },
    lose: () => { const t = Sound.now(); [67, 63, 60, 55].forEach((n, i) => tone('triangle', N(n), N(n), 0.4, 0.12, t + i * 0.14)); },
    boon: () => { const t = Sound.now(); [79, 84, 88].forEach((n, i) => tone('triangle', N(n), N(n), 0.25, 0.12, t + i * 0.07)); },
  }, (step, t, mode) => {
    // forge rhythm: low drone, anvil ticks, a modal tune
    const STEP = 60 / 96 / 2, bus = Sound.musBus, s = step % 16, bar = Math.floor(step / 16) % 4;
    const root = [45, 43, 41, 43][bar];
    if (s === 0) tone('sawtooth', N(root - 12), N(root - 12), STEP * 15, 0.02, t, bus);
    if (s % 4 === 0) noise(0.05, 0.03, 'bandpass', 3000, 3000, t, 8, bus);
    if ([0, 3, 6, 10, 12].includes(s)) { const n = root + 12 + [0, 3, 7, 10, 7][[0, 3, 6, 10, 12].indexOf(s)]; tone('triangle', N(n), N(n), STEP * 1.6, 0.022, t, bus); }
    return STEP;
  });
}

// ---------------------------------------------------------------------
//  UI state
// ---------------------------------------------------------------------
let state = 'menu';             // menu | play | boon | paused | over | victory
let R = null, sel = [], anims = [], floaters = [], shake = 0, monFlash = 0, heroFlash = 0, hintIdx = null, busy = 0, hideHud = false, toastMsg = null;
const save = { best: Store.get('best', 0), wins: Store.get('wins', 0) };
const GRID = { x: 640 - 2 * 74 + 2, y: 404, s: 70, g: 4 };
function tileRect(i) { const c = i % 4, r = (i / 4) | 0; return { x: GRID.x + c * (GRID.s + GRID.g), y: GRID.y + r * (GRID.s + GRID.g), w: GRID.s, h: GRID.s }; }
const BTN = { forge: { x: 946, y: 520, w: 210, h: 92 }, clear: { x: 180, y: 470, w: 170, h: 58 }, shuffle: { x: 180, y: 540, w: 170, h: 58 }, potion: { x: 180, y: 610, w: 170, h: 58 }, hint: { x: 946, y: 628, w: 210, h: 46 } };

function startRun(seed) { R = newRun(seed); sel = []; hintIdx = null; floaters = []; setState('play'); }
function toggleTile(i) {
  if (state !== 'play' || busy > 0) return;
  const k = sel.indexOf(i);
  if (k >= 0) { sel.splice(k, 1); Sound.play('untile'); return; }
  if (R.tiles[i].lock) { toast('That tile is locked'); Sound.play('bad'); return; }
  sel.push(i); Sound.play('tile', 0, sel.length);
}
function typeLetter(ch) {
  if (state !== 'play' || busy > 0) return;
  const i = R.tiles.findIndex((t, j) => t.ch === ch && !sel.includes(j) && !t.lock);
  if (i >= 0) toggleTile(i); else Sound.play('bad');
}
function forge() {
  if (state !== 'play' || busy > 0) return;
  if (sel.length < 3) { toast('Words need at least 3 letters'); Sound.play('bad'); return; }
  const word = wordOf(R, sel), ev = playWord(R, sel);
  if (!ev) { toast(`"${word.toUpperCase()}" isn't a word I know`); Sound.play('bad'); return; }
  sel = []; hintIdx = null;
  runEvents(ev);
}
function doShuffle() { if (state !== 'play' || busy > 0) return; sel = []; hintIdx = null; runEvents(shuffleTiles(R)); }
function potion() { if (state !== 'play' || busy > 0) return; if (drinkPotion(R)) { Sound.play('heal'); floaters.push({ x: 250, y: 200, s: '+15', c: '#7dff9a', t: 0 }); } else Sound.play('bad'); }
function runEvents(ev) {
  let t = 0; busy = 1;
  for (const e of ev) {
    const at = t;
    if (e.t === 'strike') { setTimeout(() => { Sound.play('forge', 0, e.n); anims.push({ k: 'blade', t: 0, n: e.n, word: e.word }); }, at * 1000); setTimeout(() => { Sound.play('hit', 0, e.dmg > 30); monFlash = 0.3; shake = Math.min(14, 4 + e.dmg / 6); floaters.push({ x: 900, y: 160, s: '-' + e.dmg, c: '#ffd34d', t: 0, big: true }); }, (at + 0.45) * 1000); t += 0.8; }
    if (e.t === 'heal' && e.amt) { setTimeout(() => { Sound.play('heal'); floaters.push({ x: 250, y: 200, s: '+' + e.amt, c: '#7dff9a', t: 0 }); }, at * 1000); }
    if (e.t === 'shield') setTimeout(() => { Sound.play('gem'); floaters.push({ x: 250, y: 170, s: '+6 shield', c: '#7dffc0', t: 0 }); }, at * 1000);
    if (e.t === 'burn') setTimeout(() => { Sound.play('gem'); floaters.push({ x: 900, y: 120, s: 'Burning!', c: '#ff8a65', t: 0 }); }, at * 1000);
    if (e.t === 'burnTick') { setTimeout(() => { floaters.push({ x: 930, y: 190, s: '🔥-' + e.dmg, c: '#ff8a65', t: 0 }); monFlash = 0.15; }, at * 1000); t += 0.35; }
    if (e.t === 'shuffle') t += 0.2;
    if (e.t === 'trick') { setTimeout(() => { Sound.play('trick'); toast(e.s); }, at * 1000); t += 0.5; }
    if (e.t === 'hit') { setTimeout(() => { anims.push({ k: 'lunge', t: 0 }); }, at * 1000); setTimeout(() => { Sound.play('hurt'); heroFlash = 0.3; shake = 8; floaters.push({ x: 250, y: 190, s: e.dmg ? '-' + e.dmg : 'Blocked!', c: e.dmg ? '#ff6b6b' : '#7dffc0', t: 0, big: true }); }, (at + 0.25) * 1000); t += 0.6; }
    if (e.t === 'win') setTimeout(winFight, (at + 0.5) * 1000);
    if (e.t === 'lose') setTimeout(loseRun, (at + 0.6) * 1000);
  }
  setTimeout(() => { busy = 0; }, t * 1000);
}
function winFight() {
  if (!R) return;
  Sound.play('win'); Platform.happy();
  R.stage++;
  save.best = Math.max(save.best, R.stage); Store.set('best', save.best);
  if (R.stage >= MONSTERS.length) { save.wins++; Store.set('wins', save.wins); showEnd(true); return; }
  R.hp = Math.min(R.maxHp, R.hp + Math.round(R.maxHp * 0.3));
  const ch = boonChoices(R);
  $('boonTitle').textContent = MONSTERS[R.stage - 1].name + ' defeated!';
  $('boonSub').textContent = (R.stage % 5 === 0 ? `Act ${R.stage / 5} cleared! ` : '') + 'You rest a little (+30% health). Choose a boon:';
  const box = $('boons'); box.innerHTML = '';
  for (const b of ch) {
    const d = document.createElement('button'); d.className = 'boon';
    d.innerHTML = `<i>${b.icon}</i><b>${b.name}</b><small>${b.desc}</small>`;
    d.onclick = () => { applyBoon(R, b.id); Sound.play('boon'); nextFight(); };
    box.appendChild(d);
  }
  setState('boon');
}
function nextFight() {
  const go = () => { startFight(R); sel = []; setState('play'); toast((R.stage % 5 === 0 ? ACTS[R.stage / 5] + ': ' : '') + 'A ' + R.mon.name + ' appears!'); };
  if (R.stage % 5 === 0) Platform.commercialBreak().then(go); else go();
}
function loseRun() { Sound.play('lose'); showEnd(false); }
function showEnd(won) {
  $('endTitle').textContent = won ? 'THE EMBER KING FALLS!' : 'YOUR FORGE GOES COLD';
  $('endStats').innerHTML = `${won ? 'You beat all 15 monsters!' : `Beaten by the ${R.mon.name} (${R.stage + 1} / 15)`}<br>Words forged <b>${R.words}</b> · Best blade <b>${R.best ? R.best.toUpperCase() : '-'}</b> (${R.bestDmg})<br>Furthest ever: ${save.best} / 15`;
  $('reviveBtn').style.display = !won && !R.revived ? '' : 'none';
  setState('over');
}
function revive() {
  Platform.rewardedBreak().then(ok => { if (!ok || !R) return; R.revived = true; R.hp = Math.round(R.maxHp * 0.6); Sound.play('heal'); setState('play'); toast('Back on your feet!'); });
}
function hint() {
  if (state !== 'play' || busy > 0) return;
  const best = findWords(R, 1)[0];
  if (!best) { toast('No words here. Try a shuffle!'); return; }
  Platform.rewardedBreak().then(ok => { if (!ok) return; sel = best.idxs.slice(); hintIdx = best.idxs.slice(); toast(`Try "${best.w.toUpperCase()}" for ${best.dmg}!`); });
}
function toast(s) { toastMsg = { s, t: 0 }; }

// ---------------------------------------------------------------------
//  Screens
// ---------------------------------------------------------------------
function setState(s, focusLoss) {
  state = s;
  if (s === 'play') Platform.gameplayStart(); else if (!(focusLoss && Platform.kind === 'crazy')) Platform.gameplayStop();
  for (const el of document.querySelectorAll('.screen')) if (el.id !== 'adstub') el.classList.toggle('show', el.id === ({ menu: 'menu', boon: 'boon', paused: 'pause', over: 'over' }[s]));
  $('pauseBtn').style.display = s === 'play' ? 'block' : 'none';
  if (s === 'menu') $('menuInfo').innerHTML = save.best ? `Furthest: ${save.best} / 15 monsters${save.wins ? ` · Ember King beaten ${save.wins}×` : ''}` : '15 monsters, three acts, one anvil.';
  Sound.music();
}
function pauseGame(focusLoss) { if (state === 'play') setState('paused', focusLoss === true); }

// ---------------------------------------------------------------------
//  Drawing
// ---------------------------------------------------------------------
const bg = document.createElement('canvas'); bg.width = W; bg.height = H;
{
  const b = bg.getContext('2d');
  const g = b.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#2a1d1a'); g.addColorStop(0.5, '#1b1312'); g.addColorStop(1, '#120c0b'); b.fillStyle = g; b.fillRect(0, 0, W, H);
  // stone wall
  for (let y = 0; y < 370; y += 34) for (let x = (y / 34) % 2 ? -40 : 0; x < W; x += 80) { b.fillStyle = `rgba(${70 + ((x * 7 + y) % 20)},${50 + ((x + y * 3) % 15)},${44},.55)`; b.fillRect(x + 2, y + 2, 76, 30); }
  // forge glow at the bottom
  const fg = b.createRadialGradient(640, 760, 40, 640, 760, 520); fg.addColorStop(0, 'rgba(255,140,40,.35)'); fg.addColorStop(1, 'rgba(255,140,40,0)'); b.fillStyle = fg; b.fillRect(0, 300, W, H);
  // floor line
  b.fillStyle = '#0e0908'; b.fillRect(0, 360, W, 6);
}
function drawMonster(M, x, y, s, time) {
  const bob = Math.sin(time * 2.4) * 6 * s, col = monFlash > 0 ? '#fff' : M.col;
  const dark = 'rgba(0,0,0,.28)';
  ctx.save(); ctx.translate(x, y + bob); ctx.scale(s, s);
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(0, 108 - bob / s, 90, 18, 0, 0, TAU); ctx.fill();
  const eye = (ex, ey, r) => { circle(ex, ey, r, '#fff'); circle(ex + r * 0.2, ey + r * 0.15, r * 0.5, '#1a1010'); };
  ctx.fillStyle = col;
  if (M.kind === 'blob') {
    ctx.beginPath(); ctx.moveTo(-80, 100); ctx.quadraticCurveTo(-90, -40, 0, -60); ctx.quadraticCurveTo(90, -40, 80, 100); ctx.closePath(); ctx.fill();
    ctx.fillStyle = dark; ctx.beginPath(); ctx.ellipse(-30, 40, 20, 14, 0, 0, TAU); ctx.fill();
    eye(-25, 0, 16); eye(25, 0, 16);
  } else if (M.kind === 'imp') {
    ctx.beginPath(); ctx.ellipse(0, 40, 55, 65, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(0, -40, 48, 0, TAU); ctx.fill();
    for (const k of [-1, 1]) { ctx.beginPath(); ctx.moveTo(k * 30, -70); ctx.lineTo(k * 70, -110); ctx.lineTo(k * 46, -55); ctx.fill(); }
    eye(-17, -45, 11); eye(17, -45, 11);
    ctx.strokeStyle = '#1a1010'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, -25, 16, 0.2, Math.PI - 0.2); ctx.stroke();
  } else if (M.kind === 'bird') {
    const f = Math.sin(time * 12) * 20;
    for (const k of [-1, 1]) { ctx.beginPath(); ctx.moveTo(k * 20, 0); ctx.quadraticCurveTo(k * 110, -60 + f, k * 130, 10 + f); ctx.quadraticCurveTo(k * 80, 20, k * 20, 40); ctx.fill(); }
    ctx.beginPath(); ctx.ellipse(0, 20, 45, 60, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.moveTo(-10, -5); ctx.lineTo(10, -5); ctx.lineTo(0, 18); ctx.fill();
    eye(-16, -20, 10); eye(16, -20, 10);
  } else if (M.kind === 'beast') {
    ctx.beginPath(); ctx.ellipse(10, 50, 90, 50, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-60, -5, 45, 40, -0.3, 0, TAU); ctx.fill();
    for (const k of [-1, 1]) { ctx.beginPath(); ctx.moveTo(-60 + k * 22, -35); ctx.lineTo(-60 + k * 34, -78); ctx.lineTo(-60 + k * 6, -42); ctx.fill(); }
    eye(-75, -12, 9); eye(-48, -14, 9);
    ctx.fillStyle = '#fff'; for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(-90 + k * 10, 18); ctx.lineTo(-85 + k * 10, 30); ctx.lineTo(-80 + k * 10, 18); ctx.fill(); }
  } else if (M.kind === 'giant') {
    ctx.fillRect(-70, -20, 140, 120);
    ctx.fillRect(-110, -10, 40, 90); ctx.fillRect(70, -10, 40, 90);
    ctx.beginPath(); ctx.arc(0, -55, 45, 0, TAU); ctx.fill();
    ctx.fillStyle = dark; ctx.fillRect(-70, 30, 140, 10);
    eye(-17, -60, 10); eye(17, -60, 10);
    ctx.strokeStyle = '#1a1010'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-20, -32); ctx.lineTo(20, -32); ctx.stroke();
  } else if (M.kind === 'dragon') {
    const f = Math.sin(time * 3) * 10;
    for (const k of [-1, 1]) { ctx.beginPath(); ctx.moveTo(k * 30, -10); ctx.lineTo(k * 150, -90 + f); ctx.lineTo(k * 130, 0 + f); ctx.lineTo(k * 90, -20 + f); ctx.lineTo(k * 60, 30); ctx.fill(); }
    ctx.beginPath(); ctx.ellipse(0, 50, 70, 60, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, -45, 50, 38, 0, 0, TAU); ctx.fill();
    for (const k of [-1, 1]) { ctx.beginPath(); ctx.moveTo(k * 25, -75); ctx.lineTo(k * 40, -120); ctx.lineTo(k * 10, -80); ctx.fill(); }
    eye(-20, -50, 10); eye(20, -50, 10);
    ctx.fillStyle = 'rgba(255,240,200,.35)'; ctx.beginPath(); ctx.ellipse(0, 60, 40, 40, 0, 0, TAU); ctx.fill();
  }
  if (M.burn > 0) for (let k = 0; k < 6; k++) { const a = time * 4 + k; circle(Math.cos(a * 1.3) * 60, 40 - ((time * 80 + k * 30) % 140), 7, `rgba(255,${120 + k * 15},40,.7)`); }
  ctx.restore();
}
function drawHero(x, y, time) {
  ctx.save(); ctx.translate(x, y);
  const fl = heroFlash > 0;
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(0, 110, 70, 14, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = fl ? '#fff' : '#6b4a3a'; ctx.fillRect(-40, 10, 80, 95);                                  // apron body
  ctx.fillStyle = fl ? '#fff' : '#3d2b22'; ctx.fillRect(-28, 25, 56, 80);
  circle(0, -18, 34, fl ? '#fff' : '#e8b48c');                                                              // head
  ctx.fillStyle = '#5a3a26'; ctx.beginPath(); ctx.ellipse(0, 4, 30, 18, 0, 0, Math.PI); ctx.fill();          // beard
  circle(-11, -24, 4, '#1a1010'); circle(11, -24, 4, '#1a1010');
  // hammer arm swings when a blade is forged
  const sw = anims.find(a => a.k === 'blade'), ang = sw ? -1.6 + Math.min(1, sw.t * 3) * 2.2 : -0.7 + Math.sin(time * 2) * 0.05;
  ctx.save(); ctx.translate(36, 30); ctx.rotate(ang);
  ctx.fillStyle = '#7a5532'; ctx.fillRect(-4, -70, 8, 76); ctx.fillStyle = '#9aa3b0'; ctx.fillRect(-18, -86, 36, 22);
  ctx.restore();
  ctx.restore();
}
function bar(x, y, w, h, f, col, label) {
  ctx.fillStyle = 'rgba(0,0,0,.55)'; rr(x, y, w, h, h / 2); ctx.fill();
  ctx.fillStyle = col; rr(x + 2, y + 2, Math.max(0, (w - 4) * f), h - 4, (h - 4) / 2); ctx.fill();
  hudText(label, x + w / 2, y + h / 2 + 1, 14, '#fff', 'center', 900);
}
function drawTile(t, r, selected, time, ghost) {
  const T = TIER[t.tier];
  const y = r.y - (selected ? 8 : 0);
  ctx.globalAlpha = ghost ? 0.25 : 1;
  ctx.fillStyle = 'rgba(0,0,0,.4)'; rr(r.x + 3, r.y + 5, r.w, r.h, 10); ctx.fill();
  const g = ctx.createLinearGradient(r.x, y, r.x, y + r.h); g.addColorStop(0, t.rust ? '#8a5a3c' : T.col); g.addColorStop(1, t.rust ? '#5a3524' : T.edge);
  ctx.fillStyle = g; rr(r.x, y, r.w, r.h, 10); ctx.fill();
  ctx.strokeStyle = selected ? '#fff' : 'rgba(0,0,0,.35)'; ctx.lineWidth = selected ? 3 : 2; rr(r.x, y, r.w, r.h, 10); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.25)'; rr(r.x + 5, y + 4, r.w - 10, 8, 4); ctx.fill();
  if (T.gem) { ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.beginPath(); ctx.moveTo(r.x + r.w - 14, y + 8); ctx.lineTo(r.x + r.w - 8, y + 14); ctx.lineTo(r.x + r.w - 14, y + 20); ctx.lineTo(r.x + r.w - 20, y + 14); ctx.fill(); }
  const L = t.ch === 'q' ? 'Qu' : t.ch.toUpperCase();
  hudText(L, r.x + r.w / 2, y + r.h / 2 + 2, t.ch === 'q' ? 30 : 36, t.rust ? '#3a2416' : '#2b1a0c', 'center', 900, null);
  hudText(String(Math.round(tileValue(R, t) * 10) / 10), r.x + r.w - 10, y + r.h - 12, 12, '#2b1a0c', 'right', 800, null);
  if (t.lock) { ctx.fillStyle = 'rgba(30,30,60,.65)'; rr(r.x, y, r.w, r.h, 10); ctx.fill(); hudText('🔒', r.x + r.w / 2, y + r.h / 2, 26, '#fff', 'center', 900, null); }
  ctx.globalAlpha = 1;
}
function button(b, label, col, enabled = true, sub) {
  ctx.globalAlpha = enabled ? 1 : 0.45;
  ctx.fillStyle = 'rgba(0,0,0,.45)'; rr(b.x + 2, b.y + 5, b.w, b.h, 12); ctx.fill();
  ctx.fillStyle = col; rr(b.x, b.y, b.w, b.h, 12); ctx.fill();
  hudText(label, b.x + b.w / 2, b.y + b.h / 2 - (sub ? 9 : 0) + 1, b.h > 70 ? 30 : 20, '#fff', 'center', 900);
  if (sub) hudText(sub, b.x + b.w / 2, b.y + b.h / 2 + 20, 14, '#fff6d9', 'center', 700);
  ctx.globalAlpha = 1;
}
function render(time) {
  ctx.setTransform(viewScale * dpr, 0, 0, viewScale * dpr, 0, 0);
  ctx.save();
  if (shake > 0.3) ctx.translate(rand(-1, 1) * shake, rand(-1, 1) * shake);
  ctx.drawImage(bg, 0, 0);
  if (!R) { ctx.restore(); return; }
  const M = R.mon, lunge = anims.find(a => a.k === 'lunge');
  drawHero(260, 190, time);
  drawMonster(M, 920 - (lunge ? Math.sin(Math.min(1, lunge.t * 2) * Math.PI) * 120 : 0), 180, M.boss ? 1.0 : 0.85, time);
  // flying blade
  for (const a of anims) if (a.k === 'blade' && a.t < 0.5) {
    const f = a.t / 0.5, x = lerp(330, 860, f), y = 200 - Math.sin(f * Math.PI) * 80, L = 40 + a.n * 12;
    ctx.save(); ctx.translate(x, y); ctx.rotate(f * 8);
    ctx.fillStyle = a.n >= 6 ? '#ffd34d' : a.n >= 5 ? '#e3e7ef' : '#c98a4b'; ctx.beginPath(); ctx.moveTo(-L / 2, -6); ctx.lineTo(L / 2, 0); ctx.lineTo(-L / 2, 6); ctx.fill();
    ctx.fillStyle = '#5a3a26'; ctx.fillRect(-L / 2 - 14, -4, 16, 8); ctx.restore();
  }
  // bars
  bar(110, 50, 300, 26, R.hp / R.maxHp, '#e0484f', `❤ ${R.hp} / ${R.maxHp}` + (R.shield ? `  🛡${R.shield}` : ''));
  bar(770, 50, 300, 26, M.hp / M.hpMax, '#d9802e', `${M.name}  ${M.hp} / ${M.hpMax}`);
  hudText(`⚔ ${M.atkNow}${M.trick ? '  ·  ' + { rust: 'rusts tiles', lock: 'locks tiles', drain: 'drains life', rage: 'gets angrier' }[M.trick] : ''}`, 920, 92, 14, '#ffd9a8', 'center', 700);
  hudText(`${ACTS[Math.floor(R.stage / 5)]}  ·  Monster ${R.stage + 1} / 15`, W / 2, 24, 16, '#e8d3b8', 'center', 800);
  // the word on the anvil
  ctx.fillStyle = '#2d2a2c'; rr(370, 300, 540, 82, 14); ctx.fill(); ctx.fillStyle = '#4a4548'; rr(380, 306, 520, 18, 8); ctx.fill();
  if (sel.length) {
    const word = wordOf(R, sel), ok = sel.length >= 3 && DICT.has(word), dmg = wordDamage(R, sel);
    hudText(word.toUpperCase(), 640, 344, Math.min(44, 440 / Math.max(1, word.length) * 1.4), ok ? '#fff6d9' : '#b8a8a0', 'center', 900);
    if (sel.length >= 3) hudText(ok ? `⚔ ${dmg}` : 'not a word', 640, 372, 14, ok ? '#ffd34d' : '#c98a8a', 'center', 800);
  } else hudText('Tap tiles (or type) to spell a word', 640, 344, 18, '#8d837d', 'center', 700);
  // tiles
  R.tiles.forEach((t, i) => drawTile(t, tileRect(i), sel.includes(i), time));
  // buttons
  const canForge = sel.length >= 3 && DICT.has(wordOf(R, sel)) && !busy;
  button(BTN.forge, '🔨 FORGE', canForge ? '#d9672e' : '#6b4a3a', canForge, canForge ? `deal ${wordDamage(R, sel)}` : 'needs a real word');
  button(BTN.clear, '✖ Clear', '#5a4e4a', sel.length > 0);
  button(BTN.shuffle, '🔀 Shuffle', '#4f5a6b', !busy, '(the monster gets a turn)');
  button(BTN.potion, `🧪 Potion ×${R.potions}`, '#3f7a52', R.potions > 0 && R.hp < R.maxHp);
  button(BTN.hint, '🎬 Best word', '#7b55c4', !busy);
  // floating numbers and toasts
  for (const f of floaters) { ctx.globalAlpha = Math.max(0, 1 - f.t / 1.2); hudText(f.s, f.x, f.y - f.t * 50, f.big ? 38 : 24, f.c, 'center', 900); }
  ctx.globalAlpha = 1;
  if (toastMsg) { ctx.globalAlpha = Math.min(1, 3 - toastMsg.t); ctx.font = '800 18px system-ui'; const tw = ctx.measureText(toastMsg.s).width + 40; ctx.fillStyle = 'rgba(15,10,8,.85)'; rr(W / 2 - tw / 2, 252, tw, 36, 18); ctx.fill(); hudText(toastMsg.s, W / 2, 270, 18, '#ffe2b8', 'center', 800); ctx.globalAlpha = 1; }
  ctx.restore();
}

// ---------------------------------------------------------------------
//  Input
// ---------------------------------------------------------------------
const inRect = (p, b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
canvas.addEventListener('pointerdown', e => {
  if (state !== 'play') return;
  const p = toCanvas(e);
  for (let i = 0; i < 16; i++) if (inRect(p, tileRect(i))) { toggleTile(i); return; }
  if (inRect(p, BTN.forge)) forge();
  else if (inRect(p, BTN.clear)) { if (sel.length) { sel = []; Sound.play('untile'); } }
  else if (inRect(p, BTN.shuffle)) doShuffle();
  else if (inRect(p, BTN.potion)) potion();
  else if (inRect(p, BTN.hint)) hint();
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('keydown', e => {
  if (state === 'play') {
    if (/^Key[A-Z]$/.test(e.code) && !e.ctrlKey && !e.metaKey && !e.altKey) { typeLetter(e.code[3].toLowerCase()); return; }
    if (e.code === 'Backspace') { e.preventDefault(); if (sel.length) { sel.pop(); Sound.play('untile'); } }
    if (e.code === 'Enter') forge();
    if (e.code === 'Escape') { if (sel.length) sel = []; else pauseGame(); }
  } else if (state === 'paused' && e.code === 'Escape') setState('play');
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(true); Sound.setHidden(document.hidden); });
$('ui').addEventListener('click', e => { const b = e.target.closest('button'); if (b && b.id !== 'muteBtn') Sound.play('click'); });
// the mute key is M, which is also a letter: only toggle mute outside of play
const _upd = () => { $('muteBtn').textContent = Sound.muted ? '🔇' : '🔊'; };
$('muteBtn').onclick = () => { Sound.init(); Sound.toggleMute(); _upd(); }; _upd();
window.addEventListener('pointerdown', () => Sound.init(), true);
window.addEventListener('keydown', () => Sound.init(), true);
let firstPlay = true;
$('playBtn').onclick = () => { if (firstPlay) { firstPlay = false; $('playBtn').disabled = true; Platform.commercialBreak().then(() => { $('playBtn').disabled = false; startRun(); }); } else startRun(); };
$('pauseBtn').onclick = () => pauseGame();
$('resumeBtn').onclick = () => setState('play');
$('quitBtn').onclick = () => { R = null; setState('menu'); };
$('againBtn').onclick = () => { $('againBtn').disabled = true; Platform.commercialBreak().then(() => { $('againBtn').disabled = false; startRun(); }); };
$('menuBtn').onclick = () => { R = null; setState('menu'); };
$('reviveBtn').onclick = revive;
const portraitMQ = window.matchMedia('(orientation: portrait) and (pointer: coarse)');
if (portraitMQ.addEventListener) portraitMQ.addEventListener('change', () => { if (portraitMQ.matches) pauseGame(); });

// ---------------------------------------------------------------------
//  Main loop
// ---------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  let dt = (now - last) / 1000; last = now; if (dt > 0.05) dt = 0.05;
  for (const a of anims) a.t += dt; anims = anims.filter(a => a.t < 1);
  for (const f of floaters) f.t += dt; floaters = floaters.filter(f => f.t < 1.2);
  if (toastMsg) { toastMsg.t += dt; if (toastMsg.t > 3) toastMsg = null; }
  shake *= Math.exp(-9 * dt); monFlash = Math.max(0, monFlash - dt); heroFlash = Math.max(0, heroFlash - dt);
  render(now / 1000);
  requestAnimationFrame(frame);
}
(async function boot() {
  await Platform.init();
  setState('menu');
  Platform.loadingFinished();
  requestAnimationFrame(t => { last = t; frame(t); });
  // DEBUG-START (removed from release builds by build.py)
  window.__wf = {
    get R() { return R; }, get state() { return state; }, startRun, findWords, DICT, MONSTERS, toggleTile, forge,
    // bot: plays the k-th best word each turn (k = 0 strongest), drinks potions when low, picks boons in a fixed order
    simulate(runs, maxLen = 16, seed0 = 1) {
      const res = [];
      for (let r = 0; r < runs; r++) {
        const S = newRun(seed0 + r); let turns = 0;
        while (turns < 600) {
          if (S.hp < S.maxHp * 0.4 && S.potions) drinkPotion(S);
          const w = findWords(S, 1, maxLen)[0];
          const ev = w ? playWord(S, w.idxs) : shuffleTiles(S); turns++;
          if (ev.some(e => e.t === 'lose')) break;
          if (ev.some(e => e.t === 'win')) {
            S.stage++; if (S.stage >= MONSTERS.length) break;
            S.hp = Math.min(S.maxHp, S.hp + Math.round(S.maxHp * 0.3));
            const ch = boonChoices(S), order = ['dmg', 'hp', 'armor', 'potion', 'silver', 'rare', 'gems'];
            ch.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)); applyBoon(S, ch[0].id); startFight(S);
          }
        }
        res.push(S.stage);
      }
      res.sort((a, b) => a - b);
      return 'stages reached: ' + res.join(' ') + ' | median ' + res[res.length >> 1] + ' | wins ' + res.filter(s => s >= 15).length + '/' + runs;
    },
    set hideHud(v) { hideHud = v; },
    // store-art scene: a boss, precious tiles and a blade in the air
    stage() {
      startRun(7); R.stage = 9; startFight(R); R.mon.hp = Math.round(R.mon.hpMax * 0.55);
      const letters = 'tmrnbladeisoucpk', tiers = { 4: 'gold', 5: 'silver', 6: 'ruby', 7: 'gold', 8: 'silver', 9: 'sapphire', 14: 'emerald' };
      R.tiles.forEach((t, i) => { t.ch = letters[i]; t.tier = tiers[i] || 'bronze'; t.rust = 0; t.lock = 0; });
      sel = [4, 5, 6, 7, 8, 10]; anims = [{ k: 'blade', t: 0.27, n: 6 }];
      floaters = [{ x: 900, y: 140, s: '-64', c: '#ffd34d', t: 0.25, big: true }];
      document.querySelectorAll('.screen').forEach(e => e.classList.remove('show'));
      $('pauseBtn').style.display = 'none'; $('muteBtn').style.display = 'none';
    },
    snap(w = 1920) {
      const vs = viewScale, d = dpr; viewScale = w / W; dpr = 1; canvas.width = w; canvas.height = Math.round(w * H / W);
      render(performance.now() / 1000); const url = canvas.toDataURL('image/png'); viewScale = vs; dpr = d; resize(); return url;
    },
  };
  // DEBUG-END
})();

})();
