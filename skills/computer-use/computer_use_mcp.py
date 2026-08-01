"""
Computer Use MCP Server v2 — 原子能力工具集（UIA 优先）

v1 → v2 变更：
  - 删除内嵌 VLM agent 循环，改为原子能力工具集
  - 新增 UIA 控件树枚举 + Pattern 直调 / 精确坐标点击
  - 新增 SoM 编号标注截图（Set-of-Mark）
  - 新增归一化坐标（0~1000）解耦分辨率
  - 截图统一缩放至 1280px 宽，消除 4K 外推误差
  - 工具返回值附带截图，主模型自动获得视觉反馈
  - 进程启动即设 Per-Monitor-V2 DPI 感知

四级降级链：
  L1: UIA Pattern 直调 (Invoke/SetValue/Toggle) —— 零偏差，不用鼠标
  L2: UIA 精确坐标点击 (系统 BoundingRectangle) —— 不受 DPI 影响
  L3: SoM 编号标注截图 (模型选编号) —— 只需识别不需定位
  L4: 归一化坐标兜底 (0~1000) —— 与屏幕分辨率解耦
  L5: OCR 文本识别兜底 (Windows 内置 OcrEngine) —— 盲窗(微信 Qt)也能读字+定位

依赖：pywinauto, comtypes, mss, Pillow, pyautogui, winrt-Windows.Media.Ocr（均已安装）
"""

import json
import sys
import base64
import io
import os
import time
import ctypes
from datetime import datetime
from pathlib import Path

# ── 导入核心层（含 DPI 初始化）──
sys.path.insert(0, str(Path(__file__).parent))
import uia_core as U


# ══════════════════════════════════════════════════════════════
# 安全拦截
# ══════════════════════════════════════════════════════════════

FORBIDDEN = [
    "format", "del /s", "rmdir /s", "rd /s",
    "shutdown", "restart",
    "regedit", "reg",
    "taskkill /f /im explorer",
    "taskkill /f /im dwm",
    "taskkill /f /im csrss",
    "taskkill /f /im lsass",
]

DANGEROUS = ["format", "格式化", "shutdown", "restart", "关机", "重启",
             "regedit", "注册表"]


def _check_dangerous(text):
    for kw in DANGEROUS:
        if kw in text.lower():
            return kw
    return None


def _check_forbidden(cmd):
    cl = cmd.lower()
    for f in FORBIDDEN:
        if f in cl:
            return f
    return None


def _confirm(task):
    """Windows MessageBox 二次确认。"""
    MB_YESNO = 0x4; MB_ICONWARNING = 0x30
    MB_DEFBUTTON2 = 0x100; MB_SETFOREGROUND = 0x10000
    msg = (
        f"Tiffa Computer Use 即将控制您的桌面\n\n"
        f"任务：{task}\n\n按 ESC 随时中断\n此操作将控制鼠标和键盘"
    )
    r = ctypes.windll.user32.MessageBoxW(
        0, msg, "电脑控制 确认",
        MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2 | MB_SETFOREGROUND)
    return r == 6  # IDYES


# ══════════════════════════════════════════════════════════════
# 日志
# ══════════════════════════════════════════════════════════════

LOG = Path(__file__).parent / "computer-use.log"


def log(cat, *args):
    ts = datetime.now().isoformat(timespec="seconds")
    text = " | ".join(str(a) for a in args)
    try:
        LOG.write_text(f"[{ts}] [{cat}] {text}\n", encoding="utf-8")
        # append mode
        existing = LOG.read_text(encoding="utf-8") if LOG.exists() else ""
        LOG.write_text(existing + f"[{ts}] [{cat}] {text}\n", encoding="utf-8")
    except Exception:
        pass


# ══════════════════════════════════════════════════════════════
# 辅助：构造 MCP 返回内容
# ══════════════════════════════════════════════════════════════

def _text(text):
    return {"type": "text", "text": text}


