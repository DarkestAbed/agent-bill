// tests/localauth.test.js
// Unit tests for desklet/agent-bill@DarkestAbed/lib/localauth.js — parsing of
// the plan logins the claude/codex CLIs keep in $HOME. Shapes match the files
// on the target as of 2026-10-27 (values here are fakes).
//
// Run:  node --test tests/localauth.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadGjsModule } = require('./helpers/load-gjs');

const LOCALAUTH_PATH = path.join(__dirname, '..', 'desklet', 'agent-bill@DarkestAbed', 'lib', 'localauth.js');
const { module: LocalAuth } = loadGjsModule(LOCALAUTH_PATH);

const NOW = Date.parse('2026-10-27T20:00:00Z');

function fakeJwt(payload) {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'RS256' })}.${b64(payload)}.sig`;
}

function claudeFile(oauth) {
    return JSON.stringify({ claudeAiOauth: oauth });
}

test('claude: valid login returns token + plan metadata', () => {
    const c = LocalAuth.parseClaudeCredentials(claudeFile({
        accessToken: 'tok-a', refreshToken: 'tok-r', expiresAt: NOW + 7 * 3600e3,
        subscriptionType: 'pro', rateLimitTier: 'default_claude_ai',
    }), NOW);
    assert.equal(c.token, 'tok-a');
    assert.equal(c.subscriptionType, 'pro');
    assert.equal(c.rateLimitTier, 'default_claude_ai');
});

test('claude: expired token raises code=expired with a run-claude hint', () => {
    assert.throws(
        () => LocalAuth.parseClaudeCredentials(claudeFile({ accessToken: 't', expiresAt: NOW - 1000 }), NOW),
        (e) => e.code === 'expired' && /run `claude`/.test(e.message));
});

test('claude: missing oauth block / bad JSON raise distinct codes', () => {
    assert.throws(() => LocalAuth.parseClaudeCredentials('{}', NOW), (e) => e.code === 'missing');
    assert.throws(() => LocalAuth.parseClaudeCredentials('{nope', NOW), (e) => e.code === 'invalid');
});

test('codex: reads access token, account id and plan type; expiry from JWT exp', () => {
    const jwt = fakeJwt({
        exp: NOW / 1000 + 240 * 3600,
        'https://api.openai.com/auth': { chatgpt_account_id: 'acct-jwt', chatgpt_plan_type: 'free' },
    });
    const c = LocalAuth.parseCodexAuth(JSON.stringify({
        auth_mode: 'chatgpt', OPENAI_API_KEY: null,
        tokens: { access_token: jwt, refresh_token: 'r', account_id: 'acct-file' },
    }), NOW);
    assert.equal(c.token, jwt);
    assert.equal(c.accountId, 'acct-file');   // file field wins over the JWT claim
    assert.equal(c.planType, 'free');
    assert.equal(c.expiresAt, NOW + 240 * 3600e3);
});

test('codex: account id falls back to the JWT claim; expired JWT raises code=expired', () => {
    const live = fakeJwt({ exp: NOW / 1000 + 60 * 60, 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-jwt' } });
    assert.equal(LocalAuth.parseCodexAuth(JSON.stringify({ tokens: { access_token: live } }), NOW).accountId, 'acct-jwt');
    const dead = fakeJwt({ exp: NOW / 1000 - 10, 'https://api.openai.com/auth': { chatgpt_account_id: 'a' } });
    assert.throws(() => LocalAuth.parseCodexAuth(JSON.stringify({ tokens: { access_token: dead } }), NOW),
        (e) => e.code === 'expired');
});

test('codex: no tokens (API-key login) raises code=missing', () => {
    assert.throws(() => LocalAuth.parseCodexAuth(JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'x' }), NOW),
        (e) => e.code === 'missing');
});
