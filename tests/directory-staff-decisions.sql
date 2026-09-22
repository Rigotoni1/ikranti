-- Run after directory_staff_decisions. All fixtures and decisions are rolled back.
begin;
create function pg_temp.check_true(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',message; end if; end $$;
create function pg_temp.expect_decision_error(expected text,u uuid,a text,d uuid default null,m text default null,l uuid default null,r boolean default true) returns void language plpgsql as $$
begin
 begin
  perform public.ir_staff_user_decision(u,a,'Test review note',gen_random_uuid(),d,m,l,r);
 exception when raise_exception then
  if sqlerrm<>expected then raise exception 'Expected %, got %',expected,sqlerrm; end if;
  return;
 end;
 raise exception 'FAIL: expected %',expected;
end $$;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('82000000-0000-4000-8000-000000000001','staff-decisions-admin@example.invalid',now(),'{"name":"Staff test"}'),
 ('82000000-0000-4000-8000-000000000002','staff-decisions-buyer@example.invalid',now(),'{"name":"Buyer test"}'),
 ('82000000-0000-4000-8000-000000000003','staff-decisions-seller@example.invalid',now(),'{"name":"Seller test"}'),
 ('82000000-0000-4000-8000-000000000004','staff-decisions-business@example.invalid',now(),'{"name":"Business test"}'),
 ('82000000-0000-4000-8000-000000000005','staff-decisions-incomplete@example.invalid',null,'{"name":"Incomplete test"}');
insert into auth.sessions(id,user_id,created_at,updated_at)
select id,id,now(),now() from public.ir_profiles where id::text like '82000000-%';
update public.ir_profiles set role='admin' where id='82000000-0000-4000-8000-000000000001';
insert into public.ir_account_onboarding(user_id,account_type,completed_at) values
 ('82000000-0000-4000-8000-000000000002','buyer',now()),
 ('82000000-0000-4000-8000-000000000003','seller',now()),
 ('82000000-0000-4000-8000-000000000004','seller',now()),
 ('82000000-0000-4000-8000-000000000005','buyer',null);
insert into public.ir_seller_applications(user_id,legal_name,business_name,address) values
 ('82000000-0000-4000-8000-000000000003','Seller test','','Test address, Malta'),
 ('82000000-0000-4000-8000-000000000004','Business test','Example test company','Test address, Malta');
insert into public.ir_documents(id,user_id,kind,path,mime,size,created_at)
select id,id,'identity','staff-decisions-test/'||id::text||'.pdf','application/pdf',100,now()-interval '1 hour'
from public.ir_profiles where id::text like '82000000-%' and role<>'admin';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"82000000-0000-4000-8000-000000000002","session_id":"82000000-0000-4000-8000-000000000002","aal":"aal1"}',true);
select pg_temp.expect_decision_error('Verified administrator required','82000000-0000-4000-8000-000000000002','verify_buyer');
select set_config('request.jwt.claims','{"sub":"82000000-0000-4000-8000-000000000001","session_id":"82000000-0000-4000-8000-000000000001","aal":"aal1"}',true);
select pg_temp.expect_decision_error('User not found','82000000-0000-4000-8000-000000000099','verify_buyer');
select pg_temp.expect_decision_error('Choose a supported account decision','82000000-0000-4000-8000-000000000002','make_admin');
select pg_temp.expect_decision_error('Confirm that you reviewed the identity evidence','82000000-0000-4000-8000-000000000002','verify_buyer',null,null,null,false);
select pg_temp.expect_decision_error('Choose an identity document submitted by this user','82000000-0000-4000-8000-000000000002','verify_buyer','82000000-0000-4000-8000-000000000003','new');
select pg_temp.expect_decision_error('Confirm whether this person already has a verified account','82000000-0000-4000-8000-000000000002','verify_buyer','82000000-0000-4000-8000-000000000002');
select pg_temp.expect_decision_error('Choose an already verified account for the same person','82000000-0000-4000-8000-000000000002','verify_buyer','82000000-0000-4000-8000-000000000002','linked','82000000-0000-4000-8000-000000000003');
select pg_temp.expect_decision_error('The user must verify their email first','82000000-0000-4000-8000-000000000005','verify_buyer');
select pg_temp.expect_decision_error('You cannot change your own account access','82000000-0000-4000-8000-000000000001','suspend');
select pg_temp.expect_decision_error('Confirm the account access change','82000000-0000-4000-8000-000000000002','suspend',null,null,null,false);
select pg_temp.expect_decision_error('Business documentation is required for this seller','82000000-0000-4000-8000-000000000004','approve_seller','82000000-0000-4000-8000-000000000004','new');

