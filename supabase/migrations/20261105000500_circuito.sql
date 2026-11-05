-- Circuito GAD · Fase 2: circuito documental, banco y plazos.
-- Solo añade objetos: no toca ni borra datos existentes.

-- Fecha de trabajo. La simulación solo funciona donde permitido = true, y eso solo se activa a mano en un proyecto de demostración.
create table public.ajustes_demo (
  id boolean primary key default true check (id),
  permitido boolean not null default false,
  fecha_simulada date
);
insert into public.ajustes_demo default values;

create table public.contadores (
  tipo text not null,
  empresa_id smallint not null references public.empresas(id),
  anio int not null,
  ultimo int not null,
  primary key (tipo, empresa_id, anio)
);

create table public.pedidos (
  id bigint generated always as identity primary key,
  num text not null,
  comprador_id smallint not null references public.empresas(id),
  vendedor_id smallint not null references public.empresas(id) check (vendedor_id <> 5),
  servicio boolean not null,
  fecha date not null,
  entrega_dias smallint check (entrega_dias between 1 and 5),
  entrega_fecha date,
  etapa text not null check (etapa in ('pedido_enviado','pedido_rechazado','pedido_aceptado','albaran_emitido','recibido','factura_emitida','factura_rechazada','factura_aceptada','orden_pendiente','orden_denegada','pagado')),
  etapa_desde date not null,
  motivo_rechazo text,
  elaboro_id uuid not null references public.perfiles(id),
  elaboro_nombre text not null,
  reviso_id uuid references public.perfiles(id),
  reviso_nombre text,
  creado_en timestamptz not null default now(),
  check (comprador_id <> vendedor_id)
);
create index pedidos_comprador on public.pedidos (comprador_id);
create index pedidos_vendedor on public.pedidos (vendedor_id);

create table public.pedido_lineas (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references public.pedidos(id),
  catalogo_id uuid not null references public.catalogo(id),
  descripcion text not null,
  unidades numeric(14,3) not null check (unidades > 0),
  precio numeric(12,2) not null check (precio >= 0)
);
create index pedido_lineas_pedido on public.pedido_lineas (pedido_id);

create table public.albaranes (
  pedido_id bigint primary key references public.pedidos(id),
  num text not null,
  fecha date not null,
  retrasado boolean not null default false,
  elaboro_id uuid not null references public.perfiles(id),
  elaboro_nombre text not null,
  recibido_fecha date,
  reviso_id uuid references public.perfiles(id),
  reviso_nombre text
);

create table public.facturas (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references public.pedidos(id),
  num text not null,
  version int not null,
  fecha date not null,
  dto numeric(5,2) not null default 0,
  rappel numeric(5,2) not null default 0,
  pronto_pago numeric(5,2) not null default 0,
  portes numeric(12,2) not null default 0,
  envases numeric(12,2) not null default 0,
  iva numeric(4,1) not null check (iva in (21,10,4,0)),
  retencion numeric(4,1) not null default 0 check (retencion in (0,15)),
  vencimiento_dias int not null check (vencimiento_dias = 0 or vencimiento_dias between 5 and 30),
  vencimiento_fecha date not null,
  suma numeric(14,2) not null,
  dto_imp numeric(14,2) not null,
  rappel_imp numeric(14,2) not null,
  pronto_pago_imp numeric(14,2) not null,
  neto numeric(14,2) not null,
  base numeric(14,2) not null,
  cuota numeric(14,2) not null,
  retencion_imp numeric(14,2) not null,
  total numeric(14,2) not null,
  estado text not null default 'emitida' check (estado in ('emitida','aceptada','rechazada')),
  motivo_rechazo text,
  comprobaciones text[],
  elaboro_id uuid not null references public.perfiles(id),
  elaboro_nombre text not null,
  reviso_id uuid references public.perfiles(id),
  reviso_nombre text,
  unique (pedido_id, version)
);

create table public.factura_lineas (
  id bigint generated always as identity primary key,
  factura_id bigint not null references public.facturas(id),
  pedido_linea_id bigint not null references public.pedido_lineas(id),
  descripcion text not null,
  unidades numeric(14,3) not null check (unidades >= 0),
  precio numeric(12,2) not null check (precio >= 0)
);
create index factura_lineas_factura on public.factura_lineas (factura_id);

