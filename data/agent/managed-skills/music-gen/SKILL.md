# music-gen — YuE2 出谱 + 出歌（ComfyUI）

从「歌词 + 曲风」到成品 flac。**两段式：先出 ABC 谱，再按谱出音频。**
谱不是副产品 —— 它是后面 MV 唱词时间轴的锚，必须落盘归档。

本技能**自带驱动，不依赖 comfyui-video-gen**：端点发现、Basic Auth、ffprobe、
合法帧数吸附在本目录各有一份。已验证与项目版输出逐字节一致（仅文件名行不同）。

```
make_song.py                出谱 / 出歌 / 自检
tools_lyric_timeline.py     唱词时间轴（排分镜之前先跑这个）
tools_probe_abc_dialect.py  核对谱是否符合官方 ABC 方言
templates/                  segmap / style / lyrics 三份样例
```

```bash
cd <本技能目录>
PY=D:/AI/COMFYUI/python/python.exe
$PY make_song.py score --seed 88042                   # 只出谱，不跑扩散，省 GPU
$PY make_song.py song  --score scores/xxx.txt --copy  # 按谱出歌，flac 复制进 song/
$PY make_song.py check --score scores/xxx.txt         # 只读自检，绝不 POST /prompt
$PY tools_lyric_timeline.py --score scores/xxx.txt --audio song/xxx.flac --seg-map templates/segmap.example.json
```

输入约定（优先单文件歌本）：`song/<SONG_NAME>.txt`，内含 `[STYLE]` 与 `[LYRICS]` 两段；
没有歌本才回退 `song/style.txt` + `song/lyrics.txt`。样例在 `templates/`。
`--seg-map` 在时间轴工具里**必填**。

ComfyUI 端点解析顺序：`COMFY_H3_URL` / `COMFY_URL` → `comfy-endpoint.txt`
→ `127.0.0.1:8188`。公网端点需 `COMFY_USER` / `COMFY_PASS`（Basic Auth）。

**解析到公网地址又没设凭据时，自动退回 `127.0.0.1:8188`**（本机与远端是同一台
ComfyUI，本机免认证）。这条回退不能省 —— 少了它，没设凭据的环境直接 401，
看着像服务器挂了。模型根目录取 `COMFY_ROOT`，默认 `D:/AI/COMFYUI/ComfyUI`。

换一首歌只改 `make_song.py` 顶部三行（或设同名环境变量）：
`YUE2_CKPT` / `SONG_SEED` / `SONG_NAME`。`SONG_NAME` 决定歌本文件名与产物命名前缀。

冒烟验证（不占 GPU）：`$PY make_song.py check` —— 拉 `/object_info` 核 9 个 class
与工作流 schema，绝不提交 `/prompt`。本机实测 9/9 OK。

## 两段工作流（别合成一段跑）

```
score:  CheckpointLoaderSimple → YuE2GenerateABC → SaveText
song:   YuE2GenerateABC 的谱 + style + lyrics
        → YuE2GenerateMusic → EmptyYuE2LatentAudio
        → KSampler(+ConditioningZeroOut 作 negative)
        → VAEDecodeAudio → SaveAudioAdvanced
```

必须分开的两个理由：
1. 谱要**人看一眼**（段结构、BPM、调性、小节数）才能定 `max_duration`；
2. 谱要归档，供 `tools_lyric_timeline.py` 推唱词时间轴。

`mode` 两个取值：`full`（双声部完整谱）/ `melody`（只旋律线）。

## 节点字段与本机跑通的取值

`YuE2GenerateABC`：
`clip, style, lyrics, seed, mode, max_abc_tokens=8192, temperature=0.7, top_p=0.9,`
`top_k=30, repetition_penalty=1.005, penalty_window=100`

`YuE2GenerateMusic`：
`clip, style, lyrics, abc, seed, mode, max_duration, temperature=1.0, top_p=0.95,`
`top_k=100, repetition_penalty=1.2, cfg_scale=1.0`

`KSampler`：`steps=32, cfg=1.0, sampler_name=dpm_2, scheduler=sgm_uniform, denoise=1.0`，
negative 走 `ConditioningZeroOut(YuE2GenerateMusic 的条件输出)`。

模型：`yue2_3b_int8_convrot.safetensors`（`CheckpointLoaderSimple.ckpt_name`）。

## `max_duration` 必须留余量

```
md = max(60, round_up_to_10(est_sec * 1.35))
```

**给小了不会报错，歌会在中途被切掉**（唱到一半结束）。估算是 `est_sec`，见下节。

## ABC 时长估算：`ABC_K = 0.94`

```
每小节秒数 = M分子 * 4 / M分母 * 60 / BPM      # 对 6/8 等复合拍号也正确；L 不参与
谱估算     = 最长声部的小节数 * 每小节秒数
```

