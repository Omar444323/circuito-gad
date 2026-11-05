-- Circuito GAD · Fase 3: almacén con PMP, rectificativas, fabricación, tienda y modo práctica.
-- Añade objetos y columnas, y sustituye funciones del circuito. No borra datos.

alter table public.pedido_lineas
  add column articulo_vendedor_id uuid references public.articulos(id),
  add column articulo_comprador_id uuid references public.articulos(id),
  add column coste_salida numeric(16,6);
alter table public.factura_lineas add column neto_unitario numeric(16,6);

create table public.movimientos_almacen (
  id bigint generated always as identity primary key,
  articulo_id uuid not null references public.articulos(id),
  empresa_id smallint not null references public.empresas(id),
  fecha date not null,
  concepto text not null,
  documento text,
  entrada_uds numeric(14,3),
  entrada_precio numeric(16,6),
  entrada_importe numeric(14,2),
  salida_uds numeric(14,3),
  salida_precio numeric(16,6),
  salida_importe numeric(14,2),
  regularizacion numeric(14,2),
  existencias_uds numeric(14,3) not null,
  existencias_pmp numeric(14,4) not null,
  existencias_importe numeric(14,2) not null,
  inicial boolean not null default false,
  pmp_alumno numeric(14,4),
  pmp_correcto boolean
);
create index movimientos_almacen_articulo on public.movimientos_almacen (articulo_id, id);

create table public.rectificativas (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references public.pedidos(id),
  factura_id bigint not null references public.facturas(id),
  num text not null,
  tipo text not null check (tipo in ('devolucion','rappel','pronto_pago')),
  fecha date not null,
  base numeric(14,2) not null check (base < 0),
  iva numeric(4,1) not null,
  cuota numeric(14,2) not null,
  total numeric(14,2) not null,
  estado text not null default 'emitida' check (estado in ('emitida','aceptada','rechazada')),
  motivo_rechazo text,
  elaboro_id uuid not null references public.perfiles(id),
  elaboro_nombre text not null,
  reviso_id uuid references public.perfiles(id),
  reviso_nombre text
);
create unique index rectificativas_una_pendiente on public.rectificativas (pedido_id) where estado = 'emitida';

create table public.rectificativa_lineas (
  id bigint generated always as identity primary key,
  rectificativa_id bigint not null references public.rectificativas(id),
  pedido_linea_id bigint not null references public.pedido_lineas(id),
  descripcion text not null,
  unidades numeric(14,3) not null check (unidades > 0),
  precio_neto numeric(16,6) not null
);
create index rectificativa_lineas_rect on public.rectificativa_lineas (rectificativa_id);

create table public.ordenes_fabricacion (
  id bigint generated always as identity primary key,
  num text not null,
  fecha date not null,
  producto_id uuid not null references public.articulos(id),
  producto_nombre text not null,
  unidades numeric(14,3) not null check (unidades > 0),
  coste numeric(14,2) not null,
  elaboro_id uuid not null references public.perfiles(id),
  elaboro_nombre text not null
);
-- Copia de la receta vigente: los cambios posteriores no afectan a la orden
create table public.fabricacion_lineas (
  id bigint generated always as identity primary key,
  orden_id bigint not null references public.ordenes_fabricacion(id),
  materia_id uuid not null references public.articulos(id),
  materia_nombre text not null,
  cantidad_unitaria numeric(12,3) not null,
  cantidad numeric(14,3) not null,
  coste numeric(14,2) not null
);
create index fabricacion_lineas_orden on public.fabricacion_lineas (orden_id);

create table public.tickets (
  id bigint generated always as identity primary key,
  num text not null,
  fecha date not null,
  articulo_id uuid not null references public.articulos(id),
  descripcion text not null,
  unidades numeric(14,3) not null check (unidades > 0),
  precio numeric(12,2) not null,
  base numeric(14,2) not null,
  cuota numeric(14,2) not null,
  total numeric(14,2) not null,
  coste numeric(14,2) not null,
  justificante text not null,
  elaboro_id uuid not null references public.perfiles(id),
  elaboro_nombre text not null
);

insert into public.modulos (clave, nombre) values ('pmp_oculto', 'Modo práctica: PMP oculto');

-- Apoyo del almacén
create function public.modo_practica() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select activo from public.modulos where clave = 'pmp_oculto'), false)
$$;

