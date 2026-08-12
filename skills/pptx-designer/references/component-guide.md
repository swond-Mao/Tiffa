# pptx-designer 组件 API 速查

坐标系：1280×720 px。所有元素必须有 `x, y, w, h`（或线段的 x1/y1/x2/y2）。
单位：`fontSize` 用 px（编译自动 ×0.75 转 pt）；`lineWidth`/`borderWidth` 用 px（×13.333/1280 转 inch）。
颜色：hex 带 `#`（如 `#3B82F6`），编译自动去 `#` 转大写。

## 通用属性

| 属性 | 说明 |
|---|---|
| `x, y, w, h` | 位置与尺寸（px） |
| `opacity` | 0-1 透明度（rect/ellipse 支持） |
| `fontFace` | 字体名，默认取 design.json fontFamily（如微软雅黑） |

## text 文本

```js
{ type: 'text', x: 80, y: 40, w: 900, h: 60,
  text: '标题', fontSize: 36, bold: true, color: '#0F172A',
  align: 'left', valign: 'top', lineSpacing: 34, letterSpacing: 2 }
```

- `runs` 富文本（优先级高于 text）：`[{ text, bold, italic, color, fontSize, fontFace }]`
- 换行用 `\n`（字符串内真实换行亦可）
- `align`: left/center/right；`valign`: top/middle/bottom

## rect / roundRect / ellipse 形状

```js
{ type: 'rect', x, y, w, h, fill: '#3B82F6', opacity: 0.5, lineColor: '#1A1A1A', lineWidth: 2 }
{ type: 'roundRect', x, y, w, h, fill: '#FFFFFF', radius: 16 }
{ type: 'ellipse', x, y, w, h, fill: '#3B82F6', opacity: 0.2 }
```

- `radius`（roundRect）单位 px
- 省略 `fill` → 透明（可用于占位）

## line 线段

```js
{ type: 'line', x1: 80, y1: 200, x2: 1200, y2: 200, color: '#E2E8F0', width: 2 }
```

## image 图片

```js
{ type: 'image', x, y, w, h, path: 'resources/images/hero.png', objectFit: 'cover' }
```

- `path` 相对项目目录或绝对路径；`objectFit`: cover（默认裁切填满）/ contain
- 配图必须先落到项目目录（如 `resources/images/`），禁止在线 URL

## chart 图表

```js
{ type: 'chart', x, y, w, h, chartType: 'bar', // bar|line|pie|doughnut|area
  labels: ['Q1','Q2','Q3'],
  series: [{ name: '2025', values: [30, 45, 60] }],
  colors: ['#3B82F6'], showLegend: true, showValue: false }
```

## table 表格

```js
{ type: 'table', x, y, w, h,
  rows: [[{text:'表头', bold:true},{text:'值', color:'#3B82F6'}], ['A', 1]],
  colW: [200, 150], headerFill: '#F8FAFC', fontSize: 14, borderColor: '#E2E8F0' }
```

- 单元格可为字符串或 `{text, bold, color, fontSize}`

## design.json（项目级配置）

```json
{
  "title": "演示文稿标题",
  "author": "Tiffa",
  "subject": "副标题/部门",
  "palette": ["#0F172A", "#3B82F6", "#F8FAFC", "#64748B"],
  "fontFamily": "微软雅黑"
}
```

- `palette` 参与 lint 配色校验（≤4 个 hex）
- 页面元素颜色必须 ∈ palette ∪ 中性色（黑白）
