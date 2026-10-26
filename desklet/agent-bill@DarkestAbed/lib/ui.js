// agent-bill — UI widget library (dark-theme building blocks, dark-mode only).
// All visual pieces are constructed here so desklet.js stays declarative.

const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Pango = imports.gi.Pango;

// One dark palette for the whole desklet.
const COLORS = {
    background: '#1e1e2e',   // card / desklet bg
    surface:    '#2a2a3c',   // raised surface
    text:       '#e6e6ef',   // primary text
    textDim:    '#9a9ab0',   // secondary text
    accent:     '#89b4fa',   // accent (Claude-ish blue)
    good:       '#a6e3a1',   // in-range / ok
    warn:       '#f9e2af',   // near limit
    bad:        '#f38ba8',   // over limit / error
    track:      '#3b3b52',   // progress bar track
    claude:     '#d97757',   // brand-ish accents per provider
    codex:      '#7aa2f7',
    ollama:     '#bb9af7',
};

function colorFor(provider) {
    switch (provider) {
        case 'claude': return COLORS.claude;
        case 'codex':  return COLORS.codex;
        case 'ollama': return COLORS.ollama;
        default:       return COLORS.accent;
    }
}

function makeLabel(text, opts = {}) {
    const label = new St.Label({
        text,
        style: `color: ${opts.color || COLORS.text};` +
               `font-size: ${opts.size || 13}px;` +
               (opts.bold ? 'font-weight: bold;' : '') +
               (opts.dim ? `color: ${COLORS.textDim};` : ''),
    });
    if (opts.ellipsize)
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return label;
}

// A horizontal usage bar: a track with a filled portion and a % label.
function makeUsageBar(percent) {
    const clamped = Math.max(0, Math.min(100, percent || 0));
    const barColor = clamped >= 90 ? COLORS.bad : clamped >= 70 ? COLORS.warn : COLORS.good;

    const track = new St.Bin({
        style: `background-color: ${COLORS.track}; border-radius: 6px; height: 10px;`,
        x_expand: true,
    });
    const fill = new St.Bin({
        style: `background-color: ${barColor}; border-radius: 6px; height: 10px;`,
        width: Math.max(2, Math.round(clamped)), // % of track width via layout
    });
    // Use a fixed-percentage child inside an expanding track.
    const trackBox = new St.BoxLayout({ x_expand: true });
    const fillWrap = new St.Bin({ x_expand: false });
    fillWrap.set_width(0); // width set by fraction below via allocation
    const fillActor = new St.Bin({
        style: `background-color: ${barColor}; border-radius: 6px; height: 10px;`,
        x_expand: true,
    });
    const inner = new St.BoxLayout({ x_expand: true, style: `width: ${clamped}%;` });
    inner.add_child(fillActor);
    fillWrap.add_child(inner);
    trackBox.add_child(fillWrap);

    const pctLabel = makeLabel(`${Math.round(clamped)}%`, { size: 12, dim: true });

    const row = new St.BoxLayout({ style: 'spacing: 8px;', x_expand: true });
    row.add_child(trackBox);
    row.add_child(pctLabel);

    return { actor: row, setPercent(p) { /* updated by re-render */ } };
}

// A single line of "name: value" stats.
function makeStatLine(name, value, opts = {}) {
    const box = new St.BoxLayout({ style: 'spacing: 6px;', x_expand: true });
    const nameLbl = makeLabel(`${name}:`, { size: 12, dim: true });
    const valLbl = makeLabel(value, { size: 12, color: opts.color || COLORS.text, bold: !!opts.bold });
    box.add_child(nameLbl);
    box.add_child(valLbl);
    return { actor: box, valueLabel: valLbl };
}

