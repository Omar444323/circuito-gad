import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { calcularFactura } from "../lib/calculo";

const U = {
  prof: "00000000-0000-0000-0000-000000000000",
  g1: "00000000-0000-0000-0000-000000000011",
  g2: "00000000-0000-0000-0000-000000000021",
  g2b: "00000000-0000-0000-0000-000000000022",
  g3: "00000000-0000-0000-0000-000000000031",
  g4: "00000000-0000-0000-0000-000000000041",
  g5: "00000000-0000-0000-0000-000000000051",
  g6: "00000000-0000-0000-0000-000000000061",
};
const LISTA = ["numeracion", "partes", "descripcion", "unidades", "descuentos", "base", "iva", "total", "pago"];
let db: PGlite;

// Actúa como un usuario real (rol authenticated); si falla, deshace y lanza el error
async function acto(id: string, sql: string, params: unknown[] = []): Promise<Record<string, any>[]> {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [id]);
    await db.exec("set local role authenticated");
    const r = (await db.query(sql, params)).rows as Record<string, any>[];
    await db.exec("commit");
    return r;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
const dia = (f: string) => db.query("update public.ajustes_demo set permitido = true, fecha_simulada = $1", [f]);
const saldo = async (g: number) => Number((await db.query<{ s: string }>("select saldo s from public.movimientos_banco where empresa_id = $1 order by id desc limit 1", [g])).rows[0].s);
const etapa = async (p: number) => (await db.query<{ e: string }>("select etapa e from public.pedidos where id = $1", [p])).rows[0].e;
async function catalogo(g: number, nombre: string) {
  return (await db.query<{ id: string }>("select id from public.catalogo where empresa_id = $1 and nombre = $2", [g, nombre])).rows[0].id;
}
async function pedir(u: string, vendedor: number, lineas: [string, number][], dias: number | null) {
  const ls = await Promise.all(lineas.map(async ([n, unidades]) => ({ catalogo_id: await catalogo(vendedor, n), unidades })));
  const [r] = await acto(u, "select public.crear_pedido($1::smallint, $2::jsonb, $3) id", [vendedor, JSON.stringify(ls), dias]);
  return Number(r.id);
}
async function facturar(u: string, p: number, o: { dto?: number; portes?: number; iva?: number; ret?: number; venc?: number } = {}) {
  const ls = (await db.query<{ id: string; unidades: string; precio: string }>("select id, unidades, precio from public.pedido_lineas where pedido_id = $1 order by id", [p])).rows;
  const lineas = ls.map((l) => ({ linea_id: Number(l.id), unidades: Number(l.unidades), precio: Number(l.precio) }));
  return acto(u, "select public.emitir_factura($1, $2::jsonb, $3, 0, 0, $4, 0, $5, $6, $7)", [p, JSON.stringify(lineas), o.dto ?? 0, o.portes ?? 0, o.iva ?? 21, o.ret ?? 0, o.venc ?? 15]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync("tests/auth-stub.sql", "utf8"));
  const dir = "supabase/migrations";
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(dir + "/" + f, "utf8"));
  await db.exec(readFileSync("supabase/seed.sql", "utf8"));
  const alta = "insert into public.perfiles (id, usuario, nombre, rol, empresa_id) values ($1,$2,$3,$4,$5)";
  for (const [k, id] of Object.entries(U)) {
    await db.query("insert into auth.users values ($1)", [id]);
    await db.query(alta, [id, k, "Alumno " + k, k === "prof" ? "profesora" : "alumno", k === "prof" ? null : Number(k[1])]);
  }
}, 60000);

describe("cálculo de la factura", () => {
  it("factura del G1 al G2: base 4.980,00 y total 6.025,80", () => {
    const c = calcularFactura([{ unidades: 400, precio: 12 }, { unidades: 100, precio: 4 }], { dto: 5, portes: 40, iva: 21 });
    expect(c.base).toBe(4980);
    expect(c.total).toBe(6025.8);
  });
  it("los descuentos se aplican en cascada y la retención al final", () => {
    const c = calcularFactura([{ unidades: 1, precio: 1000 }], { dto: 10, rappel: 10, pronto_pago: 10, iva: 21, retencion: 15 });
    expect(c.neto).toBe(729);
    expect(c.total).toBe(772.74);
  });
});

