"""出谱 -> 出歌（YuE2 两段式；MV 交给 comfyui-video-gen）

阶段：
  score   只跑 YuE2GenerateABC，出谱 + 落盘 + 算谱时长。不跑扩散，省 GPU。
  song    用上一步的谱跑 YuE2GenerateMusic，出 flac。
  all     score 然后 song。

为什么不复用 h3video.wait()：
  它只收集 outputs[*].gifs（h3video.py:191-192），而 SaveAudioAdvanced 的产物在
  outputs[*].audios、SaveText 在 outputs[*].text —— 拿它等音频会一路轮询到超时，
  而实际早就跑完了。这里自己写 wait_out()，按 types 收。

地址/认证/代理全部复用 h3video 的 server()/_opener()/_hdr()：
  本机 127.0.0.1:8188 免认证；ProxyHandler({}) 强制直连，绕开系统代理劫持。

ABC 时长估算（实测校准过，见 SKILL.md 与 scores/）：
  每小节秒数 = 4 * 60 / Q的BPM   （M:4/4, L 不参与，一拍 = 1/4 拍）
  谱总时长   = 小节数 * 每小节秒数
  两声部（Vocal + Ins）各占一份小节，取两声部小节数之和 / 2 近似整曲小节数。
  仅作 max_duration 参考；真实时长以 YuE2GenerateMusic 输出的 seconds 为准。
"""
import json, os, re, sys, time, urllib.request
from urllib.request import ProxyHandler, build_opener

HERE = os.path.dirname(os.path.abspath(__file__))

# ---- ComfyUI 端点：自带发现逻辑，不依赖 comfyui-video-gen ------------------
# 本机与远端是【同一台】ComfyUI：本机走 127.0.0.1:8188（免认证），
# 公网地址开了 Basic Auth。解析顺序：
#   COMFY_H3_URL > COMFY_URL > comfy-endpoint.txt > 127.0.0.1
# 解析到非本机地址又没给凭据时自动退回 127.0.0.1（同机免认证，最省事）——
# 少了这条回退，没设凭据的环境会直接 401。
COMFY_ROOT = os.environ.get('COMFY_ROOT', 'D:/AI/COMFYUI/ComfyUI')
_LOCAL = 'http://127.0.0.1:8188'
_CACHE = {}


def _is_loopback(u):
    return ('://127.0.0.1' in u or '://localhost' in u
            or '://[::1]' in u or '://0.0.0.0' in u)


def server():
    if 'v' in _CACHE:
        return _CACHE['v']
    u = (os.environ.get('COMFY_H3_URL') or os.environ.get('COMFY_URL') or '').strip()
    if not u:
        for f in ('G:/Tiffa/data/agent/comfy-endpoint.txt',
                  os.path.expanduser('~/.tiffa/comfy-endpoint.txt')):
            if os.path.isfile(f):
                try:
                    u = open(f, encoding='utf-8').read().strip()
                    break
                except Exception:
                    pass
    r = _LOCAL
    if u:
        u = u.rstrip('/')
        if _is_loopback(u) or (os.environ.get('COMFY_USER') and os.environ.get('COMFY_PASS')):
            r = u
        else:
            print('  %s 需要 Basic Auth 但未设 COMFY_USER/COMFY_PASS -> 改用本机 %s（同一台机器，免认证）'
                  % (u, _LOCAL), flush=True)
    _CACHE['v'] = r
    return r


def _hdr(extra=None):
    """公网端点开了 Basic Auth，凭据走 COMFY_USER / COMFY_PASS；本机免认证留空。"""
    h = {}
    u, p = os.environ.get('COMFY_USER'), os.environ.get('COMFY_PASS')
    if u and p:
        import base64
        h['Authorization'] = 'Basic ' + base64.b64encode(('%s:%s' % (u, p)).encode()).decode()
    if extra:
        h.update(extra)
    return h


def _dur(path):
    import subprocess
    r = subprocess.run(['ffprobe', '-v', 'error', '-print_format', 'json',
                        '-show_format', '-show_streams', path],
                       capture_output=True, text=True)
    try:
        j = json.loads(r.stdout)
    except Exception:
        return None
    a = [x for x in j['streams'] if x['codec_type'] == 'audio']
    return {'adur': float(a[0].get('duration', 0)) if a else None}


