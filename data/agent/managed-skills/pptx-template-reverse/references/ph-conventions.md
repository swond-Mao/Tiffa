# ph idx 编号约定 + 几何约定 + deck 构建 helper 模式

## ph idx 编号约定

| 段 | idx | 用途 |
|----|-----|------|
| 保留段 | 0 | 标题（title 类型，每版式唯一） |
| 保留段 | 1 | 正文（body） |
| 保留段 | 10/11/12 | 日期/页脚/页码（仅标题版式用） |
| 章节页 | 102-105 | 章节号 / 节标题 / 节副标题 / 节阐述 |
| 封底页 | 106-110 | 封底标题 / 副标题 / 阐述 / 会议标题 / 致谢 |
| 封面 | 111-114 | 会议标题 / 副题 / 描述 / 日期落款（主标题用 0=TITLE） |

规则：**100+ 段给自建版式**，避开 0-12 保留段；同一 deck 内 idx 全局不冲突即可（不同 slide 可复用 idx，但同一版式内唯一）。

## 几何约定（10×5.625in 画布，16:9）

| 元素 | 位置 | 说明 |
|------|------|------|
| 内容页标题 | (0.95, 0.255) 5.5×0.36 | 左上，与 logo 组垂直居中，避开页头横线 |
| 版芯 | x 0.6–9.4 / y 0.85–3.65 | 避开页头横线 (~0.68) 与底部装饰带 (~3.73) |
| 页码 | (8.55, 5.30) 右对齐 "NN / 20" | 7.9pt 浅灰 |
| 封面主标题 | (0.94, 1.64) | 32pt bold |
| 封面副标题 | (0.94, 2.58) | 19pt bold 主蓝 |
| 章节大编号 | (0.62, 1.17) 1.41×1.41 | 54pt bold 主蓝 |
| 章节节标题 | (2.34, 1.48) | 26.45pt bold |
| 封底标题 | (0.94, 1.25) | 27pt bold |

**具体数值以 probe 出的模板装饰位置为准**（页头横线/底部装饰带的实际 y 值），上表为合江案例定稿值。

## deck 构建 helper 模式（python-pptx）

```python
# -*- coding: utf-8 -*-
from pptx import Presentation
from pptx.util import Emu, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from lxml import etree

EMU = 914400
def E(v): return Emu(int(v * EMU))
NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main'

def add_textbox(slide, x, y, w, h):
    """空白文本框，返回 txBody 供注入 runs"""
    tb = slide.shapes.add_textbox(E(x), E(y), E(w), E(h))
    tb.text_frame.word_wrap = True
    return tb

def set_para(tf, text, sz, color, bold=False, align='l', anchor='t', sb=0, lsp=100):
    """向 text_frame 追加段落（XML 注入法，控制最细）"""
    p = tf.paragraphs[0] if not tf.paragraphs[0].runs else tf.add_paragraph()
    ...  # 按 a:p/a:pPr/a:r 结构注入，见合江 build_deck.py
```

**关键 helper 清单**（合江 build_deck.py 已验证，可直接抄）：

| helper | 作用 |
|--------|------|
| `txt(slide, x, y, w, h, paras, anchor)` | 文本框 + 多段 runs |
| `shape(slide, x, y, w, h, fill, adj, prst, name)` | 自绘形状（圆角/椭圆/chevron），fill 可 None |
| `photo(slide, path, x, y, w, h, caption)` | 图片 + 底部说明条 |
| `set_ph(slide, idx, paras)` | 向版式占位符填内容（按 idx 找 sp） |
| `drop_ph(slide, idx)` | 移除占位符 sp（不留空框） |
| `page_no(slide, n, total)` | 右下角 "NN / 20" |
| `title_bar(slide, title)` | 内容页标题条 |
| `content_slide(n, title)` / `chap_slide(num, t, sub, desc)` | 版式+页码+标题 一次到位 |

**注意**：`content_slide` 里 `page_no` 加的文本框在后续"清空重画"（移除非 title shapes）时会一并被删 → 重画后要重新 `page_no`。

## 图片预处理

- 源图按目标框比例中心裁切（PIL `ImageOps`），避免拉伸变形
- 原生尺寸 ≥2048 级（用户要求），输出 PNG 放 `<项目>/.temp/ppt/img/`
- 图注条：图片下方 0.28in 高，浅灰底 8.5pt
