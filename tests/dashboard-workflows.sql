-- Run after dashboard_workflows migration. Fixtures are always rolled back.
begin;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('81000000-0000-4000-8000-000000000001','dashboard-admin@example.invalid',now(),'{"name":"Staff test"}'),
 ('81000000-0000-4000-8000-000000000002','dashboard-seller@example.invalid',now(),'{"name":"Seller test"}');
insert into auth.sessions(id,user_id,created_at,updated_at) values
 ('81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',now(),now()),
 ('81000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000002',now(),now());
update public.ir_profiles set role='admin' where id='81000000-0000-4000-8000-000000000001';
update public.ir_profiles set seller_status='approved' where id='81000000-0000-4000-8000-000000000002';
insert into public.ir_account_onboarding(user_id,account_type,completed_at) values
 ('81000000-0000-4000-8000-000000000002','buyer',now()),
 ('81000000-0000-4000-8000-000000000002','seller',now());
insert into public.ir_auctions(id,seller_id,title,description,category,location,start_price,reserve_price,current_bid,end_at,status,image_path) values
 ('81000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000002','Review test listing','A sufficiently long description for testing.','Collectables','Malta',100,0,100,now()+interval '7 days','under_review','test/photo.jpg');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000001","session_id":"81000000-0000-4000-8000-000000000001","aal":"aal1"}',true);
do $$ declare u jsonb; begin
 select value into u from jsonb_array_elements(public.ir_admin_users()) where value->>'id'='81000000-0000-4000-8000-000000000002';
 if not (u->>'buyer_role')::boolean or not (u->>'seller_role')::boolean or not (u->>'email_verified')::boolean or (u->>'identity_approved')::boolean then raise exception 'Distinct user statuses incorrect'; end if;
 if jsonb_array_length(public.ir_admin_user_detail('81000000-0000-4000-8000-000000000002')->'onboarding')<>2 then raise exception 'Both roles must share one profile'; end if;
end $$;
select public.ir_admin_action('request_listing_changes','81000000-0000-4000-8000-000000000003','Photograph unclear. Please replace it.');
reset role;
do $$ begin
 if (select status from public.ir_auctions where id='81000000-0000-4000-8000-000000000003')<>'changes_requested' then raise exception 'Review state not saved'; end if;
 if not exists(select 1 from public.ir_notifications where user_id='81000000-0000-4000-8000-000000000002' and kind='listing_review') then raise exception 'Seller notification missing'; end if;
 if exists(select 1 from public.ir_public_auctions where id='81000000-0000-4000-8000-000000000003') then raise exception 'Private submission exposed'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000002","session_id":"81000000-0000-4000-8000-000000000002","aal":"aal1"}',true);
do $$ begin
 begin perform public.ir_admin_users(); raise exception 'FAIL member directory access'; exception when raise_exception then if sqlerrm<>'Verified administrator required' then raise; end if; end;
 begin perform public.ir_admin_user_detail('81000000-0000-4000-8000-000000000001'); raise exception 'FAIL member profile access'; exception when raise_exception then if sqlerrm<>'Verified administrator required' then raise; end if; end;
 begin perform public.ir_admin_action('approve_listing','81000000-0000-4000-8000-000000000003','Not permitted'); raise exception 'FAIL member review access'; exception when raise_exception then if sqlerrm<>'Verified administrator required' then raise; end if; end;
end $$;
select public.ir_edit_listing('81000000-0000-4000-8000-000000000003','Updated test listing','A sufficiently long updated description.','Collectables','Malta',100,0,now()+interval '7 days');
reset role;
do $$ begin
 if (select status from public.ir_auctions where id='81000000-0000-4000-8000-000000000003')<>'under_review' then raise exception 'Resubmission failed'; end if;
 if has_function_privilege('anon','public.ir_admin_users()','execute') then raise exception 'Anonymous access granted'; end if;
end $$;
select 'Unified roles, distinct statuses, admin isolation, request changes, seller notice and resubmission passed' as result;
rollback;
