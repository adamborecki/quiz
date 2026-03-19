import {
  buildAttemptExport,
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
const themeToggle = document.querySelector("#theme-toggle");
const defaultPackPath = "quizzes/mus347-quiz2.json";

const state = {
  catalog: [],
  selectedPackPath: defaultPackPath,
  quiz: null,
  answers: {},
  currentQuestionIndex: 0,
  grade: null,
  submittedAt: null,
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

function getStoredTheme() {
  const storedTheme = window.localStorage.getItem("quiz-theme");

  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem("quiz-theme", theme);
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

function renderSidebar() {
  if (!state.quiz) {
    sidebarElement.innerHTML = `
      <div class="sidebar-panel">
        <div class="sidebar-stack">
          <section class="sidebar-section">
            <p class="eyebrow">Loading</p>
            <h2 class="sidebar-title">Preparing quiz player</h2>
            <p class="sidebar-text">Fetching the selected quiz pack and validating it against the schema.</p>
          </section>
        </div>
      </div>
    `;
    return;
  }

  const answeredCount = countAnsweredQuestions(state.quiz, state.answers);
  const progressPercent = Math.round(((state.currentQuestionIndex + 1) / state.quiz.questions.length) * 100);
  const currentQuestion = state.quiz.questions[state.currentQuestionIndex];

  sidebarElement.innerHTML = `
    <div class="sidebar-panel">
      <div class="sidebar-stack">
        <section class="sidebar-section">
          <p class="eyebrow">${escapeHtml(state.quiz.course || "GitHub Pages")}</p>
          <h2 class="sidebar-title">${escapeHtml(state.quiz.title)}</h2>
          <p class="sidebar-text">${escapeHtml(state.quiz.instructions)}</p>
          <div class="meta-row">
            ${state.quiz.topic ? `<span class="meta-pill">${escapeHtml(state.quiz.topic)}</span>` : ""}
            ${state.quiz.version ? `<span class="meta-pill">v${escapeHtml(state.quiz.version)}</span>` : ""}
            <span class="meta-pill">${state.quiz.questions.length} questions</span>
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

        ${
          state.grade
            ? `
              <section class="sidebar-section">
                <div class="results-card">
                  <span class="metric-label">Score</span>
                  <strong class="metric-value">${state.grade.correctCount}/${state.grade.totalQuestions}</strong>
                  <p class="sidebar-text">Category-ready summary and export tools are available below.</p>
                </div>
              </section>
            `
            : `
              <section class="sidebar-section">
                <div class="results-card">
                  <span class="metric-label">Current question</span>
                  <strong class="metric-value">${escapeHtml(currentQuestion.type.replaceAll("_", " "))}</strong>
                  <p class="sidebar-text">Submit after every question has an answer. The player grades everything locally.</p>
                </div>
              </section>
            `
        }
      </div>
    </div>
  `;

  sidebarElement.querySelectorAll("[data-jump-index]").forEach((button) => {
    button.addEventListener("click", () => {
      state.currentQuestionIndex = Number(button.dataset.jumpIndex);
      render();
      setStatus("");
    });
  });
}

function renderHint(question) {
  if (!state.quiz.settings.enableHints || !question.hint) {
    return "";
  }

  return `
    <details class="hint-card">
      <summary>Show hint</summary>
      <p class="sidebar-text">${escapeHtml(question.hint)}</p>
    </details>
  `;
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
        ${renderHint(question)}

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
    setStatus("Answer saved locally.", "success");
  });

  rootElement.querySelector("#prev-button").addEventListener("click", () => {
    if (state.currentQuestionIndex > 0) {
      state.currentQuestionIndex -= 1;
      setStatus("");
      render();
    }
  });

  rootElement.querySelector("#next-button").addEventListener("click", () => {
    if (state.currentQuestionIndex < state.quiz.questions.length - 1) {
      state.currentQuestionIndex += 1;
      setStatus("");
      render();
      return;
    }

    setStatus("You are already on the final question.", "success");
  });

  rootElement.querySelector("#submit-button").addEventListener("click", submitQuiz);
}

function renderResults() {
  const summaryText = buildPlainTextSummary(state.quiz, state.grade, state.answers, state.submittedAt);
  const exportPayload = buildAttemptExport(state.quiz, state.grade, state.answers, state.submittedAt);

  rootElement.innerHTML = `
    <section class="results-shell">
      <div class="results-stack">
        <header class="results-header">
          <p class="eyebrow">Results and review</p>
          <h2 class="results-title">${escapeHtml(state.quiz.title)}</h2>
          <p class="results-caption">
            Objective grading is complete. You can review each answer, copy a plain-text summary,
            or export the result payload for a submission workflow.
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

        <div class="result-actions">
          <button class="primary-button" id="copy-summary-button" type="button">Copy summary</button>
          <button class="secondary-button" id="download-text-button" type="button">Export text</button>
          <button class="secondary-button" id="download-json-button" type="button">Export JSON</button>
          <button class="ghost-button" id="retake-button" type="button">Retake quiz</button>
        </div>

        <section class="review-list">
          ${state.quiz.questions
            .map((question, index) => {
              const selectedAnswer = state.answers[question.id] ?? null;
              const isCorrect = selectedAnswer === question.correctAnswer;

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
      </div>
    </section>
  `;

  rootElement.querySelector("#copy-summary-button").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(summaryText);
      setStatus("Summary copied to the clipboard.", "success");
    } catch (error) {
      setStatus("Clipboard copy failed in this browser. Use Export text instead.", "error");
    }
  });

  rootElement.querySelector("#download-text-button").addEventListener("click", () => {
    createDownload(`${state.quiz.id}-results.txt`, `${summaryText}\n`, "text/plain;charset=utf-8");
    setStatus("Plain-text summary downloaded.", "success");
  });

  rootElement.querySelector("#download-json-button").addEventListener("click", () => {
    createDownload(
      `${state.quiz.id}-results.json`,
      `${JSON.stringify(exportPayload, null, 2)}\n`,
      "application/json;charset=utf-8"
    );
    setStatus("JSON export downloaded.", "success");
  });

  rootElement.querySelector("#retake-button").addEventListener("click", () => {
    state.answers = {};
    state.grade = null;
    state.submittedAt = null;
    state.currentQuestionIndex = 0;
    render();
    setStatus("Retake started. Previous answers were cleared locally.", "success");
  });
}

