import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const U = {
  prof: "00000000-0000-0000-0000-000000000000",
  g1: "00000000-0000-0000-0000-000000000011",
  g2: "00000000-0000-0000-0000-000000000021",
  g3: "00000000-0000-0000-0000-000000000031",
  g5: "00000000-0000-0000-0000-000000000051",
};
const LISTA = ["numeracion", "partes", "descripcion", "unidades", "descuentos", "base", "iva", "total", "pago"];
let db: PGlite;

async function acto<T = Record<string, unknown>>(id: string, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [id]);
    await db.exec("set local role authenticated");
    const r = (await db.query(sql, params)).rows as T[];
    await db.exec("commit");
    return r;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
const dia = (f: string) => db.query("update public.ajustes_demo set permitido = true, fecha_simulada = $1", [f]);
const saldo = async (g: number) => Number((await db.query<{ s: string }>("select saldo s from public.movimientos_banco where empresa_id = $1 order by id desc limit 1", [g])).rows[0]?.s ?? 0);
const etapa = async (p: number) => (await db.query<{ e: string }>("select etapa e from public.pedidos where id = $1", [p])).rows[0].e;
const deuda = async (id: number) => (await db.query<{ estado: string; pendiente: string; importe: string; vencimiento: string }>("select * from public.deudas where id = $1", [id])).rows[0];

// Compra de planchas del G2 al G1 hasta la factura aceptada, con IVA del 21 %
async function facturaAceptada(unidades: number) {
  const { rows } = await db.query<{ id: string }>("select id from public.catalogo where empresa_id = 1 and nombre = 'Planchas de acero 1 mm' and activo");
  const [r] = await acto<{ id: string }>(U.g2, "select public.crear_pedido(1::smallint, $1::jsonb, 1, true) id", [JSON.stringify([{ catalogo_id: rows[0].id, unidades }])]);
  const p = Number(r.id);
  await acto(U.g1, "select public.aceptar_pedido($1)", [p]);
  await db.exec("update public.pedidos set entrega_fecha = public.hoy() where etapa = 'pedido_aceptado'");
  await acto(U.g1, "select public.emitir_albaran($1)", [p]);
  await acto(U.g2, "select public.confirmar_recepcion($1)", [p]);
  const ls = (await db.query<{ id: string; unidades: string; precio: string }>("select id, unidades, precio from public.pedido_lineas where pedido_id = $1", [p])).rows;
  await acto(U.g1, "select public.emitir_factura($1, $2::jsonb, 0, 0, 0, 0, 0, 21, 0, 15)", [p, JSON.stringify(ls.map((l) => ({ linea_id: Number(l.id), unidades: Number(l.unidades), precio: Number(l.precio) })))]);
  await acto(U.g2, "select public.aceptar_factura($1, $2)", [p, LISTA]);
  return p;
}
const marcar = async (p: number) => {
  await acto(U.g2, "select public.marcar_registro($1, 'borrador')", [p]);
  await acto(U.g2, "select public.marcar_registro($1, 'diario')", [p]);
};
const proponer = async (u: string, p: number, dias = 10) => Number((await acto<{ id: string }>(u, "select public.proponer_deuda($1, $2) id", [p, dias]))[0].id);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync("tests/auth-stub.sql", "utf8"));
  const dir = "supabase/migrations";
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(dir + "/" + f, "utf8"));
  await db.exec(readFileSync("supabase/seed.sql", "utf8"));
  for (const [k, id] of Object.entries(U)) {
    await db.query("insert into auth.users values ($1)", [id]);
    await db.query("insert into public.perfiles (id, usuario, nombre, rol, empresa_id) values ($1,$2,$3,$4,$5)", [id, k, "Alumno " + k, k === "prof" ? "profesora" : "alumno", k === "prof" ? null : Number(k[1])]);
  }
  await dia("2026-11-09");
}, 60000);

