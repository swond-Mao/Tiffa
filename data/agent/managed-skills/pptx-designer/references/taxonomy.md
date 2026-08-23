# 页级模板分类索引（taxonomy）

> 1020 个页级模板的**检索索引**（v2，2026-08）。配套 `layout-catalog.md`（详细清单）。
> **用途**：设计阶段选模板的唯一入口——按四层收缩，每页候选 3-8 个。

## 四层分类体系

```
L1 页面定位：封面 / 目录 / 章节过渡 / 正文 / 结束页
L2 内容类型：19 类（见下）
L3 布局族：  纯文字 / 多卡片N / 并列 / 流程 / 总分 / 左图右文 / 图表主视觉 / 大数字 / 金句 / 时间轴 / 网格画廊 / 排行表格
L4 候选：    具体 themeXX_pageNNN（含卡数/图数/容量）
```

## L1 定位类（直接挑，不查 L2）

| 定位 | 类 | 数量 |
| --- | --- | --- |
| 封面 | 封面 | 68 |
| 目录 | 目录/议程 | 12 |
| 章节 | 章节过渡 | 36 |
| 结束 | 附录/收尾 | 8 |

## L2 内容类型（正文页查这层）

| 内容类型 | 数量 | 典型 slot |
| --- | --- | --- |
| 大数字/KPI | 78 | bignum/statgrid/metrics/scorecard/bento |
| 图表·趋势 | 64 | trend/slope/stream/curve/peak/cumulative |
| 图表·构成占比 | 65 | donut/waterfall/stacked/mekko/mosaic/rose |
| 图表·分布比较 | 59 | bar/bubble/scatter/histogram/tornado/pareto |
| 图表·多维 | 95 | radar/heatmap/treemap/funnel/sankey/matrix/quadrant |
| 图表·时间/排期 | 40 | timeline/gantt/milestone/calendar/journey |
| 排行/表格 | 37 | ranking/table/ledger/register/scoreboard |
| 对比/对决 | 33 | versus/split/diptych/triptych/triad |
| 流程/路线/链 | 78 | process/roadmap/chain/flow/method/checklist |
| 观点/结论/金句 | 77 | quote/statement/manifesto/conclusion/outlook |
| 案例/特写 | 157 | case/profile/spotlight/editorial/showcase/hero |
| 图片/画廊 | 47 | gallery/grid/polaroid/masonry/team/collage |
| 雷达/风险/能力 | 22 | risk/riskchain/compliance/margin |
| 地区/区域 | 24 | region/geo/map/city/bay |
| 其他 | 20 | theme11 单字叙事页（弱语义，人工按需选） |

## L3 布局族定义与容量基准

| L3 族 | 判定特征 | 文本容量基准 |
| --- | --- | --- |
| 纯文字 | 无卡/图，段落为主 | 600-800 字 |
| 多卡片N | countBindings 卡数（min-max） | 每卡 80-120 字 |
| 并列 | 2-3 栏对等/对比 | 200-300 字 |
| 流程 | 步骤/箭头/路线 | 每步 40-80 字 |
| 总分 | 主结论 + 分项 | 50-100 + 分项各 60-100 字 |
| 左图右文 | 图 + 文字块 | 200-300 字 |
| 图表主视觉 | 图占 ≥50% B 区 | 80-120 字 + 洞察 |
| 大数字 | 巨型数字锚点 | 30-100 字 + 巨数字 |
| 金句 | 大字主张/引语 | 20-50 字 |
| 时间轴 | 里程碑/排期 | 每节点 30-60 字 |
| 网格画廊 | 图片墙/拼贴 | 图说各 20-40 字 |
| 排行表格 | 表格/榜单 | 每行 20-50 字 |

> 容量为 1280×720 逻辑坐标、默认字号估算；常用族人工校准中，长尾标「待评估」。

## 检索流程（强制，不可跳步）

0. **锁定主题（风格隔离）**：全篇先选一个 themePack（用户指定或按预设推荐，如 consulting→theme01），**L4 候选只在锁定主题内挑**，禁止跨主题混搭——模板按主题成套，跨主题选页必然风格不统一
1. **L1 定位**：封面/目录/章节/结束 → 直接查对应类挑
2. **L2 内容类型**：正文页按内容定位到 19 类之一
3. **L3 布局族**：在该类内按版式需求选族
   - **相邻页防撞**：排除上一页已用 L3 族；候选全被排除才回退上一族（须换 L4 模板）
4. **L4 候选 + 几何校验**：
   a. 先按内容规划**文字量/图量/条目数**（X 页=图表+300 字、4 卡、3 步骤…）
   b. `describeLayout` 查候选模板的 defaultProps/controls，核对字段结构（数组长度 min-max、文本字段）
   c. 按模板容量约束**改写设计稿**（文字量 ≤ 容量、条目数 ≤ 上限、每项文字 ≤ 字段容量）——禁止"照着格子硬填"
   d. 同类多选一（页标题等一致性保证）；优先卡数/图数落在模板约束内的候选
5. **校验**：data 数组长度 ≤ controls min-max；渲染后包围盒检查（内容占画布 ≥60%，无挤角落/超界）
6. 查不到合适 → 手搓 DSL（正常路径，不是降级）

> 已踩坑：跨主题混搭→风格不统一；不 describe 直接猜字段→渲染失效/文字漂移超界（如 theme09 缺 cells、theme12 缺 index、theme01_page043 是 left/right 对象）

## 使用红线

- 模板与内容冲突 → 换模板或手搓，**绝不改内容**
- 模板装不下内容 → 拆两页，不压缩内容
- 「其他」类尽量避免，确需用时人工评估
- 卡数/图数超出模板约束范围 → 换候选，不硬塞
