// Study Guide UI — vanilla JS, no build step.
// Reads manifest.json + chapters/*.md and renders an interactive textbook.

const state = {
  manifest: null,
  chapters: [], // { meta, html, questions }
};

// ---------- Frontmatter parser ----------
function parseFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: md };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      val = val.slice(1, -1).split(",").map(s => s.trim()).filter(Boolean);
    }
    meta[key] = val;
  }
  return { meta, body: m[2] };
}

// ---------- Question block extraction ----------
// Canonical format:  :::question id=pq-3 type=mc source=practice-quiz
// Fallback format:   :::question{id="pq-3" type="mc" source="practice-quiz"}
// Both close with a lone ::: on its own line.
const QUESTION_RE = /:::question([{\s][^\n]*)\n([\s\S]*?)\n:::/g;

function parseAttrs(attrLine) {
  const attrs = {};
  // strip surrounding braces if present
  const stripped = attrLine.replace(/^\{|\}$/g, "").trim();
  // match key=value or key="value"
  const re = /(\w+)=["']?([^"'\s}]+)["']?/g;
  let m;
  while ((m = re.exec(stripped)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

function extractQuestions(body, chapterMeta) {
  const questions = [];
  const replaced = body.replace(QUESTION_RE, (_, attrLine, content) => {
    const attrs = parseAttrs(attrLine);
    const q = parseQuestionContent(content, attrs, chapterMeta);
    questions.push(q);
    return `<div class="question-anchor" data-qid="${q.id}"></div>`;
  });
  return { body: replaced, questions };
}

function parseQuestionContent(content, attrs, chapterMeta) {
  const lines = content.split("\n");
  let questionText = "", answer = "", explanation = "";
  const options = [];
  let mode = "q";
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\*\*Q:\*\*/i.test(line)) { questionText = line.replace(/^\*\*Q:\*\*\s*/i, ""); mode = "q"; continue; }
    if (/^\*\*Answer:\*\*/i.test(line)) { answer = line.replace(/^\*\*Answer:\*\*\s*/i, ""); mode = "a"; continue; }
    if (/^\*\*Explanation:\*\*/i.test(line)) { explanation = line.replace(/^\*\*Explanation:\*\*\s*/i, ""); mode = "e"; continue; }
    const optMatch = line.match(/^- \[( |x|X)\]\s*(.+)$/);
    if (optMatch) { options.push({ correct: optMatch[1].toLowerCase() === "x", text: optMatch[2] }); mode = "o"; continue; }
    if (line.trim() === "") continue;
    if (mode === "q") questionText += "\n" + line;
    else if (mode === "a") answer += "\n" + line;
    else if (mode === "e") explanation += "\n" + line;
  }
  return {
    id: attrs.id || `q-${Math.random().toString(36).slice(2, 8)}`,
    type: attrs.type || (options.length ? "mc" : "short"),
    source: attrs.source || "generated",
    chapterId: chapterMeta.id,
    chapterTitle: chapterMeta.title,
    question: questionText.trim(),
    options,
    answer: answer.trim(),
    explanation: explanation.trim(),
  };
}

// ---------- Question rendering ----------
function renderQuestion(q) {
  const el = document.createElement("div");
  el.className = "quiz-question";
  el.dataset.qid = q.id;

  const labelMap = { "practice-quiz": "Practice Quiz", "predicted": "Predicted Question", "generated": "Practice Question" };
  const label = labelMap[q.source] || "Question";

  let optionsHtml = "";
  if (q.type === "mc" && q.options.length) {
    optionsHtml = `<ul class="quiz-options">${q.options.map((o, i) =>
      `<li data-correct="${o.correct}" data-idx="${i}">${escapeHtml(o.text)}</li>`).join("")}</ul>`;
  } else if (q.type === "short" || q.type === "fill") {
    optionsHtml = `<input type="text" class="short-answer-input" placeholder="Type your answer...">`;
  }

  el.innerHTML = `
    <div class="quiz-label">${label}</div>
    <div class="quiz-text">${marked.parseInline(q.question)}</div>
    ${optionsHtml}
    <div class="btn-row">
      <button class="answer-btn">Show Answer</button>
      ${q.explanation ? '<button class="toggle-btn">Show Explanation</button>' : ""}
    </div>
    <div class="answer-box"><span class="answer-text">${escapeHtml(q.answer)}</span></div>
    ${q.explanation ? `<div class="explanation">${marked.parse(q.explanation)}</div>` : ""}
  `;

  el.querySelector(".answer-btn").addEventListener("click", () => {
    el.querySelector(".answer-box").classList.toggle("visible");
    el.querySelectorAll(".quiz-options li").forEach(li => {
      li.classList.add("revealed");
      li.classList.add(li.dataset.correct === "true" ? "correct" : "wrong");
    });
  });
  const expBtn = el.querySelector(".toggle-btn");
  if (expBtn) expBtn.addEventListener("click", () => el.querySelector(".explanation").classList.toggle("visible"));

  el.querySelectorAll(".quiz-options li").forEach(li => {
    li.addEventListener("click", () => {
      el.querySelectorAll(".quiz-options li").forEach(x => x.classList.remove("selected"));
      li.classList.add("selected");
    });
  });

  return el;
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- Chapter rendering ----------
async function loadManifest() {
  const r = await fetch("manifest.json");
  if (!r.ok) throw new Error("manifest.json not found");
  return r.json();
}

async function loadChapter(file) {
  const r = await fetch(file);
  if (!r.ok) throw new Error(`Cannot load ${file}`);
  return r.text();
}

async function renderAll() {
  state.manifest = await loadManifest();

  const course = state.manifest.course || {};
  document.getElementById("course-title").textContent = course.title || "Study Guide";
  document.getElementById("hero-title").textContent = course.title || "Study Guide";
  document.getElementById("hero-subtitle").textContent = course.subtitle || "";
  document.title = course.title || "Study Guide";

  const chaptersContainer = document.getElementById("chapters-container");
  const tocDropdown = document.getElementById("toc-dropdown");
  chaptersContainer.innerHTML = "";

  const ordered = (state.manifest.chapters || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));

  for (const ch of ordered) {
    const md = await loadChapter(ch.file);
    const { meta, body: rawBody } = parseFrontmatter(md);
    const chapterMeta = { id: meta.id || ch.id, title: meta.title || ch.title };
    const { body, questions } = extractQuestions(rawBody, chapterMeta);

    const html = marked.parse(body);
    state.chapters.push({ meta: { ...ch, ...meta }, html, questions });

    const sectionId = `ch-${chapterMeta.id}`;
    const section = document.createElement("div");
    section.className = "chapter";
    section.id = sectionId;
    section.innerHTML = `
      <div class="chapter-header">
        <h2>${escapeHtml(chapterMeta.title)}</h2>
        <span class="chevron">&#9660;</span>
      </div>
      <div class="chapter-body">${html}</div>
    `;
    section.querySelector(".chapter-header").addEventListener("click", () => section.classList.toggle("collapsed"));
    chaptersContainer.appendChild(section);

    // Replace question anchors with rendered widgets
    section.querySelectorAll(".question-anchor").forEach(anchor => {
      const q = questions.find(x => x.id === anchor.dataset.qid);
      if (q) anchor.replaceWith(renderQuestion(q));
    });

    const tocLink = document.createElement("a");
    tocLink.href = `#${sectionId}`;
    tocLink.textContent = `${ch.order || ""}. ${chapterMeta.title}`.trim();
    tocDropdown.appendChild(tocLink);
  }

  buildQuestionsTab();
  setupTabs();
  setupSearch();
}

function buildQuestionsTab() {
  const container = document.getElementById("questions-container");
  container.innerHTML = "";
  for (const ch of state.chapters) {
    if (!ch.questions.length) continue;
    const header = document.createElement("h3");
    header.textContent = ch.meta.title;
    header.style.cssText = "color: var(--accent-orange); margin: 24px 0 12px; padding-bottom: 4px; border-bottom: 1px solid var(--border-light);";
    container.appendChild(header);
    for (const q of ch.questions) container.appendChild(renderQuestion(q));
  }
  if (!container.children.length) {
    container.innerHTML = '<p class="loading">No questions found.</p>';
  }
}

function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab + "-tab").classList.add("active");
    });
  });
}

function setupSearch() {
  const input = document.getElementById("search-input");
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    document.querySelectorAll(".chapter").forEach(ch => {
      const text = ch.textContent.toLowerCase();
      ch.classList.toggle("search-hidden", q && !text.includes(q));
      if (q && text.includes(q)) ch.classList.remove("collapsed");
    });
    document.querySelectorAll("#questions-container .quiz-question").forEach(qe => {
      const text = qe.textContent.toLowerCase();
      qe.classList.toggle("search-hidden", q && !text.includes(q));
    });
  });
}

renderAll().catch(err => {
  document.getElementById("chapters-container").innerHTML =
    `<p class="loading">Error loading study guide: ${escapeHtml(err.message)}<br><br>Make sure manifest.json and chapters/ are in the same folder as this index.html, and that you're serving over http (not file://).</p>`;
  console.error(err);
});
