#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""watch_video — 看视频(本框架"视频一等输入"的参考实现 / 临时契约)

把本地视频喂给 :11434(llama.cpp mtmd),用 **input_video + 裸 base64** 做原生
视频理解(带时序,不是抽帧拼静态图)。这是把"视频"接进框架的最小可执行契约;
框架层正式落地前,先跑这个。

契约要点(三个坑,已规避):
  1. content part 用 `input_video` + **裸 base64**——**不加** `data:video/mp4;base64,`
     前缀。踩过的坑:`video_url` → 400 unsupported type;
     `image_url` + `data:video/...` → 500 Invalid uri。只有 `input_video` + 裸 b64 通。
  2. 默认 ffmpeg **降采样**(`fps=2, scale=480`)——原片 24fps≈360 帧会让
     客户端 180s 超时。降采样后 8s 级返回。
  3. **推理模型**的答案落在 `reasoning_content`,`content` 常为空 → 两个都读;
     `max_tokens` 给够(`finish_reason=length` 时正文空白),默认 1024。

用法:
  python watch_video.py <video.mp4> "描述这个视频"
  python watch_video.py in.mp4 "谁在做什么?" --fps 2 --scale 480 --max-tokens 1024
  python watch_video.py in.mp4 "..." --no-downsample        # 不降采样(短视频/原片小)
  python watch_video.py in.mp4 "..." --api http://127.0.0.1:11434/v1/chat/completions

退出码:0 成功;1 失败。
"""
import argparse
import base64
import json
import os
import subprocess
import sys
import time
import urllib.request

FFMPEG_DEFAULT = r"D:\AI\llama-cpp\ffmpeg.exe"
API_DEFAULT = "http://127.0.0.1:11434/v1/chat/completions"


def downsample(ffmpeg, src, tmp, fps, scale):
    """降采样:按 fps 抽帧 + 限宽 scale(高按比例),去音频,输出 .mp4。"""
    cmd = [ffmpeg, "-v", "error", "-y", "-i", src,
           "-vf", f"fps={fps},scale={scale}:-2", "-an", tmp]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("ffmpeg 降采样失败:\n" + r.stderr[:500])


def kb(n):
    return f"{n // 1024} KB"


def ask(api, model, prompt, mp4_path, max_tokens, timeout):
    """POST :11434,内容 = 文本 + input_video(裸 base64);读 content + reasoning_content。"""
    with open(mp4_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()

    body = {
        # 服务器忽略此字段,服务当前加载的模型(实测用 "x" 亦可)
        "model": model,
        "max_tokens": max_tokens,
        "stream": False,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": prompt},
            # ★ 契约核心:input_video + 裸 base64(无 data: 前缀)
            {"type": "input_video", "input_video": {"data": b64, "format": "mp4"}},
        ]}],
    }
    req = urllib.request.Request(api, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        resp = json.load(r)
    dt = time.time() - t0

    choice = resp["choices"][0]
    msg = choice.get("message", {})
    content = msg.get("content") or ""
    reasoning = msg.get("reasoning_content") or ""
    print(f"[{dt:.1f}s] finish_reason={choice.get('finish_reason')} "
          f"usage={resp.get('usage', {})}  video_payload={kb(len(b64))}")
    if content:
        print("\n=== content ===\n" + content)
    if reasoning:
        print("\n=== reasoning_content ===\n" + reasoning)
    if not content and not reasoning:
        print("\n(空)finish_reason 可能是 length → 把 --max-tokens 调大再试")
    return resp


def main():
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("video", help="本地视频路径(通常 .mp4)")
    p.add_argument("prompt", help="要问的问题 / 指令")
    p.add_argument("--api", default=API_DEFAULT, help="chat completions 端点")
    p.add_argument("--model", default="x",
                   help="模型名(服务器忽略,服务当前加载模型;默认 'x')")
    p.add_argument("--max-tokens", type=int, default=1024,
                   help="最大生成 token(推理模型要留够,默认 1024)")
    p.add_argument("--fps", type=int, default=2, help="降采样帧率(默认 2)")
    p.add_argument("--scale", type=int, default=480, help="降采样限宽像素(默认 480)")
    p.add_argument("--no-downsample", action="store_true",
                   help="不降采样,直接发原片(仅短视频/原片小时)")
    p.add_argument("--tmp", default=None, help="降采样输出路径(默认 <video>_small.mp4)")
    p.add_argument("--timeout", type=int, default=600, help="HTTP 超时秒(默认 600)")
    p.add_argument("--ffmpeg", default=FFMPEG_DEFAULT, help="ffmpeg 可执行文件路径")
    a = p.parse_args()

    if not os.path.isfile(a.video):
        sys.exit(f"视频文件不存在: {a.video}")

    # 决定喂哪个文件:默认先降采样,--no-downsample 则原片直发
    send = a.video
    if not a.no_downsample:
        send = a.tmp or (os.path.splitext(a.video)[0] + "_small.mp4")
        print(f"> 降采样 fps={a.fps} scale={a.scale} → {send}")
        downsample(a.ffmpeg, a.video, send, a.fps, a.scale)
        print(f"> 降采样后 {kb(os.path.getsize(send))}")

    try:
        ask(a.api, a.model, a.prompt, send, a.max_tokens, a.timeout)
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read()[:400].decode(errors='replace')}")
    except Exception as e:
        sys.exit(f"FAIL: {e}")


if __name__ == "__main__":
    main()
