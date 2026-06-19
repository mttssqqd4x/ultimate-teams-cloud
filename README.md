# Ultimate Teams Cloud

This is a fresh GitHub Pages + Supabase version of the Ultimate Teams app.

It keeps the same black mobile-friendly look and the same general team-balancing algorithm:
- handling / cutting / defense ratings
- injury adjustment
- Win/Loss rating
- pair rules
- teammate history anti-repeat
- multiple teams
- tap winner and save results
- season stats
- date-based CSV exports

The big change is that data is stored in Supabase instead of only on one phone.

## Important Supabase URL note

The app config needs the project base URL, not the REST endpoint.

Use this in `config.js`:

```text
https://fsdqkozqkshqwvmhq.supabase.co
```

Do not include `/rest/v1/`.

## Files in this package

```text
index.html
app.js
config.js
manifest.json
service-worker.js
setup_supabase.sql
README.md
.github/workflows/deploy-pages.yml
```

## Step 1: Create a new GitHub repo

1. Go to GitHub.
2. Create a new repository.
3. Suggested name:

```text
ultimate-teams-cloud
```

4. Keep it private while building if you want.
5. Do not upload the ZIP itself. Upload the files inside the ZIP.

## Step 2: Set up Supabase tables

1. Open Supabase.
2. Open your project.
3. Go to SQL Editor.
4. Open the file:

```text
setup_supabase.sql
```

5. Copy the entire SQL file.
6. Paste it into Supabase SQL Editor.
7. Run it.

This creates:
- profiles
- players
- attendance
- pair_rules
- teammate_history
- settings
- current_game
- games
- rating_history

It also enables Row Level Security and creates policies.

## Step 3: Get your Supabase publishable or anon key

In Supabase:

```text
Project Settings → API Keys
```

Copy either:
- publishable key, or
- anon public key

Do not copy:
- secret key
- service_role key

Those are not safe for browser apps.

## Step 4: Edit config.js

Open:

```text
config.js
```

It currently contains:

```javascript
window.ULTIMATE_TEAMS_CONFIG = {
  SUPABASE_URL: "https://fsdqkozqkshqwvmhq.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "PASTE_YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY_HERE"
};
```

Replace:

```text
PASTE_YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY_HERE
```

with your real publishable/anon key.

## Step 5: Upload files to GitHub

In your new GitHub repo:

1. Click Add file.
2. Click Upload files.
3. Upload everything from the unzipped package:
   - `index.html`
   - `app.js`
   - `config.js`
   - `manifest.json`
   - `service-worker.js`
   - `setup_supabase.sql`
   - `README.md`
   - `.github/workflows/deploy-pages.yml`
4. Commit to `main`.

Make sure `.github` uploads correctly. The repo root should show `index.html` directly.

## Step 6: Turn on GitHub Pages

1. Go to the repo.
2. Go to Settings.
3. Go to Pages.
4. For Source, choose:

```text
GitHub Actions
```

5. Go to Actions.
6. Wait for the deploy workflow to finish.

Your app URL will look like:

```text
https://YOUR_USERNAME.github.io/ultimate-teams-cloud/
```

## Step 7: Create your first account

1. Open the GitHub Pages app URL.
2. Enter your email.
3. Enter a password.
4. Tap Create account.
5. If Supabase asks for email confirmation, check your email and confirm.
6. Sign in.

At first, your account will be a normal user.

## Step 8: Make yourself admin

After you sign up once, go back to Supabase SQL Editor and run:

```sql
update public.profiles
set role = 'admin'
where email = 'samschra44@gmail.com';
```

Then sign out and sign back into the app.

You should now see the Data tab.

## Step 9: Add captains or regular users

After another person creates an account, you can promote them.

Captain:

```sql
update public.profiles
set role = 'captain'
where email = 'friend@example.com';
```

Regular user:

```sql
update public.profiles
set role = 'user'
where email = 'friend@example.com';
```

## Permissions

### Admin
Can:
- import CSVs
- update player ratings
- reset season stats
- reset teammate history
- update algorithm settings
- generate teams
- save teams
- save results
- export CSVs and JSON

### Captain
Can:
- mark attendance
- add one-time players
- add pair rules
- generate teams
- save teams
- save results

### User
Can:
- sign in
- view players
- view teams
- mark attendance

## Step 10: Import your CSV files

As admin:

1. Open Data.
2. Paste your active CSV.
3. Tap Preview Active CSV.
4. If it looks good, tap Import Active CSV.
5. Paste inactive CSV if needed.
6. Tap Preview Inactive CSV.
7. Tap Import Inactive CSV.

Required CSV columns:

```csv
First Name,Last Name,Handling,Cutting,Defense,Win/Loss
Sam,Schrader,7,7,7,0.00
Chris,Trujillo,6,6,6,0.00
```

## Step 11: Use on iPhone

1. Open the clean GitHub Pages URL in Safari.
2. Sign in.
3. Tap Share.
4. Tap Add to Home Screen.

Use the clean URL. Do not add `?v=...` to the Home Screen version.

## Backup and exports

Backup JSON downloads:

```text
YYYYMMDD_ultimate-teams-cloud-backup.json
```

Ratings CSV downloads:

```text
YYYYMMDD_active_players.csv
YYYYMMDD_inactive_players.csv
YYYYMMDD_season_stats.csv
```

The cloud database is the source of truth. JSON/CSV exports are extra backups.

## What changed compared to the old local-only version

Old version:
- data lived on one phone/browser
- great offline
- difficult to share across devices

Cloud version:
- data lives in Supabase
- usable by multiple devices
- admin/captain/user roles
- needs internet to sync data

## Safety rules

Do not put these in `config.js`:
- service_role key
- secret key
- database password
- GitHub token

Only use:
- Supabase project URL
- Supabase publishable/anon key

The database security comes from Row Level Security policies in `setup_supabase.sql`.

## Troubleshooting

### "Config missing"
Open `config.js` and paste the Supabase publishable/anon key.

### "Invalid login credentials"
Create an account first, or reset the password in Supabase.

### "Email not confirmed"
Confirm your email, or in Supabase Auth settings disable email confirmation while testing.

### I do not see the Data tab
Your account is not admin yet. Run:

```sql
update public.profiles
set role = 'admin'
where email = 'samschra44@gmail.com';
```

Then sign out and sign in again.

### Import fails
Check:
- you are admin
- CSV headers are correct
- the SQL setup ran successfully
- RLS policies exist

### GitHub Pages shows old version
Wait for Actions to finish, then refresh Safari. If needed, open the clean URL in a private tab once.

## Notes

This is a first cloud-ready package. It keeps the same basic look and algorithm but changes storage from localStorage to Supabase.

Recommended next polish:
- admin user-management screen
- edit-player modal
- real-time live updates
- password reset link
- stricter attendance permissions
