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


## v4.12 clean app rebuild

This version replaces the broken patched `app.js` with a clean rebuilt file.

Fixes:
- restored the missing core `renderAll()` function
- fixed captain Data page access
- fixed inactive-player attendance marking
- attendance now saves to the correct Supabase column: `present`
- inactive players marked present are included in generated teams
- users/guests can see and mark all players but cannot see Number of Teams
- captains/admins can generate teams, clear attendance, and access Data
- captains get limited Data tools: Edit Player name only, View Player Ratings, Download Ratings CSV
- admins get full Data tools


## v4.13 Data page fix

This version fixes the blank Data page by replacing the fragile cloned Data-page layout with explicit Data-page HTML.

Changes:
- Data page renders directly instead of cloning hidden Main-page content
- captains see Player Tools on Data page:
  - Edit Player
  - View Player Ratings
  - Download Ratings CSV
- admins also see full import/settings/reset/backup tools
- Data page counters now update correctly


## v4.14 pairings-only next game flow

This version changes the Generate Teams button behavior when current results have not been saved.

If a captain/admin presses **Generate Teams** while the current game has unsaved results:
- the app shows a reminder that results have not been saved
- choosing **No** cancels so the captain can select a winner and save results
- choosing **Yes** saves teammate pairings/history only
- then the app generates the next teams
- wins/losses and Win/Loss ratings are not updated

This supports rotating teams while still tracking teammate-history pairings.


## v4.15 confirmation popup fix

This version replaces the browser's default Cancel/OK confirmation with a custom yes/no popup.

Changes:
- no more literal `\n` text in the reminder
- no more browser default Cancel/OK wording
- popup now shows:
  - **No, go back**
  - **Yes, continue**
- choosing Yes still saves teammate pairings only and generates the next teams without recording results


## v4.20 protected-tool flash fix and teams collapse

Changes:
- includes the required `app.js` file in the ZIP package
- admin/captain-only tools are hidden by CSS before JavaScript finishes loading
- this prevents guests from briefly seeing admin settings/tools on first load
- JavaScript adds a `role-ready` class only after role visibility has been applied
- generated teams section is collapsed on initial load when no teams exist
- generated teams section opens automatically when teams exist
- added an admin-only **Clear Teams** button
- clearing teams does not change attendance, player ratings, or stats


## v4.21 live team updates and guest clear-state fix

Changes:
- Clear Teams now writes an empty `teams: []` current-game row instead of deleting the row
- guests/users can read that cleared state after refresh
- added Supabase Realtime subscription for `current_game`
- when an admin clears teams, guests/users should see the Current Game section collapse without refreshing
- when a captain/admin generates new teams, everyone should see the teams update without refreshing

Important:
- Run the updated `setup_supabase.sql` if live updates do not work yet.
- The new SQL enables Realtime on `public.current_game`.


## v4.22 Data page status and Win/Loss Records

Changes:
- removed the User / Role / Players / Attending status chip row from the main page
- the status chip row now appears only on the Data page
- added User to the Data page status chip row
- renamed **Attendance And Player Settings** to **Attendance**
- added a fourth Player Tools button: **View Win/Loss Records**
- Win/Loss Records modal includes:
  - search by player name
  - players sorted by games played, most first
  - wins, losses, win %, and Win/Loss rating
  - players with a record shown with a green circled record
  - players without a record shown without the green circle


## v4.23 Player Tools button grid

Changes:
- Player Tools buttons are now in one clean 2×2 grid:
  - Edit Player
  - View Player Ratings
  - View Win/Loss Records
  - Download Ratings CSV
- Buttons are equal width and wrap text cleanly on phones


## v4.24 auth redirect, guest/user split, and account names

Changes:
- sign-up confirmation redirects to `https://nmultimateteams.app`
- app handles Supabase confirmation links and shows an account-confirmed thank-you popup
- guests can only view the Current Game section
- users must create an account/sign in before marking attendance
- Create Account now requires First Name and Last Name
- first/last/full name are sent to Supabase Auth user metadata
- setup SQL adds optional profile name columns


## v4.25 cleaner sign-in/create-account flow

Changes:
- sign-in section title is now **Sign in**
- First Name and Last Name no longer appear in the normal sign-in view
- **Create account** switches to a separate account-creation section
- account-creation section includes First Name, Last Name, Email, and Password
- **Back to sign in** returns to the sign-in section
- sign-in form remains hidden behind the Sign in button


## v4.26 signed-in user pinned in attendance

Changes:
- if a signed-in user's account name matches a player name, that player is pinned to the top of the Attendance list
- all other players stay sorted normally by last name
- the signed-in player row gets a small **You** label
- matching uses profile first/last/full name and Auth metadata first/last/full name