describe("simulación de fecha", () => {
  it("no funciona mientras el entorno no la permita", async () => {
    await expect(acto(U.prof, "select public.simular_fecha('2026-12-01')")).rejects.toThrow(/no está disponible/);
    await dia("2026-11-09");
    await expect(acto(U.g1, "select public.simular_fecha('2026-12-01')")).rejects.toThrow(/Solo la profesora/);
    expect(await acto(U.prof, "select public.simular_fecha('2026-11-09')")).toHaveLength(1);
  });
});

describe("recorrido completo: G2 compra al G1 y paga por el banco", () => {
  let p = 0;
  let orden = 0;
  it("el pedido copia el precio y lo ven solo las dos empresas y la profesora", async () => {
    await dia("2026-11-09");
    p = await pedir(U.g2, 1, [["Planchas de acero 1 mm", 400], ["Tornillería M6 (caja 100 uds)", 100]], 2);
    const [ped] = await acto(U.g1, "select num, elaboro_nombre from public.pedidos where id = $1", [p]);
    expect(ped.num).toBe("P2-0001");
    expect(ped.elaboro_nombre).toBe("Alumno g2");
    expect(await acto(U.g1, "select * from public.pedido_lineas where pedido_id = $1 and precio = 12", [p])).toHaveLength(1);
    expect(await acto(U.g3, "select * from public.pedidos where id = $1", [p])).toHaveLength(0);
    expect(await acto(U.g3, "select * from public.pedido_lineas where pedido_id = $1", [p])).toHaveLength(0);
    expect(await acto(U.g5, "select * from public.pedidos where id = $1", [p])).toHaveLength(0);
    expect(await acto(U.prof, "select * from public.pedidos where id = $1", [p])).toHaveLength(1);
  });
  it("solo el proveedor responde, y la entrega se pacta en días lectivos", async () => {
    await expect(acto(U.g3, "select public.aceptar_pedido($1)", [p])).rejects.toThrow(/Solo el proveedor/);
    await expect(acto(U.g2, "select public.aceptar_pedido($1)", [p])).rejects.toThrow(/Solo el proveedor/);
    await expect(acto(U.prof, "select public.aceptar_pedido($1)", [p])).rejects.toThrow(/no actúa en nombre/);
    await acto(U.g1, "select public.aceptar_pedido($1)", [p]);
    expect(await etapa(p)).toBe("pedido_aceptado");
    const [r] = await acto(U.g2, "select entrega_fecha::text f, public.plazo_limite(pedidos)::text l from public.pedidos where id = $1", [p]);
    expect(r.f).toBe("2026-11-11");
    expect(r.l).toBe("2026-11-11");
  });
  it("el albarán no se emite antes de la fecha pactada", async () => {
    await expect(acto(U.g1, "select public.emitir_albaran($1)", [p])).rejects.toThrow(/fecha pactada/);
    await dia("2026-11-11");
    await expect(acto(U.g2, "select public.emitir_albaran($1)", [p])).rejects.toThrow(/Solo el proveedor/);
    await acto(U.g1, "select public.emitir_albaran($1)", [p]);
    await expect(acto(U.g1, "select public.confirmar_recepcion($1)", [p])).rejects.toThrow(/Solo el comprador/);
    await acto(U.g2b, "select public.confirmar_recepcion($1)", [p]);
    const [a] = await acto(U.g1, "select num, retrasado, reviso_nombre from public.albaranes where pedido_id = $1", [p]);
    expect(a.num).toBe("A1-0001");
    expect(a.retrasado).toBe(false);
    expect(a.reviso_nombre).toBe("Alumno g2b");
  });
  it("la factura rechazada se conserva y la corregida mantiene el número", async () => {
    await expect(facturar(U.g1, p, { iva: 7 })).rejects.toThrow(/IVA/);
    await expect(facturar(U.g1, p, { ret: 15 })).rejects.toThrow(/solo se aplica/);
    await expect(facturar(U.g1, p, { venc: 3 })).rejects.toThrow(/vencimiento/);
    await facturar(U.g1, p, { dto: 5, portes: 40, iva: 10 });
    await expect(acto(U.g2, "select public.rechazar_factura($1, '  ')", [p])).rejects.toThrow(/motivo/);
    await acto(U.g2, "select public.rechazar_factura($1, 'IVA incorrecto')", [p]);
    expect(await etapa(p)).toBe("factura_rechazada");
    await facturar(U.g1, p, { dto: 5, portes: 40, iva: 21 });
    const fs = await acto(U.g2, "select num, version, estado, base, total from public.facturas where pedido_id = $1 order by version", [p]);
    expect(fs.map((f) => [f.num, f.version, f.estado])).toEqual([["F1-0001", 1, "rechazada"], ["F1-0001", 2, "emitida"]]);
    expect(Number(fs[1].base)).toBe(4980);
    expect(Number(fs[1].total)).toBe(6025.8);
  });
  it("el receptor marca toda la lista antes de aceptar, y nadie más ve la factura", async () => {
    expect(await acto(U.g3, "select * from public.facturas where pedido_id = $1", [p])).toHaveLength(0);
    expect(await acto(U.g3, "select * from public.factura_lineas")).toHaveLength(0);
    expect(await acto(U.g5, "select * from public.facturas where pedido_id = $1", [p])).toHaveLength(0);
    await expect(acto(U.g2, "select public.aceptar_factura($1, $2)", [p, LISTA.slice(1)])).rejects.toThrow(/lista de comprobación/);
    await expect(acto(U.g1, "select public.aceptar_factura($1, $2)", [p, LISTA])).rejects.toThrow(/Solo el receptor/);
    await acto(U.g2, "select public.aceptar_factura($1, $2)", [p, LISTA]);
    expect(await etapa(p)).toBe("factura_aceptada");
  });
  it("sin borrador y diario del comprador no se ordena el pago", async () => {
    await expect(acto(U.g2, "select public.ordenar_pago($1, true)", [p])).rejects.toThrow(/borrador manual/);
    await expect(acto(U.g2, "select public.marcar_registro($1, 'diario')", [p])).rejects.toThrow(/Primero va el borrador/);
    await expect(acto(U.g3, "select public.marcar_registro($1, 'borrador')", [p])).rejects.toThrow(/no es de tu empresa/);
    await acto(U.g1, "select public.marcar_registro($1, 'borrador')", [p]);
    await acto(U.g1, "select public.marcar_registro($1, 'diario')", [p]);
    await expect(acto(U.g2, "select public.ordenar_pago($1, true)", [p])).rejects.toThrow(/borrador manual/);
    await acto(U.g2, "select public.marcar_registro($1, 'borrador')", [p]);
    await acto(U.g2b, "select public.marcar_registro($1, 'diario')", [p]);
  });
  it("si supera el 20 % de la tesorería hay que confirmar la comprobación", async () => {
    await expect(acto(U.g2, "select public.ordenar_pago($1, false)", [p])).rejects.toThrow(/20 %/);
    const [r] = await acto(U.g2, "select public.ordenar_pago($1, true) id", [p]);
    orden = Number(r.id);
    const [d] = await acto(U.g2, "select public.disponible(2::smallint) d");
    expect(Number(d.d)).toBe(27000 - 6025.8 - 1.5);
    expect(await saldo(2)).toBe(27000);
  });
  it("el banco ve la orden; una empresa ajena, no", async () => {
    const [o] = await acto(U.g5, "select num, concepto, importe, comision from public.ordenes_pago where id = $1", [orden]);
    expect(o.num).toBe("OP2-0001");
    expect(o.concepto).toBe("Pago factura F1-0001");
    expect(Number(o.comision)).toBe(1.5);
    expect(await acto(U.g3, "select * from public.ordenes_pago")).toHaveLength(0);
    expect(await acto(U.g1, "select * from public.ordenes_pago where id = $1", [orden])).toHaveLength(1);
    await expect(acto(U.g3, "select public.disponible(2::smallint)")).rejects.toThrow(/otra cuenta/);
    await expect(acto(U.g2, "select public.ejecutar_orden($1)", [orden])).rejects.toThrow(/Solo el banco/);
  });
  it("al ejecutar: cargo, abono, comisión y un mismo justificante", async () => {
    const [r] = await acto(U.g5, "select public.ejecutar_orden($1) j", [orden]);
    expect(r.j).toBe("JB-0001");
    expect(await etapa(p)).toBe("pagado");
    expect(await saldo(2)).toBe(20972.7);
    expect(await saldo(1)).toBe(32025.8);
    expect(await saldo(5)).toBe(32001.5);
    const m = (await db.query<{ empresa_id: number; importe: string }>("select empresa_id, importe from public.movimientos_banco where justificante = 'JB-0001' order by id")).rows;
    expect(m.map((x) => [x.empresa_id, Number(x.importe)])).toEqual([[2, -6025.8], [1, 6025.8], [2, -1.5], [5, 1.5]]);
    await expect(acto(U.g5, "select public.ejecutar_orden($1)", [orden])).rejects.toThrow(/ya está resuelta/);
    expect(await acto(U.g3, "select * from public.movimientos_banco where justificante = 'JB-0001'")).toHaveLength(0);
  });
});

