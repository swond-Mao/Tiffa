# Skills 技能系统

## 概述

Skills 是 Tiffa 的专业能力扩展层，位于 `skills/` 目录，共 18 个独立技能单元。每个 skill 是一个自包含目录，入口为 `SKILL.md`，彼此无依赖。

## 加载机制

- 内核原生 `manage_skill` 机制 + `managed-skills` 目录
- 触发方式：
  - 用户明确说"用 XX skill"
  - 行为约束中的触发词映射（如"生图" → `skill(name: "comfyui-image-gen")`）
- 加载后 SKILL.md 内容注入当前上下文，指导 agent 执行专业流程

## SKILL.md 规范

```markdown
---
name: skill-id              # kebab-case 唯一标识
description: 英文描述（触发条件 + 功能）
name_cn: "中文名"
description_cn: "中文描述"
license: MIT
metadata:
  category: research|design|document|image|...
  phase: full-lifecycle|...
  audience: ...
  complexity: beginner|intermediate|advanced
---

# Skill 标题

## 执行流程
（分步骤指导 agent 完成任务）

## 约束/铁律
（该 skill 的特殊规则）
```

## 18 个 Skill 分类

### 文档类 (5)

| Skill | 说明 |
|-------|------|
| `docx` | Word 文档助手（生成/编辑） |
| `pdf` | PDF 助手（生成/读取/合并/拆分/表单/水印） |
| `xlsx` | Excel 助手 |
| `doc-coauthoring` | 文档辅写（结构化工作流） |
| `contract-review` | 合同审核（三层审查 + 批注 + 流程图） |

### 演示类 (3)

| Skill | 说明 |
|-------|------|
| `dashiai-ppt` | Dashi PPT 生成（12 套风格，离线） |
| `pptgen` | HTML 网页演示生成器 |
| `pptx-from-layouts` | 模板排版 PPT 生成 |

### 图像类 (4)

| Skill | 说明 |
|-------|------|
| `comfyui-image-gen` | ComfyUI 文生图与图编辑（5 种管线） |
| `image-gen-router` | 生图路由助手（统一入口） |
| `image-style-enhancer` | 图片风格增强器（12 风格菜单） |
| `canvas-design` | 创意海报设计（LLM 生成 HTML+CSS+SVG） |

### 研究/图表类 (3)

| Skill | 说明 |
|-------|------|
| `deep-research` | 深度调研（三阶段：问题细化→多源搜索→交叉验证） |
| `diagram-drawing` | 图表绘制（Draw.io / Excalidraw） |
| `history-query` | 历史查询 |

### 系统/元类 (3)

| Skill | 说明 |
|-------|------|
| `craftman` | 工匠模式（多 skill 工作流编排） |
| `memory-manager` | 长期记忆管理 |
| `onboarding` | 新用户引导 |

## ComfyUI 生图管线

### 服务

- 地址：`http://47.108.197.247:8188`（`COMFY_URL` 环境变量可覆盖）
- 脚本：`skills/comfyui-image-gen/comfy.py`
- 输出目录：`E:\workspace\comfyui_out`（`COMFY_OUT` 可覆盖）

### 5 种管线

| 管线 | 适用场景 | 命令 |
|------|---------|------|
| `zimage` | 人物写真/名人/角色肖像 | `python comfy.py zimage "<prompt>" --steps 9 --size 1080x1920` |
| `ernie` | 海报带文字/排版文字 | `python comfy.py ernie "<prompt>" --size 768x1280` |
| `krea2` | 艺术感/动画质感/电影海报 | `python comfy.py krea2 "<prompt>" --steps 8 --size 1080x1920` |
| `klein` | 写实/场景/静物/自由尺寸 | `python comfy.py klein "<prompt>" --size 832x1216 --seed 0` |
| `edit` | 改图/P图/编辑/换背景 | `python comfy.py edit "<图片路径>" "<编辑指令>"` |

### 工作流文件

```
skills/comfyui-image-gen/
├── comfy.py                    # 主脚本
├── workflow_zimage_api.json    # zimage 管线
├── workflow_ernie_turbo_api.json # ernie 管线
├── workflow_krea2_api.json     # krea2 管线
├── workflow_klein_api.json     # klein 管线
├── workflow_edit_api.json      # edit 管线
└── SKILL.md
```

### 铁律

- 用户没明确选管线时**必须问**——列出 5 个管线让用户选
- 用户给简短需求后，先扩写成详细中文提示词再传给管线
- 命令最后打印 `RESULT:[路径]`，报告纯路径

## Skill 设计原则

1. **独立性**：每个 skill 目录自包含，无跨 skill 依赖
2. **声明式**：SKILL.md 是纯指令文档，不含可执行代码（ComfyUI 除外）
3. **按需加载**：不占常驻 context，只在触发时注入
4. **用户显式触发**：不主动建议或预判用户要哪个 skill