describe("dejarlo a deber", () => {
  let p = 0;
  let d = 0;
  it("hace falta una factura aceptada y un vencimiento de 5 a 30 días", async () => {
    p = await facturaAceptada(100); // 100 × 12 = 1.200 + 21 % = 1.452,00 €
    await expect(acto(U.g2, "select public.proponer_deuda($1, 40)", [p])).rejects.toThrow(/5 a 30/);
    await expect(acto(U.g3, "select public.proponer_deuda($1, 10)", [p])).rejects.toThrow(/partes/);
    d = await proponer(U.g2, p);
    expect((await deuda(d)).estado).toBe("propuesta");
    expect(await etapa(p)).toBe("factura_aceptada");
  });
  it("quien la propone no puede aceptarla: responde la otra parte", async () => {
    await expect(acto(U.g2, "select public.responder_deuda($1, true)", [d])).rejects.toThrow(/otra parte/);
    await expect(acto(U.g1, "select public.responder_deuda($1, false, 'Porque no')", [d])).rejects.toThrow(/motivos/);
    await acto(U.g1, "select public.responder_deuda($1, true)", [d]);
    const x = await deuda(d);
    expect(x.estado).toBe("vigente");
    expect(Number(x.pendiente)).toBe(1452);
    expect(x.vencimiento).toBeTruthy();
    expect(await etapa(p)).toBe("a_deber");
  });
  it("no se mueve dinero hasta que se paga, y sin borrador y diario no se paga", async () => {
    await expect(acto(U.g2, "select public.pagar_deuda($1, 100)", [d])).rejects.toThrow(/borrador/);
    await marcar(p);
    await expect(acto(U.g1, "select public.pagar_deuda($1, 100)", [d])).rejects.toThrow(/Solo paga quien debe/);
    await expect(acto(U.g2, "select public.pagar_deuda($1, 5000)", [d])).rejects.toThrow(/más de lo que queda/);
  });
  it("se puede pagar por partes", async () => {
    const antes = await saldo(1);
    await acto(U.g2, "select public.pagar_deuda($1, 452)", [d]);
    expect(await saldo(1)).toBe(antes + 452);
    expect(Number((await deuda(d)).pendiente)).toBe(1000);
    expect(await etapa(p)).toBe("a_deber");
  });
  it("mientras se debe, un descuento fuera de factura reduce la deuda", async () => {
    await acto(U.g1, "select public.emitir_rectificativa($1, 'comercial', null, 100)", [p]); // 100 + 21 = 121
    await expect(acto(U.g2, "select public.pagar_deuda($1, 10)", [d])).rejects.toThrow(/rectificativa pendiente/);
    await acto(U.g2, "select public.aceptar_rectificativa($1)", [p]);
    expect(Number((await deuda(d)).pendiente)).toBe(879);
  });
  it("al pagar lo último, la operación queda pagada", async () => {
    await acto(U.g2, "select public.pagar_deuda($1, 879)", [d]);
    expect((await deuda(d)).estado).toBe("saldada");
    expect(await etapa(p)).toBe("pagado");
  });
  it("un descuento después del pago deja al vendedor debiendo al cliente", async () => {
    await expect(acto(U.g1, "select public.emitir_rectificativa($1, 'devolucion', $2::jsonb, null)", [p, "[]"])).rejects.toThrow(/antes del pago/);
    await acto(U.g1, "select public.emitir_rectificativa($1, 'rappel', null, 100)", [p]);
    await acto(U.g2, "select public.aceptar_rectificativa($1)", [p]);
    const { rows } = await db.query<{ id: string; deudor_id: number; acreedor_id: number; pendiente: string; estado: string }>("select * from public.deudas where pedido_id = $1 and origen = 'abono'", [p]);
    expect(rows[0].deudor_id).toBe(1);
    expect(rows[0].acreedor_id).toBe(2);
    expect(Number(rows[0].pendiente)).toBe(121);
    const antes = await saldo(2);
    await acto(U.g1, "select public.pagar_deuda($1, 121)", [rows[0].id]);
    expect(await saldo(2)).toBe(antes + 121);
  });
  it("una rectificativa no puede superar lo que queda de la factura", async () => {
    await expect(acto(U.g1, "select public.emitir_rectificativa($1, 'rappel', null, 5000)", [p])).rejects.toThrow(/no puede superar/);
  });
  it("si el descuento supera lo que se debe, la deuda se salda y la diferencia es un abono", async () => {
    const q = await facturaAceptada(10); // 145,20 €
    const x = await proponer(U.g1, q);
    await acto(U.g2, "select public.responder_deuda($1, true)", [x]);
    await marcar(q);
    await acto(U.g2, "select public.pagar_deuda($1, 140)", [x]);
    await acto(U.g1, "select public.emitir_rectificativa($1, 'rappel', null, 10)", [q]); // 12,10 sobre 5,20 pendientes
    await acto(U.g2, "select public.aceptar_rectificativa($1)", [q]);
    expect((await deuda(x)).estado).toBe("saldada");
    expect(await etapa(q)).toBe("pagado");
    const { rows } = await db.query<{ pendiente: string }>("select pendiente from public.deudas where pedido_id = $1 and origen = 'abono'", [q]);
    expect(Number(rows[0].pendiente)).toBe(6.9);
  });
  it("una factura a deber no se paga por el camino normal", async () => {
    const q = await facturaAceptada(1);
    const x = await proponer(U.g2, q);
    await acto(U.g1, "select public.responder_deuda($1, true)", [x]);
    await marcar(q);
    await expect(acto(U.g2, "select public.ordenar_pago($1)", [q])).rejects.toThrow(/no está pendiente de pago/);
  });
  it("rechazada, sigue pendiente de pago normal", async () => {
    const q = await facturaAceptada(1);
    const x = await proponer(U.g2, q);
    await acto(U.g1, "select public.responder_deuda($1, false, 'Riesgo excesivo')", [x]);
    expect((await deuda(x)).estado).toBe("rechazada");
    expect(await etapa(q)).toBe("factura_aceptada");
    await marcar(q);
    await acto(U.g2, "select public.ordenar_pago($1)", [q]);
    expect(await etapa(q)).toBe("pagado");
  });
  it("otros grupos y el banco no ven la deuda", async () => {
    expect(await acto(U.g3, "select id from public.deudas")).toHaveLength(0);
    expect(await acto(U.g5, "select id from public.deudas")).toHaveLength(0);
    expect((await acto(U.prof, "select id from public.deudas")).length).toBeGreaterThan(0);
    await expect(acto(U.g2, "insert into public.deudas (num) values ('x')")).rejects.toThrow();
  });
  it("el impago se comunica al vencer, y la profesora lo registra contra el deudor", async () => {
    const q = await facturaAceptada(1);
    const x = await proponer(U.g2, q, 5);
    await acto(U.g1, "select public.responder_deuda($1, true)", [x]);
    await expect(acto(U.g1, "select public.comunicar_impago($1)", [x])).rejects.toThrow(/no ha vencido/);
    await dia("2026-11-20");
    await expect(acto(U.g2, "select public.comunicar_impago($1)", [x])).rejects.toThrow(/acreedor/);
    await acto(U.g1, "select public.comunicar_impago($1)", [x]);
    await acto(U.prof, "select public.registrar_impago($1)", [x]);
    const { rows } = await db.query<{ responsable_id: number; afectada_id: number }>("select responsable_id, afectada_id from public.incumplimientos where deuda_id = $1", [x]);
    expect(rows[0]).toEqual({ responsable_id: 2, afectada_id: 1 });
    await acto(U.g1, "select public.aplazar_deuda($1, 10)", [x]);
    expect(new Date((await deuda(x)).vencimiento).getTime()).toBeGreaterThan(new Date("2026-11-20").getTime());
    await dia("2026-11-09");
  });
  it("el Estado no admite deudas", async () => {
    const { rows } = await db.query<{ id: string }>("select id from public.catalogo where empresa_id = 7 limit 1");
    const [r] = await acto<{ id: string }>(U.g1, "select public.crear_pedido(7::smallint, $1::jsonb, 1, true) id", [JSON.stringify([{ catalogo_id: rows[0].id, unidades: 1 }])]);
    await db.query("update public.pedidos set etapa = 'factura_aceptada' where id = $1", [r.id]);
    await expect(acto(U.g1, "select public.proponer_deuda($1, 10)", [r.id])).rejects.toThrow(/Estado/);
    await db.query("update public.pedidos set etapa = 'pedido_rechazado' where id = $1", [r.id]);
  });
});