create function public._apunte(a public.articulos, p_concepto text, p_doc text, p_eu numeric, p_ec numeric, p_ei numeric, p_su numeric, p_sc numeric, p_si numeric, p_reg numeric, p_inicial boolean default false) returns void language sql security definer set search_path = '' as $$
  insert into public.movimientos_almacen (articulo_id, empresa_id, fecha, concepto, documento, entrada_uds, entrada_precio, entrada_importe, salida_uds, salida_precio, salida_importe, regularizacion, existencias_uds, existencias_pmp, existencias_importe, inicial)
  values (a.id, a.empresa_id, case when p_inicial then date '2026-11-01' else public.hoy() end, p_concepto, p_doc, p_eu, p_ec, p_ei, p_su, p_sc, p_si, p_reg, a.unidades, case when a.unidades > 0 then round(a.valor / a.unidades, 4) else 0 end, a.valor, p_inicial)
$$;

create function public._iniciar_almacen() returns void language plpgsql security definer set search_path = '' as $$
declare a public.articulos;
begin
  update public.articulos c set articulo_proveedor_id = v.id from public.articulos v
    where c.articulo_proveedor_id is null and v.catalogo_id is not null and lower(v.nombre) = lower(c.nombre)
      and (c.empresa_id, v.empresa_id) in ((2::smallint,1::smallint),(3::smallint,2::smallint),(6::smallint,3::smallint));
  for a in select * from public.articulos x where not exists (select 1 from public.movimientos_almacen m where m.articulo_id = x.id) order by x.empresa_id, x.nombre loop
    perform public._apunte(a, 'Existencias iniciales facilitadas', null, a.unidades, case when a.unidades > 0 then a.valor / a.unidades else 0 end, a.valor, null, null, null, null, true);
  end loop;
end $$;
select public._iniciar_almacen();

create function public._entrada(p_art uuid, p_uds numeric, p_coste numeric, p_concepto text, p_doc text) returns void language plpgsql security definer set search_path = '' as $$
declare a public.articulos; v numeric := round(p_uds * p_coste, 2);
begin
  update public.articulos set unidades = unidades + p_uds, valor = valor + v where id = p_art returning * into strict a;
  perform public._apunte(a, p_concepto, p_doc, p_uds, p_coste, v, null, null, null, null);
end $$;

-- Sale a PMP salvo que se indique otro coste. Devuelve el coste unitario aplicado.
create function public._salida(p_art uuid, p_uds numeric, p_coste numeric, p_concepto text, p_doc text) returns numeric language plpgsql security definer set search_path = '' as $$
declare a public.articulos; c numeric; v numeric;
begin
  select * into strict a from public.articulos where id = p_art for update;
  if a.unidades < p_uds then raise exception 'No hay existencias suficientes de % (tienes %, necesitas %)', a.nombre, trim_scale(a.unidades), trim_scale(p_uds); end if;
  c := coalesce(p_coste, case when a.unidades > 0 then a.valor / a.unidades else 0 end);
  v := round(p_uds * c, 2);
  update public.articulos set unidades = unidades - p_uds, valor = case when unidades - p_uds = 0 then 0 else valor - v end where id = p_art returning * into strict a;
  perform public._apunte(a, p_concepto, p_doc, null, null, null, p_uds, c, v, null);
  return c;
end $$;

create function public._regularizar(p_art uuid, p_dif numeric, p_concepto text, p_doc text) returns void language plpgsql security definer set search_path = '' as $$
declare a public.articulos; v numeric := round(p_dif, 2);
begin
  if abs(v) < 0.005 then return; end if;
  update public.articulos set valor = valor + v where id = p_art returning * into strict a;
  perform public._apunte(a, p_concepto, p_doc, null, null, null, null, null, null, v);
end $$;

-- Artículo del proveedor para una línea de catálogo: se relaciona por id, así que renombrar no rompe nada
create function public._articulo_vendedor(p_empresa smallint, p_catalogo uuid, p_nombre text) returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  select id into v from public.articulos where empresa_id = p_empresa and catalogo_id = p_catalogo;
  if found then return v; end if;
  select id into v from public.articulos where empresa_id = p_empresa and catalogo_id is null and lower(nombre) = lower(p_nombre) limit 1;
  if found then
    update public.articulos set catalogo_id = p_catalogo where id = v;
    return v;
  end if;
  insert into public.articulos (empresa_id, nombre, cuenta, catalogo_id) values (p_empresa, p_nombre, case when p_empresa = 2 then 350 else 300 end, p_catalogo) returning id into v;
  return v;
