// agent-bill — Cinnamon desklet.
// A dark-mode, one-stop usage dashboard for Claude (Anthropic), Codex
// (OpenAI) and Ollama (cloud): one hero column per provider showing the
// plan meter closest to its limit, with live reset countdowns. Refreshes on
// a configurable interval and never blocks the UI (async libsoup3).
//
// Credential model (see _resolveCredential):
//   - Claude / Codex: an ORG ADMIN key in the keyring (optional) reads the
//     Admin usage APIs. Without one, the desklet reads the plan login the
//     `claude` / `codex` CLI keeps in $HOME (lib/localauth.js) on every
//     refresh, so the CLI's own token renewals are picked up automatically —
//     nothing to paste, nothing that silently expires in the keyring.
//   - Ollama: a cloud API key (Bearer, keyring) reads /api/usage + /api/balance.
//
// Resizing: Cinnamon desklets have no drag-resize; the user sets a pixel
// width in settings (stock photoframe@cinnamon.org pattern) and we apply it
// with set_size(), split evenly between the provider columns.

const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
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
const LocalAuth = require('./lib/localauth.js');
const ClaudeProvider = require('./providers/claude.js').Provider;
const CodexProvider = require('./providers/codex.js').Provider;
const OllamaProvider = require('./providers/ollama.js').Provider;

const UUID = 'agent-bill@DarkestAbed';

// Plan meters are range-independent; the volume figures (admin tokens, Ollama
// requests) always cover the last 24 hours.
const RANGE = '24h';

// Only org admin keys are kept in the keyring for Claude/Codex; plan logins
// come from $HOME. Anything else stored there (e.g. a plan token pasted by an
// older version) is ignored.
const ADMIN_KEY_PREFIX = { claude: 'sk-ant-admin01-', codex: 'sk-' };

// Countdowns repaint locally between fetches.
const TICK_SECONDS = 30;

const ROOT_PADDING = 18;
const COLUMN_SPACING = 12;

// Desklet-level dark theme (dark-mode only by design).
const DESKLET_CSS = `
    background-color: #1e1e2e;
    border-radius: 16px;
    border: 1px solid #3b3b52;
    padding: ${ROOT_PADDING}px;
    spacing: 14px;
    color: #e6e6ef;
`;

const DEFAULT_WIDTH = 600;

class AgentBillDesklet extends Desklet.Desklet {
    constructor(metadata, deskletId) {
        super(metadata, deskletId);
        this.setHeader('Agent Bill');

        this._providers = [ClaudeProvider, CodexProvider, OllamaProvider];
        this._cards = new Map();       // providerId -> column widget
        this._timeoutId = null;
        this._tickId = null;
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
            'desklet-width', 'deskletWidth', this._onWidthChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN,
            'layout', 'layout', this._onWidthChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN,
            'claude-enabled', 'claudeEnabled', this._onSettingsChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN,
            'codex-enabled', 'codexEnabled', this._onSettingsChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN,
            'ollama-enabled', 'ollamaEnabled', this._onSettingsChanged.bind(this));

        // Defaults if schema not yet bound.
        if (!this.refreshInterval) this.refreshInterval = 5;
        if (!this.deskletWidth) this.deskletWidth = DEFAULT_WIDTH;
        if (!this.layout) this.layout = 'horizontal';

