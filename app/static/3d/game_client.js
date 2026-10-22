/**
 * 3D 対戦画面 - ゲーム通信クライアント
 * 2D の app.js の通信ロジックを切り離して実装
 */

// 状態管理
let state = null;
let myToken = null;
let myCode = null;
let mySeat = null;
let selectedCards = [];
let pollTimer = null;

// 状態更新時のコールバック（3D 描画用）
let onStateUpdate = null;
let onRenderHand = null;
let onRenderField = null;
let onLogUpdate = null;

/**
 * 初期化
 * @param {Object} callbacks - コールバック関数 { onStateUpdate, onRenderHand, onRenderField, onLogUpdate }
 */
export function init(callbacks) {
    if (callbacks) {
        onStateUpdate = callbacks.onStateUpdate || (() => {});
        onRenderHand = callbacks.onRenderHand || (() => {});
        onRenderField = callbacks.onRenderField || (() => {});
        onLogUpdate = callbacks.onLogUpdate || (() => {});
    }
}

/**
 * 部屋を作成し、ゲームを開始する
 * @param {string} name - プレイヤー名
 */
export async function createAndStart(name) {
    try {
        // 部屋作成
        const res = await fetch('/api/room', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        const data = await res.json();
        
        if (!data.ok) {
            console.error('部屋作成に失敗:', data.reason);
            alert('部屋作成に失敗しました: ' + data.reason);
            return null;
        }
        
        myCode = data.code;
        myToken = data.token;
        mySeat = data.seat;
        
        // ゲーム開始
        const startRes = await fetch(`/api/room/${myCode}/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: myToken })
        });
        const startData = await startRes.json();
        
        if (!startData.ok) {
            console.error('ゲーム開始に失敗:', startData.reason);
            alert('開始に失敗しました: ' + startData.reason);
            return null;
        }
        
        state = startData.state;
        selectedCards = [];
        
        // 状態更新コールバックを呼び出し
        updateState(state);
        
        // ポーリング開始
        startPolling();
        
        return { code: myCode, token: myToken, seat: mySeat };
    } catch (e) {
        console.error('createAndStart error:', e);
        return null;
    }
}

/**
 * 状態を取得（ポーリング用）
 */
async function fetchState() {
    if (!myCode || !myToken) return;
    try {
        // 【Claude 2026-10-22】iPhone の Safari が同じ URL の GET を端末の控えから返すことがあるので、毎回ちがう URL＋no-store にする
        const res = await fetch(`/api/room/${myCode}/state?token=${myToken}&_=${Date.now()}`, { cache: 'no-store' });
        const data = await res.json();
        if (data.ok) {
            state = data.state;
            updateState(state);
        }
    } catch (e) {
        console.error('State fetch error:', e);
    }
}

/**
 * ポーリング開始
 */
function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    fetchState(); // 即時実行
    pollTimer = setInterval(fetchState, 1000);
}

/**
 * 状態更新時の処理
 * @param {Object} newState - 新しい状態
 */
function updateState(newState) {
    state = newState;
    
    // ロギング
    if (state.log && onLogUpdate) {
        onLogUpdate(state.log);
    }
    
    // 場の更新
    if (state.field && onRenderField) {
        onRenderField(state.field);
    }
    
    // 手札の更新
    if (state.seats) {
        const mySeatData = state.seats.find(s => s.is_me);
        if (mySeatData && mySeatData.cards && onRenderHand) {
            onRenderHand(mySeatData.cards, selectedCards);
        }
    }
    
    // 全体の状態更新コールバック
    if (onStateUpdate) {
        onStateUpdate(state);
    }
}

/**
 * カードの選択切り替え
 * @param {number} index - 手札のインデックス
 */
export function toggleCardSelection(index) {
    const pos = selectedCards.indexOf(index);
    if (pos >= 0) {
        selectedCards.splice(pos, 1);
    } else {
        selectedCards.push(index);
    }
    
    // 選択状態を反映
    if (state) {
        const mySeatData = state.seats.find(s => s.is_me);
        if (mySeatData && mySeatData.cards) {
            onRenderHand(mySeatData.cards, selectedCards);
        }
    }
}

/**
 * カードを選択（インデックスで）
 * @param {number} index - 手札のインデックス
 */
export function selectCard(index) {
    if (!selectedCards.includes(index)) {
        selectedCards.push(index);
        if (state) {
            const mySeatData = state.seats.find(s => s.is_me);
            if (mySeatData && mySeatData.cards) {
                onRenderHand(mySeatData.cards, selectedCards);
            }
        }
    }
}

/**
 * 選択を解除
 * @param {number} index - 手札のインデックス
 */
export function deselectCard(index) {
    const pos = selectedCards.indexOf(index);
    if (pos >= 0) {
        selectedCards.splice(pos, 1);
        if (state) {
            const mySeatData = state.seats.find(s => s.is_me);
            if (mySeatData && mySeatData.cards) {
                onRenderHand(mySeatData.cards, selectedCards);
            }
        }
    }
}

/**
 * 選択をクリア
 */
export function clearSelection() {
    selectedCards = [];
    if (state) {
        const mySeatData = state.seats.find(s => s.is_me);
        if (mySeatData && mySeatData.cards) {
            onRenderHand(mySeatData.cards, selectedCards);
        }
    }
}

/**
 * カードを出す
 */
export async function playCards() {
    if (selectedCards.length === 0 || !myCode || !myToken) {
        console.warn('No cards selected or not in game');
        return false;
    }
    
    const mySeatData = state.seats.find(s => s.is_me);
    if (!mySeatData || !mySeatData.cards) {
        console.warn('No hand data');
        return false;
    }
    
    const cards = selectedCards.map(idx => mySeatData.cards[idx]);
    
    try {
        const res = await fetch(`/api/room/${myCode}/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: myToken, type: 'play', cards })
        });
        const data = await res.json();
        
        if (data.ok) {
            selectedCards = [];
            state = data.state;
            updateState(state);
            return true;
        } else {
            console.error('Action rejected:', data.reason);
            alert('行動が拒否されました: ' + data.reason);
            return false;
        }
    } catch (e) {
        console.error('playCards error:', e);
        return false;
    }
}

