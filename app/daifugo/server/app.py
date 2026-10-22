# -*- coding: utf-8 -*-
"""大富豪オンライン サーバー（まず遊べる版）"""

import json
import os
import sys
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from daifugo.rules import RuleSettings
from daifugo.server.rooms import create, get, join, start, cleanup, set_settings, set_seat, _ROOMS, _LOCK, _build_state, process_cpu_turn
from daifugo.server.rooms import join_or_reconnect, seat_by_token, lan_ips, public_info, touch
from daifugo.server.rooms import set_rules, enforce_timeout, _maybe_settle, _run_cpu, leave   # 【Claude 2026-10-22 追加要件】ルール・持ち時間・得点  # 【Claude 2026-10-22】同じ Wi-Fi の参加

# 静的ファイルのルート
STATIC_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "static")

# 【2026-10-20 夜・Claude の支援（会長の許可 18:43:19「静的ファイルの配信拡張」）】
#   3D 画面と、取り込んだ部品・素材を配るための入口。配るのは static/3d/ の下の実ファイルだけ。
#   ルールと API の意味は変えない（/api/・/・/app.js・/style.css と、それ以外の道の返事はこれまでどおり）。
STATIC3D_PREFIX = "/3d/"
STATIC3D_ROOT = os.path.join(STATIC_ROOT, "3d")
STATIC3D_TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",   # 【Claude 2026-10-22】ホーム画面のアプリ（PWA）
    ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
    ".hdr": "application/octet-stream", ".ktx2": "image/ktx2", ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json", ".bin": "application/octet-stream", ".woff2": "font/woff2",
    # 【Claude 2026-10-22】BGM と効果音（会長の追加要件）
    ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".m4a": "audio/mp4",
}


def static3d_path(url_path):
    """/3d/… の道を、static/3d/ の中の実ファイルと種類に直す。配らない物は None。"""
    from urllib.parse import unquote
    if url_path == "/3d/":
        rel = "index.html"
    elif url_path.startswith(STATIC3D_PREFIX):
        rel = unquote(url_path[len(STATIC3D_PREFIX):])
    else:
        return None
    if not rel or rel.startswith("/") or any(c in rel for c in ("\\", ":", "\x00")):
        return None
    parts = rel.split("/")
    if any(p in ("", ".", "..") or p.startswith(".") for p in parts):
        return None
    kind = STATIC3D_TYPES.get(os.path.splitext(parts[-1])[1].lower())
    if not kind:
        return None
    root = os.path.realpath(STATIC3D_ROOT)
    full = os.path.realpath(os.path.join(root, *parts))
    if os.path.commonpath([root, full]) != root or not os.path.isfile(full):
        return None
    return full, kind

