---
name: comfyui-image-gen
description: Generate or edit images via a remote ComfyUI instance (RTX 5090). Five pipelines: Krea2 (best artistic/anime), Ernie-Image-Turbo (best text), Z-image (best portrait), Klein (fast realistic), and instruction-based image editing. Routes by user intent. Use for 生图/画图/出图/海报/带文字/编辑图片/P图/改图.
name_cn: "ComfyUI 文生图与图编辑"
description_cn: "调用远程 ComfyUI（RTX5090）文生图与图编辑，免费本地算力，按意图路由到五套流程。"
---

# ComfyUI Image Generation & Editing

Unified CLI `comfy.py` drives a remote ComfyUI server. Three subcommands, routed by intent.

## Server
- Base URL: `http://47.108.197.247:8188` (override `COMFY_URL`)
- Output dir: **craftman 调用时自动设为项目目录**，独立调用时默认 `$env:PORTABLE_ROOT/workspace/comfyui_out`，可通过 `COMFY_OUT` 环境变量或 `--output` 参数覆盖

## Routing rules (pick BEFORE calling)
