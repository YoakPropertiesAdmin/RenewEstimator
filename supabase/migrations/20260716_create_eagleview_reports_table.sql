-- Property-level storage for EagleView Measurement Orders (roof + siding), so one report
-- serves every quote/change order for an address (like SumoQuote applies to the property).
-- Written to reflect the schema already applied to the remote DB on 2026-07-16.
create table if not exists public.eagleview_reports (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null default '5249f9c0-9fca-46c8-896c-4e35be437024',
  report_type         text not null check (report_type in ('roof','siding')),
  ev_report_id        text,
  product_id          integer,
  delivery_product_id integer,
  status              text not null default 'ordered',  -- ordered | processing | complete | failed | cancelled
  address             text,
  city                text,
  state               text,
  zip                 text,
  address_key         text,                             -- normalized "addr|city|state|zip" for lookup
  price               numeric,
  measurements        jsonb,                            -- flattened OVERALL_SUMMARY
  raw                 jsonb,
  quote_id            uuid,
  ordered_by          uuid,
  ordered_at          timestamptz not null default now(),
  delivered_at        timestamptz,
  updated_at          timestamptz not null default now()
);

create index if not exists eagleview_reports_addr_idx on public.eagleview_reports (tenant_id, address_key);
create index if not exists eagleview_reports_evid_idx on public.eagleview_reports (ev_report_id);

alter table public.eagleview_reports enable row level security;

create policy "ev_reports: tenant read" on public.eagleview_reports
  for select to authenticated using (tenant_id = private.get_my_tenant_id());
create policy "ev_reports: tenant insert" on public.eagleview_reports
  for insert to authenticated with check (tenant_id = private.get_my_tenant_id());
create policy "ev_reports: tenant update" on public.eagleview_reports
  for update to authenticated using (tenant_id = private.get_my_tenant_id());

create trigger set_ev_reports_updated_at before update on public.eagleview_reports
  for each row execute function public.set_updated_at();
