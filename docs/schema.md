# Review Coder: data schema

**Version:** 1, 2026-10-07

Every review lives in its own private data repo, laid out as below. All files are UTF-8 JSON unless stated. Paths are relative to the repo root.

```
review.json                      config: title, questions, team, frames, layers
codebook/<file>.md               the full codebook, rendered in the codebook panel
frames/<frame>.json              one coding frame: fields, values, definitions, rules
documents/index.json             document profiles
queries.json                     open questions for the PI about documents (optional)
documents/<doc>.pdf              full texts (private)
documents/<doc>.pages.json       page text for the Verify document view and Screen (optional)
screening/records.json           every full-text record, included or excluded (when screening is on)
screening/first-screen.json      the first screen: per-criterion judgement and note, call, rulings, decision
units/<doc>.json                 the units of coding for one document
layers/<layer>/run.json          provenance for one layer
layers/<layer>/<doc>.json        that layer's codes for one document
samples/<sample>.json            a locked verification sample
work/<handle>/<doc>.json         one coder's append-only events for one document
tools/                           review-specific scripts (converters, segmenter runs)
```

## review.json

```json
{
  "schema": 1,
  "id": "greylit",
  "title": "Grey literature review",
  "subtitle": "H26-02903",
  "unit": "component",
  "codebook": "codebook/2026-10-02_GreyLit_Codebook_v1.7.md",
  "codebook_version": "v1.7",
  "questions": [{ "id": "RQ1", "text": "...", "frames": ["taxonomy"] }],
  "team": [{ "handle": "joebtay", "name": "Joe", "role": "PI" }],
  "links": [{ "label": "Dashboard", "url": "..." }],
  "milestones": [{ "date": "2026-10-02", "label": "Codebook v1.7 approved", "done": true }],
  "prisma": { "identified": null, "screened": null, "sought": null, "assessed": null,
              "excluded": [{ "reason": "...", "n": 0 }], "included": 129 },
  "frames": ["taxonomy", "attributes", "determinants"],
  "layers": [{ "id": "master-v1.3", "label": "Master v1.3", "kind": "import", "frames": ["taxonomy", "attributes"] }],
  "first_layer": "master-v1.3",
  "sampling": { "fraction": 0.15, "min_per_stratum": 2 }
}
```

`unit` is `paragraph` or `component`. `null` in `prisma` displays as "not yet entered". `first_layer` is the layer that verifiers check.

`corpus` (optional) limits what the app loads: `{ "field": "use_tier", "include": ["Paper corpus"] }`. Units and documents whose `field` value is not listed never load. Sample entries that name a unit which did not load are dropped on load, so no sample, view or count sees them. A unit or document without the field is left out too.

`corpus.set_aside` (optional) names a register in the data repo, `documents/exclusions.json`, and leaves out every document it lists with `"platform": "set aside"`: its units, codes and samples never load, so no view or count sees it. The files stay in the repo. If the register cannot be read, no document loads (it fails closed). It can sit beside `field` and `include`. The cognitive impairment review sets aside CI07, CI08 and CI14, excluded once the two full-text screens were compared (PI, 2 November 2026). A team repo never holds a set-aside document, so the team repo build leaves `set_aside` out.

`features` (optional) switches parts of the app on or off for this review. A switch left out is on.

| Key | Part of the app |
|---|---|
| `screen` | the Screen tab |
| `documents` | the Documents tab and document pages |
| `code` | the Code tab |
| `verify` | the Verify tab |
| `document_view` | Verify by document: full text, coded fragments, new codes and comments on selected text |
| `pdf` | the Open PDF button beside each item |
| `agreement` | the Agreement tab |
| `overview` | the Overview tab |
| `themes_by_document` | Themes, by document (off unless set to `true`, and needs `themes`) |
| `themes_by_code` | Themes, by theme (off unless set to `true`, and needs `themes`) |

A tab that is off is not shown, and its address says the part is not switched on yet.

`themes` (optional) sets up the Themes views for a thematic frame coded at paragraph level (cognitive impairment review, 13 October 2026):

```json
"themes": { "frame": "themes", "sample": "themes-all", "home": { "CI01": "sq1", "CI06": "sq2" } }
```

