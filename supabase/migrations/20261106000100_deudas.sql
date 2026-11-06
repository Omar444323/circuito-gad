-- Circuito GAD · Deudas entre empresas y descuentos fuera de factura por volumen.
-- No borra datos: añade tablas y columnas, y amplía dos restricciones.

alter table public.pedidos drop constraint pedidos_etapa_check;
alter table public.pedidos add constraint pedidos_etapa_check check (etapa in ('pedido_enviado','pedido_rechazado','pedido_aceptado','albaran_emitido','recibido','factura_emitida','factura_rechazada','factura_aceptada','orden_pendiente','orden_denegada','a_deber','pagado'));

-- 1. Deudas. La de compra nace de una factura aceptada; el abono, de un descuento posterior al pago
create table public.deudas (
  id bigint generated always as identity primary key,
  num text not null,
  origen text not null check (origen in ('compra','abono')),
  pedido_id bigint not null references public.pedidos(id),
  rectificativa_id bigint references public.rectificativas(id),
  deudor_id smallint not null references public.empresas(id),
  acreedor_id smallint not null references public.empresas(id),
  fecha date not null,
  vencimiento_dias smallint not null check (vencimiento_dias between 5 and 30),
  vencimiento date,
  condiciones text,
  importe numeric(14,2) not null check (importe >= 0),
  pendiente numeric(14,2) not null check (pendiente >= 0),
  estado text not null check (estado in ('propuesta','vigente','saldada','rechazada')),
  propuso_empresa smallint not null references public.empresas(id),
  propuso_id uuid not null references public.perfiles(id),
  propuso_nombre text not null,
  respondio_id uuid references public.perfiles(id),
  respondio_nombre text,
  motivo_rechazo text,
  impago_comunicado date,
  impago_registrado boolean not null default false,
  check (deudor_id <> acreedor_id)
);
create index deudas_deudor on public.deudas (deudor_id);
create index deudas_acreedor on public.deudas (acreedor_id);
create unique index deudas_una_abierta on public.deudas (pedido_id) where origen = 'compra' and estado in ('propuesta','vigente');

alter table public.ordenes_pago add column deuda_id bigint references public.deudas(id);
alter table public.incumplimientos add column deuda_id bigint references public.deudas(id);
alter table public.rectificativas add column rappel_mes date;

create function public._deuda(p_id bigint) returns public.deudas language plpgsql security definer set search_path = '' as $$
declare v public.deudas;
begin
  select * into v from public.deudas where id = p_id for update;
  if not found then raise exception 'La deuda no existe'; end if;
  return v;
end $$;

-- Lo que queda de la factura tras las rectificativas aceptadas
create function public._por_pagar(p_pedido bigint) returns numeric language sql stable security definer set search_path = '' as $$
  select f.total + coalesce((select sum(total) from public.rectificativas where pedido_id = p_pedido and estado = 'aceptada'), 0)
  from public.facturas f where f.pedido_id = p_pedido and f.estado = 'aceptada' order by f.version desc limit 1
$$;

-- Cualquiera de las dos partes lo propone, y la otra lo acepta: todo acuerdo queda por escrito (punto 4)
create function public.proponer_deuda(p_pedido bigint, p_dias int, p_condiciones text default null) returns bigint language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_pedido); v_id bigint;
begin
  if yo.empresa_id not in (p.comprador_id, p.vendedor_id) then raise exception 'Solo las partes de la operación acuerdan una deuda' using errcode = '42501'; end if;
  if p.vendedor_id > 6 then raise exception 'Al Estado se le paga al momento: no admite deudas'; end if;
  if p.etapa <> 'factura_aceptada' then raise exception 'Solo se puede dejar a deber una factura aceptada y sin pagar'; end if;
  if p_dias is null or p_dias not between 5 and 30 then raise exception 'El vencimiento pactado es de 5 a 30 días'; end if;
  if exists (select 1 from public.rectificativas where pedido_id = p_pedido and estado = 'emitida') then raise exception 'Hay una factura rectificativa pendiente de revisar'; end if;
  if exists (select 1 from public.deudas where pedido_id = p_pedido and origen = 'compra' and estado = 'propuesta') then raise exception 'Ya hay una propuesta esperando respuesta'; end if;
  insert into public.deudas (num, origen, pedido_id, deudor_id, acreedor_id, fecha, vencimiento_dias, condiciones, importe, pendiente, estado, propuso_empresa, propuso_id, propuso_nombre)
    values (public._numero('D', p.comprador_id), 'compra', p_pedido, p.comprador_id, p.vendedor_id, public.hoy(), p_dias, nullif(trim(coalesce(p_condiciones, '')), ''), public._por_pagar(p_pedido), public._por_pagar(p_pedido), 'propuesta', yo.empresa_id, yo.id, yo.nombre)
    returning id into v_id;
  insert into public.historial (pedido_id, texto, quien_id, quien_nombre, fecha) values (p_pedido, 'Propuesta de dejar la factura a deber, a ' || p_dias || ' días', yo.id, yo.nombre, public.hoy());
  return v_id;
