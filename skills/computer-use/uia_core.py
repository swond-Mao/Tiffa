"""
uia_core.py - Windows UI Automation 核心封装

设计目标：让桌面自动化摆脱"截图猜坐标"，改为"按控件名精确操作"。

四级降级链：
  1. UIA Pattern 直调  —— Invoke/SetValue/Toggle，连鼠标都不动，零偏差
  2. UIA 精确坐标点击  —— 系统给出的 BoundingRectangle 中心，不受 DPI 影响
  3. SoM 编号标注截图  —— 模型只需识别编号，不需估算坐标
  4. 归一化坐标兜底    —— 0~1000 归一化，与屏幕分辨率解耦

关键：进程启动即设 Per-Monitor-V2 DPI 感知，所有坐标统一为物理像素。
"""

import ctypes
import io
import time
import warnings

warnings.filterwarnings("ignore")

# ══════════════════════════════════════════════════════════════
# DPI 感知：必须在任何窗口/屏幕 API 调用之前完成
# ══════════════════════════════════════════════════════════════

_DPI_READY = False


def init_dpi():
    """设置 Per-Monitor Aware V2。4K + 缩放场景下坐标正确的前提。"""
    global _DPI_READY
    if _DPI_READY:
        return True
    try:
        # -4 = DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
        ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
        _DPI_READY = True
    except Exception:
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)  # PROCESS_PER_MONITOR_DPI_AWARE
            _DPI_READY = True
        except Exception:
            try:
                ctypes.windll.user32.SetProcessDPIAware()
                _DPI_READY = True
            except Exception:
                pass
    return _DPI_READY


init_dpi()

# ══════════════════════════════════════════════════════════════
# UIA 常量
# ══════════════════════════════════════════════════════════════

# Property IDs
P_RECT = 30001
P_PROCESS_ID = 30002
P_CONTROL_TYPE = 30003
P_NAME = 30005
P_HAS_FOCUS = 30008
P_FOCUSABLE = 30009
P_ENABLED = 30010
P_AUTOMATION_ID = 30011
P_CLASS_NAME = 30012
P_IS_PASSWORD = 30019
P_OFFSCREEN = 30022

# Pattern IDs
PAT_INVOKE = 10000
PAT_VALUE = 10002
PAT_SCROLL = 10004
PAT_EXPAND = 10005
PAT_WINDOW = 10009
PAT_SELECTION_ITEM = 10010
PAT_TOGGLE = 10015
PAT_SCROLL_ITEM = 10017
PAT_LEGACY = 10018

# TreeScope
SCOPE_CHILDREN = 2
SCOPE_DESCENDANTS = 4

CONTROL_TYPES = {
    50000: "Button", 50001: "Calendar", 50002: "CheckBox", 50003: "ComboBox",
    50004: "Edit", 50005: "Hyperlink", 50006: "Image", 50007: "ListItem",
    50008: "List", 50009: "Menu", 50010: "MenuBar", 50011: "MenuItem",
    50012: "ProgressBar", 50013: "RadioButton", 50014: "ScrollBar", 50015: "Slider",
    50016: "Spinner", 50017: "StatusBar", 50018: "Tab", 50019: "TabItem",
    50020: "Text", 50021: "ToolBar", 50022: "ToolTip", 50023: "Tree",
    50024: "TreeItem", 50025: "Custom", 50026: "Group", 50027: "Thumb",
    50028: "DataGrid", 50029: "DataItem", 50030: "Document", 50031: "SplitButton",
    50032: "Window", 50033: "Pane", 50034: "Header", 50035: "HeaderItem",
    50036: "Table", 50037: "TitleBar", 50038: "Separator", 50039: "SemanticZoom",
    50040: "AppBar",
}

# 默认认为"可交互"的控件类型
INTERACTIVE_TYPES = [
    50000,  # Button
    50002,  # CheckBox
    50003,  # ComboBox
    50004,  # Edit
    50005,  # Hyperlink
    50007,  # ListItem
    50011,  # MenuItem
    50013,  # RadioButton
    50015,  # Slider
    50019,  # TabItem
    50024,  # TreeItem
    50029,  # DataItem
    50031,  # SplitButton
]

# ══════════════════════════════════════════════════════════════
# UIA 单例
# ══════════════════════════════════════════════════════════════

_UIA = None
_DLL = None


def get_uia():
    """返回 (IUIAutomation 实例, comtypes 生成的接口模块)"""
    global _UIA, _DLL
    if _UIA is None:
        from pywinauto.uia_defines import IUIA
        holder = IUIA()
        _UIA = holder.iuia
        _DLL = holder.UIA_dll
    return _UIA, _DLL


# ══════════════════════════════════════════════════════════════
# 元素缓存：inspect 分配编号，act 按编号取回
# ══════════════════════════════════════════════════════════════

