/* eslint-disable @typescript-eslint/no-explicit-any -- filas sin tipar de la base de datos */
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
const COMPARTIDA = "00000000-0000-0000-0000-000000000090";
const LISTA = ["numeracion", "partes", "descripcion", "unidades", "descuentos", "base", "iva", "total", "pago"];
const PLANCHAS = "Planchas de acero 1 mm";
const ESTANTERIA = "Estantería metálica 5 baldas";
const CARRO = "Carro de almacén";
const TRANSPORTE = "Transporte de mercancías (envío)";
let db: PGlite;

async function acto(id: string, sql: string, params: unknown[] = [], cabeceras?: Record<string, string>): Promise<Record<string, any>[]> {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [id]);
    await db.query("select set_config('request.headers', $1, true)", [JSON.stringify(cabeceras ?? {})]);
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
const saldo = async (g: number) => Number((await db.query<{ s: string }>("select saldo s from public.movimientos_banco where empresa_id = $1 order by id desc limit 1", [g])).rows[0]?.s ?? 0);
const etapa = async (p: number) => (await db.query<{ e: string }>("select etapa e from public.pedidos where id = $1", [p])).rows[0].e;
const cat = async (g: number, n: string) => (await db.query<{ id: string }>("select id from public.catalogo where empresa_id = $1 and nombre = $2 and activo", [g, n])).rows[0].id;
async function pedir(u: string, vendedor: number, lineas: [string, number][], dias: number | null, envio: { catalogo_id: string; unidades: number } | null = null, confirmado = true) {
  const ls = [];
  for (const [n, unidades] of lineas) ls.push({ catalogo_id: await cat(vendedor, n), unidades });
  const [r] = await acto(u, "select public.crear_pedido($1::smallint, $2::jsonb, $3, $4, $5::jsonb) id", [vendedor, JSON.stringify(ls), dias, confirmado, envio ? JSON.stringify(envio) : null]);
  return Number(r.id);
}
async function facturar(u: string, p: number, o: { dto?: number; rappel?: number; pp?: number } = {}) {
  const ls = (await db.query<{ id: string; unidades: string; precio: string }>("select id, unidades, precio from public.pedido_lineas where pedido_id = $1 order by id", [p])).rows;
  const lineas = ls.map((l) => ({ linea_id: Number(l.id), unidades: Number(l.unidades), precio: Number(l.precio) }));
  await acto(u, "select public.emitir_factura($1, $2::jsonb, $3, $4, $5, 0, 0, 21, 0, 15)", [p, JSON.stringify(lineas), o.dto ?? 0, o.rappel ?? 0, o.pp ?? 0]);
}
const lineasPres = async (id: number) => (await db.query<{ id: string }>("select id from public.presupuesto_lineas where presupuesto_id = $1 order by id", [id])).rows.map((l) => Number(l.id));

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
  await db.query("insert into auth.users values ($1)", [COMPARTIDA]);
  await db.query("insert into public.perfiles (id, usuario, nombre, rol, empresa_id, cuenta_grupo) values ($1,'grupo2','Cuenta inicial grupo 2','alumno',2,true)", [COMPARTIDA]);
  await dia("2026-11-09");
}, 60000);

describe("quién firma con la cuenta del grupo", () => {
  it("sin elegir a nadie no se puede firmar", async () => {
    await expect(acto(COMPARTIDA, "select public.enviar_correo(1::smallint, 'Hola', 'Mensaje')")).rejects.toThrow(/Selecciona quién eres/);
  });
  it("no se puede firmar como alguien de otro grupo ni como la propia cuenta", async () => {
    await expect(acto(COMPARTIDA, "select public.enviar_correo(1::smallint, 'Hola', 'Mensaje')", [], { "x-firmante": U.g3 })).rejects.toThrow(/Selecciona quién eres/);
    await expect(acto(COMPARTIDA, "select public.enviar_correo(1::smallint, 'Hola', 'Mensaje')", [], { "x-firmante": COMPARTIDA })).rejects.toThrow(/Selecciona quién eres/);
    await expect(acto(COMPARTIDA, "select public.enviar_correo(1::smallint, 'Hola', 'Mensaje')", [], { "x-firmante": "basura" })).rejects.toThrow(/Selecciona quién eres/);
  });
  it("firma la persona elegida, aunque entre con la cuenta del grupo", async () => {
    const [r] = await acto(COMPARTIDA, "select public.enviar_correo(1::smallint, 'Hola', 'Mensaje') id", [], { "x-firmante": U.g2b });
    const [c] = await acto(U.g1, "select autor_nombre, remitente_id from public.correos where id = $1", [r.id]);
    expect(c.autor_nombre).toBe("Alumno g2b");
    expect(c.remitente_id).toBe(2);
  });
  it("una cuenta individual firma por sí misma e ignora la cabecera", async () => {
    const [r] = await acto(U.g2, "select public.enviar_correo(1::smallint, 'Otro', 'Mensaje') id", [], { "x-firmante": U.g2b });
    const [c] = await acto(U.g1, "select autor_nombre from public.correos where id = $1", [r.id]);
    expect(c.autor_nombre).toBe("Alumno g2");
  });
  it("la cuenta del grupo no se da de baja ni se mueve", async () => {
    await expect(acto(U.g2, "select public.dar_baja_integrante($1)", [COMPARTIDA])).rejects.toThrow(/cuenta del grupo/);
    await expect(acto(U.prof, "select public.mover_alumno($1, 1::smallint)", [COMPARTIDA])).rejects.toThrow(/cuenta del grupo/);
  });
});