create table public.registros_contables (
  pedido_id bigint not null references public.pedidos(id),
  lado text not null check (lado in ('comprador','vendedor')),
  paso text not null check (paso in ('borrador','diario')),
  hecho_por uuid not null references public.perfiles(id),
  hecho_nombre text not null,
  creado_en timestamptz not null default now(),
  primary key (pedido_id, lado, paso)
);

create table public.ordenes_pago (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references public.pedidos(id),
  num text not null,
  ordenante_id smallint not null references public.empresas(id),
  beneficiario_id smallint not null references public.empresas(id),
  concepto text not null,
  importe numeric(14,2) not null check (importe > 0),
  comision numeric(8,2) not null check (comision >= 0),
  estado text not null default 'pendiente' check (estado in ('pendiente','ejecutada','denegada')),
  motivo_denegacion text,
  fecha date not null,
  confirmo_comprobacion boolean not null default false,
  ordeno_id uuid not null references public.perfiles(id),
  ordeno_nombre text not null,
  ejecuto_id uuid references public.perfiles(id),
  ejecuto_nombre text,
  fecha_ejecucion date,
  justificante text
);
create unique index ordenes_una_pendiente on public.ordenes_pago (pedido_id) where estado = 'pendiente';

create table public.historial (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references public.pedidos(id),
  texto text not null,
  quien_id uuid references public.perfiles(id),
  quien_nombre text,
  fecha date not null,
  creado_en timestamptz not null default now()
);
create index historial_pedido on public.historial (pedido_id, id);

create table public.bloqueos (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references public.pedidos(id),
  etapa text not null,
  etapa_desde date not null,
  comunicado_por uuid references public.perfiles(id),
  comunicado_nombre text,
  comunicado_fecha date,
  registrado boolean not null default false,
  unique (pedido_id, etapa, etapa_desde)
);

create table public.incumplimientos (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references public.pedidos(id),
  responsable_id smallint not null references public.empresas(id),
  afectada_id smallint not null references public.empresas(id),
  texto text not null,
  fecha date not null,
  registrado_por uuid not null references public.perfiles(id)
);

-- Funciones de apoyo
create function public.hoy() returns date language sql stable security definer set search_path = '' as $$
  select coalesce((select fecha_simulada from public.ajustes_demo where permitido), (now() at time zone 'Europe/Madrid')::date)
$$;

create function public.simular_fecha(p_fecha date) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.es_profesora() then raise exception 'Solo la profesora simula la fecha' using errcode = '42501'; end if;
  if not (select permitido from public.ajustes_demo) then raise exception 'La simulación de fecha no está disponible en este entorno' using errcode = '42501'; end if;
  update public.ajustes_demo set fecha_simulada = p_fecha;
end $$;

create function public.es_parte_pedido(p_pedido bigint) returns boolean language sql stable security definer set search_path = '' as $$
  select public.es_profesora() or exists (select 1 from public.pedidos p where p.id = p_pedido and public.mi_empresa() in (p.comprador_id, p.vendedor_id))
$$;

create function public.plazo_limite(p public.pedidos) returns date language sql stable security definer set search_path = '' as $$
  select case p.etapa
    when 'pedido_enviado' then public.sumar_dias_lectivos(p.etapa_desde, 2)
    when 'pedido_aceptado' then p.entrega_fecha
    when 'factura_rechazada' then public.sumar_dias_lectivos(p.etapa_desde, 1)
  end
$$;

create function public._actor() returns public.perfiles language plpgsql stable security definer set search_path = '' as $$
declare v public.perfiles;
begin
  select * into v from public.perfiles where id = auth.uid() and activo;
  if not found then raise exception 'Sesión no válida' using errcode = '42501'; end if;
  if v.rol <> 'alumno' then raise exception 'La profesora no actúa en nombre de los grupos' using errcode = '42501'; end if;
  return v;
end $$;

