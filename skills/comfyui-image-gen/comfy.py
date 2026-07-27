COMFY = os.environ.get("COMFY_URL", "http://47.108.197.247:8188").rstrip("/")
SKILL_DIR = os.path.dirname(os.path.abspath(__file__))
_OUT_DIR_DEFAULT = r"E:\workspace\comfyui_out"


def resolve_out_dir(args_out_dir=None):
    """Resolve output directory: CLI arg > COMFY_OUT env > hardcoded default."""
    if args_out_dir:
        return os.path.abspath(args_out_dir)
    env = os.environ.get("COMFY_OUT", "")
    if env:
        return os.path.abspath(env)
    return os.path.abspath(_OUT_DIR_DEFAULT)


# _out_dir_override is set in main() after argparse so cmd_* funcs can use it
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
        body = e.read().decode("utf-8", "replace")
        sys.stderr.write("[comfy] HTTP %d on %s: %s\n" % (e.code, path, body))
        sys.exit(2)


def _get(path):
    req = urllib.request.Request(COMFY + path, method="GET")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def upload_image(path):
    with open(path, "rb") as f:
        data = f.read()
    boundary = b"----opencodebound"
    bd = b"--" + boundary
    fname = os.path.basename(path)
    body = (bd + b'\r\nContent-Disposition: form-data; name="image"; filename="' +
            fname.encode("utf-8") + b'"\r\nContent-Type: application/octet-stream\r\n\r\n' +
            data + b"\r\n" + bd + b"--\r\n")
    resp = _post("/upload/image", body, raw=True,
                 headers={"Content-Type": "multipart/form-data; boundary=" + boundary.decode()})
    return json.loads(resp)["name"]


def submit_and_wait(wf, timeout):
    payload = {"prompt": wf, "client_id": "opencode-skill"}
    resp = json.loads(_post("/prompt", payload))
    pid = resp["prompt_id"]
    print("[comfy] prompt_id=%s submitted. waiting..." % pid, flush=True)
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            hist = _get("/history/%s" % pid)
        except Exception:
            hist = {}
        if pid in hist:
            outputs = hist[pid].get("outputs", {})
            out_dir = get_out_dir()
            os.makedirs(out_dir, exist_ok=True)
            saved = []
            for node_id, out in outputs.items():
                for img in out.get("images", []):
                    fname = img.get("filename")
                    sub = img.get("subfolder", "")
                    ftype = img.get("type", "output")
                    url = ("/view?filename=" + urllib.parse.quote(fname) +
                           "&subfolder=" + urllib.parse.quote(sub) + "&type=" + ftype)
                    try:
                        req = urllib.request.Request(COMFY + url, method="GET")
                        with urllib.request.urlopen(req, timeout=60) as r:
                            blob = r.read()
                        out_path = os.path.join(out_dir, "%s_%s_%s" % (JOB, node_id, fname))
                        with open(out_path, "wb") as f:
                            f.write(blob)
                        saved.append(out_path)
                        print("[comfy] saved %s: %s" % (node_id, out_path), flush=True)
                    except Exception as e:
                        print("[comfy] view failed %s: %s" % (fname, e), flush=True)
            if saved:
                # VRAM 释放交给 llm-manager（在 ComfyUI 队列空 + 空闲 N 秒后统一 free）
                # 不要在每张生图后调 /free —— 批量生图时会让每张都重载模型，反而慢
                return saved
            print("[comfy] finished but no images captured. keys: %s" % list(outputs.keys()), flush=True)
            return []
        time.sleep(3)
    raise TimeoutError("timeout after %ss for %s" % (timeout, pid))


