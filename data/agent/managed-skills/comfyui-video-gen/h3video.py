#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""MiniMax H3 视频 / MV / 数字人口型 —— ComfyUI 执行层 CLI。

子命令：
  models   检查模型文件与插件注册状态
  probe    分析歌曲节奏结构（BPM / 小节线 / 乐句 / 段落能量突变）
  board    按节奏出分镜表（切点贴音乐边界，段长吸附到 H3 合法帧数）
  slice    按分镜表切分音频（连续切，保证拼接无缝）
  shot     生成单个镜头
  batch    批量生成全部分镜
  concat   安全拼接（只连视频轨 + 铺一条连续 master）
  mv       probe -> board -> slice -> batch -> concat 全流程

三条实测铁律（违反必翻车）：
  1. 帧数必须 ≡5 (mod 17)：124/141/158/175/192/209/226/243/260/277/294 ...
  2. 先定帧数、再按「帧数/24」切音频。反过来会每段超 0.12~0.29s，
     五段累积 0.67s 漂移，口型全废（单看每段却是好的）。
  3. 各段自带 AAC 音轨直接 concat 会在接缝错位（分段编码器延迟不同，
     实测逐窗相关度仅 0.06）。必须只连视频轨，再铺一条连续 master。

数字人（真·逐帧口型）= --avatar（默认开）：
  LoadAudio -> TrimAudioDuration -> LTXVAudioVAEEncode
    -> SetLatentNoiseMask(SolidMask value=0)   # 0=保留 1=生成
    -> LTXVConcatAVLatent -> SelfLiftAvatarH3Sampler
  音轨是被钉死的【输出】而非条件，采样器只去噪视频轨 -> 嘴型逐帧跟随真实音轨。
  对比：ref_audios 只模仿音色不锁口型；AddGuideAudio 会重新生成音轨（相关度仅 0.60）。
