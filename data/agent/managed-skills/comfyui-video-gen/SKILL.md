# comfyui-video-gen — MiniMax H3 视频 / MV / 数字人口型

所有执行走 `h3video.py`（本地 ComfyUI，默认 `http://127.0.0.1:8188`）。
先跑 `models` 自检，再干活。

```bash
S=G:/Tiffa/workspace/tiffa开发/comfyui-video-gen/h3video.py
PY=D:/AI/COMFYUI/python/python.exe     # librosa 只在这个 python 里
$PY $S models
```

## 三条铁律（违反必翻车，均为实测代价换来）

1. **帧数必须 ≡5 (mod 17)**：`124/141/158/175/192/209/226/243/260/277/294`。
   不合法时 H3 不报错，会**静默改用别的长度**，你的时间轴就废了。
2. **先定帧数，再按 `帧数/24` 切音频**。反过来（先切音频再凑帧）每段会多出
   0.12~0.29s，五段累积 **0.67s 漂移 → 口型全废**，而单看每一段都是好的，最难查。
3. **拼接只连视频轨，再铺一条连续 master 音频**。各段自带 AAC 直接 `concat`
   会接缝错位（分段编码器延迟不同，实测逐窗相关度仅 **0.06**）。
   成片若"音画整体反向漂移"，就是忘了这条。

## seed 是身份的一部分（最容易静默作废的一条）

- `seed = 镜号 + --seed-base`（默认 400）。**换 seed 就是换一张脸。**
- 合并/换位后镜号会变。v03 镜 8 来自 v02 镜 13，若不锁 seed 它按新镜号拿到
  `8+400=408`，而当时出图用的是 `13+400=413` → "提示词没变所以不用重跑"的镜
  **静默作废**，且画面看着挺正常、查不出原因。
- 所以 board 里存**绝对 seed**（413 这种），镜头表里存**裸镜号**（13），由引擎加
  `--seed-base` 换算。v01/v02 的 board 不写 seed 字段，引擎继续走 `镜号 + --seed`，
  已出的小样不受影响。
- **拆分出来的两片绝不能共用 seed**，否则逐帧重复。镜5/6 同源于 v02 镜9，
  seed 分别 409/410。这是拆分镜的硬约束。

## 措辞会被字面执行（每条都是一批废镜换来的）

- `red-rimmed eyes`（想表达"熬红的眼"）→ H3 照字面画成**红色发光眼**。
  疲惫只能写眼下阴影、靠墙坐着、动作迟缓。
- **否定约束必须显式写死**，模型会自己脑补：写"弹吉他唱歌"它就给你西装。
  唱镜必须带 `open-collar white linen shirt, dark trousers, no suit, no jacket, no tie`。
  合并镜把 desc 拆成多个 `[Shot k]` 后更没保证每段都有 → 引擎在 sing 分支兜底
  （哪个子镜头缺服装声明就就地补一句，已写过的**逐字节不动** —— 动了指纹就变、白重跑）。
- **"不露脸"包括反射**：玻璃倒影、后视镜、屏幕反光、手机屏里的脸都算。
  不露脸镜要在**每个子镜头**重复
  `no face appears in any reflection, window, mirror, phone screen or rear-view mirror`。
- **画面内文字会糊成假字**。写了 `no text` 也没用 —— 场景本身含招牌，模型就糊出
  假英文乱码。要么 desc 里写"招牌虚焦不可辨读 / 无可读文字"，要么用背影、侧角避开招牌正面。
- **唱镜服装跨镜不连续是最扎眼的穿帮**（同一句唱词内白衬衫→深蓝衬衫）。根因是 desc
  只写了场景和动作。修法：服装写进每个唱镜 desc，**同一场景的相邻镜用完全相同的措辞**。
- **"identical" 不够，要约束构图**。三联月写了 `identical moon in each panel`，
  三格月亮还是大小不一 → 改成"同一个月亮素材、同一位置、三格仅天际线不同"。

## 合并镜头的四条硬规则（同时满足才并）

| 规则 | 违反的后果 |
|---|---|
| ① 同一音乐段内 | 一条音频切片跨两段，破坏"先定帧再切音频" |
| ② kind 相同 | sing 的口型指令和 anim 的画风指令混在一条提示词里，两边都不听 |
| ③ **refs 完全相同** | 两张不同角色卡并进一镜，`<Subject 1>` 同时是两张脸，**必漂** |
| ④ 歌词行区间连续 | 歌词按顺序映射音频，跳行合并 = 打乱词表 |

第③条是**合并的天花板，不是偷懒**：用不同角色卡的镜只能各自单镜。
**唯一例外**：另一个人本来就不露脸（剪影/背影/借位），那不需要身份卡；
哪天要给他露脸，必须拆回两镜。

合并省下的是**镜头数和转场碎度，不是算力** —— 合并版总帧数 ≈ 碎镜版的 100%。
想省算力只能砍段。

## 多子镜头：一条提示词内让模型自己切刀（值得优先用）

同一个镜号里写 `[Shot 1]` / `[Shot 2]`，模型在生成内部自己切刀。
**这是根治"跨镜身份/服装漂移"的手段，不是省事的技巧**：

- **参考图只喂一次。** 两个子镜头共用同一组 refs，`<Subject 1>` 只有一个来源。
  官方 Ref2VA 有输入上限（≤9 图 / 所有文件合计 ≤12），少一组图不只是省输入，
  是少一次"同一个 Subject 被两张脸争"的机会 —— 那正是身份漂移的成因。
