import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { aCsv, aXlsx, leerCsv, nombreHoja, type Hoja } from "../lib/exportar";

const U = {
  prof: "00000000-0000-0000-0000-000000000000",
  g1: "00000000-0000-0000-0000-000000000011",
  g2: "00000000-0000-0000-0000-000000000021",
  g3: "00000000-0000-0000-0000-000000000031",
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
const saldo = async (g: number) => Number((await db.query<{ s: string }>("select saldo s from public.movimientos_banco where empresa_id = $1 order by id desc limit 1", [g])).rows[0]?.s ?? 0);
const fila = (o: Record<string, unknown>) => ({ tipo: "factura", num: "F-1", fecha: "2026-11-03", emisor: "1", receptor: "2", concepto: "", base: "100", cuota: "21", total: "121", ...o });
const importar = (filas: unknown[], u = U.prof) => acto<{ id: string }>(u, "select public.importar_documentos('Prueba', $1::jsonb) id", [JSON.stringify(filas)]);
const archivo = (u: string, g: number, t: string | null = null) => acto<{ tipo: string; num: string; sentido: string; estado: string }>(u, "select * from public.archivo_documentos($1::smallint, $2)", [g, t]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync("tests/auth-stub.sql", "utf8"));
  const dir = "supabase/migrations";
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(dir + "/" + f, "utf8"));
  await db.exec(readFileSync("supabase/seed.sql", "utf8"));
  for (const [k, id] of Object.entries(U)) {
    await db.query("insert into auth.users values ($1)", [id]);
    await db.query("insert into public.perfiles (id, usuario, nombre, rol, empresa_id) values ($1,$2,$3,$4,$5)", [id, k, "Persona " + k, k === "prof" ? "profesora" : "alumno", k === "prof" ? null : Number(k[1])]);
  }
  await db.query("update public.ajustes_demo set permitido = true, fecha_simulada = '2026-11-20'");
}, 60000);

describe("importador", () => {
  it("solo la profesora importa", async () => {
    await expect(importar([fila({})], U.g1)).rejects.toThrow(/Solo la profesora/);
  });
  it("los pagos mueven los saldos con su fecha real y el resto solo se archiva", async () => {
    const [a, b] = [await saldo(1), await saldo(2)];
    await importar([fila({}), fila({ tipo: "pago", num: "T-1", fecha: "2026-11-05", emisor: "2", receptor: "1", base: null, cuota: null, total: "121" })]);
    expect(await saldo(1)).toBeCloseTo(a + 121, 2);
    expect(await saldo(2)).toBeCloseTo(b - 121, 2);
    const m = await db.query<{ fecha: Date }>("select fecha from public.movimientos_banco where empresa_id = 2 and concepto like 'Importado%' order by id desc limit 1");
    expect(new Date(m.rows[0].fecha).toISOString().slice(0, 10)).toBe("2026-11-05");
  });
  it("una fila mala no carga ninguna, y el error dice cuál es", async () => {
    const a = await saldo(1);
    await expect(importar([fila({ tipo: "pago", num: "T-2", emisor: "2", receptor: "1" }), fila({ num: "F-9", fecha: "2026-10-01" })])).rejects.toThrow(/Fila 2: la fecha/);
    expect(await saldo(1)).toBe(a);
    await expect(importar([fila({ num: "F-1" })])).rejects.toThrow(/Fila 1: el documento F-1 ya está importado/);
    await expect(importar([fila({ num: "F-3", tipo: "cosa" })])).rejects.toThrow(/Fila 1: el tipo cosa/);
    await expect(importar([fila({ num: "F-3", total: "abc" })])).rejects.toThrow(/Fila 1: hay un dato/);
    await expect(importar([fila({ num: "F-3", receptor: "1" })])).rejects.toThrow(/Fila 1: el receptor/);
    await expect(importar([fila({ tipo: "pago", num: "T-3", receptor: null })])).rejects.toThrow(/necesita receptor/);
  });
  it("cada parte ve lo suyo, y la de fuera nada", async () => {
    expect(await acto(U.g1, "select id from public.documentos_importados")).toHaveLength(2);
    expect(await acto(U.g3, "select id from public.documentos_importados")).toHaveLength(0);
    expect(await acto(U.g1, "select id from public.lotes_importados")).toHaveLength(0);
  });
  it("cuenta para comparar el IVA", async () => {
    const [r] = await acto<{ repercutido: string; soportado: string }>(U.prof, "select * from public.iva_calculado(1::smallint, '2026-11')");
    expect(Number(r.repercutido)).toBe(21);
  });
  it("anular deja los saldos como estaban", async () => {
    const [a, b] = [await saldo(1), await saldo(2)];
    const [r] = await importar([fila({ tipo: "pago", num: "T-5", emisor: "1", receptor: "2", total: "50" })]);
    expect(await saldo(1)).toBeCloseTo(a - 50, 2);
    await expect(acto(U.g1, "select public.anular_importacion($1)", [r.id])).rejects.toThrow(/Solo la profesora/);
    await acto(U.prof, "select public.anular_importacion($1)", [r.id]);
    expect(await saldo(1)).toBeCloseTo(a, 2);
    expect(await saldo(2)).toBeCloseTo(b, 2);
    await expect(acto(U.prof, "select public.anular_importacion($1)", [r.id])).rejects.toThrow(/ya está anulada/);
    await importar([fila({ tipo: "pago", num: "T-5", emisor: "1", receptor: "2", total: "50" })]);
  });
});

