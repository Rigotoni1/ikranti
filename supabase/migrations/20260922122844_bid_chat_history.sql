-- Private append-only bid transcript. Only the sanitized RPC below is exposed.
create table ir_private.bid_chat_events (
 id bigint generated always as identity primary key,
 auction_id uuid not null references public.ir_auctions(id),
 user_id uuid not null references public.ir_profiles(id),
 amount numeric(14,2) not null check(amount>0),
 kind text not null check(kind in ('bid','automatic','priority','snapshot')),
 created_at timestamptz default clock_timestamp(),
 check((kind='snapshot')=(created_at is null))
);
create index ir_bid_chat_auction_order on ir_private.bid_chat_events(auction_id,id desc);
create index ir_bid_chat_user on ir_private.bid_chat_events(user_id);
alter table ir_private.bid_chat_events enable row level security;
revoke all on ir_private.bid_chat_events from public,anon,authenticated;
revoke all on sequence ir_private.bid_chat_events_id_seq from public,anon,authenticated;

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

-- Read-only public-price projection. Identity is reduced to a session-derived boolean;
-- no names, profile IDs, request IDs, reserve values or unspent maximums leave this RPC.
create function public.ir_bid_history(p_auction uuid,p_before bigint default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 a public.ir_auctions; u uuid; last_id bigint; first_id bigint; page jsonb; more boolean;
 snapshot jsonb:=null; page_size integer:=greatest(1,least(coalesce(p_limit,50),100));
begin
 if auth.uid() is not null then u:=ir_private.member(); end if;
 select lot.* into a from public.ir_auctions lot
 join public.ir_public_auctions visible on visible.id=lot.id
 where lot.id=p_auction and lot.status in ('live','sold','reserve_not_met','unsold','withdrawn');
 if not found then raise exception 'Auction not available'; end if;
 if p_before is not null and p_before<=0 then raise exception 'Invalid history cursor'; end if;
 select id into last_id from ir_private.bid_chat_events where auction_id=p_auction order by id desc limit 1;
 with recent as (
   select * from ir_private.bid_chat_events
   where auction_id=p_auction and (p_before is null or id<p_before)
   order by id desc limit page_size
 )
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',id::text,'amount',amount,'kind',kind,'created_at',created_at,
   'is_mine',coalesce(user_id=u,false),
   'is_leading',id=last_id and user_id=a.highest_bidder_id and amount=a.current_bid
 ) order by id),'[]'::jsonb),min(id) into page,first_id from recent;
 select exists(select 1 from ir_private.bid_chat_events where auction_id=p_auction and id<first_id) into more;
 if last_id is null and a.highest_bidder_id is not null and p_before is null then
   snapshot:=jsonb_build_object('id','snapshot','amount',a.current_bid,'kind','snapshot','created_at',null,
     'is_mine',coalesce(a.highest_bidder_id=u,false),'is_leading',true);
 end if;
 return jsonb_build_object('auction_id',a.id,'entries',page,'snapshot',snapshot,
   'leading_entry_id',case when a.highest_bidder_id is null then null when last_id is null then 'snapshot' else last_id::text end,
   'has_more',more,'next_before',case when more then first_id::text else null end,
   'auction',jsonb_build_object('current_bid',a.current_bid,'bid_count',a.bid_count,'end_at',a.end_at,
     'status',a.status,'reserve_met',a.current_bid>=a.reserve_price,'has_reserve',a.reserve_price>0,
     'version',a.version,'has_bids',a.highest_bidder_id is not null,
     'viewer_leading',coalesce(a.highest_bidder_id=u,false)));
end $$;
revoke all on function public.ir_bid_history(uuid,bigint,integer) from public,anon,authenticated;
grant execute on function public.ir_bid_history(uuid,bigint,integer) to anon,authenticated;
comment on function public.ir_bid_history(uuid,bigint,integer) is
 'Intentional public RPC: approved auction prices only; bidder identity is a session-derived is_mine boolean. Raw ledger remains private.';
