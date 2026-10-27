// agent-bill — UI widget library (dark-theme building blocks, dark-mode only).
// All visual pieces are constructed here so desklet.js stays declarative.
//
// Layout: one "hero column" per provider — the binding meter's % as a big
// number, its countdown, a thin bar, the other meters as small lines, and
// (Ollama) a 24-hour request sparkline. Rows with nothing real to show are
// hidden, never filled with n/a.
//
// Rules learned on Cinnamon 6.6 (see memory/cinnamon-6-gotchas.md):
//   - Clutter 6 aborts the WHOLE SHELL if an actor reaches dispose while still
//     parented → every actor is created once and updated in place (text,
//     style, set_size, show/hide); nothing is swapped.
//   - St ignores percentage lengths (incl. border-radius: 50%) and logs
//     "St-WARNING: percentage lengths not currently supported" → pixel sizes
//     only, set with actor.set_size().
//   - St.Bin CENTRES its child: a bar fill inside an St.Bin grows from the
//     middle of the track. Bars are St.BoxLayout tracks (pack from the start).
//   - letter-spacing is NOT counted in St.Label's preferred width, so a
//     letter-spaced label is allocated too little and ellipsized. Don't use it.

const St = imports.gi.St;
const Pango = imports.gi.Pango;
const Clutter = imports.gi.Clutter;

const Usage = require('./lib/usage.js');

// One dark palette for the whole desklet (Catppuccin Mocha).
const COLORS = {
    background: '#1e1e2e',   // desklet bg
    surface:    '#262637',   // column bg
    text:       '#e6e6ef',   // primary text
    textDim:    '#9a9ab0',   // secondary text
    textFaint:  '#6c6c84',   // captions
    good:       '#a6e3a1',
    warn:       '#f9e2af',
    bad:        '#f38ba8',
    track:      '#3b3b52',   // bar track, borders
    claude:     '#d97757',   // per-provider accents
    codex:      '#7aa2f7',
    ollama:     '#bb9af7',
};

const BAR_HEIGHT = 6;
const SPARK_BARS = 24;
const SPARK_HEIGHT = 28;
const SPARK_GAP = 2;
const MAX_SECONDARY = 3;
// Column padding + border, subtracted from the column width for inner rows.
const COLUMN_INSET = 2 * 14 + 2;

function colorFor(provider) {
    return COLORS[provider] || COLORS.text;
}

// Usage level colour: amber from 70 %, red from 90 % or when blocked. A
// non-'normal' server severity (Claude limits[]) is at least amber.
function levelColor(pct, opts = {}) {
    if (opts.blocked || pct >= 90)
        return COLORS.bad;
    if (pct >= 70 || (opts.severity && opts.severity !== 'normal'))
        return COLORS.warn;
    return null;
}

function makeLabel(text, opts = {}) {
    const label = new St.Label({ text, style: _labelStyle(opts) });
    // St.Label ellipsizes by default; only labels that opt in may be cut.
    label.clutter_text.ellipsize = opts.ellipsize ? Pango.EllipsizeMode.END : Pango.EllipsizeMode.NONE;
    // Long text (errors) must WRAP, not clip: the column has a fixed width.
    if (opts.wrap) {
        label.clutter_text.line_wrap = true;
        label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    }
    if (opts.expand)
        label.x_expand = true;
    return label;
}

function _labelStyle(opts) {
    return `color: ${opts.color || COLORS.text};` +
           `font-size: ${opts.size || 13}px;` +
           (opts.bold ? 'font-weight: bold;' : '');
}

// A small clickable button (used for the header Refresh button).
function makeButton(label, opts = {}) {
    return new St.Button({
        label,
        can_focus: true,
        style: `background-color: ${opts.bg || COLORS.surface}; color: ${opts.color || COLORS.text};` +
               `border: 1px solid ${COLORS.track}; border-radius: 8px; padding: 2px 10px;` +
               `font-size: ${opts.size || 13}px;`,
    });
}

