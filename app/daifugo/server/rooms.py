# -*- coding: utf-8 -*-
"""daifugo/server/rooms.py（部屋の管理）

【Claude 2026-10-22 会長の最終依頼・追加要件】
- 席数 4〜6、参加（/join）で開始前の CPU の席と入れ替え、同じ token で元の席へ再接続、自分の手札だけを返す
- ルール設定：作った人が開始前に変える（set_rules）。state に settings を入れて全員に同じ設定
- ラウンド数と得点：round_end で点を足し、rounds に達したら game_end。「もう一度」は次のラウンド（前の順位を引き継ぐ）／game_end なら新しいゲーム
- 待ち（7渡し・10捨て・12ボンバー・交換の返し）：CPU は自動で解決。人間は /action の give／discard／bomb／exchange_back
- 持ち時間（turn_seconds）：人間の手番が切れたら 01 §7 の自動の手（状態を読むときに判定）
"""

import secrets
import string
import threading
import time
from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List

from daifugo.game import Game
from daifugo.rules import RuleSettings
from daifugo.cpu import make_cpu
from daifugo.view import view_for, view_for_cpu


# 英大文字と数字（I, O, 0, 1 を除く）で 5 文字のコード生成
ALPHANUM = string.ascii_uppercase.replace("I", "").replace("O", "") + string.digits.replace("0", "").replace("1", "")
def _gen_code():
    return "".join(secrets.choice(ALPHANUM) for _ in range(5))

@dataclass
class Seat:
    index: int
    kind: str  # "human", "cpu", "ai", "empty"
    name: str
    avatar: str
    token: Optional[str] = None
    level: str = "normal"
    ai_key_name: Optional[str] = None
    connected: bool = False
    fallback_reason: Optional[str] = None
    last_seen: float = 0.0   # 最後に状態を読んだ時刻（接続中の判定に使う）

@dataclass
class Room:
    code: str
    host_token: str
    seats: List[Seat]
    settings: RuleSettings
    seat_count: int
    game: Optional[Game] = None
    round_no: int = 0
    scores: Dict[int, int] = field(default_factory=dict)
    lock: threading.RLock = field(default_factory=threading.RLock)
    created: float = field(default_factory=time.time)
    last_active: float = field(default_factory=time.time)
    last_ranks: Optional[List[int]] = None     # 前のラウンドの順位（カード交換・都落ち・最初の手番に使う）
    settled_round: int = 0                      # 点を足し終えたラウンド
    game_over: bool = False                     # rounds に達した
    turn_key: Any = None                        # 手番の切り替わりを見る印
    turn_since: float = 0.0
    history: List[Dict[str, Any]] = field(default_factory=list)   # ラウンドごとの順位と点

# 部屋台帳
_ROOMS: Dict[str, Room] = {}
_LOCK = threading.Lock()


def _make_cpu_seats(seats: List[Seat], seat_count: int, level: str = "normal"):
    """席 1〜n-1 を CPU で埋める（人間の席はそのまま）。"""
    out = list(seats[:seat_count])
    for i in range(len(out), seat_count):
        out.append(Seat(index=i, kind="cpu", name=f"CPU{i}", avatar="default", level=level))
    for s in out:
        if s.kind == "cpu":
            s.level = level
    return out


def create(host_name: str, host_avatar: str, settings: Optional[Dict] = None, seat_count: int = 4) -> Room:
    """部屋を作成し、ホストを席 0 に配置。空席は CPU で埋める。"""
    code = _gen_code()
    while code in _ROOMS:
        code = _gen_code()
    host_token = secrets.token_hex(8)
    rule_settings = RuleSettings.from_dict(settings) if settings else RuleSettings()
    try:
        cleanup(3 * 3600)
    except Exception:
        pass
    try:
        seat_count = int(seat_count)
    except (TypeError, ValueError):
        seat_count = 4
    if seat_count < 2 or seat_count > 6:
        seat_count = 4
    seats = [Seat(index=0, kind="human", name=(host_name or "Player")[:20], avatar=host_avatar, token=host_token, connected=True)]
    seats = _make_cpu_seats(seats, seat_count, rule_settings.cpu_level)
    room = Room(code=code, host_token=host_token, seats=seats, settings=rule_settings, seat_count=seat_count)
    with _LOCK:
        _ROOMS[code] = room
    return room

