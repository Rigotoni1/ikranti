begin;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('80000000-0000-4000-8000-000000000001','monitor-buyer@example.invalid',now(),'{"name":"Buyer"}'),
 ('80000000-0000-4000-8000-000000000002','monitor-seller@example.invalid',now(),'{"name":"Seller"}');
insert into auth.sessions(id,user_id,created_at,updated_at) values('80000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001',now(),now());
insert into public.ir_account_onboarding(user_id,account_type,completed_at) values('80000000-0000-4000-8000-000000000001','buyer',now());
insert into public.ir_auctions(id,seller_id,title,description,category,location,start_price,reserve_price,current_bid,end_at,status,highest_bidder_id) values
 ('80000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000002','Monitor test auction','A sufficiently long description for testing.','Collectables','Malta',100,0,125,now()+interval '1 hour','live','80000000-0000-4000-8000-000000000001');
insert into public.ir_max_bids(auction_id,user_id,amount) values
 ('80000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000001',250),
 ('80000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000002',100);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"80000000-0000-4000-8000-000000000001","session_id":"80000000-0000-4000-8000-000000000001","aal":"aal1"}',true);
do $$ declare r jsonb:=public.ir_my_bids(); begin
 if jsonb_array_length(r)<>1 or r->0->>'bid_status'<>'leading' or (r->0->>'my_maximum')::numeric<>250 then raise exception 'Own bid summary incorrect'; end if;
 if r->0 ? 'highest_bidder_id' or r->0 ? 'user_id' then raise exception 'Private competitor identity exposed'; end if;
end $$;
reset role;
update public.ir_auctions set end_at=now()-interval '1 minute' where id='80000000-0000-4000-8000-000000000003';
set local role authenticated;
do $$ begin if public.ir_my_bids()->0->>'bid_status'<>'awaiting_result' then raise exception 'Expired auction must await settlement'; end if; end $$;
reset role;
delete from auth.sessions where id='80000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
 begin perform public.ir_my_bids(); raise exception 'FAIL revoked session permitted'; exception when raise_exception then if sqlerrm<>'Verified, active account required' then raise; end if; end;
end $$;
select 'Bid monitor privacy, leading status, pending outcome and revoked-session checks passed' as result;
rollback;
