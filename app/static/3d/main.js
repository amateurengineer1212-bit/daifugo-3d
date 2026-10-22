// 3D 対戦画面 main.js（Claude・2026-10-22 会長の最終依頼と追加要件で整理し直した版）
//
// 役割の分担：
//   - 通信・ゲームの決まり：game_client.js（既存の createAndStart／playCards／doPass／ポーリングはそのまま。参加・待合・ルール・待ちの行動を足した）
//   - ルール設定の画面：rules_ui.js（18 項目の名前・説明・値・保存と読込・初期化・違いの表示）
//   - 見た目の値：design.json（gemma4:31b が参考画像を見て決めた色・照明・カメラ・卓・手札・席・演出の値）と style.css（同じく gemma4）
//   - 描画と操作のつなぎ：このファイル（three.js の卓と札、手札の扇形と当たり判定、タップ／なぞりで選ぶ、背景タップで解除、
//     合法手に基づく選択可否、7渡し・10捨て・12ボンバー・交換の選択モード、配る・出す・CPU・流れるの動き、HUD、音の合図）
// 流用した実装：
//   - open-poker（MIT）src/render/ThreeScene.ts の layoutHand（扇形の並び・傾き・弧）、CardObject.ts の moveTo／setSelected（持ち上げの考え方）、
//     Interaction.ts の「押した所からほとんど動かさずに離したら選ぶ」（タップとなぞりの区別）、cardTextures.ts の canvas の札（角の数字とスート）
//   - letele/playing-cards（CC0）の札の SVG を札の表・裏の絵に、Poly Haven stretch_poplin（CC0）をフェルトに、@tweenjs/tween.js（MIT）を動きに使う
import * as THREE from 'three';
import * as gameClient from './game_client.js';
import { Tween, Easing, Group as TweenGroup } from './lib/tween.esm.js';
import * as Sound from './sound.js';
import * as Rules from './rules_ui.js';

// tween.js 25：new Tween(obj) は自分の Group に入れて、描画のたびに group.update() で進める（既定の mainGroup には入らない）
const tweenGroup = new TweenGroup();

// ---------------------------------------------------------------------------
// design.json（gemma4 の値）。読めないときだけ最低限の既定で動かす
// ---------------------------------------------------------------------------
let D = null;
async function loadDesign() {
  try {
    const r = await fetch('design.json', { cache: 'no-cache' });
    D = await r.json();
  } catch (e) {
    console.warn('design.json を読めないので既定の値で描きます', e);
    D = {
      colors: { felt: '#3a9d43', felt_center: '#76c861', felt_edge: '#266b2d', rim_wood: '#5d3a1a', rim_wood_light: '#a67c52', leather: '#321f12', gold: '#f1c40f',
        card_face: '#ffffff', card_red: '#d32f2f', card_black: '#1a1a1a', card_back_main: '#1a4a8a', card_back_accent: '#f1c40f' },
      lights: { ambient: 0.7, hemisphere: { sky: '#e0ffe0', ground: '#2a5a2a', intensity: 0.8 }, key: { intensity: 1.6, position: [5, 15, 5] },
        fill: { intensity: 0.7, position: [-5, 8, -5] }, spot_center: { intensity: 2.5, angle_deg: 45, penumbra: 0.5, position: [0, 15, 0] } },
      camera: { pc: { fov: 45, position: [0, 12, 10], look_at: [0, 0, -0.5] }, mobile: { fov: 55, position: [0, 14, 8], look_at: [0, 0, -1.0] } },
      table: { radius: 8.0, felt_repeat: 2, felt_roughness: 0.8, top_y: 0.5, rim: { tube: 0.6, roughness: 0.3, metalness: 0.1 },
        leather_band: { tube: 0.25, roughness: 0.8 }, gold_trim: { tube: 0.06, metalness: 1.0, roughness: 0.2 } },
      card: { width: 1.2, height: 1.68, thickness: 0.05, corner_rank_ratio: 0.32, corner_suit_ratio: 0.25, roughness: 0.5 },
      hand: { pc: { distance: 5.5, width_ratio: 0.7, y_offset: -2.0, spread_deg: 22, tilt_deg: 15, lift_arc: 0.3, select_lift: 0.6 },
        mobile: { distance: 4.5, width_ratio: 0.9, y_offset: -2.0, spread_deg: 28, tilt_deg: 18, lift_arc: 0.4, select_lift: 0.5 } },
      field: { scale_pc: 1.4, scale_mobile: 1.2, spread: 0.6, jitter_deg: 8, lift_y: 0.08, center: [0, 0, -1.0] },
      opponents: { backs_scale: 0.6, backs_radius: 6.5, positions_pct: { '3': [[15, 20], [50, 0], [85, 20]], '4': [[10, 40], [35, 10], [65, 10], [90, 40]], '5': [[5, 60], [25, 20], [50, 0], [75, 20], [95, 60]] } },
      animation: { deal_ms: 350, deal_stagger_ms: 50, play_ms: 450, select_ms: 200, cpu_play_ms: 600, flow_ms: 500, easing: 'Cubic.Out' }
    };
  }
}
// 【Claude の統合の調整】gemma4 の値のうち、実画面（PC 1280x720・スマホ 390x844）で確かめて直した所。元の値は design.json に残す
const OVERRIDES = {
  hand: { pc: { y_offset: -1.75, width_ratio: 0.62, x_offset: -0.05 }, mobile: { y_offset: -1.35, width_ratio: 0.92, spread_deg: 20, tilt_deg: 14, x_offset: 0 } },
  field: { scale_mobile: 1.45 },
  animation: { deal_stagger_ms: 42 }
};
function applyOverrides() {
  for (const prof of ['pc', 'mobile']) Object.assign(D.hand[prof], OVERRIDES.hand[prof]);
  Object.assign(D.field, OVERRIDES.field);
  Object.assign(D.animation, OVERRIDES.animation);
}
function ease() {
  const [a, b] = String(D.animation.easing || 'Cubic.Out').split('.');
  return (Easing[a] && Easing[a][b]) ? Easing[a][b] : Easing.Cubic.Out;
}
const $ = (id) => document.getElementById(id);
// 同じ物（position／rotation／scale）に走っている動きは止めてから次を始める（古い動きと取り合わないように）
const runningTweens = new WeakMap();
function tweenTo(target, to, ms, opts = {}) {
  const prev = runningTweens.get(target);
  if (prev) prev.stop();
  const t = new Tween(target, tweenGroup).to(to, ms).easing(opts.easing || ease()).delay(opts.delay || 0);
  if (opts.onComplete) t.onComplete(opts.onComplete);
  t.start();
  runningTweens.set(target, t);
  return t;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 画面の切り替え・お知らせ
// ---------------------------------------------------------------------------
function showScreen(name) {
  for (const id of ['name-screen', 'wait-screen', 'game-screen']) {
    $(id).classList.toggle('active', id === name + '-screen');
  }
}
function showResult(on) { $('result-screen').classList.toggle('active', !!on); }
let toastTimer = null;
function toast(text, ms = 2200) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
// 既存の通信処理（game_client）の alert は、画面を止めない知らせに置き換える（拒否の理由は札を消さずに示す）
window.alert = (m) => toast(String(m));

// ---------------------------------------------------------------------------
// 札の名前（S3・H10・SJ・X1）と表示
// ---------------------------------------------------------------------------
const SUIT_CHAR = { S: '♠', H: '♥', D: '♦', C: '♣' };
const CHAR_SUIT = { '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C' };
function getCardLabel(cardId) {
  if (!cardId) return '';
  if (cardId.startsWith('X')) return 'JOKER';
  return (SUIT_CHAR[cardId[0]] || '') + cardId.slice(1);
}
function svgNameFor(cardId) {
  if (cardId.startsWith('X')) return 'assets/J-' + (cardId === 'X2' ? '2' : '1') + '.svg';
  return 'assets/' + cardId[0] + '-' + cardId.slice(1) + '.svg';
}

// ---------------------------------------------------------------------------
// 札の絵（canvas → テクスチャ）。letele の SVG を描き、角の数字とスートを大きく重ねる（open-poker の cardTextures の考え方）
// ---------------------------------------------------------------------------
const TEX_W = 512, TEX_H = 717, TEX_R = 40;
const textureCache = new Map();
const imageCache = new Map();
function loadImage(src) {
  if (imageCache.has(src)) return imageCache.get(src);
  const p = new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
  imageCache.set(src, p);
  return p;
}
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function drawCorner(ctx, cardId) {
  const isJoker = cardId.startsWith('X');
  const suit = isJoker ? '' : SUIT_CHAR[cardId[0]];
  const rank = isJoker ? 'JOKER' : cardId.slice(1);
  const red = (cardId[0] === 'H' || cardId[0] === 'D');
  const color = isJoker ? '#7b1fa2' : (red ? D.colors.card_red : D.colors.card_black);
  const rankPx = Math.round(TEX_W * D.card.corner_rank_ratio);
  const suitPx = Math.round(TEX_W * D.card.corner_suit_ratio);
  const draw = () => {
    ctx.fillStyle = D.colors.card_face;
    roundRectPath(ctx, 14, 14, isJoker ? 230 : rankPx * 1.15 + 20, rankPx + suitPx + 28, 14);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    if (isJoker) {
      ctx.font = 'bold ' + Math.round(rankPx * 0.55) + 'px "Trebuchet MS", "Hiragino Sans", Arial, sans-serif';
      ctx.fillText('JOKER', 22, 22 + rankPx * 0.5);
      ctx.font = 'bold ' + suitPx + 'px serif';
      ctx.fillText('★', 24, 22 + rankPx * 0.5 + suitPx);
    } else {
      ctx.font = 'bold ' + rankPx + 'px "Trebuchet MS", "Hiragino Sans", Arial, sans-serif';
      ctx.fillText(rank, 22, 18 + rankPx * 0.92);
      ctx.font = 'bold ' + suitPx + 'px serif';
      ctx.fillText(suit, 26, 18 + rankPx * 0.92 + suitPx * 0.95);
    }
  };
  draw();
  ctx.save();
  ctx.translate(TEX_W, TEX_H);
  ctx.rotate(Math.PI);
  draw();
  ctx.restore();
}
function paintFine(ctx) {
  // 細かな印刷（薄い格子と縁の二重線）：紙らしさ
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.05)';
  ctx.lineWidth = 1;
  for (let x = 24; x < TEX_W; x += 16) { ctx.beginPath(); ctx.moveTo(x, 20); ctx.lineTo(x, TEX_H - 20); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(120,90,40,0.35)';
  ctx.lineWidth = 2;
  roundRectPath(ctx, 12, 12, TEX_W - 24, TEX_H - 24, TEX_R - 8);
  ctx.stroke();
  ctx.restore();
}
function faceTexture(cardId) {
  const key = 'face:' + cardId;
  if (textureCache.has(key)) return textureCache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W; canvas.height = TEX_H;
  const ctx = canvas.getContext('2d');
  const paint = (img) => {
    ctx.clearRect(0, 0, TEX_W, TEX_H);
    ctx.save();
    roundRectPath(ctx, 0, 0, TEX_W, TEX_H, TEX_R);
    ctx.clip();
    ctx.fillStyle = D.colors.card_face;
    ctx.fillRect(0, 0, TEX_W, TEX_H);
    if (img) ctx.drawImage(img, 0, 0, TEX_W, TEX_H);
    paintFine(ctx);
    drawCorner(ctx, cardId);
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 3;
    roundRectPath(ctx, 1.5, 1.5, TEX_W - 3, TEX_H - 3, TEX_R);
    ctx.stroke();
    tex.needsUpdate = true;
  };
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  paint(null);
  loadImage(svgNameFor(cardId)).then((img) => { if (img) paint(img); });
  textureCache.set(key, tex);
  return tex;
}
function backTexture() {
  const key = 'back';
  if (textureCache.has(key)) return textureCache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W; canvas.height = TEX_H;
  const ctx = canvas.getContext('2d');
  const paint = (img) => {
    ctx.clearRect(0, 0, TEX_W, TEX_H);
    ctx.save();
    roundRectPath(ctx, 0, 0, TEX_W, TEX_H, TEX_R);
    ctx.clip();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, TEX_W, TEX_H);
    if (img) ctx.drawImage(img, 0, 0, TEX_W, TEX_H);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = D.colors.card_back_main;
    ctx.fillRect(0, 0, TEX_W, TEX_H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = D.colors.card_back_accent;
    ctx.lineWidth = 8;
    roundRectPath(ctx, 26, 26, TEX_W - 52, TEX_H - 52, 26);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 3;
    roundRectPath(ctx, 1.5, 1.5, TEX_W - 3, TEX_H - 3, TEX_R);
    ctx.stroke();
    tex.needsUpdate = true;
  };
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  paint(null);
  loadImage('assets/B-1.svg').then((img) => { if (img) paint(img); });
  textureCache.set(key, tex);
  return tex;
}

// ---------------------------------------------------------------------------
// 札の 3D 物体：表・裏の板（角丸）＋厚みの芯＋選んだときの金の縁
// ---------------------------------------------------------------------------
let cardGeo = null, coreGeoA = null, coreGeoB = null, sideMat = null, glowGeo = null, glowMat = null;
function cardGeometries() {
  if (cardGeo) return;
  const w = D.card.width, h = D.card.height, t = D.card.thickness;
  cardGeo = new THREE.PlaneGeometry(w, h);
  coreGeoA = new THREE.BoxGeometry(w - 0.16, h, t * 0.96);
  coreGeoB = new THREE.BoxGeometry(w, h - 0.16, t * 0.96);
  sideMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.7 });
  glowGeo = new THREE.PlaneGeometry(w + 0.14, h + 0.14);
  glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(D.colors.seat_turn_glow || '#fff200'), transparent: true, opacity: 0.0, depthWrite: false });
}
function makeCard(cardId, faceUp = true) {
  cardGeometries();
  const g = new THREE.Group();
  const t = D.card.thickness;
  const faceMat = new THREE.MeshStandardMaterial({ map: faceUp ? faceTexture(cardId) : backTexture(), transparent: true, alphaTest: 0.5, roughness: D.card.roughness, metalness: 0.0, envMapIntensity: 0.6 });
  const backMat = new THREE.MeshStandardMaterial({ map: backTexture(), transparent: true, alphaTest: 0.5, roughness: 0.7, metalness: 0.0, envMapIntensity: 0.4 });
  const face = new THREE.Mesh(cardGeo, faceMat);
  face.position.z = t / 2;
  const back = new THREE.Mesh(cardGeo, backMat);
  back.position.z = -t / 2;
  back.rotation.y = Math.PI;
  const coreA = new THREE.Mesh(coreGeoA, sideMat);
  const coreB = new THREE.Mesh(coreGeoB, sideMat);
  const glow = new THREE.Mesh(glowGeo, glowMat.clone());
  glow.position.z = -t / 2 - 0.004;
  glow.visible = false;
  g.add(glow, face, back, coreA, coreB);
  g.userData.cardId = cardId;
  g.userData.face = face;
  g.userData.glow = glow;
  face.userData.card = g; back.userData.card = g;
  return g;
}
function setCardGlow(g, on) {
  const glow = g.userData.glow;
  if (!glow) return;
  if (glow.userData.on === on) return;
  glow.userData.on = on;
  glow.visible = true;
  tweenTo(glow.material, { opacity: on ? 0.85 : 0.0 }, 180, { onComplete: () => { if (!on) glow.visible = false; } });
  const face = g.userData.face;
  if (face && face.material && face.material.emissive) face.material.emissive.set(on ? 0x332a00 : 0x000000);
}
function setCardDim(g, dim, level = 0.5) {
  // 手札の「選べない札」は 0.5（0.7 では ACES のトーンマップで白が 228 対 237 にしか分かれず、Windows 実機で見分けにくかった）。場の古い組は 0.72
  const face = g.userData.face;
  if (face && face.material) face.material.color.setScalar(dim ? level : 1.0);
}
function disposeCard(g) {
  g.traverse((o) => { if (o.isMesh && o.material && o.material !== sideMat) o.material.dispose(); });
  if (g.parent) g.parent.remove(g);
}

