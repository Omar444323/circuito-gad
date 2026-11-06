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
  dto_pactado: number;
  rappel_pactado: number;
  pronto_pago_pactado: number;
  envio_de: number | null;
  presupuesto_id: number | null;
};

// Las compras al Estado las gestiona el propio G1: hace y recibe los documentos, y paga a la cuenta 7
export const gestor = (p: Pick<Pedido, "vendedor_id">) => (p.vendedor_id === 7 ? 1 : p.vendedor_id);

type Color = "info" | "good" | "warn" | "bad" | "off";
export const ETAPAS: Record<string, { etiqueta: string; color: Color; actor: "v" | "c" | null; paso: string }> = {
  pedido_enviado: { etiqueta: "Pedido enviado", color: "info", actor: "v", paso: "Aceptar o rechazar el pedido" },
  pedido_rechazado: { etiqueta: "Pedido rechazado", color: "bad", actor: null, paso: "" },
  pedido_aceptado: { etiqueta: "Entrega hoy", color: "warn", actor: "v", paso: "Entregar la mercancía y emitir el albarán" },
  albaran_emitido: { etiqueta: "Mercancía entregada", color: "info", actor: "c", paso: "Confirmar la recepción del albarán" },
  recibido: { etiqueta: "Pendiente de factura", color: "info", actor: "v", paso: "Emitir la factura" },
  factura_emitida: { etiqueta: "Factura en revisión", color: "warn", actor: "c", paso: "Revisar la factura" },
  factura_rechazada: { etiqueta: "Factura rechazada", color: "bad", actor: "v", paso: "Emitir la factura corregida" },
  factura_aceptada: { etiqueta: "Pendiente de pago", color: "warn", actor: "c", paso: "Hacer borrador y diario, y ordenar el pago" },
  pagado: { etiqueta: "Pagada", color: "good", actor: null, paso: "" },
};

const ORDEN = Object.keys(ETAPAS);
export const posicion = (etapa: string) => ORDEN.indexOf(etapa);
export const enCamino = (p: Pedido, hoy: string) => p.etapa === "pedido_aceptado" && !!p.entrega_fecha && hoy < p.entrega_fecha;

// A quién le toca actuar ahora mismo (null si a nadie)
export function actorDe(p: Pedido, hoy: string): number | null {
  if (enCamino(p, hoy)) return null;
  const a = ETAPAS[p.etapa]?.actor;
  return a === "v" ? gestor(p) : a === "c" ? p.comprador_id : null;
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

export type Presupuesto = {
  id: number; num: string; comprador_id: number; vendedor_id: number; servicio: boolean; fecha: string; entrega_dias: number | null; estado: string; estado_desde: string;
  dto: number; rappel: number; pronto_pago: number; motivo_rechazo: string | null; pedido_id: number | null; incumplimiento_desde: string | null; elaboro_nombre: string; plazo_presupuesto: string | null;
};
export const ESTADOS_PRESUPUESTO: Record<string, { etiqueta: string; color: Color }> = {
  solicitado: { etiqueta: "Solicitado", color: "info" },
  ofertado: { etiqueta: "Oferta recibida", color: "warn" },
  contraoferta: { etiqueta: "Contraoferta", color: "warn" },
  aceptado: { etiqueta: "Aceptado", color: "good" },
  rechazado: { etiqueta: "Rechazado", color: "bad" },
};
// A quién le toca responder al presupuesto
export const turnoPresupuesto = (p: Pick<Presupuesto, "estado" | "comprador_id" | "vendedor_id">) => (p.estado === "ofertado" ? p.comprador_id : p.estado === "solicitado" || p.estado === "contraoferta" ? p.vendedor_id : null);
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
