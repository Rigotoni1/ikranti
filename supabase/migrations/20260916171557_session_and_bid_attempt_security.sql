-- A signed access token alone must not outlive a revoked server-side session.
create function ir_private.session_active() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.sessions s where s.id::text=auth.jwt()->>'session_id' and s.user_id=auth.uid() and (s.not_after is null or s.not_after>now()))
$$;
revoke all on function ir_private.session_active() from public,anon;
grant execute on function ir_private.session_active() to authenticated;
create or replace function ir_private.member() returns uuid language plpgsql security definer set search_path='' as $$
begin
 if not ir_private.session_active() or not exists(select 1 from auth.users u join public.ir_profiles p on p.id=u.id where u.id=auth.uid() and u.email_confirmed_at is not null and not p.suspended) then raise exception 'Verified, active account required'; end if;
 return auth.uid();
end $$;
create or replace function ir_private.admin() returns boolean language sql stable security definer set search_path='' as $$
 select ir_private.session_active() and coalesce((select role='admin' and not suspended from public.ir_profiles where id=auth.uid()),false) and coalesce(auth.jwt()->>'aal'='aal2',false)
$$;
-- Wrap existing owner/staff read policies, preserving their row restrictions.
do $$ declare p record; begin
 for p in select * from pg_policies where (schemaname='public' and tablename like 'ir\_%' escape '\' and tablename<>'ir_public_auctions') or (schemaname='storage' and policyname='ir_private_document_read') loop
 execute format('alter policy %I on %I.%I using ((%s) and (select ir_private.session_active()))',p.policyname,p.schemaname,p.tablename,p.qual);
 end loop;
end $$;
-- Failed business-rule checks roll back only the inner attempt, not its rate counter.
-- The old implementation is no longer a browser-callable bypass.
revoke all on function public.ir_bid(uuid,numeric,uuid) from public,anon,authenticated;
create function public.ir_submit_bid(p_auction uuid,p_max numeric,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform ir_private.member();
 perform ir_private.limit_action('bid_attempt',30,60);
 begin
   return public.ir_bid(p_auction,p_max,p_request);
 exception
   when raise_exception then return jsonb_build_object('error',sqlerrm,'code','BID_REJECTED');
   when others then return jsonb_build_object('error','The bid could not be accepted. Refresh before retrying.','code','BID_FAILED');
 end;
end $$;
revoke all on function public.ir_submit_bid(uuid,numeric,uuid) from public,anon;
grant execute on function public.ir_submit_bid(uuid,numeric,uuid) to authenticated;
