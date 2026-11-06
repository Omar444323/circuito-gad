-- Lo que quedaba de las normas: protocolo del punto 12, rechazo de albarán, IVA del catálogo,
-- cuadro de cuotas, fianzas, liquidación de IVA, nóminas y cuentas personales de los alumnos

insert into public.modulos (clave, nombre) values ('suministros', 'Electricidad y agua con fianza'), ('consumidores', 'Alumnos como consumidores') on conflict (clave) do nothing;

create function public._modulo(p_clave text, p_texto text) returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce((select activo from public.modulos where clave = p_clave), false) then raise exception '% todavía no está activado por la profesora', p_texto; end if;
end $$;

-- Quien firma en una cuenta compartida es la persona elegida. Sirve también en las políticas
create function public.mi_firma() returns uuid language sql stable security definer set search_path = '' as $$
  select public._firma_id()
$$;

-- 1. Protocolo del punto 12
-- Solo intervenir_pedido activa esta sustitución, dentro de su transacción y para la profesora
create or replace function public._actor() returns public.perfiles language plpgsql stable security definer set search_path = '' as $$
declare v public.perfiles; f public.perfiles; v_sust text;
begin
  select * into v from public.perfiles where id = auth.uid() and activo;
  if not found then raise exception 'Sesión no válida' using errcode = '42501'; end if;
  if v.rol <> 'alumno' then
    v_sust := current_setting('circuito.sustituye', true);
    if v.rol = 'profesora' and v_sust ~ '^[0-9]+$' then
      v.empresa_id := v_sust::smallint;
      v.nombre := 'Profesora (documento sustitutorio)';
      return v;
    end if;
    raise exception 'La profesora no actúa en nombre de los grupos' using errcode = '42501';
  end if;
  if not v.cuenta_grupo then return v; end if;
  select * into f from public.perfiles where id = public._firmante_cabecera() and empresa_id = v.empresa_id and activo and not cuenta_grupo;
  if not found then raise exception 'Selecciona quién eres antes de firmar' using errcode = '42501'; end if;
  return f;
end $$;

create or replace function public.comunicar_bloqueo(p_id bigint) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id); v_lim date := public.plazo_limite(p);
begin
  if yo.empresa_id <> p.comprador_id then raise exception 'Solo el equipo afectado comunica el bloqueo' using errcode = '42501'; end if;
  if v_lim is null or public.hoy() <= v_lim then raise exception 'Este plazo no ha vencido'; end if;
  if exists (select 1 from public.bloqueos where pedido_id = p_id and etapa = p.etapa and etapa_desde = p.etapa_desde and comunicado_fecha is not null) then raise exception 'El bloqueo ya está comunicado'; end if;
  if not exists (select 1 from public.correos where pedido_id = p_id and remitente_id = yo.empresa_id) then raise exception 'Primero reclámalo por escrito con un correo de esta operación'; end if;
  insert into public.bloqueos (pedido_id, etapa, etapa_desde, comunicado_por, comunicado_nombre, comunicado_fecha) values (p_id, p.etapa, p.etapa_desde, yo.id, yo.nombre, public.hoy())
    on conflict (pedido_id, etapa, etapa_desde) do update set comunicado_por = excluded.comunicado_por, comunicado_nombre = excluded.comunicado_nombre, comunicado_fecha = excluded.comunicado_fecha;
  insert into public.historial (pedido_id, texto, quien_id, quien_nombre, fecha) values (p_id, 'Bloqueo comunicado a la profesora', yo.id, yo.nombre, public.hoy());
end $$;

create or replace function public.comunicar_impago(p_id bigint) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); d public.deudas := public._deuda(p_id);
begin
  if yo.empresa_id <> d.acreedor_id then raise exception 'Solo el acreedor comunica el impago' using errcode = '42501'; end if;
  if d.estado <> 'vigente' or public.hoy() <= d.vencimiento then raise exception 'Esta deuda no ha vencido'; end if;
  if d.impago_comunicado is not null then raise exception 'El impago ya está comunicado'; end if;
  if not exists (select 1 from public.correos where pedido_id = d.pedido_id and remitente_id = yo.empresa_id) then raise exception 'Primero reclámalo por escrito con un correo de esta operación'; end if;
  update public.deudas set impago_comunicado = public.hoy() where id = p_id;
  insert into public.historial (pedido_id, texto, quien_id, quien_nombre, fecha) values (d.pedido_id, 'Impago de la deuda ' || d.num || ' comunicado a la profesora', yo.id, yo.nombre, public.hoy());
end $$;