describe("el G1 compra al Estado", () => {
  let p = 0;
  it("solo el G1 compra al Estado, y nadie puede comprar a Hacienda", async () => {
    await expect(pedir(U.g2, 7, [[PLANCHAS, 1]], 1)).rejects.toThrow(/solo vende materias primas al G1/);
    await expect(acto(U.g1, "select public.crear_pedido(8::smallint, '[]'::jsonb, 1)")).rejects.toThrow(/no vende/);
    p = await pedir(U.g1, 7, [[PLANCHAS, 100]], 1);
    const [l] = await acto(U.g1, "select precio from public.pedido_lineas where pedido_id = $1", [p]);
    expect(Number(l.precio)).toBe(8);
  });
  it("el G1 hace y recibe todos los documentos, y la profesora no interviene", async () => {
    await expect(acto(U.prof, "select public.aceptar_pedido($1)", [p])).rejects.toThrow(/no actúa/);
    await expect(acto(U.g2, "select public.aceptar_pedido($1)", [p])).rejects.toThrow(/Solo el proveedor/);
    await acto(U.g1, "select public.aceptar_pedido($1)", [p]);
    await dia("2026-11-10");
    await acto(U.g1, "select public.emitir_albaran($1)", [p]);
    const antes = (await db.query<{ unidades: string }>("select unidades from public.articulos where empresa_id = 1 and nombre = $1", [PLANCHAS])).rows[0].unidades;
    await acto(U.g1, "select public.confirmar_recepcion($1)", [p]);
    const ahora = (await db.query<{ unidades: string }>("select unidades from public.articulos where empresa_id = 1 and nombre = $1", [PLANCHAS])).rows[0].unidades;
    expect(Number(ahora) - Number(antes)).toBe(100);
    await facturar(U.g1, p);
    await acto(U.g1, "select public.aceptar_factura($1, $2)", [p, LISTA]);
    await acto(U.g1, "select public.marcar_registro($1, 'borrador')", [p]);
    await acto(U.g1, "select public.marcar_registro($1, 'diario')", [p]);
  });
  it("el pago va a la cuenta Estado vende materias", async () => {
    const s = await saldo(1);
    await acto(U.g1, "select public.ordenar_pago($1)", [p]);
    expect(await etapa(p)).toBe("pagado");
    expect(await saldo(7)).toBe(968);
    expect(Math.round((s - (await saldo(1))) * 100) / 100).toBe(969.5);
  });
  it("las cuentas del Estado no admiten usuarios", async () => {
    await expect(db.query("insert into public.perfiles (id, usuario, nombre, rol, empresa_id) values ($1,'x','X','alumno',7)", [COMPARTIDA])).rejects.toThrow();
  });
});

describe("pagos a Hacienda y Seguridad Social", () => {
  it("se ejecutan solos, con justificante, y el banco los revisa", async () => {
    await expect(acto(U.g3, "select public.pagar_estado(7::smallint, 'x', 1)")).rejects.toThrow(/Hacienda o a la Seguridad Social/);
    await expect(acto(U.g3, "select public.pagar_estado(8::smallint, '', 1)")).rejects.toThrow(/concepto/);
    await expect(acto(U.g3, "select public.pagar_estado(8::smallint, 'IVA', 999999)")).rejects.toThrow(/descubierto/);
    const s = await saldo(3);
    const [r] = await acto(U.g3, "select public.pagar_estado(8::smallint, 'IVA noviembre', 100) j");
    expect(r.j).toMatch(/^JB-/);
    expect(await saldo(8)).toBe(100);
    expect(Math.round((s - (await saldo(3))) * 100) / 100).toBe(101.5);
    await acto(U.g3, "select public.pagar_estado(9::smallint, 'Cuotas noviembre', 50)");
    expect(await saldo(9)).toBe(50);
    const [o] = await acto(U.g5, "select id, pedido_id, revisado_en from public.ordenes_pago where beneficiario_id = 9");
    expect(o.pedido_id).toBe(null);
    await acto(U.g5, "select public.revisar_pago($1)", [o.id]);
  });
});

