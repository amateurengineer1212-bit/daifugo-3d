"""手の分類と強さ判定：single/group/sequence/pass、ジョーカーの割り当て、強さ比べ"""
from __future__ import annotations

from collections import Counter
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from daifugo.field import Field

from daifugo.cards import parse, get_rank, is_joker, SUITS

# 手の種類定数
TYPE_SINGLE = "single"
TYPE_GROUP = "group"
TYPE_SEQUENCE = "sequence"
TYPE_PASS = "pass"


class Move:
    """手の情報"""

    def __init__(self, kind: str, cards: list, joker_as: dict = None,
                 rank: int = None, low: int = None, high: int = None,
                 suits: frozenset = None, count: int = 1):
        self.kind = kind          # "single", "group", "sequence", "pass"
        self.cards = cards        # 出た札のリスト [card_id, ...]
        self.joker_as = joker_as or {}  # ジョーカーの割り当て {card_id: (suit, rank)}
        self.rank = rank          # group/singleの強さ（ランク）
        self.low = low            # sequenceの最小ランク
        self.high = high          # sequenceの最大ランク
        self.suits = suits        # sequence/groupのスート集合（ジョーカー除く）
        self.count = count        # 札の数

    def __repr__(self):
        return f"Move(kind={self.kind}, cards={self.cards}, rank={self.rank})"

    def __eq__(self, other):
        """Move との比較、または card_id 文字列との比較"""
        if isinstance(other, Move):
            return self.kind == other.kind and self.cards == other.cards
        if isinstance(other, str):
            # 単一のカード ID と比較（cards が 1 枚だけの場合）
            return self.count == 1 and self.cards == [other]
        return NotImplemented

    def __hash__(self):
        return hash((self.kind, tuple(self.cards)))


# 【Claude 2026-10-19 P11】ジョーカーだけの手とスペ3返しの判定（01 §2・§3・§5）
def ジョーカー1枚(move) -> bool:
    """手（または場の一番上）が「ジョーカー 1 枚（single）」か"""
    return (move is not None and getattr(move, "kind", None) == TYPE_SINGLE
            and len(getattr(move, "cards", None) or []) == 1 and is_joker(move.cards[0]))


def ジョーカーだけ(move) -> bool:
    """割り当ての無いジョーカーだけの手か（1 枚の single、2 枚の group）"""
    cards = getattr(move, "cards", None) or []
    joker_as = getattr(move, "joker_as", None) or {}
    return bool(cards) and all(is_joker(c) and c not in joker_as for c in cards)


def スペ3返しが有効(settings) -> bool:
    """スペ3返し（01 §5 spade3）が ON か。RuleSettings では joker_return（製品の名前のまま）、
    辞書では Game と同じく spade3_return（無ければ ON）か joker_return。設定が渡されなければ使わない。"""
    if settings is None:
        return False
    if isinstance(settings, dict):
        return bool(settings.get("spade3_return", True) or settings.get("joker_return", False))
    return bool(getattr(settings, "joker_return", False))


