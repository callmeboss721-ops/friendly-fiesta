-- ============================================================
-- CE VAULT — Master Database Schema Template (Complete & Idempotent)
-- Includes full schema from v1 core + patches v2 to v12 & live message updates
-- ============================================================

-- 0) Extensions
create extension if not exists "pgcrypto";

-- 1) admins
create table if not exists public.admins (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  telegram_user_id bigint unique not null,
  holding_usdt     numeric(20,2) not null default 0,
  role             text default 'Operator',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- 2) bank_accounts
create table if not exists public.bank_accounts (
  id              uuid primary key default gen_random_uuid(),
  label           text not null,
  bank_name       text not null,
  account_number  text,
  current_balance numeric(20,2) not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 3) pinned_bank_accounts
create table if not exists public.pinned_bank_accounts (
  chat_id bigint not null,
  bank_account_id uuid not null references public.bank_accounts(id) on delete cascade,
  pinned_for_date date not null,
  created_at timestamptz not null default now(),
  primary key (chat_id, bank_account_id, pinned_for_date)
);
create index if not exists idx_pinned_bank_accounts_lookup on public.pinned_bank_accounts (chat_id, pinned_for_date, created_at);

-- 4) receivers
create table if not exists public.receivers (
  id                   uuid primary key default gen_random_uuid(),
  name                 text,
  bank_name            text,
  account_number       text,
  last4                text,
  total_volume_thb     numeric(20,2) not null default 0,
  account_hash         text,
  bank                 text,
  receiver_name        text,
  account_last4        text,
  total_transactions   integer       not null default 0,
  total_amount_thb     numeric(20,2) not null default 0,
  total_usdt           numeric(20,4) not null default 0,
  max_amount_thb       numeric(20,2) not null default 0,
  last_amount_thb      numeric(20,2) not null default 0,
  first_transaction_at timestamptz,
  last_transaction_at  timestamptz,
  last_ledger_ref      text,
  status               text          not null default 'normal',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index if not exists uq_receivers_account_hash on public.receivers (account_hash) where account_hash is not null;
create index if not exists receivers_last4_idx on public.receivers (account_last4) where account_last4 is not null;

-- 5) transactions
create table if not exists public.transactions (
  id               uuid primary key default gen_random_uuid(),
  admin_id         uuid not null references public.admins(id),
  bank_account_id  uuid references public.bank_accounts(id),
  receiver_id      uuid references public.receivers(id),
  type             text not null check (type in ('THB_DEPOSIT','USDT_SEND')),
  status           text default 'ocr_success',
  thb_amount       numeric(20,2) not null default 0,
  usdt_amount      numeric(20,2) not null default 0,
  sell_rate        numeric(20,4) not null default 0,
  buy_rate         numeric(20,4),
  cost_per_unit    numeric(20,4) not null default 0,
  sell_value_thb   numeric(20,2) not null default 0,
  net_profit_thb   numeric(20,2) not null default 0,
  profit_percent   numeric(20,4) not null default 0,
  expected_usdt    numeric(20,2) not null default 0,
  fee_usdt         numeric(20,2) not null default 0,
  fee_percent      numeric(20,4) not null default 0,
  note             text,
  slip_image_url   text,
  slip_fingerprint text,
  room_name        text,
  ocr_confidence   numeric(6,2),
  usdt_network     text,
  usdt_txid        text,
  usdt_image_url   text,
  receiver_name    text,
  receiver_bank    text,
  receiver_last4   text,
  ledger_ref       text,
  chat_id          bigint,
  live_message_id  bigint,
  live_chat_id     bigint,
  live_status      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_tx_created_at on public.transactions (created_at desc);
create index if not exists idx_tx_admin on public.transactions (admin_id);
create unique index if not exists uq_transactions_ledger_ref on public.transactions (ledger_ref) where ledger_ref is not null;
create unique index if not exists uq_transactions_slip_fingerprint on public.transactions (slip_fingerprint) where slip_fingerprint is not null;

-- 6) transaction_status_logs
create table if not exists public.transaction_status_logs (
  id             bigserial primary key,
  transaction_id uuid not null,
  status         text not null,
  meta           jsonb,
  created_at     timestamptz default now()
);
create index if not exists idx_tx_status_logs_tx on public.transaction_status_logs (transaction_id);

-- 7) rates
create table if not exists public.rates (
  id               uuid primary key default gen_random_uuid(),
  sell_rate        numeric(20,4) not null,
  market_usdt_rate numeric(20,4) not null,
  set_by_admin_id  uuid references public.admins(id),
  created_at       timestamptz not null default now()
);

