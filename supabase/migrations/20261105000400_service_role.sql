-- La clave de servidor crea perfiles (altas y cuentas iniciales); solo lee e inserta en esta tabla
grant usage on schema public to service_role;
grant select, insert on public.perfiles to service_role;
