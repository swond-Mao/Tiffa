# 页级模板目录（layout-catalog.md）

> 由 `scripts/build-layout-catalog.cjs` 从 dashiai layout-manifest.json 生成（共 1020 个布局）。
> **用途**：AI 在设计阶段按「内容类型 → 布局需求」查本节选页级模板。
> **选法**：页面定义写 `layout: 'themeXX_pageNNN'` + 对应数据字段。
> **红线**：没有合适模板就手搓 DSL，禁止为套模板删改内容。

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

## 封面（52 个 · 10 套主题覆盖）

| key | label | slot |
| --- | --- | --- |
| theme01_page001 | 封面 · 编辑式双栏 | cover-editorial |
| theme01_page002 | 封面 · 居中极简 | cover-minimal |
| theme01_page003 | 封面 · 模块化便当格 | cover-bento |
| theme01_page004 | 封面 · 磨砂玻璃刊头 | cover-masthead |
| theme01_page005 | 封面 | cover |
| theme02_page001 | 封面 · Cover | cover |
| theme02_page002 | 封面 A · 居中聚光 | coverbeam |
| theme02_page003 | 封面 B · 大数主视觉 | coverfigure |
| theme02_page004 | 封面 C · 满幅图海报 | coverposter |
| theme02_page005 | 封面 D · 模块网格 | coverpanel |
| theme03_page001 | 封面 | cover |
| theme03_page002 | 封面·横向 | coverband |
| theme03_page003 | 封面·海报 | coverposter |
| theme03_page004 | 封面·网格 | covergrid |
| theme03_page005 | 封面·影像 | coverimage |
| theme04_page001 | 居中主题封面 | coverHero |
| theme04_page002 | 索引导读封面 | coverIndex |
| theme04_page003 | 幽灵数字封面 | coverGhost |
| theme04_page004 | 糖果速览封面 | coverBento |
| theme04_page044 | 杂志封面 | cover |
| theme04_page045 | 图背章节页 | coversection |
| theme05_page005 | 封面 Cover | cover |
| theme06_page001 | 封面A · 智联万物 / PRODUCT LAUNCH | coverA |
| theme06_page002 | 封面B · 新机遇 / BUSINESS PLAN | coverB |
| theme06_page003 | 封面C · 精益智造 / LEAN MFG | coverC |
| theme06_page004 | 封面D · 品牌整合营销 / BRAND MKT | coverD |
| theme06_page005 | 01 · 封面 / COVER | cover |
| theme07_page001 | 封面 精益智造 | cover-lean-page |
| theme07_page002 | 封面 链通全国 | cover-supply-chain-page |
| theme07_page003 | 封面 把握趋势 | cover-retail-trend-page |
| theme07_page004 | 封面 供应链战略 | cover-supply-strategy-page |
| theme07_page005 | 封面 Cover | cover-page |
| theme09_page001 | 封面A 刊头 | covermast |
| theme09_page002 | 封面C 斜切 | coverdiag |
| theme09_page003 | 封面D 卷宗 | coverdossier |
| theme09_page004 | 封面E 光带 | coverstrata |
| theme09_page005 | 封面F 光圈 | coveraperture |
| theme09_page006 | 封面G 终端 | coverterminal |
| theme09_page007 | Cover | cover |
| theme09_page033 | 封面影像 | coverstory |
| theme10_page001 | 暮光对角 | coverdusk |
| theme10_page002 | 渐变色场分栏 | coverfield |
| theme10_page003 | 满版渐变大字 | coveratmostype |
| theme10_page004 | 地平线渐变 | coverhorizon |
| theme10_page005 | 封面 | cover |
| theme10_page051 | 晨光卡 | coverdawn |
| theme12_page001 | 封面 · 字体 / Masthead | coverType |
| theme12_page002 | 封面 · 声波 / Spectrum | coverWave |
| theme12_page003 | 封面 · 大图 / Cover Story | coverImage |
| theme12_page004 | 封面 · 目录 / Contents | coverGrid |
| theme12_page021 | 杂志封面 / Cover | cover |
| theme12_page030 | 封面流 / Coverflow | coverflow |

## 目录/议程（9 个 · 8 套主题覆盖）

| key | label | slot |
| --- | --- | --- |
| theme01_page009 | 报告导览 · 目录 | contents |
| theme02_page007 | 报告目录 · Agenda | agenda |
| theme03_page006 | 导览 | agenda |
| theme04_page005 | 研究框架 | agenda |
| theme04_page006 | 图文目录 | contents |
| theme06_page007 | 03 · 报告结构 / STRUCTURE | contents |
| theme07_page007 | 目录 Contents | contents-page |
| theme09_page010 | 目录 | contents |
| theme12_page007 | 目录 / Agenda | agenda |

## 章节过渡（23 个 · 10 套主题覆盖）

| key | label | slot |
| --- | --- | --- |
| theme01_page011 | 章节 · 市场全景 | chapter-market |
| theme01_page013 | 章节 · 横向透视 | chapter |
| theme01_page024 | 章节 · 典型案例 | chapter-case |
| theme01_page036 | 章节 · 风险与展望 | chapter-risk |
| theme02_page014 | 章节页 · Section | section |
| theme03_page022 | 章节页 | section |
| theme04_page008 | 章节页 | section |
| theme04_page035 | 章节大字 | chapter |
| theme05_page019 | 章节 Chapter | chapter |
| theme05_page030 | 章节 Chapter 03 | chapter3 |
| theme05_page053 | 章节 Chapter 04 | chapter4 |
| theme05_page076 | 章节 Chapter 05 | chapter5 |
| theme06_page010 | 06 · 市场数据深拆 / CHAPTER | chapter |
| theme07_page016 | 章节 市场数据 | chapter-page |
| theme09_page011 | 01 研究方法 | section |
| theme09_page030 | 附录 · 透视 | divider |
| theme09_page101 | 篇章卡 | chapter |
| theme10_page006 | 章节索引 | chapter |
| theme10_page038 | 序号分章 | divider |
| theme10_page052 | 宣言章节 | sectionstatement |
| theme12_page042 | 间章 / Interlude | interlude |
| theme12_page079 | 章节页 / Section | section |
| theme12_page080 | 大间章 / Divider | divider |

## 大数字/KPI（33 个 · 9 套主题覆盖）

| key | label | slot |
| --- | --- | --- |
| theme01_page006 | 大数字 · 资本体量 | bignum |
| theme01_page007 | 关键数字一览 | statgrid |
| theme01_page008 | 便当速览 · 一图读懂 | bento |
| theme01_page042 | 三个数字 · 资本格局 | evil-trio |
| theme01_page050 | 标的评分卡 · 尽调五维 | scorecard |
| theme01_page064 | 关键占比 · 柱状图 | kpi-dial |
| theme02_page020 | 关键数字 · Metrics | metrics |
| theme02_page021 | 巨型数字 · Big Number | bignumber |
| theme02_page023 | 数据看板 · Bento | bento |
| theme03_page028 | 核心数据 | stat |
| theme03_page065 | 投资记分卡 | scorecard |
| theme03_page071 | 资本主张 | statement |
| theme04_page009 | 行业赛道 | cards |
| theme04_page016 | 一图速览 | bento |
| theme04_page029 | 大数字 | bignumber |
| theme04_page030 | 三联大数字 | stattrio |
| theme04_page032 | 资本计分卡 | scorecards |
| theme04_page074 | 核心结论 | statement |
| theme05_page028 | 大数字 Big Number | bignumber |
| theme05_page037 | 金句 Statement | statement |
| theme05_page086 | 综合评分 Scorecard | scorecard |
| theme06_page082 | 78 · 前瞻主题 / FORWARD STATEMENT | statement |
| theme09_page039 | 影像便当 | bento |
| theme09_page050 | 09 关键指标 | stat |
| theme09_page087 | 影像卡集 | cards |
| theme10_page007 | 核心数据 | metrics |
| theme10_page053 | 声明金句 | statement |
| theme12_page008 | 满版标语 / Statement | statement |
| theme12_page010 | 能力便当 / Capabilities | bento |
| theme12_page027 | 票根 / Ticket Stub | ticket |
| theme12_page061 | 评分表 / Scorecard | scorecard |
| theme12_page062 | 大数字 / By the Numbers | bignumber |
| theme12_page063 | 三连大数 / Headline Stats | stat3 |

## 图表·趋势（44 个 · 10 套主题覆盖）

