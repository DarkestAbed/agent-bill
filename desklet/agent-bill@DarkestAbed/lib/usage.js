// agent-bill — UsageSnapshot normalizer.
// Every provider is normalized into the same shape so the UI never has to
// know which provider produced the data:
//
//   {
//     provider:   'claude' | 'codex' | 'ollama',
//     range:      '5h' | '24h' | '7d',          // what was requested
//     fetchedAt:  <unix ms>,
//     tokensIn:   <number|null>,                  // input tokens in range (null = not reported)
//     tokensOut:  <number|null>,                  // output tokens in range
//     requests:   <number|null>,                  // request count if known
//     costUsd:    <number|null>,                  // spend in range if known
//     weekly:     { tokensIn, tokensOut, requests }|null,   // 7d totals if available
//     plan:       null | {                       // plan "allowance" meter (5h/7d %)
//       windowPct:    <number|null>,            // 5-hour utilization % (Claude/Codex plan,
//                                               // Ollama legacy session quota: 100-remaining_%)
//       windowResetAt:<ISO|null>,
//       weeklyPct:    <number|null>,            // 7-day utilization % (Claude/Codex plan,
//                                               // Ollama legacy weekly quota: 100-remaining_%)
//       weeklyResetAt:<ISO|null>,
//       allowancePct: <number|null>,            // Ollama PAID: spend vs monthly allowance %
//       note:         <string|null>,            // honest caveat, e.g. "tokens/cost not on your plan"
//     },
//   }
//
// IMPORTANT (verified 2026-10-26 against the live APIs — see
// memory/provider-data-reality.md): a Claude PLAN / ChatGPT PLAN subscription
// is NOT readable through the Anthropic/OpenAI Admin APIs (those need an
// organization admin key and return HTTP 403 for plan users). Plan usage comes
// from the CLIs' own OAuth endpoints instead, which report utilization meters
// (5-hour / 7-day %) rather than raw tokens. Ollama cloud /api/usage reports
// request_count on legacy plans and additionally tokens/cost on paid plans;
// /api/balance reports a dollar allowance (paid) or session/weekly
// remaining_percent quota meters (legacy tier — both verified live).
// Never fabricate a percentage: if a provider gives no limit, plan.* stays null.

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
        plan: null,
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

// Normalize a utilization value that may arrive as 0–1 or 0–100 to 0–100.
function _normPct(u) {
    if (u === null || u === undefined)
        return null;
    const n = Number(u);
    if (!isFinite(n))
        return null;
    return n <= 1 ? Math.round(n * 1000) / 10 : Math.round(n * 10) / 10;
}

function _numOrNull(x) {
    return (x === null || x === undefined) ? null : Number(x);
}

// ---------------- Anthropic ----------------
// Two shapes reach this function:
//   1. Admin API usage_report/messages (org admin key): { data: [buckets] }.
//   2. OAuth plan usage (Claude Pro/Max login): utilization meters. The VERIFIED
//      live shape (2026-10-26) has BOTH `five_hour`/`seven_day` objects
//      ({utilization, resets_at, …}) AND a `limits[]` array
//      ({kind, group, percent, resets_at}). The legacy+modern fields are read
//      first; limits[] is only a fallback — its entries use `percent` (0–100)
//      and `kind` ("session"|"weekly_all"), NOT `utilization`/`type`.
function _fillClaude(snap, range, data) {
    if (!data)
        return;
    if (Array.isArray(data.data)) {
        // Admin API — raw token buckets.
        const buckets = data.data || [];
        snap.tokensIn = _sumBuckets(buckets, (r) =>
            (r.uncached_input_tokens || 0) +
            (r.cache_read_input_tokens || 0) +
            ((r.cache_creation && r.cache_creation.ephemeral_5m_input_tokens) || 0) +
            ((r.cache_creation && r.cache_creation.ephemeral_1h_input_tokens) || 0));
        snap.tokensOut = _sumBuckets(buckets, (r) => r.output_tokens || 0);
        snap.requests = null;   // usage report has no request count
        snap.costUsd = null;    // usage report is tokens, not cost
        if (range === '7d')
            snap.weekly = { tokensIn: snap.tokensIn, tokensOut: snap.tokensOut, requests: null };
        return;
    }
    // OAuth plan usage endpoint — utilization meters, no raw tokens.
    snap.plan = _planFromClaudeOAuth(data);
    snap.tokensIn = null;
    snap.tokensOut = null;
    snap.requests = null;
    snap.costUsd = null;
}

