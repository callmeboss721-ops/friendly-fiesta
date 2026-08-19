-- ============================================================
-- CE VAULT patch v13: Postgres best practices + go-live bootstrap
-- Idempotent. Safe on empty or already-seeded databases.
-- Rules: query-missing-indexes, schema-foreign-key-indexes,
--        query-composite-indexes, query-partial-indexes,
--        security-rls-basics, security-rls-performance,
--        security-privileges, schema-constraints
-- ============================================================

-- 1) Receivers: align simplified schema.sql table with patch-v3 columns
--    the app actually writes (account_hash / account_last4 / stats).
alter table public.receivers
  add column if not exists account_hash         text,
  add column if not exists bank                 text,
  add column if not exists receiver_name        text,
  add column if not exists account_last4        text,
  add column if not exists total_transactions   integer       not null default 0,
  add column if not exists total_amount_thb     numeric(20,2) not null default 0,
  add column if not exists total_usdt           numeric(20,4) not null default 0,
  add column if not exists max_amount_thb       numeric(20,2) not null default 0,
  add column if not exists last_amount_thb      numeric(20,2) not null default 0,
  add column if not exists first_transaction_at timestamptz,
  add column if not exists last_transaction_at  timestamptz,
  add column if not exists last_ledger_ref      text,
  add column if not exists status               text          not null default 'normal';

alter table public.receivers alter column name drop not null;

update public.receivers
set
  receiver_name = coalesce(receiver_name, name),
  bank          = coalesce(bank, bank_name),
  account_last4 = coalesce(nullif(account_last4, ''), last4, ''),
  last4         = coalesce(last4, account_last4),
  bank_name     = coalesce(bank_name, bank)
where receiver_name is null
   or bank is null
   or coalesce(account_last4, '') = ''
   or last4 is null
   or bank_name is null;

update public.receivers
set account_hash = encode(sha256(convert_to(upper(coalesce(bank, bank_name, 'UNKNOWN')) || '|' || coalesce(account_last4, last4, ''), 'utf8')), 'hex')
where account_hash is null
  and coalesce(account_last4, last4, '') <> '';

create or replace function public.receivers_sync_compat()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.receiver_name is not null and coalesce(new.name, '') = '' then
    new.name := new.receiver_name;
  elsif new.name is not null and new.receiver_name is null then
    new.receiver_name := new.name;
  end if;
  if new.name is null then
    new.name := coalesce(new.receiver_name, 'unknown');
  end if;

  if new.account_last4 is not null and new.last4 is null then
    new.last4 := new.account_last4;
  elsif new.last4 is not null and coalesce(new.account_last4, '') = '' then
    new.account_last4 := new.last4;
  end if;
  if coalesce(new.account_last4, '') = '' then
    new.account_last4 := coalesce(new.last4, '');
  end if;

  if new.bank is not null and new.bank_name is null then
    new.bank_name := new.bank;
  elsif new.bank_name is not null and new.bank is null then
    new.bank := new.bank_name;
  end if;

  if new.account_hash is null and coalesce(new.account_last4, '') <> '' then
    new.account_hash := encode(
      sha256(convert_to(upper(coalesce(new.bank, new.bank_name, 'UNKNOWN')) || '|' || new.account_last4, 'utf8')),
      'hex'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_receivers_sync_compat on public.receivers;
create trigger trg_receivers_sync_compat
before insert or update on public.receivers
for each row execute function public.receivers_sync_compat();

create unique index if not exists uq_receivers_account_hash
  on public.receivers (account_hash)
  where account_hash is not null;
create index if not exists receivers_last4_idx
  on public.receivers (account_last4)
  where account_last4 is not null;

-- 2) FK covering indexes (full, not partial — linter + ON DELETE CASCADE)
create index if not exists idx_tx_bank_account_id
  on public.transactions (bank_account_id);
create index if not exists idx_tx_receiver_id
  on public.transactions (receiver_id);
create index if not exists idx_rates_set_by_admin_id
  on public.rates (set_by_admin_id);
create index if not exists idx_pinned_bank_account_id
  on public.pinned_bank_accounts (bank_account_id);

