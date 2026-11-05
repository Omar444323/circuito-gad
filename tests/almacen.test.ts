import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const U = {
  prof: "00000000-0000-0000-0000-000000000000",
  g1: "00000000-0000-0000-0000-000000000011",
  g2: "00000000-0000-0000-0000-000000000021",
  g3: "00000000-0000-0000-0000-000000000031",
  g4: "00000000-0000-0000-0000-000000000041",
  g5: "00000000-0000-0000-0000-000000000051",
  g6: "00000000-0000-0000-0000-000000000061",
};
const LISTA = ["numeracion", "partes", "descripcion", "unidades", "descuentos", "base", "iva", "total", "pago"];
const PLANCHAS = "Planchas de acero 1 mm";
const TORNILLOS = "Tornillería M6 (caja 100 uds)";
const ESTANTERIA = "Estantería metálica 5 baldas";
let db: PGlite;

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
async function articulo(g: number, nombre: string) {
  const r = await db.query<{ id: string; unidades: string; valor: string }>("select id, unidades, valor from public.articulos where empresa_id = $1 and nombre = $2", [g, nombre]);
  return { id: r.rows[0].id, unidades: Number(r.rows[0].unidades), valor: Number(r.rows[0].valor) };
}
async function pedir(u: string, vendedor: number, lineas: [string, number][], dias: number | null) {
  const ls = [];
  for (const [n, unidades] of lineas) {
    const c = await db.query<{ id: string }>("select id from public.catalogo where empresa_id = $1 and nombre = $2", [vendedor, n]);
    ls.push({ catalogo_id: c.rows[0].id, unidades });
  }
  const [r] = await acto(u, "select public.crear_pedido($1::smallint, $2::jsonb, $3) id", [vendedor, JSON.stringify(ls), dias]);
  return Number(r.id);
}
async function facturar(u: string, p: number, dto = 0, portes = 0, iva = 21) {
  const ls = (await db.query<{ id: string; unidades: string; precio: string }>("select id, unidades, precio from public.pedido_lineas where pedido_id = $1 order by id", [p])).rows;
  const lineas = ls.map((l) => ({ linea_id: Number(l.id), unidades: Number(l.unidades), precio: Number(l.precio) }));
  await acto(u, "select public.emitir_factura($1, $2::jsonb, $3, 0, 0, $4, 0, $5, 0, 15)", [p, JSON.stringify(lineas), dto, portes, iva]);
}
const ficha = (u: string, art: string) => acto(u, "select * from public.ficha_almacen($1) order by id", [art]);

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
  await dia("2026-11-09");
}, 60000);

describe("fichas iniciales", () => {
  it("cada artículo abre su ficha con las existencias iniciales", async () => {
    const a = await articulo(2, PLANCHAS);
    const f = await ficha(U.g2, a.id);
    expect(f).toHaveLength(1);
    expect(f[0].concepto).toBe("Existencias iniciales facilitadas");
    expect(Number(f[0].existencias_pmp)).toBe(10);
  });
  it("nadie ve el almacén ni las fichas de otra empresa", async () => {
    const a = await articulo(2, PLANCHAS);
    await expect(ficha(U.g3, a.id)).rejects.toThrow(/otra empresa/);
    await expect(acto(U.g3, "select * from public.almacen(2::smallint)")).rejects.toThrow(/otra empresa/);
    await expect(ficha(U.g5, a.id)).rejects.toThrow(/otra empresa/);
    expect(await acto(U.g2, "select * from public.movimientos_almacen")).toHaveLength(0);
    expect(await acto(U.prof, "select * from public.almacen(2::smallint)")).toHaveLength(5);
  });
  it("las existencias vinculan al comprador con su proveedor por id", async () => {
    const r = await db.query("select 1 from public.articulos c join public.articulos v on v.id = c.articulo_proveedor_id where c.empresa_id = 2 and v.empresa_id = 1");
    expect(r.rows).toHaveLength(3);
  });
});