// ---------------------------------------------------------------------------
// three.js の場面：卓・照明・カメラ
// ---------------------------------------------------------------------------
let scene, camera, renderer, handGroup, fieldGroup, backsGroup, fxGroup, keyLight, deckGroup;
let profile = 'pc';
let threeReady = false;
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function isMobile() { const v = viewportSize(); return v.w < 700 || v.w / v.h < 0.95; }
function col(hex) { return new THREE.Color(hex); }

function makeEnvironment() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#fff7dc');
  g.addColorStop(0.45, '#cfe8c8');
  g.addColorStop(0.55, '#4f7a3a');
  g.addColorStop(1, '#3a2514');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(32 + i * 64, 18, 18, 8, 0, 0, Math.PI * 2); ctx.fill(); }
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  return env;
}
function woodTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  const base = col(D.colors.rim_wood), light = col(D.colors.rim_wood_light);
  ctx.fillStyle = '#' + base.getHexString();
  ctx.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * 128;
    const a = 0.08 + Math.random() * 0.18;
    ctx.strokeStyle = 'rgba(' + Math.round(light.r * 255) + ',' + Math.round(light.g * 255) + ',' + Math.round(light.b * 255) + ',' + a + ')';
    ctx.lineWidth = 0.5 + Math.random() * 2.2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) ctx.lineTo(x, y + Math.sin((x + i * 37) * 0.02) * 3);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(12, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function leatherTexture() {
  // 革：細かなしぼ（ノイズの点）
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  const base = col(D.colors.leather);
  ctx.fillStyle = '#' + base.getHexString();
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 6000; i++) {
    const v = 0.5 + Math.random() * 0.5;
    ctx.fillStyle = 'rgba(' + Math.round(255 * v) + ',' + Math.round(200 * v) + ',' + Math.round(150 * v) + ',' + (0.05 + Math.random() * 0.08) + ')';
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(24, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function fieldScaleStatic() { return isMobile() ? D.field.scale_mobile : D.field.scale_pc; }
function buildTable() {
  const T = D.table;
  const loader = new THREE.TextureLoader();
  const diff = loader.load('assets/stretch_poplin_diff_1k.jpg');
  const rough = loader.load('assets/stretch_poplin_rough_1k.jpg');
  const nor = loader.load('assets/stretch_poplin_nor_gl_1k.jpg');
  for (const t of [diff, rough, nor]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(T.felt_repeat * 3, T.felt_repeat * 3); }
  diff.colorSpace = THREE.SRGBColorSpace;

  const feltGeo = new THREE.CylinderGeometry(T.radius, T.radius, T.top_y, 96);
  const feltMat = new THREE.MeshStandardMaterial({ map: diff, roughnessMap: rough, normalMap: nor, normalScale: new THREE.Vector2(0.5, 0.5), color: col(D.colors.felt), roughness: T.felt_roughness, metalness: 0.0, envMapIntensity: 0.15 });
  const felt = new THREE.Mesh(feltGeo, feltMat);
  felt.position.y = T.top_y / 2;
  felt.receiveShadow = true;
  scene.add(felt);

  const glowGeo2 = new THREE.CircleGeometry(T.radius * 0.95, 96);
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 256;
  const gctx = glowCanvas.getContext('2d');
  const rg = gctx.createRadialGradient(128, 128, 10, 128, 128, 128);
  const fc = col(D.colors.felt_center), fe = col(D.colors.felt_edge);
  rg.addColorStop(0, 'rgba(' + Math.round(fc.r * 255) + ',' + Math.round(fc.g * 255) + ',' + Math.round(fc.b * 255) + ',0.55)');
  rg.addColorStop(0.6, 'rgba(255,255,255,0)');
  rg.addColorStop(1, 'rgba(' + Math.round(fe.r * 255) + ',' + Math.round(fe.g * 255) + ',' + Math.round(fe.b * 255) + ',0.45)');
  gctx.fillStyle = rg; gctx.fillRect(0, 0, 256, 256);
  const glowTex = new THREE.CanvasTexture(glowCanvas);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  const glow = new THREE.Mesh(glowGeo2, new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = T.top_y + 0.004;
  scene.add(glow);

  const gold = new THREE.Mesh(new THREE.TorusGeometry(T.radius + 0.02, T.gold_trim.tube, 12, 160),
    new THREE.MeshStandardMaterial({ color: col(D.colors.gold), metalness: T.gold_trim.metalness, roughness: T.gold_trim.roughness, envMapIntensity: 1.2 }));
  gold.rotation.x = Math.PI / 2;
  gold.position.y = T.top_y;
  scene.add(gold);

  const leather = new THREE.Mesh(new THREE.TorusGeometry(T.radius + T.gold_trim.tube + T.leather_band.tube * 0.9, T.leather_band.tube, 16, 160),
    new THREE.MeshStandardMaterial({ map: leatherTexture(), color: col(D.colors.leather), roughness: T.leather_band.roughness, metalness: 0.05, envMapIntensity: 0.3 }));
  leather.rotation.x = Math.PI / 2;
  leather.position.y = T.top_y - 0.02;
  leather.castShadow = true; leather.receiveShadow = true;
  scene.add(leather);

  const rimR = T.radius + T.gold_trim.tube + T.leather_band.tube * 1.8 + T.rim.tube * 0.9;
  const wood = new THREE.Mesh(new THREE.TorusGeometry(rimR, T.rim.tube, 24, 180),
    new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: T.rim.roughness, metalness: T.rim.metalness, envMapIntensity: 0.5 }));
  wood.rotation.x = Math.PI / 2;
  wood.position.y = T.top_y - T.rim.tube * 0.35;
  wood.castShadow = true; wood.receiveShadow = true;
  scene.add(wood);
  const side = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR * 0.98, T.top_y + T.rim.tube * 1.2, 96, 1, true),
    new THREE.MeshStandardMaterial({ color: col(D.colors.rim_wood), roughness: 0.6, side: THREE.DoubleSide }));
  side.position.y = (T.top_y - T.rim.tube * 0.35) - (T.top_y + T.rim.tube * 1.2) / 2;
  scene.add(side);

  const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshStandardMaterial({ color: col(D.colors.felt_edge), roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -T.rim.tube * 1.6;
  floor.receiveShadow = true;
  scene.add(floor);

  // 山札（配るときだけ見せる。中央の奥・裏向きの束）
  deckGroup = new THREE.Group();
  deckGroup.position.set(0, T.top_y + 0.02, D.field.center[2] - 0.3);
  deckGroup.visible = false;
  scene.add(deckGroup);
  for (let i = 0; i < 10; i++) {
    const c = makeCard('X1', false);
    c.rotation.set(-Math.PI / 2, 0, (Math.random() - 0.5) * 0.08);
    c.position.y = i * 0.03;
    c.scale.setScalar(fieldScaleStatic());
    deckGroup.add(c);
  }
}
function buildLights() {
  const L = D.lights;
  scene.add(new THREE.AmbientLight(0xffffff, L.ambient));
  const hemi = new THREE.HemisphereLight(col(L.hemisphere.sky), col(L.hemisphere.ground), L.hemisphere.intensity);
  scene.add(hemi);
  keyLight = new THREE.DirectionalLight(0xffffff, L.key.intensity);
  keyLight.position.set(...L.key.position);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(isMobile() ? 1024 : 2048, isMobile() ? 1024 : 2048);
  const s = D.table.radius + 3;
  keyLight.shadow.camera.left = -s; keyLight.shadow.camera.right = s;
  keyLight.shadow.camera.top = s; keyLight.shadow.camera.bottom = -s;
  keyLight.shadow.camera.near = 1; keyLight.shadow.camera.far = 60;
  keyLight.shadow.bias = -0.0005;
  keyLight.shadow.radius = 4;
  scene.add(keyLight);
  const fill = new THREE.DirectionalLight(0xffffff, L.fill.intensity);
  fill.position.set(...L.fill.position);
  scene.add(fill);
  const spot = new THREE.SpotLight(0xffffff, L.spot_center.intensity, 0, L.spot_center.angle_deg * Math.PI / 180, L.spot_center.penumbra, 1.2);
  spot.position.set(...L.spot_center.position);
  spot.target.position.set(0, 0, 0);
  scene.add(spot, spot.target);
}
function applyCamera() {
  profile = isMobile() ? 'mobile' : 'pc';
  const C = D.camera[profile];
  camera.fov = C.fov;
  const vv0 = viewportSize();
  camera.aspect = vv0.w / vv0.h;
  camera.position.set(...C.position);
  camera.lookAt(new THREE.Vector3(...C.look_at));
  camera.updateProjectionMatrix();
}
let quality = (new URLSearchParams(location.search).get('quality') || 'auto');   // high / low / auto（端末の性能に合わせて影と解像度を落とす）
function setQuality(q) {
  quality = q;
  if (!renderer) return;
  renderer.shadowMap.enabled = (q !== 'low');
  renderer.setPixelRatio(q === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  scene.traverse((o) => { if (o.isMesh && o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => { m.needsUpdate = true; }); } });
  if (keyLight) keyLight.castShadow = (q !== 'low');
  window.__quality = q;
}
function init3D() {
  if (threeReady) return;
  const container = $('canvas-container');
  renderer = new THREE.WebGLRenderer({ antialias: quality !== 'low', alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(quality === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  const vvInit = fitGameScreen();
  renderer.setSize(vvInit.w, vvInit.h);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = quality !== 'low';
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = col(D.colors.felt_edge);
  scene.environment = makeEnvironment();

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
  scene.add(camera);
  applyCamera();

  buildLights();
  buildTable();

  handGroup = new THREE.Group();
  camera.add(handGroup);          // 手札はカメラに付ける（どの画面の比率でも下に収まる）
  fieldGroup = new THREE.Group();
  backsGroup = new THREE.Group();
  fxGroup = new THREE.Group();
  scene.add(fieldGroup, backsGroup, fxGroup);

  attachInteraction();
  window.addEventListener('resize', onResize);
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', onResize); window.visualViewport.addEventListener('scroll', onResize); }
  threeReady = true;
  animate();
}
// 【実機の要望 2026-10-22】スマホのブラウザは、アドレスバーやツールバーの分だけ「見えている高さ」が innerHeight と違うことがある
//   （出す／パスが画面の下に隠れた）。見えている範囲（visualViewport）に #game-screen を合わせ、描画もその大きさにする
function viewportSize() {
  const vv = window.visualViewport;
  if (vv && vv.height > 0) return { w: Math.round(vv.width), h: Math.round(vv.height), top: Math.round(vv.offsetTop || 0), left: Math.round(vv.offsetLeft || 0) };
  return { w: window.innerWidth, h: window.innerHeight, top: 0, left: 0 };
}
function fitGameScreen() {
  const v = viewportSize();
  const gs = $('game-screen');
  gs.style.top = v.top + 'px'; gs.style.left = v.left + 'px'; gs.style.width = v.w + 'px'; gs.style.height = v.h + 'px'; gs.style.bottom = 'auto'; gs.style.right = 'auto';
  document.documentElement.style.setProperty('--vvh', v.h + 'px');
  return v;
}
function onResize() {
  if (!threeReady) return;
  const v = fitGameScreen();
  renderer.setSize(v.w, v.h);
  applyCamera();
  layoutHand(false);
  layoutField(false);
  layoutSeatsHtml();
  updateHandTargets(true);
}
let frames = 0, fpsValue = 0, fpsT = performance.now();
let lowStreak = 0;
function animate() {
  requestAnimationFrame(animate);
  tweenGroup.update();
  renderer.render(scene, camera);
  updateHandTargets();
  frames++;
  const now = performance.now();
  if (now - fpsT >= 1000) {
    fpsValue = frames; frames = 0; fpsT = now; window.__fps = fpsValue;
    if (quality === 'auto') { lowStreak = fpsValue < 20 ? lowStreak + 1 : 0; if (lowStreak >= 3) setQuality('low'); }
  }
}

// ---------------------------------------------------------------------------
// 手札（カメラ座標）：open-poker の layoutHand の並び（等間隔・扇の傾き・弧）。当たり判定は動かない「座」の板で行う
// ---------------------------------------------------------------------------
let handCards = [];          // {id, obj, hit, slot}
let selectedIndices = [];
let selectable = new Set();  // いま追加で選べる札（合法手から）
let playable = false;        // いまの選択がそのまま出せる
let handParamsCache = null;
function handParams(n) {
  const H = D.hand[profile];
  const visW = 2 * H.distance * Math.tan(camera.fov * Math.PI / 360) * camera.aspect;
  const fanW = visW * H.width_ratio;
  const rows = (profile === 'mobile' && n >= 9) ? 2 : 1;
  const perRow = Math.ceil(n / rows);
  const frac = profile === 'mobile' ? 0.27 : 0.115;
  let s = (visW * frac) / D.card.width;
  const minVisible = 0.42;
  if (perRow > 1 && (perRow - 1) * D.card.width * s * minVisible + D.card.width * s > fanW) {
    s = fanW / ((perRow - 1) * minVisible * D.card.width + D.card.width);
  }
  const w2 = D.card.width * s;
  const spacing = perRow > 1 ? Math.min(w2 * 0.72, (fanW - w2) / (perRow - 1)) : 0;
  const rowGap = D.card.height * s * 0.5;
  return { H, s, spacing, rows, perRow, rowGap, visW };
}
function handSlot(i, n, p) {
  const row = p.rows === 2 ? (i < p.perRow ? 0 : 1) : 0;
  const col = p.rows === 2 ? (row === 0 ? i : i - p.perRow) : i;
  const cols = p.rows === 2 ? (row === 0 ? p.perRow : n - p.perRow) : n;
  const off = col - (cols - 1) / 2;
  const spread = p.H.spread_deg * Math.PI / 180;
  const rotZ = cols > 1 ? -(off / ((cols - 1) / 2)) * (spread / 2) : 0;
  const x = off * p.spacing;
  const y = -(Math.abs(off) / Math.max(1, (cols - 1) / 2)) * p.H.lift_arc * p.s + (p.rows === 2 ? (row === 0 ? p.rowGap : -p.rowGap * 0.6) : 0);
  const z = col * 0.012 + row * 0.25;   // 右の札ほど手前（表示順＝奥行き＝当たり判定の順）
  return { x, y, z, rotZ };
}
function layoutHand(animateMove = true, dealFrom = false, dealOrder = null) {
  if (!threeReady) return;
  const n = handCards.length;
  const p = handParams(n);
  handParamsCache = p;
  const H = p.H;
  handGroup.position.set((H.x_offset || 0) * p.visW, H.y_offset, -H.distance);
  handGroup.rotation.set(H.tilt_deg * Math.PI / 180, 0, 0);
  handGroup.updateMatrixWorld(true);
  const deckLocal = deckGroup ? handGroup.worldToLocal(deckGroup.getWorldPosition(new THREE.Vector3())) : new THREE.Vector3(0, 2.2, -2.5);
  handCards.forEach((c, i) => {
    const slot = handSlot(i, n, p);
    c.slot = slot;
    const sel = selectedIndices.includes(i);
    const target = { x: slot.x, y: slot.y + (sel ? H.select_lift * p.s : 0), z: slot.z + (sel ? 0.35 : 0) };
    // 当たり判定の座（持ち上がっても動かない）
    c.hit.position.set(slot.x, slot.y, slot.z);
    c.hit.rotation.set(0, 0, slot.rotZ);
    c.hit.scale.setScalar(p.s);
    if (dealFrom) {
      const order = dealOrder ? dealOrder[i] : i;
      c.obj.position.copy(deckLocal);
      c.obj.rotation.set(0, Math.PI, 0);
      c.obj.scale.setScalar(p.s * 0.6);
      const delay = order * D.animation.deal_stagger_ms;
      c.dealEnd = performance.now() + delay + D.animation.deal_ms + 30;   // この札の配りが終わる時刻（それまでは並べ直しで配りの動きを止めない）
      tweenTo(c.obj.position, target, D.animation.deal_ms, { delay });
      tweenTo(c.obj.rotation, { x: 0, y: 0, z: slot.rotZ }, D.animation.deal_ms, { delay });
      tweenTo(c.obj.scale, { x: p.s, y: p.s, z: p.s }, D.animation.deal_ms, { delay, onComplete: () => Sound.play('deal', { vol: 0.5, gap: 30 }) });
    } else if (animateMove) {
      if (performance.now() < (c.dealEnd || 0)) { setCardGlow(c.obj, sel); return; }   // 配りの途中の札は、配りが終わってから（次の並べ直しで）動かす
      c.obj.scale.setScalar(p.s);
      tweenTo(c.obj.position, target, D.animation.select_ms);
      tweenTo(c.obj.rotation, { x: 0, y: 0, z: slot.rotZ }, D.animation.select_ms);
    } else {
      c.obj.scale.setScalar(p.s);
      c.obj.position.set(target.x, target.y, target.z);
      c.obj.rotation.set(0, 0, slot.rotZ);
    }
    setCardGlow(c.obj, sel);
  });
  updateHandTargets(true);
}
function rebuildHand(cards, deal = false, dealOrder = null) {
  if (!threeReady) return;
  const same = handCards.length === cards.length && handCards.every((c, i) => c.id === cards[i]);
  if (same && !deal) { layoutHand(true); return; }
  for (const c of handCards) { disposeCard(c.obj); if (c.hit.parent) c.hit.parent.remove(c.hit); }
  cardGeometries();
  handCards = cards.map((id) => {
    const obj = makeCard(id, true);
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    handGroup.add(obj);
    const hit = new THREE.Mesh(cardGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
    hit.renderOrder = -1;
    hit.visible = true;
    handGroup.add(hit);
    hit.userData.index = -1;
    return { id, obj, hit, slot: null };
  });
  handCards.forEach((c, i) => { c.hit.userData.index = i; });
  layoutHand(false, deal, dealOrder);
}

// 選べる札（追加要件 4）：いまの選択に候補を足して、合法手の中に収まる物だけ。選択が合法手と一致したら出せる
function computeSelectable(state) {
  selectable = new Set();
  playable = false;
  if (!state) return;
  const mine = state.seats[state.me] || {};
  const hand = mine.cards || [];
  const sel = selectedIndices.slice();
  const selIds = sel.map((i) => hand[i]).filter(Boolean);
  const m = uiMode;
  if (m === 'give' || m === 'discard' || m === 'exchange_back') {
    const cnt = (state.awaiting && state.awaiting.count) || 0;
    hand.forEach((id, i) => { if (sel.includes(i) || sel.length < cnt) selectable.add(i); });
    playable = (m === 'exchange_back') ? sel.length === cnt : sel.length <= cnt;
    return;
  }
  if (m !== 'play') return;
  const legal = state.legal || [];
  hand.forEach((id, i) => {
    if (sel.includes(i)) { selectable.add(i); return; }
    const ok = legal.some((mv) => { const c = mv.cards || []; return c.includes(id) && selIds.every((s) => c.includes(s)); });
    if (ok) selectable.add(i);
  });
  const sorted = selIds.slice().sort();
  playable = sorted.length > 0 && legal.some((mv) => { const c = (mv.cards || []).slice().sort(); return c.length === sorted.length && c.every((x, k) => x === sorted[k]); });
}
function applySelectableLook() {
  const dimming = (uiMode === 'play' && myTurnNow()) || uiMode === 'give' || uiMode === 'discard' || uiMode === 'exchange_back';
  handCards.forEach((c, i) => setCardDim(c.obj, dimming && !selectable.has(i) && !selectedIndices.includes(i)));
}
function myTurnNow() { const st = gameClient.getState(); return !!(st && st.phase === 'play' && st.turn === st.me && !st.awaiting); }

// 手札の上に透明なボタンを重ねる（読み上げ・自動操作・キーボード用。指やマウスは canvas が受ける）
let lastTargetsAt = 0;
function updateHandTargets(force = false) {
  const box = $('hand-targets');
  if (!box || !threeReady) return;
  const now = performance.now();
  if (!force && now - lastTargetsAt < 200) return;
  lastTargetsAt = now;
  if (box.children.length !== handCards.length) {
    box.innerHTML = '';
    handCards.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'hand-target'; b.dataset.index = String(i);
      // ポインタ（指・マウス・自動操作のクリック）は attachInteraction が pointerdown/up で扱う。
      // ここはキーボード（Enter／Space）だけ：ポインタ操作の直後の click は二重にしない
      b.addEventListener('click', () => { if (performance.now() < suppressClickUntil) return; toggleByIndex(i); });
      box.appendChild(b);
    });
  }
  handCards.forEach((c, i) => {
    const b = box.children[i];
    if (!b) return;
    const tl = c.hit.localToWorld(new THREE.Vector3(-D.card.width / 2, D.card.height / 2, 0)).project(camera);
    const br = c.hit.localToWorld(new THREE.Vector3(-D.card.width / 2 + D.card.width * 0.42, D.card.height / 2 - D.card.height * 0.5, 0)).project(camera);
    const vw = renderer.domElement.clientWidth || window.innerWidth, vh = renderer.domElement.clientHeight || window.innerHeight;
    const x1 = (tl.x + 1) / 2 * vw, y1 = (1 - tl.y) / 2 * vh;
    const x2 = (br.x + 1) / 2 * vw, y2 = (1 - br.y) / 2 * vh;
    b.style.left = Math.min(x1, x2) + 'px'; b.style.top = Math.min(y1, y2) + 'px';
    b.style.width = Math.max(24, Math.abs(x2 - x1)) + 'px'; b.style.height = Math.max(24, Math.abs(y2 - y1)) + 'px';
    const sel = selectedIndices.includes(i);
    b.dataset.card = c.id;
    b.setAttribute('aria-label', '手札 ' + getCardLabel(c.id) + (sel ? '（選択中）' : (selectable.has(i) ? '' : '（いまは選べない）')));
    b.setAttribute('aria-pressed', sel ? 'true' : 'false');
    // disabled 属性は使わない（Chrome は無効なボタン上のポインタ操作を捨てるので、なぞり・背景タップが途切れる）
    const dis = !(selectable.has(i) || sel);
    b.setAttribute('aria-disabled', dis ? 'true' : 'false');
    b.classList.toggle('unselectable', dis);
  });
}

// ---- 選ぶ・解除する（タップ／なぞり／背景／ボタン）----
function selectIndex(idx, viaDrag = false) {
  if (selectedIndices.includes(idx)) return false;
  if (!selectable.has(idx)) { if (!viaDrag) { showHint('その札はいま出せません'); Sound.play('error', { vol: 0.35 }); } return false; }
  gameClient.selectCard(idx);
  selectedIndices = gameClient.getSelection();
  Sound.play(viaDrag ? 'drag' : 'select', viaDrag ? { rate: 1 + Math.min(selectedIndices.length, 8) * 0.04, vol: 0.8, gap: 50 } : {});
  afterSelectionChange();
  return true;
}
function deselectIndex(idx) {
  if (!selectedIndices.includes(idx)) return false;
  gameClient.deselectCard(idx);
  selectedIndices = gameClient.getSelection();
  Sound.play('deselect');
  afterSelectionChange();
  return true;
}
function toggleByIndex(idx) {
  const st = gameClient.getState();
  if (!st) return;
  if (uiMode === 'play' && !myTurnNow()) { showHint('相手の番です'); Sound.play('error', { vol: 0.4 }); return; }
  if (uiMode === 'watch' || uiMode === 'wait' || uiMode === 'bomb') return;
  if (selectedIndices.includes(idx)) deselectIndex(idx); else selectIndex(idx, false);
}
function deselectAll(silent = false) {
  if (!selectedIndices.length) return;
  gameClient.clearSelection();
  selectedIndices = [];
  if (!silent) Sound.play('deselect_all');
  afterSelectionChange();
}
function afterSelectionChange() {
  computeSelectable(gameClient.getState());
  layoutHand(true);
  applySelectableLook();
  updateHud(gameClient.getState(), { noResult: true });
  updateHandTargets(true);
}

// 指・マウス：タップ＝選ぶ／解除、なぞり＝通った札を順に追加、背景の短いタップ＝全解除（追加要件 2・3）
let suppressClickUntil = 0;
function attachInteraction() {
  const dom = renderer.domElement;
  const targets = $('hand-targets');   // 札の上の透明ボタン（ここで押されても同じ扱い。座標で札を判定する）
  let press = null;   // {idx|null, x, y, t, moved, visited:Set, pointerId}
  const pick = (ev) => {
    const rect = dom.getBoundingClientRect();
    ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(handCards.map((c) => c.hit), false);
    if (!hits.length) return null;
    // 重なりは「右（後ろの番号）の札が手前」。同じ距離の時は番号の大きい方
    let best = hits[0];
    for (const h of hits) { if (h.distance < best.distance - 1e-4 || (Math.abs(h.distance - best.distance) <= 1e-4 && h.object.userData.index > best.object.userData.index)) best = h; }
    return best.object.userData.index;
  };
  const down = (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    if (!threeReady || !$('game-screen').classList.contains('active')) return;
    let idx = pick(ev);
    if (idx === null && ev.target && ev.target.classList && ev.target.classList.contains('hand-target')) idx = parseInt(ev.target.dataset.index, 10);
    press = { idx, x: ev.clientX, y: ev.clientY, t: performance.now(), moved: false, visited: new Set(), pointerId: ev.pointerId };
    window.__lastPick = { idx, x: ev.clientX, y: ev.clientY, target: (ev.target && ev.target.className) || ev.target.tagName, mode: uiMode, t: Math.round(performance.now()) };   // 確かめ用
  };
  const move = (ev) => {
    if (!press || ev.pointerId !== press.pointerId) return;
    if (!press.moved && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > 8) {
      press.moved = true;
      // なぞり開始：最初に押した札も選ぶ（選べる札なら）
      if (press.idx !== null && press.idx >= 0 && canDragSelect()) { press.visited.add(press.idx); selectIndex(press.idx, true); }
    }
    if (!press.moved || !canDragSelect()) return;
    const idx = pick(ev);
    if (idx === null || idx < 0 || press.visited.has(idx)) return;
    press.visited.add(idx);     // 同じ札を何度通っても 1 回だけ
    selectIndex(idx, true);
  };
  const end = (ev) => {
    if (!press || ev.pointerId !== press.pointerId) return;
    const p = press; press = null;
    suppressClickUntil = performance.now() + 400;   // 直後の click（ボタン）で二重に切り替えない
    if (p.moved) return;       // なぞりの終わり：背景タップと誤認しない
    if (p.idx !== null && p.idx >= 0) { toggleByIndex(p.idx); return; }
    if (performance.now() - p.t < 500) deselectAll();   // 札以外の短いタップ：全解除
  };
  dom.addEventListener('pointerdown', down);
  targets.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', () => { press = null; });
}
function canDragSelect() { return (uiMode === 'play' && myTurnNow()) || uiMode === 'give' || uiMode === 'discard' || uiMode === 'exchange_back'; }

// ---------------------------------------------------------------------------
// 相手の席：HTML の枠（design の positions_pct）と、卓の向こう側の裏向きの札
// ---------------------------------------------------------------------------
let seatOrder = [];
function computeSeatOrder(state) {
  const me = state.me ?? 0;
  const n = state.seats.length;
  seatOrder = [];
  for (let k = 1; k < n; k++) seatOrder.push((me + k) % n);
}
// 相手 5 人（6 人対戦）のスマホは、枠を細くした上で 8/29/50/71/92% に置く（gemma4 の 5/25/50/75/95% だと 390px で枠が重なった）
const SEAT_PCT_5_MOBILE = [[8, 62], [29, 16], [50, 0], [71, 16], [92, 62]];
function seatPct(j, k) {
  if (k === 5 && isMobile()) return SEAT_PCT_5_MOBILE[j] || [50, 0];
  const table = D.opponents.positions_pct[String(k)] || D.opponents.positions_pct['3'];
  return table[j] || [50, 0];
}
function seatWorldPos(j, k) {
  const R = D.opponents.backs_radius;
  const th = Math.PI * (j + 1) / (k + 1);
  return new THREE.Vector3(-Math.cos(th) * R * 0.95, D.table.top_y, -Math.sin(th) * R * 0.72);
}
function layoutSeatsHtml() {
  const k = seatOrder.length;
  const box = $('seats');
  const W = box.clientWidth || window.innerWidth;
  seatOrder.forEach((seatIdx, j) => {
    const el = box.querySelector('[data-seat="' + seatIdx + '"]');
    if (!el) return;
    const [xp, yp] = seatPct(j, k);
    const half = (el.offsetWidth || 72) / 2 + 4;
    const x = Math.min(Math.max(W * xp / 100, half), W - half);
    el.style.left = x + 'px';
    el.style.top = yp + 'px';
  });
}
function buildSeatsHtml(state) {
  const box = $('seats');
  box.innerHTML = '';
  box.className = 'seats-' + seatOrder.length;
  seatOrder.forEach((seatIdx) => {
    const s = state.seats[seatIdx];
    const el = document.createElement('div');
    el.className = 'seat-frame ' + (s.kind === 'cpu' ? 'cpu' : 'human');
    el.dataset.seat = String(seatIdx);
    el.innerHTML = '<div class="seat-avatar"></div><div class="seat-name"></div><div class="seat-count"></div><div class="seat-turn">手番</div><div class="seat-rank"></div>';
    box.appendChild(el);
  });
  layoutSeatsHtml();
}
let backsBySeat = new Map();
function updateBacks(state, dealOrderBySeat = null) {
  if (!threeReady) return;
  const k = seatOrder.length;
  seatOrder.forEach((seatIdx, j) => {
    const s = state.seats[seatIdx];
    const count = Math.min(s.count || 0, 14);
    let rec = backsBySeat.get(seatIdx);
    if (rec && rec.count === count) return;
    if (rec) { rec.group.children.slice().forEach((c) => disposeCard(c)); backsGroup.remove(rec.group); }
    const group = new THREE.Group();
    const pos = seatWorldPos(j, k);
    group.position.copy(pos);
    group.position.y = D.table.top_y + 0.02;
    group.lookAt(new THREE.Vector3(0, D.table.top_y + 0.02, 0));
    group.updateMatrixWorld(true);
    const sc = D.opponents.backs_scale;
    backsGroup.add(group);
    for (let i = 0; i < count; i++) {
      const c = makeCard('X1', false);
      c.scale.setScalar(sc);
      const target = { x: (i - (count - 1) / 2) * 0.16 * sc * 1.6, y: 0.03 * i, z: 0 };
      c.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
      group.add(c);
      if (dealOrderBySeat && dealOrderBySeat[seatIdx] && deckGroup) {
        const order = dealOrderBySeat[seatIdx][i] ?? i;
        const local = group.worldToLocal(deckGroup.getWorldPosition(new THREE.Vector3()));
        c.position.copy(local);
        c.rotation.set(-Math.PI / 2, 0, 0);
        const delay = order * D.animation.deal_stagger_ms;
        tweenTo(c.position, target, D.animation.deal_ms, { delay });
        tweenTo(c.rotation, { x: -Math.PI / 2 + 0.35, y: 0, z: (i - (count - 1) / 2) * 0.03 }, D.animation.deal_ms, { delay });
      } else {
        c.position.set(target.x, target.y, target.z);
        c.rotation.set(-Math.PI / 2 + 0.35, 0, (i - (count - 1) / 2) * 0.03);
      }
    }
    backsBySeat.set(seatIdx, { count, group });
  });
}

// ---------------------------------------------------------------------------
// 場の札（卓の中央）：出来事の順に動かし、最後に state と合わせる。直近の組を最前面、古い組は奥で暗く
// ---------------------------------------------------------------------------
let fieldMoves = [];   // [{cards:[id], objs:[Group]}]
function fieldScale() { return profile === 'mobile' ? D.field.scale_mobile : D.field.scale_pc; }
function fieldSlot(moveIdx, cardIdx, nCards, nMoves) {
  const sc = fieldScale();
  const age = nMoves - 1 - moveIdx;
  const spacing = D.card.width * sc * D.field.spread;
  const x = D.field.center[0] + (cardIdx - (nCards - 1) / 2) * spacing - age * 0.55;
  const z = D.field.center[2] - age * 0.45;
  const y = D.table.top_y + D.field.lift_y + 0.02 * cardIdx + 0.004 * (nMoves - age);
  return { x, y, z, s: sc * Math.pow(0.9, age), visible: age < 3, age };
}
function layoutField(animateMove = true, withLanding = false) {
  const nMoves = fieldMoves.length;
  fieldMoves.forEach((m, mi) => {
    m.objs.forEach((o, ci) => {
      const slot = fieldSlot(mi, ci, m.objs.length, nMoves);
      const jit = (o.userData.jitter ?? (o.userData.jitter = (Math.random() * 2 - 1) * D.field.jitter_deg * Math.PI / 180));
      const target = { x: slot.x, y: slot.y, z: slot.z };
      o.visible = slot.visible;
      setCardDim(o, slot.age > 0, 0.72);
      if (animateMove) {
        const ms = D.animation.play_ms * 0.6;
        tweenTo(o.position, target, ms, { onComplete: (withLanding && slot.age === 0 && ci === 0) ? () => {
          // 着地：わずかに沈んで戻る
          o.position.y = slot.y + 0.06;
          tweenTo(o.position, { y: slot.y }, 140, { easing: Easing.Bounce.Out });
        } : undefined });
        tweenTo(o.scale, { x: slot.s, y: slot.s, z: slot.s }, ms);
        tweenTo(o.rotation, { x: -Math.PI / 2, y: 0, z: jit }, ms);
      } else {
        o.position.set(target.x, target.y, target.z);
        o.scale.setScalar(slot.s);
        o.rotation.set(-Math.PI / 2, 0, jit);
      }
    });
  });
}
function clearField(animated) {
  if (!threeReady) return;
  const moves = fieldMoves; fieldMoves = [];
  moves.forEach((m) => m.objs.forEach((o) => {
    if (!animated) { disposeCard(o); return; }
    // まとまって中央に集まってから、奥へ片付く
    tweenTo(o.position, { x: D.field.center[0], y: o.position.y + 0.2, z: D.field.center[2] }, D.animation.flow_ms * 0.4, {
      onComplete: () => tweenTo(o.position, { x: 0, y: o.position.y + 1.2, z: -9 }, D.animation.flow_ms * 0.7, { easing: Easing.Quadratic.In, onComplete: () => disposeCard(o) })
    });
    tweenTo(o.rotation, { z: 0 }, D.animation.flow_ms * 0.4);
  }));
}
function addFieldMove(cards, fromWorld, animated) {
  if (!threeReady) return;
  const objs = cards.map((id, i) => {
    const o = makeCard(id, true);
    o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = false; } });
    fieldGroup.add(o);
    if (fromWorld) {
      o.position.copy(fromWorld);
      o.position.x += (i - (cards.length - 1) / 2) * 0.15;
      o.rotation.set(-Math.PI / 2 + 0.6, 0, 0);
      o.scale.setScalar(fieldScale() * 0.6);
    }
    return o;
  });
  fieldMoves.push({ cards: cards.slice(), objs });
  layoutField(animated, animated);
}
function setFieldFromState(state) {
  const flat = fieldMoves.flatMap((m) => m.cards);
  const want = (state.field && state.field.cards) || [];
  if (flat.length === want.length && flat.every((c, i) => c === want[i])) return;
  clearField(false);
  if (want.length) addFieldMove(want, null, false);
}

// ---------------------------------------------------------------------------
// 出来事（実況の差分）を順に演出する（サーバーで確定した順番と ID に従う）
// ---------------------------------------------------------------------------
let prevLog = [];
let prevRound = null;
let queue = Promise.resolve();
let queueBusy = 0;
function nameToSeat(state, name) {
  const s = state.seats.find((x) => x.name === name);
  return s ? s.index : null;
}
function labelsToIds(labels, pool) {
  const used = new Set();
  return labels.map((l) => {
    if (l === 'JOKER') {
      const j = pool.find((c) => c.startsWith('X') && !used.has(c)) || 'X1';
      used.add(j); return j;
    }
    const id = (CHAR_SUIT[l[0]] || l[0]) + l.slice(1);
    used.add(id); return id;
  });
}
function diffLog(newLog) {
  if (newLog.length && newLog.length <= prevLog.length) {
    for (let st = 0; st + newLog.length <= prevLog.length; st++) {
      let same = true;
      for (let i = 0; i < newLog.length; i++) if (prevLog[st + i] !== newLog[i]) { same = false; break; }
      if (same) return [];
    }
  }
  let m = 0;
  const maxM = Math.min(prevLog.length, newLog.length);
  for (let k = maxM; k >= 1; k--) {
    let ok = true;
    for (let i = 0; i < k; i++) if (prevLog[prevLog.length - k + i] !== newLog[i]) { ok = false; break; }
    if (ok) { m = k; break; }
  }
  const fresh = newLog.slice(m);
  prevLog = newLog.slice();
  return fresh;
}
function worldOfSeat(state, seatIdx) {
  const j = seatOrder.indexOf(seatIdx);
  if (j < 0) {
    const v = new THREE.Vector3(0, D.hand[profile].y_offset, -D.hand[profile].distance);
    return camera.localToWorld(v);
  }
  return seatWorldPos(j, seatOrder.length);
}
function seatScreenPos(seatIdx) {
  const el = $('seats').querySelector('[data-seat="' + seatIdx + '"]');
  if (!el) { const sb = $('status-bar').getBoundingClientRect(); return { x: sb.left + sb.width / 2, y: sb.top }; }
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + 6 };
}
function bubble(seatIdx, text, cls = '') {
  const p = seatScreenPos(seatIdx);
  const b = document.createElement('div');
  b.className = 'bubble ' + cls;
  b.textContent = text;
  b.style.left = p.x + 'px'; b.style.top = p.y + 'px';
  $('bubbles').appendChild(b);
  setTimeout(() => b.remove(), 1700);
}
function enqueueEvents(state, fresh) {
  const me = state.me;
  queueBusy++;
  fresh.forEach((line) => {
    let m;
    if ((m = line.match(/^(.+?) が (.+) を出した$/))) {
      const seatIdx = nameToSeat(state, m[1]);
      const ids = labelsToIds(m[2].split(' '), (state.field && state.field.cards) || []);
      queue = queue.then(async () => {
        const from = worldOfSeat(state, seatIdx);
        addFieldMove(ids, from, true);
        Sound.play(seatIdx === me ? (ids.length > 1 ? 'place_group' : 'place') : (ids.length > 1 ? 'place_group' : 'cpu_place'));
        setLog(line);
        await sleep(seatIdx === me ? D.animation.play_ms * 0.5 : D.animation.cpu_play_ms);
      });
    } else if ((m = line.match(/^(.+?) がパス$/))) {
      const seatIdx = nameToSeat(state, m[1]);
      queue = queue.then(async () => { bubble(seatIdx, 'パス'); Sound.play('pass'); setLog(line); await sleep(D.animation.cpu_play_ms * 0.6); });
    } else if (line.includes('場が流れた')) {
      const special = line.startsWith('8切り') || line.startsWith('スペ3返し');
      queue = queue.then(async () => {
        clearField(true);
        Sound.play(special ? 'eightcut' : 'flow');
        if (special) bubble(me, line.split('！')[0], 'special');
        setLog(line); await sleep(D.animation.flow_ms * 0.8);
      });
    } else if (line === '革命！' || line === '革命返し！') {
      queue = queue.then(async () => { Sound.play('revolution'); bubble(me, line, 'special'); setLog(line); $('log').classList.toggle('revolution', line === '革命！'); await sleep(600); });
    } else if (line.startsWith('11バック') || line.startsWith('しばり') || line.startsWith('リバース') || line.startsWith('スキップ') || line.startsWith('12ボンバー') || line.startsWith('7渡し') || line.startsWith('10捨て') || line.startsWith('カード交換')) {
      queue = queue.then(async () => { Sound.play(line.startsWith('12ボンバー') ? 'bomb' : 'special'); bubble(me, line.split('：')[0].split('！')[0], 'special'); setLog(line); await sleep(500); });
    } else if ((m = line.match(/^(.+?) が上がった（(\d+) 位）$/))) {
      const seatIdx = nameToSeat(state, m[1]);
      queue = queue.then(async () => { bubble(seatIdx, m[2] + '位 上がり'); Sound.play('win'); setLog(line); await sleep(400); });
    } else if ((m = line.match(/^(.+?) が最下位/))) {
      const seatIdx = nameToSeat(state, m[1]);
      queue = queue.then(async () => { bubble(seatIdx, '最下位'); setLog(line); await sleep(400); });
    } else if ((m = line.match(/^(.+?) は(禁止あがり|都落ち)/))) {
      const seatIdx = nameToSeat(state, m[1]);
      queue = queue.then(async () => { bubble(seatIdx, m[2] + '！', 'special'); Sound.play('special'); setLog(line); await sleep(500); });
    } else {
      queue = queue.then(() => setLog(line));
    }
  });
  queue = queue.then(() => { queueBusy = Math.max(0, queueBusy - 1); const st = gameClient.getState(); if (st && queueBusy === 0) { setFieldFromState(st); updateBacks(st); updateHud(st); } });
}
function setLog(line) { $('log').textContent = line || ''; }

