import type { ReactNode } from "react";
import { fecha, fmt } from "@/lib/formato";
import type { Pedido } from "@/lib/circuito";

export type Empresa = { id: number; nombre: string; corto: string; iban: string; con_almacen?: boolean };
export type Linea = { id: number; descripcion: string; unidades: number; precio: number; pedido_linea_id?: number };
export type Albaran = { num: string; fecha: string; retrasado: boolean; elaboro_nombre: string; reviso_nombre: string | null };
export type Factura = {
  id: number; num: string; version: number; fecha: string; dto: number; rappel: number; pronto_pago: number; portes: number; envases: number; iva: number; retencion: number;
  vencimiento_dias: number; vencimiento_fecha: string; suma: number; dto_imp: number; rappel_imp: number; pronto_pago_imp: number; base: number; cuota: number; retencion_imp: number; total: number;
  estado: string; motivo_rechazo: string | null; elaboro_nombre: string; reviso_nombre: string | null; factura_lineas: Linea[];
};
export type Orden = {
  id: number; pedido_id: number | null; num: string; ordenante_id: number; beneficiario_id: number; concepto: string; importe: number; comision: number; estado: string; motivo_denegacion: string | null;
  fecha: string; ordeno_nombre: string; ejecuto_nombre: string | null; fecha_ejecucion: string | null; justificante: string | null; revisado_nombre: string | null; revisado_en: string | null;
};

const Partes = ({ a, b, dia, extra }: { a?: Empresa; b?: Empresa; dia: string; extra?: ReactNode }) => (
  <div className="parties">
    <div><span className="lbl">Emisor</span><strong>{a?.nombre}</strong><span className="muted">{a?.corto}</span></div>
    <div><span className="lbl">Destinatario</span><strong>{b?.nombre}</strong><span className="muted">{b?.corto}</span></div>
    <div><span className="lbl">Fecha</span><strong className="mono">{fecha(dia)}</strong>{extra}</div>
  </div>
);
const Lineas = ({ ls, precios }: { ls: Linea[]; precios: boolean }) => (
  <div className="tw"><table className="t"><thead><tr><th>Descripción</th><th className="num">Uds</th>{precios && <><th className="num">Precio</th><th className="num">Importe</th></>}</tr></thead><tbody>
    {ls.map((l) => <tr key={l.id}><td>{l.descripcion}</td><td className="num">{Number(l.unidades)}</td>{precios && <><td className="num">{fmt(l.precio)}</td><td className="num">{fmt(Number(l.unidades) * Number(l.precio))}</td></>}</tr>)}
  </tbody></table></div>
);
const Traza = ({ e, r, rl = "Revisó" }: { e: string; r: string | null; rl?: string }) => (
  <div className="trace"><span>Elaboró: <b>{e}</b></span><span>{rl}: <b>{r ?? "pendiente"}</b></span></div>
);
const pc = (v: number) => String(Number(v)).replace(".", ",");

export function DocPedido({ p, lineas, comprador, vendedor }: { p: Pedido; lineas: Linea[]; comprador?: Empresa; vendedor?: Empresa }) {
  const sello = p.etapa === "pedido_rechazado" ? <span className="stamp bad">Rechazado</span> : p.reviso_nombre ? <span className="stamp good">Aceptado</span> : <span className="stamp info">Enviado</span>;
  const entrega = p.servicio ? null : <span className="muted">Entrega: {p.entrega_fecha ? <><span className="mono">{fecha(p.entrega_fecha)}</span> (pactada)</> : <>en {p.entrega_dias} día{p.entrega_dias === 1 ? "" : "s"} lectivo{p.entrega_dias === 1 ? "" : "s"} desde la aceptación</>}</span>;
  const suma = lineas.reduce((a, l) => a + Number(l.unidades) * Number(l.precio), 0);
  return (
    <article className="doc"><header className="doc-h"><div><div className="doc-t">Pedido</div><div className="mono doc-n">{p.num}</div></div>{sello}</header>
      <Partes a={comprador} b={vendedor} dia={p.fecha} extra={entrega} /><Lineas ls={lineas} precios />
      <div className="tot"><dl className="dl"><dt>Importe sin IVA</dt><dd>{fmt(suma)}</dd>
        {Number(p.dto_pactado) > 0 && <><dt>Dto. comercial pactado</dt><dd>{pc(p.dto_pactado)} %</dd></>}
        {Number(p.rappel_pactado) > 0 && <><dt>Rappel pactado</dt><dd>{pc(p.rappel_pactado)} %</dd></>}
        {Number(p.pronto_pago_pactado) > 0 && <><dt>Pronto pago pactado</dt><dd>{pc(p.pronto_pago_pactado)} %</dd></>}</dl></div>
      {p.motivo_rechazo && <div className="note bad">Motivo del rechazo: {p.motivo_rechazo}</div>}
      <Traza e={p.elaboro_nombre} r={p.reviso_nombre} rl="Aceptó / rechazó" />
    </article>
  );
}

