-- ============================================================
-- MCCAIN · RASTREO DE EMBARQUES REFRIGERADOS
-- Esquema para Supabase (Postgres)
-- ============================================================
-- Ejecuta este script UNA VEZ en: Supabase -> SQL Editor -> New query
-- Reemplaza a schema.sql (versión SQL Server) si tu backend es Supabase.
-- ============================================================

create table public.embarques (
  id                     bigint generated always as identity primary key,
  orden_cliente          text not null,
  cliente                text not null,
  orden_interna_sap      text not null,
  shipment_number        text not null unique,
  temperatura_req_min    numeric(5,1) not null,
  temperatura_req_max    numeric(5,1) not null,
  fecha_carga            date not null,
  hora_carga             time not null,
  fecha_entrega          date not null,
  hora_cita_cliente      time not null,
  linea_transporte       text not null,
  numero_caja            text not null,
  nombre_chofer          text not null,
  hora_llegada_cliente   time,          -- NULL = aún en tránsito
  hora_apertura_caja     time,
  temperatura_apertura   numeric(5,1),
  creado_en              timestamptz not null default now()
);

-- Índices para que el buscador responda al instante por cualquiera
-- de los tres campos de búsqueda del dashboard.
create index idx_embarques_orden_cliente     on public.embarques (orden_cliente);
create index idx_embarques_orden_interna_sap on public.embarques (orden_interna_sap);
create index idx_embarques_shipment_number   on public.embarques (shipment_number);

create table public.lecturas_temperatura (
  id                bigint generated always as identity primary key,
  embarque_id       bigint not null references public.embarques (id) on delete cascade,
  fecha_hora        timestamptz not null,
  temperatura_real  numeric(5,1) not null,
  setpoint          numeric(5,1) not null,
  limite_superior   numeric(5,1) not null,
  limite_inferior   numeric(5,1) not null
);

create index idx_lecturas_embarque_fecha on public.lecturas_temperatura (embarque_id, fecha_hora);


-- ============================================================
-- SEGURIDAD (Row Level Security)
-- ============================================================
-- El sitio es estático y llama a Supabase directo desde el navegador
-- con la "anon key" (pública, no es secreta). Por eso TODA tabla debe
-- tener RLS activado con una política explícita: aquí solo permitimos
-- LECTURA pública (como un número de rastreo de paquetería), nunca
-- escritura. Cargas/actualizaciones de datos se hacen desde el SQL
-- Editor, un backoffice interno, o con la "service_role key" (esa sí
-- secreta, jamás debe ir en el frontend).

alter table public.embarques enable row level security;
alter table public.lecturas_temperatura enable row level security;

create policy "Lectura pública de embarques"
  on public.embarques
  for select
  using (true);

create policy "Lectura pública de lecturas de temperatura"
  on public.lecturas_temperatura
  for select
  using (true);

-- Otorga el privilegio de SELECT a los roles públicos de la API.
grant select on public.embarques to anon, authenticated;
grant select on public.lecturas_temperatura to anon, authenticated;


-- ============================================================
-- CONSULTA DE PRUEBA (para validar en el SQL Editor)
-- ============================================================
select e.orden_cliente, e.cliente, e.shipment_number, count(l.id) as lecturas
from public.embarques e
left join public.lecturas_temperatura l on l.embarque_id = e.id
group by e.id
order by e.id;

-- Una vez creado el esquema, ejecuta supabase-seed.sql para cargar
-- los 3 embarques de ejemplo (mismos datos que data.json).
