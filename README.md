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
