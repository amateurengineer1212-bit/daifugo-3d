# 大富豪オンライン 3D

明るいカジノの卓で遊ぶ 3D 大富豪。CPU と、同じ部屋番号の友達と対戦できます。

- 遊ぶ：`https://<サービス名>.onrender.com/3d/`（この URL をスマホで開き「ホーム画面に追加」）
- 部屋を作る → 開始。友達は待合に出る URL（`…/3d/?room=番号`）を開いて参加
- サーバーは Python 標準ライブラリだけ（`app/app.py`・環境変数 PORT で待ち受け）。部屋はメモリ上（再起動で消えます）
- 使った素材・ライブラリの利用条件：`THIRD_PARTY_NOTICES.md`・`third_party_licenses/`
