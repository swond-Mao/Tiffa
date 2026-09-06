# -*- coding: utf-8 -*-
"""SQL 查表对码：总表(拆分后) × duima_index.sqlite → 耗材分类总表_已对码.xlsx
策略：型号精确 → 型号前缀(长token优先) → 名称 trigram 模糊(整名→首段)
候选打分：规格一致性 +2 / 名称 bigram 覆盖率 / 型号命中 +0.5
短型号 token（<5字符）需通过名称/规格一致性闸门，防 CEA/Burs 类噪声词
断点续作：data/match_ckpt.csv 每 200 行 flush，重跑自动跳过已完成行
"""
import sqlite3, os, re, csv, unicodedata, random, time
from collections import Counter
import openpyxl

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(BASE, 'data', 'duima_index.sqlite')
SPLITS = os.path.join(BASE, 'data', 'splits.csv')
CKPT = os.path.join(BASE, 'data', 'match_ckpt.csv')
OUT_XLSX = os.path.join(BASE, '耗材分类总表_已对码.xlsx')
OUT_CSV = os.path.join(BASE, 'data', 'match_results.csv')
COLS = 'src,c1,c3,reg_name,item_name,ent,spec,model,code27'

def norm(s):
    if s is None:
        return ''
    s = unicodedata.normalize('NFKC', str(s))
    s = s.lower().replace('度', '°')
    s = re.sub(r'[\s\-_～~・·]+', '', s)
    s = s.replace('×', '*').replace('x', '*').replace('×', '*')
    return s.strip()

def spec_norm(t):
    return norm(t).replace('#', '').rstrip('/')

def bigrams(s):
    s = norm(s)
    return {s[i:i+2] for i in range(len(s)-1)} if len(s) >= 2 else {s}

def coverage(a, b):
    ba, bb = bigrams(a), bigrams(b)
    if not ba:
        return 0.0
    return len(ba & bb) / len(ba)

def sku_brief(r):
    src = (r[0] or '').replace('医保医用耗材代码_', '').replace('_全量规格型号信息.xlsx', '')
    return f'{src} | {r[2]} | {r[5]} | {r[4]} | 规格:{r[6]} | 型号:{r[7]}'

def token_ok(m, cands, specs, name_split):
    """短型号 token 命中校验：名称一致或规格一致才算命中，否则视为噪声词"""
    best_cov = max(max(coverage(name_split, r[4]), coverage(name_split, r[3])) for r in cands)
    if best_cov >= 0.2:
        return True
    for r in cands[:20]:
        n_spec = norm(r[6])
        if any(sp and (n_spec == sp or sp in n_spec or n_spec in sp) for sp in specs):
            return True
    return False

