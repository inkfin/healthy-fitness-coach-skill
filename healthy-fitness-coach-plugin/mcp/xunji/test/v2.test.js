'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { gzipSync } = require('node:zlib');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { XunjiClient, decodeXunjiResponse, PRODUCTION_URL } = require('../src/xunji-client.js');
const { parseV2Trains, validateV2Trains } = require('../src/v2.js');
const { createTrainingService } = require('../src/server.js');
const train = () => ({ datestr: '2026-11-04', localid: 123, start: 100, end: 200, title: '胸部训练', source: 'xunji', note: { text: 'fixture', trainColor: '#FF7A00' }, movements: [{ name: '杠铃卧推', restTime: 90, sets: [
  { done: true, setType: '热', weight: '20', unit: 'kg', reps: '10' },
  { done: true, weight: '60', unit: 'kg', reps: '8', rpe: '8.5' },
  { done: false, weight: '60', unit: 'kg', reps: '8' }
] }] });
const validate = records => validateV2Trains(records, { today: '2026-11-04' });

test('production v2 request contract and compressed response work without success field', async () => {
  const t = train();
  const client = new XunjiClient({ fetchImpl: async (url, request) => {
    assert.equal(url, PRODUCTION_URL);
    assert.deepEqual(JSON.parse(request.body), { schema_version: 'train_open_api_v2', datestr: '2026-11-04', include_full_data: true });
    assert.equal(request.headers.Authorization, 'Bearer FAKE_KEY');
    return new Response(gzipSync(JSON.stringify({ res: { trains: [t] } })));
  } });
  assert.equal(client.protocol, 'v2');
  assert.deepEqual((await client.fetchDay('2026-11-04', 'FAKE_KEY', { include_full_data: true })).records, [t]);
});

test('v2 decoder distinguishes empty success from malformed, rejected or truncated data', () => {
  assert.deepEqual(decodeXunjiResponse({ res: { trains: [] } }, { protocol: 'v2' }).records, []);
  for (const payload of [{ res: [] }, { res: {} }, { success: false, res: { trains: [] } }, { res: { trains: [], truncated: true } }, { res: { trains: ['legacy text'] } }]) {
    assert.throws(() => decodeXunjiResponse(payload, { protocol: 'v2' }), { code: 'invalid_response' });
  }
});

test('v2 completed working sets feed aggregates while full objects remain intact', () => {
  const t = train();
  const [record] = parseV2Trains([t]);
  assert.equal(record.sets, 1); assert.equal(record.total_reps, 8); assert.equal(record.volume, 480);
  assert.equal(record.id, '123'); assert.equal(record.record_date, t.datestr);
  assert.deepEqual(record.raw_v2, t);
  assert.equal(record.raw_v2.movements[0].sets[2].done, false);
  const lbs = train(); lbs.movements[0].sets = [{ done: true, weight: '100', unit: 'lb', reps: '2' }];
  assert.equal(parseV2Trains([lbs])[0].volume, 90.718474);
});

test('v2 unknown units, supersets and dropsets are flagged rather than invented', () => {
  const t = train(); t.movements[0].sets = [{ done: true, weight: '10', reps: '8' }, { done: true, items: [{ name: '卧推', set: { weight: '20', reps: '10' } }] }];
  const [r] = parseV2Trains([t]);
  assert.equal(r.volume, 0);
  assert.deepEqual(r.warnings, ['unknown_weight_unit', 'superset_not_aggregated']);
  assert.equal(parseV2Trains([{ ...train(), source: 'Garmin' }]).length, 0);
  assert.throws(() => parseV2Trains([{ ...train(), datestr: '2026-02-30' }]), { code: 'invalid_response' });
});

test('v2 write validation preserves all IDs, timestamps, notes and unfinished sets', () => {
  const t = train(); const result = validate([t]);
  assert.deepEqual(result.records, [t]); assert.equal(result.existing_ids, 1);
  assert.equal(result.parsed[0].id, '123');
  assert.notEqual(result.records[0], t);
});

