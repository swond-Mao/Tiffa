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

# ── 延迟导入核心层（含 DPI 初始化 + pywinauto/comtypes/win32com 重依赖）──
# 进程启动只做轻量导入；uia_core 在首次工具调用时才加载，避免 MCP 进程
# 启动慢拖垮 Tiffa 开机。开关关掉时该进程根本不会被拉起，这里再兜底一层。
sys.path.insert(0, str(Path(__file__).parent))
U = None
def _ensure_uia():
    global U
    if U is None:
        import uia_core as U
    return U



# ══════════════════════════════════════════════════════════════
# Grounding 子模型配置（可选，不配则完全走原有 UIA/OCR 路径）
# ══════════════════════════════════════════════════════════════
# 环境变量：
#   GROUNDING_API_BASE  — OpenAI 兼容 API 地址（如 http://127.0.0.1:8080/v1 或 https://api.kimi.moonshot.cn/v1）
#   GROUNDING_MODEL     — 模型名（默认 xiaomi/mimo-v2-flash，便宜快）
#   GROUNDING_API_KEY   — API Key（本地 llama.cpp 可留空）
#   GROUNDING_ENABLED   — "1" 启用 / "0" 禁用（默认：有 API_BASE 就启用）

import urllib.request
import urllib.error

# ══ 模型配置联动：从 models.yml + config.yml 自动解析 ══

def _resolve_model_role(role: str) -> dict:
    """
    从 config.yml 的 modelRoles 和 models.yml 的 providers 解析出
    {"api_base": ..., "model": ..., "api_key": ...}。
    失败返回空 dict。
    """
    try:
        # 定位 data/agent/ 目录
        agent_dir = Path(os.environ.get("PI_CODING_AGENT_DIR", ""))
        if not agent_dir.exists():
            # 回退：从 skill 目录向上找
            agent_dir = Path(__file__).parent.parent.parent / "data" / "agent"
        if not agent_dir.exists():
            return {}

        # 1. 读 config.yml 获取 role 对应的 "provider/model"
        config_path = agent_dir / "config.yml"
        if not config_path.exists():
            return {}
        config_text = config_path.read_text(encoding="utf-8")

        # 简单解析 modelRoles 区块
        model_ref = ""  # e.g. "kimi/kimi-k3"
        in_roles = False
        for line in config_text.splitlines():
            stripped = line.strip()
            if stripped.startswith("modelRoles:"):
                in_roles = True
                continue
            if in_roles:
                if not line.startswith(" ") and not line.startswith("\t") and stripped and not stripped.startswith("#"):
                    break  # 离开 modelRoles 区块
                if stripped.startswith(f"{role}:"):
                    model_ref = stripped.split(":", 1)[1].strip().strip('"').strip("'")
                    break

        if not model_ref or "/" not in model_ref:
            return {}

        provider_name, model_id = model_ref.split("/", 1)

        # 2. 读 models.yml 获取 provider 的 baseUrl 和 apiKey
        models_path = agent_dir / "models.yml"
        if not models_path.exists():
            return {}
        models_text = models_path.read_text(encoding="utf-8")

        # 简单解析 providers 区块，找到目标 provider
        api_base = ""
        api_key = ""
        in_providers = False
        in_target_provider = False
        provider_indent = 0

        for line in models_text.splitlines():
            stripped = line.strip()
            indent = len(line) - len(line.lstrip())

            if stripped.startswith("providers:"):
                in_providers = True
                continue

            if not in_providers:
                continue

            # 检测是否进入目标 provider
            if stripped == f"{provider_name}:" or stripped.startswith(f"{provider_name}:"):
                if indent <= 4:  # provider 级别
                    in_target_provider = True
                    provider_indent = indent
                    continue

            # 在目标 provider 内
            if in_target_provider:
                # 检测是否离开了当前 provider（同级或更高级的新 key）
                if indent <= provider_indent and stripped and not stripped.startswith("#") and ":" in stripped:
                    if not stripped.startswith("-"):
                        in_target_provider = False
                        continue

                if stripped.startswith("baseUrl:"):
                    api_base = stripped.split(":", 1)[1].strip().strip('"').strip("'")
                elif stripped.startswith("apiKey:"):
                    api_key = stripped.split(":", 1)[1].strip().strip('"').strip("'")

        if not api_base:
            return {}

        return {
            "api_base": api_base,
            "model": model_id,
            "api_key": api_key if api_key != "none" else "",
        }

    except Exception as e:
        log("resolve_role.error", role, str(e)[:80])
        return {}


