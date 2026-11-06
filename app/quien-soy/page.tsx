import { redirect } from "next/navigation";
import { Form } from "@/components/Form";
import { altaIntegrante, elegirFirmante, salir } from "../acciones";
import { cuentaActual } from "@/lib/sesion";
import { sb } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Al entrar con la cuenta del grupo se elige quién es: esa persona firma todo lo que se haga
export default async function QuienSoy() {
  const cuenta = await cuentaActual();
  if (!cuenta.cuenta_grupo) redirect("/");
  const s = await sb();
  const [{ data: gente }, { data: empresa }] = await Promise.all([
    s.from("perfiles").select("id, nombre").eq("empresa_id", cuenta.empresa_id!).eq("activo", true).eq("cuenta_grupo", false).order("nombre"),
    s.from("empresas").select("corto, nombre").eq("id", cuenta.empresa_id!).single(),
  ]);
  return (
    <div className="login">
      <div className="intro"><span className="lbl">{empresa?.corto} · {empresa?.nombre}</span><h1>¿Quién eres?</h1>
        <p>Tu nombre quedará como firma en los documentos que hagas. Elige solo tu nombre: la profesora puede revisar quién ha firmado cada cosa.</p></div>
      <section className="card" style={{ maxWidth: 480 }}>
        {gente?.length ? <div className="stack">{gente.map((m) => <Form key={m.id} action={elegirFirmante} boton={m.nombre} clase="btn ghost"><input type="hidden" name="perfil" value={m.id} /></Form>)}</div> : <p className="empty">Tu grupo todavía no tiene integrantes. Añade tu nombre para empezar.</p>}
      </section>
      <section className="card" style={{ maxWidth: 480 }}>
        <Form action={altaIntegrante} boton="Añadirme al grupo" clase="btn ghost"><input type="hidden" name="empresa" value={cuenta.empresa_id ?? ""} /><label>¿No estás en la lista? Nombre y apellidos<input className="in" name="nombre" required /></label></Form>
      </section>
      <form action={salir}><button className="btn ghost sm">Salir</button></form>
    </div>
  );
}
