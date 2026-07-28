# 知识卡：Skills 技能系统

## 模块标识

- **路径**: `skills/`（18 个子目录）
- **运行环境**: 由内核 manage_skill 机制按需加载
- **职责**: 为 agent 提供专业能力（文档/演示/图像/研究/系统）
- **入口**: 每个子目录的 `SKILL.md`

## 架构特征

- **独立性**：每个 skill 目录自包含，无跨 skill 依赖
- **声明式**：SKILL.md 是纯指令文档（ComfyUI 除外，含 comfy.py 脚本）
- **按需加载**：不占常驻 context，触发时注入
- **用户显式触发**：不主动建议

## SKILL.md 格式

```yaml
---
name: kebab-case-id
description: 英文触发条件 + 功能描述
name_cn: "中文名"
description_cn: "中文描述"
license: MIT
metadata:
  category: research|design|document|image|system
  phase: full-lifecycle
  audience: ...
  complexity: beginner|intermediate|advanced
---
```

后接 Markdown 正文：执行流程 + 约束/铁律。

## 分类速查

| 类别 | Skills |
|------|--------|
| 文档 (5) | docx, pdf, xlsx, doc-coauthoring, contract-review |
| 演示 (3) | dashiai-ppt, pptgen, pptx-from-layouts |
| 图像 (4) | comfyui-image-gen, image-gen-router, image-style-enhancer, canvas-design |
| 研究 (3) | deep-research, diagram-drawing, history-query |
| 系统 (3) | craftman, memory-manager, onboarding |

## ComfyUI 特殊说明

唯一含可执行代码的 skill：
- `comfy.py`（397 行）— 5 种管线（zimage/ernie/krea2/klein/edit）
- 5 个 `workflow_*_api.json` — ComfyUI API 工作流
- 服务地址：`http://47.108.197.247:8188`（COMFY_URL 可覆盖）
- 输出：`E:\workspace\comfyui_out`（COMFY_OUT 可覆盖）
- 铁律：用户没选管线必须问

## 依赖关系

- 加载方：内核 `manage_skill` + `managed-skills` 目录
- 触发方：行为约束 `constraints-inject.md` 中的触发词映射
- 运行时：部分 skill 需要 Python（`python/python.exe`）

## 修改注意

- 新增 skill：创建 `skills/<name>/SKILL.md`，遵循 frontmatter 格式
- 不要在 skill 间引入依赖
- ComfyUI 管线修改需同步更新 SKILL.md 中的命令说明
- 触发词映射在 `data/memory/constraints-inject.md` 中维护
