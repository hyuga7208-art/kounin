#!/usr/bin/env python3
"""問題画像の確認：各科目HTMLの EXAMS が参照する画像が img/科目/回/画像ID.png にそろっているかを調べる。

使い方: python3 tools/check_images.py
問題があれば NG を表示して終了コード 1 で終わる。
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PNG = b"\x89PNG\r\n\x1a\n"

ng = 0
for subj in ["math", "physics", "chemistry"]:
    html = (ROOT / f"{subj}.html").read_text(encoding="utf-8")
    if "data:image" in html:
        print(f"NG {subj}.html に data URI の画像が残っています")
        ng += 1
    exams = json.loads(re.search(r"^const EXAMS = (\[.*\]);$", html, re.M).group(1))
    refs = set()
    for E in exams:
        for q in E["Q"]:
            # 数学は問題IDがそのまま画像ID。物理・化学は ctx（文章・図）と main（解く問題）がブロックIDを指す
            for iid in [q["id"]] if subj == "math" else q["ctx"] + [q["main"]]:
                p = ROOT / "img" / subj / E["key"] / f"{iid}.png"
                refs.add(p)
                if not p.is_file() or p.read_bytes()[:8] != PNG:
                    print(f"NG {subj} {E['key']} 問題{q['id']}: {p.relative_to(ROOT)} がないか、PNGではありません")
                    ng += 1
    files = set((ROOT / "img" / subj).glob("*/*.png"))
    print(f"{subj}: {len(exams)}回・{sum(len(E['Q']) for E in exams)}問、参照している画像 {len(refs)}枚、"
          f"画像ファイル {len(files)}枚（どの問題からも参照されていないもの {len(files - refs)}枚）")

print("NG " + str(ng) + "件" if ng else "OK")
sys.exit(1 if ng else 0)
