import Link from "next/link";
import { Form } from "@/components/Form";
import { admin } from "@/lib/supabase";
import { crearCuentasIniciales } from "../acciones";

export const dynamic = "force-dynamic";

export default async function Arranque() {
  const { count, error } = await admin().from("perfiles").select("id", { count: "exact", head: true });
  return (
    <div className="login">
      <div className="intro"><span className="lbl">Puesta en marcha</span><h1>Cuentas iniciales</h1>
        <p>Crea la cuenta de la profesora y una por grupo. Las contraseñas temporales se muestran una sola vez y esta página se cierra sola en cuanto existen.</p></div>
      <section className="card" style={{ maxWidth: 480 }}>
        {error ? <div className="note bad" role="alert">No se ha podido comprobar el estado: {error.message}</div>
          : count ? <p>Las cuentas ya están creadas. <Link href="/login">Ir al acceso</Link></p>
          : <Form action={crearCuentasIniciales} boton="Crear cuentas iniciales" />}
      </section>
    </div>
  );
}
