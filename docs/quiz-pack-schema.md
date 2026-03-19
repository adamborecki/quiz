# Quiz Pack Schema

The quiz player uses plain JSON packs so they can be hand-authored, versioned in Git, or generated from AI prompts. The canonical machine-readable schema lives in [`quiz-pack.schema.json`](../quiz-pack.schema.json).

## MVP decisions

- Format: JSON
- Supported question types in the current player: `multiple_choice`, `audio_multiple_choice`
- `multi_select`: intentionally deferred until after the first MVP to keep grading and mobile UX tight
- Audio modeling: keep a distinct `audio_multiple_choice` type for V1 author clarity, while sharing the same core fields as other multiple-choice questions
- `explanation`: included in the schema now so review screens and future study flows do not require a breaking schema change later

## Top-level fields

- `id`: stable quiz identifier
- `title`: student-facing quiz title
- `instructions`: short guidance shown before and during the quiz
- `course`: optional course code or course name
- `topic`: optional topic label
- `version`: optional content version string
- `settings`: quiz-wide behavior flags
- `questions`: ordered list of question objects

## `settings`

- `shuffleQuestions`: optional boolean
- `shuffleChoices`: optional boolean
- `showResultsAtEnd`: required boolean
- `enableHints`: optional boolean
- `enableFiftyFifty`: optional boolean

## Question shape

Every question includes:

- `id`
- `type`
- `prompt`
- `choices`
- `correctAnswer`

Optional fields:

- `hint`
- `allowFiftyFifty`
- `categories`
- `media`
- `explanation`

## Choice shape

Choices are small objects:

```json
{ "id": "a", "label": "Compressor" }
```

Using stable ids keeps grading resilient even when choices are shuffled.

## Audio media shape

Audio references are stored inside `media`:

```json
{
  "type": "audio",
  "src": "../assets/audio/tone-440.wav",
  "title": "Audio example",
  "caption": "Short listening prompt"
}
```

`src` can be:

- a repo-local relative path
- an absolute URL

The player resolves relative paths against the quiz pack file, which makes packs portable inside the repo.

## Example pack

```json
{
  "id": "listening-basics-demo",
  "title": "Listening Basics Demo",
  "instructions": "Listen to each clip before answering.",
  "settings": {
    "showResultsAtEnd": true,
    "enableHints": true
  },
  "questions": [
    {
      "id": "q1",
      "type": "audio_multiple_choice",
      "prompt": "Which description best fits the tone?",
      "choices": [
        { "id": "a", "label": "Mostly sub-bass energy" },
        { "id": "b", "label": "A midrange reference tone" },
        { "id": "c", "label": "A noisy drum hit" }
      ],
      "correctAnswer": "b",
      "media": [
        {
          "type": "audio",
          "src": "../assets/audio/tone-880.wav"
        }
      ],
      "hint": "This is a clean synthetic tone.",
      "categories": ["listening"],
      "explanation": "The clip is a pure tone that works well for fast listening checks."
    }
  ]
}
```

## Included examples

- [`quizzes/mus347-quiz2.json`](../quizzes/mus347-quiz2.json)
- [`quizzes/listening-basics-demo.json`](../quizzes/listening-basics-demo.json)
