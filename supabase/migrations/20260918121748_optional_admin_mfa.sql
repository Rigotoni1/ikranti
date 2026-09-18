-- Owner-requested policy: MFA is optional; server-side role/session checks remain mandatory.
create or replace function ir_private.admin() returns boolean language sql stable security definer set search_path='' as $$
 select ir_private.session_active() and exists(
  select 1 from public.ir_profiles p join auth.users u on u.id=p.id
  where p.id=auth.uid() and p.role='admin' and not p.suspended and u.email_confirmed_at is not null
 )
$$;
create or replace function public.ir_claim_admin() returns boolean language plpgsql security definer set search_path='' as $$
declare u uuid:=ir_private.member();
begin
 if not exists(select 1 from auth.users a join ir_private.admin_invites i on lower(a.email)=i.email where a.id=u and a.email_confirmed_at is not null) then raise exception 'Administrator invitation required'; end if;
 update public.ir_profiles set role='admin' where id=u;
 delete from ir_private.admin_invites where email=(select lower(email) from auth.users where id=u);
 insert into public.ir_audit(actor,action,target) values(u,'claim_admin',u::text);
 return true;
end $$;
-- Keep existing guarded operations unchanged except for their obsolete error wording.
do $$ declare f record; begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('ir_admin_action','ir_delivery_health','ir_verify_buyer') loop
  execute replace(replace(pg_get_functiondef(f.oid),'Administrator with two-factor authentication required','Verified administrator required'),'Two-factor administrator required','Verified administrator required');
 end loop;
end $$;
