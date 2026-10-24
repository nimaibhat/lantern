-- Demo household. Generated from lib/mock.ts; activity and risk times land on the current day.
-- Safe to re-run: deleting the household cascades to every row that belongs to it.

delete from households where id = 'h1';

insert into households (id, name, patient_name, quiet_hours_start, quiet_hours_end) values
  ('h1', 'The Alvarez home', 'Rosa', '21:00', '07:00');
insert into contacts (id, household_id, name, relation, phone, priority) values
  ('c1', 'h1', 'Maria Alvarez', 'Daughter', '+1 (614) 555-0142', 1),
  ('c2', 'h1', 'Luis Alvarez', 'Son', '+1 (614) 555-0178', 2);
insert into rooms (id, household_id, name, outline, doors, windows, objects) values
  ('bedroom', 'h1', 'Bedroom', '[{"x":0,"y":0},{"x":180,"y":0},{"x":180,"y":170},{"x":0,"y":170}]'::jsonb, '[{"id":"d1","kind":"door","start":{"x":60,"y":170},"end":{"x":92,"y":170},"heightIn":80,"widthIn":32}]'::jsonb, '[]'::jsonb, '[{"id":"o1","category":"bed","center":{"x":90,"y":70},"widthIn":60,"depthIn":80,"heightIn":30,"rotationDeg":0}]'::jsonb),
  ('bathroom', 'h1', 'Bathroom', '[{"x":180,"y":0},{"x":290,"y":0},{"x":290,"y":170},{"x":180,"y":170}]'::jsonb, '[{"id":"d2","kind":"door","start":{"x":210,"y":170},"end":{"x":238,"y":170},"heightIn":80,"widthIn":28}]'::jsonb, '[]'::jsonb, '[{"id":"o2","category":"toilet","center":{"x":270,"y":30},"widthIn":18,"depthIn":28,"heightIn":30,"rotationDeg":0},{"id":"o3","category":"bathtub","center":{"x":235,"y":25},"widthIn":60,"depthIn":30,"heightIn":30,"rotationDeg":0}]'::jsonb),
  ('hallway', 'h1', 'Hallway', '[{"x":0,"y":170},{"x":290,"y":170},{"x":290,"y":204},{"x":0,"y":204}]'::jsonb, '[{"id":"d3","kind":"door","start":{"x":290,"y":172},"end":{"x":290,"y":202},"heightIn":80,"widthIn":30}]'::jsonb, '[]'::jsonb, '[]'::jsonb),
  ('kitchen', 'h1', 'Kitchen', '[{"x":0,"y":204},{"x":170,"y":204},{"x":170,"y":360},{"x":0,"y":360}]'::jsonb, '[{"id":"d4","kind":"door","start":{"x":80,"y":204},"end":{"x":112,"y":204},"heightIn":80,"widthIn":32}]'::jsonb, '[]'::jsonb, '[{"id":"o4","category":"stove","center":{"x":30,"y":340},"widthIn":30,"depthIn":26,"heightIn":30,"rotationDeg":0},{"id":"o5","category":"table","center":{"x":100,"y":290},"widthIn":48,"depthIn":36,"heightIn":30,"rotationDeg":0}]'::jsonb),
  ('entry', 'h1', 'Front door', '[{"x":170,"y":204},{"x":290,"y":204},{"x":290,"y":360},{"x":170,"y":360}]'::jsonb, '[{"id":"d5","kind":"door","start":{"x":200,"y":204},"end":{"x":236,"y":204},"heightIn":80,"widthIn":36},{"id":"d6","kind":"door","start":{"x":210,"y":360},"end":{"x":246,"y":360},"heightIn":80,"widthIn":36}]'::jsonb, '[]'::jsonb, '[]'::jsonb),
  ('living', 'h1', 'Living room', '[{"x":290,"y":0},{"x":480,"y":0},{"x":480,"y":360},{"x":290,"y":360}]'::jsonb, '[{"id":"d7","kind":"door","start":{"x":290,"y":240},"end":{"x":290,"y":276},"heightIn":80,"widthIn":36}]'::jsonb, '[]'::jsonb, '[{"id":"o6","category":"sofa","center":{"x":440,"y":160},"widthIn":34,"depthIn":84,"heightIn":30,"rotationDeg":0},{"id":"o7","category":"table","center":{"x":385,"y":160},"widthIn":24,"depthIn":44,"heightIn":30,"rotationDeg":0}]'::jsonb);
insert into receivers (id, household_id, room_id, label, last_seen_at) values
  ('r1', 'h1', 'bedroom', 'ESP32 A', now()),
  ('r2', 'h1', 'hallway', 'ESP32 B', now()),
  ('r3', 'h1', 'entry', 'ESP32 C', now());
insert into beacons (id, household_id, label) values
  ('b1', 'h1', 'Blue Charm BC011');