describe("casos numéricos obligatorios", () => {
  let p = 0;
  let o = 0;
  it("el albarán saca a PMP y se bloquea sin existencias", async () => {
    const sin = await pedir(U.g2, 1, [[PLANCHAS, 601]], 1);
    await acto(U.g1, "select public.aceptar_pedido($1)", [sin]);
    await dia("2026-11-10");
    await expect(acto(U.g1, "select public.emitir_albaran($1)", [sin])).rejects.toThrow(/No hay existencias suficientes/);
    await acto(U.g1, "select public.rechazar_pedido($1, 'x')", [sin]).catch(() => null);
    await dia("2026-11-09");
    p = await pedir(U.g2, 1, [[PLANCHAS, 400], [TORNILLOS, 100]], 1);
    await acto(U.g1, "select public.aceptar_pedido($1)", [p]);
    await dia("2026-11-10");
    await acto(U.g1, "select public.emitir_albaran($1)", [p]);
    const a = await articulo(1, PLANCHAS);
    expect(a.unidades).toBe(200);
    expect(a.valor).toBe(1600);
  });
  it("la entrada al precio del pedido da un PMP de 10,8696", async () => {
    await acto(U.g2, "select public.confirmar_recepcion($1)", [p]);
    const a = await articulo(2, PLANCHAS);
    expect(a.unidades).toBe(920);
    const f = await ficha(U.g2, a.id);
    expect(Number(f[f.length - 1].existencias_pmp)).toBe(10.8696);
    expect(Number(f[f.length - 1].entrada_precio)).toBe(12);
  });
  it("la factura aceptada regulariza −203,08 con un coste real de 11,4923", async () => {
    await facturar(U.g1, p, 5, 40, 21);
    const [t] = await acto(U.g2, "select base, total from public.facturas where pedido_id = $1", [p]);
    expect(Number(t.base)).toBe(4980);
    expect(Number(t.total)).toBe(6025.8);
    await acto(U.g2, "select public.aceptar_factura($1, $2)", [p, LISTA]);
    const a = await articulo(2, PLANCHAS);
    const f = await ficha(U.g2, a.id);
    const reg = Number(f[f.length - 1].regularizacion);
    expect(reg).toBe(-203.08);
    expect((12 + reg / 400).toFixed(4)).toBe("11.4923");
    expect(a.valor).toBe(9796.92);
  });
  it("la rectificativa por devolver 10 planchas da −114,00 y −137,94", async () => {
    const [l] = (await db.query<{ id: string }>("select id from public.pedido_lineas where pedido_id = $1 order by id limit 1", [p])).rows;
    await expect(acto(U.g2, "select public.emitir_rectificativa($1, 'devolucion', $2::jsonb, null)", [p, JSON.stringify([{ linea_id: Number(l.id), unidades: 10 }])])).rejects.toThrow(/emisor/);
    await expect(acto(U.g1, "select public.emitir_rectificativa($1, 'devolucion', $2::jsonb, null)", [p, JSON.stringify([{ linea_id: Number(l.id), unidades: 401 }])])).rejects.toThrow(/no pueden superar/);
    await acto(U.g1, "select public.emitir_rectificativa($1, 'devolucion', $2::jsonb, null)", [p, JSON.stringify([{ linea_id: Number(l.id), unidades: 10 }])]);
    const [r] = await acto(U.g2, "select num, base, total from public.rectificativas where pedido_id = $1", [p]);
    expect(r.num).toBe("R1-0001");
    expect(Number(r.base)).toBe(-114);
    expect(Number(r.total)).toBe(-137.94);
    expect(await acto(U.g3, "select * from public.rectificativas")).toHaveLength(0);
  });
  it("con la rectificativa pendiente no se puede ordenar el pago", async () => {
    await acto(U.g2, "select public.marcar_registro($1, 'borrador')", [p]);
    await acto(U.g2, "select public.marcar_registro($1, 'diario')", [p]);
    await expect(acto(U.g2, "select public.ordenar_pago($1, true)", [p])).rejects.toThrow(/rectificativa pendiente/);
  });
  it("aceptarla mueve los dos almacenes", async () => {
    await expect(acto(U.g1, "select public.aceptar_rectificativa($1)", [p])).rejects.toThrow(/Solo el receptor/);
    await acto(U.g2, "select public.aceptar_rectificativa($1)", [p]);
    const comprador = await articulo(2, PLANCHAS);
    expect(comprador.unidades).toBe(910);
    expect(comprador.valor).toBe(9682.92);
    const fc = await ficha(U.g2, comprador.id);
    expect(Number(fc[fc.length - 1].salida_precio)).toBe(11.4);
    const vendedor = await articulo(1, PLANCHAS);
    expect(vendedor.unidades).toBe(210);
    expect(vendedor.valor).toBe(1680);
    const fv = await ficha(U.g1, vendedor.id);
    expect(Number(fv[fv.length - 1].entrada_precio)).toBe(8);
  });
  it("a transferir 5.887,86 más 1,50 de comisión", async () => {
    const [r] = await acto(U.g2, "select public.ordenar_pago($1, true) id", [p]);
    o = Number(r.id);
    const [x] = await acto(U.g5, "select importe, comision from public.ordenes_pago where id = $1", [o]);
    expect(Number(x.importe)).toBe(5887.86);
    expect(Number(x.comision)).toBe(1.5);
    await acto(U.g5, "select public.ejecutar_orden($1)", [o]);
    const s = await db.query<{ s: string }>("select saldo s from public.movimientos_banco where empresa_id = 2 order by id desc limit 1");
    expect(Number(s.rows[0].s)).toBe(21110.64);
  });
  it("tras el pago ya no se emiten rectificativas", async () => {
    await expect(acto(U.g1, "select public.emitir_rectificativa($1, 'rappel', null, 50)", [p])).rejects.toThrow(/antes del pago/);
  });
});

