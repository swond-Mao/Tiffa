# Tiffa

> 中文文档：[README.md](README.md) · English version below.

**Play against all things; walk with time as your companion.**

---

Have you ever felt this way—

You've been talking to an AI for three months, and it keeps getting to know you. You don't have to explain "I hate pointless openers" — it remembers. You don't have to say "just give me the conclusion, no preamble" — it knows. A kind of understanding grows between you. It's like your student, and also like your assistant. You know where its boundaries are, and it knows your habits.

Then one day, you switch computers, the system crashes, you reinstall.

That "it" is gone. You're facing a stranger.

**Tiffa exists to solve this problem.**

What matters even more — it leaves no trace anywhere. Pull the drive and take it with you; this relationship goes with you. No login, no registration, no records left on any server. Your workspace, your memories, your preferences — all on a USB stick, not in the cloud.

---

## What It Is

Tiffa is a **fully portable, absolutely private** local AI assistant. Built on `@oh-my-pi/pi-coding-agent` v17.0.7, with seven layers of modification wrapped in an Electron desktop shell.

**Three core traits:**

- **Everlasting memory** — It remembers you. Not just what you said, but your preferences, your projects, the pitfalls you've hit. Switching computers? Your memory goes with you. Reinstalling? Reconnect and pick up where you left off.
- **Absolute privacy** — No login, no registration, no trace left on any server. All data stays local; copy it to a USB drive and take it away — nothing left on the hard disk.
- **Works with weak models** — Local and cloud models both welcome: use local llama.cpp when you have it, use a cloud API when you have that, switch with one click. Even a mere 3.5GB Q1_0 quantized model runs full agent tasks. It's not about a pricier model — it's about better infrastructure.

---

## Everlasting Memory

Tiffa's memory is a layered living system, not simple file storage:

```
L1  USER.md       — Who you are, your preferences
                    "I'm Zhang San, hate pointless openers, always lead with the conclusion"
                    Read every turn, injected with zero latency

L2  Global semantic memory — Cross-project usage history
                    "User has an RTX 5090, manages services with NSSM"
                    Semantic recall, accumulates forever, never lost across sessions

L3  PROJECT.md    — Project charter
                    "This project uses SQLite, cache dir is data/"
                    Hand-maintained, auto-switches when switching projects

L4  Project semantic memory — Recent progress and decisions
                    "Fixed the ComfyUI pipeline yesterday, tuning the sidebar today"
                    Semantic recall, takes priority over global memory
```

Close it and reopen — it still knows you. Switch projects — it knows the context. A week later, flip through the logs and pick up the thread.

### Mnemopi Semantic Memory

The embedding model runs locally (`BAAI/bge-small-zh-v1.5`, 512-dim ONNX, no API needed). Memories are written into a vector database, auto-accumulating (written every 2 turns) and auto-recalled (relevant memories injected on the first message of a session).

Anti-bloat: at most 10 recalled per call, 2000-token injection cap, old memories auto-degrade and compress — the database can grow without limit while the context never overflows.

Long-conversation auto-compaction: by default it uses **snapcompact visual-frame summaries** (when a vision model is available); when the text to be compressed is too large (default > 2MB), it automatically downgrades to **side-path structured summarization** (a cheap model generates a 9-segment summary), preventing visual frames from blowing up the context. Weak models can resume at low cost, with tool details preserved at the semantic level.

### Progress Sedimentation: Daily / Weekly / Monthly Reports

Tiffa doesn't just record "what you said" — it records "what you accomplished." Every time a long conversation is compacted, the side-path model distills the conversation into a one-line log entry written to the project's `.progress/log.md`; on session start or day-crossing it auto-aggregates and sediments **daily / weekly / monthly reports** into `PROJECT.md` — come back a week later, open `PROJECT.md`, and you'll know what was advanced, where it got stuck, and what's next.

- The log is triggered by compaction, **independent of git commits** — pure conversation / config / memory work still gets sedimented
- Details live in `.progress/log.md` (line by line), conclusions in `PROJECT.md` (aggregated) — coarse and fine separated
- Weak-model friendly: accounting only uses the side-path small model to distill one line, zero extra cost

---

## Constraint System

Tiffa's constraints come in three layers, each with its own job:

**Layer 1: TTSR Streaming Rules** (zero Context cost)
- Written in `.md` files, detected in real time as the model outputs, violations blocked immediately
- 13 rules covering pointless openers, code-block formatting, dangerous operations, tool-call chatter, etc.

**Layer 2: before_agent_start Hook** (semantic constraints)
- File conventions, task-planning methods, skill iron rules
- System Prompt prefix injection, for behavioral/semantic constraints

**Layer 3: tool_call Hook** (dangerous-operation blocking)
- Dangerous path blocking (System32 / Windows / Program Files)
- Self-modification of config files blocked
- Silent tool-call detection (3 consecutive → steer reminder)

Unhappy with the model's behavior? Just complain in one line:

```bat
/吐槽 你不应该把产物放在工作区根目录
```

Chinese, English, file placement, wordy openers… whatever the flaw, say it. `/omfg` triggers the same. The model analyzes the problem and generates a TTSR rule file, effective instantly. No code changes, no restart.

---

## Constraining Model Behavior with Code

Tiffa doesn't rely on "nicely-worded" prompts to force the model into line — it **constrains the model's behavior layer by layer with code**, breaking error-prone steps into deterministic steps and letting the model walk through them. This is why weak models can complete tasks stably; strong models, in turn, produce **deterministic artifacts** per your requirements — no drifting, no freelancing.