end $$;

create function public._articulo_comprador(p_empresa smallint, p_proveedor uuid, p_nombre text, p_elegido uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  if p_elegido is not null then
    if not exists (select 1 from public.articulos where id = p_elegido and empresa_id = p_empresa) then raise exception 'Ese artículo no es de tu almacén' using errcode = '42501'; end if;
    update public.articulos set articulo_proveedor_id = p_proveedor where id = p_elegido;
    return p_elegido;
  end if;
  select id into v from public.articulos where empresa_id = p_empresa and articulo_proveedor_id = p_proveedor limit 1;
  if found then return v; end if;
  select id into v from public.articulos where empresa_id = p_empresa and articulo_proveedor_id is null and lower(nombre) = lower(p_nombre) limit 1;
  if found then
    update public.articulos set articulo_proveedor_id = p_proveedor where id = v;
    return v;
  end if;
  insert into public.articulos (empresa_id, nombre, cuenta, articulo_proveedor_id) values (p_empresa, p_nombre, case when p_empresa = 2 then 310 else 300 end, p_proveedor) returning id into v;
  return v;
end $$;

create function public._con_almacen(p_empresa smallint) returns boolean language sql stable security definer set search_path = '' as $$
  select con_almacen from public.empresas where id = p_empresa
$$;

create function public._corto(p_empresa smallint) returns text language sql stable security definer set search_path = '' as $$
  select corto from public.empresas where id = p_empresa
$$;

-- Lecturas: pasan por funciones para poder ocultar el PMP en el modo práctica
create function public.almacen(p_empresa smallint) returns table (id uuid, nombre text, cuenta smallint, unidades numeric, pmp numeric, valor numeric, catalogo_id uuid) language plpgsql stable security definer set search_path = '' as $$
declare v_oculto boolean := public.modo_practica() and not public.es_profesora();
begin
  if not (public.es_profesora() or public.mi_empresa() = p_empresa) then raise exception 'No puedes ver el almacén de otra empresa' using errcode = '42501'; end if;
  return query select a.id, a.nombre, a.cuenta, a.unidades,
    case when v_oculto then null when a.unidades > 0 then round(a.valor / a.unidades, 4) else 0::numeric end,
    case when v_oculto then null else a.valor end, a.catalogo_id
    from public.articulos a where a.empresa_id = p_empresa order by a.cuenta, a.nombre;
end $$;

create function public.ficha_almacen(p_articulo uuid) returns table (id bigint, fecha date, concepto text, documento text, entrada_uds numeric, entrada_precio numeric, entrada_importe numeric, salida_uds numeric, salida_precio numeric, salida_importe numeric, regularizacion numeric, existencias_uds numeric, existencias_pmp numeric, existencias_importe numeric, pmp_alumno numeric, pmp_correcto boolean) language plpgsql stable security definer set search_path = '' as $$
declare v_oculto boolean := public.modo_practica() and not public.es_profesora(); v_empresa smallint;
begin
  select empresa_id into v_empresa from public.articulos where articulos.id = p_articulo;
  if not found or not (public.es_profesora() or public.mi_empresa() = v_empresa) then raise exception 'No puedes ver la ficha de otra empresa' using errcode = '42501'; end if;
  return query select m.id, m.fecha, m.concepto, m.documento, m.entrada_uds, m.entrada_precio, m.entrada_importe, m.salida_uds,
    case when v_oculto then null else m.salida_precio end, case when v_oculto then null else m.salida_importe end, m.regularizacion, m.existencias_uds,
    case when v_oculto then null else m.existencias_pmp end, case when v_oculto then null else m.existencias_importe end, m.pmp_alumno, m.pmp_correcto
    from public.movimientos_almacen m where m.articulo_id = p_articulo order by m.id;
end $$;

create function public.comprobar_pmp(p_mov bigint, p_pmp numeric) returns boolean language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); m public.movimientos_almacen; v_ok boolean;
begin
  select * into m from public.movimientos_almacen where id = p_mov for update;
  if not found or m.empresa_id <> yo.empresa_id then raise exception 'Ese movimiento no es de tu almacén' using errcode = '42501'; end if;
  if p_pmp is null then raise exception 'Escribe tu PMP'; end if;
  v_ok := abs(p_pmp - m.existencias_pmp) <= 0.01;
  update public.movimientos_almacen set pmp_alumno = p_pmp, pmp_correcto = v_ok where id = p_mov;
  return v_ok;