-- A request for changes is visible in the directory and not an approval.
select public.ir_staff_user_decision('82000000-0000-4000-8000-000000000002','request_buyer_changes','Please send a clearer identity document.','82000000-0000-4000-8000-000000000011');
do $$ declare u jsonb; begin
 select value into u from jsonb_array_elements(public.ir_admin_users()) where value->>'id'='82000000-0000-4000-8000-000000000002';
 perform pg_temp.check_true((u->>'identity_changes_requested')::boolean,'changes requested visible');
 perform pg_temp.check_true(not (u->>'identity_approved')::boolean,'request changes does not approve');
 perform pg_temp.check_true(u->'last_staff_decision'->>'action'='request_buyer_changes','latest staff decision in directory');
end $$;
select public.ir_staff_user_decision('82000000-0000-4000-8000-000000000003','approve_seller','Reviewed seller identity and application.','82000000-0000-4000-8000-000000000012','82000000-0000-4000-8000-000000000003','new',null,true);
select public.ir_staff_user_decision('82000000-0000-4000-8000-000000000002','verify_buyer','Reviewed ID: same person as seller.','82000000-0000-4000-8000-000000000013','82000000-0000-4000-8000-000000000002','linked','82000000-0000-4000-8000-000000000003',true);
-- Retrying the same decision does not duplicate its audit or notification.
select public.ir_staff_user_decision('82000000-0000-4000-8000-000000000002','verify_buyer','Reviewed ID: same person as seller.','82000000-0000-4000-8000-000000000013','82000000-0000-4000-8000-000000000002','linked','82000000-0000-4000-8000-000000000003',true);
do $$ begin
 begin perform public.ir_staff_user_decision('82000000-0000-4000-8000-000000000002','suspend','Different action must not reuse key.','82000000-0000-4000-8000-000000000013'); raise exception 'FAIL: decision key reused';
 exception when raise_exception then if sqlerrm<>'Decision reference already used; refresh and try again' then raise; end if; end;
end $$;
select pg_temp.expect_decision_error('Keep the existing verified identity for this account','82000000-0000-4000-8000-000000000002','verify_buyer','82000000-0000-4000-8000-000000000002','new');
select pg_temp.check_true(jsonb_array_length(public.ir_admin_identity_matches('staff-decisions-seller','82000000-0000-4000-8000-000000000002'))=1,'verified account search finds existing seller');
select pg_temp.check_true(public.ir_admin_identity_matches('staff-decisions-seller','82000000-0000-4000-8000-000000000003')='[]'::jsonb,'identity search excludes selected user');
select pg_temp.check_true(public.ir_admin_identity_matches('s','82000000-0000-4000-8000-000000000002')='[]'::jsonb,'short searches return no private records');
select pg_temp.expect_decision_error('Identity already approved; use suspension if access must be stopped','82000000-0000-4000-8000-000000000002','request_buyer_changes');
select pg_temp.expect_decision_error('Seller already approved; use suspension if access must be stopped','82000000-0000-4000-8000-000000000003','reject_seller');
select public.ir_staff_user_decision('82000000-0000-4000-8000-000000000004','request_seller_changes','Please supply business documents.','82000000-0000-4000-8000-000000000014');
select public.ir_staff_user_decision('82000000-0000-4000-8000-000000000004','reject_seller','Application not accepted after review.','82000000-0000-4000-8000-000000000015');
select public.ir_staff_user_decision('82000000-0000-4000-8000-000000000002','suspend','Paused pending staff review.','82000000-0000-4000-8000-000000000016',null,null,null,true);
select pg_temp.expect_decision_error('Reinstate the account before approving it','82000000-0000-4000-8000-000000000002','verify_buyer');
reset role;
select pg_temp.check_true((select suspended from public.ir_profiles where id='82000000-0000-4000-8000-000000000002'),'suspension persisted');
select pg_temp.check_true((select count(*)=1 from public.ir_audit where detail->>'decision_id'='82000000-0000-4000-8000-000000000013'),'single approval audit record');
select pg_temp.check_true((select count(*)=1 from public.ir_notifications where dedupe_key='staff-user:82000000-0000-4000-8000-000000000002:82000000-0000-4000-8000-000000000013'),'single notification for retry');
select pg_temp.check_true((select count(distinct identity_fingerprint)=1 and count(*)=2 from ir_private.identity_links where user_id in ('82000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000003')),'related identity shared privately');
select pg_temp.check_true(not exists(select 1 from ir_private.identity_links where user_id='82000000-0000-4000-8000-000000000004'),'rejected seller is not verified');
update auth.users set email_confirmed_at=now() where id='82000000-0000-4000-8000-000000000005';
set local role authenticated;
select pg_temp.expect_decision_error('The user must finish the relevant account setup first','82000000-0000-4000-8000-000000000005','verify_buyer');
select public.ir_staff_user_decision('82000000-0000-4000-8000-000000000002','reinstate','Review completed. Account restored.','82000000-0000-4000-8000-000000000017',null,null,null,true);
reset role;
select pg_temp.check_true((select not suspended from public.ir_profiles where id='82000000-0000-4000-8000-000000000002'),'reinstatement persisted');
insert into public.ir_auctions(id,seller_id,title,description,category,location,start_price,current_bid,end_at,status) values
 ('82000000-0000-4000-8000-000000000020','82000000-0000-4000-8000-000000000003','Staff workflow test lot','Fictional transactional test, always rolled back.','Collectables','Malta',100,100,now()+interval '2 days','live');
