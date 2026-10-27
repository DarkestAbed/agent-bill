// agent-bill — Codex (OpenAI) provider.
//
// Two credential kinds, discriminated by key prefix:
//   - OpenAI API key (sk-…: org admin sk-admin-… or project sk-proj-…):
//     Admin API GET /v1/organization/usage/completions — raw token buckets.
//     Org-level usage/cost endpoints need an ORGANIZATION ADMIN key; a project
//     key gets HTTP 403 (Missing scopes: api.usage.read) — verified.
//   - ChatGPT PLAN OAuth access token (tokens.access_token from
//     ~/.codex/auth.json for "Sign in with ChatGPT", pasted by the user into
//     the desklet's own keyring entry): the undocumented plan-usage endpoint
//     GET https://chatgpt.com/backend-api/wham/usage — 5-hour / 7-day
//     utilization meters. Requires the chatgpt-account-id header, decoded here
//     from the JWT payload (no extra paste needed).
//
// The token is desklet-owned (user-pasted); the desklet never reads the CLI's
// credential file itself.

// Cinnamon's require() resolves relative to the desklet ROOT (not this file),
// so paths look like they're from desklet.js even though we're in providers/.
const HttpLib = require('./lib/http.js');
const Usage = require('./lib/usage.js');

const API_BASE = 'https://api.openai.com';
const CHATGPT_API = 'https://chatgpt.com';

const Provider = {
    id: 'codex',
    label: 'Codex',

    fetchUsage(range, key) {
        if (!key)
            return Promise.reject(new Error('No Codex credential configured.'));
        if (key.startsWith('sk-'))
            return _fetchAdmin(range, key);
        return _fetchPlanUsage(key);
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
// Undocumented but real: returns plan_type + 5-hour (primary_window) and
// 7-day (secondary_window) rolling utilization for a ChatGPT plan. The
// chatgpt-account-id header is required; it is read from the access token's
// JWT payload (claim https://api.openai.com/auth.chatgpt_account_id).
function _fetchPlanUsage(accessToken) {
    const accountId = _accountIdFromJwt(accessToken);
    if (!accountId)
        return Promise.reject(new Error(
            'Could not read chatgpt-account-id from this token — paste the access_token (tokens.access_token) from ~/.codex/auth.json.'));
    return HttpLib.getJson(`${CHATGPT_API}/backend-api/wham/usage`, {
        'Authorization': `Bearer ${accessToken}`,
        'chatgpt-account-id': accountId,
        'User-Agent': 'agent-bill-desklet/0.2',
    });
}

// Decode the JWT payload (base64url) and pull the ChatGPT account id. This is
// a pure read of the token the user pasted into the desklet's own keyring entry.
function _accountIdFromJwt(token) {
    const GLib = imports.gi.GLib;
    const ByteArray = imports.byteArray;
    const parts = String(token).split('.');
    if (parts.length < 2)
        return null;
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4)
        b64 += '=';
    try {
        const bytes = GLib.base64_decode(b64);
        const payload = JSON.parse(ByteArray.toString(bytes));
        const auth = payload['https://api.openai.com/auth'] || {};
        return auth.chatgpt_account_id || null;
    } catch (e) {
        return null;
    }
}