describe("servicios y órdenes denegadas", () => {
  it("el G4 no emite albarán, retiene IRPF y el comprador puede reordenar", async () => {
    const p = await pedir(U.g1, 4, [["Asesoría fiscal (mes)", 1]], null);
    await acto(U.g4, "select public.aceptar_pedido($1)", [p]);
    expect(await etapa(p)).toBe("recibido");
    await expect(acto(U.g4, "select public.emitir_albaran($1)", [p])).rejects.toThrow(/pendiente de entrega/);
    await facturar(U.g4, p, { iva: 21, ret: 15, venc: 0 });
    const [f] = await acto(U.g1, "select total, vencimiento_fecha::text v from public.facturas where pedido_id = $1", [p]);
    expect(Number(f.total)).toBe(318);
    expect(f.v).toBe("2026-11-11");
    await acto(U.g1, "select public.aceptar_factura($1, $2)", [p, LISTA]);
    await acto(U.g1, "select public.marcar_registro($1, 'borrador')", [p]);
    await acto(U.g1, "select public.marcar_registro($1, 'diario')", [p]);
    const [o] = await acto(U.g1, "select public.ordenar_pago($1, false) id", [p]);
    await expect(acto(U.g5, "select public.denegar_orden($1, '')", [o.id])).rejects.toThrow(/motivo/);
    await acto(U.g5, "select public.denegar_orden($1, 'Orden duplicada')", [o.id]);
    expect(await etapa(p)).toBe("orden_denegada");
    await acto(U.g1, "select public.reordenar($1)", [p]);
    const [o2] = await acto(U.g1, "select public.ordenar_pago($1, false) id", [p]);
    expect(Number(o2.id)).not.toBe(Number(o.id));
    const nums = await acto(U.g1, "select num, estado from public.ordenes_pago where pedido_id = $1 order by id", [p]);
    expect(nums.map((n) => n.num)).toEqual(["OP1-0001", "OP1-0002"]);
  });
  it("el descubierto está prohibido", async () => {
    const p = await pedir(U.g6, 3, [["Estantería metálica 5 baldas", 150], ["Carro de almacén", 80]], 1);
    await acto(U.g3, "select public.aceptar_pedido($1)", [p]);
    await dia("2026-11-12");
    await acto(U.g3, "select public.emitir_albaran($1)", [p]);
    await acto(U.g6, "select public.confirmar_recepcion($1)", [p]);
    await facturar(U.g3, p);
    await acto(U.g6, "select public.aceptar_factura($1, $2)", [p, LISTA]);
    await acto(U.g6, "select public.marcar_registro($1, 'borrador')", [p]);
    await acto(U.g6, "select public.marcar_registro($1, 'diario')", [p]);
    await expect(acto(U.g6, "select public.ordenar_pago($1, true)", [p])).rejects.toThrow(/descubierto/);
    expect(await etapa(p)).toBe("factura_aceptada");
  });
  it("solo se rechaza un pedido con los motivos de las normas", async () => {
    const p = await pedir(U.g3, 2, [["Carro de almacén", 1]], 1);
    await expect(acto(U.g2, "select public.rechazar_pedido($1, 'Porque no')", [p])).rejects.toThrow(/motivos de rechazo/);
    await acto(U.g2, "select public.rechazar_pedido($1, 'Falta de existencias')", [p]);
    expect(await etapa(p)).toBe("pedido_rechazado");
  });
  it("la entrega fuera de fecha queda marcada como retrasada", async () => {
    await dia("2026-11-12");
    const p = await pedir(U.g3, 2, [["Carro de almacén", 1]], 1);
    await acto(U.g2, "select public.aceptar_pedido($1)", [p]);
    await dia("2026-11-17");
    await acto(U.g2, "select public.emitir_albaran($1)", [p]);
    const [a] = await acto(U.g3, "select retrasado from public.albaranes where pedido_id = $1", [p]);
    expect(a.retrasado).toBe(true);
  });
});

