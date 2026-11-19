-- Update for the public, spoiler-safe Live Activity panel and delayed winner reveal.
-- Run this in Supabase SQL Editor if the original schema.sql was already applied.
create or replace function public.get_public_state()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_comp public.competition_state%rowtype;
  v_participants integer;
  v_started integer;
  v_winners_count integer;
  v_winners jsonb := '[]'::jsonb;
  v_public_activity jsonb := '[]'::jsonb;
begin
  select * into v_comp from public.competition_state where id = 1;
  select count(*) into v_participants from public.participants;
  select count(*) into v_started from public.participants where started_at is not null;
  select count(*) into v_winners_count from public.winners;

  if v_winners_count = 3 and v_comp.status in ('closed','revealing') then
    select coalesce(jsonb_agg(jsonb_build_object(
      'place', w.place,
      'display_name', p.display_name,
      'achieved_at', w.achieved_at
    ) order by w.place), '[]'::jsonb)
    into v_winners
    from public.winners w join public.participants p on p.id = w.participant_id;
  end if;

  -- Only generic event types and timestamps are exposed to public clients.
  select coalesce(jsonb_agg(jsonb_build_object(
    'event_type', 'activity',
    'created_at', created_at
  ) order by id desc), '[]'::jsonb)
  into v_public_activity
  from (select id, event_type, created_at
        from public.activity_log
        order by id desc
        limit 6) recent_activity;

  return jsonb_build_object(
    'round_id', v_comp.round_id,
    'status', v_comp.status,
    'participant_count', v_participants,
    'started_count', v_started,
    'public_activity', v_public_activity,
    'winners', v_winners
  );
end;
$$;

revoke all on function public.get_public_state() from public;
grant execute on function public.get_public_state() to anon, authenticated;
