-- 4.13.0: Convert a one-time player into a permanent roster player without recreating the record.
create or replace function public.make_temporary_player_permanent_from_app(
  p_player_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_games() then
    raise exception using message = 'Captain/admin only.';
  end if;

  if not exists(select 1 from public.players where id = p_player_id) then
    raise exception using message = 'Player not found.';
  end if;

  -- Captains normally cannot change temporary status directly. This narrow RPC
  -- allows only the safe one-time -> permanent transition.
  perform set_config('app.bypass_captain_player_guard', 'on', true);
  update public.players
  set temporary = false,
      updated_at = now()
  where id = p_player_id
    and temporary is true;
  perform set_config('app.bypass_captain_player_guard', 'off', true);
end;
$$;

grant execute on function public.make_temporary_player_permanent_from_app(uuid) to authenticated;
