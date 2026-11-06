import { redirect } from "next/navigation";
import { Form } from "@/components/Form";
import type { Orden } from "@/components/Documentos";
import { revisarPago } from "@/app/acciones-circuito";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fecha, fmt } from "@/lib/formato";

export default async function Ordenes() {
  const yo = await miSesion();
  if (yo.empresa_id !== 5) redirect("/");
  const s = await sb();
  const [{ data: filas }, { data: empresas }] = await Promise.all([
    s.from("ordenes_pago").select("*").eq("estado", "ejecutada").order("id", { ascending: false }),
    s.from("empresas").select("id, corto"),
  ]);
  const ordenes = (filas ?? []) as unknown as Orden[];
  const corto = (g: number) => empresas?.find((e) => e.id === g)?.corto ?? "";
  const porRevisar = ordenes.filter((o) => !o.revisado_en);
  const revisados = ordenes.filter((o) => o.revisado_en);
  return (
    <>
      <div className="head"><h1>Pagos</h1><p>Cada pago se ejecuta solo y el dinero pasa de una cuenta a otra al momento. Vuestra tarea es comprobarlo y marcarlo como revisado. El banco ve ordenante, beneficiario, concepto e importe, pero no el contenido de las facturas.</p></div>
      <section className="card"><h2>Por revisar</h2>
        {porRevisar.length ? <div className="stack">{porRevisar.map((o) => (
          <div className="doc" key={o.id}>
            <div className="btns" style={{ justifyContent: "space-between", alignItems: "center" }}><span className="ref">{o.num}</span><span className="mono" style={{ fontSize: "1.1rem", fontWeight: 600 }}>{fmt(o.importe)}</span></div>
            <div className="parties"><div><span className="lbl">Ordenante</span><strong>{corto(o.ordenante_id)}</strong><span className="muted">{o.ordeno_nombre}</span></div>
              <div><span className="lbl">Beneficiario</span><strong>{corto(o.beneficiario_id)}</strong></div>
              <div><span className="lbl">Concepto</span><strong>{o.concepto}</strong><span className="muted">Comisión {fmt(o.comision)} · <span className="mono">{o.justificante}</span></span></div></div>
            <Form action={revisarPago} boton="Marcar como revisado"><input type="hidden" name="orden" value={o.id} /></Form>
          </div>
        ))}</div> : <p className="empty">No hay pagos por revisar.</p>}
      </section>
      <section className="card"><h2>Revisados</h2>
        {revisados.length ? <div className="tw"><table className="t"><thead><tr><th>Orden</th><th>Fecha</th><th>Ordenante → beneficiario</th><th>Justificante</th><th>Revisó</th><th className="num">Importe</th></tr></thead><tbody>
          {revisados.map((o) => <tr key={o.id}><td className="ref">{o.num}</td><td className="mono">{fecha(o.fecha)}</td><td>{corto(o.ordenante_id)} → {corto(o.beneficiario_id)}</td><td className="mono">{o.justificante}</td><td>{o.revisado_nombre}</td><td className="num">{fmt(o.importe)}</td></tr>)}
        </tbody></table></div> : <p className="empty">Todavía no hay pagos revisados.</p>}
      </section>
    </>
  );
}
