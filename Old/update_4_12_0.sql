-- Ultimate Teams 4.12.0 migration
-- Safe to run more than once.

alter table public.settings
  add column if not exists reshuffle_mode text not null default 'normal';

alter table public.settings
  drop constraint if exists settings_reshuffle_mode_check;
alter table public.settings
  add constraint settings_reshuffle_mode_check
  check (reshuffle_mode in ('normal','maximum','balance'));

-- Teammates generate locally but must read the same official Pair Rules.
drop policy if exists pair_rules_select_captain_admin on public.pair_rules;
drop policy if exists pair_rules_select_team_generators_41121 on public.pair_rules;
drop policy if exists pair_rules_select_team_generators_4120 on public.pair_rules;
create policy pair_rules_select_team_generators_4120 on public.pair_rules
  for select to authenticated
  using (
    public.can_manage_games()
    or exists(
      select 1 from public.profiles pr
      where pr.id = auth.uid() and pr.role = 'teammate'
    )
  );

-- One initial read for the app shell. SECURITY INVOKER preserves normal RLS.
create or replace function public.get_app_bootstrap_4120()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'profile',(
      select to_jsonb(pr)
      from public.profiles pr
      where pr.id = auth.uid()
      limit 1
    ),
    'players',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',p.id,'first_name',p.first_name,'last_name',p.last_name,'full_name',p.full_name,
        'handling',p.handling,'cutting',p.cutting,'defense',p.defense,'win_loss',p.win_loss,
        'active',p.active,'injury_pct',p.injury_pct,'temporary',p.temporary,
        'games_played',p.games_played,'wins',p.wins,'losses',p.losses
      ) order by p.first_name,p.last_name)
      from public.players p
    ),'[]'::jsonb),
    'attendance',coalesce((
      select jsonb_agg(jsonb_build_object('player_id',a.player_id,'present',a.present))
      from public.attendance a
    ),'[]'::jsonb),
    'pair_rules',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',pr.id,'player1_id',pr.player1_id,'player2_id',pr.player2_id,
        'rule_type',pr.rule_type,'strength',pr.strength,'created_by',pr.created_by,
        'created_by_role',pr.created_by_role,'created_at',pr.created_at
      ) order by pr.created_at)
      from public.pair_rules pr
    ),'[]'::jsonb),
    'teammate_history',coalesce((
      select jsonb_agg(jsonb_build_object('player_a',th.player_a,'player_b',th.player_b,'count',th.count))
      from public.teammate_history th
    ),'[]'::jsonb),
    'settings',(
      select jsonb_build_object(
        'id',s.id,
        'weight_handling',s.weight_handling,
        'weight_cutting',s.weight_cutting,
        'weight_defense',s.weight_defense,
        'k_factor',s.k_factor,
        'repeat_weight',s.repeat_weight,
        'prioritize_handler_separation',s.prioritize_handler_separation,
        'handler_separation_boost',s.handler_separation_boost,
        'prioritize_elite_balance',s.prioritize_elite_balance,
        'elite_balance_boost',s.elite_balance_boost,
        'reshuffle_mode',s.reshuffle_mode
      )
      from public.settings s
      where s.id='main'
      limit 1
    ),
    'current_game',(
      select jsonb_build_object(
        'teams',cg.teams,
        'generated_at',cg.generated_at,
        'selected_winner_index',cg.selected_winner_index,
        'results_saved',cg.results_saved
      )
      from public.current_game cg
      where cg.id='main'
      limit 1
    )
  );
$$;
grant execute on function public.get_app_bootstrap_4120() to anon, authenticated;

-- Profile teammate counts from games whose RESULTS were actually saved.
-- Pairings-only games have winner_team_index IS NULL and are deliberately excluded.
create or replace function public.get_saved_result_teammates_4120(p_player_id uuid)
returns table(teammate_id uuid, full_name text, games_together bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception using message = 'Sign in required.';
  end if;

  if not public.can_manage_games()
     and not exists(
       select 1 from public.profiles pr
       where pr.id = auth.uid() and pr.player_id = p_player_id
     ) then
    raise exception using message = 'You can only view your own saved-result teammate history.';
  end if;

  return query
  with teammate_ids as (
    select nullif(mate.player_obj ->> 'id','')::uuid as teammate_id
    from public.games g
    cross join lateral jsonb_array_elements(g.teams) as team(team_json)
    cross join lateral jsonb_array_elements(team.team_json) as self_player(player_obj)
    cross join lateral jsonb_array_elements(team.team_json) as mate(player_obj)
    where g.winner_team_index is not null
      and nullif(self_player.player_obj ->> 'id','')::uuid = p_player_id
      and nullif(mate.player_obj ->> 'id','')::uuid is not null
      and nullif(mate.player_obj ->> 'id','')::uuid <> p_player_id
  )
  select p.id,p.full_name,count(*)::bigint
  from teammate_ids t
  join public.players p on p.id=t.teammate_id
  group by p.id,p.full_name
  order by count(*) desc,p.full_name asc
  limit 10;
end;
$$;
grant execute on function public.get_saved_result_teammates_4120(uuid) to authenticated;
