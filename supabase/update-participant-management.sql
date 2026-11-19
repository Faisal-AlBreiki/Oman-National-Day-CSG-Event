-- ============================================================
-- V8: Admin participant management (permanent deletion only)
-- Run once in Supabase SQL Editor on an existing V7 database.
-- ============================================================

-- Link activity records to participants so deleting a participant also removes
-- their public/admin activity events.
alter table public.activity_log add column if not exists participant_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'activity_log_participant_id_fkey'
      and conrelid = 'public.activity_log'::regclass
  ) then
    alter table public.activity_log
      add constraint activity_log_participant_id_fkey
      foreign key (participant_id) references public.participants(id) on delete cascade;
  end if;
end $$;

-- Backfill legacy activity rows only when a name belongs to one participant.
update public.activity_log a
set participant_id = p.id
from public.participants p
where a.participant_id is null
  and a.participant_name = p.display_name
  and (select count(*) from public.participants p2 where p2.display_name = p.display_name) = 1;

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

  insert into public.activity_log (participant_id, event_type, participant_name, question_id)
  values (p_participant_id, case when v_correct then 'correct_answer' else 'incorrect_answer' end,
          v_participant.display_name, p_question_id);

  if v_new_count >= 3 and v_participant.completed_at is null then
    select count(*) into v_winners_count from public.winners;
    if v_winners_count < 3 then
      v_place := v_winners_count + 1;
      insert into public.winners (place, participant_id, achieved_at)
      values (v_place, p_participant_id, clock_timestamp());
    end if;
    update public.participants set completed_at = clock_timestamp() where id = p_participant_id;
    insert into public.activity_log (participant_id, event_type, participant_name, question_id)
    values (p_participant_id, 'completed', v_participant.display_name, null);
    -- Keep the competition live after the third qualifying participant.
    -- The organizer explicitly closes it to trigger the public winner reveal.
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

create or replace function public.admin_dashboard_state()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state jsonb;
  v_activity jsonb;
  v_winners jsonb := '[]'::jsonb;
  v_participants jsonb := '[]'::jsonb;
  v_winners_count integer;
begin
  if not public.is_admin() then raise exception 'غير مصرح.'; end if;
  v_state := public.get_public_state();
  select coalesce(jsonb_agg(jsonb_build_object(
    'event_type', event_type,
    'participant_name', participant_name,
    'question_id', question_id,
    'created_at', created_at
  ) order by id desc), '[]'::jsonb)
  into v_activity from (select * from public.activity_log order by id desc limit 30) a;
  select count(*) into v_winners_count from public.winners;
  if v_winners_count = 3 then
    select coalesce(jsonb_agg(jsonb_build_object(
      'place', w.place,
      'display_name', p.display_name,
      'achieved_at', w.achieved_at
    ) order by w.place), '[]'::jsonb)
    into v_winners from public.winners w join public.participants p on p.id = w.participant_id;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'participant_id', p.id,
    'display_name', p.display_name,
    'joined_at', p.joined_at,
    'started_at', p.started_at,
    'correct_count', p.correct_count,
    'completed_at', p.completed_at,
    'winner_place', w.place
  ) order by p.joined_at desc), '[]'::jsonb)
  into v_participants
  from public.participants p
  left join public.winners w on w.participant_id = p.id;

  return v_state || jsonb_build_object(
    'activity',v_activity,
    'winners',v_winners,
    'participants',v_participants,
    'completed_count',v_winners_count,
    'answers_count',(select count(*) from public.answers)
  );
end;
$$;

create or replace function public.admin_delete_participant(p_participant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_winners_count integer;
  v_status text;
begin
  if not public.is_admin() then raise exception 'غير مصرح.'; end if;
  if p_participant_id is null then raise exception 'معرّف المشارك غير صالح.'; end if;

  -- Serialize deletion with registration/start and other state-changing operations.
  select status into v_status
  from public.competition_state
  where id = 1
  for update;

  if v_status is distinct from 'registration' then
    raise exception 'لا يمكن حذف المشاركين بعد بدء المسابقة. الحذف متاح أثناء التسجيل فقط.';
  end if;

  select display_name into v_name
  from public.participants
  where id = p_participant_id
  for update;

  if not found then raise exception 'المشارك غير موجود أو تم حذفه مسبقاً.'; end if;

  -- Remove legacy activity rows that predate participant_id linkage.
  delete from public.activity_log
  where participant_id is null and participant_name = v_name;

  delete from public.participants where id = p_participant_id;

  -- Registration is the only phase in which deletion is allowed; no answers or winners
  -- should exist yet. Rebuild defensively in case the database contains legacy data.
  delete from public.winners;
  insert into public.winners (place, participant_id, achieved_at)
  select row_number() over (order by eligible.completed_at, eligible.joined_at, eligible.id)::smallint,
         eligible.id,
         eligible.completed_at
  from (
    select id, completed_at, joined_at
    from public.participants
    where completed_at is not null
    order by completed_at, joined_at, id
    limit 3
  ) eligible;

  select count(*) into v_winners_count from public.winners;
  return jsonb_build_object(
    'success', true,
    'deleted_participant_id', p_participant_id,
    'completed_count', v_winners_count
  );
end;
$$;

revoke all on function public.admin_delete_participant(uuid) from public;
grant execute on function public.admin_delete_participant(uuid) to authenticated;

-- The existing authenticated-only admin_dashboard_state and answer_question
-- permissions are preserved by CREATE OR REPLACE FUNCTION.
