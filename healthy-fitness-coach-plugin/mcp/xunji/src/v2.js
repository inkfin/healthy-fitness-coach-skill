'use strict';

const { connectorError } = require('./errors.js');
const { assertDate } = require('./schemas.js');

// Keep original v2 trains intact for review/writeback. Only completed sets feed
// trend aggregates; warmups, uncompleted sets and unknown units are not volume.
function parseV2Trains(trains) {
  const records = [];
  const number = value => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : undefined;
  for (const train of trains) {
    if (!train || typeof train !== 'object' || Array.isArray(train)) throw connectorError('invalid_response');
    try { assertDate(train.datestr); } catch (_) { throw connectorError('invalid_response'); }
    const movements = Array.isArray(train.movements) ? train.movements : [];
    const source = train.data_source || train.source;
    // Do not expose a Garmin train, including its raw object, to the model.
    if (/garmin/i.test(String(source || ''))) continue;
    for (const [index, move] of (movements.length ? movements : [null]).entries()) {
      const warnings = [];
      let sets = 0, reps = 0, volume = 0, maxWeight;
      const consume = set => {
        if (!set || set.done !== true || set.setType === '热') return;
        sets += 1;
        const count = number(set.reps);
        if (count !== undefined && count >= 0) reps += count;
        const weight = number(set.weight_kg ?? set.weight);
        const unit = set.weight_kg !== undefined ? 'kg' : set.unit;
        const kg = weight !== undefined && /^(kg|公斤|lb|lbs|磅)$/.test(String(unit))
          ? weight * (/^(lb|lbs|磅)$/.test(unit) ? 0.45359237 : 1) : undefined;
        if (kg !== undefined && kg >= 0) {
          maxWeight = Math.max(maxWeight ?? 0, kg);
          if (count !== undefined && count >= 0) volume += kg * count;
        } else if (weight !== undefined) warnings.push('unknown_weight_unit');
        if (set.dropSets?.length) warnings.push('drop_sets_not_aggregated');
      };
      for (const set of move?.sets || []) {
        if (Array.isArray(set.items)) {
          // Preserve supersets, but do not attribute child lifts to a parent name.
          warnings.push('superset_not_aggregated');
        } else consume(set);
      }
      const metrics = move?.metrics || {};
      const duration = number(move?.workoutTime ?? move?.duration_s);
      const completed_activity = (move?.sets || []).some(set => set?.done === true || set?.items?.some(item => item?.set?.done === true))
        || (move?.cardio === true && (duration > 0 || number(metrics.distance) > 0 || number(metrics.kcal) > 0 || number(train.end) > number(train.start)));
      records.push({
        raw_text: JSON.stringify(train), raw_v2: train, api_version: 2,
        record_date: train.datestr,
        ...(train.localid !== undefined ? { id: String(train.localid), localid: train.localid } : {}),
        ...(train.start !== undefined ? { start: train.start } : {}),
        ...(train.end !== undefined ? { end: train.end } : {}),
        movement_index: index, completed_activity,
        title: move?.name || train.title || '未命名训练', name: move?.name || train.title || '未命名训练',
        ...(source ? { data_source: source } : {}),
        ...(move?.cardio ? { kind: 'aerobic', ...(duration !== undefined ? { duration_min: duration / 60 } : {}), metrics } : {}),
        ...(move ? { sets, total_reps: reps, volume, volume_unit: 'kg', ...(maxWeight !== undefined ? { weight: `${maxWeight}kg` } : {}) } : {}),
        parse_status: warnings.length ? 'partial' : 'complete',
        ...(warnings.length ? { warnings: [...new Set(warnings)] } : {})
      });
    }
  }
  return records;
}

function validateV2Trains(records, { today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) } = {}) {
  if (!Array.isArray(records) || !records.length) throw connectorError('invalid_upsert');
  if (records.length > 4) throw connectorError('v2_record_limit');
  const date = assertDate(records[0]?.datestr);
  const shiftMonth = amount => {
    const [year, month, day] = today.split('-').map(Number);
    const first = new Date(Date.UTC(year, month - 1 + amount, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    first.setUTCDate(Math.min(day, last));
    return first.toISOString().slice(0, 10);
  };
  if (date < shiftMonth(-6) || date > shiftMonth(6)) throw connectorError('v2_date_window');
  const parsed = records.map(train => {
    if (!train || typeof train !== 'object' || Array.isArray(train)) throw connectorError('invalid_upsert');
    assertDate(train.datestr);
    if (train.datestr !== date) throw connectorError('mixed_dates');
    if (train.localid !== undefined && (!Number.isSafeInteger(train.localid) || train.localid <= 0)) throw connectorError('invalid_upsert');
    if (!Array.isArray(train.movements) || !train.movements.length) throw connectorError('invalid_upsert');
    let movementCount = 0;
    for (const move of train.movements) {
      if (!move || typeof move.name !== 'string' || !/[\u3400-\u9fff]/u.test(move.name) || Object.hasOwn(move, 'key')) throw connectorError('invalid_upsert');
      if (move.difficulty !== undefined && !['easy', 'normal', 'hard'].includes(move.difficulty)) throw connectorError('invalid_upsert');
      for (const key of ['restTime', 'warn_restTime']) if (move[key] !== undefined && (!Number.isInteger(move[key]) || move[key] < 0 || move[key] > 86400)) throw connectorError('invalid_upsert');
      if (move.cardio === true) {
        if (Object.hasOwn(move, 'sets') || !move.metrics || typeof move.metrics !== 'object') throw connectorError('invalid_upsert');
        movementCount += 1;
        continue;
      }
      if (!Array.isArray(move.sets) || !move.sets.length || move.sets.length > 20) throw connectorError('invalid_upsert');
      let width = 1;
      const validateSet = set => {
        if (!set || typeof set !== 'object' || Array.isArray(set) || Object.hasOwn(set, 'items')) throw connectorError('invalid_upsert');
        if (!['weight', 'weight_kg', 'reps', 'time', 'duration_s', 'selfWeight'].some(key => Object.hasOwn(set, key))) throw connectorError('invalid_upsert');
        if (set.rpe !== undefined && !['', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10'].includes(set.rpe)) throw connectorError('invalid_upsert');
        if (set.done !== undefined && typeof set.done !== 'boolean') throw connectorError('invalid_upsert');
      };
      for (const set of move.sets) {
        if (Array.isArray(set?.items)) {
          if (!set.items.length) throw connectorError('invalid_upsert');
          width = Math.max(width, set.items.length);
          for (const item of set.items) {
            if (!item || typeof item.name !== 'string' || !/[\u3400-\u9fff]/u.test(item.name) || Object.hasOwn(item, 'key')) throw connectorError('invalid_upsert');
            validateSet(item.set);
          }
        } else validateSet(set);
      }
      movementCount += width;
    }
    if (movementCount > 15) throw connectorError('invalid_upsert');
    return { date, ...(train.localid !== undefined ? { id: String(train.localid) } : {}), start: train.start, end: train.end };
  });
  // Preserve all note metadata, uncompleted sets, timestamps and IDs verbatim.
  return { date, records: JSON.parse(JSON.stringify(records)), parsed,
    existing_ids: parsed.filter(record => record.id).length,
    new_records: parsed.filter(record => !record.id).length };
}
module.exports = { parseV2Trains, validateV2Trains };
