-- Buyer-only public UI. Historical seller records and ownership are preserved.
-- Apply after 20260922122844_bid_chat_history.sql. No live data is converted.
create or replace function public.ir_save_onboarding(p_type text,p_details jsonb,p_step integer,p_complete boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=ir_private.member(); d jsonb; current_terms constant text:='2026-09-22.1';
begin
 if p_type is null or p_type<>'buyer' or p_step is null or p_step not between 0 and 3
  or p_complete is null or (p_complete and p_step<>3) then raise exception 'Invalid onboarding request'; end if;
 if p_details is null or jsonb_typeof(p_details)<>'object' or octet_length(p_details::text)>8000 then raise exception 'Invalid details'; end if;
 perform ir_private.limit_action('onboarding',30,60);
 -- Serialize onboarding and consent updates for this member, including double submissions.
 perform 1 from public.ir_profiles where id=u for update;
 select coalesce(jsonb_object_agg(key,value),'{}') into d from jsonb_each(p_details)
 where key in ('legal_name','phone','country','address','interests');
 if exists(select 1 from jsonb_each(d) where jsonb_typeof(value)<>'string' or length(value#>>'{}')>case when key='address' then 1000 else 160 end) then raise exception 'Invalid detail format or length'; end if;
 -- The verification step and final completion require actual saved evidence and explicit consent.
 if p_step=3 then
  if p_details->>'terms_accepted' is distinct from 'true' or jsonb_typeof(p_details->'terms_accepted') is distinct from 'string'
   or p_details->>'terms_version' is distinct from current_terms then raise exception 'Read and accept the current Terms & Conditions to continue'; end if;
  if not exists(select 1 from public.ir_documents where user_id=u and kind='identity' and auction_id is null) then raise exception 'Upload private identity evidence'; end if;
  insert into public.ir_terms_acceptances(user_id,account_type,terms_version,terms_path)
  values(u,p_type,current_terms,'/terms/'||current_terms) on conflict do nothing;
 end if;
 -- Consent markers in saved progress come only from the immutable server receipt, never a draft claim.
 if exists(select 1 from public.ir_terms_acceptances where user_id=u and account_type=p_type and terms_version=current_terms) then
  d:=d||jsonb_build_object('terms_accepted','true','terms_version',current_terms);
 end if;
 if p_complete then
  if length(trim(coalesce(d->>'legal_name','')))<2 or length(trim(coalesce(d->>'phone','')))<7
   or length(trim(coalesce(d->>'country','')))<2 or length(trim(coalesce(d->>'address','')))<8 then raise exception 'Complete your contact details'; end if;
 end if;
 insert into public.ir_account_onboarding(user_id,account_type,details,step,completed_at)
 values(u,p_type,d,p_step,case when p_complete then now() end)
 on conflict(user_id,account_type) do update set details=excluded.details,step=excluded.step,
 completed_at=coalesce(ir_account_onboarding.completed_at,excluded.completed_at),updated_at=now();
 if p_complete then update public.ir_profiles set active_account=p_type where id=u; end if;
end $$;
revoke all on function public.ir_save_onboarding(text,jsonb,integer,boolean) from public,anon;
grant execute on function public.ir_save_onboarding(text,jsonb,integer,boolean) to authenticated;

-- Retire role switching and public consignment entry points, including stale tabs.
revoke all on function public.ir_switch_account(text) from public,anon,authenticated;
revoke all on function public.ir_submit_seller(text,text,text,text) from public,anon,authenticated;
revoke all on function public.ir_request_feature(uuid) from public,anon,authenticated;

-- A team member creates inventory under their own authenticated staff identity.
-- Staff permissions are checked server-side; no seller onboarding or profile mutation.
create or replace function public.ir_create_listing(p_title text,p_description text,p_category text,p_location text,p_start numeric,p_reserve numeric,p_end timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=ir_private.member(); v uuid;
begin
 if not ir_private.admin() then raise exception 'Verified administrator required'; end if;
 perform ir_private.limit_action('listing',30,86400);
 if p_end is null or p_end<now()+interval '1 day' or p_end>now()+interval '90 days' then raise exception 'Choose a closing time 1–90 days from now'; end if;
 if p_start is null or p_reserve is null or p_start<=0 or p_reserve<0 or p_start::text in ('NaN','Infinity','-Infinity') or p_reserve::text in ('NaN','Infinity','-Infinity') or p_start<>round(p_start,2) or p_reserve<>round(p_reserve,2) then raise exception 'Enter valid prices with no more than two decimal places'; end if;
 insert into public.ir_auctions(seller_id,title,description,category,location,start_price,reserve_price,current_bid,end_at)
 values(u,trim(p_title),trim(p_description),p_category,trim(p_location),p_start,p_reserve,p_start,p_end) returning id into v;
 insert into public.ir_audit(actor,action,target,detail) values(u,'create_listing',v::text,jsonb_build_object('source','staff_inventory'));
 return v;
end $$;
revoke all on function public.ir_create_listing(text,text,text,text,numeric,numeric,timestamptz) from public,anon;
grant execute on function public.ir_create_listing(text,text,text,text,numeric,numeric,timestamptz) to authenticated;

-- Editing preserves owner, locks against concurrent bidding, and returns to review.
create or replace function public.ir_edit_listing(p_auction uuid,p_title text,p_description text,p_category text,p_location text,p_start numeric,p_reserve numeric,p_end timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=ir_private.member(); a public.ir_auctions;
begin
 if not ir_private.admin() then raise exception 'Verified administrator required'; end if;
 select * into a from public.ir_auctions where id=p_auction for update;
 if not found then raise exception 'Listing not found'; end if;
 if a.status not in ('under_review','changes_requested','rejected','live') or a.bid_count>0 or a.highest_bidder_id is not null
 or exists(select 1 from public.ir_max_bids where auction_id=a.id)
 or exists(select 1 from public.ir_bid_events where auction_id=a.id)
 or (a.status='live' and a.end_at<=now()) then raise exception 'This auction can no longer be edited'; end if;
 if p_end is null or p_end<now()+interval '1 day' or p_end>now()+interval '90 days' then raise exception 'Choose a closing time 1–90 days from now'; end if;
 if p_start is null or p_reserve is null or p_start<=0 or p_reserve<0 or p_start::text in ('NaN','Infinity','-Infinity') or p_reserve::text in ('NaN','Infinity','-Infinity') or p_start<>round(p_start,2) or p_reserve<>round(p_reserve,2) then raise exception 'Enter valid prices with no more than two decimal places'; end if;
 update public.ir_auctions set title=trim(p_title),description=trim(p_description),category=p_category,location=trim(p_location),
 start_price=p_start,reserve_price=p_reserve,current_bid=p_start,end_at=p_end,status='under_review',review_note=null,version=version+1
 where id=a.id;
 insert into public.ir_audit(actor,action,target,detail) values(u,'edit_listing',a.id::text,jsonb_build_object('previous_status',a.status));
end $$;
revoke all on function public.ir_edit_listing(uuid,text,text,text,text,numeric,numeric,timestamptz) from public,anon;
grant execute on function public.ir_edit_listing(uuid,text,text,text,text,numeric,numeric,timestamptz) to authenticated;

-- Buyer ID uploads stay available. Asset evidence and photos are staff-only.
create or replace function public.ir_register_document(p_auction uuid,p_kind text,p_path text,p_mime text,p_size integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=ir_private.member(); v uuid; a public.ir_auctions;
begin
 perform ir_private.limit_action('document',20,86400);
 if p_path is null or p_path not like u::text||'/%' or not exists(select 1 from storage.objects where bucket_id='ir-private-documents' and name=p_path) then raise exception 'Uploaded document not found'; end if;
 if p_auction is not null then
  if not ir_private.admin() then raise exception 'Verified administrator required'; end if;
  select * into a from public.ir_auctions where id=p_auction for update;
  if not found or a.status<>'under_review' or a.bid_count>0 or a.highest_bidder_id is not null
   or exists(select 1 from public.ir_max_bids where auction_id=a.id)
   or exists(select 1 from public.ir_bid_events where auction_id=a.id) then raise exception 'Editable pending listing required'; end if;
 elsif p_kind is distinct from 'identity' then raise exception 'Only identity documents are accepted for buyer accounts';
 end if;
 if (p_kind in ('identity','business')) <> (p_auction is null) then raise exception 'Select the correct document category'; end if;
 insert into public.ir_documents(user_id,auction_id,kind,path,mime,size) values(u,p_auction,p_kind,p_path,p_mime,p_size) returning id into v;
 if p_auction is not null then
  insert into public.ir_audit(actor,action,target,detail) values(u,'upload_listing_evidence',p_auction::text,jsonb_build_object('document_id',v,'kind',p_kind));
 end if;
 return v;
end $$;
create or replace function public.ir_register_image(p_auction uuid,p_path text)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=ir_private.member(); a public.ir_auctions;
begin
 if not ir_private.admin() then raise exception 'Verified administrator required'; end if;
 perform ir_private.limit_action('image',20,86400);
 if p_path is null or p_path not like u::text||'/%' or not exists(select 1 from storage.objects where bucket_id='ir-auction-images' and name=p_path) then raise exception 'Uploaded image not found'; end if;
 select * into a from public.ir_auctions where id=p_auction for update;
 if not found or a.status<>'under_review' or a.bid_count>0 or a.highest_bidder_id is not null
  or exists(select 1 from public.ir_max_bids where auction_id=a.id)
  or exists(select 1 from public.ir_bid_events where auction_id=a.id) then raise exception 'Editable pending listing required'; end if;
 update public.ir_auctions set image_path=p_path,version=version+1 where id=a.id;
 insert into public.ir_audit(actor,action,target,detail) values(u,'upload_listing_photo',a.id::text,'{}'::jsonb);
end $$;
revoke all on function public.ir_register_document(uuid,text,text,text,integer),public.ir_register_image(uuid,text) from public,anon;
grant execute on function public.ir_register_document(uuid,text,text,text,integer),public.ir_register_image(uuid,text) to authenticated;

-- Existing consignors remain valid; new staff inventory does not require seller signup.
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
 if not exists(select 1 from public.ir_profiles where id=a.seller_id and not suspended) then raise exception 'Listing owner unavailable'; end if;
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

-- Keep all existing proxy bidding, identity/self-bid, retry and transcript guards.
create or replace function public.ir_bid(p_auction uuid,p_max numeric,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
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
 if not exists(select 1 from ir_private.identity_links where user_id=u) then raise exception 'Identity verification required before bidding'; end if;
 if a.seller_id=u then raise exception 'You cannot bid on your own auction'; end if;
 if not exists(select 1 from public.ir_profiles where id=a.seller_id and not suspended) then raise exception 'Listing owner is unavailable'; end if;
 if exists(select 1 from ir_private.identity_links x join ir_private.identity_links y on x.identity_fingerprint=y.identity_fingerprint where x.user_id=u and y.user_id=a.seller_id) then raise exception 'Linked seller accounts cannot bid'; end if;
 select amount into own_max from public.ir_max_bids where auction_id=p_auction and user_id=u;
 if p_max < (case when a.bid_count=0 then a.start_price else a.current_bid+ir_private.increment(a.current_bid) end) or p_max<=coalesce(own_max,0) then raise exception 'Maximum must exceed your previous maximum and meet the next increment'; end if;
 select amount into leader_max from public.ir_max_bids where auction_id=p_auction and user_id=a.highest_bidder_id;
 leader:=a.highest_bidder_id; price:=a.current_bid;
 if leader is null then leader:=u; price:=a.start_price;
 elsif leader=u then null;
 elsif p_max>leader_max then leader:=u; price:=least(p_max,leader_max+ir_private.increment(leader_max));
 else price:=least(leader_max,p_max+case when p_max=leader_max then 0 else ir_private.increment(p_max) end); end if;

 -- Public-price transcript, written under the same auction lock as the bid.
 -- Legacy events name the submitting user even when another user wins: never backfill from them.
 if a.highest_bidder_id is not null and not exists(select 1 from ir_private.bid_chat_events where auction_id=p_auction) then
   insert into ir_private.bid_chat_events(auction_id,user_id,amount,kind,created_at)
   values(p_auction,a.highest_bidder_id,a.current_bid,'snapshot',null);
 end if;
 if a.highest_bidder_id is null then
   insert into ir_private.bid_chat_events(auction_id,user_id,amount,kind) values(p_auction,u,price,'bid');
 elsif a.highest_bidder_id<>u then
   if leader=u then
     -- The defending proxy has been exhausted. Only reached public amounts enter the transcript.
     if leader_max>a.current_bid then
       insert into ir_private.bid_chat_events(auction_id,user_id,amount,kind) values(p_auction,a.highest_bidder_id,leader_max,'automatic');
     end if;
     insert into ir_private.bid_chat_events(auction_id,user_id,amount,kind) values(p_auction,u,price,'bid');
   else
     insert into ir_private.bid_chat_events(auction_id,user_id,amount,kind) values(p_auction,u,p_max,'bid');
     insert into ir_private.bid_chat_events(auction_id,user_id,amount,kind)
     values(p_auction,leader,price,case when p_max=leader_max then 'priority' else 'automatic' end);
   end if;
 end if;
 -- Raising an existing leader's private maximum is NOT a public chat event.
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

-- Keep all browser writes behind the existing onboarding/session/rate-limit wrapper.
revoke all on function public.ir_bid(uuid,numeric,uuid) from public,anon,authenticated;
