"""ノーマル CP（設計書 04 §3）：素直で少し抜けている。"""
from __future__ import annotations

from collections import Counter

from daifugo.cards import parse, is_joker
from daifugo.moves import TYPE_SEQUENCE
from daifugo.cpu.base import CpuPlayer


def _rank_order(name: str) -> int:
    """2 が最弱 → A が最強。"""
    p = parse(name)
    return p[1]


class NormalCpu(CpuPlayer):
    level = "normal"

    def choose_move(self, view, legal):
        legal = list(legal)
        if not legal:
            return None
        empty = self._field_empty(view)
        hand = self._my_cards(view)
        count = self._my_count(view)

        if empty:
            cands = [m for m in legal if m.kind != TYPE_SEQUENCE]
            if not cands:
                cands = legal
            # 2 枚組を割らない：手札に 3 枚以上の同 rank があるとき、その rank の 2 枚組は避ける
            rc = Counter(_rank_order(c) for c in hand)
            def breaks_group(m):
                r = _rank_order(m.cards[0])
                return rc.get(r, 0) >= 3 and len(m.cards) == 2
            kept = [m for m in cands if not breaks_group(m)]
            pool = kept if kept else cands
            # 階段は 50% の確率で出す
            seqs = [m for m in pool if m.kind == TYPE_SEQUENCE]
            nonseq = [m for m in pool if m.kind != TYPE_SEQUENCE]
            if seqs and nonseq and self.rng.random() >= 0.5:
                pool = nonseq
            return min(pool, key=lambda m: (_rank_order(m.cards[0]), len(m.cards)))

        # 場あり：いちばん弱い手。ただし 2 とジョーカーは残り 3 枚以下まで使わない
        def is_hold(m):
            return any(is_joker(c) or _rank_order(c) == 2 for c in m.cards)
        non_hold = [m for m in legal if not is_hold(m)]
        if not non_hold:
            # 出せる手が温存札だけ → 残り 3 枚以下なら出す、それ以外は 70% でパス
            if count > 3 and self.rng.random() < 0.7:
                return None
            return min(legal, key=lambda m: (_rank_order(m.cards[0]), len(m.cards)))
        return min(non_hold, key=lambda m: (_rank_order(m.cards[0]), len(m.cards)))

    def choose_mulligan(self, view, max_n):
        """ペアにならない弱い単体（6 未満の数字だけ）を弱い順に最大 N 枚。"""
        hand = self._my_cards(view)
        rc = Counter(_rank_order(c) for c in hand)
        singles = [c for c in hand if rc[_rank_order(c)] == 1 and 3 <= _rank_order(c) <= 5]
        singles.sort(key=_rank_order)
        return singles[:max_n]

    def choose_exchange_back(self, view, n):
        return sorted(self._my_cards(view), key=_rank_order)[:n]

    def choose_give(self, view, n):
        return sorted(self._my_cards(view), key=_rank_order)[:n]

    def choose_discard(self, view, n):
        return sorted(self._my_cards(view), key=_rank_order)[:n]