describe("punto 8", () => {
  it("el saldo inicial no puede superar 50.000 €", async () => {
    await expect(db.query("update public.empresas set saldo_inicial = 50000.01 where id = 1")).rejects.toThrow();
  });
  it("la compra de más del 20 % se comprueba antes, no al pagar", async () => {
    await expect(pedir(U.g3, 2, [[CARRO, 100]], 1, null, false)).rejects.toThrow(/20 %/);
    const p = await pedir(U.g3, 2, [[CARRO, 100]], 1, null, true);
    const [x] = await acto(U.g3, "select confirmo_comprobacion c from public.pedidos where id = $1", [p]);
    expect(x.c).toBe(true);
  });
  it("el descubierto necesita autorización de la profesora", async () => {
    await expect(acto(U.g6, "select public.autorizar_descubierto(6::smallint, 1000, 'x')")).rejects.toThrow(/Solo la profesora/);
    await expect(acto(U.g6, "select public.pagar_estado(8::smallint, 'Prueba', 28001)")).rejects.toThrow(/descubierto/);
    await expect(acto(U.prof, "select public.autorizar_descubierto(6::smallint, 1000, '')")).rejects.toThrow(/motivo/);
    await acto(U.prof, "select public.autorizar_descubierto(6::smallint, 1000, 'Cobro retrasado')");
    const s = await saldo(6);
    const [d] = await acto(U.g6, "select public.disponible(6::smallint) d");
    expect(Number(d.d)).toBe(s + 1000);
    await acto(U.g6, "select public.pagar_estado(8::smallint, 'Prueba', $1)", [s + 500]);
    expect(await saldo(6)).toBe(-501.5);
    expect(await acto(U.g3, "select * from public.autorizaciones_descubierto")).toHaveLength(0);
  });
  it("el precio sale de coste y margen, y espera a la profesora", async () => {
    const id = await cat(3, CARRO);
    await expect(acto(U.g3, "select public.guardar_catalogo(3::smallint, $1, $2, 0, 10)", [id, CARRO])).rejects.toThrow(/mayor que cero/);
    await acto(U.g3, "select public.guardar_catalogo(3::smallint, $1, $2, 150, 20)", [id, CARRO]);
    const [c] = await acto(U.g3, "select precio from public.catalogo where id = $1", [id]);
    expect(Number(c.precio)).toBe(175);
    const [s] = await acto(U.prof, "select id, precio, precio_anterior, estado from public.solicitudes_precio where catalogo_id = $1", [id]);
    expect(Number(s.precio)).toBe(180);
    expect(Number(s.precio_anterior)).toBe(175);
    await expect(acto(U.g3, "select public.guardar_catalogo(3::smallint, $1, $2, 150, 30)", [id, CARRO])).rejects.toThrow(/ya tiene un cambio/);
    await expect(acto(U.g3, "select public.resolver_precio($1, true)", [s.id])).rejects.toThrow(/Solo la profesora/);
    await expect(acto(U.prof, "select public.resolver_precio($1, false, '')", [s.id])).rejects.toThrow(/motivo/);
    await acto(U.prof, "select public.resolver_precio($1, false, 'Margen excesivo')", [s.id]);
    expect(Number((await acto(U.g3, "select precio from public.catalogo where id = $1", [id]))[0].precio)).toBe(175);
    await acto(U.g3, "select public.guardar_catalogo(3::smallint, $1, $2, 150, 20)", [id, CARRO]);
    const [s2] = await acto(U.prof, "select id from public.solicitudes_precio where catalogo_id = $1 and estado = 'pendiente'", [id]);
    await acto(U.prof, "select public.resolver_precio($1, true)", [s2.id]);
    const [n] = await acto(U.g3, "select precio, coste, margen from public.catalogo where id = $1", [id]);
    expect([Number(n.precio), Number(n.coste), Number(n.margen)]).toEqual([180, 150, 20]);
    expect(await acto(U.g2, "select * from public.solicitudes_precio")).toHaveLength(0);
  });
  it("un artículo nuevo no entra en el catálogo hasta que se aprueba", async () => {
    const [r] = await acto(U.g3, "select public.guardar_catalogo(3::smallint, null, 'Mesa', 100, 10) id");
    expect(r.id).toBe(null);
    expect((await db.query("select 1 from public.catalogo where nombre = 'Mesa'")).rows).toHaveLength(0);
    const [s] = await acto(U.prof, "select id from public.solicitudes_precio where nombre = 'Mesa'");
    await acto(U.prof, "select public.resolver_precio($1, true)", [s.id]);
    expect(Number((await db.query<{ precio: string }>("select precio from public.catalogo where nombre = 'Mesa'")).rows[0].precio)).toBe(110);
  });
  it("cambiar solo el nombre no necesita aprobación", async () => {
    const id = await cat(3, "Mesa");
    await acto(U.g3, "select public.guardar_catalogo(3::smallint, $1, 'Mesa de oficina')", [id]);
    expect((await db.query<{ nombre: string }>("select nombre from public.catalogo where id = $1", [id])).rows[0].nombre).toBe("Mesa de oficina");
  });
  it("si el precio final no cambia tampoco hay nada que aprobar", async () => {
    const id = await cat(3, ESTANTERIA);
    const [c] = await acto(U.g3, "select precio from public.catalogo where id = $1", [id]);
    await acto(U.g3, "select public.guardar_catalogo(3::smallint, $1, $2, $3, 0)", [id, ESTANTERIA, Number(c.precio)]);
    expect(await acto(U.prof, "select * from public.solicitudes_precio where catalogo_id = $1", [id])).toHaveLength(0);
    expect(Number((await db.query<{ coste: string }>("select coste from public.catalogo where id = $1", [id])).rows[0].coste)).toBe(Number(c.precio));
  });
  it("el banco publica tipos, plazos y condiciones", async () => {
    await acto(U.g5, "select public.publicar_condiciones(1.5, 5, 48, 'Sin otras comisiones')");
    const [c] = await acto(U.g3, "select tipo_interes, plazo_max_meses, condiciones from public.condiciones_banco order by id desc limit 1");
    expect([Number(c.tipo_interes), c.plazo_max_meses, c.condiciones]).toEqual([5, 48, "Sin otras comisiones"]);
  });
  it("el préstamo pasa por el banco y por la profesora, y solo entonces se abona", async () => {
    await expect(acto(U.g3, "select public.solicitar_financiacion(1000, 12, 'Compra')")).rejects.toThrow(/no está activada/);
    await acto(U.prof, "select public.activar_modulo('financiacion', true)");
    await expect(acto(U.g3, "select public.solicitar_financiacion(1000, 60, 'Compra')")).rejects.toThrow(/plazo máximo/);
    const [r] = await acto(U.g3, "select public.solicitar_financiacion(1000, 12, 'Compra') id");
    const [l] = await acto(U.g3, "select public.plazo_financiacion(s)::text d from public.solicitudes_financiacion s where id = $1", [r.id]);
    expect(l.d).toBe("2026-11-13");
    await expect(acto(U.prof, "select public.autorizar_financiacion($1, true, null)", [r.id])).rejects.toThrow(/pendiente de autorización/);
    await expect(acto(U.g5, "select public.estudiar_financiacion($1, true, 9, null, null)", [r.id])).rejects.toThrow(/causa objetiva/);
    await acto(U.g5, "select public.estudiar_financiacion($1, true, 5, null, null)", [r.id]);
    const s = await saldo(3);
    const b = await saldo(5);
    await expect(acto(U.g5, "select public.autorizar_financiacion($1, true, null)", [r.id])).rejects.toThrow(/Solo la profesora/);
    expect(await saldo(3)).toBe(s);
    await acto(U.prof, "select public.autorizar_financiacion($1, true, null)", [r.id]);
    expect(Math.round(((await saldo(3)) - s) * 100) / 100).toBe(1000);
    expect(Math.round((b - (await saldo(5))) * 100) / 100).toBe(1000);
  });
  it("el plan de viabilidad lo presenta el grupo y lo resuelve la profesora", async () => {
    await expect(acto(U.g6, "select public.presentar_plan('', 'b', 'c', 100)")).rejects.toThrow(/reducción de gastos/);
    const [r] = await acto(U.g6, "select public.presentar_plan('Menos alquiler', 'Subir un 5 %', 'Préstamo', 2000) id");
    await expect(acto(U.g6, "select public.presentar_plan('a', 'b', 'c', 1)")).rejects.toThrow(/ya tiene un plan/);
    await expect(acto(U.g6, "select public.resolver_plan($1, true, 2000, 'x')", [r.id])).rejects.toThrow(/Solo la profesora/);
    const s = await saldo(6);
    const h = await saldo(8);
    await acto(U.prof, "select public.resolver_plan($1, true, 1500, 'Devolver en el segundo trimestre')", [r.id]);
    expect(await saldo(6)).toBe(s + 1500);
    expect(await saldo(8)).toBe(h - 1500);
    expect(await acto(U.g3, "select * from public.planes_viabilidad")).toHaveLength(0);
  });
});

