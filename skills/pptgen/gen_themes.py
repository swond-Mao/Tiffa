#!/usr/bin/env python
"""Generate pptgen CSS theme files and complete HTML templates from design tokens."""

import json, os, sys
from pathlib import Path

SKILL_DIR = Path(__file__).parent
TEMPLATES_DIR = SKILL_DIR / "templates"
TOKENS_FILE = SKILL_DIR / "tokens.json"

BASE_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>{{TITLE}}</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
html,body{{width:100%;height:100%;overflow:hidden;background:{bg};font-family:{sans};color:{fg}}}
.deck{{width:100%;height:100%;position:relative}}
.slide{{position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:{slidePadding};opacity:0;transition:opacity .4s ease;pointer-events:none;{slideExtra}}}
.slide.active{{opacity:1;pointer-events:auto}}
.slide .inner{{width:100%;max-width:{maxWidth};margin:0 auto}}
.slide-num{{position:fixed;bottom:24px;right:32px;font-size:12px;color:{fgMuted};font-variant-numeric:tabular-nums;z-index:100;font-family:{mono}}}
/* cover */
.slide-cover{{text-align:center}}
.slide-cover .title{{font-size:{titleSize};font-weight:{headingWeight};{accentGradientCSS};margin-bottom:12px;line-height:1.15{titleExtra}}}
.slide-cover .accent-line{{width:50px;height:3px;background:{accent};margin:0 auto 20px;border-radius:2px}}
.slide-cover .subtitle{{font-size:{subtitleSize};color:{fgMuted};font-weight:300;letter-spacing:1px;margin-bottom:16px{coverSubExtra}}}
.slide-cover .meta{{font-size:13px;color:{fgMuted};opacity:0.6}}
/* section */
.slide-section{{text-align:center}}
.slide-section .section-num{{font-size:{sectionNumSize};font-weight:800;color:color-mix(in srgb, {accent} 15%, transparent);line-height:1;margin-bottom:8px;font-family:{mono}}}
.slide-section .title{{font-size:34px;font-weight:600;color:{fg}}}
.slide-section .accent-line{{width:36px;height:2px;background:{accent};margin:14px auto;border-radius:1px}}
/* content */
.slide-content .title{{font-size:26px;font-weight:600;color:{fg};margin-bottom:14px}}
.slide-content .title .num{{color:{accent};font-family:{mono};margin-right:8px}}
.slide-content .body{{font-size:16px;line-height:1.8;color:{fgMuted};max-width:750px}}
.slide-content .body p{{margin-bottom:10px}}
.slide-content .body ul{{padding-left:18px;list-style:none}}
.slide-content .body ul li::before{{content:"{bullet} ";color:{accent}}}
.slide-content .body ul li{{margin-bottom:6px;color:{fgMuted}}}
/* side-by-side */
.slide-side{{display:flex;gap:48px;align-items:center}}
.slide-side .text-col{{flex:1}}
.slide-side .text-col .title{{font-size:24px;font-weight:600;color:{fg};margin-bottom:12px}}
.slide-side .text-col .body{{font-size:15px;line-height:1.8;color:{fgMuted}}}
.slide-side .text-col .body ul{{padding-left:16px;list-style:none}}
.slide-side .text-col .body ul li::before{{content:"{bullet} ";color:{accent}}}
.slide-side .text-col .body ul li{{margin-bottom:5px}}
.slide-side .img-col{{flex:1;min-height:300px;background:{imgBg};{imgBorder};border-radius:8px;overflow:hidden;display:flex;align-items:center;justify-content:center}}
.slide-side .img-col img{{width:100%;height:100%;object-fit:cover;display:block}}
.slide-side .img-col .img-placeholder{{color:{fgMuted};font-size:13px;opacity:0.5}}
/* two-column */
.slide-2col{{display:flex;gap:32px}}
.slide-2col .col{{flex:1}}
.slide-2col .col .col-title{{font-size:18px;font-weight:600;color:{fg};margin-bottom:10px}}
.slide-2col .col .col-title .num{{color:{accent};margin-right:6px}}
.slide-2col .col .body{{font-size:14px;line-height:1.7;color:{fgMuted}}}
.slide-2col .col .body ul{{padding-left:14px;list-style:none}}
.slide-2col .col .body ul li::before{{content:"{bullet} ";color:{accent}}}
/* quote */
.slide-quote{{text-align:center;max-width:750px;margin:0 auto}}
.slide-quote .quote-text{{font-size:30px;font-weight:300;line-height:1.7;color:{fg};font-style:italic;margin-bottom:12px}}
.slide-quote .quote-text::before{{content:"\\201C";color:{accent};font-size:48px;opacity:.3;margin-right:6px;vertical-align:middle}}
.slide-quote .quote-text::after{{content:"\\201D";color:{accent};font-size:48px;opacity:.3;margin-left:6px;vertical-align:middle}}
.slide-quote .quote-source{{font-size:14px;color:{fgMuted}}}
/* data */
.slide-data{{text-align:center}}
.slide-data .big-number{{font-size:88px;font-weight:800;{accentGradientCSS};line-height:1;margin-bottom:6px;font-family:{mono}}}
.slide-data .data-label{{font-size:16px;color:{fgMuted};margin-bottom:10px;letter-spacing:1px}}
.slide-data .data-desc{{font-size:15px;color:{fgMuted};max-width:450px;margin:0 auto;line-height:1.6;opacity:0.6}}
/* image full */
.slide-image-full{{position:relative;overflow:hidden}}
.slide-image-full .img-bg{{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover}}
.slide-image-full .overlay{{position:absolute;top:0;left:0;width:100%;height:100%;{overlayGradient}}}
.slide-image-full .inner{{position:relative;z-index:1;text-align:center}}
.slide-image-full .title{{font-size:40px;font-weight:700;color:#fff;margin-bottom:12px{imageTitleShadow}}}
.slide-image-full .sub{{font-size:16px;color:rgba(255,255,255,.6)}}
/* arrows */
.arrow{{position:fixed;top:50%;transform:translateY(-50%);z-index:100;{arrowBg};border:{arrowBorder};color:{fgMuted};width:36px;height:36px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;transition:.2s}}
.arrow:hover{{color:{accent};border-color:{accent}{arrowHoverExtra}}}
.arrow-left{{left:12px}}
.arrow-right{{right:12px}}
.arrow.hidden{{display:none}}
/* progress */
.progress{{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);display:flex;gap:5px;z-index:100}}
.progress .dot{{width:6px;height:6px;border-radius:50%;{dotBg};cursor:pointer;transition:.2s}}
.progress .dot.active{{background:{accent};width:18px;border-radius:3px}}
/* hint */
.hint{{position:fixed;bottom:24px;left:32px;font-size:11px;color:{fgMuted};z-index:100;opacity:0.3}}
/* card wrapper */
{specificStyles}
</style>
</head>
<body>
<div class="deck">{{SLIDES}}</div>
<div class="arrow arrow-left" id="arrowLeft">&lsaquo;</div>
<div class="arrow arrow-right" id="arrowRight">&rsaquo;</div>
<div class="progress" id="progress"></div>
<div class="slide-num" id="slideNum"></div>
<div class="hint">&larr; &rarr; 翻页 &middot; F 全屏</div>
<script>
(function(){{'use strict';
var s=document.querySelectorAll('.slide'),c=0,t=s.length;
function show(i){{if(i<0||i>=t)return;s[c].classList.remove('active');s[i].classList.add('active');c=i;u();}}
function u(){{
  document.getElementById('slideNum').textContent=(c+1)+' / '+t;
  document.getElementById('arrowLeft').classList.toggle('hidden',c===0);
  document.getElementById('arrowRight').classList.toggle('hidden',c===t-1);
  document.querySelectorAll('.progress .dot').forEach(function(d,i){{d.classList.toggle('active',i===c);}});
}}
function bp(){{
  var el=document.getElementById('progress');
  for(var i=0;i<t;i++){{var d=document.createElement('div');d.className='dot';d.onclick=function(j){{return function(){{show(j);}};}}(i);el.appendChild(d);}}
}}
document.addEventListener('keydown',function(e){{
  if(e.key==='ArrowRight'||e.key==='ArrowDown'){{e.preventDefault();show(c+1);}}
  if(e.key==='ArrowLeft'||e.key==='ArrowUp'){{e.preventDefault();show(c-1);}}
  if(e.key==='f'||e.key==='F'){{if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen();}}
}});
document.getElementById('arrowLeft').onclick=function(){{show(c-1);}};
document.getElementById('arrowRight').onclick=function(){{show(c+1);}};
var tx=0;document.addEventListener('touchstart',function(e){{tx=e.changedTouches[0].screenX;}});
document.addEventListener('touchend',function(e){{var d=tx-e.changedTouches[0].screenX;if(Math.abs(d)>50){{if(d>0)show(c+1);else show(c-1);}}}});
if(t>0)s[0].classList.add('active');bp();u();
}})();
</script>
</body>
</html>"""


def generate_theme(t):
    c = t["colors"]
    typ = t["typography"]
    cover = t["cover"]
    effects = set(t["effects"])

    is_glass = "glassmorphism" in effects or "glass-candy" in effects
    is_dark = t["style"] in ("dark",)
    has_gradient_title = "neon-glow" in effects or "aurora-gradient" in effects or "glass-candy" in effects

    if has_gradient_title:
        accent_gradient_css = f"background:{c['accentGradient']};-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;"
    else:
        accent_gradient_css = f"color:{c['fg']};"

    if is_glass:
        slide_extra = f"background:{c['bgAlt']};"
        card_style = ""
        card_title = ""
        card_body = ""
        img_bg = c.get("cardBg", "#f8f9fa")
        img_border = f"border:1px solid {c.get('cardBorder', '#e2e8f0')}"
        arrow_bg = "background:rgba(255,255,255,.7)"
        arrow_border = "none"
        arrow_hover = ";box-shadow:0 2px 8px rgba(0,0,0,.1)"
        dot_bg = "background:rgba(0,0,0,.1)"
        overlay_grad = f"background:linear-gradient(135deg,rgba(0,0,0,.65),rgba(0,0,0,.2))"
        title_shadow = ";text-shadow:0 2px 20px rgba(0,0,0,.3)"
        specific = ""
        cover_sub = ""
    elif is_dark:
        slide_extra = f"background:{c['bg']};"
        card_style = f"background:{c['cardBg']};border:1px solid {c['cardBorder']};border-radius:12px;padding:32px;"
        card_title = ""
        card_body = ""
        img_bg = c.get("cardBg", "#1a1f2e")
        img_border = f"border:1px solid {c.get('cardBorder', '#30363d')}"
        arrow_bg = f"background:{c['cardBg']};"
        arrow_border = f"1px solid {c['cardBorder']}"
        arrow_hover = ";box-shadow:0 0 20px rgba(255,255,255,.05)"
        dot_bg = f"background:{c['cardBorder']}"
        overlay_grad = f"background:linear-gradient(135deg,rgba(0,0,0,.7),rgba(0,0,0,.2))"
        title_shadow = ";text-shadow:0 2px 20px rgba(0,0,0,.3)"
        specific = ""
        cover_sub = ""
    else:
        slide_extra = f"background:{c['bg']};"
        card_style = ""
        card_title = ""
        card_body = ""
        img_bg = "#f8f9fa"
        img_border = f"border:1px solid {c.get('cardBorder', '#e2e8f0')}"
        arrow_bg = "#fff"
        arrow_border = f"1px solid {c.get('cardBorder', '#e2e8f0')}"
        arrow_hover = ";box-shadow:0 2px 8px rgba(0,0,0,.05)"
        dot_bg = "rgba(0,0,0,.1)"
        overlay_grad = f"background:linear-gradient(135deg,rgba(0,0,0,.55),rgba(0,0,0,.15))"
        title_shadow = ""
        specific = ""
        cover_sub = ""

    # Card wrapper for content slides
    if card_style:
        specific = f""".slide-content .card{{{card_style}}}
.slide-content .card .title{{{card_title}}}
.slide-content .card .body{{{card_body}}}
.slide-side .card{{{card_style}}}
.slide-side .card .title{{{card_title}}}
.slide-side .card .body{{{card_body}}}
.slide-2col .col .card{{{card_style.replace('padding:32px','padding:24px')}}}
.slide-2col .col .card .col-title{{{card_title}}}
"""

    vals = {
        "TITLE": t["name"],
        "bg": c["bg"],
        "bgAlt": c["bgAlt"],
        "fg": c["fg"],
        "fgMuted": c["fgMuted"],
        "accent": c["accent"],
        "accentGradientCSS": accent_gradient_css,
        "sans": typ["sans"],
        "mono": typ["mono"],
        "headingWeight": typ["headingWeight"],
        "slidePadding": "60px 80px",
        "maxWidth": "1000px",
        "titleSize": cover["titleSize"],
        "subtitleSize": cover["subtitleSize"],
        "sectionNumSize": "96px",
        "bullet": "▸",
        "slideExtra": slide_extra,
        "imgBg": img_bg,
        "imgBorder": img_border,
        "arrowBg": arrow_bg,
        "arrowBorder": arrow_border,
        "arrowHoverExtra": arrow_hover,
        "dotBg": dot_bg,
        "overlayGradient": overlay_grad,
        "imageTitleShadow": title_shadow,
        "specificStyles": specific,
        "coverSubExtra": cover_sub,
        "titleExtra": "",
    }

    html = BASE_TEMPLATE.format(**vals)
    return html


def main():
    with open(TOKENS_FILE, "r", encoding="utf-8") as f:
        tokens = json.load(f)

    os.makedirs(TEMPLATES_DIR, exist_ok=True)

    for theme in tokens["themes"]:
        tid = theme["id"]
        out_path = TEMPLATES_DIR / f"{tid}.html"
        html = generate_theme(theme)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(html)
        print(f"  generated: {out_path.name}")

    # Update STYLES list in pptgen.py
    theme_ids = [t["id"] for t in tokens["themes"]]
    print(f"\nDone! {len(theme_ids)} themes generated.")
    print(f"Theme IDs: {', '.join(theme_ids)}")
    print("\nRun `python gen_themes.py` to regenerate.")


if __name__ == "__main__":
    main()
