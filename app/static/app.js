/**
 * 大富豪オンライン - 最小動作クライアント
 * 設計書 03 §3 に基づく実装
 */

// 状態管理
let state = null;
let myToken = null;
let myCode = null;
let mySeat = null;
let selectedCards = [];
let pollTimer = null;

// DOM 要素
const loginScreen = document.getElementById('login');
const gameScreen = document.getElementById('game');
const resultScreen = document.getElementById('result');
const nameInput = document.getElementById('name');
const joinBtn = document.getElementById('join-btn');
const fieldEl = document.getElementById('field');
const seatsEl = document.getElementById('seats');
const playBtn = document.getElementById('play-btn');
const passBtn = document.getElementById('pass-btn');
const logEl = document.getElementById('log');
const ranksEl = document.getElementById('ranks');
const againBtn = document.getElementById('again-btn');

// 手札表示用要素を動的に作成
if (!document.getElementById('hand')) {
    const controls = document.getElementById('controls');
    const handDiv = document.createElement('div');
    handDiv.id = 'hand';
    handDiv.style.display = 'flex';
    handDiv.style.gap = '0.5rem';
    handDiv.style.margin = '1rem 0';
    handDiv.style.justifyContent = 'center';
    controls.parentNode.insertBefore(handDiv, controls);
}
const handEl = document.getElementById('hand');

// 札の表示用ヘルパ
function formatCard(card) {
    if (!card) return '';
    // card は文字列 "S3", "H10", "X1" など
    if (card.startsWith('X')) {
        return card;
    }
    const suitChar = { 'S': '♠', 'H': '♥', 'D': '♦', 'C': '♣' }[card[0]] || card[0];
    const rank = card.slice(1);
    return `${suitChar}${rank}`;
}

// 状態の描画
function render(state) {
    if (!state) return;

    // ログ更新
    if (state.log) {
        // 【Claude 2026-10-19】名前に記号が入っても HTML として読まないよう、文字として描く
        logEl.innerHTML = '';
        state.log.forEach(l => { const d = document.createElement('div'); d.textContent = l; logEl.appendChild(d); });
        logEl.scrollTop = logEl.scrollHeight;
    }

    // 場の札
    fieldEl.innerHTML = '';
    if (state.field && state.field.cards && state.field.cards.length > 0) {
        state.field.cards.forEach(card => {
            const span = document.createElement('span');
            span.className = 'card';
            span.textContent = formatCard(card);
            fieldEl.appendChild(span);
        });
    }

    // 席の表示
    seatsEl.innerHTML = '';
    if (state.seats) {
        // 【Claude 2026-10-19 P13】席を楕円の周りに置く（03 §2-3：自分は下、ほかの席は手番の順に時計回り）。
        //   これまでは位置が無く、全部の席が卓の左上に重なっていた。
        const 席の数 = state.seats.length;
        const 自分 = state.seats.findIndex(s => s.is_me);
        state.seats.forEach((seat, idx) => {
            const div = document.createElement('div');
            div.className = `seat ${seat.is_me ? 'my-seat' : ''}`;
            if (state.turn === idx) {
                div.classList.add('active');
            }
            const 順 = ((idx - (自分 < 0 ? 0 : 自分)) % 席の数 + 席の数) % 席の数;   // 0＝自分、1＝次の席 …
            const 角 = (90 + 順 * 360 / 席の数) * Math.PI / 180;                  // 90°＝下、180°＝左、270°＝上（時計回り）
            div.style.left = (50 + 45 * Math.cos(角)) + '%';
            div.style.top = (45.5 + 42.5 * Math.sin(角)) + '%';                  // 上は 3%・下は 88%（「場」「手札」の文字に掛からない）
            div.innerHTML = `
                <div class="seat-name">${seat.name || 'CPU'}</div>
                <div class="seat-count">${seat.count}枚</div>
            `;
            seatsEl.appendChild(div);
        });
    }

    // 自分の手札
    handEl.innerHTML = '';
    const mySeatData = state.seats.find(s => s.is_me);
    if (mySeatData && mySeatData.cards) {
        mySeatData.cards.forEach((card, idx) => {
            const span = document.createElement('span');
            span.className = 'card';
            span.textContent = formatCard(card);
            span.dataset.index = idx;
            span.onclick = () => toggleCardSelection(idx);
            if (selectedCards.includes(idx)) {
                span.classList.add('selected');
            }
            handEl.appendChild(span);
        });
    }

    // 「出す」ボタン：合法手か確認
    const canPlay = selectedCards.length > 0 && state.legal && state.legal.length > 0;
    playBtn.disabled = !canPlay;

    // 「パス」ボタン：パス可能か
    passBtn.disabled = !state.can_pass;

    // ゲーム終了時の処理
    if (state.phase === 'round_end' || (state.ranks && state.ranks.length > 0)) {
        showResult(state);
    } else {
        resultScreen.style.display = 'none';
        gameScreen.style.display = 'block';
    }
}