/**
 * パスする
 */
export async function doPass() {
    if (!myCode || !myToken) {
        console.warn('Not in game');
        return false;
    }
    
    try {
        const res = await fetch(`/api/room/${myCode}/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: myToken, type: 'pass' })
        });
        const data = await res.json();
        
        if (data.ok) {
            state = data.state;
            updateState(state);
            return true;
        } else {
            console.error('Pass failed:', data.reason);
            alert('パスできませんでした: ' + data.reason);
            return false;
        }
    } catch (e) {
        console.error('doPass error:', e);
        return false;
    }
}

/**
 * 現在の状態を取得
 * @returns {Object|null} 現在の状態
 */
export function getState() {
    return state;
}

/**
 * 現在の選択状態を取得
 * @returns {number[]} 選択されているカードのインデックス配列
 */
export function getSelection() {
    return [...selectedCards];
}

/**
 * 自分の席番号を取得
 * @returns {number|null} 自分の席番号
 */
export function getMySeat() {
    return mySeat;
}

/**
 * 手番が自分のかチェック
 * @returns {boolean} 自分の手番なら true
 */
export function isMyTurn() {
    if (!state) return false;
    return state.turn === mySeat;
}

/**
 * 出せるカードがあるかチェック
 * @returns {boolean} 出せるカードがあれば true
 */
export function canPlay() {
    if (!state || selectedCards.length === 0) return false;
    return state.legal && state.legal.length > 0;
}

/**
 * パスできるかチェック
 * @returns {boolean} パスできれば true
 */
export function canPass() {
    if (!state) return false;
    return state.can_pass || false;
}

/**
 * ポーリングを停止
 */
export function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

// 初期化コールバックを設定（モジュールロード時に自動初期化）
init({});

// ============================================================================
// 【Claude 2026-10-22 会長の最終依頼】同じ Wi-Fi での対戦のための「足した」入口。
//   上の createAndStart・playCards・doPass・ポーリングは変えていない（同じ fetch・同じ API）。
//   足したのは、部屋を作る（開始しない）・参加する（/join）・ホストが開始する・LAN の情報、の 4 つ。
// ============================================================================
let lanInfo = null;      // {ips:[...], port:N}（部屋を作った・参加した返事に入っている）
let actionBusy = false;  // 1 回の操作が重複して送られないように

/**
 * 部屋を作る（開始はしない。待合で参加を待ってから startGame）
 * @param {string} name
 * @param {number} seatCount 合計人数 4・5・6
 */
export async function createRoom(name, seatCount, settings) {
    const res = await fetch('/api/room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings ? { name, seat_count: seatCount, settings } : { name, seat_count: seatCount })
    });
    const data = await res.json();
    if (!data.ok) return { ok: false, reason: data.reason };
    myCode = data.code; myToken = data.token; mySeat = data.seat; lanInfo = data.lan || null;
    selectedCards = [];
    updateState(data.state);
    startPolling();
    return { ok: true, code: myCode, token: myToken, seat: mySeat, lan: lanInfo };
}

/**
 * 参加する（同じ token なら元の席へ再接続）
 */
export async function joinRoom(code, name, token) {
    const res = await fetch(`/api/room/${code}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(token ? { name, token } : { name })
    });
    const data = await res.json();
    if (!data.ok) return { ok: false, reason: data.reason };
    myCode = data.code; myToken = data.token; mySeat = data.seat; lanInfo = data.lan || null;
    selectedCards = [];
    updateState(data.state);
    startPolling();
    return { ok: true, code: myCode, token: myToken, seat: mySeat, lan: lanInfo };
}

