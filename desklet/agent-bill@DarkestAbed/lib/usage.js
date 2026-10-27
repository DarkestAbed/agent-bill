// agent-bill — UsageSnapshot normalizer (pure logic, unit-tested in Node).
// Every provider is normalized into the same shape so the UI never has to
// know which provider produced the data:
//
//   {
//     provider:  'claude' | 'codex' | 'ollama',
//     fetchedAt: <unix ms>,
//     badge:     <string|null>,         // plan name, e.g. 'pro', 'free'
//     blocked:   <bool>,                // provider says you are rate-limited now
//     meters:    [ {                    // every REAL usage meter the plan reports,
//       key:      '5h' | '7d' | '30d' | 'session' | 'month' | …,  // short window first
//       label:    '5-hour' | 'weekly' | '30-day' | 'session' | …,
//       pct:      <0–100>,
//       resetAt:  <ISO|null>,
//       severity: <string|null>,       // server warning level (Claude limits[])
//     } ],
//     tokensIn, tokensOut, requests, costUsd: <number|null>,   // null = not reported
//     series:    null | { values: [n…], label: '24h' },        // request trend
//   }
//
// Field inventory and live-verified shapes: .docs/provider-fields.md.
// Never fabricate a percentage: a meter exists only if the provider sent it.

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Window length (seconds) -> meter key/label. Codex labels windows only by
// length (Free has ONE 30-day window; paid has 5-hour + weekly).
const WINDOW_NAMES = {
    18000: { key: '5h', label: '5-hour' },
    604800: { key: '7d', label: 'weekly' },
    2592000: { key: '30d', label: '30-day' },
};

function rangeToMs(range) {
    switch (range) {
        case '5h': return 5 * HOUR_MS;
        case '24h': return DAY_MS;
        case '7d': return 7 * DAY_MS;
        default: return DAY_MS;
    }
}

// Build a snapshot from a provider's raw payload. @meta.badge is a plan name
// known from the local login (used when the payload has none). A throwing
// parser yields an empty snapshot so one bad provider never breaks the others.
function buildSnapshot(provider, raw, meta) {
    const snap = {
        provider,
        fetchedAt: Date.now(),
        badge: (meta && meta.badge) || null,
        blocked: false,
        meters: [],
        tokensIn: null,
        tokensOut: null,
        requests: null,
        costUsd: null,
        series: null,
    };
    try {
        if (provider === 'claude')
            _fillClaude(snap, raw);
        else if (provider === 'codex')
            _fillOpenAI(snap, raw);
        else if (provider === 'ollama')
            _fillOllama(snap, raw);
    } catch (e) {
        global.logError(`agent-bill: snapshot failed for ${provider}: ${e}`);
    }
    return snap;
}

// The meter to headline: the highest usage, because that is the limit that
// blocks you first. Ties go to the later (longer) window. null if no meters.
function pickHero(meters) {
    let hero = null;
    for (const m of meters || []) {
        if (hero === null || m.pct >= hero.pct)
            hero = m;
    }
    return hero;
}

