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
Captains can now create, view, and delete their own pair rules.

Captains cannot see or delete other captains' pair rules.

Admins can see and manage all pair rules.

Guests and regular users cannot see pair rules.

### Sign-in button
The sign-in section no longer sits open on the main page.

Guests see a small **Sign in** button. Tapping it opens the sign-in form.

Signed-in users see **Sign out** instead.

### SQL update required
Run the new `setup_supabase.sql` again in Supabase.

The v4 SQL adds pair-rule ownership with a `created_by` column and updates Row Level Security policies.


## v4.1 fix

This version fixes the top **Sign in** button.

The sign-in form is now hidden by default and the button explicitly toggles the form open/closed.


## v4.2 fix

This version changes guest/user visibility:
- guests and regular users do not see Pair Rules
- guests and regular users do not see Add One-Time Player
- captains/admins still see those tools
- sign-in panel is forced hidden by default on page load
- Sign in button is the only way to open the sign-in panel


## v4.3 sort update

This version changes UI sorting to sort players by last name first.

Sorting behavior:
- players with last names appear before players without last names
- then sort by last name
- then sort by first name
- CSV files keep their existing export format and behavior


## v4.4 fix

This version fixes the sign-in button after login:
- Sign in button hides when a user is signed in
- Sign out button shows when signed in
- Sign in button returns only after signing out


## v4.5 permissions update

### Guests / users
Can:
- view the main page
- mark attendance

Cannot:
- generate teams
- clear attendance
- see the Generate Teams button
- see Clear Attendance
- see Pair Rules
- see Add One-Time Player
- see ratings
- access the Data page

### Captains
Can:
- mark attendance
- clear attendance
- generate teams
- save results
- use their own pair rules
- add one-time players
- access the Data page
- view player ratings
- download CSV files
- edit player names only

Cannot:
- edit player ratings
- import CSVs
- reset season stats
- reset teammate history
- change algorithm settings
- see other captains' pair rules

### Admins
Can:
- access all tools
- import CSVs
- import season stats
- edit names and ratings
- reset stats/history
- change settings

Run `setup_supabase.sql` again for v4.5. It adds a database trigger so captains can update names but cannot update rating/stat fields.


## v4.6 Data page tool fix

This version fixes the Data page tools:
- Edit Player opens correctly
- View Player Ratings opens correctly
- both buttons are placed directly above Export Backup JSON and Download Ratings CSV in the Load/Edit tools
- removed the separate captain tools card
- captains can edit names only
- admins can edit names and ratings

Run `setup_supabase.sql` again if captain name edits are blocked.


## v4.7 modal placement fix

This version fixes the Edit Player and View Player Ratings tools appearing at the bottom of pages.

Changes:
- the Edit Player and View Player Ratings modal sections are forced hidden by default
- those tools only open inside pop-up modals after their buttons are tapped
- the buttons are only injected into the Data page, above Backup JSON and Download Ratings CSV
- the separate bottom/duplicate buttons were removed


## v4.8 button placement fix

This version fixes the missing Data page buttons.

Changes:
- Edit Player and View Player Ratings are now placed directly in the Data page HTML
- they are no longer dependent on JavaScript injection
- they are still hidden from guests/users
- modals remain hidden until the buttons are tapped
- a copy is also included in the Data page Load/Edit area above Backup JSON / Download Ratings CSV when the Load/Edit section is rendered


## v4.9 attendance and user-view update

Changes:
- inactive players can be marked present
- present players now include inactive players if they are marked attending
- guests/users see all players by default
- guests/users cannot see or use Show/Hide Inactive Players
- guests/users cannot see Number of Teams
- captains/admins still have the inactive filter and Number of Teams control


## v4.10 role visibility fix

Fixes:
- regular users/guests can no longer see or edit Number of Teams
- Number of Teams is disabled and hidden unless signed in as captain/admin
- captains now get the Data page button after sign-in
- Data page remains hidden from guests/users


## v4.11 captain/data and inactive attendance fix

This version adds final override logic for:
- captain role detection
- Data tab visibility for captains/admins
- inactive-player attendance selection
- present-player inclusion for inactive players marked present
- users/guests seeing all players while still not seeing Number of Teams
