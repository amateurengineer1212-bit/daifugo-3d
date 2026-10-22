"""合法手の生成：手札から出せる手を全て列挙する"""

from collections import Counter
from itertools import combinations

from daifugo.cards import sort_hand, is_joker, parse
from daifugo.moves import classify, beats, TYPE_SINGLE, TYPE_GROUP, TYPE_SEQUENCE, Move
from daifugo.field import Field
from daifugo.rules import RuleSettings


def get_legal_moves(hand: list[str], field: Field, settings: RuleSettings) -> list[Move]:
    """合法手を列挙（get_legal_moves は設計書準拠のエクスポート名）"""
    return legal_moves(hand, field, settings)


def can_pass(hand: list[str], field: Field, settings: RuleSettings) -> bool:
    """
    パスできるか判定する。

    場が空のときはパスできない（False）。
    場があるときはいつでもパスできる（True）。
    """
    return field.top is not None


def legal_moves(hand: list[str], field: Field, settings: RuleSettings) -> list[Move]:
    """
    手札から出せる合法手を全て列挙する。
    
    引数:
        hand: 手札のカード名札リスト
        field: 場の状態（Field オブジェクト）
        settings: ルール設定（RuleSettings）
    
    戻り値: 合法手のリスト（各手は Move オブジェクト）
    パスは含まれない（呼ぶ側が「場が空でないならパス可」と知っている）
    
    列挙の数は 1 手につき最大 2,000 で打ち切り。
    """
    legal: list[Move] = []
    limit = 2000
    
    # 場が空の場合
    if field.top is None:
        sorted_hand = sort_hand(hand)
        
        # 単一
        for move in _enumerate_single(sorted_hand, settings):
            legal.append(move)
            if len(legal) >= limit:
                return legal
        
        # グループ（同じランクの2枚以上）
        rank_groups: dict[int, list[str]] = {}
        for card in sorted_hand:
            suit, rank = parse(card)
            if rank not in rank_groups:
                rank_groups[rank] = []
            rank_groups[rank].append(card)
        
        for rank, cards in rank_groups.items():
            if len(cards) >= 2:
                # 2枚から最大枚数まで
                for size in range(2, len(cards) + 1):
                    for combo in combinations(cards, size):
                        move = classify(list(combo), {}, settings)
                        if move:
                            legal.append(move)
                            if len(legal) >= limit:
                                return legal
        
        # 階段（連続する3枚以上）
        seq_flag = settings.get('sequence', True) if hasattr(settings, 'get') else getattr(settings, 'sequence', True)
        suit_cards: dict[str, list[tuple[int, str]]] = {s: [] for s in ["S", "H", "D", "C"]}
        joker_cards: list[str] = []   # 【Claude 2026-10-22】階段 OFF でもジョーカーの組の列挙で使うので、外で作る
        for card in sorted_hand:
            if is_joker(card):
                joker_cards.append(card)
            else:
                suit, rank = parse(card)
                suit_cards[suit].append((rank, card))
        if seq_flag:
            for suit, cards in suit_cards.items():
                cards.sort()
                # 連続する部分列を探す（3枚以上）
                for start in range(len(cards)):
                    for end in range(start + 3, len(cards) + 1):
                        chunk = cards[start:end]
                        ranks = [r for r, c in chunk]
                        if all(ranks[i+1] - ranks[i] == 1 for i in range(len(ranks)-1)):
                            move = classify([c for r, c in chunk], {}, settings)
                            if move:
                                legal.append(move)
                                if len(legal) >= limit:
                                    return legal
        
        # ジョーカーを含むグループ（同じランクにジョーカーを割り当てた場合）
        if joker_cards:
            for rank, cards in rank_groups.items():
                for jcard in joker_cards:
                    # ジョーカー1枚 + 既存の1枚
                    move = classify([cards[0], jcard], {jcard: cards[0]}, settings)
                    if move:
                        legal.append(move)
                        if len(legal) >= limit:
                            return legal
                    if len(cards) >= 2:
                        # ジョーカー1枚 + 既存の2枚
                        move = classify([cards[0], cards[1], jcard], {jcard: cards[0]}, settings)
                        if move:
                            legal.append(move)
                            if len(legal) >= limit:
                                return legal
        
        return legal
    
    # 場がある場合
    sorted_hand = sort_hand(hand)
    
    # 単一のチェック（【Claude 2026-10-19 P11】ジョーカー 1 枚も入れる。これまでは classify([card], {}) でジョーカーが落ち、親のときしか出せなかった）
    for move in _enumerate_single(sorted_hand, settings):
        if beats(move, field, settings):
            legal.append(move)
            if len(legal) >= limit:
                return legal
    
    # グループのチェック
    field_move = field.top
    if field_move and field_move.kind == TYPE_GROUP:
        rank_groups: dict[int, list[str]] = {}
        for card in sorted_hand:
            suit, rank = parse(card)
            if rank not in rank_groups:
                rank_groups[rank] = []
            rank_groups[rank].append(card)
        
        for rank, cards in rank_groups.items():
            if len(cards) >= field_move.count:
                for combo in combinations(cards, field_move.count):
                    move = classify(list(combo), {}, settings)
                    if move and beats(move, field, settings):
                        legal.append(move)
                        if len(legal) >= limit:
                            return legal
    
    # 階段のチェック
    if field_move and field_move.kind == TYPE_SEQUENCE:
        seq_count = field_move.count
        suit_cards: dict[str, list[tuple[int, str]]] = {s: [] for s in ["S", "H", "D", "C"]}
        for card in sorted_hand:
            if not is_joker(card):
                suit, rank = parse(card)
                suit_cards[suit].append((rank, card))
        
        for suit, cards in suit_cards.items():
            cards.sort()
            for start in range(len(cards)):
                for end in range(start + seq_count, len(cards) + 1):
                    chunk = cards[start:end]
                    if len(chunk) == seq_count:
                        ranks = [r for r, c in chunk]
                        if all(ranks[i+1] - ranks[i] == 1 for i in range(len(ranks)-1)):
                            move = classify([c for r, c in chunk], {}, settings)
                            if move and beats(move, field, settings):
                                legal.append(move)
                                if len(legal) >= limit:
                                    return legal
    
    return legal


def _enumerate_single(hand: list[str], settings: RuleSettings) -> list[Move]:
    """single（1枚）を列挙。ジョーカー単体は joker_as 無しで直接 single として作る。"""
    moves = []
    for c in hand:
        if is_joker(c):
            # ジョーカー単体：joker_as 不要。classify は未割り当てのジョーカーを拒否するため直接作る
            _, rank = parse(c)
            moves.append(Move(kind=TYPE_SINGLE, cards=[c], joker_as={}, rank=rank, count=1))
        else:
            m = classify([c], settings=settings)
            if m:
                moves.append(m)
    return moves
