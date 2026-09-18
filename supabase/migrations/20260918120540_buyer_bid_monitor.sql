-- Return only the caller's maxima and outcome; never expose competing identities or maxima.
create function public.ir_my_bids() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=ir_private.require_account('buyer'); result jsonb;
begin
 select coalesce(jsonb_agg(row_to_json(b) order by b.end_at desc),'[]'::jsonb) into result from (
  select a.id as auction_id,a.title,a.category,a.current_bid,m.amount as my_maximum,a.end_at,
   a.status as auction_status,a.bid_count,a.version,
   case when a.status='live' and a.end_at<=now() then 'awaiting_result'
    when a.status='live' and a.highest_bidder_id=u then 'leading'
    when a.status='live' then 'outbid'
    when a.status='sold' and o.buyer_id=u then 'won'
    when a.status='sold' then 'lost'
    when a.status='reserve_not_met' then 'reserve_not_met'
    when a.status='withdrawn' then 'withdrawn'
    else 'closed' end as bid_status,
   o.id as order_id,o.status as order_status
  from public.ir_max_bids m join public.ir_auctions a on a.id=m.auction_id
  left join public.ir_orders o on o.auction_id=a.id and o.buyer_id=u
  where m.user_id=u
 ) b;
 return result;
end $$;
revoke all on function public.ir_my_bids() from public,anon;
grant execute on function public.ir_my_bids() to authenticated;