// 札の選択切り替え
function toggleCardSelection(idx) {
    const pos = selectedCards.indexOf(idx);
    if (pos >= 0) {
        selectedCards.splice(pos, 1);
    } else {
        selectedCards.push(idx);
    }
    render(state);
}

// 部屋作成
async function createRoom(name) {
    const res = await fetch('/api/room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (data.ok) {
        myCode = data.code;
        myToken = data.token;
        mySeat = data.seat;
        // 【Claude 2026-10-19】部屋を作ったら、すぐゲームを始める（05 §2-5：POST /api/room/{code}/start）。
        //   これが無いと、卓に札が出ずゲームが始まらなかった（受け入れ試験 B1）。
        const startRes = await fetch(`/api/room/${myCode}/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: myToken })
        });
        const startData = await startRes.json();
        if (!startData.ok) {
            alert('開始に失敗しました: ' + startData.reason);
            return;
        }
        state = startData.state;
        selectedCards = [];
        loginScreen.style.display = 'none';
        gameScreen.style.display = 'block';
        render(state);
        startPolling();
    } else {
        alert('部屋作成に失敗しました: ' + data.reason);
    }
}

// 状態取得（polling）
async function fetchState() {
    if (!myCode || !myToken) return;
    try {
        const res = await fetch(`/api/room/${myCode}/state?token=${myToken}`);
        const data = await res.json();
        if (data.ok) {
            state = data.state;
            render(state);
        }
    } catch (e) {
        console.error('State fetch error:', e);
    }
}

function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    fetchState(); // 即時実行
    pollTimer = setInterval(fetchState, 1000);
}

// 行動（出す）
async function playCards() {
    if (selectedCards.length === 0 || !myCode || !myToken) return;
    const mySeatData = state.seats.find(s => s.is_me);
    if (!mySeatData || !mySeatData.cards) return;
    
    const cards = selectedCards.map(idx => mySeatData.cards[idx]);
    const res = await fetch(`/api/room/${myCode}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: myToken, type: 'play', cards })
    });
    const data = await res.json();
    if (data.ok) {
        selectedCards = [];
        state = data.state;
        render(state);
    } else {
        alert('行動が拒否されました: ' + data.reason);
    }
}

// 行動（パス）
async function doPass() {
    if (!myCode || !myToken) return;
    const res = await fetch(`/api/room/${myCode}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: myToken, type: 'pass' })
    });
    const data = await res.json();
    if (data.ok) {
        state = data.state;
        render(state);
    } else {
        alert('パスできませんでした: ' + data.reason);
    }
}

// 結果表示
function showResult(state) {
    gameScreen.style.display = 'none';
    resultScreen.style.display = 'block';
    ranksEl.innerHTML = '';
    if (state.ranks) {
        // 【Claude 2026-10-19】ranks は「席ごとの順位」（05 §2-5）。席の順に 1位・2位… と振っていたので、順位の小さい順に並べ直す
        const order = state.ranks.map((r, idx) => ({ r, idx })).sort((a, b) => a.r - b.r);
        order.forEach(({ r, idx }) => {
            const li = document.createElement('li');
            const seatData = state.seats.find(s => s.index === idx);
            const name = seatData ? seatData.name : `席${idx}`;
            li.textContent = `${r}位: ${name}`;
            ranksEl.appendChild(li);
        });
    }
}

// イベントリスナ
joinBtn.onclick = () => {
    const name = nameInput.value.trim();
    if (!name) {
        alert('名前を入力してください');
        return;
    }
    createRoom(name);
};

playBtn.onclick = playCards;
passBtn.onclick = doPass;

againBtn.onclick = () => {
    if (!myCode || !myToken) return;
    fetch(`/api/room/${myCode}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: myToken })
    })
    .then(res => res.json())
    .then(data => {
        if (data.ok) {
            state = data.state;
            selectedCards = [];
            resultScreen.style.display = 'none';
            gameScreen.style.display = 'block';
        } else {
            alert('再開始に失敗しました: ' + data.reason);
        }
    });
};

// 初期化
nameInput.value = localStorage.getItem('daifugo.profile') || '';
