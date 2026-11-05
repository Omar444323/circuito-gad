-- RLS: lectura por política, escritura solo mediante funciones
alter table public.empresas enable row level security;
alter table public.perfiles enable row level security;
alter table public.catalogo enable row level security;
alter table public.articulos enable row level security;
alter table public.recetas enable row level security;
alter table public.recetas_lineas enable row level security;
alter table public.movimientos_banco enable row level security;
alter table public.calendario enable row level security;
alter table public.modulos enable row level security;
alter table public.condiciones_banco enable row level security;
alter table public.registro_cambios enable row level security;
create function public.mi_empresa() returns smallint language sql stable security definer set search_path = '' as $$
  select empresa_id from public.perfiles where id = auth.uid() and activo$$;
create function public.es_profesora() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and activo and rol = 'profesora')$$;
revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to authenticated;
grant select on public.empresas, public.perfiles, public.catalogo, public.articulos, public.recetas, public.recetas_lineas, public.movimientos_banco, public.calendario, public.modulos, public.condiciones_banco, public.registro_cambios to authenticated;
create policy empresas_todos on public.empresas for select to authenticated using (public.mi_empresa() is not null or public.es_profesora());
create policy catalogo_todos on public.catalogo for select to authenticated using (public.mi_empresa() is not null or public.es_profesora());
create policy calendario_todos on public.calendario for select to authenticated using (public.mi_empresa() is not null or public.es_profesora());
create policy modulos_todos on public.modulos for select to authenticated using (public.mi_empresa() is not null or public.es_profesora());
create policy condiciones_todos on public.condiciones_banco for select to authenticated using (public.mi_empresa() is not null or public.es_profesora());
create policy perfiles_equipo on public.perfiles for select to authenticated using (id = auth.uid() or empresa_id = public.mi_empresa() or public.es_profesora());
create policy articulos_propios on public.articulos for select to authenticated using (empresa_id = public.mi_empresa() or public.es_profesora());
create policy recetas_propias on public.recetas for select to authenticated using (public.mi_empresa() = 2 or public.es_profesora());
create policy recetas_lineas_propias on public.recetas_lineas for select to authenticated using (public.mi_empresa() = 2 or public.es_profesora());
create policy movimientos_visibles on public.movimientos_banco for select to authenticated using (empresa_id = public.mi_empresa() or public.mi_empresa() = 5 or public.es_profesora());
create policy cambios_profesora on public.registro_cambios for select to authenticated using (public.es_profesora());