        this._buildLayout();
        this._applyWidth();
    }

    // ---------------- UI ----------------
    _buildLayout() {
        const root = new St.BoxLayout({ vertical: true, style: DESKLET_CSS });
        this._root = root;

        // Header: title · spacer · last update · refresh
        const header = new St.BoxLayout({ style: 'spacing: 10px;' });
        header.add_child(Ui.makeLabel('Agent Bill', { size: 15, bold: true }));
        header.add_child(new St.Bin({ x_expand: true }));
        this._updatedLabel = Ui.makeLabel('', { size: 11, color: Ui.COLORS.textFaint });
        this._updatedLabel.y_align = Clutter.ActorAlign.CENTER;
        header.add_child(this._updatedLabel);
        this._refreshButton = Ui.makeButton('↻');
        this._refreshButton.connect('clicked', () => {
            if (this._destroyed)
                return;
            this._scheduleRefresh(0);
        });
        header.add_child(this._refreshButton);
        root.add_child(header);

        // Provider columns, side by side.
        this._cardsBox = new St.BoxLayout({ style: `spacing: ${COLUMN_SPACING}px;` });
        root.add_child(this._cardsBox);

        // Footer: transient messages only (key saved, …). Hidden when empty.
        this._footerLabel = Ui.makeLabel('', { size: 11, color: Ui.COLORS.textDim, wrap: true });
        this._footerLabel.hide();
        root.add_child(this._footerLabel);

        for (const provider of this._enabledProviders())
            this._addCard(provider);

        this.setContent(root);
    }

    // Cinnamon desklets have no drag-resize; the user sets a pixel width in
    // settings and we apply it to the content root actor (photoframe@cinnamon.org
    // pattern). Side by side, the width is split evenly between the columns in
    // pixels; stacked, every card gets the full width.
    _applyWidth() {
        if (this._destroyed || !this._root)
            return;
        const stacked = this.layout === 'vertical';
        this._cardsBox.vertical = stacked;
        const w = Math.max(240, Math.min(2000, Number(this.deskletWidth) || DEFAULT_WIDTH));
        this._root.set_size(w, -1);
        const n = stacked ? 1 : Math.max(1, this._cards.size);
        const colW = Math.floor((w - 2 * ROOT_PADDING - 2 - COLUMN_SPACING * (n - 1)) / n);
        for (const card of this._cards.values())
            card.setWidth(colW);
    }

    _onWidthChanged() {
        this._applyWidth();
    }

    _addCard(provider) {
        const card = Ui.makeProviderColumn(provider.id, provider.label);
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

    _setFooter(text) {
        this._footerLabel.set_text(text);
        if (text)
            this._footerLabel.show();
        else
            this._footerLabel.hide();
    }

    // ---------------- settings callbacks (the key buttons) ----------------
    onClaudeSetKey() {
        KeyDialog.showKeyDialog({
            title: 'Claude organization admin key (optional)',
            description: 'Claude Pro/Max needs nothing here: the desklet reads your `claude` login ' +
                         'from ~/.claude automatically. Paste an Anthropic organization admin key ' +
                         '(sk-ant-admin01-…) only to show org-wide token reports instead. ' +
                         'It is stored encrypted in the GNOME keyring.',
            onSubmit: (key) => this._storeKey(ClaudeProvider, key),
        });
    }
    onCodexSetKey() {
        KeyDialog.showKeyDialog({
            title: 'OpenAI organization admin key (optional)',
            description: 'ChatGPT plans need nothing here: the desklet reads your `codex` login ' +
                         'from ~/.codex automatically. Paste an OpenAI organization admin key ' +
                         '(sk-admin-…) only to show org-wide token reports instead. ' +
                         'It is stored encrypted in the GNOME keyring.',
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
        const prefix = ADMIN_KEY_PREFIX[provider.id];
        if (prefix && !key.startsWith(prefix)) {
            this._setFooter(`Not saved: a ${provider.label} admin key starts with ${prefix} — plan logins are read from $HOME automatically.`);
            return;
        }
        Keyring.storeKey(provider.id, key).then((ok) => {
            if (this._destroyed) return; // dialog outlived the desklet
            this._setFooter(ok
                ? `${provider.label} key saved to keyring.`
                : `Failed to save ${provider.label} key.`);
            this._scheduleRefresh(0); // refresh immediately
        });
    }

    onClaudeClearKey() { this._clearKey(ClaudeProvider); }
    onCodexClearKey()  { this._clearKey(CodexProvider); }
    onOllamaClearKey() { this._clearKey(OllamaProvider); }

    _clearKey(provider) {
        Keyring.clearKey(provider.id).then((ok) => {
            if (this._destroyed) return;
            this._setFooter(ok
                ? `${provider.label} key removed.`
                : `Failed to remove ${provider.label} key.`);
            this._scheduleRefresh(0);
        });
    }

    // ---------------- refresh loop ----------------
    _onSettingsChanged() {
        // Rebuild columns for newly enabled/disabled providers.
        this._reconcileCards();
        this._applyWidth();
        this._scheduleRefresh(0);
    }

    _reconcileCards() {
        const enabled = new Set(this._enabledProviders().map((p) => p.id));
        // card.destroy() removes the actor from its parent AND destroys it —
        // remove_child() alone would leave a parentless-but-alive actor that
        // GJS later disposes, and Clutter 6 aborts if that happens while
        // still parented.
        for (const [id, card] of this._cards) {
            if (!enabled.has(id)) {
                card.destroy();
                this._cards.delete(id);
            }
        }
        // Re-add in provider order so columns keep a stable left-to-right order.
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

    _startTick() {
        if (this._tickId)
            return;
        this._tickId = Mainloop.timeout_add_seconds(TICK_SECONDS, () => {
            if (this._destroyed) {
                this._tickId = null;
                return false;
            }
            const now = Date.now();
            for (const card of this._cards.values())
                card.tick(now);
            return true;
        });
    }

    _stopTick() {
        if (this._tickId) {
            Mainloop.source_remove(this._tickId);
            this._tickId = null;
        }
    }

    _refresh() {
        if (this._destroyed || this._refreshing)
            return; // don't overlap fetches; bail if desklet is gone
        this._refreshing = true;
        this._refreshButton.set_label('…');

        const tasks = this._enabledProviders().map((provider) =>
            this._fetchOne(provider)
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
                const card = this._cards.get(result.provider.id);
                if (!card)
                    continue;
                if (result.ok) {
                    card.render(result.snapshot);
                } else {
                    // SURFACE the error on the card (keeping the last good
                    // data, marked stale) — never leave a card silently stuck.
                    card.renderError(this._errorText(result.provider.id, result.err));
                }
            }
            this._refreshing = false;
            this._refreshButton.set_label('↻');
            this._updatedLabel.set_text(`updated ${Ui.formatClock(new Date())}`);
            this._scheduleRefresh(); // next tick
        });
    }

    // Resolve the credential for one provider, fresh on every refresh.
    // Throws (with an actionable message) when none is available.
    _resolveCredential(provider) {
        const key = Keyring.lookupKey(provider.id);
        if (provider.id === 'ollama') {
            if (!key)
                throw new Error('no Ollama API key — add one in settings');
            return { kind: 'key', key };
        }
        if (key && key.startsWith(ADMIN_KEY_PREFIX[provider.id]))
            return { kind: 'admin', key };
        const login = provider.id === 'claude' ? LocalAuth.readClaude() : LocalAuth.readCodex();
        return Object.assign({ kind: 'plan' }, login);
    }

    _fetchOne(provider) {
        let cred;
        try {
            cred = this._resolveCredential(provider);
        } catch (e) {
            return Promise.reject(e);
        }
        const badge = cred.subscriptionType || cred.planType || null;
        return provider.fetchUsage(RANGE, cred)
            .then((raw) => Usage.buildSnapshot(provider.id, raw, { badge }));
    }

    // Human-readable, actionable error text per provider.
    _errorText(providerId, err) {
        const status = err && err.status;
        if (status === 401 || status === 403) {
            if (providerId === 'claude')
                return 'login rejected — run `claude` once to renew it';
            if (providerId === 'codex')
                return 'login rejected — run `codex login`';
            return 'API key rejected — check it in settings';
        }
        if (status === 429)
            return `rate limited — retry in ${err.retryAfterSeconds || 60}s`;
        if (err && err.message)
            return err.message.length > 90 ? err.message.slice(0, 87) + '…' : err.message;
        return 'fetch failed';
    }

    // ---------------- lifecycle ----------------
    on_desklet_added_to_desktop() {
        this._scheduleRefresh(1); // first fetch shortly after placement
        this._startTick();
    }

    on_desklet_removed() {
        // Cinnamon is about to fade+destroy our actor tree. From this point
        // on, NO async callback may touch any actor — set the flag first.
        this._destroyed = true;
        this._stopTimer();
        this._stopTick();
        if (this.settings) {
            this.settings.finalize();
            this.settings = null;
        }
    }

    on_desklet_reloaded() {
        // Same guard as removal: in-flight HTTP/keyring callbacks must not
        // touch the (soon-to-be-destroyed) actors.
        this._destroyed = true;
        this._stopTimer();
        this._stopTick();
    }
}

function main(metadata, deskletId) {
    return new AgentBillDesklet(metadata, deskletId);
}