4 张真谱校准（`calibrate_abc.py`）：实测/估算 = **0.90~0.97，均值 0.94，离散 7.6%**。
第 5 点（本片 `gaitian_88042_x_285s.txt`）：估算 285.41s / 实音频 277.48s = **0.972**，
落在区间上沿 —— 说明 `ABC_K` 对慢速民谣偏保守，`real_sec` 只能当参考，**别拿它当真实时长**。

两个把估算带偏的坑：
- **`Z4|` 是 4 小节只含 1 个 `|`**。按 `|` 数小节会漏掉全部压缩休止 —— melody 谱的伴奏
  几乎全是 `Z`，误差最大到 **20 倍**。
- **`^V:` 出现次数是声部切换次数**（实测 12~38），**不是声部个数**（真值 2）。

按声部分组累计、取最长声部，才对。

**两个工具数的小节数不一样，这是有意的**（本片实测：`Vocal` 87 / `Ins` 88）：

| 用途 | 该数哪个 | 为什么 |
|---|---|---|
| 整曲时长 / `max_duration` | **最长声部**（88） | 伴奏比人声多一小节是常态，取短了会切尾 |
| 唱词时间轴（`tools_lyric_timeline.py`） | **`Vocal` 声部**（87） | 唱词只跟着人声走，用伴奏小节数会把段边界整体推后 |

两者差一小节（本片 3.24s）。**别把它们当成同一个数去对齐。**

## 收产物：不能用等视频的那套 `wait()`

`/history` 实证键名：

| 节点 | 产物键 | 备注 |
|---|---|---|
| `SaveAudioAdvanced` | `audio`（**单数**） | 项含 `filename` / `subfolder` |
| `SaveText` | `text` + `files` | `text` 是谱内容字符串本身；`files` 项字段是 `filename` |
| `VHS_VideoCombine` | `gifs` | 只有视频节点用这个 |

拿只认 `gifs` 的 `h3video.wait()` 等音频/文本 → **一路轮询到超时，而实际早就跑完了**。
自己按 `want` 类型收。

## seed 决定旋律，不是决定音质

`SEED` 固定 → 复现**同一份谱**。换 seed = 换旋律，不是换混响。
谱文件名带 seed 和估算秒数：`gaitian_<seed>_x_<est_sec>s.txt`。

## 谱和音频必须成对归档（这条是血案换来的）

本项目最终成片用的音频是 `F:\下载\YuE2_00028.flac`（264.96s），而 `scores/` 里
**没有任何一份谱的估算值接近它**（最接近的是 285s 那份）→ 现在推不出那一版的时间轴。

规则：
- 出歌必带 `--copy`，flac 落到 `song/`；谱落 `scores/`；
- 两边文件名前缀一致（seed + 秒数），**任何一版音频都要能反查它的谱**；
- 音频一旦换（重渲、换 seed、外部下载），谱必须同步换，否则下游全错位。

## 曲风 style prompt

官方样例（逐字，`examples/song.json`）：

```
English, warm piano pop, expressive female voice, acoustic piano, rounded bass and light drums, lyrical memorable melody, unhurried phrasing, 88 BPM
```

官方顺序：**语言 → 流派 → 人声 → 乐器逐件 → 旋律特质 → 唱法节奏特质 → BPM**。
形态是**一条逗号分隔的英文串** —— 不是 JSON、不是段落、没有 tag 语法。

本机跑通的那条（本片《改天》，362 字节）：

```
slow acoustic singer-songwriter folk, one husky low middle-aged male voice,
conversational intimate delivery, fingerpicked steel-string guitar,
harmonica solo interlude, upright bass, soft frame drum and brushed hand
percussion only, sparse minimal arrangement, dry close-mic vocal,
76 bpm, G major, western folk, no flute, no orchestral strings, no heavy drums
```

对照官方样例，本机这条**差两处、多一处**：

| 维度 | 官方 | 本机 | 下首歌怎么做 |
|---|---|---|---|
| 开头声明语言 | `English,` 放第一位 | 没写 | **开头写 `Chinese,`** —— 官方把语言当第一维度 |
| 旋律特质 | `lyrical memorable melody` | 缺 | 补一句（如 `plain singable melody`），官方把旋律当独立维度 |
| 排除项 `no X` | **官方样例里没有** | 有 3 条 | 本机经验、非官方规范；实测有效（不写就会来 flute/弦乐/重鼓），保留 |

要点：
- **写英文。** 官方样例是英文；中文曲风本机没验证过。
- **BPM 放末尾**是官方写法（本机放中间也跑通，按官方顺序更稳）。
- style 里的 BPM/调性只是**引导**，真实值以谱里的 `Q:` / `K:` 为准 ——
  本片 style 写 `76 bpm`，谱实际是 `Q:1/4=74`。