def get(code: str) -> Optional[Room]:
    with _LOCK:
        return _ROOMS.get(code)

def join(code: str, name: str, avatar: str) -> Optional[Seat]:
    """部屋に参加（空席があればそこ。互換のため残す）。"""
    seat, _ = join_or_reconnect(code, name, avatar, None)
    return seat


def join_or_reconnect(code: str, name: str, avatar: str, token: Optional[str] = None):
    """参加（設計書 02 の POST /api/room/{code}/join）。戻り値 (席, 理由)。
    - token が渡され、その token の席があれば再接続（同じ席へ戻る。他人の席には入らない）
    - 開始前：空席 → 無ければ CPU の席（番号の小さい順）を人間に入れ替える
    - 開始後：token の無い新しい参加は断る"""
    with _LOCK:
        room = _ROOMS.get(code)
    if not room:
        return None, "部屋がありません"
    with room.lock:
        if token:
            for seat in room.seats:
                if seat.kind == "human" and seat.token == token:
                    seat.connected = True
                    seat.last_seen = time.time()
                    room.last_active = time.time()
                    return seat, ""
        if room.game is not None:
            return None, "対戦中です（開始前にだけ参加できます）"
        target = None
        for seat in room.seats:
            if seat.kind == "empty":
                target = seat
                break
        if target is None:
            for seat in room.seats:
                if seat.kind == "cpu" and seat.index != 0:
                    target = seat
                    break
        if target is None:
            return None, "満席です"
        target.kind = "human"
        target.name = (name or "Player").strip()[:20] or "Player"
        target.avatar = avatar or ""
        target.token = secrets.token_hex(8)
        target.connected = True
        target.last_seen = time.time()
        target.level = "normal"
        room.last_active = time.time()
        return target, ""


def seat_by_token(room: Room, token: Optional[str]) -> Optional[Seat]:
    if not token:
        return None
    for seat in room.seats:
        if seat.token == token:
            return seat
    return None


def lan_ips() -> List[str]:
    """この機械の LAN の IPv4（127.x は除く）。参加用 URL の表示に使う。"""
    import socket
    ips = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except Exception:
        pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        if not ip.startswith("127.") and ip not in ips:
            ips.insert(0, ip)
    except Exception:
        pass
    def _私用(ip):
        return ip.startswith("192.168.") or ip.startswith("10.") or any(ip.startswith("172.%d." % n) for n in range(16, 32))
    ips.sort(key=lambda ip: (0 if _私用(ip) else 1))
    return ips


def _phase_of(room: Room) -> str:
    if room.game is None:
        return "setup"
    if room.game_over:
        return "game_end"
    g = room.game
    if len(getattr(g, "finished", [])) >= room.seat_count or getattr(g, "phase", "") == "round_end":
        return "round_end"
    return getattr(g, "phase", "play")


def public_info(room: Room) -> Dict[str, Any]:
    """部屋の公開情報（設計書 02 の GET /api/room/{code}。手札は無い）。"""
    with room.lock:
        return {
            "code": room.code,
            "seat_count": room.seat_count,
            "phase": _phase_of(room),
            "seats": [{"index": s.index, "name": s.name, "kind": s.kind, "connected": _connected(s)} for s in room.seats],
            "host": 0,
            "settings": room.settings.to_dict(),
            "round": room.round_no,
        }