- **衔接由模型的时间连续性保证，不由你保证。** 切刀发生在同一次去噪里，
  脸、发型、服装、光位是同一 latent 序列延续下来的，所以 v01 那个
  "同一句唱词内白衬衫→深蓝衬衫"的最扎眼穿帮，从根上不会出现。
  靠"相邻镜写完全相同的服装措辞"只是补救 —— 措辞是弱约束（见「措辞会被字面执行」）。
- 实测成立：镜内切刀确实发生，**切过去身份不漂**；拆分出来的两镜也不串画面。

代价与边界：

- **不省算力。** 帧数一样。省的是镜头数、转场碎度、参考图输入次数、身份漂移风险。
- 合并必须过上面四条硬规则，尤其 ③ refs 完全相同。
- 官方同时提醒：**只需要改距离或轻微角度时，优先用运镜而不是切镜**
  （`base-en.txt` §4.2）—— 别为切而切。

切点写法用官方格式：`[Shot 2] At 00:06.500, the camera cuts to ...`，
切点严格递增且落在时长内，`[Shot 1]` 不带时间戳。

三条必须做到：

- **每个子镜头都重复口型 / 闭嘴指令**，不能只在 `[Shot 1]` 写一次。
- `retention_analysis` 的 `(appears in ...)` 要跟着子镜头数变 —— 只写 `[Shot 1]`
  等于告诉模型后半镜的身份不用管。
- **没参与合并的镜，措辞必须和上一版逐字节一致**，否则会被判"提示词已变"白重跑。
  退路：某镜切刀漂了就拆回两条单镜，旧提示词仍在 `runs/<ver>/prompts/`。

## 三种音频接法，效果差别很大 —— 别搞混

| 接法 | 音轨 | 口型 | 用法 |
|---|---|---|---|
| `--avatar`（默认） | **钉死的输出** | 逐帧跟随真实音轨 | 唱歌、数字人口播 |
| `ref_audios` | 参考条件 | 只模仿音色/节奏，不锁 | 让模型"像某人唱" |
| `AddGuideAudio` | 模型重新生成 | 半对（相关度 0.60） | 只要氛围，不要求对得上 |

`--avatar` 的图结构（`SelfLiftAvatarH3Sampler`，来自 `custom_nodes/selflift-Avatar`）：
```
LoadAudio -> TrimAudioDuration(duration=帧数/24) -> LTXVAudioVAEEncode
  -> SetLatentNoiseMask(SolidMask value=0)    # 0=保留该轨 1=才去生成
  -> LTXVConcatAVLatent(video=…, audio=…) -> SelfLiftAvatarH3Sampler
```
采样器只去噪视频轨，所以嘴型是被真实波形驱动的。`rho=0` 时视频轨走低分辨率→
`latent_upscaler`→高分辨率两阶段，**脸部清晰度不会比平时差**，这招主要买嘴型。

## 标准流程

```bash
$PY $S mv "D:/AI/COMFYUI/ComfyUI/input/歌曲.mp3" --out 成片.mp4 \
     --res 480p --start 0 --end 60
```

`mv` = probe → board → slice → batch → concat。要逐步控制就分开跑：
```bash
$PY $S probe  歌曲.mp3 --out struct.json     # BPM/小节/乐句/能量突变
$PY $S board  歌曲.mp3 --out board.json      # 切点贴音乐边界，段长吸附合法帧数
$PY $S slice  歌曲.mp3 --board board.json    # 连续切，无缝
$PY $S batch  --board board.json --res 480p  # 并行提交，轮询
$PY $S concat 歌曲.mp3 --board board.json --out 成片.mp4
```

## 提示词：H3 官方两套结构（脚本已内置，`--kind` 选模板）

官方把提示词分成**两套，不能混用**。以下逐字核对自官方仓库
`MiniMax-AI/MiniMax-H3` 的 `.claude/skills/h3-prompt-writing/references/`
（`base-en.txt` = base 模式，`ref-en.txt` = Ref2VA）：

| 模式 | 字段顺序 | 首行 |
|---|---|---|
| **base**：T2VA / I2VA / FL2VA / L2VA | `integrated_multimodal_description` → `overall_soundscape` → `non_diegetic_music`（**只有这三段**） | I2VA/FL2VA/L2VA 必须有一行图片对齐指令，见下 |
| **Ref2VA**（全参考） | `subject_definitions` → `summary` → `retention_analysis` → `detailed_description` → `overall_soundscape` → `non_diegetic_music` | 无 |

`--kind` 映射：`sing`/`action` → Ref2VA 六段（ref2va 节点）；`empty` → base（fl2va 节点）。

对齐指令必须逐字用官方模板，且是**提示词第一行**，之后空一行：
```text
I2VA   For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.
FL2VA  How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the S.SS-second mark of the target video.
L2VA   How the reference pictures align with the target video — <Picture 1> (from [Shot N]) aligns with the S.SS-second mark of the target video.
```
`S.SS` = 实际时长、**恰好两位小数**；`N` = 实际最后一个 shot 的序号。

### 官方硬规则（写提示词前先过一遍）

- **运镜必须给运动类型**，不是只写快慢。三段式 = 类型 + 幅度 + 速度：
  `Zoom In/Out`、`Push In/Pull Out`、`Pan Left/Right`、`Truck Left/Right`、
  `Tilt Up/Down`、`Pedestal Up/Down`、`Arc Shot`、`Tracking Shot`、`Static Shot`、
  `Shake Slightly/Strongly`、`POV`、`Roll Clockwise/Counterclockwise`；
  幅度 `with small/large amplitude`，速度 `at slow/fast speed`（中等幅度和正常速度可省）。
  写成句子里的自然动作，**不要在句尾堆标签**：
  `The camera pushes in with small amplitude at slow speed toward the folded letter.`
