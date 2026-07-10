-- Cached brand → style DNA translations (pay Haiku once per brand+garment_family).
-- Used when a stated brand probe returns fewer than BRAND_MIN_POOL confirmed hits.

create table if not exists public.brand_translations (
  brand            text not null,
  garment_family   text not null,
  style_descriptors text[] not null,
  price_tier       text not null default 'unknown',
  sanity_note      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (brand, garment_family)
);

alter table public.brand_translations enable row level security;