def set_rules(room: Room, d: Dict, seat_count: Optional[int] = None):
    """【追加要件 7】部屋を作った人が開始前（またはラウンドの間）にルールを変える。戻り値 (ok, 理由)。"""
    with room.lock:
        if room.game is not None and _phase_of(room) not in ("round_end", "game_end"):
            return False, "対戦中はルールを変えられません"
        merged = room.settings.to_dict()
        merged.update({k: v for k, v in (d or {}).items()})
        room.settings = RuleSettings.from_dict(merged)
        if seat_count is not None and room.game is None:
            try:
                n = int(seat_count)
            except (TypeError, ValueError):
                n = room.seat_count
            humans = [s for s in room.seats if s.kind == "human"]
            if 2 <= n <= 6 and n >= len(humans):
                keep = sorted(humans, key=lambda s: s.index)
                for i, s in enumerate(keep):
                    s.index = i
                room.seats = _make_cpu_seats(keep, n, room.settings.cpu_level)
                room.seat_count = n
        for s in room.seats:
            if s.kind == "cpu":
                s.level = room.settings.cpu_level
        room.last_active = time.time()
        return True, ""


def set_settings(host_token: str, d: Dict) -> bool:
    with _LOCK:
        rooms = list(_ROOMS.values())
    for room in rooms:
        if room.host_token == host_token:
            ok, _ = set_rules(room, d)
            return ok
    return False

def set_seat(host_token: str, index: int, kind: str, level: str, ai_key_name: Optional[str] = None) -> bool:
    with _LOCK:
        rooms = list(_ROOMS.values())
    for room in rooms:
        if room.host_token == host_token:
            with room.lock:
                if 0 <= index < len(room.seats):
                    seat = room.seats[index]
                    seat.kind = kind
                    seat.level = level
                    seat.ai_key_name = ai_key_name
                    if kind == "cpu" and seat.token is not None:
                        seat.token = None
                    return True
    return False


def _touch_turn(room: Room):
    """手番（または待ち）が変わったら時刻を取り直す（持ち時間に使う）。"""
    g = room.game
    if g is None:
        return
    key = (g.turn, getattr(g, "phase", None), (g.awaiting or {}).get("type"), len(getattr(g, "events", [])))
    if key != room.turn_key:
        room.turn_key = key
        room.turn_since = time.time()


def _run_cpu(room: Room):
    """いまの手番（待ちを含む）が CPU なら、人間の番か終わりまで進める。"""
    g = room.game
    if g is None:
        return
    guard = 0
    while guard < 200:
        guard += 1
        if len(getattr(g, "finished", [])) >= room.seat_count or getattr(g, "phase", "") == "round_end":
            break
        a = g.awaiting
        if a is not None:
            seat = a.get("seat")
            if seat is None or seat >= len(room.seats) or room.seats[seat].kind != "cpu":
                break
            if not g.auto_resolve(seat):
                break
            continue
        if getattr(g, "phase", "") != "play":
            break
        t = g.turn
        if t is None or not (0 <= t < len(room.seats)) or room.seats[t].kind != "cpu":
            break
        if t in g.finished:
            g._skip_eliminated()
            continue
        process_cpu_turn(room, t, depth=0, chain=False)
    _touch_turn(room)


def start(host_token: str) -> Optional[Dict[str, Any]]:
    """ゲームを開始。round_end なら次のラウンド（前の順位を引き継ぐ）、game_end なら新しいゲーム。対戦中は始め直さない。"""
    with _LOCK:
        room = None
        for r in _ROOMS.values():
            if r.host_token == host_token:
                room = r
                break
    if not room:
        return None
    with room.lock:
        phase = _phase_of(room)
        if room.game is not None and phase in ("play", "exchange", "mulligan"):
            return None
        for seat in room.seats:
            if seat.kind == "empty":
                seat.kind = "cpu"
                seat.name = f"CPU{seat.index}"
            if seat.kind == "cpu":
                seat.level = room.settings.cpu_level
        previous = None
        if room.game is not None and phase == "round_end":
            _maybe_settle(room)
            previous = room.last_ranks
            if room.game_over:
                phase = "game_end"
        if room.game is None or phase == "game_end":
            room.round_no = 0
            room.scores = {}
            room.history = []
            room.last_ranks = None
            room.settled_round = 0
            room.game_over = False
            previous = None
        room.game = Game(room.settings, room.seat_count, previous_ranks=previous)
        room.game.start()
        room.round_no += 1
        room.last_active = time.time()
        room.turn_key = None
        _touch_turn(room)
        _run_cpu(room)
        _maybe_settle(room)
        return _build_state(room, host_token)


