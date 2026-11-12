"""Extract page text from a review's PDFs for the Verify document view.

Usage: python3 extract_pages.py DATA_REPO_DIR [DOC_ID ...]

For each document in documents/index.json (and screening/records.json, if present) with a PDF in the repo, writes
documents/<ID>.pages.json: {"doc", "source", "pages": [{"n", "label", "text"}]}.
n is the PDF page. label is the printed page number, from pdf_parts "from"
(the printed number of the part's first PDF page), or the PDF page if not set.
Text is read in content order (pdftotext -raw), which keeps two-column journal pages in reading order.
Lines are joined into paragraphs; a blank line separates paragraphs.
Needs pdftotext and pdfinfo (poppler-utils).
"""
import json
import os
import re
import subprocess
import sys


def pdf_pages(path):
    out = subprocess.run(["pdfinfo", path], capture_output=True, text=True, check=True).stdout
    return int(re.search(r"^Pages:\s+(\d+)", out, re.M).group(1))


def page_text(path, n):
    raw = subprocess.run(["pdftotext", "-raw", "-f", str(n), "-l", str(n), "-enc", "UTF-8", path, "-"],
                         capture_output=True, text=True, check=True).stdout
    raw = raw.replace("\f", "")
    paras = []
    for block in re.split(r"\n\s*\n", raw):
        lines = [l.strip() for l in block.split("\n") if l.strip()]
        if not lines:
            continue
        text = ""
        for l in lines:
            if text[-1:] in ("-", "\u2010", "\u00ad") and l[:1].islower():
                text = text[:-1] + l
            elif text:
                text += " " + l
            else:
                text = l
        paras.append(text)
    return "\n\n".join(paras)


def main(repo, only):
    docs = json.load(open(os.path.join(repo, "documents", "index.json"), encoding="utf-8"))
    # full-text screening records (excluded ones too) need page text as well
    rp = os.path.join(repo, "screening", "records.json")
    if os.path.exists(rp):
        seen = {d["id"] for d in docs}
        docs += [r for r in json.load(open(rp, encoding="utf-8")) if r["id"] not in seen]
    for d in docs:
        if only and d["id"] not in only:
            continue
        parts = d.get("pdf_parts") or [{"file": d.get("pdf") or f"documents/{d['id']}.pdf", "from": 1, "to": None}]
        if all(not os.path.exists(os.path.join(repo, p["file"])) for p in parts):
            continue
        pages = []
        for part in parts:
            path = os.path.join(repo, part["file"])
            if not os.path.exists(path):
                continue
            first = part.get("from") or 1
            for n in range(1, pdf_pages(path) + 1):
                pages.append({"n": n, "label": str(first + n - 1), "text": page_text(path, n), **({"file": part["file"]} if len(parts) > 1 else {})})
        if not pages:
            continue
        out = os.path.join(repo, "documents", f"{d['id']}.pages.json")
        with open(out, "w", encoding="utf-8") as fh:
            json.dump({"doc": d["id"], "source": "pdftotext", "pages": pages}, fh, ensure_ascii=False, indent=1)
            fh.write("\n")
        print(d["id"], len(pages), "pages")


if __name__ == "__main__":
    main(sys.argv[1], set(sys.argv[2:]))
