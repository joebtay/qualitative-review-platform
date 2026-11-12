# Tests

- `npm test` runs the unit tests: event merging and sync, the sampler and assignment, blinding, Krippendorff's alpha, passage matching across line breaks, page references, feature switches, themes, the review switcher, settings, and the Cloudflare sign-in service (`cloudflare/service.js`, `admin.js`, `welcome.js`, `progress.js`) against a fake GitHub App and KV store.
- `tests/mock-github.mjs <dir> <port> <owner/repo>` is a fake GitHub API over a folder, with failure and conflict injection.
- `tests/e2e/demo.py` is a smoke test on the invented demo review, in headless Chromium.
- `tests/e2e/run_reviews.sh WORK_DIR` checks the project lead's review switcher (`app/js/reviews.js`) on made-up copies of the demo review.