def main():
    t0 = time.time()
    conn = sqlite3.connect(DB)
    conn.execute('PRAGMA case_sensitive_like=ON')  # n_* 已小写归一；开启后 LIKE 前缀走索引
    if not conn.execute("SELECT name FROM sqlite_master WHERE name='fts_name'").fetchone():
        conn.execute("CREATE VIRTUAL TABLE fts_name USING fts5(n_item, n_reg, content='sku', content_rowid='id', tokenize='trigram')")
        conn.execute("INSERT INTO fts_name(fts_name) VALUES('rebuild')")
        conn.commit()
        print(f'[fts] 建成 {time.time()-t0:.0f}s', flush=True)
    cur = conn.cursor()

    def by_model_eq(m):
        return cur.execute(f'SELECT {COLS} FROM sku WHERE n_model=?', (m,)).fetchall()[:80]

    def by_model_prefix(m):
        if len(m) < 4:
            return []
        return cur.execute(f'SELECT {COLS} FROM sku WHERE n_model LIKE ?', (m + '%',)).fetchall()[:80]

    def by_name(name):
        if len(name) < 3:
            return []
        rows = cur.execute('SELECT rowid FROM fts_name WHERE n_item LIKE ? LIMIT 150', ('%' + name + '%',)).fetchall()
        if not rows:
            return []
        ids = [r[0] for r in rows]
        out = []
        for i in range(0, len(ids), 100):
            chunk = ids[i:i+100]
            out += cur.execute(f'SELECT {COLS} FROM sku WHERE id IN (' + ','.join('?'*len(chunk)) + ')', chunk).fetchall()
        return out[:150]

    # 读拆分结果
    master = {}
    with open(SPLITS, encoding='utf-8-sig') as f:
        for r in csv.DictReader(f):
            master[int(r['row'])] = r

    # 读 厂商/主供应商
    ents = {}
    ents_path = os.path.join(BASE, 'data', 'ents.csv')
    if os.path.exists(ents_path):
        with open(ents_path, encoding='utf-8-sig') as f:
            for r in csv.DictReader(f):
                ents[int(r['row'])] = (r['厂商'], r['主供应商'])

    def ent_norm(s):
        if not s:
            return ''
        s = unicodedata.normalize('NFKC', str(s)).lower()
        s = re.sub(r'[（(].*?[)）]', '', s)
        s = re.sub(r'股份|有限|责任|集团', '', s)
        s = re.sub(r'(医疗科技|医疗器械|医疗技术|医用产品|医疗用品)$', '', s)
        return s.strip()

    lib_ent_pairs = [(e, ent_norm(e)) for e, in conn.execute("SELECT DISTINCT ent FROM sku WHERE ent != ''")]
    ent_cache = {}
    def resolve_ent(*names):
        key = '|'.join(names)
        if key in ent_cache:
            return ent_cache[key]
        out = []
        for name in names:
            n = ent_norm(name)
            if len(n) < 2:
                continue
            for le, ln in lib_ent_pairs:
                if ln == n or (len(n) >= 4 and len(ln) >= 4 and (n in ln or ln in n)):
                    if le not in out:
                        out.append(le)
        ent_cache[key] = out
        return out

    ent_models_cache = {}
    def ent_model_set(elist):
        key = '|'.join(sorted(elist))
        if key not in ent_models_cache:
            ph = ','.join('?' * len(elist))
            rows = cur.execute(f'SELECT DISTINCT n_model FROM sku WHERE ent IN ({ph}) AND n_model != ""', elist).fetchall()
            ent_models_cache[key] = [r[0] for r in rows if r[0]]
        return ent_models_cache[key]

    def by_ent_model(m, elist):
        lms = ent_model_set(elist)
        hit = [lm for lm in lms if m == lm or (len(m) >= 4 and lm.startswith(m)) or (len(lm) >= 3 and m.startswith(lm))]
        if not hit:
            return []
        out = []
        for i in range(0, len(hit), 100):
            chunk = hit[i:i+100]
            ph1 = ','.join('?' * len(elist))
            ph2 = ','.join('?' * len(chunk))
            out += cur.execute(f'SELECT {COLS} FROM sku WHERE ent IN ({ph1}) AND n_model IN ({ph2})', elist + chunk).fetchall()
            if len(out) >= 80:
                break
        return out[:80]

    # 断点续作
    results = {}
    if os.path.exists(CKPT):
        with open(CKPT, encoding='utf-8-sig') as f:
            for r in csv.DictReader(f):
                k = int(r['row'])
                if k in master:
                    results[k] = (r['名称原文'], r['医保27位码'], r['对码状态'], r['匹配依据'], r['备选27位码'])
        print(f'[ckpt] 载入 {len(results)} 条已完成，续跑剩余 {len(master)-len(results)} 条', flush=True)
    stat = Counter(v[2] for v in results.values())

    rows_sorted = sorted(master)
    if os.environ.get('MATCH_LIMIT'):
        rows_sorted = rows_sorted[:int(os.environ['MATCH_LIMIT'])]
    todo_rows = [k for k in rows_sorted if k not in results]
    t_match = time.time()
    with open(CKPT, 'a', newline='', encoding='utf-8-sig') as ckpt_f:
        ckpt_w = csv.writer(ckpt_f)
        if os.path.getsize(CKPT) == 0:
            ckpt_w.writerow(['row', '名称原文', '医保27位码', '对码状态', '匹配依据', '备选27位码'])
        for n, k in enumerate(todo_rows):
            row = master[k]
            raw = row['名称原文']
            name = norm(row['拆分_名称'])
            models = [norm(t) for t in row['拆分_型号'].split('|') if t.strip()]
            specs = [spec_norm(t) for t in row['拆分_规格'].split('|') if t.strip()]
            if row.get('外配标记'):
                res = (raw, '', '非耗材(外配药品)', '', '')
            else:
                cands, hit_by = [], ''
                row_ent, row_sup = ents.get(k, ('', ''))
                elist = resolve_ent(row_ent, row_sup) if (row_ent or row_sup) else []
                # 0) 厂家锁定 + 型号精确（确定性比对，最强）
                if elist:
                    for m in models:
                        if not m:
                            continue
                        cands = by_ent_model(m, elist)
                        if cands and (len(m) >= 5 or token_ok(m, cands, specs, row['拆分_名称'])):
                            hit_by = f'厂家型号[{m}]'
                            break
                        cands = []
                # 1) 型号精确（按原顺序；短 token 需通过一致性闸门）
                if not cands:
                    for m in models:
                        if not m:
                            continue
                        cands = by_model_eq(m)
                        if cands and (len(m) >= 5 or token_ok(m, cands, specs, row['拆分_名称'])):
                            hit_by = f'型号精确[{m}]'
                            break
                        cands = []
                # 2) 型号前缀（长 token 优先）
                if not cands:
                    for m in sorted(models, key=len, reverse=True):
                        cands = by_model_prefix(m)
                        if cands and (len(m) >= 5 or token_ok(m, cands, specs, row['拆分_名称'])):
                            hit_by = f'型号前缀[{m}]'
                            break
                        cands = []
                # 3) 名称模糊（先整名，0 命中再试首个词段）
                if not cands and len(name) >= 3:
                    cands = by_name(name)
                    if not cands and ' ' in row['拆分_名称']:
                        seg = norm(row['拆分_名称'].split()[0])
                        if len(seg) >= 3 and seg != name:
                            cands = by_name(seg)
                    if cands:
                        hit_by = '名称匹配'
                if not cands:
                    res = (raw, '', '未匹配', '', '')
                else:
                    def score(r):
                        s = 0.0
                        n_spec = norm(r[6])
                        for sp in specs:
                            if sp and (n_spec == sp or sp in n_spec or n_spec in sp):
                                s += 2.0
                                break
                        s += max(coverage(row['拆分_名称'], r[4]), coverage(row['拆分_名称'], r[3]))
                        if hit_by.startswith(('型号', '厂家')):
                            s += 0.5
                        return s
                    scored = sorted(((score(r), r) for r in cands), key=lambda x: -x[0])
                    top_s, top = scored[0]
                    second_s = scored[1][0] if len(scored) > 1 else -1
                    if len(scored) == 1:
                        if hit_by.startswith('厂家'):
                            status = '厂家型号唯一命中'
                        elif hit_by.startswith('型号'):
                            status = '型号唯一命中'
                        else:
                            status = '名称唯一命中'
                    elif hit_by.startswith('厂家'):
                        status = '厂家型号取Top1' if top_s >= second_s + 0.5 else '厂家型号待人工'
                    elif hit_by.startswith('型号') and top_s >= second_s + 0.9 and top_s >= 2.0:
                        status = '多候选取Top1'
                    elif not hit_by.startswith('型号') and top_s >= 1.5 and top_s >= second_s + 0.5:
                        status = '名称匹配取Top1'
                    elif not hit_by.startswith('型号') and top_s < 1.5:
                        status = '未匹配'
                    else:
                        status = '多候选待人工'
                    alts = ' || '.join(f'{r[8]}; {r[4]}(规格:{r[6]}|型号:{r[7]})' for _, r in scored[:3])
                    if status == '未匹配':
                        code27, ref = '', f'名称弱命中(参考) {sku_brief(top)}'
                    else:
                        code27, ref = top[8], f'{hit_by} → {sku_brief(top)}'
                    res = (raw, code27, status, ref, alts)
            results[k] = res
            stat[res[2]] += 1
            ckpt_w.writerow([k, *res])
            if (n + 1) % 200 == 0:
                ckpt_f.flush()
            if (n + 1) % 1000 == 0:
                ckpt_f.flush()
                print(f'[match] {n+1}/{len(todo_rows)}  {time.time()-t_match:.0f}s', flush=True)

    # 存 CSV 明细
    with open(OUT_CSV, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(['row', '名称原文', '医保27位码', '对码状态', '匹配依据', '备选27位码'])
        for k in rows_sorted:
            w.writerow([k, *results[k]])

    # 回写 xlsx
    print('[write] 载入总表 ...', flush=True)
    wb = openpyxl.load_workbook(os.path.join(BASE, '耗材分类总表.xlsx'))
    ws = wb['总表']
    hdr = ['拆分_名称', '拆分_型号', '拆分_规格', '医保27位码', '对码状态', '匹配依据', '备选27位码']
    base_col = ws.max_column
    for j, h in enumerate(hdr):
        ws.cell(row=1, column=base_col + 1 + j, value=h)
    for k in rows_sorted:
        raw, code27, status, basis, alts = results[k]
        sp = master[k]
        vals = [sp['拆分_名称'], sp['拆分_型号'], sp['拆分_规格'], code27, status, basis, alts]
        for j, v in enumerate(vals):
            ws.cell(row=k, column=base_col + 1 + j, value=v)
    st = wb.create_sheet('对码统计')
    st.append(['对码状态', '行数', '占比'])
    total = len(rows_sorted)
    for k in sorted(stat, key=lambda x: -stat[x]):
        st.append([k, stat[k], f'{stat[k]/total:.1%}'])
    st.append(['合计', total, '100.0%'])
    st.column_dimensions['B'].width = 10
    wb.save(OUT_XLSX)
    print(f'[done] {OUT_XLSX}  总耗时 {time.time()-t0:.0f}s')
    print('--- 状态统计 ---')
    for k in sorted(stat, key=lambda x: -stat[x]):
        print(f'{k:12s} {stat[k]:5d}  {stat[k]/total:.1%}')
    unmatched = [results[k] for k in rows_sorted if results[k][2] == '未匹配']
    random.seed(3)
    print(f'--- 未匹配样例 20 ---')
    for u in random.sample(unmatched, min(20, len(unmatched))):
        print(u[0])

if __name__ == '__main__':
    main()
