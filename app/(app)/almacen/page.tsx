import Link from "next/link";
import { comprobarPmp, venderTienda } from "@/app/acciones-circuito";
import { FabricarForm } from "@/components/FabricarForm";
import { Form } from "@/components/Form";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fecha, fmt, pmp } from "@/lib/formato";

type Articulo = { id: string; nombre: string; cuenta: number; unidades: number; pmp: number | null; valor: number | null; catalogo_id: string | null };
type Mov = { id: number; fecha: string; concepto: string; documento: string | null; entrada_uds: number | null; entrada_precio: number | null; entrada_importe: number | null; salida_uds: number | null; salida_precio: number | null; salida_importe: number | null; regularizacion: number | null; existencias_uds: number; existencias_pmp: number | null; existencias_importe: number | null; pmp_alumno: number | null; pmp_correcto: boolean | null };
const CUENTAS: Record<number, string> = { 300: "Mercaderías (300)", 310: "Materias primas (310)", 350: "Productos terminados (350)" };
const uds = (n: number | null) => (n === null ? "" : String(Number(n)).replace(".", ","));
const p4 = (n: number | null) => (n === null ? "" : pmp(Number(n)));

export default async function Almacen({ searchParams }: { searchParams: Promise<{ art?: string; empresa?: string }> }) {
  const q = await searchParams;
  const yo = await miSesion();
  const prof = yo.rol === "profesora";
  const g = prof ? (q.empresa && /^[1236]$/.test(q.empresa) ? Number(q.empresa) : 1) : yo.empresa_id!;
  const s = await sb();
  const { data: emp } = await s.from("empresas").select("corto, con_almacen").eq("id", g).single();
  if (!emp?.con_almacen) return <section className="card"><h2>Sin almacén</h2><p>Tu empresa no lleva existencias.</p></section>;
  const [{ data: arts }, { data: practica }] = await Promise.all([s.rpc("almacen", { p_empresa: g }), s.rpc("modo_practica")]);
  const articulos = (arts ?? []) as unknown as Articulo[];
  const oculto = !prof && !!practica;
  const sel = articulos.find((a) => a.id === q.art) ?? articulos[0];
  const { data: fic } = sel ? await s.rpc("ficha_almacen", { p_articulo: sel.id }) : { data: [] };
  const ficha = (fic ?? []) as unknown as Mov[];
  const sufijo = prof ? "&empresa=" + g : "";
  const porCuenta = Object.entries(articulos.reduce<Record<number, number>>((a, x) => ({ ...a, [x.cuenta]: (a[x.cuenta] ?? 0) + Number(x.valor ?? 0) }), {}));

  return (
    <>
      <div className="head"><div><h1>{prof ? "Almacén de " + emp.corto : g === 2 ? "Almacén y fabricación" : g === 6 ? "Almacén y tienda" : "Almacén"}</h1>
        <p>Fichas de almacén valoradas por precio medio ponderado (PMP). Se alimentan solas con los albaranes, las facturas y las rectificativas del circuito.</p></div>
        {prof && <Link className="btn ghost sm" href="/existencias" style={{ textDecoration: "none" }}>← Existencias</Link>}</div>
      {oculto && <div className="note info">La profesora ha ocultado el PMP: calcúlalo tú en cada entrada y la app te dice si es correcto.</div>}
      <section className="card"><h2>Existencias</h2>
        {articulos.length ? <div className="tw"><table className="t"><thead><tr><th>Artículo</th><th>Cuenta</th><th className="num">Unidades</th>{!oculto && <><th className="num">PMP</th><th className="num">Valor</th></>}</tr></thead><tbody>
          {articulos.map((a) => <tr key={a.id}><td><Link href={"/almacen?art=" + a.id + sufijo}>{a.id === sel?.id ? <strong>{a.nombre}</strong> : a.nombre}</Link></td><td className="muted">{CUENTAS[a.cuenta]}</td><td className="num">{uds(a.unidades)}</td>{!oculto && <><td className="num">{p4(a.pmp)} €</td><td className="num">{fmt(a.valor ?? 0)}</td></>}</tr>)}
        </tbody></table></div> : <p className="empty">Todavía no hay artículos.</p>}
        {!oculto && <dl className="dl" style={{ marginTop: 12 }}>{porCuenta.map(([c, v]) => <div key={c} style={{ display: "contents" }}><dt>{CUENTAS[Number(c)]}</dt><dd>{fmt(v)}</dd></div>)}</dl>}
      </section>
      {sel && <section className="card"><h2>Ficha de almacén · {sel.nombre}</h2>
        <div className="tw"><table className="t ficha"><thead>
          <tr><th rowSpan={2}>Fecha</th><th rowSpan={2}>Concepto</th><th rowSpan={2}>Doc.</th><th colSpan={3} className="grupo">Entradas</th><th colSpan={3} className="grupo">Salidas</th><th rowSpan={2} className="num">Regul.</th><th colSpan={3} className="grupo">Existencias</th></tr>
          <tr><th className="num">Uds</th><th className="num">Precio</th><th className="num">Importe</th><th className="num">Uds</th><th className="num">Precio</th><th className="num">Importe</th><th className="num">Uds</th><th className="num">PMP</th><th className="num">Importe</th></tr>
        </thead><tbody>
          {ficha.map((m) => (
            <tr key={m.id}>
              <td className="mono">{fecha(m.fecha)}</td><td>{m.concepto}</td><td className="mono">{m.documento ?? "—"}</td>
              <td className="num">{uds(m.entrada_uds)}</td><td className="num">{p4(m.entrada_precio)}</td><td className="num">{p4(m.entrada_importe)}</td>
              <td className="num">{uds(m.salida_uds)}</td><td className="num">{m.salida_uds !== null && oculto ? "¿?" : p4(m.salida_precio)}</td><td className="num">{p4(m.salida_importe)}</td>
              <td className="num">{m.regularizacion !== null ? (Number(m.regularizacion) > 0 ? "+" : "") + p4(m.regularizacion) : ""}</td>
              <td className="num"><strong>{uds(m.existencias_uds)}</strong></td>
              <td className="num">{!oculto ? p4(m.existencias_pmp) : m.entrada_uds !== null || m.regularizacion !== null ? (
                <div className="pmp-check">
                  {m.pmp_correcto !== null && <span className={"chip " + (m.pmp_correcto ? "good" : "bad")}>{m.pmp_correcto ? "Correcto" : "Revisa"} · {p4(m.pmp_alumno)}</span>}
                  <Form action={comprobarPmp} boton="Comprobar" clase="btn sm ghost"><input type="hidden" name="mov" value={m.id} /><input className="in" name="pmp" inputMode="decimal" aria-label="Tu PMP" required /></Form>
                </div>) : ""}</td>
              <td className="num">{p4(m.existencias_importe)}</td>
            </tr>
          ))}
        </tbody></table></div>
        <p className="hint" style={{ marginTop: 10 }}>Entradas al precio del pedido y regularizadas al aceptar la factura (descuentos y portes; los envases no son coste). Salidas al PMP del momento. Las devoluciones a proveedor salen al precio de compra.</p>
      </section>}
      {g === 2 && <Fabricacion articulos={articulos} oculto={oculto} prof={prof} />}
      {g === 6 && <Tienda articulos={articulos} oculto={oculto} prof={prof} />}
    </>
  );
}