describe("presupuestos y negociación", () => {
  let pr = 0;
  it("el cliente lo solicita al precio de tarifa, con el plazo de 2 días para el proveedor", async () => {
    await dia("2026-11-09");
    const c = await cat(2, ESTANTERIA);
    await expect(acto(U.g3, "select public.solicitar_presupuesto(7::smallint, '[]'::jsonb, 1)")).rejects.toThrow(/no hace presupuestos/);
    const [r] = await acto(U.g3, "select public.solicitar_presupuesto(2::smallint, $1::jsonb, 2, 'Buen volumen') id", [JSON.stringify([{ catalogo_id: c, unidades: 10 }])]);
    pr = Number(r.id);
    const [p] = await acto(U.g2, "select num, estado, public.plazo_presupuesto(presupuestos)::text l from public.presupuestos where id = $1", [pr]);
    expect(p.num).toBe("PR3-0001");
    expect(p.estado).toBe("solicitado");
    expect(p.l).toBe("2026-11-11");
    expect(await acto(U.g1, "select * from public.presupuestos where id = $1", [pr])).toHaveLength(0);
    expect(await acto(U.g1, "select * from public.presupuesto_lineas where presupuesto_id = $1", [pr])).toHaveLength(0);
    expect(await acto(U.prof, "select * from public.presupuesto_pasos where presupuesto_id = $1", [pr])).toHaveLength(1);
  });
  it("se negocia por turnos, y cada paso queda guardado", async () => {
    const [l] = await lineasPres(pr);
    const lin = (precio: number) => JSON.stringify([{ linea_id: l, precio }]);
    await expect(acto(U.g3, "select public.ofertar_presupuesto($1, $2::jsonb, 0, 0, 0)", [pr, lin(80)])).rejects.toThrow(/Solo el proveedor/);
    await expect(acto(U.g3, "select public.aceptar_presupuesto($1, true)", [pr])).rejects.toThrow(/no tiene una oferta/);
    await expect(acto(U.g2, "select public.ofertar_presupuesto($1, '[]'::jsonb, 0, 0, 0)", [pr])).rejects.toThrow(/precio válido/);
    await expect(acto(U.g2, "select public.ofertar_presupuesto($1, $2::jsonb, 101, 0, 0)", [pr, lin(80)])).rejects.toThrow(/descuentos/);
    await acto(U.g2, "select public.ofertar_presupuesto($1, $2::jsonb, 5, 0, 0, 'Oferta inicial')", [pr, lin(80)]);
    await expect(acto(U.g2, "select public.contraofertar_presupuesto($1, $2::jsonb, 5, 0, 0)", [pr, lin(70)])).rejects.toThrow(/Solo el cliente/);
    await acto(U.g3, "select public.contraofertar_presupuesto($1, $2::jsonb, 10, 2, 1, 'Mejor así')", [pr, lin(70)]);
    await acto(U.g2, "select public.ofertar_presupuesto($1, $2::jsonb, 10, 2, 1, 'De acuerdo')", [pr, lin(75)]);
    const pasos = await acto(U.g3, "select tipo, importe, nota from public.presupuesto_pasos where presupuesto_id = $1 order by id", [pr]);
    expect(pasos.map((x) => x.tipo)).toEqual(["solicitud", "oferta", "contraoferta", "oferta"]);
    expect(Number(pasos[1].importe)).toBe(760);
    expect(Number(pasos[3].importe)).toBe(654.89);
  });
  it("aceptar crea el pedido con lo negociado, y esos datos llegan a la factura", async () => {
    const [r] = await acto(U.g3, "select public.aceptar_presupuesto($1, false) id", [pr]);
    const [p] = await acto(U.g2, "select etapa, dto_pactado, rappel_pactado, pronto_pago_pactado, presupuesto_id from public.pedidos where id = $1", [r.id]);
    expect(p.etapa).toBe("pedido_enviado");
    expect([Number(p.dto_pactado), Number(p.rappel_pactado), Number(p.pronto_pago_pactado)]).toEqual([10, 2, 1]);
    expect(Number(p.presupuesto_id)).toBe(pr);
    const [l] = await acto(U.g2, "select precio from public.pedido_lineas where pedido_id = $1", [r.id]);
    expect(Number(l.precio)).toBe(75);
    await expect(acto(U.g3, "select public.aceptar_presupuesto($1, false)", [pr])).rejects.toThrow(/no tiene una oferta/);
  });
  it("un pedido directo no puede fijar su propio precio", async () => {
    const c = await cat(2, ESTANTERIA);
    const [r] = await acto(U.g3, "select public.crear_pedido(2::smallint, $1::jsonb, 1, true) id", [JSON.stringify([{ catalogo_id: c, unidades: 1, precio: 0.01 }])]);
    const [l] = await acto(U.g3, "select precio from public.pedido_lineas where pedido_id = $1", [r.id]);
    expect(Number(l.precio)).toBe(85);
  });
  it("el rechazo solo admite los motivos de las normas y respeta el turno", async () => {
    const c = await cat(2, CARRO);
    const [r] = await acto(U.g6, "select public.solicitar_presupuesto(2::smallint, $1::jsonb, 1) id", [JSON.stringify([{ catalogo_id: c, unidades: 1 }])]);
    await expect(acto(U.g6, "select public.rechazar_presupuesto($1, 'Precio no aceptado')", [r.id])).rejects.toThrow(/no te toca/);
    await expect(acto(U.g2, "select public.rechazar_presupuesto($1, 'Porque no')", [r.id])).rejects.toThrow(/motivos de rechazo/);
    await acto(U.g2, "select public.rechazar_presupuesto($1, 'Falta de existencias')", [r.id]);
    const [p] = await acto(U.g6, "select estado, motivo_rechazo from public.presupuestos where id = $1", [r.id]);
    expect(p.estado).toBe("rechazado");
  });
  it("si el proveedor no responde en plazo, la profesora registra el incumplimiento", async () => {
    await dia("2026-11-09");
    const c = await cat(2, CARRO);
    const [r] = await acto(U.g6, "select public.solicitar_presupuesto(2::smallint, $1::jsonb, 1) id", [JSON.stringify([{ catalogo_id: c, unidades: 1 }])]);
    await expect(acto(U.prof, "select public.registrar_incumplimiento_presupuesto($1)", [r.id])).rejects.toThrow(/no ha vencido/);
    await dia("2026-11-12");
    await acto(U.prof, "select public.registrar_incumplimiento_presupuesto($1)", [r.id]);
    await expect(acto(U.prof, "select public.registrar_incumplimiento_presupuesto($1)", [r.id])).rejects.toThrow(/ya está registrado/);
    const [i] = await acto(U.g2, "select texto from public.incumplimientos where presupuesto_id = $1", [r.id]);
    expect(i.texto).toMatch(/No respondió al presupuesto/);
  });
});

