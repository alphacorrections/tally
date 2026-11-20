/* Tally glass UI kit v1 (2026-11-19). Paste inline after the CSS. No dependencies. */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
var TP = {
  icons: {
    doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    home: '<path d="M3 11l9-8 9 8v10H3z"/><path d="M9 21v-6h6v6"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
    card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6 15h4"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-.8-1.6-.8-2.6c0-1 .8-1.9 2-1.9H17a4 4 0 0 0 4-4c0-4.2-4-7.5-9-7.5z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7" r="1"/>',
    plane: '<path d="M21 3L3 10l7 3 3 7z"/><path d="M10 13l5-5"/>',
    more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    spark: '<path d="M12 3l2.2 6.3L20 12l-5.8 2.7L12 21l-2.2-6.3L4 12l5.8-2.7z"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    cloud: '<path d="M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9.5a4.2 4.2 0 0 1-.5 8.5z"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>',
    piggy: '<path d="M4 12a7 6 0 0 1 14-1h2v4h-2a7 6 0 0 1-2 2v3h-3v-2h-3v2H7v-3a6 6 0 0 1-3-5z"/><circle cx="15" cy="11" r=".6"/>'
  },
  svg: function (name, w) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (w || 1.9) +
      '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (TP.icons[name] || '') + '</svg>';
  },
  busy: function (on, title, text) {
    var el = document.getElementById('tpBusy');
    if (!el) {
      el = document.createElement('div'); el.id = 'tpBusy'; el.className = 'tp-busy'; el.style.display = 'none';
      el.innerHTML = '<div class="tp-bx"><span class="tp-mk"></span><b></b><p></p><div class="tp-flow"></div></div>';
      document.body.appendChild(el);
    }
    if (on) { el.querySelector('b').textContent = title || 'Working'; el.querySelector('p').textContent = text || 'This takes a few seconds.'; el.style.display = ''; }
    else el.style.display = 'none';
  },
  loading: function (text) { return '<div class="tp-loading"><span class="tp-mk"></span><span>' + esc(text || 'Loading…') + '</span><div class="tp-flow"></div></div>'; },
  done: function (title, text) {
    return '<div class="tp-done"><svg class="tp-tick" viewBox="0 0 80 80"><circle cx="40" cy="40" r="36"/><path d="M24 41l11 11 21-23"/></svg>' +
      '<h3>' + esc(title || 'Done') + '</h3><p>' + esc(text || '') + '</p></div>';
  },
  fill: function (barEl, pct) {
    var i = barEl.querySelector('i'); if (!i) return; i.style.width = '0%';
    barEl.classList.toggle('tp-full', pct >= 100);
    setTimeout(function () { i.style.width = Math.max(0, Math.min(100, pct)) + '%'; }, 120);
  }
};

TP.icons.bank = '<path d="M3 9l9-5 9 5M5 9v9M10 9v9M14 9v9M19 9v9M3 20h18"/>';
TP.icons.close = '<path d="M6 6l12 12M18 6L6 18"/>';
TP.icons.compass = '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>';
TP.icons.people = '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M15.5 14.2c3 .2 5.5 2.6 5.5 5.8"/>';

/* look: 4 palettes x light/dark/auto, remembered per browser. Call TG.look.apply() in <head> to avoid a flash. */
var TG = {
  pals: [
    { id: 'forest', name: 'Forest + gold', sw: '#2E8B5E' }, { id: 'plum', name: 'Plum + mint', sw: '#7B4FC4' },
    { id: 'sunset', name: 'Charcoal + sunset', sw: '#D9632B' }, { id: 'teal', name: 'Teal + sand', sw: '#12A39A' }
  ],
  look: {
    key: 'tg.ui',
    get: function () { try { return JSON.parse(localStorage.getItem(this.key) || '{}'); } catch (e) { return {}; } },
    mode: function () { var m = this.get().mode || 'dark'; return m === 'auto' ? (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : m; },
    apply: function () { var de = document.documentElement, u = this.get(); de.setAttribute('data-pal', u.pal || 'forest'); de.setAttribute('data-theme', this.mode()); var meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.setAttribute('content', getComputedStyle(de).getPropertyValue('--g1').trim()); },
    set: function (pal, mode) { var u = this.get(); if (pal) u.pal = pal; if (mode) u.mode = mode; try { localStorage.setItem(this.key, JSON.stringify(u)); } catch (e) {} this.apply(); }
  },
  /* palette dots for the top of the main page */
  dots: function () { var cur = TG.look.get().pal || 'forest'; return '<div class="dots" role="group" aria-label="Theme color">' + TG.pals.map(function (p) { return '<button data-pal="' + p.id + '" class="' + (cur === p.id ? 'on' : '') + '" style="background:' + p.sw + '" aria-label="' + esc(p.name) + '"></button>'; }).join('') + '</div>'; },
  toast: function (msg) { var t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2800); },
  sheet: function (html) { TG.closeSheet(); var s = document.createElement('div'); s.className = 'tp-sheet'; s.id = 'sheet'; s.innerHTML = '<div class="tp-sx" role="dialog" aria-modal="true">' + html + '</div>'; s.addEventListener('click', function (e) { if (e.target === s || e.target.closest('[data-close]')) TG.closeSheet(); }); document.body.appendChild(s); },
  closeSheet: function () { var s = document.getElementById('sheet'); if (s) s.remove(); },
  sheetHead: function (title) { return '<div class="sxhead"><button class="ibtn" data-close aria-label="Close">' + TP.svg('close') + '</button><span class="grow"></span></div><h3>' + esc(title) + '</h3>'; },
  field: function (id, label, v, ph, type) { return '<div><label class="tp-label" for="' + id + '">' + esc(label) + '</label><input class="tp-input" id="' + id + '" type="' + (type || 'text') + '" value="' + esc(v == null ? '' : v) + '" placeholder="' + esc(ph || '') + '"></div>'; },
  seg: function (id, opts, cur) { return '<div class="seg" data-seg="' + id + '">' + opts.map(function (o) { return '<button type="button" data-v="' + esc(o[0]) + '" class="' + (String(cur) === String(o[0]) ? 'on' : '') + '">' + esc(o[1]) + '</button>'; }).join('') + '</div>'; },
  topBar: function (title, sub, right) { return '<div class="top"><div class="who"><span>' + esc(sub || '') + '</span><b>' + esc(title) + '</b></div>' + (right || '') + '</div>'; },
  nav: function (items, cur) { return '<nav class="nav">' + items.map(function (n) { return n.plus ? '<button class="plus" data-nav="' + n.id + '" aria-label="' + esc(n.name || 'Add') + '">' + TP.svg('plus', 2.4) + '</button>' : '<button data-nav="' + n.id + '" class="' + (cur === n.id ? 'on' : '') + '">' + TP.svg(n.icon) + '<span>' + esc(n.name) + '</span></button>'; }).join('') + '</nav>'; }
};
document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('.dots [data-pal]'); if (b) { TG.look.set(b.getAttribute('data-pal')); [].forEach.call(b.parentNode.children, function (x) { x.classList.toggle('on', x === b); }); } });
