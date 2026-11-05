# Cursor Usage Dashboard

**Unofficial, personal tool** — not affiliated with Anysphere / Cursor. There is no official personal usage API; this extension calls the same unofficial `cursor.com` dashboard endpoints other community tools use. Those endpoints can change without notice.

**Requires you to be signed into the Cursor app** on the machine where you install it. The extension never ships with anyone else’s credentials. Each user authorizes by their own local Cursor login (or an optional manual session-cookie fallback).

Personal usage dashboard (webview + status bar) for **your own** account:

- Current plan / cycle usage (included pool %, prepaid credits, reset date)
- Model breakdown (tokens + cost, or analytics request counts on unified Grok billing)
- **Context Usage** from Cursor’s local composer tray (same source as the chat popup). While the dashboard is open and focused, this box re-reads locally about every 5s — no extra cursor.com traffic
- Daily trend charts (tokens, requests, or spend). Click a day to list that day’s chats
- **Local-first** models / trend / workspaces: transcript estimates (`chars÷4`, prefixed `~`) appear immediately; billed API totals replace them when Cursor publishes matching `conversationId`s
- **Estimated** per-workspace usage from local chats + open-folder tracking

## Auth

### Automatic (recommended)

Stay signed into Cursor. The extension reads your IDE session from the local state DB (`state.vscdb`, key `cursorAuth/accessToken`) and builds the dashboard cookie itself. No browser cookie copy is required.

### Manual fallback

Only if auto-detection fails: run **Cursor Usage: Set Session Token (manual fallback)** and paste *your* `WorkosCursorSessionToken` from cursor.com cookies. That value is stored in this machine’s SecretStorage only.

### What works if you are not signed in?

| Feature | Without Cursor sign-in |
| --- | --- |
| Context Usage (local tray / file estimate) | Yes |
| Local chat / model estimates (`~` tokens), sessions, workspace list | Yes (last ~30 days of local data) |
| Plan %, prepaid credits, analytics request counts, billed token events | No — sign in and refresh |

You will see an auth warning until you sign in; local sections still fill from this machine’s Cursor data.

## Install (release)

1. Download the `.vsix` from the [GitHub Releases](https://github.com/Chezar81/cursor-usage-dashboard/releases) page.
2. In Cursor: **Extensions: Install from VSIX…** and pick the file (or `cursor --install-extension cursor-usage-dashboard-x.y.z.vsix`).
3. Sign into Cursor if you have not already, then **Developer: Reload Window**.
4. Click the **Usage** status bar item (or **Cursor Usage: Open Dashboard**).

## Build from source

```bash
npm install
npm test
npm run build
npx vsce package --no-dependencies --allow-missing-repository
cursor --install-extension ./cursor-usage-dashboard-0.2.4.vsix
```

Or press **F5** from this folder for an Extension Development Host.

## Commands

| Command | Description |
| --- | --- |
| **Cursor Usage: Open Dashboard** | Open the webview dashboard |
| **Cursor Usage: Refresh** | Fetch latest usage from Cursor |
| **Cursor Usage: Set Session Token (manual fallback)** | Optional cookie paste if IDE login cannot be read |
| **Cursor Usage: Clear Local Workspace Stats** | Reset estimated workspace aggregates |

## Settings

- `cursorUsage.refreshIntervalMinutes` — auto-refresh status bar + open dashboard while Cursor is focused (default `2`, min `1`). Billing/API sync only — Context Usage uses a separate local poll (~5s) while the dashboard tab is visible.
- `cursorUsage.appearance` — `system` (follow Cursor's theme), `light`, or `dark`. The header icon cycles them: monitor, sun, moon.
- `cursorUsage.currency` — `USD` or `EUR` (also switchable from the dashboard header).
- `cursorUsage.eurPerUsd` — EUR per 1 USD when displaying Euro (default `0.92`). Cursor amounts are USD; this rate is for display only.

## Workspaces (estimated)

Cursor does not attribute usage events to folders. This extension estimates locally:

1. **Conversation → project** — matches each usage event’s `conversationId` to a local agent transcript under `~/.cursor/projects/<slug>/agent-transcripts/`
2. **Active folder tracking** — while the extension runs, records which workspace folder is open and uses that as a fallback when no transcript match exists
3. The currently open folder is always listed (even at 0) so you can see where you are
4. **Multi-window** — each Cursor window tracks its own open period (via `sessionId`); another window no longer closes this folder’s timer. Time-based fallback uses focus order when folders overlap.

The dashboard labels this **Estimated (local)**. Chats that never left a local transcript (or ran on another machine) cannot be attributed. Agent chats with no folder open show up as **No workspace**.

## Local cache (data loss protection)

Every successful refresh writes durable files under Cursor’s extension global storage
(e.g. `~/.config/Cursor/User/globalStorage/local.cursor-usage-dashboard/`):

| File | Purpose |
| --- | --- |
| `last-dashboard.json` | Latest dashboard view (overwritten each refresh; seeds UI on startup) |
| `workspace-usage.json` | Workspace estimates + open-window tracking (closed windows older than 30 days dropped) |
| `cache/raw-latest.json` | Slim raw payloads (event lists omitted; ≤512 KB) |
| `cache/history/YYYY-MM-DD.json` | One recovery snapshot per day (≤14 days, ≤2 MB total) |

Writes are atomic (temp → rename). Auto-refresh cannot bloat disk: history overwrites the
same day’s file, legacy per-refresh history files are deleted on maintenance, orphaned
`.tmp` files are cleaned, and raw event arrays are not stored.

## Unified Grok billing (no per-chat token events)

On unified SAND/Grok plans (`get-sand-usage-status` → `isUnified: true`), Cursor publishes the weekly pool % and prepaid credits live, but **no per-chat token rows** on `get-filtered-usage-events` / `get-aggregated-usage-events` for the current period. There is no alternate event endpoint.

For these accounts the dashboard:

- **Live from Cursor:** weekly pool %, prepaid credits, and **`get-user-analytics`** daily agent request counts + model request mix (Trend → Requests)
- **Local:** composer / tracking model labels; transcript token estimates (`~`)

If Cursor later publishes billed token events for the window, they automatically replace the local token rows (same `conversationId` matching as on classic plans).

## Privacy & caveats

- No account secrets are stored in this repository or in the published `.vsix`. Auth uses **your** local Cursor session (read-only) or a token you paste into SecretStorage on your machine.
- Unofficial endpoints may change without notice; the UI surfaces errors when that happens.
- Team Admin API and Marketplace publish are out of scope for this personal tool.

## Development

```bash
npm install
npm test        # typecheck + unit tests
npm run watch   # rebuild on change
# F5 → Extension Development Host
```
