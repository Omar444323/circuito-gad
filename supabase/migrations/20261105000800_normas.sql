-- Circuito GAD · Ajustes a las normas: cuentas del Estado, firma, pagos automáticos, punto 8,
-- presupuestos y negociación, gastos de envío, circulares y entregas.
-- Añade tablas y columnas y sustituye funciones. No borra ninguna fila.
-- Los drop son de una restricción que se amplía y de funciones cuya firma cambia o que dejan de usarse.

-- 1. Cuentas del Estado: no son grupos, nadie entra con ellas
alter table public.empresas drop constraint empresas_id_check;
alter table public.empresas add constraint empresas_id_check check (id between 1 and 9);
alter table public.empresas add column tipo text not null default 'grupo' check (tipo in ('grupo','estado'));
alter table public.empresas add constraint empresas_saldo_inicial_limite check (saldo_inicial <= 50000);
insert into public.empresas (id, nombre, corto, sector, actividad, iban, saldo_inicial, con_almacen, tipo) values
  (7, 'Estado · Venta de materias primas', 'Estado vende materias', 'Estado', 'Venta de materias primas al G1', 'ES00 9999 0001 1700 0000 0007', 0, false, 'estado'),
  (8, 'Hacienda Pública', 'Hacienda', 'Estado', 'Impuestos', 'ES00 9999 0001 1800 0000 0008', 0, false, 'estado'),
  (9, 'Tesorería General de la Seguridad Social', 'Seguridad Social', 'Estado', 'Cotizaciones', 'ES00 9999 0001 1900 0000 0009', 0, false, 'estado');
alter table public.perfiles add constraint perfiles_empresa_grupo check (empresa_id is null or empresa_id between 1 and 6);

-- Catálogo: coste y margen aprobados; transporte identificado para los gastos de envío
alter table public.catalogo
  add column coste numeric(12,2),
  add column margen numeric(6,2),
  add column es_transporte boolean not null default false;
insert into public.catalogo (empresa_id, nombre, precio) values
  (7, 'Planchas de acero 1 mm', 8), (7, 'Tornillería M6 (caja 100 uds)', 2.5), (7, 'Pintura epoxi (bote 5 L)', 25);
insert into public.catalogo (empresa_id, nombre, precio, es_transporte)
  select 4, v.n, v.p, v.t from (values ('Transporte de mercancías (envío)', 30::numeric, true), ('Suministro de electricidad (mes)', 120, false), ('Suministro de agua (mes)', 45, false), ('Alquiler de local (mes)', 500, false)) as v(n, p, t)
  where exists (select 1 from public.empresas where id = 4);

-- 2. Quién firma. La cuenta del grupo es compartida: el que entra elige quién es, y esa persona firma
alter table public.perfiles add column cuenta_grupo boolean not null default false;
update public.perfiles set cuenta_grupo = true where usuario ~ '^grupo[1-6]$';

create function public._firmante_cabecera() returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  v := nullif(current_setting('request.headers', true), '')::json ->> 'x-firmante';
  if v ~ '^[0-9a-fA-F-]{36}$' then return v::uuid; end if;
  return null;
exception when others then
  return null;
end $$;

-- Si la cuenta es compartida, actúa la persona elegida, que tiene que ser del mismo grupo
create or replace function public._actor() returns public.perfiles language plpgsql stable security definer set search_path = '' as $$
declare v public.perfiles; f public.perfiles;
begin
  select * into v from public.perfiles where id = auth.uid() and activo;
  if not found then raise exception 'Sesión no válida' using errcode = '42501'; end if;
  if v.rol <> 'alumno' then raise exception 'La profesora no actúa en nombre de los grupos' using errcode = '42501'; end if;
  if not v.cuenta_grupo then return v; end if;
  select * into f from public.perfiles where id = public._firmante_cabecera() and empresa_id = v.empresa_id and activo and not cuenta_grupo;
  if not found then raise exception 'Selecciona quién eres antes de firmar' using errcode = '42501'; end if;
  return f;
end $$;

create function public._firma_id() returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce((select f.id from public.perfiles v join public.perfiles f on f.empresa_id = v.empresa_id and f.activo and not f.cuenta_grupo and f.id = public._firmante_cabecera() where v.id = auth.uid() and v.cuenta_grupo), auth.uid())
$$;

create or replace function public._registrar(p_empresa smallint, p_entidad text, p_campo text, p_ant text, p_nue text) returns void language sql security definer set search_path = '' as $$
  insert into public.registro_cambios (empresa_id, entidad, campo, valor_anterior, valor_nuevo, hecho_por)
  select p_empresa, p_entidad, p_campo, p_ant, p_nue, public._firma_id() where p_ant is distinct from p_nue
$$;

create or replace function public.dar_baja_integrante(p_perfil uuid) returns void language plpgsql security definer set search_path = '' as $$
declare p public.perfiles;
begin
  select * into strict p from public.perfiles where id = p_perfil for update;
  if p.empresa_id is null then raise exception 'No se puede dar de baja a la profesora'; end if;
  perform public._puede_editar(p.empresa_id);
  if p.cuenta_grupo then raise exception 'La cuenta del grupo no se puede dar de baja'; end if;
  perform 1 from public.perfiles where empresa_id = p.empresa_id and activo for update;
  if not exists (select 1 from public.perfiles where empresa_id = p.empresa_id and activo and id <> p_perfil) then raise exception 'El equipo necesita al menos un integrante activo'; end if;
  update public.perfiles set activo = false where id = p_perfil;
  perform public._registrar(p.empresa_id, 'integrante', 'baja', p.nombre, null);
end $$;

create or replace function public.mover_alumno(p_perfil uuid, p_destino smallint) returns void language plpgsql security definer set search_path = '' as $$
declare p public.perfiles;
begin
  if not public.es_profesora() then raise exception 'Solo la profesora mueve alumnos' using errcode = '42501'; end if;
  select * into strict p from public.perfiles where id = p_perfil and rol = 'alumno' for update;
  if p.cuenta_grupo then raise exception 'La cuenta del grupo no se mueve a otro grupo'; end if;
  perform 1 from public.perfiles where empresa_id = p.empresa_id and activo for update;
  if p.activo and not exists (select 1 from public.perfiles where empresa_id = p.empresa_id and activo and id <> p_perfil) then raise exception 'El equipo necesita al menos un integrante activo'; end if;
  update public.perfiles set empresa_id = p_destino where id = p_perfil;
  perform public._registrar(p_destino, 'integrante', 'grupo', p.empresa_id::text, p_destino::text);
end $$;

-- 3. El G1 lleva los dos lados de las compras al Estado. El Estado no emite documentos
create function public._gestora(p public.pedidos) returns smallint language sql immutable security definer set search_path = '' as $$
  select case when p.vendedor_id = 7 then 1::smallint else p.vendedor_id end
$$;

-- 4. Descubierto: prohibido salvo autorización de la profesora. Vale la última autorización
create table public.autorizaciones_descubierto (
  id bigint generated always as identity primary key,
  empresa_id smallint not null references public.empresas(id) check (empresa_id between 1 and 6),
  limite numeric(14,2) not null check (limite >= 0),
  motivo text not null,
  fecha date not null,
  concedida_por uuid not null references public.perfiles(id)
);
create function public._descubierto(p_empresa smallint) returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((select limite from public.autorizaciones_descubierto where empresa_id = p_empresa order by id desc limit 1), 0)
$$;
create or replace function public.disponible(p_empresa smallint) returns numeric language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.es_profesora() or public.mi_empresa() in (p_empresa, 5)) then raise exception 'No puedes consultar otra cuenta' using errcode = '42501'; end if;
  return public._saldo(p_empresa) + public._descubierto(p_empresa);
