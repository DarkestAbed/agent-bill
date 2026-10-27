// tests/usage.test.js
// Unit tests for desklet/agent-bill@DarkestAbed/lib/usage.js — the pure-logic
// module that normalizes all three providers into a UsageSnapshot, picks the
// hero meter, and formats countdowns. A bug here silently corrupts every
// number on the dashboard, so this is the highest-value target.
//
// Run:  node --test tests/usage.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadGjsModule } = require('./helpers/load-gjs');

const USAGE_PATH = path.join(__dirname, '..', 'desklet', 'agent-bill@DarkestAbed', 'lib', 'usage.js');
const { module: Usage, logErrorCalls } = loadGjsModule(USAGE_PATH);

// ---------- fixtures matching the VERIFIED API contracts ----------
// (see .docs/provider-fields.md — shapes confirmed against the live APIs on
// 2026-10-27; values trimmed.)

// Claude Pro /api/oauth/usage, live 2026-10-27.
const claudePlanLive = {
    five_hour: { utilization: 3.0, resets_at: '2026-10-28T03:09:59.534379+00:00', limit_dollars: null },
    seven_day: { utilization: 16.0, resets_at: '2026-10-31T02:59:59.534402+00:00', limit_dollars: null },
    seven_day_opus: null,
    seven_day_sonnet: null,
    iguana_necktie: { utilization: 0.0, resets_at: '2026-11-05T07:59:00+00:00', limit_dollars: 100 },
    extra_usage: { is_enabled: false },
    limits: [
        { kind: 'session', group: 'session', percent: 3, severity: 'normal', resets_at: '2026-10-28T03:09:59.534379+00:00', is_active: false },
        { kind: 'weekly_all', group: 'weekly', percent: 16, severity: 'normal', resets_at: '2026-10-31T02:59:59.534402+00:00', is_active: true },
    ],
};
// ChatGPT Free wham/usage, live 2026-10-27: one 30-day window.
const codexFreeLive = {
    plan_type: 'free',
    rate_limit: {
        allowed: true, limit_reached: false,
        primary_window: { used_percent: 0, limit_window_seconds: 2592000, reset_after_seconds: 2592000, reset_at: 1795735361 },
        secondary_window: null,
    },
    model_usage: {},
};
// ChatGPT paid wham/usage (documented shape): 5-hour + weekly, given in
// reverse order to prove windows are labelled by length, not position.
const codexPaid = {
    plan_type: 'plus',
    rate_limit: {
        allowed: true, limit_reached: false,
        primary_window: { used_percent: 20, limit_window_seconds: 604800, reset_at: Date.parse('2026-11-02T00:00:00Z') / 1000 },
        secondary_window: { used_percent: 55, limit_window_seconds: 18000, reset_at: Date.parse('2026-10-27T05:00:00Z') / 1000 },
    },
};
// Ollama legacy tier, live 2026-10-27: request_count only + quota meters.
const ollamaLegacyLive = {
    usage: {
        range: '24h', scope: 'self', granularity: 'hour',
        totals: { request_count: 597 },
        buckets: [
            { from: 'a', until: 'b', request_count: 0 },
            { from: 'b', until: 'c', request_count: 131 },
            { from: 'c', until: 'd', request_count: 102, partial: true },
        ],
    },
    balance: {
        included: {
            session: { remaining_percent: 100, resets_at: '2026-10-28T04:00:00Z' },
            weekly: { remaining_percent: 45.57, resets_at: '2026-11-02T00:00:00Z' },
        },
        purchased: { balance_usd: 0 },
    },
};
// Ollama paid plan (documented): tokens + cost + dollar allowance.
const ollamaPaid = {
    usage: {
        totals: { request_count: 42, input_tokens: 10000, cached_input_tokens: 2000, output_tokens: 5000, usage_usd: 1.23 },
        buckets: [],
    },
    balance: { included: { balance_usd: 72.5, allowance_usd: 100, period: { from: 'x', until: '2026-11-30T00:00:00Z' } }, purchased: { balance_usd: 0 } },
};

const meter = (snap, key) => snap.meters.find((m) => m.key === key);
// Values built inside the vm sandbox have that realm's prototypes; strict
// deepEqual needs plain copies.
const plain = (x) => JSON.parse(JSON.stringify(x));

// ---------- Claude ----------
test('claude plan (live shape): 5h + weekly meters with severity; codename meters ignored', () => {
    const snap = Usage.buildSnapshot('claude', claudePlanLive, { badge: 'pro' });
    assert.deepEqual(plain(snap.meters.map((m) => m.key)), ['5h', '7d']);
    assert.equal(meter(snap, '5h').pct, 3);
    assert.equal(meter(snap, '5h').label, '5-hour');
    assert.equal(meter(snap, '7d').pct, 16);
    assert.equal(meter(snap, '7d').severity, 'normal');
    assert.equal(meter(snap, '7d').resetAt, '2026-10-31T02:59:59.534402+00:00');
    assert.equal(snap.badge, 'pro');
    assert.equal(snap.blocked, false);
    // plan endpoint reports NO raw tokens — null, not 0
    assert.equal(snap.tokensIn, null);
    assert.equal(snap.requests, null);
});

