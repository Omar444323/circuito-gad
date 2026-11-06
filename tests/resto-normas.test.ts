import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

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
const uno = async <T = string>(sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, T>>(sql, params)).rows[0])[0];
const dia = (f: string) => db.query("update public.ajustes_demo set permitido = true, fecha_simulada = $1", [f]);
const saldo = async (g: number) => Number((await db.query<{ s: string }>("select saldo s from public.movimientos_banco where empresa_id = $1 order by id desc limit 1", [g])).rows[0]?.s ?? 0);
const personal = async (u: string) => Number((await db.query<{ s: string }>("select saldo s from public.movimientos_personales where perfil_id = $1 order by id desc limit 1", [u])).rows[0]?.s ?? 0);
const etapa = (p: number) => uno("select etapa from public.pedidos where id = $1", [p]);
const modulo = (k: string, v: boolean) => db.query("update public.modulos set activo = $2 where clave = $1", [k, v]);

async function pedir(unidades = 10) {
  const id = await uno("select id from public.catalogo where empresa_id = 1 and nombre = 'Planchas de acero 1 mm' and activo");
  const [r] = await acto<{ id: string }>(U.g2, "select public.crear_pedido(1::smallint, $1::jsonb, 1, true) id", [JSON.stringify([{ catalogo_id: id, unidades }])]);
  return Number(r.id);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync("tests/auth-stub.sql", "utf8"));
  const dir = "supabase/migrations";
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(dir + "/" + f, "utf8"));
  await db.exec(readFileSync("supabase/seed.sql", "utf8"));
  for (const [k, id] of Object.entries(U)) {
    await db.query("insert into auth.users values ($1)", [id]);
    const g = k === "prof" ? null : Number(k[1]);
    await db.query("insert into public.perfiles (id, usuario, nombre, rol, empresa_id) values ($1,$2,$3,$4,$5)", [id, k, "Persona " + k, k === "prof" ? "profesora" : "alumno", g]);
  }
  await dia("2026-11-09");
}, 60000);

describe("protocolo del punto 12", () => {
  let p = 0;
  it("hay que reclamar por escrito antes de comunicar el bloqueo", async () => {
    p = await pedir();
    await dia("2026-11-12");
    await expect(acto(U.g2, "select public.comunicar_bloqueo($1)", [p])).rejects.toThrow(/por escrito/);
    await acto(U.g2, "select public.enviar_correo(1::smallint, 'Pedido sin respuesta', 'Reclamo la respuesta', null, $1)", [p]);
    await acto(U.g2, "select public.comunicar_bloqueo($1)", [p]);
  });
  it("solo la profesora interviene, y el documento sustitutorio deja incumplimiento", async () => {
    await expect(acto(U.g1, "select public.intervenir_pedido($1, 'x')", [p])).rejects.toThrow(/Solo la profesora/);
    await expect(acto(U.prof, "select public.intervenir_pedido($1, '  ')", [p])).rejects.toThrow(/motivo/);
    await acto(U.prof, "select public.intervenir_pedido($1, 'El G1 no responde')", [p]);
    expect(await etapa(p)).toBe("pedido_aceptado");
    expect(await uno("select reviso_nombre from public.pedidos where id = $1", [p])).toBe("Profesora (documento sustitutorio)");
    expect(await uno("select count(*)::int from public.incumplimientos where pedido_id = $1 and responsable_id = 1", [p])).toBe(1);
  });
  it("la sustitución termina con la función: la profesora no puede actuar después", async () => {
    await expect(acto(U.prof, "select public.emitir_albaran($1)", [p])).rejects.toThrow(/no actúa/);
  });
  it("sustituye toda la cadena hasta la factura aceptada", async () => {
    await db.query("update public.pedidos set entrega_fecha = public.hoy() where id = $1", [p]);
    await acto(U.prof, "select public.intervenir_pedido($1, 'Sin albarán')", [p]);
    await acto(U.prof, "select public.intervenir_pedido($1, 'Sin confirmación')", [p]);
    await acto(U.prof, "select public.intervenir_pedido($1, 'Sin factura', 10, 15)", [p]);
    expect(Number(await uno("select iva from public.facturas where pedido_id = $1", [p]))).toBe(10);
    await acto(U.prof, "select public.intervenir_pedido($1, 'Sin aceptación')", [p]);
    expect(await etapa(p)).toBe("factura_aceptada");
    await expect(acto(U.prof, "select public.intervenir_pedido($1, 'x')", [p])).rejects.toThrow(/ningún documento/);
  });
});

