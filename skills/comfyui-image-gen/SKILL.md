---
name: comfyui-image-gen
description: Generate or edit images via a remote ComfyUI instance (RTX 5090). Five pipelines: Krea2 (best artistic/anime), Ernie-Image-Turbo (best text), Z-image (best portrait), Klein (fast realistic), and instruction-based image editing. Routes by user intent. Use for 生图/画图/出图/海报/带文字/编辑图片/P图/改图.
name_cn: "ComfyUI 文生图与图编辑"
description_cn: "调用远程 ComfyUI（RTX5090）文生图与图编辑，免费本地算力，按意图路由到五套流程。"
---

# ComfyUI Image Generation & Editing

Unified CLI `comfy.py` drives a remote ComfyUI server. Five subcommands, routed by intent.

## Server
- Base URL: `http://47.108.197.247:8188` (override `COMFY_URL`)
- Output dir: **craftman 调用时自动设为项目目录**，独立调用时默认 `$PORTABLE_ROOT/workspace/comfyui_out`，可通过 `COMFY_OUT` 环境变量或 `--output` 参数覆盖

## Routing rules (pick BEFORE calling)

| 用户意图 | 子命令 | 说明 |
|----------|--------|------|
| 艺术风/动漫/插画风 | `krea2` | Krea2 Muse，最佳艺术画质，支持多行批量 |
| 图片上有文字/海报/排版 | `ernie` | Ernie-Image-Turbo，文字渲染最佳 |
| 写实照片风/快速出图 | `klein` | Flux2-Klein，高写实，自由尺寸 |
| 人物肖像/人像 | `zimage` | Z-image turbo，蒸馏9步，人像最佳 |
| 编辑已有图片/P图 | `edit` | 指令式编辑，需提供原图路径 |

## CLI 用法

所有命令都通过 Python 调用，脚本路径由 [系统注入] 块提供：

```bash
python "<comfy.py绝对路径>" <krea2|ernie|klein|zimage|edit> "提示词" [options]
```

### krea2 - 艺术风/动漫

```bash
python "<comfy.py绝对路径>" krea2 "提示词" [--size WxH] [--seed N] [--steps N] [--name 名前缀] [--protagonist liuyifei|kopiu]
```
- 默认尺寸 `1080x1920`（竖图）
- `--protagonist`：主角 LoRA 开关，默认 liuyifei
- 支持多行提示词批量生成（每行一张图），或用 `-` 从 stdin 读取，或 `--prompt-file` 从文件读取

### ernie - 文字排版/海报

```bash
python "<comfy.py绝对路径>" ernie "提示词" [--size WxH] [--seed N] [--steps N] [--name 名前缀]
```
- 默认尺寸由 workflow 决定，可用 `--size` 覆盖
- 适合需要图片上渲染文字的场景

### klein - 写实风

```bash
python "<comfy.py绝对路径>" klein "提示词" [--size WxH] [--seed N] [--steps N] [--cfg F] [--sampler 名称] [--negative 负面词] [--name 名前缀]
```
- 默认尺寸 `832x1216`
- 支持自定义 cfg、sampler、负面提示词

### zimage - 人像

```bash
python "<comfy.py绝对路径>" zimage "提示词" [--size WxH] [--seed N] [--steps N] [--name 名前缀] [--with-colleague]
```
- 默认尺寸 `1920x1080`
- `--with-colleague`：启用内置同事 LoRA

### edit - 图片编辑

```bash
python "<comfy.py绝对路径>" edit "<本地图片路径>" "编辑指令" [--seed N] [--steps N] [--name 名前缀]
```
- 编辑指令示例：`"脱掉人物上衣"`、`"把背景换成海滩"`

## 通用说明

- **输出**：成功后 stdout 输出 `RESULT:["路径1","路径2",...]`，每行一张图
- **超时**：默认 600 秒，可用 `--timeout` 覆盖
- **多行批量**：krea2/ernie/klein/zimage 支持，提示词中每行 = 一张图
- **种子**：`--seed N`，批量时每张图自动用不同种子（seed+i）
- **服务依赖**：ComfyUI 服务必须在线（`http://47.108.197.247:8188`），离线时脚本会报连接错误

## craftman 中调用

craftman 的 plan.json 中 skill 设为 `comfyui`，params 支持：
- `style`：子命令名（krea2/ernie/klein/zimage/edit），默认 krea2
- `size`：图片尺寸，如 `1080x1920`
- `name`：输出文件名前缀，默认 craftman