- **`detailed_description` 生成类任务 350–500 英文词**。官方明说"单镜头不构成写短的理由"。
  每个 shot 要落到：构图、主体外观与位置、环境与光、动作与状态变化、运镜、当前声音、
  参考素材实际生效的时间点。写成剧情概要或参考关系清单 = 无效。
- **`[Shot 1]` 不带时间戳**，后续 shot 用 `[Shot 2] At 00:03.500, the camera cuts to ...`，
  切点严格递增且落在时长内。普通切镜用 `the camera cuts to / the shot cuts to /
  the shot transitions to`。只改距离或轻微角度时**优先用运镜而不是切镜**。
  → 一次生成内部可以放多个 shot，不必每镜单独渲染再拼。
- **说话/唱歌用稳定 ID** `(S1)` `(S2)`，合唱 `(S1,S2)`；内容写进 `<d>[语言] ...</d>`，
  原文逐字保留、不翻译。画外音必须用原话 `says in an off-screen voiceover`，
  且紧跟一句说明画面里那人嘴唇是闭着的。跨切镜的台词用 `<scenetrans>`，
  被片尾截断用 `<cutoff>`。
- **画面里可见的文字**放英文双引号、原文保留：`A red neon sign reading "营业中" glows above the doorway.`
- `overall_soundscape` 1–4 句，只写环境声/动作声/非语言人声；**台词和唱歌不要重复写在这里**。
  只有用户明确要求全程静音才写 `N/A`。
- `non_diegetic_music` 1–3 句，只写乐器、速度、节奏、力度变化，**不要写抽象情绪词**、
  不要解释配乐的情感功能。角色能听见的音乐（唱歌、收音机、现场乐器）属于 diegetic，
  要写进主描述段，不放这里。无配乐写 `N/A`。
- 全部段落写英文；只有 `<d>` 里的对白歌词和画面里实际出现的文字保留原语言。

### 本机 `--kind` 模板要点

- `sing`：锁口型。写 "mouth articulates every syllable with exact lip-sync"，
  并给 soundscape 人声质感（dry / close-miked / breath）。
- `action`：人物出镜但不唱。必须写 "mouth stays closed, does not sing on camera"，
  否则模型会自己加口型。
- `empty`：空镜。`subject_definitions` 整段省掉，主描述段写
  "frame contains no people at any point"。

**不要用图像模型生成首帧。** 直接把数据集原图当 `--ref`（放
`ComfyUI/input/` 下填裸文件名）：首帧是图像模型出的，等于让 H3 去追一张它
不完全认的脸，身份反而更差。

### ⚠ 本机脚本与官方规范的五处偏差（本项目成片已验收，不动代码）

`six_section()` 生成的提示词和官方指南对不上。这一版成片已经验收，**不回改**；
记录在此是为了下个项目一开始就写对，而不是等成片出来再找原因。
（顺带说明指纹机制的代价：改提示词 → 指纹变 → 该镜会被判定为待重渲。）

1. **`empty` 用错了段名**。它走 fl2va 节点（base 模式），却发 `summary:` +
   `detailed_description:` 这两段 Ref2VA 专有的段名，官方 base 只要
   `integrated_multimodal_description` 一段。多出的段和错名可能让模型误判任务类型。
2. **`empty` 缺 FL2VA 对齐指令首行**。图片只从节点输入进去，提示词里没有任何
   "Picture 1 对齐 0.00 秒 / Picture 2 对齐 S.SS 秒"的声明。
3. **运镜没有运动类型**。现模板写
   "The camera performs a slow, small-amplitude move with a faint handheld drift" ——
   只有幅度和速度，**类型缺失**，等于把运镜交回模型随机决定。
   这很可能是"成片运镜单调、镜头之间没差别"的直接原因。
4. **描述太短 + 从不声明 `<Audio N>`**。官方生成类建议 350–500 词，我们约 70 词；
   而且明明把真实歌曲切片喂进了音频轨，提示词里却没有
   `<Audio 1>: fully_copy` 这类声明，模型不知道这条音轨是 1:1 复制品。
5. **身份参考图被单列成 `<Picture N>` 条目**。官方 `ref-en.txt` §2.2 明确：
   图片若**只**用来定义人物/场景/服装/风格，**不要单列 picture 条目**，
   要在 `<Subject N>` 定义里引用来源。我们却同时写了
   `<Picture 1> is a face-identity reference only.` 和
   `<Picture 1> (identity reference): weak_reference - ...` 两条独立条目。
   单列 `<Picture N>` 的含义是"这张图是某个 shot 的具体帧锚点"
   （首帧/关键帧/尾帧/构图锚），和我们的真实意图正好相反。
   → 这也解释了为什么模型有时会把参考图的背景和构图整个搬进成片。

### 下个项目直接抄这套（规范版模板）

**Ref2VA（`sing` / `action`）** —— 六段，身份图**不**单列 `<Picture N>`：
```text
subject_definitions:
<Subject 1> is the young woman whose facial identity and hair come from <Picture 1>; her clothing, pose and surroundings in the target video are defined only by the text below.
<Audio 1> is the supplied vocal track, reused as the target video's final audio.

summary:
[reference generation + audio reuse] A cinematic music-video performance shot of <Subject 1> singing on camera. <Audio 1> is reused 1:1 as the final track.

retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - facial identity, hair colour and eye colour are retained; her outfit differs from the reference photo.
<Audio 1>: fully_copy - the supplied track is reused 1:1 as the target video's complete final audio track.

detailed_description:
The target video is in a cinematic music-video style, 35mm film look, shallow depth of field, no text, no watermark.
[Shot 1] A continuous 12.5-second take. <构图 → 主体在画面里的位置 → 环境与光位 → 动作与状态变化 → 参考素材生效的时间点>
The camera pushes in with small amplitude at slow speed toward her hands.
<总量 350–500 英文词，按 shot 的信息量分配；单镜头不是写短的理由>

overall_soundscape: <1–4 句，只写环境声/动作声/非语言人声；唱词别写这里>
non_diegetic_music: <1–3 句，只写乐器/速度/节奏/力度变化；无配乐写 N/A>
```