insert into audit_items (id, household_id, room_id, source, code, title, detail, fix, severity, measured_in, required_in, location, status) values
  ('a1', 'h1', 'bathroom', 'ada-rule', 'ADA 404.2.3', 'Bathroom door is too narrow', 'Clear width is below the minimum for a walker or wheelchair.', 'Install offset (swing-clear) hinges or widen the opening.', 'high', 28, 32, '{"x":224,"y":170}'::jsonb, 'open'),
  ('a2', 'h1', 'bathroom', 'vision', null, 'No grab bar beside the toilet', 'Nothing to hold when sitting down or standing up.', 'Add a wall-mounted grab bar 33 to 36 in above the floor.', 'high', null, null, '{"x":270,"y":30}'::jsonb, 'open'),
  ('a3', 'h1', 'hallway', 'vision', null, 'Loose runner rug in the hallway', 'The edge curls up on the path from the bedroom to the bathroom.', 'Remove the rug or secure it with non-slip backing.', 'high', null, null, '{"x":200,"y":187}'::jsonb, 'open'),
  ('a4', 'h1', 'hallway', 'ada-rule', 'ADA 403.5.1', 'Hallway is narrower than an accessible route', 'Tight for a walker, and there is no room to turn around.', 'Clear anything along the walls; consider a handrail on one side.', 'medium', 34, 36, '{"x":40,"y":187}'::jsonb, 'open'),
  ('a5', 'h1', 'bathroom', 'ada-rule', 'ADA 304.3', 'Not enough turning space in the bathroom', 'A 60 in circle does not fit between the tub, toilet, and walls.', 'Remove the floor cabinet or switch to a pedestal sink.', 'medium', 52, 60, '{"x":235,"y":110}'::jsonb, 'open'),
  ('a6', 'h1', 'entry', 'vision', null, 'Keys and coat by the front door', 'Visible keys and outerwear are strong cues to leave the house.', 'Move keys and coats into a closed cabinet out of sight.', 'medium', null, null, '{"x":270,"y":330}'::jsonb, 'open'),
  ('a7', 'h1', 'entry', 'vision', null, 'Dark doormat inside the front door', 'People with dementia can read a dark mat as a hole and step around it.', 'Use a mat close to the floor color, or remove it.', 'medium', null, null, '{"x":228,"y":325}'::jsonb, 'open'),
  ('a8', 'h1', 'living', 'vision', null, 'Cord across the walkway', 'A lamp cord runs between the sofa and the doorway.', 'Route the cord along the wall with a cover.', 'low', null, null, '{"x":330,"y":258}'::jsonb, 'open');
insert into routines (id, household_id, name) values
  ('rt1', 'h1', 'Daily routine');
insert into routine_steps (id, household_id, routine_id, time, title, room_id) values
  ('p1', 'h1', 'rt1', '07:00', 'Good morning, Rosa. Time to get up.', 'bedroom'),
  ('p2', 'h1', 'rt1', '07:15', 'Wash your face and brush your teeth.', 'bathroom'),
  ('p3', 'h1', 'rt1', '07:45', 'Breakfast is in the kitchen.', 'kitchen'),
  ('p4', 'h1', 'rt1', '10:00', 'Sit in the living room and listen to music.', 'living'),
  ('p5', 'h1', 'rt1', '12:30', 'Lunch time.', 'kitchen'),
  ('p6', 'h1', 'rt1', '15:00', 'Afternoon rest.', 'bedroom'),
  ('p7', 'h1', 'rt1', '21:00', 'Get ready for bed.', 'bathroom'),
  ('p8', 'h1', 'rt1', '21:30', 'Goodnight, Rosa. Time to sleep.', 'bedroom');
insert into risk_events (id, household_id, kind, room_id, state, started_at, resolved_at) values
  ('k1', 'h1', 'exit-approach', 'entry', 'resolved', (((now() at time zone 'America/New_York')::date + time '03:07') at time zone 'America/New_York'), (((now() at time zone 'America/New_York')::date + time '03:08') at time zone 'America/New_York'));
insert into activity (id, household_id, kind, text, ts) values
  ('t1', 'h1', 'move', 'Bedroom → Hallway', (((now() at time zone 'America/New_York')::date + time '03:06') at time zone 'America/New_York')),
  ('t2', 'h1', 'risk', 'Heading to the front door during quiet hours. Hallway light on, Maria''s voice played.', (((now() at time zone 'America/New_York')::date + time '03:07') at time zone 'America/New_York')),
  ('t3', 'h1', 'move', 'Hallway → Bedroom', (((now() at time zone 'America/New_York')::date + time '03:08') at time zone 'America/New_York')),
  ('t4', 'h1', 'info', 'Back in bed after 48 s. No alert sent.', (((now() at time zone 'America/New_York')::date + time '03:08') at time zone 'America/New_York')),
  ('t5', 'h1', 'move', 'Bedroom → Bathroom', (((now() at time zone 'America/New_York')::date + time '07:04') at time zone 'America/New_York')),
  ('t6', 'h1', 'move', 'Bathroom → Kitchen', (((now() at time zone 'America/New_York')::date + time '07:31') at time zone 'America/New_York')),
  ('t7', 'h1', 'move', 'Kitchen → Living room', (((now() at time zone 'America/New_York')::date + time '08:12') at time zone 'America/New_York')),
  ('t8', 'h1', 'move', 'Living room → Kitchen', (((now() at time zone 'America/New_York')::date + time '08:31') at time zone 'America/New_York')),
  ('t9', 'h1', 'move', 'Kitchen → Bedroom', (((now() at time zone 'America/New_York')::date + time '08:50') at time zone 'America/New_York'));
