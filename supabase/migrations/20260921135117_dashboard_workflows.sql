-- Preserve saved items while retiring the duplicate favourites action.
insert into public.ir_watchlist(user_id,auction_id)
select user_id,auction_id from public.ir_favourites on conflict do nothing;
-- Keep the legacy endpoint compatible with previously opened browser tabs.
create or replace function public.ir_favourite(p_auction uuid,p_saved boolean) returns void
language plpgsql security definer set search_path='' as $$
begin perform public.ir_watch(p_auction,p_saved); end $$;

alter table public.ir_auctions drop constraint ir_auctions_status_check;
alter table public.ir_auctions add constraint ir_auctions_status_check
check(status in ('under_review','changes_requested','rejected','live','sold','reserve_not_met','unsold','withdrawn'));

-- Temporary UI-development policy: listing evidence is optional.
-- Restore asset-specific document checks before public launch. Seller verification remains mandatory.
create or replace function public.ir_admin_action(p_action text,p_target uuid,p_note text,p_fingerprint text default null) returns void language plpgsql security definer set search_path='' as $$
declare a public.ir_auctions; begin
 if not ir_private.admin() then raise exception 'Verified administrator required'; end if;
 if length(trim(coalesce(p_note,'')))<5 or length(p_note)>2000 then raise exception 'Provide an audit note (5–2000 characters)'; end if;
 if p_action in ('approve_seller','reject_seller') then
 if p_action='approve_seller' and (not exists(select 1 from public.ir_documents where user_id=p_target and kind='identity') or length(coalesce(p_fingerprint,''))<16) then raise exception 'Identity document and verified identity fingerprint required'; end if;
 if not exists(select 1 from public.ir_seller_applications where user_id=p_target) then raise exception 'Application not found'; end if;
 if p_action='approve_seller' and exists(select 1 from public.ir_seller_applications where user_id=p_target and business_name<>'') and not exists(select 1 from public.ir_documents where user_id=p_target and kind='business') then raise exception 'Business documentation required'; end if;
 update public.ir_seller_applications set status=case when p_action='approve_seller' then 'approved' else 'rejected' end,review_note=p_note where user_id=p_target;
 update public.ir_profiles set seller_status=case when p_action='approve_seller' then 'approved' else 'rejected' end where id=p_target;
 if p_action='approve_seller' then insert into ir_private.identity_links values(p_target,p_fingerprint) on conflict(user_id) do update set identity_fingerprint=excluded.identity_fingerprint; end if;
 elsif p_action in ('approve_listing','request_listing_changes','reject_listing') then
 select * into a from public.ir_auctions where id=p_target for update;
 if not found or a.status<>'under_review' then raise exception 'Pending listing not found'; end if;
 if p_action='approve_listing' then
 if a.image_path is null then raise exception 'Listing photograph required'; end if;
 if a.end_at<=now()+interval '1 hour' then raise exception 'Listing end date is too soon'; end if;
 if not exists(select 1 from public.ir_profiles where id=a.seller_id and seller_status='approved' and not suspended) then raise exception 'Seller not approved'; end if;
 end if;
 update public.ir_auctions set status=case when p_action='approve_listing' then 'live' when p_action='request_listing_changes' then 'changes_requested' else 'rejected' end,review_note=p_note,version=version+1 where id=p_target;
 perform ir_private.notify(a.seller_id,'listing_review',a.title||': '||replace(p_action,'_',' ')||'. '||p_note,a.id,'review:'||a.id||':'||(a.version+1));
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


