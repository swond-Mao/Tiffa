"""
Computer Use Agent - Tiffa 便携版

使用 mss + Pillow + pyautogui 替代 cua_auto，完全便携零外部依赖。
工作原理:
  1. 截屏 → 发给视觉模型（带 tools 参数）
  2. 模型通过 function calling 返回操作指令
  3. 解析 tool_calls 并执行操作
  4. 将执行结果作为 tool message 返回
  5. 截屏验证 → 循环直到完成

安全机制:
  - Windows MessageBox 二次确认（--force 跳过）
  - ESC 全局中断
  - 操作白名单 + 危险命令拦截
  - 超时自动停止
  - 每步截图存档 + JSONL 审计日志
"""

import argparse
import base64
import ctypes
import io
import json
import os
import signal
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

import mss
import pyautogui
from PIL import Image

# === 安全配置 ===
FORBIDDEN_COMMANDS = [
    "format", "del /s", "rmdir /s", "rd /s",
    "shutdown", "restart",
    "regedit", "reg",
    "taskkill /f /im explorer",
    "taskkill /f /im dwm",
    "taskkill /f /im csrss",
    "taskkill /f /im lsass",
    "taskkill /f /im services",
]

DANGEROUS_KEYWORDS = [
    "format", "格式化",
    "shutdown", "restart", "关机", "重启",
    "regedit", "注册表",
]

# === 工具定义 (OpenAI function calling 格式) ===
COMPUTER_TOOL = {
    "type": "function",
    "function": {
        "name": "computer",
        "description": "Control the Windows desktop - click, type, press keys, launch apps, etc.",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["click", "double_click", "right_click", "type", "key",
                             "scroll", "move", "shell", "wait", "done"],
                    "description": "The action to perform on the desktop"
                },
                "x": {"type": "integer", "description": "X coordinate (pixels, top-left is 0,0)"},
                "y": {"type": "integer", "description": "Y coordinate (pixels, top-left is 0,0)"},
                "button": {"type": "string", "enum": ["left", "right", "middle"], "description": "Mouse button"},
                "text": {"type": "string", "description": "Text to type (for 'type' action)"},
                "keys": {
                    "oneOf": [
                        {"type": "string", "description": "Single key name like 'enter', 'tab'"},
                        {"type": "array", "items": {"type": "string"}, "description": "Key combo like ['ctrl','c']"}
                    ],
                    "description": "Key or key combination (for 'key' action)"
                },
                "dx": {"type": "integer", "description": "Horizontal scroll amount"},
                "dy": {"type": "integer", "description": "Vertical scroll amount (positive=down)"},
                "command": {"type": "string", "description": "Program to launch (for 'shell' action)"},
                "ms": {"type": "integer", "description": "Milliseconds to wait (for 'wait' action)"},
                "message": {"type": "string", "description": "Completion message (for 'done' action)"},
            },
            "required": ["action"]
        }
    }
}

TOOLS = [COMPUTER_TOOL]

# === 系统提示词 ===
SYSTEM_PROMPT = """You are a Windows desktop automation agent. You can see screenshots and control the computer.

Instructions:
1. Observe the screenshot carefully before acting
2. Coordinates are in pixels, top-left corner is (0, 0), bottom-right is (screen_width, screen_height)
3. After each action, you'll see a new screenshot to verify the result
4. Use the `computer` tool for every action
5. When the task is complete, use action="done" with a message

IMPORTANT workflow tips:
- To open an app: use shell action (e.g. action="shell", command="notepad.exe")
- After launching an app, it usually has focus — TYPE DIRECTLY, no need to click first
- If you need to click, provide REALISTIC pixel coordinates (NEVER use 0,0 — that's the corner)
- For single keys: action="key", keys="enter" (string)
- For key combos: action="key", keys=["ctrl","c"] (array)
- To type text: action="type", text="your text here"
- When done: action="done", message="description"

CRITICAL: Do NOT click (0,0). If you want to focus a window, try typing or using Alt+Tab instead.

Respond in Chinese (中文)."""


# === 全局中断标志 ===
_interrupted = False


