// agent-bill — Cinnamon desklet.
// A dark-mode, one-stop usage dashboard for Claude (Anthropic), Codex
// (OpenAI) and Ollama (cloud). Refreshes on a configurable interval, reads
// credentials from the GNOME keyring, never blocks the UI (async libsoup3).
//
// Credential model (verified 2026-10-26 — see memory/provider-data-reality.md):
//   - Claude: an Anthropic ORG ADMIN key (sk-ant-admin01-…) reads the Admin
//     usage report; a Claude PLAN OAuth access token (pasted by the user)
//     reads the plan 5h/7d utilization meters. The two are discriminated by
//     key prefix in providers/claude.js.
//   - Codex: an OpenAI ORG ADMIN key reads the Admin usage API; a ChatGPT
//     PLAN OAuth access token (pasted by the user) reads the plan 5h/7d
//     utilization meters. Discriminated by key prefix in providers/codex.js.
//   - Ollama: a cloud API key (Bearer) reads /api/usage + /api/balance.
// The desklet NEVER reads the CLIs' own credential files — tokens are entered
// by the user into the desklet's own keyring entry.
//
// Resizing: Cinnamon desklets have no drag-resize; the user sets a pixel
// width in settings (stock photoframe@cinnamon.org pattern) and we apply it
// to the root actor with set_size(). Default 420px ("thicker" cards).

const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;

// Cinnamon injects require() into extension modules. IMPORTANT: paths resolve
// against the desklet ROOT directory (not the calling file's directory), and
// '../' is mangled by requireModule — always use './lib/…', './providers/…'
// from anywhere in the desklet. (imports.misc.extensionUtils does NOT exist
// in Cinnamon — that's a GNOME Shell-ism.)
const Ui = require('./lib/ui.js');
const Keyring = require('./lib/keyring.js');
const Usage = require('./lib/usage.js');
const KeyDialog = require('./lib/keydialog.js');
const ClaudeProvider = require('./providers/claude.js').Provider;
const CodexProvider = require('./providers/codex.js').Provider;
const OllamaProvider = require('./providers/ollama.js').Provider;

const UUID = 'agent-bill@DarkestAbed';

const RANGE_LABELS = { '5h': '5h', '24h': '24h', '7d': '7d' };

// Desklet-level dark theme (dark-mode only by design).
const DESKLET_CSS = `
    background-color: #1e1e2e;
    border-radius: 16px;
    border: 1px solid #3b3b52;
    padding: 16px;
    color: #e6e6ef;
`;

// Default desklet width in pixels. Applied to the root actor via set_size so
// the cards get a thicker, roomier layout than the old natural-width squeeze.
const DEFAULT_WIDTH = 420;

class AgentBillDesklet extends Desklet.Desklet {
    constructor(metadata, deskletId) {
        super(metadata, deskletId);
        this.setHeader('Agent Bill');

        this._providers = [ClaudeProvider, CodexProvider, OllamaProvider];
        this._cards = new Map();       // providerId -> card widget
        this._snapshots = new Map();   // providerId -> last UsageSnapshot
        this._timeoutId = null;
        this._refreshing = false;
        // Set when the desklet is removed/reloaded. Every async callback
        // (HTTP promise, keyring promise, timer) MUST check this before
        // touching any actor — after teardown the actors are gone and
        // touching them can crash the shell (Clutter asserts on disposed
        // actors — see cinnamon-6-gotchas.md).
        this._destroyed = false;

        this.settings = new Settings.DeskletSettings(this, UUID, deskletId);
        this.settings.bindProperty(Settings.BindingDirection.IN,
            'refresh-interval', 'refreshInterval', this._onSettingsChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN,
            'time-range', 'timeRange', this._onSettingsChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN,
            'desklet-width', 'deskletWidth', this._onWidthChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN,
            'claude-enabled', 'claudeEnabled', this._onSettingsChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN,
            'codex-enabled', 'codexEnabled', this._onSettingsChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN,
            'ollama-enabled', 'ollamaEnabled', this._onSettingsChanged.bind(this));

        // Defaults if schema not yet bound.
        if (!this.refreshInterval) this.refreshInterval = 5;
        if (!this.timeRange) this.timeRange = '24h';
        if (!this.deskletWidth) this.deskletWidth = DEFAULT_WIDTH;

        this._buildLayout();
        this._applyWidth();
    }

