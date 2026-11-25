// Line icons (24×24, stroke = currentColor) used across the interface.
const P = {
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
  recenter: '<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/><circle cx="12" cy="12" r="3"/>',
  camera: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3 3.8M6.3 6.8C3.9 8.5 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
  pause: '<rect x="7" y="5.5" width="3.5" height="13" rx="1" fill="currentColor"/><rect x="13.5" y="5.5" width="3.5" height="13" rx="1" fill="currentColor"/>',
  loop: '<path d="M17 3l3 3-3 3"/><path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H20M7 21l-3-3 3-3"/><path d="M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H4"/>',
  prev: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  film: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M8 4.5v15M16 4.5v15M3.5 9.5H8M3.5 14.5H8M16 9.5h4.5M16 14.5h4.5"/>',
  pose: '<circle cx="12" cy="4.8" r="2"/><path d="M5 9.5l7 1 7-1M12 10.5v4.5M12 15l-3.5 5.5M12 15l3.5 5.5"/>',
  shirt: '<path d="M8.5 3.5L4 6l-1.5 4.5 3 1.2V20.5h13V11.7l3-1.2L20 6l-4.5-2.5c-.5 1.6-1.9 2.6-3.5 2.6S9 5.1 8.5 3.5z"/>',
  sword: '<path d="M14.5 3.5H20.5V9.5L10 20l-6-6z"/><path d="M7 13l4 4M3.5 20.5l2.5-2.5"/>',
  face: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.5c1 1.4 2.2 2 3.5 2s2.5-.6 3.5-2"/><path d="M9 9.5v1M15 9.5v1"/>',
  bulb: '<path d="M9 17.5h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.2v1.5h5V16c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 15.5l-4.5-4.5-9.5 8.5"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 1.8-1 1.8-1.8 0-1.3-1.1-1.6-1.1-2.7 0-1 .8-1.6 1.8-1.6h2.2a3.8 3.8 0 0 0 3.8-3.8C20.5 6.7 16.7 3.5 12 3.5z"/><circle cx="7.5" cy="11" r="1.1" fill="currentColor"/><circle cx="10.5" cy="7.3" r="1.1" fill="currentColor"/><circle cx="15" cy="7.5" r="1.1" fill="currentColor"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  storage: '<ellipse cx="12" cy="6" rx="7.5" ry="2.8"/><path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4.5V9h4.5"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 2M9.5 2.5h5"/>',
  frame: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  sparkle: '<path d="M12 3.5l1.9 5.2 5.1 1.9-5.1 1.9L12 17.7l-1.9-5.2L5 10.6l5.1-1.9z"/><path d="M19 16.5l.8 2 2 .7-2 .8-.8 2-.7-2-2-.8 2-.7z"/>',
  more: '<circle cx="6" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="18" cy="12" r="1.5" fill="currentColor"/>',
  user: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5"/>',
};
export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'ico ' + cls);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = P[name] ?? P.more;
  return s;
}
// Replace every <i data-icon="name"></i> placeholder in the document.
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('i[data-icon]')) el.replaceWith(icon(el.dataset.icon, el.className));
}