def _image(img):
    """PIL Image -> MCP image content block."""
    if img is None:
        return None
    b64 = U.img_to_b64(img, fmt="JPEG")  # JPEG 更省 token
    mime = "image/jpeg" if b64 else "image/png"
    return {"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}}


def _format_items(items, meta=None):
    """把元素列表格式化为模型友好的文本表格。"""
    if not items:
        return "(无元素)"
    lines = [f'窗口: {meta.get("window","?")} | 共 {len(items)} 个可交互元素']
    lines.append(f'{"#":>4}  {"类型":<10}  {"名称":<28}  {"中心坐标":<12}  {"可用操作"}')
    lines.append("-" * 72)
    for it in items[:80]:
        acts = ",".join(it["actions"]) or "-"
        nm = it["name"][:26].replace("\n", " ")
        cx, cy = it["center"]
        lines.append(f'#{it["id"]:>3d}  {it["type"]:<10s}  "{nm}"  ({cx:>4},{cy:>4})  {acts}')
    if len(items) > 80:
        lines.append(f"... 还有 {len(items)-80} 个元素未显示")
    return "\n".join(lines)


def _resolve_region_arg(args):
    """从 MCP 参数提取 region：region_rect(array/字符串) 优先于 region(预设名)。"""
    rr = args.get("region_rect")
    if rr is not None:
        if isinstance(rr, str):
            return rr  # 形如 "x1,y1,x2,y2"
        return rr      # list[4]
    return args.get("region")  # 预设名字符串或 None


# ══════════════════════════════════════════════════════════════
# 工具定义
# ══════════════════════════════════════════════════════════════

TOOLS = {
    "tools": [
        {
            "name": "ui_inspect",
            "description": (
                "枚举当前窗口或指定窗口内的所有可交互控件（按钮、文本框、列表项等）。"
                "返回编号列表，每个元素有精确的物理像素坐标和系统给出的名称。"
                "使用 ui_act 按编号或名称执行操作。"
                "这是桌面自动化的第一步——先 inspect 看有哪些元素，再 act 操作它们。"
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "window": {
                        "type": "string",
                        "description": (
                            "窗口标题片段（模糊匹配）。"
                            '不填=前台窗口；填 "desktop"=列出所有顶层窗口'
                        )
                    },
                    "name_filter": {
                        "type": "string",
                        "description": "只显示名称包含该文字的元素"
                    },
                    "max_items": {
                        "type": "integer",
                        "description": "最大返回数量（默认 60，防止超大列表刷屏）",
                        "default": 60
                    },
                },
            }
        },
        {
            "name": "ui_act",
            "description": (
                "对 ui_inspect 返回的元素执行操作。支持编号引用（如 '#5' 或 '5'）或名称引用。"
                "优先使用 UIA 原生模式（Invoke/SetValue/Toggle），不移动鼠标；"
                "不支持 pattern 时自动降级为精确坐标点击。"
                "操作后界面会变化，建议紧接着调用 ui_screenshot 验证结果。"
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "ref": {
                        "type": "string",
                        "description": "元素引用：编号（'#12' 或 '12'）或名称片段（'确定'）。必须先调用 ui_inspect 获取缓存"
                    },
                    "action": {
                        "type": "string",
                        "enum": [
                            "invoke", "click", "double_click", "right_click",
                            "set_text", "toggle", "select", "focus",
                            "expand", "collapse", "scroll_into_view"
                        ],
                        "default": "invoke",
                        "description": "要执行的操作"
                    },
                    "text": {
                        "type": "string",
                        "description": "set_text 时要写入的文字内容"
                    },
                    "button": {
                        "type": "string",
                        "enum": ["left", "right", "middle"],
                        "default": "left",
                        "description": "鼠标按键（click/double_click/right_click 时有效）"
                    },
                },
                "required": ["ref"]
            }
        },
        {
            "name": "ui_screenshot",
            "description": (
                "截取当前屏幕或指定窗口的截图。"
                "可选 Set-of-Mark 标注（在可交互元素上画彩色编号框），"
                "模型只需回答编号即可定位，无需估算像素坐标。"
                "截图会自动缩放到合理尺寸（4K 屏幕不会喂原图），"
                "返回图片让主模型直接看到当前界面状态。"
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "window": {
                        "type": "string",
                        "description": "窗口标题片段；不填=全屏截图"
                    },
                    "annotate": {
                        "type": "boolean",
                        "default": False,
                        "description": "是否在截图上标注可交互元素的编号框（SoM 模式）"
                    },
                    "max_items": {
                        "type": "integer",
                        "default": 40,
                        "description": "annotate=True 时最多标注多少个元素"
                    },
                    "region": {
                        "type": "string",
                        "description": (
                            "只截此**预设区域**，显著降低截图密度(模型看不清的首选解法)。"
                            "可选: list/content/sidebar/input/titlebar/top/bottom/"
                            "left/right/center/top-left/full。"
                            "也可填比例四元组写法由 region_rect 表达"
                        )
                    },
                    "region_rect": {
                        "oneOf": [
                            {"type": "array", "items": {"type": "number"}, "minItems": 4, "maxItems": 4},
                            {"type": "string", "description": "x1,y1,x2,y2 或 比例(均<=1.0)"}
                        ],
                        "description": "绝对/比例坐标 [x1,y1,x2,y2]。优先级高于 region"
                    },
                    "min_width": {
                        "type": "integer",
                        "default": 0,
                        "description": "把裁下的小区域(搜索结果行、标题)放大到此宽度，提升识别率(0=不放大)"
                    },
                },
            }
        },
        {
            "name": "ui_ocr",
            "description": (
                "对窗口/区域做 OCR 文字识别(Windows 内置引擎，支持中文)，"
                "返回每一行文本及其在屏幕上的**物理像素包围盒坐标**。"
                "不依赖控件树，对微信(Qt, UIA 全盲)等盲窗同样有效。"
                "当 ui_screenshot 截到的图太密、模型读不清文字时，改用本工具拿到结构化文本+坐标，"
                "再由 ui_find_text / ui_click_text 精确点击目标。"
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "window": {
                        "type": "string",
                        "description": "窗口标题片段；不填=全屏"
                    },
                    "region": {
                        "type": "string",
                        "description": "预设区域名(list/content/sidebar/input/titlebar 等)，只识别该区域"
                    },
                    "region_rect": {
                        "oneOf": [
                            {"type": "array", "items": {"type": "number"}, "minItems": 4, "maxItems": 4},
                            {"type": "string", "description": "x1,y1,x2,y2 或 比例(均<=1.0)"}
                        ],
                        "description": "绝对/比例坐标 [x1,y1,x2,y2]，优先级高于 region"
                    },
                    "min_width": {
                        "type": "integer",
                        "default": 720,
                        "description": "把裁下的小区域放大到此宽度，提升识别率"
                    },
                },
            }
        },
        {
            "name": "ui_find_text",
            "description": (
                "OCR + 模糊匹配：在窗口/区域内找到与目标文本最接近的一行，"
                "返回其文本、相似度分数和物理中心坐标(cx,cy)。"
                "解决盲窗'点错群/点错项'：先 Ctrl+F 搜索，再 ui_find_text('三jian客', scope='group') 拿到群聊区块里的精确坐标。"
                "微信同名词很多(群聊/联系人/聊天记录/公众号)时务必带 scope='group'，只对「群聊」分类匹配，杜绝点错人。"
                "支持中英文混输、拼音、容忍 OCR 错别字/声调。"
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "要找的文本(如群名 '三jian客')"
                    },
                    "window": {"type": "string", "description": "窗口标题片段"},
                    "region": {"type": "string", "description": "预设区域名"},
                    "region_rect": {
                        "oneOf": [
                            {"type": "array", "items": {"type": "number"}, "minItems": 4, "maxItems": 4},
                            {"type": "string"}
                        ],
                        "description": "绝对/比例坐标 [x1,y1,x2,y2]"
                    },
                    "scope": {
                        "type": "string",
                        "default": "any",
                        "description": ("限定分类区块(通用)：'any'=整区；预设 'group'/'contact'/"
                                       "'chat_history'/'official'(微信等)；也可直接传任意标题文字"
                                       "(如 'Results'/'歌曲'/'群聊')，只在该标题下方的区块内匹配。"
                                       "同名词多、要排除干扰项时必填")
                    },
                    "scope_end": {
                        "type": "string",
                        "description": ("结束标题(可选)。多分类 app(如英文 Results/Suggestions)务必与 "
                                       "scope 成对传，否则匹配会越界到后续分类")
                    },
                    "min_width": {"type": "integer", "default": 720, "description": "小区域上采样宽度"},
                    "threshold": {
                        "type": "number",
                        "default": 0.5,
                        "description": "相似度下限，低于则视为未命中"
                    },
                    "return_all": {
                        "type": "boolean",
                        "default": False,
                        "description": "True=返回所有>=阈值的命中(降序)，否则只返回最佳"
                    },
                },
                "required": ["query"]
            }
        },
        {
            "name": "ui_click_text",
            "description": (
                "OCR 找文本并直接点击其物理中心，盲窗自动化的核心一步。"
                "流程示例：Ctrl+F 搜索'三jian客' -> ui_click_text('三jian客', scope='group') 精确进入该群。"
                "可选 verify_title：点击后截图 OCR 校验标题栏，未命中会返回告警便于重试，杜绝'发错群'。"
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "要找并点击的文本"},
                    "window": {"type": "string", "description": "窗口标题片段"},
                    "region": {"type": "string", "description": "预设区域名"},
                    "region_rect": {
                        "oneOf": [
                            {"type": "array", "items": {"type": "number"}, "minItems": 4, "maxItems": 4},
                            {"type": "string"}
                        ],
                        "description": "绝对/比例坐标 [x1,y1,x2,y2]"
                    },
                    "scope": {
                        "type": "string",
                        "default": "any",
                        "description": ("限定分类区块(通用)：'any'=整区；预设 'group'/'contact'/"
                                       "'chat_history'/'official'；也可传任意标题文字(如 'Results'/"
                                       "'歌曲'/'群聊')，只在该标题下方区块内匹配")
                    },
                    "scope_end": {
                        "type": "string",
                        "description": ("结束标题(可选)。多分类 app 与 scope 成对传，避免越界")
                    },
                    "min_width": {"type": "integer", "default": 720},
                    "threshold": {"type": "number", "default": 0.5},
                    "button": {"type": "string", "enum": ["left", "right", "middle"], "default": "left"},
                    "double": {"type": "boolean", "default": False, "description": "是否双击"},
                    "verify_title": {
                        "type": "string",
                        "description": "点击后校验的标题文字(如群名)，未命中返回告警"
                    },
                },
                "required": ["query"]
            }
        },
        {
            "name": "desktop_input",
            "description": (
                "原始桌面输入能力（归一化坐标版）。"
                "当 UIA 无法覆盖目标（游戏、Canvas、Electron 应用等）时的兜底方案。"
                "坐标使用 0~1000 归一化值，与屏幕分辨率完全解耦。"
                "也可用于键盘输入、滚动、等待和启动程序。"
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["click", "double_click", "right_click", "type",
                                 "key", "scroll", "move", "launch", "wait"],
                        "description": "操作类型"
                    },
                    "nx": {
                        "type": "number",
                        "description": "X 归一化坐标 (0~1000)，左上角=0 右下角=1000"
                    },
                    "ny": {
                        "type": "number",
                        "description": "Y 归一化坐标 (0~1000)"
                    },
                    "button": {
                        "type": "string",
                        "enum": ["left", "right", "middle"],
                        "default": "left"
                    },
                    "text": {
                        "type": "string",
                        "description": "要输入的文字（type 动作）"
                    },
                    "keys": {
                        "oneOf": [{"type": "string"}, {"type": "array", "items": {"type": "string"}}],
                        "description": "按键名或组合键（key 动作）"
                    },
                    "dy": {
                        "type": "integer",
                        "description": "滚动量（正数向下）"
                    },
                    "command": {
                        "type": "string",
                        "description": "要启动的程序/文件/URL（launch 动作）"
                    },
                    "ms": {
                        "type": "integer",
                        "default": 1000,
                        "description": "等待毫秒数（wait 动作）"
                    },
                },
                "required": ["action"]
            }
        },
        {
            "name": "computer_use",
            "description": (
                "[便利入口] 执行完整桌面自动化任务。"
                "内部组合调用 ui_inspect + ui_act + ui_screenshot 等原子工具。"
                "适合简单任务（打开记事本、搜索天气等）。复杂多步任务建议主模型逐步调用原子工具。"
                "执行前弹确认框，ESC 可中断。"
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "task": {
                        "type": "string",
                        "description": "任务描述"
                    },
                    "max_steps": {
                        "type": "integer",
                        "default": 20,
                        "description": "最大步骤数"
                    },
                    "timeout": {
                        "type": "integer",
                        "default": 300,
                        "description": "超时秒数"
                    },
                },
                "required": ["task"]
            }
        },
    ]
}