- 中文歌词是正路：YuE v1 论文的评测集 WildSongBench 是 192 条提示词 = **94 中文 + 98 英文**。

来源（一手）：仓库 `multimodal-art-projection/YuE`（**不是 HKUDS**），YuE2 是当前主线、
YuE v1 在 `YuE-v1` 分支；官方自带 `skills/yue2-music/`（含 ABC 方言规范）；
YuE2 论文 arXiv 2609.33757，YuE v1 论文 arXiv 2503.08638；
ComfyUI 节点是**核心内置**（`comfy_extras/nodes_yue2.py`），不是第三方包。

## 歌词 / 歌本格式

单文件 `song/<歌名>.txt`：

```
[STYLE]
<一条 style>
[LYRICS]
[Verse]
那时候的晚自习 窗外是街机的霓虹
...
```

- `[STYLE]` / `[LYRICS]` **必须独占一行**才认。
- 歌词体本身含 `[Verse]` / `[Chorus]` 等段标记，所以 `lyrics` = 最后一个标记之后的全部。
- 没有歌本时回退读 `style.txt` + `lyrics.txt`。

## 自检（不占 GPU，每次换环境先跑）

```bash
$PY $S check --score scores/xxx.txt
```

拉 `/object_info` 比对 9 个 class 是否注册、输入名是否在 schema 内、有没有缺必需口，
**绝不提交 `/prompt`**。换机器 / 更新节点包之后先跑这个再跑生成。

## 和 MV 的衔接

谱 → `tools_lyric_timeline.py`（本目录自带，不 import 任何项目模块）→ 唱词时间轴 → 分镜。

两条使用要点：

- **合法帧数吸附在本目录自带一份**，语义与 `h3video.pick_frames` 一致：帧数 ≡5 (mod 17)、
  最短 124、**取最接近**、`--cap` 是硬上限。独立部署时若退化成「只进不舍」，
  每一镜会被拉长最多 0.7s（实测 158 → 175 帧），末段可能越过歌尾缺音。
- **行末时间是最后一个音的起振（attack），不含它的延音** —— 跨小节续音的真实可听尾音更晚。
  要精确到「尾音结束」得另外记录每个音的结束时间。

YuE2 输出的谱（本机实测 + 官方方言核对，探针 `tools_probe_abc_dialect.py`）：

- 声部头逐字是 `V: Vocal clef=treble name="Vocal Melody" snm="Vocal"` /
  `V: Ins clef=treble name="Ins Melody" snm="Inst."` —— **不是** `V:1` / `V:2`。
  解析器按 `^V:\s*(\S+)` 取声部名，取到的是 `Vocal` / `Ins`。
- 段标记用 `%`：实测 `% intro` `% verse` `% chorus` `% interlude` `% outro`
  （官方文档还列了 `% bridge`，本片没出现）。
- **和弦符号写在 `Vocal` 声部**，即使该声部正在休止（官方：和声靠引号符号表达，
  `Ins` 不是钢琴和弦表）。本片只有 `C / D / Em / G`，全在官方原生词表内。
- **官方拒绝的构造，本片谱一个都没有**：tuplets、反复记号、跳越记号、slurs、
  `w:` 歌词字段、装饰音 —— 所以下游解析器不用处理这些，遇到就说明谱不是 YuE2 原生产物。
- **某段的 Vocal 可能全是休止**（纯器乐尾奏）—— 那段没有唱词，别硬推时间轴。

**数音符必须合并 tie**（官方明确：数 tie 合并后的**发声音符**，不是原始 token）：

- 本片谱有 14 个 `-`，全是跨小节续音（`D2-|D4`）。`C8-C8` 是**一个**音，
  `C8C8` 是**两个**音（官方：后者改变了断句）。
- 按 raw token 数会把续音当成新音：Vocal 404 token → 合并后约 390 发声音符，
  对 378 音节，比值从 1.069 降到 **约 1.03** —— 「音符 ≈ 音节」这个假设其实更准，
  但**前提是先合并 tie**。
- 官方原话级别的风险：`one phoneme does not equal one note`（转音存在）。

官方还给了两条本机没用到但值得记的：

- `mode` 在官方 API 里叫 **`cot`**，取值 `full` / `melody`；做 cover 时官方要求
  用**去掉和弦符号**的 ABC + `cot="melody"`。
- 官方同样要求归档：source + edited ABC、prompts、lyrics、decoder identity、
  seeds、validation records、audio —— 和上面那条血案规则同款。
- 要从**现成音频**反推谱/时间轴，官方路线是 **SheetSage2**（`m-a-p/SheetSage2`，
  可转录成谱、可渲染 PDF/SVG）。但官方也警告：它的转录误差不能当成生成器本身的错误。
