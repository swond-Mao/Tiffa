---
name: watch-video
description: Watch / understand a LOCAL video file via the local llama.cpp (mtmd) server at :11434. Downsamples with ffmpeg (fps=2, scale=480), POSTs an input_video content part with RAW base64 (no data: prefix), and reads content + reasoning_content. Use for 看视频 / 视频理解 / 视频内容 / 描述视频 / 视频分析 / 收到视频文件 / 这个视频在讲什么.
name_cn: "看视频（视频理解）"
description_cn: "把本地视频喂给 :11434（llama.cpp mtmd）做原生视频理解：ffmpeg 降采样 + input_video 裸 base64 + 读 content 与 reasoning_content。收到 .mp4/.webm/.mov 或用户说'看视频'时触发。"
---

# 看视频（视频理解 / Video Understanding）

把本地视频喂给 `:11434`（llama.cpp mtmd）做**原生视频理解**（带时序，不是抽帧拼静态图）。
**触发**：收到 `.mp4` / `.webm` / `.mov` 视频文件，或用户说"看视频 / 这个视频在讲什么 / 视频理解"时。

> **不要 `read` 视频原文件**——read 不解码视频容器。收到视频直接按本技能执行。

## 最快用法（一行，bash 路径用正斜杠）

```
python G:/Tiffa/data/agent/managed-skills/watch-video/watch_video.py "<视频路径>" "<任务/问题>"
```

- 默认：降采样 `fps=2, scale=480`、`max_tokens=1024`、API `http://127.0.0.1:11434/v1/chat/completions`
- 常用参数：`--fps 2 --scale 480 --max-tokens 1024 --no-downsample --api <url> --timeout 120 --ffmpeg <ffmpeg.exe>`
- 脚本路径即 `$ROOT/data/agent/managed-skills/watch-video/watch_video.py`（$ROOT = 便携根 `G:/Tiffa`）
- 退出码 `0` 成功 / `1` 失败

## 三个坑（已规避；改脚本时别踩回去）

| 坑 | 现象 | 正确做法 |
|----|------|---------|
| content part 类型 | `video_url` → 400 unsupported type；`image_url` + `data:video/...` → 500 Invalid uri | 用 `input_video`，`data` 用**裸 base64**，**不加** `data:video/mp4;base64,` 前缀，`format:"mp4"` |
| 原片帧数 | 原片 24fps ≈ 360 帧 → 客户端 180s 超时 | 默认 ffmpeg 降采样 `fps=2, scale=480:-2, -an`（短视频/原片小可 `--no-downsample`） |
| 推理模型答案 | `content` 常为空，答案落在 `reasoning_content` | **两个都读**；`max_tokens` 给够（`finish_reason=length` 时正文会被截断变空） |

## 脚本缺失时的手工兜底（无 .py 也能跑）

1. ffmpeg 降采样：`ffmpeg -y -v error -i <视频> -vf fps=2,scale=480:-2 -an <临时.mp4>`
2. base64 编码（**裸，不加 `data:video/mp4;base64,` 前缀**）
3. POST `http://127.0.0.1:11434/v1/chat/completions`，content part =
   `{"type":"input_video","input_video":{"data":"<裸b64>","format":"mp4"}}`
4. 读 `reasoning_content`（+ `content`），`max_tokens ≥ 1024`

> 注：内嵌 `powershell -Command "$..."` 会被 bash 工具的路径净化/变量展开搅坏（实测）。
> 需要多步 base64+POST 时，用 `python` 一行或本技能脚本，别拼内嵌 PowerShell。
