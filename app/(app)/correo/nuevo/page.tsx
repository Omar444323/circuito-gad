import Link from "next/link";
import { redirect } from "next/navigation";
import { enviarCorreo } from "@/app/acciones-circuito";
import { Form } from "@/components/Form";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";

export default async function Nuevo({ searchParams }: { searchParams: Promise<{ para?: string; pedido?: string }> }) {
  const { para, pedido: pedidoQ } = await searchParams;
  const yo = await miSesion();
  if (!yo.empresa_id) redirect("/correo");
  const s = await sb();
  const { data: empresas } = await s.from("empresas").select("id, corto, nombre").eq("tipo", "grupo").order("id");
  const destinos = (empresas ?? []).filter((e) => e.id !== yo.empresa_id);
  const { data: pedido } = pedidoQ && /^\d+$/.test(pedidoQ) ? await s.from("pedidos").select("id, num, comprador_id, vendedor_id").eq("id", pedidoQ).maybeSingle() : { data: null };
  // Si es sobre una operación, la destinataria es siempre la otra parte
  const fija = pedido ? (pedido.comprador_id === yo.empresa_id ? pedido.vendedor_id : pedido.comprador_id) : null;
  const inicial = para && destinos.some((e) => String(e.id) === para) ? para : "";
  return (
    <>
      <Link className="btn ghost sm" href="/correo" style={{ alignSelf: "flex-start", textDecoration: "none" }}>← Correo</Link>
      <div className="head"><div><h1>Redactar correo</h1><p>Lo verán tu equipo, la empresa destinataria y la profesora. Una vez enviado no se puede editar ni borrar.</p></div></div>
      <section className="card">
        <Form action={enviarCorreo} boton="Enviar">
          {fija
            ? <><input type="hidden" name="destinatario" value={fija} /><input type="hidden" name="pedido" value={pedido!.id} /><p>Para <strong>{destinos.find((e) => e.id === fija)?.nombre}</strong>, sobre la operación <span className="ref">{pedido!.num}</span></p></>
            : <label>Para<select className="in" name="destinatario" required defaultValue={inicial}><option value="" disabled>Elige una empresa</option>{destinos.map((e) => <option key={e.id} value={e.id}>{e.corto} · {e.nombre}</option>)}</select></label>}
          <label>Asunto<input className="in" name="asunto" required maxLength={150} defaultValue={pedido ? "Sobre el pedido " + pedido.num : ""} /></label>
          <label>Mensaje<textarea className="in correo-texto" name="cuerpo" required maxLength={5000} /></label>
        </Form>
      </section>
    </>
  );
}
