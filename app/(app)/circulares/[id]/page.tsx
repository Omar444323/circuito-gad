import Link from "next/link";
import { Form } from "@/components/Form";
import { MarcarCircularLeida } from "@/components/MarcarLeido";
import { cambiarLimiteCircular, entregarModelo, revisarEntrega } from "@/app/acciones-circuito";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fecha, fechaHora } from "@/lib/formato";

type Entrega = { id: number; empresa_id: number; contenido: string; entrego_nombre: string; entregada_en: string; fuera_de_plazo: boolean; revision: string | null };
type Lectura = { empresa_id: number; leida_por_nombre: string; leida_en: string };
const Volver = () => <Link className="btn ghost sm" href="/circulares" style={{ alignSelf: "flex-start", textDecoration: "none" }}>← Circulares</Link>;

export default async function Circular({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const yo = await miSesion();
  const s = await sb();
  const { data: c } = /^\d+$/.test(id) ? await s.from("circulares").select("*").eq("id", id).maybeSingle() : { data: null };
  if (!c) return <><Volver /><section className="card"><h2>No encontrada</h2><p>Esa circular no existe.</p></section></>;
  const [{ data: ent }, { data: lec }, { data: empresas }, { data: hoy }] = await Promise.all([
    s.from("entregas").select("*").eq("circular_id", id),
    s.from("circular_lecturas").select("*").eq("circular_id", id),
    s.from("empresas").select("id, corto").eq("tipo", "grupo").order("id"),
    s.rpc("hoy"),
  ]);
  const entregas = (ent ?? []) as unknown as Entrega[];
  const lecturas = (lec ?? []) as unknown as Lectura[];
  const prof = yo.rol === "profesora";
  const mia = entregas.find((e) => e.empresa_id === yo.empresa_id);
  const fuera = !!c.fecha_limite && (hoy as string) > c.fecha_limite;
  return (
    <>
      <Volver />
      {!prof && <MarcarCircularLeida id={c.id} />}
      <div className="head"><span className="lbl">{c.tipo === "modelo" ? "Modelo" : "Circular"} · publicada el {fecha(c.fecha)}</span><h1>{c.titulo}</h1>
        {c.fecha_limite && <div className="btns" style={{ marginTop: 8 }}><span className={"chip " + (fuera ? "bad" : "info")}>{fuera ? "Venció el " : "Entrega hasta el "}{fecha(c.fecha_limite)}</span></div>}</div>
      <section className="card"><p className="correo-cuerpo">{c.cuerpo}</p></section>
      {!prof && c.fecha_limite && (
        <section className="card"><h2>Entrega de tu grupo</h2>
          <div className="stack">
            {mia && <div className={"note " + (mia.fuera_de_plazo ? "warn" : "good")}>Entregada por {mia.entrego_nombre} el {fechaHora(mia.entregada_en)}{mia.fuera_de_plazo ? ", fuera de plazo" : ""}.</div>}
            {mia?.revision && <div className="note info">Revisión de la profesora: {mia.revision}</div>}
            {fuera && !mia && <div className="note warn">El plazo ha vencido. Puedes entregar, pero constará como fuera de plazo.</div>}
            <Form action={entregarModelo} boton={mia ? "Guardar cambios en la entrega" : "Entregar"}>
              <input type="hidden" name="circular" value={c.id} />
              <label>Contenido de la entrega<textarea className="in correo-texto" name="contenido" maxLength={10000} defaultValue={mia?.contenido ?? ""} required /></label>
            </Form>
          </div>
        </section>
      )}
      {prof && (
        <>
          {c.fecha_limite && (
            <section className="card"><h2>Fecha límite</h2>
              <Form action={cambiarLimiteCircular} boton="Cambiar fecha" clase="btn ghost"><input type="hidden" name="circular" value={c.id} /><label>Nueva fecha límite<input className="in" type="date" name="limite" defaultValue={c.fecha_limite} required /></label></Form>
            </section>
          )}
          <section className="card"><h2>Grupos</h2>
            <div className="stack">{empresas?.map((e) => {
              const l = lecturas.find((x) => x.empresa_id === e.id);
              const x = entregas.find((y) => y.empresa_id === e.id);
              return (
                <div key={e.id} className="stack">
                  <div className="fila"><strong>{e.corto}</strong><span className="btns"><span className={"chip " + (l ? "good" : "off")}>{l ? "Leída por " + l.leida_por_nombre : "Sin leer"}</span>{c.fecha_limite && <span className={"chip " + (x ? (x.fuera_de_plazo ? "warn" : "good") : "off")}>{x ? (x.fuera_de_plazo ? "Fuera de plazo" : "Entregada") : "Sin entregar"}</span>}</span></div>
                  {x && <details className="ver"><summary>Ver la entrega de {x.entrego_nombre} · {fechaHora(x.entregada_en)}</summary>
                    <p className="correo-cuerpo">{x.contenido}</p>
                    <Form action={revisarEntrega} boton="Guardar revisión" clase="btn ghost"><input type="hidden" name="entrega" value={x.id} /><label>Revisión para el grupo<textarea className="in" name="revision" maxLength={2000} defaultValue={x.revision ?? ""} required /></label></Form>
                  </details>}
                </div>
              );
            })}</div>
          </section>
        </>
      )}
    </>
  );
}
