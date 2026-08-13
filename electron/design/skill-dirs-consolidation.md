# Skill 目录合并调研报告（供修改 claude-mode-extension.ts 使用）

## 背景

技能存在两个目录：
- `skills/`（顶层，23 个技能）：自研运行体系，含完整运行脚本，craftman 等逻辑互相关联。
- `data/agent/managed-skills/`（23 个技能）：omp 内核 `skill://` 协议加载的技能目录（原生约定）。

目标：**只保留一份最新版本，作为唯一 `skill://` 加载来源**。经排查确认 `skill://` 从 `data/agent/managed-skills/` 加载（内核 `SV()` 函数 = `agentDir/managed-skills`）。但多个技能运行脚本被 `plugins/claude-mode-extension.ts` 的 `SKILL_PATH_HINTS` 硬编码为顶层 `skills/` 路径，需改为指向 `data/agent/managed-skills/`。

## 已被 claude-mode 规则保护、需其他智能体修改的文件

**`plugins/claude-mode-extension.ts`** —— 本文件被 `[claude-mode] 禁止 AI 修改配置文件` 规则拦截，需由外部智能体修改以下内容。

### 关键位置：`SKILL_PATH_HINTS`（约第 175-212 行）

这是一个 `Record<string, string[]>`，给弱模型注入脚本绝对路径，禁止模型自行拼接路径。当前 4 个技能指向顶层 `skills/`，需改为 `data/agent/managed-skills/`。

| skills 键 | 当前路径（顶层） | 应改为（managed） |
| --- | --- | --- |
| `craftman` | `${PORTABLE_ROOT}/skills/craftman/craftman.py` | `${PORTABLE_ROOT}/data/agent/managed-skills/craftman/craftman.py` |
| `comfyui-image-gen` | `${PORTABLE_ROOT}/skills/comfyui-image-gen/comfy.py` | `${PORTABLE_ROOT}/data/agent/managed-skills/comfyui-image-gen/comfy.py` |
| `computer-use` | `${PORTABLE_ROOT}/skills/computer-use/computer_use.py` | `${PORTABLE_ROOT}/data/agent/managed-skills/computer-use/computer_use.py` |
| `shared-visual-components` | `${PORTABLE_ROOT}/skills/shared-visual-components` | `${PORTABLE_ROOT}/data/agent/managed-skills/shared-visual-components` |

### 关键位置：`SKILL_SCRIPT_RULES`（约第 213-220 行）

正则匹配 bash 命令里的 `comfy.py` / `craftman.py` / `pptgen.py` / `computer_use.py`，用于识别"脚本调用要拦截/询问"规则。这些正则是**文件名匹配**（非路径前缀），改目录后不受影响，无需改动，但请核对确认。

### 其他硬编码顶层 `skills/` 路径（本文件内）

通篇搜索 `join(PORTABLE_ROOT, "skills"`、`/ "skills" /`、`"skills/"`，凡指向技能脚本的均改为 `data/agent/managed-skills`。**仅文档字符串**中 `$ROOT/skills/...`、`skills/onboarding/SKILL.md` 等表述可保留（不代表运行路径），但建议一并核对。

---

## 已完成的合并（无需再动）

1. **computer-use 6 个运行脚本**：已从顶层 `skills/computer-use/` 复制到 `data/agent/managed-skills/computer-use/`：
   - `computer_use.py`、`computer_use_mcp.py`、`grounding.json`、`GROUNDING.md`、`requirements.txt`、`uia_core.py`
2. **`data/agent/mcp.json`**：已将 `G:/Tiffa/...`（漂移盘符）改为自包含占位符 `{{PORTABLE_ROOT}}/data/agent/managed-skills/computer-use/computer_use_mcp.py`。
   - 路径由 Tiffa 主进程运行时把 `{{PORTABLE_ROOT}}` 替换为真实便携根目录（见 `electron/modules/computer-use-utils.ts` 的 `syncComputerUseMcp`）。
   - 注意：`mcp.json` 里的 python.exe 也用 `{{PORTABLE_ROOT}}/python/python.exe`，替换后可用。

---

## 逐技能合并方向（供修改后验证）