end $$;

-- Líneas del pedido sin artículo vinculado en el almacén del comprador: él decide si las vincula
create function public.lineas_por_vincular(p_id bigint) returns table (linea_id bigint, descripcion text) language plpgsql stable security definer set search_path = '' as $$
declare p public.pedidos;
begin
  select * into p from public.pedidos where id = p_id;
  if not found or public.mi_empresa() is distinct from p.comprador_id then raise exception 'Solo el comprador vincula sus artículos' using errcode = '42501'; end if;
  return query select l.id, l.descripcion from public.pedido_lineas l
    where l.pedido_id = p_id and not exists (
      select 1 from public.articulos c where c.empresa_id = p.comprador_id
        and (c.articulo_proveedor_id = l.articulo_vendedor_id or (c.articulo_proveedor_id is null and lower(c.nombre) = lower(l.descripcion))))
    order by l.id;
end $$;

-- El circuito mueve el almacén
create or replace function public.emitir_albaran(p_id bigint) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id); v_num text; v_tarde boolean; l public.pedido_lineas; v_art uuid; c numeric;
begin
  if yo.empresa_id <> p.vendedor_id then raise exception 'Solo el proveedor emite el albarán' using errcode = '42501'; end if;
  if p.etapa <> 'pedido_aceptado' then raise exception 'Este pedido no está pendiente de entrega'; end if;
  if public.hoy() < p.entrega_fecha then raise exception 'El albarán no se puede emitir antes de la fecha pactada (%)', to_char(p.entrega_fecha, 'DD/MM/YYYY'); end if;
  v_tarde := public.hoy() > p.entrega_fecha;
  v_num := public._numero('A', p.vendedor_id);
  insert into public.albaranes (pedido_id, num, fecha, retrasado, elaboro_id, elaboro_nombre) values (p_id, v_num, public.hoy(), v_tarde, yo.id, yo.nombre);
  if public._con_almacen(p.vendedor_id) then
    for l in select * from public.pedido_lineas where pedido_id = p_id order by id loop
      v_art := public._articulo_vendedor(p.vendedor_id, l.catalogo_id, l.descripcion);
      c := public._salida(v_art, l.unidades, null, 'Venta a ' || public._corto(p.comprador_id), v_num);
      update public.pedido_lineas set articulo_vendedor_id = v_art, coste_salida = c where id = l.id;
    end loop;
  end if;
  perform public._avanzar(p_id, 'albaran_emitido', 'Mercancía entregada con albarán ' || v_num || case when v_tarde then ' (entrega retrasada)' else '' end, yo);
end $$;

drop function public.confirmar_recepcion(bigint);
create function public.confirmar_recepcion(p_id bigint, p_vinculos jsonb default null) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id); a public.albaranes; l public.pedido_lineas; v_art uuid; v_elegido uuid;
begin
  if yo.empresa_id <> p.comprador_id then raise exception 'Solo el comprador confirma la recepción' using errcode = '42501'; end if;
  if p.etapa <> 'albaran_emitido' then raise exception 'No hay ningún albarán pendiente de confirmar'; end if;
  update public.albaranes set recibido_fecha = public.hoy(), reviso_id = yo.id, reviso_nombre = yo.nombre where pedido_id = p_id returning * into a;
  if public._con_almacen(p.comprador_id) then
    for l in select * from public.pedido_lineas where pedido_id = p_id order by id loop
      v_elegido := nullif(coalesce(p_vinculos, '{}'::jsonb) ->> l.id::text, '')::uuid;
      v_art := public._articulo_comprador(p.comprador_id, l.articulo_vendedor_id, l.descripcion, v_elegido);
      perform public._entrada(v_art, l.unidades, l.precio, 'Compra a ' || public._corto(p.vendedor_id) || ' (precio de pedido)', a.num);
      update public.pedido_lineas set articulo_comprador_id = v_art where id = l.id;
    end loop;
  end if;
  perform public._avanzar(p_id, 'recibido', 'Recepción de la mercancía confirmada', yo);
end $$;

