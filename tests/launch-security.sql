-- Run as the database owner. All fixtures, claims and bids are rolled back.
begin;
create function pg_temp.bid(a uuid,m numeric,r uuid) returns jsonb language plpgsql as $$ declare result jsonb; begin result:=public.ir_submit_bid(a,m,r); if result ? 'error' then raise exception '%',result->>'error'; end if; return result; end $$;
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %',message; end if; end $$;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('10000000-0000-4000-8000-000000000001','ir-test-seller@example.invalid',now(),'{"name":"Test seller"}'),
 ('10000000-0000-4000-8000-000000000002','ir-test-buyer@example.invalid',now(),'{"name":"Test buyer"}'),
 ('10000000-0000-4000-8000-000000000003','ir-test-other@example.invalid',now(),'{"name":"Other buyer"}'),
 ('10000000-0000-4000-8000-000000000004','ir-test-staff@example.invalid',now(),'{"name":"Staff"}'),
 ('10000000-0000-4000-8000-000000000005','ir-test-unverified@example.invalid',null,'{"name":"Unverified","role":"admin"}');
insert into auth.sessions(id,user_id,created_at,updated_at) select id,id,now(),now() from auth.users where email like 'ir-test-%@example.invalid' or email like 'ir-abuse-%@example.invalid';
update public.ir_profiles set seller_status='approved' where id='10000000-0000-4000-8000-000000000001';
update public.ir_profiles set role='admin' where id='10000000-0000-4000-8000-000000000004';
insert into ir_private.identity_links values
 ('10000000-0000-4000-8000-000000000001','seller-fingerprint'),
 ('10000000-0000-4000-8000-000000000002','buyer-fingerprint'),
 ('10000000-0000-4000-8000-000000000003','other-fingerprint');
update ir_private.settings set trading_enabled=true;
insert into public.ir_auctions(id,seller_id,title,description,category,location,start_price,reserve_price,current_bid,end_at,status) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Test auction one','A sufficiently long test description.','Collectables','Malta',100,150,100,now()+interval '1 minute','live'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Reserve outcome test','A sufficiently long test description.','Collectables','Malta',100,1000,100,now()+interval '1 hour','live'),
 ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','No bids outcome test','A sufficiently long test description.','Collectables','Malta',100,0,100,now()+interval '1 hour','live');
select pg_temp.assert_true(not has_function_privilege('anon','public.ir_bid(uuid,numeric,uuid)','EXECUTE'),'anonymous bidding blocked');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.ir_maintenance()','EXECUTE'),'users cannot run settlement');
select pg_temp.assert_true(not has_table_privilege('authenticated','ir_private.settings','UPDATE'),'users cannot enable trading');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.ir_profiles','UPDATE'),'users cannot edit roles');
select pg_temp.assert_true((select role='member' from public.ir_profiles where id='10000000-0000-4000-8000-000000000005'),'metadata cannot grant admin');
insert into public.ir_account_onboarding(user_id,account_type,completed_at)
select id,t,now() from public.ir_profiles cross join (values ('buyer'),('seller')) roles(t) where id::text like '10000000-%';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","session_id":"10000000-0000-4000-8000-000000000002","aal":"aal1"}',true);
select pg_temp.assert_true((select count(*)=1 from public.ir_profiles),'only own profile readable');
select pg_temp.assert_true((select count(*)=0 from public.ir_auctions),'seller private auction rows hidden from bidder');
select pg_temp.assert_true((select count(*)>=3 from public.ir_public_auctions),'public catalogue readable');
select pg_temp.bid('20000000-0000-4000-8000-000000000001',200,'30000000-0000-4000-8000-000000000001');
select pg_temp.bid('20000000-0000-4000-8000-000000000001',200,'30000000-0000-4000-8000-000000000001');
select pg_temp.assert_true((select count(*)=1 from public.ir_bid_events),'same request does not duplicate a bid');
select pg_temp.assert_true((select current_bid=100 and bid_count=1 and end_at>now()+interval '110 seconds' from public.ir_public_auctions where id='20000000-0000-4000-8000-000000000001'),'first bid at start price and anti-sniping extension');
do $$ begin
 begin perform pg_temp.bid('20000000-0000-4000-8000-000000000001',225,'30000000-0000-4000-8000-000000000001'); raise exception 'FAIL: reused request accepted'; exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; if sqlerrm<>'Request ID already used' then raise; end if; end;
