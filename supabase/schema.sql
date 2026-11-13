-- TerraPass v3 · Supabase schema (run in Supabase > SQL Editor)
-- Tables used by the web app: ground_truth (IoT Cal/Val), aois, grid_cells, radar_series, passport_events

create extension if not exists postgis;

create table if not exists public.aois (
  id text primary key,
  name text not null,
  latitude double precision,
  longitude double precision,
  description text,
  geom geography(point, 4326)
);

create table if not exists public.ground_truth (
  id bigint generated always as identity primary key,
  timestamp timestamptz not null default now(),
  node_id text not null,
  aoi_id text references public.aois(id),
  cell_id int,
  soil_moisture_pct real,
  water_level_cm real,
  dielectric_eps real,
  ambient_temp_c real,
  air_humidity_pct real,
  vibration_g real,
  tilt_deg real,
  local_regime text
);
create index if not exists ground_truth_ts on public.ground_truth (timestamp desc);

create table if not exists public.grid_cells (
  id bigint generated always as identity primary key,
  aoi_id text references public.aois(id),
  row_idx int not null,
  col_idx int not null,
  unique (aoi_id, row_idx, col_idx)
);

create table if not exists public.radar_series (
  cell_id bigint references public.grid_cells(id) on delete cascade,
  pass_index int not null,
  observation_date text,
  hh_db real,
  hv_db real,
  coherence real,
  displacement_mm real,
  primary key (cell_id, pass_index)
);

create table if not exists public.passport_events (
  id bigint generated always as identity primary key,
  created_at timestamptz default now(),
  cell_id bigint references public.grid_cells(id) on delete cascade,
  event_type text,
  start_pass int,
  end_pass int,
  confidence_score real,
  confidence_level text,
  human_explanation text,
  technical_signal text,
  calval_verified boolean default false
);

insert into public.aois (id, name, latitude, longitude, description, geom) values
  ('ven', 'Venezuela · Yaracuy–Carabobo fault zone', 10.45, -68.45, 'GUNW coseismic monitoring of the 24 Jun 2026 M7.2/M7.5 doublet', st_point(-68.45, 10.45)::geography),
  ('per', 'Peru · Huallaga–Mayo rice valley', -6.45, -76.4, 'GCOV double-bounce under flooded forest and rice paddies', st_point(-76.4, -6.45)::geography),
  ('ctl', 'Chile · Atacama hyper-arid control', -24.1, -69.9, 'Negative control for false-positive rate', st_point(-69.9, -24.1)::geography)
on conflict (id) do update set name = excluded.name, latitude = excluded.latitude, longitude = excluded.longitude, description = excluded.description, geom = excluded.geom;

-- Row Level Security: public demo (read + insert only, no update/delete from the browser)
alter table public.aois enable row level security;
alter table public.ground_truth enable row level security;
alter table public.grid_cells enable row level security;
alter table public.radar_series enable row level security;
alter table public.passport_events enable row level security;

do $$ begin
  create policy "read aois" on public.aois for select using (true);
  create policy "read gt" on public.ground_truth for select using (true);
  create policy "insert gt" on public.ground_truth for insert with check (true);
  create policy "read cells" on public.grid_cells for select using (true);
  create policy "insert cells" on public.grid_cells for insert with check (true);
  create policy "update cells" on public.grid_cells for update using (true);
  create policy "read series" on public.radar_series for select using (true);
  create policy "insert series" on public.radar_series for insert with check (true);
  create policy "update series" on public.radar_series for update using (true);
  create policy "read events" on public.passport_events for select using (true);
  create policy "insert events" on public.passport_events for insert with check (true);
exception when duplicate_object then null; end $$;

-- Realtime stream for the Cal/Val log
alter publication supabase_realtime add table public.ground_truth;
