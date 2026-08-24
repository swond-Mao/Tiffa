#!/usr/bin/env python3
"""office-connector：基于 LibreOffice UNO 的 Office 文档原子编辑工具。

任意 Python 运行本脚本都会自动切换到 LibreOffice 自带 Python（含 uno 模块）。

用法:
    python uno_client.py open <file>                         # 打开并输出文档信息
    python uno_client.py list-elements <file> [--page N]     # 列出元素树（PPT）
    python uno_client.py set-text <file> <name> <text> [--page N]
    python uno_client.py set-pos <file> <name> <x> <y> [--page N]
    python uno_client.py set-size <file> <name> <w> <h> [--page N]
    python uno_client.py set-font-size <file> <name> <size> [--page N]
    python uno_client.py set-font <file> <name> <font> [--page N]
    python uno_client.py align <file> <target> <anchor> <mode> [--page N]
        mode: left | right | top | bottom | hcenter | vcenter
    python uno_client.py export-preview <file> <out> [--page N]
    python uno_client.py save-as <file> <out>

说明: 完整编辑能力面向演示文稿(PPT/ODP)；Writer/Calc 支持打开/读取/导出/另存。
"""
import argparse
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import lo_path  # noqa: E402
import start_server  # noqa: E402


def _bootstrap():
    try:
        import uno  # noqa: F401  当前 Python 已含 uno（LibreOffice 自带），直接用
        return
    except ImportError:
        pass
    lo_py = lo_path.find_lo_python()
    if not lo_py:
        print("未找到 LibreOffice。请先运行 deploy/deploy_libreoffice.py 部署。")
        sys.exit(2)
    r = subprocess.run([lo_py] + sys.argv)
    sys.exit(r.returncode)


_bootstrap()

import uno  # noqa: E402
from com.sun.star.beans import PropertyValue  # noqa: E402


def pv(name, value):
    p = PropertyValue()
    p.Name = name
    p.Value = value
    return p


def connect(port=start_server.PORT):
    localContext = uno.getComponentContext()
    resolver = localContext.ServiceManager.createInstanceWithContext(
        "com.sun.star.bridge.UnoUrlResolver", localContext)
    ctx = resolver.resolve(
        "uno:socket,host=127.0.0.1,port=%d;urp;StarOffice.ComponentContext" % port)
    smgr = ctx.ServiceManager
    return smgr.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)


def connect_with_retry(port=start_server.PORT, tries=6, gap=3):
    last = None
    for _ in range(tries):
        try:
            return connect(port)
        except Exception as e:
            last = e
            time.sleep(gap)
    raise RuntimeError("UNO 连接失败: %s" % last)


def open_doc(desktop, path):
    url = "file:///" + os.path.abspath(path).replace("\\", "/")
    doc = desktop.loadComponentFromURL(url, "_blank", 0, ())
    if doc is None:
        raise RuntimeError("打开文档失败: %s" % path)
    return doc


def kind(doc):
    svc = doc.SupportedServiceNames
    if "com.sun.star.presentation.PresentationDocument" in svc:
        return "impress"
    if "com.sun.star.sheet.SpreadsheetDocument" in svc:
        return "calc"
    return "writer"


def get_page(doc, n=0):
    k = kind(doc)
    if k == "impress":
        return doc.getDrawPages().getByIndex(n)
    if k == "calc":
        return doc.getSheets().getByIndex(n)
    return doc.getText()


def find_shape(page, name):
    for i in range(page.getCount()):
        sh = page.getByIndex(i)
        if sh.getName() == name:
            return sh
    raise RuntimeError("未找到元素: %s" % name)


def P(x, y):
    return uno.createUnoStruct("com.sun.star.awt.Point", int(x), int(y))


def S(w, h):
    return uno.createUnoStruct("com.sun.star.awt.Size", int(w), int(h))


def safe_close(doc):
    try:
        doc.close(False)
    except Exception:
        pass  # close 可能报桥断开，但文档已实际关闭，服务端保持干净


def save_doc(doc, path):
    k = kind(doc)
    ext = os.path.splitext(path)[1].lower()
    if ext == ".pptx":
        filt = "Impress MS PowerPoint 2007 XML"
    elif ext == ".odp":
        filt = "impress8"
    elif ext == ".docx":
        filt = "MS Word 2007 XML"
    elif ext == ".odt":
        filt = "writer8"
    elif ext == ".xlsx":
        filt = "Calc MS Excel 2007 XML"
    elif ext == ".ods":
        filt = "calc8"
    else:
        filt = {"impress": "impress8", "writer": "writer8", "calc": "calc8"}[k]
    doc.storeToURL("file:///" + os.path.abspath(path).replace("\\", "/"),
                   (pv("FilterName", filt),))


def cmd_open(desktop, args):
    doc = open_doc(desktop, args.file)
    k = kind(doc)
    if k == "impress":
        pages = doc.getDrawPages()
        print("type=impress pages=%d" % pages.getCount())
        for p in range(pages.getCount()):
            print("page %d shapes=%d" % (p, pages.getByIndex(p).getCount()))
    elif k == "calc":
        print("type=calc sheets=%d" % doc.getSheets().getCount())
    else:
        print("type=writer")
    safe_close(doc)


