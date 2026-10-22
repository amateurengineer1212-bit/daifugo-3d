"""ハード CP（設計書 04 §4）：点数で手を選ぶ。

- 基本：弱い札から処分する（手の rank が低いほど ＋）
- 組を崩さない：出すと残りのペア・3 枚組・階段が崩れる手は −
- 温存：2・ジョーカー・A は残り枚数が多いうちは −。残り 1〜3 枚で出し切れる道筋なら ＋＋
- 8 切り：残りが多く場を取り返したいとき ＋。残り少なく上がれそうなときは 8 を先に処分 ＋
- 革命：手札が低い数字に偏っていれば ＋、高い数字に偏っていれば −
- 11 バック：いま自分の低い札が多ければ ＋
- 場の支配：次の人の残り枚数が少ない（≤3）とき、強い手を出す ＋
- パス：温存札しか出せず場を取っても意味が薄い（自分の残りが多い）ならパス
- 禁止上がり：最後の手に反則札（8 切り・11 バック）が入る手は選ばない
- しばり：相手の手が多いときはしばりを掛けると場を取りやすい ＋
"""
from __future__ import annotations

from collections import Counter

from daifugo.cards import parse, is_joker
from daifugo.moves import TYPE_SINGLE, TYPE_GROUP, TYPE_SEQUENCE
from daifugo.cpu.base import CpuPlayer


def _rank(name: str) -> int:
    """2 が最弱 → A が最強。ジョーカーは 1（最弱扱い）。"""
    if is_joker(name):
        return 1
    return parse(name)[1]


def _suit(name: str) -> str:
    if is_joker(name):
        return ''
    return parse(name)[0]


class HardCpu(CpuPlayer):
    level = "hard"

    def choose_move(self, view, legal):
        legal = list(legal)
        if not legal:
            return None
        hand = self._my_cards(view)
        count = self._my_count(view)
        next_count = view.get("next_remaining", 10)
        field_cards = (view.get("field") or {}).get("cards") or []
        field_empty = not field_cards

        best = None
        best_score = float("-inf")
        for m in legal:
            s = self._score(m, hand, count, next_count, field_empty)
            if s > best_score:
                best_score = s
                best = m
        return best

    def _score(self, m, hand, count, next_count, field_empty):
        s = 0.0
        cards = list(m.cards)
        ranks = [_rank(c) for c in cards]
        low = min(ranks)

        # 基本：弱い札から処分する（手の rank が低いほど ＋）
        s += (14 - low) * 1.5

        # 組を崩さない：出すと残りのペア・3 枚組が崩れる手は −
        rc = Counter(_rank(c) for c in hand)
        for r in set(ranks):
            if rc.get(r, 0) >= 3:
                s -= 8.0
            elif rc.get(r, 0) == 2 and len(cards) == 1:
                s -= 4.0

        # 温存：2・ジョーカー・A は残り枚数が多いうちは −
        for c in cards:
            r = _rank(c)
            if is_joker(c) or r == 2:
                if count > 3:
                    s -= 12.0
            elif r >= 14 and count > 3:
                s -= 6.0

        # 残り 1〜3 枚で出し切れる道筋（最後の 1 手で出し切れる）なら ＋＋
        if count - len(cards) <= 2:
            s += 40.0

        # 8 切り
        if TYPE_SINGLE and ranks == [8]:
            if count > 5:
                s += 10.0  # 残りが多い：場を取り返す
            elif count <= 3:
                s -= 20.0  # 残り少ない：8 で上がると反則なので先に処分

        # 革命：手札が低い数字に偏っていれば ＋
        if ranks:
            avg = sum(r for r in ranks if r > 1) / max(1, len([r for r in ranks if r > 1]))
            if avg < 8:
                s += 5.0
            else:
                s -= 3.0

        # 11 バック：いま自分の低い札が多ければ ＋
        if ranks and 11 in ranks:
            low_cards = [r for r in ranks if r <= 6]
            if len(low_cards) >= len(ranks) / 2:
                s += 6.0

        # 場の支配：次の人の残り枚数が少ない（≤3）とき、強い手を出す ＋
        if next_count <= 3 and not field_empty:
            s += (low - 8) * 2.0

        # パス：温存札しか出せず場を取っても意味が薄い（自分の残りが多い）ならパス
        if field_empty is False and count > 6:
            if all(is_joker(c) or _rank(c) == 2 for c in cards):
                s -= 15.0

        # 禁止上がり：最後の手に反則札（8 切り・11 バック）が入る手は選ばない
        if count - len(cards) == 0:
            if ranks == [8]:
                s -= 100.0
            if 11 in ranks and len(ranks) == 1:
                s -= 60.0

        # しばり：相手の手が多いときはしばりを掛けると場を取りやすい ＋
        if next_count >= 8 and len(cards) >= 2:
            s += 4.0

        return s

    def choose_mulligan(self, view, max_n):
        """ペアにならない 3〜7 の単体から最大 N 枚（♦3 など先手の札・8 は残す）。"""
        hand = self._my_cards(view)
        rc = Counter(_rank(c) for c in hand)
        cands = [c for c in hand
                 if rc[_rank(c)] == 1
                 and 3 <= _rank(c) <= 7
                 and c != 'D3']
        cands.sort(key=_rank)
        return cands[:max_n]

    def choose_exchange_back(self, view, n):
        """ペアにならない弱い単体を弱い順に n 枚。"""
        hand = self._my_cards(view)
        rc = Counter(_rank(c) for c in hand)
        singles = [c for c in hand if rc[_rank(c)] == 1]
        singles.sort(key=_rank)
        return singles[:n]

    def choose_give(self, view, n):
        return sorted(self._my_cards(view), key=_rank)[:n]

    def choose_discard(self, view, n):
        return sorted(self._my_cards(view), key=_rank)[:n]
