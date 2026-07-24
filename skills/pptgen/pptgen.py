#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
pptgen — 一句话生成本地交互式 HTML PPT
本地 27B 模型生成内容 + ComfyUI 生图 + 多套视觉模板
独立 CLI 工具，零 API 费用
"""

import os, sys, json, re, time, subprocess, shutil, html as html_mod
from pathlib import Path
import urllib.request, urllib.parse

SKILL_DIR = Path(__file__).parent
TEMPLATES_DIR = SKILL_DIR / "templates"
DEFAULT_CONFIG = SKILL_DIR / "config.yaml"

OUT_DIR_DEFAULT = SKILL_DIR / "output"
COMFY_OUT = Path(os.environ.get("COMFY_OUT", r"E:\workspace\comfyui_out"))
COMFY_SCRIPT = SKILL_DIR.parent / "comfyui-image-gen" / "comfy.py"

LAYOUTS = ["cover", "section", "content", "content-left", "content-right",
           "two-column", "quote", "data", "image-full"]

STYLES = ["dark-tech", "magazine", "minimal", "gradient",
           "neumorphism", "aurora", "code", "glass-candy", "chromatic", "dark-atlas",
           "research-white", "black-gold", "navy-magazine", "gold-index", "growth", "sonic-neon"]

# ── helpers ─────────────────────────────────────────────────────

def load_config(path=None):
    path = path or DEFAULT_CONFIG
    try:
        import yaml
        with open(path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f)
    except ImportError:
        cfg = {}
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                m = re.match(r'\s*(\w+):\s*(.+)', line)
                if m: cfg[m.group(1)] = m.group(2).strip().strip('"').strip("'")
        endpoint = os.environ.get("LLM_ENDPOINT", "")
        model = os.environ.get("LLM_MODEL", "")
        return {"llm": {"endpoint": endpoint, "model": model, "api_key": "not-needed"},
                "comfyui": {"script": str(COMFY_SCRIPT), "output_dir": str(COMFY_OUT)},
                "output": {"dir": str(SKILL_DIR / "output")}}
    except Exception:
        return {"llm": {"endpoint": "", "model": "", "api_key": "not-needed"},
                "comfyui": {"script": str(COMFY_SCRIPT), "output_dir": str(COMFY_OUT)},
                "output": {"dir": str(SKILL_DIR / "output")}}


def eprint(*a, **kw):
    print(*a, file=sys.stderr, **kw, flush=True)


# ── Step 1: Call local 27B ─────────────────────────────────────

SYSTEM_PROMPT = """你是一个PPT内容生成助手。根据用户需求生成一份结构化PPT内容，输出纯JSON。

输出格式（必须有 slides 数组）：
{
  "title": "演示标题",
  "subtitle": "副标题",
  "author": "作者",
  "date": "日期",
  "style_options": [{"name": "aurora", "reason": "适合科技感主题"}, {"name": "magazine", "reason": "适合正式汇报"}, ...]（根据主题从可选风格中推荐3个，按适用度排序，可选风格: neumorphism/aurora/code/glass-candy/chromatic/dark-atlas/research-white/black-gold/navy-magazine/gold-index/growth/sonic-neon/dark-tech/magazine/minimal/gradient）,
  "style": "style_options[0].name（默认用最推荐的）",
  "slides": [
    {
      "layout": "cover|section|content|content-left|content-right|two-column|quote|data|image-full",
      "title": "标题",
      "content": "正文内容（支持\\n换行和\\n- 列表项格式）",
      "items": ["条目1", "条目2"] (选填，用于列表),
      "image": null 或 { "prompt": "图片描述提示词", "style": "krea2|ernie|klein|zimage|null", "style_options": [{"name":"风格A","reason":"理由"}...]（推荐2-3种生图风格及理由；若不确定用户想要什么，style 设为 null 让用户自己选） },
      "detail": null 或 { "title": "钻取面板标题", "type": "table|card|text|bar", "data": {...} }
    }
  ]
}

layout 说明：
- cover: 封面页（整页展示标题，建议含 image）
- section: 章节分隔页，仅标题+编号
- content: 正文页，标题+内容
- content-left: 左文右图
- content-right: 左图右文
- two-column: 双栏内容
- quote: 引用页（title做引用正文）
- data: 数据页，用 title 做数字，content 做说明
- image-full: 全屏图+文字叠加