-- La profesora hace el paso del equipo que no responde. El documento queda firmado como sustitutorio
-- y el incumplimiento registrado contra ese equipo
create function public.intervenir_pedido(p_id bigint, p_motivo text, p_iva numeric default 21, p_vencimiento int default 15) returns void language plpgsql security definer set search_path = '' as $$
declare p public.pedidos := public._pedido(p_id); v_resp smallint; v_otro smallint; v_paso text; v_lineas jsonb;
begin
  if not public.es_profesora() then raise exception 'Solo la profesora emite documentos sustitutorios' using errcode = '42501'; end if;
  if length(trim(coalesce(p_motivo, ''))) = 0 then raise exception 'Indica el motivo de la intervención'; end if;
  if p.etapa in ('pedido_enviado','pedido_aceptado','recibido','factura_rechazada') then v_resp := public._gestora(p); v_otro := p.comprador_id;
  elsif p.etapa in ('albaran_emitido','factura_emitida') then v_resp := p.comprador_id; v_otro := public._gestora(p);
  else raise exception 'En este punto de la operación no hay ningún documento que sustituir'; end if;
  perform set_config('circuito.sustituye', v_resp::text, true);
  case p.etapa
    when 'pedido_enviado' then perform public.aceptar_pedido(p_id); v_paso := 'aceptación del pedido';
    when 'pedido_aceptado' then perform public.emitir_albaran(p_id); v_paso := 'albarán';
    when 'albaran_emitido' then perform public.confirmar_recepcion(p_id, null); v_paso := 'recepción de la mercancía';
    when 'factura_emitida' then perform public.aceptar_factura(p_id, array['numeracion','partes','descripcion','unidades','descuentos','base','iva','total','pago']); v_paso := 'aceptación de la factura';
    else
      select jsonb_agg(jsonb_build_object('linea_id', id, 'unidades', unidades, 'precio', precio)) into v_lineas from public.pedido_lineas where pedido_id = p_id;
      perform public.emitir_factura(p_id, v_lineas, 0, 0, 0, 0, 0, p_iva, 0, p_vencimiento);
      v_paso := 'factura';
  end case;
  perform set_config('circuito.sustituye', '', true);
  insert into public.bloqueos (pedido_id, etapa, etapa_desde, registrado) values (p_id, p.etapa, p.etapa_desde, true)
    on conflict (pedido_id, etapa, etapa_desde) do update set registrado = true;
  insert into public.incumplimientos (pedido_id, responsable_id, afectada_id, texto, fecha, registrado_por) values (p_id, v_resp, v_otro, 'La profesora tuvo que emitir ' || v_paso || ' de ' || p.num || ': ' || trim(p_motivo), public.hoy(), auth.uid());
  insert into public.historial (pedido_id, texto, quien_nombre, fecha) values (p_id, 'Documento sustitutorio (' || v_paso || '): ' || trim(p_motivo), 'Profesora', public.hoy());
end $$;

-- 2. El comprador puede rechazar el albarán: vuelven las existencias y hay un día lectivo para reemitirlo
create table public.albaranes_rechazados (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references public.pedidos(id),
  num text not null,
  fecha date not null,
  elaboro_nombre text not null,
  motivo text not null,
  rechazo_fecha date not null,
  rechazo_nombre text not null
);
create function public.rechazar_albaran(p_id bigint, p_motivo text) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id); a public.albaranes; l public.pedido_lineas;
begin
  if yo.empresa_id <> p.comprador_id then raise exception 'Solo el comprador rechaza el albarán' using errcode = '42501'; end if;
  if p.etapa <> 'albaran_emitido' then raise exception 'No hay ningún albarán pendiente de confirmar'; end if;
  if p_motivo is null or p_motivo not in ('Falta de existencias','Falta de liquidez','Precio no aceptado','Riesgo excesivo','Documento incorrecto','Incumplimiento previo') then raise exception 'Solo se admiten los motivos de rechazo de las normas'; end if;
  select * into strict a from public.albaranes where pedido_id = p_id;
  insert into public.albaranes_rechazados (pedido_id, num, fecha, elaboro_nombre, motivo, rechazo_fecha, rechazo_nombre) values (p_id, a.num, a.fecha, a.elaboro_nombre, p_motivo, public.hoy(), yo.nombre);
  delete from public.albaranes where pedido_id = p_id;
  for l in select * from public.pedido_lineas where pedido_id = p_id and articulo_vendedor_id is not null order by id loop
    perform public._entrada(l.articulo_vendedor_id, l.unidades, coalesce(l.coste_salida, 0), 'Albarán rechazado por ' || public._corto(p.comprador_id), a.num);
    update public.pedido_lineas set articulo_vendedor_id = null, coste_salida = null where id = l.id;
  end loop;
  update public.pedidos set entrega_fecha = public.sumar_dias_lectivos(public.hoy(), 1) where id = p_id;
  perform public._avanzar(p_id, 'pedido_aceptado', 'Albarán ' || a.num || ' rechazado: ' || p_motivo || '. Hay que reemitirlo en un día lectivo', yo);
end $$;

-- 3. IVA del catálogo validado: lo indica la profesora y rellena la factura y la tienda
alter table public.catalogo add column iva numeric(4,1) not null default 21 check (iva in (21,10,4,0));
create function public.fijar_iva_catalogo(p_id uuid, p_iva numeric) returns void language plpgsql security definer set search_path = '' as $$
declare c public.catalogo;
begin
  if not public.es_profesora() then raise exception 'Solo la profesora indica el tipo de IVA' using errcode = '42501'; end if;
  if p_iva is null or p_iva not in (21,10,4,0) then raise exception 'El IVA tiene que ser 21, 10, 4 o 0 %%'; end if;
  update public.catalogo set iva = p_iva where id = p_id returning * into c;
  if not found then raise exception 'Ese artículo no está en el catálogo'; end if;
end $$;