# ══ Grounding 配置加载（优先级：环境变量 > grounding.json > role 联动） ══

_GROUNDING_CFG_PATH = Path(__file__).parent / "grounding.json"
_gcfg = {}
if _GROUNDING_CFG_PATH.exists():
    try:
        _gcfg = json.loads(_GROUNDING_CFG_PATH.read_text(encoding="utf-8"))
    except Exception:
        pass

# 如果配置了 role，从 models.yml 自动解析
_role_cfg = {}
if _gcfg.get("role"):
    _role_cfg = _resolve_model_role(_gcfg["role"])

# 最终配置：环境变量 > grounding.json 直写值 > role 联动解析值
GROUNDING_API_BASE = (
    os.environ.get("GROUNDING_API_BASE")
    or _gcfg.get("api_base")
    or _role_cfg.get("api_base", "")
).rstrip("/")
GROUNDING_MODEL = (
    os.environ.get("GROUNDING_MODEL")
    or _gcfg.get("model")
    or _role_cfg.get("model", "xiaomi/mimo-v2-flash")
)
GROUNDING_API_KEY = (
    os.environ.get("GROUNDING_API_KEY")
    or _gcfg.get("api_key")
    or _role_cfg.get("api_key", "")
) or "sk-no-key"
GROUNDING_ENABLED = (
    os.environ.get("GROUNDING_ENABLED")
    or _gcfg.get("enabled", "1" if GROUNDING_API_BASE else "0")
) == "1"

# 盲窗判定阈值：UIA 返回有名称元素 < 此值时触发 grounding
BLIND_THRESHOLD = 5


def _grounding_analyze(img, window_hint: str = "", task_hint: str = "") -> list:
    U = _ensure_uia()
    """
    调用轻量 VLM 分析截图，返回结构化可交互元素列表。
    返回: [{"name": str, "type": str, "x": int, "y": int}, ...]
    失败时返回空列表（静默降级，不影响主流程）。
    """
    if not GROUNDING_ENABLED or not GROUNDING_API_BASE:
        return []

    try:
        b64 = U.img_to_b64(img, fmt="JPEG")
        if not b64:
            return []

        prompt = (
            "分析这个界面截图，列出所有可交互元素（按钮、输入框、链接、菜单项、列表项、图标按钮）。\n"
            "返回纯 JSON 数组，每项格式：{\"name\": \"元素显示文字\", \"type\": \"button|input|link|listitem|icon|menu\", \"x\": 中心x像素, \"y\": 中心y像素}\n"
            "只返回 JSON，不要其他文字。最多返回 30 个最重要的元素。"
        )
        if window_hint:
            prompt += f"\n当前窗口：{window_hint}"
        if task_hint:
            prompt += f"\n用户意图：{task_hint}"

        req_body = json.dumps({
            "model": GROUNDING_MODEL,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                    {"type": "text", "text": prompt}
                ]
            }],
            "max_tokens": 2000,
            "temperature": 0,
        }).encode()

        headers = {"Content-Type": "application/json"}
        if GROUNDING_API_KEY and GROUNDING_API_KEY != "sk-no-key":
            headers["Authorization"] = f"Bearer {GROUNDING_API_KEY}"

        req = urllib.request.Request(
            f"{GROUNDING_API_BASE}/chat/completions",
            data=req_body,
            headers=headers,
        )
        resp = urllib.request.urlopen(req, timeout=30)
        data = json.loads(resp.read().decode())

        content = data["choices"][0]["message"]["content"]
        # 提取 JSON 数组（模型可能包裹在 ```json ... ``` 中）
        content = content.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[-1].rsplit("```", 1)[0]
        elements = json.loads(content)

        if isinstance(elements, list):
            # 校验格式
            valid = []
            for el in elements[:30]:
                if isinstance(el, dict) and "x" in el and "y" in el:
                    valid.append({
                        "name": str(el.get("name", "?")),
                        "type": str(el.get("type", "unknown")),
                        "x": int(el["x"]),
                        "y": int(el["y"]),
                    })
            log("grounding", window_hint or "全屏", f"{len(valid)} 元素")
            return valid
        return []

    except (urllib.error.URLError, json.JSONDecodeError, KeyError, IndexError, OSError) as e:
        log("grounding.error", str(e)[:100])
        return []


