// agent-bill — Claude (Anthropic) provider.
// Endpoint: GET https://api.anthropic.com/v1/organizations/usage_report/messages
// Auth:     x-api-key: <organization admin key>  +  anthropic-version: 2023-06-01
// Buckets:  bucket_width=1h (max 168h, covers our 5h/24h/7d ranges).

// Cinnamon's require() resolves relative to the desklet ROOT (not this file),
// so paths look like they're from desklet.js even though we're in providers/.
const HttpLib = require('./lib/http.js');
const Usage = require('./lib/usage.js');

const API_BASE = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';

const Provider = {
    id: 'claude',
    label: 'Claude',

    fetchUsage(range, key) {
        if (!key)
            return Promise.reject(new Error('No Anthropic admin API key configured.'));

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
    },
};

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