# ══════════════════════════════════════════════════════════════
# 工具处理器
# ══════════════════════════════════════════════════════════════

def handle_ui_inspect(args):
    t0 = time.time()
    window = args.get("window")
    nf = args.get("name_filter")
    mx = int(args.get("max_items", 60))

    items, meta, err = U.inspect(window=window, name_filter=nf,
                                  max_items=mx, probe_actions=True)
    elapsed = time.time() - t0

    if err:
        log("inspect.error", window or "前台", err)
        return [_text(f"枚举失败: {err}")], True

    table = _format_items(items, meta)

    # 附带一张无标注的缩略截图，让主模型看到当前界面状态
    img, smeta, serr = U.screenshot(window=window, annotate=False, max_width=800)
    contents = [_text(table)]
    img_block = _image(img)
    if img_block:
        contents.append(img_block)

    log("inspect", window or "前台", f"{len(items)} 元素", f"{elapsed:.2f}s")
    return contents, False


def handle_ui_act(args):
    ref = args.get("ref", "")
    action = args.get("action", "invoke")
    text = args.get("text")
    button = args.get("button", "left")

    result, err = U.act(ref, action=action, text=text, button=button)

    if err:
        log("act.error", ref, action, err)
        return [_text(f"操作失败: {err}")], True

    # 操作后自动截一张小图回传，主模型立刻能看到效果
    img, _, _ = U.screenshot(max_width=800)
    contents = [_text(result)]
    img_block = _image(img)
    if img_block:
        contents.append(img_block)

    log("act", ref, action, result[:80])
    return contents, False