test('claude plan: 0–1 utilization is normalized to %; Max-only model meters appear when present', () => {
    const snap = Usage.buildSnapshot('claude', {
        five_hour: { utilization: 0.42, resets_at: 'r1' },
        seven_day: { utilization: 0.15, resets_at: 'r2' },
        seven_day_opus: { utilization: 0.30, resets_at: 'r2' },
    });
    assert.equal(meter(snap, '5h').pct, 42);
    assert.equal(meter(snap, '7d').pct, 15);
    assert.equal(meter(snap, '7d-opus').label, 'Opus weekly');
    assert.equal(meter(snap, '7d-opus').pct, 30);
});

test('claude plan: limits[] alone is enough (fallback by kind)', () => {
    const snap = Usage.buildSnapshot('claude', {
        limits: [
            { kind: 'session', percent: 55, severity: 'warning', resets_at: 'r1' },
            { kind: 'weekly_all', percent: 20, resets_at: 'r2' },
        ],
    });
    assert.equal(meter(snap, '5h').pct, 55);
    assert.equal(meter(snap, '5h').severity, 'warning');
    assert.equal(meter(snap, '7d').pct, 20);
});

test('claude plan: a meter at 100% marks the snapshot blocked', () => {
    const snap = Usage.buildSnapshot('claude', { five_hour: { utilization: 100, resets_at: 'r' } });
    assert.equal(snap.blocked, true);
});

test('claude admin: sums tokens across nested results[] buckets (incl. cache creation/read)', () => {
    const snap = Usage.buildSnapshot('claude', { data: [
        { results: [
            { uncached_input_tokens: 1500, cache_read_input_tokens: 200, cache_creation: { ephemeral_5m_input_tokens: 500, ephemeral_1h_input_tokens: 1000 }, output_tokens: 500 },
            { uncached_input_tokens: 100, output_tokens: 50 },
        ] },
        { results: [
            { uncached_input_tokens: 1000, cache_read_input_tokens: 300, cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 400 }, output_tokens: 250 },
        ] },
    ] });
    // in: (1500+200+500+1000) + 100 + (1000+300+200+400) = 5200
    assert.equal(snap.tokensIn, 5200);
    assert.equal(snap.tokensOut, 800);
    assert.deepEqual(plain(snap.meters), []);   // admin API has no plan meter
});

// ---------- Codex ----------
test('codex free (live shape): one 30-day meter, labelled by length; plan badge from payload', () => {
    const snap = Usage.buildSnapshot('codex', codexFreeLive);
    assert.equal(snap.meters.length, 1);
    assert.equal(snap.meters[0].key, '30d');
    assert.equal(snap.meters[0].label, '30-day');
    assert.equal(snap.meters[0].pct, 0);
    assert.equal(snap.meters[0].resetAt, new Date(1795735361 * 1000).toISOString());
    assert.equal(snap.badge, 'free');
    assert.equal(snap.blocked, false);
});

test('codex paid: windows labelled by length regardless of position, sorted short-first', () => {
    const snap = Usage.buildSnapshot('codex', codexPaid);
    assert.deepEqual(plain(snap.meters.map((m) => m.label)), ['5-hour', 'weekly']);
    assert.equal(meter(snap, '5h').pct, 55);
    assert.equal(meter(snap, '7d').pct, 20);
    assert.equal(meter(snap, '5h').resetAt, '2026-10-27T05:00:00.000Z');
});

test('codex: limit_reached / not allowed marks the snapshot blocked', () => {
    const p = JSON.parse(JSON.stringify(codexFreeLive));
    p.rate_limit.limit_reached = true;
    assert.equal(Usage.buildSnapshot('codex', p).blocked, true);
});

test('codex: unknown window length gets a generic label', () => {
    const snap = Usage.buildSnapshot('codex', { rate_limit: { primary_window: { used_percent: 5, limit_window_seconds: 86400, reset_at: 1 } } });
    assert.equal(snap.meters[0].label, '1-day');
});

test('codex admin: sums input/output/requests across buckets', () => {
    const snap = Usage.buildSnapshot('codex', { object: 'page', data: [
        { results: [{ input_tokens: 1000, output_tokens: 500, num_model_requests: 5 }] },
        { results: [{ input_tokens: 2000, output_tokens: 700, num_model_requests: 3 }] },
    ] });
    assert.equal(snap.tokensIn, 3000);
    assert.equal(snap.tokensOut, 1200);
    assert.equal(snap.requests, 8);
    assert.deepEqual(plain(snap.meters), []);
});

