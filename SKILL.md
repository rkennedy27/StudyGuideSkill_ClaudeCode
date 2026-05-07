---
name: study-guide
description: Turn a folder of lecture PDFs/PPTX (and optional practice quizzes) into an interactive textbook-style study site. Three stages — extract per source, group into chapters, synthesize textbook chapters — then plug into a standard vanilla UI template.
---

# Study Guide Builder

Build an interactive study site from lecture material. The skill orchestrates three stages and then drops the output next to a standard UI template that requires no build step.

## Inputs

The user points the skill at a project directory. Expected layout (paths flexible, ask if unclear):

```
<project>/
├── slides/                    # PDFs and/or PPTX files (required)
│   └── *.pdf | *.pptx
├── quiz/                      # optional
│   ├── practice_quiz.pdf      # blank or completed practice quiz
│   └── predicted_questions.txt
└── ...
```

Quiz inputs are optional. If absent, generate practice questions from the source material during synthesis.

## Output

```
<project>/study-output/
├── index.html                 # standard UI (copied from ui-template/)
├── app.js
├── app.css
├── manifest.json              # course meta, chapter order, topic graph
├── chapters/
│   └── 01-<id>.md             # synthesized textbook chapters with inline :::question blocks
├── sources/                   # stage-1 raw extractions (kept for re-grouping)
│   └── <source-name>.md
├── chapter-plan.yaml          # editable grouping plan from stage 2
└── assets/                    # any rendered slide images (only if hybrid extraction fell back to vision)
```

The user opens `study-output/index.html` directly — no server, no build.

---

## Stage 1 — Source extraction

**Goal:** one MD per source file containing every fact, code example, table, and diagram description from that source. Faithful capture, no synthesis.

**Approach:** hybrid extraction via `scripts/extract.py` to minimize tokens.

1. Run `python scripts/extract.py <slides-dir> <out-dir>/sources-text/`. The script:
   - Uses PyMuPDF (`page.get_text()`) to pull text from every page/slide
   - For each page, also counts embedded images and measures text length
   - Writes one `<source>.txt` of extracted text per source
   - Writes one `<source>.flags.json` listing pages where text is sparse (<50 words) or image-heavy — these are the pages that need vision
   - For flagged pages only, renders a PNG to `<out-dir>/assets/<source>/slide_NNN.png`

2. For each source, launch one extraction agent in parallel (`run_in_background: true`):
   - Give it the extracted text file
   - Give it the list of flagged page images (if any) to read with the Read tool
   - Tell it to produce `sources/<source-name>.md` — exhaustive, faithful, no teaching tone
   - Frontmatter: `source`, `pages`, `topics` (detected), `has_code`, `has_diagrams`

If no pages are flagged for a source, the agent runs on text only — no image tokens spent.

---

## Stage 2 — Compilation & grouping

**Goal:** produce `chapter-plan.yaml` that maps source MDs into chapters. A chapter may pull from multiple sources. A source may appear in multiple chapters if its content spans topics.

Single agent reads:
- All source MD frontmatter + section headings (not full bodies — keeps tokens down)
- Quiz files if present (full content — small)

It outputs:

```yaml
course:
  title: "<inferred or asked>"
  subtitle: "<optional>"
chapters:
  - id: permissions
    title: Android Runtime Permissions
    order: 1
    sources: [14-AskingForAPermission.md, 16-AskingForSeveralPermissions.md]
    topics: [runtime-permissions, ActivityResultContracts]
    related_quiz_questions: [pq-3, pq-7]
  - ...
```

**Stop here and show the plan to the user.** They review and edit `chapter-plan.yaml` before stage 3 runs. Re-running stage 3 only re-synthesizes chapters whose plan or sources changed.

---

## Stage 3 — Chapter synthesis

**Goal:** for each chapter in the plan, write a textbook chapter that *teaches* the topic, using the listed source MDs as ground truth.

For each chapter, launch one synthesis agent in parallel. Each agent gets:
- The chapter entry from the plan
- Full bodies of the listed source MDs
- Any quiz questions tagged to this chapter

It writes `chapters/<order>-<id>.md` with:

```yaml
---
id: permissions
title: Android Runtime Permissions
order: 1
topics: [runtime-permissions, ActivityResultContracts]
sources: [14-AskingForAPermission.md, 16-AskingForSeveralPermissions.md]
---
```

Body structure (enforce in the prompt, not the schema):
1. **Why this matters** — motivation, the problem being solved
2. **Core concepts** — taught from scratch, with analogies where useful
3. **Mechanics** — APIs, code, step-by-step
4. **Worked example(s)**
5. **Key takeaways** — short bulleted summary
6. **Practice questions** — inline `:::question` blocks (see format below)

**Question block format** (parsed by the UI):

````markdown
:::question id=pq-3 type=mc source=practice-quiz
**Q:** Which class do you use to register for a permission result callback?

- [ ] Intent
- [x] ActivityResultLauncher
- [ ] PermissionManager

**Answer:** ActivityResultLauncher

**Explanation:** `ActivityResultLauncher` is returned by `registerForActivityResult` and is what you `.launch()` to trigger the permission dialog. The callback you passed to `registerForActivityResult` fires with the user's choice.
:::
````

`type` can be `mc` (multiple choice), `short` (free response), or `fill` (fill-in-the-blank). `source` can be `practice-quiz`, `predicted`, or `generated`.

Generate practice questions even if no quiz was provided — aim for 3–6 per chapter covering the most quiz-worthy facts.

---

## Stage 4 — Manifest + UI

After all chapters are written:

1. Read every chapter's frontmatter; build `manifest.json`:
   ```json
   {
     "course": { "title": "...", "subtitle": "..." },
     "chapters": [
       { "id": "permissions", "title": "...", "order": 1, "file": "chapters/01-permissions.md", "topics": [...] }
     ]
   }
   ```
2. Copy `ui-template/{index.html,app.js,app.css}` into `study-output/`
3. Tell the user to open `study-output/index.html`

---

## Operational notes

- **Always run extraction agents in parallel** in a single message with `run_in_background: true`
- **Always run synthesis agents in parallel** the same way
- **Never re-extract** if `sources/` already has the source MD — only re-run when the source PDF changed
- **Never re-synthesize** chapters whose plan entry and source MDs are unchanged
- If an agent fails to write its file, re-launch — previous work isn't recoverable
- If the user provides a *completed* practice quiz, treat the answers as ground truth for explanations. If *blank*, derive answers from source material and flag uncertainty.
- The extraction script's image fallback exists to avoid burning tokens on image-only slides. If a deck is mostly diagrams, expect more pages to be flagged — that's correct behavior.

## Files in this skill

- `SKILL.md` — this file
- `scripts/extract.py` — hybrid PDF/PPTX text + selective image extractor
- `ui-template/index.html` — standard UI, vanilla JS, no build step
- `ui-template/app.js` — manifest loader, MD renderer, question widget, search, TOC
- `ui-template/app.css` — dark theme inspired by GitHub-style code docs
