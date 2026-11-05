// Cálculo de la factura según el orden del Tema 3. Mismo cálculo que emitir_factura en la base de datos.
export type LineaCalculo = { unidades: number; precio: number };
export type OpcionesFactura = { dto?: number; rappel?: number; pronto_pago?: number; portes?: number; envases?: number; iva?: number; retencion?: number };

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function calcularFactura(lineas: LineaCalculo[], o: OpcionesFactura = {}) {
  const suma = r2(lineas.reduce((a, l) => a + l.unidades * l.precio, 0));
  const dtoImp = r2((suma * (o.dto ?? 0)) / 100);
  const rapImp = r2(((suma - dtoImp) * (o.rappel ?? 0)) / 100);
  const ppImp = r2(((suma - dtoImp - rapImp) * (o.pronto_pago ?? 0)) / 100);
  const neto = r2(suma - dtoImp - rapImp - ppImp);
  const base = r2(neto + (o.portes ?? 0) + (o.envases ?? 0));
  const cuota = r2((base * (o.iva ?? 0)) / 100);
  const retImp = r2((base * (o.retencion ?? 0)) / 100);
  return { suma, dtoImp, rapImp, ppImp, neto, base, cuota, retImp, total: r2(base + cuota - retImp) };
}
