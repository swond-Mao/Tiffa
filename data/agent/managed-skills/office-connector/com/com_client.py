"""office-connector：WPS/MS Office COM 引擎原子工具（Windows，需本机装有 WPS 或 Office）。

用法（坐标单位为磅 pt，16:9 页面约 960x540pt）:
    python com_client.py open <file>                          # 文档信息
    python com_client.py list-elements <file> [--page N]      # 元素树
    python com_client.py set-text <file> <name> <text> [--page N]
    python com_client.py set-pos <file> <name> <x> <y> [--page N]
    python com_client.py set-size <file> <name> <w> <h> [--page N]
    python com_client.py set-font-size <file> <name> <size> [--page N]
    python com_client.py set-font <file> <name> <font> [--page N]
    python com_client.py align <file> <target> <anchor> <mode> [--page N]
        mode: left | right | top | bottom | hcenter | vcenter
    python com_client.py add-shape <file> rect|ellipse <name> <x> <y> <w> <h> [--text T] [--page N]
    python com_client.py export-preview <file> <out.pdf>
    python com_client.py save-as <file> <out>

引擎自动检测: KWPP.Application(WPS 演示) -> PowerPoint.Application(MS Office)。
每个命令独立进程: Dispatch -> 打开 -> 操作 -> 保存 -> finally 关闭+Quit（保证无残留）。
"""
import argparse
import os
import sys
import time

import win32com.client

PROGIDS = ["KWPP.Application", "PowerPoint.Application"]


def detect_engine():
    last = None
    for progid in PROGIDS:
        try:
            app = win32com.client.Dispatch(progid)
            if app is not None:
                return progid, app
        except Exception as e:
            last = e
    raise RuntimeError("未找到可用的 Office/WPS COM 引擎: %s" % last)


def open_pres(app, path):
    full = os.path.abspath(path)
    pres = app.Presentations.Open(full, False, False, False)  # WithWindow=False
    if pres is None:
        raise RuntimeError("打开失败: %s" % path)
    return pres


def find_shape(slide, name):
    for i in range(1, slide.Shapes.Count + 1):
        sh = slide.Shapes(i)
        if sh.Name == name:
            return sh
    raise RuntimeError("未找到元素: %s" % name)


def shape_text(sh):
    try:
        return sh.TextFrame.TextRange.Text[:40].replace("\r", " ")
    except Exception:
        return ""


def get_slide(pres, page):
    return pres.Slides(min(max(page, 1), pres.Slides.Count))


def list_page(sl, label):
    print("%s shapes=%d" % (label, sl.Shapes.Count))
    for i in range(1, sl.Shapes.Count + 1):
        sh = sl.Shapes(i)
        print("  [%d] name=%s pos=(%d,%d) size=(%d,%d) text=%s" % (
            i, sh.Name, sh.Left, sh.Top, sh.Width, sh.Height, shape_text(sh)))


