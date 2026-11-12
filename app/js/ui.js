// Tiny DOM helpers.

export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) e.style.setProperty(sk, sv); else e.style[sk] = sv; } }
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'text') e.textContent = v;
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    }
  }
  for (const c of kids.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}

export function colourFor(s) {
  let x = 0;
  for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${x % 360} 55% 48%)`;
}

export function chip(label, { onclick, title, plain } = {}) {
  return h('button', { type: 'button', class: 'chip', title: title || 'Show the definition', onclick },
    plain ? null : h('span', { class: 'dot', style: { background: colourFor(label) } }), label);
}

export function bar(frac, colour) {
  return h('div', { class: 'bar' }, h('div', { style: { width: `${Math.max(0, Math.min(1, frac || 0)) * 100}%`, background: colour || 'var(--green)' } }));
}

export const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '0%');

export function mdToHtml(src) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Markdown escapes such as "1\." (written by some editors) show as the plain character.
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>').replace(/\\([.\-#()[\]!+_|])/g, '$1');
  const lines = src.split('\n');
  const out = [];
  let i = 0, list = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  while (i < lines.length) {
    const l = lines[i];
    let m;
    if (/^```/.test(l)) { // fenced block: shown as written, for small diagrams
      closeList();
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(esc(lines[i++]));
      out.push(`<pre>${body.join('\n')}</pre>`);
    } else if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) {
      closeList();
      const id = 'h-' + m[2].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      out.push(`<h${m[1].length + 1} id="${id}" data-h="${esc(m[2])}">${inline(m[2])}</h${m[1].length + 1}>`);
    } else if (/^\|/.test(l) && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1] || '')) {
      closeList();
      const cells = (r) => r.replace(/^\||\|\s*$/g, '').split('|').map((c) => c.trim());
      out.push('<table><thead><tr>' + cells(l).map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>');
      i += 2;
      while (i < lines.length && /^\|/.test(lines[i])) { out.push('<tr>' + cells(lines[i]).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>'); i++; }
      out.push('</tbody></table>');
      continue;
    } else if ((m = /^>\s?(.*)$/.exec(l))) {
      closeList();
      out.push(`<blockquote>${inline(m[1])}</blockquote>`);
    } else if ((m = /^\s*[-*]\s+(.*)$/.exec(l))) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = /^\s*\d+\.\s+(.*)$/.exec(l))) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if (/^---+\s*$/.test(l)) {
      closeList();
      out.push('<hr>');
    } else if (l.trim() === '' || l.trim() === '&nbsp;') {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(l)}</p>`);
    }
    i++;
  }
  closeList();
  return out.join('\n');
}
