-- Funciones de edición: validan en servidor quién actúa y registran cada cambio
create function public._puede_editar(p_empresa smallint) returns void language plpgsql stable security definer set search_path = '' as $$
begin  if not (public.es_profesora() or public.mi_empresa() = p_empresa) then    raise exception 'No puedes editar los datos de otro equipo' using errcode = '42501';
  end if;
end $$;
create function public._registrar(p_empresa smallint, p_entidad text, p_campo text, p_ant text, p_nue text) returns void language sql security definer set search_path = '' as $$
  insert into public.registro_cambios (empresa_id, entidad, campo, valor_anterior, valor_nuevo, hecho_por)  select p_empresa, p_entidad, p_campo, p_ant, p_nue, auth.uid() where p_ant is distinct from p_nue$$;
create function public.actualizar_empresa(p_empresa smallint, p_nombre text, p_actividad text) returns void language plpgsql security definer set search_path = '' as $$
declare e public.empresas;
begin  perform public._puede_editar(p_empresa);
  if length(trim(coalesce(p_nombre,''))) = 0 then raise exception 'El nombre comercial no puede quedar vacío';
 end if;
  if length(trim(coalesce(p_actividad,''))) = 0 then raise exception 'La actividad no puede quedar vacía';
 end if;
  select * into strict e from public.empresas where id = p_empresa for update;
  update public.empresas set nombre = trim(p_nombre), actividad = trim(p_actividad) where id = p_empresa;
  perform public._registrar(p_empresa, 'empresa', 'nombre', e.nombre, trim(p_nombre));
  perform public._registrar(p_empresa, 'empresa', 'actividad', e.actividad, trim(p_actividad));
end $$;
create function public.cambiar_nombre_perfil(p_perfil uuid, p_nombre text) returns void language plpgsql security definer set search_path = '' as $$
declare p public.perfiles;
begin  select * into strict p from public.perfiles where id = p_perfil for update;
  if p_perfil <> auth.uid() then    if p.empresa_id is null then raise exception 'No puedes editar este usuario' using errcode = '42501';
 end if;
    perform public._puede_editar(p.empresa_id);
  end if;
  if length(trim(coalesce(p_nombre,''))) = 0 then raise exception 'El nombre no puede quedar vacío';
 end if;
  update public.perfiles set nombre = trim(p_nombre) where id = p_perfil;
  perform public._registrar(p.empresa_id, 'integrante', 'nombre', p.nombre, trim(p_nombre));
end $$;
create function public.dar_baja_integrante(p_perfil uuid) returns void language plpgsql security definer set search_path = '' as $$
declare p public.perfiles;
begin  select * into strict p from public.perfiles where id = p_perfil for update;
  if p.empresa_id is null then raise exception 'No se puede dar de baja a la profesora';
 end if;
  perform public._puede_editar(p.empresa_id);
  perform 1 from public.perfiles where empresa_id = p.empresa_id and activo for update;
  if not exists (select 1 from public.perfiles where empresa_id = p.empresa_id and activo and id <> p_perfil) then    raise exception 'El equipo necesita al menos un integrante activo';
  end if;
  update public.perfiles set activo = false where id = p_perfil;
  perform public._registrar(p.empresa_id, 'integrante', 'baja', p.nombre, null);
end $$;
create function public.mover_alumno(p_perfil uuid, p_destino smallint) returns void language plpgsql security definer set search_path = '' as $$
declare p public.perfiles;
begin  if not public.es_profesora() then raise exception 'Solo la profesora mueve alumnos' using errcode = '42501';
 end if;
  select * into strict p from public.perfiles where id = p_perfil and rol = 'alumno' for update;
  perform 1 from public.perfiles where empresa_id = p.empresa_id and activo for update;
  if p.activo and not exists (select 1 from public.perfiles where empresa_id = p.empresa_id and activo and id <> p_perfil) then    raise exception 'El equipo necesita al menos un integrante activo';
  end if;
  update public.perfiles set empresa_id = p_destino where id = p_perfil;
  perform public._registrar(p_destino, 'integrante', 'grupo', p.empresa_id::text, p_destino::text);
end $$;
create function public.guardar_catalogo(p_empresa smallint, p_id uuid, p_nombre text, p_precio numeric) returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.catalogo;
 v_id uuid;
begin  perform public._puede_editar(p_empresa);
  if p_empresa = 5 then raise exception 'El banco publica sus comisiones en sus condiciones';
 end if;
  if length(trim(coalesce(p_nombre,''))) = 0 or coalesce(p_precio,0) <= 0 then raise exception 'Cada artículo necesita nombre y un precio mayor que cero';
 end if;
  if p_id is null then    insert into public.catalogo (empresa_id, nombre, precio) values (p_empresa, trim(p_nombre), round(p_precio,2)) returning id into v_id;
    perform public._registrar(p_empresa, 'catalogo', 'alta', null, trim(p_nombre)||' · '||round(p_precio,2)::text);
    return v_id;
  end if;
  select * into strict c from public.catalogo where id = p_id and empresa_id = p_empresa and activo for update;
  update public.catalogo set nombre = trim(p_nombre), precio = round(p_precio,2) where id = p_id;
  perform public._registrar(p_empresa, 'catalogo', 'nombre', c.nombre, trim(p_nombre));
  perform public._registrar(p_empresa, 'catalogo', 'precio de '||trim(p_nombre), c.precio::text, round(p_precio,2)::text);
  return p_id;
