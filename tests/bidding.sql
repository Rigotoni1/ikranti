-- Run against the Ikranti Supabase database. Test rows are always rolled back.
begin;

insert into public.auctions (id,seller_id,title,category,location,description,image_url,start_price,reserve_price,current_bid,end_at)
values ('__test_bid_rules','seller_01','Test lot','Collectables','Malta','Disposable transaction test','https://example.com/test.jpg',100,150,100,clock_timestamp()+interval '1 hour');

do $$
declare result jsonb; price numeric; leader text; finish timestamptz; watches integer;
begin
  result := public.ikranti_place_bid('__test_bid_rules','buyer_01',300);
  assert (result->>'visibleAmount')::numeric = 100, 'First bidder pays starting price';
  assert (result->>'leading')::boolean, 'First bidder leads';

  result := public.ikranti_place_bid('__test_bid_rules','collector_01',200);
  assert (result->>'visibleAmount')::numeric = 225, 'Proxy should outbid challenger by one increment';
  assert not (result->>'leading')::boolean, 'Lower maximum should lose';

  result := public.ikranti_place_bid('__test_bid_rules','collector_01',300);
  assert (result->>'visibleAmount')::numeric = 300, 'Tie never exceeds either maximum';
  assert not (result->>'leading')::boolean, 'Earlier maximum wins tie';

  result := public.ikranti_place_bid('__test_bid_rules','collector_01',400);
  assert (result->>'visibleAmount')::numeric = 325, 'New leader pays previous max plus increment';
  assert (result->>'leading')::boolean, 'Higher maximum wins';

  result := public.ikranti_place_bid('__test_bid_rules','collector_01',500);
  assert (result->>'visibleAmount')::numeric = 325, 'Raising own maximum does not increase price';

  begin
    perform public.ikranti_place_bid('__test_bid_rules','seller_01',1000);
    raise exception using errcode='XX000', message='Self-bid was accepted';
  exception when raise_exception then
    assert sqlerrm = 'You cannot bid on your own lot.', 'Self-bid error';
  end;

  begin
    perform public.ikranti_place_bid('__test_bid_rules','buyer_01',1);
    raise exception using errcode='XX000', message='Low bid was accepted';
  exception when raise_exception then
    assert sqlerrm like 'Your maximum bid must be at least%', 'Minimum bid error';
  end;

  update public.auctions set end_at=clock_timestamp()+interval '30 seconds' where id='__test_bid_rules';
  result := public.ikranti_place_bid('__test_bid_rules','buyer_01',600);
  assert (result->>'extended')::boolean, 'Late bid extends auction';
  select end_at into finish from public.auctions where id='__test_bid_rules';
  assert finish > clock_timestamp()+interval '110 seconds', 'Anti-sniping adds two minutes';

  update public.auctions set end_at=clock_timestamp()-interval '1 second' where id='__test_bid_rules';
  begin
    perform public.ikranti_place_bid('__test_bid_rules','collector_01',700);
    raise exception using errcode='XX000', message='Closed auction accepted a bid';
  exception when raise_exception then
    assert sqlerrm = 'Bidding has closed.', 'Closed auction error';
  end;

  assert public.ikranti_toggle_watch('buyer_01','__test_bid_rules'), 'Watch is added';
  assert not public.ikranti_toggle_watch('buyer_01','__test_bid_rules'), 'Watch is removed';
  select watch_count into watches from public.auctions where id='__test_bid_rules';
  assert watches = 0, 'Watch count returns to zero';
  assert not has_table_privilege('anon','public.max_bids','SELECT'), 'Maximum bids are private';
  assert not has_function_privilege('anon','public.ikranti_place_bid(text,text,numeric)','EXECUTE'), 'Bidding requires the gateway';
end $$;

select 'Proxy bidding, ties, self-bid rejection, minimums, closing time, anti-sniping, watchlists and permissions passed' as result;
rollback;