规则：
1. 封面页 layout 必须为 cover，建议配图
2. 重要数据用 layout=data
3. 每个非封面/章节/全屏图的 slide 都配 detail 字段做钻取交互（type 和数据格式自由发挥）——让页面有"点击展开详情"的层次感
4. 需要图片的 slide 在 image.prompt 写详细生图提示词（中英文混合）
5. image.style: krea2=艺术/动画, ernie=文字排版强, klein=写实场景, zimage=人物肖像。每张配图在 style_options 中推荐2-3种并说明理由。用户如果在 prompt 中指定了"写实""摄影""卡通""艺术"等偏好，按用户要求选 style
6. 总共生成 {pages} 页左右
7. 内容要专业、有深度、逻辑清晰，引用具体数据而非空泛描述"""


def call_llm(user_prompt, config, pages=0):
    endpoint = config.get("llm", {}).get("endpoint", os.environ.get("LLM_ENDPOINT", ""))
    model = config.get("llm", {}).get("model", os.environ.get("LLM_MODEL", ""))
    api_key = config.get("llm", {}).get("api_key", "not-needed")
    if not endpoint:
        eprint("[pptgen] LLM 未配置，设置 LLM_ENDPOINT 环境变量或修改 config.yaml")
        sys.exit(1)

    system = SYSTEM_PROMPT.replace("{pages}", str(pages) if pages > 0 else "8-12")

    payload = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.7,
        "max_tokens": 8192,
        "stream": False
    }).encode("utf-8")

    req = urllib.request.Request(endpoint, data=payload,
                                 headers={"Content-Type": "application/json",
                                          "Authorization": f"Bearer {api_key}"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            resp = json.loads(r.read().decode("utf-8"))
    except Exception as e:
        eprint(f"[pptgen] LLM call failed: {e}")
        sys.exit(1)

    text = resp.get("choices", [{}])[0].get("message", {}).get("content", "")
    if not text:
        eprint("[pptgen] LLM returned empty response")
        sys.exit(1)

    return parse_json(text)


def parse_json(text):
    # Try full parse first
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    text = text.strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Find JSON block
    m = re.search(r"\{[\s\S]*\}", text)
    if m:
        try:
            return json.loads(m.group())
        except json.JSONDecodeError:
            pass

    # Try fixing common issues
    fixed = re.sub(r",\s*([}\]])", r"\1", text)  # trailing commas
    try:
        return json.loads(fixed)
    except json.JSONDecodeError:
        pass

    eprint("[pptgen] Failed to parse LLM response as JSON")
    eprint(f"[pptgen] Raw response (first 500 chars): {text[:500]}")
    sys.exit(1)


# ── Step 2: Call ComfyUI ──────────────────────────────────────

def call_comfyui(prompt, style="krea2", size="", name="ppt"):
    script = str(COMFY_SCRIPT)
    if not os.path.isfile(script):
        eprint(f"[pptgen] comfy.py not found: {script}")
        return None

    python = sys.executable
    cmd = [python, script, style, prompt, "--name", name]
    if size:
        cmd += ["--size", size]

    eprint(f"[pptgen] comfy: {style} | {prompt[:60]}...")
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if r.returncode != 0:
            eprint(f"[pptgen] comfy err: {r.stderr[:200]}")
            return None
        for line in r.stdout.splitlines():
            if line.startswith("RESULT:"):
                paths = json.loads(line[7:])
                if paths:
                    return paths[0]
    except subprocess.TimeoutExpired:
        eprint("[pptgen] comfy timeout")
    except Exception as e:
        eprint(f"[pptgen] comfy error: {e}")
    return None


# ── Step 3: Generate slide HTML ────────────────────────────────

def esc(text):
    return html_mod.escape(text or "")


def render_body(text):
    """Convert simple markdown-like text to HTML"""
    if not text:
        return ""
    lines = text.split("\n")
    out = []
    in_list = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("- ") or stripped.startswith("* "):
            if not in_list:
                out.append("<ul>")
                in_list = True
            out.append(f"<li>{esc(stripped[2:])}</li>")
        else:
            if in_list:
                out.append("</ul>")
                in_list = False
            if stripped:
                out.append(f"<p>{esc(stripped)}</p>")
            else:
                out.append("<br>")
    if in_list:
        out.append("</ul>")
    return "\n".join(out)


def render_detail(detail, idx):
    if not detail:
        return ""
    title = esc(detail.get("title", "查看详情"))
    dtype = detail.get("type", "text")
    data = detail.get("data") or detail
    html = f'<div class="drill-toggle" data-target="drill-{idx}" onclick="(function(t){{var p=document.getElementById(t.getAttribute(\'data-target\'));p.classList.toggle(\'open\');t.classList.toggle(\'open\');}})(this)">&#9654; {title}</div>'
    html += f'<div class="drill-panel" id="drill-{idx}"><div class="drill-inner">'
    html += f'<h4 style="margin-bottom:16px;font-size:18px">{title}</h4>'

    if dtype == "table":
        headers = data.get("headers", [])
        rows = data.get("rows", [])
        html += '<table class="dt"><thead><tr>'
        for h in headers:
            html += f'<th>{esc(h)}</th>'
        html += '</tr></thead><tbody>'
        for row in rows:
            html += '<tr>'
            for cell in (row if isinstance(row, list) else [row]):
                html += f'<td>{esc(str(cell))}</td>'
            html += '</tr>'
        html += '</tbody></table>'
    elif dtype == "card":
        cards = data.get("cards", [])
        html += '<div class="drill-grid">'
        for card in cards:
            h = esc(card.get("header", "") or card.get("title", ""))
            b = esc(card.get("body", "") or card.get("content", "") or card.get("text", "")).replace("\n", "<br>")
            html += f'<div class="drill-card"><h5>{h}</h5><p>{b}</p></div>'
        html += '</div>'
    elif dtype == "text":
        text = esc(data.get("text", "") or data.get("content", "") or str(data)).replace("\n", "<br>")
        html += f'<p>{text}</p>'
    elif dtype == "bar":
        items = data.get("items", []) if isinstance(data, dict) else data
        for it in items:
            label = esc(it.get("label", "") or it.get("name", ""))
            pct = it.get("pct", it.get("percent", it.get("value", 0)))
            color = it.get("color", "var(--ac, #4fc3f7)")
            desc = esc(it.get("desc", "") or it.get("description", "") or "")
            html += f'<div class="drill-bar-label"><span>{label}</span><span>{pct}%</span></div>'
            html += f'<div class="drill-bar"><div class="drill-bar-fill" style="width:{pct}%;background:{color}"></div></div>'
            if desc:
                html += f'<p style="font-size:12px;color:var(--sub,#8899aa);margin-bottom:12px">{desc}</p>'
    else:
        html += f'<p>{esc(str(data))}</p>'
    html += '</div></div>'
    return html


def render_slide(s, idx, img_path=None):
    layout = s.get("layout", "content")
    title = esc(s.get("title", ""))
    content = s.get("content", "")
    items = s.get("items", [])
    body_html = render_body(content)

    if items:
        ul = "<ul>" + "".join(f"<li>{esc(i)}</li>" for i in items) + "</ul>"
        if body_html:
            body_html += "\n" + ul
        else:
            body_html = ul

    num = f'<span class="num">{idx+1}.</span>' if layout in ("content", "content-left", "content-right", "section", "two-column") else ""

    img_html = ""
    if img_path:
        rel = os.path.basename(img_path)
        if layout in ("content-left", "content-right", "content"):
            img_html = f'<div class="img-col"><img src="{rel}" alt=""></div>'
        elif layout in ("cover", "image-full", "section"):
            img_html = (f'<img class="img-bg" src="{rel}" alt="">'
                        f'<div class="overlay"></div>')

    drill = render_detail(s.get("detail"), idx)

    if layout == "cover":
        inner = (f'<div class="inner">'
                 f'<div class="accent-line"></div>'
                 f'<div class="title">{title}</div>'
                 f'<div class="subtitle">{esc(s.get("content", ""))}</div>'
                 f'<div class="meta">{esc(s.get("items", [""])[0] if s.get("items") else "")}</div>'
                 f'</div>')
        if img_path:
            return (f'<div class="slide slide-cover slide-image-full" data-idx="{idx}">'
                    f'{img_html}{inner}</div>')
        return f'<div class="slide slide-cover" data-idx="{idx}">{inner}</div>'

    if layout == "section":
        inner = (f'<div class="inner">'
                 f'<div class="section-num">{idx+1:02d}</div>'
                 f'<div class="accent-line"></div>'
                 f'<div class="title">{title}</div>'
                 f'</div>')
        if img_path:
            return (f'<div class="slide slide-section slide-image-full" data-idx="{idx}">'
                    f'{img_html}{inner}</div>')
        return f'<div class="slide slide-section" data-idx="{idx}">{inner}</div>'

    if layout == "content":
        inner = (f'<div class="inner">'
                 f'<div class="card"><div class="title">{num}{title}</div>'
                 f'<div class="body">{body_html}</div></div>{drill}</div>')
        return f'<div class="slide slide-content" data-idx="{idx}">{inner}</div>'

    if layout in ("content-left", "content-right"):
        text_col = (f'<div class="text-col"><div class="card">'
                    f'<div class="title">{num}{title}</div>'
                    f'<div class="body">{body_html}</div></div></div>')
        if layout == "content-left":
            inner = f'<div class="inner slide-side">{text_col}{img_html}</div>'
        else:
            inner = f'<div class="inner slide-side">{img_html}{text_col}</div>'
        inner += drill
        return f'<div class="slide slide-side" data-idx="{idx}">{inner}</div>'

    if layout == "two-column":
        cols = "".join(f'<div class="col"><div class="card">'
                       f'<div class="col-title">{esc(c.get("title",""))}</div>'
                       f'<div class="body">{render_body(c.get("content",""))}</div></div></div>'
                       for c in s.get("columns", [{"title": s.get("title"), "content": s.get("content")}]))
        inner = f'<div class="inner slide-2col">{cols}</div>{drill}'
        return f'<div class="slide slide-2col" data-idx="{idx}">{inner}</div>'

    if layout == "quote":
        inner = (f'<div class="inner"><div class="slide-quote">'
                 f'<div class="quote-text">{title}</div>'
                 f'<div class="quote-source">{esc(s.get("content",""))}</div>'
                 f'</div></div>')
        return f'<div class="slide slide-quote" data-idx="{idx}">{inner}</div>'

    if layout == "data":
        inner = (f'<div class="inner"><div class="slide-data">'
                 f'<div class="big-number">{title}</div>'
                 f'<div class="data-label">{esc(s.get("content",""))}</div>'
                 f'<div class="data-desc">{esc(s.get("items",[""])[0] if s.get("items") else "")}</div>'
                 f'</div>{drill}</div>')
        return f'<div class="slide slide-data" data-idx="{idx}">{inner}</div>'

    if layout == "image-full":
        inner = (f'<div class="inner">'
                 f'<div class="title">{title}</div>'
                 f'<div class="sub">{esc(s.get("content",""))}</div>'
                 f'</div>')
        return (f'<div class="slide slide-image-full" data-idx="{idx}">'
                f'{img_html}{inner}</div>')

    return f'<div class="slide slide-content" data-idx="{idx}"><div class="inner"><p>{title}</p>{drill}</div></div>'


# ── Step 4: Render full HTML ──────────────────────────────────

DRILL_CSS = """
.drill-toggle{display:block;margin:16px auto 0;font-size:13px;cursor:pointer;text-align:center;padding:8px 20px;border:1px solid rgba(128,128,128,.25);border-radius:8px;background:rgba(128,128,128,.06);transition:all .3s;width:fit-content;color:var(--ac,#4fc3f7);user-select:none}
.drill-toggle:hover{background:rgba(128,128,128,.12)}
.drill-toggle.open{color:var(--gold,var(--ac,#ffd54f))}
.drill-panel{width:100%;max-height:0;opacity:0;overflow:hidden;transition:max-height .5s ease,opacity .4s ease,margin .3s ease;margin-top:0}
.drill-panel.open{max-height:3000px;opacity:1;margin-top:20px}
.drill-inner{background:rgba(128,128,128,.05);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(128,128,128,.12);border-radius:12px;padding:24px}
.dt{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
.dt th,.dt td{padding:8px 10px;text-align:left;border:1px solid rgba(128,128,128,.1)}
.dt th{background:rgba(128,128,128,.08);font-weight:700;font-size:13px}
.dt td{font-size:13px}
.dt tr:hover td{background:rgba(128,128,128,.04)}
.drill-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-top:8px}
.drill-card{background:rgba(128,128,128,.04);border-radius:10px;padding:16px;border:1px solid rgba(128,128,128,.08)}
.drill-card h5{font-size:14px;margin-bottom:8px;color:var(--ac,#4fc3f7)}
.drill-card p{font-size:12px;line-height:1.7;color:var(--sub,#8899aa)}
.drill-bar{margin-top:4px;margin-bottom:12px}
.drill-bar-label{display:flex;justify-content:space-between;font-size:12px;color:var(--sub,#8899aa);margin-bottom:2px}
.drill-bar-track{height:6px;border-radius:3px;background:rgba(128,128,128,.12);overflow:hidden}
.drill-bar-fill{height:100%;border-radius:3px;transition:width .8s ease}
"""


def load_template(style):
    style = style or "magazine"
    tmpl_path = TEMPLATES_DIR / f"{style}.html"
    if not tmpl_path.exists():
        eprint(f"[pptgen] template not found: {tmpl_path}, falling back to magazine")
        tmpl_path = TEMPLATES_DIR / "magazine.html"
        if not tmpl_path.exists():
            eprint("[pptgen] no templates found!")
            sys.exit(1)
    with open(tmpl_path, "r", encoding="utf-8") as f:
        return f.read()


def render_html(template, slides_html, data, style):
    title = esc(data.get("title", "Presentation"))
    subtitle = esc(data.get("subtitle", ""))
    author = esc(data.get("author", ""))
    date_str = esc(data.get("date", ""))

    html = template
    html = html.replace("{TITLE}", title)
    html = html.replace("{SUBTITLE}", subtitle)
    html = html.replace("{AUTHOR}", author)
    html = html.replace("{STYLE_NAME}", style)
    html = html.replace("{SLIDES}", slides_html)

    # Inject drill-down CSS before </head>
    html = html.replace("</head>", f"<style>{DRILL_CSS}</style></head>")
    return html


# ── Main ──────────────────────────────────────────────────────

def main():
    import argparse
    ap = argparse.ArgumentParser(description="pptgen — 本地智能 HTML PPT 生成器")
    ap.add_argument("prompt", nargs="?", default="", help="一句话描述PPT需求")
    ap.add_argument("--style", choices=STYLES, default="magazine", help="视觉风格: original(dark-tech/magazine/minimal/gradient) + 12 distills(neumorphism/aurora/code/glass-candy/chromatic/dark-atlas/research-white/black-gold/navy-magazine/gold-index/growth/sonic-neon)")
    ap.add_argument("--pages", type=int, default=0, help="页数（0=AI决定）")
    ap.add_argument("--output", default="", help="输出路径")
    ap.add_argument("--no-image", action="store_true", help="跳过生图")
    ap.add_argument("--no-llm", action="store_true", help="跳过LLM，从已有cache读取")
    ap.add_argument("--cache", default="", help="从JSON cache文件读取内容（跳过LLM）")
    ap.add_argument("--config", default=str(DEFAULT_CONFIG), help="配置文件路径")
    args = ap.parse_args()

    if not args.prompt and not args.no_llm and not args.cache:
        ap.print_help()
        print("\n错误: 请输入PPT需求描述")
        sys.exit(1)

    config = load_config(args.config)

    # Step 1: Get content
    if args.cache:
        with open(args.cache, "r", encoding="utf-8") as f:
            data = json.load(f)
        eprint(f"[pptgen] loaded cache: {args.cache}")
    else:
        eprint(f"[pptgen] calling 27B model...")
        data = call_llm(args.prompt, config, args.pages)
        eprint(f"[pptgen] received {len(data.get('slides',[]))} slides")

    slides = data.get("slides", [])
    if not slides:
        eprint("[pptgen] no slides in response")
        sys.exit(1)

    # Step 2: Generate images
    img_map = {}
    if not args.no_image:
        eprint(f"[pptgen] generating images via ComfyUI...")
        image_slides = [(i, s) for i, s in enumerate(slides) if s.get("image") and s["image"].get("prompt")]
        if image_slides:
            os.makedirs(COMFY_OUT, exist_ok=True)
            for i, s in image_slides:
                img_info = s["image"]
                p = img_info["prompt"]
                st = img_info.get("style") or None
                if st and st.lower() in ("null", "none", "ask_user"):
                    st = None
                style_opts = img_info.get("style_options", [])
                if st is None and not style_opts:
                    style_opts = [{"name":"krea2","reason":"艺术/动画"},{"name":"ernie","reason":"文字排版"},{"name":"klein","reason":"写实场景"},{"name":"zimage","reason":"人物肖像"}]
                if style_opts and st is None:
                    eprint(f"\n[pptgen] === slide {i+1} 请选择生图风格 ===")
                    for j, opt in enumerate(style_opts):
                        eprint(f"  {j+1}. {opt.get('name','?')} — {opt.get('reason','')}")
                    while True:
                        try:
                            ch = input(f"  选择 (1-{len(style_opts)})，默认1: ").strip()
                            if not ch:
                                ch = "1"
                            idx = int(ch) - 1
                            if 0 <= idx < len(style_opts):
                                st = style_opts[idx]["name"]
                                break
                        except (ValueError, IndexError):
                            pass
                        eprint("  输入无效，请重新选择")
                elif style_opts:
                    eprint(f"[pptgen]   slide {i+1} 风格: {st}（候选: {' | '.join(o.get('name','?') for o in style_opts)}）")
                if not st:
                    st = "krea2"
                    eprint(f"[pptgen]   slide {i+1}: 未选择，默认 {st}")
                sz = ""
                if st == "klein":
                    sz = "1920x1080"
                elif st == "krea2":
                    sz = "1920x1080"
                elif st == "zimage":
                    sz = "1920x1080"

                eprint(f"[pptgen]   slide {i+1}: {st} | {p[:50]}...")
                result = call_comfyui(p, st, size=sz, name=f"ppt_s{i+1}")
                if result:
                    img_map[i] = result
                else:
                    eprint(f"[pptgen]   slide {i+1}: image generation failed, skipping")

            # Copy images to output dir
            if img_map:
                out_dir = Path(args.output).parent if args.output else SKILL_DIR / "output"
                out_dir.mkdir(parents=True, exist_ok=True)
                for idx, src in list(img_map.items()):
                    ext = os.path.splitext(src)[1] or ".png"
                    dst = out_dir / f"slide_{idx+1:02d}{ext}"
                    try:
                        shutil.copy2(src, dst)
                        img_map[idx] = str(dst)
                    except Exception as e:
                        eprint(f"[pptgen] copy failed: {e}")
                        img_map[idx] = src

    # Step 3: Render slides
    eprint(f"[pptgen] rendering {len(slides)} slides...")
    slides_html_parts = []
    for i, s in enumerate(slides):
        img_path = img_map.get(i)
        slides_html_parts.append(render_slide(s, i, img_path))

    all_slides = "\n".join(slides_html_parts)

    # Step 4: Build final HTML — LLM 推荐风格，--style 可覆盖
    style_opts = data.get("style_options", [])
    if style_opts:
        eprint(f"[pptgen] 推荐风格（--style 可切换）:")
        for i, opt in enumerate(style_opts):
            eprint(f"         {i+1}. {opt.get('name','?')} — {opt.get('reason','')}")
    active_style = args.style or data.get("style", style_opts[0]["name"] if style_opts else "magazine")
    if active_style not in STYLES:
        eprint(f"[pptgen] unknown style '{active_style}', falling back to magazine")
        active_style = "magazine"
    template = load_template(active_style)
    html = render_html(template, all_slides, data, active_style)

    # Step 5: Write output
    out_path = args.output
    if not out_path:
        out_dir = SKILL_DIR / "output"
        out_dir.mkdir(parents=True, exist_ok=True)
        safe_name = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff_-]", "_", data.get("title", "presentation"))[:40]
        out_path = str(out_dir / f"{safe_name}.html")

    out_dir = os.path.dirname(out_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)

    eprint(f"\n[pptgen] done! output: {out_path}")
    print(out_path)


if __name__ == "__main__":
    main()
