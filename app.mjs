import {
  buildAttemptExport,
  buildCanvasSubmission,
  buildPlainTextSummary,
  countAnsweredQuestions,
  getChoiceLabel,
  gradeQuiz,
  normalizeQuizPack,
  validateQuizPack,
} from "./quiz-core.mjs?v=3";

// ─── Constants ───────────────────────────────────────────────────────────────

const LIKERT_OPTIONS = [
  { id: "very-confident", label: "Very confident" },
  { id: "somewhat-confident", label: "Somewhat confident" },
  { id: "neutral", label: "Neutral" },
  { id: "not-very-confident", label: "Not very confident" },
  { id: "not-confident-at-all", label: "Not confident at all" },
];

const CHOICE_LETTERS = "ABCDEFGHIJ";

// ─── DOM ─────────────────────────────────────────────────────────────────────

const sidebarEl = document.querySelector("#sidebar");
const rootEl = document.querySelector("#app-root");
const quizPicker = document.querySelector("#quiz-picker");
const loadQuizBtn = document.querySelector("#load-quiz-btn");
const heroEyebrow = document.querySelector("#hero-eyebrow");
const heroTitle = document.querySelector("#hero-title");
const heroText = document.querySelector("#hero-text");
const heroActions = document.querySelector("#hero-actions");

// ─── State ───────────────────────────────────────────────────────────────────

const state = {
  catalog: [],
  selectedPackPath: null,
  quiz: null,
  answers: {},
  currentQuestionIndex: 0,
  grade: null,
  submittedAt: null,
  phase: "select",
  reflections: {},
  attempts: [],
  hintUsage: {},
  imageHintUsage: {},    // questionId → boolean
  fiftyFiftyUsage: {},   // questionId → [eliminatedChoiceId, eliminatedChoiceId]
  confidence: {},         // questionId → 1-3 scale
  questionTimestamps: {},
  quizStartedAt: null,
};

