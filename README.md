# Ultimate Teams Cloud v2

This package updates the Supabase cloud app with the access rules you requested.

## Main changes

- Guests can open the app without signing in.
- No test connection button.
- Guests/users can mark attendance.
- Guests/users can generate teams.
- Guests/users cannot save results.
- Guests/users cannot see player ratings or team ratings in the UI.
- Captains/admins can see ratings, pick winners, and save results.
- The two bottom buttons were replaced with one button: **Generate Teams**.
- If a captain/admin presses **Generate Teams** while the current game has unsaved results, the app asks whether to save results first.

## Important security note

This version hides ratings from guests/users in the app UI. Because the same browser app still needs player ratings to run the team-balancing algorithm, a technical user could still inspect network/browser data and find ratings.

For true rating secrecy, the team-generation algorithm must run server-side, such as in a Supabase Edge Function or backend API, and return only player names/team assignments to guests.

## Supabase URL

Use this in `config.js`:

```text
https://fsdqkozqkshqwvmhq.supabase.co
```

Do not include `/rest/v1/`.

## Setup

1. Unzip this package.
2. Edit `config.js` and paste your Supabase publishable/anon key.
3. In Supabase SQL Editor, run the full `setup_supabase.sql` file.
4. Upload all files to the root of a new GitHub repo.
5. In GitHub: Settings → Pages → Source → GitHub Actions.
6. Open the deployed GitHub Pages URL.

If you already ran v1 SQL, run this v2 SQL again. It is designed to recreate the RLS policies.

## Make yourself admin

After creating your account in the app, run this in Supabase SQL Editor:

```sql
update public.profiles
set role='admin'
where email='samschra44@gmail.com';
```

Then sign out and back in.

## Roles

### Guest / User
Can:
- view the main app
- mark attendance
- generate teams

Cannot:
- see ratings in the UI
- save results
- access the Data tab
- import CSVs
- reset stats/history

### Captain
Can:
- see ratings
- add one-time players
- manage pair rules
- generate teams
- select winner
- save results

### Admin
Can do everything captain can, plus:
- import CSVs
- reset season stats
- reset teammate history
- export CSVs/JSON
- edit settings

## CSV import format

```csv
First Name,Last Name,Handling,Cutting,Defense,Win/Loss
Sam,Schrader,7,7,7,0.00
Chris,Trujillo,6,6,6,0.00
```

## iPhone

Open the clean GitHub Pages URL in Safari and use Add to Home Screen. Do not use a `?v=` URL for the Home Screen app.


## v3 changes

This version adds a safe Season Stats CSV import for moving data from the old local app into the cloud app.

Use this import after importing active and inactive player ratings. It updates only:
- Games Played
- Wins
- Losses

It does not overwrite:
- Handling
- Cutting
- Defense
- Win/Loss rating
- active/inactive status

This version also restores Lock Pair behavior from the local app. Lock Pair creates a very strong pair rule using strength `999`, matching the local app behavior.

Pair Rules are now admin-only in the cloud app:
- admins can see and edit pair rules
- captains cannot see or edit pair rules
- users/guests cannot see or edit pair rules

The team-generation scoring was updated to match the newer local app structure more closely:
- team count balance
- overall balance
- handling balance
- cutting balance
- defense balance
- pair rule penalties
- teammate-history penalties
- handler-separation priority
- elite-player balance priority

The multi-team result update now scales K-factor across opponents so a single saved game counts as one game, matching the newer local app behavior.


## v4 changes

### Captain-owned pair rules
Captains can now create and see their own pair rules.

- Captains can create pair rules.
- Captains can see/remove only the pair rules they created.
- Admins can see/manage all pair rules.
- Guests/users cannot see or edit pair rules.

This requires the new `created_by` column and updated RLS policies in `setup_supabase.sql`.

### Lock Pair restored
The Pair Rules section now includes **Lock Pair**.

Lock Pair creates a very strong pair rule using strength `999`, matching the local app behavior.

### Sign-in moved off the main page
The sign-in form no longer sits on the main page.

Guests see a simple **Sign in** button in the top bar. Pressing it opens the sign-in page. The main app remains available without signing in.

### SQL update required
Run the v4 `setup_supabase.sql` in Supabase even if you already ran v3. It adds `pair_rules.created_by` and replaces pair-rule policies.


## v5 fix

This version fixes the blank Sign in page.

The sign-in page now uses explicit display switching instead of relying only on the shared hidden class. The top-bar Sign in button opens the form, and the Back button returns to the main app.
