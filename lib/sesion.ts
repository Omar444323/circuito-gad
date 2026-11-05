import "server-only";
import { redirect } from "next/navigation";
import { sb } from "./supabase";

export type Perfil = { id: string; usuario: string; nombre: string; rol: "alumno" | "profesora"; empresa_id: number | null; activo: boolean };

export async function miSesion(): Promise<Perfil> {
  const s = await sb();
  const { data } = await s.auth.getUser();
  if (!data.user) redirect("/login");
  const { data: p } = await s.from("perfiles").select("*").eq("id", data.user.id).maybeSingle();
  if (!p || !p.activo) {
    await s.auth.signOut();
    redirect("/login");
  }
  return p as Perfil;
}