def _format_grounding(elements: list) -> str:
    """把 grounding 结果格式化为文本表格。"""
    if not elements:
        return ""
    lines = [f"[Visual Grounding] 视觉模型识别到 {len(elements)} 个可交互元素："]
    lines.append(f'{"#":>4}  {"类型":<10}  {"名称":<28}  {"中心坐标"}')
    lines.append("-" * 60)
    for i, el in enumerate(elements, 1):
        lines.append(f'G{i:>3d}  {el["type"]:<10s}  "{el["name"][:26]}"  ({el["x"]},{el["y"]})')
    lines.append("提示：用 desktop_input(action=\"click\", nx=..., ny=...) 点击上述坐标（需转换为 0~1000 归一化值）")
    return "\n".join(lines)


# ══════════════════════════════════════════════════════════════
# UI-TARS 专用 grounding（动作预测型）
# ══════════════════════════════════════════════════════════════
# 与上方 _grounding_analyze（元素列举）不同：UI-TARS 是专用定位模型，
# 给定截图+任务直接输出“该点哪里”的坐标（0~1000 归一化），
# 能区分语义相近的元素（如微信搜索里的真群聊 vs 历史/网页链接）。

UITARS_PROMPT = """You are a GUI agent operating a Windows computer. You will see a screenshot and receive a task. Output the single next action to take.

Output format (strictly follow):
Thought: <one line reasoning>
Action: <action>

Action space:
- click(start_box='(x1,y1,x2,y2)') : click the target element
- double_click(start_box='(x1,y1,x2,y2)')
- type(content='text to type')
- hotkey(key='ctrl+c')
- scroll(direction='up'/'down'/'left'/'right')
- wait()
- finish(content='result message')

Coordinates are normalized to 0-1000 relative to the screenshot. Pick the precise element that fulfills the task. For chat/messaging apps, only click the real chat entry (with avatar), not search-history or web-search links."""


def _parse_uitars_action(text, pw, ph):
    """解析 UI-TARS 输出。坐标 0~1000 归一化中心，再按物理尺寸还原。"""
    import re
    result = {"raw": text, "action": None, "x": None, "y": None,
              "text": None, "thought": None}

    m = re.search(r"Thought:\s*(.+?)(?:\nAction:|\n|$)", text, re.S)
    if m:
        result["thought"] = m.group(1).strip()[:120]

    # click / double_click(start_box='(x1,y1,x2,y2)')  —— UI-TARS 方框格式
    m = re.search(r"(double_click|click)\s*\(\s*start_box\s*=\s*['\"]\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)['\"]", text)
    if m:
        x1, y1, x2, y2 = map(float, m.groups()[1:])
        result["action"] = m.group(1)
        result["x"] = int((x1 + x2) / 2 / 1000 * pw)
        result["y"] = int((y1 + y2) / 2 / 1000 * ph)
        return result

    # click(start_box='<point>x y</point>')  —— doubao-seed 点格式
    m = re.search(r"(double_click|click)\s*\(\s*start_box\s*=\s*['\"]<point>\s*([\d.]+)[\s,]+([\d.]+)\s*</point>['\"]", text)
    if m:
        x, y = float(m.group(2)), float(m.group(3))
        result["action"] = m.group(1)
        result["x"] = int(x / 1000 * pw)
        result["y"] = int(y / 1000 * ph)
        return result

    # type/content 输入动作——兼容多种格式：
    #   type(content='...') / type(content="...") / type(text='...') / input(content='...')
    m = (re.search(r"(?:type|input)\s*\(\s*(?:content|text)\s*=\s*'(.*?)'\s*\)", text, re.S)
         or re.search(r'(?:type|input)\s*\(\s*(?:content|text)\s*=\s*"(.*?)"\s*\)', text, re.S))
    if m:
        result["action"] = "type"
        result["text"] = m.group(1)
        return result
    m = re.search(r"hotkey\s*\(\s*key\s*=\s*['\"](.*?)['\"]\s*\)", text)
    if m:
        result["action"] = "hotkey"
        result["text"] = m.group(1)
        return result

    m = re.search(r"scroll\s*\(\s*direction\s*=\s*['\"](.*?)['\"]\s*\)", text)
    if m:
        result["action"] = "scroll"
        result["text"] = m.group(1)
        return result

    if "finish" in text:
        result["action"] = "finish"
    return result


