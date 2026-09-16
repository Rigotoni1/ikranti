begin;
create function pg_temp.bid(a uuid,m numeric,r uuid) returns jsonb language plpgsql as $$ declare result jsonb; begin result:=public.ir_submit_bid(a,m,r); if result ? 'error' then raise exception '%',result->>'error'; end if; return result; end $$;
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %',message; end if; end $$;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('40000000-0000-4000-8000-000000000001','ir-abuse-seller@example.invalid',now(),'{"name":"Seller"}'),
 ('40000000-0000-4000-8000-000000000002','ir-abuse-buyer@example.invalid',now(),'{"name":"Buyer"}'),
 ('40000000-0000-4000-8000-000000000003','ir-abuse-other@example.invalid',now(),'{"name":"Unverified identity"}');
insert into auth.sessions(id,user_id,created_at,updated_at) select id,id,now(),now() from auth.users where email like 'ir-test-%@example.invalid' or email like 'ir-abuse-%@example.invalid';
update public.ir_profiles set seller_status='approved' where id='40000000-0000-4000-8000-000000000001';
insert into ir_private.identity_links values('40000000-0000-4000-8000-000000000001','shared-fingerprint'),('40000000-0000-4000-8000-000000000002','shared-fingerprint');
insert into public.ir_auctions(id,seller_id,title,description,category,location,start_price,reserve_price,current_bid,end_at,status) values
 ('50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','Abuse prevention auction','A sufficiently long test description.','Collectables','Malta',100,0,100,now()+interval '1 hour','live');
update ir_private.settings set trading_enabled=true;
insert into public.ir_account_onboarding(user_id,account_type,completed_at)
select id,t,now() from public.ir_profiles cross join (values ('buyer'),('seller')) roles(t) where id::text like '40000000-%';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"40000000-0000-4000-8000-000000000001","session_id":"40000000-0000-4000-8000-000000000001","aal":"aal1"}',true);
do $$ begin
 begin perform pg_temp.bid('50000000-0000-4000-8000-000000000001',100,gen_random_uuid()); raise exception 'FAIL: self bid'; exception when raise_exception then if sqlerrm like 'FAIL:%' or sqlerrm<>'You cannot bid on your own auction' then raise; end if; end;
end $$;
select set_config('request.jwt.claims','{"sub":"40000000-0000-4000-8000-000000000002","session_id":"40000000-0000-4000-8000-000000000002","aal":"aal1"}',true);
do $$ begin
 begin perform pg_temp.bid('50000000-0000-4000-8000-000000000001',100,gen_random_uuid()); raise exception 'FAIL: linked bid'; exception when raise_exception then if sqlerrm like 'FAIL:%' or sqlerrm<>'Linked seller accounts cannot bid' then raise; end if; end;
 begin perform public.ir_claim_admin(); raise exception 'FAIL: claimed admin without MFA'; exception when raise_exception then if sqlerrm like 'FAIL:%' or sqlerrm<>'Two-factor authentication required' then raise; end if; end;
 begin perform public.ir_register_document(null,'identity','40000000-0000-4000-8000-000000000001/stolen.pdf','application/pdf',100); raise exception 'FAIL: forged document'; exception when raise_exception then if sqlerrm like 'FAIL:%' or sqlerrm<>'Uploaded document not found' then raise; end if; end;
end $$;
select set_config('request.jwt.claims','{"sub":"40000000-0000-4000-8000-000000000002","session_id":"40000000-0000-4000-8000-000000000002","aal":"aal2"}',true);
do $$ begin
 begin perform public.ir_claim_admin(); raise exception 'FAIL: uninvited administrator'; exception when raise_exception then if sqlerrm like 'FAIL:%' or sqlerrm<>'Administrator invitation required' then raise; end if; end;
end $$;
select set_config('request.jwt.claims','{"sub":"40000000-0000-4000-8000-000000000003","session_id":"40000000-0000-4000-8000-000000000003","aal":"aal1"}',true);
do $$ begin
 begin perform pg_temp.bid('50000000-0000-4000-8000-000000000001',100,gen_random_uuid()); raise exception 'FAIL: no identity verification'; exception when raise_exception then if sqlerrm like 'FAIL:%' or sqlerrm<>'Identity verification required before bidding' then raise; end if; end;
end $$;
reset role;
update ir_private.identity_links set identity_fingerprint='independent-buyer' where user_id='40000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"40000000-0000-4000-8000-000000000002","session_id":"40000000-0000-4000-8000-000000000002","aal":"aal1"}',true);
select public.ir_watch('50000000-0000-4000-8000-000000000001',true);
select public.ir_watch('50000000-0000-4000-8000-000000000001',true);
select pg_temp.assert_true((select count(*)=1 from public.ir_watchlist),'idempotent watch requests');
do $$ begin
 for i in 1..58 loop perform public.ir_watch('50000000-0000-4000-8000-000000000001',true); end loop;
 begin perform public.ir_watch('50000000-0000-4000-8000-000000000001',true); raise exception 'FAIL: no durable rate limit'; exception when raise_exception then if sqlerrm like 'FAIL:%' or sqlerrm<>'Too many requests; please try later' then raise; end if; end;
end $$;
reset role;
select public.ir_maintenance();
select public.ir_maintenance();
select pg_temp.assert_true((select count(*)=1 from public.ir_notifications where dedupe_key='ending:50000000-0000-4000-8000-000000000001:40000000-0000-4000-8000-000000000002'),'ending reminder exactly once');
update ir_private.settings set trading_enabled=false;
set local role authenticated;
do $$ begin
 begin perform pg_temp.bid('50000000-0000-4000-8000-000000000001',100,gen_random_uuid()); raise exception 'FAIL: trading gate bypass'; exception when raise_exception then if sqlerrm like 'FAIL:%' or sqlerrm<>'Trading is not open yet' then raise; end if; end;
end $$;
reset role;
select pg_temp.assert_true(not (select public from storage.buckets where id='ir-private-documents'),'private document bucket');
select pg_temp.assert_true(not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and cmd='INSERT' and qual like '%ir-private-documents%'),'no direct client document inserts');
select 'Abuse prevention, notification and invitation assertions passed' as result;
rollback;
