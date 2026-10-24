-- How the person gets around. The accessibility checks use it: doors and turning space only matter for a
-- walker or a wheelchair.
alter table households add column if not exists mobility text not null default 'none'
  check (mobility in ('none', 'cane', 'walker', 'wheelchair'));
