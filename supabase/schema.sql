-- ============================================================
-- من يعرف عُمان أكثر؟ | Supabase schema
-- Run this file in Supabase SQL Editor before switching DEMO_MODE off.
-- ============================================================

create extension if not exists pgcrypto;

-- 1) حالة الجولة الحالية
create table if not exists public.competition_state (
  id smallint primary key default 1 check (id = 1),
  title text not null default 'من يعرف عُمان أكثر؟',
  status text not null default 'registration'
    check (status in ('registration','live','paused','revealing','closed')),
  round_id uuid not null default gen_random_uuid(),
  started_at timestamptz,
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.competition_state (id) values (1) on conflict (id) do nothing;

-- 2) حسابات المنظمين: أضف UUID حساب المنظم بعد إنشائه في Supabase Auth.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 3) الأسئلة. correct_option يبدأ من 0 ولا يظهر في public_questions.
create table if not exists public.questions (
  id integer primary key check (id between 1 and 9),
  prompt text not null,
  card_image text not null,
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4),
  correct_option smallint not null check (correct_option between 0 and 3),
  display_order smallint not null unique,
  active boolean not null default true
);

-- 4) المشاركون. client_token يمنع تكرار التسجيل من نفس المتصفح فقط.
create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  client_token uuid not null unique,
  display_name text not null check (char_length(display_name) between 2 and 40),
  joined_at timestamptz not null default clock_timestamp(),
  started_at timestamptz,
  last_activity_at timestamptz not null default clock_timestamp(),
  correct_count smallint not null default 0 check (correct_count between 0 and 3),
  completed_at timestamptz
);

-- 5) إجابة واحدة لكل مشارك لكل بطاقة، سواء كانت صحيحة أو خاطئة.
create table if not exists public.answers (
  id bigint generated always as identity primary key,
  participant_id uuid not null references public.participants(id) on delete cascade,
  question_id integer not null references public.questions(id),
  selected_option smallint not null check (selected_option between 0 and 3),
  is_correct boolean not null,
  submitted_at timestamptz not null default clock_timestamp(),
  unique (participant_id, question_id)
);

-- 6) المراكز الثلاثة. place هو ترتيب الفوز المحجوز مركزياً.
create table if not exists public.winners (
  place smallint primary key check (place between 1 and 3),
  participant_id uuid not null unique references public.participants(id) on delete cascade,
  achieved_at timestamptz not null default clock_timestamp()
);

-- 7) سجل النشاط: يظهر كاملاً للمنظم، وتُعرض أحداث مختارة منه للعامة دون ترتيب الفائزين.
create table if not exists public.activity_log (
  id bigint generated always as identity primary key,
  participant_id uuid references public.participants(id) on delete cascade,
  event_type text not null check (event_type in ('correct_answer','incorrect_answer','completed')),
  participant_name text not null,
  question_id integer references public.questions(id),
  created_at timestamptz not null default clock_timestamp()
);

-- Keep participant linkage available when upgrading an existing V7 database.
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

-- Backfill older activity rows only when a display name is unique in this round.
update public.activity_log a
set participant_id = p.id
from public.participants p
where a.participant_id is null
  and a.participant_name = p.display_name
  and (select count(*) from public.participants p2 where p2.display_name = p.display_name) = 1;

-- 8) واجهة الأسئلة العامة لا تعرض الإجابة الصحيحة.
create or replace view public.public_questions
with (security_invoker = true) as
select id, prompt, card_image, options, display_order
from public.questions
where active = true;

-- Enable RLS.
alter table public.competition_state enable row level security;
alter table public.admin_users enable row level security;
alter table public.questions enable row level security;
alter table public.participants enable row level security;
alter table public.answers enable row level security;
alter table public.winners enable row level security;
alter table public.activity_log enable row level security;

-- Public can read only the public round status and active question columns.
drop policy if exists "Public can read competition state" on public.competition_state;
create policy "Public can read competition state" on public.competition_state
for select to anon, authenticated using (true);

drop policy if exists "Public can read active questions" on public.questions;
create policy "Public can read active questions" on public.questions
for select to anon, authenticated using (active = true);

