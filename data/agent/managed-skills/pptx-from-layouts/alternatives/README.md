# Alternative PowerPoint Skills

This directory contains 7 A-tier PowerPoint skills from the
[playbooks.com](https://playbooks.com) ecosystem, preserved for comparison.

## Why These Exist

During testing, we evaluated 32 skills. These 7 scored 80+ on our rubric,
but all share a common architectural limitation: they don't use PowerPoint's
slide master layout system properly.

## Comparison

| Skill | Score | Approach | Limitation |
|-------|-------|----------|------------|
| pptx-jjuidev | 94 | inventory/replace | Duplicates slides, overlays text |
| anthropics-pptx | 90.6 | inventory/replace | Same as above |
| elite-powerpoint-designer | 90 | html2pptx | Creates from scratch, no template reuse |
| pptx-samhvw8 | 88 | inventory/replace | Same limitation |
| k-dense-pptx | 85 | python-pptx | Direct manipulation |
| python-pptx | 82 | library wrapper | Low-level, no semantic understanding |
| powerpoint-igorwarzocha | 80 | mixed | Incomplete implementation |

## When to Use These Instead

- **pptx-jjuidev / anthropics-pptx**: When you need to edit an existing
  presentation with text placeholders already in place
- **elite-powerpoint-designer**: When you want maximum design control
  and don't need template matching
- **pptx-samhvw8**: When you need chart and data visualization support
- **python-pptx**: When you need programmatic low-level access

## The pptx-from-layouts Difference

The main skill in this repo (`pptx-from-layouts`) takes a fundamentally
different approach:

1. **Profiles** your template's slide master layouts
2. **Maps** semantic visual types to appropriate layouts
3. **Generates** content into proper placeholders

This preserves your template's design instead of fighting with it.

## Directory Structure

Each skill directory contains:

```
skill-name/
└── SKILL.md        # Skill definition and documentation
```

Some skills may have additional supporting files like scripts or templates.

## Note on pptx-jjuidev and anthropics-pptx

These two skills are functionally identical. A diff shows only the
description line differs — one is likely a fork of the other.
