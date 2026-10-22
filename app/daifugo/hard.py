"""ハードレベルの CPU（設計書 02 §2・04 §2 に基づく）"""

from typing import Any
from daifugo.cards import get_rank, is_joker
from daifugo.moves import classify, TYPE_GROUP, TYPE_SEQUENCE, Move
from daifugo.cpu.base import BaseCPU


class CpuPlayer(BaseCPU):
    """ハードレベルの CPU。革命を狙い、禁止上がりを避ける。"""

    def __init__(self, player_id: int, level: str = 'hard'):
        super().__init__(player_id, level)
        self.level = level

    def choose_move(self, view: dict, legal: list[Move]) -> Move | None:
        """
        合法手から 1 つを選ぶ（またはパス）。
        設計書 04 §2 に基づく：
        - 革命判定：低い札が多いなら 4 枚 group を選ぶ。
        - 禁止上がり：最後の 1 枚が反則なら、他に手がある場合はそれを優先。
        """
        if not legal:
            return None  # パス

        my_hand = view.get('my_hand', [])
        field = view.get('field', {})
        revolution = field.get('revolution', False)
        forbid_win = view.get('settings', {}).get('forbid_win', False)

        # 1. 革命判定（低い札が多いなら 4 枚 group を選ぶ）
        # 手札のランク分布を数える
        ranks = [get_rank(c, revolution) for c in my_hand]
        rank_counts = {}
        for r in ranks:
            rank_counts[r] = rank_counts.get(r, 0) + 1

        # 4 枚以上の同じランクがあるか
        four_of_a_kind = None
        for rank, count in rank_counts.items():
            if count >= 4:
                # 4 枚の group を探す
                candidate_cards = [c for c in my_hand if get_rank(c, revolution) == rank]
                if len(candidate_cards) >= 4:
                    # 合法手に 4 枚 group があるか確認
                    for mv in legal:
                        if mv.kind == TYPE_GROUP and mv.count == 4:
                            # ランクが一致するか
                            mv_ranks = [get_rank(c, revolution) for c in mv.cards]
                            if len(set(mv_ranks)) == 1 and list(set(mv_ranks))[0] == rank:
                                four_of_a_kind = mv
                                break
                    if four_of_a_kind:
                        break

        # 2. 禁止上がり判定
        # 最後の 1 枚が反則になるか
        if forbid_win and len(my_hand) == 1:
            # 最後の 1 枚が反則なら、他に手がある場合は避ける
            # だが、他に手がないなら出すしかない
            # 反則判定：最後の 1 枚がジョーカーか、特定の条件
            last_card = my_hand[0]
            if is_joker(last_card):
                # ジョーカーは反則になる可能性
                # 他の手があるか（legal に他の手があるか）
                non_forbidden = [mv for mv in legal if not (len(mv.cards) == 1 and is_joker(mv.cards[0]))]
                if non_forbidden:
                    # 反則でない手を選ぶ
                    return non_forbidden[0]
                # 他に手がないなら出す
                return legal[0]

        # 3. 革命があるなら選ぶ
        if four_of_a_kind:
            return four_of_a_kind

        # 4. 通常の選択：最も弱い合法手（温存札を使わない）
        # 合法手をランクでソート
        def move_rank(mv: Move) -> int:
            if mv.kind == TYPE_GROUP:
                # 4 枚 group は強いので避ける
                return 999
            if mv.kind == TYPE_SEQUENCE:
                return 999
            # single：ランクでソート
            if mv.cards:
                return get_rank(mv.cards[0], revolution)
            return 999

        legal_sorted = sorted(legal, key=move_rank)
        return legal_sorted[0]

    def choose_mulligan(self, hand: list[str], max_n: int) -> list[str]:
        """マリガン：手札に無い札を返さない（設計書 04 §2）"""
        return []  # 簡易：何も返さない

    def choose_exchange_back(self, hand: list[str], n: int) -> list[str]:
        """交換で返す（設計書 04 §2）"""
        return hand[:n]

    def choose_give(self, hand: list[str], n: int) -> list[str]:
        """7 渡し：弱い札を渡す"""
        # 最も弱い n 枚を返す
        if not hand:
            return []
        revolution = False  # view が無いので簡易
        sorted_hand = sorted(hand, key=lambda c: get_rank(c, revolution))
        return sorted_hand[:n]

    def choose_discard(self, hand: list[str], n: int) -> list[str]:
        """10 捨て：弱い札を捨てる"""
        if not hand:
            return []
        revolution = False
        sorted_hand = sorted(hand, key=lambda c: get_rank(c, revolution))
        return sorted_hand[:n]