| key | label | slot |
| --- | --- | --- |
| theme01_page012 | 纵向趋势 | trend |
| theme01_page054 | 增速排行 · 条形图 | growth-bars |
| theme01_page056 | 资金迁移 · 斜率图 | slope |
| theme01_page059 | 流式面积图 · 构成演变 | stream-area |
| theme02_page008 | 市场全景 · Trend | trend |
| theme02_page022 | 今昔对照 · Delta | delta |
| theme02_page064 | 斜率图 · Slope | slope |
| theme02_page072 | 主题河流 · Stream | stream |
| theme03_page008 | 市场全景 | trend |
| theme03_page017 | 应用层 | vertical |
| theme03_page026 | 单月峰值 | peak |
| theme03_page027 | 资金累积 | cumulative |
| theme03_page037 | 三视野 | horizon |
| theme04_page012 | 排名变迁 | slope |
| theme04_page031 | 增长大数字 | deltahero |
| theme04_page056 | 标注特写 | annotated |
| theme05_page009 | 趋势 Trend | trend |
| theme05_page022 | 环比对比 Delta | delta |
| theme05_page023 | 峰值图文 Peak | peak |
| theme05_page024 | 走势曲线 Curve | curve |
| theme05_page025 | 峰谷 Peak/Trough | peaktrough |
| theme05_page029 | 累计曲线 Cumulative | cumulative |
| theme05_page075 | 兑现轨迹 Horizon | horizon |
| theme05_page085 | 排名变迁 Slope | slope |
| theme06_page009 | 05 · 市场全景 / TREND | trend |
| theme06_page016 | 12 · 峰值与低位 / PEAK & TROUGH | peaktrough |
| theme06_page020 | 16 · 累计资金分布 / CAPITAL CURVE | cumulative |
| theme06_page037 | 33 · 增长效率工具 / GROWTH | growth |
| theme06_page070 | 66 · 嵌入工作流 / VERTICAL STRATEGY | vertical |
| theme07_page020 | 季度 Q3 峰值 | peak-page |
| theme07_page022 | 峰谷 Peak/Trough | peak-trough-page |
| theme09_page013 | 季度资金之流 | stream |
| theme09_page054 | 批注精读 | annotated |
| theme09_page069 | 10 应用落地 | vertical |
| theme09_page083 | 10 排名变迁 | slope |
| theme09_page089 | 10 季度走势 | trend |
| theme10_page020 | 排名变化 | slope |
| theme10_page027 | 净值曲线 | curve |
| theme10_page028 | 堆叠面积 | areastack |
| theme10_page084 | 标注影像 | annotated |
| theme10_page089 | 主题河流 | stream |
| theme12_page048 | 增长曲线 / Growth | growth |
| theme12_page049 | 堆叠面积 / Stacked Area | areastack |
| theme12_page050 | 斜率图 / Slope | slope |

## 图表·构成占比（42 个 · 10 套主题覆盖）

| key | label | slot |
| --- | --- | --- |
| theme01_page067 | 资金瀑布 · 构成 | waterfall |
| theme01_page071 | 构成演变 · 百分比堆叠 | stacked-mix |
| theme01_page072 | 像形方格图 · 资金去向 | waffle |
| theme01_page078 | 玫瑰图 · 赛道占比 | polar-rose |
| theme01_page079 | 甜甜圈 · 资金来源占比 | donut |
| theme01_page080 | 赛道 × 阶段 · 可变宽堆叠 | mekko |
| theme02_page036 | 市场结构 · Marimekko | marimekko |
| theme02_page039 | 资本桥 · Waterfall | waterfall |
| theme02_page048 | 资本结构 · Stacked Bar | stacked |
| theme02_page049 | 案例拼贴 · Mosaic | mosaic |
| theme02_page061 | 节律玫瑰 · Rose | rose |
| theme02_page068 | 资本去向 · Sunburst | sunburst |
| theme03_page024 | 轮次单位图 | waffle |
| theme03_page030 | 地理图集 | mosaic |
| theme03_page060 | 季度节奏 | waterfall |
| theme03_page068 | 月度玫瑰 | rose |
| theme03_page069 | 资金矩阵 | marimekko |
| theme04_page010 | 赛道占比 | donut |
| theme04_page014 | 资金瀑布 | waterfall |
| theme04_page019 | 季度资本构成 | stacked |
| theme05_page026 | 瀑布 Waterfall | waterfall |
| theme05_page027 | 双维堆叠 Split | stacked |
| theme05_page072 | 架构栈 Stack | stack |
| theme05_page088 | 影像档案 Mosaic | mosaic |
| theme05_page090 | 变宽堆叠 Mekko | mekko |
| theme06_page017 | 13 · 赛道贡献 / WATERFALL | waterfall |
| theme07_page023 | 瀑布 Waterfall | waterfall-page |
| theme09_page018 | 层级旭日 | sunburst |
| theme09_page048 | 市占矩形 | marimekko |
| theme09_page062 | 资金玫瑰 | rose |
| theme09_page070 | 影像拼贴 | mosaic |
| theme09_page076 | 10 资金瀑布 | waterfall |
| theme09_page094 | 10 结构演变 | stacked |
| theme10_page012 | 构成对比 | stacked |
| theme10_page014 | 份额矩阵 | mekko |
| theme10_page026 | 收益归因 | waterfall |
| theme10_page070 | 图文马赛克 | mosaic |
| theme12_page009 | 产品矩阵 / The Stack | stack |
| theme12_page044 | 收益构成 / Composition | donut |
| theme12_page047 | 瀑布图 / Waterfall | waterfall |
| theme12_page054 | 堆叠柱状 / Stacked Bars | stackbars |
| theme12_page065 | 影像拼贴 / Gallery | mosaic |

## 图表·分布比较（32 个 · 8 套主题覆盖）

| key | label | slot |
| --- | --- | --- |
| theme01_page051 | 市销率天梯 · 估值 vs 收入 | bubble-scatter |
| theme01_page055 | 吸金力排行 · 棒棒糖图 | lollipop |
| theme01_page060 | 子弹图 · 目标达成度 | bullet |
| theme01_page068 | 估值跃迁 · 哑铃图 | dumbbell |
| theme01_page075 | 同比对比 · 分组柱状图 | grouped-columns |
| theme01_page077 | 多空信号 · 双向条形 | diverging |
| theme02_page038 | 估值散点 · Scatter | scatter |
| theme02_page054 | 差距图 · Dumbbell | dumbbell |
| theme02_page057 | 月度气泡 · Bubble TL | bubbletl |
| theme02_page060 | 集中度 · Pareto | pareto |
| theme02_page073 | 规模分布 · Distribution | histogram |
| theme03_page013 | 融资体量 | bubble |
| theme03_page053 | 资本集中度 | pareto |
| theme03_page072 | 轮次背向 | tornado |
| theme04_page011 | 估值散点 | scatter |
| theme04_page025 | 资金消长 | spread |
| theme04_page053 | 估值跃迁 | dumbbell |
| theme05_page020 | 气泡 Deal Map | bubble |
| theme05_page064 | 区域分布 Spread | spread |
| theme05_page077 | 转化阶梯 Ladder | ladder |
| theme09_page037 | 同比对望 | tornado |
| theme09_page046 | 体量聚类 | bubble |
| theme09_page084 | 区间对比 | dumbbell |
| theme10_page015 | 分组柱图 | grouped |
| theme10_page022 | 目标子弹图 | bullet |
| theme10_page030 | 复利阶梯 | ladder |
| theme10_page058 | 风险气泡 | scatter |
| theme10_page059 | 年度盈亏 | diverging |
| theme10_page088 | 敏感性分析 | tornado |
| theme12_page052 | 点阵单位 / Units | dotplot |
| theme12_page053 | 气泡图 / Bubble | bubble |
| theme12_page057 | 子弹图 / Bullet | bullet |

## 图表·多维（81 个 · 10 套主题覆盖）

