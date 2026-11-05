// Crea las cuentas de arranque (profesora y grupo1…grupo6) y muestra las contraseñas temporales UNA sola vez.
// Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/crear-cuentas.mjs
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const a = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const cuentas = [{ usuario: "profesora", nombre: "Profesora", rol: "profesora", empresa_id: null }];
for (let g = 1; g <= 6; g++) cuentas.push({ usuario: "grupo" + g, nombre: "Cuenta inicial grupo " + g, rol: "alumno", empresa_id: g });

for (const c of cuentas) {
  const ya = await a.from("perfiles").select("id").eq("usuario", c.usuario).maybeSingle();
  if (ya.error) throw ya.error;
  if (ya.data) {
    console.log(c.usuario, "ya existe; no se toca");
    continue;
  }
  const password = randomBytes(9).toString("base64url").replace(/[-_]/g, "x").slice(0, 10);
  const { data, error } = await a.auth.admin.createUser({ email: c.usuario + "@gad.local", password, email_confirm: true });
  if (error) throw error;
  const r = await a.from("perfiles").insert({ id: data.user.id, ...c });
  if (r.error) throw r.error;
  console.log(c.usuario.padEnd(10), password);
}