def handle_ui_screenshot(args):
    t0 = time.time()
    window = args.get("window")
    annotate = bool(args.get("annotate", False))
    mx = int(args.get("max_items", 40))
    region = _resolve_region_arg(args)
    mw = int(args.get("min_width", 0))

    img, meta, err = U.screenshot(window=window, annotate=annotate,
                                  max_width=1280, max_items=mx,
                                  region=region, min_width=mw or None)
    elapsed = time.time() - t0

    if err:
        log("screenshot.error", err)
        return [_text(f"截图失败: {err}")], True

    info = (
        f"截图完成 | 窗口: {meta['window']} | "
        f"原始: {meta['physical_size']} | 当前: {meta['image_size']} | "
        f"缩放比: {meta['scale']}"
    )
    if region:
        info += f" | 区域: {meta.get('region')}"
    if annotate:
        info += f" | 已标注 {meta['marked_count']} 个元素"

    contents = [_text(info)]
    img_block = _image(img)
    if img_block:
        contents.append(img_block)

    log("screenshot", window or "全屏", f"annotate={annotate} region={region}", f"{elapsed:.2f}s")
    return contents, False


def handle_ui_ocr(args):
    t0 = time.time()
    window = args.get("window")
    region = _resolve_region_arg(args)
    mw = int(args.get("min_width", 720))

    lines, meta, err = U.ocr_region(window=window, region=region, min_width=mw)
    elapsed = time.time() - t0

    if err:
        log("ocr.error", window or "全屏", region, err)
        return [_text(f"OCR 失败: {err}")], True

    # 文本表格：模型只读文字即可定位，不再依赖看截图猜
    out = [f"OCR 完成 | 窗口: {meta.get('window')} | 共 {len(lines)} 行文本 | 区域: {meta.get('region')}"]
    out.append(f'{"cy":>5}  {"cx":>5}  {"文本":<40}  包围盒')
    out.append("-" * 70)
    for L in lines:
        out.append(f'{L["cy"]:>5.0f}  {L["cx"]:>5.0f}  {L["text"][:36]:<36}  '
                   f'({L["x1"]:.0f},{L["y1"]:.0f})-({L["x2"]:.0f},{L["y2"]:.0f})')
    log("ocr", window or "全屏", region, f"{len(lines)} 行", f"{elapsed:.2f}s")
    return [_text("\n".join(out))], False


