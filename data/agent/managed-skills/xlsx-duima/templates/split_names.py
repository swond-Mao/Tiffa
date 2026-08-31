# -*- coding: utf-8 -*-
"""名称拆分：耗材名称 → 拆分_名称 / 拆分_型号 / 拆分_规格（原列不动）
输出 data/splits.csv: row, 名称原文, 拆分_名称, 拆分_型号(|分隔), 拆分_规格(|分隔), 外配标记
"""
import openpyxl, os, re, csv, unicodedata, random

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, 'data', 'splits.csv')
os.makedirs(os.path.dirname(OUT), exist_ok=True)

OPEN_SET = set('(（[【<〈')
CLOSE_SET = set(')）]】>〉')
CJK_RE = re.compile(r'[\u4e00-\u9fff]')
CJK_UNIT = '孔个片支卷只米瓶盒套组副双对枚段根张条块粒颗入'
UNIT_RE = re.compile(r'\d+(?:\.\d+)?\s*(?:mm|cm|in|ml|ul|μg|ug|mg|g|l|cm2|°|#[孔个片支卷只米瓶盒套组副双对枚段根张条块粒颗入])', re.I)
DIM_RE = re.compile(r'\d+(?:\.\d+)?\s*[*×xX]\s*\d+(?:\.\d+)?(?:\s*[*×xX]\s*\d+(?:\.\d+)?)?\s*(?:mm|cm|in|g|ml)?', re.I)
TOKEN_RE = re.compile(r'[A-Za-z0-9][A-Za-z0-9\-\./]*')
UNIT_TAIL_RE = re.compile(r'^\d+(?:\.\d+)?\s*(?:mm|cm|in|ml|ul|μg|ug|mg|g|l|cm2)$', re.I)
MERGED_RE = re.compile(r'[A-Za-z]+\d+(?:\.\d+)?\s*[*×xX]\s*\d+(?:\.\d+)?(?:\s*[*×xX]\s*\d+(?:\.\d+)?)?\s*(?:mm|cm|in|g|ml)?', re.I)
TEST_RE = re.compile(r'\d+(?:\.\d+)?\s*测试/')

def extract_balanced(s):
    """括号内容含字母数字 → 丢弃外壳（内容单独判型号/规格）；纯中文 → 内容并入名称"""
    parts_out, i, n, contents = [], 0, len(s), []
    while i < n:
        c = s[i]
        if c in OPEN_SET:
            depth, j = 1, i + 1
            while j < n and depth:
                if s[j] in OPEN_SET:
                    depth += 1
                elif s[j] in CLOSE_SET:
                    depth -= 1
                j += 1
            inner = s[i+1:j-1]
            contents.append(inner)
            parts_out.append(' ' if re.search(r'[A-Za-z0-9]', inner) else inner)
            i = j
        else:
            parts_out.append(c)
            i += 1
    return ''.join(parts_out), contents

def classify_token(tok):
    """返回 'model' | 'spec' | None"""
    t = tok.strip().rstrip('-./')
    if not t:
        return None
    if UNIT_TAIL_RE.fullmatch(t):
        return 'spec'  # 17in / 3.0ml
    has_a = bool(re.search(r'[A-Za-z]', t))
    has_d = bool(re.search(r'\d', t))
    if has_a and has_d:
        return 'model'
    if has_a and len(re.sub(r'[^A-Za-z]', '', t)) >= 3:
        return 'model'  # 纯字母品牌
    if has_d and not has_a and len(re.sub(r'\D', '', t)) >= 6:
        return 'model'  # 长纯数字编号
    return None

def scan_body(body, models, specs):
    """字母+尺寸连写 → 型号；独立尺寸串 → 规格；单位规格 → 规格（中文单位前贴中文则保留在名称）"""
    def m1(m):
        models.append(m.group().replace(' ', ''))
        return ' '
    body = MERGED_RE.sub(m1, body)
    def m2(m):
        specs.append(m.group().replace(' ', '').lower())
        return ' '
    body = DIM_RE.sub(m2, body)
    def m3(m):
        unit = m.group().split()[-1]
        i = m.start()
        if CJK_RE.search(unit) and i > 0 and CJK_RE.search(body[i-1]):
            return m.group()  # 细胞角蛋白19片段 → 19片 不动
        specs.append(m.group().replace(' ', '').lower())
        return ' '
    body = UNIT_RE.sub(m3, body)
    def m4(m):
        specs.append(m.group().replace(' ', '').lower())
        return ' '
    body = TEST_RE.sub(m4, body)
    return body