describe("descuentos dentro y fuera de factura", () => {
  it("el descuento comercial también se puede hacer fuera de factura", async () => {
    await dia("2026-11-09");
    const p = await pedir(U.g6, 3, [[ESTANTERIA, 1]], 1);
    await acto(U.g3, "select public.aceptar_pedido($1)", [p]);
    await dia("2026-11-10");
    await acto(U.g3, "select public.emitir_albaran($1)", [p]);
    await acto(U.g6, "select public.confirmar_recepcion($1)", [p]);
    await facturar(U.g3, p, { dto: 10, rappel: 5, pp: 2 });
    const [f] = await acto(U.g6, "select dto_imp, rappel_imp, pronto_pago_imp, base from public.facturas where pedido_id = $1", [p]);
    expect([Number(f.dto_imp), Number(f.rappel_imp), Number(f.pronto_pago_imp), Number(f.base)]).toEqual([11, 4.95, 1.88, 92.17]);
    await acto(U.g6, "select public.aceptar_factura($1, $2)", [p, LISTA]);
    await acto(U.g3, "select public.emitir_rectificativa($1, 'comercial', null, 10)", [p]);
    await acto(U.g6, "select public.aceptar_rectificativa($1)", [p]);
    await acto(U.g3, "select public.emitir_rectificativa($1, 'rappel', null, 5)", [p]);
    await acto(U.g6, "select public.aceptar_rectificativa($1)", [p]);
    await acto(U.g3, "select public.emitir_rectificativa($1, 'pronto_pago', null, 2)", [p]);
    await acto(U.g6, "select public.aceptar_rectificativa($1)", [p]);
    const r = await acto(U.g6, "select tipo, total from public.rectificativas where pedido_id = $1 order by id", [p]);
    expect(r.map((x) => [x.tipo, Number(x.total)])).toEqual([["comercial", -12.1], ["rappel", -6.05], ["pronto_pago", -2.42]]);
  });
});

