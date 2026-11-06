import { Form } from "./Form";
import { pagarCuota } from "@/app/acciones-circuito";
import { fecha, fmt } from "@/lib/formato";

export type Cuota = { id: number; n: number; vencimiento: string; capital: number; interes: number; cuota: number; pendiente_tras: number; pagada_fecha: string | null; justificante: string | null };

// Cuadro sencillo de cuotas (método francés). Solo se puede pagar la primera pendiente
export function CuadroCuotas({ cuotas, puedePagar }: { cuotas: Cuota[]; puedePagar: boolean }) {
  const orden = [...cuotas].sort((a, b) => a.n - b.n);
  const siguiente = orden.find((c) => !c.pagada_fecha);
  return (
    <details className="ver"><summary>Cuadro de cuotas · {orden.filter((c) => c.pagada_fecha).length} de {orden.length} pagadas</summary>
      <div className="tw"><table className="t"><thead><tr><th className="num">N.º</th><th>Vence</th><th className="num">Capital</th><th className="num">Interés</th><th className="num">Cuota</th><th className="num">Pendiente</th><th>Pago</th></tr></thead><tbody>
        {orden.map((c) => <tr key={c.id}><td className="num">{c.n}</td><td className="mono">{fecha(c.vencimiento)}</td><td className="num">{fmt(c.capital)}</td><td className="num">{fmt(c.interes)}</td><td className="num">{fmt(c.cuota)}</td><td className="num">{fmt(c.pendiente_tras)}</td>
          <td>{c.pagada_fecha ? <span className="chip good">{fecha(c.pagada_fecha)}</span> : puedePagar && c.id === siguiente?.id ? <Form action={pagarCuota} boton="Pagar" clase="btn sm"><input type="hidden" name="cuota" value={c.id} /></Form> : <span className="muted">Pendiente</span>}</td></tr>)}
      </tbody></table></div>
    </details>
  );
}