def split_name(raw):
    s = unicodedata.normalize('NFKC', str(raw)).strip()
    waipai = s.startswith('(外配)')
    if waipai:
        s = s[4:]
    body, contents = extract_balanced(s)
    models, specs = [], []
    for inner in contents:
        if not re.search(r'[A-Za-z0-9]', inner):
            continue
        tok_class = {}
        for t in TOKEN_RE.findall(inner):
            k = classify_token(t)
            if k:
                tok_class.setdefault(k, []).append(t.rstrip('-./'))
        if tok_class.get('model'):
            models.append(' '.join(tok_class['model']))
        if tok_class.get('spec'):
            specs.extend(tok_class['spec'])
        if not tok_class:
            for m in DIM_RE.finditer(inner):
                specs.append(m.group().replace(' ', '').lower())
            for m in UNIT_RE.finditer(inner):
                specs.append(m.group().replace(' ', '').lower())
    body = scan_body(body, models, specs)
    def tok_sub(m):
        if classify_token(m.group()) == 'model':
            models.append(m.group())
            return ' '
        return m.group()
    body = TOKEN_RE.sub(tok_sub, body)
    name = re.sub(r'\s+', ' ', body).strip(' -—·/|,，.。:：()（）[]')
    name = re.sub(r'[\s\-—–]*型\s*$', '', name)
    if CJK_RE.search(name):
        name = re.sub(r'\s*[/\-—–]\s*[A-Za-z]{1,2}\s*$', '', name)  # 尾部 /M /L 尺寸码
    name = name.strip()
    models = list(dict.fromkeys(models))
    specs = list(dict.fromkeys(specs))
    return name, '|'.join(models), '|'.join(specs), '外配' if waipai else ''

def main():
    wb = openpyxl.load_workbook(os.path.join(BASE, '耗材分类总表.xlsx'), read_only=True)
    ws = wb['总表']
    rows = []
    for i, r in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        name = str(r[1]).strip() if r[1] is not None else ''
        rows.append((i, name,) + split_name(name))
    wb.close()
    with open(OUT, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(['row', '名称原文', '拆分_名称', '拆分_型号', '拆分_规格', '外配标记'])
        w.writerows(rows)
    print(f'共拆分 {len(rows)} 行 → {OUT}')
    pats = [
        (r'LPPMT', '字母数字型号'), (r'14\*17in', '括号尺寸'), (r'HC-5005', '嵌套括号'),
        (r'迫紧螺钉', '纯尺寸'), (r'外配', '外配前缀'), (r'PTCA球囊导管49250150', '长编号'),
        (r'PI120\*15', '字母+尺寸连写'), (r'ZF577R', '尾字母'), (r'细胞角蛋白19', '中文名数字'),
        (r'280\*8', '刮匙混合括号'), (r'SWD-P型1.5mm', '型号+角度'), (r'ZTCT01 36mm/M', '假体尺寸码'),
        (r'Ki-67', 'IHC抗体'), (r'SCLP 03 腓骨', '系统型号'), (r'档案盒|沙发垫', '非医用'),
        (r'B-16AHF', '透析器'), (r'双J管', '双J管'), (r'100测试', '测试规格'),
    ]
    seen = set()
    for pat, label in pats:
        for row in rows:
            if row[1] in seen:
                continue
            if re.search(pat, row[1]):
                seen.add(row[1])
                print(f'[{label}] 原文: {row[1]!r}')
                print(f'         名称: {row[2]!r} | 型号: {row[3]!r} | 规格: {row[4]!r}')
    random.seed(7)
    print('--- 随机 10 条 ---')
    for row in random.sample(rows, 10):
        print(f'原文: {row[1]!r}')
        print(f'名称: {row[2]!r} | 型号: {row[3]!r} | 规格: {row[4]!r}')

if __name__ == '__main__':
    main()
