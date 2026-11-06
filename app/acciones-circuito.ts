"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sb } from "@/lib/supabase";
import type { Res } from "@/components/Form";

// Cada acción llama a una función de Postgres, que valida quién actúa, el estado y los plazos
const t = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (s: string) => Number(s.replace(",", "."));
const id = (f: FormData, k = "pedido") => Number(t(f, k));
const pct = (f: FormData, k: string) => num(t(f, k) || "0");
const lineasCatalogo = (f: FormData) => [...f.entries()].filter(([k, v]) => k.startsWith("ud_") && num(String(v)) > 0).map(([k, v]) => ({ catalogo_id: k.slice(3), unidades: num(String(v)) }));
const preciosDe = (f: FormData) => [...f.entries()].filter(([k]) => k.startsWith("pr_")).map(([k, v]) => ({ linea_id: Number(k.slice(3)), precio: num(String(v)) }));
function envioDe(f: FormData) {
  const catalogo_id = t(f, "envio_catalogo");
  return catalogo_id ? { catalogo_id, unidades: num(t(f, "envio_unidades") || "1") } : null;
}
async function rpc(n: string, a: Record<string, unknown>, ok: string): Promise<Res> {
  const s = await sb();
  const { error } = await s.rpc(n, a);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok };
}

export async function crearPedido(_: Res, f: FormData): Promise<Res> {
  const lineas = lineasCatalogo(f);
  if (!lineas.length) return { error: "Añade unidades a al menos un artículo." };
  const dias = t(f, "entrega_dias");
  const s = await sb();
  const { data, error } = await s.rpc("crear_pedido", { p_vendedor: Number(t(f, "vendedor")), p_lineas: lineas, p_entrega_dias: dias ? Number(dias) : null, p_confirmado: f.get("confirmado") === "on", p_envio: envioDe(f) });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  redirect("/operaciones/" + data);
}
export async function proponerDeuda(_: Res, f: FormData) {
  return rpc("proponer_deuda", { p_pedido: id(f), p_dias: Number(t(f, "dias")), p_condiciones: t(f, "condiciones") || null }, "Propuesta enviada a la otra parte.");
}
export async function responderDeuda(_: Res, f: FormData) {
  const aceptar = t(f, "aceptar") === "true";
  return rpc("responder_deuda", { p_id: id(f, "deuda"), p_aceptar: aceptar, p_motivo: t(f, "motivo") || null }, aceptar ? "Deuda aceptada." : "Deuda rechazada.");
}
export async function aplazarDeuda(_: Res, f: FormData) {
  return rpc("aplazar_deuda", { p_id: id(f, "deuda"), p_dias: Number(t(f, "dias")) }, "Vencimiento aplazado.");
}
export async function pagarDeuda(_: Res, f: FormData) {
  return rpc("pagar_deuda", { p_id: id(f, "deuda"), p_importe: num(t(f, "importe")) }, "Pago realizado.");
}
export async function comunicarImpago(_: Res, f: FormData) {
  return rpc("comunicar_impago", { p_id: id(f, "deuda") }, "Impago comunicado a la profesora.");
}
export async function registrarImpago(_: Res, f: FormData) {
  return rpc("registrar_impago", { p_id: id(f, "deuda") }, "Incumplimiento registrado.");
}
export async function guardarTramoRappel(_: Res, f: FormData) {
  const c = t(f, "comprador");
  return rpc("guardar_tramo_rappel", { p_comprador: c ? Number(c) : null, p_volumen: num(t(f, "volumen")), p_porcentaje: num(t(f, "porcentaje")) }, "Tramo publicado.");
}
export async function quitarTramoRappel(_: Res, f: FormData) {
  return rpc("quitar_tramo_rappel", { p_id: id(f, "tramo") }, "Tramo quitado.");
}
export async function emitirRappelVolumen(_: Res, f: FormData) {
  return rpc("emitir_rappel_volumen", { p_pedido: id(f), p_mes: t(f, "mes") }, "Rappel emitido. El cliente tiene que aceptar la rectificativa.");
}
export async function rechazarAlbaran(_: Res, f: FormData) {
  return rpc("rechazar_albaran", { p_id: id(f), p_motivo: t(f, "motivo") }, "Albarán rechazado. El proveedor tiene un día lectivo para reemitirlo.");
}
export async function intervenirPedido(_: Res, f: FormData) {
  return rpc("intervenir_pedido", { p_id: id(f), p_motivo: t(f, "motivo"), p_iva: num(t(f, "iva") || "21"), p_vencimiento: Number(t(f, "vencimiento") || 15) }, "Documento sustitutorio emitido e incumplimiento registrado.");
}
export async function fijarIvaCatalogo(_: Res, f: FormData) {
  return rpc("fijar_iva_catalogo", { p_id: t(f, "id"), p_iva: num(t(f, "iva")) }, "Tipo de IVA guardado.");
}
export async function pagarCuota(_: Res, f: FormData) {
  return rpc("pagar_cuota", { p_id: id(f, "cuota") }, "Cuota pagada.");
}
export async function solicitarPrestamoPersonal(_: Res, f: FormData) {
  return rpc("solicitar_prestamo_personal", { p_importe: num(t(f, "importe")), p_plazo: Number(t(f, "plazo")), p_motivo: t(f, "motivo") }, "Solicitud enviada al banco.");
}
export async function comprarEnTienda(_: Res, f: FormData) {
  return rpc("comprar_en_tienda", { p_catalogo: t(f, "catalogo"), p_unidades: num(t(f, "unidades")) }, "Compra hecha. Tienes el justificante abajo.");
}
export async function contratarServicioPersonal(_: Res, f: FormData) {
  return rpc("contratar_servicio_personal", { p_catalogo: t(f, "catalogo"), p_unidades: num(t(f, "unidades")) }, "Servicio contratado. Tienes el justificante abajo.");
}
export async function pagarGastoPersonal(_: Res, f: FormData) {
  return rpc("pagar_gasto_personal", { p_tipo: t(f, "tipo"), p_total: num(t(f, "total")), p_concepto: t(f, "concepto") }, "Recibo pagado.");
}
export async function fijarReglasNomina(_: Res, f: FormData) {
  return rpc("fijar_reglas_nomina", { p_ss_trabajador: pct(f, "ss_trabajador"), p_ss_empresa: pct(f, "ss_empresa"), p_irpf: pct(f, "irpf") }, "Reglas guardadas.");
}
export async function emitirNomina(_: Res, f: FormData) {
  return rpc("emitir_nomina", { p_trabajador: t(f, "trabajador"), p_mes: t(f, "mes") + "-01", p_bruto: num(t(f, "bruto")) }, "Nómina emitida y pagada.");
}
export async function constituirFianza(_: Res, f: FormData) {
  return rpc("constituir_fianza", { p_suministro: t(f, "suministro"), p_importe: num(t(f, "importe")) }, "Fianza depositada.");
}
export async function devolverFianza(_: Res, f: FormData) {
  return rpc("devolver_fianza", { p_id: id(f, "fianza") }, "Fianza devuelta.");
}
export async function presentarIva(_: Res, f: FormData) {
  return rpc("presentar_iva", { p_periodo: t(f, "periodo"), p_repercutido: num(t(f, "repercutido")), p_soportado: num(t(f, "soportado")) }, "Modelo presentado.");
}
export async function contratarEnvio(_: Res, f: FormData) {
  return rpc("contratar_envio", { p_pedido: id(f), p_catalogo: t(f, "envio_catalogo"), p_unidades: num(t(f, "envio_unidades") || "1") }, "Envío contratado con el G4.");
}
export async function anotarOperacion(_: Res, f: FormData) {
  return rpc("anotar_operacion", { p_id: id(f), p_texto: t(f, "texto") }, "Observación guardada en el historial.");
}

