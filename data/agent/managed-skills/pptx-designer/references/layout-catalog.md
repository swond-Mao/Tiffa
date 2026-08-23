# 页级模板目录（layout-catalog.md）

> 由 `scripts/build-layout-catalog.cjs` 从 dashiai layout-manifest.json 生成（共 1020 个布局 · v2 taxonomy）。
> **用途**：AI 在设计阶段按「内容类型 → 布局族 → 候选」查本节选页级模板。
> **选法**：页面定义写 `layout: 'themeXX_pageNNN'` + 对应数据字段。
> **红线**：没有合适模板就手搓 DSL，禁止为套模板删改内容。

## 检索流程（L1→L2→L3→L4，强制）

1. **L1 页面定位**：封面/目录/章节过渡/正文/结束页 → 定位类直接挑（封面/目录/章节/附录）
2. **L2 内容类型**：正文页按本页内容定位到 18 类之一（数据KPI/图表·趋势/流程路线/案例特写…）
3. **L3 布局族**：在该类内按版式需求选族（纯文字/多卡片N/并列/流程/总分/左图右文/图表主视觉/金句/时间轴/画廊）
   - **相邻页防撞**：排除上一页已用 L3 族；候选全被排除才允许回退上一族（须换 L4 模板）
4. **L4 候选**：读该族模板表，按卡数/图数/容量匹配，挑 1 个（同类多选一，保证页标题等一致性）
5. 查不到合适 → 手搓 DSL（正常路径，不是降级）

## 快速对照（内容类型 → 类别 → 示例）

| 内容类型 | 查类别 | 示例布局 |
| --- | --- | --- |
| 封面/开场 | 封面 | theme01_page001 编辑式双栏、theme02_page001… |
| 目录/议程 | 目录/议程 | theme01_page009 报告导览 |
| 章节切换 | 章节过渡 | theme01_page011 章节·市场全景 |
| 核心数字/KPI | 大数字/KPI | theme01_page006 大数字·资本体量 |
| 趋势/时间序列 | 图表·趋势 | theme01_page012 纵向趋势 |
| 占比/构成 | 图表·构成占比 | theme01_page079 甜甜圈 |
| 对比/涨跌 | 对比/对决 | theme01_page025 三强横向对比 |
| 排行/榜单 | 排行/表格 | theme01_page019 头部玩家 |
| 流程/路线 | 流程/路线/链 | theme01_page040 阶段性策略路线图 |
| 时间线/里程碑 | 图表·时间/排期 | theme01_page028 里程碑时间轴 |
| 金句/结论 | 观点/结论/金句 | theme01_page027 金句·CEO 视角 |
| 案例/特写 | 案例/特写 | theme01_page026 典型案例 |
| 图片/画廊 | 图片/画廊 | theme01_page076 影像长卷 |
| 架构/关系 | 流程/路线/链 | theme01_page014 产业链分层 |
| 风险/能力 | 雷达/风险/能力 | theme01_page038 风险研判 |
| 地区分布 | 地区/区域 | theme01_page034 地区分布 |

### 布局族定义（L3）

| L3 族 | 判定 | 文本容量基准 | 卡数/图数 |
| --- | --- | --- | --- |
| 定位 | 封面/目录/章节/结束 | - | - |
| 纯文字 | 无卡/图，段落为主 | 600-800字 | - |
| 多卡片N | 卡数≥3 | 每卡80-120字 | 卡N |
| 并列 | 2-3 栏对等/对比 | 200-300字 | - |
| 流程 | 步骤/箭头/路线 | 每步40-80字 | - |
| 总分 | 主结论+分项 | 50-100+分项各60-100字 | - |
| 左图右文 | 图+文字块 | 200-300字 | 图N |
| 图表主视觉 | 图占≥50% B 区 | 80-120字+洞察 | 图N |
| 金句 | 大字主张/引语 | 20-50字 | - |
| 时间轴 | 里程碑/排期 | 每节点30-60字 | - |
| 网格画廊 | 图片墙/拼贴 | 图说各20-40字 | 图N |
| 排行表格 | 表格/榜单 | 每行20-50字 | - |

## 封面（68 个 · 12 套主题覆盖）

| key | label | slot | L3族 | 卡数 | 图数 | 容量 |
| --- | --- | --- | --- | --- | --- | --- |
| theme01_page001 | 封面 · 编辑式双栏 | cover-editorial | 定位 | - | - | - |
| theme01_page002 | 封面 · 居中极简 | cover-minimal | 定位 | - | - | - |
| theme01_page003 | 封面 · 模块化便当格 | cover-bento | 定位 | - | - | - |
| theme01_page004 | 封面 · 磨砂玻璃刊头 | cover-masthead | 定位 | - | - | - |
| theme01_page005 | 封面 | cover | 定位 | - | - | - |
| theme01_page063 | 杂志封面 · 算力军备竞赛 | mag-cover | 定位 | - | - | - |
| theme02_page001 | 封面 · Cover | cover | 定位 | - | - | - |
| theme02_page002 | 封面 A · 居中聚光 | coverbeam | 定位 | - | - | - |
| theme02_page003 | 封面 B · 大数主视觉 | coverfigure | 定位 | - | - | - |
| theme02_page004 | 封面 C · 满幅图海报 | coverposter | 定位 | - | - | - |
| theme02_page005 | 封面 D · 模块网格 | coverpanel | 定位 | - | - | - |
| theme03_page001 | 封面 | cover | 定位 | - | - | - |
| theme03_page002 | 封面·横向 | coverband | 定位 | - | - | - |
| theme03_page003 | 封面·海报 | coverposter | 定位 | - | - | - |
| theme03_page004 | 封面·网格 | covergrid | 定位 | - | - | - |
| theme03_page005 | 封面·影像 | coverimage | 定位 | - | - | - |
| theme04_page001 | 居中主题封面 | coverHero | 定位 | - | - | - |
| theme04_page002 | 索引导读封面 | coverIndex | 定位 | - | - | - |
| theme04_page003 | 幽灵数字封面 | coverGhost | 定位 | - | - | - |
| theme04_page004 | 糖果速览封面 | coverBento | 定位 | - | - | - |
| theme04_page044 | 杂志封面 | cover | 定位 | - | - | - |
| theme04_page045 | 图背章节页 | coversection | 定位 | - | - | - |
| theme05_page001 | 封面 精益智造 | excover1 | 定位 | - | - | - |
| theme05_page002 | 封面 创意破圈 | excover2 | 定位 | - | - | - |
| theme05_page003 | 封面 链通全国 | excover3 | 定位 | - | - | - |
| theme05_page004 | 封面 把握消费趋势 | excover4 | 定位 | - | - | - |
| theme05_page005 | 封面 Cover | cover | 定位 | - | - | - |
| theme06_page001 | 封面A · 智联万物 / PRODUCT LAUNCH | coverA | 定位 | - | - | - |
| theme06_page002 | 封面B · 新机遇 / BUSINESS PLAN | coverB | 定位 | - | - | - |
| theme06_page003 | 封面C · 精益智造 / LEAN MFG | coverC | 定位 | - | - | - |
| theme06_page004 | 封面D · 品牌整合营销 / BRAND MKT | coverD | 定位 | - | - | - |
| theme06_page005 | 01 · 封面 / COVER | cover | 定位 | - | - | - |
| theme07_page001 | 封面 精益智造 | cover-lean-page | 定位 | - | - | - |
| theme07_page002 | 封面 链通全国 | cover-supply-chain-page | 定位 | - | - | - |
| theme07_page003 | 封面 把握趋势 | cover-retail-trend-page | 定位 | - | - | - |
| theme07_page004 | 封面 供应链战略 | cover-supply-strategy-page | 定位 | - | - | - |
| theme07_page005 | 封面 Cover | cover-page | 定位 | - | - | - |
| theme08_page001 | 补充封面-① 智联万物 | sup1 | 定位 | - | - | - |
| theme08_page002 | 补充封面-② 深耕教学 | sup2 | 定位 | - | - | - |
| theme08_page003 | 补充封面-③ 新机遇新赛道 | sup3 | 定位 | - | - | - |
| theme08_page004 | 封面2-③ 链通全国 | cv2c | 定位 | - | - | - |
| theme08_page005 | ① 封面 · Cover | p1 | 定位 | - | - | - |
| theme09_page001 | 封面A 刊头 | covermast | 定位 | - | - | - |
| theme09_page002 | 封面C 斜切 | coverdiag | 定位 | - | - | - |
| theme09_page003 | 封面D 卷宗 | coverdossier | 定位 | - | - | - |
| theme09_page004 | 封面E 光带 | coverstrata | 定位 | - | - | - |
| theme09_page005 | 封面F 光圈 | coveraperture | 定位 | - | - | - |
| theme09_page006 | 封面G 终端 | coverterminal | 定位 | - | - | - |
| theme09_page007 | Cover | cover | 定位 | - | - | - |
| theme09_page033 | 封面影像 | coverstory | 定位 | - | - | - |
| theme10_page001 | 暮光对角 | coverdusk | 定位 | - | - | - |
| theme10_page002 | 渐变色场分栏 | coverfield | 定位 | - | - | - |
| theme10_page003 | 满版渐变大字 | coveratmostype | 定位 | - | - | - |
| theme10_page004 | 地平线渐变 | coverhorizon | 定位 | - | - | - |
| theme10_page005 | 封面 | cover | 定位 | - | - | - |
| theme10_page051 | 晨光卡 | coverdawn | 定位 | - | - | - |
| theme11_page001 | 封面 · 海报 | page1 | 定位 | - | - | - |
| theme11_page002 | 封面 · 满铺图 | page2 | 定位 | - | - | - |
| theme11_page003 | 封面 · 陈述 | page3 | 定位 | - | - | - |
| theme11_page004 | 封面 · 分栏 | page4 | 定位 | - | - | - |
| theme11_page005 | 封面 | page5 | 定位 | - | - | - |
| theme11_page065 | 封面 | page65 | 定位 | - | - | - |
| theme12_page001 | 封面 · 字体 / Masthead | coverType | 定位 | - | - | - |
| theme12_page002 | 封面 · 声波 / Spectrum | coverWave | 定位 | - | - | - |
| theme12_page003 | 封面 · 大图 / Cover Story | coverImage | 定位 | - | - | - |
| theme12_page004 | 封面 · 目录 / Contents | coverGrid | 定位 | - | - | - |
| theme12_page021 | 杂志封面 / Cover | cover | 定位 | - | - | - |
| theme12_page030 | 封面流 / Coverflow | coverflow | 定位 | - | - | - |

## 目录/议程（12 个 · 11 套主题覆盖）

| key | label | slot | L3族 | 卡数 | 图数 | 容量 |
| --- | --- | --- | --- | --- | --- | --- |
| theme01_page009 | 报告导览 · 目录 | contents | 定位 | - | - | - |
| theme02_page007 | 报告目录 · Agenda | agenda | 定位 | - | - | - |
| theme03_page006 | 导览 | agenda | 定位 | - | - | - |
| theme04_page005 | 研究框架 | agenda | 定位 | - | - | - |
| theme04_page006 | 图文目录 | contents | 定位 | - | - | - |
| theme05_page007 | 结构 Contents | grid | 定位 | - | - | - |
| theme06_page007 | 03 · 报告结构 / STRUCTURE | contents | 定位 | - | - | - |
| theme07_page007 | 目录 Contents | contents-page | 定位 | - | - | - |
| theme08_page007 | ③ 结构 · Contents | p3 | 定位 | - | - | - |
| theme09_page010 | 目录 | contents | 定位 | - | - | - |
| theme11_page007 | 纲目 | page7 | 定位 | - | - | - |
| theme12_page007 | 目录 / Agenda | agenda | 定位 | - | - | - |

## 章节过渡（36 个 · 12 套主题覆盖）

| key | label | slot | L3族 | 卡数 | 图数 | 容量 |
| --- | --- | --- | --- | --- | --- | --- |
| theme01_page011 | 章节 · 市场全景 | chapter-market | 定位 | - | - | - |
| theme01_page013 | 章节 · 横向透视 | chapter | 定位 | - | - | - |
| theme01_page024 | 章节 · 典型案例 | chapter-case | 定位 | - | - | - |
| theme01_page036 | 章节 · 风险与展望 | chapter-risk | 定位 | - | - | - |
| theme02_page014 | 章节页 · Section | section | 定位 | - | - | - |
| theme03_page022 | 章节页 | section | 定位 | - | - | - |
| theme04_page008 | 章节页 | section | 定位 | - | - | - |
| theme04_page035 | 章节大字 | chapter | 定位 | - | - | - |
| theme04_page069 | 极简编号章节 | numbered | 定位 | - | - | - |
| theme05_page019 | 章节 Chapter | chapter | 定位 | - | - | - |
| theme05_page030 | 章节 Chapter 03 | chapter3 | 定位 | - | - | - |
| theme05_page053 | 章节 Chapter 04 | chapter4 | 定位 | - | - | - |
| theme05_page076 | 章节 Chapter 05 | chapter5 | 定位 | - | - | - |
| theme06_page010 | 06 · 市场数据深拆 / CHAPTER | chapter | 定位 | - | - | - |
| theme06_page021 | 17 · 赛道结构细分 / CHAPTER 03 | ch03 | 定位 | - | - | - |
| theme06_page041 | 37 · 资本与地区结构 / CHAPTER 04 | ch04 | 定位 | - | - | - |
| theme06_page064 | 60 · 风险与策略 / CHAPTER 05 | ch05 | 定位 | - | - | - |
| theme06_page073 | 69 · 数据附录精读 / CHAPTER 06 | ch06 | 定位 | - | - | - |
| theme06_page080 | 76 · 前瞻信号 / CHAPTER 07 | ch07 | 定位 | - | - | - |
| theme07_page016 | 章节 市场数据 | chapter-page | 定位 | - | - | - |
| theme07_page046 | 章节 资本结构 | capital-chapter-page | 定位 | - | - | - |
| theme08_page017 | ⑮ 章节 · Chapter | p15 | 定位 | - | - | - |
| theme08_page028 | ㉖ 章节 · Chapter | p26 | 定位 | - | - | - |
| theme08_page049 | ㊾ 章节 · Chapter | p49 | 定位 | - | - | - |
| theme09_page011 | 01 研究方法 | section | 定位 | - | - | - |
| theme09_page030 | 附录 · 透视 | divider | 定位 | - | - | - |
| theme09_page101 | 篇章卡 | chapter | 定位 | - | - | - |
| theme10_page006 | 章节索引 | chapter | 定位 | - | - | - |
| theme10_page038 | 序号分章 | divider | 定位 | - | - | - |
| theme10_page052 | 宣言章节 | sectionstatement | 定位 | - | - | - |
| theme11_page006 | 序章 | page6 | 定位 | - | - | - |
| theme11_page044 | 章节 | page44 | 定位 | - | - | - |
| theme11_page069 | 收束 | page69 | 定位 | - | - | - |
| theme12_page042 | 间章 / Interlude | interlude | 定位 | - | - | - |
| theme12_page079 | 章节页 / Section | section | 定位 | - | - | - |
| theme12_page080 | 大间章 / Divider | divider | 定位 | - | - | - |

## 大数字/KPI（78 个 · 12 套主题覆盖）

