# -*- coding: utf-8 -*-
"""生成分层抽检核对表：按状态分层随机抽 30 条，附 Top1-3 候选供人工核对"""
import csv, random, re, os, openpyxl
from collections import defaultdict

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
res = list(csv.DictReader(open(os.path.join(BASE, 'data', 'match_results.csv'), encoding='utf-8-sig')))
by_status = defaultdict(list)
for r in res:
    by_status[r['对码状态']].append(r)
random.seed(42)
ALT_RE = re.compile(r'(\S+);\s*(.*?)\(规格:(.*?)\|型号:(.*?)\)')
rows_out, seq = [], 0
plan = [('厂家型号唯一命中', 6), ('厂家型号取Top1', 4), ('厂家型号待人工', 2),
        ('型号唯一命中', 6), ('多候选取Top1', 4), ('多候选待人工', 6),
        ('名称匹配取Top1', 2), ('名称唯一命中', 2), ('未匹配', 4)]
for st, n in plan:
    pool = by_status.get(st, [])
    for r in random.sample(pool, min(n, len(pool))):
        seq += 1
        cands = []
        if r['医保27位码']:
            cands.append(('★采用', r['医保27位码'], '', '', ''))
        for a in (r['备选27位码'].split(' || ') if r['备选27位码'] else []):
            m = ALT_RE.match(a.strip())
            if m:
                cands.append(('', m[1], m[2], m[3], m[4]))
        cands = (cands + [('','','','','')] * 3)[:3]
        fmt = lambda t: (f"{t[0]} {t[1]} | {t[2]} | 规格:{t[3]} | 型号:{t[4]}" if t[1] else '')
        rows_out.append([seq, r['名称原文'], st, fmt(cands[0]), fmt(cands[1]), fmt(cands[2])])

wb = openpyxl.Workbook()
ws = wb.active
ws.title = '抽检核对表'
ws.append(['序号', '耗材原文', '状态', 'Top1 27位码 | 通用名 | 规格 | 型号', 'Top2', 'Top3', '核对结果(人工填:正确/错误/存疑)'])
for row in rows_out:
    ws.append(row + [''])
for col, w in zip('ABCDEFG', (5, 42, 15, 55, 55, 55, 28)):
    ws.column_dimensions[col].width = w
out = os.path.join(BASE, '抽检核对表.xlsx')
wb.save(out)
print(f'抽检 {len(rows_out)} 条 → {out}')