def _maybe_settle(room: Room):
    """ラウンドが終わっていて、まだ点を足していなければ足す（称号・点は 01 §6）。"""
    g = room.game
    if g is None:
        return
    if len(getattr(g, "finished", [])) < room.seat_count and getattr(g, "phase", "") != "round_end":
        return
    if room.settled_round == room.round_no:
        return
    room.settled_round = room.round_no
    ranks = g.ranks()
    pts = g.points()
    for seat, p in pts.items():
        room.scores[seat] = room.scores.get(seat, 0) + p
    room.last_ranks = ranks
    room.history.append({"round": room.round_no, "ranks": ranks, "points": pts, "titles": g.titles()})
    if room.round_no >= max(1, int(getattr(room.settings, "rounds", 3) or 1)):
        room.game_over = True


def enforce_timeout(room: Room):
    """持ち時間（01 §7）：人間の手番（待ちを含む）が turn_seconds を超えたら自動の手。"""
    g = room.game
    if g is None:
        return
    secs = int(getattr(room.settings, "turn_seconds", 0) or 0)
    if secs <= 0:
        return
    _touch_turn(room)
    if len(getattr(g, "finished", [])) >= room.seat_count or getattr(g, "phase", "") == "round_end":
        return
    seat = (g.awaiting or {}).get("seat", g.turn) if g.awaiting else g.turn
    if seat is None or not (0 <= seat < len(room.seats)) or room.seats[seat].kind != "human":
        return
    if time.time() - room.turn_since <= secs:
        return
    try:
        if g.awaiting:
            ok = g.auto_resolve(seat)
        else:
            ok = g.timeout()
        if ok:
            g.events.append(("timeout", seat))
            _run_cpu(room)
    except Exception:
        pass
    _maybe_settle(room)
    _touch_turn(room)


def cleanup(idle_seconds: int = 3600):
    now = time.time()
    with _LOCK:
        to_delete = [code for code, room in _ROOMS.items() if now - room.last_active > idle_seconds]
        for code in to_delete:
            del _ROOMS[code]


def touch(room: Room, token: Optional[str]) -> None:
    """状態を読んだ席の last_seen を更新（5 秒読まなければ「切断」と見なす）。"""
    if not token:
        return
    now = time.time()
    for seat in room.seats:
        if seat.kind == "human" and seat.token == token:
            seat.last_seen = now
            seat.connected = True
    room.last_active = now


def _connected(seat: Seat) -> bool:
    if seat.kind != "human":
        return True
    if not seat.last_seen:
        return bool(seat.connected)
    return (time.time() - seat.last_seen) < 5.0


_マーク = {"S": "♠", "H": "♥", "D": "♦", "C": "♣"}


def _札の表記(c: str) -> str:
    if str(c).startswith("X"):
        return "JOKER"
    return _マーク.get(c[0], c[0]) + c[1:]