export async function solicitarPresupuesto(_: Res, f: FormData): Promise<Res> {
  const lineas = lineasCatalogo(f);
  if (!lineas.length) return { error: "Añade unidades a al menos un artículo." };
  const dias = t(f, "entrega_dias");
  const s = await sb();
  const { data, error } = await s.rpc("solicitar_presupuesto", { p_vendedor: Number(t(f, "vendedor")), p_lineas: lineas, p_entrega_dias: dias ? Number(dias) : null, p_nota: t(f, "nota") || null });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  redirect("/presupuestos/" + data);
}
export async function ofertarPresupuesto(_: Res, f: FormData) {
  return rpc("ofertar_presupuesto", { p_id: id(f, "presupuesto"), p_lineas: preciosDe(f), p_dto: pct(f, "dto"), p_rappel: pct(f, "rappel"), p_pronto_pago: pct(f, "pronto_pago"), p_nota: t(f, "nota") || null }, "Oferta enviada al cliente.");
}
export async function contraofertarPresupuesto(_: Res, f: FormData) {
  return rpc("contraofertar_presupuesto", { p_id: id(f, "presupuesto"), p_lineas: preciosDe(f), p_dto: pct(f, "dto"), p_rappel: pct(f, "rappel"), p_pronto_pago: pct(f, "pronto_pago"), p_nota: t(f, "nota") || null }, "Contraoferta enviada al proveedor.");
}
export async function aceptarPresupuesto(_: Res, f: FormData): Promise<Res> {
  const s = await sb();
  const { data, error } = await s.rpc("aceptar_presupuesto", { p_id: id(f, "presupuesto"), p_confirmado: f.get("confirmado") === "on", p_envio: envioDe(f) });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  redirect("/operaciones/" + data);
}
export async function rechazarPresupuesto(_: Res, f: FormData) {
  return rpc("rechazar_presupuesto", { p_id: id(f, "presupuesto"), p_motivo: t(f, "motivo") }, "Presupuesto rechazado.");
}
export async function registrarIncumplimientoPresupuesto(_: Res, f: FormData) {
  return rpc("registrar_incumplimiento_presupuesto", { p_id: id(f, "presupuesto") }, "Incumplimiento registrado.");
}