def handle_ui_find_text(args):
    query = args.get("query", "")
    window = args.get("window")
    region = _resolve_region_arg(args)
    mw = int(args.get("min_width", 720))
    thr = float(args.get("threshold", 0.5))
    allres = bool(args.get("return_all", False))
    scope = args.get("scope", "any")
    scope_end = args.get("scope_end")

    hits, meta, err = U.find_text(query, window=window, region=region,
                                  min_width=mw, threshold=thr, return_all=allres,
                                  scope=scope, scope_end=scope_end)
    if err:
        log("find_text.error", query, err)
        return [_text(f"查找失败: {err}")], True

    if not hits:
        return [_text(f'未在窗口找到与 "{query}" 足够相似的文本(阈值 {thr})。'
                      f'可先 ui_ocr 看实际识别出的文字再调整 query。'), False]

    if allres:
        lines = [f'匹配 "{query}" 的全部命中({len(hits)}):']
        for h in hits:
            lines.append(f'  分数 {h["score"]} 中心({h["cx"]:.0f},{h["cy"]:.0f}) {h["text"]!r}')
        return [_text("\n".join(lines))], False

    h = hits
    return [_text(f'最佳命中: 文本={h["text"]!r} 分数={h["score"]} '
                  f'中心=({h["cx"]:.0f},{h["cy"]:.0f}) '
                  f'包围盒=({h["x1"]:.0f},{h["y1"]:.0f})-({h["x2"]:.0f},{h["y2"]:.0f})'), False]