update ir_private.settings set trading_enabled=true;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"82000000-0000-4000-8000-000000000002","session_id":"82000000-0000-4000-8000-000000000002","aal":"aal1"}',true);
do $$ begin
 begin perform public.ir_admin_identity_matches('staff-decisions',auth.uid()); raise exception 'FAIL: member searched identities';
 exception when raise_exception then if sqlerrm<>'Verified administrator required' then raise; end if; end;
end $$;
do $$ declare result jsonb; begin
 result:=public.ir_submit_bid('82000000-0000-4000-8000-000000000020',100,gen_random_uuid());
 perform pg_temp.check_true(result->>'error'='Linked seller accounts cannot bid','linked account bidding blocked');
end $$;
reset role;
-- A separately reviewed buyer can actually bid after approval.
update public.ir_account_onboarding set completed_at=now() where user_id='82000000-0000-4000-8000-000000000005';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"82000000-0000-4000-8000-000000000001","session_id":"82000000-0000-4000-8000-000000000001","aal":"aal1"}',true);
select public.ir_staff_user_decision('82000000-0000-4000-8000-000000000005','verify_buyer','Identity reviewed for independent buyer.','82000000-0000-4000-8000-000000000018','82000000-0000-4000-8000-000000000005','new',null,true);
select set_config('request.jwt.claims','{"sub":"82000000-0000-4000-8000-000000000005","session_id":"82000000-0000-4000-8000-000000000005","aal":"aal1"}',true);
do $$ declare result jsonb; begin
 result:=public.ir_submit_bid('82000000-0000-4000-8000-000000000020',100,gen_random_uuid());
 perform pg_temp.check_true(not (result ? 'error'),'approved independent buyer can bid');
end $$;
reset role;
select pg_temp.check_true((select highest_bidder_id='82000000-0000-4000-8000-000000000005' from public.ir_auctions where id='82000000-0000-4000-8000-000000000020'),'bid persisted for independently approved buyer');
delete from auth.sessions where id='82000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"82000000-0000-4000-8000-000000000001","session_id":"82000000-0000-4000-8000-000000000001","aal":"aal1"}',true);
select pg_temp.expect_decision_error('Verified administrator required','82000000-0000-4000-8000-000000000002','suspend');
reset role;
select pg_temp.check_true(not has_function_privilege('anon','public.ir_staff_user_decision(uuid,text,text,uuid,uuid,text,uuid,boolean)','execute'),'anonymous decisions forbidden');
select pg_temp.check_true(not has_function_privilege('anon','public.ir_admin_identity_matches(text,uuid)','execute'),'anonymous identity searches forbidden');
select 'Staff decision guards, evidence ownership, setup gates, requests, notifications, idempotency, identity links, self-bid safeguards, suspension and revoked sessions passed' as result;
rollback;
