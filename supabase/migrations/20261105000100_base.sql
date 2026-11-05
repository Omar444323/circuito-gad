-- Circuito GAD · Fase 1: base
create table public.empresas (
  id smallint primary key check (id between 1 and 6),
  nombre text not null check (length(trim(nombre)) > 0),
  corto text not null,
  sector text not null,
  actividad text not null,
  iban text not null unique,
  saldo_inicial numeric(14,2) not null,
  con_almacen boolean not null default false
);
create table public.perfiles (
  id uuid primary key references auth.users(id) on delete restrict,
  usuario text not null unique,
  nombre text not null check (length(trim(nombre)) > 0),
  rol text not null check (rol in ('alumno','profesora')),
  empresa_id smallint references public.empresas(id),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  check ((rol = 'profesora' and empresa_id is null) or (rol = 'alumno' and empresa_id is not null))
);
create table public.catalogo (
  id uuid primary key default gen_random_uuid(),
  empresa_id smallint not null references public.empresas(id) check (empresa_id <> 5),
  nombre text not null check (length(trim(nombre)) > 0),
  precio numeric(12,2) not null check (precio > 0),
  activo boolean not null default true
);
create unique index catalogo_nombre_activo on public.catalogo (empresa_id, lower(nombre)) where activo;
create table public.articulos (
  id uuid primary key default gen_random_uuid(),
  empresa_id smallint not null references public.empresas(id),
  nombre text not null,
  cuenta smallint not null check (cuenta in (300,310,350)),
  unidades numeric(14,3) not null default 0 check (unidades >= 0),
  valor numeric(14,2) not null default 0,
  catalogo_id uuid references public.catalogo(id),
  articulo_proveedor_id uuid references public.articulos(id)
);
create table public.recetas (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null unique references public.articulos(id)
);
create table public.recetas_lineas (
  receta_id uuid not null references public.recetas(id) on delete cascade,
  materia_id uuid not null references public.articulos(id),
  cantidad numeric(12,3) not null check (cantidad > 0),
  primary key (receta_id, materia_id)
);
create table public.movimientos_banco (
  id bigint generated always as identity primary key,
  empresa_id smallint not null references public.empresas(id),
  fecha date not null,
  concepto text not null,
  importe numeric(14,2) not null,
  saldo numeric(14,2) not null,
  justificante text,
  punteado boolean not null default false
);
create table public.calendario (
  fecha date primary key,
  motivo text not null
);
create table public.modulos (
  clave text primary key,
  nombre text not null,
  activo boolean not null default false
);
create table public.condiciones_banco (
  id bigint generated always as identity primary key,
  comision_transferencia numeric(8,2) not null check (comision_transferencia >= 0),
  vigente_desde timestamptz not null default now(),
  publicada_por uuid references public.perfiles(id)
);
create table public.registro_cambios (
  id bigint generated always as identity primary key,
  empresa_id smallint references public.empresas(id),
  entidad text not null,
  campo text not null,
  valor_anterior text,
  valor_nuevo text,
  hecho_por uuid references public.perfiles(id),
  creado_en timestamptz not null default now()
);
create index registro_cambios_empresa on public.registro_cambios (empresa_id, creado_en desc);