describe("archivo", () => {
  it("muestra lo emitido y lo recibido, y filtra por tipo", async () => {
    const g1 = await archivo(U.g1, 1, "factura");
    expect(g1.find((d) => d.num === "F-1")?.sentido).toBe("emitido");
    const g2 = await archivo(U.g2, 2, "factura");
    expect(g2.find((d) => d.num === "F-1")?.sentido).toBe("recibido");
    expect((await archivo(U.g1, 1, "albaran")).some((d) => d.num === "F-1")).toBe(false);
  });
  it("no deja consultar otra empresa, salvo a la profesora", async () => {
    await expect(archivo(U.g3, 1)).rejects.toThrow(/otra empresa/);
    expect((await archivo(U.prof, 1)).length).toBeGreaterThan(0);
  });
  it("incluye una operación real con todos sus documentos, también el albarán rechazado", async () => {
    const c = await db.query<{ id: string }>("select id from public.catalogo where empresa_id = 1 and nombre = 'Planchas de acero 1 mm' and activo");
    const [r] = await acto<{ id: string }>(U.g2, "select public.crear_pedido(1::smallint, $1::jsonb, 1, true) id", [JSON.stringify([{ catalogo_id: c.rows[0].id, unidades: 2 }])]);
    await acto(U.g1, "select public.aceptar_pedido($1)", [r.id]);
    await db.query("update public.pedidos set entrega_fecha = public.hoy() where id = $1", [r.id]);
    await acto(U.g1, "select public.emitir_albaran($1)", [r.id]);
    await acto(U.g2, "select public.rechazar_albaran($1, 'Documento incorrecto')", [r.id]);
    const docs = await archivo(U.g2, 2);
    expect(docs.some((d) => d.tipo === "pedido" && d.sentido === "emitido")).toBe(true);
    expect(docs.some((d) => d.tipo === "albaran" && d.estado === "rechazado" && d.sentido === "recibido")).toBe(true);
  });
});

const HOJA: Hoja = {
  nombre: "Libro",
  columnas: [{ titulo: "Número", clave: "num" }, { titulo: "Fecha", clave: "fecha", tipo: "fecha" }, { titulo: "Importe", clave: "imp", tipo: "dinero" }, { titulo: "Concepto", clave: "c" }],
  filas: [{ num: "F1-0001", fecha: "2026-11-03", imp: 1452.5, c: 'Con ; y "comillas"' }, { num: "F1-0002", fecha: null, imp: null, c: "=HYPERLINK(1)" }],
};
describe("exportación", () => {
  it("el CSV usa punto y coma, coma decimal, fecha española y BOM", () => {
    const t = aCsv([HOJA]);
    expect(t.startsWith("﻿")).toBe(true);
    expect(t).toContain("Número;Fecha;Importe;Concepto\r\n");
    expect(t).toContain('F1-0001;03/11/2026;1452,50;"Con ; y ""comillas"""');
  });
  it("neutraliza fórmulas escritas por los alumnos", () => {
    expect(aCsv([HOJA])).toContain("F1-0002;;;'=HYPERLINK(1)");
  });
  it("genera un .xlsx con fechas e importes de verdad", async () => {
    const b = await aXlsx([HOJA]);
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(b as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Libro")!;
    expect(ws.getCell("C2").value).toBe(1452.5);
    expect(ws.getCell("B2").value).toBeInstanceOf(Date);
    expect(ws.getCell("D3").value).toBe("'=HYPERLINK(1)");
  });
  it("los nombres de hoja son válidos y no se repiten", () => {
    const u = new Set<string>();
    expect(nombreHoja("Tornillo 3/4: inox", u)).toBe("Tornillo 3 4  inox");
    expect(nombreHoja("A".repeat(40), u)).toHaveLength(28);
    expect(nombreHoja("A".repeat(40), u)).toHaveLength(30);
  });
});

describe("lectura del CSV", () => {
  it("entiende coma decimal, miles, fecha española y G1", () => {
    const { filas, error } = leerCsv("﻿tipo;num;fecha;emisor;receptor;concepto;base;cuota;total\r\nFactura;F-12;3/11/2026;G1;g2;\"Con ; dentro\";1.200,00;252,00;1.452,50 €\r\npago;T-1;05/11/2026;2;1;;;;10\r\n");
    expect(error).toBeUndefined();
    expect(filas[0]).toEqual({ tipo: "factura", num: "F-12", fecha: "2026-11-03", emisor: "1", receptor: "2", concepto: "Con ; dentro", base: "1200.00", cuota: "252.00", total: "1452.50" });
    expect(filas[1]).toMatchObject({ tipo: "pago", base: null, cuota: null, total: "10" });
  });
  it("admite lo pegado desde Excel, con tabuladores", () => {
    const { filas } = leerCsv("tipo\tnum\tfecha\temisor\treceptor\tconcepto\tbase\tcuota\ttotal\nticket\tT1\t03/11/2026\t6\t\t\t\t\t5,5");
    expect(filas[0]).toMatchObject({ tipo: "ticket", receptor: null, total: "5.5" });
  });
  it("avisa de lo que falta", () => {
    expect(leerCsv("tipo;num\nfactura;1").error).toMatch(/fecha, emisor/);
    expect(leerCsv("solo una línea").error).toMatch(/títulos/);
  });
});
