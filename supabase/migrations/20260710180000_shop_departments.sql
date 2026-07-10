-- Shop-level department annotations for catalog hard-drops / scoring.
-- Lookup: attribute → shop_departments (mens/womens/kids) → category → title.
-- `mixed` contributes no signal (unknown survives).

create table if not exists public.shop_departments (
  shop_gid text primary key,
  department text not null check (department in ('mens', 'womens', 'kids', 'mixed')),
  confidence text not null check (confidence in ('manual', 'inferred')),
  source_note text,
  shop_domain text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shop_departments_domain_idx
  on public.shop_departments (shop_domain)
  where shop_domain is not null;

comment on table public.shop_departments is
  'Allowlist shop department map — mens/womens/kids hard-drop evidence; mixed is neutral.';