-- 3) Composite / partial indexes matching live dashboard + bot queries
create index if not exists idx_tx_bank_created
  on public.transactions (bank_account_id, created_at desc);
create index if not exists idx_tx_status_created
  on public.transactions (status, created_at desc);
create index if not exists idx_tx_chat_id
  on public.transactions (chat_id)
  where chat_id is not null;
create index if not exists idx_tx_live_status
  on public.transactions (live_status, created_at desc)
  where live_status is not null;
create index if not exists idx_bot_sessions_admin
  on public.bot_sessions (admin_id)
  where admin_id is not null;
create index if not exists idx_bot_sessions_live_tx
  on public.bot_sessions (live_tx_id)
  where live_tx_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'transaction_status_logs_transaction_id_fkey'
      and conrelid = 'public.transaction_status_logs'::regclass
  ) then
    alter table public.transaction_status_logs
      add constraint transaction_status_logs_transaction_id_fkey
      foreign key (transaction_id) references public.transactions(id) on delete cascade;
  end if;
end $$;

-- 4) Money-mutating RPCs: lock search_path, service_role only
create or replace function public.increment_bank_balance(p_bank_id uuid, p_amount numeric)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare v numeric;
begin
  update public.bank_accounts
     set current_balance = current_balance + p_amount
   where id = p_bank_id
   returning current_balance into v;
  return v;
end;
$$;

create or replace function public.adjust_admin_holding(p_admin_id uuid, p_amount numeric)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare v numeric;
begin
  update public.admins
     set holding_usdt = holding_usdt + p_amount
   where id = p_admin_id
   returning holding_usdt into v;
  return v;
end;
$$;

revoke all on function public.increment_bank_balance(uuid, numeric) from public, anon, authenticated;
grant execute on function public.increment_bank_balance(uuid, numeric) to service_role;
revoke all on function public.adjust_admin_holding(uuid, numeric) from public, anon, authenticated;
grant execute on function public.adjust_admin_holding(uuid, numeric) to service_role;

create or replace function public.register_failed_login(
  p_ip text,
  p_max_attempts integer default 5,
  p_lock_minutes integer default 15
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
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
end;
$$;

create or replace function public.clear_login_attempts(p_ip text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.dashboard_login_attempts where ip = p_ip;
end;
$$;

revoke all on function public.register_failed_login(text, integer, integer) from public, anon, authenticated;
grant execute on function public.register_failed_login(text, integer, integer) to service_role;
revoke all on function public.clear_login_attempts(text) from public, anon, authenticated;
grant execute on function public.clear_login_attempts(text) to service_role;

-- 5) RLS: dashboard needs SELECT (anon key + Realtime). Writes stay service_role.
--    bot_metrics previously allowed public ALL — anyone with the publishable key could write.
drop policy if exists "anon can read admins" on public.admins;
drop policy if exists "anon can read bank_accounts" on public.bank_accounts;
drop policy if exists "anon can read transactions" on public.transactions;
drop policy if exists "anon can read rates" on public.rates;
drop policy if exists "receivers anon read" on public.receivers;
drop policy if exists "bot_metrics_open_access" on public.bot_metrics;
drop policy if exists "bot_metrics_select" on public.bot_metrics;

create policy "anon can read admins"
  on public.admins for select to anon, authenticated using (true);
create policy "anon can read bank_accounts"
  on public.bank_accounts for select to anon, authenticated using (true);
create policy "anon can read transactions"
  on public.transactions for select to anon, authenticated using (true);
create policy "anon can read rates"
  on public.rates for select to anon, authenticated using (true);
create policy "receivers anon read"
  on public.receivers for select to anon, authenticated using (true);
create policy "bot_metrics_select"
  on public.bot_metrics for select to anon, authenticated using (true);

revoke all on table public.bot_sessions from anon, authenticated;
revoke all on table public.telegram_updates from anon, authenticated;
revoke all on table public.dashboard_login_attempts from anon, authenticated;
revoke all on table public.pinned_bank_accounts from anon, authenticated;
revoke all on table public.system_settings from anon, authenticated;
revoke all on table public.transaction_status_logs from anon, authenticated;

-- 6) Realtime publication (dashboard tables)
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'transactions') then
    alter publication supabase_realtime add table public.transactions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'admins') then
    alter publication supabase_realtime add table public.admins;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'bot_metrics') then
    alter publication supabase_realtime add table public.bot_metrics;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'rates') then
    alter publication supabase_realtime add table public.rates;
  end if;