create or replace function public.aceptar_factura(p_id bigint, p_comprobaciones text[]) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id); v_lista text[] := array['numeracion','partes','descripcion','unidades','descuentos','base','iva','total','pago']; f public.facturas; k numeric; fl public.factura_lineas; pl public.pedido_lineas; v_ln numeric; v_real numeric;
begin
  if yo.empresa_id <> p.comprador_id then raise exception 'Solo el receptor revisa la factura' using errcode = '42501'; end if;
  if p.etapa <> 'factura_emitida' then raise exception 'No hay ninguna factura pendiente de revisar'; end if;
  if not (coalesce(p_comprobaciones, '{}') @> v_lista) then raise exception 'Marca toda la lista de comprobación antes de aceptar'; end if;
  update public.facturas set estado = 'aceptada', comprobaciones = v_lista, reviso_id = yo.id, reviso_nombre = yo.nombre where pedido_id = p_id and estado = 'emitida' returning * into strict f;
  k := (1 - f.dto / 100) * (1 - f.rappel / 100) * (1 - f.pronto_pago / 100);
  for fl in select * from public.factura_lineas where factura_id = f.id order by id loop
    update public.factura_lineas set neto_unitario = fl.precio * k where id = fl.id;
    select * into strict pl from public.pedido_lineas where id = fl.pedido_linea_id;
    if not p.servicio and public._con_almacen(p.comprador_id) and fl.unidades > 0 and pl.articulo_comprador_id is not null then
      v_ln := fl.unidades * fl.precio * k;
      v_real := (v_ln + case when f.neto > 0 then f.portes * v_ln / f.neto else 0 end) / fl.unidades;
      perform public._regularizar(pl.articulo_comprador_id, (v_real - pl.precio) * pl.unidades, 'Regularización con la factura (descuentos y portes)', f.num);
    end if;
  end loop;
  perform public._avanzar(p_id, 'factura_aceptada', 'Factura ' || f.num || ' revisada y aceptada', yo);
end $$;

-- Rectificativas: solo antes del pago
create function public.emitir_rectificativa(p_id bigint, p_tipo text, p_lineas jsonb, p_base numeric) returns bigint language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id); f public.facturas; v_base numeric; v_cuota numeric; v_id bigint; v_num text;
begin
  if yo.empresa_id <> p.vendedor_id then raise exception 'Solo el emisor de la factura emite la rectificativa' using errcode = '42501'; end if;
  if p.etapa <> 'factura_aceptada' then raise exception 'Las rectificativas solo se emiten con la factura aceptada y antes del pago'; end if;
  if exists (select 1 from public.rectificativas where pedido_id = p_id and estado = 'emitida') then raise exception 'Ya hay una rectificativa pendiente de revisar'; end if;
  if p_tipo not in ('devolucion','rappel','pronto_pago') then raise exception 'Tipo de rectificativa desconocido'; end if;
  select * into strict f from public.facturas where pedido_id = p_id and estado = 'aceptada' order by version desc limit 1;
  if p_tipo = 'devolucion' then
    if p.servicio then raise exception 'Un servicio no admite devolución de mercancía'; end if;
    if coalesce(jsonb_array_length(p_lineas), 0) = 0 then raise exception 'Indica las unidades devueltas'; end if;
    if exists (select 1 from jsonb_to_recordset(p_lineas) as x(linea_id bigint, unidades numeric)
      left join public.factura_lineas fl on fl.factura_id = f.id and fl.pedido_linea_id = x.linea_id
      where fl.id is null or coalesce(x.unidades, 0) <= 0 or x.unidades > fl.unidades - coalesce((select sum(rl.unidades) from public.rectificativa_lineas rl join public.rectificativas r on r.id = rl.rectificativa_id where r.pedido_id = p_id and r.estado = 'aceptada' and rl.pedido_linea_id = x.linea_id), 0)) then
      raise exception 'Las unidades devueltas no pueden superar las facturadas';
    end if;
    select -round(sum(x.unidades * fl.neto_unitario), 2) into v_base from jsonb_to_recordset(p_lineas) as x(linea_id bigint, unidades numeric) join public.factura_lineas fl on fl.factura_id = f.id and fl.pedido_linea_id = x.linea_id;
  else
    if coalesce(p_base, 0) <= 0 then raise exception 'Indica la base del descuento'; end if;
    v_base := -round(p_base, 2);
  end if;
  if v_base >= 0 then raise exception 'El importe de la rectificativa tiene que ser mayor que cero'; end if;
  v_cuota := round(v_base * f.iva / 100, 2);
  v_num := public._numero('R', p.vendedor_id);
  insert into public.rectificativas (pedido_id, factura_id, num, tipo, fecha, base, iva, cuota, total, elaboro_id, elaboro_nombre)
    values (p_id, f.id, v_num, p_tipo, public.hoy(), v_base, f.iva, v_cuota, v_base + v_cuota, yo.id, yo.nombre) returning id into v_id;
  if p_tipo = 'devolucion' then
    insert into public.rectificativa_lineas (rectificativa_id, pedido_linea_id, descripcion, unidades, precio_neto)
      select v_id, x.linea_id, fl.descripcion, x.unidades, fl.neto_unitario from jsonb_to_recordset(p_lineas) as x(linea_id bigint, unidades numeric) join public.factura_lineas fl on fl.factura_id = f.id and fl.pedido_linea_id = x.linea_id;
  end if;
  insert into public.historial (pedido_id, texto, quien_id, quien_nombre, fecha) values (p_id, 'Factura rectificativa ' || v_num || ' emitida', yo.id, yo.nombre, public.hoy());
  return v_id;