def _実況の文(room: "Room", game) -> List[str]:
    名 = {s.index: s.name for s in room.seats}
    def N(i):
        return 名.get(i, "席%s" % i)
    出 = []
    for ev in list(getattr(game, "events", []) or [])[-30:]:
        k = ev[0]
        if k == "play":
            出.append("%s が %s を出した" % (N(ev[1]), " ".join(_札の表記(c) for c in ev[2])))
        elif k == "pass":
            出.append("%s がパス" % N(ev[1]))
        elif k == "flow":
            reason = ev[1] if len(ev) > 1 else ""
            if reason == "eight":
                出.append("8切り！場が流れた")
            elif reason == "spade3":
                出.append("スペ3返し！場が流れた")
            else:
                出.append("場が流れた")
        elif k == "win":
            r = ev[2]
            if r >= room.seat_count:
                出.append("%s が最下位" % N(ev[1]))
            else:
                出.append("%s が上がった（%d 位）" % (N(ev[1]), r))
        elif k == "revolution":
            出.append("革命！" if ev[2] else "革命返し！")
        elif k == "eleven_back":
            出.append("11バック！強さが逆転")
        elif k == "lock":
            出.append("しばり！（%s）" % ("スート" if ev[2] == "suit" else "数字"))
        elif k == "reverse":
            出.append("リバース！順番が逆回り")
        elif k == "skip":
            出.append("スキップ！%d 人飛ばし" % ev[2])
        elif k == "give":
            出.append("7渡し：%s が %s へ %d 枚" % (N(ev[1]), N(ev[2]), ev[3]))
        elif k == "discard":
            出.append("10捨て：%s が %d 枚捨てた" % (N(ev[1]), ev[2]))
        elif k == "bomb":
            出.append("12ボンバー！%s が %s を消した（%d 枚）" % (N(ev[1]), "・".join(ev[2]) if ev[2] else "何も", ev[3]))
        elif k == "foul":
            出.append("%s は禁止あがり！最下位側へ" % N(ev[1]))
        elif k == "capital_fall":
            出.append("%s は都落ち！" % N(ev[1]))
        elif k == "exchange":
            出.append("カード交換：%s → %s に %d 枚" % (N(ev[1]), N(ev[2]), ev[3]))
        elif k == "exchange_back":
            出.append("カード交換：%s → %s に %d 枚返した" % (N(ev[1]), N(ev[2]), ev[3]))
        elif k == "exchange_done":
            出.append("カード交換が終わった")
        elif k == "timeout":
            出.append("%s は時間切れ（自動）" % N(ev[1]))
    return 出


def _me_index(room: Room, token: Optional[str]) -> Optional[int]:
    if token:
        for i, seat in enumerate(room.seats):
            if seat.kind == "human" and seat.token == token:
                return i
    for i, seat in enumerate(room.seats):
        if seat.kind == "human":
            return i
    return None


def _field_info(game) -> Dict[str, Any]:
    f = getattr(game, "field", None)
    if f is None:
        return {"cards": [], "empty": True}
    cards = []
    last = []
    for move in (f.history or []):
        if move and move.cards:
            cards.extend(move.cards)
            last = list(move.cards)
    return {
        "cards": cards, "empty": len(cards) == 0, "last": last,
        "revolution": bool(getattr(f, "revolution", False)),
        "eleven_back": bool(getattr(f, "eleven_back", False)),
        "inverted": bool(f.inverted()) if hasattr(f, "inverted") else False,
        "suit_lock": sorted(list(f.suit_lock)) if getattr(f, "suit_lock", None) else None,
        "rank_lock": getattr(f, "rank_lock", None),
        "reverse": bool(getattr(f, "reverse", False)),
        "top_kind": getattr(f.top, "kind", None) if getattr(f, "top", None) else None,
        "top_count": getattr(f.top, "count", None) if getattr(f, "top", None) else None,
    }


