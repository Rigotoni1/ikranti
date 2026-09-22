-- Staff decisions are tied to the selected account and evidence, never an entered UUID/fingerprint.
-- Keep identity linking private so related accounts still cannot bid on one another's listings.
create index if not exists ir_audit_target_created_idx on public.ir_audit(target,created_at desc,id desc);

-- Search all verified users, not just the directory's latest 200 rows.
create function public.ir_admin_identity_matches(p_search text,p_exclude uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not ir_private.admin() then raise exception 'Verified administrator required'; end if;
 if length(trim(coalesce(p_search,'')))<2 then return '[]'::jsonb; end if;
 if length(p_search)>160 then raise exception 'Search must be 160 characters or fewer'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (
  select p.id,p.name,u.email from public.ir_profiles p
  join auth.users u on u.id=p.id join ir_private.identity_links i on i.user_id=p.id
  where p.id<>p_exclude and (strpos(lower(p.name),lower(trim(p_search)))>0 or strpos(lower(u.email),lower(trim(p_search)))>0)
  order by p.name,p.id limit 20
 ) r);
end $$;
revoke all on function public.ir_admin_identity_matches(text,uuid) from public,anon;
grant execute on function public.ir_admin_identity_matches(text,uuid) to authenticated;

create function public.ir_staff_user_decision(
 p_user uuid, p_action text, p_note text, p_decision_id uuid,
 p_document uuid default null, p_identity_match text default null,
 p_linked_user uuid default null, p_reviewed boolean default false
) returns void language plpgsql security definer set search_path='' as $$
declare
 target_user public.ir_profiles;
 fingerprint text;
 linked_fingerprint text;
 payload jsonb;
 previous public.ir_audit;
begin
 if not ir_private.admin() then raise exception 'Verified administrator required'; end if;
 if p_action is null or p_action not in ('verify_buyer','approve_seller','request_buyer_changes','request_seller_changes','reject_seller','suspend','reinstate') then
  raise exception 'Choose a supported account decision';
 end if;
 if length(trim(coalesce(p_note,'')))<5 or length(p_note)>2000 then raise exception 'Provide a review note (5–2000 characters)'; end if;
 if p_decision_id is null then raise exception 'Decision reference required'; end if;
 select * into target_user from public.ir_profiles where id=p_user for update;
 if not found then raise exception 'User not found'; end if;
 payload:=jsonb_build_object('note',trim(p_note),'document_id',p_document,'identity_match',p_identity_match,'linked_user_id',p_linked_user,'reviewed',p_reviewed,'decision_id',p_decision_id);
 select * into previous from public.ir_audit where target=p_user::text and detail->>'decision_id'=p_decision_id::text limit 1;
 if found then
  if previous.actor<>auth.uid() or previous.action<>p_action or previous.detail<>payload then raise exception 'Decision reference already used; refresh and try again'; end if;
  return;
 end if;

 if p_action in ('verify_buyer','approve_seller') then
  if target_user.suspended then raise exception 'Reinstate the account before approving it'; end if;
  if not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null) then raise exception 'The user must verify their email first'; end if;
  if not exists(select 1 from public.ir_account_onboarding where user_id=p_user and account_type=case when p_action='verify_buyer' then 'buyer' else 'seller' end and completed_at is not null) then raise exception 'The user must finish the relevant account setup first'; end if;
  if p_reviewed is distinct from true then raise exception 'Confirm that you reviewed the identity evidence'; end if;
  perform 1 from public.ir_documents where id=p_document and user_id=p_user and kind='identity' and auction_id is null for share;
  if not found then raise exception 'Choose an identity document submitted by this user'; end if;
  select identity_fingerprint into fingerprint from ir_private.identity_links where user_id=p_user;
  if fingerprint is not null then
   if p_identity_match is distinct from 'existing' or p_linked_user is not null then raise exception 'Keep the existing verified identity for this account'; end if;
  elsif p_identity_match='linked' and p_linked_user is not null and p_linked_user<>p_user then
   select identity_fingerprint into linked_fingerprint from ir_private.identity_links where user_id=p_linked_user for share;
   if linked_fingerprint is null then raise exception 'Choose an already verified account for the same person'; end if;
   fingerprint:=linked_fingerprint;
  elsif p_identity_match='new' and p_linked_user is null then
   fingerprint:='staff:'||gen_random_uuid()::text;
  else raise exception 'Confirm whether this person already has a verified account';
  end if;
  if p_action='verify_buyer' then
   insert into ir_private.identity_links(user_id,identity_fingerprint) values(p_user,fingerprint) on conflict(user_id) do nothing;
  else
   perform 1 from public.ir_seller_applications where user_id=p_user for update;
   if not found then raise exception 'No seller application has been submitted'; end if;
   if exists(select 1 from public.ir_seller_applications where user_id=p_user and business_name<>'') and not exists(select 1 from public.ir_documents where user_id=p_user and kind='business' and auction_id is null) then raise exception 'Business documentation is required for this seller'; end if;
   insert into ir_private.identity_links(user_id,identity_fingerprint) values(p_user,fingerprint) on conflict(user_id) do nothing;
   update public.ir_seller_applications set status='approved',review_note=trim(p_note) where user_id=p_user;
   update public.ir_profiles set seller_status='approved' where id=p_user;
  end if;
 elsif p_action in ('request_seller_changes','reject_seller') then
  if target_user.seller_status='approved' then raise exception 'Seller already approved; use suspension if access must be stopped'; end if;
  update public.ir_seller_applications set status=case when p_action='reject_seller' then 'rejected' else 'pending' end,review_note=trim(p_note) where user_id=p_user;
  if not found then raise exception 'No seller application has been submitted'; end if;
  update public.ir_profiles set seller_status=case when p_action='reject_seller' then 'rejected' else 'pending' end where id=p_user;
 elsif p_action='request_buyer_changes' then
  if not exists(select 1 from public.ir_account_onboarding where user_id=p_user and account_type='buyer') then raise exception 'Buyer setup has not been started'; end if;
  if exists(select 1 from ir_private.identity_links where user_id=p_user) then raise exception 'Identity already approved; use suspension if access must be stopped'; end if;
 else
  if p_user=auth.uid() then raise exception 'You cannot change your own account access'; end if;
  if p_reviewed is distinct from true then raise exception 'Confirm the account access change'; end if;
  update public.ir_profiles set suspended=(p_action='suspend') where id=p_user;
 end if;
 insert into public.ir_audit(actor,action,target,detail) values(auth.uid(),p_action,p_user::text,payload);
 perform ir_private.notify(p_user,'account_review',
  case p_action when 'verify_buyer' then 'Your identity has been approved for bidding.'
   when 'approve_seller' then 'Your seller account has been approved.'
   when 'request_buyer_changes' then 'Your buyer verification needs an update.'
   when 'request_seller_changes' then 'Your seller application needs an update.'
   when 'reject_seller' then 'Your seller application was not approved.'
   when 'suspend' then 'Your account has been suspended.'
   else 'Your account access has been restored.' end||' '||trim(p_note),
  null,'staff-user:'||p_user::text||':'||p_decision_id::text);