`frame` has one `multi` field per sub-question. `home` names the field each document is shown under in full; it decides display only. `sample` is a locked whole-documents sample of the frame; checks carry it. A fragment is one unit's value on one field, `{ "v": [codes], "why": "...", "quote": "...", "gap": true }` (`gap` marks words that state the review found none). Each code is checked on its own: a `verify` event with `field` `"<field>::<code>"`, `action` `agree`, `disagree` or `clear`, and `value` the code; a `note` event on the same field holds an optional reason. Units may be `paragraph` or `table-row` (a row of a table page, `<doc>-t0001` up), added by the layer's `units` block with `pdf_page` (the PDF page) beside `page`.

**Checking the AI coding in pair groups** (cognitive impairment review, phase 2, PI 2 November 2026). With `"themes": { "frame": "themes", "checking": true }` the Themes tab becomes a checker's own workspace (`app/js/checkview.js`, logic in `themes.js`); a review may rename the tab with `"nav": { "themes": "Check the coding" }`. Each locked sample on the thematic frame with `fields` is a checking group: its research questions, on its paragraphs. The checker picks a group at the top and works paper by paper, with the PDF beside the codes and the group's fragments highlighted by research question. The band shows the group, the paper (Paper 3 of 13), the codes left in the paper and in the group, Next code to check, and Submit, which opens once every code is answered.

- Each AI code: Agree, Disagree or Change (`verify`, `action` `agree`, `disagree` or `change`; for a change, `value` is the code chosen from the same research question), and a note on any code (`note`, same field). The note saves as the checker types.
- Add a code: a codebook code the AI missed on that fragment (`verify`, `action` `add`, `value` the code), or under another research question of the group, or a code outside the codebook (`passage` with `new_code: { field, text }`), which goes to the PI's ruling list.
- Text selected in the PDF: Highlight, Add a note or Add a code (`passage` with `kind` `highlight`, `note` or `code`, `pdf_page` and `quote`; `codes` or `new_code`; `comment`). They are drawn in the PDF in yellow.
- The first coder's reason (`why`) shows for a fragment only once every AI code on it is answered.
- A later coding pass may add a code to a fragment with words of its own (`added`: { code: { quote, why, pass, ruling } }, cognitive review layer `claude-2026-11-03-themes`, codebook v2.1). The screen shows that quote under the code, highlights it in the PDF, and shows its why with the fragment's once the fragment is answered.
- Submit writes `submit` for the group on `_samples`; the group then locks.

A document can have a basic information page, `documents/info/<id>.json` (`citation`, where set, shows as Published in place of Year): `title`, `authors` (full list), `year`, `journal`, `doi`, `abstract` and `keywords` (word for word, with their pages), and `key_findings` [{ `text`, `page`, `checked`, `check_note` }] under `key_findings_label`. The document page shows it in place of the summary and coded units; a finding with `checked: false` carries "Page reference to be confirmed".

The grey literature review sets `"features": { "document_view": false }`: it is a coding review only (PI ruling 1, 10 October 2026).

**Testing a team repo (standing rule, PI, 11 October 2026).**

- The PI tests on a scratch copy, or on a throwaway record that is in no one's sample. Never on a real record in a repo that will be shared.
- A scratch copy is a separate private repo built by the same script and never shared (for example `cogimp-team-scratch`), or the mock GitHub used by the end-to-end tests.
- Deleting a test afterwards does not remove it. Git history keeps it. GitHub keeps serving a replaced commit by its ID, and the repo's activity page lists every push.
- On 11 October 2026 the PI's CI01 test in cogimp-team could be removed only by deleting the repo and creating it again.
- This applies to every team repo: `cogimp-team`, and every `greylit-team-<handle>` repo.

A team repo can start with some modules and switch others on later in the same repo, once their data is added. `cogimp-team` (PI, 11 October 2026) has four modules, recorded in `modules` for people to read; the app reads only `features`:

| Module | `features` | Starts |
|---|---|---|
| 1. Project: protocol and research questions | (the Project page) | on |
| 2. Full-text screening | `screen` | on |
| 3. Charting verification | `documents`, `verify`, `document_view` | off |
| 4. Cross-coder validation | `agreement` | off |

`project` (optional) picks and orders the cards on the Project page: `{ "sections": ["protocol", "questions", "prisma"] }`. Cards: `protocol`, `questions`, `progress`, `team`, `links`, `queries`, `prisma`, `milestones`, `layers`. Left out, every card shows, with `protocol` only when `protocol` is set.

