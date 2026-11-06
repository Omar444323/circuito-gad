import Link from "next/link";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fecha, fmt } from "@/lib/formato";

type Doc = { tipo: string; num: string; fecha: string; sentido: string; otra_id: number | null; estado: string; importe: number | null; pedido_id: number | null; presupuesto_id: number | null; elaboro: string | null; reviso: string | null };
const TIPOS: [string, string][] = [["presupuesto", "Presupuestos"], ["pedido", "Pedidos"], ["albaran", "Albaranes"], ["factura", "Facturas"], ["rectificativa", "Rectificativas"], ["justificante", "Justificantes"], ["ticket", "Tickets"], ["deuda", "Deudas"], ["nomina", "Nóminas"], ["fianza", "Fianzas"], ["iva", "Modelos de IVA"], ["otro", "Otros"]];
const ETIQUETA: Record<string, string> = { presupuesto: "Presupuesto", pedido: "Pedido", albaran: "Albarán", factura: "Factura", rectificativa: "Rectificativa", justificante: "Justificante", ticket: "Ticket", deuda: "Deuda", nomina: "Nómina", fianza: "Fianza", iva: "IVA", otro: "Otro" };
const IMPRIMIBLES = ["pedido", "albaran", "factura", "rectificativa", "justificante"];
const COLOR: Record<string, string> = { rechazado: "bad", rechazada: "bad", importado: "info", emitida: "info", "por confirmar": "info" };
const dia = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");

export default async function Archivo({ searchParams }: { searchParams: Promise<{ empresa?: string; tipo?: string; desde?: string; hasta?: string }> }) {
  const q = await searchParams;
  const yo = await miSesion();
  const prof = yo.rol === "profesora";
  const s = await sb();
  const { data: emp } = await s.from("empresas").select("id, corto, tipo, con_almacen").order("id");
  const grupos = (emp ?? []).filter((e) => e.tipo === "grupo");
  const empresa = prof ? (grupos.some((e) => String(e.id) === q.empresa) ? Number(q.empresa) : 1) : (yo.empresa_id as number);
  const tipo = TIPOS.some(([k]) => k === q.tipo) ? (q.tipo as string) : "";
  const desde = dia(q.desde);
  const hasta = dia(q.hasta);
  const { data, error } = await s.rpc("archivo_documentos", { p_empresa: empresa, p_tipo: tipo || null, p_desde: desde || null, p_hasta: hasta || null });
  const docs = (data ?? []) as Doc[];
  const corto = (g: number | null) => emp?.find((e) => e.id === g)?.corto ?? "—";
  const filtro = new URLSearchParams({ empresa: String(empresa), ...(tipo && { tipo }), ...(desde && { desde }), ...(hasta && { hasta }) }).toString();
  const descarga = (t: string, f: string) => `/exportar/${t}?${filtro}&formato=${f}`;
  const conAlmacen = emp?.find((e) => e.id === empresa)?.con_almacen;
  const enlace = (d: Doc) => (d.pedido_id ? "/operaciones/" + d.pedido_id : d.presupuesto_id ? "/presupuestos/" + d.presupuesto_id : null);
  return (
    <>
      <div className="head"><h1>Archivo</h1><p>Punto 3.7: todo lo emitido y recibido, también lo rechazado y lo corregido, con sus justificantes.</p></div>
      <section className="card">
        <form className="correo-filtros" action="/archivo">
          {prof && <label>Empresa<select className="in" name="empresa" defaultValue={empresa}>{grupos.map((e) => <option key={e.id} value={e.id}>{e.corto}</option>)}</select></label>}
          <label>Tipo<select className="in" name="tipo" defaultValue={tipo}><option value="">Todos</option>{TIPOS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label>Desde<input className="in" type="date" name="desde" defaultValue={desde} /></label>
          <label>Hasta<input className="in" type="date" name="hasta" defaultValue={hasta} /></label>
          <button className="btn ghost">Filtrar</button>
        </form>
      </section>
      <section className="card"><h2>Descargar</h2>
        <div className="fila"><span>Libro de documentos, con este filtro</span><span className="btns"><a className="btn ghost sm" href={descarga("libro", "xlsx")}>Excel</a><a className="btn ghost sm" href={descarga("libro", "csv")}>CSV</a></span></div>
        <div className="fila"><span>Extracto bancario, con estas fechas</span><span className="btns"><a className="btn ghost sm" href={descarga("extracto", "xlsx")}>Excel</a><a className="btn ghost sm" href={descarga("extracto", "csv")}>CSV</a></span></div>
        {conAlmacen && <div className="fila"><span>Fichas de almacén</span><span className="btns"><a className="btn ghost sm" href={descarga("almacen", "xlsx")}>Excel</a><a className="btn ghost sm" href={descarga("almacen", "csv")}>CSV</a></span></div>}
      </section>
      <section className="card"><h2>{docs.length} {docs.length === 1 ? "documento" : "documentos"}</h2>
        {error ? <div className="note bad">{error.message}</div> : docs.length ? <div className="tw"><table className="t"><thead><tr><th>Tipo</th><th>Número</th><th>Fecha</th><th>Sentido</th><th>Otra parte</th><th>Estado</th><th className="num">Importe</th><th>Elaboró</th><th>Revisó</th><th></th></tr></thead><tbody>
          {docs.map((d, i) => {
            const url = enlace(d);
            return <tr key={d.tipo + d.num + i}><td>{ETIQUETA[d.tipo] ?? d.tipo}</td><td>{url ? <Link className="ref" href={url}>{d.num}</Link> : <span className="ref">{d.num}</span>}</td><td className="mono">{fecha(d.fecha)}</td><td>{d.sentido === "emitido" ? "Emitido" : "Recibido"}</td><td>{corto(d.otra_id)}</td><td><span className={"chip " + (COLOR[d.estado] ?? "off")}>{d.estado}</span></td><td className="num">{d.importe === null ? "—" : fmt(d.importe)}</td><td>{d.elaboro ?? "—"}</td><td>{d.reviso ?? "—"}</td>
              <td>{d.pedido_id && IMPRIMIBLES.includes(d.tipo) && d.estado !== "importado" && <Link className="btn ghost sm" style={{ textDecoration: "none" }} href={`/imprimir/${d.pedido_id}?doc=${d.tipo}`}>Imprimir</Link>}</td></tr>;
          })}
        </tbody></table></div> : <p className="empty">No hay documentos con este filtro.</p>}
      </section>
    </>
  );
}
