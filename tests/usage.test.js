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

// ---------- fixtures matching the VERIFIED API contracts ----------
// (see memory/provider-data-reality.md — shapes confirmed against the live
// APIs on 2026-10-26.)
function claudeAdminPayload(buckets) {
    return { data: buckets, has_more: false, next_page: null };
}
function openaiAdminPayload(buckets) {
    return { object: 'page', data: buckets, has_more: false, next_page: null };
}
// Ollama /api/usage on a PAID plan (request_count + tokens + cost).
const ollamaPaidPayload = {
    range: {
        range: '24h', scope: 'self', granularity: 'hour',
        totals: { request_count: 42, input_tokens: 10000, cached_input_tokens: 2000, output_tokens: 5000, usage_usd: 1.23 },
        buckets: [],
    },
    weekly: {
        range: '7d', scope: 'self', granularity: 'day',
        totals: { request_count: 300, input_tokens: 70000, output_tokens: 35000, usage_usd: 8.5 },
        buckets: [],
    },
    balance: { included: { balance_usd: 72.5, allowance_usd: 100, period: { from: 'x', until: 'y' } }, purchased: { balance_usd: 0 } },
};
// Ollama /api/usage on a LEGACY plan (verified live: request_count ONLY —
// no token/cost fields) and /api/balance -> 401 (so balance: null).
const ollamaLegacyPayload = {
    range: {
        range: '24h', scope: 'self', granularity: 'hour',
        totals: { request_count: 773 },
        buckets: [{ from: 'a', until: 'b', request_count: 62 }],
    },
    weekly: {
        range: '7d', scope: 'self', granularity: 'day',
        totals: { request_count: 773 },
        buckets: [],
    },
    balance: null,
};
// Claude PLAN OAuth /api/oauth/usage (legacy shape).
const claudePlanLegacy = {
    five_hour: { utilization: 0.42, resets_at: '2026-10-27T05:00:00Z' },
    seven_day: { utilization: 0.15, resets_at: '2026-11-02T00:00:00Z' },
    seven_day_sonnet: { utilization: 0.30, resets_at: '2026-11-02T00:00:00Z' },
};
// Claude PLAN OAuth /api/oauth/usage (modern limits[] shape).
const claudePlanModern = {
    limits: [
        { type: 'five_hour', utilization: 42, resets_at: '2026-10-27T05:00:00Z' },
        { type: 'seven_day', utilization: 15, resets_at: '2026-11-02T00:00:00Z' },
    ],
};
// Codex/ChatGPT plan wham/usage.
const codexPlanPayload = {
    plan_type: 'pro',
    rate_limit: {
        primary_window: { used_percent: 55, limit_window_seconds: 18000, reset_at: '2026-10-27T05:00:00Z' },
        secondary_window: { used_percent: 20, limit_window_seconds: 604800, reset_at: '2026-11-02T00:00:00Z' },
    },
    credits: { balance: 0 },
};

