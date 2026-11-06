# Copias de seguridad

Todos los datos de la simulación están en la base de datos de Supabase. La aplicación en Vercel no guarda nada: si se perdiera, se vuelve a desplegar desde GitHub.

## Qué hace Supabase

Depende del plan del proyecto. Compruébalo en **Database > Backups** del panel de Supabase.

| Plan | Copias automáticas |
| --- | --- |
| Free | Ninguna. Supabase recomienda exportar los datos con regularidad |
| Pro | Diarias, de los últimos 7 días |
| Team | Diarias, de los últimos 14 días |
| Enterprise | Diarias, de hasta 30 días |

Restaurar una copia sustituye la base de datos y deja el proyecto sin servicio mientras dura. Se pierde lo hecho después de esa copia. Al borrar un proyecto se borran también sus copias.

Fuente: [Database Backups, documentación de Supabase](https://supabase.com/docs/guides/platform/backups), consultada el 06/11/2026.

## Qué hacer con el plan Free

Exporta una copia una vez por semana y antes de cada entrega importante. Necesitas la [CLI de Supabase](https://supabase.com/docs/reference/cli/supabase-db-dump) y la cadena de conexión que aparece en **Connect** en el panel del proyecto.

```bash
supabase db dump --db-url "CADENA_DE_CONEXION" -f esquema.sql
```

```bash
supabase db dump --db-url "CADENA_DE_CONEXION" --data-only -f datos.sql
```

Guarda los dos ficheros fuera del proyecto, por ejemplo en una carpeta privada de tu unidad. Contienen datos de los alumnos, así que no los compartas ni los subas a GitHub.

La cadena de conexión incluye la contraseña de la base de datos: no la pegues en ningún documento.

## Copia rápida sin instalar nada

En **Archivo**, como profesora, puedes descargar el libro de documentos, el extracto bancario y las fichas de almacén de cada empresa en Excel. Sirve para conservar el trabajo de los grupos, pero no para restaurar la aplicación.

## Antes de aplicar una migración

Las migraciones de `supabase/migrations` cambian la base de datos real, y las versiones de prueba de Vercel también usan esa misma base de datos. Antes de aplicar una que cambie datos, haz una copia.