describe("rectificativas sin devolución", () => {
  it("un rappel fuera de factura se puede rechazar y no mueve existencias", async () => {
    await dia("2026-11-11");
    const p = await pedir(U.g3, 2, [[ESTANTERIA, 1]], 1);
    await acto(U.g2, "select public.aceptar_pedido($1)", [p]);
    await dia("2026-11-12");
    await acto(U.g2, "select public.emitir_albaran($1)", [p]);
    await acto(U.g3, "select public.confirmar_recepcion($1)", [p]);
    await facturar(U.g2, p);
    await acto(U.g3, "select public.aceptar_factura($1, $2)", [p, LISTA]);
    const antes = await articulo(3, ESTANTERIA);
    await expect(acto(U.g2, "select public.emitir_rectificativa($1, 'rappel', null, 0)", [p])).rejects.toThrow(/base del descuento/);
    await acto(U.g2, "select public.emitir_rectificativa($1, 'rappel', null, 10)", [p]);
    await expect(acto(U.g3, "select public.rechazar_rectificativa($1, '')", [p])).rejects.toThrow(/motivo/);
    await acto(U.g3, "select public.rechazar_rectificativa($1, 'Importe incorrecto')", [p]);
    const despues = await articulo(3, ESTANTERIA);
    expect(despues.valor).toBe(antes.valor);
  });
});

describe("comprador nuevo de un artículo", () => {
  it("se le crea un artículo vinculado, o usa el que él elija", async () => {
    await dia("2026-11-11");
    const p = await pedir(U.g6, 1, [[PLANCHAS, 1]], 1);
    await acto(U.g1, "select public.aceptar_pedido($1)", [p]);
    await dia("2026-11-12");
    await acto(U.g1, "select public.emitir_albaran($1)", [p]);
    const pend = await acto(U.g6, "select * from public.lineas_por_vincular($1)", [p]);
    expect(pend).toHaveLength(1);
    await expect(acto(U.g3, "select * from public.lineas_por_vincular($1)", [p])).rejects.toThrow(/Solo el comprador/);
    await acto(U.g6, "select public.confirmar_recepcion($1)", [p]);
    const a = await articulo(6, PLANCHAS);
    expect(a.unidades).toBe(1);
    const q = await pedir(U.g6, 1, [[TORNILLOS, 2]], 1);
    await dia("2026-11-12");
    await acto(U.g1, "select public.aceptar_pedido($1)", [q]);
    await dia("2026-11-13");
    await acto(U.g1, "select public.emitir_albaran($1)", [q]);
    const [l] = (await db.query<{ id: string }>("select id from public.pedido_lineas where pedido_id = $1", [q])).rows;
    await acto(U.g6, "select public.confirmar_recepcion($1, $2::jsonb)", [q, JSON.stringify({ [l.id]: a.id })]);
    expect((await articulo(6, PLANCHAS)).unidades).toBe(3);
  });
});