class RequestHandler(BaseHTTPRequestHandler):
    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        # 【Claude 2026-10-22】iPhone の Safari が同じ URL の GET（/state の 1 秒ごとの読み）を端末の控えから返して、
        #   参加者が待合のまま止まる（実機で発生）。通信の返事は一切控えに残させない
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        body = self.rfile.read(length).decode("utf-8")
        return json.loads(body)

    def _get_token(self, query_params):
        return query_params.get("token", [None])[0]

    def _serve_file(self, path, content_type):
        full_path = os.path.join(STATIC_ROOT, path.lstrip("/"))
        if not os.path.exists(full_path):
            self.send_response(404)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"Not Found")
            return
        try:
            with open(full_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(str(e).encode("utf-8"))

    def _find_seat_by_token(self, room, token):
        """トークンから席を特定する"""
        for seat in room.seats:
            if seat.token == token:
                return seat
        return None

    def _lan(self):
        """【Claude 2026-10-22】参加用 URL の材料（この機械の LAN の IP と、待ち受けの番号）。"""
        try:
            port = int(self.server.server_address[1])
        except Exception:
            port = 8123
        return {"ips": lan_ips(), "port": port}

    def do_HEAD(self):
        """【Claude 2026-10-22】音のファイルの HEAD（長さの問い合わせ）に、頭だけ返す。"""
        found = static3d_path(urlparse(self.path).path)
        if not found:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", found[1])
        self.send_header("Content-Length", str(os.path.getsize(found[0])))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        # Q01: 健康チェック
        if path == "/api/health":
            with _LOCK:
                n = len(_ROOMS)
            self._send_json({"ok": True, "rooms": n})
            return

        # 【Claude 2026-10-22】部屋の公開情報（設計書 02：GET /api/room/{code}。席と人数だけ。手札は無い）
        if path.startswith("/api/room/") and path.count("/") == 3:
            code = path.split("/")[3]
            with _LOCK:
                room_obj = _ROOMS.get(code)
            if not room_obj:
                self._send_json({"ok": False, "reason": "Room not found"})
                return
            info = public_info(room_obj)
            info["ok"] = True
            info["lan"] = self._lan()
            self._send_json(info)
            return

        # Q03: 状態取得
        if path.startswith("/api/room/") and path.endswith("/state"):
            parts = path.split("/")
            if len(parts) != 5:
                self._send_json({"ok": False, "reason": "Invalid path"})
                return
            code = parts[3]
            token = query.get("token", [None])[0]
            if not token:
                self._send_json({"ok": False, "reason": "Token required"})
                return

            with _LOCK:
                room_obj = _ROOMS.get(code)
            
            if not room_obj:
                self._send_json({"ok": False, "reason": "Room not found"})
                return
            
            # トークン検証：ホストまたは自分のトークン
            if room_obj.host_token != token:
                found = False
                for seat in room_obj.seats:
                    if seat.token == token:
                        found = True
                        break
                if not found:
                    self._send_json({"ok": False, "reason": "Invalid token"})
                    return

            # 【Claude 2026-10-22】token で自分の席を決め、自分の手札だけを返す
            with room_obj.lock:
                touch(room_obj, token)
                # 持ち時間（01 §7）：人間の手番が切れていたら自動の手
                enforce_timeout(room_obj)
                # 人間が全員上がって CPU だけが残ったとき（CPU の連鎖は 50 手で一度止まる）は、状態を読むたびに CPU の手番を進める。
                #   人間がまだ残っているときは進めない（他人の手番の確かめ Q04 の前提を変えないため。その場合の CPU は行動の直後に進む）
                g = room_obj.game
                if g is not None and g.turn is not None and len(getattr(g, "finished", [])) < room_obj.seat_count \
                        and 0 <= g.turn < len(room_obj.seats) and room_obj.seats[g.turn].kind == "cpu" \
                        and all((s.kind != "human") or (s.index in getattr(g, "finished", [])) for s in room_obj.seats):
                    _run_cpu(room_obj)
                _maybe_settle(room_obj)
                state = _build_state(room_obj, token)
            self._send_json({"ok": True, "state": state})
            return

        # 【2026-10-20 夜】3D 画面の静的ファイル（static/3d/ の下だけ）
        if path == "/3d":
            self.send_response(301)
            self.send_header("Location", "/3d/")
            self.end_headers()
            return
        if path.startswith(STATIC3D_PREFIX):
            found = static3d_path(path)
            if not found:
                self.send_response(404)
                self.send_header("Content-Type", "text/plain")
                self.end_headers()
                self.wfile.write(b"Not Found")
                return
            with open(found[0], "rb") as f:
                content = f.read()
            total = len(content)
            # 【Claude 2026-10-22】音（BGM）は iPhone の Safari が Range（部分）で読むので、bytes=a-b に 206 で応える
            rng = self.headers.get("Range")
            start, end = 0, total - 1
            partial = False
            if rng and rng.startswith("bytes=") and found[1].startswith("audio/"):
                try:
                    a, b = rng[6:].split("-", 1)
                    start = int(a) if a else max(0, total - int(b))
                    end = int(b) if (a and b) else (total - 1)
                    end = min(end, total - 1)
                    partial = 0 <= start <= end
                except ValueError:
                    partial = False
            if partial:
                self.send_response(206)
                self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, total))
                body = content[start:end + 1]
            else:
                self.send_response(200)
                body = content
            self.send_header("Content-Type", found[1])
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", "no-cache" if not found[1].startswith("audio/") else "max-age=3600")   # 古い main.js が残らないように（設計書 02）
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return

        # 静的ファイル (/app.js, /style.css)
        if path.startswith("/"):
            if path == "/":
                self._serve_file("/index.html", "text/html")
            elif path == "/app.js":
                self._serve_file("/app.js", "application/javascript")
            elif path == "/style.css":
                self._serve_file("/style.css", "text/css")
            else:
                self._send_json({"ok": False, "reason": "Not found"})
            return

        self._send_json({"ok": False, "reason": "Not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        body = self._read_body()

        # Q02: 部屋作成（【Claude 2026-10-22】seat_count＝合計人数 4・5・6 を受け取る。無ければ 4）
        if path == "/api/room":
            name = body.get("name", "Player")
            avatar = body.get("avatar", "")
            settings_dict = body.get("settings", {})
            seat_count = body.get("seat_count", 4)
            room_obj = create(name, avatar, settings_dict, seat_count)
            self._send_json({
                "ok": True,
                "code": room_obj.code,
                "token": room_obj.host_token,
                "seat": 0,
                "seat_count": room_obj.seat_count,
                "lan": self._lan(),
                "state": _build_state(room_obj, room_obj.host_token)
            })
            return

        # 【Claude 2026-10-22】参加（設計書 02：POST /api/room/{code}/join {name, avatar, token?} → {token, seat}。同じ token なら再接続）
        if path.startswith("/api/room/") and path.endswith("/join"):
            parts = path.split("/")
            if len(parts) != 5:
                self._send_json({"ok": False, "reason": "Invalid path"})
                return
            code = parts[3]
            seat, reason = join_or_reconnect(code, body.get("name", "Player"), body.get("avatar", ""), body.get("token"))
            if seat is None:
                self._send_json({"ok": False, "reason": reason})
                return
            with _LOCK:
                room_obj = _ROOMS.get(code)
            with room_obj.lock:
                state = _build_state(room_obj, seat.token)
            self._send_json({
                "ok": True,
                "code": code,
                "token": seat.token,
                "seat": seat.index,
                "seat_count": room_obj.seat_count,
                "lan": self._lan(),
                "state": state
            })
            return

        # 【Claude 2026-10-22 実機の要望】退出（POST /api/room/{code}/leave {token}）：席は CPU に戻る。ホストなら次の人間へ引き継ぐ。人間が 0 なら部屋を消す
        if path.startswith("/api/room/") and path.endswith("/leave"):
            parts = path.split("/")
            if len(parts) != 5:
                self._send_json({"ok": False, "reason": "Invalid path"})
                return
            ok, reason = leave(parts[3], body.get("token"))
            self._send_json({"ok": ok, "reason": reason})
            return

        # 【Claude 2026-10-22 追加要件 7】ルール設定（設計書 02：POST /api/room/{code}/settings {token, settings, seat_count}。ホストだけ・開始前）
        if path.startswith("/api/room/") and path.endswith("/settings"):
            parts = path.split("/")
            if len(parts) != 5:
                self._send_json({"ok": False, "reason": "Invalid path"})
                return
            code = parts[3]
            token = body.get("token")
            with _LOCK:
                room_obj = _ROOMS.get(code)
            if not room_obj:
                self._send_json({"ok": False, "reason": "Room not found"})
                return
            if not token or room_obj.host_token != token:
                self._send_json({"ok": False, "reason": "ルールを変えられるのは部屋を作った人だけです"})
                return
            ok, reason = set_rules(room_obj, body.get("settings") or {}, body.get("seat_count"))
            if not ok:
                self._send_json({"ok": False, "reason": reason})
                return
            with room_obj.lock:
                state = _build_state(room_obj, token)
            self._send_json({"ok": True, "settings": room_obj.settings.to_dict(), "seat_count": room_obj.seat_count, "state": state})
            return

        # Q02: 開始
        if path.startswith("/api/room/") and path.endswith("/start"):
            parts = path.split("/")
            if len(parts) != 5:
                self._send_json({"ok": False, "reason": "Invalid path"})
                return
            code = parts[3]
            token = body.get("token")
            if not token:
                self._send_json({"ok": False, "reason": "Token required"})
                return

            with _LOCK:
                room_obj = _ROOMS.get(code)
            
            if not room_obj:
                self._send_json({"ok": False, "reason": "Room not found"})
                return
            
            # トークン検証：ホストのトークン（【Claude 2026-10-22】退出で引き継がれるので席 0 ではなく room.host_token で見る）
            if room_obj.host_token != token:
                self._send_json({"ok": False, "reason": "Invalid token"})
                return
            
            # 開始処理（rooms.py の start 関数を使用）
            result = start(token)
            if not result:
                # 【Claude 2026-10-22】対戦の途中は始め直さない（round_end のあとの「もう一度」は通る）
                self._send_json({"ok": False, "reason": "対戦中は始め直せません"})
                return

            self._send_json({"ok": True, "state": result})
            return

        # Q04: アクション（プレイ/パス）
        if path.startswith("/api/room/") and path.endswith("/action"):
            parts = path.split("/")
            if len(parts) != 5:
                self._send_json({"ok": False, "reason": "Invalid path"})
                return
            code = parts[3]
            token = body.get("token")
            action_type = body.get("type", "play")
            cards = body.get("cards", [])

            if not token:
                self._send_json({"ok": False, "reason": "Token required"})
                return

            with _LOCK:
                room_obj = _ROOMS.get(code)
            
            if not room_obj:
                self._send_json({"ok": False, "reason": "Room not found"})
                return

            # トークンから席を特定
            my_seat = self._find_seat_by_token(room_obj, token)
            if not my_seat:
                self._send_json({"ok": False, "reason": "Invalid token"})
                return

            # 【Claude 2026-10-22】複数の端末から同時に届いても、1 つずつ処理する（部屋の錠の中で判定から state まで）
            with room_obj.lock:
                self._action_locked(room_obj, my_seat, action_type, cards, token)
            return

        self._send_json({"ok": False, "reason": "Not found"})

    def _action_locked(self, room_obj, my_seat, action_type, cards, token):
        """Q04 の行動（部屋の錠を持った状態で呼ぶ）。play／pass はこれまでどおり。
        【Claude 2026-10-22 追加要件】give（7渡し）／discard（10捨て）／bomb（12ボンバー・ranks）／exchange_back（交換の返し）を足した。"""
        game = room_obj.game
        if not game:
            self._send_json({"ok": False, "reason": "Not started"})
            return
        enforce_timeout(room_obj)
        try:
            a = game.awaiting
            if action_type in ("give", "discard", "bomb", "exchange_back"):
                if not a or a.get("type") != action_type or a.get("seat") != my_seat.index:
                    self._send_json({"ok": False, "reason": "いまは %s の番ではありません" % action_type})
                    return
                if action_type == "give":
                    ok = game.give(my_seat.index, cards)
                elif action_type == "discard":
                    ok = game.discard(my_seat.index, cards)
                elif action_type == "bomb":
                    ok = game.bomb(my_seat.index, self._ranks_arg(cards))
                else:
                    ok = game.exchange_back(my_seat.index, cards)
                if not ok:
                    self._send_json({"ok": False, "reason": "選び方が正しくありません（枚数・手札）"})
                    return
            else:
                if a is not None:
                    self._send_json({"ok": False, "reason": "先に %s を選んでください" % a.get("type")})
                    return
                if game.turn != my_seat.index:
                    self._send_json({"ok": False, "reason": "Not your turn"})
                    return
                if action_type == "play":
                    if not cards:
                        self._send_json({"ok": False, "reason": "No cards specified"})
                        return
                    my_hand = game.hands[my_seat.index] if game.hands else []
                    if my_hand is None:
                        my_hand = []
                    for card in cards:
                        if card not in my_hand:
                            self._send_json({"ok": False, "reason": "Card not in hand"})
                            return
                    success = game.play(cards, my_seat.index)
                    if not success:
                        self._send_json({"ok": False, "reason": getattr(game, "last_reason", "") or "Invalid move"})
                        return
                elif action_type == "pass":
                    if not game.can_pass(my_seat.index):
                        self._send_json({"ok": False, "reason": "Cannot pass"})
                        return
                    success = game.pass_(my_seat.index)
                    if not success:
                        self._send_json({"ok": False, "reason": "Cannot pass"})
                        return
                else:
                    self._send_json({"ok": False, "reason": "Unknown action"})
                    return
            # CPU の手番（待ちを含む）を、人間の番か終わりまで進める
            _run_cpu(room_obj)
            _maybe_settle(room_obj)
            room_obj.last_active = time.time()
            state = _build_state(room_obj, token)
            self._send_json({"ok": True, "state": state})
        except Exception as e:
            self._send_json({"ok": False, "reason": f"Error: {str(e)}"})
        return

    @staticmethod
    def _ranks_arg(cards):
        """12ボンバーの数字（"3"〜"A"・"2"・"JOKER"。札の名前 'S3' のような物も受け取る）。"""
        out = []
        for c in (cards or []):
            c = str(c).upper()
            if c.startswith("X") or c == "JOKER":
                out.append("JOKER")
            elif c[:1] in ("S", "H", "D", "C") and len(c) > 1:
                out.append(c[1:])
            else:
                out.append(c)
        return out


def make_server(port: int = 8080):
    """サーバーを起動"""
    server = HTTPServer(("127.0.0.1", port), RequestHandler)
    return server


def main():
    port = 8080
    for i, arg in enumerate(sys.argv):
        if arg == "--port" and i + 1 < len(sys.argv):
            port = int(sys.argv[i + 1])

    server = make_server(port)
    print(f"サーバー起動：http://127.0.0.1:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nサーバー停止")
        server.shutdown()


if __name__ == "__main__":
    main()