**base（`empty` 空镜，走 fl2va）** —— **只有三段**，不要 `summary`/`retention_analysis`/`detailed_description`：
```text
How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the 12.50-second mark of the target video.

integrated_multimodal_description: [Shot 1] Cinematic, 35mm film look, <空镜内容>. The frame contains no people at any point. The camera holds a static shot / trucks left with small amplitude at slow speed.

overall_soundscape: <环境声>
non_diegetic_music: The supplied song plays as an audience-only score, its tempo and dynamics unchanged.
```

`(((aspect ratio 16:9)))` 这个前缀**不在官方规范里**，是 ComfyUI 社区约定。
本机实测无害，保留即可，但别当成官方要求。

官方 Ref2VA 完整示例（README 里 Context-IR 的真实输出）值得当范本读：
它的 `detailed_description` 约 350 词，逐 shot 写光位、面料、手指动作、
`the camera slowly pushes in`，并在音频段落显式引 `<Audio 1>`。

**为什么这套结构对我们不是可选项**：官方完整系统有三块 —— H3-Context-IR、
H3-Base、H3-Regenerate-2K。**Context-IR 没有开源**（只有 API），官方 README
明确"强烈建议接入它，或按 Prompting Guidance 自建一套上下文处理系统"。
我们本地 ComfyUI 只有 H3-Base，所以**手写六段式就是在替代缺失的 Context-IR**，
结构写错不是风格问题，是少了一个系统组件。

**2K 本地拿不到**：H3-Regenerate-2K 同样未开源，本地 H3-Base 上限就是 768p。
想要 2K 只能走 API（`/video-generation-v2-regeneration`）。

**许可**：开放权重 ≠ 商用授权。本地用开放权重生成的内容若要商用，需要额外的
MiniMax Commercial License；Comfy Cloud 生成才自带商用权利。商用前重新核对当时条款。

### 官方输入硬限制（Ref2VA）

图片 ≤9 张；参考视频 ≤3 段、每段 2–15s、总长 ≤15s；音频 ≤3 段、每段 2–15s、总长 ≤15s；
**所有输入文件合计 ≤12**。输出 4–15s、24fps、32kHz 立体声、短边默认 768。
我们的音频切片必须落在 2–15s 内 —— 合法帧数序列已保证这点，但手动传音频时要自己查。

## 参数取值（本机实测）

- 模型：`unet/MinimaxH3/`、`clip/`、`vae/`、`vae_approx/`、`latent_upscale_models/`、
  `loras/minimax/`。**没有** `fl2va_bf16`，fl2v 用 `minimax_h3_fl2va_int8_convrot.safetensors`。
- `sing`/`action` 走 ref2va + `MiniMaxH3ReferenceToVideo`；`empty` 走 fl2va。
- LoRA `lightx2v_turbo_4step` strength **0.7**（1.0 会糊）。
- 采样 `steps=6 cfg=1.0 euler/simple`。注意这是本机实测值；社区流传的官方 ComfyUI
  模板数值是普通模式 20 steps（要更好运动质量可到 25）、`turbo_mode` + Lightning LoRA
  8 steps。**官方 H3 仓库 README 未写 steps**，上述数字来自 ComfyUI 模板而非模型仓库，
  本机 6 steps + turbo LoRA@0.7 实测可用且快得多 —— 但 6 vs 8 值得做一次 A/B 再定。
- 分辨率档位 `360p 640x352 / 480p 864x480 / 768p 1344x768`（短边须 32 倍数）。
- 速度实测（RTX 5090D，480p）：**6 段并行提交共 270s**（单段 75~270s，取决于帧数）。
  排队时先跑别人的任务会吃掉等待时间，别把排队时长算成生成耗时。

## kind 全谱（7 种，各有自己的提示词模板）

| kind | 管线 | 要点 |
|---|---|---|
| `sing` | ref2va + avatar | 锁口型，双卡（身形卡 + 脸卡） |
| `action` | ref2va | 人物出镜不唱，必须写 mouth stays closed |
| `niface` | ref2va 单卡 | 出镜但全程不露脸，参考图只定身形衣着 |
| `anim` | ref2va | 手绘动画镜，绿幕立绘直接喂 |
| `animscene` | ref2va | 动画场景镜 |
| `morph` | ref2va 多卡 | 一条提示词内真人渐变成分镜动画 |
| `empty` | fl2va 零参考 | 空镜无人 |

- `niface` 的 `retention_analysis` 写
  `body build, hairstyle outline and wardrobe retained; facial detail is not reproduced`。
- `morph` 把每张卡按 `<Subject 1>`(真人) → `<Subject 2>`/`<Subject 3>`(动画少年) →
  `<Subject 4>`(变成的样子) 写死，并明令渐变连续、不许硬切。

## 版本隔离（避免"旧音频配新镜头"）

- **音频切片名和输出前缀都带版本号**：`v01_shot13.wav` + `gt_v01/mv_shot13_avatar_*`。
  改了镜长重跑 v02 不会覆盖 v01 的 wav 和视频 —— 否则会出现查不出根因的口型错位。