end $$;

create function public.responder_deuda(p_id bigint, p_aceptar boolean, p_motivo text default null) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); d public.deudas := public._deuda(p_id); p public.pedidos := public._pedido(d.pedido_id); v_imp numeric; v_venc date;
begin
  if d.estado <> 'propuesta' then raise exception 'Esta deuda ya está respondida'; end if;
  if yo.empresa_id not in (d.deudor_id, d.acreedor_id) or yo.empresa_id = d.propuso_empresa then raise exception 'Responde la otra parte de la operación' using errcode = '42501'; end if;
  if not coalesce(p_aceptar, false) then
    if p_motivo is null or p_motivo not in ('Falta de existencias','Falta de liquidez','Precio no aceptado','Riesgo excesivo','Documento incorrecto','Incumplimiento previo') then raise exception 'Solo se admiten los motivos de rechazo de las normas'; end if;
    update public.deudas set estado = 'rechazada', motivo_rechazo = p_motivo, respondio_id = yo.id, respondio_nombre = yo.nombre where id = p_id;
    insert into public.historial (pedido_id, texto, quien_id, quien_nombre, fecha) values (d.pedido_id, 'Deuda ' || d.num || ' rechazada: ' || p_motivo, yo.id, yo.nombre, public.hoy());
    return;
  end if;
  if p.etapa <> 'factura_aceptada' then raise exception 'Esta factura ya no está pendiente de pago'; end if;
  if exists (select 1 from public.rectificativas where pedido_id = d.pedido_id and estado = 'emitida') then raise exception 'Hay una factura rectificativa pendiente de revisar'; end if;
  v_imp := public._por_pagar(d.pedido_id);
  if v_imp <= 0 then raise exception 'No queda nada por pagar en esta factura'; end if;
  v_venc := public.sumar_dias_lectivos(public.hoy(), d.vencimiento_dias);
  update public.deudas set estado = 'vigente', importe = v_imp, pendiente = v_imp, vencimiento = v_venc, respondio_id = yo.id, respondio_nombre = yo.nombre where id = p_id;
  perform public._avanzar(d.pedido_id, 'a_deber', 'Deuda ' || d.num || ' aceptada. Vence el ' || to_char(v_venc, 'DD/MM/YYYY'), yo);
end $$;

-- El acreedor puede dar más tiempo
create function public.aplazar_deuda(p_id bigint, p_dias int) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); d public.deudas := public._deuda(p_id); v_venc date;
begin
  if yo.empresa_id <> d.acreedor_id then raise exception 'Solo el acreedor da más tiempo' using errcode = '42501'; end if;
  if d.estado <> 'vigente' then raise exception 'Esta deuda no está vigente'; end if;
  if p_dias is null or p_dias not between 5 and 30 then raise exception 'El nuevo vencimiento es de 5 a 30 días desde hoy'; end if;
  v_venc := public.sumar_dias_lectivos(public.hoy(), p_dias);
  update public.deudas set vencimiento = v_venc, impago_comunicado = null where id = p_id;
  insert into public.historial (pedido_id, texto, quien_id, quien_nombre, fecha) values (d.pedido_id, 'Deuda ' || d.num || ' aplazada al ' || to_char(v_venc, 'DD/MM/YYYY'), yo.id, yo.nombre, public.hoy());
end $$;

