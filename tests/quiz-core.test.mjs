import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAttemptExport,
  buildPlainTextSummary,
  gradeQuiz,
  normalizeQuizPack,
  validateQuizPack,
} from "../quiz-core.mjs";

const sampleQuiz = {
  id: "demo-pack",
  title: "Demo Pack",
  instructions: "Choose the best answer.",
  settings: {
    showResultsAtEnd: true,
    shuffleQuestions: false,
    shuffleChoices: false,
    enableHints: true,
    enableFiftyFifty: false,
  },
  questions: [
    {
      id: "q1",
      type: "multiple_choice",
      prompt: "Pick the processor that reduces dynamic range.",
      choices: [
        { id: "a", label: "Compressor" },
        { id: "b", label: "Delay" },
      ],
      correctAnswer: "a",
      categories: ["dynamics"],
      explanation: "Compressors reduce peaks above a threshold.",
    },
    {
      id: "q2",
      type: "audio_multiple_choice",
      prompt: "Listen to the clip.",
      choices: [
        { id: "a", label: "Low tone" },
        { id: "b", label: "Mid tone" },
      ],
      correctAnswer: "b",
      media: [{ type: "audio", src: "../assets/audio/tone-440.wav" }],
      categories: ["listening"],
    },
  ],
};

test("validateQuizPack accepts a valid pack", () => {
  assert.deepEqual(validateQuizPack(sampleQuiz), []);
});

test("validateQuizPack rejects audio questions without audio media", () => {
  const invalidQuiz = {
    ...sampleQuiz,
    questions: [
      {
        ...sampleQuiz.questions[0],
      },
      {
        ...sampleQuiz.questions[1],
        media: [],
      },
    ],
  };

  assert.match(
    validateQuizPack(invalidQuiz).join(" "),
    /audio_multiple_choice` requires at least one audio media item/
  );
});

test("normalizeQuizPack resolves media URLs", () => {
  const normalizedQuiz = normalizeQuizPack(sampleQuiz, {
    baseUrl: "https://example.com/quizzes/demo-pack.json",
  });

  assert.equal(
    normalizedQuiz.questions[1].media[0].resolvedSrc,
    "https://example.com/assets/audio/tone-440.wav"
  );
});

test("gradeQuiz calculates scores and categories", () => {
  const normalizedQuiz = normalizeQuizPack(sampleQuiz, {
    baseUrl: "https://example.com/quizzes/demo-pack.json",
  });
  const grade = gradeQuiz(normalizedQuiz, { q1: "a", q2: "a" });

  assert.equal(grade.correctCount, 1);
  assert.equal(grade.totalQuestions, 2);
  assert.equal(grade.scorePercent, 50);
  assert.deepEqual(grade.categoryBreakdown, [
    { category: "dynamics", total: 1, correct: 1 },
    { category: "listening", total: 1, correct: 0 },
  ]);
});

test("summary and export builders include answer data", () => {
  const normalizedQuiz = normalizeQuizPack(sampleQuiz, {
    baseUrl: "https://example.com/quizzes/demo-pack.json",
  });
  const answers = { q1: "a", q2: "b" };
  const grade = gradeQuiz(normalizedQuiz, answers);
  const submittedAt = new Date("2026-03-18T18:30:00Z");
  const summary = buildPlainTextSummary(normalizedQuiz, grade, answers, submittedAt);
  const exportPayload = buildAttemptExport(normalizedQuiz, grade, answers, submittedAt);

  assert.match(summary, /Score: 2\/2/);
  assert.match(summary, /Per-question review/);
  assert.equal(exportPayload.score.percent, 100);
  assert.equal(exportPayload.answers[1].selectedLabel, "Mid tone");
});
