// agent-bill — plan credentials read from the CLIs' own login files in $HOME.
//
// Plan users (Claude Pro/Max, ChatGPT plans) have no admin API key. Their
// usage meters are read with the OAuth access token the `claude` / `codex`
// CLIs keep on disk. The CLIs refresh those tokens in place whenever they
// run, so the desklet re-reads the file on EVERY refresh — never caches the
// token, never pastes it into the keyring, never refreshes it itself (a
// desklet-side refresh would rotate the refresh token out from under the CLI
// and log it out).
//
//   Claude: $CLAUDE_CONFIG_DIR/.credentials.json  (default ~/.claude)
//           claudeAiOauth.{accessToken, expiresAt(ms), subscriptionType, rateLimitTier}
//           access token lifetime verified ~8h (2026-10-27).
//   Codex:  $CODEX_HOME/auth.json                  (default ~/.codex)
//           tokens.{access_token (JWT, exp ~10d), account_id}, auth_mode
//
// parseClaudeCredentials / parseCodexAuth are pure (unit-tested in Node);
// readClaude / readCodex do the file I/O inside Cinnamon.

// Expired tokens get a clear error (code 'expired') instead of a raw 401.
// A small skew avoids calling with a token that dies mid-request.
const EXPIRY_SKEW_MS = 60 * 1000;

function _credError(message, code) {
    const err = new Error(message);
    err.code = code;
    return err;
}

// @text: contents of .credentials.json. Returns
// { token, expiresAt, subscriptionType, rateLimitTier } or throws.
function parseClaudeCredentials(text, nowMs) {
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw _credError('~/.claude/.credentials.json is not valid JSON', 'invalid');
    }
    const oauth = data && data.claudeAiOauth;
    if (!oauth || !oauth.accessToken)
        throw _credError('no Claude plan login found — run `claude` and sign in', 'missing');
    const expiresAt = (typeof oauth.expiresAt === 'number') ? oauth.expiresAt : null;
    if (expiresAt !== null && expiresAt - EXPIRY_SKEW_MS <= nowMs)
        throw _credError('Claude login token expired — run `claude` once to renew it', 'expired');
    return {
        token: oauth.accessToken,
        expiresAt,
        subscriptionType: oauth.subscriptionType || null,
        rateLimitTier: oauth.rateLimitTier || null,
    };
}

// @text: contents of auth.json. Returns
// { token, accountId, expiresAt, planType } or throws.
function parseCodexAuth(text, nowMs) {
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw _credError('~/.codex/auth.json is not valid JSON', 'invalid');
    }
    const tokens = data && data.tokens;
    if (!tokens || !tokens.access_token)
        throw _credError('no ChatGPT login found — run `codex login`', 'missing');
    const claims = _jwtPayload(tokens.access_token) || {};
    const auth = claims['https://api.openai.com/auth'] || {};
    const expiresAt = (typeof claims.exp === 'number') ? claims.exp * 1000 : null;
    if (expiresAt !== null && expiresAt - EXPIRY_SKEW_MS <= nowMs)
        throw _credError('Codex login token expired — run `codex` once to renew it', 'expired');
    const accountId = tokens.account_id || auth.chatgpt_account_id || null;
    if (!accountId)
        throw _credError('no ChatGPT account id in ~/.codex/auth.json — run `codex login`', 'invalid');
    return {
        token: tokens.access_token,
        accountId,
        expiresAt,
        planType: auth.chatgpt_plan_type || null,
    };
}

// Decode a JWT payload (base64url JSON). Pure JS so it runs in Node tests.
function _jwtPayload(token) {
    const parts = String(token).split('.');
    if (parts.length < 2)
        return null;
    try {
        return JSON.parse(_utf8(_base64UrlBytes(parts[1])));
    } catch (e) {
        return null;
    }
}

function _base64UrlBytes(s) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const bytes = [];
    let buffer = 0, bits = 0;
    for (const ch of s.replace(/=+$/, '')) {
        const v = alphabet.indexOf(ch === '+' ? '-' : ch === '/' ? '_' : ch);
        if (v < 0)
            throw new Error('bad base64');
        buffer = (buffer << 6) | v;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            bytes.push((buffer >> bits) & 0xff);
        }
    }
    return bytes;
}

function _utf8(bytes) {
    return decodeURIComponent(bytes.map((b) => '%' + b.toString(16).padStart(2, '0')).join(''));
}

// ---------------- file I/O (Cinnamon only) ----------------
function _readText(path) {
    const GLib = imports.gi.GLib;
    const ByteArray = imports.byteArray;
    if (!GLib.file_test(path, GLib.FileTest.EXISTS))
        return null;
    const [ok, contents] = GLib.file_get_contents(path);
    return ok ? ByteArray.toString(contents) : null;
}

function _dir(envVar, fallback) {
    const GLib = imports.gi.GLib;
    return GLib.getenv(envVar) || GLib.build_filenamev([GLib.get_home_dir(), fallback]);
}

function readClaude() {
    const path = _dir('CLAUDE_CONFIG_DIR', '.claude') + '/.credentials.json';
    const text = _readText(path);
    if (text === null)
        throw _credError(`no Claude login at ${path} — run \`claude\` and sign in`, 'missing');
    return parseClaudeCredentials(text, Date.now());
}

function readCodex() {
    const path = _dir('CODEX_HOME', '.codex') + '/auth.json';
    const text = _readText(path);
    if (text === null)
        throw _credError(`no Codex login at ${path} — run \`codex login\``, 'missing');
    return parseCodexAuth(text, Date.now());
}