-- El borrador y el diario también se pueden hacer con la factura a deber
create or replace function public.marcar_registro(p_id bigint, p_paso text) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id); v_lado text;
begin
  if yo.empresa_id = p.comprador_id then v_lado := 'comprador'; elsif yo.empresa_id = p.vendedor_id then v_lado := 'vendedor'; else raise exception 'Este pedido no es de tu empresa' using errcode = '42501'; end if;
  if p_paso not in ('borrador','diario') then raise exception 'Paso desconocido'; end if;
  if p.etapa not in ('factura_aceptada','a_deber','pagado') then raise exception 'La factura todavía no está aceptada'; end if;
  if p_paso = 'diario' and not exists (select 1 from public.registros_contables where pedido_id = p_id and lado = v_lado and paso = 'borrador') then raise exception 'Primero va el borrador manual'; end if;
  if exists (select 1 from public.registros_contables where pedido_id = p_id and lado = v_lado and paso = p_paso) then raise exception 'Este paso ya está marcado'; end if;
  insert into public.registros_contables (pedido_id, lado, paso, hecho_por, hecho_nombre) values (p_id, v_lado, p_paso, yo.id, yo.nombre);
  insert into public.historial (pedido_id, texto, quien_id, quien_nombre, fecha) values (p_id, case when p_paso = 'borrador' then 'Borrador manual' else 'Registro en el diario de Excel' end || ' hecho (' || v_lado || ')', yo.id, yo.nombre, public.hoy());
end $$;

-- Se paga todo o una parte. El dinero pasa al momento, como cualquier pago
create function public.pagar_deuda(p_id bigint, p_importe numeric) returns text language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); d public.deudas := public._deuda(p_id); v_imp numeric := round(p_importe, 2); v_com numeric; v_oid bigint; v_num text; v_just text; v_fnum text; v_concepto text;
begin
  if yo.empresa_id <> d.deudor_id then raise exception 'Solo paga quien debe' using errcode = '42501'; end if;
  if d.estado <> 'vigente' then raise exception 'Esta deuda no está vigente'; end if;
  if coalesce(v_imp, 0) <= 0 then raise exception 'El importe tiene que ser mayor que cero'; end if;
  if v_imp > d.pendiente then raise exception 'No puedes pagar más de lo que queda por pagar'; end if;
  perform public._pedido(d.pedido_id);
  if exists (select 1 from public.rectificativas where pedido_id = d.pedido_id and estado = 'emitida') then raise exception 'Hay una factura rectificativa pendiente de revisar'; end if;
  if d.origen = 'compra' and (select count(*) from public.registros_contables where pedido_id = d.pedido_id and lado = 'comprador') < 2 then
    raise exception 'Antes de pagar hay que hacer el borrador manual y el registro en el diario de Excel';
  end if;
  select num into v_fnum from public.facturas where pedido_id = d.pedido_id and estado = 'aceptada' order by version desc limit 1;
  v_concepto := case when d.origen = 'abono' then 'Pago abono ' || d.num when v_imp = d.pendiente and d.pendiente = d.importe then 'Pago factura ' || v_fnum else 'Pago parcial factura ' || v_fnum end;
  select comision_transferencia into strict v_com from public.condiciones_banco order by vigente_desde desc, id desc limit 1;
  v_num := public._numero('OP', yo.empresa_id);
  insert into public.ordenes_pago (pedido_id, deuda_id, num, ordenante_id, beneficiario_id, concepto, importe, comision, fecha, ordeno_id, ordeno_nombre)
    values (d.pedido_id, p_id, v_num, d.deudor_id, d.acreedor_id, v_concepto, v_imp, v_com, public.hoy(), yo.id, yo.nombre) returning id into v_oid;
  v_just := public._ejecutar_orden(v_oid);
  update public.deudas set pendiente = pendiente - v_imp, estado = case when pendiente - v_imp = 0 then 'saldada' else 'vigente' end where id = p_id;
  insert into public.historial (pedido_id, texto, quien_id, quien_nombre, fecha) values (d.pedido_id, 'Pago de ' || to_char(v_imp, 'FM999G999G990D00') || ' € de la deuda ' || d.num || '. Justificante ' || v_just, yo.id, yo.nombre, public.hoy());
  if d.origen = 'compra' and d.pendiente = v_imp then
    update public.pedidos set etapa = 'pagado', etapa_desde = public.hoy() where id = d.pedido_id;
  end if;
  return v_just;
end $$;