test('v2 enforces same-day limits, calendar window, Chinese names and RPE strings', () => {
  assert.throws(() => validate(Array.from({ length: 5 }, train)), { code: 'v2_record_limit' });
  assert.throws(() => validate([train(), { ...train(), datestr: '2026-11-05' }]), { code: 'mixed_dates' });
  for (const date of ['2026-05-03', '2027-05-05']) assert.throws(() => validate([{ ...train(), datestr: date }]), { code: 'v2_date_window' });
  for (const date of ['2026-05-04', '2027-05-04']) assert.equal(validate([{ ...train(), datestr: date }]).date, date);
  for (const mutate of [
    t => { t.movements[0].name = 'bench'; }, t => { t.movements[0].key = 'internal'; },
    t => { t.movements[0].sets[0].rpe = 8; }, t => { t.movements[0].difficulty = '困难'; },
    t => { t.movements[0].sets = Array(21).fill({ reps: '1' }); },
    t => { t.movements = Array(16).fill(t.movements[0]); }
  ]) { const t = train(); mutate(t); assert.throws(() => validate([t]), { code: 'invalid_upsert' }); }
});

test('v2 supports native cardio and flat supersets without nested internal keys', () => {
  const cardio = { datestr: '2026-11-04', movements: [{ name: '跑步', cardio: true, metrics: { distance: '5', bpm: '140' } }] };
  assert.equal(validate([cardio]).new_records, 1);
  cardio.movements[0].sets = [];
  assert.throws(() => validate([cardio]), { code: 'invalid_upsert' });
  const t = train(); t.movements[0].sets = [{ items: [{ name: '引体向上', set: { selfWeight: true, reps: '8', done: false } }] }];
  assert.equal(validate([t]).existing_ids, 1);
  t.movements[0].sets[0].items[0].set.items = [];
  assert.throws(() => validate([t]), { code: 'invalid_upsert' });
});

test('v2 upserts use structured trains, full data and stable caller request ID', async () => {
  const t = train();
  // Production validation uses current Shanghai date; fixture always stays in range.
  t.datestr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const client = new XunjiClient({ fetchImpl: async (url, request) => {
    assert.equal(new URL(url).pathname, '/api_upsert_trains_for_llm_v2');
    assert.deepEqual(JSON.parse(request.body), { schema_version: 'train_open_api_v2', client_request_id: 'stable-fixture-id', dry_run: false, include_full_data: true, res: [t] });
    return new Response(JSON.stringify({ res: { trains: [t] } }));
  } });
  assert.deepEqual((await client.upsertRecords([t], 'FAKE_KEY', { client_request_id: 'stable-fixture-id' })).records, [t]);
});

test('v2 lightweight and full-detail caches never mask each other', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fitness-v2-'));
  const calls = [];
  try {
    const client = { protocol: 'v2', async fetchDay(date, key, options) {
      calls.push(options.include_full_data); return { records: [train()] };
    } };
    const service = createTrainingService({ client, credentialProvider: async () => 'FAKE_KEY', localAppData: root });
    const a = await service.getTrainingDay({ date: '2026-11-04' });
    const b = await service.getTrainingDay({ date: '2026-11-04', include_full_data: true });
    const c = await service.getTrainingDay({ date: '2026-11-04', include_full_data: true });
    assert.equal(a.error, undefined); assert.equal(b.error, undefined); assert.equal(c.cache_hit, true);
    assert.deepEqual(calls, [false, true]);
    assert.equal(b.records[0].raw_v2.movements[0].sets[1].rpe, '8.5');
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('v2 scheduled but unfinished workouts do not become completed training days', () => {
  const { analyzeTrainingRange } = require('../src/trends.js');
  const t = train(); t.movements[0].sets.forEach(set => { set.done = false; });
  const records = parseV2Trains([t]);
  assert.equal(records[0].raw_v2.movements[0].sets.length, 3);
  assert.equal(analyzeTrainingRange({ dates: ['2026-11-04'], records }).training_days, 0);
});
