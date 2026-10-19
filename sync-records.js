(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StudySyncRecords = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const UNIT_LIMITS = { C: 18, T: 17, E: 20, M: 24, D: 20 };
  const EPOCH = '1970-01-01T00:00:00.000Z';
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const emptyBucket = () => ({ version: 1, answers: {}, favorites: {} });

  function object(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }
  function validUnit(unit) {
    const match = typeof unit === 'string' && /^([CTEMD])(\d{2})$/.exec(unit);
    return !!match && Number(match[2]) >= 1 && Number(match[2]) <= UNIT_LIMITS[match[1]];
  }
  function unitForId(id) {
    const match = typeof id === 'string' && /^([CTEMD]\d{2})-S([12])-Q(\d{2})$/.exec(id);
    return match && validUnit(match[1]) && Number(match[3]) >= 1 && Number(match[3]) <= 25 ? match[1] : '';
  }
  function idsForUnit(unit) {
    const result = new Set();
    if (validUnit(unit)) for (let set = 1; set <= 2; set++) {
      for (let number = 1; number <= 25; number++) result.add(`${unit}-S${set}-Q${String(number).padStart(2, '0')}`);
    }
    return result;
  }
  function date(value) {
    if (typeof value !== 'string') return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match) return null;
    const [, year, month, day, hour, minute, second] = match.map((part, i) => i >= 1 && i <= 6 ? Number(part) : part);
    if (year < 1970 || month < 1 || month > 12 || day < 1 ||
      day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59 || second > 59) return null;
    const time = Date.parse(value);
    if (!Number.isFinite(time) || time < 0) return null;
    const normalized = new Date(time).toISOString();
    return /^\d{4}-/.test(normalized) ? normalized : null;
  }
  function answer(value) {
    if (!object(value) || !['attempts', 'correct', 'lastCorrect', 'selected', 'updatedAt'].every((key) => own(value, key)) ||
      !Number.isSafeInteger(value.attempts) || value.attempts < 1 || value.attempts > 1000000 ||
      !Number.isSafeInteger(value.correct) || value.correct < 0 || value.correct > value.attempts ||
      typeof value.lastCorrect !== 'boolean' || !Array.isArray(value.selected) || value.selected.length < 1 || value.selected.length > 20 ||
      !value.selected.every((index) => Number.isSafeInteger(index) && index >= 0 && index < 20) ||
      new Set(value.selected).size !== value.selected.length) return null;
    const updatedAt = date(value.updatedAt);
    if (!updatedAt) return null;
    return { attempts: value.attempts, correct: value.correct, lastCorrect: value.lastCorrect,
      selected: value.selected.slice().sort((a, b) => a - b), updatedAt };
  }
  function favorite(value) {
    if (!object(value) || !['value', 'updatedAt', 'tie'].every((key) => own(value, key)) ||
      typeof value.value !== 'boolean' || typeof value.tie !== 'string' || value.tie.length > 256 ||
      /[\u0000-\u001f\u007f]/.test(value.tie)) return null;
    const updatedAt = date(value.updatedAt);
    return updatedAt ? { value: value.value, updatedAt, tie: value.tie } : null;
  }

  // knownIds should be the destination unit's 50 IDs when reading Firestore.
  function normalizeBucket(value, knownIds) {
    const result = emptyBucket();
    if (!object(value) || !own(value, 'version') || value.version !== 1) return result;
    const allowed = knownIds === undefined ? null : knownIds instanceof Set || Array.isArray(knownIds) ? new Set(knownIds) : new Set();
    const units = new Set();
    for (const [key, normalize] of [['answers', answer], ['favorites', favorite]]) {
      if (!own(value, key) || !object(value[key])) continue;
      for (const id of Object.keys(value[key]).sort()) {
        const unit = unitForId(id);
        if (!unit || (allowed && !allowed.has(id))) continue;
        const item = normalize(value[key][id]);
        if (!item) continue;
        result[key][id] = item;
        units.add(unit);
      }
    }
    // A server document represents one unit, never an arbitrary multi-unit map.
    return units.size > 1 ? emptyBucket() : result;
  }

  function compareStrings(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
  function latestAnswer(left, right) {
    if (!left) return right;
    if (!right) return left;
    const order = compareStrings(left.updatedAt, right.updatedAt) || compareStrings(JSON.stringify(left), JSON.stringify(right));
    return order >= 0 ? left : right;
  }
  function latestFavorite(left, right) {
    if (!left) return right;
    if (!right) return left;
    const order = compareStrings(left.updatedAt, right.updatedAt) || compareStrings(left.tie, right.tie);
    if (order !== 0) return order > 0 ? left : right;
    return left.value === false ? left : right;
  }

  // A latest answer is one record, including its counters; retries never sum it.
  function mergeBuckets(left, right) {
    const a = normalizeBucket(left), b = normalizeBucket(right), result = emptyBucket();
    const units = new Set([...Object.keys(a.answers), ...Object.keys(a.favorites), ...Object.keys(b.answers), ...Object.keys(b.favorites)].map(unitForId));
    if (units.size > 1) throw new TypeError('Cannot merge different units into one bucket.');
    for (const [key, latest] of [['answers', latestAnswer], ['favorites', latestFavorite]]) {
      for (const id of [...new Set([...Object.keys(a[key]), ...Object.keys(b[key])])].sort()) result[key][id] = latest(a[key][id], b[key][id]);
    }
    return result;
  }

  function fromRecords(records, legacyFavoriteTimestamp = EPOCH) {
    if (!object(records)) return {};
    const buckets = {};
    const ensure = (unit) => buckets[unit] || (buckets[unit] = emptyBucket());
    if (own(records, 'answers') && object(records.answers)) {
      for (const id of Object.keys(records.answers).sort()) {
        const unit = unitForId(id), item = answer(records.answers[id]);
        if (unit && item) ensure(unit).answers[id] = item;
      }
    }
    if (own(records, 'favorites') && Array.isArray(records.favorites)) {
      const updatedAt = date(legacyFavoriteTimestamp) || EPOCH;
      for (const id of [...new Set(records.favorites.filter((value) => typeof value === 'string'))].sort()) {
        const unit = unitForId(id);
        if (unit) ensure(unit).favorites[id] = { value: true, updatedAt, tie: '' };
      }
    }
    return Object.fromEntries(Object.keys(buckets).sort().map((unit) => [unit, buckets[unit]]));
  }
  function toRecords(buckets) {
    const result = { answers: {}, favorites: [] };
    if (!object(buckets)) return result;
    for (const unit of Object.keys(buckets).filter(validUnit).sort()) {
      const bucket = normalizeBucket(buckets[unit], idsForUnit(unit));
      for (const id of Object.keys(bucket.answers)) result.answers[id] = bucket.answers[id];
      for (const id of Object.keys(bucket.favorites)) if (bucket.favorites[id].value) result.favorites.push(id);
    }
    return result;
  }
  function changedUnits(before, after) {
    const a = object(before) ? before : {}, b = object(after) ? after : {};
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(validUnit).sort().filter((unit) => {
      const knownIds = idsForUnit(unit);
      return JSON.stringify(normalizeBucket(a[unit], knownIds)) !== JSON.stringify(normalizeBucket(b[unit], knownIds));
    });
  }

  return Object.freeze({ normalizeBucket, mergeBuckets, fromRecords, toRecords, changedUnits });
});
