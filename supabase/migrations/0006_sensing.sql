-- 0006_sensing.sql (owner: Saran). Changes to: receivers, rssi_samples, calibration sessions.
-- 0001 to 0004 are the shared baseline already applied to the project; never edit them.
-- Add your changes below, newest at the bottom, and apply them with the Supabase CLI or MCP.
-- Additive only: rssi_samples and receivers already exist in 0001 (receiver_id, beacon_id, rssi, ts, label_room_id;
-- room_id, label, mac, last_seen_at). Listener positions live in the home model's anchors, not here.

-- 0006.1 Calibration sessions (PROJECT_PLAN 3 step 6): group samples by session so training and testing never
-- share one, and record the floor point when a sample was taken on a tape mark.
alter table rssi_samples
  add column if not exists session text,
  add column if not exists x real,
  add column if not exists y real;
create index if not exists rssi_samples_session_idx on rssi_samples (session);

-- 0006.2 Per-listener dB offset from tools/calibrate-offsets.py, and what kind of listener it is.
alter table receivers
  add column if not exists offset_db smallint not null default 0,
  add column if not exists kind text not null default 'mac-bleak' check (kind in ('mac-bleak', 'iphone', 'replay'));
