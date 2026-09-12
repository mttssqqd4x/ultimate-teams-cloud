# Ultimate Teams Code Audit — 4.11.21

## Performance changes made
- One bootstrap RPC replaces six separate startup table reads.
- Critical JavaScript begins downloading while HTML parses.
- Repeat opens can render a sanitized cached snapshot immediately.
- Static assets use faster service-worker caching; Supabase API traffic is never cached.
- The duplicate Supabase INITIAL_SESSION startup load is ignored.
- Old whole-document MutationObservers and timer-based cleanup patches are removed from the startup path.
- The 15-second profile polling loop is replaced with realtime plus focus/visibility refresh.
- Push subscription inspection is deferred until idle unless Account is open.
- Data fallback queries request only the columns actually used.

## Problems found
1. The app has accumulated many historical patch layers: dozens of duplicate function declarations plus repeated render wrappers. Later definitions currently win, but this is the biggest long-term regression risk.
2. Teammate Pair Rules were not readable under the database policy, so Teammate generation could silently miss official Pair Rules. Fixed in `update_4_11_21.sql`.
3. `renderAll()` is called for many small changes and rerenders more UI than necessary.
4. Several older patches used MutationObservers on the entire document body, which causes unnecessary work after DOM changes.
5. The optimizer runs synchronously on the main UI thread. With more players/random starts it can temporarily freeze the interface.
6. Inline `onclick` handlers remain widespread and have already caused handler conflicts (for example My Profile).
7. Error handling is inconsistent: alerts, console warnings, and silent fallbacks are mixed.
8. The generator's unequal-team logic is allowed, but the team-count penalty is still very strong, so unequal teams may be chosen less often than expected when balancing an extreme player.

## Best next engineering cleanup
- Consolidate `app.js` into one canonical implementation per function.
- Add regression tests for roles, linked accounts, pair rules, local Teammate history, game overwrite behavior, team-size limits, save/undo winner, and attendance.
- Move generation into a Web Worker.
- Replace broad `renderAll()` calls with targeted section rendering.
- Replace inline handlers with event delegation.

## Useful new features
- Game Quality Meter: Excellent / Good / Fair plus strength difference.
- “Why these teams?” breakdown showing balance, handlers, elite balance, repeat pairings, and Pair Rules.
- Reshuffle modes: Maximum reshuffle, Keep some teammates, Balance only.
- Late-arrival rebalance that suggests the fewest moves needed.
- Game-day dashboard with attendance, game number, team sizes, start time, last result, and balance quality.
- Offline attendance queue that syncs when signal returns.
- RSVP / availability for an upcoming night.
- Expiring Captain notes for injury/availability.
- Head-to-head history and season trends.
- Shareable game-night summary image for the group chat.
