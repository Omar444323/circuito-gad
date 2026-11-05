import Link from "next/link";
import { Form } from "@/components/Form";
import { cambiarModulo } from "../acciones";
import { registrarIncumplimiento, simularFecha } from "../acciones-circuito";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fecha, fmt } from "@/lib/formato";
import { actorDe, ETAPAS, textoPlazo, vencido, type Pedido } from "@/lib/circuito";

type Mov = { empresa_id: number; saldo: number; id: number };
type Bloqueo = { pedido_id: number; etapa: string; etapa_desde: string; comunicado_fecha: string | null; registrado: boolean };
type Incumplimiento = { id: number; responsable_id: number; texto: string; fecha: string };

export default async function Inicio() {
  const yo = await miSesion();
  const s = await sb();
  const [{ data: empresas }, { data: movs }, { data: modulos }, { data: hoyR }, { data: filas }, { data: blo }, { data: inc }, { data: ajustes }, { count: pendientes }] = await Promise.all([
    s.from("empresas").select("*").order("id"),
    s.from("movimientos_banco").select("empresa_id, saldo, id").order("id"),
    s.from("modulos").select("*").order("nombre"),
    s.rpc("hoy"),
    s.from("pedidos").select("*, plazo_limite").order("id", { ascending: false }),
    s.from("bloqueos").select("*"),
    s.from("incumplimientos").select("*").order("id", { ascending: false }),
    s.from("ajustes_demo").select("permitido, fecha_simulada").maybeSingle(),
    s.from("ordenes_pago").select("id", { count: "exact", head: true }).eq("estado", "pendiente"),
  ]);
  const hoy = hoyR as string;
  const pedidos = (filas ?? []) as unknown as Pedido[];
  const bloqueos = (blo ?? []) as unknown as Bloqueo[];
  const incumplimientos = (inc ?? []) as unknown as Incumplimiento[];
  const saldo = (g: number) => Number(((movs ?? []) as Mov[]).filter((m) => m.empresa_id === g).at(-1)?.saldo ?? 0);
  const corto = (g: number) => empresas?.find((e) => e.id === g)?.corto ?? "";
  const prof = yo.rol === "profesora";
  const verTodas = prof || yo.empresa_id === 5;
  const mia = empresas?.find((e) => e.id === yo.empresa_id);
  const tocan = pedidos.filter((p) => actorDe(p, hoy) === yo.empresa_id);
  const vencidos = pedidos.filter((p) => vencido(p, hoy));
  const estadoPlazo = (p: Pedido) => {
    const b = bloqueos.find((x) => x.pedido_id === p.id && x.etapa === p.etapa && x.etapa_desde === p.etapa_desde);
    return b?.registrado ? "registrado" : b?.comunicado_fecha ? "comunicado" : "sin comunicar";
  };
  const simulable = prof && ajustes?.permitido && process.env.VERCEL_ENV !== "production";
  return (
    <>
      <div className="head"><h1>{mia ? mia.corto : "Panel de control"}</h1><p>{mia ? mia.nombre + " · " + mia.actividad : "Vista del Estado: todas las empresas, plazos e incidencias."}</p></div>
      {mia && <div className="kpis"><div className="kpi"><span className="lbl">Saldo en banco</span><span className="v">{fmt(saldo(mia.id))}</span></div><div className="kpi"><span className="lbl">Te toca actuar</span><span className="v">{tocan.length}</span></div></div>}
      {prof && <div className="kpis"><div className="kpi"><span className="lbl">Plazos vencidos</span><span className="v">{vencidos.length}</span></div><div className="kpi"><span className="lbl">Órdenes pendientes</span><span className="v">{pendientes ?? 0}</span></div><div className="kpi"><span className="lbl">Incumplimientos</span><span className="v">{incumplimientos.length}</span></div></div>}
      {mia && tocan.length > 0 && (
        <section className="card"><h2>Te toca actuar</h2>
          {tocan.map((p) => <div className="fila" key={p.id}><span><Link className="ref" href={"/operaciones/" + p.id}>{p.num}</Link> · {ETAPAS[p.etapa].paso}</span>{vencido(p, hoy) ? <span className="chip bad">Plazo vencido</span> : p.plazo_limite ? <span className="chip info">Hasta el {fecha(p.plazo_limite)}</span> : null}</div>)}
        </section>
      )}
      {prof && (
        <section className="card"><h2>Plazos vencidos y bloqueos</h2>
          {vencidos.length ? vencidos.map((p) => {
            const estado = estadoPlazo(p);
            return (
              <div className="fila" key={p.id}>
                <span><Link className="ref" href={"/operaciones/" + p.id}>{p.num}</Link> · {corto(p.vendedor_id)} no ha llegado a {textoPlazo(p)} (límite {fecha(p.plazo_limite as string)}) <span className={"chip " + (estado === "registrado" ? "good" : estado === "comunicado" ? "warn" : "off")}>{estado}</span></span>
                {estado !== "registrado" && <Form action={registrarIncumplimiento} boton="Registrar incumplimiento" clase="btn danger sm"><input type="hidden" name="pedido" value={p.id} /></Form>}
              </div>
            );
          }) : <p className="empty">No hay plazos vencidos.</p>}
        </section>
      )}
      {(prof || incumplimientos.length > 0) && (
        <section className="card"><h2>Registro de incumplimientos</h2>
          {incumplimientos.length ? <div className="tw"><table className="t"><thead><tr><th>Fecha</th><th>Equipo</th><th>Incumplimiento</th></tr></thead><tbody>
            {incumplimientos.map((i) => <tr key={i.id}><td className="mono">{fecha(i.fecha)}</td><td>{corto(i.responsable_id)}</td><td>{i.texto}</td></tr>)}
          </tbody></table></div> : <p className="empty">Sin incumplimientos registrados.</p>}
        </section>
      )}
      {verTodas && (
        <section className="card"><h2>{prof ? "Saldos de las empresas" : "Cuentas de clientes"}</h2>
          <div className="tw"><table className="t"><thead><tr><th>Empresa</th><th className="num">Saldo inicial</th><th className="num">Saldo actual</th></tr></thead><tbody>
            {empresas?.map((e) => <tr key={e.id}><td><strong>{e.corto}</strong> <span className="muted">{e.nombre}</span></td><td className="num">{fmt(e.saldo_inicial)}</td><td className="num">{fmt(saldo(e.id))}</td></tr>)}
          </tbody></table></div>
          {!prof && <p className="hint" style={{ marginTop: 8 }}>Registro auxiliar. El banco no contabiliza estos saldos como pasivo.</p>}
        </section>
      )}
      {simulable && (
        <section className="card"><h2>Simular la fecha</h2>
          <Form action={simularFecha} boton="Aplicar"><label>Fecha de trabajo (vacía para volver a hoy)<input className="in" type="date" name="fecha" defaultValue={ajustes?.fecha_simulada ?? ""} /></label></Form>
          <p className="hint" style={{ marginTop: 8 }}>Solo disponible en el entorno de demostración.</p>
        </section>
      )}
      <section className="card"><h2>Contenidos activados por la profesora</h2>
        {prof ? (
          <div className="stack">{modulos?.map((m) => (
            <div className="fila" key={m.clave}><strong>{m.nombre}</strong>
              <Form action={cambiarModulo} boton={m.activo ? "Activado" : "Activar"} clase={m.activo ? "btn sm" : "btn ghost sm"}><input type="hidden" name="clave" value={m.clave} /><input type="hidden" name="activo" value={String(!m.activo)} /></Form>
            </div>))}</div>
        ) : (
          <div className="btns">{modulos?.map((m) => <span key={m.clave} className={m.activo ? "chip good" : "chip off"}>{m.nombre}{m.activo ? "" : " · no activado"}</span>)}</div>
        )}
      </section>
    </>
  );
}
import { Form } from "@/components/Form";
import { cambiarModulo } from "../acciones";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fmt } from "@/lib/formato";