class _H:                      # 让下面原有 H.xxx() 调用一行都不用改
    COMFY_ROOT = COMFY_ROOT
    server = staticmethod(server)
    _hdr = staticmethod(_hdr)
    _dur = staticmethod(_dur)


H = _H

# ---- 换一首歌只改这三行（或设同名环境变量）--------------------------------
# SEED 是身份的一部分：换 seed 等于换一首歌，不是"同一首歌重跑一次"。
CKPT = os.environ.get('YUE2_CKPT', 'yue2_3b_int8_convrot.safetensors')
SEED = int(os.environ.get('SONG_SEED', '88042'))
SONGNAME = os.environ.get('SONG_NAME', 'gaitian')

SONG = os.path.join(HERE, 'song')
LYRICS = os.path.join(SONG, 'lyrics.txt')
STYLE = os.path.join(SONG, 'style.txt')
SCORE_DIR = os.path.join(HERE, 'scores')
OUT_DIR = os.path.join(COMFY_ROOT, 'output')

# 必须绕过系统代理：Windows 上 urllib 读注册表代理，ProxyOverride 不含公网 IP，
# 发往远端 8188 的请求会被丢给本地代理端口，回 WinError 10061，看着像服务器挂了。
_op = build_opener(ProxyHandler({}))


def _get(path, timeout=90):
    url = H.server() + path
    req = urllib.request.Request(url, headers=H._hdr())
    try:
        return json.loads(_op.open(req, timeout=timeout).read())
    except urllib.error.HTTPError as e:
        hint = ('401/403：公网端点要设 COMFY_USER / COMFY_PASS（Basic Auth）'
                if e.code in (401, 403) else '响应体 %s' % e.read().decode()[:300])
        sys.exit('GET %s 失败 HTTP %s\n%s' % (url, e.code, hint))
    except urllib.error.URLError as e:
        sys.exit('连不上 %s：%s\n查 ComfyUI 是否在跑、端点文件或 COMFY_URL 是否正确。'
                 '本请求已清空系统代理，不是代理拦的。' % (url, e.reason))


def post(wf, tag=''):
    req = urllib.request.Request(
        H.server() + '/prompt',
        data=json.dumps({'prompt': wf}).encode(),
        headers=H._hdr({'Content-Type': 'application/json'}))
    try:
        pid = json.loads(_op.open(req, timeout=90).read())['prompt_id']
        print('  提交 %-12s -> %s' % (tag, pid), flush=True)
        return pid
    except urllib.error.HTTPError as e:
        print('  提交失败 %s: HTTP %s\n%s' % (tag, e.code, e.read().decode()[:2000]),
              flush=True)
        return None


def wait_out(pid, want=('audio',), timeout=2400):
    """按 outputs[*].<want> 收产物。

    键名以 /history 实证为准（不是猜的）：
      SaveAudioAdvanced -> 'audio'  单数！项含 filename/subfolder
      SaveText          -> 'text'   谱内容字符串本身
                        -> 'files'  项含 file/subfolder（落盘位置）
      VHS_VideoCombine  -> 'gifs'
    注意 h3video.wait() 只认 gifs，所以等音频/文本不能用它。
    """
    t0 = time.time()
    while time.time() - t0 < timeout:
        time.sleep(8)
        try:
            h = _get('/history/' + pid)
        except Exception:
            continue
        if pid not in h:
            continue
        rec = h[pid]
        st = rec.get('status', {})
        if st.get('status_str') == 'error':
            for m in st.get('messages', []):
                print('  运行错误:', json.dumps(m, ensure_ascii=False)[:600], flush=True)
            return None, True
        got = {}
        for o in rec.get('outputs', {}).values():
            for k in want:
                if o.get(k):
                    got.setdefault(k, []).extend(o[k] if isinstance(o[k], list) else [o[k]])
        if all(k in got for k in want):
            def nm(x):
                return (x.get('filename') or x.get('file')) if isinstance(x, dict) \
                    else '<%d 字符>' % len(x)
            print('  ✓ %.0fs %s' % (time.time() - t0,
                  ' | '.join('%s:%s' % (k, [nm(x) for x in got[k]]) for k in want)),
                  flush=True)
            return got, False
    print('  超时 %s' % pid, flush=True)
    return None, True


