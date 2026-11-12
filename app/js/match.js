// Locate coded fragments in a document's page text. Pure functions, tested in tests/core.test.mjs.

const MAP = {
  '‘': "'", '’': "'", '“': '"', '”': '"', '‐': '-', '‑': '-', '–': '-', '—': '-', '−': '-',
  '·': '.', ' ': ' ', '­': '', 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl',
};

/** Lower-case text with quotes, dashes, ligatures and whitespace made uniform. idx maps each output character to its index in s. */
export function normalise(s) {
  s = String(s ?? '');
  let text = '';
  const idx = [];
  let space = true;
  for (let i = 0; i < s.length; i++) {
    const raw = s[i];
    if ((raw === '-' || raw === '‐') && s[i + 1] === '\n' && /[a-z]/.test(s[i + 2] || '')) { i++; continue; } // hyphen at a line break
    const c = MAP[raw] ?? raw;
    for (const ch of c) {
      if (/\s/.test(ch)) { if (space) continue; text += ' '; idx.push(i); space = true; continue; }
      for (const lc of ch.toLowerCase()) { text += lc; idx.push(i); }
      space = false;
    }
  }
  return { text, idx };
}

/** Text worth searching for: the unit itself when it is verbatim (paragraph or component), quoted phrases of 12+ characters, and any quotes a coder recorded. */
export function snippetsFor(unit, extra = []) {
  const t = (unit && unit.text) || '';
  const out = [];
  if (unit && (unit.kind === 'paragraph' || unit.kind === 'component')) out.push(t);
  t.split('"').forEach((seg, i) => { if (i % 2 === 1) out.push(seg); }); // straight quotes pair in order
  for (const m of t.matchAll(/“([^“”]+)”/g)) out.push(m[1]);
  out.push(...extra);
  return [...new Set(out.map((s) => String(s || '').trim()).filter((s) => s.length >= 12))];
}

/** Every place a snippet occurs in the page text, as {start, end, snippet} offsets into pageText. Long snippets that do not match whole fall back to their first and last 60 characters. */
export function findSpans(pageText, snippets) {
  const N = normalise(pageText);
  const spans = [];
  for (const s of snippets) {
    const q = normalise(s).text.trim();
    if (q.length < 12) continue;
    const tries = q.length > 90 ? [q, q.slice(0, 60).trim(), q.slice(-60).trim()] : [q];
    for (const t of tries) {
      let from = 0, hit = false;
      for (;;) {
        const k = N.text.indexOf(t, from);
        if (k < 0) break;
        spans.push({ start: N.idx[k], end: N.idx[k + t.length - 1] + 1, snippet: s });
        hit = true;
        from = k + t.length;
      }
      if (hit && t === q) break;
    }
  }
  return spans;
}

/** Page numbers cited in a note: p.127, pp.128-129, pp.241, 243, (e23), e30-e31, ms p.74. Returns numbers (e-pages as their number). Short ranges are filled in. */
export function pageRefs(text) {
  const out = new Set();
  const add = (a, b) => {
    const x = parseInt(String(a).replace(/^e/i, ''), 10);
    const y = b == null ? x : parseInt(String(b).replace(/^e/i, ''), 10);
    if (!Number.isFinite(x)) return;
    if (Number.isFinite(y) && y >= x && y - x <= 5) for (let n = x; n <= y; n++) out.add(n); else { out.add(x); if (Number.isFinite(y)) out.add(y); }
  };
  const s = String(text ?? '');
  for (const m of s.matchAll(/\b(?:pp?\.|pages?)\s*(e?\d{1,5}(?:\s*(?:,|-|–|to|and)\s*e?\d{1,5})*)/gi)) {
    const g = m[1];
    for (const part of g.split(/\s*(?:,|and)\s*/i)) {
      const r = part.match(/^(e?\d{1,5})(?:\s*(?:-|–|to)\s*(e?\d{1,5}))?$/i);
      if (r) add(r[1], r[2]);
    }
  }
  for (const m of s.matchAll(/(?:^|[\s(,])(e\d{1,5})(?:\s*[-–]\s*(e\d{1,5}))?(?=[\s).,;]|$)/g)) add(m[1], m[2]);
  return [...out].sort((a, b) => a - b);
}

/** Split [0, len) at span boundaries. Each segment lists the keys of the spans that cover it. */
export function segments(len, spans) {
  const cuts = new Set([0, len]);
  for (const s of spans) { cuts.add(Math.max(0, Math.min(len, s.start))); cuts.add(Math.max(0, Math.min(len, s.end))); }
  const pts = [...cuts].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (a === b) continue;
    const keys = [...new Set(spans.filter((s) => s.start <= a && s.end >= b).map((s) => s.key))];
    out.push({ start: a, end: b, keys });
  }
  return out;
}