-- 4. Financiación: cuadro de cuotas (método francés, cuotas mensuales) y registro de pagos
alter table public.solicitudes_financiacion drop constraint solicitudes_financiacion_empresa_id_check;
alter table public.solicitudes_financiacion add constraint solicitudes_financiacion_empresa_id_check check (empresa_id between 1 and 6);
alter table public.solicitudes_financiacion add column perfil_id uuid references public.perfiles(id);
drop policy financiacion_visible on public.solicitudes_financiacion;
create policy financiacion_visible on public.solicitudes_financiacion for select to authenticated using (public.es_profesora() or public.mi_empresa() = 5 or (perfil_id is null and public.mi_empresa() = empresa_id) or perfil_id = public.mi_firma());

create table public.cuotas_prestamo (
  id bigint generated always as identity primary key,
  solicitud_id bigint not null references public.solicitudes_financiacion(id),
  n int not null,
  vencimiento date not null,
  capital numeric(14,2) not null,
  interes numeric(14,2) not null,
  cuota numeric(14,2) not null,
  pendiente_tras numeric(14,2) not null,
  pagada_fecha date,
  pago_nombre text,
  justificante text,
  unique (solicitud_id, n)
);
create function public._generar_cuotas(s public.solicitudes_financiacion) returns void language plpgsql security definer set search_path = '' as $$
declare i numeric := coalesce(s.tipo_interes, 0) / 1200; c numeric; v_pend numeric := s.importe; v_int numeric; v_cap numeric;
begin
  c := case when i = 0 then round(s.importe / s.plazo_meses, 2) else round(s.importe * i / (1 - power(1 + i, -s.plazo_meses::numeric)), 2) end;
  for k in 1..s.plazo_meses loop
    v_int := round(v_pend * i, 2);
    v_cap := case when k = s.plazo_meses then v_pend else c - v_int end;
    v_pend := v_pend - v_cap;
    insert into public.cuotas_prestamo (solicitud_id, n, vencimiento, capital, interes, cuota, pendiente_tras) values (s.id, k, (public.hoy() + make_interval(months => k))::date, v_cap, v_int, v_cap + v_int, v_pend);
  end loop;
end $$;

-- 5. Cuentas personales. No hay contabilidad personal: solo un extracto y sus justificantes
create table public.movimientos_personales (
  id bigint generated always as identity primary key,
  perfil_id uuid not null references public.perfiles(id),
  fecha date not null,
  concepto text not null,
  importe numeric(14,2) not null,
  saldo numeric(14,2) not null check (saldo >= 0),
  justificante text
);
create index movimientos_personales_perfil on public.movimientos_personales (perfil_id, id);
create function public._mov_personal(p_perfil uuid, p_concepto text, p_importe numeric, p_just text) returns void language plpgsql security definer set search_path = '' as $$
declare v numeric;
begin
  perform 1 from public.perfiles where id = p_perfil for update;
  select coalesce((select saldo from public.movimientos_personales where perfil_id = p_perfil order by id desc limit 1), 0) + p_importe into v;
  if v < 0 then raise exception 'No tienes saldo suficiente en tu cuenta personal'; end if;
  insert into public.movimientos_personales (perfil_id, fecha, concepto, importe, saldo, justificante) values (p_perfil, public.hoy(), p_concepto, p_importe, v, p_just);
end $$;

create or replace function public.autorizar_financiacion(p_id bigint, p_autorizar boolean, p_motivo text) returns void language plpgsql security definer set search_path = '' as $$
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
  if s.perfil_id is null then
    perform public._movimiento(5::smallint, 'Préstamo concedido a ' || public._corto(s.empresa_id), -s.importe, v_just);
    perform public._movimiento(s.empresa_id, 'Préstamo del banco a ' || s.plazo_meses || ' meses', s.importe, v_just);
  else
    perform public._movimiento(5::smallint, 'Préstamo personal a ' || s.solicito_nombre, -s.importe, v_just);
    perform public._mov_personal(s.perfil_id, 'Préstamo personal a ' || s.plazo_meses || ' meses', s.importe, v_just);
  end if;
  update public.solicitudes_financiacion set estado = 'autorizada', justificante = v_just, estado_desde = public.hoy() where id = p_id;
  select * into strict s from public.solicitudes_financiacion where id = p_id;
  perform public._generar_cuotas(s);
end $$;

-- Las cuotas se pagan por orden. La empresa no paga comisión porque el banco es quien cobra
create function public.pagar_cuota(p_id bigint) returns text language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); c public.cuotas_prestamo; s public.solicitudes_financiacion; v_just text;
begin
  select * into c from public.cuotas_prestamo where id = p_id for update;
  if not found then raise exception 'Esa cuota no existe'; end if;
  select * into strict s from public.solicitudes_financiacion where id = c.solicitud_id;
  if (s.perfil_id is null and yo.empresa_id <> s.empresa_id) or (s.perfil_id is not null and yo.id <> s.perfil_id) then raise exception 'Este préstamo no es tuyo' using errcode = '42501'; end if;
  if c.pagada_fecha is not null then raise exception 'Esa cuota ya está pagada'; end if;
  if exists (select 1 from public.cuotas_prestamo where solicitud_id = c.solicitud_id and n < c.n and pagada_fecha is null) then raise exception 'Hay una cuota anterior sin pagar'; end if;
  perform 1 from public.empresas where id in (s.empresa_id, 5) order by id for update;
  v_just := public._numero('JB', 5::smallint);
  if s.perfil_id is null then
    if public._saldo(s.empresa_id) + public._descubierto(s.empresa_id) < c.cuota then raise exception 'No tienes saldo suficiente para pagar esta cuota'; end if;
    perform public._movimiento(s.empresa_id, 'Cuota ' || c.n || '/' || s.plazo_meses || ' del préstamo', -c.cuota, v_just);
    perform public._movimiento(5::smallint, 'Cobro de cuota ' || c.n || '/' || s.plazo_meses || ' de ' || public._corto(s.empresa_id), c.cuota, v_just);
  else
    perform public._mov_personal(s.perfil_id, 'Cuota ' || c.n || '/' || s.plazo_meses || ' del préstamo personal', -c.cuota, v_just);
    perform public._movimiento(5::smallint, 'Cobro de cuota ' || c.n || '/' || s.plazo_meses || ' de ' || s.solicito_nombre, c.cuota, v_just);
  end if;
  update public.cuotas_prestamo set pagada_fecha = public.hoy(), pago_nombre = yo.nombre, justificante = v_just where id = p_id;
  return v_just;
