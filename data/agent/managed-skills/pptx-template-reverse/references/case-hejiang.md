# 案例：合江县人民医院汇报主题（2026-08）

> ⚠️ **路径自包含提示**：文中 `source`/`output` 路径（C:/Users/swond、G:/Tiffa）为案例当时环境，Tiffa 便携安装盘符不固定，实际使用请按当前 PORTABLE_ROOT 替换；`hejiang-config.json` 同理。



> 完整跑通案例：WPS 导出"完整版式.pptx"（5 示例页 + 2 master）→ 7 版式主题模板 + 20 页 deck。
> 产物：`合江县人民医院汇报主题.pptx`（7 版式）+ `健康体重管理中心建设项目汇报.pptx`（20 页），WPS 直接套用验证。

## 源模板设计系统（probe 提取结论）

- 画布 10×5.625in；字体全篇**微软雅黑**（msyh/msyhbd）
- 色板：标题黑 #1A2230 / 主蓝 #0E3F8C / 副蓝 #1E4FA8 / 亮蓝 #3D7BD9 / 石板灰 #4A5568 / 浅灰 #8B97A8 / 金橙 #F5A623 / 浅蓝 #E8EFF8 / 卡底 #F5F7FA / 青 #1B7A9E
- 装饰资产（media）：image1.png logo+院名 409×95 / image2.png 金橙弧线带 2200×399 / image3.png 封面蓝浪背景 / image4.png 院 logo 19KB
- 版式层：底部金橙弧线带 + 标语"仁心赤诚 守护健康"(7.81, 5.13)；右上 logo image4 @(7.24,0) 2.76×0.64；同心圆 #3D7BD9 @(7.89,0) 2.5/1.8/1.12/1.09in；左下装饰块 @(0.98,3.98) 1.56×1.17 #1E4FA8

## 主题模板构建（theme_config.json 实例）