// ─── Utilities ───────────────────────────────────────────────────────────────

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDuration(ms) {
  if (!ms || ms < 0) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

function updateQueryString(path) {
  const url = new URL(window.location.href);
  url.searchParams.set("quiz", path);
  window.history.replaceState({}, "", url);
}

function createDownload(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(downloadUrl);
}

// ─── Toast Notifications ─────────────────────────────────────────────────────

let toastContainer = null;

function showToast(message, type = "info") {
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.id = "toast-container";
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add("toast-visible"));
  });

  setTimeout(() => {
    toast.classList.remove("toast-visible");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ─── Auto-Save ───────────────────────────────────────────────────────────────

function autoSave() {
  if (!state.quiz) return;
  const data = {
    answers: state.answers,
    reflections: state.reflections,
    hintUsage: state.hintUsage,
    imageHintUsage: state.imageHintUsage,
    fiftyFiftyUsage: state.fiftyFiftyUsage,
    confidence: state.confidence,
    questionTimestamps: state.questionTimestamps,
    phase: state.phase,
    currentQuestionIndex: state.currentQuestionIndex,
    quizStartedAt: state.quizStartedAt instanceof Date ? state.quizStartedAt.toISOString() : state.quizStartedAt,
    grade: state.grade,
    submittedAt: state.submittedAt instanceof Date ? state.submittedAt.toISOString() : state.submittedAt,
  };
  window.localStorage.setItem(`quiz-save-${state.quiz.id}`, JSON.stringify(data));
}

function loadSave(quizId) {
  const raw = window.localStorage.getItem(`quiz-save-${quizId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearSave() {
  if (state.quiz) {
    window.localStorage.removeItem(`quiz-save-${state.quiz.id}`);
  }
}

// ─── Attempt Storage ─────────────────────────────────────────────────────────

function saveAttemptsToStorage() {
  if (!state.quiz) return;
  const key = `quiz-attempts-${state.quiz.id}`;
  const data = state.attempts.map((a) => ({
    ...a,
    submittedAt: a.submittedAt instanceof Date ? a.submittedAt.toISOString() : a.submittedAt,
    quizStartedAt: a.quizStartedAt instanceof Date ? a.quizStartedAt.toISOString() : a.quizStartedAt,
  }));
  window.localStorage.setItem(key, JSON.stringify(data));
}

function loadAttemptsFromStorage(quizId) {
  const raw = window.localStorage.getItem(`quiz-attempts-${quizId}`);
  if (!raw) return [];
  try {
    return JSON.parse(raw).map((a) => ({
      ...a,
      submittedAt: new Date(a.submittedAt),
      quizStartedAt: a.quizStartedAt ? new Date(a.quizStartedAt) : null,
    }));
  } catch {
    return [];
  }
}

function saveCanvasText(text) {
  if (!state.quiz) return;
  window.localStorage.setItem(`quiz-canvas-${state.quiz.id}`, text);
}

// ─── Progress Helpers ────────────────────────────────────────────────────────

function getCategoryProgress() {
  if (!state.quiz) return [];
  const map = new Map();

  for (const q of state.quiz.questions) {
    for (const cat of q.categories) {
      if (!map.has(cat)) map.set(cat, { name: cat, total: 0, answered: 0 });
      const entry = map.get(cat);
      entry.total++;
      if (state.answers[q.id]) entry.answered++;
    }
  }

  return [...map.values()];
}

function getUnansweredCount() {
  if (!state.quiz) return 0;
  return state.quiz.questions.filter((q) => !state.answers[q.id] || !state.confidence[q.id]).length;
}

function getAllAnswered() {
  return state.quiz && getUnansweredCount() === 0;
}

// ─── Timing ──────────────────────────────────────────────────────────────────

function recordQuestionEnter() {
  if (!state.quiz) return;
  const q = state.quiz.questions[state.currentQuestionIndex];
  if (!state.questionTimestamps[q.id]) {
    state.questionTimestamps[q.id] = { start: Date.now(), end: null };
  }
  state.questionTimestamps[q.id].lastEnter = Date.now();
}

function recordQuestionLeave() {
  if (!state.quiz) return;
  const q = state.quiz.questions[state.currentQuestionIndex];
  const ts = state.questionTimestamps[q.id];
  if (ts) ts.end = Date.now();
}

// ─── Quiz Picker Lock ────────────────────────────────────────────────────────

function lockPicker() {
  if (quizPicker) quizPicker.disabled = true;
  if (loadQuizBtn) loadQuizBtn.style.display = "none";
}

function unlockPicker() {
  if (quizPicker) quizPicker.disabled = false;
  if (loadQuizBtn) {
    loadQuizBtn.style.display = "";
    loadQuizBtn.disabled = !quizPicker?.value;
  }
}

// ─── Rendering: Hero ─────────────────────────────────────────────────────────

function renderHero() {
  if (!state.quiz) {
    document.title = "Quiz";
    heroEyebrow.textContent = "Student quiz";
    heroTitle.textContent = "Take your quiz";
    heroText.textContent =
      "Read each prompt carefully, listen when audio appears, and answer each question on your own.";
    return;
  }

  const total = state.quiz.questions.length;
  const ql = total === 1 ? "question" : "questions";
  document.title = `${state.quiz.title} | Quiz`;
  heroEyebrow.textContent = state.quiz.course || "Student quiz";
  heroTitle.textContent = state.quiz.title;
  heroText.textContent = `${total} ${ql}. Work at your own pace, listen carefully, and answer honestly.`;
}

// ─── Rendering: Sidebar ──────────────────────────────────────────────────────

function renderSidebar() {
  if (!state.quiz || state.phase === "select") {
    sidebarEl.innerHTML = `
      <div class="sidebar-panel">
        <div class="sidebar-stack">
          <section class="sidebar-section">
            <p class="eyebrow">Welcome</p>
            <h2 class="sidebar-title">Get started</h2>
            <p class="sidebar-text">Choose a quiz from the menu above, then click Load to begin.</p>
          </section>
        </div>
      </div>
    `;
    return;
  }

  if (state.phase === "intro") {
    sidebarEl.innerHTML = `
      <div class="sidebar-panel">
        <div class="sidebar-stack">
          <section class="sidebar-section">
            <p class="eyebrow">${escapeHtml(state.quiz.course || "Quiz")}</p>
            <h2 class="sidebar-title">Before you begin</h2>
            <p class="sidebar-text">${escapeHtml(state.quiz.instructions)}</p>
            <div class="meta-row">
              ${state.quiz.topic ? `<span class="meta-pill">${escapeHtml(state.quiz.topic)}</span>` : ""}
              <span class="meta-pill">${state.quiz.questions.length} questions</span>
              ${state.attempts.length > 0 ? `<span class="meta-pill">Attempt ${state.attempts.length + 1}</span>` : ""}
            </div>
          </section>
        </div>
      </div>
    `;
    return;
  }

  if (state.phase === "outro") {
    sidebarEl.innerHTML = `
      <div class="sidebar-panel">
        <div class="sidebar-stack">
          <section class="sidebar-section">
            <p class="eyebrow">Almost done</p>
            <h2 class="sidebar-title">Quick check-in</h2>
            <p class="sidebar-text">One more reflection, then you'll see your results.</p>
          </section>
        </div>
      </div>
    `;
    return;
  }

  if (state.phase === "results") {
    sidebarEl.innerHTML = `
      <div class="sidebar-panel">
        <div class="sidebar-stack">
          <section class="sidebar-section">
            <p class="eyebrow">${escapeHtml(state.quiz.course || "Results")}</p>
            <h2 class="sidebar-title">Your results</h2>
            <div class="results-card">
              <span class="metric-label">Score</span>
              <strong class="metric-value">${state.grade.correctCount}/${state.grade.totalQuestions} (${state.grade.scorePercent}%)</strong>
            </div>
          </section>
          ${state.attempts.length > 0 ? `
            <section class="sidebar-section">
              <strong>Previous attempts</strong>
              <div class="results-card-list">
                ${state.attempts.map((a, i) => `<span>Attempt ${i + 1}: ${a.grade.correctCount}/${a.grade.totalQuestions} (${a.grade.scorePercent}%)</span>`).join("")}
              </div>
            </section>
          ` : ""}
        </div>
      </div>
    `;
    return;
  }

  // ─── Quiz phase sidebar ───
  const answered = countAnsweredQuestions(state.quiz, state.answers);
  const total = state.quiz.questions.length;
  const remaining = total - answered;
  const progressPct = Math.round((answered / total) * 100);
  const categories = getCategoryProgress();

  sidebarEl.innerHTML = `
    <div class="sidebar-panel">
      <div class="sidebar-stack">
        <section class="sidebar-section">
          <p class="eyebrow">${escapeHtml(state.quiz.course || "Quiz")}</p>
          <h2 class="sidebar-title">Progress</h2>
          <div class="progress-label">
            <span>${answered} of ${total} answered</span>
            <span>${remaining > 0 ? `${remaining} left` : "All done!"}</span>
          </div>
          <div class="progress-bar" aria-hidden="true">
            <span style="width: ${progressPct}%"></span>
          </div>
          ${state.attempts.length > 0 ? `<p class="sidebar-text">Attempt ${state.attempts.length + 1}</p>` : ""}
        </section>

        <section class="sidebar-section">
          <strong class="sidebar-label">Categories</strong>
          <div class="category-progress">
            ${categories.map((c) => `
              <div class="category-row ${c.answered === c.total ? "is-complete" : ""}">
                <span class="category-name">${escapeHtml(c.name)}</span>
                <span class="category-count">${c.answered}/${c.total}</span>
              </div>
            `).join("")}
          </div>
        </section>

        <section class="sidebar-section">
          <div class="question-jump-grid" aria-label="Question navigation">
            ${state.quiz.questions.map((q, i) => `
              <button
                class="question-jump ${i === state.currentQuestionIndex ? "is-current" : ""} ${state.answers[q.id] ? "is-answered" : ""}"
                type="button"
                data-jump-index="${i}"
                aria-label="Question ${i + 1}${state.answers[q.id] ? " (answered)" : ""}"
              >${i + 1}</button>
            `).join("")}
          </div>
        </section>
      </div>
    </div>
  `;

  sidebarEl.querySelectorAll("[data-jump-index]").forEach((btn) => {
    btn.addEventListener("click", () => {
      recordQuestionLeave();
      state.currentQuestionIndex = Number(btn.dataset.jumpIndex);
      recordQuestionEnter();
      render();
    });
  });
}

// ─── Rendering: Select (no quiz loaded) ──────────────────────────────────────

function renderSelect() {
  rootEl.innerHTML = `
    <section class="empty-state">
      <p class="eyebrow">No quiz loaded</p>
      <h2>Choose a quiz to begin</h2>
      <p class="sidebar-text">Select your assigned quiz from the dropdown above and click <strong>Load quiz</strong>.</p>
    </section>
  `;
}

// ─── Rendering: Intro ────────────────────────────────────────────────────────

function renderIntro() {
  const preFeeling = state.reflections["pre-feeling"] ?? "";
  const prePrep = state.reflections["pre-prep"] ?? "";

  rootEl.innerHTML = `
    <section class="question-card">
      <div class="stage-stack">
        <header class="question-header">
          <span class="question-kind">reflection</span>
          <h2 class="question-title">Before you start</h2>
          <p class="question-caption">Take a moment to check in with yourself. These reflections are part of your submission.</p>
        </header>

        <div class="reflection-group">
          <label class="reflection-label">How are you feeling about this quiz?</label>
          <div class="likert-options" id="pre-feeling-options">
            ${LIKERT_OPTIONS.map((opt) => `
              <label class="likert-option ${preFeeling === opt.id ? "is-selected" : ""}">
                <input type="radio" name="pre-feeling" value="${escapeHtml(opt.id)}" ${preFeeling === opt.id ? "checked" : ""}>
                <span>${escapeHtml(opt.label)}</span>
              </label>
            `).join("")}
          </div>
        </div>

        <div class="reflection-group">
          <label class="reflection-label" for="pre-prep">What did you do to prepare, if anything?</label>
          <textarea id="pre-prep" class="reflection-textarea" placeholder="E.g., reviewed notes, listened to examples, nothing yet..." rows="3">${escapeHtml(prePrep)}</textarea>
        </div>

        <div class="question-actions">
          <button class="primary-button full-width" id="start-quiz-btn" type="button">Start the quiz</button>
        </div>
      </div>
    </section>
  `;

  rootEl.querySelector("#pre-feeling-options").addEventListener("change", (e) => {
    state.reflections["pre-feeling"] = e.target.value;
    rootEl.querySelectorAll(".likert-option").forEach((el) => {
      el.classList.toggle("is-selected", el.querySelector("input").checked);
    });
    autoSave();
  });

  rootEl.querySelector("#pre-prep").addEventListener("input", (e) => {
    state.reflections["pre-prep"] = e.target.value;
    autoSave();
  });

  rootEl.querySelector("#start-quiz-btn").addEventListener("click", () => {
    if (!state.reflections["pre-feeling"]) {
      showToast("Please share how you're feeling before starting.", "error");
      return;
    }
    if (!state.reflections["pre-prep"]?.trim()) {
      showToast("Please share what you did to prepare (even if nothing).", "error");
      return;
    }
    state.phase = "quiz";
    state.quizStartedAt = new Date();
    state.currentQuestionIndex = 0;
    recordQuestionEnter();
    autoSave();
    render();
    showToast("Good luck! Work through the questions at your own pace.", "success");
  });
}

// ─── Rendering: Media & Hints ────────────────────────────────────────────────

function renderMedia(question) {
  if (!question.media.length) return "";
  const audioHtml = question.media.filter((m) => m.type !== "image").map((m) => {
    return `
      <div class="media-card">
        <strong>${escapeHtml(m.title || "Audio example")}</strong>
        ${m.caption ? `<p class="sidebar-text">${escapeHtml(m.caption)}</p>` : ""}
        <audio controls preload="metadata" src="${escapeHtml(m.resolvedSrc)}"></audio>
      </div>`;
  }).join("");
  // Show revealed image hints in the main media area (full-width, above choices)
  const imageHtml = state.imageHintUsage[question.id]
    ? question.media.filter((m) => m.type === "image").map((m) => `
        <div class="media-card media-image">
          <img src="${escapeHtml(m.resolvedSrc)}" alt="${escapeHtml(m.alt || m.title || "Diagram")}" loading="lazy">
        </div>`).join("")
    : "";
  return audioHtml + imageHtml;
}

function renderImageHintButton(question) {
  if (!state.quiz.settings.enableHints) return "";
  const imageMedia = question.media.filter((m) => m.type === "image");
  if (!imageMedia.length) return "";
  if (state.imageHintUsage[question.id]) return "";
  return `<button class="secondary-button hint-button" id="image-hint-btn" type="button">🖼️ Show image hint</button>`;
}

function renderHintButton(question) {
  if (!state.quiz.settings.enableHints || !question.hint) return "";
  if (state.hintUsage[question.id]) {
    return `
      <div class="hint-revealed">
        <strong class="hint-label">💡 Text Hint</strong>
        <p class="sidebar-text">${escapeHtml(question.hint)}</p>
      </div>
    `;
  }
  return `<button class="secondary-button hint-button" id="hint-btn" type="button">💡 Show text hint</button>`;
}

function renderFiftyFiftyButton(question) {
  if (!state.quiz.settings.enableFiftyFifty) return "";
  if (state.fiftyFiftyUsage[question.id]) {
    return `<button class="secondary-button fifty-fifty-button is-used" disabled>50:50 used</button>`;
  }
  return `<button class="secondary-button fifty-fifty-button" id="fifty-fifty-btn" type="button">50:50</button>`;
}

function getFiftyFiftyEliminated(question) {
  if (!state.fiftyFiftyUsage[question.id]) return [];
  return state.fiftyFiftyUsage[question.id];
}

function computeFiftyFiftyChoices(question) {
  // Eliminate 2 wrong answers (or half of wrong answers if fewer than 4 choices)
  const wrongChoices = question.choices.filter((c) => c.id !== question.correctAnswer);
  const selectedAnswer = state.answers[question.id];
  // Don't eliminate the currently selected answer
  const eliminatable = wrongChoices.filter((c) => c.id !== selectedAnswer);
  // Shuffle and pick 2 (or as many as available)
  const shuffled = eliminatable.sort(() => Math.random() - 0.5);
  const count = Math.min(2, shuffled.length);
  return shuffled.slice(0, count).map((c) => c.id);
}

function renderConfidenceSlider(question) {
  const current = state.confidence[question.id] ?? 0;
  const labels = ["", "Guessing", "Somewhat sure", "Confident"];
  return `
    <div class="confidence-drawer is-open ${current ? "is-set" : ""}" id="confidence-drawer">
      <div class="confidence-header">
        <span class="confidence-toggle-icon">${current ? "✓" : "◉"}</span>
        <span>How confident are you?${current ? ` <strong>${labels[current]}</strong>` : ""}</span>
      </div>
      <div class="confidence-panel" id="confidence-panel">
        <div class="confidence-track">
          ${[1, 2, 3].map((n) => `
            <button class="confidence-dot ${current === n ? "is-active" : ""}" data-level="${n}" type="button" title="${labels[n]}">
              <span class="confidence-dot-fill"></span>
              <span class="confidence-dot-label">${labels[n]}</span>
            </button>
          `).join("")}
        </div>
      </div>
    </div>
  `;
}

// ─── Rendering: Question ─────────────────────────────────────────────────────

function renderQuestion() {
  const question = state.quiz.questions[state.currentQuestionIndex];
  const selectedAnswer = state.answers[question.id] ?? "";
  const isFirst = state.currentQuestionIndex === 0;
  const isLast = state.currentQuestionIndex === state.quiz.questions.length - 1;
  const remaining = getUnansweredCount();
  const allDone = remaining === 0;
  const eliminated = getFiftyFiftyEliminated(question);

  rootEl.innerHTML = `
    <article class="question-card">
      <div class="stage-stack">
        <header class="question-header">
          <div class="question-meta-row">
            <span class="question-number">Question ${state.currentQuestionIndex + 1} of ${state.quiz.questions.length}</span>
            ${question.categories.length ? question.categories.map((c) => `<span class="tag-pill">${escapeHtml(c)}</span>`).join("") : ""}
          </div>
          <h2 class="question-title">${escapeHtml(question.prompt)}</h2>
        </header>

        ${renderMedia(question)}

        <form id="question-form" class="question-choices">
          <fieldset class="question-choices">
            <legend class="sr-only">Answer choices</legend>
            ${question.choices.map((choice, ci) => {
              const isEliminated = eliminated.includes(choice.id);
              return `
              <label class="choice-option ${selectedAnswer === choice.id ? "is-selected" : ""} ${isEliminated ? "is-eliminated" : ""}">
                <input type="radio" name="answer" value="${escapeHtml(choice.id)}" ${selectedAnswer === choice.id ? "checked" : ""} ${isEliminated ? "disabled" : ""}>
                <span class="choice-letter">${CHOICE_LETTERS[ci]}</span>
                <span class="choice-text">${escapeHtml(choice.label)}</span>
              </label>`;
            }).join("")}
          </fieldset>
        </form>

        <div class="question-tools">
          ${renderHintButton(question)}
          ${renderImageHintButton(question)}
          ${renderFiftyFiftyButton(question)}
        </div>

        ${renderConfidenceSlider(question)}

        <div class="question-nav">
          <div class="nav-group">
            <button class="nav-button" id="prev-btn" type="button" ${isFirst ? "disabled" : ""}>Previous</button>
            <button class="nav-button" id="next-btn" type="button" ${isLast ? "disabled" : ""}>Next</button>
          </div>
          ${allDone
            ? `<button class="primary-button" id="submit-btn" type="button">Submit quiz</button>`
            : `<span class="remaining-count">${remaining} question${remaining === 1 ? "" : "s"} remaining</span>`
          }
        </div>
      </div>
    </article>
  `;

  rootEl.querySelector("#question-form").addEventListener("change", (e) => {
    state.answers[question.id] = e.target.value;
    rootEl.querySelectorAll(".choice-option").forEach((el) => {
      el.classList.toggle("is-selected", el.querySelector("input").checked);
    });
    renderSidebar();
    autoSave();
    showToast("Answer saved", "success");

    // Update remaining count or show submit button
    const newRemaining = getUnansweredCount();
    if (newRemaining === 0) {
      render();
      showToast("All questions answered — ready to submit!", "success");
    } else {
      const countEl = rootEl.querySelector(".remaining-count");
      if (countEl) countEl.textContent = `${newRemaining} question${newRemaining === 1 ? "" : "s"} remaining`;
    }
  });

  rootEl.querySelector("#prev-btn").addEventListener("click", () => {
    if (state.currentQuestionIndex > 0) {
      recordQuestionLeave();
      state.currentQuestionIndex -= 1;
      recordQuestionEnter();
      autoSave();
      render();
    }
  });

  rootEl.querySelector("#next-btn").addEventListener("click", () => {
    if (state.currentQuestionIndex < state.quiz.questions.length - 1) {
      recordQuestionLeave();
      state.currentQuestionIndex += 1;
      recordQuestionEnter();
      autoSave();
      render();
    }
  });

  const submitBtn = rootEl.querySelector("#submit-btn");
  if (submitBtn) {
    submitBtn.addEventListener("click", submitQuiz);
  }

  const hintBtn = rootEl.querySelector("#hint-btn");
  if (hintBtn) {
    hintBtn.addEventListener("click", () => {
      state.hintUsage[question.id] = true;
      autoSave();
      render();
    });
  }

  const imageHintBtn = rootEl.querySelector("#image-hint-btn");
  if (imageHintBtn) {
    imageHintBtn.addEventListener("click", () => {
      state.imageHintUsage[question.id] = true;
      autoSave();
      render();
    });
  }

  // 50:50 button
  const fiftyBtn = rootEl.querySelector("#fifty-fifty-btn");
  if (fiftyBtn) {
    fiftyBtn.addEventListener("click", () => {
      const toEliminate = computeFiftyFiftyChoices(question);
      state.fiftyFiftyUsage[question.id] = toEliminate;
      autoSave();
      // Animate elimination
      toEliminate.forEach((choiceId) => {
        const label = rootEl.querySelector(`input[value="${choiceId}"]`)?.closest(".choice-option");
        if (label) {
          label.classList.add("is-eliminated");
          label.querySelector("input").disabled = true;
        }
      });
      fiftyBtn.disabled = true;
      fiftyBtn.classList.add("is-used");
      fiftyBtn.textContent = "50:50 used";
      showToast("Two answers eliminated!", "success");
    });
  }

  // Confidence slider
  const confidencePanel = rootEl.querySelector("#confidence-panel");
  if (confidencePanel) {
    confidencePanel.querySelectorAll(".confidence-dot").forEach((dot) => {
      dot.addEventListener("click", () => {
        const level = parseInt(dot.dataset.level, 10);
        state.confidence[question.id] = level;
        autoSave();
        // Update UI
        confidencePanel.querySelectorAll(".confidence-dot").forEach((d) => {
          d.classList.toggle("is-active", parseInt(d.dataset.level, 10) === level);
        });
        const drawer = rootEl.querySelector("#confidence-drawer");
        drawer.classList.add("is-set");
        const labels = ["", "Guessing", "Somewhat sure", "Confident"];
        const header = drawer.querySelector(".confidence-header");
        header.querySelector("span:last-child").innerHTML =
          `How confident are you? <strong>${labels[level]}</strong>`;
        header.querySelector(".confidence-toggle-icon").textContent = "✓";
      });
    });
  }
}

// ─── Rendering: Outro ────────────────────────────────────────────────────────

function renderOutro() {
  const postFeeling = state.reflections["post-feeling"] ?? "";

  rootEl.innerHTML = `
    <section class="question-card">
      <div class="stage-stack">
        <header class="question-header">
          <span class="question-kind">reflection</span>
          <h2 class="question-title">You finished!</h2>
          <p class="question-caption">Before you see your results, one more quick check-in.</p>
        </header>

        <div class="reflection-group">
          <label class="reflection-label">How are you feeling now that you've finished?</label>
          <div class="likert-options" id="post-feeling-options">
            ${LIKERT_OPTIONS.map((opt) => `
              <label class="likert-option ${postFeeling === opt.id ? "is-selected" : ""}">
                <input type="radio" name="post-feeling" value="${escapeHtml(opt.id)}" ${postFeeling === opt.id ? "checked" : ""}>
                <span>${escapeHtml(opt.label)}</span>
              </label>
            `).join("")}
          </div>
        </div>

        <div class="canvas-reminder">
          After you see your results, you'll need to <strong>copy your submission and paste it into Canvas</strong>.
        </div>

        <div class="question-actions">
          <button class="primary-button full-width" id="see-results-btn" type="button">See my results</button>
        </div>
      </div>
    </section>
  `;

  rootEl.querySelector("#post-feeling-options").addEventListener("change", (e) => {
    state.reflections["post-feeling"] = e.target.value;
    rootEl.querySelectorAll(".likert-option").forEach((el) => {
      el.classList.toggle("is-selected", el.querySelector("input").checked);
    });
    autoSave();
  });

  rootEl.querySelector("#see-results-btn").addEventListener("click", () => {
    if (!state.reflections["post-feeling"]) {
      showToast("Please share how you're feeling before seeing your results.", "error");
      return;
    }
    state.phase = "results";
    autoSave();
    render();
  });
}

// ─── Rendering: Results ──────────────────────────────────────────────────────

function renderResults() {
  const postPlan = state.reflections["post-plan"] ?? "";

  const currentAttemptData = {
    attemptNumber: state.attempts.length + 1,
    reflections: { ...state.reflections },
    answers: { ...state.answers },
    grade: state.grade,
    hintUsage: { ...state.hintUsage },
    imageHintUsage: { ...state.imageHintUsage },
    fiftyFiftyUsage: { ...state.fiftyFiftyUsage },
    confidence: { ...state.confidence },
    questionTimestamps: { ...state.questionTimestamps },
    quizStartedAt: state.quizStartedAt,
    submittedAt: state.submittedAt,
  };

  rootEl.innerHTML = `
    <section class="results-shell">
      <div class="results-stack">
        <header class="results-header">
          <p class="eyebrow">Quiz complete</p>
          <h2 class="results-title">${escapeHtml(state.quiz.title)}</h2>
          <p class="results-caption">
            Review your answers below, then copy your submission to paste into Canvas.
          </p>
          <div class="results-metrics">
            <div class="metric-card">
              <span class="metric-label">Score</span>
              <span class="metric-value">${state.grade.correctCount}/${state.grade.totalQuestions}</span>
            </div>
            <div class="metric-card">
              <span class="metric-label">Percent</span>
              <span class="metric-value">${state.grade.scorePercent}%</span>
            </div>
            <div class="metric-card">
              <span class="metric-label">Submitted</span>
              <span class="metric-value">${escapeHtml(state.submittedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}</span>
            </div>
            ${state.attempts.length > 0 ? `
              <div class="metric-card">
                <span class="metric-label">Attempt</span>
                <span class="metric-value">${state.attempts.length + 1}</span>
              </div>
            ` : ""}
          </div>
        </header>

        ${state.grade.categoryBreakdown.length ? `
          <section class="results-card">
            <strong>Category breakdown</strong>
            <div class="results-card-list">
              ${state.grade.categoryBreakdown.map((b) =>
                `<span><strong>${escapeHtml(b.category)}:</strong> ${b.correct}/${b.total}</span>`
              ).join("")}
            </div>
          </section>
        ` : ""}

        <section class="review-list">
          ${state.quiz.questions.map((question, index) => {
            const sel = state.answers[question.id] ?? null;
            const isCorrect = sel === question.correctAnswer;
            const ts = state.questionTimestamps[question.id];
            const timeSpent = ts && ts.end && ts.start ? ts.end - ts.start : null;
            const usedHint = state.hintUsage[question.id] ?? false;
            const usedFiftyFifty = !!state.fiftyFiftyUsage[question.id];
            const confLevel = state.confidence[question.id] ?? 0;
            const confLabels = ["", "Guessing", "Somewhat sure", "Confident"];
            return `
              <article class="review-card ${isCorrect ? "is-correct" : "is-incorrect"}">
                <div class="review-header">
                  <div>
                    <p class="eyebrow">Question ${index + 1}${question.categories.length ? ` · ${question.categories.join(", ")}` : ""}</p>
                    <h3 class="review-title">${escapeHtml(question.prompt)}</h3>
                  </div>
                  <span class="review-badge ${isCorrect ? "is-correct" : "is-incorrect"}">
                    ${isCorrect ? "Correct" : "Incorrect"}
                  </span>
                </div>
                <div class="results-card-list">
                  <span><strong>Your answer:</strong> ${escapeHtml(getChoiceLabel(question, sel))}</span>
                  ${!isCorrect ? `<span><strong>Correct answer:</strong> ${escapeHtml(getChoiceLabel(question, question.correctAnswer))}</span>` : ""}
                  ${timeSpent ? `<span><strong>Time:</strong> ${formatDuration(timeSpent)}</span>` : ""}
                  ${confLevel ? `<span><strong>Confidence:</strong> ${confLabels[confLevel]}</span>` : ""}
                  ${usedHint ? `<span><strong>Hint used:</strong> Yes</span>` : ""}
                  ${usedFiftyFifty ? `<span><strong>50:50 used:</strong> Yes</span>` : ""}
                  ${question.explanation ? `<span class="explanation-text"><strong>Explanation:</strong> ${escapeHtml(question.explanation)}</span>` : ""}
                </div>
              </article>
            `;
          }).join("")}
        </section>

        <section class="reflection-section">
          <div class="reflection-group">
            <label class="reflection-label" for="post-plan">Based on your results, what might you focus on if you study again or retake this quiz?</label>
            <textarea id="post-plan" class="reflection-textarea" placeholder="E.g., I should review filter types more, practice identifying frequencies..." rows="3">${escapeHtml(postPlan)}</textarea>
          </div>
        </section>

        <section class="canvas-section">
          <h3 class="canvas-heading">Submit to Canvas</h3>
          <p class="sidebar-text">Copy the text below and paste it into your Canvas assignment submission. Don't forget this step!</p>
          <div class="canvas-actions">
            <button class="primary-button" id="copy-canvas-btn" type="button">Copy submission for Canvas</button>
            <button class="secondary-button" id="download-txt-btn" type="button">Download as text</button>
          </div>
        </section>

        <section class="retake-section">
          <button class="ghost-button" id="retake-btn" type="button">Take quiz again</button>
        </section>
      </div>
    </section>
  `;

  rootEl.querySelector("#post-plan").addEventListener("input", (e) => {
    state.reflections["post-plan"] = e.target.value;
    autoSave();
  });

  rootEl.querySelector("#copy-canvas-btn").addEventListener("click", async () => {
    const btn = rootEl.querySelector("#copy-canvas-btn");
    const currentData = { ...currentAttemptData, reflections: { ...state.reflections } };
    const allData = [...state.attempts, currentData];
    const text = buildCanvasSubmission(state.quiz, allData);
    saveCanvasText(text);

    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "Copied!";
      btn.classList.add("is-copied");
      showToast("Copied! Paste this into your Canvas assignment.", "success");
      setTimeout(() => {
        btn.textContent = "Copy submission for Canvas";
        btn.classList.remove("is-copied");
      }, 3000);
    } catch {
      showToast("Clipboard copy failed. Use the download button instead.", "error");
    }
  });

  rootEl.querySelector("#download-txt-btn").addEventListener("click", () => {
    const currentData = { ...currentAttemptData, reflections: { ...state.reflections } };
    const allData = [...state.attempts, currentData];
    const text = buildCanvasSubmission(state.quiz, allData);
    saveCanvasText(text);
    createDownload(`${state.quiz.id}-submission.txt`, `${text}\n`, "text/plain;charset=utf-8");
    showToast("Submission downloaded.", "success");
  });

  rootEl.querySelector("#retake-btn").addEventListener("click", () => {
    if (!confirm("Start a new attempt? Your current results are saved.")) return;

    const attemptRecord = {
      attemptNumber: state.attempts.length + 1,
      reflections: { ...state.reflections },
      answers: { ...state.answers },
      grade: state.grade,
      hintUsage: { ...state.hintUsage },
      fiftyFiftyUsage: { ...state.fiftyFiftyUsage },
      confidence: { ...state.confidence },
      questionTimestamps: { ...state.questionTimestamps },
      quizStartedAt: state.quizStartedAt,
      submittedAt: state.submittedAt,
    };
    state.attempts.push(attemptRecord);
    saveAttemptsToStorage();

    state.answers = {};
    state.grade = null;
    state.submittedAt = null;
    state.currentQuestionIndex = 0;
    state.phase = "intro";
    state.reflections = {};
    state.hintUsage = {};
    state.imageHintUsage = {};
    state.fiftyFiftyUsage = {};
    state.confidence = {};
    state.questionTimestamps = {};
    state.quizStartedAt = null;
    autoSave();
    render();
    showToast("Starting a new attempt. Your previous results are saved.", "success");
  });
}

// ─── Rendering: Empty / Error ────────────────────────────────────────────────

function renderEmptyState(title, description) {
  renderHero();
  rootEl.innerHTML = `
    <section class="empty-state">
      <p class="eyebrow">Quiz unavailable</p>
      <h2>${escapeHtml(title)}</h2>
      <p class="sidebar-text">${escapeHtml(description)}</p>
    </section>
  `;
}

// ─── Rendering: Orchestrator ─────────────────────────────────────────────────

function render() {
  renderHero();

  // Lock picker during active quiz phases
  if (state.phase === "intro" || state.phase === "quiz" || state.phase === "outro") {
    lockPicker();
  } else {
    unlockPicker();
  }

  if (!state.quiz || state.phase === "select") {
    renderSidebar();
    renderSelect();
    return;
  }

  if (state.phase === "intro") {
    renderSidebar();
    renderIntro();
    return;
  }

  if (state.phase === "outro") {
    renderSidebar();
    renderOutro();
    return;
  }

  if (state.phase === "results") {
    renderSidebar();
    renderResults();
    return;
  }

  // Quiz phase
  renderSidebar();
  renderQuestion();
}

// ─── Quiz Logic ──────────────────────────────────────────────────────────────

function submitQuiz() {
  if (!getAllAnswered()) {
    showToast("Please answer every question before submitting.", "error");
    return;
  }

  if (!confirm("Submit your quiz? You won't be able to change your answers after this.")) return;

  recordQuestionLeave();
  state.submittedAt = new Date();
  state.grade = gradeQuiz(state.quiz, state.answers);
  state.phase = "outro";
  autoSave();
  render();
}

// ─── Load Catalog ────────────────────────────────────────────────────────────

async function loadCatalog() {
  const response = await fetch("quizzes/catalog.json");
  if (!response.ok) throw new Error("Unable to load the quiz list.");

  state.catalog = await response.json();

  if (quizPicker) {
    const placeholder = `<option value="">— Select a quiz —</option>`;
    const quizOptions = state.catalog.map((p) =>
      `<option value="${escapeHtml(p.path)}">${escapeHtml(p.title)}</option>`
    ).join("");
    quizPicker.innerHTML = placeholder + quizOptions;
    quizPicker.value = "";
  }
}

// ─── Load Quiz ───────────────────────────────────────────────────────────────

async function loadQuiz(path) {
  showToast("Loading quiz...", "info");
  state.quiz = null;
  state.answers = {};
  state.currentQuestionIndex = 0;
  state.grade = null;
  state.submittedAt = null;
  state.phase = "intro";
  state.reflections = {};
  state.hintUsage = {};
  state.fiftyFiftyUsage = {};
  state.confidence = {};
  state.questionTimestamps = {};
  state.quizStartedAt = null;

  const response = await fetch(path);
  if (!response.ok) throw new Error("Unable to load that quiz.");

  const rawQuiz = await response.json();
  const errors = validateQuizPack(rawQuiz);
  if (errors.length > 0) throw new Error(errors.join(" "));

  const baseUrl = new URL(path, window.location.href).toString();
  state.quiz = normalizeQuizPack(rawQuiz, { baseUrl });
  state.selectedPackPath = path;
  state.attempts = loadAttemptsFromStorage(state.quiz.id);

  // Restore saved progress
  const saved = loadSave(state.quiz.id);
  if (saved && saved.answers && Object.keys(saved.answers).length > 0) {
    state.answers = saved.answers || {};
    state.reflections = saved.reflections || {};
    state.hintUsage = saved.hintUsage || {};
    state.imageHintUsage = saved.imageHintUsage || {};
    state.fiftyFiftyUsage = saved.fiftyFiftyUsage || {};
    state.confidence = saved.confidence || {};
    state.questionTimestamps = saved.questionTimestamps || {};
    state.currentQuestionIndex = saved.currentQuestionIndex || 0;
    state.quizStartedAt = saved.quizStartedAt ? new Date(saved.quizStartedAt) : null;

    if (saved.grade) {
      state.grade = saved.grade;
      state.submittedAt = saved.submittedAt ? new Date(saved.submittedAt) : new Date();
    }

    state.phase = saved.phase || "intro";
    showToast("Progress restored — picking up where you left off.", "success");
  } else {
    showToast(`${state.quiz.title} is ready.`, "success");
  }

  if (quizPicker) quizPicker.value = path;
  window.localStorage.setItem("quiz-pack-path", path);
  updateQueryString(path);
  render();
}

// ─── Global Controls ─────────────────────────────────────────────────────────

function bindGlobalControls() {
  if (quizPicker) {
    quizPicker.addEventListener("change", () => {
      if (loadQuizBtn) loadQuizBtn.disabled = !quizPicker.value;
    });
  }

  if (loadQuizBtn) {
    loadQuizBtn.addEventListener("click", async () => {
      if (!quizPicker?.value) return;

      // If mid-quiz, confirm before switching
      if (state.quiz && state.phase !== "select" && state.phase !== "results") {
        if (!confirm("Leave the current quiz? Your progress is saved.")) return;
      }

      try {
        await loadQuiz(quizPicker.value);
      } catch (error) {
        showToast(error.message, "error");
        renderEmptyState("Could not load quiz", error.message);
      }
    });
  }
}

// ─── Init ────────────────────────────────────────────────────────────────────

async function init() {
  bindGlobalControls();

  try {
    await loadCatalog();

    // Check for a quiz in the URL query string
    const urlQuiz = new URL(window.location.href).searchParams.get("quiz");
    if (urlQuiz) {
      // Pre-select in picker
      if (quizPicker) quizPicker.value = urlQuiz;
      if (loadQuizBtn) loadQuizBtn.disabled = false;
      await loadQuiz(urlQuiz);
    } else {
      // Show quiz selection screen
      state.phase = "select";
      render();
    }
  } catch (error) {
    showToast(error.message, "error");
    renderEmptyState("Quiz failed to initialize", error.message);
  }
}

init();
