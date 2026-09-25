---
name: comfyui-image-gen
description: Generate or edit images via a remote ComfyUI instance (RTX 5090). Four pipelines: Qwen Image 2.1 (primary text-to-image + instruction editing), Krea2 (NSFW/special gen), Klein (NSFW/special edit), SeedVR2 (upscale). Routes by user intent. Use for 生图/画图/出图/海报/带文字/编辑图片/P图/改图.
name_cn: "ComfyUI 文生图与图编辑"
description_cn: "调用远程 ComfyUI（RTX5090）文生图与图编辑，免费本地算力。Qwen Image 2.1 为生图/编辑主力，Krea2/Klein 负责 NSFW 等特殊需求，SeedVR2 放大。"
---

# ComfyUI Image Generation & Editing

Unified CLI `comfy.py` drives a remote ComfyUI server. Four subcommands, routed by intent.

## Server
- Base URL: **不入库**。读取顺序：`COMFY_URL` 环境变量 → 本机 `data/agent/comfy-endpoint.txt`（已 gitignore）→ 都没有则 `comfy.py` 报错退出（不会静默连假地址）
- 认证：若 ComfyUI 配置了 Basic Auth，设置 `COMFY_USER` 和 `COMFY_PASS` 环境变量
- Output dir: **craftman 调用时自动设为项目目录**，独立调用时默认 `$PORTABLE_ROOT/workspace/comfyui_out`，可通过 `COMFY_OUT` 环境变量或 `--output` 参数覆盖

## Routing rules (pick BEFORE calling)

| 用户意图 | 子命令 | 说明 |
|----------|--------|------|
| 常规生图（默认主力） | `gen` | Qwen Image 2.1，提示词遵循好，中英文皆可 |
| 图片编辑/P图（默认主力） | `edit` | Qwen Image 2.1 指令式编辑，支持多参考图 `--ref` |
| NSFW/特殊需求生图 | `krea2` | Krea2 Muse，NSFW 等特殊内容生图 |
| NSFW/特殊需求编辑 | `klein` | Flux2-Klein，NSFW 等特殊内容（高写实，自由尺寸；`--image` 支持原图输入编辑+一致性 LoRA） |
| 图像放大/超分辨率 | `upscale` | SeedVR2 智能放大，适合低分辨率图像放大 |

> 已退役：`ernie`（Ernie-Image-Turbo）、`zimage`（Z-image）、旧版 Flux2 编辑工作流——Qwen Image 2.1 全面取代。工作流 JSON 归档在技能目录 `retired/` 子目录。
> **提示词直接写**：工作流中的 TextGenerateLTX2Prompt 提示词增强节点不接入，提示词由调用方完整写清。

> **生图实战指南**：读 `image-gen-playbook.md`（管线选择决策/提示词写法/**编辑指令写法 9 条**[提炼自 Qwen 官方 Edit Prompt Enhancer v2：属性解耦、保留物点名不描相、文字逐字承诺否则不添加、比例走 `--size` 不进提示词]/比例预处理[绝不拉伸]/水印处理/批量素材策略/常见踩坑）。商业 deck 批量生图前必读；写 `edit` 指令前必读「编辑指令写法」一节。

## CLI 用法

所有命令都通过 Python 调用，脚本路径由 [系统注入] 块提供：

```bash
python "<comfy.py绝对路径>" <gen|edit|krea2|klein|upscale> ...
```

### gen - Qwen Image 2.1 文生图（主力）

```bash
python "<comfy.py绝对路径>" gen "提示词" [--size WxH] [--seed N] [--steps N] [--negative 负面词] [--name 名前缀]
```
- 默认尺寸由 workflow 决定（1024×1024），可用 `--size` 覆盖
- 支持多行提示词批量生成（每行一张图），或用 `-` 从 stdin 读取，或 `--prompt-file` 从文件读取
- 中英文提示词均可，提示词遵循好

### edit - Qwen Image 2.1 图片编辑（主力）

```bash
python "<comfy.py绝对路径>" edit "<本地图片路径>" "编辑指令" [--ref 参考图路径]... [--negative 负面词] [--seed N] [--steps N] [--name 名前缀]
```
- 编辑指令示例：`"脱掉人物上衣"`、`"把背景换成海滩"`
- `--ref` 可重复传多张参考图（最多 11 张，对应 images.image_2..image_12），用于角色一致性/多参考编辑

### krea2 - NSFW/艺术风生图

```bash
python "<comfy.py绝对路径>" krea2 "提示词" [--size WxH] [--seed N] [--steps N] [--name 名前缀] [--protagonist liuyifei|kopiu]
```
- 默认尺寸 `1080x1920`（竖图）
- `--protagonist`：主角 LoRA 开关，默认 liuyifei
- 支持多行提示词批量生成（每行一张图），或用 `-` 从 stdin 读取，或 `--prompt-file` 从文件读取

### klein - NSFW/特殊需求

```bash
python "<comfy.py绝对路径>" klein "提示词" [--size WxH] [--seed N] [--steps N] [--cfg F] [--sampler 名称] [--negative 负面词] [--name 名前缀]
python "<comfy.py绝对路径>" klein "编辑指令" --image "<原图路径>" [--seed N] [--name 名前缀]
```
- 默认尺寸 `832x1216`
- **图片编辑**：加 `--image <原图路径>`，自动走「原图输入 + 一致性 LoRA 0.4（身份增强）」工作流，输出尺寸跟随原图（约 1MP）；编辑指令写单行即可
- 支持自定义 cfg、sampler、负面提示词
- 注意提示词遵循差：吃英文、易跑偏，prompt 要写具体

### upscale - 图像放大

```bash
python "<comfy.py绝对路径>" upscale "<本地图片路径>" [--seed N] [--resolution N] [--name 名前缀]
```
- 默认分辨率 `1024`（SeedVR2 输出分辨率）
- 使用 SeedVR2 模型进行智能放大，适合低分辨率图像放大
- 放大倍数由输入图像和目标分辨率决定
- `name`：输出文件名前缀，默认 craftman

## 通用说明

- **输出**：成功后 stdout 输出 `RESULT:["路径1","路径2",...]`，每行一张图
- **超时**：默认 600 秒，可用 `--timeout` 覆盖
- **多行批量**：gen/krea2/klein 支持，提示词中每行 = 一张图
- **种子**：`--seed N`，批量时每张图自动用不同种子（seed+i）
- **服务依赖**：ComfyUI 服务必须在线（地址来自 `COMFY_URL` 或本机 `data/agent/comfy-endpoint.txt`），离线时脚本会报连接错误
- **认证错误（HTTP 401）**：若脚本报 `HTTP 401` 或 `Unauthorized`，说明 ComfyUI 配置了基本认证，请设置 `COMFY_USER` 和 `COMFY_PASS` 环境变量后重试

## craftman 中调用

craftman 的 plan.json 中 skill 设为 `comfyui`，params 支持：
- `style`：子命令名（gen/edit/krea2/klein），默认 gen
- `size`：图片尺寸，如 `1080x1920`