// ---------- Ollama ----------
test('ollama legacy (live shape): session + weekly meters = 100 - remaining; requests + hourly series', () => {
    const snap = Usage.buildSnapshot('ollama', ollamaLegacyLive);
    assert.equal(meter(snap, 'session').pct, 0);
    assert.equal(meter(snap, '7d').pct, 54.4);
    assert.equal(meter(snap, '7d').label, 'weekly');
    assert.equal(meter(snap, '7d').resetAt, '2026-11-02T00:00:00Z');
    assert.equal(snap.requests, 597);
    assert.deepEqual(plain(snap.series.values), [0, 131, 102]);
    // tokens/cost are not reported on this tier — null, never 0
    assert.equal(snap.tokensIn, null);
    assert.equal(snap.costUsd, null);
});

test('ollama paid: tokens/cost from totals (cached not double-counted) + monthly allowance meter', () => {
    const snap = Usage.buildSnapshot('ollama', ollamaPaid);
    assert.equal(snap.tokensIn, 10000);
    assert.equal(snap.tokensOut, 5000);
    assert.equal(snap.costUsd, 1.23);
    assert.equal(meter(snap, 'month').pct, 27.5);   // (100 - 72.5) / 100
    assert.equal(meter(snap, 'month').resetAt, '2026-11-30T00:00:00Z');
    assert.equal(snap.series, null);                // no buckets
});

test('ollama: no balance (401/404 tolerated) -> requests only, no meters', () => {
    const snap = Usage.buildSnapshot('ollama', { usage: ollamaLegacyLive.usage, balance: null });
    assert.deepEqual(plain(snap.meters), []);
    assert.equal(snap.requests, 597);
});

test('ollama: series keeps only the last 24 buckets', () => {
    const buckets = Array.from({ length: 25 }, (_, i) => ({ request_count: i }));
    const snap = Usage.buildSnapshot('ollama', { usage: { totals: {}, buckets }, balance: null });
    assert.equal(snap.series.values.length, 24);
    assert.equal(snap.series.values[0], 1);
});

// ---------- hero + formatting ----------
test('pickHero: highest % wins; ties go to the later (longer) window; empty -> null', () => {
    const live = Usage.buildSnapshot('claude', claudePlanLive);
    assert.equal(Usage.pickHero(live.meters).key, '7d');            // 16% > 3%
    const legacy = Usage.buildSnapshot('ollama', ollamaLegacyLive);
    assert.equal(Usage.pickHero(legacy.meters).key, '7d');          // 54.4% > 0%
    const tie = [{ key: '5h', pct: 10 }, { key: '7d', pct: 10 }];
    assert.equal(Usage.pickHero(tie).key, '7d');
    assert.equal(Usage.pickHero([]), null);
});

test('formatCountdown: minutes, hours+minutes, days+hours, whole days, past', () => {
    const now = Date.parse('2026-10-27T20:00:00Z');
    assert.equal(Usage.formatCountdown('2026-10-27T20:41:00Z', now), '41m');
    assert.equal(Usage.formatCountdown('2026-10-27T22:41:30Z', now), '2h 41m');
    assert.equal(Usage.formatCountdown('2026-10-31T02:59:59Z', now), '3d 6h');
    assert.equal(Usage.formatCountdown('2026-10-29T20:00:00Z', now), '2d');
    assert.equal(Usage.formatCountdown('2026-10-27T19:00:00Z', now), '<1m');
    assert.equal(Usage.formatCountdown('nonsense', now), null);
});

test('formatCompact: k / M / B suffixes', () => {
    assert.equal(Usage.formatCompact(999), '999');
    assert.equal(Usage.formatCompact(1234), '1.2k');
    assert.equal(Usage.formatCompact(13332212), '13.3M');
    assert.equal(Usage.formatCompact(null), null);
});

// ---------- isolation + admin range mappers ----------
test('a throwing parser yields an empty snapshot and logs, never throws', () => {
    const before = logErrorCalls.length;
    const evil = { get limits() { throw new Error('boom'); } };
    const snap = Usage.buildSnapshot('claude', evil);
    assert.deepEqual(plain(snap.meters), []);
    assert.equal(logErrorCalls.length, before + 1);
    // null payloads are simply empty
    assert.deepEqual(plain(Usage.buildSnapshot('codex', null).meters), []);
});

test('admin range mappers: bucket widths and windows', () => {
    assert.deepEqual(plain(Usage.claudeWindow('24h')), { bucketWidth: '1h', hours: 24 });
    assert.deepEqual(plain(Usage.claudeWindow('7d')), { bucketWidth: '1h', hours: 168 });
    assert.deepEqual(plain(Usage.openaiWindow('24h')), { bucketWidth: '1h' });
    assert.deepEqual(plain(Usage.openaiWindow('7d')), { bucketWidth: '1d' });
    assert.equal(Usage.rangeToMs('24h'), 24 * 3600 * 1000);
    assert.equal(Usage.rangeToMs('???'), 24 * 3600 * 1000);
});
