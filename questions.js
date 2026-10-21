'use strict';

window.MathJax = {
  loader: { load: ['ui/safe'] },
  tex: { inlineMath: [['\\(', '\\)'], ['$', '$']], displayMath: [['\\[', '\\]'], ['$$', '$$']], processEscapes: true },
  options: { enableMenu: false, ignoreHtmlClass: 'bank-katex', safeOptions: { allow: { URLs: 'safe', classes: 'none', cssIDs: 'none', styles: 'none' } } },
  svg: { fontCache: 'global' },
  startup: { typeset: false, ready() { MathJax.startup.defaultReady(); MathJax.startup.promise.then(() => document.dispatchEvent(new Event('bank-math-ready'))); } }
};

(() => {
  const $ = (id) => document.getElementById(id);
  const DATA_ROOT = 'data/question-bank/';
  const STORAGE_KEY = 'kepco-question-bank:v1';
  const SCOPE_KEY = 'kepco-question-bank:scope:v1';
  const APP = 'kepco-question-bank';
  const UNIT_ID = /^(?:[A-Z]\d{2}|P(?!000)\d{3})$/;
  const QUESTION_ID = /^(?:[A-Z]\d{2}|P(?!000)\d{3})-S\d+-Q\d{2,3}$/;
  const TYPE_LABELS = { calculation: '계산필요', recall: '계산불필요(단순암기)' };
  const CATEGORY_LABELS = { all: '전체', practice: '단원별 연습', past: '기출' };
  const initialCategory = new URLSearchParams(location.search).get('category');
  let category = Object.hasOwn(CATEGORY_LABELS, initialCategory) ? initialCategory : 'all';
  const cache = new Map();
  let manifest, knownIds = new Set(), records = { answers: {}, favorites: [] };
  let classifications;
  let pendingChanges = [];
  let scopeQuestions = [], visibleQuestions = [], currentIndex = 0, view = 'all';
  let search = '', loadToken = 0, submitted = false, selfRevealed = false, busy = true, mathQueue = Promise.resolve();
  let scopeReady = false, resumeUntouched = true, inferScopeFromRecords = false;
  const recordSubscribers = new Set();
  const copyRecords = (value) => JSON.parse(JSON.stringify(value));

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function explanationContent(option) {
    if (!option.explanationHtml) return node('p', '', option.explanation || '제공된 해설이 없습니다.');
    const template = document.createElement('template');
    template.innerHTML = option.explanationHtml;
    const container = node('div', 'bank-katex');
    const tags = new Set('span strong em b i br sub sup p div ul ol li code pre small u s svg path line rect circle ellipse polyline polygon g title desc math semantics annotation mrow mi mo mn mtext mspace msup msub msubsup mfrac mroot msqrt mtable mtr mtd mover munder munderover mpadded mstyle menclose mphantom'.split(' '));
    const drop = new Set('script style iframe object embed template noscript audio video form input textarea button select option link meta base foreignobject image img use animate animatetransform set'.split(' '));
    const svgTags = new Set('svg path line rect circle ellipse polyline polygon g title desc'.split(' '));
    const mathTags = new Set('math semantics annotation mrow mi mo mn mtext mspace msup msub msubsup mfrac mroot msqrt mtable mtr mtd mover munder munderover mpadded mstyle menclose mphantom'.split(' '));
    const classes = new Set('accent-body accent-full amsrm angl anglpad arraycolsep boldsymbol boxpad brace-center brace-left brace-right cancel-lap cancel-pad cd-arrow-pad cd-label-left cd-label-right cd-vert-arrow clap col-align-c col-align-l col-align-r delim-size1 delim-size4 delimcenter delimsizing eqn-num fbox fcolorbox fleqn fontsize-ensurer frac-line halfarrow-left halfarrow-right hide-tail katex katex-accent katex-base katex-display katex-fix katex-hdashline katex-hline katex-html katex-inner katex-mathml katex-newline katex-overlay katex-overline katex-root katex-rule katex-sizing katex-smash katex-sout katex-stretchy katex-strut katex-tag katex-thinbox katex-underline katex-vbox katex-version large-op leqno llap mainrm mathbb mathbf mathboldfrak mathboldsf mathcal mathfrak mathit mathitsf mathnormal mathrm mathscr mathsf mathsfit mathtt mfrac mml-eqn-num mover mspace msupsub mtable mtr-glue mult munder nulldelimiter op-limits op-symbol overline-line pstrut reflectbox reset-size1 reset-size10 reset-size11 reset-size2 reset-size3 reset-size4 reset-size5 reset-size6 reset-size7 reset-size8 reset-size9 rlap size1 size10 size11 size2 size3 size4 size5 size6 size7 size8 size9 small-op sqrt svg-align textbb textbf textboldfrak textboldsf textfrak textit textitsf textrm textscr textsf texttt underline-line vertical-separator vlist vlist-r vlist-s vlist-t vlist-t2 x-arrow x-arrow-pad math-inline math-display mord mbin mrel mopen mclose mpunct minner mop mtight'.split(' '));
    for (const name of ['text', 'hangul_fallback', 'nobreak', 'katex-error', 'katex-svg']) classes.add(name);
    const geometry = new Set('height width min-width max-width min-height max-height top left right bottom margin margin-left margin-right margin-top margin-bottom padding padding-left padding-right padding-top padding-bottom font-size line-height border-width border-top-width border-bottom-width border-left-width border-right-width letter-spacing'.split(' '));
    const dimensions = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:em|ex|px|rem|%|pt)?$/;
    const color = /^(?:#[0-9a-fA-F]{3,8}|[A-Za-z]{1,24}|(?:rgb|rgba)\([0-9.,% ]+\))$/;
    const keywords = {position: ['relative', 'absolute'], display: ['inline', 'inline-block', 'block'],
      'white-space': ['nowrap', 'normal'], 'font-style': ['normal', 'italic'], 'font-weight': ['normal', 'bold', '400', '500', '600', '700'],
      'text-align': ['left', 'right', 'center'], 'border-style': ['solid'], 'border-top-style': ['solid'],
      'border-bottom-style': ['solid'], 'transform-origin': ['center', 'center center']};
    function appendSafe(source, target) {
      for (const child of source.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) { target.append(document.createTextNode(child.textContent)); continue; }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = child.tagName.toLowerCase();
        if (!tags.has(tag)) {
          if (!drop.has(tag)) appendSafe(child, target);
          continue;
        }
        const element = svgTags.has(tag) ? document.createElementNS('http://www.w3.org/2000/svg', tag) :
          mathTags.has(tag) ? document.createElementNS('http://www.w3.org/1998/Math/MathML', tag) : document.createElement(tag);
        const safeClasses = [...child.classList].map((name) => classes.has(name) ? name :
          classes.has(`katex-${name}`) ? `katex-${name}` : name.startsWith('katex-') && classes.has(name.slice(6)) ? name.slice(6) : '').filter(Boolean);
        if (safeClasses.length) element.setAttribute('class', safeClasses.join(' '));
        for (const attribute of child.attributes) {
          const name = attribute.name.toLowerCase(), value = attribute.value;
          if ((name === 'aria-hidden' && /^(true|false)$/.test(value)) || name === 'aria-label' ||
            (name === 'role' && /^(img|math|presentation)$/.test(value))) element.setAttribute(name, value);
          if (svgTags.has(tag)) {
            if (name === 'viewbox' && /^[0-9eE+., -]+$/.test(value)) element.setAttribute('viewBox', value);
            else if (name === 'preserveaspectratio' && /^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?: (?:meet|slice))?)$/.test(value)) element.setAttribute('preserveAspectRatio', value);
            else if (['d', 'points'].includes(name) && /^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,()\s-]+$/.test(value)) element.setAttribute(name, value);
            else if (name === 'transform' && /^\s*(?:(?:matrix|translate|scale|rotate|skewX|skewY)\(\s*[0-9eE+.,\s-]+\)\s*)+$/.test(value)) element.setAttribute(name, value);
            else if (['width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'rx', 'ry', 'r', 'stroke-width'].includes(name) && dimensions.test(value)) element.setAttribute(name, value);
            else if (['fill', 'stroke'].includes(name) && (['none', 'currentColor'].includes(value) || color.test(value))) element.setAttribute(name, value);
            else if (name === 'focusable' && /^(true|false)$/.test(value)) element.setAttribute(name, value);
          } else if (mathTags.has(tag) && ['display', 'mathvariant', 'stretchy', 'fence', 'separator', 'accent', 'accentunder', 'scriptlevel', 'displaystyle', 'columnalign', 'rowalign', 'columnspacing', 'rowspacing', 'lspace', 'rspace', 'encoding'].includes(name) && /^[A-Za-z0-9 .+/_-]{1,100}$/.test(value)) {
            element.setAttribute(name, value);
          }
        }
        for (let styleIndex = 0; child.style && styleIndex < child.style.length; styleIndex++) {
          const property = child.style[styleIndex];
          const value = child.style.getPropertyValue(property).trim();
          if (/url|expression|javascript|data:|@|[\\{}<>!]/i.test(value)) continue;
          const parts = value.split(/\s+/);
          if ((geometry.has(property) && parts.length <= 4 && parts.every((part) => dimensions.test(part))) ||
            (property === 'height' && value === 'inherit') ||
            (property === 'vertical-align' && (dimensions.test(value) || ['baseline', 'middle', 'top', 'bottom', 'text-top', 'text-bottom'].includes(value))) ||
            (['color', 'background-color', 'border-color', 'border-top-color', 'border-bottom-color'].includes(property) && color.test(value)) ||
            keywords[property]?.includes(value)) element.style.setProperty(property, value);
        }
        appendSafe(child, element); target.append(element);
      }
    }
    appendSafe(template.content, container);
    return container.childNodes.length ? container : node('p', '', option.explanation || '제공된 해설이 없습니다.');
  }
  function showNotice(message, warning = false) {
    $('notice').textContent = message;
    $('notice').hidden = !message;
    $('notice').classList.toggle('warning', warning);
  }
  function storageWarning(message) {
    $('storageWarning').hidden = false;
    $('storageWarning').textContent = message || '이 브라우저에 기록을 저장할 수 없습니다. 현재 화면에서는 계속 풀 수 있지만, 페이지를 닫기 전에 ‘기록 백업 저장’을 눌러 주세요.';
  }
  function saveRecords() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); pendingChanges = []; }
    catch (_) { storageWarning(); }
  }
  function commitMutation(change, kind = 'local') {
    let latest = records, loaded = false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      latest = raw ? validateRecords(JSON.parse(raw)).records : { answers: {}, favorites: [] };
      loaded = true;
    } catch (_) { storageWarning(); }
    if (loaded) for (const pending of pendingChanges) pending(latest);
    const before = copyRecords(latest);
    const result = change(latest);
    records = latest; pendingChanges.push(change); saveRecords();
    for (const subscriber of recordSubscribers) {
      try { subscriber(before, copyRecords(records), { kind }); } catch (_) { /* Local study remains available. */ }
    }
    return result;
  }
  function validateRecords(value, imported = false) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (imported && (value.app !== APP || value.version !== 1)) ||
      !value.answers || typeof value.answers !== 'object' || Array.isArray(value.answers) || !Array.isArray(value.favorites)) {
      throw new Error('문제은행에서 저장한 JSON 백업 파일인지 확인해 주세요.');
    }
    if (Object.keys(value.answers).length > 20000 || value.favorites.length > 20000) throw new Error('기록 수가 허용 범위를 넘습니다.');
    const result = { answers: {}, favorites: [] };
    let skipped = 0;
    for (const [id, item] of Object.entries(value.answers)) {
      if (!QUESTION_ID.test(id) || !item || typeof item !== 'object' ||
        !Number.isSafeInteger(item.attempts) || item.attempts < 1 || item.attempts > 1000000 ||
        !Number.isSafeInteger(item.correct) || item.correct < 0 || item.correct > item.attempts ||
        typeof item.lastCorrect !== 'boolean' || !Array.isArray(item.selected) || item.selected.length > 20 ||
        !item.selected.every((i) => Number.isInteger(i) && i >= 0 && i < 20) ||
        new Set(item.selected).size !== item.selected.length ||
        typeof item.updatedAt !== 'string' || !Number.isFinite(Date.parse(item.updatedAt))) {
        throw new Error('풀이 기록 형식이 올바르지 않습니다. 기존 기록은 변경하지 않았습니다.');
      }
      if (!knownIds.has(id)) { skipped++; continue; }
      result.answers[id] = { attempts: item.attempts, correct: item.correct, lastCorrect: item.lastCorrect,
        selected: item.selected.slice(), updatedAt: item.updatedAt };
    }
    for (const id of value.favorites) {
      if (typeof id !== 'string' || !QUESTION_ID.test(id)) throw new Error('즐겨찾기 기록 형식이 올바르지 않습니다.');
      if (!knownIds.has(id)) { skipped++; continue; }
      result.favorites.push(id);
    }
    result.favorites = [...new Set(result.favorites)];
    return { records: result, skipped };
  }
  function readRecords() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) records = validateRecords(JSON.parse(raw)).records;
    } catch (_) { storageWarning('저장된 학습 기록을 읽지 못했습니다. 현재 화면에는 기록이 표시되지 않습니다. 백업이 있다면 ‘백업 가져오기’로 복원해 주세요.'); }
  }
  function isWrong(id) { return records.answers[id]?.lastCorrect === false; }
  function isAnswered(id) { return (records.answers[id]?.attempts || 0) > 0; }
  function isFavorite(id) { return records.favorites.includes(id); }
  function refreshRecordIndicators() {
    updateStats();
    if (!scopeReady) return;
    updateFavoriteButton(); updateCompletionUI();
    if (busy || view !== 'all' || !resumeUntouched || submitted || selfRevealed || currentSelection().length) return;
    if (inferScopeFromRecords && restoreLatestScope()) { loadScope(); return; }
    const question = visibleQuestions[currentIndex];
    if (question && resumeIndex(visibleQuestions) !== currentIndex) applyView();
  }
  window.StudyBankBridge = {
    ready: false,
    getKnownIds: () => new Set(knownIds),
    getRecords: () => copyRecords(records),
    subscribe(callback) { recordSubscribers.add(callback); return () => recordSubscribers.delete(callback); },
    applyRecords(value) {
      records = validateRecords(value).records;
      saveRecords(); refreshRecordIndicators();
    }
  };
  function updateStats() {
    const entries = Object.values(records.answers);
    $('attemptedStat').textContent = entries.length.toLocaleString('ko-KR');
    $('correctStat').textContent = entries.filter((entry) => entry.lastCorrect).length.toLocaleString('ko-KR');
    $('wrongStat').textContent = entries.filter((entry) => !entry.lastCorrect).length.toLocaleString('ko-KR');
    $('favoriteStat').textContent = records.favorites.length.toLocaleString('ko-KR');
    const searched = searchedQuestions();
    $('allCount').textContent = searched.length;
    $('wrongCount').textContent = searched.filter((q) => isWrong(q.id)).length;
    $('favoriteCount').textContent = searched.filter((q) => isFavorite(q.id)).length;
  }
  window.addEventListener('storage', (event) => {
    if (!manifest || (event.key !== STORAGE_KEY && event.key !== null)) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const latest = raw ? validateRecords(JSON.parse(raw)).records : { answers: {}, favorites: [] };
      for (const pending of pendingChanges) pending(latest);
      records = latest;
      refreshRecordIndicators();
    } catch (_) { storageWarning('다른 탭에서 변경된 학습 기록을 읽지 못했습니다. 현재 문제는 계속 풀 수 있습니다.'); }
  });
  function fillSelect(select, options, value) {
    select.replaceChildren(...options.map(([id, text]) => {
      const option = node('option', '', text); option.value = id; return option;
    }));
    if (options.some(([id]) => id === value)) select.value = value;
  }
  function saveScope() {
    if (!scopeReady) return;
    try {
      localStorage.setItem(SCOPE_KEY, JSON.stringify({ version: 1, category, subject: $('subjectFilter').value,
        unit: $('unitFilter').value, set: $('setFilter').value, type: $('typeFilter').value, search }));
    } catch (_) { /* Answer records and backups remain independent of scope preferences. */ }
  }
  function markQuestionActivity() {
    resumeUntouched = false; inferScopeFromRecords = false; saveScope();
  }
  function chooseScopeValue(id, value) {
    $(id).value = [...$(id).options].some((option) => option.value === value) ? value : '';
  }
  function restoreSavedScope() {
    try {
      const value = JSON.parse(localStorage.getItem(SCOPE_KEY));
      if (!value || value.version !== 1 || !Object.hasOwn(CATEGORY_LABELS, value.category) ||
        !['subject', 'unit', 'set', 'type', 'search'].every((key) => typeof value[key] === 'string') ||
        (Object.hasOwn(CATEGORY_LABELS, initialCategory) && initialCategory !== value.category)) return false;
      category = value.category; updateCategoryOptions();
      chooseScopeValue('subjectFilter', value.subject); updateUnitOptions();
      chooseScopeValue('unitFilter', value.unit); updateSetOptions();
      chooseScopeValue('setFilter', value.set); chooseScopeValue('typeFilter', value.type);
      search = value.search.slice(0, 200).trim(); $('searchInput').value = search;
      return true;
    } catch (_) { return false; }
  }
  function restoreLatestScope() {
    let latestId, latestTime = -Infinity;
    for (const [id, answer] of Object.entries(records.answers)) {
      const time = Date.parse(answer.updatedAt);
      if (time > latestTime) { latestId = id; latestTime = time; }
    }
    if (!latestId) return false;
    const [unit] = latestId.split('-');
    const meta = manifest.sets.find((set) => set.unit === unit);
    if (!meta) return false;
    const targetCategory = meta.subject === 'P' ? 'past' : 'all';
    if (category === targetCategory && $('subjectFilter').value === meta.subject && $('unitFilter').value === unit) return false;
    category = targetCategory; updateCategoryOptions();
    $('subjectFilter').value = meta.subject; updateUnitOptions();
    $('unitFilter').value = unit; updateSetOptions();
    return true;
  }
  function loadChangedScope() {
    inferScopeFromRecords = false; resumeUntouched = true; saveScope(); loadScope();
  }
  function nextUnansweredIndex(questions, after = -1, includeCurrent = true) {
    for (let offset = 1; offset <= questions.length; offset++) {
      const index = (after + offset) % questions.length;
      if ((!includeCurrent && index === after) || isAnswered(questions[index].id)) continue;
      return index;
    }
    return -1;
  }
  function resumeIndex(questions) {
    let latest = -1, latestTime = -Infinity;
    questions.forEach((question, index) => {
      const answer = records.answers[question.id];
      if (answer && Date.parse(answer.updatedAt) > latestTime) { latest = index; latestTime = Date.parse(answer.updatedAt); }
    });
    const next = nextUnansweredIndex(questions, latest);
    return next >= 0 ? next : Math.max(0, latest);
  }
  function completionLabel(question) {
    const previous = records.answers[question.id];
    return previous ? `풀이 완료 · 최근 ${previous.lastCorrect ? '정답' : '오답'}` : '미풀이';
  }
  function questionJumpLabel(question, index) {
    const source = question.subject === 'P' ? `${question.source.examLabel} · 원문 ${question.source.number}번` :
      `${question.unit} ${question.set}회차 ${question.number}번`;
    return `[${completionLabel(question)}] ${index + 1} / ${visibleQuestions.length} · ${source}`;
  }
  function updateNavigation() {
    $('previousButton').disabled = busy || currentIndex === 0;
    $('nextButton').textContent = view === 'all' ? '다음 미풀이 →' : '다음 →';
    $('nextButton').disabled = busy || (view === 'all' ? nextUnansweredIndex(visibleQuestions, currentIndex, false) < 0 : currentIndex >= visibleQuestions.length - 1);
    $('resumeButton').disabled = busy || view !== 'all' || !visibleQuestions.some((question) => !isAnswered(question.id));
  }
  function updateCompletionUI() {
    const question = visibleQuestions[currentIndex], previous = question && records.answers[question.id];
    $('questionStatus').textContent = question ? completionLabel(question) : '';
    $('questionStatus').dataset.state = previous ? previous.lastCorrect ? 'correct' : 'wrong' : 'new';
    if (question) $('previousResult').textContent = previous ? `이전 ${previous.attempts}회 풀이 · 최근 ${previous.lastCorrect ? '정답' : '오답'}` : '이전 풀이 기록 없음';
    const answered = visibleQuestions.filter((item) => isAnswered(item.id)).length;
    const remaining = visibleQuestions.length - answered;
    $('scopeProgress').textContent = `현재 범위: 풀이 완료 ${answered.toLocaleString('ko-KR')}문항 · 미풀이 ${remaining.toLocaleString('ko-KR')}문항` +
      (visibleQuestions.length && !remaining && view === 'all' ? ' · 모두 풀었습니다. 문제 번호를 선택해 복습할 수 있습니다.' : '');
    if ($('questionJump').options.length === visibleQuestions.length) visibleQuestions.forEach((item, index) => {
      const label = questionJumpLabel(item, index);
      if ($('questionJump').options[index].textContent !== label) $('questionJump').options[index].textContent = label;
    });
    updateNavigation();
  }
  function selectedSets() {
    return categorySets().filter((set) =>
      (!$('subjectFilter').value || set.subject === $('subjectFilter').value) &&
      (!$('unitFilter').value || set.unit === $('unitFilter').value) &&
      (!$('setFilter').value || String(set.set) === $('setFilter').value));
  }
  function categorySets(value = category) {
    return manifest.sets.filter((set) => value === 'all' || (value === 'past' ? set.subject === 'P' : set.subject !== 'P'));
  }
  function updateCategoryOptions(first = false) {
    for (const button of document.querySelectorAll('[data-category]')) {
      button.disabled = false;
      button.setAttribute('aria-pressed', String(button.dataset.category === category));
      button.querySelector('span').textContent = `${categorySets(button.dataset.category).reduce((sum, set) => sum + set.count, 0).toLocaleString('ko-KR')}문항`;
    }
    $('categoryHelp').textContent = category === 'past' ? '기출: 새로 추가한 전기 기출·복원 문제를 모았습니다. 아래에서 회차·풀이 유형·오답·즐겨찾기를 골라 보세요.' :
      category === 'practice' ? '단원별 연습: NotebookLM으로 만든 계측 시험 대비 연습문제입니다.' : '전체: 단원별 연습과 전기 기출·복원 문제를 모두 포함합니다.';
    const subjects = new Set(categorySets().map((set) => set.subject));
    fillSelect($('subjectFilter'), [['', '모든 과목'], ...manifest.subjects.filter((subject) => subjects.has(subject.id)).map((subject) => [subject.id, subject.label])],
      category === 'past' ? 'P' : first && category === 'all' ? manifest.subjects[0]?.id : '');
    updateUnitOptions(first && category === 'all');
  }
  function updateUnitOptions(first = false) {
    const subject = $('subjectFilter').value;
    const units = new Map(categorySets().filter((set) => !subject || set.subject === subject).map((set) => [set.unit, set.unitTitle]));
    const options = [['', '모든 단원']];
    units.forEach((title, id) => options.push([id, `${id} ${title}`]));
    fillSelect($('unitFilter'), options, first ? options[1]?.[0] : '');
    updateSetOptions();
  }
  function updateSetOptions() {
    const choices = [...new Set(categorySets().filter((set) =>
      (!$('subjectFilter').value || set.subject === $('subjectFilter').value) &&
      (!$('unitFilter').value || set.unit === $('unitFilter').value)).map((set) => set.set))].sort((a, b) => a - b);
    fillSelect($('setFilter'), [['', '모든 묶음'], ...choices.map((n) => [String(n), `문항묶음 ${n}`])], '');
    $('setHelp').hidden = !selectedSets().some((set) => set.subject === 'P');
    $('searchHelp').hidden = $('setHelp').hidden;
  }
  function validateManifest(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.subjects) || !Array.isArray(value.sets) || !value.sets.length || value.sets.length > 1000) throw new Error('문제 목록 형식이 올바르지 않습니다.');
    const subjects = new Set(), sets = new Set();
    for (const subject of value.subjects) {
      if (!subject || !/^[A-Z]$/.test(subject.id) || typeof subject.label !== 'string' || subjects.has(subject.id)) throw new Error('과목 목록을 확인할 수 없습니다.');
      subjects.add(subject.id);
    }
    let count = 0;
    for (const set of value.sets) {
      if (!set || typeof set.id !== 'string' || sets.has(set.id) || !subjects.has(set.subject) ||
        !UNIT_ID.test(set.unit) || typeof set.unitTitle !== 'string' ||
        !Number.isInteger(set.set) || set.set < 1 || set.set > 99 || !Number.isInteger(set.count) || set.count < 1 || set.count > 999 ||
        !/^[A-Za-z0-9_-]+\.json$/.test(set.path)) throw new Error('문제 세트 목록이 올바르지 않습니다.');
      if (set.subject === 'P' && (!/^P(?!000)\d{3}$/.test(set.unit) || set.set > 2 || set.count > 25)) throw new Error('전기 기출·복원 문항묶음 형식이 올바르지 않습니다.');
      sets.add(set.id); count += set.count;
      for (let i = 1; i <= set.count; i++) {
        const id = `${set.unit}-S${set.set}-Q${String(i).padStart(2, '0')}`;
        if (knownIds.has(id)) throw new Error('중복된 문제 ID가 있습니다.');
        knownIds.add(id);
      }
    }
    if (count !== value.totalQuestions) throw new Error('문항 수와 문제 목록이 일치하지 않습니다.');
    return value;
  }
  async function fetchJSON(path) {
    const response = await fetch(path, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`파일을 불러오지 못했습니다 (${response.status}).`);
    return response.json();
  }
  function validateClassifications(value) {
    if (!value || value.version !== 1 || !value.labels || typeof value.labels !== 'object' || Array.isArray(value.labels) ||
      Object.keys(value.labels).length !== knownIds.size || [...knownIds].some((id) => !Object.hasOwn(TYPE_LABELS, value.labels[id]))) {
      throw new Error('문항 분류와 문제 목록이 일치하지 않습니다.');
    }
    return value.labels;
  }
  function validImage(value, originalId, kind) {
    if (!value || typeof value !== 'object' || typeof value.src !== 'string' ||
      !Number.isInteger(value.width) || value.width < 1 || value.width > 30000 ||
      !Number.isInteger(value.height) || value.height < 1 || value.height > 30000) return false;
    const prefix = `${DATA_ROOT}assets/electric/${originalId}-`;
    if (!value.src.startsWith(prefix)) return false;
    const file = value.src.slice(prefix.length);
    return kind === 'question' ? file === 'q.webp' : /^e[1-9]\d*\.webp$/.test(file);
  }
  function validateImportedQuestion(q) {
    const source = q.source;
    if (!source || typeof source !== 'object' ||
      !['collection', 'collectionLabel', 'examLabel', 'originalId'].every((key) => typeof source[key] === 'string' && source[key].length > 0 && source[key].length <= 2000) ||
      !/^[A-Za-z0-9_-]{1,200}$/.test(source.originalId) ||
      !['string', 'number'].includes(typeof source.number) || !String(source.number).trim() || String(source.number).length > 40 ||
      (source.note !== undefined && (typeof source.note !== 'string' || source.note.length > 2000)) ||
      !['multiple', 'self'].includes(q.responseType) ||
      (q.searchText !== undefined && (typeof q.searchText !== 'string' || q.searchText.length > 200000)) ||
      !validImage(q.questionImage, source.originalId, 'question') ||
      !Array.isArray(q.explanationImages) || q.explanationImages.length > 40 ||
      !q.explanationImages.every((image) => validImage(image, source.originalId, 'explanation'))) {
      throw new Error('원문 문제 이미지 또는 출처 형식이 올바르지 않습니다.');
    }
    if (q.responseType === 'self' && (typeof q.answerText !== 'string' || q.options.length !== 2 ||
      q.options[0].correct !== true || q.options[1].correct !== false)) throw new Error('주관식 직접 채점 형식이 올바르지 않습니다.');
  }
  async function getSet(meta) {
    if (!cache.has(meta.id)) cache.set(meta.id, fetchJSON(DATA_ROOT + meta.path).then((value) => {
      if (!value || value.id !== meta.id || !Array.isArray(value.questions) || value.questions.length !== meta.count) throw new Error('문제 세트 형식이 올바르지 않습니다.');
      const ids = new Set();
      return value.questions.map((q, index) => {
        const expectedId = `${meta.unit}-S${meta.set}-Q${String(index + 1).padStart(2, '0')}`;
        if (!q || q.id !== expectedId || ids.has(q.id) || typeof q.question !== 'string' || !q.question.trim() ||
          !Array.isArray(q.options) || q.options.length < 2 || q.options.length > 20 ||
          !q.options.every((option) => option && typeof option.text === 'string' && typeof option.correct === 'boolean' &&
            (typeof option.explanation === 'string' || (meta.subject === 'P' && option.explanation === undefined)) &&
            (option.explanationHtml === undefined || (typeof option.explanationHtml === 'string' && option.explanationHtml.length <= 300000))) ||
          !q.options.some((option) => option.correct) || (q.hint !== undefined && typeof q.hint !== 'string')) throw new Error('문항 또는 정답 형식이 올바르지 않습니다.');
        ids.add(q.id);
        if (meta.subject === 'P') validateImportedQuestion(q);
        return { ...q, studyType: classifications[q.id], subject: meta.subject, unit: meta.unit, unitTitle: meta.unitTitle, set: meta.set, number: index + 1 };
      });
    }).catch((error) => { cache.delete(meta.id); throw error; }));
    return cache.get(meta.id);
  }
  function setBusy(value) {
    busy = value;
    $('questionArea').setAttribute('aria-busy', String(value));
    $('searchButton').disabled = value;
    $('typeFilter').disabled = value || !classifications;
    $('importButton').disabled = value || !manifest;
    for (const button of document.querySelectorAll('[data-view]')) button.disabled = value;
    updateNavigation();
    $('questionJump').disabled = value || !visibleQuestions.length;
  }
  async function loadScope() {
    if (!manifest) return;
    const token = ++loadToken, sets = selectedSets();
    const loaded = new Array(sets.length), failed = [];
    let next = 0, completed = 0;
    setBusy(true); showNotice(''); $('retryLoad').hidden = true;
    $('questionCard').hidden = true; $('emptyState').hidden = false;
    $('emptyState').textContent = '선택한 범위의 문제를 불러오는 중입니다.';
    $('resultSummary').textContent = `불러오는 중 · 0 / ${sets.length}세트`;
    await Promise.all(Array.from({ length: Math.min(6, sets.length) }, async () => {
      while (next < sets.length && token === loadToken) {
        const i = next++;
        try { loaded[i] = await getSet(sets[i]); }
        catch (_) { failed.push(sets[i].id); }
        completed++;
        if (token === loadToken) $('resultSummary').textContent = `불러오는 중 · ${completed} / ${sets.length}세트`;
      }
    }));
    if (token !== loadToken) return;
    scopeQuestions = loaded.flatMap((questions) => questions || []);
    setBusy(false);
    if (inferScopeFromRecords && resumeUntouched && view === 'all' && restoreLatestScope()) { loadScope(); return; }
    applyView();
    if (failed.length) {
      showNotice(`${failed.length}개 세트를 불러오지 못했습니다. 현재 ${scopeQuestions.length}문항만 표시합니다. 인터넷 연결을 확인한 뒤 ‘다시 불러오기’를 눌러 주세요.`, true);
      $('retryLoad').hidden = false;
    }
  }
  function searchedQuestions() {
    const term = search.toLocaleLowerCase('ko-KR');
    const type = $('typeFilter').value;
    return scopeQuestions.filter((q) => (!type || q.studyType === type) &&
      (!term || `${q.question}\n${q.subject === 'P' ? `${q.searchText || ''}\n${q.source.collectionLabel} ${q.source.examLabel} ${q.source.number}번` : ''}`.toLocaleLowerCase('ko-KR').includes(term)));
  }
  function filterQuestions() {
    return searchedQuestions().filter((q) => view === 'all' || (view === 'wrong' ? isWrong(q.id) : isFavorite(q.id)));
  }
  function applyView(preserveId) {
    visibleQuestions = filterQuestions();
    const preservedIndex = visibleQuestions.findIndex((q) => q.id === preserveId);
    currentIndex = preservedIndex >= 0 ? preservedIndex : view === 'all' ? resumeIndex(visibleQuestions) : 0;
    for (const button of document.querySelectorAll('[data-view]')) button.setAttribute('aria-pressed', String(button.dataset.view === view));
    updateStats(); renderQuestion();
  }
  function renderMath() {
    if (typeof window.MathJax?.typesetPromise !== 'function') return;
    mathQueue = mathQueue.catch(() => {}).then(() => MathJax.typesetPromise([$('questionCard')])).catch(() => {
      showNotice('일부 수식을 표시하지 못했습니다. 인터넷 연결을 확인한 뒤 새로고침해 주세요.', true);
    });
  }
  document.addEventListener('bank-math-ready', renderMath);
  function clearMath() {
    if (typeof window.MathJax?.typesetClear === 'function') MathJax.typesetClear([$('questionCard')]);
  }
  function sourceImage(image, label, eager = false) {
    const figure = node('figure', 'source-image'), img = node('img');
    img.src = image.src; img.alt = label; img.width = image.width; img.height = image.height;
    img.loading = eager ? 'eager' : 'lazy'; img.decoding = 'async';
    const caption = node('figcaption'), link = node('a', '', '원본 크게 보기 (새 탭)');
    link.href = image.src; link.target = '_blank'; link.rel = 'noopener noreferrer';
    caption.append(node('span', '', label), link);
    const error = node('p', 'image-error', '이미지를 불러오지 못했습니다. 인터넷 연결을 확인하거나 원본 크게 보기를 눌러 주세요.');
    error.hidden = true;
    img.addEventListener('error', () => { img.hidden = true; error.hidden = false; });
    figure.append(img, caption, error); return figure;
  }
  function originalExplanations(question, container) {
    container.replaceChildren();
    if (!question.explanationImages.length) {
      container.append(node('p', 'small muted', '원본에 해설이 없습니다.')); return;
    }
    question.explanationImages.forEach((image, i) => container.append(sourceImage(image, `해설 원문 ${i + 1}`)));
  }
  function renderQuestion() {
    submitted = false; selfRevealed = false; clearMath();
    const question = visibleQuestions[currentIndex];
    $('questionCard').hidden = !question; $('emptyState').hidden = !!question;
    $('questionCard').dataset.studyId = question ? question.id : '';
    $('feedback').hidden = true; $('tryAgain').hidden = true; $('checkButton').disabled = true;
    $('checkButton').hidden = false;
    $('checkButton').textContent = '정답 확인';
    $('correctAnswer').hidden = false;
    $('answerForm').hidden = false;
    $('selfCheck').hidden = true; $('selfSolution').hidden = true; $('revealAnswer').hidden = false;
    $('selfExplanations').replaceChildren(); $('questionMedia').replaceChildren();
    $('questionMedia').hidden = true; $('questionSource').hidden = true; $('questionSourceNote').hidden = true;
    $('hintBox').open = false;
    $('resultSummary').textContent = `${view === 'all' ? '전체' : view === 'wrong' ? '오답노트' : '즐겨찾기'}${$('typeFilter').value ? ` · ${TYPE_LABELS[$('typeFilter').value]}` : ''} · ${visibleQuestions.length.toLocaleString('ko-KR')}문항${question ? ` · ${currentIndex + 1}번째` : ''}`;
    fillSelect($('questionJump'), question ? visibleQuestions.map((q, i) => [String(i), questionJumpLabel(q, i)]) : [['', '문제 없음']], String(currentIndex));
    setBusy(false);
    updateCompletionUI();
    if (!question) {
      $('emptyState').textContent = search ? '검색에 맞는 문제가 없습니다. 검색어나 위의 과목·단원 범위를 바꿔 보세요.' :
        view === 'wrong' ? '선택한 범위에 남은 오답이 없습니다. 틀린 문제는 여기에 자동으로 모입니다.' :
        view === 'favorites' ? '선택한 범위에 즐겨찾기가 없습니다. 문제의 ☆ 즐겨찾기를 눌러 모아 보세요.' : '이 범위에 표시할 문제가 없습니다.';
      return;
    }
    const imported = question.subject === 'P', self = imported && question.responseType === 'self';
    $('questionMeta').textContent = `${question.unit} ${question.unitTitle} · ${imported ? `문항묶음 ${question.set}` : `${question.set}회차`} · ${question.number}번`;
    $('questionType').textContent = TYPE_LABELS[question.studyType];
    $('questionType').dataset.type = question.studyType;
    $('questionTitle').textContent = question.question;
    if (imported) {
      $('questionSource').textContent = `출처: ${question.source.collectionLabel} · ${question.source.examLabel} · 원문 ${question.source.number}번`;
      $('questionSource').hidden = false;
      $('questionSourceNote').textContent = question.source.note || '';
      $('questionSourceNote').hidden = !question.source.note;
      $('questionMedia').append(sourceImage(question.questionImage, `문제 원문 · ${question.source.number}번`, true));
      $('questionMedia').hidden = false;
    }
    $('selfCheck').hidden = !self; $('answerForm').hidden = self;
    if (self) $('checkButton').textContent = '직접 채점 기록 저장';
    updateFavoriteButton();
    const multiple = question.options.filter((option) => option.correct).length > 1;
    $('choiceInstruction').textContent = self ? '정답·해설과 비교한 결과를 직접 선택하세요.' :
      multiple ? '정답을 모두 선택하세요.' : imported ? '원문 이미지의 선지 번호를 선택하세요.' : '답을 하나 선택하세요.';
    $('choices').replaceChildren($('choiceInstruction'));
    question.options.forEach((option, i) => {
      const label = node('label', 'choice');
      const input = node('input'); input.type = multiple ? 'checkbox' : 'radio'; input.name = 'answer'; input.value = String(i);
      const text = node('span', 'choice-text', imported ? option.text : `${i + 1}. ${option.text}`);
      label.append(input, text); $('choices').append(label);
    });
    const previous = records.answers[question.id];
    $('previousResult').textContent = previous ? `이전 ${previous.attempts}회 풀이 · 최근 ${previous.lastCorrect ? '정답' : '오답'}` : '이전 풀이 기록 없음';
    $('hintBox').hidden = !question.hint; $('hintText').textContent = question.hint || '';
    renderMath();
  }
  function updateFavoriteButton() {
    const question = visibleQuestions[currentIndex];
    if (!question) return;
    const favorite = isFavorite(question.id);
    $('favoriteButton').setAttribute('aria-pressed', String(favorite));
    $('favoriteButton').textContent = favorite ? '★ 저장됨' : '☆ 즐겨찾기';
    $('favoriteButton').setAttribute('aria-label', favorite ? '즐겨찾기 해제' : '즐겨찾기 추가');
  }
  function currentSelection() { return [...$('choices').querySelectorAll('input:checked')].map((input) => Number(input.value)); }
  $('revealAnswer').addEventListener('click', () => {
    const q = visibleQuestions[currentIndex];
    if (!q || q.subject !== 'P' || q.responseType !== 'self' || busy || submitted || selfRevealed) return;
    markQuestionActivity();
    selfRevealed = true;
    $('selfAnswer').textContent = q.answerText ? `원문 정답: ${q.answerText}` : '정답은 아래 원문 해설에서 확인하세요.';
    originalExplanations(q, $('selfExplanations'));
    $('revealAnswer').hidden = true; $('selfSolution').hidden = false; $('answerForm').hidden = false;
    renderMath(); $('selfSolution').focus({ preventScroll: true }); $('selfSolution').scrollIntoView({ block: 'start' });
  });
  $('answerForm').addEventListener('change', () => { markQuestionActivity(); $('checkButton').disabled = submitted || !currentSelection().length; });
  $('answerForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const q = visibleQuestions[currentIndex], selected = currentSelection();
    if (!q || busy || submitted || !selected.length) return;
    const self = q.subject === 'P' && q.responseType === 'self';
    if (self && !selfRevealed) return;
    markQuestionActivity();
    submitted = true;
    const correct = q.options.every((option, i) => option.correct === selected.includes(i));
    const updatedAt = new Date().toISOString();
    const previous = commitMutation((latest) => {
      const prior = latest.answers[q.id];
      latest.answers[q.id] = { attempts: (prior?.attempts || 0) + 1, correct: (prior?.correct || 0) + Number(correct),
        lastCorrect: correct, selected, updatedAt };
      return prior;
    }, 'answer');
    updateStats(); updateCompletionUI();
    $('choices').querySelectorAll('.choice').forEach((label, i) => {
      label.querySelector('input').disabled = true;
      label.classList.toggle('correct', q.options[i].correct && (!self || selected.includes(i)));
      label.classList.toggle('incorrect', selected.includes(i) && !q.options[i].correct);
      const note = self ? (selected.includes(i) ? '직접 채점한 결과' : '') :
        q.options[i].correct ? (selected.includes(i) ? '선택한 정답' : '정답') : selected.includes(i) ? '선택한 오답' : '';
      if (note) label.querySelector('.choice-text').append(node('span', 'choice-note', note));
    });
    $('checkButton').hidden = true; $('tryAgain').hidden = false;
    $('feedback').hidden = false; $('feedback').classList.toggle('wrong', !correct);
    $('feedbackTitle').textContent = self ? (correct ? '직접 채점: 맞았어요' : '직접 채점: 틀렸어요') : correct ? '정답입니다.' : '오답입니다.';
    $('correctAnswer').hidden = self;
    $('correctAnswer').textContent = self ? '' : `정답: ${q.options.flatMap((option, i) => option.correct ? [i + 1] : []).join(', ')}번`;
    $('reviewMessage').textContent = correct ? (previous?.lastCorrect === false ? '이 문제를 오답노트에서 제거했습니다. 아래 해설은 계속 볼 수 있습니다.' : '정답 기록을 저장했습니다.') : '오답노트에 저장했습니다. 다시 풀어 맞히면 자동으로 제거됩니다.';
    if (view === 'wrong' && correct) $('resultSummary').textContent = `오답노트 · 남은 ${filterQuestions().length}문항 · 현재 해설 표시 중`;
    $('explanations').replaceChildren();
    if (q.subject === 'P') {
      if (!self) originalExplanations(q, $('explanations'));
    } else {
      q.options.forEach((option, i) => {
        const section = node('div', 'explanation');
        section.append(node('h4', '', `${i + 1}번 · ${option.correct ? '정답' : '오답'} 해설`), explanationContent(option));
        $('explanations').append(section);
      });
    }
    renderMath(); $('feedbackTitle').focus({ preventScroll: true });
  });
  $('tryAgain').addEventListener('click', () => { markQuestionActivity(); renderQuestion(); $('questionArea').focus(); });
  $('favoriteButton').addEventListener('click', () => {
    const q = visibleQuestions[currentIndex]; if (!q || busy) return;
    markQuestionActivity();
    const shouldAdd = $('favoriteButton').getAttribute('aria-pressed') !== 'true';
    commitMutation((latest) => {
      latest.favorites = shouldAdd ? [...new Set([...latest.favorites, q.id])] : latest.favorites.filter((id) => id !== q.id);
    }, 'favorite');
    updateFavoriteButton(); updateStats();
    if (view === 'favorites') $('scopeHelp').textContent = '즐겨찾기를 해제한 현재 문제는 이동하거나 범위를 바꾸면 목록에서 빠집니다.';
  });
  function moveQuestion(delta) {
    if (busy) return;
    markQuestionActivity();
    const current = visibleQuestions[currentIndex];
    const target = visibleQuestions[currentIndex + delta];
    visibleQuestions = filterQuestions();
    const targetIndex = visibleQuestions.findIndex((q) => q.id === target?.id);
    const retainedIndex = visibleQuestions.findIndex((q) => q.id === current?.id);
    if (delta > 0 && view === 'all') {
      const next = nextUnansweredIndex(visibleQuestions, retainedIndex, false);
      if (next < 0) { updateCompletionUI(); return; }
      currentIndex = next;
    } else currentIndex = targetIndex >= 0 ? targetIndex : Math.max(0, Math.min(visibleQuestions.length - 1, retainedIndex >= 0 ? retainedIndex + delta : currentIndex));
    renderQuestion(); $('questionArea').focus(); $('questionArea').scrollIntoView({ block: 'start' });
  }
  $('previousButton').addEventListener('click', () => moveQuestion(-1));
  $('nextButton').addEventListener('click', () => moveQuestion(1));
  $('resumeButton').addEventListener('click', () => {
    if (busy || view !== 'all') return;
    markQuestionActivity(); applyView(); $('questionArea').focus(); $('questionArea').scrollIntoView({ block: 'start' });
  });
  $('questionArea').addEventListener('pointerdown', markQuestionActivity);
  $('questionArea').addEventListener('keydown', markQuestionActivity);
  $('hintBox').addEventListener('toggle', () => { if ($('hintBox').open) markQuestionActivity(); });
  $('questionJump').addEventListener('change', () => {
    if (busy) return;
    markQuestionActivity();
    const target = visibleQuestions[Number($('questionJump').value)];
    applyView(target?.id); $('questionArea').focus(); $('questionArea').scrollIntoView({ block: 'start' });
  });
  for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => {
    if (busy) return;
    view = button.dataset.view;
    inferScopeFromRecords = false; resumeUntouched = view === 'all';
    $('scopeHelp').textContent = '위 숫자는 선택한 범위와 검색에 맞는 문항 수입니다.';
    applyView();
  });
  $('subjectFilter').addEventListener('change', () => { updateUnitOptions(); loadChangedScope(); });
  for (const button of document.querySelectorAll('[data-category]')) button.addEventListener('click', () => {
    if (!manifest || !classifications || category === button.dataset.category) return;
    category = button.dataset.category;
    updateCategoryOptions();
    try {
      const url = new URL(location.href);
      if (category === 'all') url.searchParams.delete('category');
      else url.searchParams.set('category', category);
      history.replaceState(null, '', url);
    } catch (_) {}
    loadChangedScope();
  });
  $('unitFilter').addEventListener('change', () => { updateSetOptions(); loadChangedScope(); });
  $('setFilter').addEventListener('change', loadChangedScope);
  $('typeFilter').addEventListener('change', () => { if (!busy) { inferScopeFromRecords = false; resumeUntouched = true; saveScope(); applyView(); } });
  $('searchForm').addEventListener('submit', (event) => { event.preventDefault(); if (!busy) { search = $('searchInput').value.trim(); inferScopeFromRecords = false; resumeUntouched = true; saveScope(); applyView(); } });
  $('searchInput').addEventListener('search', () => { if (!busy && !$('searchInput').value) { search = ''; inferScopeFromRecords = false; resumeUntouched = true; saveScope(); applyView(); } });
  $('retryLoad').addEventListener('click', () => manifest ? loadScope() : start());
  $('exportButton').addEventListener('click', () => {
    const payload = { app: APP, version: 1, exportedAt: new Date().toISOString(), ...records };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = node('a'); link.href = url; link.download = `kepco-study-records-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('backupStatus').textContent = '백업 파일 저장을 요청했습니다. 기기의 다운로드 목록을 확인하세요.';
  });
  $('importButton').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async () => {
    const file = $('importFile').files[0]; if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('백업 파일은 10 MB 이하만 가져올 수 있습니다.');
      const validated = validateRecords(JSON.parse(await file.text()), true);
      const incoming = validated.records;
      commitMutation((latest) => {
        for (const [id, value] of Object.entries(incoming.answers)) {
          if (!latest.answers[id] || Date.parse(value.updatedAt) > Date.parse(latest.answers[id].updatedAt)) latest.answers[id] = value;
        }
        latest.favorites = [...new Set([...latest.favorites, ...incoming.favorites])];
      }, 'import');
      if (busy) updateStats();
      else applyView(visibleQuestions[currentIndex]?.id);
      $('backupStatus').textContent = `백업을 가져왔습니다.${validated.skipped ? ` 현재 문제은행에 없는 기록 ${validated.skipped}개는 제외했습니다.` : ''}`;
    } catch (error) { $('backupStatus').textContent = error instanceof SyntaxError ? 'JSON 파일을 읽을 수 없습니다. 기존 기록은 변경하지 않았습니다.' : error.message; }
    $('importFile').value = '';
  });
  async function start() {
    try {
      showNotice(''); manifest = undefined; knownIds = new Set(); classifications = undefined; cache.clear();
      scopeReady = false;
      for (const button of document.querySelectorAll('[data-category]')) button.disabled = true;
      const [manifestData, classificationData] = await Promise.all([
        fetchJSON(DATA_ROOT + 'manifest.json'), fetchJSON(DATA_ROOT + 'classifications.json')
      ]);
      manifest = validateManifest(manifestData);
      classifications = validateClassifications(classificationData);
      readRecords(); updateStats();
      window.StudyBankBridge.ready = true;
      document.dispatchEvent(new Event('bank-records-ready'));
      updateCategoryOptions(true);
      const restored = restoreSavedScope();
      inferScopeFromRecords = !restored && !Object.hasOwn(CATEGORY_LABELS, initialCategory);
      if (inferScopeFromRecords) restoreLatestScope();
      scopeReady = true; resumeUntouched = true;
      for (const id of ['subjectFilter', 'unitFilter', 'setFilter', 'searchInput', 'exportButton', 'importButton']) $(id).disabled = false;
      $('bankSummary').textContent = `${manifest.sets.length}세트 · ${manifest.totalQuestions.toLocaleString('ko-KR')}문항`;
      await loadScope();
    } catch (_) {
      if (!classifications) manifest = undefined;
      setBusy(false); $('bankSummary').textContent = '문제 목록을 불러오지 못했습니다.';
      $('emptyState').textContent = '문제 데이터를 준비 중이거나 연결에 문제가 있습니다. 잠시 후 다시 불러와 주세요.';
      $('resultSummary').textContent = '불러오기 실패'; $('retryLoad').hidden = false;
      showNotice('문제 목록을 읽을 수 없습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.', true);
    }
  }
  start();
})();
