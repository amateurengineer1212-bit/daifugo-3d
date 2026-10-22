"""ゲーム進行：配牌、手番管理、場、上がり、順位、革命、各種ルール

【Claude 2026-10-22 会長の追加要件】設計書 01 §5 の表と、大富豪 Online の公開解説を照らして、18 項目のルールをゲーム処理に入れた。
  - 設定の読み方を 1 つにまとめた（_cfg）。設定が None でも設計書の既定で動く
  - 階段（sequence）の可否、縛り（スート・数字）、11バック、禁止あがり（反則は最下位側）、都落ち、Joker の枚数、
    9 リバース（向きが逆）、5 スキップ（枚数ぶん）、7渡し・10捨て（出した人が選ぶ待ち）、12ボンバー（数字を選んで全員の手札から捨てる）、
    ダウンナンバー（同じスートで 1 つ弱い札）、カード交換（2 ラウンド目以降）、ラウンド数・持ち時間の値
  - 上がった順は finished_top（上から）と finished_bottom（反則・都落ち：下から）。残り 1 人は空いている順位へ
  - 待ち（awaiting）がある間は手番を進めず、give／discard／bomb／exchange_back が終わってから進める
公開 API（試験が使う名前）は変えていない：start・deal・play・pass_・give・discard・mulligan・legal_for・can_pass・ranks・titles・points・
card_census・set_hands・set_turn・set_field・events・finished・winners・rankings・out・hands・field・turn・phase・awaiting・passed・passed_seats
"""

import random
from collections import Counter
from daifugo.cards import make_deck, shuffled, sort_hand, parse, get_rank, is_joker, SUITS, RANK_MAP
from daifugo.moves import classify, beats, TYPE_SINGLE, TYPE_GROUP, TYPE_SEQUENCE, ジョーカー1枚, スペ3返しが有効, contains_rank
from daifugo.legal import legal_moves, can_pass, get_legal_moves
from daifugo.field import Field
from daifugo.rules import RuleSettings


# 設計書 01 §5 の既定（設定が無いときに使う）
_既定 = {
    "revolution": True, "sequence_revolution": True, "sequence": True,
    "suit_lock": True, "rank_lock": False,
    "eight_cut": True, "eleven_back": True, "joker_return": True,
    "joker_count": 2,
    "toki_oroshi": False, "forbidden_win": False,
    "forbid_2": True, "forbid_8": True, "forbid_11": True, "forbid_joker": True, "forbid_s3": True,
    "card_exchange": False,
    "five_skip": False, "seven_handover": False, "ten_discard": False, "nine_reverse": False,
    "twelve_bomber": False, "down_number": False,
    "mulligan": False, "mulligan_max": 2,
    "rounds": 3, "turn_seconds": 30, "timeout": 60,
}
# 設計書の鍵名と、コードの鍵名の対応（どちらで渡されても読める）
_別名 = {"spade3": "joker_return", "spade3_return": "joker_return", "capital_fall": "toki_oroshi",
       "forbidden_finish": "forbidden_win", "forbid_win": "forbidden_win", "exchange": "card_exchange",
       "seven_pass": "seven_handover"}


def _rank_strength(card: str) -> int:
    """交換・自動の手で使う強さ（ジョーカーが最強）。"""
    return 16 if is_joker(card) else parse(card)[1]


