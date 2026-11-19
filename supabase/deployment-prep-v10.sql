begin;

-- V10 deployment preparation for an existing V8/V9 Supabase database.
-- Run once in Supabase SQL Editor after the previous participant-management migration.
-- New projects should run schema.sql instead of this migration.

update public.questions
set card_image = 'assets/images/card-oman-emblem.png';

create or replace function public.register_participant(p_name text, p_client_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_id uuid;
  v_name text;
begin
  v_name := trim(coalesce(p_name, ''));
  if char_length(v_name) < 2 or char_length(v_name) > 40 then
    raise exception 'يرجى إدخال اسم من حرفين إلى 40 حرفاً.';
  end if;
  if p_client_token is null then raise exception 'رمز المشاركة غير صالح.'; end if;

  -- Serialize registration with the organizer's start action and participant deletion.
  select status into v_status
  from public.competition_state
  where id = 1
  for update;

  if not found then raise exception 'حالة المسابقة غير متاحة.'; end if;

  -- Existing participants may resume on the same browser after the competition starts.
  select id into v_id
  from public.participants
  where client_token = p_client_token;

  if v_id is not null then
    return jsonb_build_object('participant_id', v_id, 'status', v_status);
  end if;

  -- New registrations are accepted only before the organizer starts the competition.
  if v_status <> 'registration' then
    raise exception 'انتهى التسجيل. لا يمكن تسجيل مشاركين جدد بعد بدء المسابقة.';
  end if;

  insert into public.participants (client_token, display_name)
  values (p_client_token, v_name)
  returning id into v_id;

  return jsonb_build_object('participant_id', v_id, 'status', v_status, 'display_name', v_name);
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

create or replace function public.admin_reset_competition()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if not public.is_admin() then raise exception 'غير مصرح.'; end if;

  select status into v_status
  from public.competition_state
  where id = 1
  for update;

  if v_status is null or v_status not in ('closed', 'revealing') then
    raise exception 'يمكن بدء جولة جديدة بعد إنهاء الجولة الحالية فقط.';
  end if;

  delete from public.activity_log;
  delete from public.answers;
  delete from public.winners;
  delete from public.participants;

  update public.competition_state
  set status = 'registration',
      round_id = gen_random_uuid(),
      started_at = null,
      closed_at = null,
      updated_at = clock_timestamp()
  where id = 1;

  return public.get_public_state();
end;
$$;

revoke all on function public.register_participant(text, uuid) from public;
grant execute on function public.register_participant(text, uuid) to anon, authenticated;

revoke all on function public.admin_delete_participant(uuid) from public;
grant execute on function public.admin_delete_participant(uuid) to authenticated;

revoke all on function public.admin_reset_competition() from public;
grant execute on function public.admin_reset_competition() to authenticated;

-- The state-row lock in register_participant and admin_delete_participant
-- makes the registration cutoff atomic with the organizer's start action.

commit;