// ---------------------------------------------------------------------------
// HUD（席・枚数・手番・ボタン・案内・待ちのモード・結果）
// ---------------------------------------------------------------------------
let uiMode = 'wait';   // play / give / discard / exchange_back / bomb / watch / wait
let fanfareRound = null, turnNotified = '', bombPicks = [];
function showHint(text) { $('hint').textContent = text || ''; }
function modeOf(state) {
  if (!state || (state.phase !== 'play' && state.phase !== 'exchange')) return 'wait';
  const a = state.awaiting;
  if (a) return (a.seat === state.me) ? a.type : 'watch';
  if (state.phase === 'exchange') return 'watch';
  return (state.turn === state.me) ? 'play' : 'watch';
}
function updateHud(state, opts = {}) {
  if (!state) return;
  const me = state.me;
  const newMode = modeOf(state);
  if (newMode !== uiMode) { uiMode = newMode; if (uiMode !== 'play') { deselectAll(true); } bombPicks = []; }
  const myTurn = uiMode === 'play';
  if (myTurn && !opts.noResult) {
    const key = (state.round || 0) + ':' + ((state.log || []).length);
    if (turnNotified !== key) {
      turnNotified = key;
      // 手番の合図は、配り・相手の出札の演出が終わってから（演出の列の最後に付ける）
      if (queueBusy > 0) queue = queue.then(() => { const st = gameClient.getState(); if (st && modeOf(st) === 'play') Sound.play('turn'); });
      else Sound.play('turn');
    }
  }
  if (state.phase === 'round_end' || state.phase === 'game_end') {
    if (!opts.noResult && fanfareRound !== state.round) { fanfareRound = state.round; Sound.play('fanfare'); }
  }
  // 席
  seatOrder.forEach((seatIdx) => {
    const s = state.seats[seatIdx];
    const el = $('seats').querySelector('[data-seat="' + seatIdx + '"]');
    if (!el || !s) return;
    el.querySelector('.seat-name').textContent = s.name;
    el.querySelector('.seat-count').textContent = (s.count ?? 0) + '枚';
    const isTurn = (state.turn === seatIdx && (state.phase === 'play' || state.phase === 'exchange') && !state.awaiting) || !!(state.awaiting && state.awaiting.seat === seatIdx);
    el.classList.toggle('turn', !!isTurn);
    const rank = (state.ranks && state.ranks[seatIdx]) || 0;
    const done = (s.count === 0 && state.phase === 'play') || rank > 0 || !!s.out;
    el.classList.toggle('done', done);
    el.querySelector('.seat-rank').textContent = rank > 0 ? rank + '位' : (s.out ? s.out : (done ? '上がり' : ''));
    el.classList.toggle('offline', s.kind === 'human' && s.connected === false);
    el.classList.toggle('passed', (state.passed || []).includes(seatIdx) && !(state.field && state.field.empty));
  });
  // 自分
  const mine = state.seats[me] || {};
  $('player-name').textContent = mine.name || '';
  $('hand-count').textContent = (mine.count ?? (mine.cards || []).length) + '枚';
  const a = state.awaiting;
  const AWAIT_NAME = { give: '7渡し', discard: '10捨て', bomb: '12ボンバー', exchange_back: 'カード交換' };
  let statusText = state.phase === 'round_end' ? 'ラウンド終了' : (state.phase === 'game_end' ? 'ゲーム終了'
    : ((a && a.seat === me) ? (AWAIT_NAME[a.type] || a.type) + '：札を選ぶ' : (state.phase === 'exchange' ? 'カード交換' : (myTurn ? '自分の手番' : '相手の番'))));
  if (state.turn_seconds > 0 && state.remaining !== null && state.remaining !== undefined && (myTurn || (a && a.seat === me))) statusText += '　残り ' + state.remaining + ' 秒';
  $('client-status').textContent = statusText;
  $('status-bar').classList.toggle('my-turn', myTurn || !!(a && a.seat === me));
  $('status-bar').classList.toggle('revolution', !!(state.field && state.field.inverted));
  $('round-line').textContent = (state.round ? 'R ' + state.round + '/' + (state.rounds || 1) : '')
    + (state.field && state.field.suit_lock ? '　しばり ' + state.field.suit_lock.map((s) => SUIT_CHAR[s] || s).join('') : '')
    + (state.field && state.field.rank_lock ? '　数字しばり' : '')
    + (state.field && state.field.reverse ? '　逆回り' : '')
    + (state.field && state.field.eleven_back ? '　11バック' : '');
  // 選べる札と出すボタン
  computeSelectable(state);
  applySelectableLook();
  const sel = gameClient.getSelection();
  const selIds = sel.map((i) => (mine.cards || [])[i]).filter(Boolean).slice().sort();
  const playBtn = $('play-btn'), passBtn = $('pass-btn');
  $('rank-picker').classList.remove('open');
  if (uiMode === 'play') {
    playBtn.textContent = '出す'; passBtn.textContent = 'パス'; passBtn.classList.remove('hidden');
    playBtn.disabled = !playable || gameClient.isBusy();
    passBtn.disabled = !state.can_pass || gameClient.isBusy();
    const legal = state.legal || [];
    if (sel.length === 0) showHint(legal.length ? '出す札を選んでください（なぞると続けて選べます）' : (state.can_pass ? '出せる札がありません。パスしてください' : ''));
    else showHint(playable ? '「出す」で確定' : '組を完成させてください（出せない札は暗くなります）');
  } else if (uiMode === 'give' || uiMode === 'discard' || uiMode === 'exchange_back') {
    const cnt = a.count;
    const verb = uiMode === 'give' ? '渡す' : (uiMode === 'discard' ? '捨てる' : '返す');
    playBtn.textContent = verb + '（' + sel.length + '/' + cnt + '）';
    playBtn.disabled = !playable || gameClient.isBusy();
    if (uiMode === 'exchange_back') { passBtn.classList.add('hidden'); } else { passBtn.classList.remove('hidden'); passBtn.textContent = uiMode === 'give' ? '渡さない' : '捨てない'; passBtn.disabled = gameClient.isBusy(); }
    const who = uiMode === 'give' ? ('次の人（' + ((state.seats[a.to] || {}).name || '') + '）に裏向きで渡す札') : (uiMode === 'discard' ? '捨てる札' : ((state.seats[a.to] || {}).name || '') + ' に返す札');
    showHint(who + 'を ' + (uiMode === 'exchange_back' ? cnt + ' 枚' : '0〜' + cnt + ' 枚') + ' 選んでください');
  } else if (uiMode === 'bomb') {
    playBtn.textContent = '消す（' + bombPicks.length + '/' + a.count + '）'; playBtn.disabled = gameClient.isBusy();
    passBtn.classList.remove('hidden'); passBtn.textContent = '消さない'; passBtn.disabled = gameClient.isBusy();
    showHint('12ボンバー：全員の手札から消す数字を ' + a.count + ' つまで選んでください');
    renderRankPicker(state);
  } else {
    playBtn.textContent = '出す'; passBtn.textContent = 'パス'; passBtn.classList.remove('hidden');
    playBtn.disabled = true; passBtn.disabled = true;
    if (state.phase === 'round_end' || state.phase === 'game_end') showHint('');
    else if (a) { const who = (state.seats[a.seat] || {}).name || ''; showHint(who + ' が ' + ({ give: '7渡し', discard: '10捨て', bomb: '12ボンバー', exchange_back: 'カード交換' }[a.type] || a.type) + ' の札を選んでいます'); }
    else if (state.phase === 'exchange') showHint('カード交換中');
    else { const t = state.seats[state.turn]; showHint(t ? (t.name + ' の番') : ''); }
  }
  // 2D 版の確かめ用の隠し欄
  $('shown-hand').textContent = (mine.cards || []).join(',');
  $('selected').textContent = selIds.join(',');
  $('legal-info').textContent = (state.legal || []).map((mv) => (mv.cards || []).join('+')).join(' ');
  updateHandTargets(true);
  // 結果
  if (state.phase === 'round_end' || state.phase === 'game_end') { if (!opts.noResult) renderResult(state); } else showResult(false);
}
function renderRankPicker() {
  const box = $('rank-picker');
  box.classList.add('open');
  const ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', 'JOKER'];
  if (box.children.length !== ranks.length) {
    box.innerHTML = '';
    ranks.forEach((r) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'rank-btn'; b.textContent = r; b.dataset.rank = r;
      b.addEventListener('click', () => {
        const a = (gameClient.getState() || {}).awaiting;
        if (!a) return;
        if (bombPicks.includes(r)) bombPicks = bombPicks.filter((x) => x !== r);
        else if (bombPicks.length < a.count) bombPicks.push(r);
        else { Sound.play('error', { vol: 0.35 }); return; }
        Sound.play('select');
        updateHud(gameClient.getState(), { noResult: true });
      });
      box.appendChild(b);
    });
  }
  [...box.children].forEach((b) => b.classList.toggle('on', bombPicks.includes(b.dataset.rank)));
}
function renderResult(state) {
  const ol = $('ranks');
  ol.innerHTML = '';
  const gameEnd = state.phase === 'game_end';
  $('result-title').textContent = gameEnd ? 'ゲーム終了（' + (state.rounds || 1) + ' ラウンドの合計）' : ('ラウンド ' + state.round + ' の結果');
  const order = (state.ranks || []).map((r, idx) => ({ r, idx })).filter((x) => x.r > 0).sort((a, b) => a.r - b.r);
  const titles = state.titles || {};
  const last = (state.history || []).slice(-1)[0];
  order.forEach(({ r, idx }) => {
    const li = document.createElement('li');
    li.className = 'rank-' + r;
    const s = state.seats[idx];
    const pt = last && last.points ? (last.points[idx] ?? last.points[String(idx)]) : undefined;
    li.textContent = r + '位 ' + (s ? s.name : '席' + idx) + (titles[String(idx)] ? '　' + titles[String(idx)] : '') + (pt !== undefined ? '　' + (pt >= 0 ? '+' : '') + pt : '') + (idx === state.me ? '（あなた）' : '');
    ol.appendChild(li);
  });
  const scores = state.scores || {};
  const tot = Object.keys(scores).map((k) => ({ k: +k, v: scores[k] })).sort((a, b) => b.v - a.v);
  $('score-line').textContent = tot.length ? ('合計点：' + tot.map((x) => ((state.seats[x.k] || {}).name || x.k) + ' ' + (x.v >= 0 ? '+' : '') + x.v).join('　')) : '';
  const host = gameClient.isHost();
  $('again-btn').classList.toggle('hidden', !host);
  $('again-btn').textContent = gameEnd ? 'もう一度（新しいゲーム）' : '次のラウンドへ';
  $('again-note').textContent = host ? (gameEnd ? '「もう一度」で新しいゲームを始めます（ルールはそのまま）' : '「次のラウンドへ」で次の配りをします') : ('ホストの「' + (gameEnd ? 'もう一度' : '次のラウンドへ') + '」を待っています');
  showResult(true);
}

