// agent-bill — UI widget library (dark-theme building blocks, dark-mode only).
// All visual pieces are constructed here so desklet.js stays declarative.
//
// Layout/sizing rules learned on Cinnamon 6.6 (see memory/cinnamon-6-gotchas.md
// and memory/provider-data-reality.md):
//   - Clutter 6 aborts the WHOLE SHELL if an actor reaches dispose while still
//     parented → update in place, never swap/remove actors. The usage bar uses
//     FIXED PIXEL widths (Clutter actor.set_size) because St does not support
//     percentage lengths ("St-WARNING: percentage lengths not currently
//     supported") — a % CSS width is silently ignored.
//   - Desklets have no drag-resize; the desklet controls its own width/height
//     (stock photoframe@cinnamon.org applies settings width/height via
//     actor.set_size — desklet.js does this on its root actor).

const St = imports.gi.St;
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

// Track (full width) for the usage bar. The desklet passes the current pixel
// width on every setPercent() so the fill width is exact — no % CSS.
const BAR_HEIGHT = 10;

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
// The fill width is a FIXED PIXEL size (Clutter actor property, not CSS) so
// setPercent() updates the bar IN PLACE — no actor is ever removed,
// re-parented or destroyed, and no % CSS (which Cinnamon silently ignores).
// @trackPx = current allocated width of the track in pixels; pass the bar
// actor's measured width each refresh (bar.actor.get_width()).
function makeUsageBar(percent, trackPx) {
    const clamped = Math.max(0, Math.min(100, percent || 0));
    const px = Math.max(0, Math.floor((trackPx || 200) * clamped / 100));

    // Track: solid background, expands to fill available width.
    const track = new St.Bin({
        style: `background-color: ${COLORS.track}; border-radius: 6px; height: ${BAR_HEIGHT}px;`,
        x_expand: true,
    });

    // Fill: fixed pixel width = share of the track. Height matches the track.
    const fillActor = new St.Bin({
        style: `background-color: ${_barColor(clamped)}; border-radius: 6px; height: ${BAR_HEIGHT}px;`,
        x_expand: false,
    });
    fillActor.set_size(px, BAR_HEIGHT);
    const inner = new St.BoxLayout({ x_expand: false });
    inner.add_child(fillActor);
    track.set_child(inner); // St.Bin.set_child — properly unparents the old child

    const pctLabel = makeLabel(`${Math.round(clamped)}%`, { size: 12, dim: true });

    const row = new St.BoxLayout({ style: 'spacing: 8px;', x_expand: true });
    row.add_child(track);
    row.add_child(pctLabel);

    return {
        actor: row,
        _fill: fillActor,
        _pctLabel: pctLabel,
        setPercent(p, trackPx2) {
            const c = Math.max(0, Math.min(100, p || 0));
            const w = Math.max(0, Math.floor(((trackPx2 === undefined ? trackPx : trackPx2) || 200) * c / 100));
            this._fill.set_size(w, BAR_HEIGHT);
            this._fill.style = `background-color: ${_barColor(c)}; border-radius: 6px; height: ${BAR_HEIGHT}px;`;
            this._pctLabel.set_text(`${Math.round(c)}%`);
        },
    };
}

function _barColor(clamped) {
    return clamped >= 90 ? COLORS.bad : clamped >= 70 ? COLORS.warn : COLORS.good;
}

// A small clickable button (used for the header Refresh button).
function makeButton(label, opts = {}) {
    const btn = new St.Button({
        label,
        can_focus: true,
        style: `background-color: ${opts.bg || COLORS.surface}; color: ${opts.color || COLORS.text};` +
               `border: 1px solid ${COLORS.track}; border-radius: 8px; padding: 4px 12px;` +
               (opts.bold ? 'font-weight: bold;' : ''),
    });
    return btn;
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

// A provider card: title, plan meter bar, weekly usage, stats, footer.
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

    // Plan meter bar section (5-hour window for plan users; allowance % for
    // Ollama when reported). The bar title is set per-render.
    const barTitle = makeLabel('5-hour window', { size: 11, dim: true });
    card.add_child(barTitle);
    const bar = makeUsageBar(0, 200);
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

    // Footer: last updated / error / plan note
    const footer = makeLabel('', { size: 11, dim: true });
    card.add_child(footer);

    return {
        providerId,
        actor: card,
        _dot: dot,
        _barTitle: barTitle,
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
            const fmt = (n) => (n === null || n === undefined) ? 'n/a' : _formatTokens(n);
            this._statIn.valueLabel.set_text(fmt(snapshot.tokensIn));
            this._statOut.valueLabel.set_text(fmt(snapshot.tokensOut));
            this._statReq.valueLabel.set_text(snapshot.requests === null ? '—' : _formatNumber(snapshot.requests));
            this._statCost.valueLabel.set_text(snapshot.costUsd === null ? '—' : `$${snapshot.costUsd.toFixed(2)}`);

            // Weekly line: always populated for Ollama (separate 7d fetch);
            // for token providers only when the selected range is 7d.
            if (snapshot.weekly) {
                const parts = [];
                if (snapshot.weekly.tokensIn)
                    parts.push(`${_formatTokens(snapshot.weekly.tokensIn)} in / ${_formatTokens(snapshot.weekly.tokensOut)} out`);
                if (snapshot.weekly.requests !== null && snapshot.weekly.requests !== undefined)
                    parts.push(`${_formatNumber(snapshot.weekly.requests)} reqs`);
                this._weekly.valueLabel.set_text(parts.length ? parts.join(' · ') : '—');
            } else {
                this._weekly.valueLabel.set_text('select 7d range for weekly');
            }

            // Footer: updated time, range, plan weekly % (when the plan
            // reports one), and any honest caveat (e.g. Ollama legacy plan
            // has no tokens/cost).
            const updated = new Date(snapshot.fetchedAt);
            let footerText = `updated ${_formatTime(updated)} · range ${rangeLabel}`;
            if (snapshot.plan && snapshot.plan.weeklyPct !== null && snapshot.plan.weeklyPct !== undefined)
                footerText += ` · weekly ${Math.round(snapshot.plan.weeklyPct)}%`;
            const note = snapshot.plan && snapshot.plan.note;
            if (note)
                footerText += ` · ${note}`;
            this._footer.set_text(footerText);
        },

        // Current measured width of the bar row, in pixels. The desklet passes
        // this to renderBar() so the fill width is computed exactly.
        barWidth() {
            return this._bar.actor.get_width() || 200;
        },

        // @percent: plan meter fill (5h window % or Ollama allowance %).
        // @trackPx: current pixel width of the bar row (for exact fill width).
        // @title: bar label, e.g. "5-hour window" or "monthly allowance".
        renderBar(percent, trackPx, title) {
            if (title)
                this._barTitle.set_text(title);
            // Update the existing bar in place. NEVER remove/re-insert/destroy
            // the bar actor here — Clutter 6 aborts the whole shell with
            // "clutter_actor_dispose: assertion failed: (priv->parent == NULL)"
            // if an actor reaches dispose while still parented.
            this._bar.setPercent(percent, trackPx);
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

        // Tear down the card. remove_child() detaches only — the actor must
        // then be destroy()ed so GJS drops its ref and Clutter can dispose it
        // with parent == NULL. Never destroy() an actor that still has a
        // parent: Clutter 6 aborts the whole shell on that (SIGABRT in
        // clutter_actor_dispose — see cinnamon-6-gotchas.md).
        destroy() {
            const parent = this.actor.get_parent();
            if (parent)
                parent.remove_child(this.actor);
            this.actor.destroy();
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