def run_command(args):
    progid, app = detect_engine()
    print("engine=%s" % progid, flush=True)
    pres = None
    try:
        if args.cmd == "open":
            pres = open_pres(app, args.file)
            print("slides=%d" % pres.Slides.Count)

        elif args.cmd == "list-elements":
            pres = open_pres(app, args.file)
            list_page(get_slide(pres, args.page), "page %d:" % args.page)

        elif args.cmd == "set-text":
            pres = open_pres(app, args.file)
            find_shape(get_slide(pres, args.page), args.name).TextFrame.TextRange.Text = args.text
            pres.Save()
            print("set-text OK: %s = %s" % (args.name, args.text))

        elif args.cmd == "set-pos":
            pres = open_pres(app, args.file)
            sh = find_shape(get_slide(pres, args.page), args.name)
            sh.Left, sh.Top = int(args.x), int(args.y)
            pres.Save()
            print("set-pos OK: %s -> (%s,%s)" % (args.name, args.x, args.y))

        elif args.cmd == "set-size":
            pres = open_pres(app, args.file)
            sh = find_shape(get_slide(pres, args.page), args.name)
            sh.Width, sh.Height = int(args.w), int(args.h)
            pres.Save()
            print("set-size OK: %s -> (%s,%s)" % (args.name, args.w, args.h))

        elif args.cmd == "set-font-size":
            pres = open_pres(app, args.file)
            find_shape(get_slide(pres, args.page), args.name).TextFrame.TextRange.Font.Size = float(args.size)
            pres.Save()
            print("set-font-size OK: %s -> %s" % (args.name, args.size))

        elif args.cmd == "set-font":
            pres = open_pres(app, args.file)
            find_shape(get_slide(pres, args.page), args.name).TextFrame.TextRange.Font.Name = args.font
            pres.Save()
            print("set-font OK: %s -> %s" % (args.name, args.font))

        elif args.cmd == "align":
            pres = open_pres(app, args.file)
            sl = get_slide(pres, args.page)
            t = find_shape(sl, args.target)
            a = find_shape(sl, args.anchor)
            x, y = t.Left, t.Top
            if args.mode == "left":
                x = a.Left
            elif args.mode == "right":
                x = a.Left + a.Width - t.Width
            elif args.mode == "top":
                y = a.Top
            elif args.mode == "bottom":
                y = a.Top + a.Height - t.Height
            elif args.mode == "hcenter":
                x = a.Left + (a.Width - t.Width) // 2
            elif args.mode == "vcenter":
                y = a.Top + (a.Height - t.Height) // 2
            else:
                raise RuntimeError("未知对齐模式: %s" % args.mode)
            t.Left, t.Top = x, y
            pres.Save()
            print("align OK: %s %s-> (%d,%d)" % (args.target, args.mode, x, y))

        elif args.cmd == "add-shape":
            pres = open_pres(app, args.file)
            sl = get_slide(pres, args.page)
            sid = 9 if args.kind == "ellipse" else 1  # msoShapeOval / msoShapeRectangle
            sh = sl.Shapes.AddShape(sid, int(args.x), int(args.y), int(args.w), int(args.h))
            sh.Name = args.name
            try:
                if getattr(args, "text", ""):
                    sh.TextFrame.TextRange.Text = args.text
            except Exception:
                pass
            pres.Save()
            print("add-shape OK: %s (%s)" % (args.name, args.kind))

        elif args.cmd == "export-preview":
            pres = open_pres(app, args.file)
            out = os.path.abspath(args.out)
            if not out.lower().endswith(".pdf"):
                out = os.path.splitext(out)[0] + ".pdf"
            pres.SaveAs(out, 32)  # ppSaveAsPDF
            print("exported %s" % out)

        elif args.cmd == "save-as":
            ext = os.path.splitext(args.out)[1].lower()
            fmt = {".pptx": 24, ".ppt": 1, ".odp": 60,
                   ".docx": 16, ".xlsx": 51}.get(ext)
            if fmt is None:
                raise RuntimeError("不支持的输出格式: %s" % ext)
            pres.SaveAs(os.path.abspath(args.out), fmt)
            print("saved %s" % args.out)

        else:
            raise RuntimeError("未知命令: %s" % args.cmd)

    except Exception as e:
        print("ERROR: %s" % e)
        sys.exit(1)
    finally:
        # 关键：异常路径也必须关闭文档并退出 COM 应用，否则进程残留 + 文件锁级联
        try:
            if pres is not None:
                pres.Close()
        except Exception:
            pass
        try:
            app.Quit()
        except Exception:
            pass


def build_parser():
    ap = argparse.ArgumentParser(description="office-connector COM 工具")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("open"); p.add_argument("file"); p.add_argument("--page", type=int, default=1)
    p = sub.add_parser("list-elements"); p.add_argument("file"); p.add_argument("--page", type=int, default=1)
    p = sub.add_parser("set-text"); p.add_argument("file"); p.add_argument("name"); p.add_argument("text"); p.add_argument("--page", type=int, default=1)
    p = sub.add_parser("set-pos"); p.add_argument("file"); p.add_argument("name"); p.add_argument("x", type=int); p.add_argument("y", type=int); p.add_argument("--page", type=int, default=1)
    p = sub.add_parser("set-size"); p.add_argument("file"); p.add_argument("name"); p.add_argument("w", type=int); p.add_argument("h", type=int); p.add_argument("--page", type=int, default=1)
    p = sub.add_parser("set-font-size"); p.add_argument("file"); p.add_argument("name"); p.add_argument("size", type=float); p.add_argument("--page", type=int, default=1)
    p = sub.add_parser("set-font"); p.add_argument("file"); p.add_argument("name"); p.add_argument("font"); p.add_argument("--page", type=int, default=1)
    p = sub.add_parser("align"); p.add_argument("file"); p.add_argument("target"); p.add_argument("anchor"); p.add_argument("mode", choices=["left", "right", "top", "bottom", "hcenter", "vcenter"]); p.add_argument("--page", type=int, default=1)
    p = sub.add_parser("add-shape"); p.add_argument("file"); p.add_argument("kind", choices=["rect", "ellipse"]); p.add_argument("name"); p.add_argument("x", type=int); p.add_argument("y", type=int); p.add_argument("w", type=int); p.add_argument("h", type=int); p.add_argument("--text", default=""); p.add_argument("--page", type=int, default=1)
    p = sub.add_parser("export-preview"); p.add_argument("file"); p.add_argument("out")
    p = sub.add_parser("save-as"); p.add_argument("file"); p.add_argument("out")
    return ap


