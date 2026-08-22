# 版式克隆配方 + 踩坑清单

> 合江县人民医院项目实测（完整版式.pptx → 7 版式主题，20 页 deck 交付验证）。
> 全部坑点均已复现并修复，按此清单执行可一次成功。

## 克隆配方（theme_lib.clone_layout 已实现，以下为原理与排查依据）

```python
# 1. partname：全 package 扫描，max+1
used = {int(m.group(1)) for part in p.part.package.iter_parts()
        if (m := re.match(r'/ppt/slideLayouts/slideLayout(\d+)\.xml$', str(part.partname)))}
pn = f'/ppt/slideLayouts/slideLayout{max(used)+1}.xml'

# 2. 新 part = 新 partname + deepcopy 源 element
new_el = copy.deepcopy(src_part._element)
new_part = SlideLayoutPart(PackURI(pn), src_part.content_type, package, new_el)

# 3. image rels：复用同一 image part，记录 rId 映射
rId_map = {}
for rId, rel in src_part.rels.items():
    if rel.reltype == RT.IMAGE:
        rId_map[rId] = new_part.rels.get_or_add(rel.reltype, rel.target_part)

# 4. 重写克隆 XML 里全部 r:embed（deepcopy 保留的是源 part 的 rId）
for el in new_el.iter():
    emb = el.get(qn('r:embed'))
    if emb in rId_map:
        el.set(qn('r:embed'), rId_map[emb])

# 5. 挂到 master
rId = master.part.relate_to(new_part, RT.SLIDE_LAYOUT)

# 6. 关键：sldLayoutIdLst append（id 全局唯一）
lst = master._element.get_or_add_sldLayoutIdLst()
all_ids = [int(e.get('id')) for m in p.slide_masters
           for e in m._element.get_or_add_sldLayoutIdLst().findall(qn('p:sldLayoutId'))]
lst.append(parse_xml(f'<p:sldLayoutId {NS} id="{max(all_ids)+1}" r:id="{rId}"/>'))
```

## 踩坑清单（症状 → 根因 → 修复）

| # | 症状 | 根因 | 修复 |
|---|------|------|------|
| 1 | 两个克隆版式重载后同名/同内容，zip 里没有 slideLayoutN.xml，master 两个 sldLayoutId 槽解析到同一 part | partname 只扫了 master rels，与 package 既有 slideLayout6/7.xml 碰撞；或两次克隆算出同一 partname → package parts 字典后者覆盖前者 | partname 扫描必须全 package `iter_parts()`（含新建 part），max+1 |
| 2 | `UserWarning: Duplicate name: 'ppt/media/image3.png'`（+ .rels） | 克隆重建 image rel 时**新建**了 image part | `new_part.rels.get_or_add(RT.IMAGE, rel.target_part)` 复用同一 part |
| 3 | 保存后版式在 WPS 里看不到/不在该 master 下 | 只做了 `relate_to`，没 append `p:sldLayoutId` | 必须向 master `sldLayoutIdLst` append，id 跨所有 master 全局唯一 |
| 4 | 克隆版式里图片引用错/丢失 | 深拷贝 XML 保留源 rId，新 part rels 重新编号 | 建 rId_map，重写全部 `r:embed` |
| 5 | `pn` 变量被后续代码覆盖（如 image partname 循环变量同名） | 全局变量复用 | 克隆函数内用独立变量名；改完函数体重读确认关键行还在（edit 工具 PUT 范围易越界吞行） |
| 6 | sldLayoutId id 与另一 master 冲突 | id 只在本 master 内取 max | 跨**所有** master 扫描 max+1（实测 master2 用 2147483655-3657） |

## 保存后自检（必做，不验证不交付）

```python
p2 = Presentation(OUT)
for m in p2.slide_masters:
    for l in m.slide_layouts:
        print(l.name, sorted(ph.placeholder_format.idx for ph in l.placeholders))
```


## 环境红线

- **TTSR**：inline `python -c` 含反斜杠转义（`\n`、正则 `\d`）会被 hook 误判拦截 → 复杂 Python 一律写脚本文件；bash 路径一律正斜杠
- **WPS 锁文件**：用户 WPS 打开模板时源文件被锁 → 只读不写；产物另存
- **零高度文本框**：h=0 的文本框 WPS/渲染器可能裁剪 → 文本框高度 ≥0.16in
- **占位符 type**：`p:ph type="title"` 每版式最多 1 个（idx=0）；body 类可用自定义 idx；title 类型重复会导致 WPS 占位符选择混乱
- **字体**：全篇指定 `a:latin` + `a:ea`（中文必须带 ea，否则 WPS 回退宋体）
- **iter_parts() 是图遍历**（python-pptx 1.0.2）：只含从 package rels 可达的 part。删示例 slide 后，slide 独占的 image part 从 iter_parts 消失（part 对象虽存活但保存时会被丢弃）→ 构建顺序必须**先 layout_ops（pic 形状 relate_to 重新锚定 image）再删页**
- **便携版 Python 3.13 sys.path 不含脚本目录/当前目录**（safe-path 行为）→ 入口脚本加 `sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))` 才能 import 同目录模块