"""
import argparse, json, os, subprocess, sys, time, urllib.error, urllib.request

FPS = 24
BS = chr(92)


# 本机与远端是【同一台】 ComfyUI：本地用 http://127.0.0.1:8188（免认证），
# 从外网访问用公网地址（开了 Basic Auth，具体地址见本机 comfy-endpoint.txt，不入库）。
# 解析顺序：--server > COMFY_H3_URL > COMFY_URL > comfy-endpoint.txt > 127.0.0.1
# 若解析到的是非本机地址又没给凭据，自动退回 127.0.0.1（同机免认证，最省事）。
_LOCAL = 'http://127.0.0.1:8188'
_SERVER_OVERRIDE = None


def _is_loopback(u):
    return ('://127.0.0.1' in u or '://localhost' in u
            or '://[::1]' in u or '://0.0.0.0' in u)


_SERVER_CACHE = {}


def server():
    if 'v' in _SERVER_CACHE:
        return _SERVER_CACHE['v']
    u = (_SERVER_OVERRIDE or os.environ.get('COMFY_H3_URL')
         or os.environ.get('COMFY_URL'))
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
    _SERVER_CACHE['v'] = r
    return r


COMFY_ROOT = os.environ.get('COMFY_ROOT', 'D:/AI/COMFYUI/ComfyUI')

# 节点里填的值（含子目录前缀）+ 该值相对哪个 models 子目录。
# 目录名以本机实测为准：unet/ clip/ vae/ vae_approx/ latent_upscale_models/ loras/
M = {
    'unet_ref2va': ('unet', 'MinimaxH3' + BS + 'minimax_h3_ref2va_int8_convrot.safetensors'),
    'unet_fl2va':  ('unet', 'MinimaxH3' + BS + 'minimax_h3_fl2va_int8_convrot.safetensors'),
    'clip':        ('clip', 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors'),
    'vae_video':   ('vae', 'minimax_h3_video_vae_fp16.safetensors'),
    'vae_audio':   ('vae', 'minimax_h3_audio_vae_fp32.safetensors'),
    'tae':         ('vae_approx', 'taeh3.safetensors'),
    'lora_turbo4': ('loras', 'minimax' + BS + 'minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy.safetensors'),
    'lora_turbo8': ('loras', 'minimax' + BS + 'minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors'),
    # 节点里要填【裸文件名】，无子目录
    'upscaler':    ('latent_upscale_models', 'minimax_h3_latent_upscaler_3d_fp16.safetensors'),
}


def mkey(k):
    """节点参数用的值"""
    return M[k][1]


def mpath(k):
    """磁盘绝对路径，用于存在性检查"""
    return os.path.join(COMFY_ROOT, 'models', M[k][0], M[k][1])


# 分辨率档位（16:9，短边都是 32 的倍数）
RES = {'360p': (640, 352), '480p': (864, 480), '768p': (1344, 768)}


# ═════════════════════════ 帧数 / 时长 ═════════════════════════
def pick_frames(target_sec, min_sec=5.0, max_sec=None):
    """取最接近 target_sec 的合法帧数（≡5 mod 17）。
    max_sec：硬上限，防止吸附后总时长越过歌曲结尾（否则末段会缺音）。"""
    lo = max(124, int(round(min_sec * FPS)))
    hi = int((max_sec if max_sec else 999) * FPS)
    cand = [f for f in range(5, 700, 17) if lo <= f <= hi]
    if not cand:
        return lo
    return min(cand, key=lambda f: abs(f / FPS - target_sec))


def dur_of(frames):
    return frames / FPS


# ═════════════════════════ API ═════════════════════════
def _hdr(extra=None):
    """远端公网地址开了 Basic Auth，凭据走 COMFY_USER / COMFY_PASS；
    本地 127.0.0.1 免认证，留空即可。"""
    h = {}
    u, p = os.environ.get('COMFY_USER'), os.environ.get('COMFY_PASS')
    if u and p:
        import base64
        h['Authorization'] = 'Basic ' + base64.b64encode(('%s:%s' % (u, p)).encode()).decode()
    if extra:
        h.update(extra)
    return h



_OPENER = None


def _opener():
    """必须绕过系统代理。

    Windows 上 urllib 默认读注册表 Internet Settings 的代理（本机 ProxyEnable=1,
    ProxyServer=http://127.0.0.1:21882），ProxyOverride 只白名单了 127.*/10.*/192.168.*，
    不含公网 IP。结果发往 47.x:8188 的请求被丢给本地代理端口，代理不转发就回
    WinError 10061「目标计算机积极拒绝」—— 看着像服务器挂了，其实是代理拦的，
    连认证请求都没发出去。自建 ComfyUI 端点应当直连，故显式清空代理。
    """
    global _OPENER
    if _OPENER is None:
        _OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return _OPENER


def _open(path, data=None, extra=None, timeout=90):
    req = urllib.request.Request(server() + path, data=data, headers=_hdr(extra))
    return _opener().open(req, timeout=timeout)


def _get(path):
    return json.loads(_open(path).read())


def submit(wf, tag=''):
    try:
        pid = json.loads(_open('/prompt', json.dumps({'prompt': wf}).encode(),
                               {'Content-Type': 'application/json'}).read())['prompt_id']
        print('  提交 %s -> %s' % (tag, pid), flush=True)
        return pid
    except urllib.error.HTTPError as e:
        print('  提交失败 %s: HTTP %s\n%s' % (tag, e.code, e.read().decode()[:1500]), flush=True)
        if e.code == 401:
            print('  -> 该地址要求 Basic Auth：设 COMFY_USER / COMFY_PASS，或改用本地 127.0.0.1', flush=True)
        return None


def wait(pid, timeout=1800, quiet=False):
    t0 = time.time()
    while time.time() - t0 < timeout:
        time.sleep(10)
        try:
            h = _get('/history/' + pid)
        except Exception:
            continue
        if pid not in h:
            continue
        st = h[pid].get('status', {})
        vids = [g['subfolder'] + '/' + g['filename']
                for o in h[pid].get('outputs', {}).values() for g in o.get('gifs', [])]
        if st.get('status_str') == 'error':
            for m in st.get('messages', []):
                print('  运行错误:', json.dumps(m, ensure_ascii=False)[:400], flush=True)
            return None, True
        if vids:
            if not quiet:
                print('  ✓ %.0fs %s' % (time.time() - t0, vids[-1]), flush=True)
            return vids[-1], False
    print('  超时 %s' % pid, flush=True)
    return None, True


# ═════════════════════════ 提示词（H3 六段式）═════════════════════════
def six_section(kind, desc, shot_len, aspect='16:9'):
    """kind: sing（唱歌锁口型）/ action（人物出镜不唱）/ empty（空镜无人）"""
    if kind == 'empty':
        return f"""(((aspect ratio {aspect})))