drop policy if exists "Admins can read own admin membership" on public.admin_users;
create policy "Admins can read own admin membership" on public.admin_users
for select to authenticated using (user_id = auth.uid());

drop policy if exists "Admins can read activity log" on public.activity_log;
create policy "Admins can read activity log" on public.activity_log
for select to authenticated using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

-- Do not grant direct access to participant answers/winner tables.
revoke all on public.participants, public.answers, public.winners from anon, authenticated;
revoke all on public.activity_log from anon;
revoke all on public.questions from anon, authenticated;
revoke all on public.competition_state from anon, authenticated;

-- Grant only the columns required by the public view; correct_option is excluded.
grant select (id, prompt, card_image, options, display_order, active) on public.questions to anon, authenticated;
grant select on public.public_questions to anon, authenticated;
grant select on public.competition_state to anon, authenticated;
grant select on public.activity_log to authenticated;
grant select on public.admin_users to authenticated;

-- Admin predicate. Membership is stored in admin_users, not in browser code.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Public registration. The same browser token reuses the same participant.
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

-- Restore one participant's progress on page refresh.
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

-- Public state keeps winner identities hidden until the organizer closes the competition.
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

  -- Public live feed includes participant names and per-question outcome,
  -- but never selected options, correctness totals, or winner places.
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

-- Submit an answer. Locking the singleton competition row serializes answer
-- acceptance and winner allocation, ensuring that only three places exist.
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

-- Admin dashboard may see the three reserved places before public reveal; public clients cannot.
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

create or replace function public.admin_set_competition_status(p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_current text;
begin
  if not public.is_admin() then raise exception 'غير مصرح.'; end if;
  if p_status not in ('live','paused','closed') then raise exception 'حالة غير صالحة.'; end if;
  select status into v_current from public.competition_state where id = 1 for update;
  if p_status = 'live' and v_current not in ('registration','paused') then raise exception 'لا يمكن بدء المسابقة من الحالة الحالية.'; end if;
  if p_status = 'paused' and v_current <> 'live' then raise exception 'المسابقة ليست مباشرة حالياً.'; end if;
  if p_status = 'closed' and v_current not in ('registration','live','paused','revealing') then raise exception 'لا يمكن إنهاء المسابقة من الحالة الحالية.'; end if;
  update public.competition_state
  set status = p_status,
      started_at = case when p_status = 'live' then coalesce(started_at, clock_timestamp()) else started_at end,
      closed_at = case when p_status = 'closed' then clock_timestamp() else closed_at end,
      updated_at = clock_timestamp()
  where id = 1;
  return public.get_public_state();
end;
$$;

-- Admin-only permanent participant deletion. Participant answers and linked activity
-- are deleted as well; reserved winner places are recalculated from remaining completions.
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

-- Admin-only participant export for CSV generation in the dashboard.
create or replace function public.admin_export_results()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_rows jsonb;
begin
  if not public.is_admin() then raise exception 'غير مصرح.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'display_name', p.display_name,
    'joined_at', p.joined_at,
    'correct_count', p.correct_count,
    'winner_place', w.place
  ) order by p.joined_at), '[]'::jsonb)
  into v_rows
  from public.participants p
  left join public.winners w on w.participant_id = p.id;
  return v_rows;
end;
$$;

-- Function permissions.
revoke all on function public.register_participant(text, uuid) from public;
revoke all on function public.get_participant_state(uuid, uuid) from public;
revoke all on function public.get_public_state() from public;
revoke all on function public.answer_question(uuid, uuid, integer, smallint) from public;
revoke all on function public.admin_dashboard_state() from public;
revoke all on function public.admin_set_competition_status(text) from public;
revoke all on function public.admin_reset_competition() from public;
revoke all on function public.admin_delete_participant(uuid) from public;
revoke all on function public.admin_export_results() from public;

