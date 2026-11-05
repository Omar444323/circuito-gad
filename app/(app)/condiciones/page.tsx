import { Calculadora } from "@/components/Calculadora";
import { Form } from "@/components/Form";
import { publicarComision } from "@/app/acciones-circuito";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fecha, fmt } from "@/lib/formato";

// Las condiciones las ven todos; solo el banco las cambia
export default async function Condiciones() {
  const yo = await miSesion();
  const s = await sb();
  const { data } = await s.from("condiciones_banco").select("id, comision_transferencia, vigente_desde").order("vigente_desde", { ascending: false }).order("id", { ascending: false });
  const vigente = data?.[0];
  const banco = yo.empresa_id === 5;
  return (
    <>
      <div className="head"><h1>Condiciones{banco ? " y cálculo" : " del banco"}</h1><p>Según el punto 8, el banco publica sus comisiones y no puede aplicar otras sin causa documentada.</p></div>
      <section className="card"><h2>Comisión por transferencia</h2>
        <div className="stack">
          <div className="kpi"><span className="lbl">Vigente</span><span className="v">{fmt(vigente?.comision_transferencia ?? 0)}</span></div>
          {banco && <Form action={publicarComision} boton="Publicar comisión"><label>Nueva comisión €<input className="in" type="number" min="0" step="0.01" name="comision" defaultValue={vigente?.comision_transferencia ?? 0} required /></label></Form>}
          <div className="tw"><table className="t"><thead><tr><th>Desde</th><th className="num">Comisión</th></tr></thead><tbody>
            {data?.map((c) => <tr key={c.id}><td className="mono">{fecha(c.vigente_desde)}</td><td className="num">{fmt(c.comision_transferencia)}</td></tr>)}
          </tbody></table></div>
        </div>
      </section>
      {banco && <section className="card"><h2>Calculadora financiera</h2><Calculadora /></section>}
    </>
  );
}
