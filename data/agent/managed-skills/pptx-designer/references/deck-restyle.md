# 从原 deck 逆向风格改造（deck-restyle）

> **何时读**：用户说"用我原来的风格/套我那个模板/用原色板"、"把这几页高级化"、"改造某页"时。
> 本指南解决：**不凭空设计，而是从用户现有 .pptx 逆向出风格/素材，做高级改造**。

## 一、从原 deck 提取风格（色板/字体/版式）

**用 python-pptx 读原 PPT，逆向出"原风格"基线**，不靠猜：

```python
from pptx import Presentation
EMU = 9525  # EMU per px
p = Presentation('原deck.pptx')
colors, fonts = {}, set()
for s in p.slides:
    for sh in s.shapes:
        try:
            if 'SOLID' in str(sh.fill.type):
                c = str(sh.fill.fore_color.rgb); colors[c] = colors.get(c, 0) + 1
        except: pass
        if sh.has_text_frame:
            for para in sh.text_frame.paragraphs:
                for r in para.runs:
                    try: colors[str(r.font.color.rgb)] = colors.get(str(r.font.color.rgb), 0) + 1
                    except: pass
                    if r.font.name: fonts.add(r.font.name)
# 高频颜色（前8-12）= 原色板；fonts = 字体
```

- **高频颜色**（前 8-12）= 原色板：主色/辅色/底色/强调色
- **字体**：原 deck 字体（如微软雅黑）
- **版式坐标**：读每页 `sh.left/top/width/height`（÷9525 转 px），还原原 deck 版式（标题位置/卡片排布/页码位置）
- 用提取的色板 + 字体 + 版式做 design.json，**改造时保留原风格**

## 二、从原 deck 提取图片素材

```python
for pi, s in enumerate(p.slides):
    for sh in s.shapes:
        if sh.shape_type == 13:  # 图片
            img = sh.image
            L, T = int(sh.left)//9525, int(sh.top)//9525
            W, H = int(sh.width)//9525, int(sh.height)//9525
            open('img/p%d_%s.%s' % (pi+1, idx, img.ext), 'wb').write(img.blob)
            # 记录位置尺寸，判断用途（场地/设备/效果图）
```

- 提取后**用视觉模型看每张图**，判断内容（场地/设备/效果图/实景）
- 复用原 deck 真实素材，比色块模拟高级得多
- **预裁到目标比例**（PIL crop 到 16:9/4:3/3:4），不拉伸变形

## 三、单页高级改造（保留原风格）

把"规整平铺"页改成高级版式，**色板/字体/版式头保持原 deck 一致**：

| 版式 | 适用 | 做法 |
| --- | --- | --- |
| **非对称杂志式** | 多图/主图+次图 | 左大主图（描边大卡）+ 右 2×N 小卡（交替白卡/浅色卡）+ 底部强调条 |
| **4×N 网格卡** | 设备/清单（4-8 项） | 编号徽章 + 浅色卡 + 名称 + 说明，底部强调条 |
| **非对称双卡** | 2 张竖图 | 大小/位置错开，打破对称呆板 |
| **海报式全屏** | 概念图/效果图 | 全页大图 + 骑线大标题（文字加底衬） |
| **圆形聚焦** | 单设备/核心概念 | 同心圆 + 主图 + 右侧列表 |
| **半页图+叠层卡** | 图+多要点 | 半页图 + 右侧 3 层递进卡 |

**改造三原则**：
1. **色板/字体/版式头保持原 deck 一致**（顶部标题左对齐 + 强调条 + 页码位置沿用）
2. **内容写齐全**（设备/清单不遗漏，用户强调"写齐全"就逐项列全）
3. **保留真实素材**（原 deck 图片复用，不凭空造）

## 四、AI 生成全景/概念图（缺图时）

原 deck 没有合适全景/概念图时，用 ComfyUI 生成：

```bash
python <comfy.py> zimage "modern medical ... interior, wide panoramic, blue and white theme, photorealistic" --size 1920x1080 --seed N --name hero
```

- **zimage 管线**最稳（klein 写实管线易跑偏成 UI/乱码，备选）
- 提示词**简化聚焦核心场景**（宽幅全景/蓝白主题/明亮现代/photorealistic）
- **负面词**排除乱码：`no text, no logo, no ui card, no portrait, no watermark`
- 换种子多试，**视觉模型校验**每张出图（确认无乱码、场景对、主题对）
- 生成后 PIL 裁 16:9 做 hero 图

## 五、改造后验证

- build.js lint 通过 + qa_render 渲染
- **视觉模型看渲染图**：版式/可读性/风格一致（对照原 deck 风格）
- 交付独立 .pptx，提示可合并进原 deck

## 六、常见坑

| 坑 | 应对 |
| --- | --- |
| 原 deck 只列部分设备/项 | 问用户要完整清单，别瞎编 |
| AI 生成跑偏（UI/乱码） | 换 zimage + 简化提示词 + 负面词 + 换种子 |
| 图片拉伸变形 | 预裁到目标比例 |
| 改造页和原 deck 风格割裂 | 严格沿用原色板/字体/版式头 |
| 内联 PIL/python 被 claude-mode 拦 | 写独立 .py 脚本文件执行，不内联 |