// ---------- Claude: Admin API (raw tokens) ----------
test('claude admin: sums tokens across nested results[] buckets (incl. cache creation/read)', () => {
    const data = claudeAdminPayload([
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
    assert.equal(snap.tokensOut, 800);
    assert.equal(snap.requests, null);   // usage report has no request count
    assert.equal(snap.costUsd, null);    // it is tokens, not cost
    assert.equal(snap.weekly, null);     // only populated for the 7d range
    assert.equal(snap.plan, null);       // admin API has no plan meter
    assert.equal(snap.provider, 'claude');
    assert.equal(snap.range, '24h');
    assert.equal(typeof snap.fetchedAt, 'number');
});

test('claude admin: tolerates results without cache_creation', () => {
    const data = claudeAdminPayload([{ results: [{ uncached_input_tokens: 10, output_tokens: 5 }] }]);
    const snap = Usage.buildSnapshot('claude', '24h', data, null, null);
    assert.equal(snap.tokensIn, 10);
    assert.equal(snap.tokensOut, 5);
});

// ---------- Claude: PLAN OAuth (utilization meters) ----------
test('claude plan (legacy shape): 5h/weekly % normalized from 0–1 to 0–100, resets kept', () => {
    const snap = Usage.buildSnapshot('claude', '5h', claudePlanLegacy, null, null);
    assert.equal(snap.plan.windowPct, 42);
    assert.equal(snap.plan.weeklyPct, 15);
    assert.equal(snap.plan.windowResetAt, '2026-10-27T05:00:00Z');
    assert.equal(snap.plan.weeklyResetAt, '2026-11-02T00:00:00Z');
    // plan meter endpoint reports NO raw tokens — null, not 0
    assert.equal(snap.tokensIn, null);
    assert.equal(snap.tokensOut, null);
    assert.equal(snap.requests, null);
    assert.equal(snap.costUsd, null);
});

test('claude plan (modern limits[] shape): picks five_hour + seven_day by type', () => {
    const snap = Usage.buildSnapshot('claude', '24h', claudePlanModern, null, null);
    assert.equal(snap.plan.windowPct, 42);   // already 0–100
    assert.equal(snap.plan.weeklyPct, 15);
});

// ---------- Codex: Admin API (raw tokens) ----------
test('codex admin: sums input/output/requests across buckets', () => {
    const data = openaiAdminPayload([
        { start_time: 1, end_time: 2, results: [{ input_tokens: 1000, output_tokens: 500, num_model_requests: 5, model: 'gpt-6-astra' }] },
        { start_time: 2, end_time: 3, results: [{ input_tokens: 2000, output_tokens: 700, num_model_requests: 3, model: 'gpt-6-astra' }] },
    ]);
    const snap = Usage.buildSnapshot('codex', '24h', null, data, null);
    assert.equal(snap.tokensIn, 3000);
    assert.equal(snap.tokensOut, 1200);
    assert.equal(snap.requests, 8);
    assert.equal(snap.costUsd, null);
    assert.equal(snap.plan, null);
});

test('codex admin: weekly totals populated only for the 7d range', () => {
    const data = openaiAdminPayload([{ start_time: 1, end_time: 2, results: [{ input_tokens: 100, output_tokens: 40, num_model_requests: 1 }] }]);
    const w = Usage.buildSnapshot('codex', '7d', null, data, null);
    assert.equal(w.weekly.tokensIn, 100);
    assert.equal(w.weekly.tokensOut, 40);
    const d = Usage.buildSnapshot('codex', '24h', null, data, null);
    assert.equal(d.weekly, null);
});

// ---------- Codex: PLAN OAuth (wham/usage meters) ----------
test('codex plan: primary_window -> 5h %, secondary_window -> weekly %', () => {
    const snap = Usage.buildSnapshot('codex', '5h', null, codexPlanPayload, null);
    assert.equal(snap.plan.windowPct, 55);
    assert.equal(snap.plan.weeklyPct, 20);
    assert.equal(snap.plan.windowResetAt, '2026-10-27T05:00:00Z');
    assert.equal(snap.plan.weeklyResetAt, '2026-11-02T00:00:00Z');
    assert.equal(snap.tokensIn, null);
    assert.equal(snap.tokensOut, null);
});

// ---------- Ollama: PAID plan (requests + tokens + cost + balance) ----------
test('ollama paid: reads totals; cached_input_tokens NOT double-counted; weekly from 7d payload; allowance % from balance', () => {
    const snap = Usage.buildSnapshot('ollama', '24h', null, null, ollamaPaidPayload);
    // cached_input_tokens is a subset of input_tokens — must not be added on top.
    assert.equal(snap.tokensIn, 10000);
    assert.equal(snap.tokensOut, 5000);
    assert.equal(snap.requests, 42);
    assert.equal(snap.costUsd, 1.23);
    // weekly always populated (separate 7d fetch), even when range is 24h
    assert.ok(snap.weekly);
    assert.equal(snap.weekly.requests, 300);
    assert.equal(snap.weekly.tokensIn, 70000);
    // allowance: (100 - 72.5) / 100 = 27.5%
    assert.equal(snap.plan.allowancePct, 27.5);
    assert.equal(snap.plan.note, null);
});

// ---------- Ollama: LEGACY plan (verified live: request_count ONLY) ----------
test('ollama legacy: no token/cost fields -> null (not 0, not fabricated); weekly requests shown; honest note', () => {
    const snap = Usage.buildSnapshot('ollama', '24h', null, null, ollamaLegacyPayload);
    assert.equal(snap.requests, 773);
    assert.equal(snap.tokensIn, null);   // not reported on this plan
    assert.equal(snap.tokensOut, null);
    assert.equal(snap.costUsd, null);
    assert.ok(snap.weekly);
    assert.equal(snap.weekly.requests, 773);
    assert.equal(snap.weekly.tokensIn, 0);
    assert.equal(snap.plan.allowancePct, null); // balance was 401
    assert.match(snap.plan.note, /tokens\/cost not on your plan/);
    assert.match(snap.plan.note, /no allowance reported/);
});

test('ollama: when range is 7d the same payload serves as weekly (no duplicate fetch needed)', () => {
    const merged = { range: ollamaLegacyPayload.weekly, weekly: ollamaLegacyPayload.weekly, balance: null };
    const snap = Usage.buildSnapshot('ollama', '7d', null, null, merged);
    assert.equal(snap.weekly.requests, 773);
});

// ---------- error isolation (one bad provider must not break the others) ----------
test('error isolation: a malformed provider payload does not throw and yields zeros/nulls', () => {
    const before = logErrorCalls.length;
    // results is a non-iterable number -> _sumBuckets throws -> caught by buildSnapshot
    const snap = Usage.buildSnapshot('claude', '24h', { data: [{ results: 5 }] }, null, null);
    assert.equal(snap.tokensIn, 0);
    assert.equal(snap.tokensOut, 0);
    assert.ok(logErrorCalls.length > before, 'logError should have been called for the bad payload');
});

// ---------- range mappers (must match each provider's real API contract) ----------
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
    const data = openaiAdminPayload([{ start_time: 1, end_time: 2, results: [{ input_tokens: 100, output_tokens: 40, num_model_requests: 1 }] }]);
    const w = Usage.buildSnapshot('codex', '7d', null, data, null);
    assert.equal(w.weekly.tokensIn, 100);
    assert.equal(w.weekly.tokensOut, 40);
    const o = Usage.buildSnapshot('ollama', '7d', null, null, { range: ollamaLegacyPayload.weekly, weekly: ollamaLegacyPayload.weekly, balance: null });
    assert.equal(o.weekly.tokensIn, 0);
    assert.equal(o.weekly.requests, 773);
});

test('rangeToMs conversions (and safe default)', () => {
    assert.equal(Usage.rangeToMs('5h'),  5 * 3600 * 1000);
    assert.equal(Usage.rangeToMs('24h'), 24 * 3600 * 1000);
    assert.equal(Usage.rangeToMs('7d'),  7 * 24 * 3600 * 1000);
    assert.equal(Usage.rangeToMs('???'), 24 * 3600 * 1000); // unknown -> 1 day
});