    // ---------------- UI ----------------
    _buildLayout() {
        const root = new St.BoxLayout({
            vertical: true,
            style: DESKLET_CSS,
            x_expand: true,
        });
        this._root = root;

        // Header row: live dot + title + refresh button + range
        this._liveDot = new St.Bin({
            style: 'background-color: #9a9ab0; border-radius: 50%; width: 10px; height: 10px;',
        });
        const title = Ui.makeLabel('Agent Bill', { size: 18, bold: true });
        this._refreshButton = Ui.makeButton('↻ Refresh', { bg: '#2a2a3c' });
        this._refreshButton.connect('clicked', () => {
            if (this._destroyed)
                return;
            this._scheduleRefresh(0);
        });
        const spacer = new St.Bin({ x_expand: true });
        this._rangeLabel = Ui.makeLabel(RANGE_LABELS[this.timeRange] || this.timeRange,
            { size: 12, dim: true });
        const header = new St.BoxLayout({ style: 'spacing: 10px;', x_expand: true });
        header.add_child(this._liveDot);
        header.add_child(title);
        header.add_child(spacer);
        header.add_child(this._refreshButton);
        header.add_child(this._rangeLabel);
        root.add_child(header);

        // Sub-header: next refresh countdown
        this._nextLabel = Ui.makeLabel('', { size: 11, dim: true });
        root.add_child(this._nextLabel);

        // Cards container
        this._cardsBox = new St.BoxLayout({ vertical: true, style: 'spacing: 12px;', x_expand: true });
        root.add_child(this._cardsBox);

        // Footer
        this._footerLabel = Ui.makeLabel('', { size: 11, dim: true });
        root.add_child(this._footerLabel);

        for (const provider of this._enabledProviders())
            this._addCard(provider);

        this.setContent(root);
    }

    // Cinnamon desklets have no drag-resize; the user sets a pixel width in
    // settings and we apply it to the content root actor (the canonical
    // photoframe@cinnamon.org pattern: content actor .set_size(width, height)).
    // The desklet's natural width then follows the content root.
    _applyWidth() {
        if (this._destroyed || !this._root)
            return;
        const w = Math.max(200, Math.min(2000, Number(this.deskletWidth) || DEFAULT_WIDTH));
        this._root.set_size(w, -1);
    }

    _onWidthChanged() {
        this._applyWidth();
    }

    _addCard(provider) {
        const card = Ui.makeProviderCard(provider.id, provider.label);
        card.setStatus('off');
        card.renderError('waiting for first refresh…');
        this._cards.set(provider.id, card);
        this._cardsBox.add_child(card.actor);
    }

    _enabledProviders() {
        return this._providers.filter((p) => {
            if (p.id === 'claude') return this.claudeEnabled !== false;
            if (p.id === 'codex')  return this.codexEnabled !== false;
            if (p.id === 'ollama') return this.ollamaEnabled !== false;
            return true;
        });
    }

    _providerEnabled(id) {
        if (id === 'claude') return this.claudeEnabled !== false;
        if (id === 'codex')  return this.codexEnabled !== false;
        if (id === 'ollama') return this.ollamaEnabled !== false;
        return true;
    }

    // ---------------- settings callbacks (the "Enter API key" buttons) ----
    onClaudeSetKey() {
        KeyDialog.showKeyDialog({
            title: 'Enter Claude credential',
            description: 'Paste EITHER an Anthropic organization admin API key (sk-ant-admin01-…) ' +
                         'OR your Claude plan OAuth access token (from ~/.claude/.credentials.json, ' +
                         'claudeAiOauth.accessToken — the same login the claude CLI uses). ' +
                         'It is stored encrypted in the GNOME keyring and never written to disk in plaintext.',
            onSubmit: (key) => this._storeKey(ClaudeProvider, key),
        });
    }
    onCodexSetKey() {
        KeyDialog.showKeyDialog({
            title: 'Enter Codex credential',
            description: 'Paste EITHER an OpenAI organization admin API key (sk-…) ' +
                         'OR your ChatGPT plan OAuth access token (from ~/.codex/auth.json, ' +
                         'tokens.access_token — the same login the codex CLI uses for "Sign in with ChatGPT"). ' +
                         'It is stored encrypted in the GNOME keyring and never written to disk in plaintext.',
            onSubmit: (key) => this._storeKey(CodexProvider, key),
        });
    }
    onOllamaSetKey() {
        KeyDialog.showKeyDialog({
            title: 'Enter Ollama cloud API key',
            description: 'Paste your ollama.com API key. It is stored encrypted in the GNOME keyring and never written to disk in plaintext.',
            onSubmit: (key) => this._storeKey(OllamaProvider, key),
        });
    }