end $$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","session_id":"10000000-0000-4000-8000-000000000003","aal":"aal1"}',true);
select pg_temp.assert_true((select count(*)=0 from public.ir_max_bids),'other bidder maximum is private');
select pg_temp.assert_true((select count(*)=0 from public.ir_notifications),'other bidder notifications private');
select pg_temp.bid('20000000-0000-4000-8000-000000000001',200,'30000000-0000-4000-8000-000000000002');
select pg_temp.assert_true((select current_bid=200 from public.ir_public_auctions where id='20000000-0000-4000-8000-000000000001'),'equal maximum retains earlier bidder and raises visible price');
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000004","session_id":"10000000-0000-4000-8000-000000000004","aal":"aal1"}',true);
select pg_temp.assert_true((select count(*)=1 from public.ir_profiles),'admin AAL1 cannot read other profiles');
do $$ begin
 begin perform public.ir_admin_action('suspend','10000000-0000-4000-8000-000000000003','Test suspension'); raise exception 'FAIL: admin action without MFA'; exception when raise_exception then if sqlerrm like 'FAIL:%' or sqlerrm<>'Administrator with two-factor authentication required' then raise; end if; end;
end $$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000004","session_id":"10000000-0000-4000-8000-000000000004","aal":"aal2"}',true);
select pg_temp.assert_true((select count(*)>=5 from public.ir_profiles),'admin AAL2 reads review queue');
select public.ir_admin_action('suspend','10000000-0000-4000-8000-000000000003','Test suspension');
select pg_temp.assert_true((select count(*)=1 from public.ir_audit where action='suspend' and target='10000000-0000-4000-8000-000000000003'),'staff action audited');
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","session_id":"10000000-0000-4000-8000-000000000003","aal":"aal1"}',true);
do $$ begin
 begin perform pg_temp.bid('20000000-0000-4000-8000-000000000001',300,gen_random_uuid()); raise exception 'FAIL: suspended account bid'; exception when raise_exception then if sqlerrm like 'FAIL:%' or sqlerrm<>'Verified, active account required' then raise; end if; end;
end $$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000005","session_id":"10000000-0000-4000-8000-000000000005","aal":"aal1"}',true);
do $$ begin
 begin perform public.ir_submit_seller('Test user','','','Test address Malta'); raise exception 'FAIL: unverified account submitted'; exception when raise_exception then if sqlerrm like 'FAIL:%' or sqlerrm<>'Verified, active account required' then raise; end if; end;
end $$;
reset role;
select pg_temp.assert_true((select highest_bidder_id='10000000-0000-4000-8000-000000000002' from public.ir_auctions where id='20000000-0000-4000-8000-000000000001'),'earlier bidder wins equal maximum');
update public.ir_auctions set end_at=now()-interval '1 second' where id='20000000-0000-4000-8000-000000000001';
select public.ir_maintenance();
select public.ir_maintenance();
select pg_temp.assert_true((select count(*)=1 from public.ir_orders where auction_id='20000000-0000-4000-8000-000000000001'),'exactly one order after repeated close');
select pg_temp.assert_true((select count(*)=1 from public.ir_notifications where dedupe_key='winner:20000000-0000-4000-8000-000000000001'),'winner notified exactly once');
select pg_temp.assert_true((select status='sold' from public.ir_auctions where id='20000000-0000-4000-8000-000000000001'),'sold status finalized');
update public.ir_auctions set highest_bidder_id='10000000-0000-4000-8000-000000000002',bid_count=1 where id='20000000-0000-4000-8000-000000000002';
update public.ir_auctions set end_at=now()-interval '1 second' where id in ('20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003');
select public.ir_maintenance();
select pg_temp.assert_true((select status='reserve_not_met' from public.ir_auctions where id='20000000-0000-4000-8000-000000000002'),'reserve not met outcome');
select pg_temp.assert_true((select status='unsold' from public.ir_auctions where id='20000000-0000-4000-8000-000000000003'),'no bids unsold outcome');
select pg_temp.assert_true((select count(*)=0 from public.ir_orders where auction_id in ('20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003')),'unsuccessful auctions have no orders');
select 'Launch security and settlement assertions passed' as result;
rollback;
