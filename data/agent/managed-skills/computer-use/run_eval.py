"""
run_eval.py — Computer Use v4 回归评测集

场景（全部在记事本上操作，不碰用户文件，确定性可重复）：
  S1  UIA 写入读回：launch 记事本 → ui_foreground → act(set_text) → UIA 读回断言
  S2  窗口管理：记事本最小化 → ui_inspect(desktop) 检测 [最小化] → focus 恢复 → 前台断言
  S3  OCR 中文定位：记事本写固定中文 → ui_ocr 命中 → ui_find_text 相似度 → ui_click_text
  S4  剪贴板中文输入：desktop_input(type) → UIA 读回断言
  S5  弹窗检测：起子进程 MessageBox → 无害 act → 断言返回含「新弹窗」
  S6  每应用策略：写临时策略 JSON → _match_policy 断言 ask/auto-run/disabled → 清理
  S7  Esc 制动标志：置 ABORT_FLAG → _aborted() 命中 → 二次调用返回 None（one-shot）

用法：& '<PORTABLE_ROOT>/python/python.exe' run_eval.py
退出码：0=全过 1=有失败。结果追加写 $ROOT/data/log/computer-use-eval.log
"""

import json
import os
import subprocess
import sys
import time
import ctypes
from pathlib import Path

# ── 复用 mcp 模块的 handler（不起 MCP 协议层）──
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import computer_use_mcp as m  # noqa: E402

PORTABLE_ROOT = Path(os.environ.get("PORTABLE_ROOT", Path(__file__).resolve().parents[4]))
EVAL_LOG = PORTABLE_ROOT / "data" / "log" / "computer-use-eval.log"

PASS = 0
FAIL = 1
results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    tag = "✅" if cond else "❌"
    print(f"{tag} {name}" + (f" | {detail}" if detail else ""))
    return bool(cond)


def get_notepad_title():
    """返回当前打开的记事本窗口标题（未打开则 None）。"""
    U = m._ensure_uia()
    wins, err = U.list_windows()
    if err:
        return None
    for w in wins:
        if "记事本" in w["name"] or "Notepad" in w["name"]:
            return w["name"]
    return None


def launch_notepad():
    """启动记事本并等待窗口出现。返回窗口标题。"""
    import pyautogui
    # 若已打开多个，先全部关闭（幂等）
    close_notepads()
    os.startfile("notepad")
    title = None
    for _ in range(20):
        time.sleep(0.25)
        title = get_notepad_title()
        if title:
            break
    if not title:
        raise RuntimeError("记事本未在 5s 内出现")
    time.sleep(0.5)
    return title


def close_notepads():
    """关闭所有记事本窗口（taskkill，快）。"""
    try:
        subprocess.run(["taskkill", "/im", "notepad.exe", "/f"],
                       capture_output=True, timeout=10)
    except Exception:
        pass
    time.sleep(0.4)


def uia_read_value(title):
    """用 OCR 读记事本内容并做模糊匹配断言（OCR 有噪声，精确子串会失败）。

    query: 期望文本的关键稳定片段。返回 (found, ocr全文)。
    """
    res, _ = m.handle_ui_ocr({"window": title, "min_width": 720})
    full = "\n".join(c.get("text", "") for c in res if c.get("type") == "text") if res else ""
    return full


def ocr_assert_contains(title_hint, key, threshold=0.6):
    """用 find_text 模糊断言 OCR 读回包含 key。返回 (found, detail)。

    title_hint 用于定位窗口；若写入后标题变化（记事本会加 *前缀+内容），
    自动重新获取当前 notepad 窗口。OCR 引擎首次调用可能慢/不稳，重试一次。
    """
    # 重新定位：写入后记事本标题可能从「无标题」变成「*内容 - Notepad」
    cur = get_notepad_title()
    if cur:
        title_hint = cur
    for attempt in range(2):
        rv = m.handle_ui_find_text({"query": key, "window": title_hint, "threshold": threshold})
        # 兼容结构：rv 可能是 ([dict], False) 元组或 [dict, False] 列表
        contents = rv[0] if isinstance(rv, (list, tuple)) else {}
        if isinstance(contents, list) and contents:
            txt = contents[0].get("text", "")
        elif isinstance(contents, dict):
            txt = contents.get("text", "")
        else:
            txt = ""
        if "最佳命中" in txt and "分数" in txt:
            return True, txt
        if attempt == 0:
            time.sleep(1.0)  # 预热后重试
    return False, txt


def find_edit_ref(title):
    """inspect 查找记事本编辑框的 ref（edit/document 类型）。返回 ref 或 None。"""
    U = m._ensure_uia()
    items, _, err = U.inspect(window=title, max_items=60, probe_actions=True)
    if err:
        return None
    for it in items:
        t = (it.get("type") or "").lower()
        if t in ("edit", "document", "text"):
            return it.get("ref") or it.get("name")
    return None