end $$;
create function public.autorizar_descubierto(p_empresa smallint, p_limite numeric, p_motivo text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.es_profesora() then raise exception 'Solo la profesora autoriza el descubierto' using errcode = '42501'; end if;
  if p_empresa not between 1 and 6 then raise exception 'Elige un grupo'; end if;
  if coalesce(p_limite, -1) < 0 then raise exception 'El límite no puede ser negativo'; end if;
  if length(trim(coalesce(p_motivo, ''))) = 0 then raise exception 'Indica el motivo'; end if;
  insert into public.autorizaciones_descubierto (empresa_id, limite, motivo, fecha, concedida_por) values (p_empresa, round(p_limite, 2), trim(p_motivo), public.hoy(), auth.uid());
  perform public._registrar(p_empresa, 'banco', 'descubierto autorizado', null, round(p_limite, 2)::text);
end $$;

-- 5. Pagos: se ejecutan solos y el banco los marca como revisados
alter table public.ordenes_pago
  alter column pedido_id drop not null,
  add column revisado_id uuid references public.perfiles(id),
  add column revisado_nombre text,
  add column revisado_en timestamptz;
create index ordenes_sin_revisar on public.ordenes_pago (id) where revisado_en is null;
drop function public.ejecutar_orden(bigint);
drop function public.denegar_orden(bigint, text);
drop function public.reordenar(bigint);
drop function public.ordenar_pago(bigint, boolean);
-- Una orden que estuviera en el banco no movió dinero: queda cerrada y la factura vuelve a estar pendiente de pago
update public.ordenes_pago set estado = 'denegada', motivo_denegacion = 'Sustituida por el pago automático' where estado = 'pendiente';
update public.pedidos set etapa = 'factura_aceptada' where etapa in ('orden_pendiente', 'orden_denegada');

create function public._ejecutar_orden(p_orden bigint) returns text language plpgsql security definer set search_path = '' as $$
declare o public.ordenes_pago; v_just text; v_ord text; v_ben text;
begin
  select * into strict o from public.ordenes_pago where id = p_orden for update;
  perform 1 from public.empresas where id in (o.ordenante_id, o.beneficiario_id, 5) order by id for update;
  if public._saldo(o.ordenante_id) + public._descubierto(o.ordenante_id) < o.importe + o.comision then raise exception 'Saldo insuficiente. El descubierto está prohibido sin autorización de la profesora'; end if;
  v_ord := public._corto(o.ordenante_id);
  v_ben := public._corto(o.beneficiario_id);
  v_just := public._numero('JB', 5::smallint);
  perform public._movimiento(o.ordenante_id, o.concepto || ' a ' || v_ben, -o.importe, v_just);
  perform public._movimiento(o.beneficiario_id, replace(o.concepto, 'Pago', 'Cobro') || ' de ' || v_ord, o.importe, v_just);
  if o.comision > 0 then
    perform public._movimiento(o.ordenante_id, 'Comisión por transferencia ' || o.num, -o.comision, v_just);
    perform public._movimiento(5::smallint, 'Ingreso por comisión de transferencia ' || o.num, o.comision, v_just);
  end if;
  update public.ordenes_pago set estado = 'ejecutada', justificante = v_just, ejecuto_nombre = 'Automática', fecha_ejecucion = public.hoy() where id = p_orden;
  return v_just;
end $$;

create function public.ordenar_pago(p_id bigint) returns bigint language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id); f public.facturas; v_imp numeric; v_com numeric; v_id bigint; v_num text; v_just text;
begin
  if yo.empresa_id <> p.comprador_id then raise exception 'Solo el comprador ordena el pago' using errcode = '42501'; end if;
  if p.etapa <> 'factura_aceptada' then raise exception 'Esta factura no está pendiente de pago'; end if;
  if (select count(*) from public.registros_contables where pedido_id = p_id and lado = 'comprador') < 2 then
    raise exception 'Antes de ordenar el pago hay que hacer el borrador manual y el registro en el diario de Excel';
  end if;
  if exists (select 1 from public.rectificativas where pedido_id = p_id and estado = 'emitida') then raise exception 'Hay una factura rectificativa pendiente de revisar'; end if;
  select * into strict f from public.facturas where pedido_id = p_id and estado = 'aceptada' order by version desc limit 1;
  v_imp := f.total + coalesce((select sum(total) from public.rectificativas where pedido_id = p_id and estado = 'aceptada'), 0);
  if v_imp <= 0 then raise exception 'El importe a transferir tiene que ser mayor que cero'; end if;
  select comision_transferencia into strict v_com from public.condiciones_banco order by vigente_desde desc, id desc limit 1;
  v_num := public._numero('OP', yo.empresa_id);
  insert into public.ordenes_pago (pedido_id, num, ordenante_id, beneficiario_id, concepto, importe, comision, fecha, ordeno_id, ordeno_nombre)
    values (p_id, v_num, p.comprador_id, p.vendedor_id, 'Pago factura ' || f.num, v_imp, v_com, public.hoy(), yo.id, yo.nombre) returning id into v_id;
  v_just := public._ejecutar_orden(v_id);
  perform public._avanzar(p_id, 'pagado', 'Orden de pago ' || v_num || ' ejecutada automáticamente. Justificante ' || v_just, yo);
  return v_id;
end $$;

-- Pagos a Hacienda y a la Seguridad Social: no nacen de un pedido
create function public.pagar_estado(p_cuenta smallint, p_concepto text, p_importe numeric) returns text language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); v_com numeric; v_id bigint; v_num text;
begin
  if p_cuenta not in (8, 9) then raise exception 'Solo se paga así a Hacienda o a la Seguridad Social'; end if;
  if length(trim(coalesce(p_concepto, ''))) = 0 then raise exception 'Indica el concepto del pago'; end if;
  if coalesce(p_importe, 0) <= 0 then raise exception 'El importe tiene que ser mayor que cero'; end if;
  select comision_transferencia into strict v_com from public.condiciones_banco order by vigente_desde desc, id desc limit 1;
  v_num := public._numero('OP', yo.empresa_id);
  insert into public.ordenes_pago (num, ordenante_id, beneficiario_id, concepto, importe, comision, fecha, ordeno_id, ordeno_nombre)
    values (v_num, yo.empresa_id, p_cuenta, 'Pago: ' || trim(p_concepto), round(p_importe, 2), v_com, public.hoy(), yo.id, yo.nombre) returning id into v_id;
  return public._ejecutar_orden(v_id);
end $$;

create function public.revisar_pago(p_orden bigint) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor();
begin
  if yo.empresa_id <> 5 then raise exception 'Solo el banco revisa los pagos' using errcode = '42501'; end if;
  update public.ordenes_pago set revisado_id = yo.id, revisado_nombre = yo.nombre, revisado_en = now() where id = p_orden and revisado_en is null;
  if not found then raise exception 'Ese pago no existe o ya está revisado'; end if;
end $$;

-- 6. Condiciones del banco: tipos, comisiones, plazos y condiciones publicados
alter table public.condiciones_banco
  add column tipo_interes numeric(5,2),
  add column plazo_max_meses int,
  add column condiciones text;
drop function public.publicar_comision(numeric);
create function public.publicar_condiciones(p_comision numeric, p_tipo numeric, p_plazo int, p_condiciones text) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); v_ant public.condiciones_banco;
begin
  if yo.empresa_id <> 5 then raise exception 'Solo el banco publica sus condiciones' using errcode = '42501'; end if;
  if p_comision is null or p_comision < 0 then raise exception 'La comisión no puede ser negativa'; end if;
  if coalesce(p_tipo, 0) < 0 or coalesce(p_plazo, 1) <= 0 then raise exception 'Revisa el tipo de interés y el plazo'; end if;
  select * into v_ant from public.condiciones_banco order by vigente_desde desc, id desc limit 1;
  insert into public.condiciones_banco (comision_transferencia, tipo_interes, plazo_max_meses, condiciones, publicada_por) values (round(p_comision, 2), p_tipo, p_plazo, nullif(trim(coalesce(p_condiciones, '')), ''), yo.id);
  perform public._registrar(5::smallint, 'condiciones', 'comisión por transferencia', v_ant.comision_transferencia::text, round(p_comision, 2)::text);
  perform public._registrar(5::smallint, 'condiciones', 'tipo de interés', v_ant.tipo_interes::text, p_tipo::text);
  perform public._registrar(5::smallint, 'condiciones', 'plazo máximo en meses', v_ant.plazo_max_meses::text, p_plazo::text);
end $$;

-- 7. Precios: coste más margen, y cada cambio pasa por la profesora
create table public.solicitudes_precio (
  id bigint generated always as identity primary key,
  empresa_id smallint not null references public.empresas(id),
  catalogo_id uuid references public.catalogo(id),
  nombre text not null,
  coste numeric(12,2) not null check (coste > 0),
  margen numeric(6,2) not null check (margen >= 0),
  precio numeric(12,2) not null check (precio > 0),
  precio_anterior numeric(12,2),
  estado text not null default 'pendiente' check (estado in ('pendiente','aceptada','rechazada')),
  motivo_rechazo text,
  fecha date not null,
  solicito_id uuid not null references public.perfiles(id),
  solicito_nombre text not null,
  resuelta_en timestamptz
);
create unique index solicitudes_precio_una on public.solicitudes_precio (catalogo_id) where estado = 'pendiente';
create unique index solicitudes_precio_alta_una on public.solicitudes_precio (empresa_id, lower(nombre)) where estado = 'pendiente' and catalogo_id is null;