function _planFromClaudeOAuth(d) {
    const plan = { windowPct: null, windowResetAt: null, weeklyPct: null, weeklyResetAt: null, allowancePct: null, note: null };
    // Preferred: the legacy field objects (verified live to carry the real
    // utilization). `utilization` arrives as 0–100 here (e.g. 6.0, 14.0).
    let five = null, seven = null;
    if (d.five_hour || d.seven_day) {
        five = d.five_hour;
        seven = d.seven_day;
    }
    if (five) {
        plan.windowPct = _normPct(five.utilization);
        plan.windowResetAt = five.resets_at || null;
    }
    if (seven) {
        plan.weeklyPct = _normPct(seven.utilization);
        plan.weeklyResetAt = seven.resets_at || null;
    }
    // Fallback: the modern limits[] array (kind=session → 5h,
    // kind=weekly_all → weekly; value field is `percent`, 0–100).
    if ((plan.windowPct === null || plan.weeklyPct === null) && Array.isArray(d.limits)) {
        for (const l of d.limits) {
            const kind = String(l.kind || l.type || '').toLowerCase();
            const pct = _numOrNull(l.percent !== undefined ? l.percent : l.utilization);
            if (plan.windowPct === null && (kind === 'session' || kind.includes('five') || kind.includes('5h'))) {
                plan.windowPct = pct;
                plan.windowResetAt = l.resets_at || plan.windowResetAt;
            } else if (plan.weeklyPct === null && (kind === 'weekly_all' || kind === 'weekly' || kind.includes('seven') || kind.includes('weekly'))) {
                plan.weeklyPct = pct;
                plan.weeklyResetAt = l.resets_at || plan.weeklyResetAt;
            }
        }
    }
    if (plan.windowPct === null && plan.weeklyPct === null)
        plan.note = 'plan usage not reported';
    return plan;
}

// ---------------- OpenAI ----------------
// Two shapes:
//   1. Admin API usage/completions (org admin key): { data: [buckets] }.
//   2. ChatGPT plan meter (wham/usage, Sign-in-with-ChatGPT OAuth token):
//      { plan_type, rate_limit: { primary_window, secondary_window } }.
//      primary_window = 5-hour rolling (limit_window_seconds 18000),
//      secondary_window = 7-day rolling (604800). Identify by the window
//      seconds, not by position.
function _fillOpenAI(snap, range, data) {
    if (!data)
        return;
    if (Array.isArray(data.data)) {
        const buckets = data.data || [];
        snap.tokensIn = _sumBuckets(buckets, (r) => r.input_tokens || 0);
        snap.tokensOut = _sumBuckets(buckets, (r) => r.output_tokens || 0);
        snap.requests = _sumBuckets(buckets, (r) => r.num_model_requests || 0);
        snap.costUsd = null; // usage endpoint is tokens, not cost
        if (range === '7d')
            snap.weekly = { tokensIn: snap.tokensIn, tokensOut: snap.tokensOut, requests: snap.requests };
        return;
    }
    snap.plan = _planFromWham(data);
    snap.tokensIn = null;
    snap.tokensOut = null;
    snap.requests = null;
    snap.costUsd = null;
}

function _planFromWham(d) {
    const plan = { windowPct: null, windowResetAt: null, weeklyPct: null, weeklyResetAt: null, allowancePct: null, note: null };
    const rl = d && d.rate_limit;
    if (rl) {
        const pw = rl.primary_window;
        const sw = rl.secondary_window;
        if (pw) {
            plan.windowPct = _numOrNull(pw.used_percent);
            plan.windowResetAt = pw.reset_at || null;
        }
        if (sw) {
            plan.weeklyPct = _numOrNull(sw.used_percent);
            plan.weeklyResetAt = sw.reset_at || null;
        }
    }
    if (plan.windowPct === null && plan.weeklyPct === null)
        plan.note = 'plan usage not reported';
    return plan;
}

