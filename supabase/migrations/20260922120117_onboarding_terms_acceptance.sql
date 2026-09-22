-- Acceptance is separate from age declarations and verification approval.
-- Do not backfill acceptance for existing users or rewrite earlier orders.
create table public.ir_terms_acceptances (
 user_id uuid not null references public.ir_profiles(id),
 account_type text not null check(account_type in ('buyer','seller')),
 terms_version text not null,
 terms_path text not null,
 accepted_at timestamptz not null default now(),
 primary key(user_id,account_type,terms_version)
);
alter table public.ir_terms_acceptances enable row level security;
revoke all on public.ir_terms_acceptances from public,anon,authenticated;
grant select on public.ir_terms_acceptances to authenticated;
create policy terms_acceptance_read on public.ir_terms_acceptances for select to authenticated
 using ((user_id=(select auth.uid()) or (select ir_private.admin())) and (select ir_private.session_active()));

create or replace function public.ir_save_onboarding(p_type text,p_details jsonb,p_step integer,p_complete boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=ir_private.member(); d jsonb; current_terms constant text:='2026-09-22';
begin
 if p_type is null or p_type not in ('buyer','seller') or p_step is null or p_step not between 0 and 3
  or p_complete is null or (p_complete and p_step<>3) then raise exception 'Invalid onboarding request'; end if;
 if p_details is null or jsonb_typeof(p_details)<>'object' or octet_length(p_details::text)>8000 then raise exception 'Invalid details'; end if;
 perform ir_private.limit_action('onboarding',30,60);
 -- Serialize onboarding and consent updates for this member, including double submissions.
 perform 1 from public.ir_profiles where id=u for update;
 select coalesce(jsonb_object_agg(key,value),'{}') into d from jsonb_each(p_details)
 where key in ('legal_name','phone','country','address','interests','business_name','registration_number');
 if exists(select 1 from jsonb_each(d) where jsonb_typeof(value)<>'string' or length(value#>>'{}')>case when key='address' then 1000 else 160 end) then raise exception 'Invalid detail format or length'; end if;
 -- The verification step and final completion require actual saved evidence and explicit consent.
 if p_step=3 then
  if p_details->>'terms_accepted' is distinct from 'true' or jsonb_typeof(p_details->'terms_accepted') is distinct from 'string'
   or p_details->>'terms_version' is distinct from current_terms then raise exception 'Read and accept the current Terms & Conditions to continue'; end if;
  if not exists(select 1 from public.ir_documents where user_id=u and kind='identity' and auction_id is null) then raise exception 'Upload private identity evidence'; end if;
  if p_type='seller' and length(trim(coalesce(d->>'business_name','')))>0
   and (length(trim(coalesce(d->>'registration_number','')))=0 or not exists(select 1 from public.ir_documents where user_id=u and kind='business' and auction_id is null)) then raise exception 'Business registration and evidence required'; end if;
  insert into public.ir_terms_acceptances(user_id,account_type,terms_version,terms_path)
  values(u,p_type,current_terms,'/terms/'||current_terms) on conflict do nothing;
 end if;
 -- Consent markers in saved progress come only from the immutable server receipt, never a draft claim.
 if exists(select 1 from public.ir_terms_acceptances where user_id=u and account_type=p_type and terms_version=current_terms) then
  d:=d||jsonb_build_object('terms_accepted','true','terms_version',current_terms);
 end if;
 if p_complete then
  if length(trim(coalesce(d->>'legal_name','')))<2 or length(trim(coalesce(d->>'phone','')))<7
   or length(trim(coalesce(d->>'country','')))<2 or length(trim(coalesce(d->>'address','')))<8 then raise exception 'Complete your contact details'; end if;
  if p_type='seller' then
   perform public.ir_submit_seller(d->>'legal_name',coalesce(d->>'business_name',''),coalesce(d->>'registration_number',''),d->>'address');
  end if;
 end if;
 insert into public.ir_account_onboarding(user_id,account_type,details,step,completed_at)
 values(u,p_type,d,p_step,case when p_complete then now() end)
 on conflict(user_id,account_type) do update set details=excluded.details,step=excluded.step,
 completed_at=coalesce(ir_account_onboarding.completed_at,excluded.completed_at),updated_at=now();
 if p_complete then update public.ir_profiles set active_account=p_type where id=u; end if;
end $$;
revoke all on function public.ir_save_onboarding(text,jsonb,integer,boolean) from public,anon;
grant execute on function public.ir_save_onboarding(text,jsonb,integer,boolean) to authenticated;
