-- Ultimate Teams Cloud Supabase setup v2
-- Run this entire file in Supabase SQL Editor. Safe to rerun.
create extension if not exists pgcrypto;
do $$ begin if not exists (select 1 from pg_type where typname='app_role') then create type public.app_role as enum ('admin','captain','user'); end if; end $$;
create table if not exists public.profiles(id uuid primary key references auth.users(id) on delete cascade,email text unique,role public.app_role not null default 'user',created_at timestamptz not null default now());
create table if not exists public.players(id uuid primary key default gen_random_uuid(),first_name text not null,last_name text not null,full_name text generated always as (trim(first_name||' '||last_name)) stored,handling numeric not null default 0,cutting numeric not null default 0,defense numeric not null default 0,win_loss numeric not null default 0,active boolean not null default true,injury_pct numeric not null default 1.0,temporary boolean not null default false,games_played integer not null default 0,wins integer not null default 0,losses integer not null default 0,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(first_name,last_name));
create table if not exists public.attendance(player_id uuid primary key references public.players(id) on delete cascade,present boolean not null default false,updated_at timestamptz not null default now(),updated_by uuid references auth.users(id));
create table if not exists public.pair_rules(id uuid primary key default gen_random_uuid(),player1_id uuid not null references public.players(id) on delete cascade,player2_id uuid not null references public.players(id) on delete cascade,rule_type text not null check(rule_type in('together','apart')),strength numeric not null default 1.0,created_at timestamptz not null default now());
create table if not exists public.teammate_history(player_a uuid not null references public.players(id) on delete cascade,player_b uuid not null references public.players(id) on delete cascade,count integer not null default 0,primary key(player_a,player_b),check(player_a<player_b));
create table if not exists public.settings(id text primary key default 'main',weight_handling numeric not null default .35,weight_cutting numeric not null default .35,weight_defense numeric not null default .30,k_factor numeric not null default .08,repeat_weight numeric not null default 4.0,prioritize_handler_separation boolean not null default false,handler_separation_boost numeric not null default 2.0,prioritize_elite_balance boolean not null default false,elite_balance_boost numeric not null default 2.0,updated_at timestamptz not null default now());
insert into public.settings(id) values('main') on conflict(id) do nothing;
create table if not exists public.current_game(id text primary key default 'main',teams jsonb,selected_winner_index integer,results_saved boolean not null default false,generated_at timestamptz,updated_by uuid references auth.users(id));
insert into public.current_game(id) values('main') on conflict(id) do nothing;
create table if not exists public.games(id uuid primary key default gen_random_uuid(),played_at timestamptz not null default now(),teams jsonb not null,winner_team_index integer,created_by uuid references auth.users(id));
create table if not exists public.rating_history(id uuid primary key default gen_random_uuid(),player_id uuid not null references public.players(id) on delete cascade,value numeric not null,created_at timestamptz not null default now());
create or replace function public.is_admin() returns boolean language sql security definer set search_path=public as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin'); $$;
create or replace function public.can_manage_games() returns boolean language sql security definer set search_path=public as $$ select exists(select 1 from public.profiles where id=auth.uid() and role in('admin','captain')); $$;
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$ begin insert into public.profiles(id,email,role) values(new.id,new.email,'user') on conflict(id) do nothing; return new; end; $$;
drop trigger if exists on_auth_user_created on auth.users; create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
alter table public.profiles enable row level security; alter table public.players enable row level security; alter table public.attendance enable row level security; alter table public.pair_rules enable row level security; alter table public.teammate_history enable row level security; alter table public.settings enable row level security; alter table public.current_game enable row level security; alter table public.games enable row level security; alter table public.rating_history enable row level security;
-- Drop old/new policies
DO $$ DECLARE r record; BEGIN FOR r IN SELECT schemaname,tablename,policyname FROM pg_policies WHERE schemaname='public' AND tablename IN ('profiles','players','attendance','pair_rules','teammate_history','settings','current_game','games','rating_history') LOOP EXECUTE format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename); END LOOP; END $$;
-- Profiles: signed-in users can read profiles; admins can update roles.
create policy profiles_select_authenticated on public.profiles for select to authenticated using(true);
create policy profiles_update_admin on public.profiles for update to authenticated using(public.is_admin()) with check(public.is_admin());
-- Public app access: guests can read the shared app data needed to generate teams and mark attendance.
create policy players_select_public on public.players for select to anon, authenticated using(true);
create policy attendance_select_public on public.attendance for select to anon, authenticated using(true);
create policy attendance_insert_public on public.attendance for insert to anon, authenticated with check(true);
create policy attendance_update_public on public.attendance for update to anon, authenticated using(true) with check(true);
create policy pair_rules_select_public on public.pair_rules for select to anon, authenticated using(true);
create policy history_select_public on public.teammate_history for select to anon, authenticated using(true);
create policy settings_select_public on public.settings for select to anon, authenticated using(true);
create policy current_game_select_public on public.current_game for select to anon, authenticated using(true);
create policy current_game_insert_public on public.current_game for insert to anon, authenticated with check(id='main');
create policy current_game_update_public on public.current_game for update to anon, authenticated using(id='main') with check(id='main');
create policy games_select_public on public.games for select to anon, authenticated using(true);
-- Admin/captain writes.
create policy players_insert_admin on public.players for insert to authenticated with check(public.is_admin());
create policy players_update_admin on public.players for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy players_delete_admin on public.players for delete to authenticated using(public.is_admin());
create policy pair_rules_manage_captain on public.pair_rules for all to authenticated using(public.can_manage_games()) with check(public.can_manage_games());
create policy history_manage_captain on public.teammate_history for all to authenticated using(public.can_manage_games()) with check(public.can_manage_games());
create policy settings_update_admin on public.settings for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy settings_insert_admin on public.settings for insert to authenticated with check(public.is_admin());
create policy games_insert_captain on public.games for insert to authenticated with check(public.can_manage_games());
create policy rating_history_select_authenticated on public.rating_history for select to authenticated using(true);
create policy rating_history_insert_captain on public.rating_history for insert to authenticated with check(public.can_manage_games());
-- After signing up in the app, make yourself admin:
-- update public.profiles set role='admin' where email='samschra44@gmail.com';


