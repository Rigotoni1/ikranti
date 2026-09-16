create table if not exists public.ikranti_config (
  key text primary key,
  value text not null
);
alter table public.ikranti_config enable row level security;
revoke all on public.ikranti_config from anon, authenticated;
grant select on public.ikranti_config to service_role;

create table if not exists public.ikranti_users (
  id text primary key,
  name text not null,
  initials text not null,
  email text not null unique,
  role text not null check (role in ('buyer', 'seller', 'admin')),
  verified boolean not null default false,
  joined_at timestamptz not null default now()
);

create table if not exists public.auctions (
  id text primary key,
  seller_id text not null references public.ikranti_users(id),
  title text not null,
  category text not null,
  location text not null,
  description text not null,
  image_url text not null,
  start_price numeric(14,2) not null check (start_price > 0),
  reserve_price numeric(14,2) not null default 0 check (reserve_price >= 0),
  current_bid numeric(14,2) not null check (current_bid >= 0),
  highest_bidder_id text references public.ikranti_users(id),
  bid_count integer not null default 0 check (bid_count >= 0),
  end_at timestamptz not null,
  status text not null default 'live' check (status in ('live', 'under_review', 'sold', 'withdrawn')),
  featured boolean not null default false,
  views integer not null default 0 check (views >= 0),
  watch_count integer not null default 0 check (watch_count >= 0),
  version integer not null default 0
);

create table if not exists public.max_bids (
  auction_id text not null references public.auctions(id) on delete cascade,
  user_id text not null references public.ikranti_users(id) on delete cascade,
  max_amount numeric(14,2) not null check (max_amount > 0),
  created_at timestamptz not null default now(),
  primary key (auction_id, user_id)
);

create table if not exists public.bid_events (
  id uuid primary key default gen_random_uuid(),
  auction_id text not null references public.auctions(id) on delete cascade,
  user_id text not null references public.ikranti_users(id) on delete cascade,
  visible_amount numeric(14,2) not null,
  created_at timestamptz not null default now()
);

create table if not exists public.watchlist (
  user_id text not null references public.ikranti_users(id) on delete cascade,
  auction_id text not null references public.auctions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, auction_id)
);

create index if not exists auctions_live_end_idx on public.auctions (end_at) where status = 'live';
create index if not exists auctions_seller_idx on public.auctions (seller_id);
create index if not exists auctions_category_idx on public.auctions (category);
create index if not exists bid_events_auction_created_idx on public.bid_events (auction_id, created_at desc);
create index if not exists auctions_bidder_idx on public.auctions (highest_bidder_id);
create index if not exists max_bids_user_idx on public.max_bids (user_id);
create index if not exists bid_events_user_idx on public.bid_events (user_id);
create index if not exists watchlist_auction_idx on public.watchlist (auction_id);

alter table public.ikranti_users enable row level security;
alter table public.auctions enable row level security;
alter table public.max_bids enable row level security;
alter table public.bid_events enable row level security;
alter table public.watchlist enable row level security;

revoke all on public.ikranti_users, public.auctions, public.max_bids, public.bid_events, public.watchlist from anon, authenticated;
grant all on public.ikranti_users, public.auctions, public.max_bids, public.bid_events, public.watchlist to service_role;

