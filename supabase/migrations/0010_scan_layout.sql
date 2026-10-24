-- Hand fixes for one scan: { "turnDeg": 0 | 90 | 180 | 270, "skip": [room indexes in the manifest] }.
-- The process route applies them, so reprocessing a scan keeps them.
alter table scans add column if not exists layout jsonb not null default '{}'::jsonb;