## v4.27 confirmation messaging cleanup

Changes:
- after creating an account, the app now shows a clear **Check your email** popup
- the auth message also stays visible after the account is created
- the account-confirmed popup button now says **Continue**
- **Continue** only closes the popup; it no longer opens the sign-in section
- updated account-confirmed wording for cases where Supabase already signs the user in after confirmation


## v4.28 confirmation-message cleanup and new-tab handling

Changes:
- removed the extra **Check your email** popup
- account-created/check-email message remains in the sign-in section
- fixed the confirmation popup **Continue** button so it closes the popup
- confirmation popup now includes a note for cases where the email opens in a new tab
- added cross-tab auth confirmation refresh using localStorage/BroadcastChannel
  - if the confirmation opens in a second tab, the original app tab can refresh its auth state automatically


## v4.29 hide inactive status from regular users

Changes:
- regular signed-in users no longer see visual differences between active and inactive players in Attendance
- inactive players are still available for attendance marking
- captains/admins still see inactive styling and the Inactive label for roster management


## v4.30 backup import and sign-out confirmation

Changes:
- added **Import Backup JSON** on the Data page
- JSON restore is admin-only
- restore asks for confirmation before replacing current data
- restore imports:
  - players and ratings
  - active/inactive status
  - injury percent and temporary flag
  - games played, wins, losses, Win/Loss rating
  - attendance flags
  - pair rules
  - teammate history
  - algorithm/settings
  - current generated game
- added a confirmation popup before signing out

Notes:
- Backup JSON does not include Supabase Auth users, passwords, or email confirmation data.
- Backup JSON does not include the separate historical `games` log.


## v4.31 web push notifications

Changes:
- added signed-in-user web push notification opt-in under Attendance → Team Notifications
- added Supabase table `push_subscriptions`
- added service-worker push and notification-click handlers
- added admin-only prompt when generating teams: choose whether to send a push notification
- added Supabase Edge Function: `send-team-notification`
- only users who are signed in and opt in on their device can receive push notifications

Setup required:
1. Generate VAPID keys:
   ```bash
   npx web-push generate-vapid-keys
   ```
2. Put the VAPID public key in `config.js`:
   ```js
   VAPID_PUBLIC_KEY: "YOUR_PUBLIC_KEY"
   ```
3. Run the updated `setup_supabase.sql` in Supabase.
4. Deploy the Edge Function in `supabase/functions/send-team-notification`.
5. Add Edge Function secrets in Supabase:
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT`, for example `mailto:samschra44@gmail.com`
   - `SUPABASE_SERVICE_ROLE_KEY`
6. Users sign in and tap **Enable Notifications** on each device that should receive notifications.


## v4.32 account menu and notification toggle

Changes:
- replaced the top-bar **Sign out** button with an **Account** button
- moved team notification controls into the Account popup
- changed notifications to a simple on/off toggle
- kept sign-out inside the Account popup
- kept sign-out confirmation before actually signing out
- improved Safari notification enable flow so the app keeps the toggle on immediately after permission is granted


## v4.33 no-confirmation signup and instructional emails

Changes:
- signup flow now supports Supabase projects with Confirm Email disabled
- new players are automatically signed in after account creation when Confirm Email is off
- after account creation, the app shows a thank-you popup telling the player to check email for basic instructions
- added a Supabase Edge Function: `send-app-info-email`
- the player information email calls them "players," not "users"
- when a player becomes a captain, the app shows a captain popup and sends a captain instruction email
- added `app_info_emails_sent` so player/captain instruction emails only send once per person
- added profile role realtime listening so an open app can notice a role upgrade

Required setup:
1. In Supabase Auth settings, disable Confirm Email for the Email provider.
2. Run the updated `setup_supabase.sql`.
3. Add Edge Function secrets:
   - `RESEND_API_KEY`
   - `APP_EMAIL_FROM`, for example `NM Ultimate Teams <no-reply@nmultimateteams.app>`
   - `APP_URL`, for example `https://nmultimateteams.app`
4. Deploy the new function:
   ```bash
   npx supabase functions deploy send-app-info-email --project-ref fsdqkozqjshqooqwvmhq
   ```


## v4.38 inline dropdown player editing

Changes:
- rebuilt from v4.33 stable base
- removed the separate Edit Player details popup
- each player in Edit Player now has a native dropdown under their name
- Save Changes and Delete Player are inside each player's dropdown
- keeps player/captain/admin permissions
- keeps Win/Loss green/red/neutral badges


## v4.39 inline edit save stability fix

