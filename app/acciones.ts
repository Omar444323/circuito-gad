"use server";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { admin, sb } from "@/lib/supabase";
import { miSesion } from "@/lib/sesion";
import type { Res } from "@/components/Form";

const t = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (s: string) => Number(s.replace(",", "."));
const hecho = (ok: string): Res => {
  revalidatePath("/", "layout");
  return { ok };
};
async function rpc(n: string, a: Record<string, unknown>, ok: string): Promise<Res> {
  const s = await sb();
  const { error } = await s.rpc(n, a);
  return error ? { error: error.message } : hecho(ok);
}
const claveTemporal = () => randomBytes(9).toString("base64url").replace(/[-_]/g, "x").slice(0, 10);
const slug = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");

export async function entrar(_: Res, f: FormData): Promise<Res> {
  const usuario = t(f, "usuario").toLowerCase();
  const s = await sb();
  const { error } = await s.auth.signInWithPassword({ email: usuario + "@gad.local", password: String(f.get("clave") ?? "") });
  if (error) return { error: "Usuario o contraseña incorrectos." };
  redirect("/");
}
export async function salir() {
  const s = await sb();
  await s.auth.signOut();
  redirect("/login");
}
export async function cambiarClave(_: Res, f: FormData): Promise<Res> {
  const nueva = String(f.get("nueva") ?? "");
  if (nueva.length < 8) return { error: "La contraseña necesita al menos 8 caracteres." };
  const s = await sb();
  const { error } = await s.auth.updateUser({ password: nueva });
  return error ? { error: "No se ha podido cambiar la contraseña." } : { ok: "Contraseña cambiada." };
}

export async function guardarEmpresa(_: Res, f: FormData) {
  return rpc("actualizar_empresa", { p_empresa: Number(t(f, "empresa")), p_nombre: t(f, "nombre"), p_actividad: t(f, "actividad") }, "Datos guardados.");
}
export async function guardarNombre(_: Res, f: FormData) {
  return rpc("cambiar_nombre_perfil", { p_perfil: t(f, "perfil"), p_nombre: t(f, "nombre") }, "Nombre guardado.");
}
export async function guardarArticulo(_: Res, f: FormData) {
  const id = t(f, "id");
  return rpc("guardar_catalogo", { p_empresa: Number(t(f, "empresa")), p_id: id || null, p_nombre: t(f, "nombre"), p_precio: num(t(f, "precio")) }, id ? "Artículo guardado." : "Artículo añadido.");
}
export async function quitarArticulo(_: Res, f: FormData) {
  return rpc("quitar_catalogo", { p_id: t(f, "id") }, "Quitado del catálogo.");
}
export async function guardarReceta(_: Res, f: FormData) {
  const lineas = [...f.entries()].filter(([k, v]) => k.startsWith("cant_") && String(v).trim() !== "").map(([k, v]) => ({ materia_id: k.slice(5), cantidad: num(String(v)) }));
  return rpc("guardar_receta", { p_producto: t(f, "producto"), p_lineas: lineas }, "Receta guardada.");
}
export async function noLectivo(_: Res, f: FormData) {
  return rpc("marcar_no_lectivo", { p_fecha: t(f, "fecha"), p_motivo: t(f, "motivo") }, "Día marcado como no lectivo.");
}
export async function quitarNoLectivo(_: Res, f: FormData) {
  return rpc("quitar_no_lectivo", { p_fecha: t(f, "fecha") }, "Día devuelto al calendario lectivo.");
}
export async function cambiarModulo(_: Res, f: FormData) {
  return rpc("activar_modulo", { p_clave: t(f, "clave"), p_activo: t(f, "activo") === "true" }, "Módulo actualizado.");
}
export async function moverAlumno(_: Res, f: FormData) {
  return rpc("mover_alumno", { p_perfil: t(f, "perfil"), p_destino: Number(t(f, "destino")) }, "Alumno movido.");
}

// Altas, bajas y contraseñas necesitan la clave de servidor: antes se comprueba quién lo pide
async function crearAlumno(nombre: string, empresa: number, por: string) {
  const a = admin();
  const base = "g" + empresa + "." + slug(nombre);
  let usuario = base;
  for (let i = 2; (await a.from("perfiles").select("id").eq("usuario", usuario).maybeSingle()).data; i++) usuario = base + i;
  const clave = claveTemporal();
  const { data, error } = await a.auth.admin.createUser({ email: usuario + "@gad.local", password: clave, email_confirm: true });
  if (error || !data.user) throw new Error("No se ha podido crear el usuario de " + nombre);
  const r = await a.rpc("registrar_alta", { p_id: data.user.id, p_usuario: usuario, p_nombre: nombre, p_empresa: empresa, p_por: por });
  if (r.error) {
    await a.auth.admin.deleteUser(data.user.id);
    throw new Error("No se ha podido registrar a " + nombre);
  }
  return { usuario, clave };
}
export async function altaIntegrante(_: Res, f: FormData): Promise<Res> {
  const yo = await miSesion();
  const empresa = Number(t(f, "empresa"));
  const nombre = t(f, "nombre");
  if (yo.rol !== "profesora" && yo.empresa_id !== empresa) return { error: "No puedes editar los datos de otro equipo" };
  if (!nombre) return { error: "Escribe el nombre del integrante." };
  try {
    const { usuario, clave } = await crearAlumno(nombre, empresa, yo.id);
    revalidatePath("/", "layout");
    return { ok: "Alta hecha. Usuario: " + usuario, temporal: clave };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
export async function altaEnLote(_: Res, f: FormData): Promise<Res> {
  const yo = await miSesion();
  if (yo.rol !== "profesora") return { error: "Solo la profesora crea usuarios en lote." };
  const filas = t(f, "lista").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.split(";").map((x) => x.trim()));
  if (!filas.length) return { error: "Pega al menos una línea: Nombre y apellidos;grupo" };
  const mal = filas.find(([n, g]) => !n || !/^[1-6]$/.test(g ?? ""));
  if (mal) return { error: "Línea incorrecta: " + mal.join(";") + ". El formato es Nombre y apellidos;grupo (1 a 6)." };
  const salida: string[] = [];
  try {
    for (const [n, g] of filas) {
      const { usuario, clave } = await crearAlumno(n, Number(g), yo.id);
      salida.push(usuario + " · " + clave);
    }
  } catch (e) {
    return { error: (e as Error).message, temporal: salida.join("\n") || undefined };
  }
  revalidatePath("/", "layout");
  return { ok: filas.length + " usuarios creados.", temporal: salida.join("\n") };
}
export async function darBaja(_: Res, f: FormData): Promise<Res> {
  const perfil = t(f, "perfil");
  const s = await sb();
  const { error } = await s.rpc("dar_baja_integrante", { p_perfil: perfil });
  if (error) return { error: error.message };
  await admin().auth.admin.updateUserById(perfil, { ban_duration: "876000h" });
  return hecho("Integrante dado de baja. Lo que firmó se conserva.");
}
export async function restablecerClave(_: Res, f: FormData): Promise<Res> {
  const yo = await miSesion();
  if (yo.rol !== "profesora") return { error: "Solo la profesora restablece contraseñas." };
  const clave = claveTemporal();
  const { error } = await admin().auth.admin.updateUserById(t(f, "perfil"), { password: clave });
  return error ? { error: "No se ha podido restablecer la contraseña." } : { temporal: clave };
}
