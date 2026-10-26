// agent-bill — Ollama (cloud) provider.
// Endpoint: GET https://ollama.com/api/usage
// Auth:     Authorization: Bearer <ollama.com API key>
// Range:    24h | 7d | 30d only. Our UI '5h' clamps to 24h.
// Limits:   10 req/min per user; 429 carries a Retry-After header (surfaced
//           by lib/http.js as err.retryAfterSeconds).

const Me = imports.misc.extensionUtils.getCurrentExtension();
const HttpLib = Me.imports.lib.http;
const Usage = Me.imports.lib.usage;

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
