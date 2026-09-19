# Ultimate Teams — 4.15.7

## This update

- Injury / Availability is a compact labeled number field in the hold menu,
  matching Number of Teams. Enter 0–100; change the value or press Enter to save.
  Save status and retry stay inside the menu. Edit Player uses the same field
  style and its existing Save Changes button.
- Fixed zero-percent availability being treated as 100% by rating calculations.
- Installed apps request portrait orientation. On phones that cannot enforce a
  native lock, a Rotate your phone screen covers the app in landscape, including
  Sandbox. Returning to portrait restores the current page and editor state.
  Opening the keyboard does not activate the landscape screen. Desktop/tablet
  web views are not covered by the phone fallback.
- iPhone users can enable Control Center’s Portrait Orientation Lock to stop
  physical display rotation. The web fallback does not change iOS system settings.
  See [Apple instructions](https://support.apple.com/en-us/118226) and
  [browser orientation support](https://developer.mozilla.org/en-US/docs/Web/API/ScreenOrientation/lock).
- Previous startup, daily reset, balancing, and tap fixes are retained.

Local checks cover injury validation/saving/retry, role checks, zero-percent
scoring, phone orientation and keyboard detection, syntax, and release references.
Actual iPhone visual and rotation verification was unavailable.

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
once more if needed. The Data footer should show **4.15.7**. Later cached launches
use the installed release immediately. First-ever use still requires a connection.
Keep database scripts and Supabase function sources as project maintenance files.
