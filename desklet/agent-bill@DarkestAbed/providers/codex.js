// agent-bill — Codex (OpenAI) provider.
//
// Two credential kinds (resolved by desklet.js _resolveCredential):
//   - OpenAI API key (sk-…: org admin sk-admin-… or project sk-proj-…):
//     Admin API GET /v1/organization/usage/completions — raw token buckets.
//     Org-level usage/cost endpoints need an ORGANIZATION ADMIN key; a project
//     key gets HTTP 403 (Missing scopes: api.usage.read) — verified.
//   - ChatGPT PLAN login ("Sign in with ChatGPT"): the OAuth access token and
//     account id the `codex` CLI keeps in ~/.codex/auth.json, re-read on every
//     refresh by lib/localauth.js: the undocumented plan-usage endpoint
//     GET https://chatgpt.com/backend-api/wham/usage — rolling-window
//     utilization meters (window length varies by plan: 5h/7d on paid plans,
//     a single 30-day window on Free — verified 2026-10-27).

// Cinnamon's require() resolves relative to the desklet ROOT (not this file),
// so paths look like they're from desklet.js even though we're in providers/.
const HttpLib = require('./lib/http.js');
const Usage = require('./lib/usage.js');

const API_BASE = 'https://api.openai.com';
const CHATGPT_API = 'https://chatgpt.com';

const Provider = {
    id: 'codex',
    label: 'Codex',

    // cred: { kind: 'admin', key } | { kind: 'plan', token, accountId }
    fetchUsage(range, cred) {
        if (cred.kind === 'admin')
            return _fetchAdmin(range, cred.key);
        return _fetchPlanUsage(cred.token, cred.accountId);
    },
};

// ---------------- Admin API (OpenAI key) ----------------
// Buckets: bucket_width=1h for 5h/24h, 1d for 7d. group_by=model so Codex
// models are distinguishable (usage is aggregated across the org).
function _fetchAdmin(range, key) {
    const { bucketWidth } = Usage.openaiWindow(range);
    const startTime = Math.floor((Date.now() - Usage.rangeToMs(range)) / 1000);
    const endTime = Math.floor(Date.now() / 1000);

    return HttpLib.getJsonWithQuery(
        `${API_BASE}/v1/organization/usage/completions`,
        {
            start_time: startTime,
            end_time: endTime,
            bucket_width: bucketWidth,
            group_by: ['model'],
        },
        { 'Authorization': `Bearer ${key}` }
    ).then((firstPage) => _collectAllPages(firstPage, key, {
        start_time: startTime,
        end_time: endTime,
        bucket_width: bucketWidth,
        group_by: ['model'],
    }));
}

// Paginated (has_more / next_page). Fetch every page for a complete window.
function _collectAllPages(page, key, query) {
    const allBuckets = [...(page.data || [])];
    if (!page.has_more || !page.next_page)
        return { object: 'page', data: allBuckets, has_more: false, next_page: null };

    return HttpLib.getJsonWithQuery(
        `${API_BASE}/v1/organization/usage/completions`,
        { ...query, page: page.next_page },
        { 'Authorization': `Bearer ${key}` }
    ).then((next) => {
        const merged = { data: [...allBuckets, ...(next.data || [])], has_more: next.has_more, next_page: next.next_page };
        if (!next.has_more || !next.next_page)
            return { object: 'page', ...merged, has_more: false, next_page: null };
        return _collectAllPages(merged, key, query).then((rest) => ({
            object: 'page',
            data: [...merged.data, ...(rest.data || [])],
            has_more: false,
            next_page: null,
        }));
    });
}

// ---------------- Plan usage (ChatGPT OAuth token) ----------------
// Undocumented but real: returns plan_type + rolling-window utilization
// (rate_limit.primary_window / secondary_window, each with
// limit_window_seconds) for a ChatGPT plan. The chatgpt-account-id header is
// required; lib/localauth.js reads it from auth.json.
function _fetchPlanUsage(accessToken, accountId) {
    return HttpLib.getJson(`${CHATGPT_API}/backend-api/wham/usage`, {
        'Authorization': `Bearer ${accessToken}`,
        'chatgpt-account-id': accountId,
        'User-Agent': 'agent-bill-desklet/1.0',
    });
}
