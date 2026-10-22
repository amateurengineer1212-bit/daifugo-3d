// rules_ui.js：ルール設定の画面（会長の追加要件 7：見本の 18 項目）。Claude・2026-10-22
// - 項目の名前・説明・設定の形は、設計書 01 §5 の表と大富豪 Online の公開解説に合わせた（見本の画像に写っていない下位設定は推測していない）
// - 作る人は編集、ほかの人は閲覧。「あなたのルール」を保存・読込。初期化は既定へ戻す。自分のルールと違う項目は青
// - 値はサーバーの RuleSettings（daifugo/rules.py）の鍵と同じ。既定もサーバーと同じ

export const DEFAULTS = {
  revolution: true, sequence_revolution: true, sequence: true,
  suit_lock: true, rank_lock: false,
  eight_cut: true, eleven_back: true, joker_return: true, joker_count: 2,
  toki_oroshi: false, forbidden_win: false, forbid_2: true, forbid_8: true, forbid_11: true, forbid_joker: true, forbid_s3: true,
  card_exchange: false, five_skip: false, seven_handover: false, ten_discard: false, nine_reverse: false,
  twelve_bomber: false, down_number: false,
  mulligan: false, mulligan_max: 2,
  rounds: 3, turn_seconds: 30, cpu_level: 'normal', timeout: 60
};
const MINE_KEY = 'daifugo3d.myrules';
const DRAFT_KEY = 'daifugo3d.draftrules';

