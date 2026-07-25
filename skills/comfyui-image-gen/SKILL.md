---
name: comfyui-image-gen
description: Generate or edit images via a remote ComfyUI instance (RTX 5090). Five pipelines: Krea2 (best artistic/anime), Ernie-Image-Turbo (best text), Z-image (best portrait), Klein (fast realistic), and instruction-based image editing. Routes by user intent. Use for 生图/画图/出图/海报/带文字/编辑图片/P图/改图.
name_cn: "ComfyUI 文生图与图编辑"
description_cn: "调用远程 ComfyUI（RTX5090）文生图与图编辑，免费本地算力，按意图路由到五套流程。"
---

# ComfyUI Image Generation & Editing

Unified CLI `comfy.py` drives a remote ComfyUI server. Three subcommands, routed by intent.

## Server
- Base URL: `http://127.0.0.1:9876/comfyui` (override `COMFY_URL`)
  - Goes through the local LLM reverse proxy on port 9876, which auto-downgrades
    the LLM to a 4B quant while a generation is in flight, then restores the
    default model 5 s after the ComfyUI queue drains. Direct `8188` access no
    longer benefits from this and may starve the LLM of VRAM.
- Output dir: `E:\workspace\comfyui_out` (override `COMFY_OUT`)

## Routing rules (pick BEFORE calling)
