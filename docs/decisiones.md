# Decisiones de Circuito GAD

Decisiones tomadas donde el documento y el prototipo no coincidían o el documento era ambiguo.

1. **Sector y actividad.** En el prototipo, "Actividad" modifica el sector, pero el sector no se puede cambiar. Son dos campos: `sector` fijo y `actividad` editable.
2. **Decimales del PMP.** El prototipo muestra 2 y el documento pide 4. Se usan 4 (`lib/formato.ts`).
3. **Recetas.** El prototipo solo admite enteros desde 1; el documento, cualquier cantidad mayor que 0. Se admiten decimales.
4. **Vencimiento de facturas.** El prototipo lo cuenta en días naturales y el documento dice que todos los plazos son lectivos. Se usan días lectivos. A confirmar con la profesora.
5. **Plazos de vencimiento.** El prototipo ofrece valores fijos y el documento de 5 a 30 días. Se admite cualquier valor del rango, y 0 para el pago inmediato.
6. **Perfiles de otros equipos.** Las normas no los incluyen entre los datos visibles, así que solo los ve el propio equipo y la profesora. Los documentos copian el nombre de quien firma.
7. **Permisos.** Ningún rol de cliente escribe en las tablas: solo funciones `security definer` con `search_path` vacío.
8. **Cuentas iniciales.** Las claves secretas de Vercel no se pueden descargar, así que `/arranque` crea las cuentas desde el servidor. Solo funciona con la tabla `perfiles` vacía y se cierra sola. `scripts/crear-cuentas.mjs` queda como alternativa con la clave pegada a mano.
9. **Quién firma.** El prototipo tiene un selector "Quién lo hace" porque comparte cuenta. Con usuarios individuales firma la persona con sesión iniciada, y por eso no hay selector.
10. **Almacén en la fase 2.** Las existencias, el aviso al aceptar y el bloqueo del albarán por falta de stock llegan en la fase 3, junto con las rectificativas. Hasta entonces el importe de la orden es el total de la factura.
11. **Numeración entre años.** El contador es por empresa, tipo y año, y el formato pedido no incluye el año, así que en 2027 se repetirá `P1-0001`. El número no es único por sí solo: lo distingue la fecha, y cada documento tiene su `id`.
12. **Simulación de fecha.** Producción y preview comparten base de datos, así que una variable de entorno no evitaría tocar producción. `hoy()` solo usa la fecha simulada si `ajustes_demo.permitido` es verdadero, y eso se activa a mano por SQL en un proyecto de demostración. En el proyecto real queda desactivado.
13. **Plazo del proveedor.** Los tres plazos con protocolo de bloqueo (responder, entregar y corregir) son del proveedor, así que el comprador es siempre el equipo afectado. La revisión de factura no tiene plazo porque tampoco lo tiene en el prototipo.
14. **Descripción de las líneas de factura.** Quien emite puede cambiar unidades y precios, porque equivocarse forma parte del aprendizaje, pero la descripción sale del pedido.
15. **Trazabilidad del banco.** El banco solo ve órdenes y movimientos. No ve pedidos, facturas ni historial de operaciones ajenas.
