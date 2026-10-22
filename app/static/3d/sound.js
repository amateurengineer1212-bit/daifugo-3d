// sound.js：BGM と効果音（Claude・2026-10-22 会長の追加要件）
// - 再生は howler.js 2.2.4（MIT・lib/howler.core.min.js）。スマホの自動再生の制限は、最初のタップ／クリックで howler が解除する
// - 音源は audio/（CC0：Kenney の札の音、lokif の操作音、U.S. Army Blues の演奏。出どころは THIRD_PARTY_NOTICES.md）
// - 既存の音源が無い物（手番の知らせ・革命／8切りの演出音・ファンファーレ）は Web Audio で短く合成する
// - BGM と効果音は別々に音量とミュートを持ち、localStorage に保存する。音が出なくてもゲームは止めない（全部 try/catch）
const KEY = 'daifugo3d.sound';
const DEFAULTS = { bgm: 0.22, sfx: 0.5, bgmMute: false, sfxMute: false, track: 'main_stem' };
const TRACKS = {
  main_stem: { file: 'audio/main_stem.mp3', title: 'Main Stem（U.S. Army Blues・CC0 の演奏）' },
  gospel_truth: { file: 'audio/gospel_truth.mp3', title: 'The Gospel Truth（U.S. Army Blues・CC0）' }
};
const SFX = {
  shuffle: { files: ['audio/cardshove1.mp3'], vol: 0.9 },
  deal: { files: ['audio/cardslide2.mp3', 'audio/cardslide3.mp3'], vol: 0.8 },
  place: { files: ['audio/cardplace2.mp3', 'audio/cardplace3.mp3', 'audio/cardplace4.mp3'], vol: 1.0 },
  select: { files: ['audio/misc_menu_4.mp3'], vol: 0.35, rate: 1.15 },
  deselect: { files: ['audio/misc_menu_4.mp3'], vol: 0.3, rate: 0.9 },
  pass: { files: ['audio/cardslide3.mp3'], vol: 0.45, rate: 0.85 },
  flow: { files: ['audio/cardshove3.mp3'], vol: 0.7 },
  error: { files: ['audio/negative.mp3'], vol: 0.6 },
  ok: { files: ['audio/positive.mp3'], vol: 0.5 },
  chips: { files: ['audio/chipsstack3.mp3', 'audio/chipsstack5.mp3'], vol: 0.7 },
  // 追加要件 6（2026-10-22）：操作ごとの音。音源は同じ CC0 の物を音程・音量で使い分ける
  ui: { files: ['audio/misc_menu_4.mp3'], vol: 0.22, rate: 1.0 },            // ボタン・設定の開閉
  room: { files: ['audio/positive.mp3'], vol: 0.4, rate: 1.1 },               // 部屋を作る・参加
  start: { files: ['audio/chipsstack3.mp3'], vol: 0.6 },                      // 対戦開始
  drag: { files: ['audio/misc_menu_4.mp3'], vol: 0.28, rate: 1.25 },          // なぞって 1 枚足す（軽く・重ねない）
  deselect_all: { files: ['audio/cardslide2.mp3'], vol: 0.4, rate: 1.1 },     // 背景タップで全部戻す（1 回だけ）
  place_group: { files: ['audio/cardplace3.mp3', 'audio/cardplace4.mp3'], vol: 1.0, rate: 0.92 },   // 複数枚を組で出す
  cpu_place: { files: ['audio/cardplace2.mp3', 'audio/cardplace3.mp3'], vol: 0.75 },               // CPU・相手が出す
  round_start: { files: ['audio/chipsstack5.mp3'], vol: 0.5 },                // ラウンド開始
  bomb: { files: ['audio/cardshove1.mp3'], vol: 0.9, rate: 0.7 }              // 12ボンバー
};

let settings = Object.assign({}, DEFAULTS);
try { Object.assign(settings, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* 既定のまま */ }
function save() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* 保存できなくてもよい */ } }

const H = () => (typeof window !== 'undefined' && window.Howl) ? window : null;
const howls = {};
let bgm = null, bgmTrack = null, started = false, lastPlayed = {};