def _uitars_action(img, task, pw, ph):
    """截图+任务 → UI-TARS → 动作+物理坐标。失败返回 None。"""
    U = _ensure_uia()
    if not GROUNDING_ENABLED or not GROUNDING_API_BASE:
        return None
    try:
        b64 = U.img_to_b64(img, fmt="JPEG")
        if not b64:
            return None
        req_body = json.dumps({
            "model": GROUNDING_MODEL,
            "messages": [
                {"role": "system", "content": UITARS_PROMPT},
                {"role": "user", "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                    {"type": "text", "text": f"任务：{task}"}
                ]}
            ],
            "max_tokens": 300,
            "temperature": 0,
        }).encode()
        headers = {"Content-Type": "application/json"}
        if GROUNDING_API_KEY and GROUNDING_API_KEY != "sk-no-key":
            headers["Authorization"] = f"Bearer {GROUNDING_API_KEY}"
        req = urllib.request.Request(
            f"{GROUNDING_API_BASE}/chat/completions", data=req_body, headers=headers)
        resp = urllib.request.urlopen(req, timeout=45)
        data = json.loads(resp.read().decode())
        content = data["choices"][0]["message"]["content"]
        log("uitars", task[:30], content[:80].replace("\n", " "))
        return _parse_uitars_action(content, pw, ph)
    except Exception as e:
        log("uitars.error", str(e)[:120])
        return None


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

# 日志统一写入 data/log（便携目录），避免污染技能目录
LOG = Path(os.environ.get("PORTABLE_ROOT", Path(__file__).resolve().parents[2])) / "data" / "log" / "computer-use.log"


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
    U = _ensure_uia()
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


def _set_clipboard(text: str):
    """通过 Win32 API 设置剪贴板内容（支持中文）。"""
    CF_UNICODETEXT = 13
    GMEM_MOVEABLE = 0x0002
    kernel32 = ctypes.windll.kernel32
    user32 = ctypes.windll.user32

    # 64 位必须设置 restype/argtypes，否则指针被截断为 32 位 → 乱码
    kernel32.GlobalAlloc.restype = ctypes.c_void_p
    kernel32.GlobalAlloc.argtypes = [ctypes.c_uint, ctypes.c_size_t]
    kernel32.GlobalLock.restype = ctypes.c_void_p
    kernel32.GlobalLock.argtypes = [ctypes.c_void_p]
    kernel32.GlobalUnlock.argtypes = [ctypes.c_void_p]
    user32.SetClipboardData.argtypes = [ctypes.c_uint, ctypes.c_void_p]

    user32.OpenClipboard(0)
    user32.EmptyClipboard()
    data = text.encode("utf-16-le") + b"\x00\x00"
    h = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(data))
    p = kernel32.GlobalLock(h)
    ctypes.memmove(p, data, len(data))
    kernel32.GlobalUnlock(h)
    user32.SetClipboardData(CF_UNICODETEXT, h)
    user32.CloseClipboard()


def _sendinput_unicode(text: str) -> bool:
    """
    SendInput + KEYEVENTF_UNICODE 逐字符输入（可见打字效果，不污染剪贴板）。
    返回是否全部字符都成功插入输入队列。检查 SendInput 返回值，避免静默失败。
    """
    INPUT_KEYBOARD = 1
    KEYEVENTF_UNICODE = 0x0004
    KEYEVENTF_KEYUP = 0x0002

    class KEYBDINPUT(ctypes.Structure):
        _fields_ = [
            ("wVk", ctypes.c_ushort),
            ("wScan", ctypes.c_ushort),
            ("dwFlags", ctypes.c_ulong),
            ("time", ctypes.c_ulong),
            ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
        ]

    class _UNION(ctypes.Union):
        _fields_ = [("ki", KEYBDINPUT)]

    class INPUT(ctypes.Structure):
        _fields_ = [("type", ctypes.c_ulong), ("u", _UNION)]

    SendInput = ctypes.windll.user32.SendInput
    SendInput.restype = ctypes.c_uint  # 返回成功插入的事件数，必须检查

    try:
        all_ok = True
        for ch in text:
            code = ord(ch)
            if code > 0xFFFF:
                # BMP 外字符（emoji）用代理对
                code -= 0x10000
                codes = [0xD800 + (code >> 10), 0xDC00 + (code & 0x3FF)]
            else:
                codes = [code]
            for c in codes:
                down = INPUT(INPUT_KEYBOARD, _UNION(KEYBDINPUT(0, c, KEYEVENTF_UNICODE, 0, None)))
                up = INPUT(INPUT_KEYBOARD, _UNION(KEYBDINPUT(0, c, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, 0, None)))
                events = (INPUT * 2)(down, up)
                n = SendInput(2, ctypes.byref(events), ctypes.sizeof(INPUT))
                if n != 2:
                    all_ok = False  # 有事件没插进去 → 标记失败
            time.sleep(0.05)  # 稍慢一点，给目标应用处理时间，减少丢字
        return all_ok
    except Exception as e:
        log("type.sendinput.error", str(e)[:80])
        return False