```json
{
  "source": "C:/Users/swond/Desktop/完整版式.pptx",
  "output": "G:/Tiffa/workspace/体重管理中心/合江县人民医院汇报主题.pptx",
  "delete_sample_slides": true,
  "master_index": 0,
  "layout_ops": [
    {"type": "rename", "name": "内容页", "to": "纯空白"},
    {"type": "rename", "name": "标题和内容", "to": "内容页"},
    {"type": "rename", "name": "标题幻灯片", "to": "封面"},
    {"type": "rename", "name": "DEFAULT", "to": "空白"},
    {"type": "modify", "name": "内容页", "remove_ph_types": [],
     "add_title_ph": [0, "页标题", 0.95, 0.255, 5.5, 0.36, "页标题", 16, "1A2230", "bold", "l", "ctr"],
     "add_body_ph": [1, "版芯", 0.60, 0.85, 8.80, 2.80, "", 14, "4A5568"],
     "add_shapes": [
       {"kind": "pic", "source": "image4.png", "x": 7.24, "y": 0, "w": 2.76, "h": 0.64, "name": "医院logo"},
       {"kind": "line", "x": 8.91, "y": 0, "w": 1.09, "fill": "1E3A5F", "h": 0.06, "name": "topline1"},
       {"kind": "line", "x": 8.91, "y": 0.06, "w": 0.7, "fill": "3B82F6", "h": 0.03, "name": "topline2"},
       {"kind": "rect", "x": 7.89, "y": 0, "w": 2.5, "h": 2.5, "fill": "3D7BD9", "alpha": 7, "prst": "ellipse", "name": "circle1"},
       {"kind": "rect", "x": 8.24, "y": 0.35, "w": 1.8, "h": 1.8, "fill": "3D7BD9", "alpha": 9, "prst": "ellipse", "name": "circle2"},
       {"kind": "rect", "x": 8.58, "y": 0.69, "w": 1.12, "h": 1.12, "fill": "3D7BD9", "alpha": 12, "prst": "ellipse", "name": "circle3"},
       {"kind": "rect", "x": 8.75, "y": 0.94, "w": 1.09, "h": 1.09, "fill": null, "line": "3D7BD9", "line_w": 1.0, "prst": "ellipse", "name": "circle4"},
       {"kind": "rect", "x": 0.31, "y": 4.38, "w": 1.56, "h": 1.17, "fill": "1E4FA8", "alpha": 10, "name": "cornerL"},
       {"kind": "line", "x": 0, "y": 5.59, "w": 1.41, "fill": "1E3A5F", "h": 0.03, "name": "botline"}
     ]},
    {"type": "modify", "name": "封面", "remove_ph_types": ["title", "body", "subTitle", "ctrTitle", "dt", "ftr", "sldNum"],
     "insert_bg": {"kind": "pic", "source": "image3.png", "x": 0, "y": 0, "w": 10.0, "h": 5.625, "name": "coverbg"},
     "add_shapes": [
       {"kind": "pic", "source": "image4.png", "x": 7.24, "y": 0, "w": 2.76, "h": 0.64, "name": "coverlogo"},
       {"kind": "rect", "x": 0.62, "y": 1.62, "w": 0.08, "h": 0.75, "fill": "1E4FA8", "name": "coverbar"},
       {"kind": "rect", "x": 0.94, "y": 4.61, "w": 3.28, "h": 0.5, "fill": "E8EFF8", "line": "1E4FA8", "line_w": 1.0, "adj": 50000, "name": "datechip"}
     ],
     "add_ph": [
       [111, "会议标题", 0.94, 0.75, 7.03, 0.31, "会议标题", 12.4, "4A5568", false, "l", "ctr"],
       [0, "主标题", 0.94, 1.64, 7.81, 0.86, "主标题", 32.65, "1A2230", "bold", "l", "ctr"],
       [112, "副标题", 0.94, 2.58, 7.81, 0.47, "副标题", 19.15, "1E4FA8", "bold", "l", "ctr"],
       [113, "阐述", 0.94, 3.28, 6.25, 0.94, "阐述", 12.4, "4A5568"],
       [114, "日期落款", 0.94, 4.61, 3.28, 0.5, "落款", 12.4, "0E3F8C", "bold", "ctr", "ctr"]
     ]},
    {"type": "clone", "source": "内容页", "name": "章节页", "remove_ph_types": ["body"],
     "add_ph": [
       [102, "章节号", 0.62, 1.17, 1.41, 1.41, "01", 54, "0E3F8C", "bold", "ctr", "ctr"],
       [103, "节标题", 2.34, 1.48, 7.03, 0.55, "节标题", 26.45, "1A2230", "bold", "l", "ctr"],
       [104, "节副标题", 2.34, 2.12, 7.03, 0.31, "节副标题", 13.5, "4A5568", false, "l", "ctr"],
       [105, "节阐述", 2.34, 2.89, 6.25, 1.50, "节阐述", 14.65, "1A2230"]
     ],
     "add_shapes": [
       {"kind": "rect", "x": 0.62, "y": 1.17, "w": 1.41, "h": 1.41, "fill": "E8EFF8", "adj": 12000, "name": "numChip"},
       {"kind": "line", "x": 2.34, "y": 2.58, "w": 6.25, "fill": "1E4FA8", "name": "chapline"}
     ]},
    {"type": "clone", "source": "内容页", "name": "封底页", "remove_ph_types": ["body"],
     "add_ph": [
       [106, "封底标题", 0.94, 1.25, 7.81, 0.86, "封底标题", 27, "1A2230", "bold", "l", "ctr"],
       [107, "封底副标题", 0.94, 2.26, 7.03, 0.47, "封底副标题", 14.65, "4A5568", false, "l", "ctr"],
       [108, "封底阐述", 0.94, 3.28, 7.03, 0.47, "封底阐述", 13.5, "0E3F8C", "bold", "l", "ctr"],
       [109, "会议标题", 0.94, 3.82, 7.03, 0.31, "会议标题", 11.25, "8B97A8", false, "l", "ctr"],
       [110, "致谢", 0.94, 4.37, 2.19, 0.44, "谢谢聆听 敬请指正", 12.4, "0E3F8C", "bold", "ctr", "ctr"]
     ],
     "add_shapes": [
       {"kind": "rect", "x": 0.62, "y": 1.32, "w": 0.08, "h": 0.70, "fill": "1E4FA8", "name": "endbar"},
       {"kind": "line", "x": 0.94, "y": 2.96, "w": 6.09, "fill": "1E4FA8", "name": "endline"},
       {"kind": "rect", "x": 0.94, "y": 4.37, "w": 2.19, "h": 0.44, "fill": "E8EFF8", "line": "1E4FA8", "line_w": 1.0, "adj": 50000, "name": "thanks"}
     ]}
  ]
}
```

## 结果

- master0 7 版式：空白 / 内容页[0,1] / 封面[0,111,112,113,114] / 仅标题[0,10,11,12] / 纯空白 / 章节页[102-105] / 封底页[106-110]
- master1 保持：DEFAULT / 标题和内容 / 标题幻灯片
- 无重复 part；20 页 deck 基于此模板构建，QA 联系图 20 页无溢出碰撞

## 经验

1. 源模板"标题幻灯片"版式自带 5 个默认占位符（ctrTitle/subTitle/dt/ftr/sldNum）→ 改造前 `remove_ph_types` 必须列全 7 种 type，清干净
2. 封面背景图必须 `insert_bg`（插入 spTree index=2 最底层），append 会盖在文字上
3. 同心圆用低 alpha ellipse（7-12%），WPS 渲染稳定
4. 页码"NN / 20"放 deck 层（page_no helper），不进版式——模板复用页数会变
5. 版式里不放页码占位符（ph idx 12），否则每页都要 drop
6. **改名顺序**：源模板已存在空版式"内容页" → 必须先把原"内容页"改名"纯空白"，再把"标题和内容"改名"内容页"，全程名字唯一，避免 rename 命中错位
7. **构建顺序**：theme_lib.build 先执行 layout_ops 再删示例页——iter_parts() 是图遍历，先删页会让 slide 独占的 image part（如封面背景 image3）失去可达性，find_image_part 找不到
8. 便携版 Python 3.13 的 sys.path 不含脚本目录 → 入口脚本须 `sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))` 引导