function howlFor(file, vol) {
  const w = H(); if (!w) return null;
  if (!howls[file]) {
    howls[file] = new w.Howl({ src: [file], volume: vol, preload: true, html5: false, onloaderror: () => { howls[file]._broken = true; } });
  }
  return howls[file];
}
/** 効果音を鳴らす。同じ名前は 60ms 以内に 2 回鳴らさない（重複の防止） */
const LOG = (name, status) => { try { (window.__sndLog = window.__sndLog || []).push([name, Math.round(performance.now()), status]); } catch (e) {} };   // 確かめ用の記録（on＝実際に鳴らした／skip＝重複で抑えた／mute＝消音中）
export function play(name, opts = {}) {
  try {
    if (settings.sfxMute) { LOG(name, 'mute'); return; }
    const def = SFX[name];
    if (!def) return synth(name, opts);
    const now = performance.now();
    if (lastPlayed[name] && now - lastPlayed[name] < (opts.gap ?? 60)) { LOG(name, 'skip'); return; }
    lastPlayed[name] = now;
    LOG(name, 'on');
    const file = def.files[Math.floor(Math.random() * def.files.length)];
    const h = howlFor(file, def.vol * settings.sfx);
    if (!h || h._broken) return;
    const id = h.play();
    h.volume(def.vol * settings.sfx * (opts.vol ?? 1), id);
    if (def.rate || opts.rate) h.rate((def.rate || 1) * (opts.rate || 1), id);
  } catch (e) { /* 音が出なくてもゲームは続ける */ }
}

// ---- 合成音（既存音源が無い物） ----
function ctx() { const w = H(); return w && w.Howler && w.Howler.ctx ? w.Howler.ctx : null; }
function tone(c, dest, f, t0, dur, type = 'sine', vol = 0.2, slide = 0) {
  const o = c.createOscillator(); const g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f + slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur + 0.05);
}
function synth(name, opts = {}) {
  const c = ctx(); if (!c) { LOG(name, 'noctx'); return; }
  const now = performance.now();
  if (lastPlayed[name] && now - lastPlayed[name] < (opts.gap ?? 200)) { LOG(name, 'skip'); return; }
  lastPlayed[name] = now;
  LOG(name, 'on');
  const dest = c.createGain(); dest.gain.value = settings.sfx * 0.9; dest.connect(window.Howler.masterGain || c.destination);
  const t = c.currentTime + 0.01;
  if (name === 'turn') {            // 自分の手番：短い 2 音のチャイム
    tone(c, dest, 880, t, 0.16, 'sine', 0.18); tone(c, dest, 1318.5, t + 0.14, 0.26, 'sine', 0.16);
  } else if (name === 'revolution') { // 革命：下へ滑る音＋低い打音
    tone(c, dest, 660, t, 0.45, 'sawtooth', 0.12, -500); tone(c, dest, 110, t + 0.05, 0.5, 'triangle', 0.2);
  } else if (name === 'eightcut') {   // 8切り／スペ3返し：上へ抜ける音
    tone(c, dest, 300, t, 0.3, 'triangle', 0.16, 900); tone(c, dest, 1200, t + 0.25, 0.18, 'sine', 0.12);
  } else if (name === 'fanfare') {    // ラウンド終了：短いファンファーレ（C-E-G-C）
    const seq = [523.25, 659.25, 783.99, 1046.5];
    seq.forEach((f, i) => { tone(c, dest, f, t + i * 0.13, i === 3 ? 0.7 : 0.18, 'square', 0.07); tone(c, dest, f / 2, t + i * 0.13, i === 3 ? 0.7 : 0.18, 'triangle', 0.08); });
  } else if (name === 'win') {        // 上がり：短い上昇
    tone(c, dest, 784, t, 0.12, 'sine', 0.14); tone(c, dest, 1046.5, t + 0.1, 0.25, 'sine', 0.14);
  } else if (name === 'special') {    // 特殊ルールの発動（11バック・しばり・リバース・スキップ・7渡し・10捨て・禁止あがり・都落ち）
    tone(c, dest, 523.25, t, 0.1, 'triangle', 0.12); tone(c, dest, 698.46, t + 0.09, 0.1, 'triangle', 0.12); tone(c, dest, 1046.5, t + 0.18, 0.22, 'sine', 0.1);
  } else if (name === 'disconnect') { // 通信が切れた：下がる 2 音
    tone(c, dest, 660, t, 0.14, 'sine', 0.14); tone(c, dest, 440, t + 0.14, 0.3, 'sine', 0.14);
  } else if (name === 'reconnect') {  // つながった：上がる 2 音
    tone(c, dest, 440, t, 0.14, 'sine', 0.14); tone(c, dest, 660, t + 0.14, 0.3, 'sine', 0.14);
  }
}

