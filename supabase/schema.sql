-- Coursebench proxy — Supabase schema (Phase 3)
-- Run in the Supabase SQL editor.

create table if not exists clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz default now()
);

-- Per-client tokens. Store ONLY the SHA-256 hash, never the plaintext token.
create table if not exists client_tokens (
  token_hash      text primary key,
  client_id       uuid not null references clients(id) on delete cascade,
  label           text,
  allowed_jigs    text[] not null default '{}',
  allowed_origins text[] not null default '{}',
  active          boolean not null default true,
  created_at      timestamptz default now()
);

-- Content-free telemetry. No request/response text is ever stored here.
create table if not exists usage_log (
  id            bigint generated always as identity primary key,
  client_id     uuid references clients(id) on delete set null,
  jig_id        text,
  status        int,
  input_tokens  int,
  output_tokens int,
  at            timestamptz default now()
);

-- RLS on for all. The Worker uses the service role key (bypasses RLS); no other
-- caller should ever read tokens. No permissive policies are created on purpose.
alter table clients       enable row level security;
alter table client_tokens enable row level security;
alter table usage_log     enable row level security;