| key | label | slot | L3族 | 卡数 | 图数 | 容量 |
| --- | --- | --- | --- | --- | --- | --- |
| theme01_page006 | 大数字 · 资本体量 | bignum | 大数字 | 0-3 | - | 30-100字+巨数字 |
| theme01_page007 | 关键数字一览 | statgrid | 大数字 | 2-4 | - | 30-100字+巨数字 |
| theme01_page008 | 便当速览 · 一图读懂 | bento | 左图右文 | 2-3 | 0-3 | 200-300字 |
| theme01_page042 | 三个数字 · 资本格局 | evil-trio | 纯文字 | 2-3 | - | 600-800字 |
| theme01_page050 | 标的评分卡 · 尽调五维 | scorecard | 大数字 | 3-5 | - | 30-100字+巨数字 |
| theme01_page064 | 关键占比 · 柱状图 | kpi-dial | 图表主视觉 | 3-4 | - | 80-120字+洞察 |
| theme02_page020 | 关键数字 · Metrics | metrics | 大数字 | 2-4 | - | 30-100字+巨数字 |
| theme02_page021 | 巨型数字 · Big Number | bignumber | 大数字 | 0-3 | - | 30-100字+巨数字 |
| theme02_page023 | 数据看板 · Bento | bento | 纯文字 | 2-4 | - | 600-800字 |
| theme02_page027 | 图文卡组 · Card Grid | cardgrid | 多卡片1-4 | 1-4 | - | 每卡80-120字 |
| theme02_page041 | 达成度 · Progress | progress | 大数字 | 2-5 | - | 30-100字+巨数字 |
| theme03_page028 | 核心数据 | stat | 大数字 | 0-3 | - | 30-100字+巨数字 |
| theme03_page065 | 投资记分卡 | scorecard | 大数字 | 4-8 | - | 30-100字+巨数字 |
| theme03_page071 | 资本主张 | statement | 金句 | - | 0-1 | 20-50字 |
| theme04_page009 | 行业赛道 | cards | 多卡片2-4 | 2-4 | - | 每卡80-120字 |
| theme04_page016 | 一图速览 | bento | 网格画廊 | 0-2 | - | 图说各20-40字 |
| theme04_page029 | 大数字 | bignumber | 大数字 | 0-3 | - | 30-100字+巨数字 |
| theme04_page030 | 三联大数字 | stattrio | 大数字 | 1-3 | - | 30-100字+巨数字 |
| theme04_page032 | 资本计分卡 | scorecards | 大数字 | 2-4 | - | 30-100字+巨数字 |
| theme04_page074 | 核心结论 | statement | 金句 | 1-2 | - | 20-50字 |
| theme05_page006 | 摘要 Overview | spec | 左图右文 | 2-5 | 0-2 | 200-300字 |
| theme05_page028 | 大数字 Big Number | bignumber | 大数字 | 0-3 | - | 30-100字+巨数字 |
| theme05_page037 | 金句 Statement | statement | 金句 | 0-3 | - | 20-50字 |
| theme05_page041 | 容量栅格 Capacity | capacity | 纯文字 | 2-4 | - | 600-800字 |
| theme05_page046 | 图像型录 Catalog | catalog | 左图右文 | 2-4 | 0-4 | 200-300字 |
| theme05_page054 | 早期信号表 Signal | signal | 纯文字 | 2-4 | - | 600-800字 |
| theme05_page056 | 资本来源 Source | source | 纯文字 | 2-4 | - | 600-800字 |
| theme05_page060 | 占比大数字 Dominance | dominance | 图表主视觉 | 0-3 | - | 80-120字+洞察 |
| theme05_page073 | 知识索引 Index | index | 左图右文 | 2-5 | 0-3 | 200-300字 |
| theme05_page074 | 大数字 Monolith | monolith | 大数字 | 0-3 | - | 30-100字+巨数字 |
| theme05_page079 | 毛利天花板 Ceiling | ceiling | 纯文字 | 0-3 | - | 600-800字 |
| theme05_page081 | 策略推荐 Slate | slate | 纯文字 | 2-4 | - | 600-800字 |
| theme05_page083 | 估值锚 Re-anchor | beacon | 纯文字 | 2-4 | - | 600-800字 |
| theme05_page086 | 综合评分 Scorecard | scorecard | 大数字 | 3-6 | - | 30-100字+巨数字 |
| theme06_page006 | 02 · 报告摘要 / OVERVIEW | summary | 纯文字 | 2-4 | - | 600-800字 |
| theme06_page019 | 15 · 赛道平均融资额 / AVG TICKET | avgticket | 纯文字 | 0-3 | - | 600-800字 |
| theme06_page032 | 28 · 大数字 / BIG NUMBER | big | 大数字 | 0-3 | - | 30-100字+巨数字 |
| theme06_page075 | 71 · 超级交易画像 / MEGA DEALS | megadeals | 纯文字 | 0-3 | - | 600-800字 |
| theme06_page076 | 72 · 超级交易均值 / MEGA AVG | megabig | 纯文字 | 0-3 | - | 600-800字 |
| theme06_page078 | 74 · 数据来源与口径 / SOURCES | sources | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme06_page082 | 78 · 前瞻主题 / FORWARD STATEMENT | statement | 金句 | 0-2 | - | 20-50字 |
| theme07_page006 | 摘要 Overview | summary-page | 纯文字 | 2-4 | - | 600-800字 |
| theme07_page024 | 区间 Deal Size | deal-size-page | 纯文字 | 1-4 | - | 600-800字 |
| theme07_page025 | 均值 Avg Ticket | avg-ticket-page | 纯文字 | 0-3 | - | 600-800字 |
| theme07_page070 | 口径 数据来源 | sources-page | 多卡片4-6 | 4-6 | - | 每卡80-120字 |
| theme08_page006 | ② 摘要 · Overview | p2 | 纯文字 | 2-4 | - | 600-800字 |
| theme08_page020 | ⑱ 指标对比 · Delta | p18 | 大数字 | 2-5 | - | 30-100字+巨数字 |
| theme08_page026 | ㉔ 大数字 · Big Number | p24 | 大数字 | 0-3 | - | 30-100字+巨数字 |
| theme08_page055 | (56) 大数字 · Geo Anchor | p56 | 大数字 | 2-4 | - | 30-100字+巨数字 |
| theme08_page078 | (84) 大数字 · Gauge | p84 | 图表主视觉 | 2-3 | - | 80-120字+洞察 |
| theme08_page083 | (90) 记分卡 · Scorecard | p90 | 大数字 | 2-4 | - | 30-100字+巨数字 |
| theme09_page008 | 报告摘要 | overview | 纯文字 | 2-4 | - | 600-800字 |
| theme09_page020 | 全幅比例带 | ribbon | 纯文字 | 2-6 | - | 600-800字 |
| theme09_page039 | 影像便当 | bento | 左图右文 | - | 3-6 | 200-300字 |
| theme09_page050 | 09 关键指标 | stat | 大数字 | 2-6 | - | 30-100字+巨数字 |
| theme09_page064 | 数字海报 | mega | 纯文字 | 0-6 | - | 600-800字 |
| theme09_page087 | 影像卡集 | cards | 多卡片2-4 | 2-4 | - | 每卡80-120字 |
| theme09_page099 | 10 赛道评分 | score | 大数字 | 2-5 | - | 30-100字+巨数字 |
| theme10_page007 | 核心数据 | metrics | 大数字 | 0-4 | - | 30-100字+巨数字 |
| theme10_page008 | 风险光谱 | spectrum | 多卡片3-6 | 3-6 | - | 每卡80-120字 |
| theme10_page021 | 目标进度 | goals | 纯文字 | 2-5 | - | 600-800字 |
| theme10_page053 | 声明金句 | statement | 金句 | - | - | 20-50字 |
| theme10_page056 | 大字指标 | bigstat | 大数字 | - | - | 30-100字+巨数字 |
| theme10_page057 | 巨幅数字 | megafigure | 大数字 | 0-3 | - | 30-100字+巨数字 |
| theme11_page034 | 指标 | page34 | 大数字 | 1-4 | - | 30-100字+巨数字 |
| theme11_page045 | 数字 | page45 | 纯文字 | 2-3 | - | 600-800字 |
| theme11_page056 | 数字 | page56 | 纯文字 | - | - | 600-800字 |
| theme11_page071 | 量级 | page71 | 大数字 | 3-6 | - | 30-100字+巨数字 |
| theme11_page075 | 达成 | page75 | 大数字 | - | - | 30-100字+巨数字 |
| theme11_page080 | 评分 | page80 | 大数字 | 3-5 | - | 30-100字+巨数字 |
| theme12_page008 | 满版标语 / Statement | statement | 金句 | - | - | 20-50字 |
| theme12_page010 | 能力便当 / Capabilities | bento | 多卡片4-6 | 4-6 | - | 每卡80-120字 |
| theme12_page027 | 票根 / Ticket Stub | ticket | 纯文字 | - | - | 600-800字 |
| theme12_page033 | 规格清单 / Spec Sheet | specs | 纯文字 | 2-4 | - | 600-800字 |
| theme12_page061 | 评分表 / Scorecard | scorecard | 大数字 | 2-4 | - | 30-100字+巨数字 |
| theme12_page062 | 大数字 / By the Numbers | bignumber | 大数字 | 0-3 | - | 30-100字+巨数字 |
| theme12_page063 | 三连大数 / Headline Stats | stat3 | 图表主视觉 | 2-3 | - | 80-120字+洞察 |
| theme12_page072 | 声波画廊 / Spectrum | spectrum | 多卡片5-9 | 5-9 | - | 每卡80-120字 |

## 图表·趋势（64 个 · 12 套主题覆盖）

| key | label | slot | L3族 | 卡数 | 图数 | 容量 |
| --- | --- | --- | --- | --- | --- | --- |
| theme01_page012 | 纵向趋势 | trend | 图表主视觉 | - | - | 80-120字+洞察 |
| theme01_page054 | 增速排行 · 条形图 | growth-bars | 图表主视觉 | 4-6 | - | 80-120字+洞察 |
| theme01_page056 | 资金迁移 · 斜率图 | slope | 流程 | 2-6 | - | 每步40-80字 |
| theme01_page059 | 流式面积图 · 构成演变 | stream-area | 图表主视觉 | 3-5 | - | 80-120字+洞察 |
| theme02_page008 | 市场全景 · Trend | trend | 图表主视觉 | - | - | 80-120字+洞察 |
| theme02_page022 | 今昔对照 · Delta | delta | 并列 | 0-3 | - | 200-300字 |
| theme02_page064 | 斜率图 · Slope | slope | 网格画廊 | 2-6 | - | 图说各20-40字 |
| theme02_page072 | 主题河流 · Stream | stream | 多卡片4-6 | 4-6 | - | 每卡80-120字 |
| theme03_page008 | 市场全景 | trend | 图表主视觉 | - | - | 80-120字+洞察 |
| theme03_page017 | 应用层 | vertical | 左图右文 | 0-3 | 0-2 | 200-300字 |
| theme03_page026 | 单月峰值 | peak | 纯文字 | - | - | 600-800字 |
| theme03_page027 | 资金累积 | cumulative | 纯文字 | - | - | 600-800字 |
| theme03_page031 | 估值跃迁 | valuationjump | 纯文字 | - | - | 600-800字 |
| theme03_page037 | 三视野 | horizon | 纯文字 | - | - | 600-800字 |
| theme03_page057 | 成熟度曲线 | hypecycle | 流程 | - | - | 每步40-80字 |
| theme04_page012 | 排名变迁 | slope | 多卡片3-6 | 3-6 | - | 每卡80-120字 |
| theme04_page017 | 融资趋势 | charts | 图表主视觉 | 1-2 | - | 80-120字+洞察 |
| theme04_page018 | 月度趋势 | monthchart | 图表主视觉 | - | - | 80-120字+洞察 |
| theme04_page023 | 季度走势表 | quartertable | 排行表格 | 2-4 | - | 每行20-50字 |
| theme04_page031 | 增长大数字 | deltahero | 大数字 | - | - | 30-100字+巨数字 |
| theme04_page052 | 估值三级跳 | valuechart | 纯文字 | 2-3 | - | 600-800字 |
| theme04_page056 | 标注特写 | annotated | 纯文字 | 0-1 | - | 600-800字 |
| theme05_page009 | 趋势 Trend | trend | 图表主视觉 | 2-4 | - | 80-120字+洞察 |
| theme05_page022 | 环比对比 Delta | delta | 并列 | 2-3 | - | 200-300字 |
| theme05_page023 | 峰值图文 Peak | peak | 左图右文 | 2-3 | 0-3 | 200-300字 |
| theme05_page024 | 走势曲线 Curve | curve | 纯文字 | 2-4 | - | 600-800字 |
| theme05_page025 | 峰谷 Peak/Trough | peaktrough | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme05_page029 | 累计曲线 Cumulative | cumulative | 纯文字 | 2-4 | - | 600-800字 |
| theme05_page075 | 兑现轨迹 Horizon | horizon | 左图右文 | 1-3 | 0-2 | 200-300字 |
| theme05_page085 | 排名变迁 Slope | slope | 多卡片4-7 | 4-7 | - | 每卡80-120字 |
| theme06_page009 | 05 · 市场全景 / TREND | trend | 图表主视觉 | - | - | 80-120字+洞察 |
| theme06_page012 | 08 · 冷启动季度 / Q1 BREAKDOWN | q1 | 纯文字 | 2-3 | - | 600-800字 |
| theme06_page013 | 09 · 加速季度 / Q2 BREAKDOWN | q2 | 纯文字 | 2-6 | - | 600-800字 |
| theme06_page014 | 10 · 峰值季度 / Q3 PEAK | q3 | 纯文字 | 0-2 | - | 600-800字 |
| theme06_page015 | 11 · 回落季度 / Q4 PULLBACK | q4 | 纯文字 | 2-4 | - | 600-800字 |
| theme06_page016 | 12 · 峰值与低位 / PEAK & TROUGH | peaktrough | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme06_page020 | 16 · 累计资金分布 / CAPITAL CURVE | cumulative | 纯文字 | 2-4 | - | 600-800字 |
| theme06_page037 | 33 · 增长效率工具 / GROWTH | growth | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme06_page070 | 66 · 嵌入工作流 / VERTICAL STRATEGY | vertical | 纯文字 | 2-5 | - | 600-800字 |
| theme06_page081 | 77 · 资本流向预测 / CAPITAL FLOW | capflow | 流程 | 3-6 | - | 每步40-80字 |
| theme07_page020 | 季度 Q3 峰值 | peak-page | 纯文字 | 2-4 | - | 600-800字 |
| theme07_page022 | 峰谷 Peak/Trough | peak-trough-page | 多卡片6-12 | 6-12 | - | 每卡80-120字 |
| theme07_page069 | 前瞻 Forward | forward-page | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme08_page008 | ⑤ 趋势 · Trend | p5 | 图表主视觉 | - | - | 80-120字+洞察 |
| theme08_page021 | ⑲ 峰值聚焦 · Peak | p19 | 纯文字 | 0-3 | - | 600-800字 |
| theme08_page023 | ㉑ 峰谷对比 · Peak/Trough | p21 | 并列 | 4-12 | - | 200-300字 |
| theme08_page027 | ㉕ 累计曲线 · Capital Curve | p25 | 纯文字 | 2-5 | - | 600-800字 |
| theme09_page013 | 季度资金之流 | stream | 纯文字 | 2-5 | - | 600-800字 |
| theme09_page054 | 批注精读 | annotated | 纯文字 | 2-4 | - | 600-800字 |
| theme09_page069 | 10 应用落地 | vertical | 多卡片4-8 | 4-8 | - | 每卡80-120字 |
| theme09_page083 | 10 排名变迁 | slope | 多卡片3-8 | 3-8 | - | 每卡80-120字 |
| theme09_page089 | 10 季度走势 | trend | 图表主视觉 | 2-4 | - | 80-120字+洞察 |
| theme09_page091 | 预测扇形 | fan | 纯文字 | - | - | 600-800字 |
| theme10_page020 | 排名变化 | slope | 多卡片3-7 | 3-7 | - | 每卡80-120字 |
| theme10_page027 | 净值曲线 | curve | 纯文字 | 0-4 | - | 600-800字 |
| theme10_page028 | 堆叠面积 | areastack | 图表主视觉 | 2-5 | - | 80-120字+洞察 |
| theme10_page072 | K线蜡烛 | candles | 纯文字 | - | - | 600-800字 |
| theme10_page084 | 标注影像 | annotated | 网格画廊 | 2-5 | - | 图说各20-40字 |
| theme10_page089 | 主题河流 | stream | 多卡片3-6 | 3-6 | - | 每卡80-120字 |
| theme11_page054 | 趋势 | page54 | 图表主视觉 | 2-3 | - | 80-120字+洞察 |
| theme11_page072 | 累计 | page72 | 纯文字 | - | - | 600-800字 |
| theme12_page048 | 增长曲线 / Growth | growth | 纯文字 | 1-2 | - | 600-800字 |
| theme12_page049 | 堆叠面积 / Stacked Area | areastack | 图表主视觉 | 2-3 | - | 80-120字+洞察 |
| theme12_page050 | 斜率图 / Slope | slope | 网格画廊 | - | - | 图说各20-40字 |

