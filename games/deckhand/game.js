'use strict';
(() => {
// =====================================================================
//  Deckhand
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
  get(k, d) { try { const v = localStorage.getItem('deckhand_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('deckhand_' + k, JSON.stringify(v)); } catch (e) { } },
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
//  Deckhand: your deck is your crew. Put them in the right places on
//  the ship and sail through three seas of monsters.
// =====================================================================
// Slots, from the stern (left) to the bow (right, facing the monster)
const SLOTS = [
  { id: 'helm', name: 'Helm', icon: '☸', tip: 'Navigators here give +1 energy' },
  { id: 'port', name: 'Cannon', icon: '◉', tip: 'Gunners here fire the cannon' },
  { id: 'star', name: 'Cannon', icon: '◉', tip: 'Gunners here fire the cannon' },
  { id: 'bow', name: 'Bow', icon: '⚓', tip: 'Takes the monster\'s hits first' },
];
const CARDS = {
  // crew stay on deck and act every turn (left to right)
  deckhand: { name: 'Deckhand', icon: '🧹', cost: 1, crew: true, atk: 2, hp: 4, text: 'Hits for 2.' },
  gunner: { name: 'Gunner', icon: '💣', cost: 2, crew: true, atk: 1, hp: 3, text: 'At a cannon: hits for 6 instead.' },
  bruiser: { name: 'Bruiser', icon: '💪', cost: 2, crew: true, atk: 3, hp: 11, text: 'Tough. Best at the bow.' },
  surgeon: { name: 'Surgeon', icon: '🩹', cost: 1, crew: true, atk: 0, hp: 3, text: 'Heals crew beside it 2 each turn.' },
  bosun: { name: 'Bosun', icon: '📣', cost: 1, crew: true, atk: 1, hp: 4, text: 'Crew beside it hit +2.' },
  navigator: { name: 'Navigator', icon: '🧭', cost: 1, crew: true, atk: 0, hp: 3, text: 'At the helm: +1 energy each turn.' },
  harpooner: { name: 'Harpooner', icon: '🔱', cost: 2, crew: true, atk: 4, hp: 4, text: 'Hits for 4, ignoring armour.' },
  monkey: { name: 'Powder Monkey', icon: '🐒', cost: 1, crew: true, atk: 1, hp: 2, text: 'When knocked out: 7 damage to the monster.' },
  lookout: { name: 'Lookout', icon: '🔭', cost: 1, crew: true, atk: 1, hp: 3, text: 'Draw 1 more card each turn.' },
  quartermaster: { name: 'Quartermaster', icon: '🗝️', cost: 3, crew: true, atk: 3, hp: 7, text: 'All crew hit +1.' },
  // orders happen once
  broadside: { name: 'Broadside', icon: '💥', cost: 2, order: true, text: 'Everyone at a cannon attacks now.' },
  patch: { name: 'Patch Hull', icon: '🔨', cost: 1, order: true, text: 'Repair the hull by 7.' },
  soup: { name: 'Hot Soup', icon: '🍲', cost: 0, order: true, text: 'Heal all crew 3.' },
  brace: { name: 'Brace!', icon: '🛡️', cost: 1, order: true, text: 'Block the next 8 damage.' },
  rally: { name: 'Rally', icon: '📯', cost: 1, order: true, text: 'All crew hit +2 this turn.' },
  barnacle: { name: 'Barnacle', icon: '🐚', cost: 1, order: true, junk: true, text: 'Junk from the ghost ship. Does nothing.' },
};
const START_DECK = ['deckhand', 'deckhand', 'deckhand', 'deckhand', 'gunner', 'gunner', 'bruiser', 'surgeon', 'patch', 'soup'];
const REWARD_POOL = ['gunner', 'bruiser', 'surgeon', 'bosun', 'navigator', 'harpooner', 'monkey', 'lookout', 'quartermaster', 'broadside', 'patch', 'soup', 'brace', 'rally', 'deckhand'];
// Monster moves: bow (hits the front crew, or the hull if the deck is empty), hull (cannon shot straight at the hull),
// all (every crew), rand (random crew, n times), stun, grab (knocks out a random crew), armor, curse (junk card)
const MONSTERS = [
  { name: 'Reef Shark', hp: 26, art: 'shark', moves: [['bow', 5], ['bow', 6], ['bow', 4]] },
  { name: 'Pirate Sloop', hp: 32, art: 'ship', moves: [['hull', 4], ['all', 2], ['hull', 5]] },
  { name: 'Giant Crab', hp: 60, art: 'crab', boss: true, moves: [['bow', 8], ['armor', 6], ['bow', 9], ['all', 3]] },
  { name: 'Siren', hp: 52, art: 'siren', moves: [['stun', 1], ['bow', 7], ['rand', 4, 2]] },
  { name: 'Sea Serpent', hp: 66, art: 'serpent', moves: [['all', 3], ['bow', 10], ['armor', 5]] },
  { name: 'Kraken', hp: 120, art: 'kraken', boss: true, moves: [['grab', 1], ['hull', 9], ['all', 4], ['bow', 12]] },
  { name: 'Ghost Ship', hp: 88, art: 'ghost', moves: [['curse', 2], ['hull', 8], ['all', 4]] },
  { name: 'Storm Spirit', hp: 96, art: 'storm', moves: [['rand', 6, 2], ['armor', 8], ['hull', 9]] },
  { name: 'Leviathan', hp: 170, art: 'levi', boss: true, moves: [['all', 5], ['bow', 15], ['hull', 11], ['grab', 1], ['armor', 10]] },
];
const SEAS = ['The Shallows', 'The Deep Blue', 'The Storm Sea'];

// ---------------------------------------------------------------------
//  Rules (on a run object R; also used by the test bot)
// ---------------------------------------------------------------------
function rnd(R) { R.seed = (R.seed * 1664525 + 1013904223) >>> 0; return R.seed / 4294967296; }
function shuffleArr(R, a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd(R) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function newRun(seed) {
  const R = { seed: seed || ((Math.random() * 1e9) | 0), fight: 0, hull: 40, hullMax: 40, deck: START_DECK.slice(), revived: false, log: [] };
  startFight(R); return R;
}
function startFight(R) {
  const M = MONSTERS[R.fight];
  R.mon = { ...M, hpMax: M.hp, hp: M.hp, block: 0, mi: 0 };
  R.slots = [null, null, null, null];
  R.draw = shuffleArr(R, R.deck.slice()); R.discard = []; R.hand = []; R.block = 0; R.turn = 0; R.rally = 0;
  startTurn(R);
}
function drawCards(R, n) {
  for (let k = 0; k < n; k++) {
    if (!R.draw.length) { if (!R.discard.length) return; R.draw = shuffleArr(R, R.discard); R.discard = []; }
    if (R.hand.length >= 8) return;
    R.hand.push(R.draw.pop());
  }
}
function startTurn(R) {
  R.turn++; R.rally = 0; R.block = 0;
  R.energy = 3 + (R.slots[0] && R.slots[0].id === 'navigator' ? 1 : 0);
  drawCards(R, 4 + R.slots.filter(c => c && c.id === 'lookout').length);
  R.intent = R.mon.moves[R.mon.mi % R.mon.moves.length];
}
function crewAtk(R, i) {
  const c = R.slots[i]; if (!c || c.stun) return 0;
  let a = CARDS[c.id].atk;
  if (c.id === 'gunner' && (i === 1 || i === 2)) a = 6;
  for (const j of [i - 1, i + 1]) if (R.slots[j] && R.slots[j].id === 'bosun') a += 2;
  a += R.slots.filter(x => x && x.id === 'quartermaster').length + R.rally;
  if (CARDS[c.id].atk === 0 && c.id !== 'gunner') a = 0;          // healers and navigators don't fight
  return a;
}
// Play hand card h into slot s (crew) or as an order. Returns events or null.
function playCard(R, h, s) {
  const id = R.hand[h], C = CARDS[id]; if (!C || C.cost > R.energy) return null;
  const ev = [];
  if (C.crew) {
    if (s == null || s < 0 || s > 3) return null;
    if (R.slots[s]) R.discard.push(R.slots[s].id);
    R.slots[s] = { id, hp: C.hp, hpMax: C.hp, stun: false };
    ev.push({ t: 'place', s, id });
  } else {
    if (id === 'broadside') { for (const i of [1, 2]) { const a = crewAtk(R, i); if (a) { hitMonster(R, a, R.slots[i].id === 'harpooner'); ev.push({ t: 'atk', s: i, dmg: a }); } } }
    if (id === 'patch') { const h2 = Math.min(7, R.hullMax - R.hull); R.hull += h2; ev.push({ t: 'repair', amt: h2 }); }
    if (id === 'soup') { for (const c of R.slots) if (c) c.hp = Math.min(c.hpMax, c.hp + 3); ev.push({ t: 'heal' }); }
    if (id === 'brace') { R.block += 8; ev.push({ t: 'block' }); }
    if (id === 'rally') { R.rally += 2; ev.push({ t: 'rally' }); }
    R.discard.push(id);
  }
  R.energy -= C.cost; R.hand.splice(h, 1);
  if (R.mon.hp <= 0) ev.push({ t: 'win' });
  return ev;
}
function hitMonster(R, dmg, pierce) {
  const M = R.mon; if (!pierce) { const b = Math.min(M.block, dmg); M.block -= b; dmg -= b; }
  M.hp = Math.max(0, M.hp - dmg);
}
function knockOut(R, i, ev) {
  const c = R.slots[i]; R.slots[i] = null; R.discard.push(c.id); ev.push({ t: 'ko', s: i, id: c.id });
  if (c.id === 'monkey') { hitMonster(R, 7, true); ev.push({ t: 'boom', dmg: 7 }); }
}
function hurtCrew(R, i, dmg, ev) {
  const c = R.slots[i]; if (!c) return;
  c.hp -= dmg; ev.push({ t: 'hurt', s: i, dmg });
  if (c.hp <= 0) knockOut(R, i, ev);
}
function hurtHull(R, dmg, ev) {
  const b = Math.min(R.block, dmg); R.block -= b; dmg -= b;
  R.hull = Math.max(0, R.hull - dmg); ev.push({ t: 'hull', dmg, blocked: b });
}
// End the turn: crew act left to right, then the monster.
function endTurn(R) {
  const ev = [];
  for (let i = 0; i < 4; i++) {
    const c = R.slots[i]; if (!c) continue;
    if (c.stun) { c.stun = false; ev.push({ t: 'stunned', s: i }); continue; }
    if (c.id === 'surgeon') for (const j of [i - 1, i + 1]) { const n = R.slots[j]; if (n && n.hp < n.hpMax) { n.hp = Math.min(n.hpMax, n.hp + 2); ev.push({ t: 'mend', s: j }); } }
    const a = crewAtk(R, i);
    if (a > 0) { hitMonster(R, a, c.id === 'harpooner'); ev.push({ t: 'atk', s: i, dmg: a }); }
    if (R.mon.hp <= 0) { ev.push({ t: 'win' }); return ev; }
  }
  // discard the rest of the hand
  R.discard.push(...R.hand); R.hand = [];
  const [kind, x, n] = R.intent, M = R.mon;
  M.block = 0;
  ev.push({ t: 'mon', kind });
  const front = () => { for (let i = 3; i >= 0; i--) if (R.slots[i]) return i; return -1; };
  const crewIdx = () => R.slots.map((c, i) => c ? i : -1).filter(i => i >= 0);
  if (kind === 'bow') { const f = front(); if (f >= 0) { const c = R.slots[f], over = Math.max(0, x - c.hp); hurtCrew(R, f, x, ev); if (over && !R.slots[f]) hurtHull(R, Math.ceil(over / 2), ev); } else hurtHull(R, x, ev); }
  if (kind === 'hull') hurtHull(R, x, ev);
  if (kind === 'all') { const cs = crewIdx(); if (!cs.length) hurtHull(R, x * 2, ev); for (const i of cs) hurtCrew(R, i, x, ev); }
  if (kind === 'rand') for (let k = 0; k < n; k++) { const cs = crewIdx(); if (!cs.length) { hurtHull(R, x, ev); continue; } hurtCrew(R, cs[Math.floor(rnd(R) * cs.length)], x, ev); }
  if (kind === 'stun') { const cs = crewIdx(); if (cs.length) { const i = cs[Math.floor(rnd(R) * cs.length)]; R.slots[i].stun = true; ev.push({ t: 'stun', s: i }); } else hurtHull(R, 4, ev); }
  if (kind === 'grab') { const cs = crewIdx(); if (cs.length) knockOut(R, cs[Math.floor(rnd(R) * cs.length)], ev); else hurtHull(R, 8, ev); }
  if (kind === 'armor') { M.block = x; ev.push({ t: 'armor', amt: x }); }
  if (kind === 'curse') { for (let k = 0; k < x; k++) R.discard.push('barnacle'); ev.push({ t: 'curse' }); }
  M.mi++;
  if (R.mon.hp <= 0) { ev.push({ t: 'win' }); return ev; }
  if (R.hull <= 0) { ev.push({ t: 'lose' }); return ev; }
  startTurn(R);
  return ev;
}
function rewardChoices(R) {
  const sea = Math.floor(R.fight / 3), pool = REWARD_POOL.filter(id => sea > 0 || id !== 'quartermaster');
  const out = []; while (out.length < 3) { const id = pool[Math.floor(rnd(R) * pool.length)]; if (!out.includes(id)) out.push(id); }
  return out;
}
function afterFight(R) {
  R.deck = R.deck.filter(id => id !== 'barnacle');
  R.fight++;
  R.hull = Math.min(R.hullMax, R.hull + (R.fight % 3 === 0 ? Math.round(R.hullMax * 0.5) : 6));
}
function intentText(it) {
  const [k, x, n] = it;
  return { bow: `Attacks the front crew for ${x}`, hull: `Fires at the hull for ${x}`, all: `Hits every crew for ${x}`, rand: `Strikes random crew ${n}× for ${x}`,
    stun: 'Stuns one of your crew', grab: 'Snatches one of your crew!', armor: `Gains ${x} armour`, curse: `Throws ${x} junk cards in your deck` }[k];
}

// ---------------------------------------------------------------------
//  Sound
// ---------------------------------------------------------------------
{
  const { tone, noise, N } = Sound;
  Sound.define({
    click: () => tone('triangle', 700, 900, 0.06, 0.12),
    card: () => noise(0.08, 0.08, 'highpass', 3000, 5000, 0, 1),
    place: () => { tone('sine', 220, 160, 0.1, 0.15); noise(0.06, 0.06, 'lowpass', 900, 400); },
    cannon: () => { noise(0.35, 0.35, 'lowpass', 1400, 120); tone('sine', 120, 45, 0.3, 0.3); },
    hit: () => { noise(0.12, 0.15, 'bandpass', 1200, 500, 0, 2); tone('square', 300, 150, 0.08, 0.05); },
    hurt: () => { noise(0.2, 0.18, 'lowpass', 800, 200); tone('sawtooth', 180, 90, 0.18, 0.06); },
    creak: () => noise(0.4, 0.12, 'bandpass', 300, 180, 0, 4),
    heal: () => { const t = Sound.now(); [72, 76, 79].forEach((n, i) => tone('sine', N(n), N(n), 0.22, 0.07, t + i * 0.05)); },
    roar: () => { noise(0.6, 0.2, 'lowpass', 500, 120); tone('sawtooth', 110, 70, 0.6, 0.08); },
    deny: () => tone('sine', 160, 120, 0.1, 0.12),
    win: () => { const t = Sound.now(); [67, 72, 76, 79, 84].forEach((n, i) => tone('triangle', N(n), N(n), 0.3, 0.13, t + i * 0.09)); },
    lose: () => { const t = Sound.now(); [67, 63, 60, 55].forEach((n, i) => tone('triangle', N(n), N(n), 0.4, 0.12, t + i * 0.15)); },
  }, (step, t) => {
    // a sea shanty in 6/8
    const STEP = 60 / 120 / 2, bus = Sound.musBus, bar = Math.floor(step / 6) % 8, s = step % 6;
    const CH = [[50, 57, 62], [50, 57, 62], [55, 59, 62], [57, 61, 64], [50, 57, 62], [48, 55, 60], [45, 52, 57], [50, 57, 62]][bar];
    const MEL = [[62, 0, 64, 66, 0, 64], [62, 0, 57, 59, 0, 57], [59, 0, 62, 67, 0, 66], [64, 0, 0, 61, 0, 64], [66, 0, 64, 62, 0, 64], [67, 0, 64, 60, 0, 64], [62, 0, 61, 57, 0, 61], [62, 0, 0, 0, 0, 0]][bar];
    if (s === 0 || s === 3) tone('triangle', N(CH[0] - 12), N(CH[0] - 12), STEP * 2.5, 0.05, t, bus);
    if (s === 1 || s === 4) for (const n of CH.slice(1)) tone('sine', N(n), N(n), STEP * 1.2, 0.012, t, bus);
    if (MEL[s]) tone('square', N(MEL[s] + 12), N(MEL[s] + 12), STEP * 1.6, 0.012, t, bus);
    return STEP;
  });
}

// ---------------------------------------------------------------------
//  UI state
// ---------------------------------------------------------------------
let state = 'menu', R = null, selHand = -1, busy = false, fx = [], floaters = [], shake = 0, monHit = 0, hideHud = false, toastMsg = null;
const save = { best: Store.get('best', 0), wins: Store.get('wins', 0) };
const SLOT_X = [240, 400, 560, 720], SLOT_Y = 300, CW = 118, CH = 150;      // crew cards on deck
function handRect(i, n) { const w = 120, h = 168, gap = Math.min(128, 760 / Math.max(1, n)), x0 = 640 - (gap * (n - 1) + w) / 2; return { x: x0 + i * gap, y: 538, w, h }; }
const END_BTN = { x: 1080, y: 600, w: 170, h: 70 };

let runId = 0;
function startRun(seed) { runId++; busy = false; R = newRun(seed); selHand = -1; fx = []; floaters = []; setState('play'); toast(SEAS[0] + ': a ' + R.mon.name + '!'); }
function tryPlay(h, s) {
  if (busy || state !== 'play') return;
  const id = R.hand[h], C = CARDS[id];
  if (C.cost > R.energy) { Sound.play('deny'); toast('Not enough energy'); return; }
  const ev = playCard(R, h, s); if (!ev) { Sound.play('deny'); return; }
  selHand = -1;
  Sound.play(C.crew ? 'place' : 'card');
  animate(ev);
}
function doEndTurn() { if (busy || state !== 'play') return; selHand = -1; animate(endTurn(R)); }
function animate(ev) {
  busy = true; let t = 0;
  const id = runId, setTimeout = (f, ms) => window.setTimeout(() => { if (id === runId && R) f(); }, ms);   // timers from an ended voyage do nothing
  const later = (dt, f) => { setTimeout(f, (t + dt) * 1000); };
  for (const e of ev) {
    if (e.t === 'atk') { later(0, () => { Sound.play(R && CARDS[(R.slots[e.s] || {}).id] && (e.s === 1 || e.s === 2) ? 'cannon' : 'hit'); fx.push({ k: 'shot', s: e.s, t: 0 }); }); later(0.25, () => { monHit = 0.2; floaters.push({ x: 1010, y: 190, s: '-' + e.dmg, c: '#ffd34d', t: 0 }); }); t += 0.32; }
    if (e.t === 'mon') { later(0, () => { Sound.play('roar'); fx.push({ k: 'lunge', t: 0 }); }); t += 0.35; }
    if (e.t === 'hurt') { later(0, () => { Sound.play('hurt'); floaters.push({ x: SLOT_X[e.s] + CW / 2, y: SLOT_Y - 10, s: '-' + e.dmg, c: '#ff6b6b', t: 0 }); }); t += 0.15; }
    if (e.t === 'hull') { later(0, () => { Sound.play('creak'); shake = 10; floaters.push({ x: 480, y: 470, s: e.dmg ? 'Hull -' + e.dmg : 'Blocked!', c: e.dmg ? '#ff6b6b' : '#7dd3ff', t: 0, big: true }); }); t += 0.3; }
    if (e.t === 'ko') { later(0, () => floaters.push({ x: SLOT_X[e.s] + CW / 2, y: SLOT_Y + 40, s: 'Knocked out!', c: '#ffb38a', t: 0 })); t += 0.2; }
    if (e.t === 'boom') { later(0, () => { Sound.play('cannon'); monHit = 0.3; floaters.push({ x: 1010, y: 230, s: '💥-' + e.dmg, c: '#ffd34d', t: 0, big: true }); }); t += 0.3; }
    if (e.t === 'stun') later(0, () => floaters.push({ x: SLOT_X[e.s] + CW / 2, y: SLOT_Y + 20, s: 'Stunned!', c: '#d9b3ff', t: 0 }));
    if (e.t === 'armor') later(0, () => floaters.push({ x: 1010, y: 160, s: '+' + e.amt + ' armour', c: '#9ec9ff', t: 0 }));
    if (e.t === 'curse') later(0, () => toast('Barnacles! Junk cards were added to your discard pile'));
    if (e.t === 'repair' || e.t === 'heal' || e.t === 'mend') later(0, () => Sound.play('heal', 0.1));
    if (e.t === 'win') { later(0.5, winFight); t += 0.5; break; }
    if (e.t === 'lose') { later(0.6, () => { Sound.play('lose'); showEnd(false); }); t += 0.6; break; }
  }
  setTimeout(() => { busy = false; }, t * 1000 + 50);
}
function winFight() {
  if (!R) return;
  Sound.play('win'); Platform.happy();
  const beaten = R.mon.name; afterFight(R);
  save.best = Math.max(save.best, R.fight); Store.set('best', save.best);
  if (R.fight >= MONSTERS.length) { save.wins++; Store.set('wins', save.wins); showEnd(true); return; }
  $('rewardTitle').textContent = beaten + ' defeated!';
  $('rewardSub').textContent = (R.fight % 3 === 0 ? `${SEAS[R.fight / 3 - 1]} conquered! Half your hull is repaired. ` : 'Hull +6. ') + 'Take a new card into your deck:';
  const box = $('rewards'); box.innerHTML = ''; delete box.dataset.done;
  for (const id of rewardChoices(R)) {
    const C = CARDS[id], d = document.createElement('button'); d.className = 'rcard' + (C.order ? ' order' : '');
    d.innerHTML = `<span class="cost">${C.cost}</span><i>${C.icon}</i><b>${C.name}</b>${C.crew ? `<span class="st">⚔${C.atk} ❤${C.hp}</span>` : ''}<small>${C.text}</small>`;
    d.onclick = () => { if (box.dataset.done) return; box.dataset.done = '1'; R.deck.push(id); Sound.play('card'); nextFight(); };
    box.appendChild(d);
  }
  $('skipCard').onclick = () => { if (box.dataset.done) return; box.dataset.done = '1'; nextFight(); };
  setState('reward');
}
function nextFight() {
  const go = () => { startFight(R); setState('play'); toast((R.fight % 3 === 0 ? SEAS[R.fight / 3] + ': ' : '') + 'A ' + R.mon.name + ' appears!'); };
  if (R.fight % 3 === 0) Platform.commercialBreak().then(go); else go();
}
function showEnd(won) {
  $('endTitle').textContent = won ? 'THE LEVIATHAN SINKS!' : 'YOUR SHIP SINKS';
  $('endStats').innerHTML = (won ? 'You sailed through all three seas!' : `Sunk by the ${R.mon.name} (fight ${R.fight + 1} / 9)`) + `<br>Deck size ${R.deck.length} · Furthest ever ${save.best} / 9`;
  $('reviveBtn').style.display = !won && !R.revived ? '' : 'none';
  setState('over');
}
function revive() {
  Platform.rewardedBreak().then(ok => { if (!ok || !R) return; R.revived = true; R.hull = Math.round(R.hullMax * 0.5); setState('play'); toast('Patched up and back in the fight!'); });
}
function toast(s) { toastMsg = { s, t: 0 }; }

// ---------------------------------------------------------------------
//  Screens
// ---------------------------------------------------------------------
function setState(s, focusLoss) {
  state = s;
  if (s === 'play') Platform.gameplayStart(); else if (!(focusLoss && Platform.kind === 'crazy')) Platform.gameplayStop();
  for (const el of document.querySelectorAll('.screen')) if (el.id !== 'adstub') el.classList.toggle('show', el.id === ({ menu: 'menu', reward: 'reward', paused: 'pause', over: 'over', deck: 'deckview' }[s]));
  $('pauseBtn').style.display = s === 'play' ? 'block' : 'none';
  if (s === 'menu') $('menuInfo').innerHTML = save.best ? `Furthest voyage: ${save.best} / 9 monsters${save.wins ? ` · Leviathan beaten ${save.wins}×` : ''}` : 'Nine monsters, three seas, one stubborn crew.';
  Sound.music();
}
function pauseGame(focusLoss) { if (state === 'play') setState('paused', focusLoss === true); }

// ---------------------------------------------------------------------
//  Drawing
// ---------------------------------------------------------------------
const bg = document.createElement('canvas'); bg.width = W; bg.height = H;
{
  const b = bg.getContext('2d');
  const sky = b.createLinearGradient(0, 0, 0, 330); sky.addColorStop(0, '#2a4a7a'); sky.addColorStop(1, '#9cc4dc'); b.fillStyle = sky; b.fillRect(0, 0, W, 330);
  for (const [x, y, s] of [[180, 70, 1], [620, 40, 1.3], [1050, 90, 0.9]]) { b.fillStyle = 'rgba(255,255,255,.8)'; for (let k = 0; k < 4; k++) { b.beginPath(); b.ellipse(x + k * 34 * s, y + (k % 2) * 8, 40 * s, 22 * s, 0, 0, TAU); b.fill(); } }
  const sea = b.createLinearGradient(0, 330, 0, H); sea.addColorStop(0, '#1f6fa0'); sea.addColorStop(1, '#0b2b45'); b.fillStyle = sea; b.fillRect(0, 330, W, H - 330);
}
function drawWaves(time, y0, amp, col, sp) {
  ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 20) ctx.lineTo(x, y0 + Math.sin(x * 0.012 + time * sp) * amp + Math.sin(x * 0.03 + time * sp * 1.7) * amp * 0.4);
  ctx.lineTo(W, H); ctx.fill();
}
function drawShip(time) {
  const rock = Math.sin(time * 1.2) * 0.012;
  ctx.save(); ctx.translate(480, 440); ctx.rotate(rock);
  // mast + sail
  ctx.fillStyle = '#5a3a22'; ctx.fillRect(-8, -330, 14, 330);
  ctx.fillStyle = '#f2ead6'; ctx.beginPath(); ctx.moveTo(10, -310); ctx.quadraticCurveTo(140 + Math.sin(time) * 10, -220, 10, -150); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-10, -300); ctx.quadraticCurveTo(-170 + Math.sin(time + 1) * 10, -210, -10, -150); ctx.fill();
  ctx.fillStyle = '#1b1b1b'; ctx.beginPath(); ctx.moveTo(4, -330); ctx.lineTo(60, -318); ctx.lineTo(4, -306); ctx.fill();
  // hull
  ctx.fillStyle = '#7a4a26'; ctx.beginPath(); ctx.moveTo(-330, -40); ctx.lineTo(330, -40); ctx.lineTo(380, -80); ctx.lineTo(340, 40); ctx.quadraticCurveTo(0, 80, -320, 40); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#5c361a'; for (let k = 0; k < 3; k++) ctx.fillRect(-325, -18 + k * 22, 660, 4);
  ctx.fillStyle = '#3a2210'; for (const x of [-80, 80]) { ctx.beginPath(); ctx.arc(x, 0, 12, 0, TAU); ctx.fill(); }
  ctx.fillStyle = '#9a6a3c'; ctx.fillRect(-330, -48, 680, 10);
  ctx.restore();
}
function drawCard(id, x, y, w, h, opt = {}) {
  const C = CARDS[id];
  ctx.save(); ctx.globalAlpha = opt.alpha == null ? 1 : opt.alpha;
  ctx.fillStyle = 'rgba(0,0,0,.35)'; rr(x + 3, y + 5, w, h, 10); ctx.fill();
  const g = ctx.createLinearGradient(x, y, x, y + h);
  if (C.junk) { g.addColorStop(0, '#8a8f7a'); g.addColorStop(1, '#5a5e4c'); } else if (C.order) { g.addColorStop(0, '#f3e2bd'); g.addColorStop(1, '#d9bf8a'); } else { g.addColorStop(0, '#d8e6f2'); g.addColorStop(1, '#9fb8cf'); }
  ctx.fillStyle = g; rr(x, y, w, h, 10); ctx.fill();
  ctx.strokeStyle = opt.sel ? '#ffd34d' : C.order ? '#8a6a2a' : '#3d5a78'; ctx.lineWidth = opt.sel ? 4 : 2.5; rr(x, y, w, h, 10); ctx.stroke();
  const s = w / 120;
  ctx.font = `${Math.round(40 * s)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000'; ctx.fillText(C.icon, x + w / 2, y + 48 * s);
  hudText(C.name, x + w / 2, y + 88 * s, Math.round((C.name.length > 10 ? 12 : 14) * s), '#1c2a3a', 'center', 900, null);
  if (!opt.compact) {
    ctx.font = `600 ${Math.round(10.5 * s)}px system-ui`; ctx.fillStyle = '#2b3542';
    wrapText(C.text, x + w / 2, y + 108 * s, w - 14, 12.5 * s);
  }
  // cost gem
  if (opt.cost !== false) { circle(x + 14 * s, y + 14 * s, 13 * s, '#2f6fd1'); hudText(String(C.cost), x + 14 * s, y + 15 * s, Math.round(15 * s), '#fff', 'center', 900, null); }
  ctx.restore();
}
function wrapText(t, cx, y, maxW, lh) {
  const words = t.split(' '); let line = '';
  for (const w of words) { const test = line ? line + ' ' + w : w; if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, cx, y); line = w; y += lh; } else line = test; }
  if (line) ctx.fillText(line, cx, y);
}
function drawMonster(M, x, y, time) {
  const bob = Math.sin(time * 1.8) * 8, lunge = fx.find(f => f.k === 'lunge'), lx = lunge ? -Math.sin(Math.min(1, lunge.t * 2.5) * Math.PI) * 90 : 0;
  ctx.save(); ctx.translate(x + lx, y + bob);
  const fl = monHit > 0, C = c => fl ? '#fff' : c;
  const eye = (ex, ey, r, col = '#ffd34d') => { circle(ex, ey, r, col); circle(ex, ey, r * 0.45, '#111'); };
  const a = M.art;
  if (a === 'shark') { ctx.fillStyle = C('#5d7a94'); ctx.beginPath(); ctx.ellipse(0, 40, 120, 48, -0.15, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(30, -80); ctx.lineTo(50, 0); ctx.fill(); ctx.fillStyle = '#fff'; for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.moveTo(-100 + k * 12, 50); ctx.lineTo(-94 + k * 12, 64); ctx.lineTo(-88 + k * 12, 50); ctx.fill(); } eye(-70, 25, 8); }
  else if (a === 'ship') { ctx.fillStyle = C('#4a2f1e'); ctx.beginPath(); ctx.moveTo(-130, 20); ctx.lineTo(130, 20); ctx.lineTo(100, 80); ctx.lineTo(-110, 80); ctx.fill(); ctx.fillStyle = '#3a2a1a'; ctx.fillRect(-4, -150, 8, 170); ctx.fillStyle = C('#222'); ctx.beginPath(); ctx.moveTo(0, -140); ctx.quadraticCurveTo(-90, -80, 0, -20); ctx.fill(); hudText('☠', -38, -80, 34, '#fff', 'center', 900, null); }
  else if (a === 'crab') { ctx.fillStyle = C('#d9462f'); ctx.beginPath(); ctx.ellipse(0, 40, 110, 70, 0, 0, TAU); ctx.fill(); for (const k of [-1, 1]) { ctx.beginPath(); ctx.arc(k * 120, -30, 40, 0, TAU); ctx.fill(); ctx.fillStyle = '#7a1f12'; ctx.beginPath(); ctx.moveTo(k * 120, -30); ctx.arc(k * 120, -30, 40, -0.4, 0.4); ctx.fill(); ctx.fillStyle = C('#d9462f'); } eye(-30, -20, 12); eye(30, -20, 12); }
  else if (a === 'siren') { ctx.fillStyle = C('#3fa58f'); ctx.beginPath(); ctx.moveTo(-30, 0); ctx.quadraticCurveTo(-60, 90, 30, 110); ctx.quadraticCurveTo(80, 80, 30, 0); ctx.fill(); circle(0, -40, 36, C('#c8a2e8')); ctx.fillStyle = C('#6b3fa0'); ctx.beginPath(); ctx.arc(0, -50, 40, Math.PI, 0); ctx.fill(); eye(-12, -42, 6, '#7ff0ff'); eye(12, -42, 6, '#7ff0ff'); for (let k = 0; k < 3; k++) hudText('♪', 50 + k * 22, -70 - Math.sin(time * 3 + k) * 12, 22, '#e0d4ff', 'center', 900, null); }
  else if (a === 'serpent') { ctx.strokeStyle = C('#3f9a5a'); ctx.lineWidth = 46; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-140, 90); ctx.quadraticCurveTo(-60, -40 + Math.sin(time * 2) * 20, 20, 60); ctx.quadraticCurveTo(80, 120, 60, -60); ctx.stroke(); circle(60, -80, 38, C('#3f9a5a')); eye(50, -88, 8); eye(76, -86, 8); }
  else if (a === 'kraken') { ctx.strokeStyle = C('#a0428a'); ctx.lineWidth = 22; ctx.lineCap = 'round'; for (let k = 0; k < 6; k++) { const ph = time * 2 + k; ctx.beginPath(); ctx.moveTo(-60 + k * 24, 60); ctx.quadraticCurveTo(-140 + k * 50 + Math.sin(ph) * 30, 120, -150 + k * 60, 40 + Math.cos(ph) * 40); ctx.stroke(); } ctx.fillStyle = C('#b5509c'); ctx.beginPath(); ctx.ellipse(0, -10, 95, 110, 0, 0, TAU); ctx.fill(); eye(-34, 30, 16); eye(34, 30, 16); }
  else if (a === 'ghost') { ctx.globalAlpha = 0.85; ctx.fillStyle = C('#9fd3c7'); ctx.beginPath(); ctx.moveTo(-130, 20); ctx.lineTo(130, 20); ctx.lineTo(100, 80); ctx.lineTo(-110, 80); ctx.fill(); ctx.fillRect(-4, -150, 8, 170); ctx.beginPath(); ctx.moveTo(0, -140); ctx.lineTo(-80, -60); ctx.lineTo(-20, -90); ctx.lineTo(-70, -20); ctx.lineTo(0, -20); ctx.fill(); ctx.globalAlpha = 1; eye(-60, 50, 9, '#c7fff2'); eye(-20, 50, 9, '#c7fff2'); }
  else if (a === 'storm') { const g = ctx.createRadialGradient(0, 0, 10, 0, 0, 130); g.addColorStop(0, C('#e9f1ff')); g.addColorStop(1, 'rgba(90,110,160,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 130, 0, TAU); ctx.fill(); ctx.fillStyle = C('#5d6a8c'); for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.arc(-60 + k * 30, -20 + (k % 2) * 20, 45, 0, TAU); ctx.fill(); } eye(-25, -10, 10, '#fff36b'); eye(25, -10, 10, '#fff36b'); if (Math.sin(time * 5) > 0.7) { ctx.strokeStyle = '#fff36b'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-10, 40); ctx.lineTo(10, 80); ctx.lineTo(-5, 85); ctx.lineTo(15, 130); ctx.stroke(); } }
  else if (a === 'levi') { ctx.fillStyle = C('#2f4f6f'); ctx.beginPath(); ctx.ellipse(20, 60, 190, 80, 0, Math.PI, 0); ctx.fill(); ctx.beginPath(); ctx.ellipse(-80, -20, 90, 70, -0.2, 0, TAU); ctx.fill(); ctx.fillStyle = '#fff'; for (let k = 0; k < 8; k++) { ctx.beginPath(); ctx.moveTo(-150 + k * 14, 10); ctx.lineTo(-144 + k * 14, 28); ctx.lineTo(-138 + k * 14, 10); ctx.fill(); } eye(-100, -40, 14, '#ff6b4a'); for (let k = 0; k < 4; k++) { ctx.fillStyle = C('#3f6a8f'); ctx.beginPath(); ctx.moveTo(-10 + k * 50, 0); ctx.lineTo(10 + k * 50, -50); ctx.lineTo(30 + k * 50, 0); ctx.fill(); } }
  ctx.restore();
}
function render(time) {
  ctx.setTransform(viewScale * dpr, 0, 0, viewScale * dpr, 0, 0);
  ctx.save(); if (shake > 0.3) ctx.translate(rand(-1, 1) * shake, rand(-1, 1) * shake);
  ctx.drawImage(bg, 0, 0);
  drawWaves(time, 400, 10, '#2a7fb3', 0.8);
  if (R) drawMonster(R.mon, 1010, 300, time);
  drawShip(time);
  drawWaves(time, 470, 8, 'rgba(20,80,130,.85)', 1.2);
  if (R) {
    // deck slots and crew
    for (let i = 0; i < 4; i++) {
      const x = SLOT_X[i], c = R.slots[i], placing = selHand >= 0 && CARDS[R.hand[selHand]] && CARDS[R.hand[selHand]].crew;
      ctx.fillStyle = placing ? 'rgba(255,211,77,.25)' : 'rgba(0,0,0,.18)'; rr(x - 4, SLOT_Y - 4, CW + 8, CH + 8, 12); ctx.fill();
      if (placing) { ctx.strokeStyle = 'rgba(255,211,77,.9)'; ctx.lineWidth = 3; ctx.setLineDash([7, 6]); rr(x - 4, SLOT_Y - 4, CW + 8, CH + 8, 12); ctx.stroke(); ctx.setLineDash([]); }
      hudText(SLOTS[i].icon + ' ' + SLOTS[i].name, x + CW / 2, SLOT_Y + CH + 20, 14, '#fff6d9', 'center', 800);
      if (c) {
        const shot = fx.find(f => f.k === 'shot' && f.s === i), dx = shot ? Math.sin(Math.min(1, shot.t * 3) * Math.PI) * 18 : 0;
        drawCard(c.id, x + dx, SLOT_Y, CW, CH, { compact: true, cost: false });
        const a = crewAtk(R, i);
        circle(x + 16, SLOT_Y + CH - 16, 15, '#c0392b'); hudText(String(a), x + 16, SLOT_Y + CH - 15, 15, '#fff', 'center', 900, null);
        circle(x + CW - 16, SLOT_Y + CH - 16, 15, '#27ae60'); hudText(String(Math.max(0, c.hp)), x + CW - 16, SLOT_Y + CH - 15, 15, '#fff', 'center', 900, null);
        if (c.stun) hudText('💫', x + CW - 18, SLOT_Y + 18, 22, '#fff', 'center', 900, null);
      } else hudText('empty', x + CW / 2, SLOT_Y + CH / 2, 14, 'rgba(255,255,255,.55)', 'center', 700, null);
    }
    // cannon shots
    for (const f of fx) if (f.k === 'shot' && f.t < 0.3) { const k = f.t / 0.3, x = lerp(SLOT_X[f.s] + CW, 960, k), y = lerp(SLOT_Y + 50, 260, k) - Math.sin(k * Math.PI) * 60; circle(x, y, 8, '#222'); }
    // hull, block, monster bars + intent
    const hb = { x: 70, y: 100 };
    ctx.fillStyle = 'rgba(0,0,0,.55)'; rr(hb.x, hb.y, 360, 26, 13); ctx.fill(); ctx.fillStyle = '#c98a4b'; rr(hb.x + 2, hb.y + 2, 356 * R.hull / R.hullMax, 22, 11); ctx.fill();
    hudText(`🚢 Hull ${R.hull} / ${R.hullMax}` + (R.block ? `   🛡 ${R.block}` : ''), hb.x + 180, hb.y + 14, 15, '#fff', 'center', 900);
    const M = R.mon;
    ctx.fillStyle = 'rgba(0,0,0,.55)'; rr(890, 100, 300, 26, 13); ctx.fill(); ctx.fillStyle = '#d9534f'; rr(892, 102, 296 * M.hp / M.hpMax, 22, 11); ctx.fill();
    hudText(`${M.name}  ${M.hp} / ${M.hpMax}` + (M.block ? `  🛡${M.block}` : ''), 1040, 114, 15, '#fff', 'center', 900);
    ctx.fillStyle = 'rgba(20,10,10,.75)'; rr(870, 136, 340, 34, 17); ctx.fill();
    hudText('Next: ' + intentText(R.intent), 1040, 153, 15, '#ffd9b3', 'center', 800, null);
    hudText(`${SEAS[Math.floor(R.fight / 3)]}  ·  Fight ${R.fight + 1} / 9`, 640, 22, 16, '#fff', 'center', 800);
    // energy, piles
    circle(80, 600, 42, '#2f6fd1'); circle(80, 600, 36, '#4f8ff0'); hudText(`${R.energy}`, 80, 598, 36, '#fff', 'center', 900); hudText('energy', 80, 655, 13, '#cfe3ff', 'center', 800);
    hudText(`🂠 ${R.draw.length}  ·  ♻ ${R.discard.length}`, 80, 690, 13, '#cfe3ff', 'center', 800);
    // hand
    const n = R.hand.length;
    R.hand.forEach((id, i) => { const r = handRect(i, n), sel = i === selHand; drawCard(id, r.x, r.y - (sel ? 26 : 0), r.w, r.h, { sel, alpha: CARDS[id].cost > R.energy ? 0.55 : 1 }); });
    // end turn
    ctx.fillStyle = busy ? '#6b5a4a' : '#d9822b'; rr(END_BTN.x, END_BTN.y, END_BTN.w, END_BTN.h, 14); ctx.fill();
    hudText('End turn ⟳', END_BTN.x + END_BTN.w / 2, END_BTN.y + END_BTN.h / 2, 22, '#fff', 'center', 900);
    hudText('📜 Deck (' + R.deck.length + ')', END_BTN.x + END_BTN.w / 2, END_BTN.y - 22, 14, '#e6f1ff', 'center', 800);
    // guidance
    if (selHand >= 0) { const C = CARDS[R.hand[selHand]]; hudText(C.crew ? 'Tap a spot on the deck for your ' + C.name : 'Tap the card again to play ' + C.name, 640, 516, 16, '#ffe9a8', 'center', 800); }
    else if (R.fight === 0 && R.turn === 1) hudText('Tap a card, then a spot on the deck. Crew stay and act every turn.', 640, 516, 16, '#ffe9a8', 'center', 800);
    for (const f of floaters) { ctx.globalAlpha = Math.max(0, 1 - f.t / 1.2); hudText(f.s, f.x, f.y - f.t * 45, f.big ? 30 : 22, f.c, 'center', 900); }
    ctx.globalAlpha = 1;
    if (toastMsg) { ctx.globalAlpha = Math.min(1, 3 - toastMsg.t); ctx.font = '800 18px system-ui'; const tw = ctx.measureText(toastMsg.s).width + 40; ctx.fillStyle = 'rgba(8,20,35,.85)'; rr(W / 2 - tw / 2, 50, tw, 36, 18); ctx.fill(); hudText(toastMsg.s, W / 2, 68, 18, '#e6f1ff', 'center', 800); ctx.globalAlpha = 1; }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------
//  Input
// ---------------------------------------------------------------------
const inR = (p, b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
canvas.addEventListener('pointerdown', e => {
  if (state !== 'play' || !R || Platform.inAd) return;
  const p = toCanvas(e);
  if (inR(p, END_BTN)) { Sound.play('click'); doEndTurn(); return; }
  if (inR(p, { x: END_BTN.x, y: END_BTN.y - 36, w: END_BTN.w, h: 28 })) { showDeck(); return; }
  for (let i = R.hand.length - 1; i >= 0; i--) {
    const r = handRect(i, R.hand.length), y = r.y - (i === selHand ? 26 : 0);
    if (p.x >= r.x && p.x <= r.x + (i === R.hand.length - 1 ? r.w : Math.min(r.w, handRect(i + 1, R.hand.length).x - r.x)) && p.y >= y && p.y <= y + r.h) {
      if (busy) return;
      if (selHand === i && CARDS[R.hand[i]].order) { tryPlay(i, null); return; }
      selHand = selHand === i ? -1 : i; Sound.play('card'); return;
    }
  }
  if (selHand >= 0) for (let s = 0; s < 4; s++) if (inR(p, { x: SLOT_X[s] - 4, y: SLOT_Y - 4, w: CW + 8, h: CH + 8 })) {
    if (CARDS[R.hand[selHand]].crew) tryPlay(selHand, s); else tryPlay(selHand, null);
    return;
  }
  selHand = -1;
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('keydown', e => {
  if (state === 'play' && R && !busy && !Platform.inAd) {
    if (/^Digit[1-8]$/.test(e.code)) { const i = +e.code[5] - 1; if (i < R.hand.length) { if (selHand === i && CARDS[R.hand[i]].order) tryPlay(i, null); else { selHand = i; Sound.play('card'); } } }
    if (['KeyQ', 'KeyW', 'KeyE', 'KeyR'].includes(e.code) && selHand >= 0 && CARDS[R.hand[selHand]].crew) tryPlay(selHand, ['KeyQ', 'KeyW', 'KeyE', 'KeyR'].indexOf(e.code));
    if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); doEndTurn(); }
  }
  if (e.code === 'Escape' && !e.repeat) { if (state === 'play') pauseGame(); else if (state === 'paused') setState('play'); else if (state === 'deck') setState('play'); }
});
function showDeck() {
  const counts = {}; for (const id of R.deck) counts[id] = (counts[id] || 0) + 1;
  $('deckList').innerHTML = Object.keys(counts).map(id => `<div class="dcard"><i>${CARDS[id].icon}</i><b>${counts[id]}× ${CARDS[id].name}</b><small>${CARDS[id].text}</small></div>`).join('');
  setState('deck');
}
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(true); Sound.setHidden(document.hidden); });
$('ui').addEventListener('click', e => { const b = e.target.closest('button'); if (b && b.id !== 'muteBtn') Sound.play('click'); });
setupMute();
let firstPlay = true;
$('playBtn').onclick = () => { if (firstPlay) { firstPlay = false; $('playBtn').disabled = true; Platform.commercialBreak().then(() => { $('playBtn').disabled = false; startRun(); }); } else startRun(); };
$('howBtn').onclick = () => $('how').classList.toggle('open');
$('pauseBtn').onclick = () => pauseGame();
$('resumeBtn').onclick = () => setState('play');
$('quitBtn').onclick = () => { runId++; busy = false; R = null; setState('menu'); };
$('deckBack').onclick = () => setState('play');
$('againBtn').onclick = () => { $('againBtn').disabled = true; Platform.commercialBreak().then(() => { $('againBtn').disabled = false; startRun(); }); };
$('menuBtn').onclick = () => { runId++; busy = false; R = null; setState('menu'); };
$('reviveBtn').onclick = revive;
const portraitMQ = window.matchMedia('(orientation: portrait) and (pointer: coarse)');
if (portraitMQ.addEventListener) portraitMQ.addEventListener('change', () => { if (portraitMQ.matches) pauseGame(); });

// ---------------------------------------------------------------------
//  Main loop
// ---------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  let dt = (now - last) / 1000; last = now; if (dt > 0.05) dt = 0.05;
  for (const f of fx) f.t += dt; fx = fx.filter(f => f.t < 1);
  for (const f of floaters) f.t += dt; floaters = floaters.filter(f => f.t < 1.2);
  if (toastMsg) { toastMsg.t += dt; if (toastMsg.t > 3) toastMsg = null; }
  shake *= Math.exp(-9 * dt); monHit = Math.max(0, monHit - dt);
  render(now / 1000);
  requestAnimationFrame(frame);
}
(async function boot() {
  await Platform.init();
  setState('menu');
  Platform.loadingFinished();
  requestAnimationFrame(t => { last = t; frame(t); });
  // DEBUG-START (removed from release builds by build.py)
  window.__dh = {
    get R() { return R; }, get state() { return state; }, startRun, tryPlay, doEndTurn, CARDS, MONSTERS,
    // heuristic bot: tries every way to play each card, keeps the best-scoring board, repeats; then ends the turn
    botTurn(S) {
      const value = T => {
        let v = 0; const M = T.mon;
        v -= M.hp * 3; v += T.hull * 2 + T.block * 1.2;
        for (let i = 0; i < 4; i++) { const c = T.slots[i]; if (!c) continue; v += crewAtk(T, i) * 4 + c.hp * (i === 3 ? 1.2 : 0.6); if (c.id === 'navigator' && i === 0) v += 5; if (c.id === 'surgeon') v += 3; if (c.id === 'lookout') v += 3; }
        if (T.slots[3]) v += 6;            // something in front to soak hits
        return v;
      };
      const clone = T => JSON.parse(JSON.stringify(T));
      for (let loop = 0; loop < 10; loop++) {
        let best = null, bv = value(S);
        S.hand.forEach((id, h) => {
          const C = CARDS[id]; if (C.cost > S.energy || C.junk) return;
          const targets = C.crew ? [0, 1, 2, 3] : [null];
          for (const s of targets) { const T = clone(S); playCard(T, h, s); const v = value(T) - (C.crew && S.slots[s] ? 2 : 0); if (v > bv + 0.5) { bv = v; best = [h, s]; } }
        });
        if (!best) break;
        playCard(S, best[0], best[1]);
        if (S.mon.hp <= 0) return 'win';
      }
      const ev = endTurn(S);
      return ev.some(e => e.t === 'win') ? 'win' : ev.some(e => e.t === 'lose') ? 'lose' : 'go';
    },
    simulate(runs, seed0 = 1) {
      const res = [], turns = [];
      for (let r = 0; r < runs; r++) {
        const S = newRun(seed0 + r); let t = 0;
        while (t < 400) {
          const out = this.botTurn(S); t++;
          if (out === 'lose') break;
          if (out === 'win') {
            afterFight(S); if (S.fight >= MONSTERS.length) break;
            // take the first offered crew card that isn't a duplicate-heavy pick
            const ch = rewardChoices(S); S.deck.push(ch.find(id => CARDS[id].crew) || ch[0]);
            startFight(S);
          }
        }
        res.push(S.fight); turns.push(t);
      }
      res.sort((a, b) => a - b);
      return `fights won: ${res.join(' ')} | median ${res[res.length >> 1]} | full wins ${res.filter(x => x >= 9).length}/${runs} | avg turns ${Math.round(turns.reduce((a, b) => a + b, 0) / runs)}`;
    },
    set hideHud(v) { hideHud = v; },
    // store-art scene: the Kraken against a full deck
    stage() {
      startRun(11); R.fight = 5; startFight(R); R.mon.hp = Math.round(R.mon.hpMax * 0.62);
      R.slots = [{ id: 'navigator', hp: 3, hpMax: 3 }, { id: 'gunner', hp: 3, hpMax: 3 }, { id: 'gunner', hp: 2, hpMax: 3 }, { id: 'bruiser', hp: 8, hpMax: 11 }];
      R.hand = ['broadside', 'bosun', 'harpooner', 'patch', 'monkey']; R.energy = 4; R.hull = 31; R.intent = ['grab', 1];
      toastMsg = null; selHand = 0; fx = [{ k: 'shot', s: 2, t: 0.16 }, { k: 'shot', s: 1, t: 0.1 }]; floaters = [{ x: 1010, y: 190, s: '-12', c: '#ffd34d', t: 0.2, big: true }];
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
