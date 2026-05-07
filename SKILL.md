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

For each chapter, launch one synthesis agent in parallel. Use this exact prompt template for every agent (fill in the `<PLACEHOLDERS>`):

```
Write a textbook chapter for the following topic. Use the source material below as
your only source of truth — do not invent facts the sources don't cover.

Chapter plan entry:
<PASTE YAML ENTRY FROM chapter-plan.yaml>

Source material:
<PASTE FULL BODY OF EACH LISTED SOURCE MD>

Quiz questions to embed (if any):
<PASTE RELEVANT QUESTIONS>

Output a single markdown file to: chapters/<ORDER>-<ID>.md

STRUCTURE (in this order):
1. YAML frontmatter block (id, title, order, topics, sources)
2. ## Why this matters
3. ## Core concepts
4. ## Mechanics
5. ## Worked example
6. ## Key takeaways
7. ## Practice questions  ← embed ALL provided quiz questions here, plus generate 3–6 more

QUESTION FORMAT — every question must use this EXACT format. No exceptions:

:::question id=<unique-id> type=<mc|short|fill> source=<practice-quiz|predicted|generated>
**Q:** Question text here

- [ ] Wrong option
- [x] Correct option
- [ ] Wrong option

**Answer:** Short answer text

**Explanation:** Full explanation here.
:::

RULES (breaking any causes the question to not display):
- Opening line: :::question followed by space-separated key=value. NO curly braces. NO quotes.
- id must be unique across all chapters. Prefix generated questions with gen-<chapter-id>-<n>.
- Exactly one - [x] per mc question. All other options use - [ ].
- **Q:**, **Answer:**, **Explanation:** each on their own line with that exact spelling.
- The block MUST end with ::: on its own line. Without it the block is invisible.
- For short/fill questions: omit the option list entirely.
- Only write questions about content that appears in the source material.

BANNED FORMATS (do not use any of these):
  :::question{id="x" type="mc"}     ← curly braces not allowed
  ::: answer foo :::                 ← not a valid closing
  source: generated\nprompt: ...     ← YAML inside the block not allowed
  choices:\n  - text: foo\n    correct: true  ← YAML options not allowed
```

Each agent writes `chapters/<order>-<id>.md` with:

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

**Question block format** (parsed by the UI — follow this exactly):

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

**Rules — violating any of these causes the question to not render:**
- The opening line is `:::question` followed by space-separated `key=value` pairs. No curly braces. No quotes around values.
- `id` must be unique across all chapters (e.g., `pq-1`, `gen-permissions-1`).
- `type` must be exactly `mc`, `short`, or `fill`.
- `source` must be exactly `practice-quiz`, `predicted`, or `generated`.
- The question text line starts with `**Q:**` on its own line.
- Multiple-choice options each start with `- [ ]` (wrong) or `- [x]` (correct, exactly one per question).
- `**Answer:**` and `**Explanation:**` are on their own lines.
- The block closes with `:::` on its own line. This closing `:::` is required — without it the block is ignored.
- Do NOT write `:::question{...}`, `::: answer`, `source: generated prompt:`, `choices:`, or any other format. Only the format above is parsed.

**Wrong (do not use):**
````markdown
:::question{id="pq-1" type="mc"}
source: generated prompt: Which class...
choices:
- text: Intent correct: false
- text: ActivityResultLauncher correct: true
::: answer ActivityResultLauncher :::
````

**Correct:**
````markdown
:::question id=gen-permissions-1 type=mc source=generated
**Q:** Which class do you use to register for a permission result callback?

- [ ] Intent
- [x] ActivityResultLauncher
- [ ] PermissionManager

**Answer:** ActivityResultLauncher

**Explanation:** ActivityResultLauncher is returned by registerForActivityResult.
:::
````

`type` values:
- `mc` — multiple choice, requires `- [ ]` / `- [x]` options
- `short` — free-response text input, no options
- `fill` — fill-in-the-blank text input, no options

`source` values: `practice-quiz`, `predicted`, `generated`

Generate practice questions even if no quiz was provided — aim for 3–6 per chapter covering the most quiz-worthy facts. Every question MUST use the exact format above.

---

## Stage 4 — Validate question blocks

Before building the manifest, run:

```bash
python scripts/validate.py <project>/chapters/
```

- Exit 0: all blocks parsed correctly — proceed to Stage 5.
- Exit 1: lists every chapter file with invalid blocks and the specific error per block. Re-run the synthesis agent for each failing chapter (pass it the same inputs plus the validation errors so it knows what to fix). Repeat until `validate.py` exits 0.

---

## Stage 5 — Manifest + UI

After validation passes:

1. Read every chapter's frontmatter; build `manifest.json`:
   ```json
   {
     "course": { "title": "...", "subtitle": "..." },
     "chapters": [
       { "id": "permissions", "title": "...", "order": 1, "file": "chapters/01-permissions.md", "topics": [...] }
     ]
   }
   ```
2. Copy `ui-template/{index.html,app.js,app.css}` and the `chapters/` folder into `study-output/`
3. Start a local HTTP server from `study-output/` in the background:
   ```bash
   cd <project>/study-output && python -m http.server 8000
   ```
4. Tell the user to open **http://localhost:8000** in their browser. Do NOT tell them to open `index.html` directly — `file://` blocks `fetch()` and the site will fail to load.

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
