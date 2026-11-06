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
<html lang="en" data-appearance="system">
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

    /* Light and Dark override Cursor. System (no extra rules) keeps the theme tokens above. */
    /* Same base colors as Cursor Light, so this matches System while Cursor is light. */
    html[data-appearance="light"] {
      color-scheme: light;
      --bg: #fcfcfc;
      --fg: #141414;
      --muted: #141414bd;
      --accent: #2778c1;
      --accent-fg: #fcfcfc;
      --error: #be1744;
      --chart: #2778c1;
      --chart2: #cd4500;
      --chart3: #00854c;
      --chart4: #7565cc;
      --warn: #a46700;
    }
    html[data-appearance="dark"] {
      color-scheme: dark;
      --bg: #1e1e1e;
      --fg: #d8d8d8;
      --muted: #9a9a9a;
      --border: rgba(255, 255, 255, 0.12);
      --border-strong: rgba(255, 255, 255, 0.22);
      --surface: #252526;
      --surface-2: #2d2d30;
      --accent: #0e639c;
      --accent-fg: #ffffff;
      --error: #f48771;
      --chart: #3d9aed;
      --chart2: #d4a017;
      --chart3: #3fae7c;
      --chart4: #b07cc6;
      --warn: #c9a227;
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
    html[data-appearance="light"] body,
    html[data-appearance="dark"] body {
      color: var(--fg);
      background-color: var(--bg);
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
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      justify-content: flex-end;
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
    button.icon-btn {
      width: 34px;
      height: 34px;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--surface-2);
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: 9px;
    }
    button.icon-btn:hover {
      background: color-mix(in srgb, var(--fg) 10%, var(--bg));
    }
    button.icon-btn .theme-icon { display: none; }
    button.icon-btn .theme-icon.is-on { display: block; }

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
    .trend-toggles {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
    }
    /* Reuses .seg chrome; only extras for the menu + caret. */
    .trend-range-dd {
      position: relative;
    }
    .trend-range-dd > .trend-range-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      max-width: 13.5rem;
      white-space: nowrap;
    }
    .trend-range-btn:focus-visible {
      outline: 1px solid var(--accent);
      outline-offset: 1px;
    }
    .trend-range-label {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .trend-range-caret {
      flex: 0 0 auto;
      font-size: 0.7em;
      line-height: 1;
      color: var(--muted);
      transform: translateY(0.05em);
    }
    .trend-range-dd.open .trend-range-caret {
      transform: translateY(0.05em) rotate(180deg);
    }
    .trend-range-menu {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      z-index: 20;
      min-width: max(100%, 11.5rem);
      margin: 0;
      padding: 4px;
      list-style: none;
      border-radius: 9px;
      border: 1px solid var(--border);
      background: var(--bg);
      box-shadow: 0 10px 28px color-mix(in srgb, var(--fg) 14%, transparent);
      max-height: 240px;
      overflow: auto;
    }
    .trend-range-menu[hidden] {
      display: none;
    }
    .trend-range-menu button {
      display: block;
      width: 100%;
      text-align: left;
      padding: 7px 11px;
      border: none;
      border-radius: 7px;
      background: transparent;
      color: var(--fg);
      font: inherit;
      font-size: 0.82rem;
      cursor: pointer;
      white-space: nowrap;
    }
    .trend-range-menu button:hover,
    .trend-range-menu button:focus-visible {
      background: color-mix(in srgb, var(--fg) 8%, transparent);
      outline: none;
    }
    .trend-range-menu button.active {
      background: color-mix(in srgb, var(--fg) 10%, var(--bg));
      font-weight: 600;
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
    .model-bar-cell {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .bar-track {
      flex: 1;
      min-width: 0;
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
    .bar-pct {
      flex: 0 0 auto;
      min-width: 3.4em;
      text-align: right;
      font-size: 0.75rem;
      font-weight: 650;
      font-variant-numeric: tabular-nums;
      color: var(--muted);
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
    #trend { cursor: pointer; }
    .day-sessions { margin-top: 16px; }
    .day-sessions .section-head { margin-bottom: 4px; }
    .day-table-wrap { overflow-x: auto; }
    .session-title {
      display: block;
      font-weight: 600;
      letter-spacing: -0.01em;
      max-width: 280px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .session-sub {
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .session-intent {
      color: var(--muted);
      font-size: 0.75rem;
      line-height: 1.3;
    }

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
        <button id="btn-appearance" class="icon-btn" type="button" title="Appearance: System (follows Cursor). Click for light." aria-label="Appearance: System (follows Cursor). Click for light.">
          <svg class="theme-icon is-on" data-icon="system" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"></rect><path d="M8 20h8"></path><path d="M12 16v4"></path></svg>
          <svg class="theme-icon" data-icon="light" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path></svg>
          <svg class="theme-icon" data-icon="dark" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z"></path></svg>
        </button>
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
          <h2>Trend</h2>
          <div class="trend-toggles">
            <div class="seg trend-range-dd" id="trend-range-dd">
              <button
                type="button"
                class="active trend-range-btn"
                id="trend-range-btn"
                aria-label="Trend period"
                aria-haspopup="listbox"
                aria-expanded="false"
                title="Full from first use, or a single calendar month"
              >
                <span class="trend-range-label" id="trend-range-label">Full (from first use)</span>
                <span class="trend-range-caret" aria-hidden="true">▾</span>
              </button>
              <ul class="trend-range-menu" id="trend-range-menu" role="listbox" hidden></ul>
            </div>
            <div class="seg" role="tablist" aria-label="Trend metric">
              <button type="button" class="active" data-metric="requests">Requests</button>
              <button type="button" data-metric="tokens">Tokens</button>
              <button type="button" data-metric="code" title="Lines ±, applies, accepts from Cursor analytics (when published)">Code</button>
              <button type="button" data-metric="spend" hidden>Spend</button>
            </div>
          </div>
        </div>
        <div class="chart-wrap"><canvas id="trend" aria-label="Daily usage. Click a day to list its chats."></canvas></div>
        <div class="trend-legend" id="trend-legend" hidden>
          <span><i class="trend-swatch" aria-hidden="true"></i> API tokens / spend</span>
          <span><i class="trend-swatch pending" aria-hidden="true"></i> Local estimate (pending API)</span>
        </div>
        <p class="section-sub" id="trend-hint" style="margin-top:8px">Click a day to see its chats.</p>
        <div id="day-sessions" class="day-sessions" hidden></div>
        <p class="section-sub" id="trend-note" style="margin-top:10px"></p>
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
          <h2>Top 5 models</h2>
          <p class="section-sub" id="models-sub">Routed models · Auto vs manual</p>
        </div>
        <div id="models"></div>
      </div>
    </section>

    <section>
      <div class="panel">
        <div class="section-head">
          <h2>Workspaces</h2>
          <p class="section-sub">Estimated · local</p>
        </div>
        <p class="section-sub" style="margin:-6px 0 12px">
          Local chats appear immediately with a rough transcript token estimate (~); billed totals replace them when Cursor’s usage API lists matching conversation IDs (it publishes none for unified Grok billing).
        </p>
        <div id="workspaces"></div>
      </div>
    </section>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const uiState = vscode.getState() || {};
    let data = null;
    let metric = "requests";
    let metricUserSet = false;
    /**
     * "full" = first–last day with usage; "YYYY-MM" = that calendar month only.
     * Legacy "auto" maps to "full".
     */
    let trendRange =
      typeof uiState.trendRange === "string" &&
      (/^\\d{4}-\\d{2}$/.test(uiState.trendRange) || uiState.trendRange === "full")
        ? uiState.trendRange
        : "full";
    let selectedDay = null;
    let trendHits = [];
    let prefs = { currency: "USD", eurPerUsd: 0.92, appearance: "system" };
    const RING_C = 2 * Math.PI * 54;

    function persistUiState() {
      vscode.setState({
        ...(vscode.getState() || {}),
        trendRange,
      });
    }

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
        metric = btn.getAttribute("data-metric") || "requests";
        metricUserSet = true;
        syncMetricToggle();
        drawTrend();
      });
    });
    function closeTrendRangeMenu() {
      const dd = document.getElementById("trend-range-dd");
      const btn = document.getElementById("trend-range-btn");
      const menu = document.getElementById("trend-range-menu");
      if (!dd || !btn || !menu) return;
      dd.classList.remove("open");
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    }
    function openTrendRangeMenu() {
      const dd = document.getElementById("trend-range-dd");
      const btn = document.getElementById("trend-range-btn");
      const menu = document.getElementById("trend-range-menu");
      if (!dd || !btn || !menu) return;
      dd.classList.add("open");
      menu.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      const active = menu.querySelector("button.active");
      if (active && active.focus) active.focus();
    }
    function setTrendRange(next) {
      const value = next === "full" || /^\\d{4}-\\d{2}$/.test(String(next || "")) ? String(next) : "full";
      if (value === trendRange) {
        closeTrendRangeMenu();
        return;
      }
      trendRange = value;
      persistUiState();
      syncTrendRangeLabel();
      closeTrendRangeMenu();
      drawTrend();
      renderDaySessions();
    }
    document.getElementById("trend-range-btn").addEventListener("click", (event) => {
      event.stopPropagation();
      const menu = document.getElementById("trend-range-menu");
      if (!menu) return;
      if (menu.hidden) openTrendRangeMenu();
      else closeTrendRangeMenu();
    });
    document.getElementById("trend-range-menu").addEventListener("click", (event) => {
      const btn = event.target && event.target.closest ? event.target.closest("button[data-range]") : null;
      if (!btn) return;
      event.preventDefault();
      setTrendRange(btn.getAttribute("data-range"));
    });
    document.addEventListener("click", (event) => {
      const dd = document.getElementById("trend-range-dd");
      if (!dd || dd.contains(event.target)) return;
      closeTrendRangeMenu();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeTrendRangeMenu();
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
    document.getElementById("btn-appearance").addEventListener("click", () => {
      prefs = { ...prefs, appearance: nextAppearance(prefs.appearance) };
      applyAppearance(true);
      vscode.postMessage({ type: "setAppearance", appearance: prefs.appearance });
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
          appearance: normalizeAppearance(msg.prefs.appearance),
        };
        syncCurrencyToggle();
        applyAppearance(false);
      }
      if (msg?.type === "data") {
        data = msg.payload;
        render();
      } else if (msg?.type === "contextUsage" && data && msg.payload) {
        data = { ...data, contextUsage: msg.payload };
        renderContextUsage();
      } else if (msg?.type === "prefs" && data) {
        render();
      }
    });

    function syncCurrencyToggle() {
      document.querySelectorAll("[data-currency]").forEach((b) => {
        b.classList.toggle("active", b.getAttribute("data-currency") === prefs.currency);
      });
    }
    const APPEARANCE_NEXT = { system: "light", light: "dark", dark: "system" };
    const APPEARANCE_LABEL = { system: "System", light: "Light", dark: "Dark" };
    function normalizeAppearance(value) {
      return value === "light" || value === "dark" ? value : "system";
    }
    function nextAppearance(value) {
      return APPEARANCE_NEXT[normalizeAppearance(value)] || "system";
    }
    function appearanceTitle(mode) {
      const current = mode === "system" ? "System (follows Cursor)" : APPEARANCE_LABEL[mode];
      return "Appearance: " + current + ". Click for " + APPEARANCE_LABEL[nextAppearance(mode)].toLowerCase() + ".";
    }
    function syncAppearanceToggle() {
      const mode = normalizeAppearance(prefs.appearance);
      document.querySelectorAll(".theme-icon").forEach((el) => {
        el.classList.toggle("is-on", el.getAttribute("data-icon") === mode);
      });
      const btn = document.getElementById("btn-appearance");
      const label = appearanceTitle(mode);
      btn.title = label;
      btn.setAttribute("aria-label", label);
    }
    function applyAppearance(redraw) {
      document.documentElement.setAttribute("data-appearance", prefs.appearance);
      syncAppearanceToggle();
      if (redraw && data) drawTrend();
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
    /** Pill on local-only rows: 'Local' when the API structurally publishes
        no per-chat events for this plan, else 'Pending API'. */
    function pendingPillLabel() {
      return data && data.trend && data.trend.apiEventsUnavailable
        ? "Local"
        : "Pending API";
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
    /** Share of all requests. Keeps sub-percent values readable. */
    function fmtShare(pct) {
      if (!Number.isFinite(pct) || pct <= 0) return "0%";
      if (pct < 0.1) return "<0.1%";
      if (pct < 10) {
        const rounded = Math.round(pct * 10) / 10;
        return (rounded % 1 === 0 ? String(rounded) : rounded.toFixed(1)) + "%";
      }
      return Math.round(pct) + "%";
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

    function syncMetricToggle() {
      document.querySelectorAll("[data-metric]").forEach((b) =>
        b.classList.toggle("active", b.getAttribute("data-metric") === metric)
      );
    }

    /** Any billed, analytics, or local signal that makes a day worth plotting. */
    function dayHasActivity(d) {
      if (!d) return false;
      return (
        (d.tokens || 0) > 0 ||
        (d.costCents || 0) > 0 ||
        (d.eventCount || 0) > 0 ||
        (d.apiRequests || 0) > 0 ||
        (d.includedRequests || 0) > 0 ||
        (d.usageBasedRequests || 0) > 0 ||
        (d.localEstimatedTokens || 0) > 0 ||
        (d.localEstimatedRequests || 0) > 0 ||
        (d.codingActivity || 0) > 0 ||
        (d.localPendingConversations || 0) > 0 ||
        (d.matchedConversations || 0) > 0
      );
    }

    function monthKeyFromDay(isoDay) {
      if (!isoDay || typeof isoDay !== "string" || isoDay.length < 7) return "";
      return isoDay.slice(0, 7);
    }

    function formatMonthLabel(ym) {
      const parts = String(ym || "").split("-").map((n) => Number(n));
      if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) {
        return ym;
      }
      const dt = new Date(parts[0], parts[1] - 1, 1);
      if (!Number.isFinite(dt.getTime())) return ym;
      return dt.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }

    /** Distinct YYYY-MM keys that have activity, ascending. */
    function activeMonthKeys(daily) {
      const keys = [];
      const seen = Object.create(null);
      for (const d of daily || []) {
        if (!dayHasActivity(d)) continue;
        const key = monthKeyFromDay(d.date);
        if (!key || seen[key]) continue;
        seen[key] = true;
        keys.push(key);
      }
      keys.sort();
      return keys;
    }

    function trendRangeLabelFor(value) {
      if (value === "full") return "Full (from first use)";
      return formatMonthLabel(value);
    }
    function syncTrendRangeLabel() {
      const label = document.getElementById("trend-range-label");
      if (label) label.textContent = trendRangeLabelFor(trendRange);
    }
    function rebuildTrendRangeOptions(daily) {
      const menu = document.getElementById("trend-range-menu");
      if (!menu) return;
      const months = activeMonthKeys(daily);
      if (trendRange !== "full" && months.indexOf(trendRange) < 0) {
        trendRange = "full";
        persistUiState();
      }
      const options = [
        { value: "full", label: "Full (from first use)" },
        ...months.map((ym) => ({ value: ym, label: formatMonthLabel(ym) })),
      ];
      menu.innerHTML = options
        .map(
          (o) =>
            '<li role="none"><button type="button" role="option" data-range="' +
            escapeHtml(o.value) +
            '"' +
            (o.value === trendRange ? ' class="active" aria-selected="true"' : ' aria-selected="false"') +
            ">" +
            escapeHtml(o.label) +
            "</button></li>"
        )
        .join("");
      syncTrendRangeLabel();
    }

    /**
     * full: first–last day with activity across the loaded window.
     * YYYY-MM: that calendar month only (empty months fall back to full).
     */
    function sliceDailyForRange(daily) {
      const all = Array.isArray(daily) ? daily : [];
      if (!all.length) {
        return { days: all, trimmed: false, hidden: 0, mode: "full" };
      }

      if (trendRange !== "full" && /^\\d{4}-\\d{2}$/.test(trendRange)) {
        const monthDays = all.filter((d) => monthKeyFromDay(d.date) === trendRange);
        if (!monthDays.length) {
          return { days: all, trimmed: false, hidden: 0, mode: "full" };
        }
        let first = -1;
        let last = -1;
        for (let i = 0; i < monthDays.length; i++) {
          if (dayHasActivity(monthDays[i])) {
            if (first < 0) first = i;
            last = i;
          }
        }
        const days =
          first < 0 ? monthDays : monthDays.slice(first, last + 1);
        return {
          days,
          trimmed: days.length < all.length,
          hidden: all.length - days.length,
          from: days[0].date,
          to: days[days.length - 1].date,
          mode: "month",
          month: trendRange,
        };
      }

      let first = -1;
      let last = -1;
      for (let i = 0; i < all.length; i++) {
        if (dayHasActivity(all[i])) {
          if (first < 0) first = i;
          last = i;
        }
      }
      if (first < 0) {
        return { days: all, trimmed: false, hidden: 0, mode: "full" };
      }
      if (first === 0 && last === all.length - 1) {
        return { days: all, trimmed: false, hidden: 0, mode: "full" };
      }
      return {
        days: all.slice(first, last + 1),
        trimmed: true,
        hidden: all.length - (last - first + 1),
        from: all[first].date,
        to: all[last].date,
        mode: "full",
      };
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
        if (!metricUserSet) {
          metric = "requests";
        }
        if (trend.spendTrendUnavailable && metric === "spend") {
          metric = "requests";
          metricUserSet = false;
        }
        rebuildTrendRangeOptions(data.daily || []);
        syncMetricToggle();
        const hasCodingSeries =
          Array.isArray(data.daily) &&
          data.daily.some((d) => (d.codingActivity || 0) > 0);
        document.querySelectorAll("[data-metric='code']").forEach((btn) => {
          btn.hidden = !hasCodingSeries;
          btn.disabled = !hasCodingSeries;
          btn.title = hasCodingSeries
            ? "Lines added/deleted, applies, accepts (get-user-analytics)"
            : "No coding metrics in analytics for this window";
        });
        document.querySelectorAll("[data-metric='spend']").forEach((btn) => {
          // No Cursor cost events → Spend adds nothing; hide the tab entirely.
          const hide = !!trend.spendTrendUnavailable;
          btn.hidden = hide;
          btn.disabled = hide;
          btn.title = hide
            ? "Spend trend unavailable for this plan"
            : "API spend";
        });
        if (!hasCodingSeries && metric === "code") {
          metric = "requests";
          metricUserSet = false;
          syncMetricToggle();
        }
        const windowName =
          trend.rangeKind === "weekly" ? "weekly window" : "billing window";
        const lastApiWhen = trend.lastEventAt
          ? fmtDate(trend.lastEventAt) + " (" + fmtAgo(trend.lastEventAt) + ")"
          : "";
        const lastApiLabel = trend.apiEventsUnavailable
          ? (trend.analyticsAvailable
              ? "Analytics synced · " +
                (Number(trend.analyticsRequests) || 0) +
                " requests · per-chat tokens not published\\n(last token event " +
                (lastApiWhen || "never") +
                ")"
              : "Per-chat API events not published for unified billing\\n(last published " +
                (lastApiWhen || "never") +
                ")")
          : trend.lastEventBeforeWindow && lastApiWhen
            ? "Newest API event is before this " + windowName + ": " + lastApiWhen
            : lastApiWhen
              ? "Newest usage event " + lastApiWhen
              : "No usage events in this " + windowName + " yet";
        if (errMsg) {
          banner.hidden = false;
          banner.classList.remove("info");
          bannerText.textContent = errMsg;
        } else if (trend.analyticsLagging) {
          banner.hidden = false;
          banner.classList.add("info");
          bannerText.textContent =
            "Cursor analytics is behind your local chats right now. Requests use local day-bucketed turns (~) where Cursor under-reports; Tokens use local transcript estimates (~). Pool % still comes from Cursor.";
        } else if (trend.apiEventsUnavailable) {
          banner.hidden = false;
          banner.classList.add("info");
          bannerText.textContent =
            "Cursor does not publish per-chat tokens or cost for this plan. Tokens show local day-bucketed transcript estimates (~); Requests come from Cursor analytics; Spend trend is unavailable (prepaid totals stay in Plan).";
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
        renderDaySessions();
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

    /**
     * One row per model label: API/analytics wins, local estimates fold in.
     * Guards against a stale extension host still sending duplicate rows.
     */
    function dedupeModels(list) {
      const byLabel = new Map();
      for (const row of list || []) {
        const label = String(row.model || row.modelIntent || "unknown");
        const prev = byLabel.get(label);
        if (!prev) {
          byLabel.set(label, { ...row, model: label, modelIntent: label });
          continue;
        }
        const apiFirst = !row.localPending
          ? row
          : !prev.localPending
            ? prev
            : row;
        const other = apiFirst === row ? prev : row;
        const apiHasBilled =
          !apiFirst.tokensEstimated &&
          ((apiFirst.totalTokens || 0) > 0 || (apiFirst.costCents || 0) > 0);
        const est = Math.max(
          apiFirst.tokensEstimated ? apiFirst.totalTokens || 0 : 0,
          other.tokensEstimated ? other.totalTokens || 0 : 0,
          apiHasBilled
            ? 0
            : Math.max(apiFirst.totalTokens || 0, other.totalTokens || 0)
        );
        byLabel.set(label, {
          ...apiFirst,
          model: label,
          modelIntent: label,
          localPending: false,
          analyticsRequests:
            Math.max(apiFirst.analyticsRequests || 0, other.analyticsRequests || 0) ||
            undefined,
          autoRequests:
            Math.max(apiFirst.autoRequests || 0, other.autoRequests || 0) ||
            undefined,
          manualRequests:
            Math.max(apiFirst.manualRequests || 0, other.manualRequests || 0) ||
            undefined,
          pendingConversations:
            Math.max(
              apiFirst.pendingConversations || 0,
              other.pendingConversations || 0
            ) || undefined,
          totalTokens: apiHasBilled ? apiFirst.totalTokens : est,
          tokensEstimated: apiHasBilled ? false : est > 0,
        });
      }
      return [...byLabel.values()].sort(
        (a, b) =>
          (b.analyticsRequests || 0) - (a.analyticsRequests || 0) ||
          (b.totalTokens || 0) - (a.totalTokens || 0) ||
          String(a.model).localeCompare(String(b.model))
      );
    }

    function renderModels() {
      const el = document.getElementById("models");
      const allModels = dedupeModels(data.models || []);
      const models = allModels.slice(0, 5);
      const totals = data.totals || {};
      const apiRows = models.filter((m) => !m.localPending);
      const pendingRows = models.filter((m) => m.localPending);
      const pendingChats = allModels
        .filter((m) => m.localPending)
        .reduce((s, m) => s + (m.pendingConversations || 0), 0);

      if (!allModels.length) {
        document.getElementById("models-sub").textContent = "";
        el.innerHTML = '<p class="empty">No model usage in this period yet.</p>';
        return;
      }

      const analyticsReqTotal = allModels.reduce(
        (s, m) => s + (m.analyticsRequests || 0),
        0
      );
      const subParts = [];
      if (allModels.length > models.length) {
        subParts.push(allModels.length + " in this period");
      } else if (apiRows.length) {
        subParts.push(apiRows.length + " API");
      }
      if (analyticsReqTotal > 0) {
        subParts.push(
          analyticsReqTotal +
            " analytics req" +
            (analyticsReqTotal === 1 ? "" : "s")
        );
      }
      if (pendingChats > 0) {
        subParts.push(
          pendingChats +
            " local chat" +
            (pendingChats === 1 ? "" : "s") +
            ((data.trend && data.trend.apiEventsUnavailable) ? " (local ~)" : " pending")
        );
      }
      const autoReqTotal = apiRows.reduce((s, m) => s + (m.autoRequests || 0), 0);
      if (apiRows.length && (totals.costCents || 0) > 0) {
        subParts.push(fmtCents(totals.costCents) + " total");
        subParts.push("by model that served the request");
        if (autoReqTotal > 0) {
          subParts.push(autoReqTotal + " Auto-routed req" + (autoReqTotal === 1 ? "" : "s"));
        }
      } else if (analyticsReqTotal > 0) {
        subParts.push("request counts from Cursor analytics · tokens local (~)");
      } else {
        subParts.push("local labels first — matched when API publishes events");
      }
      document.getElementById("models-sub").textContent = subParts.join(" · ");

      function requestsOf(m) {
        if (analyticsReqTotal > 0) return m.analyticsRequests || 0;
        return (m.autoRequests || 0) + (m.manualRequests || 0);
      }
      const requestTotal = allModels.reduce((s, m) => s + requestsOf(m), 0);
      const shareByRequests = requestTotal > 0;
      const maxTokens = shareByRequests
        ? 1
        : Math.max(
            ...apiRows.map((m) => m.totalTokens || 0),
            ...pendingRows.map((m) => m.totalTokens || 0),
            1
          );
      function barMarkup(pct, color, requests) {
        const width = Math.max(0, Math.min(100, pct));
        const share = shareByRequests
          ? '<span class="bar-pct" title="' + requests + " of " + requestTotal +
            " requests" + '">' + fmtShare(width) + "</span>"
          : "";
        return (
          '<div class="model-bar-cell"><div class="bar-track">' +
          '<div class="bar-fill" style="width:' + width + "%;background:" + color +
          '"></div></div>' + share + "</div>"
        );
      }
      const colors = ["var(--chart3)", "var(--chart)", "var(--chart2)", "var(--chart4)"];
      const pendingColor = "var(--chart2)";

      el.innerHTML =
        '<div class="model-list">' +
        models
          .map((m, i) => {
            const routed = m.model || m.modelIntent || "unknown";
            const autoReq = m.autoRequests || 0;
            const manualReq = m.manualRequests || 0;
            let routeMeta = "";
            if (!m.localPending && (autoReq > 0 || manualReq > 0)) {
              const bits = [];
              if (autoReq > 0) {
                bits.push("Auto " + autoReq + " req" + (autoReq === 1 ? "" : "s"));
              }
              if (manualReq > 0) {
                bits.push("Manual " + manualReq + " req" + (manualReq === 1 ? "" : "s"));
              }
              routeMeta = bits.join(" · ");
            }
            const title =
              '<div class="model-name">' +
              escapeHtml(routed) +
              (m.localPending
                ? "<span class='pending-pill' title='Local model from Cursor's local chat data; no billed API events for this chat'>" + pendingPillLabel() + "</span>"
                : "") +
              "</div>";

            if (m.localPending) {
              const chats = m.pendingConversations || 0;
              const est = m.totalTokens || 0;
              const aReq = m.analyticsRequests || 0;
              const req = requestsOf(m);
              const pct = shareByRequests
                ? (req / requestTotal) * 100
                : (est / maxTokens) * 100;
              const metaBits = [];
              if (aReq > 0) {
                metaBits.push(aReq + " analytics req" + (aReq === 1 ? "" : "s"));
              }
              if (chats > 0) {
                metaBits.push(
                  chats + " local chat" + (chats === 1 ? "" : "s")
                );
              }
              metaBits.push(
                est > 0
                  ? fmtEstTokens(est) + " from transcript (rough)"
                  : "estimate when transcript readable"
              );
              return (
                '<div class="model-row">' +
                "<div>" + title +
                '<div class="model-meta">' +
                metaBits.join(" · ") +
                "</div></div>" +
                barMarkup(pct, pendingColor, req) +
                '<div class="model-cost" title="Cost unavailable until billed API events arrive">' +
                (aReq > 0 ? aReq + " req" : "—") +
                "</div>" +
                "</div>"
              );
            }

            const aReq = m.analyticsRequests || 0;
            const req = requestsOf(m);
            const pct = shareByRequests
              ? (req / requestTotal) * 100
              : ((m.totalTokens || 0) / maxTokens) * 100;
            const color = colors[i % colors.length];
            const hasBilledTokens =
              !m.tokensEstimated &&
              ((m.totalTokens || 0) > 0 || (m.costCents || 0) > 0);
            let meta = routeMeta
              ? '<div class="model-meta">' + escapeHtml(routeMeta) + "</div>"
              : "";
            if (hasBilledTokens) {
              meta +=
                '<div class="model-meta">in ' + fmtTokens(m.inputTokens) +
                " · out " + fmtTokens(m.outputTokens) +
                " · cache " + fmtTokens(m.cacheReadTokens) +
                "</div>";
            } else if (aReq > 0) {
              const bits = [
                aReq + " analytics request" + (aReq === 1 ? "" : "s"),
              ];
              if (m.pendingConversations > 0) {
                bits.push(
                  m.pendingConversations +
                    " local chat" +
                    (m.pendingConversations === 1 ? "" : "s")
                );
              }
              if (m.tokensEstimated && m.totalTokens > 0) {
                bits.push(fmtEstTokens(m.totalTokens) + " transcript");
              } else {
                bits.push("tokens not published for this plan");
              }
              meta +=
                '<div class="model-meta">' + bits.join(" · ") + "</div>";
            }
            return (
              '<div class="model-row">' +
              "<div>" + title + meta + "</div>" +
              barMarkup(pct, color, req) +
              '<div class="model-cost">' +
              (hasBilledTokens
                ? fmtCents(m.costCents)
                : aReq > 0
                  ? aReq + " req"
                  : "—") +
              "</div>" +
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
      const dailyAll = (data && data.daily) || [];
      const sliced = sliceDailyForRange(dailyAll);
      const daily = sliced.days;
      const trend = (data && data.trend) || {};
      if (metric === "spend" && trend.spendTrendUnavailable) {
        note.textContent =
          "Spend trend unavailable — Cursor does not publish per-chat costs for this plan. Prepaid / on-demand totals stay in Plan above.";
      } else {
        const base =
          trend.note ||
          (dailyAll.length ? dailyAll.length + " days in window" : "No daily activity yet.");
        if (sliced.mode === "month" && sliced.month) {
          note.textContent =
            base +
            " · " +
            formatMonthLabel(sliced.month) +
            " (" +
            daily.length +
            " day" +
            (daily.length === 1 ? "" : "s") +
            ")";
        } else if (sliced.trimmed) {
          note.textContent =
            base +
            " · Full from first use " +
            fmtTrendDay(sliced.from) +
            "–" +
            fmtTrendDay(sliced.to) +
            " (" +
            daily.length +
            " of " +
            dailyAll.length +
            " days)";
        } else {
          note.textContent = base;
        }
      }

      const ctx = canvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);
      if (!daily.length) {
        trendHits = [];
        selectedDay = null;
        return;
      }
      if (selectedDay && !daily.some((d) => d.date === selectedDay)) {
        selectedDay = null;
      }

      const noApiTokens = !!trend.apiEventsUnavailable;
      const fillRequests = metric === "requests" && !!trend.analyticsLagging;
      // Tokens without Cursor events: local day-bucketed estimates are primary.
      // Requests: analytics blue, optionally filled with local turns when lagging;
      //   dashed line always shows the full local turn series.
      // Code: composite analytics score (lines ±, applies, accepts).
      // Spend without Cursor events: no invented series (handled below + disabled tab).
      const apiValues = daily.map((d) => {
        if (metric === "spend") {
          return noApiTokens ? 0 : toDisplayAmount(d.costCents / 100);
        }
        if (metric === "code") {
          return d.codingActivity || 0;
        }
        if (metric === "requests") {
          const api = d.apiRequests || 0;
          const local = d.localEstimatedRequests || 0;
          return fillRequests ? Math.max(api, local) : api;
        }
        if (noApiTokens) {
          return d.localEstimatedTokens || 0;
        }
        return d.tokens;
      });
      const localValues = daily.map((d) => {
        if (metric === "tokens") {
          return noApiTokens ? 0 : d.localEstimatedTokens || 0;
        }
        if (metric === "requests") {
          return d.localEstimatedRequests || 0;
        }
        return 0;
      });
      const maxApi = Math.max(...apiValues, 0);
      const maxLocal = Math.max(...localValues, 0);
      const sharedScale =
        metric === "tokens" || metric === "requests";
      const apiMax = sharedScale
        ? Math.max(maxApi, maxLocal, 1)
        : Math.max(maxApi, metric === "spend" ? 0.01 : 1);
      const localMax = sharedScale
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
        if (metric === "spend" && trend.spendTrendUnavailable) {
          legend.hidden = true;
          legend.innerHTML = "";
        } else if (metric === "code") {
          legend.hidden = false;
          legend.innerHTML =
            '<span><i class="trend-swatch" aria-hidden="true"></i> Coding activity (analytics: lines ±, applies, accepts)</span>';
        } else {
          const apiLegend =
            metric === "spend"
              ? "API spend"
              : metric === "requests"
                ? fillRequests
                  ? "Requests (Cursor, local ~ fill)"
                  : "Cursor analytics requests"
                : noApiTokens
                  ? "Local est. tokens (~)"
                  : "API tokens";
          const showLocal =
            metric === "requests" ||
            (metric === "tokens" && !noApiTokens);
          const localLegend =
            metric === "tokens"
              ? "Local est. tokens (~)"
              : "Local est. requests (~)";
          legend.innerHTML =
            '<span><i class="trend-swatch" aria-hidden="true"></i> ' +
            apiLegend +
            "</span>" +
            (showLocal
              ? '<span><i class="trend-swatch pending" aria-hidden="true"></i> ' +
                localLegend +
                "</span>"
              : "");
        }
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
      trendHits = daily.map((d, i) => ({ date: d.date, x: xAt(i) }));

      const selectedIndex = selectedDay
        ? daily.findIndex((d) => d.date === selectedDay)
        : -1;
      if (selectedIndex >= 0) {
        const x = xAt(selectedIndex);
        const prevX = selectedIndex > 0 ? xAt(selectedIndex - 1) : x - 36;
        const nextX = selectedIndex < n - 1 ? xAt(selectedIndex + 1) : x + 36;
        const half = Math.max(10, Math.min(Math.abs(x - prevX), Math.abs(nextX - x)) / 2);
        ctx.fillStyle = cssVar("--accent", apiColor);
        ctx.globalAlpha = 0.14;
        ctx.fillRect(x - half, pad.t, half * 2, plotH);
        ctx.globalAlpha = 1;
      }

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
              metric === "tokens" ? "~" + fmtTokens(p.v) : String(p.v);
          ctx.fillText(label, p.x, p.y - 6);
        });
        if (maxApi > 0) {
          apiPts.forEach((p) => {
            if (p.v <= 0) return;
            ctx.fillStyle = apiColor;
            const label =
              metric === "spend"
                ? moneySymbol() + p.v.toFixed(2)
                : metric === "requests"
                  ? String(Math.round(p.v))
                  : metric === "code"
                    ? String(Math.round(p.v))
                    : fmtTokens(p.v);
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
        metric === "spend"
          ? moneySymbol() + apiMax.toFixed(2)
          : metric === "requests"
            ? String(Math.round(apiMax)) + " req"
            : metric === "code"
              ? String(Math.round(apiMax))
              : fmtTokens(apiMax);
      ctx.fillText(apiTopLabel, pad.l - 8, pad.t);
      ctx.fillText("0", pad.l - 8, pad.t + plotH);
      ctx.textAlign = "left";
      ctx.fillStyle = localColor;
      ctx.fillText(
        metric === "tokens"
          ? "~" + fmtTokens(localMax)
          : metric === "requests"
            ? "~" + String(Math.round(localMax)) + " req"
            : String(localMax) + " chats",
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
      const labelFont =
        "11px " + (cssVar("--vscode-font-family", "sans-serif") || "sans-serif");
      daily.forEach((d, i) => {
        const selected = d.date === selectedDay;
        if (!selected && !labelEvery && i !== 0 && i !== n - 1 && i !== Math.floor(n / 2)) {
          return;
        }
        ctx.fillStyle = selected ? cssVar("--accent", apiColor) : muted;
        ctx.font = selected ? "600 " + labelFont : labelFont;
        ctx.fillText(fmtTrendDay(d.date), xAt(i), h - 10);
      });
      ctx.font = font;
    }

    function fmtTrendDayLong(isoDay) {
      if (!isoDay || typeof isoDay !== "string") return "—";
      const parts = isoDay.split("-").map((n) => Number(n));
      if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return isoDay;
      const dt = new Date(parts[0], parts[1] - 1, parts[2]);
      if (!Number.isFinite(dt.getTime())) return isoDay;
      return dt.toLocaleDateString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
      });
    }

    function dayAtClientX(clientX) {
      const canvas = document.getElementById("trend");
      if (!canvas || !trendHits.length) return null;
      const x = clientX - canvas.getBoundingClientRect().left;
      let best = null;
      let bestDist = Infinity;
      for (const hit of trendHits) {
        const dist = Math.abs(hit.x - x);
        if (dist < bestDist) {
          bestDist = dist;
          best = hit;
        }
      }
      if (!best) return null;
      const gap = trendHits.length < 2
        ? 48
        : Math.abs(trendHits[1].x - trendHits[0].x);
      const limit = Math.max(14, gap / 2);
      return bestDist <= limit + 0.5 ? best.date : null;
    }

    function renderDaySessions() {
      const el = document.getElementById("day-sessions");
      if (!el) return;
      const daily = (data && data.daily) || [];
      const point = selectedDay ? daily.find((d) => d.date === selectedDay) : null;
      if (!point) {
        el.hidden = true;
        el.innerHTML = "";
        return;
      }
      const rows = ((data && data.sessions) || [])
        .filter((s) => s.date === selectedDay)
        .slice()
        .sort((a, b) =>
          (b.costCents || 0) - (a.costCents || 0) ||
          (b.tokens || 0) - (a.tokens || 0) ||
          String(a.title || "").localeCompare(String(b.title || ""))
        );
      const bits = [rows.length + (rows.length === 1 ? " chat" : " chats")];
      if (point.tokens > 0) bits.push(fmtTokens(point.tokens));
      if (point.localEstimatedTokens > 0) {
        bits.push(fmtEstTokens(point.localEstimatedTokens) + " local");
      }
      if ((point.apiRequests || 0) > 0) {
        bits.push(point.apiRequests + " analytics req");
      }
      if ((point.codingActivity || 0) > 0) {
        const parts = [];
        if ((point.linesAdded || 0) > 0) parts.push("+" + point.linesAdded + " loc");
        if ((point.linesDeleted || 0) > 0) parts.push("−" + point.linesDeleted + " loc");
        if ((point.totalApplies || 0) > 0) parts.push(point.totalApplies + " applies");
        if ((point.totalAccepts || 0) > 0) parts.push(point.totalAccepts + " accepts");
        bits.push(
          "coding " +
            (parts.length ? parts.join(", ") : String(Math.round(point.codingActivity)) + " pts")
        );
      }
      if ((point.localEstimatedRequests || 0) > 0) {
        bits.push("~" + point.localEstimatedRequests + " local req");
      }
      if (point.costCents > 0) bits.push(fmtCents(point.costCents));
      bits.push("usage on this day");

      let body;
      if (!rows.length) {
        body = '<p class="empty">No chats recorded for this day.</p>';
      } else {
        body =
          '<div class="day-table-wrap"><table><thead><tr>' +
          "<th>Chat</th><th>Project</th><th>Model</th>" +
          "<th class='num'>Requests</th><th class='num'>Tokens</th><th class='num'>Cost</th>" +
          "</tr></thead><tbody>" +
          rows.map((s) => {
            const title = s.title || "Untitled chat";
            const intent = s.modelIntent && s.modelIntent !== s.model
              ? '<div class="session-intent">Intent ' + escapeHtml(s.modelIntent) + "</div>"
              : "";
            const extra = s.modelCount > 1 ? " +" + (s.modelCount - 1) : "";
            const tokens = s.tokensEstimated ? fmtEstTokens(s.tokens) : fmtTokens(s.tokens);
            const cost = s.localPending && !(s.costCents > 0) ? "—" : fmtCents(s.costCents);
            const requests = s.localPending
              ? (s.requests > 0 ? "~" + s.requests : "—")
              : String(s.requests || 0);
            return (
              "<tr><td><span class='session-title' title='" + escapeHtml(title) + "'>" +
              escapeHtml(title) +
              "</span>" +
              (s.localPending
                ? "<span class='pending-pill' title='Local chat; no billed API events for this chat. Token figure is a rough transcript estimate (chars÷4).'>" + pendingPillLabel() + "</span>"
                : "") +
              "</td><td><span class='session-sub' title='" + escapeHtml(s.workspace || "") + "'>" +
              escapeHtml(s.workspace || "—") +
              "</span></td><td><span class='session-sub' title='" +
              escapeHtml((s.model || "") + (extra ? " and " + (s.modelCount - 1) + " more" : "")) +
              "'>" + escapeHtml(s.model || "—") + extra + "</span>" + intent +
              "</td><td class='num'>" + requests +
              "</td><td class='num'>" + tokens +
              "</td><td class='num'>" + cost +
              "</td></tr>"
            );
          }).join("") +
          "</tbody></table></div>" +
          '<p class="section-sub" style="margin-top:8px">A chat that continues across days is listed on each day, with that day’s usage.</p>';
      }

      el.hidden = false;
      el.innerHTML =
        '<div class="section-head"><h2>Sessions · ' + escapeHtml(fmtTrendDayLong(selectedDay)) +
        '</h2><button type="button" class="linkish" data-close-day>Close</button></div>' +
        '<p class="section-sub" style="margin:0 0 10px">' + escapeHtml(bits.join(" · ")) + "</p>" +
        body;
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
                ? "<span class='pending-pill' title='Local chat; no billed API events for this chat. Token figure is a rough transcript estimate (chars÷4).'>" + pendingPillLabel() + "</span>"
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

    document.getElementById("trend").addEventListener("click", (event) => {
      const day = dayAtClientX(event.clientX);
      if (!day) return;
      selectedDay = selectedDay === day ? null : day;
      drawTrend();
      renderDaySessions();
    });
    document.getElementById("trend").addEventListener("mousemove", (event) => {
      const canvas = document.getElementById("trend");
      const day = dayAtClientX(event.clientX);
      canvas.title = day ? "Show chats for " + fmtTrendDay(day) : "";
    });
    document.getElementById("day-sessions").addEventListener("click", (event) => {
      const closer = event.target && event.target.closest
        ? event.target.closest("[data-close-day]")
        : null;
      if (!closer) return;
      selectedDay = null;
      drawTrend();
      renderDaySessions();
    });

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