end $$;

create function public.solicitar_prestamo_personal(p_importe numeric, p_plazo int, p_motivo text) returns bigint language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); v_id bigint; v_max int;
begin
  perform public._modulo('financiacion', 'La financiación');
  perform public._modulo('consumidores', 'La parte de consumidores');
  if coalesce(p_importe, 0) <= 0 or coalesce(p_plazo, 0) <= 0 then raise exception 'Indica el importe y el plazo'; end if;
  if p_plazo > 48 then raise exception 'Los préstamos al consumo no pueden superar cuatro años'; end if;
  if length(trim(coalesce(p_motivo, ''))) = 0 then raise exception 'Indica el motivo'; end if;
  select plazo_max_meses into v_max from public.condiciones_banco order by vigente_desde desc, id desc limit 1;
  if v_max is not null and p_plazo > v_max then raise exception 'El plazo máximo publicado por el banco es de % meses', v_max; end if;
  insert into public.solicitudes_financiacion (empresa_id, perfil_id, importe, plazo_meses, motivo, fecha, estado_desde, solicito_id, solicito_nombre) values (yo.empresa_id, yo.id, round(p_importe, 2), p_plazo, trim(p_motivo), public.hoy(), public.hoy(), yo.id, yo.nombre) returning id into v_id;
  return v_id;
end $$;

-- 6. Compras y gastos de los consumidores: bienes en el G6, servicios y suministros en el G4
create table public.gastos_personales (
  id bigint generated always as identity primary key,
  num text not null,
  perfil_id uuid not null references public.perfiles(id),
  proveedor_id smallint not null references public.empresas(id),
  tipo text not null check (tipo in ('tienda','servicio','vivienda','suministros')),
  descripcion text not null,
  base numeric(14,2) not null,
  cuota numeric(14,2) not null,
  total numeric(14,2) not null,
  fecha date not null,
  justificante text not null
);
create function public._registrar_gasto(yo public.perfiles, p_num text, p_prov smallint, p_tipo text, p_desc text, p_base numeric, p_cuota numeric) returns text language plpgsql security definer set search_path = '' as $$
declare v_just text := public._numero('JB', 5::smallint);
begin
  perform public._mov_personal(yo.id, p_desc || ' · ' || p_num, -(p_base + p_cuota), v_just);
  perform 1 from public.empresas where id = p_prov for update;
  perform public._movimiento(p_prov, 'Cobro de ' || yo.nombre || ' · ' || p_num, p_base + p_cuota, v_just);
  insert into public.gastos_personales (num, perfil_id, proveedor_id, tipo, descripcion, base, cuota, total, fecha, justificante) values (p_num, yo.id, p_prov, p_tipo, p_desc, p_base, p_cuota, p_base + p_cuota, public.hoy(), v_just);
  return p_num;
end $$;

-- La venta en tienda usa ahora el IVA del catálogo
create or replace function public.vender_tienda(p_articulo uuid, p_unidades numeric) returns text language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); a public.articulos; cat public.catalogo; v_base numeric; v_cuota numeric; c numeric; v_num text; v_just text;
begin
  if yo.empresa_id <> 6 then raise exception 'Solo el G6 vende en tienda' using errcode = '42501'; end if;
  if coalesce(p_unidades, 0) <= 0 then raise exception 'Las unidades tienen que ser mayores que 0'; end if;
  select * into a from public.articulos where id = p_articulo and empresa_id = 6;
  if not found then raise exception 'Ese artículo no es de tu almacén'; end if;
  select * into cat from public.catalogo where id = a.catalogo_id and activo;
  if not found then raise exception 'Ese artículo no está en tu catálogo'; end if;
  perform 1 from public.empresas where id = 6 for update;
  v_num := public._numero('T', 6::smallint);
  c := public._salida(p_articulo, p_unidades, null, 'Venta en tienda (ticket)', v_num);
  v_base := round(cat.precio * p_unidades, 2);
  v_cuota := round(v_base * cat.iva / 100, 2);
  v_just := public._numero('JB', 5::smallint);
  perform public._movimiento(6::smallint, 'Cobro con TPV ticket ' || v_num, v_base + v_cuota, v_just);
  insert into public.tickets (num, fecha, articulo_id, descripcion, unidades, precio, base, cuota, total, coste, justificante, elaboro_id, elaboro_nombre)
    values (v_num, public.hoy(), p_articulo, a.nombre, p_unidades, cat.precio, v_base, v_cuota, v_base + v_cuota, round(p_unidades * c, 2), v_just, yo.id, yo.nombre);
  return v_num;
end $$;