describe("rechazo de albarán", () => {
  it("devuelve las existencias y da un día lectivo para reemitirlo", async () => {
    await dia("2026-11-09");
    const antes = Number(await uno("select unidades from public.articulos where empresa_id = 1 and nombre = 'Planchas de acero 1 mm'"));
    const p = await pedir(5);
    await acto(U.g1, "select public.aceptar_pedido($1)", [p]);
    await db.query("update public.pedidos set entrega_fecha = public.hoy() where id = $1", [p]);
    await acto(U.g1, "select public.emitir_albaran($1)", [p]);
    expect(Number(await uno("select unidades from public.articulos where empresa_id = 1 and nombre = 'Planchas de acero 1 mm'"))).toBe(antes - 5);
    await expect(acto(U.g1, "select public.rechazar_albaran($1, 'Documento incorrecto')", [p])).rejects.toThrow(/comprador/);
    await expect(acto(U.g2, "select public.rechazar_albaran($1, 'No me gusta')", [p])).rejects.toThrow(/motivos/);
    await acto(U.g2, "select public.rechazar_albaran($1, 'Documento incorrecto')", [p]);
    expect(await etapa(p)).toBe("pedido_aceptado");
    expect(Number(await uno("select unidades from public.articulos where empresa_id = 1 and nombre = 'Planchas de acero 1 mm'"))).toBe(antes);
    expect(await uno("select count(*)::int from public.albaranes_rechazados where pedido_id = $1", [p])).toBe(1);
    await db.query("update public.pedidos set entrega_fecha = public.hoy() where id = $1", [p]);
    await acto(U.g1, "select public.emitir_albaran($1)", [p]);
    await acto(U.g2, "select public.confirmar_recepcion($1)", [p]);
    expect(await etapa(p)).toBe("recibido");
  });
});

describe("IVA del catálogo", () => {
  it("lo indica la profesora y lo aplica la tienda", async () => {
    const a = await db.query<{ id: string; catalogo_id: string; precio: string }>("select a.id, a.catalogo_id, c.precio from public.articulos a join public.catalogo c on c.id = a.catalogo_id where a.empresa_id = 6 and c.activo and a.unidades > 2 limit 1");
    const art = a.rows[0];
    await expect(acto(U.g6, "select public.fijar_iva_catalogo($1, 10)", [art.catalogo_id])).rejects.toThrow(/Solo la profesora/);
    await expect(acto(U.prof, "select public.fijar_iva_catalogo($1, 7)", [art.catalogo_id])).rejects.toThrow(/21, 10, 4 o 0/);
    await acto(U.prof, "select public.fijar_iva_catalogo($1, 10)", [art.catalogo_id]);
    const [t] = await acto<{ n: string }>(U.g6, "select public.vender_tienda($1, 1) n", [art.id]);
    const c = await uno("select cuota from public.tickets where num = $1", [t.n]);
    expect(Number(c)).toBeCloseTo(Math.round(Number(art.precio) * 10) / 100, 2);
    await acto(U.prof, "select public.fijar_iva_catalogo($1, 21)", [art.catalogo_id]);
  });
});

describe("cuadro de cuotas", () => {
  let s = 0;
  it("se crea al autorizar, cuadra con el capital y se paga en orden", async () => {
    await modulo("financiacion", true);
    await db.query("insert into public.condiciones_banco (comision_transferencia, tipo_interes, plazo_max_meses) values (1.5, 6, 60)");
    const [r] = await acto<{ id: string }>(U.g3, "select public.solicitar_financiacion(1200, 12, 'Compra de maquinaria') id");
    s = Number(r.id);
    await acto(U.g5, "select public.estudiar_financiacion($1, true, 6, null, null)", [s]);
    await acto(U.prof, "select public.autorizar_financiacion($1, true, null)", [s]);
    const c = (await db.query<{ id: string; capital: string; interes: string; cuota: string; pendiente_tras: string }>("select * from public.cuotas_prestamo where solicitud_id = $1 order by n", [s])).rows;
    expect(c).toHaveLength(12);
    expect(c.reduce((a, x) => a + Number(x.capital), 0)).toBeCloseTo(1200, 2);
    expect(Number(c[0].cuota)).toBeCloseTo(103.28, 2);
    expect(Number(c[0].interes)).toBeCloseTo(6, 2);
    expect(Number(c[11].pendiente_tras)).toBe(0);
    await expect(acto(U.g3, "select public.pagar_cuota($1)", [c[1].id])).rejects.toThrow(/anterior/);
    await expect(acto(U.g2, "select public.pagar_cuota($1)", [c[0].id])).rejects.toThrow(/no es tuyo/);
    const antes = await saldo(3);
    const banco = await saldo(5);
    await acto(U.g3, "select public.pagar_cuota($1)", [c[0].id]);
    expect(await saldo(3)).toBeCloseTo(antes - 103.28, 2);
    expect(await saldo(5)).toBeCloseTo(banco + 103.28, 2);
    await expect(acto(U.g3, "select public.pagar_cuota($1)", [c[0].id])).rejects.toThrow(/ya está pagada/);
  });
  it("otra empresa no ve el cuadro", async () => {
    expect(await acto(U.g2, "select id from public.cuotas_prestamo where solicitud_id = $1", [s])).toHaveLength(0);
    expect(await acto(U.g5, "select id from public.cuotas_prestamo where solicitud_id = $1", [s])).toHaveLength(12);
  });
});

