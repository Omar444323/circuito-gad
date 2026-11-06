-- Fase 4: archivo por empresa, avisos en tiempo real e importación de lo ya hecho en papel y Excel

-- 1. Importación. La profesora carga documentos y pagos con sus fechas reales.
-- Los pagos mueven los saldos; el resto de documentos solo queda archivado
create table public.lotes_importados (
  id bigint generated always as identity primary key,
  nombre text not null check (length(trim(nombre)) > 0),
  filas int not null,
  fecha date not null,
  anulado_fecha date,
  importo_id uuid not null references public.perfiles(id)
);
create table public.documentos_importados (
  id bigint generated always as identity primary key,
  lote_id bigint not null references public.lotes_importados(id),
  tipo text not null check (tipo in ('presupuesto','pedido','albaran','factura','rectificativa','ticket','pago','otro')),
  num text not null check (length(trim(num)) > 0),
  fecha date not null,
  emisor_id smallint not null references public.empresas(id),
  receptor_id smallint references public.empresas(id),
  concepto text,
  base numeric(14,2) not null default 0,
  cuota numeric(14,2) not null default 0,
  total numeric(14,2) not null,
  justificante text,
  check (receptor_id is null or receptor_id <> emisor_id)
);
create unique index documentos_importados_uno on public.documentos_importados (emisor_id, tipo, lower(num));
create index documentos_importados_receptor on public.documentos_importados (receptor_id);

-- Todo o nada: si una fila no vale no se carga ninguna, y el error dice cuál es
create function public.importar_documentos(p_nombre text, p_filas jsonb) returns bigint language plpgsql security definer set search_path = '' as $$
declare v_lote bigint; f jsonb; n int := 0; v_tipo text; v_num text; v_fecha date; v_em smallint; v_re smallint; v_tot numeric; v_base numeric; v_cuota numeric; v_just text;
begin
  if not public.es_profesora() then raise exception 'Solo la profesora importa documentos' using errcode = '42501'; end if;
  if length(trim(coalesce(p_nombre, ''))) = 0 then raise exception 'Pon un nombre a la importación'; end if;
  if jsonb_typeof(p_filas) is distinct from 'array' or jsonb_array_length(p_filas) = 0 then raise exception 'No hay filas que importar'; end if;
  insert into public.lotes_importados (nombre, filas, fecha, importo_id) values (trim(p_nombre), jsonb_array_length(p_filas), public.hoy(), auth.uid()) returning id into v_lote;
  for f in select * from jsonb_array_elements(p_filas) loop
    n := n + 1;
    begin
      v_tipo := f ->> 'tipo'; v_num := trim(coalesce(f ->> 'num', '')); v_fecha := (f ->> 'fecha')::date;
      v_em := (f ->> 'emisor')::smallint; v_re := nullif(f ->> 'receptor', '')::smallint;
      v_base := coalesce((f ->> 'base')::numeric, 0); v_cuota := coalesce((f ->> 'cuota')::numeric, 0); v_tot := (f ->> 'total')::numeric;
    exception when others then raise exception 'Fila %: hay un dato con formato incorrecto', n; end;
    if v_tipo is null or v_tipo not in ('presupuesto','pedido','albaran','factura','rectificativa','ticket','pago','otro') then raise exception 'Fila %: el tipo % no existe', n, coalesce(v_tipo, 'vacío'); end if;
    if v_num = '' then raise exception 'Fila %: falta el número', n; end if;
    if v_fecha is null or v_fecha < date '2026-11-01' or v_fecha > public.hoy() then raise exception 'Fila %: la fecha tiene que ser desde el 01/11/2026 hasta hoy', n; end if;
    if not exists (select 1 from public.empresas where id = v_em) then raise exception 'Fila %: el emisor no existe', n; end if;
    if v_re is not null and (v_re = v_em or not exists (select 1 from public.empresas where id = v_re)) then raise exception 'Fila %: el receptor no es válido', n; end if;
    if v_tot is null then raise exception 'Fila %: falta el total', n; end if;
    if exists (select 1 from public.documentos_importados where emisor_id = v_em and tipo = v_tipo and lower(num) = lower(v_num)) then raise exception 'Fila %: el documento % ya está importado', n, v_num; end if;
    v_just := null;
    if v_tipo = 'pago' then
      if v_re is null then raise exception 'Fila %: un pago necesita receptor', n; end if;
      if v_tot <= 0 then raise exception 'Fila %: el importe del pago tiene que ser mayor que cero', n; end if;
      perform 1 from public.empresas where id in (v_em, v_re) order by id for update;
      v_just := public._numero('JB', 5::smallint);
      insert into public.movimientos_banco (empresa_id, fecha, concepto, importe, saldo, justificante) values (v_em, v_fecha, 'Importado: pago a ' || public._corto(v_re) || ' · ' || v_num, -v_tot, public._saldo(v_em) - v_tot, v_just);
      insert into public.movimientos_banco (empresa_id, fecha, concepto, importe, saldo, justificante) values (v_re, v_fecha, 'Importado: cobro de ' || public._corto(v_em) || ' · ' || v_num, v_tot, public._saldo(v_re) + v_tot, v_just);
    end if;
    insert into public.documentos_importados (lote_id, tipo, num, fecha, emisor_id, receptor_id, concepto, base, cuota, total, justificante)
      values (v_lote, v_tipo, v_num, v_fecha, v_em, v_re, nullif(trim(coalesce(f ->> 'concepto', '')), ''), v_base, v_cuota, v_tot, v_just);
  end loop;
  return v_lote;