**Craftman mode** is one example: when producing interactive web pages, posters, or presentations, Tiffa runs the craftman multi-skill orchestration — first confirming the theme / style / whether to generate images with you, then calling `pptgen` / `comfyui` / `canvas-design` per the plan, finally merging the output. Paired with an **HTML guard**: any `.html` written directly that references the visual component library (`shared-visual-components` / `data-theme=`), if craftman hasn't actually run, gets blocked with a prompt to go through the flow first — both "asked but didn't run" and "hand-rolled workaround" are sealed off. The whole flow is **backstopped by code**, not by the model's conscience.

**Whether weak or strong, this mechanism is the backstop:**

| Mechanism | Effect |
|------|------|
| TTSR rule blocking | Zero Context-cost constraint, saves ~500 token per turn |
| Pointless-opener blocking | The most frequent dumb pattern of weak models, cut directly |
| XML tool-call blocking | From "can't call tools at all" to "can" |
| Tool-call chatter blocking | Talk less, do more, save tokens |
| Side-path structured summarization | Long conversations don't fragment; weak models can resume context |
| Loop Guard | Exact-repetition detection + auto-retry |

**Side-path model summarization — the part we're proud of.** Long-conversation compaction and progress sedimentation are both handed to an independent side-path small model, which has three advantages others lack:
- **Third-party perspective, unpolluted by context** — it doesn't read the main conversation's step-by-step reasoning, only sees what needs summarizing, so conclusions are more objective and don't drift along with the main model;
- **Cheap model saves money** — use the cheapest small model for the manual labor of summarization, while the main model only does the real work;
- **No agent constraints, saves tokens** — the side-path model doesn't load the main agent's system prompt and tool definitions, so its context is extremely light and the summarization cost is nearly negligible.

**Even a Q1_0 extreme-quantized model works stably.** It's not that the model got stronger — it's that the infrastructure covers its shortcomings. Strong models on this same base become steadier, cheaper, and more controllable.

---

## Operating the Computer

Not just writing code — Tiffa can directly operate your Windows desktop:

- **Atomic toolset**: `ui_inspect` (read control tree) / `ui_act` (click & type) / `ui_screenshot` (screenshot) / `desktop_input` (mouse & keyboard) / `computer_use` (all-in-one)
- **Four-tier degradation**: UIA Pattern direct call → precise coordinate click → SoM numbered labeling → normalized coordinates fallback
- **Default VLM**: Doubao `doubao-seed` vision model, configurable in the background "MCP Models" field

> Honestly: it's not especially great. Complex interfaces, dynamic popups, and owner-drawn controls still miss. At this stage it's better suited for deterministic tasks like "click a fixed button, fill a fixed form." But it does exist — among local assistants, few can directly operate the desktop.

---

## Desktop Frontend

Electron GUI, not lines of text in a terminal:

- Project sidebar — multi-workspace switching, archiving without loss
- Conversation tabs — each dialogue independent model, independent memory
- Model selector — one-click switch local/cloud models
- Right-panel dual tabs — Outline (Todo + project charter) / Files (flat navigation + drawer preview)
- File drawer — HTML rendering / code highlighting / image centering / Markdown formatting
- Diff view — code changes clear in red and green
- 7 themes — day/night mode one-click switch

### Startup

Startup isn't a dry spinning circle — it's an entrance ritual:

```
  与万物对弈，伴时间同行      ← Main title emerges
   夜色将尽，晨光初透       ← Wake the engine
   静水深流，暗涌潜行       ← Load memory
   行囊在肩，天地为卷       ← Organize context
   灯火已明，门扉待启       ← Ready
```

---

## Portable: Copy and Go, Leave No Trace

```
Tiffa/           ← This one folder is everything
├── electron/    ← Desktop frontend
├── npm-global/   ← Bun + core
├── plugins/     ← Extensions + skills
├── data/        ← Config + memory + sessions + rules
└── workspace/   ← Your projects
```

**Copy to a USB drive, plug in and use.**

- Writes no registry
- Installs no global packages
- Leaves no files in `%APPDATA%` / `%LOCALAPPDATA%`
- The workspace (workspace/) is also on the USB drive, touching none of the target computer's hard disk
- No login, no registration, no records left on any server

You finish on the office computer, pull the drive and take it. Plug in at home — all memory, projects, and config intact. No account, no cloud, nowhere that retains your usage traces.

---

## Launch

```bat
tiffa-desktop.exe      # Double-click to launch
tiffa-desktop.vbs      # No console window
start-desktop.bat      # With --portable-root parameter
start-tiffa.bat       # TUI/WebUI/RPC terminal mode
```

Or dev mode: `cd electron && npm start`

---

## Technical Easter Egg: The Seven-Layer Transformation

A bare model is like an unsharpened knife. Tiffa's seven-layer architecture is the whetstone:

```
  Drive instructions ─── Let the model know "who I am"
  Permission system   ─── Let the model know "what I can do"
  Hooks chain        ─── Correct the model when it errs
  Rule system        ─── Let the model know "what I cannot do"
  Memory system      ─── Let the model remember "what you told me"
  Plugin system      ─── Let the model gain new abilities
  Skill system       ─── Let the model know "what to do when this happens"
```

All seven layers together produce this effect: **even a Q1_0 extreme-quantized model works stably.**

---

## License

MIT. Just use it.
