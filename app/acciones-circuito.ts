"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sb } from "@/lib/supabase";
import type { Res } from "@/components/Form";

// Cada acción llama a una función de Postgres, que valida quién actúa, el estado y los plazos
const t = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (s: string) => Number(s.replace(",", "."));
const id = (f: FormData, k = "pedido") => Number(t(f, k));
async function rpc(n: string, a: Record<string, unknown>, ok: string): Promise<Res> {
  const s = await sb();
  const { error } = await s.rpc(n, a);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok };
}

export async function crearPedido(_: Res, f: FormData): Promise<Res> {
  const lineas = [...f.entries()].filter(([k, v]) => k.startsWith("ud_") && num(String(v)) > 0).map(([k, v]) => ({ catalogo_id: k.slice(3), unidades: num(String(v)) }));
  if (!lineas.length) return { error: "Añade unidades a al menos un artículo." };
  const dias = t(f, "entrega_dias");
  const s = await sb();
  const { data, error } = await s.rpc("crear_pedido", { p_vendedor: Number(t(f, "vendedor")), p_lineas: lineas, p_entrega_dias: dias ? Number(dias) : null });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  redirect("/operaciones/" + data);
}
export async function aceptarPedido(_: Res, f: FormData) {
  return rpc("aceptar_pedido", { p_id: id(f) }, "Pedido aceptado.");
}
export async function rechazarPedido(_: Res, f: FormData) {
  return rpc("rechazar_pedido", { p_id: id(f), p_motivo: t(f, "motivo") }, "Pedido rechazado.");
}
export async function emitirAlbaran(_: Res, f: FormData) {
  return rpc("emitir_albaran", { p_id: id(f) }, "Albarán emitido.");
}
export async function confirmarRecepcion(_: Res, f: FormData) {
  const vinculos = Object.fromEntries([...f.entries()].filter(([k, x]) => k.startsWith("vinculo_") && String(x)).map(([k, x]) => [k.slice(8), String(x)]));
  return rpc("confirmar_recepcion", { p_id: id(f), p_vinculos: vinculos }, "Recepción confirmada.");
}
export async function emitirFactura(_: Res, f: FormData) {
  const lineas = [...f.entries()].filter(([k]) => k.startsWith("u_")).map(([k, v]) => ({ linea_id: Number(k.slice(2)), unidades: num(String(v)), precio: num(t(f, "p_" + k.slice(2))) }));
  return rpc("emitir_factura", {
    p_id: id(f),
    p_lineas: lineas,
    p_dto: num(t(f, "dto") || "0"),
    p_rappel: num(t(f, "rappel") || "0"),
    p_pronto_pago: num(t(f, "pronto_pago") || "0"),
    p_portes: num(t(f, "portes") || "0"),
    p_envases: num(t(f, "envases") || "0"),
    p_iva: num(t(f, "iva")),
    p_retencion: num(t(f, "retencion") || "0"),
    p_vencimiento: Number(t(f, "vencimiento")),
  }, "Factura emitida.");
}
export async function aceptarFactura(_: Res, f: FormData) {
  return rpc("aceptar_factura", { p_id: id(f), p_comprobaciones: f.getAll("comprobacion").map(String) }, "Factura aceptada.");
}
export async function rechazarFactura(_: Res, f: FormData) {
  return rpc("rechazar_factura", { p_id: id(f), p_motivo: t(f, "motivo") }, "Factura rechazada.");
}
export async function marcarRegistro(_: Res, f: FormData) {
  return rpc("marcar_registro", { p_id: id(f), p_paso: t(f, "paso") }, "Marcado.");
}
export async function ordenarPago(_: Res, f: FormData) {
  return rpc("ordenar_pago", { p_id: id(f), p_confirmado: f.get("confirmado") === "on" }, "Orden enviada al banco.");
}
export async function reordenar(_: Res, f: FormData) {
  return rpc("reordenar", { p_id: id(f) }, "Ya puedes emitir una nueva orden.");
}
export async function ejecutarOrden(_: Res, f: FormData) {
  return rpc("ejecutar_orden", { p_orden: id(f, "orden") }, "Transferencia ejecutada.");
}
export async function denegarOrden(_: Res, f: FormData) {
  return rpc("denegar_orden", { p_orden: id(f, "orden"), p_motivo: t(f, "motivo") }, "Orden denegada.");
}
export async function comunicarBloqueo(_: Res, f: FormData) {
  return rpc("comunicar_bloqueo", { p_id: id(f) }, "Bloqueo comunicado a la profesora.");
}
export async function registrarIncumplimiento(_: Res, f: FormData) {
  return rpc("registrar_incumplimiento", { p_id: id(f) }, "Incumplimiento registrado.");
}
export async function publicarComision(_: Res, f: FormData) {
  return rpc("publicar_comision", { p_comision: num(t(f, "comision")) }, "Comisión publicada.");
}
export async function puntear(_: Res, f: FormData) {
  return rpc("puntear_movimiento", { p_mov: id(f, "mov"), p_valor: t(f, "valor") === "true" }, "Actualizado.");
}
export async function simularFecha(_: Res, f: FormData) {
  return rpc("simular_fecha", { p_fecha: t(f, "fecha") || null }, "Fecha actualizada.");
}
export async function emitirRectificativa(_: Res, f: FormData) {
  const lineas = [...f.entries()].filter(([k, x]) => k.startsWith("ru_") && num(String(x)) > 0).map(([k, x]) => ({ linea_id: Number(k.slice(3)), unidades: num(String(x)) }));
  const base = t(f, "base");
  return rpc("emitir_rectificativa", { p_id: id(f), p_tipo: t(f, "tipo"), p_lineas: lineas, p_base: base ? num(base) : null }, "Rectificativa emitida.");
}
export async function aceptarRectificativa(_: Res, f: FormData) {
  return rpc("aceptar_rectificativa", { p_id: id(f) }, "Rectificativa aceptada.");
}
export async function rechazarRectificativa(_: Res, f: FormData) {
  return rpc("rechazar_rectificativa", { p_id: id(f), p_motivo: t(f, "motivo") }, "Rectificativa rechazada.");
}
export async function fabricar(_: Res, f: FormData) {
  return rpc("fabricar", { p_producto: t(f, "producto"), p_unidades: num(t(f, "unidades")) }, "Fabricación registrada.");
}
export async function venderTienda(_: Res, f: FormData) {
  return rpc("vender_tienda", { p_articulo: t(f, "articulo"), p_unidades: num(t(f, "unidades")) }, "Venta y cobro registrados.");
}
export async function comprobarPmp(_: Res, f: FormData): Promise<Res> {
  const s = await sb();
  const { data, error } = await s.rpc("comprobar_pmp", { p_mov: id(f, "mov"), p_pmp: num(t(f, "pmp")) });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return data ? { ok: "Correcto." } : { error: "Revisa el cálculo." };
}
export async function enviarCorreo(_: Res, f: FormData): Promise<Res> {
  const responde = t(f, "responde_a");
  const pedido = t(f, "pedido");
  const destino = t(f, "destinatario");
  const s = await sb();
  const { data, error } = await s.rpc("enviar_correo", { p_destinatario: destino ? Number(destino) : null, p_asunto: t(f, "asunto"), p_cuerpo: t(f, "cuerpo"), p_responde_a: responde ? Number(responde) : null, p_pedido: pedido ? Number(pedido) : null });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  redirect("/correo/" + data);
}
