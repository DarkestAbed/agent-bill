// agent-bill — Ollama (cloud) provider.
// Endpoint: GET https://ollama.com/api/usage
// Auth:     Authorization: Bearer <ollama.com API key>
// Range:    24h | 7d | 30d only. Our UI '5h' clamps to 24h.
// Limits:   10 req/min per user; 429 carries a Retry-After header (surfaced
//           by lib/http.js as err.retryAfterSeconds).

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

        const ollamaRange = Usage.ollamaRange(range);
        return HttpLib.getJsonWithQuery(
            `${API_BASE}/api/usage`,
            { range: ollamaRange, scope: 'self' },
            { 'Authorization': `Bearer ${key}` }
        );
    },
};