describe("gastos de envío con el G4", () => {
  let p = 0;
  let e = 0;
  it("el catálogo del G4 incluye transporte, suministros y alquiler", async () => {
    const r = await acto(U.g1, "select nombre from public.catalogo where empresa_id = 4 and nombre ~ 'Transporte|electricidad|agua|Alquiler'");
    expect(r).toHaveLength(4);
  });
  it("se contrata con el pedido, como un pedido enlazado al G4", async () => {
    await dia("2026-11-09");
    const t = await cat(4, TRANSPORTE);
    await expect(pedir(U.g3, 2, [[ESTANTERIA, 2]], 1, { catalogo_id: await cat(4, "Alquiler de local (mes)"), unidades: 1 })).rejects.toThrow(/transporte del G4/);
    p = await pedir(U.g3, 2, [[ESTANTERIA, 2], [CARRO, 1]], 1, { catalogo_id: t, unidades: 1 });
    const [x] = await acto(U.g4, "select id, servicio, envio_de, etapa from public.pedidos where envio_de = $1", [p]);
    e = Number(x.id);
    expect(x.servicio).toBe(true);
    const [l] = await acto(U.g4, "select descripcion, precio from public.pedido_lineas where pedido_id = $1", [e]);
    expect(l.descripcion).toMatch(/Transporte de mercancías \(envío\) · pedido P3-/);
    expect(Number(l.precio)).toBe(30);
    expect(await acto(U.g4, "select * from public.pedidos where id = $1", [p])).toHaveLength(0);
    await expect(acto(U.g3, "select public.contratar_envio($1, $2, 1)", [p, t])).rejects.toThrow(/ya tiene el envío/);
  });
  it("el G4 no lo factura hasta que se recibe la mercancía", async () => {
    await acto(U.g4, "select public.aceptar_pedido($1)", [e]);
    await expect(facturar(U.g4, e)).rejects.toThrow(/ha recibido la mercancía/);
    await acto(U.g2, "select public.aceptar_pedido($1)", [p]);
    await dia("2026-11-10");
    await acto(U.g2, "select public.emitir_albaran($1)", [p]);
    await expect(facturar(U.g4, e)).rejects.toThrow(/ha recibido la mercancía/);
    await acto(U.g3, "select public.confirmar_recepcion($1)", [p]);
    await facturar(U.g4, e);
  });
  it("el coste del envío aumenta el valor de lo comprado y se paga al G4", async () => {
    const val = async (n: string) => Number((await db.query<{ v: string }>("select valor v from public.articulos where empresa_id = 3 and nombre = $1", [n])).rows[0].v);
    const a0 = await val(ESTANTERIA);
    const b0 = await val(CARRO);
    await acto(U.g3, "select public.aceptar_factura($1, $2)", [e, LISTA]);
    const a1 = await val(ESTANTERIA);
    const b1 = await val(CARRO);
    expect(Math.round((a1 - a0 + b1 - b0) * 100) / 100).toBe(30);
    expect(Math.round((a1 - a0) * 100) / 100).toBe(16.45);
    await acto(U.g3, "select public.marcar_registro($1, 'borrador')", [e]);
    await acto(U.g3, "select public.marcar_registro($1, 'diario')", [e]);
    const s = await saldo(4);
    await acto(U.g3, "select public.ordenar_pago($1)", [e]);
    expect(Math.round(((await saldo(4)) - s) * 100) / 100).toBe(36.3);
  });
  it("si se rechaza el pedido de mercancía, el envío se anula", async () => {
    await dia("2026-11-09");
    const q = await pedir(U.g3, 2, [[CARRO, 1]], 1, { catalogo_id: await cat(4, TRANSPORTE), unidades: 1 });
    const [x] = await db.query<{ id: string }>("select id from public.pedidos where envio_de = $1", [q]).then((r) => r.rows);
    await acto(U.g2, "select public.rechazar_pedido($1, 'Falta de existencias')", [q]);
    expect(await etapa(Number(x.id))).toBe("pedido_rechazado");
  });
});

