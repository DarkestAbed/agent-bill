// agent-bill — Cinnamon desklet.
// A dark-mode, one-stop usage dashboard for Claude (Anthropic), Codex
// (OpenAI) and Ollama (cloud). Refreshes on a configurable interval, reads
// credentials from the GNOME keyring, never blocks the UI (async libsoup3).

const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const GLib = imports.gi.GLib;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Ui = Me.imports.lib.ui;
const Keyring = Me.imports.lib.keyring;
const Usage = Me.imports.lib.usage;
const KeyDialog = Me.imports.lib.keydialog;
const ClaudeProvider = Me.imports.providers.claude.Provider;
const CodexProvider = Me.imports.providers.codex.Provider;
const OllamaProvider = Me.imports.providers.ollama.Provider;

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

class AgentBillDesklet extends Desklet.Desklet {
    constructor(metadata, deskletId) {
        super(metadata, deskletId);
        this.setHeader('Agent Bill');

        this._providers = [ClaudeProvider, CodexProvider, OllamaProvider];
        this._cards = new Map();       // providerId -> card widget
        this._snapshots = new Map();   // providerId -> last UsageSnapshot
        this._timeoutId = null;
        this._refreshing = false;

        this.settings = new Settings.DeskletSettings(this, UUID, deskletId);
        this.settings.bindProperty(Settings.BindingDirection.IN,
            'refresh-interval', 'refreshInterval', this._onSettingsChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN,
            'time-range', 'timeRange', this._onSettingsChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN,
            'claude-enabled', 'claudeEnabled', this._onSettingsChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN,
            'codex-enabled', 'codexEnabled', this._onSettingsChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN,
            'ollama-enabled', 'ollamaEnabled', this._onSettingsChanged.bind(this));

        // Defaults if schema not yet bound.
        if (!this.refreshInterval) this.refreshInterval = 5;
        if (!this.timeRange) this.timeRange = '24h';

        this._buildLayout();
    }

