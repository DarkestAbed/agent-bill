// agent-bill — UsageSnapshot normalizer.
// Every provider is normalized into the same shape so the UI never has to
// know which provider produced the data:
//
//   {
//     provider:   'claude' | 'codex' | 'ollama',
//     range:      '5h' | '24h' | '7d',          // what was requested
//     fetchedAt:  <unix ms>,
//     tokensIn:   <number>,                       // input tokens in range
//     tokensOut:  <number>,                       // output tokens in range
//     requests:   <number|null>,                  // request count if known
//     costUsd:    <number|null>,                  // spend in range if known
//     weekly:     { tokensIn, tokensOut }|null,   // 7d totals if available
//   }

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

function rangeToMs(range) {
    switch (range) {
        case '5h': return 5 * HOUR_MS;
        case '24h': return DAY_MS;
        case '7d': return 7 * DAY_MS;
        default: return DAY_MS;
    }
}

// Build a snapshot from raw provider payloads. Any throwing aggregator is
// treated as "no data" so one bad provider never breaks the others.
function buildSnapshot(provider, range, claudeData, openaiData, ollamaData) {
    const snap = {
        provider,
        range,
        fetchedAt: Date.now(),
        tokensIn: 0,
        tokensOut: 0,
        requests: null,
        costUsd: null,
        weekly: null,
    };
    try {
        if (provider === 'claude')
            _fillClaude(snap, range, claudeData);
        else if (provider === 'codex')
            _fillOpenAI(snap, range, openaiData);
        else if (provider === 'ollama')
            _fillOllama(snap, range, ollamaData);
    } catch (e) {
        global.logError(`agent-bill: snapshot failed for ${provider}: ${e}`);
    }
    return snap;
}

// Sum a list of bucket objects over a field accessor. Buckets may nest their
// numbers under `results[]` (Anthropic/OpenAI) — handled per-provider below.
function _sumBuckets(buckets, fn) {
    let total = 0;
    for (const bucket of buckets || []) {
        const results = bucket.results || [bucket];
        for (const r of results)
            total += fn(r) || 0;
    }
    return total;
}

// ---------------- Anthropic (Admin API: usage_report/messages) ----------------
// data[] buckets -> results[] with token fields. Weekly = last 7 daily buckets.
function _fillClaude(snap, range, data) {
    const buckets = (data && data.data) || [];
    snap.tokensIn = _sumBuckets(buckets, (r) =>
        (r.uncached_input_tokens || 0) +
        (r.cache_read_input_tokens || 0) +
        ((r.cache_creation && r.cache_creation.ephemeral_5m_input_tokens) || 0) +
        ((r.cache_creation && r.cache_creation.ephemeral_1h_input_tokens) || 0));
    snap.tokensOut = _sumBuckets(buckets, (r) => r.output_tokens || 0);
    // Anthropic usage report has no request-count field.
    snap.requests = null;
    snap.costUsd = null; // usage report is tokens, not cost
    // Weekly totals: caller passes a 7d payload separately; if the same
    // payload spans 7 days we can approximate weekly = current totals.
    if (range === '7d')
        snap.weekly = { tokensIn: snap.tokensIn, tokensOut: snap.tokensOut };
}

// ---------------- OpenAI (Admin API: usage/completions) ----------------
// data[] buckets -> results[] with input_tokens/output_tokens/num_model_requests.
function _fillOpenAI(snap, range, data) {
    const buckets = (data && data.data) || [];
    snap.tokensIn = _sumBuckets(buckets, (r) => r.input_tokens || 0);
    snap.tokensOut = _sumBuckets(buckets, (r) => r.output_tokens || 0);
    snap.requests = _sumBuckets(buckets, (r) => r.num_model_requests || 0);
    snap.costUsd = null; // usage endpoint is tokens, not cost
    if (range === '7d')
        snap.weekly = { tokensIn: snap.tokensIn, tokensOut: snap.tokensOut };
}

// ---------------- Ollama cloud (/api/usage) ----------------
// totals: { request_count, usage_usd, input_tokens, cached_input_tokens, output_tokens }
function _fillOllama(snap, range, data) {
    const totals = (data && data.totals) || {};
    snap.tokensIn = totals.input_tokens || 0;
    snap.tokensOut = totals.output_tokens || 0;
    snap.requests = (totals.request_count !== undefined) ? totals.request_count : null;
    snap.costUsd = (totals.usage_usd !== undefined) ? totals.usage_usd : null;
    if (range === '7d')
        snap.weekly = { tokensIn: snap.tokensIn, tokensOut: snap.tokensOut };
}

// Map our UI range to the provider-native range/width.
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

function ollamaRange(range) {
    // Ollama cloud supports only 24h/7d/30d. 5h clamps to 24h.
    if (range === '7d')
        return '7d';
    return '24h';
}