`protocol` (optional): `{ "file": "protocol/v3.2.md", "title": "...", "url": "https://osf.io/...", "url_label": "OSF" }`. The file is Markdown in the data repo, shown word for word on its own page (`#/protocol`) from the Protocol card.

`prisma.show` (optional) lists the only boxes to show, in order, for example `["screened", "assessed"]`; the exclusion box is then left out. `prisma.labels` renames boxes, for example `{ "screened": "Records screened at title and abstract" }`.

`orientation` (optional) sets the orientation to the coding frame: `{ "file": "orientation/taxonomy.md", "task": "One plain sentence", "link": "How the codes work" }`. The file is Markdown in the data repo. It opens before a coder's first item in each sample, once per sample on each device, and stays one click away from the task line at the top of Verify (PI ruling 2, 10 October 2026). On an assigned sample, coders do not see sampling terms (seed, groups, the sampler).

**Frames on more than one layer (12 October 2026).** Every layer in `layers` loads. Each frame reads its first-coder codes from the layer that holds it: the first layer if it lists the frame, else the first listed layer that does. A sample is verified on its own `layer` and `frame`, so a newer frame (for example `taxonomy-v2` on `master-v2.0`) can be verified while `first_layer` stays on an older one. Verify opens on a frame that holds items for the coder. A unit the layer flags `not-coded` is left out of that frame's total on the Project page.

`frame_settings` (optional) holds settings that differ by frame. Each falls back to the review-wide setting of the same name.

```json
"frame_settings": {
  "taxonomy-v2": {
    "codebook": "codebook/2026-10-12_GreyLit_Codebook_v2.0.1.md", "codebook_version": "v2.0.1",
    "unit_label": "thematic segment",
    "orientation": { "file": "orientation/taxonomy-codebook-v2.md", "task": "One plain sentence", "link": "How the codes work" },
    "new_codes": { "fields": ["statement_type", "level", "function_primary", "form"] }
  }
}
```

| Key | Effect |
|---|---|
| `codebook`, `codebook_version` | The codebook panel opens this file and shows this version while the frame is in view. |
| `unit_label` | What a coder calls the thing they code, in the app's own wording (for example "Opens the PDF ... first words of the thematic segment"). Default "passage". |
| `orientation` | The frame's orientation page and task line. |
| `new_codes.fields` | The fields a new code on selected text takes. Default: the sample's `fields`, else every field of the frame. The export for ruling has one column per field used. |
| `extra_fields` | Fields the frame gains without its file being altered, each `{ "id", "label", "copy_values_from", "depends_on", "required", ... }`: a copy of another field's values. The grey literature secondary form copies `form` and depends on `function_secondary` (ruling 28a, 16 October 2026). |
| `verify_add_fields` | Fields Verify shows besides a sample's own `fields`, so a locked sample is never edited to add a check (secondary function and secondary form, ruling 28b). Not added to a question sample. |
| `confirm_blank` | Fields whose blank first code still needs an answer: Verify shows "None given", and the item stays open until the coder agrees that there is none or adds one with Other. A field with nothing to choose (its parent has no values) needs no answer. |

**A layer that supersedes another (16 October 2026).** A layer in `layers` may name the layer it replaces: `{ "id": "master-v2.0.2", "frames": ["taxonomy-v2"], "supersedes": "master-v2.0.1" }`. A sample locked on the older layer is verified on the newer one, which holds the codes it shows; the sample file is never edited. Units the older layer adds are read from the newer one, which carries them. With no `supersedes`, nothing changes.

`unit` (paragraph or component) is not read by the app. Wording shown to coders comes from `unit_label`.

## frames/&lt;frame&gt;.json

```json
{
  "id": "taxonomy",
  "name": "Taxonomy",
  "type": "taxonomy",
  "description": "...",
  "stratify_by": "function_primary",
  "fields": [
    {
      "id": "function_primary",
      "label": "Primary function",
      "codebook_ref": "Field 2: Function (Taxonomy 1)",
      "required": true,
      "multi": false,
      "depends_on": null,
      "rules": ["Code what the component does, not the principle it follows."],
      "values": [
        { "id": "Reach and access", "label": "Reach and access", "group": "Core",
          "parent": null, "definition": "Gets people into care ...", "anchors": ["..."] }
      ]
    }
  ]
}
```