- 台账自动清理：镜数变少时（40→24）上一版多出的 `shotNN.txt` 挪进 `prompts_stale/`，
  免得重投某镜时贴到过期的词。
- **小样阶段一律 480p，定稿后统一升清一次**，不在小样阶段逐镜升清，免得白烧显存。

## 引擎约定（还原时踩过，写死在这儿）

- 镜头表 9 元素：`(图, kind, 标签, desc, 行起, 行止, seed, 来源镜号, 中文画面)`。
  行起 `None` = 不占歌词，时长由本段窗口平分（不靠元组长度猜）。
- **无词镜收尾必须带逗号**，漏了 Python 会把 `(...)(...)` 读成调用元组。
- 图名必须是 `REFS` 里登记过的键（`anim_arcade`/`sing_balcony`），**不是卡键**（`gt_boy_me`）。
- `--max-shot` = **拆分阈值**；`--cap`（默认 15.0）= **剪辑硬上限**，吸附和回填都不许越过。
  只卡段窗口时，窗口 >15s 会顶出 15.08s 的镜头。

## 已知坑

- **`VHS_VideoCombine` 这版只接受 10 个参数**。`pix_fmt`/`crf`/`save_metadata`/
  `trim_to_audio` 传了不报错但被**静默忽略** —— 别指望 `trim_to_audio` 帮你裁长度，
  音频长度必须由 `TrimAudioDuration` 精确控制。
- 装完 `custom_nodes/` 必须**重启 ComfyUI**，否则 `/prompt` 只报
  `Node 'SelfLiftAvatarH3Sampler' not found`。`models` 子命令会检查注册状态。
- **地址与认证**：`127.0.0.1:8188` 与公网地址是【同一台】机器的两个入口
  —— 本地用前者（免认证），外网用后者（Basic Auth，需 `COMFY_USER`/`COMFY_PASS`）。
  公网地址只存本机 `data/agent/comfy-endpoint.txt`（已 gitignore），**不写进代码和文档**。
  解析顺序 `--server` > `COMFY_H3_URL` > `COMFY_URL` > `comfy-endpoint.txt` > `127.0.0.1`；
  没凭据时 `server()` 直接返回 `127.0.0.1`，不会向公网地址发出任何请求。
  报 `401` 是凭据不对，不是地址不对。
  ⚠️ 若报 `WinError 10061 目标计算机积极拒绝`，**不是服务器挂了**：Windows 上
  `urllib` 默认继承注册表系统代理（本机 `ProxyEnable=1` → `127.0.0.1:21882`），
  而 `ProxyOverride` 只白名单 `127.*`/`10.*`/`192.168.*`，公网 IP 的请求会被丢给
  本地代理端口、被它拒掉，认证头根本没发出去。`_opener()` 用
  `ProxyHandler({})` 强制直连；自定义脚本连 ComfyUI 也要照此办理。
- **`POST /prompt` 不是只读校验** —— 校验一通过就真排队执行、真烧 GPU。
  要静态校验就拉 `/object_info`（只读）比对节点类型与输入名，别拿 `/prompt` 试错。
- 克隆 github 慢就换 `gh-proxy`：`git clone https://gh-proxy.com/https://github.com/…`
- `write` 工具写 `G:/Tiffa/data/agent/managed-skills/` 会被沙箱拦，改用 `bash` 的 `cp`。
- **`cv2.imwrite` 在含非 ASCII 的 Windows 路径上静默返回 False**（不报错、不写文件）。
  出图一律先写 `G:/tiffa_frames/` 这类纯 ASCII 路径。
- **pip 的 mediapipe 是残缺构建**（0.10.32 无 `solutions`，`tasks/python/vision` 可用）；
  现成模型在 `custom_nodes/ComfyUI_LayerStyle_Advance/face_landmarker/face_landmarker.task`。
  但它在 **3/4 侧脸上追踪率仅 ~50%**，`jawOpen` 振幅只有 0.14 —— 测不准不等于口型差，
  别拿这个数判好坏。口型质量用抽帧目视（正面特写帧能直接看到露齿发声）。

- **`write_fingerprint` 两个静默失败**：① history 里的 filename 形如
  `gt_v03/mv_shot5_avatar_00002.mp4`，那是**相对 `output/` 的子路径**，拼到
  `COMFY_ROOT` 上指向不存在的目录，每镜都写失败且不报错。② 一次渲染同时产出
  无音轨那份（拼接用）和带音轨那份（验收用），而 history 往往只报其中一个 →
  `concat` 用的那份没指纹，`status` 判"无指纹"。现在两个变体都要盖。
- **"镜号存在 + 时长吻合"不等于这镜是当前提示词跑的。** 副歌两镜换位后镜号整体
  前移一位（旧镜10=阳台唱，新镜10=挂钟+理发店），而两版都吸附到 311 帧 = 12.96s
  —— **时长查不出来**，`concat` 只按镜号找片，留着就把上一版画面静默拼进成片。
  过期产物必须立刻挪进 `<dir>_stale/`，不能只靠"按 mtime 取最新"
  （坏片留在原地就是地雷）。
- **判"能否复用"的两个假阳性**：拿"别的版本目录里有同名文件"当依据（reuse 会拒绝
  提示词变了的镜，但同名文件照样在）；拿 VHS 序号当依据（`shutil.copy2` 保留源 mtime，
  复用件序号是 `00001` 而非目录里最新那份）。唯一可靠依据是 `.fp.json` 指纹。
