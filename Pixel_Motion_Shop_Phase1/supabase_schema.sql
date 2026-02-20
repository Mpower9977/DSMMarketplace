create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'buyer' check (role in ('buyer','seller','admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  price_cents integer not null check (price_cents >= 0),
  cover_path text,
  file_path text not null,
  status text not null default 'active' check (status in ('active','hidden')),
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  price_cents integer not null check (price_cents >= 0),
  platform_fee_cents integer not null check (platform_fee_cents >= 0),
  seller_amount_cents integer not null check (seller_amount_cents >= 0),
  status text not null default 'pending_payment'
    check (status in ('pending_payment','pending_review','paid','rejected','refunded')),
  slip_path text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

create or replace function public.is_admin()
returns boolean language sql stable as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid() and p.role='admin');
$$;

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;

-- profiles
drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin on public.profiles
for select using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
for insert with check (id = auth.uid());

drop policy if exists profiles_update_self_or_admin on public.profiles;
create policy profiles_update_self_or_admin on public.profiles
for update using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());

-- products
drop policy if exists products_select_active_public on public.products;
create policy products_select_active_public on public.products
for select using (status='active');

drop policy if exists products_insert_seller on public.products;
create policy products_insert_seller on public.products
for insert with check (seller_id = auth.uid());

drop policy if exists products_update_owner_or_admin on public.products;
create policy products_update_owner_or_admin on public.products
for update using (seller_id = auth.uid() or public.is_admin())
with check (seller_id = auth.uid() or public.is_admin());

-- orders
drop policy if exists orders_select_buyer_seller_admin on public.orders;
create policy orders_select_buyer_seller_admin on public.orders
for select using (
  buyer_id = auth.uid()
  or public.is_admin()
  or exists (select 1 from public.products p where p.id=orders.product_id and p.seller_id=auth.uid())
);

drop policy if exists orders_insert_buyer on public.orders;
create policy orders_insert_buyer on public.orders
for insert with check (buyer_id = auth.uid());

drop policy if exists orders_update_buyer_attach_slip on public.orders;
create policy orders_update_buyer_attach_slip on public.orders
for update using (buyer_id = auth.uid())
with check (buyer_id = auth.uid() and status in ('pending_payment','pending_review'));

drop policy if exists orders_update_admin on public.orders;
create policy orders_update_admin on public.orders
for update using (public.is_admin()) with check (public.is_admin());

-- STORAGE buckets to create:
-- product-files (Private), product-covers (Public recommended), payment-slips (Private)

-- product-files select: seller owner OR paid buyer OR admin
drop policy if exists product_files_select_owner_or_paid_buyer on storage.objects;
create policy product_files_select_owner_or_paid_buyer on storage.objects
for select using (
  bucket_id='product-files' and (
    public.is_admin()
    or exists (select 1 from public.products p where p.file_path=storage.objects.name and p.seller_id=auth.uid())
    or exists (
      select 1 from public.orders o
      join public.products p on p.id=o.product_id
      where o.buyer_id=auth.uid() and o.status='paid' and p.file_path=storage.objects.name
    )
  )
);

drop policy if exists product_files_insert_authenticated on storage.objects;
create policy product_files_insert_authenticated on storage.objects
for insert with check (bucket_id='product-files' and auth.role()='authenticated');

drop policy if exists product_files_update_admin on storage.objects;
create policy product_files_update_admin on storage.objects
for update using (bucket_id='product-files' and public.is_admin())
with check (bucket_id='product-files' and public.is_admin());

drop policy if exists product_files_delete_admin on storage.objects;
create policy product_files_delete_admin on storage.objects
for delete using (bucket_id='product-files' and public.is_admin());

-- payment-slips select: buyer owns slip via orders OR admin
drop policy if exists payment_slips_select_buyer_or_admin on storage.objects;
create policy payment_slips_select_buyer_or_admin on storage.objects
for select using (
  bucket_id='payment-slips' and (
    public.is_admin()
    or exists (select 1 from public.orders o where o.slip_path=storage.objects.name and o.buyer_id=auth.uid())
  )
);

drop policy if exists payment_slips_insert_authenticated on storage.objects;
create policy payment_slips_insert_authenticated on storage.objects
for insert with check (bucket_id='payment-slips' and auth.role()='authenticated');