create function public.comprar_en_tienda(p_catalogo uuid, p_unidades numeric) returns text language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); a public.articulos; cat public.catalogo; v_base numeric; v_cuota numeric; c numeric; v_num text;
begin
  perform public._modulo('consumidores', 'La parte de consumidores');
  if coalesce(p_unidades, 0) <= 0 then raise exception 'Las unidades tienen que ser mayores que 0'; end if;
  select * into cat from public.catalogo where id = p_catalogo and empresa_id = 6 and activo;
  if not found then raise exception 'Ese artículo no está en el catálogo de la tienda'; end if;
  select * into a from public.articulos where catalogo_id = p_catalogo and empresa_id = 6;
  if not found then raise exception 'La tienda no tiene ese artículo en su almacén'; end if;
  v_base := round(cat.precio * p_unidades, 2);
  v_cuota := round(v_base * cat.iva / 100, 2);
  v_num := public._numero('T', 6::smallint);
  c := public._salida(a.id, p_unidades, null, 'Venta en tienda a ' || yo.nombre, v_num);
  perform public._registrar_gasto(yo, v_num, 6::smallint, 'tienda', a.nombre || ' × ' || p_unidades::numeric(14,0), v_base, v_cuota);
  insert into public.tickets (num, fecha, articulo_id, descripcion, unidades, precio, base, cuota, total, coste, justificante, elaboro_id, elaboro_nombre)
    values (v_num, public.hoy(), a.id, a.nombre, p_unidades, cat.precio, v_base, v_cuota, v_base + v_cuota, round(p_unidades * c, 2), (select justificante from public.gastos_personales where num = v_num), yo.id, yo.nombre);
  return v_num;
end $$;

create function public.contratar_servicio_personal(p_catalogo uuid, p_unidades numeric) returns text language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); cat public.catalogo; v_base numeric;
begin
  perform public._modulo('consumidores', 'La parte de consumidores');
  if coalesce(p_unidades, 0) <= 0 then raise exception 'Las unidades tienen que ser mayores que 0'; end if;
  select * into cat from public.catalogo where id = p_catalogo and empresa_id = 4 and activo;
  if not found then raise exception 'Ese servicio no está en el catálogo del G4'; end if;
  v_base := round(cat.precio * p_unidades, 2);
  return public._registrar_gasto(yo, public._numero('RP', 4::smallint), 4::smallint, 'servicio', cat.nombre, v_base, round(v_base * cat.iva / 100, 2));
end $$;

-- Vivienda sin IVA y suministros al 21 %. El importe que se indica es el total del recibo
create function public.pagar_gasto_personal(p_tipo text, p_total numeric, p_concepto text) returns text language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); v_base numeric;
begin
  perform public._modulo('consumidores', 'La parte de consumidores');
  if p_tipo is null or p_tipo not in ('vivienda','suministros') then raise exception 'El gasto tiene que ser de vivienda o de suministros'; end if;
  if coalesce(p_total, 0) <= 0 then raise exception 'El importe tiene que ser mayor que cero'; end if;
  if length(trim(coalesce(p_concepto, ''))) = 0 then raise exception 'Indica el concepto'; end if;
  v_base := case when p_tipo = 'vivienda' then round(p_total, 2) else round(p_total / 1.21, 2) end;
  return public._registrar_gasto(yo, public._numero('RP', 4::smallint), 4::smallint, p_tipo, trim(p_concepto), v_base, round(p_total, 2) - v_base);
end $$;

-- 7. Nóminas: los porcentajes los comunica la profesora y empiezan en cero
create table public.reglas_nomina (
  id boolean primary key default true check (id),
  bruto_minimo numeric(10,2) not null default 2000 check (bruto_minimo >= 0),
  ss_trabajador numeric(5,2) not null default 0 check (ss_trabajador between 0 and 100),
  ss_empresa numeric(5,2) not null default 0 check (ss_empresa between 0 and 100),
  irpf numeric(5,2) not null default 0 check (irpf between 0 and 100)
);
insert into public.reglas_nomina (id) values (true);
create function public.fijar_reglas_nomina(p_ss_trabajador numeric, p_ss_empresa numeric, p_irpf numeric) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.es_profesora() then raise exception 'Solo la profesora comunica estas reglas' using errcode = '42501'; end if;
  if least(p_ss_trabajador, p_ss_empresa, p_irpf) < 0 or greatest(p_ss_trabajador, p_ss_empresa, p_irpf) > 100 then raise exception 'Los porcentajes tienen que estar entre 0 y 100'; end if;
  update public.reglas_nomina set ss_trabajador = p_ss_trabajador, ss_empresa = p_ss_empresa, irpf = p_irpf;
end $$;

