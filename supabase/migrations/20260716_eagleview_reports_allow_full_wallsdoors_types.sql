-- Support the real EagleView products the team orders: Full House (roof+siding) and
-- Walls, Windows & Doors, alongside the existing roof/siding values.
alter table public.eagleview_reports drop constraint if exists eagleview_reports_report_type_check;
alter table public.eagleview_reports
  add constraint eagleview_reports_report_type_check
  check (report_type in ('roof','siding','full','wallsdoors'));
