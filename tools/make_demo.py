"""Builds the invented demo project in app/demo/. Nothing here comes from a real review."""
import json, os, random
ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "demo")
rnd = random.Random(7)

def dump(rel, obj):
    p = os.path.join(ROOT, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "w", encoding="utf-8").write(json.dumps(obj, ensure_ascii=False, indent=1) + "\n")

THEMES = {
 "Access": ["Opening hours", "Location and transport", "Cost to participants"],
 "Skills": ["Horticultural skills", "Social skills"],
 "Wellbeing": ["Mood and stress", "Physical activity", "Belonging"],
 "Organisation": ["Funding", "Volunteers", "Partnerships"],
}
DEFS = {
 "Access": "What helps or stops people from taking part in the garden: when, where and at what cost.",
 "Skills": "What participants learn by taking part.",
 "Wellbeing": "Effects on how participants feel or function.",
 "Organisation": "How the garden is run and kept going.",
}
theme_vals = [{"id": k, "label": k, "group": "Invented theme", "parent": None, "definition": DEFS[k], "anchors": []} for k in THEMES]
sub_vals = [{"id": s, "label": s, "group": t, "parent": t, "definition": f"A subtheme of {t}, invented for the demo.", "anchors": []} for t, ss in THEMES.items() for s in ss]
STAT = ["reported outcome", "participant view", "organiser view"]
frames = {
 "themes": {"id": "themes", "name": "Themes", "type": "taxonomy", "description": "Invented two-level theme frame for the demo.", "stratify_by": "theme",
  "fields": [
   {"id": "theme", "label": "Theme", "codebook_ref": "Themes", "required": True, "multi": False, "depends_on": None, "rules": ["Code what the paragraph is mainly about.", "Choose by the main point. Do not double-code."], "values": theme_vals},
   {"id": "subtheme", "label": "Subtheme", "codebook_ref": "Themes", "required": False, "multi": False, "depends_on": "theme", "rules": ["One subtheme, from the chosen theme only."], "values": sub_vals}]},
 "attributes": {"id": "attributes", "name": "Attributes", "type": "attribute", "description": "Whose voice the paragraph carries.", "stratify_by": "voice",
  "fields": [{"id": "voice", "label": "Voice", "codebook_ref": "Voice", "required": True, "multi": False, "depends_on": None, "rules": ["Code who is speaking, not who is spoken about."],
   "values": [{"id": v, "label": v, "group": None, "parent": None, "definition": d, "anchors": []} for v, d in zip(STAT, ["A measured result.", "A participant describes their experience.", "An organiser describes how things work."])]}]},
}
SENT = {
 "Access": ["The garden opens on weekday mornings only, which excludes people who work.", "Most participants reached the garden on foot; the nearest bus stop is 1.2 km away.", "Sessions are free, but tool hire was charged at the start of the project."],
 "Skills": ["Participants learned to propagate seedlings and to read a planting calendar.", "Working in pairs built confidence in asking for help."],
 "Wellbeing": ["Mean stress scores fell by 4 points over twelve weeks.", "One participant said the garden was the only place she felt calm all week.", "Attendance was linked to more walking each day."],
 "Organisation": ["Funding came from a three-year council grant that ends in March.", "Two volunteers ran each session after a one-day training.", "The garden shares a site with a primary school."],
}
docs, layer_codes = [], {}
for di, (did, title, org) in enumerate([("DEMO-A", "Community garden pilot: final report", "Invented Trust"), ("DEMO-B", "Gardens and wellbeing: a short evaluation", "Example University"),
                                        ("DEMO-C", "Running a neighbourhood garden: a practice guide", "Sample Council"), ("DEMO-D", "Voices from the garden: participant stories", "Placeholder Network")]):
    units, codes, notes = [], {}, {}
    for i in range(10):
        theme = rnd.choice(list(THEMES)); sub = rnd.choice(THEMES[theme]) if rnd.random() < .8 else None
        first = rnd.choice(SENT[theme]); other = rnd.choice(SENT[rnd.choice(list(THEMES))])
        text = first if first == other else first + " " + other
        uid = f"{did}-p{i+1:04d}"
        units.append({"id": uid, "kind": "paragraph", "label": None, "text": text, "page": str(3 + i // 3), "parent": None, "flags": ["merged"] if i % 4 == 3 else [], "excluded": False})
        conf = round(rnd.uniform(.5, .98), 2)
        codes[uid] = {"themes": {"theme": {"v": theme, "conf": conf, "why": f"Mainly about {theme.lower()}."}, "subtheme": sub},
                      "attributes": {"voice": {"v": STAT[(di + i) % 3], "conf": conf, "why": "Judged from the verbs and the speaker."}}}
        if i % 5 == 0: notes[uid] = "Check against the neighbouring paragraph."
    docs.append({"id": did, "title": title, "authors": "Invented Author", "org": org, "year": str(2019 + di), "type": "Report", "family": ["Evaluation", "Research", "Guide", "Case study"][di],
                 "country": "Nowhere", "url": "https://example.org/" + did.lower(), "summary": "An invented document for the demo.", "summary_page": "1", "pdf": None, "flags": [], "interventions": []})
    dump(f"units/{did}.json", {"doc": did, "units": units})
    # Page text for the document view: the coded paragraphs in place, with uncoded filler between them.
    FILL = ["This section was written for the demo and has not been coded.", "The garden ran on two sites during the period covered here.",
            "Figures in this report are invented and refer to no real project.", "Readers should treat every name and number here as an example."]
    pages = [{"n": 1, "label": "1", "text": f"{title}\n\n{org}. An invented document for the demo. {FILL[2]}"},
             {"n": 2, "label": "2", "text": f"Contents and acknowledgements.\n\n{FILL[3]}"}]
    for pg in sorted({u["page"] for u in units}, key=int):
        paras = []
        for k, u in enumerate([u for u in units if u["page"] == pg]):
            paras += [FILL[(k + int(pg)) % len(FILL)], u["text"]]
        pages.append({"n": int(pg), "label": pg, "text": "\n\n".join(paras)})
    dump(f"documents/{did}.pages.json", {"doc": did, "source": "invented", "pages": pages})
    dump(f"layers/claude-demo/{did}.json", {"layer": "claude-demo", "doc": did, "codes": codes, "notes": notes, "flags": {}})
for d in docs:
    if d["id"] == "DEMO-D":
        d["flags"] = ["query:Q1"]
dump("documents/index.json", docs)
dump("queries.json", [{"id": "Q1", "title": "Participant stories: publication-level document?", "question": "DEMO-D is a collection of participant stories, not a report. Should it count as a publication-level document?",
  "docs": ["DEMO-D"], "related_docs": ["DEMO-B"], "context": "Invented example. A real query states what the document is and why it is borderline.",
  "options": [{"id": "include", "label": "Include in the review"}, {"id": "exclude", "label": "Exclude, and record the reason"}, {"id": "case-by-case", "label": "Decide after reading it"}],
  "priority": "medium", "raised": "2026-10-07", "raised_by": "claude", "status": "open"}])
for k, v in frames.items(): dump(f"frames/{k}.json", v)
dump("layers/claude-demo/run.json", {"layer": "claude-demo", "kind": "claude", "model": "demo", "date": "2026-10-07", "codebook_version": "demo", "frames": ["themes", "attributes"]})
open(os.path.join(ROOT, "codebook.md"), "w").write("# Demo codebook\n\nAn invented codebook.\n\n## Themes\n\nFour themes, each with subtheme values.\n\n| Theme | Meaning |\n|---|---|\n" + "\n".join(f"| {k} | {v} |" for k, v in DEFS.items()) + "\n\n## Voice\n\nWho is speaking.\n")
dump("review.json", {"schema": 1, "id": "demo", "title": "Demo: community gardens and wellbeing", "subtitle": "Invented data. Nothing here is real.", "unit": "paragraph", "codebook": "codebook.md", "codebook_version": "demo",
  "questions": [{"id": "RQ1", "text": "What helps people take part in community gardens?", "frames": ["themes"]}, {"id": "RQ2", "text": "What changes do participants report?", "frames": ["themes", "attributes"]}],
  "team": [{"handle": "demo-coder", "name": "You", "role": "Second coder"}], "links": [], "milestones": [{"date": None, "label": "Try the demo", "done": True}],
  "prisma": {"identified": 120, "screened": 120, "sought": 14, "assessed": 12, "excluded": [{"reason": "Wrong population", "n": 5}, {"reason": "Not a review document", "n": 3}], "included": 4},
  "frames": ["themes", "attributes"], "layers": [{"id": "claude-demo", "label": "Claude (demo)", "kind": "claude", "frames": ["themes", "attributes"]}], "first_layer": "claude-demo", "sampling": {"fraction": 0.15, "min_per_stratum": 2}})
# Full-text screening for the demo: the four included documents and two invented excluded records.
CRIT = [{"id": "population", "label": "Population", "definition": "Adults who take part in, or could take part in, a community garden."},
        {"id": "concept", "label": "Concept", "definition": "Participation in, or effects of, a community garden."},
        {"id": "context", "label": "Context", "definition": "Any community setting."},
        {"id": "source", "label": "Source", "definition": "A report, evaluation or guide, any year."}]
recs, first = [], {}
for d in docs:
    recs.append({"id": d["id"], "short": d["title"].split(":")[0], "title": d["title"], "authors": d["authors"], "year": d["year"], "type": d["type"], "pdf": None, "flags": []})
    first[d["id"]] = {"criteria": {c["id"]: {"judgement": "Met", "note": f"Met. Invented note on {c['label'].lower()} (p.3)."} for c in CRIT},
                      "call": "Include.", "rulings": [], "decision": "include", "reason": None}
for rid, title, why, crit in [("DEMO-X1", "Allotment waiting lists in one town", "Wrong concept", "concept"), ("DEMO-X2", "Garden design for schools", "Wrong population", "population")]:
    recs.append({"id": rid, "short": title, "title": title, "authors": "Invented Author", "year": "2021", "type": "Report", "pdf": None, "flags": []})
    first[rid] = {"criteria": {c["id"]: ({"judgement": "Not met", "note": f"Not met. This invented record is about {title.lower()}, not garden participation (p.2)."} if c["id"] == crit else {"judgement": "Met", "note": "Met. Invented note."}) for c in CRIT},
                  "call": f"Exclude ({why}).", "rulings": [], "decision": "exclude", "reason": why}
    dump(f"documents/{rid}.pages.json", {"doc": rid, "source": "invented", "pages": [{"n": 1, "label": "1", "text": f"{title}\n\nAn invented record for the demo."}, {"n": 2, "label": "2", "text": f"This invented record is about {title.lower()}, not garden participation."}]})
dump("screening/records.json", recs)
dump("screening/first-screen.json", {"screener": "demo-first", "name": "First screener (demo)", "date": "2026-10-08", "basis": "Invented.", "records": first})
rv = json.load(open(os.path.join(ROOT, "review.json")))
rv["screening"] = {"enabled": True, "stage": "full-text", "blind": True, "note": "Blinded full-text screening: judge each criterion and decide from the full text with the first screen hidden. Saving your decision shows the first screen beside yours.",
                   "records": "screening/records.json", "first": "screening/first-screen.json", "criteria": CRIT, "judgements": ["Met", "Not met", "Unclear"],
                   "reasons": ["Wrong population", "Wrong concept", "Wrong setting", "Wrong publication type"], "rulings": [], "source": "the demo protocol"}
dump("review.json", rv)

tree = sorted(os.path.relpath(os.path.join(d, f), ROOT) for d, _, fs in os.walk(ROOT) for f in fs if f != "tree.json")
dump("tree.json", tree)
print(len(tree), "files")