function renderEmptyState(title, description) {
  rootElement.innerHTML = `
    <section class="empty-state">
      <p class="eyebrow">Quiz pack error</p>
      <h2>${escapeHtml(title)}</h2>
      <p class="sidebar-text">${escapeHtml(description)}</p>
    </section>
  `;
}

function render() {
  renderSidebar();

  if (!state.quiz) {
    renderEmptyState("No quiz loaded", "Choose a pack from the menu to begin.");
    return;
  }

  if (state.grade && state.quiz.settings.showResultsAtEnd) {
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

  state.submittedAt = new Date();
  state.grade = gradeQuiz(state.quiz, state.answers);
  render();
  setStatus("Quiz graded locally. Review and export tools are ready.", "success");
}

async function loadCatalog() {
  const response = await fetch("quizzes/catalog.json");

  if (!response.ok) {
    throw new Error("Unable to load quiz catalog.");
  }

  state.catalog = await response.json();
  quizPicker.innerHTML = state.catalog
    .map(
      (pack) => `<option value="${escapeHtml(pack.path)}">${escapeHtml(pack.title)}</option>`
    )
    .join("");
}

async function loadQuiz(path) {
  setStatus(`Loading ${getPackLabel(path)}...`);
  state.quiz = null;
  state.answers = {};
  state.currentQuestionIndex = 0;
  state.grade = null;
  state.submittedAt = null;
  render();

  const response = await fetch(path);

  if (!response.ok) {
    throw new Error(`Unable to load quiz pack at ${path}.`);
  }

  const rawQuiz = await response.json();
  const validationErrors = validateQuizPack(rawQuiz);

  if (validationErrors.length > 0) {
    throw new Error(validationErrors.join(" "));
  }

  const baseUrl = new URL(path, window.location.href).toString();
  state.quiz = normalizeQuizPack(rawQuiz, { baseUrl });
  state.selectedPackPath = path;
  quizPicker.value = path;
  window.localStorage.setItem("quiz-pack-path", path);
  updateQueryString(path);
  setStatus(`${state.quiz.title} is ready.`, "success");
  render();
}

function bindGlobalControls() {
  quizPicker.addEventListener("change", async (event) => {
    const nextPath = event.target.value;

    try {
      await loadQuiz(nextPath);
    } catch (error) {
      setStatus(error.message, "error");
      renderEmptyState("Could not load quiz pack", error.message);
    }
  });

  themeToggle.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
  });
}

async function init() {
  applyTheme(getStoredTheme());
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
    renderEmptyState("Quiz player failed to initialize", error.message);
  }
}

init();