def classify(cards: list, joker_as: dict = None, settings: object = None) -> "Move | None":
    """
    札の集合を手に分類する。
    joker_as: {card_id: "H7"} のようにジョーカーをどの札として使うか指定
    settings: RuleSettings（sequence オフ判定用）

    不正な組は None を返す。
    """
    if not cards:
        return None

    if settings is None:
        settings = type("DummySettings", (), {"get": lambda s, k, d=None: d})()

    joker_as = joker_as if isinstance(joker_as, dict) else {}
    cards = list(cards)  # 不変性を保つためコピー

    # 【Claude 2026-10-19 P11】ジョーカーだけの手（01 §3：ジョーカー 1 枚も single、ジョーカーだけ 2 枚も group・rank 16）は、割り当てが無くてよい
    if all(is_joker(c) and c not in joker_as for c in cards):
        if len(cards) == 1:
            return Move(kind=TYPE_SINGLE, cards=cards, joker_as={}, rank=16, count=1)
        return Move(kind=TYPE_GROUP, cards=cards, joker_as={}, rank=16, suits=frozenset(), count=len(cards))

    # ジョーカーの割り当てを確認
    parsed = []
    for c in cards:
        suit, rank = parse(c)
        if is_joker(c):
            if c in joker_as:
                # ジョーカーの割り当てを使う
                assigned_suit, assigned_rank = parse(joker_as[c])
                if assigned_suit is None or assigned_rank is None:
                    return None  # 不正な割り当て
                parsed.append((assigned_suit, assigned_rank, c))
            else:
                # ジョーカーが割り当てされていない
                return None
        else:
            parsed.append((suit, rank, c))

    count = len(parsed)
    suits_set = frozenset(s for s, r, c in parsed if not is_joker(c))

    # single の判定
    if count == 1:
        _, rank, _ = parsed[0]
        return Move(kind=TYPE_SINGLE, cards=cards, joker_as=joker_as,
                    rank=rank, count=1)

    # group の判定（同じランク）
    ranks = [r for s, r, c in parsed]
    if any(r is None for r in ranks):
        return None  # ランクが確定していない不正な組
    if len(set(ranks)) == 1:
        # 同じランク
        return Move(kind=TYPE_GROUP, cards=cards, joker_as=joker_as,
                    rank=ranks[0], suits=suits_set, count=count)

    # sequence の判定（01 §3：同じスートで数字が連続する 3 枚以上。ジョーカーは足りない 1 枚の代わり）
    #   【Claude 2026-10-22】これまでは「スート縛りの設定が ON のときだけ同じスート」だった（設計書と違う）
    non_joker_suits = [s for s, r, c in parsed if not is_joker(c)]
    joker_suits = [parse(joker_as[c])[0] for c in cards if is_joker(c) and c in joker_as]
    if len(set(non_joker_suits + joker_suits)) != 1:
        return None

    # ランクが連続しているか確認
    sorted_ranks = sorted(ranks)
    is_sequence = True
    for i in range(1, len(sorted_ranks)):
        if sorted_ranks[i] - sorted_ranks[i-1] != 1:
            is_sequence = False
            break

    if is_sequence and count >= 3:
        # 階段の可否は sequence（01 §5）。sequence_revolution は階段革命の可否（別の設定）
        if not settings.get("sequence", True):
            return None
        return Move(kind=TYPE_SEQUENCE, cards=cards, joker_as=joker_as,
                    low=sorted_ranks[0], high=sorted_ranks[-1],
                    suits=suits_set, count=count)

    # それ以外は無効
    return None


def _suits_no_joker(move) -> frozenset:
    out = set()
    for c in getattr(move, "cards", []) or []:
        if is_joker(c):
            continue
        out.add(parse(c)[0])
    return frozenset(out)


def _down_number_ok(move, top, field_inv, settings) -> bool:
    """ダウンナンバー：場と同じスート（の組）で、強さが 1 つ弱い single／group（ジョーカーを含む手は対象外）。
    【Claude 2026-10-22】出どころ：大富豪 Online の説明「場と同じマークで 1 つ弱い札を出せる」。階段には適用しない。"""
    try:
        if not settings or not settings.get("down_number", False):
            return False
    except Exception:
        return False
    if move.kind not in (TYPE_SINGLE, TYPE_GROUP) or top.kind != move.kind:
        return False
    if any(is_joker(c) for c in move.cards) or any(is_joker(c) for c in top.cards):
        return False
    if move.rank is None or top.rank is None:
        return False
    if _suits_no_joker(move) != _suits_no_joker(top):
        return False
    return move.rank == top.rank + (1 if field_inv else -1)


