# -*- coding: utf-8 -*-
"""
大富豪オンライン — ゲームロジック（Game クラスと Card クラス）
設計書 05 §2-5 の Q01〜Q05 に対応
"""

class Card:
    """カードを表すクラス"""
    
    def __init__(self, suit, rank, id_val):
        """
        :param suit: スート（'spade', 'heart', 'club', 'diamond'）
        :param rank: ランク（2〜15。2=2, ..., 10=10, J=11, Q=12, K=13, A=14, 2=15）
        :param id_val: 一意なID（整数）
        """
        self.suit = suit
        self._rank = rank
        self._id = id_val
    
    @property
    def rank(self):
        """カードのランク（2〜15）"""
        return self._rank
    
    @property
    def id(self):
        """カードの一意なID"""
        return self._id
    
    def __repr__(self):
        suit_map = {'spade': '♠', 'heart': '♥', 'club': '♣', 'diamond': '♦'}
        rank_map = {11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2'}
        r = rank_map.get(self._rank, str(self._rank))
        return f"{suit_map.get(self.suit, '?')}{r}"


class Game:
    """大富豪のゲームロジックを管理するクラス"""
    
    def __init__(self, num_players=4):
        """
        :param num_players: プレイヤー数（1〜4。残りはCPU）
        """
        self.num_players = num_players
        self.deck = []
        self.players = []
        self.seats = []
        self.turn = 0
        self.field = []
        self.last_card_rank = 0  # 最後の場に出されたカードのランク
        self.winner = None
        self.rank_order = list(range(2, 16)) + [15]  # 2(15)が最強
    
    def set_hands(self, player_hands):
        """
        各プレイヤーの手札を設定する
        :param player_hands: [[Card], [Card], ...] （各プレイヤーのカードリスト）
        """
        self.players = player_hands
        # 手札をランク順にソート（降順：強い順）
        for hand in self.players:
            hand.sort(key=lambda c: c.rank, reverse=True)
    
    def start_game(self):
        """ゲームを開始する（カードを配る）"""
        # デッキ作成
        suits = ['spade', 'heart', 'club', 'diamond']
        ranks = list(range(2, 16))  # 2〜15（2枚の2のうち1枚は最強）
        # 通常のカード（2〜A）
        self.deck = [Card(s, r, i) for i, (s, r) in enumerate([(s, r) for s in suits for r in range(2, 15)])]
        # 最強の2を追加（IDを区別）
        self.deck.append(Card('spade', 15, len(self.deck)))
        
        # 混ぜる（簡易シャッフル：ID順をランダムに並べ替え）
        import random
        random.shuffle(self.deck)
        
        # 配る（4人なら13枚ずつ）
        self.players = [[] for _ in range(self.num_players)]
        for i, card in enumerate(self.deck):
            self.players[i % self.num_players].append(card)
        
        # 各手札をソート
        for hand in self.players:
            hand.sort(key=lambda c: c.rank, reverse=True)
        
        self.turn = 0
        self.field = []
        self.last_card_rank = 0
        self.winner = None
    
    def can_play(self, cards):
        """
        指定されたカードを出せるか判定
        :param cards: 出すカードのリスト
        :return: (bool, 出せるか、理由)
        """
        if not cards:
            return False, "カードが空です"
        
        # 同じランクのカードのみ（単体、ペア、トリプル、4枚）
        ranks = [c.rank for c in cards]
        if len(set(ranks)) != 1:
            # 連続する3枚以上のストレートか確認
            if len(cards) >= 3:
                ranks_sorted = sorted(ranks)
                is_straight = all(ranks_sorted[i+1] - ranks_sorted[i] == 1 for i in range(len(ranks_sorted)-1))
                if is_straight:
                    # ストレートなら場より強い必要がある
                    if not self.field:
                        return True, "OK"
                    if ranks_sorted[0] > self.last_card_rank:
                        return True, "OK"
                    return False, "場より弱いストレートです"
            return False, "同じランクのカードのみ出せます"
        
        # 単体・ペア・トリプル・4枚
        rank = ranks[0]
        if not self.field:
            return True, "OK"
        
        # 場に出ているカードのランクと比較
        if rank > self.last_card_rank:
            return True, "OK"
        return False, "場より弱いカードです"
    
    def play(self, player_index, cards):
        """
        プレイヤーがカードを出す
        :param player_index: プレイヤーのインデックス
        :param cards: 出すカードのリスト
        :return: (bool, メッセージ)
        """
        if player_index != self.turn:
            return False, "相手の番です"
        
        can, msg = self.can_play(cards)
        if not can:
            return False, msg
        
        # カードを出す
        hand = self.players[player_index]
        for card in cards:
            if card in hand:
                hand.remove(card)
                self.field.append(card)
        
        # 場の情報を更新
        self.last_card_rank = cards[0].rank
        self.turn = (self.turn + 1) % self.num_players
        
        # 勝利判定
        if not self.players[player_index]:
            self.winner = player_index
            return True, f"プレイヤー{player_index}の勝利！"
        
        return True, f"プレイヤー{player_index}がカードを出しました"
    
    def pass_turn(self, player_index):
        """
        プレイヤーがパスする
        :param player_index: プレイヤーのインデックス
        :return: (bool, メッセージ)
        """
        if player_index != self.turn:
            return False, "相手の番です"
        
        self.turn = (self.turn + 1) % self.num_players
        return True, f"プレイヤー{player_index}がパスしました"
    
    def get_state(self):
        """現在のゲーム状態を返す（JSON 形式で）"""
        return {
            "turn": self.turn,
            "field": [c.id for c in self.field],
            "last_card_rank": self.last_card_rank,
            "players": [
                {"id": i, "hand_count": len(hand), "cards": [c.id for c in hand]}
                for i, hand in enumerate(self.players)
            ],
            "winner": self.winner
        }
