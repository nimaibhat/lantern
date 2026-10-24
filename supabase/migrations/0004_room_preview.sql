-- World Labs (Marble) 3D preview for a room, generated on demand from the room's photos.
-- It is a visual preview only; measurements always come from the RoomPlan scan.
alter table rooms
  add column preview_status text not null default 'none' check (preview_status in ('none', 'generating', 'ready', 'failed')),
  add column preview_operation_id text,
  add column preview_world_url text,
  add column preview_splat_url text,
  add column preview_thumbnail_url text,
  add column preview_pano_url text;
