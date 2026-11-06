import { Calculadora } from "@/components/Calculadora";
import { Form } from "@/components/Form";
import { publicarCondiciones } from "@/app/acciones-circuito";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fecha, fmt } from "@/lib/formato";

const pc = (v: number | null) => (v === null ? "—" : String(Number(v)).replace(".", ",") + " %");

// Las condiciones las ven todos; solo el banco las cambia
export default async function Condiciones() {
  const yo = await miSesion();
  const s = await sb();
  const { data } = await s.from("condiciones_banco").select("id, comision_transferencia, tipo_interes, plazo_max_meses, condiciones, vigente_desde").order("vigente_desde", { ascending: false }).order("id", { ascending: false });
  const vigente = data?.[0];
  const banco = yo.empresa_id === 5;
  return (
    <>
      <div className="head"><h1>Condiciones{banco ? " y cálculo" : " del banco"}</h1><p>Según el punto 8, el banco publica sus tipos, plazos, comisiones y condiciones, y no puede aplicar otras sin causa objetiva y documentada.</p></div>
      <section className="card"><h2>Condiciones vigentes</h2>
        <div className="stack">
          <div className="kpis">
            <div className="kpi"><span className="lbl">Comisión por transferencia</span><span className="v">{fmt(vigente?.comision_transferencia ?? 0)}</span></div>
            <div className="kpi"><span className="lbl">Tipo de interés de préstamos</span><span className="v">{pc(vigente?.tipo_interes ?? null)}</span></div>
            <div className="kpi"><span className="lbl">Plazo máximo</span><span className="v">{vigente?.plazo_max_meses ? vigente.plazo_max_meses + " meses" : "—"}</span></div>
          </div>
          {vigente?.condiciones && <p className="correo-cuerpo">{vigente.condiciones}</p>}
          {banco && <Form action={publicarCondiciones} boton="Publicar condiciones">
            <div className="row3">
              <label>Comisión por transferencia €<input className="in" type="number" min="0" step="0.01" name="comision" defaultValue={vigente?.comision_transferencia ?? 0} required /></label>
              <label>Tipo de interés %<input className="in" type="number" min="0" step="0.01" name="tipo" defaultValue={vigente?.tipo_interes ?? ""} /></label>
              <label>Plazo máximo en meses<input className="in" type="number" min="1" step="1" name="plazo" defaultValue={vigente?.plazo_max_meses ?? ""} /></label>
            </div>
            <label>Otras condiciones<textarea className="in" name="condiciones" maxLength={2000} defaultValue={vigente?.condiciones ?? ""} /></label>
          </Form>}
          <div className="tw"><table className="t"><thead><tr><th>Desde</th><th className="num">Comisión</th><th className="num">Tipo</th><th className="num">Plazo máx.</th></tr></thead><tbody>
            {data?.map((c) => <tr key={c.id}><td className="mono">{fecha(c.vigente_desde)}</td><td className="num">{fmt(c.comision_transferencia)}</td><td className="num">{pc(c.tipo_interes)}</td><td className="num">{c.plazo_max_meses ?? "—"}</td></tr>)}
          </tbody></table></div>
        </div>
      </section>
      {banco && <section className="card"><h2>Calculadora financiera</h2><Calculadora /></section>}
    </>
  );
}
