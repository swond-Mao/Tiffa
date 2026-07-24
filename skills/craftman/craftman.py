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
OUT_DIR = SKILL_DIR / "output"
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
    "plan": [],
    "merge_instruction": "由 AI 提供合并方案"
}


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
    craftman 将其复制到输出目录。"""
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
    shutil.copy2(src_path, out_path)
    eprint(f"[craftman]  canvas done: {out_path}")
    return str(out_path)


# ── Step 4: Merge ──────────────────────

def merge(plan_data, results, out_dir):
    plan = plan_data.get("plan", [])

    eprint(f"\n[craftman] 合并输出...")
    outputs = []

    for step in plan:
        sname = step.get("skill", "?")
        result = results.get(sname)
        if result:
            outputs.append(f"  [{sname}] {result}")

    # canvas + pptgen → embed canvas into cover
    pptgen_out = results.get("pptgen")
    canvas_out = results.get("canvas-design")
    if pptgen_out and canvas_out and os.path.isfile(pptgen_out) and os.path.isfile(canvas_out):
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

    if pptgen_out:
        ppt_dir = Path(pptgen_out).parent
        for step in plan:
            if step.get("skill") == "comfyui":
                src = results.get("comfyui")
                if src and os.path.isfile(src):
                    try:
                        shutil.copy2(src, ppt_dir / os.path.basename(src))
                        eprint(f"[craftman]  图片已复制到PPT目录")
                    except Exception as e:
                        eprint(f"[craftman]  复制图片失败: {e}")

    print("\n" + "=" * 60)
    print("输出汇总")
    print("=" * 60)
    for o in outputs:
        print(o)
    print()
    print("可点击链接（session_server 4097 服务）:")
    for step in plan:
        sname = step.get("skill", "?")
        result = results.get(sname)
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

    # Step 2: Show + confirm
    show_plan(plan_data)
    if args.no_confirm:
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
        results[sname] = r
        if r is None and step.get("required", True):
            eprint(f"[craftman]  步骤 {sn} 失败，终止")
            break

    # Step 4: Merge
    merge(plan_data, results, out_dir)
    print("\n完成!")


if __name__ == "__main__":
    main()