drop function public.guardar_catalogo(smallint, uuid, text, numeric);
-- El nombre se cambia al momento. El precio sale de coste y margen, y espera a la profesora
create function public.guardar_catalogo(p_empresa smallint, p_id uuid, p_nombre text, p_coste numeric default null, p_margen numeric default 0) returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.catalogo; v_id uuid; v_precio numeric; yo public.perfiles; v_prof boolean := public.es_profesora();
begin
  perform public._puede_editar(p_empresa);
  if p_empresa in (5, 8, 9) then raise exception 'El banco publica sus comisiones en sus condiciones, y Hacienda y la Seguridad Social no tienen catálogo'; end if;
  if length(trim(coalesce(p_nombre, ''))) = 0 then raise exception 'Cada artículo necesita nombre'; end if;
  if p_id is null and coalesce(p_coste, 0) <= 0 then raise exception 'Cada artículo necesita nombre y un coste mayor que cero'; end if;
  if p_coste is not null and p_coste <= 0 then raise exception 'El coste tiene que ser mayor que cero'; end if;
  if coalesce(p_margen, 0) < 0 then raise exception 'El margen no puede ser negativo'; end if;
  v_precio := round(p_coste * (1 + coalesce(p_margen, 0) / 100), 2);
  if not v_prof then yo := public._actor(); end if;
  if p_id is not null then
    select * into c from public.catalogo where id = p_id and empresa_id = p_empresa and activo for update;
    if not found then raise exception 'Ese artículo no está en el catálogo'; end if;
    update public.catalogo set nombre = trim(p_nombre) where id = p_id;
    perform public._registrar(p_empresa, 'catalogo', 'nombre', c.nombre, trim(p_nombre));
    if p_coste is null then return p_id; end if;
    -- Si el precio final no cambia no hay nada que aprobar: solo se guarda cómo se calcula
    if v_precio = c.precio then
      update public.catalogo set coste = p_coste, margen = coalesce(p_margen, 0) where id = p_id;
      return p_id;
    end if;
    if v_prof then
      update public.catalogo set precio = v_precio, coste = p_coste, margen = coalesce(p_margen, 0) where id = p_id;
      perform public._registrar(p_empresa, 'catalogo', 'precio de ' || trim(p_nombre), c.precio::text, v_precio::text);
      return p_id;
    end if;
    if exists (select 1 from public.solicitudes_precio where catalogo_id = p_id and estado = 'pendiente') then raise exception 'Este artículo ya tiene un cambio de precio esperando a la profesora'; end if;
    insert into public.solicitudes_precio (empresa_id, catalogo_id, nombre, coste, margen, precio, precio_anterior, fecha, solicito_id, solicito_nombre)
      values (p_empresa, p_id, trim(p_nombre), p_coste, coalesce(p_margen, 0), v_precio, c.precio, public.hoy(), yo.id, yo.nombre);
    return p_id;
  end if;
  if v_prof then
    insert into public.catalogo (empresa_id, nombre, precio, coste, margen) values (p_empresa, trim(p_nombre), v_precio, p_coste, coalesce(p_margen, 0)) returning id into v_id;
    perform public._registrar(p_empresa, 'catalogo', 'alta', null, trim(p_nombre) || ' · ' || v_precio::text);
    return v_id;
  end if;
  if exists (select 1 from public.catalogo where empresa_id = p_empresa and activo and lower(nombre) = lower(trim(p_nombre))) then raise exception 'Ese artículo ya está en el catálogo'; end if;
  if exists (select 1 from public.solicitudes_precio where empresa_id = p_empresa and catalogo_id is null and estado = 'pendiente' and lower(nombre) = lower(trim(p_nombre))) then raise exception 'Ese artículo ya está esperando a la profesora'; end if;
  insert into public.solicitudes_precio (empresa_id, nombre, coste, margen, precio, fecha, solicito_id, solicito_nombre)
    values (p_empresa, trim(p_nombre), p_coste, coalesce(p_margen, 0), v_precio, public.hoy(), yo.id, yo.nombre);
  return null;
end $$;

create function public.resolver_precio(p_id bigint, p_aceptar boolean, p_motivo text default null) returns void language plpgsql security definer set search_path = '' as $$
declare s public.solicitudes_precio; c public.catalogo;
begin
  if not public.es_profesora() then raise exception 'Solo la profesora aprueba los precios' using errcode = '42501'; end if;
  select * into s from public.solicitudes_precio where id = p_id and estado = 'pendiente' for update;
  if not found then raise exception 'Esa solicitud no existe o ya está resuelta'; end if;
  if not coalesce(p_aceptar, false) then
    if length(trim(coalesce(p_motivo, ''))) = 0 then raise exception 'Indica el motivo del rechazo'; end if;
    update public.solicitudes_precio set estado = 'rechazada', motivo_rechazo = trim(p_motivo), resuelta_en = now() where id = p_id;
    return;
  end if;
  if s.catalogo_id is null then
    if exists (select 1 from public.catalogo where empresa_id = s.empresa_id and activo and lower(nombre) = lower(s.nombre)) then raise exception 'Ese artículo ya está en el catálogo'; end if;
    insert into public.catalogo (empresa_id, nombre, precio, coste, margen) values (s.empresa_id, s.nombre, s.precio, s.coste, s.margen);
    perform public._registrar(s.empresa_id, 'catalogo', 'alta', null, s.nombre || ' · ' || s.precio::text);
  else
    select * into c from public.catalogo where id = s.catalogo_id and activo for update;
    if not found then raise exception 'El artículo ya no está en el catálogo'; end if;
    update public.catalogo set precio = s.precio, coste = s.coste, margen = s.margen where id = c.id;
    perform public._registrar(s.empresa_id, 'catalogo', 'precio de ' || c.nombre, c.precio::text, s.precio::text);
  end if;
  update public.solicitudes_precio set estado = 'aceptada', resuelta_en = now() where id = p_id;
end $$;

-- 8. Pedidos: descuentos pactados, envío y comprobación del 20 % antes de comprar
alter table public.pedidos
  add column dto_pactado numeric(5,2) not null default 0,
  add column rappel_pactado numeric(5,2) not null default 0,
  add column pronto_pago_pactado numeric(5,2) not null default 0,
  add column envio_de bigint references public.pedidos(id),
  add column confirmo_comprobacion boolean not null default false;
create index pedidos_envio on public.pedidos (envio_de);

create function public._comprobar_compra(p_empresa smallint, p_importe numeric, p_confirmado boolean) returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_importe > public._saldo(p_empresa) * 0.2 and not coalesce(p_confirmado, false) then
    raise exception 'Esta compra supera el 20 %% de tu tesorería: confirma que has comprobado saldo, vencimiento y forma de pago';
  end if;
end $$;

create function public._insertar_pedido(yo public.perfiles, p_vendedor smallint, p_lineas jsonb, p_dias int, p_dto numeric, p_rappel numeric, p_pp numeric, p_confirmado boolean, p_envio_de bigint) returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_servicio boolean := p_vendedor = 4; v_num text := public._numero('P', yo.empresa_id);
begin
  insert into public.pedidos (num, comprador_id, vendedor_id, servicio, fecha, entrega_dias, etapa, etapa_desde, elaboro_id, elaboro_nombre, dto_pactado, rappel_pactado, pronto_pago_pactado, envio_de, confirmo_comprobacion)
    values (v_num, yo.empresa_id, p_vendedor, v_servicio, public.hoy(), case when v_servicio then null else p_dias end, 'pedido_enviado', public.hoy(), yo.id, yo.nombre, p_dto, p_rappel, p_pp, p_envio_de, coalesce(p_confirmado, false))
    returning id into v_id;
  insert into public.pedido_lineas (pedido_id, catalogo_id, descripcion, unidades, precio)
    select v_id, c.id, c.nombre, x.unidades, coalesce(x.precio, c.precio) from jsonb_to_recordset(p_lineas) as x(catalogo_id uuid, unidades numeric, precio numeric) join public.catalogo c on c.id = x.catalogo_id;
  insert into public.historial (pedido_id, texto, quien_id, quien_nombre, fecha) values (v_id, 'Pedido ' || v_num || ' enviado a ' || public._corto(p_vendedor), yo.id, yo.nombre, public.hoy());
  return v_id;
end $$;

-- Los gastos de envío son un servicio del G4: pedido propio, enlazado al de la mercancía
create function public._contratar_envio(yo public.perfiles, g public.pedidos, p_catalogo uuid, p_unidades numeric) returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_num text;
begin
  if g.servicio then raise exception 'Los servicios no llevan gastos de envío'; end if;
  if g.comprador_id = 4 then raise exception 'El G4 hace su propio transporte'; end if;
  if not exists (select 1 from public.catalogo where id = p_catalogo and empresa_id = 4 and activo and es_transporte) then raise exception 'Elige un servicio de transporte del G4'; end if;
  if coalesce(p_unidades, 0) <= 0 then raise exception 'Las unidades del envío tienen que ser mayores que 0'; end if;
  if exists (select 1 from public.pedidos where envio_de = g.id and etapa <> 'pedido_rechazado') then raise exception 'Este pedido ya tiene el envío contratado'; end if;
  v_id := public._insertar_pedido(yo, 4::smallint, jsonb_build_array(jsonb_build_object('catalogo_id', p_catalogo, 'unidades', p_unidades)), null, 0, 0, 0, true, g.id);
  update public.pedido_lineas set descripcion = descripcion || ' · pedido ' || g.num where pedido_id = v_id;
  select num into v_num from public.pedidos where id = v_id;
  insert into public.historial (pedido_id, texto, quien_id, quien_nombre, fecha) values (g.id, 'Envío contratado con el G4: pedido ' || v_num, yo.id, yo.nombre, public.hoy());
  return v_id;
end $$;

create function public.contratar_envio(p_pedido bigint, p_catalogo uuid, p_unidades numeric) returns bigint language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); g public.pedidos := public._pedido(p_pedido);
begin
  if yo.empresa_id <> g.comprador_id then raise exception 'Solo el comprador contrata el envío' using errcode = '42501'; end if;
  if g.etapa = 'pedido_rechazado' then raise exception 'Este pedido está rechazado'; end if;
  return public._contratar_envio(yo, g, p_catalogo, p_unidades);