export async function crearCircular(_: Res, f: FormData): Promise<Res> {
  const s = await sb();
  const { data, error } = await s.rpc("crear_circular", { p_tipo: t(f, "tipo"), p_titulo: t(f, "titulo"), p_cuerpo: t(f, "cuerpo"), p_limite: t(f, "limite") || null });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  redirect("/circulares/" + data);
}
export async function cambiarLimiteCircular(_: Res, f: FormData) {
  return rpc("cambiar_limite_circular", { p_id: id(f, "circular"), p_limite: t(f, "limite") || null }, "Fecha límite actualizada.");
}
export async function marcarCircularLeida(p_id: number) {
  if (!Number.isInteger(p_id)) return;
  const s = await sb();
  await s.rpc("marcar_circular_leida", { p_id });
  revalidatePath("/", "layout");
}
export async function entregarModelo(_: Res, f: FormData) {
  return rpc("entregar", { p_circular: id(f, "circular"), p_contenido: t(f, "contenido") }, "Entrega guardada.");
}
export async function revisarEntrega(_: Res, f: FormData) {
  return rpc("revisar_entrega", { p_id: id(f, "entrega"), p_revision: t(f, "revision") }, "Revisión guardada.");
}

export async function solicitarFinanciacion(_: Res, f: FormData) {
  return rpc("solicitar_financiacion", { p_importe: num(t(f, "importe")), p_plazo: Number(t(f, "plazo")), p_motivo: t(f, "motivo") }, "Solicitud enviada al banco.");
}
export async function estudiarFinanciacion(_: Res, f: FormData) {
  const aprobar = t(f, "aprobar") === "true";
  return rpc("estudiar_financiacion", { p_id: id(f, "solicitud"), p_aprobar: aprobar, p_tipo: aprobar ? num(t(f, "tipo")) : null, p_causa: t(f, "causa") || null, p_motivo: t(f, "motivo") || null }, aprobar ? "Enviada a la profesora para que la autorice." : "Solicitud rechazada.");
}
export async function autorizarFinanciacion(_: Res, f: FormData) {
  const autorizar = t(f, "autorizar") === "true";
  return rpc("autorizar_financiacion", { p_id: id(f, "solicitud"), p_autorizar: autorizar, p_motivo: t(f, "motivo") || null }, autorizar ? "Préstamo autorizado y abonado." : "Préstamo rechazado.");
}
export async function presentarPlan(_: Res, f: FormData) {
  return rpc("presentar_plan", { p_reduccion: t(f, "reduccion"), p_precios: t(f, "precios"), p_financiacion: t(f, "financiacion"), p_importe: num(t(f, "importe") || "0") }, "Plan presentado a la profesora.");
}
export async function resolverPlan(_: Res, f: FormData) {
  const aprobar = t(f, "aprobar") === "true";
  return rpc("resolver_plan", { p_id: id(f, "plan"), p_aprobar: aprobar, p_importe: num(t(f, "importe") || "0"), p_condiciones: t(f, "condiciones") }, aprobar ? "Plan aprobado." : "Plan rechazado.");
}
export async function autorizarDescubierto(_: Res, f: FormData) {
  return rpc("autorizar_descubierto", { p_empresa: Number(t(f, "empresa")), p_limite: num(t(f, "limite")), p_motivo: t(f, "motivo") }, "Límite de descubierto actualizado.");
}
export async function resolverPrecio(_: Res, f: FormData) {
  const aceptar = t(f, "aceptar") === "true";
  return rpc("resolver_precio", { p_id: id(f, "solicitud"), p_aceptar: aceptar, p_motivo: t(f, "motivo") || null }, aceptar ? "Precio aceptado." : "Precio rechazado.");
}
export async function pagarEstado(_: Res, f: FormData) {
  return rpc("pagar_estado", { p_cuenta: Number(t(f, "cuenta")), p_concepto: t(f, "concepto"), p_importe: num(t(f, "importe")) }, "Pago realizado.");
}
export async function revisarPago(_: Res, f: FormData) {
  return rpc("revisar_pago", { p_orden: id(f, "orden") }, "Marcado como revisado.");
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
  return rpc("ordenar_pago", { p_id: id(f) }, "Pago realizado.");
}
export async function comunicarBloqueo(_: Res, f: FormData) {
  return rpc("comunicar_bloqueo", { p_id: id(f) }, "Bloqueo comunicado a la profesora.");
}
export async function registrarIncumplimiento(_: Res, f: FormData) {
  return rpc("registrar_incumplimiento", { p_id: id(f) }, "Incumplimiento registrado.");
}
export async function publicarCondiciones(_: Res, f: FormData) {
  const tipo = t(f, "tipo");
  const plazo = t(f, "plazo");
  return rpc("publicar_condiciones", { p_comision: num(t(f, "comision")), p_tipo: tipo ? num(tipo) : null, p_plazo: plazo ? Number(plazo) : null, p_condiciones: t(f, "condiciones") || null }, "Condiciones publicadas.");
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
export async function marcarCorreosLeidos(ids: number[]) {
  const s = await sb();
  // La función de Postgres solo marca los correos cuya destinataria es la empresa de quien lo abre
  await Promise.all(ids.filter(Number.isInteger).slice(0, 200).map((p_id) => s.rpc("marcar_correo_leido", { p_id })));
  revalidatePath("/", "layout");
}