## 图表·构成占比（65 个 · 12 套主题覆盖）

| key | label | slot | L3族 | 卡数 | 图数 | 容量 |
| --- | --- | --- | --- | --- | --- | --- |
| theme01_page049 | 活跃投资机构榜 | investors | 纯文字 | 2-6 | - | 600-800字 |
| theme01_page067 | 资金瀑布 · 构成 | waterfall | 图表主视觉 | 3-5 | - | 80-120字+洞察 |
| theme01_page071 | 构成演变 · 百分比堆叠 | stacked-mix | 纯文字 | 2-5 | - | 600-800字 |
| theme01_page072 | 像形方格图 · 资金去向 | waffle | 网格画廊 | 2-5 | - | 图说各20-40字 |
| theme01_page078 | 玫瑰图 · 赛道占比 | polar-rose | 图表主视觉 | 3-5 | - | 80-120字+洞察 |
| theme01_page079 | 甜甜圈 · 资金来源占比 | donut | 图表主视觉 | 3-5 | - | 80-120字+洞察 |
| theme01_page080 | 赛道 × 阶段 · 可变宽堆叠 | mekko | 流程 | 3-5 | - | 每步40-80字 |
| theme02_page010 | 行业占比 · Share | industry | 图表主视觉 | - | - | 80-120字+洞察 |
| theme02_page036 | 市场结构 · Marimekko | marimekko | 纯文字 | 2-5 | - | 600-800字 |
| theme02_page039 | 资本桥 · Waterfall | waterfall | 图表主视觉 | 2-6 | - | 80-120字+洞察 |
| theme02_page048 | 资本结构 · Stacked Bar | stacked | 图表主视觉 | 2-4 | - | 80-120字+洞察 |
| theme02_page049 | 案例拼贴 · Mosaic | mosaic | 左图右文 | - | 0-5 | 200-300字 |
| theme02_page061 | 节律玫瑰 · Rose | rose | 图表主视觉 | 3-6 | - | 80-120字+洞察 |
| theme02_page068 | 资本去向 · Sunburst | sunburst | 纯文字 | 1-3 | - | 600-800字 |
| theme03_page024 | 轮次单位图 | waffle | 网格画廊 | - | - | 图说各20-40字 |
| theme03_page030 | 地理图集 | mosaic | 左图右文 | - | 2-5 | 200-300字 |
| theme03_page059 | 资本大年 | share | 纯文字 | 0-3 | - | 600-800字 |
| theme03_page060 | 季度节奏 | waterfall | 图表主视觉 | - | - | 80-120字+洞察 |
| theme03_page068 | 月度玫瑰 | rose | 图表主视觉 | - | - | 80-120字+洞察 |
| theme03_page069 | 资金矩阵 | marimekko | 图表主视觉 | - | - | 80-120字+洞察 |
| theme03_page070 | 三重集中 | concentration | 纯文字 | - | - | 600-800字 |
| theme04_page010 | 赛道占比 | donut | 图表主视觉 | 2-5 | - | 80-120字+洞察 |
| theme04_page014 | 资金瀑布 | waterfall | 图表主视觉 | 2-5 | - | 80-120字+洞察 |
| theme04_page019 | 季度资本构成 | stacked | 纯文字 | 2-4 | - | 600-800字 |
| theme05_page010 | 占比 Share | share | 图表主视觉 | 3-5 | - | 80-120字+洞察 |
| theme05_page026 | 瀑布 Waterfall | waterfall | 图表主视觉 | 3-5 | - | 80-120字+洞察 |
| theme05_page027 | 双维堆叠 Split | stacked | 并列 | 2-4 | - | 200-300字 |
| theme05_page036 | 场景占比 Scene | scene | 图表主视觉 | 2-4 | 0-1 | 80-120字+洞察 |
| theme05_page040 | 构成占比 Mix | mix | 图表主视觉 | 2-3 | 0-2 | 80-120字+洞察 |
| theme05_page072 | 架构栈 Stack | stack | 纯文字 | 2-4 | - | 600-800字 |
| theme05_page088 | 影像档案 Mosaic | mosaic | 左图右文 | 0-4 | 0-5 | 200-300字 |
| theme05_page090 | 变宽堆叠 Mekko | mekko | 纯文字 | 2-5 | - | 600-800字 |
| theme06_page017 | 13 · 赛道贡献 / WATERFALL | waterfall | 图表主视觉 | 3-5 | - | 80-120字+洞察 |
| theme06_page018 | 14 · 金额区间结构 / SIZE SPLIT | sizesplit | 并列 | 2-4 | - | 200-300字 |
| theme06_page043 | 39 · 复杂交易结构 / DEAL STRUCTURE | dealstruct | 纯文字 | 2-4 | - | 600-800字 |
| theme06_page044 | 40 · 资本来源结构 / INVESTOR MIX | investor | 纯文字 | 2-4 | - | 600-800字 |
| theme07_page023 | 瀑布 Waterfall | waterfall-page | 图表主视觉 | 3-5 | - | 80-120字+洞察 |
| theme07_page026 | 图谱 Investors | investor-page | 左图右文 | - | 0-4 | 200-300字 |
| theme07_page028 | 集中度 Concentration | concentration-page | 纯文字 | 2-3 | - | 600-800字 |
| theme07_page049 | 构成 Investor Mix | investor-mix-page | 纯文字 | 2-4 | - | 600-800字 |
| theme08_page024 | ㉒ 贡献瀑布 · Waterfall | p22 | 图表主视觉 | 2-5 | - | 80-120字+洞察 |
| theme08_page034 | ㉜ 场景占比 · Scene Split | p32 | 图表主视觉 | 0-3 | - | 80-120字+洞察 |
| theme08_page051 | (52) 资本来源 · Investor Mix | p52 | 多卡片3-4 | 3-4 | - | 每卡80-120字 |
| theme09_page018 | 层级旭日 | sunburst | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme09_page048 | 市占矩形 | marimekko | 多卡片3-6 | 3-6 | - | 每卡80-120字 |
| theme09_page061 | 10 资金用途 | alloc | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme09_page062 | 资金玫瑰 | rose | 图表主视觉 | 4-8 | - | 80-120字+洞察 |
| theme09_page070 | 影像拼贴 | mosaic | 左图右文 | 0-6 | 0-6 | 200-300字 |
| theme09_page076 | 10 资金瀑布 | waterfall | 图表主视觉 | 3-6 | - | 80-120字+洞察 |
| theme09_page094 | 10 结构演变 | stacked | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme10_page011 | 配置明细 | allocation | 排行表格 | 1-6 | - | 每行20-50字 |
| theme10_page012 | 构成对比 | stacked | 并列 | 2-6 | - | 200-300字 |
| theme10_page014 | 份额矩阵 | mekko | 图表主视觉 | 3-5 | - | 80-120字+洞察 |
| theme10_page026 | 收益归因 | waterfall | 图表主视觉 | 3-6 | - | 80-120字+洞察 |
| theme10_page070 | 图文马赛克 | mosaic | 网格画廊 | 0-6 | - | 图说各20-40字 |
| theme10_page080 | 象形占比 | isotype | 图表主视觉 | 2-4 | - | 80-120字+洞察 |
| theme10_page083 | 同心环 | radialstack | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme10_page090 | 资产拼花 | quilt | 多卡片4-6 | 4-6 | - | 每卡80-120字 |
| theme11_page059 | 构成 | page59 | 纯文字 | - | - | 600-800字 |
| theme11_page079 | 构成 | page79 | 纯文字 | - | - | 600-800字 |
| theme12_page009 | 产品矩阵 / The Stack | stack | 图表主视觉 | 2-4 | - | 80-120字+洞察 |
| theme12_page044 | 收益构成 / Composition | donut | 图表主视觉 | 1-5 | - | 80-120字+洞察 |
| theme12_page047 | 瀑布图 / Waterfall | waterfall | 图表主视觉 | 3-5 | - | 80-120字+洞察 |
| theme12_page054 | 堆叠柱状 / Stacked Bars | stackbars | 图表主视觉 | 4-8 | - | 80-120字+洞察 |
| theme12_page065 | 影像拼贴 / Gallery | mosaic | 网格画廊 | 2-5 | - | 图说各20-40字 |

## 图表·分布比较（59 个 · 11 套主题覆盖）

| key | label | slot | L3族 | 卡数 | 图数 | 容量 |
| --- | --- | --- | --- | --- | --- | --- |
| theme01_page031 | 资本四象限 | quadrant | 图表主视觉 | 0-4 | - | 80-120字+洞察 |
| theme01_page051 | 市销率天梯 · 估值 vs 收入 | bubble-scatter | 图表主视觉 | 3-6 | - | 80-120字+洞察 |
| theme01_page053 | 资金热力矩阵 | heatmap | 图表主视觉 | 3-5 | - | 80-120字+洞察 |
| theme01_page055 | 吸金力排行 · 棒棒糖图 | lollipop | 排行表格 | 4-6 | - | 每行20-50字 |
| theme01_page060 | 子弹图 · 目标达成度 | bullet | 大数字 | 3-5 | - | 30-100字+巨数字 |
| theme01_page068 | 估值跃迁 · 哑铃图 | dumbbell | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme01_page075 | 同比对比 · 分组柱状图 | grouped-columns | 图表主视觉 | 3-5 | - | 80-120字+洞察 |
| theme01_page077 | 多空信号 · 双向条形 | diverging | 并列 | 4-6 | - | 200-300字 |
| theme02_page009 | 月度热力 · Heatmap | heatmap | 图表主视觉 | 3-6 | - | 80-120字+洞察 |
| theme02_page015 | 四象限 · Matrix | quadrant | 图表主视觉 | - | - | 80-120字+洞察 |
| theme02_page038 | 估值散点 · Scatter | scatter | 图表主视觉 | 3-6 | - | 80-120字+洞察 |
| theme02_page054 | 差距图 · Dumbbell | dumbbell | 网格画廊 | 2-5 | - | 图说各20-40字 |
| theme02_page057 | 月度气泡 · Bubble TL | bubbletl | 图表主视觉 | - | - | 80-120字+洞察 |
| theme02_page060 | 集中度 · Pareto | pareto | 纯文字 | 2-13 | - | 600-800字 |
| theme02_page073 | 规模分布 · Distribution | histogram | 纯文字 | 2-4 | - | 600-800字 |
| theme03_page013 | 融资体量 | bubble | 图表主视觉 | - | - | 80-120字+洞察 |
| theme03_page014 | 选题四象限 | quadrant | 图表主视觉 | - | - | 80-120字+洞察 |
| theme03_page053 | 资本集中度 | pareto | 纯文字 | - | - | 600-800字 |
| theme03_page072 | 轮次背向 | tornado | 纯文字 | - | - | 600-800字 |
| theme04_page011 | 估值散点 | scatter | 图表主视觉 | 3-6 | - | 80-120字+洞察 |
| theme04_page021 | 资金热力矩阵 | heatmap | 图表主视觉 | 6-12 | - | 80-120字+洞察 |
| theme04_page025 | 资金消长 | spread | 多卡片3-6 | 3-6 | - | 每卡80-120字 |
| theme04_page043 | 选题四象限 | quadrant | 图表主视觉 | 0-4 | - | 80-120字+洞察 |
| theme04_page053 | 估值跃迁 | dumbbell | 纯文字 | 2-5 | - | 600-800字 |
| theme05_page013 | 热力 Heatmap | heat | 图表主视觉 | 6-12 | - | 80-120字+洞察 |
| theme05_page015 | 象限 Quadrant | quad | 图表主视觉 | - | - | 80-120字+洞察 |
| theme05_page020 | 气泡 Deal Map | bubble | 图表主视觉 | 2-4 | - | 80-120字+洞察 |
| theme05_page064 | 区域分布 Spread | spread | 左图右文 | 2-4 | 0-2 | 200-300字 |
| theme05_page077 | 转化阶梯 Ladder | ladder | 纯文字 | 2-4 | - | 600-800字 |
| theme06_page011 | 07 · 规模分层 / DEAL MAP | dealmap | 纯文字 | 2-4 | - | 600-800字 |
| theme06_page029 | 25 · 机会矩阵 / QUADRANT | quadrant | 图表主视觉 | - | - | 80-120字+洞察 |
| theme06_page074 | 70 · 全年月度热力 / MONTHLY HEAT | heatmap | 时间轴 | 6-12 | - | 每节点30-60字 |
| theme07_page017 | 气泡 Deal Map | deal-map-page | 图表主视觉 | 2-4 | - | 80-120字+洞察 |
| theme08_page012 | ⑨ 热力 · Heatmap | p9 | 图表主视觉 | undefined-undefined | - | 80-120字+洞察 |
| theme08_page018 | ⑯ 气泡图 · Deal Map | p16 | 图表主视觉 | 2-4 | - | 80-120字+洞察 |
| theme08_page025 | ㉓ 区间结构 · Size Split | p23 | 并列 | 2-4 | - | 200-300字 |
| theme08_page059 | (60) 点阵图 · Other Regions | p60 | 多卡片3-8 | 3-8 | - | 每卡80-120字 |
| theme08_page080 | (86) 哑铃图 · Range | p86 | 多卡片3-6 | 3-6 | - | 每卡80-120字 |
| theme09_page009 | 点阵计数 | dotfield | 纯文字 | - | - | 600-800字 |
| theme09_page037 | 同比对望 | tornado | 多卡片3-7 | 3-7 | - | 每卡80-120字 |
| theme09_page045 | 09 定位矩阵 | quadrant | 图表主视觉 | 3-8 | - | 80-120字+洞察 |
| theme09_page046 | 体量聚类 | bubble | 图表主视觉 | 1-8 | - | 80-120字+洞察 |
| theme09_page077 | 10 月度热力 | heatmap | 图表主视觉 | 2-6 | - | 80-120字+洞察 |
| theme09_page084 | 区间对比 | dumbbell | 并列 | 3-7 | - | 200-300字 |
| theme09_page090 | 单笔分布 | ridge | 多卡片4-8 | 4-8 | - | 每卡80-120字 |
| theme10_page009 | 策略象限 | quadrant | 图表主视觉 | 3-6 | - | 80-120字+洞察 |
| theme10_page015 | 分组柱图 | grouped | 多卡片3-6 | 3-6 | - | 每卡80-120字 |
| theme10_page022 | 目标子弹图 | bullet | 网格画廊 | 2-6 | - | 图说各20-40字 |
| theme10_page029 | 收益分布 | distribution | 多卡片7-15 | 7-15 | - | 每卡80-120字 |
| theme10_page030 | 复利阶梯 | ladder | 多卡片3-7 | 3-7 | - | 每卡80-120字 |
| theme10_page058 | 风险气泡 | scatter | 图表主视觉 | 3-7 | - | 80-120字+洞察 |
| theme10_page059 | 年度盈亏 | diverging | 多卡片4-10 | 4-10 | - | 每卡80-120字 |
| theme10_page060 | 区间对比 | range | 并列 | 3-7 | - | 200-300字 |
| theme10_page062 | 相关性热力 | heatmap | 图表主视觉 | - | - | 80-120字+洞察 |
| theme10_page088 | 敏感性分析 | tornado | 纯文字 | 2-7 | - | 600-800字 |
| theme12_page037 | 热力网格 / Heatmap | heatmap | 图表主视觉 | - | - | 80-120字+洞察 |
| theme12_page052 | 点阵单位 / Units | dotplot | 纯文字 | - | - | 600-800字 |
| theme12_page053 | 气泡图 / Bubble | bubble | 图表主视觉 | 4-7 | - | 80-120字+洞察 |
| theme12_page057 | 子弹图 / Bullet | bullet | 多卡片3-5 | 3-5 | - | 每卡80-120字 |

