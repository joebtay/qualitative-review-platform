# Review Coder: specification

**Version:** 0.1, 2026-10-07
**Scope:** evidence reviews only (published and grey literature). Never interview, patient or other personal data.

## What it is

A static web app that runs in the browser. It has no server. GitHub stores everything: the interface code in one repo, and each review's documents, codebook and coding in its own private data repo. Each coder signs in with a personal GitHub token and writes only their own files.

Claude codes outside the platform (Claude Code in the cloud) and commits its codes to the data repo as one layer. Humans verify a sample of that layer, reconcile disagreements and produce the dashboard data.

## Principles

1. **No work is ever lost.** Every action is an event, saved to the browser at once and pushed to GitHub within seconds. Events are append-only and never edited. Sync conflicts merge by event ID, so two devices can never overwrite each other.
2. **Every number is reproducible.** Samples record their seed and lock once drawn. Claude runs record the model string, date, codebook version and prompt file.
3. **The codebook is never more than one click away.** Every code chip opens its definition, rules and anchor examples.
4. **Frames are separate.** A taxonomy, an attribute set and a thematic frame are coded, sampled and measured separately.
5. **One config drives the screens.** Each review's `review.json` sets its title, research questions, team, frames and PRISMA counts. The interface holds no review data.

## Units of coding

The unit is the paragraph. A segmenter splits each full text into paragraphs with stable IDs (`<doc>-p0001`) and the page each starts on.

**Short paragraphs.** A paragraph that can't be understood out of context is not a fair unit. The segmenter applies three tests:

- fewer than 25 words; or
- no finite sentence (a heading, list stem or caption); or
- it opens with a back-reference ("This", "These", "Such", "It") and has fewer than 60 words.

A paragraph that fails a test merges with its neighbour: a heading or list stem merges forward, and a back-reference merges backward. Where a merge would pass 400 words, the paragraph stays alone and carries the flag `context-dependent`. Coders always see the paragraph before and after, and flagged units show a warning.

**Grey literature v1.3.** The codes already sit on extracted components, each with a verbatim quote and page, and the PDFs are not yet in the repo. Until they are, the grey lit unit is the component. Once the PDFs arrive, each component is linked to the paragraph that holds its quote.

## Frames

A frame is one coding scheme with its own rules. A review can hold several.

| Type | What it is | Codes per unit | Agreement |
|---|---|---|---|
| `taxonomy` | A hierarchy of mutually exclusive categories: a top tier, a primary value with an optional secondary, and subcategories that depend on the primary | Exactly one per field (optional fields may be blank) | Krippendorff's alpha (nominal) per field |
| `attribute` | Flat descriptive fields: status, grain, descriptor | One per field | Alpha per field |
| `thematic` | Codes applied to any passage that fits, for example CFIR 2.0 determinants | Zero or more | Alpha per code (present or absent) |

The grey lit review has three frames:

- **Taxonomy:** level (Field 1), primary and secondary function (Field 2), subcategory (Field 7), and primary and secondary equity gap (Field 3).
- **Attributes:** status (Field 8), mechanism (Field 4) and descriptor (Field 5).
- **Determinants:** CFIR 2.0 with the EQUIP lens (Field 12). It is defined but not yet coded.

Each frame gets its own sample, its own verification queue and its own agreement figures.

## Layers

A layer is one coder's full set of codes for one frame. Layers never overwrite each other.

- `claude-<run>`: a Claude pass, with a run record.
- `master-v1.3`: the existing grey lit coding, imported as a first-coder layer.
- `<github-handle>`: a human coder.
- `consensus`: the reconciled codes, written only on the Agreement screen.

## Screens

The nav on every screen runs Project · Documents · Screen · Code · Verify · Agreement · Overview.