describe("fabricación del G2", () => {
  it("consume a PMP, da de alta al coste y bloquea si falta materia", async () => {
    const prod = await articulo(2, ESTANTERIA);
    const antes = prod.unidades;
    const m1 = await articulo(2, TORNILLOS);
    await expect(acto(U.g3, "select public.fabricar($1, 1)", [prod.id])).rejects.toThrow(/Solo el G2/);
    await expect(acto(U.g2, "select public.fabricar($1, 100000)", [prod.id])).rejects.toThrow(/Falta materia prima/);
    const [r] = await acto(U.g2, "select public.fabricar($1, 10) n", [prod.id]);
    expect(r.n).toBe("OF2-0001");
    const despues = await articulo(2, ESTANTERIA);
    expect(despues.unidades).toBe(antes + 10);
    expect((await articulo(2, TORNILLOS)).unidades).toBe(m1.unidades - 10);
    const [o] = await acto(U.g2, "select coste from public.ordenes_fabricacion where num = 'OF2-0001'");
    expect(despues.valor).toBe(Math.round((prod.valor + Number(o.coste)) * 100) / 100);
    expect(await acto(U.g2, "select * from public.fabricacion_lineas")).toHaveLength(2);
    expect(await acto(U.g3, "select * from public.ordenes_fabricacion")).toHaveLength(0);
  });
});

describe("venta en tienda del G6", () => {
  it("emite ticket con IVA, cobra por TPV y saca a PMP", async () => {
    const a = await articulo(6, ESTANTERIA);
    await expect(acto(U.g3, "select public.vender_tienda($1, 1)", [a.id])).rejects.toThrow(/Solo el G6/);
    await expect(acto(U.g6, "select public.vender_tienda($1, 100000)", [a.id])).rejects.toThrow(/existencias/);
    const s0 = await db.query<{ s: string }>("select saldo s from public.movimientos_banco where empresa_id = 6 order by id desc limit 1");
    const [r] = await acto(U.g6, "select public.vender_tienda($1, 1) n", [a.id]);
    expect(r.n).toBe("T6-0001");
    const [t] = await acto(U.g6, "select base, cuota, total, coste from public.tickets");
    expect(Number(t.base)).toBe(149);
    expect(Number(t.cuota)).toBe(31.29);
    expect(Number(t.total)).toBe(180.29);
    expect(Number(t.coste)).toBe(105);
    const s1 = await db.query<{ s: string }>("select saldo s from public.movimientos_banco where empresa_id = 6 order by id desc limit 1");
    expect(Math.round((Number(s1.rows[0].s) - Number(s0.rows[0].s)) * 100) / 100).toBe(180.29);
    expect(await acto(U.g1, "select * from public.tickets")).toHaveLength(0);
  });
});

describe("modo práctica", () => {
  it("oculta PMP y valoraciones, y comprueba el PMP del alumno con ±0,01", async () => {
    await expect(acto(U.g2, "select public.activar_modulo('pmp_oculto', true)")).rejects.toThrow(/Solo la profesora/);
    await acto(U.prof, "select public.activar_modulo('pmp_oculto', true)");
    const a = await articulo(2, PLANCHAS);
    const [x] = await acto(U.g2, "select * from public.almacen(2::smallint) where id = $1", [a.id]);
    expect(x.pmp).toBe(null);
    expect(x.valor).toBe(null);
    const f = await ficha(U.g2, a.id);
    const entrada = f.find((m) => m.documento === "A1-0001");
    expect(entrada?.existencias_pmp).toBe(null);
    expect(Number(entrada?.entrada_precio)).toBe(12);
    const salida = f.find((m) => m.salida_uds !== null);
    expect(salida?.salida_precio).toBe(null);
    expect(salida?.salida_importe).toBe(null);
    const [mal] = await acto(U.g2, "select public.comprobar_pmp($1, 11) ok", [entrada?.id]);
    expect(mal.ok).toBe(false);
    const [bien] = await acto(U.g2, "select public.comprobar_pmp($1, 10.87) ok", [entrada?.id]);
    expect(bien.ok).toBe(true);
    await expect(acto(U.g3, "select public.comprobar_pmp($1, 10)", [entrada?.id])).rejects.toThrow(/no es de tu almacén/);
    const [p] = await acto(U.prof, "select * from public.ficha_almacen($1) where id = $2", [a.id, entrada?.id]);
    expect(Number(p.existencias_pmp)).toBe(10.8696);
    await acto(U.prof, "select public.activar_modulo('pmp_oculto', false)");
  });
});