Changes:
- fixed Edit Player dropdown crash after saving changes
- removed CSS.escape dependency from the inline edit reopen logic
- after saving, the Edit Player popup is forced back open and the edited player's dropdown reopens
- delete flow also keeps the Edit Player popup open
- keeps v4.38 inline dropdown editing and Win/Loss green/red/neutral badges


## v4.40 iOS Safari inline edit save fix

Changes:
- changed Edit Player save so it no longer reloads all cloud data after saving
- changed Edit Player save so it no longer re-renders the whole app after saving
- removed the post-save alert popup and replaced it with an inline "Saved." message
- removed smooth scrolling after save
- updates the open player dropdown in place after saving
- delete removes the player row in place
- intended to prevent iOS Safari from closing/crashing the Edit Player popup


## v4.41 settings and results-save repair

Changes:
- fixed Save Settings flow and added a visible save status
- restored Elite Balance Boost as an editable setting
- added typical ranges/help text for algorithm settings
- added SQL migration lines for existing settings tables that are missing newer columns
- added a results-save policy for captains/admins on existing Supabase projects
- improved game-results save flow with stronger error handling
- verified ELO-style Win/Loss logic:
  - team strength = team overall sum
  - expected win = 1 / (1 + 10^((opponent - team) / 4))
  - winner rating increases by K * (1 - expected)
  - loser rating decreases by K * (0 - expected)
  - players get games/wins/losses updated


## v4.42 Add Player section

Changes:
- renamed the Attendance subsection from "Add One-Time Player" to "Add Player"
- kept the Add One-Time Player button for temporary/sub players
- added a new Add Player button that adds the player permanently to the roster
- permanent Add Player also marks the player present for the current game
- both buttons use the same name, ratings, and Rate Like fields


## v4.43 Current Game start time

Changes:
- added the generated/start time next to the Current Game title
- uses the current_game.generated_at value already stored in Supabase
- generating new teams sets the start time
- selecting a winner or saving results no longer resets the start time
- backup restore preserves the current game start time when available


## v4.44 visible game start time and app version

Changes:
- Current Game start time now displays beside the title and also above the teams
- start time is forced to Mountain Time and labeled MT
- if an older current game has no stored generated_at value, the app shows "Started time unavailable"
- added the app version at the bottom of the Data page


## v4.45 start-time and version display cleanup

Changes:
- start time is no longer forced to Mountain Time
- start time now uses the viewer's device/browser local time
- removed the extra start-time line above the teams
- version is shown only at the bottom of the Data page
- version label now says "Version" instead of "App version"


## v4.46 Data-page-only version label

Changes:
- removed the misplaced version label from the main page
- moved Version into the Data page content
- label now shows "Version: v4.46"


## v4.47 Data page version visibility fix

Changes:
- fixed the missing Version label on the Data page
- moved Version into a normal visible Data page card instead of a captain/admin-only hidden card
- shows "Version: v4.47"


## v4.48 Data page version fix

Changes:
- fixed Version still not showing on the Data page
- Version is now created dynamically inside #dataPage on every render
- removes any misplaced duplicate version card outside the Data page
- shows "Version: v4.48"


## 4.7.12 versioning cleanup

Changes:
- removed the box/card around the Version label
- Version now appears as a plain text line at the bottom of the Data page only
- changed version format from one long v4.xx sequence to semantic-style x.y.z
- current version is now 4.7.12

Versioning going forward:
- first number: major app generation
- second number: new feature/change set
- third number: fixes/retries for issues within that feature set
- bug-fix attempts increment the third number instead of creating a whole new feature version


## 4.7.13 Player Tools search layout fix

Changes:
- fixed Player Tools search rows where the Clear button wrapped under the search box
- Edit Player, Win/Loss Records, and Ratings search rows now use a same-line layout
- search box expands to available width and Clear stays beside it


## 4.8.0 backend integrity + realtime update

Important: run `setup_supabase.sql` once in Supabase SQL Editor after uploading this version.

Changes:
- Added server-side RPC `save_game_results(...)` so result saving is atomic and captains can save results without direct rating/stat edit permissions.
- Added server-side RPC `save_pairings_only(...)` for pairings-only saves.
- Added server-side RPC `add_player_from_app(...)` so captains/admins can add one-time or permanent players through a controlled function.
- Captains can now control active/inactive and injury_pct, but cannot directly edit ratings or win/loss stats.
- Added auditable `teammate_pair_events` for future saved games while keeping `teammate_history` counts for anti-repeat.
- Realtime now listens for attendance, players, pair rules, and current game changes.
- Team generation refreshes cloud data immediately before building teams.
- Admin-created pair rules are hidden from the UI but still apply to all team generation.
- Captain-created pair rules are visible to all captains/admins and apply to all team generation.
- Updated config.js to the correct Supabase project URL.
- Removed the Player Tools permissions notice and the requested typical-range helper text.
- Cleaned up unused current-game start-time rendering code.


