# Ultimate Teams — 4.15.5

## 4.15.5

- Generate Teams now transitions from fully visible to fully hidden over about **200 px** of scrolling after Search Players reaches the sticky header.
- Scrolling back up reverses the same distance-linked motion.
- Smooth Main/Data scroll-to-top behavior from v4.15.4 remains unchanged.

This is the complete cleaned project. It preserves the uploaded app behavior,
Supabase configuration, custom domain, database scripts, and backend functions.
No SQL changes or backend redeployment are needed for this cleanup.


## This update

- **Search Players** is now the exact Generate Teams visibility threshold.
- If anything above Search Players is visible below the sticky header, the Generate Teams dock returns all the way.
- After Search Players moves about 200 px behind the header, the dock is fully hidden and stays hidden while you remain deeper in the attendance list.
- Tapping **Main** always returns the Main page to the top, even if Main is already selected.
- Tapping **Data** always returns the Data page to the top, even if Data is already selected.
- The scroll-to-top behavior works with both normal Safari/desktop scrolling and the iOS Home Screen app's internal scroller.
- The more opaque/vibrant Generate Teams styling from v4.15.0 remains unchanged.

No SQL changes or backend redeployment are needed. Replace the same files.

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
For example, `app.js?v=4.15.5` still refers to the single file `app.js`.
No tests, audit reports, dated release notes, backup copies, or obsolete asset
versions will be added to ordinary update packages.

After upload, reopen the app online and check the Data footer shows 4.15.5.
The first successful online load prepares the new version for offline use.