describe("permisos del almacén", () => {
  it("nadie escribe directamente ni llama a las funciones internas", async () => {
    await expect(acto(U.g2, "update public.articulos set unidades = 1")).rejects.toThrow(/permission denied/);
    await expect(acto(U.g2, "insert into public.tickets (num) values ('x')")).rejects.toThrow(/permission denied/);
    const a = await articulo(2, PLANCHAS);
    await expect(acto(U.g2, "select public._entrada($1, 1, 1, 'x', 'x')", [a.id])).rejects.toThrow(/permission denied/);
    await expect(acto(U.g2, "select public._iniciar_almacen()")).rejects.toThrow(/permission denied/);
  });
});

describe("correo entre empresas", () => {
  let c = 0;
  it("se envía con asunto y lo ven las dos empresas y la profesora", async () => {
    await expect(acto(U.g1, "select public.enviar_correo(2::smallint, '', 'Hola')")).rejects.toThrow(/asunto/);
    await expect(acto(U.g1, "select public.enviar_correo(2::smallint, 'Consulta', '  ')")).rejects.toThrow(/mensaje/);
    await expect(acto(U.g1, "select public.enviar_correo(1::smallint, 'Consulta', 'Hola')")).rejects.toThrow(/propia empresa/);
    await expect(acto(U.prof, "select public.enviar_correo(1::smallint, 'Consulta', 'Hola')")).rejects.toThrow(/no actúa/);
    const [r] = await acto(U.g1, "select public.enviar_correo(2::smallint, 'Consulta de precios', 'Buenos días') id");
    c = Number(r.id);
    const [g] = await acto(U.g2, "select autor_nombre, remitente_id, hilo_id, leido_en from public.correos where id = $1", [c]);
    expect(g.autor_nombre).toBe("Alumno g1");
    expect(Number(g.hilo_id)).toBe(c);
    expect(g.leido_en).toBe(null);
    expect(await acto(U.g3, "select * from public.correos")).toHaveLength(0);
    expect(await acto(U.g5, "select * from public.correos")).toHaveLength(0);
    expect(await acto(U.prof, "select * from public.correos where id = $1", [c])).toHaveLength(1);
  });
  it("solo cuenta como leído si lo abre la destinataria", async () => {
    await acto(U.g3, "select public.marcar_correo_leido($1)", [c]);
    await acto(U.g1, "select public.marcar_correo_leido($1)", [c]);
    await expect(acto(U.prof, "select public.marcar_correo_leido($1)", [c])).rejects.toThrow(/no actúa/);
    const [a] = await db.query<{ leido_en: string | null }>("select leido_en from public.correos where id = $1", [c]).then((x) => x.rows);
    expect(a.leido_en).toBe(null);
    await acto(U.g2, "select public.marcar_correo_leido($1)", [c]);
    const [b] = await acto(U.g1, "select leido_por_nombre from public.correos where id = $1", [c]);
    expect(b.leido_por_nombre).toBe("Alumno g2");
  });
  it("la respuesta sigue el hilo y va siempre a la otra empresa", async () => {
    await expect(acto(U.g3, "select public.enviar_correo(1::smallint, 'x', 'y', $1)", [c])).rejects.toThrow(/no es de tu empresa/);
    const [r] = await acto(U.g2, "select public.enviar_correo(3::smallint, '', 'Respondo', $1) id", [c]);
    const [x] = await acto(U.g1, "select destinatario_id, asunto, hilo_id from public.correos where id = $1", [r.id]);
    expect(x.destinatario_id).toBe(1);
    expect(x.asunto).toBe("Re: Consulta de precios");
    expect(Number(x.hilo_id)).toBe(c);
  });
  it("no se edita ni se borra, y solo se asocia a una operación de las dos empresas", async () => {
    await expect(acto(U.g1, "update public.correos set cuerpo = 'x'")).rejects.toThrow(/permission denied/);
    await expect(acto(U.g1, "delete from public.correos")).rejects.toThrow(/permission denied/);
    const [ajena] = (await db.query<{ id: string }>("select id from public.pedidos where comprador_id = 3 limit 1")).rows;
    await expect(acto(U.g1, "select public.enviar_correo(4::smallint, 'x', 'y', null, $1)", [ajena.id])).rejects.toThrow(/no es entre estas dos/);
  });
});