create table public.nominas (
  id bigint generated always as identity primary key,
  num text not null,
  empresa_id smallint not null references public.empresas(id),
  trabajador_id uuid not null references public.perfiles(id),
  trabajador_nombre text not null,
  mes date not null,
  bruto numeric(12,2) not null,
  ss_trabajador numeric(12,2) not null,
  ss_empresa numeric(12,2) not null,
  irpf numeric(12,2) not null,
  liquido numeric(12,2) not null,
  fecha date not null,
  justificante text not null,
  elaboro_id uuid not null references public.perfiles(id),
  elaboro_nombre text not null,
  unique (trabajador_id, mes)
);
create function public.emitir_nomina(p_trabajador uuid, p_mes date, p_bruto numeric) returns bigint language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); t public.perfiles; r public.reglas_nomina; v_mes date := date_trunc('month', p_mes)::date; v_ss_t numeric; v_ss_e numeric; v_irpf numeric; v_liq numeric; v_num text; v_just text; v_id bigint;
begin
  perform public._modulo('nominas', 'Las nóminas');
  select * into t from public.perfiles where id = p_trabajador and empresa_id = yo.empresa_id and activo and not cuenta_grupo and rol = 'alumno';
  if not found then raise exception 'Esa persona no trabaja en tu empresa'; end if;
  select * into strict r from public.reglas_nomina;
  if coalesce(p_bruto, 0) < r.bruto_minimo then raise exception 'El salario bruto mínimo es de % € con las pagas prorrateadas', r.bruto_minimo; end if;
  if v_mes is null then raise exception 'Indica el mes'; end if;
  if exists (select 1 from public.nominas where trabajador_id = p_trabajador and mes = v_mes) then raise exception 'Esa persona ya tiene la nómina de ese mes'; end if;
  v_ss_t := round(p_bruto * r.ss_trabajador / 100, 2);
  v_ss_e := round(p_bruto * r.ss_empresa / 100, 2);
  v_irpf := round(p_bruto * r.irpf / 100, 2);
  v_liq := round(p_bruto, 2) - v_ss_t - v_irpf;
  perform 1 from public.empresas where id in (yo.empresa_id, 8, 9) order by id for update;
  if public._saldo(yo.empresa_id) + public._descubierto(yo.empresa_id) < v_liq + v_ss_t + v_ss_e + v_irpf then raise exception 'No hay saldo suficiente para pagar esta nómina'; end if;
  v_num := public._numero('N', yo.empresa_id);
  v_just := public._numero('JB', 5::smallint);
  perform public._movimiento(yo.empresa_id, 'Nómina ' || v_num || ' de ' || t.nombre, -v_liq, v_just);
  perform public._mov_personal(t.id, 'Nómina de ' || to_char(v_mes, 'MM/YYYY') || ' de ' || public._corto(yo.empresa_id), v_liq, v_just);
  if v_ss_t + v_ss_e > 0 then
    perform public._movimiento(yo.empresa_id, 'Seguridad Social de ' || v_num, -(v_ss_t + v_ss_e), v_just);
    perform public._movimiento(9::smallint, 'Cobro de ' || public._corto(yo.empresa_id) || ' · ' || v_num, v_ss_t + v_ss_e, v_just);
  end if;
  if v_irpf > 0 then
    perform public._movimiento(yo.empresa_id, 'Retención de IRPF de ' || v_num, -v_irpf, v_just);
    perform public._movimiento(8::smallint, 'Cobro de ' || public._corto(yo.empresa_id) || ' · ' || v_num, v_irpf, v_just);
  end if;
  insert into public.nominas (num, empresa_id, trabajador_id, trabajador_nombre, mes, bruto, ss_trabajador, ss_empresa, irpf, liquido, fecha, justificante, elaboro_id, elaboro_nombre)
    values (v_num, yo.empresa_id, t.id, t.nombre, v_mes, round(p_bruto, 2), v_ss_t, v_ss_e, v_irpf, v_liq, public.hoy(), v_just, yo.id, yo.nombre) returning id into v_id;
  return v_id;
end $$;

-- 8. Electricidad y agua con su fianza. La deposita cada empresa en el G4, y el G4 en el Estado
create table public.fianzas (
  id bigint generated always as identity primary key,
  num text not null,
  empresa_id smallint not null references public.empresas(id),
  suministro text not null check (suministro in ('electricidad','agua')),
  importe numeric(12,2) not null check (importe > 0),
  receptor_id smallint not null references public.empresas(id),
  fecha date not null,
  justificante text not null,
  elaboro_nombre text not null,
  estado text not null default 'constituida' check (estado in ('constituida','devuelta')),
  devuelta_fecha date,
  devuelta_justificante text
);
create unique index fianzas_una_vigente on public.fianzas (empresa_id, suministro) where estado = 'constituida';
create function public.constituir_fianza(p_suministro text, p_importe numeric) returns text language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); v_rec smallint; v_num text; v_just text;
begin
  perform public._modulo('suministros', 'La contratación de suministros');
  if p_suministro is null or p_suministro not in ('electricidad','agua') then raise exception 'El suministro tiene que ser electricidad o agua'; end if;
  if coalesce(p_importe, 0) <= 0 then raise exception 'El importe tiene que ser mayor que cero'; end if;
  if exists (select 1 from public.fianzas where empresa_id = yo.empresa_id and suministro = p_suministro and estado = 'constituida') then raise exception 'Ya tienes una fianza de ese suministro'; end if;
  v_rec := case when yo.empresa_id = 4 then 7 else 4 end;
  perform 1 from public.empresas where id in (yo.empresa_id, v_rec) order by id for update;
  if public._saldo(yo.empresa_id) + public._descubierto(yo.empresa_id) < p_importe then raise exception 'No hay saldo suficiente para la fianza'; end if;
  v_num := public._numero('FZ', yo.empresa_id);
  v_just := public._numero('JB', 5::smallint);
  perform public._movimiento(yo.empresa_id, 'Fianza de ' || p_suministro || ' ' || v_num, -round(p_importe, 2), v_just);
  perform public._movimiento(v_rec, 'Fianza de ' || p_suministro || ' de ' || public._corto(yo.empresa_id), round(p_importe, 2), v_just);
  insert into public.fianzas (num, empresa_id, suministro, importe, receptor_id, fecha, justificante, elaboro_nombre) values (v_num, yo.empresa_id, p_suministro, round(p_importe, 2), v_rec, public.hoy(), v_just, yo.nombre);
  return v_just;