def cmd_list(desktop, args):
    doc = open_doc(desktop, args.file)
    k = kind(doc)
    if k == "impress":
        page = get_page(doc, args.page)
        print("page %d shapes=%d" % (args.page, page.getCount()))
        for i in range(page.getCount()):
            sh = page.getByIndex(i)
            pos, sz = sh.getPosition(), sh.getSize()
            txt = ""
            try:
                txt = sh.getString()[:40]
            except Exception:
                pass
            print("  [%d] name=%s type=%s pos=(%d,%d) size=(%d,%d) text=%s" % (
                i, sh.getName(), sh.getShapeType(), pos.X, pos.Y, sz.Width, sz.Height, txt))
    elif k == "writer":
        text = doc.getText()
        for i, para in enumerate(text.getText().createEnumeration()):
            try:
                print("  para %d: %s" % (i, para.getString()[:80]))
            except Exception:
                pass
    else:
        sheet = get_page(doc, args.page)
        print("sheet %s rows=%d cols=%d" % (sheet.getName(), sheet.getRows().getCount(), sheet.getColumns().getCount()))
    safe_close(doc)


def cmd_set_text(desktop, args):
    doc = open_doc(desktop, args.file)
    if kind(doc) != "impress":
        raise RuntimeError("set-text 暂仅支持演示文稿")
    sh = find_shape(get_page(doc, args.page), args.name)
    sh.setString(args.text)
    save_doc(doc, args.file)
    print("set-text OK: %s = %s" % (args.name, args.text))
    safe_close(doc)


def cmd_set_pos(desktop, args):
    doc = open_doc(desktop, args.file)
    if kind(doc) != "impress":
        raise RuntimeError("set-pos 暂仅支持演示文稿")
    sh = find_shape(get_page(doc, args.page), args.name)
    sh.setPosition(P(args.x, args.y))
    save_doc(doc, args.file)
    print("set-pos OK: %s -> (%s,%s)" % (args.name, args.x, args.y))
    safe_close(doc)


def cmd_set_size(desktop, args):
    doc = open_doc(desktop, args.file)
    if kind(doc) != "impress":
        raise RuntimeError("set-size 暂仅支持演示文稿")
    sh = find_shape(get_page(doc, args.page), args.name)
    sh.setSize(S(args.w, args.h))
    save_doc(doc, args.file)
    print("set-size OK: %s -> (%s,%s)" % (args.name, args.w, args.h))
    safe_close(doc)


def cmd_set_font_size(desktop, args):
    doc = open_doc(desktop, args.file)
    if kind(doc) != "impress":
        raise RuntimeError("set-font-size 暂仅支持演示文稿")
    sh = find_shape(get_page(doc, args.page), args.name)
    sh.TextFrame.TextRange.CharHeight = float(args.size)
    save_doc(doc, args.file)
    print("set-font-size OK: %s -> %s" % (args.name, args.size))
    safe_close(doc)


def cmd_set_font(desktop, args):
    doc = open_doc(desktop, args.file)
    if kind(doc) != "impress":
        raise RuntimeError("set-font 暂仅支持演示文稿")
    sh = find_shape(get_page(doc, args.page), args.name)
    sh.TextFrame.TextRange.CharFontName = args.font
    save_doc(doc, args.file)
    print("set-font OK: %s -> %s" % (args.name, args.font))
    safe_close(doc)


def cmd_align(desktop, args):
    doc = open_doc(desktop, args.file)
    if kind(doc) != "impress":
        raise RuntimeError("align 暂仅支持演示文稿")
    page = get_page(doc, args.page)
    t = find_shape(page, args.target)
    a = find_shape(page, args.anchor)
    tp, ap = t.getPosition(), a.getPosition()
    ts, asz = t.getSize(), a.getSize()
    x, y = tp.X, tp.Y
    if args.mode == "left":
        x = ap.X
    elif args.mode == "right":
        x = ap.X + asz.Width - ts.Width
    elif args.mode == "top":
        y = ap.Y
    elif args.mode == "bottom":
        y = ap.Y + asz.Height - ts.Height
    elif args.mode == "hcenter":
        x = ap.X + (asz.Width - ts.Width) // 2
    elif args.mode == "vcenter":
        y = ap.Y + (asz.Height - ts.Height) // 2
    else:
        raise RuntimeError("未知对齐模式: %s" % args.mode)
    t.setPosition(P(x, y))
    save_doc(doc, args.file)
    print("align OK: %s %s-> %s (%d,%d)" % (args.target, args.mode, args.anchor, x, y))
    safe_close(doc)


def cmd_export(desktop, args):
    doc = open_doc(desktop, args.file)
    k = kind(doc)
    out = os.path.abspath(args.out)
    if not out.lower().endswith(".pdf"):
        out = out.rsplit(".", 1)[0] + ".pdf"
    filt = {"impress": "impress_pdf_Export", "writer": "writer_pdf_Export", "calc": "calc_pdf_Export"}[k]
    doc.storeToURL("file:///" + out.replace("\\", "/"), (pv("FilterName", filt),))
    print("exported %s" % out)
    safe_close(doc)


