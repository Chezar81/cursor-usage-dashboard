import * as vscode from "vscode";

/** CSP-safe dashboard HTML; data injected via postMessage after load. */
export function getDashboardHtml(webview: vscode.Webview): string {
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource} 'unsafe-inline'`,
    `img-src ${webview.cspSource} data:`,
    `font-src ${webview.cspSource}`,
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Cursor Usage</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --muted: var(--vscode-descriptionForeground);
      --border: color-mix(in srgb, var(--fg) 14%, transparent);
      --border-strong: color-mix(in srgb, var(--fg) 22%, transparent);
      --surface: color-mix(in srgb, var(--fg) 4.5%, var(--bg));
      --surface-2: color-mix(in srgb, var(--fg) 7%, var(--bg));
      --accent: var(--vscode-button-background);
      --accent-fg: var(--vscode-button-foreground);
      --error: var(--vscode-errorForeground);
      --chart: var(--vscode-charts-blue, #3d9aed);
      --chart2: var(--vscode-charts-orange, #d4a017);
      --chart3: var(--vscode-charts-green, #3fae7c);
      --chart4: var(--vscode-charts-purple, #b07cc6);
      --warn: var(--vscode-charts-yellow, #c9a227);
      --radius: 10px;
      --ease: cubic-bezier(0.22, 1, 0.36, 1);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      color: var(--fg);
      font-family: var(--vscode-font-family);
      font-size: calc(var(--vscode-font-size) + 0.5px);
      line-height: 1.5;
      background:
        radial-gradient(1200px 520px at 8% -10%, color-mix(in srgb, var(--chart) 16%, transparent), transparent 55%),
        radial-gradient(900px 480px at 100% 0%, color-mix(in srgb, var(--chart3) 10%, transparent), transparent 50%),
        linear-gradient(180deg, color-mix(in srgb, var(--fg) 3%, var(--bg)) 0%, var(--bg) 42%);
      background-attachment: fixed;
    }

    .shell {
      max-width: 920px;
      margin: 0 auto;
      padding: 28px 24px 56px;
    }

    /* Header */
    .topbar {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      gap: 14px 18px;
      margin-bottom: 22px;
      animation: rise 0.55s var(--ease) both;
    }
    .brand {
      flex: 1;
      min-width: 180px;
    }
    .brand-kicker {
      font-size: 0.7rem;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 4px;
    }
    h1 {
      margin: 0;
      font-size: 1.65rem;
      font-weight: 650;
      letter-spacing: -0.03em;
      line-height: 1.15;
    }
    .meta {
      margin-top: 6px;
      color: var(--muted);
      font-size: 0.82rem;
      line-height: 1.45;
      white-space: pre-line;
    }
    .actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    button {
      appearance: none;
      border: none;
      font: inherit;
      cursor: pointer;
      border-radius: 8px;
      padding: 7px 13px;
      transition: transform 0.15s var(--ease), background 0.15s ease, border-color 0.15s ease;
    }
    button:active { transform: scale(0.97); }
    button.primary {
      background: var(--accent);
      color: var(--accent-fg);
    }
    button.primary:hover { filter: brightness(1.08); }
    button.ghost {
      background: transparent;
      color: var(--fg);
      border: 1px solid var(--border-strong);
    }
    button.ghost:hover {
      background: var(--surface);
      border-color: color-mix(in srgb, var(--fg) 32%, transparent);
    }

    /* Banner */
    .banner {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      padding: 12px 14px;
      margin-bottom: 18px;
      border-radius: var(--radius);
      background: color-mix(in srgb, var(--error) 12%, var(--bg));
      border: 1px solid color-mix(in srgb, var(--error) 40%, transparent);
      color: var(--fg);
      font-size: 0.9rem;
      line-height: 1.4;
      animation: rise 0.45s var(--ease) both;
    }
    .banner.info {
      background: color-mix(in srgb, var(--chart2) 12%, var(--bg));
      border-color: color-mix(in srgb, var(--chart2) 40%, transparent);
    }
    /* display:flex above would otherwise override the HTML hidden attribute */
    .banner[hidden] {
      display: none !important;
    }
    .banner::before {
      content: "";
      width: 8px;
      height: 8px;
      margin-top: 6px;
      border-radius: 50%;
      background: var(--error);
      flex-shrink: 0;
    }
    .banner.info::before {
      background: var(--chart2);
    }
    .banner-text {
      flex: 1;
      min-width: 0;
      color: var(--fg);
    }
    .pending-pill {
      display: inline-block;
      margin-left: 6px;
      padding: 1px 7px;
      border-radius: 999px;
      font-size: 0.72rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--chart2);
      background: color-mix(in srgb, var(--chart2) 14%, transparent);
      border: 1px solid color-mix(in srgb, var(--chart2) 30%, transparent);
      vertical-align: middle;
    }
    .trend-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 12px 16px;
      margin-top: 8px;
      font-size: 0.78rem;
      color: var(--muted);
    }
    .trend-legend span {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .trend-swatch {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      border: 1.5px solid var(--chart);
      background: color-mix(in srgb, var(--chart) 35%, transparent);
    }
    .trend-swatch.pending {
      border-color: var(--chart2);
      background: color-mix(in srgb, var(--chart2) 45%, transparent);
    }

    /* Sections */
    section {
      margin-bottom: 18px;
      animation: rise 0.6s var(--ease) both;
    }
    section:nth-of-type(1) { animation-delay: 0.04s; }
    section:nth-of-type(2) { animation-delay: 0.08s; }
    section:nth-of-type(3) { animation-delay: 0.12s; }
    section:nth-of-type(4) { animation-delay: 0.16s; }
    section:nth-of-type(5) { animation-delay: 0.2s; }

    .panel {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 18px 18px 16px;
      backdrop-filter: blur(8px);
    }

    .section-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
    }
    h2 {
      margin: 0;
      font-size: 0.72rem;
      font-weight: 650;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .section-sub {
      margin: 0;
      font-size: 0.8rem;
      color: var(--muted);
    }

    /* Plan hero */
    .plan-layout {
      display: grid;
      grid-template-columns: minmax(150px, 200px) 1fr;
      gap: 20px;
      align-items: center;
    }
    @media (max-width: 620px) {
      .plan-layout { grid-template-columns: 1fr; }
      .ring-wrap { justify-self: center; }
    }

    .ring-wrap {
      position: relative;
      width: 148px;
      height: 148px;
      justify-self: start;
    }
    .ring-wrap svg { width: 100%; height: 100%; transform: rotate(-90deg); }
    .ring-track {
      fill: none;
      stroke: color-mix(in srgb, var(--fg) 10%, transparent);
      stroke-width: 10;
    }
    .ring-value {
      fill: none;
      stroke: var(--chart);
      stroke-width: 10;
      stroke-linecap: round;
      stroke-dasharray: 339.3;
      stroke-dashoffset: 339.3;
      transition: stroke-dashoffset 0.9s var(--ease), stroke 0.3s ease;
    }
    .ring-center {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      pointer-events: none;
    }
    .ring-pct {
      font-size: 1.85rem;
      font-weight: 700;
      letter-spacing: -0.04em;
      font-variant-numeric: tabular-nums;
      line-height: 1;
    }
    .ring-label {
      margin-top: 6px;
      font-size: 0.7rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }

    .plan-stats {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .stat {
      padding: 12px 13px;
      border-radius: 10px;
      background: var(--surface-2);
      border: 1px solid transparent;
      min-height: 74px;
    }
    .stat-label {
      font-size: 0.68rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .stat-value {
      margin-top: 4px;
      font-size: 1.12rem;
      font-weight: 650;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
      word-break: break-word;
    }
    .stat-sub {
      margin-top: 2px;
      font-size: 0.78rem;
      color: var(--muted);
    }
    .stat-sub .stat-em {
      color: var(--fg);
      font-weight: 650;
      font-variant-numeric: tabular-nums;
    }
    .badge {
      display: inline-block;
      margin-top: 6px;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 0.72rem;
      background: color-mix(in srgb, var(--chart3) 18%, transparent);
      color: color-mix(in srgb, var(--chart3) 70%, var(--fg));
      border: 1px solid color-mix(in srgb, var(--chart3) 30%, transparent);
    }

    /* Context usage */
    .ctx-top {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }
    .ctx-pct {
      font-size: 0.95rem;
      font-weight: 650;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
    }
    .ctx-total {
      font-size: 0.82rem;
      color: var(--muted);
      font-variant-numeric: tabular-nums;
    }
    .ctx-bar {
      display: flex;
      height: 10px;
      border-radius: 999px;
      overflow: hidden;
      background: color-mix(in srgb, var(--fg) 10%, transparent);
      margin-bottom: 14px;
    }
    .ctx-seg {
      height: 100%;
      min-width: 0;
      transition: flex-grow 0.75s var(--ease);
    }
    .ctx-seg:hover { filter: brightness(1.12); }
    .ctx-legend {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .ctx-row {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 0.88rem;
    }
    .ctx-swatch {
      width: 10px;
      height: 10px;
      border-radius: 2px;
      flex-shrink: 0;
    }
    .ctx-label {
      flex: 1;
      min-width: 0;
      color: var(--muted);
    }
    .ctx-tokens {
      font-variant-numeric: tabular-nums;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    .linkish {
      background: none;
      border: none;
      padding: 0;
      color: var(--chart);
      font: inherit;
      font-size: 0.8rem;
      cursor: pointer;
      text-decoration: none;
    }
    .linkish:hover { text-decoration: underline; }

    /* Models */
    .model-list { display: flex; flex-direction: column; gap: 10px; }
    .model-row {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(120px, 1fr) auto;
      gap: 12px 16px;
      align-items: center;
      padding: 11px 12px;
      border-radius: 10px;
      background: var(--surface-2);
      transition: background 0.15s ease;
    }
    .model-row:hover { background: color-mix(in srgb, var(--fg) 9%, var(--bg)); }
    @media (max-width: 640px) {
      .model-row {
        grid-template-columns: 1fr auto;
        grid-template-rows: auto auto;
      }
      .model-bar-cell { grid-column: 1 / -1; order: 3; }
    }
    .model-name {
      font-weight: 600;
      font-size: 0.92rem;
      letter-spacing: -0.01em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .model-pair {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }
    .model-line {
      display: flex;
      align-items: baseline;
      gap: 6px;
      min-width: 0;
    }
    .model-label {
      flex: 0 0 auto;
      font-size: 0.68rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .model-value {
      font-weight: 600;
      font-size: 0.9rem;
      letter-spacing: -0.01em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    .model-meta {
      margin-top: 2px;
      font-size: 0.75rem;
      color: var(--muted);
      font-variant-numeric: tabular-nums;
    }
    .bar-track {
      height: 7px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--fg) 10%, transparent);
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      width: 0%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--chart3), color-mix(in srgb, var(--chart) 70%, var(--chart3)));
      transition: width 0.75s var(--ease);
    }
    .model-cost {
      font-weight: 650;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.02em;
      white-space: nowrap;
    }

    /* Trend */
    .seg {
      display: inline-flex;
      padding: 3px;
      border-radius: 9px;
      background: var(--surface-2);
      border: 1px solid var(--border);
      gap: 2px;
    }
    .seg button {
      padding: 5px 11px;
      border-radius: 7px;
      background: transparent;
      color: var(--muted);
      border: none;
      font-size: 0.82rem;
    }
    .seg button.active {
      background: color-mix(in srgb, var(--fg) 10%, var(--bg));
      color: var(--fg);
      font-weight: 600;
    }
    .chart-wrap {
      position: relative;
      height: 210px;
      margin-top: 4px;
      border-radius: 10px;
      background:
        linear-gradient(180deg, color-mix(in srgb, var(--chart) 5%, transparent), transparent 55%);
    }
    canvas { width: 100%; height: 100%; display: block; }

    /* Workspaces */
    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      font-size: 0.88rem;
    }
    th, td {
      text-align: left;
      padding: 10px 8px;
      border-bottom: 1px solid var(--border);
    }
    th {
      color: var(--muted);
      font-weight: 600;
      font-size: 0.68rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      border-bottom-color: var(--border-strong);
    }
    tr:last-child td { border-bottom: none; }
    td.num, th.num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .ws-name {
      font-weight: 600;
      letter-spacing: -0.01em;
    }

    .empty {
      margin: 4px 0 0;
      padding: 18px 14px;
      text-align: center;
      color: var(--muted);
      font-size: 0.9rem;
      border-radius: 10px;
      border: 1px dashed var(--border-strong);
      background: color-mix(in srgb, var(--fg) 2.5%, transparent);
    }

    @keyframes rise {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-kicker">Personal account</div>
        <h1>Usage Dashboard</h1>
        <div class="meta" id="fetched-at">Loading…</div>
      </div>
      <div class="actions">
        <div class="seg" role="group" aria-label="Currency">
          <button type="button" id="cur-usd" data-currency="USD" class="active">$</button>
          <button type="button" id="cur-eur" data-currency="EUR">€</button>
        </div>
        <button id="btn-token" class="ghost" type="button" title="Usually unnecessary — uses your Cursor login automatically">Auth</button>
        <button id="btn-refresh" class="primary" type="button">Refresh</button>
      </div>
    </header>

    <div id="banner" class="banner" hidden><div class="banner-text" id="banner-text"></div></div>

    <section>
      <div class="panel">
        <div class="section-head">
          <h2>Plan</h2>
          <p class="section-sub" id="plan-email"></p>
        </div>
        <div class="plan-layout">
          <div class="ring-wrap" id="ring-wrap" aria-hidden="true">
            <svg viewBox="0 0 120 120">
              <circle class="ring-track" cx="60" cy="60" r="54"></circle>
              <circle class="ring-value" id="ring-value" cx="60" cy="60" r="54"></circle>
            </svg>
            <div class="ring-center">
              <div class="ring-pct" id="ring-pct">—</div>
              <div class="ring-label" id="ring-label">included</div>
            </div>
          </div>
          <div class="plan-stats" id="plan-stats"></div>
        </div>
      </div>
    </section>

    <section>
      <div class="panel">
        <div class="section-head">
          <h2>Models</h2>
          <p class="section-sub" id="models-sub">Intent vs actual when they differ</p>
        </div>
        <div id="models"></div>
      </div>
    </section>

    <section>
      <div class="panel">
        <div class="section-head">
          <h2>Context Usage</h2>
          <div style="display:flex;align-items:center;gap:12px">
            <p class="section-sub" id="context-sub">Estimated · local</p>
            <button type="button" class="linkish" id="btn-context-report">View Report</button>
          </div>
        </div>
        <div id="context-usage"></div>
      </div>
    </section>

    <section>
      <div class="panel">
        <div class="section-head">
          <h2>Trend</h2>
          <div class="seg" role="tablist" aria-label="Trend metric">
            <button type="button" class="active" data-metric="tokens">Tokens</button>
            <button type="button" data-metric="spend">Spend</button>
          </div>
        </div>
        <div class="chart-wrap"><canvas id="trend"></canvas></div>
        <div class="trend-legend" id="trend-legend" hidden>
          <span><i class="trend-swatch" aria-hidden="true"></i> API tokens / spend</span>
          <span><i class="trend-swatch pending" aria-hidden="true"></i> Local estimate (pending API)</span>
        </div>
        <p class="section-sub" id="trend-note" style="margin-top:10px"></p>
      </div>
    </section>

    <section>
      <div class="panel">
        <div class="section-head">
          <h2>Workspaces</h2>
          <p class="section-sub">Estimated · local</p>
        </div>
        <p class="section-sub" style="margin:-6px 0 12px">
          Local chats appear immediately with a rough transcript token estimate (~); billed totals replace them when Cursor’s usage API lists matching conversation IDs.
        </p>
        <div id="workspaces"></div>
      </div>
    </section>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let data = null;
    let metric = "tokens";
    let prefs = { currency: "USD", eurPerUsd: 0.92 };
    const RING_C = 2 * Math.PI * 54;

    document.getElementById("btn-refresh").addEventListener("click", () => {
      vscode.postMessage({ type: "refresh" });
    });
    document.getElementById("btn-token").addEventListener("click", () => {
      vscode.postMessage({ type: "setToken" });
    });
    document.getElementById("btn-context-report").addEventListener("click", () => {
      vscode.postMessage({ type: "viewContextReport" });
    });
    document.querySelectorAll("[data-metric]").forEach((btn) => {
      btn.addEventListener("click", () => {
        metric = btn.getAttribute("data-metric");
        document.querySelectorAll("[data-metric]").forEach((b) =>
          b.classList.toggle("active", b === btn)
        );
        drawTrend();
      });
    });
    document.querySelectorAll("[data-currency]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const currency = btn.getAttribute("data-currency") === "EUR" ? "EUR" : "USD";
        prefs = { ...prefs, currency };
        syncCurrencyToggle();
        if (data) render();
        vscode.postMessage({ type: "setCurrency", currency });
      });
    });

    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (msg?.prefs) {
        prefs = {
          currency: msg.prefs.currency === "EUR" ? "EUR" : "USD",
          eurPerUsd:
            typeof msg.prefs.eurPerUsd === "number" && msg.prefs.eurPerUsd > 0
              ? msg.prefs.eurPerUsd
              : 0.92,
        };
        syncCurrencyToggle();
      }
      if (msg?.type === "data") {
        data = msg.payload;
        render();
      } else if (msg?.type === "prefs" && data) {
        render();
      }
    });

    function syncCurrencyToggle() {
      document.querySelectorAll("[data-currency]").forEach((b) => {
        b.classList.toggle("active", b.getAttribute("data-currency") === prefs.currency);
      });
    }

    function fmtTokens(n) {
      if (n == null || !Number.isFinite(n)) return "—";
      if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
      if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
      return String(Math.round(n));
    }
    /** Prefix ~ for local transcript estimates (not billed API tokens). */
    function fmtEstTokens(n) {
      if (n == null || !Number.isFinite(n) || n <= 0) return "—";
      return "~" + fmtTokens(n);
    }
    /** Cursor amounts are USD cents; convert for display. */
    function fmtCents(c) {
      if (c == null || !Number.isFinite(c)) return "—";
      const usd = c / 100;
      if (prefs.currency === "EUR") {
        return "€" + (usd * prefs.eurPerUsd).toFixed(2);
      }
      return "$" + usd.toFixed(2);
    }
    function moneySymbol() {
      return prefs.currency === "EUR" ? "€" : "$";
    }
    function toDisplayAmount(usdAmount) {
      return prefs.currency === "EUR" ? usdAmount * prefs.eurPerUsd : usdAmount;
    }
    function fmtPct(p) {
      if (p == null || !Number.isFinite(p)) return "—";
      return p.toFixed(1) + "%";
    }
    function fmtDate(s) {
      if (!s) return "—";
      const d = new Date(s);
      return Number.isFinite(d.getTime()) ? d.toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
      }) : s;
    }
    /** Relative age for API lag (e.g. "15h ago"). */
    function fmtAgo(s) {
      if (!s) return "";
      const d = new Date(s);
      if (!Number.isFinite(d.getTime())) return "";
      const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
      if (mins < 1) return "just now";
      if (mins < 60) return mins + "m ago";
      const hrs = Math.round(mins / 60);
      if (hrs < 48) return hrs + "h ago";
      return Math.round(hrs / 24) + "d ago";
    }
    function fmtDay(s) {
      if (!s) return "—";
      const d = new Date(s);
      return Number.isFinite(d.getTime())
        ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : s;
    }
    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }
    function cssVar(name, fallback) {
      const v = getComputedStyle(document.body).getPropertyValue(name).trim();
      return v || fallback;
    }

    function render() {
      if (!data) return;
      try {
        const banner = document.getElementById("banner");
        const bannerText = document.getElementById("banner-text");
        const errMsg = String(data.error || "").trim() ||
          (data.authError
            ? "Session missing or expired. Sign in to Cursor again, then refresh."
            : "");
        const trend = data.trend || {};
        const windowName =
          trend.rangeKind === "weekly" ? "weekly window" : "billing window";
        const lastApiWhen = trend.lastEventAt
          ? fmtDate(trend.lastEventAt) + " (" + fmtAgo(trend.lastEventAt) + ")"
          : "";
        const lastApiLabel = trend.lastEventBeforeWindow && lastApiWhen
          ? "Newest API event is before this " + windowName + ": " + lastApiWhen
          : lastApiWhen
            ? "Newest usage event " + lastApiWhen
            : "No usage events in this " + windowName + " yet";
        const lastApiClause = trend.lastEventBeforeWindow && lastApiWhen
          ? "newest API event is before this " + windowName + " (" + lastApiWhen + ")"
          : lastApiWhen
            ? "newest event " + lastApiWhen
            : "none in this " + windowName;
        const staleMsg =
          !errMsg && trend.eventsStale
            ? trend.pendingConversations > 0
              ? "Token events from Cursor are lagging — " +
                lastApiClause +
                ". Showing " +
                trend.pendingConversations +
                " local chat" +
                (trend.pendingConversations === 1 ? "" : "s") +
                " with rough transcript estimates (~) — billed totals replace them when the API catches up."
              : "Included usage is up, but Cursor has not published token events for this window yet — " +
                lastApiClause +
                ". Trend tokens may appear later."
            : "";
        if (errMsg) {
          banner.hidden = false;
          banner.classList.remove("info");
          bannerText.textContent = errMsg;
        } else if (staleMsg) {
          banner.hidden = false;
          banner.classList.add("info");
          bannerText.textContent = staleMsg;
        } else {
          banner.hidden = true;
          banner.classList.remove("info");
          bannerText.textContent = "";
        }
        const metaLines = [];
        if (data.fetchedAt) {
          metaLines.push("Dashboard refreshed " + fmtDate(data.fetchedAt));
        }
        metaLines.push(lastApiLabel);
        if (prefs.currency === "EUR") {
          metaLines.push("EUR @ " + prefs.eurPerUsd.toFixed(2) + "/USD");
        }
        // \\n so the outer template literal emits a JS escape, not a real newline.
        document.getElementById("fetched-at").textContent = metaLines.join("\\n");

        renderPlan();
        renderModels();
        renderContextUsage();
        drawTrend();
        renderWorkspaces();
      } catch (err) {
        const banner = document.getElementById("banner");
        const bannerText = document.getElementById("banner-text");
        if (banner && bannerText) {
          banner.hidden = false;
          banner.classList.remove("info");
          bannerText.textContent =
            "Dashboard render failed: " +
            (err && err.message ? err.message : String(err));
        }
        const meta = document.getElementById("fetched-at");
        if (meta) {
          meta.textContent = data.fetchedAt
            ? "Dashboard refreshed " + fmtDate(data.fetchedAt)
            : "Render error";
        }
      }
    }

    function renderPlan() {
      const p = data.plan || {};
      document.getElementById("plan-email").textContent = p.email || "";
      const ringLabel = document.getElementById("ring-label");
      if (ringLabel) {
        ringLabel.textContent = p.includedLabel
          ? String(p.includedLabel).toLowerCase().replace(" usage", "")
          : "included";
      }

      const pct = p.includedPercentUsed;
      const ring = document.getElementById("ring-value");
      const ringPct = document.getElementById("ring-pct");
      if (pct != null && Number.isFinite(pct)) {
        const clamped = Math.max(0, Math.min(100, pct));
        ring.style.strokeDasharray = String(RING_C);
        ring.style.strokeDashoffset = String(RING_C * (1 - clamped / 100));
        ringPct.textContent = clamped.toFixed(0) + "%";
        ring.style.stroke =
          clamped >= 90 ? cssVar("--warn", "#c9a227") :
          clamped >= 75 ? cssVar("--chart2", "#d4a017") :
          cssVar("--chart", "#3d9aed");
      } else {
        ring.style.strokeDashoffset = String(RING_C);
        ringPct.textContent = "—";
      }

      const onDemandText = fmtCents(p.onDemandUsedCents ?? 0);
      const onDemandSub = p.prepaidBilling
        ? "used this month"
        : p.onDemandEnabled
          ? "used this month · on-demand on"
          : "used this month · additional usage not set";
      const creditsCents = p.creditsAvailableCents;
      const creditsSub =
        creditsCents != null && Number.isFinite(creditsCents)
          ? '<div class="stat-sub">Credits available · <span class="stat-em">' +
            fmtCents(creditsCents) +
            "</span></div>"
          : "";

      document.getElementById("plan-stats").innerHTML =
        '<div class="stat"><div class="stat-label">Plan</div>' +
        '<div class="stat-value">' + escapeHtml(p.membershipType || "—") + "</div>" +
        (p.displayMessage
          ? '<div class="stat-sub">' + escapeHtml(p.displayMessage) + "</div>"
          : "") +
        "</div>" +
        '<div class="stat"><div class="stat-label">Account balance</div>' +
        '<div class="stat-value">' + onDemandText + "</div>" +
        '<div class="stat-sub">' + onDemandSub + "</div>" +
        creditsSub +
        "</div>" +
        '<div class="stat"><div class="stat-label">' +
        escapeHtml(p.includedLabel || "Included usage") +
        "</div>" +
        '<div class="stat-value">' + fmtPct(p.includedPercentUsed) + "</div>" +
        '<div class="stat-sub">Resets ' + fmtDay(p.nextReset || p.cycleEnd) + "</div></div>" +
        '<div class="stat"><div class="stat-label">Cycle window</div>' +
        '<div class="stat-value" style="font-size:1rem">' +
        fmtDay(p.cycleStart) + " → " + fmtDay(p.cycleEnd) +
        "</div></div>";
    }

    function renderModels() {
      const el = document.getElementById("models");
      const models = data.models || [];
      const totals = data.totals || {};
      const apiRows = models.filter((m) => !m.localPending);
      const pendingRows = models.filter((m) => m.localPending);
      const pendingChats = pendingRows.reduce(
        (s, m) => s + (m.pendingConversations || 0),
        0
      );

      if (!models.length) {
        document.getElementById("models-sub").textContent = "";
        el.innerHTML = '<p class="empty">No model usage in this period yet.</p>';
        return;
      }

      const subParts = [];
      if (apiRows.length) {
        subParts.push(apiRows.length + " API");
      }
      if (pendingChats > 0) {
        subParts.push(
          pendingChats +
            " local chat" +
            (pendingChats === 1 ? "" : "s") +
            " pending"
        );
      }
      if (apiRows.length) {
        subParts.push(fmtCents(totals.costCents) + " total");
        subParts.push("intent vs actual when they differ");
      } else {
        subParts.push("local labels first — matched when API publishes events");
      }
      document.getElementById("models-sub").textContent = subParts.join(" · ");

      const maxTokens = Math.max(
        ...apiRows.map((m) => m.totalTokens),
        ...pendingRows.map((m) => m.totalTokens || 0),
        1
      );
      const colors = ["var(--chart3)", "var(--chart)", "var(--chart2)", "var(--chart4)"];
      const pendingColor = "var(--chart2)";

      el.innerHTML =
        '<div class="model-list">' +
        models
          .map((m, i) => {
            const intent = m.modelIntent || m.model || "unknown";
            const actual = m.model || m.modelIntent || "unknown";
            const same = intent === actual;
            const title = same
              ? '<div class="model-name">' +
                escapeHtml(intent) +
                (m.localPending
                  ? "<span class='pending-pill' title='Local model from AI tracking / transcripts; waiting for Cursor usage API'>Pending API</span>"
                  : "") +
                "</div>"
              : '<div class="model-pair">' +
                '<div class="model-line"><span class="model-label">Intent</span>' +
                '<span class="model-value">' + escapeHtml(intent) + "</span></div>" +
                '<div class="model-line"><span class="model-label">Actual</span>' +
                '<span class="model-value">' + escapeHtml(actual) + "</span></div>" +
                "</div>";

            if (m.localPending) {
              const chats = m.pendingConversations || 0;
              const est = m.totalTokens || 0;
              const pct = (est / maxTokens) * 100;
              return (
                '<div class="model-row">' +
                "<div>" + title +
                '<div class="model-meta">' +
                chats +
                " local chat" +
                (chats === 1 ? "" : "s") +
                " · " +
                (est > 0
                  ? fmtEstTokens(est) + " from transcript (rough)"
                  : "estimate when transcript readable") +
                "</div></div>" +
                '<div class="model-bar-cell"><div class="bar-track">' +
                '<div class="bar-fill" style="width:' + pct + "%;background:" + pendingColor +
                '"></div></div></div>' +
                '<div class="model-cost" title="Cost unavailable until API events arrive">—</div>' +
                "</div>"
              );
            }

            const pct = (m.totalTokens / maxTokens) * 100;
            const color = colors[i % colors.length];
            return (
              '<div class="model-row">' +
              "<div>" + title +
              '<div class="model-meta">in ' + fmtTokens(m.inputTokens) +
              " · out " + fmtTokens(m.outputTokens) +
              " · cache " + fmtTokens(m.cacheReadTokens) +
              "</div></div>" +
              '<div class="model-bar-cell"><div class="bar-track">' +
              '<div class="bar-fill" style="width:' + pct + "%;background:" + color +
              '"></div></div></div>' +
              '<div class="model-cost">' + fmtCents(m.costCents) + "</div>" +
              "</div>"
            );
          })
          .join("") +
        "</div>";

      // Retrigger bar width transitions after paint
      requestAnimationFrame(() => {
        el.querySelectorAll(".bar-fill").forEach((b) => {
          const w = b.style.width;
          b.style.width = "0%";
          requestAnimationFrame(() => { b.style.width = w; });
        });
      });
    }

    function renderContextUsage() {
      const el = document.getElementById("context-usage");
      const sub = document.getElementById("context-sub");
      const ctx = data.contextUsage;
      if (!ctx || !ctx.categories || !ctx.categories.length) {
        sub.textContent = "Estimated · local";
        el.innerHTML =
          '<p class="empty">No local context estimate yet. Open a workspace and refresh.</p>';
        return;
      }

      const pct = Math.max(0, Math.min(100, Number(ctx.percentFull) || 0));
      const used = Number(ctx.usedTokens) || 0;
      const window = Number(ctx.windowTokens) || 256000;
      sub.textContent = ctx.estimated ? "Estimated · local" : "Live";

      const cats = ctx.categories.filter((c) => (c.tokens || 0) > 0);
      const barSegs =
        cats.length === 0
          ? ""
          : cats
              .map((c) => {
                const share = used > 0 ? (c.tokens / window) * 100 : 0;
                return (
                  '<div class="ctx-seg" title="' +
                  escapeHtml(c.label) +
                  ": " +
                  fmtTokens(c.tokens) +
                  '" style="flex:' +
                  Math.max(share, 0.15) +
                  " 0 0;background:" +
                  escapeHtml(c.color || "var(--chart)") +
                  '"></div>'
                );
              })
              .join("") +
            '<div class="ctx-seg" style="flex:' +
            Math.max(100 - pct, 0.01) +
            ' 0 0;background:transparent"></div>';

      const rows = (ctx.categories || [])
        .map(
          (c) =>
            '<div class="ctx-row">' +
            '<span class="ctx-swatch" style="background:' +
            escapeHtml(c.color || "var(--muted)") +
            '"></span>' +
            '<span class="ctx-label">' +
            escapeHtml(c.label) +
            "</span>" +
            '<span class="ctx-tokens">' +
            fmtTokens(c.tokens) +
            "</span></div>"
        )
        .join("");

      const approx = ctx.estimated ? "~" : "";
      el.innerHTML =
        '<div class="ctx-top">' +
        '<div class="ctx-pct">' +
        Math.round(pct) +
        "% Full</div>" +
        '<div class="ctx-total">' +
        approx +
        fmtTokens(used) +
        " / " +
        fmtTokens(window) +
        " Tokens</div></div>" +
        '<div class="ctx-bar" role="img" aria-label="Context usage ' +
        Math.round(pct) +
        '%">' +
        barSegs +
        "</div>" +
        '<div class="ctx-legend">' +
        rows +
        "</div>" +
        (ctx.note
          ? '<p class="section-sub" style="margin-top:12px">' +
            escapeHtml(ctx.note) +
            "</p>"
          : "");
    }

    /** YYYY-MM-DD → German short day label, e.g. 24.10. */
    function fmtTrendDay(isoDay) {
      if (!isoDay || typeof isoDay !== "string") return "—";
      const parts = isoDay.split("-");
      if (parts.length < 3) return isoDay;
      return parts[2] + "." + parts[1] + ".";
    }

    function drawTrend() {
      const canvas = document.getElementById("trend");
      const note = document.getElementById("trend-note");
      const legend = document.getElementById("trend-legend");
      const daily = (data && data.daily) || [];
      const trend = (data && data.trend) || {};
      note.textContent =
        trend.note ||
        (daily.length ? daily.length + " days in window" : "No daily activity yet.");

      const ctx = canvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);
      if (!daily.length) return;

      const apiValues = daily.map((d) =>
        metric === "spend" ? toDisplayAmount(d.costCents / 100) : d.tokens
      );
      // Tokens mode: plot local transcript estimates on the same token scale.
      // Spend mode: keep chat counts (no local cost estimate).
      const localValues = daily.map((d) =>
        metric === "spend"
          ? d.localPendingConversations || 0
          : d.localEstimatedTokens || 0
      );
      const maxApi = Math.max(...apiValues, 0);
      const maxLocal = Math.max(...localValues, 0);
      const sharedTokenScale = metric !== "spend";
      const apiMax = sharedTokenScale
        ? Math.max(maxApi, maxLocal, 1)
        : Math.max(maxApi, 0.01);
      const localMax = sharedTokenScale
        ? apiMax
        : Math.max(maxLocal, 1);

      const pad = { t: 18, r: 52, b: 30, l: 48 };
      const plotW = w - pad.l - pad.r;
      const plotH = h - pad.t - pad.b;
      const muted = cssVar("--muted", "#888");
      const apiColor = cssVar("--chart", "#3d9aed");
      const localColor = cssVar("--chart2", "#d4a017");
      const border = cssVar("--border", "rgba(128,128,128,0.2)");
      const font =
        "11px " + (cssVar("--vscode-font-family", "sans-serif") || "sans-serif");

      if (legend) {
        legend.hidden = false;
        legend.innerHTML =
          '<span><i class="trend-swatch" aria-hidden="true"></i> API ' +
          (metric === "spend" ? "spend" : "tokens") +
          "</span>" +
          '<span><i class="trend-swatch pending" aria-hidden="true"></i> ' +
          (metric === "spend"
            ? "Local chats pending"
            : "Local est. tokens (pending API)") +
          "</span>";
      }

      // Grid
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      for (let g = 0; g <= 3; g++) {
        const y = pad.t + (plotH * g) / 3;
        ctx.beginPath();
        ctx.moveTo(pad.l, y);
        ctx.lineTo(pad.l + plotW, y);
        ctx.stroke();
      }

      // Inset X for few days so 2 points are not glued to the edges.
      const n = daily.length;
      const xAt = (i) => {
        if (n === 1) return pad.l + plotW / 2;
        if (n <= 4) {
          const inset = plotW * 0.18;
          return pad.l + inset + (i / (n - 1)) * (plotW - 2 * inset);
        }
        return pad.l + (i / (n - 1)) * plotW;
      };
      const yApi = (v) => pad.t + plotH - (v / apiMax) * plotH;
      const yLocal = (v) => pad.t + plotH - (v / localMax) * plotH;

      function drawSeries(values, yFn, color, opts) {
        const pts = values.map((v, i) => ({ x: xAt(i), y: yFn(v), v: v }));
        if (opts.fill) {
          const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + plotH);
          grad.addColorStop(0, color);
          grad.addColorStop(1, "transparent");
          ctx.beginPath();
          pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
          ctx.lineTo(pts[pts.length - 1].x, pad.t + plotH);
          ctx.lineTo(pts[0].x, pad.t + plotH);
          ctx.closePath();
          ctx.globalAlpha = 0.14;
          ctx.fillStyle = grad;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = opts.width || 2.25;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        if (opts.dashed) ctx.setLineDash([5, 4]);
        ctx.beginPath();
        pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.stroke();
        ctx.setLineDash([]);
        pts.forEach((p) => {
          if (opts.skipZeroDots && p.v <= 0 && n > 6) return;
          ctx.beginPath();
          ctx.fillStyle = cssVar("--bg", "#1e1e1e");
          ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.75;
          ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2);
          ctx.stroke();
        });
        return pts;
      }

      // API line first (under), then local pending on top.
      const apiPts = drawSeries(apiValues, yApi, apiColor, {
        fill: maxApi > 0,
        skipZeroDots: maxApi > 0,
      });
      const localPts = drawSeries(localValues, yLocal, localColor, {
        fill: maxLocal > 0,
        dashed: maxApi > 0,
        width: 2.35,
      });

      // Point labels when few days (keeps 2-day weeks readable)
      if (n <= 5) {
        ctx.font = "10px " + (cssVar("--vscode-font-family", "sans-serif") || "sans-serif");
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        localPts.forEach((p) => {
          if (p.v <= 0) return;
          ctx.fillStyle = localColor;
          const label =
            metric === "spend" ? String(p.v) : "~" + fmtTokens(p.v);
          ctx.fillText(label, p.x, p.y - 6);
        });
        if (maxApi > 0) {
          apiPts.forEach((p) => {
            if (p.v <= 0) return;
            ctx.fillStyle = apiColor;
            const label =
              metric === "spend" ? moneySymbol() + p.v.toFixed(2) : fmtTokens(p.v);
            ctx.fillText(label, p.x, p.y - 6);
          });
        }
      }

      // Left axis = API (or shared tokens); right = local estimate / chats
      ctx.fillStyle = muted;
      ctx.font = font;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      const apiTopLabel =
        metric === "spend" ? moneySymbol() + apiMax.toFixed(2) : fmtTokens(apiMax);
      ctx.fillText(apiTopLabel, pad.l - 8, pad.t);
      ctx.fillText("0", pad.l - 8, pad.t + plotH);
      ctx.textAlign = "left";
      ctx.fillStyle = localColor;
      ctx.fillText(
        metric === "spend"
          ? String(localMax) + " chats"
          : "~" + fmtTokens(localMax),
        pad.l + plotW + 8,
        pad.t
      );
      ctx.fillStyle = muted;
      ctx.fillText("0", pad.l + plotW + 8, pad.t + plotH);

      // X labels — label every day when the window is short
      ctx.fillStyle = muted;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      const labelEvery = n <= 8;
      daily.forEach((d, i) => {
        if (!labelEvery && i !== 0 && i !== n - 1 && i !== Math.floor(n / 2)) {
          return;
        }
        ctx.fillText(fmtTrendDay(d.date), xAt(i), h - 10);
      });
    }

    function renderWorkspaces() {
      const el = document.getElementById("workspaces");
      const list = data.workspaces || [];
      if (!list.length) {
        el.innerHTML =
          '<p class="empty">No workspace matches yet. Usage is mapped via local agent chats (conversation → project) and active-folder tracking — refresh after chats exist on this machine.</p>';
        return;
      }
      el.innerHTML =
        "<table><thead><tr><th>Workspace</th><th class='num'>Tokens</th><th class='num'>Cost</th><th class='num'>Last active</th></tr></thead><tbody>" +
        list
          .map(
            (w) =>
              "<tr><td><span class='ws-name'>" +
              escapeHtml(w.displayName) +
              "</span>" +
              (w.localPending
                ? "<span class='pending-pill' title='Local chat seen; waiting for Cursor usage API. Token figure is a rough transcript estimate (chars÷4).'>Pending API</span>"
                : "") +
              "</td><td class='num' title='" +
              (w.tokensEstimated
                ? "Rough local estimate from transcript text — not billed usage"
                : "") +
              "'>" +
              (w.tokensEstimated ? fmtEstTokens(w.tokens) : fmtTokens(w.tokens)) +
              "</td><td class='num'>" +
              (w.localPending && !(w.costCents > 0) ? "—" : fmtCents(w.costCents)) +
              "</td><td class='num'>" +
              fmtDate(w.lastActiveAt) +
              "</td></tr>"
          )
          .join("") +
        "</tbody></table>";
    }

    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(drawTrend, 80);
    });
    vscode.postMessage({ type: "ready" });
  </script>
</body>
</html>`;
}
