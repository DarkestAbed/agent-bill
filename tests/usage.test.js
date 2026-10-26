// tests/usage.test.js
// Unit tests for desklet/agent-bill@DarkestAbed/lib/usage.js — the pure-logic
// module that normalizes all three providers into a UsageSnapshot and maps UI
// ranges to provider-native bucket widths/ranges. A bug here silently
// corrupts every number on the dashboard, so this is the highest-value target.
//
// Run:  node --test tests/usage.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadGjsModule } = require('./helpers/load-gjs');

const USAGE_PATH = path.join(__dirname, '..', 'desklet', 'agent-bill@DarkestAbed', 'lib', 'usage.js');
const { module: Usage, logErrorCalls } = loadGjsModule(USAGE_PATH);

// ---------- fixtures matching the verified API contracts ----------
function claudePayload(buckets) {
    return { data: buckets, has_more: false, next_page: null };
}
function openaiPayload(buckets) {
    return { object: 'page', data: buckets, has_more: false, next_page: null };
}
const ollamaPayload = {
    range: '7d', scope: 'self', granularity: 'day',
    totals: { request_count: 42, usage_usd: 1.23, input_tokens: 10000, cached_input_tokens: 2000, output_tokens: 5000 },
    buckets: [],
};

// ---------- Claude (Anthropic Admin API) ----------
test('claude: sums tokens across nested results[] buckets (incl. cache creation/read)', () => {
    const data = claudePayload([
        { starting_at: 'a', ending_at: 'b', results: [
            { uncached_input_tokens: 1500, cache_read_input_tokens: 200, cache_creation: { ephemeral_5m_input_tokens: 500, ephemeral_1h_input_tokens: 1000 }, output_tokens: 500 },
            { uncached_input_tokens: 100,  cache_read_input_tokens: 0,   cache_creation: { ephemeral_5m_input_tokens: 0,   ephemeral_1h_input_tokens: 0 },   output_tokens: 50 },
        ]},
        { starting_at: 'c', ending_at: 'd', results: [
            { uncached_input_tokens: 1000, cache_read_input_tokens: 300, cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 400 }, output_tokens: 250 },
        ]},
    ]);
    const snap = Usage.buildSnapshot('claude', '24h', data, null, null);
    // in: (1500+200+500+1000) + (100) + (1000+300+200+400) = 3200 + 100 + 1900 = 5200
    assert.equal(snap.tokensIn, 5200);
    // out: 500 + 50 + 250 = 800
    assert.equal(snap.tokensOut, 800);
    assert.equal(snap.requests, null);   // Anthropic usage report has no request count
    assert.equal(snap.costUsd, null);    // it is tokens, not cost
    assert.equal(snap.weekly, null);     // only populated for the 7d range
    assert.equal(snap.provider, 'claude');
    assert.equal(snap.range, '24h');
    assert.equal(typeof snap.fetchedAt, 'number');
});

test('claude: tolerates results without cache_creation', () => {
    const data = claudePayload([{ results: [{ uncached_input_tokens: 10, output_tokens: 5 }] }]);
    const snap = Usage.buildSnapshot('claude', '24h', data, null, null);
    assert.equal(snap.tokensIn, 10);
    assert.equal(snap.tokensOut, 5);
});

// ---------- Codex (OpenAI Admin API) ----------
test('codex: sums input/output/requests across buckets', () => {
    const data = openaiPayload([
        { start_time: 1, end_time: 2, results: [{ input_tokens: 1000, output_tokens: 500, num_model_requests: 5, model: 'gpt-6-astra' }] },
        { start_time: 2, end_time: 3, results: [{ input_tokens: 2000, output_tokens: 700, num_model_requests: 3, model: 'gpt-6-astra' }] },
    ]);
    const snap = Usage.buildSnapshot('codex', '24h', null, data, null);
    assert.equal(snap.tokensIn, 3000);
    assert.equal(snap.tokensOut, 1200);
    assert.equal(snap.requests, 8);
    assert.equal(snap.costUsd, null);
});