def cmd_save_as(desktop, args):
    doc = open_doc(desktop, args.file)
    save_doc(doc, args.out)
    print("saved %s" % args.out)
    safe_close(doc)


def _probe_health(timeout=10):
    probe = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_health_probe.py")
    try:
        r = subprocess.run([sys.executable, probe], timeout=timeout, capture_output=True)
        return r.returncode == 0
    except Exception:
        return False


def _build_parser():
    ap = argparse.ArgumentParser(description="office-connector UNO 工具")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("open"); p.add_argument("file")
    p = sub.add_parser("list-elements"); p.add_argument("file"); p.add_argument("--page", type=int, default=0)
    p = sub.add_parser("set-text"); p.add_argument("file"); p.add_argument("name"); p.add_argument("text"); p.add_argument("--page", type=int, default=0)
    p = sub.add_parser("set-pos"); p.add_argument("file"); p.add_argument("name"); p.add_argument("x", type=int); p.add_argument("y", type=int); p.add_argument("--page", type=int, default=0)
    p = sub.add_parser("set-size"); p.add_argument("file"); p.add_argument("name"); p.add_argument("w", type=int); p.add_argument("h", type=int); p.add_argument("--page", type=int, default=0)
    p = sub.add_parser("set-font-size"); p.add_argument("file"); p.add_argument("name"); p.add_argument("size", type=float); p.add_argument("--page", type=int, default=0)
    p = sub.add_parser("set-font"); p.add_argument("file"); p.add_argument("name"); p.add_argument("font"); p.add_argument("--page", type=int, default=0)
    p = sub.add_parser("align"); p.add_argument("file"); p.add_argument("target"); p.add_argument("anchor"); p.add_argument("mode", choices=["left", "right", "top", "bottom", "hcenter", "vcenter"]); p.add_argument("--page", type=int, default=0)
    p = sub.add_parser("export-preview"); p.add_argument("file"); p.add_argument("out"); p.add_argument("--page", type=int, default=0)
    p = sub.add_parser("save-as"); p.add_argument("file"); p.add_argument("out")
    return ap


def cmd_export_cli(args):
    """export-preview 用命令行转换（完全稳定，不依赖 UNO 服务）。"""
    lo_dir = lo_path.find_libreoffice_dir()
    if not lo_dir:
        raise SystemExit("未找到 LibreOffice")
    exe = os.path.join(lo_dir, "program", "soffice.exe")
    profile = "file:///%s" % (lo_dir + "/profile").replace("\\", "/")
    out_dir = os.path.dirname(os.path.abspath(args.out)) or "."
    os.makedirs(out_dir, exist_ok=True)
    r = subprocess.run(
        [exe, "--headless", "-env:UserInstallation=%s" % profile,
         "--convert-to", "pdf", "--outdir", out_dir, args.file],
        capture_output=True, timeout=120)
    if r.returncode != 0:
        raise SystemExit("转换失败: %s" % r.stderr.decode("utf-8", "ignore")[:200])
    print("exported %s" % args.out)


def cmd_export(desktop, args):
    cmd_export_cli(args)
    safe_close(open_doc(desktop, args.file))


def main_run():
    """子进程模式：服务已就绪，直接执行 UNO 命令。"""
    args = _build_parser().parse_args()
    desktop = connect_with_retry()
    try:
        {"open": cmd_open, "list-elements": cmd_list, "set-text": cmd_set_text,
         "set-pos": cmd_set_pos, "set-size": cmd_set_size,
         "set-font-size": cmd_set_font_size, "set-font": cmd_set_font,
         "align": cmd_align, "export-preview": cmd_export,
         "save-as": cmd_save_as}[args.cmd](desktop, args)
    except Exception as e:
        print("ERROR: %s" % e)
        sys.exit(1)


def main():
    args = _build_parser().parse_args()
    # export-preview 走命令行转换，完全不需要 UNO 服务
    if args.cmd == "export-preview":
        cmd_export_cli(args)
        return
    script = os.path.abspath(__file__)
    for attempt in range(5):
        start_server.stop_server()
        if not start_server.ensure_server():
            raise SystemExit("UNO 服务启动失败")
        child = [lo_path.find_lo_python() or sys.executable, script, "--run"] + sys.argv[1:]
        try:
            r = subprocess.run(child, timeout=60)
            if r.returncode == 0:
                return
            print("命令失败(rc=%d)，重启服务重试 (%d/3)..." % (r.returncode, attempt + 1))
        except subprocess.TimeoutExpired:
            print("命令超时，重启服务重试 (%d/3)..." % (attempt + 1))
        finally:
            start_server.stop_server()
    raise SystemExit("命令多次失败，请检查文件或服务状态")


if __name__ == "__main__":
    if "--run" in sys.argv:
        sys.argv.remove("--run")
        main_run()
    else:
        main()