-- Impago: el acreedor es el equipo afectado y la profesora lo registra
create function public.comunicar_impago(p_id bigint) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); d public.deudas := public._deuda(p_id);
begin
  if yo.empresa_id <> d.acreedor_id then raise exception 'Solo el acreedor comunica el impago' using errcode = '42501'; end if;
  if d.estado <> 'vigente' or public.hoy() <= d.vencimiento then raise exception 'Esta deuda no ha vencido'; end if;
  if d.impago_comunicado is not null then raise exception 'El impago ya está comunicado'; end if;
  update public.deudas set impago_comunicado = public.hoy() where id = p_id;
  insert into public.historial (pedido_id, texto, quien_id, quien_nombre, fecha) values (d.pedido_id, 'Impago de la deuda ' || d.num || ' comunicado a la profesora', yo.id, yo.nombre, public.hoy());
end $$;
create function public.registrar_impago(p_id bigint) returns void language plpgsql security definer set search_path = '' as $$
declare d public.deudas := public._deuda(p_id);
begin
  if not public.es_profesora() then raise exception 'Solo la profesora registra incumplimientos' using errcode = '42501'; end if;
  if d.estado <> 'vigente' or public.hoy() <= d.vencimiento then raise exception 'Esta deuda no ha vencido'; end if;
  if d.impago_registrado then raise exception 'Este incumplimiento ya está registrado'; end if;
  update public.deudas set impago_registrado = true where id = p_id;
  insert into public.incumplimientos (pedido_id, deuda_id, responsable_id, afectada_id, texto, fecha, registrado_por) values (d.pedido_id, p_id, d.deudor_id, d.acreedor_id, 'No pagó la deuda ' || d.num || ' a su vencimiento', public.hoy(), auth.uid());
end $$;

-- 2. Rectificativas: también durante la deuda, y los descuentos también después del pago
create or replace function public.emitir_rectificativa(p_id bigint, p_tipo text, p_lineas jsonb, p_base numeric) returns bigint language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id); f public.facturas; v_base numeric; v_cuota numeric; v_id bigint; v_num text;
begin
  if yo.empresa_id <> public._gestora(p) then raise exception 'Solo el emisor de la factura emite la rectificativa' using errcode = '42501'; end if;
  if p.etapa not in ('factura_aceptada','a_deber','pagado') then raise exception 'Las rectificativas solo se emiten con la factura aceptada'; end if;
  if p.etapa = 'pagado' and p_tipo = 'devolucion' then raise exception 'La devolución de mercancía solo se admite antes del pago'; end if;
  if p.etapa = 'pagado' and p.vendedor_id > 6 then raise exception 'El Estado no hace abonos después del pago'; end if;
  if exists (select 1 from public.rectificativas where pedido_id = p_id and estado = 'emitida') then raise exception 'Ya hay una rectificativa pendiente de revisar'; end if;
  if exists (select 1 from public.deudas where pedido_id = p_id and origen = 'compra' and estado = 'propuesta') then raise exception 'Primero hay que responder a la propuesta de deuda'; end if;
  if p_tipo not in ('devolucion','rappel','pronto_pago','comercial') then raise exception 'Tipo de rectificativa desconocido'; end if;
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
  if -(v_base + v_cuota) > public._por_pagar(p_id) then raise exception 'La rectificativa no puede superar lo que queda de la factura'; end if;
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

-- Si ya se pagó de más, el vendedor pasa a deber la diferencia al cliente
create function public._abono(p public.pedidos, r public.rectificativas, p_importe numeric, yo public.perfiles) returns void language plpgsql security definer set search_path = '' as $$
declare v_num text := public._numero('D', p.vendedor_id);
begin
  insert into public.deudas (num, origen, pedido_id, rectificativa_id, deudor_id, acreedor_id, fecha, vencimiento_dias, vencimiento, condiciones, importe, pendiente, estado, propuso_empresa, propuso_id, propuso_nombre, respondio_id, respondio_nombre)
    values (v_num, 'abono', p.id, r.id, p.vendedor_id, p.comprador_id, public.hoy(), 30, public.sumar_dias_lectivos(public.hoy(), 30), 'Abono de la rectificativa ' || r.num, p_importe, p_importe, 'vigente', p.vendedor_id, r.elaboro_id, r.elaboro_nombre, yo.id, yo.nombre);
  insert into public.historial (pedido_id, texto, quien_id, quien_nombre, fecha) values (p.id, 'Abono ' || v_num || ': ' || public._corto(p.vendedor_id) || ' debe devolver lo cobrado de más', yo.id, yo.nombre, public.hoy());
end $$;

