"""大富豪ルールの判定ロジック：革命、8切り、11バック、スートしばりなど"""
from collections import Counter
from dataclasses import dataclass, field
from daifugo.cards import get_rank, is_joker, parse


@dataclass
class RuleSettings:
    """ルール設定の管理（dataclass）"""
    revolution: bool = True           # 革命
    mulligan: bool = True             # マリガン
    mulligan_max: int = 2             # マリガン最大枚数
    eight_cut: bool = True            # 8切り
    eleven_back: bool = True          # 11バック
    suit_lock: bool = True            # スートしばり
    rank_lock: bool = False           # 数字しばり
    joker_return: bool = True         # スペ3返し（ジョーカー返し）。【Claude 2026-10-19 P11】仕様 01 §5 の既定 ON に合わせた（これまで False）
    toki_oroshi: bool = False         # 都落ち
    forbidden_win: bool = False       # 禁止上がり
    card_exchange: bool = False       # カード交換
    five_skip: bool = False           # 5スキップ
    seven_handover: bool = False      # 7渡し
    ten_discard: bool = False         # 10捨て
    nine_reverse: bool = False        # 9リバース
    sequence_revolution: bool = True  # 階段革命
    timeout: int = 60                 # タイムアウト（秒）
    # 【Claude 2026-10-22 会長の追加要件】見本の 18 項目に合わせて足した設定
    sequence: bool = True             # 階段（01 §5）
    joker_count: int = 2              # Joker の枚数 0〜2（総札数は 52＋枚数）
    twelve_bomber: bool = False       # 12ボンバー（Q を出したら数字を選んで全員の手札から捨てる）
    down_number: bool = False         # ダウンナンバー（同じスートで 1 つ弱い札も出せる）
    forbid_2: bool = True             # 禁止あがりの内訳：2（反転中は 3）
    forbid_8: bool = True             # 8（8切り ON のとき）
    forbid_11: bool = True            # J（11バック ON のとき）
    forbid_joker: bool = True         # ジョーカー
    forbid_s3: bool = True            # スペ3返し
    rounds: int = 3                   # ラウンド数 1〜10
    turn_seconds: int = 30            # 1 手の持ち時間（0 で無制限）
    cpu_level: str = "normal"         # CPU の強さ normal／hard／dangerous
    
    # 既定値（DEFAULTS）
    DEFAULTS = {
        "revolution": True,
        "mulligan": True,
        "mulligan_max": 2,
        "eight_cut": True,
        "eleven_back": True,
        "suit_lock": True,
        "rank_lock": False,
        "joker_return": True,
        "toki_oroshi": False,
        "forbidden_win": False,
        "card_exchange": False,
        "five_skip": False,
        "seven_handover": False,
        "ten_discard": False,
        "nine_reverse": False,
        "sequence_revolution": True,
        "timeout": 60,
        "sequence": True, "joker_count": 2, "twelve_bomber": False, "down_number": False,
        "forbid_2": True, "forbid_8": True, "forbid_11": True, "forbid_joker": True, "forbid_s3": True,
        "rounds": 3, "turn_seconds": 30, "cpu_level": "normal",
    }
    # 設計書 01 §5 の鍵名 → この dataclass の鍵名（どちらでも受け取れる）
    ALIASES = {"spade3": "joker_return", "spade3_return": "joker_return", "capital_fall": "toki_oroshi",
               "forbidden_finish": "forbidden_win", "forbid_win": "forbidden_win", "exchange": "card_exchange",
               "seven_pass": "seven_handover"}
    
    @classmethod
    def from_dict(cls, d: dict) -> "RuleSettings":
        """辞書から RuleSettings を作成する。不明な鍵は捨てる。設計書の別名も受け取る。値は型に丸める。"""
        if not d:
            return cls()
        filtered = {}
        for k, v in d.items():
            k = cls.ALIASES.get(k, k)
            if k in cls.DEFAULTS:
                filtered[k] = v
        obj = cls(**filtered)
        fixed, _ = obj.validate()
        return cls(**fixed)
    
    def to_dict(self) -> dict:
        """RuleSettings を辞書に変換する（DEFAULTS の鍵を全部）。"""
        return {k: getattr(self, k) for k in self.DEFAULTS}

    def _to_dict_old(self) -> dict:
        return {
            "revolution": self.revolution,
            "mulligan": self.mulligan,
            "mulligan_max": self.mulligan_max,
            "eight_cut": self.eight_cut,
            "eleven_back": self.eleven_back,
            "suit_lock": self.suit_lock,
            "rank_lock": self.rank_lock,
            "joker_return": self.joker_return,
            "toki_oroshi": self.toki_oroshi,
            "forbidden_win": self.forbidden_win,
            "card_exchange": self.card_exchange,
            "five_skip": self.five_skip,
            "seven_handover": self.seven_handover,
            "ten_discard": self.ten_discard,
            "nine_reverse": self.nine_reverse,
            "sequence_revolution": self.sequence_revolution,
            "timeout": self.timeout,
        }
    
    def validate(self) -> tuple[dict, list[str]]:
        """
        設定の妥当性を検証する。
        戻り値: (修正済み設定 dict, 修正した理由のリスト)
        """
        reasons = []
        result = self.to_dict()
        
        # timeout は 1 以上 300 以下に丸める
        if result["timeout"] < 1:
            result["timeout"] = 1
            reasons.append("timeout は 1 秒以上にする")
        elif result["timeout"] > 300:
            result["timeout"] = 300
            reasons.append("timeout は 300 秒以下にする")
        
        # 数の項目を範囲に丸める
        def _int(k, lo, hi, default):
            try:
                v = int(result[k])
            except (TypeError, ValueError):
                v = default
                reasons.append(f"{k} は数にする")
            if v < lo or v > hi:
                v = min(max(v, lo), hi)
                reasons.append(f"{k} は {lo}〜{hi} にする")
            result[k] = v
        _int("mulligan_max", 1, 3, 2)
        _int("joker_count", 0, 2, 2)
        _int("rounds", 1, 10, 3)
        _int("turn_seconds", 0, 600, 30)
        if result["cpu_level"] not in ("normal", "hard", "dangerous"):
            result["cpu_level"] = "normal"
            reasons.append("cpu_level は normal／hard／dangerous にする")
        # 他のは bool なので True/False に丸める（既に bool ならそのまま）
        bool_keys = [k for k in result.keys() if k not in ("timeout", "mulligan_max", "joker_count", "rounds", "turn_seconds", "cpu_level")]
        for k in bool_keys:
            if not isinstance(result[k], bool):
                result[k] = bool(result[k])
                reasons.append(f"{k} は True/False に変換しました")
        
        return result, reasons
    
    def get(self, key: str, default=None):
        """辞書アクセス風（互換用）"""
        return getattr(self, key, default)
    
    def is_on(self, key: str) -> bool:
        return bool(getattr(self, key, False))
    
    def is_off(self, key: str) -> bool:
        return not bool(getattr(self, key, False))
    
    def __getitem__(self, key: str):
        return getattr(self, key)
    
    def __contains__(self, key: str) -> bool:
        return hasattr(self, key)


