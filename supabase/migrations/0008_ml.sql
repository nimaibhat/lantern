-- 0008_ml.sql (owner: Vineet). Changes to: models, metrics.
-- 0001 to 0004 are the shared baseline already applied to the project; never edit them.
-- Add your changes below, newest at the bottom, and apply them with the Supabase CLI or MCP.

-- 0008.1 Photo hazard cache (lib/audit/vision.ts): one row per checked photo, keyed by a hash of the image bytes,
-- the room name and the prompt version, so re-processing a scan costs no new Claude calls.
create table if not exists vision_cache (
  key text primary key,
  hazards jsonb not null,
  prompt_version text not null,
  created_at timestamptz not null default now()
);
-- Server only (secret key); no policies on purpose.
alter table vision_cache enable row level security;