# ═════════════════════════ 工作流 ═════════════════════════
def wf_score(style, lyrics, seed=SEED, mode='full'):
    """只出谱 + 落盘。3 节点。"""
    return {
        '1': {'class_type': 'CheckpointLoaderSimple',
              'inputs': {'ckpt_name': CKPT}},
        '2': {'class_type': 'YuE2GenerateABC',
              'inputs': {'clip': ['1', 1], 'style': style, 'lyrics': lyrics,
                         'seed': seed, 'mode': mode, 'max_abc_tokens': 8192,
                         'temperature': 0.7, 'top_p': 0.9, 'top_k': 30,
                         'repetition_penalty': 1.005, 'penalty_window': 100}},
        '3': {'class_type': 'SaveText',
              'inputs': {'text': ['2', 0], 'filename_prefix': 'YuE2/' + SONGNAME,
                         'format': 'txt'}},
    }


def wf_song(style, lyrics, abc, seconds, seed=SEED, mode='full'):
    """按谱出歌。max_duration 必须 >= 谱估算秒数，否则中途被切。"""
    md = max(60.0, float(int(seconds * 1.35) / 10) * 10)   # 估时 +35%，向上取 10s
    return {
        '1': {'class_type': 'CheckpointLoaderSimple', 'inputs': {'ckpt_name': CKPT}},
        '2': {'class_type': 'YuE2GenerateMusic',
              'inputs': {'clip': ['1', 1], 'style': style, 'lyrics': lyrics,
                         'abc': abc, 'seed': seed, 'mode': mode,
                         'max_duration': md, 'temperature': 1.0, 'top_p': 0.95,
                         'top_k': 100, 'repetition_penalty': 1.2, 'cfg_scale': 1.0}},
        '3': {'class_type': 'EmptyYuE2LatentAudio',
              'inputs': {'seconds': ['2', 1], 'batch_size': 1}},
        '4': {'class_type': 'ConditioningZeroOut', 'inputs': {'conditioning': ['2', 0]}},
        '5': {'class_type': 'KSampler',
              'inputs': {'seed': seed, 'steps': 32, 'cfg': 1.0,
                         'sampler_name': 'dpm_2', 'scheduler': 'sgm_uniform',
                         'denoise': 1.0, 'model': ['1', 0], 'positive': ['2', 0],
                         'negative': ['4', 0], 'latent_image': ['3', 0]}},
        '6': {'class_type': 'VAEDecodeAudio',
              'inputs': {'samples': ['5', 0], 'vae': ['1', 2]}},
        '7': {'class_type': 'SaveAudioAdvanced',
              'inputs': {'audio': ['6', 0], 'filename_prefix': 'audio/' + SONGNAME,
                         'format': 'flac'}},
    }, md


# ═════════════════════════ ABC 时长估算（已用 4 张真谱校准）═════════════════════════
# 校准见 calibrate_abc.py。实测/估算系数 0.90~0.97，均值 0.94，离散度 7.6%。
# 两个曾踩的坑：
#   1. `Z4|` 是 4 小节只含 1 个 `|`，按 | 数会漏掉全部压缩休止（melody 谱伴奏
#      几乎全是 Z，误差最大到 20 倍）。
#   2. `^V:` 出现次数是声部切换次数（实测 12~38），不是声部个数（真值 2）。
ABC_K = 0.94          # 实测/估算 系数均值


def abc_stats(abc):
    """按声部分组累计小节数（Z n 记 n 小节），取最长声部。"""
    m = re.search(r'^M:(\d+)/(\d+)\s*$', abc, re.M)
    num, den = (int(m.group(1)), int(m.group(2))) if m else (4, 4)
    q = re.search(r'^Q:1/4=(\d+)', abc, re.M)
    bpm = float(q.group(1)) if q else 120.0
    per_bar = num * 4.0 / den * 60.0 / bpm      # 对 6/8 等复合拍号也正确
    bars, cur = {}, None
    for ln in abc.split('\n'):
        s = ln.strip()
        if not s or s.startswith('%'):
            continue
        vm = re.match(r'^V:\s*(\S+)', s)
        if vm:
            cur = vm.group(1)
            bars.setdefault(cur, 0)
            s = s[vm.end():].strip()
            if not s:
                continue
        if cur is None:
            continue
        nsep = len(re.findall(r'[|:\[\]]', s))
        zextra = sum(int(z.group(1)) - 1 for z in re.finditer(r'Z(\d+)', s))
        bars[cur] += nsep + zextra
    longest = max(bars.values()) if bars else 0
    est = longest * per_bar
    return {'meter': '%d/%d' % (num, den), 'bpm': bpm, 'per_bar': round(per_bar, 4),
            'bars_per_voice': bars, 'bars': longest,
            'est_sec': round(est, 2), 'real_sec': round(est * ABC_K, 2),
            'chars': len(abc), 'lines': abc.count('\n') + 1,
            'key': (re.search(r'^K:(\S+)', abc, re.M) or [None, '?'])[1],
            'title': (re.search(r'^T:(.*)$', abc, re.M) or [None, ''])[1].strip()}