const onoff = (v) => (v ? 'ON' : 'OFF');
// 18 項目（見本の並び）。value(s, n) は見出しの値、detail は編集の部品、same(a, b) は比較
export const ITEMS = [
  { id: 'count', name: '対戦人数', desc: '人間と CPU を合わせた人数。4・5・6 人。足りない席は CPU が入り、開始前に友達が参加すると CPU と入れ替わります。',
    value: (s, n) => n + '人', fields: [{ key: '_count', label: '人数', type: 'choice', options: [[4, '4人'], [5, '5人'], [6, '6人']] }] },
  { id: 'revolution', name: '革命', desc: '4 枚以上の同じ数字を出すと強さが反転（3 が最強）。もう一度 4 枚で元に戻る（革命返し）。場が流れても続き、次のラウンドで戻ります。',
    value: (s) => onoff(s.revolution) + (s.revolution && s.sequence_revolution ? '・階段革命' : ''),
    fields: [{ key: 'revolution', label: '革命', type: 'bool' }, { key: 'sequence_revolution', label: '階段革命（4 枚以上の階段でも革命）', type: 'bool' }] },
  { id: 'sequence', name: '階段', desc: '同じスートで数字が連続する 3 枚以上を一組として出せます（3-4-5 … Q-K-A-2）。ジョーカーは足りない 1 枚の代わり。',
    value: (s) => onoff(s.sequence), fields: [{ key: 'sequence', label: '階段', type: 'bool' }] },
  { id: 'lock', name: '縛り', desc: 'スート縛り：同じスートの手が 2 回続くと、場が流れるまで同じスートだけ。数字縛り：連続する数字が 2 回続くと、次の数字だけ。',
    value: (s) => (s.suit_lock && s.rank_lock) ? 'スート＋数字' : (s.suit_lock ? 'スート' : (s.rank_lock ? '数字' : 'なし')),
    fields: [{ key: 'suit_lock', label: 'スート縛り', type: 'bool' }, { key: 'rank_lock', label: '数字縛り', type: 'bool' }] },
  { id: 'eight', name: '8切り', desc: '8 を含む手を出すと、その場で場が流れ、同じ人が先手。8 で上がる手なら流れるだけ（次の人が先手）。',
    value: (s) => onoff(s.eight_cut), fields: [{ key: 'eight_cut', label: '8切り', type: 'bool' }] },
  { id: 'eleven', name: '11バック', desc: 'J を含む手を出すと、場が流れるまで強さが反転。革命と重なれば打ち消し合います。',
    value: (s) => onoff(s.eleven_back), fields: [{ key: 'eleven_back', label: '11バック', type: 'bool' }] },
  { id: 'forbid', name: '禁止あがり', desc: '最後の手に 2（反転中は 3）・8（8切り ON）・J（11バック ON）・ジョーカー・スペ3返しが含まれると反則。反則した人は最下位側。',
    value: (s) => s.forbidden_win ? ('ON（' + [s.forbid_2 && '2', s.forbid_8 && '8', s.forbid_11 && 'J', s.forbid_joker && 'Joker', s.forbid_s3 && 'スペ3'].filter(Boolean).join('・') + '）') : 'OFF',
    fields: [{ key: 'forbidden_win', label: '禁止あがり', type: 'bool' }, { key: 'forbid_2', label: '2（反転中は 3）で上がると反則', type: 'bool', dep: 'forbidden_win' },
      { key: 'forbid_8', label: '8 で上がると反則（8切り ON のとき）', type: 'bool', dep: 'forbidden_win' }, { key: 'forbid_11', label: 'J で上がると反則（11バック ON のとき）', type: 'bool', dep: 'forbidden_win' },
      { key: 'forbid_joker', label: 'ジョーカーで上がると反則', type: 'bool', dep: 'forbidden_win' }, { key: 'forbid_s3', label: 'スペ3返しで上がると反則', type: 'bool', dep: 'forbidden_win' }] },
  { id: 'capital', name: '都落ち', desc: '前のラウンドの大富豪より先に誰かが上がった瞬間、前の大富豪は大貧民に確定（手札は捨て、そのラウンドの残りには参加しない）。2 ラウンド目以降。',
    value: (s) => onoff(s.toki_oroshi), fields: [{ key: 'toki_oroshi', label: '都落ち', type: 'bool' }] },
  { id: 'joker', name: 'Joker', desc: 'ジョーカーの枚数（0〜2）。総札数は 52 枚＋ジョーカー。ジョーカーはいつでも最強。スペ3返し：場がジョーカー 1 枚のとき ♠3 で流せます。',
    value: (s) => s.joker_count + '枚' + (s.joker_return ? '・スペ3返し' : ''),
    fields: [{ key: 'joker_count', label: '枚数', type: 'choice', options: [[0, '0枚'], [1, '1枚'], [2, '2枚']] }, { key: 'joker_return', label: 'スペ3返し', type: 'bool' }] },
  { id: 'reverse', name: 'リバース', desc: '9 を含む手を出すと、場が流れるまで手番の向きが逆になります。',
    value: (s) => onoff(s.nine_reverse), fields: [{ key: 'nine_reverse', label: '9 リバース', type: 'bool' }] },
  { id: 'skip', name: 'スキップ', desc: '5 を含む手を出すと、5 の枚数ぶん次の人を飛ばします。',
    value: (s) => onoff(s.five_skip), fields: [{ key: 'five_skip', label: '5 スキップ', type: 'bool' }] },
  { id: 'seven', name: '7渡し', desc: '7 を含む手を出したら、7 の枚数まで好きな札を次の人に裏向きで渡せます（0 枚も可）。上がる手なら渡しません。',
    value: (s) => onoff(s.seven_handover), fields: [{ key: 'seven_handover', label: '7渡し', type: 'bool' }] },
  { id: 'ten', name: '10捨て', desc: '10 を含む手を出したら、10 の枚数まで好きな札を捨てられます（0 枚も可）。捨てて 0 枚ならふつうの上がり。',
    value: (s) => onoff(s.ten_discard), fields: [{ key: 'ten_discard', label: '10捨て', type: 'bool' }] },
  { id: 'bomber', name: '12ボンバー', desc: 'Q を含む手を出したら、Q の枚数ぶん数字を選び、全員の手札からその数字の札を捨てます（ジョーカーも選べます）。',
    value: (s) => onoff(s.twelve_bomber), fields: [{ key: 'twelve_bomber', label: '12ボンバー', type: 'bool' }] },
  { id: 'down', name: 'ダウンナンバー', desc: '場と同じスートで、数字が 1 つ弱い札も出せます（複数枚は同じスートの組で）。階段には使えません。',
    value: (s) => onoff(s.down_number), fields: [{ key: 'down_number', label: 'ダウンナンバー', type: 'bool' }] },
  { id: 'exchange', name: 'カード交換', desc: '2 ラウンド目以降、大貧民は大富豪にいちばん強い 2 枚、貧民は富豪に 1 枚を自動で渡し、大富豪・富豪は好きな札を同じ枚数返します。',
    value: (s) => onoff(s.card_exchange), fields: [{ key: 'card_exchange', label: 'カード交換', type: 'bool' }] },
  { id: 'progress', name: 'ゲームの進行', desc: 'ラウンド数（終わると合計点で順位）、1 手の持ち時間（切れたら自動：場が空なら最弱の札、場があればパス）、CPU の強さ。',
    value: (s) => s.rounds + 'R・' + (s.turn_seconds ? s.turn_seconds + '秒' : '無制限') + '・CPU ' + ({ normal: 'ノーマル', hard: 'ハード', dangerous: 'デンジャラス' }[s.cpu_level] || s.cpu_level),
    fields: [{ key: 'rounds', label: 'ラウンド数', type: 'choice', options: [[1, '1'], [2, '2'], [3, '3'], [5, '5'], [7, '7'], [10, '10']] },
      { key: 'turn_seconds', label: '持ち時間', type: 'choice', options: [[0, '無制限'], [15, '15秒'], [30, '30秒'], [60, '60秒'], [120, '120秒']] },
      { key: 'cpu_level', label: 'CPU の強さ', type: 'choice', options: [['normal', 'ノーマル'], ['hard', 'ハード'], ['dangerous', 'デンジャラス']] }] },
  { id: 'reset', name: '初期化', desc: 'ルールを既定（設計書 01 §5）に戻します。名前や音の設定、保存した「あなたのルール」は消しません。', action: true,
    value: () => '既定に戻す', fields: [] },
];