end $$;
revoke all on function public.ir_staff_user_decision(uuid,text,text,uuid,uuid,text,uuid,boolean) from public,anon;
grant execute on function public.ir_staff_user_decision(uuid,text,text,uuid,uuid,text,uuid,boolean) to authenticated;

create or replace function public.ir_admin_users() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not ir_private.admin() then raise exception 'Verified administrator required'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from (
 select p.*,u.email,u.email_confirmed_at is not null as email_verified,
 exists(select 1 from ir_private.identity_links i where i.user_id=p.id) as identity_approved,
 exists(select 1 from public.ir_documents d where d.user_id=p.id and d.kind='identity') as identity_submitted,
 exists(select 1 from public.ir_account_onboarding o where o.user_id=p.id and o.account_type='buyer') as buyer_role,
 exists(select 1 from public.ir_account_onboarding o where o.user_id=p.id and o.account_type='buyer' and o.completed_at is not null) as buyer_complete,
 exists(select 1 from public.ir_account_onboarding o where o.user_id=p.id and o.account_type='seller') or p.seller_status<>'not_started' as seller_role,
 exists(select 1 from public.ir_account_onboarding o where o.user_id=p.id and o.account_type='seller' and o.completed_at is not null) as seller_complete,
 (select to_jsonb(a) from (select action,created_at,detail->>'note' as note from public.ir_audit where target=p.id::text and action in ('verify_buyer','approve_seller','request_buyer_changes','request_seller_changes','reject_seller','suspend','reinstate') order by created_at desc,id desc limit 1) a) as last_staff_decision,
 coalesce((select a.action='request_buyer_changes' and not exists(select 1 from public.ir_documents d where d.user_id=p.id and d.kind='identity' and d.created_at>a.created_at) from public.ir_audit a where a.target=p.id::text and a.action in ('verify_buyer','request_buyer_changes') order by a.created_at desc,a.id desc limit 1),false) as identity_changes_requested
 from public.ir_profiles p join auth.users u on u.id=p.id order by p.created_at desc limit 200
 ) r);
end $$;