def handle_ui_click_text(args):
    query = args.get("query", "")
    window = args.get("window")
    region = _resolve_region_arg(args)
    mw = int(args.get("min_width", 720))
    thr = float(args.get("threshold", 0.5))
    button = args.get("button", "left")
    double = bool(args.get("double", False))
    verify = args.get("verify_title")
    scope = args.get("scope", "any")
    scope_end = args.get("scope_end")

    desc, warn = U.click_text(query, window=window, region=region,
                              min_width=mw, threshold=thr, button=button,
                              double=double, verify_title=verify, scope=scope,
                              scope_end=scope_end)
    if desc is None:
        log("click_text.error", query, warn)
        return [_text(f"点击失败: {warn}"), False]
    log("click_text", query, desc[:60])
    # 点击后附一张小截图，主模型可立刻看到结果
    img, _, _ = U.screenshot(max_width=800)
    contents = [_text(desc + (f"\n⚠️ {warn}" if warn else ""))]
    ib = _image(img)
    if ib:
        contents.append(ib)
    return contents, bool(warn)


def handle_desktop_input(args):
    import pyautogui
    atype = args.get("action", "")
    try:
        if atype == "click":
            nx, ny = float(args.get("nx", 500)), float(args.get("ny", 500))
            px, py = U.norm_to_physical(nx, ny)
            btn = args.get("button", "left")
            pyautogui.click(px, y=py, button=btn)
            return [_text(f"已点击 归一化({nx:.1f},{ny:.1f}) -> 物理像素({px},{py}) [{btn}]")], False

        elif atype == "double_click":
            nx, ny = float(args.get("nx", 500)), float(args.get("ny", 500))
            px, py = U.norm_to_physical(nx, ny)
            pyautogui.doubleClick(px, py)
            return [_text(f"已双击 ({px},{py})")], False

        elif atype == "right_click":
            nx, ny = float(args.get("nx", 500)), float(args.get("ny", 500))
            px, py = U.norm_to_physical(nx, ny)
            pyautogui.rightClick(px, py)
            return [_text(f"已右击 ({px},{py})")], False

        elif atype == "type":
            txt = str(args.get("text", ""))
            pyautogui.typewrite(txt, interval=0.02)
            return [_text(f"已输入: {txt[:50]}")], False

        elif atype == "key":
            keys = args.get("keys", "")
            if isinstance(keys, str):
                if keys.startswith("["):
                    keys = json.loads(keys)
                if isinstance(keys, str):
                    keys = [k.strip() for k in keys.split("+")] if "+" in keys else [keys]
            if isinstance(keys, list) and len(keys) > 1:
                pyautogui.hotkey(*keys)
                return [_text(f"组合键: {'+'.join(str(k) for k in keys)}")], False
            elif isinstance(keys, list) and len(keys) == 1:
                pyautogui.press(keys[0])
                return [_text(f"按键: {keys[0]}")], False
            return [_text("key: 空按键列表")], False

        elif atype == "scroll":
            dy = int(args.get("dy", 0))
            if dy != 0:
                pyautogui.scroll(dy)
            return [_text(f"滚动 dy={dy}")], False

        elif atype == "move":
            nx, ny = float(args.get("nx", 500)), float(args.get("ny", 500))
            px, py = U.norm_to_physical(nx, ny)
            pyautogui.moveTo(px, py)
            return [_text(f"鼠标移到 ({px},{py})")], False

        elif atype == "launch":
            cmd = str(args.get("command", ""))
            fb = _check_forbidden(cmd)
            if fb:
                return [_text(f"命令被拦截: '{cmd}' 包含禁止操作 '{fb}'")], True
            os.startfile(cmd)
            time.sleep(2)
            return [_text(f"已启动: {cmd}")], False

        elif atype == "wait":
            ms = int(args.get("ms", 1000))
            time.sleep(ms / 1000)
            return [_text(f"等待 {ms}ms")], False

        else:
            return [_text(f"未知动作: {atype}")], True

    except Exception as e:
        return [_text(f"执行失败: {e}")], True


