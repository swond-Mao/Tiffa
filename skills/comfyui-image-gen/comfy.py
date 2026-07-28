import os
import sys
import json
import argparse
import urllib.request
import time

COMFY = os.environ.get("COMFY_URL", "http://47.108.197.247:8188").rstrip("/")
SKILL_DIR = os.path.dirname(os.path.abspath(__file__))
_OUT_DIR_DEFAULT = os.path.join(os.environ.get("PORTABLE_ROOT", os.path.dirname(os.path.dirname(SKILL_DIR))), "workspace", "comfyui_out")

def resolve_out_dir(args_out_dir=None):
    """Resolve output directory: CLI arg > COMFY_OUT env > hardcoded default."""
    if args_out_dir:
        return os.path.abspath(args_out_dir)
    env = os.environ.get("COMFY_OUT", "")
    if env:
        return os.path.abspath(env)
    return os.path.abspath(_OUT_DIR_DEFAULT)

_out_dir_override = None

def get_out_dir():
    return _out_dir_override or resolve_out_dir()

WF_EDIT = os.path.join(SKILL_DIR, "workflow_edit_api.json")
WF_ERNIE = os.path.join(SKILL_DIR, "workflow_ernie_turbo_api.json")
WF_ZIMAGE = os.path.join(SKILL_DIR, "workflow_zimage_api.json")
WF_KLEIN = os.path.join(SKILL_DIR, "workflow_klein_api.json")
WF_KREA2 = os.path.join(SKILL_DIR, "workflow_krea2_api.json")

def _post(path, payload, raw=False, headers=None):
    data = payload if raw else json.dumps(payload).encode("utf-8")
    h = {"Content-Type": "application/json"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(COMFY + path, data=data, headers=h, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read().decode("utf-8") if not raw else r.read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            sys.stderr.write("[comfy] 404: %s\n" % path)
        else:
            sys.stderr.write("[comfy] HTTP %d: %s\n" % (e.code, e))
        sys.exit(2)

def _get(path):
    req = urllib.request.Request(COMFY + path, method="GET")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))

def upload_image(path):
    """Multipart upload to ComfyUI /upload/image."""
    import uuid as _uuid
    boundary = _uuid.uuid4().hex
    filename = os.path.basename(path)
    with open(path, "rb") as f:
        file_data = f.read()
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="image"; filename="{filename}"\r\n'
        f"Content-Type: image/png\r\n\r\n"
    ).encode() + file_data + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        COMFY + "/upload/image",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        resp = json.loads(r.read().decode())
    return resp.get("name", filename)


def submit_and_wait(wf, timeout):
    """Submit workflow via POST /prompt, poll GET /history/{id}, download images."""
    payload = {"prompt": wf, "client_id": "tiffa-skill"}
    result = _post("/prompt", payload)
    resp = json.loads(result)
    prompt_id = resp.get("prompt_id", "")
    if not prompt_id:
        sys.stderr.write("[comfy] submit failed: no prompt_id in response: %s\n" % result[:200])
        return []
    node_errors = resp.get("node_errors", {})
    if node_errors:
        sys.stderr.write("[comfy] node_errors on submit: %s\n" % json.dumps(node_errors)[:300])
    print("[comfy] prompt_id=%s submitted, waiting..." % prompt_id, flush=True)

    t0 = time.time()
    while True:
        try:
            history = _get("/history/%s" % prompt_id)
            if prompt_id in history:
                entry = history[prompt_id]
                status = entry.get("status", {})
                if status.get("status_str") == "success":
                    print("[comfy] done! (%.1fs)" % (time.time() - t0), flush=True)
                    # 收集输出图片
                    images = []
                    outputs = entry.get("outputs", {})
                    for node_id, out in outputs.items():
                        for img in out.get("images", []):
                            fname = img.get("filename", "")
                            subfolder = img.get("subfolder", "")
                            img_type = img.get("type", "output")
                            # 下载到本地输出目录
                            local = _download_image(fname, subfolder, img_type)
                            if local:
                                images.append(local)
                    return images
                elif status.get("status_str") == "error":
                    msgs = status.get("messages", [])
                    sys.stderr.write("[comfy] FAILED: %s\n" % json.dumps(msgs)[:300])
                    return []
        except Exception:
            pass
        if time.time() - t0 > timeout:
            raise TimeoutError("timeout after %ss for %s" % (timeout, prompt_id))
        time.sleep(2)


