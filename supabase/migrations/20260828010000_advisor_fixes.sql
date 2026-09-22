drop policy if exists invoices_update_drafts on public.invoices;
drop policy if exists invoices_update_accounting on public.invoices;

create policy invoices_update on public.invoices for update to authenticated
using (private.is_member(organization_id, array['admin','accounting']::public.member_role[]) or (status = 'draft' and private.is_member(organization_id)))
with check (private.is_member(organization_id, array['admin','accounting']::public.member_role[]) or (status = 'draft' and private.is_member(organization_id)));

alter table public.invoice_sequences set schema private;

create index if not exists clients_created_by_idx on public.clients(created_by);
create index if not exists invoices_client_idx on public.invoices(client_id);
create index if not exists invoices_created_by_idx on public.invoices(created_by);
create index if not exists invoices_updated_by_idx on public.invoices(updated_by);
create index if not exists payments_org_idx on public.payments(organization_id);
create index if not exists payments_created_by_idx on public.payments(created_by);
create index if not exists invoice_events_org_idx on public.invoice_events(organization_id);
create index if not exists invoice_events_actor_idx on public.invoice_events(actor_id);
create index if not exists organization_members_user_idx on public.organization_members(user_id);