// Time until @resetAt as a short countdown: '<1m', '41m', '2h 41m', '3d 6h'.
function formatCountdown(resetAt, nowMs) {
    const t = Date.parse(resetAt);
    if (isNaN(t))
        return null;
    const mins = Math.floor((t - nowMs) / 60000);
    if (mins < 1)
        return '<1m';
    if (mins < 60)
        return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24)
        return `${hours}h ${mins % 60}m`;
    const days = Math.floor(hours / 24);
    return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`;
}

// 1234 -> '1.2k', 13332212 -> '13.3M'.
function formatCompact(n) {
    if (n === null || n === undefined)
        return null;
    if (n >= 1e9)
        return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6)
        return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3)
        return `${(n / 1e3).toFixed(1)}k`;
    return `${n}`;
}

// Sum a list of bucket objects over a field accessor. Buckets may nest their
// numbers under `results[]` (Anthropic/OpenAI admin APIs).
function _sumBuckets(buckets, fn) {
    let total = 0;
    for (const bucket of buckets || []) {
        const results = bucket.results || [bucket];
        for (const r of results)
            total += fn(r) || 0;
    }
    return total;
}

// Normalize a utilization value that may arrive as 0–1 or 0–100 to 0–100.
function _normPct(u) {
    if (u === null || u === undefined)
        return null;
    const n = Number(u);
    if (!isFinite(n))
        return null;
    return n <= 1 ? Math.round(n * 1000) / 10 : Math.round(n * 10) / 10;
}

function _meter(key, label, pct, resetAt, severity) {
    return { key, label, pct, resetAt: resetAt || null, severity: severity || null };
}

// ---------------- Anthropic ----------------
// Two shapes:
//   1. Admin API usage_report/messages (org admin key): { data: [buckets] }.
//   2. OAuth plan usage (Pro/Max login): `five_hour` / `seven_day` (+ Max-only
//      `seven_day_opus` / `seven_day_sonnet`) objects with {utilization 0–100,
//      resets_at}, and a `limits[]` array {kind, percent, severity, resets_at}.
//      The objects are read first; limits[] supplies severity and is the
//      fallback when the objects are missing.
const CLAUDE_METERS = [
    ['five_hour', '5h', '5-hour', 'session'],
    ['seven_day', '7d', 'weekly', 'weekly_all'],
    ['seven_day_opus', '7d-opus', 'Opus weekly', null],
    ['seven_day_sonnet', '7d-sonnet', 'Sonnet weekly', null],
];

function _fillClaude(snap, data) {
    if (!data)
        return;
    if (Array.isArray(data.data)) {
        const buckets = data.data;
        snap.tokensIn = _sumBuckets(buckets, (r) =>
            (r.uncached_input_tokens || 0) +
            (r.cache_read_input_tokens || 0) +
            ((r.cache_creation && r.cache_creation.ephemeral_5m_input_tokens) || 0) +
            ((r.cache_creation && r.cache_creation.ephemeral_1h_input_tokens) || 0));
        snap.tokensOut = _sumBuckets(buckets, (r) => r.output_tokens || 0);
        return;
    }
    const limits = Array.isArray(data.limits) ? data.limits : [];
    const limitOf = (kind) => limits.find((l) => l.kind === kind) || null;
    for (const [field, key, label, kind] of CLAUDE_METERS) {
        const obj = data[field];
        const limit = kind ? limitOf(kind) : null;
        let pct = obj ? _normPct(obj.utilization) : null;
        let resetAt = obj ? obj.resets_at : null;
        if (pct === null && limit) {
            pct = _normPct(limit.percent);
            resetAt = limit.resets_at;
        }
        if (pct !== null)
            snap.meters.push(_meter(key, label, pct, resetAt, limit && limit.severity));
    }
    snap.blocked = snap.meters.some((m) => m.pct >= 100);
}

// ---------------- OpenAI ----------------
// Two shapes:
//   1. Admin API usage/completions (org admin key): { data: [buckets] }.
//   2. ChatGPT plan meter (wham/usage): { plan_type, rate_limit: { allowed,
//      limit_reached, primary_window, secondary_window } }, each window
//      { used_percent, limit_window_seconds, reset_at (unix s) }. Window
//      lengths vary by plan (verified 2026-10-27): paid = 5-hour + weekly;
//      Free = one 30-day primary and secondary_window null.
function _fillOpenAI(snap, data) {
    if (!data)
        return;
    if (Array.isArray(data.data)) {
        const buckets = data.data;
        snap.tokensIn = _sumBuckets(buckets, (r) => r.input_tokens || 0);
        snap.tokensOut = _sumBuckets(buckets, (r) => r.output_tokens || 0);
        snap.requests = _sumBuckets(buckets, (r) => r.num_model_requests || 0);
        return;
    }
    if (data.plan_type)
        snap.badge = data.plan_type;
    const rl = data.rate_limit;
    if (!rl)
        return;
    snap.blocked = rl.limit_reached === true || rl.allowed === false;
    for (const w of [rl.primary_window, rl.secondary_window]) {
        if (!w || w.used_percent === null || w.used_percent === undefined)
            continue;
        const name = WINDOW_NAMES[w.limit_window_seconds] || _windowName(w.limit_window_seconds);
        // reset_at is unix seconds live (Anthropic/Ollama send ISO).
        const resetAt = (typeof w.reset_at === 'number')
            ? new Date(w.reset_at * 1000).toISOString() : (w.reset_at || null);
        snap.meters.push(_meter(name.key, name.label, Number(w.used_percent), resetAt));
    }
    // Shortest window first, so the secondary lines read 5-hour, weekly, …
    snap.meters.sort((a, b) => _keySeconds(a.key) - _keySeconds(b.key));
}

// Unlisted window lengths: 86400 -> { key: '1d', label: '1-day' }.
function _windowName(seconds) {
    const s = Number(seconds) || 0;
    if (s >= 86400 && s % 86400 === 0)
        return { key: `${s / 86400}d`, label: `${s / 86400}-day` };
    const h = Math.max(1, Math.round(s / 3600));
    return { key: `${h}h`, label: `${h}-hour` };
}

function _keySeconds(key) {
    const m = /^(\d+)([hd])/.exec(key);
    if (!m)
        return 0;
    return Number(m[1]) * (m[2] === 'd' ? 86400 : 3600);
}

// ---------------- Ollama cloud (/api/usage + /api/balance) ----------------
// The provider merges two calls into { usage, balance }:
//   usage (range=24h): { totals: { request_count, [input_tokens,
//     cached_input_tokens, output_tokens, usage_usd — PAID plans only] },
//     buckets: [ { from, until, request_count } ] }   (hourly)
//   balance, two verified shapes:
//     PAID:   { included: { balance_usd, allowance_usd, period } }  -> 'month' meter
//     LEGACY: { included: { session: { remaining_percent, resets_at },
//                           weekly:  { remaining_percent, resets_at } } }
//             -> used % = 100 - remaining_percent
function _fillOllama(snap, data) {
    const usage = (data && data.usage) || {};
    const balance = (data && data.balance) || null;

    const totals = usage.totals || {};
    snap.requests = (totals.request_count !== undefined) ? totals.request_count : null;
    snap.tokensIn = (totals.input_tokens !== undefined) ? totals.input_tokens : null;
    snap.tokensOut = (totals.output_tokens !== undefined) ? totals.output_tokens : null;
    snap.costUsd = (totals.usage_usd !== undefined) ? totals.usage_usd : null;
    if (Array.isArray(usage.buckets) && usage.buckets.length)
        snap.series = { values: usage.buckets.slice(-24).map((b) => b.request_count || 0), label: '24h' };

    const included = balance && balance.included;
    if (!included)
        return;
    for (const [field, key, label] of [['session', 'session', 'session'], ['weekly', '7d', 'weekly']]) {
        const q = included[field];
        if (q && typeof q.remaining_percent === 'number')
            snap.meters.push(_meter(key, label, Math.round((100 - q.remaining_percent) * 10) / 10, q.resets_at));
    }
    if (typeof included.allowance_usd === 'number' && included.allowance_usd > 0) {
        const allowance = included.allowance_usd;
        const remaining = (typeof included.balance_usd === 'number') ? included.balance_usd : allowance;
        const pct = Math.round(Math.max(0, Math.min(100, ((allowance - remaining) / allowance) * 100)) * 10) / 10;
        snap.meters.push(_meter('month', 'monthly $', pct, included.period && included.period.until));
    }
}

// Map our range to the admin APIs' bucket widths (admin keys only).
function claudeWindow(range) {
    // 1h buckets; max 168h covers 7d. 5h -> 5 buckets, 24h -> 24, 7d -> 168.
    return { bucketWidth: '1h', hours: range === '5h' ? 5 : range === '24h' ? 24 : 168 };
}

function openaiWindow(range) {
    // Use 1h for 5h/24h, 1d for 7d (1d max 31 buckets).
    if (range === '7d')
        return { bucketWidth: '1d' };
    return { bucketWidth: '1h' };
}
