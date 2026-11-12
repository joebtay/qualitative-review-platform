# Qualitative Review Platform

A web app for the qualitative side of evidence reviews (published and grey literature): full-text screening, coding passages against a codebook, verifying a first coder's (or an AI model's) coding, and reporting agreement between coders.

It has no database of its own. Each review lives in its own GitHub repository, and every decision a coder makes is saved there as an append-only event with who made it and when, so the review's full audit trail is under version control.

## What it does

- **Documents.** A register of included documents, each with a profile page, its coded units and the PDF beside them.
- **Screen.** Full-text screening against the review's eligibility criteria, blinded or open, with a second screener and recorded reasons.
- **Code.** Coding passages selected in the PDF against one or more frames (a taxonomy, attributes, themes by sub-question).
- **Verify.** Draws a reproducible random sample (seeded, stratified by code, locked once drawn) and has a second coder agree, disagree or recode each unit, blind to the first coder's notes until they finish.
- **Agreement.** Percentage agreement, Cohen's kappa and Krippendorff's alpha, per frame and field.
- **Coding layers.** Human and AI coding are kept as separate layers and never mixed, so AI coding can be checked like any other first coder.
- **Teams.** Each coder works in their own folder of a team repository. A Cloudflare sign-in service lets coders without GitHub accounts sign in with a name and password, and gives the project lead a page to add coders and follow progress.

## Try it

```bash
npm run serve
```

Then open http://localhost:8765/?demo. The demo review ("community gardens and wellbeing") is invented: no real documents, coding or people.

## Tests

```bash
npm test
```

See `tests/README.md`.

## Layout

| Path | What |
| --- | --- |
| `app/` | The app: plain HTML, CSS and JavaScript, no build step. `app/demo/` is the invented demo review. |
| `docs/spec.md`, `docs/schema.md` | What the platform does, and how a review's data is stored. |
| `docs/design/` | The screen designs. |
| `cloudflare/`, `functions/` | The optional Cloudflare site and sign-in service (`cloudflare/README.md`). `cloudflare/projects.json` is an invented example. |
| `tests/` | Unit tests, a fake GitHub API, and end-to-end tests on the demo. |
| `tools/` | Helper scripts for building the demo and extracting PDF pages. |

## What is not here

This repository holds the software only. The review data it was built for (documents, codebooks, coding and coders' decisions) lives in separate private repositories and is not included, nor are the end-to-end tests that run against that data. Names and identifiers in tests and examples are placeholders.

## Licence

MIT (see `LICENSE`). The PDF viewer in `app/vendor/pdfjs/` is Mozilla's PDF.js, under its own Apache 2.0 licence.
