-- Additive P0 schema only. Review and apply manually after a live-schema audit.
create table if not exists reconciliation_cycles (
  id uuid primary key default gen_random_uuid(),
  cycle_key text not null unique,
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists reconciliation_deposits (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references reconciliation_cycles(id),
  idempotency_key text not null unique,
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null check (currency = upper(currency)),
  reconciliation_status text not null default 'RECEIVED' check (reconciliation_status in ('RECEIVED','OCR_VERIFIED','MATCHED','READY','SENT','SETTLED','DUPLICATE','MISMATCH','MISSING_BANK_CREDIT')),
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists reconciliation_slips (
  id uuid primary key default gen_random_uuid(),
  deposit_id uuid not null references reconciliation_deposits(id) on delete cascade,
  object_key text not null,
  content_sha256 text not null unique check (length(content_sha256) = 64),
  created_at timestamptz not null default now()
);

create table if not exists reconciliation_ocr_results (
  id uuid primary key default gen_random_uuid(),
  slip_id uuid not null references reconciliation_slips(id) on delete cascade,
  provider text not null,
  confidence_basis_points integer not null check (confidence_basis_points between 0 and 10000),
  extracted jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists reconciliation_matches (
  id uuid primary key default gen_random_uuid(),
  deposit_id uuid not null references reconciliation_deposits(id) on delete cascade,
  external_reference text not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null check (currency = upper(currency)),
  matched_at timestamptz not null default now(),
  unique (deposit_id, external_reference)
);

create table if not exists reconciliation_settlements (
  id uuid primary key default gen_random_uuid(),
  deposit_id uuid not null unique references reconciliation_deposits(id),
  idempotency_key text not null unique,
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null check (currency = upper(currency)),
  bank_reference text,
  sent_at timestamptz,
  settled_at timestamptz
);

create table if not exists reconciliation_exceptions (
  id uuid primary key default gen_random_uuid(),
  deposit_id uuid not null references reconciliation_deposits(id) on delete cascade,
  exception_type text not null check (exception_type in ('AMOUNT_MISMATCH','TIMING_GAP','DUPLICATE','UNKNOWN_TRANSACTION','MISSING_BANK_CREDIT')),
  severity text not null check (severity in ('AUTO_RESOLVE','REVIEW_REQUIRED','ESCALATE')),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists reconciliation_audit_logs (
  id bigint generated always as identity primary key,
  entity_type text not null,
  entity_id uuid not null,
  actor_id text not null,
  action text not null,
  before_state jsonb,
  after_state jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists reconciliation_deposits_cycle_status_idx on reconciliation_deposits(cycle_id, reconciliation_status);
create index if not exists reconciliation_exceptions_open_idx on reconciliation_exceptions(created_at) where resolved_at is null;
create index if not exists reconciliation_audit_entity_idx on reconciliation_audit_logs(entity_type, entity_id, occurred_at desc);

alter table reconciliation_cycles enable row level security;
alter table reconciliation_deposits enable row level security;
alter table reconciliation_slips enable row level security;
alter table reconciliation_ocr_results enable row level security;
alter table reconciliation_matches enable row level security;
alter table reconciliation_settlements enable row level security;
alter table reconciliation_exceptions enable row level security;
alter table reconciliation_audit_logs enable row level security;

comment on table reconciliation_deposits is 'Canonical additive reconciliation model; server-only until explicit RLS policies are approved.';
