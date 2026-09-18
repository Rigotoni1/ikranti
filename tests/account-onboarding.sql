begin;
create function pg_temp.assert_true(ok boolean,message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %',message; end if; end $$;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('70000000-0000-4000-8000-000000000001','role-test@example.invalid',now(),'{"name":"Role test"}'),
 ('70000000-0000-4000-8000-000000000003','other-role-test@example.invalid',now(),'{"name":"Other role test"}');
insert into auth.sessions(id,user_id,created_at,updated_at) values('70000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000001',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"70000000-0000-4000-8000-000000000001","session_id":"70000000-0000-4000-8000-000000000002","aal":"aal1"}',true);
do $$ begin
 begin perform public.ir_switch_account('seller'); raise exception 'FAIL: unfinished seller unlocked'; exception when raise_exception then if sqlerrm<>'Complete seller onboarding first' then raise; end if; end;
 begin perform public.ir_submit_bid(gen_random_uuid(),100,gen_random_uuid()); raise exception 'FAIL: unfinished buyer can bid'; exception when raise_exception then if sqlerrm<>'Complete buyer onboarding first' then raise; end if; end;
 begin perform public.ir_verify_buyer(auth.uid(),'test-identity','test review'); raise exception 'FAIL: self verification'; exception when raise_exception then if sqlerrm<>'Verified administrator required' then raise; end if; end;
end $$;
select public.ir_save_onboarding('buyer','{"legal_name":"Test Buyer","phone":"+356 12345678","country":"Malta","address":"123 Test Street, Malta","adult":"true","role":"admin","verified":true}',3,true);
select pg_temp.assert_true((select active_account='buyer' from public.ir_profiles where id=auth.uid()),'buyer activated');
select pg_temp.assert_true((select not details ? 'role' and not details ? 'verified' from public.ir_account_onboarding where user_id=auth.uid()),'privilege fields discarded');
select public.ir_save_onboarding('seller','{"legal_name":"Test Seller"}',1,false);
select pg_temp.assert_true((select active_account='buyer' from public.ir_profiles where id=auth.uid()),'seller draft does not switch role');
do $$ begin
 begin perform public.ir_save_onboarding('seller','{"legal_name":"Test Seller","phone":"+356 12345678","country":"Malta","address":"123 Test Street, Malta","adult":"true"}',3,true); raise exception 'FAIL: seller without documents'; exception when raise_exception then if sqlerrm<>'Upload private identity evidence' then raise; end if; end;
end $$;
select pg_temp.assert_true(not has_function_privilege('authenticated','ir_private.ir_submit_bid(uuid,numeric,uuid)','execute'),'no legacy bid bypass');
select pg_temp.assert_true(not has_function_privilege('authenticated','ir_private.ir_create_listing(text,text,text,text,numeric,numeric,timestamptz)','execute'),'no listing bypass');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.ir_account_onboarding','insert'),'no direct onboarding writes');
reset role;
insert into public.ir_documents(user_id,kind,path,mime,size) values('70000000-0000-4000-8000-000000000001','identity','role-test-private-evidence','application/pdf',100);
set local role authenticated;
select public.ir_save_onboarding('seller','{"legal_name":"Test Seller","phone":"+356 12345678","country":"Malta","address":"123 Test Street, Malta","adult":"true"}',3,true);
select pg_temp.assert_true((select active_account='seller' and seller_status='pending' from public.ir_profiles where id=auth.uid()),'seller setup does not grant approval');
select public.ir_switch_account('buyer');
select pg_temp.assert_true((select active_account='buyer' from public.ir_profiles where id=auth.uid()),'completed accounts can switch');
reset role;
insert into public.ir_account_onboarding(user_id,account_type) values('70000000-0000-4000-8000-000000000003','buyer');
set local role authenticated;
select pg_temp.assert_true((select count(*)=2 from public.ir_account_onboarding),'other account onboarding is private');
reset role;
delete from auth.sessions where id='70000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.assert_true((select count(*)=0 from public.ir_account_onboarding),'revoked sessions cannot read onboarding');
select 'Account onboarding, role isolation and privacy assertions passed' as result;
rollback;