-- v4 pair-rule ownership update
alter table public.pair_rules
add column if not exists created_by uuid references auth.users(id);

drop policy if exists pair_rules_select_public on public.pair_rules;
drop policy if exists pair_rules_select_authenticated on public.pair_rules;
drop policy if exists pair_rules_manage_admin on public.pair_rules;
drop policy if exists pair_rules_manage_captain on public.pair_rules;
drop policy if exists pair_rules_select_admin_or_own_captain on public.pair_rules;
drop policy if exists pair_rules_insert_admin_or_captain on public.pair_rules;
drop policy if exists pair_rules_update_admin_or_own_captain on public.pair_rules;
drop policy if exists pair_rules_delete_admin_or_own_captain on public.pair_rules;

create policy pair_rules_select_admin_or_own_captain
on public.pair_rules
for select
to authenticated
using (
  public.is_admin()
  or (
    public.can_manage_games()
    and created_by = auth.uid()
  )
);

create policy pair_rules_insert_admin_or_captain
on public.pair_rules
for insert
to authenticated
with check (
  public.is_admin()
  or (
    public.can_manage_games()
    and created_by = auth.uid()
  )
);

create policy pair_rules_update_admin_or_own_captain
on public.pair_rules
for update
to authenticated
using (
  public.is_admin()
  or (
    public.can_manage_games()
    and created_by = auth.uid()
  )
)
with check (
  public.is_admin()
  or (
    public.can_manage_games()
    and created_by = auth.uid()
  )
);

create policy pair_rules_delete_admin_or_own_captain
on public.pair_rules
for delete
to authenticated
using (
  public.is_admin()
  or (
    public.can_manage_games()
    and created_by = auth.uid()
  )
);


