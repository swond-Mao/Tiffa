"""office-connector：WPS Writer / MS Word COM 引擎原子工具（Windows，需本机装有 WPS 或 Office）。

用法:
    python word_client.py open <file>                                    # 文档信息（段落数/字数/样式列表）
    python word_client.py list-paragraphs <file> [--start N] [--count N] # 段落树（编号/样式/字号/字体/前60字）
    python word_client.py replace <file> <find> <repl> [--all]           # 替换文本；--all 全部替换
    python word_client.py replace-font <file> <from> <to> [--latin] [--ea]
                                                                        # 全文替换字体（默认 ea 中文字体；--latin 含西文）
    python word_client.py set-paragraph <file> <para_no> [--style S] [--align a]
                                          [--line-spacing N] [--line-rule R] [--bold on|off] [--font-size N]
                                                                        # 段落定位（list-paragraphs 的编号）改格式
    python word_client.py export-preview <file> <out.pdf|out.png>        # 导 PDF/PNG 预览（PNG 仅首页）
    python word_client.py save-as <file> <out>                           # 另存（.docx 16 / .doc 0 / .txt 7）

引擎自动检测: KWPS.Application(WPS Writer) -> Word.Application(MS Office)。
每个命令独立进程: Dispatch -> 打开 -> 操作 -> 保存 -> finally 关闭+Quit（保证无残留）。
段落编号从 1 开始；样式名中英文均可（"标题1"/"Heading 1"）。
"""
import argparse
import os
import sys
import time

import win32com.client

PROGIDS = ["KWPS.Application", "Word.Application"]

_ALIGN = {"left": 0, "center": 1, "right": 2, "justify": 3, "both": 3}  # wdAlign*Paragraph


def detect_engine():
    last = None
    for progid in PROGIDS:
        try:
            app = win32com.client.Dispatch(progid)
            if app is not None:
                return progid, app
        except Exception as e:
            last = e
    raise RuntimeError("未找到可用的 WPS/Word COM 引擎: %s" % last)


def open_doc(app, path):
    full = os.path.abspath(path)
    doc = app.Documents.Open(full, ReadOnly=False, AddToRecentFiles=False)
    if doc is None:
        raise RuntimeError("打开失败: %s" % path)
    return doc


def get_para(doc, no):
    if no < 1 or no > doc.Paragraphs.Count:
        raise RuntimeError("段落编号越界: %d (共 %d 段)" % (no, doc.Paragraphs.Count))
    return doc.Paragraphs(no)


def para_info(p):
    try:
        style = p.Style.NameLocal or p.Style.Name or "?"
    except Exception:
        style = "?"
    try:
        fs = p.Range.Font.Size
    except Exception:
        fs = "-"
    try:
        ea = p.Range.Font.Name
    except Exception:
        ea = "-"
    return style, fs, ea, p.Range.Text[:60].replace("\r", "⏎").replace("\n", " ")


def cmd_open(doc):
    print("paragraphs=%d words=%d" % (doc.Paragraphs.Count, doc.Words.Count))
    styles = []
    for i in range(1, doc.Styles.Count + 1):
        try:
            s = doc.Styles(i)
            if s.Type == 1:  # wdStyleTypeParagraph
                styles.append(s.NameLocal or s.Name)
        except Exception:
            pass
    print("styles:", ", ".join(sorted(set(styles))))


def cmd_list(doc, start, count):
    n = doc.Paragraphs.Count
    end = min(start + count - 1, n)
    print("paragraphs=%d (showing %d-%d)" % (n, start, end))
    for i in range(start, end + 1):
        style, fs, ea, txt = para_info(doc.Paragraphs(i))
        print("[%d] style=%s size=%s font=%s text=%s" % (i, style, fs, ea, txt))


def cmd_replace(doc, find, repl, replace_all):
    # 踩坑(2026-09-17 WPS 实测)：
    # ① Find.Execute(Replace=2) 在 WPS Writer 返回 True 但不实际替换（MS Word 正常）；
    # ② 同一 Range 的 Find 对象在替换(赋值 Range.Text)后继续 Execute() 会漏检后续匹配；
    # ③ WPS 下 doc.Range(start, end) 动态构造会抛 COM 异常。
    # 可靠做法：逐段用 p.Range 上的 Find 定位 + 赋值，每次重新取 p.Range 再 Find。
    # 局限：不跨段落匹配（公文场景内可接受）。
    total = 0
    if find and find in repl:
        raise RuntimeError("替换文本包含查找词（会无限循环），请人工确认后再改")
    for i in range(1, doc.Paragraphs.Count + 1):
        p = doc.Paragraphs(i)
        while True:
            f = p.Range.Find
            f.ClearFormatting()
            f.Text = find
            f.Forward = True
            f.Wrap = 0            # wdFindStop
            f.MatchCase = False
            f.MatchWholeWord = False
            f.MatchWildcards = False
            if not f.Execute():
                break
            f.Parent.Text = repl
            total += 1
            if not replace_all or total >= 10000:
                break
        if not replace_all and total > 0:
            break  # 首处模式：命中即整体停止
    if total == 0:
        print("replace: 未找到 %r" % find)
        return
    doc.Save()
    print("replace OK: %r -> %r, %d 处（不跨段匹配）" % (find, repl, total))


