create extension if not exists pgcrypto;

create type public.member_role as enum ('admin', 'accounting', 'operations');
create type public.invoice_status as enum ('draft', 'issued', 'sent', 'partially_paid', 'paid', 'void', 'cancelled');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'operations',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_name text not null,
  contact_name text not null default '',
  email text not null default '',
  phone text not null default '',
  address text not null default '',
  notes text not null default '',
  legacy_id text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  invoice_number text,
  status public.invoice_status not null default 'draft',
  issue_date date,
  due_date date,
  currency text not null default 'USD' check (currency in ('USD', 'KRW')),
  bill_to_name text not null default '',
  bill_to_contact text not null default '',
  bill_to_email text not null default '',
  bill_to_address text not null default '',
  vat_mode text not null default 'exclusive' check (vat_mode in ('exclusive', 'inclusive', 'none')),
  vat_rate numeric(7,4) not null default 10 check (vat_rate >= 0),
  subtotal numeric(14,2) not null default 0,
  vat_amount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  notes text not null default '',
  payment_method text not null default 'bank',
  payment_link_url text not null default '',
  legacy_id text,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  issued_at timestamptz,
  sent_at timestamptz,
  voided_at timestamptz,
  constraint valid_dates check (due_date is null or issue_date is null or due_date >= issue_date),
  constraint invoice_number_after_issue check (status = 'draft' or invoice_number is not null),
  unique (organization_id, invoice_number)
);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  service_date date,
  vehicle text not null default '',
  description text not null,
  quantity numeric(12,2) not null default 1,
  unit_price numeric(14,2) not null default 0,
  amount numeric(14,2) not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null check (currency in ('USD', 'KRW')),
  payment_date date not null,
  method text not null default 'bank_transfer',
  reference text not null default '',
  notes text not null default '',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.invoice_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.company_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  company_name text not null,
  address text not null default '',
  email text not null default '',
  phone text not null default '',
  bank_name text not null default '',
  bank_address text not null default '',
  account_name text not null default '',
  account_number text not null default '',
  swift_code text not null default '',
  paypal text not null default '',
  updated_at timestamptz not null default now()
);

create schema if not exists private;

create table private.invoice_sequences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  year integer not null,
  month integer not null,
  last_value integer not null default 0,
  primary key (organization_id, year, month)
);

create index clients_org_name_idx on public.clients(organization_id, lower(company_name));
create index clients_created_by_idx on public.clients(created_by);
alter table public.clients add constraint clients_org_legacy_unique unique (organization_id, legacy_id);
create index invoices_org_status_due_idx on public.invoices(organization_id, status, due_date);
create index invoices_org_updated_idx on public.invoices(organization_id, updated_at desc);
create index invoices_client_idx on public.invoices(client_id);
create index invoices_created_by_idx on public.invoices(created_by);
create index invoices_updated_by_idx on public.invoices(updated_by);
alter table public.invoices add constraint invoices_org_legacy_unique unique (organization_id, legacy_id);
create index invoice_items_invoice_idx on public.invoice_items(invoice_id, sort_order);
create index payments_invoice_date_idx on public.payments(invoice_id, payment_date);
create index payments_org_idx on public.payments(organization_id);
create index payments_created_by_idx on public.payments(created_by);
create index invoice_events_invoice_idx on public.invoice_events(invoice_id, created_at desc);
create index invoice_events_org_idx on public.invoice_events(organization_id);
create index invoice_events_actor_idx on public.invoice_events(actor_id);
create index organization_members_user_idx on public.organization_members(user_id);

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_member(org_id uuid, allowed_roles public.member_role[] default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = (select auth.uid())
      and (allowed_roles is null or m.role = any(allowed_roles))
  );
$$;

revoke all on function private.is_member(uuid, public.member_role[]) from public, anon;
grant execute on function private.is_member(uuid, public.member_role[]) to authenticated;

create or replace function private.assign_invoice_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_number integer;
  issue_year integer;
  issue_month integer;
begin
  if old.status = 'draft' and new.status <> 'draft' and new.invoice_number is null then
    if not private.is_member(new.organization_id, array['admin','accounting']::public.member_role[]) then
      raise exception 'Not authorized to issue invoices';
    end if;
    new.issue_date := coalesce(new.issue_date, current_date);
    issue_year := extract(year from new.issue_date);
    issue_month := extract(month from new.issue_date);
    insert into private.invoice_sequences(organization_id, year, month, last_value)
      values (new.organization_id, issue_year, issue_month, 1)
      on conflict (organization_id, year, month)
      do update set last_value = private.invoice_sequences.last_value + 1
      returning last_value into next_number;
    new.invoice_number := format('INV-%s-%s-%s', issue_year, lpad(issue_month::text, 2, '0'), lpad(next_number::text, 3, '0'));
    new.issued_at := now();
  end if;
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

revoke all on function private.assign_invoice_number() from public, anon, authenticated;
create trigger invoices_before_update before update on public.invoices
for each row execute function private.assign_invoice_number();

create or replace function private.refresh_invoice_payment_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_invoice_id uuid := coalesce(new.invoice_id, old.invoice_id);
  invoice_total numeric;
  paid_total numeric;
  current_status public.invoice_status;
