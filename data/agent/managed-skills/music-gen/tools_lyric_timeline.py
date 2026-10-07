"""唱词时间轴梳理：分镜之前先跑这一步。

产出一份**逐行唱词时间轴**（JSON + 终端表），让分镜按唱词边界切，
而不是按 5/10/15s 的固定格子切。

时间从哪来 —— 不用 ASR，用**谱**：
  谱头 `Q:1/4=74` + `M:4/4` + `L:1/32` 让每个音符的绝对时间可算（1 单位 = 0.1014s）；
  Vocal 声部逐音记谱，**一个音符 ≈ 一个音节**（实测 404 音符 / 378 音节 = 1.069）。
  于是按音节数在音符序列里定位，就能把每行词钉到 0.1s 精度。
  精度过剩不是问题：合法帧数间隔 17 帧 = 0.708s，优于 0.7s 的精度都用不上。

对齐**按段锚定**，不全局累加 —— 转音会让全局游标漂出几十秒（实测漂过 31s）。
段与唱词的对应关系复用 gaitian_storyboard.SEG_MAP；新项目用 --seg-map 传自己的表，
不去改已验收项目的模块。

跑法：
  python tools_lyric_timeline.py --score scores/xxx.txt --audio song/xxx.flac
  python tools_lyric_timeline.py --score ... --seg-map my_map.json --out runs/v04/timeline.json

硬校验（不过就退出，不静默出垃圾）：
  1. 谱的段标记按出现次序编号后，必须和段映射表的键完全对上；
  2. 谱推算总时长与真实音频时长差 < 5%。对不上说明**这份谱不是这首歌的谱**，
     时间轴不能用 —— 本项目就栽过：manifest 指向的音频在 scores/ 里没有对应谱。
"""
import argparse, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))

# ---- 歌本解析 + 段映射：独立于任何项目模块 --------------------------------
# SEG_MAP 必须由 --seg-map 提供，样例见 templates/segmap.example.json。
class G:
    SEG_MAP = {}
    BOOK = None

    @staticmethod
    def lyrics_sections():
        """取歌本每段歌词，同名段按出现次序编号（verse#1, chorus#1...）。"""
        txt = open(G.BOOK, encoding="utf-8").read()
        body = txt[txt.find("[LYRICS]") + 8:]
        out, cur, n = {}, None, {}
        for ln in body.split("\n"):
            t = ln.strip()
            m = re.match(r"^\[(\w+)\]$", t)
            if m:
                k = m.group(1).lower()
                n[k] = n.get(k, 0) + 1
                cur = "%s#%d" % (k, n[k])
                out[cur] = []
                continue
            if t and cur:
                out[cur].append(t)
        return out

    @staticmethod
    def seg_lines(ly, seg):
        """把该谱段对应的歌本段拼成行列表。缺映射或缺段直接报错，不静默返回空。"""
        keys = G.SEG_MAP.get(seg)
        if keys is None:
            raise SystemExit("SEG_MAP 里没有 %s，先补对照表" % seg)
        out = []
        for k in keys:
            if k not in ly:
                raise SystemExit("歌本里找不到段 %s（%s 需要它）" % (k, seg))
            out.extend(ly[k])
        return out

TOK = re.compile(r'"[^"]*"|([A-Ga-g][,\']*)(\d*)|(Z|z)(\d*)|(-)')


def parse_score(path):
    """返回 (bars, sections, meta)。bars 每项含 idx/start/notes/onsets。"""
    raw = open(path, encoding="utf-8").read()
    M_num, M_den = map(int, re.search(r"^M:(\d+)/(\d+)", raw, re.M).groups())
    L_num, L_den = map(int, re.search(r"^L:(\d+)/(\d+)", raw, re.M).groups())
    Q_num, Q_den, Q_bpm = map(int, re.search(r"^Q:(\d+)/(\d+)=(\d+)", raw, re.M).groups())
    whole_sec = (60.0 / Q_bpm) * (Q_den / Q_num)
    unit_sec = whole_sec * (L_num / L_den)
    bar_units = (M_num / M_den) / (L_num / L_den)

    bars, sections, bad = [], [], []
    staff, t, bar_idx, pending_tie, ties = None, 0.0, 0, False, 0
    for ln in raw.splitlines():
        s = ln.strip()
        if not s:
            continue
        if s.startswith('%'):
            nm = s[1:].strip()
            if nm:
                sections.append([nm, bar_idx, t])
            continue
        if re.match(r'^(X|T|M|L|Q|K|V):', s):
            if s.startswith('V:'):
                staff = 'Vocal' if 'Vocal' in s else 'Ins'
            continue
        if staff != 'Vocal':
            continue
        for chunk in s.split('|'):
            c = chunk.strip()
            if not c:
                continue
            bar_idx += 1
            start, dur_sum, notes, ons = t, 0.0, 0, []
            for m in TOK.finditer(c):
                if m.group(0).startswith('"'):
                    continue                        # 和弦标记
                if m.group(5):
                    pending_tie = True          # 连音线：下一枚是续音，不是新音
                    continue
                if m.group(3):
                    n = int(m.group(4) or 1)
                    n = n * bar_units if m.group(3) == 'Z' else n   # Z = 整小节休止
                    dur_sum += n
                    t += n * unit_sec
                    continue
                dur = int(m.group(2) or 1)
                dur_sum += dur                  # 时值照加，小节必须凑满
                if pending_tie:
                    ties += 1                   # 官方：只数 tie 合并后的发声音符
                    pending_tie = False
                else:
                    ons.append(t)
                    notes += 1
                t += dur * unit_sec
            if abs(dur_sum - bar_units) > 0.51:
                bad.append((bar_idx, dur_sum, bar_units))
            bars.append(dict(idx=bar_idx, start=start, notes=notes, onsets=ons))

    grid = bar_idx * bar_units * unit_sec
    if abs(grid - t) > 0.5:
        raise SystemExit("谱解析不自洽：逐音累加 %.2fs vs 小节网格 %.2fs"
                         "（时值异常小节 %d 个：%s）" % (t, grid, len(bad), bad[:5]))
    meta = dict(bpm=Q_bpm, meter="%d/%d" % (M_num, M_den), unit_sec=round(unit_sec, 5),
                bar_sec=round(bar_units * unit_sec, 5), bars=bar_idx,
                total=round(t, 2), bad_bars=len(bad), ties=ties)
    return bars, sections, meta


