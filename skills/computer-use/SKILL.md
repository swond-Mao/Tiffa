---
name: computer-use
description: "AI 驱动的 Windows 桌面自动化（v2，UIA 优先）。仅『电脑控制』触发。"
name_cn: "电脑控制"
description_cn: "AI 驱动的 Windows 桌面自动化 v2（UIA 控件树 + 四级降级），仅『电脑控制』触发。"
---

# 电脑控制 v2 — UIA 优先的桌面自动化

## 铁律

**禁止在 bash 中内联写 Python 代码操控桌面。禁止自己 import pyautogui/mss/PIL。所有桌面操作必须通过 MCP 工具集执行。**

## 安全流程

1. **ask 确认**：用 ask 工具向用户确认任务意图
2. **展示计划**：告诉用户将做什么、哪些窗口会受影响
3. **用户确认后才执行**
4. **Windows 确认框**：`computer_use` 和 `desktop_input(launch)` 会弹确认
5. **ESC 紧急制动**：pyautogui FAILSAFE 已开启，鼠标移到角落即中断

## 禁止操作

格式化磁盘 / 关机重启 / 注册表 / 杀系统进程 / 任何破坏性不可逆操作

## MCP 工具集（8 个原子工具）

### 1. `ui_inspect` — 枚举可交互控件

**第一步永远是 inspect**。返回编号列表，每个元素有系统给出的名称和精确物理像素坐标。

```
ui_inspect(window="窗口标题片段")     # 模糊匹配窗口
ui_inspect()                          # 不填=前台窗口
ui_inspect(window="desktop")          # 列出所有顶层窗口
ui_inspect(name_filter="确定")        # 只显示名称含"确定"的元素
```

返回格式：
- 文本表格：# 编号 | 类型 | 名称 | 中心坐标 | 可用操作
- 附带一张缩略截图（让主模型看到当前界面）

### 2. `ui_act` — 操作元素

按 `ui_inspect` 返回的编号或名称执行操作。

```
ui_act(ref="#5", action="invoke")           # UIA 原生触发（不移动鼠标）
ui_act(ref="#3", action="set_text", text="hello")  # 写入文本框
ui_act(ref="#7", action="click")            # 精确坐标点击（降级）
ui_act(ref="#2", action="toggle")           # 切换开关
ui_act(ref="确定", action="invoke")         # 名称引用也行
```

**操作后自动附带截图回传**——主模型立刻看到效果，不需要"记得验证"。

### 3. `ui_screenshot` — 截图（可选 SoM 标注）

```
ui_screenshot()                              # 全屏截图
ui_screenshot(window="记事本")               # 截指定窗口
ui_screenshot(annotate=True)                 # SoM 模式：画编号框
ui_screenshot(annotate=True, max_items=30)   # 限制标注数量
```

SoM（Set-of-Mark）模式在截图上给每个可交互元素画彩色编号框。
模型只需回答"点 12 号"，无需估算像素坐标。对 4K 屏幕特别有效。

### 4. `desktop_input` — 归一化坐标兜底

当 UIA 无法覆盖目标（游戏/Canvas/Electron 应用）时使用。
坐标使用 0~1000 归一化值，与屏幕分辨率彻底解耦。

```
desktop_input(action="click", nx=500, ny=300)    # 点击屏幕中心偏上
desktop_input(action="type", text="hello")       # 键盘输入
desktop_input(action="key", keys=["ctrl","c"])    # 组合键
desktop_input(action="launch", command="notepad") # 启动程序
desktop_input(action="scroll", dy=5)             # 向下滚动
desktop_input(action="wait", ms=2000)            # 等待
```

### 5. `computer_use` — 便利入口

简单任务的快捷方式。内部组合调用 inspect+screenshot+act。
复杂多步任务建议主模型逐步调用上面 4 个原子工具。

```
computer_use(task="打开记事本输入你好")
```

### 6. `ui_ocr` — OCR 文字识别（不依赖控件树）

对窗口/区域做 Windows 内置 OCR（支持中文），返回每行文本及其**物理屏幕坐标**。
当截图太密、模型读不清文字时，用本工具拿到结构化文本+坐标，再交给下方 `ui_find_text` / `ui_click_text` 精确操作。
**对微信(Qt, UIA 全盲)等盲窗同样有效**。

