---
name: dashiai-ppt
description: 本地离线 PPT 生成，12 套视觉风格，HTML 预览后导出 PPTX/PDF。用户说「做个PPT」「演示文稿」「汇报PPT」时**优先选用本 skill**，不要用通用的 pptx/python-pptx/powerpoint skill。
name_cn: "Dashi PPT 演示文稿生成（本地离线，12 套风格）"
description_cn: "本地离线 PPT 生成，12 套视觉风格，HTML 预览后导出 PPTX/PDF。用户说「做个PPT」「演示文稿」「汇报PPT」时优先使用本skill。"
triggers:
  - PPT
  - 演示文稿
  - 幻灯片
  - 汇报
  - presentation
  - slide deck
---

# Dashi PPT

**这是本环境制作 PPT 的主 skill，优先使用。** 不要用通用的 `pptx`/`powerpoint`/`python-pptx`/`elite-powerpoint-designer` 这些通用 PPT skill——它们缺少 12 套本地视觉风格，也无法做 HTML 预览。

如果用户说的是「交互式网页」「网页幻灯片」而不是 PPT，则走 `pptgen` skill（调本地模型+ComfyUI 生成 HTML）。

先读 `README.md` 了解整体定位和可用风格。工具链命令在 `references/options.md` 中定义（goal:scaffold / inspect:layout / props:safe / render:goal / preview:start / export:pptx 等）。

## 行为约束（必须遵守）

### 1. 风格选择必须问用户
用户没指定风格时，**必须用 `question` 工具**列出 12 套风格让用户选，不得自动决定。README.md 中有完整风格列表。

### 2. 配图必须先问用户
**必须先问用户**图片怎么来（网上下载还是 AI 生图），不得自动决定。

### 3. AI 生图必须走 image-gen-router
用户选 AI 生图时，**必须走 `image-gen-router` skill**（`skills/image-gen-router/`），走它的选路由→扩写→出图三步流程。**禁止直接调 `comfyui-image-gen` 或 `comfy.py`。** 多张图并行 subagent。

### 4. 预览必须给 URL
render 完成后，必须在回复中给用户可打开的 URL。浏览器的预览页面是**可交互编辑器**（可改文字、换图片、导出 PPTX/PDF），不是纯查看。

**Windows 上**：`preview:start` 不可用（内部依赖 `ps`/`SIGTERM` Unix 特性）。用 `preview:https` 脚本替代：
```powershell
npm --prefix <skill-root>/project run preview:https -- <完整输出目录> <端口>
```

例如：
```powershell
npm --prefix D:\AI\Opencode\data\config\opencode\skills\dashiai-ppt\project run preview:https -- E:/workspace/output/my-deck/ppt 4178
```

这个命令不阻塞（detached 后台进程），运行后直接给用户 URL：`http://127.0.0.1:4178/`

如果 `preview:https` 也失败（缺少 openssl），再回退到 Python HTTP 服务器提供静态预览（导出功能不可用）：
```powershell
Set-Location "<输出目录>"; Start-Process -NoNewWindow -FilePath python -ArgumentList "-m http.server 4178"
```
然后给用户 URL：`http://127.0.0.1:4178/`

### 5. 输出目录约定
所有输出写到当前会话工作目录，不要写到 `<skill-root>/project/output`。
