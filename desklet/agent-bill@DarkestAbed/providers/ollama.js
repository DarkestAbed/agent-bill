// agent-bill — Ollama (cloud) provider.
// Endpoints:
//   GET https://ollama.com/api/usage    range=24h|7d|30d, scope=self
//   GET https://ollama.com/api/balance  (allowance %, paid plans only)
// Auth: Authorization: Bearer <ollama.com API key>
//
// VERIFIED live 2026-10-26: /api/usage returns
//   { range, scope, granularity, from, until,
//     totals: { request_count, [input_tokens, cached_input_tokens,
//               output_tokens, usage_usd  — PAID plans only] },
//     buckets: [ { from, until, request_count, … } ] }
// On legacy plans totals carries ONLY request_count (no tokens/cost), and
// /api/balance returns 401 — so the desklet must not invent a usage %.
//
// To always populate the weekly line (Ollama has no 5h range) and to surface a
// real allowance % when the plan exposes it, this provider merges three calls
// into { range, weekly, balance }. 10 req/min shared rate limit; refresh is
// every 5 min, so 2–3 calls per cycle is well within budget.

// Cinnamon's require() resolves relative to the desklet ROOT (not this file),
// so paths look like they're from desklet.js even though we're in providers/.
const HttpLib = require('./lib/http.js');
const Usage = require('./lib/usage.js');

const API_BASE = 'https://ollama.com';

const Provider = {
    id: 'ollama',
    label: 'Ollama',

    fetchUsage(range, key) {
        if (!key)
            return Promise.reject(new Error('No Ollama API key configured.'));

        const headers = { 'Authorization': `Bearer ${key}` };
        const ollamaRange = Usage.ollamaRange(range);

        // Main range payload.
        const rangePromise = HttpLib.getJsonWithQuery(
            `${API_BASE}/api/usage`,
            { range: ollamaRange, scope: 'self' },
            headers
        );

        // Weekly payload: always 7d unless the requested range already is 7d
        // (then the same payload serves as weekly — no duplicate call).
        const weeklyPromise = (ollamaRange === '7d')
            ? rangePromise
            : HttpLib.getJsonWithQuery(
                `${API_BASE}/api/usage`,
                { range: '7d', scope: 'self' },
                headers
            );

        // Allowance balance: paid plans return { included: { balance_usd,
        // allowance_usd, period }, purchased: { balance_usd } }. Legacy plans /
        // unauthorized keys return 401/404 — tolerate that (allowance % simply
        // stays null and the card says so honestly).
        const balancePromise = HttpLib.getJson(`${API_BASE}/api/balance`, headers)
            .then((b) => b)
            .catch((err) => {
                if (err && (err.status === 401 || err.status === 404))
                    return null;
                throw err;
            });

        return Promise.all([rangePromise, weeklyPromise, balancePromise])
            .then(([rangeData, weeklyData, balance]) => ({
                range: rangeData,
                weekly: weeklyData,
                balance,
            }));
    },
};
