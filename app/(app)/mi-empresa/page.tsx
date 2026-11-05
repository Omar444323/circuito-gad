import { redirect } from "next/navigation";
import { Form } from "@/components/Form";
import { EquipoEditor } from "@/components/EquipoEditor";
import { cambiarClave } from "@/app/acciones";
import { miSesion } from "@/lib/sesion";

export default async function MiEmpresa() {
  const yo = await miSesion();
  if (!yo.empresa_id) redirect("/equipos");
  return (
    <>
      <div className="head"><h1>Mi empresa</h1><p>Cualquier integrante del equipo puede cambiar estos datos. Cada cambio queda registrado y la profesora lo ve.</p></div>
      <EquipoEditor empresa={yo.empresa_id} />
      <section className="card"><h2>Mi contraseña</h2><Form action={cambiarClave} boton="Cambiar contraseña" clase="btn ghost"><label>Contraseña nueva (mínimo 8 caracteres)<input className="in" name="nueva" type="password" autoComplete="new-password" minLength={8} required /></label></Form></section>
    </>
  );
}