// ---------------------------------------------------------------------------
// state が届いたとき（game_client のポーリング・操作の返事）
// ---------------------------------------------------------------------------
let gameShown = false;
let lastSeatsSig = '';
function dealOrders(state) {
  // サーバーは札 k を席 k % n に配る。自分の j 枚目は k = j*n + 自分の席。相手も同じ
  const n = state.seats.length;
  const mine = (state.seats[state.me] || {}).cards || [];
  const myOrder = mine.map((_, j) => j * n + state.me);
  const bySeat = {};
  state.seats.forEach((s) => { if (s.index !== state.me) bySeat[s.index] = Array.from({ length: Math.min(s.count || 0, 14) }, (_, j) => j * n + s.index); });
  return { myOrder, bySeat };
}
function onState(state) {
  if (!state) return;
  if (state.phase === 'setup') {
    if (!gameShown) renderWait(state);
    if (Rules.isOpen() && !gameClient.isHost()) Rules.update(state.settings, state.seat_count);
    return;
  }
  if (prevRound !== null && typeof state.round === 'number' && state.round < prevRound) return;
  if (prevRound === state.round && (state.log || []).length < prevLog.length && prevLog.length < 30) return;
  if (!gameShown) enterGame(state);
  else if (!$('game-screen').classList.contains('active')) showScreen('game');
  if (!threeReady) return;
  const sig = state.seats.map((s) => s.kind + ':' + s.name).join('|') + '#' + state.me;
  const newRound = prevRound !== state.round;
  if (sig !== lastSeatsSig || newRound) {
    computeSeatOrder(state);
    buildSeatsHtml(state);
    lastSeatsSig = sig;
  }
  const mine = state.seats[state.me] || {};
  if (newRound) {
    prevRound = state.round;
    prevLog = [];
    queue = Promise.resolve(); queueBusy = 0;
    clearField(false);
    backsBySeat.forEach((rec) => { rec.group.children.slice().forEach((c) => disposeCard(c)); backsGroup.remove(rec.group); });
    backsBySeat.clear();
    showResult(false);
    $('log').classList.remove('revolution');
    deselectAll(true);
    Sound.play('round_start');
    Sound.play('shuffle');
    const orders = dealOrders(state);
    const total = state.seats.reduce((acc, s) => acc + (s.count || 0), 0) + ((state.field && state.field.cards) || []).length;
    const dealTotalMs = Math.min(3200, total * D.animation.deal_stagger_ms + D.animation.deal_ms);
    if (deckGroup) { deckGroup.visible = true; setTimeout(() => { deckGroup.visible = false; }, dealTotalMs + 150); }
    rebuildHand(mine.cards || [], true, orders.myOrder);
    updateBacks(state, orders.bySeat);
    setLog('');
    const fresh = diffLog(state.log || []);
    // 配り終わってから、開始直後の出来事（CPU の手）を見せる
    queue = queue.then(() => sleep(dealTotalMs));
    enqueueEvents(state, fresh);
  } else {
    rebuildHand(mine.cards || [], false);
    const fresh = diffLog(state.log || []);
    if (fresh.length) enqueueEvents(state, fresh);
    else if (queueBusy === 0) { setFieldFromState(state); updateBacks(state); }
  }
  selectedIndices = gameClient.getSelection();
  updateHud(state, { noResult: false });
  if (!newRound) layoutHand(true);
  if (Rules.isOpen() && !gameClient.isHost()) Rules.update(state.settings, state.seat_count);
}
function enterGame() {
  showScreen('game');
  try {
    init3D();
  } catch (e) {
    console.error('3D の初期化に失敗', e);
    setLog('この端末では 3D を表示できません。2D 版（' + location.origin + '/ ）をお使いください');
  }
  gameShown = true;
  prevRound = null;
  Sound.play('start');
}