def handle_computer_use(args):
    task = args.get("task", "")

    # 危险检查
    dk = _check_dangerous(task)
    if dk:
        return [_text(f"任务包含禁止操作: {dk}")], True

    # 确认
    if not _confirm(task):
        return [_text("用户取消操作")], False

    log("computer_use.start", task)

    # 简单策略：先 inspect，再逐步用 act + screenshot 验证
    steps = int(args.get("max_steps", 20))
    timeout = int(args.get("timeout", 300))
    start = time.time()

    results = []
    prev_img = None

    for step in range(1, steps + 1):
        if time.time() - start > timeout:
            break

        # 1. 截图看当前状态
        img, meta, _ = U.screenshot(max_width=1024)
        diff = U.diff_ratio(prev_img, img) if prev_img else 1.0
        prev_img = img

        # 2. 枚举元素
        items, imeta, ierr = U.inspect(max_items=30, probe_actions=False)

        # 3. 把当前状态打包给主模型（让它决策下一步）
        state = (
            f"\n--- 步骤 {step}/{steps} ---\n"
            f"界面: {meta.get('window','?')} | 缩放: {meta.get('scale',1):.2f}\n"
            f"界面变化度: {diff*100:.0f}%\n"
            f"可交互元素:\n{_format_items(items, imeta)}"
        )

        results.append(state)
        img_b = _image(img)
        if img_b:
            results.append(img_b)

        # 这里我们无法自己决定下一步——返回给主模型
        # computer_use 作为便利入口，只做一轮 inspect+screenshot
        # 复杂任务由主模型逐步调用原子工具
        break

    summary = (
        f"当前界面状态已返回。\n"
        f"请根据截图和元素列表，逐步调用 ui_act/ui_screenshot/desktop_input 来完成任务。\n"
        f"每步操作后请调用 ui_screenshot 验证结果。"
    )
    return [_text(summary)] + results, False