create function public._numero(p_tipo text, p_empresa smallint) returns text language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  insert into public.contadores (tipo, empresa_id, anio, ultimo) values (p_tipo, p_empresa, extract(year from public.hoy())::int, 1)
    on conflict (tipo, empresa_id, anio) do update set ultimo = public.contadores.ultimo + 1
    returning ultimo into v;
  return case when p_tipo = 'JB' then 'JB' else p_tipo || p_empresa end || '-' || lpad(v::text, 4, '0');
end $$;

create function public._pedido(p_id bigint) returns public.pedidos language plpgsql security definer set search_path = '' as $$
declare v public.pedidos;
begin
  select * into v from public.pedidos where id = p_id for update;
  if not found then raise exception 'El pedido no existe'; end if;
  return v;
end $$;

create function public._avanzar(p_id bigint, p_etapa text, p_texto text, p_quien public.perfiles) returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.pedidos set etapa = p_etapa, etapa_desde = public.hoy() where id = p_id;
  insert into public.historial (pedido_id, texto, quien_id, quien_nombre, fecha) values (p_id, p_texto, p_quien.id, p_quien.nombre, public.hoy());
end $$;

create function public._saldo(p_empresa smallint) returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((select saldo from public.movimientos_banco where empresa_id = p_empresa order by id desc limit 1), 0)
$$;

create function public._movimiento(p_empresa smallint, p_concepto text, p_importe numeric, p_just text) returns void language sql security definer set search_path = '' as $$
  insert into public.movimientos_banco (empresa_id, fecha, concepto, importe, saldo, justificante)
  values (p_empresa, public.hoy(), p_concepto, p_importe, public._saldo(p_empresa) + p_importe, p_just)
$$;

create function public.disponible(p_empresa smallint) returns numeric language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.es_profesora() or public.mi_empresa() in (p_empresa, 5)) then raise exception 'No puedes consultar otra cuenta' using errcode = '42501'; end if;
  return public._saldo(p_empresa) - coalesce((select sum(importe + comision) from public.ordenes_pago where ordenante_id = p_empresa and estado = 'pendiente'), 0);
end $$;

-- Pedido
create function public.crear_pedido(p_vendedor smallint, p_lineas jsonb, p_entrega_dias int) returns bigint language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor();
 v_id bigint; v_servicio boolean := p_vendedor = 4; v_num text; v_nombre text;
begin
  if p_vendedor = yo.empresa_id then raise exception 'Una empresa no puede hacerse un pedido a sí misma'; end if;
  if p_vendedor = 5 or p_vendedor not between 1 and 6 then raise exception 'Ese proveedor no vende artículos ni servicios'; end if;
  if not v_servicio and (p_entrega_dias is null or p_entrega_dias not between 1 and 5) then raise exception 'El plazo de entrega va de 1 a 5 días lectivos'; end if;
  if coalesce(jsonb_array_length(p_lineas), 0) = 0 then raise exception 'Añade al menos una línea al pedido'; end if;
  if exists (select 1 from jsonb_to_recordset(p_lineas) as x(catalogo_id uuid, unidades numeric)
    left join public.catalogo c on c.id = x.catalogo_id and c.empresa_id = p_vendedor and c.activo
    where c.id is null or coalesce(x.unidades, 0) <= 0) then
    raise exception 'Cada línea necesita un artículo del catálogo del proveedor y unidades mayores que 0';
  end if;
  v_num := public._numero('P', yo.empresa_id);
  insert into public.pedidos (num, comprador_id, vendedor_id, servicio, fecha, entrega_dias, etapa, etapa_desde, elaboro_id, elaboro_nombre)
    values (v_num, yo.empresa_id, p_vendedor, v_servicio, public.hoy(), case when v_servicio then null else p_entrega_dias end, 'pedido_enviado', public.hoy(), yo.id, yo.nombre)
    returning id into v_id;
  insert into public.pedido_lineas (pedido_id, catalogo_id, descripcion, unidades, precio)
    select v_id, c.id, c.nombre, x.unidades, c.precio from jsonb_to_recordset(p_lineas) as x(catalogo_id uuid, unidades numeric) join public.catalogo c on c.id = x.catalogo_id;
  select corto into v_nombre from public.empresas where id = p_vendedor;
  insert into public.historial (pedido_id, texto, quien_id, quien_nombre, fecha) values (v_id, 'Pedido ' || v_num || ' enviado a ' || v_nombre, yo.id, yo.nombre, public.hoy());
  return v_id;