end $$;

drop function public.crear_pedido(smallint, jsonb, int);
create function public.crear_pedido(p_vendedor smallint, p_lineas jsonb, p_entrega_dias int, p_confirmado boolean default false, p_envio jsonb default null) returns bigint language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); v_id bigint; v_servicio boolean := p_vendedor = 4; v_imp numeric; g public.pedidos;
begin
  if p_vendedor = yo.empresa_id then raise exception 'Una empresa no puede hacerse un pedido a sí misma'; end if;
  if p_vendedor = 5 or p_vendedor not between 1 and 7 then raise exception 'Ese proveedor no vende artículos ni servicios'; end if;
  if p_vendedor = 7 and yo.empresa_id <> 1 then raise exception 'El Estado solo vende materias primas al G1' using errcode = '42501'; end if;
  if not v_servicio and (p_entrega_dias is null or p_entrega_dias not between 1 and 5) then raise exception 'El plazo de entrega va de 1 a 5 días lectivos'; end if;
  if coalesce(jsonb_array_length(p_lineas), 0) = 0 then raise exception 'Añade al menos una línea al pedido'; end if;
  if exists (select 1 from jsonb_to_recordset(p_lineas) as x(catalogo_id uuid, unidades numeric)
    left join public.catalogo c on c.id = x.catalogo_id and c.empresa_id = p_vendedor and c.activo
    where c.id is null or coalesce(x.unidades, 0) <= 0) then
    raise exception 'Cada línea necesita un artículo del catálogo del proveedor y unidades mayores que 0';
  end if;
  select sum(x.unidades * c.precio) into v_imp from jsonb_to_recordset(p_lineas) as x(catalogo_id uuid, unidades numeric) join public.catalogo c on c.id = x.catalogo_id;
  perform public._comprobar_compra(yo.empresa_id, v_imp, p_confirmado);
  -- Solo se pasan artículo y unidades: en un pedido directo el precio sale siempre del catálogo
  v_id := public._insertar_pedido(yo, p_vendedor, (select jsonb_agg(jsonb_build_object('catalogo_id', x.catalogo_id, 'unidades', x.unidades)) from jsonb_to_recordset(p_lineas) as x(catalogo_id uuid, unidades numeric)), p_entrega_dias, 0, 0, 0, p_confirmado, null);
  if p_envio is not null then
    select * into strict g from public.pedidos where id = v_id;
    perform public._contratar_envio(yo, g, (p_envio ->> 'catalogo_id')::uuid, coalesce((p_envio ->> 'unidades')::numeric, 1));
  end if;
  return v_id;
end $$;

create or replace function public.aceptar_pedido(p_id bigint) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id); v_fecha date;
begin
  if yo.empresa_id <> public._gestora(p) then raise exception 'Solo el proveedor responde al pedido' using errcode = '42501'; end if;
  if p.etapa <> 'pedido_enviado' then raise exception 'Este pedido ya está respondido'; end if;
  update public.pedidos set reviso_id = yo.id, reviso_nombre = yo.nombre where id = p_id;
  if p.servicio then
    perform public._avanzar(p_id, 'recibido', 'Pedido aceptado y servicio prestado', yo);
  else
    v_fecha := public.sumar_dias_lectivos(public.hoy(), p.entrega_dias);
    update public.pedidos set entrega_fecha = v_fecha where id = p_id;
    perform public._avanzar(p_id, 'pedido_aceptado', 'Pedido aceptado. Entrega pactada el ' || to_char(v_fecha, 'DD/MM/YYYY'), yo);
  end if;
end $$;

create or replace function public.rechazar_pedido(p_id bigint, p_motivo text) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id); e public.pedidos;
begin
  if yo.empresa_id <> public._gestora(p) then raise exception 'Solo el proveedor responde al pedido' using errcode = '42501'; end if;
  if p.etapa <> 'pedido_enviado' then raise exception 'Este pedido ya está respondido'; end if;
  if p_motivo is null or p_motivo not in ('Falta de existencias','Falta de liquidez','Precio no aceptado','Riesgo excesivo','Documento incorrecto','Incumplimiento previo') then
    raise exception 'Solo se admiten los motivos de rechazo de las normas';
  end if;
  update public.pedidos set reviso_id = yo.id, reviso_nombre = yo.nombre, motivo_rechazo = p_motivo where id = p_id;
  perform public._avanzar(p_id, 'pedido_rechazado', 'Pedido rechazado: ' || p_motivo, yo);
  -- Sin mercancía no hay envío. Todavía no se ha facturado: se factura después de recibirla
  for e in select * from public.pedidos where envio_de = p_id and etapa in ('pedido_enviado','recibido') for update loop
    update public.pedidos set motivo_rechazo = 'Pedido de mercancía ' || p.num || ' rechazado' where id = e.id;
    perform public._avanzar(e.id, 'pedido_rechazado', 'Envío anulado: pedido de mercancía ' || p.num || ' rechazado', yo);
  end loop;
end $$;

create or replace function public.emitir_albaran(p_id bigint) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id); v_num text; v_tarde boolean; l public.pedido_lineas; v_art uuid; c numeric;
begin
  if yo.empresa_id <> public._gestora(p) then raise exception 'Solo el proveedor emite el albarán' using errcode = '42501'; end if;
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

create or replace function public.emitir_factura(p_id bigint, p_lineas jsonb, p_dto numeric, p_rappel numeric, p_pronto_pago numeric, p_portes numeric, p_envases numeric, p_iva numeric, p_retencion numeric, p_vencimiento int) returns bigint language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id);
 v_ant public.facturas; v_id bigint; v_num text; v_version int := 1;
 v_suma numeric; v_dto numeric; v_rap numeric; v_pp numeric; v_neto numeric; v_base numeric; v_cuota numeric; v_ret numeric;
begin
  if yo.empresa_id <> public._gestora(p) then raise exception 'Solo el proveedor emite la factura' using errcode = '42501'; end if;
  if p.etapa not in ('recibido','factura_rechazada') then raise exception 'Este pedido no está pendiente de factura'; end if;
  if p.envio_de is not null and (select etapa from public.pedidos where id = p.envio_de) in ('pedido_enviado','pedido_aceptado','albaran_emitido') then raise exception 'El envío se factura cuando el cliente ha recibido la mercancía'; end if;
  if p_iva is null or p_iva not in (21,10,4,0) then raise exception 'El IVA tiene que ser 21, 10, 4 o 0 %%'; end if;
  if coalesce(p_retencion,0) not in (0,15) then raise exception 'La retención tiene que ser 0 o 15 %%'; end if;
  if coalesce(p_retencion,0) <> 0 and p.vendedor_id <> 4 then raise exception 'La retención del IRPF solo se aplica en las facturas del G4'; end if;
  if p_vencimiento is null or not (p_vencimiento = 0 or p_vencimiento between 5 and 30) then raise exception 'El vencimiento es inmediato o de 5 a 30 días'; end if;
  if least(coalesce(p_dto,0), coalesce(p_rappel,0), coalesce(p_pronto_pago,0), coalesce(p_portes,0), coalesce(p_envases,0)) < 0 or greatest(coalesce(p_dto,0), coalesce(p_rappel,0), coalesce(p_pronto_pago,0)) > 100 then
    raise exception 'Revisa los descuentos, los portes y los envases';
  end if;
  if coalesce(jsonb_array_length(p_lineas), 0) = 0 then raise exception 'La factura necesita al menos una línea'; end if;
  if exists (select 1 from jsonb_to_recordset(p_lineas) as x(linea_id bigint, unidades numeric, precio numeric)
    left join public.pedido_lineas l on l.id = x.linea_id and l.pedido_id = p_id
    where l.id is null or coalesce(x.unidades, -1) < 0 or coalesce(x.precio, -1) < 0) then
    raise exception 'Cada línea tiene que ser del pedido, con unidades y precio válidos';
  end if;
  select round(sum(x.unidades * x.precio), 2) into v_suma from jsonb_to_recordset(p_lineas) as x(linea_id bigint, unidades numeric, precio numeric);
  v_dto := round(v_suma * coalesce(p_dto,0) / 100, 2);
  v_rap := round((v_suma - v_dto) * coalesce(p_rappel,0) / 100, 2);
  v_pp := round((v_suma - v_dto - v_rap) * coalesce(p_pronto_pago,0) / 100, 2);
  v_neto := v_suma - v_dto - v_rap - v_pp;
  v_base := round(v_neto + coalesce(p_portes,0) + coalesce(p_envases,0), 2);
  v_cuota := round(v_base * p_iva / 100, 2);
  v_ret := round(v_base * coalesce(p_retencion,0) / 100, 2);
  select * into v_ant from public.facturas where pedido_id = p_id order by version desc limit 1;
  if found then v_num := v_ant.num; v_version := v_ant.version + 1; else v_num := public._numero('F', p.vendedor_id); end if;
  insert into public.facturas (pedido_id, num, version, fecha, dto, rappel, pronto_pago, portes, envases, iva, retencion, vencimiento_dias, vencimiento_fecha, suma, dto_imp, rappel_imp, pronto_pago_imp, neto, base, cuota, retencion_imp, total, elaboro_id, elaboro_nombre)
    values (p_id, v_num, v_version, public.hoy(), coalesce(p_dto,0), coalesce(p_rappel,0), coalesce(p_pronto_pago,0), coalesce(p_portes,0), coalesce(p_envases,0), p_iva, coalesce(p_retencion,0), p_vencimiento, public.sumar_dias_lectivos(public.hoy(), p_vencimiento), v_suma, v_dto, v_rap, v_pp, v_neto, v_base, v_cuota, v_ret, v_base + v_cuota - v_ret, yo.id, yo.nombre)
    returning id into v_id;
  insert into public.factura_lineas (factura_id, pedido_linea_id, descripcion, unidades, precio)
    select v_id, l.id, l.descripcion, x.unidades, x.precio from jsonb_to_recordset(p_lineas) as x(linea_id bigint, unidades numeric, precio numeric) join public.pedido_lineas l on l.id = x.linea_id;
  perform public._avanzar(p_id, 'factura_emitida', case when v_version > 1 then 'Versión corregida v' || v_version || ' de ' else 'Factura ' end || v_num || ' emitida', yo);
  return v_id;
