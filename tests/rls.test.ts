import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const U = {
  prof: "00000000-0000-0000-0000-000000000000",
  g1a: "00000000-0000-0000-0000-000000000011",
  g1b: "00000000-0000-0000-0000-000000000012",
  g2a: "00000000-0000-0000-0000-000000000021",
  g3a: "00000000-0000-0000-0000-000000000031",
  g5a: "00000000-0000-0000-0000-000000000051",
};
let db: PGlite;

// Ejecuta como un usuario real (rol authenticated) y deshace siempre los cambios
async function como<T = Record<string, unknown>>(id: string | null, sql: string, params: unknown[] = [], antes?: string) {
  await db.exec("begin");
  try {
    if (antes) await db.exec(antes);
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [id ?? ""]);
    await db.exec(id ? "set local role authenticated" : "set local role anon");
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec("rollback");
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync("tests/auth-stub.sql", "utf8"));
  const dir = "supabase/migrations";
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(dir + "/" + f, "utf8"));
  await db.exec(readFileSync("supabase/seed.sql", "utf8"));
  for (const id of Object.values(U)) await db.query("insert into auth.users values ($1)", [id]);
  const alta = "insert into public.perfiles (id, usuario, nombre, rol, empresa_id) values ($1,$2,$3,$4,$5)";
  await db.query(alta, [U.prof, "profesora", "Profesora", "profesora", null]);
  await db.query(alta, [U.g1a, "g1.a", "Alumno 1A", "alumno", 1]);
  await db.query(alta, [U.g1b, "g1.b", "Alumno 1B", "alumno", 1]);
  await db.query(alta, [U.g2a, "g2.a", "Alumno 2A", "alumno", 2]);
  await db.query(alta, [U.g3a, "g3.a", "Alumno 3A", "alumno", 3]);
  await db.query(alta, [U.g5a, "g5.a", "Alumno 5A", "alumno", 5]);
}, 60000);

describe("visibilidad", () => {
  it("un usuario del G3 no ve movimientos bancarios del G1", async () => {
    expect(await como(U.g3a, "select * from public.movimientos_banco where empresa_id = 1")).toHaveLength(0);
    expect(await como(U.g3a, "select * from public.movimientos_banco")).toHaveLength(1);
  });
  it("el banco y la profesora ven todos los movimientos", async () => {
    expect(await como(U.g5a, "select * from public.movimientos_banco")).toHaveLength(6);
    expect(await como(U.prof, "select * from public.movimientos_banco")).toHaveLength(6);
  });
  it("un usuario del G3 no ve el almacén del G1, y el banco tampoco", async () => {
    expect(await como(U.g3a, "select * from public.articulos where empresa_id = 1")).toHaveLength(0);
    expect(await como(U.g5a, "select * from public.articulos")).toHaveLength(0);
    expect(await como(U.prof, "select * from public.articulos")).toHaveLength(12);
  });
  it("catálogos y empresas los ven todos; las recetas solo el G2 y la profesora", async () => {
    expect(await como(U.g3a, "select * from public.catalogo")).toHaveLength(13);
    expect(await como(U.g3a, "select * from public.empresas")).toHaveLength(6);
    expect(await como(U.g3a, "select * from public.recetas")).toHaveLength(0);
    expect(await como(U.g2a, "select * from public.recetas_lineas")).toHaveLength(5);
  });
  it("nadie ve perfiles de otro equipo salvo la profesora", async () => {
    expect(await como(U.g3a, "select * from public.perfiles where empresa_id = 1")).toHaveLength(0);
    expect(await como(U.prof, "select * from public.perfiles")).toHaveLength(6);
  });
  it("sin sesión no se lee nada", async () => {
    await expect(como(null, "select * from public.empresas")).rejects.toThrow(/permission denied/);
  });
});

describe("edición entre equipos", () => {
  it("nadie escribe directamente en las tablas, ni en las suyas", async () => {
    await expect(como(U.g1a, "update public.empresas set nombre = 'X' where id = 1")).rejects.toThrow(/permission denied/);
    await expect(como(U.g1a, "insert into public.catalogo (empresa_id, nombre, precio) values (1, 'X', 1)")).rejects.toThrow(/permission denied/);
    await expect(como(U.g1a, "update public.movimientos_banco set importe = 1")).rejects.toThrow(/permission denied/);
  });
  it("un equipo no puede editar a otro llamando a las funciones", async () => {
    await expect(como(U.g3a, "select public.actualizar_empresa(1::smallint, 'X', 'Y')")).rejects.toThrow(/otro equipo/);
    await expect(como(U.g3a, "select public.guardar_catalogo(1::smallint, null, 'X', 5)")).rejects.toThrow(/otro equipo/);
    await expect(como(U.g3a, "select public.dar_baja_integrante($1)", [U.g1a])).rejects.toThrow(/otro equipo/);
    await expect(como(U.g3a, "select public.cambiar_nombre_perfil($1, 'X')", [U.g1a])).rejects.toThrow(/otro equipo/);
    await expect(como(U.g3a, "select public.guardar_receta(gen_random_uuid(), '[]'::jsonb)")).rejects.toThrow(/otro equipo/);
  });
  it("el servidor es el único que da de alta perfiles", async () => {
    await expect(como(U.g1a, "select public.registrar_alta($1, 'x', 'X', 1::smallint, $1)", [U.g1a])).rejects.toThrow(/permission denied/);
  });
  it("el equipo edita lo suyo y queda en el registro de cambios", async () => {
    await db.exec("begin");
    try {
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [U.g1a]);
      await db.exec("set local role authenticated");
      await db.query("select public.actualizar_empresa(1::smallint, 'Ferrán Nuevo', 'Acero')");
      expect((await db.query("select * from public.registro_cambios")).rows).toHaveLength(0);
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [U.prof]);
      const log = (await db.query<{ campo: string; valor_anterior: string; hecho_por: string }>("select * from public.registro_cambios order by id")).rows;
      expect(log.map((l) => l.campo)).toEqual(["nombre", "actividad"]);
      expect(log[0].valor_anterior).toBe("Suministros Ferrán, S.L.");
      expect(log[0].hecho_por).toBe(U.g1a);
    } finally {
      await db.exec("rollback");
    }
  });
  it("solo la profesora mueve alumnos y edita el calendario", async () => {
    await expect(como(U.g1a, "select public.mover_alumno($1, 2::smallint)", [U.g1b])).rejects.toThrow(/Solo la profesora/);
    await expect(como(U.g1a, "select public.marcar_no_lectivo('2026-12-07', 'Puente')")).rejects.toThrow(/Solo la profesora/);
    expect(await como(U.prof, "select public.mover_alumno($1, 2::smallint)", [U.g1b])).toHaveLength(1);
  });
  it("la profesora puede editar cualquier equipo", async () => {
    expect(await como(U.prof, "select public.actualizar_empresa(3::smallint, 'Otro', 'Otra')")).toHaveLength(1);
  });
});

