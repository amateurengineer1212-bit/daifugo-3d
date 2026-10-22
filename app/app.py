# -*- coding: utf-8 -*-
"""下見（QwenChat の preview_start）用の起動口（Claude・2026-10-19 夜）

- preview_start は小部屋（Docker）の中で「python app.py」を動かし、環境変数 PORT と HOST（0.0.0.0）を渡す。
  小部屋の外（Windows 側のブラウザ）から見えるように、HOST で待ち受ける。
- ゲームの中身（daifugo）は変えない。ふだんの起動はこれまでどおり run.py。
"""
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from http.server import ThreadingHTTPServer  # noqa: E402
from daifugo.server.app import RequestHandler  # noqa: E402

if __name__ == "__main__":
    # 【Claude 2026-10-22 会長の最終依頼】同じ Wi-Fi の友達も使う起動口。
    #   HOST 0.0.0.0（LAN から届く）・PORT 8123。--port 番号 でも変えられる。
    #   複数の端末が同時に読むので ThreadingHTTPServer（設計書 02）。部屋ごとの錠は daifugo/server/app.py が持つ。
    port = int(os.environ.get("PORT", "8123"))
    host = os.environ.get("HOST", "0.0.0.0")
    for i, a in enumerate(sys.argv):
        if a == "--port" and i + 1 < len(sys.argv):
            port = int(sys.argv[i + 1])
        if a == "--host" and i + 1 < len(sys.argv):
            host = sys.argv[i + 1]
    print("起動口: http://%s:%d/  （3D 対戦画面は /3d/ ）" % (host, port), flush=True)
    try:
        from daifugo.server.rooms import lan_ips
        for ip in lan_ips():
            print("同じ Wi-Fi からは: http://%s:%d/3d/" % (ip, port), flush=True)
    except Exception:
        pass
    ThreadingHTTPServer((host, port), RequestHandler).serve_forever()
