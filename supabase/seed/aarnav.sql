-- Core seed for the actions side (owner: Aarnav). Run after supabase/seed.sql, which creates household h1.
-- Safe to re-run.

delete from zone_rules where household_id = 'h1';

-- Room kinds match fixtures/home-model.json.
insert into zone_rules (id, household_id, room_kind, kind, start_hour, end_hour, action) values
  ('z1', 'h1', 'front-door', 'exit-approach', 0, 24, 'redirect'),
  ('z2', 'h1', 'kitchen', 'kitchen-night', 22, 6, 'redirect'),
  ('z3', 'h1', 'bathroom', null, 22, 6, 'allow'),
  ('z4', 'h1', 'tv-room', null, 8, 20, 'greet');

insert into patient_state (household_id, mode) values ('h1', 'idle')
on conflict (household_id) do update set mode = 'idle', message = null, photo_path = null, voice_path = null, risk_event_id = null, updated_at = now();