end $$;

-- Por si se ha cargado un fichero equivocado: los pagos se compensan con apuntes de sentido contrario
create function public.anular_importacion(p_lote bigint) returns void language plpgsql security definer set search_path = '' as $$
declare l public.lotes_importados; d public.documentos_importados;
begin
  if not public.es_profesora() then raise exception 'Solo la profesora anula importaciones' using errcode = '42501'; end if;
  select * into l from public.lotes_importados where id = p_lote for update;
  if not found then raise exception 'Esa importación no existe'; end if;
  if l.anulado_fecha is not null then raise exception 'Esa importación ya está anulada'; end if;
  for d in select * from public.documentos_importados where lote_id = p_lote and tipo = 'pago' order by id desc loop
    perform 1 from public.empresas where id in (d.emisor_id, d.receptor_id) order by id for update;
    perform public._movimiento(d.emisor_id, 'Anulación de la importación · ' || d.num, d.total, d.justificante);
    perform public._movimiento(d.receptor_id, 'Anulación de la importación · ' || d.num, -d.total, d.justificante);
  end loop;
  delete from public.documentos_importados where lote_id = p_lote;
  update public.lotes_importados set anulado_fecha = public.hoy() where id = p_lote;
end $$;

-- Lo importado también cuenta para comparar el IVA
create or replace function public.iva_calculado(p_empresa smallint, p_periodo text) returns table (repercutido numeric, soportado numeric) language plpgsql stable security definer set search_path = '' as $$
declare v_d date := (p_periodo || '-01')::date; v_h date := ((p_periodo || '-01')::date + interval '1 month')::date;
begin
  if not public.es_profesora() then raise exception 'Solo la profesora ve esta comparación' using errcode = '42501'; end if;
  return query
  with fa as (select f.cuota, f.fecha, p.vendedor_id, p.comprador_id from public.facturas f join public.pedidos p on p.id = f.pedido_id where f.estado = 'aceptada'),
  re as (select r.cuota, r.fecha, p.vendedor_id, p.comprador_id from public.rectificativas r join public.pedidos p on p.id = r.pedido_id where r.estado = 'aceptada'),
  im as (select d.cuota, d.fecha, d.emisor_id, d.receptor_id from public.documentos_importados d where d.tipo in ('factura','rectificativa','ticket')),
  todo as (select * from fa union all select * from re union all select * from im)
  select
    coalesce((select sum(cuota) from todo where vendedor_id = p_empresa and fecha >= v_d and fecha < v_h), 0)
      + coalesce((select sum(cuota) from public.tickets where p_empresa = 6 and fecha >= v_d and fecha < v_h), 0)
      + coalesce((select sum(cuota) from public.gastos_personales where proveedor_id = p_empresa and tipo <> 'tienda' and fecha >= v_d and fecha < v_h), 0),
    coalesce((select sum(cuota) from todo where comprador_id = p_empresa and fecha >= v_d and fecha < v_h), 0);
