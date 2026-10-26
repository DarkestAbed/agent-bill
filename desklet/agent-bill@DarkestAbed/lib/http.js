// agent-bill — HTTP helper (libsoup3, async, never blocks the UI).
// Every request returns a Promise that resolves to the parsed JSON body,
// or rejects with an Error whose .status is the HTTP status (if any).

const Soup = imports.gi.Soup;
const GLib = imports.gi.GLib;
const ByteArray = imports.byteArray;

const SOUP_SESSION = new Soup.Session();
// Keep sessions modest; providers are low-volume.
SOUP_SESSION.timeout = 15; // seconds

function _buildQuery(params) {
    if (!params)
        return '';
    const parts = [];
    for (const key of Object.keys(params)) {
        const value = params[key];
        if (value === undefined || value === null)
            continue;
        if (Array.isArray(value)) {
            for (const item of value)
                parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(item)}`);
        } else {
            parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
        }
    }
    return parts.length ? `?${parts.join('&')}` : '';
}

// GET a JSON URL with optional headers. Resolves to parsed JSON.
function getJson(url, headers) {
    return new Promise((resolve, reject) => {
        const message = Soup.Message.new('GET', url);
        if (!message) {
            reject(new Error(`Invalid URL: ${url}`));
            return;
        }
        if (headers) {
            for (const name of Object.keys(headers))
                message.get_request_headers().append(name, headers[name]);
        }
        SOUP_SESSION.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null,
            (session, result) => {
                try {
                    const bytes = SOUP_SESSION.send_and_read_finish(result);
                    const status = message.get_status();
                    // ByteArray.toString is the idiomatic Cinnamon/cjs way to
                    // decode a GLib.Bytes payload (TextDecoder also works in
                    // mozjs-128, but ByteArray avoids the Uint8Array.toString
                    // deprecation warning seen in the logs).
                    const bodyText = bytes ? ByteArray.toString(bytes.get_data()) : '';
                    if (status < 200 || status >= 300) {
                        const err = new Error(`HTTP ${status} for ${url}`);
                        err.status = status;
                        err.body = bodyText;
                        // Surface Retry-After when present (429 rate limits).
                        const retryAfter = message.get_response_headers().get_one('Retry-After');
                        if (retryAfter)
                            err.retryAfterSeconds = parseInt(retryAfter, 10) || null;
                        reject(err);
                        return;
                    }
                    resolve(JSON.parse(bodyText));
                } catch (e) {
                    reject(e);
                }
            }
        );
    });
}

// Convenience: build a full URL with query params and GET it.
function getJsonWithQuery(baseUrl, queryParams, headers) {
    return getJson(baseUrl + _buildQuery(queryParams), headers);
}