test('codex: weekly totals populated only for the 7d range', () => {
    const data = openaiPayload([{ start_time: 1, end_time: 2, results: [{ input_tokens: 100, output_tokens: 40, num_model_requests: 1 }] }]);
    const w = Usage.buildSnapshot('codex', '7d', null, data, null);
    assert.equal(w.weekly.tokensIn, 100);
    assert.equal(w.weekly.tokensOut, 40);
    const d = Usage.buildSnapshot('codex', '24h', null, data, null);
    assert.equal(d.weekly, null);
});

// ---------- Ollama (cloud /api/usage) ----------
test('ollama: reads totals; cached_input_tokens is NOT double-counted', () => {
    const snap = Usage.buildSnapshot('ollama', '24h', null, null, ollamaPayload);
    // cached_input_tokens is a subset of input_tokens — must not be added on top.
    assert.equal(snap.tokensIn, 10000);
    assert.equal(snap.tokensOut, 5000);
    assert.equal(snap.requests, 42);
    assert.equal(snap.costUsd, 1.23);
    assert.equal(snap.weekly, null);
});

test('ollama: weekly totals populated for the 7d range', () => {
    const snap = Usage.buildSnapshot('ollama', '7d', null, null, ollamaPayload);
    assert.equal(snap.weekly.tokensIn, 10000);
    assert.equal(snap.weekly.tokensOut, 5000);
});

// ---------- error isolation (one bad provider must not break the others) ----------
test('error isolation: a malformed provider payload does not throw and yields zeros', () => {
    const before = logErrorCalls.length;
    // results is a non-iterable number -> _sumBuckets throws -> caught by buildSnapshot
    const snap = Usage.buildSnapshot('claude', '24h', { data: [{ results: 5 }] }, null, null);
    assert.equal(snap.tokensIn, 0);
    assert.equal(snap.tokensOut, 0);
    assert.ok(logErrorCalls.length > before, 'logError should have been called for the bad payload');
});

// ---------- range mappers (must match each provider's real API contract) ----------
// Compare field-by-field: these objects are created inside the vm sandbox, so
// their prototype differs from this realm and deepStrictEqual rejects them.
test('range mappers match provider API contracts', () => {
    const cw5 = Usage.claudeWindow('5h');
    assert.equal(cw5.bucketWidth, '1h'); assert.equal(cw5.hours, 5);
    const cw24 = Usage.claudeWindow('24h');
    assert.equal(cw24.bucketWidth, '1h'); assert.equal(cw24.hours, 24);
    const cw7 = Usage.claudeWindow('7d');
    assert.equal(cw7.bucketWidth, '1h'); assert.equal(cw7.hours, 168);
    assert.equal(Usage.openaiWindow('5h').bucketWidth,  '1h');
    assert.equal(Usage.openaiWindow('24h').bucketWidth, '1h');
    assert.equal(Usage.openaiWindow('7d').bucketWidth,  '1d');
    assert.equal(Usage.ollamaRange('5h'),  '24h'); // clamped: Ollama cloud has no 5h range
    assert.equal(Usage.ollamaRange('24h'), '24h');
    assert.equal(Usage.ollamaRange('7d'),  '7d');
});

// ---------- cross-realm weekly totals (objects created inside the vm) ----------
test('weekly totals use value equality (cross-realm from the vm)', () => {
    // deepEqual/strict compare prototypes; assert on fields directly instead.
    const data = openaiPayload([{ start_time: 1, end_time: 2, results: [{ input_tokens: 100, output_tokens: 40, num_model_requests: 1 }] }]);
    const w = Usage.buildSnapshot('codex', '7d', null, data, null);
    assert.equal(w.weekly.tokensIn, 100);
    assert.equal(w.weekly.tokensOut, 40);
    const o = Usage.buildSnapshot('ollama', '7d', null, null, ollamaPayload);
    assert.equal(o.weekly.tokensIn, 10000);
    assert.equal(o.weekly.tokensOut, 5000);
});

test('rangeToMs conversions (and safe default)', () => {
    assert.equal(Usage.rangeToMs('5h'),  5 * 3600 * 1000);
    assert.equal(Usage.rangeToMs('24h'), 24 * 3600 * 1000);
    assert.equal(Usage.rangeToMs('7d'),  7 * 24 * 3600 * 1000);
    assert.equal(Usage.rangeToMs('???'), 24 * 3600 * 1000); // unknown -> 1 day
});
