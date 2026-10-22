"""CPU 同士の自己対戦（設計書 04 §3）。

python -m daifugo.cpu.selfplay --games 100 --levels normal,normal,normal,normal --seed 1
"""
from __future__ import annotations

import argparse
import random
import sys

from daifugo.cards import make_deck, shuffled, sort_hand
from daifugo.rules import RuleSettings
from daifugo.game import Game
from daifugo.cpu import make_cpu
from daifugo.cpu.base import safe_choose_move


def play_one_stats(levels, seed, settings=None, 上限=1000):
    """1 ラウンドを回して、結果を返す（05 SP02 を確かめるための口）。
    【Claude 2026-10-19】打ち切っても順位は埋めない（仕様 SP02 で禁止）。
      返す物：ranks（全員上がったときだけ 1 始まりの順位。そうでなければ []）・moves（手数）・
              cutoff（上限で打ち切ったか）・all_finished（全員が本当に上がったか）"""
    rng = random.Random(seed)
    deck = shuffled(make_deck(), rng)
    n = len(levels)
    hands = [sort_hand(deck[i * 13:(i + 1) * 13]) for i in range(n)]

    if settings is None:
        settings = RuleSettings()
    game = Game(settings, seat_count=n, rng=random.Random(seed + 1))
    game.set_hands(hands)
    game.phase = "play"

    cpus = [make_cpu(lvl, random.Random(seed + 100 + i)) for i, lvl in enumerate(levels)]

    # 【Claude 2026-10-19 P12】1 手ごとに札を数え直す（05 SP01「毎ラウンド card_census が一致」・G23「いつ呼んでも」）
    配った = sum(len(h) for h in hands)
    数え違い = []

    def 数え直す(手数):
        c = game.card_census()
        if sum(c.values()) != 配った or any(v != 1 for v in c.values()):
            数え違い.append((手数, sum(c.values())))

    moves = 0
    while len(game.finished) < n and moves < 上限:
        moves += 1
        seat = game.turn
        hand = game.hands[seat]
        if not hand:
            game.pass_(seat)
            continue
        legal = game.legal_for(seat)
        view = {
            "my_cards": list(hand),
            "field": {"cards": list(game.field.history)},
            "my_remaining": len(hand),
            "next_remaining": 10,
            "played_history": list(game.field.history),
            "player_hands": {},
            "num_players": n,
        }
        move = safe_choose_move(cpus[seat], view, legal)
        if move:
            game.play(move.cards, seat)
        else:
            game.pass_(seat)
        数え直す(moves)

    全員 = len(game.finished) >= n
    return {"ranks": game.ranks() if 全員 else [], "moves": moves,
            "cutoff": not 全員, "all_finished": 全員,
            "dealt": 配った, "census_mismatch": len(数え違い), "census_first": 数え違い[0] if 数え違い else None}


def play_one(levels, seed, settings=None):
    """1 ラウンドを回す。各席の順位（1 始まり）を返す。
    【Claude 2026-10-19】打ち切りになったら、残り手札で順位を埋めずに誤りを出す（仕様 SP02 で禁止の処理を消した）。"""
    st = play_one_stats(levels, seed, settings, 上限=10000)
    if st["cutoff"]:
        raise RuntimeError("自己対戦が %d 手で終わらなかった（打ち切り。順位は埋めない）" % st["moves"])
    return st["ranks"]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", type=int, default=100)
    ap.add_argument("--levels", default="normal,normal,normal,normal")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--rules", default="all",
                    help="all=全ルール ON / standard=標準 / 個別は on,off 形式")
    args = ap.parse_args(argv)

    levels = [s.strip() for s in args.levels.split(",") if s.strip()]
    if len(levels) < 2:
        print("levels は 2 人以上必要です", file=sys.stderr)
        return 2

    def build_settings():
        s = RuleSettings()
        if args.rules == "standard":
            s.eight_cut = False
            s.torochi = False
        elif args.rules != "all":
            for part in args.rules.split(","):
                part = part.strip()
                if not part:
                    continue
                key, val = part.split("=")
                setattr(s, key.strip(), val.strip() == "on")
        return s

    # 【Claude 2026-10-19 P12】各ラウンドで、順位・打ち切り・1 手ごとの札の数え直し（card_census）を確かめる（05 SP01）。
    #   これまでの「最終ラウンドの card_census を確認」は、手札のリストを辞書の鍵にして TypeError になり、
    #   しかも終わったあと（手札も場も空）にデッキ 54 枚と比べる作りだったので消した。
    exceptions = 0
    census_bad = 0
    for g in range(args.games):
        try:
            st = play_one_stats(levels, args.seed + g, build_settings(), 上限=10000)
            if st["cutoff"]:
                raise RuntimeError("自己対戦が %d 手で終わらなかった（打ち切り。順位は埋めない）" % st["moves"])
            ranks = st["ranks"]
            if sorted(ranks) != list(range(1, len(levels) + 1)):
                exceptions += 1
                print(f"[game {g}] 順位が不正: {ranks}", file=sys.stderr)
            if st["census_mismatch"]:
                exceptions += 1
                census_bad += 1
                手数, 枚数 = st["census_first"]
                print(f"[game {g}] card_census 不一致: {st['census_mismatch']} 手で配った {st['dealt']} 枚と合わない"
                      f"（最初は {手数} 手目・{枚数} 枚）", file=sys.stderr)
        except Exception as e:
            exceptions += 1
            print(f"[game {g}] 例外: {e!r}", file=sys.stderr)

    print(f"games={args.games} levels={args.levels} seed={args.seed} "
          f"rules={args.rules} exceptions={exceptions} census_mismatch_rounds={census_bad}")
    return 0 if exceptions == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