def _build_state(room: Room, token: Optional[str] = None) -> Dict[str, Any]:
    """現在の状態を辞書として構築（設計書 05 §2-5 の形式＋追加要件の項目）。
    token で自分の席を決め、手札（cards）は自分の席にだけ入れる。"""
    me_index = _me_index(room, token)
    base = {
        "code": room.code,
        "me": me_index,
        "seat_count": room.seat_count,
        "host": 0,
        "round": room.round_no,
        "rounds": int(getattr(room.settings, "rounds", 3) or 1),
        "settings": room.settings.to_dict(),
        "scores": {str(i): room.scores.get(i, 0) for i in range(room.seat_count)},
        "history": room.history[-10:],
    }
    if not room.game:
        base.update({
            "phase": "setup", "turn": None,
            "seats": [{"index": s.index, "name": s.name, "kind": s.kind,
                       "level": s.level if s.kind == "cpu" else None,
                       "connected": _connected(s), "count": 0, "cards": [], "is_me": (s.index == me_index)}
                      for s in room.seats],
            "field": {"cards": [], "empty": True}, "legal": [], "can_pass": False, "log": [], "ranks": [],
            "awaiting": None, "passed": [],
        })
        return base

    game = room.game
    turn = game.turn
    phase = _phase_of(room)
    seats_data = []
    for i, seat in enumerate(room.seats):
        hand = game.hands[i] if game.hands else []
        is_me = (i == me_index)
        seats_data.append({
            "index": i, "name": seat.name, "kind": seat.kind,
            "level": seat.level if seat.kind == "cpu" else None,
            "connected": _connected(seat),
            "count": len(hand), "cards": list(hand) if is_me else [],
            "is_me": is_me,
            "out": game.out.get(i),
        })
    awaiting = dict(game.awaiting) if game.awaiting else None
    legal = []
    can_pass = False
    if phase == "play" and turn is not None and me_index == turn and awaiting is None:
        for m in game.legal_for(turn):
            legal.append({"cards": m.cards, "kind": m.kind, "label": getattr(m, 'label', str(m.cards)), "joker_as": dict(m.joker_as or {})})
        can_pass = game.can_pass(turn)
    ranks = game.ranks() if phase in ("round_end", "game_end") else []
    secs = int(getattr(room.settings, "turn_seconds", 0) or 0)
    remaining = None
    if secs > 0 and phase in ("play", "exchange") and room.turn_since:
        remaining = max(0, int(secs - (time.time() - room.turn_since)))
    base.update({
        "phase": phase, "turn": turn, "seats": seats_data,
        "field": _field_info(game),
        "legal": legal, "can_pass": can_pass,
        "log": _実況の文(room, game),
        "ranks": ranks,
        "titles": {str(k): v for k, v in game.titles().items()} if ranks else {},
        "awaiting": awaiting,
        "passed": sorted(list(getattr(game, "passed_seats", set()) or [])),
        "turn_seconds": secs, "remaining": remaining,
        "game_over": bool(room.game_over),
    })
    return base


def process_cpu_turn(room: Room, seat_index: int, depth: int = 0, chain: bool = True):
    """CPU の手番を処理。chain=True なら次の CPU の手番も続けて処理する（最大 50 回）。待ちは自動で解決。"""
    if depth > 50:
        return
    game = room.game
    if not game or seat_index is None:
        return
    if len(getattr(game, 'finished', [])) >= room.seat_count or getattr(game, "phase", "") == "round_end":
        return
    if seat_index < 0 or seat_index >= len(room.seats):
        return
    if game.awaiting is not None:
        a_seat = game.awaiting.get("seat")
        if a_seat is not None and room.seats[a_seat].kind == "cpu":
            game.auto_resolve(a_seat)
        else:
            return
    if getattr(game, "phase", "") != "play":
        return
    if seat_index in getattr(game, 'finished', []):
        return
    seat = room.seats[seat_index]
    if seat.kind != "cpu" or game.turn != seat_index:
        return
    view = view_for_cpu(game, seat_index)
    legal_moves = game.legal_for(seat_index)
    if not legal_moves:
        if not game.pass_(seat_index):
            game.timeout()
    else:
        cpu = make_cpu(seat.level, game.rng)
        from daifugo.cpu import safe_choose_move
        move = safe_choose_move(cpu, view, legal_moves)
        if move is None:
            move = legal_moves[game.rng.randint(0, len(legal_moves) - 1)]
        if move:
            game.play(move.cards, seat_index, joker_as=dict(move.joker_as or {}) or None)
        else:
            game.pass_(seat_index)
    while game.awaiting is not None and room.seats[game.awaiting.get("seat", 0)].kind == "cpu":
        if not game.auto_resolve(game.awaiting.get("seat")):
            break
    _touch_turn(room)
    if not chain:
        return
    if len(getattr(game, 'finished', [])) >= room.seat_count or getattr(game, "phase", "") != "play":
        return
    if game.turn is None or not (0 <= game.turn < len(room.seats)):
        return
    if game.awaiting is not None:
        return
    if room.seats[game.turn].kind == "cpu":
        process_cpu_turn(room, game.turn, depth + 1)
