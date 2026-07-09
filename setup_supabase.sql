-- Ultimate Teams Cloud Supabase setup 4.9.0
-- Safe to rerun. This keeps existing data, refreshes policies/functions, and adds 4.8.0 backend fixes.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('admin','captain','user');
  end if;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  role public.app_role not null default 'user',
  first_name text,
  last_name text,
  full_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;
alter table public.profiles add column if not exists full_name text;

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  full_name text generated always as (trim(first_name || ' ' || last_name)) stored,
  handling numeric not null default 0,
  cutting numeric not null default 0,
  defense numeric not null default 0,
  win_loss numeric not null default 0,
  active boolean not null default true,
  injury_pct numeric not null default 1.0,
  temporary boolean not null default false,
  games_played integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(first_name, last_name)
);

create table if not exists public.attendance (
  player_id uuid primary key references public.players(id) on delete cascade,
  present boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists public.pair_rules (
  id uuid primary key default gen_random_uuid(),
  player1_id uuid not null references public.players(id) on delete cascade,
  player2_id uuid not null references public.players(id) on delete cascade,
  rule_type text not null check(rule_type in ('together','apart')),
  strength numeric not null default 1.0,
  created_by uuid references auth.users(id),
  created_by_role public.app_role,
  created_at timestamptz not null default now()
);

alter table public.pair_rules add column if not exists created_by uuid references auth.users(id);
alter table public.pair_rules add column if not exists created_by_role public.app_role;

create table if not exists public.teammate_history (
  player_a uuid not null references public.players(id) on delete cascade,
  player_b uuid not null references public.players(id) on delete cascade,
  count integer not null default 0,
  primary key(player_a, player_b),
  check(player_a < player_b)
);

create table if not exists public.settings (
  id text primary key default 'main',
  weight_handling numeric not null default .35,
  weight_cutting numeric not null default .35,
  weight_defense numeric not null default .30,
  k_factor numeric not null default .08,
  repeat_weight numeric not null default 4.0,
  prioritize_handler_separation boolean not null default false,
  handler_separation_boost numeric not null default 2.0,
  prioritize_elite_balance boolean not null default false,
  elite_balance_boost numeric not null default 2.0,
  updated_at timestamptz not null default now()
);

alter table public.settings add column if not exists elite_balance_boost numeric not null default 2.0;
alter table public.settings add column if not exists prioritize_elite_balance boolean not null default false;
alter table public.settings add column if not exists handler_separation_boost numeric not null default 2.0;
alter table public.settings add column if not exists prioritize_handler_separation boolean not null default false;
alter table public.settings add column if not exists repeat_weight numeric not null default 4.0;
alter table public.settings add column if not exists k_factor numeric not null default .08;
alter table public.settings add column if not exists weight_handling numeric not null default .35;
alter table public.settings add column if not exists weight_cutting numeric not null default .35;
alter table public.settings add column if not exists weight_defense numeric not null default .30;
insert into public.settings(id) values ('main') on conflict(id) do nothing;

create table if not exists public.current_game (
  id text primary key default 'main',
  teams jsonb,
  selected_winner_index integer,
  results_saved boolean not null default false,
  generated_at timestamptz,
  updated_by uuid references auth.users(id)
);
insert into public.current_game(id) values ('main') on conflict(id) do nothing;

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  played_at timestamptz not null default now(),
  teams jsonb not null,
  winner_team_index integer,
  created_by uuid references auth.users(id)
);

create table if not exists public.rating_history (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  value numeric not null,
  created_at timestamptz not null default now()
);

alter table public.rating_history add column if not exists game_id uuid;


