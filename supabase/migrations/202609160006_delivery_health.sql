alter table public.ir_notifications add column email_first_attempt timestamptz;
create or replace function public.ir_claim_email_batch() returns table(id uuid,email text,kind text,message text,lease uuid) language sql security definer set search_path='' as $$
 with candidates as (
 select n.id from public.ir_notifications n where ((n.email_status='pending' and n.email_next_attempt<=now()) or (n.email_status='sending' and n.email_leased_at<now()-interval '10 minutes')) and n.email_attempts<8 and (n.email_first_attempt is null or n.email_first_attempt>now()-interval '23 hours') order by n.created_at limit 5 for update skip locked
 ), claimed as (
 update public.ir_notifications n set email_status='sending',email_attempts=email_attempts+1,email_lease=gen_random_uuid(),email_leased_at=now(),email_first_attempt=coalesce(n.email_first_attempt,now()) from candidates c where n.id=c.id returning n.*
 ) select c.id,u.email,c.kind,c.message,c.email_lease from claimed c join auth.users u on u.id=c.user_id where u.email_confirmed_at is not null
$$;
create function public.ir_delivery_health() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not ir_private.admin() then raise exception 'Administrator with two-factor authentication required'; end if;
 return jsonb_build_object('pending',(select count(*) from public.ir_notifications where email_status='pending'),'sending',(select count(*) from public.ir_notifications where email_status='sending'),'sent',(select count(*) from public.ir_notifications where email_status='sent'),'failed',(select count(*) from public.ir_notifications where email_status='failed' or (email_status<>'sent' and email_first_attempt<=now()-interval '23 hours')));
end $$;
revoke all on function public.ir_delivery_health() from public,anon;
grant execute on function public.ir_delivery_health() to authenticated;