// ---- BGM ----
export function startBgm() {
  try {
    const w = H(); if (!w) return;
    started = true;
    const tr = TRACKS[settings.track] || TRACKS.main_stem;
    if (bgm && bgmTrack === settings.track) { if (!bgm.playing()) bgm.play(); bgm.mute(settings.bgmMute); bgm.volume(settings.bgm); return; }
    if (bgm) { bgm.stop(); bgm.unload(); }
    bgmTrack = settings.track;
    bgm = new w.Howl({ src: [tr.file], loop: true, volume: 0.0001, html5: true, preload: true });
    bgm.play();
    bgm.mute(settings.bgmMute);
    bgm.fade(0.0001, settings.bgm, 1800);
  } catch (e) { /* 鳴らなくてもよい */ }
}
export function stopBgm() { try { if (bgm) bgm.stop(); } catch (e) {} }
function applyBgm() { try { if (bgm) { bgm.mute(settings.bgmMute); bgm.volume(settings.bgm); } } catch (e) {} }

// ---- 設定の UI（♪ ボタン → 小さな板） ----
export function mountUi(parent) {
  const btn = document.createElement('button');
  btn.type = 'button'; btn.id = 'sound-btn'; btn.title = '音の設定';
  btn.textContent = '♪';
  const panel = document.createElement('div');
  panel.id = 'sound-panel';
  panel.innerHTML = `
    <div class="sp-row"><label>BGM <input id="sp-bgm" type="range" min="0" max="100"></label><button type="button" id="sp-bgm-mute" class="sp-mute">BGM 消音</button></div>
    <div class="sp-row"><label>効果音 <input id="sp-sfx" type="range" min="0" max="100"></label><button type="button" id="sp-sfx-mute" class="sp-mute">効果音 消音</button></div>
    <div class="sp-row"><label>曲 <select id="sp-track"></select></label></div>
    <div class="sp-note">音が出ないときは、一度画面をタップしてください</div>`;
  parent.appendChild(btn); parent.appendChild(panel);
  const sel = panel.querySelector('#sp-track');
  for (const k of Object.keys(TRACKS)) { const o = document.createElement('option'); o.value = k; o.textContent = TRACKS[k].title; sel.appendChild(o); }
  const sync = () => {
    panel.querySelector('#sp-bgm').value = Math.round(settings.bgm * 100);
    panel.querySelector('#sp-sfx').value = Math.round(settings.sfx * 100);
    panel.querySelector('#sp-bgm-mute').classList.toggle('on', settings.bgmMute);
    panel.querySelector('#sp-bgm-mute').textContent = settings.bgmMute ? 'BGM 消音中' : 'BGM 消音';
    panel.querySelector('#sp-sfx-mute').classList.toggle('on', settings.sfxMute);
    panel.querySelector('#sp-sfx-mute').textContent = settings.sfxMute ? '効果音 消音中' : '効果音 消音';
    sel.value = settings.track;
    btn.classList.toggle('muted', settings.bgmMute && settings.sfxMute);
  };
  sync();
  btn.addEventListener('click', () => { panel.classList.toggle('open'); play('ui'); if (started) startBgm(); });
  panel.querySelector('#sp-bgm').addEventListener('input', (e) => { settings.bgm = (+e.target.value) / 100; save(); applyBgm(); });
  panel.querySelector('#sp-sfx').addEventListener('input', (e) => { settings.sfx = (+e.target.value) / 100; save(); });
  panel.querySelector('#sp-sfx').addEventListener('change', () => play('select'));
  panel.querySelector('#sp-bgm-mute').addEventListener('click', () => { settings.bgmMute = !settings.bgmMute; save(); applyBgm(); sync(); });
  panel.querySelector('#sp-sfx-mute').addEventListener('click', () => { settings.sfxMute = !settings.sfxMute; save(); sync(); });
  sel.addEventListener('change', () => { settings.track = sel.value; save(); if (started) startBgm(); });
  return { btn, panel, sync };
}
export function getSettings() { return Object.assign({}, settings); }
export function setSettings(patch) { Object.assign(settings, patch); save(); applyBgm(); }
export function isBgmPlaying() { try { return !!(bgm && bgm.playing()); } catch (e) { return false; } }
export const tracks = TRACKS;
