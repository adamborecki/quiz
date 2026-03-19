# Signal Path Quiz Player

Signal Path is a front-end-only quiz player for GitHub Pages. It ships with:

- a documented JSON schema for quiz packs
- two example quiz packs
- mobile-friendly question flow
- audio playback support
- local grading, review, and export tools

## Run locally

Because the app fetches JSON quiz packs, serve the repo over a local web server instead of opening `index.html` directly:

```bash
python3 -m http.server 4173
```

Then open [http://localhost:4173](http://localhost:4173).

You can load a specific pack with a query parameter:

- `http://localhost:4173/?quiz=quizzes/mus347-quiz2.json`
- `http://localhost:4173/?quiz=quizzes/listening-basics-demo.json`

## Files

- `index.html`: static shell for the GitHub Pages app
- `styles.css`: responsive UI and theme styles
- `app.mjs`: browser UI, quiz loading, and result actions
- `quiz-core.mjs`: validation, normalization, grading, and export helpers
- `quiz-pack.schema.json`: machine-readable schema for quiz packs
- `docs/quiz-pack-schema.md`: author-facing schema notes and examples
- `quizzes/`: example packs and pack catalog

## Testing

Run the small Node test suite with:

```bash
node --test
```
