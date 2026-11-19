-- V10.3: Reveal a participant's own final place only when the organizer closes the competition.
-- Run once in Supabase SQL Editor on the existing V10 database.
-- This migration does not delete or reset participants, answers, winners, or questions.

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

  -- Do not reveal any place until the organizer closes the competition.
  if v_status in ('closed', 'revealing') then
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
    'winner_place', v_winner_place
  );
end;
$$;

revoke all on function public.get_participant_state(uuid, uuid) from public;
grant execute on function public.get_participant_state(uuid, uuid) to anon, authenticated;

commit;
