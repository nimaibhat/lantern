-- Keep the RLS helper out of the exposed API schema so it cannot be called over /rest/v1/rpc.
-- Policies reference the function itself, so moving it does not break them.
create schema if not exists private;
alter function public.is_member(text) set schema private;
revoke all on function private.is_member(text) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_member(text) to authenticated;
