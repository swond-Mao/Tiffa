---
name: pptx-template-reverse
description: 从用户上传的 .pptx 模板逆向出完整可复用主题模板（python-pptx 原生路线）：提取设计系统（画布/字体/色板/装饰资产/版式占位符），克隆/改造/新建版式，产出 WPS 可直接一键套用的主题模板 + 可选汇报 deck。触发词：模板逆向、逆向主题、做主题模板、版式提取、克隆版式、WPS 主题、按这个模板做主题、把模板变成可套用的。
description_cn: "从 .pptx 模板逆向完整主题模板：设计系统提取 + 版式克隆改造 + 一键套用主题产出。"
triggers:
  - 模板逆向
  - 逆向主题
  - 做主题模板
  - 版式提取
  - 克隆版式
  - WPS主题
  - 按这个模板做主题
  - 把模板做成可套用的
---

# pptx-template-reverse

从用户上传的 .pptx 模板（通常是 WPS 导出的"完整版式"，含示例页）逆向出**完整可复用主题模板**，并基于它构建汇报 deck。python-pptx 原生路线，产物 WPS/Office 直接打开套用。

## 与其它 PPT 技能的分工（先判断走哪条路）

| skill | 输入 | 机制 | 产物 |
| --- | --- | --- | --- |
| **pptx-template-reverse**（本） | 用户的 .pptx 模板 | python-pptx 直接改母版/版式 part | 原生主题模板 .pptx + 原生 deck |
| pptx-designer | 文字稿/大纲 | JS/HTML 管线（pptxgenjs/build.js） | 原生 .pptx（主题=JS 主题库，与原生模板不互通） |
| pptx-from-layouts | markdown 大纲 | 填充模板**已有**版式的占位符 | 原生 .pptx（不会新建版式） |

**选本 skill 的信号**：用户要"逆向/提取/做主题模板/克隆版式/让版式可一键套用"，或模板缺少章节页/封底页等版式需要补齐。
**选 pptx-from-layouts 的信号**：模板版式已够用，只按大纲填内容。

## 依赖

- Python 3.10+（便携根 `$ROOT/python/python.exe`，解释器路径以实际探测为准）
- `python-pptx`（已装 1.0.2）、`lxml`、`Pillow`（QA 渲染用）

## 标准流程（6 步，不可跳步）

### Step 1：设计系统提取

```bash
python scripts/probe_template.py <模板.pptx>
```

输出：画布尺寸、字体清单、色板（srgbClr 频次）、各 master 版式列表（名称+占位符 idx/类型/位置/默认样式）、示例页 shape 明细（位置/尺寸/填充）、media 清单。
**必须完整读一遍输出**，形成设计系统结论（主色/辅色/字体/装饰资产位置），这是后续所有几何与配色的依据。

### Step 2：与用户确认主题结构

ask 确认（用户已明确的除外）：
1. **保留/改名哪些版式**（默认：内容页保留改造，其余保留）
2. **需要新建哪些版式**（默认补齐：章节页 + 封底页；封面缺背景图时改造）
3. **版芯与左上角文字位置**（默认：版芯 x 0.6–9.4in / y 0.85–3.65in；内容页标题 (0.95, 0.255in)——避开页头装饰与底部装饰带，具体以 probe 出的装饰位置为准）
4. **是否顺带做 deck**（页数/大纲另走大纲确认）

### Step 3：写主题配置 JSON

按 `references/case-hejiang.md` 的配置格式写 `<项目>/.temp/theme_config.json`。
配置结构（layout_ops 按序执行）：

```json
{
  "source": "模板.pptx",
  "output": "主题.pptx",
  "delete_sample_slides": true,
  "master_index": 0,
  "layout_ops": [
    {"type": "rename", "name": "标题和内容", "to": "内容页"},
    {"type": "modify", "name": "内容页", "remove_ph_types": [],
     "add_title_ph": [0, "页标题", 0.95, 0.255, 5.5, 0.36, 16, "1A2230", "bold", "ctr"],
     "add_body_ph": [1, "版芯", 0.60, 0.85, 8.80, 2.80, 14, "4A5568"],
     "add_shapes": [
       {"kind": "rect", "x": 0.62, "y": 1.62, "w": 0.08, "h": 0.75, "fill": "1E4FA8", "name": "coverbar"},
       {"kind": "line", "x": 2.34, "y": 2.58, "w": 6.25, "fill": "1E4FA8", "name": "chapline"},
       {"kind": "pic", "source": "image4.png", "x": 7.24, "y": 0, "w": 2.76, "h": 0.64, "name": "logo"}
     ]},
    {"type": "clone", "source": "内容页", "name": "章节页", "remove_ph_types": ["body"],
     "add_ph": [
       [102, "章节号", 0.62, 1.17, 1.41, 1.41, "01", 54, "0E3F8C", "bold", "ctr", "ctr"],
       [103, "节标题", 2.34, 1.48, 7.03, 0.55, "节标题", 26.45, "1A2230", "bold"]
     ],
     "add_shapes": []}
  ]
}
```