def _download_image(filename, subfolder, img_type):
    """Download image from ComfyUI /view endpoint to local output dir."""
    import urllib.parse
    params = urllib.parse.urlencode({"filename": filename, "subfolder": subfolder, "type": img_type})
    url = "%s/view?%s" % (COMFY, params)
    out_dir = get_out_dir()
    os.makedirs(out_dir, exist_ok=True)
    local_path = os.path.join(out_dir, filename)
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=60) as r:
            with open(local_path, "wb") as f:
                f.write(r.read())
        return local_path
    except Exception as e:
        sys.stderr.write("[comfy] download failed: %s\n" % e)
        return None

def load_wf(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

JOB = "gen"

RATIO_JSON = os.path.join(SKILL_DIR, "ratios.json")

def load_ratios():
    try:
        with open(RATIO_JSON, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def resolve_ratio(value):
    """Map a shorthand (e.g. '4:3') or full preset name to the exact
    width/height tuple expected by the workflow."""
    ratios = load_ratios()
    if isinstance(value, dict):
        return value
    if value in ratios:
        return ratios[value]
    for key, (w, h) in ratios.items():
        if value.lower() == str(w) + "x" + str(h).lower():
            return (w, h)
        if str(w).lower() + "x" + str(h).lower() == value.lower():
            return (w, h)
        if key.lower() == value.lower():
            return (w, h)
    return (768, 1024)

# Krea2 双主角 LoRA 开关：选中的主角 strength=1，另一个=0
# 链路固定：84(底模) -> 90(kopiu) -> 91(liuyifei) -> 83(TextFusion) -> 76 -> 66 -> 3
KREA2_PROTAGONISTS = {
    "liuyifei": {"trigger": "lucky1", "kop_strength": 0.2, "liu_strength": 1.0},
    "kopiu": {"trigger": "kopiu", "kop_strength": 1.0, "liu_strength": 0.0},
}

def cmd_krea2(args):
    global JOB
    JOB = args.name

    # prompt 来源优先级：1) 命令行参数 2) stdin (用 '-') 3) --prompt-file
    if args.prompt == '-':
        args.prompt = sys.stdin.read().strip()
    elif args.prompt_file:
        with open(args.prompt_file, 'r', encoding='utf-8') as f:
            args.prompt = f.read().strip()
    elif not args.prompt:
        sys.stderr.write("[comfy] krea2: prompt is required (pass text, '-' for stdin, or --prompt-file)\n")
        sys.exit(2)

    wf = load_wf(WF_KREA2)

    # 主角开关：默认 liuyifei
    hero = args.protagonist if args.protagonist else "liuyifei"
    if hero not in KREA2_PROTAGONISTS:
        sys.stderr.write("[comfy] --protagonist must be 'liuyifei' or 'kopiu' (got %r)\n" % hero)
        sys.exit(2)
    cfg = KREA2_PROTAGONISTS[hero]
    wf["90"]["inputs"]["strength_model"] = cfg["kop_strength"]
    wf["91"]["inputs"]["strength_model"] = cfg["liu_strength"]

    if args.seed and args.seed > 0:
        wf["73"]["inputs"]["seed"] = args.seed
    if args.steps and args.steps > 0:
        wf["3"]["inputs"]["steps"] = args.steps
    if args.size:
        try:
            w, h = args.size.lower().split("x")
            wf["70"]["inputs"]["value"] = int(w)
            wf["71"]["inputs"]["value"] = int(h)
        except Exception:
            sys.stderr.write("[comfy] bad --size, expect WxH e.g. 1080x1920\n")
            sys.exit(2)

    # 拆分多行提示词，逐行提交（每行一张图），确保每行独立生成
    lines = [l.strip() for l in args.prompt.splitlines() if l.strip()]
    if not lines:
        lines = [args.prompt]

    all_results = []
    for i, line in enumerate(lines):
        # 注入 trigger 词
        p = line
        if not p.lower().startswith(cfg["trigger"]):
            p = "%s，%s" % (cfg["trigger"], p)
        wf["88"]["inputs"]["value"] = p
        # batch_size 始终为 1（逐行提交）
        wf["85"]["inputs"]["value"] = 1

        # 随机种子：若用户指定了 seed，每张图用不同种子（+i）
        if args.seed and args.seed > 0:
            wf["73"]["inputs"]["seed"] = args.seed + i

        print("[comfy] krea2 batch %d/%d: %s" % (i + 1, len(lines), p[:60]), flush=True)
        res = submit_and_wait(wf, args.timeout)
        all_results.extend(res)

    return all_results

def cmd_edit(args):
    global JOB
    JOB = args.name

    wf = load_wf(WF_EDIT)

    if args.seed and args.seed > 0:
        wf["73"]["inputs"]["seed"] = args.seed
    if args.steps and args.steps > 0:
        wf["3"]["inputs"]["steps"] = args.steps

    img_name = upload_image(args.image)
    wf["96"]["inputs"]["value"] = img_name
    wf["102"]["inputs"]["value"] = args.prompt

    print("[comfy] edit: %s" % args.prompt[:60], flush=True)
    return submit_and_wait(wf, args.timeout)

def cmd_ernie(args):
    global JOB
    JOB = args.name

    wf = load_wf(WF_ERNIE)

    # ernie workflow: seed/steps/cfg=95(KSampler), prompt=98, size=92
    if args.seed and args.seed > 0:
        wf["95"]["inputs"]["seed"] = args.seed
    if args.steps and args.steps > 0:
        wf["95"]["inputs"]["steps"] = args.steps

    if args.size:
        try:
            w, h = args.size.lower().split("x")
            wf["92"]["inputs"]["width"] = int(w)
            wf["92"]["inputs"]["height"] = int(h)
        except Exception:
            sys.stderr.write("[comfy] bad --size, expect WxH e.g. 1080x1920\n")
            sys.exit(2)

    lines = [l.strip() for l in args.prompt.splitlines() if l.strip()]
    if not lines:
        lines = [args.prompt]

    all_results = []
    for i, line in enumerate(lines):
        if args.seed and args.seed > 0:
            wf["95"]["inputs"]["seed"] = args.seed + i
        wf["98"]["inputs"]["value"] = line
        print("[comfy] ernie batch %d/%d: %s" % (i + 1, len(lines), line[:60]), flush=True)
        res = submit_and_wait(wf, args.timeout)
        all_results.extend(res)

    return all_results

def cmd_klein(args):
    global JOB
    JOB = args.name

    wf = load_wf(WF_KLEIN)

    # klein workflow 节点: seed=107, steps=85, cfg=86, sampler=84, size=85+89
    if args.seed and args.seed > 0:
        wf["107"]["inputs"]["seed"] = args.seed
    if args.steps and args.steps > 0:
        wf["85"]["inputs"]["steps"] = args.steps

    if args.cfg and args.cfg > 0:
        wf["86"]["inputs"]["cfg"] = args.cfg
    if args.sampler:
        wf["84"]["inputs"]["sampler_name"] = args.sampler

    if args.size:
        try:
            w, h = args.size.lower().split("x")
            w, h = int(w), int(h)
            wf["85"]["inputs"]["width"] = w
            wf["85"]["inputs"]["height"] = h
            wf["89"]["inputs"]["width"] = w
            wf["89"]["inputs"]["height"] = h
        except Exception:
            sys.stderr.write("[comfy] bad --size, expect WxH e.g. 1080x1920\n")
            sys.exit(2)

    lines = [l.strip() for l in args.prompt.splitlines() if l.strip()]
    if not lines:
        lines = [args.prompt]

    all_results = []
    for i, line in enumerate(lines):
        neg = args.negative if args.negative else ""
        if args.seed and args.seed > 0:
            wf["107"]["inputs"]["seed"] = args.seed + i
        wf["90"]["inputs"]["text"] = line
        wf["76"]["inputs"]["value"] = neg
        print("[comfy] klein batch %d/%d: %s" % (i + 1, len(lines), line[:60]), flush=True)
        res = submit_and_wait(wf, args.timeout)
        all_results.extend(res)

    return all_results

def cmd_zimage(args):
    global JOB
    JOB = args.name

    wf = load_wf(WF_ZIMAGE)

    # zimage workflow: seed/steps/cfg=4(KSampler), prompt=88, size=62/63
    if args.seed and args.seed > 0:
        wf["4"]["inputs"]["seed"] = args.seed
    if args.steps and args.steps > 0:
        wf["4"]["inputs"]["steps"] = args.steps

    if args.size:
        try:
            w, h = args.size.lower().split("x")
            wf["62"]["inputs"]["value"] = int(w)
            wf["63"]["inputs"]["value"] = int(h)
        except Exception:
            sys.stderr.write("[comfy] bad --size, expect WxH e.g. 1080x1920\n")
            sys.exit(2)

    lines = [l.strip() for l in args.prompt.splitlines() if l.strip()]
    if not lines:
        lines = [args.prompt]

    all_results = []
    for i, line in enumerate(lines):
        if args.seed and args.seed > 0:
            wf["4"]["inputs"]["seed"] = args.seed + i
        wf["88"]["inputs"]["value"] = line
        print("[comfy] zimage batch %d/%d: %s" % (i + 1, len(lines), line[:60]), flush=True)
        res = submit_and_wait(wf, args.timeout)
        all_results.extend(res)

    return all_results

def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    k2 = sub.add_parser("krea2", help="Krea2 Muse (artistic, text encoder: qwen3vl_4b_fp8, multi-line prompt)")
    k2.add_argument("prompt", nargs='?', default=None, help="prompt text (supports multi-line batch, each line = one image). Use '-' to read from stdin.")
    k2.add_argument("--prompt-file", default=None, help="read prompt from file (preserves newlines)")
    k2.add_argument("--seed", type=int, default=0)
    k2.add_argument("--steps", type=int, default=0)
    k2.add_argument("--size", default="1080x1920", help="WxH, e.g. 1080x1920 or 1920x1080")
    k2.add_argument("--protagonist", default="liuyifei", choices=["liuyifei", "kopiu"],
                    help="主角 LoRA 开关：liuyifei（默认）或 kopiu。自动切换 LoRA strength 并在提示词前加 trigger 词")
    k2.add_argument("--name", default="krea2")
    k2.add_argument("--timeout", type=int, default=600)
    k2.add_argument("--output", default="", help="图片输出目录（默认 E:\\workspace\\comfyui_out）")
    k2.set_defaults(func=cmd_krea2)

    e = sub.add_parser("edit", help="edit an image by instruction")
    e.add_argument("image", help="local image path to edit")
    e.add_argument("prompt", help="edit instruction, e.g. '脱掉人物上衣'")
    e.add_argument("--seed", type=int, default=0)
    e.add_argument("--steps", type=int, default=0)
    e.add_argument("--name", default="edit")
    e.add_argument("--timeout", type=int, default=600)
    e.add_argument("--output", default="", help="图片输出目录（默认 E:\\workspace\\comfyui_out）")
    e.set_defaults(func=cmd_edit)

    n = sub.add_parser("ernie", help="Ernie-Image-Turbo (good text rendering, multi-line prompt)")
    n.add_argument("prompt", help="prompt text (supports multi-line batch, each line = one image)")
    n.add_argument("--seed", type=int, default=0)
    n.add_argument("--steps", type=int, default=0)
    n.add_argument("--size", default="", help="WxH override, e.g. 768x1280")
    n.add_argument("--name", default="ernie")
    n.add_argument("--timeout", type=int, default=600)
    n.add_argument("--output", default="", help="图片输出目录（默认 E:\\workspace\\comfyui_out）")
    n.set_defaults(func=cmd_ernie)

    z = sub.add_parser("zimage", help="Z-image turbo (distilled, 9 steps, cfg=1, multi-line prompt)")
    z.add_argument("prompt", help="prompt text (supports multi-line batch, each line = one image)")
    z.add_argument("--seed", type=int, default=0)
    z.add_argument("--steps", type=int, default=0)
    z.add_argument("--size", default="1920x1080", help="WxH, e.g. 1920x1080 or 1080x1080")
    z.add_argument("--lora-person", default="", help="path to a person LoRA to insert between 68 and KSampler (rare use)")
    z.add_argument("--lora-strength", type=float, default=0.8)
    z.add_argument("--with-colleague", action="store_true", help="enable the baked-in colleague LoRA (kopiu-Z) — only for the colleague's face")
    z.add_argument("--name", default="zimage")
    z.add_argument("--timeout", type=int, default=600)
    z.add_argument("--output", default="", help="图片输出目录（默认 E:\\workspace\\comfyui_out）")
    z.set_defaults(func=cmd_zimage)

    k = sub.add_parser("klein", help="Flux2-Klein standalone (free size, high realism, multi-line prompt)")
    k.add_argument("prompt", help="prompt text (supports multi-line batch, each line = one image)")
    k.add_argument("--negative", default="")
    k.add_argument("--size", default="832x1216", help="WxH, e.g. 832x1216 or 1920x1080")
    k.add_argument("--seed", type=int, default=0)
    k.add_argument("--steps", type=int, default=0)
    k.add_argument("--cfg", type=float, default=0, help="CFG scale override (default from workflow)")
    k.add_argument("--sampler", default="", help="sampler name override, e.g. euler, dpmpp_2m")
    k.add_argument("--name", default="klein")
    k.add_argument("--timeout", type=int, default=600)
    k.add_argument("--output", default="", help="图片输出目录（默认 E:\\workspace\\comfyui_out）")
    k.set_defaults(func=cmd_klein)

    a = ap.parse_args()
    global _out_dir_override
    _out_dir_override = resolve_out_dir(getattr(a, "output", "") or None)
    res = a.func(a)
    print("RESULT:" + json.dumps(res, ensure_ascii=False))

if __name__ == "__main__":
    main()