## 图表·多维（95 个 · 12 套主题覆盖）

| key | label | slot | L3族 | 卡数 | 图数 | 容量 |
| --- | --- | --- | --- | --- | --- | --- |
| theme01_page017 | 赛道资金 · 矩形树图 | treemap | 图表主视觉 | 2-5 | - | 80-120字+洞察 |
| theme01_page018 | 资金流向 · 桑基图 | sankey | 图表主视觉 | 2-4 | - | 80-120字+洞察 |
| theme01_page022 | 资金集中度 · 漏斗 | funnel | 图表主视觉 | 3-4 | - | 80-120字+洞察 |
| theme01_page023 | 估值梯队 · 金字塔 | tier-pyramid | 图表主视觉 | 2-4 | - | 80-120字+洞察 |
| theme01_page065 | 三强能力雷达 | radar | 图表主视觉 | 2-4 | - | 80-120字+洞察 |
| theme01_page066 | 能力对比矩阵 | matrix | 图表主视觉 | 3-5 | - | 80-120字+洞察 |
| theme01_page070 | 排位赛 · 座次变化 | bump-rank | 多卡片3-6 | 3-6 | - | 每卡80-120字 |
| theme01_page074 | 环形仪表 · 关键比率 | arc-gauges | 图表主视觉 | 2-4 | - | 80-120字+洞察 |
| theme02_page016 | 能力雷达 · Radar | radar | 图表主视觉 | 3-6 | - | 80-120字+洞察 |
| theme02_page017 | 评级矩阵 · Rating | matrix | 图表主视觉 | 2-5 | - | 80-120字+洞察 |
| theme02_page019 | 资金流向 · Sankey | sankey | 图表主视觉 | 2-5 | - | 80-120字+洞察 |
| theme02_page037 | 资本漏斗 · Funnel | funnel | 图表主视觉 | 2-4 | - | 80-120字+洞察 |
| theme02_page040 | 达成率 · Gauge | gauge | 图表主视觉 | 2-4 | - | 80-120字+洞察 |
| theme02_page058 | 优先金字塔 · Pyramid | pyramid | 图表主视觉 | 2-3 | - | 80-120字+洞察 |
| theme02_page062 | 赛道版图 · Treemap | treemap | 图表主视觉 | 2-5 | - | 80-120字+洞察 |
| theme02_page065 | 径向枢纽 · Orbit | orbit | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme02_page069 | 名次变迁 · Bump | bump | 纯文字 | 2-5 | - | 600-800字 |
| theme02_page071 | 维恩交集 · Venn | venn | 纯文字 | 2-3 | - | 600-800字 |
| theme03_page040 | AARRR | aarrr | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme03_page041 | RFM | rfm | 纯文字 | - | - | 600-800字 |
| theme03_page042 | MABA | maba | 纯文字 | 1-6 | - | 600-800字 |
| theme03_page044 | 决策双钻 | doublediamond | 纯文字 | - | - | 600-800字 |
| theme03_page045 | SWOT | swot | 纯文字 | 2-4 | - | 600-800字 |
| theme03_page046 | 五力 | fiveforces | 纯文字 | - | - | 600-800字 |
| theme03_page047 | 画布 | canvas | 纯文字 | - | - | 600-800字 |
| theme03_page049 | 金字塔 | pyramid | 图表主视觉 | 3-6 | - | 80-120字+洞察 |
| theme03_page050 | 波士顿矩阵 | bcg | 图表主视觉 | 1-6 | - | 80-120字+洞察 |
| theme03_page052 | PEST | pest | 多卡片4-6 | 4-6 | - | 每卡80-120字 |
| theme03_page054 | 风险雷达 | radar | 图表主视觉 | - | - | 80-120字+洞察 |
| theme03_page056 | 范式转变 | shift | 纯文字 | - | - | 600-800字 |
| theme03_page058 | 决策矩阵 | betmatrix | 图表主视觉 | - | - | 80-120字+洞察 |
| theme03_page061 | 资金版图 | treemap | 图表主视觉 | - | - | 80-120字+洞察 |
| theme03_page064 | 资本流向 | sankey | 图表主视觉 | - | - | 80-120字+洞察 |
| theme03_page066 | 泡沫温度计 | gauge | 图表主视觉 | - | - | 80-120字+洞察 |
| theme04_page013 | 资金版图 | treemap | 图表主视觉 | 2-5 | - | 80-120字+洞察 |
| theme04_page020 | 三重集中 | gauges | 图表主视觉 | - | - | 80-120字+洞察 |
| theme04_page028 | 能力对照矩阵 | matrix | 图表主视觉 | 3-4 | - | 80-120字+洞察 |
| theme04_page034 | 资本漏斗 | funnel | 图表主视觉 | - | - | 80-120字+洞察 |
| theme04_page037 | 产业链分层 | layers | 纯文字 | 1-3 | - | 600-800字 |
| theme04_page049 | 多维雷达 | radar | 图表主视觉 | 2-3 | - | 80-120字+洞察 |
| theme04_page054 | 估值金字塔 | pyramid | 图表主视觉 | - | - | 80-120字+洞察 |
| theme04_page060 | 拍立得拼贴 | polaroid | 网格画廊 | 0-4 | - | 图说各20-40字 |
| theme05_page031 | 雷达 Radar | radar | 图表主视觉 | 3-4 | - | 80-120字+洞察 |
| theme05_page034 | 对照表 Matrix | matrix | 并列 | 2-4 | - | 200-300字 |
| theme05_page048 | 指标仪表 Meter | meter | 图表主视觉 | 2-4 | - | 80-120字+洞察 |
| theme05_page049 | 增长漏斗 Funnel | funnel | 图表主视觉 | 2-4 | 0-3 | 80-120字+洞察 |
| theme05_page059 | 生态环图 Orbit | orbit | 左图右文 | 2-4 | 0-3 | 200-300字 |
| theme06_page022 | 18 · 模型实验室竞争 / MODEL LAB RACE | radar | 图表主视觉 | 3-6 | - | 80-120字+洞察 |
| theme07_page012 | 象限 Quadrant | matrix-page | 图表主视觉 | - | - | 80-120字+洞察 |
| theme08_page014 | ⑪ 象限 · Quadrant | p11 | 图表主视觉 | - | - | 80-120字+洞察 |
| theme08_page029 | ㉗ 雷达图 · Radar | p27 | 图表主视觉 | 4-6 | - | 80-120字+洞察 |
| theme08_page032 | ㉚ 场景矩阵 · Matrix | p30 | 图表主视觉 | 2-4 | - | 80-120字+洞察 |
| theme09_page016 | 03 横向透视 | cross | 纯文字 | 2-5 | - | 600-800字 |
| theme09_page017 | 板块联投 | chord | 多卡片3-6 | 3-6 | - | 每卡80-120字 |
| theme09_page026 | 影像速写 | polaroid | 左图右文 | - | 1-6 | 200-300字 |
| theme09_page036 | 赛道名次 | bump | 多卡片4-8 | 4-8 | - | 每卡80-120字 |
| theme09_page040 | 08 估值矩阵 | matrix | 图表主视觉 | 2-6 | - | 80-120字+洞察 |
| theme09_page047 | 09 资本漏斗 | funnel | 图表主视觉 | 3-6 | - | 80-120字+洞察 |
| theme09_page049 | 计量条 | meter | 纯文字 | 2-6 | - | 600-800字 |
| theme09_page051 | 交叉透视 | crosstab | 纯文字 | 2-6 | - | 600-800字 |
| theme09_page056 | 资本弧网 | arc | 多卡片4-8 | 4-8 | - | 每卡80-120字 |
| theme09_page058 | 10 估值梯队 | tier | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme09_page063 | 环形纪程 | orbit | 时间轴 | 3-7 | - | 每节点30-60字 |
| theme09_page065 | 10 全球格局 | radar | 图表主视觉 | 1-3 | - | 80-120字+洞察 |
| theme09_page067 | 评级矩阵 | grade | 图表主视觉 | 3-8 | - | 80-120字+洞察 |
| theme09_page068 | 交集视图 | venn | 网格画廊 | 2-3 | - | 图说各20-40字 |
| theme09_page071 | 径向透视 | radialbar | 图表主视觉 | 2-6 | - | 80-120字+洞察 |
| theme09_page072 | 10 公司版图 | treemap | 图表主视觉 | 5-12 | - | 80-120字+洞察 |
| theme09_page073 | 层级冰柱 | icicle | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme09_page079 | 赛道蜂巢 | honeycomb | 多卡片4-10 | 4-10 | - | 每卡80-120字 |
| theme09_page085 | 10 景气仪表 | gauge | 图表主视觉 | 2-4 | - | 80-120字+洞察 |
| theme10_page013 | 占比树图 | treemap | 图表主视觉 | 4-9 | - | 80-120字+洞察 |
| theme10_page016 | 核心卫星 | orbit | 多卡片3-6 | 3-6 | - | 每卡80-120字 |
| theme10_page025 | 数据仪表盘 | dashboard | 图表主视觉 | 2-6 | - | 80-120字+洞察 |
| theme10_page034 | 转化漏斗 | funnel | 图表主视觉 | 3-5 | - | 80-120字+洞察 |
| theme10_page061 | 极坐标花瓣 | polar | 多卡片4-8 | 4-8 | - | 每卡80-120字 |
| theme10_page063 | 因子雷达 | radar | 图表主视觉 | - | - | 80-120字+洞察 |
| theme10_page073 | 资金桑基 | sankey | 图表主视觉 | 2-4 | - | 80-120字+洞察 |
| theme10_page074 | 半环量规 | meter | 纯文字 | 2-5 | - | 600-800字 |
| theme10_page081 | 名次走势 | bump | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme10_page082 | 财富金字塔 | pyramid | 图表主视觉 | 3-4 | - | 80-120字+洞察 |
| theme10_page086 | 策略交集 | venn | 纯文字 | - | - | 600-800字 |
| theme10_page087 | 权衡天平 | balance | 纯文字 | 2-4 | - | 600-800字 |
| theme10_page091 | 蜂窝指标 | hive | 大数字 | 4-7 | - | 30-100字+巨数字 |
| theme10_page093 | 圆形图集 | medallions | 左图右文 | - | 0-6 | 200-300字 |
| theme11_page015 | 漏斗 | page15 | 图表主视觉 | 3-5 | - | 80-120字+洞察 |
| theme12_page016 | 叠影 / Layered | layers | 纯文字 | 2-4 | - | 600-800字 |
| theme12_page025 | 拍立得 / Polaroid | polaroid | 左图右文 | - | 3-5 | 200-300字 |
| theme12_page045 | 占比方块 / Treemap | treemap | 图表主视觉 | - | - | 80-120字+洞察 |
| theme12_page046 | 资金流向 / Flow | sankey | 流程 | 3-5 | - | 每步40-80字 |
| theme12_page051 | 转化漏斗 / Funnel | funnel | 图表主视觉 | 3-5 | - | 80-120字+洞察 |
| theme12_page056 | 仪表盘 / Gauges | gauges | 图表主视觉 | 2-4 | - | 80-120字+洞察 |
| theme12_page058 | 受众分层 / Pyramid | pyramid | 多卡片4-6 | 4-6 | - | 每卡80-120字 |
| theme12_page059 | 能力雷达 / Radar | radar | 图表主视觉 | 4-6 | - | 80-120字+洞察 |
| theme12_page060 | 定位矩阵 / Positioning | matrix | 图表主视觉 | 3-6 | - | 80-120字+洞察 |

## 图表·时间/排期（40 个 · 12 套主题覆盖）

| key | label | slot | L3族 | 卡数 | 图数 | 容量 |
| --- | --- | --- | --- | --- | --- | --- |
| theme01_page028 | 里程碑时间轴 | timeline | 时间轴 | 2-5 | - | 每节点30-60字 |
| theme01_page044 | 月度节奏 | monthly | 时间轴 | - | - | 每节点30-60字 |
| theme01_page058 | 年度关键节点 · 纵向时间线 | zigzag-timeline | 时间轴 | 3-6 | - | 每节点30-60字 |
| theme01_page061 | 甘特排期 · IPO 上市窗口 | gantt | 时间轴 | 3-6 | - | 每节点30-60字 |
| theme02_page012 | 时间轴 · Timeline | timeline | 时间轴 | 3-6 | - | 每节点30-60字 |
| theme02_page028 | 交错图文 · Zigzag | zigzag | 网格画廊 | 2-3 | - | 图说各20-40字 |
| theme03_page009 | 年度编年 | chronicle | 时间轴 | 3-6 | - | 每节点30-60字 |
| theme03_page025 | 月度明细 | monthly | 时间轴 | - | - | 每节点30-60字 |
| theme03_page036 | 策略时间轴 | timeline | 时间轴 | 1-3 | - | 每节点30-60字 |
| theme03_page043 | 建仓甘特 | gantt | 时间轴 | 3-8 | - | 每节点30-60字 |
| theme03_page048 | 旅程图 | journey | 时间轴 | 3-5 | - | 每节点30-60字 |
| theme04_page022 | 资本月历 | calendar | 时间轴 | - | - | 每节点30-60字 |
| theme04_page066 | 泳道甘特 | gantt | 时间轴 | 3-6 | - | 每节点30-60字 |
| theme04_page068 | 阶段策略 | timeline | 流程 | 2-3 | - | 每步40-80字 |
| theme05_page021 | 季度快照 Snapshot | snapshot | 纯文字 | 2-3 | - | 600-800字 |
| theme05_page087 | 周期里程 Era | era | 时间轴 | 3-6 | - | 每节点30-60字 |
| theme06_page083 | 79 · 里程碑节奏 / MILESTONES 2025 | milestones | 时间轴 | 3-4 | - | 每节点30-60字 |
| theme07_page010 | 热力 Heatmap | monthly-page | 时间轴 | - | - | 每节点30-60字 |
| theme07_page018 | 季度 Q1 冷启动 | cold-start-page | 纯文字 | 2-4 | - | 600-800字 |
| theme07_page019 | 季度 Q2 加速 | accelerate-page | 时间轴 | 3-5 | - | 每节点30-60字 |
| theme07_page021 | 季度 Q4 回落 | cooldown-page | 纯文字 | 2-4 | - | 600-800字 |
| theme08_page022 | ⑳ 回落时间轴 · Pullback | p20 | 时间轴 | 2-4 | - | 每节点30-60字 |
| theme08_page073 | (79) 时间轴 · Repricing | p79 | 时间轴 | 2-4 | - | 每节点30-60字 |
| theme08_page081 | (87) 路线图 · Roadmap | p87 | 流程 | 2-5 | - | 每步40-80字 |
| theme09_page043 | 08 年度大事记 | timeline | 时间轴 | 3-8 | 0-4 | 每节点30-60字 |
| theme09_page044 | 螺旋纪程 | spiral | 时间轴 | 4-8 | - | 每节点30-60字 |
| theme09_page078 | 投资日历 | calendar | 时间轴 | - | - | 每节点30-60字 |
| theme09_page082 | 影像纪程 | journey | 时间轴 | - | 3-6 | 每节点30-60字 |
| theme09_page095 | 编年纪事 | era | 时间轴 | 2-5 | - | 每节点30-60字 |
| theme10_page031 | 横向时间轴 | timeline | 时间轴 | 3-6 | - | 每节点30-60字 |
| theme10_page032 | 排期甘特 | gantt | 时间轴 | 3-7 | - | 每节点30-60字 |
| theme10_page068 | 旅程进度 | journey | 时间轴 | 3-6 | - | 每节点30-60字 |
| theme10_page069 | 回报日历 | calendar | 时间轴 | - | - | 每节点30-60字 |
| theme11_page046 | 节拍 | page46 | 时间轴 | 2-3 | - | 每节点30-60字 |
| theme11_page070 | 旅程 | page70 | 时间轴 | - | - | 每节点30-60字 |
| theme11_page074 | 排期 | page74 | 时间轴 | 3-5 | - | 每节点30-60字 |
| theme11_page085 | 历程 | page85 | 时间轴 | 3-5 | - | 每节点30-60字 |
| theme12_page035 | 发布排期 / Schedule | calendar | 时间轴 | 1-5 | - | 每节点30-60字 |
| theme12_page076 | 旅程纵览 / Journey | journey | 时间轴 | 3-5 | - | 每节点30-60字 |
| theme12_page081 | 时间轴 / Roadmap | timeline | 流程 | 3-5 | - | 每步40-80字 |