summary:
A cinematic music-video cutaway shot, no people present; the music plays as an audience-only score.
detailed_description:
The target video is in a cinematic music-video style, 35mm film look, shallow depth of field, gentle motion, no text, no watermark.
[Shot 1] A continuous {shot_len:.1f}-second take. {desc} The frame contains no people at any point; only the environment and its slow movement are visible. The camera motion is smooth and unmotivated, with no cuts inside the shot.
overall_soundscape: Ambient room tone or outdoor atmosphere, quiet and unobtrusive, matched to the picture.
non_diegetic_music: The supplied song plays as an audience-only score, its tempo and dynamics unchanged, audible only to the viewer."""

    subj = ("subject_definitions:\n"
            "<Subject 1> is the young woman in <Picture 1>, with long dark brown hair, brown eyes and a "
            "soft oval face; her clothing, pose and surroundings in the target video are defined only by "
            "the text below, not by <Picture 1>.\n"
            "<Picture 1> is a face-identity reference only.")
    ret_id = ("<Picture 1> (identity reference): weak_reference - only facial identity and hair are kept, "
              "the reference photo's clothing and background are discarded.")
    if kind == 'sing':
        act = ("Her mouth articulates every syllable with exact lip-sync, jaw visibly moving, lips rounding "
               "each vowel, breath visible between phrases. She sings continuously for the whole shot, her "
               "performance carrying the emotional arc of the lyric.")
        summ = ("[reference generation] A cinematic music-video performance shot of <Subject 1> singing on "
                "camera. Her lip movements articulate the supplied vocal track syllable by syllable.")
        sound = ("The close-miked lead vocal is dry and intimate, with soft breath sounds and slight room "
                 "reverb; it sits clearly at the front of the mix.")
        ret = ("<Subject 1> (appears in [Shot 1]): fully_preserved - facial identity, hair colour and eye "
               "colour from <Picture 1> are retained; her outfit differs from the reference photo.")
    else:
        act = ("Her mouth stays closed and neutral; she does not sing on camera. Only natural body motion, "
               "hair movement and breathing animate the frame.")
        summ = ("[reference generation] A cinematic music-video shot of <Subject 1> moving through the scene "
                "while the song plays as an audience-only score.")
        sound = "Faint natural ambience - footsteps, distant traffic, wind through leaves - low in the mix."
        ret = ("<Subject 1> (appears in [Shot 1]): fully_preserved - facial identity and hair from "
               "<Picture 1> are retained; her outfit differs from the reference photo.")
    return f"""(((aspect ratio {aspect})))
{subj}
summary:
{summ}
retention_analysis:
{ret}
{ret_id}
detailed_description:
The target video is in a cinematic music-video style, 35mm film look, shallow depth of field, gentle motion, no text, no watermark.
[Shot 1] A continuous {shot_len:.1f}-second take. {desc} {act} The camera performs a slow, small-amplitude move with a faint handheld drift, and there are no cuts inside the shot.
overall_soundscape: {sound}
non_diegetic_music: The supplied song plays underneath as an audience-only score, its tempo and dynamics unchanged."""


# ═════════════════════════ 工作流构建 ═════════════════════════
def build(kind, desc, audio, frames, width, height, prefix, seed=7,
          ref_image=None, avatar=True, prompt=None, lora='lora_turbo4', lora_strength=0.7,
          steps=6, cfg=1.0, transition_step=4, rho=0.0, lowres_scale=0.5,
          w_min=0.5, w_max=1.0, upscaler=True, tiling=False, head_chunks=4):
    """avatar=True：音频硬锁（数字人口型，实测通过）。
       avatar=False：普通 SelfLiftH3Sampler，音轨由模型生成（口型只算半对）。"""
    dur = dur_of(frames)
    prompt = prompt or six_section(kind, desc, dur)
    use_ref = bool(ref_image) and kind in ('sing', 'action')

    wf = {
      "55": {"class_type": "UNETLoader", "inputs": {
          "unet_name": mkey('unet_ref2va') if use_ref else mkey('unet_fl2va'),
          "weight_dtype": "default"}},
      "56": {"class_type": "LoraLoaderModelOnly", "inputs": {
          "model": ["55", 0], "lora_name": mkey(lora), "strength_model": lora_strength}},
      "57": {"class_type": "ModelAttentionBackend",
             "inputs": {"model": ["56", 0], "attention": "comfy kitchen attention"}},
      "58": {"class_type": "MiniMaxChunkFeedForward",
             "inputs": {"model": ["57", 0], "chunks": 2, "seq_threshold": 4096}},
      "59": {"class_type": "MiniMaxLowVRAMAttention",
             "inputs": {"model": ["58", 0], "head_chunks": head_chunks}},
      "62": {"class_type": "ModelPreviewOverrideKJ", "inputs": {
          "model": ["59", 0], "max_resolution": 1024, "jpeg_quality": 80,
          "suppress_default_preview": True, "preview_frames": 12, "preview_fps": 12,
          "tiny_vae": mkey('tae')}},
      "54": {"class_type": "CLIPLoader",
             "inputs": {"clip_name": mkey('clip'), "type": "minimax", "device": "default"}},
      "53": {"class_type": "VAELoader", "inputs": {"vae_name": mkey('vae_video')}},
      "52": {"class_type": "VAELoader", "inputs": {"vae_name": mkey('vae_audio')}},
      "42": {"class_type": "MiniMaxH3ReferenceToVideo", "inputs": {
          "clip": ["54", 0], "vae": ["53", 0], "audio_vae": ["52", 0],
          "prompt": prompt, "width": width, "height": height,
          "length": frames, "ref_image_size": "max"}},
      "77": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["42", 0]}},
      "50": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}},
      "51": {"class_type": "BasicScheduler", "inputs": {
          "model": ["62", 0], "scheduler": "simple", "steps": steps, "denoise": 1.0}},
      "65": {"class_type": "VHS_VideoCombine", "inputs": {
          # 注意：本机这版 VHS_VideoCombine 只接受以下 10 个参数。
          # pix_fmt / crf / save_metadata / trim_to_audio 不在 schema 内，
          # 传了不报错但被【静默忽略】（曾导致 trim_to_audio 以为生效、音频长度不符预期）。
          "frame_rate": float(FPS), "loop_count": 0, "filename_prefix": prefix,
          "format": "video/h264-mp4", "pingpong": False, "save_output": True}},
    }
    if use_ref:
        wf["36"] = {"class_type": "LoadImage", "inputs": {"image": ref_image}}
        wf["42"]["inputs"]["ref_images.ref_image_0"] = ["36", 0]

    if audio:
        wf["34"] = {"class_type": "LoadAudio", "inputs": {"audio": audio}}
        wf["85"] = {"class_type": "TrimAudioDuration", "inputs": {
            "audio": ["34", 0], "start_index": 0, "duration": dur}}

    if avatar:
        wf["38"] = {"class_type": "LTXVAudioVAEEncode",
                    "inputs": {"audio": ["85", 0], "audio_vae": ["52", 0]}}
        wf["40"] = {"class_type": "SolidMask", "inputs": {"value": 0.0, "width": 64, "height": 64}}
        wf["39"] = {"class_type": "SetLatentNoiseMask",
                    "inputs": {"samples": ["38", 0], "mask": ["40", 0]}}
        wf["41"] = {"class_type": "LTXVSeparateAVLatent", "inputs": {"av_latent": ["42", 1]}}
        wf["43"] = {"class_type": "LTXVConcatAVLatent", "inputs": {
            "video_latent": ["41", 0], "audio_latent": ["39", 0]}}
        wf["78"] = {"class_type": "SelfLiftAvatarH3Sampler", "inputs": {
            "model": ["62", 0], "positive": ["42", 0], "negative": ["77", 0],
            "vae": ["53", 0], "latent_image": ["43", 0], "sampler": ["50", 0],
            "sigmas": ["51", 0], "seed": seed, "cfg": cfg,
            "transition_step": transition_step, "lowres_scale": lowres_scale,
            "rho": rho, "w_min": w_min, "w_max": w_max,
            "upscaler_model": mkey('upscaler') if upscaler else "none",
            "highres_tiling": bool(tiling)}}
        sampler_out, audio_out = ["78", 0], (["85", 0] if audio else None)
    else:
        wf["171"] = {"class_type": "SelfLiftH3Sampler", "inputs": {
            "model": ["62", 0], "positive": ["42", 0], "negative": ["77", 0],
            "vae": ["53", 0], "latent_image": ["42", 1], "sampler": ["50", 0],
            "sigmas": ["51", 0], "seed": seed, "cfg": cfg,
            "transition_step": transition_step, "lowres_scale": lowres_scale,
            "rho": rho, "w_min": w_min, "w_max": w_max,
            "upscaler_model": mkey('upscaler') if upscaler else "none",
            "highres_tiling": bool(tiling)}}
        wf["63"] = {"class_type": "LTXVSeparateAVLatent", "inputs": {"av_latent": ["171", 0]}}
        wf["121"] = {"class_type": "VAEDecodeAudio",
                     "inputs": {"samples": ["63", 1], "vae": ["52", 0]}}
        sampler_out, audio_out = ["63", 0], (["121", 0] if audio else None)

    wf["64"] = {"class_type": "VAEDecode", "inputs": {"samples": sampler_out, "vae": ["53", 0]}}
    wf["65"]["inputs"]["images"] = ["64", 0]
    if audio_out:
        wf["65"]["inputs"]["audio"] = audio_out
    return wf


# ═════════════════════════ 音乐分析 ═════════════════════════
def analyze(song):
    """需要 librosa（本机在 ComfyUI 的 conda python 里）。"""
    import numpy as np, librosa
    y, sr = librosa.load(song, sr=22050, mono=True)
    dur = len(y) / sr
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
    tempo = float(np.atleast_1d(tempo)[0])
    beat_t = librosa.frames_to_time(beats, sr=sr)
    t0 = float(beat_t[0]) if len(beat_t) else 0.0
    beat = 60.0 / tempo
    grid = [t0 + i * beat for i in range(int((dur - t0) / beat) + 1)]
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
    rt = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=512)
    rn = rms / (rms.max() + 1e-9)
    win = max(1, int(0.5 / (512 / sr)))
    seg = np.array([rn[i:i + win].mean() for i in range(0, len(rn) - win + 1, win)])
    st = np.array([rt[i] for i in range(0, len(rn) - win + 1, win)])
    d = np.abs(np.diff(seg))
    mut = [float(st[i + 1]) for i in range(len(d)) if d[i] > d.max() * 0.35]
    return {'duration': round(dur, 3), 'bpm': round(tempo, 2), 'beat': round(beat, 4),
            'bar_len': round(beat * 4, 3),
            'bars': [round(x, 2) for x in grid[::4] if x < dur],
            'phrases': [round(x, 2) for x in grid[::16] if x < dur],
            'mutations': [round(m, 2) for m in mut]}


# ═════════════════════════ 分镜表 ═════════════════════════
DEFAULT_SHOTS = [
    ("empty",  "slow push-in on an empty bedroom in early morning, sheer white curtains stirring in a breeze, dust motes in a shaft of pale golden sunlight, unmade bed with rumpled sheets and a forgotten knitted sweater on a wooden chair, faded warm nostalgic colour", "前奏·空镜"),
    ("empty",  "wide shot of an empty subway platform at night, cold fluorescent light, a single forgotten paper cup on the bench, slow lateral dolly", "空镜·月台"),
    ("sing",   "close-up profile facing left, white cotton blouse, standing by a rain-streaked window, soft diffused daylight, mouth moving while singing, faint smile", "口型·雨窗"),
    ("action", "medium shot, walking alone through a quiet tree-lined street at golden hour, long dark hair moving in the wind, light gray sleeveless dress, backlit golden flare, camera tracking backward", "动作·林荫"),
    ("sing",   "intimate close-up facing camera, dim warm room, soft candle-like key light, emotional peak, direct gaze, gentle head movement", "口型·烛光"),
    ("empty",  "slow aerial wide shot over a calm river at dusk, warm city lights beginning to glow on the far bank, long smooth crane descent", "空镜·航拍"),
    ("empty",  "extreme close-up of a cassette tape slowly turning inside a vintage player, warm tungsten lamp glow, shallow depth of field, static macro camera", "空镜·磁带"),
]


def make_board(struct, start=0.0, end=None, shots=None):
    """切点贴音乐边界，段长吸附到合法帧数。

    关键：cum 记录【已消耗的实际时长】，每段目标 = 边界 - cum。
    吸附误差被逐段吸收、不累积，音频才能连续无缝切。
    """
    end = end if end is not None else struct['duration']
    shot_defs = shots or DEFAULT_SHOTS
    span = end - start
    n = len(shot_defs)
    cands = sorted(set([x for x in struct.get('phrases', []) if start < x < end] +
                       [x for x in struct.get('mutations', []) if start < x < end] +
                       [x for x in struct.get('bars', []) if start < x < end]))
    cuts, cur = [], start
    for i in range(n - 1):
        tgt = start + span * (i + 1) / n
        near = min(cands, key=lambda c: abs(c - tgt)) if cands else tgt
        if near - cur < 4.0 or end - near < 4.0:
            continue
        cuts.append(near)
        cur = near
    bounds = [start] + sorted(set(cuts)) + [end]

    segs, cum = [], 0.0
    for i, bnd in enumerate(bounds[1:]):
        kind, desc, label = shot_defs[i % len(shot_defs)]
        last = (i == len(bounds) - 2)
        target = (end - cum) if last else (bnd - cum)
        # max_sec 保证累计时长不越过歌曲结尾，否则末段会缺音
        frames = pick_frames(max(5.0, target), max_sec=end - cum)
        d = dur_of(frames)
        segs.append({'id': i + 1, 'kind': kind, 'label': label, 'desc': desc,
                     'frames': frames, 'dur': round(d, 4),
                     'src_start': round(start + cum, 4),
                     'src_end': round(start + cum + d, 4),
                     'needs_lip': kind == 'sing',
                     'audio': 'mv_shot%d.wav' % (i + 1)})
        cum += d
    return segs


def print_board(segs, song_end=None):
    print('%-3s %-7s %-10s %-6s %-7s %-8s %-8s %s' %
          ('段', '类型', '标签', '帧', '时长', '音频起', '音频止', '口型'))
    for s in segs:
        print('%-3d %-7s %-10s %-6d %-7.2f %-8.2f %-8.2f %s' %
              (s['id'], s['kind'], s['label'], s['frames'], s['dur'],
               s['src_start'], s['src_end'], '★' if s['needs_lip'] else ''))
    tot = sum(s['dur'] for s in segs)
    print('总长 %.2fs | 口型段 %d / 共 %d 段%s' %
          (tot, sum(s['needs_lip'] for s in segs), len(segs),
           '' if song_end is None else ' | 歌曲 %.2fs' % song_end))


# ═════════════════════════ 音频切分 ═════════════════════════
def slice_audio(song, segs, out_dir):
    import shutil
    made = []
    for s in segs:
        tmp = os.path.join(out_dir, '_slice_tmp.wav')
        out = os.path.join(out_dir, s['audio'])
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', str(s['src_start']),
                        '-to', str(s['src_end']), '-i', song,
                        '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le', tmp], capture_output=True)
        if os.path.isfile(tmp):
            shutil.move(tmp, out)
            made.append(out)
        else:
            print('  切分失败', s['audio'])
    return made


# ═════════════════════════ 安全拼接 ═════════════════════════
def seg_file(video_dir, sid, want_audio=False):
    """取该段【最新】成片。VHS 序号会随重跑递增（00001->00002），
    硬编码 00001 会静默拿到旧版本，改完重跑却拼出老片。
    want_audio=False 取无音轨那份（拼接用，避免分段 AAC 错位）；
    want_audio=True 取 -audio 那份（验收音轨锁定用）。"""
    import glob
    cands = []
    for pat in ('mv_shot%d_avatar_*.mp4' % sid, 'mv_shot%d_*.mp4' % sid):
        for p in glob.glob(os.path.join(video_dir, pat)):
            if p.endswith('.png'):
                continue
            if p.endswith('-audio.mp4') != want_audio:
                continue
            cands.append(p)
    if not cands:
        return None
    return max(cands, key=os.path.getmtime)


def concat_safe(video_dir, segs, song, final_path, master_start=None):
    """★ 只连视频轨 + 铺一条连续 master。分段 AAC 直接 concat 会接缝错位。"""
    clips = [f for f in (seg_file(video_dir, s['id']) for s in segs) if f]
    if not clips:
        print('  找不到分段视频（检查 --video-dir / filename_prefix）')
        return None
    miss = [s['id'] for s in segs if not seg_file(video_dir, s['id'])]
    if miss:
        print('  ⚠ 缺段 %s，跳过' % miss)
    lst = final_path + '.list.txt'
    with open(lst, 'w', encoding='utf-8') as f:
        for p in clips:
            f.write("file '%s'\n" % p.replace(os.sep, '/'))
    vdur = round(sum(dur_of(s['frames']) for s in segs), 3)
    vonly = final_path + '.vonly.mp4'
    r = subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lst,
                        '-c', 'copy', '-an', vonly], capture_output=True, text=True)
    if r.returncode:
        print('  视频 concat 失败:', r.stderr[:300])
        return None
    if master_start is None:
        master_start = segs[0]['src_start']
    r = subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', vonly,
                        '-ss', str(master_start), '-t', '%.3f' % vdur, '-i', song,
                        '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy',
                        '-c:a', 'aac', '-b:a', '256k', '-shortest',
                        '-movflags', '+faststart', final_path], capture_output=True, text=True)
    for t in (vonly, lst):
        try:
            os.remove(t)
        except OSError:
            pass
    if r.returncode:
        print('  合成失败:', r.stderr[:300])
        return None
    print('  成片 %s | %.1f MB | %.2fs' %
          (final_path, os.path.getsize(final_path) / 2**20, vdur))
    return final_path



# ═════════════════════════ 验收探针 ═════════════════════════
def _mono(path, sr=16000, ss=None, t=None):
    """解码成单声道 float，供相关性计算。"""
    import tempfile, hashlib, wave
    tag = hashlib.md5(('%s%s%s' % (path, ss, t)).encode()).hexdigest()[:8]
    tmp = os.path.join(tempfile.gettempdir(), 'v_%s.wav' % tag)
    cmd = ['ffmpeg', '-y', '-v', 'error']
    if ss is not None:
        cmd += ['-ss', str(ss)]
    cmd += ['-i', path]
    if t is not None:
        cmd += ['-t', str(t)]
    cmd += ['-ac', '1', '-ar', str(sr), tmp]
    subprocess.run(cmd, capture_output=True)
    if not os.path.isfile(tmp):
        return None
    import numpy as np
    w = wave.open(tmp); n = w.getnframes()
    x = np.frombuffer(w.readframes(n), dtype=np.int16).astype(float)
    w.close(); os.remove(tmp)
    return x


def _dur(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-print_format', 'json',
                        '-show_format', '-show_streams', path], capture_output=True, text=True)
    try:
        j = json.loads(r.stdout)
    except Exception:
        return None
    v = [x for x in j['streams'] if x['codec_type'] == 'video']
    a = [x for x in j['streams'] if x['codec_type'] == 'audio']
    return {'vdur': float(v[0].get('duration', 0)) if v else None,
            'adur': float(a[0].get('duration', 0)) if a else None,
            'w': v[0]['width'] if v else None, 'h': v[0]['height'] if v else None,
            'frames': int(v[0].get('nb_frames', 0)) if v else None}


def cmd_verify(a):
    """三项硬校验：逐段时长、逐段音轨锁定、成片漂移。纯 CPU，不占 GPU。"""
    import numpy as np
    segs = json.load(open(a.board, encoding='utf-8'))
    bad = 0
    print('── 1) 逐段时长 + 音轨锁定 ──')
    print('%-4s %-7s %-6s %-9s %-9s %-8s %s' % ('段', '类型', '帧', '期望s', '实测s', '误差', '音轨相关'))
    for s in segs:
        p = seg_file(a.video_dir, s['id'], want_audio=True)
        if not p:
            print('%-4d %-7s 缺文件' % (s['id'], s['kind'])); bad += 1; continue
        d = _dur(p)
        exp = dur_of(s['frames'])
        src = _mono(os.path.join(a.audio_dir, s['audio']))
        out = _mono(p, t=d['adur'])
        c = np.nan
        if src is not None and out is not None:
            n = min(len(src), len(out))
            c = float(np.corrcoef(src[:n], out[:n])[0, 1])
        okd = abs(d['vdur'] - exp) < 0.02
        okc = c > 0.95
        bad += 0 if (okd and okc) else 1
        print('%-4d %-7s %-6d %-9.4f %-9.4f %-+8.4f %-8.4f %s' %
              (s['id'], s['kind'], s['frames'], exp, d['vdur'], d['vdur'] - exp, c,
               '' if (okd and okc) else ('时长偏!' if not okd else '') + (' 音轨未锁!' if not okc else '')))
    if a.final and os.path.isfile(a.final):
        print('\n── 2) 成片 master 漂移探针 ──')
        d = _dur(a.final)
        out = _mono(a.final, t=d['adur'])
        ref = _mono(a.song, t=len(out) / 16000)
        n = min(len(out), len(ref))
        best, blag = -2.0, 0
        for lag in range(-4800, 4801, 200):
            x, y = (out[lag:n], ref[:n - lag]) if lag >= 0 else (out[:n + lag], ref[-lag:n])
            m = min(len(x), len(y))
            if m < 16000:
                continue
            cc = float(np.corrcoef(x[:m], y[:m])[0, 1])
            if cc > best:
                best, blag = cc, lag
        print('  总体 %.5f @lag=%+dms | 容器 %.3fs 视频 %.3fs 音频 %.3fs' %
              (best, blag / 16, d['vdur'], d['vdur'], d['adur']))
        win = 5 * 16000
        drift = []
        for i in range(0, n - win, win):
            cc = float(np.corrcoef(out[i:i + win], ref[i:i + win])[0, 1])
            drift.append(cc)
            if cc < 0.99:
                print('  ⚠ %d-%ds 相关 %.5f —— 接缝错位' % (i // 16000, (i + win) // 16000, cc))
                bad += 1
        if drift:
            print('  逐 5s 窗最低 %.5f（应 >0.999）' % min(drift))
        if best < 0.999 or abs(blag) > 200:
            print('  ⚠ 存在累积漂移，检查是否违反「先定帧数再切音频」')
            bad += 1
    print('\n结论:', '全部通过' if bad == 0 else '%d 项异常' % bad)
    return 0 if bad == 0 else 1


# ═════════════════════════ 子命令 ═════════════════════════
def cmd_models(_):
    print('ComfyUI:', server(), '| root:', COMFY_ROOT)
    ok = True
    for k in M:
        p = mpath(k)
        e = os.path.isfile(p)
        ok &= e
        print('  %-12s %-58s %s' % (k, mkey(k),
              ('OK %.0fMB' % (os.path.getsize(p) / 2**20)) if e else '缺失'))
    try:
        d = _get('/object_info')
        av = sorted(x for x in d if x.startswith('SelfLiftAvatar'))
        print('\n  Avatar 插件:', av or '未注册 -> 装完 custom_nodes 必须重启 ComfyUI')
        for need in ('SelfLiftH3Sampler', 'MiniMaxH3ReferenceToVideo', 'LTXVAudioVAEEncode',
                     'SetLatentNoiseMask', 'SolidMask', 'TrimAudioDuration',
                     'LTXVConcatAVLatent', 'LTXVSeparateAVLatent', 'ModelPreviewOverrideKJ'):
            if need not in d:
                print('  缺节点:', need)
                ok = False
    except urllib.error.HTTPError as e:
        print('  服务器返回 %s：%s' % (e.code,
              '认证失败，检查 COMFY_USER/COMFY_PASS（远端公网地址需 Basic Auth，本机 127.0.0.1 免认证）'
              if e.code == 401 else '接口异常'))
        ok = False
    except Exception as e:
        print('  服务器不可达:', e)
        ok = False
    print('\n结论:', '齐备' if ok else '有缺失，先补齐再跑')
    return 0 if ok else 1


def cmd_probe(a):
    s = analyze(a.song)
    print(json.dumps(s, ensure_ascii=False, indent=2))
    if a.out:
        json.dump(s, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
        print('->', a.out)
    return 0


def cmd_board(a):
    st = json.load(open(a.structure, encoding='utf-8')) if a.structure else analyze(a.song)
    segs = make_board(st, a.start, a.end)
    print_board(segs, st['duration'])
    json.dump(segs, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print('->', a.out)
    return 0


def cmd_slice(a):
    segs = json.load(open(a.board, encoding='utf-8'))
    for p in slice_audio(a.song, segs, a.out_dir):
        print('  %-16s %.2f MB' % (os.path.basename(p), os.path.getsize(p) / 2**20))
    return 0


def _gen(segs, a, only=None):
    w, h = RES[a.res] if a.res else (a.width, a.height)
    jobs = {}
    for s in segs:
        if only and s['id'] not in only:
            continue
        wf = build(s['kind'], s['desc'], s['audio'], s['frames'], w, h,
                   prefix='%s/mv_shot%d_avatar' % (a.prefix_dir, s['id']),
                   seed=s['id'] + a.seed, ref_image=a.ref, avatar=not a.no_avatar)
        pid = submit(wf, 'shot%d %s %d帧 %dx%d' % (s['id'], s['kind'], s['frames'], w, h))
        if pid:
            jobs[s['id']] = pid
    if not jobs:
        print('没有可提交的分镜')
        return 1
    done, fail = set(), set()
    t0 = time.time()
    while len(done) + len(fail) < len(jobs) and time.time() - t0 < a.timeout:
        time.sleep(15)
        for sid, pid in jobs.items():
            if sid in done or sid in fail:
                continue
            try:
                hst = _get('/history/' + pid)
            except Exception:
                continue
            if pid not in hst:
                continue
            st = hst[pid].get('status', {})
            vids = [g['subfolder'] + '/' + g['filename']
                    for o in hst[pid].get('outputs', {}).values() for g in o.get('gifs', [])]
            if st.get('status_str') == 'error':
                fail.add(sid)
                print('  ✗ 段%d 失败 (%.0fs)' % (sid, time.time() - t0), flush=True)
            elif vids:
                done.add(sid)
                print('  ✓ 段%d (%.0fs) %s' % (sid, time.time() - t0, vids[-1]), flush=True)
    print('\n完成 %d / 失败 %d / 共 %d' % (len(done), len(fail), len(jobs)))
    return 0 if not fail else 1


def cmd_shot(a):
    return _gen(json.load(open(a.board, encoding='utf-8')), a, only=[a.id])


def cmd_batch(a):
    return _gen(json.load(open(a.board, encoding='utf-8')), a,
                only=set(a.only) if a.only else None)


def cmd_concat(a):
    segs = json.load(open(a.board, encoding='utf-8'))
    return 0 if concat_safe(a.video_dir, segs, a.song, a.out, a.master_start) else 1


def cmd_mv(a):
    print('== 1) 分析歌曲 ==')
    st = analyze(a.song)
    print('  BPM %.1f | 小节 %.2fs | 时长 %.1fs | 段落突变 %s'
          % (st['bpm'], st['bar_len'], st['duration'], st['mutations'][:8]))
    print('== 2) 分镜 ==')
    segs = make_board(st, a.start, a.end)
    print_board(segs, st['duration'])
    json.dump(segs, open(a.board_out, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print('== 3) 切分音频 ==')
    slice_audio(a.song, segs, a.audio_dir)
    print('== 4) 生成镜头 ==')
    rc = _gen(segs, a)
    print('== 5) 拼接 ==')
    concat_safe(a.video_dir, segs, a.song, a.out)
    return rc


def main():
    p = argparse.ArgumentParser(description='MiniMax H3 视频 / MV / 数字人口型')
    # 全局参数须写在子命令前：h3video.py --server http://… shot --id 3
    p.add_argument('--server', help='ComfyUI 地址；远端需同时设 COMFY_USER/COMFY_PASS')
    sub = p.add_subparsers(dest='cmd', required=True)

    sub.add_parser('models', help='检查模型与插件').set_defaults(fn=cmd_models)

    q = sub.add_parser('probe', help='分析歌曲节奏')
    q.add_argument('song'); q.add_argument('--out')
    q.set_defaults(fn=cmd_probe)

    q = sub.add_parser('board', help='按节奏出分镜表')
    q.add_argument('song'); q.add_argument('--structure')
    q.add_argument('--start', type=float, default=0.0); q.add_argument('--end', type=float)
    q.add_argument('--out', default='board.json')
    q.set_defaults(fn=cmd_board)

    q = sub.add_parser('slice', help='按分镜切音频')
    q.add_argument('song'); q.add_argument('--board', default='board.json')
    q.add_argument('--out-dir', default=os.path.join(COMFY_ROOT, 'input'))
    q.set_defaults(fn=cmd_slice)

    for name, help_ in (('shot', '生成单个镜头'), ('batch', '批量生成')):
        q = sub.add_parser(name, help=help_)
        q.add_argument('--board', default='board.json')
        q.add_argument('--res', choices=list(RES))
        q.add_argument('--width', type=int, default=864)
        q.add_argument('--height', type=int, default=480)
        q.add_argument('--ref', default='kopiu_mv_ref.png')
        q.add_argument('--prefix-dir', default='mv')
        q.add_argument('--seed', type=int, default=400)
        q.add_argument('--no-avatar', action='store_true', help='关掉音频硬锁')
        q.add_argument('--timeout', type=int, default=5400)
        if name == 'shot':
            q.add_argument('--id', type=int, required=True)
            q.set_defaults(fn=cmd_shot)
        else:
            q.add_argument('--only', type=int, nargs='*')
            q.set_defaults(fn=cmd_batch)

    q = sub.add_parser('concat', help='安全拼接')
    q.add_argument('song'); q.add_argument('--board', default='board.json')
    q.add_argument('--video-dir', default=os.path.join(COMFY_ROOT, 'output', 'mv'))
    q.add_argument('--out', required=True); q.add_argument('--master-start', type=float)
    q.set_defaults(fn=cmd_concat)

    q = sub.add_parser('verify', help='验收：逐段时长/音轨锁定 + 成片漂移探针')
    q.add_argument('song'); q.add_argument('--board', default='board.json')
    q.add_argument('--video-dir', default=os.path.join(COMFY_ROOT, 'output', 'mv'))
    q.add_argument('--audio-dir', default=os.path.join(COMFY_ROOT, 'input'))
    q.add_argument('--final', help='成片 mp4，给了就额外跑漂移探针')
    q.set_defaults(fn=cmd_verify)

    q = sub.add_parser('mv', help='全流程')
    q.add_argument('song')
    q.add_argument('--start', type=float, default=0.0); q.add_argument('--end', type=float)
    q.add_argument('--res', choices=list(RES), default='480p')
    q.add_argument('--width', type=int, default=864); q.add_argument('--height', type=int, default=480)
    q.add_argument('--ref', default='kopiu_mv_ref.png')
    q.add_argument('--board-out', default='board.json')
    q.add_argument('--audio-dir', default=os.path.join(COMFY_ROOT, 'input'))
    q.add_argument('--video-dir', default=os.path.join(COMFY_ROOT, 'output', 'mv'))
    q.add_argument('--prefix-dir', default='mv'); q.add_argument('--seed', type=int, default=400)
    q.add_argument('--no-avatar', action='store_true')
    q.add_argument('--out', required=True); q.add_argument('--timeout', type=int, default=7200)
    q.set_defaults(fn=cmd_mv)

    a = p.parse_args()
    if a.server:
        globals()['_SERVER_OVERRIDE'] = a.server.rstrip('/')
    print('ComfyUI:', server())
    sys.exit(a.fn(a) or 0)


if __name__ == '__main__':
    main()
