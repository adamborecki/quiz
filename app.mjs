import {
  buildAttemptExport,
  buildCanvasSubmission,
  buildPlainTextSummary,
  countAnsweredQuestions,
  getChoiceLabel,
  gradeQuiz,
  normalizeQuizPack,
  validateQuizPack,
} from "./quiz-core.mjs";

const sidebarElement = document.querySelector("#sidebar");
const rootElement = document.querySelector("#app-root");
const statusBanner = document.querySelector("#status-banner");
const quizPicker = document.querySelector("#quiz-picker");
const heroEyebrow = document.querySelector("#hero-eyebrow");
const heroTitle = document.querySelector("#hero-title");
const heroText = document.querySelector("#hero-text");
const defaultPackPath = "quizzes/mus347-quiz2.json";

const LIKERT_OPTIONS = [
  { id: "very-confident", label: "Very confident" },
  { id: "somewhat-confident", label: "Somewhat confident" },
  { id: "neutral", label: "Neutral" },
  { id: "not-very-confident", label: "Not very confident" },
  { id: "not-confident-at-all", label: "Not confident at all" },
];

const state = {
  catalog: [],
  selectedPackPath: defaultPackPath,
  quiz: null,
  answers: {},
  currentQuestionIndex: 0,
  grade: null,
  submittedAt: null,
  phase: "intro",
  reflections: {},
  attempts: [],
  hintUsage: {},
  questionTimestamps: {},
  quizStartedAt: null,
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setStatus(message = "", tone = "") {
  statusBanner.textContent = message;
  statusBanner.className = "status-banner";

  if (tone) {
    statusBanner.classList.add(`is-${tone}`);
  }
}

function getPackLabel(path) {
  return state.catalog.find((pack) => pack.path === path)?.title ?? path;
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

function formatDuration(ms) {
  if (!ms || ms < 0) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

function saveAttemptsToStorage() {
  if (!state.quiz) return;
  const key = `quiz-attempts-${state.quiz.id}`;
  const data = state.attempts.map((attempt) => ({
    ...attempt,
    submittedAt: attempt.submittedAt instanceof Date ? attempt.submittedAt.toISOString() : attempt.submittedAt,
    quizStartedAt: attempt.quizStartedAt instanceof Date ? attempt.quizStartedAt.toISOString() : attempt.quizStartedAt,
  }));
  window.localStorage.setItem(key, JSON.stringify(data));
}

function loadAttemptsFromStorage(quizId) {
  const key = `quiz-attempts-${quizId}`;
  const raw = window.localStorage.getItem(key);
  if (!raw) return [];
  try {
    return JSON.parse(raw).map((attempt) => ({
      ...attempt,
      submittedAt: new Date(attempt.submittedAt),
      quizStartedAt: attempt.quizStartedAt ? new Date(attempt.quizStartedAt) : null,
    }));
  } catch {
    return [];
  }
}

function saveCanvasTextToStorage(text) {
  if (!state.quiz) return;
  window.localStorage.setItem(`quiz-canvas-${state.quiz.id}`, text);
}

function renderHero() {
  if (!state.quiz) {
    document.title = "Quiz";
    heroEyebrow.textContent = "Student quiz";
    heroTitle.textContent = "Take your quiz";
    heroText.textContent =
      "Read each prompt carefully, listen when audio appears, and answer each question on your own.";
    return;
  }

  const questionLabel = state.quiz.questions.length === 1 ? "question" : "questions";
  document.title = `${state.quiz.title} | Quiz`;
  heroEyebrow.textContent = "You're taking a quiz";
  heroTitle.textContent = state.quiz.title;
  heroText.textContent = `Work at your own pace, listen carefully, and answer honestly. This quiz has ${state.quiz.questions.length} ${questionLabel}.`;
}

function renderSidebar() {
  if (!state.quiz) {
    sidebarElement.innerHTML = `
      <div class="sidebar-panel">
        <div class="sidebar-stack">
          <section class="sidebar-section">
            <p class="eyebrow">Loading</p>
            <h2 class="sidebar-title">Getting your quiz ready</h2>
            <p class="sidebar-text">Loading the selected quiz so you can begin.</p>
          </section>
        </div>
      </div>
    `;
    return;
  }

  if (state.phase === "intro") {
    sidebarElement.innerHTML = `
      <div class="sidebar-panel">
        <div class="sidebar-stack">
          <section class="sidebar-section">
            <p class="eyebrow">${escapeHtml(state.quiz.course || "Student quiz")}</p>
            <h2 class="sidebar-title">Before you begin</h2>
            <p class="sidebar-text">Answer a couple of quick reflection questions, then you'll start the quiz.</p>
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
    sidebarElement.innerHTML = `
      <div class="sidebar-panel">
        <div class="sidebar-stack">
          <section class="sidebar-section">
            <p class="eyebrow">Almost done</p>
            <h2 class="sidebar-title">Quick check-in</h2>
            <p class="sidebar-text">One more reflection before you see your results.</p>
          </section>
        </div>
      </div>
    `;
    return;
  }

  if (state.phase === "results") {
    sidebarElement.innerHTML = `
      <div class="sidebar-panel">
        <div class="sidebar-stack">
          <section class="sidebar-section">
            <p class="eyebrow">${escapeHtml(state.quiz.course || "Results")}</p>
            <h2 class="sidebar-title">Your results</h2>
            <div class="results-card">
              <span class="metric-label">Score</span>
              <strong class="metric-value">${state.grade.correctCount}/${state.grade.totalQuestions}</strong>
              <p class="sidebar-text">Review your answers, then copy your submission for Canvas.</p>
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

  // Quiz phase
  const answeredCount = countAnsweredQuestions(state.quiz, state.answers);
  const progressPercent = Math.round(((state.currentQuestionIndex + 1) / state.quiz.questions.length) * 100);
  const currentQuestion = state.quiz.questions[state.currentQuestionIndex];

  sidebarElement.innerHTML = `
    <div class="sidebar-panel">
      <div class="sidebar-stack">
        <section class="sidebar-section">
          <p class="eyebrow">${escapeHtml(state.quiz.course || "Student quiz")}</p>
          <h2 class="sidebar-title">Quiz details</h2>
          <p class="sidebar-text">${escapeHtml(state.quiz.instructions || "Answer each question on your own and submit when you're finished.")}</p>
          <div class="meta-row">
            ${state.quiz.topic ? `<span class="meta-pill">${escapeHtml(state.quiz.topic)}</span>` : ""}
            ${state.quiz.version ? `<span class="meta-pill">v${escapeHtml(state.quiz.version)}</span>` : ""}
            <span class="meta-pill">${state.quiz.questions.length} questions</span>
            ${state.attempts.length > 0 ? `<span class="meta-pill">Attempt ${state.attempts.length + 1}</span>` : ""}
          </div>
        </section>

        <section class="sidebar-section">
          <div class="progress-label">
            <span>Progress</span>
            <span>${state.currentQuestionIndex + 1}/${state.quiz.questions.length}</span>
          </div>
          <div class="progress-bar" aria-hidden="true">
            <span style="width: ${progressPercent}%"></span>
          </div>
          <p class="sidebar-text">
            ${answeredCount} answered, ${state.quiz.questions.length - answeredCount} remaining.
          </p>
        </section>

        <section class="sidebar-section">
          <div class="question-jump-grid" aria-label="Question navigation">
            ${state.quiz.questions
              .map(
                (question, index) => `
                  <button
                    class="question-jump ${index === state.currentQuestionIndex ? "is-current" : ""} ${
                      state.answers[question.id] ? "is-answered" : ""
                    }"
                    type="button"
                    data-jump-index="${index}"
                    aria-label="Jump to question ${index + 1}"
                  >
                    ${index + 1}
                  </button>
                `
              )
              .join("")}
          </div>
        </section>

        <section class="sidebar-section">
          <div class="results-card">
            <span class="metric-label">Current question</span>
            <strong class="metric-value">${escapeHtml(currentQuestion.type.replaceAll("_", " "))}</strong>
            <p class="sidebar-text">Answer every question before you submit. Use the numbered buttons to move around anytime.</p>
          </div>
        </section>
      </div>
    </div>
  `;

  sidebarElement.querySelectorAll("[data-jump-index]").forEach((button) => {
    button.addEventListener("click", () => {
      recordQuestionLeave();
      state.currentQuestionIndex = Number(button.dataset.jumpIndex);
      recordQuestionEnter();
      render();
      setStatus("");
    });
  });
}

function renderMedia(question) {
  if (!question.media.length) {
    return "";
  }

  return question.media
    .map(
      (media) => `
        <div class="media-card">
          <strong>${escapeHtml(media.title || "Audio example")}</strong>
          ${media.caption ? `<p class="sidebar-text">${escapeHtml(media.caption)}</p>` : ""}
          <audio controls preload="metadata" src="${escapeHtml(media.resolvedSrc)}"></audio>
        </div>
      `
    )
    .join("");
}

function renderHintButton(question) {
  if (!state.quiz.settings.enableHints || !question.hint) {
    return "";
  }

  const alreadyRevealed = state.hintUsage[question.id];

  if (alreadyRevealed) {
    return `
      <div class="hint-revealed">
        <strong class="hint-label">Hint</strong>
        <p class="sidebar-text">${escapeHtml(question.hint)}</p>
      </div>
    `;
  }

  return `
    <button class="secondary-button hint-button" id="hint-button" type="button">Show hint</button>
  `;
}

function recordQuestionEnter() {
  const question = state.quiz.questions[state.currentQuestionIndex];
  if (!state.questionTimestamps[question.id]) {
    state.questionTimestamps[question.id] = { start: Date.now(), end: null };
  } else if (!state.questionTimestamps[question.id].lastEnter) {
    state.questionTimestamps[question.id].lastEnter = Date.now();
  } else {
    state.questionTimestamps[question.id].lastEnter = Date.now();
  }
}

function recordQuestionLeave() {
  const question = state.quiz.questions[state.currentQuestionIndex];
  const ts = state.questionTimestamps[question.id];
  if (ts) {
    ts.end = Date.now();
  }
}

function renderIntro() {
  const preFeeling = state.reflections["pre-feeling"] ?? "";
  const prePrep = state.reflections["pre-prep"] ?? "";

  rootElement.innerHTML = `
    <section class="question-card">
      <div class="stage-stack">
        <header class="question-header">
          <span class="question-kind">reflection</span>
          <h2 class="question-title">Before you start</h2>
          <p class="question-caption">Take a moment to check in with yourself. These reflections are part of your submission.</p>
        </header>

        <div class="reflection-group">
          <label class="reflection-label" for="pre-feeling">How are you feeling about this quiz?</label>
          <div class="likert-options" id="pre-feeling-options">
            ${LIKERT_OPTIONS.map(
              (opt) => `
                <div class="question-option">
                  <input
                    id="pre-feeling-${escapeHtml(opt.id)}"
                    type="radio"
                    name="pre-feeling"
                    value="${escapeHtml(opt.id)}"
                    ${preFeeling === opt.id ? "checked" : ""}
                  >
                  <label for="pre-feeling-${escapeHtml(opt.id)}">
                    <span>${escapeHtml(opt.label)}</span>
                  </label>
                </div>
              `
            ).join("")}
          </div>
        </div>

        <div class="reflection-group">
          <label class="reflection-label" for="pre-prep">What did you do to prepare, if anything?</label>
          <textarea
            id="pre-prep"
            class="reflection-textarea"
            placeholder="E.g., reviewed notes, listened to examples, nothing yet..."
            rows="3"
          >${escapeHtml(prePrep)}</textarea>
        </div>

        <div class="question-actions">
          <div class="nav-group"></div>
          <button class="primary-button" id="start-quiz-button" type="button">
            Start the quiz
          </button>
        </div>
      </div>
    </section>
  `;

  rootElement.querySelector("#pre-feeling-options").addEventListener("change", (event) => {
    state.reflections["pre-feeling"] = event.target.value;
  });

  rootElement.querySelector("#pre-prep").addEventListener("input", (event) => {
    state.reflections["pre-prep"] = event.target.value;
  });

  rootElement.querySelector("#start-quiz-button").addEventListener("click", () => {
    if (!state.reflections["pre-feeling"]) {
      setStatus("Please share how you're feeling before starting.", "error");
      return;
    }
    if (!state.reflections["pre-prep"]?.trim()) {
      setStatus("Please share what you did to prepare (even if nothing).", "error");
      return;
    }

    state.phase = "quiz";
    state.quizStartedAt = new Date();
    state.currentQuestionIndex = 0;
    recordQuestionEnter();
    render();
    setStatus("Good luck! Work through the questions at your own pace.", "success");
  });
}

function renderQuestion() {
  const question = state.quiz.questions[state.currentQuestionIndex];
  const selectedAnswer = state.answers[question.id] ?? "";
  const isLastQuestion = state.currentQuestionIndex === state.quiz.questions.length - 1;

  rootElement.innerHTML = `
    <article class="question-card">
      <div class="stage-stack">
        <header class="question-header">
          <span class="question-kind">${escapeHtml(question.type.replaceAll("_", " "))}</span>
          <h2 class="question-title">Question ${state.currentQuestionIndex + 1}</h2>
          <p class="question-caption">${escapeHtml(question.prompt)}</p>
          ${
            question.categories.length
              ? `<div class="tag-row">${question.categories
                  .map((category) => `<span class="tag-pill">${escapeHtml(category)}</span>`)
                  .join("")}</div>`
              : ""
          }
        </header>

        ${renderMedia(question)}

        <form id="question-form" class="question-choices">
          <fieldset class="question-choices">
            <legend class="sr-only">Answer choices</legend>
            ${question.choices
              .map(
                (choice) => `
                  <div class="question-option">
                    <input
                      id="choice-${escapeHtml(question.id)}-${escapeHtml(choice.id)}"
                      type="radio"
                      name="answer"
                      value="${escapeHtml(choice.id)}"
                      ${selectedAnswer === choice.id ? "checked" : ""}
                    >
                    <label for="choice-${escapeHtml(question.id)}-${escapeHtml(choice.id)}">
                      <span class="option-id">${escapeHtml(choice.id)}</span>
                      <span>${escapeHtml(choice.label)}</span>
                    </label>
                  </div>
                `
              )
              .join("")}
          </fieldset>
        </form>

        ${renderHintButton(question)}

        <div class="question-actions">
          <div class="nav-group">
            <button class="nav-button" id="prev-button" type="button" ${
              state.currentQuestionIndex === 0 ? "disabled" : ""
            }>
              Previous
            </button>
            <button class="nav-button" id="next-button" type="button">
              ${isLastQuestion ? "Stay on last question" : "Next question"}
            </button>
          </div>
          <button class="primary-button" id="submit-button" type="button">
            Submit quiz
          </button>
        </div>
      </div>
    </article>
  `;

  rootElement.querySelector("#question-form").addEventListener("change", (event) => {
    const selectedValue = event.target.value;
    state.answers[question.id] = selectedValue;
    renderSidebar();
    setStatus("Answer saved.", "success");
  });

  rootElement.querySelector("#prev-button").addEventListener("click", () => {
    if (state.currentQuestionIndex > 0) {
      recordQuestionLeave();
      state.currentQuestionIndex -= 1;
      recordQuestionEnter();
      setStatus("");
      render();
    }
  });

  rootElement.querySelector("#next-button").addEventListener("click", () => {
    if (state.currentQuestionIndex < state.quiz.questions.length - 1) {
      recordQuestionLeave();
      state.currentQuestionIndex += 1;
      recordQuestionEnter();
      setStatus("");
      render();
      return;
    }

    setStatus("You are already on the final question.", "success");
  });

  rootElement.querySelector("#submit-button").addEventListener("click", submitQuiz);

  const hintButton = rootElement.querySelector("#hint-button");
  if (hintButton) {
    hintButton.addEventListener("click", () => {
      state.hintUsage[question.id] = true;
      render();
    });
  }
}

function renderOutro() {
  const postFeeling = state.reflections["post-feeling"] ?? "";

  rootElement.innerHTML = `
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
            ${LIKERT_OPTIONS.map(
              (opt) => `
                <div class="question-option">
                  <input
                    id="post-feeling-${escapeHtml(opt.id)}"
                    type="radio"
                    name="post-feeling"
                    value="${escapeHtml(opt.id)}"
                    ${postFeeling === opt.id ? "checked" : ""}
                  >
                  <label for="post-feeling-${escapeHtml(opt.id)}">
                    <span>${escapeHtml(opt.label)}</span>
                  </label>
                </div>
              `
            ).join("")}
          </div>
        </div>

        <div class="question-actions">
          <div class="nav-group"></div>
          <button class="primary-button" id="see-results-button" type="button">
            See my results
          </button>
        </div>
      </div>
    </section>
  `;

  rootElement.querySelector("#post-feeling-options").addEventListener("change", (event) => {
    state.reflections["post-feeling"] = event.target.value;
  });

  rootElement.querySelector("#see-results-button").addEventListener("click", () => {
    if (!state.reflections["post-feeling"]) {
      setStatus("Please share how you're feeling before seeing your results.", "error");
      return;
    }

    state.phase = "results";
    render();
    setStatus("Here are your results. Review them, then copy your submission for Canvas.", "success");
  });
}

function renderResults() {
  const postPlan = state.reflections["post-plan"] ?? "";

  const currentAttemptData = {
    attemptNumber: state.attempts.length + 1,
    reflections: { ...state.reflections },
    answers: { ...state.answers },
    grade: state.grade,
    hintUsage: { ...state.hintUsage },
    questionTimestamps: { ...state.questionTimestamps },
    quizStartedAt: state.quizStartedAt,
    submittedAt: state.submittedAt,
  };

  const allAttempts = [...state.attempts, currentAttemptData];

  rootElement.innerHTML = `
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

        ${
          state.grade.categoryBreakdown.length
            ? `
              <section class="results-card">
                <strong>Category breakdown</strong>
                <div class="results-card-list">
                  ${state.grade.categoryBreakdown
                    .map(
                      (bucket) =>
                        `<span><strong>${escapeHtml(bucket.category)}:</strong> ${bucket.correct}/${bucket.total}</span>`
                    )
                    .join("")}
                </div>
              </section>
            `
            : ""
        }

        <section class="review-list">
          ${state.quiz.questions
            .map((question, index) => {
              const selectedAnswer = state.answers[question.id] ?? null;
              const isCorrect = selectedAnswer === question.correctAnswer;
              const ts = state.questionTimestamps[question.id];
              const timeSpent = ts && ts.end && ts.start ? ts.end - ts.start : null;
              const usedHint = state.hintUsage[question.id] ?? false;

              return `
                <article class="review-card ${isCorrect ? "is-correct" : "is-incorrect"}">
                  <div class="review-header">
                    <div>
                      <p class="eyebrow">Question ${index + 1}</p>
                      <h3 class="review-title">${escapeHtml(question.prompt)}</h3>
                    </div>
                    <span class="review-status ${isCorrect ? "is-correct" : "is-incorrect"}">
                      ${isCorrect ? "Correct" : "Incorrect"}
                    </span>
                  </div>
                  <div class="results-card-list">
                    <span><strong>Your answer:</strong> ${escapeHtml(getChoiceLabel(question, selectedAnswer))}</span>
                    <span><strong>Correct answer:</strong> ${escapeHtml(getChoiceLabel(question, question.correctAnswer))}</span>
                    ${timeSpent ? `<span><strong>Time:</strong> ${formatDuration(timeSpent)}</span>` : ""}
                    <span><strong>Hint used:</strong> ${usedHint ? "Yes" : "No"}</span>
                    ${
                      question.explanation
                        ? `<span><strong>Explanation:</strong> ${escapeHtml(question.explanation)}</span>`
                        : ""
                    }
                  </div>
                </article>
              `;
            })
            .join("")}
        </section>

        <section class="reflection-section">
          <div class="reflection-group">
            <label class="reflection-label" for="post-plan">Based on your results, what might you focus on if you study again or retake this quiz?</label>
            <textarea
              id="post-plan"
              class="reflection-textarea"
              placeholder="E.g., I should review filter types more, practice identifying frequencies..."
              rows="3"
            >${escapeHtml(postPlan)}</textarea>
          </div>
        </section>

        <section class="canvas-section">
          <h3 class="canvas-heading">Submit to Canvas</h3>
          <p class="sidebar-text">Copy the text below and paste it into your Canvas assignment submission.</p>
          <div class="canvas-actions">
            <button class="primary-button" id="copy-canvas-button" type="button">Copy submission for Canvas</button>
            <button class="secondary-button" id="download-text-button" type="button">Download as text</button>
            <button class="ghost-button" id="retake-button" type="button">Take quiz again</button>
          </div>
        </section>
      </div>
    </section>
  `;

  rootElement.querySelector("#post-plan").addEventListener("input", (event) => {
    state.reflections["post-plan"] = event.target.value;
  });

  rootElement.querySelector("#copy-canvas-button").addEventListener("click", async () => {
    const currentData = {
      ...currentAttemptData,
      reflections: { ...state.reflections },
    };
    const allData = [...state.attempts, currentData];
    const canvasText = buildCanvasSubmission(state.quiz, allData);
    saveCanvasTextToStorage(canvasText);

    try {
      await navigator.clipboard.writeText(canvasText);
      setStatus("Copied! Paste this into your Canvas assignment submission.", "success");
    } catch {
      setStatus("Clipboard copy failed. Use the download button instead.", "error");
    }
  });

  rootElement.querySelector("#download-text-button").addEventListener("click", () => {
    const currentData = {
      ...currentAttemptData,
      reflections: { ...state.reflections },
    };
    const allData = [...state.attempts, currentData];
    const canvasText = buildCanvasSubmission(state.quiz, allData);
    saveCanvasTextToStorage(canvasText);
    createDownload(`${state.quiz.id}-submission.txt`, `${canvasText}\n`, "text/plain;charset=utf-8");
    setStatus("Submission downloaded.", "success");
  });

  rootElement.querySelector("#retake-button").addEventListener("click", () => {
    const attemptRecord = {
      attemptNumber: state.attempts.length + 1,
      reflections: { ...state.reflections },
      answers: { ...state.answers },
      grade: state.grade,
      hintUsage: { ...state.hintUsage },
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
    state.questionTimestamps = {};
    state.quizStartedAt = null;

    render();
    setStatus("Starting a new attempt. Your previous results are saved.", "success");
  });
}

function renderEmptyState(title, description) {
  renderHero();
  rootElement.innerHTML = `
    <section class="empty-state">
      <p class="eyebrow">Quiz unavailable</p>
      <h2>${escapeHtml(title)}</h2>
      <p class="sidebar-text">${escapeHtml(description)}</p>
    </section>
  `;
}

function render() {
  renderHero();
  renderSidebar();

  if (!state.quiz) {
    renderEmptyState("No quiz loaded", "Choose a quiz from the menu to begin.");
    return;
  }

  if (state.phase === "intro") {
    renderIntro();
    return;
  }

  if (state.phase === "outro") {
    renderOutro();
    return;
  }

  if (state.phase === "results") {
    renderResults();
    renderSidebar();
    return;
  }

  renderQuestion();
}

function submitQuiz() {
  const unansweredQuestion = state.quiz.questions.find((question) => !state.answers[question.id]);

  if (unansweredQuestion) {
    state.currentQuestionIndex = state.quiz.questions.findIndex(
      (question) => question.id === unansweredQuestion.id
    );
    render();
    setStatus("Please answer every question before submitting.", "error");
    return;
  }

  recordQuestionLeave();
  state.submittedAt = new Date();
  state.grade = gradeQuiz(state.quiz, state.answers);
  state.phase = "outro";
  render();
  setStatus("");
}

async function loadCatalog() {
  const response = await fetch("quizzes/catalog.json");

  if (!response.ok) {
    throw new Error("Unable to load the quiz list.");
  }

  state.catalog = await response.json();

  if (quizPicker) {
    quizPicker.innerHTML = state.catalog
      .map(
        (pack) => `<option value="${escapeHtml(pack.path)}">${escapeHtml(pack.title)}</option>`
      )
      .join("");
  }
}

async function loadQuiz(path) {
  setStatus(`Loading ${getPackLabel(path)}...`);
  state.quiz = null;
  state.answers = {};
  state.currentQuestionIndex = 0;
  state.grade = null;
  state.submittedAt = null;
  state.phase = "intro";
  state.reflections = {};
  state.hintUsage = {};
  state.questionTimestamps = {};
  state.quizStartedAt = null;
  render();

  const response = await fetch(path);

  if (!response.ok) {
    throw new Error("Unable to load that quiz.");
  }

  const rawQuiz = await response.json();
  const validationErrors = validateQuizPack(rawQuiz);

  if (validationErrors.length > 0) {
    throw new Error(validationErrors.join(" "));
  }

  const baseUrl = new URL(path, window.location.href).toString();
  state.quiz = normalizeQuizPack(rawQuiz, { baseUrl });
  state.selectedPackPath = path;
  state.attempts = loadAttemptsFromStorage(state.quiz.id);

  if (quizPicker) {
    quizPicker.value = path;
  }
  window.localStorage.setItem("quiz-pack-path", path);
  updateQueryString(path);
  setStatus(`${state.quiz.title} is ready. Answer the reflection questions to begin.`, "success");
  render();
}

function bindGlobalControls() {
  if (!quizPicker) return;
  quizPicker.addEventListener("change", async (event) => {
    const nextPath = event.target.value;

    try {
      await loadQuiz(nextPath);
    } catch (error) {
      setStatus(error.message, "error");
      renderEmptyState("Could not load quiz", error.message);
    }
  });
}

async function init() {
  bindGlobalControls();

  try {
    await loadCatalog();
    const requestedPack =
      new URL(window.location.href).searchParams.get("quiz") ??
      window.localStorage.getItem("quiz-pack-path") ??
      defaultPackPath;

    await loadQuiz(requestedPack);
  } catch (error) {
    setStatus(error.message, "error");
    renderEmptyState("Quiz failed to initialize", error.message);
  }
}

init();