| 技能 | 差异 | 方向 | 备注 |
| --- | --- | --- | --- |
| computer-use | 顶层独有 6 脚本，managed 原本只有 SKILL.md | 顶层→managed（已完成） | SKILL.md 两目录一致 |
| craftman | `craftman.py` + `SKILL.md` 顶层是**新版**（630 行，含 user_decisions 防呆/产物校验），managed 旧版（381 行） | **用顶层新版覆盖 managed** | 顶层版强耦合顶层 `skills/`，`SKILLS_DIR = SKILL_DIR.parent` 定位 pptgen/comfyui/canvas 脚本，合并后需重写路径解析指向 managed |
| onboarding | `SKILL.md` 顶层新（6 问题版），managed 旧（4 问题版） | **用顶层新版覆盖 managed** | — |
| video-prompt-gen | `SKILL.md` managed 新（多分镜四段式规范） | **保留 managed** | — |
| dashiai-ppt | 顶层独有 `theme_palettes.json`；5 个 project/scripts 内容不同 | 独有文件并入 managed；5 个脚本需逐个 diff 判新旧 | — |
| pptgen | managed 独有 `templates/aurora.html`；15 个模板 + 5 个 test HTML 内容不同 | 保留 managed 独有；模板需逐个 diff 判新旧 | — |
| canvas-design | managed 独有 10 个 MiSans 字体 | **保留 managed** | 顶层缺字体 |
| 其余 17 技能 | 两目录文件一致 | 无需操作 | — |

---

## craftman.py 合并时的路径重写要点

顶层 craftman.py（新版）路径解析（约 13-17 行）：
```python
SKILL_DIR = Path(__file__).parent
SKILLS_DIR = SKILL_DIR.parent              # 当前：skills/（顶层）
PORTABLE_ROOT = SKILLS_DIR.parent
HTML2PNG = PORTABLE_ROOT / "skills" / "shared-visual-components" / "tools" / "html2png.js"
SKILLS["pptgen"]["path"] = str(SKILLS_DIR / "pptgen" / "pptgen.py")   # 依赖顶层平级
SKILLS["comfyui"]["path"] = str(SKILLS_DIR / "comfyui-image-gen" / "comfy.py")
SKILLS["canvas-design"]["path"] = str(SKILLS_DIR / "canvas-design" / "SKILL.md")
```

移到 `data/agent/managed-skills/craftman/craftman.py` 后：
- `SKILL_DIR` = managed-skills/craftman
- `SKILLS_DIR` 应指向 `data/agent/managed-skills`（而不是其 parent）
- `HTML2PNG` 应指向 `data/agent/managed-skills/shared-visual-components/tools/html2png.js`
- `SKILLS[...]` 的 3 个依赖脚本改为 managed-skills 下的平级路径

建议改用 `PORTABLE_ROOT` 定位（自包含），例如：
```python
PORTABLE_ROOT = Path(os.environ.get("PORTABLE_ROOT") or Path(__file__).resolve().parents[3])
MANAGED_SKILLS = PORTABLE_ROOT / "data" / "agent" / "managed-skills"
HTML2PNG = MANAGED_SKILLS / "shared-visual-components" / "tools" / "html2png.js"
SKILLS["pptgen"]["path"] = str(MANAGED_SKILLS / "pptgen" / "pptgen.py")
...
```

> 注意：原生 `portableRoot` 经 Tiffa 注入为 `PORTABLE_ROOT` 环境变量。若希望脚本独立可跑（脱离 AI 也能用），再用 `parents[3]` 兜底。

---

## 验证清单

1. `read skill://craftman` 能读到新版 SKILL.md（含 user_decisions 防呆说明）。
2. `python "$PORTABLE_ROOT/data/agent/managed-skills/craftman/craftman.py" --list-skills` 能列出 pptgen/comfyui/canvas 技能。
3. `python "$PORTABLE_ROOT/data/agent/managed-skills/comfyui-image-gen/comfy.py" --help`（或等价）路径可执行。
4. `python "$PORTABLE_ROOT/data/agent/managed-skills/computer-use/computer_use.py" --help` 可执行。
5. `data/agent/mcp.json` 用 `{{PORTABLE_ROOT}}/...` 能被主进程替换并启动 computer-use MCP（enabled 时才启动）。
6. `onboarding` 技能走新版 6 问题流程。
7. 顶层 `skills/` 备份后移除，`skill://` 各技能仍正常（因为 SKILL_PATH_HINTS 已指向 managed）。

---

## 待确认 / 未决

- 顶层 `skills/` 是否最终删除：需在全部合并完成、验证通过后，由用户拍板删除或保留为只读归档。
- dashiai-ppt 的 5 个 project/scripts、pptgen 的 15 个模板 + 5 个 test HTML，需逐个 diff 判"哪个版本新"后统一到 managed。
- craftman.py 移入 managed 后，`SKILL_PATH_HINTS["craftman"]` 的调用示例路径需一并改为 managed（在本文件 `SKILL_PATH_HINTS.craftman` 数组内也引用了 `craftman.py`）。
