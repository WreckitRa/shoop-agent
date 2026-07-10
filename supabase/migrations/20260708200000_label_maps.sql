-- Canonical label maps for fashion variant normalization (LLM results cached globally).

create table public.color_label_map (
  raw_label   text primary key,
  canonical   text[] not null,
  source      text not null default 'llm',
  created_at  timestamptz not null default now()
);

create table public.size_label_map (
  raw_label   text not null,
  category    text not null,
  canonical   jsonb not null,
  source      text not null default 'llm',
  created_at  timestamptz not null default now(),
  primary key (raw_label, category)
);

create index size_label_map_category on public.size_label_map (category);

alter table public.color_label_map enable row level security;
alter table public.size_label_map enable row level security;
