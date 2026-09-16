create or replace function public.ir_maintenance() returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.ir_auctions; order_id uuid; n integer:=0; outcome text; w record;
begin
 for a in select * from public.ir_auctions where status='live' and end_at<=clock_timestamp() for update skip locked loop
 outcome:=case when a.highest_bidder_id is null then 'unsold' when a.current_bid<a.reserve_price then 'reserve_not_met' else 'sold' end;
 -- A suspended seller or winning bidder requires staff intervention, not an order.
 if exists(select 1 from public.ir_profiles where id in (a.seller_id,a.highest_bidder_id) and suspended) then
 outcome:='withdrawn'; insert into public.ir_risk_flags(auction_id,reason) values(a.id,'Auction closed with suspended participant; staff review required');
 end if;
 update public.ir_auctions set status=outcome,version=version+1 where id=a.id;
 if outcome='sold' then
 insert into public.ir_orders(auction_id,seller_id,buyer_id,amount) values(a.id,a.seller_id,a.highest_bidder_id,a.current_bid) on conflict(auction_id) do nothing returning id into order_id;
 perform ir_private.notify(a.highest_bidder_id,'winner','You won '||a.title||'. Review your order before arranging payment.',a.id,'winner:'||a.id);
 end if;
 perform ir_private.notify(a.seller_id,'auction_result',a.title||' closed: '||replace(outcome,'_',' '),a.id,'result:'||a.id);
 n:=n+1;
 end loop;
 for w in select x.user_id,lot.id,lot.title from public.ir_watchlist x join public.ir_auctions lot on lot.id=x.auction_id where lot.status='live' and lot.end_at>clock_timestamp() and lot.end_at<=clock_timestamp()+interval '1 hour' loop
 perform ir_private.notify(w.user_id,'ending','Watchlist reminder: '||w.title||' ends within one hour.',w.id,'ending:'||w.id||':'||w.user_id);
 end loop;
 for w in select * from public.ir_orders where status='awaiting_payment' and payment_due_at<=now()+interval '1 day' loop
 perform ir_private.notify(w.buyer_id,'payment_reminder','Your auction order is awaiting payment. Open your account for details.',w.auction_id,'payment:'||w.id||':'||current_date);
 end loop;
 update public.ir_notifications set email_status='failed',email_error='Delivery lease exhausted; manual review required' where email_status='sending' and email_attempts>=8 and email_leased_at<now()-interval '10 minutes';
 delete from ir_private.rate_limits where window_at<now()-interval '2 days';
 return jsonb_build_object('closed',n);
end $$;

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