async function Fabricacion({ articulos, oculto, prof }: { articulos: Articulo[]; oculto: boolean; prof: boolean }) {
  const s = await sb();
  const [{ data: recetas }, { data: lineas }, { data: ordenes }] = await Promise.all([
    s.from("recetas").select("id, producto_id"),
    s.from("recetas_lineas").select("receta_id, materia_id, cantidad"),
    s.from("ordenes_fabricacion").select("id, num, fecha, producto_nombre, unidades, coste").order("id", { ascending: false }),
  ]);
  const productos = articulos.filter((a) => a.cuenta === 350 && recetas?.some((r) => r.producto_id === a.id)).map((a) => {
    const r = recetas!.find((x) => x.producto_id === a.id)!;
    return { id: a.id, nombre: a.nombre, materias: (lineas ?? []).filter((l) => l.receta_id === r.id).map((l) => { const m = articulos.find((x) => x.id === l.materia_id); return { nombre: m?.nombre ?? "", cantidad: Number(l.cantidad), tienes: Number(m?.unidades ?? 0) }; }) };
  });
  return (
    <section className="card"><h2>Orden de fabricación</h2>
      {prof ? <p className="hint">Solo el G2 registra órdenes de fabricación.</p> : <FabricarForm productos={productos} />}
      {!!ordenes?.length && <div className="tw" style={{ marginTop: 14 }}><table className="t"><thead><tr><th>Orden</th><th>Fecha</th><th>Producto</th><th className="num">Uds</th><th className="num">Coste</th></tr></thead><tbody>
        {ordenes.map((o) => <tr key={o.id}><td className="ref">{o.num}</td><td className="mono">{fecha(o.fecha)}</td><td>{o.producto_nombre}</td><td className="num">{uds(o.unidades)}</td><td className="num">{oculto ? "—" : fmt(o.coste)}</td></tr>)}
      </tbody></table></div>}
    </section>
  );
}

async function Tienda({ articulos, oculto, prof }: { articulos: Articulo[]; oculto: boolean; prof: boolean }) {
  const s = await sb();
  const [{ data: catalogo }, { data: tickets }] = await Promise.all([
    s.from("catalogo").select("id, precio").eq("empresa_id", 6).eq("activo", true),
    s.from("tickets").select("id, num, fecha, descripcion, unidades, total, coste").order("id", { ascending: false }),
  ]);
  const venta = articulos.flatMap((a) => { const c = catalogo?.find((x) => x.id === a.catalogo_id); return c ? [{ ...a, precio: Number(c.precio) }] : []; });
  return (
    <section className="card"><h2>Venta en tienda</h2>
      {prof ? <p className="hint">Solo el G6 registra ventas en tienda.</p> : venta.length ? (
        <Form action={venderTienda} boton="Registrar venta y cobro">
          <div className="row3"><label>Artículo<select className="in" name="articulo">{venta.map((a) => <option key={a.id} value={a.id}>{a.nombre} · {fmt(a.precio)} + IVA</option>)}</select></label>
            <label>Unidades<input className="in" name="unidades" type="number" min="1" step="1" defaultValue="1" required /></label><span /></div>
          <p className="hint">Ticket (factura simplificada) con IVA del 21 %. El cliente paga con tarjeta en el TPV: el cobro entra por el banco, nunca en efectivo.</p>
        </Form>) : <p className="hint">Ningún artículo del almacén está vinculado a tu catálogo.</p>}
      {!!tickets?.length && <div className="tw" style={{ marginTop: 14 }}><table className="t"><thead><tr><th>Ticket</th><th>Fecha</th><th>Artículo</th><th className="num">Uds</th><th className="num">Total cobrado</th><th className="num">Coste PMP</th></tr></thead><tbody>
        {tickets.map((t) => <tr key={t.id}><td className="ref">{t.num}</td><td className="mono">{fecha(t.fecha)}</td><td>{t.descripcion}</td><td className="num">{uds(t.unidades)}</td><td className="num">{fmt(t.total)}</td><td className="num">{oculto ? "—" : fmt(t.coste)}</td></tr>)}
      </tbody></table></div>}
    </section>
  );
}