def load_wf(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


JOB = "gen"


RATIO_JSON = os.path.join(SKILL_DIR, "ratios.json")


def load_ratios():
    try:
        with open(RATIO_JSON, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def resolve_ratio(value):
    """Map a shorthand (e.g. '4:3') or full preset name to the exact
    Dapao node preset string. Falls back to the input as-is."""
    if not value:
        return value
    ratios = load_ratios()
    v = value.strip()
    if v in ratios:
        return ratios[v]
    # maybe caller passed a full preset name already
    for full in ratios.values():
        if full == v:
            return full
    return v


# Krea2 双主角 LoRA 开关：选中的主角 strength=1，另一个=0
# 链路固定：84(底模) -> 90(kopiu) -> 91(liuyifei) -> 83(TextFusion) -> 76 -> 66 -> 3
KREA2_PROTAGONISTS = {
    "liuyifei": {"trigger": "liuyifei", "liu_strength": 1, "kop_strength": 0},
    "kopiu":    {"trigger": "kopiu",    "liu_strength": 0, "kop_strength": 1},
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
    if not os.path.exists(args.image):
        sys.stderr.write("[comfy] image not found: %s\n" % args.image)
        sys.exit(2)
    print("[comfy] uploading %s ..." % args.image, flush=True)
    remote = upload_image(args.image)
    print("[comfy] uploaded as %s" % remote, flush=True)
    wf = load_wf(WF_EDIT)
    wf["76"]["inputs"]["image"] = remote
    wf["117"]["inputs"]["text"] = args.prompt
    if args.seed and args.seed > 0:
        wf["102"]["inputs"]["noise_seed"] = args.seed
    if args.steps and args.steps > 0:
        wf["109"]["inputs"]["steps"] = args.steps
    return submit_and_wait(wf, args.timeout)


def cmd_ernie(args):
    global JOB
    JOB = args.name
    wf = load_wf(WF_ERNIE)
    # Node 98 receives the prompt text (supports multi-line batch via CR Prompt List node 99)
    wf["98"]["inputs"]["value"] = args.prompt
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
            sys.stderr.write("[comfy] bad --size, expect WxH e.g. 768x1280\n")
            sys.exit(2)
    return submit_and_wait(wf, args.timeout)


def cmd_klein(args):
    global JOB
    JOB = args.name
    wf = load_wf(WF_KLEIN)
    # Node 76 receives the prompt text (supports multi-line batch via CR Prompt List node 98)
    wf["76"]["inputs"]["value"] = args.prompt
    wf["90"]["inputs"]["text"] = args.negative if args.negative else ""
    if args.size:
        try:
            w, h = args.size.lower().split("x")
            wf["85"]["inputs"]["width"] = int(w)
            wf["85"]["inputs"]["height"] = int(h)
            wf["89"]["inputs"]["width"] = int(w)
            wf["89"]["inputs"]["height"] = int(h)
        except Exception:
            sys.stderr.write("[comfy] bad --size, expect WxH e.g. 832x1216\n")
            sys.exit(2)
    if args.seed and args.seed > 0:
        wf["107"]["inputs"]["seed"] = args.seed
    if args.steps and args.steps > 0:
        wf["85"]["inputs"]["steps"] = args.steps
    if args.cfg:
        wf["86"]["inputs"]["cfg"] = args.cfg
    if args.sampler:
        wf["84"]["inputs"]["sampler_name"] = args.sampler
    return submit_and_wait(wf, args.timeout)


def cmd_zimage(args):
    global JOB
    JOB = args.name
    wf = load_wf(WF_ZIMAGE)
    # Node 88 receives the prompt text (supports multi-line batch via CR Prompt List node 89)
    wf["88"]["inputs"]["value"] = args.prompt
    if args.seed and args.seed > 0:
        wf["4"]["inputs"]["seed"] = args.seed
    if args.steps and args.steps > 0:
        wf["4"]["inputs"]["steps"] = args.steps
    if args.with_colleague:
        wf["69"] = {
            "inputs": {
                "lora_name": "z-image\\人物lora\\kopiu-Z.safetensors",
                "strength_model": 1,
                "model": ["68", 0]
            },
            "class_type": "LoraLoaderModelOnly"
        }
        wf["4"]["inputs"]["model"] = ["69", 0]
    if args.lora_person:
        # Override the colleague LoRA with user-specified LoRA
        wf["69"] = {
            "inputs": {
                "lora_name": args.lora_person,
                "strength_model": args.lora_strength,
                "model": ["68", 0]
            },
            "class_type": "LoraLoaderModelOnly"
        }
        wf["4"]["inputs"]["model"] = ["69", 0]
    if args.size:
        try:
            w, h = args.size.lower().split("x")
            wf["63"]["inputs"]["value"] = int(w)
            wf["62"]["inputs"]["value"] = int(h)
        except Exception:
            sys.stderr.write("[comfy] bad --size, expect WxH e.g. 1920x1080\n")
            sys.exit(2)
    return submit_and_wait(wf, args.timeout)


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
    z.add_argument("--size", default="1920x1080", help="WxH, e.g. 1920x1080 or 1080x1920")
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
