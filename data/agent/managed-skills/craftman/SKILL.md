---
name: craftman
description: "多 skill 工作流编排：评估需求→设计方案→确认→按方案调用 skill→合并成品。当用户需要组合多个能力（如做交互式网页+生图+视觉设计）时使用。"
name_cn: "工匠模式 — 多 skill 工作流编排"
description_cn: "评估用户需求，设计多 skill 协作方案，询问用户确认后依次调用技能，最后合并输出。典型场景：\n- '帮我做一份民航史的交互式网页演示，封面用canvas设计'\n- '做一个产品发布会海报+交互式网页'\n支持 pptgen（交互式 HTML 网页）、comfyui（AI生图）、canvas-design（视觉设计）三种技能。需要生成 PPT 文件请用 dashiai-ppt skill。"
---

# craftman — 多 skill 工作流编排

## 核心原则

**规划由 AI（Tiffa）完成，craftman 只做执行和合并。** 不依赖外部 LLM 服务。

AI 根据需求生成 JSON 方案 → 通过 `--plan-json` 或 `--plan-file` 传给 craftman → craftman 依次调用子 skill → 合并输出。

## 流程

1. **规划**（由 AI 在对话中完成）— 分析需求，输出 JSON 方案
2. **确认**（可选）— 展示方案给用户，询问是否执行（Y/n/skip）
3. **执行** — 按顺序调用各 skill
4. **合并** — 整合各 skill 输出（如将 canvas 封面嵌入网页演示首位）

## 技能注册表

| 技能名 | 类型 | 说明 |
|--------|------|------|
| `pptgen` | CLI | 生成交互式 HTML 网页演示（含翻页、动画、主题切换等完整框架，调用 `pptgen.py`） |
| `comfyui` | CLI | AI 生图（调用 `comfy.py`，需要本地 ComfyUI 服务） |
| `canvas-design` | LLM | AI 在对话中生成 HTML+CSS+SVG 设计，通过 `html_content` 或 `html_file` 参数传入 |

## AI 用法（必读，严格按步骤执行）

> **核心原则**：规划由 AI 完成，craftman 只做执行和合并。不依赖外部 LLM。

### 执行食谱（每次必须按此顺序）

1. **写内容文件**：用 Write 工具把 content.json / cover.html 写到 `<cwd>/.craftman/` 目录
2. **写方案文件**：用 Write 工具把 plan.json 写到 `<cwd>/.craftman/plan.json`
3. **执行**：`python "<craftman.py绝对路径>" --plan-file "<cwd>/.craftman/plan.json" --no-confirm`

 craftman.py 的绝对路径在本文件末尾的 **[系统注入]** 块中给出（读 skill:// 后自动追加）。**禁止自己拼路径。**

### plan.json 格式

```json
{
  "analysis": "需求分析",
  "plan": [
    {
      "step": 1,
      "skill": "pptgen",
      "prompt": "传给技能的提示词",
      "required": true,
      "params": {"style": "magazine", "pages": 8, "content_file": "<cwd>/.craftman/content.json"}
    }
  ],
  "merge_instruction": "如何合并"
}
```

### 路径约定

- **craftman.py**：与本 SKILL.md 同目录，绝对路径由系统注入提供
- **临时文件**：写在当前工作目录（cwd）下的 `.craftman/` 子目录。**禁止写 workspace 根目录**
- **输出**：自动输出到 craftman.py 同目录的 `output/`

### canvas-design 特殊说明

canvas-design 是"LLM 型"技能--AI 先用 Write 工具生成 HTML 文件到项目目录下，craftman 负责复制到输出目录做合并并输出链接。

**craftman 流程：**
1. AI 用 Write 工具创建 HTML 文件到 `<项目目录>/.craftman/cover.html`
2. AI 写 plan JSON，params 通过 `html_file` 引用该路径
3. craftman 复制到输出目录，自动输出链接

```json
{
  "step": 1,
  "skill": "canvas-design",
  "prompt": "民航史封面",
  "params": {"html_file": "<项目目录>/.craftman/cover.html"}
}
```

### pptgen 特殊说明

pptgen 默认调外部 LLM 失败（医院内网 22023/22024 便携包不可达）。**正确做法：AI 预生成内容 JSON，craftman 用 `--cache` 跳过 LLM**。

**craftman 流程：**
1. AI 用 Write 工具写出符合 pptgen schema 的内容 JSON 到 `<项目目录>/.craftman/content.json`
2. AI 写 plan JSON 到 `<项目目录>/.craftman/plan.json`，plan 的 params 中通过 `content_file` 引用 content.json
3. AI 调用 `python "<craftman.py绝对路径>" --plan-file "<cwd>/.craftman/plan.json" --no-confirm`
4. craftman 调 pptgen --cache content.json --no-image，跳过 LLM 和生图

```json
{
  "step": 1,
  "skill": "pptgen",
  "prompt": "民航史交互式网页",
  "params": {
    "style": "magazine",
    "pages": 8,
    "content_file": "<项目目录>/.craftman/content.json"
  }
}
```

### canvas-design + pptgen 组合

封面用 canvas-design（AI 写自定义 HTML），内容页用 pptgen（AI 写 JSON 内容），最后 craftman 自动把 canvas 嵌入网页演示首位：

```json
{
  "plan": [
    {"step": 1, "skill": "canvas-design", "prompt": "封面",
     "params": {"html_file": "<项目目录>/.craftman/cover.html"}},
    {"step": 2, "skill": "pptgen", "prompt": "内容",
     "params": {"style": "magazine", "pages": 8,
                "content_file": "<项目目录>/.craftman/content.json"}}
  ],
  "merge_instruction": "canvas 嵌入 pptgen 网页演示首位"
}
```

### comfyui 特殊说明

**AI 不做生图判断，每次必须先问用户**——生不生图、怎么生都由用户决定：

1. **AI 必须问第一问："这次要不要生图？"**
   - 不要替用户决定默认要不要（不管"默认必生"还是"默认不必"都是 AI 判断）
   - 即便看起来"显然该生图"，也要问
2. **用户要生图时，每张配图前再问：**
   - 这张图想表达什么？（prompt）
   - 选哪种风格？krea2（艺术）/ ernie（文字排版好）/ klein（写实）/ zimage（人物）
   - 长宽比？t2i 支持多种预设比例
3. **ComfyUI 服务依赖**：未运行时 craftman 会优雅降级（网页演示仍生成，图片缺失），但应优先提醒用户
4. **提示词扩写**：用户给简短需求后，AI 扩写成详细中文提示词（主体/服饰/光影/色彩/镜头/风格/画质）

任何阶段 AI 都不替用户做决定。


## 用法示例

```powershell
# 列出可用技能
python "<craftman.py绝对路径>" --list-skills

# 从文件加载方案执行（推荐，避免 JSON 引号问题）
python "<craftman.py绝对路径>" --plan-file "<cwd>/.craftman/plan.json" --no-confirm
```

> `<craftman.py绝对路径>` 替换为本文件末尾 [系统注入] 中给出的实际路径。

## 输出

所有输出在 craftman.py 同目录的 `output/` 下。