describe("plazos y protocolo de bloqueo", () => {
  it("el afectado comunica cuando vence y la profesora registra el incumplimiento", async () => {
    await dia("2026-11-09");
    const p = await pedir(U.g3, 2, [["Carro de almacén", 2]], 1);
    await dia("2026-11-11");
    await expect(acto(U.g3, "select public.comunicar_bloqueo($1)", [p])).rejects.toThrow(/no ha vencido/);
    await dia("2026-11-12");
    await expect(acto(U.g2, "select public.comunicar_bloqueo($1)", [p])).rejects.toThrow(/equipo afectado/);
    await acto(U.g3, "select public.comunicar_bloqueo($1)", [p]);
    await expect(acto(U.g3, "select public.comunicar_bloqueo($1)", [p])).rejects.toThrow(/ya está comunicado/);
    await expect(acto(U.g3, "select public.registrar_incumplimiento($1)", [p])).rejects.toThrow(/no actúa|Solo la profesora/);
    await acto(U.prof, "select public.registrar_incumplimiento($1)", [p]);
    await expect(acto(U.prof, "select public.registrar_incumplimiento($1)", [p])).rejects.toThrow(/ya está registrado/);
    expect(await acto(U.g2, "select * from public.incumplimientos where pedido_id = $1", [p])).toHaveLength(1);
    expect(await acto(U.g3, "select * from public.incumplimientos where pedido_id = $1", [p])).toHaveLength(1);
    expect(await acto(U.g1, "select * from public.incumplimientos where pedido_id = $1", [p])).toHaveLength(0);
  });
});

