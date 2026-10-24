-- 0009_receiver_rssi.sql. Changes to: receivers.
-- The latest signal from each laptop lives here, so every Tracking page reads the same hub.

alter table receivers
  add column if not exists last_rssi smallint,
  add column if not exists last_rssi_at timestamptz;
