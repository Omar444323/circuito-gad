import { Form } from "@/components/Form";
import { emitirNomina, fijarReglasNomina } from "@/app/acciones-circuito";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fecha, fmt } from "@/lib/formato";

type Nomina = { id: number; num: string; empresa_id: number; trabajador_nombre: string; mes: string; bruto: number; ss_trabajador: number; ss_empresa: number; irpf: number; liquido: number; fecha: string; elaboro_nombre: string; justificante: string };
const mesDe = (d: string) => d.slice(5, 7) + "/" + d.slice(0, 4);

export default async function Nominas() {
  const yo = await miSesion();
  const prof = yo.rol === "profesora";
  const s = await sb();
  const [{ data: mod }, { data: reglas }, { data: filas }, { data: gente }, { data: emp }, { data: hoy }] = await Promise.all([
    s.from("modulos").select("activo").eq("clave", "nominas").maybeSingle(),
    s.from("reglas_nomina").select("*").maybeSingle(),
    s.from("nominas").select("*").order("id", { ascending: false }),
    prof ? Promise.resolve({ data: [] as { id: string; nombre: string }[] }) : s.from("perfiles").select("id, nombre").eq("empresa_id", yo.empresa_id!).eq("activo", true).eq("cuenta_grupo", false).order("nombre"),
    s.from("empresas").select("id, corto"),
    s.rpc("hoy"),
  ]);
  const nominas = (filas ?? []) as unknown as Nomina[];
  const corto = (g: number) => emp?.find((e) => e.id === g)?.corto ?? "";
  return (
    <>
      <div className="head"><h1>Nóminas</h1><p>Salario bruto mínimo de {fmt(reglas?.bruto_minimo ?? 2000)} al mes, con las pagas extraordinarias prorrateadas. Se paga desde la cuenta de la empresa: el líquido a la persona, la Seguridad Social y el IRPF al Estado.</p></div>
      {!mod?.activo && <div className="note info">Las nóminas todavía no están activadas por la profesora.</div>}
      <section className="card"><h2>Reglas comunicadas por la profesora</h2>
        {prof ? (
          <Form action={fijarReglasNomina} boton="Guardar las reglas" clase="btn ghost">
            <div className="row3">
              <label>Seguridad Social del trabajador %<input className="in" type="number" min="0" max="100" step="0.01" name="ss_trabajador" defaultValue={reglas?.ss_trabajador ?? 0} required /></label>
              <label>Seguridad Social de la empresa %<input className="in" type="number" min="0" max="100" step="0.01" name="ss_empresa" defaultValue={reglas?.ss_empresa ?? 0} required /></label>
              <label>IRPF %<input className="in" type="number" min="0" max="100" step="0.01" name="irpf" defaultValue={reglas?.irpf ?? 0} required /></label>
            </div>
            <p className="hint">Empiezan en cero hasta que lo expliques en clase.</p>
          </Form>
        ) : <dl className="dl"><dt>Seguridad Social del trabajador</dt><dd>{Number(reglas?.ss_trabajador ?? 0)} %</dd><dt>Seguridad Social de la empresa</dt><dd>{Number(reglas?.ss_empresa ?? 0)} %</dd><dt>IRPF</dt><dd>{Number(reglas?.irpf ?? 0)} %</dd></dl>}
      </section>
      {!prof && mod?.activo && (
        <section className="card"><h2>Emitir y pagar una nómina</h2>
          {gente?.length ? <Form action={emitirNomina} boton="Emitir y pagar">
            <div className="row3">
              <label>Trabajador<select className="in" name="trabajador">{gente.map((g) => <option key={g.id} value={g.id}>{g.nombre}</option>)}</select></label>
              <label>Mes<input className="in" type="month" name="mes" defaultValue={(hoy as string).slice(0, 7)} required /></label>
              <label>Salario bruto €<input className="in" type="number" min={Number(reglas?.bruto_minimo ?? 2000)} step="0.01" name="bruto" defaultValue={Number(reglas?.bruto_minimo ?? 2000)} required /></label>
            </div>
          </Form> : <p className="empty">Tu empresa todavía no tiene integrantes dados de alta.</p>}
        </section>
      )}
      <section className="card"><h2>{prof ? "Todas las nóminas" : "Nóminas de la empresa"}</h2>
        {nominas.length ? <div className="tw"><table className="t"><thead><tr><th>Nómina</th>{prof && <th>Empresa</th>}<th>Trabajador</th><th>Mes</th><th className="num">Bruto</th><th className="num">SS trabajador</th><th className="num">IRPF</th><th className="num">Líquido</th><th className="num">SS empresa</th><th>Elaboró</th></tr></thead><tbody>
          {nominas.map((n) => <tr key={n.id}><td className="ref">{n.num}</td>{prof && <td>{corto(n.empresa_id)}</td>}<td>{n.trabajador_nombre}</td><td className="mono">{mesDe(n.mes)}</td><td className="num">{fmt(n.bruto)}</td><td className="num">{fmt(n.ss_trabajador)}</td><td className="num">{fmt(n.irpf)}</td><td className="num"><strong>{fmt(n.liquido)}</strong></td><td className="num">{fmt(n.ss_empresa)}</td><td>{n.elaboro_nombre} <span className="muted">{fecha(n.fecha)}</span></td></tr>)}
        </tbody></table></div> : <p className="empty">Todavía no hay nóminas.</p>}
      </section>
    </>
  );
}