-- 8) bot_sessions
create table if not exists public.bot_sessions (
  chat_id            bigint not null,
  telegram_user_id   bigint not null,
  admin_id           uuid,
  admin_name         text,
  state              text not null,
  pending_type       text,
  slip_url           text,
  caption            text,
  ocr_thb            numeric,
  pending_usdt       numeric,
  usdt_network       text,
  usdt_txid          text,
  usdt_image_url     text,
  ocr_conf           numeric(6,2),
  ledger_ref         text,
  slip_receiver_name text,
  slip_fingerprint   text,
  live_message_id    bigint,
  live_tx_id         uuid,
  vision_message_id  bigint,
  updated_at         timestamptz not null default now(),
  primary key (chat_id, telegram_user_id)
);

-- 9) chat_settings
create table if not exists public.chat_settings (
  chat_id    bigint primary key,
  room_name  text,
  sell_rate  numeric(20,4),
  day_cut_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 10) telegram_updates
create table if not exists public.telegram_updates (
  update_id  bigint primary key,
  claimed_at timestamptz not null default now()
);
create index if not exists idx_telegram_updates_claimed_at on public.telegram_updates (claimed_at);

-- 11) system_settings
create table if not exists public.system_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- 12) dashboard_login_attempts
create table if not exists public.dashboard_login_attempts (
  ip           text primary key,
  attempts     integer not null default 0,
  locked_until timestamptz,
  updated_at   timestamptz not null default now()
);
create index if not exists idx_login_attempts_locked on public.dashboard_login_attempts (locked_until);