def _esc_handler(signum=None, frame=None):
    """ESC 全局中断处理"""
    global _interrupted
    _interrupted = True
    print("\n[ESC] 用户中断！正在停止...")


def _check_keyboard_interrupt():
    """非阻塞检查键盘（ESC 中断）"""
    global _interrupted
    try:
        import msvcrt
        if msvcrt.kbhit():
            key = msvcrt.getch()
            if key == b'\x1b':  # ESC
                _interrupted = True
    except Exception:
        pass
    return _interrupted


def show_confirm_box(task: str) -> bool:
    """Windows MessageBox 二次确认"""
    MB_YESNO = 0x4
    MB_ICONWARNING = 0x30
    MB_DEFBUTTON2 = 0x100  # 默认选"否"
    MB_SETFOREGROUND = 0x10000

    message = (
        f"Tiffa Computer Use 即将控制您的桌面\n\n"
        f"任务：{task}\n\n"
        f"按 ESC 随时中断\n"
        f"此操作将控制鼠标和键盘"
    )
    title = "Computer Use 确认"

    result = ctypes.windll.user32.MessageBoxW(
        0, message, title,
        MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2 | MB_SETFOREGROUND
    )
    return result == 6  # IDYES


def check_dangerous(task: str) -> list:
    """检查任务描述中的危险关键词"""
    found = []
    task_lower = task.lower()
    for kw in DANGEROUS_KEYWORDS:
        if kw in task_lower:
            found.append(kw)
    return found


