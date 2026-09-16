create table public.ir_account_onboarding (
 user_id uuid not null references public.ir_profiles(id),
 account_type text not null check(account_type in ('buyer','seller')),
 details jsonb not null default '{}', step integer not null default 0 check(step between 0 and 3),
 completed_at timestamptz, updated_at timestamptz not null default now(),
 primary key(user_id,account_type)
);
alter table public.ir_profiles add column active_account text check(active_account in ('buyer','seller'));
alter table public.ir_account_onboarding enable row level security;
revoke all on public.ir_account_onboarding from anon,authenticated;
grant select on public.ir_account_onboarding to authenticated;
create policy onboarding_read on public.ir_account_onboarding for select to authenticated using
 ((user_id=(select auth.uid()) or (select ir_private.admin())) and (select ir_private.session_active()));

create function public.ir_save_onboarding(p_type text,p_details jsonb,p_step integer,p_complete boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=ir_private.member(); d jsonb;
begin
 if p_type not in ('buyer','seller') or p_type is null or p_step not between 0 and 3 then raise exception 'Invalid onboarding request'; end if;
 if jsonb_typeof(p_details)<>'object' or octet_length(p_details::text)>8000 then raise exception 'Invalid details'; end if;
 perform ir_private.limit_action('onboarding',30,60);
 -- Store only expected fields; never accept verification, roles or approval claims.
 select coalesce(jsonb_object_agg(key,value),'{}') into d from jsonb_each(p_details)
 where key in ('legal_name','phone','country','address','interests','business_name','registration_number','adult');
 if exists(select 1 from jsonb_each(d) where jsonb_typeof(value)<>'string' or length(value#>>'{}')>case when key='address' then 1000 else 160 end) then raise exception 'Invalid detail format or length'; end if;
 if p_complete then
  if length(trim(coalesce(d->>'legal_name','')))<2 or length(trim(coalesce(d->>'phone','')))<7
   or length(trim(coalesce(d->>'country','')))<2 or length(trim(coalesce(d->>'address','')))<8
   or d->>'adult' is distinct from 'true' then raise exception 'Complete your contact details and confirm you are at least 18'; end if;
  if p_type='seller' then
   if not exists(select 1 from public.ir_documents where user_id=u and kind='identity') then raise exception 'Upload private identity evidence'; end if;
   if coalesce(d->>'business_name','')<>'' and (coalesce(d->>'registration_number','')='' or not exists(select 1 from public.ir_documents where user_id=u and kind='business')) then raise exception 'Business registration and evidence required'; end if;
   perform public.ir_submit_seller(d->>'legal_name',coalesce(d->>'business_name',''),coalesce(d->>'registration_number',''),d->>'address');
  end if;
 end if;
 insert into public.ir_account_onboarding(user_id,account_type,details,step,completed_at)
 values(u,p_type,d,p_step,case when p_complete then now() end)
 on conflict(user_id,account_type) do update set details=excluded.details,step=excluded.step,
 completed_at=coalesce(ir_account_onboarding.completed_at,excluded.completed_at),updated_at=now();
 if p_complete then update public.ir_profiles set active_account=p_type where id=u; end if;
end $$;
revoke all on function public.ir_save_onboarding(text,jsonb,integer,boolean) from public,anon;
grant execute on function public.ir_save_onboarding(text,jsonb,integer,boolean) to authenticated;

create function ir_private.require_account(p_type text) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=ir_private.member(); begin
 if not exists(select 1 from public.ir_account_onboarding where user_id=u and account_type=p_type and completed_at is not null) then raise exception 'Complete % onboarding first',p_type; end if;
 return u;
end $$;
revoke all on function ir_private.require_account(text) from public,anon,authenticated;
create function public.ir_switch_account(p_type text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid; begin
 if p_type not in ('buyer','seller') or p_type is null then raise exception 'Invalid account type'; end if;
 u:=ir_private.require_account(p_type);
 update public.ir_profiles set active_account=p_type where id=u;
end $$;
revoke all on function public.ir_switch_account(text) from public,anon;
grant execute on function public.ir_switch_account(text) to authenticated;

alter function public.ir_submit_bid(uuid,numeric,uuid) set schema ir_private;
revoke all on function ir_private.ir_submit_bid(uuid,numeric,uuid) from public,anon,authenticated;
create function public.ir_submit_bid(p_auction uuid,p_max numeric,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform ir_private.require_account('buyer'); return ir_private.ir_submit_bid(p_auction,p_max,p_request); end $$;
revoke all on function public.ir_submit_bid(uuid,numeric,uuid) from public,anon;
grant execute on function public.ir_submit_bid(uuid,numeric,uuid) to authenticated;

alter function public.ir_create_listing(text,text,text,text,numeric,numeric,timestamptz) set schema ir_private;
revoke all on function ir_private.ir_create_listing(text,text,text,text,numeric,numeric,timestamptz) from public,anon,authenticated;
create function public.ir_create_listing(p_title text,p_description text,p_category text,p_location text,p_start numeric,p_reserve numeric,p_end timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
begin perform ir_private.require_account('seller'); return ir_private.ir_create_listing(p_title,p_description,p_category,p_location,p_start,p_reserve,p_end); end $$;
revoke all on function public.ir_create_listing(text,text,text,text,numeric,numeric,timestamptz) from public,anon;
grant execute on function public.ir_create_listing(text,text,text,text,numeric,numeric,timestamptz) to authenticated;

alter function public.ir_watch(uuid,boolean) set schema ir_private;
revoke all on function ir_private.ir_watch(uuid,boolean) from public,anon,authenticated;
create function public.ir_watch(p_auction uuid,p_watch boolean) returns void language plpgsql security definer set search_path='' as $$
begin perform ir_private.require_account('buyer'); perform ir_private.ir_watch(p_auction,p_watch); end $$;
revoke all on function public.ir_watch(uuid,boolean) from public,anon;
grant execute on function public.ir_watch(uuid,boolean) to authenticated;

create table public.ir_favourites(user_id uuid references public.ir_profiles,auction_id uuid references public.ir_auctions,primary key(user_id,auction_id));
alter table public.ir_favourites enable row level security;
revoke all on public.ir_favourites from anon,authenticated;
grant select on public.ir_favourites to authenticated;
create policy favourites_read on public.ir_favourites for select to authenticated using(user_id=(select auth.uid()) and (select ir_private.session_active()));
create function public.ir_favourite(p_auction uuid,p_saved boolean) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=ir_private.require_account('buyer'); begin
 perform ir_private.limit_action('favourite',60,60);
 if p_saved then
  if not exists(select 1 from public.ir_public_auctions where id=p_auction) then raise exception 'Listing unavailable'; end if;
  insert into public.ir_favourites values(u,p_auction) on conflict do nothing;
 else delete from public.ir_favourites where user_id=u and auction_id=p_auction; end if;
end $$;
revoke all on function public.ir_favourite(uuid,boolean) from public,anon;
grant execute on function public.ir_favourite(uuid,boolean) to authenticated;

alter table public.ir_auctions add column feature_requested boolean not null default false;
create function public.ir_request_feature(p_auction uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=ir_private.require_account('seller'); begin
 perform ir_private.limit_action('feature_request',10,60);
 update public.ir_auctions set feature_requested=true where id=p_auction and seller_id=u and status in ('under_review','live');
 if not found then raise exception 'An active listing you own is required'; end if;
end $$;
revoke all on function public.ir_request_feature(uuid) from public,anon;
grant execute on function public.ir_request_feature(uuid) to authenticated;

create function public.ir_verify_buyer(p_user uuid,p_fingerprint text,p_note text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not ir_private.admin() then raise exception 'Two-factor administrator required'; end if;
 if length(trim(p_fingerprint))<8 or p_fingerprint is null or length(trim(p_note))<5 or p_note is null then raise exception 'Verified identity fingerprint and review note required'; end if;
 if not exists(select 1 from public.ir_account_onboarding where user_id=p_user and account_type='buyer' and completed_at is not null)
 or not exists(select 1 from public.ir_documents where user_id=p_user and kind='identity') then raise exception 'Completed buyer setup and identity evidence required'; end if;
 insert into ir_private.identity_links(user_id,identity_fingerprint) values(p_user,trim(p_fingerprint))
 on conflict(user_id) do update set identity_fingerprint=excluded.identity_fingerprint;
 insert into public.ir_audit(actor,action,target,detail) values(auth.uid(),'verify_buyer',p_user::text,jsonb_build_object('note',p_note));
end $$;
revoke all on function public.ir_verify_buyer(uuid,text,text) from public,anon;
grant execute on function public.ir_verify_buyer(uuid,text,text) to authenticated;
