-- Real accounts are deliberately isolated from the fictional demonstration data.
create schema if not exists ir_private;
revoke all on schema ir_private from public, anon, authenticated;
create table public.ir_profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 name text not null check (length(name) between 1 and 120),
 role text not null default 'member' check (role in ('member','admin')),
 suspended boolean not null default false,
 seller_status text not null default 'not_started' check (seller_status in ('not_started','pending','approved','rejected')),
 created_at timestamptz not null default now()
);
create table ir_private.settings (id boolean primary key default true check(id), trading_enabled boolean not null default false);
insert into ir_private.settings default values;
create table ir_private.admin_invites (email text primary key);
-- Provision the designated owner's invitation privately after migration.
-- Do not commit personal administrator email addresses to a public repository.
create table ir_private.identity_links (user_id uuid primary key references public.ir_profiles, identity_fingerprint text not null);
create index on ir_private.identity_links(identity_fingerprint);
create table public.ir_seller_applications (
 user_id uuid primary key references public.ir_profiles,
 legal_name text not null check(length(legal_name) between 2 and 160),
 business_name text not null default '' check(length(business_name)<=160),
 registration_number text not null default '' check(length(registration_number)<=80),
 address text not null check(length(address) between 8 and 1000),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 review_note text, submitted_at timestamptz not null default now()
);
create table public.ir_auctions (
 id uuid primary key default gen_random_uuid(), seller_id uuid not null references public.ir_profiles,
 title text not null check(length(title) between 5 and 160),
 description text not null check(length(description) between 20 and 10000),
 category text not null check(category in ('Property','Motor Cars','Boats','Watches & Jewellery','Art & Antiques','Collectables')),
 location text not null check(length(location) between 2 and 160), image_path text,
 start_price numeric(14,2) not null check(start_price>0), reserve_price numeric(14,2) not null default 0 check(reserve_price>=0),
 current_bid numeric(14,2) not null check(current_bid>=0), highest_bidder_id uuid references public.ir_profiles,
 bid_count integer not null default 0, end_at timestamptz not null,
 status text not null default 'under_review' check(status in ('under_review','rejected','live','sold','reserve_not_met','unsold','withdrawn')),
 review_note text, version bigint not null default 0, created_at timestamptz not null default now()
);
create table public.ir_documents (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.ir_profiles,
 auction_id uuid references public.ir_auctions,
 kind text not null check(kind in ('identity','business','ownership','property_title','vehicle_registration','boat_registration','provenance','condition')),
 path text not null unique, mime text not null check(mime in ('image/jpeg','image/png','application/pdf')),
 size integer not null check(size between 1 and 8388608), created_at timestamptz not null default now()
);
-- Safe public projection: no reserve amount, user ID, proxy maximum or private documents.
create table public.ir_public_auctions (
 id uuid primary key, title text not null, description text not null, category text not null,
 location text not null, image_path text, start_price numeric not null, current_bid numeric not null,
 bid_count integer not null, end_at timestamptz not null, status text not null,
 has_reserve boolean not null, reserve_met boolean not null, version bigint not null
);
create table public.ir_max_bids (auction_id uuid references public.ir_auctions, user_id uuid references public.ir_profiles, amount numeric(14,2) not null, created_at timestamptz default now(), primary key(auction_id,user_id));
create table public.ir_bid_events (id uuid primary key default gen_random_uuid(), auction_id uuid not null references public.ir_auctions, user_id uuid not null references public.ir_profiles, amount numeric(14,2) not null, created_at timestamptz not null default now());
create table ir_private.bid_requests (user_id uuid references public.ir_profiles, request_id uuid, auction_id uuid not null, amount numeric not null, result jsonb not null, primary key(user_id,request_id));
create table public.ir_watchlist (user_id uuid references public.ir_profiles, auction_id uuid references public.ir_auctions, primary key(user_id,auction_id));
create table public.ir_orders (
 id uuid primary key default gen_random_uuid(), auction_id uuid not null unique references public.ir_auctions,
 seller_id uuid not null references public.ir_profiles, buyer_id uuid not null references public.ir_profiles,
 amount numeric(14,2) not null, status text not null default 'awaiting_payment' check(status in ('awaiting_payment','paid','disputed','cancelled')),
 created_at timestamptz not null default now(), payment_due_at timestamptz not null default now()+interval '3 days'
);
create table public.ir_notifications (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.ir_profiles,
 kind text not null, message text not null, auction_id uuid references public.ir_auctions,
 dedupe_key text not null unique, created_at timestamptz not null default now(), read_at timestamptz,
 email_status text not null default 'pending' check(email_status in ('pending','sending','sent','failed')),
 email_attempts integer not null default 0, email_next_attempt timestamptz not null default now(),
 email_lease uuid, email_leased_at timestamptz, email_error text
);
create table public.ir_disputes (id uuid primary key default gen_random_uuid(), order_id uuid not null references public.ir_orders, opened_by uuid not null references public.ir_profiles, reason text not null check(length(reason) between 20 and 5000), status text not null default 'open' check(status in ('open','resolved','dismissed')), resolution text, created_at timestamptz not null default now());
create unique index ir_one_open_dispute on public.ir_disputes(order_id) where status='open';
create table public.ir_audit (id bigint generated always as identity primary key, actor uuid references public.ir_profiles, action text not null, target text not null, detail jsonb not null default '{}', created_at timestamptz not null default now());
create table public.ir_risk_flags (id uuid primary key default gen_random_uuid(), user_id uuid references public.ir_profiles, auction_id uuid references public.ir_auctions, reason text not null, created_at timestamptz not null default now());
create table ir_private.rate_limits (user_id uuid, action text, window_at timestamptz, count integer not null, primary key(user_id,action,window_at));
create index on public.ir_auctions(status,end_at);
create index on public.ir_auctions(seller_id);
create index on public.ir_notifications(user_id,created_at desc);
create index on public.ir_notifications(email_status,email_next_attempt);
create index on public.ir_bid_events(auction_id,created_at);
create index on public.ir_orders(buyer_id);
create index on public.ir_orders(seller_id);

