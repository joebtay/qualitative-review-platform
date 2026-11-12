// The welcome page (PI, 24 October 2026). Public: it shows only the text the PI publishes (cloudflare/welcome.js).
// The page is built with the project list's text; this brings in the PI's latest edit, and says "Open your review"
// to someone already signed in on this device.
const h = (tag, attrs, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) (k === 'text' ? (e.textContent = v) : e.setAttribute(k, v));
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
};

export function reviewCard(p) {
  return h('section', { class: 'card review', id: `review-${p.id}` },
    h('div', { class: 'row', style: 'justify-content:space-between;margin-top:0' }, h('h2', { text: p.title }), h('span', { class: 'status' + (p.open ? ' open' : ''), text: p.status })),
    p.description ? h('p', { class: 'desc', text: p.description }) : null,
    (p.links || []).length ? h('div', null, h('h4', { text: 'Links' }), h('ul', null, p.links.map((l) => h('li', null, h('a', { href: l.url, target: '_blank', rel: 'noopener', text: l.label }))))) : null,
    (p.team || []).length ? h('div', null, h('h4', { text: 'Team' }), h('ul', null, p.team.map((m) => h('li', null, m.name, m.role ? h('span', { class: 'muted', text: `, ${m.role}` }) : null)))) : null);
}

export function render(c) {
  document.getElementById('w-title').textContent = c.intro.title;
  document.getElementById('w-intro').textContent = c.intro.text;
  document.getElementById('w-reviews').replaceChildren(...c.projects.map(reviewCard));
}

try {
  const s = JSON.parse(localStorage.getItem('rc:session') || 'null');
  if (s && Date.parse(s.expires) > Date.now()) document.getElementById('w-signin').textContent = 'Open your review';
} catch {}
fetch('/api/welcome').then((r) => (r.ok ? r.json() : null)).then((c) => { if (c && c.intro) render(c); }).catch(() => {});
