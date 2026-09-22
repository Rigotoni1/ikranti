-- Run with the bid_chat_history migration, in one transaction. Never leaves test bids/accounts behind.
begin;
create function pg_temp.check_bid_chat(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',message; end if; end $$;
create function pg_temp.chat_claim(n integer) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims',jsonb_build_object('sub','84000000-0000-4000-8000-'||lpad(n::text,12,'0'),'session_id','84000000-0000-4000-8000-'||lpad(n::text,12,'0'),'aal','aal1')::text,true); end $$;
create function pg_temp.chat_bid(n integer,amount numeric,request_number integer) returns jsonb language plpgsql as $$
declare result jsonb;
begin
 perform pg_temp.chat_claim(n);
 result:=public.ir_submit_bid('84000000-0000-4000-8000-000000000010',amount,('84000000-0000-4000-8001-'||lpad(request_number::text,12,'0'))::uuid);
 if result ? 'error' then raise exception 'FAIL: bid rejected: %',result; end if;
 return result;
end $$;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('84000000-0000-4000-8000-000000000001','bid-chat-seller@example.invalid',now(),'{"name":"Chat test seller"}'),
 ('84000000-0000-4000-8000-000000000002','bid-chat-a@example.invalid',now(),'{"name":"Chat test A"}'),
 ('84000000-0000-4000-8000-000000000003','bid-chat-b@example.invalid',now(),'{"name":"Chat test B"}');
insert into auth.sessions(id,user_id,created_at,updated_at)
select id,id,now(),now() from public.ir_profiles where id::text like '84000000-%';
insert into public.ir_account_onboarding(user_id,account_type,completed_at)
select id,'buyer',now() from public.ir_profiles where id::text like '84000000-%';
insert into ir_private.identity_links(user_id,identity_fingerprint)
select id,'bid-chat-test-'||id from public.ir_profiles where id::text like '84000000-%';
update public.ir_profiles set seller_status='approved' where id='84000000-0000-4000-8000-000000000001';
update ir_private.settings set trading_enabled=true;
insert into public.ir_auctions(id,seller_id,title,description,category,location,start_price,current_bid,reserve_price,end_at,status) values
 ('84000000-0000-4000-8000-000000000010','84000000-0000-4000-8000-000000000001','Bid chat test','Rolled-back fictional fixture only.','Collectables','Malta',100,100,900,now()+interval '1 minute','live'),
 ('84000000-0000-4000-8000-000000000011','84000000-0000-4000-8000-000000000001','Legacy chat test','Rolled-back fictional fixture only.','Collectables','Malta',100,250,0,now()+interval '1 day','live'),
 ('84000000-0000-4000-8000-000000000012','84000000-0000-4000-8000-000000000001','Private chat test','Rolled-back fictional fixture only.','Collectables','Malta',100,100,0,now()+interval '1 day','under_review');
select pg_temp.check_bid_chat(not has_table_privilege('authenticated','ir_private.bid_chat_events','SELECT'),'raw bidder IDs inaccessible');
select pg_temp.check_bid_chat(not has_table_privilege('anon','ir_private.bid_chat_events','SELECT'),'raw ledger inaccessible to guests');
select pg_temp.check_bid_chat(not has_table_privilege('authenticated','ir_private.bid_chat_events','INSERT'),'users cannot fabricate history');
select pg_temp.check_bid_chat(not has_function_privilege('authenticated','public.ir_bid(uuid,numeric,uuid)','EXECUTE'),'cannot bypass onboarding wrapper');
set local role anon;
select set_config('request.jwt.claims','{}',true);
select pg_temp.check_bid_chat(public.ir_bid_history('84000000-0000-4000-8000-000000000010')->'entries'='[]'::jsonb,'empty history');
do $$ begin
 begin perform public.ir_bid_history('84000000-0000-4000-8000-000000000012'); raise exception 'FAIL: exposed unapproved lot';
 exception when raise_exception then if sqlerrm<>'Auction not available' then raise; end if; end;
end $$;
reset role;
set local role authenticated;
select pg_temp.chat_bid(2,500,1);
select pg_temp.chat_bid(2,500,1);
select pg_temp.check_bid_chat(jsonb_array_length(public.ir_bid_history('84000000-0000-4000-8000-000000000010')->'entries')=1,'retry creates exactly one visible bid');
select pg_temp.chat_bid(2,600,2);
select pg_temp.check_bid_chat(jsonb_array_length(public.ir_bid_history('84000000-0000-4000-8000-000000000010')->'entries')=1,'leader maximum increase stays private');
select pg_temp.chat_bid(3,200,3);
do $$ declare h jsonb; begin
 h:=public.ir_bid_history('84000000-0000-4000-8000-000000000010');
 perform pg_temp.check_bid_chat(jsonb_array_length(h->'entries')=3,'submitted bid followed by automatic counterbid');
 perform pg_temp.check_bid_chat(h->'entries'->1->>'amount'='200.00' and (h->'entries'->1->>'is_mine')::boolean,'losing submission is Your Bid at the reached price');
 perform pg_temp.check_bid_chat((h->'entries'->2->>'amount')::numeric=225 and not (h->'entries'->2->>'is_mine')::boolean,'defending bid belongs to the other bidder');
 perform pg_temp.check_bid_chat(h->'entries'->2->>'kind'='automatic' and (h->'entries'->2->>'is_leading')::boolean,'automatic reply leads at the bottom');
 perform pg_temp.check_bid_chat(not (h->'auction'->>'viewer_leading')::boolean and not (h->'auction'->>'reserve_met')::boolean,'outbid and reserve state are distinct');
 perform pg_temp.check_bid_chat((h->'auction'->>'end_at')::timestamptz>now()+interval '110 seconds','anti-sniping retained');
 perform pg_temp.check_bid_chat(not exists(select 1 from jsonb_array_elements(h->'entries') e where (e->>'amount')::numeric in (500,600,900)),'unspent maximums and reserve values stay hidden');
 perform pg_temp.check_bid_chat(h::text not like '%user_id%' and h::text not like '%84000000-0000-4000-8000-000000000002%' and h::text not like '%Chat test%' and h::text not like '%@example.invalid%','names/emails/other profile IDs stay private');
end $$;
select pg_temp.chat_bid(3,600,4);
do $$ declare h jsonb; begin
 h:=public.ir_bid_history('84000000-0000-4000-8000-000000000010');
 perform pg_temp.check_bid_chat((h->'entries'->3->>'amount')::numeric=600 and (h->'entries'->4->>'amount')::numeric=600,'equal bid amounts are shown in stable order');
 perform pg_temp.check_bid_chat(h->'entries'->4->>'kind'='priority' and (h->'entries'->4->>'is_leading')::boolean,'earlier bidder retains tie priority');
end $$;
select pg_temp.chat_bid(3,800,5);
select pg_temp.chat_bid(2,1000,6);
do $$ declare h jsonb; earlier jsonb; begin
 h:=public.ir_bid_history('84000000-0000-4000-8000-000000000010',null,2);
 perform pg_temp.check_bid_chat((h->'entries'->0->>'amount')::numeric=800 and h->'entries'->0->>'kind'='automatic','defending proxy reaches its public price before being beaten');
 perform pg_temp.check_bid_chat((h->'entries'->1->>'amount')::numeric=825 and (h->'entries'->1->>'is_mine')::boolean,'new leader pays only the needed amount');
 perform pg_temp.check_bid_chat((h->>'has_more')::boolean,'history paginates');
 earlier:=public.ir_bid_history('84000000-0000-4000-8000-000000000010',(h->>'next_before')::bigint,100);
 perform pg_temp.check_bid_chat(jsonb_array_length(earlier->'entries')=6 and not (earlier->>'has_more')::boolean,'all earlier bids retrievable without duplicates');
 perform pg_temp.check_bid_chat(not exists(select 1 from jsonb_array_elements(earlier->'entries') e where (e->>'is_leading')::boolean),'old messages do not retain a leading badge');
 perform pg_temp.check_bid_chat(h->'auction'->>'bid_count'='6','submission count remains distinct from chat event count');
 perform pg_temp.check_bid_chat(public.ir_submit_bid('84000000-0000-4000-8000-000000000010',50,gen_random_uuid()) ? 'error','invalid bid is rejected');
end $$;
reset role;
select pg_temp.check_bid_chat((select count(*)=8 from ir_private.bid_chat_events where auction_id='84000000-0000-4000-8000-000000000010'),'failed bid creates no chat message');
update public.ir_auctions set highest_bidder_id='84000000-0000-4000-8000-000000000002',bid_count=3 where id='84000000-0000-4000-8000-000000000011';
insert into public.ir_max_bids(auction_id,user_id,amount) values('84000000-0000-4000-8000-000000000011','84000000-0000-4000-8000-000000000002',700);
set local role authenticated;
select pg_temp.check_bid_chat(public.ir_bid_history('84000000-0000-4000-8000-000000000011')->'snapshot'->>'kind'='snapshot','legacy history honestly shows current snapshot');
select pg_temp.chat_claim(3);
select public.ir_submit_bid('84000000-0000-4000-8000-000000000011',300,gen_random_uuid());
do $$ declare h jsonb; begin
 h:=public.ir_bid_history('84000000-0000-4000-8000-000000000011');
 perform pg_temp.check_bid_chat(jsonb_array_length(h->'entries')=3 and h->'entries'->0->>'kind'='snapshot','legacy snapshot then accurate new sequence');
 perform pg_temp.check_bid_chat(h->'entries'->0->>'created_at' is null,'no fabricated timestamp for legacy snapshot');
 perform pg_temp.check_bid_chat((h->'entries'->2->>'amount')::numeric=325,'new legacy-lot counterbid correct');
end $$;
reset role;
set local role anon;
select set_config('request.jwt.claims','{}',true);
select pg_temp.check_bid_chat(not exists(select 1 from jsonb_array_elements(public.ir_bid_history('84000000-0000-4000-8000-000000000010')->'entries') e where (e->>'is_mine')::boolean),'anonymous viewer never receives Your Bid labels');
reset role;
update public.ir_profiles set suspended=true where id='84000000-0000-4000-8000-000000000003';
set local role authenticated;
select pg_temp.chat_claim(3);
do $$ begin
 begin perform public.ir_bid_history('84000000-0000-4000-8000-000000000010'); raise exception 'FAIL: suspended session personalized history';
 exception when raise_exception then if sqlerrm<>'Verified, active account required' then raise; end if; end;
end $$;
reset role;
delete from auth.sessions where user_id='84000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.chat_claim(2);
do $$ begin
 begin perform public.ir_bid_history('84000000-0000-4000-8000-000000000010'); raise exception 'FAIL: revoked session personalized history';
 exception when raise_exception then if sqlerrm<>'Verified, active account required' then raise; end if; end;
end $$;
reset role;
select 'Bid chat: proxy order, ties, new leaders, idempotency, pagination, privacy, legacy snapshots and revoked/suspended sessions passed' as result;
rollback;
