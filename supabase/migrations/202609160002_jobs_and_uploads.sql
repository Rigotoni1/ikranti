create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('ir-private-documents','ir-private-documents',false,8388608,array['image/jpeg','image/png','application/pdf']),
 ('ir-auction-images','ir-auction-images',true,4194304,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
-- No client INSERT policy: content is checked by the authenticated upload worker.
create policy ir_private_document_read on storage.objects for select to authenticated using(bucket_id='ir-private-documents' and (exists(select 1 from public.ir_documents d where d.path=name and d.user_id=auth.uid()) or ir_private.admin()));
create function public.ir_register_document(p_auction uuid,p_kind text,p_path text,p_mime text,p_size integer) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=ir_private.member(); v uuid; begin
 perform ir_private.limit_action('document',20,86400);
 if p_path not like u::text||'/%' or not exists(select 1 from storage.objects where bucket_id='ir-private-documents' and name=p_path) then raise exception 'Uploaded document not found'; end if;
 if p_auction is not null and not exists(select 1 from public.ir_auctions where id=p_auction and seller_id=u and status='under_review') then raise exception 'Pending listing not found'; end if;
 if (p_kind in ('identity','business')) <> (p_auction is null) then raise exception 'Select the correct document category'; end if;
 insert into public.ir_documents(user_id,auction_id,kind,path,mime,size) values(u,p_auction,p_kind,p_path,p_mime,p_size) returning id into v;
 return v;
end $$;
create function public.ir_register_image(p_auction uuid,p_path text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=ir_private.member(); begin
 perform ir_private.limit_action('image',20,86400);
 if p_path not like u::text||'/%' or not exists(select 1 from storage.objects where bucket_id='ir-auction-images' and name=p_path) then raise exception 'Uploaded image not found'; end if;
 update public.ir_auctions set image_path=p_path where id=p_auction and seller_id=u and status='under_review';
 if not found then raise exception 'Pending listing not found'; end if;
end $$;
create function public.ir_upload_allowance() returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=ir_private.member(); begin
 perform ir_private.limit_action('upload_attempt',30,86400);
 if (select count(*) from storage.objects where bucket_id in ('ir-private-documents','ir-auction-images') and name like u::text||'/%')>=100 then raise exception 'Account upload limit reached'; end if;
end $$;
create function public.ir_maintenance() returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.ir_auctions; order_id uuid; n integer:=0; outcome text; w record;
begin
 for a in select * from public.ir_auctions where status='live' and end_at<=clock_timestamp() for update skip locked loop
 outcome:=case when a.highest_bidder_id is null then 'unsold' when a.current_bid<a.reserve_price then 'reserve_not_met' else 'sold' end;
 -- A suspended seller or winning bidder requires staff intervention, not an order.
 if exists(select 1 from public.ir_profiles where id in (a.seller_id,a.highest_bidder_id) and suspended) then
 outcome:='withdrawn'; insert into public.ir_risk_flags(auction_id,reason) values(a.id,'Auction closed with suspended participant; staff review required');
 end if;
 update public.ir_auctions set status=outcome,version=version+1 where id=a.id;
 if outcome='sold' then
 insert into public.ir_orders(auction_id,seller_id,buyer_id,amount) values(a.id,a.seller_id,a.highest_bidder_id,a.current_bid) on conflict(auction_id) do nothing returning id into order_id;
 perform ir_private.notify(a.highest_bidder_id,'winner','You won '||a.title||'. Review your order before arranging payment.',a.id,'winner:'||a.id);
 end if;
 perform ir_private.notify(a.seller_id,'auction_result',a.title||' closed: '||replace(outcome,'_',' '),a.id,'result:'||a.id);
 n:=n+1;
 end loop;
 for w in select x.user_id,a.id,a.title from public.ir_watchlist x join public.ir_auctions a on a.id=x.auction_id where a.status='live' and a.end_at>clock_timestamp() and a.end_at<=clock_timestamp()+interval '1 hour' loop
 perform ir_private.notify(w.user_id,'ending','Watchlist reminder: '||w.title||' ends within one hour.',w.id,'ending:'||w.id||':'||w.user_id);
 end loop;
 for w in select * from public.ir_orders where status='awaiting_payment' and payment_due_at<=now()+interval '1 day' loop
 perform ir_private.notify(w.buyer_id,'payment_reminder','Your auction order is awaiting payment. Open your account for details.',w.auction_id,'payment:'||w.id||':'||current_date);
 end loop;
 delete from ir_private.rate_limits where window_at<now()-interval '2 days';
 return jsonb_build_object('closed',n);
end $$;
create function public.ir_claim_email_batch() returns table(id uuid,email text,kind text,message text,lease uuid) language sql security definer set search_path='' as $$
 with candidates as (
 select n.id from public.ir_notifications n where ((n.email_status='pending' and n.email_next_attempt<=now()) or (n.email_status='sending' and n.email_leased_at<now()-interval '10 minutes')) and n.email_attempts<8 order by n.created_at limit 25 for update skip locked
 ), claimed as (
 update public.ir_notifications n set email_status='sending',email_attempts=email_attempts+1,email_lease=gen_random_uuid(),email_leased_at=now() from candidates c where n.id=c.id returning n.*
 ) select c.id,u.email,c.kind,c.message,c.email_lease from claimed c join auth.users u on u.id=c.user_id where u.email_confirmed_at is not null
$$;
create function public.ir_finish_email(p_id uuid,p_lease uuid,p_error text default null) returns void language sql security definer set search_path='' as $$
 update public.ir_notifications set email_status=case when p_error is null then 'sent' when email_attempts>=8 then 'failed' else 'pending' end,email_error=left(p_error,500),email_next_attempt=now()+least(interval '6 hours',interval '1 minute'*power(2,email_attempts)),email_lease=null
 where id=p_id and email_lease=p_lease and email_status='sending'
$$;
create function public.ir_worker_auth(p_token text) returns boolean language sql security definer set search_path='' as $$
 select exists(select 1 from vault.decrypted_secrets where name='ir_worker_token' and decrypted_secret=p_token and length(p_token)>40)
$$;
select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'ir_worker_token','Irkanti notification worker authentication');
revoke all on function public.ir_maintenance(),public.ir_claim_email_batch(),public.ir_finish_email(uuid,uuid,text),public.ir_worker_auth(text) from public,anon,authenticated;
grant execute on function public.ir_maintenance(),public.ir_claim_email_batch(),public.ir_finish_email(uuid,uuid,text),public.ir_worker_auth(text) to service_role;
revoke all on function public.ir_register_document(uuid,text,text,text,integer),public.ir_register_image(uuid,text),public.ir_upload_allowance() from public,anon;
grant execute on function public.ir_register_document(uuid,text,text,text,integer),public.ir_register_image(uuid,text),public.ir_upload_allowance() to authenticated;
select cron.schedule('ir-auction-maintenance','* * * * *','select public.ir_maintenance()');
select cron.schedule('ir-email-delivery','* * * * *',$job$
 select net.http_post(url:='https://gjxpgqknuvryjzafbkrc.supabase.co/functions/v1/ir-launch-worker',headers:=jsonb_build_object('Content-Type','application/json','x-worker-token',(select decrypted_secret from vault.decrypted_secrets where name='ir_worker_token')),body:='{"operation":"email"}'::jsonb,timeout_milliseconds:=50000);
$job$);