- `type` is `taxonomy`, `attribute` or `thematic` (see the spec).
- `depends_on` names another field in the same frame. A value's `parent` must match that field's value. Subcategory depends on the primary function.
- `required: false` means a blank is a valid code (for example the secondary function).
- `multi: true` (thematic frames) means a unit can take several values.
- `codebook_ref` is the heading in the codebook file that the panel opens at.
- Value IDs are the exact labels used in the data.

## documents/index.json

```json
[{
  "id": "NICE-NG214",
  "title": "...", "authors": "...", "org": "...", "year": "2022",
  "type": "Clinical and social care guideline", "family": "Guideline, standard or protocol",
  "country": "England (UK)", "url": "https://...",
  "summary": "...", "summary_page": "5",
  "pdf": "documents/NICE-NG214.pdf",
  "flags": ["provisional-gaps", "query:Q1"],
  "interventions": [{ "id": "NICE-I01", "name": "..." }]
}]
```

`pdf` is always `documents/<ID>.pdf`; the app checks whether the file exists. A document held in several files uses `pdf_parts` instead: `[{ "file": "documents/PATH05_pt2.pdf", "from": 16, "to": 35 }]`, where `from` and `to` are source page numbers (`to` is `null` for the last part). The app opens the part that holds a cited page. A flag `query:<id>` marks a document named in `queries.json`.

## queries.json

```json
[{
  "id": "Q1",
  "title": "Tools, toolkits and audit instruments: publication-level documents?",
  "question": "...",
  "docs": ["PATH16", "PATH12"],
  "related_docs": ["HHUB07"],
  "context": "...",
  "options": [{ "id": "include-all", "label": "Include all instruments, coded as components" }],
  "priority": "high",
  "raised": "2026-10-07",
  "raised_by": "claude",
  "status": "open"
}]
```

Queries are questions for the PI. `docs` are the documents the query is about and `related_docs` are others the answer would affect. The file holds the questions only. Decisions are `decision` events (below), so they carry who decided and when, and a later decision supersedes an earlier one without deleting it.

## units/&lt;doc&gt;.json

```json
{
  "doc": "NICE-NG214",
  "units": [{
    "id": "NICE-C001",
    "kind": "component",
    "label": "Person-centred, empathetic, non-judgemental services",
    "text": "are person-centred, empathetic, non-judgemental",
    "page": "9",
    "parent": "NICE-I01",
    "grain": "form",
    "use_tier": "Paper corpus",
    "tier_reason": null,
    "flags": [],
    "excluded": false
  }]
}
```

`grain`, `use_tier` and `tier_reason` carry the master columns of the same name. Unit flags in the grey literature data: `provisional-gaps`, `page-printed` (the charted page is a printed page), `page-unconfirmed` (a script could not confirm the verbatim on the stated PDF page). Flags change no value.

For paragraphs, `kind` is `paragraph`, `id` is `<doc>-p0001`, and `flags` may hold `context-dependent` or `merged`. Units keep document order, so the previous and next units give context.

## layers/&lt;layer&gt;/run.json

```json
{
  "layer": "claude-2026-10-08-opus",
  "kind": "claude",
  "model": "claude-opus-5-5",
  "date": "2026-10-08",
  "codebook_version": "v1.7",
  "prompt": "layers/claude-2026-10-08-opus/prompt.md",
  "frames": ["taxonomy"],
  "notes": "..."
}
```

`kind` is `import`, `claude` or `human`.

## layers/&lt;layer&gt;/&lt;doc&gt;.json

```json
{
  "layer": "master-v1.3",
  "doc": "NICE-NG214",
  "codes": {
    "NICE-C001": {
      "taxonomy": { "level": "Service", "function_primary": "Reach and access",
                    "subcategory": "Engagement approach", "function_secondary": null,
                    "gap_primary": "Stigma and mistrust", "gap_secondary": null }
    }
  },
  "notes": { "NICE-C001": "Level borderline" },
  "flags": { "NICE-C001": ["provisional-gaps"] }
}
```

A field value is a string, `null` (blank), an array (thematic frames), or an object `{ "v": ..., "conf": 0.8, "why": "...", "quote": "..." }` when a Claude run records confidence and rationale. `notes` hold the coder's memos. Verifiers can't see them until they finish the unit.