export function DocAlbaran({ a, p, lineas, comprador, vendedor }: { a: Albaran; p: Pedido; lineas: Linea[]; comprador?: Empresa; vendedor?: Empresa }) {
  return (
    <article className="doc"><header className="doc-h"><div><div className="doc-t">Albarán</div><div className="mono doc-n">{a.num} · s/ pedido {p.num}</div></div>{a.reviso_nombre ? <span className="stamp good">Recibido conforme</span> : <span className="stamp warn">Pendiente de firma</span>}</header>
      <Partes a={vendedor} b={comprador} dia={a.fecha} extra={a.retrasado ? <span className="muted">Entrega retrasada</span> : null} /><Lineas ls={lineas} precios={false} />
      <Traza e={a.elaboro_nombre} r={a.reviso_nombre} rl="Recibió conforme" />
    </article>
  );
}

export function DocFactura({ f, varias, antigua, comprador, vendedor }: { f: Factura; varias: boolean; antigua?: boolean; comprador?: Empresa; vendedor?: Empresa }) {
  const sello = f.estado === "aceptada" ? <span className="stamp good">Aceptada</span> : f.estado === "rechazada" ? <span className="stamp bad">Rechazada</span> : <span className="stamp warn">En revisión</span>;
  return (
    <article className={"doc" + (antigua ? " old" : "")}><header className="doc-h"><div><div className="doc-t">Factura</div><div className="mono doc-n">{f.num}{varias ? " · versión " + f.version : ""}</div></div>{sello}</header>
      <Partes a={vendedor} b={comprador} dia={f.fecha} extra={<span className="muted">Vencimiento: <span className="mono">{f.vencimiento_dias ? fecha(f.vencimiento_fecha) : "pago inmediato"}</span></span>} />
      <Lineas ls={f.factura_lineas} precios />
      <div className="tot"><dl className="dl"><dt>Suma</dt><dd>{fmt(f.suma)}</dd>
        {Number(f.dto) > 0 && <><dt>Descuento comercial {pc(f.dto)} %</dt><dd>−{fmt(f.dto_imp)}</dd></>}
        {Number(f.rappel) > 0 && <><dt>Rappel {pc(f.rappel)} %</dt><dd>−{fmt(f.rappel_imp)}</dd></>}
        {Number(f.pronto_pago) > 0 && <><dt>Pronto pago {pc(f.pronto_pago)} %</dt><dd>−{fmt(f.pronto_pago_imp)}</dd></>}
        {Number(f.portes) > 0 && <><dt>Portes</dt><dd>{fmt(f.portes)}</dd></>}
        {Number(f.envases) > 0 && <><dt>Envases retornables</dt><dd>{fmt(f.envases)}</dd></>}
        <dt>Base imponible</dt><dd>{fmt(f.base)}</dd><dt>IVA {pc(f.iva)} %</dt><dd>{fmt(f.cuota)}</dd>
        {Number(f.retencion) > 0 && <><dt>Retención IRPF {pc(f.retencion)} %</dt><dd>−{fmt(f.retencion_imp)}</dd></>}
        <dt className="grand">Total factura</dt><dd className="grand">{fmt(f.total)}</dd></dl></div>
      <p className="hint">Forma de pago: transferencia a la cuenta <span className="mono">{vendedor?.iban}</span> a través de la entidad financiera simulada.</p>
      {f.motivo_rechazo && <div className="note bad">Motivo del rechazo: {f.motivo_rechazo}</div>}
      <Traza e={f.elaboro_nombre} r={f.reviso_nombre} />
    </article>
  );
}