describe("permisos", () => {
  it("nadie escribe directamente en las tablas del circuito", async () => {
    await expect(acto(U.g2, "update public.pedidos set etapa = 'pagado'")).rejects.toThrow(/permission denied/);
    await expect(acto(U.g5, "update public.ordenes_pago set estado = 'ejecutada'")).rejects.toThrow(/permission denied/);
    await expect(acto(U.g2, "insert into public.historial (pedido_id, texto, fecha) values (1, 'x', '2026-11-09')")).rejects.toThrow(/permission denied/);
    await expect(acto(U.g2, "select * from public.contadores")).rejects.toThrow(/permission denied/);
  });
  it("las funciones internas no se pueden llamar desde fuera", async () => {
    await expect(acto(U.g2, "select public._numero('F', 2::smallint)")).rejects.toThrow(/permission denied/);
    await expect(acto(U.g2, "select public._movimiento(2::smallint, 'x', 1000000, 'x')")).rejects.toThrow(/permission denied/);
  });
  it("solo el banco cambia la comisión, y cada empresa puntea solo lo suyo", async () => {
    await expect(acto(U.g1, "select public.publicar_comision(0)")).rejects.toThrow(/Solo el banco/);
    await acto(U.g5, "select public.publicar_comision(2)");
    const [c] = await acto(U.g1, "select comision_transferencia c from public.condiciones_banco order by vigente_desde desc, id desc limit 1");
    expect(Number(c.c)).toBe(2);
    const [m] = (await db.query<{ id: string }>("select id from public.movimientos_banco where empresa_id = 1 limit 1")).rows;
    await expect(acto(U.g3, "select public.puntear_movimiento($1, true)", [m.id])).rejects.toThrow(/no es de tu cuenta/);
    await acto(U.g1, "select public.puntear_movimiento($1, true)", [m.id]);
  });
});