    _storeKey(provider, key) {
        Keyring.storeKey(provider.id, key).then((ok) => {
            if (this._destroyed) return; // dialog outlived the desklet
            this._footerLabel.set_text(ok
                ? `${provider.label} credential saved to keyring.`
                : `Failed to save ${provider.label} credential.`);
            this._scheduleRefresh(0); // refresh immediately
        });
    }

    onClaudeClearKey() { this._clearKey(ClaudeProvider); }
    onCodexClearKey()  { this._clearKey(CodexProvider); }
    onOllamaClearKey() { this._clearKey(OllamaProvider); }

    _clearKey(provider) {
        Keyring.clearKey(provider.id).then((ok) => {
            if (this._destroyed) return;
            this._footerLabel.set_text(ok
                ? `${provider.label} credential removed.`
                : `Failed to remove ${provider.label} credential.`);
        });
    }

    // ---------------- refresh loop ----------------
    _onSettingsChanged() {
        this._rangeLabel.set_text(RANGE_LABELS[this.timeRange] || this.timeRange);
        // Rebuild cards for newly enabled/disabled providers.
        this._reconcileCards();
        this._scheduleRefresh(0);
    }

    _reconcileCards() {
        const enabled = new Set(this._enabledProviders().map((p) => p.id));
        // Remove cards for disabled providers. card.destroy() removes the
        // actor from its parent AND destroys it — remove_child() alone would
        // leave a parentless-but-alive actor that GJS later disposes, and
        // Clutter 6 aborts if disposal happens while still parented.
        for (const [id, card] of this._cards) {
            if (!enabled.has(id)) {
                card.destroy();
                this._cards.delete(id);
            }
        }
        // Add cards for newly enabled providers.
        for (const provider of this._enabledProviders()) {
            if (!this._cards.has(provider.id))
                this._addCard(provider);
        }
    }

    _scheduleRefresh(delaySeconds) {
        if (this._destroyed)
            return;
        this._stopTimer();
        const delay = Math.max(0, delaySeconds !== undefined ? delaySeconds : this.refreshInterval * 60);
        this._timeoutId = Mainloop.timeout_add_seconds(delay, () => {
            this._timeoutId = null;
            if (this._destroyed)
                return false;
            this._refresh();
            return false; // we reschedule ourselves each tick
        });
        if (delaySeconds === 0)
            this._refresh();
    }

    _stopTimer() {
        if (this._timeoutId) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
    }

    _refresh() {
        if (this._destroyed || this._refreshing)
            return; // don't overlap fetches; bail if desklet is gone
        this._refreshing = true;
        this._liveDot.style = 'background-color: #f9e2af; border-radius: 50%; width: 10px; height: 10px;'; // amber = working
        if (this._refreshButton)
            this._refreshButton.set_label('↻ …');

        const range = this.timeRange || '24h';
        const providers = this._enabledProviders();

        const tasks = providers.map((provider) =>
            this._fetchOne(provider, range)
                .then((snapshot) => ({ provider, snapshot, ok: true }))
                .catch((err) => ({ provider, err, ok: false }))
        );

        Promise.all(tasks).then((results) => {
            // The desklet may have been removed/reloaded while the HTTP
            // requests were in flight. Touching actors now would operate on
            // disposed Clutter actors — guard with _destroyed.
            if (this._destroyed) {
                this._refreshing = false;
                return;
            }
            for (const result of results) {
                const { provider } = result;
                const card = this._cards.get(provider.id);
                if (!card)
                    continue;
                if (result.ok) {
                    const snapshot = result.snapshot;
                    this._snapshots.set(provider.id, snapshot);
                    card.render(snapshot, RANGE_LABELS[range] || range);
                    const bp = this._barParams(provider.id, snapshot, range);
                    if (bp.percent === null) {
                        card.hideBar();
                    } else {
                        card.showBar();
                        card.renderBar(bp.percent, card.barWidth(), bp.title);
                    }
                    card.setStatus('ok');
                } else {
                    // SURFACE the error on the card — a rejected fetch must
                    // never leave the card stuck on "waiting for first
                    // refresh…" (that is what hid the Anthropic 403).
                    card.renderError(this._errorText(provider.id, result.err));
                }
            }
            this._refreshing = false;
            this._liveDot.style = 'background-color: #a6e3a1; border-radius: 50%; width: 10px; height: 10px;'; // green = done
            if (this._refreshButton)
                this._refreshButton.set_label('↻ Refresh');
            this._footerLabel.set_text(`last refresh ${new Date().toLocaleTimeString('en-US')}`);
            this._scheduleRefresh(); // next tick
        });
    }