end $$;

-- Al aceptar la factura del transporte, su base aumenta el coste de lo comprado
create or replace function public.aceptar_factura(p_id bigint, p_comprobaciones text[]) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id); v_lista text[] := array['numeracion','partes','descripcion','unidades','descuentos','base','iva','total','pago']; f public.facturas; k numeric; fl public.factura_lineas; pl public.pedido_lineas; v_ln numeric; v_real numeric; g public.pedidos; v_tot numeric;
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
  if p.envio_de is not null and public._con_almacen(p.comprador_id) then
    select * into strict g from public.pedidos where id = p.envio_de;
    select sum(unidades * precio) into v_tot from public.pedido_lineas where pedido_id = g.id and articulo_comprador_id is not null;
    if coalesce(v_tot, 0) > 0 then
      for pl in select * from public.pedido_lineas where pedido_id = g.id and articulo_comprador_id is not null order by id loop
        perform public._regularizar(pl.articulo_comprador_id, f.base * pl.unidades * pl.precio / v_tot, 'Gastos de envío del pedido ' || g.num, f.num);
      end loop;
    end if;
  end if;
  perform public._avanzar(p_id, 'factura_aceptada', 'Factura ' || f.num || ' revisada y aceptada', yo);
end $$;

-- Descuentos fuera de factura: rappel, comercial y pronto pago
alter table public.rectificativas drop constraint rectificativas_tipo_check;
alter table public.rectificativas add constraint rectificativas_tipo_check check (tipo in ('devolucion','rappel','pronto_pago','comercial'));
create or replace function public.emitir_rectificativa(p_id bigint, p_tipo text, p_lineas jsonb, p_base numeric) returns bigint language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id); f public.facturas; v_base numeric; v_cuota numeric; v_id bigint; v_num text;
begin
  if yo.empresa_id <> public._gestora(p) then raise exception 'Solo el emisor de la factura emite la rectificativa' using errcode = '42501'; end if;
  if p.etapa <> 'factura_aceptada' then raise exception 'Las rectificativas solo se emiten con la factura aceptada y antes del pago'; end if;
  if exists (select 1 from public.rectificativas where pedido_id = p_id and estado = 'emitida') then raise exception 'Ya hay una rectificativa pendiente de revisar'; end if;
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

-- 9. Presupuestos y negociación
create table public.presupuestos (
  id bigint generated always as identity primary key,
  num text not null,
  comprador_id smallint not null references public.empresas(id),
  vendedor_id smallint not null references public.empresas(id) check (vendedor_id between 1 and 6 and vendedor_id <> 5),
  servicio boolean not null,
  fecha date not null,
  entrega_dias smallint check (entrega_dias between 1 and 5),
  estado text not null check (estado in ('solicitado','ofertado','contraoferta','aceptado','rechazado')),
  estado_desde date not null,
  dto numeric(5,2) not null default 0,
  rappel numeric(5,2) not null default 0,
  pronto_pago numeric(5,2) not null default 0,
  motivo_rechazo text,
  pedido_id bigint references public.pedidos(id),
  incumplimiento_desde date,
  elaboro_id uuid not null references public.perfiles(id),
  elaboro_nombre text not null,
  check (comprador_id <> vendedor_id)
);
create index presupuestos_comprador on public.presupuestos (comprador_id);
create index presupuestos_vendedor on public.presupuestos (vendedor_id);
create table public.presupuesto_lineas (
  id bigint generated always as identity primary key,
  presupuesto_id bigint not null references public.presupuestos(id),
  catalogo_id uuid not null references public.catalogo(id),
  descripcion text not null,
  unidades numeric(14,3) not null check (unidades > 0),
  precio_tarifa numeric(12,2) not null,
  precio numeric(12,2) not null check (precio >= 0)
);
create index presupuesto_lineas_pres on public.presupuesto_lineas (presupuesto_id);
-- Cada paso de la negociación se conserva, con los precios y descuentos de ese momento
create table public.presupuesto_pasos (
  id bigint generated always as identity primary key,
  presupuesto_id bigint not null references public.presupuestos(id),
  empresa_id smallint not null references public.empresas(id),
  tipo text not null check (tipo in ('solicitud','oferta','contraoferta','aceptacion','rechazo')),
  precios jsonb,
  dto numeric(5,2) not null default 0,
  rappel numeric(5,2) not null default 0,
  pronto_pago numeric(5,2) not null default 0,
  importe numeric(14,2),
  nota text,
  quien_id uuid not null references public.perfiles(id),
  quien_nombre text not null,
  fecha date not null
);
create index presupuesto_pasos_pres on public.presupuesto_pasos (presupuesto_id, id);
alter table public.pedidos add column presupuesto_id bigint references public.presupuestos(id);
alter table public.incumplimientos alter column pedido_id drop not null, add column presupuesto_id bigint references public.presupuestos(id);

create function public.es_parte_presupuesto(p_id bigint) returns boolean language sql stable security definer set search_path = '' as $$
  select public.es_profesora() or exists (select 1 from public.presupuestos p where p.id = p_id and public.mi_empresa() in (p.comprador_id, p.vendedor_id))
$$;
-- Plazo de 2 días lectivos cuando le toca responder al proveedor
create function public.plazo_presupuesto(p public.presupuestos) returns date language sql stable security definer set search_path = '' as $$
  select case when p.estado in ('solicitado','contraoferta') then public.sumar_dias_lectivos(p.estado_desde, 2) end
$$;
create function public._presupuesto(p_id bigint) returns public.presupuestos language plpgsql security definer set search_path = '' as $$
declare v public.presupuestos;
begin
  select * into v from public.presupuestos where id = p_id for update;
  if not found then raise exception 'El presupuesto no existe'; end if;
  return v;
end $$;
create function public._importe_presupuesto(p_id bigint) returns numeric language sql stable security definer set search_path = '' as $$
  select round(sum(l.unidades * l.precio) * (1 - p.dto / 100) * (1 - p.rappel / 100) * (1 - p.pronto_pago / 100), 2)
  from public.presupuesto_lineas l join public.presupuestos p on p.id = l.presupuesto_id where p.id = p_id group by p.dto, p.rappel, p.pronto_pago
$$;
create function public._paso_presupuesto(p_id bigint, yo public.perfiles, p_tipo text, p_nota text) returns void language sql security definer set search_path = '' as $$
  insert into public.presupuesto_pasos (presupuesto_id, empresa_id, tipo, precios, dto, rappel, pronto_pago, importe, nota, quien_id, quien_nombre, fecha)
  select p.id, yo.empresa_id, p_tipo, (select jsonb_agg(jsonb_build_object('descripcion', l.descripcion, 'unidades', l.unidades, 'precio', l.precio) order by l.id) from public.presupuesto_lineas l where l.presupuesto_id = p.id),
    p.dto, p.rappel, p.pronto_pago, public._importe_presupuesto(p.id), nullif(trim(coalesce(p_nota, '')), ''), yo.id, yo.nombre, public.hoy()
  from public.presupuestos p where p.id = p_id
