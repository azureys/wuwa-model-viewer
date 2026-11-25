// Small DOM helpers and the shared controls used by every panel.
import { icon } from './icons.js';

export const $ = (s) => document.querySelector(s);
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
export const toast = (msg, ms = 2600) => { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms); };
export const status = (msg) => { $('#status').hidden = !msg; $('#statusText').textContent = msg ?? ''; };

export function slider(label, { min, max, step = 0.01, value, onInput, fmt = (v) => (+v).toFixed(2) }) {
  const val = h('span', { class: 'val' }, fmt(value));
  const input = h('input', { type: 'range', min, max, step, value, oninput: (e) => { val.textContent = fmt(e.target.value); onInput(+e.target.value); } });
  return h('div', { class: 'row' }, h('label', {}, label), input, val);
}
export function toggle(label, checked, onChange) {
  return h('div', { class: 'row' }, h('label', {}, label),
    h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) }), h('span')));
}
export function chips(options, current, onPick) {
  return h('div', { class: 'chips' }, options.map(([v, l]) => h('button', { class: 'chip', 'aria-pressed': String(v === current), onclick: () => onPick(v) }, l)));
}

// A floating glass list next to `anchor`, closed by tapping outside (or by the Android back button through
// popover.close). matchWidth: as wide as the anchor and left-aligned with it (dropdowns); otherwise
// right-aligned (overflow menus).
export function popover(anchor, list, { matchWidth = false } = {}) {
  const r = anchor.getBoundingClientRect();
  const scrim = h('div', { class: 'scrim', onclick: () => close() });
  const close = () => { scrim.remove(); list.remove(); popover.close = null; };
  list.classList.add('popmenu', 'glass');
  document.body.append(scrim, list);
  if (matchWidth) list.style.width = `${r.width}px`;
  const mw = list.offsetWidth, mh = list.offsetHeight;
  list.style.left = `${Math.max(8, Math.min(innerWidth - mw - 8, matchWidth ? r.left : r.right - mw))}px`;
  list.style.top = `${r.bottom + mh + 8 > innerHeight ? Math.max(8, r.top - mh - 6) : r.bottom + 6}px`;
  popover.close = close;
  return close;
}
// items: [iconName, label, onPick, className?]
export function popMenu(anchor, items) {
  const close = popover(anchor, h('div', {}, items.map(([ic, label, fn, cls]) => h('button', { class: cls ?? '', onclick: () => { close(); fn(); } }, icon(ic), label))));
}
// A field showing the current choice; tapping it opens the list. options: [{ value, label, swatch? }]
export function dropdown(options, current, onPick) {
  const opt = options.find((o) => o.value === current) ?? options[0];
  const btn = h('button', { class: 'dropdown', onclick: () => {
    const close = popover(btn, h('div', { class: 'dropmenu' }, options.map((o) =>
      h('button', { class: o.value === current ? 'on' : '', onclick: () => { close(); onPick(o.value); } }, o.swatch, o.label))), { matchWidth: true });
  } }, opt.swatch, h('span', {}, opt.label), icon('chevron'));
  return btn;
}
