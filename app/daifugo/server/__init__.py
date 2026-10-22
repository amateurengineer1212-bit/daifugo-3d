"""サーバー部品（設計書 02 §2 server）。rooms と app を再エクスポート。"""
from __future__ import annotations

from daifugo.server import rooms
from daifugo.server import app

__all__ = ["rooms", "app"]
