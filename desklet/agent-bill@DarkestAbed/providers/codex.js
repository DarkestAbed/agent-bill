// agent-bill — Codex (OpenAI) provider.
// Endpoint: GET https://api.openai.com/v1/organization/usage/completions
// Auth:     Authorization: Bearer <organization admin key>
// Buckets:  bucket_width=1h for 5h/24h, 1d for 7d. group_by=model so Codex
//           models are distinguishable (usage is aggregated across the org).

const Me = imports.misc.extensionUtils.getCurrentExtension();
const HttpLib = Me.imports.lib.http;
const Usage = Me.imports.lib.usage;

const API_BASE = 'https://api.openai.com';

const Provider = {
    id: 'codex',
    label: 'Codex',

    fetchUsage(range, key) {
        if (!key)
            return Promise.reject(new Error('No OpenAI admin API key configured.'));

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
    },
};

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