$$;
create function public._negociar(p public.presupuestos, yo public.perfiles, p_estado text, p_tipo text, p_lineas jsonb, p_dto numeric, p_rappel numeric, p_pp numeric, p_nota text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if least(coalesce(p_dto,0), coalesce(p_rappel,0), coalesce(p_pp,0)) < 0 or greatest(coalesce(p_dto,0), coalesce(p_rappel,0), coalesce(p_pp,0)) > 100 then raise exception 'Los descuentos van de 0 a 100 %%'; end if;
  if (select count(*) from jsonb_to_recordset(p_lineas) as x(linea_id bigint, precio numeric) join public.presupuesto_lineas l on l.id = x.linea_id and l.presupuesto_id = p.id where coalesce(x.precio, -1) >= 0) <> (select count(*) from public.presupuesto_lineas where presupuesto_id = p.id) then
    raise exception 'Indica un precio válido para cada línea';
  end if;
  update public.presupuesto_lineas l set precio = round(x.precio, 2) from jsonb_to_recordset(p_lineas) as x(linea_id bigint, precio numeric) where l.id = x.linea_id and l.presupuesto_id = p.id;
  update public.presupuestos set estado = p_estado, estado_desde = public.hoy(), dto = coalesce(p_dto,0), rappel = coalesce(p_rappel,0), pronto_pago = coalesce(p_pp,0) where id = p.id;
  perform public._paso_presupuesto(p.id, yo, p_tipo, p_nota);
end $$;

create function public.solicitar_presupuesto(p_vendedor smallint, p_lineas jsonb, p_entrega_dias int, p_nota text default null) returns bigint language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); v_id bigint; v_servicio boolean := p_vendedor = 4;
begin
  if p_vendedor = yo.empresa_id then raise exception 'Una empresa no puede pedirse un presupuesto a sí misma'; end if;
  if p_vendedor = 5 or p_vendedor not between 1 and 6 then raise exception 'Ese proveedor no hace presupuestos'; end if;
  if not v_servicio and (p_entrega_dias is null or p_entrega_dias not between 1 and 5) then raise exception 'El plazo de entrega va de 1 a 5 días lectivos'; end if;
  if coalesce(jsonb_array_length(p_lineas), 0) = 0 then raise exception 'Añade al menos una línea'; end if;
  if exists (select 1 from jsonb_to_recordset(p_lineas) as x(catalogo_id uuid, unidades numeric)
    left join public.catalogo c on c.id = x.catalogo_id and c.empresa_id = p_vendedor and c.activo
    where c.id is null or coalesce(x.unidades, 0) <= 0) then
    raise exception 'Cada línea necesita un artículo del catálogo del proveedor y unidades mayores que 0';
  end if;
  insert into public.presupuestos (num, comprador_id, vendedor_id, servicio, fecha, entrega_dias, estado, estado_desde, elaboro_id, elaboro_nombre)
    values (public._numero('PR', yo.empresa_id), yo.empresa_id, p_vendedor, v_servicio, public.hoy(), case when v_servicio then null else p_entrega_dias end, 'solicitado', public.hoy(), yo.id, yo.nombre) returning id into v_id;
  insert into public.presupuesto_lineas (presupuesto_id, catalogo_id, descripcion, unidades, precio_tarifa, precio)
    select v_id, c.id, c.nombre, x.unidades, c.precio, c.precio from jsonb_to_recordset(p_lineas) as x(catalogo_id uuid, unidades numeric) join public.catalogo c on c.id = x.catalogo_id;
  perform public._paso_presupuesto(v_id, yo, 'solicitud', p_nota);
  return v_id;
end $$;

create function public.ofertar_presupuesto(p_id bigint, p_lineas jsonb, p_dto numeric, p_rappel numeric, p_pronto_pago numeric, p_nota text default null) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.presupuestos := public._presupuesto(p_id);
begin
  if yo.empresa_id <> p.vendedor_id then raise exception 'Solo el proveedor hace la oferta' using errcode = '42501'; end if;
  if p.estado not in ('solicitado','contraoferta') then raise exception 'Este presupuesto no está esperando una oferta'; end if;
  perform public._negociar(p, yo, 'ofertado', 'oferta', p_lineas, p_dto, p_rappel, p_pronto_pago, p_nota);
end $$;

create function public.contraofertar_presupuesto(p_id bigint, p_lineas jsonb, p_dto numeric, p_rappel numeric, p_pronto_pago numeric, p_nota text default null) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.presupuestos := public._presupuesto(p_id);
begin
  if yo.empresa_id <> p.comprador_id then raise exception 'Solo el cliente hace la contraoferta' using errcode = '42501'; end if;
  if p.estado <> 'ofertado' then raise exception 'Este presupuesto no tiene una oferta pendiente'; end if;
  perform public._negociar(p, yo, 'contraoferta', 'contraoferta', p_lineas, p_dto, p_rappel, p_pronto_pago, p_nota);
end $$;

-- Aceptar la oferta crea el pedido con lo negociado. El proveedor lo confirma como cualquier pedido
create function public.aceptar_presupuesto(p_id bigint, p_confirmado boolean default false, p_envio jsonb default null) returns bigint language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.presupuestos := public._presupuesto(p_id); v_id bigint; g public.pedidos; v_num text;
begin
  if yo.empresa_id <> p.comprador_id then raise exception 'Solo el cliente acepta la oferta' using errcode = '42501'; end if;
  if p.estado <> 'ofertado' then raise exception 'Este presupuesto no tiene una oferta pendiente'; end if;
  perform public._comprobar_compra(yo.empresa_id, public._importe_presupuesto(p_id), p_confirmado);
  v_id := public._insertar_pedido(yo, p.vendedor_id, (select jsonb_agg(jsonb_build_object('catalogo_id', catalogo_id, 'unidades', unidades, 'precio', precio) order by id) from public.presupuesto_lineas where presupuesto_id = p_id), p.entrega_dias, p.dto, p.rappel, p.pronto_pago, p_confirmado, null);
  update public.pedidos set presupuesto_id = p_id where id = v_id returning * into g;
  select num into v_num from public.pedidos where id = v_id;
  update public.presupuestos set estado = 'aceptado', estado_desde = public.hoy(), pedido_id = v_id where id = p_id;
  perform public._paso_presupuesto(p_id, yo, 'aceptacion', 'Pedido ' || v_num);
  if p_envio is not null then perform public._contratar_envio(yo, g, (p_envio ->> 'catalogo_id')::uuid, coalesce((p_envio ->> 'unidades')::numeric, 1)); end if;
  return v_id;
end $$;

create function public.rechazar_presupuesto(p_id bigint, p_motivo text) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.presupuestos := public._presupuesto(p_id);
begin
  if not ((yo.empresa_id = p.vendedor_id and p.estado in ('solicitado','contraoferta')) or (yo.empresa_id = p.comprador_id and p.estado = 'ofertado')) then raise exception 'Ahora no te toca responder a este presupuesto' using errcode = '42501'; end if;
  if p_motivo is null or p_motivo not in ('Falta de existencias','Falta de liquidez','Precio no aceptado','Riesgo excesivo','Documento incorrecto','Incumplimiento previo') then
    raise exception 'Solo se admiten los motivos de rechazo de las normas';
  end if;
  update public.presupuestos set estado = 'rechazado', estado_desde = public.hoy(), motivo_rechazo = p_motivo where id = p_id;
  perform public._paso_presupuesto(p_id, yo, 'rechazo', p_motivo);
end $$;

create function public.registrar_incumplimiento_presupuesto(p_id bigint) returns void language plpgsql security definer set search_path = '' as $$
declare p public.presupuestos := public._presupuesto(p_id); v_lim date := public.plazo_presupuesto(p);
begin
  if not public.es_profesora() then raise exception 'Solo la profesora registra incumplimientos' using errcode = '42501'; end if;
  if v_lim is null or public.hoy() <= v_lim then raise exception 'Este plazo no ha vencido'; end if;
  if p.incumplimiento_desde = p.estado_desde then raise exception 'Este incumplimiento ya está registrado'; end if;
  update public.presupuestos set incumplimiento_desde = p.estado_desde where id = p_id;
  insert into public.incumplimientos (presupuesto_id, responsable_id, afectada_id, texto, fecha, registrado_por) values (p_id, p.vendedor_id, p.comprador_id, 'No respondió al presupuesto ' || p.num, public.hoy(), auth.uid());
end $$;

-- La profesora revisa: deja observaciones, pero no firma ni mueve la operación
create function public.anotar_operacion(p_id bigint, p_texto text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.es_profesora() then raise exception 'Solo la profesora deja observaciones' using errcode = '42501'; end if;
  if length(trim(coalesce(p_texto, ''))) = 0 then raise exception 'Escribe la observación'; end if;
  if not exists (select 1 from public.pedidos where id = p_id) then raise exception 'El pedido no existe'; end if;
  insert into public.historial (pedido_id, texto, quien_id, quien_nombre, fecha) values (p_id, 'Observación de la profesora: ' || trim(p_texto), auth.uid(), 'Profesora', public.hoy());
end $$;

-- 10. Circulares y entregas: llegan a todos los grupos
create table public.circulares (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('circular','modelo')),
  titulo text not null check (length(trim(titulo)) > 0),
  cuerpo text not null check (length(trim(cuerpo)) > 0),
  fecha date not null,
  fecha_limite date,
  creada_por uuid not null references public.perfiles(id),
  creada_en timestamptz not null default now()
);
create table public.circular_lecturas (
  circular_id bigint not null references public.circulares(id),
  empresa_id smallint not null references public.empresas(id),
  leida_por_nombre text not null,
  leida_en timestamptz not null default now(),
  primary key (circular_id, empresa_id)
);
create table public.entregas (
  id bigint generated always as identity primary key,
  circular_id bigint not null references public.circulares(id),
  empresa_id smallint not null references public.empresas(id),
  contenido text not null check (length(trim(contenido)) > 0),
  entrego_id uuid not null references public.perfiles(id),
  entrego_nombre text not null,
  entregada_en timestamptz not null default now(),
  fecha date not null,
  fuera_de_plazo boolean not null default false,
  revision text,
  revisada_en timestamptz,
  unique (circular_id, empresa_id)
);