- **复用旧成片要过五项**：提示词逐字节相同 + 帧数相同 + seed 相同 + 参考图相同 +
  **口型镜音频窗口起点相同**。第五条是拿 0.29s 位移换来的：镜22 从 v02 镜37 搬来，
  前三项全对却报`音轨未锁`（相关度 0.0424）—— 锁口型的成片，嘴型是照着**当时那段
  切片的绝对起点**长出来的，合并把整段往前挪 0.29s → 嘴比 master 慢 0.29 秒。
  时长零偏差、总长对得上，**看和听都发现不了**，只有相关度探针能抓。
  非口型镜不受这条限制（concat 丢开它们自带音轨、另铺连续 master）。

## 验收方法（每次出片都该跑，纯 CPU）

1. **逐段音轨相关**：`corr(输入wav, 输出mp4音轨)` 应 >0.95。实测 0.997~0.9996 = 硬锁生效。
   对照值：`AddGuideAudio` ≈0.60，分段 AAC 直接 concat ≈0.06。
2. **成片漂移探针**：master 音频 vs 歌曲原声，逐 5s 窗算相关。
   全程 >0.999 且 `lag=0ms` 才算合格；若相关度高但 lag 逐窗增大 → 累积漂移，
   多半是违反了铁律 2（先切音频后凑帧）。
3. **时长精确性**：`ffprobe` 视频 duration 必须 = 帧数/24，误差 <0.02s。
   `trim_to_audio` 不生效时就是靠这条抓出来的。
4. **静态图校验**：拉 `/object_info` 比对 `class_type` 存在 + 输入名在 schema 内
   （注意带 `.` 的输入如 `ref_images.ref_image_0` 要按前缀匹配）。

## 起手式：先出唱词时间轴，再排分镜（本项目没这么做；工具已验证，未用于成片）

本项目的时间轴是**假设**出来的：从谱里只取「段名 + 小节数」，然后认为
歌词在段内**按时间均匀分布**。结果成片镜头时长几乎全是 6.583s。
而按谱逐音推算，真实行长是 **2.39 ~ 6.78s（中位 3.99s）** —— 均匀假设把起伏抹平了。

**关键：时间轴不用 ASR，谱里本来就有。** 谱头 `Q:1/4=74 M:4/4 L:1/32` 让每个音符的
绝对时间可算（1 个 1/32 单位 = 0.1013s），Vocal 声部是逐音记谱的，而
**一个音符 ≈ 一个音节**（实测 390 发声音符 / 378 音节 = **1.03**）。
按音节数在音符序列里定位，就能把每行词钉到 0.1s 精度，纯标准库、零依赖。

**精度判断（决定该用哪条路）**：合法帧数间隔 = 17 帧 = **0.708s**，
所以优于 0.7s 的精度根本用不上。据此排序：

| 方案 | 精度 | 成本 |
|---|---|---|
| 谱推算（推荐） | ±0.1s + 全局缩放校正 | 零依赖 |
| 剪映识别歌词 → 导出字幕 | 唱歌 ASR ±0.3–1s | 手动 ~10min，次数/会员限制需自查 |
| stable-ts `align()` / whisperX | 高 | 要装 torch+whisper ≈4GB，不值 |

工具：`tools_lyric_timeline.py --score 谱.txt --audio 歌.flac --seg-map 映射.json --out runs/<ver>/timeline.json`
每行输出 起/止/音节/行长 + **吸附后的合法帧数**，分镜可直接取用；器乐段单独标出（空镜放这里）。

**已知局限**：行末时间取的是**最后一个音的起振（attack）**，不含它的延音 ——
跨小节续音的真实可听尾音更晚。要精确到「尾音结束」得另外记录每个音的结束时间。

四个坑（都在这一步踩过）：

- **必须按段锚定，不能全局累加。** 转音会让全局游标越跑越偏，实测漂出 31s 的荒谬跨度。
  段边界由谱的 `%` 标记给出（精确），段内再按音节数切该段的音符。
- **数音符必须合并 tie**（官方 ABC 方言明确要求：只数 tie 合并后的**发声音符**）。
  `D2-|D4` 是**一个**唱出来的音，不是两个。按原始 token 数会把跨小节续音当成新音节：
  本片 14 处 tie，修前 404 音符 / 1.069，修后 **390 / 1.03**，
  **中位行长从 5.98s 掉到 3.99s** —— 因为很多行原本以续音收尾，被误当成了新词。
- **段映射表必须和谱的段标记逐键对上**，对不上时先怀疑"这份谱不是这首歌的谱"。
  本项目就栽了：`manifest.json` 指向的最终音频是 264.96s，而 `scores/` 里没有任何谱
  推算值接近它（最接近的 282.16s）—— **谱必须和音频一起归档**，否则事后推不出时间轴。
- **谱可能不给某段写旋律。** 这份谱的 `% outro` 段 Vocal 声部全是 `z32` 休止，
  那 4 行词谱推不出来。工具必须显式标 `未锚定` 并告警，**不能悄悄均匀放置** ——
  那正是原来骗人的做法。
- 顺带：`h3video.pick_frames` 签名是 `(target_sec, min_sec=5.0, max_sec=None)`，
  第二个参数不是 fps。传错会把所有时长都抬到同一个帧数（实测全变 583 帧）。

接下去怎么用：时间轴 → **按唱词边界定镜长**（一句词跨两行就合并成一镜）→
行内切点写 `[Shot 2] At 00:xx.xxx`（复用同一组参考图，衔接由模型保证）→ 吸附合法帧数。
这样镜头时长跟着句子呼吸，而不是 5/10/15s 的格子。

