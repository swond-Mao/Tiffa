---
name: image-gen-router
description: 生图统一入口 skill。用户提生图需求后，强制先让用户选择路由分支（t2i/ernie/klein/zimage/edit）与画幅，再由当前 AI agent 自己扩写提示词，最后调用 gen 出图。Use for 生图/画图/出图/海报/带文字/编辑图片/P图/改图/写实照片。
name_cn: "生图路由助手"
description_cn: "AI 生图（ComfyUI）：真实感照片、人物、场景、带文字的视觉图。抽象/几何/排版类海报走 canvas-design 而非本 skill。"
---

# 生图路由助手 (Image Gen Router)

本 skill 是 ComfyUI 生图的**统一入口**。它不重复实现出图逻辑，而是包装
`comfyui-image-gen` skill 的 `comfy.py`，强制走「选路由 → 扩写 → 出图」三步流程。

**核心铁律：收到生图需求后，必须先调用 `question` 工具让用户选路由与画幅，
绝对禁止跳过选择直接默认执行 comfy.py。**

## 第一步：强制路由选择（必须最先做）

收到生图需求后，**立即**调用 `question` 工具，向用户展示以下选择：

### 分支定位（每个分支的角色）

| 分支 | 定位 | 何时选 |
|---|---|---|
| `zimage` | **人物写真首选**，LoRA 生态丰富（同事 LoRA 默认不挂） | 角色肖像、人物有气质、特定人物 LoRA |
| `ernie` | **真实感摄影 + 文字渲染双强** | 海报带文字、真实感偷拍、标题清晰 |
| `klein` | **全能但人物偏欧美气质** | 场景图、静物、风景、自由尺寸 |
| `t2i` | **双分支并行融合**，各取所长 | 又要快、又想要 klein 和 zimage 各自的优点 |
| `krea2` | **Krea2 Muse 艺术/anime**，双主角 LoRA（liuyifei / kopiu） | 艺术化人物、动漫感、特定主角出图 |
| `edit` | **改图编辑**，保持人物一致 | P图、换背景、换衣、修饰 |

### 推荐选择规则
- **人物写真 / 角色肖像** → `zimage` 首选
- **真实感 + 文字清晰** → `ernie` 首选
- **场景 / 静物 / 风景 / 自由尺寸** → `klein`
- **快速双模型对比出图** → `t2i`
- **改图 / 编辑** → `edit`

### 候选推荐时把推荐项放第一个

询问时还要选：
2. **画幅** —— 横屏 16:9 / 竖屏 9:16 / 方形 1:1 / 自由尺寸（指定 WxH）
3. **若选 `krea2` 分支**：还需选**主角** —— `liuyifei`（默认）或 `kopiu`（仅当用户明确点名 kopi-u 时选）。把推荐项放第一个并标注 (推荐)。

把推荐的选项放第一个并标注 (推荐)。

## 第二步：提示词扩写

用户确认路由后，若分支是 `ernie` / `t2i` / `klein` / `zimage`：
**当前 AI agent 自己**把用户的简短需求扩写成**一段详细中文提示词**
（主体、服饰、光影、色彩、镜头、风格、画质）。保持用户要求的画面文字原样。

**注意**：扩写是 AI agent 自身行为，**不需要也不能调用外部"深度模型"**。
"深度模型/效率模型" 是 MedReview 医疗项目的术语，便携包用不到。
当前会话跑的可能是 mimo/deepseek/家用 GGUF 任何一个，扩写质量由该模型决定，
不是由某个固定"深度模型"决定。

`edit` 分支不需要扩写，直接用用户指令。

## 第三步：调用出图（Tiffa 直接调 `comfy.py`）

⚠️ **Tiffa 便携包没有 `gen` 包装器**（那是 OpenCode 环境专有命令，本包不存在），**不要调用 `gen`**。
正确入口是**直接调 `comfy.py`**：

```powershell
$env:PYTHONIOENCODING="utf-8"
& "$env:PORTABLE_ROOT/python/python.exe" "$env:PORTABLE_ROOT/skills/comfyui-image-gen/comfy.py" `
  <krea2|edit|ernie|zimage|klein> --prompt "..." [--size WxH] [options]
```

- 调用**必须**先走第一步的路由选择（选分支 + 画幅）：分支名 = `comfy.py` 的子命令，缺子命令等于跳过路由。
- `comfy.py` 默认连 `http://47.108.197.247:8188`，**禁止改成 localhost**（弱模型易幻觉成 localhost:8188 出厂默认）。
- 每个命令结束打印 `RESULT:<json array of png paths>`，把路径报告给用户。

### 子命令与参数速查

- **t2i**：⚠️ `comfy.py` 无单一 `t2i` 子命令，它等于**并行调 `klein` + `zimage` 各一次**（分别用各自 `--size`）。
- **ernie**：`comfy.py ernie --prompt "..." --size 1920x1080`（横屏）或 `--size 768x1280`（竖屏默认）
  - **支持批量提示词**（多行文本，每行生成一张图）
- **klein**：`comfy.py klein --prompt "..." --size 1920x1080` 或 `--size 832x1216`
  - 支持 `--negative`、`--steps`、`--cfg`、`--sampler`
  - **支持批量提示词**（多行文本，每行生成一张图）
- **zimage**：`comfy.py zimage --prompt "..." --size 1080x1920`
  - 默认 **9 步**（workflow 内置），cfg=1.0
  - **默认不挂人物 LoRA**。需要同事 LoRA 用 `--with-colleague`（仅同事脸）。其他人物 LoRA：`--lora-person <path>`
  - **支持批量提示词**（多行文本，每行生成一张图）
- **krea2**：`comfy.py krea2 --prompt "..." --size 1080x1920`
  - **支持批量提示词**（多行文本，每行生成一张图）
  - **双主角 LoRA 开关**：`--protagonist liuyifei`（默认）| `--protagonist kopiu`
  - 触发词自动注入：选 liuyifei 时提示词前加 `liuyifei`，选 kopiu 时加 `kopiu`
  - **仅当用户明确说"用 kopiu"时才传 `--protagonist kopiu`**，否则默认 liuyifei
- **edit**：`comfy.py edit <LOCAL_IMAGE> <INSTRUCTION>`

### 注意

- 出图约 10-30s，脚本阻塞直到完成。
- 若返回 HTTP 400，说明 workflow API 节点字段过期，需 `/object_info/<class_type>` 重探。
- 尺寸用 `--size WxH`（如 `1920x1080`）；`gen` 的 `--custom 16:9` 写法在 Tiffa 不适用。