```
ui_ocr(window="微信")                    # 全窗口文字识别
ui_ocr(window="微信", region="list")     # 只识别左侧列表区（降密度）
ui_ocr(window="微信", min_width=720)     # 把小区域上采样到 720 宽提升识别率
```

返回文本表格：`cy  cx  文本  包围盒(x1,y1)-(x2,y2)`。

### 7. `ui_find_text` — OCR 模糊匹配定位

在窗口/区域内 OCR 并找到与目标文本最接近的一行，返回文本、相似度分数、物理中心坐标。
**通用**（任意盲窗/应用都可用，不限于微信）。支持中英文混输、拼音、容忍 OCR 错别字/声调。

`scope` / `scope_end` —— 分类限定的通用机制。当搜索结果同名词多、需排除干扰项时：
- `scope="group"`（微信预设，内置 群聊/联系人/聊天记录/公众号 标题）
- 或直接传任意标题文字：`scope="Results"`、`scope="歌曲"`、`scope="群聊"`
- 多分类 app（如英文 Results/Suggestions）务必成对传：`scope="Results", scope_end="Suggestions"`，
  否则匹配会越界到后续分类。模型应先 `ui_ocr` 看清有哪些标题，再据此传 scope。

```
ui_find_text(query="三jian客", window="微信", scope="group")           # 只对「群聊」区块匹配
ui_find_text(query="Report", scope="Results", scope_end="Suggestions") # 通用英文 app
ui_find_text(query="保存", window="记事本", threshold=0.6, return_all=True)
```

### 8. `ui_click_text` — OCR 找字并点击（盲窗核心）

OCR 找文本并直接点击其物理中心。可选 `verify_title` 校验点击后标题栏是否正确，杜绝"发错群"。
`scope` / `scope_end` 同 `ui_find_text`。

```
ui_click_text(query="三jian客", window="微信", scope="group")          # 只进群聊，绝不点成联系人
ui_click_text(query="三jian客", verify_title="三jian客")                # 进入并校验标题
```

## 四级降级链

```
L1 UIA Pattern 直调 (Invoke/SetValue/Toggle) —— 零偏差，不用鼠标
  ↓ 该控件不支持 pattern
L2 UIA 精确坐标点击 (BoundingRectangle 中心) —— 不受 DPI 影响
  ↓ 拿不到控件树（游戏/Canvas/Electron）
L3 SoM 编号标注截图 (模型选编号) —— 只需识别不需定位
  ↓ 连视觉都看不清
L4 归一化坐标 (0~1000) —— 与分辨率解耦的最后手段
  ↓ 控件树/视觉全失效（如微信 Qt 盲窗）
L5 OCR 文本识别 (Windows 内置引擎) —— 读字+定位，盲窗也能精准点击
```

> **截图太密怎么办**：优先用 `ui_screenshot(region="list", min_width=720)` 只截关键区并放大，
> 或改用 `ui_ocr` / `ui_find_text` 直接拿文字和坐标，绕开"看不清"问题。

## 典型工作流

```
1. ui_inspect()              → 看到当前界面有哪些按钮/输入框
2. ui_screenshot(annotate=True) → 看到 SoM 标注的截图
3. ui_act(ref="#12", action="set_text", text="搜索内容")
4. ui_screenshot()            → 验证文字是否已写入
5. ui_act(ref="#8", action="invoke")  → 点搜索按钮
6. ui_screenshot()            → 验证搜索结果
```

## 关键改进（vs v1）

| | v1 (旧) | v2 (新) |
|---|---|---|
| 架构 | 内嵌 VLM agent 黑盒循环 | 原子工具集，主模型直接驱动 |
| 定位 | 视觉模型猜像素坐标 | UIA 控件树给出真值坐标 |
| 4K 支持 | 无 DPI 感知，误差放大 3.6x | Per-Monitor-V2 DPI 感知 |
| 验证 | 外层看不到截图 | 每步操作后自动回传截图 |
| 视觉依赖 | 必须有 VLM | UIA 路径不需要 |
