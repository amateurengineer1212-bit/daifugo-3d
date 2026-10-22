"""デンジャラス CP（設計書 04 §5）：ハードを方策にしたモンテカルロ。

T06 の段階では「ハードを継承し time_budget を持つ」最小実装として
import 可能・例外ゼロ・legal_moves の中から打つ、ことを保証する。
モンテカルロの詳細（見えない札の配り直し・カード計数・候補1つなら即決）は
T09 で強化する。
"""
from __future__ import annotations

from .hard import HardCpu


class DangerousCpu(HardCpu):
    """ハードを継承した CP。time_budget 秒以内の判断を目指す。"""

    def __init__(self, rng, time_budget: float = 0.2):
        super().__init__(rng)
        self.time_budget = time_budget
