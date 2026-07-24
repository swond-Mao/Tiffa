# pptx-from-layouts Architecture

This document explains how pptx-from-layouts works internally.

## Core Concept

pptx-from-layouts uses **slide master layouts** rather than text replacement.
PowerPoint files have a hierarchy:

```
Presentation
└── Slide Masters
    └── Slide Layouts (e.g., Title Slide, Title and Content, Two Content...)
        └── Slides (instances of layouts)
```

Most skills work at the Slide level, overlaying text boxes.
pptx-from-layouts works at the Layout level, using proper placeholders.

## Pipeline Overview

```
outline.md → ingest.py → layout_plan.json → generate_pptx.py → output.pptx
                                                    ↓
                                          template + config
```

### 1. Ingest (outline.md → layout_plan.json)

The `ingest.py` script parses markdown outlines with visual type declarations:

```markdown
# Slide 1: Project Overview
**Visual: hero-statement**
Transforming operations through digital innovation
```

Produces a structured layout plan:

```json
{
  "slides": [
    {
      "title": "Project Overview",
      "visual_type": "hero-statement",
      "content": "Transforming operations through digital innovation"
    }
  ]
}
```

### 2. Template Profiling

Before generation, templates are profiled to understand their layouts:

```bash
python scripts/profile.py template.pptx --generate-config
```

This produces a config mapping visual types to layout indices:

```json
{
  "template": "template.pptx",
  "layouts": {
    "hero-statement": 5,
    "process-3-phase": 12,
    "comparison-2": 8,
    "table": 15
  }
}
```

### 3. Generation (layout_plan.json → PPTX)

The `generate_pptx.py` script:

1. Opens the template
2. For each slide in the plan:
   - Looks up the layout index for the visual type
   - Creates a new slide using that layout
   - Populates placeholders with content
3. Removes template's original slides
4. Saves the output

## Script Reference

### Entry Points

| Script | Purpose |
|--------|---------|
| `generate.py` | Main generation entry point |
| `edit.py` | Edit existing presentations |
| `validate.py` | Quality validation |
| `profile.py` | Profile new templates |

### Core Logic

| Script | Purpose |
|--------|---------|
| `ingest.py` | Parse markdown to layout plan |
| `generate_pptx.py` | Apply layout plan to template |
| `profile_template.py` | Analyze template layouts |
| `validate_pptx.py` | Check output quality |

### Content Processing

| Script | Purpose |
|--------|---------|
| `content_fitter.py` | Fit content to shape bounds |
| `content_splitter.py` | Split long content across slides |
| `content_recovery.py` | Handle overflow gracefully |

### Utilities

| Script | Purpose |
|--------|---------|
| `diff_pptx.py` | Compare two presentations |
| `preview_layout.py` | Visualize layout plan |
| `gantt_renderer.py` | Render timeline visuals |
| `quality_check.py` | Detailed quality metrics |

## Library Structure

### lib/

| Module | Purpose |
|--------|---------|
| `inventory.py` | Extract text shapes from slides |
| `replace.py` | Replace text in shapes |
| `rearrange.py` | Reorder/duplicate slides |
| `thumbnail.py` | Generate slide thumbnails |
| `margins.py` | Handle shape margins |
| `font_fallback.py` | Handle missing fonts |
| `graceful_degradation.py` | Handle errors gracefully |
| `pptx_compat.py` | python-pptx compatibility |
| `performance.py` | Performance monitoring |

### schemas/

Pydantic models for validation:

| Schema | Purpose |
|--------|---------|
| `layout_plan.py` | Layout plan structure |
| `template_config.py` | Template configuration |
| `brand_config.py` | Brand settings |
| `generation_result.py` | Generation output |
| `checklist.py` | Quality checklist |

### rules/

Markdown documentation for visual decisions:

| Rule | Purpose |
|------|---------|
| `visual-types.md` | Visual type selection |
| `outline-format.md` | Markdown syntax |
| `typography.md` | Text formatting |
| `columns.md` | Column layouts |
| `tables.md` | Table patterns |
| `editing.md` | Edit vs regenerate |
| `decisions.md` | Quick reference |

## Edit Mode

For surgical changes to < 30% of slides:

```
deck.pptx → inventory.py → shapes.json
                               ↓
                          replace.py
                               ↓
                          edited.pptx
```

Edit mode uses `inventory.py` to extract existing text shapes,
then `replace.py` to make targeted changes without regenerating.

## Validation

Quality checks run automatically:

1. **Structural** — Valid OOXML, no corruption
2. **Content** — All content placed, no overflow
3. **Visual** — Text readable, proper spacing
4. **Brand** — Colors and fonts match config

## Error Handling

The `graceful_degradation.py` module handles common issues:

- **Missing fonts** → Falls back to similar fonts
- **Content overflow** → Splits to multiple slides
- **Invalid visual type** → Falls back to bullets
- **Missing layout** → Uses closest match
