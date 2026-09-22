begin;
create function pg_temp.check_terms(ok boolean, message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %',message; end if; end $$;
create function pg_temp.expect_terms_error(expected text, details jsonb, account_type text default 'buyer', step integer default 3, complete boolean default false) returns void language plpgsql as $$
begin
 begin perform public.ir_save_onboarding(account_type,details,step,complete);raise exception 'FAIL: request unexpectedly succeeded';
 exception when raise_exception then if sqlerrm<>expected then raise; end if; end;
end $$;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('83000000-0000-4000-8000-000000000001','terms-buyer@example.invalid',now(),'{"name":"Terms Buyer"}'),
 ('83000000-0000-4000-8000-000000000002','terms-other@example.invalid',now(),'{"name":"Terms Other"}'),
 ('83000000-0000-4000-8000-000000000003','terms-admin@example.invalid',now(),'{"name":"Terms Admin"}');
insert into auth.sessions(id,user_id,created_at,updated_at)
 select id,id,now(),now() from auth.users where id in ('83000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000003');
update public.ir_profiles set role='admin' where id='83000000-0000-4000-8000-000000000003';
insert into public.ir_documents(user_id,kind,path,mime,size) values ('83000000-0000-4000-8000-000000000002','identity','terms-other-private-evidence','application/pdf',100);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"83000000-0000-4000-8000-000000000001","session_id":"83000000-0000-4000-8000-000000000001","aal":"aal1"}',true);
select public.ir_save_onboarding('buyer','{"adult":"true","terms_accepted":"true","terms_version":"2026-09-22","role":"admin","accepted_at":"1999-01-01","legal_name":"Terms Buyer"}',1,false);
select pg_temp.check_terms((select count(*)=0 from public.ir_terms_acceptances),'draft does not record consent');
select pg_temp.check_terms((select not details ? 'terms_accepted' and not details ? 'adult' and not details ? 'role' and not details ? 'accepted_at' from public.ir_account_onboarding where user_id=auth.uid()),'discard draft and privilege claims');
select pg_temp.expect_terms_error('Read and accept the current Terms & Conditions to continue','{"adult":"true"}');
select pg_temp.expect_terms_error('Read and accept the current Terms & Conditions to continue','{"terms_accepted":"false","terms_version":"2026-09-22"}');
select pg_temp.expect_terms_error('Read and accept the current Terms & Conditions to continue','{"terms_accepted":"true","terms_version":"old-version"}');
select pg_temp.expect_terms_error('Upload private identity evidence','{"terms_accepted":"true","terms_version":"2026-09-22"}');
select pg_temp.check_terms((select count(*)=0 from public.ir_terms_acceptances),'failed validation does not record consent');
select pg_temp.expect_terms_error('Invalid onboarding request','{}','buyer',null);
select pg_temp.expect_terms_error('Invalid onboarding request','{}','buyer',1,true);
reset role;
insert into public.ir_documents(user_id,kind,path,mime,size) values ('83000000-0000-4000-8000-000000000001','identity','terms-buyer-private-evidence','application/pdf',100);
set local role authenticated;
select public.ir_save_onboarding('buyer','{"terms_accepted":"true","terms_version":"2026-09-22","accepted_at":"1999-01-01","user_id":"83000000-0000-4000-8000-000000000002"}',3,false);
select pg_temp.check_terms((select count(*)=1 and bool_and(user_id=auth.uid() and account_type='buyer' and terms_version='2026-09-22' and terms_path='/terms/2026-09-22' and accepted_at=now()) from public.ir_terms_acceptances),'server identity, version, path and timestamp');
select public.ir_save_onboarding('buyer','{"terms_accepted":"true","terms_version":"2026-09-22","legal_name":"Terms Buyer","phone":"+356 12345678","country":"Malta","address":"123 Test Street, Malta"}',3,true);
select pg_temp.check_terms((select count(*)=1 from public.ir_terms_acceptances),'retry is deduplicated');
select pg_temp.check_terms((select completed_at is not null and not details ? 'adult' from public.ir_account_onboarding where user_id=auth.uid() and account_type='buyer'),'new terms checkbox replaces old age flag');
select pg_temp.check_terms((select role='member' and active_account='buyer' and seller_status='not_started' from public.ir_profiles where id=auth.uid()),'completion does not escalate permissions');
select pg_temp.expect_terms_error('Business registration and evidence required','{"terms_accepted":"true","terms_version":"2026-09-22","business_name":"Test business","registration_number":"TEST123"}','seller');
select pg_temp.check_terms((select count(*)=1 from public.ir_terms_acceptances),'buyer consent not reused for incomplete business seller');
select public.ir_save_onboarding('seller','{"terms_accepted":"true","terms_version":"2026-09-22","legal_name":"Terms Seller","phone":"+356 12345678","country":"Malta","address":"123 Test Street, Malta"}',3,true);
select pg_temp.check_terms((select count(*)=2 from public.ir_terms_acceptances),'separate buyer and seller receipts');
select pg_temp.check_terms(not has_table_privilege('authenticated','public.ir_terms_acceptances','insert') and not has_table_privilege('authenticated','public.ir_terms_acceptances','update') and not has_table_privilege('authenticated','public.ir_terms_acceptances','delete'),'receipts immutable to clients');
select pg_temp.check_terms(not has_table_privilege('anon','public.ir_terms_acceptances','select') and not has_function_privilege('anon','public.ir_save_onboarding(text,jsonb,integer,boolean)','execute'),'anonymous access denied');
select set_config('request.jwt.claims','{"sub":"83000000-0000-4000-8000-000000000002","session_id":"83000000-0000-4000-8000-000000000002","aal":"aal1"}',true);
select pg_temp.check_terms((select count(*)=0 from public.ir_terms_acceptances),'another member cannot read receipts');
select set_config('request.jwt.claims','{"sub":"83000000-0000-4000-8000-000000000003","session_id":"83000000-0000-4000-8000-000000000003","aal":"aal1"}',true);
select pg_temp.check_terms((select count(*)=2 from public.ir_terms_acceptances),'authorised admin can inspect receipts');
reset role;
select pg_temp.check_terms(not exists(select 1 from ir_private.identity_links where user_id='83000000-0000-4000-8000-000000000001'),'onboarding did not approve identity');
update auth.users set email_confirmed_at=null where id='83000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"83000000-0000-4000-8000-000000000002","session_id":"83000000-0000-4000-8000-000000000002","aal":"aal1"}',true);
select pg_temp.expect_terms_error('Verified, active account required','{"terms_accepted":"true","terms_version":"2026-09-22"}');
reset role;
update public.ir_profiles set suspended=true where id='83000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"83000000-0000-4000-8000-000000000001","session_id":"83000000-0000-4000-8000-000000000001","aal":"aal1"}',true);
select pg_temp.expect_terms_error('Verified, active account required','{"terms_accepted":"true","terms_version":"2026-09-22"}');
reset role;
update public.ir_profiles set suspended=false where id='83000000-0000-4000-8000-000000000001';
delete from auth.sessions where id='83000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.check_terms((select count(*)=0 from public.ir_terms_acceptances),'revoked session cannot read receipts');
select pg_temp.expect_terms_error('Verified, active account required','{"terms_accepted":"true","terms_version":"2026-09-22"}');
select 'Terms consent, evidence gates, role isolation and receipt privacy passed' as result;
rollback;
