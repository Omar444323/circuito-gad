import { Form } from "@/components/Form";
import { constituirFianza, devolverFianza } from "@/app/acciones-circuito";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fecha, fmt } from "@/lib/formato";

type Fianza = { id: number; num: string; empresa_id: number; suministro: string; importe: number; receptor_id: number; fecha: string; justificante: string; estado: string; devuelta_fecha: string | null };

export default async function Fianzas() {
  const yo = await miSesion();
  const prof = yo.rol === "profesora";
  const s = await sb();
  const [{ data: mod }, { data: filas }, { data: emp }] = await Promise.all([
    s.from("modulos").select("activo").eq("clave", "suministros").maybeSingle(),
    s.from("fianzas").select("*").order("id", { ascending: false }),
    s.from("empresas").select("id, corto"),
  ]);
  const fianzas = (filas ?? []) as unknown as Fianza[];
  const corto = (g: number) => emp?.find((e) => e.id === g)?.corto ?? "";
  return (
    <>
      <div className="head"><h1>Electricidad y agua</h1><p>Contratar cada suministro exige depositar una fianza, que se devuelve al darlo de baja. Las facturas de consumo se piden al G4 como cualquier otro servicio.</p></div>
      {!mod?.activo && <div className="note info">Esta operación todavía no está activada por la profesora.</div>}
      {!prof && mod?.activo && (
        <section className="card"><h2>Depositar una fianza</h2>
          <Form action={constituirFianza} boton="Depositar">
            <div className="row3">
              <label>Suministro<select className="in" name="suministro"><option value="electricidad">Electricidad</option><option value="agua">Agua</option></select></label>
              <label>Importe €<input className="in" type="number" min="0.01" step="0.01" name="importe" required /></label>
            </div>
            <p className="hint">{yo.empresa_id === 4 ? "Como G4, la depositas en el Estado." : "Se deposita en el G4."} Es una transferencia sin comisión, con su justificante.</p>
          </Form>
        </section>
      )}
      <section className="card"><h2>Fianzas</h2>
        {fianzas.length ? <div className="tw"><table className="t"><thead><tr><th>Fianza</th><th>Empresa</th><th>Suministro</th><th>Fecha</th><th className="num">Importe</th><th>Depositada en</th><th>Estado</th><th></th></tr></thead><tbody>
          {fianzas.map((z) => <tr key={z.id}><td className="ref">{z.num}</td><td>{corto(z.empresa_id)}</td><td>{z.suministro === "agua" ? "Agua" : "Electricidad"}</td><td className="mono">{fecha(z.fecha)}</td><td className="num">{fmt(z.importe)}</td><td>{corto(z.receptor_id)}</td><td>{z.estado === "devuelta" ? <span className="chip off">Devuelta el {fecha(z.devuelta_fecha as string)}</span> : <span className="chip good">Vigente</span>}</td>
            <td>{z.estado === "constituida" && ((z.receptor_id === 4 && yo.empresa_id === 4) || (z.receptor_id === 7 && prof)) && <Form action={devolverFianza} boton="Devolver" clase="btn ghost sm"><input type="hidden" name="fianza" value={z.id} /></Form>}</td></tr>)}
        </tbody></table></div> : <p className="empty">Todavía no hay fianzas.</p>}
      </section>
    </>
  );
}
