// agent-bill — Claude (Anthropic) provider.
//
// Two credential kinds (resolved by desklet.js _resolveCredential):
//   - Anthropic ORGANIZATION ADMIN key (sk-ant-admin01-…): Admin API
//     GET /v1/organizations/usage_report/messages — raw token buckets.
//     Requires an Anthropic organization; a Claude Plan (Pro/Max) login is an
//     individual account and gets HTTP 403 here (verified 2026-10-26).
//   - Claude PLAN login (Pro/Max): the OAuth access token the `claude` CLI
//     keeps in ~/.claude/.credentials.json, re-read on every refresh by
//     lib/localauth.js: the undocumented plan-usage endpoint
//     GET /api/oauth/usage — 5-hour / 7-day utilization meters. This is what
//     `claude /usage` uses for plan subscribers.

// Cinnamon's require() resolves relative to the desklet ROOT (not this file),
// so paths look like they're from desklet.js even though we're in providers/.
const HttpLib = require('./lib/http.js');
const Usage = require('./lib/usage.js');

const API_BASE = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
// The OAuth plan endpoint only answers to the OAuth beta header + a
// claude-code User-Agent (unrecognized UAs get rate-limited — community-verified).
const OAUTH_BETA = 'oauth-2025-04-20';
const UA = 'claude-code/2.1.311';

const Provider = {
    id: 'claude',
    label: 'Claude',

    // cred: { kind: 'admin', key } | { kind: 'plan', token }
    fetchUsage(range, cred) {
        if (cred.kind === 'admin')
            return _fetchAdmin(range, cred.key);
        return _fetchPlanUsage(cred.token);
    },
};

// ---------------- Admin API (org admin key) ----------------
// Buckets: bucket_width=1h (max 168h, covers our 5h/24h/7d ranges).
function _fetchAdmin(range, key) {
    const { bucketWidth, hours } = Usage.claudeWindow(range);
    const endingAt = new Date();
    const startingAt = new Date(endingAt.getTime() - hours * 3600 * 1000);

    return HttpLib.getJsonWithQuery(
        `${API_BASE}/v1/organizations/usage_report/messages`,
        {
            starting_at: startingAt.toISOString(),
            ending_at: endingAt.toISOString(),
            bucket_width: bucketWidth,
        },
        {
            'x-api-key': key,
            'anthropic-version': ANTHROPIC_VERSION,
        }
    ).then((firstPage) => _collectAllPages(firstPage, key, {
        starting_at: startingAt.toISOString(),
        ending_at: endingAt.toISOString(),
        bucket_width: bucketWidth,
    }));
}

// The usage report is paginated (has_more / next_page). Fetch every page so
// the snapshot reflects the whole requested window, not just the first page.
function _collectAllPages(page, key, query) {
    const allBuckets = [...(page.data || [])];
    if (!page.has_more || !page.next_page)
        return { data: allBuckets, has_more: false, next_page: null };

    return HttpLib.getJsonWithQuery(
        `${API_BASE}/v1/organizations/usage_report/messages`,
        { ...query, page: page.next_page },
        { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION }
    ).then((next) => {
        const merged = { data: [...allBuckets, ...(next.data || [])], has_more: next.has_more, next_page: next.next_page };
        if (!next.has_more || !next.next_page)
            return merged;
        return _collectAllPages(merged, key, query).then((rest) => ({
            data: [...merged.data, ...(rest.data || [])],
            has_more: false,
            next_page: null,
        }));
    });
}

// ---------------- Plan usage (OAuth token) ----------------
// Undocumented but real: returns 5-hour / 7-day utilization for a Claude.ai
// plan (Pro/Max) subscriber. Shape is either legacy
//   { five_hour: { utilization, resets_at }, seven_day: { … } }
// or a modern { limits: [ { type, utilization, resets_at } ] } array; the
// normalizer (lib/usage.js) tolerates both. Utilization may be 0–1 or 0–100.
function _fetchPlanUsage(key) {
    return HttpLib.getJson(`${API_BASE}/api/oauth/usage`, {
        'Authorization': `Bearer ${key}`,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-beta': OAUTH_BETA,
        'User-Agent': UA,
    });
}