create or replace function public.aceptar_rectificativa(p_id bigint) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id); r public.rectificativas; rl public.rectificativa_lineas; pl public.pedido_lineas; d public.deudas; v_queda numeric;
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
  select * into d from public.deudas where pedido_id = p_id and origen = 'compra' and estado = 'vigente' for update;
  if found then
    v_queda := d.pendiente + r.total;
    update public.deudas set importe = importe + r.total, pendiente = greatest(v_queda, 0), estado = case when v_queda <= 0 then 'saldada' else 'vigente' end where id = d.id;
    if v_queda <= 0 then perform public._avanzar(p_id, 'pagado', 'Deuda ' || d.num || ' saldada con la rectificativa ' || r.num, yo); end if;
    if v_queda < 0 then perform public._abono(p, r, -v_queda, yo); end if;
  elsif p.etapa = 'pagado' then
    perform public._abono(p, r, -r.total, yo);
  end if;
end $$;

-- 3. Rappel por volumen: el proveedor publica tramos y se calcula sobre lo facturado en el mes
create table public.rappel_tramos (
  id bigint generated always as identity primary key,
  vendedor_id smallint not null references public.empresas(id) check (vendedor_id between 1 and 6 and vendedor_id <> 5),
  comprador_id smallint references public.empresas(id),
  volumen_min numeric(14,2) not null check (volumen_min > 0),
  porcentaje numeric(5,2) not null check (porcentaje > 0 and porcentaje <= 100),
  activo boolean not null default true,
  creado_nombre text not null,
  creado_en timestamptz not null default now()
);
create unique index rappel_tramos_uno on public.rappel_tramos (vendedor_id, coalesce(comprador_id, 0), volumen_min) where activo;

create function public.guardar_tramo_rappel(p_comprador smallint, p_volumen numeric, p_porcentaje numeric) returns bigint language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); v_id bigint;
begin
  if yo.empresa_id = 5 then raise exception 'El banco publica sus condiciones aparte'; end if;
  if p_comprador is not null and (p_comprador = yo.empresa_id or p_comprador not between 1 and 6) then raise exception 'Elige otro grupo como cliente'; end if;
  if coalesce(p_volumen, 0) <= 0 then raise exception 'Indica el volumen mensual a partir del que se aplica'; end if;
  if coalesce(p_porcentaje, 0) <= 0 or p_porcentaje > 100 then raise exception 'El porcentaje va de 0 a 100 %%'; end if;
  update public.rappel_tramos set activo = false where vendedor_id = yo.empresa_id and comprador_id is not distinct from p_comprador and volumen_min = round(p_volumen, 2) and activo;
  insert into public.rappel_tramos (vendedor_id, comprador_id, volumen_min, porcentaje, creado_nombre) values (yo.empresa_id, p_comprador, round(p_volumen, 2), round(p_porcentaje, 2), yo.nombre) returning id into v_id;
  perform public._registrar(yo.empresa_id, 'rappel', 'tramo desde ' || round(p_volumen, 2)::text || ' €', null, round(p_porcentaje, 2)::text || ' %');
  return v_id;
end $$;
create function public.quitar_tramo_rappel(p_id bigint) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor();
begin
  update public.rappel_tramos set activo = false where id = p_id and vendedor_id = yo.empresa_id and activo;
  if not found then raise exception 'Ese tramo no es tuyo o ya está quitado'; end if;
end $$;

