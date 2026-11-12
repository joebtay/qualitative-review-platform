// Orientation to the coding frame: opens before a coder's first item in a sample and stays one
// click away while coding (PI ruling 2, 10 October 2026). The text is a Markdown file in the data
// repo, named in review.json as `orientation.file`; `orientation.task` is the one-line task shown
// at the top of the Verify screen. A frame can carry its own orientation in `frame_settings`
// (settings.js), so an older and a newer frame each open their own page and task line.
import { S } from './data.js';
import { h, mdToHtml } from './ui.js';
import { frameSetting, anyOrientation } from './settings.js';

let cache = { file: null, html: null };

const orient = (frameId) => frameSetting(frameId ?? S.frameInView, 'orientation', S.review) || null;
/** True when this frame (or the review) has an orientation page. */
export const hasOrientation = (frameId) => { const o = orient(frameId); return !!(o && o.file); };
/** True when any frame has one: the header shows its button. */
export const anyHasOrientation = () => anyOrientation(S.review);
/** The frame whose page the header button opens: the frame in view, else the first frame that has a page. */
export function orientationFrame() {
  if (hasOrientation(S.frameInView)) return S.frameInView;
  return Object.keys(S.review.frame_settings || {}).find((f) => hasOrientation(f)) ?? S.frameInView;
}

const seenKey = (sampleId) => `rc:${S.review.id}:${S.handle}:orientation:${sampleId}`;
export function seen(sampleId) { try { return localStorage.getItem(seenKey(sampleId)) === '1'; } catch { return false; } }
export function markSeen(sampleId) { try { localStorage.setItem(seenKey(sampleId), '1'); } catch {} }

/** True when the orientation should open before the first item of this sample. */
export function shouldOpen(sample, doneN) { return !!sample && hasOrientation(sample.frame) && doneN === 0 && !seen(sample.id); }

/** The orientation page for a frame (default: the frame in view). `onStart` closes it and goes to the coding screen. */
export function orientationPage(onStart, startLabel = 'Start coding', frameId) {
  const body = h('div', { class: 'md orient' });
  const file = orient(frameId).file;
  if (cache.file === file && cache.html != null) body.innerHTML = cache.html;
  else {
    body.append(h('p', { class: 'muted', text: 'Loading the orientation' }));
    S.store.readText(file).then((t) => { cache = { file, html: mdToHtml(t) }; body.innerHTML = cache.html; })
      .catch((e) => { body.textContent = 'Could not load the orientation: ' + e.message; });
  }
  return h('div', { class: 'page narrow' }, h('section', { class: 'card' }, body,
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', id: 'orient-start', onclick: onStart, text: startLabel }))));
}

/** The task line at the top of the Verify screen, with its link to the orientation. */
export function taskLine(openIt, frameId) {
  const o = orient(frameId) || {};
  if (!o.task) return null;
  return h('div', { class: 'taskline' }, h('span', { text: o.task + ' ' }),
    hasOrientation(frameId) ? h('button', { type: 'button', class: 'link', id: 'orient-open', onclick: openIt, text: o.link || 'How the codes work' }) : null);
}