end $$;

create function public.aceptar_pedido(p_id bigint) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id); v_fecha date;
begin
  if yo.empresa_id <> p.vendedor_id then raise exception 'Solo el proveedor responde al pedido' using errcode = '42501'; end if;
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

create function public.rechazar_pedido(p_id bigint, p_motivo text) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id);
begin
  if yo.empresa_id <> p.vendedor_id then raise exception 'Solo el proveedor responde al pedido' using errcode = '42501'; end if;
  if p.etapa <> 'pedido_enviado' then raise exception 'Este pedido ya está respondido'; end if;
  if p_motivo is null or p_motivo not in ('Falta de existencias','Falta de liquidez','Precio no aceptado','Riesgo excesivo','Documento incorrecto','Incumplimiento previo') then
    raise exception 'Solo se admiten los motivos de rechazo de las normas';
  end if;
  update public.pedidos set reviso_id = yo.id, reviso_nombre = yo.nombre, motivo_rechazo = p_motivo where id = p_id;
  perform public._avanzar(p_id, 'pedido_rechazado', 'Pedido rechazado: ' || p_motivo, yo);
end $$;

-- Albarán
create function public.emitir_albaran(p_id bigint) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id); v_num text; v_tarde boolean;
begin
  if yo.empresa_id <> p.vendedor_id then raise exception 'Solo el proveedor emite el albarán' using errcode = '42501'; end if;
  if p.etapa <> 'pedido_aceptado' then raise exception 'Este pedido no está pendiente de entrega'; end if;
  if public.hoy() < p.entrega_fecha then raise exception 'El albarán no se puede emitir antes de la fecha pactada (%)', to_char(p.entrega_fecha, 'DD/MM/YYYY'); end if;
  v_tarde := public.hoy() > p.entrega_fecha;
  v_num := public._numero('A', p.vendedor_id);
  insert into public.albaranes (pedido_id, num, fecha, retrasado, elaboro_id, elaboro_nombre) values (p_id, v_num, public.hoy(), v_tarde, yo.id, yo.nombre);
  perform public._avanzar(p_id, 'albaran_emitido', 'Mercancía entregada con albarán ' || v_num || case when v_tarde then ' (entrega retrasada)' else '' end, yo);
end $$;

create function public.confirmar_recepcion(p_id bigint) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id);
begin
  if yo.empresa_id <> p.comprador_id then raise exception 'Solo el comprador confirma la recepción' using errcode = '42501'; end if;
  if p.etapa <> 'albaran_emitido' then raise exception 'No hay ningún albarán pendiente de confirmar'; end if;
  update public.albaranes set recibido_fecha = public.hoy(), reviso_id = yo.id, reviso_nombre = yo.nombre where pedido_id = p_id;
  perform public._avanzar(p_id, 'recibido', 'Recepción de la mercancía confirmada', yo);
end $$;

-- Factura: la app calcula, pero no corrige los datos de quien emite
create function public.emitir_factura(p_id bigint, p_lineas jsonb, p_dto numeric, p_rappel numeric, p_pronto_pago numeric, p_portes numeric, p_envases numeric, p_iva numeric, p_retencion numeric, p_vencimiento int) returns bigint language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id);
 v_ant public.facturas; v_id bigint; v_num text; v_version int := 1;
 v_suma numeric; v_dto numeric; v_rap numeric; v_pp numeric; v_neto numeric; v_base numeric; v_cuota numeric; v_ret numeric;
begin
  if yo.empresa_id <> p.vendedor_id then raise exception 'Solo el proveedor emite la factura' using errcode = '42501'; end if;
  if p.etapa not in ('recibido','factura_rechazada') then raise exception 'Este pedido no está pendiente de factura'; end if;
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