    _fetchOne(provider, range) {
        const key = Keyring.lookupKey(provider.id);
        if (!key)
            return Promise.reject(new Error('no credential — open settings to add one'));
        return provider.fetchUsage(range, key)
            .then((raw) => Usage.buildSnapshot(provider.id, range,
                provider.id === 'claude' ? raw : null,
                provider.id === 'codex' ? raw : null,
                provider.id === 'ollama' ? raw : null));
    }

    // Human-readable, actionable error text per provider.
    _errorText(providerId, err) {
        const status = err && err.status;
        if (status === 401 || status === 403) {
            if (providerId === 'claude')
                return 'credential rejected (403/401) — your Claude plan OAuth token was revoked or expired. Re-paste a fresh token: claudeAiOauth.accessToken from ~/.claude/.credentials.json (run `claude` once to refresh the login), or use an org admin key (sk-ant-admin01-…).';
            if (providerId === 'codex')
                return 'credential rejected (403/401) — paste your ChatGPT plan access token, or an OpenAI org admin key';
            return 'API key rejected (401/403)';
        }
        if (status === 429)
            return `rate limited — retry in ${err.retryAfterSeconds || 60}s`;
        if (err && err.message)
            return err.message.length > 90 ? err.message.slice(0, 87) + '…' : err.message;
        return 'fetch failed';
    }

    // The plan-meter bar parameters for a card. Returns { percent, title }.
    //   - Claude/Codex PLAN token: 5-hour window % (the plan's real meter);
    //     weekly % is shown on the card's Weekly line.
    //   - Ollama: the plan's REAL usage meter — monthly allowance % when
    //     /api/balance reports dollars, otherwise the session request-quota
    //     % (100 - remaining_percent). Never fabricated.
    //   - Claude/Codex ADMIN key (raw tokens): no plan meter exists → 0 and a
    //     neutral title.
    //   - When a plan meter is unavailable but the plan reports honest data
    //     (e.g. requests), hide the misleading 0% bar — show the data instead.
    _barParams(providerId, snapshot, range) {
        if (providerId === 'ollama') {
            if (snapshot.plan && snapshot.plan.allowancePct !== null && snapshot.plan.allowancePct !== undefined)
                return { percent: snapshot.plan.allowancePct, title: 'monthly allowance' };
            if (snapshot.plan && snapshot.plan.windowPct !== null && snapshot.plan.windowPct !== undefined)
                return { percent: snapshot.plan.windowPct, title: 'session quota' };
            // No quota reported: the honest data is the Reqs stat + Weekly line.
            return { percent: null, title: null };
        }
        // Token plans (Claude/Codex OAuth): 5h window %.
        if (snapshot.plan && snapshot.plan.windowPct !== null && snapshot.plan.windowPct !== undefined)
            return { percent: snapshot.plan.windowPct, title: '5-hour window' };
        // Admin-key token providers: tokens shown, no plan meter.
        return { percent: null, title: null };
    }

    // ---------------- lifecycle ----------------
    on_desklet_added_to_desktop() {
        this._scheduleRefresh(1); // first fetch shortly after placement
    }

    on_desklet_removed() {
        // Cinnamon is about to fade+destroy our actor tree. From this point
        // on, NO async callback may touch any actor — set the flag first.
        this._destroyed = true;
        this._stopTimer();
        if (this.settings) {
            this.settings.finalize();
            this.settings = null;
        }
    }

    on_desklet_reloaded() {
        // Desklet is being reloaded; timers/settings are torn down by Cinnamon.
        // Same guard as removal: in-flight HTTP/keyring callbacks must not
        // touch the (soon-to-be-destroyed) actors.
        this._destroyed = true;
        this._stopTimer();
    }
}

function main(metadata, deskletId) {
    return new AgentBillDesklet(metadata, deskletId);
}
