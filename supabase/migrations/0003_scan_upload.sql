-- Phone pairing and scan uploads.
-- The iPhone app has no Supabase keys. It sends a short pairing code to the Next.js API, which does the privileged work.

create table pair_codes (
  code text primary key,
  household_id text not null references households on delete cascade,
  expires_at timestamptz not null
);
create index on pair_codes (household_id);

-- No policies: only the server (secret key) reads or writes pairing codes.
alter table pair_codes enable row level security;

-- manifest lists what the phone uploaded: [{ name, jsonPath, usdzPath, photoPaths }]
alter table scans
  add column status text not null default 'uploading' check (status in ('uploading', 'processing', 'done', 'failed')),
  add column manifest jsonb not null default '[]';