end $$;
create function public.quitar_catalogo(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare c public.catalogo;
begin  select * into strict c from public.catalogo where id = p_id and activo for update;
  perform public._puede_editar(c.empresa_id);
  update public.catalogo set activo = false where id = p_id;
  perform public._registrar(c.empresa_id, 'catalogo', 'baja', c.nombre, null);
end $$;
create function public.guardar_receta(p_producto uuid, p_lineas jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare v_receta uuid;
 v_ant text;
 v_nue text;
begin  perform public._puede_editar(2::smallint);
  if not exists (select 1 from public.articulos where id = p_producto and empresa_id = 2 and cuenta = 350) then raise exception 'El producto no es un producto terminado del G2';
 end if;
  if jsonb_array_length(p_lineas) = 0 then raise exception 'La receta necesita al menos una materia prima';
 end if;
  if exists (select 1 from jsonb_to_recordset(p_lineas) as x(materia_id uuid, cantidad numeric) left join public.articulos a on a.id = x.materia_id and a.empresa_id = 2 and a.cuenta = 310 where a.id is null or coalesce(x.cantidad,0) <= 0) then    raise exception 'Cada línea necesita una materia prima del G2 y una cantidad mayor que 0';
  end if;
  select id into v_receta from public.recetas where producto_id = p_producto for update;
  if v_receta is null then insert into public.recetas (producto_id) values (p_producto) returning id into v_receta;
 end if;
  select string_agg(materia_id::text||'='||cantidad::text, ', ' order by materia_id) into v_ant from public.recetas_lineas where receta_id = v_receta;
  delete from public.recetas_lineas where receta_id = v_receta;
  insert into public.recetas_lineas (receta_id, materia_id, cantidad) select v_receta, x.materia_id, x.cantidad from jsonb_to_recordset(p_lineas) as x(materia_id uuid, cantidad numeric);
  select string_agg(materia_id::text||'='||cantidad::text, ', ' order by materia_id) into v_nue from public.recetas_lineas where receta_id = v_receta;
  perform public._registrar(2::smallint, 'receta', p_producto::text, v_ant, v_nue);
end $$;
create function public.marcar_no_lectivo(p_fecha date, p_motivo text) returns void language plpgsql security definer set search_path = '' as $$
begin  if not public.es_profesora() then raise exception 'Solo la profesora edita el calendario' using errcode = '42501';
 end if;
  if length(trim(coalesce(p_motivo,''))) = 0 then raise exception 'Indica el motivo';
 end if;
  insert into public.calendario (fecha, motivo) values (p_fecha, trim(p_motivo)) on conflict (fecha) do update set motivo = excluded.motivo;
end $$;
create function public.quitar_no_lectivo(p_fecha date) returns void language plpgsql security definer set search_path = '' as $$
begin  if not public.es_profesora() then raise exception 'Solo la profesora edita el calendario' using errcode = '42501';
 end if;
  delete from public.calendario where fecha = p_fecha;
end $$;
create function public.activar_modulo(p_clave text, p_activo boolean) returns void language plpgsql security definer set search_path = '' as $$
begin  if not public.es_profesora() then raise exception 'Solo la profesora activa módulos' using errcode = '42501';
 end if;
  update public.modulos set activo = p_activo where clave = p_clave;
end $$;
create function public.es_lectivo(p_fecha date) returns boolean language sql stable security definer set search_path = '' as $$
  select extract(isodow from p_fecha) < 6 and not exists (select 1 from public.calendario where fecha = p_fecha)$$;
create function public.sumar_dias_lectivos(p_desde date, p_dias int) returns date language plpgsql stable security definer set search_path = '' as $$
declare f date := p_desde;
 n int := 0;
begin  while n < p_dias loop    f := f + 1;
    if public.es_lectivo(f) then n := n + 1;
 end if;
  end loop;
  return f;
end $$;

-- Solo el servidor (service_role) da de alta usuarios, tras comprobar quién lo pide
create function public.registrar_alta(p_id uuid, p_usuario text, p_nombre text, p_empresa smallint, p_por uuid) returns void language plpgsql security definer set search_path = '' as $$
begin  insert into public.perfiles (id, usuario, nombre, rol, empresa_id) values (p_id, p_usuario, trim(p_nombre), 'alumno', p_empresa);
  insert into public.registro_cambios (empresa_id, entidad, campo, valor_nuevo, hecho_por) values (p_empresa, 'integrante', 'alta', trim(p_nombre), p_por);
end $$;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.mi_empresa(), public.es_profesora(), public.es_lectivo(date), public.sumar_dias_lectivos(date,int), public.actualizar_empresa(smallint,text,text), public.cambiar_nombre_perfil(uuid,text), public.dar_baja_integrante(uuid), public.mover_alumno(uuid,smallint), public.guardar_catalogo(smallint,uuid,text,numeric), public.quitar_catalogo(uuid), public.guardar_receta(uuid,jsonb), public.marcar_no_lectivo(date,text), public.quitar_no_lectivo(date), public.activar_modulo(text,boolean) to authenticated;
grant execute on function public.registrar_alta(uuid,text,text,smallint,uuid) to service_role;
