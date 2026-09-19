"""office-connector：WPS Spreadsheets / MS Excel COM 引擎原子工具（Windows，需本机装有 WPS 或 Office）。

用法:
    python excel_client.py open <file>                         # 工作簿信息（工作表名/维度）
    python excel_client.py set-cell <file> <sheet> <ref> <value>
                                                               # 写单元格（纯数字自动按数值写）
    python excel_client.py set-cell-font <file> <sheet> <ref> --font F [--size N]
                                                               # 单元格字体（ref 支持区域 A1:C1）
    python excel_client.py set-column-width <file> <sheet> <col> <width>
                                                               # 列宽（Excel 字符宽单位）
    python excel_client.py save-as <file> <out>                 # 另存（.xlsx 51 / .xls 0 / .csv 6）

引擎自动检测: KET.Application(WPS 表格) -> Excel.Application(MS Office)。
每个命令独立进程: Dispatch -> 打开 -> 操作 -> 保存 -> finally 关闭+Quit（保证无残留）。
"""
import argparse
import os
import sys
import time

import win32com.client

PROGIDS = ["KET.Application", "Excel.Application"]


def detect_engine():
    last = None
    for progid in PROGIDS:
        try:
            app = win32com.client.Dispatch(progid)
            if app is not None:
                return progid, app
        except Exception as e:
            last = e
    raise RuntimeError("未找到可用的 WPS/Excel COM 引擎: %s" % last)


def open_wb(app, path):
    full = os.path.abspath(path)
    wb = app.Workbooks.Open(full, ReadOnly=False)
    if wb is None:
        raise RuntimeError("打开失败: %s" % path)
    return wb


def get_sheet(wb, name):
    for i in range(1, wb.Worksheets.Count + 1):
        ws = wb.Worksheets(i)
        if ws.Name == name:
            return ws
    avail = ", ".join(wb.Worksheets(i).Name for i in range(1, wb.Worksheets.Count + 1))
    raise RuntimeError("未找到工作表 %r (可用: %s)" % (name, avail))


def run_command(args):
    progid, app = detect_engine()
    print("engine=%s" % progid, flush=True)
    wb = None
    try:
        if args.cmd == "open":
            wb = open_wb(app, args.file)
            for i in range(1, wb.Worksheets.Count + 1):
                ws = wb.Worksheets(i)
                print("sheet[%d] name=%s used=%s" % (i, ws.Name, ws.UsedRange.Address))

        elif args.cmd == "set-cell":
            wb = open_wb(app, args.file)
            ws = get_sheet(wb, args.sheet)
            val = args.value
            if val.replace(".", "", 1).isdigit() or val.startswith("-") and val[1:].replace(".", "", 1).isdigit():
                val = float(val) if "." in val else int(val)
            ws.Range(args.ref).Value = val
            wb.Save()
            print("set-cell OK: %s!%s = %r" % (args.sheet, args.ref, val))

        elif args.cmd == "set-cell-font":
            wb = open_wb(app, args.file)
            ws = get_sheet(wb, args.sheet)
            f = ws.Range(args.ref).Font
            if args.font:
                f.Name = args.font
            if args.size:
                f.Size = float(args.size)
            wb.Save()
            print("set-cell-font OK: %s!%s font=%s size=%s" % (args.sheet, args.ref, args.font, args.size))

        elif args.cmd == "set-column-width":
            wb = open_wb(app, args.file)
            ws = get_sheet(wb, args.sheet)
            ws.Columns(args.col).ColumnWidth = float(args.width)
            wb.Save()
            print("set-column-width OK: %s!%s = %s" % (args.sheet, args.col, args.width))

        elif args.cmd == "save-as":
            wb = open_wb(app, args.file)
            ext = os.path.splitext(args.out)[1].lower()
            fmt = {".xlsx": 51, ".xls": 0, ".csv": 6}.get(ext)
            if fmt is None:
                raise RuntimeError("不支持的输出格式: %s" % ext)
            wb.SaveAs(os.path.abspath(args.out), fmt)
            print("saved %s" % args.out)

        else:
            raise RuntimeError("未知命令: %s" % args.cmd)
    except Exception as e:
        print("ERROR: %s" % e)
        sys.exit(1)
    finally:
        try:
            if wb is not None:
                wb.Close(False)
        except Exception:
            pass
        try:
            app.Quit()
        except Exception:
            pass


def build_parser():
    ap = argparse.ArgumentParser(description="office-connector Excel 工具")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("open"); p.add_argument("file")
    p = sub.add_parser("set-cell"); p.add_argument("file"); p.add_argument("sheet"); p.add_argument("ref"); p.add_argument("value")
    p = sub.add_parser("set-cell-font"); p.add_argument("file"); p.add_argument("sheet"); p.add_argument("ref")
    p.add_argument("--font"); p.add_argument("--size")
    p = sub.add_parser("set-column-width"); p.add_argument("file"); p.add_argument("sheet"); p.add_argument("col"); p.add_argument("width")
    p = sub.add_parser("save-as"); p.add_argument("file"); p.add_argument("out")
    return ap


def main():
    args = build_parser().parse_args()
    t0 = time.time()
    run_command(args)
    print("(%.1fs)" % (time.time() - t0), flush=True)


if __name__ == "__main__":
    main()