create table if not exists public.teammate_pair_events (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references public.games(id) on delete cascade,
  player_a uuid not null references public.players(id) on delete cascade,
  player_b uuid not null references public.players(id) on delete cascade,
  source text not null check(source in ('results_saved','pairings_only')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique(game_id, player_a, player_b),
  check(player_a < player_b)
);

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

create table if not exists public.app_info_emails_sent (
  user_id uuid not null references auth.users(id) on delete cascade,
  email_type text not null check(email_type in ('player','captain')),
  sent_at timestamptz not null default now(),
  primary key(user_id, email_type)
);



-- 4.9.0 feature/data integrity additions.
create table if not exists public.game_player_results (
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  team_idx integer not null,
  old_win_loss numeric not null default 0,
  new_win_loss numeric not null default 0,
  delta numeric not null default 0,
  old_games_played integer not null default 0,
  new_games_played integer not null default 0,
  old_wins integer not null default 0,
  new_wins integer not null default 0,
  old_losses integer not null default 0,
  new_losses integer not null default 0,
  created_at timestamptz not null default now(),
  primary key(game_id, player_id)
);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  table_name text,
  row_id uuid,
  player_id uuid references public.players(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_role public.app_role,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.game_player_results enable row level security;
alter table public.admin_audit_logs enable row level security;

create or replace function public.log_player_admin_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
  v_action text;
  v_row_id uuid;
  v_player_id uuid;
  v_details jsonb;
begin
  if current_setting('app.audit_context', true) in ('game_result','void_game') then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  select role into v_role from public.profiles where id = auth.uid();

  if tg_op = 'INSERT' then
    v_action := 'player_added';
    v_row_id := new.id;
    v_player_id := new.id;
    v_details := jsonb_build_object('new', to_jsonb(new));
  elsif tg_op = 'DELETE' then
    v_action := 'player_deleted';
    v_row_id := old.id;
    v_player_id := old.id;
    v_details := jsonb_build_object('old', to_jsonb(old));
  elsif tg_op = 'UPDATE' then
    if new.handling is distinct from old.handling
       or new.cutting is distinct from old.cutting
       or new.defense is distinct from old.defense
       or new.win_loss is distinct from old.win_loss then
      v_action := 'rating_edit';
      v_row_id := new.id;
      v_player_id := new.id;
      v_details := jsonb_build_object(
        'old', jsonb_build_object('handling', old.handling, 'cutting', old.cutting, 'defense', old.defense, 'win_loss', old.win_loss),
        'new', jsonb_build_object('handling', new.handling, 'cutting', new.cutting, 'defense', new.defense, 'win_loss', new.win_loss),
        'player_name', new.full_name
      );
    else
      return new;
    end if;
  end if;

  insert into public.admin_audit_logs(action, table_name, row_id, player_id, actor_id, actor_role, details)
  values(v_action, tg_table_name, v_row_id, v_player_id, auth.uid(), v_role, coalesce(v_details, '{}'::jsonb));

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists log_player_admin_audit_trigger on public.players;
create trigger log_player_admin_audit_trigger
after insert or update or delete on public.players
for each row execute function public.log_player_admin_audit();

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.can_manage_games()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role in ('admin','captain'));
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id, email, role)
  values(new.id, new.email, 'user')
  on conflict(id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.set_pair_rule_metadata()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;

  if new.created_by_role is null and new.created_by is not null then
    select role into new.created_by_role from public.profiles where id = new.created_by;
  end if;

  return new;
end;
$$;

drop trigger if exists set_pair_rule_metadata_trigger on public.pair_rules;
create trigger set_pair_rule_metadata_trigger
before insert or update on public.pair_rules
for each row execute function public.set_pair_rule_metadata();

update public.pair_rules pr
set created_by_role = p.role
from public.profiles p
where pr.created_by = p.id
  and pr.created_by_role is null;

create or replace function public.prevent_captain_player_edits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  user_role public.app_role;
begin
  if current_setting('app.bypass_captain_player_guard', true) = 'on' then
    return new;
  end if;

  select role into user_role from public.profiles where id = auth.uid();

  if user_role = 'captain' then
    -- Captains can edit names, active/inactive, and injury_pct.
    -- Captains cannot directly edit ratings, win/loss stats, or temporary status.
    if new.handling is distinct from old.handling
       or new.cutting is distinct from old.cutting
       or new.defense is distinct from old.defense
       or new.win_loss is distinct from old.win_loss
       or new.temporary is distinct from old.temporary
       or new.games_played is distinct from old.games_played
       or new.wins is distinct from old.wins
       or new.losses is distinct from old.losses then
      raise exception using message = 'Captains can edit names, active/inactive, and injury percent. Ratings and season stats are locked.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_captain_rating_edits_trigger on public.players;
drop trigger if exists prevent_captain_player_edits_trigger on public.players;
create trigger prevent_captain_player_edits_trigger
before update on public.players
for each row execute function public.prevent_captain_player_edits();


-- Mark attendance from the app. If a player is marked present, they are also made active.
-- This keeps inactive players from staying inactive once they show up and play.
create or replace function public.mark_attendance_from_app(
  p_player_id uuid,
  p_present boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception using message = 'Sign in required.';
  end if;

  insert into public.attendance(player_id, present, updated_at, updated_by)
  values (p_player_id, p_present, now(), auth.uid())
  on conflict (player_id)
  do update set
    present = excluded.present,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

  if p_present then
    update public.players
    set active = true,
        updated_at = now()
    where id = p_player_id
      and active is distinct from true;
  end if;
end;
$$;

grant execute on function public.mark_attendance_from_app(uuid, boolean) to authenticated;


create or replace function public.add_player_from_app(
  p_first_name text,
  p_last_name text,
  p_handling numeric,
  p_cutting numeric,
  p_defense numeric,
  p_temporary boolean default true,
  p_mark_present boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_first text := nullif(trim(coalesce(p_first_name, '')), '');
  v_last text := nullif(trim(coalesce(p_last_name, '')), '');
begin
  if not public.can_manage_games() then
    raise exception using message = 'Captain/admin only.';
  end if;

  if v_first is null and v_last is null then
    raise exception using message = 'Player name is required.';
  end if;

  insert into public.players(first_name, last_name, handling, cutting, defense, win_loss, active, injury_pct, temporary, updated_at)
  values(
    coalesce(v_first, ''),
    coalesce(v_last, ''),
    greatest(0, least(10, coalesce(p_handling, 3))),
    greatest(0, least(10, coalesce(p_cutting, 3))),
    greatest(0, least(10, coalesce(p_defense, 3))),
    0,
    true,
    1,
    coalesce(p_temporary, true),
    now()
  )
  returning id into v_id;

  if coalesce(p_mark_present, true) then
    insert into public.attendance(player_id, present, updated_at, updated_by)
    values(v_id, true, now(), auth.uid())
    on conflict(player_id) do update set
      present = excluded.present,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;
  end if;

  return jsonb_build_object('player_id', v_id);
exception
  when unique_violation then
    raise exception using message = 'A player with that first and last name already exists.';
end;
$$;

create or replace function public.record_teammate_pair_events(
  p_game_id uuid,
  p_teams jsonb,
  p_source text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  team jsonb;
  r1 record;
  r2 record;
  a uuid;
  b uuid;
  lo uuid;
  hi uuid;
  inserted_rows integer;
  inserted_count integer := 0;
begin
  if p_source not in ('results_saved','pairings_only') then
    raise exception using message = 'Invalid pairing-event source.';
  end if;

  if p_teams is null or jsonb_typeof(p_teams) <> 'array' then
    raise exception using message = 'Teams JSON is required.';
  end if;

  for team in select value from jsonb_array_elements(p_teams) loop
    if jsonb_typeof(team) = 'array' then
      for r1 in select value, ordinality from jsonb_array_elements(team) with ordinality loop
        for r2 in select value, ordinality from jsonb_array_elements(team) with ordinality where ordinality > r1.ordinality loop
          a := nullif(r1.value ->> 'id', '')::uuid;
          b := nullif(r2.value ->> 'id', '')::uuid;

          if a is not null and b is not null and a <> b then
            if a::text < b::text then
              lo := a; hi := b;
            else
              lo := b; hi := a;
            end if;

            insert into public.teammate_pair_events(game_id, player_a, player_b, source, created_by)
            values(p_game_id, lo, hi, p_source, auth.uid())
            on conflict(game_id, player_a, player_b) do nothing;

            get diagnostics inserted_rows = row_count;
            if inserted_rows > 0 then
              inserted_count := inserted_count + 1;

              insert into public.teammate_history(player_a, player_b, count)
              values(lo, hi, 1)
              on conflict(player_a, player_b) do update
              set count = public.teammate_history.count + 1;
            end if;
          end if;
        end loop;
      end loop;
    end if;
  end loop;

  return inserted_count;
end;
$$;

create or replace function public.save_pairings_only(
  p_teams jsonb default null,
  p_generated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_teams jsonb;
  v_generated_at timestamptz;
  v_game_id uuid;
  v_pair_count integer;
  v_already_saved boolean;
begin
  if not public.can_manage_games() then
    raise exception using message = 'Captain/admin only.';
  end if;

  select coalesce(teams, p_teams), coalesce(generated_at, p_generated_at, now()), results_saved
  into v_teams, v_generated_at, v_already_saved
  from public.current_game
  where id = 'main';

  if p_generated_at is not null and v_generated_at is not null
     and abs(extract(epoch from (p_generated_at - v_generated_at))) > 2 then
    raise exception using message = 'The current game changed before pairings could be saved. Refresh and try again.';
  end if;

  if coalesce(v_already_saved, false) then
    return jsonb_build_object('already_saved', true, 'pair_count', 0);
  end if;

  if v_teams is null or jsonb_typeof(v_teams) <> 'array' or jsonb_array_length(v_teams) = 0 then
    raise exception using message = 'No current game teams to save.';
  end if;

  insert into public.games(teams, winner_team_index, created_by)
  values(v_teams, null, auth.uid())
  returning id into v_game_id;

  v_pair_count := public.record_teammate_pair_events(v_game_id, v_teams, 'pairings_only');

  update public.current_game
  set teams = v_teams,
      selected_winner_index = null,
      results_saved = true,
      generated_at = v_generated_at,
      updated_by = auth.uid()
  where id = 'main';

  return jsonb_build_object('game_id', v_game_id, 'pair_count', v_pair_count);
end;
$$;

create or replace function public.save_game_results(
  p_winner_team_index integer,
  p_teams jsonb default null,
  p_generated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_teams jsonb;
  v_generated_at timestamptz;
  v_already_saved boolean;
  v_team_count integer;
  v_player_count integer;
  v_distinct_count integer;
  v_found_count integer;
  v_loser_count numeric;
  v_weight_h numeric;
  v_weight_c numeric;
  v_weight_d numeric;
  v_k numeric;
  v_winner_strength numeric;
  v_game_id uuid;
  v_pair_count integer;
begin
  if not public.can_manage_games() then
    raise exception using message = 'Captain/admin only.';
  end if;

  select coalesce(teams, p_teams), coalesce(generated_at, p_generated_at, now()), results_saved
  into v_teams, v_generated_at, v_already_saved
  from public.current_game
  where id = 'main';

  if p_generated_at is not null and v_generated_at is not null
     and abs(extract(epoch from (p_generated_at - v_generated_at))) > 2 then
    raise exception using message = 'The current game changed before results could be saved. Refresh and try again.';
  end if;

  if coalesce(v_already_saved, false) then
    raise exception using message = 'Current game results are already saved.';
  end if;

  if v_teams is null or jsonb_typeof(v_teams) <> 'array' or jsonb_array_length(v_teams) < 2 then
    raise exception using message = 'Results require at least two teams.';
  end if;

  v_team_count := jsonb_array_length(v_teams);
  if p_winner_team_index is null or p_winner_team_index < 0 or p_winner_team_index >= v_team_count then
    raise exception using message = 'Winning team selection is invalid.';
  end if;

  v_loser_count := greatest(1, v_team_count - 1);

  select weight_handling, weight_cutting, weight_defense, k_factor
  into v_weight_h, v_weight_c, v_weight_d, v_k
  from public.settings
  where id = 'main';

  v_weight_h := coalesce(v_weight_h, .35);
  v_weight_c := coalesce(v_weight_c, .35);
  v_weight_d := coalesce(v_weight_d, .30);
  v_k := coalesce(v_k, .08);

  drop table if exists pg_temp._game_players;
  create temp table _game_players on commit drop as
  select (team_index - 1)::integer as team_idx,
         nullif(player_obj ->> 'id', '')::uuid as player_id
  from jsonb_array_elements(v_teams) with ordinality as t(team_json, team_index)
  cross join jsonb_array_elements(t.team_json) as p(player_obj);

  delete from _game_players where player_id is null;

  select count(*), count(distinct player_id)
  into v_player_count, v_distinct_count
  from _game_players;

  if v_player_count = 0 then
    raise exception using message = 'No players found in teams.';
  end if;

  if v_player_count <> v_distinct_count then
    raise exception using message = 'A player appears on more than one team.';
  end if;

  select count(*) into v_found_count
  from _game_players gp
  join public.players p on p.id = gp.player_id;

  if v_found_count <> v_player_count then
    raise exception using message = 'One or more team players no longer exist in the database.';
  end if;

  drop table if exists pg_temp._game_player_values;
  create temp table _game_player_values on commit drop as
  select gp.team_idx,
         p.id as player_id,
         (
           (coalesce(p.handling,0) * (0.5 + 0.5 * coalesce(p.injury_pct,1)) * v_weight_h)
           + (coalesce(p.cutting,0) * coalesce(p.injury_pct,1) * v_weight_c)
           + (coalesce(p.defense,0) * coalesce(p.injury_pct,1) * v_weight_d)
           + coalesce(p.win_loss,0)
         ) as overall
  from _game_players gp
  join public.players p on p.id = gp.player_id;

  drop table if exists pg_temp._team_strengths;
  create temp table _team_strengths on commit drop as
  select team_idx, sum(overall) as strength
  from _game_player_values
  group by team_idx;

  select strength into v_winner_strength
  from _team_strengths
  where team_idx = p_winner_team_index;

  if v_winner_strength is null then
    raise exception using message = 'Winning team has no players.';
  end if;

  drop table if exists pg_temp._team_deltas;
  create temp table _team_deltas(team_idx integer primary key, delta numeric) on commit drop;

  insert into _team_deltas(team_idx, delta)
  select p_winner_team_index,
         coalesce(sum((v_k / v_loser_count) * (1 - (1 / (1 + power(10::numeric, ((ts.strength - v_winner_strength) / 4.0)))))), 0)
  from _team_strengths ts
  where ts.team_idx <> p_winner_team_index;

  insert into _team_deltas(team_idx, delta)
  select ts.team_idx,
         (v_k / v_loser_count) * (0 - (1 / (1 + power(10::numeric, ((v_winner_strength - ts.strength) / 4.0)))))
  from _team_strengths ts
  where ts.team_idx <> p_winner_team_index;

  drop table if exists pg_temp._game_player_audit;
  create temp table _game_player_audit on commit drop as
  select gpv.team_idx,
         p.id as player_id,
         p.win_loss as old_win_loss,
         p.win_loss + td.delta as new_win_loss,
         td.delta,
         p.games_played as old_games_played,
         p.games_played + 1 as new_games_played,
         p.wins as old_wins,
         p.wins + case when gpv.team_idx = p_winner_team_index then 1 else 0 end as new_wins,
         p.losses as old_losses,
         p.losses + case when gpv.team_idx = p_winner_team_index then 0 else 1 end as new_losses
  from public.players p
  join _game_player_values gpv on gpv.player_id = p.id
  join _team_deltas td on td.team_idx = gpv.team_idx;

  insert into public.games(teams, winner_team_index, created_by)
  values(v_teams, p_winner_team_index, auth.uid())
  returning id into v_game_id;

  perform set_config('app.bypass_captain_player_guard', 'on', true);
  perform set_config('app.audit_context', 'game_result', true);

  update public.players p
  set win_loss = a.new_win_loss,
      games_played = a.new_games_played,
      wins = a.new_wins,
      losses = a.new_losses,
      updated_at = now()
  from _game_player_audit a
  where p.id = a.player_id;

  insert into public.rating_history(player_id, value, game_id)
  select player_id, new_win_loss, v_game_id from _game_player_audit;

  insert into public.game_player_results(
    game_id, player_id, team_idx, old_win_loss, new_win_loss, delta,
    old_games_played, new_games_played, old_wins, new_wins, old_losses, new_losses
  )
  select v_game_id, player_id, team_idx, old_win_loss, new_win_loss, delta,
         old_games_played, new_games_played, old_wins, new_wins, old_losses, new_losses
  from _game_player_audit;

  perform set_config('app.bypass_captain_player_guard', 'off', true);
  perform set_config('app.audit_context', 'none', true);

  v_pair_count := public.record_teammate_pair_events(v_game_id, v_teams, 'results_saved');

  update public.current_game
  set teams = v_teams,
      selected_winner_index = p_winner_team_index,
      results_saved = true,
      generated_at = v_generated_at,
      updated_by = auth.uid()
  where id = 'main';

  return jsonb_build_object(
    'game_id', v_game_id,
    'updated_players', v_player_count,
    'pair_count', v_pair_count
  );
exception
  when others then
    perform set_config('app.bypass_captain_player_guard', 'off', true);
    perform set_config('app.audit_context', 'none', true);
    raise;
end;
$$;

alter table public.profiles enable row level security;
alter table public.players enable row level security;
alter table public.attendance enable row level security;
alter table public.pair_rules enable row level security;
alter table public.teammate_history enable row level security;
alter table public.teammate_pair_events enable row level security;
alter table public.settings enable row level security;
alter table public.current_game enable row level security;
alter table public.games enable row level security;
alter table public.rating_history enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.app_info_emails_sent enable row level security;

-- Refresh policies for the app tables.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'profiles','players','attendance','pair_rules','teammate_history','teammate_pair_events',
        'settings','current_game','games','rating_history','push_subscriptions','app_info_emails_sent'
      )
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

create policy profiles_select_authenticated on public.profiles
  for select to authenticated using(true);
create policy profiles_update_admin on public.profiles
  for update to authenticated using(public.is_admin()) with check(public.is_admin());

-- Guests can view enough public app data to see current teams. Writes require sign-in/captain/admin where appropriate.
create policy players_select_public on public.players
  for select to anon, authenticated using(true);
create policy players_insert_admin on public.players
  for insert to authenticated with check(public.is_admin());
create policy players_update_admin_or_captain_guarded on public.players
  for update to authenticated using(public.is_admin() or public.can_manage_games()) with check(public.is_admin() or public.can_manage_games());
create policy players_delete_admin_or_captain_temp on public.players
  for delete to authenticated using(public.is_admin() or (public.can_manage_games() and temporary));

create policy attendance_select_public on public.attendance
  for select to anon, authenticated using(true);
create policy attendance_insert_authenticated on public.attendance
  for insert to authenticated with check(true);
create policy attendance_update_authenticated on public.attendance
  for update to authenticated using(true) with check(true);

create policy pair_rules_select_captain_admin on public.pair_rules
  for select to authenticated using(public.can_manage_games());
create policy pair_rules_insert_captain_admin on public.pair_rules
  for insert to authenticated with check(public.can_manage_games() and created_by = auth.uid());
create policy pair_rules_update_admin_or_own on public.pair_rules
  for update to authenticated
  using(public.is_admin() or (public.can_manage_games() and created_by = auth.uid()))
  with check(public.is_admin() or (public.can_manage_games() and created_by = auth.uid()));
create policy pair_rules_delete_admin_or_own on public.pair_rules
  for delete to authenticated
  using(public.is_admin() or (public.can_manage_games() and created_by = auth.uid()));

create policy history_select_public on public.teammate_history
  for select to anon, authenticated using(true);
create policy history_manage_admin on public.teammate_history
  for all to authenticated using(public.is_admin()) with check(public.is_admin());

create policy pair_events_select_captain_admin on public.teammate_pair_events
  for select to authenticated using(public.can_manage_games());

create policy settings_select_public on public.settings
  for select to anon, authenticated using(true);
create policy settings_update_admin on public.settings
  for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy settings_insert_admin on public.settings
  for insert to authenticated with check(public.is_admin());

create policy current_game_select_public on public.current_game
  for select to anon, authenticated using(true);
create policy current_game_insert_captain_admin on public.current_game
  for insert to authenticated with check(id = 'main' and public.can_manage_games());
create policy current_game_update_captain_admin on public.current_game
  for update to authenticated using(id = 'main' and public.can_manage_games()) with check(id = 'main' and public.can_manage_games());

create policy games_select_public on public.games
  for select to anon, authenticated using(true);
create policy games_insert_captain_admin on public.games
  for insert to authenticated with check(public.can_manage_games());

create policy rating_history_select_authenticated on public.rating_history
  for select to authenticated using(true);
create policy rating_history_insert_captain_admin on public.rating_history
  for insert to authenticated with check(public.can_manage_games());

create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated using(auth.uid() = user_id);
create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert to authenticated with check(auth.uid() = user_id);
create policy push_subscriptions_update_own on public.push_subscriptions
  for update to authenticated using(auth.uid() = user_id) with check(auth.uid() = user_id);
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated using(auth.uid() = user_id);

create policy app_info_emails_sent_select_own on public.app_info_emails_sent
  for select to authenticated using(auth.uid() = user_id);

grant execute on function public.add_player_from_app(text, text, numeric, numeric, numeric, boolean, boolean) to authenticated;
grant execute on function public.save_game_results(integer, jsonb, timestamptz) to authenticated;
grant execute on function public.save_pairings_only(jsonb, timestamptz) to authenticated;



create or replace function public.void_last_saved_game()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_game public.games%rowtype;
  v_restored integer := 0;
  v_pair_count integer := 0;
  v_role public.app_role;
begin
  if not public.is_admin() then
    raise exception using message = 'Admin only.';
  end if;

  select * into v_game
  from public.games
  where winner_team_index is not null
  order by played_at desc
  limit 1;

  if v_game.id is null then
    raise exception using message = 'No saved result game found to void.';
  end if;

  if not exists(select 1 from public.game_player_results where game_id = v_game.id) then
    raise exception using message = 'The last saved game was created before undo audit rows existed, so it cannot be safely undone.';
  end if;

  select role into v_role from public.profiles where id = auth.uid();

  perform set_config('app.bypass_captain_player_guard', 'on', true);
  perform set_config('app.audit_context', 'void_game', true);

  update public.players p
  set win_loss = g.old_win_loss,
      games_played = g.old_games_played,
      wins = g.old_wins,
      losses = g.old_losses,
      updated_at = now()
  from public.game_player_results g
  where g.game_id = v_game.id
    and p.id = g.player_id;

  get diagnostics v_restored = row_count;

  perform set_config('app.bypass_captain_player_guard', 'off', true);
  perform set_config('app.audit_context', 'none', true);

  update public.teammate_history h
  set count = greatest(0, h.count - 1)
  from public.teammate_pair_events e
  where e.game_id = v_game.id
    and h.player_a = e.player_a
    and h.player_b = e.player_b;

  delete from public.teammate_history where count <= 0;

  select count(*) into v_pair_count
  from public.teammate_pair_events
  where game_id = v_game.id;

  delete from public.rating_history rh
  using public.game_player_results g
  where g.game_id = v_game.id
    and rh.player_id = g.player_id
    and rh.value = g.new_win_loss
    and rh.created_at >= v_game.played_at - interval '10 minutes';

  delete from public.games where id = v_game.id;

  update public.current_game
  set selected_winner_index = null,
      results_saved = false,
      updated_by = auth.uid()
  where id = 'main';

  insert into public.admin_audit_logs(action, table_name, row_id, actor_id, actor_role, details)
  values('void_last_game', 'games', v_game.id, auth.uid(), v_role, jsonb_build_object('voided_game_id', v_game.id, 'restored_players', v_restored, 'pair_events_removed', v_pair_count));

  return jsonb_build_object('voided_game_id', v_game.id, 'restored_players', v_restored, 'pair_events_removed', v_pair_count);
exception
  when others then
    perform set_config('app.bypass_captain_player_guard', 'off', true);
    perform set_config('app.audit_context', 'none', true);
    raise;
end;
$$;

-- 4.9.0 policy refresh for new tables and functions.
drop policy if exists game_player_results_select_captain_admin on public.game_player_results;
create policy game_player_results_select_captain_admin on public.game_player_results
  for select to authenticated using(public.can_manage_games());

drop policy if exists game_player_results_admin_all on public.game_player_results;
create policy game_player_results_admin_all on public.game_player_results
  for all to authenticated using(public.is_admin()) with check(public.is_admin());

drop policy if exists admin_audit_logs_select_admin on public.admin_audit_logs;
create policy admin_audit_logs_select_admin on public.admin_audit_logs
  for select to authenticated using(public.is_admin());

drop policy if exists admin_audit_logs_admin_all on public.admin_audit_logs;
create policy admin_audit_logs_admin_all on public.admin_audit_logs
  for all to authenticated using(public.is_admin()) with check(public.is_admin());

grant execute on function public.void_last_saved_game() to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.admin_audit_logs;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.game_player_results;
exception when duplicate_object then null;
end $$;

-- Realtime tables used by the app.
do $$
begin
  alter publication supabase_realtime add table public.current_game;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.attendance;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.players;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.pair_rules;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null;
end $$;

-- After signing up in the app, make yourself admin if needed:
-- update public.profiles set role='admin' where email='samschra44@gmail.com';


-- 4.9.5: Delete/void one selected game from Game History.
-- For result games with game_player_results audit rows, this subtracts that game's stat/rating changes.
-- Pairings-only games simply remove pairing events/history counts and the game row.
create or replace function public.delete_game_from_history(p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_game public.games%rowtype;
  v_restored integer := 0;
  v_pair_count integer := 0;
  v_rating_rows integer := 0;
  v_role public.app_role;
  v_has_results boolean := false;
begin
  if not public.is_admin() then
    raise exception using message = 'Admin only.';
  end if;

  select * into v_game
  from public.games
  where id = p_game_id;

  if v_game.id is null then
    raise exception using message = 'Game not found.';
  end if;

  v_has_results := v_game.winner_team_index is not null;

  if v_has_results and not exists(select 1 from public.game_player_results where game_id = v_game.id) then
    raise exception using message = 'This result game was created before result audit rows existed, so it cannot be safely deleted and reversed.';
  end if;

  select role into v_role from public.profiles where id = auth.uid();

  select count(*) into v_pair_count
  from public.teammate_pair_events
  where game_id = v_game.id;

  if v_has_results then
    perform set_config('app.bypass_captain_player_guard', 'on', true);
    perform set_config('app.audit_context', 'void_game', true);

    update public.players p
    set win_loss = p.win_loss - g.delta,
        games_played = greatest(0, p.games_played - greatest(0, g.new_games_played - g.old_games_played)),
        wins = greatest(0, p.wins - greatest(0, g.new_wins - g.old_wins)),
        losses = greatest(0, p.losses - greatest(0, g.new_losses - g.old_losses)),
        updated_at = now()
    from public.game_player_results g
    where g.game_id = v_game.id
      and p.id = g.player_id;

    get diagnostics v_restored = row_count;

    perform set_config('app.bypass_captain_player_guard', 'off', true);
    perform set_config('app.audit_context', 'none', true);

    delete from public.rating_history
    where game_id = v_game.id;
    get diagnostics v_rating_rows = row_count;

    if v_rating_rows = 0 then
      delete from public.rating_history rh
      using public.game_player_results g
      where g.game_id = v_game.id
        and rh.player_id = g.player_id
        and rh.value = g.new_win_loss
        and rh.created_at >= v_game.played_at - interval '10 minutes'
        and rh.created_at <= v_game.played_at + interval '10 minutes';
      get diagnostics v_rating_rows = row_count;
    end if;
  end if;

  update public.teammate_history h
  set count = greatest(0, h.count - 1)
  from public.teammate_pair_events e
  where e.game_id = v_game.id
    and h.player_a = e.player_a
    and h.player_b = e.player_b;

  delete from public.teammate_history where count <= 0;

  -- Deleting the game cascades to teammate_pair_events and game_player_results.
  delete from public.games where id = v_game.id;

  update public.current_game
  set selected_winner_index = case when teams = v_game.teams then null else selected_winner_index end,
      results_saved = case when teams = v_game.teams then false else results_saved end,
      updated_by = auth.uid()
  where id = 'main';

  insert into public.admin_audit_logs(action, table_name, row_id, actor_id, actor_role, details)
  values(
    'game_deleted',
    'games',
    v_game.id,
    auth.uid(),
    v_role,
    jsonb_build_object(
      'deleted_game_id', v_game.id,
      'played_at', v_game.played_at,
      'winner_team_index', v_game.winner_team_index,
      'had_results', v_has_results,
      'restored_players', v_restored,
      'pair_events_removed', v_pair_count,
      'rating_history_rows_removed', v_rating_rows
    )
  );

  return jsonb_build_object(
    'deleted_game_id', v_game.id,
    'had_results', v_has_results,
    'restored_players', v_restored,
    'pair_events_removed', v_pair_count,
    'rating_history_rows_removed', v_rating_rows
  );
exception
  when others then
    perform set_config('app.bypass_captain_player_guard', 'off', true);
    perform set_config('app.audit_context', 'none', true);
    raise;
end;
$$;

grant execute on function public.delete_game_from_history(uuid) to authenticated;

-- Keep the old admin-only button, but route it through the selected-game delete/void function.
create or replace function public.void_last_saved_game()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_game_id uuid;
begin
  if not public.is_admin() then
    raise exception using message = 'Admin only.';
  end if;

  select id into v_game_id
  from public.games
  where winner_team_index is not null
  order by played_at desc
  limit 1;

  if v_game_id is null then
    raise exception using message = 'No saved result game found to void.';
  end if;

  return public.delete_game_from_history(v_game_id);
end;
$$;

grant execute on function public.void_last_saved_game() to authenticated;


-- 4.10.0 season archive support
create table if not exists public.season_archives (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  archived_at timestamptz not null default now(),
  archived_by uuid references auth.users(id) on delete set null,
  reset_stats boolean not null default false,
  reset_history boolean not null default false,
  snapshot jsonb not null default '{}'::jsonb
);

alter table public.season_archives enable row level security;

drop policy if exists season_archives_select_admin on public.season_archives;
create policy season_archives_select_admin on public.season_archives
for select to authenticated using (public.is_admin());

drop policy if exists season_archives_admin_all on public.season_archives;
create policy season_archives_admin_all on public.season_archives
for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.archive_current_season(
  p_name text,
  p_reset_stats boolean default true,
  p_reset_history boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_archive_id uuid;
  v_player_count integer := 0;
  v_game_count integer := 0;
  v_pair_count integer := 0;
  v_snapshot jsonb;
begin
  if not public.is_admin() then
    raise exception using message = 'Admin only.';
  end if;

  select count(*) into v_player_count from public.players;
  select count(*) into v_game_count from public.games;
  select count(*) into v_pair_count from public.teammate_history;

  v_snapshot := jsonb_build_object(
    'players', coalesce((select jsonb_agg(to_jsonb(p)) from public.players p), '[]'::jsonb),
    'games', coalesce((select jsonb_agg(to_jsonb(g)) from public.games g), '[]'::jsonb),
    'teammate_history', coalesce((select jsonb_agg(to_jsonb(h)) from public.teammate_history h), '[]'::jsonb),
    'teammate_pair_events', coalesce((select jsonb_agg(to_jsonb(e)) from public.teammate_pair_events e), '[]'::jsonb),
    'game_player_results', coalesce((select jsonb_agg(to_jsonb(r)) from public.game_player_results r), '[]'::jsonb),
    'settings', coalesce((select to_jsonb(s) from public.settings s where id = 'main'), '{}'::jsonb),
    'archived_at', now()
  );

  insert into public.season_archives(name, archived_by, reset_stats, reset_history, snapshot)
  values(coalesce(nullif(trim(p_name), ''), 'Season archive'), auth.uid(), p_reset_stats, p_reset_history, v_snapshot)
  returning id into v_archive_id;

  if p_reset_stats then
    perform set_config('app.bypass_captain_player_guard', 'on', true);
    perform set_config('app.audit_context', 'season_archive_reset', true);

    update public.players
    set games_played = 0,
        wins = 0,
        losses = 0,
        win_loss = 0,
        updated_at = now();

    perform set_config('app.bypass_captain_player_guard', 'off', true);
    perform set_config('app.audit_context', 'none', true);
  end if;

  if p_reset_history then
    delete from public.teammate_pair_events;
    delete from public.teammate_history;
  end if;

  insert into public.admin_audit_logs(action, table_name, row_id, actor_id, actor_role, details)
  select
    'season_archived',
    'season_archives',
    v_archive_id,
    auth.uid(),
    p.role,
    jsonb_build_object('name', p_name, 'reset_stats', p_reset_stats, 'reset_history', p_reset_history, 'players', v_player_count, 'games', v_game_count)
  from public.profiles p
  where p.id = auth.uid();

  return jsonb_build_object('archive_id', v_archive_id, 'players', v_player_count, 'games', v_game_count, 'teammate_history_entries', v_pair_count);
exception
  when others then
    perform set_config('app.bypass_captain_player_guard', 'off', true);
    perform set_config('app.audit_context', 'none', true);
    raise;
end;
$$;

grant execute on function public.archive_current_season(text, boolean, boolean) to authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.season_archives;
  exception when duplicate_object then null;
  end;
end $$;



-- 4.11.0: Admin retroactive winner selection for pairings-only Game History rows.
create or replace function public.set_game_winner_from_history(
  p_game_id uuid,
  p_winner_team_index integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_game public.games%rowtype;
  v_teams jsonb;
  v_team_count integer;
  v_player_count integer;
  v_distinct_count integer;
  v_found_count integer;
  v_loser_count numeric;
  v_weight_h numeric;
  v_weight_c numeric;
  v_weight_d numeric;
  v_k numeric;
  v_winner_strength numeric;
  v_pair_count integer := 0;
  v_existing_result_rows integer := 0;
  v_role public.app_role;
begin
  if not public.is_admin() then
    raise exception using message = 'Admin only.';
  end if;

  select * into v_game
  from public.games
  where id = p_game_id
  for update;

  if v_game.id is null then
    raise exception using message = 'Game not found.';
  end if;

  if v_game.winner_team_index is not null then
    raise exception using message = 'This game already has a saved winner. Delete/void it first if you need to change the result.';
  end if;

  select count(*) into v_existing_result_rows
  from public.game_player_results
  where game_id = v_game.id;

  if v_existing_result_rows > 0 then
    raise exception using message = 'This game already has result audit rows and cannot be retroactively set again.';
  end if;

  v_teams := v_game.teams;

  if v_teams is null or jsonb_typeof(v_teams) <> 'array' or jsonb_array_length(v_teams) < 2 then
    raise exception using message = 'Results require at least two teams.';
  end if;

  v_team_count := jsonb_array_length(v_teams);
  if p_winner_team_index is null or p_winner_team_index < 0 or p_winner_team_index >= v_team_count then
    raise exception using message = 'Winning team selection is invalid.';
  end if;

  v_loser_count := greatest(1, v_team_count - 1);

  select weight_handling, weight_cutting, weight_defense, k_factor
  into v_weight_h, v_weight_c, v_weight_d, v_k
  from public.settings
  where id = 'main';

  v_weight_h := coalesce(v_weight_h, .35);
  v_weight_c := coalesce(v_weight_c, .35);
  v_weight_d := coalesce(v_weight_d, .30);
  v_k := coalesce(v_k, .08);

  drop table if exists pg_temp._history_game_players;
  create temp table _history_game_players on commit drop as
  select (team_index - 1)::integer as team_idx,
         nullif(player_obj ->> 'id', '')::uuid as player_id
  from jsonb_array_elements(v_teams) with ordinality as t(team_json, team_index)
  cross join jsonb_array_elements(t.team_json) as p(player_obj);

  delete from _history_game_players where player_id is null;

  select count(*), count(distinct player_id)
  into v_player_count, v_distinct_count
  from _history_game_players;

  if v_player_count = 0 then
    raise exception using message = 'No players found in teams.';
  end if;

  if v_player_count <> v_distinct_count then
    raise exception using message = 'A player appears on more than one team.';
  end if;

  select count(*) into v_found_count
  from _history_game_players gp
  join public.players p on p.id = gp.player_id;

  if v_found_count <> v_player_count then
    raise exception using message = 'One or more team players no longer exist in the database.';
  end if;

  drop table if exists pg_temp._history_game_player_values;
  create temp table _history_game_player_values on commit drop as
  select gp.team_idx,
         p.id as player_id,
         (
           (coalesce(p.handling,0) * (0.5 + 0.5 * coalesce(p.injury_pct,1)) * v_weight_h)
           + (coalesce(p.cutting,0) * coalesce(p.injury_pct,1) * v_weight_c)
           + (coalesce(p.defense,0) * coalesce(p.injury_pct,1) * v_weight_d)
           + coalesce(p.win_loss,0)
         ) as overall
  from _history_game_players gp
  join public.players p on p.id = gp.player_id;

  drop table if exists pg_temp._history_team_strengths;
  create temp table _history_team_strengths on commit drop as
  select team_idx, sum(overall) as strength
  from _history_game_player_values
  group by team_idx;

  select strength into v_winner_strength
  from _history_team_strengths
  where team_idx = p_winner_team_index;

  if v_winner_strength is null then
    raise exception using message = 'Winning team has no players.';
  end if;

  drop table if exists pg_temp._history_team_deltas;
  create temp table _history_team_deltas(team_idx integer primary key, delta numeric) on commit drop;

  insert into _history_team_deltas(team_idx, delta)
  select p_winner_team_index,
         coalesce(sum((v_k / v_loser_count) * (1 - (1 / (1 + power(10::numeric, ((ts.strength - v_winner_strength) / 4.0)))))), 0)
  from _history_team_strengths ts
  where ts.team_idx <> p_winner_team_index;

  insert into _history_team_deltas(team_idx, delta)
  select ts.team_idx,
         (v_k / v_loser_count) * (0 - (1 / (1 + power(10::numeric, ((v_winner_strength - ts.strength) / 4.0)))))
  from _history_team_strengths ts
  where ts.team_idx <> p_winner_team_index;

  drop table if exists pg_temp._history_game_player_audit;
  create temp table _history_game_player_audit on commit drop as
  select gpv.team_idx,
         p.id as player_id,
         p.win_loss as old_win_loss,
         p.win_loss + td.delta as new_win_loss,
         td.delta,
         p.games_played as old_games_played,
         p.games_played + 1 as new_games_played,
         p.wins as old_wins,
         p.wins + case when gpv.team_idx = p_winner_team_index then 1 else 0 end as new_wins,
         p.losses as old_losses,
         p.losses + case when gpv.team_idx = p_winner_team_index then 0 else 1 end as new_losses
  from public.players p
  join _history_game_player_values gpv on gpv.player_id = p.id
  join _history_team_deltas td on td.team_idx = gpv.team_idx;

  perform set_config('app.bypass_captain_player_guard', 'on', true);
  perform set_config('app.audit_context', 'retroactive_game_result', true);

  update public.players p
  set win_loss = a.new_win_loss,
      games_played = a.new_games_played,
      wins = a.new_wins,
      losses = a.new_losses,
      updated_at = now()
  from _history_game_player_audit a
  where p.id = a.player_id;

  insert into public.rating_history(player_id, value, game_id)
  select player_id, new_win_loss, v_game.id from _history_game_player_audit;

  insert into public.game_player_results(
    game_id, player_id, team_idx, old_win_loss, new_win_loss, delta,
    old_games_played, new_games_played, old_wins, new_wins, old_losses, new_losses
  )
  select v_game.id, player_id, team_idx, old_win_loss, new_win_loss, delta,
         old_games_played, new_games_played, old_wins, new_wins, old_losses, new_losses
  from _history_game_player_audit;

  update public.games
  set winner_team_index = p_winner_team_index
  where id = v_game.id;

  perform set_config('app.bypass_captain_player_guard', 'off', true);
  perform set_config('app.audit_context', 'none', true);

  select count(*) into v_pair_count
  from public.teammate_pair_events
  where game_id = v_game.id;

  if v_pair_count = 0 then
    v_pair_count := public.record_teammate_pair_events(v_game.id, v_teams, 'results_saved');
  else
    update public.teammate_pair_events
    set source = 'results_saved'
    where game_id = v_game.id;
  end if;

  update public.current_game
  set selected_winner_index = case when teams = v_teams then p_winner_team_index else selected_winner_index end,
      results_saved = case when teams = v_teams then true else results_saved end,
      updated_by = auth.uid()
  where id = 'main';

  select role into v_role from public.profiles where id = auth.uid();

  insert into public.admin_audit_logs(action, table_name, row_id, actor_id, actor_role, details)
  values(
    'retroactive_winner_selected',
    'games',
    v_game.id,
    auth.uid(),
    v_role,
    jsonb_build_object(
      'game_id', v_game.id,
      'played_at', v_game.played_at,
      'winner_team_index', p_winner_team_index,
      'updated_players', v_player_count,
      'pair_events', v_pair_count
    )
  );

  return jsonb_build_object(
    'game_id', v_game.id,
    'winner_team_index', p_winner_team_index,
    'updated_players', v_player_count,
    'pair_events', v_pair_count
  );
exception
  when others then
    perform set_config('app.bypass_captain_player_guard', 'off', true);
    perform set_config('app.audit_context', 'none', true);
    raise;
end;
$$;

grant execute on function public.set_game_winner_from_history(uuid, integer) to authenticated;



-- 4.11.1: Admin clear winner from Game History while keeping the game as pairings-only.
create or replace function public.clear_game_winner_from_history(
  p_game_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_game public.games%rowtype;
  v_result_count integer := 0;
  v_pair_event_count integer := 0;
  v_rating_history_deleted integer := 0;
  v_role public.app_role;
begin
  if not public.is_admin() then
    raise exception using message = 'Admin only.';
  end if;

  select * into v_game
  from public.games
  where id = p_game_id
  for update;

  if v_game.id is null then
    raise exception using message = 'Game not found.';
  end if;

  if v_game.winner_team_index is null then
    raise exception using message = 'This game already has no winner.';
  end if;

  select count(*) into v_result_count
  from public.game_player_results
  where game_id = v_game.id;

  if v_result_count = 0 then
    raise exception using message = 'This result cannot be safely cleared because it has no game_player_results audit rows. Older games may need to be deleted/voided instead.';
  end if;

  perform set_config('app.bypass_captain_player_guard', 'on', true);
  perform set_config('app.audit_context', 'clear_game_winner', true);

  -- Reverse player record/rating back to the exact audited old values.
  update public.players p
  set win_loss = r.old_win_loss,
      games_played = r.old_games_played,
      wins = r.old_wins,
      losses = r.old_losses,
      updated_at = now()
  from public.game_player_results r
  where r.game_id = v_game.id
    and r.player_id = p.id;

  -- Remove rating-history rows for the cleared result.
  delete from public.rating_history
  where game_id = v_game.id;

  get diagnostics v_rating_history_deleted = row_count;

  -- Remove result audit rows so this game becomes pairings-only again.
  delete from public.game_player_results
  where game_id = v_game.id;

  -- Keep teammate pair events and teammate_history counts because the game still happened
  -- as a pairings-only game. Just relabel the source.
  update public.teammate_pair_events
  set source = 'pairings_only'
  where game_id = v_game.id;

  get diagnostics v_pair_event_count = row_count;

  -- Clear the winner while keeping the game record.
  update public.games
  set winner_team_index = null
  where id = v_game.id;

  -- If this is still the current game, reflect that state too.
  update public.current_game
  set selected_winner_index = null,
      results_saved = false,
      updated_by = auth.uid()
  where id = 'main'
    and teams = v_game.teams;

  perform set_config('app.bypass_captain_player_guard', 'off', true);
  perform set_config('app.audit_context', 'none', true);

  select role into v_role from public.profiles where id = auth.uid();

  insert into public.admin_audit_logs(action, table_name, row_id, actor_id, actor_role, details)
  values(
    'game_winner_cleared',
    'games',
    v_game.id,
    auth.uid(),
    v_role,
    jsonb_build_object(
      'game_id', v_game.id,
      'played_at', v_game.played_at,
      'previous_winner_team_index', v_game.winner_team_index,
      'reversed_players', v_result_count,
      'rating_history_rows_deleted', v_rating_history_deleted,
      'pair_events_kept', v_pair_event_count
    )
  );

  return jsonb_build_object(
    'game_id', v_game.id,
    'previous_winner_team_index', v_game.winner_team_index,
    'reversed_players', v_result_count,
    'rating_history_rows_deleted', v_rating_history_deleted,
    'pair_events_kept', v_pair_event_count
  );
exception
  when others then
    perform set_config('app.bypass_captain_player_guard', 'off', true);
    perform set_config('app.audit_context', 'none', true);
    raise;
end;
$$;

grant execute on function public.clear_game_winner_from_history(uuid) to authenticated;



-- 4.11.6: Four role model.
-- Internal compatibility note:
--   profiles.role = 'user' is displayed/treated as "Player".
--   New enum value 'teammate' allows users who can mark attendance for anyone
--   without getting Captain/Admin tools.
do $$
begin
  if exists (select 1 from pg_type where typname = 'app_role')
     and not exists (
       select 1
       from pg_enum e
       join pg_type t on t.oid = e.enumtypid
       where t.typname = 'app_role'
         and e.enumlabel = 'teammate'
     ) then
    alter type public.app_role add value 'teammate';
  end if;
end $$;

alter table public.profiles add column if not exists player_id uuid references public.players(id);

-- Backfill account-to-player links using exact profile name/roster name matches.
update public.profiles pr
set player_id = pl.id
from public.players pl
where pr.player_id is null
  and lower(trim(coalesce(nullif(pr.full_name,''), trim(coalesce(pr.first_name,'') || ' ' || coalesce(pr.last_name,''))))) = lower(trim(pl.full_name));

create or replace function public.profile_matches_player(
  p_user_id uuid,
  p_player_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.profiles pr
    join public.players pl on pl.id = p_player_id
    where pr.id = p_user_id
      and (
        pr.player_id = pl.id
        or lower(trim(coalesce(nullif(pr.full_name,''), trim(coalesce(pr.first_name,'') || ' ' || coalesce(pr.last_name,''))))) = lower(trim(pl.full_name))
        or (
          lower(trim(coalesce(pr.first_name,''))) = lower(trim(pl.first_name))
          and lower(trim(coalesce(pr.last_name,''))) = lower(trim(pl.last_name))
          and coalesce(pr.first_name,'') <> ''
          and coalesce(pr.last_name,'') <> ''
        )
      )
  );
$$;

create or replace function public.can_mark_attendance_for_player(
  p_player_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.profiles pr
    where pr.id = auth.uid()
      and (
        pr.role::text in ('admin','captain','teammate')
        or public.profile_matches_player(auth.uid(), p_player_id)
      )
  );
$$;

-- Mark attendance from the app.
-- Player/user accounts can only mark their matched roster player.
-- Teammates, captains, and admins can mark anyone.
create or replace function public.mark_attendance_from_app(
  p_player_id uuid,
  p_present boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception using message = 'Sign in required.';
  end if;

  if not public.can_mark_attendance_for_player(p_player_id) then
    raise exception using message = 'Players can only mark themselves present. Ask a Teammate, Captain, or Admin to update someone else.';
  end if;

  insert into public.attendance(player_id, present, updated_at, updated_by)
  values (p_player_id, p_present, now(), auth.uid())
  on conflict (player_id)
  do update set
    present = excluded.present,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

  if p_present then
    update public.players
    set active = true,
        updated_at = now()
    where id = p_player_id
      and active is distinct from true;
  end if;
end;
$$;

grant execute on function public.profile_matches_player(uuid, uuid) to authenticated;
grant execute on function public.can_mark_attendance_for_player(uuid) to authenticated;
grant execute on function public.mark_attendance_from_app(uuid, boolean) to authenticated;

-- Tighten direct attendance writes so the browser cannot bypass the role model.
drop policy if exists attendance_insert_authenticated on public.attendance;
drop policy if exists attendance_update_authenticated on public.attendance;
drop policy if exists attendance_insert_authorized_4116 on public.attendance;
drop policy if exists attendance_update_authorized_4116 on public.attendance;

create policy attendance_insert_authorized_4116 on public.attendance
  for insert to authenticated
  with check(public.can_mark_attendance_for_player(player_id));

create policy attendance_update_authorized_4116 on public.attendance
  for update to authenticated
  using(public.can_mark_attendance_for_player(player_id))
  with check(public.can_mark_attendance_for_player(player_id));