def cmd_replace_font(doc, from_font, to_font, latin, ea):
    if not (latin or ea):
        ea = True
    rng = doc.Content
    cnt = 0
    # 逐字符替换：Font.Name 在中文环境按中文字体路由（EastAsia）；
    # --latin 再显式补 NameAscii，保证西文/数字字体一并替换。
    chars = rng.Characters
    for i in range(1, chars.Count + 1):
        try:
            c = chars(i)
            if ea and c.Font.Name == from_font:
                c.Font.Name = to_font
                cnt += 1
            if latin and c.Font.NameAscii == from_font:
                c.Font.NameAscii = to_font
                cnt += 1
        except Exception:
            continue
    if cnt == 0:
        print("replace-font: 未找到字体 %r" % from_font)
        return
    doc.Save()
    print("replace-font OK: %r -> %r, %d 处 (latin=%s ea=%s)" % (from_font, to_font, cnt, latin, ea))


def cmd_set_para(doc, no, args):
    p = get_para(doc, no)
    if args.style:
        p.Style = args.style  # 样式名中英文均可
    if args.align in _ALIGN:
        p.Alignment = _ALIGN[args.align]
    if args.line_spacing:
        p.LineSpacing = float(args.line_spacing)  # 磅值（固定行距需配 --line-rule 3）
        if args.line_rule:
            try:
                p.LineSpacingRule = int(args.line_rule)  # 1=单倍 2=最小 3=固定 4=多倍
            except Exception:
                pass
    if args.bold in ("on", "off"):
        p.Range.Font.Bold = 1 if args.bold == "on" else 0
    if args.font_size:
        p.Range.Font.Size = float(args.font_size)
    doc.Save()
    print("set-paragraph OK: para %d" % no)


def cmd_export(doc, out):
    out = os.path.abspath(out)
    fmt = 17 if out.lower().endswith(".pdf") else 3  # wdFormatPDF / wdFormatPNG(仅首页)
    doc.SaveAs(out, FileFormat=fmt)
    print("exported %s" % out)


def cmd_save_as(doc, out):
    ext = os.path.splitext(out)[1].lower()
    fmt = {".docx": 16, ".doc": 0, ".txt": 7}.get(ext)
    if fmt is None:
        raise RuntimeError("不支持的输出格式: %s" % ext)
    doc.SaveAs(os.path.abspath(out), FileFormat=fmt)
    print("saved %s" % out)


def run_command(args):
    progid, app = detect_engine()
    print("engine=%s" % progid, flush=True)
    doc = None
    try:
        if args.cmd == "open":
            doc = open_doc(app, args.file); cmd_open(doc)
        elif args.cmd == "list-paragraphs":
            doc = open_doc(app, args.file)
            cmd_list(doc, args.start, args.count)
        elif args.cmd == "replace":
            doc = open_doc(app, args.file)
            cmd_replace(doc, args.find, args.repl, args.all)
        elif args.cmd == "replace-font":
            doc = open_doc(app, args.file)
            cmd_replace_font(doc, args.font_from, args.font_to, args.latin, args.ea)
        elif args.cmd == "set-paragraph":
            doc = open_doc(app, args.file)
            cmd_set_para(doc, args.para_no, args)
        elif args.cmd == "export-preview":
            doc = open_doc(app, args.file)
            cmd_export(doc, args.out)
        elif args.cmd == "save-as":
            doc = open_doc(app, args.file)
            cmd_save_as(doc, args.out)
        else:
            raise RuntimeError("未知命令: %s" % args.cmd)
    except Exception as e:
        print("ERROR: %s" % e)
        sys.exit(1)
    finally:
        # 异常路径也必须关闭文档并退出 COM 应用，否则进程残留 + 文件锁级联
        try:
            if doc is not None:
                doc.Close(False)
        except Exception:
            pass
        try:
            app.Quit()
        except Exception:
            pass


def build_parser():
    ap = argparse.ArgumentParser(description="office-connector Word 工具")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("open"); p.add_argument("file")
    p = sub.add_parser("list-paragraphs"); p.add_argument("file")
    p.add_argument("--start", type=int, default=1); p.add_argument("--count", type=int, default=50)
    p = sub.add_parser("replace"); p.add_argument("file"); p.add_argument("find"); p.add_argument("repl")
    p.add_argument("--all", action="store_true")
    p = sub.add_parser("replace-font"); p.add_argument("file"); p.add_argument("font_from"); p.add_argument("font_to")
    p.add_argument("--latin", action="store_true"); p.add_argument("--ea", action="store_true")
    p = sub.add_parser("set-paragraph"); p.add_argument("file"); p.add_argument("para_no", type=int)
    p.add_argument("--style"); p.add_argument("--align", choices=sorted(_ALIGN))
    p.add_argument("--line-spacing"); p.add_argument("--line-rule"); p.add_argument("--bold", choices=["on", "off"])
    p.add_argument("--font-size")
    p = sub.add_parser("export-preview"); p.add_argument("file"); p.add_argument("out")
    p = sub.add_parser("save-as"); p.add_argument("file"); p.add_argument("out")
    return ap


def main():
    args = build_parser().parse_args()
    t0 = time.time()
    run_command(args)
    print("(%.1fs)" % (time.time() - t0), flush=True)


if __name__ == "__main__":
    main()