create function public.crear_circular(p_tipo text, p_titulo text, p_cuerpo text, p_limite date) returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if not public.es_profesora() then raise exception 'Solo la profesora publica circulares' using errcode = '42501'; end if;
  if p_tipo not in ('circular','modelo') then raise exception 'Tipo desconocido'; end if;
  if length(trim(coalesce(p_titulo, ''))) = 0 or length(trim(coalesce(p_cuerpo, ''))) = 0 then raise exception 'Escribe el título y el contenido'; end if;
  if p_tipo = 'modelo' and p_limite is null then raise exception 'Una entrega de modelo necesita fecha límite'; end if;
  if p_limite is not null and p_limite < public.hoy() then raise exception 'La fecha límite no puede ser anterior a hoy'; end if;
  insert into public.circulares (tipo, titulo, cuerpo, fecha, fecha_limite, creada_por) values (p_tipo, trim(p_titulo), trim(p_cuerpo), public.hoy(), p_limite, auth.uid()) returning id into v_id;
  return v_id;
end $$;

create function public.cambiar_limite_circular(p_id bigint, p_limite date) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.es_profesora() then raise exception 'Solo la profesora cambia los plazos' using errcode = '42501'; end if;
  update public.circulares set fecha_limite = p_limite where id = p_id and (tipo = 'circular' or p_limite is not null);
  if not found then raise exception 'Una entrega de modelo necesita fecha límite'; end if;
end $$;

create function public.marcar_circular_leida(p_id bigint) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor();
begin
  insert into public.circular_lecturas (circular_id, empresa_id, leida_por_nombre) values (p_id, yo.empresa_id, yo.nombre) on conflict do nothing;
end $$;

create function public.entregar(p_circular bigint, p_contenido text) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); c public.circulares; v_tarde boolean;
begin
  select * into c from public.circulares where id = p_circular;
  if not found then raise exception 'La circular no existe'; end if;
  if c.fecha_limite is null then raise exception 'Esta circular no tiene entrega'; end if;
  if length(trim(coalesce(p_contenido, ''))) = 0 then raise exception 'Escribe el contenido de la entrega'; end if;
  v_tarde := public.hoy() > c.fecha_limite;
  insert into public.entregas (circular_id, empresa_id, contenido, entrego_id, entrego_nombre, fecha, fuera_de_plazo)
    values (p_circular, yo.empresa_id, trim(p_contenido), yo.id, yo.nombre, public.hoy(), v_tarde)
    on conflict (circular_id, empresa_id) do update set contenido = excluded.contenido, entrego_id = excluded.entrego_id, entrego_nombre = excluded.entrego_nombre, entregada_en = now(), fecha = excluded.fecha, fuera_de_plazo = excluded.fuera_de_plazo, revision = null, revisada_en = null;
end $$;

create function public.revisar_entrega(p_id bigint, p_revision text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.es_profesora() then raise exception 'Solo la profesora revisa las entregas' using errcode = '42501'; end if;
  if length(trim(coalesce(p_revision, ''))) = 0 then raise exception 'Escribe la revisión'; end if;
  update public.entregas set revision = trim(p_revision), revisada_en = now() where id = p_id;
  if not found then raise exception 'La entrega no existe'; end if;
end $$;

-- 11. Financiación: el banco estudia y la profesora autoriza. Hasta entonces no se mueve dinero
create table public.solicitudes_financiacion (
  id bigint generated always as identity primary key,
  empresa_id smallint not null references public.empresas(id) check (empresa_id between 1 and 6 and empresa_id <> 5),
  importe numeric(14,2) not null check (importe > 0),
  plazo_meses int not null check (plazo_meses > 0),
  motivo text not null,
  fecha date not null,
  estado_desde date not null,
  solicito_nombre text not null,
  solicito_id uuid not null references public.perfiles(id),
  estado text not null default 'solicitada' check (estado in ('solicitada','estudiada','autorizada','rechazada')),
  tipo_interes numeric(5,2),
  causa_distinta text,
  banco_nombre text,
  motivo_rechazo text,
  rechazada_por text,
  justificante text
);
create function public.plazo_financiacion(s public.solicitudes_financiacion) returns date language sql stable security definer set search_path = '' as $$
  select case when s.estado = 'solicitada' then public.sumar_dias_lectivos(s.estado_desde, 3) end
$$;
create function public.solicitar_financiacion(p_importe numeric, p_plazo int, p_motivo text) returns bigint language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); v_id bigint; v_max int;
begin
  if not coalesce((select activo from public.modulos where clave = 'financiacion'), false) then raise exception 'La financiación todavía no está activada por la profesora'; end if;
  if yo.empresa_id = 5 then raise exception 'El banco no se financia a sí mismo'; end if;
  if coalesce(p_importe, 0) <= 0 or coalesce(p_plazo, 0) <= 0 then raise exception 'Indica el importe y el plazo'; end if;
  if length(trim(coalesce(p_motivo, ''))) = 0 then raise exception 'Indica el motivo'; end if;
  select plazo_max_meses into v_max from public.condiciones_banco order by vigente_desde desc, id desc limit 1;
  if v_max is not null and p_plazo > v_max then raise exception 'El plazo máximo publicado por el banco es de % meses', v_max; end if;
  insert into public.solicitudes_financiacion (empresa_id, importe, plazo_meses, motivo, fecha, estado_desde, solicito_id, solicito_nombre) values (yo.empresa_id, round(p_importe, 2), p_plazo, trim(p_motivo), public.hoy(), public.hoy(), yo.id, yo.nombre) returning id into v_id;
  return v_id;
end $$;
create function public.estudiar_financiacion(p_id bigint, p_aprobar boolean, p_tipo numeric, p_causa text, p_motivo text) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); s public.solicitudes_financiacion; v_tipo numeric;
begin
  if yo.empresa_id <> 5 then raise exception 'Solo el banco estudia la financiación' using errcode = '42501'; end if;
  select * into s from public.solicitudes_financiacion where id = p_id and estado = 'solicitada' for update;
  if not found then raise exception 'Esa solicitud no está pendiente del banco'; end if;
  if not coalesce(p_aprobar, false) then
    if p_motivo is null or p_motivo not in ('Falta de existencias','Falta de liquidez','Precio no aceptado','Riesgo excesivo','Documento incorrecto','Incumplimiento previo') then raise exception 'Solo se admiten los motivos de rechazo de las normas'; end if;
    update public.solicitudes_financiacion set estado = 'rechazada', motivo_rechazo = p_motivo, rechazada_por = 'Banco', banco_nombre = yo.nombre, estado_desde = public.hoy() where id = p_id;
    return;
  end if;
  select tipo_interes into v_tipo from public.condiciones_banco order by vigente_desde desc, id desc limit 1;
  if p_tipo is null or p_tipo < 0 then raise exception 'Indica el tipo de interés'; end if;
  if p_tipo is distinct from v_tipo and length(trim(coalesce(p_causa, ''))) = 0 then raise exception 'Un tipo distinto del publicado necesita una causa objetiva y documentada'; end if;
  update public.solicitudes_financiacion set estado = 'estudiada', tipo_interes = p_tipo, causa_distinta = nullif(trim(coalesce(p_causa, '')), ''), banco_nombre = yo.nombre, estado_desde = public.hoy() where id = p_id;
end $$;
create function public.autorizar_financiacion(p_id bigint, p_autorizar boolean, p_motivo text) returns void language plpgsql security definer set search_path = '' as $$
declare s public.solicitudes_financiacion; v_just text;
begin
  if not public.es_profesora() then raise exception 'Solo la profesora autoriza los préstamos' using errcode = '42501'; end if;
  select * into s from public.solicitudes_financiacion where id = p_id and estado = 'estudiada' for update;
  if not found then raise exception 'Esa solicitud no está pendiente de autorización'; end if;
  if not coalesce(p_autorizar, false) then
    if length(trim(coalesce(p_motivo, ''))) = 0 then raise exception 'Indica el motivo'; end if;
    update public.solicitudes_financiacion set estado = 'rechazada', motivo_rechazo = trim(p_motivo), rechazada_por = 'Profesora', estado_desde = public.hoy() where id = p_id;
    return;
  end if;
  perform 1 from public.empresas where id in (s.empresa_id, 5) order by id for update;
  if public._saldo(5::smallint) < s.importe then raise exception 'El banco no tiene saldo suficiente para conceder este préstamo'; end if;
  v_just := public._numero('JB', 5::smallint);
  perform public._movimiento(5::smallint, 'Préstamo concedido a ' || public._corto(s.empresa_id), -s.importe, v_just);
  perform public._movimiento(s.empresa_id, 'Préstamo del banco a ' || s.plazo_meses || ' meses', s.importe, v_just);
  update public.solicitudes_financiacion set estado = 'autorizada', justificante = v_just, estado_desde = public.hoy() where id = p_id;