## 排行/表格（37 个 · 12 套主题覆盖）

| key | label | slot | L3族 | 卡数 | 图数 | 容量 |
| --- | --- | --- | --- | --- | --- | --- |
| theme01_page019 | 头部玩家 | ranking | 排行表格 | 3-10 | - | 每行20-50字 |
| theme01_page021 | 表格 · Top 10 | table-top10 | 排行表格 | 1-10 | - | 每行20-50字 |
| theme01_page033 | 表格 · 轮次明细 | table | 排行表格 | 1-6 | - | 每行20-50字 |
| theme02_page011 | 融资榜单 · Leaderboard | ranking | 排行表格 | 3-6 | - | 每行20-50字 |
| theme02_page030 | 公司图谱 · Logo Wall | logowall | 网格画廊 | 0-6 | - | 图说各20-40字 |
| theme02_page050 | 明细表 · Data Table | datatable | 排行表格 | 3-6 | - | 每行20-50字 |
| theme03_page011 | 头部玩家 | rank | 多卡片5-10 | 5-10 | - | 每卡80-120字 |
| theme03_page012 | 速查表 | table | 排行表格 | 5-10 | - | 每行20-50字 |
| theme03_page055 | 风险登记册 | register | 排行表格 | 2-4 | - | 每行20-50字 |
| theme04_page024 | 轮次结构表 | table | 排行表格 | 3-6 | - | 每行20-50字 |
| theme04_page026 | 头部玩家对照表 | scoreboard | 并列 | 3-6 | - | 200-300字 |
| theme04_page027 | 投资人出手榜 | ledger | 排行表格 | 3-6 | - | 每行20-50字 |
| theme04_page036 | 头部玩家 | ranking | 排行表格 | 3-10 | - | 每行20-50字 |
| theme05_page014 | 排名 Ranking | rank | 排行表格 | 3-10 | - | 每行20-50字 |
| theme05_page042 | 结构表 Ledger | ledger | 排行表格 | 2-4 | - | 每行20-50字 |
| theme05_page078 | 风险登记表 Register | register | 排行表格 | 2-4 | - | 每行20-50字 |
| theme06_page026 | 22 · 融资排名 / RANKING | ranking | 排行表格 | 5-10 | - | 每行20-50字 |
| theme07_page011 | 排名 Ranking | ranking-page | 排行表格 | 5-10 | - | 每行20-50字 |
| theme07_page027 | 排名 Active Capital | active-capital-page | 多卡片4-7 | 4-7 | - | 每卡80-120字 |
| theme08_page013 | ⑩ 排名 · Ranking | p10 | 排行表格 | 3-10 | - | 每行20-50字 |
| theme08_page069 | (74) 合规台账 · Regulation | p74 | 排行表格 | 3-5 | - | 每行20-50字 |
| theme09_page035 | 08 资本排行 | ranking | 排行表格 | 3-8 | - | 每行20-50字 |
| theme09_page059 | 数据台账 | ledger | 排行表格 | 3-8 | - | 每行20-50字 |
| theme09_page086 | 年度计分榜 | scoreboard | 总分 | 2-5 | - | 50-100+分项各60-100字 |
| theme10_page010 | 账本表 | ledger | 排行表格 | 3-8 | - | 每行20-50字 |
| theme10_page065 | 行情板 | board | 多卡片3-8 | 3-8 | - | 每卡80-120字 |
| theme10_page066 | 排行榜 | ranking | 排行表格 | 4-8 | - | 每行20-50字 |
| theme10_page075 | 条款明细 | schedule | 排行表格 | 3-8 | - | 每行20-50字 |
| theme10_page094 | 名词释义 | glossary | 多卡片4-8 | 4-8 | - | 每卡80-120字 |
| theme11_page057 | 明细 | page57 | 排行表格 | 4-6 | - | 每行20-50字 |
| theme11_page064 | 排行 | page64 | 排行表格 | 3-5 | - | 每行20-50字 |
| theme12_page032 | 表格 / Compare | table | 并列 | 2-4 | - | 200-300字 |
| theme12_page034 | 名录榜 / Directory | directory | 排行表格 | 4-7 | - | 每行20-50字 |
| theme12_page041 | 价格 / Plans | pricing | 纯文字 | 2-4 | - | 600-800字 |
| theme12_page055 | 平台排行 / Ranking | ranking | 排行表格 | 2-7 | - | 每行20-50字 |
| theme12_page064 | 记分牌 / Scoreboard | scoreboard | 排行表格 | 2-4 | - | 每行20-50字 |
| theme12_page073 | 伙伴墙 / Logo Wall | logowall | 多卡片6-12 | 6-12 | - | 每卡80-120字 |

## 对比/对决（33 个 · 10 套主题覆盖）

| key | label | slot | L3族 | 卡数 | 图数 | 容量 |
| --- | --- | --- | --- | --- | --- | --- |
| theme01_page025 | 三强横向对比 | versus | 并列 | 2-3 | 0-1 | 200-300字 |
| theme01_page043 | 满版对比 · 双联画面 | split-diptych | 并列 | - | 0-2 | 200-300字 |
| theme01_page081 | 满版影像 · 三联现场 | triptych | 并列 | - | 1-3 | 200-300字 |
| theme02_page031 | 双图对比 · Compare | compare | 并列 | - | 0-2 | 200-300字 |
| theme02_page034 | 特性对照 · Compare Table | comparetable | 并列 | 3-6 | - | 200-300字 |
| theme02_page051 | 多空对照 · Versus | versus | 并列 | 2-3 | - | 200-300字 |
| theme04_page015 | 半年对比柱 | groupbars | 图表主视觉 | 3-5 | - | 80-120字+洞察 |
| theme04_page033 | 对比双数字 | versus | 并列 | 0-2 | - | 200-300字 |
| theme04_page048 | 全幅三联 | triptych | 并列 | 0-3 | - | 200-300字 |
| theme04_page061 | 分屏章节 | split | 并列 | - | - | 200-300字 |
| theme04_page062 | 投资策略 | compare | 并列 | 1-2 | - | 200-300字 |
| theme04_page063 | 叙事对兑现 | diptych | 并列 | 0-2 | - | 200-300字 |
| theme05_page008 | 方法 Methodology | split | 流程 | 2-6 | - | 每步40-80字 |
| theme05_page065 | 三类资源 Triad | triad | 并列 | 2-3 | - | 200-300字 |
| theme05_page091 | 对比大数字 Versus | versus | 大数字 | 0-3 | - | 30-100字+巨数字 |
| theme06_page053 | 49 · 三类关键资源 / TALENT·CAPITAL·COMPUTE | triad | 并列 | - | - | 200-300字 |
| theme08_page033 | ㉛ 分支三联 · Triptych | p31 | 并列 | 0-4 | - | 200-300字 |
| theme09_page023 | 斜切分屏 | split | 并列 | 0-4 | - | 200-300字 |
| theme09_page041 | 数字对决 | versus | 并列 | - | - | 200-300字 |
| theme09_page060 | 双联对照 | diptych | 并列 | 2-3 | - | 200-300字 |
| theme09_page103 | 12 多维对比 | compare | 并列 | 2-6 | - | 200-300字 |
| theme10_page018 | 抉择双栏 | versus | 并列 | 1-5 | - | 200-300字 |
| theme10_page042 | 三联影像 | triptych | 并列 | 2-4 | - | 200-300字 |
| theme10_page047 | 图像对照 | compareimg | 并列 | - | - | 200-300字 |
| theme11_page025 | 对比 | page25 | 并列 | 2-3 | - | 200-300字 |
| theme11_page032 | 对照 | page32 | 并列 | - | - | 200-300字 |
| theme11_page051 | 对比 | page51 | 并列 | 3-5 | - | 200-300字 |
| theme11_page082 | 前后 | page82 | 并列 | 3-5 | - | 200-300字 |
| theme12_page014 | 影像分栏 / Split | split | 并列 | 0-2 | - | 200-300字 |
| theme12_page015 | 三联像 / Triptych | triptych | 并列 | 2-4 | - | 200-300字 |
| theme12_page031 | 前后对比 / Before · After | beforeafter | 并列 | - | - | 200-300字 |
| theme12_page039 | 对照 / Before · After | contrast | 并列 | 2-4 | - | 200-300字 |
| theme12_page074 | 双联像 / Diptych | duo | 并列 | 0-2 | - | 200-300字 |

## 流程/路线/链（78 个 · 12 套主题覆盖）

| key | label | slot | L3族 | 卡数 | 图数 | 容量 |
| --- | --- | --- | --- | --- | --- | --- |
| theme01_page010 | 横纵分析法 | method | 流程 | - | - | 每步40-80字 |
| theme01_page014 | 产业链分层 | chain | 流程 | 1-3 | - | 每步40-80字 |
| theme01_page032 | 轮次结构 | rounds | 纯文字 | - | - | 600-800字 |
| theme01_page040 | 阶段性策略路线图 | roadmap | 流程 | 2-4 | - | 每步40-80字 |
| theme02_page006 | 研究方法 · Method | method | 流程 | 1-4 | - | 每步40-80字 |
| theme02_page018 | 产业链分层 · Chain | chain | 流程 | 2-3 | - | 每步40-80字 |
| theme02_page032 | 轮次结构 · Rounds | rounds | 多卡片3-6 | 3-6 | - | 每卡80-120字 |
| theme02_page044 | 判断框架 · Process | process | 流程 | 2-4 | - | 每步40-80字 |
| theme02_page056 | 策略路线 · Roadmap | roadmap | 流程 | 2-3 | - | 每步40-80字 |
| theme02_page063 | 资本飞轮 · Cycle | cyclewheel | 流程 | 3-5 | - | 每步40-80字 |
| theme02_page066 | 三球串联 · Spheres | spheres | 纯文字 | 2-3 | - | 600-800字 |
| theme02_page067 | 机会图谱 · Mindmap | mindmap | 网格画廊 | 2-3 | - | 图说各20-40字 |
| theme03_page007 | 研究方法 | method | 流程 | 1-3 | - | 每步40-80字 |
| theme03_page015 | 产业链分层 | chain | 流程 | 1-3 | - | 每步40-80字 |
| theme03_page016 | 产业链速查 | layertable | 排行表格 | - | - | 每行20-50字 |
| theme03_page023 | 轮次结构 | round | 纯文字 | - | - | 600-800字 |
| theme03_page032 | 估值之谜 | valuation | 纯文字 | - | - | 600-800字 |
| theme03_page051 | 飞轮 | flywheel | 流程 | 4-6 | - | 每步40-80字 |
| theme03_page062 | 单笔阶梯 | escalation | 纯文字 | - | - | 600-800字 |
| theme04_page007 | 研究方法 | method | 流程 | 0-1 | - | 每步40-80字 |
| theme04_page038 | 产业链分层表 | chaintable | 流程 | - | - | 每步40-80字 |
| theme04_page039 | 产业链分层·流向 | chainflow | 流程 | - | - | 每步40-80字 |
| theme04_page065 | 资本三段式 | roadmap | 流程 | 2-4 | - | 每步40-80字 |
| theme04_page067 | 资本地铁线 | metro | 纯文字 | - | - | 600-800字 |
| theme05_page011 | 产业链 Value Chain | chain | 流程 | 2-4 | - | 每步40-80字 |
| theme05_page035 | 子项拆分 Breakdown | breakdown | 左图右文 | 2-3 | 0-3 | 200-300字 |
| theme05_page038 | 流程增长 Flow | flow | 流程 | 2-3 | - | 每步40-80字 |
| theme05_page039 | 图示规格 Diagram | diagram | 左图右文 | 2-4 | 0-2 | 200-300字 |
| theme05_page044 | 架构图 Atlas | atlas | 左图右文 | 2-4 | 0-2 | 200-300字 |
| theme05_page045 | 分层防线 Gate | gate | 纯文字 | 2-4 | - | 600-800字 |
| theme05_page047 | 学习路径 Path | path | 流程 | 2-3 | 0-3 | 每步40-80字 |
| theme05_page051 | 转化通道 Flux | flux | 左图右文 | - | 0-3 | 200-300字 |
| theme05_page052 | 评测流程 Shield | shield | 流程 | 2-3 | - | 每步40-80字 |
| theme05_page055 | 结构拆解 Composite | composite | 纯文字 | 2-4 | - | 600-800字 |
| theme05_page058 | 投资闭环 Loop | loop | 流程 | 2-3 | - | 每步40-80字 |
| theme05_page070 | 流程表 Process | process | 流程 | 2-4 | - | 每步40-80字 |
| theme05_page071 | 转化漏斗 Gateway | gateway | 图表主视觉 | 2-3 | 0-2 | 80-120字+洞察 |
| theme05_page082 | 工作流嵌入 Embed | embed | 纯文字 | 2-4 | - | 600-800字 |
| theme06_page008 | 04 · 研究方法 / METHODOLOGY | method | 流程 | 2-3 | - | 每步40-80字 |
| theme06_page027 | 23 · 产业链分层 / VALUE CHAIN | chain | 流程 | 2-3 | - | 每步40-80字 |
| theme06_page042 | 38 · 新主题萌芽 / EARLY-STAGE SIGNAL | rounds | 纯文字 | 2-4 | - | 600-800字 |
| theme07_page008 | 方法 Methodology | method-page | 流程 | 1-3 | - | 每步40-80字 |
| theme07_page047 | 信号 早期轮 | early-stage-page | 纯文字 | 2-4 | - | 600-800字 |
| theme07_page048 | 结构 未披露轮次 | deal-structure-page | 纯文字 | 2-4 | - | 600-800字 |
| theme07_page052 | 生态 NVIDIA | ecosystem-page | 左图右文 | 2-4 | 0-2 | 200-300字 |
| theme08_page010 | ⑦ 产业链 · Chain | p7 | 流程 | 2-3 | - | 每步40-80字 |
| theme08_page037 | ㉟ 架构 · Architecture | p35 | 纯文字 | 0-4 | - | 600-800字 |
| theme08_page044 | ㊸ 学习路径 · Education | p43 | 流程 | 1-4 | - | 每步40-80字 |
| theme08_page046 | ㊻ 流程嵌入 · Low Code | p46 | 流程 | 2-4 | - | 每步40-80字 |
| theme08_page053 | (54) 算力闭环 · Closed Loop | p54 | 流程 | 3-4 | - | 每步40-80字 |
| theme08_page072 | (78) 嵌入流程 · Workflow | p78 | 流程 | 3-5 | - | 每步40-80字 |
| theme09_page021 | 04 产业链分层 | chain | 流程 | - | - | 每步40-80字 |
| theme09_page034 | 08 轮次结构 | rounds | 纯文字 | 2-6 | - | 600-800字 |
| theme09_page055 | 10 资金流向 | flow | 流程 | 2-4 | - | 每步40-80字 |
| theme09_page057 | 资本网络 | network | 多卡片4-8 | 4-8 | - | 每卡80-120字 |
| theme09_page081 | 阶段时序 | phases | 流程 | 3-8 | - | 每步40-80字 |
| theme09_page092 | 方案对照 | plans | 并列 | 2-4 | - | 200-300字 |
| theme09_page093 | 阶梯递进 | stair | 多卡片3-6 | 3-6 | - | 每卡80-120字 |
| theme09_page098 | 10 布局路线 | roadmap | 流程 | 2-4 | - | 每步40-80字 |
| theme09_page104 | 13 实施路径 | process | 流程 | 2-6 | - | 每步40-80字 |
| theme10_page017 | 方案对照 | plans | 并列 | 2-4 | - | 200-300字 |
| theme10_page033 | 运作机制 | steps | 流程 | 3-5 | - | 每步40-80字 |
| theme10_page035 | 闭环循环 | cycle | 流程 | 3-6 | - | 每步40-80字 |
| theme10_page036 | 职责泳道 | swimlane | 流程 | 2-4 | - | 每步40-80字 |
| theme10_page067 | 资金流向 | flow | 流程 | 3-6 | - | 每步40-80字 |
| theme10_page071 | 行动清单 | checklist | 流程 | 3-8 | - | 每步40-80字 |
| theme11_page011 | 方法 | page11 | 流程 | 2-3 | - | 每步40-80字 |
| theme11_page021 | 路线 | page21 | 流程 | 1-5 | - | 每步40-80字 |
| theme11_page023 | 流程 | page23 | 流程 | 3-5 | - | 每步40-80字 |
| theme11_page024 | 诊断 | page24 | 纯文字 | 1-3 | - | 600-800字 |
| theme11_page026 | 清单 | page26 | 纯文字 | 1-7 | - | 600-800字 |
| theme11_page049 | 路线 | page49 | 流程 | 3-5 | - | 每步40-80字 |
| theme11_page053 | 飞轮 | page53 | 流程 | 3-5 | - | 每步40-80字 |
| theme12_page011 | 流程 / How It Works | process | 流程 | 3-5 | - | 每步40-80字 |
| theme12_page012 | 生态网络 / Ecosystem | ecosystem | 多卡片3-6 | 3-6 | - | 每卡80-120字 |
| theme12_page013 | 组织架构 / Structure | orgchart | 纯文字 | - | - | 600-800字 |
| theme12_page036 | 路线图 / Roadmap | roadmap | 流程 | 2-4 | - | 每步40-80字 |
| theme12_page038 | 特性矩阵 / Feature Matrix | checklist | 流程 | 4-7 | - | 每步40-80字 |

