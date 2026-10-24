-- 0007_world.sql (owner: Nimai). Changes to: home_models, scans, rooms, audit_items.
-- 0001 to 0004 are the shared baseline already applied to the project; never edit them.
-- Add your changes below, newest at the bottom, and apply them with the Supabase CLI or MCP.

-- 0007.1 The shared home model. Every save (scan or zone editor) adds a row with the next version.
-- The monitor and the web read the highest version for the household.
create table if not exists home_models (
  id text primary key default gen_random_uuid()::text,
  household_id text not null references households on delete cascade,
  version int not null,
  model jsonb not null,
  scan_id text references scans on delete set null,
  note text,
  created_at timestamptz not null default now(),
  unique (household_id, version)
);
create index if not exists home_models_scan_id_idx on home_models (scan_id);

alter table home_models enable row level security;
create policy "household members" on home_models for all to authenticated
  using (private.is_member(household_id)) with check (private.is_member(household_id));