def check_eight_cut(cards: list, settings: dict) -> bool:
    """8切り判定：8が出されたらそのスートのカードを捨てる"""
    if not settings.get("eight_cut", True):
        return False
    for card in cards:
        suit, rank = parse(card)
        if rank == 8:
            return True
    return False


def check_eleven_back(cards: list, settings: dict) -> bool:
    """11バック判定：11が出されたら手札を1枚捨てる（またはパス強制）"""
    if not settings.get("eleven_back", True):
        return False
    for card in cards:
        suit, rank = parse(card)
        if rank == 11:
            return True
    return False


def check_five_skip(cards: list, settings: dict) -> bool:
    """5スキップ判定：5が出されたら次のプレイヤーがスキップ"""
    if not settings.get("five_skip", False):
        return False
    for card in cards:
        suit, rank = parse(card)
        if rank == 5:
            return True
    return False


def check_seven_handover(cards: list, settings: dict) -> bool:
    """7渡し判定：7が出されたら手札を1枚渡す（次プレイヤーへ）"""
    if not settings.get("seven_handover", False):
        return False
    for card in cards:
        suit, rank = parse(card)
        if rank == 7:
            return True
    return False


def check_ten_discard(cards: list, settings: dict) -> bool:
    """10捨て判定：10が出されたら手札を1枚捨てる（自分）"""
    if not settings.get("ten_discard", False):
        return False
    for card in cards:
        suit, rank = parse(card)
        if rank == 10:
            return True
    return False


