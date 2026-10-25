# Cursor Usage Dashboard

Personal Cursor usage dashboard (webview + status bar) for your own account:

- Current plan / cycle usage (included pool %, prepaid credits from grok.com billing, reset date)
- Model breakdown (tokens + cost)
- **Estimated** context-window breakdown (rules, skills, MCP, conversation, …) from local Cursor/project files
- Daily trend charts (tokens or spend), aligned with the weekly included window when that drives the plan ring. Click a day to list the agent chats from that day — title, project, model, and that day’s tokens and cost
- **Local-first Trend / Models / workspaces**: agent transcripts and local AI-tracking model labels show up immediately as “pending API” with a rough transcript token estimate (`chars÷4`, prefixed `~`); when Cursor’s usage events include the same `conversationId`, billed token/cost figures replace the provisional rows
- **Estimated** per-workspace usage from local chats + open-folder tracking

There is no official personal usage API. This extension uses the same unofficial `cursor.com` dashboard endpoints as other community tools.

## Auth (automatic)

**No browser cookie copy is required** while you are signed into the Cursor app.

The extension reads your IDE session from Cursor’s local state database (`state.vscdb`, key `cursorAuth/accessToken`) and builds the dashboard cookie automatically — same approach as other community usage tools.

Just install the extension, stay logged into Cursor, and open the dashboard.

### Manual fallback

Only if auto-detection fails (unusual): run **Cursor Usage: Set Session Token (manual fallback)** and paste `WorkosCursorSessionToken` from cursor.com cookies. That value is stored in SecretStorage.

## Setup

```bash
npm install
npm run build
npx vsce package --no-dependencies --allow-missing-repository
cursor --install-extension ./cursor-usage-dashboard-0.2.1.vsix
```

Or press **F5** from this folder for an Extension Development Host.

Then **Developer: Reload Window**, click the **Usage** status bar item, and refresh if needed.

## Commands

| Command | Description |
| --- | --- |
| **Cursor Usage: Open Dashboard** | Open the webview dashboard |
| **Cursor Usage: Refresh** | Fetch latest usage from Cursor |
| **Cursor Usage: Set Session Token (manual fallback)** | Optional cookie paste if IDE login cannot be read |
| **Cursor Usage: Clear Local Workspace Stats** | Reset estimated workspace aggregates |

## Settings

- `cursorUsage.refreshIntervalMinutes` — auto-refresh status bar + open dashboard while Cursor is focused (default `2`, min `1`).
- `cursorUsage.appearance` — `system` (follow Cursor's theme), `light`, or `dark`. The header icon cycles them: monitor, sun, moon.
- `cursorUsage.currency` — `USD` or `EUR` (also switchable from the dashboard header).
- `cursorUsage.eurPerUsd` — EUR per 1 USD when showing Euro (default `0.92`). Cursor amounts are USD; this rate is for display only.

## Workspaces (estimated)

Cursor does not attribute usage events to folders. This extension estimates locally:

1. **Conversation → project** — matches each usage event’s `conversationId` to a local agent transcript under `~/.cursor/projects/<slug>/agent-transcripts/`
2. **Active folder tracking** — while the extension runs, records which workspace folder is open and uses that as a fallback when no transcript match exists
3. The currently open folder is always listed (even at 0) so you can see where you are
4. **Multi-window** — each Cursor window tracks its own open period (via `sessionId`); another window no longer closes this folder’s timer. Time-based fallback uses focus order when folders overlap.

The dashboard labels this **Estimated (local)**. Chats that never left a local transcript (or ran on another machine) cannot be attributed. Agent chats with no folder open show up as **No workspace**. Filtered usage events are paginated so recent chats are not dropped after the first API page.

Token counts come from Cursor’s usage events API when events include a matching `conversationId`. Until then the row shows a **Pending API** transcript estimate (`chars÷4`), which refreshes on each dashboard refresh. If a folder shows **0** while you are chatting there, those chats may lack a local transcript match — the row is still listed because the folder is open.

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

## Privacy & caveats

- Auto-auth reads the same local session Cursor already stores after login (read-only).
- Unofficial endpoints may change without notice; the UI surfaces errors when that happens.
- Team Admin API and Marketplace publish are out of scope for v1.

## Development

```bash
npm install
npm run watch   # rebuild on change
# F5 → Extension Development Host
```
