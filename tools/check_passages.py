"""Check every new code and comment on selected text (passage events) against its PDF page, and export them
for the PI's ruling before master v1.5.

Usage: python3 check_passages.py DATA_REPO_DIR [--csv OUT.csv]

For each live passage in work/<handle>/<doc>.json (withdrawn ones are skipped, but listed):
  1. the document is in documents/index.json and is Paper corpus;
  2. the page exists in documents/<doc>.pages.json and its text from start to end is the saved words;
  3. the saved PDF file and page are the ones that page came from;
  4. a fresh pdftotext read of that PDF page (same method as extract_pages.py) holds the saved words.
Exits 1 if any check fails. --csv writes every live passage, from every coder, with its words, page,
codes, coder and comment. It reads the repo directly and ignores blinding: run it after both coders submit.
Needs pdftotext (poppler-utils).
"""
import csv, glob, json, os, re, sys, unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract_pages import page_text  # noqa: E402

# code fields: the ones the passages carry, in the order they first appear (each review sets its own; app/js/settings.js)
FIELDS = []


def norm(s):
    s = unicodedata.normalize("NFKC", s or "")
    s = s.translate(str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "‑": "-", "­": ""}))
    return re.sub(r"\s+", " ", s).strip()


def main(repo, out_csv):
    index = {d["id"]: d for d in json.load(open(os.path.join(repo, "documents", "index.json"), encoding="utf-8"))}
    events = []
    for f in sorted(glob.glob(os.path.join(repo, "work", "*", "*.json"))):
        handle = os.path.basename(os.path.dirname(f))
        for e in json.load(open(f, encoding="utf-8")).get("events", []):
            events.append((handle, e))
    gone = {(e["coder"], e["passage"]) for _, e in events if e.get("type") == "passage-withdraw"}
    live = [(h, e) for h, e in events if e.get("type") == "passage" and (e["coder"], e["id"]) not in gone]
    print(f"{len(live)} live passages, {len(gone)} withdrawn")
    fails, pages_cache, rows = 0, {}, []

    def check(name, ok, extra=""):
        nonlocal fails
        print(("PASS " if ok else "FAIL ") + name + (f"  {extra}" if extra else ""))
        if not ok: fails += 1

    for _, e in live:
        for k in (e.get("codes") or {}):
            if k not in FIELDS: FIELDS.append(k)
    for handle, e in live:
        tag = f"{e['id']} ({e['coder']}, {e['doc']} p. {e['page']})"
        check(f"{tag} written by its own coder", e["coder"] == handle)
        d = index.get(e["doc"])
        check(f"{tag} document is Paper corpus", bool(d) and d.get("use_tier") == "Paper corpus")
        if not d: continue
        if e["doc"] not in pages_cache:
            pp = os.path.join(repo, "documents", f"{e['doc']}.pages.json")
            pages_cache[e["doc"]] = json.load(open(pp, encoding="utf-8"))["pages"] if os.path.exists(pp) else []
        pg = next((p for p in pages_cache[e["doc"]] if str(p["label"]) == str(e["page"])), None)
        check(f"{tag} page exists in the page text", pg is not None)
        if not pg: continue
        u16 = pg["text"].encode("utf-16-le")  # the app counts offsets in UTF-16 code units, as JavaScript does
        check(f"{tag} saved words equal the page text at the saved offsets", u16[2 * e["start"]:2 * e["end"]].decode("utf-16-le", "replace") == e["quote"])
        want_file = pg.get("file") or d.get("pdf") or f"documents/{e['doc']}.pdf"
        check(f"{tag} PDF file and page are where that page came from", (e.get("pdf_file"), e.get("pdf_page")) == (want_file, pg["n"]), f"{e.get('pdf_file')} {e.get('pdf_page')} / {want_file} {pg['n']}")
        path = os.path.join(repo, want_file)
        fresh = page_text(path, pg["n"]) if os.path.exists(path) else ""
        check(f"{tag} words found on the PDF page by a fresh pdftotext read", norm(e["quote"]) in norm(fresh))
        codes = e.get("codes") or {}
        rows.append({"id": e["id"], "kind": "new code" if any(codes.get(k) for k in FIELDS) else "comment", "doc": e["doc"], "title": d.get("title", ""),
                     "page": e["page"], "pdf_file": e.get("pdf_file"), "pdf_page": e.get("pdf_page"), "words": e["quote"],
                     **{k: codes.get(k) or "" for k in FIELDS}, "comment": e.get("comment") or "", "coder": e["coder"], "time": e["t"], "sample": e.get("sample") or ""})
    if out_csv:
        with open(out_csv, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=["id", "kind", "doc", "title", "page", "pdf_file", "pdf_page", "words", *FIELDS, "comment", "coder", "time", "sample"])
            safe = lambda v: "'" + v if isinstance(v, str) and v[:1] in "=+-@" and v else v
            pn = lambda p: int(p) if str(p).isdigit() else 10 ** 6
            w.writeheader(); w.writerows({k: safe(v) for k, v in r.items()} for r in sorted(rows, key=lambda r: (r["doc"], pn(r["page"]), r["time"])))
        print(f"WROTE {out_csv}: {len(rows)} rows")
    print(f"{fails} failures")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    a = sys.argv[1:]
    out = a[a.index("--csv") + 1] if "--csv" in a else None
    main(a[0], out)
