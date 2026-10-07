# -*- coding: utf-8 -*-
"""对照 YuE2 官方 ABC 方言，检查本机谱的实际写法。

官方参考：multimodal-art-projection/YuE -> skills/yue2-music/references/abc-editing.md
官方明确：发声音符要数 tie 合并后的，不是原始 token。
本探针只报告事实，不改任何谱。
"""
import io
import re
import sys

p = sys.argv[1] if len(sys.argv) > 1 else "gaitian_88042_x_285s.txt"
t = io.open(p, encoding="utf-8").read()

print("== header ==")
for ln in t.split("\n")[:10]:
    print("  ", ln)

print("\n== V: 行 ==")
for ln in t.split("\n"):
    if ln.strip().startswith("V:"):
        print("  ", ln.strip()[:80])

print("\n== 段标记 ==")
print("  ", re.findall(r"^%\s*(\w+)", t, re.M))

# 音符 token：音名 + 可选八度逗号/撇号 + 可选时值数字
note = re.compile(r"\^?\^?_?_?=?[A-Ga-g](?:,+'|'+,?|,)?(\d*)")
raw = [m for m in note.finditer(t)]
print("\n== 音符 ==")
print("  raw token 数        :", len(raw))

# tie：连字符。注意连字符也出现在 C8-C8 这种续音里
tie_lines = [ln.strip() for ln in t.split("\n") if "-" in ln]
print("  含 '-' 的行数       :", len(tie_lines))
print("  '-' 出现总次数      :", t.count("-"))
for ln in tie_lines[:6]:
    print("     ", ln[:90])

# 和弦符号
ch = re.findall(r'"([^"]+)"', t)
print("\n== 和弦符号 ==")
print("  总数:", len(ch), " 去重:", sorted(set(ch))[:24])

# 官方原生和弦词表核对
NATIVE = {"", "m", "dim", "aug", "7", "maj7", "m7", "dim7", "m7b5",
          "sus4", "sus2", "6", "m6", "7sus4", "m(maj7)"}
ROOT = re.compile(r"^([A-G](?:#|b|bb|##)?)(.*)$")
bad = []
for c in ch:
    m = ROOT.match(c)
    if not m:
        bad.append(c)
        continue
    qual = m.group(2).split("/")[0]
    if qual not in NATIVE:
        bad.append(c)
print("  非原生和弦（官方词表外）:", sorted(set(bad)) or "无")

# 官方明确拒绝的构造
print("\n== 官方拒绝的构造是否出现 ==")
checks = {
    "tuplets (3/ 5/ 9 前缀)": re.search(r"(?<![A-Ga-g])([359])\s*[A-Ga-g]", t),
    "repeat signs |: 或 :|": re.search(r"[:|]\s*[:|]", t),
    "alternate endings [1 ]": re.search(r"\[\d", t),
    "slurs ( )": re.search(r"\)", t),
    "w: 歌词字段": re.search(r"^w:", t, re.M),
    "装饰音 ~ !": re.search(r"[~!]", t),
}
for k, v in checks.items():
    print("  %-26s %s" % (k, "出现" if v else "无"))
