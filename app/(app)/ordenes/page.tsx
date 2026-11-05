import { redirect } from "next/navigation";
import { Form } from "@/components/Form";
import type { Orden } from "@/components/Documentos";
import { denegarOrden, ejecutarOrden } from "@/app/acciones-circuito";
import { MOTIVOS_ORDEN } from "@/lib/circuito";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fmt } from "@/lib/formato";

type Mov = { empresa_id: number; saldo: number; id: number };

export default async function Ordenes() {
  const yo = await miSesion();
  if (yo.empresa_id !== 5) redirect("/");
  const s = await sb();
  const [{ data: filas }, { data: empresas }, { data: movs }] = await Promise.all([
    s.from("ordenes_pago").select("*").order("id", { ascending: false }),
    s.from("empresas").select("id, corto"),
    s.from("movimientos_banco").select("empresa_id, saldo, id").order("id"),
  ]);
  const ordenes = (filas ?? []) as unknown as Orden[];
  const corto = (g: number) => empresas?.find((e) => e.id === g)?.corto ?? "";
  const saldo = (g: number) => Number(((movs ?? []) as Mov[]).filter((m) => m.empresa_id === g).at(-1)?.saldo ?? 0);
  const pendientes = ordenes.filter((o) => o.estado === "pendiente");
  const resueltas = ordenes.filter((o) => o.estado !== "pendiente");
  return (
    <>
      <div className="head"><h1>Órdenes de pago</h1><p>El banco ve ordenante, beneficiario, concepto e importe. No ve el contenido de las facturas.</p></div>
      <section className="card"><h2>Pendientes de ejecutar</h2>
        {pendientes.length ? <div className="stack">{pendientes.map((o) => {
          const ok = saldo(o.ordenante_id) >= Number(o.importe) + Number(o.comision);
          return (
            <div className="doc" key={o.id}>
              <div className="btns" style={{ justifyContent: "space-between", alignItems: "center" }}><span className="ref">{o.num}</span><span className="mono" style={{ fontSize: "1.1rem", fontWeight: 600 }}>{fmt(o.importe)}</span></div>
              <div className="parties"><div><span className="lbl">Ordenante</span><strong>{corto(o.ordenante_id)}</strong><span className="muted">Saldo {fmt(saldo(o.ordenante_id))}</span></div>
                <div><span className="lbl">Beneficiario</span><strong>{corto(o.beneficiario_id)}</strong></div>
                <div><span className="lbl">Concepto</span><strong>{o.concepto}</strong><span className="muted">Comisión {fmt(o.comision)}</span></div></div>
              {!ok && <div className="note bad">El ordenante no tiene saldo suficiente.</div>}
              {ok && <Form action={ejecutarOrden} boton="Ejecutar transferencia"><input type="hidden" name="orden" value={o.id} /></Form>}
              <Form action={denegarOrden} boton="Denegar" clase="btn danger"><input type="hidden" name="orden" value={o.id} /><label>Motivo si la deniegas<select className="in" name="motivo">{MOTIVOS_ORDEN.map((m) => <option key={m}>{m}</option>)}</select></label></Form>
            </div>
          );
        })}</div> : <p className="empty">No hay órdenes pendientes.</p>}
      </section>
      <section className="card"><h2>Historial</h2>
        {resueltas.length ? <div className="tw"><table className="t"><thead><tr><th>Orden</th><th>Ordenante → beneficiario</th><th>Justificante</th><th className="num">Importe</th></tr></thead><tbody>
          {resueltas.map((o) => <tr key={o.id}><td className="ref">{o.num}</td><td>{corto(o.ordenante_id)} → {corto(o.beneficiario_id)}</td><td className="mono">{o.justificante ?? "Denegada"}</td><td className="num">{fmt(o.importe)}</td></tr>)}
        </tbody></table></div> : <p className="empty">Sin historial.</p>}
      </section>
    </>
  );
}
