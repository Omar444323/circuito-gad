import Link from "next/link";
import { Form } from "@/components/Form";
import type { Orden } from "@/components/Documentos";
import { pagarEstado, puntear } from "@/app/acciones-circuito";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fecha, fmt } from "@/lib/formato";

type Mov = { id: number; fecha: string; concepto: string; justificante: string | null; importe: number; saldo: number; punteado: boolean };

export default async function MiCuenta() {
  const yo = await miSesion();
  const g = yo.empresa_id ?? 0;
  const s = await sb();
  const [{ data: e }, { data: filas }, { data: ords }, { data: empresas }, { data: disp }, { data: con }] = await Promise.all([
    s.from("empresas").select("iban").eq("id", g).maybeSingle(),
    s.from("movimientos_banco").select("*").eq("empresa_id", g).order("id", { ascending: false }),
    s.from("ordenes_pago").select("*").eq("ordenante_id", g).order("id", { ascending: false }),
    s.from("empresas").select("id, corto"),
    s.rpc("disponible", { p_empresa: g }),
    s.from("condiciones_banco").select("comision_transferencia").order("vigente_desde", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const movs = (filas ?? []) as unknown as Mov[];
  const ordenes = (ords ?? []) as unknown as Orden[];
  const saldo = Number(movs[0]?.saldo ?? 0);
  const disponible = Number(disp ?? 0);
  const corto = (id: number) => empresas?.find((x) => x.id === id)?.corto ?? "";
  const inicial = movs.at(-1)?.id;
  const sinPuntear = movs.filter((m) => m.id !== inicial && !m.punteado);
  const importeSin = sinPuntear.reduce((a, m) => a + Number(m.importe), 0);
  return (
    <>
      <div className="head"><h1>Mi cuenta bancaria</h1><p>Todos los cobros y pagos pasan por aquí; no se usa efectivo. IBAN <span className="mono">{e?.iban}</span></p></div>
      <div className="kpis">
        <div className="kpi"><span className="lbl">Saldo</span><span className="v">{fmt(saldo)}</span></div>
        {disponible > saldo && <div className="kpi"><span className="lbl">Descubierto autorizado</span><span className="v">{fmt(disponible - saldo)}</span></div>}
        <div className="kpi"><span className="lbl">Disponible</span><span className="v">{fmt(disponible)}</span></div>
      </div>
      <section className="card"><h2>Pagar a Hacienda o a la Seguridad Social</h2>
        <Form action={pagarEstado} boton="Pagar">
          <div className="row3">
            <label>Cuenta<select className="in" name="cuenta"><option value="8">Hacienda</option><option value="9">Seguridad Social</option></select></label>
            <label>Concepto<input className="in" name="concepto" maxLength={150} placeholder="Por ejemplo, IVA de noviembre" required /></label>
            <label>Importe €<input className="in" type="number" min="0.01" step="0.01" name="importe" required /></label>
          </div>
          <p className="hint">El dinero sale al momento, con la comisión de la transferencia, y el banco lo verá para marcarlo como revisado.</p>
        </Form>
      </section>
      <section className="card"><h2>Extracto y conciliación bancaria</h2>
        <div className="stack">
          <p className="hint">Comisión publicada por transferencia: {fmt(con?.comision_transferencia ?? 0)}. Marca cada movimiento que encuentres en tu mayor de la cuenta 572 del Excel.</p>
          <div className={"note " + (sinPuntear.length ? "warn" : "good")}>{sinPuntear.length ? sinPuntear.length + " movimiento" + (sinPuntear.length > 1 ? "s" : "") + " del extracto sin puntear (" + fmt(importeSin) + "). Si no está en tu mayor de la cuenta 572, regístralo o explica la diferencia." : "Todos los movimientos del extracto están punteados con tu mayor de bancos."}</div>
          <div className="tw"><table className="t"><thead><tr><th>Punteado</th><th>Fecha</th><th>Concepto</th><th>Justificante</th><th className="num">Importe</th><th className="num">Saldo</th></tr></thead><tbody>
            {movs.map((m) => (
              <tr key={m.id}>
                <td>{m.id !== inicial && <Form action={puntear} boton={m.punteado ? "Punteado" : "Puntear"} clase={m.punteado ? "btn sm" : "btn ghost sm"}><input type="hidden" name="mov" value={m.id} /><input type="hidden" name="valor" value={String(!m.punteado)} /></Form>}</td>
                <td className="mono">{fecha(m.fecha)}</td><td>{m.concepto}</td><td className="mono">{m.justificante ?? "—"}</td>
                <td className={"num " + (m.importe < 0 ? "neg" : "pos")}>{fmt(m.importe)}</td><td className="num">{fmt(m.saldo)}</td>
              </tr>
            ))}
          </tbody></table></div>
        </div>
      </section>
      <section className="card"><h2>Mis pagos</h2>
        {ordenes.length ? <div className="tw"><table className="t"><thead><tr><th>Orden</th><th>Beneficiario</th><th>Concepto</th><th>Banco</th><th className="num">Importe</th></tr></thead><tbody>
          {ordenes.map((o) => <tr key={o.id}><td>{o.pedido_id ? <Link className="ref" href={"/operaciones/" + o.pedido_id}>{o.num}</Link> : <span className="ref">{o.num}</span>}</td><td>{corto(o.beneficiario_id)}</td><td>{o.concepto}</td><td>{o.estado === "ejecutada" ? <span className={"chip " + (o.revisado_en ? "good" : "off")}>{o.revisado_en ? "Revisado" : "Sin revisar"}</span> : <span className="chip bad">No ejecutada</span>}</td><td className="num">{fmt(o.importe)}</td></tr>)}
        </tbody></table></div> : <p className="empty">Sin pagos.</p>}
      </section>
    </>
  );
}