// A thin pixel-sized bar: track with a fill child, filling from the left.
// setPercent() resizes the fill in place; setWidth() resizes the track.
function _makeBar() {
    // St.BoxLayout packs the fill at the start; an St.Bin track would centre
    // it and the bar would grow from the middle.
    const track = new St.BoxLayout({
        style: `background-color: ${COLORS.track}; border-radius: 3px;`,
    });
    const fill = new St.Widget({ style: `border-radius: 3px;` });
    track.add_child(fill);
    return {
        actor: track,
        _width: 0,
        setWidth(px) {
            this._width = px;
            track.set_size(px, BAR_HEIGHT);
        },
        setPercent(pct, color) {
            const c = Math.max(0, Math.min(100, pct || 0));
            fill.set_size(Math.round(this._width * c / 100), BAR_HEIGHT);
            fill.style = `background-color: ${color}; border-radius: 3px;`;
        },
    };
}

// 24 bottom-aligned bars, created once; setValues() only resizes them.
function _makeSparkline() {
    const box = new St.BoxLayout({ style: `spacing: ${SPARK_GAP}px;` });
    const bars = [];
    for (let i = 0; i < SPARK_BARS; i++) {
        // St.Widget, not St.Bin: Cinnamon's St.Bin shadows y_align with an
        // St.Align property, so Clutter.ActorAlign.END throws there.
        const bar = new St.Widget({ style: `border-radius: 1px;`, y_align: Clutter.ActorAlign.END });
        box.add_child(bar);
        bars.push(bar);
    }
    return {
        actor: box,
        _barWidth: 4,
        setWidth(px) {
            this._barWidth = Math.max(2, Math.floor((px - SPARK_GAP * (SPARK_BARS - 1)) / SPARK_BARS));
            box.set_size(-1, SPARK_HEIGHT);
        },
        setValues(values, color) {
            const vals = values.slice(-SPARK_BARS);
            const pad = SPARK_BARS - vals.length;
            const max = Math.max(1, ...vals);
            bars.forEach((bar, i) => {
                const v = i < pad ? 0 : vals[i - pad];
                const h = v > 0 ? Math.max(3, Math.round(SPARK_HEIGHT * v / max)) : 2;
                bar.set_size(this._barWidth, h);
                bar.style = `background-color: ${v > 0 ? color : COLORS.track}; border-radius: 1px;`;
            });
        },
    };
}

