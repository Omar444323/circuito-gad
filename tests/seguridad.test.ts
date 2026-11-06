import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

// Revisión general: si una migración futura se olvida de un permiso, falla aquí
let db: PGlite;
const filas = async <T>(sql: string) => (await db.query<T>(sql)).rows;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync("tests/auth-stub.sql", "utf8"));
  const dir = "supabase/migrations";
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(dir + "/" + f, "utf8"));
}, 60000);

describe("permisos de la base de datos", () => {
  it("todas las tablas tienen RLS activado", async () => {
    const r = await filas<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public' and not rowsecurity");
    expect(r.map((x) => x.tablename)).toEqual([]);
  });
  it("todas las tablas tienen alguna política de lectura o quedan cerradas a propósito", async () => {
    const r = await filas<{ t: string }>(`select c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege('authenticated', c.oid, 'select') and not exists (select 1 from pg_policy p where p.polrelid = c.oid)`);
    expect(r.map((x) => x.t)).toEqual([]);
  });
  it("ningún cliente escribe directamente en ninguna tabla", async () => {
    const r = await filas<{ t: string; g: string; p: string }>(`select table_name t, grantee g, privilege_type p from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon','authenticated','PUBLIC') and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')`);
    expect(r).toEqual([]);
  });
  it("sin sesión no se lee ninguna tabla", async () => {
    const r = await filas<{ t: string }>("select table_name t from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon','PUBLIC') and privilege_type = 'SELECT'");
    expect(r).toEqual([]);
  });
  it("todas las funciones security definer fijan search_path", async () => {
    const r = await filas<{ f: string }>(`select p.oid::regprocedure::text f from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
    expect(r.map((x) => x.f)).toEqual([]);
  });
  it("sin sesión no se ejecuta ninguna función", async () => {
    const r = await filas<{ f: string }>("select p.oid::regprocedure::text f from pg_proc p where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute')");
    expect(r.map((x) => x.f)).toEqual([]);
  });
  it("las funciones internas no se llaman desde fuera", async () => {
    const r = await filas<{ f: string }>("select p.oid::regprocedure::text f from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like '\\_%' and has_function_privilege('authenticated', p.oid, 'execute')");
    expect(r.map((x) => x.f)).toEqual([]);
  });
});

describe("secretos", () => {
  const fuente = execSync("git ls-files app components lib proxy.ts").toString().trim().split(/\r?\n/).filter((f) => /\.tsx?$/.test(f));
  const texto = (f: string) => readFileSync(f, "utf8");
  it("la clave service_role solo se lee en lib/supabase.ts, marcado como solo de servidor", () => {
    expect(fuente.filter((f) => texto(f).includes("SERVICE_ROLE"))).toEqual(["lib/supabase.ts"]);
    expect(texto("lib/supabase.ts")).toContain('import "server-only"');
  });
  it("ningún componente de cliente importa el acceso a la base de datos del servidor", () => {
    const cliente = fuente.filter((f) => /^["']use client["']/.test(texto(f)));
    expect(cliente.filter((f) => /lib\/supabase|lib\/sesion/.test(texto(f)))).toEqual([]);
  });
  it("no hay ninguna clave escrita en el código", () => {
    expect(fuente.filter((f) => /eyJ[A-Za-z0-9_-]{20,}\.|sb_secret_/.test(texto(f)))).toEqual([]);
  });
});