export function normalize(s) {
  const out = Object.assign({}, DEFAULTS);
  for (const k of Object.keys(DEFAULTS)) if (s && s[k] !== undefined && s[k] !== null) out[k] = s[k];
  return out;
}
export function loadMine() { try { const v = JSON.parse(localStorage.getItem(MINE_KEY) || 'null'); return v ? Object.assign(normalize(v), { _count: v._count || 4 }) : null; } catch (e) { return null; } }
export function saveMine(s, n) { try { localStorage.setItem(MINE_KEY, JSON.stringify(Object.assign(normalize(s), { _count: n }))); } catch (e) {} }
export function loadDraft() { try { const v = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); return v ? { settings: normalize(v), count: v._count || 4 } : null; } catch (e) { return null; } }
export function saveDraft(s, n) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(Object.assign(normalize(s), { _count: n }))); } catch (e) {} }

function sameItem(item, a, b, na, nb) {
  if (item.id === 'count') return na === nb;
  if (item.action) return true;
  return item.fields.every((f) => String(a[f.key]) === String(b[f.key]));
}
/** 違いの数と一致率（見本の「あなたのルールとのマッチング率」） */
export function compare(room, mine, nRoom, nMine) {
  const items = ITEMS.filter((i) => !i.action);
  const same = items.filter((i) => sameItem(i, room, mine, nRoom, nMine)).length;
  return { same, total: items.length, rate: Math.round(same / items.length * 100), diff: items.filter((i) => !sameItem(i, room, mine, nRoom, nMine)).map((i) => i.id) };
}
/** 待合などに出す短い一覧（既定と違う物だけ） */
export function summary(s, n) {
  s = normalize(s);
  const out = [];
  for (const it of ITEMS) {
    if (it.action) continue;
    const v = it.value(s, n);
    const dv = it.value(DEFAULTS, 4);
    if (it.id === 'count' || v !== dv) out.push(it.name + '：' + v);
  }
  return out;
}

let cur = null;   // { settings, count, editable, onChange, mine, mineCount }
let openItem = null;
const $ = (id) => document.getElementById(id);

export function open(opts) {
  cur = Object.assign({ settings: normalize({}), count: 4, editable: false, onChange: null }, opts);
  cur.settings = normalize(cur.settings);
  cur.mine = loadMine();
  cur.mineCount = (cur.mine && cur.mine._count) || null;
  $('rules-title').textContent = cur.editable ? 'ルールを決める（部屋を作る人）' : '部屋のルール';
  $('rules-note').textContent = cur.editable ? '項目を押すと説明と設定が出ます。変えた内容は部屋の全員と CPU に同じく効きます。' : '部屋を作った人が決めたルールです（変更はできません）。あなたのルールと違う項目は青で出ます。';
  $('rules-save-mine').style.display = '';
  $('rules-load-mine').style.display = cur.editable ? '' : 'none';
  $('rules-reset').style.display = cur.editable ? '' : 'none';
  openItem = null;
  render();
  $('rules-screen').classList.add('active');
}
export function close() { $('rules-screen').classList.remove('active'); cur = null; }
export function isOpen() { return $('rules-screen').classList.contains('active'); }
export function update(settings, count) {
  if (!cur || cur.editable) return;
  cur.settings = normalize(settings); cur.count = count; render();
}