def _type_text(text: str):
    """
    输入文本：
    - 纯 ASCII → typewrite（快，可见打字）
    - 含中文/非 ASCII → SendInput 逐字符（KEYEVENTF_UNICODE）为主，剪贴板粘贴兜底

    实测结论：微信聊天框（富文本）接受 SendInput 逐字符输入（可见打字效果），
    但不接受剪贴板 Ctrl+V 粘贴。故中文以 SendInput 为主。SendInput 偊尔因焦点/
    时序问题失败（返回值可检测），失败时重试一次，仍失败再降级剪贴板兜底。
    """
    import pyautogui
    time.sleep(0.4)  # 焦点稳定（输入框刚被点击激活时需要）
    if text.isascii():
        pyautogui.typewrite(text, interval=0.02)
        return
    # 非 ASCII：SendInput 逐字符（微信聊天框验证有效的方式）
    if _sendinput_unicode(text):
        time.sleep(0.2)
        return
    # 重试一次（偊尔的焦点/时序抖动）
    log("type.sendinput.retry", text[:20])
    time.sleep(0.3)
    if _sendinput_unicode(text):
        time.sleep(0.2)
        return
    # 实在不行→剪贴板兜底
    log("type.fallback_clipboard", text[:20])
    _set_clipboard(text)
    time.sleep(0.1)
    pyautogui.hotkey("ctrl", "v")
    time.sleep(0.2)


# ══════════════════════════════════════════════════════════════
# 工具定义
# ══════════════════════════════════════════════════════════════

