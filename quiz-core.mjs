const SUPPORTED_QUESTION_TYPES = new Set(["multiple_choice", "audio_multiple_choice"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneChoice(choice) {
  return {
    id: choice.id,
    label: choice.label,
  };
}

function cloneMedia(media, baseUrl = null) {
  const cloned = {
    type: media.type,
    src: media.src,
    title: media.title ?? "",
    caption: media.caption ?? "",
  };

  if (baseUrl) {
    cloned.resolvedSrc = new URL(media.src, baseUrl).toString();
  } else {
    cloned.resolvedSrc = media.src;
  }

  return cloned;
}

function shuffleList(items) {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy;
}

function getQuestionCategoryList(question) {
  return Array.isArray(question.categories) ? question.categories : [];
}

export function validateQuizPack(quiz) {
  const errors = [];

  if (!isPlainObject(quiz)) {
    return ["Quiz pack must be a JSON object."];
  }

  if (typeof quiz.id !== "string" || !quiz.id.trim()) {
    errors.push("Quiz pack is missing a non-empty string `id`.");
  }

  if (typeof quiz.title !== "string" || !quiz.title.trim()) {
    errors.push("Quiz pack is missing a non-empty string `title`.");
  }

  if (typeof quiz.instructions !== "string" || !quiz.instructions.trim()) {
    errors.push("Quiz pack is missing a non-empty string `instructions`.");
  }

  if (!isPlainObject(quiz.settings)) {
    errors.push("Quiz pack is missing an object `settings`.");
  } else if (typeof quiz.settings.showResultsAtEnd !== "boolean") {
    errors.push("Quiz pack `settings.showResultsAtEnd` must be a boolean.");
  }

  if (!Array.isArray(quiz.questions) || quiz.questions.length === 0) {
    errors.push("Quiz pack must include a non-empty `questions` array.");
    return errors;
  }

  const seenIds = new Set();

  quiz.questions.forEach((question, questionIndex) => {
    const label = `Question ${questionIndex + 1}`;

    if (!isPlainObject(question)) {
      errors.push(`${label} must be an object.`);
      return;
    }

    if (typeof question.id !== "string" || !question.id.trim()) {
      errors.push(`${label} is missing a non-empty string \`id\`.`);
    } else if (seenIds.has(question.id)) {
      errors.push(`${label} reuses question id \`${question.id}\`.`);
    } else {
      seenIds.add(question.id);
    }

    if (!SUPPORTED_QUESTION_TYPES.has(question.type)) {
      errors.push(
        `${label} has unsupported type \`${String(question.type)}\`. Supported types: ${[
          ...SUPPORTED_QUESTION_TYPES,
        ].join(", ")}.`
      );
    }

    if (typeof question.prompt !== "string" || !question.prompt.trim()) {
      errors.push(`${label} is missing a non-empty string \`prompt\`.`);
    }

    if (!Array.isArray(question.choices) || question.choices.length < 2) {
      errors.push(`${label} must include at least two choices.`);
    } else {
      const choiceIds = new Set();

      question.choices.forEach((choice, choiceIndex) => {
        if (!isPlainObject(choice)) {
          errors.push(`${label} choice ${choiceIndex + 1} must be an object.`);
          return;
        }

        if (typeof choice.id !== "string" || !choice.id.trim()) {
          errors.push(`${label} choice ${choiceIndex + 1} needs a non-empty string \`id\`.`);
        } else if (choiceIds.has(choice.id)) {
          errors.push(`${label} reuses choice id \`${choice.id}\`.`);
        } else {
          choiceIds.add(choice.id);
        }

        if (typeof choice.label !== "string" || !choice.label.trim()) {
          errors.push(
            `${label} choice ${choiceIndex + 1} needs a non-empty string \`label\`.`
          );
        }
      });

      if (typeof question.correctAnswer !== "string" || !choiceIds.has(question.correctAnswer)) {
        errors.push(`${label} needs a \`correctAnswer\` that matches one of its choice ids.`);
      }
    }

    if (question.hint !== undefined && typeof question.hint !== "string") {
      errors.push(`${label} \`hint\` must be a string when provided.`);
    }

    if (question.explanation !== undefined && typeof question.explanation !== "string") {
      errors.push(`${label} \`explanation\` must be a string when provided.`);
    }

    if (
      question.allowFiftyFifty !== undefined &&
      typeof question.allowFiftyFifty !== "boolean"
    ) {
      errors.push(`${label} \`allowFiftyFifty\` must be a boolean when provided.`);
    }

    if (
      question.categories !== undefined &&
      (!Array.isArray(question.categories) ||
        question.categories.some((category) => typeof category !== "string" || !category.trim()))
    ) {
      errors.push(`${label} \`categories\` must be an array of non-empty strings.`);
    }

    if (question.media !== undefined) {
      if (!Array.isArray(question.media)) {
        errors.push(`${label} \`media\` must be an array when provided.`);
      } else {
        question.media.forEach((media, mediaIndex) => {
          if (!isPlainObject(media)) {
            errors.push(`${label} media item ${mediaIndex + 1} must be an object.`);
            return;
          }

          if (media.type !== "audio") {
            errors.push(`${label} media item ${mediaIndex + 1} must use type \`audio\`.`);
          }

          if (typeof media.src !== "string" || !media.src.trim()) {
            errors.push(`${label} media item ${mediaIndex + 1} needs a non-empty string \`src\`.`);
          }
        });
      }
    }

    if (question.type === "audio_multiple_choice") {
      const mediaItems = Array.isArray(question.media) ? question.media : [];
      const hasAudio = mediaItems.some((item) => item?.type === "audio" && item?.src);

      if (!hasAudio) {
        errors.push(`${label} type \`audio_multiple_choice\` requires at least one audio media item.`);
      }
    }
  });

  return errors;
}

export function normalizeQuizPack(quiz, options = {}) {
  const errors = validateQuizPack(quiz);

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  const baseUrl = options.baseUrl ?? null;
  const settings = {
    shuffleQuestions: false,
    shuffleChoices: false,
    showResultsAtEnd: true,
    enableHints: false,
    enableFiftyFifty: false,
    ...quiz.settings,
  };

  let questions = quiz.questions.map((question) => ({
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    choices: question.choices.map(cloneChoice),
    correctAnswer: question.correctAnswer,
    hint: question.hint ?? "",
    allowFiftyFifty: question.allowFiftyFifty ?? false,
    categories: getQuestionCategoryList(question),
    media: Array.isArray(question.media)
      ? question.media.map((media) => cloneMedia(media, baseUrl))
      : [],
    explanation: question.explanation ?? "",
  }));

  if (settings.shuffleQuestions) {
    questions = shuffleList(questions);
  }

  if (settings.shuffleChoices) {
    questions = questions.map((question) => ({
      ...question,
      choices: shuffleList(question.choices),
    }));
  }

  return {
    $schema: quiz.$schema ?? "",
    id: quiz.id,
    title: quiz.title,
    instructions: quiz.instructions,
    course: quiz.course ?? "",
    topic: quiz.topic ?? "",
    version: quiz.version ?? "",
    settings,
    questions,
    sourceUrl: baseUrl,
  };
}

export function countAnsweredQuestions(quiz, answers) {
  return quiz.questions.filter((question) => Boolean(answers[question.id])).length;
}

export function gradeQuiz(quiz, answers) {
  const questionResults = quiz.questions.map((question) => {
    const selectedAnswer = answers[question.id] ?? null;
    const isCorrect = selectedAnswer === question.correctAnswer;

    return {
      questionId: question.id,
      prompt: question.prompt,
      selectedAnswer,
      correctAnswer: question.correctAnswer,
      isCorrect,
      categories: getQuestionCategoryList(question),
    };
  });

  const correctCount = questionResults.filter((result) => result.isCorrect).length;
  const totalQuestions = questionResults.length;
  const scorePercent = totalQuestions === 0 ? 0 : Math.round((correctCount / totalQuestions) * 100);
  const categoryMap = new Map();

  questionResults.forEach((result) => {
    result.categories.forEach((category) => {
      const current = categoryMap.get(category) ?? {
        category,
        total: 0,
        correct: 0,
      };

      current.total += 1;
      if (result.isCorrect) {
        current.correct += 1;
      }

      categoryMap.set(category, current);
    });
  });

  return {
    totalQuestions,
    correctCount,
    scorePercent,
    questionResults,
    categoryBreakdown: [...categoryMap.values()].sort((left, right) =>
      left.category.localeCompare(right.category)
    ),
  };
}

export function getChoiceLabel(question, choiceId) {
  return question.choices.find((choice) => choice.id === choiceId)?.label ?? "No answer selected";
}

export function buildPlainTextSummary(quiz, grade, answers, submittedAt = new Date()) {
  const lines = [
    `${quiz.title}`,
    `Score: ${grade.correctCount}/${grade.totalQuestions} (${grade.scorePercent}%)`,
    `Submitted: ${submittedAt.toLocaleString()}`,
    "",
    "Per-question review:",
  ];

  quiz.questions.forEach((question, index) => {
    const selectedAnswer = answers[question.id] ?? null;
    const isCorrect = selectedAnswer === question.correctAnswer;

    lines.push(`${index + 1}. ${isCorrect ? "Correct" : "Incorrect"} - ${question.prompt}`);
    lines.push(`   Your answer: ${getChoiceLabel(question, selectedAnswer)}`);
    lines.push(`   Correct answer: ${getChoiceLabel(question, question.correctAnswer)}`);

    if (question.categories.length > 0) {
      lines.push(`   Categories: ${question.categories.join(", ")}`);
    }

    if (question.explanation) {
      lines.push(`   Explanation: ${question.explanation}`);
    }

    lines.push("");
  });

  if (grade.categoryBreakdown.length > 0) {
    lines.push("Category breakdown:");
    grade.categoryBreakdown.forEach((bucket) => {
      lines.push(`- ${bucket.category}: ${bucket.correct}/${bucket.total}`);
    });
  }

  return lines.join("\n").trim();
}

function formatDurationForExport(ms) {
  if (!ms || ms < 0) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

function getLikertLabel(id) {
  const map = {
    "very-confident": "Very confident",
    "somewhat-confident": "Somewhat confident",
    "neutral": "Neutral",
    "not-very-confident": "Not very confident",
    "not-confident-at-all": "Not confident at all",
  };
  return map[id] ?? id ?? "—";
}

export function buildCanvasSubmission(quiz, attempts) {
  const lines = [];
  lines.push(`=== ${quiz.title} ===`);
  lines.push(`Student submission — ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} at ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
  lines.push("");

  for (const attempt of attempts) {
    const label = attempts.length > 1 ? `--- Attempt ${attempt.attemptNumber} ---` : `--- Quiz Results ---`;
    lines.push(label);
    lines.push("");

    const r = attempt.reflections || {};
    lines.push(`Pre-quiz feeling: ${getLikertLabel(r["pre-feeling"])}`);
    lines.push(`Preparation: ${r["pre-prep"] ? `"${r["pre-prep"]}"` : "—"}`);

    if (attempt.quizStartedAt) {
      const start = attempt.quizStartedAt instanceof Date ? attempt.quizStartedAt : new Date(attempt.quizStartedAt);
      lines.push(`Quiz started: ${start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
    }
    if (attempt.submittedAt) {
      const end = attempt.submittedAt instanceof Date ? attempt.submittedAt : new Date(attempt.submittedAt);
      lines.push(`Submitted: ${end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
    }
    lines.push("");

    const grade = attempt.grade;
    lines.push(`Score: ${grade.correctCount}/${grade.totalQuestions} (${grade.scorePercent}%)`);
    lines.push("");

    if (grade.categoryBreakdown.length > 0) {
      lines.push("Category Breakdown:");
      for (const bucket of grade.categoryBreakdown) {
        lines.push(`  - ${bucket.category}: ${bucket.correct}/${bucket.total}`);
      }
      lines.push("");
    }

    lines.push("Per-Question Detail:");
    quiz.questions.forEach((question, index) => {
      const selectedAnswer = attempt.answers[question.id] ?? null;
      const isCorrect = selectedAnswer === question.correctAnswer;
      const status = isCorrect ? "Correct" : "Incorrect";
      const ts = attempt.questionTimestamps?.[question.id];
      const timeSpent = ts && ts.end && ts.start ? ts.end - ts.start : null;
      const usedHint = attempt.hintUsage?.[question.id] ?? false;

      if (isCorrect) {
        lines.push(`  ${index + 1}. [${status}] ${question.prompt} → ${getChoiceLabel(question, selectedAnswer)}`);
      } else {
        lines.push(`  ${index + 1}. [${status}] ${question.prompt}`);
        lines.push(`     Your answer: ${getChoiceLabel(question, selectedAnswer)} | Correct: ${getChoiceLabel(question, question.correctAnswer)}`);
      }
      const details = [];
      if (timeSpent) details.push(`Time: ${formatDurationForExport(timeSpent)}`);
      details.push(`Hint used: ${usedHint ? "Yes" : "No"}`);
      lines.push(`     ${details.join(" | ")}`);
    });
    lines.push("");

    lines.push(`Post-quiz feeling: ${getLikertLabel(r["post-feeling"])}`);
    if (r["post-plan"]) {
      lines.push(`Study focus: "${r["post-plan"]}"`);
    }
    lines.push("");
  }

  lines.push("=== End of submission ===");
  return lines.join("\n").trim();
}

export function buildAttemptExport(quiz, grade, answers, submittedAt = new Date()) {
  return {
    quiz: {
      id: quiz.id,
      title: quiz.title,
      course: quiz.course,
      topic: quiz.topic,
      version: quiz.version,
    },
    submittedAt: submittedAt.toISOString(),
    score: {
      correct: grade.correctCount,
      total: grade.totalQuestions,
      percent: grade.scorePercent,
    },
    answers: quiz.questions.map((question) => ({
      questionId: question.id,
      prompt: question.prompt,
      selectedAnswer: answers[question.id] ?? null,
      selectedLabel: getChoiceLabel(question, answers[question.id] ?? null),
      correctAnswer: question.correctAnswer,
      correctLabel: getChoiceLabel(question, question.correctAnswer),
      isCorrect: (answers[question.id] ?? null) === question.correctAnswer,
      categories: question.categories,
    })),
    categoryBreakdown: grade.categoryBreakdown,
  };
}
