import Link from "next/link";
import { enviarCorreo } from "@/app/acciones-circuito";
import { Form } from "@/components/Form";
import { MarcarLeido } from "@/components/MarcarLeido";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fechaHora } from "@/lib/formato";

type Correo = { id: number; hilo_id: number; remitente_id: number; destinatario_id: number; asunto: string; cuerpo: string; pedido_id: number | null; autor_nombre: string; enviado_en: string; leido_en: string | null; leido_por_nombre: string | null };

const Volver = () => <Link className="btn ghost sm" href="/correo" style={{ alignSelf: "flex-start", textDecoration: "none" }}>← Correo</Link>;
const SinAcceso = () => <><Volver /><section className="card"><h2>Sin acceso</h2><p>Este correo no pertenece a tu empresa o no existe.</p></section></>;

export default async function Hilo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return <SinAcceso />;
  const yo = await miSesion();
  const s = await sb();
  const { data: abierto } = await s.from("correos").select("hilo_id").eq("id", id).maybeSingle();
  if (!abierto) return <SinAcceso />;
  const [{ data }, { data: empresas }] = await Promise.all([
    s.from("correos").select("*").eq("hilo_id", abierto.hilo_id).order("id"),
    s.from("empresas").select("id, corto, nombre"),
  ]);
  const mensajes = (data ?? []) as unknown as Correo[];
  const empresa = (g: number) => empresas?.find((e) => e.id === g);
  const primero = mensajes[0];
  const ultimo = mensajes[mensajes.length - 1];
  const pedidoId = primero.pedido_id;
  const { data: pedido } = pedidoId ? await s.from("pedidos").select("num").eq("id", pedidoId).maybeSingle() : { data: null };
  const porLeer = mensajes.filter((m) => m.destinatario_id === yo.empresa_id && !m.leido_en).map((m) => m.id);
  const prof = yo.rol === "profesora";
  const otra = yo.empresa_id === ultimo.remitente_id ? ultimo.destinatario_id : ultimo.remitente_id;

  return (
    <>
      <Volver />
      <div className="head"><div><span className="lbl">{empresa(primero.remitente_id)?.corto} y {empresa(primero.destinatario_id)?.corto}</span><h1>{primero.asunto}</h1>
        {pedidoId && pedido && <p>Sobre la operación <Link className="ref" href={"/operaciones/" + pedidoId}>{pedido.num}</Link></p>}</div></div>
      {!prof && <MarcarLeido ids={porLeer} />}
      {mensajes.map((m) => (
        <article className="card correo-msg" key={m.id} id={"c" + m.id}>
          <header>
            <div><strong>{empresa(m.remitente_id)?.nombre}</strong> <span className="muted">· {m.autor_nombre}</span><br /><span className="hint">Para {empresa(m.destinatario_id)?.nombre}</span></div>
            <div className="correo-meta"><span className="mono muted">{fechaHora(m.enviado_en)}</span>
              {(m.remitente_id === yo.empresa_id || prof) && (m.leido_en ? <span className="hint">Leído por {m.leido_por_nombre}</span> : <span className="hint">Sin leer</span>)}</div>
          </header>
          <p className="correo-cuerpo">{m.cuerpo}</p>
        </article>
      ))}
      {prof
        ? <div className="note info">La profesora solo lee: no responde en nombre de ninguna empresa.</div>
        : <section className="card"><h3>Responder a {empresa(otra)?.corto}</h3>
            <Form key={ultimo.id} action={enviarCorreo} boton="Enviar respuesta">
              <input type="hidden" name="responde_a" value={ultimo.id} />
              <label>Mensaje<textarea className="in correo-texto" name="cuerpo" required maxLength={5000} /></label>
            </Form></section>}
    </>
  );
}
