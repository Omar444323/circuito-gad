import { redirect } from "next/navigation";
import { Form } from "@/components/Form";
import { noLectivo, quitarNoLectivo } from "@/app/acciones";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fecha } from "@/lib/formato";

export default async function Calendario() {
  const yo = await miSesion();
  if (yo.rol !== "profesora") redirect("/");
  const s = await sb();
  const { data: dias } = await s.from("calendario").select("*").order("fecha");
  return (
    <>
      <div className="head"><h1>Calendario lectivo</h1><p>Se trabaja de lunes a viernes, menos los días que marques aquí. Todos los plazos se cuentan con este calendario.</p></div>
      <section className="card"><h2>Marcar un día sin clase</h2>
        <Form action={noLectivo} boton="Marcar como no lectivo"><div className="row3"><label>Fecha<input className="in" type="date" name="fecha" required /></label><label>Motivo<input className="in" name="motivo" placeholder="Festivo, puente…" required /></label></div></Form>
      </section>
      <section className="card"><h2>Días no lectivos</h2>
        {dias?.length ? <div>{dias.map((d) => <div className="fila" key={d.fecha}><span><span className="mono">{fecha(d.fecha)}</span> · {d.motivo}</span><Form action={quitarNoLectivo} boton="Quitar" clase="btn danger sm"><input type="hidden" name="fecha" value={d.fecha} /></Form></div>)}</div> : <p className="empty">Todavía no hay días marcados.</p>}
      </section>
    </>
  );
}
