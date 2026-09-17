# Ultimate Teams — 4.15.6

## This update

- Add Player is now **Add New Player**. The permanent and one-time actions
  remain separate, with the same player ratings and permissions.
- Current teams expire at device-local midnight alongside attendance and the
  daily dashboard. Expiration applies while open, on resume, on cloud refresh,
  and when reopening cached data. Saved game history and statistics are retained.
  Database rows are left intact; expired current teams are excluded by the app.
- Cached launches use the installed page, configuration, and library without
  waiting for the network. New releases are installed through the service worker.
- Safe cached content renders before session lookup finishes. Short status/retry
  feedback appears if the connection fails, and bootstrap reads time out after
  ten seconds instead of leaving startup stuck indefinitely.
- Repeated sign-in/token refresh events no longer restart the whole app or send
  you back to Main. Foreground and profile refreshes use the current daily-reset
  and pending-attendance logic. Old-account responses cannot replace new data.
- Scrolling batches dock layout calculations into animation frames. Unchanged
  attendance lists and dropdown options no longer rebuild on every refresh;
  active filters persist and settings being edited are not overwritten.
- Team generation keeps the same 120 searches, scoring rules, and constraints.
  It reuses player metrics and yields during the search to keep the UI responsive.
  Duplicate Generate presses are ignored while a generation is running.
- Keyboard attendance controls, visible focus, reduced-motion support, and role
  hiding before startup improve navigation and prevent admin controls flashing.
- Sandbox uses this release's exact assets. Its position at the bottom of Data,
  Edit Player at the bottom of the hold menu, Undo/Void inside Admin Audit Logs,
  and the vibrant Generate button are retained from the supplied release.

## Verification

Local checks cover scoring equivalence across all three reshuffle modes, yielding
while generating, rapid attendance gestures, pre-results balance, daily rollover,
offline snapshots, auth event deduplication, stale-account reads, cached launches,
service-worker upgrades, scroll batching, markup, and script syntax. Actual
Safari/iPhone visual checks and real-network speed measurements were unavailable.

The auth callback pattern follows the [Supabase auth event guidance](https://supabase.com/docs/reference/javascript/auth-onauthstatechange).

## Keep these website files

| File | Purpose |
| --- | --- |
| `index.html` | App page |
| `app.js` | Current app behavior |
| `legacy-core.js` | Core app functions still required by app.js |
| `styles.css` | Base styles |
| `theme.css` | Current appearance |
| `version.js` | Version shown in the app |
| `sandbox-host.js` | Opens and closes Sandbox |
| `sandbox-runtime.js` | Isolated Sandbox data and behavior |
| `service-worker.js` | Offline caching and notifications |
| `manifest.json` | Home Screen app settings |
| `config.js` | Your existing Supabase connection configuration |
| `CNAME` | Your existing custom domain |

## Keep these maintenance files

- `supabase/` — backend configuration and email/notification function source.
- `setup_supabase.sql` — database setup/recovery source.
- `update_4_12_0.sql` and `update_4_13_0.sql` — historical database migrations.
  These are retained setup history, not disposable copies of website assets.
- `README.md` — these instructions.

## Installing updates

Replace the existing project files with this ZIP's contents. No SQL changes or
backend redeployment are needed. This package contains the same 19 stable files;
there are no tests, backup copies, or obsolete assets to remove.

Reopen online to let the updated service worker finish installing, then reopen
once more if needed. The Data footer should show **4.15.6**. Later cached launches
use the installed release immediately. First-ever use still requires a connection.
Keep database scripts and Supabase function sources as project maintenance files.