1. **Project.** Title, research questions, team, key links, milestones, the PRISMA 2020 flow, and progress (the percentage of the corpus coded and of the sample verified).
2. **Documents.** A searchable list of every included document, plus one profile per document: citation, authors, organisation, year, type, country, link, summary, internal ID, interventions, coded units and verification status.
3. **Screen.** Full-text screening, switched on per review (`review.json` `screening.enabled`). Off where the PI made the full-text decisions alone, as in the grey literature review. The screener reads the full text (page text or PDF) and screens each record against the protocol criteria, then records include, exclude with a reason from a fixed list, or discuss. Two modes, set by `screening.blind`:
   - **Blinded** (decided 8 October 2026 for the cognitive impairment review). The screener judges each criterion (met, not met, unclear) and decides with the first screen hidden: no first-screen notes, rulings, decision or text marks. Saving the decision shows the first screen beside the screener's own judgements, with its notes, extraction notes, rulings and marks in the text, for reconciliation. A change after that is recorded as a change; agreement uses the decision made before the first screen was shown.
   - **Open.** The first screen is visible throughout; the screener agrees, disagrees (choosing their own judgement) or marks unsure on each criterion.

   Title and abstract screening stays in Rayyan, blinded. Agreement shows each screener against the first screen: Cohen's kappa on include or exclude and per criterion, the records that differ, and, when blinded, decisions changed after the first screen was shown.
4. **Code.** Human coding of paragraphs against a frame. (Stage 5.)
5. **Verify.** Work through a locked sample. For each field the coder chooses:
   - **Agree**;
   - **Disagree** (the field should be blank);
   - **Other code** (choose the right value, with definitions shown);
   - **Unsure** (left out of alpha and sent to the discussion list).

   A memo and a comment thread sit on every unit. The first coder's notes stay hidden until the verifier finishes the unit. Keyboard: `A` `D` `O` `U` act on the selected field, the arrow keys move between fields, and `J` and `K` move between units.

   Verify has two views, and every review offers both:
   - **By fragment.** One unit at a time, in sample order, with its neighbours for context.
   - **By document.** One document at a time: the full text (page text or the PDF) with every coded fragment marked, and all its fragments and their codes beside it. Quotes and verbatim units are highlighted; cited pages carry a badge for each fragment that cites them. Coded fragments outside the current sample show faintly for context.

   Both views read and write the same samples and the same events. A coder can switch view at any time, mid-sample, and work done in either counts the same way for agreement.

   **Themes** (switched on per review, off by default; PI, 13 October 2026). For a thematic frame coded at paragraph level, with one multi-code field per sub-question, two more views check each code on each fragment, Agree or Disagree with an optional note:
   - **By document.** The reviews grouped by sub-question: each sits in full under its main sub-question and is linked under every other sub-question it has fragments in. The PDF sits beside the fragments, with every fragment highlighted, coloured by code (or by sub-question), and a legend that hides or shows each code. Each fragment shows its codes, a one-line "why it matters" and its quote.
   - **By theme.** Every fragment for one code across all reviews, with its source and page, a jump to the review with the fragment highlighted in the PDF, and Agree or Disagree.

   Both write the same events, so a check made in one shows in the other. The theme frame is left out of the fragment view and of Agreement.
6. **Agreement.** Alpha per field and per code with a 0.67 floor marked, the disagreement list, and consensus decisions.
7. **Overview.** The frame by document matrix and the audit trail. (Stage 4.)

## Sampler

- The default fraction is 15% of units in the frame.
- Stratified by the primary taxonomy code: each stratum gets 15% of its units, rounded up, with at least 2 (or all, if fewer than 2).
- Spread across documents within each stratum: units are shuffled with the seed, then picked round-robin by document.
- A top-up pass adds one unit from every document still missing, so every document is checked at least once.
- **Whole documents.** Instead of a percentage, a coder can choose documents (all, or a hand-picked set). Every coded unit in them goes into the sample, one sample per chosen frame (`<frame>-d<n>`), recorded with `mode: "documents"` and the document list.
- The seed, fraction, strata, counts and unit list are written to `samples/<id>.json`. Once written, a sample is locked. A new draw needs a new ID and a stated reason.

## Sign-in and access

Each coder makes a fine-grained GitHub personal access token with **Contents: read and write** on the review's data repo only. The token stays in that browser's local storage and is sent only to `api.github.com`. A demo mode runs on invented data with no token.

## Hosting

The source lives in the private `review-coder` repo. A clean public repo, made when the interface is ready, carries only the built app and the invented demo project, with no brief, designs or history. Review data never enters it.

## Build stages

1. Spec and schema.
2. Core: sign-in, stores, sync, the Project and Documents pages, and the codebook panel.
3. Verify: the sampler, verification and comments.
4. Agreement and Overview.
5. Screen and Code.

## Reporting

- PRISMA 2020, including item 27 (availability of data, code and materials).
- RAISE guidance for the use of AI in evidence synthesis.
- A Zenodo DOI per release.
- REFI-QDA export (later).