BOOK = os.path.join(SONG, SONGNAME + '.txt')


def _split_book(raw):
    """歌本 -> (style, lyrics)。[STYLE] / [LYRICS] 必须独占一行才认。
    歌词体本身含 [Verse]/[Chorus] 等段标记，故 lyrics = 最后一个标记之后的全部。"""
    marks = ('[STYLE]', '[LYRICS]')
    lines = raw.splitlines()
    hit = [(i, ln.strip()) for i, ln in enumerate(lines) if ln.strip() in marks]
    if not hit:
        return None, None
    d = {}
    for n, (i, tag) in enumerate(hit):
        end = hit[n + 1][0] if n + 1 < len(hit) else len(lines)
        d[tag] = '\n'.join(lines[i + 1:end]).strip()
    return d.get('[STYLE]', ''), d.get('[LYRICS]', '')


def read_assets():
    """优先读单文件歌本 song/<SONGNAME>.txt；无则回退 style.txt + lyrics.txt。"""
    if os.path.exists(BOOK):
        style, lyrics = _split_book(open(BOOK, encoding='utf-8').read())
        if style and lyrics:
            print('来源  %s（歌本）' % BOOK)
            return style, lyrics
        sys.exit('歌本 %s 存在但缺 [STYLE] 或 [LYRICS] 段' % BOOK)
    if not (os.path.exists(LYRICS) and os.path.exists(STYLE)):
        sys.exit(
            "找不到输入，二选一：\n"
            "  1) song/%s.txt        单文件歌本，含 [STYLE] 与 [LYRICS] 段（推荐）\n"
            "  2) song/style.txt + song/lyrics.txt\n"
            "样例见 templates/lyrics.example.txt 与 templates/style.example.txt。"
            "换歌名设 SONG_NAME 环境变量。\n已找过：%s ；%s ；%s"
            % (SONGNAME, BOOK, STYLE, LYRICS))
    lyrics = open(LYRICS, encoding='utf-8').read().strip()
    style = open(STYLE, encoding='utf-8').read().strip()
    if not lyrics or not style:
        sys.exit('lyrics.txt / style.txt 不能为空')
    print('来源  style.txt + lyrics.txt')
    return style, lyrics


def cmd_score(a):
    style, lyrics = read_assets()
    print('歌词 %d 字 / 风格 %d 字 / seed=%d mode=%s' % (len(lyrics), len(style), a.seed, a.mode))
    pid = post(wf_score(style, lyrics, a.seed, a.mode), 'score')
    if not pid:
        sys.exit(1)
    # text=谱内容本身，files=落盘位置（实证键名，见 wait_out docstring）
    got, err = wait_out(pid, ('text', 'files'))
    if err:
        sys.exit(1)
    abc = got['text'][-1]
    f = got['files'][-1]
    # 实证：files 项字段是 filename（与 SaveAudioAdvanced 一致），不是 file
    p = os.path.join(OUT_DIR, f.get('subfolder', ''), f.get('filename') or f['file'])
    st = abc_stats(abc)
    print('\n=== 谱 ===')
    for k in ('chars', 'lines', 'meter', 'key', 'bpm', 'per_bar', 'bars',
              'bars_per_voice', 'est_sec', 'real_sec'):
        print('  %-14s %s' % (k, st[k]))
    print('  ComfyUI 落盘 %s' % p)
    print('  存在         %s' % os.path.isfile(p))
    # 同时抄一份进项目 scores/，带估算秒数命名，跟已有 4 张一致
    os.makedirs(SCORE_DIR, exist_ok=True)
    dst = os.path.join(SCORE_DIR, '%s_%d_x_%ds.txt' % (SONGNAME, a.seed, int(st['est_sec'])))
    open(dst, 'w', encoding='utf-8').write(abc)
    print('  副本       %s' % dst)
    print('\n  max_duration 建议 %.0f（估时 %.0f +35%%）' % (st['est_sec'] * 1.35, st['est_sec']))
    print('\n前 20 行：')
    for ln in abc.split('\n')[:20]:
        print('   ', ln[:100])