end $$;

create function public.aceptar_rectificativa(p_id bigint) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id); r public.rectificativas; rl public.rectificativa_lineas; pl public.pedido_lineas;
begin
  if yo.empresa_id <> p.comprador_id then raise exception 'Solo el receptor revisa la rectificativa' using errcode = '42501'; end if;
  select * into r from public.rectificativas where pedido_id = p_id and estado = 'emitida' for update;
  if not found then raise exception 'No hay ninguna rectificativa pendiente'; end if;
  update public.rectificativas set estado = 'aceptada', reviso_id = yo.id, reviso_nombre = yo.nombre where id = r.id;
  if r.tipo = 'devolucion' then
    for rl in select * from public.rectificativa_lineas where rectificativa_id = r.id order by id loop
      select * into strict pl from public.pedido_lineas where id = rl.pedido_linea_id;
      if public._con_almacen(p.comprador_id) and pl.articulo_comprador_id is not null then
        perform public._salida(pl.articulo_comprador_id, rl.unidades, rl.precio_neto, 'Devolución a ' || public._corto(p.vendedor_id) || ' (precio de compra)', r.num);
      end if;
      if public._con_almacen(p.vendedor_id) and pl.articulo_vendedor_id is not null then
        perform public._entrada(pl.articulo_vendedor_id, rl.unidades, coalesce(pl.coste_salida, 0), 'Devolución de ' || public._corto(p.comprador_id) || ' (coste de salida)', r.num);
      end if;
    end loop;
  end if;
  insert into public.historial (pedido_id, texto, quien_id, quien_nombre, fecha) values (p_id, 'Rectificativa ' || r.num || ' aceptada', yo.id, yo.nombre, public.hoy());
end $$;

create function public.rechazar_rectificativa(p_id bigint, p_motivo text) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id); v_num text;
begin
  if yo.empresa_id <> p.comprador_id then raise exception 'Solo el receptor revisa la rectificativa' using errcode = '42501'; end if;
  if length(trim(coalesce(p_motivo, ''))) = 0 then raise exception 'Escribe el motivo del rechazo'; end if;
  update public.rectificativas set estado = 'rechazada', motivo_rechazo = trim(p_motivo), reviso_id = yo.id, reviso_nombre = yo.nombre where pedido_id = p_id and estado = 'emitida' returning num into v_num;
  if v_num is null then raise exception 'No hay ninguna rectificativa pendiente'; end if;
  insert into public.historial (pedido_id, texto, quien_id, quien_nombre, fecha) values (p_id, 'Rectificativa ' || v_num || ' rechazada: ' || trim(p_motivo), yo.id, yo.nombre, public.hoy());
end $$;

