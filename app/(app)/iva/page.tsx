import { Form } from "@/components/Form";
import { presentarIva } from "@/app/acciones-circuito";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fecha, fmt } from "@/lib/formato";

type Liq = { id: number; num: string; empresa_id: number; periodo: string; repercutido: number; soportado: number; resultado: number; fecha: string; presento_nombre: string; justificante: string | null };
const PERIODOS: [string, string][] = [["2026-11", "Noviembre de 2026"], ["2026-12", "Diciembre de 2026"]];
const nombre = (p: string) => PERIODOS.find(([k]) => k === p)?.[1] ?? p;

export default async function Iva() {
  const yo = await miSesion();
  const prof = yo.rol === "profesora";
  const s = await sb();
  const [{ data: mod }, { data: filas }, { data: emp }] = await Promise.all([
    s.from("modulos").select("activo").eq("clave", "iva").maybeSingle(),
    s.from("liquidaciones_iva").select("*").order("periodo").order("empresa_id"),
    s.from("empresas").select("id, corto").eq("tipo", "grupo").order("id"),
  ]);
  const liqs = (filas ?? []) as unknown as Liq[];
  const corto = (g: number) => emp?.find((e) => e.id === g)?.corto ?? "";
  const pendientes = PERIODOS.filter(([k]) => !liqs.some((l) => l.periodo === k && l.empresa_id === yo.empresa_id));
  // La comparación con lo que dicen los documentos solo la ve la profesora: el cálculo es tarea del grupo
  const comparacion = prof ? await Promise.all((emp ?? []).flatMap((e) => PERIODOS.map(async ([k]) => {
    const { data } = await s.rpc("iva_calculado", { p_empresa: e.id, p_periodo: k });
    return { empresa: e.id, periodo: k, rep: Number(data?.[0]?.repercutido ?? 0), sop: Number(data?.[0]?.soportado ?? 0), liq: liqs.find((l) => l.empresa_id === e.id && l.periodo === k) };
  }))) : [];
  return (
    <>
      <div className="head"><h1>Liquidación de IVA</h1><p>Modelo simulado de noviembre y diciembre de 2026. {prof ? "Comparas lo que presenta cada grupo con lo que resulta de sus documentos aceptados." : "Calculad las cifras con vuestro libro: la app no las rellena. Si sale a ingresar, el dinero va a Hacienda al presentarla."}</p></div>
      {!mod?.activo && <div className="note info">La liquidación de IVA todavía no está activada por la profesora.</div>}
      {!prof && mod?.activo && pendientes.length > 0 && (
        <section className="card"><h2>Presentar el modelo</h2>
          <Form action={presentarIva} boton="Presentar">
            <div className="row3">
              <label>Periodo<select className="in" name="periodo">{pendientes.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label>IVA repercutido €<input className="in" type="number" min="0" step="0.01" name="repercutido" required /></label>
              <label>IVA soportado €<input className="in" type="number" min="0" step="0.01" name="soportado" required /></label>
            </div>
            <p className="hint">Una vez presentado no se puede cambiar. Si tenéis dudas, preguntad antes a la profesora.</p>
          </Form>
        </section>
      )}
      {prof ? (
        <section className="card"><h2>Comparación</h2>
          <div className="tw"><table className="t"><thead><tr><th>Empresa</th><th>Periodo</th><th className="num">Repercutido según documentos</th><th className="num">Presentado</th><th className="num">Soportado según documentos</th><th className="num">Presentado</th><th className="num">Resultado</th><th>Estado</th></tr></thead><tbody>
            {comparacion.map((c) => {
              const cuadra = c.liq && Number(c.liq.repercutido) === c.rep && Number(c.liq.soportado) === c.sop;
              return <tr key={c.empresa + c.periodo}><td>{corto(c.empresa)}</td><td>{nombre(c.periodo)}</td><td className="num">{fmt(c.rep)}</td><td className="num">{c.liq ? fmt(c.liq.repercutido) : "—"}</td><td className="num">{fmt(c.sop)}</td><td className="num">{c.liq ? fmt(c.liq.soportado) : "—"}</td><td className="num">{c.liq ? fmt(c.liq.resultado) : "—"}</td><td>{c.liq ? <span className={"chip " + (cuadra ? "good" : "warn")}>{cuadra ? "Coincide" : "No coincide"}</span> : <span className="chip off">Sin presentar</span>}</td></tr>;
            })}
          </tbody></table></div>
          <p className="hint" style={{ marginTop: 8 }}>Según documentos: facturas y rectificativas aceptadas con fecha del periodo, tickets y gastos de consumidores. Una diferencia no siempre es un error: revisa el documento antes de corregir al grupo.</p>
        </section>
      ) : (
        <section className="card"><h2>Modelos presentados</h2>
          {liqs.length ? <div className="tw"><table className="t"><thead><tr><th>Modelo</th><th>Periodo</th><th className="num">Repercutido</th><th className="num">Soportado</th><th className="num">Resultado</th><th>Presentó</th></tr></thead><tbody>
            {liqs.map((l) => <tr key={l.id}><td className="ref">{l.num}</td><td>{nombre(l.periodo)}</td><td className="num">{fmt(l.repercutido)}</td><td className="num">{fmt(l.soportado)}</td><td className="num"><strong>{fmt(l.resultado)}</strong> <span className="muted">{Number(l.resultado) > 0 ? "ingresado" : "a compensar"}</span></td><td>{l.presento_nombre} <span className="muted">{fecha(l.fecha)}</span></td></tr>)}
          </tbody></table></div> : <p className="empty">Todavía no habéis presentado ningún modelo.</p>}
        </section>
      )}
    </>
  );
}
