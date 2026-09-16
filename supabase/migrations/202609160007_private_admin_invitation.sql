create function public.ir_admin_invitation_status() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u join ir_private.admin_invites i on i.email=lower(u.email) where u.id=auth.uid() and u.email_confirmed_at is not null)
$$;
revoke all on function public.ir_admin_invitation_status() from public,anon;
grant execute on function public.ir_admin_invitation_status() to authenticated;
