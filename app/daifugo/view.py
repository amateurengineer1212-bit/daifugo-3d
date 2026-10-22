"""各席から見える状態を dict にする（他人の手札は隠す）。設計書 02 §2。"""
from __future__ import annotations

from daifugo.cards import label

_LOG_TAIL = 30


def _fmt_move(m) -> dict:
    """Move を表示用 dict に（legal の 1 件）。"""
    return {
        "cards": list(m.cards),
        "joker_as": m.joker_as,
        "kind": m.kind,
        "label": " ".join(label(c) for c in m.cards),
    }


def _fmt_field(game) -> dict:
    """場の状態（field）。"""
    field = getattr(game, "field", None)
    last = None
    if field is not None:
        last = getattr(field, "last", None)
        if last is None and isinstance(field, dict):
            last = field.get("last")
    return {
        "empty": last is None,
        "last": _fmt_move(last) if last is not None else None,
        "reversed": bool(getattr(field, "reversed", False)),
    }


def _fmt_seats(game, seat, room) -> list:
    """各席の表示（自分の手札だけ中身、他人は枚数）。"""
    hands = game.hands
    room_seats = {}
    if room and isinstance(room.get("seats"), list):
        for s in room["seats"]:
            room_seats[s.get("index")] = s
    seats = []
    for i in range(game.seat_count):
        mine = i == seat
        info = room_seats.get(i, {})
        seats.append({
            "index": i,
            "name": info.get("name", f"Player {i}"),
            "icon": info.get("icon"),
            "kind": info.get("kind", "human"),
            "count": len(hands[i]),
            "cards": list(hands[i]) if mine else [],
            "is_me": mine,
            "passing": i in getattr(game, "passed_seats", set()),
            "finished_order": (
                getattr(game, "finished", []).index(i)
                if i in getattr(game, "finished", []) else None
            ),
        })
    return seats


def _fmt_log(game) -> list:
    """log の末尾 30 件。"""
    log = getattr(game, "log", None)
    if log is None:
        log = getattr(game, "history", [])
    return list(log[-_LOG_TAIL:])


def _fmt_settings(game) -> dict:
    settings = getattr(game, "settings", None)
    if hasattr(settings, "get") and isinstance(settings, dict):
        return dict(settings)
    return {}


def view_for(game, seat: int, room: dict | None = None) -> dict:
    """その席から見える状態。自分の手札だけ中身、他人は枚数。"""
    legal = []
    can_pass = False
    if seat == game.turn:
        legal = [_fmt_move(m) for m in game.legal_for(seat)]
        can_pass = bool(game.can_pass(seat))
    return {
        "seat": seat,
        "seats": _fmt_seats(game, seat, room),
        "turn": game.turn,
        "phase": getattr(game, "phase", "play"),
        "awaiting": getattr(game, "awaiting", None),
        "timer": getattr(game, "timer", None),
        "field": _fmt_field(game),
        "legal": legal,
        "can_pass": can_pass,
        "log": _fmt_log(game),
        "settings": _fmt_settings(game),
        "version": getattr(game, "version", 0),
    }


def view_for_cpu(game, seat: int) -> dict:
    """CP／AI 用。view_for と同じ形＋history_all。他人の手札は入れない。"""
    d = view_for(game, seat, None)
    d["history_all"] = list(getattr(game, "history", []))
    return d