def beats(move: "Move", field: "Field", settings: object = None) -> bool:
    """
    move が場の現在の手に勝つか判定する。
    field: 現在の場（Field オブジェクト）
    settings: RuleSettings
    
    返り値: True = 勝つ、False = 勝てない
    """
    スペ3返し = スペ3返しが有効(settings)   # 【Claude 2026-10-19 P11】下で Dummy に置き換える前に見る
    if settings is None:
        settings = type("DummySettings", (), {"get": lambda s, k, d=None: d})()
    
    # 【Claude 2026-10-22】ジョーカーだけの手（X1 単体・X1+X2 の組）は、しばりの照合に数えない（01 §5-2「何にでも出せる」）。
    #   これまでは parse('X1') のスート 'X' がしばりに無いため、しばり中はジョーカー単体を出せなかった（Windows の実機で確認）
    ジョーカーだけの手 = bool(move.cards) and all(is_joker(c) and c not in move.joker_as for c in move.cards)
    # スートしばりのチェック
    if field is not None and field.suit_lock is not None and not ジョーカーだけの手:
        # move のすべてのカードが suit_lock と一致するか確認
        # field.suit_lock は frozenset なので、in 演算子を使用
        for c in move.cards:
            if c in move.joker_as:
                # ジョーカーの割り当てを確認
                suit, _ = parse(move.joker_as[c])
            elif is_joker(c):
                continue   # 割り当ての無いジョーカーは照合しない
            else:
                suit, _ = parse(c)
            if suit not in field.suit_lock:
                return False
    
    # 場が空ならいつでも出せる（パスは別）
    if field is None or field.top is None:
        return True
    
    top = field.top
    
    # パスは勝たない
    if move.kind == TYPE_PASS:
        return False
    
    # 種類が異なる場合は基本的に勝てない（sequence は sequence だけ）
    if move.kind != top.kind:
        return False
    
    # 反転状態を取得（field.inverted が属性かメソッドかに対応）
    if hasattr(field, 'inverted'):
        if callable(field.inverted):
            field_inv = field.inverted()
        else:
            field_inv = field.inverted
    else:
        field_inv = False
    
    # single の場合
    if move.kind == TYPE_SINGLE:
        # 【Claude 2026-10-19 P11】ジョーカーはいつでも最強（反転中も）。例外はスペ3返しだけ（01 §2・§5、05 M10）。
        #   これまではジョーカーの rank が 16 なので下の「rank が None」の分岐を通らず、反転中は最弱になっていた。
        if ジョーカー1枚(top):
            return スペ3返し and list(move.cards) == ["S3"]
        if ジョーカー1枚(move):
            return True
        # ジョーカーはいつでも最強（反転中も）
        if move.rank is None:
            return True
        # 場にジョーカーがある場合は負ける（ジョーカーより強い札は無い）
        if top.rank is None:
            return False
        # 数字しばりのチェック（01 §5：次の数字だけ。反転中は 1 つ下）
        if field.rank_lock is not None:
            return move.rank == field.rank_lock + (-1 if field_inv else 1)
        # ダウンナンバー（大富豪 Online のローカルルール）：同じスートで 1 つ弱い札も出せる
        if _down_number_ok(move, top, field_inv, settings):
            return True
        if field_inv:
            return move.rank < top.rank
        else:
            return move.rank > top.rank
    
    # group の場合
    if move.kind == TYPE_GROUP:
        # 枚数が異なる場合は勝てない
        if move.count != top.count:
            return False
        # 【Claude 2026-10-19 P11】ジョーカーだけの組（rank 16）はいつでも最強（反転中も）
        if ジョーカーだけ(top):
            return False
        if ジョーカーだけ(move):
            return True
        if field.rank_lock is not None:
            return move.rank == field.rank_lock + (-1 if field_inv else 1)
        if _down_number_ok(move, top, field_inv, settings):
            return True
        if field_inv:
            return move.rank < top.rank
        else:
            return move.rank > top.rank

    # sequence の場合
    if move.kind == TYPE_SEQUENCE:
        # 枚数が異なる場合は勝てない
        if move.count != top.count:
            return False
        
        # 手と場のランクが重複しているかチェック（階段は同じランクが出せない）
        # 場のカードからランクを抽出
        top_ranks = set()
        for c in top.cards:
            if c in top.joker_as:
                _, r = parse(top.joker_as[c])
            else:
                _, r = parse(c)
            top_ranks.add(r)
        
        # 手のカードからランクを抽出
        move_ranks = set()
        for c in move.cards:
            if c in move.joker_as:
                _, r = parse(move.joker_as[c])
            else:
                _, r = parse(c)
            move_ranks.add(r)
        
        # 重複があれば出せない
        if top_ranks & move_ranks:
            return False
        
        if field_inv:
            # 反転中：弱い方が勝つ（low が小さい方が強い）
            return move.low < top.low
        else:
            # 通常：強い方が勝つ（low が大きい方が強い）
            return move.low > top.low
    
    return False


def contains_rank(move: "Move", rank: int) -> int:
    """
    move に指定されたランクが何枚含まれるかを返す。
    ジョーカーの割り当ても数える。
    """
    count = 0
    for c in move.cards:
        if c in move.joker_as:
            # ジョーカーの割り当てを確認
            _, assigned_rank = parse(move.joker_as[c])
            if assigned_rank == rank:
                count += 1
        else:
            _, card_rank = parse(c)
            if card_rank == rank:
                count += 1
    return count


# 【Claude 2026-10-19】ここにあった 2 つ目の parse（J・Q・K・A を (None, None)、2 を 2 と読む）は消した。
#   10 行で読み込んだ daifugo.cards.parse（仕様 01 §1：J=11 … A=14・2=15・ジョーカー=16）を使う（P18）。