## 观点/结论/金句（77 个 · 12 套主题覆盖）

| key | label | slot | L3族 | 卡数 | 图数 | 容量 |
| --- | --- | --- | --- | --- | --- | --- |
| theme01_page027 | 金句 · CEO 视角 | quote-dario | 金句 | 0-2 | - | 20-50字 |
| theme01_page039 | 投资展望 | outlook | 金句 | 1-3 | - | 20-50字 |
| theme01_page047 | 金句 · 一句话总结 | quote | 金句 | 0-2 | - | 20-50字 |
| theme01_page082 | 大字主张 · 从叙事到兑现 | type-statement | 金句 | 0-3 | - | 20-50字 |
| theme01_page083 | 结论 | conclusion | 金句 | 1-4 | - | 20-50字 |
| theme02_page042 | 人物金句 · Portrait | portrait | 金句 | - | 0-1 | 20-50字 |
| theme02_page043 | 声音墙 · Voices | voices | 纯文字 | 2-4 | - | 600-800字 |
| theme02_page045 | 核心结论 · Takeaways | takeaway | 金句 | 2-4 | - | 20-50字 |
| theme02_page047 | 结语金句 · Quote | quote | 金句 | - | - | 20-50字 |
| theme02_page055 | 结论主张 · Manifesto | manifesto | 金句 | 2-3 | - | 20-50字 |
| theme02_page074 | 封底结语 · Closing | closing | 纯文字 | - | - | 600-800字 |
| theme03_page035 | 投资建议 | outlook | 金句 | 1-3 | - | 20-50字 |
| theme03_page038 | 核心结论 | takeaway | 金句 | 1-3 | - | 20-50字 |
| theme03_page039 | 金句页 | quote | 金句 | - | - | 20-50字 |
| theme04_page070 | 投资人说 | voices | 纯文字 | 2-3 | - | 600-800字 |
| theme04_page071 | 宣言金句 | manifesto | 金句 | - | - | 20-50字 |
| theme04_page072 | 论断印章 | verdict | 金句 | - | - | 20-50字 |
| theme04_page073 | 图文金句 | quoteimage | 金句 | 0-1 | - | 20-50字 |
| theme05_page017 | 策略 Outlook | outlook | 金句 | 2-4 | - | 20-50字 |
| theme05_page018 | 结论 Conclusion | quote | 金句 | 0-3 | - | 20-50字 |
| theme05_page084 | 最终判断 Verdict | verdict | 金句 | - | - | 20-50字 |
| theme05_page092 | 金句 Lede | lede | 金句 | - | - | 20-50字 |
| theme06_page031 | 27 · 投资建议 / OUTLOOK | outlook | 金句 | 2-4 | - | 20-50字 |
| theme06_page071 | 67 · 结论 / CONCLUSION | quote | 金句 | - | - | 20-50字 |
| theme06_page077 | 73 · 全景速览 / YEAR IN ONE VIEW | recap | 网格画廊 | 2-8 | - | 图说各20-40字 |
| theme06_page079 | 75 · 最终判断 / FINAL VERDICT | closing | 金句 | - | - | 20-50字 |
| theme07_page014 | 策略 Outlook | outlook-page | 金句 | 1-2 | - | 20-50字 |
| theme07_page015 | 结论 Conclusion | quote-page | 金句 | 0-3 | - | 20-50字 |
| theme07_page064 | 策略 优先基建 | strategy-infra-page | 纯文字 | 2-4 | - | 600-800字 |
| theme07_page065 | 策略 垂直应用 | strategy-vertical-page | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme07_page066 | 策略 IPO 重定价 | repricing-page | 纯文字 | 2-4 | - | 600-800字 |
| theme07_page067 | 结语 Closing | closing-page | 纯文字 | - | - | 600-800字 |
| theme08_page009 | ⑥ 透视 · Cross | p6 | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme08_page015 | ⑬ 策略 · Strategy | p13 | 纯文字 | 2-4 | - | 600-800字 |
| theme08_page016 | ⑭ 金句 · Quote | p14 | 金句 | 0-3 | - | 20-50字 |
| theme08_page035 | ㉝ 金句 · Statement | p33 | 金句 | 0-3 | - | 20-50字 |
| theme08_page060 | (61) 金句 · Resources | p61 | 金句 | 2-3 | - | 20-50字 |
| theme08_page071 | (77) 策略卡 · Budget | p77 | 多卡片2-4 | 2-4 | - | 每卡80-120字 |
| theme08_page074 | (80) 金句 · Verdict | p80 | 金句 | 0-3 | - | 20-50字 |
| theme08_page075 | (81) 展望主线 · Mainlines | p81 | 金句 | 0-4 | - | 20-50字 |
| theme08_page084 | (91) 金句 · Two-Field | p91 | 金句 | 0-3 | - | 20-50字 |
| theme09_page019 | 论点推演 | thesis | 纯文字 | 2-5 | - | 600-800字 |
| theme09_page028 | 06 投资展望 | outlook | 金句 | 1-3 | - | 20-50字 |
| theme09_page029 | 07 核心结论 | conclusion | 金句 | 1-3 | - | 20-50字 |
| theme09_page031 | 卷首题词 | epigraph | 纯文字 | 1-2 | - | 600-800字 |
| theme09_page032 | 归纳括弧 | bracket | 纯文字 | 2-5 | - | 600-800字 |
| theme09_page042 | 标语字阵 | typeriver | 多卡片3-6 | 3-6 | - | 每卡80-120字 |
| theme09_page052 | 09 观点引述 | quote | 金句 | 1-4 | 0-4 | 20-50字 |
| theme09_page053 | 金句主张 | manifesto | 金句 | - | - | 20-50字 |
| theme09_page100 | 人物证言 | testimonial | 金句 | 0-3 | - | 20-50字 |
| theme09_page102 | 11 核心要点 | takeaway | 多卡片3-6 | 3-6 | - | 每卡80-120字 |
| theme09_page105 | 14 关键问答 | faq | 多卡片3-6 | 3-6 | - | 每卡80-120字 |
| theme09_page111 | 结语 | closing | 左图右文 | - | 0-4 | 200-300字 |
| theme10_page037 | 投资原则 | principles | 多卡片3-6 | 3-6 | - | 每卡80-120字 |
| theme10_page039 | 引言 | quote | 金句 | - | - | 20-50字 |
| theme10_page045 | 引述清单 | testimonials | 纯文字 | 2-4 | - | 600-800字 |
| theme10_page055 | 常见问题 | faq | 多卡片3-6 | 3-6 | - | 每卡80-120字 |
| theme10_page085 | 影像金句 | quoteimg | 金句 | - | - | 20-50字 |
| theme10_page095 | 结束 | closing | 纯文字 | - | - | 600-800字 |
| theme11_page008 | 大势 | page8 | 纯文字 | - | - | 600-800字 |
| theme11_page010 | 主张 | page10 | 金句 | - | - | 20-50字 |
| theme11_page017 | 见证 | page17 | 金句 | - | - | 20-50字 |
| theme11_page028 | 原则 | page28 | 纯文字 | 1-6 | - | 600-800字 |
| theme11_page037 | 宣言 | page37 | 金句 | - | - | 20-50字 |
| theme11_page038 | 观点 | page38 | 金句 | 1-2 | - | 20-50字 |
| theme11_page052 | 证言 | page52 | 金句 | 2-5 | - | 20-50字 |
| theme11_page055 | 主张 | page55 | 金句 | 1-3 | - | 20-50字 |
| theme11_page083 | 金句 | page83 | 金句 | - | - | 20-50字 |
| theme12_page005 | 封面 / Manifesto | manifesto | 金句 | 0-3 | - | 20-50字 |
| theme12_page006 | 金句 / Quote | quote | 金句 | - | - | 20-50字 |
| theme12_page040 | 问答 / FAQ | faq | 多卡片3-6 | 3-6 | - | 每卡80-120字 |
| theme12_page043 | 为什么是现在 / Why Now | whynow | 纯文字 | 2-4 | - | 600-800字 |
| theme12_page077 | 图上金句 / Quote over Image | quoteimage | 金句 | - | - | 20-50字 |
| theme12_page082 | 信条 / Principles | principles | 多卡片3-6 | 3-6 | - | 每卡80-120字 |
| theme12_page084 | 证言 / Voices | voices | 金句 | - | - | 20-50字 |
| theme12_page085 | 群言 / Quote Wall | quotewall | 金句 | 2-4 | - | 20-50字 |
| theme12_page086 | 加入声浪 / Join Us | join | 纯文字 | - | - | 600-800字 |

## 案例/特写（157 个 · 12 套主题覆盖）