create function public.aceptar_factura(p_id bigint, p_comprobaciones text[]) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id); v_lista text[] := array['numeracion','partes','descripcion','unidades','descuentos','base','iva','total','pago']; v_num text;
begin
  if yo.empresa_id <> p.comprador_id then raise exception 'Solo el receptor revisa la factura' using errcode = '42501'; end if;
  if p.etapa <> 'factura_emitida' then raise exception 'No hay ninguna factura pendiente de revisar'; end if;
  if not (coalesce(p_comprobaciones, '{}') @> v_lista) then raise exception 'Marca toda la lista de comprobación antes de aceptar'; end if;
  update public.facturas set estado = 'aceptada', comprobaciones = v_lista, reviso_id = yo.id, reviso_nombre = yo.nombre
    where pedido_id = p_id and estado = 'emitida' returning num into v_num;
  perform public._avanzar(p_id, 'factura_aceptada', 'Factura ' || v_num || ' revisada y aceptada', yo);
end $$;

create function public.rechazar_factura(p_id bigint, p_motivo text) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id);
begin
  if yo.empresa_id <> p.comprador_id then raise exception 'Solo el receptor revisa la factura' using errcode = '42501'; end if;
  if p.etapa <> 'factura_emitida' then raise exception 'No hay ninguna factura pendiente de revisar'; end if;
  if length(trim(coalesce(p_motivo,''))) = 0 then raise exception 'Escribe el motivo del rechazo'; end if;
  update public.facturas set estado = 'rechazada', motivo_rechazo = trim(p_motivo), reviso_id = yo.id, reviso_nombre = yo.nombre where pedido_id = p_id and estado = 'emitida';
  perform public._avanzar(p_id, 'factura_rechazada', 'Factura rechazada: ' || trim(p_motivo), yo);
end $$;

-- Pasos 5 y 6: la app solo deja constancia
create function public.marcar_registro(p_id bigint, p_paso text) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id); v_lado text;
begin
  if yo.empresa_id = p.comprador_id then v_lado := 'comprador'; elsif yo.empresa_id = p.vendedor_id then v_lado := 'vendedor'; else raise exception 'Este pedido no es de tu empresa' using errcode = '42501'; end if;
  if p_paso not in ('borrador','diario') then raise exception 'Paso desconocido'; end if;
  if p.etapa not in ('factura_aceptada','orden_pendiente','orden_denegada','pagado') then raise exception 'La factura todavía no está aceptada'; end if;
  if p_paso = 'diario' and not exists (select 1 from public.registros_contables where pedido_id = p_id and lado = v_lado and paso = 'borrador') then raise exception 'Primero va el borrador manual'; end if;
  if exists (select 1 from public.registros_contables where pedido_id = p_id and lado = v_lado and paso = p_paso) then raise exception 'Este paso ya está marcado'; end if;
  insert into public.registros_contables (pedido_id, lado, paso, hecho_por, hecho_nombre) values (p_id, v_lado, p_paso, yo.id, yo.nombre);
  insert into public.historial (pedido_id, texto, quien_id, quien_nombre, fecha) values (p_id, case when p_paso = 'borrador' then 'Borrador manual' else 'Registro en el diario de Excel' end || ' hecho (' || v_lado || ')', yo.id, yo.nombre, public.hoy());
end $$;

-- Orden de pago
create function public.ordenar_pago(p_id bigint, p_confirmado boolean) returns bigint language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id); f public.facturas; v_com numeric; v_disp numeric; v_id bigint; v_num text;
begin
  if yo.empresa_id <> p.comprador_id then raise exception 'Solo el comprador ordena el pago' using errcode = '42501'; end if;
  if p.etapa <> 'factura_aceptada' then raise exception 'Esta factura no está pendiente de pago'; end if;
  if (select count(*) from public.registros_contables where pedido_id = p_id and lado = 'comprador') < 2 then
    raise exception 'Antes de ordenar el pago hay que hacer el borrador manual y el registro en el diario de Excel';
  end if;
  perform 1 from public.empresas where id = yo.empresa_id for update;
  select * into strict f from public.facturas where pedido_id = p_id and estado = 'aceptada' order by version desc limit 1;
  select comision_transferencia into strict v_com from public.condiciones_banco order by vigente_desde desc, id desc limit 1;
  v_disp := public.disponible(yo.empresa_id);
  if f.total <= 0 then raise exception 'El importe a transferir tiene que ser mayor que cero'; end if;
  if f.total + v_com > v_disp then raise exception 'Saldo insuficiente. El descubierto está prohibido'; end if;
  if f.total > v_disp * 0.2 and not coalesce(p_confirmado, false) then raise exception 'Supera el 20 %% de tu tesorería: confirma que has comprobado saldo, vencimiento y forma de pago'; end if;
  v_num := public._numero('OP', yo.empresa_id);
  insert into public.ordenes_pago (pedido_id, num, ordenante_id, beneficiario_id, concepto, importe, comision, fecha, confirmo_comprobacion, ordeno_id, ordeno_nombre)
    values (p_id, v_num, p.comprador_id, p.vendedor_id, 'Pago factura ' || f.num, f.total, v_com, public.hoy(), coalesce(p_confirmado, false), yo.id, yo.nombre)
    returning id into v_id;
  perform public._avanzar(p_id, 'orden_pendiente', 'Orden de pago ' || v_num || ' enviada al banco', yo);
  return v_id;