class ElementCache:
    """存放最近一次 inspect 的结果，供 ui_act 用编号引用。"""

    def __init__(self):
        self.items = []       # [{'id','type','name','rect','el',...}]
        self.stamp = 0.0
        self.window_title = ""

    def store(self, items, window_title=""):
        self.items = items
        self.stamp = time.time()
        self.window_title = window_title

    def get(self, ref):
        """ref 可以是编号（int 或 '12'）或名称片段。"""
        if not self.items:
            return None, "元素缓存为空，请先调用 ui_inspect 枚举界面元素"

        # 数字编号
        s = str(ref).strip().lstrip("#")
        if s.isdigit():
            idx = int(s)
            for it in self.items:
                if it["id"] == idx:
                    return it, None
            return None, f"编号 #{idx} 不存在，当前缓存 {len(self.items)} 个元素（#1~#{len(self.items)}）"

        # 名称精确匹配优先
        low = str(ref).strip().lower()
        exact = [it for it in self.items if (it["name"] or "").lower() == low]
        if len(exact) == 1:
            return exact[0], None
        if len(exact) > 1:
            ids = ", ".join(f"#{i['id']}" for i in exact[:8])
            return None, f"名称 '{ref}' 匹配到多个元素（{ids}），请改用编号"

        # 名称包含匹配
        part = [it for it in self.items if low in (it["name"] or "").lower()]
        if len(part) == 1:
            return part[0], None
        if len(part) > 1:
            ids = ", ".join(f"#{i['id']}({i['name'][:16]})" for i in part[:8])
            return None, f"名称 '{ref}' 模糊匹配到多个（{ids}），请改用编号"

        return None, f"找不到元素 '{ref}'，请先 ui_inspect 查看当前可用元素"

    def age(self):
        return time.time() - self.stamp if self.stamp else 1e9


CACHE = ElementCache()


# ══════════════════════════════════════════════════════════════
# 窗口枚举
# ══════════════════════════════════════════════════════════════

def _rect_tuple(r):
    return (int(r.left), int(r.top), int(r.right), int(r.bottom))


def list_windows():
    """列出所有可见顶层窗口。"""
    iuia, _ = get_uia()
    out = []
    try:
        arr = iuia.GetRootElement().FindAll(SCOPE_CHILDREN, iuia.CreateTrueCondition())
    except Exception as e:
        return out, f"枚举窗口失败: {e}"
    for i in range(arr.Length):
        try:
            e = arr.GetElement(i)
            name = e.CurrentName or ""
            if not name.strip():
                continue
            l, t, r, b = _rect_tuple(e.CurrentBoundingRectangle)
            if r - l <= 1 or b - t <= 1:
                continue  # 隐藏/零尺寸窗口
            out.append({
                "name": name,
                "rect": (l, t, r, b),
                "class": e.CurrentClassName or "",
                "pid": e.CurrentProcessId,
                "el": e,
            })
        except Exception:
            continue
    return out, None


def get_foreground():
    """取当前前台窗口元素。"""
    iuia, _ = get_uia()
    try:
        hwnd = ctypes.windll.user32.GetForegroundWindow()
        if not hwnd:
            return None, "没有前台窗口"
        return iuia.ElementFromHandle(hwnd), None
    except Exception as e:
        return None, f"获取前台窗口失败: {e}"


def find_window(title):
    """按标题模糊匹配窗口元素。"""
    wins, err = list_windows()
    if err:
        return None, err
    low = title.lower()
    exact = [w for w in wins if w["name"].lower() == low]
    if exact:
        return exact[0]["el"], None
    part = [w for w in wins if low in w["name"].lower()]
    if part:
        return part[0]["el"], None
    avail = ", ".join(f'"{w["name"][:28]}"' for w in wins[:10])
    return None, f'找不到标题含 "{title}" 的窗口。当前可见窗口: {avail}'


# ══════════════════════════════════════════════════════════════
# 元素枚举（核心）
# ══════════════════════════════════════════════════════════════

def _supported_actions(el):
    """探测元素支持哪些操作。轻量探测，只查最常用的几个 pattern。"""
    acts = []
    probes = (
        (PAT_INVOKE, "invoke"),
        (PAT_VALUE, "set_text"),
        (PAT_TOGGLE, "toggle"),
        (PAT_SELECTION_ITEM, "select"),
        (PAT_EXPAND, "expand"),
    )
    for pid, label in probes:
        try:
            if el.GetCurrentPattern(pid):
                acts.append(label)
        except Exception:
            pass
    return acts