/**
 * ホストが開始する（round_end のあとの「もう一度」も同じ）
 */
export async function startGame() {
    if (!myCode || !myToken) return { ok: false, reason: 'not in room' };
    const res = await fetch(`/api/room/${myCode}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: myToken })
    });
    const data = await res.json();
    if (!data.ok) return { ok: false, reason: data.reason };
    selectedCards = [];
    updateState(data.state);
    return { ok: true };
}

export function getLan() { return lanInfo; }
export function getCode() { return myCode; }
export function getToken() { return myToken; }
export function isHost() { return (state && typeof state.host === 'number') ? state.host === mySeat : mySeat === 0; }   // 退出でホストが引き継がれることがある（state.host）
/** 【Claude 2026-10-22 実機の要望】退出：席を CPU に戻してもらい、通信を止める */
export async function leaveRoom() {
    if (!myCode || !myToken) return { ok: false, reason: 'not in room' };
    stopPolling();
    try {
        const res = await fetch(`/api/room/${myCode}/leave`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: myToken }) });
        return await res.json();
    } catch (e) {
        return { ok: false, reason: String(e) };
    }
}
export function setSelection(indices) {
    selectedCards = [...indices];
}

/**
 * 出す・パスを「1 回ずつ」送る（送っている間は次を受け付けない）
 */
export async function playOnce() {
    if (actionBusy) return false;
    actionBusy = true;
    try { return await playCards(); } finally { actionBusy = false; }
}
export async function passOnce() {
    if (actionBusy) return false;
    actionBusy = true;
    try { return await doPass(); } finally { actionBusy = false; }
}
export function isBusy() { return actionBusy; }

/**
 * カードクリックイベントハンドラ（インデックスで）
 * 選択状態のみ変更し、UI 更新は呼び出し元で行う
 * @param {number} index - クリックされたカードのインデックス
 * @returns {number[]} 更新後の選択インデックス配列
 */
export function handleCardClick(index) {
    if (state && isMyTurn()) {
        toggleCardSelection(index);
        return [...selectedCards];
    }
    return [...selectedCards];
}




// 【Claude 2026-10-22 追加要件 7・4】ルールの変更（作った人・開始前）と、待ちの行動（7渡し・10捨て・12ボンバー・交換の返し）
export async function setRules(settings, seatCount) {
    if (!myCode || !myToken) return { ok: false, reason: 'not in room' };
    const body = { token: myToken, settings };
    if (seatCount) body.seat_count = seatCount;
    const res = await fetch(`/api/room/${myCode}/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (data.ok && data.state) updateState(data.state);
    return data;
}
/** 待ちの行動を 1 回ずつ送る（type: give|discard|bomb|exchange_back、cards: 札の名前か数字） */
export async function sendAction(type, cards) {
    if (actionBusy || !myCode || !myToken) return { ok: false, reason: 'busy' };
    actionBusy = true;
    try {
        const res = await fetch(`/api/room/${myCode}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: myToken, type, cards: cards || [] }) });
        const data = await res.json();
        if (data.ok) { selectedCards = []; updateState(data.state); }
        return data;
    } catch (e) {
        return { ok: false, reason: String(e) };
    } finally {
        actionBusy = false;
    }
}
/** 出す（返事をそのまま返す。拒否の理由を画面で出すため。alert はしない） */
export async function playQuiet() {
    if (actionBusy || !myCode || !myToken || !state) return { ok: false, reason: 'busy' };
    const mySeatData = state.seats.find(s => s.is_me);
    if (!mySeatData || selectedCards.length === 0) return { ok: false, reason: '札を選んでください' };
    const cards = selectedCards.map(idx => mySeatData.cards[idx]);
    actionBusy = true;
    try {
        const res = await fetch(`/api/room/${myCode}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: myToken, type: 'play', cards }) });
        const data = await res.json();
        if (data.ok) { selectedCards = []; updateState(data.state); }
        return data;
    } catch (e) {
        return { ok: false, reason: String(e) };
    } finally {
        actionBusy = false;
    }
}
export async function passQuiet() {
    if (actionBusy || !myCode || !myToken) return { ok: false, reason: 'busy' };
    actionBusy = true;
    try {
        const res = await fetch(`/api/room/${myCode}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: myToken, type: 'pass' }) });
        const data = await res.json();
        if (data.ok) updateState(data.state);
        return data;
    } catch (e) {
        return { ok: false, reason: String(e) };
    } finally {
        actionBusy = false;
    }
}