-- v4.5 player-name edit permissions for captains
-- Captains may edit player names, but this trigger blocks them from changing ratings/stats/status fields.
create or replace function public.prevent_captain_rating_edits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  user_role public.app_role;
begin
  select role into user_role from public.profiles where id = auth.uid();

  if user_role = 'captain' then
    if new.handling is distinct from old.handling
       or new.cutting is distinct from old.cutting
       or new.defense is distinct from old.defense
       or new.win_loss is distinct from old.win_loss
       or new.active is distinct from old.active
       or new.injury_pct is distinct from old.injury_pct
       or new.temporary is distinct from old.temporary
       or new.games_played is distinct from old.games_played
       or new.wins is distinct from old.wins
       or new.losses is distinct from old.losses then
      raise exception 'Captains can edit player names only.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_captain_rating_edits_trigger on public.players;
create trigger prevent_captain_rating_edits_trigger
before update on public.players
for each row execute function public.prevent_captain_rating_edits();

drop policy if exists players_update_admin_or_captain_name on public.players;
drop policy if exists players_update_admin on public.players;

create policy players_update_admin_or_captain_name
on public.players
for update
to authenticated
using (
  public.is_admin() or public.can_manage_games()
)
with check (
  public.is_admin() or public.can_manage_games()
);


-- v4.6 captain name edit safety refresh
create or replace function public.prevent_captain_rating_edits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  user_role public.app_role;
begin
  select role into user_role from public.profiles where id = auth.uid();

  if user_role = 'captain' then
    if new.handling is distinct from old.handling
       or new.cutting is distinct from old.cutting
       or new.defense is distinct from old.defense
       or new.win_loss is distinct from old.win_loss
       or new.active is distinct from old.active
       or new.injury_pct is distinct from old.injury_pct
       or new.temporary is distinct from old.temporary
       or new.games_played is distinct from old.games_played
       or new.wins is distinct from old.wins
       or new.losses is distinct from old.losses then
      raise exception 'Captains can edit player names only.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_captain_rating_edits_trigger on public.players;
create trigger prevent_captain_rating_edits_trigger
before update on public.players
for each row execute function public.prevent_captain_rating_edits();

drop policy if exists players_update_admin_or_captain_name on public.players;
drop policy if exists players_update_admin on public.players;

create policy players_update_admin_or_captain_name
on public.players
for update
to authenticated
using (
  public.is_admin() or public.can_manage_games()
)
with check (
  public.is_admin() or public.can_manage_games()
);


-- v4.21: Enable live current-game updates for all clients.
-- Run this once in Supabase SQL Editor if teams do not update live across devices.
do $$
begin
  alter publication supabase_realtime add table public.current_game;
exception
  when duplicate_object then null;
end $$;


-- v4.24: optional profile name fields for account-created first/last name.
alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;
alter table public.profiles add column if not exists full_name text;


-- v4.31: Web push notification subscriptions.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
drop policy if exists "push_subscriptions_insert_own" on public.push_subscriptions;
drop policy if exists "push_subscriptions_update_own" on public.push_subscriptions;
drop policy if exists "push_subscriptions_delete_own" on public.push_subscriptions;

create policy "push_subscriptions_select_own" on public.push_subscriptions
  for select using (auth.uid() = user_id);

create policy "push_subscriptions_insert_own" on public.push_subscriptions
  for insert with check (auth.uid() = user_id);

create policy "push_subscriptions_update_own" on public.push_subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "push_subscriptions_delete_own" on public.push_subscriptions
  for delete using (auth.uid() = user_id);


-- v4.33: Track one-time player/captain information emails.
create table if not exists public.app_info_emails_sent (
  user_id uuid not null references auth.users(id) on delete cascade,
  email_type text not null check (email_type in ('player','captain')),
  sent_at timestamptz not null default now(),
  primary key (user_id, email_type)
);

alter table public.app_info_emails_sent enable row level security;

-- v4.33: Allow current signed-in clients to notice when their profile role changes.
do $$
begin
  alter publication supabase_realtime add table public.profiles;
exception
  when duplicate_object then null;
end $$;