    // ---------------- UI ----------------
    _buildLayout() {
        const root = new St.BoxLayout({
            vertical: true,
            style: DESKLET_CSS,
            x_expand: true,
        });

        // Header row: live dot + title + range + settings hint
        this._liveDot = new St.Bin({
            style: 'background-color: #9a9ab0; border-radius: 50%; width: 10px; height: 10px;',
        });
        const title = Ui.makeLabel('Agent Bill', { size: 18, bold: true });
        const spacer = new St.Bin({ x_expand: true });
        this._rangeLabel = Ui.makeLabel(RANGE_LABELS[this.timeRange] || this.timeRange,
            { size: 12, dim: true });
        const header = new St.BoxLayout({ style: 'spacing: 10px;', x_expand: true });
        header.add_child(this._liveDot);
        header.add_child(title);
        header.add_child(spacer);
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
    onClaudeSetKey() { this._promptForKey(ClaudeProvider, 'Anthropic admin API key (sk-ant-admin01-…)'); }
    onCodexSetKey()  { this._promptForKey(CodexProvider, 'OpenAI admin API key'); }
    onOllamaSetKey() { this._promptForKey(OllamaProvider, 'Ollama cloud API key'); }

    onClaudeClearKey() { this._clearKey(ClaudeProvider); }
    onCodexClearKey()  { this._clearKey(CodexProvider); }
    onOllamaClearKey() { this._clearKey(OllamaProvider); }

    _promptForKey(provider, what) {
        KeyDialog.showKeyDialog({
            title: `Enter ${provider.label} key`,
            description: `Paste your ${what}. It is stored encrypted in the GNOME keyring and never written to disk in plaintext.`,
            onSubmit: (key) => {
                Keyring.storeKey(provider.id, key).then((ok) => {
                    this._footerLabel.set_text(ok
                        ? `${provider.label} key saved to keyring.`
                        : `Failed to save ${provider.label} key.`);
                    this._scheduleRefresh(0); // refresh immediately
                });
            },
        });
    }

    _clearKey(provider) {
        Keyring.clearKey(provider.id).then((ok) => {
            this._footerLabel.set_text(ok
                ? `${provider.label} key removed.`
                : `Failed to remove ${provider.label} key.`);
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
        // Remove cards for disabled providers.
        for (const [id, card] of this._cards) {
            if (!enabled.has(id)) {
                this._cardsBox.remove_child(card.actor);
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
        this._stopTimer();
        const delay = Math.max(0, delaySeconds !== undefined ? delaySeconds : this.refreshInterval * 60);
        this._timeoutId = Mainloop.timeout_add_seconds(delay, () => {
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
        if (this._refreshing)
            return; // don't overlap fetches
        this._refreshing = true;
        this._liveDot.style = 'background-color: #f9e2af; border-radius: 50%; width: 10px; height: 10px;'; // amber = working

        const range = this.timeRange || '24h';
        const providers = this._enabledProviders();

        const tasks = providers.map((provider) =>
            this._fetchOne(provider, range).then((snapshot) => ({ provider, snapshot }))
        );

        Promise.allSettled(tasks).then((results) => {
            for (const result of results) {
                if (result.status !== 'fulfilled')
                    continue;
                const { provider, snapshot } = result.value;
                this._snapshots.set(provider.id, snapshot);
                const card = this._cards.get(provider.id);
                if (card) {
                    card.render(snapshot, RANGE_LABELS[range] || range);
                    card.renderBar(this._windowPercent(provider.id, snapshot, range));
                    if (provider.id === 'codex' || provider.id === 'claude')
                        card.setStatus('ok');
                    else
                        card.setStatus('ok');
                }
            }
            this._refreshing = false;
            this._liveDot.style = 'background-color: #a6e3a1; border-radius: 50%; width: 10px; height: 10px;'; // green = done
            this._footerLabel.set_text(`last refresh ${Ui._formatTime ? '' : ''}${new Date().toLocaleTimeString('en-US')}`);
            this._scheduleRefresh(); // next tick
        });
    }

    _fetchOne(provider, range) {
        const key = Keyring.lookupKey(provider.id);
        if (!key) {
            const card = this._cards.get(provider.id);
            if (card) card.renderError('no API key — open settings to add one');
            return Promise.reject(new Error('no key'));
        }
        return provider.fetchUsage(range, key)
            .then((raw) => Usage.buildSnapshot(provider.id, range,
                provider.id === 'claude' ? raw : null,
                provider.id === 'codex' ? raw : null,
                provider.id === 'ollama' ? raw : null));
    }

    // The 5-hour-window bar percentage. Provider APIs don't expose a live
    // "5h limit", so we show the share of the selected range consumed in the
    // most recent 5 hours as a proxy for "how hot is the current window".
    _windowPercent(providerId, snapshot, range) {
        if (!snapshot || !snapshot.tokensIn)
            return 0;
        if (providerId === 'ollama') {
            // Ollama cloud: no 5h concept; show cost-based fill as a visual.
            return snapshot.costUsd ? Math.min(100, snapshot.costUsd * 10) : 0;
        }
        // For token providers, we don't have a hard 5h cap; approximate the
        // bar by relative magnitude against the weekly totals when present.
        if (snapshot.weekly && snapshot.weekly.tokensIn)
            return (snapshot.tokensIn / Math.max(1, snapshot.weekly.tokensIn)) * 100;
        return 0;
    }

    // ---------------- lifecycle ----------------
    on_desklet_added_to_desktop() {
        this._scheduleRefresh(1); // first fetch shortly after placement
    }

    on_desklet_removed() {
        this._stopTimer();
        if (this.settings) {
            this.settings.finalize();
            this.settings = null;
        }
    }

    on_desklet_reloaded() {
        // Desklet is being reloaded; timers/settings are torn down by Cinnamon.
        this._stopTimer();
    }
}

function main(metadata, deskletId) {
    return new AgentBillDesklet(metadata, deskletId);
}