end $$;

-- 2. Archivo por empresa (punto 3.7): emitidos, recibidos, rechazados y corregidos, rectificativas y justificantes
create function public.archivo_documentos(p_empresa smallint, p_tipo text default null, p_desde date default null, p_hasta date default null)
returns table (tipo text, num text, fecha date, sentido text, otra_id smallint, estado text, importe numeric, pedido_id bigint, presupuesto_id bigint, elaboro text, reviso text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.es_profesora() or public.mi_empresa() = p_empresa) then raise exception 'No puedes consultar el archivo de otra empresa' using errcode = '42501'; end if;
  return query
  with ped as (
    select p.*, case when p.vendedor_id = 7 then 1::smallint else p.vendedor_id end as gest from public.pedidos p
    where p.comprador_id = p_empresa or p.vendedor_id = p_empresa or (p.vendedor_id = 7 and p_empresa = 1)
  ),
  todo as (
    select 'pedido'::text t, p.num n, p.fecha f, case when p.comprador_id = p_empresa then 'emitido' else 'recibido' end s, case when p.comprador_id = p_empresa then p.vendedor_id else p.comprador_id end o,
      case when p.etapa = 'pedido_rechazado' then 'rechazado' else 'aceptado o en curso' end e, (select round(sum(l.unidades * l.precio), 2) from public.pedido_lineas l where l.pedido_id = p.id) i, p.id pid, null::bigint prid, p.elaboro_nombre el, p.reviso_nombre re from ped p
    union all select 'albaran', a.num, a.fecha, case when p.gest = p_empresa then 'emitido' else 'recibido' end, case when p.gest = p_empresa then p.comprador_id else p.vendedor_id end, case when a.recibido_fecha is null then 'por confirmar' else 'confirmado' end, null, p.id, null, a.elaboro_nombre, a.reviso_nombre from public.albaranes a join ped p on p.id = a.pedido_id
    union all select 'albaran', a.num, a.fecha, case when p.gest = p_empresa then 'emitido' else 'recibido' end, case when p.gest = p_empresa then p.comprador_id else p.vendedor_id end, 'rechazado', null, p.id, null, a.elaboro_nombre, a.rechazo_nombre from public.albaranes_rechazados a join ped p on p.id = a.pedido_id
    union all select 'factura', x.num || case when x.version > 1 then ' v' || x.version else '' end, x.fecha, case when p.gest = p_empresa then 'emitido' else 'recibido' end, case when p.gest = p_empresa then p.comprador_id else p.vendedor_id end, x.estado, x.total, p.id, null, x.elaboro_nombre, x.reviso_nombre from public.facturas x join ped p on p.id = x.pedido_id
    union all select 'rectificativa', r.num, r.fecha, case when p.gest = p_empresa then 'emitido' else 'recibido' end, case when p.gest = p_empresa then p.comprador_id else p.vendedor_id end, r.estado, r.total, p.id, null, r.elaboro_nombre, r.reviso_nombre from public.rectificativas r join ped p on p.id = r.pedido_id
    union all select 'presupuesto', b.num, b.fecha, case when b.comprador_id = p_empresa then 'emitido' else 'recibido' end, case when b.comprador_id = p_empresa then b.vendedor_id else b.comprador_id end, b.estado, null, b.pedido_id, b.id, b.elaboro_nombre, null from public.presupuestos b where p_empresa in (b.comprador_id, b.vendedor_id)
    union all select 'justificante', o.justificante, o.fecha_ejecucion, case when o.ordenante_id = p_empresa then 'emitido' else 'recibido' end, case when o.ordenante_id = p_empresa then o.beneficiario_id else o.ordenante_id end, 'ejecutado', o.importe, o.pedido_id, null, o.ordeno_nombre, o.revisado_nombre from public.ordenes_pago o where o.estado = 'ejecutada' and p_empresa in (o.ordenante_id, o.beneficiario_id)
    union all select 'ticket', k.num, k.fecha, 'emitido', null::smallint, 'emitido', k.total, null, null, k.elaboro_nombre, null from public.tickets k where p_empresa = 6
    union all select 'nomina', m.num, m.fecha, 'emitido', null::smallint, 'pagada', m.liquido, null, null, m.elaboro_nombre, null from public.nominas m where m.empresa_id = p_empresa
    union all select 'fianza', z.num, z.fecha, case when z.empresa_id = p_empresa then 'emitido' else 'recibido' end, case when z.empresa_id = p_empresa then z.receptor_id else z.empresa_id end, z.estado, z.importe, null, null, z.elaboro_nombre, null from public.fianzas z where p_empresa in (z.empresa_id, z.receptor_id)
    union all select 'iva', v.num, v.fecha, 'emitido', 8::smallint, 'presentado', v.resultado, null, null, v.presento_nombre, null from public.liquidaciones_iva v where v.empresa_id = p_empresa
    union all select 'deuda', d.num, d.fecha, case when d.deudor_id = p_empresa then 'recibido' else 'emitido' end, case when d.deudor_id = p_empresa then d.acreedor_id else d.deudor_id end, d.estado, d.importe, d.pedido_id, null, d.propuso_nombre, d.respondio_nombre from public.deudas d where p_empresa in (d.deudor_id, d.acreedor_id)
    union all select case when i.tipo = 'pago' then 'justificante' else i.tipo end, i.num, i.fecha, case when i.emisor_id = p_empresa then 'emitido' else 'recibido' end, case when i.emisor_id = p_empresa then i.receptor_id else i.emisor_id end, 'importado', i.total, null, null, 'Importado por la profesora', null from public.documentos_importados i where p_empresa in (i.emisor_id, i.receptor_id)
  )
  select x.t, x.n, x.f, x.s, x.o, x.e, x.i, x.pid, x.prid, x.el, x.re from todo x
  where (p_tipo is null or x.t = p_tipo) and (p_desde is null or x.f >= p_desde) and (p_hasta is null or x.f <= p_hasta)
  order by x.f desc, x.n desc;