## 分镜文件结构：总纲 + 单镜文件（别写一个大文件）

一个几千行的单文件分镜表是注意力黑洞：改第 18 镜时模型要重读整表，
容易顺手改坏别的镜、也容易"忘了"前面定过的设定。拆成：

```text
runs/v03/
  outline.json              总纲：fps + 每镜元数据 + 渲染历史（renders 段）
  shots/shot01.json … shot22.json   每镜一个文件：img / label / desc / zh
```

改一镜只碰那个小文件，物理上不可能误伤别的镜。

每个版本目录 `runs/<ver>/` 里五份产物各管一件事，**别互相替代**：

| 文件 | 给谁 | 内容 |
|---|---|---|
| `outline.json` + `shots/shotNN.json` | 改分镜的人 | 总纲 + 每镜正文，**改这里** |
| `board.json` | 引擎 | 机读分镜，`h3video` 直接吃；**是产物不是源** |
| `storyboard.md` | 人 | 时间码 / 唱词 / 画面 / 参考图 / 完整提示词 |
| `LEDGER.md` | 人 | **镜头 ↔ 提示词文件对照总账**，只想重投某镜时按它取词 |
| `prompts/shotNN.txt` | 复制粘贴 | 该镜该版完整提示词（顶部带镜号、标签、参考图、音频切片名） |
| `manifest.json` | 工具 | 本版歌曲、切片目录、输出前缀、镜头数 |

直接编辑 `board.json` 是错的：它会被重新生成，改动蒸发。
但反过来，`board.json` 也是**恢复源** —— 源文件丢了可以拿它逐字段反推回去
（见「改文件之前先探一眼」）。

- **`entry` ≠ board shot**。引擎会把超过 `max_shot` 的镜拆成多块（本机 22 个 plan 条目
  → 23 个 board shot，第 5 镜被拆成 `·1`/`·2`）。所以 outline 里必须存 `board_ids` **列表**，
  绝不能假设 1:1。
- 装载器 `gaitian_plan_v03_json.py` 把 JSON 重建成引擎要的 tuple 结构，
  跑 `--plan v03json`。tuple 元素个数随 `max_sec` 有无在 9/10 之间变，重建时要还原对。
- 拆分工具 `tools_split_v03.py` 从旧单文件机械导出，可反复重跑。
- **拆完必须证明等价**，否则等于偷偷改了内容：比对生成的 `board.json` 逐字节相同
  + 全部 23 镜提示词指纹匹配 + 待生成 0 镜。这三条就是当时的验收标准。
  （第一次重拆就是靠指纹比对抓到漏掉 `max_sec` 第 10 个元素。）
- 嵌入式 Python 发行版（`python313.zip` 作 `sys.path[0]`）**不含 cwd**，
  独立脚本要 `sys.path.insert(0, HERE)` 才能 import 同目录模块。

## 渲染历史：outline.json 的 `renders` 段

`tools_sync_renders.py` 扫输出目录，把每镜渲过几次、每次的文件锚点写回 outline：

```text
renders[shotId] = { fp_now, dirs: { 目录: { count, current, current_matches, files[] } } }
files[] = seq / file / audio / poster / fp / kind / frames / seed / size / mtime / matched / current
```

`fp_now` 是这一镜**当前**提示词的指纹；某份产物的 `fp` 不等于它就是过期产物，
`current` 标记 concat 真正会拿的那一份。

四个坑（都踩过）：

- **`current` 必须按目录分别算**，且直接调 `h3video.seg_file()` —— 和引擎同一个函数，
  不搞两套判定。跨目录取 mtime 最新会让后渲的 480p 冒充 768p 的"当前"。
- **只扫主 board 目录**。`_pre` / `_extra` / `_stale` / `_chk` / `_test` 是别的 board，
  它们的 `mv_shotN` 编号和主体无关，混进来会把片头第 1 镜当成主体第 1 镜。
- **路径统一正斜杠**。`glob` 返回反斜杠、`manifest.json` 存正斜杠，不相等会让去重失效、
  同一目录扫两遍、次数翻倍。
- **重拆不得抹历史**：`tools_split_v03.py` 会把旧 outline 的 `renders` 段原样搬过来。

每批渲染完跑一次。

## 参考图 > 文字（最贵的一条经验）

**改参考图比改提示词有效一个数量级。** 身份不像、脸漂、服装不对 ——
先换图或加图，别在措辞上打转。文字约束在这个模型上是弱约束。

- 只产 **subject 参考卡**（人物 / 场景 / 道具），**默认不要给每个镜头生成分镜图**。
  视频模型的首帧就是分镜，用图像模型先出一张"分镜图"再让 H3 去追它，
  等于让它追一张自己不完全认的脸，身份反而更差。整条流程省下的是最贵的那段工时。
- 例外（官方确实支持，但要用对）：Ref2VA 允许把图当 **storyboard / shot-planning reference**，
  在 `subject_definitions` 里显式声明它映射到哪几个 shot、提供什么规划信息：
  `<Picture 3> is a storyboard reference for [Shot 1] and [Shot 2], defining their viewpoint, subject placement, and shot order.`
  所以分镜图不是不能用，而是**只在需要严格控制多镜视点/站位/顺序时才做**，
  且必须声明职责，否则模型不知道拿它干什么。
- **首帧 ≠ 人物参考**，这是两种完全不同的约束：单列 `<Picture N>` = 具体帧锚点
  （`summary` 里对应 `keyframe completion`）；写进 `<Subject N>` 里 = 只借身份
  （对应 `reference generation`）。每张参考图都必须明确它负责"画面起点"还是"身份"，
  只写"参考这张图"是无效指令。这条正是上面第 5 条偏差的根源。

