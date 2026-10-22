"""CpuPlayer の共通（設計書 04 §2）。"""
from __future__ import annotations

import random
from typing import List, Optional

from daifugo.cards import parse
from daifugo.moves import Move


class CpuPlayer:
    """CP の共通基底（設計書 04 §2）。view（dict）から打つ。他人の手札は view に入らない。"""

    level: str = 'base'

    def __init__(self, rng: Optional[random.Random] = None) -> None:
        self.rng = rng or random.Random()
        self.level = type(self).level

    # ---- 共通ユーティリティ（view から引く）----

    def _my_cards(self, view: dict) -> List[str]:
        return list(view.get("my_cards", []))

    def _my_count(self, view: dict) -> int:
        return len(self._my_cards(view))

    def _field_empty(self, view: dict) -> bool:
        f = view.get("field")
        return not f or not f.get("cards")

    def _random_move(self, legal: List[Move]) -> Move:
        """合法手から 1 つ選ぶ。"""
        return self.rng.choice(legal)

    # ---- 設計書 04 §2 の 5 メソッド（デフォルト実装）----

    def choose_move(self, view: dict, legal) -> Optional[Move]:
        """次の手を選ぶ。legal が空なら None（場が空のときは None を返してはいけない）。"""
        legal = list(legal)
        if not legal:
            return None
        return self._random_move(legal)

    def choose_mulligan(self, view: dict, max_n: int) -> List[str]:
        """マリガンで戻す札（0〜max_n 枚）。"""
        return []

    def choose_exchange_back(self, view: dict, n: int) -> List[str]:
        """交換で返す札 n 枚。"""
        return []

    def choose_give(self, view: dict, n: int) -> List[str]:
        """7 の渡しで渡す札。"""
        return []

    def choose_discard(self, view: dict, n: int) -> List[str]:
        """10 の捨てで捨てる札。"""
        return []


def safe_choose_move(cpu: CpuPlayer, view: dict, legal: list[Move],
                     fallback: Optional[CpuPlayer] = None) -> Optional[Move]:
    """例外・不正ならノーマル（または指定のフォールバック）で代打（設計書 04 §1）。"""
    try:
        m = cpu.choose_move(view, legal)
        if m is None or m in legal:
            return m
    except Exception:
        pass
    fb = fallback if fallback is not None else CpuPlayer.__subclasses__()[0]()
    try:
        return fb.choose_move(view, legal)
    except Exception:
        return None


def make_cpu(level, rng):  # -> CpuPlayer
    """level 名から CpuPlayer を作る（設計書 04 §2）。hard/dangerous は遅延 import。"""
    rng = rng if rng is not None else random.Random()
    if level == "normal":
        from daifugo.cpu.normal import NormalCpu
        return NormalCpu(rng)
    if level == "hard":
        from daifugo.cpu.hard import HardCpu
        return HardCpu(rng)
    if level == "dangerous":
        from daifugo.cpu.dangerous import DangerousCpu
        return DangerousCpu(rng)
    from daifugo.cpu.normal import NormalCpu
    return NormalCpu(rng)
