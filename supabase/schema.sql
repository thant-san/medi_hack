-- Patient Flow Analytics schema
create extension if not exists pgcrypto;

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  hnx text unique not null,
  display_name text,
  dob date,
  phone text,
  created_at timestamptz not null default now()
);

create table if not exists public.screening_records (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  hnx text not null,
  modify_time timestamptz not null,
  spid text not null,
  weight numeric,
  height numeric,
  bmi numeric,
  sbp int,
  dbp int,
  chief_complaint text,
  illness_detail text,
  raw_payload jsonb,
  source text not null default 'import' check (source in ('import', 'app')),
  created_at timestamptz not null default now()
);

create index if not exists idx_screening_hnx on public.screening_records(hnx);
create index if not exists idx_screening_modify_time on public.screening_records(modify_time);
create index if not exists idx_screening_spid on public.screening_records(spid);

create table if not exists public.doctors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  spid text not null,
  room_label text,
  is_active boolean not null default true
);

create index if not exists idx_doctors_spid on public.doctors(spid);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  doctor_id uuid not null references public.doctors(id),
  spid text not null,
  visit_reason text not null,
  complaint text,
  status text not null check (status in ('scheduled', 'waiting', 'in_consult', 'done', 'cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists idx_appointments_spid on public.appointments(spid);

create table if not exists public.queue_entries (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  doctor_id uuid not null references public.doctors(id),
  patient_id uuid not null references public.patients(id) on delete cascade,
  spid text not null,
  queue_number int not null,
  priority int not null default 0,
  status text not null check (status in ('waiting', 'called', 'in_room', 'done')),
  created_at timestamptz not null default now(),
  called_at timestamptz,
  done_at timestamptz
);

create index if not exists idx_queue_entries_doctor on public.queue_entries(doctor_id);
create index if not exists idx_queue_entries_spid on public.queue_entries(spid);
create index if not exists idx_queue_entries_patient on public.queue_entries(patient_id);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  queue_entry_id uuid not null references public.queue_entries(id) on delete cascade,
  type text not null check (type in ('near_turn', 'called', 'info')),
  message text not null,
  delivered boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.analytics_daily (
  date date primary key,
  total_visits int not null,
  avg_wait_minutes numeric not null,
  peak_time text,
  most_overloaded_spid text,
  notes text
);

create table if not exists public.doctor_patient_map (
  doctor_id uuid not null references public.doctors(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (doctor_id, patient_id)
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('patient', 'doctor', 'admin')),
  patient_id uuid references public.patients(id) on delete set null,
  doctor_id uuid references public.doctors(id) on delete set null
);

alter table public.patients enable row level security;
alter table public.screening_records enable row level security;
alter table public.doctors enable row level security;
alter table public.appointments enable row level security;
alter table public.queue_entries enable row level security;
alter table public.notifications enable row level security;
alter table public.analytics_daily enable row level security;
alter table public.doctor_patient_map enable row level security;
alter table public.profiles enable row level security;

-- helper role checks
create or replace function public.current_user_role()
returns text
language sql
stable
as $$
  select role from public.profiles where id = auth.uid()
$$;

-- profiles
drop policy if exists "profiles_self_select" on public.profiles;
create policy "profiles_self_select"
on public.profiles for select
using (id = auth.uid());

-- patients
drop policy if exists "patients_self_or_admin_select" on public.patients;
create policy "patients_self_or_admin_select"
on public.patients for select
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and (p.role = 'admin' or p.patient_id = public.patients.id)
  )
);

drop policy if exists "patients_staff_insert" on public.patients;
create policy "patients_staff_insert"
on public.patients for insert
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'doctor', 'patient')
  )
);

-- doctors
drop policy if exists "doctors_read_all_authenticated" on public.doctors;
create policy "doctors_read_all_authenticated"
on public.doctors for select
to authenticated
using (true);

-- screening records
drop policy if exists "screening_self_doctor_admin_select" on public.screening_records;
create policy "screening_self_doctor_admin_select"
on public.screening_records for select
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'admin'
        or p.patient_id = public.screening_records.patient_id
        or (p.role = 'doctor' and p.doctor_id in (select d.id from public.doctors d where d.spid = public.screening_records.spid))
      )
  )
);

drop policy if exists "screening_staff_insert" on public.screening_records;
create policy "screening_staff_insert"
on public.screening_records for insert
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'doctor', 'patient')
  )
);