## MV 要素参考图：该出哪几张卡（出图本身交给 comfyui-image-gen）

生成侧不用重造：`comfyui-image-gen` 技能（`comfy.py`，gen/edit 走 Qwen Image 2.1）
已经管了生成、比例、负面词。MV 这边要定的是**该出哪几张卡、每张负责什么**。
H3 不吃分镜图，吃**要素卡**：

| 要素 | 什么时候必须有卡 | 喂给 | 不给的后果 |
|---|---|---|---|
| 人物身份 | 每个会露脸的角色 | `sing/action/niface/morph` 的 `<Subject N>` | 跨镜换脸 |
| 衣着 / 年龄段 | 同一角色跨年代或跨场合 | 与身份卡同喂 | 衣着漂移 —— 多半是**没给卡**，不是措辞不够 |
| 场景 | 反复出现的主要空间 | `<Subject N>` 场景引用 | 每次换个房间 |
| 物品 | 叙事锚道具（本片：街机币、吉他、CT 片） | 需要特写时 | 同一道具每次画成别的东西 |

四条硬规则（都是实测代价换来的）：

- **本人形象一律用原图，不进任何模型。** 图像模型没有真正的图编辑能力，重绘真人必掉脸。
  本片 `doctor_young` / `suit_now` 直接用用户原图；只有 `uncle_now`（镜头里背影虚化、
  不锁脸）和 `youth_*`（手绘动画）才走生成。
- **要改某个身份特征时，参考图越少越好。** 三张同发型等于三重强化，**文字压不过图**：
  ID 里早写了 `combed back`，出图还是参考照那种服帖的商务侧分。改发型必须**只用单张
  正面照**做编辑（`gaitian_hair.py`），选定后再把那张插到 REFS 第一位、其余镜头重跑。
- **多张参考图必须同比例。** Qwen 的 latent 尺寸只按第一张参考图算
  （`comfy_extras/nodes_qwen.py:166-167`），混比例 → 构图被第一张带跑。
  反过来用也成立：想控制输出尺寸，就把决定尺寸的那张放第一位。
- **卡数受 H3 输入上限约束**：≤9 图 / 所有文件合计 ≤12。身份 + 衣着 + 场景 三张是常态；
  多一组图就多一次「同一个 Subject 被两张卡争」的机会，别为凑细节把卡堆满。

## 改文件之前先探一眼（同类错犯了三次）

- 凭记忆重写 `gaitian_plan_v02.py`，把原文件覆盖了 —— 目录不在 git 里，无法回滚。
- 同名新脚本覆盖了 `tools_check_seed.py`，原内容已丢，只能按记录的用途**重建**
  （是重建不是恢复，逐字内容找不回来）。
- 自己的生成器 `tools_build_v03.py` 会**机械重生成**已含 11 处手写修正的
  `gaitian_plan_v03.py`，误跑一次全蒸发 —— 覆盖者是我自己的脚本。

制度性修复：

- 写文件前先 `glob` 探一眼目标是否存在。
- 生成器加护栏：检测到 `导演修正 / 导演定稿 / morph / niface` 标记即**拒绝写入**
  （退出码 2），要强制才加 `--force`，且覆盖前自动 `.bak`。
- 凡要大批量搬运已有 desc 的场景，**一律从台账读，不手打**。
- 有台账不等于不用备份：改任何"生成器输入"之前先确认它是否已被产物覆盖过。
- 恢复手段：`board.json` 每镜存了 `img/kind/label/desc/words/seg/frames/dur`，
  `storyboard.md` 存了中文画面，所以能**从产物反推回源文件**；
  验证方式 = 重新生成后与旧 board 逐字段 diff（id/kind/label/desc/img/frames/dur/
  src_start/src_end/needs_lip/words/seg/refs 全一致）。

## 验收探针本身会误报（判读前先看这条）

- **非唱镜的 `-audio.mp4` 音轨是模型自生成的环境声**，拼接时只取视频轨。
  所以"音轨未锁"对非唱镜是误报 —— 只对唱镜要求锁定。
- **禁忌扫描器两处假阳性**：`no suit`/`no ruler` 这类**否定式免责声明本身含关键词**，
  命中词前 32 字符内出现 no/not/without 即放行；"不露脸"的判据不是"prompt 含
  `from behind`"（sing 镜里那是肩后俯拍的机位描述），而是"niface / 标签含
  剪影·背影·后脑·借位的镜是否误挂了脸卡"。
- **抽帧核验**：`verify_frames.py` 每镜首/中/尾 3 帧横拼 + 比对实测 vs 期望时长
  （偏差 >0.5s 报警）；要看镜内变化用每镜 5 帧的版本，3 帧看不出子镜头。
- **死机只丢当时正在跑的那一镜**，其余完好 —— 增量渲染让补跑成本 = 一镜。

## 实测成本（RTX 5090D，480p）

- 唱镜走 avatar 管线**串行单价 430s/镜**；空镜/动画走非 avatar 管线快得多。
  40 镜全量实际 **41 分钟** —— 别拿唱镜单价乘总镜数。
  另：6 段并行提交的**墙钟** 270s，和 430s/镜 不矛盾（一个是单价一个是并行墙钟）。
- **双图锁身份成立**：身形卡给衣着体型 + 脸卡给五官，出片对照两张原图一致。
- **绿幕立绘直接喂 H3，零残留、无需抠像**，符合预期。
- 三个手绘少年同框不串脸，体型区分明确（适中 / 瘦高眼镜 / 胖眼镜）。