-- El importe a transferir es el total de la factura más las rectificativas aceptadas
create or replace function public.ordenar_pago(p_id bigint, p_confirmado boolean) returns bigint language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id); f public.facturas; v_imp numeric; v_com numeric; v_disp numeric; v_id bigint; v_num text;
begin
  if yo.empresa_id <> p.comprador_id then raise exception 'Solo el comprador ordena el pago' using errcode = '42501'; end if;
  if p.etapa <> 'factura_aceptada' then raise exception 'Esta factura no está pendiente de pago'; end if;
  if (select count(*) from public.registros_contables where pedido_id = p_id and lado = 'comprador') < 2 then
    raise exception 'Antes de ordenar el pago hay que hacer el borrador manual y el registro en el diario de Excel';
  end if;
  if exists (select 1 from public.rectificativas where pedido_id = p_id and estado = 'emitida') then raise exception 'Hay una factura rectificativa pendiente de revisar'; end if;
  perform 1 from public.empresas where id = yo.empresa_id for update;
  select * into strict f from public.facturas where pedido_id = p_id and estado = 'aceptada' order by version desc limit 1;
  v_imp := f.total + coalesce((select sum(total) from public.rectificativas where pedido_id = p_id and estado = 'aceptada'), 0);
  select comision_transferencia into strict v_com from public.condiciones_banco order by vigente_desde desc, id desc limit 1;
  v_disp := public.disponible(yo.empresa_id);
  if v_imp <= 0 then raise exception 'El importe a transferir tiene que ser mayor que cero'; end if;
  if v_imp + v_com > v_disp then raise exception 'Saldo insuficiente. El descubierto está prohibido'; end if;
  if v_imp > v_disp * 0.2 and not coalesce(p_confirmado, false) then raise exception 'Supera el 20 %% de tu tesorería: confirma que has comprobado saldo, vencimiento y forma de pago'; end if;
  v_num := public._numero('OP', yo.empresa_id);
  insert into public.ordenes_pago (pedido_id, num, ordenante_id, beneficiario_id, concepto, importe, comision, fecha, confirmo_comprobacion, ordeno_id, ordeno_nombre)
    values (p_id, v_num, p.comprador_id, p.vendedor_id, 'Pago factura ' || f.num, v_imp, v_com, public.hoy(), coalesce(p_confirmado, false), yo.id, yo.nombre) returning id into v_id;
  perform public._avanzar(p_id, 'orden_pendiente', 'Orden de pago ' || v_num || ' enviada al banco', yo);
  return v_id;
end $$;

-- G2: fabricación. Consume materias a PMP y da de alta el producto al coste consumido
create function public.fabricar(p_producto uuid, p_unidades numeric) returns text language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); v_prod public.articulos; v_receta uuid; x record; v_num text; v_id bigint; v_coste numeric := 0; c numeric; v_uds numeric; v_imp numeric;
begin
  if yo.empresa_id <> 2 then raise exception 'Solo el G2 registra órdenes de fabricación' using errcode = '42501'; end if;
  if coalesce(p_unidades, 0) <= 0 then raise exception 'Las unidades tienen que ser mayores que 0'; end if;
  select * into v_prod from public.articulos where id = p_producto and empresa_id = 2 and cuenta = 350 for update;
  if not found then raise exception 'El producto no es un producto terminado del G2'; end if;
  select id into v_receta from public.recetas where producto_id = p_producto;
  if v_receta is null or not exists (select 1 from public.recetas_lineas where receta_id = v_receta) then raise exception 'Este producto no tiene receta'; end if;
  for x in select a.nombre, a.unidades, l.cantidad from public.recetas_lineas l join public.articulos a on a.id = l.materia_id where l.receta_id = v_receta loop
    if x.unidades < x.cantidad * p_unidades then raise exception 'Falta materia prima: %. Necesitas % y tienes %', x.nombre, trim_scale(x.cantidad * p_unidades), trim_scale(x.unidades); end if;
  end loop;
  v_num := public._numero('OF', 2::smallint);
  insert into public.ordenes_fabricacion (num, fecha, producto_id, producto_nombre, unidades, coste, elaboro_id, elaboro_nombre) values (v_num, public.hoy(), p_producto, v_prod.nombre, p_unidades, 0, yo.id, yo.nombre) returning id into v_id;
  for x in select l.materia_id, a.nombre, l.cantidad from public.recetas_lineas l join public.articulos a on a.id = l.materia_id where l.receta_id = v_receta order by a.nombre loop
    v_uds := x.cantidad * p_unidades;
    c := public._salida(x.materia_id, v_uds, null, 'Consumo en fabricación de ' || lower(v_prod.nombre), v_num);
    v_imp := round(v_uds * c, 2);
    v_coste := v_coste + v_imp;
    insert into public.fabricacion_lineas (orden_id, materia_id, materia_nombre, cantidad_unitaria, cantidad, coste) values (v_id, x.materia_id, x.nombre, x.cantidad, v_uds, v_imp);
  end loop;
  perform public._entrada(p_producto, p_unidades, v_coste / p_unidades, 'Fabricación (coste de materias primas consumidas)', v_num);
  update public.ordenes_fabricacion set coste = v_coste where id = v_id;
  return v_num;
end $$;

