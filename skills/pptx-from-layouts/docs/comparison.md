# PowerPoint Skills Comparison

We tested 32 PowerPoint generation skills available in the Claude Code ecosystem.
This document summarizes the key findings and explains why most alternatives
share a common architectural limitation.

## The Core Problem

Most PowerPoint skills assume templates contain text placeholder shapes that can
be inventoried and replaced. They follow this workflow:

```
1. Extract text from template (markitdown or similar)
2. Generate thumbnails for visual analysis
3. Duplicate slides as needed
4. Inventory text shapes in each slide
5. Replace placeholder text with new content
6. Validate output
```

This works when templates have proper text placeholders:

```xml
<!-- Expected: Templates with text placeholders -->
<p:sp>
  <p:nvSpPr>
    <p:nvPr><p:ph type="title"/></p:nvPr>
  </p:nvSpPr>
  <p:txBody>
    <a:p><a:r><a:t>Placeholder Title</a:t></a:r></a:p>
  </p:txBody>
</p:sp>
```

But many professional templates use decorative layouts without editable text:

```xml
<!-- Actual: Empty slide tree with only group shape -->
<p:spTree>
  <p:nvGrpSpPr>...</p:nvGrpSpPr>
  <p:grpSpPr>...</p:grpSpPr>
  <!-- No text shapes -->
</p:spTree>
```

When this happens, the inventory returns empty and replacement fails.

## A-Tier Skills Comparison

| Skill | Score | Architecture | Limitation |
|-------|-------|--------------|------------|
| pptx-jjuidev | 94 | inventory/replace | Template assumption |
| anthropics-pptx | 90.6 | inventory/replace | Template assumption |
| elite-powerpoint-designer | 90 | html2pptx | Creates from scratch |
| pptx-samhvw8 | 88 | inventory/replace | Template assumption |
| k-dense-pptx | 85 | python-pptx direct | Low-level API |
| python-pptx | 82 | library wrapper | No semantic understanding |
| powerpoint-igorwarzocha | 80 | mixed | Incomplete implementation |

### pptx-jjuidev & anthropics-pptx

These two skills are nearly identical (likely one is a fork of the other).
They provide the most complete tooling:

```
scripts/
├── inventory.py     # Extract text shapes
├── replace.py       # Replace content
├── rearrange.py     # Manage slides
├── thumbnail.py     # Visual validation
├── validate.py      # OOXML validation
├── unpack.py        # Extract XML
└── pack.py          # Reassemble PPTX
```

**Strength:** Full toolkit, validation at every step
**Weakness:** Assumes templates have text placeholders

### elite-powerpoint-designer

Takes a different approach: generates from scratch using html2pptx.

**Strength:** No template dependency, maximum design control
**Weakness:** Cannot reuse existing brand templates

### pptx-samhvw8

Similar architecture to pptx-jjuidev with additional chart support.

**Strength:** Full OOXML knowledge, chart capabilities
**Weakness:** Same template assumption

### k-dense-pptx & python-pptx

Direct python-pptx library wrappers.

**Strength:** Low-level control, well-documented library
**Weakness:** Requires manual slide construction, no semantic understanding

## Why 8 Skills Scored Zero

| Failure Mode | Count | Examples |
|--------------|-------|----------|
| Missing scripts | 4 | moltbot-pptx-creator |
| Wrong format | 2 | google-slides-storyboard |
| External API unavailable | 2 | nanobanana-ppt-skills2 |

## The pptx-from-layouts Difference

Instead of inventorying and replacing text in template slides,
pptx-from-layouts:

1. **Profiles** your template's slide master layouts
2. **Maps** semantic visual types to appropriate layouts
3. **Generates** content into proper placeholders

This means:
- Works with any well-designed template
- Uses the template's layout system correctly
- Preserves professional design intent
- No text overlay hacks

## When to Use What

| Scenario | Recommended |
|----------|-------------|
| Brand template with editable text placeholders | pptx-jjuidev or anthropics-pptx |
| Maximum design control, no template needed | elite-powerpoint-designer |
| Template with slide master layouts | **pptx-from-layouts** |
| Low-level programmatic control | python-pptx |
| Data-heavy with charts | pptx-samhvw8 |

## Testing Methodology

Each skill was evaluated against standardized scenarios:

| Test | Input | Expected Output |
|------|-------|-----------------|
| Create from scratch | Topic + outline | 5-slide PPTX |
| Use template | Template + content | Styled output |
| Edit existing | PPTX + changes | Modified file |
| Extract content | PPTX file | Text + structure |

Scoring rubric:
- Core Functionality: 40%
- Business Features: 30%
- Reliability: 20%
- Advanced Features: 10%
