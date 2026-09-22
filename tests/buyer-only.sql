-- Run with both unpublished migrations inside this transaction; all fixtures roll back.
begin;
create function pg_temp.check_buyer(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',message; end if; end $$;
create function pg_temp.buyer_claim(n integer) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims',jsonb_build_object('sub','85000000-0000-4000-8000-'||lpad(n::text,12,'0'),'session_id','85000000-0000-4000-8000-'||lpad(n::text,12,'0'),'aal','aal1')::text,true); end $$;
create function pg_temp.expect_denied(statement text,expected text) returns void language plpgsql as $$
begin
 begin execute statement; raise exception 'FAIL: unexpected permission: %',statement;
 exception when others then if sqlerrm not like '%'||expected||'%' then raise; end if; end;
end $$;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('85000000-0000-4000-8000-000000000001','buyer-only-staff@example.invalid',now(),'{"name":"Staff fixture"}'),
 ('85000000-0000-4000-8000-000000000002','buyer-only-member@example.invalid',now(),'{"name":"Buyer fixture"}'),
 ('85000000-0000-4000-8000-000000000003','buyer-only-legacy@example.invalid',now(),'{"name":"Legacy fixture"}');
insert into auth.sessions(id,user_id,created_at,updated_at) select id,id,now(),now() from public.ir_profiles where id::text like '85000000-%';
update public.ir_profiles set role='admin' where id='85000000-0000-4000-8000-000000000001';
update public.ir_profiles set seller_status='approved',active_account='seller' where id='85000000-0000-4000-8000-000000000003';
insert into public.ir_account_onboarding(user_id,account_type,completed_at) select id,'buyer',now() from public.ir_profiles where id::text like '85000000-%' and role<>'admin';
insert into ir_private.identity_links(user_id,identity_fingerprint) select id,'buyer-only-fixture-'||id from public.ir_profiles where id::text like '85000000-%';
insert into public.ir_auctions(id,seller_id,title,description,category,location,start_price,current_bid,end_at,status) values
 ('85000000-0000-4000-8000-000000000010','85000000-0000-4000-8000-000000000003','Legacy inventory','Fictional fixture for rollback tests only.','Collectables','Malta',100,100,now()+interval '7 days','under_review');
insert into storage.objects(bucket_id,name) values
 ('ir-auction-images','85000000-0000-4000-8000-000000000001/fixture.jpg'),
 ('ir-private-documents','85000000-0000-4000-8000-000000000001/ownership.pdf'),
 ('ir-private-documents','85000000-0000-4000-8000-000000000002/identity.pdf');
select pg_temp.check_buyer(not has_function_privilege('authenticated','public.ir_switch_account(text)','EXECUTE'),'role switching retired');
select pg_temp.check_buyer(not has_function_privilege('authenticated','public.ir_submit_seller(text,text,text,text)','EXECUTE'),'seller signup retired');
select pg_temp.check_buyer(not has_function_privilege('authenticated','public.ir_request_feature(uuid)','EXECUTE'),'feature submissions retired');
set local role authenticated;
select pg_temp.buyer_claim(2);
select pg_temp.expect_denied($q$select public.ir_save_onboarding('seller','{}',0,false)$q$,'Invalid onboarding request');
select pg_temp.expect_denied($q$select public.ir_create_listing('Denied listing','Fictional fixture for rollback tests only.','Collectables','Malta',100,0,now()+interval '7 days')$q$,'Verified administrator required');
select pg_temp.expect_denied($q$select public.ir_register_image('85000000-0000-4000-8000-000000000010','85000000-0000-4000-8000-000000000002/photo.jpg')$q$,'Verified administrator required');
select public.ir_register_document(null,'identity','85000000-0000-4000-8000-000000000002/identity.pdf','application/pdf',256);
select public.ir_save_onboarding('buyer','{"legal_name":"Buyer Fixture","phone":"+35699110000","country":"Malta","address":"Example test street, Malta","terms_accepted":"true","terms_version":"2026-09-22.1"}',3,true);
select pg_temp.check_buyer(exists(select 1 from public.ir_terms_acceptances where user_id=auth.uid() and terms_version='2026-09-22.1'),'buyer consent saved');
select pg_temp.buyer_claim(3);
select pg_temp.expect_denied($q$select public.ir_edit_listing('85000000-0000-4000-8000-000000000010','Denied listing','Fictional fixture for rollback tests only.','Collectables','Malta',100,0,now()+interval '7 days')$q$,'Verified administrator required');
select pg_temp.buyer_claim(1);
select set_config('test.staff_listing',public.ir_create_listing('Staff inventory','Fictional fixture for rollback tests only.','Collectables','Malta',100,0,now()+interval '7 days')::text,true);
select pg_temp.check_buyer((select seller_status='not_started' from public.ir_profiles where id=auth.uid()),'staff not enrolled as seller');
select pg_temp.check_buyer(not exists(select 1 from public.ir_account_onboarding where user_id=auth.uid()),'staff create needs no onboarding');
select public.ir_edit_listing('85000000-0000-4000-8000-000000000010','Staff edited inventory','Fictional fixture for rollback tests only.','Collectables','Malta',100,0,now()+interval '7 days');
select pg_temp.check_buyer((select seller_id='85000000-0000-4000-8000-000000000003' from public.ir_auctions where id='85000000-0000-4000-8000-000000000010'),'legacy ownership preserved');
select public.ir_register_image('85000000-0000-4000-8000-000000000010','85000000-0000-4000-8000-000000000001/fixture.jpg');
select public.ir_register_document('85000000-0000-4000-8000-000000000010','ownership','85000000-0000-4000-8000-000000000001/ownership.pdf','application/pdf',256);
select pg_temp.check_buyer(exists(select 1 from public.ir_documents where auction_id='85000000-0000-4000-8000-000000000010' and user_id=auth.uid()),'staff evidence attached to another owner listing');
select public.ir_register_image(current_setting('test.staff_listing')::uuid,'85000000-0000-4000-8000-000000000001/fixture.jpg');
reset role;
-- Legacy consignor approval is no longer an account role: staff review governs the listing.
update public.ir_profiles set seller_status='pending' where id='85000000-0000-4000-8000-000000000003';
set local role authenticated;
select public.ir_admin_action('approve_listing',current_setting('test.staff_listing')::uuid,'Staff reviewed fixture for rollback test.');
select public.ir_admin_action('approve_listing','85000000-0000-4000-8000-000000000010','Staff reviewed fixture for rollback test.');
select pg_temp.check_buyer((select status='live' from public.ir_auctions where id=current_setting('test.staff_listing')::uuid),'staff owned listing approved without seller status');
reset role;
update ir_private.settings set trading_enabled=true;
set local role authenticated;
select pg_temp.buyer_claim(2);
select pg_temp.check_buyer(not (public.ir_submit_bid(current_setting('test.staff_listing')::uuid,150,gen_random_uuid()) ? 'error'),'buyer can bid on team inventory');
select pg_temp.check_buyer(not (public.ir_submit_bid('85000000-0000-4000-8000-000000000010',150,gen_random_uuid()) ? 'error'),'existing inventory still accepts eligible buyer bids');
select pg_temp.buyer_claim(1);
select pg_temp.expect_denied($q$select public.ir_edit_listing(current_setting('test.staff_listing')::uuid,'Unsafe edit','Fictional fixture for rollback tests only.','Collectables','Malta',100,0,now()+interval '7 days')$q$,'can no longer be edited');
select pg_temp.expect_denied($q$select public.ir_register_image(current_setting('test.staff_listing')::uuid,'85000000-0000-4000-8000-000000000001/fixture.jpg')$q$,'Editable pending listing required');
select pg_temp.check_buyer(exists(select 1 from public.ir_audit where actor=auth.uid() and action='create_listing' and target=current_setting('test.staff_listing')),'create audit recorded');
reset role;
select pg_temp.check_buyer((select count(*)=2 from ir_private.bid_chat_events where auction_id in (current_setting('test.staff_listing')::uuid,'85000000-0000-4000-8000-000000000010')),'bid chat preserved');
update public.ir_profiles set suspended=true where id='85000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect_denied($q$select public.ir_create_listing('Suspended staff','Fictional fixture for rollback tests only.','Collectables','Malta',100,0,now()+interval '7 days')$q$,'Verified, active account required');
reset role;
rollback;