describe("integrantes", () => {
  it("el equipo necesita al menos un integrante activo", async () => {
    await expect(como(U.g3a, "select public.dar_baja_integrante($1)", [U.g3a])).rejects.toThrow(/al menos un integrante/);
    await expect(como(U.prof, "select public.mover_alumno($1, 1::smallint)", [U.g3a])).rejects.toThrow(/al menos un integrante/);
  });
  it("quien está de baja deja de ver datos, pero su perfil se conserva", async () => {
    await db.exec("begin");
    try {
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [U.g1a]);
      await db.exec("set local role authenticated");
      await db.query("select public.dar_baja_integrante($1)", [U.g1b]);
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [U.g1b]);
      expect((await db.query("select * from public.movimientos_banco")).rows).toHaveLength(0);
      expect((await db.query("select * from public.perfiles where id = $1", [U.g1b])).rows).toHaveLength(1);
    } finally {
      await db.exec("rollback");
    }
  });
});

describe("catálogo y recetas", () => {
  it("exige nombre y precio mayor que cero", async () => {
    await expect(como(U.g1a, "select public.guardar_catalogo(1::smallint, null, 'X', 0)")).rejects.toThrow(/mayor que cero/);
    await expect(como(U.g5a, "select public.guardar_catalogo(5::smallint, null, 'X', 3)")).rejects.toThrow(/comisiones/);
  });
  it("admite cantidades decimales en la receta, pero no cero", async () => {
    const [p] = await como<{ id: string }>(U.g2a, "select id from public.articulos where cuenta = 350 limit 1");
    const [m] = await como<{ id: string }>(U.g2a, "select id from public.articulos where cuenta = 310 limit 1");
    expect(await como(U.g2a, "select public.guardar_receta($1, $2::jsonb)", [p.id, JSON.stringify([{ materia_id: m.id, cantidad: 0.5 }])])).toHaveLength(1);
    await expect(como(U.g2a, "select public.guardar_receta($1, $2::jsonb)", [p.id, JSON.stringify([{ materia_id: m.id, cantidad: 0 }])])).rejects.toThrow(/mayor que 0/);
  });
});

describe("datos iniciales y calendario", () => {
  it("los saldos iniciales son los del 01/11/2026", async () => {
    const r = await como<{ importe: string }>(U.prof, "select importe from public.movimientos_banco order by empresa_id");
    expect(r.map((x) => Number(x.importe))).toEqual([26000, 27000, 28000, 24000, 32000, 28000]);
  });
  it("las existencias cuadran con las cuentas 300, 310 y 350", async () => {
    const r = await como<{ empresa_id: number; cuenta: number; total: string }>(U.prof, "select empresa_id, cuenta, sum(valor) total from public.articulos group by 1,2 order by 1,2");
    expect(r.map((x) => [x.empresa_id, x.cuenta, Number(x.total)])).toEqual([[1, 300, 12000], [2, 310, 12000], [2, 350, 14000], [3, 300, 22000], [6, 300, 20000]]);
  });
  it("los plazos se cuentan en días lectivos y respetan los festivos", async () => {
    const dia = async (antes?: string) => (await como<{ d: string }>(U.g1a, "select public.sumar_dias_lectivos('2026-11-06', 2)::text d", [], antes))[0].d;
    expect(await dia()).toBe("2026-11-10");
    expect(await dia("insert into public.calendario values ('2026-11-09', 'Festivo')")).toBe("2026-11-11");
  });
});

describe("clave de servidor", () => {
  it("puede leer e insertar perfiles, pero no tocar nada más", async () => {
    await db.exec("begin");
    try {
      await db.exec("set local role service_role");
      expect((await db.query("select * from public.perfiles")).rows).toHaveLength(6);
      await expect(db.query("update public.empresas set nombre = 'X'")).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("rollback");
    }
  });
});