-- Volumen: bases de las facturas aceptadas del mes, menos las devoluciones aceptadas
create function public.volumen_cliente(p_vendedor smallint, p_comprador smallint, p_mes date) returns table (volumen numeric, volumen_min numeric, porcentaje numeric, rappel numeric, ya_emitido numeric, por_emitir numeric, siguiente_volumen numeric, siguiente_porcentaje numeric) language plpgsql stable security definer set search_path = '' as $$
declare v_ini date := date_trunc('month', p_mes)::date; v_fin date := (date_trunc('month', p_mes) + interval '1 month')::date; v_vol numeric; v_min numeric; v_pct numeric; v_ya numeric; v_rap numeric := 0; v_sv numeric; v_sp numeric; v_propios boolean;
begin
  if not (public.es_profesora() or public.mi_empresa() in (p_vendedor, p_comprador)) then raise exception 'No puedes consultar este volumen' using errcode = '42501'; end if;
  select coalesce(sum(f.base), 0) into v_vol from public.facturas f join public.pedidos p on p.id = f.pedido_id
    where p.vendedor_id = p_vendedor and p.comprador_id = p_comprador and f.estado = 'aceptada' and f.fecha >= v_ini and f.fecha < v_fin;
  v_vol := v_vol + coalesce((select sum(r.base) from public.rectificativas r join public.facturas f on f.id = r.factura_id join public.pedidos p on p.id = r.pedido_id
    where p.vendedor_id = p_vendedor and p.comprador_id = p_comprador and r.tipo = 'devolucion' and r.estado = 'aceptada' and f.fecha >= v_ini and f.fecha < v_fin), 0);
  -- Los tramos pactados con un cliente sustituyen a los generales
  v_propios := exists (select 1 from public.rappel_tramos t where t.vendedor_id = p_vendedor and t.comprador_id = p_comprador and t.activo);
  select t.volumen_min, t.porcentaje into v_min, v_pct from public.rappel_tramos t where t.vendedor_id = p_vendedor and t.activo and t.comprador_id is not distinct from case when v_propios then p_comprador end and t.volumen_min <= v_vol order by t.volumen_min desc limit 1;
  select t.volumen_min, t.porcentaje into v_sv, v_sp from public.rappel_tramos t where t.vendedor_id = p_vendedor and t.activo and t.comprador_id is not distinct from case when v_propios then p_comprador end and t.volumen_min > v_vol order by t.volumen_min limit 1;
  if v_pct is not null then v_rap := round(v_vol * v_pct / 100, 2); end if;
  select coalesce(-sum(r.base), 0) into v_ya from public.rectificativas r join public.pedidos p on p.id = r.pedido_id
    where p.vendedor_id = p_vendedor and p.comprador_id = p_comprador and r.rappel_mes = v_ini and r.estado in ('emitida','aceptada');
  return query select v_vol, v_min, coalesce(v_pct, 0), v_rap, v_ya, greatest(v_rap - v_ya, 0), v_sv, v_sp;
end $$;

-- La base del rappel sale del cálculo, y se aplica a la operación que elige el proveedor
create function public.emitir_rappel_volumen(p_pedido bigint, p_mes date) returns bigint language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos; v_base numeric; v_id bigint;
begin
  select * into p from public.pedidos where id = p_pedido;
  if not found then raise exception 'El pedido no existe'; end if;
  if yo.empresa_id <> p.vendedor_id then raise exception 'Solo el proveedor emite el rappel' using errcode = '42501'; end if;
  select por_emitir into v_base from public.volumen_cliente(p.vendedor_id, p.comprador_id, p_mes);
  if coalesce(v_base, 0) <= 0 then raise exception 'Este cliente no tiene rappel pendiente en ese mes'; end if;
  v_id := public.emitir_rectificativa(p_pedido, 'rappel', null, v_base);
  update public.rectificativas set rappel_mes = date_trunc('month', p_mes)::date where id = v_id;
  return v_id;
end $$;

-- 4. RLS: lectura por política, escritura solo mediante funciones
alter table public.deudas enable row level security;
alter table public.rappel_tramos enable row level security;
revoke all on public.deudas, public.rappel_tramos from public, anon, authenticated, service_role;
grant select on public.deudas, public.rappel_tramos to authenticated;
create policy deudas_partes on public.deudas for select to authenticated using (public.es_profesora() or public.mi_empresa() in (deudor_id, acreedor_id));
create policy tramos_visibles on public.rappel_tramos for select to authenticated using (comprador_id is null or public.es_profesora() or public.mi_empresa() in (vendedor_id, comprador_id));

do $$
declare f record;
begin
  for f in select oid::regprocedure as s from pg_proc where pronamespace = 'public'::regnamespace and proname = any (array['_deuda','_por_pagar','proponer_deuda','responder_deuda','aplazar_deuda','pagar_deuda','comunicar_impago','registrar_impago','_abono','guardar_tramo_rappel','quitar_tramo_rappel','volumen_cliente','emitir_rappel_volumen']) loop
    execute 'revoke execute on function ' || f.s || ' from public, anon, authenticated, service_role';
  end loop;
end $$;
grant execute on function public.proponer_deuda(bigint,int,text), public.responder_deuda(bigint,boolean,text), public.aplazar_deuda(bigint,int), public.pagar_deuda(bigint,numeric), public.comunicar_impago(bigint), public.registrar_impago(bigint), public.guardar_tramo_rappel(smallint,numeric,numeric), public.quitar_tramo_rappel(bigint), public.volumen_cliente(smallint,smallint,date), public.emitir_rappel_volumen(bigint,date) to authenticated;
notify pgrst, 'reload schema';
