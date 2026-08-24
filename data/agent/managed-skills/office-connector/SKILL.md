---
name: office-connector
description: "Edit existing Office files (.pptx/.docx/.xlsx) through WPS/MS Office COM (preferred, stable) with LibreOffice UNO as fallback engine. Use when the user wants to modify a real office file: fine-tuning PPT elements (move, align, resize, font size, text), formatting documents, merging table headers — operations that are hard to do by regenerating OOXML from scratch."
name_cn: "Office文档连接器"
description_cn: "直接编辑已有 Office 文档（pptx/docx/xlsx）。双引擎：优先 WPS/MS Office COM（原生稳定、无窗口、秒级），LibreOffice UNO 兜底。适用于微调 PPT 元素、合并表头、美化表格、公文格式等难以代码重写的操作。"
license: Proprietary
---

# Office Connector（双引擎：COM 主攻 + UNO 兜底）

## 定位与引擎选择

编辑**已有** Office 文件时使用本技能。与生成管线分工：

- **新建文档** → OOXML 生成（docx / ppt / xlsx 技能）
- **编辑现有文档** → 本技能（改文字/位置/字号/对齐/样式）
- **批量同规则修改** → OOXML 直改；单文件精细微调 → 本技能

**引擎自动选择**：

| 引擎 | 触发条件 | 特点 |
|---|---|---|
| **WPS COM** (`KWPP/KWPS/KET.Application`) | 本机装有 WPS（医院环境首选） | 实测稳定，1-2 秒/命令 |
| **MS Office COM** (`PowerPoint/Word/Excel.Application`) | 本机装有 MS Office | 同等稳定 |
| **LibreOffice UNO** (`uno_client.py`) | 以上都没有 | 编辑有概率挂起（内置重试），预览走命令行转换完全稳定 |

检测顺序：WPS COM → MS Office COM → LibreOffice UNO。

## 工作流（版式/视觉类任务：四步断点，不可跳步）

> **核心认知**：版式/视觉类任务中，“改”只是执行，“看得准”才决定是否返工。
> 没有视觉验证通道时，模型会“数字合格即宣布成功”——必须把**看图**固化为流程断点，而非可选建议。
> **症状≠病因**：用户描述的是症状（“看着不对齐”），动手前必须先量现状，别凭症状猜病因。

**四步断点流程（每步未验证不得进入下一步）：**

1. **量（审计）**：`list-elements` 全页形状树 + 关键页 `export-preview` 导出 PNG。拿到每页形状名/类型/坐标/尺寸/字号/文本。
2. **看（视觉确认现状）**：用多模态模型**实际读 PNG**（不是读坐标数字），确认现状与目标的差异。此步是断点——**没看图不许改**。
3. **定点治理**：只改第 2 步确认过的真问题，最小手术。改完立即 `export-preview` 重导 PNG。
4. **终检（视觉回看）**：多模态读改动后 PNG，**数字（坐标/字号）+ 观感双重验证**。观感存疑则回第 3 步。

**批量治理拆小步**：多文件/多页批量治理时，宁可多跑几轮小脚本（每轮改完导 PNG 核对），也别写一个巨型脚本一把梭——巨型脚本连环出错难回退。

## 版式治理专项（PPT 版式对齐/装饰条/字体统一）

本技能处理“版式没对齐、装饰条不统一、字体混乱”类需求时的已知陷阱：

| 陷阱 | 真相 | 正确做法 |
|---|---|---|
| “缺装饰条，往每页贴形状” | 装饰条可能是**母版层**自带（页面形状树里查不到，但渲染出来有） | 先 `list-elements` 确认是否母版继承；**别盲目贴形状**，否则可能与母版重叠出现双层 |
| 跨文件 Copy-Paste 形状“复刻样式” | Copy 只搬**文本框壳**，不搬渲染细节（箭头装饰/字体/颜色） | Paste 后**手动逐项设置** font/size/color，或复用源页版式；别指望 Paste 自动继承一切 |
| 标题框“数字对了就合格” | 文字长会显得占位宽，18pt 下长标题观感偏大但字号/位置/尺寸都对 | 数字审计 + **视觉终检**双重验证，别只信数字 |
| 章节页/封面被“形状数少=封面”误判 | 我构造的内容页恰好 3 个形状，被“shapes≤3”规则误杀 | 判定封面/章节页用**文字特征**（含“PART”“谢谢聆听”/大背景图），别用形状数量 |

**WPS COM 状态三件套**（COM 报错先怀疑环境状态，别死磕代码）：
1. **清残留进程**：`Get-Process | ? {$_.Name -match 'wps|wpp|kwps'} | Stop-Process`，避免僵尸实例拿到坏 COM 对象
2. **早期绑定 + 忙碌重试**：用 `gencache.EnsureDispatch`（非动态派发），WPS 启动期返回 RPC“应用程序忙”时轮询等待
3. **用真实来源文件测试**：手工构造的最小 OOXML 可能让 WPS 解析挂起，测试用真实结构的 .pptx

## 前置依赖

- **COM 引擎**：本机装有 WPS 或 MS Office + pywin32（`pip install pywin32`）
- **本机没有 WPS/Office？** 运行 `python deploy/deploy_wps.py` 自动通过 winget 安装 WPS（官方源静默安装）；授权提醒：个人版免费含推广，政企环境建议采购企业版
- **UNO 引擎（兜底）**：LibreOffice 便携版，未部署时运行：
  ```bash
  python deploy/deploy_libreoffice.py --dest E:/Tools/LibreOffice
  ```

## COM 引擎工具（com/com_client.py）

```bash
LO=com/com_client.py   # 路径占位

python $LO open <file>                          # 文档信息
python $LO list-elements <file> [--page N]      # 元素树（名称/类型/坐标/尺寸/文本）
python $LO set-text <file> <name> <text> [--page N]
python $LO set-pos <file> <name> <x> <y> [--page N]        # 单位 pt（磅）
python $LO set-size <file> <name> <w> <h> [--page N]
python $LO set-font-size <file> <name> <size> [--page N]
python $LO set-font <file> <name> <font> [--page N]
python $LO align <file> <target> <anchor> <mode> [--page N]
    # mode: left|right|top|bottom|hcenter|vcenter（target 对齐到 anchor）
python $LO add-shape <file> rect|ellipse <name> <x> <y> <w> <h> [--text T] [--page N]
python $LO export-preview <file> <out.pdf>      # 版式任务建议直接导 PNG（sl.Export(f,'png',1600,900)）供多模态看图
python $LO save-as <file> <out>
```

坐标单位：**pt（磅）**，16:9 页面约 960x540pt。元素名称通过 `list-elements` 获取。**版式任务用 PNG 而非 PDF 供视觉模型读取**（多模态读 PNG 直接，PDF 需额外转图）。

## UNO 兜底引擎工具（uno/uno_client.py）

命令集与 COM 一致（另含 add-shape），但注意：
- 坐标单位 **1/100 mm**
- 服务管理：`python uno/start_server.py [stop]`
- **export-preview 已改为命令行转换**（不依赖服务，完全稳定）

## 铁律

- **永远在副本上操作**
- **版式/视觉任务：四步断点（量→看→改→终检），看图是断点不是建议**
- **每次修改后导出 PNG 视觉确认**，不盲交付
- **COM 引擎注意**：WPS/Office 另存可能微调复杂特性（动画/SmartArt），关键文件交付前用原软件复核
- **批量同规则修改走 XML 管线**，不要逐文件跑引擎
- 命令失败先重试一次（服务就绪是概率性的）；多次失败清残留进程再试
