# Ultimate Teams — 4.14.8

This is the complete cleaned project. It preserves the uploaded app behavior,
Supabase configuration, custom domain, database scripts, and backend functions.
No SQL changes or backend redeployment are needed for this cleanup.


## This update

- Sandbox is a direct button at the top of Data. Tools and Roster & App Settings
  remain collapsed by default. Clear Attendance is first in Tools.
- Game Night is now Dashboard.
- Inactive Players and Present Only stay side by side, including on phones.
- Attendance boxes share a dark surface and a 48px standard height. Expanded
  forms and longer player descriptions can grow so text is never clipped.
  Present players retain their green outline; switches retain their status knob.
- Attendance expires at local midnight, using the same device-local cutoff as
  the dashboard. Open apps update at midnight or on resume; reopened apps filter
  check-ins by their recorded timestamp, including offline startup snapshots.
  Yesterday's queued taps are not replayed. There is no server scheduler or SQL
  change: old database records remain history and are excluded by the app.
  As with the dashboard, devices in different time zones use their own midnight.
- Previous hold/tap, translucent dialog, and pre-results balance fixes remain.

No SQL changes or backend redeployment are needed. Replace the same files.
Actual iPhone visual verification was unavailable in this environment.

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

## One-time cleanup

Use this ZIP's contents as the complete website/project file list. Merely copying
it over the old folder will not remove files already there. Remove old app assets
that are absent from this package, then upload these contents. Preserve repository
settings and deployment workflows if your repository has any.

The uploaded site's active assets were the six 4.14.5 JavaScript/CSS families:
`app`, `legacy-core`, `version`, `sandbox-host`, `sandbox-runtime`, and `theme`,
plus `styles-4120.css`. These are now replaced by the stable names above.
After installing this package, remove ALL old numbered copies of those assets,
including 4.14.5, and `styles-4120.css`.

The old `tests/`, `CODE_AUDIT_4_11_21.md`, `REFACTOR_4_12_0.md`, and
`VERSION_HISTORY.md` are not needed to run the app. They are omitted here.
The stray root `index.ts` was a duplicate of `supabase/config.toml`, not a
website entry point, and is omitted. The `__MACOSX` folder and `._` companion
files are macOS ZIP metadata and are also omitted.

## Future updates

Replace the existing files with the files in each update ZIP. Filenames stay
stable, and each ZIP contains one current copy of each file. Cache versions
are changed inside URLs and the service worker, rather than in filenames.
For example, `app.js?v=4.14.8` still refers to the single file `app.js`.
No tests, audit reports, dated release notes, backup copies, or obsolete asset
versions will be added to ordinary update packages.

After upload, reopen the app online and check the Data footer shows 4.14.8.
The first successful online load prepares the new version for offline use.