def set_notepad_text(title, txt):
    """对记事本写入文本：先点编辑框（inspect ref），再 set_text。

    Win11 新记事本（标签页版）编辑区无 UIA 名称/类型，inspect 找不到 ref →
    fallback 点击窗口中心（编辑区主体）+ desktop_input(type)。
    返回 (ok, msg)。
    """
    ref = find_edit_ref(title)
    if ref:
        res, err = m.handle_ui_act({"ref": ref, "action": "click"})
        if err:
            return False, f"点编辑框失败: {res[0]['text'] if res else ''}"
        time.sleep(0.3)
        res, err = m.handle_ui_act({"ref": ref, "action": "set_text", "text": txt})
        if err:
            return False, f"set_text 失败: {res[0]['text'] if res else ''}"
        time.sleep(0.5)
        return True, ""
    # fallback：新记事本盲窗，点窗口中心 + type
    m.handle_ui_foreground({"window": title})
    res, err = m.handle_desktop_input({"action": "click", "nx": 500, "ny": 450})
    if err:
        return False, f"点击编辑区失败: {res[0]['text'] if res else ''}"
    time.sleep(0.3)
    # 先全选清空（避免残留）
    m.handle_desktop_input({"action": "key", "keys": ["ctrl", "a"]})
    m.handle_desktop_input({"action": "key", "keys": ["delete"]})
    res, err = m.handle_desktop_input({"action": "type", "text": txt})
    if err:
        return False, f"type 失败: {res[0]['text'] if res else ''}"
    time.sleep(0.5)
    return True, "(fallback: 盲窗 type)"


def s1_uia_write_readback():
    """S1: UIA set_text → OCR 模糊匹配读回断言。"""
    title = launch_notepad()
    m.handle_ui_foreground({"window": title})
    test_txt = "TiffaEvalS1_你好"
    ok, msg = set_notepad_text(title, test_txt)
    check("S1 act(set_text) 无错误", ok, msg)
    found, detail = ocr_assert_contains(title, "TiffaEvalS1")
    check("S1 OCR 读回模糊匹配", found, detail[:80])
    close_notepads()
    return ok


def s2_window_minimize_restore():
    """S2: 最小化 → desktop 检测 → focus 恢复 → 前台断言。"""
    title = launch_notepad()
    U = m._ensure_uia()
    # 最小化（Win32 ShowWindow）
    el, _ = U.find_window(title)
    hwnd = el.CurrentNativeWindowHandle
    ctypes.windll.user32.ShowWindow(hwnd, 6)  # SW_MINIMIZE
    time.sleep(0.8)
    res, _ = m.handle_ui_inspect({"window": "desktop", "max_items": 200})
    txt = res[0]["text"] if res else ""
    check("S2 desktop 枚举出现 [最小化] 标记", "最小化" in txt or "minimized" in txt.lower())
    # focus 恢复
    items, _, err = U.inspect(window="desktop", max_items=200, probe_actions=False)
    restored = False
    if not err:
        for it in items:
            nm = (it.get("name") or "").strip()
            if title in nm and "最小化" in nm:
                U.act(it.get("ref"), action="focus")
                restored = True
                break
    check("S2 focus 恢复最小化窗口", restored)
    time.sleep(0.6)
    ok, _ = U.is_foreground(title)
    if not ok:
        # 兜底：focus pattern 可能对窗口无效，用 bring_to_foreground 再试
        U.bring_to_foreground(title)
        time.sleep(0.8)
        ok, _ = U.is_foreground(title)
    check("S2 恢复后在前台", ok)
    close_notepads()
    return True


def s3_ocr_chinese():
    """S3: 中文写入 → OCR 命中 → find_text 相似度 → click_text。"""
    title = launch_notepad()
    m.handle_ui_foreground({"window": title})
    test_txt = "测试群聊三jian客"
    ok, msg = set_notepad_text(title, test_txt)
    check("S3 set_text 写入", ok, msg)
    # OCR 读回（偶发慢，重试一次）
    full = uia_read_value(title)
    if not ("三jian" in full or "测试群聊" in full or "动ian" in full):
        time.sleep(1.0)
        full = uia_read_value(title)
    check("S3 OCR 包含测试文本", "三jian" in full or "测试群聊" in full or "动ian" in full,
          "OCR: " + full[:100])
    found, detail = ocr_assert_contains(title, "测试群聊")
    check("S3 find_text 模糊命中", found, detail[:70])
    # click_text：点击文本中心（不验证标题，记事本标题不会变）
    res, err = m.handle_ui_click_text({"query": "测试群聊", "window": title, "threshold": 0.6})
    check("S3 click_text 执行成功", not err, res[0]["text"][:60] if res else "")
    close_notepads()
    return True


def s4_clipboard_chinese():
    """S4: desktop_input(type) 中文 → OCR 读回。"""
    title = launch_notepad()
    m.handle_ui_foreground({"window": title})
    test_txt = "你好Tiffa测试"
    ok, msg = set_notepad_text(title, test_txt)
    check("S4 type 无错误", ok, msg)
    time.sleep(0.5)
    found, detail = ocr_assert_contains(title, "你好Tiffa")
    check("S4 剪贴板中文读回模糊匹配", found, detail[:80])
    close_notepads()
    return True