// A provider card: title, status dot, 5h-window bar, weekly usage, footer.
function makeProviderCard(providerId, providerLabel) {
    const accent = colorFor(providerId);

    const card = new St.BoxLayout({
        vertical: true,
        style: `background-color: ${COLORS.surface}; border-radius: 12px;` +
               `border: 1px solid ${COLORS.track}; padding: 14px; spacing: 10px;`,
        x_expand: true,
    });

    // Header row: status dot + title + range badge
    const dot = new St.Bin({
        style: `background-color: ${COLORS.textDim}; border-radius: 50%; width: 10px; height: 10px;`,
    });
    const title = makeLabel(providerLabel, { size: 15, bold: true });
    const header = new St.BoxLayout({ style: 'spacing: 8px;' });
    const headerSpacer = new St.Bin({ x_expand: true });
    header.add_child(dot);
    header.add_child(title);
    header.add_child(headerSpacer);
    card.add_child(header);

    // 5-hour window bar section
    const fiveHrTitle = makeLabel('5-hour window', { size: 11, dim: true });
    card.add_child(fiveHrTitle);
    const bar = makeUsageBar(0);
    card.add_child(bar.actor);

    // Weekly usage line
    const weekly = makeStatLine('Weekly', '—', { dim: true });
    card.add_child(weekly.actor);

    // Stats grid: tokens in/out, requests, cost
    const stats = new St.BoxLayout({ style: 'spacing: 16px;' });
    const statIn = makeStatLine('In', '—');
    const statOut = makeStatLine('Out', '—');
    const statReq = makeStatLine('Reqs', '—');
    const statCost = makeStatLine('Cost', '—');
    stats.add_child(statIn.actor);
    stats.add_child(statOut.actor);
    stats.add_child(statReq.actor);
    stats.add_child(statCost.actor);
    card.add_child(stats);

    // Footer: last updated / error
    const footer = makeLabel('', { size: 11, dim: true });
    card.add_child(footer);

    return {
        providerId,
        actor: card,
        _dot: dot,
        _bar: bar,
        _weekly: weekly,
        _statIn: statIn,
        _statOut: statOut,
        _statReq: statReq,
        _statCost: statCost,
        _footer: footer,
        _accent: accent,

        setStatus(kind) {
            // kind: 'ok' | 'stale' | 'error' | 'off'
            const map = { ok: COLORS.good, stale: COLORS.warn, error: COLORS.bad, off: COLORS.textDim };
            this._dot.style = `background-color: ${map[kind] || COLORS.textDim}; border-radius: 50%; width: 10px; height: 10px;`;
        },

        render(snapshot, rangeLabel) {
            this.setStatus('ok');
            const fmt = (n) => (n === null || n === undefined) ? '—' : _formatTokens(n);
            this._statIn.valueLabel.set_text(fmt(snapshot.tokensIn));
            this._statOut.valueLabel.set_text(fmt(snapshot.tokensOut));
            this._statReq.valueLabel.set_text(snapshot.requests === null ? '—' : _formatNumber(snapshot.requests));
            this._statCost.valueLabel.set_text(snapshot.costUsd === null ? '—' : `$${snapshot.costUsd.toFixed(2)}`);
            if (snapshot.weekly) {
                this._weekly.valueLabel.set_text(
                    `${_formatTokens(snapshot.weekly.tokensIn)} in / ${_formatTokens(snapshot.weekly.tokensOut)} out`);
            } else {
                this._weekly.valueLabel.set_text('see plan for allowance');
            }
            // The 5h-window bar percentage is provider-specific; the desklet
            // supplies it via renderBar(). Default 0 here.
            const updated = new Date(snapshot.fetchedAt);
            this._footer.set_text(`updated ${_formatTime(updated)} · range ${rangeLabel}`);
        },

        renderBar(percent) {
            // Rebuild the bar fill at a new percentage by re-rendering the card
            // bar in place is complex; simplest correct approach: replace child.
            const newBar = makeUsageBar(percent);
            const parent = this._bar.actor.get_parent();
            const idx = parent.get_children().indexOf(this._bar.actor);
            parent.remove_child(this._bar.actor);
            parent.insert_child_at_index(newBar.actor, idx);
            this._bar = newBar;
        },

        renderError(message) {
            this.setStatus('error');
            this._statIn.valueLabel.set_text('—');
            this._statOut.valueLabel.set_text('—');
            this._statReq.valueLabel.set_text('—');
            this._statCost.valueLabel.set_text('—');
            this._weekly.valueLabel.set_text('—');
            this._footer.set_text(`⚠ ${message}`);
        },
    };
}

// ---------- formatting helpers ----------
function _formatTokens(n) {
    if (n === null || n === undefined)
        return '—';
    if (n >= 1_000_000)
        return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)
        return `${(n / 1_000).toFixed(1)}k`;
    return `${n}`;
}

function _formatNumber(n) {
    return n.toLocaleString('en-US');
}

function _formatTime(date) {
    const pad = (x) => String(x).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
