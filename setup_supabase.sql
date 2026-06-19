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
