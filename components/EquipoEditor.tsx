import { Form } from "@/components/Form";
import { altaIntegrante, darBaja, guardarArticulo, guardarEmpresa, guardarNombre, guardarReceta, quitarArticulo } from "@/app/acciones";
import { sb } from "@/lib/supabase";
import { fecha, fmt } from "@/lib/formato";

type Solicitud = { id: number; catalogo_id: string | null; nombre: string; precio: number; estado: string; motivo_rechazo: string | null; fecha: string };

export async function EquipoEditor({ empresa }: { empresa: number }) {
  const s = await sb();
  const [{ data: e }, { data: gente }, { data: cat }, { data: sol }] = await Promise.all([
    s.from("empresas").select("*").eq("id", empresa).single(),
    s.from("perfiles").select("*").eq("empresa_id", empresa).eq("activo", true).eq("cuenta_grupo", false).order("nombre"),
    s.from("catalogo").select("*").eq("empresa_id", empresa).eq("activo", true).order("nombre"),
    s.from("solicitudes_precio").select("id, catalogo_id, nombre, precio, estado, motivo_rechazo, fecha").eq("empresa_id", empresa).neq("estado", "aceptada").order("id", { ascending: false }).limit(20),
  ]);
  const solicitudes = (sol ?? []) as unknown as Solicitud[];
  const pendiente = (c: string) => solicitudes.find((x) => x.catalogo_id === c && x.estado === "pendiente");
  const altas = solicitudes.filter((x) => !x.catalogo_id && x.estado === "pendiente");
  const rechazadas = solicitudes.filter((x) => x.estado === "rechazada").slice(0, 5);
  const id = <input type="hidden" name="empresa" value={empresa} />;
  return (
    <>
      <section className="card"><h2>Datos de la empresa</h2>
        <Form action={guardarEmpresa} boton="Guardar datos">{id}
          <div className="row3"><label>Nombre comercial<input className="in" name="nombre" defaultValue={e?.nombre} required /></label><label>Actividad<input className="in" name="actividad" defaultValue={e?.actividad} required /></label></div>
          <p className="hint">{e?.corto} · Sector: {e?.sector} · IBAN <span className="mono">{e?.iban}</span>. El número de grupo, el sector y el IBAN no cambian.</p>
        </Form>
      </section>
      <section className="card"><h2>Integrantes</h2>
        <div>{gente?.map((m) => (
          <div className="fila" key={m.id}>
            <Form action={guardarNombre} boton="Guardar" clase="btn ghost sm"><input type="hidden" name="perfil" value={m.id} /><label>{m.usuario}<input className="in" name="nombre" defaultValue={m.nombre} required /></label></Form>
            <Form action={darBaja} boton="Dar de baja" clase="btn danger sm"><input type="hidden" name="perfil" value={m.id} /></Form>
          </div>))}</div>
        <p className="hint" style={{ marginBlock: 12 }}>Dar de baja saca al alumno del equipo, pero conserva lo que firmó. El equipo necesita al menos un integrante activo.</p>
        <Form action={altaIntegrante} boton="Añadir integrante" clase="btn ghost">{id}<label>Nombre y apellidos del nuevo integrante<input className="in" name="nombre" required /></label></Form>
      </section>
      {empresa === 5 ? <section className="card"><h2>Catálogo</h2><p className="hint">El banco publica sus comisiones en sus condiciones.</p></section> : (
        <section className="card"><h2>Catálogo de precios</h2>
          <div>{cat?.map((c) => {
            const p = pendiente(c.id);
            return (
              <div className="fila" key={c.id}>
                <Form action={guardarArticulo} boton="Guardar" clase="btn ghost sm">{id}<input type="hidden" name="id" value={c.id} />
                  <div className="row3"><label>{empresa === 4 ? "Servicio" : "Artículo"}<input className="in" name="nombre" defaultValue={c.nombre} required /></label><label>Coste €<input className="in" name="coste" inputMode="decimal" defaultValue={c.coste ?? c.precio} required /></label><label>Margen %<input className="in" name="margen" inputMode="decimal" defaultValue={c.margen ?? 0} required /></label></div>
                  <p className="hint">Precio de venta sin IVA: <strong>{fmt(c.precio)}</strong>{p && <> · <span className="chip warn">Pendiente de aceptar: {fmt(p.precio)}</span></>}</p>
                </Form>
                <Form action={quitarArticulo} boton="Quitar" clase="btn danger sm"><input type="hidden" name="id" value={c.id} /></Form>
              </div>
            );
          })}</div>
          {altas.map((a) => <div className="fila" key={a.id}><span>{a.nombre} · {fmt(a.precio)}</span><span className="chip warn">Artículo nuevo pendiente de aceptar</span></div>)}
          <p className="hint" style={{ marginBlock: 12 }}>El precio de venta es el coste más el margen. Según las normas, cada cambio de precio y cada artículo nuevo necesitan que la profesora los acepte. Mientras tanto se sigue vendiendo al precio actual, y los pedidos ya enviados conservan el suyo.</p>
          {rechazadas.length > 0 && <div className="stack" style={{ marginBottom: 12 }}>{rechazadas.map((r) => <div className="note bad" key={r.id}>{fecha(r.fecha)}: rechazado {r.nombre} a {fmt(r.precio)}. {r.motivo_rechazo}</div>)}</div>}
          <Form action={guardarArticulo} boton={empresa === 4 ? "Proponer servicio" : "Proponer artículo"} clase="btn ghost">{id}<div className="row3"><label>Nombre<input className="in" name="nombre" required /></label><label>Coste €<input className="in" name="coste" inputMode="decimal" required /></label><label>Margen %<input className="in" name="margen" inputMode="decimal" defaultValue="0" required /></label></div></Form>
        </section>
      )}
      {empresa === 2 && <Recetas />}
    </>
  );
}

async function Recetas() {
  const s = await sb();
  const [{ data: arts }, { data: recetas }, { data: lineas }] = await Promise.all([
    s.from("articulos").select("id, nombre, cuenta").eq("empresa_id", 2).order("nombre"),
    s.from("recetas").select("id, producto_id"),
    s.from("recetas_lineas").select("*"),
  ]);
  const materias = arts?.filter((a) => a.cuenta === 310) ?? [];
  return (
    <section className="card"><h2>Recetas de fabricación</h2>
      <div className="stack">{arts?.filter((a) => a.cuenta === 350).map((p) => {
        const r = recetas?.find((x) => x.producto_id === p.id);
        return (
          <Form key={p.id} action={guardarReceta} boton="Guardar receta" clase="btn ghost sm"><h3>{p.nombre}</h3><input type="hidden" name="producto" value={p.id} />
            <div className="row3">{materias.map((m) => <label key={m.id}>{m.nombre}<input className="in" name={"cant_" + m.id} inputMode="decimal" defaultValue={lineas?.find((l) => l.receta_id === r?.id && l.materia_id === m.id)?.cantidad ?? ""} /></label>)}</div>
          </Form>);
      })}</div>
      <p className="hint" style={{ marginTop: 12 }}>Cantidad de cada materia prima por unidad, mayor que 0. Deja vacía la casilla de la que no se use. Los cambios solo afectan a las órdenes de fabricación nuevas.</p>
    </section>
  );
}