def number_sections(sections):
    """段名按出现次序编号：verse -> verse#1, verse#2 ...（段映射表用的就是这套键）"""
    cnt, out = {}, []
    for nm, b, t in sections:
        cnt[nm] = cnt.get(nm, 0) + 1
        out.append(("%s#%d" % (nm, cnt[nm]), b, t))
    return out


def syll(t):
    return len(re.findall(r'[\u4e00-\u9fff]', t))


def audio_dur(path):
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                            "format=duration", "-of", "csv=p=0", path],
                           capture_output=True, text=True, timeout=30)
        return float(r.stdout.strip())
    except Exception as e:
        raise SystemExit("读不到音频时长（%s）。装 ffprobe，或改用 --score-only。"
                         % type(e).__name__)


def legal_frames(dur, fps, cap=None):
    """吸附到 H3 合法帧数：帧数 ≡ 5 (mod 17)，最短 124 帧，取最接近的一个。
    cap 是硬上限（秒），防止吸附后总时长越过歌曲结尾、末段缺音。
    与 comfyui-video-gen 的 h3video.pick_frames 同语义，这里自带一份：skill 独立
    部署时 import 不到那个模块，而原来的 fallback 只进不舍，
    会把每一镜系统性拉长最多 0.7s（实测 158 -> 175 帧）。"""
    lo = max(124, int(round(5.0 * fps)))
    hi = int((cap if cap else 999) * fps)
    cand = [f for f in range(5, 700, 17) if lo <= f <= hi]
    if not cand:
        return lo
    return min(cand, key=lambda f: abs(f / fps - dur))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--score", required=True)
    ap.add_argument("--audio")
    ap.add_argument("--book", default=os.path.join(HERE, "templates", "lyrics.example.txt"),
                    help="歌本（含 [LYRICS] 与 [段名] 标记）")
    ap.add_argument("--seg-map", required=True,
                    help="谱段 -> 歌本段 映射 JSON，必填；样例 templates/segmap.example.json")
    ap.add_argument("--out")
    ap.add_argument("--fps", type=int, default=24)
    ap.add_argument("--cap", type=float, default=15.0, help="剪辑硬上限（秒）")
    ap.add_argument("--score-only", action="store_true", help="跳过音频时长校验")
    a = ap.parse_args()

    bars, sections, meta = parse_score(a.score)
    named = number_sections(sections)
    print("谱      %s" % os.path.basename(a.score))
    print("  %s  Q=1/4=%d  单位 %.4fs  每小节 %.4fs  共 %d 小节  推算 %.2fs"
          % (meta["meter"], meta["bpm"], meta["unit_sec"], meta["bar_sec"],
             meta["bars"], meta["total"]))
    print("  发声音符 %d（已合并 tie 续音 %d 处；官方要求数合并后的，不是原始 token）"
          % (sum(b["notes"] for b in bars), meta["ties"]))

    # ---- 校验 1：段标记必须和映射表完全对上 ----
    if a.seg_map:
        G.SEG_MAP = json.load(open(a.seg_map, encoding="utf-8"))
        print("段映射  用 %s（覆盖 SEG_MAP）" % os.path.basename(a.seg_map))
    keys = [k for k, _, _ in named]
    missing = [k for k in keys if k not in G.SEG_MAP]
    extra = [k for k in G.SEG_MAP if k not in keys]
    if missing or extra:
        raise SystemExit(
            "段标记和映射表对不上：\n  谱里有但表里没有: %s\n  表里有但谱里没有: %s\n"
            "先确认这份谱是不是这首歌的谱，再补映射表。" % (missing, extra))
    print("段标记  %s  <- 全部有映射" % " ".join(keys))

    # ---- 校验 2：谱时长 vs 真实音频 ----
    scale = 1.0
    if not a.score_only:
        if not a.audio:
            raise SystemExit("不给 --audio 就得加 --score-only")
        ad = audio_dur(a.audio)
        rel = abs(meta["total"] - ad) / ad
        print("音频    %s = %.2fs ｜ 谱推算 %.2fs ｜ 差 %+.2fs (%.1f%%)"
              % (os.path.basename(a.audio), ad, meta["total"], ad - meta["total"],
                 rel * 100))
        if rel > 0.05:
            raise SystemExit("谱与音频差 %.1f%% > 5%% —— 这份谱不是这首歌的谱，"
                             "时间轴不能用。（谱要和音频一起归档）" % (rel * 100))
        scale = ad / meta["total"]

    # ---- 按段锚定：段边界由谱标记给出，段内按音节数切该段的音符 ----
    G.BOOK = a.book
    ly = G.lyrics_sections()
    rows, warns = [], []
    for i, (key, b0, t0) in enumerate(named):
        b1 = named[i + 1][1] if i + 1 < len(named) else meta["bars"]
        t1 = named[i + 1][2] if i + 1 < len(named) else meta["total"]
        ons = [o for bb in bars if b0 < bb["idx"] <= b1 for o in bb["onsets"]]
        lines = G.seg_lines(ly, key)
        if not lines:
            rows.append(dict(seg=key, kind="instrumental", text="", syll=0,
                             t0=round(t0 * scale, 2), t1=round(t1 * scale, 2),
                             dur=round((t1 - t0) * scale, 2)))
            continue
        tot = sum(syll(x) for x in lines)
        anchored = bool(ons)
        if anchored:
            ratio = len(ons) / max(1, tot)
            if not (0.7 <= ratio <= 1.4):
                warns.append("%s 音符/音节 = %.2f，该段对齐不可信（转音多或谱词不匹配）"
                             % (key, ratio))
        else:
            warns.append("%s 谱里该段【没有声乐音符】（Vocal 全休止）—— 这几行词谱推不出来。"
                         "下面按段时长均匀放置并标 unanchored：分镜时要么补谱，要么另找时间轴"
                         % key)
        cum = 0
        for ln in lines:
            n = syll(ln)
            if anchored:
                i0 = min(len(ons) - 1, int(round(len(ons) * cum / tot)))
                i1 = min(len(ons) - 1, int(round(len(ons) * (cum + n) / tot)) - 1)
                s0, s1 = ons[i0], ons[max(i0, i1)]
            else:
                # 无锚点才退回均匀放置，且明确标出来，不假装是测出来的
                s0 = t0 + (t1 - t0) * cum / tot
                s1 = t0 + (t1 - t0) * (cum + n) / tot
            rows.append(dict(seg=key, kind="line", text=ln, syll=n, anchored=anchored,
                             t0=round(s0 * scale, 2), t1=round(s1 * scale, 2),
                             dur=round((s1 - s0) * scale, 2)))
            cum += n

    # ---- 每行给出吸附后的合法帧数，分镜可直接取用 ----
    for r in rows:
        if r["kind"] == "line":
            f = legal_frames(r["dur"], a.fps, a.cap)
            r["frames"] = f
            r["snap_dur"] = round(f / a.fps, 3)
            r["over_cap"] = r["snap_dur"] > a.cap

    print("\n%-11s %-36s %4s %8s %8s %7s %6s %8s"
          % ("段", "唱词", "音节", "起s", "末音s", "行长s", "帧", "吸附s"))
    for r in rows:
        if r["kind"] == "instrumental":
            print("%-11s %-36s %4s %8.2f %8.2f %7.2f  <-- 器乐段（空镜/转场放这里）"
                  % (r["seg"], "—", 0, r["t0"], r["t1"], r["dur"]))
        else:
            print("%-11s %-36s %4d %8.2f %8.2f %7.2f %6d %8.3f%s"
                  % (r["seg"], r["text"], r["syll"], r["t0"], r["t1"], r["dur"],
                     r["frames"], r["snap_dur"],
                     (" 超cap" if r["over_cap"] else "") +
                     ("" if r.get("anchored") else " 未锚定(谱无旋律)")))

    durs = [r["dur"] for r in rows if r["kind"] == "line"]
    if durs:
        print("\n行长统计：最短 %.2fs ｜ 最长 %.2fs ｜ 中位 %.2fs ｜ 共 %d 行"
              % (min(durs), max(durs), sorted(durs)[len(durs) // 2], len(durs)))
        print("对比：现有成片镜头时长几乎全是 6.58s —— 均匀假设把上面的起伏抹平了。")
    for w in warns:
        print("!! " + w)

    if a.out:
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        json.dump(dict(score=os.path.abspath(a.score), audio=a.audio, fps=a.fps,
                       cap=a.cap, scale=round(scale, 5), meta=meta, lines=rows),
                  open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print("\n写出 %s" % a.out)


if __name__ == "__main__":
    main()
