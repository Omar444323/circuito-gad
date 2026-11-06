import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// Comprueba que las pantallas piden a la base de datos lo que existe: funciones, argumentos, tablas y columnas
let db: PGlite;
const archivos: { ruta: string; texto: string }[] = [];
function leer(dir: string) {
  for (const n of readdirSync(dir)) {
    const r = join(dir, n);
    if (statSync(r).isDirectory()) leer(r);
    else if (/\.tsx?$/.test(n)) archivos.push({ ruta: r, texto: readFileSync(r, "utf8") });
  }
}
function llavesDe(texto: string, desde: number) {
  let nivel = 0;
  for (let i = desde; i < texto.length; i++) {
    if ("{[(".includes(texto[i])) nivel++;
    if ("}])".includes(texto[i]) && --nivel === 0) return texto.slice(desde, i + 1);
  }
  return "";
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync("tests/auth-stub.sql", "utf8"));
  const dir = "supabase/migrations";
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(dir + "/" + f, "utf8"));
  ["app", "components", "lib"].forEach(leer);
}, 60000);

describe("contrato entre pantallas y base de datos", () => {
  it("cada llamada usa una función que existe, con sus argumentos", async () => {
    const fallos: string[] = [];
    let vistas = 0;
    for (const { ruta, texto } of archivos) {
      for (const m of texto.matchAll(/\brpc\(\s*"(\w+)"\s*(,\s*\{)?/g)) {
        vistas++;
        const { rows } = await db.query<{ a: string[] | null; d: number }>("select proargnames a, pronargdefaults d from pg_proc where pronamespace = 'public'::regnamespace and proname = $1", [m[1]]);
        if (!rows.length) { fallos.push(ruta + ": no existe " + m[1]); continue; }
        const nombres = (rows[0].a ?? []).filter((x) => x.startsWith("p_"));
        const obligatorios = nombres.slice(0, nombres.length - rows[0].d);
        const cuerpo = m[2] ? llavesDe(texto, m.index + m[0].length - 1) : "";
        const usados = [...cuerpo.matchAll(/\b(p_\w+)\b(?=\s*[:,}])/g)].map((x) => x[1]);
        for (const u of usados) if (!nombres.includes(u)) fallos.push(ruta + ": " + m[1] + " no tiene " + u);
        for (const o of obligatorios) if (!usados.includes(o)) fallos.push(ruta + ": a " + m[1] + " le falta " + o);
      }
    }
    expect(fallos).toEqual([]);
    expect(vistas).toBeGreaterThan(50);
  });

  it("cada tabla y columna pedida existe", async () => {
    const fallos: string[] = [];
    const existe = async (t: string, c: string) => {
      const col = await db.query("select 1 from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = $2", [t, c]);
      if (col.rows.length) return true;
      // Columna calculada: una función con la fila de la tabla como argumento
      const fn = await db.query("select 1 from pg_proc p join pg_type ty on ty.oid = p.proargtypes[0] where p.pronamespace = 'public'::regnamespace and p.proname = $1 and ty.typname = $2", [c, t]);
      return fn.rows.length > 0;
    };
    for (const { ruta, texto } of archivos) {
      for (const m of texto.matchAll(/\.from\("(\w+)"\)((?:\s*\.\w+\((?:[^()]|\([^()]*\))*\))*)/g)) {
        const [, tabla, cadena] = m;
        const { rows } = await db.query("select 1 from information_schema.tables where table_schema = 'public' and table_name = $1", [tabla]);
        if (!rows.length) { fallos.push(ruta + ": no existe la tabla " + tabla); continue; }
        const sel = cadena.match(/\.select\("([^"]*)"/)?.[1] ?? "";
        // Sin paréntesis ni alias: las relaciones anidadas se comprueban con las columnas sueltas de su tabla
        const planas = sel.replace(/[\w:]+\([^()]*\)/g, "").split(",").map((x) => x.trim()).filter((x) => x && x !== "*");
        const filtros = [...cadena.matchAll(/\.(?:eq|neq|is|not|order)\(\s*"(\w+)"/g)].map((x) => x[1]);
        for (const c of [...planas, ...filtros]) if (!(await existe(tabla, c))) fallos.push(ruta + ": " + tabla + "." + c);
        for (const n of sel.matchAll(/(\w+)\(([^()]*)\)/g)) {
          for (const c of n[2].split(",").map((x) => x.trim()).filter((x) => x && x !== "*")) if (!(await existe(n[1], c))) fallos.push(ruta + ": " + n[1] + "." + c);
        }
      }
    }
    expect(fallos).toEqual([]);
  });
});