TOOLS = {
    "tools": [
        {
            "name": "ui_foreground",
            "description": (
                "[任何窗口操作前必须先调] 程序化检测并确保目标窗口在前台。"
                "用 Win32 GetForegroundWindow 判断，不依赖视觉——窗口“露个角”不等于前台。"
                "默认 ensure=true：不在前台会自动置前（最小化会先恢复）。"
                "返回是否在前台/置前是否成功。"
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "window": {
                        "type": "string",
                        "description": "目标窗口标题片段（如 '微信'）"
                    },
                    "ensure": {
                        "type": "boolean",
                        "default": True,
                        "description": "true=不在前台时自动置前；false=只检测不置前"
                    },
                },
                "required": ["window"]
            }
        },
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
                    "grounding": {
                        "type": "boolean",
                        "default": False,
                        "description": "显式请求 Visual Grounding：调用视觉子模型分析截图并返回结构化元素列表（盲窗场景推荐开启）"
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
        {
            "name": "ui_tars",
            "description": (
                "[专用定位模型] 给截图+任务，由 UI-TARS 专用 grounding 模型直接输出该点哪里/该输什么。"
                "适用于语义相近、OCR 分不清的元素（如微信搜索里区分真群聊 vs 历史/网页链接）、"
                "纯图标按钮、未知应用界面。比 ui_click_text 更懂界面语义。"
                "返回动作+坐标；设 execute=true 可直接执行点击/输入。"
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "task": {
                        "type": "string",
                        "description": "要完成的具体操作，如 '点击群聊三jian客' / '点击发送按钮' / '在搜索框输入xxx'"
                    },
                    "window": {
                        "type": "string",
                        "description": "目标窗口标题片段；不填=全屏"
                    },
                    "execute": {
                        "type": "boolean",
                        "default": False,
                        "description": "是否直接执行预测出的点击/输入（false=只返回坐标供主模型决策）"
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

def handle_ui_foreground(args):
    """程序化检测/确保目标窗口在前台。任何窗口操作前必须先调这个。

    窗口“露个角”不等于前台。只有 GetForegroundWindow 返回的窗口才是真正持有
    焦点的。不传 ensure 只检测；ensure=true 时不在前台会自动置前。
    """
    U = _ensure_uia()
    window = args.get("window")
    ensure = bool(args.get("ensure", True))
    if not window:
        return [_text("缺少 window 参数")], True

    ok, err = U.is_foreground(window)
    if err:
        return [_text(f"检测失败: {err}")], True

    if ok:
        return [_text(f"✅ 窗口「{window}」正在前台（持有键盘焦点），可以直接操作。")], False

    if not ensure:
        return [_text(f"⚠️ 窗口「{window}」不在前台（可能被遮挡或最小化）。不要继续操作，先置前。")], False

    # 不在前台 → 自动置前（最小化会先恢复）
    ok2, err2 = U.bring_to_foreground(window)
    if err2:
        return [_text(f"置前失败: {err2}")], True
    if ok2:
        return [_text(f"✅ 窗口「{window}」原本不在前台，已自动置前，现在可以操作了。")], False
    return [_text(f"⚠️ 窗口「{window}」置前后仍未获得焦点，可能被其他弹窗/置顶窗遮挡。请先处理遮挡物。")], True


def handle_ui_inspect(args):
    U = _ensure_uia()
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

    # ── 盲窗检测 + Grounding 子模型增强 ──
    # 有名称的元素少于阈值 → 判定盲窗 → 调 grounding 补充结构化信息
    named_count = sum(1 for it in items if it.get("name", "").strip())
    grounding_text = ""
    if GROUNDING_ENABLED and named_count < BLIND_THRESHOLD:
        img_for_g, _, _ = U.screenshot(window=window, annotate=False, max_width=1024)
        if img_for_g:
            g_elements = _grounding_analyze(img_for_g, window_hint=window or "")
            grounding_text = _format_grounding(g_elements)

    # 附带一张无标注的缩略截图，让主模型看到当前界面状态
    img, smeta, serr = U.screenshot(window=window, annotate=False, max_width=800)
    contents = [_text(table)]
    if grounding_text:
        contents.append(_text(grounding_text))
    img_block = _image(img)
    if img_block:
        contents.append(img_block)

    blind_tag = " [盲窗,已启用Visual Grounding]" if grounding_text else ""
    log("inspect", window or "前台", f"{len(items)} 元素{blind_tag}", f"{elapsed:.2f}s")
    return contents, False


def handle_ui_act(args):
    U = _ensure_uia()
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
    U = _ensure_uia()
    t0 = time.time()
    window = args.get("window")
    annotate = bool(args.get("annotate", False))
    mx = int(args.get("max_items", 40))
    region = _resolve_region_arg(args)
    mw = int(args.get("min_width", 0))
    grounding = bool(args.get("grounding", False))  # 新增：显式请求 grounding

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

    # ── Grounding 增强：显式请求 或 盲窗自动触发 ──
    grounding_text = ""
    if GROUNDING_ENABLED and (grounding or annotate):
        # 用原图（未缩放）做 grounding 以获得准确坐标
        img_full, _, _ = U.screenshot(window=window, annotate=False, max_width=1024)
        if img_full:
            g_elements = _grounding_analyze(img_full, window_hint=window or "")
            grounding_text = _format_grounding(g_elements)
            if grounding_text:
                contents.append(_text(grounding_text))

    img_block = _image(img)
    if img_block:
        contents.append(img_block)

    g_tag = " [+grounding]" if grounding_text else ""
    log("screenshot", window or "全屏", f"annotate={annotate} region={region}{g_tag}", f"{elapsed:.2f}s")
    return contents, False


def handle_ui_ocr(args):
    U = _ensure_uia()
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
    U = _ensure_uia()
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
                      f'可先 ui_ocr 看实际识别出的文字再调整 query。')], False

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
    U = _ensure_uia()
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
        return [_text(f"点击失败: {warn}")], False
    log("click_text", query, desc[:60])
    # 点击后附一张小截图，主模型可立刻看到结果
    img, _, _ = U.screenshot(max_width=800)
    contents = [_text(desc + (f"\n⚠️ {warn}" if warn else ""))]
    ib = _image(img)
    if ib:
        contents.append(ib)
    return contents, bool(warn)


def handle_desktop_input(args):
    U = _ensure_uia()
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
            _type_text(txt)
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
    U = _ensure_uia()
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


def handle_ui_tars(args):
    """专用 grounding 模型动作预测：截图+任务 → 该点哪里/该输什么。"""
    U = _ensure_uia()
    task = args.get("task", "")
    window = args.get("window")
    execute = bool(args.get("execute", False))

    if not GROUNDING_ENABLED or not GROUNDING_API_BASE:
        return [_text("UI-TARS 未启用：grounding.json 需配置 api_base 且 enabled=1")], True
    if not task:
        return [_text("缺少 task 参数")], True

    # 截图（保留物理尺寸 + 偏移，用于坐标换算）
    img, meta, err = U.screenshot(window=window, annotate=False, max_width=1280)
    if err:
        return [_text(f"截图失败: {err}")], True

    try:
        pw, ph = map(int, meta.get("physical_size", "0x0").split("x"))
    except Exception:
        pw, ph = img.width, img.height
    offset = meta.get("offset", (0, 0))

    result = _uitars_action(img, task, pw, ph)
    if not result or not result.get("action"):
        raw = result.get("raw", "无响应") if result else "无响应"
        return [_text(f"UI-TARS 未解析出动作。原始输出：\n{raw}")], True

    act = result["action"]
    lines = ["[UI-TARS 决策]"]
    if result.get("thought"):
        lines.append(f"思考：{result['thought']}")

    if act in ("click", "double_click"):
        # 窗口截图时 x,y 是区域物理坐标，加上 offset 得屏幕绝对坐标
        sx = offset[0] + result["x"]
        sy = offset[1] + result["y"]
        sw, sh = U.screen_size()
        nx = sx / sw * 1000
        ny = sy / sh * 1000
        lines.append(f"动作：{act} 屏幕坐标({sx},{sy}) 归一化(nx={nx:.1f}, ny={ny:.1f})")
        lines.append(f'执行：desktop_input(action="{"double_click" if act=="double_click" else "click"}", nx={nx:.1f}, ny={ny:.1f})')
        if execute:
            import pyautogui
            if act == "double_click":
                pyautogui.doubleClick(sx, sy)
            else:
                pyautogui.click(sx, sy)
            lines.append("（已自动执行点击，请 ui_screenshot 验证）")
    elif act == "type":
        lines.append(f"动作：输入 \"{result['text']}\"")
        lines.append(f'执行：desktop_input(action="type", text="{result["text"]}")')
        if execute:
            _type_text(result["text"])
            lines.append("（已自动执行输入）")
    elif act == "hotkey":
        lines.append(f"动作：按键 {result['text']}")
    elif act == "scroll":
        lines.append(f"动作：滚动 {result['text']}")
    elif act == "finish":
        lines.append("动作：任务完成")

    contents = [_text("\n".join(lines))]
    ib = _image(img)
    if ib:
        contents.append(ib)
    return contents, False


# ══════════════════════════════════════════════════════════════
# MCP Server 主循环
# ══════════════════════════════════════════════════════════════

HANDLERS = {
    "ui_foreground": handle_ui_foreground,
    "ui_inspect": handle_ui_inspect,
    "ui_act": handle_ui_act,
    "ui_screenshot": handle_ui_screenshot,
    "ui_ocr": handle_ui_ocr,
    "ui_find_text": handle_ui_find_text,
    "ui_click_text": handle_ui_click_text,
    "desktop_input": handle_desktop_input,
    "computer_use": handle_computer_use,
    "ui_tars": handle_ui_tars,
}


def send(msg):
    data = json.dumps(msg, ensure_ascii=False)
    sys.stdout.write(data + "\n")
    sys.stdout.flush()


def log_err(msg):
    sys.stderr.write(f"[computer-use-mcp] {msg}\n")
    sys.stderr.flush()


def main():
    log_err("Computer Use MCP Server v2 启动 (UIA 优先 + 四级降级) [uia_core 懒加载]")

    _logged_dpi = False
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
            if not _logged_dpi:
                _logged_dpi = True
                try:
                    u = _ensure_uia()
                    log_err(f"DPI aware: {u._DPI_READY}")
                    log_err(f"屏幕: {u.screen_size()}")
                except Exception as e:
                    log_err(f"uia_core 懒加载失败: {e}")
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