`units` (optional) corrects a unit's quote or page for this layer only, without touching `units/<doc>.json`, which an
earlier layer may share: `"units": { "NICE-C001": { "page": "12", "text": "...", "flags": [] } }`. Each key given
replaces the unit's own for every frame on this layer (Verify, the queue, Verify by document, Open PDF); frames on
other layers keep the unit as it is. Other keys (for example `was` and `change`, recording the old value and the
change log entry) are kept for the record and not read by the app. `label` may be corrected the same way.

A layer may also add a unit of its own: `"NICE-C120": { "add": true, "id": "NICE-C120", "kind": "component", "label": "...",
"text": "...", "page": "3", "parent": "NICE-I01", "use_tier": "Paper corpus", "flags": [] }`. It loads with the
document's other units, takes its codes from the layer's `codes` like any other unit, and counts only for frames on
that layer. A layer flag `held` keeps a unit out of the frame's totals until a ruling, as `not-coded` does.
The grey literature review uses these for the quote and page corrections of 12 October 2026 and for DE06 and IS06,
re-charted from the original PDFs (layer `master-v2.0.1`).

## Screening (optional)

`review.json` switches full-text screening on:

```json
"screening": {
  "enabled": true, "stage": "full-text", "blind": true,
  "note": "Shown to screeners.",
  "records": "screening/records.json", "first": "screening/first-screen.json",
  "definitions": [{ "term": "Cognitive impairment", "text": "acquired or developmental impairment ..." }],
  "criteria": [{ "id": "population", "label": "Population", "include": "PEH, covering ...", "exclude": "Exclusively paediatric populations. ..." }],
  "judgements": ["Met", "Not met", "Unclear"],
  "reasons": [{ "criterion": "population", "text": "Exclusively paediatric populations." }],
  "rulings": [{ "id": "D1", "question": "...", "ruling": "..." }],
  "source": "Protocol v3.2, section 3"
}
```

- `definitions` (optional) show above the criteria, each as its term and text, so a criterion can say "as defined above".
- Each criterion shows its `include` and `exclude` text under "Protocol definition". Copy them word for word from the protocol. An older review may give one `definition` string instead.
- `reasons` are offered when a screener excludes, grouped under each criterion's label. A reason may be a plain string (no grouping). The decision event stores the reason's `text`.
- `first` is optional. Without a first screen for a record, blinded screening saves the decision and moves on, and says the screens are compared after both are complete. This is how a second screener works in a separate repo that holds no first screen. Their `work/<handle>/` files are copied into the main repo afterwards, where the first screen shows beside each saved decision.
- `rulings` are optional. Leave them out where they would show the first screen's decisions.

Without `screening`, or with `enabled: false`, the Screen tab says screening is off.

`screening/records.json` lists every record assessed at full text, in the `documents/index.json` profile shape (`id`, `title`, `short`, `year`, `type`, `url`, `pdf`, `pdf_parts`, `flags`, `note`, `fulltext_source`). Records that are also included documents keep the same ID.

`screening/first-screen.json`:

```json
{ "screener": "joebtay", "name": "Project lead", "date": "2026-10-07", "basis": "...",
  "records": { "CI18": {
    "criteria": { "concept": { "judgement": "Not met", "note": "Not met. No included study assessed cognition (p.11).",
                               "evidence": [{ "field": "Aim", "text": "..." }] } },
    "call": "Exclude (Wrong concept).", "rulings": ["D6"], "decision": "exclude", "reason": "Wrong concept" } } }
```

Screening events go in `work/<handle>/<record>.json`:

| type | Fields | Meaning |
|---|---|---|
| `screen` | record, criterion, action, value | Blinded: `action` is `judge` with `value` the screener's judgement. Open: `agree`, `disagree` (with `value`), `unsure`. `clear` removes either |
| `screen-decision` | record, decision, reason, note, revealed | `decision` is `include`, `exclude` (with a `reason`) or `discuss`. The latest is the current decision. Blinded: the first one was made before the first screen was shown and is the one agreement uses; later ones carry `revealed: true` |
| `comment` | unit `_screen`, text | Discussion on the record |

## documents/&lt;doc&gt;.pages.json

```json
{ "doc": "CI01", "source": "pdftotext", "pages": [{ "n": 2, "label": "127", "text": "Paragraph one.\n\nParagraph two." }] }
```