end $$;
create function public.devolver_fianza(p_id bigint) returns text language plpgsql security definer set search_path = '' as $$
declare z public.fianzas; v_just text; v_mi smallint := public.mi_empresa();
begin
  select * into z from public.fianzas where id = p_id for update;
  if not found then raise exception 'Esa fianza no existe'; end if;
  if not ((z.receptor_id = 7 and public.es_profesora()) or (z.receptor_id = 4 and v_mi = 4)) then raise exception 'Solo quien recibió la fianza la devuelve' using errcode = '42501'; end if;
  if z.estado <> 'constituida' then raise exception 'Esa fianza ya está devuelta'; end if;
  perform 1 from public.empresas where id in (z.empresa_id, z.receptor_id) order by id for update;
  if z.receptor_id = 4 and public._saldo(4::smallint) + public._descubierto(4::smallint) < z.importe then raise exception 'No hay saldo suficiente para devolver la fianza'; end if;
  v_just := public._numero('JB', 5::smallint);
  perform public._movimiento(z.receptor_id, 'Devolución de fianza a ' || public._corto(z.empresa_id), -z.importe, v_just);
  perform public._movimiento(z.empresa_id, 'Devolución de la fianza de ' || z.suministro, z.importe, v_just);
  update public.fianzas set estado = 'devuelta', devuelta_fecha = public.hoy(), devuelta_justificante = v_just where id = p_id;
  return v_just;
end $$;

-- 9. Liquidación de IVA de noviembre y diciembre de 2026. El grupo escribe sus cifras y la profesora las compara
create table public.liquidaciones_iva (
  id bigint generated always as identity primary key,
  num text not null,
  empresa_id smallint not null references public.empresas(id),
  periodo text not null check (periodo in ('2026-11','2026-12')),
  repercutido numeric(14,2) not null,
  soportado numeric(14,2) not null,
  resultado numeric(14,2) not null,
  fecha date not null,
  justificante text,
  presento_id uuid not null references public.perfiles(id),
  presento_nombre text not null,
  unique (empresa_id, periodo)
);
create function public.iva_calculado(p_empresa smallint, p_periodo text) returns table (repercutido numeric, soportado numeric) language plpgsql stable security definer set search_path = '' as $$
declare v_d date := (p_periodo || '-01')::date; v_h date := ((p_periodo || '-01')::date + interval '1 month')::date;
begin
  if not public.es_profesora() then raise exception 'Solo la profesora ve esta comparación' using errcode = '42501'; end if;
  return query
  with fa as (select f.cuota, f.fecha, p.vendedor_id, p.comprador_id from public.facturas f join public.pedidos p on p.id = f.pedido_id where f.estado = 'aceptada'),
  re as (select r.cuota, r.fecha, p.vendedor_id, p.comprador_id from public.rectificativas r join public.pedidos p on p.id = r.pedido_id where r.estado = 'aceptada'),
  todo as (select * from fa union all select * from re)
  select
    coalesce((select sum(cuota) from todo where vendedor_id = p_empresa and fecha >= v_d and fecha < v_h), 0)
      + coalesce((select sum(cuota) from public.tickets where p_empresa = 6 and fecha >= v_d and fecha < v_h), 0)
      + coalesce((select sum(cuota) from public.gastos_personales where proveedor_id = p_empresa and tipo <> 'tienda' and fecha >= v_d and fecha < v_h), 0),
    coalesce((select sum(cuota) from todo where comprador_id = p_empresa and fecha >= v_d and fecha < v_h), 0);
end $$;
create function public.presentar_iva(p_periodo text, p_repercutido numeric, p_soportado numeric) returns bigint language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); v_res numeric; v_just text; v_num text; v_id bigint;
begin
  perform public._modulo('iva', 'La liquidación de IVA');
  if p_periodo is null or p_periodo not in ('2026-11','2026-12') then raise exception 'Solo se liquidan noviembre y diciembre de 2026'; end if;
  if p_repercutido is null or p_soportado is null or p_repercutido < 0 or p_soportado < 0 then raise exception 'Indica el IVA repercutido y el soportado'; end if;
  if exists (select 1 from public.liquidaciones_iva where empresa_id = yo.empresa_id and periodo = p_periodo) then raise exception 'Ya has presentado ese periodo'; end if;
  v_res := round(p_repercutido, 2) - round(p_soportado, 2);
  v_num := public._numero('IVA', yo.empresa_id);
  if v_res > 0 then
    perform 1 from public.empresas where id in (yo.empresa_id, 8) order by id for update;
    if public._saldo(yo.empresa_id) + public._descubierto(yo.empresa_id) < v_res then raise exception 'No hay saldo suficiente para ingresar el IVA'; end if;
    v_just := public._numero('JB', 5::smallint);
    perform public._movimiento(yo.empresa_id, 'IVA de ' || p_periodo || ' · ' || v_num, -v_res, v_just);
    perform public._movimiento(8::smallint, 'IVA de ' || public._corto(yo.empresa_id) || ' · ' || v_num, v_res, v_just);
  end if;
  insert into public.liquidaciones_iva (num, empresa_id, periodo, repercutido, soportado, resultado, fecha, justificante, presento_id, presento_nombre)
    values (v_num, yo.empresa_id, p_periodo, round(p_repercutido, 2), round(p_soportado, 2), v_res, public.hoy(), v_just, yo.id, yo.nombre) returning id into v_id;
  return v_id;