end $$;

-- 12. Insolvencia: plan de viabilidad y rescate condicionado del Estado
create table public.planes_viabilidad (
  id bigint generated always as identity primary key,
  empresa_id smallint not null references public.empresas(id) check (empresa_id between 1 and 6),
  reduccion_gastos text not null,
  revision_precios text not null,
  financiacion text not null,
  importe_solicitado numeric(14,2) not null check (importe_solicitado >= 0),
  fecha date not null,
  presento_id uuid not null references public.perfiles(id),
  presento_nombre text not null,
  estado text not null default 'presentado' check (estado in ('presentado','aprobado','rechazado')),
  importe_aprobado numeric(14,2),
  condiciones text,
  justificante text,
  resuelto_en timestamptz
);
create unique index planes_uno_abierto on public.planes_viabilidad (empresa_id) where estado = 'presentado';
create function public.presentar_plan(p_reduccion text, p_precios text, p_financiacion text, p_importe numeric) returns bigint language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); v_id bigint;
begin
  if length(trim(coalesce(p_reduccion, ''))) = 0 or length(trim(coalesce(p_precios, ''))) = 0 or length(trim(coalesce(p_financiacion, ''))) = 0 then raise exception 'El plan necesita reducción de gastos, revisión de precios y financiación'; end if;
  if coalesce(p_importe, -1) < 0 then raise exception 'Revisa el importe solicitado'; end if;
  if exists (select 1 from public.planes_viabilidad where empresa_id = yo.empresa_id and estado = 'presentado') then raise exception 'Tu empresa ya tiene un plan pendiente'; end if;
  insert into public.planes_viabilidad (empresa_id, reduccion_gastos, revision_precios, financiacion, importe_solicitado, fecha, presento_id, presento_nombre) values (yo.empresa_id, trim(p_reduccion), trim(p_precios), trim(p_financiacion), round(p_importe, 2), public.hoy(), yo.id, yo.nombre) returning id into v_id;
  return v_id;
end $$;
create function public.resolver_plan(p_id bigint, p_aprobar boolean, p_importe numeric, p_condiciones text) returns void language plpgsql security definer set search_path = '' as $$
declare s public.planes_viabilidad; v_just text; v_imp numeric := coalesce(round(p_importe, 2), 0);
begin
  if not public.es_profesora() then raise exception 'Solo la profesora resuelve los planes de rescate' using errcode = '42501'; end if;
  if length(trim(coalesce(p_condiciones, ''))) = 0 then raise exception 'Indica las condiciones o el motivo'; end if;
  select * into s from public.planes_viabilidad where id = p_id and estado = 'presentado' for update;
  if not found then raise exception 'Ese plan no está pendiente'; end if;
  if not coalesce(p_aprobar, false) then
    update public.planes_viabilidad set estado = 'rechazado', condiciones = trim(p_condiciones), resuelto_en = now() where id = p_id;
    return;
  end if;
  if v_imp < 0 then raise exception 'El importe no puede ser negativo'; end if;
  if v_imp > 0 then
    perform 1 from public.empresas where id in (s.empresa_id, 8) order by id for update;
    v_just := public._numero('JB', 5::smallint);
    perform public._movimiento(8::smallint, 'Rescate del Estado a ' || public._corto(s.empresa_id), -v_imp, v_just);
    perform public._movimiento(s.empresa_id, 'Rescate del Estado (plan de viabilidad)', v_imp, v_just);
  end if;
  update public.planes_viabilidad set estado = 'aprobado', importe_aprobado = v_imp, condiciones = trim(p_condiciones), justificante = v_just, resuelto_en = now() where id = p_id;
end $$;

-- 13. RLS: lectura por política, escritura solo mediante funciones
alter table public.autorizaciones_descubierto enable row level security;
alter table public.solicitudes_precio enable row level security;
alter table public.presupuestos enable row level security;
alter table public.presupuesto_lineas enable row level security;
alter table public.presupuesto_pasos enable row level security;
alter table public.circulares enable row level security;
alter table public.circular_lecturas enable row level security;
alter table public.entregas enable row level security;
alter table public.solicitudes_financiacion enable row level security;
alter table public.planes_viabilidad enable row level security;
revoke all on public.autorizaciones_descubierto, public.solicitudes_precio, public.presupuestos, public.presupuesto_lineas, public.presupuesto_pasos, public.circulares, public.circular_lecturas, public.entregas, public.solicitudes_financiacion, public.planes_viabilidad from public, anon, authenticated, service_role;
grant select on public.autorizaciones_descubierto, public.solicitudes_precio, public.presupuestos, public.presupuesto_lineas, public.presupuesto_pasos, public.circulares, public.circular_lecturas, public.entregas, public.solicitudes_financiacion, public.planes_viabilidad to authenticated;
create policy descubierto_visible on public.autorizaciones_descubierto for select to authenticated using (public.es_profesora() or public.mi_empresa() in (empresa_id, 5));
create policy solicitudes_precio_visibles on public.solicitudes_precio for select to authenticated using (public.es_profesora() or public.mi_empresa() = empresa_id);
create policy presupuestos_partes on public.presupuestos for select to authenticated using (public.es_profesora() or public.mi_empresa() in (comprador_id, vendedor_id));
create policy presupuesto_lineas_partes on public.presupuesto_lineas for select to authenticated using (public.es_parte_presupuesto(presupuesto_id));
create policy presupuesto_pasos_partes on public.presupuesto_pasos for select to authenticated using (public.es_parte_presupuesto(presupuesto_id));
create policy circulares_todos on public.circulares for select to authenticated using (public.mi_empresa() is not null or public.es_profesora());
create policy lecturas_visibles on public.circular_lecturas for select to authenticated using (public.es_profesora() or public.mi_empresa() = empresa_id);
create policy entregas_visibles on public.entregas for select to authenticated using (public.es_profesora() or public.mi_empresa() = empresa_id);
create policy financiacion_visible on public.solicitudes_financiacion for select to authenticated using (public.es_profesora() or public.mi_empresa() in (empresa_id, 5));
create policy planes_visibles on public.planes_viabilidad for select to authenticated using (public.es_profesora() or public.mi_empresa() = empresa_id);

do $$
declare f record;
begin
  for f in select oid::regprocedure as s from pg_proc where pronamespace = 'public'::regnamespace and proname = any (array['_firmante_cabecera','_firma_id','_gestora','_descubierto','autorizar_descubierto','_ejecutar_orden','ordenar_pago','pagar_estado','revisar_pago','publicar_condiciones','guardar_catalogo','resolver_precio','_comprobar_compra','_insertar_pedido','_contratar_envio','contratar_envio','crear_pedido','es_parte_presupuesto','plazo_presupuesto','_presupuesto','_importe_presupuesto','_paso_presupuesto','_negociar','solicitar_presupuesto','ofertar_presupuesto','contraofertar_presupuesto','aceptar_presupuesto','rechazar_presupuesto','registrar_incumplimiento_presupuesto','anotar_operacion','crear_circular','cambiar_limite_circular','marcar_circular_leida','entregar','revisar_entrega','plazo_financiacion','solicitar_financiacion','estudiar_financiacion','autorizar_financiacion','presentar_plan','resolver_plan']) loop
    execute 'revoke execute on function ' || f.s || ' from public, anon, authenticated, service_role';
  end loop;
end $$;
grant execute on function public.autorizar_descubierto(smallint,numeric,text), public.ordenar_pago(bigint), public.pagar_estado(smallint,text,numeric), public.revisar_pago(bigint), public.publicar_condiciones(numeric,numeric,int,text), public.guardar_catalogo(smallint,uuid,text,numeric,numeric), public.resolver_precio(bigint,boolean,text), public.contratar_envio(bigint,uuid,numeric), public.crear_pedido(smallint,jsonb,int,boolean,jsonb), public.es_parte_presupuesto(bigint), public.plazo_presupuesto(public.presupuestos), public.solicitar_presupuesto(smallint,jsonb,int,text), public.ofertar_presupuesto(bigint,jsonb,numeric,numeric,numeric,text), public.contraofertar_presupuesto(bigint,jsonb,numeric,numeric,numeric,text), public.aceptar_presupuesto(bigint,boolean,jsonb), public.rechazar_presupuesto(bigint,text), public.registrar_incumplimiento_presupuesto(bigint), public.anotar_operacion(bigint,text), public.crear_circular(text,text,text,date), public.cambiar_limite_circular(bigint,date), public.marcar_circular_leida(bigint), public.entregar(bigint,text), public.revisar_entrega(bigint,text), public.plazo_financiacion(public.solicitudes_financiacion), public.solicitar_financiacion(numeric,int,text), public.estudiar_financiacion(bigint,boolean,numeric,text,text), public.autorizar_financiacion(bigint,boolean,text), public.presentar_plan(text,text,text,numeric), public.resolver_plan(bigint,boolean,numeric,text) to authenticated;
notify pgrst, 'reload schema';