type Mov = { empresa_id: number; saldo: number; id: number };

export default async function Inicio() {
  const yo = await miSesion();
  const s = await sb();
  const [{ data: empresas }, { data: movs }, { data: modulos }] = await Promise.all([
    s.from("empresas").select("*").order("id"),
    s.from("movimientos_banco").select("empresa_id, saldo, id").order("id"),
    s.from("modulos").select("*").order("nombre"),
  ]);
  const saldo = (g: number) => Number(((movs ?? []) as Mov[]).filter((m) => m.empresa_id === g).at(-1)?.saldo ?? 0);
  const verTodas = yo.rol === "profesora" || yo.empresa_id === 5;
  const mia = empresas?.find((e) => e.id === yo.empresa_id);
  return (
    <>
      <div className="head"><h1>{mia ? mia.corto : "Panel de control"}</h1><p>{mia ? mia.nombre + " · " + mia.actividad : "Vista del Estado: todas las empresas."}</p></div>
      {mia && <div className="kpis"><div className="kpi"><span className="lbl">Saldo en banco</span><span className="v">{fmt(saldo(mia.id))}</span></div></div>}
      {verTodas && (
        <section className="card"><h2>{yo.rol === "profesora" ? "Saldos de las empresas" : "Cuentas de clientes"}</h2>
          <div className="tw"><table className="t"><thead><tr><th>Empresa</th><th className="num">Saldo inicial</th><th className="num">Saldo actual</th></tr></thead><tbody>
            {empresas?.map((e) => <tr key={e.id}><td><strong>{e.corto}</strong> <span className="muted">{e.nombre}</span></td><td className="num">{fmt(e.saldo_inicial)}</td><td className="num">{fmt(saldo(e.id))}</td></tr>)}
          </tbody></table></div>
        </section>
      )}
      <section className="card"><h2>Contenidos activados por la profesora</h2>
        {yo.rol === "profesora" ? (
          <div className="stack">{modulos?.map((m) => (
            <div className="fila" key={m.clave}><strong>{m.nombre}</strong>
              <Form action={cambiarModulo} boton={m.activo ? "Activado" : "Activar"} clase={m.activo ? "btn sm" : "btn ghost sm"}><input type="hidden" name="clave" value={m.clave} /><input type="hidden" name="activo" value={String(!m.activo)} /></Form>
            </div>))}</div>
        ) : (
          <div className="btns">{modulos?.map((m) => <span key={m.clave} className={m.activo ? "chip good" : "chip off"}>{m.nombre}{m.activo ? "" : " · no activado"}</span>)}</div>
        )}
      </section>
    </>
  );
}
