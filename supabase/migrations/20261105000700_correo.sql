-- Correo entre empresas: comunicaciones formales, con asunto y respuestas.
-- Lo ven las dos empresas y la profesora. Los correos enviados no se editan ni se borran.
create table public.correos (
  id bigint generated always as identity primary key,
  hilo_id bigint references public.correos(id),
  responde_a bigint references public.correos(id),
  remitente_id smallint not null references public.empresas(id),
  destinatario_id smallint not null references public.empresas(id),
  asunto text not null check (length(asunto) between 1 and 150),
  cuerpo text not null check (length(cuerpo) between 1 and 5000),
  pedido_id bigint references public.pedidos(id),
  autor_id uuid not null references public.perfiles(id),
  autor_nombre text not null,
  enviado_en timestamptz not null default now(),
  leido_en timestamptz,
  leido_por_nombre text,
  check (remitente_id <> destinatario_id)
);
create index correos_destinatario on public.correos (destinatario_id, id desc);
create index correos_remitente on public.correos (remitente_id, id desc);
create index correos_hilo on public.correos (hilo_id, id);

create function public.enviar_correo(p_destinatario smallint, p_asunto text, p_cuerpo text, p_responde_a bigint default null, p_pedido bigint default null) returns bigint language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor(); o public.correos; v_dest smallint := p_destinatario; v_asunto text := trim(coalesce(p_asunto, '')); v_cuerpo text := trim(coalesce(p_cuerpo, '')); v_pedido bigint := p_pedido; v_hilo bigint; v_id bigint;
begin
  if p_responde_a is not null then
    select * into o from public.correos where id = p_responde_a;
    if not found or yo.empresa_id not in (o.remitente_id, o.destinatario_id) then raise exception 'Ese correo no es de tu empresa' using errcode = '42501'; end if;
    v_dest := case when o.remitente_id = yo.empresa_id then o.destinatario_id else o.remitente_id end;
    v_hilo := coalesce(o.hilo_id, o.id);
    v_pedido := o.pedido_id;
    if v_asunto = '' then v_asunto := case when o.asunto like 'Re: %' then o.asunto else left('Re: ' || o.asunto, 150) end; end if;
  end if;
  if v_dest is null or v_dest not between 1 and 6 then raise exception 'Elige la empresa destinataria'; end if;
  if v_dest = yo.empresa_id then raise exception 'No puedes enviarte un correo a tu propia empresa'; end if;
  if v_asunto = '' then raise exception 'Escribe el asunto'; end if;
  if length(v_asunto) > 150 then raise exception 'El asunto admite 150 caracteres como máximo'; end if;
  if v_cuerpo = '' then raise exception 'Escribe el mensaje'; end if;
  if length(v_cuerpo) > 5000 then raise exception 'El mensaje admite 5.000 caracteres como máximo'; end if;
  if v_pedido is not null and not exists (select 1 from public.pedidos p where p.id = v_pedido and (p.comprador_id, p.vendedor_id) in ((yo.empresa_id, v_dest), (v_dest, yo.empresa_id))) then
    raise exception 'Esa operación no es entre estas dos empresas';
  end if;
  insert into public.correos (hilo_id, responde_a, remitente_id, destinatario_id, asunto, cuerpo, pedido_id, autor_id, autor_nombre)
    values (v_hilo, p_responde_a, yo.empresa_id, v_dest, v_asunto, v_cuerpo, v_pedido, yo.id, yo.nombre) returning id into v_id;
  if v_hilo is null then update public.correos set hilo_id = v_id where id = v_id; end if;
  return v_id;
end $$;

-- Solo cuenta como leído cuando lo abre la empresa destinataria, no cuando lo abre la profesora
create function public.marcar_correo_leido(p_id bigint) returns void language plpgsql security definer set search_path = '' as $$
declare yo public.perfiles := public._actor();
begin
  update public.correos set leido_en = now(), leido_por_nombre = yo.nombre where id = p_id and destinatario_id = yo.empresa_id and leido_en is null;
end $$;

alter table public.correos enable row level security;
revoke all on public.correos from public, anon, authenticated, service_role;
grant select on public.correos to authenticated;
create policy correos_partes on public.correos for select to authenticated using (public.es_profesora() or public.mi_empresa() in (remitente_id, destinatario_id));
revoke execute on function public.enviar_correo(smallint,text,text,bigint,bigint), public.marcar_correo_leido(bigint) from public, anon, authenticated, service_role;
grant execute on function public.enviar_correo(smallint,text,text,bigint,bigint), public.marcar_correo_leido(bigint) to authenticated;
notify pgrst, 'reload schema';