end $$;

create function public.ejecutar_orden(p_orden bigint) returns text language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); o public.ordenes_pago; p public.pedidos; v_just text; v_ord text; v_ben text;
begin
  if yo.empresa_id <> 5 then raise exception 'Solo el banco ejecuta las órdenes' using errcode = '42501'; end if;
  select * into o from public.ordenes_pago where id = p_orden for update;
  if not found then raise exception 'La orden no existe'; end if;
  p := public._pedido(o.pedido_id);
  if o.estado <> 'pendiente' then raise exception 'Esta orden ya está resuelta'; end if;
  perform 1 from public.empresas where id in (o.ordenante_id, o.beneficiario_id, 5) order by id for update;
  if public._saldo(o.ordenante_id) < o.importe + o.comision then raise exception 'El ordenante no tiene saldo suficiente'; end if;
  select corto into v_ord from public.empresas where id = o.ordenante_id;
  select corto into v_ben from public.empresas where id = o.beneficiario_id;
  v_just := public._numero('JB', 5::smallint);
  perform public._movimiento(o.ordenante_id, o.concepto || ' a ' || v_ben, -o.importe, v_just);
  perform public._movimiento(o.beneficiario_id, replace(o.concepto, 'Pago', 'Cobro') || ' de ' || v_ord, o.importe, v_just);
  if o.comision > 0 then
    perform public._movimiento(o.ordenante_id, 'Comisión por transferencia ' || o.num, -o.comision, v_just);
    perform public._movimiento(5::smallint, 'Ingreso por comisión de transferencia ' || o.num, o.comision, v_just);
  end if;
  update public.ordenes_pago set estado = 'ejecutada', justificante = v_just, ejecuto_id = yo.id, ejecuto_nombre = yo.nombre, fecha_ejecucion = public.hoy() where id = p_orden;
  perform public._avanzar(o.pedido_id, 'pagado', 'Transferencia ejecutada. Justificante ' || v_just, yo);
  return v_just;
end $$;

create function public.denegar_orden(p_orden bigint, p_motivo text) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); o public.ordenes_pago; p public.pedidos;
begin
  if yo.empresa_id <> 5 then raise exception 'Solo el banco deniega las órdenes' using errcode = '42501'; end if;
  if length(trim(coalesce(p_motivo,''))) = 0 then raise exception 'Indica el motivo de la denegación'; end if;
  select * into o from public.ordenes_pago where id = p_orden for update;
  if not found then raise exception 'La orden no existe'; end if;
  p := public._pedido(o.pedido_id);
  if o.estado <> 'pendiente' then raise exception 'Esta orden ya está resuelta'; end if;
  update public.ordenes_pago set estado = 'denegada', motivo_denegacion = trim(p_motivo), ejecuto_id = yo.id, ejecuto_nombre = yo.nombre, fecha_ejecucion = public.hoy() where id = p_orden;
  perform public._avanzar(o.pedido_id, 'orden_denegada', 'Orden denegada por el banco: ' || trim(p_motivo), yo);
end $$;

