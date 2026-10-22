"""札（カード）の管理：名札、スート、ランク、デッキ生成、シャッフル、並べ替え"""

import random

# スート記号
SUITS = ("S", "H", "D", "C")  # ♠ ♥ ♦ ♣

# ランク対応：数字=3-14, 2=15, ジョーカー=16
RANK_MAP = {
    "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10,
    "J": 11, "Q": 12, "K": 13, "A": 14, "2": 15
}

# ランクから表示用文字
RANK_TO_LABEL = {v: k for k, v in RANK_MAP.items()}
RANK_TO_LABEL[16] = "JOKER"

# スート記号
SUIT_SYMBOL = {"S": "♠", "H": "♥", "D": "♦", "C": "♣"}


def parse(card_id: str):
    """
    カード名札を (スート, ランク) にパースする。
    ジョーカーは (None, 16) を返す。
    """
    if card_id.startswith("X"):
        # ジョーカー
        return (None, 16)
    
    # スート1文字 + 数字/文字
    suit = card_id[0]
    rank_str = card_id[1:]
    
    if suit not in SUITS:
        raise ValueError(f"Invalid suit: {suit}")
    
    if rank_str not in RANK_MAP:
        raise ValueError(f"Invalid rank: {rank_str}")
    
    return (suit, RANK_MAP[rank_str])


def make_deck(joker_count: int = 2) -> list:
    """
    デッキを生成する。
    joker_count: ジョーカーの数（0, 1, 2）
    戻り値: カード名札のリスト
    """
    deck = []
    for suit in SUITS:
        for rank_str in RANK_MAP.keys():
            deck.append(f"{suit}{rank_str}")
    
    for i in range(joker_count):
        deck.append(f"X{i+1}")
    
    return deck


def shuffled(deck: list, rng: random.Random) -> list:
    """
    デッキをシャッフルして返す。
    元のリストは変更しない。
    """
    result = deck.copy()
    rng.shuffle(result)
    return result


def get_rank(card_id: str) -> int:
    """カードのランク（強さの値）を返す。ジョーカーは16。"""
    _, rank = parse(card_id)
    return rank


def sort_hand(cards: list) -> list:
    """
    手札を並べ替える。
    順序: ランク昇順 → スート順 (S, H, D, C) → ジョーカー最後
    """
    def sort_key(card):
        suit, rank = parse(card)
        if suit is None:
            # ジョーカー: ランク16, スート順の最後
            return (rank, 4)  # スート順は4番目
        suit_order = SUITS.index(suit)
        return (rank, suit_order)
    
    return sorted(cards, key=sort_key)


def label(card_id: str) -> str:
    """カードの表示用ラベルを返す（例: ♠3, JOKER）"""
    suit, rank = parse(card_id)
    if suit is None:
        return "JOKER"
    return f"{SUIT_SYMBOL[suit]}{RANK_TO_LABEL[rank]}"


def is_joker(card_id: str) -> bool:
    """ジョーカーかどうかを返す"""
    return card_id.startswith("X")