create function ir_private.admin() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select role='admin' and not suspended from public.ir_profiles where id=auth.uid()),false) and coalesce(auth.jwt()->>'aal'='aal2',false)
$$;
create function ir_private.member() returns uuid language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from auth.users u join public.ir_profiles p on p.id=u.id where u.id=auth.uid() and u.email_confirmed_at is not null and not p.suspended) then raise exception 'Verified, active account required'; end if;
 return auth.uid();
end $$;
create function ir_private.limit_action(p_action text,p_limit integer,p_seconds integer) returns void language plpgsql security definer set search_path='' as $$
declare n integer; u uuid:=ir_private.member(); w timestamptz:=to_timestamp(floor(extract(epoch from clock_timestamp())/p_seconds)*p_seconds);
begin
 insert into ir_private.rate_limits values(u,p_action,w,1) on conflict(user_id,action,window_at) do update set count=ir_private.rate_limits.count+1 returning count into n;
 if n>p_limit then raise exception 'Too many requests; please try later'; end if;
end $$;
create function ir_private.new_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.ir_profiles(id,name) values(new.id,left(coalesce(nullif(trim(new.raw_user_meta_data->>'name'),''),'Member'),120));
 return new;
end $$;
create trigger ir_new_user after insert on auth.users for each row execute function ir_private.new_user();
create function public.ir_claim_admin() returns boolean language plpgsql security definer set search_path='' as $$
declare u uuid:=ir_private.member();
begin
 if auth.jwt()->>'aal' is distinct from 'aal2' then raise exception 'Two-factor authentication required'; end if;
 if not exists(select 1 from auth.users a join ir_private.admin_invites i on lower(a.email)=i.email where a.id=u and a.email_confirmed_at is not null) then raise exception 'Administrator invitation required'; end if;
 update public.ir_profiles set role='admin' where id=u;
 delete from ir_private.admin_invites where email=(select lower(email) from auth.users where id=u);
 insert into public.ir_audit(actor,action,target) values(u,'claim_admin',u::text);
 return true;
end $$;
create function ir_private.project_auction() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status in ('live','sold','reserve_not_met','unsold','withdrawn') then
 insert into public.ir_public_auctions values(new.id,new.title,new.description,new.category,new.location,new.image_path,new.start_price,new.current_bid,new.bid_count,new.end_at,new.status,new.reserve_price>0,new.current_bid>=new.reserve_price,new.version)
 on conflict(id) do update set title=excluded.title,description=excluded.description,category=excluded.category,location=excluded.location,image_path=excluded.image_path,current_bid=excluded.current_bid,bid_count=excluded.bid_count,end_at=excluded.end_at,status=excluded.status,has_reserve=excluded.has_reserve,reserve_met=excluded.reserve_met,version=excluded.version;
 else delete from public.ir_public_auctions where id=new.id; end if;
 return new;
