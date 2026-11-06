import Link from "next/link";
import { Form } from "@/components/Form";
import { crearCircular } from "@/app/acciones-circuito";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fecha } from "@/lib/formato";

type Circular = { id: number; tipo: string; titulo: string; fecha: string; fecha_limite: string | null };
const TIPOS: Record<string, string> = { circular: "Circular", modelo: "Modelo" };

export default async function Circulares() {
  const yo = await miSesion();
  const s = await sb();
  const [{ data: filas }, { data: lecturas }, { data: entregas }, { data: hoy }] = await Promise.all([
    s.from("circulares").select("id, tipo, titulo, fecha, fecha_limite").order("id", { ascending: false }),
    s.from("circular_lecturas").select("circular_id, empresa_id"),
    s.from("entregas").select("circular_id, empresa_id"),
    s.rpc("hoy"),
  ]);
  const lista = (filas ?? []) as unknown as Circular[];
  const prof = yo.rol === "profesora";
  const leida = (c: number) => lecturas?.some((l) => l.circular_id === c && l.empresa_id === yo.empresa_id);
  const entregada = (c: number) => entregas?.some((e) => e.circular_id === c && e.empresa_id === yo.empresa_id);
  const nEntregas = (c: number) => entregas?.filter((e) => e.circular_id === c).length ?? 0;
  const nLecturas = (c: number) => lecturas?.filter((l) => l.circular_id === c).length ?? 0;
  return (
    <>
      <div className="head"><h1>Circulares y entregas</h1><p>{prof ? "Lo que publiques llega a todos los grupos. Con fecha límite, cada grupo podrá hacer su entrega hasta ese día; lo que llegue después queda marcado como fuera de plazo." : "Lo que publica la profesora para todos los grupos, y los modelos que tenéis que entregar."}</p></div>
      {prof && (
        <section className="card"><h2>Publicar</h2>
          <Form action={crearCircular} boton="Publicar para todos los grupos">
            <div className="row3">
              <label>Tipo<select className="in" name="tipo"><option value="circular">Circular</option><option value="modelo">Modelo con entrega</option></select></label>
              <label>Título<input className="in" name="titulo" maxLength={150} required /></label>
              <label>Fecha límite de entrega<input className="in" type="date" name="limite" min={hoy as string} /></label>
            </div>
            <label>Contenido<textarea className="in correo-texto" name="cuerpo" maxLength={10000} required /></label>
            <p className="hint">Un modelo necesita fecha límite. En una circular es opcional: sin fecha, solo se lee.</p>
          </Form>
        </section>
      )}
      <section className="card">
        {lista.length ? <div className="tw"><table className="t"><thead><tr><th>Título</th><th>Tipo</th><th>Publicada</th><th>Fecha límite</th><th>{prof ? "Leída / entregada" : "Estado"}</th></tr></thead><tbody>
          {lista.map((c) => (
            <tr key={c.id}>
              <td><Link href={"/circulares/" + c.id}><strong>{c.titulo}</strong></Link></td>
              <td>{TIPOS[c.tipo]}</td>
              <td className="mono">{fecha(c.fecha)}</td>
              <td>{c.fecha_limite ? <span className={"chip " + ((hoy as string) > c.fecha_limite ? "off" : "info")}>{fecha(c.fecha_limite)}</span> : <span className="muted">—</span>}</td>
              <td>{prof ? <span className="mono">{nLecturas(c.id)}/6 · {c.fecha_limite ? nEntregas(c.id) + "/6" : "—"}</span> : c.fecha_limite ? <span className={"chip " + (entregada(c.id) ? "good" : (hoy as string) > c.fecha_limite ? "bad" : "warn")}>{entregada(c.id) ? "Entregada" : "Sin entregar"}</span> : <span className={"chip " + (leida(c.id) ? "good" : "info")}>{leida(c.id) ? "Leída" : "Nueva"}</span>}</td>
            </tr>
          ))}
        </tbody></table></div> : <p className="empty">Todavía no hay nada publicado.</p>}
      </section>
    </>
  );
}