| key | label | slot | L3族 | 卡数 | 图数 | 容量 |
| --- | --- | --- | --- | --- | --- | --- |
| theme01_page015 | 算力上游 · 卖铲子 | compute | 左图右文 | 0-3 | 0-3 | 200-300字 |
| theme01_page026 | 典型案例 | case | 左图右文 | 0-4 | 0-3 | 200-300字 |
| theme01_page029 | 核心竞争力 | case-strength | 左图右文 | 1-4 | 0-2 | 200-300字 |
| theme01_page030 | 前沿赛道 · 具身智能 | banner-embodied | 左图右文 | 0-3 | 0-2 | 200-300字 |
| theme01_page035 | 湾区 · 地理护城河 | feature-region | 左图右文 | 0-3 | 0-3 | 200-300字 |
| theme01_page041 | 满版图片 · IPO 退出窗口 | banner-ipo | 左图右文 | 0-3 | 0-2 | 200-300字 |
| theme01_page045 | 典型案例 · xAI | case-xai | 左图右文 | 0-3 | 0-3 | 200-300字 |
| theme01_page046 | 典型案例 · CoreWeave | case-coreweave | 左图右文 | 0-3 | 0-3 | 200-300字 |
| theme01_page057 | 标签化特写 · 前沿掠影 | spotlight-tags | 左图右文 | 0-5 | 0-1 | 200-300字 |
| theme01_page062 | 满版图片 · 算力新基建 | hero-compute | 左图右文 | 0-3 | 0-1 | 200-300字 |
| theme01_page073 | 专题特写 · AI Agent | editorial | 左图右文 | 0-2 | 0-3 | 200-300字 |
| theme02_page013 | 案例图景 · Showcase | showcase | 左图右文 | - | 0-5 | 200-300字 |
| theme02_page024 | 案例聚焦 · Spotlight | spotlight | 左图右文 | 1-4 | 0-1 | 200-300字 |
| theme02_page025 | 沉浸大图 · Feature | feature | 左图右文 | - | 0-3 | 200-300字 |
| theme02_page026 | 主题海报 · Poster | poster | 左图右文 | - | 0-1 | 200-300字 |
| theme02_page052 | 公司档案 · Profile | profile | 左图右文 | 2-5 | 0-2 | 200-300字 |
| theme02_page053 | 进程图带 · Storyboard | storyboard | 左图右文 | 2-4 | 0-4 | 200-300字 |
| theme02_page059 | 杂志大图 · Editorial | editorial | 左图右文 | - | 0-2 | 200-300字 |
| theme03_page018 | 典型案例 | case | 左图右文 | - | 0-3 | 200-300字 |
| theme03_page019 | 案例聚焦 | spotlight | 左图右文 | 0-3 | 0-2 | 200-300字 |
| theme03_page020 | 卖铲赢家 | coreweave | 左图右文 | 0-3 | 0-4 | 200-300字 |
| theme03_page021 | 案例对比 | casecompare | 并列 | 2-3 | - | 200-300字 |
| theme03_page067 | 具身智能 | embodied | 左图右文 | 0-3 | 0-2 | 200-300字 |
| theme03_page074 | 算力卡脖 | supply | 多卡片2-4 | 2-4 | - | 每卡80-120字 |
| theme03_page075 | AI 芯片 | chips | 左图右文 | 0-3 | 0-2 | 200-300字 |
| theme03_page076 | 算力军备 | compute | 左图右文 | 0-3 | 0-2 | 200-300字 |
| theme04_page046 | 三强争霸 | trio | 纯文字 | 2-3 | - | 600-800字 |
| theme04_page047 | 杂志式跨页 | editorial | 纯文字 | 0-1 | - | 600-800字 |
| theme04_page050 | 典型案例 | case | 纯文字 | 0-2 | - | 600-800字 |
| theme04_page051 | 人物档案卡 | profile | 多卡片0-1 | 0-1 | - | 每卡80-120字 |
| theme04_page055 | 大图封面 | hero | 网格画廊 | 0-1 | - | 图说各20-40字 |
| theme04_page058 | 焦点特写 | spotlight | 纯文字 | 0-1 | - | 600-800字 |
| theme04_page059 | 焦点机位 | showcase | 纯文字 | 0-3 | - | 600-800字 |
| theme05_page012 | 案例 Cases | cases | 左图右文 | 2-4 | 0-3 | 200-300字 |
| theme05_page032 | 赛道剖析 Segment | segment | 左图右文 | 2-4 | 0-3 | 200-300字 |
| theme05_page033 | 赛道聚焦 Spotlight | spotlight | 左图右文 | 2-4 | 0-2 | 200-300字 |
| theme05_page043 | 图像主视觉 Showcase | showcase | 左图右文 | 2-4 | 0-2 | 200-300字 |
| theme05_page050 | 大数字 Hero | hero | 大数字 | 0-3 | 0-2 | 30-100字+巨数字 |
| theme05_page057 | 资源类型 Resource | resource | 左图右文 | 2-4 | 0-3 | 200-300字 |
| theme05_page063 | 图像主视觉 Profile | profile | 左图右文 | 2-4 | 0-3 | 200-300字 |
| theme05_page066 | 标杆案例 Benchmark | benchmark | 左图右文 | - | 0-2 | 200-300字 |
| theme05_page067 | 档案卡 Dossier | dossier | 多卡片0-4 | 0-4 | 0-2 | 每卡80-120字 |
| theme05_page068 | 生态连接 Nexus | nexus | 左图右文 | 2-4 | 0-2 | 200-300字 |
| theme05_page069 | 算力集群 Foundry | foundry | 左图右文 | - | 0-3 | 200-300字 |
| theme06_page023 | 19 · 工作流自动化 / AI AGENTS | agent | 纯文字 | 0-2 | - | 600-800字 |
| theme06_page024 | 20 · 知识入口 / ENTERPRISE SEARCH | search | 纯文字 | 0-2 | - | 600-800字 |
| theme06_page025 | 21 · 专业服务 / LEGAL AI | legal | 纯文字 | 0-2 | - | 600-800字 |
| theme06_page028 | 24 · 典型案例 / CASE STUDIES | cases | 纯文字 | 1-3 | - | 600-800字 |
| theme06_page033 | 29 · 慢变量高壁垒 / HEALTHCARE AI | health | 纯文字 | 2-3 | - | 600-800字 |
| theme06_page034 | 30 · 投研风控合规 / FINANCE AI | finance | 纯文字 | 2-4 | - | 600-800字 |
| theme06_page035 | 31 · 研发效率提升 / DEV TOOLS | dev | 纯文字 | - | - | 600-800字 |
| theme06_page036 | 32 · 企业 AI 底座 / DATA INFRA | datainfra | 多卡片3-4 | 3-4 | - | 每卡80-120字 |
| theme06_page038 | 34 · 企业流程嵌入 / LOW CODE | lowcode | 流程 | 0-2 | - | 每步40-80字 |
| theme06_page039 | 35 · 社区影响力变现 / OPEN SOURCE | opensource | 纯文字 | 0-2 | - | 600-800字 |
| theme06_page040 | 36 · 安全与对齐工具 / ALIGNMENT | safety | 多卡片3-4 | 3-4 | - | 每卡80-120字 |
| theme06_page045 | 41 · 钱以外的资源 / STRATEGIC RESOURCES | resource | 纯文字 | 2-4 | - | 600-800字 |
| theme06_page047 | 43 · GPU 资源链条 / NVIDIA ECOSYSTEM | gpu | 纯文字 | 2-4 | - | 600-800字 |
| theme06_page054 | 50 · 商业化标杆 / OPENAI | openai | 纯文字 | 0-2 | - | 600-800字 |
| theme06_page055 | 51 · 安全可靠模型 / ANTHROPIC | anthropic | 纯文字 | 0-2 | - | 600-800字 |
| theme06_page056 | 52 · 实时数据生态 / XAI | xai | 纯文字 | 0-2 | - | 600-800字 |
| theme06_page057 | 53 · 算力基础设施 / COREWEAVE | coreweave | 纯文字 | 0-2 | - | 600-800字 |
| theme06_page058 | 54 · 数据基础设施 / SCALE AI · TABLE | scaleai | 排行表格 | 3-4 | - | 每行20-50字 |
| theme06_page059 | 55 · AI 搜索入口 / PERPLEXITY | perplexity | 纯文字 | 0-2 | - | 600-800字 |
| theme06_page060 | 56 · 数据平台延展 / DATABRICKS | databricks | 纯文字 | 0-2 | - | 600-800字 |
| theme06_page061 | 57 · 企业知识入口 / GLEAN | glean | 纯文字 | 0-2 | - | 600-800字 |
| theme06_page062 | 58 · 人形机器人 / FIGURE AI | figure | 纯文字 | 0-3 | - | 600-800字 |
| theme06_page063 | 59 · 强叙事模型实验室 / SSI | ssi | 纯文字 | 0-2 | - | 600-800字 |
| theme06_page067 | 63 · 毛利天花板 / COMPUTE COST | compute | 纯文字 | 0-3 | - | 600-800字 |
| theme06_page069 | 65 · 确定性预算 / INFRA STRATEGY | infra | 纯文字 | 2-4 | - | 600-800字 |
| theme06_page072 | 68 · 估值锚重定价 / IPO WATCH | ipowatch | 多卡片3-4 | 3-4 | - | 每卡80-120字 |
| theme07_page009 | 案例 Cases | case-page | 左图右文 | 1-3 | undefined-undefined | 200-300字 |
| theme07_page029 | 阵容 Syndicate | syndicate-page | 多卡片3-6 | 3-6 | - | 每卡80-120字 |
| theme07_page030 | 赛道 企业搜索 | knowledge-page | 左图右文 | 2-4 | 0-2 | 200-300字 |
| theme07_page031 | 赛道 法律 AI | legal-page | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme07_page032 | 赛道 医疗 AI | healthcare-page | 左图右文 | 2-3 | 0-2 | 200-300字 |
| theme07_page033 | 赛道 金融 AI | finance-page | 左图右文 | 2-4 | 0-2 | 200-300字 |
| theme07_page034 | 赛道 算力云 | compute-page | 纯文字 | 2-4 | - | 600-800字 |
| theme07_page035 | 赛道 AI 芯片 | chip-page | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme07_page036 | 赛道 具身智能 | robotics-page | 左图右文 | 2-3 | 0-2 | 200-300字 |
| theme07_page037 | 赛道 自动驾驶 | autonomy-page | 左图右文 | 2-3 | 0-2 | 200-300字 |
| theme07_page038 | 赛道 AI 安全 | safety-page | 纯文字 | 2-4 | - | 600-800字 |
| theme07_page039 | 赛道 内容生成 | content-gen-page | 左图右文 | 2-4 | 0-2 | 200-300字 |
| theme07_page040 | 赛道 教育 AI | education-page | 左图右文 | 2-3 | 0-2 | 200-300字 |
| theme07_page041 | 赛道 客服 AI | support-page | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme07_page042 | 赛道 销售营销 | sales-page | 左图右文 | 2-3 | 0-2 | 200-300字 |
| theme07_page043 | 赛道 低代码 | low-code-page | 多卡片3-5 | 3-5 | 0-2 | 每卡80-120字 |
| theme07_page044 | 赛道 开源模型 | open-source-page | 左图右文 | - | 0-2 | 200-300字 |
| theme07_page045 | 赛道 模型对齐 | alignment-page | 左图右文 | 2-3 | 0-2 | 200-300字 |
| theme07_page050 | 角色 战略投资者 | resource-page | 左图右文 | 2-4 | 0-2 | 200-300字 |
| theme07_page055 | 三角 人才资本算力 | resource-triad-page | 并列 | 2-3 | - | 200-300字 |
| theme07_page056 | 案例 OpenAI | open-aicase-page | 左图右文 | 2-4 | 0-2 | 200-300字 |
| theme07_page057 | 案例 Figure | figure-case-page | 纯文字 | 0-3 | - | 600-800字 |
| theme07_page058 | 案例 SSI | ssicase-page | 左图右文 | 2-4 | 0-2 | 200-300字 |
| theme08_page011 | ⑧ 案例 · Cases | p8 | 纯文字 | 0-4 | - | 600-800字 |
| theme08_page019 | ⑰ 季度聚焦 · Spotlight | p17 | 纯文字 | 2-4 | - | 600-800字 |
| theme08_page030 | ㉘ 赛道卡 · Segment | p28 | 多卡片0-3 | 0-3 | - | 每卡80-120字 |
| theme08_page031 | ㉙ 知识入口 · Portal | p29 | 纯文字 | 0-4 | - | 600-800字 |
| theme08_page036 | ㉞ 数据底座 · Pipeline | p34 | 流程 | 3-5 | - | 每步40-80字 |
| theme08_page038 | ㊱ 供应链 · Supply | p36 | 纯文字 | 0-3 | - | 600-800字 |
| theme08_page039 | ㊲ 算力网格 · Compute | p37 | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme08_page040 | ㊳ 芯片层级 · Chip Tiers | p38 | 纯文字 | 2-4 | - | 600-800字 |
| theme08_page041 | ㊴ 具身智能 · Embodied | p39 | 纯文字 | 0-3 | - | 600-800字 |
| theme08_page042 | ㊶ 安全防线 · Safety | p41 | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme08_page043 | ㊷ 内容生成 · Generative | p42 | 时间轴 | 0-4 | - | 每节点30-60字 |
| theme08_page045 | ㊹ 降本场景 · Support | p44 | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme08_page047 | ㊼ 社区变现 · Open Source | p47 | 纯文字 | 0-4 | - | 600-800字 |
| theme08_page048 | ㊽ 安全对齐 · Alignment | p48 | 纯文字 | 0-3 | - | 600-800字 |
| theme08_page050 | ㊿ 早期轮 · Early Stage | p50 | 纯文字 | 2-4 | - | 600-800字 |
| theme08_page052 | (53) 资源绑定 · Resource Map | p53 | 纯文字 | 0-3 | - | 600-800字 |
| theme08_page054 | (55) GPU 生态 · Ecosystem | p55 | 纯文字 | 2-4 | - | 600-800字 |
| theme08_page061 | (64) 案例卡 · xAI | p64 | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme08_page062 | (65) 案例卡 · CoreWeave | p65 | 多卡片0-4 | 0-4 | - | 每卡80-120字 |
| theme08_page063 | (66) 案例表 · Scale AI | p66 | 纯文字 | 2-4 | - | 600-800字 |
| theme08_page064 | (67) 案例卡 · Perplexity | p67 | 多卡片0-3 | 0-3 | - | 每卡80-120字 |
| theme08_page065 | (68) 案例卡 · Databricks | p68 | 多卡片2-5 | 2-5 | - | 每卡80-120字 |
| theme08_page066 | (69) 案例卡 · Glean | p69 | 多卡片0-3 | 0-3 | - | 每卡80-120字 |
| theme08_page067 | (71) 案例卡 · SSI | p71 | 多卡片0-2 | 0-2 | - | 每卡80-120字 |
| theme08_page068 | (73) 收入兑现 · Revenue | p73 | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme08_page076 | (82) 迁移图 · Migration | p82 | 流程 | 3-6 | - | 每步40-80字 |
| theme08_page077 | (83) 样板 · Playbooks | p83 | 纯文字 | 1-4 | - | 600-800字 |
| theme08_page079 | (85) 跨页 · Hero Split | p85 | 并列 | 0-3 | - | 200-300字 |
| theme09_page015 | 焦点舞台 | stage | 左图右文 | 0-4 | 1-3 | 200-300字 |
| theme09_page022 | 05 典型案例 | cases | 左图右文 | 1-3 | 0-4 | 200-300字 |
| theme09_page024 | 分镜脚本 | storyboard | 左图右文 | - | 3-6 | 200-300字 |
| theme09_page025 | 图说特写 | feature | 左图右文 | 0-4 | 1-4 | 200-300字 |
| theme09_page038 | 核心数字 | hero | 纯文字 | 0-3 | - | 600-800字 |
| theme09_page074 | 陈列墙 | exhibit | 左图右文 | - | 2-4 | 200-300字 |
| theme09_page088 | 跨栏图景 | halfhero | 网格画廊 | 2-4 | - | 图说各20-40字 |
| theme09_page097 | 全幅图景 | immersive | 左图右文 | 0-4 | 1-4 | 200-300字 |
| theme09_page106 | 15 专题洞察 | spotlight | 左图右文 | 0-3 | 0-4 | 200-300字 |
| theme09_page108 | 圆窗影像 | ring | 左图右文 | - | 1-5 | 200-300字 |
| theme09_page109 | 关于我们 | pf-profile | 左图右文 | 1-3 | 0-2 | 200-300字 |
| theme09_page110 | 企业掘影 | pf-gallery | 左图右文 | 0-6 | 0-6 | 200-300字 |
| theme10_page023 | 人物特写 | profile | 纯文字 | - | - | 600-800字 |
| theme10_page040 | 编排图文 | editorial | 左图右文 | - | 0-4 | 200-300字 |
| theme10_page041 | 杂志图文 | magazine | 网格画廊 | 0-3 | - | 图说各20-40字 |
| theme10_page046 | 图文特写 | feature | 网格画廊 | - | - | 图说各20-40字 |
| theme10_page078 | 沉浸大图 | showcase | 网格画廊 | - | - | 图说各20-40字 |
| theme10_page079 | 主视觉海报 | poster | 纯文字 | - | - | 600-800字 |
| theme10_page092 | 标的档案 | exhibit | 多卡片3-7 | 3-7 | - | 每卡80-120字 |
| theme11_page012 | 实证 | page12 | 纯文字 | 1-3 | - | 600-800字 |
| theme11_page013 | 渠道 | page13 | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme11_page014 | 成果 | page14 | 纯文字 | 1-3 | - | 600-800字 |
| theme11_page016 | 案例 | page16 | 纯文字 | 1-3 | - | 600-800字 |
| theme11_page019 | 格局 | page19 | 纯文字 | - | - | 600-800字 |
| theme11_page020 | 服务 | page20 | 纯文字 | 1-5 | - | 600-800字 |
| theme11_page029 | 作品 | page29 | 左图右文 | - | 0-4 | 200-300字 |
| theme11_page033 | 团队 | page33 | 纯文字 | 2-4 | - | 600-800字 |
| theme11_page058 | 案例集 | page58 | 纯文字 | 2-3 | - | 600-800字 |
| theme11_page076 | 案例辑 | page76 | 纯文字 | 2-4 | - | 600-800字 |
| theme11_page086 | 破冰航道 | page86 | 纯文字 | 2-3 | - | 600-800字 |
| theme12_page017 | 杂志特写 / Magazine | magazine | 纯文字 | - | - | 600-800字 |
| theme12_page018 | 图文交错 / Editorial | editorial | 网格画廊 | 2-3 | - | 图说各20-40字 |
| theme12_page019 | 图片页 / In Context | showcase | 网格画廊 | 0-5 | - | 图说各20-40字 |
| theme12_page020 | 整版大图 / On Stage | hero | 网格画廊 | 0-3 | - | 图说各20-40字 |
| theme12_page023 | 灯箱海报 / Lightbox | billboard | 纯文字 | - | - | 600-800字 |
| theme12_page075 | 功能聚焦 / Feature | spotlight | 纯文字 | 2-4 | - | 600-800字 |