-- G6: venta en tienda con ticket. El cobro entra por TPV: no hay efectivo
create function public.vender_tienda(p_articulo uuid, p_unidades numeric) returns text language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); a public.articulos; v_precio numeric; v_base numeric; v_cuota numeric; c numeric; v_num text; v_just text;
begin
  if yo.empresa_id <> 6 then raise exception 'Solo el G6 vende en tienda' using errcode = '42501'; end if;
  if coalesce(p_unidades, 0) <= 0 then raise exception 'Las unidades tienen que ser mayores que 0'; end if;
  select * into a from public.articulos where id = p_articulo and empresa_id = 6;
  if not found then raise exception 'Ese artículo no es de tu almacén'; end if;
  select precio into v_precio from public.catalogo where id = a.catalogo_id and activo;
  if not found then raise exception 'Ese artículo no está en tu catálogo'; end if;
  perform 1 from public.empresas where id = 6 for update;
  v_num := public._numero('T', 6::smallint);
  c := public._salida(p_articulo, p_unidades, null, 'Venta en tienda (ticket)', v_num);
  v_base := round(v_precio * p_unidades, 2);
  v_cuota := round(v_base * 0.21, 2);
  v_just := public._numero('JB', 5::smallint);
  perform public._movimiento(6::smallint, 'Cobro con TPV ticket ' || v_num, v_base + v_cuota, v_just);
  insert into public.tickets (num, fecha, articulo_id, descripcion, unidades, precio, base, cuota, total, coste, justificante, elaboro_id, elaboro_nombre)
    values (v_num, public.hoy(), p_articulo, a.nombre, p_unidades, v_precio, v_base, v_cuota, v_base + v_cuota, round(p_unidades * c, 2), v_just, yo.id, yo.nombre);
  return v_num;
end $$;

-- RLS: las fichas se leen con ficha_almacen(), que oculta el PMP en el modo práctica
alter table public.movimientos_almacen enable row level security;
alter table public.rectificativas enable row level security;
alter table public.rectificativa_lineas enable row level security;
alter table public.ordenes_fabricacion enable row level security;
alter table public.fabricacion_lineas enable row level security;
alter table public.tickets enable row level security;
revoke all on public.movimientos_almacen, public.rectificativas, public.rectificativa_lineas, public.ordenes_fabricacion, public.fabricacion_lineas, public.tickets from public, anon, authenticated, service_role;
grant select on public.movimientos_almacen, public.rectificativas, public.rectificativa_lineas, public.ordenes_fabricacion, public.fabricacion_lineas, public.tickets to authenticated;
create policy movimientos_almacen_profesora on public.movimientos_almacen for select to authenticated using (public.es_profesora());
create policy rectificativas_partes on public.rectificativas for select to authenticated using (public.es_parte_pedido(pedido_id));
create policy rectificativa_lineas_partes on public.rectificativa_lineas for select to authenticated using (exists (select 1 from public.rectificativas r where r.id = rectificativa_id));
create policy fabricacion_g2 on public.ordenes_fabricacion for select to authenticated using (public.es_profesora() or public.mi_empresa() = 2);
create policy fabricacion_lineas_g2 on public.fabricacion_lineas for select to authenticated using (public.es_profesora() or public.mi_empresa() = 2);
create policy tickets_g6 on public.tickets for select to authenticated using (public.es_profesora() or public.mi_empresa() = 6);

do $$
declare f record;
begin
  for f in select oid::regprocedure as s from pg_proc where pronamespace = 'public'::regnamespace and proname = any (array['modo_practica','_apunte','_iniciar_almacen','_entrada','_salida','_regularizar','_articulo_vendedor','_articulo_comprador','_con_almacen','_corto','almacen','ficha_almacen','comprobar_pmp','lineas_por_vincular','confirmar_recepcion','emitir_rectificativa','aceptar_rectificativa','rechazar_rectificativa','fabricar','vender_tienda']) loop
    execute 'revoke execute on function ' || f.s || ' from public, anon, authenticated, service_role';
  end loop;
end $$;
grant execute on function public.modo_practica(), public.almacen(smallint), public.ficha_almacen(uuid), public.comprobar_pmp(bigint,numeric), public.lineas_por_vincular(bigint), public.confirmar_recepcion(bigint,jsonb), public.emitir_rectificativa(bigint,text,jsonb,numeric), public.aceptar_rectificativa(bigint), public.rechazar_rectificativa(bigint,text), public.fabricar(uuid,numeric), public.vender_tienda(uuid,numeric) to authenticated;
notify pgrst, 'reload schema';