def cmd_song(a):
    style, lyrics = read_assets()
    abc = open(a.score, encoding='utf-8').read()
    st = abc_stats(abc)
    wf, md = wf_song(style, lyrics, abc, st['est_sec'], a.seed, a.mode)
    print('谱 %d 字符 / 估算 %.1fs -> max_duration %.0fs / seed=%d mode=%s'
          % (st['chars'], st['est_sec'], md, a.seed, a.mode))
    pid = post(wf, 'song')
    if not pid:
        sys.exit(1)
    got, err = wait_out(pid, ('audio',))
    if err:
        sys.exit(1)
    au = got['audio'][-1]
    p = os.path.join(OUT_DIR, au.get('subfolder', ''), au['filename'])
    print('\n=== 歌 ===')
    print('  文件  %s' % p)
    d = H._dur(p)                      # 返回 dict；纯音频取 adur
    print('  实测  %.2fs（ffprobe adur）' % (d['adur'] or 0))
    print('  谱估  %.2fs / real_sec %.2fs' % (st['est_sec'], st['real_sec']))
    if not a.copy:
        return
    dst = os.path.join(SONG, SONGNAME + '.flac')
    import shutil
    shutil.copyfile(p, dst)
    print('  副本  %s' % dst)


def cmd_check(a):
    """只读自检：不提交任何 prompt。"""
    style, lyrics = read_assets()
    print('server      %s' % H.server())
    info = _get('/object_info', 120)
    for n in ('YuE2GenerateABC', 'YuE2GenerateMusic', 'EmptyYuE2LatentAudio',
              'ConditioningZeroOut', 'KSampler', 'VAEDecodeAudio',
              'SaveAudioAdvanced', 'SaveText', 'CheckpointLoaderSimple'):
        print('  %-24s %s' % (n, 'OK' if n in info else '❌ 未注册'))
    for wf, nm in ((wf_score(style, lyrics), 'score'),):
        bad = []
        for nid, nd in wf.items():
            ct = nd['class_type']
            if ct not in info:
                bad.append('%s 未注册' % ct); continue
            allowed = {}
            for sec in ('required', 'optional'):
                allowed.update(info[ct].get('input', {}).get(sec, {}))
            for k in nd['inputs']:
                if k not in allowed:
                    bad.append('%s[%s] 无输入名 %s' % (nid, ct, k))
            for k in allowed:
                if k in nd['inputs']:
                    continue
                s = allowed[k]
                o = s[1] if len(s) > 1 and isinstance(s[1], dict) else {}
                if 'default' not in o and not (isinstance(s[0], list) and s[0]
                                               and not isinstance(s[0][0], list)):
                    bad.append('%s[%s] 缺必需口 %s' % (nid, ct, k))
        print('  %-12s %s' % (nm + ' 工作流', '✅ 通过' if not bad else bad))
    st = abc_stats(open(a.score, encoding='utf-8').read()) if a.score else None
    if st:
        print('\n  谱估算: %s' % json.dumps(st, ensure_ascii=False))
    print('\n（本次未提交任何 /prompt，GPU 未占用）')


def main():
    import argparse
    ap = argparse.ArgumentParser(description='YuE2 出谱出歌')
    s = ap.add_subparsers(dest='cmd', required=True)
    q = s.add_parser('score'); q.add_argument('--seed', type=int, default=SEED)
    q.add_argument('--mode', default='full', choices=['full', 'melody'])
    q.set_defaults(f=cmd_score)
    q = s.add_parser('song'); q.add_argument('--score', required=True)
    q.add_argument('--seed', type=int, default=SEED)
    q.add_argument('--mode', default='full', choices=['full', 'melody'])
    q.add_argument('--copy', action='store_true')
    q.set_defaults(f=cmd_song)
    q = s.add_parser('check'); q.add_argument('--score')
    q.set_defaults(f=cmd_check)
    a = ap.parse_args()
    a.f(a)


if __name__ == '__main__':
    main()