describe("circulares y entregas", () => {
  let c = 0;
  let m = 0;
  it("las publica la profesora y llegan a todos los grupos", async () => {
    await dia("2026-11-09");
    await expect(acto(U.g1, "select public.crear_circular('circular', 'x', 'y', null)")).rejects.toThrow(/Solo la profesora/);
    await expect(acto(U.prof, "select public.crear_circular('modelo', 'x', 'y', null)")).rejects.toThrow(/fecha límite/);
    await expect(acto(U.prof, "select public.crear_circular('circular', 'x', 'y', '2026-11-01')")).rejects.toThrow(/anterior a hoy/);
    c = Number((await acto(U.prof, "select public.crear_circular('circular', 'Circular de noviembre', 'Mínimo de 3 operaciones', null) id"))[0].id);
    m = Number((await acto(U.prof, "select public.crear_circular('modelo', 'Modelo 303', 'Entregad la liquidación', '2026-11-11') id"))[0].id);
    for (const u of [U.g1, U.g2, U.g3, U.g4, U.g5, U.g6]) expect(await acto(u, "select * from public.circulares where id = $1", [m])).toHaveLength(1);
  });
  it("una circular sin fecha no admite entrega", async () => {
    await expect(acto(U.g1, "select public.entregar($1, 'x')", [c])).rejects.toThrow(/no tiene entrega/);
  });
  it("cada grupo entrega lo suyo, y solo lo ve él y la profesora", async () => {
    await expect(acto(U.prof, "select public.entregar($1, 'x')", [m])).rejects.toThrow(/no actúa/);
    await expect(acto(U.g1, "select public.entregar($1, '  ')", [m])).rejects.toThrow(/contenido/);
    await acto(U.g1, "select public.entregar($1, 'Resultado: 120,00 €')", [m]);
    await acto(U.g1, "select public.entregar($1, 'Resultado: 130,00 €')", [m]);
    const [e] = await acto(U.g1, "select contenido, fuera_de_plazo, entrego_nombre from public.entregas where circular_id = $1", [m]);
    expect(e.contenido).toBe("Resultado: 130,00 €");
    expect(e.fuera_de_plazo).toBe(false);
    expect(await acto(U.g2, "select * from public.entregas where circular_id = $1", [m])).toHaveLength(0);
    expect(await acto(U.prof, "select * from public.entregas where circular_id = $1", [m])).toHaveLength(1);
  });
  it("fuera de fecha se admite, pero queda marcada", async () => {
    await dia("2026-11-12");
    await acto(U.g2, "select public.entregar($1, 'Tarde')", [m]);
    const [e] = await acto(U.g2, "select id, fuera_de_plazo from public.entregas where circular_id = $1", [m]);
    expect(e.fuera_de_plazo).toBe(true);
    await expect(acto(U.g2, "select public.revisar_entrega($1, 'bien')", [e.id])).rejects.toThrow(/Solo la profesora/);
    await acto(U.prof, "select public.revisar_entrega($1, 'Falta el total')", [e.id]);
    expect((await acto(U.g2, "select revision from public.entregas where id = $1", [e.id]))[0].revision).toBe("Falta el total");
  });
  it("la profesora puede ampliar el plazo, y ve qué grupos han leído", async () => {
    await expect(acto(U.g1, "select public.cambiar_limite_circular($1, '2026-12-01')", [m])).rejects.toThrow(/Solo la profesora/);
    await acto(U.prof, "select public.cambiar_limite_circular($1, '2026-12-01')", [m]);
    await acto(U.g3, "select public.marcar_circular_leida($1)", [c]);
    await acto(U.g3, "select public.marcar_circular_leida($1)", [c]);
    const [l] = await acto(U.prof, "select empresa_id, leida_por_nombre from public.circular_lecturas where circular_id = $1", [c]);
    expect(l.leida_por_nombre).toBe("Alumno g3");
    expect(await acto(U.g1, "select * from public.circular_lecturas")).toHaveLength(0);
  });
});

