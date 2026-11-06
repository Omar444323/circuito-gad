import { redirect } from "next/navigation";
import { CuadroCuotas, type Cuota } from "@/components/CuadroCuotas";
import { Form } from "@/components/Form";
import { estudiarFinanciacion, presentarPlan, solicitarFinanciacion } from "@/app/acciones-circuito";
import { MOTIVOS_PEDIDO } from "@/lib/circuito";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fecha, fmt } from "@/lib/formato";

type Solicitud = { perfil_id: string | null; cuotas_prestamo: Cuota[]; id: number; empresa_id: number; importe: number; plazo_meses: number; motivo: string; fecha: string; estado: string; tipo_interes: number | null; motivo_rechazo: string | null; rechazada_por: string | null; justificante: string | null; solicito_nombre: string; plazo_financiacion: string | null };
type Plan = { id: number; importe_solicitado: number; fecha: string; estado: string; importe_aprobado: number | null; condiciones: string | null; justificante: string | null };
const ESTADOS: Record<string, [string, string]> = { solicitada: ["En el banco", "info"], estudiada: ["Con la profesora", "warn"], autorizada: ["Autorizada y abonada", "good"], rechazada: ["Rechazada", "bad"] };
const PLANES: Record<string, [string, string]> = { presentado: ["Con la profesora", "warn"], aprobado: ["Aprobado", "good"], rechazado: ["Rechazado", "bad"] };
const pc = (v: number | null) => (v === null ? "—" : String(Number(v)).replace(".", ",") + " %");

