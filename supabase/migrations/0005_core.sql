-- 0005_core.sql (owner: Aarnav). Changes to: households, contacts, zone_rules, location_events, risk_events, alerts, patient_state, routines, interventions.
-- 0001 to 0004 are the shared baseline already applied to the project; never edit them.
-- Add your changes below, newest at the bottom, and apply them with the Supabase CLI or MCP.

-- Events from the monitor use home model slugs (front-door, tv-room), which are not always rows in rooms
-- (scanned rooms get uuids). So these room ids are plain text, not foreign keys.
alter table location_events drop constraint if exists location_events_room_id_fkey;
alter table risk_events drop constraint if exists risk_events_room_id_fkey;

alter table location_events
  add column prev_room_id text,
  add column source text not null default 'ble' check (source in ('ble', 'sim'));

alter table risk_events drop constraint if exists risk_events_kind_check;
alter table risk_events
  add constraint risk_events_kind_check
    check (kind in ('exit-approach', 'night-wandering', 'kitchen-night', 'long-bathroom-stay', 'no-movement')),
  add column trigger text not null default 'detected' check (trigger in ('detected', 'predicted')),
  add column source text not null default 'ble' check (source in ('ble', 'sim')),
  add column predicted_at timestamptz,
  add column arrived_at timestamptz,
  add column lead_time_s real;

-- What to do when the person enters a room of this kind between start_hour and end_hour (household time).
-- Hours wrap past midnight when start_hour > end_hour (22 to 6). 0 to 24 means any time.
-- kind is the risk to raise for a redirect rule; allow and greet rules have none.
create table zone_rules (
  id text primary key default gen_random_uuid()::text,
  household_id text not null references households on delete cascade,
  room_kind text not null,
  kind text check (kind in ('exit-approach', 'night-wandering', 'kitchen-night', 'long-bathroom-stay', 'no-movement')),
  start_hour smallint not null check (start_hour between 0 and 23),
  end_hour smallint not null check (end_hour between 0 and 24),
  action text not null check (action in ('redirect', 'allow', 'greet'))
);

-- One row per household: what the patient screen shows right now. The monitor writes it; /routine subscribes.
create table patient_state (
  household_id text primary key references households on delete cascade,
  mode text not null default 'idle' check (mode in ('idle', 'glow', 'photo_voice', 'greeting', 'calm')),
  message text,
  photo_path text,
  voice_path text,
  risk_event_id text references risk_events on delete set null,
  updated_at timestamptz not null default now()
);

-- Each redirect attempt and how it went, for analytics and later the contextual bandit.
create table interventions (
  id text primary key default gen_random_uuid()::text,
  household_id text not null references households on delete cascade,
  risk_event_id text not null references risk_events on delete cascade,
  mode text not null check (mode in ('glow', 'photo_voice', 'greeting')),
  voice_path text,
  outcome text check (outcome in ('returned', 'escalated', 'cancelled')),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create index on zone_rules (household_id);
create index on patient_state (risk_event_id);
create index on interventions (household_id, started_at desc);
create index on interventions (risk_event_id);

alter table zone_rules enable row level security;
alter table patient_state enable row level security;
alter table interventions enable row level security;

create policy "household members" on zone_rules for all to authenticated
  using (private.is_member(household_id)) with check (private.is_member(household_id));
create policy "household members" on patient_state for all to authenticated
  using (private.is_member(household_id)) with check (private.is_member(household_id));
create policy "household members" on interventions for all to authenticated
  using (private.is_member(household_id)) with check (private.is_member(household_id));

-- The patient screen has no login. It only reads a mode, a short message and storage paths;
-- the files themselves go through a signed URL route, and the household id acts as the capability.
create policy "patient screen reads" on patient_state for select to anon using (true);

alter publication supabase_realtime add table patient_state;
