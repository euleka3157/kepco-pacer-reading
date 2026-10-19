const PREFIX = 'kepco-question-bank:cloud:v1';
const EMPTY = () => ({ version: 1, answers: {}, favorites: {} });

export function createSyncEngine({ recordsApi, knownIds, storage, getRecords, applyRecords,
  listen, upload, onStatus = () => {}, now = () => Date.now(), makeTie = () => crypto.randomUUID(),
  delay = (callback, ms) => setTimeout(callback, ms), cancelDelay = (id) => clearTimeout(id) }) {
  const units = new Map();
  for (const id of knownIds) {
    const unit = id.split('-')[0];
    if (!units.has(unit)) units.set(unit, new Set());
    units.get(unit).add(id);
  }
  let owner = null, user = null, buckets = {}, dirty = new Set(), unsubscribe;
  let timer, running = false, online = true, generation = 0, retryMs = 2000, storageFailed = false, listenFailed = false, authorized = false, lastError = '';
  const key = (id = owner) => `${PREFIX}:${id || 'guest'}`;
  const equal = (unit, a, b) => recordsApi.changedUnits({ [unit]: a }, { [unit]: b }).length === 0;
  const report = (state, extra = {}) => onStatus({ state, pending: dirty.size, storageFailed, ...extra });
  function reportCurrent() {
    const state = !user ? 'local' : !online ? 'offline' : lastError ? 'error' : !authorized ? 'syncing' : dirty.size ? 'pending' : 'synced';
    report(state, lastError ? { code: lastError } : {});
  }
  function normalizeMap(value) {
    const out = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
    for (const [unit, bucket] of Object.entries(value)) {
      if (!units.has(unit)) continue;
      const normalized = recordsApi.normalizeBucket(bucket, units.get(unit));
      if (Object.keys(normalized.answers).length || Object.keys(normalized.favorites).length) out[unit] = normalized;
    }
    return out;
  }
  function mergeMaps(left, right) {
    const out = { ...left };
    for (const [unit, bucket] of Object.entries(right)) out[unit] = recordsApi.mergeBuckets(out[unit] || EMPTY(), bucket);
    return out;
  }
  function readState(id = owner) {
    try {
      const value = JSON.parse(storage.getItem(key(id)) || 'null');
      return { buckets: normalizeMap(value?.buckets), dirty: new Set((Array.isArray(value?.dirty) ? value.dirty : []).filter((unit) => units.has(unit))) };
    } catch (_) { storageFailed = true; return { buckets: {}, dirty: new Set() }; }
  }
  function persist() {
    try {
      storage.setItem(key(), JSON.stringify({ version: 1, buckets, dirty: [...dirty].sort() }));
      storage.setItem(`${PREFIX}:owner`, owner || '');
      storageFailed = false;
    } catch (_) { storageFailed = true; }
  }
  function apply() { applyRecords(recordsApi.toRecords(buckets)); }
  function absorbStored() {
    const stored = readState();
    buckets = mergeMaps(buckets, stored.buckets);
    for (const unit of stored.dirty) dirty.add(unit);
  }
  function stamp(previous) {
    const value = Math.max(Number(now()), (Date.parse(previous || '') || 0) + 1);
    return new Date(value).toISOString();
  }
  function schedule(ms = 350) {
    if (timer !== undefined) cancelDelay(timer);
    if (!user || !authorized || !online || !dirty.size) return;
    timer = delay(() => { timer = undefined; flush(); }, ms);
  }
  function updateLocal(before, after, mutation = {}) {
    absorbStored();
    const next = recordsApi.fromRecords(after);
    const previousFavorites = new Set(before.favorites), currentFavorites = new Set(after.favorites);
    for (const [id, answer] of Object.entries(after.answers)) {
      if (!knownIds.has(id) || JSON.stringify(answer) === JSON.stringify(before.answers[id])) continue;
      const unit = id.split('-')[0], bucket = buckets[unit] || EMPTY();
      const incoming = next[unit]?.answers[id];
      if (!incoming) continue;
      if (mutation.kind !== 'import') incoming.updatedAt = stamp(bucket.answers[id]?.updatedAt);
      buckets[unit] = recordsApi.mergeBuckets(bucket, { version: 1, answers: { [id]: incoming }, favorites: {} });
      if (!equal(unit, bucket, buckets[unit])) dirty.add(unit);
    }
    for (const id of new Set([...previousFavorites, ...currentFavorites])) {
      if (!knownIds.has(id) || previousFavorites.has(id) === currentFavorites.has(id)) continue;
      const unit = id.split('-')[0], bucket = buckets[unit] || EMPTY();
      const incoming = mutation.kind === 'import' ? next[unit]?.favorites[id] :
        { value: currentFavorites.has(id), updatedAt: stamp(bucket.favorites[id]?.updatedAt), tie: makeTie() };
      if (!incoming) continue;
      buckets[unit] = recordsApi.mergeBuckets(bucket, { version: 1, answers: {}, favorites: { [id]: incoming } });
      if (!equal(unit, bucket, buckets[unit])) dirty.add(unit);
    }
    persist(); apply();
    reportCurrent(); schedule();
  }
  function receive(remote, expectedGeneration, metadata = {}) {
    if (generation !== expectedGeneration || !user) return;
    if (!authorized) {
      // A cache snapshot does not establish this account's server permission.
      if (metadata.fromCache) return;
      if (owner !== user) {
        absorbStored();
        const stored = readState(user);
        buckets = !owner ? mergeMaps(stored.buckets, buckets) : stored.buckets;
        dirty = stored.dirty;
        owner = user;
      }
      authorized = true;
      for (const unit of Object.keys(buckets)) dirty.add(unit);
    }
    absorbStored();
    buckets = mergeMaps(buckets, normalizeMap(remote));
    persist(); apply();
    reportCurrent(); schedule();
  }
  async function flush() {
    if (!user || !authorized || owner !== user || !online || running || !dirty.size) return;
    running = true;
    const activeGeneration = generation, activeUser = user;
    report('syncing');
    try {
      while (dirty.size && activeGeneration === generation && activeUser === user && online) {
        absorbStored();
        const unit = [...dirty].sort()[0], outgoing = buckets[unit] || EMPTY();
        const result = await upload(activeUser, unit, outgoing, units.get(unit));
        if (activeGeneration !== generation || activeUser !== user) return;
        absorbStored();
        const acknowledged = recordsApi.normalizeBucket(result, units.get(unit));
        buckets[unit] = recordsApi.mergeBuckets(buckets[unit] || EMPTY(), acknowledged);
        if (equal(unit, buckets[unit], acknowledged)) dirty.delete(unit);
        persist(); apply();
      }
      retryMs = 2000;
      if (activeGeneration === generation) { lastError = ''; reportCurrent(); }
    } catch (error) {
      if (activeGeneration === generation) {
        lastError = typeof error?.code === 'string' ? error.code : 'unavailable';
        if (/permission-denied|unauthenticated/.test(lastError)) { authorized = false; listenFailed = true; }
        persist(); reportCurrent();
        if (!listenFailed) {
          schedule(retryMs); retryMs = Math.min(retryMs * 2, 60000);
        }
      }
    } finally {
      running = false;
      if (generation !== activeGeneration && user && dirty.size) schedule();
    }
  }
  function connect(uid) {
    generation++;
    if (unsubscribe) unsubscribe();
    unsubscribe = undefined;
    if (timer !== undefined) cancelDelay(timer);
    timer = undefined; user = uid || null; authorized = false;
    listenFailed = false; lastError = '';
    if (!user) { report('local'); return; }
    report(online ? 'syncing' : 'offline');
    const expectedGeneration = generation;
    unsubscribe = listen(user, (remote, metadata) => receive(remote, expectedGeneration, metadata), (error) => {
      if (generation === expectedGeneration) {
        authorized = false; listenFailed = true; lastError = error?.code || 'unavailable'; reportCurrent();
      }
    });
    schedule(0);
  }
  function setOnline(value) {
    online = value;
    reportCurrent();
    if (online && user && listenFailed) connect(user);
    else if (online) schedule(0);
  }
  function storageChanged(changedKey) {
    if (changedKey !== key() && changedKey !== null) return;
    absorbStored(); apply();
    reportCurrent(); schedule();
  }
  function retry() { retryMs = 2000; if (user) connect(user); }
  function close() {
    generation++; if (unsubscribe) unsubscribe(); if (timer !== undefined) cancelDelay(timer);
    user = null;
  }
  try {
    const savedOwner = storage.getItem(`${PREFIX}:owner`);
    if (typeof savedOwner === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(savedOwner)) owner = savedOwner;
  } catch (_) { storageFailed = true; }
  const stored = readState(); buckets = stored.buckets; dirty = stored.dirty;
  const legacy = normalizeMap(recordsApi.fromRecords(getRecords()));
  const merged = mergeMaps(buckets, legacy);
  for (const unit of recordsApi.changedUnits(buckets, merged)) dirty.add(unit);
  buckets = merged; persist(); apply(); report('local');
  return { updateLocal, connect, setOnline, retry, storageChanged, close, flush,
    inspect: () => ({ owner, user, buckets: JSON.parse(JSON.stringify(buckets)), dirty: [...dirty] }) };
}

