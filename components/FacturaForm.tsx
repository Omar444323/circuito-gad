"use client";
import { useState } from "react";
import { Form } from "./Form";
import { emitirFactura } from "@/app/acciones-circuito";
import { calcularFactura } from "@/lib/calculo";
import { fmt } from "@/lib/formato";

export type LineaFactura = { id: number; descripcion: string; unidades: number; precio: number };
export type Opciones = { dto: number; rappel: number; pronto_pago: number; portes: number; envases: number; iva: number; retencion: number; vencimiento_dias: number };
const INICIAL: Opciones = { dto: 0, rappel: 0, pronto_pago: 0, portes: 0, envases: 0, iva: 21, retencion: 0, vencimiento_dias: 15 };

export function FacturaForm({ pedido, lineas, previa, g4 }: { pedido: number; lineas: LineaFactura[]; previa: Opciones | null; g4: boolean }) {
  const [ls, setLs] = useState(lineas.map((l) => ({ ...l, u: String(l.unidades), p: String(l.precio) })));
  const [o, setO] = useState<Record<keyof Opciones, string>>(() => {
    const base = previa ?? INICIAL;
    return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, String(v)])) as Record<keyof Opciones, string>;
  });
  const c = calcularFactura(ls.map((l) => ({ unidades: Number(l.u) || 0, precio: Number(l.p) || 0 })), {
    dto: Number(o.dto) || 0, rappel: Number(o.rappel) || 0, pronto_pago: Number(o.pronto_pago) || 0, portes: Number(o.portes) || 0, envases: Number(o.envases) || 0, iva: Number(o.iva) || 0, retencion: Number(o.retencion) || 0,
  });
  const campo = (k: keyof Opciones, etiqueta: string, paso = "0.5") => (
    <label>{etiqueta}<input className="in" type="number" min="0" step={paso} name={k === "vencimiento_dias" ? "vencimiento" : k} value={o[k]} onChange={(e) => setO({ ...o, [k]: e.target.value })} /></label>
  );
  const cambiar = (i: number, k: "u" | "p", v: string) => setLs(ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <Form action={emitirFactura} boton={previa ? "Emitir factura corregida" : "Emitir factura"}>
      <input type="hidden" name="pedido" value={pedido} />
      <div className="tw"><table className="t"><thead><tr><th>Descripción</th><th className="num">Uds</th><th className="num">Precio €</th></tr></thead><tbody>
        {ls.map((l, i) => (
          <tr key={l.id}><td>{l.descripcion}</td>
            <td><input className="in num" type="number" min="0" step="1" name={"u_" + l.id} value={l.u} onChange={(e) => cambiar(i, "u", e.target.value)} aria-label="Unidades" /></td>
            <td><input className="in num" type="number" min="0" step="0.01" name={"p_" + l.id} value={l.p} onChange={(e) => cambiar(i, "p", e.target.value)} aria-label="Precio" /></td></tr>
        ))}
      </tbody></table></div>
      <div className="row3">{campo("dto", "Descuento comercial %")}{campo("rappel", "Rappel en factura %")}{campo("pronto_pago", "Pronto pago en factura %")}</div>
      <div className="row3">{campo("portes", "Portes €", "0.01")}{campo("envases", "Envases retornables €", "0.01")}
        {g4 ? <label>Retención IRPF<select className="in" name="retencion" value={o.retencion} onChange={(e) => setO({ ...o, retencion: e.target.value })}>{[0, 15].map((v) => <option key={v} value={v}>{v} %</option>)}</select></label> : <span />}
      </div>
      <div className="row3">
        <label>Tipo de IVA<select className="in" name="iva" value={o.iva} onChange={(e) => setO({ ...o, iva: e.target.value })}>{[21, 10, 4, 0].map((v) => <option key={v} value={v}>{v} %</option>)}</select></label>
        {campo("vencimiento_dias", "Vencimiento (0 = inmediato, o de 5 a 30 días)", "1")}
      </div>
      <dl className="dl"><dt>Base imponible</dt><dd>{fmt(c.base)}</dd><dt>Cuota IVA</dt><dd>{fmt(c.cuota)}</dd>{c.retImp ? <><dt>Retención</dt><dd>−{fmt(c.retImp)}</dd></> : null}<dt><strong>Total</strong></dt><dd><strong>{fmt(c.total)}</strong></dd></dl>
      <p className="hint">Orden del Tema 3: descuentos sobre la suma, después portes y envases a la base, IVA y retención si procede. La app suma, pero no corrige: quien emite decide los datos y el cliente los revisa.</p>
    </Form>
  );
}
