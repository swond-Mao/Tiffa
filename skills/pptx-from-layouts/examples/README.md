# Examples

This directory contains example inputs and outputs for pptx-from-layouts.

## q1-strategy

A 5-slide Q1 2026 Strategic Growth Plan demonstrating:

- `hero-statement` — Title slide with tagline
- `cards-3` — Executive summary with three pillars
- `table` — OKRs with targets and dates
- `process-3-phase` — Tactical roadmap timeline
- `comparison-2` — Budget allocation vs risk mitigation

### Files

| File | Description |
|------|-------------|
| `outline.md` | Input markdown with visual type declarations |
| `output.pptx` | Generated PowerPoint presentation |
| `thumbnail.jpg` | Visual preview of output |

### Running the Example

```bash
# From the repository root
python .claude/skills/pptx-from-layouts/scripts/generate.py \
  examples/q1-strategy/outline.md \
  -o examples/q1-strategy/regenerated.pptx \
  --template templates/inner-chapter.pptx
```

### Outline Structure

```markdown
# Slide 1: Q1 2026 Strategic Growth Plan
**Visual: hero-statement**
Driving Market Leadership & Operational Efficiency

---

# Slide 2: Executive Summary & Mission
**Visual: cards-3**

[Card 1: Scale]
Increasing customer acquisition through automated funnels

[Card 2: Retention]
Enhancing product stability to reduce churn

[Card 3: Innovation]
Launching the new module by March

---
...
```

See `outline.md` for the complete example.