function errorText(code) {
  if (/permission-denied/.test(code)) return '이 Google 계정에는 동기화 권한이 없습니다. 등록된 계정으로 로그인해 주세요. 기록은 이 기기에 보관되어 있습니다.';
  if (/popup-blocked/.test(code)) return '로그인 창이 차단되었습니다. 이 사이트의 팝업을 허용한 뒤 다시 눌러 주세요.';
  if (/popup-closed-by-user|cancelled-popup-request/.test(code)) return '로그인을 완료하지 않았습니다. 학습 기록은 이 기기에 저장됩니다.';
  if (/unauthorized-domain|operation-not-allowed/.test(code)) return '현재 사이트에서 Google 로그인을 사용할 수 없습니다. 학습 기록은 이 기기에 저장됩니다.';
  return '동기화 연결에 실패했습니다. 기록은 이 기기에 보관하고 다시 연결되면 전송합니다.';
}

async function mountCloudSync() {
  const $ = (id) => document.getElementById(id);
  const login = $('googleSignIn'), logout = $('googleSignOut'), retry = $('syncRetry');
  if (!login) return;
  let engine, auth, authApi, currentUser, signingIn = false, firestore, db;
  function status(value) {
    const messages = {
      local: '로그인하지 않은 상태입니다. 학습 기록은 이 기기에 저장됩니다.',
      pending: `이 기기에 저장했습니다. ${value.pending}개 단원의 기록을 동기화합니다.`,
      syncing: '학습 기록을 Google 계정에 동기화하고 있습니다.',
      synced: '동기화 완료 · 같은 Google 계정의 기기에서 이어서 풀 수 있습니다.',
      offline: '인터넷 연결이 끊겼습니다. 이 기기에 저장하고 다시 연결되면 동기화합니다.',
      error: errorText(value.code || '')
    };
    $('syncStatus').textContent = messages[value.state] || messages.local;
    if (value.storageFailed) $('syncStatus').textContent += ' 브라우저 저장도 제한되어 있으니 기록 백업을 저장해 주세요.';
    retry.hidden = !currentUser;
    retry.disabled = value.state === 'syncing';
  }
  login.addEventListener('click', () => {
    if (!auth || signingIn) return;
    signingIn = true; login.disabled = true;
    const provider = new authApi.GoogleAuthProvider(); provider.setCustomParameters({ prompt: 'select_account' });
    authApi.signInWithPopup(auth, provider).catch((error) => {
      $('syncStatus').textContent = errorText(error?.code || '');
    }).finally(() => { signingIn = false; login.disabled = false; });
  });
  logout.addEventListener('click', () => {
    if (!auth) return;
    logout.disabled = true;
    authApi.signOut(auth).catch(() => { $('syncStatus').textContent = '로그아웃하지 못했습니다. 다시 눌러 주세요.'; })
      .finally(() => { logout.disabled = false; });
  });
  retry.addEventListener('click', () => engine?.retry());
  try {
    if (!window.StudyBankBridge?.ready) await new Promise((resolve) => document.addEventListener('bank-records-ready', resolve, { once: true }));
    if (!window.StudySyncRecords) throw new Error('records-module-unavailable');
    const bridge = window.StudyBankBridge, recordsApi = window.StudySyncRecords;
    engine = createSyncEngine({ recordsApi, knownIds: bridge.getKnownIds(), storage: localStorage,
      getRecords: bridge.getRecords, applyRecords: bridge.applyRecords, onStatus: status,
      listen(uid, receive, fail) {
        return firestore.onSnapshot(firestore.collection(db, 'users', uid, 'units'), { includeMetadataChanges: true }, (snapshot) => {
          const buckets = {}; snapshot.forEach((document) => { buckets[document.id] = document.data(); });
          receive(buckets, { fromCache: snapshot.metadata.fromCache });
        }, fail);
      },
      upload(uid, unit, outgoing, knownIds) {
        const reference = firestore.doc(db, 'users', uid, 'units', unit);
        return firestore.runTransaction(db, async (transaction) => {
          const snapshot = await transaction.get(reference);
          const remote = recordsApi.normalizeBucket(snapshot.exists() ? snapshot.data() : EMPTY(), knownIds);
          const merged = recordsApi.mergeBuckets(remote, outgoing);
          if (recordsApi.changedUnits({ [unit]: remote }, { [unit]: merged }).length) transaction.set(reference, merged);
          return merged;
        });
      }
    });
    bridge.subscribe(engine.updateLocal);
    engine.setOnline(navigator.onLine);
    window.addEventListener('online', () => engine.setOnline(true));
    window.addEventListener('offline', () => engine.setOnline(false));
    window.addEventListener('storage', (event) => engine.storageChanged(event.key));
    $('syncStatus').textContent = '학습 기록은 이 기기에 저장됩니다. Google 로그인을 준비하고 있습니다.';
    const [configResponse, appApi, authentication, databaseApi] = await Promise.all([
      fetch('firebase-config.json', { cache: 'no-cache' }),
      import('https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js')
    ]);
    if (!configResponse.ok) throw new Error('config-unavailable');
    const config = await configResponse.json();
    if (!config || !['apiKey', 'authDomain', 'projectId', 'appId'].every((field) => typeof config[field] === 'string' && config[field])) throw new Error('invalid-config');
    authApi = authentication;
    const app = appApi.initializeApp(config);
    auth = authApi.getAuth(app); auth.languageCode = 'ko';
    firestore = databaseApi; db = firestore.getFirestore(app);
    authApi.onAuthStateChanged(auth, (user) => {
      currentUser = user;
      $('syncAccount').textContent = user ? (user.displayName || 'Google 계정 연결됨') : '';
      login.hidden = !!user; logout.hidden = !user;
      login.disabled = false; engine.connect(user?.uid || null);
    }, () => { $('syncStatus').textContent = '로그인 상태를 확인하지 못했습니다. 문제는 계속 풀 수 있습니다.'; login.disabled = false; });
  } catch (_) {
    $('syncStatus').textContent = 'Google 동기화를 불러오지 못했습니다. 이 기기의 학습과 백업은 계속 사용할 수 있습니다. 인터넷 연결 후 새로고침해 주세요.';
    login.disabled = true;
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') mountCloudSync();