create function public.reordenar(p_id bigint) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id);
begin
  if yo.empresa_id <> p.comprador_id then raise exception 'Solo el comprador ordena el pago' using errcode = '42501'; end if;
  if p.etapa <> 'orden_denegada' then raise exception 'Este pedido no tiene una orden denegada'; end if;
  perform public._avanzar(p_id, 'factura_aceptada', 'Se prepara una nueva orden tras la denegación', yo);
end $$;

-- Protocolo de bloqueo
create function public.comunicar_bloqueo(p_id bigint) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); p public.pedidos := public._pedido(p_id); v_lim date := public.plazo_limite(p);
begin
  if yo.empresa_id <> p.comprador_id then raise exception 'Solo el equipo afectado comunica el bloqueo' using errcode = '42501'; end if;
  if v_lim is null or public.hoy() <= v_lim then raise exception 'Este plazo no ha vencido'; end if;
  if exists (select 1 from public.bloqueos where pedido_id = p_id and etapa = p.etapa and etapa_desde = p.etapa_desde) then raise exception 'El bloqueo ya está comunicado'; end if;
  insert into public.bloqueos (pedido_id, etapa, etapa_desde, comunicado_por, comunicado_nombre, comunicado_fecha) values (p_id, p.etapa, p.etapa_desde, yo.id, yo.nombre, public.hoy());
  insert into public.historial (pedido_id, texto, quien_id, quien_nombre, fecha) values (p_id, 'Bloqueo comunicado a la profesora', yo.id, yo.nombre, public.hoy());
end $$;

create function public.registrar_incumplimiento(p_id bigint) returns void language plpgsql security definer set search_path = '' as $$
declare p public.pedidos := public._pedido(p_id); v_lim date := public.plazo_limite(p); v_texto text;
begin
  if not public.es_profesora() then raise exception 'Solo la profesora registra incumplimientos' using errcode = '42501'; end if;
  if v_lim is null or public.hoy() <= v_lim then raise exception 'Este plazo no ha vencido'; end if;
  if exists (select 1 from public.bloqueos where pedido_id = p_id and etapa = p.etapa and etapa_desde = p.etapa_desde and registrado) then raise exception 'Este incumplimiento ya está registrado'; end if;
  v_texto := case p.etapa when 'pedido_enviado' then 'No respondió al pedido ' when 'pedido_aceptado' then 'No entregó la mercancía del pedido ' else 'No corrigió la factura del pedido ' end || p.num;
  insert into public.bloqueos (pedido_id, etapa, etapa_desde, registrado) values (p_id, p.etapa, p.etapa_desde, true)
    on conflict (pedido_id, etapa, etapa_desde) do update set registrado = true;
  insert into public.incumplimientos (pedido_id, responsable_id, afectada_id, texto, fecha, registrado_por) values (p_id, p.vendedor_id, p.comprador_id, v_texto, public.hoy(), auth.uid());
  insert into public.historial (pedido_id, texto, quien_nombre, fecha) values (p_id, 'La profesora registra un incumplimiento: ' || v_texto, 'Profesora', public.hoy());
end $$;

-- Banco
create function public.publicar_comision(p_comision numeric) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); v_ant numeric;
begin
  if yo.empresa_id <> 5 then raise exception 'Solo el banco publica sus condiciones' using errcode = '42501'; end if;
  if p_comision is null or p_comision < 0 then raise exception 'La comisión no puede ser negativa'; end if;
  select comision_transferencia into v_ant from public.condiciones_banco order by vigente_desde desc, id desc limit 1;
  insert into public.condiciones_banco (comision_transferencia, publicada_por) values (round(p_comision, 2), yo.id);
  perform public._registrar(5::smallint, 'condiciones', 'comisión por transferencia', v_ant::text, round(p_comision, 2)::text);
end $$;

create function public.puntear_movimiento(p_mov bigint, p_valor boolean) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor();
begin
  update public.movimientos_banco set punteado = coalesce(p_valor, false) where id = p_mov and empresa_id = yo.empresa_id;
  if not found then raise exception 'Ese movimiento no es de tu cuenta' using errcode = '42501'; end if;
end $$;