create or replace function public.ikranti_place_bid(
  p_auction_id text,
  p_user_id text,
  p_max_amount numeric
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_auction public.auctions%rowtype;
  v_increment numeric;
  v_minimum numeric;
  v_own_max numeric;
  v_leader_max numeric;
  v_leader_id text;
  v_visible numeric;
  v_end_at timestamptz;
  v_extended boolean := false;
begin
  select * into v_auction
  from public.auctions
  where id = p_auction_id
  for update;

  if not found or v_auction.status <> 'live' then
    raise exception 'This auction is no longer live.' using errcode = 'P0001';
  end if;
  if v_auction.end_at <= clock_timestamp() then
    raise exception 'Bidding has closed.' using errcode = 'P0001';
  end if;
  if v_auction.seller_id = p_user_id then
    raise exception 'You cannot bid on your own lot.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.ikranti_users where id = p_user_id) then
    raise exception 'Please sign in before continuing.' using errcode = 'P0001';
  end if;

  v_increment := case
    when v_auction.current_bid >= 100000 then 5000
    when v_auction.current_bid >= 10000 then 500
    when v_auction.current_bid >= 1000 then 100
    when v_auction.current_bid >= 100 then 25
    else 5
  end;

  select max_amount into v_own_max
  from public.max_bids
  where auction_id = p_auction_id and user_id = p_user_id;

  v_minimum := case
    when v_auction.highest_bidder_id = p_user_id
      then greatest(v_auction.current_bid, coalesce(v_own_max, v_auction.current_bid)) + v_increment
    else v_auction.current_bid + v_increment
  end;
  if p_max_amount is null or p_max_amount::text in ('NaN', 'Infinity', '-Infinity') or p_max_amount > 999999999999 or p_max_amount <> trunc(p_max_amount, 2) or p_max_amount < v_minimum then
    raise exception 'Your maximum bid must be at least €%.', trim(to_char(v_minimum, 'FM999G999G999G990')) using errcode = 'P0001';
  end if;

  v_visible := v_auction.current_bid;
  if v_auction.highest_bidder_id is null then
    v_leader_id := p_user_id;
    v_visible := greatest(v_auction.start_price, v_auction.current_bid);
  elsif v_auction.highest_bidder_id = p_user_id then
    v_leader_id := p_user_id;
  else
    select max_amount into v_leader_max
    from public.max_bids
    where auction_id = p_auction_id and user_id = v_auction.highest_bidder_id;
    v_leader_max := coalesce(v_leader_max, v_auction.current_bid);
    if p_max_amount > v_leader_max then
      v_leader_id := p_user_id;
      v_visible := least(p_max_amount, v_leader_max + v_increment);
    else
      v_leader_id := v_auction.highest_bidder_id;
      v_visible := least(v_leader_max, p_max_amount + v_increment);
    end if;
  end if;

  v_end_at := v_auction.end_at;
  if v_end_at - clock_timestamp() <= interval '2 minutes' then
    v_end_at := clock_timestamp() + interval '2 minutes';
    v_extended := true;
  end if;

  insert into public.max_bids (auction_id, user_id, max_amount, created_at)
  values (p_auction_id, p_user_id, p_max_amount, now())
  on conflict (auction_id, user_id) do update
  set max_amount = excluded.max_amount, created_at = excluded.created_at;

  update public.auctions
  set current_bid = v_visible,
      highest_bidder_id = v_leader_id,
      bid_count = bid_count + 1,
      end_at = v_end_at,
      version = version + 1
  where id = p_auction_id;

  insert into public.bid_events (auction_id, user_id, visible_amount)
  values (p_auction_id, p_user_id, v_visible);

  return jsonb_build_object(
    'leading', v_leader_id = p_user_id,
    'visibleAmount', v_visible,
    'extended', v_extended
  );
end;
$$;

create or replace function public.ikranti_toggle_watch(
  p_user_id text,
  p_auction_id text
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_removed_count integer;
begin
  if not exists (select 1 from public.ikranti_users where id = p_user_id) then
    raise exception 'Please sign in before continuing.' using errcode = 'P0001';
  end if;
  perform id from public.auctions where id = p_auction_id for update;
  if not found then
    raise exception 'Auction not found.' using errcode = 'P0001';
  end if;

  delete from public.watchlist
  where user_id = p_user_id and auction_id = p_auction_id;
  get diagnostics v_removed_count = row_count;

  if v_removed_count > 0 then
    update public.auctions set watch_count = greatest(0, watch_count - 1) where id = p_auction_id;
    return false;
  end if;

  insert into public.watchlist (user_id, auction_id) values (p_user_id, p_auction_id);
  update public.auctions set watch_count = watch_count + 1 where id = p_auction_id;
  return true;
end;
$$;

revoke all on function public.ikranti_place_bid(text, text, numeric) from public, anon, authenticated;
revoke all on function public.ikranti_toggle_watch(text, text) from public, anon, authenticated;
grant execute on function public.ikranti_place_bid(text, text, numeric) to service_role;
grant execute on function public.ikranti_toggle_watch(text, text) to service_role;

insert into public.ikranti_users (id, name, initials, email, role, verified, joined_at) values
  ('buyer_01', 'Lara Vella', 'LV', 'lara@demo.ikranti.com', 'buyer', true, now() - interval '8 months'),
  ('seller_01', 'Marc Camilleri', 'MC', 'marc@demo.ikranti.com', 'seller', true, now() - interval '10 months'),
  ('collector_01', 'Elena Borg', 'EB', 'elena@demo.ikranti.com', 'buyer', true, now() - interval '7 months'),
  ('seller_auto', 'Mdina Motor House', 'MM', 'concierge@demo.ikranti.com', 'seller', true, now() - interval '11 months'),
  ('seller_estate', 'Harbour Estates', 'HE', 'property@demo.ikranti.com', 'seller', true, now() - interval '1 year')
on conflict (id) do nothing;

insert into public.auctions (id, seller_id, title, category, location, description, image_url, start_price, reserve_price, current_bid, highest_bidder_id, bid_count, end_at, status, featured, views, watch_count) values
  ('jaguar-e-type', 'seller_auto', '1967 Jaguar E-Type Series 1', 'Motor Cars', 'Naxxar, Malta', 'A beautifully preserved Series 1 roadster in British Racing Green. Matching numbers, Maltese registered and accompanied by an extensive history file. Independent inspection available by appointment.', 'https://images.unsplash.com/photo-1553440569-bcc63803a83d?auto=format&fit=crop&w=1600&q=90', 72000, 82000, 84500, 'collector_01', 23, now() + interval '1 day 7 hours', 'live', true, 1240, 48),
  ('rolex-daytona', 'seller_01', 'Rolex Cosmograph Daytona', 'Watches & Jewellery', 'Valletta, Malta', 'Oystersteel chronograph with black dial, full set and 2022 dated card. Examined by our independent watch specialist and offered with a 12-month authenticity guarantee.', 'https://images.unsplash.com/photo-1670177257750-9b47927f68eb?auto=format&fit=crop&w=1600&q=90', 17000, 20500, 21750, 'buyer_01', 18, now() + interval '3 days 11 hours', 'live', true, 962, 62),
  ('senglea-palazzo', 'seller_estate', 'Palazzo with Grand Harbour Views', 'Property', 'Senglea, Malta', 'An architecturally significant harbour-side residence arranged across four levels, with an unrestored piano nobile and private roof terrace. Legal pack and viewing calendar available to registered bidders.', 'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1600&q=90', 980000, 1180000, 1240000, 'collector_01', 31, now() + interval '5 days 2 hours', 'live', true, 1844, 91),
  ('riva-aquarama', 'seller_01', '1971 Riva Aquarama Special', 'Boats', 'Grand Harbour Marina', 'Twin-engine mahogany runabout following a three-year restoration. EU VAT paid, Malta flag eligible and supplied with current survey, engine records and fitted cover.', 'https://images.unsplash.com/photo-1540946485063-a40da27545f8?auto=format&fit=crop&w=1600&q=90', 280000, 330000, 342000, 'buyer_01', 14, now() + interval '2 days 4 hours', 'live', true, 770, 35),
  ('caruana-painting', 'seller_01', 'Edward Caruana Dingli, Harbour Morning', 'Art & Antiques', 'Attard, Malta', 'Signed oil on canvas depicting the Grand Harbour at first light. Private Maltese collection; accompanied by provenance documentation and a condition assessment.', 'https://images.unsplash.com/photo-1577083552431-6e5fd01aa342?auto=format&fit=crop&w=1600&q=90', 12000, 18500, 19400, 'collector_01', 16, now() + interval '4 days 8 hours', 'live', false, 644, 27),
  ('malta-map', 'seller_01', 'De Wit Map of Malta, circa 1680', 'Collectables', 'Rabat, Malta', 'A finely engraved and hand-coloured map of Malta and Gozo by Frederick de Wit, retaining wide margins and presented in a conservation-grade frame.', 'https://images.unsplash.com/photo-1524661135-423995f22d0b?auto=format&fit=crop&w=1600&q=90', 1600, 0, 2450, 'buyer_01', 9, now() + interval '6 days 1 hour', 'live', false, 383, 18),
  ('mercedes-280sl', 'seller_auto', '1969 Mercedes-Benz 280 SL Pagoda', 'Motor Cars', 'Mosta, Malta', 'European specification example in Horizon Blue with navy interior. Recently serviced, accompanied by hardtop and documented restoration photographs.', 'https://images.unsplash.com/photo-1563720223185-11003d516935?auto=format&fit=crop&w=1600&q=90', 68000, 82000, 78500, 'collector_01', 12, now() + interval '7 days 2 hours', 'live', false, 511, 29),
  ('malta-cabinet', 'seller_01', '18th-Century Maltese Olivewood Cabinet', 'Art & Antiques', 'Balzan, Malta', 'A compact olivewood and ebonised cabinet on original stand, with fitted interior and bone escutcheons. Private family provenance since the 1940s.', 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=1600&q=90', 8500, 12500, 13100, 'buyer_01', 11, now() + interval '4 days 19 hours', 'live', false, 456, 22),
  ('seller-pending-1', 'seller_01', 'Cartier Tank Louis, 18k Gold', 'Watches & Jewellery', 'Sliema, Malta', 'Freshly submitted private collection piece with box and service papers.', 'https://images.unsplash.com/photo-1524592094714-0f0654e20314?auto=format&fit=crop&w=1600&q=90', 6500, 7800, 6500, null, 0, now() + interval '10 days', 'under_review', false, 0, 0)
on conflict (id) do nothing;
