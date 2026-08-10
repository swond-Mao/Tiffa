---
description: "禁止以技能目录作为 cwd 运行 craftman，产物必须落在项目目录 output/ 内"
condition: "cwd\\s*:\\s*[\"'][^\"']*skills[^\"']*[\"']"
scope: "tool:bash(*craftman*)"
interruptMode: "always"
repeatMode: "after-gap"
---

你正在以技能目录（如 `$ROOT/skills/craftman`，$ROOT 为便携根目录）作为 bash 的 cwd 运行 craftman，导致 `os.getcwd()` 指向技能目录，产物落到 `技能目录/output/`，而不是项目目录。craftman.py 源码约定：`OUT_DIR = Path(os.getcwd()) / "output"` —— 产物跟随**运行时的 cwd**。

## 正确做法

1. **不要在技能目录下运行 craftman**：不要把 `cwd` 设为 `.../skills/craftman`。如果是为了 import craftman 模块，请改用 `--plan-file` 方式在项目目录下直接运行：

```bash
python "$ROOT/skills/craftman/craftman.py" --plan-file "$ROOT/workspace/项目名/.craftman/plan.json" --no-confirm
```

2. **cwd 保持为项目目录**（如 `$ROOT/workspace/项目名`），产物会自动落到 `项目目录/output/`。

3. **或者用 --output 显式指定**：`--output "$ROOT/workspace/项目名/output"` 覆盖输出目录。

4. **最终产物必须位于 workspace 下的项目目录内**，禁止落在 `$ROOT/skills/` 下任何位置（应用根目录）。
