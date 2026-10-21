/* Question bank top bar: calculation-type quick chips (drive the existing #typeFilter),
   a one-line summary of the chosen scope, and a compact sign-in status chip. Data logic stays in questions.js. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const type = $('typeFilter');
  if (!type) return;
  const chips = [...document.querySelectorAll('[data-type-chip]')];

  function optText(sel) {
    if (!sel || !sel.options.length || sel.selectedIndex < 0) return '';
    return sel.options[sel.selectedIndex].textContent.trim();
  }
  function refresh() {
    chips.forEach((c) => {
      c.disabled = type.disabled;
      c.setAttribute('aria-pressed', String(c.dataset.typeChip === type.value));
    });
    const parts = [];
    const subj = optText($('subjectFilter')), unit = optText($('unitFilter')), set = optText($('setFilter'));
    parts.push(subj || '과목 전체');
    if (unit) parts.push(unit);
    if (set && !/전체/.test(set)) parts.push(set);
    if (type.value) parts.push(optText(type));
    const q = ($('searchInput') || {}).value;
    if (q) parts.push('검색 “' + q.trim().slice(0, 20) + '”');
    $('scopeSummary').textContent = parts.join(' · ');
  }
  chips.forEach((c) => c.addEventListener('click', () => {
    if (type.disabled || type.value === c.dataset.typeChip) return;
    type.value = c.dataset.typeChip;
    type.dispatchEvent(new Event('change', { bubbles: true }));
    refresh();
  }));
  ['subjectFilter', 'unitFilter', 'setFilter', 'typeFilter'].forEach((id) => { const el = $(id); if (el) el.addEventListener('change', () => setTimeout(refresh, 0)); });
  const form = $('searchForm');
  if (form) form.addEventListener('submit', () => setTimeout(refresh, 0));

  function syncChip() {
    const acct = ($('syncAccount') || {}).textContent || '';
    const signedIn = !($('googleSignOut') || { hidden: true }).hidden;
    $('syncChip').textContent = signedIn && acct.trim()
      ? '학습 기록: ' + acct.trim() + ' 동기화'
      : '학습 기록: 이 기기에 저장 · 로그인 설정';
  }
  if (window.MutationObserver) {
    const mo = new MutationObserver(() => { refresh(); syncChip(); });
    mo.observe(type, { attributes: true, attributeFilter: ['disabled'] });
    const area = $('questionArea');
    if (area) mo.observe(area, { attributes: true, attributeFilter: ['aria-busy'] });
    ['subjectFilter', 'unitFilter', 'setFilter'].forEach((id) => { const el = $(id); if (el) mo.observe(el, { childList: true }); });
    ['syncAccount', 'syncStatus'].forEach((id) => { const el = $(id); if (el) mo.observe(el, { childList: true, characterData: true, subtree: true }); });
    const so = $('googleSignOut'); if (so) mo.observe(so, { attributes: true, attributeFilter: ['hidden'] });
  }
  refresh(); syncChip();
})();