function render() {
  const grid = $('rules-grid');
  grid.innerHTML = '';
  const cmp = cur.mine ? compare(cur.settings, cur.mine, cur.count, cur.mineCount || 4) : null;
  for (const it of ITEMS) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'rule-tile' + (openItem === it.id ? ' open' : '') + (cmp && cmp.diff.includes(it.id) ? ' diff' : '') + (it.action ? ' action' : '');
    tile.dataset.rule = it.id;
    tile.innerHTML = '<span class="rule-name"></span><span class="rule-value"></span>';
    tile.querySelector('.rule-name').textContent = it.name;
    tile.querySelector('.rule-value').textContent = it.value(cur.settings, cur.count);
    tile.addEventListener('click', () => {
      if (it.action) {
        if (!cur.editable) return;
        if (confirm('ルールを既定に戻しますか？')) { cur.settings = normalize({}); cur.count = 4; changed(); }
        return;
      }
      openItem = (openItem === it.id) ? null : it.id;
      render();
    });
    grid.appendChild(tile);
  }
  renderDetail();
  $('rules-match').textContent = cmp ? ('あなたのルールとの一致：' + cmp.same + '/' + cmp.total + '（' + cmp.rate + '%）' + (cmp.diff.length ? '　違う項目は青' : '')) : (cur.editable ? '「あなたのルールとして保存」で、次回から読み込めます' : 'あなたのルールを保存すると、違いが青で出ます');
}
function renderDetail() {
  const box = $('rules-detail');
  box.innerHTML = '';
  const it = ITEMS.find((x) => x.id === openItem);
  if (!it) return;
  const h = document.createElement('div'); h.className = 'rd-head'; h.textContent = it.name; box.appendChild(h);
  const d = document.createElement('p'); d.className = 'rd-desc'; d.textContent = it.desc; box.appendChild(d);
  for (const f of it.fields) {
    const row = document.createElement('div'); row.className = 'rd-row';
    const lab = document.createElement('span'); lab.className = 'rd-label'; lab.textContent = f.label; row.appendChild(lab);
    const disabled = !cur.editable || (f.dep && !cur.settings[f.dep]);
    if (f.type === 'bool') {
      for (const [v, t] of [[true, 'ON'], [false, 'OFF']]) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'rd-opt' + (Boolean(cur.settings[f.key]) === v ? ' on' : ''); b.textContent = t; b.disabled = disabled;
        b.addEventListener('click', () => { cur.settings[f.key] = v; changed(); });
        row.appendChild(b);
      }
    } else if (f.type === 'choice') {
      const curv = f.key === '_count' ? cur.count : cur.settings[f.key];
      for (const [v, t] of f.options) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'rd-opt' + (String(curv) === String(v) ? ' on' : ''); b.textContent = t; b.disabled = disabled;
        b.addEventListener('click', () => { if (f.key === '_count') cur.count = v; else cur.settings[f.key] = v; changed(); });
        row.appendChild(b);
      }
    }
    box.appendChild(row);
  }
}
function changed() {
  render();
  if (cur.onChange) cur.onChange(normalize(cur.settings), cur.count);
}

export function bind() {
  $('rules-close').addEventListener('click', () => close());
  $('rules-save-mine').addEventListener('click', () => { if (!cur) return; saveMine(cur.settings, cur.count); cur.mine = loadMine(); cur.mineCount = cur.count; render(); });
  $('rules-load-mine').addEventListener('click', () => { if (!cur || !cur.editable) return; const m = loadMine(); if (!m) { alert('保存した「あなたのルール」がまだありません'); return; } cur.settings = normalize(m); cur.count = m._count || cur.count; changed(); });
  $('rules-reset').addEventListener('click', () => { if (!cur || !cur.editable) return; cur.settings = normalize({}); cur.count = 4; changed(); });
}