def inspect(window=None, name_filter=None, types=None, max_items=80,
            include_offscreen=False, probe_actions=True):
    """
    枚举窗口内可交互元素。

    window        : 窗口标题片段；None=前台窗口；"desktop"=列出所有顶层窗口
    name_filter   : 只保留名称含该片段的元素
    types         : 控件类型名列表，如 ["Button","Edit"]；None=默认可交互集合
    max_items     : 上限，防止超大列表刷屏
    probe_actions : 是否探测每个元素支持的操作（略慢但信息更全）

    返回 (items, meta, error)
    """
    iuia, _ = get_uia()

    # desktop 模式：只列窗口
    if window and str(window).strip().lower() == "desktop":
        wins, err = list_windows()
        if err:
            return [], {}, err
        items = []
        for i, w in enumerate(wins[:max_items], 1):
            l, t, r, b = w["rect"]
            items.append({
                "id": i, "type": "Window", "name": w["name"],
                "rect": (l, t, r, b), "center": ((l + r) // 2, (t + b) // 2),
                "enabled": True, "actions": ["focus"], "el": w["el"],
                "automation_id": "",
            })
        CACHE.store(items, "desktop")
        return items, {"scope": "desktop", "count": len(items)}, None

    # 定位目标窗口
    if window:
        root, err = find_window(window)
        if err:
            return [], {}, err
    else:
        root, err = get_foreground()
        if err:
            return [], {}, err

    try:
        win_title = root.CurrentName or "(无标题)"
    except Exception:
        win_title = "(未知窗口)"

    # 构造 UIA 层过滤条件（比 Python 层过滤快得多）
    if types:
        rev = {v.lower(): k for k, v in CONTROL_TYPES.items()}
        type_ids = [rev[t.lower()] for t in types if t.lower() in rev]
        if not type_ids:
            valid = ", ".join(sorted(set(CONTROL_TYPES.values())))
            return [], {}, f"types 参数无效。可用类型: {valid}"
    else:
        type_ids = INTERACTIVE_TYPES

    try:
        conds = [iuia.CreatePropertyCondition(P_CONTROL_TYPE, tid) for tid in type_ids]
        cond = iuia.CreateOrConditionFromArray(conds) if len(conds) > 1 else conds[0]
        if not include_offscreen:
            cond = iuia.CreateAndCondition(
                cond, iuia.CreatePropertyCondition(P_OFFSCREEN, False))
        arr = root.FindAll(SCOPE_DESCENDANTS, cond)
    except Exception as e:
        return [], {}, f"枚举元素失败: {e}"

    total_found = arr.Length
    items = []
    truncated = False
    low_filter = name_filter.lower() if name_filter else None

    for i in range(total_found):
        if len(items) >= max_items:
            truncated = True
            break
        try:
            e = arr.GetElement(i)
            l, t, r, b = _rect_tuple(e.CurrentBoundingRectangle)
            if r - l < 2 or b - t < 2:
                continue  # 零尺寸元素无意义
            nm = e.CurrentName or ""
            if low_filter and low_filter not in nm.lower():
                continue
            ctype = CONTROL_TYPES.get(e.CurrentControlType, str(e.CurrentControlType))
            try:
                enabled = bool(e.CurrentIsEnabled)
            except Exception:
                enabled = True
            try:
                aid = e.CurrentAutomationId or ""
            except Exception:
                aid = ""

            items.append({
                "id": len(items) + 1,
                "type": ctype,
                "name": nm,
                "rect": (l, t, r, b),
                "center": ((l + r) // 2, (t + b) // 2),
                "enabled": enabled,
                "automation_id": aid,
                "actions": _supported_actions(e) if probe_actions else [],
                "el": e,
            })
        except Exception:
            continue

    CACHE.store(items, win_title)
    meta = {
        "window": win_title,
        "count": len(items),
        "total_matched": total_found,
        "truncated": truncated,
    }
    return items, meta, None


# ══════════════════════════════════════════════════════════════
# 元素操作（一级：Pattern 直调 / 二级：精确坐标）
# ══════════════════════════════════════════════════════════════

def _click_point(x, y, button="left", double=False):
    """物理像素坐标点击。进程已 DPI-aware，坐标即真实像素。"""
    import pyautogui
    pyautogui.FAILSAFE = True
    if double:
        pyautogui.doubleClick(x, y)
    elif button == "right":
        pyautogui.rightClick(x, y)
    elif button == "middle":
        pyautogui.middleClick(x, y)
    else:
        pyautogui.click(x, y)


def act(ref, action="invoke", text=None, button="left"):
    """
    对缓存中的元素执行操作。

    action: invoke / click / double_click / right_click / set_text /
            toggle / select / focus / expand / collapse / scroll_into_view
    返回 (结果描述, error)
    """
    item, err = CACHE.get(ref)
    if err:
        return None, err

    el = item["el"]
    _, dll = get_uia()
    label = f'#{item["id"]} {item["type"]} "{item["name"][:30]}"'

    if not item.get("enabled", True) and action not in ("focus", "scroll_into_view"):
        return None, f"{label} 当前处于禁用状态，无法操作"

    # 元素可能已失效（窗口关闭/界面重绘）
    try:
        _ = el.CurrentBoundingRectangle
    except Exception:
        return None, f"{label} 已失效（界面可能已变化），请重新 ui_inspect"

    try:
        # ── 一级：Pattern 直调 ──
        if action == "invoke":
            p = el.GetCurrentPattern(PAT_INVOKE)
            if p:
                p.QueryInterface(dll.IUIAutomationInvokePattern).Invoke()
                return f"{label} 已触发（UIA Invoke，未移动鼠标）", None
            # 降级：Pattern 不支持则用坐标点击
            x, y = item["center"]
            _click_point(x, y)
            return f"{label} 已点击（降级为坐标 {x},{y}，该控件不支持 Invoke）", None

        if action == "set_text":
            if text is None:
                return None, "set_text 需要提供 text 参数"
            p = el.GetCurrentPattern(PAT_VALUE)
            if p:
                vp = p.QueryInterface(dll.IUIAutomationValuePattern)
                if vp.CurrentIsReadOnly:
                    return None, f"{label} 是只读控件，无法写入"
                vp.SetValue(text)
                return f'{label} 已写入: "{text[:40]}"（UIA SetValue，未用键盘）', None
            # 降级：聚焦后模拟键盘
            import pyautogui
            try:
                el.SetFocus()
            except Exception:
                x, y = item["center"]
                _click_point(x, y)
            time.sleep(0.15)
            pyautogui.hotkey("ctrl", "a")
            pyautogui.typewrite(text, interval=0.01)
            return f'{label} 已输入: "{text[:40]}"（降级为键盘模拟）', None

        if action == "toggle":
            p = el.GetCurrentPattern(PAT_TOGGLE)
            if p:
                tp = p.QueryInterface(dll.IUIAutomationTogglePattern)
                before = tp.CurrentToggleState
                tp.Toggle()
                names = {0: "未选中", 1: "已选中", 2: "不确定"}
                return (f"{label} 状态 {names.get(before, before)} -> "
                        f"{names.get(tp.CurrentToggleState, '?')}"), None
            return None, f"{label} 不支持 toggle 操作"

        if action == "select":
            p = el.GetCurrentPattern(PAT_SELECTION_ITEM)
            if p:
                p.QueryInterface(dll.IUIAutomationSelectionItemPattern).Select()
                return f"{label} 已选中（UIA Select）", None
            x, y = item["center"]
            _click_point(x, y)
            return f"{label} 已点击选中（降级为坐标）", None

        if action in ("expand", "collapse"):
            p = el.GetCurrentPattern(PAT_EXPAND)
            if p:
                ep = p.QueryInterface(dll.IUIAutomationExpandCollapsePattern)
                if action == "expand":
                    ep.Expand()
                else:
                    ep.Collapse()
                return f"{label} 已{'展开' if action == 'expand' else '折叠'}", None
            return None, f"{label} 不支持 {action} 操作"

        if action == "focus":
            el.SetFocus()
            return f"{label} 已获得焦点", None

        if action == "scroll_into_view":
            p = el.GetCurrentPattern(PAT_SCROLL_ITEM)
            if p:
                p.QueryInterface(dll.IUIAutomationScrollItemPattern).ScrollIntoView()
                return f"{label} 已滚动到可见区域", None
            return None, f"{label} 不支持滚动定位"

        # ── 二级：UIA 精确坐标 ──
        if action in ("click", "double_click", "right_click"):
            x, y = item["center"]
            _click_point(x, y,
                         button="right" if action == "right_click" else button,
                         double=(action == "double_click"))
            verb = {"click": "点击", "double_click": "双击", "right_click": "右键"}[action]
            return f"{label} 已{verb}（UIA 精确坐标 {x},{y}）", None

        return None, (f"未知操作 '{action}'。可用: invoke, click, double_click, "
                      f"right_click, set_text, toggle, select, focus, expand, "
                      f"collapse, scroll_into_view")

    except Exception as e:
        return None, f"{label} 操作失败: {type(e).__name__}: {e}"


def wait_for(name, timeout=10, mode="appear", window=None):
    """等待元素出现或消失。比盲目 sleep 可靠。"""
    deadline = time.time() + timeout
    low = name.lower()
    while time.time() < deadline:
        items, _, err = inspect(window=window, max_items=200, probe_actions=False)
        if not err:
            hit = any(low in (it["name"] or "").lower() for it in items)
            if mode == "appear" and hit:
                return f'元素 "{name}" 已出现（等待 {time.time() - deadline + timeout:.1f}s）', None
            if mode == "disappear" and not hit:
                return f'元素 "{name}" 已消失', None
        time.sleep(0.4)
    return None, f'等待超时（{timeout}s）：元素 "{name}" 未{"出现" if mode == "appear" else "消失"}'


# ══════════════════════════════════════════════════════════════
# 截图（三级：SoM 标注 / 四级：归一化坐标的基础）
# ══════════════════════════════════════════════════════════════

def screen_size():
    import mss
    with mss.MSS() as sct:
        m = sct.monitors[0]
        return m["width"], m["height"]


def grab(region=None):
    """截屏，返回 PIL Image。region=(l,t,r,b) 物理像素。"""
    import mss
    from PIL import Image
    with mss.MSS() as sct:
        if region:
            l, t, r, b = region
            mon = {"left": l, "top": t, "width": max(1, r - l), "height": max(1, b - t)}
        else:
            mon = sct.monitors[0]
        shot = sct.grab(mon)
        return Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")


_SOM_COLORS = [
    (220, 38, 38), (37, 99, 235), (22, 163, 74), (202, 138, 4),
    (147, 51, 234), (219, 39, 119), (13, 148, 136), (234, 88, 12),
]


def annotate_som(img, items, offset=(0, 0), scale=1.0):
    """在截图上画编号框（Set-of-Mark）。模型只需回答编号，无需估算坐标。"""
    from PIL import ImageDraw, ImageFont
    draw = ImageDraw.Draw(img, "RGBA")
    ox, oy = offset

    size = max(11, int(13 * scale)) if scale < 1 else 13
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", size)
    except Exception:
        font = ImageFont.load_default()

    for it in items:
        l, t, r, b = it["rect"]
        l = int((l - ox) * scale); t = int((t - oy) * scale)
        r = int((r - ox) * scale); b = int((b - oy) * scale)
        if r <= l or b <= t:
            continue
        color = _SOM_COLORS[(it["id"] - 1) % len(_SOM_COLORS)]
        draw.rectangle([l, t, r - 1, b - 1], outline=color, width=2)

        tag = str(it["id"])
        try:
            tb = draw.textbbox((0, 0), tag, font=font)
            tw, th = tb[2] - tb[0], tb[3] - tb[1]
        except Exception:
            tw, th = len(tag) * 7, 13
        pad = 3
        bw, bh = tw + pad * 2, th + pad * 2
        # 标签优先放左上角外侧，贴边时翻转到框内
        bx = l if l + bw <= img.width else max(0, r - bw)
        by = t - bh if t - bh >= 0 else t
        draw.rectangle([bx, by, bx + bw, by + bh], fill=color + (235,))
        draw.text((bx + pad, by + pad - 1), tag, fill=(255, 255, 255), font=font)

    return img


"""区域预设：相对窗口(或全屏)的比例框，供模型用语义名裁剪，避免全窗口截图糊成一片。"""
REGION_PRESETS = {
    "full":         (0.0, 0.0, 1.0, 1.0),
    "top":          (0.0, 0.0, 1.0, 0.25),
    "bottom":       (0.0, 0.75, 1.0, 1.0),
    "left":         (0.0, 0.0, 0.30, 1.0),
    "right":        (0.70, 0.0, 1.0, 1.0),
    "center":       (0.25, 0.25, 0.75, 0.75),
    "titlebar":     (0.0, 0.0, 1.0, 0.08),
    "top-left":     (0.0, 0.0, 0.40, 0.35),
    "sidebar":      (0.0, 0.0, 0.26, 1.0),
    "list":         (0.05, 0.05, 0.32, 1.0),
    "content":      (0.26, 0.0, 1.0, 1.0),
    "input":        (0.26, 0.72, 1.0, 1.0),
}


def resolve_region(region, base):
    """
    把 region 归一化为物理绝对坐标 (x1,y1,x2,y2)。

    支持三种写法：
      - 预设名字符串       "list" / "titlebar" / "input"
      - 比例元组(全 <=1.0) (0.0, 0.0, 0.3, 1.0)
      - 绝对物理坐标元组   (560, 150, 1060, 566)

    base : 参照系 (x1,y1,x2,y2)，通常是窗口矩形；None 表示全屏。
    """
    if region is None:
        return base
    if base is None:
        w, h = screen_size()
        base = (0, 0, w, h)
    bx, by, bw, bh = base[0], base[1], base[2] - base[0], base[3] - base[1]

    if isinstance(region, str):
        key = region.strip().lower()
        if key not in REGION_PRESETS:
            return base
        region = REGION_PRESETS[key]

    try:
        r = [float(v) for v in region]
    except Exception:
        return base
    if len(r) != 4:
        return base

    # 全部 <=1.0 视为比例（注意 0/1 边界，用 max 判定）
    if max(r) <= 1.0:
        x1 = int(bx + r[0] * bw)
        y1 = int(by + r[1] * bh)
        x2 = int(bx + r[2] * bw)
        y2 = int(by + r[3] * bh)
    else:
        x1, y1, x2, y2 = int(r[0]), int(r[1]), int(r[2]), int(r[3])

    # 收敛到 base 内，并保证非空
    x1 = max(base[0], min(x1, base[2] - 1))
    y1 = max(base[1], min(y1, base[3] - 1))
    x2 = max(x1 + 1, min(x2, base[2]))
    y2 = max(y1 + 1, min(y2, base[3]))
    return (x1, y1, x2, y2)


"""图片像素预算。约等于 1280x800，是视觉模型能吃下且不糊的经验值。"""
MAX_PIXELS = 1280 * 800


def screenshot(window=None, region=None, annotate=False,
               max_width=None, min_width=None, max_items=60,
               max_pixels=MAX_PIXELS):
    """
    截图，可选区域裁剪与 SoM 编号标注。

    region     : 见 resolve_region。只截关键区域是"模型看不清"的首选解法——
                 同样的图片预算下，裁剪比缩放能保留高得多的有效像素密度。
    max_pixels : 缩放主控，按**面积**而非宽度判断。
                 只看宽度会把 1936x93 这类又宽又矮的标题条也缩掉 34%，
                 字反而更糊；按面积算则矮条根本不触发缩放。
    max_width  : 硬上限，默认 None(不启用)。仅在确实需要限制宽度时传。
    min_width  : 上采样下限。小区域(标题栏、搜索结果行)裁下来往往只有几百像素宽，
                 放大到 min_width 能显著提升 VLM 与 OCR 的识别率。

    返回 (PIL Image, meta, error)
    """
    win_rect = None
    win_title = "全屏"

    if window and str(window).strip().lower() != "desktop":
        el, err = find_window(window)
        if err:
            return None, {}, err
        try:
            win_rect = _rect_tuple(el.CurrentBoundingRectangle)
            win_title = el.CurrentName or window
        except Exception:
            win_rect = None

    # 裁剪区域基于窗口矩形解析；无窗口时基于全屏
    shot_region = resolve_region(region, win_rect)

    items = []
    if annotate:
        items, _meta, err = inspect(window=window, max_items=max_items,
                                    probe_actions=False)
        if err:
            return None, {}, err

    img = grab(shot_region)
    raw_w, raw_h = img.width, img.height
    offset = (shot_region[0], shot_region[1]) if shot_region else (0, 0)

    scale = 1.0
    raw_px = raw_w * raw_h
    if max_pixels and raw_px > max_pixels:
        scale = (max_pixels / raw_px) ** 0.5          # 按面积等比缩
    if max_width and raw_w * scale > max_width:
        scale = max_width / raw_w                      # 硬上限兜底
    if scale >= 1.0 and min_width and raw_w < min_width:
        # 上采样用 LANCZOS，小字边缘比双线性清晰得多；4x 封顶防显存爆炸
        scale = min(min_width / raw_w, 4.0)
        if raw_px * scale * scale > max_pixels * 4:
            scale = ((max_pixels * 4) / raw_px) ** 0.5

    if scale != 1.0:
        from PIL import Image
        resample = Image.LANCZOS if scale > 1.0 else Image.BILINEAR
        img = img.resize((max(1, int(raw_w * scale)),
                          max(1, int(raw_h * scale))), resample)

    if annotate and items:
        img = annotate_som(img, items, offset=offset, scale=scale)

    meta = {
        "window": win_title,
        "region": list(shot_region) if shot_region else None,
        "physical_size": f"{raw_w}x{raw_h}",
        "image_size": f"{img.width}x{img.height}",
        "scale": round(scale, 4),
        "offset": offset,
        "annotated": bool(annotate and items),
        "marked_count": len(items) if annotate else 0,
    }
    return img, meta, None


# ══════════════════════════════════════════════════════════════
# OCR 层（L5：文本识别兜底）—— 解决"截图太密模型看不清" + 盲窗点不准
# ══════════════════════════════════════════════════════════════
#
# 微信(Qt 5.15, a11y 桥禁用)对 UIA 全盲，UIA Pattern / 精确坐标 / SoM 全部失效。
# Windows 内置 OCR (winrt-Windows.Media.Ocr, 系统自带 zh-Hans-CN 语言包) 不依赖
# a11y，直接对像素做识别，返回每行文本 + 包围盒物理坐标。
#
# 与 screenshot() 的分工：
#   - screenshot() 面向 VLM 视觉，默认会缩放到合理尺寸；
#   - ocr_region() 面向精确文本/坐标提取，默认**不缩放**(保留像素密度)，
#     小区域反而上采样(min_width)以提升识别率。

def _pil_to_software_bitmap(img):
    """PIL(RGBA) -> winrt SoftwareBitmap，Buffer+memoryview 零拷贝(~3ms/2.3MB)。"""
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    b = img.tobytes("raw", "BGRA")
    from winrt.windows.storage.streams import Buffer
    buf = Buffer(len(b))
    buf.length = len(b)
    with memoryview(buf) as mv:
        mv[:] = b
    from winrt.windows.graphics.imaging import (
        SoftwareBitmap, BitmapPixelFormat, BitmapAlphaMode)
    sb = SoftwareBitmap(BitmapPixelFormat.BGRA8, img.width, img.height,
                        BitmapAlphaMode.PREMULTIPLIED)
    sb.copy_from_buffer(buf)
    return sb


_OCR_ENGINE = None


def _get_ocr_engine():
    global _OCR_ENGINE
    if _OCR_ENGINE is None:
        from winrt.windows.media.ocr import OcrEngine
        _OCR_ENGINE = OcrEngine.try_create_from_user_profile_languages()
    return _OCR_ENGINE


def _ocr_run(sb):
    import asyncio
    engine = _get_ocr_engine()

    async def _go():
        return await engine.recognize_async(sb)

    return asyncio.run(_go())


def _union_line_rect(words):
    """OcrLine 本身无包围盒，需用其 words 的包围盒做并集。"""
    xs = [w.bounding_rect.x for w in words]
    ys = [w.bounding_rect.y for w in words]
    xe = [w.bounding_rect.x + w.bounding_rect.width for w in words]
    ye = [w.bounding_rect.y + w.bounding_rect.height for w in words]
    return min(xs), min(ys), max(xe), max(ye)


def ocr_region(window=None, region=None, min_width=720, max_pixels=None):
    """
    OCR 指定窗口/区域，返回带**物理屏幕坐标**的文本行。

    window/region : 同 screenshot()（region 用预设名/比例/绝对坐标均可）
    min_width     : 把裁下的小区域(搜索结果行、标题)放大到此宽度，提升识别率
    max_pixels    : None=不缩。大区域默认也不缩——OCR 本地足够快，缩了反而掉字

    返回 (results, meta, error)，results 为每行一个 dict：
      {text, x1,y1,x2,y2, cx,cy, words:[{text,x1,y1,x2,y2}]}
    坐标均为**物理屏幕像素**(已叠加 offset、已按 scale 还原)
    """
    img, meta, err = screenshot(window=window, region=region,
                                min_width=min_width, max_pixels=max_pixels)
    if err:
        return None, {}, err
    sb = _pil_to_software_bitmap(img)
    try:
        res = _ocr_run(sb)
    except Exception as e:
        return None, meta, f"OCR 失败: {type(e).__name__}: {e}"
    ox, oy = meta.get("offset", (0, 0))
    scale = meta.get("scale", 1.0)
    out = []
    for line in res.lines:
        if not line.words:
            continue
        x1, y1, x2, y2 = _union_line_rect(line.words)
        lx1 = ox + x1 / scale
        ly1 = oy + y1 / scale
        lx2 = ox + x2 / scale
        ly2 = oy + y2 / scale
        words = []
        for w in line.words:
            wr = w.bounding_rect
            words.append({
                "text": w.text,
                "x1": ox + wr.x / scale, "y1": oy + wr.y / scale,
                "x2": ox + (wr.x + wr.width) / scale,
                "y2": oy + (wr.y + wr.height) / scale,
            })
        out.append({
            "text": "".join(w.text for w in line.words),
            "x1": lx1, "y1": ly1, "x2": lx2, "y2": ly2,
            "cx": (lx1 + lx2) / 2, "cy": (ly1 + ly2) / 2,
            "words": words,
        })
    meta["ocr_lines"] = len(out)
    return out, meta, None


def _norm(s):
    # 去空白 + 小写 + 去声调/变音符号（OCR 常把 jian 读成 jiàn）
    import unicodedata
    s = "".join(str(s).split()).lower()
    return "".join(c for c in unicodedata.normalize("NFD", s)
                   if unicodedata.category(c) != "Mn")


# 微信搜索结果面板的分类标题（中文）。按区块定位可避免把「联系人/聊天记录/
# 公众号」里的同名项误当成群聊。
CATEGORY_HEADERS = {
    "group": "群聊",
    "contact": "联系人",
    "chat_history": "聊天记录",
    "official": "公众号",
}


def _hdr_match(nt, hdr):
    """判断一行文本是否为分类标题（容忍 OCR 把 '群聊' 读成 '群 聊'/'群聊(3)'）。

    要求：行文本很短（不像聊天记录长句），且与标题字串双向包含其一。
    """
    if not nt or not hdr:
        return False
    return (hdr in nt or nt in hdr) and len(nt) <= len(hdr) + 4


def _scope_lines(lines, scope, scope_end=None):
    """
    把 OCR 行限定到某个分类区块内（标题行之间的区域）。

    scope     : "any"/None(整区) | 预设 group/contact/chat_history/official
                | 任意标题文字(如 "Results"/"歌曲"/"群聊")
    scope_end : 可选结束标题。多分类 app(如英文 Results/Suggestions)务必传，
                否则下个分类标题不在已知表里，匹配会越界到后续区块

    返回 (candidate_lines, warn)：
      - 找到标题 -> (该标题到下个标题之间的行, None)
      - 没找到 -> (None, 警告)  —— 调用方据此严格拒绝
    """
    if scope in ("any", None):
        return lines, None
    # 解析目标标题
    if scope in CATEGORY_HEADERS:
        hdr = _norm(CATEGORY_HEADERS[scope]); target_key = scope
    else:
        hdr = _norm(scope); target_key = scope
    # 候选标题集合：内置预设 + 自定义起止标题（保证"下个标题"边界能算）
    headers = dict(CATEGORY_HEADERS)
    if scope not in CATEGORY_HEADERS:
        headers[scope] = scope
    if scope_end:
        if scope_end in CATEGORY_HEADERS:
            pass
        else:
            headers[scope_end] = scope_end
    secs = sorted(
        [(L["cy"], key) for L in lines
         for key, h in headers.items()
         if _hdr_match(_norm(L["text"]), _norm(h))],
        key=lambda x: x[0],
    )
    idx = next((i for i, (_, k) in enumerate(secs) if k == target_key), None)
    if idx is None:
        return None, f'未找到分类标题「{scope}」，无法限定范围'
    y0 = secs[idx][0]
    y1 = secs[idx + 1][0] if idx + 1 < len(secs) else float("inf")
    cand = [L for L in lines if y0 < L["cy"] < y1]
    return cand, None


def find_text(query, window=None, region=None, min_width=720,
              max_pixels=None, threshold=0.5, return_all=False, scope="any",
              scope_end=None):
    """
    在窗口/区域内 OCR 并模糊匹配目标文本，返回命中行的物理坐标。
    通用盲窗定位：任意应用(游戏/Electron/Qt/Canvas 等 UIA 读不到的)都能用。
    分类场景(如微信搜索同时返回群聊/联系人/聊天记录)用 scope 限定到某区块：
      Ctrl+F 搜索 -> find_text("三jian客", scope="group") -> 只对「群聊」区块匹配

    query      : 目标文本(支持中英文混输、拼音、容忍 OCR 错别字/声调)
    threshold  : 相似度下限，低于则视为未命中
    return_all : True 返回所有 >=threshold 的命中(按分数降序)，否则只返回最佳
    scope      : "any"(整区,默认) | 预设 group/contact/chat_history/official
                 | 或直接传任意标题文字(如 "Results"/"歌曲"/"群聊")，把它当区块标题
                 同名词多、需排除干扰项时，用 scope 把匹配锁在正确分类里

    返回 (best_or_list, meta, error)
      best = {text, score, cx, cy, x1,y1,x2,y2}
    """
    import difflib
    lines, meta, err = ocr_region(window=window, region=region,
                                  min_width=min_width, max_pixels=max_pixels)
    if err:
        return None, meta, err
    if scope and scope != "any":
        lines, wnote = _scope_lines(lines, scope, scope_end=scope_end)
        if lines is None:
            meta["scope_note"] = wnote
            return (lines if return_all else None), meta, None
        meta["scope"] = scope
    nq = _norm(query)
    scored = []
    for L in lines:
        nt = _norm(L["text"])
        if nq and nq == nt:
            sc = 1.0                      # 整行就是目标名，最可信
        elif nq and nt:
            sc = difflib.SequenceMatcher(None, nq, nt).ratio()
        else:
            sc = 0.0
        if sc >= threshold:
            scored.append({"text": L["text"], "score": round(sc, 3),
                            "cx": L["cx"], "cy": L["cy"],
                            "x1": L["x1"], "y1": L["y1"],
                            "x2": L["x2"], "y2": L["y2"]})
    scored.sort(key=lambda d: d["score"], reverse=True)
    if not scored:
        return (scored if return_all else None), meta, None
    return (scored if return_all else scored[0]), meta, None


def click_text(query, window=None, region=None, min_width=720,
               max_pixels=None, threshold=0.5, button="left", double=False,
               verify_title=None, scope="any", scope_end=None):
    """
    OCR 找文本并点击其物理中心。盲窗自动化的核心一步。

    scope / scope_end : 同 find_text（多分类 app 传两者；微信找群 scope="group"）
    verify_title: 若给定(如微信会话标题文字)，点击后截图 OCR 校验标题栏，
                  命中返回 (desc, None)；未命中返回 (desc, "标题校验未命中...")。

    返回 (结果描述, error_or_warning)
      error 为字符串时表示失败；warning 为字符串时表示已点击但校验未过
    """
    import time as _t
    hit, meta, err = find_text(query, window=window, region=region,
                               min_width=min_width, max_pixels=max_pixels,
                               threshold=threshold, scope=scope, scope_end=scope_end)
    if err:
        return None, err
    if not hit:
        return None, f'未找到文本 "{query}"（阈值 {threshold}）'
    _click_point(hit["cx"], hit["cy"], button=button, double=double)
    desc = (f'已点击 "{hit["text"]}" 中心({hit["cx"]:.0f},{hit["cy"]:.0f})，'
            f'OCR分数 {hit["score"]}')
    if verify_title:
        _t.sleep(0.6)
        lines, _, _ = ocr_region(window=window, region="titlebar")
        got = next((L["text"] for L in lines
                    if _norm(verify_title) in _norm(L["text"])), None)
        if got:
            return desc + f'，标题校验通过: "{got}"', None
        return desc + f'，标题校验未命中(实际: {[L["text"] for L in lines[:3]]})', None
    return desc, None


def img_to_b64(img, fmt="PNG"):
    import base64
    buf = io.BytesIO()
    if fmt == "JPEG":
        img.save(buf, format="JPEG", quality=82, optimize=True)
    else:
        img.save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode()


def diff_ratio(img_a, img_b):
    """粗略比较两张截图的差异比例，用于判断操作后界面是否真的变了。"""
    from PIL import ImageChops
    try:
        a = img_a.convert("L").resize((160, 90))
        b = img_b.convert("L").resize((160, 90))
        diff = ImageChops.difference(a, b)
        hist = diff.histogram()
        changed = sum(hist[24:])  # 灰度差 >24 视为有变化
        return changed / float(160 * 90)
    except Exception:
        return -1.0


# ══════════════════════════════════════════════════════════════
# 四级：归一化坐标兜底
# ══════════════════════════════════════════════════════════════

def norm_to_physical(nx, ny, region=None):
    """0~1000 归一化坐标 -> 物理像素。与屏幕分辨率彻底解耦。"""
    if region:
        l, t, r, b = region
        w, h = r - l, b - t
    else:
        l, t = 0, 0
        w, h = screen_size()
    x = int(l + (float(nx) / 1000.0) * w)
    y = int(t + (float(ny) / 1000.0) * h)
    sw, sh = screen_size()
    return max(0, min(x, sw - 1)), max(0, min(y, sh - 1))
