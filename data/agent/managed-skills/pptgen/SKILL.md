---
name: pptgen
description: 生成交互式 HTML 网页（不是 PPTX），内置多套视觉模板，自动调本地模型生成内容 + ComfyUI 生图。独立 CLI 工具，零 API 费用。要做传统 PPT 请用 dashiai-ppt。
triggers:
  - 交互式网页
  - HTML演示
  - 网页幻灯片
  - 生成一个页面
  - 网页演示
  - interactive html
  - 网页展示
---

# pptgen — 交互式 HTML 网页生成器

**独立 CLI 工具 `pptgen.py`**，输入一句话生成本地交互式 HTML 网页。
不是 PPTX——输出的是纯 HTML，浏览器直接打开，键盘翻页。
所有计算在本地完成：使用本地 LLM 生成内容，ComfyUI（RTX5090）生图。

## 使用方式

### 命令行一句话（脱离 AI 也能用）
```powershell
python <skill-root>/pptgen.py "AI行业季度汇报，8页，深色科技风"
```

### 参数
| 参数 | 说明 | 默认 |
|------|------|------|
| 第一个参数 | PPT 需求描述（必填） | — |
| `--style` | dark-tech / magazine / minimal / gradient | magazine |
| `--pages` | 页数 | AI自动决定 |
| `--output` | 输出路径 | ./output/xxx.html |
| `--no-image` | 不生成图片 | False |
| `--no-llm` | 跳过 LLM 调用 | False |

### 通过 AI Agent 使用
1. 用户说「做一个 xxx 主题的 PPT」时，先问风格、页数、配图需求
2. 执行 `python <skill-root>/pptgen.py "用户需求" --style X --pages N`
3. 在回复中给用户输出文件的 URL（`http://localhost:4097/srv/...`）

## 风格列表
- `dark-tech` — 深色背景 + 霓虹点缀 + 等宽字体，适合技术汇报
- `magazine` — 纸白底色 + 衬线标题 + 杂志网格，适合通用演示
- `minimal` — 极简白 + 大留白 + 无衬线字体，适合学术/产品
- `gradient` — 渐变背景 + 现代排版 + 圆角卡片，适合创意/品牌

## 配置
编辑 `config.yaml` 可修改 LLM 端点、ComfyUI 路径等。