describe("nóminas y cuentas personales", () => {
  it("solo con el módulo activo, bruto mínimo y trabajador de la empresa", async () => {
    await expect(acto(U.g2, "select public.emitir_nomina($1, '2026-11-01', 2000)", [U.g2b])).rejects.toThrow(/activado/);
    await modulo("nominas", true);
    await expect(acto(U.g2, "select public.emitir_nomina($1, '2026-11-01', 1999)", [U.g2b])).rejects.toThrow(/mínimo/);
    await expect(acto(U.g2, "select public.emitir_nomina($1, '2026-11-01', 2000)", [U.g3])).rejects.toThrow(/no trabaja/);
    await expect(acto(U.g2, "select public.fijar_reglas_nomina(6, 30, 12)")).rejects.toThrow(/Solo la profesora/);
  });
  it("reparte líquido, Seguridad Social e IRPF según las reglas", async () => {
    await acto(U.prof, "select public.fijar_reglas_nomina(6, 30, 12)");
    const [g2, ss, ha] = [await saldo(2), await saldo(9), await saldo(8)];
    await acto(U.g2, "select public.emitir_nomina($1, '2026-11-15', 2000)", [U.g2b]);
    expect(await personal(U.g2b)).toBe(1640);
    expect(await saldo(2)).toBeCloseTo(g2 - 1640 - 720 - 240, 2);
    expect(await saldo(9)).toBeCloseTo(ss + 720, 2);
    expect(await saldo(8)).toBeCloseTo(ha + 240, 2);
    await expect(acto(U.g2, "select public.emitir_nomina($1, '2026-11-20', 2000)", [U.g2b])).rejects.toThrow(/ya tiene/);
  });
  it("la cuenta personal solo la ve su titular y la profesora", async () => {
    expect(await acto(U.g2, "select id from public.movimientos_personales where perfil_id = $1", [U.g2b])).toHaveLength(0);
    expect(await acto(U.g2b, "select id from public.movimientos_personales")).toHaveLength(1);
    expect(await acto(U.prof, "select id from public.movimientos_personales where perfil_id = $1", [U.g2b])).toHaveLength(1);
  });
  it("compra en la tienda del G6, con su salida de almacén", async () => {
    const f = (await db.query<{ cat: string; art: string; uds: string; precio: string }>("select c.id cat, a.id art, a.unidades uds, c.precio from public.articulos a join public.catalogo c on c.id = a.catalogo_id where a.empresa_id = 6 and c.activo and c.precio < 500 and a.unidades > 2 limit 1")).rows[0];
    await expect(acto(U.g2b, "select public.comprar_en_tienda($1, 1)", [f.cat])).rejects.toThrow(/activado/);
    await modulo("consumidores", true);
    const g6 = await saldo(6);
    const total = Math.round(Number(f.precio) * 121) / 100;
    await acto(U.g2b, "select public.comprar_en_tienda($1, 1)", [f.cat]);
    expect(await personal(U.g2b)).toBeCloseTo(1640 - total, 2);
    expect(await saldo(6)).toBeCloseTo(g6 + total, 2);
    expect(Number(await uno("select unidades from public.articulos where id = $1", [f.art]))).toBe(Number(f.uds) - 1);
  });
  it("gastos de vivienda y suministros en el G4, sin quedar en negativo", async () => {
    const g4 = await saldo(4);
    await acto(U.g2b, "select public.pagar_gasto_personal('suministros', 121, 'Luz de noviembre')");
    await acto(U.g2b, "select public.pagar_gasto_personal('vivienda', 100, 'Alquiler')");
    expect(await saldo(4)).toBeCloseTo(g4 + 221, 2);
    expect(Number(await uno("select cuota from public.gastos_personales where tipo = 'suministros'"))).toBe(21);
    expect(Number(await uno("select cuota from public.gastos_personales where tipo = 'vivienda'"))).toBe(0);
    await expect(acto(U.g2b, "select public.pagar_gasto_personal('vivienda', 99999, 'Casa')")).rejects.toThrow(/saldo suficiente/);
  });
  it("el préstamo personal no pasa de cuatro años y se abona en la cuenta personal", async () => {
    await expect(acto(U.g2b, "select public.solicitar_prestamo_personal(1000, 49, 'Coche')")).rejects.toThrow(/cuatro años/);
    const [r] = await acto<{ id: string }>(U.g2b, "select public.solicitar_prestamo_personal(480, 48, 'Coche') id");
    const s = Number(r.id);
    expect(await acto(U.g2, "select id from public.solicitudes_financiacion where id = $1", [s])).toHaveLength(0);
    const antes = await personal(U.g2b);
    await acto(U.g5, "select public.estudiar_financiacion($1, true, 6, null, null)", [s]);
    await acto(U.prof, "select public.autorizar_financiacion($1, true, null)", [s]);
    expect(await personal(U.g2b)).toBeCloseTo(antes + 480, 2);
    expect(await uno("select count(*)::int from public.cuotas_prestamo where solicitud_id = $1", [s])).toBe(48);
    const c = await uno("select id from public.cuotas_prestamo where solicitud_id = $1 and n = 1", [s]);
    await acto(U.g2b, "select public.pagar_cuota($1)", [c]);
    expect(await personal(U.g2b)).toBeLessThan(antes + 480);
  });
});