| key | label | slot |
| --- | --- | --- |
| theme01_page017 | 赛道资金 · 矩形树图 | treemap |
| theme01_page018 | 资金流向 · 桑基图 | sankey |
| theme01_page022 | 资金集中度 · 漏斗 | funnel |
| theme01_page023 | 估值梯队 · 金字塔 | tier-pyramid |
| theme01_page031 | 资本四象限 | quadrant |
| theme01_page053 | 资金热力矩阵 | heatmap |
| theme01_page065 | 三强能力雷达 | radar |
| theme01_page066 | 能力对比矩阵 | matrix |
| theme01_page070 | 排位赛 · 座次变化 | bump-rank |
| theme01_page074 | 环形仪表 · 关键比率 | arc-gauges |
| theme02_page009 | 月度热力 · Heatmap | heatmap |
| theme02_page015 | 四象限 · Matrix | quadrant |
| theme02_page016 | 能力雷达 · Radar | radar |
| theme02_page017 | 评级矩阵 · Rating | matrix |
| theme02_page019 | 资金流向 · Sankey | sankey |
| theme02_page037 | 资本漏斗 · Funnel | funnel |
| theme02_page040 | 达成率 · Gauge | gauge |
| theme02_page058 | 优先金字塔 · Pyramid | pyramid |
| theme02_page062 | 赛道版图 · Treemap | treemap |
| theme02_page065 | 径向枢纽 · Orbit | orbit |
| theme02_page069 | 名次变迁 · Bump | bump |
| theme02_page071 | 维恩交集 · Venn | venn |
| theme03_page014 | 选题四象限 | quadrant |
| theme03_page049 | 金字塔 | pyramid |
| theme03_page054 | 风险雷达 | radar |
| theme03_page061 | 资金版图 | treemap |
| theme03_page064 | 资本流向 | sankey |
| theme03_page066 | 泡沫温度计 | gauge |
| theme04_page013 | 资金版图 | treemap |
| theme04_page020 | 三重集中 | gauges |
| theme04_page021 | 资金热力矩阵 | heatmap |
| theme04_page028 | 能力对照矩阵 | matrix |
| theme04_page034 | 资本漏斗 | funnel |
| theme04_page037 | 产业链分层 | layers |
| theme04_page043 | 选题四象限 | quadrant |
| theme04_page049 | 多维雷达 | radar |
| theme04_page054 | 估值金字塔 | pyramid |
| theme05_page031 | 雷达 Radar | radar |
| theme05_page034 | 对照表 Matrix | matrix |
| theme05_page048 | 指标仪表 Meter | meter |
| theme05_page049 | 增长漏斗 Funnel | funnel |
| theme05_page059 | 生态环图 Orbit | orbit |
| theme06_page022 | 18 · 模型实验室竞争 / MODEL LAB RACE | radar |
| theme06_page029 | 25 · 机会矩阵 / QUADRANT | quadrant |
| theme06_page074 | 70 · 全年月度热力 / MONTHLY HEAT | heatmap |
| theme07_page012 | 象限 Quadrant | matrix-page |
| theme09_page036 | 赛道名次 | bump |
| theme09_page040 | 08 估值矩阵 | matrix |
| theme09_page045 | 09 定位矩阵 | quadrant |
| theme09_page047 | 09 资本漏斗 | funnel |
| theme09_page049 | 计量条 | meter |
| theme09_page056 | 资本弧网 | arc |
| theme09_page058 | 10 估值梯队 | tier |
| theme09_page063 | 环形纪程 | orbit |
| theme09_page065 | 10 全球格局 | radar |
| theme09_page068 | 交集视图 | venn |
| theme09_page072 | 10 公司版图 | treemap |
| theme09_page077 | 10 月度热力 | heatmap |
| theme09_page085 | 10 景气仪表 | gauge |
| theme10_page008 | 风险光谱 | spectrum |
| theme10_page009 | 策略象限 | quadrant |
| theme10_page013 | 占比树图 | treemap |
| theme10_page016 | 核心卫星 | orbit |
| theme10_page034 | 转化漏斗 | funnel |
| theme10_page062 | 相关性热力 | heatmap |
| theme10_page063 | 因子雷达 | radar |
| theme10_page073 | 资金桑基 | sankey |
| theme10_page074 | 半环量规 | meter |
| theme10_page081 | 名次走势 | bump |
| theme10_page082 | 财富金字塔 | pyramid |
| theme10_page086 | 策略交集 | venn |
| theme12_page016 | 叠影 / Layered | layers |
| theme12_page037 | 热力网格 / Heatmap | heatmap |
| theme12_page045 | 占比方块 / Treemap | treemap |
| theme12_page046 | 资金流向 / Flow | sankey |
| theme12_page051 | 转化漏斗 / Funnel | funnel |
| theme12_page056 | 仪表盘 / Gauges | gauges |
| theme12_page058 | 受众分层 / Pyramid | pyramid |
| theme12_page059 | 能力雷达 / Radar | radar |
| theme12_page060 | 定位矩阵 / Positioning | matrix |
| theme12_page072 | 声波画廊 / Spectrum | spectrum |

## 图表·时间/排期（27 个 · 10 套主题覆盖）

| key | label | slot |
| --- | --- | --- |
| theme01_page028 | 里程碑时间轴 | timeline |
| theme01_page044 | 月度节奏 | monthly |
| theme01_page058 | 年度关键节点 · 纵向时间线 | zigzag-timeline |
| theme01_page061 | 甘特排期 · IPO 上市窗口 | gantt |
| theme02_page012 | 时间轴 · Timeline | timeline |
| theme02_page028 | 交错图文 · Zigzag | zigzag |
| theme03_page025 | 月度明细 | monthly |
| theme03_page036 | 策略时间轴 | timeline |
| theme03_page043 | 建仓甘特 | gantt |
| theme03_page048 | 旅程图 | journey |
| theme04_page022 | 资本月历 | calendar |
| theme04_page066 | 泳道甘特 | gantt |
| theme04_page068 | 阶段策略 | timeline |
| theme05_page087 | 周期里程 Era | era |
| theme06_page083 | 79 · 里程碑节奏 / MILESTONES 2025 | milestones |
| theme07_page010 | 热力 Heatmap | monthly-page |
| theme09_page043 | 08 年度大事记 | timeline |
| theme09_page078 | 投资日历 | calendar |
| theme09_page082 | 影像纪程 | journey |
| theme09_page095 | 编年纪事 | era |
| theme10_page031 | 横向时间轴 | timeline |
| theme10_page032 | 排期甘特 | gantt |
| theme10_page068 | 旅程进度 | journey |
| theme10_page069 | 回报日历 | calendar |
| theme12_page035 | 发布排期 / Schedule | calendar |
| theme12_page076 | 旅程纵览 / Journey | journey |
| theme12_page081 | 时间轴 / Roadmap | timeline |

## 排行/表格（27 个 · 10 套主题覆盖）

| key | label | slot |
| --- | --- | --- |
| theme01_page019 | 头部玩家 | ranking |
| theme01_page021 | 表格 · Top 10 | table-top10 |
| theme01_page033 | 表格 · 轮次明细 | table |
| theme01_page049 | 活跃投资机构榜 | investors |
| theme02_page011 | 融资榜单 · Leaderboard | ranking |
| theme02_page030 | 公司图谱 · Logo Wall | logowall |
| theme03_page011 | 头部玩家 | rank |
| theme03_page012 | 速查表 | table |
| theme03_page055 | 风险登记册 | register |
| theme04_page024 | 轮次结构表 | table |
| theme04_page026 | 头部玩家对照表 | scoreboard |
| theme04_page027 | 投资人出手榜 | ledger |
| theme04_page036 | 头部玩家 | ranking |
| theme05_page014 | 排名 Ranking | rank |
| theme05_page042 | 结构表 Ledger | ledger |
| theme05_page078 | 风险登记表 Register | register |
| theme06_page026 | 22 · 融资排名 / RANKING | ranking |
| theme07_page011 | 排名 Ranking | ranking-page |
| theme09_page035 | 08 资本排行 | ranking |
| theme09_page059 | 数据台账 | ledger |
| theme09_page086 | 年度计分榜 | scoreboard |
| theme10_page010 | 账本表 | ledger |
| theme10_page066 | 排行榜 | ranking |
| theme12_page032 | 表格 / Compare | table |
| theme12_page055 | 平台排行 / Ranking | ranking |
| theme12_page064 | 记分牌 / Scoreboard | scoreboard |
| theme12_page073 | 伙伴墙 / Logo Wall | logowall |

## 对比/对决（25 个 · 8 套主题覆盖）