-- appointments
drop policy if exists "appointments_patient_doctor_admin_select" on public.appointments;
create policy "appointments_patient_doctor_admin_select"
on public.appointments for select
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'admin'
        or p.patient_id = public.appointments.patient_id
        or p.doctor_id = public.appointments.doctor_id
      )
  )
);

drop policy if exists "appointments_staff_insert" on public.appointments;
create policy "appointments_staff_insert"
on public.appointments for insert
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'doctor', 'patient')
  )
);

drop policy if exists "appointments_staff_update" on public.appointments;
create policy "appointments_staff_update"
on public.appointments for update
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and (p.role = 'admin' or p.doctor_id = public.appointments.doctor_id)
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and (p.role = 'admin' or p.doctor_id = public.appointments.doctor_id)
  )
);

-- queue entries
drop policy if exists "queue_patient_doctor_admin_select" on public.queue_entries;
create policy "queue_patient_doctor_admin_select"
on public.queue_entries for select
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'admin'
        or p.patient_id = public.queue_entries.patient_id
        or p.doctor_id = public.queue_entries.doctor_id
      )
  )
);

drop policy if exists "queue_insert_authenticated" on public.queue_entries;
create policy "queue_insert_authenticated"
on public.queue_entries for insert
to authenticated
with check (true);

drop policy if exists "queue_doctor_admin_update" on public.queue_entries;
create policy "queue_doctor_admin_update"
on public.queue_entries for update
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and (p.role = 'admin' or p.doctor_id = public.queue_entries.doctor_id)
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and (p.role = 'admin' or p.doctor_id = public.queue_entries.doctor_id)
  )
);

-- notifications
drop policy if exists "notifications_patient_doctor_admin_select" on public.notifications;
create policy "notifications_patient_doctor_admin_select"
on public.notifications for select
using (
  exists (
    select 1
    from public.profiles p
    left join public.queue_entries q on q.id = public.notifications.queue_entry_id
    where p.id = auth.uid()
      and (
        p.role = 'admin'
        or p.patient_id = public.notifications.patient_id
        or p.doctor_id = q.doctor_id
      )
  )
);

drop policy if exists "notifications_insert_authenticated" on public.notifications;
create policy "notifications_insert_authenticated"
on public.notifications for insert
to authenticated
with check (true);

drop policy if exists "notifications_update_owner" on public.notifications;
create policy "notifications_update_owner"
on public.notifications for update
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and (p.role = 'admin' or p.patient_id = public.notifications.patient_id)
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and (p.role = 'admin' or p.patient_id = public.notifications.patient_id)
  )
);

-- admin-only tables
drop policy if exists "analytics_admin_all" on public.analytics_daily;
create policy "analytics_admin_all"
on public.analytics_daily for all
using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
)
with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);

drop policy if exists "doctor_patient_map_admin_doctor" on public.doctor_patient_map;
create policy "doctor_patient_map_admin_doctor"
on public.doctor_patient_map for select
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and (p.role = 'admin' or p.doctor_id = public.doctor_patient_map.doctor_id)
  )
);

drop policy if exists "doctor_patient_map_staff_upsert" on public.doctor_patient_map;
create policy "doctor_patient_map_staff_upsert"
on public.doctor_patient_map for all
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and (p.role = 'admin' or p.doctor_id = public.doctor_patient_map.doctor_id)
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and (p.role = 'admin' or p.doctor_id = public.doctor_patient_map.doctor_id)
  )
);

-- Demo mode anonymous read policies (for frontend role-switch without auth)
drop policy if exists "doctors_read_all_anon" on public.doctors;
create policy "doctors_read_all_anon"
on public.doctors for select
to anon
using (true);

drop policy if exists "screening_read_all_anon" on public.screening_records;
create policy "screening_read_all_anon"
on public.screening_records for select
to anon
using (true);

drop policy if exists "queue_read_all_anon" on public.queue_entries;
create policy "queue_read_all_anon"
on public.queue_entries for select
to anon
using (true);

drop policy if exists "appointments_read_all_anon" on public.appointments;
create policy "appointments_read_all_anon"
on public.appointments for select
to anon
using (true);

drop policy if exists "patients_read_all_anon" on public.patients;
create policy "patients_read_all_anon"
on public.patients for select
to anon
using (true);

drop policy if exists "doctor_patient_map_read_all_anon" on public.doctor_patient_map;
create policy "doctor_patient_map_read_all_anon"
on public.doctor_patient_map for select
to anon
using (true);

-- Realtime tables
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'queue_entries'
  ) then
    alter publication supabase_realtime add table public.queue_entries;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
