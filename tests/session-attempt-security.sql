begin;
create function pg_temp.assert_true(ok boolean,message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %',message; end if; end $$;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('60000000-0000-4000-8000-000000000001','ir-session-test@example.invalid',now(),'{"name":"Session test"}');
insert into auth.sessions(id,user_id,created_at,updated_at) values('60000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001',now(),now());
select pg_temp.assert_true(not has_function_privilege('authenticated','public.ir_bid(uuid,numeric,uuid)','EXECUTE'),'legacy bid cannot bypass attempt limiter');
insert into public.ir_account_onboarding(user_id,account_type,completed_at)
select id,t,now() from public.ir_profiles cross join (values ('buyer'),('seller')) roles(t) where id::text like '60000000-%';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-000000000001","session_id":"60000000-0000-4000-8000-000000000002","aal":"aal1"}',true);
select pg_temp.assert_true((select count(*)=1 from public.ir_profiles),'active session reads its own profile');
do $$ declare result jsonb; begin
 for i in 1..30 loop
 result:=public.ir_submit_bid('60000000-0000-4000-8000-000000000099',-1,gen_random_uuid());
 if not result ? 'error' then raise exception 'FAIL: invalid bid accepted'; end if;
 end loop;
 begin perform public.ir_submit_bid('60000000-0000-4000-8000-000000000099',-1,gen_random_uuid()); raise exception 'FAIL: failed attempts not rate limited';
 exception when raise_exception then if sqlerrm<>'Too many requests; please try later' then raise; end if; end;
end $$;
reset role;
select pg_temp.assert_true((select count=30 from ir_private.rate_limits where user_id='60000000-0000-4000-8000-000000000001' and action='bid_attempt'),'failed-attempt counter persists');
delete from auth.sessions where id='60000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.assert_true((select count(*)=0 from public.ir_profiles),'revoked session cannot read private rows');
do $$ begin
 begin perform public.ir_submit_bid('60000000-0000-4000-8000-000000000099',100,gen_random_uuid()); raise exception 'FAIL: revoked session can mutate';
 exception when raise_exception then if sqlerrm<>'Verified, active account required' then raise; end if; end;
end $$;
reset role;
insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values('60000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001',now(),now(),now()-interval '1 second');
set local role authenticated;
select pg_temp.assert_true(not ir_private.session_active(),'expired session rejected before asynchronous cleanup');
select 'Session revocation and persistent failed-bid rate-limit assertions passed' as result;
rollback;