describe("rappel por volumen mensual", () => {
  const mes = "2026-12-01";
  const volumen = async (u = U.g1) => (await acto<Record<string, string>>(u, "select * from public.volumen_cliente(1::smallint, 2::smallint, $1)", [mes]))[0];
  it("solo el propio proveedor publica tramos, y los ven todos", async () => {
    await dia("2026-12-07");
    await expect(acto(U.g5, "select public.guardar_tramo_rappel(null, 1000, 2)")).rejects.toThrow(/banco/);
    await acto(U.g1, "select public.guardar_tramo_rappel(null, 1000, 2)");
    await acto(U.g1, "select public.guardar_tramo_rappel(null, 3000, 5)");
    expect(await acto(U.g3, "select id from public.rappel_tramos where vendedor_id = 1")).toHaveLength(2);
    expect(Number((await volumen()).volumen)).toBe(0);
  });
  it("por debajo del tramo no hay rappel y se ve cuánto falta", async () => {
    await facturaAceptada(50); // 600 de base
    const v = await volumen();
    expect(Number(v.volumen)).toBe(600);
    expect(Number(v.por_emitir)).toBe(0);
    expect(Number(v.siguiente_volumen)).toBe(1000);
    expect(Number(v.siguiente_porcentaje)).toBe(2);
    await expect(acto(U.g3, "select * from public.volumen_cliente(1::smallint, 2::smallint, $1)", [mes])).rejects.toThrow(/No puedes/);
  });
  let d = 0;
  let p = 0;
  it("al llegar al tramo se emite el rappel sobre lo facturado en el mes y reduce la deuda", async () => {
    p = await facturaAceptada(100); // otros 1.200: 1.800 de volumen
    d = await proponer(U.g2, p);
    await acto(U.g1, "select public.responder_deuda($1, true)", [d]);
    const v = await volumen();
    expect(Number(v.volumen)).toBe(1800);
    expect(Number(v.porcentaje)).toBe(2);
    expect(Number(v.por_emitir)).toBe(36);
    await expect(acto(U.g2, "select public.emitir_rappel_volumen($1, $2)", [p, mes])).rejects.toThrow(/proveedor/);
    await acto(U.g1, "select public.emitir_rappel_volumen($1, $2)", [p, mes]);
    await acto(U.g2, "select public.aceptar_rectificativa($1)", [p]);
    expect(Number((await deuda(d)).pendiente)).toBe(1452 - 43.56); // 36 + 21 % de IVA
  });
  it("no se puede emitir dos veces lo mismo, solo la diferencia si sube el volumen", async () => {
    expect(Number((await volumen()).por_emitir)).toBe(0);
    await expect(acto(U.g1, "select public.emitir_rappel_volumen($1, $2)", [p, mes])).rejects.toThrow(/no tiene rappel pendiente/);
    await facturaAceptada(100); // 3.000 de volumen: tramo del 5 %, 150 de rappel
    const v = await volumen();
    expect(Number(v.porcentaje)).toBe(5);
    expect(Number(v.por_emitir)).toBe(114);
  });
  it("un tramo pactado con un cliente sustituye a los generales", async () => {
    await acto(U.g1, "select public.guardar_tramo_rappel(2::smallint, 500, 1)");
    expect(Number((await volumen()).porcentaje)).toBe(1);
    expect(await acto(U.g3, "select id from public.rappel_tramos where comprador_id = 2")).toHaveLength(0);
  });
});
