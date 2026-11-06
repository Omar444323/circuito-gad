import { redirect } from "next/navigation";
import { Form } from "@/components/Form";
import { guardarArticulo, quitarArticulo } from "@/app/acciones";
import { autorizarDescubierto, autorizarFinanciacion, fijarIvaCatalogo, resolverPlan, resolverPrecio } from "@/app/acciones-circuito";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fecha, fmt } from "@/lib/formato";

type Solicitud = { id: number; empresa_id: number; catalogo_id: string | null; nombre: string; coste: number; margen: number; precio: number; precio_anterior: number | null; fecha: string; solicito_nombre: string };
type Prestamo = { perfil_id: string | null; id: number; empresa_id: number; importe: number; plazo_meses: number; motivo: string; tipo_interes: number | null; causa_distinta: string | null; banco_nombre: string | null; solicito_nombre: string };
type Plan = { id: number; empresa_id: number; reduccion_gastos: string; revision_precios: string; financiacion: string; importe_solicitado: number; fecha: string; presento_nombre: string };
type Descubierto = { id: number; empresa_id: number; limite: number; motivo: string; fecha: string };
const pc = (v: number | null) => String(Number(v ?? 0)).replace(".", ",") + " %";

// Lo que las normas reservan a la profesora. El resto de las operaciones lo hacen los grupos y el banco
export default async function Autorizaciones() {
  const yo = await miSesion();
  if (yo.rol !== "profesora") redirect("/");
  const s = await sb();
  const [{ data: pre }, { data: fin }, { data: pla }, { data: des }, { data: emp }, { data: cat }] = await Promise.all([
    s.from("solicitudes_precio").select("*").eq("estado", "pendiente").order("id"),
    s.from("solicitudes_financiacion").select("*").eq("estado", "estudiada").order("id"),
    s.from("planes_viabilidad").select("*").eq("estado", "presentado").order("id"),
    s.from("autorizaciones_descubierto").select("*").order("id", { ascending: false }),
    s.from("empresas").select("id, corto, tipo").order("id"),
    s.from("catalogo").select("*").eq("empresa_id", 7).eq("activo", true).order("nombre"),
  ]);
  const precios = (pre ?? []) as unknown as Solicitud[];
  const prestamos = (fin ?? []) as unknown as Prestamo[];
  const planes = (pla ?? []) as unknown as Plan[];
  const descubiertos = (des ?? []) as unknown as Descubierto[];
  const corto = (g: number) => emp?.find((e) => e.id === g)?.corto ?? "";
  // Vigente: la última autorización de cada empresa
  const [{ data: catalogo }, { data: empresasCat }] = await Promise.all([
    s.from("catalogo").select("id, empresa_id, nombre, iva").eq("activo", true).order("nombre"),
    s.from("empresas").select("id, corto").order("id"),
  ]);
  const vigentes = descubiertos.filter((d, i) => descubiertos.findIndex((x) => x.empresa_id === d.empresa_id) === i && Number(d.limite) > 0);
  return (
    <>
      <div className="head"><h1>Autorizaciones</h1><p>Lo único que necesita tu decisión, según el punto 8 de las normas. Los pedidos, facturas y pagos los llevan los grupos.</p></div>
      <section className="card"><h2>Cambios de precio</h2>
        {precios.length ? <div className="stack">{precios.map((p) => (
          <div className="doc" key={p.id}>
            <div className="btns" style={{ justifyContent: "space-between" }}><strong>{corto(p.empresa_id)} · {p.nombre}</strong><span className={"chip " + (p.catalogo_id ? "warn" : "info")}>{p.catalogo_id ? "Cambio de precio" : "Artículo nuevo"}</span></div>
            <dl className="dl"><dt>Coste</dt><dd>{fmt(p.coste)}</dd><dt>Margen</dt><dd>{pc(p.margen)}</dd>{p.precio_anterior !== null && <><dt>Precio actual</dt><dd>{fmt(p.precio_anterior)}</dd></>}<dt><strong>Precio propuesto</strong></dt><dd><strong>{fmt(p.precio)}</strong></dd></dl>
            <p className="hint">Lo pide {p.solicito_nombre} el {fecha(p.fecha)}.</p>
            <Form action={resolverPrecio} boton="Aceptar"><input type="hidden" name="solicitud" value={p.id} /><input type="hidden" name="aceptar" value="true" /></Form>
            <Form action={resolverPrecio} boton="Rechazar" clase="btn danger"><input type="hidden" name="solicitud" value={p.id} /><input type="hidden" name="aceptar" value="false" /><label>Motivo si lo rechazas<input className="in" name="motivo" required /></label></Form>
          </div>
        ))}</div> : <p className="empty">No hay cambios de precio pendientes.</p>}
      </section>
      <section className="card"><h2>Préstamos estudiados por el banco</h2>
        {prestamos.length ? <div className="stack">{prestamos.map((p) => (
          <div className="doc" key={p.id}>
            <div className="btns" style={{ justifyContent: "space-between" }}><strong>{corto(p.empresa_id)}{p.perfil_id ? " · préstamo personal de " + p.solicito_nombre : ""} · {fmt(p.importe)} a {p.plazo_meses} meses</strong><span className="chip info">Tipo {pc(p.tipo_interes)}</span></div>
            <p>{p.motivo}</p>
            {p.causa_distinta && <div className="note warn">Tipo distinto del publicado. Causa: {p.causa_distinta}</div>}
            <p className="hint">Lo pide {p.solicito_nombre}. Lo estudia {p.banco_nombre}.</p>
            <Form action={autorizarFinanciacion} boton="Autorizar y abonar"><input type="hidden" name="solicitud" value={p.id} /><input type="hidden" name="autorizar" value="true" /></Form>
            <Form action={autorizarFinanciacion} boton="Rechazar" clase="btn danger"><input type="hidden" name="solicitud" value={p.id} /><input type="hidden" name="autorizar" value="false" /><label>Motivo si lo rechazas<input className="in" name="motivo" required /></label></Form>
          </div>
        ))}</div> : <p className="empty">No hay préstamos por autorizar.</p>}
      </section>
      <section className="card"><h2>Planes de viabilidad</h2>
        {planes.length ? <div className="stack">{planes.map((p) => (
          <div className="doc" key={p.id}>
            <div className="btns" style={{ justifyContent: "space-between" }}><strong>{corto(p.empresa_id)} · pide {fmt(p.importe_solicitado)}</strong><span className="muted">{p.presento_nombre} · {fecha(p.fecha)}</span></div>
            <dl><dt className="lbl">Reducción de gastos</dt><dd className="correo-cuerpo">{p.reduccion_gastos}</dd><dt className="lbl">Revisión de precios</dt><dd className="correo-cuerpo">{p.revision_precios}</dd><dt className="lbl">Financiación</dt><dd className="correo-cuerpo">{p.financiacion}</dd></dl>
            <Form action={resolverPlan} boton="Aprobar el plan"><input type="hidden" name="plan" value={p.id} /><input type="hidden" name="aprobar" value="true" />
              <div className="row3"><label>Rescate del Estado €<input className="in" type="number" min="0" step="0.01" name="importe" defaultValue={Number(p.importe_solicitado)} /></label><label>Condiciones<input className="in" name="condiciones" required /></label></div>
            </Form>
            <Form action={resolverPlan} boton="Rechazar" clase="btn danger"><input type="hidden" name="plan" value={p.id} /><input type="hidden" name="aprobar" value="false" /><label>Motivo si lo rechazas<input className="in" name="condiciones" required /></label></Form>
          </div>
        ))}</div> : <p className="empty">No hay planes presentados.</p>}
      </section>
      <section className="card"><h2>Descubierto bancario</h2>
        <div className="stack">
          <p className="hint">Está prohibido salvo autorización tuya. La cantidad es hasta dónde puede quedar la cuenta en negativo. Pon 0 para retirarla.</p>
          <Form action={autorizarDescubierto} boton="Guardar límite">
            <div className="row3">
              <label>Empresa<select className="in" name="empresa">{emp?.filter((e) => e.tipo === "grupo").map((e) => <option key={e.id} value={e.id}>{e.corto}</option>)}</select></label>
              <label>Límite €<input className="in" type="number" min="0" step="0.01" name="limite" required /></label>
              <label>Motivo<input className="in" name="motivo" required /></label>
            </div>
          </Form>
          {vigentes.length ? <div className="tw"><table className="t"><thead><tr><th>Empresa</th><th>Desde</th><th>Motivo</th><th className="num">Límite</th></tr></thead><tbody>
            {vigentes.map((d) => <tr key={d.id}><td>{corto(d.empresa_id)}</td><td className="mono">{fecha(d.fecha)}</td><td>{d.motivo}</td><td className="num">{fmt(d.limite)}</td></tr>)}
          </tbody></table></div> : <p className="empty">Ninguna empresa tiene descubierto autorizado.</p>}
        </div>
      </section>
      <section className="card"><h2>Materias primas que vende el Estado</h2>
        <p className="hint" style={{ marginBottom: 12 }}>Es lo que el G1 puede comprar. El G1 hace los documentos y paga a la cuenta &quot;Estado vende materias&quot;; tú solo fijas estos precios.</p>
        <div>{cat?.map((c) => (
          <div className="fila" key={c.id}>
            <Form action={guardarArticulo} boton="Guardar" clase="btn ghost sm"><input type="hidden" name="empresa" value="7" /><input type="hidden" name="id" value={c.id} /><input type="hidden" name="margen" value="0" /><div className="row3"><label>Materia prima<input className="in" name="nombre" defaultValue={c.nombre} required /></label><label>Precio sin IVA €<input className="in" name="coste" inputMode="decimal" defaultValue={c.precio} required /></label></div></Form>
            <Form action={quitarArticulo} boton="Quitar" clase="btn danger sm"><input type="hidden" name="id" value={c.id} /></Form>
          </div>))}</div>
        <Form action={guardarArticulo} boton="Añadir materia prima" clase="btn ghost"><input type="hidden" name="empresa" value="7" /><input type="hidden" name="margen" value="0" /><div className="row3"><label>Nombre<input className="in" name="nombre" required /></label><label>Precio sin IVA €<input className="in" name="coste" inputMode="decimal" required /></label></div></Form>
      </section>
      <section className="card"><h2>IVA del catálogo</h2>
        <p className="hint">Punto 3.6: el tipo que indiques aquí rellena la factura y se aplica en la tienda. Todos empiezan en el 21 %.</p>
        <div className="stack">{(empresasCat ?? []).map((e) => { const items = (catalogo ?? []).filter((c) => c.empresa_id === e.id); return items.length ? (
          <details className="ver" key={e.id}><summary>{e.corto} ({items.length})</summary><div>{items.map((c) => (
            <div className="fila" key={c.id}><span>{c.nombre}</span><Form action={fijarIvaCatalogo} boton="Guardar" clase="btn ghost sm"><input type="hidden" name="id" value={c.id} /><select className="in" name="iva" defaultValue={Number(c.iva)} aria-label={"IVA de " + c.nombre}>{[21, 10, 4, 0].map((v) => <option key={v} value={v}>{v} %</option>)}</select></Form></div>
          ))}</div></details>
        ) : null; })}</div>
      </section>
    </>
  );
}
