#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
craftman — 多 skill 工作流编排器
规划由 AI 提供方案 JSON，craftman 只做执行和合并。
不依赖外部 LLM 服务。
"""

import os, sys, json, re, subprocess, shutil
from pathlib import Path
import urllib.parse

SKILL_DIR = Path(__file__).parent
OUT_DIR = Path(os.getcwd()) / "output"  # 输出到当前项目目录，不是技能目录
SKILLS_DIR = SKILL_DIR.parent

# === Available skills registry ===
SKILLS = {
    "pptgen": {
        "path": str(SKILLS_DIR / "pptgen" / "pptgen.py"),
        "description": "生成交互式 HTML PPT",
        "output_type": "html",
        "invoke": "cli",
        "prompt_hint": "一句话描述PPT需求，包含主题、受众、页数建议"
    },
    "comfyui": {
        "path": str(SKILLS_DIR / "comfyui-image-gen" / "comfy.py"),
        "description": "AI 生图（写实/艺术/文字排版/人物肖像/编辑）",
        "output_type": "png",
        "invoke": "cli",
        "prompt_hint": "详细图片描述，包含主体/光影/构图/风格要求"
    },
    "canvas-design": {
        "path": str(SKILLS_DIR / "canvas-design" / "SKILL.md"),
        "description": "代码绘制的视觉设计（几何/排版/抽象艺术海报），非AI生图",
        "output_type": "png|pdf|svg|html",
        "invoke": "llm",
        "prompt_hint": "设计需求描述"
    }
}

# ── helpers ─────────────────────────────

def eprint(*a, **kw):
    print(*a, file=sys.stderr, **kw, flush=True)


# ── Step 1: Plan (AI-provided) ─────────

TEMPLATE_PLAN = {
    "analysis": "由 AI 提供需求分析",
    "user_decisions": {
        "gen_image": False,
        "image_style": "",
        "theme": "",
        "confirmed": False
    },
    "plan": [],
    "merge_instruction": "由 AI 提供合并方案"
}

# 弱模型防呆：关键决策字段，AI 不能代填，必须由用户亲手输入
THEMES = ["neumorphism", "aurora", "code", "glass-candy", "chromatic",
          "dark-atlas", "research-white", "black-gold", "navy-magazine",
          "gold-index", "growth", "sonic-neon"]


def validate_plan_structure(plan_data):
    """校验 plan 结构（plan 非空、每步有 skill/prompt）。
    结构错误无法通过交互修复，直接退出（返回码 2）。"""
    errors = []
    plan = plan_data.get("plan", [])
    if not isinstance(plan, list) or not plan:
        errors.append("plan 为空（至少需要一个步骤）")
    else:
        for step in plan:
            if not step.get("skill"):
                errors.append(f"步骤 {step.get('step', '?')} 缺少 skill")
            if not step.get("prompt"):
                errors.append(f"步骤 {step.get('step', '?')} 缺少 prompt")
    if errors:
        eprint("[craftman] ⛔ plan 结构校验失败，拒绝执行：")
        for e in errors:
            eprint(f"  - {e}")
        sys.exit(2)


def check_decisions(plan_data):
    """返回缺失的决策项列表（可交互修复）。"""
    missing = []
    ud = plan_data.get("user_decisions")
    if not isinstance(ud, dict):
        return ["gen_image", "image_style", "theme", "confirmed"]
    if "gen_image" not in ud:
        missing.append("gen_image")
    elif ud.get("gen_image") is True and not ud.get("image_style"):
        missing.append("image_style")
    if "theme" not in ud or not ud.get("theme"):
        missing.append("theme")
    if "confirmed" not in ud or ud.get("confirmed") is not True:
        missing.append("confirmed")
    return missing


def collect_decisions(plan_data):
    """交互式采集缺失的决策。用户亲手 input() 输入，AI 无法代答。
    返回合并后的完整 user_decisions dict。"""
    ud = dict(plan_data.get("user_decisions") or {})
    missing = check_decisions(plan_data)

    print("\n[craftman] ⚠ plan.json 缺少关键决策，需要你亲手确认（AI 无法代答）：")

    if "gen_image" in missing:
        while True:
            ch = input("  要不要生成图片？(y/n): ").strip().lower()
            if ch in ("y", "yes"):
                ud["gen_image"] = True
                break
            if ch in ("n", "no"):
                ud["gen_image"] = False
                break
            print("    请输入 y 或 n")

    if ud.get("gen_image") is True and "image_style" in missing:
        while True:
            st = input("  选生图风格 (krea2/ernie/klein/zimage): ").strip().lower()
            if st in ("krea2", "ernie", "klein", "zimage"):
                ud["image_style"] = st
                break
            print("    请输入 krea2/ernie/klein/zimage")
    elif ud.get("gen_image") is False and "image_style" not in ud:
        ud["image_style"] = ""

    if "theme" in missing:
        while True:
            t = input(f"  选 HTML 主题 ({'/'.join(THEMES)}): ").strip().lower()
            if t in THEMES:
                ud["theme"] = t
                break
            print("    无效主题，请从列表中选择")

    if "confirmed" in missing:
        while True:
            ch = input("  确认执行此方案？(Y/n): ").strip().lower()
            if ch in ("", "y", "yes"):
                ud["confirmed"] = True
                break
            if ch in ("n", "no"):
                ud["confirmed"] = False
                break
            print("    请输入 Y 或 n")

    print("[craftman] 决策已采集：" + json.dumps(ud, ensure_ascii=False))
    return ud


# ── Step 2: Show ───────────────────────

def show_plan(plan_data):
    print("\n" + "=" * 60)
    print("需求分析")
    print("=" * 60)
    print(plan_data.get("analysis", "(无分析)"))
    print("\n" + "=" * 60)
    print("执行方案")
    print("=" * 60)
    for step in plan_data.get("plan", []):
        print(f"\n  步骤 {step.get('step', '?')}: [{step.get('skill', '?')}]")
        print(f"    原因: {step.get('reason', '')}")
        prompt = step.get("prompt", "")
        if len(prompt) > 120:
            prompt = prompt[:120] + "..."
        print(f"    提示: {prompt}")
    print("\n" + "-" * 60)
    print(f"合并方案: {plan_data.get('merge_instruction', '(无)')}")
    print("-" * 60)


def confirm():
    while True:
        ch = input("\n是否执行此方案？(Y/n/skip): ").strip().lower()
        if ch in ("", "y", "yes"):
            return True
        if ch in ("n", "no"):
            return False
        if ch == "skip":
            return "skip"


# ── Step 3: Execute ────────────────────

def exec_step(step, out_dir):
    skill = step.get("skill", "")
    prompt = step.get("prompt", "")
    params = step.get("params", {})

    if skill == "pptgen":
        return exec_pptgen(prompt, params, out_dir)
    elif skill == "comfyui":
        return exec_comfyui(prompt, params, out_dir)
    elif skill == "canvas-design":
        return exec_canvas(prompt, params, out_dir)
    else:
        eprint(f"[craftman] unknown skill: {skill}")
        return None


def exec_pptgen(prompt, params, out_dir):
    pptgen_py = SKILLS["pptgen"]["path"]
    if not os.path.isfile(pptgen_py):
        eprint(f"[craftman] pptgen not found: {pptgen_py}")
        return None

    style = params.get("style", "magazine")
    pages = params.get("pages", 0)
    content_file = params.get("content_file", "")

    safe_name = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff_-]", "_", prompt)[:30]
    out_path = out_dir / f"{safe_name}.html"

    if content_file and os.path.isfile(content_file):
        # AI 已生成内容 JSON，直接用 cache 模式跳过 LLM
        cmd = [sys.executable, pptgen_py, "",
               "--style", style,
               "--output", str(out_path),
               "--no-image",
               "--cache", content_file]
    else:
        # 无预生成内容，回退到 LLM 模式（可能失败）
        cmd = [sys.executable, pptgen_py, prompt,
               "--style", style,
               "--output", str(out_path),
               "--no-image"]
    if pages:
        cmd += ["--pages", str(pages)]

    eprint(f"[craftman]  > pptgen {' '.join(cmd[-5:])}")
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        eprint(f"[craftman] pptgen failed: {r.stderr[:300]}")
        return None

    eprint(f"[craftman]  pptgen done: {out_path}")
    return str(out_path)


def exec_comfyui(prompt, params, out_dir):
    comfy_py = SKILLS["comfyui"]["path"]
    if not os.path.isfile(comfy_py):
        eprint(f"[craftman] comfy.py not found: {comfy_py}")
        return None

    style = params.get("style", "krea2") or "krea2"
    size = params.get("size", "")
    safe_name = params.get("name", "craftman")

    cmd = [sys.executable, comfy_py, style, prompt, "--name", safe_name]
    if size:
        cmd += ["--size", size]
    cmd += ["--output", str(out_dir)]

    eprint(f"[craftman]  > comfy {style}")
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if r.returncode != 0:
        eprint(f"[craftman] comfy failed: {r.stderr[:200]}")
        return None

    for line in r.stdout.splitlines():
        if line.startswith("RESULT:"):
            paths = json.loads(line[7:])
            if paths:
                src = paths[0]
                dst = out_dir / os.path.basename(src)
                try:
                    shutil.copy2(src, dst)
                except Exception:
                    dst = Path(src)
                eprint(f"[craftman]  comfy done: {dst}")
                return str(dst)
    return None


def exec_canvas(prompt, params, out_dir):
    """canvas-design: AI 先用 Write 工具生成 HTML 文件，
    craftman 将其复制到输出目录。同时扫描 HTML 中引用的本地图片，
    一并复制到输出目录并重写路径，避免移动后图片 404。"""
    src_file = params.get("html_file", "")

    if not src_file:
        eprint("[craftman] canvas-design 需要 html_file 参数指向 AI 已生成的 HTML 文件")
        return None

    src_path = Path(src_file)
    if not src_path.is_file():
        eprint(f"[craftman] html_file 不存在: {src_file}")
        return None

    safe_name = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff_-]", "_", prompt)[:20] or "canvas"
    out_path = out_dir / f"{safe_name}.html"

    # 读取 HTML，扫描并复制引用的本地图片到 out_dir，重写路径为相对路径
    html_content = src_path.read_text(encoding="utf-8")
    src_dir = src_path.parent
    # 匹配 src="..." 和 url(...) 中的本地路径（不含 http:// 或 data:）
    img_pattern = re.compile(r'''(src=|url\()["']?((?!https?://|data:|//)[^"')\s]+)["']?''')

    def copy_asset(m):
        prefix = m.group(1)  # "src=" 或 "url("
        ref = m.group(2)     # 图片路径
        # 跳过绝对路径（C:\... 或 /usr/...）
        if re.match(r'^[A-Za-z]:[\\/]', ref) or ref.startswith('/'):
            return m.group(0)
        asset_src = (src_dir / ref).resolve()
        if asset_src.is_file():
            asset_dst = out_dir / asset_src.name
            if asset_dst.resolve() != asset_src:
                try:
                    shutil.copy2(asset_src, asset_dst)
                    eprint(f"[craftman]  复制资源: {asset_src.name}")
                except Exception as e:
                    eprint(f"[craftman]  复制资源失败 {asset_src.name}: {e}")
            # 重写为相对于 out_dir 的文件名
            return f'{prefix}"{asset_src.name}"'
        return m.group(0)

    html_content = img_pattern.sub(copy_asset, html_content)
    out_path.write_text(html_content, encoding="utf-8")
    eprint(f"[craftman]  canvas done: {out_path}")
    return str(out_path)


# ── Step 4: Merge ──────────────────────

def merge(plan_data, results, out_dir):
    plan = plan_data.get("plan", [])

    eprint(f"\n[craftman] 合并输出...")
    outputs = []

    # 按 plan 顺序收集各 skill 结果（results 以步骤序号为 key，同 skill 多步骤不再覆盖）
    by_skill = {}
    for step in plan:
        sn = step.get("step", 0)
        sname = step.get("skill", "?")
        result = results.get(sn)
        if result:
            by_skill.setdefault(sname, []).append(result)
            outputs.append(f"  [{sname}] {result}")

    pptgen_outs = by_skill.get("pptgen", [])
    canvas_outs = by_skill.get("canvas-design", [])
    comfyui_outs = by_skill.get("comfyui", [])

    # canvas + pptgen → embed canvas into cover（取第一个组合）
    if pptgen_outs and canvas_outs:
        pptgen_out, canvas_out = pptgen_outs[0], canvas_outs[0]
        if os.path.isfile(pptgen_out) and os.path.isfile(canvas_out):
            eprint("[craftman]  检测到 pptgen + canvas-design，尝试嵌入封面...")
            try:
                with open(pptgen_out, "r", encoding="utf-8") as f:
                    html = f.read()
                canvas_rel = os.path.relpath(canvas_out, os.path.dirname(pptgen_out))
                cover_iframe = f'<iframe src="{canvas_rel}" style="width:100%;height:100%;border:none;position:absolute;top:0;left:0;z-index:0"></iframe>'
                html = html.replace('<div class="slide slide-cover',
                                    f'<div class="slide slide-cover" style="position:relative;overflow:hidden">{cover_iframe}<div style="position:relative;z-index:1"')

                merged_path = out_dir / "merged.html"
                with open(merged_path, "w", encoding="utf-8") as f:
                    f.write(html)
                outputs.append(f"  [merged] {merged_path}")
                eprint(f"[craftman]  封面已嵌入: {merged_path}")
            except Exception as e:
                eprint(f"[craftman]  合并失败: {e}")

    # comfyui 图片逐张复制到 pptgen 目录和/或 canvas-design 目录
    copy_targets = []
    for pptgen_out in pptgen_outs:
        copy_targets.append(Path(pptgen_out).parent)
    for canvas_out in canvas_outs:
        copy_targets.append(Path(canvas_out).parent)
    for comfyui_out in comfyui_outs:
        if os.path.isfile(comfyui_out):
            for target_dir in set(copy_targets):
                try:
                    shutil.copy2(comfyui_out, target_dir / os.path.basename(comfyui_out))
                    eprint(f"[craftman]  图片已复制到 {target_dir.name}")
                except Exception as e:
                    eprint(f"[craftman]  复制图片到 {target_dir.name} 失败: {e}")

    print("\n" + "=" * 60)
    print("输出汇总")
    print("=" * 60)
    for o in outputs:
        print(o)
    print()
    print("可点击链接（session_server 4097 服务）:")
    for step in plan:
        sn = step.get("step", 0)
        result = results.get(sn)
        if result and os.path.isfile(result):
            url = "http://localhost:4097/srv/" + urllib.parse.quote(result.replace("\\", "/"))
            print(f"  🔗 [{os.path.basename(result)}]({url})")
    print()
    return outputs


# ── Main ───────────────────────────────

def main():
    import argparse
    ap = argparse.ArgumentParser(description="craftman — 多 skill 工作流编排器")
    ap.add_argument("request", nargs="?", default="", help="需求描述（仅显示用）")
    ap.add_argument("--plan-file", default="", help="从JSON文件加载方案")
    ap.add_argument("--plan-json", default="", help="直接传入 JSON 方案字符串")
    ap.add_argument("--no-confirm", action="store_true", help="跳过确认，直接执行")
    ap.add_argument("--output", default="", help="输出目录（默认 craftman/output）")
    ap.add_argument("--list-skills", action="store_true", help="列出可用技能")
    args = ap.parse_args()

    if args.list_skills:
        print("可用技能:")
        for name, info in SKILLS.items():
            print(f"  {name}: {info['description']} ({info['invoke']})")
        return

    out_dir = Path(args.output) if args.output else OUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    # Step 1: Load plan
    if args.plan_json:
        plan_data = json.loads(args.plan_json)
        eprint(f"[craftman] 已加载 inline 方案")
    elif args.plan_file:
        with open(args.plan_file, "r", encoding="utf-8") as f:
            plan_data = json.load(f)
        eprint(f"[craftman] 已加载方案: {args.plan_file}")
    else:
        print("错误: 必须通过 --plan-file 或 --plan-json 提供方案")
        print("方案由 AI 根据需求生成，craftman 只做执行。")
        sys.exit(1)

    # 弱模型防呆：先校验结构（错误退出），再检查决策（缺失则交互采集）
    validate_plan_structure(plan_data)
    missing = check_decisions(plan_data)
    if missing:
        plan_data["user_decisions"] = collect_decisions(plan_data)
        if plan_data.get("user_decisions", {}).get("confirmed") is not True:
            print("用户未确认，已取消")
            return

    # 打印 checklist 提醒（若存在）
    checklist_path = Path(os.getcwd()) / ".craftman" / "checklist.md"
    if checklist_path.is_file():
        eprint(f"\n[craftman] 检测到 checklist: {checklist_path}")
        eprint("[craftman] 请确认 AI 已逐项打勾：生图？风格？主题？plan？用户确认？")

    # Step 2: Show + confirm
    show_plan(plan_data)
    # --no-confirm 仅在用户已确认过（user_decisions.confirmed=true）时才生效，
    # 否则强制走交互确认，防止弱模型用 --no-confirm 拆掉最后一道闸门
    ud = plan_data.get("user_decisions", {})
    if args.no_confirm and ud.get("confirmed") is True:
        ans = True
    else:
        ans = confirm()
    if ans is False:
        print("已取消")
        return

    plan = plan_data.get("plan", [])
    if not plan:
        print("方案为空，退出")
        return

    if ans == "skip":
        skip_steps = input("跳过哪些步骤？(逗号分隔序号，如 '1,3'): ").strip()
        skip_set = set()
        for s in skip_steps.split(","):
            s = s.strip()
            if s.isdigit():
                skip_set.add(int(s))
    else:
        skip_set = set()

    # Step 3: Execute
    results = {}
    for step in plan:
        sn = step.get("step", 0)
        if sn in skip_set:
            eprint(f"[craftman]  步骤 {sn} 已跳过")
            continue
        sname = step.get("skill", "?")
        eprint(f"\n[craftman] === 执行步骤 {sn}: {sname} ===")
        r = exec_step(step, out_dir)
        # 以步骤序号为 key，避免同 skill 多步骤互相覆盖
        results[sn] = r
        if r is None and step.get("required", True):
            eprint(f"[craftman]  步骤 {sn} 失败，终止")
            break

    # Step 4: Merge
    merge(plan_data, results, out_dir)
    print("\n完成!")


if __name__ == "__main__":
    main()