-- RLS: lectura por política, escritura solo mediante funciones
alter table public.ajustes_demo enable row level security;
alter table public.contadores enable row level security;
alter table public.pedidos enable row level security;
alter table public.pedido_lineas enable row level security;
alter table public.albaranes enable row level security;
alter table public.facturas enable row level security;
alter table public.factura_lineas enable row level security;
alter table public.registros_contables enable row level security;
alter table public.ordenes_pago enable row level security;
alter table public.historial enable row level security;
alter table public.bloqueos enable row level security;
alter table public.incumplimientos enable row level security;
revoke all on public.ajustes_demo, public.contadores, public.pedidos, public.pedido_lineas, public.albaranes, public.facturas, public.factura_lineas, public.registros_contables, public.ordenes_pago, public.historial, public.bloqueos, public.incumplimientos from public, anon, authenticated, service_role;
grant select on public.ajustes_demo, public.pedidos, public.pedido_lineas, public.albaranes, public.facturas, public.factura_lineas, public.registros_contables, public.ordenes_pago, public.historial, public.bloqueos, public.incumplimientos to authenticated;
create policy ajustes_todos on public.ajustes_demo for select to authenticated using (public.mi_empresa() is not null or public.es_profesora());
create policy pedidos_partes on public.pedidos for select to authenticated using (public.es_profesora() or public.mi_empresa() in (comprador_id, vendedor_id));
create policy pedido_lineas_partes on public.pedido_lineas for select to authenticated using (public.es_parte_pedido(pedido_id));
create policy albaranes_partes on public.albaranes for select to authenticated using (public.es_parte_pedido(pedido_id));
create policy facturas_partes on public.facturas for select to authenticated using (public.es_parte_pedido(pedido_id));
create policy factura_lineas_partes on public.factura_lineas for select to authenticated using (exists (select 1 from public.facturas f where f.id = factura_id));
create policy registros_partes on public.registros_contables for select to authenticated using (public.es_parte_pedido(pedido_id));
create policy ordenes_visibles on public.ordenes_pago for select to authenticated using (public.es_profesora() or public.mi_empresa() in (ordenante_id, beneficiario_id, 5));
create policy historial_partes on public.historial for select to authenticated using (public.es_parte_pedido(pedido_id));
create policy bloqueos_partes on public.bloqueos for select to authenticated using (public.es_parte_pedido(pedido_id));
create policy incumplimientos_partes on public.incumplimientos for select to authenticated using (public.es_profesora() or public.mi_empresa() in (responsable_id, afectada_id));

do $$
declare f record;
begin
  for f in select oid::regprocedure as s from pg_proc where pronamespace = 'public'::regnamespace and proname = any (array['hoy','simular_fecha','es_parte_pedido','plazo_limite','_actor','_numero','_pedido','_avanzar','_saldo','_movimiento','disponible','crear_pedido','aceptar_pedido','rechazar_pedido','emitir_albaran','confirmar_recepcion','emitir_factura','aceptar_factura','rechazar_factura','marcar_registro','ordenar_pago','ejecutar_orden','denegar_orden','reordenar','comunicar_bloqueo','registrar_incumplimiento','publicar_comision','puntear_movimiento']) loop
    execute 'revoke execute on function ' || f.s || ' from public, anon, authenticated, service_role';
  end loop;
end $$;
grant execute on function public.hoy(), public.simular_fecha(date), public.es_parte_pedido(bigint), public.plazo_limite(public.pedidos), public.disponible(smallint), public.crear_pedido(smallint,jsonb,int), public.aceptar_pedido(bigint), public.rechazar_pedido(bigint,text), public.emitir_albaran(bigint), public.confirmar_recepcion(bigint), public.emitir_factura(bigint,jsonb,numeric,numeric,numeric,numeric,numeric,numeric,numeric,int), public.aceptar_factura(bigint,text[]), public.rechazar_factura(bigint,text), public.marcar_registro(bigint,text), public.ordenar_pago(bigint,boolean), public.ejecutar_orden(bigint), public.denegar_orden(bigint,text), public.reordenar(bigint), public.comunicar_bloqueo(bigint), public.registrar_incumplimiento(bigint), public.publicar_comision(numeric), public.puntear_movimiento(bigint,boolean) to authenticated;
notify pgrst, 'reload schema';