end $$;

-- 7) Bootstrap operational rows so the dashboard is usable immediately
insert into public.admins (name, telegram_user_id, holding_usdt, role)
select 'Boss', 123456789, 0, 'Operator'
where not exists (select 1 from public.admins);

insert into public.bank_accounts (label, bank_name, account_number, current_balance)
select 'กสิกร - หลัก', 'KBANK', '1234567890', 0
where not exists (select 1 from public.bank_accounts);

update public.bank_accounts
set account_number = '1234567890'
where account_number is null
   or account_number ilike '%x%'
   or length(regexp_replace(account_number, '\D', '', 'g')) < 4;

insert into public.rates (sell_rate, market_usdt_rate, set_by_admin_id)
select 35.5, 34.8, (select id from public.admins order by created_at limit 1)
where not exists (select 1 from public.rates);

insert into public.system_settings (key, value)
values
  ('bot_enabled', 'true'::jsonb),
  ('maintenance_message', '"ระบบกำลังปิดปรับปรุงชั่วคราว กรุณาลองใหม่ภายหลัง"'::jsonb)
on conflict (key) do nothing;

insert into public.bot_metrics (id)
values ('singleton')
on conflict (id) do nothing;

-- Sample ledger rows only when the table is empty (do not pollute live books)
insert into public.transactions (
  admin_id, bank_account_id, chat_id, type, status,
  thb_amount, usdt_amount, sell_rate, buy_rate, cost_per_unit,
  sell_value_thb, net_profit_thb, profit_percent,
  expected_usdt, fee_usdt, fee_percent,
  note, slip_image_url, slip_fingerprint, room_name, ocr_confidence,
  receiver_name, receiver_bank, receiver_last4, ledger_ref
)
select
  a.id, b.id, 123456789, 'THB_DEPOSIT', 'ocr_success',
  5000, 140, 35.5, 35.5, 34.8,
  5000, 128, 2.56,
  140.80, 0.80, 0.57,
  'CE-BOOTSTRAP-IN', 'https://example.invalid/slips/bootstrap-in.jpg', 'bootstrap-in-fp',
  'CE Vault', 96.5, 'สมชาย ใจดี', 'KBANK', '7890', 'CE-BOOTSTRAP-IN'
from public.admins a
cross join public.bank_accounts b
where not exists (select 1 from public.transactions)
limit 1;

insert into public.transactions (
  admin_id, bank_account_id, chat_id, type, status,
  thb_amount, usdt_amount, sell_rate, cost_per_unit,
  usdt_network, usdt_txid, note, ledger_ref
)
select
  a.id, b.id, 123456789, 'USDT_SEND', 'ocr_success',
  0, 140, 35.5, 34.8,
  'TRC20', 'bootstraptxid0001', 'CE-BOOTSTRAP-OUT', 'CE-BOOTSTRAP-OUT'
from public.admins a
cross join public.bank_accounts b
where (select count(*) from public.transactions) = 1
limit 1;

update public.bank_accounts b
set current_balance = coalesce((
  select sum(t.thb_amount) from public.transactions t
  where t.bank_account_id = b.id and t.type = 'THB_DEPOSIT'
), b.current_balance)
where exists (select 1 from public.transactions t where t.bank_account_id = b.id);

insert into public.pinned_bank_accounts (chat_id, bank_account_id, pinned_for_date)
select 123456789, b.id, (timezone('Asia/Bangkok', now()))::date
from public.bank_accounts b
where not exists (
  select 1 from public.pinned_bank_accounts p
  where p.chat_id = 123456789 and p.pinned_for_date = (timezone('Asia/Bangkok', now()))::date
)
limit 1;

analyze public.admins;
analyze public.bank_accounts;
analyze public.receivers;
analyze public.transactions;
analyze public.rates;
analyze public.pinned_bank_accounts;
analyze public.bot_sessions;
analyze public.transaction_status_logs;
