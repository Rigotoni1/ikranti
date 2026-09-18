-- Temporary UI-development policy: listing evidence is optional.
-- Restore asset-specific document checks before public launch. Seller verification remains mandatory.
create or replace function public.ir_admin_action(p_action text,p_target uuid,p_note text,p_fingerprint text default null) returns void language plpgsql security definer set search_path='' as $$
declare a public.ir_auctions; begin
 if not ir_private.admin() then raise exception 'Verified administrator required'; end if;
 if length(trim(coalesce(p_note,'')))<5 or length(p_note)>2000 then raise exception 'Provide an audit note (5–2000 characters)'; end if;
 if p_action in ('approve_seller','reject_seller') then
 if p_action='approve_seller' and (not exists(select 1 from public.ir_documents where user_id=p_target and kind='identity') or length(coalesce(p_fingerprint,''))<16) then raise exception 'Identity document and verified identity fingerprint required'; end if;
 if not exists(select 1 from public.ir_seller_applications where user_id=p_target) then raise exception 'Application not found'; end if;
 if p_action='approve_seller' and exists(select 1 from public.ir_seller_applications where user_id=p_target and business_name<>'') and not exists(select 1 from public.ir_documents where user_id=p_target and kind='business') then raise exception 'Business documentation required'; end if;
 update public.ir_seller_applications set status=case when p_action='approve_seller' then 'approved' else 'rejected' end,review_note=p_note where user_id=p_target;
 update public.ir_profiles set seller_status=case when p_action='approve_seller' then 'approved' else 'rejected' end where id=p_target;
 if p_action='approve_seller' then insert into ir_private.identity_links values(p_target,p_fingerprint) on conflict(user_id) do update set identity_fingerprint=excluded.identity_fingerprint; end if;
 elsif p_action in ('approve_listing','reject_listing') then
 select * into a from public.ir_auctions where id=p_target for update;
 if not found or a.status<>'under_review' then raise exception 'Pending listing not found'; end if;
 if p_action='approve_listing' then
 if a.image_path is null then raise exception 'Listing photograph required'; end if;
 if a.end_at<=now()+interval '1 hour' then raise exception 'Listing end date is too soon'; end if;
 if not exists(select 1 from public.ir_profiles where id=a.seller_id and seller_status='approved' and not suspended) then raise exception 'Seller not approved'; end if;
 end if;
 update public.ir_auctions set status=case when p_action='approve_listing' then 'live' else 'rejected' end,review_note=p_note,version=version+1 where id=p_target;
 elsif p_action in ('suspend','reinstate') then
 if p_target=auth.uid() then raise exception 'Cannot suspend your own account'; end if;
 update public.ir_profiles set suspended=(p_action='suspend') where id=p_target;
 if not found then raise exception 'Account not found'; end if;
 elsif p_action in ('resolve_dispute','dismiss_dispute') then
 update public.ir_disputes set status=case when p_action='resolve_dispute' then 'resolved' else 'dismissed' end,resolution=p_note where id=p_target and status='open';
 if not found then raise exception 'Open dispute not found'; end if;
 else raise exception 'Unknown staff action'; end if;
 insert into public.ir_audit(actor,action,target,detail) values(auth.uid(),p_action,p_target::text,jsonb_build_object('note',p_note));
end $$;