class ComputerUseAgent:
    """Computer Use Agent - 便携版"""

    def __init__(
        self,
        api_base: str = "http://127.0.0.1:11434/v1",
        api_key: str = "sk-no-key",
        model: str = "I-Compact",
        max_steps: int = 20,
        screenshot_delay: float = 1.5,
        screenshot_dir: str = None,
        verbose: bool = False,
    ):
        self.api_base = api_base
        self.api_key = api_key
        self.model = model
        self.max_steps = max_steps
        self.screenshot_delay = screenshot_delay
        self.verbose = verbose
        self.step_count = 0

        # 截图存档目录
        if screenshot_dir:
            self.screenshot_dir = Path(screenshot_dir)
        else:
            ts = datetime.now().strftime("%Y-%m-%d_%H%M%S")
            self.screenshot_dir = Path("computer-use-logs") / ts
        self.screenshot_dir.mkdir(parents=True, exist_ok=True)

        # 审计日志
        self.audit_log_path = self.screenshot_dir / "audit.jsonl"

        # pyautogui 安全设置
        pyautogui.FAILSAFE = True
        pyautogui.PAUSE = 0.1

    def _log_audit(self, step: int, action: str, detail: dict, result: str):
        """写入审计日志"""
        entry = {
            "step": step,
            "action": action,
            "detail": detail,
            "result": result,
            "ts": datetime.now().isoformat(),
        }
        with open(self.audit_log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    def _call_llm(self, messages: list) -> dict:
        """调用本地 LLM"""
        req = {
            "model": self.model,
            "messages": messages,
            "tools": TOOLS,
            "tool_choice": "auto",
            "max_tokens": 1024,
            "temperature": 0.1,
        }
        data = json.dumps(req).encode()
        req_obj = urllib.request.Request(
            f"{self.api_base}/chat/completions",
            data=data,
            headers={"Content-Type": "application/json"},
        )
        resp = urllib.request.urlopen(req_obj, timeout=180)
        return json.loads(resp.read().decode())

    def _screenshot_b64(self) -> str:
        """截屏并返回 base64（mss + Pillow）"""
        with mss.MSS() as sct:
            monitor = sct.monitors[0]
            shot = sct.grab(monitor)
            # mss -> PIL Image
            img = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            return base64.b64encode(buf.getvalue()).decode()

    def _screen_size(self) -> tuple:
        """获取屏幕尺寸"""
        with mss.MSS() as sct:
            m = sct.monitors[0]
            return m["width"], m["height"]

    def _save_screenshot(self, step: int, tag: str = "") -> str:
        """保存截图到存档目录"""
        with mss.MSS() as sct:
            monitor = sct.monitors[0]
            shot = sct.grab(monitor)
            img = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
            fname = f"step_{step:03d}"
            if tag:
                fname += f"_{tag}"
            fpath = self.screenshot_dir / f"{fname}.png"
            img.save(fpath)
            return str(fpath)

    def _execute_action(self, action: dict) -> str:
        """执行操作并返回结果描述"""
        atype = action.get("action", "")
        # 兼容模型返回的 left_click/right_click/middle_click
        atype_map = {"left_click": "click", "right_click": "right_click", "middle_click": "click"}
        atype = atype_map.get(atype, atype)
        try:
            if atype == "click":
                x = int(action.get("x", 0))
                y = int(action.get("y", 0))
                btn = action.get("button", "left")
                # 拦截无效的 (0,0) 坐标点击
                if x == 0 and y == 0:
                    return "点击 (0, 0) 被跳过 — 坐标无效。请提供正确的屏幕坐标，或尝试直接输入文字/使用键盘操作。"
                sw, sh = self._screen_size()
                x = max(0, min(x, sw - 1))
                y = max(0, min(y, sh - 1))
                pyautogui.click(x, y, button=btn)
                return f"点击 ({x}, {y}) [{btn}]"

            elif atype == "double_click":
                x, y = int(action["x"]), int(action["y"])
                pyautogui.doubleClick(x, y)
                return f"双击 ({x}, {y})"

            elif atype == "right_click":
                x, y = int(action["x"]), int(action["y"])
                pyautogui.rightClick(x, y)
                return f"右键 ({x}, {y})"

            elif atype == "type":
                text = str(action.get("text", ""))
                pyautogui.typewrite(text, interval=0.02)
                return f"输入: {text[:50]}"

            elif atype == "key":
                keys = action.get("keys")
                # 规范化 keys：支持字符串、列表、JSON字符串等格式
                if isinstance(keys, str):
                    if keys.startswith("["):
                        try:
                            keys = json.loads(keys)
                        except json.JSONDecodeError:
                            pass
                    if isinstance(keys, str):
                        if "+" in keys:
                            keys = [k.strip() for k in keys.split("+")]
                        else:
                            keys = [keys]
                if isinstance(keys, list):
                    keys = [str(k).strip() for k in keys if k]

                if len(keys) > 1:
                    pyautogui.hotkey(*keys)
                    return f"组合键: {'+'.join(keys)}"
                elif len(keys) == 1:
                    pyautogui.press(keys[0])
                    return f"按键: {keys[0]}"
                else:
                    return "key 操作: 空按键列表"

            elif atype == "scroll":
                dx = int(action.get("dx", 0))
                dy = int(action.get("dy", 0))
                # pyautogui.scroll 的 clicks 参数：正值向上，负值向下
                if dy != 0:
                    pyautogui.scroll(dy)
                return f"滚动 dx={dx}, dy={dy}"

            elif atype == "move":
                x, y = int(action["x"]), int(action["y"])
                pyautogui.moveTo(x, y)
                return f"移动到 ({x}, {y})"

            elif atype == "wait":
                ms = int(action.get("ms", 1000))
                time.sleep(ms / 1000)
                return f"等待 {ms}ms"

            elif atype == "shell":
                cmd = str(action.get("command", ""))
                if not cmd:
                    return "shell 命令为空"
                # 危险命令拦截
                cmd_lower = cmd.lower()
                for forbidden in FORBIDDEN_COMMANDS:
                    if forbidden in cmd_lower:
                        return f"命令被拦截: '{cmd}' 包含禁止操作 '{forbidden}'"
                os.startfile(cmd)
                time.sleep(3)
                return f"启动: {cmd}"

            elif atype == "done":
                msg = action.get("message", "任务完成")
                return f"[完成] {msg}"

            else:
                return f"未知操作: {atype}"

        except pyautogui.FailSafeException:
            return "[安全] 鼠标移到屏幕角落，Failsafe 触发，操作已中断"
        except Exception as e:
            return f"执行失败: {e}"

    def _extract_tool_call_args(self, message: dict) -> dict | None:
        """从 tool_calls 中提取 action 参数"""
        tool_calls = message.get("tool_calls", [])
        if not tool_calls:
            return None
        tc = tool_calls[0]
        func = tc.get("function", {})
        args_str = func.get("arguments", "{}")
        try:
            args = json.loads(args_str) if isinstance(args_str, str) else args_str
            return args
        except json.JSONDecodeError:
            return None

    def run(self, task: str) -> dict:
        """执行任务，返回结果字典"""
        print(f"\n[任务] {task}")
        print(f"[存档] {self.screenshot_dir}")
        print("=" * 60)

        last_result = ""
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
        ]

        for step in range(1, self.max_steps + 1):
            # 检查中断
            if _interrupted:
                print("[中断] 用户按 ESC 中断")
                return {"success": False, "steps": step - 1, "message": "用户按ESC中断"}

            if self.verbose:
                print(f"\n--- 步骤 {step}/{self.max_steps} ---")

            # 1. 截屏
            img_b64 = self._screenshot_b64()
            self._save_screenshot(step, "before")
            if self.verbose:
                print(f"  截屏完成 ({len(img_b64)} chars)")

            # 2. 构造用户消息
            screen_w, screen_h = self._screen_size()
            if step == 1:
                user_text = f"任务: {task}\n\n屏幕分辨率: {screen_w}x{screen_h}\n请观察屏幕截图，使用 computer 工具执行下一步操作。"
            else:
                user_text = f"上一步操作结果: {last_result}\n\n屏幕分辨率: {screen_w}x{screen_h}\n请观察新的屏幕截图，继续执行任务。如果任务已完成，使用 done 操作。"

            messages.append({
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}"}},
                    {"type": "text", "text": user_text},
                ]
            })

            # 3. 调用 LLM
            if self.verbose:
                print(f"  思考中...", end="", flush=True)

            try:
                result = self._call_llm(messages)
            except Exception as e:
                if self.verbose:
                    print(f" 失败")
                    print(f"  [错误] API 调用失败: {e}")
                return {"success": False, "steps": step, "message": f"API调用失败: {e}"}

            if self.verbose:
                print(f" 完成")

            # 4. 解析响应
            choice = result.get("choices", [{}])[0]
            msg = choice.get("message", {})
            content = msg.get("content", "") or ""
            reasoning = msg.get("reasoning_content", "") or ""

            if self.verbose and reasoning:
                summary = reasoning[:120].replace("\n", " ")
                print(f"  [思考] {summary}...")

            # 5. 检查是否有 tool_calls
            action = self._extract_tool_call_args(msg)

            if action is None:
                # 没有工具调用，纯文本回复
                if self.verbose:
                    print(f"  [文本回复] {content[:200]}")
                if "done" in content.lower() or "完成" in content:
                    if self.verbose:
                        print("=" * 60)
                        print(f"[完成] (从文本判断) {content[:100]}")
                    return {"success": True, "steps": step, "message": content[:100]}

                messages.append({"role": "assistant", "content": content or "（空回复）"})
                messages.append({
                    "role": "user",
                    "content": "请使用 computer 工具来执行操作，而不是用文字描述。调用 computer 工具来控制桌面。"
                })
                continue

            # 6. 有 tool_call，记录 assistant 消息
            messages.append(msg)

            # 7. 执行操作
            self.step_count += 1
            result_text = self._execute_action(action)

            if self.verbose:
                print(f"  [操作] {result_text}")

            # 审计日志
            self._log_audit(step, action.get("action", "?"), action, result_text)

            # 8. 添加 tool 消息
            tool_call_id = msg["tool_calls"][0].get("id", "call_0") if msg.get("tool_calls") else "call_0"
            messages.append({
                "role": "tool",
                "tool_call_id": tool_call_id,
                "content": result_text,
            })

            last_result = result_text

            # 9. 检查是否完成
            if action.get("action") == "done":
                print("=" * 60)
                print(f"[完成] {action.get('message', '')}")
                return {"success": True, "steps": self.step_count, "message": action.get("message", "")}

            # 等待界面更新
            time.sleep(self.screenshot_delay)

        print("=" * 60)
        print(f"[达到最大步数限制] {self.max_steps}")
        return {"success": False, "steps": self.max_steps, "message": f"达到最大步数限制 {self.max_steps}"}


