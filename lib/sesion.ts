import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sb } from "./supabase";

export type Perfil = { id: string; usuario: string; nombre: string; rol: "alumno" | "profesora"; empresa_id: number | null; activo: boolean; cuenta_grupo: boolean; compartida?: boolean };

// La cuenta con la que se ha entrado, sea individual o la compartida del grupo
export async function cuentaActual(): Promise<Perfil> {
  const s = await sb();
  const { data } = await s.auth.getUser();
  if (!data.user) redirect("/login");
  const { data: p } = await s.from("perfiles").select("*").eq("id", data.user.id).maybeSingle();
  if (!p || !p.activo) {
    // Esto corre al dibujar la página, donde Next no deja borrar cookies: `entrar` ya borra la de firmante
    await s.auth.signOut();
    redirect("/login");
  }
  return p as Perfil;
}

// El compañero elegido al entrar con la cuenta del grupo. Tiene que ser del mismo grupo y seguir activo
export async function firmanteDe(cuenta: Perfil): Promise<Perfil | null> {
  const id = (await cookies()).get("firmante")?.value;
  if (!id || !/^[0-9a-fA-F-]{36}$/.test(id)) return null;
  const s = await sb();
  const { data } = await s.from("perfiles").select("*").eq("id", id).eq("empresa_id", cuenta.empresa_id!).eq("activo", true).eq("cuenta_grupo", false).maybeSingle();
  return data ? ({ ...data, compartida: true } as Perfil) : null;
}

// Quien firma: la persona de la sesión, o la elegida si la cuenta es compartida
export async function miSesion(): Promise<Perfil> {
  const cuenta = await cuentaActual();
  if (!cuenta.cuenta_grupo) return cuenta;
  const firmante = await firmanteDe(cuenta);
  if (!firmante) redirect("/quien-soy");
  return firmante;
}