export default async function Financiacion() {
  const yo = await miSesion();
  if (yo.rol === "profesora") redirect("/autorizaciones");
  const banco = yo.empresa_id === 5;
  const s = await sb();
  const [{ data: sol }, { data: pla }, { data: emp }, { data: mod }, { data: con }, { data: hoy }] = await Promise.all([
    s.from("solicitudes_financiacion").select("*, plazo_financiacion, cuotas_prestamo(*)").order("id", { ascending: false }),
    s.from("planes_viabilidad").select("*").eq("empresa_id", yo.empresa_id!).order("id", { ascending: false }),
    s.from("empresas").select("id, corto"),
    s.from("modulos").select("activo").eq("clave", "financiacion").maybeSingle(),
    s.from("condiciones_banco").select("tipo_interes, plazo_max_meses").order("vigente_desde", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(),
    s.rpc("hoy"),
  ]);
  // Los préstamos personales se ven en Mis finanzas; el banco los ve aquí con el nombre de quien pide
  const solicitudes = ((sol ?? []) as unknown as Solicitud[]).filter((x) => banco || !x.perfil_id);
  const planes = (pla ?? []) as unknown as Plan[];
  const corto = (g: number) => emp?.find((e) => e.id === g)?.corto ?? "";
  const pendientes = solicitudes.filter((x) => x.estado === "solicitada");
  const chip = ([t, c]: [string, string]) => <span className={"chip " + c}>{t}</span>;
  return (
    <>
      <div className="head"><h1>Financiación</h1><p>{banco ? "Estudiáis las solicitudes con los tipos publicados, en 3 días lectivos. Solo se abona el préstamo cuando la profesora lo autoriza." : "Un préstamo lo estudia el banco en 3 días lectivos y lo autoriza la profesora. El plan de viabilidad es para cuando la empresa no puede hacer frente a sus pagos."}</p></div>
      {banco && (
        <section className="card"><h2>Solicitudes por estudiar</h2>
          {pendientes.length ? <div className="stack">{pendientes.map((x) => {
            const vencida = x.plazo_financiacion && (hoy as string) > x.plazo_financiacion;
            return (
              <div className="doc" key={x.id}>
                <div className="btns" style={{ justifyContent: "space-between" }}><strong>{corto(x.empresa_id)} · {fmt(x.importe)} a {x.plazo_meses} meses</strong>{x.plazo_financiacion && <span className={"chip " + (vencida ? "bad" : "info")}>{vencida ? "Venció el " : "Hasta el "}{fecha(x.plazo_financiacion)}</span>}</div>
                <p>{x.motivo}</p>
                <Form action={estudiarFinanciacion} boton="Aprobar y enviar a la profesora"><input type="hidden" name="solicitud" value={x.id} /><input type="hidden" name="aprobar" value="true" />
                  <div className="row3"><label>Tipo de interés %<input className="in" type="number" min="0" step="0.01" name="tipo" defaultValue={con?.tipo_interes ?? ""} required /></label><label>Causa, si es distinto del publicado<input className="in" name="causa" /></label></div>
                </Form>
                <Form action={estudiarFinanciacion} boton="Rechazar" clase="btn danger"><input type="hidden" name="solicitud" value={x.id} /><input type="hidden" name="aprobar" value="false" /><label>Motivo si la rechazas<select className="in" name="motivo">{MOTIVOS_PEDIDO.map((m) => <option key={m}>{m}</option>)}</select></label></Form>
              </div>
            );
          })}</div> : <p className="empty">No hay solicitudes pendientes.</p>}
        </section>
      )}
      {!banco && (
        <section className="card"><h2>Pedir un préstamo</h2>
          {mod?.activo ? <Form action={solicitarFinanciacion} boton="Enviar al banco">
            <div className="row3"><label>Importe €<input className="in" type="number" min="0.01" step="0.01" name="importe" required /></label><label>Plazo en meses{con?.plazo_max_meses ? " (máximo " + con.plazo_max_meses + ")" : ""}<input className="in" type="number" min="1" step="1" max={con?.plazo_max_meses ?? undefined} name="plazo" required /></label></div>
            <label>Motivo<textarea className="in" name="motivo" maxLength={1000} required /></label>
            <p className="hint">Tipo publicado por el banco: {pc(con?.tipo_interes ?? null)}.</p>
          </Form> : <p className="empty">La financiación todavía no está activada por la profesora.</p>}
        </section>
      )}
      <section className="card"><h2>{banco ? "Todas las solicitudes" : "Mis solicitudes"}</h2>
        {solicitudes.length ? <div className="tw"><table className="t"><thead><tr>{banco && <th>Empresa</th>}<th>Fecha</th><th className="num">Importe</th><th className="num">Meses</th><th className="num">Tipo</th><th>Estado</th></tr></thead><tbody>
          {solicitudes.map((x) => <tr key={x.id}>{banco && <td>{corto(x.empresa_id)}{x.perfil_id && <span className="muted"> · personal: {x.solicito_nombre}</span>}</td>}<td className="mono">{fecha(x.fecha)}</td><td className="num">{fmt(x.importe)}</td><td className="num">{x.plazo_meses}</td><td className="num">{pc(x.tipo_interes)}</td><td>{chip(ESTADOS[x.estado] as [string, string])}{x.motivo_rechazo && <span className="muted"> {x.rechazada_por}: {x.motivo_rechazo}</span>}{x.justificante && <span className="mono muted"> {x.justificante}</span>}</td></tr>)}
        </tbody></table></div> : <p className="empty">Sin solicitudes.</p>}
      </section>
      {solicitudes.some((x) => x.cuotas_prestamo.length > 0) && (
        <section className="card"><h2>Cuadros de cuotas</h2>
          <div className="stack">{solicitudes.filter((x) => x.cuotas_prestamo.length > 0).map((x) => <div key={x.id}><p><strong>{banco ? corto(x.empresa_id) + (x.perfil_id ? " · " + x.solicito_nombre : "") + " · " : ""}{fmt(x.importe)} a {x.plazo_meses} meses al {pc(x.tipo_interes)}</strong></p><CuadroCuotas cuotas={x.cuotas_prestamo} puedePagar={!banco} /></div>)}</div>
        </section>
      )}
      <section className="card"><h2>Plan de viabilidad</h2>
        <div className="stack">
          <p className="hint">Si la empresa queda insolvente, las normas piden un plan con reducción de gastos, revisión de precios y financiación. La profesora decide si hay rescate del Estado.</p>
          <Form action={presentarPlan} boton="Presentar a la profesora" clase="btn ghost">
            <label>Reducción de gastos<textarea className="in" name="reduccion" maxLength={2000} required /></label>
            <label>Revisión de precios<textarea className="in" name="precios" maxLength={2000} required /></label>
            <label>Financiación<textarea className="in" name="financiacion" maxLength={2000} required /></label>
            <label>Rescate que solicitáis €<input className="in" type="number" min="0" step="0.01" name="importe" defaultValue="0" /></label>
          </Form>
          {planes.length > 0 && <div className="tw"><table className="t"><thead><tr><th>Fecha</th><th className="num">Solicitado</th><th className="num">Aprobado</th><th>Estado</th><th>Condiciones</th></tr></thead><tbody>
            {planes.map((p) => <tr key={p.id}><td className="mono">{fecha(p.fecha)}</td><td className="num">{fmt(p.importe_solicitado)}</td><td className="num">{p.importe_aprobado === null ? "—" : fmt(p.importe_aprobado)}</td><td>{chip(PLANES[p.estado] as [string, string])}</td><td>{p.condiciones ?? "—"}</td></tr>)}
          </tbody></table></div>}
        </div>
      </section>
    </>
  );
}