// ---------------- Ollama cloud (/api/usage + /api/balance) ----------------
// Real usage shape (verified 2026-10-26): { range, scope, granularity, from,
//   until, totals: { request_count, [input_tokens, cached_input_tokens,
//   output_tokens, usage_usd on PAID plans only] },
//   buckets: [ { from, until, request_count, … } ] }
// The provider merges three calls into { range, weekly, balance } so the
// weekly line is always populated (Ollama has no 5h range).
//
// /api/balance has TWO verified shapes (2026-10-26):
//   PAID:   { included: { balance_usd, allowance_usd, period }, … }  -> plan.allowancePct
//   LEGACY: { included: { session: { remaining_percent, resets_at },
//                         weekly:  { remaining_percent, resets_at } }, … }
//           -> plan.windowPct = 100 - session.remaining_percent (session quota)
//              plan.weeklyPct = 100 - weekly.remaining_percent (weekly quota)
//   - CONSUMPTION % (Ollama legacy tier, verified live): /api/balance's
//     included.session/included.weekly carry { remaining_percent, resets_at }
//     — the REAL "% of usage" (100 - remaining_percent = used %). This is a
//     request-quota meter, not a dollar meter.
function _fillOllama(snap, range, data) {
    const rangePayload = (data && data.range) || data || {};
    const weeklyPayload = (data && data.weekly) || null;
    const balance = (data && data.balance) || null;

    const totals = rangePayload.totals || {};
    snap.requests = (totals.request_count !== undefined) ? totals.request_count : null;
    snap.tokensIn = (totals.input_tokens !== undefined) ? totals.input_tokens : null;
    snap.tokensOut = (totals.output_tokens !== undefined) ? totals.output_tokens : null;
    snap.costUsd = (totals.usage_usd !== undefined) ? totals.usage_usd : null;

    // Weekly: prefer the explicit 7d payload; if the range is already 7d the
    // same payload serves as weekly.
    const wTotals = (weeklyPayload && weeklyPayload.totals) || (range === '7d' ? totals : null);
    if (wTotals) {
        snap.weekly = {
            tokensIn: (wTotals.input_tokens !== undefined) ? wTotals.input_tokens : 0,
            tokensOut: (wTotals.output_tokens !== undefined) ? wTotals.output_tokens : 0,
            requests: (wTotals.request_count !== undefined) ? wTotals.request_count : null,
        };
    }

    const plan = { windowPct: null, windowResetAt: null, weeklyPct: null, weeklyResetAt: null, allowancePct: null, note: null };
    const notes = [];
    const hasTokens = (totals.input_tokens !== undefined) || (totals.usage_usd !== undefined);
    if (!hasTokens)
        notes.push('tokens/cost not on your plan');
    const included = balance && balance.included;
    // (a) Dollar allowance (paid plans): allowance_usd/balance_usd.
    if (included && typeof included.allowance_usd === 'number' && included.allowance_usd > 0) {
        const allowance = included.allowance_usd;
        const remaining = (typeof included.balance_usd === 'number')
            ? included.balance_usd : allowance;
        plan.allowancePct = Math.round(Math.max(0, Math.min(100, ((allowance - remaining) / allowance) * 100)) * 10) / 10;
    }
    // (b) Request-quota meters (legacy/free tier, verified live 2026-10-26):
    //     included.session = { remaining_percent, resets_at }  -> 5h-style window,
    //     included.weekly  = { remaining_percent, resets_at }  -> 7-day window.
    //     used% = 100 - remaining_percent. These are the plan's real usage %.
    if (included && included.session && typeof included.session.remaining_percent === 'number') {
        plan.windowPct = Math.round((100 - included.session.remaining_percent) * 10) / 10;
        plan.windowResetAt = included.session.resets_at || null;
    }
    if (included && included.weekly && typeof included.weekly.remaining_percent === 'number') {
        plan.weeklyPct = Math.round((100 - included.weekly.remaining_percent) * 10) / 10;
        plan.weeklyResetAt = included.weekly.resets_at || null;
    }
    if (plan.allowancePct === null && plan.windowPct === null && plan.weeklyPct === null)
        notes.push('no allowance reported');
    plan.note = notes.length ? notes.join(' · ') : null;
    snap.plan = plan;
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
