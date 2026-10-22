import sys
import os

# app/ をパスに通す
ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

# 【Claude 2026-10-19】直接動かしたときだけ実行する。これまでは読み込まれただけでサーバーを立てていたので、
#   pytest が app 全体を集めるときに止まっていた（P6）。中身は変えていない。
if __name__ == "__main__":
    # daifugo.server.app.main を実行
    from daifugo.server.app import main

    # --test-mode --port 8080 で実行
    sys.argv = ['test', '--test-mode', '--port', 8080]
    try:
        main()
        print("SUCCESS: 正常終了")
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()