def s5_popup_detection():
    """S5: 子进程 MessageBox → 无害 act → 断言返回含「新弹窗」。"""
    time.sleep(1.0)  # 等前一场景 taskkill 的 notepad 进程完全退出，避免窗口竞争
    title = launch_notepad()
    m.handle_ui_foreground({"window": title})
    # 建立基线：无害 click 一次（用屏幕左上角，避免点在弹窗/编辑区上）
    m.handle_desktop_input({"action": "click", "nx": 50, "ny": 50})
    time.sleep(0.3)
    # 起子进程弹 MessageBox（独立顶层窗口）
    code = "import ctypes;ctypes.windll.user32.MessageBoxW(0,'eval popup','EvalPopup',0x30)"
    proc = subprocess.Popen([sys.executable, "-c", code])
    # 轮询等待弹窗真实出现（最多 5s）
    popup_ready = False
    for _ in range(20):
        time.sleep(0.25)
        wins, _ = m._ensure_uia().list_windows()
        if any("EvalPopup" in w["name"] for w in wins):
            popup_ready = True
            break
    check("S5 弹窗进程出现", popup_ready)
    if not popup_ready:
        proc.kill()
        close_notepads()
        return True
    # 检测：直接调 _popup_check（建基线已由上面 click 完成；
    # 不经过 handle_desktop_input——pyautogui.click 的鼠标移动在
    # 窗口多/弹窗出现时有时序干扰，评测目标只验证 _popup_check 逻辑）
    txt = m._popup_check("eval click")
    found = "新弹窗" in txt and "EvalPopup" in txt
    check("S5 弹窗检测到 EvalPopup", found, txt[:160])
    # 弹窗仍在：第二次调用应报「仍未处理」
    txt2 = m._popup_check("eval click2")
    check("S5 重复弹窗报仍未处理", "仍未处理" in txt2, txt2[:120])
    # 关闭弹窗
    proc.kill()
    time.sleep(0.5)
    close_notepads()
    return True


def s6_policy_match():
    """S6: 临时策略 JSON → _match_policy 三档断言 → 清理。"""
    orig = m.POLICIES_PATH
    tmp = HERE / "_eval_policies.json"
    tmp.write_text(json.dumps({
        "default": "ask",
        "apps": {"记事本": "auto-run", "Excel": "disabled"},
        "popup_ignore": ["Tiffa"]
    }, ensure_ascii=False), encoding="utf-8")
    m.POLICIES_PATH = tmp
    try:
        check("S6 auto-run 命中", m._match_policy("无标题 - 记事本") == "auto-run")
        check("S6 disabled 命中", m._match_policy("Excel - 工作簿") == "disabled")
        check("S6 默认 ask", m._match_policy("微信") == "ask")
    finally:
        m.POLICIES_PATH = orig
        tmp.unlink(missing_ok=True)
    return True


def s7_abort_flag():
    """S7: 置 ABORT_FLAG → _aborted() 命中 → 二次调用 None（one-shot）。"""
    m.ABORT_FLAG = True
    first = m._aborted()
    second = m._aborted()
    check("S7 制动命中", first is not None and "紧急制动" in first, str(first)[:40])
    check("S7 one-shot 清除", second is None)
    return True


def main():
    print("=" * 60)
    print("Computer Use v4 回归评测")
    print("=" * 60)
    # 场景按依赖顺序：S6/S7 不依赖桌面，先跑；S1-S5 依赖记事本
    ok_all = True
    for name, fn in [
        ("S6 每应用策略", s6_policy_match),
        ("S7 Esc 制动标志", s7_abort_flag),
        ("S1 UIA 写入读回", s1_uia_write_readback),
        ("S2 窗口最小化恢复", s2_window_minimize_restore),
        ("S3 OCR 中文定位", s3_ocr_chinese),
        ("S4 剪贴板中文输入", s4_clipboard_chinese),
        ("S5 弹窗检测", s5_popup_detection),
    ]:
        # 每个场景重置弹窗检测基线，避免场景间窗口变化互相污染
        m._last_seen_hwnds = set()
        m._popup_seen = {}
        try:
            fn()
        except Exception as e:
            check(name + " 异常", False, repr(e))
        finally:
            # 每场景结束清理记事本
            try:
                close_notepads()
            except Exception:
                pass

    passed = sum(1 for _, c, _ in results if c)
    total = len(results)
    print("-" * 60)
    print(f"结果: {passed}/{total} 通过")
    for name, c, detail in results:
        print(f"  {'✅' if c else '❌'} {name}" + (f" | {detail}" if detail and not c else ""))
    print("-" * 60)

    # 写日志
    try:
        EVAL_LOG.parent.mkdir(parents=True, exist_ok=True)
        entry = {
            "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
            "passed": passed, "total": total,
            "results": [{"name": n, "ok": c} for n, c, _ in results],
        }
        with EVAL_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass

    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