| key | label | slot |
| --- | --- | --- |
| theme01_page025 | 三强横向对比 | versus |
| theme01_page043 | 满版对比 · 双联画面 | split-diptych |
| theme01_page081 | 满版影像 · 三联现场 | triptych |
| theme02_page031 | 双图对比 · Compare | compare |
| theme02_page034 | 特性对照 · Compare Table | comparetable |
| theme02_page051 | 多空对照 · Versus | versus |
| theme04_page033 | 对比双数字 | versus |
| theme04_page048 | 全幅三联 | triptych |
| theme04_page061 | 分屏章节 | split |
| theme04_page062 | 投资策略 | compare |
| theme04_page063 | 叙事对兑现 | diptych |
| theme05_page008 | 方法 Methodology | split |
| theme05_page065 | 三类资源 Triad | triad |
| theme05_page091 | 对比大数字 Versus | versus |
| theme06_page053 | 49 · 三类关键资源 / TALENT·CAPITAL·COMPUTE | triad |
| theme09_page023 | 斜切分屏 | split |
| theme09_page041 | 数字对决 | versus |
| theme09_page060 | 双联对照 | diptych |
| theme09_page103 | 12 多维对比 | compare |
| theme10_page018 | 抉择双栏 | versus |
| theme10_page042 | 三联影像 | triptych |
| theme10_page047 | 图像对照 | compareimg |
| theme12_page014 | 影像分栏 / Split | split |
| theme12_page015 | 三联像 / Triptych | triptych |
| theme12_page031 | 前后对比 / Before · After | beforeafter |

## 流程/路线/链（41 个 · 10 套主题覆盖）

| key | label | slot |
| --- | --- | --- |
| theme01_page010 | 横纵分析法 | method |
| theme01_page014 | 产业链分层 | chain |
| theme01_page032 | 轮次结构 | rounds |
| theme01_page040 | 阶段性策略路线图 | roadmap |
| theme02_page006 | 研究方法 · Method | method |
| theme02_page018 | 产业链分层 · Chain | chain |
| theme02_page032 | 轮次结构 · Rounds | rounds |
| theme02_page044 | 判断框架 · Process | process |
| theme02_page056 | 策略路线 · Roadmap | roadmap |
| theme03_page007 | 研究方法 | method |
| theme03_page015 | 产业链分层 | chain |
| theme03_page023 | 轮次结构 | round |
| theme04_page007 | 研究方法 | method |
| theme04_page038 | 产业链分层表 | chaintable |
| theme04_page039 | 产业链分层·流向 | chainflow |
| theme04_page065 | 资本三段式 | roadmap |
| theme05_page011 | 产业链 Value Chain | chain |
| theme05_page038 | 流程增长 Flow | flow |
| theme05_page058 | 投资闭环 Loop | loop |
| theme05_page070 | 流程表 Process | process |
| theme06_page008 | 04 · 研究方法 / METHODOLOGY | method |
| theme06_page027 | 23 · 产业链分层 / VALUE CHAIN | chain |
| theme06_page042 | 38 · 新主题萌芽 / EARLY-STAGE SIGNAL | rounds |
| theme07_page008 | 方法 Methodology | method-page |
| theme07_page052 | 生态 NVIDIA | ecosystem-page |
| theme09_page021 | 04 产业链分层 | chain |
| theme09_page034 | 08 轮次结构 | rounds |
| theme09_page055 | 10 资金流向 | flow |
| theme09_page057 | 资本网络 | network |
| theme09_page081 | 阶段时序 | phases |
| theme09_page092 | 方案对照 | plans |
| theme09_page098 | 10 布局路线 | roadmap |
| theme09_page104 | 13 实施路径 | process |
| theme10_page017 | 方案对照 | plans |
| theme10_page067 | 资金流向 | flow |
| theme10_page071 | 行动清单 | checklist |
| theme12_page011 | 流程 / How It Works | process |
| theme12_page012 | 生态网络 / Ecosystem | ecosystem |
| theme12_page013 | 组织架构 / Structure | orgchart |
| theme12_page036 | 路线图 / Roadmap | roadmap |
| theme12_page038 | 特性矩阵 / Feature Matrix | checklist |

## 观点/结论/金句（46 个 · 10 套主题覆盖）

| key | label | slot |
| --- | --- | --- |
| theme01_page027 | 金句 · CEO 视角 | quote-dario |
| theme01_page039 | 投资展望 | outlook |
| theme01_page047 | 金句 · 一句话总结 | quote |
| theme01_page082 | 大字主张 · 从叙事到兑现 | type-statement |
| theme01_page083 | 结论 | conclusion |
| theme02_page043 | 声音墙 · Voices | voices |
| theme02_page045 | 核心结论 · Takeaways | takeaway |
| theme02_page047 | 结语金句 · Quote | quote |
| theme02_page055 | 结论主张 · Manifesto | manifesto |
| theme02_page074 | 封底结语 · Closing | closing |
| theme03_page035 | 投资建议 | outlook |
| theme03_page038 | 核心结论 | takeaway |
| theme03_page039 | 金句页 | quote |
| theme04_page070 | 投资人说 | voices |
| theme04_page071 | 宣言金句 | manifesto |
| theme04_page072 | 论断印章 | verdict |
| theme04_page073 | 图文金句 | quoteimage |
| theme05_page017 | 策略 Outlook | outlook |
| theme05_page018 | 结论 Conclusion | quote |
| theme05_page084 | 最终判断 Verdict | verdict |
| theme06_page031 | 27 · 投资建议 / OUTLOOK | outlook |
| theme06_page071 | 67 · 结论 / CONCLUSION | quote |
| theme06_page077 | 73 · 全景速览 / YEAR IN ONE VIEW | recap |
| theme06_page079 | 75 · 最终判断 / FINAL VERDICT | closing |
| theme07_page014 | 策略 Outlook | outlook-page |
| theme07_page015 | 结论 Conclusion | quote-page |
| theme07_page067 | 结语 Closing | closing-page |
| theme09_page028 | 06 投资展望 | outlook |
| theme09_page029 | 07 核心结论 | conclusion |
| theme09_page052 | 09 观点引述 | quote |
| theme09_page053 | 金句主张 | manifesto |
| theme09_page102 | 11 核心要点 | takeaway |
| theme09_page105 | 14 关键问答 | faq |
| theme09_page111 | 结语 | closing |
| theme10_page037 | 投资原则 | principles |
| theme10_page039 | 引言 | quote |
| theme10_page055 | 常见问题 | faq |
| theme10_page085 | 影像金句 | quoteimg |
| theme10_page095 | 结束 | closing |
| theme12_page005 | 封面 / Manifesto | manifesto |
| theme12_page006 | 金句 / Quote | quote |
| theme12_page040 | 问答 / FAQ | faq |
| theme12_page077 | 图上金句 / Quote over Image | quoteimage |
| theme12_page082 | 信条 / Principles | principles |
| theme12_page084 | 证言 / Voices | voices |
| theme12_page085 | 群言 / Quote Wall | quotewall |

## 案例/特写（59 个 · 10 套主题覆盖）

