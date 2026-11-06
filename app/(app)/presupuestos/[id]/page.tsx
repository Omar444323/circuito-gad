import Link from "next/link";
import { CampoEnvio, type Transporte } from "@/components/CampoEnvio";
import { Form, type Res } from "@/components/Form";
import { aceptarPresupuesto, contraofertarPresupuesto, ofertarPresupuesto, rechazarPresupuesto, registrarIncumplimientoPresupuesto } from "@/app/acciones-circuito";
import { calcularFactura } from "@/lib/calculo";
import { ESTADOS_PRESUPUESTO, MOTIVOS_PEDIDO, turnoPresupuesto, type Presupuesto } from "@/lib/circuito";
import { fecha, fmt } from "@/lib/formato";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";

type Linea = { id: number; descripcion: string; unidades: number; precio_tarifa: number; precio: number };
type Paso = { id: number; empresa_id: number; tipo: string; dto: number; rappel: number; pronto_pago: number; importe: number | null; nota: string | null; quien_nombre: string; fecha: string };
const PASOS: Record<string, string> = { solicitud: "Solicitud", oferta: "Oferta", contraoferta: "Contraoferta", aceptacion: "Aceptación", rechazo: "Rechazo" };
const pc = (v: number) => String(Number(v)).replace(".", ",");

const Volver = () => <Link className="btn ghost sm" href="/presupuestos" style={{ alignSelf: "flex-start", textDecoration: "none" }}>← Presupuestos</Link>;
const Oculto = ({ p }: { p: Presupuesto }) => <input type="hidden" name="presupuesto" value={p.id} />;

function FormNegociar({ p, lineas, action, boton, clase }: { p: Presupuesto; lineas: Linea[]; action: (r: Res, f: FormData) => Promise<Res>; boton: string; clase?: string }) {
  const campo = (k: string, etiqueta: string, v: number) => <label>{etiqueta}<input className="in" type="number" min="0" max="100" step="0.5" name={k} defaultValue={Number(v)} /></label>;
  return (
    <Form action={action} boton={boton} clase={clase}><Oculto p={p} />
      <div className="tw"><table className="t"><thead><tr><th>Artículo</th><th className="num">Uds</th><th className="num">Precio €</th></tr></thead><tbody>
        {lineas.map((l) => <tr key={l.id}><td>{l.descripcion}</td><td className="num">{Number(l.unidades)}</td><td><input className="in num" type="number" min="0" step="0.01" name={"pr_" + l.id} defaultValue={Number(l.precio)} aria-label={"Precio de " + l.descripcion} required /></td></tr>)}
      </tbody></table></div>
      <div className="row3">{campo("dto", "Descuento comercial %", p.dto)}{campo("rappel", "Rappel %", p.rappel)}{campo("pronto_pago", "Pronto pago %", p.pronto_pago)}</div>
      <label>Nota (opcional)<textarea className="in" name="nota" maxLength={1000} /></label>
    </Form>
  );
}

const Rechazar = ({ p }: { p: Presupuesto }) => (
  <Form action={rechazarPresupuesto} boton="Rechazar" clase="btn danger"><Oculto p={p} /><label>Motivo si lo rechazas<select className="in" name="motivo">{MOTIVOS_PEDIDO.map((m) => <option key={m}>{m}</option>)}</select></label></Form>
);

