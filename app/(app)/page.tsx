import Link from "next/link";
import { Form } from "@/components/Form";
import { cambiarModulo } from "../acciones";
import { registrarIncumplimiento, registrarIncumplimientoPresupuesto, simularFecha } from "../acciones-circuito";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fecha, fmt } from "@/lib/formato";
import { actorDe, ETAPAS, textoPlazo, vencido, type Pedido, type Presupuesto } from "@/lib/circuito";

type Mov = { empresa_id: number; saldo: number; id: number };
type Bloqueo = { pedido_id: number; etapa: string; etapa_desde: string; comunicado_fecha: string | null; registrado: boolean };
type Incumplimiento = { id: number; responsable_id: number; texto: string; fecha: string };
type Empresa = { id: number; corto: string; nombre: string; actividad: string; saldo_inicial: number; tipo: string };
const contar = { count: "exact", head: true } as const;

export default async function Inicio() {
  const yo = await miSesion();
  const s = await sb();
  const [{ data: emp }, { data: movs }, { data: modulos }, { data: hoyR }, { data: filas }, { data: blo }, { data: inc }, { data: ajustes }, { count: precios }, { count: prestamos }, { count: planes }, { data: pres }, { data: circ }, { data: entr }] = await Promise.all([
    s.from("empresas").select("*").order("id"),
    s.from("movimientos_banco").select("empresa_id, saldo, id").order("id"),
    s.from("modulos").select("*").order("nombre"),
    s.rpc("hoy"),
    s.from("pedidos").select("*, plazo_limite").order("id", { ascending: false }),
    s.from("bloqueos").select("*"),
    s.from("incumplimientos").select("*").order("id", { ascending: false }),
    s.from("ajustes_demo").select("permitido, fecha_simulada").maybeSingle(),
    s.from("solicitudes_precio").select("id", contar).eq("estado", "pendiente"),
    s.from("solicitudes_financiacion").select("id", contar).eq("estado", "estudiada"),
    s.from("planes_viabilidad").select("id", contar).eq("estado", "presentado"),
    s.from("presupuestos").select("*, plazo_presupuesto"),
    s.from("circulares").select("id, titulo, fecha_limite").not("fecha_limite", "is", null).order("fecha_limite"),
    s.from("entregas").select("circular_id, empresa_id"),
  ]);
  const hoy = hoyR as string;
  const empresas = (emp ?? []) as unknown as Empresa[];
  const pedidos = (filas ?? []) as unknown as Pedido[];
  const bloqueos = (blo ?? []) as unknown as Bloqueo[];
  const incumplimientos = (inc ?? []) as unknown as Incumplimiento[];
  const saldo = (g: number) => Number(((movs ?? []) as Mov[]).filter((m) => m.empresa_id === g).at(-1)?.saldo ?? 0);
  const corto = (g: number) => empresas.find((e) => e.id === g)?.corto ?? "";
  const prof = yo.rol === "profesora";
  const verTodas = prof || yo.empresa_id === 5;
  const mia = empresas.find((e) => e.id === yo.empresa_id);
  const tocan = pedidos.filter((p) => actorDe(p, hoy) === yo.empresa_id);
  const vencidos = pedidos.filter((p) => vencido(p, hoy) && p.vendedor_id <= 6);
  const presVencidos = ((pres ?? []) as unknown as Presupuesto[]).filter((p) => p.plazo_presupuesto && hoy > p.plazo_presupuesto && p.incumplimiento_desde !== p.estado_desde);
  const porEntregar = yo.empresa_id ? (circ ?? []).filter((c) => !entr?.some((x) => x.circular_id === c.id && x.empresa_id === yo.empresa_id)) : [];
  const porAutorizar = (precios ?? 0) + (prestamos ?? 0) + (planes ?? 0);
  const enApuros = (e: Empresa) => Number(e.saldo_inicial) > 0 && saldo(e.id) <= Number(e.saldo_inicial) * 0.1;
  const estadoPlazo = (p: Pedido) => {
    const b = bloqueos.find((x) => x.pedido_id === p.id && x.etapa === p.etapa && x.etapa_desde === p.etapa_desde);
    return b?.registrado ? "registrado" : b?.comunicado_fecha ? "comunicado" : "sin comunicar";
  };
  const simulable = prof && ajustes?.permitido && process.env.VERCEL_ENV !== "production";
  const tablaSaldos = (lista: Empresa[], avisar: boolean) => (
    <div className="tw"><table className="t"><thead><tr><th>Cuenta</th><th className="num">Saldo inicial</th><th className="num">Saldo actual</th></tr></thead><tbody>
      {lista.map((e) => <tr key={e.id}><td><strong>{e.corto}</strong> <span className="muted">{e.nombre}</span>{avisar && enApuros(e) && <> <span className="chip bad">Riesgo de insolvencia</span></>}</td><td className="num">{fmt(e.saldo_inicial)}</td><td className="num">{fmt(saldo(e.id))}</td></tr>)}
    </tbody></table></div>
  );
  return (
    <>
      <div className="head"><h1>{mia ? mia.corto : "Panel de control"}</h1><p>{mia ? mia.nombre + " · " + mia.actividad : "Vista del Estado: revisas plazos, incidencias, precios y entregas. Los grupos hacen las operaciones."}</p></div>
      {mia && <div className="kpis"><div className="kpi"><span className="lbl">Saldo en banco</span><span className="v">{fmt(saldo(mia.id))}</span></div><div className="kpi"><span className="lbl">Te toca actuar</span><span className="v">{tocan.length}</span></div></div>}
      {mia && enApuros(mia) && <div className="note bad">Vuestro saldo está por debajo del 10 % del inicial. Si no podéis hacer frente a los pagos, presentad un <Link href="/financiacion">plan de viabilidad</Link> a la profesora.</div>}
      {prof && <div className="kpis"><div className="kpi"><span className="lbl">Plazos vencidos</span><span className="v">{vencidos.length + presVencidos.length}</span></div><div className="kpi"><span className="lbl">Por autorizar</span><span className="v">{porAutorizar}</span></div><div className="kpi"><span className="lbl">Incumplimientos</span><span className="v">{incumplimientos.length}</span></div></div>}
      {prof && porAutorizar > 0 && <div className="note warn">Tienes {porAutorizar} {porAutorizar === 1 ? "asunto" : "asuntos"} por resolver en <Link href="/autorizaciones">Autorizaciones</Link>.</div>}
      {mia && tocan.length > 0 && (
        <section className="card"><h2>Te toca actuar</h2>
          {tocan.map((p) => <div className="fila" key={p.id}><span><Link className="ref" href={"/operaciones/" + p.id}>{p.num}</Link> · {ETAPAS[p.etapa].paso}</span>{vencido(p, hoy) ? <span className="chip bad">Plazo vencido</span> : p.plazo_limite ? <span className="chip info">Hasta el {fecha(p.plazo_limite)}</span> : null}</div>)}
        </section>
      )}
      {mia && porEntregar.length > 0 && (
        <section className="card"><h2>Entregas pendientes</h2>
          {porEntregar.map((c) => <div className="fila" key={c.id}><span><Link href={"/circulares/" + c.id}>{c.titulo}</Link></span><span className={"chip " + (hoy > (c.fecha_limite as string) ? "bad" : "info")}>{hoy > (c.fecha_limite as string) ? "Venció el " : "Hasta el "}{fecha(c.fecha_limite as string)}</span></div>)}
        </section>
      )}
      {prof && (
        <section className="card"><h2>Plazos vencidos y bloqueos</h2>
          {vencidos.length + presVencidos.length ? <>{vencidos.map((p) => {
            const estado = estadoPlazo(p);
            return (
              <div className="fila" key={p.id}>
                <span><Link className="ref" href={"/operaciones/" + p.id}>{p.num}</Link> · {corto(p.vendedor_id)} no ha llegado a {textoPlazo(p)} (límite {fecha(p.plazo_limite as string)}) <span className={"chip " + (estado === "registrado" ? "good" : estado === "comunicado" ? "warn" : "off")}>{estado}</span></span>
                {estado !== "registrado" && <Form action={registrarIncumplimiento} boton="Registrar incumplimiento" clase="btn danger sm"><input type="hidden" name="pedido" value={p.id} /></Form>}
              </div>
            );
          })}{presVencidos.map((p) => (
            <div className="fila" key={"pr" + p.id}>
              <span><Link className="ref" href={"/presupuestos/" + p.id}>{p.num}</Link> · {corto(p.vendedor_id)} no ha respondido al presupuesto (límite {fecha(p.plazo_presupuesto as string)})</span>
              <Form action={registrarIncumplimientoPresupuesto} boton="Registrar incumplimiento" clase="btn danger sm"><input type="hidden" name="presupuesto" value={p.id} /></Form>
            </div>
          ))}</> : <p className="empty">No hay plazos vencidos.</p>}
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
          {tablaSaldos(empresas.filter((e) => e.tipo === "grupo"), prof)}
          {!prof && <p className="hint" style={{ marginTop: 8 }}>Registro auxiliar. El banco no contabiliza estos saldos como pasivo.</p>}
          <h3 style={{ marginTop: 16 }}>Cuentas del Estado</h3>
          {tablaSaldos(empresas.filter((e) => e.tipo === "estado"), false)}
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
