// Etapas y plazos del circuito. Solo presentación: las reglas las aplica la base de datos.
export type Pedido = {
  id: number;
  num: string;
  comprador_id: number;
  vendedor_id: number;
  servicio: boolean;
  fecha: string;
  entrega_dias: number | null;
  entrega_fecha: string | null;
  etapa: string;
  etapa_desde: string;
  motivo_rechazo: string | null;
  elaboro_nombre: string;
  reviso_nombre: string | null;
  plazo_limite: string | null;
};

type Color = "info" | "good" | "warn" | "bad" | "off";
export const ETAPAS: Record<string, { etiqueta: string; color: Color; actor: "v" | "c" | "b" | null; paso: string }> = {
  pedido_enviado: { etiqueta: "Pedido enviado", color: "info", actor: "v", paso: "Aceptar o rechazar el pedido" },
  pedido_rechazado: { etiqueta: "Pedido rechazado", color: "bad", actor: null, paso: "" },
  pedido_aceptado: { etiqueta: "Entrega hoy", color: "warn", actor: "v", paso: "Entregar la mercancía y emitir el albarán" },
  albaran_emitido: { etiqueta: "Mercancía entregada", color: "info", actor: "c", paso: "Confirmar la recepción del albarán" },
  recibido: { etiqueta: "Pendiente de factura", color: "info", actor: "v", paso: "Emitir la factura" },
  factura_emitida: { etiqueta: "Factura en revisión", color: "warn", actor: "c", paso: "Revisar la factura" },
  factura_rechazada: { etiqueta: "Factura rechazada", color: "bad", actor: "v", paso: "Emitir la factura corregida" },
  factura_aceptada: { etiqueta: "Pendiente de pago", color: "warn", actor: "c", paso: "Hacer borrador y diario, y ordenar el pago" },
  orden_pendiente: { etiqueta: "Orden en el banco", color: "warn", actor: "b", paso: "Ejecutar la orden de pago" },
  orden_denegada: { etiqueta: "Orden denegada", color: "bad", actor: "c", paso: "Revisar la denegación y volver a ordenar" },
  pagado: { etiqueta: "Pagada", color: "good", actor: null, paso: "" },
};

const ORDEN = Object.keys(ETAPAS);
export const posicion = (etapa: string) => ORDEN.indexOf(etapa);
export const enCamino = (p: Pedido, hoy: string) => p.etapa === "pedido_aceptado" && !!p.entrega_fecha && hoy < p.entrega_fecha;

// A quién le toca actuar ahora mismo (null si a nadie)
export function actorDe(p: Pedido, hoy: string): number | null {
  if (enCamino(p, hoy)) return null;
  const a = ETAPAS[p.etapa]?.actor;
  return a === "v" ? p.vendedor_id : a === "c" ? p.comprador_id : a === "b" ? 5 : null;
}

export function chipEtapa(p: Pedido, hoy: string): { texto: string; color: Color } {
  if (enCamino(p, hoy)) return { texto: "Mercancía en camino", color: "info" };
  if (p.etapa === "pedido_aceptado" && p.entrega_fecha && hoy > p.entrega_fecha) return { texto: "Entrega retrasada", color: "bad" };
  const e = ETAPAS[p.etapa];
  return { texto: e.etiqueta, color: e.color };
}

const corta = (iso: string) => iso.slice(8, 10) + "/" + iso.slice(5, 7);
export function chipPlazo(p: Pedido, hoy: string): { texto: string; color: Color } | null {
  if (!p.plazo_limite) return null;
  const entrega = p.etapa === "pedido_aceptado";
  if (hoy > p.plazo_limite) return { texto: "Plazo vencido", color: "bad" };
  if (hoy === p.plazo_limite) return { texto: entrega ? "Entrega hoy" : "Vence hoy", color: "warn" };
  return { texto: (entrega ? "Entrega el " : "Hasta el ") + corta(p.plazo_limite), color: "info" };
}

export const vencido = (p: Pedido, hoy: string) => !!p.plazo_limite && hoy > p.plazo_limite;

export function textoPlazo(p: Pedido) {
  if (p.etapa === "pedido_enviado") return "responder al pedido " + p.num;
  if (p.etapa === "pedido_aceptado") return "entregar la mercancía del pedido " + p.num;
  return "corregir la factura del pedido " + p.num;
}

export const MOTIVOS_PEDIDO = ["Falta de existencias", "Falta de liquidez", "Precio no aceptado", "Riesgo excesivo", "Documento incorrecto", "Incumplimiento previo"];
export const MOTIVOS_ORDEN = ["Saldo insuficiente", "Datos del beneficiario incorrectos", "Orden duplicada"];
export const COMPROBACIONES: [string, string][] = [
  ["numeracion", "Numeración y fecha"],
  ["partes", "Emisor y destinatario"],
  ["descripcion", "Descripción concreta"],
  ["unidades", "Unidades y precios (coinciden con pedido y albarán)"],
  ["descuentos", "Descuentos"],
  ["base", "Base imponible"],
  ["iva", "Tipo y cuota de IVA"],
  ["total", "Total"],
  ["pago", "Forma y vencimiento de pago"],
];