class Game:
    """大富豪ゲームの進行管理"""

    def __init__(self, settings, seat_count, rng=None, previous_ranks=None):
        self.settings = settings
        self.seat_count = seat_count
        self.previous_ranks = list(previous_ranks) if previous_ranks else []

        if rng is None:
            self.rng = random.Random()
        elif isinstance(rng, int):
            self.rng = random.Random(rng)
        else:
            self.rng = rng

        # ---- 設定（全部ここで決める）----
        self.rules = {k: self._cfg(k, v) for k, v in _既定.items()}
        self.revolution = bool(self.rules["revolution"])
        self.sequence = bool(self.rules["sequence"])
        self.sequence_revolution = bool(self.rules["sequence_revolution"])
        self.suit_lock = bool(self.rules["suit_lock"])
        self.rank_lock = bool(self.rules["rank_lock"])
        self.spade3_return = bool(self.rules["joker_return"])
        self.joker_return = self.spade3_return
        self.eight_cut = bool(self.rules["eight_cut"])
        self.eleven_back = bool(self.rules["eleven_back"])
        self.joker_count = max(0, min(2, int(self.rules["joker_count"] or 0)))
        self.toki_oroshi = bool(self.rules["toki_oroshi"])
        self.forbid_win = bool(self.rules["forbidden_win"])
        self.card_exchange = bool(self.rules["card_exchange"])
        self.five_skip = bool(self.rules["five_skip"])
        self.seven_handover = bool(self.rules["seven_handover"])
        self.ten_discard = bool(self.rules["ten_discard"])
        self.nine_reverse = bool(self.rules["nine_reverse"])
        self.twelve_bomber = bool(self.rules["twelve_bomber"])
        self.down_number = bool(self.rules["down_number"])
        self.mulligan_enabled = bool(self.rules["mulligan"])
        self.mulligan_limit = int(self.rules["mulligan_max"] or 0)
        self.timeout_seconds = self.rules["timeout"]   # （timeout() は時間切れの処理なので、属性の名前を分けた）
        self.turn_seconds = int(self.rules["turn_seconds"] or 0)
        self.rounds_total = int(self.rules["rounds"] or 1)

        # ---- 状態 ----
        self.phase = 'deal'              # 'deal' → ('exchange' → ) 'play' → 'round_end'
        self.hands = []
        self.field = Field()
        self.turn = 0
        self.passed = 0
        self.passed_seats = set()
        self.finished = []               # 抜けた順（上がり・反則・都落ちの全部。手番を飛ばす判定に使う）
        self.finished_top = []           # 上から順（ふつうの上がり）
        self.finished_bottom = []        # 下から順（反則・都落ち）
        self.winners = []                # finished_top と同じ（称号・点が使う）
        self.out = {}                    # 席 → 上がり方
        self.rankings = {}               # 席 → 順位
        self.awaiting = None             # {"type": give|discard|bomb|exchange_back, "seat": i, "count": n, "to": j}
        self._awaiting_queue = []
        self._pending = None             # 待ちが終わったあとの手番の進め方
        self.mulligan_pool = []
        self.mulligan_done = False
        self.mulligan_used = 0
        self.discard_pile = []
        self.events = []
        self.revolution_count = 0
        self.revolution_type = None
        self.scores = [0] * self.seat_count
        self.exchange_cards = []
        self.exchange_log = []
        self._last_player = None
        self.last_reason = ""
        self.turn_since = None           # 手番が変わった時刻（持ち時間に使う）

    # ------------------------------------------------------------------
    # 設定
    # ------------------------------------------------------------------
    def _cfg(self, key, default):
        s = self.settings
        keys = [key] + [k for k, v in _別名.items() if v == key]
        if s is None:
            return default
        for k in keys:
            if isinstance(s, dict):
                if k in s:
                    return s[k]
            else:
                if hasattr(s, k) and not callable(getattr(s, k)):
                    return getattr(s, k)
                try:
                    v = s.get(k, None) if hasattr(s, "get") else None
                except Exception:
                    v = None
                if v is not None:
                    return v
        return default

    def _判定の設定(self):
        """合法手と強さの判定に渡す設定（dict。.get で読める）。"""
        return self.rules

    # ------------------------------------------------------------------
    # 配り
    # ------------------------------------------------------------------
    def start(self) -> None:
        """ゲームを開始（配牌）"""
        self.phase = 'deal'
        self.deal()
        if self.phase == 'play':
            self._begin_exchange_if_needed()

    def deal(self, mulligan_cards: list = None) -> None:
        """配牌を行う（マリガン山は手札に配らず pool へ）"""
        deck = make_deck(self.joker_count)
        deck = shuffled(deck, self.rng)
        self.hands = [[] for _ in range(self.seat_count)]
        if self.mulligan_enabled and not self.mulligan_done and self.mulligan_used < self.mulligan_limit:
            if mulligan_cards:
                self.mulligan_pool = list(mulligan_cards)
                deck = [c for c in deck if c not in self.mulligan_pool]
        for i, card in enumerate(deck):
            self.hands[i % self.seat_count].append(card)
        for i in range(self.seat_count):
            self.hands[i] = sort_hand(self.hands[i])
        self._determine_first_player()
        self.turn_since = None
        self.phase = 'mulligan' if self.mulligan_pool else 'play'

    def _determine_first_player(self) -> None:
        """最初の手番（01 §4-4）：1 ラウンド目は D3 → H3 → S3 → C3 → 席順の先頭。2 ラウンド目以降は前ラウンドの大貧民。"""
        if self.previous_ranks:
            n = self.seat_count
            for i, r in enumerate(self.previous_ranks):
                if r == n and i < n:
                    self.turn = i
                    return
        for card in ('D3', 'H3', 'S3', 'C3'):
            for i, hand in enumerate(self.hands):
                if card in hand:
                    self.turn = i
                    return
        self.turn = 0

    def _seat_of_rank(self, r):
        for i, x in enumerate(self.previous_ranks):
            if x == r:
                return i
        return None

    def _begin_exchange_if_needed(self):
        """カード交換（01 §4-2）：2 ラウンド目以降・設定 ON。貧→富は自動（いちばん強い札）、富→貧は富が選ぶ（待ち）。"""
        if not self.card_exchange or not self.previous_ranks or self.seat_count < 3:
            return
        n = self.seat_count
        pairs = []
        rich, poor = self._seat_of_rank(1), self._seat_of_rank(n)
        if rich is not None and poor is not None:
            pairs.append((poor, rich, 2 if n >= 4 else 1))
        if n >= 4:
            rich2, poor2 = self._seat_of_rank(2), self._seat_of_rank(n - 1)
            if rich2 is not None and poor2 is not None:
                pairs.append((poor2, rich2, 1))
        queue = []
        for poor_s, rich_s, cnt in pairs:
            give = sorted(self.hands[poor_s], key=_rank_strength, reverse=True)[:cnt]
            for c in give:
                self.hands[poor_s].remove(c)
                self.hands[rich_s].append(c)
            self.hands[rich_s] = sort_hand(self.hands[rich_s])
            self.exchange_log.append((poor_s, rich_s, list(give)))
            self.events.append(("exchange", poor_s, rich_s, len(give)))
            queue.append({"type": "exchange_back", "seat": rich_s, "count": cnt, "to": poor_s})
        if queue:
            self.phase = 'exchange'
            self._awaiting_queue = queue
            self.awaiting = self._awaiting_queue.pop(0)
            self._exchange_first_turn = self.turn
            self.turn = self.awaiting["seat"]

    # ------------------------------------------------------------------
    # 手番の向き・次の人
    # ------------------------------------------------------------------
    def _dir(self) -> int:
        return -1 if getattr(self.field, "reverse", False) else 1

    def _active(self, seat: int) -> bool:
        return seat not in self.finished

    def _next_active(self, seat: int, steps: int = 1) -> int:
        """seat から向きに沿って、まだ抜けていない人を steps 人ぶん進んだ席。"""
        d = self._dir()
        cur = seat
        for _ in range(steps):
            for _k in range(self.seat_count):
                cur = (cur + d) % self.seat_count
                if self._active(cur):
                    break
            else:
                return seat
        return cur

    def _set_turn(self, seat: int):
        self.turn = seat
        self.turn_since = None   # rooms が時刻を入れる

    def _next_turn(self) -> None:
        """次のプレイヤーへ（passed はリセットしない：pass_ の全員パス判定で使う）"""
        if len(self.finished) >= self.seat_count:
            return
        self._set_turn(self._next_active(self.turn))

    def _skip_eliminated(self) -> None:
        if len(self.finished) >= self.seat_count:
            return
        if not self._active(self.turn):
            self._set_turn(self._next_active(self.turn))

    def _is_eliminated(self, player_idx: int) -> bool:
        return player_idx in self.finished

    # ------------------------------------------------------------------
    # 出す
    # ------------------------------------------------------------------
    def play(self, cards: list, seat: int = None, joker_as=None) -> bool:
        """出す（中身は _play_impl）。うまくいったら実況のための出来事を残す"""
        席 = self.turn if seat is None else seat
        ok = self._play_impl(cards, seat, joker_as)
        return ok

    def _play_impl(self, cards: list, seat: int = None, joker_as=None) -> bool:
        if seat is None:
            seat = self.turn
        if len(self.finished) >= self.seat_count:
            return False
        if self.phase != 'play':
            self.last_reason = "いまは出せません"
            return False
        if self.awaiting is not None:
            self.last_reason = "先に選ぶ物があります（%s）" % self.awaiting.get("type")
            return False
        if seat != self.turn:
            self.last_reason = "自分の手番ではありません"
            return False
        if seat in self.passed_seats and self.field.history:
            self.last_reason = "パスしたので、場が流れるまで出せません"
            return False
        self.last_reason = ""
        if not cards:
            self.last_reason = "札がありません"
            return False
        残り = list(self.hands[seat])
        for card in cards:
            if card not in 残り:
                self.last_reason = "手札に無い札です: %s" % card
                return False
            残り.remove(card)
        出す = sorted(cards)
        合う = [m for m in self.legal_for(seat) if sorted(m.cards) == 出す]
        if isinstance(joker_as, dict) and joker_as:
            合う = [m for m in 合う if dict(m.joker_as or {}) == joker_as]
        if not 合う:
            self.last_reason = "合法手ではありません（場より弱い・組が違う・しばり など）"
            return False
        move = 合う[0]
        設 = self._判定の設定()
        反転前 = self.field.inverted()
        スペ3返し = (スペ3返しが有効(設) and move.kind == TYPE_SINGLE
                  and list(move.cards) == ['S3'] and ジョーカー1枚(self.field.top))

        # 1. 札を手札から場へ
        for card in cards:
            self.hands[seat].remove(card)
        self.field.after_play(move, 設)
        self.awaiting = None
        self._last_player = seat
        self.events.append(("play", seat, list(cards)))
        if self.field.suit_lock is not None and getattr(self.field, "lock_started", None) == len(self.field.history):
            self.events.append(("lock", seat, "suit"))
        if self.field.rank_lock is not None and getattr(self.field, "rank_lock_started", None) == len(self.field.history):
            self.events.append(("lock", seat, "rank"))

        # 2. 革命（4 枚以上の group／階段革命 ON なら 4 枚以上の sequence）
        if self.revolution and ((move.kind == TYPE_GROUP and len(move.cards) >= 4)
                                or (self.sequence_revolution and move.kind == TYPE_SEQUENCE and len(move.cards) >= 4)):
            self.field.revolution = not self.field.revolution
            self.revolution_count += 1
            self.events.append(("revolution", seat, bool(self.field.revolution)))

        # 3. 11バック（J を含む手。場が流れるまで反転）
        if self.eleven_back and contains_rank(move, 11) > 0:
            self.field.eleven_back = True
            self.events.append(("eleven_back", seat))

        # 4. 流れる手か（8切り・スペ3返し）
        流す = (self.eight_cut and contains_rank(move, 8) > 0) or スペ3返し
        流す理由 = "spade3" if スペ3返し else ("eight" if 流す else None)

        # 5. 上がりの判定（禁止あがりはここ）
        if len(self.hands[seat]) == 0:
            反則 = self._forbidden_finish(move, 反転前, スペ3返し)
            self._player_won(seat, foul=反則)
            if 流す:
                self._flow(流す理由, seat)
            self._after_finish_turn(seat, 流す)
            return True

        # 6. 都落ちはここでは起きない（誰かが上がったときだけ）。7. 9リバース
        if self.nine_reverse and contains_rank(move, 9) > 0:
            self.field.reverse = not self.field.reverse
            self.events.append(("reverse", seat))

        # 8. 5スキップの数
        skips = contains_rank(move, 5) if self.five_skip else 0

        # 9. 待ち（12ボンバー → 7渡し → 10捨て）
        queue = []
        if self.twelve_bomber:
            n = contains_rank(move, 12)
            if n > 0:
                queue.append({"type": "bomb", "seat": seat, "count": n})
        if self.seven_handover:
            n = contains_rank(move, 7)
            if n > 0:
                queue.append({"type": "give", "seat": seat, "count": min(n, len(self.hands[seat])), "to": self._next_active(seat)})
        if self.ten_discard:
            n = contains_rank(move, 10)
            if n > 0:
                queue.append({"type": "discard", "seat": seat, "count": min(n, len(self.hands[seat]))})

        # 10. 8切り／スペ3返し（場を流す。手番は同じ人）
        if 流す:
            self._flow(流す理由, seat)

        self._pending = {"seat": seat, "flow": bool(流す), "skips": skips}
        if queue:
            self._awaiting_queue = queue
            self.awaiting = self._awaiting_queue.pop(0)
            self._set_turn(seat)   # 待ちの間は出した人の手番のまま
            return True
        self._advance_after_play()
        return True

    def _forbidden_finish(self, move, 反転前: bool, スペ3返し: bool) -> bool:
        """禁止あがり（01 §5）：ジョーカー／2（反転中は 3）／8（8切り ON）／J（11バック ON）／スペ3返しの S3 で上がると反則。"""
        if not self.forbid_win:
            return False
        r = self.rules
        if r.get("forbid_joker", True) and any(is_joker(c) for c in move.cards):
            return True
        bad_rank = 3 if 反転前 else 15
        if r.get("forbid_2", True) and contains_rank(move, bad_rank) > 0:
            return True
        if r.get("forbid_8", True) and self.eight_cut and contains_rank(move, 8) > 0:
            return True
        if r.get("forbid_11", True) and self.eleven_back and contains_rank(move, 11) > 0:
            return True
        if r.get("forbid_s3", True) and スペ3返し:
            return True
        return False

    def _flow(self, reason, seat):
        self.field.clear()
        self.awaiting = None
        self.passed = 0
        self.passed_seats = set()
        self.events.append(("flow", reason, seat))

    def _advance_after_play(self):
        """出したあと（待ちが終わったあと）の手番。流れたら同じ人、そうでなければ次の人（スキップぶん飛ばす）。"""
        p = self._pending or {}
        self._pending = None
        seat = p.get("seat", self.turn)
        if len(self.finished) >= self.seat_count:
            return
        self._check_last_one()
        if len(self.finished) >= self.seat_count:
            return
        if p.get("flow"):
            self._set_turn(seat if self._active(seat) else self._next_active(seat))
        else:
            steps = 1 + int(p.get("skips") or 0)
            if p.get("skips"):
                self.events.append(("skip", seat, int(p.get("skips"))))
            self._set_turn(self._next_active(seat, steps))

    def _after_finish_turn(self, seat, 流す):
        """上がった人のあとの手番（01 §5：8切りで上がれば流れるだけで、次の人が先手）。"""
        if len(self.finished) >= self.seat_count:
            return
        self._set_turn(self._next_active(seat))

    # ------------------------------------------------------------------
    # 待ちの解決：7渡し・10捨て・12ボンバー・交換の返し
    # ------------------------------------------------------------------
    def _resolve_next(self):
        """待ちが 1 つ終わったとき。残りがあれば次の待ち、無ければ手番を進める。"""
        if self._awaiting_queue:
            self.awaiting = self._awaiting_queue.pop(0)
            self._set_turn(self.awaiting["seat"])
            return
        self.awaiting = None
        if self.phase == 'exchange':
            self.phase = 'play'
            self._set_turn(getattr(self, "_exchange_first_turn", self.turn))
            self.events.append(("exchange_done",))
            return
        self._advance_after_play()

    def give(self, seat: int, cards: list) -> bool:
        """7渡し：出した人が 0〜count 枚を次の人へ渡す。"""
        a = self.awaiting
        if not a or a.get("type") != "give" or a.get("seat") != seat:
            return False
        cards = list(cards or [])
        if len(cards) > a["count"] or len(set(cards)) != len(cards):
            return False
        if any(c not in self.hands[seat] for c in cards):
            return False
        to = a.get("to")
        if to is None or not self._active(to):
            to = self._next_active(seat)
        for c in cards:
            self.hands[seat].remove(c)
            self.hands[to].append(c)
        self.hands[to] = sort_hand(self.hands[to])
        self.events.append(("give", seat, to, len(cards)))
        if len(self.hands[seat]) == 0:
            self._player_won(seat, foul=False)
        self._resolve_next()
        return True

    def discard(self, seat: int, cards: list) -> bool:
        """10捨て：出した人が 0〜count 枚を捨てる。捨てて 0 枚になったらふつうの上がり。"""
        a = self.awaiting
        if not a or a.get("type") != "discard" or a.get("seat") != seat:
            return False
        cards = list(cards or [])
        if len(cards) > a["count"] or len(set(cards)) != len(cards):
            return False
        if any(c not in self.hands[seat] for c in cards):
            return False
        for c in cards:
            self.hands[seat].remove(c)
            self.discard_pile.append(c)
        self.events.append(("discard", seat, len(cards)))
        if len(self.hands[seat]) == 0:
            self._player_won(seat, foul=False)
        self._resolve_next()
        return True

    def bomb(self, seat: int, ranks: list) -> bool:
        """12ボンバー：出した人が Q の枚数ぶん数字を選び、全員の手札からその数字の札を捨てる（0 個も可）。"""
        a = self.awaiting
        if not a or a.get("type") != "bomb" or a.get("seat") != seat:
            return False
        ranks = [str(r).upper() for r in (ranks or [])]
        ok_ranks = set(RANK_MAP.keys()) | {"JOKER"}
        if len(ranks) > a["count"] or len(set(ranks)) != len(ranks) or any(r not in ok_ranks for r in ranks):
            return False
        removed = 0
        newly_empty = []
        for i in range(self.seat_count):
            if not self._active(i):
                continue
            keep = []
            for c in self.hands[i]:
                lab = "JOKER" if is_joker(c) else c[1:]
                if lab in ranks:
                    self.discard_pile.append(c)
                    removed += 1
                else:
                    keep.append(c)
            if removed and len(keep) == 0 and len(self.hands[i]) > 0:
                newly_empty.append(i)
            self.hands[i] = keep
        self.events.append(("bomb", seat, list(ranks), removed))
        # 0 枚になった人は上がり（出した人を先に）
        for i in sorted(newly_empty, key=lambda x: 0 if x == seat else 1):
            if self._active(i):
                self._player_won(i, foul=False)
        self._resolve_next()
        return True

    def exchange_back(self, seat: int, cards: list) -> bool:
        """カード交換の返し：大富豪（富豪）が count 枚を大貧民（貧民）へ返す。"""
        a = self.awaiting
        if not a or a.get("type") != "exchange_back" or a.get("seat") != seat:
            return False
        cards = list(cards or [])
        if len(cards) != a["count"] or len(set(cards)) != len(cards):
            return False
        if any(c not in self.hands[seat] for c in cards):
            return False
        to = a["to"]
        for c in cards:
            self.hands[seat].remove(c)
            self.hands[to].append(c)
        self.hands[to] = sort_hand(self.hands[to])
        self.hands[seat] = sort_hand(self.hands[seat])
        self.exchange_log.append((seat, to, list(cards)))
        self.events.append(("exchange_back", seat, to, len(cards)))
        self._resolve_next()
        return True

    def auto_resolve(self, seat: int) -> bool:
        """待ちを既定で解決（CPU・時間切れ）：7渡し／10捨て／交換の返しは いちばん弱い札、12ボンバーは自分に無い強い数字。"""
        a = self.awaiting
        if not a or a.get("seat") != seat:
            return False
        t = a.get("type")
        weakest = sorted(self.hands[seat], key=_rank_strength)
        if t == "give":
            return self.give(seat, weakest[:a["count"]])
        if t == "discard":
            return self.discard(seat, weakest[:a["count"]])
        if t == "exchange_back":
            return self.exchange_back(seat, weakest[:a["count"]])
        if t == "bomb":
            mine = set(("JOKER" if is_joker(c) else c[1:]) for c in self.hands[seat])
            order = ["JOKER", "2", "A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3"]
            picks = [r for r in order if r not in mine][:a["count"]]
            return self.bomb(seat, picks)
        return False

    # ------------------------------------------------------------------
    # パス
    # ------------------------------------------------------------------
    def pass_(self, seat: int = None) -> bool:
        席 = self.turn if seat is None else seat
        場あり = bool(self.field.history)
        ok = self._pass_impl(seat)
        if ok:
            self.events.append(("pass", 席))
            if 場あり and not self.field.history:
                self.events.append(("flow", "all_pass", 席))
        return ok

    def _pass_impl(self, seat: int = None) -> bool:
        if seat is None:
            seat = self.turn
        if len(self.finished) >= self.seat_count:
            return False
        if self.phase != 'play' or self.awaiting is not None:
            return False
        if seat != self.turn:
            return False
        if not can_pass(self.hands[seat], self.field, self._判定の設定()):
            return False
        self.passed += 1
        self.passed_seats.add(seat)
        last = self._last_player
        if last is not None and self.field.history:
            active = [i for i in range(self.seat_count) if self._active(i)]
            resolved = 0
            for i in active:
                if i == last:
                    resolved += 1
                elif i in self.passed_seats:
                    resolved += 1
                elif not can_pass(self.hands[i], self.field, self._判定の設定()):
                    resolved += 1
            if resolved >= len(active):
                # 場が流れる：手番は最後に出した人（抜けていればその次）
                self.field.clear()
                self.awaiting = None
                self.passed = 0
                self.passed_seats = set()
                self._set_turn(last if self._active(last) else self._next_active(last))
                return True
        self._set_turn(self._next_active(seat))
        return True

    # ------------------------------------------------------------------
    # その他の操作
    # ------------------------------------------------------------------
    def mulligan(self, cards: list) -> bool:
        if len(self.finished) >= self.seat_count:
            return False
        if self.phase != 'mulligan':
            return False
        if not self.mulligan_enabled or self.mulligan_done:
            return False
        if len(cards) > self.mulligan_limit:
            return False
        self.mulligan_pool = list(cards)
        self.mulligan_done = True
        self.phase = 'play'
        return True

    def timeout(self) -> bool:
        """時間切れ（01 §7）：待ちがあれば既定で解決、場が空ならいちばん弱い札、場があればパス。"""
        seat = self.turn
        if self.awaiting is not None:
            return self.auto_resolve(seat)
        if self.phase != 'play':
            return False
        if self.field.top is None or not can_pass(self.hands[seat], self.field, self._判定の設定()):
            legal = self.legal_for(seat)
            singles = [m for m in legal if m.kind == TYPE_SINGLE]
            pick = min(singles or legal, key=lambda m: min(_rank_strength(c) for c in m.cards)) if legal else None
            if pick is None:
                return self.pass_()
            return self.play(list(pick.cards), seat)
        return self.pass_()

    def legal_for(self, seat: int) -> list:
        if seat in self.passed_seats and self.field.history:
            return []   # パスした人は場が流れるまで出せない（01 §4-4）
        return get_legal_moves(self.hands[seat], self.field, self._判定の設定())

    def can_pass(self, seat: int) -> bool:
        return can_pass(self.hands[seat], self.field, self._判定の設定())

    # ------------------------------------------------------------------
    # 上がり・順位
    # ------------------------------------------------------------------
    def _player_won(self, player_idx: int, foul: bool = False) -> None:
        """上がり（foul=True は反則：最下位側）。都落ち・残り 1 人の処理もここで。"""
        if player_idx in self.finished:
            return
        if foul:
            self.finished_bottom.append(player_idx)
            self.finished.append(player_idx)
            self.out[player_idx] = "禁止あがり"
            self.events.append(("foul", player_idx))
        else:
            self.finished_top.append(player_idx)
            self.finished.append(player_idx)
            self.out[player_idx] = "上がり"
            self.winners.append(player_idx)
            # 都落ち：前ラウンドの大富豪より先に誰かが上がった瞬間に大貧民が確定（手札は捨てる）
            if self.toki_oroshi and self.previous_ranks:
                former = self._seat_of_rank(1)
                if former is not None and former != player_idx and self._active(former):
                    self.discard_pile.extend(self.hands[former])
                    self.hands[former] = []
                    self.finished_bottom.append(former)
                    self.finished.append(former)
                    self.out[former] = "都落ち"
                    self.events.append(("capital_fall", former))
        self.hands[player_idx] = []
        self._refresh_rankings()
        self.events.append(("win", player_idx, self.rankings.get(player_idx, 0)))
        self._check_last_one()

    def _check_last_one(self):
        """残り 1 人になったら、その人が空いている順位（ふつうは最下位）でラウンド終了（01 §4-4）。"""
        if len(self.finished) >= self.seat_count:
            self.phase = 'round_end'
            return
        active = [i for i in range(self.seat_count) if self._active(i)]
        if len(active) == 1:
            last = active[0]
            self.finished_top.append(last)
            self.finished.append(last)
            self.winners.append(last)
            self.out[last] = "最下位" if self.rankings.get(last, 0) == 0 else "上がり"
            self._refresh_rankings()
            self.events.append(("win", last, self.rankings.get(last, 0)))
            self.phase = 'round_end'

    def _refresh_rankings(self):
        self.rankings = {}
        n = self.seat_count
        for i, s in enumerate(self.finished_top):
            self.rankings[s] = i + 1
        for i, s in enumerate(self.finished_bottom):
            self.rankings[s] = n - i

    def ranks(self) -> list:
        """順位リスト。上がった順に 1,2,3…（反則・都落ちは下から）。まだの人は 0。"""
        self._refresh_rankings()
        return [self.rankings.get(i, 0) for i in range(self.seat_count)]

    def titles(self) -> dict:
        """称号（01 §6）：1 位 大富豪、2 位 富豪（n≥4）、n−1 位 貧民（n≥4）、n 位 大貧民、ほか 平民。"""
        n = self.seat_count
        r = self.ranks()
        if any(x == 0 for x in r):
            return {}
        t = {}
        for seat, rk in enumerate(r):
            if rk == 1:
                t[seat] = '大富豪'
            elif rk == n:
                t[seat] = '大貧民'
            elif n >= 4 and rk == 2:
                t[seat] = '富豪'
            elif n >= 4 and rk == n - 1:
                t[seat] = '貧民'
            else:
                t[seat] = '平民'
        return t

    def points(self) -> dict:
        """点（01 §6 標準）：大富豪 +2・富豪 +1・平民 0・貧民 −1・大貧民 −2。"""
        pts = {'大富豪': 2, '富豪': 1, '平民': 0, '貧民': -1, '大貧民': -2}
        return {seat: pts.get(t, 0) for seat, t in self.titles().items()}

    def card_census(self) -> dict:
        all_cards = []
        for hand in self.hands:
            all_cards.extend(hand)
        if self.field and self.field.history:
            for move in self.field.history:
                if move and move.cards:
                    all_cards.extend(move.cards)
        all_cards.extend(getattr(self.field, "流れた札", None) or [])
        all_cards.extend(self.discard_pile)
        return Counter(all_cards)

    # 試験用
    def set_hands(self, hands: list) -> None:
        self.hands = [sort_hand(h) for h in hands]

    def set_turn(self, player_idx: int) -> None:
        self.turn = player_idx

    def set_field(self, cards: list) -> None:
        self.field.clear()
        for card in cards:
            move = classify([card], {}, None)
            if move:
                self.field.history.append(move)
                self.field.top = move