Optional. Feeds the Text tab of the Verify document view. `n` is the PDF page and `label` the printed page, so a note citing p.127 finds this page. Paragraphs are separated by a blank line. Build it with `tools/extract_pages.py <data repo>` in `review-coder`, which reads `pdf_parts` for the printed number of each part's first page. Without it, the document view shows the PDF.

## samples/&lt;sample&gt;.json

```json
{
  "id": "taxonomy-s1",
  "frame": "taxonomy",
  "layer": "master-v1.3",
  "created": "2026-10-07T09:00:00Z",
  "created_by": "joebtay",
  "seed": 20261007,
  "fraction": 0.15,
  "min_per_stratum": 2,
  "stratify_by": "function_primary",
  "population": 3905,
  "strata": { "Reach and access": { "population": 955, "drawn": 144 } },
  "topped_up": ["DOC-ID"],
  "units": [{ "doc": "NICE-NG214", "unit": "NICE-C014" }],
  "locked": true,
  "reason": "First verification sample"
}
```

`mode` is `percent` (the stratified draw above) or `documents`. A `documents` sample also lists `docs` and has no seed: it holds every coded unit in those documents for its frame. Both Verify views use the same samples.

`mode` `assigned` is a scripted draw loaded as drawn and never redrawn (Task 6A: `tools/import_task6a.py` in the data repo). It adds:

```json
{
  "coders": { "joebtay": { "role": "PI" }, "xcoder": { "role": "Coder B" } },
  "blind": "until-all-submit",
  "fields": ["level", "function_primary", "subcategory"],
  "answers": "workbook",
  "definitions": { "level|System": { "definition": "...", "source": "Study definition" } },
  "units": [{ "doc": "T4B09", "unit": "T4B09-C031", "order": { "joebtay": 4, "xcoder": 8 } }]
}
```

- Each coder sees only the units whose `order` names them, sorted by their own item number. Other accounts see no items.
- `fields` limits the fields checked; `definitions` (key `field|value`) replaces the frame wording for this sample.
- `answers: "workbook"` gives Agree, Disagree, Other and a note per field. Disagree means "this code is wrong" and needs a note.
- `answers: "question"` with `question: { "text": "...", "options": ["Heading", "Should be coded"] }` asks one question per item in place of checking codes (the grey literature heading sample). The coder picks an option (keys 1, 2, ...) and may add a note; Done opens once answered. The answer is a `verify` event with `field: "_question"`, `action: "answer"` and `value` the option. It does not enter code agreement.
- A unit may carry `slot` (`shared` with every coder, or `own` to one coder), `stratum` (`prioritised`, `random`, `not-coded`) and `tier`. The app shows each coder only their own order map, as before; the data repo's scripts use the labels for the figures.
- Blinding: other coders' events on the sample's units stay hidden until every coder in `coders` has a `submit` event. After a coder submits, their `verify`, `done`, `reopen` and `note` events for the sample are refused. Blinding is on screen only: anyone who can read the repository can read the files (PI ruling Q1, 10 October 2026).

## work/&lt;handle&gt;/&lt;doc&gt;.json

```json
{
  "schema": 1,
  "coder": "xcoder",
  "doc": "NICE-NG214",
  "events": [
    { "id": "lw3k9x-8f2a1c", "t": "2026-10-07T09:12:03.120Z", "coder": "xcoder",
      "type": "verify", "sample": "taxonomy-s1", "unit": "NICE-C014",
      "frame": "taxonomy", "field": "level", "action": "other", "value": "Individual" }
  ]
}
```

Event types:

| type | Fields | Meaning |
|---|---|---|
| `verify` | sample, unit, frame, field, action, value | `action` is `agree`, `disagree`, `other`, `unsure` or `clear` |
| `memo` | unit, frame, text | The verifier's own note on the unit |
| `done` | sample, unit, frame | The verifier has finished the unit (reveals first-coder notes) |
| `reopen` | sample, unit, frame | Undo `done` |
| `comment` | unit, text, reply_to | Shared discussion, visible to the whole team |
| `consensus` | unit, frame, field, value, text | Agreed value after discussion |
| `note` | sample, unit, frame, field, text | A verifier's note on one field (workbook answer set) |
| `passage` | page, pdf_file, pdf_page, start, end, quote, codes, comment, frame, sample | New code (`codes` set) or comment (`codes` null) on selected text in Verify by document. `page` is the page label in `<doc>.pages.json`; `start` and `end` are character offsets in that page's text; `quote` is the exact words. `sample` is set when the document is in a blind sample, so other coders cannot see it until everyone submits. Nothing changes the master: `tools/check_passages.py` checks each against its PDF page and exports them for the PI's ruling |
| `passage-withdraw` | passage, sample | Withdraws the coder's own passage. It stays in the record |
| `submit` | sample, items | The coder has finished an assigned sample. Stored under the pseudo-document `_samples` |
| `decision` | query, choice, text | A decision on a query in `queries.json`. Stored under the pseudo-document `_queries` (`work/<handle>/_queries.json`). `choice` is an option id |

**Rules.** Events are append-only and never edited or deleted. The latest event (by `t`, then `id`) for a given unit, frame and field holds the current state. Merging two copies of a file is the union of their events by `id`, so conflicts can't lose work. Each coder writes only to `work/<own handle>/`.

## setup.json (format 3, optional)

The set-up file for a project with several coders (PI, 11 and 12 October 2026). The app does not read it; the
data repo's team tools do (in `greylit-review-data`: `tools/team_setup.py`, `tools/build_team_repo.py`,
`tools/lock_v2_sample.py`, `tools/copy_back.py`).

```json
{
  "format": 3,
  "repos": { "master": "joebtay/greylit-review-data", "team": "joebtay/greylit-team-<handle>" },
  "tasks": { "taxonomy": "...", "cfir": "..." },
  "coders": [
    { "handle": "joebtay", "name": "...", "role": "pi", "tasks": ["taxonomy", "cfir"], "repo": "master" },
    { "handle": "<handle>", "name": "...", "role": "coder", "tasks": ["taxonomy"], "repo": "joebtay/greylit-team-<handle>", "added": "<date>" }
  ],
  "never": [{ "handle": "<handle>", "reason": "..." }],
  "blind": { "where": "team", "on_screen": "until-all-submit" },
  "team_repo": { "frames": ["taxonomy-v2"], "layer": "master-v2.0", "samples": "greylit-v2-", "features": {}, "project_sections": ["team", "links"] }
}
```

- The list starts with the PI. A coder is added when the PI names them; adding one never changes a sample.
- Each coder who is not the PI has their own team repo, named from `repos.team`. The PI codes in the master repo.
- Guard: the build, the lock and the copy-back refuse a handle that is not a coder for that task, and any handle on `never`.
- A team repo holds one coder's items only: each sample is copied with that coder's units and order alone, without sampling labels (slot, stratum, tier, seed). Blinding between coders is by repo.
- Copy-back runs once per coder, after they submit: `work/<handle>/` in the team repo goes to `work/<handle>/` in the master repo. It refuses an event on a unit not assigned to that coder, any other folder, another coder's events, and a sample the coder has not submitted. It also waits until the PI, when a coder in the same sample, has submitted it, since the PI works in the master repo. There is no override (PI ruling T1, 12 October 2026). Methods line (PI): "Each second coder worked in a separate repository with no access to other coders' work. A second coder's work was returned to the PI only after both that coder and the PI had submitted." A coder does not see which of their items are shared (PI ruling T2).

## documents/exclusions.json (optional)

One register of every document and passage a project has excluded, with the reason, date and ruling for each. The app does not read it; a project's own converter and check scripts do. The grey literature review builds it from its master workbook (`tools/build_exclusions.py` in that data repo).

```json
{
  "rulings": { "population-rule": { "date": "2026-10-01", "by": "PI", "text": "...", "source": "..." } },
  "documents": [{ "doc": "DOC-ID", "title": "...", "stage": "Excluded in charting", "reason": "...", "ruling": "population-rule", "date": "2026-10-01", "platform": "never loaded" }],
  "passages": [{ "unit": "DOC-ID-C001", "doc": "DOC-ID", "reason": "...", "ruling": "population-rule", "date": "2026-10-01", "with_document": true, "platform": "never loaded" }]
}
```

`stage` names the PRISMA stage at which a document left. `with_document` is true when a passage left because its whole document did. `platform` says whether the item is loaded at all; a passage kept on the platform must carry `excluded: true` in its unit file.