def main():
    args = build_parser().parse_args()
    t0 = time.time()
    progid, app = detect_engine()
    print("engine=%s" % progid, flush=True)
    pres = None
    try:
        if args.cmd == "open":
            pres = open_pres(app, args.file)
            print("slides=%d" % pres.Slides.Count)

        elif args.cmd == "list-elements":
            pres = open_pres(app, args.file)
            list_page(get_slide(pres, args.page), "page %d:" % args.page)

        elif args.cmd == "set-text":
            pres = open_pres(app, args.file)
            find_shape(get_slide(pres, args.page), args.name).TextFrame.TextRange.Text = args.text
            pres.Save()
            print("set-text OK: %s = %s" % (args.name, args.text))

        elif args.cmd == "set-pos":
            pres = open_pres(app, args.file)
            sh = find_shape(get_slide(pres, args.page), args.name)
            sh.Left, sh.Top = int(args.x), int(args.y)
            pres.Save()
            print("set-pos OK: %s -> (%s,%s)" % (args.name, args.x, args.y))

        elif args.cmd == "set-size":
            pres = open_pres(app, args.file)
            sh = find_shape(get_slide(pres, args.page), args.name)
            sh.Width, sh.Height = int(args.w), int(args.h)
            pres.Save()
            print("set-size OK: %s -> (%s,%s)" % (args.name, args.w, args.h))

        elif args.cmd == "set-font-size":
            pres = open_pres(app, args.file)
            find_shape(get_slide(pres, args.page), args.name).TextFrame.TextRange.Font.Size = float(args.size)
            pres.Save()
            print("set-font-size OK: %s -> %s" % (args.name, args.size))

        elif args.cmd == "set-font":
            pres = open_pres(app, args.file)
            find_shape(get_slide(pres, args.page), args.name).TextFrame.TextRange.Font.Name = args.font
            pres.Save()
            print("set-font OK: %s -> %s" % (args.name, args.font))

        elif args.cmd == "align":
            pres = open_pres(app, args.file)
            sl = get_slide(pres, args.page)
            t = find_shape(sl, args.target)
            a = find_shape(sl, args.anchor)
            x, y = t.Left, t.Top
            if args.mode == "left":
                x = a.Left
            elif args.mode == "right":
                x = a.Left + a.Width - t.Width
            elif args.mode == "top":
                y = a.Top
            elif args.mode == "bottom":
                y = a.Top + a.Height - t.Height
            elif args.mode == "hcenter":
                x = a.Left + (a.Width - t.Width) // 2
            elif args.mode == "vcenter":
                y = a.Top + (a.Height - t.Height) // 2
            else:
                raise RuntimeError("未知对齐模式: %s" % args.mode)
            t.Left, t.Top = x, y
            pres.Save()
            print("align OK: %s %s-> (%d,%d)" % (args.target, args.mode, x, y))

        elif args.cmd == "add-shape":
            pres = open_pres(app, args.file)
            sl = get_slide(pres, args.page)
            sid = 9 if args.kind == "ellipse" else 1  # msoShapeOval / msoShapeRectangle
            sh = sl.Shapes.AddShape(sid, int(args.x), int(args.y), int(args.w), int(args.h))
            sh.Name = args.name
            try:
                if getattr(args, "text", ""):
                    sh.TextFrame.TextRange.Text = args.text
            except Exception:
                pass
            pres.Save()
            print("add-shape OK: %s (%s)" % (args.name, args.kind))

        elif args.cmd == "export-preview":
            pres = open_pres(app, args.file)
            out = os.path.abspath(args.out)
            if not out.lower().endswith(".pdf"):
                out = os.path.splitext(out)[0] + ".pdf"
            pres.SaveAs(out, 32)  # ppSaveAsPDF
            print("exported %s" % out)

        elif args.cmd == "save-as":
            ext = os.path.splitext(args.out)[1].lower()
            fmt = {".pptx": 24, ".ppt": 1, ".odp": 60,
                   ".docx": 16, ".xlsx": 51}.get(ext)
            if fmt is None:
                raise RuntimeError("不支持的输出格式: %s" % ext)
            pres.SaveAs(os.path.abspath(args.out), fmt)
            print("saved %s" % args.out)

        else:
            raise RuntimeError("未知命令: %s" % args.cmd)

    except Exception as e:
        print("ERROR: %s" % e)
        sys.exit(1)
    finally:
        try:
            if pres is not None:
                pres.Close()
        except Exception:
            pass
        try:
            app.Quit()
        except Exception:
            pass
    print("(%.1fs)" % (time.time() - t0), flush=True)


if __name__ == "__main__":
    main()