begin
  select total, status into invoice_total, current_status from public.invoices where id = target_invoice_id;
  if current_status in ('void', 'cancelled', 'draft') then return coalesce(new, old); end if;
  select coalesce(sum(amount), 0) into paid_total from public.payments where invoice_id = target_invoice_id;
  update public.invoices
    set status = case when paid_total >= invoice_total then 'paid'::public.invoice_status when paid_total > 0 then 'partially_paid'::public.invoice_status else 'sent'::public.invoice_status end,
        updated_at = now()
    where id = target_invoice_id;
  return coalesce(new, old);
end;
$$;

revoke all on function private.refresh_invoice_payment_status() from public, anon, authenticated;
create trigger payments_after_change after insert or update or delete on public.payments
for each row execute function private.refresh_invoice_payment_status();

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.clients enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payments enable row level security;
alter table public.invoice_events enable row level security;
alter table public.company_settings enable row level security;

revoke all on all tables in schema public from anon;
grant select on public.organizations, public.organization_members, public.clients, public.invoices, public.invoice_items, public.payments, public.invoice_events, public.company_settings to authenticated;
grant insert, update on public.clients, public.invoices, public.invoice_items, public.payments, public.invoice_events, public.company_settings to authenticated;
grant delete on public.clients, public.invoice_items, public.payments to authenticated;
grant usage, select on sequence public.invoice_events_id_seq to authenticated;

create policy organizations_select on public.organizations for select to authenticated
using (private.is_member(id));
create policy members_select on public.organization_members for select to authenticated
using (private.is_member(organization_id));

create policy clients_select on public.clients for select to authenticated using (private.is_member(organization_id));
create policy clients_insert on public.clients for insert to authenticated with check (private.is_member(organization_id, array['admin','accounting','operations']::public.member_role[]) and created_by = (select auth.uid()));
create policy clients_update on public.clients for update to authenticated using (private.is_member(organization_id, array['admin','accounting']::public.member_role[])) with check (private.is_member(organization_id, array['admin','accounting']::public.member_role[]));
create policy clients_delete on public.clients for delete to authenticated using (private.is_member(organization_id, array['admin']::public.member_role[]));

create policy invoices_select on public.invoices for select to authenticated using (private.is_member(organization_id));
create policy invoices_insert on public.invoices for insert to authenticated with check (private.is_member(organization_id) and created_by = (select auth.uid()) and updated_by = (select auth.uid()));
create policy invoices_update on public.invoices for update to authenticated
using (private.is_member(organization_id, array['admin','accounting']::public.member_role[]) or (status = 'draft' and private.is_member(organization_id)))
with check (private.is_member(organization_id, array['admin','accounting']::public.member_role[]) or (status = 'draft' and private.is_member(organization_id)));

create policy items_select on public.invoice_items for select to authenticated using (exists (select 1 from public.invoices i where i.id = invoice_id and private.is_member(i.organization_id)));
create policy items_insert on public.invoice_items for insert to authenticated with check (exists (select 1 from public.invoices i where i.id = invoice_id and i.status = 'draft' and private.is_member(i.organization_id)));
create policy items_update on public.invoice_items for update to authenticated using (exists (select 1 from public.invoices i where i.id = invoice_id and i.status = 'draft' and private.is_member(i.organization_id))) with check (exists (select 1 from public.invoices i where i.id = invoice_id and i.status = 'draft' and private.is_member(i.organization_id)));
create policy items_delete on public.invoice_items for delete to authenticated using (exists (select 1 from public.invoices i where i.id = invoice_id and i.status = 'draft' and private.is_member(i.organization_id)));

create policy payments_select on public.payments for select to authenticated using (private.is_member(organization_id));
create policy payments_insert on public.payments for insert to authenticated with check (private.is_member(organization_id, array['admin','accounting']::public.member_role[]) and created_by = (select auth.uid()));
create policy payments_delete on public.payments for delete to authenticated using (private.is_member(organization_id, array['admin']::public.member_role[]));

create policy events_select on public.invoice_events for select to authenticated using (private.is_member(organization_id));
create policy events_insert on public.invoice_events for insert to authenticated with check (private.is_member(organization_id) and actor_id = (select auth.uid()));

create policy settings_select on public.company_settings for select to authenticated using (private.is_member(organization_id));
create policy settings_insert on public.company_settings for insert to authenticated with check (private.is_member(organization_id, array['admin']::public.member_role[]));
create policy settings_update on public.company_settings for update to authenticated using (private.is_member(organization_id, array['admin']::public.member_role[])) with check (private.is_member(organization_id, array['admin']::public.member_role[]));

create view public.invoice_balances with (security_invoker = true) as
select i.*,
  coalesce(sum(p.amount), 0)::numeric(14,2) as amount_paid,
  greatest(i.total - coalesce(sum(p.amount), 0), 0)::numeric(14,2) as balance_due,
  case when i.status in ('sent','partially_paid','issued') and i.due_date < current_date and i.total > coalesce(sum(p.amount), 0) then true else false end as is_overdue
from public.invoices i
left join public.payments p on p.invoice_id = i.id
group by i.id;

grant select on public.invoice_balances to authenticated;
