// agent-bill — Ollama (cloud) provider.
// Endpoints:
//   GET https://ollama.com/api/usage    range=24h|7d|30d, scope=self
//   GET https://ollama.com/api/balance  (allowance meters)
// Auth: Authorization: Bearer <ollama.com API key>
//
// VERIFIED live 2026-10-26: /api/usage returns
//   { range, scope, granularity, from, until,
//     totals: { request_count, [input_tokens, cached_input_tokens,
//               output_tokens, usage_usd  — PAID plans only] },
//     buckets: [ { from, until, request_count, … } ] }
// On legacy plans totals carries ONLY request_count (no tokens/cost).
//
// /api/balance has TWO verified shapes:
//   - PAID plan: { included: { balance_usd, allowance_usd, period },
//                  purchased: { balance_usd } }              -> dollar %
//   - LEGACY/free tier (verified live: HTTP 200, NOT 401):
//       { included: { session: { remaining_percent, resets_at },
//                     weekly:  { remaining_percent, resets_at } },
//         purchased: { balance_usd } }                      -> used % =
//     100 - remaining_percent for the session (5h-style) and weekly windows.
// The desklet shows whichever real meter the plan reports; it never invents
// a usage %.
//
// The card needs the hourly request trend (range=24h) and the real quota
// meters (/api/balance); the provider merges both into { usage, balance }.
// 10 req/min shared rate limit; 2 calls per refresh is well within budget.

// Cinnamon's require() resolves relative to the desklet ROOT (not this file),
// so paths look like they're from desklet.js even though we're in providers/.
const HttpLib = require('./lib/http.js');

const API_BASE = 'https://ollama.com';

const Provider = {
    id: 'ollama',
    label: 'Ollama',

    // cred: { kind: 'key', key }. The card always shows the last 24 h, so
    // @range is not used.
    fetchUsage(range, cred) {
        const headers = { 'Authorization': `Bearer ${cred.key}` };

        const usagePromise = HttpLib.getJsonWithQuery(
            `${API_BASE}/api/usage`,
            { range: '24h', scope: 'self' },
            headers
        );

        // Balance: two verified shapes (see header). Keys without access may
        // get 401/404 — tolerate that; the card then shows requests only.
        const balancePromise = HttpLib.getJson(`${API_BASE}/api/balance`, headers)
            .catch((err) => {
                if (err && (err.status === 401 || err.status === 404))
                    return null;
                throw err;
            });

        return Promise.all([usagePromise, balancePromise])
            .then(([usage, balance]) => ({ usage, balance }));
    },
};
