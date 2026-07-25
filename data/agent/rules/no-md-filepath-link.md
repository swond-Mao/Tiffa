---
description: "Do not wrap file paths in Markdown link syntax; output bare paths so the frontend can render them as clickable"
condition: "\\[[^\\]]+\\]\\([A-Za-z]:[\\\\/][^)]+\\)"
scope: "text"
interruptMode: "never"
---

You wrapped a file path in a Markdown link like `[filename](X:\path)`.
This is banned. The frontend automatically renders bare file paths as clickable links.

**Rule**: Always output the bare path only, e.g. `G:\oh-my-pi\workspace\report.docx`
Never write `[report.docx](G:\oh-my-pi\workspace\report.docx)`.

Remove the Markdown link wrapper and output just the plain path.