-- Seller edits are serialized with bidding and require renewed staff review.
create or replace function public.ir_edit_listing(p_auction uuid,p_title text,p_description text,p_category text,p_location text,p_start numeric,p_reserve numeric,p_end timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=ir_private.require_account('seller'); a public.ir_auctions;
begin
 select * into a from public.ir_auctions where id=p_auction and seller_id=u for update;
 if not found then raise exception 'Listing not found'; end if;
 if a.status not in ('under_review','changes_requested','rejected','live') or a.bid_count>0 or a.highest_bidder_id is not null
 or exists(select 1 from public.ir_max_bids where auction_id=a.id)
 or exists(select 1 from public.ir_bid_events where auction_id=a.id)
 or (a.status='live' and a.end_at<=now()) then raise exception 'This auction can no longer be edited'; end if;
 if p_end is null or p_end<now()+interval '1 day' or p_end>now()+interval '90 days' then raise exception 'Choose a closing time 1–90 days from now'; end if;
 if p_start is null or p_reserve is null or p_start<=0 or p_reserve<0 or p_start<>round(p_start,2) or p_reserve<>round(p_reserve,2) then raise exception 'Enter valid prices with no more than two decimal places'; end if;
 update public.ir_auctions set title=trim(p_title),description=trim(p_description),category=p_category,location=trim(p_location),
 start_price=p_start,reserve_price=p_reserve,current_bid=p_start,end_at=p_end,status='under_review',review_note=null,version=version+1
 where id=a.id;
 insert into public.ir_audit(actor,action,target,detail) values(u,'edit_listing',a.id::text,jsonb_build_object('previous_status',a.status));
end $$;
revoke all on function public.ir_edit_listing(uuid,text,text,text,text,numeric,numeric,timestamptz) from public,anon;
grant execute on function public.ir_edit_listing(uuid,text,text,text,text,numeric,numeric,timestamptz) to authenticated;

-- Only verified, active administrators can read authentication/identity summaries.
create function public.ir_admin_users() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not ir_private.admin() then raise exception 'Verified administrator required'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from (
 select p.*,u.email,u.email_confirmed_at is not null as email_verified,
 exists(select 1 from ir_private.identity_links i where i.user_id=p.id) as identity_approved,
 exists(select 1 from public.ir_documents d where d.user_id=p.id and d.kind='identity') as identity_submitted,
 exists(select 1 from public.ir_account_onboarding o where o.user_id=p.id and o.account_type='buyer') as buyer_role,
 exists(select 1 from public.ir_account_onboarding o where o.user_id=p.id and o.account_type='buyer' and o.completed_at is not null) as buyer_complete,
 exists(select 1 from public.ir_account_onboarding o where o.user_id=p.id and o.account_type='seller') or p.seller_status<>'not_started' as seller_role
 from public.ir_profiles p join auth.users u on u.id=p.id order by p.created_at desc limit 200
 ) r);
end $$;
create function public.ir_admin_user_detail(p_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not ir_private.admin() then raise exception 'Verified administrator required'; end if;
 if not exists(select 1 from public.ir_profiles where id=p_user) then raise exception 'User not found'; end if;
 return jsonb_build_object(
 'onboarding',(select coalesce(jsonb_agg(to_jsonb(o)),'[]'::jsonb) from public.ir_account_onboarding o where o.user_id=p_user),
 'application',(select to_jsonb(s) from public.ir_seller_applications s where s.user_id=p_user),
 'documents',(select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) from public.ir_documents d where d.user_id=p_user),
 'listings',(select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from (select * from public.ir_auctions where seller_id=p_user order by created_at desc limit 200) a),
 'orders',(select coalesce(jsonb_agg(to_jsonb(o)),'[]'::jsonb) from (select * from public.ir_orders where buyer_id=p_user or seller_id=p_user order by created_at desc limit 200) o),
 'activity',(select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from (
 select * from public.ir_audit a where a.actor=p_user or a.target=p_user::text
 or exists(select 1 from public.ir_auctions l where l.seller_id=p_user and l.id::text=a.target)
 order by a.created_at desc limit 200) a)
 );
end $$;
revoke all on function public.ir_admin_users(),public.ir_admin_user_detail(uuid) from public,anon;
grant execute on function public.ir_admin_users(),public.ir_admin_user_detail(uuid) to authenticated;