describe("fianzas", () => {
  it("se depositan en el G4 y se devuelven", async () => {
    await expect(acto(U.g2, "select public.constituir_fianza('agua', 100)")).rejects.toThrow(/activado/);
    await modulo("suministros", true);
    const [g2, g4] = [await saldo(2), await saldo(4)];
    await acto(U.g2, "select public.constituir_fianza('agua', 100)");
    expect(await saldo(2)).toBeCloseTo(g2 - 100, 2);
    expect(await saldo(4)).toBeCloseTo(g4 + 100, 2);
    await expect(acto(U.g2, "select public.constituir_fianza('agua', 100)")).rejects.toThrow(/Ya tienes/);
    const id = await uno("select id from public.fianzas where empresa_id = 2");
    await expect(acto(U.g2, "select public.devolver_fianza($1)", [id])).rejects.toThrow(/recibió/);
    await acto(U.g4, "select public.devolver_fianza($1)", [id]);
    expect(await saldo(2)).toBeCloseTo(g2, 2);
    await expect(acto(U.g4, "select public.devolver_fianza($1)", [id])).rejects.toThrow(/ya está devuelta/);
  });
  it("la del G4 va al Estado y la devuelve la profesora", async () => {
    await acto(U.g4, "select public.constituir_fianza('electricidad', 50)");
    const id = await uno("select id from public.fianzas where empresa_id = 4");
    expect(await uno("select receptor_id from public.fianzas where id = $1", [id])).toBe(7);
    await expect(acto(U.g4, "select public.devolver_fianza($1)", [id])).rejects.toThrow(/recibió/);
    await acto(U.prof, "select public.devolver_fianza($1)", [id]);
  });
});

describe("liquidación de IVA", () => {
  it("solo noviembre y diciembre, y el resultado positivo se ingresa en Hacienda", async () => {
    await expect(acto(U.g2, "select public.presentar_iva('2026-11', 100, 40)")).rejects.toThrow(/activado/);
    await modulo("iva", true);
    await expect(acto(U.g2, "select public.presentar_iva('2026-10', 100, 40)")).rejects.toThrow(/noviembre y diciembre/);
    const [g2, ha] = [await saldo(2), await saldo(8)];
    await acto(U.g2, "select public.presentar_iva('2026-11', 100, 40)");
    expect(await saldo(2)).toBeCloseTo(g2 - 60, 2);
    expect(await saldo(8)).toBeCloseTo(ha + 60, 2);
    await expect(acto(U.g2, "select public.presentar_iva('2026-11', 100, 40)")).rejects.toThrow(/Ya has presentado/);
  });
  it("a compensar no mueve dinero", async () => {
    const g3 = await saldo(3);
    await acto(U.g3, "select public.presentar_iva('2026-11', 10, 40)");
    expect(await saldo(3)).toBe(g3);
    expect(Number(await uno("select resultado from public.liquidaciones_iva where empresa_id = 3"))).toBe(-30);
  });
  it("la profesora ve el cálculo para comparar, los grupos no", async () => {
    await expect(acto(U.g2, "select * from public.iva_calculado(2::smallint, '2026-11')")).rejects.toThrow(/Solo la profesora/);
    const [r] = await acto<{ repercutido: string; soportado: string }>(U.prof, "select * from public.iva_calculado(4::smallint, '2026-11')");
    expect(Number(r.repercutido)).toBeCloseTo(21, 2);
  });
});

describe("rotación de roles", () => {
  it("cuenta lo elaborado y revisado por persona de la empresa", async () => {
    const r = await acto<{ nombre: string; elaborados: string; revisados: string }>(U.g2, "select * from public.actividad_personas(2::smallint)");
    expect(r.find((x) => x.nombre === "Persona g2b")?.elaborados).toBeDefined();
    expect(Number(r.find((x) => x.nombre === "Persona g2")?.elaborados)).toBeGreaterThan(0);
    await expect(acto(U.g3, "select * from public.actividad_personas(2::smallint)")).rejects.toThrow(/otra empresa/);
  });
});