end $$;

-- 3. RLS: lectura por política, escritura solo mediante funciones
alter table public.lotes_importados enable row level security;
alter table public.documentos_importados enable row level security;
revoke all on public.lotes_importados, public.documentos_importados from public, anon, authenticated, service_role;
grant select on public.lotes_importados, public.documentos_importados to authenticated;
create policy lotes_profesora on public.lotes_importados for select to authenticated using (public.es_profesora());
create policy importados_partes on public.documentos_importados for select to authenticated using (public.es_profesora() or public.mi_empresa() in (emisor_id, receptor_id));
do $$
declare f record;
begin
  for f in select oid::regprocedure as s from pg_proc where pronamespace = 'public'::regnamespace and proname = any (array['importar_documentos','anular_importacion','archivo_documentos']) loop
    execute 'revoke execute on function ' || f.s || ' from public, anon, authenticated, service_role';
  end loop;
end $$;
grant execute on function public.importar_documentos(text,jsonb), public.anular_importacion(bigint), public.archivo_documentos(smallint,text,date,date) to authenticated;

-- 4. Avisos con Realtime. La publicación solo existe en Supabase, no en la base de datos de los tests
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['pedidos','correos','presupuestos','deudas','ordenes_pago','circulares'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
notify pgrst, 'reload schema';
