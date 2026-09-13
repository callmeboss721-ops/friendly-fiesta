-- CE VAULT Phase 1: cycles and immutable financial audit metadata.
-- Safe to run repeatedly on the existing Supabase Postgres database.

create table if not exists public.vault_cycles (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  daily_limit_thb numeric(20,2),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opened_by text,
  closed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_vault_cycles_open_per_chat
  on public.vault_cycles (chat_id) where status = 'OPEN';

alter table public.transactions
  add column if not exists cycle_id uuid references public.vault_cycles(id) on delete restrict;
alter table public.transactions
  add column if not exists settled_at timestamptz;
alter table public.transactions
  add column if not exists settled_by text;
create index if not exists idx_transactions_cycle_created
  on public.transactions (cycle_id, created_at desc);

create table if not exists public.vault_audit_logs (
  id bigserial primary key,
  cycle_id uuid references public.vault_cycles(id) on delete restrict,
  transaction_id uuid references public.transactions(id) on delete restrict,
  action text not null,
  actor text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_vault_audit_logs_cycle_created
  on public.vault_audit_logs (cycle_id, created_at desc);
create index if not exists idx_vault_audit_logs_transaction_created
  on public.vault_audit_logs (transaction_id, created_at desc);

alter table public.vault_cycles enable row level security;
alter table public.vault_audit_logs enable row level security;
revoke all on table public.vault_cycles from public, anon, authenticated;
revoke all on table public.vault_audit_logs from public, anon, authenticated;
grant all on table public.vault_cycles to service_role;
grant all on table public.vault_audit_logs to service_role;

-- Attach only new financial transactions to the room's active cycle. Existing
-- historical records remain intact and are never rewritten by this migration.
create or replace function public.assign_transaction_cycle()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.cycle_id is null and new.chat_id is not null then
    select id into new.cycle_id
      from public.vault_cycles
      where chat_id = new.chat_id and status = 'OPEN'
      order by opened_at desc
      limit 1;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_assign_transaction_cycle on public.transactions;
create trigger trg_assign_transaction_cycle
before insert on public.transactions
for each row execute function public.assign_transaction_cycle();

create index if not exists idx_transactions_search_ledger on public.transactions (ledger_ref);
create index if not exists idx_transactions_search_status_created on public.transactions (status, created_at desc);