## 4.8.1 SQL compile fix

Changes:
- fixed PostgreSQL error: "too few parameters specified for RAISE"
- cause was a `%` character in the `prevent_captain_player_edits` RAISE EXCEPTION message
- changed the message to say "injury percent" so the SQL compiles cleanly
- no app behavior change from 4.8.0 other than version number


## 4.8.2 SQL RAISE hard fix

Changes:
- changed static PostgreSQL RAISE EXCEPTION statements to `RAISE EXCEPTION USING MESSAGE = ...`
- this prevents PostgreSQL from treating `%` characters as missing placeholders
- fixes the `too few parameters specified for RAISE` compile error in `prevent_captain_player_edits`


## 4.9.0 history, audit, late-add, and captain notification features

Changes:
- Admins can now view/edit admin-created pair rules in the regular Pair Rules section.
- Captains still cannot see admin pair rules, but those rules still apply during team generation.
- Captain-created pair rules are visible to all captains/admins and apply globally.
- Added Data page buttons/popups for Game History and Teammate History.
- Added admin-only Undo/Void Last Saved Game, supported for games saved after this version creates game-player audit rows.
- Added Late Add Player flow after teams are generated and before results are saved.
- Push notifications can now be sent by captains/admins when teams are generated.
- Added Account popups for a player's own attendance/game history and Win/Loss record.
- Full JSON backup now includes gameHistory, teammatePairEvents, gamePlayerResults, and adminAuditLogs.
- Added admin audit log table for rating edits, player adds, deleted players, and voided games.

Required after upload:
1. Run setup_supabase.sql in Supabase SQL Editor.
2. Redeploy the send-team-notification Edge Function so captains can send notifications too:
   npx supabase functions deploy send-team-notification --project-ref fsdqkozqjshqooqwvmhq


## 4.9.1 UI deploy/cache hardening

Changes:
- fixes case where app version updated to 4.9.0 but new buttons did not appear
- new 4.9 tools are now created by JavaScript if the deployed/cached index.html is missing them
- adds stable IDs to the new Data page, Account, and Late Add buttons
- no Supabase SQL changes from 4.9.0


## 4.9.2 Player tool sort controls

Changes:
- added Sort by controls above player search rows in Edit Player, Player Ratings, and Win/Loss Records
- sort options include name A-Z/Z-A, overall rating, Win/Loss rating, Win %, games played, handling, cutting, defense, active first, and inactive first
- sort controls are also injected by JavaScript if a cached/older index.html is missing them
- no Supabase SQL changes


## 4.9.3 Active/inactive moved to Edit Player

Changes:
- removed the Active/Inactive button from the Attendance player rows
- added Status Active/Inactive to each player dropdown in Data page -> Edit Player
- added Injury / Availability % to the same Edit Player dropdown
- captains/admins can save player status and injury/availability from Edit Player
- marking a player present automatically makes that player active
- added `mark_attendance_from_app(...)` RPC so attendance saves and auto-active behavior are handled consistently


## 4.9.4 Edit Player compact rows and sort defaults

Changes:
- Edit Player collapsed rows now only show player name and Active/Inactive on one line
- removed "Tap to edit" from Edit Player rows
- removed rating, Win/Loss, games, wins, and losses text from the collapsed Edit Player rows
- Edit Player sort defaults to Name A-Z
- Player Ratings sort defaults to Overall rating high-low
- Win/Loss Records sort defaults to Win/Loss rating high-low
- no Supabase SQL changes


## 4.9.5 Delete game from history

Changes:
- admins can delete a saved game directly from the View Game History popup
- added admin-only `delete_game_from_history(game_id)` RPC
- deleting a pairings-only game removes its teammate pair events and decrements teammate-history counts
- deleting a result game saved with audit rows subtracts that game's Win/Loss, games played, wins, and losses changes from player records
- deletes rating-history rows tied to the game where available
- deletes game-player result audit rows and teammate-pair events through game-row cascade
- logs the deletion in admin audit logs
- old Undo/Void Last Saved Game now uses the same safer selected-game delete logic
- added `rating_history.game_id` for cleaner future deletion/audit


## 4.9.6 Late Add search and Edit Player active toggle

Changes:
- late add existing player picker is now a searchable/sortable popup list instead of a long dropdown
- late add existing player now uses the attendance RPC and automatically makes inactive players active
- Edit Player list now has a direct Active/Inactive button beside each name
- tapping the Active/Inactive button does not open the player dropdown
- saved Edit Player rows stay compact instead of expanding into rating/win-loss text
- modal headers are sticky so the Close button stays easier to reach while scrolling
- no Supabase SQL changes