end $$;
create trigger ir_project_auction after insert or update on public.ir_auctions for each row execute function ir_private.project_auction();

-- Read permissions only. All writes pass through narrowly scoped RPCs below.
do $$ declare t text; begin
 foreach t in array array['ir_profiles','ir_seller_applications','ir_auctions','ir_documents','ir_public_auctions','ir_max_bids','ir_bid_events','ir_watchlist','ir_orders','ir_notifications','ir_disputes','ir_audit','ir_risk_flags'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
grant usage on schema ir_private to authenticated;
grant execute on function ir_private.admin() to authenticated;
create policy self_profile on public.ir_profiles for select to authenticated using(id=auth.uid() or ir_private.admin());
create policy self_application on public.ir_seller_applications for select to authenticated using(user_id=auth.uid() or ir_private.admin());
create policy seller_auction on public.ir_auctions for select to authenticated using(seller_id=auth.uid() or ir_private.admin());
create policy self_documents on public.ir_documents for select to authenticated using(user_id=auth.uid() or ir_private.admin());
create policy public_catalogue on public.ir_public_auctions for select to anon,authenticated using(true);
grant select on public.ir_public_auctions to anon;
create policy self_max on public.ir_max_bids for select to authenticated using(user_id=auth.uid());
create policy self_bids on public.ir_bid_events for select to authenticated using(user_id=auth.uid() or ir_private.admin());
create policy self_watch on public.ir_watchlist for select to authenticated using(user_id=auth.uid());
create policy own_orders on public.ir_orders for select to authenticated using(buyer_id=auth.uid() or seller_id=auth.uid() or ir_private.admin());
create policy self_notifications on public.ir_notifications for select to authenticated using(user_id=auth.uid());
create policy own_disputes on public.ir_disputes for select to authenticated using(opened_by=auth.uid() or ir_private.admin() or exists(select 1 from public.ir_orders o where o.id=order_id and (o.buyer_id=auth.uid() or o.seller_id=auth.uid())));
create policy staff_audit on public.ir_audit for select to authenticated using(ir_private.admin());
create policy staff_risk on public.ir_risk_flags for select to authenticated using(ir_private.admin());

create function public.ir_submit_seller(p_legal_name text,p_business_name text,p_registration_number text,p_address text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=ir_private.member(); begin
 perform ir_private.limit_action('seller_application',5,86400);
 insert into public.ir_seller_applications(user_id,legal_name,business_name,registration_number,address) values(u,trim(p_legal_name),trim(p_business_name),trim(p_registration_number),trim(p_address))
 on conflict(user_id) do update set legal_name=excluded.legal_name,business_name=excluded.business_name,registration_number=excluded.registration_number,address=excluded.address,status='pending',review_note=null,submitted_at=now();
 update public.ir_profiles set seller_status='pending' where id=u;
end $$;
create function public.ir_create_listing(p_title text,p_description text,p_category text,p_location text,p_start numeric,p_reserve numeric,p_end timestamptz) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=ir_private.member(); v uuid; begin
 perform ir_private.limit_action('listing',10,86400);
 if not exists(select 1 from public.ir_profiles where id=u and seller_status='approved') then raise exception 'Seller approval required'; end if;
 if p_end<now()+interval '1 day' or p_end>now()+interval '90 days' then raise exception 'End date must be 1–90 days away'; end if;
 if p_start::text in ('NaN','Infinity','-Infinity') or p_reserve::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid price'; end if;
 insert into public.ir_auctions(seller_id,title,description,category,location,start_price,reserve_price,current_bid,end_at) values(u,trim(p_title),trim(p_description),p_category,trim(p_location),p_start,p_reserve,p_start,p_end) returning id into v;
 return v;
end $$;
create function public.ir_watch(p_auction uuid,p_watch boolean) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=ir_private.member(); begin
 perform ir_private.limit_action('watch',60,60);
 if not exists(select 1 from public.ir_public_auctions where id=p_auction) then raise exception 'Auction not found'; end if;
 if p_watch then insert into public.ir_watchlist values(u,p_auction) on conflict do nothing; else delete from public.ir_watchlist where user_id=u and auction_id=p_auction; end if;
end $$;
create function public.ir_mark_read(p_id uuid) returns void language plpgsql security definer set search_path='' as $$ begin update public.ir_notifications set read_at=now() where id=p_id and user_id=ir_private.member(); end $$;
create function ir_private.notify(p_user uuid,p_kind text,p_message text,p_auction uuid,p_key text) returns void language sql security definer set search_path='' as $$
 insert into public.ir_notifications(user_id,kind,message,auction_id,dedupe_key) values(p_user,p_kind,p_message,p_auction,p_key) on conflict(dedupe_key) do nothing
$$;
create function ir_private.increment(p numeric) returns numeric language sql immutable set search_path='' as $$ select case when p>=100000 then 5000 when p>=10000 then 500 when p>=1000 then 100 when p>=100 then 25 else 5 end $$;

create function public.ir_bid(p_auction uuid,p_max numeric,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=ir_private.member(); a public.ir_auctions; previous ir_private.bid_requests; own_max numeric; leader_max numeric; price numeric; leader uuid; result jsonb; extended boolean; event_id uuid;
begin
 if p_request is null or p_max is null or p_max::text in ('NaN','Infinity','-Infinity') or p_max<=0 or p_max>999999999999 or round(p_max,2)<>p_max then raise exception 'Invalid bid'; end if;
 -- Serialize a user's retries, then lock this auction against bids AND closing.
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select * into previous from ir_private.bid_requests where user_id=u and request_id=p_request;
 if found then if previous.auction_id<>p_auction or previous.amount<>p_max then raise exception 'Request ID already used'; end if; return previous.result; end if;
 perform ir_private.limit_action('bid',30,60);
 if not (select trading_enabled from ir_private.settings where id) then raise exception 'Trading is not open yet'; end if;
 select * into a from public.ir_auctions where id=p_auction for update;
 if not found or a.status<>'live' or a.end_at<=clock_timestamp() then raise exception 'Auction is not live'; end if;
 if a.seller_id=u then raise exception 'You cannot bid on your own auction'; end if;
 if not exists(select 1 from public.ir_profiles where id=a.seller_id and not suspended and seller_status='approved') then raise exception 'Seller is unavailable'; end if;
 if exists(select 1 from ir_private.identity_links x join ir_private.identity_links y on x.identity_fingerprint=y.identity_fingerprint where x.user_id=u and y.user_id=a.seller_id) then raise exception 'Linked seller accounts cannot bid'; end if;
 select amount into own_max from public.ir_max_bids where auction_id=p_auction and user_id=u;
 if p_max < (case when a.bid_count=0 then a.start_price else a.current_bid+ir_private.increment(a.current_bid) end) or p_max<=coalesce(own_max,0) then raise exception 'Maximum must exceed your previous maximum and meet the next increment'; end if;
 select amount into leader_max from public.ir_max_bids where auction_id=p_auction and user_id=a.highest_bidder_id;
 leader:=a.highest_bidder_id; price:=a.current_bid;
 if leader is null then leader:=u; price:=a.start_price;
 elsif leader=u then null;
 elsif p_max>leader_max then leader:=u; price:=least(p_max,leader_max+ir_private.increment(leader_max));
 else price:=least(leader_max,p_max+case when p_max=leader_max then 0 else ir_private.increment(p_max) end); end if;
 extended:=a.end_at<clock_timestamp()+interval '2 minutes';
 insert into public.ir_max_bids values(p_auction,u,p_max,now()) on conflict(auction_id,user_id) do update set amount=excluded.amount;
 update public.ir_auctions set current_bid=price,highest_bidder_id=leader,bid_count=bid_count+1,end_at=case when extended then clock_timestamp()+interval '2 minutes' else end_at end,version=version+1 where id=p_auction;
 insert into public.ir_bid_events(auction_id,user_id,amount) values(p_auction,u,price) returning id into event_id;
 perform ir_private.notify(u,'bid_confirmation','Your bid was accepted on '||a.title,p_auction,'bid:'||event_id);
 if a.highest_bidder_id is not null and leader<>a.highest_bidder_id then perform ir_private.notify(a.highest_bidder_id,'outbid','You have been outbid on '||a.title,p_auction,'outbid:'||event_id); end if;
 if leader<>u then perform ir_private.notify(u,'outbid','Another bidder’s maximum remains higher on '||a.title,p_auction,'outbid-new:'||event_id); end if;
 if (select count(*) from public.ir_bid_events where auction_id=p_auction and user_id=u and created_at>now()-interval '5 minutes')>=10 then insert into public.ir_risk_flags(user_id,auction_id,reason) values(u,p_auction,'Ten or more bids within five minutes; review bidding pattern'); end if;
 result:=jsonb_build_object('leading',leader=u,'visibleAmount',price,'extended',extended);
 insert into ir_private.bid_requests values(u,p_request,p_auction,p_max,result);
 return result;
end $$;

create function public.ir_open_dispute(p_order uuid,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=ir_private.member(); v uuid; begin
 perform ir_private.limit_action('dispute',5,86400);
 if not exists(select 1 from public.ir_orders where id=p_order and u in (buyer_id,seller_id)) then raise exception 'Order not found'; end if;
 insert into public.ir_disputes(order_id,opened_by,reason) values(p_order,u,p_reason) returning id into v;
 update public.ir_orders set status='disputed' where id=p_order;
 return v;
end $$;
create function public.ir_admin_action(p_action text,p_target uuid,p_note text,p_fingerprint text default null) returns void language plpgsql security definer set search_path='' as $$
declare a public.ir_auctions; required_kind text; begin
 if not ir_private.admin() then raise exception 'Administrator with two-factor authentication required'; end if;
 if length(trim(coalesce(p_note,'')))<5 or length(p_note)>2000 then raise exception 'Provide an audit note (5–2000 characters)'; end if;
 if p_action in ('approve_seller','reject_seller') then
 if p_action='approve_seller' and (not exists(select 1 from public.ir_documents where user_id=p_target and kind='identity') or length(coalesce(p_fingerprint,''))<16) then raise exception 'Identity document and verified identity fingerprint required'; end if;
 if not exists(select 1 from public.ir_seller_applications where user_id=p_target) then raise exception 'Application not found'; end if;
 update public.ir_seller_applications set status=case when p_action='approve_seller' then 'approved' else 'rejected' end,review_note=p_note where user_id=p_target;
 update public.ir_profiles set seller_status=case when p_action='approve_seller' then 'approved' else 'rejected' end where id=p_target;
 if p_action='approve_seller' then insert into ir_private.identity_links values(p_target,p_fingerprint) on conflict(user_id) do update set identity_fingerprint=excluded.identity_fingerprint; end if;
 elsif p_action in ('approve_listing','reject_listing') then
 select * into a from public.ir_auctions where id=p_target for update;
 if not found or a.status<>'under_review' then raise exception 'Pending listing not found'; end if;
 if p_action='approve_listing' then
 if a.end_at<=now()+interval '1 hour' then raise exception 'Listing end date is too soon'; end if;
 if not exists(select 1 from public.ir_profiles where id=a.seller_id and seller_status='approved' and not suspended) then raise exception 'Seller not approved'; end if;
 if not exists(select 1 from public.ir_documents where auction_id=a.id and kind='ownership') then raise exception 'Ownership evidence required'; end if;
 required_kind:=case a.category when 'Property' then 'property_title' when 'Motor Cars' then 'vehicle_registration' when 'Boats' then 'boat_registration' else 'provenance' end;
 if not exists(select 1 from public.ir_documents where auction_id=a.id and kind=required_kind) then raise exception 'Category-specific documentation required: %',required_kind; end if;
 end if;
 update public.ir_auctions set status=case when p_action='approve_listing' then 'live' else 'rejected' end,review_note=p_note,version=version+1 where id=p_target;
 elsif p_action in ('suspend','reinstate') then
 if p_target=auth.uid() then raise exception 'Cannot suspend your own account'; end if;
 update public.ir_profiles set suspended=(p_action='suspend') where id=p_target;
 if not found then raise exception 'Account not found'; end if;
 elsif p_action in ('resolve_dispute','dismiss_dispute') then
 update public.ir_disputes set status=case when p_action='resolve_dispute' then 'resolved' else 'dismissed' end,resolution=p_note where id=p_target and status='open';
 if not found then raise exception 'Open dispute not found'; end if;
 else raise exception 'Unknown staff action'; end if;
 insert into public.ir_audit(actor,action,target,detail) values(auth.uid(),p_action,p_target::text,jsonb_build_object('note',p_note));
end $$;

-- Functions default to PUBLIC execute in Postgres: revoke explicitly.
revoke all on all functions in schema ir_private from public,anon,authenticated;
grant execute on function ir_private.admin() to authenticated;
do $$ declare r record; begin
 for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'ir\_%' escape '\' loop
 execute format('revoke all on function %s from public,anon',r.signature);
 execute format('grant execute on function %s to authenticated',r.signature);
 end loop;
end $$;
alter publication supabase_realtime add table public.ir_public_auctions;
alter publication supabase_realtime add table public.ir_notifications;