| key | label | slot |
| --- | --- | --- |
| theme01_page015 | 算力上游 · 卖铲子 | compute |
| theme01_page026 | 典型案例 | case |
| theme01_page029 | 核心竞争力 | case-strength |
| theme01_page030 | 前沿赛道 · 具身智能 | banner-embodied |
| theme01_page035 | 湾区 · 地理护城河 | feature-region |
| theme01_page041 | 满版图片 · IPO 退出窗口 | banner-ipo |
| theme01_page045 | 典型案例 · xAI | case-xai |
| theme01_page046 | 典型案例 · CoreWeave | case-coreweave |
| theme01_page057 | 标签化特写 · 前沿掠影 | spotlight-tags |
| theme01_page062 | 满版图片 · 算力新基建 | hero-compute |
| theme01_page073 | 专题特写 · AI Agent | editorial |
| theme02_page013 | 案例图景 · Showcase | showcase |
| theme02_page024 | 案例聚焦 · Spotlight | spotlight |
| theme02_page025 | 沉浸大图 · Feature | feature |
| theme02_page026 | 主题海报 · Poster | poster |
| theme02_page052 | 公司档案 · Profile | profile |
| theme02_page053 | 进程图带 · Storyboard | storyboard |
| theme02_page059 | 杂志大图 · Editorial | editorial |
| theme03_page018 | 典型案例 | case |
| theme03_page019 | 案例聚焦 | spotlight |
| theme03_page021 | 案例对比 | casecompare |
| theme03_page076 | 算力军备 | compute |
| theme04_page047 | 杂志式跨页 | editorial |
| theme04_page050 | 典型案例 | case |
| theme04_page051 | 人物档案卡 | profile |
| theme04_page055 | 大图封面 | hero |
| theme04_page058 | 焦点特写 | spotlight |
| theme04_page059 | 焦点机位 | showcase |
| theme05_page012 | 案例 Cases | cases |
| theme05_page033 | 赛道聚焦 Spotlight | spotlight |
| theme05_page043 | 图像主视觉 Showcase | showcase |
| theme05_page050 | 大数字 Hero | hero |
| theme05_page057 | 资源类型 Resource | resource |
| theme05_page063 | 图像主视觉 Profile | profile |
| theme06_page028 | 24 · 典型案例 / CASE STUDIES | cases |
| theme06_page045 | 41 · 钱以外的资源 / STRATEGIC RESOURCES | resource |
| theme06_page067 | 63 · 毛利天花板 / COMPUTE COST | compute |
| theme07_page009 | 案例 Cases | case-page |
| theme07_page034 | 赛道 算力云 | compute-page |
| theme07_page050 | 角色 战略投资者 | resource-page |
| theme07_page055 | 三角 人才资本算力 | resource-triad-page |
| theme09_page022 | 05 典型案例 | cases |
| theme09_page024 | 分镜脚本 | storyboard |
| theme09_page025 | 图说特写 | feature |
| theme09_page038 | 核心数字 | hero |
| theme09_page074 | 陈列墙 | exhibit |
| theme09_page106 | 15 专题洞察 | spotlight |
| theme10_page023 | 人物特写 | profile |
| theme10_page040 | 编排图文 | editorial |
| theme10_page041 | 杂志图文 | magazine |
| theme10_page046 | 图文特写 | feature |
| theme10_page078 | 沉浸大图 | showcase |
| theme10_page079 | 主视觉海报 | poster |
| theme10_page092 | 标的档案 | exhibit |
| theme12_page017 | 杂志特写 / Magazine | magazine |
| theme12_page018 | 图文交错 / Editorial | editorial |
| theme12_page019 | 图片页 / In Context | showcase |
| theme12_page020 | 整版大图 / On Stage | hero |
| theme12_page075 | 功能聚焦 / Feature | spotlight |

## 图片/画廊（36 个 · 7 套主题覆盖）

| key | label | slot |
| --- | --- | --- |
| theme01_page020 | 头部玩家掠影 | gallery |
| theme01_page037 | 大数字 · 估值泡沫 | sticker-bubble |
| theme01_page052 | 贴纸拼贴 · 前沿掠影 | collage-frontier |
| theme01_page069 | 年度热词 · 标签墙 | sticker-wall |
| theme01_page076 | 影像长卷 · 关键时刻 | filmstrip |
| theme02_page029 | 案例图集 · Gallery | gallery |
| theme02_page033 | 笔数分布 · Pictogram | pictogram |
| theme02_page070 | 瀑布流图墙 · Masonry | masonry |
| theme03_page063 | 实验室影像 | gallery |
| theme04_page041 | 地区画廊 | gallery |
| theme04_page042 | 胶片印样 | filmstrip |
| theme04_page057 | 图片故事 | imagestory |
| theme04_page060 | 拍立得拼贴 | polaroid |
| theme09_page014 | 全景横幅 | panorama |
| theme09_page026 | 影像速写 | polaroid |
| theme09_page075 | 影像长卷 | filmstrip |
| theme09_page080 | 瀑布影像 | masonry |
| theme09_page096 | 杂志跨页 | zine |
| theme09_page107 | 16 研究团队 | team |
| theme10_page024 | 内容墙 | team |
| theme10_page049 | 影像长卷 | filmstrip |
| theme10_page054 | 影像集 | gallery2 |
| theme10_page076 | 拼贴影像 | collage |
| theme12_page024 | 全景宽幅 / Panorama | panorama |
| theme12_page025 | 拍立得 / Polaroid | polaroid |
| theme12_page026 | 明信片 / Postcard | postcard |
| theme12_page028 | 胶片样张 / Contact Sheet | filmstrip |
| theme12_page029 | 邮票张 / Stamps | stampsheet |
| theme12_page066 | 拼贴海报 / Zine | zine |
| theme12_page067 | 灵感板 / Moodboard | moodboard |
| theme12_page068 | 专辑曲目 / Tracklist | album |
| theme12_page069 | 黑胶 / Now Playing | vinyl |
| theme12_page070 | 图墙 / Grid Wall | gridwall |
| theme12_page071 | 画框墙 / Gallery Wall | gallerywall |
| theme12_page078 | 歌词金句 / Lyric | lyric |
| theme12_page083 | 团队群像 / Team | team |

## 雷达/风险/能力（10 个 · 8 套主题覆盖）

| key | label | slot |
| --- | --- | --- |
| theme01_page038 | 风险研判 | risk |
| theme02_page046 | 风险研判 · Risk | risk |
| theme03_page033 | 风险研判 | risk |
| theme03_page034 | 风险传导 | riskchain |
| theme04_page064 | 风险传导 | riskchain |
| theme05_page016 | 风险 Risk | risk |
| theme06_page030 | 26 · 风险研判 / RISK | risk |
| theme07_page013 | 风险 Risk | risk-page |
| theme07_page059 | 章节 风险策略 | risk-chapter-page |
| theme09_page027 | 06 风险研判 | risk |

## 地区/区域（12 个 · 8 套主题覆盖）

| key | label | slot |
| --- | --- | --- |
| theme01_page016 | 赛道分布 · 融资额占比 | sector |
| theme01_page034 | 地区分布 | region |
| theme01_page048 | 全球版图 · 资金分布 | global-split |
| theme02_page035 | 地区分布 · Region | region |
| theme03_page010 | 横向透视 | sector |
| theme03_page029 | 地区分布 | geo |
| theme04_page040 | 地区分布 | region |
| theme05_page061 | 地理身份 Region | region |
| theme06_page048 | 44 · 最大地理中心 / BAY AREA | bay |
| theme07_page053 | 地理 湾区中心 | geo-center-page |
| theme07_page054 | 集群 区域对比 | region-cluster-page |
| theme09_page012 | 02 市场全景 | market |

## 附录/收尾（5 个 · 4 套主题覆盖）

| key | label | slot |
| --- | --- | --- |
| theme01_page084 | 附录 · 数据来源 | appendix |
| theme03_page077 | 封底 | colophon |
| theme05_page093 | 数据来源 Appendix | colophon |
| theme05_page094 | 封底 Back Cover | endcap |
| theme07_page068 | 章节 附录 | appendix-chapter-page |

## 其他（416 个 · 12 套主题覆盖）

