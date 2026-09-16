create function public.ir_launch_status() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('tradingEnabled',trading_enabled) from ir_private.settings where id
$$;
revoke all on function public.ir_launch_status() from public;
grant execute on function public.ir_launch_status() to anon,authenticated;
