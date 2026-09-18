-- Seller edits are serialized with bidding and require renewed staff review.
create function public.ir_edit_listing(p_auction uuid,p_title text,p_description text,p_category text,p_location text,p_start numeric,p_reserve numeric,p_end timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=ir_private.require_account('seller'); a public.ir_auctions;
begin
 select * into a from public.ir_auctions where id=p_auction and seller_id=u for update;
 if not found then raise exception 'Listing not found'; end if;
 if a.status not in ('under_review','rejected','live') or a.bid_count>0 or a.highest_bidder_id is not null
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