// One provider column. render() stores the snapshot; tick() repaints the
// countdowns from it without a refetch. A failed fetch keeps showing the
// last good snapshot, marked stale.
function makeProviderColumn(providerId, providerLabel) {
    const accent = colorFor(providerId);

    const col = new St.BoxLayout({
        vertical: true,
        style: `background-color: ${COLORS.surface}; border: 1px solid ${COLORS.track};` +
               `border-radius: 12px; padding: 14px; spacing: 6px;`,
    });

    const head = new St.BoxLayout({ style: 'spacing: 8px;' });
    // The provider name is never ellipsized (see makeLabel); the badge is the
    // part that may be cut when the column is very narrow.
    head.add_child(makeLabel(providerLabel.toUpperCase(), { size: 12, bold: true, color: accent }));
    head.add_child(new St.Bin({ x_expand: true }));
    const badge = makeLabel('', { size: 10, color: COLORS.textDim, ellipsize: true });
    badge.style += `border: 1px solid ${COLORS.track}; border-radius: 6px; padding: 0 6px;`;
    head.add_child(badge);
    col.add_child(head);

    const hero = makeLabel('—', { size: 36, bold: true });
    col.add_child(hero);
    const heroCaption = makeLabel('', { size: 11, color: COLORS.textDim, wrap: true });
    col.add_child(heroCaption);
    const bar = _makeBar();
    col.add_child(bar.actor);

    const secondary = [];
    for (let i = 0; i < MAX_SECONDARY; i++) {
        const l = makeLabel('', { size: 12, color: COLORS.textDim, wrap: true });
        col.add_child(l);
        secondary.push(l);
    }
    const spark = _makeSparkline();
    col.add_child(spark.actor);
    const caption = makeLabel('', { size: 11, color: COLORS.textFaint, wrap: true });
    col.add_child(caption);

    return {
        providerId,
        actor: col,
        _snap: null,
        _error: null,

        setWidth(px) {
            col.set_size(px, -1);
            const inner = Math.max(40, px - COLUMN_INSET);
            bar.setWidth(inner);
            spark.setWidth(inner);
            this._paint(Date.now());
        },

        render(snapshot) {
            this._snap = snapshot;
            this._error = null;
            this._paint(Date.now());
        },

        renderError(message) {
            this._error = message;
            this._paint(Date.now());
        },

        tick(nowMs) {
            this._paint(nowMs);
        },

        _paint(now) {
            const s = this._snap;
            _setVisible(badge, !!(s && s.badge));
            if (s && s.badge)
                badge.set_text(s.badge.toUpperCase());

            const heroMeter = s ? Usage.pickHero(s.meters) : null;
            const others = s ? s.meters.filter((m) => m !== heroMeter) : [];

            if (heroMeter) {
                const level = levelColor(heroMeter.pct, { blocked: s.blocked, severity: heroMeter.severity });
                hero.set_text(`${Math.round(heroMeter.pct)}%`);
                hero.style = _labelStyle({ size: 36, bold: true, color: level || COLORS.text });
                heroCaption.set_text(_meterCaption(heroMeter, now, s.blocked));
                bar.setPercent(heroMeter.pct, level || accent);
            } else if (s && (s.tokensIn !== null || s.tokensOut !== null)) {
                // Admin keys: raw tokens, no plan meter.
                hero.set_text(Usage.formatCompact((s.tokensIn || 0) + (s.tokensOut || 0)));
                hero.style = _labelStyle({ size: 36, bold: true });
                heroCaption.set_text('tokens · last 24h');
            } else {
                hero.set_text('—');
                hero.style = _labelStyle({ size: 36, bold: true, color: COLORS.textFaint });
                heroCaption.set_text('');
            }
            _setVisible(heroCaption, heroCaption.get_text() !== '');
            _setVisible(bar.actor, !!heroMeter);

            secondary.forEach((l, i) => {
                const m = others[i];
                _setVisible(l, !!m);
                if (m) {
                    const cd = m.resetAt ? Usage.formatCountdown(m.resetAt, now) : null;
                    l.set_text(`${m.label}  ${Math.round(m.pct)}%` + (cd ? ` · ${cd}` : ''));
                    const level = levelColor(m.pct, { severity: m.severity });
                    l.style = _labelStyle({ size: 12, color: level || COLORS.textDim });
                }
            });

            const hasSeries = !!(s && s.series && s.series.values.some((v) => v > 0));
            _setVisible(spark.actor, hasSeries);
            if (hasSeries)
                spark.setValues(s.series.values, accent);

            const text = this._error
                ? (s ? `⚠ stale · ${this._error}` : `⚠ ${this._error}`)
                : (s ? _volumeCaption(s) : '');
            caption.set_text(text);
            caption.style = _labelStyle({
                size: 11,
                color: this._error ? (s ? COLORS.warn : COLORS.bad) : COLORS.textFaint,
            });
            _setVisible(caption, text !== '');
        },

        // Tear down the column. remove_child() detaches only — the actor must
        // then be destroy()ed so Clutter disposes it with parent == NULL.
        // Never destroy() an actor that still has a parent: Clutter 6 aborts
        // the whole shell on that (see cinnamon-6-gotchas.md).
        destroy() {
            const parent = this.actor.get_parent();
            if (parent)
                parent.remove_child(this.actor);
            this.actor.destroy();
        },
    };
}

// "weekly · resets in 3d 6h" / "30-day · limit reached · 29d".
function _meterCaption(m, now, blocked) {
    const parts = [m.label];
    if (blocked)
        parts.push('limit reached');
    const cd = m.resetAt ? Usage.formatCountdown(m.resetAt, now) : null;
    if (cd)
        parts.push(blocked ? cd : `resets in ${cd}`);
    return parts.join(' · ');
}

// "597 req · 24h", "1.2M tok in · 340k out · $3.20" — only what was reported.
function _volumeCaption(s) {
    const parts = [];
    if (s.requests !== null)
        parts.push(`${s.requests.toLocaleString('en-US')} req`);
    if (s.tokensIn !== null && s.meters.length)
        parts.push(`${Usage.formatCompact(s.tokensIn)} in · ${Usage.formatCompact(s.tokensOut)} out`);
    if (s.costUsd !== null)
        parts.push(`$${s.costUsd.toFixed(2)}`);
    if (!parts.length)
        return '';
    return `${parts.join(' · ')} · last 24h`;
}

function _setVisible(actor, visible) {
    if (visible)
        actor.show();
    else
        actor.hide();
}

function formatClock(date) {
    const pad = (x) => String(x).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