| key | label | slot |
| --- | --- | --- |
| theme01_page063 | 杂志封面 · 算力军备竞赛 | mag-cover |
| theme02_page010 | 行业占比 · Share | industry |
| theme02_page027 | 图文卡组 · Card Grid | cardgrid |
| theme02_page041 | 达成度 · Progress | progress |
| theme02_page042 | 人物金句 · Portrait | portrait |
| theme02_page050 | 明细表 · Data Table | datatable |
| theme02_page063 | 资本飞轮 · Cycle | cyclewheel |
| theme02_page066 | 三球串联 · Spheres | spheres |
| theme02_page067 | 机会图谱 · Mindmap | mindmap |
| theme03_page009 | 年度编年 | chronicle |
| theme03_page016 | 产业链速查 | layertable |
| theme03_page020 | 卖铲赢家 | coreweave |
| theme03_page031 | 估值跃迁 | valuationjump |
| theme03_page032 | 估值之谜 | valuation |
| theme03_page040 | AARRR | aarrr |
| theme03_page041 | RFM | rfm |
| theme03_page042 | MABA | maba |
| theme03_page044 | 决策双钻 | doublediamond |
| theme03_page045 | SWOT | swot |
| theme03_page046 | 五力 | fiveforces |
| theme03_page047 | 画布 | canvas |
| theme03_page050 | 波士顿矩阵 | bcg |
| theme03_page051 | 飞轮 | flywheel |
| theme03_page052 | PEST | pest |
| theme03_page056 | 范式转变 | shift |
| theme03_page057 | 成熟度曲线 | hypecycle |
| theme03_page058 | 决策矩阵 | betmatrix |
| theme03_page059 | 资本大年 | share |
| theme03_page062 | 单笔阶梯 | escalation |
| theme03_page067 | 具身智能 | embodied |
| theme03_page070 | 三重集中 | concentration |
| theme03_page073 | 护城河 | moat |
| theme03_page074 | 算力卡脖 | supply |
| theme03_page075 | AI 芯片 | chips |
| theme04_page015 | 半年对比柱 | groupbars |
| theme04_page017 | 融资趋势 | charts |
| theme04_page018 | 月度趋势 | monthchart |
| theme04_page023 | 季度走势表 | quartertable |
| theme04_page046 | 三强争霸 | trio |
| theme04_page052 | 估值三级跳 | valuechart |
| theme04_page067 | 资本地铁线 | metro |
| theme04_page069 | 极简编号章节 | numbered |
| theme05_page001 | 封面 精益智造 | excover1 |
| theme05_page002 | 封面 创意破圈 | excover2 |
| theme05_page003 | 封面 链通全国 | excover3 |
| theme05_page004 | 封面 把握消费趋势 | excover4 |
| theme05_page006 | 摘要 Overview | spec |
| theme05_page007 | 结构 Contents | grid |
| theme05_page010 | 占比 Share | share |
| theme05_page013 | 热力 Heatmap | heat |
| theme05_page015 | 象限 Quadrant | quad |
| theme05_page021 | 季度快照 Snapshot | snapshot |
| theme05_page032 | 赛道剖析 Segment | segment |
| theme05_page035 | 子项拆分 Breakdown | breakdown |
| theme05_page036 | 场景占比 Scene | scene |
| theme05_page039 | 图示规格 Diagram | diagram |
| theme05_page040 | 构成占比 Mix | mix |
| theme05_page041 | 容量栅格 Capacity | capacity |
| theme05_page044 | 架构图 Atlas | atlas |
| theme05_page045 | 分层防线 Gate | gate |
| theme05_page046 | 图像型录 Catalog | catalog |
| theme05_page047 | 学习路径 Path | path |
| theme05_page051 | 转化通道 Flux | flux |
| theme05_page052 | 评测流程 Shield | shield |
| theme05_page054 | 早期信号表 Signal | signal |
| theme05_page055 | 结构拆解 Composite | composite |
| theme05_page056 | 资本来源 Source | source |
| theme05_page060 | 占比大数字 Dominance | dominance |
| theme05_page062 | 区域定位 Locale | locale |
| theme05_page066 | 标杆案例 Benchmark | benchmark |
| theme05_page067 | 档案卡 Dossier | dossier |
| theme05_page068 | 生态连接 Nexus | nexus |
| theme05_page069 | 算力集群 Foundry | foundry |
| theme05_page071 | 转化漏斗 Gateway | gateway |
| theme05_page073 | 知识索引 Index | index |
| theme05_page074 | 大数字 Monolith | monolith |
| theme05_page079 | 毛利天花板 Ceiling | ceiling |
| theme05_page080 | 壁垒压缩 Squeeze | squeeze |
| theme05_page081 | 策略推荐 Slate | slate |
| theme05_page082 | 工作流嵌入 Embed | embed |
| theme05_page083 | 估值锚 Re-anchor | beacon |
| theme05_page089 | 全幅影像 Plate | plate |
| theme05_page092 | 金句 Lede | lede |
| theme06_page006 | 02 · 报告摘要 / OVERVIEW | summary |
| theme06_page011 | 07 · 规模分层 / DEAL MAP | dealmap |
| theme06_page012 | 08 · 冷启动季度 / Q1 BREAKDOWN | q1 |
| theme06_page013 | 09 · 加速季度 / Q2 BREAKDOWN | q2 |
| theme06_page014 | 10 · 峰值季度 / Q3 PEAK | q3 |
| theme06_page015 | 11 · 回落季度 / Q4 PULLBACK | q4 |
| theme06_page018 | 14 · 金额区间结构 / SIZE SPLIT | sizesplit |
| theme06_page019 | 15 · 赛道平均融资额 / AVG TICKET | avgticket |
| theme06_page021 | 17 · 赛道结构细分 / CHAPTER 03 | ch03 |
| theme06_page023 | 19 · 工作流自动化 / AI AGENTS | agent |
| theme06_page024 | 20 · 知识入口 / ENTERPRISE SEARCH | search |
| theme06_page025 | 21 · 专业服务 / LEGAL AI | legal |
| theme06_page032 | 28 · 大数字 / BIG NUMBER | big |
| theme06_page033 | 29 · 慢变量高壁垒 / HEALTHCARE AI | health |
| theme06_page034 | 30 · 投研风控合规 / FINANCE AI | finance |
| theme06_page035 | 31 · 研发效率提升 / DEV TOOLS | dev |
| theme06_page036 | 32 · 企业 AI 底座 / DATA INFRA | datainfra |
| theme06_page038 | 34 · 企业流程嵌入 / LOW CODE | lowcode |
| theme06_page039 | 35 · 社区影响力变现 / OPEN SOURCE | opensource |
| theme06_page040 | 36 · 安全与对齐工具 / ALIGNMENT | safety |
| theme06_page041 | 37 · 资本与地区结构 / CHAPTER 04 | ch04 |
| theme06_page043 | 39 · 复杂交易结构 / DEAL STRUCTURE | dealstruct |
| theme06_page044 | 40 · 资本来源结构 / INVESTOR MIX | investor |
| theme06_page046 | 42 · 投资与算力消费闭环 / CLOUD ALLIANCES | alliance |
| theme06_page047 | 43 · GPU 资源链条 / NVIDIA ECOSYSTEM | gpu |
| theme06_page049 | 45 · 行业客户优势 / NEW YORK | nyc |
| theme06_page050 | 46 · 云计算人才外溢 / SEATTLE | seattle |
| theme06_page051 | 47 · 科研与硬科技 / BOSTON | boston |
| theme06_page052 | 48 · 分散型应用落地 / OTHER REGIONS | other |
| theme06_page054 | 50 · 商业化标杆 / OPENAI | openai |
| theme06_page055 | 51 · 安全可靠模型 / ANTHROPIC | anthropic |
| theme06_page056 | 52 · 实时数据生态 / XAI | xai |
| theme06_page057 | 53 · 算力基础设施 / COREWEAVE | coreweave |
| theme06_page058 | 54 · 数据基础设施 / SCALE AI · TABLE | scaleai |
| theme06_page059 | 55 · AI 搜索入口 / PERPLEXITY | perplexity |
| theme06_page060 | 56 · 数据平台延展 / DATABRICKS | databricks |
| theme06_page061 | 57 · 企业知识入口 / GLEAN | glean |
| theme06_page062 | 58 · 人形机器人 / FIGURE AI | figure |
| theme06_page063 | 59 · 强叙事模型实验室 / SSI | ssi |
| theme06_page064 | 60 · 风险与策略 / CHAPTER 05 | ch05 |
| theme06_page065 | 61 · 从试点到稳定收入 / REVENUE RISK | revrisk |
| theme06_page066 | 62 · 隐私版权与安全 / REGULATION · TABLE | regrisk |
| theme06_page068 | 64 · 壁垒被压缩 / OPEN SOURCE RISK | openrisk |
| theme06_page069 | 65 · 确定性预算 / INFRA STRATEGY | infra |
| theme06_page072 | 68 · 估值锚重定价 / IPO WATCH | ipowatch |
| theme06_page073 | 69 · 数据附录精读 / CHAPTER 06 | ch06 |
| theme06_page075 | 71 · 超级交易画像 / MEGA DEALS | megadeals |
| theme06_page076 | 72 · 超级交易均值 / MEGA AVG | megabig |
| theme06_page078 | 74 · 数据来源与口径 / SOURCES | sources |
| theme06_page080 | 76 · 前瞻信号 / CHAPTER 07 | ch07 |
| theme06_page081 | 77 · 资本流向预测 / CAPITAL FLOW | capflow |
| theme07_page006 | 摘要 Overview | summary-page |
| theme07_page017 | 气泡 Deal Map | deal-map-page |
| theme07_page018 | 季度 Q1 冷启动 | cold-start-page |
| theme07_page019 | 季度 Q2 加速 | accelerate-page |
| theme07_page021 | 季度 Q4 回落 | cooldown-page |
| theme07_page024 | 区间 Deal Size | deal-size-page |
| theme07_page025 | 均值 Avg Ticket | avg-ticket-page |
| theme07_page026 | 图谱 Investors | investor-page |
| theme07_page027 | 排名 Active Capital | active-capital-page |
| theme07_page028 | 集中度 Concentration | concentration-page |
| theme07_page029 | 阵容 Syndicate | syndicate-page |
| theme07_page030 | 赛道 企业搜索 | knowledge-page |
| theme07_page031 | 赛道 法律 AI | legal-page |
| theme07_page032 | 赛道 医疗 AI | healthcare-page |
| theme07_page033 | 赛道 金融 AI | finance-page |
| theme07_page035 | 赛道 AI 芯片 | chip-page |
| theme07_page036 | 赛道 具身智能 | robotics-page |
| theme07_page037 | 赛道 自动驾驶 | autonomy-page |
| theme07_page038 | 赛道 AI 安全 | safety-page |
| theme07_page039 | 赛道 内容生成 | content-gen-page |
| theme07_page040 | 赛道 教育 AI | education-page |
| theme07_page041 | 赛道 客服 AI | support-page |
| theme07_page042 | 赛道 销售营销 | sales-page |
| theme07_page043 | 赛道 低代码 | low-code-page |
| theme07_page044 | 赛道 开源模型 | open-source-page |
| theme07_page045 | 赛道 模型对齐 | alignment-page |
| theme07_page046 | 章节 资本结构 | capital-chapter-page |
| theme07_page047 | 信号 早期轮 | early-stage-page |
| theme07_page048 | 结构 未披露轮次 | deal-structure-page |
| theme07_page049 | 构成 Investor Mix | investor-mix-page |
| theme07_page051 | 联盟 云厂商 | alliance-page |
| theme07_page056 | 案例 OpenAI | open-aicase-page |
| theme07_page057 | 案例 Figure | figure-case-page |
| theme07_page058 | 案例 SSI | ssicase-page |
| theme07_page060 | 风险 收入验证 | revenue-page |
| theme07_page061 | 风险 监管合规 | compliance-page |
| theme07_page062 | 风险 算力成本 | margin-page |
| theme07_page063 | 风险 壁垒压缩 | moat-page |
| theme07_page064 | 策略 优先基建 | strategy-infra-page |
| theme07_page065 | 策略 垂直应用 | strategy-vertical-page |
| theme07_page066 | 策略 IPO 重定价 | repricing-page |
| theme07_page069 | 前瞻 Forward | forward-page |
| theme07_page070 | 口径 数据来源 | sources-page |
| theme07_page071 | 关于 About the Lab | about-lab-page |
| theme08_page001 | 补充封面-① 智联万物 | sup1 |
| theme08_page002 | 补充封面-② 深耕教学 | sup2 |
| theme08_page003 | 补充封面-③ 新机遇新赛道 | sup3 |
| theme08_page004 | 封面2-③ 链通全国 | cv2c |
| theme08_page005 | ① 封面 · Cover | p1 |
| theme08_page006 | ② 摘要 · Overview | p2 |
| theme08_page007 | ③ 结构 · Contents | p3 |
| theme08_page008 | ⑤ 趋势 · Trend | p5 |
| theme08_page009 | ⑥ 透视 · Cross | p6 |
| theme08_page010 | ⑦ 产业链 · Chain | p7 |
| theme08_page011 | ⑧ 案例 · Cases | p8 |
| theme08_page012 | ⑨ 热力 · Heatmap | p9 |
| theme08_page013 | ⑩ 排名 · Ranking | p10 |
| theme08_page014 | ⑪ 象限 · Quadrant | p11 |
| theme08_page015 | ⑬ 策略 · Strategy | p13 |
| theme08_page016 | ⑭ 金句 · Quote | p14 |
| theme08_page017 | ⑮ 章节 · Chapter | p15 |
| theme08_page018 | ⑯ 气泡图 · Deal Map | p16 |
| theme08_page019 | ⑰ 季度聚焦 · Spotlight | p17 |
| theme08_page020 | ⑱ 指标对比 · Delta | p18 |
| theme08_page021 | ⑲ 峰值聚焦 · Peak | p19 |
| theme08_page022 | ⑳ 回落时间轴 · Pullback | p20 |
| theme08_page023 | ㉑ 峰谷对比 · Peak/Trough | p21 |
| theme08_page024 | ㉒ 贡献瀑布 · Waterfall | p22 |
| theme08_page025 | ㉓ 区间结构 · Size Split | p23 |
| theme08_page026 | ㉔ 大数字 · Big Number | p24 |
| theme08_page027 | ㉕ 累计曲线 · Capital Curve | p25 |
| theme08_page028 | ㉖ 章节 · Chapter | p26 |
| theme08_page029 | ㉗ 雷达图 · Radar | p27 |
| theme08_page030 | ㉘ 赛道卡 · Segment | p28 |
| theme08_page031 | ㉙ 知识入口 · Portal | p29 |
| theme08_page032 | ㉚ 场景矩阵 · Matrix | p30 |
| theme08_page033 | ㉛ 分支三联 · Triptych | p31 |
| theme08_page034 | ㉜ 场景占比 · Scene Split | p32 |
| theme08_page035 | ㉝ 金句 · Statement | p33 |
| theme08_page036 | ㉞ 数据底座 · Pipeline | p34 |
| theme08_page037 | ㉟ 架构 · Architecture | p35 |
| theme08_page038 | ㊱ 供应链 · Supply | p36 |
| theme08_page039 | ㊲ 算力网格 · Compute | p37 |
| theme08_page040 | ㊳ 芯片层级 · Chip Tiers | p38 |
| theme08_page041 | ㊴ 具身智能 · Embodied | p39 |
| theme08_page042 | ㊶ 安全防线 · Safety | p41 |
| theme08_page043 | ㊷ 内容生成 · Generative | p42 |
| theme08_page044 | ㊸ 学习路径 · Education | p43 |
| theme08_page045 | ㊹ 降本场景 · Support | p44 |
| theme08_page046 | ㊻ 流程嵌入 · Low Code | p46 |
| theme08_page047 | ㊼ 社区变现 · Open Source | p47 |
| theme08_page048 | ㊽ 安全对齐 · Alignment | p48 |
| theme08_page049 | ㊾ 章节 · Chapter | p49 |
| theme08_page050 | ㊿ 早期轮 · Early Stage | p50 |
| theme08_page051 | (52) 资本来源 · Investor Mix | p52 |
| theme08_page052 | (53) 资源绑定 · Resource Map | p53 |
| theme08_page053 | (54) 算力闭环 · Closed Loop | p54 |
| theme08_page054 | (55) GPU 生态 · Ecosystem | p55 |
| theme08_page055 | (56) 大数字 · Geo Anchor | p56 |
| theme08_page056 | (57) 地理卡 · New York | p57 |
| theme08_page057 | (58) 地理卡 · Seattle | p58 |
| theme08_page058 | (59) 地理卡 · Boston | p59 |
| theme08_page059 | (60) 点阵图 · Other Regions | p60 |
| theme08_page060 | (61) 金句 · Resources | p61 |
| theme08_page061 | (64) 案例卡 · xAI | p64 |
| theme08_page062 | (65) 案例卡 · CoreWeave | p65 |
| theme08_page063 | (66) 案例表 · Scale AI | p66 |
| theme08_page064 | (67) 案例卡 · Perplexity | p67 |
| theme08_page065 | (68) 案例卡 · Databricks | p68 |
| theme08_page066 | (69) 案例卡 · Glean | p69 |
| theme08_page067 | (71) 案例卡 · SSI | p71 |
| theme08_page068 | (73) 收入兑现 · Revenue | p73 |
| theme08_page069 | (74) 合规台账 · Regulation | p74 |
| theme08_page070 | (76) 壁垒压缩 · Squeeze | p76 |
| theme08_page071 | (77) 策略卡 · Budget | p77 |
| theme08_page072 | (78) 嵌入流程 · Workflow | p78 |
| theme08_page073 | (79) 时间轴 · Repricing | p79 |
| theme08_page074 | (80) 金句 · Verdict | p80 |
| theme08_page075 | (81) 展望主线 · Mainlines | p81 |
| theme08_page076 | (82) 迁移图 · Migration | p82 |
| theme08_page077 | (83) 样板 · Playbooks | p83 |
| theme08_page078 | (84) 大数字 · Gauge | p84 |
| theme08_page079 | (85) 跨页 · Hero Split | p85 |
| theme08_page080 | (86) 哑铃图 · Range | p86 |
| theme08_page081 | (87) 路线图 · Roadmap | p87 |
| theme08_page082 | (88) 照片墙 · Photo Wall | p88 |
| theme08_page083 | (90) 记分卡 · Scorecard | p90 |
| theme08_page084 | (91) 金句 · Two-Field | p91 |
| theme09_page008 | 报告摘要 | overview |
| theme09_page009 | 点阵计数 | dotfield |
| theme09_page015 | 焦点舞台 | stage |
| theme09_page016 | 03 横向透视 | cross |
| theme09_page017 | 板块联投 | chord |
| theme09_page019 | 论点推演 | thesis |
| theme09_page020 | 全幅比例带 | ribbon |
| theme09_page031 | 卷首题词 | epigraph |
| theme09_page032 | 归纳括弧 | bracket |
| theme09_page042 | 标语字阵 | typeriver |
| theme09_page044 | 螺旋纪程 | spiral |
| theme09_page051 | 交叉透视 | crosstab |
| theme09_page061 | 10 资金用途 | alloc |
| theme09_page064 | 数字海报 | mega |
| theme09_page066 | 区域画像 | parallel |
| theme09_page067 | 评级矩阵 | grade |
| theme09_page071 | 径向透视 | radialbar |
| theme09_page073 | 层级冰柱 | icicle |
| theme09_page079 | 赛道蜂巢 | honeycomb |
| theme09_page088 | 跨栏图景 | halfhero |
| theme09_page090 | 单笔分布 | ridge |
| theme09_page091 | 预测扇形 | fan |
| theme09_page093 | 阶梯递进 | stair |
| theme09_page097 | 全幅图景 | immersive |
| theme09_page099 | 10 赛道评分 | score |
| theme09_page100 | 人物证言 | testimonial |
| theme09_page108 | 圆窗影像 | ring |
| theme09_page109 | 关于我们 | pf-profile |
| theme09_page110 | 企业掘影 | pf-gallery |
| theme10_page011 | 配置明细 | allocation |
| theme10_page019 | 能力对照 | capmatrix |
| theme10_page021 | 目标进度 | goals |
| theme10_page025 | 数据仪表盘 | dashboard |
| theme10_page029 | 收益分布 | distribution |
| theme10_page033 | 运作机制 | steps |
| theme10_page035 | 闭环循环 | cycle |
| theme10_page036 | 职责泳道 | swimlane |
| theme10_page043 | 横向影像带 | strata |
| theme10_page044 | 持仓小图集 | spark |
| theme10_page045 | 引述清单 | testimonials |
| theme10_page048 | 影像贴墙 | pinboard |
| theme10_page050 | 满版角嵌 | inset |
| theme10_page056 | 大字指标 | bigstat |
| theme10_page057 | 巨幅数字 | megafigure |
| theme10_page060 | 区间对比 | range |
| theme10_page061 | 极坐标花瓣 | polar |
| theme10_page064 | 区域敞口 | cartogram |
| theme10_page065 | 行情板 | board |
| theme10_page072 | K线蜡烛 | candles |
| theme10_page075 | 条款明细 | schedule |
| theme10_page077 | 图注精读 | captioned |
| theme10_page080 | 象形占比 | isotype |
| theme10_page083 | 同心环 | radialstack |
| theme10_page087 | 权衡天平 | balance |
| theme10_page090 | 资产拼花 | quilt |
| theme10_page091 | 蜂窝指标 | hive |
| theme10_page093 | 圆形图集 | medallions |
| theme10_page094 | 名词释义 | glossary |
| theme11_page001 | 封面 · 海报 | page1 |
| theme11_page002 | 封面 · 满铺图 | page2 |
| theme11_page003 | 封面 · 陈述 | page3 |
| theme11_page004 | 封面 · 分栏 | page4 |
| theme11_page005 | 封面 | page5 |
| theme11_page006 | 序章 | page6 |
| theme11_page007 | 纲目 | page7 |
| theme11_page008 | 大势 | page8 |
| theme11_page009 | 图景 | page9 |
| theme11_page010 | 主张 | page10 |
| theme11_page011 | 方法 | page11 |
| theme11_page012 | 实证 | page12 |
| theme11_page013 | 渠道 | page13 |
| theme11_page014 | 成果 | page14 |
| theme11_page015 | 漏斗 | page15 |
| theme11_page016 | 案例 | page16 |
| theme11_page017 | 见证 | page17 |
| theme11_page018 | 价值 | page18 |
| theme11_page019 | 格局 | page19 |
| theme11_page020 | 服务 | page20 |
| theme11_page021 | 路线 | page21 |
| theme11_page022 | 图辑 | page22 |
| theme11_page023 | 流程 | page23 |
| theme11_page024 | 诊断 | page24 |
| theme11_page025 | 对比 | page25 |
| theme11_page026 | 清单 | page26 |
| theme11_page027 | 套餐 | page27 |
| theme11_page028 | 原则 | page28 |
| theme11_page029 | 作品 | page29 |
| theme11_page030 | 行动 | page30 |
| theme11_page031 | 能力 | page31 |
| theme11_page032 | 对照 | page32 |
| theme11_page033 | 团队 | page33 |
| theme11_page034 | 指标 | page34 |
| theme11_page035 | 账目 | page35 |
| theme11_page036 | 拆解 | page36 |
| theme11_page037 | 宣言 | page37 |
| theme11_page038 | 观点 | page38 |
| theme11_page039 | 叠加 | page39 |
| theme11_page040 | 拆解 | page40 |
| theme11_page041 | 影像 | page41 |
| theme11_page042 | 信任 | page42 |
| theme11_page043 | 异议 | page43 |
| theme11_page044 | 章节 | page44 |
| theme11_page045 | 数字 | page45 |
| theme11_page046 | 节拍 | page46 |
| theme11_page047 | 留存 | page47 |
| theme11_page048 | 优先级 | page48 |
| theme11_page049 | 路线 | page49 |
| theme11_page050 | 覆盖 | page50 |
| theme11_page051 | 对比 | page51 |
| theme11_page052 | 证言 | page52 |
| theme11_page053 | 飞轮 | page53 |
| theme11_page054 | 趋势 | page54 |
| theme11_page055 | 主张 | page55 |
| theme11_page056 | 数字 | page56 |
| theme11_page057 | 明细 | page57 |
| theme11_page058 | 案例集 | page58 |
| theme11_page059 | 构成 | page59 |
| theme11_page060 | 痛点 | page60 |
| theme11_page061 | 蜕变 | page61 |
| theme11_page062 | 层级 | page62 |
| theme11_page063 | 现场 | page63 |
| theme11_page064 | 排行 | page64 |
| theme11_page065 | 封面 | page65 |
| theme11_page066 | 跃迁 | page66 |
| theme11_page067 | 术语 | page67 |
| theme11_page068 | 序列 | page68 |
| theme11_page069 | 收束 | page69 |
| theme11_page070 | 旅程 | page70 |
| theme11_page071 | 量级 | page71 |
| theme11_page072 | 累计 | page72 |
| theme11_page073 | 全景 | page73 |
| theme11_page074 | 排期 | page74 |
| theme11_page075 | 达成 | page75 |
| theme11_page076 | 案例辑 | page76 |
| theme11_page077 | 下一步 | page77 |
| theme11_page078 | 主屏 | page78 |
| theme11_page079 | 构成 | page79 |
| theme11_page080 | 评分 | page80 |
| theme11_page081 | 标注 | page81 |
| theme11_page082 | 前后 | page82 |
| theme11_page083 | 金句 | page83 |
| theme11_page084 | 陈列 | page84 |
| theme11_page085 | 历程 | page85 |
| theme11_page086 | 破冰航道 | page86 |
| theme11_page087 | 谢幕 | page87 |
| theme12_page022 | 满版出血 / Full Bleed | fullbleed |
| theme12_page023 | 灯箱海报 / Lightbox | billboard |
| theme12_page033 | 规格清单 / Spec Sheet | specs |
| theme12_page034 | 名录榜 / Directory | directory |
| theme12_page039 | 对照 / Before · After | contrast |
| theme12_page041 | 价格 / Plans | pricing |
| theme12_page043 | 为什么是现在 / Why Now | whynow |
| theme12_page074 | 双联像 / Diptych | duo |
| theme12_page086 | 加入声浪 / Join Us | join |

## 其他说明

- 布局按主题成套：同一 slot 在不同主题下有对应页（如 theme01_page006 ↔ theme02_page006），选模板时优先查所选主题。
- label 为中文语义名，slot 为机器分类，AI 按内容匹配 label/slot。
- 重新生成：`node scripts/build-layout-catalog.cjs`
