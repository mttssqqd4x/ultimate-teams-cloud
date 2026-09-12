# Ultimate Teams 4.12.0 Refactor

## Architecture
- `legacy-core.js` contains the pre-4.12 compatibility implementation so older features remain available.
- `app.js` is the new canonical layer for startup, scoring/generation, balance quality, reshuffle modes, attendance/offline sync, profile, dashboard, late-player smart rebalance, and the test sandbox.
- `styles-4120.css` owns the new dark translucent UI.
- New features should be added to `app.js`; do not append versioned override blocks to `legacy-core.js`.

## New features
- Balance Quality score and label.
- Normal / Maximum Reshuffle / Balance Only generation modes.
- Late-player Smart Add & Rebalance.
- Offline attendance queue with automatic reconnect sync.
- Game Night Dashboard.
- My Profile teammate list counts saved-result games only.
- Captain/Captain/Admin Test Sandbox: local copy of attendance, Pair Rules, generation, results simulation, and late-player rebalance with zero database writes.
- Dark liquid-glass visual refresh.

## Maintenance rule
4.12.0 stops the old pattern of adding another patch block to the bottom of the 9k-line file. Historical code is quarantined; active behavior is centralized in the new `app.js`. A future deeper migration can move remaining unchanged legacy admin/import/history tools into modules one subsystem at a time without changing behavior.
