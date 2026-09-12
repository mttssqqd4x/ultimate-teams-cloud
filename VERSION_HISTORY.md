# Ultimate Teams — Version History Overview


### 4.13.1
- Combined the one-time player **Make Permanent** and **Remove** controls into a single **One-Time ▾** action button with a compact two-choice popup.

The project changed versioning schemes over time. The earliest local app used simple integer releases (v1, v2, …); the cloud rebuild used v2/v3/v4.x; semantic-style numbering was adopted at 4.7.12. Treat the original v1 as the 1.0.0-era starting point.

## Local app era
- v1–v11: foundation of the local/offline phone app: roster ratings, attendance, balanced team generation, teammate anti-repeat history, pair rules, injuries, optional results/Elo, CSV import/export, backup/restore, import preview, season reset, and dated exports. Exact per-release notes for v1–v11 were not preserved.
- v12–v14: attendance/UI cleanup, Main/Data navigation, one-time-player workflow, and a cleaner Data page.
- v15–v18: moved anti-repeat settings, repaired CSV preview/import, and added optional Combined-column compatibility.
- v19–v26: navigation/button cleanup, attendance confirmation, Pair Rules fixes/redesign, and Data tools including weights, ratings, rating changes, simulation, auto-balance, K-factor, and Lock Pair.
- v27–v31: improved simulations and rating-history behavior, fixed multi-team Elo scaling, and expanded locked pair-rule controls.
- v33–v39: player delete/edit tools, safer CSV imports, handler separation, elite-player balancing, a rewritten team generator, and Edit Player stability. (No preserved v32 release note.)

## Supabase/cloud era
- v2–v4.15: moved to Supabase with guest/user/captain/admin permissions, cloud attendance/team generation, captain-owned Pair Rules, Data tools, inactive-player handling, pairings-only next-game flow, and custom confirmations.
- v4.20–v4.33: live Current Game updates, Win/Loss records, account creation/profile metadata, pinned self-attendance, backup restore, web push notifications, Account menu, and instructional emails. Preserved notes do not include v4.16–v4.19.
- v4.38–v4.48: inline Edit Player, iOS save stability, settings/results-save repairs, permanent Add Player, game start time, and the Data-page version label. Preserved notes do not include v4.34–v4.37.

## Semantic-style era
- 4.7.12–4.7.13: adopted x.y.z numbering and cleaned Player Tools search layout.
- 4.8.0–4.8.2: major backend-integrity update with server-side RPCs, stronger permissions, realtime data, auditable pair events, plus SQL compile fixes.
- 4.9.0–4.9.11: Game/Teammate History, audit logs, undo/delete saved games, Late Add, account history, sortable player tools, active/inactive editing, sticky/mobile popup fixes, and visual record fixes.
- 4.10.0–4.10.8: My Profile, history filters, season archive, Manual Move, personalized notifications, setup checklist, account management, safer restores, attendance filters, and follow-up UI/loading fixes.
- 4.11.0–4.11.21: retroactive winner/clear-winner tools, four-role Player/Teammate/Captain/Admin model, self-attendance security, linked profiles, local Teammate team generation and daily anti-repeat history, flexible team sizes, and a much faster bootstrap/startup path.
- 4.12.0: major architecture refactor; canonical app layer, Balance Quality, reshuffle modes, Smart Add & Rebalance, offline attendance queue, Game Night Dashboard, saved-result-only teammate profile stats, test sandbox, and liquid-glass UI.
- 4.12.1–4.12.5: full visual redesign, fixed/cache-safe versioned assets, fixed sandbox launch, more compact dashboard/attendance, consistent rounding, and a full isolated copy of Main for Player/Teammate/Captain/Admin simulation. (No preserved 4.12.3 release note.)
- 4.12.6–4.12.7: header/translucency cleanup, removed stray Current Game/Account visual artifacts, and tightened Roster & App Settings.
- 4.12.8: Dashboard-only interactive Balance Rating, interactive Last Winner roster, Generate Teams click shield, and Number of Teams moved to the top of Attendance.
- 4.12.9: blue Sandbox headers so test mode is immediately obvious.


### 4.13.0
- Sandbox blue styling is limited to the outer sandbox controls.
- Added Make Permanent for one-time players without recreating their player record.
- Removed the Current Game start-time display.