def cmd_run(args):
    """执行任务"""
    task = args.task

    # 检查危险操作
    dangers = check_dangerous(task)
    if dangers:
        print(f"[拦截] 任务包含危险关键词: {', '.join(dangers)}")
        print(f"RESULT:{json.dumps({'success': False, 'steps': 0, 'message': f'任务包含禁止操作: {dangers}'}, ensure_ascii=False)}")
        return

    # Windows MessageBox 二次确认
    if not args.force:
        if not show_confirm_box(task):
            print("[取消] 用户取消操作")
            print(f"RESULT:{json.dumps({'success': False, 'steps': 0, 'message': '用户取消'}, ensure_ascii=False)}")
            return

    # 设置 ESC 中断
    signal.signal(signal.SIGINT, _esc_handler)

    # 创建 Agent 并执行
    agent = ComputerUseAgent(
        api_base=args.api_base,
        model=args.model,
        max_steps=args.max_steps,
        screenshot_dir=args.screenshot_dir,
        verbose=args.verbose,
    )

    start_time = time.time()

    # 超时控制（Windows 兼容：用 threading.Timer）
    timeout_expired = [False]

    def timeout_handler():
        timeout_expired[0] = True
        print(f"\n[超时] 任务超时 ({args.timeout}秒)")

    timer = None
    if args.timeout > 0:
        timer = __import__("threading").Timer(args.timeout, timeout_handler)
        timer.daemon = True
        timer.start()

    try:
        result = agent.run(task)
        if timeout_expired[0]:
            result = {"success": False, "steps": agent.step_count, "message": f"任务超时 ({args.timeout}秒)"}
    except KeyboardInterrupt:
        result = {"success": False, "steps": agent.step_count, "message": "用户中断"}
    finally:
        if timer:
            timer.cancel()

    elapsed = time.time() - start_time
    result["elapsed"] = round(elapsed, 1)
    result["logs"] = str(agent.screenshot_dir)

    print(f"\nRESULT:{json.dumps(result, ensure_ascii=False)}")
    print(f"LOGS:{agent.screenshot_dir}")


