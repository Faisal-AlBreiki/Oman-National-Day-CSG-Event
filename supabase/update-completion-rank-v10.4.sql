-- V10.4: Return each participant's own completion rank after the organizer closes the competition.
-- Run once on an existing V10.3 Supabase database.
-- This migration changes only get_participant_state. It does not modify or delete competition data.

begin;

create or replace function public.get_participant_state(p_participant_id uuid, p_client_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_participant public.participants%rowtype;
  v_status text;
  v_answered jsonb;
  v_winner_place smallint;
  v_completion_rank integer;
begin
  -- Both values are required: a participant can only retrieve their own record
  -- from the browser that registered it.
  select * into v_participant
  from public.participants
  where id = p_participant_id
    and client_token = p_client_token;

  if not found then
    return null;
  end if;

  select status
  into v_status
  from public.competition_state
  where id = 1;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'question_id', question_id,
        'is_correct', is_correct
      )
      order by question_id
    ),
    '[]'::jsonb
  )
  into v_answered
  from public.answers
  where participant_id = p_participant_id;

  -- Reveal only this participant's own final place after the organizer closes the round.
  if v_status in ('closed', 'revealing') then
    if v_participant.completed_at is not null then
      select ranked.completion_rank
      into v_completion_rank
      from (
        select
          id,
          row_number() over (order by completed_at asc, id asc)::integer as completion_rank
        from public.participants
        where completed_at is not null
      ) ranked
      where ranked.id = p_participant_id;
    end if;

    select place
    into v_winner_place
    from public.winners
    where participant_id = p_participant_id;
  end if;

  return jsonb_build_object(
    'participant_id', v_participant.id,
    'display_name', v_participant.display_name,
    'correct_count', v_participant.correct_count,
    'answered_questions', v_answered,
    'competition_status', v_status,
    'results_revealed', (v_status in ('closed', 'revealing')),
    'winner_place', v_winner_place,
    'completion_rank', v_completion_rank
  );
end;
$$;

revoke all on function public.get_participant_state(uuid, uuid) from public;
grant execute on function public.get_participant_state(uuid, uuid) to anon, authenticated;

commit;