## 图片/画廊（47 个 · 10 套主题覆盖）

| key | label | slot | L3族 | 卡数 | 图数 | 容量 |
| --- | --- | --- | --- | --- | --- | --- |
| theme01_page020 | 头部玩家掠影 | gallery | 左图右文 | - | 1-5 | 200-300字 |
| theme01_page037 | 大数字 · 估值泡沫 | sticker-bubble | 图表主视觉 | 0-4 | - | 80-120字+洞察 |
| theme01_page052 | 贴纸拼贴 · 前沿掠影 | collage-frontier | 左图右文 | 0-4 | 0-5 | 200-300字 |
| theme01_page069 | 年度热词 · 标签墙 | sticker-wall | 多卡片6-12 | 6-12 | - | 每卡80-120字 |
| theme01_page076 | 影像长卷 · 关键时刻 | filmstrip | 左图右文 | - | 2-5 | 200-300字 |
| theme02_page029 | 案例图集 · Gallery | gallery | 左图右文 | - | 0-4 | 200-300字 |
| theme02_page033 | 笔数分布 · Pictogram | pictogram | 纯文字 | 2-6 | - | 600-800字 |
| theme02_page070 | 瀑布流图墙 · Masonry | masonry | 网格画廊 | 0-6 | - | 图说各20-40字 |
| theme03_page063 | 实验室影像 | gallery | 左图右文 | 2-5 | 0-5 | 200-300字 |
| theme04_page041 | 地区画廊 | gallery | 网格画廊 | 1-4 | - | 图说各20-40字 |
| theme04_page042 | 胶片印样 | filmstrip | 网格画廊 | 0-4 | - | 图说各20-40字 |
| theme04_page057 | 图片故事 | imagestory | 网格画廊 | 0-3 | - | 图说各20-40字 |
| theme05_page089 | 全幅影像 Plate | plate | 左图右文 | 1-4 | 0-3 | 200-300字 |
| theme08_page082 | (88) 照片墙 · Photo Wall | p88 | 网格画廊 | 0-4 | - | 图说各20-40字 |
| theme09_page014 | 全景横幅 | panorama | 左图右文 | 0-6 | 1-3 | 200-300字 |
| theme09_page075 | 影像长卷 | filmstrip | 左图右文 | 0-5 | 0-6 | 200-300字 |
| theme09_page080 | 瀑布影像 | masonry | 左图右文 | - | 3-8 | 200-300字 |
| theme09_page096 | 杂志跨页 | zine | 左图右文 | - | 1-3 | 200-300字 |
| theme09_page107 | 16 研究团队 | team | 左图右文 | 2-6 | 0-6 | 200-300字 |
| theme10_page024 | 内容墙 | team | 网格画廊 | 2-6 | - | 图说各20-40字 |
| theme10_page043 | 横向影像带 | strata | 网格画廊 | 2-4 | - | 图说各20-40字 |
| theme10_page044 | 持仓小图集 | spark | 多卡片3-8 | 3-8 | - | 每卡80-120字 |
| theme10_page048 | 影像贴墙 | pinboard | 网格画廊 | 2-5 | - | 图说各20-40字 |
| theme10_page049 | 影像长卷 | filmstrip | 左图右文 | - | 0-5 | 200-300字 |
| theme10_page050 | 满版角嵌 | inset | 纯文字 | - | - | 600-800字 |
| theme10_page054 | 影像集 | gallery2 | 左图右文 | - | 0-6 | 200-300字 |
| theme10_page076 | 拼贴影像 | collage | 左图右文 | - | 3-6 | 200-300字 |
| theme10_page077 | 图注精读 | captioned | 网格画廊 | 2-5 | - | 图说各20-40字 |
| theme11_page009 | 图景 | page9 | 左图右文 | - | 1-2 | 200-300字 |
| theme11_page022 | 图辑 | page22 | 左图右文 | 1-3 | 0-2 | 200-300字 |
| theme11_page041 | 影像 | page41 | 网格画廊 | 2-5 | - | 图说各20-40字 |
| theme11_page063 | 现场 | page63 | 左图右文 | - | 0-4 | 200-300字 |
| theme11_page073 | 全景 | page73 | 网格画廊 | - | - | 图说各20-40字 |
| theme11_page078 | 主屏 | page78 | 纯文字 | - | - | 600-800字 |
| theme12_page022 | 满版出血 / Full Bleed | fullbleed | 纯文字 | - | - | 600-800字 |
| theme12_page024 | 全景宽幅 / Panorama | panorama | 网格画廊 | 1-2 | - | 图说各20-40字 |
| theme12_page026 | 明信片 / Postcard | postcard | 纯文字 | - | - | 600-800字 |
| theme12_page028 | 胶片样张 / Contact Sheet | filmstrip | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme12_page029 | 邮票张 / Stamps | stampsheet | 多卡片4-8 | 4-8 | - | 每卡80-120字 |
| theme12_page066 | 拼贴海报 / Zine | zine | 网格画廊 | - | - | 图说各20-40字 |
| theme12_page067 | 灵感板 / Moodboard | moodboard | 多卡片3-6 | 3-6 | - | 每卡80-120字 |
| theme12_page068 | 专辑曲目 / Tracklist | album | 多卡片5-10 | 5-10 | - | 每卡80-120字 |
| theme12_page069 | 黑胶 / Now Playing | vinyl | 纯文字 | 1-6 | - | 600-800字 |
| theme12_page070 | 图墙 / Grid Wall | gridwall | 多卡片4-8 | 4-8 | - | 每卡80-120字 |
| theme12_page071 | 画框墙 / Gallery Wall | gallerywall | 多卡片3-6 | 3-6 | - | 每卡80-120字 |
| theme12_page078 | 歌词金句 / Lyric | lyric | 金句 | - | - | 20-50字 |
| theme12_page083 | 团队群像 / Team | team | 多卡片3-6 | 3-6 | - | 每卡80-120字 |

## 雷达/风险/能力（22 个 · 11 套主题覆盖）

| key | label | slot | L3族 | 卡数 | 图数 | 容量 |
| --- | --- | --- | --- | --- | --- | --- |
| theme01_page038 | 风险研判 | risk | 纯文字 | 1-4 | - | 600-800字 |
| theme02_page046 | 风险研判 · Risk | risk | 纯文字 | 2-3 | - | 600-800字 |
| theme03_page033 | 风险研判 | risk | 纯文字 | 1-4 | - | 600-800字 |
| theme03_page034 | 风险传导 | riskchain | 流程 | 1-3 | - | 每步40-80字 |
| theme03_page073 | 护城河 | moat | 纯文字 | 2-3 | - | 600-800字 |
| theme04_page064 | 风险传导 | riskchain | 流程 | 1-3 | - | 每步40-80字 |
| theme05_page016 | 风险 Risk | risk | 多卡片3-5 | 3-5 | 0-2 | 每卡80-120字 |
| theme05_page080 | 壁垒压缩 Squeeze | squeeze | 纯文字 | 2-3 | - | 600-800字 |
| theme06_page030 | 26 · 风险研判 / RISK | risk | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme06_page065 | 61 · 从试点到稳定收入 / REVENUE RISK | revrisk | 纯文字 | 2-4 | - | 600-800字 |
| theme06_page066 | 62 · 隐私版权与安全 / REGULATION · TABLE | regrisk | 排行表格 | 3-5 | - | 每行20-50字 |
| theme06_page068 | 64 · 壁垒被压缩 / OPEN SOURCE RISK | openrisk | 纯文字 | 2-4 | - | 600-800字 |
| theme07_page013 | 风险 Risk | risk-page | 左图右文 | 2-5 | 0-1 | 200-300字 |
| theme07_page059 | 章节 风险策略 | risk-chapter-page | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme07_page060 | 风险 收入验证 | revenue-page | 纯文字 | 2-3 | - | 600-800字 |
| theme07_page061 | 风险 监管合规 | compliance-page | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme07_page062 | 风险 算力成本 | margin-page | 纯文字 | 0-3 | - | 600-800字 |
| theme07_page063 | 风险 壁垒压缩 | moat-page | 纯文字 | 2-3 | - | 600-800字 |
| theme08_page070 | (76) 壁垒压缩 · Squeeze | p76 | 纯文字 | 2-4 | - | 600-800字 |
| theme09_page027 | 06 风险研判 | risk | 纯文字 | 1-4 | - | 600-800字 |
| theme10_page019 | 能力对照 | capmatrix | 并列 | 3-7 | - | 200-300字 |
| theme11_page031 | 能力 | page31 | 多卡片5-7 | 5-7 | - | 每卡80-120字 |

## 地区/区域（24 个 · 10 套主题覆盖）

| key | label | slot | L3族 | 卡数 | 图数 | 容量 |
| --- | --- | --- | --- | --- | --- | --- |
| theme01_page016 | 赛道分布 · 融资额占比 | sector | 图表主视觉 | 3-5 | - | 80-120字+洞察 |
| theme01_page034 | 地区分布 | region | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme01_page048 | 全球版图 · 资金分布 | global-split | 并列 | 2-4 | - | 200-300字 |
| theme02_page035 | 地区分布 · Region | region | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme03_page010 | 横向透视 | sector | 纯文字 | - | - | 600-800字 |
| theme03_page029 | 地区分布 | geo | 多卡片3-5 | 3-5 | 0-2 | 每卡80-120字 |
| theme04_page040 | 地区分布 | region | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme05_page061 | 地理身份 Region | region | 左图右文 | 2-4 | 0-3 | 200-300字 |
| theme05_page062 | 区域定位 Locale | locale | 左图右文 | 2-4 | 0-3 | 200-300字 |
| theme06_page046 | 42 · 投资与算力消费闭环 / CLOUD ALLIANCES | alliance | 流程 | 2-4 | - | 每步40-80字 |
| theme06_page048 | 44 · 最大地理中心 / BAY AREA | bay | 图表主视觉 | 0-3 | - | 80-120字+洞察 |
| theme06_page049 | 45 · 行业客户优势 / NEW YORK | nyc | 纯文字 | 0-2 | - | 600-800字 |
| theme06_page050 | 46 · 云计算人才外溢 / SEATTLE | seattle | 纯文字 | 0-2 | - | 600-800字 |
| theme06_page051 | 47 · 科研与硬科技 / BOSTON | boston | 纯文字 | 0-2 | - | 600-800字 |
| theme06_page052 | 48 · 分散型应用落地 / OTHER REGIONS | other | 纯文字 | 0-2 | - | 600-800字 |
| theme07_page051 | 联盟 云厂商 | alliance-page | 纯文字 | 2-4 | - | 600-800字 |
| theme07_page053 | 地理 湾区中心 | geo-center-page | 纯文字 | 0-3 | - | 600-800字 |
| theme07_page054 | 集群 区域对比 | region-cluster-page | 并列 | 2-5 | 0-2 | 200-300字 |
| theme08_page056 | (57) 地理卡 · New York | p57 | 多卡片0-4 | 0-4 | - | 每卡80-120字 |
| theme08_page057 | (58) 地理卡 · Seattle | p58 | 多卡片0-3 | 0-3 | - | 每卡80-120字 |
| theme08_page058 | (59) 地理卡 · Boston | p59 | 多卡片0-3 | 0-3 | - | 每卡80-120字 |
| theme09_page012 | 02 市场全景 | market | 网格画廊 | - | - | 图说各20-40字 |
| theme09_page066 | 区域画像 | parallel | 多卡片3-7 | 3-7 | - | 每卡80-120字 |
| theme10_page064 | 区域敞口 | cartogram | 多卡片4-10 | 4-10 | - | 每卡80-120字 |

## 附录/收尾（8 个 · 5 套主题覆盖）

| key | label | slot | L3族 | 卡数 | 图数 | 容量 |
| --- | --- | --- | --- | --- | --- | --- |
| theme01_page084 | 附录 · 数据来源 | appendix | 定位 | - | - | - |
| theme03_page077 | 封底 | colophon | 定位 | - | - | - |
| theme05_page093 | 数据来源 Appendix | colophon | 定位 | - | - | - |
| theme05_page094 | 封底 Back Cover | endcap | 定位 | - | - | - |
| theme07_page068 | 章节 附录 | appendix-chapter-page | 定位 | - | - | - |
| theme07_page071 | 关于 About the Lab | about-lab-page | 定位 | - | - | - |
| theme11_page067 | 术语 | page67 | 定位 | - | - | - |
| theme11_page087 | 谢幕 | page87 | 定位 | - | - | - |

## 其他（20 个 · 1 套主题覆盖）

| key | label | slot | L3族 | 卡数 | 图数 | 容量 |
| --- | --- | --- | --- | --- | --- | --- |
| theme11_page018 | 价值 | page18 | 纯文字 | 2-3 | - | 600-800字 |
| theme11_page027 | 套餐 | page27 | 纯文字 | 1-3 | - | 600-800字 |
| theme11_page030 | 行动 | page30 | 纯文字 | 1-3 | - | 600-800字 |
| theme11_page035 | 账目 | page35 | 纯文字 | 1-6 | - | 600-800字 |
| theme11_page036 | 拆解 | page36 | 纯文字 | - | - | 600-800字 |
| theme11_page039 | 叠加 | page39 | 多卡片3-6 | 3-6 | - | 每卡80-120字 |
| theme11_page040 | 拆解 | page40 | 纯文字 | 2-4 | - | 600-800字 |
| theme11_page042 | 信任 | page42 | 多卡片4-12 | 4-12 | - | 每卡80-120字 |
| theme11_page043 | 异议 | page43 | 纯文字 | 1-5 | - | 600-800字 |
| theme11_page047 | 留存 | page47 | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme11_page048 | 优先级 | page48 | 多卡片3-6 | 3-6 | - | 每卡80-120字 |
| theme11_page050 | 覆盖 | page50 | 纯文字 | 2-5 | - | 600-800字 |
| theme11_page060 | 痛点 | page60 | 纯文字 | 2-4 | - | 600-800字 |
| theme11_page061 | 蜕变 | page61 | 纯文字 | 1-3 | - | 600-800字 |
| theme11_page062 | 层级 | page62 | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme11_page066 | 跃迁 | page66 | 纯文字 | - | - | 600-800字 |
| theme11_page068 | 序列 | page68 | 多卡片3-5 | 3-5 | - | 每卡80-120字 |
| theme11_page077 | 下一步 | page77 | 纯文字 | 2-4 | - | 600-800字 |
| theme11_page081 | 标注 | page81 | 纯文字 | - | - | 600-800字 |
| theme11_page084 | 陈列 | page84 | 纯文字 | - | - | 600-800字 |

## 其他说明

- 布局按主题成套：同一 slot 在不同主题下有对应页（如 theme01_page006 ↔ theme02_page006），选模板时优先查所选主题。
- label 为中文语义名，slot 为机器分类，L3 族为版式分类，卡数/图数来自 manifest countBindings（- 表示无约束），容量为族基准（常用族人工校准中）。
- 「其他」类 = 未能归类的模板，需人工评估（AI 尽量不选）。
- 重新生成：`node scripts/build-layout-catalog.cjs`