def cmd_screenshot(args):
    """单次截图"""
    with mss.MSS() as sct:
        monitor = sct.monitors[0]
        shot = sct.grab(monitor)
        img = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
        output = args.output or "screenshot.png"
        img.save(output)
        print(f"截图已保存: {output} ({shot.size[0]}x{shot.size[1]})")


def cmd_version(args):
    """版本信息"""
    print("Tiffa Computer Use v1.0")
    print(f"Python: {sys.version}")
    print(f"mss: {mss.__version__}")
    print(f"Pillow: {Image.__version__}")


def main():
    parser = argparse.ArgumentParser(description="Tiffa Computer Use - AI 桌面自动化")
    subparsers = parser.add_subparsers(dest="command", help="子命令")

    # run 子命令
    run_parser = subparsers.add_parser("run", help="执行完整任务循环")
    run_parser.add_argument("task", type=str, help="任务描述")
    run_parser.add_argument("--max-steps", type=int, default=20, help="最大步数 (默认 20)")
    run_parser.add_argument("--timeout", type=int, default=300, help="超时秒数 (默认 300)")
    run_parser.add_argument("--model", type=str, default="I-Compact", help="VLM 模型名称")
    run_parser.add_argument("--api-base", type=str, default="http://127.0.0.1:11434/v1", help="LLM API 地址")
    run_parser.add_argument("--screenshot-dir", type=str, default=None, help="截图存档目录")
    run_parser.add_argument("--force", action="store_true", help="跳过 MessageBox 确认")
    run_parser.add_argument("--verbose", action="store_true", help="详细输出")
    run_parser.set_defaults(func=cmd_run)

    # screenshot 子命令
    ss_parser = subparsers.add_parser("screenshot", help="单次截图")
    ss_parser.add_argument("--output", type=str, default=None, help="输出路径")
    ss_parser.set_defaults(func=cmd_screenshot)

    # version 子命令
    ver_parser = subparsers.add_parser("version", help="版本信息")
    ver_parser.set_defaults(func=cmd_version)

    args = parser.parse_args()
    if hasattr(args, "func"):
        args.func(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