describe("la profesora revisa pero no actúa", () => {
  it("deja observaciones visibles en la operación, sin mover el circuito", async () => {
    await dia("2026-11-12");
    const p = await pedir(U.g3, 2, [[CARRO, 1]], 1);
    await expect(acto(U.g3, "select public.anotar_operacion($1, 'x')", [p])).rejects.toThrow(/Solo la profesora/);
    await acto(U.prof, "select public.anotar_operacion($1, 'Revisad el IVA')", [p]);
    expect(await etapa(p)).toBe("pedido_enviado");
    const h = await acto(U.g3, "select texto from public.historial where pedido_id = $1 order by id desc limit 1", [p]);
    expect(h[0].texto).toBe("Observación de la profesora: Revisad el IVA");
  });
  it("no puede pagar en nombre de un grupo ni revisar pagos", async () => {
    await expect(acto(U.prof, "select public.pagar_estado(8::smallint, 'x', 1)")).rejects.toThrow(/no actúa/);
    await expect(acto(U.prof, "select public.revisar_pago(1)")).rejects.toThrow(/no actúa/);
  });
});

describe("permisos de las tablas nuevas", () => {
  it("nadie escribe directamente ni llama a las funciones internas", async () => {
    await expect(acto(U.g3, "update public.presupuestos set estado = 'aceptado'")).rejects.toThrow(/permission denied/);
    await expect(acto(U.g3, "insert into public.autorizaciones_descubierto (empresa_id, limite, motivo, fecha, concedida_por) values (3, 1, 'x', '2026-11-09', $1)", [U.g3])).rejects.toThrow(/permission denied/);
    await expect(acto(U.g3, "update public.entregas set revision = 'x'")).rejects.toThrow(/permission denied/);
    await expect(acto(U.g3, "update public.solicitudes_precio set estado = 'aceptada'")).rejects.toThrow(/permission denied/);
    await expect(acto(U.g3, "select public._ejecutar_orden(1)")).rejects.toThrow(/permission denied/);
    await expect(acto(U.g3, "select public._comprobar_compra(3::smallint, 1, true)")).rejects.toThrow(/permission denied/);
  });
});