grant execute on function public.register_participant(text, uuid) to anon, authenticated;
grant execute on function public.get_participant_state(uuid, uuid) to anon, authenticated;
grant execute on function public.get_public_state() to anon, authenticated;
grant execute on function public.answer_question(uuid, uuid, integer, smallint) to anon, authenticated;
grant execute on function public.admin_dashboard_state() to authenticated;
grant execute on function public.admin_set_competition_status(text) to authenticated;
grant execute on function public.admin_reset_competition() to authenticated;
grant execute on function public.admin_delete_participant(uuid) to authenticated;
grant execute on function public.admin_export_results() to authenticated;

-- Realtime publications used by the admin and big-screen clients.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='competition_state') then
      execute 'alter publication supabase_realtime add table public.competition_state';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='activity_log') then
      execute 'alter publication supabase_realtime add table public.activity_log';
    end if;
  end if;
end $$;

-- ============================================================
-- OFFICIAL QUESTIONS: من يعرف عُمان أكثر؟
-- correct_option is zero-based. All cards use card-oman-emblem.png.
-- ============================================================
insert into public.questions (id,prompt,card_image,options,correct_option,display_order,active) values
(1,'في أي عيد وطني أعلن السلطان قابوس – طيب الله ثراه – وضع حجر الأساس لجامعة السلطان قابوس؟','assets/images/card-oman-emblem.png','[{"text":"١١"},{"text":"١٢"},{"text":"١٣"},{"text":"١٤"}]'::jsonb,1,1,true),
(2,'ما اسم أول جريدة صدرت في سلطنة عُمان؟','assets/images/card-oman-emblem.png','[{"text":"جريدة عُمان"},{"text":"جريدة الوطن"},{"text":"جريدة الشبيبة"},{"text":"جريدة الرؤية"}]'::jsonb,1,2,true),
(3,'في أي عام تأسست دولة البوسعيد في عُمان؟','assets/images/card-oman-emblem.png','[{"text":"1741م"},{"text":"1742م"},{"text":"1743م"},{"text":"1744م"}]'::jsonb,3,3,true),
(4,'في أي عام أُقيم أول احتفال باليوم الوطني العُماني؟','assets/images/card-oman-emblem.png','[{"text":"1970م"},{"text":"1971م"},{"text":"1974م"},{"text":"1975م"}]'::jsonb,1,4,true),
(5,'من هو أول عُماني اعتنق الإسلام؟','assets/images/card-oman-emblem.png','[{"text":"الإمام أحمد بن سعيد"},{"text":"مازن بن غضوبة السعدي"},{"text":"لقيط بن مالك الأزدي"},{"text":"مالك بن فهم"}]'::jsonb,1,5,true),
(6,'ما المدينة التي اتخذها الإمام أحمد بن سعيد عاصمةً لحكمه؟','assets/images/card-oman-emblem.png','[{"text":"نزوى"},{"text":"مسقط"},{"text":"الرستاق"},{"text":"صحار"}]'::jsonb,2,6,true),
(7,'في أي عام تولّى السلطان قابوس بن سعيد الحكم في عُمان؟','assets/images/card-oman-emblem.png','[{"text":"1968م"},{"text":"1970م"},{"text":"1971م"},{"text":"1975م"}]'::jsonb,1,7,true),
(8,'من مؤسس الدولة البوسعيدية في عُمان؟','assets/images/card-oman-emblem.png','[{"text":"أحمد بن سعيد البوسعيدي"},{"text":"سلطان بن أحمد البوسعيدي"},{"text":"سعيد بن سلطان البوسعيدي"},{"text":"حمد بن سعيد البوسعيدي"}]'::jsonb,0,8,true),
(9,'تتبع جزيرة مصيرة إداريًا أي محافظة؟','assets/images/card-oman-emblem.png','[{"text":"محافظة ظفار"},{"text":"محافظة الوسطى"},{"text":"محافظة جنوب الشرقية"},{"text":"محافظة شمال الشرقية"}]'::jsonb,2,9,true)
on conflict (id) do update set prompt=excluded.prompt, card_image=excluded.card_image, options=excluded.options, correct_option=excluded.correct_option, display_order=excluded.display_order, active=excluded.active;

-- بعد إنشاء مستخدم المنظم من Authentication > Users، نفّذ:
-- insert into public.admin_users (user_id) values ('ضع-UUID-حساب-المنظم-هنا');