export default async function Detalle({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const yo = await miSesion();
  const s = await sb();
  const { data } = /^\d+$/.test(id) ? await s.from("presupuestos").select("*, plazo_presupuesto").eq("id", id).maybeSingle() : { data: null };
  if (!data) return <><Volver /><section className="card"><h2>Sin acceso</h2><p>Este presupuesto no pertenece a tu empresa.</p></section></>;
  const p = data as unknown as Presupuesto;
  const [{ data: lin }, { data: pas }, { data: empresas }, { data: hoyR }, { data: mov }, { data: tr }, { data: ped }] = await Promise.all([
    s.from("presupuesto_lineas").select("*").eq("presupuesto_id", id).order("id"),
    s.from("presupuesto_pasos").select("*").eq("presupuesto_id", id).order("id", { ascending: false }),
    s.from("empresas").select("id, corto"),
    s.rpc("hoy"),
    s.from("movimientos_banco").select("saldo").eq("empresa_id", yo.empresa_id ?? 0).order("id", { ascending: false }).limit(1).maybeSingle(),
    s.from("catalogo").select("id, nombre, precio").eq("empresa_id", 4).eq("activo", true).eq("es_transporte", true).order("nombre"),
    p.pedido_id ? s.from("pedidos").select("id, num").eq("id", p.pedido_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const lineas = (lin ?? []) as unknown as Linea[];
  const pasos = (pas ?? []) as unknown as Paso[];
  const transportes = (tr ?? []) as unknown as Transporte[];
  const hoy = hoyR as string;
  const corto = (g: number) => empresas?.find((e) => e.id === g)?.corto ?? "";
  const c = calcularFactura(lineas.map((l) => ({ unidades: Number(l.unidades), precio: Number(l.precio) })), { dto: Number(p.dto), rappel: Number(p.rappel), pronto_pago: Number(p.pronto_pago) });
  const estado = ESTADOS_PRESUPUESTO[p.estado];
  const turno = turnoPresupuesto(p);
  const vencido = !!p.plazo_presupuesto && hoy > p.plazo_presupuesto;
  const registrado = p.incumplimiento_desde === p.estado_desde;
  const saldo = Number(mov?.saldo ?? 0);
  return (
    <>
      <Volver />
      <div className="head"><span className="lbl">Presupuesto</span><h1 style={{ fontFamily: "var(--f-mono)" }}>{p.num}</h1>
        <p>{corto(p.comprador_id)} pide a {corto(p.vendedor_id)}{p.entrega_dias ? " · entrega en " + p.entrega_dias + " día" + (p.entrega_dias > 1 ? "s" : "") + " lectivo" + (p.entrega_dias > 1 ? "s" : "") + " desde la aceptación" : ""}</p>
        <div className="btns" style={{ marginTop: 8 }}><span className={"chip " + estado.color}>{estado.etiqueta}</span>{p.plazo_presupuesto && <span className={"chip " + (vencido ? "bad" : "info")}>{vencido ? "Plazo vencido el " : "Hasta el "}{fecha(p.plazo_presupuesto)}</span>}</div></div>
      <div className="grid2">
        <div className="stack">
          <article className="doc">
            <div className="tw"><table className="t"><thead><tr><th>Artículo</th><th className="num">Uds</th><th className="num">Tarifa</th><th className="num">Precio</th><th className="num">Importe</th></tr></thead><tbody>
              {lineas.map((l) => <tr key={l.id}><td>{l.descripcion}</td><td className="num">{Number(l.unidades)}</td><td className="num">{fmt(l.precio_tarifa)}</td><td className="num">{fmt(l.precio)}</td><td className="num">{fmt(Number(l.unidades) * Number(l.precio))}</td></tr>)}
            </tbody></table></div>
            <div className="tot"><dl className="dl"><dt>Suma</dt><dd>{fmt(c.suma)}</dd>
              {Number(p.dto) > 0 && <><dt>Descuento comercial {pc(p.dto)} %</dt><dd>−{fmt(c.dtoImp)}</dd></>}
              {Number(p.rappel) > 0 && <><dt>Rappel {pc(p.rappel)} %</dt><dd>−{fmt(c.rapImp)}</dd></>}
              {Number(p.pronto_pago) > 0 && <><dt>Pronto pago {pc(p.pronto_pago)} %</dt><dd>−{fmt(c.ppImp)}</dd></>}
              <dt className="grand">Importe sin IVA</dt><dd className="grand">{fmt(c.base)}</dd></dl></div>
            {p.motivo_rechazo && <div className="note bad">Motivo del rechazo: {p.motivo_rechazo}</div>}
            <p className="hint">Los descuentos negociados aparecen ya rellenos al hacer la factura. Si el rappel o el pronto pago se conceden después, van en una rectificativa.</p>
          </article>
        </div>
        <div className="stack">
          <section className="card"><h3>Siguiente paso</h3>
            <div className="stack">
              {ped && <div className="note good">Aceptado. Pedido <Link className="ref" href={"/operaciones/" + ped.id}>{ped.num}</Link></div>}
              {yo.rol === "profesora" && vencido && !registrado && <><div className="note bad">{corto(p.vendedor_id)} no ha respondido en plazo.</div><Form action={registrarIncumplimientoPresupuesto} boton="Registrar incumplimiento" clase="btn danger"><Oculto p={p} /></Form></>}
              {vencido && registrado && <div className="note info">Incumplimiento registrado.</div>}
              {yo.rol === "profesora" && !vencido && !ped && <p className="hint">Como profesora ves la negociación, pero no actúas por los grupos.</p>}
              {yo.rol !== "profesora" && turno && turno !== yo.empresa_id && <p>Esperando a <strong>{corto(turno)}</strong>.</p>}
              {turno === yo.empresa_id && yo.empresa_id === p.vendedor_id && <>
                <FormNegociar p={p} lineas={lineas} action={ofertarPresupuesto} boton="Enviar oferta" />
                <Rechazar p={p} />
              </>}
              {turno === yo.empresa_id && yo.empresa_id === p.comprador_id && <>
                <Form action={aceptarPresupuesto} boton="Aceptar oferta y crear el pedido"><Oculto p={p} />
                  {!p.servicio && yo.empresa_id !== 4 && <CampoEnvio transportes={transportes} />}
                  {c.base > saldo * 0.2 && <><div className="note warn">Esta compra supera el 20 % de tu tesorería ({fmt(saldo)}). Las normas exigen comprobar saldo, vencimiento y forma de pago antes de hacerla.</div><label className="check"><input type="checkbox" name="confirmado" required /> He comprobado saldo, vencimiento y forma de pago</label></>}
                </Form>
                <details className="ver"><summary>Hacer una contraoferta</summary><FormNegociar p={p} lineas={lineas} action={contraofertarPresupuesto} boton="Enviar contraoferta" clase="btn ghost" /></details>
                <Rechazar p={p} />
              </>}
            </div>
          </section>
          <section className="card"><h3>Negociación</h3>
            <ul className="log">{pasos.map((x) => <li key={x.id}><span className="d">{fecha(x.fecha).slice(0, 5)}</span><span><strong>{PASOS[x.tipo]}</strong> de {corto(x.empresa_id)} · <span className="muted">{x.quien_nombre}</span>{x.importe !== null && x.tipo !== "rechazo" ? <> · {fmt(x.importe)}</> : null}{Number(x.dto) + Number(x.rappel) + Number(x.pronto_pago) > 0 ? <> (dto. {pc(x.dto)} %, rappel {pc(x.rappel)} %, p. pago {pc(x.pronto_pago)} %)</> : null}{x.nota ? <><br />{x.nota}</> : null}</span></li>)}</ul>
          </section>
        </div>
      </div>
    </>
  );
}
