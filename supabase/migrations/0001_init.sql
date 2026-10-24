-- Lantern schema. Every row belongs to a household; members of a household can read and write its rows.
-- Ids are text so fixtures and seeds can use readable ids like "bedroom". New rows get a uuid.

create table households (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  patient_name text not null,
  quiet_hours_start time not null default '21:00',
  quiet_hours_end time not null default '07:00',
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now()
);

create table members (
  household_id text not null references households on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'caregiver' check (role in ('caregiver', 'ot')),
  primary key (household_id, user_id)
);

create table contacts (
  id text primary key default gen_random_uuid()::text,
  household_id text not null references households on delete cascade,
  name text not null,
  relation text not null default '',
  phone text not null,
  priority smallint not null default 1 check (priority in (1, 2))
);

create table scans (
  id text primary key default gen_random_uuid()::text,
  household_id text not null references households on delete cascade,
  json_path text,
  usdz_path text,
  created_at timestamptz not null default now()
);

-- Geometry is stored as parsed from RoomPlan, in inches: outline (Vec2[]), doors/windows (Opening[]), objects (RoomObject[]).
create table rooms (
  id text primary key default gen_random_uuid()::text,
  household_id text not null references households on delete cascade,
  scan_id text references scans on delete set null,
  name text not null,
  outline jsonb not null default '[]',
  doors jsonb not null default '[]',
  windows jsonb not null default '[]',
  objects jsonb not null default '[]',
  photo_paths text[] not null default '{}'
);

create table receivers (
  id text primary key default gen_random_uuid()::text,
  household_id text not null references households on delete cascade,
  room_id text references rooms on delete set null,
  label text not null,
  mac text,
  last_seen_at timestamptz
);

create table beacons (
  id text primary key default gen_random_uuid()::text,
  household_id text not null references households on delete cascade,
  label text not null,
  uuid text,
  major int,
  minor int
);

create table audit_items (
  id text primary key default gen_random_uuid()::text,
  household_id text not null references households on delete cascade,
  room_id text references rooms on delete cascade,
  source text not null check (source in ('ada-rule', 'vision')),
  code text,
  title text not null,
  detail text not null default '',
  fix text not null default '',
  severity text not null check (severity in ('high', 'medium', 'low')),
  measured_in real,
  required_in real,
  photo_path text,
  location jsonb,
  status text not null default 'open' check (status in ('open', 'accepted', 'dismissed', 'fixed')),
  note text,
  created_at timestamptz not null default now()
);

-- Raw readings. label_room_id is set only while calibrating, which makes these rows training data.
create table rssi_samples (
  id bigint generated always as identity primary key,
  household_id text not null references households on delete cascade,
  receiver_id text not null references receivers on delete cascade,
  beacon_id text not null references beacons on delete cascade,
  rssi smallint not null,
  ts timestamptz not null default now(),
  label_room_id text references rooms on delete set null
);

create table location_events (
  id text primary key default gen_random_uuid()::text,
  household_id text not null references households on delete cascade,
  room_id text not null references rooms on delete cascade,
  confidence real not null default 1,
  ts timestamptz not null default now()
);

create table risk_events (
  id text primary key default gen_random_uuid()::text,
  household_id text not null references households on delete cascade,
  kind text not null check (kind in ('exit-approach', 'night-wandering', 'long-bathroom-stay', 'no-movement')),
  room_id text references rooms on delete set null,
  state text not null default 'detected' check (state in ('detected', 'redirecting', 'escalated', 'resolved')),
  started_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table alerts (
  id text primary key default gen_random_uuid()::text,
  household_id text not null references households on delete cascade,
  risk_event_id text not null references risk_events on delete cascade,
  channel text not null check (channel in ('sms', 'call')),
  "to" text not null,
  status text not null default 'sent' check (status in ('sent', 'delivered', 'acknowledged', 'failed')),
  ts timestamptz not null default now()
);

-- Human-readable log the dashboard timeline shows. The monitor writes one line per room change or response step.
create table activity (
  id text primary key default gen_random_uuid()::text,
  household_id text not null references households on delete cascade,
  kind text not null check (kind in ('move', 'risk', 'alert', 'info')),
  text text not null,
  ts timestamptz not null default now()
);

create table routines (
  id text primary key default gen_random_uuid()::text,
  household_id text not null references households on delete cascade,
  name text not null default 'Daily routine'
);

create table routine_steps (
  id text primary key default gen_random_uuid()::text,
  household_id text not null references households on delete cascade,
  routine_id text not null references routines on delete cascade,
  time time not null,
  title text not null,
  room_id text references rooms on delete set null,
  photo_path text,
  voice_path text
);

create table models (
  id text primary key default gen_random_uuid()::text,
  household_id text not null references households on delete cascade,
  kind text not null default 'knn',
  params jsonb not null,
  accuracy real,
  created_at timestamptz not null default now()
);

-- Indexes for the foreign keys and the "latest events" queries.
create index on members (user_id);
create index on contacts (household_id);
create index on scans (household_id);
create index on rooms (household_id);
create index on rooms (scan_id);
create index on receivers (household_id);
create index on receivers (room_id);
create index on beacons (household_id);
create index on audit_items (household_id);
create index on audit_items (room_id);
create index on rssi_samples (household_id, ts desc);
create index on rssi_samples (receiver_id);
create index on rssi_samples (beacon_id);
create index on rssi_samples (label_room_id);
create index on location_events (household_id, ts desc);
create index on location_events (room_id);
create index on risk_events (household_id, started_at desc);
create index on risk_events (room_id);
create index on alerts (household_id, ts desc);
create index on alerts (risk_event_id);
create index on activity (household_id, ts desc);
create index on routines (household_id);
create index on routine_steps (routine_id);
create index on routine_steps (household_id);
create index on routine_steps (room_id);
create index on models (household_id, created_at desc);

-- Row-level security. Security definer so the members check does not recurse through members' own policy.
create function public.is_member(hid text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.members where household_id = hid and user_id = (select auth.uid()));
$$;

alter table households enable row level security;
alter table members enable row level security;

create policy "members read their households" on households
  for select to authenticated using (public.is_member(id));
create policy "members update their households" on households
  for update to authenticated using (public.is_member(id)) with check (public.is_member(id));
create policy "users see their memberships" on members
  for select to authenticated using (user_id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['contacts', 'scans', 'rooms', 'receivers', 'beacons', 'audit_items', 'rssi_samples',
    'location_events', 'risk_events', 'alerts', 'activity', 'routines', 'routine_steps', 'models']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "household members" on %I for all to authenticated
      using (public.is_member(household_id)) with check (public.is_member(household_id))', t);
  end loop;
end $$;

-- Live updates for the dashboard.
alter publication supabase_realtime add table location_events, risk_events, alerts, activity;

-- Private buckets. Paths start with the household id: scans/{householdId}/{scanId}/room.json
insert into storage.buckets (id, name, public) values
  ('scans', 'scans', false),
  ('photos', 'photos', false),
  ('voice', 'voice', false)
on conflict (id) do nothing;

create policy "household members read files" on storage.objects
  for select to authenticated
  using (bucket_id in ('scans', 'photos', 'voice') and public.is_member((storage.foldername(name))[1]));
create policy "household members upload files" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('scans', 'photos', 'voice') and public.is_member((storage.foldername(name))[1]));
