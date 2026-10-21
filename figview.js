/* In-page figure viewer: zoom, pan, previous/next figure, close with Esc, return to the reading position.
   Works with S Pen, mouse, keyboard and (when the pen panel's touch lock is off) touch pinch.
   Opened from study figures (index.html) and question source images (questions.html). */
(function () {
  'use strict';
  const MAX = 8;
  let root, stage, img, titleEl, countEl, tabLink, hintEl, items = [], index = 0, opener = null, scrollBack = null;
  let scale = 1, fit = 1, tx = 0, ty = 0, natW = 0, natH = 0;
  const pointers = new Map();
  let pinch = null, drag = null;

  function build() {
    root = document.createElement('div');
    root.className = 'figview';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'figviewTitle');
    root.innerHTML =
      '<div class="fv-bar">' +
        '<div class="fv-title"><strong id="figviewTitle"></strong><span class="fv-count" id="figviewCount"></span></div>' +
        '<div class="fv-tools" role="group" aria-label="그림 보기 도구">' +
          '<button type="button" data-fv="prev" aria-label="이전 그림">‹ 이전</button>' +
          '<button type="button" data-fv="next" aria-label="다음 그림">다음 ›</button>' +
          '<button type="button" data-fv="out" aria-label="축소">−</button>' +
          '<button type="button" data-fv="fit" aria-label="화면에 맞춤">맞춤</button>' +
          '<button type="button" data-fv="in" aria-label="확대">+</button>' +
          '<a class="fv-tab" target="_blank" rel="noopener">새 탭</a>' +
          '<button type="button" data-fv="close" class="fv-close" aria-label="닫고 읽던 곳으로">닫기</button>' +
        '</div>' +
      '</div>' +
      '<div class="fv-stage"><img class="fv-img" alt="" draggable="false"></div>' +
      '<p class="fv-hint"></p>';
    document.body.appendChild(root);
    stage = root.querySelector('.fv-stage');
    img = root.querySelector('.fv-img');
    titleEl = root.querySelector('#figviewTitle');
    countEl = root.querySelector('#figviewCount');
    tabLink = root.querySelector('.fv-tab');
    hintEl = root.querySelector('.fv-hint');
    root.querySelector('.fv-tools').addEventListener('click', (e) => {
      const b = e.target.closest('[data-fv]');
      if (!b) return;
      const a = b.dataset.fv;
      if (a === 'close') close();
      else if (a === 'in') zoomAt(1.5);
      else if (a === 'out') zoomAt(1 / 1.5);
      else if (a === 'fit') reset();
      else if (a === 'prev') go(-1);
      else if (a === 'next') go(1);
    });
    img.addEventListener('load', () => { natW = img.naturalWidth || 960; natH = img.naturalHeight || 600; reset(); });
    stage.addEventListener('pointerdown', down);
    stage.addEventListener('pointermove', move);
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => stage.addEventListener(t, up));
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    stage.addEventListener('dblclick', (e) => {
      const r = stage.getBoundingClientRect();
      if (scale > fit * 1.05) reset(); else zoomAt(2.2, e.clientX - r.left, e.clientY - r.top);
    });
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', () => { if (!root.hidden) reset(); });
  }

  function layout() {
    img.style.width = Math.round(natW * scale) + 'px';
    img.style.height = Math.round(natH * scale) + 'px';
    img.style.transform = 'translate(' + Math.round(tx) + 'px,' + Math.round(ty) + 'px)';
    root.querySelector('[data-fv="fit"]').textContent = Math.round((scale / fit) * 100) + '%';
  }
  function clampPan() {
    const sw = stage.clientWidth, sh = stage.clientHeight, w = natW * scale, h = natH * scale;
    const mx = Math.max(0, (w - sw) / 2) + 40, my = Math.max(0, (h - sh) / 2) + 40;
    const cx = (sw - w) / 2, cy = (sh - h) / 2;
    tx = Math.min(cx + mx, Math.max(cx - mx, tx));
    ty = Math.min(cy + my, Math.max(cy - my, ty));
  }
  function reset() {
    if (!natW) return;
    const sw = stage.clientWidth || 1, sh = stage.clientHeight || 1;
    fit = Math.min(sw / natW, sh / natH);
    scale = fit;
    tx = (sw - natW * scale) / 2; ty = (sh - natH * scale) / 2;
    layout();
  }
  function zoomAt(f, px, py) {
    const sw = stage.clientWidth, sh = stage.clientHeight;
    if (px == null) { px = sw / 2; py = sh / 2; }
    const next = Math.min(fit * MAX, Math.max(fit * 0.6, scale * f));
    const k = next / scale;
    tx = px - (px - tx) * k; ty = py - (py - ty) * k;
    scale = next; clampPan(); layout();
  }
  function down(e) {
    if (e.button > 0 && e.pointerType === 'mouse') return;
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: scale };
      drag = null;
    } else if (pointers.size === 1) {
      drag = { x: e.clientX, y: e.clientY, tx, ty };
    }
    e.preventDefault();
  }
  function move(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), r = stage.getBoundingClientRect();
      zoomAt((pinch.s * d / pinch.d) / scale, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
    } else if (drag) {
      tx = drag.tx + e.clientX - drag.x; ty = drag.ty + e.clientY - drag.y;
      clampPan(); layout();
    }
  }
  function up(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) drag = null;
  }
  function key(e) {
    if (!root || root.hidden) return;
    const k = e.key;
    let handled = true;
    if (k === 'Escape') close();
    else if (k === '+' || k === '=') zoomAt(1.25);
    else if (k === '-' || k === '_') zoomAt(0.8);
    else if (k === '0') reset();
    else if (k === 'ArrowLeft') { tx += 60; clampPan(); layout(); }
    else if (k === 'ArrowRight') { tx -= 60; clampPan(); layout(); }
    else if (k === 'ArrowUp') { ty += 60; clampPan(); layout(); }
    else if (k === 'ArrowDown') { ty -= 60; clampPan(); layout(); }
    else if (k === 'PageUp') go(-1);
    else if (k === 'PageDown') go(1);
    else if (k === 'Tab') {
      const f = [...root.querySelectorAll('button:not([disabled]), a[href]')];
      const i = f.indexOf(document.activeElement);
      const n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i === f.length - 1 ? 0 : i + 1);
      f[n].focus();
    } else handled = false;
    if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
  }
  function show(i) {
    index = i;
    const it = items[i];
    natW = it.w || 0; natH = it.h || 0;
    titleEl.textContent = it.title || '그림';
    countEl.textContent = items.length > 1 ? (i + 1) + ' / ' + items.length : '';
    tabLink.href = it.src;
    img.alt = it.alt || it.title || '';
    root.querySelector('[data-fv="prev"]').disabled = i <= 0;
    root.querySelector('[data-fv="next"]').disabled = i >= items.length - 1;
    root.querySelector('[data-fv="prev"]').hidden = items.length < 2;
    root.querySelector('[data-fv="next"]').hidden = items.length < 2;
    if (img.getAttribute('src') !== it.src) img.src = it.src;
    else reset();
    if (natW) reset();
  }
  function go(d) { const n = index + d; if (n >= 0 && n < items.length) show(n); }

  function open(list, i, from) {
    if (!root) build();
    items = list; opener = from || document.activeElement;
    const sc = document.querySelector('.scroller');
    scrollBack = sc ? { el: sc, top: sc.scrollTop } : { el: null, top: window.scrollY };
    const locked = document.body.classList.contains('pen-locked');
    hintEl.textContent = (locked ? '터치 잠금 중: S펜으로 끌어서 이동하고 버튼을 누르세요. ' : '끌어서 이동 · 두 손가락 또는 휠로 확대 · ') +
      '두 번 눌러 확대/맞춤 · Esc로 닫으면 읽던 곳으로 돌아갑니다.';
    root.hidden = false;
    document.body.classList.add('figview-open');
    show(i);
    requestAnimationFrame(() => { reset(); root.querySelector('.fv-close').focus(); });
  }
  function close() {
    if (!root || root.hidden) return;
    root.hidden = true;
    document.body.classList.remove('figview-open');
    pointers.clear(); pinch = null; drag = null;
    if (scrollBack) { if (scrollBack.el) scrollBack.el.scrollTop = scrollBack.top; else window.scrollTo(0, scrollBack.top); }
    if (opener && opener.focus) { try { opener.focus({ preventScroll: true }); } catch (e) { opener.focus(); } }
  }

  // collect figures in reading order from a container
  function collect(scope) {
    return [...(scope || document).querySelectorAll('.study-figure img, .source-image img')].map((im) => {
      const fig = im.closest('figure');
      const t = fig && fig.querySelector('figcaption strong');
      return { el: im, src: im.currentSrc || im.src, alt: im.alt, title: t ? t.textContent : (im.alt || '그림'), w: im.naturalWidth || +im.getAttribute('width') || 0, h: im.naturalHeight || +im.getAttribute('height') || 0 };
    });
  }
  function openFor(im, from) {
    const list = collect(document.getElementById('reader') || document);
    const i = Math.max(0, list.findIndex((x) => x.el === im));
    open(list, i, from);
  }
  // add a visible zoom button to every figure that has none
  function decorate(scope) {
    (scope || document).querySelectorAll('.study-figure, .source-image').forEach((fig) => {
      if (fig.querySelector('.fig-zoom')) return;
      const im = fig.querySelector('img');
      if (!im) return;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'fig-zoom';
      b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3a7 7 0 1 0 4.2 12.6l5.1 5.1 1.4-1.4-5.1-5.1A7 7 0 0 0 10 3zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10zM9 7v2H7v2h2v2h2v-2h2V9h-2V7z"/></svg><span>크게 보기</span>';
      b.setAttribute('aria-label', '그림 크게 보기: ' + ((fig.querySelector('figcaption strong') || {}).textContent || im.alt || ''));
      fig.insertBefore(b, fig.firstChild);
    });
  }
  document.addEventListener('click', (e) => {
    const zb = e.target.closest('.fig-zoom');
    const link = !zb && e.target.closest('.study-figure a, .source-image a');
    if (!zb && !(link && link.querySelector('img'))) return;
    const fig = (zb || link).closest('.study-figure, .source-image');
    const im = fig && fig.querySelector('img');
    if (!im) return;
    e.preventDefault();
    openFor(im, zb || link);
  });
  if (window.MutationObserver) {
    let t = 0;
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => decorate(), 60); })
      .observe(document.documentElement, { childList: true, subtree: true });
  }
  window.FigView = { open, close, decorate };
})();