// ---------------------------------------------------------------------------
// ロビー・待合・ルール
// ---------------------------------------------------------------------------
const STORE = 'daifugo3d.rooms';
let draftSettings = Rules.normalize({});
let draftCount = 4;
function loadStore() { try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (e) { return {}; } }
function saveRoom(code, token, name) {
  try {
    const st = loadStore();
    st[code] = { token, name, t: Date.now() };
    localStorage.setItem(STORE, JSON.stringify(st));
    localStorage.setItem('daifugo3d.last', code);
    localStorage.setItem('daifugo3d.name', name);
  } catch (e) { /* 保存できなくても遊べる */ }
}
// 参加用 URL：親機（127.0.0.1／localhost で開いている PC）のときはサーバーが調べた LAN の IP、それ以外（LAN の IP で開いたスマホ・
// インターネット上の無料サーバー https://…）は、いま開いているページの origin をそのまま使う（2026-10-22 スマホだけで遊ぶ要件）
function isLocalHost(hostname) { return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'; }
function joinUrlFor(code, loc = location) {
  const lan = gameClient.getLan();
  if (isLocalHost(loc.hostname) && lan && lan.ips && lan.ips.length) {
    const port = lan.port || loc.port || 80;
    return 'http://' + lan.ips[0] + ':' + port + '/3d/?room=' + code;
  }
  return loc.origin + '/3d/?room=' + code;
}
function joinUrlAlts(code, loc = location) {
  const lan = gameClient.getLan();
  if (!isLocalHost(loc.hostname) || !lan || !lan.ips) return [];
  return lan.ips.slice(1).map((ip) => 'http://' + ip + ':' + (lan.port || loc.port) + '/3d/?room=' + code);
}
let lastWaitSig = '';
function renderWait(state) {
  showScreen('wait');
  const code = gameClient.getCode();
  $('room-code').textContent = code || '';
  $('join-url').textContent = joinUrlFor(code);
  const alt = joinUrlAlts(code);
  let altEl = $('join-url-alt');
  if (!altEl) { altEl = document.createElement('div'); altEl.id = 'join-url-alt'; $('join-url').parentNode.after(altEl); }
  altEl.textContent = alt.length ? ('つながらないときは: ' + alt.join('  ')) : (location.protocol === 'https:' ? 'この URL を友達に送れば、どこからでも参加できます' : '');
  const ul = $('members');
  const sig = JSON.stringify(state.seats.map((s) => [s.kind, s.name, s.connected])) + JSON.stringify(state.settings) + state.seat_count;
  if (sig !== lastWaitSig) {
    lastWaitSig = sig;
    ul.innerHTML = '';
    state.seats.forEach((s) => {
      const li = document.createElement('li');
      li.className = 'member ' + (s.kind === 'cpu' ? 'cpu' : 'human') + (s.index === state.me ? ' me' : '');
      const kind = s.index === state.me ? 'あなた' : (s.kind === 'cpu' ? 'CPU（人が参加すると交代）' : (s.index === 0 ? 'ホスト' : '参加者'));
      li.innerHTML = '<span class="member-name"></span><span class="member-kind"></span>';
      li.querySelector('.member-name').textContent = s.name;
      li.querySelector('.member-kind').textContent = kind;
      ul.appendChild(li);
    });
    let rl = $('wait-rules-line');
    if (!rl) { rl = document.createElement('div'); rl.id = 'wait-rules-line'; $('wait-rules-btn').before(rl); }
    rl.textContent = 'ルール：' + Rules.summary(state.settings || {}, state.seat_count).join('／');
  }
  const host = gameClient.isHost();
  $('start-btn').classList.toggle('hidden', !host);
  $('wait-rules-btn').textContent = host ? 'ルールを変える' : '部屋のルールを見る';
  const humans = state.seats.filter((s) => s.kind === 'human').length;
  $('wait-note').textContent = host
    ? ('人間 ' + humans + ' 人・CPU ' + (state.seats.length - humans) + ' 人。友達が入ったら「開始」を押してください（開始後でも、同じ URL から CPU の席に入れます）')
    : 'ホストが開始するのを待っています（人間 ' + humans + ' 人）';
}
function setupLobby() {
  const params = new URLSearchParams(location.search);
  const roomParam = (params.get('room') || '').toUpperCase();
  const savedName = localStorage.getItem('daifugo3d.name') || '';
  if (savedName) $('name').value = savedName;
  const draft = Rules.loadDraft();
  if (draft) { draftSettings = draft.settings; draftCount = draft.count; }
  const syncCountButtons = () => document.querySelectorAll('.count-btn').forEach((x) => x.classList.toggle('active', +x.dataset.count === draftCount));
  syncCountButtons();
  document.querySelectorAll('.count-btn').forEach((b) => {
    b.addEventListener('click', () => { draftCount = parseInt(b.dataset.count, 10) || 4; syncCountButtons(); Rules.saveDraft(draftSettings, draftCount); Sound.play('ui'); });
  });
  Rules.bind();
  $('rules-btn').addEventListener('click', () => {
    Sound.play('ui');
    Rules.open({ settings: draftSettings, count: draftCount, editable: true, onChange: (s, n) => { draftSettings = s; draftCount = n; syncCountButtons(); Rules.saveDraft(s, n); } });
  });
  $('wait-rules-btn').addEventListener('click', () => {
    Sound.play('ui');
    const st = gameClient.getState() || {};
    const host = gameClient.isHost();
    Rules.open({ settings: st.settings || draftSettings, count: st.seat_count || draftCount, editable: host, onChange: async (s, n) => {
      const r = await gameClient.setRules(s, n);
      if (!r.ok) toast('ルールを変えられませんでした: ' + (r.reason || ''));
      else { draftSettings = s; draftCount = n; Rules.saveDraft(s, n); lastWaitSig = ''; renderWait(gameClient.getState()); }
    } });
  });
  $('game-rules-btn').addEventListener('click', () => { Sound.play('ui'); const st = gameClient.getState() || {}; Rules.open({ settings: st.settings || {}, count: st.seat_count || 4, editable: false }); });
  if (roomParam) {
    $('join-info').textContent = '部屋 ' + roomParam + ' に参加します';
    $('count-select').classList.add('hidden');
    $('rules-btn').classList.add('hidden');
    $('join-btn').textContent = '参加する';
  } else {
    const last = localStorage.getItem('daifugo3d.last');
    const st = loadStore();
    if (last && st[last]) {
      fetch('/api/room/' + last).then((r) => r.json()).then((info) => {
        if (info && info.ok) {
          $('resume-line').innerHTML = '';
          const a = document.createElement('a');
          a.href = '#';
          a.textContent = '前の部屋 ' + last + ' に戻る';
          a.addEventListener('click', async (ev) => { ev.preventDefault(); Sound.startBgm(); await doJoin(last, $('name').value.trim() || st[last].name, st[last].token); });
          $('resume-line').appendChild(a);
        }
      }).catch(() => {});
    }
  }
  $('join-btn').addEventListener('click', async () => {
    const name = $('name').value.trim();
    if (!name) { toast('名前を入力してください'); $('name').focus(); return; }
    Sound.startBgm();
    Sound.play('room');
    $('join-btn').disabled = true;
    try {
      if (roomParam) {
        const st = loadStore();
        const saved = st[roomParam];
        await doJoin(roomParam, name, saved && saved.name === name ? saved.token : undefined);
      } else {
        const r = await gameClient.createRoom(name, draftCount, draftSettings);
        if (!r.ok) { toast('部屋を作れませんでした: ' + r.reason); return; }
        saveRoom(r.code, r.token, name);
        history.replaceState(null, '', '/3d/?room=' + r.code);
        onState(gameClient.getState());
      }
    } finally {
      $('join-btn').disabled = false;
    }
  });
  $('copy-url').addEventListener('click', async () => {
    const text = $('join-url').textContent;
    Sound.play('ui');
    try { await navigator.clipboard.writeText(text); $('copy-url').textContent = 'コピーした'; }
    catch (e) { $('copy-url').textContent = '長押しで選択'; }
    setTimeout(() => { $('copy-url').textContent = 'コピー'; }, 1500);
  });
  $('start-btn').addEventListener('click', async () => {
    Sound.startBgm();
    Sound.play('ui');
    $('start-btn').disabled = true;
    const r = await gameClient.startGame();
    $('start-btn').disabled = false;
    if (!r.ok) { toast('開始できませんでした: ' + r.reason); return; }
    onState(gameClient.getState());
  });
  $('again-btn').addEventListener('click', async () => {
    Sound.startBgm();
    Sound.play('ui');
    $('again-btn').disabled = true;
    const r = await gameClient.startGame();
    $('again-btn').disabled = false;
    if (!r.ok) { toast('始められませんでした: ' + r.reason); return; }
    onState(gameClient.getState());
  });
  $('play-btn').addEventListener('click', onPlayButton);
  $('pass-btn').addEventListener('click', onPassButton);
  // 【実機の要望 2026-10-22】部屋を出る（待合・対戦中・結果）。対戦中は 2 回押しで確定（誤タップ防止）
  for (const id of ['wait-leave-btn', 'result-leave-btn']) $(id).addEventListener('click', () => leaveRoom());
  $('game-leave-btn').addEventListener('click', () => {
    Sound.play('ui');
    const now = performance.now();
    if (now - leaveArmedAt < 3000) { leaveRoom(); return; }
    leaveArmedAt = now;
    toast('もう一度「出る」を押すと、この部屋を出ます（あなたの席は CPU が続けます）', 3000);
  });
}
let leaveArmedAt = -1e9;
async function leaveRoom() {
  Sound.play('ui');
  const code = gameClient.getCode();
  try {
    const st = loadStore();
    if (code && st[code]) { delete st[code]; localStorage.setItem(STORE, JSON.stringify(st)); }
    if (localStorage.getItem('daifugo3d.last') === code) localStorage.removeItem('daifugo3d.last');
  } catch (e) { /* 消せなくてもよい */ }
  await gameClient.leaveRoom();
  location.href = '/3d/';   // 3D の状態をまっさらにする（ロビーへ）
}
async function onPlayButton() {
  if ($('play-btn').disabled) return;
  $('play-btn').disabled = true; $('pass-btn').disabled = true;
  Sound.play('ui', { vol: 0.5 });
  const st = gameClient.getState();
  let r;
  if (uiMode === 'play') {
    r = await gameClient.playQuiet();
  } else if (uiMode === 'give' || uiMode === 'discard' || uiMode === 'exchange_back') {
    const mine = st.seats[st.me] || {};
    const cards = gameClient.getSelection().map((i) => (mine.cards || [])[i]).filter(Boolean);
    r = await gameClient.sendAction(uiMode, cards);
  } else if (uiMode === 'bomb') {
    r = await gameClient.sendAction('bomb', bombPicks.slice());
    bombPicks = [];
  } else { r = { ok: false, reason: '' }; }
  if (!r.ok) {
    // 拒否：札は消えず選択のまま。理由を示す（追加要件 1）
    Sound.play('error');
    if (r.reason) toast('出せませんでした: ' + r.reason);
    updateHud(gameClient.getState(), { noResult: true });
  }
}
async function onPassButton() {
  if ($('pass-btn').disabled) return;
  $('play-btn').disabled = true; $('pass-btn').disabled = true;
  Sound.play('ui', { vol: 0.5 });
  let r;
  if (uiMode === 'play') r = await gameClient.passQuiet();
  else if (uiMode === 'give' || uiMode === 'discard') r = await gameClient.sendAction(uiMode, []);
  else if (uiMode === 'bomb') { r = await gameClient.sendAction('bomb', []); bombPicks = []; }
  else r = { ok: false, reason: '' };
  if (!r.ok) { Sound.play('error'); if (r.reason) toast(r.reason); updateHud(gameClient.getState(), { noResult: true }); }
}
async function doJoin(code, name, token) {
  const r = await gameClient.joinRoom(code, name, token);
  if (!r.ok) { toast('参加できませんでした: ' + r.reason); return; }
  saveRoom(code, r.token, name);
  history.replaceState(null, '', '/3d/?room=' + code);
  onState(gameClient.getState());
}

// 通信の切断・再接続の知らせ（状態の読みが続けて失敗したら切断、戻ったら再接続）
let netFail = 0, netDown = false;
const origFetch = window.fetch;
window.fetch = async function (...args) {
  const isApi = String(args[0]).includes('/api/');
  try {
    const r = await origFetch.apply(this, args);
    if (isApi) { if (netDown) { netDown = false; Sound.play('reconnect'); toast('再接続しました'); } netFail = 0; }
    return r;
  } catch (e) {
    if (isApi) { netFail++; if (netFail >= 3 && !netDown) { netDown = true; Sound.play('disconnect'); toast('通信が切れています。つながると自動で戻ります', 4000); } }
    throw e;
  }
};

// ---------------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------------
await loadDesign();
applyOverrides();
gameClient.init({
  onStateUpdate: onState,
  onRenderHand: () => {},
  onRenderField: () => {},
  onLogUpdate: () => {}
});
setupLobby();
Sound.mountUi(document.body);
showScreen('name');
// 確かめ用（道具から読む）：state・手札・場・選択・画面上の札の位置
window.__d3 = {
  get state() { return gameClient.getState(); },
  get hand() { return handCards.map((c) => c.id); },
  get field() { return fieldMoves.map((m) => m.cards); },
  get selected() { return gameClient.getSelection(); },
  get selectable() { return [...selectable]; },
  get playable() { return playable; },
  get mode() { return uiMode; },
  get profile() { return profile; },
  get fps() { return fpsValue; },
  get bgm() { return Sound.isBgmPlaying(); },
  get sound() { return Sound.getSettings(); },
  get rules() { return { draft: draftSettings, count: draftCount }; },
  get _three() { return { scene, camera, handGroup, fieldGroup, backsGroup, renderer }; },
  _joinUrl(code, loc) { return joinUrlFor(code, loc || location); },
  _cards(i) {
    const c = handCards[i];
    if (!c || !camera) return null;
    const v = c.hit.localToWorld(new THREE.Vector3(-D.card.width * 0.28, D.card.height * 0.3, 0));
    v.project(camera);
    const vw = renderer.domElement.clientWidth, vh = renderer.domElement.clientHeight;
    return { x: (v.x + 1) / 2 * vw + (viewportSize().left || 0), y: (1 - v.y) / 2 * vh + (viewportSize().top || 0), id: c.id };
  }
};