规格：
- `add_ph` 行：`[idx, 名称, x, y, w, h, 默认文本, 字号, 色hex, bold?, align?, anchor?]`（后三项可省）
- `add_title_ph`/`add_body_ph`：同上但 type 固定 title/body
- `add_shapes` 元素：`rect`（可加 `alpha`(0-100)/`line`/`line_w`/`adj`/`prst`/`name`)、`line`（=细 rect）、`pic`（`source` 写 media 文件名，从 package 里找 image part，用 `relate_to` 复用不新建）
- **ph idx 编号约定**：见 `references/ph-conventions.md`（102-105 章节 / 106-110 封底 / 111-114 封面，避开 0-12 保留段）

### Step 4：构建主题模板

```bash
python scripts/build_theme.py <theme_config.json>
```

内部顺序（已固化，不可改）：layout_ops 全部执行完 → 再删示例页 → 保存。原因见 references/clone-recipe.md（iter_parts 图遍历）。

### Step 5：重载验证（必做）

```bash
python scripts/check_parts.py <主题模板.pptx>
```

验收三条：① `dups=无`；② 版式列表含全部新建版式且各归其位；③ 各版式 ph idx 与配置一致。任一条不过 → 读 `references/clone-recipe.md` 按疑点清单排查后重跑。

### Step 6（可选）：构建 deck + QA 渲染

deck 构建：python-pptx 基于主题模板逐页填充占位符（helper 模式见 `references/ph-conventions.md` §deck 构建）。
QA 目检：

```bash
python scripts/qa_render.py <deck.pptx> -o qa_sheet.png
```

PIL 自渲染 4×N 联系图（版式装饰按版式自身 shape 泛化渲染），read 看图逐页检查溢出/碰撞，修 build 脚本重跑直到干净。
最后 `check_parts.py` 验 deck 无重复 part。

## 红线（踩过的坑，详见 references/clone-recipe.md）

1. **partname 扫描必须全 package `iter_parts()`**（含新建 part），取 max+1；只扫 master rels 会与 package 既有 slideLayoutN 碰撞 → 两个克隆同 partname → parts 字典互相覆盖
2. **image rel 重建必须 `get_or_add` 复用同一 image part**，新建会导致 `Duplicate name: ppt/media/imageN.png` 警告 + 重复 part
3. **克隆 XML 的 `r:embed` 必须按 rId_map 重写**（deepcopy 保留源 rId，新 part rels 重新编号）
4. **必须向 master 的 `sldLayoutIdLst` append `p:sldLayoutId`**，否则版式不归属该 master、WPS 里看不到
5. **`sldLayoutId` 的 id 全局唯一**（跨所有 master 扫描 max+1）
6. 保存后**必须重载自检**，不验证不交付
7. TTSR：含反斜杠转义的 inline `python -c` 会被 hook 拦截 → 复杂 Python 一律写脚本文件；bash 路径一律正斜杠
8. WPS 打开模板时产生锁文件 → 源模板只读不写
9. 零高度文本框不可靠（渲染器可能裁剪）→ 文本框高度 ≥0.16in
10. 中间产物放 `<项目>/.temp/`，最终 .pptx 放项目根

## 文件结构

```
pptx-template-reverse/
├── SKILL.md
├── scripts/
│   ├── theme_lib.py          # 核心库：XML 构造器 + clone_layout + 配置驱动构建
│   ├── build_theme.py        # CLI：按配置构建主题模板（含 sys.path 引导）
│   ├── probe_template.py     # CLI：设计系统提取
│   ├── qa_render.py          # CLI：PIL 自渲染联系图（版式装饰泛化渲染）
│   └── check_parts.py        # CLI：重载验证（重复part/版式/ph idx）
├── examples/
│   └── hejiang-config.json   # 合江案例完整配置（可直接参考）
└── references/
    ├── clone-recipe.md       # 版式克隆配方 + 踩坑清单（必读）
    ├── ph-conventions.md     # ph idx 编号约定 + 几何约定 + deck 构建 helper 模式
    └── case-hejiang.md       # 合江县人民医院完整案例（配置实例 + 定稿几何 + 经验）
```