-- 13) bot_metrics
create table if not exists public.bot_metrics (
  id              text primary key default 'singleton',
  error_rate      numeric not null default 0,
  avg_response_ms numeric not null default 0,
  rate_limit_pct  numeric not null default 0,
  uptime_seconds  bigint not null default 0,
  total_requests  bigint not null default 0,
  total_errors    bigint not null default 0,
  bot_started_at  timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ============================================================
-- RPC Functions & Triggers
-- ============================================================

create or replace function public.increment_bank_balance(p_bank_id uuid, p_amount numeric)
returns numeric language plpgsql as $$
declare v numeric;
begin
  update public.bank_accounts set current_balance = current_balance + p_amount
  where id = p_bank_id returning current_balance into v;
  return v;
end;$$;

create or replace function public.adjust_admin_holding(p_admin_id uuid, p_amount numeric)
returns numeric language plpgsql as $$
declare v numeric;
begin
  update public.admins set holding_usdt = holding_usdt + p_amount
  where id = p_admin_id returning holding_usdt into v;
  return v;
end;$$;

create or replace function public.enforce_ce_vault_pin_limit()
returns trigger language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(new.chat_id);
  if (
    select count(*) from public.pinned_bank_accounts
    where chat_id = new.chat_id and pinned_for_date = new.pinned_for_date
  ) >= 3 then
    raise exception 'PIN_LIMIT_REACHED' using errcode = '23514';
  end if;
  return new;
end;$$;

drop trigger if exists trg_ce_vault_pin_limit on public.pinned_bank_accounts;
create trigger trg_ce_vault_pin_limit
before insert on public.pinned_bank_accounts
for each row execute function public.enforce_ce_vault_pin_limit();

create or replace function public.claim_telegram_update(p_update_id bigint)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into public.telegram_updates(update_id) values (p_update_id)
  on conflict do nothing;
  return found;
end;$$;

create or replace function public.ce_vault_record_incoming(
  p_admin_id uuid,
  p_bank_account_id uuid,
  p_chat_id bigint,
  p_thb numeric,
  p_usdt numeric,
  p_sell_rate numeric,
  p_market_rate numeric,
  p_room_name text,
  p_ocr_confidence numeric,
  p_ledger_ref text,
  p_slip_image_url text,
  p_slip_fingerprint text,
  p_receiver_name text,
  p_receiver_bank text,
  p_receiver_last4 text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_thb <= 0 or p_usdt <= 0 or p_sell_rate <= 0 or p_market_rate <= 0 then
    raise exception 'INVALID_AMOUNT_OR_RATE' using errcode = '22023';
  end if;
  insert into public.transactions (
    admin_id, bank_account_id, chat_id, type, thb_amount, usdt_amount,
    sell_rate, buy_rate, cost_per_unit, sell_value_thb, net_profit_thb,
    profit_percent, room_name, ocr_confidence, ledger_ref, note,
    slip_image_url, slip_fingerprint, receiver_name, receiver_bank, receiver_last4
  ) values (
    p_admin_id, p_bank_account_id, p_chat_id, 'THB_DEPOSIT', p_thb, p_usdt,
    p_sell_rate, p_sell_rate, p_market_rate, p_thb, p_thb - (p_usdt * p_market_rate),
    ((p_thb - (p_usdt * p_market_rate)) / p_thb) * 100,
    p_room_name, p_ocr_confidence, p_ledger_ref, p_ledger_ref,
    coalesce(p_slip_image_url, ''), p_slip_fingerprint,
    p_receiver_name, p_receiver_bank, p_receiver_last4
  ) returning id into v_id;

  if p_bank_account_id is not null then
    update public.bank_accounts
      set current_balance = current_balance + p_thb
      where id = p_bank_account_id;
    if not found then raise exception 'BANK_ACCOUNT_NOT_FOUND' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;$$;

create or replace function public.ce_vault_record_outgoing(
  p_admin_id uuid,
  p_chat_id bigint,
  p_usdt numeric,
  p_ledger_ref text,
  p_slip_image_url text,
  p_slip_fingerprint text,
  p_usdt_network text,
  p_usdt_txid text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_usdt <= 0 then raise exception 'INVALID_AMOUNT' using errcode = '22023'; end if;
  insert into public.transactions (
    admin_id, chat_id, type, usdt_amount, ledger_ref, note, slip_image_url,
    slip_fingerprint, usdt_network, usdt_txid, usdt_image_url
  ) values (
    p_admin_id, p_chat_id, 'USDT_SEND', p_usdt, p_ledger_ref, p_ledger_ref,
    coalesce(p_slip_image_url, ''), p_slip_fingerprint, p_usdt_network,
    p_usdt_txid, nullif(p_slip_image_url, '')
  ) returning id into v_id;
  return v_id;
end;$$;

create or replace function public.ce_vault_update_ledger_transaction(
  p_tx_id uuid,
  p_new_thb numeric,
  p_new_usdt numeric,
  p_market_rate numeric
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.transactions%rowtype;
declare v_thb_delta numeric;
begin
  select * into v from public.transactions where id = p_tx_id for update;
  if not found or v.ledger_ref is null then raise exception 'TRANSACTION_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_new_usdt <= 0 or p_new_thb < 0 or p_market_rate <= 0 then raise exception 'INVALID_AMOUNT' using errcode = '22023'; end if;

  if v.type = 'THB_DEPOSIT' then
    if p_new_thb <= 0 then raise exception 'INVALID_THB_AMOUNT' using errcode = '22023'; end if;
    v_thb_delta := p_new_thb - v.thb_amount;
    update public.transactions set
      thb_amount = p_new_thb,
      usdt_amount = p_new_usdt,
      cost_per_unit = p_market_rate,
      sell_value_thb = p_new_thb,
      net_profit_thb = p_new_thb - (p_new_usdt * p_market_rate),
      profit_percent = ((p_new_thb - (p_new_usdt * p_market_rate)) / p_new_thb) * 100,
      updated_at = now()
    where id = p_tx_id returning * into v;
    if v.bank_account_id is not null then
      update public.bank_accounts set current_balance = current_balance + v_thb_delta where id = v.bank_account_id;
    end if;
  else
    update public.transactions set usdt_amount = p_new_usdt, updated_at = now()
      where id = p_tx_id returning * into v;
  end if;
  return to_jsonb(v);
end;$$;

create or replace function public.ce_vault_delete_ledger_transaction(p_tx_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v public.transactions%rowtype;
begin
  select * into v from public.transactions where id = p_tx_id for update;
  if not found or v.ledger_ref is null then raise exception 'TRANSACTION_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.type = 'THB_DEPOSIT' and v.bank_account_id is not null then
    update public.bank_accounts set current_balance = current_balance - v.thb_amount where id = v.bank_account_id;
  end if;
  delete from public.transactions where id = p_tx_id;
  return true;
end;$$;

create or replace function public.register_failed_login(
  p_ip text,
  p_max_attempts integer default 5,
  p_lock_minutes integer default 15
)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v_attempts integer;
  v_locked   timestamptz;
begin
  insert into public.dashboard_login_attempts (ip, attempts, updated_at)
  values (p_ip, 1, now())
  on conflict (ip) do update
    set attempts = public.dashboard_login_attempts.attempts + 1,
        updated_at = now()
  returning attempts, locked_until into v_attempts, v_locked;

  if v_attempts >= p_max_attempts then
    update public.dashboard_login_attempts
      set locked_until = now() + make_interval(mins => p_lock_minutes),
          attempts = 0
      where ip = p_ip
      returning locked_until into v_locked;
  end if;

  return v_locked;
end;$$;

create or replace function public.clear_login_attempts(p_ip text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.dashboard_login_attempts where ip = p_ip;
end;$$;

-- ============================================================
-- Row Level Security (RLS) & Permissions
-- ============================================================

alter table public.admins                   enable row level security;
alter table public.bank_accounts             enable row level security;
alter table public.pinned_bank_accounts      enable row level security;
alter table public.receivers                 enable row level security;
alter table public.transactions              enable row level security;
alter table public.transaction_status_logs  enable row level security;
alter table public.rates                    enable row level security;
alter table public.bot_sessions             enable row level security;
alter table public.chat_settings            enable row level security;
alter table public.telegram_updates         enable row level security;
alter table public.system_settings           enable row level security;
alter table public.dashboard_login_attempts enable row level security;
alter table public.bot_metrics              enable row level security;

-- Drop existing policies if any
drop policy if exists "anon can read admins" on public.admins;
drop policy if exists "anon can read bank_accounts" on public.bank_accounts;
drop policy if exists "anon can read transactions" on public.transactions;
drop policy if exists "anon can read rates" on public.rates;
drop policy if exists "receivers anon read" on public.receivers;
drop policy if exists "bot_metrics_open_access" on public.bot_metrics;
drop policy if exists "bot_metrics_select" on public.bot_metrics;

create policy "anon can read admins"        on public.admins        for select to anon, authenticated using (true);
create policy "anon can read bank_accounts" on public.bank_accounts for select to anon, authenticated using (true);
create policy "anon can read transactions"  on public.transactions  for select to anon, authenticated using (true);
create policy "anon can read rates"         on public.rates         for select to anon, authenticated using (true);
create policy "receivers anon read"         on public.receivers     for select to anon, authenticated using (true);
create policy "bot_metrics_select"          on public.bot_metrics    for select to anon, authenticated using (true);

-- Permissions for service role functions
revoke all on function public.claim_telegram_update(bigint) from public, anon, authenticated;
grant execute on function public.claim_telegram_update(bigint) to service_role;

revoke all on function public.ce_vault_record_incoming(uuid,uuid,bigint,numeric,numeric,numeric,numeric,text,numeric,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.ce_vault_record_incoming(uuid,uuid,bigint,numeric,numeric,numeric,numeric,text,numeric,text,text,text,text,text,text) to service_role;

revoke all on function public.ce_vault_record_outgoing(uuid,bigint,numeric,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.ce_vault_record_outgoing(uuid,bigint,numeric,text,text,text,text,text) to service_role;

revoke all on function public.ce_vault_update_ledger_transaction(uuid,numeric,numeric,numeric) from public, anon, authenticated;
grant execute on function public.ce_vault_update_ledger_transaction(uuid,numeric,numeric,numeric) to service_role;

revoke all on function public.ce_vault_delete_ledger_transaction(uuid) from public, anon, authenticated;
grant execute on function public.ce_vault_delete_ledger_transaction(uuid) to service_role;

-- ============================================================
-- Supabase Realtime
-- ============================================================

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='transactions') then
    alter publication supabase_realtime add table public.transactions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='admins') then
    alter publication supabase_realtime add table public.admins;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='bot_metrics') then
    alter publication supabase_realtime add table public.bot_metrics;
  end if;
end$$;

-- ============================================================
-- Seed Initial Data
-- ============================================================

insert into public.bank_accounts (label, bank_name, account_number, current_balance)
select 'กสิกร - หลัก', 'KBANK', 'xxx-x-xxxxx-x', 0
where not exists (select 1 from public.bank_accounts);

insert into public.system_settings (key, value)
values ('bot_enabled', 'true'::jsonb)
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('maintenance_message', '"ระบบกำลังปิดปรับปรุงชั่วคราว กรุณาลองใหม่ภายหลัง"'::jsonb)
on conflict (key) do nothing;

insert into public.bot_metrics (id, error_rate, avg_response_ms, rate_limit_pct, uptime_seconds, total_requests, total_errors, bot_started_at, updated_at)
values ('singleton', 0, 0, 0, 0, 0, 0, now(), now())
on conflict (id) do nothing;
