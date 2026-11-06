import Link from "next/link";
import { Form } from "@/components/Form";
import * as A from "@/app/acciones-circuito";
import { deudaVencida, ESTADOS_DEUDA, MOTIVOS_PEDIDO, type Deuda } from "@/lib/circuito";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fecha, fmt } from "@/lib/formato";

type Tramo = { id: number; vendedor_id: number; comprador_id: number | null; volumen_min: number; porcentaje: number };
type Volumen = { volumen: number; volumen_min: number | null; porcentaje: number; rappel: number; ya_emitido: number; por_emitir: number; siguiente_volumen: number | null; siguiente_porcentaje: number | null };
const pc = (v: number) => String(Number(v)).replace(".", ",") + " %";
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export default async function Deudas({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const q = await searchParams;
  const yo = await miSesion();
  const s = await sb();
  const [{ data: filas }, { data: emp }, { data: hoyR }, { data: tra }, { data: ops }] = await Promise.all([
    s.from("deudas").select("*").order("id", { ascending: false }),
    s.from("empresas").select("id, corto, tipo").order("id"),
    s.rpc("hoy"),
    s.from("rappel_tramos").select("id, vendedor_id, comprador_id, volumen_min, porcentaje").eq("activo", true).order("vendedor_id").order("volumen_min"),
    s.from("pedidos").select("id, num, etapa, comprador_id, vendedor_id").in("etapa", ["factura_aceptada", "a_deber", "pagado"]).order("id", { ascending: false }),
  ]);
  const hoy = hoyR as string;
  const deudas = (filas ?? []) as unknown as Deuda[];
  const tramos = (tra ?? []) as unknown as Tramo[];
  const corto = (g: number | null) => emp?.find((e) => e.id === g)?.corto ?? "";
  const grupos = (emp ?? []).filter((e) => e.tipo === "grupo");
  const prof = yo.rol === "profesora";
  const m = /^\d{4}-\d{2}$/.test(q.mes ?? "") ? q.mes! : hoy.slice(0, 7);
  const mes = m + "-01";
  const nombreMes = MESES[Number(m.slice(5)) - 1] + " de " + m.slice(0, 4);
  const vigentes = deudas.filter((d) => d.estado === "vigente");
  const debo = vigentes.filter((d) => d.deudor_id === yo.empresa_id).reduce((a, d) => a + Number(d.pendiente), 0);
  const meDeben = vigentes.filter((d) => d.acreedor_id === yo.empresa_id).reduce((a, d) => a + Number(d.pendiente), 0);
  const porResponder = deudas.filter((d) => d.estado === "propuesta" && d.propuso_empresa !== yo.empresa_id && yo.empresa_id && [d.deudor_id, d.acreedor_id].includes(yo.empresa_id));
  const puedeVender = !!yo.empresa_id && yo.empresa_id !== 5;
  const clientes = puedeVender ? grupos.filter((e) => e.id !== yo.empresa_id) : [];
  // Lo que cada cliente lleva este mes conmigo, y lo que yo llevo con cada proveedor
  const volumenes = async (vendedor: number, comprador: number) => (await s.rpc("volumen_cliente", { p_vendedor: vendedor, p_comprador: comprador, p_mes: mes })).data?.[0] as Volumen | undefined;
  const comoVendedor = await Promise.all(clientes.map(async (c) => ({ c, v: await volumenes(yo.empresa_id!, c.id) })));
  const comoCliente = await Promise.all(clientes.map(async (c) => ({ c, v: await volumenes(c.id, yo.empresa_id!) })));
  const operaciones = (cliente: number) => (ops ?? []).filter((o) => o.vendedor_id === yo.empresa_id && o.comprador_id === cliente);
  return (
    <>
      <div className="head"><h1>Deudas y rappel</h1><p>{prof ? "Quién debe a quién. Una deuda vencida se puede registrar como incumplimiento." : "Dejar una factura a deber es un acuerdo por escrito: lo propone una parte y lo acepta la otra. Se paga todo de una vez o por partes, siempre por banco."}</p></div>
      {!prof && <div className="kpis"><div className="kpi"><span className="lbl">Debes</span><span className="v">{fmt(debo)}</span></div><div className="kpi"><span className="lbl">Te deben</span><span className="v">{fmt(meDeben)}</span></div></div>}
      {porResponder.length > 0 && (
        <section className="card"><h2>Propuestas por responder</h2>
          <div className="stack">{porResponder.map((d) => (
            <div className="doc" key={d.id}>
              <div className="btns" style={{ justifyContent: "space-between" }}><span><span className="ref">{d.num}</span> · <Link href={"/operaciones/" + d.pedido_id}>ver la operación</Link></span><strong>{fmt(d.importe)}</strong></div>
              <p>{corto(d.deudor_id)} debería a {corto(d.acreedor_id)} a {d.vencimiento_dias} días. Lo propone {d.propuso_nombre}.</p>
              {d.condiciones && <p className="correo-cuerpo">{d.condiciones}</p>}
              <Form action={A.responderDeuda} boton="Aceptar"><input type="hidden" name="deuda" value={d.id} /><input type="hidden" name="aceptar" value="true" /></Form>
              <Form action={A.responderDeuda} boton="Rechazar" clase="btn danger"><input type="hidden" name="deuda" value={d.id} /><input type="hidden" name="aceptar" value="false" /><label>Motivo si la rechazas<select className="in" name="motivo">{MOTIVOS_PEDIDO.map((x) => <option key={x}>{x}</option>)}</select></label></Form>
            </div>
          ))}</div>
        </section>
      )}
      <section className="card"><h2>Deudas vigentes</h2>
        {vigentes.length ? <div className="stack">{vigentes.map((d) => {
          const vencida = deudaVencida(d, hoy);
          return (
            <div className="doc" key={d.id}>
              <div className="btns" style={{ justifyContent: "space-between" }}>
                <span><span className="ref">{d.num}</span> · <Link href={"/operaciones/" + d.pedido_id}>ver la operación</Link>{d.origen === "abono" && <> <span className="chip info">Abono</span></>}</span>
                <span className={"chip " + (vencida ? "bad" : "info")}>{vencida ? "Venció el " : "Vence el "}{fecha(d.vencimiento as string)}</span>
              </div>
              <dl className="dl"><dt>Debe</dt><dd>{corto(d.deudor_id)}</dd><dt>A</dt><dd>{corto(d.acreedor_id)}</dd><dt>Importe</dt><dd>{fmt(d.importe)}</dd><dt><strong>Pendiente</strong></dt><dd><strong>{fmt(d.pendiente)}</strong></dd></dl>
              {d.impago_comunicado && <div className="note warn">Impago comunicado a la profesora el {fecha(d.impago_comunicado)}.{d.impago_registrado ? " Incumplimiento registrado." : ""}</div>}
              {yo.empresa_id === d.deudor_id && <Form action={A.pagarDeuda} boton="Pagar"><input type="hidden" name="deuda" value={d.id} /><label>Importe €<input className="in" type="number" min="0.01" step="0.01" max={Number(d.pendiente)} name="importe" defaultValue={Number(d.pendiente)} required /></label><p className="hint">Puedes pagar una parte. Se suma la comisión del banco a cada pago.</p></Form>}
              {yo.empresa_id === d.acreedor_id && <details className="ver"><summary>Dar más tiempo</summary><Form action={A.aplazarDeuda} boton="Aplazar" clase="btn ghost"><input type="hidden" name="deuda" value={d.id} /><label>Días lectivos desde hoy (5 a 30)<input className="in" type="number" min="5" max="30" name="dias" defaultValue="15" required /></label></Form></details>}
              {yo.empresa_id === d.acreedor_id && vencida && !d.impago_comunicado && <Form action={A.comunicarImpago} boton="Comunicar impago a la profesora" clase="btn danger"><input type="hidden" name="deuda" value={d.id} /><p className="hint">Antes reclámalo por escrito desde <Link href={"/correo/nuevo?para=" + d.deudor_id + "&pedido=" + d.pedido_id}>el correo</Link>.</p></Form>}
              {prof && vencida && !d.impago_registrado && <Form action={A.registrarImpago} boton="Registrar incumplimiento" clase="btn danger"><input type="hidden" name="deuda" value={d.id} /></Form>}
            </div>
          );
        })}</div> : <p className="empty">No hay deudas vigentes.</p>}
      </section>
      {puedeVender && (
        <section className="card"><h2>Rappel por volumen</h2>
          <div className="stack">
            <p className="hint">Publica un descuento por llegar a un volumen de compra en un mes. Se calcula sobre la base de las facturas aceptadas de ese mes y se aplica fuera de factura, con una rectificativa que el cliente acepta. Si la operación elegida está a deber, reduce la deuda; si ya está pagada, debes el abono al cliente.</p>
            {tramos.filter((t) => t.vendedor_id === yo.empresa_id).length > 0 && <div className="tw"><table className="t"><thead><tr><th>Cliente</th><th className="num">Desde</th><th className="num">Rappel</th><th></th></tr></thead><tbody>
              {tramos.filter((t) => t.vendedor_id === yo.empresa_id).map((t) => <tr key={t.id}><td>{t.comprador_id ? corto(t.comprador_id) : "Todos"}</td><td className="num">{fmt(t.volumen_min)}</td><td className="num">{pc(t.porcentaje)}</td><td><Form action={A.quitarTramoRappel} boton="Quitar" clase="btn ghost sm"><input type="hidden" name="tramo" value={t.id} /></Form></td></tr>)}
            </tbody></table></div>}
            <Form action={A.guardarTramoRappel} boton="Publicar tramo" clase="btn ghost">
              <div className="row3"><label>Cliente<select className="in" name="comprador" defaultValue=""><option value="">Todos</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.corto}</option>)}</select></label><label>Volumen al mes desde €<input className="in" type="number" min="0.01" step="0.01" name="volumen" required /></label><label>Rappel %<input className="in" type="number" min="0.01" max="100" step="0.01" name="porcentaje" required /></label></div>
            </Form>
            <form className="correo-filtros" action="/deudas"><label>Mes<input className="in" type="month" name="mes" defaultValue={m} /></label><button className="btn ghost">Ver</button></form>
            <h3>Tus clientes en {nombreMes}</h3>
            {comoVendedor.some((x) => Number(x.v?.volumen) > 0) ? <div className="stack">{comoVendedor.filter((x) => Number(x.v?.volumen) > 0).map(({ c, v }) => {
              const lista = operaciones(c.id);
              return (
                <div className="fila" key={c.id}>
                  <span><strong>{c.corto}</strong>: {fmt(v!.volumen)} facturados{Number(v!.porcentaje) > 0 ? <> · tramo del {pc(v!.porcentaje)} = {fmt(v!.rappel)}, emitido {fmt(v!.ya_emitido)}</> : ""}{v!.siguiente_volumen ? <span className="muted"> · siguiente tramo desde {fmt(v!.siguiente_volumen)} ({pc(v!.siguiente_porcentaje as number)})</span> : null}</span>
                  {Number(v!.por_emitir) > 0 && lista.length > 0 && <Form action={A.emitirRappelVolumen} boton={"Emitir rappel de " + fmt(v!.por_emitir)} clase="btn sm"><input type="hidden" name="mes" value={mes} /><label>Sobre la operación<select className="in" name="pedido">{lista.map((o) => <option key={o.id} value={o.id}>{o.num}{o.etapa === "a_deber" ? " (a deber)" : o.etapa === "pagado" ? " (pagada)" : " (sin pagar)"}</option>)}</select></label></Form>}
                </div>
              );
            })}</div> : <p className="empty">Ningún cliente tiene facturas aceptadas en este mes.</p>}
            <h3>Tus compras en {nombreMes}</h3>
            {comoCliente.some((x) => Number(x.v?.volumen) > 0) ? <div className="stack">{comoCliente.filter((x) => Number(x.v?.volumen) > 0).map(({ c, v }) => <div className="fila" key={c.id}><span><strong>{c.corto}</strong>: {fmt(v!.volumen)}{Number(v!.porcentaje) > 0 ? <> · te corresponde un rappel del {pc(v!.porcentaje)} ({fmt(v!.rappel)}, emitido {fmt(v!.ya_emitido)})</> : ""}{v!.siguiente_volumen ? <span className="muted"> · siguiente tramo desde {fmt(v!.siguiente_volumen)} ({pc(v!.siguiente_porcentaje as number)})</span> : null}</span></div>)}</div> : <p className="empty">Sin compras facturadas en este mes.</p>}
          </div>
        </section>
      )}
      <section className="card"><h2>Tramos publicados por cada proveedor</h2>
        {tramos.length ? <div className="tw"><table className="t"><thead><tr><th>Proveedor</th><th>Cliente</th><th className="num">Desde</th><th className="num">Rappel</th></tr></thead><tbody>
          {tramos.map((t) => <tr key={t.id}><td>{corto(t.vendedor_id)}</td><td>{t.comprador_id ? corto(t.comprador_id) : "Todos"}</td><td className="num">{fmt(t.volumen_min)}</td><td className="num">{pc(t.porcentaje)}</td></tr>)}
        </tbody></table></div> : <p className="empty">Ningún proveedor ha publicado tramos.</p>}
      </section>
      <section className="card"><h2>Historial</h2>
        {deudas.some((d) => d.estado === "saldada" || d.estado === "rechazada" || d.estado === "propuesta") ? <div className="tw"><table className="t"><thead><tr><th>Deuda</th><th>Debe</th><th>A</th><th>Fecha</th><th className="num">Importe</th><th>Estado</th></tr></thead><tbody>
          {deudas.filter((d) => d.estado !== "vigente").map((d) => <tr key={d.id}><td><Link className="ref" href={"/operaciones/" + d.pedido_id}>{d.num}</Link></td><td>{corto(d.deudor_id)}</td><td>{corto(d.acreedor_id)}</td><td className="mono">{fecha(d.fecha)}</td><td className="num">{fmt(d.importe)}</td><td><span className={"chip " + ESTADOS_DEUDA[d.estado].color}>{ESTADOS_DEUDA[d.estado].etiqueta}</span>{d.motivo_rechazo && <span className="muted"> {d.motivo_rechazo}</span>}</td></tr>)}
        </tbody></table></div> : <p className="empty">Todavía no hay historial.</p>}
      </section>
    </>
  );
}
