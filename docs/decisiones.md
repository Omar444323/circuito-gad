# Decisiones de Circuito GAD

Decisiones tomadas donde el documento y el prototipo no coincidían o el documento era ambiguo.

1. **Sector y actividad.** En el prototipo, "Actividad" modifica el sector, pero el sector no se puede cambiar. Son dos campos: `sector` fijo y `actividad` editable.
2. **Decimales del PMP.** El prototipo muestra 2 y el documento pide 4. Se usan 4 (`lib/formato.ts`).
3. **Recetas.** El prototipo solo admite enteros desde 1; el documento, cualquier cantidad mayor que 0. Se admiten decimales.
4. **Vencimiento de facturas (fase 2).** El prototipo lo cuenta en días naturales y el documento dice que todos los plazos son lectivos. Se usarán días lectivos. A confirmar con la profesora.
5. **Plazos de vencimiento (fase 2).** El prototipo ofrece valores fijos y el documento de 5 a 30 días. Se admitirá cualquier valor del rango.
6. **Perfiles de otros equipos.** Las normas no los incluyen entre los datos visibles, así que solo los ve el propio equipo y la profesora. Los documentos copiarán el nombre de quien firma.
7. **Permisos.** Ningún rol de cliente escribe en las tablas: solo funciones `security definer` con `search_path` vacío.