# ══════════════════════════════════════════════════════════════
# MCP Server 主循环
# ══════════════════════════════════════════════════════════════

HANDLERS = {
    "ui_inspect": handle_ui_inspect,
    "ui_act": handle_ui_act,
    "ui_screenshot": handle_ui_screenshot,
    "ui_ocr": handle_ui_ocr,
    "ui_find_text": handle_ui_find_text,
    "ui_click_text": handle_ui_click_text,
    "desktop_input": handle_desktop_input,
    "computer_use": handle_computer_use,
}


def send(msg):
    data = json.dumps(msg, ensure_ascii=False)
    sys.stdout.write(data + "\n")
    sys.stdout.flush()


def log_err(msg):
    sys.stderr.write(f"[computer-use-mcp] {msg}\n")
    sys.stderr.flush()


def main():
    log_err("Computer Use MCP Server v2 启动 (UIA 优先 + 四级降级)")
    log_err(f"DPI aware: {U._DPI_READY}")
    log_err(f"屏幕: {U.screen_size()}")

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue

        method = msg.get("method", "")
        mid = msg.get("id")
        params = msg.get("params", {})

        if method == "initialize":
            send({
                "jsonrpc": "2.0", "id": mid,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "computer-use-v2", "version": "2.0.0"}
                }
            })
        elif method == "notifications/initialized":
            pass
        elif method == "tools/list":
            send({"jsonrpc": "2.0", "id": mid, "result": TOOLS})
        elif method == "tools/call":
            name = params.get("name", "")
            arguments = params.get("arguments", {})
            handler = HANDLERS.get(name)
            if not handler:
                send({"jsonrpc": "2.0", "id": mid,
                      "error": {"code": -32601, "message": f"未知工具: {name}"}})
                continue
            try:
                contents, is_error = handler(arguments)
                send({"jsonrpc": "2.0", "id": mid,
                      "result": {"content": contents, "isError": is_error}})
            except Exception as e:
                log_err(f"工具异常 {name}: {e}")
                send({"jsonrpc": "2.0", "id": mid,
                      "result": {"content": [_text(f"工具异常: {e}")],
                                "isError": True}})
        elif method == "shutdown":
            send({"jsonrpc": "2.0", "id": mid, "result": None})
            break
        else:
            if mid is not None:
                send({"jsonrpc": "2.0", "id": mid,
                      "error": {"code": -32601, "message": f"Method not found: {method}"}})


if __name__ == "__main__":
    main()
