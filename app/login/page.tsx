import { Form } from "@/components/Form";
import { entrar } from "../acciones";

export default function Login() {
  return (
    <div className="login">
      <div className="intro">
        <span className="lbl">Proyecto anual de simulación administrativa 2026-2027</span>
        <h1>Circuito GAD</h1>
        <p>Pedidos, albaranes, facturas y pagos entre las seis empresas de clase, con el banco simulado conectado. Cada cuenta solo ve sus propias operaciones.</p>
      </div>
      <section className="card" style={{ maxWidth: 400 }}>
        <Form action={entrar} boton="Entrar">
          <label>Usuario<input className="in" name="usuario" autoComplete="username" required /></label>
          <label>Contraseña<input className="in" name="clave" type="password" autoComplete="current-password" required /></label>
        </Form>
      </section>
    </div>
  );
}