end $$;

-- 10. Rotación de roles (punto 3.8): cuántos documentos ha elaborado y revisado cada persona
create function public.actividad_personas(p_empresa smallint) returns table (perfil_id uuid, nombre text, elaborados bigint, revisados bigint, ultimo date) language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.es_profesora() or public.mi_empresa() = p_empresa) then raise exception 'No puedes consultar otra empresa' using errcode = '42501'; end if;
  return query
  with h as (
    select elaboro_id id, 'e' k, fecha from public.pedidos union all select reviso_id, 'r', fecha from public.pedidos
    union all select elaboro_id, 'e', fecha from public.albaranes union all select reviso_id, 'r', fecha from public.albaranes
    union all select elaboro_id, 'e', fecha from public.facturas union all select reviso_id, 'r', fecha from public.facturas
    union all select elaboro_id, 'e', fecha from public.rectificativas union all select reviso_id, 'r', fecha from public.rectificativas
    union all select elaboro_id, 'e', fecha from public.nominas
  )
  select pf.id, pf.nombre, count(*) filter (where h.k = 'e'), count(*) filter (where h.k = 'r'), max(h.fecha)
  from public.perfiles pf left join h on h.id = pf.id
  where pf.empresa_id = p_empresa and pf.activo and not pf.cuenta_grupo
  group by pf.id, pf.nombre order by pf.nombre;
end $$;

-- 11. RLS: lectura por política, escritura solo mediante funciones
alter table public.albaranes_rechazados enable row level security;
alter table public.cuotas_prestamo enable row level security;
alter table public.movimientos_personales enable row level security;
alter table public.gastos_personales enable row level security;
alter table public.reglas_nomina enable row level security;
alter table public.nominas enable row level security;
alter table public.fianzas enable row level security;
alter table public.liquidaciones_iva enable row level security;
revoke all on public.albaranes_rechazados, public.cuotas_prestamo, public.movimientos_personales, public.gastos_personales, public.reglas_nomina, public.nominas, public.fianzas, public.liquidaciones_iva from public, anon, authenticated, service_role;
grant select on public.albaranes_rechazados, public.cuotas_prestamo, public.movimientos_personales, public.gastos_personales, public.reglas_nomina, public.nominas, public.fianzas, public.liquidaciones_iva to authenticated;
create policy rechazados_partes on public.albaranes_rechazados for select to authenticated using (public.es_profesora() or public.es_parte_pedido(pedido_id));
create policy cuotas_visibles on public.cuotas_prestamo for select to authenticated using (exists (select 1 from public.solicitudes_financiacion s where s.id = solicitud_id));
create policy personales_propios on public.movimientos_personales for select to authenticated using (public.es_profesora() or perfil_id = public.mi_firma());
create policy gastos_propios on public.gastos_personales for select to authenticated using (public.es_profesora() or perfil_id = public.mi_firma() or proveedor_id = public.mi_empresa());
create policy reglas_visibles on public.reglas_nomina for select to authenticated using (true);
create policy nominas_visibles on public.nominas for select to authenticated using (public.es_profesora() or empresa_id = public.mi_empresa() or trabajador_id = public.mi_firma());
create policy fianzas_visibles on public.fianzas for select to authenticated using (public.es_profesora() or public.mi_empresa() in (empresa_id, receptor_id));
create policy iva_visible on public.liquidaciones_iva for select to authenticated using (public.es_profesora() or empresa_id = public.mi_empresa());

do $$
declare f record;
begin
  for f in select oid::regprocedure as s from pg_proc where pronamespace = 'public'::regnamespace and proname = any (array['_modulo','mi_firma','intervenir_pedido','rechazar_albaran','fijar_iva_catalogo','_generar_cuotas','_mov_personal','pagar_cuota','solicitar_prestamo_personal','_registrar_gasto','comprar_en_tienda','contratar_servicio_personal','pagar_gasto_personal','fijar_reglas_nomina','emitir_nomina','constituir_fianza','devolver_fianza','iva_calculado','presentar_iva','actividad_personas']) loop
    execute 'revoke execute on function ' || f.s || ' from public, anon, authenticated, service_role';
  end loop;
end $$;
grant execute on function public.mi_firma(), public.intervenir_pedido(bigint,text,numeric,int), public.rechazar_albaran(bigint,text), public.fijar_iva_catalogo(uuid,numeric), public.pagar_cuota(bigint), public.solicitar_prestamo_personal(numeric,int,text), public.comprar_en_tienda(uuid,numeric), public.contratar_servicio_personal(uuid,numeric), public.pagar_gasto_personal(text,numeric,text), public.fijar_reglas_nomina(numeric,numeric,numeric), public.emitir_nomina(uuid,date,numeric), public.constituir_fianza(text,numeric), public.devolver_fianza(bigint), public.iva_calculado(smallint,text), public.presentar_iva(text,numeric,numeric), public.actividad_personas(smallint) to authenticated;
notify pgrst, 'reload schema';