def check_nine_reverse(cards: list, settings: dict) -> bool:
    """9リバース判定：9が出されたら手番順が逆転"""
    if not settings.get("nine_reverse", False):
        return False
    for card in cards:
        suit, rank = parse(card)
        if rank == 9:
            return True
    return False


def check_joker_return(cards: list, field_cards: list, settings: dict) -> bool:
    """スペ3返し（ジョーカー返し）判定：スペ3の後にジョーカーが出されたら返す"""
    if not settings.get("joker_return", False):
        return False
    if not field_cards:
        return False
    
    # 場がスペ3だけか？
    if len(field_cards) != 1:
        return False
    
    suit, rank = parse(field_cards[0])
    if suit != 'S' or rank != 3:
        return False
    
    # カードにジョーカーが含まれるか
    for card in cards:
        if is_joker(card):
            return True
    return False


def check_toki_oroshi(cards: list, settings: dict) -> bool:
    """都落ち判定：上がりの時に手札に特定のカードが残っていると罰則"""
    if not settings.get("toki_oroshi", False):
        return False
    # 実装は game.py で行う（上がりの判定）
    return False


def check_forbidden_win(cards: list, hand: list, settings: dict) -> bool:
    """禁止上がり判定：特定のカードを残して上がれない"""
    if not settings.get("forbidden_win", False):
        return False
    # 実装は game.py で行う
    return False


def check_sequence_revolution(cards: list, field_cards: list, settings: dict) -> bool:
    """階段革命判定：階段で革命が発生するか"""
    if not settings.get("sequence_revolution", True):
        return False
    # 実装は game.py で行う
    return False


def is_legal_suit(card: str, field_suit: str, settings: dict) -> bool:
    """スートしばり判定：場と同じスートでなければならない"""
    if not settings.get("suit_lock", True):
        return True  # しばりなし
    
    if not field_suit:
        return True  # 場が空
    
    card_suit, _ = parse(card)
    return card_suit == field_suit


def is_legal_rank(rank: int, field_rank: int, revolution: bool) -> bool:
    """ランクの強さ判定（革命の有無を考慮）"""
    if revolution:
        # 革命中：小さい方が強い
        return rank < field_rank
    else:
        # 通常：大きい方が強い
        return rank > field_rank


def apply_eight_cut_effect(cards: list, suit: str) -> list:
    """8切りの効果：指定スートのカードを返す（捨てるべきカード）"""
    discarded = []
    for card in cards:
        s, _ = parse(card)
        if s == suit:
            discarded.append(card)
    return discarded


def apply_eleven_back_effect(hand: list) -> list:
    """11バックの効果：手札から1枚を返す（捨てるべきカード）"""
    # 単純に1枚を返す（実際の選択はプレイヤー/CPU）
    if hand:
        return [hand[0]]
    return []


def apply_five_skip_effect() -> bool:
    """5スキップの効果：次のプレイヤーをスキップする"""
    return True


def apply_seven_handover_effect(hand: list) -> list:
    """7渡しの効果：手札から1枚を返す（次プレイヤーに渡す）"""
    if hand:
        return [hand[0]]
    return []


def apply_ten_discard_effect(hand: list) -> list:
    """10捨ての効果：手札から1枚を返す（捨てる）"""
    if hand:
        return [hand[0]]
    return []


def apply_nine_reverse_effect(direction: int) -> int:
    """9リバースの効果：手番方向を反転"""
    return -direction


def get_effect_cards(cards: list, settings: dict) -> dict:
    """カード出た時の効果を一括取得"""
    result = {
        "skip_next": False,
        "reverse": False,
        "discard_cards": [],
        "give_cards": [],
        "suit_to_discard": None
    }
    
    for card in cards:
        suit, rank = parse(card)
        
        if rank == 5 and settings.get("five_skip", False):
            result["skip_next"] = True
        
        if rank == 7 and settings.get("seven_handover", False):
            result["give_cards"] = ["one_card"]  # 実際のカードは game.py で決定
        
        if rank == 8 and settings.get("eight_cut", True):
            result["suit_to_discard"] = suit
        
        if rank == 9 and settings.get("nine_reverse", False):
            result["reverse"] = True
        
        if rank == 10 and settings.get("ten_discard", False):
            result["discard_cards"].append("one_card")
        
        if rank == 11 and settings.get("eleven_back", True):
            result["discard_cards"].append("one_card")
    
    return result
