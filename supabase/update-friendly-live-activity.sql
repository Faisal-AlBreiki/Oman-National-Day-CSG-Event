-- Friendly, named public Live Activity for Oman National Day Quiz V7.
-- Run once in Supabase SQL Editor after V6 (manual-stop-reveal) is installed.
-- The public feed may show names and whether an answer was correct, but never
-- selected options, answer keys, correctness totals, or winner places.

alter table public.activity_log
  drop constraint if exists activity_log_event_type_check;

alter table public.activity_log
  add constraint activity_log_event_type_check
  check (event_type in ('correct_answer', 'incorrect_answer', 'completed'));

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

  select coalesce(jsonb_agg(jsonb_build_object(
    'event_type', event_type,
    'participant_name', participant_name,
    'question_id', question_id,
    'created_at', created_at
  ) order by id desc), '[]'::jsonb)
  into v_public_activity
  from (select id, event_type, participant_name, question_id, created_at
        from public.activity_log
        where event_type in ('correct_answer', 'incorrect_answer')
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

create or replace function public.answer_question(
  p_participant_id uuid,
  p_client_token uuid,
  p_question_id integer,
  p_selected_option smallint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_comp public.competition_state%rowtype;
  v_participant public.participants%rowtype;
  v_question public.questions%rowtype;
  v_correct boolean;
  v_new_count smallint;
  v_winners_count integer;
  v_place smallint;
  v_status text;
begin
  select * into v_comp from public.competition_state where id = 1 for update;
  if v_comp.status <> 'live' then raise exception 'المسابقة غير مفتوحة لاستقبال الإجابات حالياً.'; end if;

  select * into v_participant from public.participants
  where id = p_participant_id and client_token = p_client_token for update;
  if not found then raise exception 'المشارك غير موجود. أعد التسجيل.'; end if;
  if v_participant.completed_at is not null then
    raise exception 'أكملت ثلاثة أسئلة صحيحة بالفعل. يرجى انتظار إعلان النتائج.';
  end if;

  select * into v_question from public.questions where id = p_question_id and active = true;
  if not found then raise exception 'السؤال غير متاح.'; end if;
  if p_selected_option is null or p_selected_option < 0 or p_selected_option > 3 then raise exception 'الخيار المحدد غير صالح.'; end if;
  if exists (select 1 from public.answers where participant_id = p_participant_id and question_id = p_question_id) then
    raise exception 'لقد أجبت عن هذه البطاقة مسبقاً.';
  end if;

  v_correct := (p_selected_option = v_question.correct_option);
  insert into public.answers (participant_id, question_id, selected_option, is_correct)
  values (p_participant_id, p_question_id, p_selected_option, v_correct);

  update public.participants
  set started_at = coalesce(started_at, clock_timestamp()),
      last_activity_at = clock_timestamp(),
      correct_count = correct_count + case when v_correct then 1 else 0 end
  where id = p_participant_id
  returning correct_count into v_new_count;

  insert into public.activity_log (event_type, participant_name, question_id)
  values (case when v_correct then 'correct_answer' else 'incorrect_answer' end,
          v_participant.display_name, p_question_id);

  if v_new_count >= 3 and v_participant.completed_at is null then
    select count(*) into v_winners_count from public.winners;
    if v_winners_count < 3 then
      v_place := v_winners_count + 1;
      insert into public.winners (place, participant_id, achieved_at)
      values (v_place, p_participant_id, clock_timestamp());
    end if;
    update public.participants set completed_at = clock_timestamp() where id = p_participant_id;
    insert into public.activity_log (event_type, participant_name, question_id)
    values ('completed', v_participant.display_name, null);
    -- Keep the competition live; the organizer manually ends it.
  end if;

  select status into v_status from public.competition_state where id = 1;
  return jsonb_build_object(
    'is_correct', v_correct,
    'correct_count', v_new_count,
    'competition_status', v_status,
    'already_answered', false
  );
end;
$$;