export function DocJustificante({ o, ordenante, beneficiario }: { o: Orden; ordenante?: Empresa; beneficiario?: Empresa }) {
  return (
    <article className="doc"><header className="doc-h"><div><div className="doc-t">Justificante bancario</div><div className="mono doc-n">{o.justificante} · {o.num}</div></div><span className="stamp good">Ejecutada</span></header>
      <div className="parties"><div><span className="lbl">Ordenante</span><strong>{ordenante?.nombre}</strong></div><div><span className="lbl">Beneficiario</span><strong>{beneficiario?.nombre}</strong></div><div><span className="lbl">Fecha de ejecución</span><strong className="mono">{o.fecha_ejecucion ? fecha(o.fecha_ejecucion) : ""}</strong></div></div>
      <div className="tot"><dl className="dl"><dt>Concepto</dt><dd>{o.concepto}</dd><dt className="grand">Importe transferido</dt><dd className="grand">{fmt(o.importe)}</dd>{Number(o.comision) > 0 && <><dt>Comisión cargada al ordenante</dt><dd>{fmt(o.comision)}</dd></>}</dl></div>
      <div className="trace"><span>Ordenó: <b>{o.ordeno_nombre}</b></span><span>Ejecución: <b>{o.ejecuto_nombre}</b></span><span>Revisó (banco): <b>{o.revisado_nombre ?? "pendiente"}</b></span></div>
    </article>
  );
}

export type Rectificativa = { id: number; num: string; tipo: string; fecha: string; base: number; iva: number; cuota: number; total: number; estado: string; motivo_rechazo: string | null; elaboro_nombre: string; reviso_nombre: string | null; rectificativa_lineas: { id: number; descripcion: string; unidades: number; precio_neto: number }[] };
export const TIPOS_RECTIFICATIVA: Record<string, string> = { devolucion: "Devolución de mercancía", comercial: "Descuento comercial fuera de factura", rappel: "Rappel fuera de factura", pronto_pago: "Descuento por pronto pago fuera de factura" };

export function DocRectificativa({ r, facturaNum, comprador, vendedor }: { r: Rectificativa; facturaNum: string; comprador?: Empresa; vendedor?: Empresa }) {
  const sello = r.estado === "aceptada" ? <span className="stamp good">Aceptada</span> : r.estado === "rechazada" ? <span className="stamp bad">Rechazada</span> : <span className="stamp warn">En revisión</span>;
  const lineas = r.rectificativa_lineas.map((l) => ({ id: l.id, descripcion: l.descripcion, unidades: -Number(l.unidades), precio: Number(l.precio_neto) }));
  return (
    <article className="doc"><header className="doc-h"><div><div className="doc-t">Factura rectificativa</div><div className="mono doc-n">{r.num} · rectifica {facturaNum}</div></div>{sello}</header>
      <Partes a={vendedor} b={comprador} dia={r.fecha} extra={<span className="muted">{TIPOS_RECTIFICATIVA[r.tipo]}</span>} />
      {lineas.length > 0 && <Lineas ls={lineas} precios />}
      <div className="tot"><dl className="dl"><dt>Base imponible</dt><dd>{fmt(r.base)}</dd><dt>IVA {pc(r.iva)} %</dt><dd>{fmt(r.cuota)}</dd><dt className="grand">Total</dt><dd className="grand">{fmt(r.total)}</dd></dl></div>
      {r.motivo_rechazo && <div className="note bad">Motivo del rechazo: {r.motivo_rechazo}</div>}
      <Traza e={r.elaboro_nombre} r={r.reviso_nombre} />
    </article>
  );
}
