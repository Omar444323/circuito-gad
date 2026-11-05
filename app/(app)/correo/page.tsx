import Link from "next/link";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fechaHora } from "@/lib/formato";

type Correo = { id: number; hilo_id: number; remitente_id: number; destinatario_id: number; asunto: string; cuerpo: string; autor_nombre: string; enviado_en: string; leido_en: string | null };
type Hilo = { id: number; asunto: string; ultimo: Correo; mensajes: Correo[] };
const LIMITE = 1000;

export default async function Bandeja({ searchParams }: { searchParams: Promise<{ carpeta?: string; empresa?: string; q?: string }> }) {
  const { carpeta: c, empresa: em, q: busca } = await searchParams;
  const yo = await miSesion();
  const prof = yo.rol === "profesora";
  const carpeta = c === "enviados" ? "enviados" : "recibidos";
  const empresa = prof && em && /^[1-6]$/.test(em) ? Number(em) : null;
  const q = (busca ?? "").trim().toLowerCase();
  const s = await sb();
  let consulta = s.from("correos").select("id, hilo_id, remitente_id, destinatario_id, asunto, cuerpo, autor_nombre, enviado_en, leido_en").order("id", { ascending: false }).limit(LIMITE);
  if (empresa) consulta = consulta.or(`remitente_id.eq.${empresa},destinatario_id.eq.${empresa}`);
  const [{ data }, { data: empresas }] = await Promise.all([consulta, s.from("empresas").select("id, corto").order("id")]);
  const corto = (g: number) => empresas?.find((e) => e.id === g)?.corto ?? "";
  const filas = (data ?? []) as unknown as Correo[];

  // Las filas llegan de la más nueva a la más antigua: la primera de cada hilo es la última recibida
  const hilos = new Map<number, Hilo>();
  for (const m of filas) {
    const h = hilos.get(m.hilo_id);
    if (h) { h.mensajes.push(m); h.asunto = m.asunto; }
    else hilos.set(m.hilo_id, { id: m.hilo_id, asunto: m.asunto, ultimo: m, mensajes: [m] });
  }
  const lista = [...hilos.values()].filter((h) => {
    if (!prof && !h.mensajes.some((m) => (carpeta === "recibidos" ? m.destinatario_id : m.remitente_id) === yo.empresa_id)) return false;
    return !q || h.mensajes.some((m) => (m.asunto + " " + m.cuerpo + " " + m.autor_nombre).toLowerCase().includes(q));
  });
  const sinLeer = (h: Hilo) => h.mensajes.some((m) => m.destinatario_id === yo.empresa_id && !m.leido_en);
  const tab = (k: string, t: string) => <Link className={"btn sm " + (carpeta === k ? "" : "ghost")} aria-current={carpeta === k ? "page" : undefined} href={"/correo?carpeta=" + k} style={{ textDecoration: "none" }}>{t}</Link>;

  return (
    <>
      <div className="head"><div><h1>{prof ? "Todos los correos" : "Correo"}</h1>
        <p>{prof ? "Comunicaciones de todas las empresas. Es una vista de solo lectura: abrir un correo no lo marca como leído." : "Comunicaciones formales con las demás empresas. La profesora puede leer todos los correos, y los enviados no se pueden editar ni borrar."}</p></div>
        {!prof && <Link className="btn" href="/correo/nuevo" style={{ textDecoration: "none" }}>Redactar</Link>}</div>
      <form className="correo-filtros" action="/correo">
        {!prof && <div className="btns">{tab("recibidos", "Recibidos")}{tab("enviados", "Enviados")}<input type="hidden" name="carpeta" value={carpeta} /></div>}
        {prof && <label>Empresa<select className="in" name="empresa" defaultValue={empresa ?? ""}><option value="">Todas</option>{empresas?.map((e) => <option key={e.id} value={e.id}>{e.corto}</option>)}</select></label>}
        <label>Buscar<input className="in" type="search" name="q" defaultValue={busca ?? ""} placeholder="Asunto, texto o autor" /></label>
        <button className="btn ghost">Filtrar</button>
      </form>
      <section className="card">
        {lista.length ? <ul className="correo-lista">{lista.map((h) => {
          const nuevo = sinLeer(h);
          const m = h.ultimo;
          return (
            <li key={h.id} className={nuevo ? "nuevo" : undefined}>
              <Link href={"/correo/" + m.id}>
                <span className="correo-partes">{prof ? corto(m.remitente_id) + " → " + corto(m.destinatario_id) : (m.remitente_id === yo.empresa_id ? "Para " + corto(m.destinatario_id) : corto(m.remitente_id))}{h.mensajes.length > 1 && <span className="muted"> ({h.mensajes.length})</span>}</span>
                <span className="correo-asunto">{nuevo && <span className="chip info">Nuevo</span>} {h.asunto} <span className="muted">— {m.cuerpo.slice(0, 90)}</span></span>
                <span className="mono muted correo-fecha">{fechaHora(m.enviado_en)}</span>
              </Link>
            </li>
          );
        })}</ul> : <p className="empty">{q || empresa ? "Ningún correo coincide con el filtro." : prof ? "Todavía no se ha enviado ningún correo." : carpeta === "recibidos" ? "No has recibido ningún correo." : "No has enviado ningún correo."}</p>}
        {filas.length === LIMITE && <p className="hint" style={{ marginTop: 10 }}>Se muestran los {LIMITE} correos más recientes. Filtra por empresa para ver los anteriores.</p>}
      </section>
    </>
  );
}
