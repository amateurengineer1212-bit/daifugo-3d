"""場の管理：出されたカードの記録と状態管理"""

from __future__ import annotations
from collections import deque
from daifugo.moves import classify, beats, TYPE_SINGLE, TYPE_GROUP, TYPE_SEQUENCE, Move


def _suits_of(move) -> frozenset:
    """手のスートの組（ジョーカーは数えない。割り当て済みのジョーカーもスートには数えない）。"""
    from daifugo.cards import parse, is_joker
    out = set()
    for c in getattr(move, "cards", []) or []:
        if is_joker(c):
            continue
        out.add(parse(c)[0])
    return frozenset(out)


class Field:
    """
    場の状態を管理するクラス。
    現在のカード、出したプレイヤー、履歴を保持する。
    """
    
    def __init__(self, cards: list = None, revolution: bool = False, suit_lock: frozenset = None, rank_lock: int = None, eleven_back: bool = False, reverse: bool = False):
        self.top: Move | None = None  # 場に出ている最新の Move
        self.history: list[Move] = []  # この場で出た順の Move リスト
        self.revolution: bool = revolution  # ラウンド中ずっと続く革命状態
        self.eleven_back: bool = eleven_back  # 場が流れるまで続く 11 バック状態
        self.suit_lock: frozenset | None = suit_lock  # スートしばり（None なら無効）
        self.rank_lock: int | None = rank_lock  # 数字しばり（None なら無効）
        self.reverse: bool = reverse  # 9 リバース・場が流れるまで
        self.last_player: int | None = None  # 最後に出したプレイヤー ID
        self.流れた札: list = []  # 【Claude 2026-10-19 P19】このラウンドで流れた場の札（card_census の「場の履歴」に数える。05 G23）
        
        # 初期カードが渡された場合、場に出ているカードとして設定
        if cards:
            from daifugo.moves import Move, classify
            for card in cards:
                move = classify([card], {}, None)
                if move:
                    self.history.append(move)
                    self.top = move
    
    def after_play(self, move: Move, settings) -> None:
        """
        カードを出した後の処理（01 §5-2 の縛り）。革命・11バック・9リバースの更新は game 側で行う。
        【Claude 2026-10-22】スートしばり：同じスート（の組）の手が 2 回続いたら、その場が流れるまで同じスート（の組）だけ。
        数字しばり：連続する数字の手が 2 回続いたら（反転中は逆向き）、以後は次の数字だけ（single／group のみ）。
        これまでは「group を出すたびに数字しばり」になっていた（設計書と違う）。
        """
        if move is None:
            return
        prev = self.top
        self.top = move
        self.history.append(move)
        g = settings.get if hasattr(settings, "get") else (lambda k, d=None: getattr(settings, k, d))
        if prev is not None and prev.kind == move.kind:
            if g("suit_lock", True) and self.suit_lock is None:
                ps, ms = _suits_of(prev), _suits_of(move)
                if ps and ms and ps == ms:
                    self.suit_lock = ms
                    self.lock_started = len(self.history)
            if g("rank_lock", False) and self.rank_lock is None and move.kind in (TYPE_SINGLE, TYPE_GROUP):
                pr, mr = getattr(prev, "rank", None), getattr(move, "rank", None)
                if pr is not None and mr is not None and pr != 16 and mr != 16:
                    step = -1 if self.inverted() else 1
                    if mr == pr + step:
                        self.rank_lock = mr
                        self.rank_lock_started = len(self.history)

    def clear(self) -> None:
        """
        場を空にする（全員パスなどで場が流れたとき）。
        top/history/eleven_back/しばり/reverse を消す。revolution は残す。
        【Claude 2026-10-19 P19】流れた札は捨てずに 流れた札 へ移す（これまでは履歴ごと消え、card_census から消えていた）。
        """
        for move in self.history:
            if move is not None and getattr(move, "cards", None):
                self.流れた札.extend(move.cards)
        self.top = None
        self.history = []
        self.eleven_back = False
        self.suit_lock = None
        self.rank_lock = None
        self.reverse = False
        self.last_player = None
        self.lock_started = None
        self.rank_lock_started = None

    def inverted(self) -> bool:
        """
        反転中かどうかを返す。
        反転 = revolution XOR eleven_back
        """
        return self.revolution ^ self.eleven_back

    def is_empty(self) -> bool:
        """場が空かどうか"""
        return self.top is None
