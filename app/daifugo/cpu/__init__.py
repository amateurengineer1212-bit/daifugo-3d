"""CPU 群。make_cpu(level, rng) で作る（設計書 04 §2）。"""
from __future__ import annotations

import random

from daifugo.cpu.base import CpuPlayer, safe_choose_move, make_cpu

__all__ = ["CpuPlayer", "make_cpu", "safe_choose_move"]
